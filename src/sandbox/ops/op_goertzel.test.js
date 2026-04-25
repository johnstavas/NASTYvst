// op_goertzel.test.js — real-math tests for op_goertzel.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Goertzel single-bin magnitude detector. Canon:analysis §1.
//   Output held between block updates; latency = blockN.

import { GoertzelOp } from './op_goertzel.worklet.js';

const SR = 48000;

function freshOp(freq = 1000, blockN = 512) {
  const op = new GoertzelOp(SR);
  op.reset();
  op.setParam('freq', freq);
  op.setParam('blockN', blockN);
  return op;
}

function sineBuf(freq, amp, n) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  return buf;
}

function runSine(op, freq, amp, n) {
  const inBuf = sineBuf(freq, amp, n);
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { mag: out }, n);
  return out;
}

const tests = [
  {
    name: 'on-bin sine (1 kHz at 1 kHz): mag ≈ sine amplitude',
    run() {
      const op = freshOp(1000, 512);
      // Run 4 blocks so we get several updated magnitudes.
      const N = 512 * 4;
      const out = runSine(op, 1000, 0.5, N);
      // Sample from the last block — should be close to amplitude 0.5.
      const final = out[N - 1];
      if (Math.abs(final - 0.5) > 0.05) return { pass: false, why: `mag=${final} expected ≈0.5` };
      return { pass: true };
    },
  },
  {
    name: 'off-bin sine (500 Hz tuned to 1 kHz): mag ≪ on-bin',
    run() {
      const opOn  = freshOp(1000, 512);
      const opOff = freshOp(500,  512);
      const N = 512 * 4;
      const magOn = runSine(opOn, 1000, 0.5, N)[N - 1];
      const magOffBinTuning = runSine(opOff, 1000, 0.5, N)[N - 1];
      // Off-bin should be well below on-bin (leakage with no window ~10-20%).
      if (magOffBinTuning > magOn * 0.5) return { pass: false, why: `on=${magOn} offBinTuning=${magOffBinTuning}` };
      return { pass: true };
    },
  },
  {
    name: 'zero input → mag = 0',
    run() {
      const op = freshOp(1000, 256);
      const out = new Float32Array(1024);
      op.process({ in: new Float32Array(1024) }, { mag: out }, 1024);
      for (let i = 256; i < 1024; i++) {
        if (Math.abs(out[i]) > 1e-6) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'output is piecewise-constant within a block',
    run() {
      const op = freshOp(1000, 256);
      const N = 256 * 3;
      const out = runSine(op, 1000, 0.5, N);
      // Block 1 updates lastMag at i=255 (end of first window) and writes
      // it there; indices 256..510 hold that value. At i=511 block 2
      // closes and writes a fresh mag — so check constancy up to 510.
      for (let i = 257; i < 511; i++) {
        if (out[i] !== out[256]) return { pass: false, why: `i=${i} differs from block-start` };
      }
      return { pass: true };
    },
  },
  {
    name: 'amplitude scaling: 2× input → 2× mag',
    run() {
      const a = freshOp(1000, 512);
      const b = freshOp(1000, 512);
      const N = 512 * 4;
      const magA = runSine(a, 1000, 0.25, N)[N - 1];
      const magB = runSine(b, 1000, 0.50, N)[N - 1];
      const ratio = magB / magA;
      if (Math.abs(ratio - 2) > 0.1) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },
  {
    name: 'different target freq reconfigures correctly',
    run() {
      const op = freshOp(1000, 512);
      const N = 512 * 4;
      runSine(op, 1000, 0.5, N);
      op.setParam('freq', 2000);
      // Feed 2 kHz — should now read strong.
      const out = runSine(op, 2000, 0.5, N);
      if (Math.abs(out[N - 1] - 0.5) > 0.05) return { pass: false, why: `reconfig mag=${out[N - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'blockN change resets accumulators mid-block',
    run() {
      const op = freshOp(1000, 512);
      // Partial block of sine then change blockN.
      runSine(op, 1000, 0.5, 256);
      op.setParam('blockN', 256);
      // Feed 2 full 256-sample blocks of the tone; read final mag.
      const out = runSine(op, 1000, 0.5, 512);
      if (Math.abs(out[511] - 0.5) > 0.08) return { pass: false, why: `post-change mag=${out[511]}` };
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() reports blockN',
    run() {
      const op = freshOp(1000, 512);
      if (op.getLatencySamples() !== 512) return { pass: false, why: `got ${op.getLatencySamples()}` };
      op.setParam('blockN', 1024);
      if (op.getLatencySamples() !== 1024) return { pass: false, why: `after change: ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'freq clamping: below 1 Hz, above Nyquist',
    run() {
      const op = freshOp();
      op.setParam('freq', 0);
      op.setParam('freq', 1e9);
      // Should not throw or produce NaN on any input.
      const out = runSine(op, 1000, 0.5, 1024);
      for (let i = 0; i < 1024; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'blockN clamping: 1 → 16 (min), huge → 8192 (max)',
    run() {
      const op = freshOp();
      op.setParam('blockN', 1);
      if (op.getLatencySamples() !== 16) return { pass: false, why: `min clamp: ${op.getLatencySamples()}` };
      op.setParam('blockN', 100000);
      if (op.getLatencySamples() !== 8192) return { pass: false, why: `max clamp: ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp(1000, 512);
      op.setParam('freq', Number.NaN);
      op.setParam('blockN', Number.POSITIVE_INFINITY);
      // State unchanged — 1 kHz sine still detected.
      const out = runSine(op, 1000, 0.5, 512 * 4);
      if (Math.abs(out[out.length - 1] - 0.5) > 0.05) return { pass: false, why: `mag=${out[out.length - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears accumulators and lastMag',
    run() {
      const op = freshOp(1000, 256);
      runSine(op, 1000, 0.5, 256 * 3);  // several blocks
      op.reset();
      // After reset, first block should give mag=0 until accumulator fills.
      const out = runSine(op, 1000, 0.5, 128);
      if (out[0] !== 0) return { pass: false, why: `post-reset out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: mag decays to 0',
    run() {
      const op = freshOp(1000, 256);
      runSine(op, 1000, 0.5, 256 * 3);   // establish nonzero mag
      const out = new Float32Array(1024);
      op.process({}, { mag: out }, 1024);
      // After at least one block of silence, mag should be 0.
      for (let i = 512; i < 1024; i++) {
        if (Math.abs(out[i]) > 1e-6) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: sineBuf(1000, 0.5, 64) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(1000, 512);
      const b = freshOp(1000, 512);
      const N = 512 * 4;
      const inBuf = sineBuf(1000, 0.5, N);
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ in: inBuf }, { mag: oA }, N);
      b.process({ in: inBuf }, { mag: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'selectivity: two-tone input — mag tracks tuned bin',
    run() {
      const op = freshOp(2000, 512);
      const N = 512 * 4;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        // Weak 1 kHz + strong 2 kHz.
        inBuf[i] = 0.1 * Math.sin(2 * Math.PI * 1000 * i / SR)
                 + 0.5 * Math.sin(2 * Math.PI * 2000 * i / SR);
      }
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { mag: out }, N);
      // Should read close to 0.5 (the tuned 2kHz component).
      if (Math.abs(out[N - 1] - 0.5) > 0.1) return { pass: false, why: `mag=${out[N - 1]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'goertzel', tests };
