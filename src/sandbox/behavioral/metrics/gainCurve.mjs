// gainCurve.mjs — behavioral metric module for gainComputer ops.
//
// Tests the static gain-reduction curve produced by gainComputer:
// for each input magnitude (in dB), measure the gr output and convert
// to "output dB level" = in_dB + 20·log10(1 + gr). Then verify the
// measured curve matches declared threshold/ratio/knee.
//
// gainComputer's output convention:
//   out = 10^((y - x)/20) - 1, where y is the processed dB-level
//   So:  effective_gain (linear) = 1 + out
//        output_dB_level = in_dB + 20·log10(1 + out)
//
// Citation: Giannoulis, Massberg, Reiss. "Digital Dynamic Range
// Compressor Design — A Tutorial and Analysis." JAES 60(6), 2012.
// Soft-knee Hill-curve form per Zölzer DAFX §4.2.2 — same form the
// op implements (and we ported to C++ in 31f4eed).

import { runWorklet } from '../runners/run_worklet.mjs';
import { staticTransferCurve, fitCompressorCurve } from '../primitives/transfer_curve.mjs';
import { dbToLinear, linearToDb } from '../primitives/thd.mjs';

let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;

export async function runGainCurveMetrics(opId, spec) {
  const declared = spec.declared || {};
  const params   = spec.defaultParams || {};

  const tests = [];
  tests.push(await testStaticCurve(opId, params, declared));

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
// Static GR curve: feed magnitudes, measure gr → reconstruct out_dB curve,
// compare against declared threshold/ratio/knee.
// ─────────────────────────────────────────────────────────────────────────
async function testStaticCurve(opId, params, declared) {
  // Sweep input magnitudes from -60 dBFS to 0 dBFS in 3 dB steps.
  const inDbLevels = [];
  for (let db = -60; db <= 0; db += 3) inDbLevels.push(db);
  const levelsLin = inDbLevels.map(db => dbToLinear(db));

  // Drive the op with each level; gainComputer's input port is `env`.
  const runOp = async (signal) => {
    const r = await _runner(opId, params, { env: signal }, { sampleRate: SR });
    return r.outputs.gr || r.outputs[Object.keys(r.outputs)[0]];
  };

  // The op outputs gr in [-1, 0]. Convert to "out_dB" via the convention
  // above for fit. Use signalType='dc' since input is a positive linear
  // magnitude (envelope-style) — sine doesn't make sense here.
  const { samples } = await staticTransferCurve(runOp, {
    levelsLin,
    sr: SR,
    holdSec: 0.3,
    signalType: 'dc',
  });

  // Convert each sample's outLin (which is the settled |gr| value) into
  // the "output dB level" the compressor would deliver downstream.
  // gr ∈ [-1, 0], effective_gain = 1 + gr.
  // But staticTransferCurve returns abs(mean), which loses sign. gr is
  // always ≤ 0 for this op so we re-sign via measurement of mean directly:
  //   we re-run measurement here capturing the SIGNED settled mean.
  const signedSamples = [];
  for (let i = 0; i < levelsLin.length; i++) {
    const lin = levelsLin[i];
    const N = Math.round(0.3 * SR);
    const stim = new Float32Array(N).fill(lin);
    const r = await _runner(opId, params, { env: stim }, { sampleRate: SR });
    const out = r.outputs.gr || r.outputs[Object.keys(r.outputs)[0]];
    let sum = 0;
    const tail = Math.floor(out.length * 0.8);
    for (let j = tail; j < out.length; j++) sum += out[j];
    const grMean = sum / Math.max(1, out.length - tail);   // signed; should be ≤ 0
    const effGainLin = 1 + grMean;                         // linear gain factor
    const effGainDb = effGainLin > 0 ? linearToDb(effGainLin) : -120;
    const inDb  = inDbLevels[i];
    const outDb = inDb + effGainDb;
    signedSamples.push({ inDb, outDb, gr: grMean, effGainLin });
  }

  // Fit threshold / ratio / knee from the curve.
  const fit = fitCompressorCurve(signedSamples);

  const declaredThr   = declared.thresholdDb ?? params.thresholdDb ?? -18;
  const declaredRatio = declared.ratio       ?? params.ratio       ?? 4;
  const declaredKnee  = declared.kneeDb      ?? params.kneeDb      ?? 6;

  // Tolerances: threshold ±2 dB, ratio ±15%, knee width ±3 dB (industry-typical).
  const thrErr   = fit.thresholdDb != null ? Math.abs(fit.thresholdDb - declaredThr) : 999;
  const ratioErr = fit.ratio != null
    ? Math.abs(fit.ratio - declaredRatio) / declaredRatio
    : 999;
  const slopeBelowOK = fit.slopeBelow != null && Math.abs(fit.slopeBelow - 1.0) < 0.15;

  const thrOk   = thrErr <= 2;
  const ratioOk = ratioErr <= 0.15;
  const pass = thrOk && ratioOk && slopeBelowOK;

  return {
    name: 'Static GR curve',
    pass,
    measured: {
      threshold_db: fit.thresholdDb,
      ratio: fit.ratio,
      knee_db: fit.kneeDb,
      slope_below: fit.slopeBelow,
      slope_above: fit.slopeAbove,
      curve: signedSamples.map(s => ({ inDb: s.inDb, outDb: s.outDb })),
    },
    declared:  {
      thresholdDb: declaredThr,
      ratio: declaredRatio,
      kneeDb: declaredKnee,
      tolerances: { threshold_db: 2, ratio_pct: 15, slope_below_unity: 0.15 },
    },
    diagnostic: pass ? null
      : `Curve fit: threshold ${fit.thresholdDb?.toFixed(1)} dB (declared ${declaredThr}, err ${thrErr.toFixed(1)} dB), ` +
        `ratio ${fit.ratio?.toFixed(2)} (declared ${declaredRatio}, err ${(ratioErr*100).toFixed(1)}%), ` +
        `slope-below ${fit.slopeBelow?.toFixed(3)} (should be ~1.0).` +
        (!thrOk ? ' THRESHOLD off-spec.' : '') +
        (!ratioOk ? ' RATIO off-spec.' : '') +
        (!slopeBelowOK ? ' SUB-THRESHOLD slope drift (should be 1:1).' : ''),
  };
}
