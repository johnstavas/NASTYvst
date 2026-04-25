// op_lpc.test.js — real-math tests for op_lpc.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Linear-predictive coding residual filter. Canon:analysis §2.
//   Outputs the prediction-error signal; coefficients held internally.
//   First blockN samples = 0 (no coefs yet); steady-state latency = blockN.

import { LpcOp } from './op_lpc.worklet.js';

const SR = 48000;

function freshOp(order = 12, blockN = 256) {
  const op = new LpcOp(SR);
  op.reset();
  op.setParam('order',  order);
  op.setParam('blockN', blockN);
  return op;
}

function sineBuf(freq, amp, n, phase = 0) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / SR + phase);
  return buf;
}

function whiteBuf(n, seed = 1) {
  // Deterministic PRNG (Canon:synthesis §10 LCG).
  let s = seed >>> 0;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    buf[i] = (s / 0xffffffff) * 2 - 1;
  }
  return buf;
}

function runBuf(op, inBuf) {
  const out = new Float32Array(inBuf.length);
  op.process({ in: inBuf }, { residual: out }, inBuf.length);
  return out;
}

// Energy over a slice.
function energy(buf, start, end) {
  let e = 0;
  for (let i = start; i < end; i++) e += buf[i] * buf[i];
  return e / (end - start);
}

