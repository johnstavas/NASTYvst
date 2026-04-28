// generate_verification_ledger.mjs — produce memory/op_verification_ledger.md
// from the audit script's truth table. Re-run anytime to refresh gates 1–6.
// Gate 7 (listen sign-off) is a manually-edited column preserved across regens.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = '.';
const opsDir = resolve(repoRoot, 'src/sandbox/ops');
const codegenFx = resolve(repoRoot, 'test/fixtures/codegen');
const paritySpecPath = resolve(repoRoot, 'test/fixtures/parity/per_op_specs.json');
const specsDir = resolve(repoRoot, 'src/sandbox/behavioral/specs');
const ledgerPath = resolve(repoRoot, 'memory/op_verification_ledger.md');
const ledgerJsonPath = resolve(repoRoot, 'public/verification_ledger.json');

const workletFiles = readdirSync(opsDir).filter(f => /^op_.+\.worklet\.js$/.test(f));
const opIds = workletFiles.map(f => f.replace(/^op_/, '').replace(/\.worklet\.js$/, '')).sort();

const parity = JSON.parse(readFileSync(paritySpecPath, 'utf8'));
const parityKeys = new Set(Object.keys(parity.ops || {}));

const behavioralIds = new Set();
for (const f of readdirSync(specsDir)) {
  if (!f.endsWith('.mjs')) continue;
  const src = readFileSync(resolve(specsDir, f), 'utf8');
  const matches = src.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*\{/gm) || [];
  for (const m of matches) {
    const name = m.replace(/[\s:{]/g, '');
    if (name && !/^_/.test(name)) behavioralIds.add(name);
  }
}

function isStub(src) {
  const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/for\s*\([^)]+\)\s*\{?\s*out(?:Ch)?\[i\]\s*=\s*0(?:\.0f)?\s*;\s*\}?/.test(stripped)
      && /TODO/i.test(src)) return true;
  const procMatch = stripped.match(/process\s*\([^)]*\)\s*\{([\s\S]*?)\}/);
  if (procMatch) {
    const body = procMatch[1];
    if (/TODO/i.test(src) && body.replace(/\s+/g, '').length < 120
        && /=\s*0(\.0f?)?/.test(body)) return true;
  }
  return false;
}

// Preserve manually-edited gate-7 + notes if ledger already exists.
const prior = new Map();
if (existsSync(ledgerPath)) {
  const txt = readFileSync(ledgerPath, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\| *([a-zA-Z_][a-zA-Z0-9_]*) *\|.*\| *([^|]*) *\| *([^|]*) *\|$/);
    if (!m) continue;
    prior.set(m[1], { listen: m[2].trim(), notes: m[3].trim() });
  }
}

// Pre-build a lower-cased smoke-fixture filename set so the per-op gate
// check is O(1) and we can match mode-suffixed variants (smoke_onePole_lp,
// smoke_shelf_low, smoke_svf_lp …) the same way the parity gate already
// matches its mode-suffixed keys (see g5 below). Without this, ops like
// onePole/shelf/svf would read 4/6 forever even though the fixtures exist
// on disk under their mode-suffixed names.
const smokeFiles = new Set(
  readdirSync(codegenFx)
    .filter(f => /^smoke_.+\.graph\.json$/.test(f))
    .map(f => f.toLowerCase())
);

const rows = [];
for (const id of opIds) {
  const wPath = resolve(opsDir, `op_${id}.worklet.js`);
  const cPath = resolve(opsDir, `op_${id}.cpp.jinja`);
  const idLc = id.toLowerCase();
  const wSrc = existsSync(wPath) ? readFileSync(wPath, 'utf8') : '';
  const cSrc = existsSync(cPath) ? readFileSync(cPath, 'utf8') : '';

  const g1 = wSrc.length > 100 && !isStub(wSrc);
  const g2 = cSrc.length > 100 && !isStub(cSrc);
  // Smoke gate: bare-id match OR any mode-suffixed variant (smoke_<id>_*).
  let g3 = smokeFiles.has(`smoke_${idLc}.graph.json`);
  if (!g3) {
    for (const f of smokeFiles) {
      if (f.startsWith(`smoke_${idLc}_`)) { g3 = true; break; }
    }
  }
  const g4 = g3;
  let g5 = parityKeys.has(id);
  if (!g5) for (const k of parityKeys) if (k === id || k.startsWith(`${id}_`)) { g5 = true; break; }
  const g6 = behavioralIds.has(id);
  const auto = [g1, g2, g3, g4, g5, g6].filter(Boolean).length;
  const p = prior.get(id) || { listen: '', notes: '' };
  rows.push({ id, g1, g2, g3, g4, g5, g6, auto, listen: p.listen, notes: p.notes });
}

