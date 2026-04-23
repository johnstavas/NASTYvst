// Master-worklet emitter ⇄ factory parity harness.
//
// Stage-3 step 5 of codegen bring-up (memory/codegen_design.md § 3-a).
//
// Asserts that the emitted source from emitMasterWorklet.js, when evaluated
// under a mock AudioWorkletGlobalScope, produces the *same* output as the
// in-memory factory createMasterProcessor.js for TOY_COMP under the same
// drive signal. They must agree bit-for-bit — they implement the same
// render algorithm, one as a factory (for Node tests / debugging), one as
// a self-contained worklet string (for browser addModule). Any drift =
// one of them is wrong.
//
// This harness also re-verifies the shared master-toy-comp.golden.json
// hash — so a single pin covers: factory output, emitter output, and any
// op sidecar math change propagating through either.
//
// Run:  node scripts/check_master_emit_parity.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const repoRoot    = resolve(__dirname, '..');
const sandboxDir  = resolve(repoRoot, 'src', 'sandbox');
const opsDir      = resolve(sandboxDir, 'ops');
const goldensDir  = resolve(repoRoot, 'scripts', 'goldens');
const tmpDir      = resolve(repoRoot, 'node_modules', '.sandbox-emit-harness');

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

// -------- copy sources (factory path) --------------------------------------
function copyRewrite(fname, srcDir, rewrites = []) {
  let src = readFileSync(resolve(srcDir, fname), 'utf8');
  for (const [re, to] of rewrites) src = src.replace(re, to);
  writeFileSync(resolve(tmpDir, fname), src);
}

copyRewrite('opRegistry.js',     sandboxDir);
copyRewrite('validateGraph.js',  sandboxDir, [[/from '\.\/opRegistry'/g, "from './opRegistry.js'"]]);
copyRewrite('buildPCOF.js',      sandboxDir, [
  [/from '\.\/opRegistry'/g,    "from './opRegistry.js'"],
  [/from '\.\/validateGraph'/g, "from './validateGraph.js'"],
]);
copyRewrite('createMasterProcessor.js', sandboxDir);
copyRewrite('emitMasterWorklet.js',     sandboxDir);

const mockSrc = readFileSync(resolve(sandboxDir, 'mockGraphs.js'), 'utf8')
  .replace(/from '\.\/validateGraph'/g, "from './validateGraph.js'")
  .replace(/\/\/ --- Dev-time conformance check[\s\S]*$/m, '');
writeFileSync(resolve(tmpDir, 'mockGraphs.js'), mockSrc);

const OP_IDS = ['gain', 'filter', 'detector', 'envelope', 'gainComputer', 'mix'];
for (const id of OP_IDS) {
  copyFileSync(resolve(opsDir, `op_${id}.worklet.js`), resolve(tmpDir, `op_${id}.worklet.js`));
}

// -------- load factory-side modules ----------------------------------------
const { buildPCOF }                 = await import(pathToFileURL(resolve(tmpDir, 'buildPCOF.js')).href);
const { createMasterProcessor }     = await import(pathToFileURL(resolve(tmpDir, 'createMasterProcessor.js')).href);
const { emitMasterWorklet }         = await import(pathToFileURL(resolve(tmpDir, 'emitMasterWorklet.js')).href);
const { MOCK_GRAPHS_BY_BRICK_TYPE } = await import(pathToFileURL(resolve(tmpDir, 'mockGraphs.js')).href);

const sidecarClasses = {};
const sidecarSources = {};
for (const id of OP_IDS) {
  sidecarSources[id] = readFileSync(resolve(opsDir, `op_${id}.worklet.js`), 'utf8');
  const mod = await import(pathToFileURL(resolve(tmpDir, `op_${id}.worklet.js`)).href);
  const exports = Object.values(mod).filter(v => typeof v === 'function');
  sidecarClasses[id] = exports[0];
}

// -------- fixtures ---------------------------------------------------------
const SR = 48000;
const N  = 128;
const BLOCKS = 8;

function makeDriveBlock() {
  const buf = new Float32Array(N);
  for (let i = 0; i < 96; i++) buf[i] = Math.sin(2 * Math.PI * (i * i) / 96 / 2) * 0.5;
  buf[100] = 0.9;
  return buf;
}

// -------- build PCOF -------------------------------------------------------
const TOY_COMP = MOCK_GRAPHS_BY_BRICK_TYPE.toyComp;
const pcof = buildPCOF(TOY_COMP);
pcof.graphId = TOY_COMP.id;  // emitter uses this for the processor name