const tests = [
  {
    name: 'first blockN samples emit zero (no coefs yet)',
    run() {
      const op = freshOp(12, 256);
      const out = runBuf(op, sineBuf(440, 0.5, 256));
      for (let i = 0; i < 256; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]} (expected 0 in first block)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pure DC: residual ≈ 0 after first block',
    run() {
      const op = freshOp(12, 256);
      const inBuf = new Float32Array(256 * 4);
      for (let i = 0; i < inBuf.length; i++) inBuf[i] = 0.3;
      const out = runBuf(op, inBuf);
      // After first two blocks (coefs computed + applied), residual tiny.
      const e = energy(out, 512, 1024);
      if (e > 1e-3) return { pass: false, why: `energy=${e} expected ≈0` };
      return { pass: true };
    },
  },
  {
    name: 'pure sine: residual ≪ input after coefs settle',
    run() {
      const op = freshOp(12, 512);
      const inBuf = sineBuf(440, 0.5, 512 * 4);
      const out   = runBuf(op, inBuf);
      const eIn   = energy(inBuf, 1024, 2048);
      const eOut  = energy(out,   1024, 2048);
      // A 12-pole LPC should predict a single sine nearly perfectly.
      if (eOut > eIn * 0.05) return { pass: false, why: `eIn=${eIn} eOut=${eOut} ratio=${eOut/eIn}` };
      return { pass: true };
    },
  },
  {
    name: 'white noise: residual energy comparable to input (nothing to predict)',
    run() {
      const op = freshOp(12, 512);
      const inBuf = whiteBuf(512 * 4, 42);
      const out   = runBuf(op, inBuf);
      const eIn   = energy(inBuf, 1024, 2048);
      const eOut  = energy(out,   1024, 2048);
      // Whitening a flat spectrum shouldn't remove much energy.
      // Allow 0.3 ≤ ratio ≤ 2.0 — LPC can't compress flat spectra much.
      const ratio = eOut / eIn;
      if (ratio < 0.3 || ratio > 2.0) return { pass: false, why: `ratio=${ratio} (expected 0.3..2.0)` };
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() reports blockN',
    run() {
      const op = freshOp(12, 1024);
      if (op.getLatencySamples() !== 1024) return { pass: false, why: `got ${op.getLatencySamples()}` };
      op.setParam('blockN', 512);
      if (op.getLatencySamples() !== 512) return { pass: false, why: `after change: ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'order clamp: 0 → 1 (min), huge → 32 (max)',
    run() {
      const op = freshOp();
      op.setParam('order', 0);
      // Can't directly inspect order, but we can check via reset+behavior:
      // with order=1, sine residual should be less suppressed than order=12.
      const op1  = freshOp(0,  512);   // clamps to 1
      const op12 = freshOp(12, 512);
      const inBuf = sineBuf(440, 0.5, 512 * 4);
      const e1  = energy(runBuf(op1,  inBuf), 1024, 2048);
      const e12 = energy(runBuf(op12, inBuf), 1024, 2048);
      if (e12 >= e1) return { pass: false, why: `e1=${e1} e12=${e12} — higher order should suppress sine more` };
      // Max clamp: setParam('order', 999) shouldn't throw or produce NaN.
      const opMax = new LpcOp(SR);
      opMax.reset();
      opMax.setParam('order', 999);
      opMax.setParam('blockN', 512);
      const out = runBuf(opMax, sineBuf(440, 0.5, 512 * 3));
      for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `NaN/Inf at i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'blockN clamp: 10 → 64 (min), huge → 8192 (max)',
    run() {
      const op = freshOp();
      op.setParam('blockN', 10);
      if (op.getLatencySamples() !== 64) return { pass: false, why: `min clamp: ${op.getLatencySamples()}` };
      op.setParam('blockN', 99999);
      if (op.getLatencySamples() !== 8192) return { pass: false, why: `max clamp: ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp(12, 256);
      op.setParam('order',  Number.NaN);
      op.setParam('blockN', Number.POSITIVE_INFINITY);
      if (op.getLatencySamples() !== 256) return { pass: false, why: `blockN changed: ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state: first block zero again',
    run() {
      const op = freshOp(12, 256);
      runBuf(op, sineBuf(440, 0.5, 256 * 3));  // establish coefs
      op.reset();
      const out = runBuf(op, sineBuf(440, 0.5, 128));
      for (let i = 0; i < 128; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]} (expected 0 post-reset)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input: residual = 0',
    run() {
      const op = freshOp(12, 256);
      // Run some sine first so coefs exist, then feed missing input.
      runBuf(op, sineBuf(440, 0.5, 256 * 3));
      const out = new Float32Array(512);
      op.process({}, { residual: out }, 512);
      for (let i = 0; i < 512; i++) {
        // residual of silent input under stable coefs = 0 (all history eventually zero).
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      // After at least blockN of silence, coefs recompute on all-zero window → hasCoefs=false → out=0.
      for (let i = 256; i < 512; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]} expected 0 in silence-gate region` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: sineBuf(440, 0.5, 128) }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'order change resets coefs (silence-out for 1 block)',
    run() {
      const op = freshOp(8, 256);
      runBuf(op, sineBuf(440, 0.5, 256 * 3));  // settle coefs
      op.setParam('order', 16);
      const out = runBuf(op, sineBuf(440, 0.5, 128));
      for (let i = 0; i < 128; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]} — coefs should reset on order change` };
      }
      return { pass: true };
    },
  },
  {
    name: 'block boundary: no NaN on extreme input',
    run() {
      const op = freshOp(12, 256);
      const inBuf = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) inBuf[i] = (i % 2 ? 1 : -1) * 10.0;  // big square
      const out = runBuf(op, inBuf);
      for (let i = 0; i < 1024; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(12, 256);
      const b = freshOp(12, 256);
      const inBuf = sineBuf(440, 0.5, 256 * 4);
      const oA = runBuf(a, inBuf);
      const oB = runBuf(b, inBuf);
      for (let i = 0; i < oA.length; i++) {
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} a=${oA[i]} b=${oB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'higher order suppresses multi-sine better than low order',
    run() {
      const inBuf = new Float32Array(512 * 4);
      for (let i = 0; i < inBuf.length; i++) {
        inBuf[i] = 0.3 * Math.sin(2*Math.PI*300*i/SR)
                 + 0.3 * Math.sin(2*Math.PI*700*i/SR)
                 + 0.3 * Math.sin(2*Math.PI*1100*i/SR);
      }
      const op4  = freshOp(4,  512);
      const op16 = freshOp(16, 512);
      const e4  = energy(runBuf(op4,  inBuf), 1024, 2048);
      const e16 = energy(runBuf(op16, inBuf), 1024, 2048);
      if (e16 >= e4) return { pass: false, why: `e4=${e4} e16=${e16} — higher order should model 3 sines better` };
      return { pass: true };
    },
  },
  {
    name: 'stability: silence block yields zero coefs (no runaway on following block)',
    run() {
      const op = freshOp(12, 256);
      // Block 1: silence — silence-gate zeros coefs.
      // Block 2: sine — first sample uses history (all zeros) + zero coefs → passes through.
      const inBuf = new Float32Array(512);
      for (let i = 256; i < 512; i++) inBuf[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = runBuf(op, inBuf);
      // After the silent first block, hasCoefs=false → out[256..511] = 0.
      for (let i = 256; i < 512; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]} expected 0 (no coefs)` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'lpc', tests };
