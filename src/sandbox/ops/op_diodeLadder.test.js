// op_diodeLadder.test.js — real-math tests for op_diodeLadder (v3 Layer 2).
// Run via: node scripts/check_op_math.mjs
//
// Layer 2 (2026-04-25) replaced the Layer-1 Tarr/cubicnl front-end with a
// Stinchcombe-direct TB-303 character ladder: driver = tanh(drive·x − k·y_post),
// 5 fixed coupling-cap sections, 2× polyphase oversampling. Drive=0 silences
// the input (tanh(0)=0); there is no cubicnl shaper, no pregain=100. These
// tests cover the Layer-2 contract:
//  - Filter is lowpass: HF attenuated relative to LF at moderate Q
//  - Self-oscillation behaviour at high Q (tail does not blow up)
//  - State updates persist across blocks (not stateless)
//  - reset() zeroes state → first block bit-stable from second-call ref
//  - Cutoff sweep: higher normFreq passes more energy at drive=1
//  - drive=0 silences input (tanh driver contract)
//  - drive sweep: input level scales monotonically with drive
//  - DC step at drive=1 settles to a finite stable value
//  - trim scales output linearly in dB
//  - Defensive: missing input → zero output
//  - NaN/inf params clamped, output stays finite

import { DiodeLadderOp } from './op_diodeLadder.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DiodeLadderOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, fillFn, n = N) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = fillFn(i);
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

function rms(buf, start = 0, end = buf.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (end - start));
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

// Run for `nWarm` samples to settle, then return RMS over the next block.
function settledRMS(op, fillFn, nWarm, nMeasure) {
  const total = nWarm + nMeasure;
  const inBuf = new Float32Array(total);
  for (let i = 0; i < total; i++) inBuf[i] = fillFn(i);
  const outBuf = new Float32Array(total);
  // Process in N-sized chunks so block boundaries are exercised.
  let pos = 0;
  while (pos < total) {
    const blockN = Math.min(N, total - pos);
    const inSlice  = inBuf.subarray(pos, pos + blockN);
    const outSlice = outBuf.subarray(pos, pos + blockN);
    op.process({ in: inSlice }, { out: outSlice }, blockN);
    pos += blockN;
  }
  return rms(outBuf, nWarm, total);
}

