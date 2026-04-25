// op_uniBi.test.js — real-math tests for op_uniBi.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   uniToBi: y = 2x - 1   (0 → -1, 0.5 → 0, 1 → +1)
//   biToUni: y = (x+1)/2  (-1 → 0, 0 → 0.5, +1 → 1)
//   Stateless, linear (no clamp on overshoot).
//   Round-trip uniToBi ∘ biToUni = identity.

import { UniBiOp } from './op_uniBi.worklet.js';

function freshOp(mode = 'uniToBi') {
  const op = new UniBiOp(48000);
  op.reset();
  op.setParam('mode', mode);
  return op;
}

function run(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

const tests = [
  {
    name: 'uniToBi anchor points: 0 → -1, 0.5 → 0, 1 → +1',
    run() {
      const opA = freshOp('uniToBi');
      const opB = freshOp('uniToBi');
      const opC = freshOp('uniToBi');
      const a = run(opA, 0,   4).out;
      const b = run(opB, 0.5, 4).out;
      const c = run(opC, 1,   4).out;
      if (a[0] !== -1) return { pass: false, why: `0 → ${a[0]} expected -1` };
      if (b[0] !== 0)  return { pass: false, why: `0.5 → ${b[0]} expected 0` };
      if (c[0] !== 1)  return { pass: false, why: `1 → ${c[0]} expected 1` };
      return { pass: true };
    },
  },
  {
    name: 'biToUni anchor points: -1 → 0, 0 → 0.5, +1 → 1',
    run() {
      const opA = freshOp('biToUni');
      const opB = freshOp('biToUni');
      const opC = freshOp('biToUni');
      const a = run(opA, -1, 4).out;
      const b = run(opB,  0, 4).out;
      const c = run(opC,  1, 4).out;
      if (a[0] !== 0)   return { pass: false, why: `-1 → ${a[0]}` };
      if (b[0] !== 0.5) return { pass: false, why: `0 → ${b[0]}` };
      if (c[0] !== 1)   return { pass: false, why: `+1 → ${c[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'default mode = uniToBi',
    run() {
      const op = new UniBiOp(48000);
      op.reset();
      // No setParam — should be uniToBi by construction.
      const { out } = run(op, 0.5, 4);
      if (out[0] !== 0) return { pass: false, why: `default gave ${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'round-trip identity: uniToBi → biToUni',
    run() {
      const a = freshOp('uniToBi');
      const b = freshOp('biToUni');
      const N = 128;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = i / (N - 1);  // 0..1
      const mid = new Float32Array(N);
      const out = new Float32Array(N);
      a.process({ in: inBuf }, { out: mid }, N);
      b.process({ in: mid }, { out }, N);
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i] - inBuf[i]) > 1e-7) return { pass: false, why: `i=${i} in=${inBuf[i]} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'round-trip identity: biToUni → uniToBi',
    run() {
      const a = freshOp('biToUni');
      const b = freshOp('uniToBi');
      const N = 128;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = 2 * (i / (N - 1)) - 1;  // -1..+1
      const mid = new Float32Array(N);
      const out = new Float32Array(N);
      a.process({ in: inBuf }, { out: mid }, N);
      b.process({ in: mid }, { out }, N);
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i] - inBuf[i]) > 1e-7) return { pass: false, why: `i=${i} in=${inBuf[i]} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'linear: overshoot passes through (no clamp)',
    run() {
      const op = freshOp('uniToBi');
      const { out } = run(op, 2, 4);
      // uniToBi(2) = 2·2 - 1 = 3
      if (out[0] !== 3) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'linear: negative input on uniToBi produces < -1',
    run() {
      const op = freshOp('uniToBi');
      const { out } = run(op, -0.5, 4);
      // 2·(-0.5) - 1 = -2
      if (out[0] !== -2) return { pass: false, why: `out=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'mode switch takes effect on next process',
    run() {
      const op = freshOp('uniToBi');
      const a = run(op, 1, 4).out;  // uniToBi(1) = 1
      if (a[0] !== 1) return { pass: false, why: `A a=${a[0]}` };
      op.setParam('mode', 'biToUni');
      const b = run(op, 1, 4).out;  // biToUni(1) = 1
      if (b[0] !== 1) return { pass: false, why: `B b=${b[0]}` };
      op.setParam('mode', 'uniToBi');
      const c = run(op, 0, 4).out;  // uniToBi(0) = -1
      if (c[0] !== -1) return { pass: false, why: `C c=${c[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'numeric mode param also accepted (0 = uniToBi, 1 = biToUni)',
    run() {
      const op = new UniBiOp(48000);
      op.reset();
      op.setParam('mode', 1);
      const { out } = run(op, 1, 4);
      if (out[0] !== 1) return { pass: false, why: `numeric mode=1 → ${out[0]}` };
      op.setParam('mode', 0);
      const { out: o2 } = run(op, 0, 4);
      if (o2[0] !== -1) return { pass: false, why: `numeric mode=0 → ${o2[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'unknown mode string is sticky last-good',
    run() {
      const op = freshOp('uniToBi');
      op.setParam('mode', 'banana');
      const { out } = run(op, 0.5, 4);
      if (out[0] !== 0) return { pass: false, why: `unknown mode changed behavior: ${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: uniToBi emits -1',
    run() {
      const op = freshOp('uniToBi');
      const out = new Float32Array(32);
      op.process({}, { out }, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== -1) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: biToUni emits 0.5',
    run() {
      const op = freshOp('biToUni');
      const out = new Float32Array(32);
      op.process({}, { out }, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(64).fill(0.5) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset is no-op (stateless; mode persists)',
    run() {
      const op = freshOp('biToUni');
      run(op, 0.5, 100);
      op.reset();
      // Mode should still be biToUni after reset.
      const { out } = run(op, 0, 4);
      if (out[0] !== 0.5) return { pass: false, why: `reset changed mode: ${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp('uniToBi');
      const b = freshOp('uniToBi');
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) * 0.5 + 0.5;
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ in: inBuf }, { out: oA }, N);
      b.process({ in: inBuf }, { out: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'uniBi', tests };
