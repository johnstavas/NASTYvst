// runBrowserMetric.js — browser-side metric runner.
//
// Mirrors the headless metric harness but returns rich plot data + plain-
// English explanations alongside pass/fail so the per-op QC view can render
// charts, not just dots. Every metric returns the same shape:
//
//   {
//     summary: { total, passed, failed, verdict: 'PASS'|'FAIL' },
//     tests: [{
//       name:        'Closed-form identity',
//       pass:        true|false,
//       explanation: 'In plain English: what this test does and why',
//       declared:    { ...what the spec says... },
//       measured:    { ...what we measured... },
//       plot: {                              // optional, drives charts
//         kind:   'lineXY' | 'curveDeclMeas' | 'stepResponse' | 'spectrum',
//         title:  'Output level vs input level',
//         xLabel: 'Input dBFS',
//         yLabel: 'Output dBFS',
//         series: [{ name, color, points: [[x,y],...] }, ...],
//         markers: [{ x, label, color }, ...],   // optional vertical markers
//       },
//       diagnostic: '...' // shown on FAIL only
//     }, ...]
//   }
//
// Spec routing: the `category` field on the spec selects which metric runs.
// Extend BROWSER_METRIC_REGISTRY as you add more.

import { runWorkletBrowser } from './runners/run_worklet_browser.js';
import { dbToLinear, linearToDb, rms, thdSingleTone, magnitudeSpectrum } from './primitives/thd.mjs';
import { levelStepDC, envelopeRMS, findReachTime, withinTolerance } from './primitives/step_response.mjs';
import { staticTransferCurve, fitCompressorCurve } from './primitives/transfer_curve.mjs';

const SR = 48000;

// ── UTILITY: closed-form identity check ─────────────────────────────────
async function runUtilityMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const fn = declared.expectedFn;
  if (typeof fn !== 'function') {
    return {
      summary: { total: 0, passed: 0, failed: 0, verdict: 'PASS' },
      tests: [{
        name: 'Identity / closed-form',
        pass: true,
        explanation: 'Spec declared no expectedFn; nothing to verify here.',
        declared: {}, measured: {},
      }],
    };
  }

  // Simple test signal: 1 kHz sine + a few transients.
  const N = Math.round(0.05 * SR);
  const stim = new Float32Array(N);
  for (let i = 0; i < N; i++) stim[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / SR);

  const inputPort = declared.inputPort || 'in';
  const r = await runWorkletBrowser(opId, params, { [inputPort]: stim }, { sampleRate: SR });
  const outKey = Object.keys(r.outputs)[0];
  const out = r.outputs[outKey];

  // Compute expected per-sample.
  const expected = new Float32Array(N);
  for (let i = 0; i < N; i++) expected[i] = fn(stim[i], params);

  // Sample-by-sample diff (worst case + RMS error).
  let worstAbs = 0, sse = 0;
  for (let i = 0; i < N; i++) {
    const d = out[i] - expected[i];
    if (Math.abs(d) > worstAbs) worstAbs = Math.abs(d);
    sse += d * d;
  }
  const rmsErr = Math.sqrt(sse / N);
  const tolerance = declared.tolerance ?? 1e-5;
  const pass = worstAbs <= tolerance;

  // Plot the first 256 samples (≈ 5.3 ms @ 48 kHz) — enough to see shape
  // without overwhelming the chart.
  const plotN = Math.min(256, N);
  const inPts = [], outPts = [], expPts = [];
  for (let i = 0; i < plotN; i++) {
    const t = (i / SR) * 1000;     // ms
    inPts.push([t, stim[i]]);
    outPts.push([t, out[i]]);
    expPts.push([t, expected[i]]);
  }

  return {
    summary: { total: 1, passed: pass ? 1 : 0, failed: pass ? 0 : 1, verdict: pass ? 'PASS' : 'FAIL' },
    tests: [{
      name: 'Closed-form identity',
      pass,
      explanation:
        `Drive a 1 kHz sine at 0.5 amplitude into the op. Compare every output ` +
        `sample against the declared closed-form formula (${fn.toString().split('=>')[1]?.trim() || 'expectedFn'}). ` +
        `Pass if worst-case absolute error is within ${tolerance}.`,
      declared: { tolerance, formula: fn.toString() },
      measured: {
        worst_abs_error: worstAbs.toExponential(3),
        rms_error: rmsErr.toExponential(3),
      },
      plot: {
        kind: 'sampleTrace',
        title: 'Input vs Output vs Expected (first 5 ms)',
        xLabel: 'Time (ms)', yLabel: 'Amplitude',
        series: [
          { name: 'input',    color: '#7fff8f', points: inPts },
          { name: 'output',   color: '#d99fcf', points: outPts },
          { name: 'expected', color: 'rgba(255,255,255,0.4)', points: expPts },
        ],
      },
      diagnostic: pass ? null
        : `Worst sample error ${worstAbs.toExponential(3)} exceeds tolerance ${tolerance}. ` +
          `If output and expected overlap visually but error is large, check param values vs. spec.`,
    }],
  };
}