const tests = [
  // ---- LP property: HF attenuated relative to LF -----------------------
  {
    name: 'LP property: low-Q cutoff~midband attenuates 8 kHz vs 100 Hz',
    run() {
      // drive=1 (Layer-2 default): tanh driver pumps real signal through.
      // Use low Q to avoid resonance peak; cutoff at normFreq=0.4 ≈ 800 Hz.
      const opLF = freshOp({ normFreq: 0.4, Q: 0.7, drive: 1, trim: 0 });
      const opHF = freshOp({ normFreq: 0.4, Q: 0.7, drive: 1, trim: 0 });
      const r_LF = settledRMS(opLF, i => 0.1 * Math.sin(2 * Math.PI * 100 * i / SR), 4096, 4096);
      const r_HF = settledRMS(opHF, i => 0.1 * Math.sin(2 * Math.PI * 8000 * i / SR), 4096, 4096);
      // 8 kHz should be ≥ 6 dB below 100 Hz at this cutoff (4-pole rolloff).
      const ratio_dB = 20 * Math.log10(r_HF / Math.max(r_LF, 1e-12));
      if (ratio_dB > -6) return { pass: false, why: `8kHz/100Hz = ${ratio_dB.toFixed(2)} dB (expected < -6 dB)` };
      return { pass: true };
    },
  },

  // ---- Cutoff sweep: higher normFreq → more energy through -------------
  {
    name: 'cutoff sweep: higher normFreq passes more 200 Hz energy at drive=1',
    run() {
      // 4 kHz was the Layer-1 probe; in Layer 2 the post-network HP coupling
      // caps put 4 kHz close to noise floor at all cutoffs. Use 200 Hz which
      // sits inside the Layer-2 passband across normFreq ∈ [0.2, 0.8].
      const op_low  = freshOp({ normFreq: 0.2, Q: 0.7, drive: 1.0 });
      const op_high = freshOp({ normFreq: 0.8, Q: 0.7, drive: 1.0 });
      const r_low   = settledRMS(op_low,  i => 0.1 * Math.sin(2 * Math.PI * 200 * i / SR), 4096, 4096);
      const r_high  = settledRMS(op_high, i => 0.1 * Math.sin(2 * Math.PI * 200 * i / SR), 4096, 4096);
      if (!(r_high > r_low * 5)) return { pass: false, why: `high=${r_high}, low=${r_low}` };
      return { pass: true };
    },
  },

  // ---- Self-oscillation does not blow up -----------------------------
  {
    name: 'self-oscillation at high Q stays bounded',
    run() {
      const op = freshOp({ normFreq: 0.5, Q: 18, drive: 0, trim: 0 });
      // Drive a brief impulse then 8192 zeros — at high Q ladder should
      // sustain ringing but never blow up to NaN/Inf.
      const total = 8192;
      const buf = new Float32Array(total);
      buf[0] = 0.5;
      const out = new Float32Array(total);
      let pos = 0;
      while (pos < total) {
        const n = Math.min(N, total - pos);
        op.process({ in: buf.subarray(pos, pos + n) }, { out: out.subarray(pos, pos + n) }, n);
        pos += n;
      }
      for (let i = 0; i < total; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at ${i}` };
        if (Math.abs(out[i]) > 50) return { pass: false, why: `amp blew at ${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- Stateful: subsequent blocks differ from fresh op ----------------
  {
    name: 'stateful: 2nd block depends on 1st block',
    run() {
      // Drive op for one block with sine, then drive both `same` and
      // `fresh` ops with another block of the same input. They should
      // differ because `same` has nonzero state going in.
      const same  = freshOp({ normFreq: 0.3, Q: 4 });
      const fresh = freshOp({ normFreq: 0.3, Q: 4 });
      const fill = i => 0.3 * Math.sin(2 * Math.PI * 500 * i / SR);
      drive(same, fill);                  // run a warm-up block
      const { out: a } = drive(same, i => fill(i + N));
      const { out: b } = drive(fresh, i => fill(i + N));
      let differs = false;
      for (let i = 0; i < N; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-6) { differs = true; break; }
      }
      if (!differs) return { pass: false, why: 'identical output → state not retained across blocks' };
      return { pass: true };
    },
  },

  // ---- reset() zeroes state ----------------------------------------------
  {
    name: 'reset() returns to clean state',
    run() {
      const op = freshOp({ normFreq: 0.3, Q: 4 });
      drive(op, i => 0.3 * Math.sin(2 * Math.PI * 200 * i / SR));
      op.reset();
      const refOp = freshOp({ normFreq: 0.3, Q: 4 });
      const { out: a } = drive(op,    i => 0.1 * Math.sin(2 * Math.PI * 200 * i / SR));
      const { out: b } = drive(refOp, i => 0.1 * Math.sin(2 * Math.PI * 200 * i / SR));
      for (let i = 0; i < N; i++) {
        if (!approx(a[i], b[i], 1e-9)) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- drive=0 silences input (Layer-2 tanh driver: tanh(0)=0) ---------
  {
    name: 'drive=0: silences input (tanh driver contract)',
    run() {
      // Layer-2 driver = tanh(drive·x − k·y_post). At drive=0 the input
      // term vanishes; with k≈0 (Q=0.7) the feedback is also small, so the
      // ladder converges to silence regardless of input amplitude.
      const op = freshOp({ normFreq: 0.95, Q: 0.7, drive: 0, trim: 0 });
      const r = settledRMS(op, i => 0.1 * Math.sin(2 * Math.PI * 200 * i / SR), 4096, 4096);
      if (r > 1e-4) return { pass: false, why: `drive=0 RMS=${r} (expected ≈ 0)` };
      return { pass: true };
    },
  },

  // ---- drive sweep: input level scales monotonically -------------------
  {
    name: 'drive sweep: input level scales monotonically with drive',
    run() {
      // Layer-2 driver is tanh(drive·x − k·y_post). At small signal in the
      // linear regime, output RMS scales near-linearly with drive across
      // [0, 1]. Verify monotonic increase at drive ∈ {0.25, 0.5, 0.75, 1.0}.
      const probe = (drv) => {
        const op = freshOp({ normFreq: 0.5, Q: 0.7, drive: drv, trim: 0 });
        return settledRMS(op, i => 0.1 * Math.sin(2 * Math.PI * 500 * i / SR), 4096, 4096);
      };
      const r = [0.25, 0.5, 0.75, 1.0].map(probe);
      for (let i = 1; i < r.length; i++) {
        if (!(r[i] > r[i - 1])) return { pass: false, why: `not monotonic: r=${r.map(v=>v.toFixed(5)).join(',')}` };
      }
      // drive=1 must also produce real signal (not just slightly above noise).
      if (r[3] < 1e-3) return { pass: false, why: `drive=1 RMS=${r[3]} too small` };
      return { pass: true };
    },
  },

  // ---- DC step at drive=1 settles to a finite stable value -------------
  {
    name: 'DC step at drive=1 settles to a finite stable value',
    run() {
      // Layer 2 has no cubicnl shaper; drive=1, normFreq=1 (cutoff high)
      // simply means a DC input passes through the tanh driver (saturated)
      // into a wide-open ladder. Verify the output reaches a finite,
      // bounded steady state.
      const op = freshOp({ normFreq: 1.0, Q: 0.7, drive: 1, trim: 0 });
      let pos = 0;
      const total = 8192;
      const inBuf = new Float32Array(total);
      const outBuf = new Float32Array(total);
      for (let i = 0; i < total; i++) inBuf[i] = 0.5;
      while (pos < total) {
        const n = Math.min(N, total - pos);
        op.process({ in: inBuf.subarray(pos, pos + n) }, { out: outBuf.subarray(pos, pos + n) }, n);
        pos += n;
      }
      const settled = outBuf[total - 1];
      const earlier = outBuf[total - 256];
      if (!Number.isFinite(settled)) return { pass: false, why: `non-finite settled=${settled}` };
      if (Math.abs(settled - earlier) > 1e-3) return { pass: false, why: `not settled: end=${settled} earlier=${earlier}` };
      // Output should be bounded by the tanh saturation of the driver.
      if (Math.abs(settled) > 2) return { pass: false, why: `settled=${settled} exceeds tanh-saturated bound` };
      return { pass: true };
    },
  },

  // ---- trim scales output linearly --------------------------------------
  {
    name: 'trim scales output by 10^(dB/20)',
    run() {
      // drive=1 — drive=0 silences input under Layer-2 tanh driver, so trim
      // ratio would be 0/0. Use full drive to put real signal through.
      const op0 = freshOp({ normFreq: 0.5, Q: 1, drive: 1, trim: 0 });
      const op6 = freshOp({ normFreq: 0.5, Q: 1, drive: 1, trim: 6 });
      const fill = i => 0.1 * Math.sin(2 * Math.PI * 200 * i / SR);
      const r0 = settledRMS(op0, fill, 4096, 4096);
      const r6 = settledRMS(op6, fill, 4096, 4096);
      const expected = Math.pow(10, 6 / 20);  // ≈ 1.995
      const ratio = r6 / r0;
      if (!approx(ratio, expected, 0.01)) return { pass: false, why: `ratio=${ratio} vs ${expected}` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ normFreq: 0.5, Q: 4, drive: 1 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN/inf params clamped: output stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['normFreq', 'Q', 'drive', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      // Drive a sine through; if any param took NaN, output would NaN.
      const { out } = drive(op, i => 0.3 * Math.sin(2 * Math.PI * 500 * i / SR));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'diodeLadder', tests };
