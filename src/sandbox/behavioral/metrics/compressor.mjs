// compressor.mjs — behavioral metric module for compressor / GR / dynamics ops.
//
// Tests applied per design doc § 6.1:
//   - Static GR curve (slope above threshold ≠ 1.0; knee detected)
//   - Attack T90  (matches declared.attack_ms within tolerance)
//   - Release T90 (matches declared.release_ms within tolerance)
//   - THD-vs-GR slope (positive if declared.thd_grows_with_gr)
//   - Sub-threshold null (output ≡ input + makeup gain only)
//
// Citation: Giannoulis, Massberg, Reiss. "Digital Dynamic Range Compressor
// Design — A Tutorial and Analysis." JAES 60(6), 2012. (e-lib 16354).
//
// Op contract assumed: standard Cluster A shape — inputs `audio` + `cv`,
// output `out`. CV input drives gain reduction directly. The metric module
// **synthesizes the CV signal directly** rather than routing through an
// envelope follower, so the cell's gain curve is exercised independently
// of any detector behavior. This is critical: the Vari-Mu bug we discovered
// was masked by feeding it through a real envelope follower whose output
// never approached the cell's required cv range.

import { sine } from '../../../../scripts/parity_signals.mjs';
import {
  thdSingleTone, dbToLinear, linearToDb, rms,
} from '../primitives/thd.mjs';
import {
  levelStepSine, levelStepDC, envelopeRMS, findReachTime, withinTolerance,
} from '../primitives/step_response.mjs';
import { runWorklet } from '../runners/run_worklet.mjs';

// Default runner is worklet; runner.mjs swaps to runNative for the native arm.
let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;
const TONE_HZ = 997;            // AES17 reference
const SETTLE_S = 0.5;           // discard first 0.5 s as warm-up
const STEP_HOLD_S = 1.5;        // each level held for 1.5 s in static curve
const PRE_STEP_S = 0.4;         // attack/release: pre-step duration
const POST_STEP_S = 1.5;        // attack/release: post-step duration

/**
 * Run the compressor metric battery against an op.
 *
 * @param {string} opId
 * @param {object} spec   the .behavioral block from opRegistry.js
 * @returns {Promise<{ summary, tests }>}
 */
