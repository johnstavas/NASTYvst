// op_fft.test.js — real-math tests for op_fft.
// Run via: node scripts/check_op_math.mjs
//
// Primary: Cooley-Tukey iterative radix-2 (Wikipedia / Cormen Ch. 30).
// Verifies:
//   - DC input → bin 0 = N · amplitude, other bins ≈ 0
//   - Pure sine at bin-exact frequency → energy concentrates at ±k
//   - Parseval: Σ|x|² ≈ (1/N) Σ|X|²
//   - Impulse → flat spectrum (|X[k]| = 1 for all k)
//   - Output buffers zero until first FFT completes
//   - size param clamped to pow2; reset; determinism; null-input safe

import { FftOp } from './op_fft.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new FftOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

// Run op, collect the first full spectrum into re[]+im[] arrays.
function runAndCollect(op, inFill, size) {
  const totalN = size * 2; // one full fill + one emit cycle
  const inBuf = new Float32Array(totalN);
  for (let i = 0; i < totalN; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const outRe = new Float32Array(totalN);
  const outIm = new Float32Array(totalN);
  op.process({ in: inBuf }, { real: outRe, imag: outIm }, totalN);
  // After writing `size` samples, FFT fires → readIdx resets to 0.
  // So samples [size .. size+size-1] emit bins [0 .. size-1] in order.
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let k = 0; k < size; k++) { re[k] = outRe[size + k]; im[k] = outIm[size + k]; }
  return { re, im };
}

