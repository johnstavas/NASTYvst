// op_trigger.test.js — real-math tests for op_trigger.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Schmitt trigger with hysteresis (threshHi/threshLo).
//   mode='gate'  → 1 while armed, 0 otherwise.
//   mode='pulse' → 1 only on arm-up sample.
//   threshLo > threshHi is coerced to threshLo = threshHi.

import { TriggerOp } from './op_trigger.worklet.js';

const SR = 48000;

function freshOp(hi = 0.5, lo = 0.4, mode = 'gate') {
  const op = new TriggerOp(SR);
  op.reset();
  op.setParam('threshHi', hi);
  op.setParam('threshLo', lo);
  op.setParam('mode', mode);
  return op;
}

function run(op, fill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof fill === 'function' ? fill(i) : fill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return out;
}

const tests = [
  {
    name: 'gate: x below hi → stays 0',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      const out = run(op, 0.3, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'gate: x crosses hi → arms to 1 on that sample',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      const inBuf = new Float32Array(8);
      inBuf[0] = 0.3; inBuf[1] = 0.4; inBuf[2] = 0.5; inBuf[3] = 0.6; inBuf[4] = 0.6; inBuf[5] = 0.6; inBuf[6] = 0.6; inBuf[7] = 0.6;
      const out = new Float32Array(8);
      op.process({ in: inBuf }, { out }, 8);
      if (out[0] !== 0) return { pass: false, why: `out[0]=${out[0]}` };
      if (out[1] !== 0) return { pass: false, why: `out[1]=${out[1]}` };
      if (out[2] !== 1) return { pass: false, why: `out[2]=${out[2]} (should arm on >=hi)` };
      if (out[7] !== 1) return { pass: false, why: `out[7]=${out[7]}` };
      return { pass: true };
    },
  },
  {
    name: 'gate: hysteresis — dipping below hi but above lo stays armed',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      // Arm, then dip to 0.45 (between lo and hi).
      const inBuf = new Float32Array(4);
      inBuf[0] = 0.6; inBuf[1] = 0.45; inBuf[2] = 0.45; inBuf[3] = 0.45;
      const out = new Float32Array(4);
      op.process({ in: inBuf }, { out }, 4);
      for (let i = 0; i < 4; i++) if (out[i] !== 1) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'gate: drops to 0 only when x <= lo',
    run() {
      // Use 0.35 not 0.4 to avoid Float32 roundoff (0.4 Float32 > 0.4 double).
      const op = freshOp(0.5, 0.4, 'gate');
      const inBuf = new Float32Array(4);
      inBuf[0] = 0.6; inBuf[1] = 0.35; inBuf[2] = 0.35; inBuf[3] = 0.35;
      const out = new Float32Array(4);
      op.process({ in: inBuf }, { out }, 4);
      if (out[0] !== 1) return { pass: false, why: `out[0]=${out[0]}` };
      if (out[1] !== 0) return { pass: false, why: `out[1]=${out[1]} (should disarm at <=lo)` };
      return { pass: true };
    },
  },
  {
    name: 'pulse: single-sample tick on arm-up',
    run() {
      const op = freshOp(0.5, 0.4, 'pulse');
      const inBuf = new Float32Array(8);
      inBuf[0] = 0.3; inBuf[1] = 0.6; inBuf[2] = 0.6; inBuf[3] = 0.6; inBuf[4] = 0.3; inBuf[5] = 0.3; inBuf[6] = 0.6; inBuf[7] = 0.6;
      const out = new Float32Array(8);
      op.process({ in: inBuf }, { out }, 8);
      // Expect pulses at index 1 and index 6.
      const expected = [0, 1, 0, 0, 0, 0, 1, 0];
      for (let i = 0; i < 8; i++) if (out[i] !== expected[i]) return { pass: false, why: `i=${i} out=${out[i]} expected ${expected[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'pulse: no re-trigger while held above lo',
    run() {
      const op = freshOp(0.5, 0.4, 'pulse');
      // Arm and stay high for 128 samples.
      const inBuf = new Float32Array(128).fill(1);
      const out = new Float32Array(128);
      op.process({ in: inBuf }, { out }, 128);
      if (out[0] !== 1) return { pass: false, why: `out[0]=${out[0]}` };
      for (let i = 1; i < 128; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]} (spurious retrigger)` };
      return { pass: true };
    },
  },
  {
    name: 'pulse: re-arm requires dip below lo',
    run() {
      const op = freshOp(0.5, 0.4, 'pulse');
      // Rise, dip to 0.45 (still above lo), rise again — must NOT re-pulse.
      const inBuf = new Float32Array(6);
      inBuf[0] = 0.6; inBuf[1] = 0.45; inBuf[2] = 0.6; inBuf[3] = 0.3; inBuf[4] = 0.6; inBuf[5] = 0.6;
      const out = new Float32Array(6);
      op.process({ in: inBuf }, { out }, 6);
      const expected = [1, 0, 0, 0, 1, 0];
      for (let i = 0; i < 6; i++) if (out[i] !== expected[i]) return { pass: false, why: `i=${i} out=${out[i]} expected ${expected[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary state carry',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      // Arm in block A.
      op.process({ in: new Float32Array([0.6, 0.6, 0.6, 0.6]) }, { out: new Float32Array(4) }, 4);
      // Block B with signal in hysteresis band — should stay armed.
      const outB = new Float32Array(4);
      op.process({ in: new Float32Array([0.45, 0.45, 0.45, 0.45]) }, { out: outB }, 4);
      for (let i = 0; i < 4; i++) if (outB[i] !== 1) return { pass: false, why: `B[${i}]=${outB[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears high state',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      run(op, 1.0, 64);  // arm
      op.reset();
      // After reset, 0.45 (in hysteresis band) should NOT re-arm.
      const out = run(op, 0.45, 4);
      for (let i = 0; i < 4; i++) if (out[i] !== 0) return { pass: false, why: `post-reset i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'numeric mode accepted (0 = gate, 1 = pulse)',
    run() {
      const op = new TriggerOp(SR);
      op.reset();
      op.setParam('threshHi', 0.5);
      op.setParam('threshLo', 0.4);
      op.setParam('mode', 1);
      const inBuf = new Float32Array([0.3, 0.6, 0.6]);
      const out = new Float32Array(3);
      op.process({ in: inBuf }, { out }, 3);
      if (out[0] !== 0 || out[1] !== 1 || out[2] !== 0) return { pass: false, why: `[${out[0]},${out[1]},${out[2]}]` };
      return { pass: true };
    },
  },
  {
    name: 'unknown mode string is sticky last-good',
    run() {
      const op = freshOp(0.5, 0.4, 'pulse');
      op.setParam('mode', 'banana');
      const inBuf = new Float32Array([0.3, 0.6, 0.6, 0.6]);
      const out = new Float32Array(4);
      op.process({ in: inBuf }, { out }, 4);
      // Should still be pulse (1 only at index 1).
      if (out[0] !== 0 || out[1] !== 1 || out[2] !== 0 || out[3] !== 0) {
        return { pass: false, why: `[${out[0]},${out[1]},${out[2]},${out[3]}]` };
      }
      return { pass: true };
    },
  },
  {
    name: 'inverted thresholds coerced (lo > hi → lo = hi)',
    run() {
      const op = new TriggerOp(SR);
      op.reset();
      op.setParam('threshHi', 0.5);
      op.setParam('threshLo', 0.8);   // invalid — should coerce to 0.5
      op.setParam('mode', 'gate');
      // With hi=lo=0.5, exactly-at-threshold hits both arm (>=hi) and disarm
      // (<=lo). Arm wins because check order is arm-first. Signal crosses 0.5:
      const inBuf = new Float32Array([0.3, 0.5, 0.5, 0.4]);
      const out = new Float32Array(4);
      op.process({ in: inBuf }, { out }, 4);
      // index 1: was low, x=0.5 >= hi=0.5 → arm → 1.
      // index 2: high, x=0.5 <= lo=0.5 → disarm → 0.
      // index 3: low, x=0.4 < hi → stays 0.
      if (out[0] !== 0 || out[1] !== 1 || out[2] !== 0 || out[3] !== 0) {
        return { pass: false, why: `[${out[0]},${out[1]},${out[2]},${out[3]}]` };
      }
      return { pass: true };
    },
  },
  {
    name: 'non-finite threshold ignored',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      op.setParam('threshHi', Number.NaN);
      op.setParam('threshLo', Number.POSITIVE_INFINITY);
      // Thresholds unchanged → 0.6 should arm.
      const out = run(op, 0.6, 4);
      if (out[0] !== 1) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: disarmed state outputs all zeros',
    run() {
      const op = freshOp(0.5, 0.4, 'gate');
      const out = new Float32Array(16);
      op.process({}, { out }, 16);
      for (let i = 0; i < 16; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(64).fill(0.6) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'zero latency declared',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'negative thresholds work (e.g., bipolar signals)',
    run() {
      const op = freshOp(-0.3, -0.5, 'gate');
      // Bipolar square: -1, -1, 0, 0 → arms when x >= -0.3 (index 2).
      const inBuf = new Float32Array([-1, -1, 0, 0, -1, -1]);
      const out = new Float32Array(6);
      op.process({ in: inBuf }, { out }, 6);
      const expected = [0, 0, 1, 1, 0, 0];
      for (let i = 0; i < 6; i++) if (out[i] !== expected[i]) return { pass: false, why: `i=${i} out=${out[i]} exp=${expected[i]}` };
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

export default { opId: 'trigger', tests };
