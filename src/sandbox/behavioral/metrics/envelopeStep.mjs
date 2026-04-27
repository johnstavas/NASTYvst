// envelopeStep.mjs — behavioral metric module for envelope follower ops.
//
// Tests:
//   - Attack T90  (matches declared.attack_ms within tolerance)
//   - Release T90 (matches declared.release_ms within tolerance)
//   - Steady-state level (output settles to declared.amount * input_level + offset)
//
// Used for:
//   - op_envelope (TOY_COMP-style AR follower)
//   - any future envelope-shaped op
//
// Citation: IEC 60268-3 step-response convention; T90 = 90% of total
// excursion (matches plugin GUI labeling used by SSL, FabFilter, iZotope).
//
// CONTRACT.  envelope op shape:
//   inputs:  { in: audio (typically rectified) }
//   outputs: { env: control-rate envelope }
//   params:  attack (ms), release (ms), amount (gain), offset (DC bias)
//
// We feed a |x|-style positive-magnitude step (envelope expects rectified
// input — that's what the sidechain detector produces upstream in a real
// compressor recipe), measure the output envelope's rise time via
// step_response.findReachTime.

import { runWorklet } from '../runners/run_worklet.mjs';
import { levelStepDC, envelopeRMS, findReachTime, withinTolerance } from '../primitives/step_response.mjs';
import { rms } from '../primitives/thd.mjs';

let _runner = runWorklet;
export function setRunner(r) { _runner = r; }

const SR = 48000;
const PRE_STEP_S  = 0.4;   // hold initial level for 400 ms
const POST_STEP_S = 1.5;   // hold post-step level for 1.5 s

export async function runEnvelopeStepMetrics(opId, spec) {
  const declared = spec.declared || {};
  const params   = spec.defaultParams || {};
  const tol      = spec.tolerances || {};

  const tests = [];

  // Attack: low → high level step
  if (declared.attack_ms != null) {
    tests.push(await testAttack(opId, params, declared, tol));
  }
  // Release: high → low level step
  if (declared.release_ms != null) {
    tests.push(await testRelease(opId, params, declared, tol));
  }
  // Steady-state level transfer
  tests.push(await testSteadyState(opId, params, declared));

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
// Attack T90: input level steps from `levelLo` to `levelHi`
// ─────────────────────────────────────────────────────────────────────────
async function testAttack(opId, params, declared, tol) {
  const levelLo = declared.step_lo ?? 0.0;
  const levelHi = declared.step_hi ?? 0.5;
  const N = Math.round((PRE_STEP_S + POST_STEP_S) * SR);
  const stim = levelStepDC(N, SR, levelLo, levelHi, PRE_STEP_S);

  const result = await _runner(opId, params, { in: stim }, { sampleRate: SR });
  const outKey = result.outputs.env != null ? 'env' : Object.keys(result.outputs)[0];
  const out = result.outputs[outKey];
  if (!out) {
    return { name: 'Attack T90', pass: false, diagnostic: 'no output buffer' };
  }

  // For envelope outputs that may be negative (amount<0), use abs() pre-RMS.
  const absOut = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) absOut[i] = Math.abs(out[i]);
  const { times, env } = envelopeRMS(absOut, SR, 0.005, 0.0005);

  const reach = findReachTime(times, env, PRE_STEP_S, -1, 0.005);
  const reachMs = reach.reachSec != null ? reach.reachSec * 1000 : null;
  const declaredMs = declared.attack_ms;
  const tolerancePct = tol.attack_ms_pct ?? 30;
  const pass = reachMs != null && withinTolerance(reachMs, declaredMs, tolerancePct);

  return {
    name: 'Attack T90',
    pass,
    measured: { attack_t90_ms: reachMs, direction: reach.direction },
    declared: { attack_ms: declaredMs, tolerance_pct: tolerancePct },
    diagnostic: pass ? null
      : `Measured T90 = ${reachMs == null ? 'never reached' : reachMs.toFixed(1) + ' ms'}; ` +
        `declared = ${declaredMs} ms ± ${tolerancePct}%.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Release T90: high → low step
// ─────────────────────────────────────────────────────────────────────────
async function testRelease(opId, params, declared, tol) {
  const levelHi = declared.step_hi ?? 0.5;
  const levelLo = declared.step_lo ?? 0.0;
  const N = Math.round((PRE_STEP_S + POST_STEP_S) * SR);
  const stim = levelStepDC(N, SR, levelHi, levelLo, PRE_STEP_S);

  const result = await _runner(opId, params, { in: stim }, { sampleRate: SR });
  const outKey = result.outputs.env != null ? 'env' : Object.keys(result.outputs)[0];
  const out = result.outputs[outKey];
  if (!out) {
    return { name: 'Release T90', pass: false, diagnostic: 'no output buffer' };
  }
  const absOut = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) absOut[i] = Math.abs(out[i]);
  const { times, env } = envelopeRMS(absOut, SR, 0.005, 0.0005);

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
    diagnostic: pass ? null
      : `Measured T90 = ${reachMs == null ? 'never reached' : reachMs.toFixed(1) + ' ms'}; ` +
        `declared = ${declaredMs} ms ± ${tolerancePct}%.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Steady-state level: env output should settle to amount·input + offset
// ─────────────────────────────────────────────────────────────────────────
async function testSteadyState(opId, params, declared) {
  const inputLevel = declared.steady_input ?? 0.5;
  const N = Math.round(2.0 * SR);   // 2 s, plenty of settle
  const stim = new Float32Array(N).fill(inputLevel);
  const result = await _runner(opId, params, { in: stim }, { sampleRate: SR });
  const outKey = result.outputs.env != null ? 'env' : Object.keys(result.outputs)[0];
  const out = result.outputs[outKey];
  if (!out) return { name: 'Steady-state level', pass: false, diagnostic: 'no output' };

  // Mean of last 25% of output.
  const settledStart = Math.floor(out.length * 0.75);
  let sum = 0;
  for (let i = settledStart; i < out.length; i++) sum += out[i];
  const measured = sum / Math.max(1, out.length - settledStart);

  // Expected = amount * input + offset.
  const amount = params.amount ?? 1;
  const offset = params.offset ?? 0;
  const expected = amount * inputLevel + offset;
  const err = Math.abs(measured - expected);
  const tol = Math.max(1e-3, Math.abs(expected) * 0.05);   // 5% relative or 0.001 abs
  const pass = err <= tol;

  return {
    name: 'Steady-state level',
    pass,
    measured: { settled_value: measured, abs_error: err },
    declared:  { expected, tolerance: tol, formula: 'amount·input + offset' },
    diagnostic: pass ? null
      : `Settled to ${measured.toFixed(4)}, expected ${expected.toFixed(4)} (err ${err.toExponential(3)} > tol ${tol.toExponential(3)}).`,
  };
}
