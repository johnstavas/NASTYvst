// scripts/qc-preview-lofiloofy.mjs
//
// Dry-run preview: show which QC presets the harness will emit for
// Lofi Loofy (lofi_loofy/v1), organized by tier + rule. Uses the
// declared `capabilities` and `paramSchema` from lofiLoofyEngine.v1.js
// without constructing an AudioContext, so it runs in Node.
//
// Usage:  node scripts/qc-preview-lofiloofy.mjs
//
// To actually RUN the sweep (which requires OfflineAudioContext), open
// the QC harness UI in the browser and select lofi_loofy/v1.

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// NB: we import qcPresets directly; it's pure data over (capabilities, paramSchema).
// The engine factory path needs AudioContext, so we statically extract the
// two data blocks from lofiLoofyEngine.v1.js via a tiny regex parse.

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

const src = readFileSync(resolve(root, 'src/lofiLoofy/lofiLoofyEngine.v1.js'), 'utf8');

// Extract the `capabilities: { ... },` block (balanced braces).
function extractBlock(source, key) {
  const startRe = new RegExp(`\\b${key}:\\s*\\{`);
  const m = startRe.exec(source);
  if (!m) throw new Error(`could not find ${key}: { ... } in source`);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch; i++;
      while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i++; i++; }
    }
    i++;
  }
  return source.slice(m.index + m[0].length, i - 1);
}

// Use a real JS eval sandbox: wrap extracted text in an object literal and eval.
function evalBlock(text) {
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return ({${text}});`)();
}

// Extract paramSchema array similarly.
function extractArray(source, key) {
  const startRe = new RegExp(`\\b${key}:\\s*\\[`);
  const m = startRe.exec(source);
  if (!m) throw new Error(`could not find ${key}: [ ... ] in source`);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth--;
    else if (ch === '/' && source[i + 1] === '/') { while (i < source.length && source[i] !== '\n') i++; }
    else if (ch === '/' && source[i + 1] === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; continue; }
    else if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch; i++;
      while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i++; i++; }
    }
    i++;
  }
  return source.slice(m.index + m[0].length, i - 1);
}

const capsText = extractBlock(src, 'capabilities');
const capabilities = evalBlock(capsText);

// paramSchema references external identifiers (DREAM_TARGETS, LOFI_CHARACTERS)
// so evaluating it fully is messier. For the preview we only need the setter
// *names*, which we extract via regex.
const schemaText = extractArray(src, 'paramSchema');
const paramSchema = [...schemaText.matchAll(/name:\s*'([^']+)'/g)].map(m => ({ name: m[1] }));

// Import qcPresets — it's pure JS, no audio deps.
// qcPresets.js is shipped as .js without package.json "type":"module" so
// Node treats it as CJS. Re-import it as an ES module via data URL.
const qcPresetsText = readFileSync(resolve(root, 'src/qc-harness/qcPresets.js'), 'utf8');
const qcPresetsUrl = 'data:text/javascript;base64,' + Buffer.from(qcPresetsText).toString('base64');
const { generateQcPresets, summarizeQcPresets } = await import(qcPresetsUrl);

const engineStub = { capabilities, paramSchema };
const presets = generateQcPresets(engineStub, { includeLong: false });

console.log('─ Lofi Loofy v1 · QC preset preview ─');
console.log('capabilities.categories   :', capabilities.categories);
console.log('capabilities.subcategories:', capabilities.subcategories);
console.log('capability flags set      :',
  Object.entries(capabilities)
    .filter(([k, v]) => k.startsWith('has') && v)
    .map(([k]) => k).join(', ') || '(none)');
console.log();
const sum = summarizeQcPresets(presets);
console.log('Preset counts by tier:', sum);
console.log();

const byTier = { 1: [], 2: [], 3: [], 4: [] };
for (const p of presets) (byTier[p.tier] ||= []).push(p);

for (const tier of [1, 2, 3, 4]) {
  if (!byTier[tier].length) continue;
  console.log(`── Tier ${tier} (${byTier[tier].length} preset${byTier[tier].length === 1 ? '' : 's'}) ──`);
  for (const p of byTier[tier]) {
    console.log(`  ${p.ruleId.padEnd(28)}  ${p.label}`);
  }
  console.log();
}
