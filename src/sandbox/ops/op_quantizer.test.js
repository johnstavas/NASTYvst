// op_quantizer.test.js — real-math tests for op_quantizer.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   y = offset + f((x − offset) / step) · step
//   f ∈ {round, floor, ceil}
//   step=0 → passthrough

import { QuantizerOp } from './op_quantizer.worklet.js';

const SR = 48000;

function freshOp(step = 0.125, offset = 0, mode = 'round') {
  const op = new QuantizerOp(SR);
  op.reset();
  op.setParam('step', step);
  op.setParam('offset', offset);
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
    name: 'round: 0.3 with step=0.25 → 0.25',
    run() {
      const op = freshOp(0.25, 0, 'round');
      const out = run(op, 0.3, 4);
      const expect = Math.fround(0.25);
      for (let i = 0; i < 4; i++) if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'round: 0.4 with step=0.25 → 0.5 (half-up)',
    run() {
      const op = freshOp(0.25, 0, 'round');
      const out = run(op, 0.4, 4);
      const expect = Math.fround(0.5);
      if (out[0] !== expect) return { pass: false, why: `out[0]=${out[0]} expected ${expect}` };
      return { pass: true };
    },
  },
  {
    name: 'floor: 0.49 with step=0.25 → 0.25',
    run() {
      const op = freshOp(0.25, 0, 'floor');
      const out = run(op, 0.49, 4);
      if (Math.abs(out[0] - 0.25) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'ceil: 0.01 with step=0.25 → 0.25',
    run() {
      const op = freshOp(0.25, 0, 'ceil');
      const out = run(op, 0.01, 4);
      if (Math.abs(out[0] - 0.25) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'grid points pass through unchanged (exact)',
    run() {
      const op = freshOp(0.25, 0, 'round');
      const vals = [-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
      for (const v of vals) {
        const out = run(op, v, 1);
        if (Math.abs(out[0] - v) > 1e-6) return { pass: false, why: `v=${v} out=${out[0]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'offset shifts grid: offset=0.1, step=0.2 snaps to {..., 0.1, 0.3, 0.5, ...}',
    run() {
      const op = freshOp(0.2, 0.1, 'round');
      // 0.19 → (0.19-0.1)/0.2 = 0.45 → round 0 → 0.1+0=0.1
      const a = run(op, 0.19, 1);
      if (Math.abs(a[0] - 0.1) > 1e-6) return { pass: false, why: `0.19→${a[0]}` };
      // 0.25 → (0.15)/0.2=0.75 → round 1 → 0.1+0.2=0.3
      const b = run(op, 0.25, 1);
      if (Math.abs(b[0] - 0.3) > 1e-6) return { pass: false, why: `0.25→${b[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'step=0 → passthrough (bypass)',
    run() {
      const op = freshOp(0, 0, 'round');
      const inBuf = new Float32Array([0.1, -0.37, 0.999, -1]);
      const out = new Float32Array(4);
      op.process({ in: inBuf }, { out }, 4);
      for (let i = 0; i < 4; i++) if (out[i] !== inBuf[i]) return { pass: false, why: `i=${i} in=${inBuf[i]} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative step → absolute value (same as positive)',
    run() {
      const op = freshOp(0.25, 0, 'round');
      op.setParam('step', -0.25);
      const out = run(op, 0.3, 1);
      const expect = Math.fround(0.25);
      if (out[0] !== expect) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'negative input: symmetric round',
    run() {
      const op = freshOp(0.25, 0, 'round');
      // -0.3 → round(-1.2) = -1 → -0.25
      const out = run(op, -0.3, 1);
      if (Math.abs(out[0] - -0.25) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'stepped LFO: 11-step snap of ramp 0..1 yields 11 distinct values',
    run() {
      const op = freshOp(0.1, 0, 'round');
      const N = 256;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = i / (N - 1);   // 0..1 ramp
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      // Count unique values (tolerance-aware).
      const uniq = new Set();
      for (let i = 0; i < N; i++) uniq.add(Math.round(out[i] * 100));  // ×100 to dedupe float noise
      if (uniq.size !== 11) return { pass: false, why: `got ${uniq.size} unique levels (expected 11)` };
      return { pass: true };
    },
  },
  {
    name: 'numeric mode accepted (0=round, 1=floor, 2=ceil)',
    run() {
      const op = new QuantizerOp(SR);
      op.reset();
      op.setParam('step', 0.25);
      op.setParam('mode', 1);
      const a = run(op, 0.49, 1);
      if (Math.abs(a[0] - 0.25) > 1e-6) return { pass: false, why: `floor: ${a[0]}` };
      op.setParam('mode', 2);
      const b = run(op, 0.01, 1);
      if (Math.abs(b[0] - 0.25) > 1e-6) return { pass: false, why: `ceil: ${b[0]}` };
      op.setParam('mode', 0);
      const c = run(op, 0.13, 1);
      if (Math.abs(c[0] - 0.25) > 1e-6) return { pass: false, why: `round 0.13: ${c[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'unknown mode string is sticky last-good',
    run() {
      const op = freshOp(0.25, 0, 'floor');
      op.setParam('mode', 'banana');
      const out = run(op, 0.49, 1);
      // Should still be floor.
      if (Math.abs(out[0] - 0.25) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp(0.25, 0, 'round');
      op.setParam('step', Number.NaN);
      op.setParam('offset', Number.POSITIVE_INFINITY);
      const out = run(op, 0.3, 1);
      // Step/offset unchanged: 0.3 snaps to 0.25.
      if (Math.abs(out[0] - 0.25) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: emits quantised 0',
    run() {
      const op = freshOp(0.25, 0.1, 'round');
      const out = new Float32Array(16);
      op.process({}, { out }, 16);
      // 0 → offset + round((0-0.1)/0.25)·0.25 = 0.1 + round(-0.4)·0.25 = 0.1 + 0 = 0.1
      // (JS Math.round(-0.4) = 0; half-to-even might differ but we're at -0.4.)
      const expect = 0.1;
      for (let i = 0; i < 16; i++) if (Math.abs(out[i] - expect) > 1e-6) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input with step=0: all zeros',
    run() {
      const op = freshOp(0, 0.1, 'round');
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
      op.process({ in: new Float32Array(64).fill(0.5) }, {}, 64);
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
    name: 'stateless: reset is no-op',
    run() {
      const op = freshOp(0.25, 0, 'round');
      run(op, 0.3, 100);
      op.reset();
      const out = run(op, 0.3, 1);
      const expect = Math.fround(0.25);
      if (out[0] !== expect) return { pass: false, why: `after reset out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(0.1, 0.05, 'round');
      const b = freshOp(0.1, 0.05, 'round');
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
  {
    name: 'semitone snap: 1/12 step on normalized pitch CV',
    run() {
      // Input: smooth value 0.333 (4 semitones up out of 12). Expected snap
      // to 4/12 = 0.3333...
      const op = freshOp(1 / 12, 0, 'round');
      const out = run(op, 0.333, 1);
      // 0.333/(1/12) = 3.996 → round 4 → 4/12 ≈ 0.3333
      if (Math.abs(out[0] - 4 / 12) > 1e-5) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'quantizer', tests };