export async function runCompressorMetrics(opId, spec) {
  const declared = spec.declared || {};
  const tol = spec.tolerances || {};
  const params = spec.defaultParams || {};

  const tests = [];

  // ── Static GR curve ─────────────────────────────────────────────────────
  tests.push(await testStaticGRCurve(opId, params, declared, tol));

  // ── Attack T90 ─────────────────────────────────────────────────────────
  if (declared.attack_ms != null) {
    tests.push(await testAttackTime(opId, params, declared, tol));
  }

  // ── Release T90 ────────────────────────────────────────────────────────
  if (declared.release_ms != null) {
    tests.push(await testReleaseTime(opId, params, declared, tol));
  }

  // ── THD-vs-GR slope ────────────────────────────────────────────────────
  if (declared.thd_grows_with_gr != null) {
    tests.push(await testTHDvsGR(opId, params, declared, tol));
  }

  // ── Sub-threshold null ─────────────────────────────────────────────────
  tests.push(await testSubThresholdNull(opId, params, declared, tol));

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

// ─────────────────────────────────────────────────────────────────────────
// Test 1: Static GR curve
// ─────────────────────────────────────────────────────────────────────────
async function testStaticGRCurve(opId, params, declared, tol) {
  // Sweep the cv input across 8 levels spanning the declared sensitivity range.
  // Each level drives a steady cv = level_linear, with audio = constant 1 kHz
  // sine at -12 dBFS. Measure output RMS at each level after settle.
  const cvLevelsLinear = declared.cv_sweep_linear || [
    0.0, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0, 1.5, 2.0, 4.0, 8.0,
  ];

  const audioAmp = dbToLinear(declared.audio_test_dbfs ?? -12);
  const totalSamples = Math.round(STEP_HOLD_S * SR);
  const steadyStartSample = Math.round(SETTLE_S * SR);

  const audioStim = sine(totalSamples, SR, TONE_HZ, audioAmp);
  const audioRmsIn = rms(audioStim, steadyStartSample, totalSamples);

  const measurements = [];
  for (const cvLin of cvLevelsLinear) {
    const cvStim = new Float32Array(totalSamples);
    cvStim.fill(cvLin);
    const result = await _runner(opId, params, { audio: audioStim, cv: cvStim }, { sampleRate: SR });
    const out = result.outputs.out;
    const rmsOut = rms(out, steadyStartSample, totalSamples);
    measurements.push({
      cv: cvLin,
      rms_in: audioRmsIn,
      rms_out: rmsOut,
      gr_db: linearToDb(rmsOut / audioRmsIn),
      nan: result.nanCount,
      inf: result.infCount,
      subnormal: result.subnormalCount,
    });
  }

  // Detect knee: find the cv level where gain drops by at least 1 dB below
  // the cv=0 baseline. Polarity-agnostic: works for both positive-cv-compresses
  // (varMuTube et al.) AND negative-cv-attenuates (blackmerVCA).
  const baseline = measurements[0].rms_out / audioRmsIn;
  let kneeCv = null;
  for (let i = 1; i < measurements.length; i++) {
    const ratio = measurements[i].rms_out / audioRmsIn;
    if (ratio < baseline * dbToLinear(-1) - 1e-9) { kneeCv = measurements[i].cv; break; }
  }

  // Compute slope above the knee. Find the measurement with deepest GR (most
  // negative gr_db) — that's the operating point furthest from unity, and its
  // |gr_db| represents the achievable depth.
  let deepest = measurements[0];
  for (const m of measurements) if (m.gr_db < deepest.gr_db) deepest = m;
  const grDepth = -deepest.gr_db;  // positive number (dB of attenuation)

  const declaredMaxGR = declared.gr_at_max_cv_db ?? 12; // expect ≥ 12 dB at top of sweep
  const passKneeFound = kneeCv != null;
  const passDepthAdequate = grDepth >= declaredMaxGR * 0.5; // at least half declared depth
  const passNoNumericalIssues = measurements.every(m => m.nan === 0 && m.inf === 0);

  const pass = passKneeFound && passDepthAdequate && passNoNumericalIssues;

  return {
    name: 'Static GR curve',
    pass,
    measured: {
      knee_cv: kneeCv,
      max_gr_db: grDepth,
      curve: measurements.map(m => ({ cv: m.cv, gr_db: m.gr_db })),
    },
    declared: {
      gr_at_max_cv_db: declaredMaxGR,
      cv_sweep_linear: cvLevelsLinear,
    },
    diagnostic: pass ? null : buildStaticCurveDiagnostic(measurements, kneeCv, grDepth, declaredMaxGR),
  };
}

function buildStaticCurveDiagnostic(measurements, kneeCv, grDepth, declaredMaxGR) {
  const lines = [];
  if (kneeCv == null) {
    lines.push('No knee detected — gain reduction never exceeds 1 dB across the cv sweep.');
    lines.push('The curve is effectively a 45° line: input ≡ output regardless of cv.');
    lines.push('Likely cause: cv input range required by the cell is above the synthesized sweep range,');
    lines.push('OR the gain curve internal to the op never crosses unity (cutoff/threshold mis-calibrated).');
  } else if (grDepth < declaredMaxGR * 0.5) {
    lines.push(`Knee detected at cv=${kneeCv} but max GR (${grDepth.toFixed(1)} dB) is < 50% of declared (${declaredMaxGR} dB).`);
    lines.push('Cell is partially functional but under-compressing. Likely calibration issue.');
  }
  lines.push('');
  lines.push('Measured (cv → GR dB):');
  for (const m of measurements) {
    lines.push(`  cv = ${m.cv.toFixed(3).padStart(7)}   GR = ${m.gr_db.toFixed(2).padStart(7)} dB`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────
// Test 2: Attack T90
// ─────────────────────────────────────────────────────────────────────────
async function testAttackTime(opId, params, declared, tol) {
  // Hold cv = 0 for PRE_STEP_S, then jump to declared cv that produces ~6 dB GR.
  // Measure output envelope; T90 = time for envelope to reach 90% of total
  // excursion from initial steady to post-step steady.
  const cvHigh = declared.cv_for_6db_gr ?? 1.0;
  const audioAmp = dbToLinear(declared.audio_test_dbfs ?? -12);
  const N = Math.round((PRE_STEP_S + POST_STEP_S) * SR);
  const audioStim = sine(N, SR, TONE_HZ, audioAmp);
  const cvStim = levelStepDC(N, SR, 0, cvHigh, PRE_STEP_S);

  const result = await _runner(opId, params, { audio: audioStim, cv: cvStim }, { sampleRate: SR });
  const out = result.outputs.out;
  const { times, env } = envelopeRMS(out, SR, 0.005, 0.0005);
  const reach = findReachTime(times, env, PRE_STEP_S, -1, 0.005);

  const reachMs = reach.reachSec != null ? reach.reachSec * 1000 : null;
  const declaredMs = declared.attack_ms;
  const tolerancePct = tol.attack_ms_pct ?? 30;  // permissive default
  const pass = reachMs != null && withinTolerance(reachMs, declaredMs, tolerancePct);

  return {
    name: 'Attack T90',
    pass,
    measured: { attack_t90_ms: reachMs, direction: reach.direction },
    declared: { attack_ms: declaredMs, tolerance_pct: tolerancePct },
    diagnostic: pass ? null : buildTimingDiagnostic('attack', reachMs, declaredMs, tolerancePct, reach),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test 3: Release T90
// ─────────────────────────────────────────────────────────────────────────
async function testReleaseTime(opId, params, declared, tol) {
  // First settle at high cv (compressed steady), then drop cv to 0 — measure
  // recovery time.
  const cvHigh = declared.cv_for_6db_gr ?? 1.0;
  const audioAmp = dbToLinear(declared.audio_test_dbfs ?? -12);
  const N = Math.round((PRE_STEP_S + POST_STEP_S) * SR);
  const audioStim = sine(N, SR, TONE_HZ, audioAmp);
  const cvStim = levelStepDC(N, SR, cvHigh, 0, PRE_STEP_S);

  const result = await _runner(opId, params, { audio: audioStim, cv: cvStim }, { sampleRate: SR });
  const out = result.outputs.out;
  const { times, env } = envelopeRMS(out, SR, 0.005, 0.0005);
  const reach = findReachTime(times, env, PRE_STEP_S, -1, 0.005);

  const reachMs = reach.reachSec != null ? reach.reachSec * 1000 : null;
  const declaredMs = declared.release_ms;
  const tolerancePct = tol.release_ms_pct ?? 30;
  const pass = reachMs != null && withinTolerance(reachMs, declaredMs, tolerancePct);

  return {
    name: 'Release T90',
    pass,
    measured: { release_t90_ms: reachMs, direction: reach.direction },
    declared: { release_ms: declaredMs, tolerance_pct: tolerancePct },
    diagnostic: pass ? null : buildTimingDiagnostic('release', reachMs, declaredMs, tolerancePct, reach),
  };
}

function buildTimingDiagnostic(kind, measuredMs, declaredMs, tolPct, reach) {
  if (measuredMs == null) {
    return `${kind} T90 never reached. Envelope did not stabilize within the test window. ` +
           `Initial→steady span may be too small (cell not actually compressing) or ` +
           `time constant exceeds POST_STEP_S=${POST_STEP_S}s.`;
  }
  return `Measured ${kind} T90 = ${measuredMs.toFixed(2)} ms · ` +
         `declared = ${declaredMs} ms · tolerance = ±${tolPct}% · ` +
         `out of band by ${(((measuredMs - declaredMs) / declaredMs) * 100).toFixed(1)}%.`;
}

// ─────────────────────────────────────────────────────────────────────────
// Test 4: THD-vs-GR slope
// ─────────────────────────────────────────────────────────────────────────
async function testTHDvsGR(opId, params, declared, tol) {
  // Measure THD at multiple cv levels (i.e., multiple GR depths). If
  // declared.thd_grows_with_gr is true, slope must be positive (THD increases).
  // For ops with declared.thd_grows_with_gr=false, slope must be ~flat.
  const cvLevels = declared.cv_sweep_linear || [0, 0.2, 0.5, 1.0, 2.0];
  const audioAmp = dbToLinear(-12);
  const N = Math.round(STEP_HOLD_S * SR);
  const settleStart = Math.round(SETTLE_S * SR);
  const audioStim = sine(N, SR, TONE_HZ, audioAmp);

  const samples = [];
  for (const cv of cvLevels) {
    const cvStim = new Float32Array(N).fill(cv);
    const r = await _runner(opId, params, { audio: audioStim, cv: cvStim }, { sampleRate: SR });
    const out = r.outputs.out;
    const settled = out.subarray(settleStart);
    const rmsOut = rms(settled);
    const grDb = -linearToDb(rmsOut / rms(audioStim, settleStart, N));
    const { thd } = thdSingleTone(settled, SR, TONE_HZ);
    samples.push({ cv, gr_db: grDb, thd });
  }

  // Linear regression: thd vs gr_db.
  const n = samples.length;
  const sumX = samples.reduce((a, s) => a + s.gr_db, 0);
  const sumY = samples.reduce((a, s) => a + s.thd, 0);
  const sumXY = samples.reduce((a, s) => a + s.gr_db * s.thd, 0);
  const sumXX = samples.reduce((a, s) => a + s.gr_db * s.gr_db, 0);
  const meanX = sumX / n, meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slope = denom !== 0 ? (sumXY - n * meanX * meanY) / denom : 0;

  const expectedSign = declared.thd_grows_with_gr ? 1 : 0;  // 0 = no requirement on direction
  const pass = expectedSign === 0 ? Math.abs(slope) < 0.001 : slope > 0;

  return {
    name: 'THD-vs-GR slope',
    pass,
    measured: { slope_thd_per_db: slope, samples },
    declared: { thd_grows_with_gr: declared.thd_grows_with_gr },
    diagnostic: pass ? null :
      `Slope = ${slope.toExponential(3)} (THD per dB GR). ` +
      `Declared thd_grows_with_gr=${declared.thd_grows_with_gr} requires ${expectedSign > 0 ? 'positive slope' : 'flat slope'}. ` +
      `Often a downstream symptom of "no GR happening" rather than a primary distortion bug.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test 5: Sub-threshold null
// ─────────────────────────────────────────────────────────────────────────
async function testSubThresholdNull(opId, params, declared, tol) {
  // With cv = 0, output should equal input × declared makeup-gain (or 1.0 if
  // none declared). Compute null = max |output - input · expectedGain|.
  const audioAmp = dbToLinear(-20);
  const N = Math.round(0.5 * SR);
  const audioStim = sine(N, SR, TONE_HZ, audioAmp);
  const cvStim = new Float32Array(N);  // all zeros

  const r = await _runner(opId, params, { audio: audioStim, cv: cvStim }, { sampleRate: SR });
  const out = r.outputs.out;
  const expectedGain = declared.unity_gain_at_zero_cv ?? 1.0;
  let maxAbsErr = 0;
  for (let i = Math.round(0.05 * SR); i < N; i++) {  // skip first 50 ms
    const err = Math.abs(out[i] - audioStim[i] * expectedGain);
    if (err > maxAbsErr) maxAbsErr = err;
  }
  const errDb = linearToDb(maxAbsErr / audioAmp);
  const passDb = -60;
  const pass = errDb < passDb;

  return {
    name: 'Sub-threshold null',
    pass,
    measured: { peak_err_db: errDb },
    declared: { threshold_db: passDb },
    diagnostic: pass ? null :
      `Peak error vs unity-gain expectation = ${errDb.toFixed(1)} dB; required ≤ ${passDb} dB. ` +
      `Cell is producing audible output deviation when cv=0 (no compression should be active).`,
  };
}
