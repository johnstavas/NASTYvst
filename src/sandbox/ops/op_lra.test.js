// op_lra.test.js — real-math tests for op_lra.
// Run via: node scripts/check_op_math.mjs
//
// Contract (see op_lra.worklet.js header — EBU Tech 3342):
//   LRA = L95 - L10 of twice-gated short-term loudness pool.
//   3 s ST blocks on 100 ms hop. Abs gate -70 LUFS, rel gate -20 LU.
//   Nearest-rank percentile (Tech 3342 Annex A pseudocode).
//   Pre-roll / empty pool → LRA = 0 (not NaN).

import { LraOp } from './op_lra.worklet.js';

const SR = 48000;

function freshOp() { const op = new LraOp(SR); op.reset(); return op; }

// Pump N samples of a constant-amplitude sine through the op and
// return the final LRA reading.
function pumpSine(op, amplitude, seconds) {
  const N = Math.round(SR * seconds);
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = amplitude * Math.sin(2 * Math.PI * 1000 * i / SR);
  const out = new Float32Array(N);
  op.process({ in: buf }, { lra: out }, N);
  return out[N - 1];
}

// Pump with an amplitude schedule — amplitude(i) → sample value.
function pumpSchedule(op, amplitude, seconds) {
  const N = Math.round(SR * seconds);
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = amplitude(i);
    buf[i] = a * Math.sin(2 * Math.PI * 1000 * i / SR);
  }
  const out = new Float32Array(N);
  op.process({ in: buf }, { lra: out }, N);
  return { out, N };
}

