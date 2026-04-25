// op_ramp.test.js — real-math tests for op_ramp.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Triggered one-shot linear ramp generator.
//   Rising-edge trig → phase=0, active=true.
//   Per sample: phase += 1/(timeMs·sr/1000); saturates at 1.
//   out = startVal + (endVal − startVal) · phase.

import { RampOp } from './op_ramp.worklet.js';

const SR = 48000;

function freshOp(startVal = 0, endVal = 1, timeMs = 100) {
  const op = new RampOp(SR);
  op.reset();
  op.setParam('startVal', startVal);
  op.setParam('endVal', endVal);
  op.setParam('timeMs', timeMs);
  return op;
}

function runWithPluck(op, nOut, pluckAt = 0) {
  const trig = new Float32Array(nOut);
  if (pluckAt >= 0) trig[pluckAt] = 1;
  const out = new Float32Array(nOut);
  op.process({ trig }, { out }, nOut);
  return out;
}

const tests = [
  {
    name: 'before any trigger → held at startVal',
    run() {
      const op = freshOp(0.3, 0.7, 100);
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      const expect = Math.fround(0.3);
      for (let i = 0; i < 64; i++) if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'trigger kicks off linear ramp',
    run() {
      const timeMs = 10;
      const op = freshOp(0, 1, timeMs);
      const step = 1 / (timeMs * SR * 0.001);  // 1/480 ≈ 0.00208
      const out = runWithPluck(op, 4, 0);
      // i=0: trig>0.5 → set phase=0, active=true; then advance: phase=step.
      // out = 0 + 1·step = step.
      if (Math.abs(out[0] - step) > 1e-7) return { pass: false, why: `out[0]=${out[0]} expected ${step}` };
      if (Math.abs(out[1] - 2 * step) > 1e-7) return { pass: false, why: `out[1]=${out[1]}` };
      if (Math.abs(out[3] - 4 * step) > 1e-7) return { pass: false, why: `out[3]=${out[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'ramp completes in ceil(timeMs·sr/1000) samples then holds at endVal',
    run() {
      const timeMs = 10;
      const op = freshOp(0, 1, timeMs);
      const nSamples = Math.ceil(timeMs * SR * 0.001);  // 480
      const out = runWithPluck(op, nSamples + 100, 0);
      // By sample nSamples-1, phase should be >= 1 and clamped to 1.
      // End value = 1.
      const endF = Math.fround(1);
      for (let i = nSamples; i < nSamples + 100; i++) {
        if (out[i] !== endF) return { pass: false, why: `i=${i} out=${out[i]} expected ${endF}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'asymmetric start/end values',
    run() {
      const op = freshOp(-0.5, 0.8, 5);
      const N = Math.ceil(5 * SR * 0.001) + 100;
      const out = runWithPluck(op, N, 0);
      // Endpoint = 0.8, after sweep done.
      const endF = Math.fround(0.8);
      if (out[N - 1] !== endF) return { pass: false, why: `end=${out[N - 1]} expected ${endF}` };
      // First sample: step = 1/(5·48) = 0.004166..., out[0] = -0.5 + 1.3·step
      const step = 1 / (5 * SR * 0.001);
      const expect0 = -0.5 + 1.3 * step;
      if (Math.abs(out[0] - expect0) > 1e-5) return { pass: false, why: `out[0]=${out[0]} expected ${expect0}` };
      return { pass: true };
    },
  },
  {
    name: 'timeMs=0 → instant jump to endVal on trigger',
    run() {
      const op = freshOp(0, 1, 0);
      const out = runWithPluck(op, 4, 0);
      const endF = Math.fround(1);
      // On trigger sample phase += step(inf), clamps to 1 → out = endVal.
      for (let i = 0; i < 4; i++) if (out[i] !== endF) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 're-triggering restarts from startVal',
    run() {
      const timeMs = 10;
      const op = freshOp(0, 1, timeMs);
      const nRampSamples = Math.ceil(timeMs * SR * 0.001);
      const N = nRampSamples + 200;
      const trig = new Float32Array(N);
      trig[0] = 1;                    // first pluck
      trig[nRampSamples + 50] = 0;    // ensure low before 2nd pluck
      trig[nRampSamples + 100] = 1;   // second pluck
      const out = new Float32Array(N);
      op.process({ trig }, { out }, N);
      // At the sample right before 2nd trigger, out should be 1 (done).
      const before = out[nRampSamples + 99];
      if (Math.abs(before - 1) > 1e-5) return { pass: false, why: `before 2nd pluck out=${before}` };
      // On the 2nd trigger sample, phase reset to 0 then +step.
      const step = 1 / (timeMs * SR * 0.001);
      const after = out[nRampSamples + 100];
      if (Math.abs(after - step) > 1e-5) return { pass: false, why: `after 2nd pluck out=${after} expected ${step}` };
      return { pass: true };
    },
  },
  {
    name: 'trig must go low-then-high to retrigger (no spurious ramp)',
    run() {
      const op = freshOp(0, 1, 10);
      // Hold trig high for entire block.
      const N = SR * 0.1 | 0;
      const trig = new Float32Array(N).fill(1);
      const out = new Float32Array(N);
      op.process({ trig }, { out }, N);
      // Ramp completes once, then holds at 1 despite held trigger.
      const tail = out.subarray(N - 100);
      const endF = Math.fround(1);
      for (let i = 0; i < tail.length; i++) if (tail[i] !== endF) return { pass: false, why: `tail i=${i}: ${tail[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary state carry',
    run() {
      const op = freshOp(0, 1, 10);
      // Pluck in block A, continue ramp in block B.
      const trigA = new Float32Array(4); trigA[0] = 1;
      const outA = new Float32Array(4);
      op.process({ trig: trigA }, { out: outA }, 4);
      const step = 1 / (10 * SR * 0.001);
      // Block B with no trigger — ramp keeps advancing.
      const outB = new Float32Array(4);
      op.process({ trig: new Float32Array(4) }, { out: outB }, 4);
      // B[0] should be 5·step (continuing from A[3]=4·step).
      if (Math.abs(outB[0] - 5 * step) > 1e-6) return { pass: false, why: `B[0]=${outB[0]} expected ${5 * step}` };
      return { pass: true };
    },
  },
  {
    name: 'reset returns to startVal before trigger',
    run() {
      const op = freshOp(0.3, 0.7, 10);
      runWithPluck(op, 100, 0);  // run ramp to completion
      op.reset();
      // After reset, no trigger → hold at startVal.
      const out = new Float32Array(16);
      op.process({}, { out }, 16);
      const startF = Math.fround(0.3);
      for (let i = 0; i < 16; i++) if (out[i] !== startF) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing trig input: ramp does not advance',
    run() {
      const op = freshOp(0, 1, 100);
      const out = new Float32Array(128);
      op.process({}, { out }, 128);
      // No trigger ever → output held at 0.
      for (let i = 0; i < 128; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      const trig = new Float32Array(64); trig[0] = 1;
      op.process({ trig }, {}, 64);
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
    name: 'negative timeMs clamped to 0 (instant)',
    run() {
      const op = freshOp(0, 1);
      op.setParam('timeMs', -5);
      const out = runWithPluck(op, 4, 0);
      const endF = Math.fround(1);
      for (let i = 0; i < 4; i++) if (out[i] !== endF) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp(0, 1, 10);
      op.setParam('timeMs', Number.NaN);
      op.setParam('startVal', Number.POSITIVE_INFINITY);
      op.setParam('endVal', Number.NEGATIVE_INFINITY);
      // All unchanged; behaves as 0→1 over 10ms.
      const step = 1 / (10 * SR * 0.001);
      const out = runWithPluck(op, 2, 0);
      if (Math.abs(out[0] - step) > 1e-7) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'descending ramp: endVal < startVal',
    run() {
      const op = freshOp(1, 0, 10);
      const step = 1 / (10 * SR * 0.001);
      const out = runWithPluck(op, 4, 0);
      // out = 1 + (-1)·phase. out[0] = 1 − step.
      if (Math.abs(out[0] - (1 - step)) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      if (Math.abs(out[3] - (1 - 4 * step)) > 1e-6) return { pass: false, why: `out[3]=${out[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(0, 1, 25);
      const b = freshOp(0, 1, 25);
      const oA = runWithPluck(a, 2048, 0);
      const oB = runWithPluck(b, 2048, 0);
      for (let i = 0; i < 2048; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'ramp', tests };
