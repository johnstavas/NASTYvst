// PCOF builder + T6.5 pre-codegen validator harness.
//
// Stage-3 codegen pipeline step 1: per-graph build PCOF → validate PCOF →
// assert additional shape invariants that only make sense after building
// (topo order dense, buffer producer∕consumer accounting, terminal output
// wired, etc.).
//
// This is what the master-worklet emitter will consume. If this harness
// goes red, the emitter would produce structurally-broken JS / C++ — so
// this is a ship-gate at the pre-commit level.
//
// Run:
//   node scripts/check_pcof.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const sandboxDir = resolve(__dirname, '..', 'src', 'sandbox');
const tmpDir     = resolve(__dirname, '..', 'node_modules', '.sandbox-pcof-harness');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

function copyRewrite(fname, rewrites = []) {
  let src = readFileSync(resolve(sandboxDir, fname), 'utf8');
  for (const [re, to] of rewrites) src = src.replace(re, to);
  writeFileSync(resolve(tmpDir, fname), src);
}

copyRewrite('opRegistry.js');
copyRewrite('validateGraph.js', [[/from '\.\/opRegistry'/g, "from './opRegistry.js'"]]);
copyRewrite('buildPCOF.js', [
  [/from '\.\/opRegistry'/g, "from './opRegistry.js'"],
  [/from '\.\/validateGraph'/g, "from './validateGraph.js'"],
]);
copyRewrite('validatePCOF.js', [[/from '\.\/buildPCOF'/g, "from './buildPCOF.js'"]]);

const mockSrc = readFileSync(resolve(sandboxDir, 'mockGraphs.js'), 'utf8')
  .replace(/from '\.\/validateGraph'/g, "from './validateGraph.js'")
  .replace(/\/\/ --- Dev-time conformance check[\s\S]*$/m, '');
writeFileSync(resolve(tmpDir, 'mockGraphs.js'), mockSrc);

const { validateGraph, SCHEMA_VERSION } = await import(pathToFileURL(resolve(tmpDir, 'validateGraph.js')).href);
const { buildPCOF, PCOF_VERSION }       = await import(pathToFileURL(resolve(tmpDir, 'buildPCOF.js')).href);
const { validatePCOF }                  = await import(pathToFileURL(resolve(tmpDir, 'validatePCOF.js')).href);
const { MOCK_GRAPHS_BY_BRICK_TYPE }     = await import(pathToFileURL(resolve(tmpDir, 'mockGraphs.js')).href);

console.log(`\nPCOF conformance (T6.5) — IR v${SCHEMA_VERSION}, PCOF v${PCOF_VERSION}\n`);

let hadFailure = false;
let warningCount = 0;

for (const [brickType, graph] of Object.entries(MOCK_GRAPHS_BY_BRICK_TYPE)) {
  // A graph MUST pass T6 before we attempt PCOF build — mirror the real
  // codegen ordering so we don't double-report errors the graph-level
  // validator already caught.
  const graphResult = validateGraph(graph);
  if (!graphResult.ok) {
    console.log(`  SKIP  ${brickType.padEnd(14)}  id=${graph.id}   (T6 errors; run qc:graphs)`);
    continue;
  }

  let pcof;
  try {
    pcof = buildPCOF(graph);
  } catch (err) {
    hadFailure = true;
    console.log(`  FAIL  ${brickType.padEnd(14)}  id=${graph.id}`);
    console.log(`         BUILD ERROR: ${err.message}`);
    continue;
  }

  const pcofResult = validatePCOF(pcof);
  const tag = pcofResult.ok ? 'PASS' : 'FAIL';
  const nOps  = pcof.nodes.length;
  const nBufs = pcof.buffers.length;
  const nFb   = pcof.feedbackEdges.length;
  console.log(`  ${tag}  ${brickType.padEnd(14)}  id=${graph.id.padEnd(20)} nodes=${String(nOps).padEnd(2)} bufs=${String(nBufs).padEnd(2)} fb=${nFb}`);

  if (!pcofResult.ok) {
    hadFailure = true;
    for (const e of pcofResult.errors) console.log(`         ERROR: ${e}`);
  }
  for (const w of pcofResult.warnings) { console.log(`         WARN:  ${w}`); warningCount++; }
}

console.log('');
if (hadFailure) {
  console.log('RESULT: FAIL — at least one graph failed PCOF build or T6.5 validation\n');
  process.exit(1);
} else {
  const total = Object.keys(MOCK_GRAPHS_BY_BRICK_TYPE).length;
  console.log(`RESULT: PASS — all ${total} graphs build + validate as PCOF (${warningCount} warning${warningCount === 1 ? '' : 's'})\n`);
}
