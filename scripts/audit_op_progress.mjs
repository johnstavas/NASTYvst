#!/usr/bin/env node
// audit_op_progress.mjs — scan every op slot and show 7-gate progress.
//
// Output: a row per op showing which gates are green vs. red. Truth is
// derived from disk + harness fixtures, NOT from the catalog's self-reported
// status (so we can rebuild the catalog from ground truth).
//
// Gates:
//   1. Worklet  — op_<id>.worklet.js exists AND has real code (not stub)
//   2. C++      — op_<id>.cpp.jinja exists AND has real code (not stub)
//   3. Smoke    — test/fixtures/codegen/smoke_<id>.graph.json exists
//   4. T1-T7    — implied by ✓3 (smoke graph builds and passes sweep — proxy: file exists for now)
//   5. T8       — id (or alias) is in test/fixtures/parity/per_op_specs.json
//   6. T8-B     — id appears in any src/sandbox/behavioral/specs/*.mjs spec bank
//   7. Listen   — manual; not auto-detected (printed as ?)
//
// Usage:  node scripts/audit_op_progress.mjs              # all ops
//         node scripts/audit_op_progress.mjs --gold       # only fully-green
//         node scripts/audit_op_progress.mjs --csv        # machine output

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

const repoRoot = resolve('.');
const opsDir   = resolve(repoRoot, 'src', 'sandbox', 'ops');
const codegenFx = resolve(repoRoot, 'test', 'fixtures', 'codegen');
const paritySpecPath = resolve(repoRoot, 'test', 'fixtures', 'parity', 'per_op_specs.json');
const specsDir = resolve(repoRoot, 'src', 'sandbox', 'behavioral', 'specs');

// Discover all op ids from worklets on disk.
const workletFiles = readdirSync(opsDir).filter(f => /^op_.+\.worklet\.js$/.test(f));
const opIds = workletFiles.map(f => f.replace(/^op_/, '').replace(/\.worklet\.js$/, '')).sort();

// Load parity registry.
const parity = JSON.parse(readFileSync(paritySpecPath, 'utf8'));
const parityKeys = new Set(Object.keys(parity.ops || {}));

// Load all behavioral spec files and collect known op ids.
const behavioralIds = new Set();
for (const f of readdirSync(specsDir)) {
  if (!f.endsWith('.mjs')) continue;
  const src = readFileSync(resolve(specsDir, f), 'utf8');
  // Match top-level keys: `  someOp: {`
  const matches = src.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\{/gm) || [];
  for (const m of matches) {
    const name = m.replace(/[\s:{]/g, '');
    if (name && !/^_/.test(name)) behavioralIds.add(name);
  }
}

// Heuristic: is a worklet/cpp file a real port or a stub?
function isStub(src) {
  // Strip comments to avoid false negatives where stub-warning lives in a comment.
  const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Stubs typically have an empty inner loop or zero-fill output with TODO.
  if (/for\s*\([^)]+\)\s*\{?\s*out(?:Ch)?\[i\]\s*=\s*0(?:\.0f)?\s*;\s*\}?/.test(stripped)
      && /TODO/i.test(src)) return true;
  // Trivial-process pattern: { for(...) out[i]=0.0f; } AND nothing else of substance.
  const procMatch = stripped.match(/process\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
  if (procMatch) {
    const body = procMatch[1];
    if (/TODO/i.test(src) && body.replace(/\s+/g, '').length < 120
        && /=\s*0(\.0f?)?/.test(body)) return true;
  }
  return false;
}

const args = new Set(process.argv.slice(2));
const ONLY_GOLD = args.has('--gold');
const CSV       = args.has('--csv');

const rows = [];

for (const id of opIds) {
  const wPath = resolve(opsDir, `op_${id}.worklet.js`);
  const cPath = resolve(opsDir, `op_${id}.cpp.jinja`);
  const sPath = resolve(codegenFx, `smoke_${id.toLowerCase()}.graph.json`);

  const wSrc = existsSync(wPath) ? readFileSync(wPath, 'utf8') : '';
  const cSrc = existsSync(cPath) ? readFileSync(cPath, 'utf8') : '';

  const g1_worklet  = wSrc.length > 100 && !isStub(wSrc);
  const g2_cpp      = cSrc.length > 100 && !isStub(cSrc);
  const g3_smoke    = existsSync(sPath);
  const g4_t1t7     = g3_smoke;   // proxy: if smoke graph exists, sweep is presumed runnable
  // Parity: id may have variant aliases in the registry (e.g. onePole_lp / onePole_hp).
  // Treat any key starting with `${id}` or matching `${id}_*` as covering this op.
  let g5_parity = parityKeys.has(id);
  if (!g5_parity) {
    for (const k of parityKeys) {
      if (k === id || k.startsWith(`${id}_`)) { g5_parity = true; break; }
    }
  }
  const g6_behavioral = behavioralIds.has(id);
  const g7_listen     = false;    // can't auto-detect; user-only

  const passed = [g1_worklet, g2_cpp, g3_smoke, g4_t1t7, g5_parity, g6_behavioral].filter(Boolean).length;
  const total  = 6;     // gate 7 is excluded from auto-count
  const isGold = passed === total;

  rows.push({
    id, g1_worklet, g2_cpp, g3_smoke, g4_t1t7, g5_parity, g6_behavioral, passed, total, isGold,
  });
}

if (ONLY_GOLD) {
  const gold = rows.filter(r => r.isGold);
  console.log(`Gold ops (6/6 auto-gates green, listen sign-off pending): ${gold.length}\n`);
  for (const r of gold) console.log(`  ${r.id}`);
  process.exit(0);
}

if (CSV) {
  console.log('op,worklet,cpp,smoke,t1_t7,t8_parity,t8b_behavioral,passed_of_6');
  for (const r of rows) {
    console.log([r.id, r.g1_worklet, r.g2_cpp, r.g3_smoke, r.g4_t1t7, r.g5_parity, r.g6_behavioral, r.passed].join(','));
  }
  process.exit(0);
}

// Pretty table.
const tick = b => b ? '✓' : '·';
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`Op progress audit — ${rows.length} ops scanned\n`);
console.log(`Gate legend: 1.Worklet  2.C++  3.Smoke  4.T1–T7  5.T8 parity  6.T8-B behavioral  (Gate 7 = listen sign-off, manual)\n`);
console.log(`${pad('OP', 22)}  W  C  S  T  P  B  | passed`);
console.log('─'.repeat(60));
for (const r of rows) {
  console.log(`${pad(r.id, 22)}  ${tick(r.g1_worklet)}  ${tick(r.g2_cpp)}  ${tick(r.g3_smoke)}  ${tick(r.g4_t1t7)}  ${tick(r.g5_parity)}  ${tick(r.g6_behavioral)}  | ${r.passed}/6`);
}

// Histogram.
const hist = [0, 0, 0, 0, 0, 0, 0];
for (const r of rows) hist[r.passed]++;
console.log('\nPassed-count distribution:');
for (let i = 6; i >= 0; i--) {
  const bar = '█'.repeat(hist[i]);
  console.log(`  ${i}/6  ${pad(hist[i], 4)} ${bar}`);
}
const gold = rows.filter(r => r.isGold).length;
console.log(`\n${gold} ops are 6/6 green (listen sign-off still required for true ✅+P+✓).`);