const tests = [
  {
    name: 'DC input (x=1) → bin 0 = N, other bins ≈ 0',
    run() {
      const N = 64;
      const op = freshOp({ size: N });
      const { re, im } = runAndCollect(op, 1, N);
      if (Math.abs(re[0] - N) > 1e-6) return { pass: false, why: `re[0]=${re[0]}` };
      if (Math.abs(im[0]) > 1e-6) return { pass: false, why: `im[0]=${im[0]}` };
      for (let k = 1; k < N; k++) {
        if (Math.abs(re[k]) > 1e-4 || Math.abs(im[k]) > 1e-4)
          return { pass: false, why: `k=${k}: re=${re[k]} im=${im[k]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse input → flat magnitude spectrum (|X[k]| = 1)',
    run() {
      const N = 64;
      const op = freshOp({ size: N });
      const { re, im } = runAndCollect(op, (i) => (i === 0 ? 1 : 0), N);
      for (let k = 0; k < N; k++) {
        const mag = Math.hypot(re[k], im[k]);
        if (Math.abs(mag - 1) > 1e-4) return { pass: false, why: `k=${k}: |X|=${mag}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pure sine at bin 4 → energy concentrates at k=4 and k=N-4',
    run() {
      const N = 64;
      const binK = 4;
      const op = freshOp({ size: N });
      const { re, im } = runAndCollect(op, (i) => Math.sin(2 * Math.PI * binK * i / N), N);
      const magAtK   = Math.hypot(re[binK],     im[binK]);
      const magAtMK  = Math.hypot(re[N - binK], im[N - binK]);
      const expected = N / 2;
      if (Math.abs(magAtK - expected) > 0.5)
        return { pass: false, why: `|X[${binK}]|=${magAtK}, expected ~${expected}` };
      if (Math.abs(magAtMK - expected) > 0.5)
        return { pass: false, why: `|X[${N-binK}]|=${magAtMK}` };
      // Other bins should be small.
      for (let k = 0; k < N; k++) {
        if (k === binK || k === N - binK) continue;
        const mag = Math.hypot(re[k], im[k]);
        if (mag > 0.5) return { pass: false, why: `leak at k=${k}: |X|=${mag}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Parseval: input energy ≈ spectrum energy / N',
    run() {
      const N = 128;
      const op = freshOp({ size: N });
      const phi = 0.37;
      let eIn = 0;
      for (let i = 0; i < N; i++) {
        const x = Math.sin(2 * Math.PI * 7 * i / N + phi) + 0.3 * Math.cos(2 * Math.PI * 19 * i / N);
        eIn += x * x;
      }
      const { re, im } = runAndCollect(op, (i) =>
        Math.sin(2 * Math.PI * 7 * i / N + phi) + 0.3 * Math.cos(2 * Math.PI * 19 * i / N), N);
      let eOut = 0;
      for (let k = 0; k < N; k++) eOut += re[k] * re[k] + im[k] * im[k];
      const ratio = eOut / (N * eIn);
      if (Math.abs(ratio - 1) > 1e-3) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },
  {
    name: 'output is silent (zero) before first FFT completes',
    run() {
      const N = 64;
      const op = freshOp({ size: N });
      const inBuf = new Float32Array(N - 1).fill(1);
      const outRe = new Float32Array(N - 1);
      const outIm = new Float32Array(N - 1);
      op.process({ in: inBuf }, { real: outRe, imag: outIm }, N - 1);
      for (let i = 0; i < N - 1; i++)
        if (outRe[i] !== 0 || outIm[i] !== 0)
          return { pass: false, why: `out[${i}] re=${outRe[i]} im=${outIm[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'size param clamped: non-pow2 snaps down to pow2',
    run() {
      const op = freshOp({ size: 1000 }); // snap → 512
      if (op._size !== 512) return { pass: false, why: `size=${op._size}` };
      op.setParam('size', 10); // below min → clamp to 16
      if (op._size !== 16) return { pass: false, why: `min clamp ${op._size}` };
      op.setParam('size', 1 << 20); // above max → clamp to 32768
      if (op._size !== 32768) return { pass: false, why: `max clamp ${op._size}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears buffers and indices',
    run() {
      const N = 64;
      const op = freshOp({ size: N });
      const inBuf = new Float32Array(N + 32).fill(0.5);
      const outRe = new Float32Array(N + 32);
      const outIm = new Float32Array(N + 32);
      op.process({ in: inBuf }, { real: outRe, imag: outIm }, N + 32);
      op.reset();
      const out2Re = new Float32Array(16);
      const out2Im = new Float32Array(16);
      const zero = new Float32Array(16);
      op.process({ in: zero }, { real: out2Re, imag: out2Im }, 16);
      for (let i = 0; i < 16; i++)
        if (out2Re[i] !== 0 || out2Im[i] !== 0)
          return { pass: false, why: `post-reset out[${i}]` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → zero output (no NaN)',
    run() {
      const N = 64;
      const op = freshOp({ size: N });
      const outRe = new Float32Array(N * 2);
      const outIm = new Float32Array(N * 2);
      op.process({}, { real: outRe, imag: outIm }, N * 2);
      for (let i = 0; i < N * 2; i++) {
        if (!Number.isFinite(outRe[i]) || !Number.isFinite(outIm[i]))
          return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(outRe[i]) > 1e-6 || Math.abs(outIm[i]) > 1e-6)
          return { pass: false, why: `non-zero out[${i}]` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output buffers is a no-op (no crash)',
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
      const N = 128;
      const gen = (i) => Math.sin(i * 0.071) + 0.2 * Math.cos(i * 0.31);
      const a = runAndCollect(freshOp({ size: N }), gen, N);
      const b = runAndCollect(freshOp({ size: N }), gen, N);
      for (let k = 0; k < N; k++) {
        if (a.re[k] !== b.re[k] || a.im[k] !== b.im[k])
          return { pass: false, why: `diverge at ${k}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Hermitian symmetry: X[N-k] = conj(X[k]) for real input',
    run() {
      const N = 64;
      const { re, im } = runAndCollect(freshOp({ size: N }),
        (i) => Math.sin(2 * Math.PI * 3 * i / N) + 0.5 * Math.cos(2 * Math.PI * 11 * i / N), N);
      for (let k = 1; k < N / 2; k++) {
        if (Math.abs(re[k] - re[N - k]) > 1e-3) return { pass: false, why: `re mismatch k=${k}` };
        if (Math.abs(im[k] + im[N - k]) > 1e-3) return { pass: false, why: `im mismatch k=${k}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'fft', tests };
