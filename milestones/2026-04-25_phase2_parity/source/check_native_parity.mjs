// check_native_parity.mjs — Phase 2 orchestrator.
// Per memory/codegen_pipeline_buildout.md § 5.
//
// Usage:
//   node scripts/check_native_parity.mjs --op gain
//   node scripts/check_native_parity.mjs --all
//
// Loads test/fixtures/parity/per_op_specs.json, generates each test signal,
// renders through (a) the canon JS reference and (b) the .vst3 via parity_host,
// compares under tolerance, prints PASS/FAIL.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { CANON_SIGNALS, writeWav, readWav } from './parity_signals.mjs';

// JUCE's String::hashCode() — Java-style (31*h + c), int32, then cast to uint32
// for VST3 ParamID. Matches juce_audio_plugin_client_VST3.cpp.
function juceParamHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  // JUCE_USE_STUDIO_ONE_COMPATIBLE_PARAMETERS clears the top bit.
  return ((h >>> 0) & 0x7FFFFFFF).toString();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..');

// ─── arg parse ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opArg  = (() => {
  const i = argv.indexOf('--op');
  return i >= 0 ? argv[i + 1] : null;
})();
const allFlag = argv.includes('--all');
if (!opArg && !allFlag) {
  console.error('usage: node scripts/check_native_parity.mjs --op <name> | --all');
  process.exit(2);
}

// ─── load specs ───────────────────────────────────────────────────────
const specsPath = resolve(repoRoot, 'test/fixtures/parity/per_op_specs.json');
const specs = JSON.parse(readFileSync(specsPath, 'utf8'));

// ─── parity_host binary ───────────────────────────────────────────────
const PARITY_HOST = resolve(repoRoot,
  '.shagsplug/parity_host/build/parity_host_artefacts/Release/parity_host.exe');
if (!existsSync(PARITY_HOST)) {
  console.error(`[parity] parity_host.exe not found at ${PARITY_HOST}`);
  console.error('         build it first: cmake configure+build src/sandbox/codegen/parity_host');
  process.exit(1);
}

// ─── builtin reference renderers ──────────────────────────────────────
const REFERENCES = {
  'builtin:gain': (input, args) => {
    const gainDb = args.gainDb ?? 0;
    const base = Math.pow(10, gainDb / 20);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * base;
    return out;
  },
  // gain → gain (used by smoke chain)
  'builtin:gain_chain2': (input, args) => {
    const a = args.a ?? 0;
    const b = args.b ?? 0;
    const base = Math.pow(10, (a + b) / 20);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * base;
    return out;
  },
};

