// op_mix.test.js — real-math tests for op_mix.
// Run via: node scripts/check_op_math.mjs
//
// Equal-power dry/wet crossfade per dry_wet_mix_rule.md (NON-NEGOTIABLE):
//   dry = cos(amount · π/2), wet = sin(amount · π/2)
// Tests cover: amount=0 → all dry, amount=1 → all wet, amount=0.5 → -3 dB
// (both gains = 1/√2), equal-power invariance (sum of squares = 1),
// passthrough with one side unwired, both unwired → zero, and polarity.

import { MixOp } from './op_mix.worklet.js';

const SR  = 48000;
const N   = 32;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new MixOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, dryFill, wetFill) {
  const dry = dryFill == null ? null : new Float32Array(N);
  const wet = wetFill == null ? null : new Float32Array(N);
  if (dry) for (let i = 0; i < N; i++) dry[i] = typeof dryFill === 'function' ? dryFill(i) : dryFill;
  if (wet) for (let i = 0; i < N; i++) wet[i] = typeof wetFill === 'function' ? wetFill(i) : wetFill;
  const out = new Float32Array(N);
  const inputs = {};
  if (dry) inputs.dry = dry;
  if (wet) inputs.wet = wet;
  op.process(inputs, { out }, N);
  return out;
}

const tests = [
  {
    name: 'amount=0 → 100% dry (cos(0)=1, sin(0)=0)',
    run() {
      const op = freshOp({ amount: 0 });
      const out = drive(op, 0.5, 0.9);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.5, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'amount=1 → 100% wet (cos(π/2)=0, sin(π/2)=1)',
    run() {
      const op = freshOp({ amount: 1 });
      const out = drive(op, 0.5, 0.9);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.9, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'amount=0.5 → both gains = 1/√2 (−3 dB)',
    run() {
      const op = freshOp({ amount: 0.5 });
      const out = drive(op, 1, 1);
      const expected = (1 / Math.sqrt(2)) * 2;  // = √2
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'equal-power invariance: dryG² + wetG² = 1 across sweep',
    run() {
      const op = freshOp();
      for (let a = 0; a <= 1; a += 0.05) {
        op.setParam('amount', a);
        // Drive dry=1, wet=0 → out = dryG. Then dry=0, wet=1 → out = wetG.
        const outDry = drive(op, 1, 0)[0];
        const outWet = drive(op, 0, 1)[0];
        const sumSq = outDry * outDry + outWet * outWet;
        if (!approx(sumSq, 1, 1e-5)) return { pass: false, why: `a=${a.toFixed(2)} sum²=${sumSq}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing wet → scaled dry (not zero)',
    run() {
      const op = freshOp({ amount: 0.5 });
      const out = drive(op, 1, null);
      const expected = Math.cos(0.5 * Math.PI * 0.5);  // = 1/√2
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing dry → scaled wet (not zero)',
    run() {
      const op = freshOp({ amount: 0.5 });
      const out = drive(op, null, 1);
      const expected = Math.sin(0.5 * Math.PI * 0.5);  // = 1/√2
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'both unwired → zero output',
    run() {
      const op = freshOp({ amount: 0.5 });
      const out = drive(op, null, null);
      for (let i = 0; i < N; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'linearity: scaling dry scales output proportionally',
    run() {
      const op = freshOp({ amount: 0.3 });
      const a = drive(op, 0.5, 0.5);
      const b = drive(op, 1.0, 1.0);
      for (let i = 0; i < N; i++)
        if (!approx(b[i], a[i] * 2, 1e-5)) return { pass: false, why: `b[${i}]=${b[i]} a*2=${a[i] * 2}` };
      return { pass: true };
    },
  },
  {
    name: 'polarity preserved: negative inputs produce negative output',
    run() {
      const op = freshOp({ amount: 0.5 });
      const out = drive(op, -0.5, -0.3);
      for (let i = 0; i < N; i++)
        if (out[i] >= 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'setParam(amount) takes effect immediately',
    run() {
      const op = freshOp({ amount: 0 });
      const a = drive(op, 0, 1);  // wet gain = 0, output 0
      if (!approx(a[0], 0, 1e-6)) return { pass: false, why: `initial ${a[0]}` };
      op.setParam('amount', 1);
      const b = drive(op, 0, 1);  // wet gain = 1, output 1
      if (!approx(b[0], 1, 1e-6)) return { pass: false, why: `after switch ${b[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() is no-op for stateless mix',
    run() {
      const op = freshOp({ amount: 0.5 });
      drive(op, 1, 1);
      op.reset();
      const out = drive(op, 1, 1);
      const expected = Math.sqrt(2);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'mix', tests };
