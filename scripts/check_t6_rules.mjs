// T6 validator rule negative-test harness.
//
// Why standalone: the sandbox modules import from '../opRegistry' (no
// extension) which Node ESM can't resolve in a CJS-default project. This
// script text-loads validateGraph.js + opRegistry.js, rewrites the bare
// import to a data-URL of the registry's exported surface, and runs the
// validator against synthetic bad-fixture graphs to confirm every new
// T6 rule actually fires.
//
// Not a substitute for browser-time validateGraphLoud() — which runs the
// same rules on real graphs at module load. This harness ONLY proves
// the rule bodies themselves reject what they claim to reject.
//
// Run:
//   node scripts/check_t6_rules.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname   = dirname(fileURLToPath(import.meta.url));
const sandboxDir  = resolve(__dirname, '..', 'src', 'sandbox');
const tmpDir      = resolve(__dirname, '..', 'node_modules', '.sandbox-t6-harness');
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
// node_modules has "type":"commonjs" by default from the root package.json —
// add a local package.json declaring "type":"module" so .js files in this
// tmp dir are loaded as ESM.
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

// Copy opRegistry + validateGraph into tmpDir, rewriting the bare import.
const opRegistrySrc = readFileSync(resolve(sandboxDir, 'opRegistry.js'), 'utf8');
const validatorSrc  = readFileSync(resolve(sandboxDir, 'validateGraph.js'), 'utf8')
  .replace(/from '\.\/opRegistry'/g, "from './opRegistry.js'");

writeFileSync(resolve(tmpDir, 'opRegistry.js'),   opRegistrySrc);
writeFileSync(resolve(tmpDir, 'validateGraph.js'), validatorSrc);

const { validateGraph, SCHEMA_VERSION } = await import(pathToFileURL(resolve(tmpDir, 'validateGraph.js')).href);

// -------- test fixture helpers --------------------------------------------
const base = () => ({
  schemaVersion: SCHEMA_VERSION,
  id: 'test',
  terminals: [
    { id: 'in',  kind: 'input'  },
    { id: 'out', kind: 'output' },
  ],
  nodes:    [],
  wires:    [],
  feedback: [],
});

const results = [];
function expect(name, graph, { errorContains, warningContains, shouldPass }) {
  const r = validateGraph(graph);
  let pass = true, reason = '';
  if (shouldPass) {
    if (!r.ok) { pass = false; reason = `expected ok, got errors: ${r.errors.join('; ')}`; }
  }
  if (errorContains) {
    const found = r.errors.some(e => e.includes(errorContains));
    if (!found) { pass = false; reason = `expected error matching "${errorContains}", got: ${r.errors.join(' / ')}`; }
  }
  if (warningContains) {
    const found = r.warnings.some(w => w.includes(warningContains));
    if (!found) { pass = false; reason = `expected warning matching "${warningContains}", got: ${r.warnings.join(' / ')}`; }
  }
  results.push({ name, pass, reason });
}

// -------- T6.TERMINALS_PRESENT --------------------------------------------
{
  const g = base(); g.terminals = [{ id: 'in', kind: 'input' }];
  expect('TERMINALS_PRESENT: missing output', g, { errorContains: 'no output terminal' });
}
{
  const g = base(); g.terminals = [{ id: 'out', kind: 'output' }];
  expect('TERMINALS_PRESENT: missing input', g, { errorContains: 'no input terminal' });
}

// -------- T6.ORPHAN_NODE --------------------------------------------------
{
  const g = base();
  g.nodes = [{ id: 'n_orphan', op: 'gain', params: { gainDb: 0 } }];
  g.wires = [{ from: 'in', to: 'out' }];
  expect('ORPHAN_NODE: warns on unwired node', g, { warningContains: 'has no wires' });
}

// -------- T6.FB_CYCLE_DECLARED --------------------------------------------
{
  // Two filters wired output→input and input→input (illegal cycle, no fb port)
  const g = base();
  g.nodes = [
    { id: 'n_a', op: 'filter', params: {} },
    { id: 'n_b', op: 'filter', params: {} },
  ];
  g.wires = [
    { from: 'in',  to: 'n_a' },
    { from: 'n_a', to: 'n_b' },
    { from: 'n_b', to: 'n_a' },  // back edge — cycle, but NOT through an fb port
    { from: 'n_b', to: 'out' },
  ];
  expect('FB_CYCLE_DECLARED: undeclared cycle errors', g, { errorContains: 'undeclared feedback cycle' });
}

// -------- T6.FB_DC_TRAP + T6.FB_SAFETY_NODE -------------------------------
{
  // Delay with fb wire but NO dcBlock or softLimit upstream
  const g = base();
  g.nodes = [
    { id: 'n_delay', op: 'delay', params: { time: 250, feedback: 0.5 } },
    { id: 'n_sat',   op: 'saturate', params: { drive: 1.0, trim: 0 } },
  ];
  g.wires = [
    { from: 'in',      to: 'n_delay' },
    { from: 'n_delay', to: 'n_sat' },
    { from: 'n_sat',   to: 'n_delay.fb' },  // fb path — missing guards
    { from: 'n_delay', to: 'out' },
  ];
  expect('FB_DC_TRAP: missing dcBlock on fb path', g, { errorContains: 'missing dcBlock' });
  expect('FB_SAFETY_NODE: missing softLimit on fb path', g, { errorContains: 'missing softLimit' });
}

// -------- positive case: fb path with both guards -------------------------
{
  const g = base();
  g.nodes = [
    { id: 'n_delay',   op: 'delay',    params: { time: 250, feedback: 0.5 } },
    { id: 'n_dcblock', op: 'dcBlock',  params: { cutoff: 10 } },
    { id: 'n_softlim', op: 'softLimit', params: { threshold: 0.95 } },
  ];
  g.wires = [
    { from: 'in',        to: 'n_delay' },
    { from: 'n_delay',   to: 'n_dcblock' },
    { from: 'n_dcblock', to: 'n_softlim' },
    { from: 'n_softlim', to: 'n_delay.fb' },
    { from: 'n_delay',   to: 'out' },
  ];
  expect('FB_SAFETY_NODE: positive case (dcBlock + softLimit present) passes', g, { shouldPass: true });
}

// -------- report ----------------------------------------------------------
console.log(`\nT6 validator rule negative-tests\n`);
let fails = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${r.name}`);
  if (!r.pass) {
    fails++;
    console.log(`         ${r.reason}`);
  }
}
console.log('');
if (fails) {
  console.log(`RESULT: FAIL — ${fails} of ${results.length} rule check(s) did not fire as expected\n`);
  process.exit(1);
} else {
  console.log(`RESULT: PASS — all ${results.length} T6 rule checks fired as expected\n`);
}