// ── ENVELOPE: T90 attack / T90 release / steady-state ──────────────────
async function runEnvelopeMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const PRE_S = 0.4, POST_S = 1.5;
  const N = Math.round((PRE_S + POST_S) * SR);
  const tests = [];

  // ── Attack T90 ───────────────────────────────────────────────────
  if (declared.attack_ms != null) {
    const lo = declared.step_lo ?? 0.0;
    const hi = declared.step_hi ?? 0.5;
    const stim = levelStepDC(N, SR, lo, hi, PRE_S);
    const r = await runWorkletBrowser(opId, params, { in: stim }, { sampleRate: SR });
    const outKey = r.outputs.env != null ? 'env' : Object.keys(r.outputs)[0];
    const out = r.outputs[outKey];
    const absOut = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) absOut[i] = Math.abs(out[i]);
    const { times, env } = envelopeRMS(absOut, SR, 0.005, 0.0005);
    const reach = findReachTime(times, env, PRE_S, -1, 0.005);
    const reachMs = reach.reachSec != null ? reach.reachSec * 1000 : null;
    const tol = declared.tolerance_pct?.attack_ms ?? 30;
    const pass = reachMs != null && withinTolerance(reachMs, declared.attack_ms, tol);
    const points = [];
    for (let i = 0; i < env.length; i++) points.push([times[i] * 1000, env[i]]);
    const stimPts = [];
    for (let i = 0; i < absOut.length; i += 16) stimPts.push([(i / SR) * 1000, Math.abs(stim[i])]);
    tests.push({
      name: 'Attack T90',
      pass,
      explanation:
        `Step the input from ${lo} to ${hi} at t=${(PRE_S * 1000).toFixed(0)} ms. ` +
        `Measure the time it takes for the output envelope to reach 90% of its ` +
        `final settled level (T90, per IEC 60268-3). Pass if measured T90 is ` +
        `within ±${tol}% of the declared ${declared.attack_ms} ms.`,
      declared: { attack_ms: declared.attack_ms, tolerance_pct: tol },
      measured: { attack_t90_ms: reachMs?.toFixed(1) },
      plot: {
        kind: 'stepResponse',
        title: 'Attack step response',
        xLabel: 'Time (ms)', yLabel: 'Envelope (linear)',
        series: [
          { name: 'input',   color: 'rgba(255,255,255,0.35)', points: stimPts },
          { name: 'output env', color: '#7fff8f', points },
        ],
        markers: [
          { x: PRE_S * 1000,                     label: 'step',     color: '#7fff8f' },
          { x: reachMs != null ? PRE_S * 1000 + reachMs : null, label: `T90 ${reachMs?.toFixed(0)}ms`, color: '#d99fcf' },
          { x: PRE_S * 1000 + declared.attack_ms, label: `declared ${declared.attack_ms}ms`, color: '#5ed184' },
        ].filter(m => m.x != null),
      },
      diagnostic: pass ? null
        : `Measured T90 = ${reachMs == null ? 'never reached' : reachMs.toFixed(1) + ' ms'}; declared ${declared.attack_ms} ms ± ${tol}%.`,
    });
  }

  // ── Release T90 ──────────────────────────────────────────────────
  if (declared.release_ms != null) {
    const lo = declared.step_lo ?? 0.0;
    const hi = declared.step_hi ?? 0.5;
    const stim = levelStepDC(N, SR, hi, lo, PRE_S);
    const r = await runWorkletBrowser(opId, params, { in: stim }, { sampleRate: SR });
    const outKey = r.outputs.env != null ? 'env' : Object.keys(r.outputs)[0];
    const out = r.outputs[outKey];
    const absOut = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) absOut[i] = Math.abs(out[i]);
    const { times, env } = envelopeRMS(absOut, SR, 0.005, 0.0005);
    const reach = findReachTime(times, env, PRE_S, -1, 0.005);
    const reachMs = reach.reachSec != null ? reach.reachSec * 1000 : null;
    const tol = declared.tolerance_pct?.release_ms ?? 30;
    const pass = reachMs != null && withinTolerance(reachMs, declared.release_ms, tol);
    const points = [];
    for (let i = 0; i < env.length; i++) points.push([times[i] * 1000, env[i]]);
    const stimPts = [];
    for (let i = 0; i < absOut.length; i += 16) stimPts.push([(i / SR) * 1000, Math.abs(stim[i])]);
    tests.push({
      name: 'Release T90',
      pass,
      explanation:
        `Step the input from ${hi} down to ${lo} at t=${(PRE_S * 1000).toFixed(0)} ms. ` +
        `Measure how fast the envelope recovers (T90 in the falling direction). ` +
        `Pass if within ±${tol}% of declared ${declared.release_ms} ms.`,
      declared: { release_ms: declared.release_ms, tolerance_pct: tol },
      measured: { release_t90_ms: reachMs?.toFixed(1) },
      plot: {
        kind: 'stepResponse',
        title: 'Release step response',
        xLabel: 'Time (ms)', yLabel: 'Envelope (linear)',
        series: [
          { name: 'input',   color: 'rgba(255,255,255,0.35)', points: stimPts },
          { name: 'output env', color: '#7fff8f', points },
        ],
        markers: [
          { x: PRE_S * 1000, label: 'step', color: '#7fff8f' },
          { x: reachMs != null ? PRE_S * 1000 + reachMs : null, label: `T90 ${reachMs?.toFixed(0)}ms`, color: '#d99fcf' },
          { x: PRE_S * 1000 + declared.release_ms, label: `declared ${declared.release_ms}ms`, color: '#5ed184' },
        ].filter(m => m.x != null),
      },
      diagnostic: pass ? null
        : `Measured T90 = ${reachMs == null ? 'never reached' : reachMs.toFixed(1) + ' ms'}; declared ${declared.release_ms} ms ± ${tol}%.`,
    });
  }

  // ── Steady-state level ────────────────────────────────────────────
  const steadyInput = declared.steady_input ?? 0.5;
  const Nss = Math.round(2.0 * SR);
  const stimSS = new Float32Array(Nss).fill(steadyInput);
  const r2 = await runWorkletBrowser(opId, params, { in: stimSS }, { sampleRate: SR });
  const outKey2 = r2.outputs.env != null ? 'env' : Object.keys(r2.outputs)[0];
  const outSS = r2.outputs[outKey2];
  const tail = Math.floor(Nss * 0.75);
  let sum = 0;
  for (let i = tail; i < Nss; i++) sum += outSS[i];
  const measured = sum / Math.max(1, Nss - tail);
  const amount = params.amount ?? 1;
  const offset = params.offset ?? 0;
  const expected = amount * steadyInput + offset;
  const err = Math.abs(measured - expected);
  const tol2 = Math.max(1e-3, Math.abs(expected) * 0.05);
  const passSS = err <= tol2;
  const ssTrace = [];
  for (let i = 0; i < outSS.length; i += Math.floor(outSS.length / 256)) {
    ssTrace.push([(i / SR) * 1000, outSS[i]]);
  }
  tests.push({
    name: 'Steady-state level',
    pass: passSS,
    explanation:
      `Hold the input at ${steadyInput} for 2 seconds. After settling, the ` +
      `output should equal amount·input + offset = ${expected.toFixed(3)} ` +
      `(amount=${amount}, offset=${offset}). Pass if within 5% relative error.`,
    declared: { expected: expected.toFixed(4), tolerance: tol2.toExponential(2) },
    measured: { settled_value: measured.toFixed(4), abs_error: err.toExponential(3) },
    plot: {
      kind: 'sampleTrace',
      title: 'Steady-state output (2 s)',
      xLabel: 'Time (ms)', yLabel: 'Output',
      series: [
        { name: 'output', color: '#7fff8f', points: ssTrace },
      ],
      markers: [
        { x: 0, label: `expected ${expected.toFixed(2)}`, color: '#5ed184' },
      ],
    },
    diagnostic: passSS ? null
      : `Settled to ${measured.toFixed(4)}, expected ${expected.toFixed(4)} (err ${err.toExponential(3)}).`,
  });

  const passCount = tests.filter(t => t.pass).length;
  return {
    summary: { total: tests.length, passed: passCount, failed: tests.length - passCount,
               verdict: passCount === tests.length ? 'PASS' : 'FAIL' },
    tests,
  };
}

