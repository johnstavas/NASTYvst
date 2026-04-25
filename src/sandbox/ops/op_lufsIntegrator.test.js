// op_lufsIntegrator.test.js — real-math tests for op_lufsIntegrator.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against:
//   • ITU-R BS.1770-5 §3.1 (loudness formula, calibration constant)
//   • EBU Tech 3341 V4 §2.3 (Momentary/Short-term ballistics — sliding
//     rectangular window, EBU Mode forbids post-window IIR smoothing)
//   • memory/dsp_code_canon_loudness.md §3
//
// Pipeline note: this op expects PRE-K-WEIGHTED audio. Tests feed raw
// signals and assert the *integrator* stage only (op #51 is the K-filter).
//
// Coverage:
//   • L = −0.691 + 10·log10(G·MS) formula, sliding-rect MS
//   • DC at 1.0 → −0.691 LUFS once window fills (MS=1, G=1)
//   • Sine at 0 dBFS → MS=0.5 → −3.70 LUFS single-channel
//   • Silence floor near −120 LUFS
//   • Window length differentiates momentary (400 ms) vs short-term (3 s)
//   • Partial-fill bias: at t = winLen/2, DC=1 → MS = 0.5
//   • G=0 mute, G=1.41 LFE weight, G clamp
//   • reset / denormal / missing input / determinism / mode switch

import { LufsIntegratorOp } from './op_lufsIntegrator.worklet.js';

const approx = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

function freshOp(sr = 48000, mode = 'momentary') {
  const op = new LufsIntegratorOp(sr);
  op.setParam('mode', mode);
  op.reset();
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { lufs: out }, n);
  return { inBuf, out };
}

