// compressorRecipe.mjs — recipe-level (graph) behavioral metric.
//
// Drives a compressor RECIPE (graph.json) end-to-end and verifies the WHOLE
// chain — detector → envelope → gainComputer → gain.gainMod → main path → makeup —
// produces the declared static curve and step-response.
//
// Different from gainCurve.mjs (op-level): there we drove gainComputer's `env`
// input directly with DC; here we drive AUDIO into the recipe's `in` terminal
// and measure AUDIO at `out`. This catches wiring bugs and stage-interaction
// drift the op-level harness can't see (e.g., "envelope output is wrong sign
// for gain.gainMod" or "makeup is outside the GR fold").
//
// Citation: same as op-level — Giannoulis-Massberg-Reiss JAES 2012; IEC 60268-3
// for T90. Static curve here is the COMPLETE recipe transfer (input dBFS → output
// dBFS with makeup folded in), so the declared threshold is offset upward by
// makeup_gainDb relative to the gainComputer's internal threshold.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildGraphRuntime } from '../runners/run_graph_worklet.mjs';
import { fitCompressorCurve } from '../primitives/transfer_curve.mjs';
import { findReachTime, envelopeRMS, levelStepSine, withinTolerance } from '../primitives/step_response.mjs';
import { dbToLinear, linearToDb, rms } from '../primitives/thd.mjs';

const SR = 48000;
const TONE_HZ = 100;   // low-frequency tone — fits inside RMS detector window cleanly

