// Op math harness — runs real math assertions from op_<id>.test.js sidecars.
//
// Stage-3 step 1 of codegen bring-up. Complements check_op_goldens.mjs:
//   goldens: hash stability of a fixed drive buffer (regression guard)
//   math:    author-written assertions (intent + correctness guard)
//
// Contract: each op_<id>.test.js exports default { opId, tests: [{ name, run }] }.
// `run()` returns { pass: bool, why?: string }. Tests import the sidecar
// class directly, so they run in the same ESM context as the harness.
//
// Run: node scripts/check_op_math.mjs

import { readdirSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..');
const opsDir    = resolve(repoRoot, 'src', 'sandbox', 'ops');
const tmpDir    = resolve(repoRoot, 'node_modules', '.sandbox-ops-math-harness');

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
writeFileSync(resolve(tmpDir, 'package.json'), '{ "type": "module" }\n');

// Discover all op_*.test.js files, copy them + their sidecar into tmp.
const testFiles = readdirSync(opsDir).filter(f => /^op_.+\.test\.js$/.test(f));

for (const tf of testFiles) {
  copyFileSync(resolve(opsDir, tf), resolve(tmpDir, tf));
  const sidecar = tf.replace('.test.js', '.worklet.js');
  copyFileSync(resolve(opsDir, sidecar), resolve(tmpDir, sidecar));
}

const results = [];
let total = 0, fails = 0;

for (const tf of testFiles) {
  const mod = await import(pathToFileURL(resolve(tmpDir, tf)).href);
  const suite = mod.default;
  if (!suite || !Array.isArray(suite.tests)) {
    results.push({ pass: false, name: `${tf}: no default export { opId, tests }` });
    fails++; total++;
    continue;
  }
  for (const t of suite.tests) {
    total++;
    let r;
    try { r = t.run(); } catch (e) { r = { pass: false, why: e.message }; }
    const label = `${suite.opId} · ${t.name}`;
    if (!r.pass) { fails++; results.push({ pass: false, name: label, why: r.why }); }
    else         { results.push({ pass: true,  name: label }); }
  }
}

console.log(`\nOp math — real-math assertions\n`);
for (const r of results) {
  console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  if (!r.pass) console.log(`        ${r.why}`);
}
console.log('');
if (fails) {
  console.log(`RESULT: FAIL — ${fails} of ${total} checks failed\n`);
  process.exit(1);
} else {
  console.log(`RESULT: PASS — all ${total} checks clean\n`);
}
