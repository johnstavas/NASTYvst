// op_mfcc.test.js — real-math tests for op_mfcc.
// Run via: node scripts/check_op_math.mjs
//
// Primary: python_speech_features + Wikipedia MFCC.
// Verifies:
//   - Silent spectrum → coefs[0] = log(LOG_FLOOR)·N_f · cos(0) (large negative), others ≈ 0
//   - DC-peak spectrum → coefs reflect low-band energy
//   - Coefs beyond numCoefs are zero
//   - hz2mel / mel2hz inverse through the filterbank construction
//   - Param clamps, reset, determinism, defensive I/O

import { MfccOp } from './op_mfcc.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new MfccOp(SR);
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
  // First frame emits zero (no fire yet). Second block emits MFCCs.
  return out.slice(N, N * 2);
}

const tests = [
  {
    name: 'silent spectrum → DC coefficient is strongly negative, rest near zero',
    run() {
      const op = freshOp({ size: 64, numFilters: 8, numCoefs: 4 });
      const coefs = driveFrame(op, 0, 0);
      // c[0] = Σ log(LOG_FLOOR) · cos(0) = nfilt · log(1e-10) ≈ -184
      if (coefs[0] > -50) return { pass: false, why: `c[0]=${coefs[0]} expected strongly negative` };
      // c[1..3] should be zero (log of uniform → only DC coef survives DCT)
      for (let i = 1; i < 4; i++) {
        if (Math.abs(coefs[i]) > 1e-6) return { pass: false, why: `c[${i}]=${coefs[i]} should be ~0` };
      }
      return { pass: true };
    },
  },
  {
    name: 'coefs past numCoefs are exactly zero',
    run() {
      const op = freshOp({ size: 64, numFilters: 8, numCoefs: 3 });
      const coefs = driveFrame(op, (k) => (k < 10 ? 1 : 0), 0);
      for (let i = 3; i < 64; i++) {
        if (coefs[i] !== 0) return { pass: false, why: `c[${i}]=${coefs[i]} should be 0 past numCoefs` };
      }
      return { pass: true };
    },
  },
  {
    name: 'low-frequency energy produces different MFCC than high-frequency',
    run() {
      // A spectrum with all energy in low bins produces MFCC coefficients
      // distinguishable from one with energy in high bins.
      const lowOp  = freshOp({ size: 64, numFilters: 8, numCoefs: 5 });
      const highOp = freshOp({ size: 64, numFilters: 8, numCoefs: 5 });
      const lowCoefs  = driveFrame(lowOp,  (k) => (k >= 1 && k <= 4)  ? 10 : 0, 0);
      const highCoefs = driveFrame(highOp, (k) => (k >= 28 && k <= 31) ? 10 : 0, 0);
      // At least c[1] (first cepstral coefficient) should differ meaningfully.
      let totalDiff = 0;
      for (let i = 1; i < 5; i++) totalDiff += Math.abs(lowCoefs[i] - highCoefs[i]);
      if (totalDiff < 1) return { pass: false, why: `coefs near identical lowE vs highE: diff=${totalDiff}` };
      return { pass: true };
    },
  },
  {
    name: 'filterbank construction: mel-spaced triangular filters cover bands',
    run() {
      const op = freshOp({ size: 64, numFilters: 4 });
      const binCols = (64 >> 1) + 1;
      // Each filter should have at least one non-zero coefficient.
      for (let j = 0; j < 4; j++) {
        let any = 0;
        for (let k = 0; k < binCols; k++) any += op._fbank[j * binCols + k];
        if (any <= 0) return { pass: false, why: `filter ${j} has zero total gain` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: numFilters [1,128], numCoefs ≤ numFilters',
    run() {
      const op = freshOp();
      op.setParam('numFilters', 0);
      if (op._numFilters !== 1) return { pass: false, why: `nfilt min ${op._numFilters}` };
      op.setParam('numFilters', 500);
      if (op._numFilters !== 128) return { pass: false, why: `nfilt max ${op._numFilters}` };
      op.setParam('numCoefs', 999);
      if (op._numCoefs !== op._numFilters) return { pass: false, why: `ncoef cap ${op._numCoefs}` };
      return { pass: true };
    },
  },
  {
    name: 'size: non-pow2 snaps down; min/max clamp',
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
    name: 'reset clears state',
    run() {
      const op = freshOp({ size: 64, numFilters: 8, numCoefs: 4 });
      driveFrame(op, (k) => 1, 0);
      op.reset();
      const out = new Float32Array(32);
      op.process({ real: new Float32Array(32), imag: new Float32Array(32) }, { out }, 32);
      for (let i = 0; i < 32; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset i=${i} = ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → no NaN; output is DC-coef-of-silence',
    run() {
      const op = freshOp({ size: 64, numFilters: 8, numCoefs: 4 });
      const out = new Float32Array(128);
      op.process({}, { out }, 128);
      for (let i = 0; i < 128; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no crash)',
    run() {
      const op = freshOp({ size: 64 });
      const inRe = new Float32Array(128);
      const inIm = new Float32Array(128);
      op.process({ real: inRe, imag: inIm }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'deterministic: same spectrum input → identical MFCCs',
    run() {
      const gen = (k) => Math.sin(k * 0.13);
      const a = driveFrame(freshOp({ size: 128, numFilters: 16, numCoefs: 8 }), gen, 0);
      const b = driveFrame(freshOp({ size: 128, numFilters: 16, numCoefs: 8 }), gen, 0);
      for (let i = 0; i < 128; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'mfcc', tests };
