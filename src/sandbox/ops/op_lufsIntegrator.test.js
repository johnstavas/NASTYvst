// op_lufsIntegrator.test.js — real-math tests for op_lufsIntegrator.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against ITU-R BS.1770-5 §3.1 (loudness formula) and
// EBU Tech 3341 V4 §A.4 (one-pole-equivalent windows).
//
// Pipeline note: this op expects PRE-K-WEIGHTED audio. Tests feed raw
// signals and assert the *integrator* stage only (op #51 is the K-filter).
//
// Coverage:
//   - L = -0.691 + 10·log10(G·MS) formula
//   - DC at 1.0 → -0.691 LUFS (MS=1, G=1)
//   - Sine at 0 dBFS → MS=0.5 → -3.70 LUFS single-channel
//   - Silence converges to floor near -120 LUFS
//   - Momentary τ=200ms vs short-term τ=1500ms step response
//   - G=0 channel-weight mute → floor
//   - G clamp to [0,2]
//   - reset / denormal flush / missing input / determinism

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
  // ---- formula calibration ------------------------------------------
  {
    name: 'DC at 1.0 → -0.691 LUFS (MS=1, G=1)',
    run() {
      const op = freshOp(48000, 'momentary');
      // 5 seconds at τ=200ms is >>25 time constants → fully converged
      const { out } = render(op, 1.0, 48000 * 5);
      const final = out[out.length - 1];
      if (!approx(final, -0.691, 0.01)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },
  {
    name: 'Sine 1 kHz 0 dBFS → ~-3.70 LUFS (MS=0.5, single channel)',
    run() {
      const op = freshOp(48000, 'momentary');
      const sr = 48000, freq = 1000;
      // 3 seconds: >>15 time constants
      const N = sr * 3;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * freq * i / sr);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { lufs: out }, N);
      // Expected: L = -0.691 + 10·log10(0.5) = -0.691 - 3.0103 = -3.70
      const final = out[N - 1];
      if (!approx(final, -3.70, 0.1)) return { pass: false, why: `final=${final}` };
      return { pass: true };
    },
  },

  // ---- silence floor ------------------------------------------------
  {
    name: 'Silence converges toward LUFS floor (< -100)',
    run() {
      const op = freshOp(48000, 'momentary');
      const { out } = render(op, 0, 48000 * 2);
      const final = out[out.length - 1];
      // MS_FLOOR = 1e-12 → L = -0.691 + 10·log10(1e-12) = -120.691
      if (final > -100) return { pass: false, why: `final=${final}` };
      if (!Number.isFinite(final)) return { pass: false, why: 'non-finite' };
      return { pass: true };
    },
  },

  // ---- time-constant differentiation --------------------------------
  {
    name: 'Momentary τ≈200ms: MS reaches ~63% after 200ms step',
    run() {
      const op = freshOp(48000, 'momentary');
      const sr = 48000;
      const N = Math.floor(sr * 0.2); // 200 ms
      const inBuf = new Float32Array(N).fill(1.0);
      const out = new Float32Array(N);
      op.process({ in: inBuf }, { lufs: out }, N);
      // Convert LUFS back to MS at t=200ms: MS = 10^((L+0.691)/10)
      const msAt200 = Math.pow(10, (out[N - 1] + 0.691) / 10);
      // Theoretical: 1 - exp(-1) = 0.632
      if (!approx(msAt200, 0.632, 0.03)) return { pass: false, why: `MS@200ms=${msAt200}` };
      return { pass: true };
    },
  },
  {
    name: 'Short-term τ≈1500ms: much slower than momentary',
    run() {
      const opM = freshOp(48000, 'momentary');
      const opS = freshOp(48000, 'short-term');
      const sr = 48000;
      const N = Math.floor(sr * 0.2); // 200 ms step
      const inBuf = new Float32Array(N).fill(1.0);
      const outM = new Float32Array(N);
      const outS = new Float32Array(N);
      opM.process({ in: inBuf }, { lufs: outM }, N);
      opS.process({ in: inBuf }, { lufs: outS }, N);
      // Momentary reaches much further toward 0 LUFS than short-term
      if (!(outM[N - 1] > outS[N - 1] + 5)) {
        return { pass: false, why: `M=${outM[N-1]} S=${outS[N-1]}` };
      }
      // Short-term at 200ms: MS ≈ 1 - exp(-0.2/1.5) = 0.125
      const msS = Math.pow(10, (outS[N - 1] + 0.691) / 10);
      if (!approx(msS, 0.125, 0.02)) return { pass: false, why: `MS_S@200=${msS}` };
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
      if (out[out.length - 1] > -100) return { pass: false, why: `final=${out[out.length-1]}` };
      return { pass: true };
    },
  },
  {
    name: 'G=1.41 (LFE weight) adds ~+1.5 dB',
    run() {
      const op1 = freshOp(48000, 'momentary');
      const opL = freshOp(48000, 'momentary');
      opL.setParam('channelWeight', 1.41);
      const { out: o1 } = render(op1, 1.0, 48000 * 5);
      const { out: oL } = render(opL, 1.0, 48000 * 5);
      const delta = oL[oL.length - 1] - o1[o1.length - 1];
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

  // ---- infrastructure -----------------------------------------------
  {
    name: 'reset() zeroes integrator state',
    run() {
      const op = freshOp(48000);
      render(op, 1.0, 24000);
      op.reset();
      if (op._p !== 0) return { pass: false, why: `_p=${op._p}` };
      return { pass: true };
    },
  },
  {
    name: 'Denormal flush (no NaN after silence→0)',
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
    name: 'Missing input decays gracefully',
    run() {
      const op = freshOp(48000);
      render(op, 1.0, 4800); // charge up
      const out = new Float32Array(1024);
      op.process({}, { lufs: out }, 1024);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `out[${i}] non-finite` };
      }
      // Output should be monotonically falling (decay)
      if (!(out[1023] < out[0])) return { pass: false, why: `no decay ${out[0]}→${out[1023]}` };
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
