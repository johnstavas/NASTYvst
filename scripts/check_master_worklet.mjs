// Master-worklet conformance harness.
//
// Stage-3 step 4 of codegen bring-up (memory/codegen_design.md § 3-a).
//
// What this enforces:
//   Given TOY_COMP's PCOF + the six real op sidecars, the master-worklet
//   factory (createMasterProcessor.js) produces a MasterProcessor whose
//   process(in, out, N) is bit-identical across commits. Hash is pinned
//   to scripts/goldens/master-toy-comp.golden.json.
//
// This is the Node-level numerical pin. It does NOT replace the in-app
// A/B null-test against chain-of-worklets TOY_COMP (that's the Stage 3-a
// exit gate the user runs in the browser). But it catches any accidental
// drift in (a) buildPCOF topo/wiring, (b) createMasterProcessor render
// algorithm, (c) any sidecar math, between here and the next gate.
//
// Run:     node scripts/check_master_worklet.mjs
// Bless:   node scripts/check_master_worklet.mjs --bless

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const repoRoot    = resolve(__dirname, '..');
const sandboxDir  = resolve(repoRoot, 'src', 'sandbox');
const opsDir      = resolve(sandboxDir, 'ops');
const goldensDir  = resolve(repoRoot, 'scripts', 'goldens');
const tmpDir      = resolve(repoRoot, 'node_modules', '.sandbox-master-harness');

const BLESS = process.argv.includes('--bless');

