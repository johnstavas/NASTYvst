// op_scaleBy.test.js — real-math tests for op_scaleBy.
// Run via: node scripts/check_op_math.mjs
//
// Tests cover: k=1 bit-exact bypass, k=0 mute, arbitrary k scales linearly,
// negative k flips polarity, setParam retune, reset no-op, defensive null,
// NaN/∞ k falls to unity, determinism.

import { ScaleByOp } from './op_scaleBy.worklet.js';

const SR  = 48000;
const N   = 128;
const EPS = 1e-9;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new ScaleByOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inFill, n = N) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

const tests = [
  // ---- bypass contract (k=1) -----------------------------------------
  {
    name: 'k=1: bit-exact passthrough (bypass contract)',
    run() {
      const op = freshOp({ k: 1 });
      const { inBuf, out } = drive(op, i => Math.sin(2 * Math.PI * 440 * i / SR));
      for (let i = 0; i < N; i++) {
        if (out[i] !== inBuf[i]) return { pass: false, why: `i=${i}: ${out[i]} vs ${inBuf[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- mute (k=0) ----------------------------------------------------
  {
    name: 'k=0: output is all zero',
    run() {
      const op = freshOp({ k: 0 });
      const { out } = drive(op, i => Math.sin(i * 0.1));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- arbitrary k ---------------------------------------------------
  {
    name: 'k=2.5: output = 2.5 · input',
    run() {
      const op = freshOp({ k: 2.5 });
      const { inBuf, out } = drive(op, i => Math.sin(i * 0.1));
      for (let i = 0; i < N; i++) {
        const expected = Math.fround(2.5 * inBuf[i]);  // float32 round
        if (Math.abs(out[i] - expected) > 1e-6) return { pass: false, why: `i=${i}: ${out[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'k=0.5: halves amplitude',
    run() {
      const op = freshOp({ k: 0.5 });
      const { out } = drive(op, 0.8, 16);
      for (let i = 0; i < 16; i++) {
        if (!approx(out[i], 0.4, 1e-6)) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- polarity flip -------------------------------------------------
  {
    name: 'k=-1: pure polarity flip (out = -in)',
    run() {
      const op = freshOp({ k: -1 });
      const { inBuf, out } = drive(op, i => Math.sin(i * 0.1));
      for (let i = 0; i < N; i++) {
        if (!approx(out[i], -inBuf[i], 1e-7)) return { pass: false, why: `i=${i}: ${out[i]} vs ${-inBuf[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'k=-2: flips polarity and doubles',
    run() {
      const op = freshOp({ k: -2 });
      const { out } = drive(op, 0.3, 8);
      for (let i = 0; i < 8; i++) {
        if (!approx(out[i], -0.6, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- linearity -----------------------------------------------------
  {
    name: 'linear: doubling input doubles output at any k',
    run() {
      for (const k of [0.7, -1.3, 3.14]) {
        const op = freshOp({ k });
        const { out: a } = drive(op, 0.25, 1);
        const { out: b } = drive(op, 0.5,  1);
        if (!approx(b[0], 2 * a[0], 1e-6)) return { pass: false, why: `k=${k}: ${b[0]} vs ${2 * a[0]}` };
      }
      return { pass: true };
    },
  },

  // ---- setParam retune -----------------------------------------------
  {
    name: 'setParam(k) takes effect on subsequent samples',
    run() {
      const op = freshOp({ k: 1 });
      const X = 0.25;
      const { out: a } = drive(op, X, 1);
      if (a[0] !== X) return { pass: false, why: `bypass broken: ${a[0]}` };
      op.setParam('k', 3);
      const { out: b } = drive(op, X, 1);
      if (!approx(b[0], 0.75, 1e-6)) return { pass: false, why: `${b[0]}` };
      op.setParam('k', 0);
      const { out: c } = drive(op, X, 1);
      if (c[0] !== 0) return { pass: false, why: `${c[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive k values --------------------------------------------
  {
    name: 'NaN k falls to unity (bypass)',
    run() {
      const op = freshOp({ k: NaN });
      const X = 0.25;
      const { out } = drive(op, X, 1);
      if (out[0] !== X) return { pass: false, why: `${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'Infinity k falls to unity (bypass)',
    run() {
      const op = freshOp({ k: Infinity });
      const X = 0.25;
      const { out } = drive(op, X, 1);
      if (out[0] !== X) return { pass: false, why: `${out[0]}` };
      return { pass: true };
    },
  },

  // ---- stateless / reset --------------------------------------------
  {
    name: 'reset() is no-op (stateless)',
    run() {
      const op = freshOp({ k: 2 });
      drive(op, 0.9, N);
      op.reset();
      const ref = freshOp({ k: 2 });
      const { out: a } = drive(op,  0.3, 1);
      const { out: b } = drive(ref, 0.3, 1);
      if (a[0] !== b[0]) return { pass: false, why: `${a[0]} vs ${b[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive -----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ k: 2 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- determinism ---------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = drive(freshOp({ k: 1.7 }), i => Math.sin(i * 0.01), 1024).out;
      const b = drive(freshOp({ k: 1.7 }), i => Math.sin(i * 0.01), 1024).out;
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'scaleBy', tests };
