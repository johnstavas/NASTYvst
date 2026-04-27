// transfer_curve.mjs — static-input transfer curve measurement.
//
// For ops/recipes that take an input MAGNITUDE and produce an OUTPUT
// magnitude (e.g. gainComputer's env→gr, or a compressor recipe's
// in_dB→out_dB static curve). Stimulus = constant DC at each level,
// hold long enough for any internal smoothing to settle, measure the
// settled output. Plot in_dB vs out_dB.
//
// Used by:
//   - metrics/gainCurve.mjs (gainComputer threshold/ratio/knee verification)
//   - metrics/compressorRecipe.mjs (Day 6+: graph-level compressor static curve)
//
// Citation: Giannoulis, Massberg, Reiss. "Digital Dynamic Range Compressor
// Design — A Tutorial and Analysis." JAES 60(6), 2012.

import { rms, dbToLinear, linearToDb } from './thd.mjs';

/**
 * Run a steady-state transfer-curve sweep. For each level in `levelsLin`,
 * feed a constant-amplitude signal of that level for `holdSec` seconds,
 * measure the RMS (or peak) of the settled output (last 20% of the hold).
 *
 * @param {function} runOp  async (signal: Float32Array) => output: Float32Array
 * @param {object} opts
 * @param {number[]|Float32Array} opts.levelsLin  input levels in linear (e.g. magnitudes for gainComputer.env)
 * @param {number} opts.sr        sample rate
 * @param {number} opts.holdSec   how long to hold each level (default 0.5 s)
 * @param {string} opts.signalType  'dc' (default; constant) | 'sine' (1 kHz sine)
 * @param {number} opts.sineHz    sine frequency if signalType='sine'
 * @returns {Promise<{ samples: Array<{inLin, outLin, inDb, outDb}> }>}
 */
export async function staticTransferCurve(runOp, {
  levelsLin,
  sr = 48000,
  holdSec = 0.5,
  signalType = 'dc',
  sineHz = 1000,
} = {}) {
  const N = Math.round(holdSec * sr);
  const settledStart = Math.floor(N * 0.8);   // last 20% = settled
  const samples = [];

  for (const lin of levelsLin) {
    const stim = new Float32Array(N);
    if (signalType === 'sine') {
      const w = 2 * Math.PI * sineHz / sr;
      for (let i = 0; i < N; i++) stim[i] = lin * Math.sin(w * i);
    } else {
      // DC constant.
      stim.fill(lin);
    }

    const out = await runOp(stim);
    if (!out || out.length === 0) {
      samples.push({ inLin: lin, outLin: 0, inDb: linearToDb(lin), outDb: -Infinity });
      continue;
    }

    // Output measurement: RMS over settled tail. For DC stimulus, RMS = |mean|;
    // for sine stimulus, RMS = peak/√2.
    let outLin;
    if (signalType === 'sine') {
      outLin = rms(out, settledStart, out.length);
    } else {
      // DC case: take mean of absolute values to capture sign-correct level.
      let sum = 0;
      for (let i = settledStart; i < out.length; i++) sum += out[i];
      outLin = Math.abs(sum / Math.max(1, out.length - settledStart));
    }

    samples.push({
      inLin: lin,
      outLin,
      inDb:  linearToDb(Math.abs(lin) || 1e-12),
      outDb: linearToDb(outLin || 1e-12),
    });
  }

  return { samples };
}

/**
 * Fit a 3-region piecewise compressor curve to a sample set:
 *   below threshold:  out_dB = in_dB                       (1:1)
 *   above threshold:  out_dB = thr + (in_dB - thr) / ratio (compressed slope)
 *   knee region:      smooth quadratic blend
 *
 * Estimates threshold and ratio from the asymptotic slopes of the curve.
 * Knee width is harder to extract from sparse samples; we report it as
 * "the band over which slope transitions from 1.0 to 1/ratio".
 *
 * @param {Array<{inDb, outDb}>} samples  sorted by inDb ascending
 * @returns {{ thresholdDb, ratio, kneeDb, slopeBelow, slopeAbove }}
 */
export function fitCompressorCurve(samples) {
  if (samples.length < 4) {
    return { thresholdDb: null, ratio: null, kneeDb: null, slopeBelow: null, slopeAbove: null };
  }
  const sorted = [...samples].sort((a, b) => a.inDb - b.inDb);

  // Slope estimate at the LOW end: average dy/dx over first quartile.
  // Slope estimate at the HIGH end: average dy/dx over last quartile.
  const q = Math.max(1, Math.floor(sorted.length / 4));
  let sBelow = 0, sAbove = 0;
  for (let i = 0; i < q; i++) {
    sBelow += (sorted[i + 1].outDb - sorted[i].outDb) /
              Math.max(1e-6, sorted[i + 1].inDb - sorted[i].inDb);
  }
  sBelow /= q;
  for (let i = sorted.length - q - 1; i < sorted.length - 1; i++) {
    sAbove += (sorted[i + 1].outDb - sorted[i].outDb) /
              Math.max(1e-6, sorted[i + 1].inDb - sorted[i].inDb);
  }
  sAbove /= q;

  // Ratio = 1 / slopeAbove (above threshold, output rises slower than input).
  const ratio = sAbove > 0.001 ? 1 / sAbove : null;

  // Threshold = where the LP-extrapolated below-line meets the HP-extrapolated above-line.
  // below: out = inDb (slope ~1, intercept 0)
  // above: out = sAbove * inDb + b_above
  // intersect:  inDb = sAbove * inDb + b_above
  //          → inDb (1 - sAbove) = b_above
  //          → inDb = b_above / (1 - sAbove)
  // Compute b_above from a high-end sample.
  const hiSample = sorted[sorted.length - 1];
  const bAbove = hiSample.outDb - sAbove * hiSample.inDb;
  const thresholdDb = (1 - sAbove) > 0.01 ? bAbove / (1 - sAbove) : null;

  // Knee width estimate: range where local slope is between 0.95 and 1/ratio·1.05.
  // Crude: scan for inflection band. Skip a precise number for now.
  let kneeDb = null;
  if (thresholdDb != null && ratio != null) {
    // Crude width: distance from 80%-of-max-slope to 110%-of-min-slope.
    const slopeMid = 0.5 * (sBelow + sAbove);
    let inLow = null, inHigh = null;
    for (let i = 1; i < sorted.length; i++) {
      const localSlope = (sorted[i].outDb - sorted[i - 1].outDb) /
                         Math.max(1e-6, sorted[i].inDb - sorted[i - 1].inDb);
      if (inLow == null && localSlope <= slopeMid) inLow = sorted[i].inDb;
      if (localSlope <= sAbove * 1.1 && localSlope >= sAbove * 0.9) inHigh = sorted[i].inDb;
    }
    if (inLow != null && inHigh != null && inHigh > inLow) kneeDb = inHigh - inLow;
  }

  return { thresholdDb, ratio, kneeDb, slopeBelow: sBelow, slopeAbove: sAbove };
}