// ── GAINCURVE: gainComputer threshold/ratio/knee fit ────────────────────
async function runGainCurveMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const inDbLevels = [];
  for (let db = -60; db <= 0; db += 3) inDbLevels.push(db);
  const samples = [];
  const HOLD_S = 0.3;
  const N = Math.round(HOLD_S * SR);
  for (const inDb of inDbLevels) {
    const lin = dbToLinear(inDb);
    const stim = new Float32Array(N).fill(lin);
    const r = await runWorkletBrowser(opId, params, { env: stim }, { sampleRate: SR });
    const out = r.outputs.gr || r.outputs[Object.keys(r.outputs)[0]];
    let sum = 0;
    const tail = Math.floor(out.length * 0.8);
    for (let i = tail; i < out.length; i++) sum += out[i];
    const grMean = sum / Math.max(1, out.length - tail);
    const effGainLin = 1 + grMean;
    const effGainDb = effGainLin > 0 ? linearToDb(effGainLin) : -120;
    const outDb = inDb + effGainDb;
    samples.push({ inDb, outDb, gr: grMean });
  }
  const fit = fitCompressorCurve(samples);
  const declaredThr = declared.thresholdDb ?? params.thresholdDb ?? -18;
  const declaredRatio = declared.ratio ?? params.ratio ?? 4;
  const thrErr = fit.thresholdDb != null ? Math.abs(fit.thresholdDb - declaredThr) : 999;
  const ratioErr = fit.ratio != null ? Math.abs(fit.ratio - declaredRatio) / declaredRatio : 999;
  const slopeBelowOK = fit.slopeBelow != null && Math.abs(fit.slopeBelow - 1.0) < 0.15;
  const thrOk = thrErr <= 2;
  const ratioOk = ratioErr <= 0.15;
  const pass = thrOk && ratioOk && slopeBelowOK;

  // Build "ideal curve" for visual comparison.
  const idealPts = [];
  const measuredPts = [];
  for (const s of samples) {
    measuredPts.push([s.inDb, s.outDb]);
    const overshoot = s.inDb - declaredThr;
    const idealOut = overshoot <= 0 ? s.inDb : declaredThr + overshoot / declaredRatio;
    idealPts.push([s.inDb, idealOut]);
  }

  return {
    summary: { total: 1, passed: pass ? 1 : 0, failed: pass ? 0 : 1, verdict: pass ? 'PASS' : 'FAIL' },
    tests: [{
      name: 'Static GR curve',
      pass,
      explanation:
        `Sweep input magnitudes from -60 to 0 dBFS in 3 dB steps. Convert ` +
        `the gainComputer's output (gr) into a "post-compressor level" curve ` +
        `(out_dB = in_dB + 20·log10(1+gr)). Fit threshold and ratio from the ` +
        `slopes of that curve. Pass if threshold within ±2 dB of declared ` +
        `${declaredThr}, ratio within ±15% of ${declaredRatio}, and ` +
        `sub-threshold slope is 1:1 (within 0.15 of unity).`,
      declared: { thresholdDb: declaredThr, ratio: declaredRatio,
                  tolerances: { threshold_db: 2, ratio_pct: 15, slope_below: 0.15 } },
      measured: {
        threshold_db: fit.thresholdDb?.toFixed(1),
        ratio: fit.ratio?.toFixed(2),
        slope_below: fit.slopeBelow?.toFixed(3),
        slope_above: fit.slopeAbove?.toFixed(3),
      },
      plot: {
        kind: 'curveDeclMeas',
        title: 'Static gain-reduction curve',
        xLabel: 'Input (dBFS)', yLabel: 'Output (dBFS, post-comp)',
        series: [
          { name: '1:1 reference', color: 'rgba(255,255,255,0.2)',
            points: [[-60, -60], [0, 0]] },
          { name: 'declared',  color: '#5ed184', points: idealPts },
          { name: 'measured',  color: '#d99fcf', points: measuredPts },
        ],
        markers: [
          { x: declaredThr, label: `threshold ${declaredThr} dB`, color: '#5ed184' },
        ],
      },
      diagnostic: pass ? null
        : `Threshold ${fit.thresholdDb?.toFixed(1)} dB (declared ${declaredThr}, err ${thrErr.toFixed(1)}), ` +
          `ratio ${fit.ratio?.toFixed(2)} (declared ${declaredRatio}, err ${(ratioErr*100).toFixed(1)}%), ` +
          `slope-below ${fit.slopeBelow?.toFixed(3)} (should be ~1.0).`,
    }],
  };
}

