// Deep T6 validation on every real brick graph.
//
// Uses the same copy-to-tmp-dir trick as check_t6_rules.mjs to sidestep
// the sandbox's CJS/ESM interop issue. Loads validateGraph, opRegistry,
// and mockGraphs into an ESM-typed tmp dir and runs validateGraph()
// against every graph in MOCK_GRAPHS_BY_BRICK_TYPE.
//
// Run:
//   node scripts/check_all_graphs_deep.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const sandboxDir = resolve(__dirname, '..', 'src', 'sandbox');
const tmpDir     = resolve(__dirname, '..', 'node_modules', '.sandbox-deep-harness');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

function copyRewrite(fname, rewrites = []) {
  let src = readFileSync(resolve(sandboxDir, fname), 'utf8');
  for (const [re, to] of rewrites) src = src.replace(re, to);
  writeFileSync(resolve(tmpDir, fname), src);
}

copyRewrite('opRegistry.js');
copyRewrite('validateGraph.js', [[/from '\.\/opRegistry'/g, "from './opRegistry.js'"]]);

// mockGraphs.js: rewrite bare imports + strip the module-bottom auto-run
// validateGraphLoud side-effect (we'll run validation ourselves).
const mockSrc = readFileSync(resolve(sandboxDir, 'mockGraphs.js'), 'utf8')
  .replace(/from '\.\/validateGraph'/g, "from './validateGraph.js'")
  // Strip the bottom for-loop that logs during module load — we only want
  // the graph exports, validation runs below.
  .replace(/\/\/ --- Dev-time conformance check[\s\S]*$/m, '');
writeFileSync(resolve(tmpDir, 'mockGraphs.js'), mockSrc);

const { validateGraph, SCHEMA_VERSION } = await import(pathToFileURL(resolve(tmpDir, 'validateGraph.js')).href);
const { MOCK_GRAPHS_BY_BRICK_TYPE }     = await import(pathToFileURL(resolve(tmpDir, 'mockGraphs.js')).href);

console.log(`\nDeep T6 validation — IR schema v${SCHEMA_VERSION}\n`);

let hadFailure = false;
let warningCount = 0;

for (const [brickType, graph] of Object.entries(MOCK_GRAPHS_BY_BRICK_TYPE)) {
  const r = validateGraph(graph);
  const tag = r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${brickType.padEnd(14)}  id=${graph.id}`);
  if (!r.ok) {
    hadFailure = true;
    for (const e of r.errors)  console.log(`         ERROR: ${e}`);
  }
  for (const w of r.warnings) { console.log(`         WARN:  ${w}`); warningCount++; }
}

console.log('');
if (hadFailure) {
  console.log('RESULT: FAIL — at least one graph has deep-validation errors\n');
  process.exit(1);
} else {
  console.log(`RESULT: PASS — all 8 graphs pass deep T6 validation (${warningCount} warning${warningCount === 1 ? '' : 's'})\n`);
}
