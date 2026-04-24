// op_envelope.test.js — real-math tests for op_envelope.
// Run via: node scripts/check_op_math.mjs
//
// Canon:dynamics §1 (Bram) + Zölzer DAFX §4.4 — asymmetric AR follower with
// Jon Watte denormal bias. Tests cover: attack reaches ~(1−1/e) at n=τ·sr,
// release decays with release tau, amount/offset shaping, stateless on
// silence with offset DC bias, reset, amount inversion polarity.

import { EnvelopeOp } from './op_envelope.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new EnvelopeOp(SR);
  op.reset();
  // Default params include amount=-1, offset=0. For most tests we want
  // amount=+1, offset=0 so the output equals the internal envelope state.
  op.setParam('amount', 1);
  op.setParam('offset', 0);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { env: out }, n);
  return out;
}

const tests = [
  {
    name: 'attack: step from 0→1 reaches ≈ 1−1/e at n = atk·sr/1000',
    run() {
      const atkMs = 10;
      const op = freshOp({ attack: atkMs, release: 1000 });
      const n = Math.round((atkMs / 1000) * SR);
      const out = render(op, 1, n + 64);
      const target = 1 - 1 / Math.E;  // ≈ 0.632
      // Sample near the τ point — allow a small window because of denormal bias.
      const measured = out[n];
      if (!(measured > target - 0.05 && measured < target + 0.05))
        return { pass: false, why: `at n=${n} env=${measured.toFixed(4)}, expected ≈ ${target.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'attack is faster than release (rising edge settles sooner)',
    run() {
      const opFast = freshOp({ attack: 1,   release: 1000 });
      const opSlow = freshOp({ attack: 100, release: 1000 });
      const fast = render(opFast, 1, 512);
      const slow = render(opSlow, 1, 512);
      if (!(fast[256] > slow[256]))
        return { pass: false, why: `fast[256]=${fast[256]} not > slow[256]=${slow[256]}` };
      return { pass: true };
    },
  },
  {
    name: 'release: after full charge, input→0 decays with release τ',
    run() {
      const relMs = 20;
      const op = freshOp({ attack: 1, release: relMs });
      // Charge up.
      render(op, 1, 4096);
      // Now run zero input and sample at release τ.
      const n = Math.round((relMs / 1000) * SR);
      const out = render(op, 0, n + 64);
      const target = 1 / Math.E;  // state should decay to 1/e of whatever charged
      // We charged to ~1 (steady state), so expect ~1/e at n.
      const measured = out[n];
      if (!(measured > target - 0.1 && measured < target + 0.1))
        return { pass: false, why: `release[${n}]=${measured.toFixed(4)}, expected ≈ ${target.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'steady state: constant |x| → envelope converges to |x|',
    run() {
      const op = freshOp({ attack: 1, release: 1 });
      const out = render(op, 0.4, 8192);
      const last = out[out.length - 1];
      if (!approx(last, 0.4, 1e-3)) return { pass: false, why: `last=${last}` };
      return { pass: true };
    },
  },
  {
    name: 'rectification: negative input tracked as |x|',
    run() {
      const op = freshOp({ attack: 1, release: 1 });
      const out = render(op, -0.7, 8192);
      const last = out[out.length - 1];
      if (!approx(last, 0.7, 1e-3)) return { pass: false, why: `last=${last}` };
      return { pass: true };
    },
  },
  {
    name: 'amount: negative flips sign of output',
    run() {
      const op = new EnvelopeOp(SR);
      op.reset();
      op.setParam('attack', 1);
      op.setParam('release', 1);
      op.setParam('amount', -1);
      op.setParam('offset', 0);
      const out = render(op, 0.5, 8192);
      const last = out[out.length - 1];
      if (!(last < -0.49 && last > -0.51)) return { pass: false, why: `last=${last}, expected ≈ -0.5` };
      return { pass: true };
    },
  },
  {
    name: 'offset: adds DC bias to output',
    run() {
      const op = freshOp({ attack: 1, release: 1, amount: 1, offset: 0.3 });
      const out = render(op, 0.5, 8192);
      const last = out[out.length - 1];
      if (!approx(last, 0.8, 5e-3)) return { pass: false, why: `last=${last}, expected ≈ 0.8` };
      return { pass: true };
    },
  },
  {
    name: 'silence + offset: missing input → output = offset',
    run() {
      const op = freshOp({ amount: 1, offset: 0.25 });
      const out = new Float32Array(64);
      op.process({}, { env: out }, 64);
      for (let i = 0; i < 64; i++)
        if (!approx(out[i], 0.25, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears envelope state',
    run() {
      const op = freshOp({ attack: 1, release: 1 });
      render(op, 1, 4096);   // charge up
      op.reset();
      // After reset, a single sample of input=1 should give a small (≈0)
      // initial envelope value, not the previously-charged ~1.
      const out = render(op, 1, 2);
      if (out[0] > 0.1) return { pass: false, why: `after reset, env[0]=${out[0]} (should be small)` };
      return { pass: true };
    },
  },
  {
    name: 'denormal bias: envelope state does not stall on silence',
    run() {
      // The Jon Watte bias keeps state moving — DC of state should be zero
      // (or very close) under silence. This mostly verifies that applying
      // the alternating sign doesn't drift the output.
      const op = freshOp({ attack: 1, release: 500, amount: 1, offset: 0 });
      const out = render(op, 0, 8192);
      const last = out[out.length - 1];
      if (!Number.isFinite(last)) return { pass: false, why: `non-finite: ${last}` };
      if (Math.abs(last) > 1e-3) return { pass: false, why: `silence tail=${last}, expected near zero` };
      return { pass: true };
    },
  },
  {
    name: 'finite output on sine input',
    run() {
      const op = freshOp({ attack: 5, release: 50 });
      const out = render(op, i => Math.sin(2 * Math.PI * 440 * i / SR), 4096);
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'envelope', tests };