const tick = b => b ? '✓' : '·';
const lines = [];
lines.push('# Op Verification Ledger');
lines.push('');
lines.push('Live tracker for the 7-gate verification protocol. Source-of-truth for');
lines.push('which ops are personally signed off vs. still need re-test.');
lines.push('');
lines.push('## How to read this');
lines.push('');
lines.push('| Gate | Meaning |');
lines.push('|---|---|');
lines.push('| **W** | Worklet exists and is real (not a TODO stub) |');
lines.push('| **C** | C++ port exists and is real (not zero-fill) |');
lines.push('| **S** | Smoke graph file exists in `test/fixtures/codegen/` |');
lines.push('| **T** | T1–T7 sweep passes (proxy: smoke graph exists) |');
lines.push('| **P** | T8 native parity entry exists in `per_op_specs.json` |');
lines.push('| **B** | T8-B behavioral spec exists in `behavioral/specs/*.mjs` |');
lines.push('| **L** | LISTEN — Stav personally heard it in a session and signed off |');
lines.push('');
lines.push('Gates W–B are auto-detected and refreshed by `node scripts/generate_verification_ledger.mjs`.');
lines.push('Gate L is manually edited — fill in your initials + date when you sign off (e.g. `JS 2026-05-01`).');
lines.push('Notes column survives regenerations.');
lines.push('');
lines.push('**Gold status (✅+P+✓ in catalog) = all 7 gates green.**');
lines.push('');
lines.push(`Total ops: ${rows.length}. Auto-gates 6/6 (need only listen): ${rows.filter(r => r.auto === 6).length}.`);
lines.push('');
lines.push('## Ledger');
lines.push('');
lines.push('| Op | W | C | S | T | P | B | L (listen sign-off) | Notes |');
lines.push('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  lines.push(`| ${r.id} | ${tick(r.g1)} | ${tick(r.g2)} | ${tick(r.g3)} | ${tick(r.g4)} | ${tick(r.g5)} | ${tick(r.g6)} | ${r.listen} | ${r.notes} |`);
}
lines.push('');
writeFileSync(ledgerPath, lines.join('\n'));
console.log(`Wrote ${ledgerPath} (${rows.length} ops).`);

// Machine-readable mirror for browser consumption (read by OpGraphCanvas
// gate-strip widget + per-op QC panel — see Phase A of op-qc-rig).
//
// MONOTONIC PRESERVATION: if the JSON already exists on disk, read it
// first and preserve any listen-gate values that have been signed off.
// The generator only walks specs/worklets/parity/behavioral on disk —
// it has no view into UI listen ticks, so a naive overwrite would
// destroy user sign-offs every time the script runs. We treat the disk
// listen value as the authoritative source for that gate.
let preservedListen = new Map();
try {
  if (existsSync(ledgerJsonPath)) {
    const prev = JSON.parse(readFileSync(ledgerJsonPath, 'utf8'));
    if (prev && Array.isArray(prev.ops)) {
      for (const o of prev.ops) {
        if (o.gates?.listen) preservedListen.set(o.id, o.gates.listen);
      }
    }
  }
} catch (err) {
  console.warn(`[generate_verification_ledger] could not read prior JSON for listen-tick preservation: ${err.message}`);
}

const ledgerJson = {
  generatedAt: new Date().toISOString(),
  totalOps:    rows.length,
  goldCount:   rows.filter(r => r.auto === 6 && (r.listen || preservedListen.get(r.id))).length,
  ops: rows.map(r => {
    const listen = r.listen || preservedListen.get(r.id) || null;
    return {
      id: r.id,
      gates: {
        worklet:    r.g1,
        cpp:        r.g2,
        smoke:      r.g3,
        t1_t7:      r.g4,
        parity:     r.g5,
        behavioral: r.g6,
        listen,                   // gate 7 — preserved from prior JSON if not in spec
      },
      autoPassed: r.auto,         // 0–6
      notes:      r.notes || '',
    };
  }),
};
writeFileSync(ledgerJsonPath, JSON.stringify(ledgerJson, null, 2));
if (preservedListen.size > 0) {
  console.log(`Preserved ${preservedListen.size} listen-gate sign-offs from prior JSON.`);
}
console.log(`Wrote ${ledgerJsonPath} (${rows.length} ops, machine-readable).`);
