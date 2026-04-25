// op_abs.test.js — real-math tests for op_abs.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   x >= 0 → x
//   x <  0 → -x
//   -0     → +0
//   NaN    → NaN (preserved, unlike sign which collapses to 0)

import { AbsOp } from './op_abs.worklet.js';

function freshOp() { const op = new AbsOp(48000); op.reset(); return op; }

function run(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

const tests = [
  {
    name: 'positive passes through unchanged',
    run() {
      const { out } = run(freshOp(), 0.37, 64);
      const expect = Math.fround(0.37);  // Float32 round-trip
      for (let i = 0; i < 64; i++) if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative is negated',
    run() {
      const { out } = run(freshOp(), -0.42, 64);
      for (let i = 0; i < 64; i++) {
        // Float32 round-trip of 0.42
        if (Math.abs(out[i] - 0.42) > 1e-7) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'zero → zero',
    run() {
      const { out } = run(freshOp(), 0, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative zero → +0 (no sign bit)',
    run() {
      const { out } = run(freshOp(), -0, 64);
      for (let i = 0; i < 64; i++) {
        // out[i] === 0 passes for both +0 and -0; use 1/out[i] to disambiguate
        if (out[i] !== 0 || 1 / out[i] !== Infinity) {
          return { pass: false, why: `out[${i}]=${out[i]} 1/out=${1/out[i]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'NaN is preserved (not collapsed)',
    run() {
      const op = freshOp();
      const inBuf = new Float32Array(64).fill(NaN);
      const out = new Float32Array(64);
      op.process({ in: inBuf }, { out }, 64);
      for (let i = 0; i < 64; i++) if (!Number.isNaN(out[i])) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'full-wave rectification of sine: output == |sin|',
    run() {
      const op = freshOp();
      const sr = 48000;
      const N = 1024;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * 1000 * i / sr);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      for (let i = 0; i < N; i++) {
        const expect = Math.abs(inBuf[i]);
        if (Math.abs(out[i] - expect) > 1e-7) return { pass: false, why: `i=${i} out=${out[i]} expect=${expect}` };
        if (out[i] < 0) return { pass: false, why: `i=${i} out=${out[i]} is negative` };
      }
      return { pass: true };
    },
  },
  {
    name: 'large magnitudes preserved',
    run() {
      const { out } = run(freshOp(), -1e6, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 1e6) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'tiny denormals are NOT flushed (meter integrity)',
    run() {
      const x = 1e-40;  // denormal in float32
      const { out } = run(freshOp(), x, 16);
      for (let i = 0; i < 16; i++) {
        // Float32 representation of 1e-40 is ~1e-40 (denormal); may round but shouldn't be zero
        const expect = Math.fround(x);
        if (out[i] !== expect) return { pass: false, why: `out[${i}]=${out[i]} expect=${expect}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'symmetry: abs(-x) == abs(x)',
    run() {
      const opA = freshOp();
      const opB = freshOp();
      const N = 1024;
      const a = new Float32Array(N);
      const b = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        a[i] = Math.sin(i * 0.01) * 2 - 1;
        b[i] = -a[i];
      }
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      opA.process({ in: a }, { out: oA }, N);
      opB.process({ in: b }, { out: oB }, N);
      for (let i = 0; i < N; i++) {
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} A=${oA[i]} B=${oB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'output is always non-negative',
    run() {
      const op = freshOp();
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) * 5 - 2.5;
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] < 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → zero output',
    run() {
      const op = freshOp();
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
      op.process({ in: new Float32Array(64).fill(-1) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset is no-op (stateless)',
    run() {
      const op = freshOp();
      run(op, -5.0, 100);
      op.reset();
      const { out } = run(op, -0.5, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const opA = freshOp();
      const opB = freshOp();
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) - 0.1;
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      opA.process({ in: inBuf }, { out: oA }, N);
      opB.process({ in: inBuf }, { out: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'abs', tests };