// ── FILTER: magnitude response sweep ────────────────────────────────────
// For LP/HP: find -3 dB cutoff, compare to declared cutoff_hz.
// For allpass: verify magnitude is flat (~0 dB) across the audible band.
// For shelf/tilt: report shape (no strict pass/fail, descriptive).
async function runFilterMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const kind = declared.kind || 'lp';
  const declaredCutoff = declared.cutoff_hz;

  // Log-spaced frequencies, 20 Hz to 20 kHz.
  const NPOINTS = 40;
  const freqs = [];
  for (let i = 0; i < NPOINTS; i++) {
    const f = 20 * Math.pow(20000 / 20, i / (NPOINTS - 1));
    freqs.push(f);
  }

  // Match the headless metric exactly (filter.mjs):
  //   - stim amplitude 0.25 (-12 dBFS, stays linear under resonance for biquads,
  //     and avoids over-driving nonlinear filters like diodeLadder/ladder)
  //   - 0.3 s tones, settle 50 ms
  // This is essential for nonlinear filters where cutoff varies with input level.
  const STIM_AMP = 0.25;
  const TONE_LEN_SEC = 0.3;
  const SETTLE_SEC = 0.05;
  const N = Math.round(TONE_LEN_SEC * SR);
  const settledStart = Math.round(SETTLE_SEC * SR);

  const inputPort = declared.inputPort || 'in';
  const magsDb = [];

  for (const f of freqs) {
    const w = 2 * Math.PI * f / SR;
    const stim = new Float32Array(N);
    for (let i = 0; i < N; i++) stim[i] = STIM_AMP * Math.sin(w * i);
    const r = await runWorkletBrowser(opId, params, { [inputPort]: stim }, { sampleRate: SR });
    const out = r.outputs[Object.keys(r.outputs)[0]];
    const inRms = rms(stim, settledStart, N);
    const outRms = rms(out, settledStart, N);
    const magDb = 20 * Math.log10((outRms || 1e-12) / (inRms || 1e-12));
    magsDb.push(magDb);
  }

  // Plot magnitude response.
  const points = freqs.map((f, i) => [f, magsDb[i]]);

  let pass, measured = {}, explanation, diagnostic = null;
  let markers = [];

  if (kind === 'lp' || kind === 'hp' || kind === 'shelf') {
    // Headless-aligned approach (matches metrics/filter.mjs): reference =
    // PEAK of the sweep, walk from peak to first bin below −3 dB, with
    // log-frequency interpolation between adjacent bins for accuracy.
    // This is independent of the declared cutoff (no chicken-and-egg loop)
    // and handles resonant filters correctly.
    let peakBin = 0;
    for (let i = 1; i < magsDb.length; i++) if (magsDb[i] > magsDb[peakBin]) peakBin = i;
    const peakDb = magsDb[peakBin];
    // Re-zero magsDb relative to peak so target is exactly -3 dB.
    const magsDbRel = magsDb.map(m => m - peakDb);

    let measuredCutoff = null;
    if (kind === 'lp' || kind === 'shelf') {
      for (let i = peakBin; i < magsDbRel.length; i++) {
        if (magsDbRel[i] < -3) {
          if (i > 0 && magsDbRel[i - 1] >= -3) {
            const f1 = freqs[i - 1], f2 = freqs[i];
            const m1 = magsDbRel[i - 1], m2 = magsDbRel[i];
            const frac = (-3 - m1) / (m2 - m1);
            measuredCutoff = Math.exp(Math.log(f1) + frac * (Math.log(f2) - Math.log(f1)));
          } else {
            measuredCutoff = freqs[i];
          }
          break;
        }
      }
    } else {     // hp
      for (let i = peakBin; i >= 0; i--) {
        if (magsDbRel[i] < -3) {
          if (i < magsDbRel.length - 1 && magsDbRel[i + 1] >= -3) {
            const f1 = freqs[i], f2 = freqs[i + 1];
            const m1 = magsDbRel[i], m2 = magsDbRel[i + 1];
            const frac = (-3 - m1) / (m2 - m1);
            measuredCutoff = Math.exp(Math.log(f1) + frac * (Math.log(f2) - Math.log(f1)));
          } else {
            measuredCutoff = freqs[i];
          }
          break;
        }
      }
    }
    const tolPct = declared.cutoff_tol_pct ?? 25;
    pass = measuredCutoff != null && declaredCutoff != null
      && Math.abs(measuredCutoff - declaredCutoff) / declaredCutoff <= tolPct / 100;
    measured = {
      cutoff_hz: measuredCutoff?.toFixed(0),
      peak_db: peakDb.toFixed(2),
      peak_freq_hz: freqs[peakBin].toFixed(0),
    };
    explanation =
      `Sweep 40 logarithmically-spaced sine tones from 20 Hz to 20 kHz. ` +
      `Measure output RMS / input RMS at each frequency. Find the SWEEP PEAK ` +
      `as 0 dB reference (handles resonant Q peaking correctly), then walk ` +
      `from peak to find the first frequency 3 dB below — that's the cutoff. ` +
      `Pass if within ±${tolPct}% of declared ${declaredCutoff} Hz.`;
    if (declaredCutoff) markers.push({ x: declaredCutoff, label: `declared ${declaredCutoff} Hz`, color: '#5ed184' });
    if (measuredCutoff) markers.push({ x: measuredCutoff, label: `measured ${measuredCutoff.toFixed(0)} Hz`, color: '#d99fcf' });
    if (!pass) diagnostic = `Measured cutoff ${measuredCutoff?.toFixed(0)} Hz vs declared ${declaredCutoff} Hz (tol ±${tolPct}%).`;
  } else if (kind === 'allpass') {
    // Magnitude should be flat (~0 dB) across the band.
    const tol = declared.allpass_flat_tol_db ?? 1.0;
    let worstDeviation = 0;
    for (const m of magsDb) if (Math.abs(m) > worstDeviation) worstDeviation = Math.abs(m);
    pass = worstDeviation <= tol;
    measured = { worst_deviation_db: worstDeviation.toFixed(3) };
    explanation =
      `An allpass filter must have flat magnitude response across all frequencies ` +
      `(its job is phase, not amplitude). Sweep tones from 20 Hz to 20 kHz, ` +
      `measure magnitude. Pass if worst-case deviation from 0 dB is within ±${tol} dB.`;
    if (!pass) diagnostic = `Worst magnitude deviation ${worstDeviation.toFixed(2)} dB exceeds ${tol} dB tolerance.`;
  } else {
    // shelf / tilt / other: descriptive — no strict pass/fail.
    pass = true;
    measured = {
      lf_db: magsDb[0]?.toFixed(2),
      mid_db: magsDb[Math.floor(magsDb.length / 2)]?.toFixed(2),
      hf_db: magsDb[magsDb.length - 1]?.toFixed(2),
    };
    explanation =
      `Shape characterization. Magnitude response measured at log-spaced ` +
      `frequencies; LF/mid/HF dB levels reported but no strict pass/fail ` +
      `(needs op-specific shape spec).`;
  }

  return {
    summary: { total: 1, passed: pass ? 1 : 0, failed: pass ? 0 : 1, verdict: pass ? 'PASS' : 'FAIL' },
    tests: [{
      name: `Magnitude response (${kind})`,
      pass, explanation,
      declared: { kind, cutoff_hz: declaredCutoff },
      measured,
      plot: {
        kind: 'frequencyResponse',
        title: 'Magnitude response',
        xLabel: 'Freq (Hz)', yLabel: 'Magnitude (dB)',
        series: [
          { name: '0 dB ref', color: 'rgba(255,255,255,0.18)',
            points: freqs.map(f => [f, 0]) },
          { name: '-3 dB',    color: 'rgba(255,255,255,0.18)',
            points: freqs.map(f => [f, -3]) },
          { name: 'measured', color: '#d99fcf', points },
        ],
        markers,
        logX: true,
      },
      diagnostic,
    }],
  };
}

