// op_sign.test.js — real-math tests for op_sign.
// Run via: node scripts/check_op_math.mjs
//
// Exact three-valued contract:
//   x >  0 → +1
//   x <  0 → -1
//   x == 0 → 0 (including -0)
//   NaN    → 0
//
// Tests cover every branch plus missing I/O + determinism.

import { SignOp } from './op_sign.worklet.js';

function freshOp() { const op = new SignOp(48000); op.reset(); return op; }

function run(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

const tests = [
  {
    name: 'positive → +1',
    run() {
      const { out } = run(freshOp(), 0.37, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 1) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative → -1',
    run() {
      const { out } = run(freshOp(), -0.01, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== -1) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'zero → 0',
    run() {
      const { out } = run(freshOp(), 0, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative zero → 0 (not -1)',
    run() {
      const { out } = run(freshOp(), -0, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN → 0 (not NaN)',
    run() {
      const op = freshOp();
      const inBuf = new Float32Array(64).fill(NaN);
      const out = new Float32Array(64);
      op.process({ in: inBuf }, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'sine input: output is +1 on top half, -1 on bottom half, 0 at zero-crossings',
    run() {
      const op = freshOp();
      const sr = 48000;
      const N = sr; // 1 s of 1 kHz sine
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * 1000 * i / sr);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      let pos = 0, neg = 0, zero = 0;
      for (let i = 0; i < N; i++) {
        if      (out[i] ===  1) pos++;
        else if (out[i] === -1) neg++;
        else if (out[i] ===  0) zero++;
        else return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      // Should be roughly half/half (1 kHz at 48 kHz → 48 samples/cycle,
      // 2 zero-crossings per cycle but exact coincidence with integer
      // sample indices is rare → expect ~0 zeros).
      if (pos < N / 2 - 100 || pos > N / 2 + 100) return { pass: false, why: `pos=${pos}` };
      if (neg < N / 2 - 100 || neg > N / 2 + 100) return { pass: false, why: `neg=${neg}` };
      return { pass: true };
    },
  },
  {
    name: 'tiny positive value → +1 (no threshold)',
    run() {
      const { out } = run(freshOp(), 1e-30, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 1) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'odd symmetry: sign(-x) = -sign(x)',
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
        if (oA[i] !== -oB[i]) return { pass: false, why: `i=${i} A=${oA[i]} B=${oB[i]}` };
      }
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
      op.process({ in: new Float32Array(64).fill(1) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset is no-op (stateless)',
    run() {
      const op = freshOp();
      run(op, 5.0, 100);
      op.reset();
      const { out } = run(op, 0.5, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 1) return { pass: false, why: `out[${i}]=${out[i]}` };
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

export default { opId: 'sign', tests };
