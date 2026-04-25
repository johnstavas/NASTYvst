// op_z1.test.js — real-math tests for op_z1.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   y[n] = x[n-1], x[-1] = 0
//   First sample after reset always 0, regardless of input
//   Block-boundary state is preserved (sample at end of block N
//   is emitted as sample 0 of block N+1)
//   Latency = 1 sample

import { Z1Op } from './op_z1.worklet.js';

function freshOp() { const op = new Z1Op(48000); op.reset(); return op; }

const tests = [
  {
    name: 'impulse shifts right by 1 sample',
    run() {
      const op = freshOp();
      const N = 16;
      const inBuf = new Float32Array(N);
      inBuf[0] = 1;  // impulse at n=0
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      if (out[0] !== 0) return { pass: false, why: `out[0]=${out[0]} expected 0` };
      if (out[1] !== 1) return { pass: false, why: `out[1]=${out[1]} expected 1` };
      for (let i = 2; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'constant input: steady state y[n] = x after 1 sample',
    run() {
      const op = freshOp();
      const N = 32;
      const inBuf = new Float32Array(N).fill(0.5);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      if (out[0] !== 0) return { pass: false, why: `out[0]=${out[0]}` };
      for (let i = 1; i < N; i++) if (out[i] !== 0.5) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary state carry: last-of-A is first-of-B',
    run() {
      const op = freshOp();
      const N = 16;
      const a = new Float32Array(N);
      for (let i = 0; i < N; i++) a[i] = i;  // 0..15
      const outA = new Float32Array(N);
      op.process({ in: a }, { out: outA }, N);
      // outA = [0, 0, 1, 2, ..., 14]
      if (outA[N - 1] !== 14) return { pass: false, why: `A tail=${outA[N-1]}` };

      const b = new Float32Array(N);
      for (let i = 0; i < N; i++) b[i] = 100 + i;  // 100..115
      const outB = new Float32Array(N);
      op.process({ in: b }, { out: outB }, N);
      // outB[0] must be the LAST sample of a[], which was 15.
      if (outB[0] !== 15) return { pass: false, why: `B[0]=${outB[0]} expected 15` };
      if (outB[1] !== 100) return { pass: false, why: `B[1]=${outB[1]} expected 100` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state: first sample after reset is 0',
    run() {
      const op = freshOp();
      const N = 8;
      const a = new Float32Array(N).fill(1.0);
      op.process({ in: a }, { out: new Float32Array(N) }, N);
      // After this, state = 1.0.
      op.reset();
      const out = new Float32Array(N);
      op.process({ in: new Float32Array(N).fill(0.3) }, { out }, N);
      if (out[0] !== 0) return { pass: false, why: `after reset out[0]=${out[0]}` };
      for (let i = 1; i < N; i++) if (out[i] !== Math.fround(0.3)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() = 1',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 1) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'two z1 in series = 2-sample delay',
    run() {
      const a = freshOp();
      const b = freshOp();
      const N = 8;
      const inBuf = new Float32Array(N);
      inBuf[0] = 1;  // impulse
      const mid = new Float32Array(N);
      const out = new Float32Array(N);
      a.process({ in: inBuf }, { out: mid }, N);
      b.process({ in: mid }, { out }, N);
      if (out[0] !== 0) return { pass: false, why: `out[0]=${out[0]}` };
      if (out[1] !== 0) return { pass: false, why: `out[1]=${out[1]}` };
      if (out[2] !== 1) return { pass: false, why: `out[2]=${out[2]} expected 1 (impulse delayed 2)` };
      return { pass: true };
    },
  },
  {
    name: 'difference filter: x[n] - z1(x[n]) = first-order difference',
    run() {
      // Canonical usage as a differentiator. Feed a ramp; output
      // should be constant (ramp slope) after one sample of transient.
      const op = freshOp();
      const N = 64;
      const ramp = new Float32Array(N);
      for (let i = 0; i < N; i++) ramp[i] = i * 0.01;
      const zOut = new Float32Array(N);
      op.process({ in: ramp }, { out: zOut }, N);
      // diff[n] = ramp[n] - zOut[n]
      // diff[0] = 0 - 0 = 0  (startup transient)
      // diff[n>=1] = i·0.01 - (i-1)·0.01 = 0.01
      for (let i = 1; i < N; i++) {
        const diff = ramp[i] - zOut[i];
        if (Math.abs(diff - 0.01) > 1e-6) return { pass: false, why: `i=${i} diff=${diff}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input: state flushes through, then silence',
    run() {
      const op = freshOp();
      const N = 8;
      const a = new Float32Array(N).fill(0.75);
      op.process({ in: a }, { out: new Float32Array(N) }, N);
      // State = 0.75 now.
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      if (out[0] !== Math.fround(0.75)) return { pass: false, why: `out[0]=${out[0]}` };
      for (let i = 1; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      // Next missing-input block: all zeros.
      const out2 = new Float32Array(N);
      op.process({}, { out: out2 }, N);
      for (let i = 0; i < N; i++) if (out2[i] !== 0) return { pass: false, why: `out2[${i}]=${out2[i]}` };
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
    name: 'denormal flush: tiny state eventually collapses to 0',
    run() {
      const op = freshOp();
      // Inject one tiny sample, then feed zeros — denormal flush on
      // block-end should clamp state to 0.
      const inBuf = new Float32Array(16);
      inBuf[0] = 1e-40;  // denormal in float32
      op.process({ in: inBuf }, { out: new Float32Array(16) }, 16);
      // After this block, state = 0 (last sample of inBuf was 0).
      // Feed more zeros to verify output stays bit-zero.
      const out = new Float32Array(16);
      op.process({ in: new Float32Array(16) }, { out }, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme magnitudes delayed cleanly',
    run() {
      const op = freshOp();
      const N = 16;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = i % 2 === 0 ? 1e5 : -1e5;
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      if (out[0] !== 0) return { pass: false, why: `out[0]=${out[0]}` };
      for (let i = 1; i < N; i++) if (out[i] !== inBuf[i - 1]) return { pass: false, why: `i=${i} got ${out[i]} expect ${inBuf[i-1]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp();
      const b = freshOp();
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

export default { opId: 'z1', tests };