// ── DISTORTION: THD-vs-level + harmonic signature + DC creep ───────────
// AES17-style: drive 997 Hz sine at multiple levels, measure THD via FFT
// harmonic-sum, classify even/odd dominance, watch for DC creep.
async function runDistortionMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const levels = declared.input_levels_dbfs || [-40, -20, -6, 0];
  const TONE = 997;       // AES17 non-harmonic test tone
  const HOLD_S = 0.2;
  const N = Math.round(HOLD_S * SR);
  const settledStart = Math.floor(N * 0.4);   // skip transient

  const inputPort = declared.inputPort || 'in';
  const thdRows = [];
  const dcRows = [];
  let spectrum0dB = null;
  let evenSum = 0, oddSum = 0;

  for (const dB of levels) {
    const lin = dbToLinear(dB);
    const w = 2 * Math.PI * TONE / SR;
    const stim = new Float32Array(N);
    for (let i = 0; i < N; i++) stim[i] = lin * Math.sin(w * i);
    const r = await runWorkletBrowser(opId, params, { [inputPort]: stim }, { sampleRate: SR });
    const out = r.outputs[Object.keys(r.outputs)[0]];
    // Slice settled portion for measurement.
    const settled = out.subarray(settledStart, N);
    const result = thdSingleTone(settled, SR, TONE, 10);
    const thdPct = (result.thd || 0) * 100;
    thdRows.push({ inDb: dB, thdPct, harmonics: result.harmonicLevels || [] });
    // DC: mean of output.
    let s = 0;
    for (let i = settledStart; i < N; i++) s += out[i];
    const dcLin = s / (N - settledStart);
    const dcDb = dcLin === 0 ? -Infinity : 20 * Math.log10(Math.abs(dcLin));
    dcRows.push({ inDb: dB, dcDb, dcLin });
    // For 0 dBFS: tally even vs odd, capture spectrum for plot.
    if (dB === 0 || (dB === levels[levels.length - 1])) {
      const harms = result.harmonicLevels || [];
      // harmonicLevels[0] = 2nd harmonic, [1] = 3rd, etc. — index = order-2.
      for (let i = 0; i < harms.length; i++) {
        const order = i + 2;
        if (order % 2 === 0) evenSum += harms[i] * harms[i];
        else oddSum += harms[i] * harms[i];
      }
      // Quick spectrum for plot: take FFT of settled[0..2048].
      const M = 2048;
      const samp = settled.subarray(0, Math.min(M, settled.length));
      const spec = magnitudeSpectrum(samp);
      spectrum0dB = spec;
    }
  }

  // Pass criteria.
  const tests = [];
  const isQuant = !!declared.quantization_op;
  // 1. Low-level linearity (skip for quantization ops since their noise floor is fixed by bits).
  if (!isQuant && declared.low_level_thd_pct_max != null) {
    const lowest = thdRows[0];
    const pass = lowest.thdPct <= declared.low_level_thd_pct_max;
    tests.push({
      name: `Low-level linearity (THD @ ${levels[0]} dBFS)`,
      pass,
      explanation:
        `At low input (${levels[0]} dBFS), the op should pass the signal through ` +
        `cleanly (THD% should stay below ${declared.low_level_thd_pct_max}%). ` +
        `Drive a ${TONE} Hz sine tone, measure THD via FFT harmonic-sum.`,
      declared: { input_dbfs: levels[0], thd_pct_max: declared.low_level_thd_pct_max },
      measured: { thd_pct: lowest.thdPct.toFixed(3) },
      diagnostic: pass ? null : `THD ${lowest.thdPct.toFixed(2)}% exceeds ${declared.low_level_thd_pct_max}%.`,
    });
  }
  // 2. Peak distortion presence.
  // We check PEAK THD across the level sweep rather than THD at the top
  // level, because some ops (especially quantizers like bitcrush) have a
  // U-shaped THD curve that peaks at mid-levels and drops at full-scale
  // when the sine sits exactly on rail values. For monotonic saturators
  // (tanh, diode, etc.) the peak is naturally at the top so this is also
  // correct for them.
  if (declared.high_level_thd_pct_min != null) {
    const peak = thdRows.reduce((a, b) => a.thdPct >= b.thdPct ? a : b, thdRows[0]);
    const pass = peak.thdPct >= declared.high_level_thd_pct_min;
    tests.push({
      name: `Peak distortion (THD across sweep)`,
      pass,
      explanation:
        `Across input levels ${levels.join(' / ')} dBFS, the op MUST hit at ` +
        `least ${declared.high_level_thd_pct_min}% THD somewhere. If it never ` +
        `does, the nonlinearity isn't engaging. We check PEAK across the sweep ` +
        `(not just the highest input) because some ops — quantizers especially — ` +
        `have a U-shaped THD curve.`,
      declared: { peak_thd_pct_min: declared.high_level_thd_pct_min, sweep_levels: levels },
      measured: {
        peak_thd_pct: peak.thdPct.toFixed(3),
        peak_at_dbfs: peak.inDb,
      },
      diagnostic: pass ? null : `Peak THD ${peak.thdPct.toFixed(2)}% (at ${peak.inDb} dBFS) below ${declared.high_level_thd_pct_min}%.`,
    });
  }
  // 3. Harmonic signature (odd / even / both).
  if (declared.harmonic_signature) {
    const totalHarm = evenSum + oddSum;
    const oddDom = oddSum > evenSum;
    const evenDom = evenSum > oddSum;
    let pass = true;
    if (declared.harmonic_signature === 'odd')  pass = oddDom;
    if (declared.harmonic_signature === 'even') pass = evenDom;
    tests.push({
      name: `Harmonic signature (${declared.harmonic_signature}-dominant)`,
      pass,
      explanation:
        `The harmonic content should be ${declared.harmonic_signature}-dominant ` +
        `(e.g. tanh/symmetric saturation = odd, asymmetric tube = even). ` +
        `Measured ratio of even-power vs odd-power energy in harmonics 2-10.`,
      declared: { signature: declared.harmonic_signature },
      measured: {
        even_power: evenSum.toExponential(3),
        odd_power: oddSum.toExponential(3),
        dominant: evenDom ? 'even' : oddDom ? 'odd' : 'tied',
      },
      diagnostic: pass ? null
        : `Expected ${declared.harmonic_signature}-dominant; got ${evenDom ? 'even' : oddDom ? 'odd' : 'tied'}.`,
    });
  }
  // 4. DC creep.
  if (declared.dc_creep_max_dbfs != null) {
    const worstDc = dcRows.reduce((acc, r) => Math.max(acc, isFinite(r.dcDb) ? r.dcDb : -200), -Infinity);
    const pass = worstDc <= declared.dc_creep_max_dbfs;
    tests.push({
      name: 'DC creep',
      pass,
      explanation:
        `Asymmetric distortion creates DC offset that builds up over time. ` +
        `Measure mean of output across input levels; pass if worst-case DC ` +
        `stays below ${declared.dc_creep_max_dbfs} dBFS.`,
      declared: { max_dc_dbfs: declared.dc_creep_max_dbfs },
      measured: { worst_dc_dbfs: worstDc.toFixed(1) },
      diagnostic: pass ? null
        : `Worst DC ${worstDc.toFixed(1)} dBFS exceeds limit ${declared.dc_creep_max_dbfs} dBFS.`,
    });
  }

  // Plot 1: THD% vs input level.
  const thdPlot = {
    kind: 'thdVsLevel',
    title: 'THD% vs input level',
    xLabel: 'Input level (dBFS)', yLabel: 'THD %',
    series: [
      { name: 'measured', color: '#d99fcf',
        points: thdRows.map(r => [r.inDb, r.thdPct]) },
    ],
    markers: [
      ...(declared.low_level_thd_pct_max != null
        ? [{ x: levels[0], label: `≤ ${declared.low_level_thd_pct_max}%`, color: '#5ed184' }]
        : []),
      ...(declared.high_level_thd_pct_min != null
        ? [{ x: levels[levels.length-1], label: `≥ ${declared.high_level_thd_pct_min}%`, color: '#5ed184' }]
        : []),
    ],
  };

  // Plot 2: spectrum at hottest level.
  let specPlot = null;
  if (spectrum0dB && spectrum0dB.mag) {
    const { mag, N: fftN } = spectrum0dB;
    const points = [];
    for (let i = 1; i < mag.length; i++) {     // skip DC bin
      const f = i * SR / fftN;
      if (f < 50 || f > 20000) continue;
      points.push([f, 20 * Math.log10(mag[i] / (fftN / 2) || 1e-12)]);
    }
    specPlot = {
      kind: 'spectrum',
      title: `Spectrum at ${levels[levels.length-1]} dBFS (input ${TONE} Hz sine)`,
      xLabel: 'Freq (Hz)', yLabel: 'Magnitude (dB)',
      series: [{ name: 'output', color: '#d99fcf', points }],
      logX: true,
    };
  }

  // Attach plots to first test.
  if (tests.length > 0) {
    tests[0].plot = thdPlot;
    if (tests.length > 1 && specPlot) tests[1].plot = specPlot;
  }

  // ── Parameter sweep test (optional) ─────────────────────────────────
  // declared.param_sweep = { param: 'bits', values: [12,10,8,6,4],
  //                          test_level_dbfs: 0, monotonic_increasing_thd: bool }
  if (declared.param_sweep) {
    const sw = declared.param_sweep;
    const swLevel = sw.test_level_dbfs ?? 0;
    const lin = dbToLinear(swLevel);
    const wTone = 2 * Math.PI * TONE / SR;
    const sweepRows = [];
    for (const v of sw.values) {
      const stim = new Float32Array(N);
      for (let i = 0; i < N; i++) stim[i] = lin * Math.sin(wTone * i);
      const r = await runWorkletBrowser(opId, { ...params, [sw.param]: v },
                                       { [inputPort]: stim }, { sampleRate: SR });
      const out = r.outputs[Object.keys(r.outputs)[0]];
      const settled = out.subarray(settledStart, N);
      const result = thdSingleTone(settled, SR, TONE, 10);
      const thdPct = (result.thd || 0) * 100;
      sweepRows.push({ v, thdPct });
    }
    let pass = true, diag = null;
    if (sw.monotonic_increasing_thd) {
      // For bitcrush: more bits → cleaner. So as values DECREASE, THD INCREASES.
      // We assume sw.values is ordered cleanest→noisiest (e.g. 12,10,8,6,4) so
      // THD should monotonically increase along that order.
      for (let i = 1; i < sweepRows.length; i++) {
        if (sweepRows[i].thdPct + 0.001 < sweepRows[i - 1].thdPct) {
          pass = false;
          diag = `Non-monotonic THD: ${sw.param}=${sweepRows[i-1].v} → ${sweepRows[i-1].thdPct.toFixed(2)}%, ` +
                 `${sw.param}=${sweepRows[i].v} → ${sweepRows[i].thdPct.toFixed(2)}% (should keep increasing).`;
          break;
        }
      }
    }
    tests.push({
      name: `Parameter sweep — ${sw.param}`,
      pass,
      explanation:
        `Run the same THD test at multiple ${sw.param} values (${sw.values.join(', ')}) ` +
        `at ${swLevel} dBFS input. ${sw.monotonic_increasing_thd ? 'Pass if THD trends monotonically along that order.' : 'Reports trend; no strict pass/fail.'}`,
      declared: { param: sw.param, values: sw.values, test_level_dbfs: swLevel },
      measured: { thd_pct_per_value: sweepRows.map(r => `${sw.param}=${r.v}: ${r.thdPct.toFixed(2)}%`).join(' · ') },
      plot: {
        kind: 'paramSweep',
        title: `THD% vs ${sw.param}`,
        xLabel: sw.param, yLabel: 'THD %',
        series: [{
          name: 'measured',
          color: '#d99fcf',
          points: sweepRows.map(r => [r.v, r.thdPct]),
        }],
      },
      diagnostic: diag,
    });
  }

  const passCount = tests.filter(t => t.pass).length;
  return {
    summary: {
      total: tests.length, passed: passCount, failed: tests.length - passCount,
      verdict: tests.length === 0 ? 'SKIP' : passCount === tests.length ? 'PASS' : 'FAIL',
    },
    tests,
  };
}

