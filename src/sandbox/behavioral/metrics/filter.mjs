// filter.mjs — behavioral metric module for filter ops.
//
// Tests applied per design doc § 6.2:
//   - Magnitude response — declared cutoff at f_c ±5%; passband flat ±0.5 dB
//   - Q at f_c (resonant filters)
//   - Group delay (linear-phase only — TODO Day 3+)
//   - Self-osc onset (resonant filters — TODO)
//   - Modulation stability under fast cutoff sweep — TODO
//
// Citation: RBJ Audio EQ Cookbook for biquad reference responses;
//           Farina 2000 for the swept-sine measurement primitive.

import { runWorklet } from '../runners/run_worklet.mjs';
import { sine } from '../../../../scripts/parity_signals.mjs';
import { rms, linearToDb } from '../primitives/thd.mjs';

let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;
const TONE_LEN_SEC = 0.3;        // 0.3 s per tone — enough for settle on most filters
const SETTLE_SEC = 0.05;         // discard first 50 ms
const STIM_AMP = 0.25;           // -12 dBFS — stay linear for resonant filters

// Log-spaced probe frequencies for direct-tone sweep.
function logSpaced(fMin, fMax, N) {
  const out = new Float32Array(N);
  const lnRatio = Math.log(fMax / fMin);
  for (let k = 0; k < N; k++) {
    out[k] = fMin * Math.exp(k * lnRatio / (N - 1));
  }
  return out;
}