export async function runCompressorRecipeMetrics(recipeId, spec) {
  const graphPath = resolve(spec.graphPath);
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
  const declared = spec.declared || {};

  const tests = [];
  tests.push(await testStaticCurve(graph, declared));
  if (!declared.skip_attack_t90)  tests.push(await testAttackT90(graph, declared));
  if (!declared.skip_release_t90) tests.push(await testReleaseT90(graph, declared));
  tests.push(await testBypassUnity(graph, declared));

  const passCount = tests.filter(t => t.pass).length;
  return {
    summary: {
      total: tests.length,
      passed: passCount,
      failed: tests.length - passCount,
      verdict: passCount === tests.length ? 'PASS' : 'FAIL',
    },
    tests,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Static curve: sweep tone level, measure output level → fit thr/ratio.
// ─────────────────────────────────────────────────────────────────────
async function testStaticCurve(graph, declared) {
  const rt = await buildGraphRuntime(graph, { sampleRate: SR });
  const inDbLevels = [];
  for (let db = -48; db <= 0; db += 3) inDbLevels.push(db);

  const samples = [];
  const HOLD_S = 1.0;     // 1 s per level — enough for envelope to settle
  const N = Math.round(HOLD_S * SR);

  for (const inDb of inDbLevels) {
    rt.reset();
    const lin = dbToLinear(inDb);
    const stim = new Float32Array(N);
    for (let i = 0; i < N; i++) stim[i] = lin * Math.sin(2 * Math.PI * TONE_HZ * i / SR);
    const out = rt.run(stim);
    // Measure RMS of last 40 % (tail post-settle).
    const tailStart = Math.floor(N * 0.6);
    const inRms  = rms(stim, tailStart, N);
    const outRms = rms(out,  tailStart, N);
    samples.push({
      inLin: inRms,
      outLin: outRms,
      inDb:  linearToDb(inRms  || 1e-12),
      outDb: linearToDb(outRms || 1e-12),
    });
  }

  // Fit threshold/ratio at the RECIPE level — this is in/out tone RMS,
  // so threshold lands at gainComputer.threshold + makeup_gain.
  const fit = fitCompressorCurve(samples);

  // Declared values may either be raw gainComputer settings (we'll add makeup)
  // or already-recipe-level. spec.declared.threshold_recipe_db is the
  // "what the harness should measure" target, which should account for
  // makeup gain folded in.
  const declaredThr = declared.threshold_recipe_db;
  const declaredRatio = declared.ratio;
  const thrErr   = fit.thresholdDb != null && declaredThr != null
    ? Math.abs(fit.thresholdDb - declaredThr) : 999;
  const ratioErr = fit.ratio != null && declaredRatio != null
    ? Math.abs(fit.ratio - declaredRatio) / declaredRatio : 999;

  const thrTol   = declared.threshold_tol_db ?? 3;
  const ratioTol = declared.ratio_tol_pct ?? 25;

  const thrOk   = thrErr <= thrTol;
  const ratioOk = ratioErr <= ratioTol / 100;
  const pass = thrOk && ratioOk;

  return {
    name: 'Static curve (recipe)',
    pass,
    measured: {
      threshold_recipe_db: fit.thresholdDb,
      ratio: fit.ratio,
      slope_below: fit.slopeBelow,
      slope_above: fit.slopeAbove,
      curve: samples.map(s => ({ inDb: s.inDb, outDb: s.outDb })),
    },
    declared: {
      threshold_recipe_db: declaredThr,
      ratio: declaredRatio,
      tol: { threshold_db: thrTol, ratio_pct: ratioTol },
    },
    diagnostic: pass ? null
      : `Recipe curve fit: thr ${fit.thresholdDb?.toFixed(1)} dB (declared ${declaredThr}, ` +
        `err ${thrErr.toFixed(1)}, tol ±${thrTol}), ratio ${fit.ratio?.toFixed(2)} ` +
        `(declared ${declaredRatio}, err ${(ratioErr*100).toFixed(1)}%, tol ±${ratioTol}%).`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Step-response on the GR SIGNAL.  Compressor attack/release are defined
// in terms of how fast gain-reduction itself moves — not how fast audio
// envelope moves.  We compute GR(t) = 20·log10(out_env / in_env) and find
// when GR reaches 90% of its steady-state delta from pre-step to post-step.
// ─────────────────────────────────────────────────────────────────────
function grStepResponseT90(stim, out, sr, stepAtSec) {
  // Per-window RMS envelopes for input and output, identical windowing
  // so the dB-difference is well-aligned in time.
  const winSec = 0.005, hopSec = 0.0005;
  const inEnv  = envelopeRMS(stim, sr, winSec, hopSec);
  const outEnv = envelopeRMS(out,  sr, winSec, hopSec);
  const M = Math.min(inEnv.env.length, outEnv.env.length);
  const grDb  = new Float32Array(M);
  const times = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const inE  = Math.max(1e-12, inEnv.env[i]);
    const outE = Math.max(1e-12, outEnv.env[i]);
    grDb[i]  = 20 * Math.log10(outE / inE);   // signed: ≈ +makeup at low signal, ≈ +makeup−|GR| above thr
    times[i] = inEnv.times[i];
  }
  // Find pre-step and post-step asymptotes.
  const preEnd  = Math.floor(stepAtSec * sr * (1 / Math.max(1, hopSec * sr)));
  // ^ index in env-space; simpler: walk times array.
  let stepIdx = 0;
  while (stepIdx < M && times[stepIdx] < stepAtSec) stepIdx++;
  // Pre-step asymptote: mean of last 30% before step (post-window-warmup).
  const preStart = Math.floor(stepIdx * 0.3);
  let pre = 0, preN = 0;
  for (let i = preStart; i < stepIdx; i++) { pre += grDb[i]; preN++; }
  pre = preN > 0 ? pre / preN : 0;
  // Post-step asymptote: mean of last 20%.
  const postStart = Math.floor(M * 0.8);
  let post = 0, postN = 0;
  for (let i = postStart; i < M; i++) { post += grDb[i]; postN++; }
  post = postN > 0 ? post / postN : 0;
  const span = post - pre;
  if (Math.abs(span) < 0.5) {
    return { reachSec: null, preDb: pre, postDb: post, span, reason: 'span < 0.5 dB — no detectable GR change' };
  }
  const target = pre + 0.9 * span;
  const direction = span > 0 ? 'rise' : 'fall';

  // First sample at-or-past the step where grDb crosses target AND stays.
  for (let i = stepIdx; i < M; i++) {
    const v = grDb[i];
    const crossed = direction === 'rise' ? v >= target : v <= target;
    if (!crossed) continue;
    return {
      reachSec: times[i] - stepAtSec,
      preDb: pre, postDb: post, span, direction,
    };
  }
  return { reachSec: null, preDb: pre, postDb: post, span, direction, reason: 'never crossed target' };
}

// ─────────────────────────────────────────────────────────────────────
// Attack T90: input tone steps quiet (-30 dBFS) → loud (-6 dBFS).
// GR drops from +makeup down to (+makeup − GR_amount).
// ─────────────────────────────────────────────────────────────────────
async function testAttackT90(graph, declared) {
  const rt = await buildGraphRuntime(graph, { sampleRate: SR });
  const PRE_S = 0.5, POST_S = 1.5;
  const N = Math.round((PRE_S + POST_S) * SR);
  const stim = levelStepSine(N, SR, TONE_HZ, dbToLinear(-30), dbToLinear(-6), PRE_S);
  rt.reset();
  const out = rt.run(stim);

  const r = grStepResponseT90(stim, out, SR, PRE_S);
  const reachMs = r.reachSec != null ? r.reachSec * 1000 : null;
  const declaredMs = declared.attack_t90_ms;
  const tol = declared.attack_tol_pct ?? 40;
  const pass = reachMs != null && declaredMs != null && withinTolerance(reachMs, declaredMs, tol);

  return {
    name: 'Attack T90 (recipe)',
    pass,
    measured: { attack_t90_ms: reachMs, gr_pre_db: r.preDb, gr_post_db: r.postDb, gr_span_db: r.span },
    declared: { attack_t90_ms: declaredMs, tolerance_pct: tol },
    diagnostic: pass ? null
      : `GR step: pre ${r.preDb?.toFixed(2)} dB → post ${r.postDb?.toFixed(2)} dB (span ${r.span?.toFixed(2)} dB). ` +
        `T90 = ${reachMs == null ? `never reached (${r.reason})` : reachMs.toFixed(1) + ' ms'}; ` +
        `declared = ${declaredMs} ms ± ${tol}%.`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Release T90: loud → quiet. GR climbs from (+makeup − GR_amount) → +makeup.
// ─────────────────────────────────────────────────────────────────────
async function testReleaseT90(graph, declared) {
  const rt = await buildGraphRuntime(graph, { sampleRate: SR });
  const PRE_S = 0.7, POST_S = 2.5;
  const N = Math.round((PRE_S + POST_S) * SR);
  const stim = levelStepSine(N, SR, TONE_HZ, dbToLinear(-6), dbToLinear(-30), PRE_S);
  rt.reset();
  const out = rt.run(stim);

  const r = grStepResponseT90(stim, out, SR, PRE_S);
  const reachMs = r.reachSec != null ? r.reachSec * 1000 : null;
  const declaredMs = declared.release_t90_ms;
  const tol = declared.release_tol_pct ?? 40;
  const pass = reachMs != null && declaredMs != null && withinTolerance(reachMs, declaredMs, tol);

  return {
    name: 'Release T90 (recipe)',
    pass,
    measured: { release_t90_ms: reachMs, gr_pre_db: r.preDb, gr_post_db: r.postDb, gr_span_db: r.span },
    declared: { release_t90_ms: declaredMs, tolerance_pct: tol },
    diagnostic: pass ? null
      : `GR step: pre ${r.preDb?.toFixed(2)} dB → post ${r.postDb?.toFixed(2)} dB (span ${r.span?.toFixed(2)} dB). ` +
        `T90 = ${reachMs == null ? `never reached (${r.reason})` : reachMs.toFixed(1) + ' ms'}; ` +
        `declared = ${declaredMs} ms ± ${tol}%.`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bypass unity: at very low input (well below threshold), recipe is in
// its 1:1 region. Net level change should equal the makeup gain alone.
// ─────────────────────────────────────────────────────────────────────
async function testBypassUnity(graph, declared) {
  const rt = await buildGraphRuntime(graph, { sampleRate: SR });
  const N = Math.round(1.0 * SR);
  const inDb = declared.unity_test_dbfs ?? -50;
  const lin = dbToLinear(inDb);
  const stim = new Float32Array(N);
  for (let i = 0; i < N; i++) stim[i] = lin * Math.sin(2 * Math.PI * TONE_HZ * i / SR);
  rt.reset();
  const out = rt.run(stim);

  const tailStart = Math.floor(N * 0.6);
  const inRms  = rms(stim, tailStart, N);
  const outRms = rms(out,  tailStart, N);
  const measuredGainDb = linearToDb(outRms / Math.max(1e-12, inRms));

  const expected = declared.unity_makeup_gain_db ?? 0;
  const tol = declared.unity_tol_db ?? 1.0;
  const err = Math.abs(measuredGainDb - expected);
  const pass = err <= tol;

  return {
    name: 'Sub-threshold unity (1:1 + makeup)',
    pass,
    measured: { gain_db: measuredGainDb, in_dbfs: inDb },
    declared: { expected_gain_db: expected, tolerance_db: tol },
    diagnostic: pass ? null
      : `At ${inDb} dBFS the recipe applied ${measuredGainDb.toFixed(2)} dB of net gain; ` +
        `expected ${expected.toFixed(2)} dB ± ${tol} dB (= makeup gain only, since signal is below threshold).`,
  };
}
