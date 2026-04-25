// op_stft.test.js — real-math tests for op_stft.
// Run via: node scripts/check_op_math.mjs
//
// Primary: JOS SASP "Mathematical Definition of the STFT" + Hann window
// (Harris 1978). Verifies:
//   - Hann window: w[0] = w[M-1] = 0, w[(M-1)/2] ≈ 1, symmetric
//   - Silent input → silent spectrum
//   - DC input → bin 0 peak = Σ w[n] (Hann window DC gain)
//   - Sine at bin 8 → spectrum peaks at k=8 (and N-8)
//   - Hop timing: FFT fires every `hop` samples after fill
//   - pow2 clamp; hop clamp; reset; determinism; defensive I/O

import { StftOp } from './op_stft.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new StftOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function driveAndCollectLast(op, inFill, totalN) {
  const inBuf = new Float32Array(totalN);
  for (let i = 0; i < totalN; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const outRe = new Float32Array(totalN);
  const outIm = new Float32Array(totalN);
  op.process({ in: inBuf }, { real: outRe, imag: outIm }, totalN);
  return { outRe, outIm };
}

// Hann window DC gain: Σ_{n=0..M-1} 0.5·(1 − cos(2πn/(M−1))).
function hannDcGain(M) {
  let s = 0;
  for (let n = 0; n < M; n++) s += 0.5 * (1 - Math.cos(2 * Math.PI * n / (M - 1)));
  return s;
}