// ── COMPRESSOR (Cluster A GR cells) ─────────────────────────────────────
// Memoryless GR cells take an audio input + CV input; output = audio · gain(cv).
// Sweep the CV at declared values, drive a steady tone, measure gain.
// Verify: unity at cv=0, expected GR at declared cv_for_6db_gr, max GR roughly
// matches gr_at_max_cv_db, plus optional THD-grows-with-GR check.
async function runCompressorMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const cvSweep = declared.cv_sweep_linear || [0, -3, -6, -12, -24];
  const audioDbfs = declared.audio_test_dbfs ?? -12;
  const audioLin = dbToLinear(audioDbfs);
  const TONE = 997;
  const HOLD_S = 0.2;
  const N = Math.round(HOLD_S * SR);
  const settledStart = Math.floor(N * 0.4);

  // Build audio stim once.
  const w = 2 * Math.PI * TONE / SR;
  const audioStim = new Float32Array(N);
  for (let i = 0; i < N; i++) audioStim[i] = audioLin * Math.sin(w * i);
  const inRms = rms(audioStim, settledStart, N);

  const audioPort = declared.audioPort || 'audio';
  const cvPort = declared.cvPort || 'cv';

  const rows = [];
  let thdAtZero = null, thdAtMaxGR = null;
  for (const cvDb of cvSweep) {
    // Build CV stim. blackmerVCA convention: cv = dB of gain adjustment;
    // sibling ops use positive cv = compression depth. Either way the CV
    // port is fed cvDb (interpreted by the op).
    const cvStim = new Float32Array(N).fill(cvDb);
    const r = await runWorkletBrowser(opId, params,
      { [audioPort]: audioStim, [cvPort]: cvStim }, { sampleRate: SR });
    const out = r.outputs[Object.keys(r.outputs)[0]];
    const outRms = rms(out, settledStart, N);
    const gainLin = inRms > 0 ? outRms / inRms : 0;
    const gainDb = gainLin > 0 ? 20 * Math.log10(gainLin) : -120;
    // THD measurement at extremes for thd_grows_with_gr check.
    const thdResult = thdSingleTone(out.subarray(settledStart, N), SR, TONE, 10);
    const thdPct = (thdResult.thd || 0) * 100;
    if (cvDb === 0) thdAtZero = thdPct;
    if (cvDb === cvSweep[cvSweep.length - 1]) thdAtMaxGR = thdPct;
    rows.push({ cvDb, gainLin, gainDb, thdPct });
  }

  const tests = [];

  // 1. Unity at cv=0.
  if (declared.unity_gain_at_zero_cv != null) {
    const z = rows.find(r => r.cvDb === 0);
    const expected = declared.unity_gain_at_zero_cv;
    const tol = 0.5;       // ±0.5 dB of unity
    const measuredDb = z?.gainDb ?? -999;
    const expectedDb = 20 * Math.log10(expected);
    const pass = Math.abs(measuredDb - expectedDb) <= tol;
    tests.push({
      name: 'Unity gain at cv=0',
      pass,
      explanation:
        `When the CV input is zero (no compression), the cell should pass audio ` +
        `through at unity (0 dB). Drive ${audioDbfs} dBFS sine + cv=0; check output gain.`,
      declared: { expected_gain: expected, expected_db: expectedDb.toFixed(2), tolerance_db: tol },
      measured: { gain_db: measuredDb.toFixed(2) },
      diagnostic: pass ? null
        : `Gain at cv=0 was ${measuredDb.toFixed(2)} dB, expected ${expectedDb.toFixed(2)} dB.`,
    });
  }

  // 2. ~6 dB GR at declared cv_for_6db_gr.
  if (declared.cv_for_6db_gr != null) {
    const cv6 = declared.cv_for_6db_gr;
    const r6 = rows.find(r => r.cvDb === cv6);
    const measuredGrDb = r6 ? Math.abs(r6.gainDb) : null;
    const tol = 1.5;
    const pass = measuredGrDb != null && Math.abs(measuredGrDb - 6) <= tol;
    tests.push({
      name: `6 dB GR at cv=${cv6}`,
      pass,
      explanation:
        `The op declares ${cv6} as the CV value where it produces 6 dB of gain ` +
        `reduction. Drive that CV + audio tone; check measured GR is within ±${tol} dB of 6.`,
      declared: { cv: cv6, expected_gr_db: 6, tolerance_db: tol },
      measured: { gr_db: measuredGrDb?.toFixed(2) },
      diagnostic: pass ? null
        : `Measured GR ${measuredGrDb?.toFixed(2)} dB at cv=${cv6}, expected 6 dB ± ${tol}.`,
    });
  }

  // 3. Max GR achievable.
  if (declared.gr_at_max_cv_db != null) {
    const last = rows[rows.length - 1];
    const measuredMax = Math.abs(last.gainDb);
    const expected = declared.gr_at_max_cv_db;
    const tol = 4;     // wider — extreme CV is where worklet quirks hide
    const pass = Math.abs(measuredMax - expected) <= tol;
    tests.push({
      name: `Max GR at cv=${last.cvDb}`,
      pass,
      explanation:
        `At the extreme CV (${last.cvDb}), the op should reach roughly ` +
        `${expected} dB of gain reduction. ±${tol} dB tolerance.`,
      declared: { cv: last.cvDb, expected_gr_db: expected, tolerance_db: tol },
      measured: { gr_db: measuredMax.toFixed(2) },
      diagnostic: pass ? null
        : `Measured max GR ${measuredMax.toFixed(2)} dB, expected ${expected} dB ± ${tol}.`,
    });
  }

  // 4. THD-grows-with-GR check (Cluster A "character" cells).
  if (declared.thd_grows_with_gr === true) {
    const pass = thdAtMaxGR != null && thdAtZero != null && thdAtMaxGR > thdAtZero;
    tests.push({
      name: 'THD grows with GR (character cell)',
      pass,
      explanation:
        `Cluster A character cells (varMuTube, etc.) are designed so harmonic ` +
        `content increases with compression depth. Pass if THD at max GR > THD at cv=0.`,
      declared: { signature: 'thd_increases_with_gr' },
      measured: { thd_at_zero_pct: thdAtZero?.toFixed(3), thd_at_max_gr_pct: thdAtMaxGR?.toFixed(3) },
      diagnostic: pass ? null
        : `THD at zero ${thdAtZero?.toFixed(2)}%, at max GR ${thdAtMaxGR?.toFixed(2)}% — should grow.`,
    });
  } else if (declared.thd_grows_with_gr === false) {
    // For "clean" cells (blackmerVCA bias=0), THD should stay LOW even at max GR.
    const pass = thdAtMaxGR != null && thdAtMaxGR < 1.0;
    tests.push({
      name: 'Clean GR (THD stays low)',
      pass,
      explanation:
        `This cell is declared CLEAN (THD does not grow with GR). At max GR, ` +
        `total harmonic distortion should stay below 1%.`,
      declared: { thd_at_max_gr_pct_max: 1.0 },
      measured: { thd_at_max_gr_pct: thdAtMaxGR?.toFixed(3) },
      diagnostic: pass ? null
        : `THD at max GR ${thdAtMaxGR?.toFixed(2)}% exceeds 1% — cell isn't clean.`,
    });
  }

  // Plot CV → gain curve.
  if (tests.length > 0) {
    tests[0].plot = {
      kind: 'cvGainCurve',
      title: 'CV → Gain (dB)',
      xLabel: 'CV (dB)', yLabel: 'Output gain (dB)',
      series: [{
        name: 'measured', color: '#d99fcf',
        points: rows.map(r => [r.cvDb, r.gainDb]),
      }, {
        name: '0 dB',  color: 'rgba(255,255,255,0.18)',
        points: [[cvSweep[0], 0], [cvSweep[cvSweep.length-1], 0]],
      }],
      markers: [
        ...(declared.cv_for_6db_gr != null
          ? [{ x: declared.cv_for_6db_gr, label: `cv=${declared.cv_for_6db_gr} → −6 dB`, color: '#5ed184' }]
          : []),
      ],
    };
  }

  const passCount = tests.filter(t => t.pass).length;
  return {
    summary: {
      total: tests.length, passed: passCount, failed: tests.length - passCount,
      verdict: tests.length === 0 ? 'SKIP' : passCount === tests.length ? 'PASS' : 'FAIL',
    },
    tests,
  };
}

