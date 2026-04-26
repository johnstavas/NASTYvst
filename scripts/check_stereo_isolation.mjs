// check_stereo_isolation.mjs — codegen MasterGraph regression test.
// Per memory/codegen_design.md § 4.1 + memory/ship_blockers.md § 7.
//
// Fix this gate is protecting:
//   2026-04-25 — MasterGraph::process was sharing one op instance across
//   all stereo channels. Stateful ops (FIR/biquad/envelope) leaked
//   L-channel state into R-channel processing → "crispy aliased garbage"
//   that masquerades as a bad oversampler. Caught the hard way auditioning
//   the drive op (first FIR-bearing op shipped). Real fix: per-channel
//   op state in MasterGraph.h.jinja / MasterGraph.cpp.jinja. THIS test
//   exists so any future regression of that template is caught
//   automatically, not by user audition.
//
// What it does:
//   For every op in per_op_specs.json, run the .vst3 three times:
//     (1) mono(sigL)            → goldL
//     (2) mono(sigR)            → goldR        (sigL ≠ sigR)
//     (3) stereo([sigL, sigR])  → outL, outR
//   Then assert outL ≡ goldL and outR ≡ goldR within tolerance.
//
// PASS = stereo run produces the same per-channel output as two
// independent mono runs. FAIL = state is leaking across channels.
//
// Usage:
//   node scripts/check_stereo_isolation.mjs --op drive
//   node scripts/check_stereo_isolation.mjs --all

import { readFileSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  CANON_SIGNALS, writeWav, writeStereoWav, readWav, deinterleaveStereo,
} from './parity_signals.mjs';
import { snapParamValue } from './param_snap.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..');

// ─── arg parse ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opArg = (() => {
  const i = argv.indexOf('--op');
  return i >= 0 ? argv[i + 1] : null;
})();
const allFlag = argv.includes('--all');
if (!opArg && !allFlag) {
  console.error('usage: node scripts/check_stereo_isolation.mjs --op <name> | --all');
  process.exit(2);
}

// ─── load specs ───────────────────────────────────────────────────────
const specsPath = resolve(repoRoot, 'test/fixtures/parity/per_op_specs.json');
const specs = JSON.parse(readFileSync(specsPath, 'utf8'));

const PARITY_HOST = resolve(repoRoot,
  '.shagsplug/parity_host/build/parity_host_artefacts/Release/parity_host.exe');
if (!existsSync(PARITY_HOST)) {
  console.error(`[stereo] parity_host.exe not found at ${PARITY_HOST}`);
  process.exit(1);
}

// ─── helpers ──────────────────────────────────────────────────────────
function maxAbsDiff(a, b) {
  const N = Math.min(a.length, b.length);
  let worst = 0, idx = 0;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) { worst = d; idx = i; }
  }
  return { worst, idx, refVal: a[idx], natVal: b[idx] };
}
function dbFromLinear(x) { return x > 0 ? 20 * Math.log10(x) : -Infinity; }

function runHost(vst3, inWav, outWav, sr, block, paramsJson) {
  const args = [
    '--vst3',  vst3,
    '--in',    inWav,
    '--out',   outWav,
    '--sr',    String(sr),
    '--block', String(block),
  ];
  if (paramsJson) args.push('--params', paramsJson);
  const r = spawnSync(PARITY_HOST, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`parity_host exited ${r.status}`);
  }
}

function findVst3(spec, opName) {
  // Per-build versioning: PROJECT_NAME = base + "_YYMMDDhhmm". Old builds
  // sit on disk indefinitely. Always pick the newest .vst3 matching the
  // base project name in the build dir, NOT the legacy unversioned path
  // recorded in spec.vst3 (which would test stale code).
  const specPath = resolve(repoRoot, spec.vst3);
  // .../build/<projName>_artefacts/Release/VST3/<projName>.vst3
  //                                                ^ specPath
  // Walk up 4 levels to reach build/.
  const buildDir = dirname(dirname(dirname(dirname(specPath))));
  const baseName = basename(specPath, '.vst3');         // e.g. "SmokeDriveV0"
  if (!existsSync(buildDir)) {
    if (existsSync(specPath)) return specPath;
    throw new Error(`no build dir for op '${opName}' at ${buildDir}`);
  }
  // Walk buildDir for *_artefacts/Release/VST3/*.vst3 with name starting baseName.
  const candidates = [];
  for (const entry of readdirSync(buildDir)) {
    if (!entry.endsWith('_artefacts')) continue;
    const proj = entry.slice(0, -'_artefacts'.length);
    if (!(proj === baseName || proj.startsWith(baseName + '_'))) continue;
    const vst3Dir = join(buildDir, entry, 'Release', 'VST3');
    if (!existsSync(vst3Dir)) continue;
    for (const f of readdirSync(vst3Dir)) {
      if (!f.endsWith('.vst3')) continue;
      const full = join(vst3Dir, f);
      const mt = statSync(full).mtimeMs;
      candidates.push({ full, mt, name: f });
    }
  }
  if (candidates.length === 0) {
    if (existsSync(specPath)) return specPath;
    throw new Error(`no .vst3 found for op '${opName}' under ${buildDir}`);
  }
  candidates.sort((a, b) => b.mt - a.mt);  // newest first
  return candidates[0].full;
}

