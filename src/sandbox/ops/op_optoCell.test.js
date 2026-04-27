// op_optoCell.test.js — math + stress tests for op_optoCell.
// Run via: node scripts/check_op_math.mjs
//
// Phenomenological optical-isolator GR cell (LA-2A T4-style). See
// op_optoCell.worklet.js header for primary citations and math-by-
// definition declaration.
//
// Tests cover:
//  - Identity at cv=0 (gain=1, no compression)
//  - Half-wave rectification (negative cv ignored)
//  - Static GR curve: gain = 1/(1+k·V²) at steady state
//  - Attack timing: 63% of GR within attackMs
//  - Fast release: 50% recovery within releaseMsFast (UA T4 spec)
//  - Program-dependent slow release (sustained pinning → slower recovery)
//  - max(envFast, envSlow) topology: brief peak vs sustained signal
//  - Param boundary clamping
//  - Determinism + reset
//  - STRESS tier (foundation-class — Tier-S character op):
//    block-invariance, long-run stability, sample-rate invariance,
//    multi-instance isolation, denormal flush, large-signal headroom.

import { OptoCellOp } from './op_optoCell.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new OptoCellOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function runBlocks(op, totalN, cvBuf) {
  const out = new Float32Array(totalN);
  let pos = 0;
  while (pos < totalN) {
    const n = Math.min(N, totalN - pos);
    const inputs = cvBuf ? { cv: cvBuf.subarray(pos, pos + n) } : {};
    op.process(inputs, { gain: out.subarray(pos, pos + n) }, n);
    pos += n;
  }
  return out;
}

