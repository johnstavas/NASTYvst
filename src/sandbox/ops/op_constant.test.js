// op_constant.test.js — real-math tests for op_constant.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   out[n] = value, every sample.
//   NaN / ±Infinity params are rejected (previous value sticks).
//   No input port — zero dependency on inputs.
//   Output kind = control but buffer is just Float32Array N samples.

import { ConstantOp } from './op_constant.worklet.js';

function freshOp() { const op = new ConstantOp(48000); op.reset(); return op; }

function pump(op, N) {
  const out = new Float32Array(N);
  op.process({}, { out }, N);
  return out;
}

const tests = [
  {
    name: 'default value = 0 → all-zero output',
    run() {
      const out = pump(freshOp(), 128);
      for (let i = 0; i < 128; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'positive value fills output exactly',
    run() {
      const op = freshOp();
      op.setParam('value', 0.75);
      const out = pump(op, 256);
      const expect = Math.fround(0.75);
      for (let i = 0; i < 256; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative value fills output exactly',
    run() {
      const op = freshOp();
      op.setParam('value', -0.33);
      const out = pump(op, 256);
      const expect = Math.fround(-0.33);
      for (let i = 0; i < 256; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'large magnitude value passes (no clamp)',
    run() {
      const op = freshOp();
      op.setParam('value', 1e5);
      const out = pump(op, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== Math.fround(1e5)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'tiny value passes (no denormal flush on user intent)',
    run() {
      // 1e-20 is denormal in float32 but finite; user asked for it, they get it.
      const op = freshOp();
      op.setParam('value', 1e-20);
      const out = pump(op, 16);
      const expect = Math.fround(1e-20);
      for (let i = 0; i < 16; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param jump: setParam takes effect on next process',
    run() {
      const op = freshOp();
      op.setParam('value', 0.5);
      const a = pump(op, 32);
      for (let i = 0; i < 32; i++) if (a[i] !== 0.5) return { pass: false, why: `a[${i}]=${a[i]}` };
      op.setParam('value', -0.25);
      const b = pump(op, 32);
      for (let i = 0; i < 32; i++) if (b[i] !== -0.25) return { pass: false, why: `b[${i}]=${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN value rejected: previous value sticks',
    run() {
      const op = freshOp();
      op.setParam('value', 0.42);
      op.setParam('value', NaN);
      const out = pump(op, 32);
      const expect = Math.fround(0.42);
      for (let i = 0; i < 32; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: '+Infinity value rejected: previous value sticks',
    run() {
      const op = freshOp();
      op.setParam('value', 0.7);
      op.setParam('value', Infinity);
      const out = pump(op, 32);
      const expect = Math.fround(0.7);
      for (let i = 0; i < 32; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: '-Infinity value rejected: previous value sticks',
    run() {
      const op = freshOp();
      op.setParam('value', -0.7);
      op.setParam('value', -Infinity);
      const out = pump(op, 32);
      const expect = Math.fround(-0.7);
      for (let i = 0; i < 32; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'step change is instantaneous (no smoothing)',
    run() {
      // Key contract differentiator vs `smooth`. constant jumps in one sample.
      const op = freshOp();
      op.setParam('value', 0);
      pump(op, 100);  // run to settle (vacuously stateless)
      op.setParam('value', 1.0);
      const out = pump(op, 4);
      // Must be 1.0 from sample 0, not ramping.
      if (out[0] !== 1.0) return { pass: false, why: `out[0]=${out[0]} expected 1.0 instantly` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.setParam('value', 1);
      op.process({}, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset is no-op (stateless, value persists)',
    run() {
      const op = freshOp();
      op.setParam('value', 0.5);
      pump(op, 100);
      op.reset();
      const out = pump(op, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp();
      const b = freshOp();
      a.setParam('value', 0.3141592);
      b.setParam('value', 0.3141592);
      const oA = pump(a, 2048);
      const oB = pump(b, 2048);
      for (let i = 0; i < 2048; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'constant', tests };
