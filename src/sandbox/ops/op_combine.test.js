// op_combine.test.js — real-math tests for op_combine.
// Run via: node scripts/check_op_math.mjs

import { CombineOp } from './op_combine.worklet.js';

const SR  = 48000;
const N   = 32;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new CombineOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, aFill, bFill) {
  const a = aFill == null ? null : new Float32Array(N);
  const b = bFill == null ? null : new Float32Array(N);
  if (a) for (let i = 0; i < N; i++) a[i] = typeof aFill === 'function' ? aFill(i) : aFill;
  if (b) for (let i = 0; i < N; i++) b[i] = typeof bFill === 'function' ? bFill(i) : bFill;
  const out = new Float32Array(N);
  const inputs = {};
  if (a) inputs.a = a;
  if (b) inputs.b = b;
  op.process(inputs, { out }, N);
  return { a, b, out };
}

const tests = [
  // ---- mul -----------------------------------------------------------
  {
    name: 'mul: out[i] = a[i] · b[i] (commutative)',
    run() {
      const op = freshOp({ mode: 'mul' });
      const { out } = drive(op, i => 0.3 + i * 0.01, () => 0.5);
      for (let i = 0; i < N; i++) {
        const expected = Math.fround((0.3 + i * 0.01) * 0.5);
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'mul: missing b → passthrough a (identity=1)',
    run() {
      const op = freshOp({ mode: 'mul' });
      const { out } = drive(op, i => 0.7, null);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.7, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- add -----------------------------------------------------------
  {
    name: 'add: out[i] = a[i] + b[i]',
    run() {
      const op = freshOp({ mode: 'add' });
      const { out } = drive(op, 0.3, 0.4);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.7, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]} expected 0.7` };
      return { pass: true };
    },
  },
  {
    name: 'add: missing a → b passthrough (identity=0)',
    run() {
      const op = freshOp({ mode: 'add' });
      const { out } = drive(op, null, 0.6);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.6, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- max / min -----------------------------------------------------
  {
    name: 'max: out = max(a, b)',
    run() {
      const op = freshOp({ mode: 'max' });
      const { out } = drive(op, i => (i % 2 === 0 ? 0.3 : 0.8), i => (i % 2 === 0 ? 0.7 : 0.2));
      for (let i = 0; i < N; i++) {
        const expected = i % 2 === 0 ? 0.7 : 0.8;
        if (!approx(out[i], expected, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'min: out = min(a, b)',
    run() {
      const op = freshOp({ mode: 'min' });
      const { out } = drive(op, 0.3, 0.8);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.3, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- weighted ------------------------------------------------------
  {
    name: 'weighted w=0 → all a',
    run() {
      const op = freshOp({ mode: 'weighted', weight: 0 });
      const { out } = drive(op, 0.4, 0.9);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.4, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'weighted w=1 → all b',
    run() {
      const op = freshOp({ mode: 'weighted', weight: 1 });
      const { out } = drive(op, 0.4, 0.9);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.9, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'weighted w=0.5 → midpoint',
    run() {
      const op = freshOp({ mode: 'weighted', weight: 0.5 });
      const { out } = drive(op, 0.2, 0.8);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.5, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'weighted: missing b → a passthrough (not dimmed)',
    run() {
      const op = freshOp({ mode: 'weighted', weight: 0.5 });
      const { out } = drive(op, 0.6, null);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.6, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- lastWins ------------------------------------------------------
  {
    name: 'lastWins: b overrides a when wired',
    run() {
      const op = freshOp({ mode: 'lastWins' });
      const { out } = drive(op, 0.3, 0.9);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.9, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'lastWins: missing b → a passthrough',
    run() {
      const op = freshOp({ mode: 'lastWins' });
      const { out } = drive(op, 0.3, null);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.3, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- both unwired --------------------------------------------------
  {
    name: 'both unwired → all-zero output (all modes)',
    run() {
      for (const m of ['mul', 'add', 'max', 'min', 'weighted', 'lastWins']) {
        const op = freshOp({ mode: m });
        const { out } = drive(op, null, null);
        for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `${m}: out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- weight clamp --------------------------------------------------
  {
    name: 'weight clamped to [0,1]',
    run() {
      const op = freshOp({ mode: 'weighted', weight: 2.5 });
      const { out } = drive(op, 0.1, 0.9);
      for (let i = 0; i < N; i++) if (!approx(out[i], 0.9, 1e-6)) return { pass: false, why: `clamp-high: ${out[i]}` };
      op.setParam('weight', -1);
      const { out: out2 } = drive(op, 0.1, 0.9);
      for (let i = 0; i < N; i++) if (!approx(out2[i], 0.1, 1e-6)) return { pass: false, why: `clamp-low: ${out2[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'combine', tests };
