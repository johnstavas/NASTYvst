// Op sidecar golden-vector harness.
//
// Stage-3 step 1 of codegen bring-up (memory/codegen_design.md § 12 step 2).
//
// What this enforces:
//   (A) Shape conformance — every op_<id>.worklet.js sidecar's static
//       opId/inputs/outputs/params matches opRegistry.js entry exactly.
//       Anyone adding an op must land both files consistently or this
//       fails at pre-commit.
//   (B) Numerical contract — each op is driven with a fixed input buffer
//       (chirp + impulse sequence) at default params; the output is
//       hashed (SHA-256) and compared to scripts/goldens/<opId>.golden.json.
//       On first run the golden is created and committed; later changes
//       to the sidecar math break the hash, forcing the author to either
//       revert or deliberately re-bless.
//
// Why it's stub-safe today: sidecars ship with empty inner loops, so the
// golden captures the all-zero output. When Stage-3a implementation ports
// real math in, the harness will trip — that's the point. The author
// runs `node scripts/check_op_goldens.mjs --bless` to re-capture after
// verifying the new math is what they want.
//
// Why it runs in Node (not the browser): sidecars are pure JS classes
// with no AudioWorkletGlobalScope dependency, exactly because master-
// worklet codegen stitches them flat. This means `.worklet.js` is a
// misleading extension historically — but we keep it so grep patterns
// match "everything that emits into the master worklet".
//
// Run:       node scripts/check_op_goldens.mjs
// Bless:     node scripts/check_op_goldens.mjs --bless

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const repoRoot    = resolve(__dirname, '..');
const opsDir      = resolve(repoRoot, 'src', 'sandbox', 'ops');
const registryFs  = resolve(repoRoot, 'src', 'sandbox', 'opRegistry.js');
const goldensDir  = resolve(repoRoot, 'scripts', 'goldens');
const tmpDir      = resolve(repoRoot, 'node_modules', '.sandbox-ops-harness');

const BLESS = process.argv.includes('--bless');

