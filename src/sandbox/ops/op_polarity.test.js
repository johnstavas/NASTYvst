// op_polarity.test.js — real-math tests for op_polarity.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   invert = 0 → out = x           (bit-exact pass-through)
//   invert = 1 → out = -x          (sign flip, bit-exact magnitude)
//   Missing input → zero output
//   NaN param → treated as false
//   Null test: x + polarity(x) = 0 when invert=1

import { PolarityOp } from './op_polarity.worklet.js';

function freshOp() { const op = new PolarityOp(48000); op.reset(); return op; }

function run(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

const tests = [
  {
    name: 'default (invert=0): bit-exact pass-through',
    run() {
      const op = freshOp();
      const N = 512;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) - 0.2;
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== inBuf[i]) return { pass: false, why: `i=${i} in=${inBuf[i]} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'invert=1: out = -x exactly',
    run() {
      const op = freshOp();
      op.setParam('invert', 1);
      const N = 512;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) - 0.2;
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== -inBuf[i]) return { pass: false, why: `i=${i} in=${inBuf[i]} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'null test: x + polarity(x) ≡ 0 (invert=1)',
    run() {
      const op = freshOp();
      op.setParam('invert', 1);
      const N = 1024;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2*Math.PI*440*i/48000) * 0.7;
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      for (let i = 0; i < N; i++) {
        const sum = inBuf[i] + out[i];
        if (sum !== 0) return { pass: false, why: `i=${i} sum=${sum}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'double-invert = identity (two ops in series)',
    run() {
      const a = freshOp();
      const b = freshOp();
      a.setParam('invert', 1);
      b.setParam('invert', 1);
      const N = 512;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013);
      const mid = new Float32Array(N);
      const out = new Float32Array(N);
      a.process({ in: inBuf }, { out: mid }, N);
      b.process({ in: mid }, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== inBuf[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'param toggle takes effect on next process call',
    run() {
      const op = freshOp();
      const N = 64;
      // First call with default (no invert).
      const { out: o1 } = run(op, 0.5, N);
      for (let i = 0; i < N; i++) if (o1[i] !== 0.5) return { pass: false, why: `pre-toggle o1[${i}]=${o1[i]}` };
      // Toggle, second call should invert.
      op.setParam('invert', 1);
      const { out: o2 } = run(op, 0.5, N);
      for (let i = 0; i < N; i++) if (o2[i] !== -0.5) return { pass: false, why: `post-toggle o2[${i}]=${o2[i]}` };
      // Toggle back.
      op.setParam('invert', 0);
      const { out: o3 } = run(op, 0.5, N);
      for (let i = 0; i < N; i++) if (o3[i] !== 0.5) return { pass: false, why: `re-toggle o3[${i}]=${o3[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN invert → treated as false (pass-through)',
    run() {
      const op = freshOp();
      op.setParam('invert', NaN);
      const { out } = run(op, 0.5, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative non-zero invert value → true',
    run() {
      // "truthy" includes negative values — -1, -0.5, etc. should invert.
      const op = freshOp();
      op.setParam('invert', -1);
      const { out } = run(op, 0.5, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== -0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: '-0 invert → false (pass-through)',
    run() {
      const op = freshOp();
      op.setParam('invert', -0);
      const { out } = run(op, 0.5, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'DC pass-through and invert are exact (no precision loss)',
    run() {
      const op = freshOp();
      op.setParam('invert', 1);
      const { out } = run(op, 0.123456789, 16);
      const expect = -Math.fround(0.123456789);
      for (let i = 0; i < 16; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]} expect=${expect}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → zero output',
    run() {
      const op = freshOp();
      op.setParam('invert', 1);
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.setParam('invert', 1);
      op.process({ in: new Float32Array(64).fill(1) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset is no-op (stateless)',
    run() {
      const op = freshOp();
      op.setParam('invert', 1);
      run(op, -0.5, 100);
      op.reset();
      // invert state should persist across reset (param state, not DSP state)
      const { out } = run(op, 0.5, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== -0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp();
      const b = freshOp();
      a.setParam('invert', 1);
      b.setParam('invert', 1);
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013);
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ in: inBuf }, { out: oA }, N);
      b.process({ in: inBuf }, { out: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'polarity', tests };