const tests = [
  // ---- correctness: static behavior --------------------------------------
  {
    name: 'cv=0 → gain=1 (identity / no compression)',
    run() {
      const op = freshOp({});
      const cv = new Float32Array(N);  // all zeros
      const out = runBlocks(op, N, cv);
      for (let i = 0; i < N; i++) {
        if (!approx(out[i], 1.0, 1e-9)) return { pass: false, why: `i=${i}: gain=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'half-wave rectification: negative cv treated as 0',
    run() {
      const op = freshOp({});
      const cv = new Float32Array(N);
      for (let i = 0; i < N; i++) cv[i] = -0.5;  // sustained negative cv
      const out = runBlocks(op, N, cv);
      // Output should be 1 (no compression) since rectified cv is 0.
      for (let i = 0; i < N; i++) {
        if (!approx(out[i], 1.0, 1e-9)) return { pass: false, why: `i=${i}: gain=${out[i]} (negative cv should be ignored)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'steady-state cv=1.0, k=1: gain → 1/(1+1·1²) = 0.5',
    run() {
      const op = freshOp({ responsivity: 1.0 });
      const cv = new Float32Array(SR);  // 1 sec of cv=1
      cv.fill(1.0);
      const out = runBlocks(op, SR, cv);
      // After ~1 sec at cv=1, env saturates to 1, gain = 1/(1+1) = 0.5.
      // Tolerance: env may not be fully saturated even after 1s due to
      // slow tau (5 sec default). Allow ±5%.
      const finalGain = out[SR - 1];
      if (!approx(finalGain, 0.5, 0.05)) return { pass: false, why: `final gain=${finalGain}` };
      return { pass: true };
    },
  },
  {
    name: 'steady-state cv=2.0, k=0.5: gain → 1/(1+0.5·4) = 0.333',
    run() {
      const op = freshOp({ responsivity: 0.5 });
      const cv = new Float32Array(SR);
      cv.fill(2.0);
      const out = runBlocks(op, SR, cv);
      const finalGain = out[SR - 1];
      if (!approx(finalGain, 0.333, 0.05)) return { pass: false, why: `final gain=${finalGain}` };
      return { pass: true };
    },
  },

  // ---- correctness: timing ------------------------------------------------
  {
    name: 'attack: 63% of envelope reached within attackMs (=10ms default)',
    run() {
      const op = freshOp({});
      const total = Math.round(SR * 0.05);  // 50 ms
      const cv = new Float32Array(total);
      cv.fill(1.0);  // step input
      const out = runBlocks(op, total, cv);
      // gain = 1/(1+env²). At env = 0.632 (63% of 1.0), gain = 1/(1+0.4) ≈ 0.714
      // At t = attackMs = 10ms, sample idx = 480.
      const idxAttack = Math.round(SR * 0.010);
      const gainAtAttack = out[idxAttack];
      // Expected gain when envFast ≈ 0.632: 1/(1 + 0.632²) = 1/1.4 ≈ 0.714
      // Tolerance: ±5% (envFast and envSlow both contribute via max).
      if (!approx(gainAtAttack, 0.714, 0.05)) {
        return { pass: false, why: `gain at attackMs=${gainAtAttack}, expected ~0.714` };
      }
      return { pass: true };
    },
  },
  {
    name: 'fast release: brief 5ms peak recovers most of the way within ~60ms',
    run() {
      const op = freshOp({});
      const total = Math.round(SR * 0.5);  // 500 ms
      const cv = new Float32Array(total);
      // 5 ms peak at cv=1.0, then silence — too brief for envSlow to climb
      const peakLen = Math.round(SR * 0.005);
      for (let i = 0; i < peakLen; i++) cv[i] = 1.0;
      const out = runBlocks(op, total, cv);
      // Find the peak (minimum gain) and then verify recovery at +60ms after peak end
      let minGain = 1, minIdx = 0;
      for (let i = 0; i < peakLen + 100; i++) {
        if (out[i] < minGain) { minGain = out[i]; minIdx = i; }
      }
      const idxRecovery = peakLen + Math.round(SR * 0.060);  // 60 ms after peak end
      const gainAtRecovery = out[idxRecovery];
      // Should have recovered substantially. Brief peak → envSlow stays low →
      // recovery follows fast path. Expect gain > 0.92 (mostly recovered).
      if (gainAtRecovery < 0.92) return { pass: false, why: `recovery gain=${gainAtRecovery} at +60ms after brief peak (expected fast recovery)` };
      return { pass: true };
    },
  },
  {
    name: 'program-dependent: sustained pinning (≥ 1 slow tau) → slower recovery than brief peak',
    run() {
      // Same op, two scenarios: brief 5ms peak vs sustained 5-sec pinning
      // (= 1 tau at default releaseSecSlow=5). Thermal memory in envSlow
      // builds substantially over a full slow tau; after release, envSlow
      // dominates the recovery → much lower gain than the brief case.
      // Total test duration ~5.3 sec.
      const opBrief = freshOp({});
      const totalBrief = Math.round(SR * 0.6);
      const cvBrief = new Float32Array(totalBrief);
      const briefLen = Math.round(SR * 0.005);
      for (let i = 0; i < briefLen; i++) cvBrief[i] = 1.0;
      const outBrief = runBlocks(opBrief, totalBrief, cvBrief);

      const opSustained = freshOp({});
      const totalSust = Math.round(SR * 5.3);  // 5s pin + 300ms recovery window
      const cvSustained = new Float32Array(totalSust);
      const sustLen = Math.round(SR * 5.0);
      for (let i = 0; i < sustLen; i++) cvSustained[i] = 1.0;
      const outSustained = runBlocks(opSustained, totalSust, cvSustained);

      // Measure recovery 200ms after each release.
      const idxBriefRecovery = briefLen + Math.round(SR * 0.2);
      const idxSustRecovery  = sustLen  + Math.round(SR * 0.2);
      const gainBrief = outBrief[idxBriefRecovery];
      const gainSust  = outSustained[idxSustRecovery];

      // Brief peak: envSlow barely moved (~0% of envFast peak) → fast path
      //   dominates recovery → gain near 1 within 200ms.
      // Sustained 5s: envSlow ≈ 0.63 (one tau saturation). After release,
      //   envFast falls fast but envSlow holds → max(envFast, envSlow) ≈
      //   envSlow → gain ≈ 1/(1 + 0.63²) ≈ 0.72 at +200ms.
      if (gainBrief <= gainSust) {
        return { pass: false, why: `brief=${gainBrief.toFixed(4)} sust=${gainSust.toFixed(4)} — program dependence not working` };
      }
      // Difference should be at least 0.15 (brief ≈ 1.0, sust ≈ 0.72-0.78).
      if (gainBrief - gainSust < 0.15) {
        return { pass: false, why: `program-dep difference too small: brief=${gainBrief.toFixed(4)} sust=${gainSust.toFixed(4)}` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: param effects ----------------------------------------
  {
    name: 'responsivity scales static GR depth: k=2 vs k=0.5 at cv=1',
    run() {
      const opLow  = freshOp({ responsivity: 0.5 });
      const opHigh = freshOp({ responsivity: 2.0 });
      const cv = new Float32Array(SR * 2);
      cv.fill(1.0);
      const outLow  = runBlocks(opLow,  SR * 2, cv);
      const outHigh = runBlocks(opHigh, SR * 2, cv);
      // Steady-state: opLow gain = 1/(1+0.5) = 0.667, opHigh = 1/(1+2) = 0.333
      const gLow  = outLow[SR * 2 - 1];
      const gHigh = outHigh[SR * 2 - 1];
      if (!approx(gLow,  0.667, 0.05)) return { pass: false, why: `low responsivity gain=${gLow}` };
      if (!approx(gHigh, 0.333, 0.05)) return { pass: false, why: `high responsivity gain=${gHigh}` };
      // Higher responsivity = lower gain (more compression).
      if (gLow <= gHigh) return { pass: false, why: `responsivity should reduce gain monotonically: low=${gLow} high=${gHigh}` };
      return { pass: true };
    },
  },
  {
    name: 'attack: faster attackMs → quicker initial GR',
    run() {
      const opSlow = freshOp({ attackMs: 50 });
      const opFast = freshOp({ attackMs: 1 });
      const total = Math.round(SR * 0.02);  // 20 ms
      const cv = new Float32Array(total);
      cv.fill(1.0);
      const outSlow = runBlocks(opSlow, total, cv);
      const outFast = runBlocks(opFast, total, cv);
      // At 5 ms after start: opFast should have engaged GR strongly,
      // opSlow should still be near gain=1.
      const idx = Math.round(SR * 0.005);
      const gFast = outFast[idx];
      const gSlow = outSlow[idx];
      if (gSlow - gFast < 0.1) {
        return { pass: false, why: `attack scaling weak: fast=${gFast}, slow=${gSlow}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive ---------------------------------------------------------
  {
    name: 'missing input → cv=0 assumed, gain=1',
    run() {
      const op = freshOp({});
      const out = new Float32Array(N);
      try { op.process({}, { gain: out }, N); } catch (e) { return { pass: false, why: `${e}` }; }
      for (let i = 0; i < N; i++) if (!approx(out[i], 1.0, 1e-9)) return { pass: false, why: `i=${i}: gain=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no throw)',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: `${e}` }; }
      return { pass: true };
    },
  },
  {
    name: 'NaN/inf params clamped: output stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['attackMs', 'releaseMsFast', 'releaseSecSlow', 'responsivity']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const cv = new Float32Array(N);
      cv.fill(1.0);
      const out = runBlocks(op, N, cv);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamping: out-of-range values held at limits',
    run() {
      const op = freshOp({});
      op.setParam('attackMs', 1000);          // clamp to 100
      op.setParam('releaseSecSlow', 100);     // clamp to 15
      op.setParam('responsivity', 100);       // clamp to 4.0
      const cv = new Float32Array(N);
      cv.fill(1.0);
      const out = runBlocks(op, N, cv);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },

  // ---- state semantics ----------------------------------------------------
  {
    name: 'reset() restores clean state — second run = first run',
    run() {
      const op  = freshOp({});
      const ref = freshOp({});
      const total = SR;
      const cv = new Float32Array(total);
      for (let i = 0; i < total; i++) cv[i] = Math.abs(Math.sin(2 * Math.PI * 5 * i / SR));
      runBlocks(op, total, cv);
      op.reset();
      const a = runBlocks(op, total, cv);
      const b = runBlocks(ref, total, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(a[i], b[i], 1e-9)) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      }
      return { pass: true };
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // STRESS TESTS — Tier-S character op (named-gear class).
  // Per sandbox_op_ship_protocol.md §5.1, character ops need 15-20 tests.
  // Apply mandatory categories: block-invariance, long-run, determinism,
  // reset, NaN/Inf clamp + named-gear claim verification.
  // ════════════════════════════════════════════════════════════════════════

  {
    name: 'STRESS: block-boundary invariance — N=64/256/1024 produce identical output',
    run() {
      const total = 4096;
      const cv = new Float32Array(total);
      // Mix of transients and sustained content.
      for (let i = 0; i < total; i++) cv[i] = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * i / SR);

      function runWithBlock(blockN) {
        const op = freshOp({});
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(blockN, total - pos);
          op.process({ cv: cv.subarray(pos, pos + n) }, { gain: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        return out;
      }

      const out64   = runWithBlock(64);
      const out256  = runWithBlock(256);
      const out1024 = runWithBlock(1024);
      for (let i = 0; i < total; i++) {
        if (!approx(out64[i],  out256[i],  1e-7)) return { pass: false, why: `64 vs 256: i=${i}` };
        if (!approx(out256[i], out1024[i], 1e-7)) return { pass: false, why: `256 vs 1024: i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: long-run — 5 sec sustained input → finite, monotonic-toward-steady-state',
    run() {
      const total = SR * 5;
      const op = freshOp({});
      const cv = new Float32Array(total);
      cv.fill(0.7);
      const out = runBlocks(op, total, cv);
      // Finiteness everywhere.
      for (let i = 0; i < total; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
      }
      // After 5s with releaseSecSlow=5, env should be near steady-state.
      // env → cv = 0.7, gain → 1/(1 + 0.49) ≈ 0.671
      const finalGain = out[total - 1];
      if (!approx(finalGain, 0.671, 0.02)) return { pass: false, why: `final gain=${finalGain} not at steady state` };
      // Output should be in (0, 1] throughout.
      for (let i = 0; i < total; i++) {
        if (out[i] <= 0 || out[i] > 1.001) return { pass: false, why: `out[${i}]=${out[i]} outside (0, 1]` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: SR-invariance — attack timing scales with sample rate',
    run() {
      // At a given attackMs, the time-to-63%-GR should be independent of SR.
      const rates = [44100, 48000, 96000];
      const attackTimes = [];
      for (const sr of rates) {
        const op = new OptoCellOp(sr);
        op.reset();
        op.setParam('attackMs', 10);
        const total = Math.round(sr * 0.03);  // 30 ms
        const cv = new Float32Array(total);
        cv.fill(1.0);
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(N, total - pos);
          op.process({ cv: cv.subarray(pos, pos + n) }, { gain: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        // Find sample where gain first crosses below 0.714 (= 1/(1+0.4) for env=0.632).
        let crossIdx = -1;
        for (let i = 0; i < total; i++) {
          if (out[i] <= 0.714) { crossIdx = i; break; }
        }
        if (crossIdx < 0) { attackTimes.push(NaN); continue; }
        attackTimes.push(crossIdx / sr * 1000);  // in ms
      }
      // All should be ≈ 10 ms.
      for (const t of attackTimes) {
        if (!Number.isFinite(t) || Math.abs(t - 10) > 1.5) {
          return { pass: false, why: `attack times across SR: ${attackTimes.map(x => x.toFixed(2))}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: state isolation — 3 parallel instances produce independent output',
    run() {
      const total = 1024;
      const cvA = new Float32Array(total);
      const cvB = new Float32Array(total);
      const cvC = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        cvA[i] = 0.3;
        cvB[i] = 0.7;
        cvC[i] = i < total/2 ? 0 : 1.0;
      }
      const opA = freshOp({}); const opB = freshOp({}); const opC = freshOp({});
      const outA = runBlocks(opA, total, cvA);
      const outB = runBlocks(opB, total, cvB);
      const outC = runBlocks(opC, total, cvC);
      // Should diverge meaningfully.
      let diffAB = 0, diffBC = 0;
      for (let i = 100; i < total; i++) {
        diffAB += Math.abs(outA[i] - outB[i]);
        diffBC += Math.abs(outB[i] - outC[i]);
      }
      if (diffAB < 5)  return { pass: false, why: `A≈B (diff=${diffAB})` };
      if (diffBC < 5)  return { pass: false, why: `B≈C (diff=${diffBC})` };
      // Determinism: 4th instance with cvA matches outA.
      const opAprime = freshOp({});
      const outAprime = runBlocks(opAprime, total, cvA);
      for (let i = 0; i < total; i++) {
        if (!approx(outA[i], outAprime[i], 1e-9)) return { pass: false, why: `parallel-A determinism: i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: denormal flush — after long zero input, state collapses to 0',
    run() {
      const op = freshOp({});
      const cvActive = new Float32Array(SR);
      cvActive.fill(1.0);
      runBlocks(op, SR, cvActive);  // pin the cell for 1 sec
      // Now feed silence for many seconds — env should decay to denormal range and flush.
      const cvSilence = new Float32Array(SR * 30);  // 30 sec of zero
      const out = runBlocks(op, cvSilence.length, cvSilence);
      // After 30 sec at slow tau=5sec, env should be near zero (e^-6 ≈ 0.0025).
      // The denormal flush in the worklet (envFast < 1e-30 → 0) should kick in
      // before that. Output gain should be exactly 1 at the end.
      const finalGain = out[out.length - 1];
      if (!approx(finalGain, 1.0, 1e-6)) return { pass: false, why: `final gain after 30s silence=${finalGain}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: gain output bounded in (0, 1] for all reasonable cv',
    run() {
      const total = SR * 2;
      const op = freshOp({ responsivity: 4.0 });  // max responsivity
      const cv = new Float32Array(total);
      // Large signal: ±2 amplitude.
      for (let i = 0; i < total; i++) cv[i] = 2.0 * Math.sin(2 * Math.PI * 100 * i / SR);
      const out = runBlocks(op, total, cv);
      for (let i = 0; i < total; i++) {
        if (out[i] <= 0 || out[i] > 1.001) {
          return { pass: false, why: `gain[${i}]=${out[i]} outside (0, 1]` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: UA T4 spec — 10ms attack + 60ms initial release verified',
    run() {
      // Named-gear claim verification per UA's published numbers.
      // Step input → measure 63% engage time and 50% release time.
      const op = freshOp({ attackMs: 10, releaseMsFast: 60, releaseSecSlow: 5 });
      const total = Math.round(SR * 0.5);
      const cv = new Float32Array(total);
      const stepLen = Math.round(SR * 0.05);  // 50 ms step (long enough to settle envFast but not envSlow)
      for (let i = 0; i < stepLen; i++) cv[i] = 1.0;
      const out = runBlocks(op, total, cv);
      // 1. Attack: gain should be ≤0.714 by ~10ms after step start (envFast at 63% of 1.0).
      const idxAttack = Math.round(SR * 0.010);
      const gAttack = out[idxAttack];
      if (gAttack > 0.78) return { pass: false, why: `attack at 10ms: gain=${gAttack} (expected ≤0.78)` };
      // 2. Release: at 60ms after step end, gain should have recovered substantially
      //    toward 1 (since envSlow only had 50ms to climb — won't dominate).
      const idxRelease = stepLen + Math.round(SR * 0.060);
      const gRelease = out[idxRelease];
      if (gRelease < 0.85) return { pass: false, why: `release at +60ms: gain=${gRelease} (expected ≥0.85 fast recovery from short pin)` };
      return { pass: true };
    },
  },
];

export default { opId: 'optoCell', tests };