if (!existsSync(goldensDir)) mkdirSync(goldensDir, { recursive: true });
if (!existsSync(tmpDir))     mkdirSync(tmpDir,     { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

// -------- copy + rewrite sandbox sources into tmp ESM dir -------------------
function copyRewrite(fname, srcDir, rewrites = []) {
  let src = readFileSync(resolve(srcDir, fname), 'utf8');
  for (const [re, to] of rewrites) src = src.replace(re, to);
  writeFileSync(resolve(tmpDir, fname), src);
}

copyRewrite('opRegistry.js',     sandboxDir);
copyRewrite('validateGraph.js',  sandboxDir, [[/from '\.\/opRegistry'/g, "from './opRegistry.js'"]]);
copyRewrite('buildPCOF.js',      sandboxDir, [
  [/from '\.\/opRegistry'/g,     "from './opRegistry.js'"],
  [/from '\.\/validateGraph'/g,  "from './validateGraph.js'"],
]);
copyRewrite('validatePCOF.js',   sandboxDir, [[/from '\.\/buildPCOF'/g, "from './buildPCOF.js'"]]);
copyRewrite('createMasterProcessor.js', sandboxDir);

const mockSrc = readFileSync(resolve(sandboxDir, 'mockGraphs.js'), 'utf8')
  .replace(/from '\.\/validateGraph'/g, "from './validateGraph.js'")
  .replace(/\/\/ --- Dev-time conformance check[\s\S]*$/m, '');
writeFileSync(resolve(tmpDir, 'mockGraphs.js'), mockSrc);

// Ops used by TOY_COMP: detector, envelope, gainComputer, gain.
// Copy all six so the registry + factory can resolve anything at runtime.
const OP_IDS = ['gain', 'filter', 'detector', 'envelope', 'gainComputer', 'mix'];
for (const id of OP_IDS) {
  copyFileSync(resolve(opsDir, `op_${id}.worklet.js`), resolve(tmpDir, `op_${id}.worklet.js`));
}

// -------- load modules ------------------------------------------------------
const { buildPCOF, PCOF_VERSION }       = await import(pathToFileURL(resolve(tmpDir, 'buildPCOF.js')).href);
const { validatePCOF }                  = await import(pathToFileURL(resolve(tmpDir, 'validatePCOF.js')).href);
const { createMasterProcessor }         = await import(pathToFileURL(resolve(tmpDir, 'createMasterProcessor.js')).href);
const { MOCK_GRAPHS_BY_BRICK_TYPE }     = await import(pathToFileURL(resolve(tmpDir, 'mockGraphs.js')).href);

const sidecarClasses = {};
for (const id of OP_IDS) {
  const mod = await import(pathToFileURL(resolve(tmpDir, `op_${id}.worklet.js`)).href);
  const exports = Object.values(mod).filter(v => typeof v === 'function');
  if (exports.length !== 1) {
    throw new Error(`op_${id}.worklet.js must export exactly one class (found ${exports.length})`);
  }
  sidecarClasses[id] = exports[0];
}

// -------- fixtures ----------------------------------------------------------
const SR = 48000;
const N  = 128;
const BLOCKS = 8;  // 1024 samples — enough for envelope to settle after impulse

/** Same deterministic drive signal as the op-sidecar harness: chirp in the
 *  first 96 samples then a single 0.9 impulse at sample 100. Provides both
 *  a sustained region (for detector/envelope/comp) and a transient (for
 *  attack-time verification). */
function makeDriveBlock() {
  const buf = new Float32Array(N);
  for (let i = 0; i < 96; i++) buf[i] = Math.sin(2 * Math.PI * (i * i) / 96 / 2) * 0.5;
  buf[100] = 0.9;
  return buf;
}

// -------- build PCOF --------------------------------------------------------
const TOY_COMP = MOCK_GRAPHS_BY_BRICK_TYPE.toyComp;
if (!TOY_COMP) { console.error('TOY_COMP mock graph missing'); process.exit(1); }

let pcof;
try {
  pcof = buildPCOF(TOY_COMP);
} catch (err) {
  console.error(`FAIL: buildPCOF threw: ${err.message}`);
  process.exit(1);
}
const pr = validatePCOF(pcof);
if (!pr.ok) {
  console.error('FAIL: PCOF validation errors:');
  for (const e of pr.errors) console.error(`  ${e}`);
  process.exit(1);
}

// -------- build master processor -------------------------------------------
let factory;
try {
  factory = createMasterProcessor(pcof, sidecarClasses);
} catch (err) {
  console.error(`FAIL: createMasterProcessor threw: ${err.message}`);
  process.exit(1);
}

const { MasterProcessor, bufferCount, nodeCount } = factory;
const inst = new MasterProcessor(SR);

// Render BLOCKS blocks. First block gets the drive signal; subsequent blocks
// are silent so we see the envelope decay tail. Concatenate all outputs into
// one Float32Array and hash it.
const drive   = makeDriveBlock();
const silence = new Float32Array(N);
const rendered = new Float32Array(N * BLOCKS);
const outBlock = new Float32Array(N);

for (let b = 0; b < BLOCKS; b++) {
  const inBlock = (b === 0) ? drive : silence;
  inst.process(inBlock, outBlock, N);
  rendered.set(outBlock, b * N);
}

// Sanity: output must be finite.
let anyNaN = false;
for (let i = 0; i < rendered.length; i++) {
  if (!Number.isFinite(rendered[i])) { anyNaN = true; break; }
}
if (anyNaN) {
  console.error('FAIL: master-worklet output contains non-finite samples');
  process.exit(1);
}

// -------- hash --------------------------------------------------------------
const hasher = createHash('sha256');
hasher.update(Buffer.from(rendered.buffer, rendered.byteOffset, rendered.byteLength));
const hash = hasher.digest('hex');

const goldenPath = resolve(goldensDir, 'master-toy-comp.golden.json');
const payload = {
  graph: TOY_COMP.id,
  pcofVersion: PCOF_VERSION,
  sr: SR,
  n: N,
  blocks: BLOCKS,
  nodes: nodeCount,
  buffers: bufferCount,
  hash,
};

console.log(`\nMaster-worklet conformance — graph=${TOY_COMP.id} PCOF v${PCOF_VERSION}`);
console.log(`  nodes=${nodeCount} buffers=${bufferCount} blocks=${BLOCKS} samples=${N * BLOCKS}`);

if (BLESS || !existsSync(goldenPath)) {
  const verb = existsSync(goldenPath) ? 'blessed' : 'created';
  writeFileSync(goldenPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`  ${verb.toUpperCase()} → ${hash.slice(0, 16)}…`);
  console.log('\nRESULT: PASS\n');
  process.exit(0);
}

const stored = JSON.parse(readFileSync(goldenPath, 'utf8'));
if (stored.hash !== hash) {
  console.error(`\nFAIL: hash mismatch`);
  console.error(`  stored=${stored.hash.slice(0, 16)}…`);
  console.error(`  got   =${hash.slice(0, 16)}…`);
  console.error(`\n  Re-bless with: node scripts/check_master_worklet.mjs --bless`);
  console.error(`  (only if the math change is intentional — see memory/codegen_design.md)\n`);
  process.exit(1);
}

console.log(`  PASS: matches ${hash.slice(0, 16)}…`);
console.log('\nRESULT: PASS\n');