// ── ANALYZER (CV-curve generators like optoCell) ────────────────────────
// Sweeps CV input, captures gain output coefficient, verifies declared
// curve direction + output range. Pure control-rate — no audio path.
async function runAnalyzerMetric(opId, spec) {
  const params = spec.defaultParams || {};
  const declared = spec.declared || {};
  const cvSweep = declared.cv_sweep_linear || [0, 0.5, 1, 2, 4, 8];
  const expectedDir = declared.curve_direction || 'decreasing';
  const outRange = declared.output_range || [0, 1.05];
  const HOLD_S = 0.1;
  const N = Math.round(HOLD_S * SR);
  const settledStart = Math.floor(N * 0.7);

  const inputPort = declared.cvPort || 'cv';
  const samples = [];

  for (const cv of cvSweep) {
    const stim = new Float32Array(N).fill(cv);
    const r = await runWorkletBrowser(opId, params, { [inputPort]: stim }, { sampleRate: SR });
    const out = r.outputs[Object.keys(r.outputs)[0]];
    let sum = 0;
    for (let i = settledStart; i < N; i++) sum += out[i];
    const meanGain = sum / Math.max(1, N - settledStart);
    samples.push({ cv, gain: meanGain });
  }

  // Direction check.
  let monotonic = true;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].gain, cur = samples[i].gain;
    if (expectedDir === 'decreasing' && cur > prev + 0.001) { monotonic = false; break; }
    if (expectedDir === 'increasing' && cur < prev - 0.001) { monotonic = false; break; }
  }
  // Range check.
  const minG = Math.min(...samples.map(s => s.gain));
  const maxG = Math.max(...samples.map(s => s.gain));
  const inRange = minG >= outRange[0] - 0.001 && maxG <= outRange[1] + 0.001;
  const pass = monotonic && inRange;

  return {
    summary: { total: 1, passed: pass ? 1 : 0, failed: pass ? 0 : 1, verdict: pass ? 'PASS' : 'FAIL' },
    tests: [{
      name: 'CV → gain curve',
      pass,
      explanation:
        `Sweep ${cvSweep.length} CV values from ${cvSweep[0]} to ${cvSweep[cvSweep.length-1]}, ` +
        `capture the output gain coefficient at each step. Pass if curve is ` +
        `${expectedDir} (CV up = gain ${expectedDir === 'decreasing' ? 'down' : 'up'}) ` +
        `and gain stays in declared range [${outRange[0]}, ${outRange[1]}].`,
      declared: {
        cv_sweep: cvSweep,
        curve_direction: expectedDir,
        output_range: outRange,
      },
      measured: {
        gain_curve: samples.map(s => `cv=${s.cv}: gain=${s.gain.toFixed(3)}`).join(' · '),
        monotonic: monotonic ? 'yes' : 'NO — direction violation',
        in_range: inRange ? 'yes' : `NO — measured min=${minG.toFixed(3)} max=${maxG.toFixed(3)}`,
      },
      plot: {
        kind: 'cvGainCurve',
        title: 'CV → Gain coefficient',
        xLabel: 'CV (linear)', yLabel: 'Gain (linear)',
        series: [{
          name: 'measured',
          color: '#d99fcf',
          points: samples.map(s => [s.cv, s.gain]),
        }, {
          name: 'unity',
          color: 'rgba(255,255,255,0.18)',
          points: [[cvSweep[0], 1], [cvSweep[cvSweep.length - 1], 1]],
        }],
      },
      diagnostic: pass ? null
        : `Direction: ${monotonic ? 'OK' : 'FAIL'}, range: ${inRange ? 'OK' : 'FAIL'} (min ${minG.toFixed(3)}, max ${maxG.toFixed(3)}).`,
    }],
  };
}

