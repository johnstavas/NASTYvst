// utility.mjs — behavioral metric module for utility / closed-form-math ops.
//
// Tests applied per design doc § 6.17:
//   - Closed-form math identity — output ≡ closed-form expected within float epsilon
//   - Sub-buffer-size handling — same output regardless of block size
//   - Bypass null (if declared)
//
// The closed-form check is op-specific: each utility op declares an `expectedFn`
// in its behavioral spec — a pure function `(input_sample, params) => expected_output_sample`.
// The metric module just applies it sample-by-sample and asserts equality.

import { sine, pinkNoise, impulse } from '../../../../scripts/parity_signals.mjs';
import { runWorklet } from '../runners/run_worklet.mjs';
import { linearToDb } from '../primitives/thd.mjs';

let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;
const EPS = 1e-6;  // float32 round-trip tolerance

export async function runUtilityMetrics(opId, spec) {
  const declared = spec.declared || {};
  const params = spec.defaultParams || {};
  const tests = [];

  if (declared.expectedFn) {
    tests.push(await testClosedFormIdentity(opId, params, declared));
    tests.push(await testBlockSizeInvariance(opId, params, declared));
  } else {
    tests.push({
      name: 'Closed-form identity (declared)',
      pass: false,
      diagnostic: 'utility op spec must declare `expectedFn(x, params) => expected_y`.',
    });
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

async function testClosedFormIdentity(opId, params, declared) {
  // Use a mix of impulse, sine, pink noise to broadly test.
  const stims = [
    { name: 'sine_1k', buf: sine(2048, SR, 1000, 0.5) },
    { name: 'pink',    buf: pinkNoise(2048, 0xC0FFEE, 0.25) },
    { name: 'impulse', buf: impulse(2048) },
  ];

  let maxAbsErr = 0;
  let firstFailStim = null;
  let firstFailIdx = -1;

  for (const stim of stims) {
    const r = await _runner(opId, params, { in: stim.buf }, { sampleRate: SR });
    const out = r.outputs.out || r.outputs[Object.keys(r.outputs)[0]];
    for (let i = 0; i < stim.buf.length; i++) {
      const expected = declared.expectedFn(stim.buf[i], params);
      const err = Math.abs(out[i] - expected);
      if (err > maxAbsErr) {
        maxAbsErr = err;
        if (err > EPS && !firstFailStim) {
          firstFailStim = stim.name;
          firstFailIdx = i;
        }
      }
    }
  }

  const pass = maxAbsErr < EPS;
  return {
    name: 'Closed-form math identity',
    pass,
    measured: { max_abs_err: maxAbsErr, max_abs_err_db: linearToDb(maxAbsErr) },
    declared: { tolerance: EPS },
    diagnostic: pass ? null :
      `Max abs error = ${maxAbsErr.toExponential(3)} (${linearToDb(maxAbsErr).toFixed(1)} dBFS); ` +
      `tolerance = ${EPS.toExponential(0)}. First fail: stim=${firstFailStim}, idx=${firstFailIdx}.`,
  };
}

async function testBlockSizeInvariance(opId, params, declared) {
  // Run the same stimulus at two different block sizes; output must match.
  const stim = sine(2048, SR, 1000, 0.5);
  const r256 = await _runner(opId, params, { in: stim }, { sampleRate: SR, blockSize: 256 });
  const r64  = await _runner(opId, params, { in: stim }, { sampleRate: SR, blockSize: 64 });
  const a = r256.outputs.out || r256.outputs[Object.keys(r256.outputs)[0]];
  const b = r64.outputs.out  || r64.outputs[Object.keys(r64.outputs)[0]];
  let maxAbsErr = 0;
  for (let i = 0; i < a.length; i++) {
    const err = Math.abs(a[i] - b[i]);
    if (err > maxAbsErr) maxAbsErr = err;
  }
  const pass = maxAbsErr < EPS;
  return {
    name: 'Block-size invariance',
    pass,
    measured: { max_abs_err: maxAbsErr },
    declared: { tolerance: EPS },
    diagnostic: pass ? null :
      `Different output between blockSize=256 vs 64; max error = ${maxAbsErr.toExponential(3)}. ` +
      `Likely state leakage across blocks or block-boundary bug.`,
  };
}
