// op_detector.test.js — real-math tests for op_detector.
// Run via: node scripts/check_op_math.mjs
//
// Per Canon:dynamics §1 + Zölzer DAFX §4.4, the detector is a pure
// rectifier. "peak" = |x|. "rms" = x² (power domain — sqrt lives downstream
// so this op stays stateless and branch-free).

import { DetectorOp } from './op_detector.worklet.js';

const SR  = 48000;
const N   = 64;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DetectorOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inFill) {
  const inBuf = new Float32Array(N);
  for (let i = 0; i < N; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(N);
  op.process({ in: inBuf }, { det: out }, N);
  return { inBuf, out };
}

const tests = [
  // ---- peak mode (|x|) ----------------------------------------------
  {
    name: 'peak: positive input passes through unchanged',
    run() {
      const op = freshOp({ mode: 'peak' });
      const { out } = drive(op, i => 0.1 * (i + 1));
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.1 * (i + 1), 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'peak: negative input → absolute value',
    run() {
      const op = freshOp({ mode: 'peak' });
      const { out } = drive(op, -0.5);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.5, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'peak: sign-alternating input → constant magnitude',
    run() {
      const op = freshOp({ mode: 'peak' });
      const { out } = drive(op, i => (i % 2 === 0 ? 0.7 : -0.7));
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.7, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'peak: zero input → zero output',
    run() {
      const op = freshOp({ mode: 'peak' });
      const { out } = drive(op, 0);
      for (let i = 0; i < N; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- rms mode (x²) ------------------------------------------------
  {
    name: 'rms: square of input (power-domain)',
    run() {
      const op = freshOp({ mode: 'rms' });
      const { out } = drive(op, 0.5);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.25, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'rms: negative input squared → positive',
    run() {
      const op = freshOp({ mode: 'rms' });
      const { out } = drive(op, -0.3);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.09, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'rms: always non-negative',
    run() {
      const op = freshOp({ mode: 'rms' });
      const { out } = drive(op, i => (i % 2 === 0 ? 0.4 : -0.8));
      for (let i = 0; i < N; i++)
        if (out[i] < 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- mode switching -----------------------------------------------
  {
    name: 'mode switch: peak → rms at runtime',
    run() {
      const op = freshOp({ mode: 'peak' });
      let { out } = drive(op, 0.5);
      if (!approx(out[0], 0.5, 1e-6)) return { pass: false, why: `peak fail` };
      op.setParam('mode', 'rms');
      ({ out } = drive(op, 0.5));
      if (!approx(out[0], 0.25, 1e-6)) return { pass: false, why: `rms fail: ${out[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ mode: 'peak' });
      const out = new Float32Array(N);
      op.process({}, { det: out }, N);
      for (let i = 0; i < N; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() is no-op for stateless detector',
    run() {
      const op = freshOp({ mode: 'peak' });
      drive(op, -0.5);
      op.reset();
      const { out } = drive(op, -0.5);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.5, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'detector', tests };
