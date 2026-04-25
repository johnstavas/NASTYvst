// op_chromagram.test.js — real-math tests for op_chromagram.
// Run via: node scripts/check_op_math.mjs
//
// Primary reference: librosa chroma_stft + filters.chroma.
// Verifies:
//   - Silent spectrum → all-zero chroma (no NaN from 0/0 normalize)
//   - Peak at A4 (440 Hz) bin → bin 9 dominant (C-based) / bin 0 (A-based)
//   - Peak at C4 (261.63 Hz) bin → bin 0 dominant (C-based)
//   - Chroma past nChroma is exactly zero
//   - L∞ normalization: max(|coefs|) == 1 on any non-silent frame
//   - Reset / defensive I/O / determinism / param clamps

import { ChromagramOp } from './op_chromagram.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new ChromagramOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function driveFrame(op, specRe, specIm) {
  const N = op._size;
  const inRe = new Float32Array(N * 2);
  const inIm = new Float32Array(N * 2);
  for (let k = 0; k < N; k++) {
    inRe[k] = typeof specRe === 'function' ? specRe(k) : specRe;
    inIm[k] = typeof specIm === 'function' ? specIm(k) : specIm;
  }
  const out = new Float32Array(N * 2);
  op.process({ real: inRe, imag: inIm }, { out }, N * 2);
  return out.slice(N, N * 2);
}

function peakBin(freqHz, size) {
  return Math.round(freqHz * size / SR);
}

const tests = [
  {
    name: 'silent spectrum → all-zero chroma (no NaN)',
    run() {
      const op = freshOp({ size: 512, nChroma: 12 });
      const c = driveFrame(op, 0, 0);
      for (let i = 0; i < 12; i++) {
        if (!Number.isFinite(c[i])) return { pass: false, why: `NaN at ${i}` };
        if (c[i] !== 0) return { pass: false, why: `c[${i}]=${c[i]} should be 0` };
      }
      return { pass: true };
    },
  },
  {
    name: 'A4 (440 Hz) dominant → bin 9 (C-based) is max',
    run() {
      const op = freshOp({ size: 4096, nChroma: 12, baseC: 1 });
      const k0 = peakBin(440, 4096);
      const c  = driveFrame(op, (k) => (k === k0 ? 10 : 0), 0);
      // find argmax over first 12 bins
      let arg = -1, mx = -Infinity;
      for (let i = 0; i < 12; i++) if (c[i] > mx) { mx = c[i]; arg = i; }
      if (arg !== 9) return { pass: false, why: `argmax=${arg}, expected 9 (A); chroma=[${Array.from(c.slice(0,12)).map(x=>x.toFixed(3)).join(',')}]` };
      return { pass: true };
    },
  },
  {
    name: 'A4 dominant, base_c=false → bin 0 (A) is max',
    run() {
      const op = freshOp({ size: 4096, nChroma: 12, baseC: 0 });
      const k0 = peakBin(440, 4096);
      const c  = driveFrame(op, (k) => (k === k0 ? 10 : 0), 0);
      let arg = -1, mx = -Infinity;
      for (let i = 0; i < 12; i++) if (c[i] > mx) { mx = c[i]; arg = i; }
      if (arg !== 0) return { pass: false, why: `argmax=${arg}, expected 0 (A); chroma=[${Array.from(c.slice(0,12)).map(x=>x.toFixed(3)).join(',')}]` };
      return { pass: true };
    },
  },
  {
    name: 'C4 (261.63 Hz) dominant → bin 0 (C-based) is max',
    run() {
      const op = freshOp({ size: 8192, nChroma: 12, baseC: 1 });
      const k0 = peakBin(261.63, 8192);
      const c  = driveFrame(op, (k) => (k === k0 ? 10 : 0), 0);
      let arg = -1, mx = -Infinity;
      for (let i = 0; i < 12; i++) if (c[i] > mx) { mx = c[i]; arg = i; }
      if (arg !== 0) return { pass: false, why: `argmax=${arg}, expected 0 (C)` };
      return { pass: true };
    },
  },
  {
    name: 'coefs past nChroma are exactly zero',
    run() {
      const op = freshOp({ size: 512, nChroma: 12 });
      const c = driveFrame(op, (k) => (k < 20 ? 1 : 0), 0);
      for (let i = 12; i < 64; i++) {
        if (c[i] !== 0) return { pass: false, why: `c[${i}]=${c[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'L∞ normalization: max |c| == 1 on non-silent frame',
    run() {
      const op = freshOp({ size: 2048, nChroma: 12 });
      const c  = driveFrame(op, (k) => (k >= 10 && k <= 40 ? 5 : 0), 0);
      let mx = 0;
      for (let i = 0; i < 12; i++) if (Math.abs(c[i]) > mx) mx = Math.abs(c[i]);
      if (Math.abs(mx - 1) > 1e-5) return { pass: false, why: `max=${mx}, expected 1` };
      return { pass: true };
    },
  },
  {
    name: 'octaves fold to same pitch class — 440 & 880 Hz produce same argmax',
    run() {
      const op1 = freshOp({ size: 8192, nChroma: 12, baseC: 1 });
      const op2 = freshOp({ size: 8192, nChroma: 12, baseC: 1 });
      const c1 = driveFrame(op1, (k) => k === peakBin(440, 8192) ? 10 : 0, 0);
      const c2 = driveFrame(op2, (k) => k === peakBin(880, 8192) ? 10 : 0, 0);
      let a1 = 0, a2 = 0, m1 = -Infinity, m2 = -Infinity;
      for (let i = 0; i < 12; i++) {
        if (c1[i] > m1) { m1 = c1[i]; a1 = i; }
        if (c2[i] > m2) { m2 = c2[i]; a2 = i; }
      }
      if (a1 !== a2) return { pass: false, why: `440→${a1}, 880→${a2}; should match` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: nChroma [3,64]',
    run() {
      const op = freshOp();
      op.setParam('nChroma', 1);
      if (op._nChroma !== 3) return { pass: false, why: `min: ${op._nChroma}` };
      op.setParam('nChroma', 999);
      if (op._nChroma !== 64) return { pass: false, why: `max: ${op._nChroma}` };
      return { pass: true };
    },
  },
  {
    name: 'size snap to pow2 + clamp [16, 32768]',
    run() {
      const op = freshOp({ size: 1000 });
      if (op._size !== 512) return { pass: false, why: `snap: ${op._size}` };
      op.setParam('size', 10);
      if (op._size !== 16) return { pass: false, why: `min: ${op._size}` };
      op.setParam('size', 1 << 20);
      if (op._size !== 32768) return { pass: false, why: `max: ${op._size}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ size: 256, nChroma: 12 });
      driveFrame(op, (k) => 1, 0);
      op.reset();
      const out = new Float32Array(64);
      op.process({ real: new Float32Array(64), imag: new Float32Array(64) }, { out }, 64);
      for (let i = 0; i < 64; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset i=${i}=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: same spectrum → identical chroma',
    run() {
      const gen = (k) => Math.sin(k * 0.17);
      const a = driveFrame(freshOp({ size: 512, nChroma: 12 }), gen, 0);
      const b = driveFrame(freshOp({ size: 512, nChroma: 12 }), gen, 0);
      for (let i = 0; i < 12; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → no NaN, no crash',
    run() {
      const op = freshOp({ size: 256 });
      const out = new Float32Array(512);
      op.process({}, { out }, 512);
      for (let i = 0; i < 512; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp({ size: 256 });
      op.process({ real: new Float32Array(256), imag: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
];

export default { opId: 'chromagram', tests };