// -------- render path A: factory -------------------------------------------
function renderFactory() {
  const { MasterProcessor } = createMasterProcessor(pcof, sidecarClasses);
  const inst = new MasterProcessor(SR);
  const drive   = makeDriveBlock();
  const silence = new Float32Array(N);
  const rendered = new Float32Array(N * BLOCKS);
  const outBlock = new Float32Array(N);
  for (let b = 0; b < BLOCKS; b++) {
    inst.process((b === 0) ? drive : silence, outBlock, N);
    rendered.set(outBlock, b * N);
  }
  return rendered;
}

// -------- render path B: emitted worklet under mock global scope -----------
// The emitted source is a script body that references `AudioWorkletProcessor`,
// `sampleRate`, and `registerProcessor` as globals. We pass those in via
// `new Function(...)` closure scope, mirroring how a real AudioWorkletGlobalScope
// would resolve them.
function renderEmitted() {
  const source = emitMasterWorklet({
    pcof,
    sidecarSources,
    processorName: `master-${TOY_COMP.id}`,
  });

  // Mock AudioWorkletProcessor — matches the minimal surface the emitted
  // class actually touches (port.onmessage setter, super() in constructor).
  class MockAWP {
    constructor() {
      this.port = { onmessage: null, postMessage: () => {} };
    }
  }

  let captured = null;
  function mockRegister(name, cls) {
    if (captured) throw new Error('emitted source called registerProcessor more than once');
    captured = { name, cls };
  }

  // eslint-disable-next-line no-new-func
  const evalFn = new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', source);
  evalFn(MockAWP, SR, mockRegister);

  if (!captured) throw new Error('emitted source did not call registerProcessor');
  if (captured.name !== `master-${TOY_COMP.id}`) {
    throw new Error(`registered processor name mismatch: ${captured.name}`);
  }

  const inst = new captured.cls();
  const drive   = makeDriveBlock();
  const silence = new Float32Array(N);
  const rendered = new Float32Array(N * BLOCKS);
  // AudioWorkletProcessor signature: inputs = [[ch0], …], outputs = [[ch0], …]
  for (let b = 0; b < BLOCKS; b++) {
    const inCh = (b === 0) ? drive : silence;
    const outCh = new Float32Array(N);
    inst.process([[inCh]], [[outCh]], {});
    rendered.set(outCh, b * N);
  }
  return rendered;
}

// -------- parity check -----------------------------------------------------
function hash(buf) {
  const h = createHash('sha256');
  h.update(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
  return h.digest('hex');
}

console.log(`\nMaster-worklet emitter parity — graph=${TOY_COMP.id}`);

const aBuf = renderFactory();
const bBuf = renderEmitted();

const aHash = hash(aBuf);
const bHash = hash(bBuf);

console.log(`  factory hash:  ${aHash.slice(0, 16)}…`);
console.log(`  emitted hash:  ${bHash.slice(0, 16)}…`);

let fail = false;

if (aHash !== bHash) {
  console.error(`\nFAIL: factory and emitted outputs differ`);
  // Find first divergent sample for diagnostics
  let div = -1;
  for (let i = 0; i < aBuf.length; i++) {
    if (aBuf[i] !== bBuf[i]) { div = i; break; }
  }
  if (div >= 0) {
    console.error(`  first diverge at sample ${div}: factory=${aBuf[div]} emitted=${bBuf[div]}`);
  }
  fail = true;
}

// Also verify emitter output matches the pinned master-toy-comp.golden.json.
const goldenPath = resolve(goldensDir, 'master-toy-comp.golden.json');
if (existsSync(goldenPath)) {
  const stored = JSON.parse(readFileSync(goldenPath, 'utf8'));
  if (stored.hash !== bHash) {
    console.error(`\nFAIL: emitted hash does not match master-toy-comp.golden.json`);
    console.error(`  stored=${stored.hash.slice(0, 16)}…  got=${bHash.slice(0, 16)}…`);
    console.error(`  Re-bless the master golden via: node scripts/check_master_worklet.mjs --bless`);
    fail = true;
  } else {
    console.log(`  golden match: ${bHash.slice(0, 16)}… ✓`);
  }
} else {
  console.log(`  golden not yet pinned — run qc:master first`);
}

if (fail) {
  console.error('\nRESULT: FAIL\n');
  process.exit(1);
}
console.log('\nRESULT: PASS — factory ≡ emitted ≡ golden\n');
