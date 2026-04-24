// op_gain.test.js — real-math tests for op_gain.
// Run via: node scripts/check_op_math.mjs

import { GainOp } from './op_gain.worklet.js';

const SR  = 48000;
const N   = 32;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new GainOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inFill, modFill = null) {
  const inBuf  = inFill  == null ? null : new Float32Array(N);
  const modBuf = modFill == null ? null : new Float32Array(N);
  if (inBuf)  for (let i = 0; i < N; i++) inBuf[i]  = typeof inFill  === 'function' ? inFill(i)  : inFill;
  if (modBuf) for (let i = 0; i < N; i++) modBuf[i] = typeof modFill === 'function' ? modFill(i) : modFill;
  const out = new Float32Array(N);
  const inputs = {};
  if (inBuf)  inputs.in      = inBuf;
  if (modBuf) inputs.gainMod = modBuf;
  op.process(inputs, { out }, N);
  return { inBuf, modBuf, out };
}

const tests = [
  {
    name: '0 dB → unity passthrough',
    run() {
      const op = freshOp({ gainDb: 0 });
      const { out } = drive(op, i => 0.1 * (i + 1));
      for (let i = 0; i < N; i++) {
        const expected = 0.1 * (i + 1);
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: '+6 dB ≈ 2× linear gain',
    run() {
      const op = freshOp({ gainDb: 6 });
      const { out } = drive(op, 0.5);
      // 10^(6/20) ≈ 1.99526
      const expected = 0.5 * Math.pow(10, 6 / 20);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: '-6 dB ≈ 0.5× linear gain',
    run() {
      const op = freshOp({ gainDb: -6 });
      const { out } = drive(op, 1);
      const expected = Math.pow(10, -6 / 20);  // ≈ 0.5012
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: '-∞ practical floor: -60 dB → very quiet',
    run() {
      const op = freshOp({ gainDb: -60 });
      const { out } = drive(op, 1);
      const expected = Math.pow(10, -60 / 20);  // 0.001
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'gainMod sums into linear base (not dB)',
    run() {
      // gainDb=0 → base=1. mod=0.5 → effective gain = 1.5.
      const op = freshOp({ gainDb: 0 });
      const { out } = drive(op, 0.4, 0.5);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], 0.4 * 1.5, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'gainMod can drive gain below zero (sign flip allowed by design)',
    run() {
      // gainDb=0, mod=-2 → effective gain = -1 → phase-inverted output.
      const op = freshOp({ gainDb: 0 });
      const { out } = drive(op, 0.3, -2);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], -0.3, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'gainMod varies per sample (AM signal)',
    run() {
      const op = freshOp({ gainDb: 0 });
      const { out } = drive(op, 1, i => i / N);
      for (let i = 0; i < N; i++) {
        const expected = 1 * (1 + i / N);
        if (!approx(out[i], expected, 1e-6)) return { pass: false, why: `i=${i}: ${out[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → all-zero output (defensive)',
    run() {
      const op = freshOp({ gainDb: 12 });
      const { out } = drive(op, null);
      for (let i = 0; i < N; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() is a no-op for stateless gain',
    run() {
      const op = freshOp({ gainDb: 6 });
      drive(op, 0.5);
      op.reset();
      const { out } = drive(op, 0.5);
      const expected = 0.5 * Math.pow(10, 6 / 20);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'setParam changes take effect immediately',
    run() {
      const op = freshOp({ gainDb: 0 });
      op.setParam('gainDb', 6);
      const { out } = drive(op, 0.5);
      const expected = 0.5 * Math.pow(10, 6 / 20);
      for (let i = 0; i < N; i++)
        if (!approx(out[i], expected, 1e-5)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'gain', tests };
