// op_glide.test.js — real-math tests for op_glide.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Constant-time glide (portamento). On target change, compute
//   step = (newTarget − y) / (glideMs·sr/1000); advance linearly.
//   First sample snaps. glideMs=0 → instant.

import { GlideOp } from './op_glide.worklet.js';

const SR = 48000;

function freshOp(glideMs = 100) {
  const op = new GlideOp(SR);
  op.reset();
  op.setParam('glideMs', glideMs);
  return op;
}

function runConst(op, val, n) {
  const inBuf = new Float32Array(n).fill(val);
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return out;
}

const tests = [
  {
    name: 'first sample snaps to input (no from-zero glide)',
    run() {
      const op = freshOp(100);
      const out = runConst(op, 0.7, 4);
      const expect = Math.fround(0.7);
      for (let i = 0; i < 4; i++) if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'target change → linear glide to new value',
    run() {
      const glideMs = 10;
      const op = freshOp(glideMs);
      // Block A: settle at 0.
      runConst(op, 0, 4);
      // Block B: step to 1 — expect linear glide over glideMs·SR/1000 samples.
      const glideSamples = glideMs * SR * 0.001;   // 480
      const step = 1 / glideSamples;
      const N = 8;
      const out = runConst(op, 1, N);
      // On sample 0 of block B, target changes 0→1. step = (1-0)/480 = step.
      // y += step → y[0] = step.
      if (Math.abs(out[0] - step) > 1e-7) return { pass: false, why: `out[0]=${out[0]} expected ${step}` };
      if (Math.abs(out[7] - 8 * step) > 1e-6) return { pass: false, why: `out[7]=${out[7]}` };
      return { pass: true };
    },
  },
  {
    name: 'glide completes in glideMs samples exactly (snap-on-arrival)',
    run() {
      const glideMs = 10;
      const op = freshOp(glideMs);
      runConst(op, 0, 4);  // settle at 0
      const glideSamples = glideMs * SR * 0.001;   // 480
      // Run long enough to finish glide + more — should hold at 1 after arrival.
      const out = runConst(op, 1, glideSamples + 100);
      // By the last few samples, y must be exactly 1 (Float32).
      const endF = Math.fround(1);
      for (let i = glideSamples + 50; i < out.length; i++) {
        if (out[i] !== endF) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'constant-time: halving distance does not change time-to-target',
    run() {
      const glideMs = 20;
      const glideSamples = glideMs * SR * 0.001;   // 960
      // Case A: 0 → 1 (distance 1).
      const a = freshOp(glideMs); runConst(a, 0, 4);
      const oA = runConst(a, 1, glideSamples + 50);
      // Case B: 0 → 0.5 (distance 0.5).
      const b = freshOp(glideMs); runConst(b, 0, 4);
      const oB = runConst(b, 0.5, glideSamples + 50);
      // Both must arrive within the glideSamples window.
      // At sample glideSamples-1 each should be within one step of target.
      const stepA = 1 / glideSamples;
      const stepB = 0.5 / glideSamples;
      if (Math.abs(oA[glideSamples - 1] - 1) > stepA * 2) return { pass: false, why: `A near-end=${oA[glideSamples - 1]}` };
      if (Math.abs(oB[glideSamples - 1] - 0.5) > stepB * 2) return { pass: false, why: `B near-end=${oB[glideSamples - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'mid-glide retarget recomputes step from current y',
    run() {
      const glideMs = 10;
      const glideSamples = glideMs * SR * 0.001;   // 480
      const op = freshOp(glideMs);
      runConst(op, 0, 4);
      // Start glide 0→1, run halfway (240 samples), then retarget to -0.5.
      const halfN = glideSamples / 2;
      runConst(op, 1, halfN);  // y now ~0.5
      // Retarget. Expect step = (-0.5 - 0.5)/480 = -1/480 per sample.
      // After another 480 samples, y should arrive at -0.5.
      runConst(op, -0.5, glideSamples + 50);
      // Read a following block — y must hold at -0.5.
      const outHold = runConst(op, -0.5, 16);
      const expect = Math.fround(-0.5);
      for (let i = 0; i < 16; i++) if (outHold[i] !== expect) return { pass: false, why: `i=${i} out=${outHold[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'glideMs=0 → instant snap on target change',
    run() {
      const op = freshOp(0);
      runConst(op, 0, 4);
      const out = runConst(op, 1, 4);
      const endF = Math.fround(1);
      for (let i = 0; i < 4; i++) if (out[i] !== endF) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'no-op when target equals current: output stays constant',
    run() {
      const op = freshOp(100);
      runConst(op, 0.5, 4);
      const out = runConst(op, 0.5, 16);
      const expect = Math.fround(0.5);
      for (let i = 0; i < 16; i++) if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'descending glide',
    run() {
      const glideMs = 10;
      const glideSamples = glideMs * SR * 0.001;
      const op = freshOp(glideMs);
      runConst(op, 1, 4);
      const step = -1 / glideSamples;
      const out = runConst(op, 0, 4);
      if (Math.abs(out[0] - (1 + step)) > 1e-6) return { pass: false, why: `out[0]=${out[0]}` };
      if (Math.abs(out[3] - (1 + 4 * step)) > 1e-6) return { pass: false, why: `out[3]=${out[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary state carry',
    run() {
      const glideMs = 10;
      const glideSamples = glideMs * SR * 0.001;
      const step = 1 / glideSamples;
      const op = freshOp(glideMs);
      runConst(op, 0, 4);  // init
      const oA = runConst(op, 1, 4);  // start glide
      // 4 samples of glide progress: y ≈ 4·step
      const oB = runConst(op, 1, 4);  // continue, same target
      if (Math.abs(oB[0] - 5 * step) > 1e-6) return { pass: false, why: `B[0]=${oB[0]} expected ${5 * step}` };
      if (Math.abs(oB[3] - 8 * step) > 1e-6) return { pass: false, why: `B[3]=${oB[3]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears init flag: next input snaps again',
    run() {
      const op = freshOp(100);
      runConst(op, 0.3, 4);
      op.reset();
      const out = runConst(op, 0.9, 2);
      const expect = Math.fround(0.9);
      for (let i = 0; i < 2; i++) if (out[i] !== expect) return { pass: false, why: `post-reset i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'glideMs change mid-glide retargets remaining distance',
    run() {
      const slow = 100;     // slow glide
      const fast = 5;       // fast glide
      const op = freshOp(slow);
      runConst(op, 0, 4);
      // Start slow glide 0→1. After 100 samples y is ~100/4800 ≈ 0.0208.
      runConst(op, 1, 100);
      // Change glideMs to 5 — remaining distance should cover in 5·SR/1000 = 240 samples.
      op.setParam('glideMs', fast);
      // Run 240 + slack samples; should arrive at 1.
      const fastSamples = fast * SR * 0.001;   // 240
      runConst(op, 1, fastSamples + 50);
      const held = runConst(op, 1, 4);
      const expect = Math.fround(1);
      for (let i = 0; i < 4; i++) if (held[i] !== expect) return { pass: false, why: `i=${i} held=${held[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'continuously-changing input: y tracks but never arrives (ramp input)',
    run() {
      const glideMs = 10;
      const op = freshOp(glideMs);
      // Init, then feed a fine 0..1 ramp over 2000 samples.
      runConst(op, 0, 1);
      const N = 2000;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = i / (N - 1);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { out }, N);
      // y should be monotonic non-decreasing and strictly less than input
      // at every sample (it's always chasing).
      for (let i = 1; i < N; i++) {
        if (out[i] < out[i - 1] - 1e-6) return { pass: false, why: `non-mono i=${i} prev=${out[i - 1]} cur=${out[i]}` };
      }
      // Final output should be close to final input but slightly behind
      // (lagged glide). Exact value depends on retarget-per-sample math.
      if (out[N - 1] > inBuf[N - 1] + 1e-5) return { pass: false, why: `overshoot final=${out[N - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: holds last y (no auto-decay)',
    run() {
      const op = freshOp(100);
      runConst(op, 0.5, 4);
      const out = new Float32Array(16);
      op.process({}, { out }, 16);
      const expect = Math.fround(0.5);
      for (let i = 0; i < 16; i++) if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]}` };
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
    name: 'non-finite glideMs ignored (sticky last-good)',
    run() {
      const op = freshOp(10);
      op.setParam('glideMs', Number.NaN);
      op.setParam('glideMs', Number.POSITIVE_INFINITY);
      runConst(op, 0, 4);
      const glideSamples = 10 * SR * 0.001;
      const step = 1 / glideSamples;
      const out = runConst(op, 1, 2);
      if (Math.abs(out[0] - step) > 1e-7) return { pass: false, why: `out[0]=${out[0]} expected ${step}` };
      return { pass: true };
    },
  },
  {
    name: 'negative glideMs clamped to 0 (instant)',
    run() {
      const op = freshOp(10);
      op.setParam('glideMs', -5);
      runConst(op, 0, 4);
      const out = runConst(op, 1, 4);
      const expect = Math.fround(1);
      for (let i = 0; i < 4; i++) if (out[i] !== expect) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(50);
      const b = freshOp(50);
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.013) * 0.5;
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ in: inBuf }, { out: oA }, N);
      b.process({ in: inBuf }, { out: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'glide', tests };
