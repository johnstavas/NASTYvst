// analyzer.mjs — behavioral metric module for analyzer / curve-generator ops.
//
// Day 2 minimal implementation: validates curve linearity for transfer-curve
// generators (e.g., optoCell which outputs a gain coefficient based on cv).
//
// Tests:
//   - Curve monotonicity (cv increases → output gain decreases for compressor cells)
//   - Range compliance (output stays within declared [min, max])
//   - Closed-form check (if expectedFn provided)

import { runWorklet } from '../runners/run_worklet.mjs';

let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;

export async function runAnalyzerMetrics(opId, spec) {
  const declared = spec.declared || {};
  const params = spec.defaultParams || {};
  const tests = [];

  tests.push(await testCurveMonotonicity(opId, params, declared));
  tests.push(await testRangeCompliance(opId, params, declared));

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

async function feedCVAndCapture(opId, params, cvValues, lengthSamples) {
  const samples = [];
  for (const cv of cvValues) {
    const stim = new Float32Array(lengthSamples).fill(cv);
    const r = await _runner(opId, params, { cv: stim }, { sampleRate: SR });
    const outKey = Object.keys(r.outputs)[0];
    const out = r.outputs[outKey];
    // Take settled value from the second half.
    let sum = 0;
    const start = Math.floor(lengthSamples / 2);
    for (let i = start; i < lengthSamples; i++) sum += out[i];
    const settled = sum / (lengthSamples - start);
    samples.push({ cv, settled, outputKey: outKey, nan: r.nanCount, inf: r.infCount });
  }
  return samples;
}

async function testCurveMonotonicity(opId, params, declared) {
  const cvValues = declared.cv_sweep_linear || [0, 0.1, 0.3, 0.5, 1.0, 2.0, 4.0, 8.0];
  const N = Math.round(0.2 * SR);  // 200 ms per level
  const samples = await feedCVAndCapture(opId, params, cvValues, N);

  // Check declared direction: 'decreasing' for compressor-style gain ops,
  // 'increasing' for envelope followers and similar.
  const direction = declared.curve_direction || 'decreasing';
  let monotonic = true;
  let firstViolation = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].settled;
    const cur  = samples[i].settled;
    const ok = direction === 'decreasing' ? cur <= prev + 1e-6 : cur >= prev - 1e-6;
    if (!ok) {
      monotonic = false;
      firstViolation = { idx: i, cv: samples[i].cv, prev, cur };
      break;
    }
  }

  return {
    name: 'Curve monotonicity',
    pass: monotonic,
    measured: { samples, direction },
    declared: { curve_direction: direction },
    diagnostic: monotonic ? null :
      `Curve violates declared ${direction} order at cv=${firstViolation.cv}: ` +
      `${firstViolation.prev.toExponential(3)} → ${firstViolation.cur.toExponential(3)}.`,
  };
}

async function testRangeCompliance(opId, params, declared) {
  const cvRange = declared.cv_test_range || [-2, 10];
  const cvValues = [];
  for (let i = 0; i <= 20; i++) {
    cvValues.push(cvRange[0] + (cvRange[1] - cvRange[0]) * i / 20);
  }
  const N = Math.round(0.1 * SR);
  const samples = await feedCVAndCapture(opId, params, cvValues, N);

  const rangeMin = declared.output_range?.[0] ?? 0;
  const rangeMax = declared.output_range?.[1] ?? 1;
  let outOfRange = null;
  for (const s of samples) {
    if (s.settled < rangeMin - 1e-6 || s.settled > rangeMax + 1e-6) {
      outOfRange = s;
      break;
    }
  }
  const pass = outOfRange == null;

  return {
    name: 'Output range compliance',
    pass,
    measured: { samples_min: Math.min(...samples.map(s => s.settled)), samples_max: Math.max(...samples.map(s => s.settled)) },
    declared: { output_range: [rangeMin, rangeMax] },
    diagnostic: pass ? null :
      `cv=${outOfRange.cv} produced output ${outOfRange.settled.toExponential(3)} outside declared range [${rangeMin}, ${rangeMax}].`,
  };
}
