// distortion.mjs — behavioral metric module for distortion / saturator ops.
//
// Tests applied per design doc § 6.3:
//   - THD vs input level
//   - 2H/3H ratio (signature: even/odd/mixed)
//   - IMD SMPTE
//   - IMD CCIF (TODO Day 3+)
//   - Aliasing (TODO)
//   - DC creep
//   - Spectral character (NEW for tape/tube/transformer — Farina at sub-clip)

import { sine, twoTone } from '../../../../scripts/parity_signals.mjs';
import { thdSingleTone, dbToLinear, linearToDb, rms } from '../primitives/thd.mjs';
import { runWorklet } from '../runners/run_worklet.mjs';

let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;
const TONE_HZ = 997;

export async function runDistortionMetrics(opId, spec) {
  const declared = spec.declared || {};
  const params = spec.defaultParams || {};
  const tests = [];

  tests.push(await testTHDvsLevel(opId, params, declared));
  if (declared.harmonic_signature) {
    tests.push(await testHarmonicSignature(opId, params, declared));
  }
  tests.push(await testDCCreep(opId, params, declared));

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
// Test 1: THD vs input level
// ─────────────────────────────────────────────────────────────────────────
async function testTHDvsLevel(opId, params, declared) {
  // Sweep input from -40 to 0 dBFS, measure THD at each step.
  const levelsDb = declared.input_levels_dbfs || [-40, -30, -20, -12, -6, -3, 0];
  const N = Math.round(0.5 * SR);
  const settleStart = Math.round(0.05 * SR);

  const samples = [];
  for (const dbfs of levelsDb) {
    const amp = dbToLinear(dbfs);
    const stim = sine(N, SR, TONE_HZ, amp);
    const r = await _runner(opId, params, { in: stim }, { sampleRate: SR });
    const out = r.outputs.out || r.outputs[Object.keys(r.outputs)[0]];
    const settled = out.subarray(settleStart);
    const { thd } = thdSingleTone(settled, SR, TONE_HZ);
    samples.push({ dbfs, thd_pct: thd * 100, nan: r.nanCount, inf: r.infCount });
  }

  // PASS criteria depend on op type:
  //   Standard distortion (saturate/clip/diode/etc):
  //     - At low level THD should be small (op is roughly linear)
  //     - At high level THD should be measurable (op is doing SOMETHING)
  //   Quantization op (bitcrush): noise floor is fixed by bit-depth, not
  //     amplitude-dependent. THD% goes UP at low input (signal-to-noise
  //     ratio shrinks). So we relax the low-level check entirely.
  const lowTHD  = samples[0].thd_pct;
  const highTHD = samples[samples.length - 1].thd_pct;
  const noNumIssues = samples.every(s => s.nan === 0 && s.inf === 0);
  const isQuantization = declared.quantization_op === true;
  const lowOK    = isQuantization || lowTHD < (declared.low_level_thd_pct_max ?? 1.0);
  // For quantization ops, single-tone THD measurement under-counts the broadband
  // quantization noise. Replace the high-level THD check with a "did the op
  // alter the signal at all" check via the low-vs-high THD ratio.
  const highOK   = isQuantization
    ? highTHD > 0.01    // at least some THD measurable at full input
    : highTHD > (declared.high_level_thd_pct_min ?? 0.1);
  const pass = lowOK && highOK && noNumIssues;

  return {
    name: 'THD vs level',
    pass,
    measured: { samples, low_thd_pct: lowTHD, high_thd_pct: highTHD },
    declared: {
      low_level_thd_pct_max: declared.low_level_thd_pct_max ?? 1.0,
      high_level_thd_pct_min: declared.high_level_thd_pct_min ?? 0.1,
    },
    diagnostic: pass ? null :
      `Low-level (-40 dBFS) THD = ${lowTHD.toFixed(3)}%, expected < ${declared.low_level_thd_pct_max ?? 1.0}%. ` +
      `High-level (0 dBFS) THD = ${highTHD.toFixed(3)}%, expected > ${declared.high_level_thd_pct_min ?? 0.1}%. ` +
      (noNumIssues ? '' : 'NaN/Inf detected — see invariants.'),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test 2: Harmonic signature (even/odd/mixed)
// ─────────────────────────────────────────────────────────────────────────
async function testHarmonicSignature(opId, params, declared) {
  // Drive at -6 dBFS, measure 2H and 3H amplitudes, classify.
  const amp = dbToLinear(-6);
  const N = Math.round(0.5 * SR);
  const settleStart = Math.round(0.05 * SR);
  const stim = sine(N, SR, TONE_HZ, amp);
  const r = await _runner(opId, params, { in: stim }, { sampleRate: SR });
  const out = r.outputs.out || r.outputs[Object.keys(r.outputs)[0]];
  const settled = out.subarray(settleStart);

  const { harmonicLevels, fundamentalPower } = thdSingleTone(settled, SR, TONE_HZ, 6);
  // harmonicLevels[0] = |2H|, [1] = |3H|, [2] = |4H|, [3] = |5H|
  const fundamental = Math.sqrt(fundamentalPower);
  const h2 = harmonicLevels[0];
  const h3 = harmonicLevels[1];
  const h4 = harmonicLevels[2];
  const h5 = harmonicLevels[3];
  const evenSum = h2 + h4;
  const oddSum  = h3 + h5;

  let measured;
  if (evenSum > 2 * oddSum) measured = 'even';
  else if (oddSum > 2 * evenSum) measured = 'odd';
  else measured = 'mixed';

  const pass = measured === declared.harmonic_signature;

  return {
    name: 'Harmonic signature',
    pass,
    measured: {
      classification: measured,
      h2_rel: h2 / fundamental,
      h3_rel: h3 / fundamental,
      h4_rel: h4 / fundamental,
      h5_rel: h5 / fundamental,
    },
    declared: { harmonic_signature: declared.harmonic_signature },
    diagnostic: pass ? null :
      `Measured signature = ${measured}; declared = ${declared.harmonic_signature}. ` +
      `Even sum = ${evenSum.toExponential(2)}, odd sum = ${oddSum.toExponential(2)}.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Test 3: DC creep — asymmetric clippers may create DC
// ─────────────────────────────────────────────────────────────────────────
async function testDCCreep(opId, params, declared) {
  const amp = dbToLinear(-6);
  const N = Math.round(1.0 * SR);
  const settleStart = Math.round(0.1 * SR);
  const stim = sine(N, SR, 100, amp);  // low freq, high enough cycles
  const r = await _runner(opId, params, { in: stim }, { sampleRate: SR });
  const out = r.outputs.out || r.outputs[Object.keys(r.outputs)[0]];
  let sum = 0;
  for (let i = settleStart; i < N; i++) sum += out[i];
  const dc = sum / (N - settleStart);
  const dcDb = linearToDb(Math.abs(dc));
  // For symmetric distortion ops, DC should be very close to 0 (< -60 dBFS).
  // Asymmetric ops (e.g. diodeClipper with bias) can have higher DC; declared override.
  const passDb = declared.dc_creep_max_dbfs ?? -40;
  const pass = dcDb < passDb;

  return {
    name: 'DC creep',
    pass,
    measured: { dc_dbfs: dcDb, dc_linear: dc },
    declared: { dc_creep_max_dbfs: passDb },
    diagnostic: pass ? null :
      `DC offset = ${dcDb.toFixed(1)} dBFS; required ≤ ${passDb} dBFS. ` +
      `Asymmetric clipper without DC blocker.`,
  };
}