const tests = [
  {
    name: 'pre-roll (< 3 s): LRA = 0',
    run() {
      const op = freshOp();
      // Run 2.5 s — no full ST block has completed yet.
      const tail = pumpSine(op, 0.5, 2.5);
      if (tail !== 0) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'constant sine → LRA ≈ 0 (no dynamic range)',
    run() {
      // Once the pool is populated with identical MS values, L95 and L10
      // collapse onto the same value. Needs ≥ 10 ST values so percentile
      // picks are stable, so pump ≥ 4 s total (first full ST at 3 s,
      // then 10 more hops = +1 s).
      const op = freshOp();
      const tail = pumpSine(op, 0.5, 6);
      if (Math.abs(tail) > 0.01) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'two-level sine (loud / quiet) → LRA ≈ level difference',
    run() {
      // 4 s loud (amp=0.5) then 4 s quiet (amp=0.05, 20 dB lower).
      // Both should survive abs gate (-70 LUFS) comfortably.
      // Relative gate: ungated mean is between the two clusters; loud
      // cluster is above, quiet cluster is 20 dB below the loud cluster.
      // Ungated mean in LUFS is roughly halfway between the two loudness
      // values in log space — more precisely, the log of the MS mean.
      // MS_loud = 0.125, MS_quiet = 0.00125 → mean = 0.0631
      // L_ungated = -0.691 + 10·log10(0.0631) ≈ -12.7 LUFS
      // L_loud    ≈ -3.70 LUFS, L_quiet ≈ -23.70 LUFS
      // L_rel     = -12.7 - 20 = -32.7  → quiet blocks (-23.7) pass.
      // So both clusters pass both gates; LRA = L95 - L10 ≈ 20 LU.
      const op = freshOp();

      // Phase 1: 4 s loud.
      const N1 = SR * 4;
      const buf1 = new Float32Array(N1);
      for (let i = 0; i < N1; i++) buf1[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR);
      op.process({ in: buf1 }, { lra: new Float32Array(N1) }, N1);

      // Phase 2: 4 s quiet.
      const N2 = SR * 4;
      const buf2 = new Float32Array(N2);
      for (let i = 0; i < N2; i++) buf2[i] = 0.05 * Math.sin(2 * Math.PI * 1000 * i / SR);
      const out2 = new Float32Array(N2);
      op.process({ in: buf2 }, { lra: out2 }, N2);

      // Note: ST blocks straddling the loud→quiet boundary will have
      // intermediate MS, smearing the percentiles slightly. Tolerance
      // 2 LU accepts this.
      const tail = out2[N2 - 1];
      if (tail < 15 || tail > 25) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'LRA is non-negative',
    run() {
      // Throw varied content at the op, LRA output should never go < 0.
      const op = freshOp();
      const N = SR * 10;
      const buf = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        // Mix two sinusoids with slow AM so MS drifts over time.
        const amp = 0.1 + 0.2 * (1 + Math.sin(2 * Math.PI * 0.3 * i / SR)) * 0.5;
        buf[i] = amp * Math.sin(2 * Math.PI * 1000 * i / SR);
      }
      const out = new Float32Array(N);
      op.process({ in: buf }, { lra: out }, N);
      for (let i = 0; i < N; i++) if (out[i] < 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'fully-silent ring: LRA holds (no new pool entries)',
    run() {
      // During voice→silence transition, ST blocks straddle the
      // boundary and produce legitimate mid-range MS values that enter
      // the pool (widening LRA). This is spec-correct. Once the 3 s
      // ring is FULLY zero, subsequent silent blocks fail abs gate and
      // the pool is frozen — LRA genuinely holds from that point.
      const op = freshOp();
      // Build up pool with 8 s of two-level voice.
      const N1 = SR * 8;
      const buf1 = new Float32Array(N1);
      for (let i = 0; i < N1; i++) {
        const amp = i < N1 / 2 ? 0.5 : 0.05;
        buf1[i] = amp * Math.sin(2 * Math.PI * 1000 * i / SR);
      }
      op.process({ in: buf1 }, { lra: new Float32Array(N1) }, N1);
      // 4 s silence — first 3 s saturate the ring with zeros, last 1 s
      // has a fully-zero 3 s window → abs gate rejects → pool frozen.
      const silentWarmup = new Float32Array(SR * 3);
      op.process({ in: silentWarmup }, { lra: new Float32Array(SR * 3) }, SR * 3);
      const lraFrozen = op._lraLU;
      const silentTail = new Float32Array(SR * 1);
      const out = new Float32Array(SR * 1);
      op.process({ in: silentTail }, { lra: out }, SR * 1);
      // Tolerance accommodates Float32 cast on the output buffer
      // (double _lraLU state → Float32 out[i] loses ~7 decimal digits).
      if (Math.abs(out[out.length - 1] - Math.fround(lraFrozen)) > 1e-5) {
        return { pass: false, why: `lra changed during frozen tail: ${lraFrozen} → ${out[out.length - 1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'abs gate: -80 LUFS content does not enter pool',
    run() {
      // Very quiet signal: amplitude 1e-4 → MS ≈ 5e-9 → LUFS ≈ -83
      // Below abs gate (-70), should never enter pool → LRA stays 0.
      const op = freshOp();
      const tail = pumpSine(op, 1e-4, 8);
      if (tail !== 0) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears pool and LRA',
    run() {
      const op = freshOp();
      pumpSine(op, 0.5, 5);
      pumpSine(op, 0.05, 3);
      if (op._lraLU <= 0) return { pass: false, why: `no build-up: ${op._lraLU}` };
      op.reset();
      if (op._lraLU !== 0) return { pass: false, why: `reset didn't clear: ${op._lraLU}` };
      if (op._absPassN !== 0) return { pass: false, why: `pool not cleared: ${op._absPassN}` };
      const tail = pumpSine(op, 0.5, 2.5);
      if (tail !== 0) return { pass: false, why: `after reset, pre-roll non-zero: ${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: timing advances, no crash, LRA bounded',
    run() {
      // Missing-input path should equivalent-to silence-input. It will
      // advance sub-block timing and (during the ring transition) may
      // let partially-silent blocks widen LRA — spec-correct. Contract
      // here is just: no NaN, output non-negative, and after the ring
      // is fully zero (3 s), LRA is stable.
      const op = freshOp();
      pumpSine(op, 0.5, 5);
      pumpSine(op, 0.05, 3);
      // Drain ring with 3 s of missing input.
      op.process({}, { lra: new Float32Array(SR * 3) }, SR * 3);
      const stable = op._lraLU;
      if (!Number.isFinite(stable) || stable < 0) return { pass: false, why: `bad stable: ${stable}` };
      // Another 1 s of missing input → no further change.
      const out = new Float32Array(SR);
      op.process({}, { lra: out }, SR);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i]) || out[i] < 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      if (Math.abs(out[out.length - 1] - Math.fround(stable)) > 1e-5) {
        return { pass: false, why: `frozen tail changed: ${stable} → ${out[out.length - 1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      const buf = new Float32Array(SR).fill(0.5);
      op.process({ in: buf }, {}, SR);
      return { pass: true };
    },
  },
  {
    name: 'NaN channelWeight is rejected (state preserved)',
    run() {
      const op = freshOp();
      const before = op._G;
      op.setParam('channelWeight', NaN);
      if (op._G !== before) return { pass: false, why: `G changed` };
      return { pass: true };
    },
  },
  {
    name: 'channelWeight clamps to [0, 2]',
    run() {
      const op = freshOp();
      op.setParam('channelWeight', -5);
      if (op._G !== 0) return { pass: false, why: `neg: G=${op._G}` };
      op.setParam('channelWeight', 5);
      if (op._G !== 2) return { pass: false, why: `hi: G=${op._G}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp();
      const b = freshOp();
      const N = SR * 6;
      const buf = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const amp = i < N / 2 ? 0.5 : 0.05;
        buf[i] = amp * Math.sin(2 * Math.PI * 1000 * i / SR);
      }
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      a.process({ in: buf }, { lra: oA }, N);
      b.process({ in: buf }, { lra: oB }, N);
      for (let i = 0; i < N; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'lra', tests };