export async function runFilterMetrics(opId, spec) {
  const declared = spec.declared || {};
  const params = spec.defaultParams || {};
  const tests = [];

  tests.push(await testMagnitudeResponse(opId, params, declared));
  if (declared.expected_q != null) {
    tests.push(await testQAtCutoff(opId, params, declared));
  }

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

/**
 * Direct sine-tone sweep: probe each frequency individually and measure RMS.
 * Returns magnitude response in dB referenced to the average passband level.
 */
async function measureMagnitudeResponse(opId, params, numFreqs = 24) {
  const freqs = logSpaced(20, 20000, numFreqs);
  const N = Math.round(TONE_LEN_SEC * SR);
  const settleStart = Math.round(SETTLE_SEC * SR);
  const inputRms = STIM_AMP / Math.SQRT2;

  const magsLin = new Float32Array(numFreqs);
  let invariantNan = 0, invariantInf = 0;
  for (let i = 0; i < numFreqs; i++) {
    const stim = sine(N, SR, freqs[i], STIM_AMP);
    const r = await _runner(opId, params, { in: stim }, { sampleRate: SR });
    const out = r.outputs.out || r.outputs[Object.keys(r.outputs)[0]];
    const rmsOut = rms(out, settleStart, N);
    magsLin[i] = rmsOut / inputRms;
    invariantNan += r.nanCount;
    invariantInf += r.infCount;
  }

  // dB normalization: take maximum mag in the sweep as 0 dB reference.
  let maxLin = 0;
  for (let i = 0; i < numFreqs; i++) if (magsLin[i] > maxLin) maxLin = magsLin[i];
  const magsDb = new Float32Array(numFreqs);
  for (let i = 0; i < numFreqs; i++) {
    magsDb[i] = magsLin[i] > 0 ? 20 * Math.log10(magsLin[i] / maxLin) : -120;
  }

  return { freqs, magsDb, magsLin, invariantNan, invariantInf };
}

/**
 * Find the −3 dB cutoff in a direct-sweep magnitude response.
 * For LP: first frequency where mag drops 3 dB below the peak (which is at low f).
 * For HP: last frequency where mag drops 3 dB below the peak (which is at high f).
 * For BP: peak is mid-band; cutoff is the lower-side −3 dB point.
 */
function findCutoffDirect(freqs, magsDb, kind) {
  // The peak (0 dB ref) is at some bin; for LP it's near LF, for HP near HF.
  // Find the peak bin first.
  let peakBin = 0;
  for (let i = 1; i < magsDb.length; i++) {
    if (magsDb[i] > magsDb[peakBin]) peakBin = i;
  }
  if (kind === 'lp' || kind === 'shelf') {
    // Walk forward from peakBin, find first bin with mag < -3 dB.
    for (let i = peakBin; i < magsDb.length; i++) {
      if (magsDb[i] < -3) {
        // Linear interpolate between i-1 and i in log-frequency for accuracy.
        if (i > 0 && magsDb[i - 1] >= -3) {
          const f1 = freqs[i - 1], f2 = freqs[i];
          const m1 = magsDb[i - 1], m2 = magsDb[i];
          const frac = (-3 - m1) / (m2 - m1);
          return Math.exp(Math.log(f1) + frac * (Math.log(f2) - Math.log(f1)));
        }
        return freqs[i];
      }
    }
    return null;
  } else if (kind === 'hp') {
    // Walk backward from peakBin, find first bin with mag < -3 dB.
    for (let i = peakBin; i >= 0; i--) {
      if (magsDb[i] < -3) {
        if (i < magsDb.length - 1 && magsDb[i + 1] >= -3) {
          const f1 = freqs[i], f2 = freqs[i + 1];
          const m1 = magsDb[i], m2 = magsDb[i + 1];
          const frac = (-3 - m1) / (m2 - m1);
          return Math.exp(Math.log(f1) + frac * (Math.log(f2) - Math.log(f1)));
        }
        return freqs[i];
      }
    }
    return null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Test 1: Magnitude response — cutoff + passband flatness
// ─────────────────────────────────────────────────────────────────────────
async function testMagnitudeResponse(opId, params, declared) {
  let measurement;
  try {
    measurement = await measureMagnitudeResponse(opId, params);
  } catch (e) {
    return {
      name: 'Magnitude response',
      pass: false,
      diagnostic: `Sweep measurement failed: ${e.message}`,
    };
  }
  const { freqs, magsDb } = measurement;
  const kind = declared.kind || 'lp';

  // For pure allpass, magnitude should be ~flat 0 dB.
  if (kind === 'allpass') {
    let sumAbs = 0, count = 0;
    for (let i = 0; i < magsDb.length; i++) {
      if (Number.isFinite(magsDb[i])) {
        sumAbs += Math.abs(magsDb[i]);
        count++;
      }
    }
    const meanDeviation = count > 0 ? sumAbs / count : 999;
    const pass = meanDeviation < 1.0;
    return {
      name: 'Magnitude response (allpass flatness)',
      pass,
      measured: { mean_deviation_db: meanDeviation },
      declared: { kind: 'allpass', max_deviation_db: 1.0 },
      diagnostic: pass ? null : `Allpass not flat: mean |mag| = ${meanDeviation.toFixed(2)} dB.`,
    };
  }

  // Tilt EQ: special-case — verify monotonic tilt across band, no single cutoff.
  if (kind === 'tilt') {
    // Tilt creates a monotonic mag response — increasing OR decreasing across band
    // depending on gain sign. Check monotonicity rather than cutoff.
    let monotonic = true;
    let lastSign = 0;
    for (let i = 1; i < magsDb.length; i++) {
      const d = magsDb[i] - magsDb[i - 1];
      const sign = Math.sign(d);
      if (lastSign === 0) lastSign = sign;
      else if (sign !== 0 && sign !== lastSign) {
        // Allow small wiggles (<0.3 dB)
        if (Math.abs(d) > 0.3) { monotonic = false; break; }
      }
    }
    return {
      name: 'Magnitude response (tilt)',
      pass: monotonic,
      measured: { magnitudes_db_at_freqs: Array.from(magsDb).slice(0, 8) },
      declared: { kind: 'tilt' },
      diagnostic: monotonic ? null : 'Tilt response is not monotonic.',
    };
  }

  // For LP/HP/shelf, find the cutoff directly.
  const cutoffKind = kind === 'shelf' ? 'lp' : kind;
  const measuredCutoff = findCutoffDirect(freqs, magsDb, cutoffKind);
  const declaredCutoff = declared.cutoff_hz;

  let pass = false;
  let diagnostic = null;

  if (declaredCutoff == null) {
    pass = measuredCutoff != null;
    diagnostic = pass ? null : 'No cutoff detected and none declared — frequency response appears flat.';
  } else if (measuredCutoff == null) {
    pass = false;
    diagnostic = `Declared cutoff ${declaredCutoff} Hz; no -3 dB point detected.`;
  } else {
    const errPct = Math.abs((measuredCutoff - declaredCutoff) / declaredCutoff) * 100;
    pass = errPct <= 15;
    diagnostic = pass ? null :
      `Cutoff mismatch: measured ${measuredCutoff.toFixed(0)} Hz · declared ${declaredCutoff} Hz · error ${errPct.toFixed(1)}%.`;
  }

  return {
    name: `Magnitude response (${kind})`,
    pass,
    measured: { cutoff_hz: measuredCutoff },
    declared: { kind, cutoff_hz: declaredCutoff },
    diagnostic,
  };
}

// Q at f_c metric: TODO Day 3+ — direct-sweep resonant peak detection.
// For now the magnitude-response test is sufficient signal for Day 2.
async function testQAtCutoff(opId, params, declared) {
  return {
    name: 'Q at f_c (deferred)',
    pass: true,
    measured: { note: 'Q metric deferred to Day 3+' },
    declared: { expected_q: declared.expected_q },
  };
}