if (!existsSync(goldensDir)) mkdirSync(goldensDir, { recursive: true });
if (!existsSync(tmpDir))     mkdirSync(tmpDir,     { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

// List of ops we currently expect sidecars for. Must match opRegistry.js MVP
// set. The shape-check (A) catches any divergence between this list and
// either the registry or the filesystem.
const OP_IDS = ['gain', 'filter', 'detector', 'envelope', 'gainComputer', 'mix'];

// -------- copy sources into tmp ESM dir ------------------------------------
copyFileSync(registryFs, resolve(tmpDir, 'opRegistry.js'));
for (const id of OP_IDS) {
  const src = resolve(opsDir, `op_${id}.worklet.js`);
  const dst = resolve(tmpDir, `op_${id}.worklet.js`);
  copyFileSync(src, dst);
}

// -------- load modules -----------------------------------------------------
const { OPS } = await import(pathToFileURL(resolve(tmpDir, 'opRegistry.js')).href);
const sidecarClasses = {};
for (const id of OP_IDS) {
  const mod = await import(pathToFileURL(resolve(tmpDir, `op_${id}.worklet.js`)).href);
  // Each sidecar exports exactly one class. Grab the first (and only)
  // exported name — robust to naming drift (GainOp vs Gain).
  const exports = Object.values(mod).filter(v => typeof v === 'function');
  if (exports.length !== 1) {
    throw new Error(`op_${id}.worklet.js must export exactly one class (found ${exports.length})`);
  }
  sidecarClasses[id] = exports[0];
}

// -------- fixtures ---------------------------------------------------------
const SR = 48000;
const N  = 128;  // one render quantum

/** Deterministic drive signal: chirp (0..1 over 96 samples) then impulse at
 *  sample 100, zeros thereafter. Covers a useful dynamic range for detector /
 *  envelope / filter / saturation class ops without depending on PRNG. */
function makeDriveBuffer() {
  const buf = new Float32Array(N);
  for (let i = 0; i < 96; i++) buf[i] = Math.sin(2 * Math.PI * (i * i) / 96 / 2) * 0.5;
  buf[100] = 0.9;
  return buf;
}

// -------- shape conformance (A) --------------------------------------------
const results = [];
function ok(name) { results.push({ name, pass: true }); }
function fail(name, why) { results.push({ name, pass: false, why }); }

for (const id of OP_IDS) {
  const registryEntry = OPS[id];
  const SidecarClass  = sidecarClasses[id];

  if (!registryEntry) { fail(`shape[${id}]: opRegistry missing entry`, `OPS['${id}'] is undefined`); continue; }
  if (SidecarClass.opId !== id) {
    fail(`shape[${id}]: sidecar opId mismatch`, `sidecar reports "${SidecarClass.opId}", expected "${id}"`);
    continue;
  }

  // Compare input port ids (order-insensitive)
  const regIn  = registryEntry.ports.inputs.map(p => p.id).sort();
  const sideIn = (SidecarClass.inputs || []).map(p => p.id).sort();
  if (JSON.stringify(regIn) !== JSON.stringify(sideIn)) {
    fail(`shape[${id}]: input ports mismatch`, `registry=${JSON.stringify(regIn)} sidecar=${JSON.stringify(sideIn)}`);
    continue;
  }

  const regOut  = registryEntry.ports.outputs.map(p => p.id).sort();
  const sideOut = (SidecarClass.outputs || []).map(p => p.id).sort();
  if (JSON.stringify(regOut) !== JSON.stringify(sideOut)) {
    fail(`shape[${id}]: output ports mismatch`, `registry=${JSON.stringify(regOut)} sidecar=${JSON.stringify(sideOut)}`);
    continue;
  }

  const regParams  = registryEntry.params.map(p => p.id).sort();
  const sideParams = (SidecarClass.params || []).map(p => p.id).sort();
  if (JSON.stringify(regParams) !== JSON.stringify(sideParams)) {
    fail(`shape[${id}]: params mismatch`, `registry=${JSON.stringify(regParams)} sidecar=${JSON.stringify(sideParams)}`);
    continue;
  }

  ok(`shape[${id}]: sidecar matches opRegistry`);
}

// -------- numerical contract (B) -------------------------------------------
// Helper: wire drive into whatever the sidecar declares as its first
// audio/control input, read from whatever it declares as its first output.
function runSidecar(SidecarClass) {
  const inst = new SidecarClass(SR);
  inst.reset();
  // Apply defaults (constructor already did this, but make it explicit so
  // hash stays stable if someone forgets to initialize in the constructor).
  for (const p of (SidecarClass.params || [])) {
    inst.setParam(p.id, p.default);
  }

  const drive = makeDriveBuffer();
  const inputs = {};
  // Wire drive to the FIRST declared input (audio or control). Other inputs
  // (optional ones, secondary audio inputs like mix.wet) are left undefined
  // — sidecar must handle nulls defensively.
  const firstIn = (SidecarClass.inputs || [])[0];
  if (firstIn) inputs[firstIn.id] = drive;

  const outputs = {};
  for (const p of (SidecarClass.outputs || [])) {
    outputs[p.id] = new Float32Array(N);
  }

  inst.process(inputs, outputs, N);

  // Hash concatenation of all outputs (in declared order) as little-endian
  // float32 bytes. Deterministic across platforms — TypedArray buffer is
  // always LE in practice on all targets we care about (x86 + arm64).
  const hasher = createHash('sha256');
  for (const p of (SidecarClass.outputs || [])) {
    hasher.update(Buffer.from(outputs[p.id].buffer, outputs[p.id].byteOffset, outputs[p.id].byteLength));
  }
  return hasher.digest('hex');
}

for (const id of OP_IDS) {
  const SidecarClass = sidecarClasses[id];
  let hash;
  try {
    hash = runSidecar(SidecarClass);
  } catch (err) {
    fail(`golden[${id}]: sidecar threw`, err.message);
    continue;
  }

  const goldenPath = resolve(goldensDir, `${id}.golden.json`);
  const goldenPayload = { op: id, sr: SR, n: N, hash };

  if (BLESS || !existsSync(goldenPath)) {
    writeFileSync(goldenPath, JSON.stringify(goldenPayload, null, 2) + '\n');
    ok(`golden[${id}]: ${existsSync(goldenPath) && !BLESS ? 'created' : 'blessed'} → ${hash.slice(0, 16)}…`);
    continue;
  }

  const stored = JSON.parse(readFileSync(goldenPath, 'utf8'));
  if (stored.hash !== hash) {
    fail(
      `golden[${id}]: hash mismatch`,
      `stored=${stored.hash.slice(0, 16)}… got=${hash.slice(0, 16)}… — re-bless with \`node scripts/check_op_goldens.mjs --bless\` if intended`,
    );
    continue;
  }

  ok(`golden[${id}]: matches ${hash.slice(0, 16)}…`);
}

// -------- report -----------------------------------------------------------
console.log(`\nOp sidecar conformance — shape + golden-vector hash\n`);
let fails = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${r.name}`);
  if (!r.pass) { fails++; console.log(`         ${r.why}`); }
}
console.log('');
if (fails) {
  console.log(`RESULT: FAIL — ${fails} of ${results.length} checks failed\n`);
  process.exit(1);
} else {
  console.log(`RESULT: PASS — all ${results.length} checks clean\n`);
}
