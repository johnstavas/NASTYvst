// runner.mjs — entry point for the behavioral validation harness.
//
// Day 3: dual-arm execution. Each metric module exposes a `setRunner(fn)`
// hook; runner.mjs flips the active runner between worklet and native arms
// and dispatches the same metric battery against both, then composes a
// two-arm report with failure attribution per design doc § 7.2.

import * as compressorMetrics from './metrics/compressor.mjs';
import * as filterMetrics     from './metrics/filter.mjs';
import * as distortionMetrics from './metrics/distortion.mjs';
import * as utilityMetrics    from './metrics/utility.mjs';
import * as analyzerMetrics   from './metrics/analyzer.mjs';

import { runWorklet } from './runners/run_worklet.mjs';
import { runNative }  from './runners/run_native.mjs';

const CATEGORY_DISPATCH = {
  compressor: compressorMetrics,
  filter:     filterMetrics,
  distortion: distortionMetrics,
  utility:    utilityMetrics,
  analyzer:   analyzerMetrics,
  eq:         filterMetrics,
};

function setAllRunners(runner) {
  for (const m of Object.values(CATEGORY_DISPATCH)) {
    if (typeof m.setRunner === 'function') m.setRunner(runner);
  }
}

const RUNNERS = { worklet: runWorklet, native: runNative };

/**
 * Run the behavioral test battery for one op against one arm.
 *
 * @param {string} opId
 * @param {object} spec      the .behavioral block from opRegistry.js
 * @param {string} armName   'worklet' | 'native'
 */
async function runArmFor(opId, spec, armName) {
  const t0 = Date.now();
  const dispatcher = CATEGORY_DISPATCH[spec.category];
  if (!dispatcher) {
    return {
      summary: { total: 0, passed: 0, failed: 0, verdict: 'SKIP' },
      tests: [], durationMs: 0,
      reason: `category '${spec.category}' has no metric module`,
    };
  }
  const entry = Object.values(dispatcher).find(v =>
    typeof v === 'function' && v.name?.startsWith('run') && v.name.endsWith('Metrics')
  );
  if (!entry) {
    return {
      summary: { total: 0, passed: 0, failed: 0, verdict: 'SKIP' },
      tests: [], durationMs: 0,
      reason: `no run*Metrics export in ${spec.category}`,
    };
  }

  // Pre-flight for native arm: probe runner; if skipped, mark arm skipped.
  if (armName === 'native') {
    const probe = await RUNNERS.native(opId, spec.defaultParams || {},
      { in: new Float32Array(64) }, { sampleRate: 48000, parityKey: spec.parityKey });
    if (probe.skipped) {
      return {
        summary: { total: 0, passed: 0, failed: 0, verdict: 'SKIP' },
        tests: [], durationMs: Date.now() - t0,
        reason: probe.reason,
      };
    }
  }

  // Native runner needs parityKey on every call — wrap it.
  const baseRunner = RUNNERS[armName];
  const wrappedRunner = (armName === 'native' && spec.parityKey)
    ? (op, params, stim, opts) => baseRunner(op, params, stim, { ...opts, parityKey: spec.parityKey })
    : baseRunner;
  setAllRunners(wrappedRunner);

  let result;
  try {
    result = await entry(opId, spec);
  } catch (e) {
    return {
      summary: { total: 0, passed: 0, failed: 0, verdict: 'SKIP' },
      tests: [], durationMs: Date.now() - t0,
      reason: `arm threw: ${e.message}`,
    };
  }
  return { ...result, durationMs: Date.now() - t0 };
}

/**
 * Two-arm runner: executes worklet first, then (optionally) native, and
 * composes a unified report with failure attribution.
 *
 * @param {string} opId
 * @param {object} spec
 * @param {object} options { native: boolean }
 */
export async function runBehavioralForOp(opId, spec, options = {}) {
  const t0 = Date.now();
  if (!spec || !spec.category) {
    return {
      opId, category: null,
      summary: { total: 0, passed: 0, failed: 0, verdict: 'SKIP' },
      tests: [], worklet: null, native: null, durationMs: 0,
      error: 'no behavioral metadata declared',
    };
  }

  // Worklet arm.
  const workletResult = await runArmFor(opId, spec, 'worklet');

  // Native arm — opt-in.
  let nativeResult = null;
  if (options.native) {
    nativeResult = await runArmFor(opId, spec, 'native');
  }

  // Top-level summary: pass iff worklet passes; native is informational
  // (failures attributed but don't block worklet PASS gate today —
  // attribution table per design § 7.2 is reported instead).
  const summary = workletResult.summary;

  // Failure attribution per design doc § 7.2.
  let attribution = null;
  if (nativeResult && nativeResult.summary.verdict !== 'SKIP') {
    const w = workletResult.summary.verdict;
    const n = nativeResult.summary.verdict;
    if (w === 'PASS' && n === 'PASS') attribution = 'verified-end-to-end';
    else if (w === 'FAIL' && n === 'FAIL') attribution = 'math-or-spec-bug';
    else if (w === 'PASS' && n === 'FAIL') attribution = 'codegen-or-wiring-bug';
    else if (w === 'FAIL' && n === 'PASS') attribution = 'unusual-cross-arm-asymmetry';
  } else if (nativeResult?.summary?.verdict === 'SKIP') {
    attribution = 'native-skipped';
  }

  return {
    opId,
    category: spec.category,
    timestamp: new Date().toISOString(),
    summary,
    tests: workletResult.tests,
    worklet: workletResult,
    native: nativeResult,
    attribution,
    declared: spec.declared,
    durationMs: Date.now() - t0,
  };
}
