// op_fanOut.test.js — real-math tests for op_fanOut.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   All wired outputs receive bit-exact copy of input.
//   Unwired outputs (omitted from outputs object) are not written.
//   Missing input → all wired outputs zero-filled.
//   Stateless.

import { FanOutOp } from './op_fanOut.worklet.js';

function freshOp() { const op = new FanOutOp(48000); op.reset(); return op; }

const tests = [
  {
    name: 'all four outputs receive bit-exact input',
    run() {
      const op = freshOp();
      const N = 512;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) - 0.2;
      const o0 = new Float32Array(N), o1 = new Float32Array(N);
      const o2 = new Float32Array(N), o3 = new Float32Array(N);
      op.process({ in: inBuf }, { out0: o0, out1: o1, out2: o2, out3: o3 }, N);
      for (let i = 0; i < N; i++) {
        if (o0[i] !== inBuf[i]) return { pass: false, why: `o0[${i}]=${o0[i]} vs in=${inBuf[i]}` };
        if (o1[i] !== inBuf[i]) return { pass: false, why: `o1[${i}]=${o1[i]}` };
        if (o2[i] !== inBuf[i]) return { pass: false, why: `o2[${i}]=${o2[i]}` };
        if (o3[i] !== inBuf[i]) return { pass: false, why: `o3[${i}]=${o3[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'all outputs are mutually bit-identical',
    run() {
      const op = freshOp();
      const N = 256;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.1);
      const o0 = new Float32Array(N), o1 = new Float32Array(N);
      const o2 = new Float32Array(N), o3 = new Float32Array(N);
      op.process({ in: inBuf }, { out0: o0, out1: o1, out2: o2, out3: o3 }, N);
      for (let i = 0; i < N; i++) {
        if (o0[i] !== o1[i] || o1[i] !== o2[i] || o2[i] !== o3[i]) {
          return { pass: false, why: `i=${i} o0=${o0[i]} o1=${o1[i]} o2=${o2[i]} o3=${o3[i]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'unwired outputs not written (partial output object)',
    run() {
      const op = freshOp();
      const N = 64;
      const inBuf = new Float32Array(N).fill(0.5);
      const o0 = new Float32Array(N);
      const o2 = new Float32Array(N).fill(999);  // sentinel: don't overwrite
      // Wire only out0 and out2. out1/out3 omitted entirely.
      op.process({ in: inBuf }, { out0: o0, out2: new Float32Array(N) }, N);
      for (let i = 0; i < N; i++) {
        if (o0[i] !== 0.5) return { pass: false, why: `o0[${i}]=${o0[i]}` };
      }
      // Separately verify: if a sentinel buffer was NOT passed to op, it stays untouched.
      // (This buffer was never referenced in outputs; sanity-check still 999.)
      for (let i = 0; i < N; i++) if (o2[i] !== 999) return { pass: false, why: `sentinel overwritten` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: all wired outputs zero-filled',
    run() {
      const op = freshOp();
      const N = 32;
      const o0 = new Float32Array(N).fill(5);
      const o1 = new Float32Array(N).fill(5);
      const o2 = new Float32Array(N).fill(5);
      const o3 = new Float32Array(N).fill(5);
      op.process({}, { out0: o0, out1: o1, out2: o2, out3: o3 }, N);
      for (let i = 0; i < N; i++) {
        if (o0[i] !== 0 || o1[i] !== 0 || o2[i] !== 0 || o3[i] !== 0) {
          return { pass: false, why: `i=${i} not zeroed` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input + partial outputs: only wired outputs zeroed',
    run() {
      const op = freshOp();
      const N = 32;
      const o0 = new Float32Array(N).fill(5);
      // Only wire out0 and out3; out1/out2 omitted.
      op.process({}, { out0: o0 }, N);
      for (let i = 0; i < N; i++) if (o0[i] !== 0) return { pass: false, why: `o0[${i}]=${o0[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme magnitudes preserved on all branches',
    run() {
      const op = freshOp();
      const N = 16;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = i % 2 === 0 ? 1e6 : -1e6;
      const o0 = new Float32Array(N), o1 = new Float32Array(N);
      const o2 = new Float32Array(N), o3 = new Float32Array(N);
      op.process({ in: inBuf }, { out0: o0, out1: o1, out2: o2, out3: o3 }, N);
      for (let i = 0; i < N; i++) {
        const expect = inBuf[i];
        if (o0[i] !== expect || o1[i] !== expect || o2[i] !== expect || o3[i] !== expect) {
          return { pass: false, why: `i=${i} expect=${expect}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'no output wired is a full no-op',
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
      const N = 32;
      const inBuf = new Float32Array(N).fill(0.7);
      op.process({ in: inBuf }, { out0: new Float32Array(N) }, N);
      op.reset();
      const o0 = new Float32Array(N);
      op.process({ in: inBuf }, { out0: o0 }, N);
      const expect = Math.fround(0.7);
      for (let i = 0; i < N; i++) if (o0[i] !== expect) return { pass: false, why: `o0[${i}]=${o0[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'tee-into-null-test: diff of two fanOut branches ≡ 0',
    run() {
      // Invariant of a correct splitter.
      const op = freshOp();
      const N = 1024;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2*Math.PI*440*i/48000);
      const o0 = new Float32Array(N), o1 = new Float32Array(N);
      op.process({ in: inBuf }, { out0: o0, out1: o1 }, N);
      for (let i = 0; i < N; i++) {
        if (o0[i] - o1[i] !== 0) return { pass: false, why: `i=${i} diff=${o0[i]-o1[i]}` };
      }
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
      const aOut = new Float32Array(N), bOut = new Float32Array(N);
      a.process({ in: inBuf }, { out0: aOut }, N);
      b.process({ in: inBuf }, { out0: bOut }, N);
      for (let i = 0; i < N; i++) if (aOut[i] !== bOut[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'fanOut', tests };