// ─── metrics ──────────────────────────────────────────────────────────
function maxAbsDiff(a, b) {
  const N = Math.min(a.length, b.length);
  let worst = 0, idx = 0;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) { worst = d; idx = i; }
  }
  return { worst, idx, refVal: a[idx], natVal: b[idx] };
}
function rmsDiff(a, b) {
  const N = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < N; i++) { const d = a[i] - b[i]; s += d * d; }
  return { worst: Math.sqrt(s / N), idx: -1, refVal: 0, natVal: 0 };
}
function dbFromLinear(x) {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

// ─── run one (op, signal) pair ────────────────────────────────────────
function runPair(op, spec, signalName) {
  const gen = CANON_SIGNALS[signalName];
  if (!gen) throw new Error(`unknown signal '${signalName}'`);
  const samples = gen();

  const workDir = resolve(repoRoot, '.shagsplug/parity_workspace', op, signalName);
  mkdirSync(workDir, { recursive: true });
  const inWav     = resolve(workDir, 'in.wav');
  const outNative = resolve(workDir, 'out_native.wav');
  const outRef    = resolve(workDir, 'out_ref.wav');
  const paramsJson = resolve(workDir, 'params.json');

  writeWav(inWav, samples, spec.sr || 48000);
  // Translate paramID → JUCE-hashed VST3 ID, and normalise raw values to [0,1]
  // since HostedParameter doesn't expose ranges.
  const hashedParams = {};
  for (const [k, v] of Object.entries(spec.params || {})) {
    const rng = (spec.paramRanges || {})[k];
    let norm = v;
    if (rng) {
      norm = (v - rng.min) / (rng.max - rng.min);
      norm = Math.max(0, Math.min(1, norm));
    }
    hashedParams[juceParamHash(k)] = norm;
  }
  writeFileSync(paramsJson, JSON.stringify(hashedParams, null, 2));

  // (a) reference
  const refFn = REFERENCES[spec.reference];
  if (!refFn) throw new Error(`no reference '${spec.reference}'`);
  const refOut = refFn(samples, spec.reference_args || {});
  writeWav(outRef, refOut, spec.sr || 48000);

  // (b) native via parity_host
  const vst3Abs = resolve(repoRoot, spec.vst3);
  if (!existsSync(vst3Abs)) {
    return { signal: signalName, ok: false, reason: `vst3 missing: ${spec.vst3}` };
  }
  const res = spawnSync(PARITY_HOST, [
    '--vst3', vst3Abs,
    '--in',   inWav,
    '--out',  outNative,
    '--sr',   String(spec.sr || 48000),
    '--block',String(spec.block || 512),
    '--params', paramsJson,
  ], { stdio: 'pipe', encoding: 'utf8' });
  if (res.status !== 0) {
    return { signal: signalName, ok: false,
             reason: `parity_host status=${res.status}\nstderr=${res.stderr}` };
  }

  // (c) compare
  const native = readWav(outNative).samples;
  const metric = spec.metric || 'max_abs_diff';
  const fn = metric === 'rms_diff' ? rmsDiff : maxAbsDiff;
  const r = fn(refOut, native);
  const dbDiff = dbFromLinear(r.worst);
  const tol = spec.tolerance_db ?? -120;
  const ok = dbDiff <= tol;
  return {
    signal: signalName, ok, dbDiff, tol, metric,
    worst: r.worst, idx: r.idx, refVal: r.refVal, natVal: r.natVal,
    refSamples: refOut.length, natSamples: native.length,
  };
}

// ─── main loop ────────────────────────────────────────────────────────
const opsToRun = allFlag ? Object.keys(specs.ops) : [opArg];
let totalFail = 0;

for (const op of opsToRun) {
  const spec = specs.ops[op];
  if (!spec) { console.error(`[parity] no spec for op '${op}'`); totalFail++; continue; }
  console.log(`\n[parity] op=${op}  vst3=${spec.vst3}`);
  console.log(`         ref=${spec.reference}  tol=${spec.tolerance_db} dB  metric=${spec.metric}`);

  for (const sig of spec.signals) {
    const r = runPair(op, spec, sig);
    if (r.reason) {
      console.log(`  [FAIL] ${sig}: ${r.reason}`);
      totalFail++;
      continue;
    }
    const status = r.ok ? 'PASS' : 'FAIL';
    const dbStr = r.dbDiff === -Infinity ? '-Inf' : r.dbDiff.toFixed(2);
    if (r.metric === 'max_abs_diff') {
      console.log(`  [${status}] ${sig.padEnd(12)} maxAbsDiff=${r.worst.toExponential(3)}  ` +
                  `(${dbStr} dB, tol ${r.tol})  worstIdx=${r.idx}  ref=${r.refVal.toFixed(6)} nat=${r.natVal.toFixed(6)}`);
    } else {
      console.log(`  [${status}] ${sig.padEnd(12)} rmsDiff=${r.worst.toExponential(3)}  ` +
                  `(${dbStr} dB, tol ${r.tol})`);
    }
    if (!r.ok) totalFail++;
  }
}

console.log(`\n[parity] DONE — ${totalFail === 0 ? 'ALL PASS' : `${totalFail} FAIL(s)`}`);
process.exit(totalFail === 0 ? 0 : 1);