// ─── per-op runner ────────────────────────────────────────────────────
function runOp(opName) {
  const spec = specs.ops[opName];
  if (!spec) throw new Error(`no spec for op '${opName}'`);
  const sr    = spec.sr    || 48000;
  const block = spec.block || 512;
  const tolDb = spec.tolerance_db ?? -100;
  const tolLin = Math.pow(10, tolDb / 20);

  const vst3  = findVst3(spec, opName);

  // Two distinct deterministic signals — pink for L, 440 Hz sine for R.
  const sigL = CANON_SIGNALS.pink_noise();
  const sigR = CANON_SIGNALS.sine_440();
  const N = Math.min(sigL.length, sigR.length);
  const L = sigL.subarray(0, N);
  const R = sigR.subarray(0, N);

  const workDir = resolve(repoRoot, '.shagsplug/parity_workspace', opName, '_stereo_iso');
  mkdirSync(workDir, { recursive: true });

  const monoL_in   = resolve(workDir, 'mono_L_in.wav');
  const monoR_in   = resolve(workDir, 'mono_R_in.wav');
  const stereo_in  = resolve(workDir, 'stereo_in.wav');
  const monoL_out  = resolve(workDir, 'mono_L_out.wav');
  const monoR_out  = resolve(workDir, 'mono_R_out.wav');
  const stereo_out = resolve(workDir, 'stereo_out.wav');
  const paramsJson = resolve(workDir, 'params.json');

  writeWav(monoL_in, L, sr);
  writeWav(monoR_in, R, sr);
  writeStereoWav(stereo_in, L, R, sr);

  // Reuse spec.params verbatim (already snapped to APVTS ranges by the
  // codegen build; same values used by check_native_parity.mjs).
  writeFileSync(paramsJson, JSON.stringify(spec.params || {}, null, 2));

  console.log(`[stereo] op=${opName}  vst3=${vst3.replace(repoRoot, '').replace(/\\/g, '/').replace(/^\//, '')}`);
  console.log(`         tol=${tolDb} dB  N=${N}  sr=${sr}  block=${block}`);

  // Three runs. Each spawns a fresh plugin instance so prior state can't
  // pollute later runs — that's a property of parity_host, not us.
  runHost(vst3, monoL_in,  monoL_out,  sr, block, paramsJson);
  runHost(vst3, monoR_in,  monoR_out,  sr, block, paramsJson);
  runHost(vst3, stereo_in, stereo_out, sr, block, paramsJson);

  const goldL = readWav(monoL_out).samples;
  const goldR = readWav(monoR_out).samples;
  const stereo = deinterleaveStereo(readWav(stereo_out));

  const dL = maxAbsDiff(goldL, stereo.L);
  const dR = maxAbsDiff(goldR, stereo.R);
  const passL = dL.worst <= tolLin;
  const passR = dR.worst <= tolLin;

  const fmt = (m, label, pass) =>
    `  [${pass ? 'PASS' : 'FAIL'}] ${label}  maxAbsDiff=${m.worst.toExponential(3)}  (${dbFromLinear(m.worst).toFixed(1)} dB, tol ${tolDb})  worstIdx=${m.idx}  gold=${m.refVal?.toFixed(6)} stereo=${m.natVal?.toFixed(6)}`;

  console.log(fmt(dL, 'L-channel', passL));
  console.log(fmt(dR, 'R-channel', passR));

  return passL && passR;
}

// ─── orchestrate ──────────────────────────────────────────────────────
const ops = opArg ? [opArg] : Object.keys(specs.ops || {});
let allPass = true;
const failures = [];

for (const op of ops) {
  try {
    const ok = runOp(op);
    if (!ok) { allPass = false; failures.push(op); }
  } catch (e) {
    console.error(`[stereo] ${op}: ${e.message}`);
    allPass = false;
    failures.push(op);
  }
  console.log('');
}

if (allPass) {
  console.log('[stereo] DONE — ALL PASS');
  process.exit(0);
} else {
  console.log(`[stereo] DONE — ${failures.length} FAIL: ${failures.join(', ')}`);
  console.log('         MasterGraph stereo state isolation regressed. See codegen_design.md § 4.1.');
  process.exit(1);
}