const tests = [
  {
    name: 'Hann window: endpoints zero, centre one, symmetric',
    run() {
      const M = 64;
      const op = freshOp({ size: M });
      const w = op._hann;
      if (Math.abs(w[0]) > 1e-12) return { pass: false, why: `w[0]=${w[0]}` };
      if (Math.abs(w[M - 1]) > 1e-12) return { pass: false, why: `w[M-1]=${w[M-1]}` };
      // Centre of Hann at (M-1)/2 = 31.5 → w[31] and w[32] are both close to 1.
      if (w[31] < 0.99 || w[32] < 0.99) return { pass: false, why: `center low` };
      // Symmetry
      for (let n = 0; n < M / 2; n++) {
        if (Math.abs(w[n] - w[M - 1 - n]) > 1e-12)
          return { pass: false, why: `asym at n=${n}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent spectrum after first fire',
    run() {
      const M = 64;
      const op = freshOp({ size: M, hop: 16 });
      const { outRe, outIm } = driveAndCollectLast(op, 0, M * 2);
      for (let i = 0; i < M * 2; i++) {
        if (Math.abs(outRe[i]) > 1e-12 || Math.abs(outIm[i]) > 1e-12)
          return { pass: false, why: `non-silent at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'DC input → bin 0 peak = Σ w[n] (Hann DC gain)',
    run() {
      const M = 64;
      const op = freshOp({ size: M, hop: M });
      // Drive M samples of DC=1, then read bins over next M samples.
      const { outRe } = driveAndCollectLast(op, 1, M * 2);
      const expected = hannDcGain(M);
      const got = outRe[M];
      if (Math.abs(got - expected) > 1e-5) return { pass: false, why: `bin0=${got} exp=${expected}` };
      // Other bins should be small (Hann has low sidelobes for DC).
      for (let k = 2; k < M - 2; k++) {
        const mag = Math.hypot(outRe[M + k], 0);
        if (mag > 0.5) return { pass: false, why: `leak at k=${k}: ${mag}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'sine at bin 8 → spectrum peaks at k=8 and k=N−8',
    run() {
      const M = 64;
      const k = 8;
      const op = freshOp({ size: M, hop: M });
      const { outRe, outIm } = driveAndCollectLast(op, (i) => Math.sin(2 * Math.PI * k * i / M), M * 2);
      const magAt = (bin) => Math.hypot(outRe[M + bin], outIm[M + bin]);
      const m8    = magAt(k);
      const mM8   = magAt(M - k);
      // Bin k (and its mirror) must be the local max in lower/upper half.
      // Hann main-lobe is ~4 bins wide so immediate neighbours can be
      // ~half the peak — that's correct, not leakage.
      for (let b = 0; b < M / 2; b++) {
        if (b === k) continue;
        if (magAt(b) >= m8) return { pass: false, why: `bin ${b} (${magAt(b)}) exceeds peak at k=${k} (${m8})` };
      }
      if (Math.abs(m8 - mM8) > 1e-3) return { pass: false, why: `asymmetric peaks ${m8} vs ${mM8}` };
      return { pass: true };
    },
  },
  {
    name: 'hop timing: FFT fires every `hop` samples after fill',
    run() {
      // Drive step input and check that the spectrum re-emits bin 0
      // exactly every `hop` samples once the ring is full.
      const M = 32;
      const hop = 8;
      const op = freshOp({ size: M, hop });
      // Run 3M samples of DC=1 — after sample M, FFT fires; then every
      // `hop` samples. Count bin-0 emissions over the last 2M samples.
      const total = M * 4;
      const { outRe } = driveAndCollectLast(op, 1, total);
      // Every FFT fire resets readIdx=0 → next sample emits bin 0.
      // Look for samples where outRe[i] matches hannDcGain(M) closely.
      let fires = 0;
      const target = hannDcGain(M);
      for (let i = M; i < total; i++) {
        if (Math.abs(outRe[i] - target) < 1e-3) fires++;
      }
      // In samples [M..4M-1] we have 3M samples → (3M − some) / hop fires,
      // each emitting bin 0 exactly once. Roughly total/hop - 1 fires.
      const expected = Math.floor((total - M) / hop);
      if (Math.abs(fires - expected) > 1) return { pass: false, why: `fires=${fires} exp=${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'size param: non-pow2 snaps down; min/max clamp',
    run() {
      const op = freshOp({ size: 1000 });
      if (op._size !== 512) return { pass: false, why: `size=${op._size}` };
      op.setParam('size', 10);
      if (op._size !== 16) return { pass: false, why: `min ${op._size}` };
      op.setParam('size', 1 << 20);
      if (op._size !== 32768) return { pass: false, why: `max ${op._size}` };
      return { pass: true };
    },
  },
  {
    name: 'hop clamp: ≥1 and ≤size',
    run() {
      const op = freshOp({ size: 64, hop: 0 });
      if (op._hop !== 1) return { pass: false, why: `hop min ${op._hop}` };
      op.setParam('hop', 10000);
      if (op._hop !== 64) return { pass: false, why: `hop max ${op._hop}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears ring + spectrum',
    run() {
      const M = 64;
      const op = freshOp({ size: M, hop: 16 });
      const inBuf = new Float32Array(M * 2).fill(0.5);
      const outRe = new Float32Array(M * 2);
      const outIm = new Float32Array(M * 2);
      op.process({ in: inBuf }, { real: outRe, imag: outIm }, M * 2);
      op.reset();
      const out2Re = new Float32Array(16);
      const out2Im = new Float32Array(16);
      const zero = new Float32Array(16);
      op.process({ in: zero }, { real: out2Re, imag: out2Im }, 16);
      for (let i = 0; i < 16; i++)
        if (out2Re[i] !== 0 || out2Im[i] !== 0) return { pass: false, why: `post-reset i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent spectrum (no NaN)',
    run() {
      const M = 64;
      const op = freshOp({ size: M, hop: 32 });
      const outRe = new Float32Array(M * 2);
      const outIm = new Float32Array(M * 2);
      op.process({}, { real: outRe, imag: outIm }, M * 2);
      for (let i = 0; i < M * 2; i++) {
        if (!Number.isFinite(outRe[i]) || !Number.isFinite(outIm[i]))
          return { pass: false, why: `NaN at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output buffers → no-op (no crash)',
    run() {
      const op = freshOp({ size: 64 });
      const inBuf = new Float32Array(128).fill(0.1);
      op.process({ in: inBuf }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same input → identical spectra across instances',
    run() {
      const M = 128;
      const gen = (i) => Math.sin(i * 0.11) + 0.25 * Math.cos(i * 0.37);
      const a = driveAndCollectLast(freshOp({ size: M, hop: 32 }), gen, M * 2);
      const b = driveAndCollectLast(freshOp({ size: M, hop: 32 }), gen, M * 2);
      for (let i = 0; i < M * 2; i++) {
        if (a.outRe[i] !== b.outRe[i] || a.outIm[i] !== b.outIm[i])
          return { pass: false, why: `diverge ${i}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'stft', tests };