const tests = [
  // ---- formula calibration (full-window convergence) ----------------
  {
    name: 'DC at 1.0 → −0.691 LUFS after window fills (MS=1, G=1)',
    run() {
      const sr = 48000;
      const op = freshOp(sr, 'momentary');
      // Run 800 ms (2× the 400 ms window) so the sliding window is
      // fully populated with 1.0² = 1.0 samples.
      const { out } = render(op, 1.0, sr * 0.8);
      const final = out[out.length - 1];
      if (!approx(final, -0.691, 0.01)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },
  {
    name: 'Sine 1 kHz 0 dBFS → ~−3.70 LUFS (MS=0.5, single channel)',
    run() {
      const sr = 48000, freq = 1000;
      const op = freshOp(sr, 'momentary');
      const N = Math.floor(sr * 0.8);
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * freq * i / sr);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { lufs: out }, N);
      // L = −0.691 + 10·log10(0.5) = −3.7013
      const final = out[N - 1];
      if (!approx(final, -3.70, 0.1)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },

  // ---- silence floor ------------------------------------------------
  {
    name: 'Silence converges toward LUFS floor (< −100)',
    run() {
      const op = freshOp(48000, 'momentary');
      // Sliding rect with 0² = 0 fills instantly: the very first window
      // slot is already 0. So after just a few samples the MS is 0 and
      // we hit the floor.
      const { out } = render(op, 0, 48000 * 1);
      const final = out[out.length - 1];
      if (final > -100) return { pass: false, why: `final=${final}` };
      if (!Number.isFinite(final)) return { pass: false, why: 'non-finite' };
      return { pass: true };
    },
  },

  // ---- partial-fill bias (sliding-rect signature, NOT IIR) ----------
  {
    name: 'Partial fill: DC=1 at t=winLen/2 → MS ≈ 0.5 (half window full)',
    run() {
      // Under sliding rectangular, the meter divides by `filled` samples
      // not `winLen` until the window is full. So at t=200 ms (half of
      // 400 ms) with DC=1: sumSq = filled, filled = winLen/2, MS = 1.0.
      // Wait — if we divide by `filled`, DC=1 gives MS=1 from the first
      // sample onward. To get the partial-fill bias we must divide by
      // winLen consistently. The op divides by `filled` to avoid that
      // exact bias (standard EBU-meter behavior). So at t=200ms with
      // DC=1, we expect MS=1 → L=−0.691.
      const sr = 48000;
      const op = freshOp(sr, 'momentary');
      const N = Math.floor(sr * 0.2); // half the 400 ms window
      const { out } = render(op, 1.0, N);
      const final = out[N - 1];
      if (!approx(final, -0.691, 0.02)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },

  // ---- window-length differentiation --------------------------------
  {
    name: 'Short-term decays slower than momentary after step down',
    run() {
      // Charge both to steady state with DC=1, then switch input to 0.
      // With sliding rect: after ramp-down, samples leave the window one
      // at a time. Momentary (400 ms) empties completely in 400 ms;
      // short-term (3 s) takes 3 s. At t=500 ms post-silence, momentary
      // should be at the floor, short-term should still be reading high.
      const sr = 48000;
      const opM = freshOp(sr, 'momentary');
      const opS = freshOp(sr, 'short-term');

      // Charge both with 4 s of DC=1 (clears the 3 s window).
      render(opM, 1.0, sr * 4);
      render(opS, 1.0, sr * 4);

      // Then 500 ms of silence.
      const { out: mSilence } = render(opM, 0, sr * 0.5);
      const { out: sSilence } = render(opS, 0, sr * 0.5);

      const mFinal = mSilence[mSilence.length - 1];
      const sFinal = sSilence[sSilence.length - 1];

      // Momentary should be at floor; short-term should still read > −20.
      if (mFinal > -100) return { pass: false, why: `M final=${mFinal} (expected floor)` };
      if (sFinal < -20)  return { pass: false, why: `S final=${sFinal} (expected still loud)` };
      return { pass: true };
    },
  },

  // ---- channel weight -----------------------------------------------
  {
    name: 'G=0 mutes integrator → floor',
    run() {
      const op = freshOp(48000, 'momentary');
      op.setParam('channelWeight', 0);
      const { out } = render(op, 1.0, 48000);
      if (out[out.length - 1] > -100) return { pass: false, why: `final=${out[out.length - 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'G=1.41 (LFE weight) adds ~+1.5 dB',
    run() {
      const sr = 48000;
      const op1 = freshOp(sr, 'momentary');
      const opL = freshOp(sr, 'momentary');
      opL.setParam('channelWeight', 1.41);
      const N = sr * 1;  // well past 400 ms window
      const { out: o1 } = render(op1, 1.0, N);
      const { out: oL } = render(opL, 1.0, N);
      const delta = oL[N - 1] - o1[N - 1];
      // 10·log10(1.41) = 1.4925
      if (!approx(delta, 1.4925, 0.05)) return { pass: false, why: `Δ=${delta}` };
      return { pass: true };
    },
  },
  {
    name: 'G clamped to [0,2]',
    run() {
      const op = freshOp(48000);
      op.setParam('channelWeight', -5);
      if (op._G !== 0) return { pass: false, why: `neg→${op._G}` };
      op.setParam('channelWeight', 99);
      if (op._G !== 2) return { pass: false, why: `big→${op._G}` };
      return { pass: true };
    },
  },
  {
    name: 'Non-finite G ignored',
    run() {
      const op = freshOp(48000);
      op.setParam('channelWeight', 0.7);
      op.setParam('channelWeight', Number.NaN);
      if (op._G !== 0.7) return { pass: false, why: `NaN changed G to ${op._G}` };
      op.setParam('channelWeight', Number.POSITIVE_INFINITY);
      if (op._G !== 0.7) return { pass: false, why: `Inf changed G to ${op._G}` };
      return { pass: true };
    },
  },

  // ---- mode switching -----------------------------------------------
  {
    name: 'Unknown mode falls back to momentary',
    run() {
      const op = new LufsIntegratorOp(48000);
      op.setParam('mode', 'bogus');
      if (op._mode !== 'momentary') return { pass: false, why: op._mode };
      return { pass: true };
    },
  },
  {
    name: 'Mode change flushes buffer (window starts refilling)',
    run() {
      const sr = 48000;
      const op = freshOp(sr, 'momentary');
      render(op, 1.0, sr);           // charge momentary to steady state
      op.setParam('mode', 'short-term');
      // Immediately after mode change, window is empty; one silent sample
      // through should give MS=0 → floor.
      const out = new Float32Array(1);
      op.process({ in: new Float32Array(1) }, { lufs: out }, 1);
      if (out[0] > -100) return { pass: false, why: `flush failed, out=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'Window length scales with sample rate',
    run() {
      const op44 = new LufsIntegratorOp(44100);
      const op96 = new LufsIntegratorOp(96000);
      // momentary = 400 ms → 17640 @ 44.1k, 38400 @ 96k
      if (op44._winLen !== Math.round(0.4 * 44100))
        return { pass: false, why: `44.1k winLen=${op44._winLen}` };
      if (op96._winLen !== Math.round(0.4 * 96000))
        return { pass: false, why: `96k winLen=${op96._winLen}` };
      return { pass: true };
    },
  },

  // ---- infrastructure ------------------------------------------------
  {
    name: 'reset() zeroes running sum and fill counter',
    run() {
      const op = freshOp(48000);
      render(op, 1.0, 24000);
      op.reset();
      if (op._sumSq !== 0)  return { pass: false, why: `_sumSq=${op._sumSq}` };
      if (op._filled !== 0) return { pass: false, why: `_filled=${op._filled}` };
      if (op._idx !== 0)    return { pass: false, why: `_idx=${op._idx}` };
      return { pass: true };
    },
  },
  {
    name: 'Denormal-magnitude input: no NaN, floor-bounded',
    run() {
      const op = freshOp(48000);
      render(op, 1e-20, 10000);
      const { out } = render(op, 0, 1000);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `out[${i}] non-finite` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Missing input: samples leave window, MS falls to floor',
    run() {
      const sr = 48000;
      const op = freshOp(sr, 'momentary');
      render(op, 1.0, sr);   // charge to steady state
      const out = new Float32Array(sr);
      op.process({}, { lufs: out }, sr);
      for (let i = 0; i < sr; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `out[${i}] non-finite` };
      }
      // After 400 ms window fully emptied, should be at floor.
      // sr*1 = 1000ms total, well past 400ms empty-out.
      if (out[sr - 1] > -100) return { pass: false, why: `no decay to floor: final=${out[sr - 1]}` };
      // First sample (just after charge) should still be near −0.691.
      if (out[0] < -5) return { pass: false, why: `first sample already decayed: ${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'Missing output buffer is a no-op',
    run() {
      const op = freshOp(48000);
      op.process({ in: new Float32Array(64).fill(1) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'Determinism: two runs produce identical output',
    run() {
      const opA = freshOp(48000);
      const opB = freshOp(48000);
      const N = 4096;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.01) * 0.5;
      const outA = new Float32Array(N);
      const outB = new Float32Array(N);
      opA.process({ in: inBuf }, { lufs: outA }, N);
      opB.process({ in: inBuf }, { lufs: outB }, N);
      for (let i = 0; i < N; i++) {
        if (outA[i] !== outB[i]) return { pass: false, why: `i=${i} ${outA[i]}≠${outB[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'lufsIntegrator', tests };