// Registry: spec.category → runner.
const BROWSER_METRIC_REGISTRY = {
  utility:    runUtilityMetric,
  envelope:   runEnvelopeMetric,
  gainCurve:  runGainCurveMetric,
  filter:     runFilterMetric,
  eq:         runFilterMetric,
  distortion: runDistortionMetric,
  compressor: runCompressorMetric,
  analyzer:   runAnalyzerMetric,
};

/**
 * Top-level entry: run the appropriate browser metric for a given op + spec.
 * Returns the unified shape (summary + tests with plot data).
 */
export async function runBrowserMetric(opId, spec) {
  const fn = BROWSER_METRIC_REGISTRY[spec.category];
  if (!fn) {
    return {
      summary: { total: 0, passed: 0, failed: 0, verdict: 'SKIP' },
      tests: [{
        name: 'Browser metric',
        pass: false,
        explanation: `No browser metric runner is wired for category '${spec.category}'. ` +
                     `Use the headless harness (\`scripts/check_behavioral.mjs\`) ` +
                     `for now; we'll add browser support next.`,
        declared: spec.declared || {}, measured: {},
        diagnostic: `category '${spec.category}' not in BROWSER_METRIC_REGISTRY`,
      }],
    };
  }
  return fn(opId, spec);
}

export function listBrowserMetricCategories() {
  return Object.keys(BROWSER_METRIC_REGISTRY);
}
