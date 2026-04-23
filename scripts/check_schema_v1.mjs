// IR schema v1.0 static-conformance check.
//
// Why this exists:
//   - mockGraphs.js already runs validateGraphLoud() on every graph at
//     browser module load, so deep param/port/reference validation shows
//     up in the dev console immediately.
//   - This script covers the CLI/CI layer: prove every graph in the
//     sandbox declares schemaVersion "1.0" + the minimum outer shape
//     (id / terminals / nodes / wires) without needing a browser or
//     the ESM-in-CJS interop dance that src/sandbox imports require.
//
// Limits: this is a static parse, not a DSP semantic check. It will not
// catch out-of-range params, wire endpoint typos, or port-kind mismatch —
// those fire at browser module load via validateGraphLoud.
//
// Run:
//   node scripts/check_schema_v1.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mockPath  = resolve(__dirname, '..', 'src', 'sandbox', 'mockGraphs.js');
const src       = readFileSync(mockPath, 'utf8');

const SCHEMA_VERSION = '1.0';

// Scan for top-level `export const <NAME> = {` graph definitions.
const re = /^export const ([A-Z_]+) = \{$/gm;
const starts = [];
for (const m of src.matchAll(re)) {
  starts.push({ name: m[1], offset: m.index });
}

// For each export, grab the block from `{` up to the matching `}` at indent 0.
function sliceBlock(start) {
  // Find the first `{` at or after the export-const line.
  const openIdx = src.indexOf('{', start);
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

const BRICK_EXPORTS = new Set([
  'ECHOFORM_MOCK', 'SANDBOX_TOY', 'FILTER_FX', 'ECHOFORM_LITE',
  'MOD_DUCK', 'TOY_COMP', 'LOFI_LIGHT', 'FDN_HALL',
]);

console.log(`\nIR schema v${SCHEMA_VERSION} static-conformance check\n`);

let hadFailure = false;
let count = 0;

for (const { name, offset } of starts) {
  if (!BRICK_EXPORTS.has(name)) continue;
  count++;
  const body = sliceBlock(offset);
  if (!body) {
    console.log(`  FAIL  ${name.padEnd(18)}  could not extract block`);
    hadFailure = true;
    continue;
  }
  const errs = [];

  // schemaVersion
  const svMatch = body.match(/schemaVersion:\s*['"]([^'"]+)['"]/);
  if (!svMatch) errs.push('missing schemaVersion');
  else if (svMatch[1] !== SCHEMA_VERSION) errs.push(`schemaVersion "${svMatch[1]}" != "${SCHEMA_VERSION}"`);

  // id
  if (!/^\s*id:\s*['"][^'"]+['"]/m.test(body)) errs.push('missing id');

  // top-level arrays
  for (const key of ['terminals', 'nodes', 'wires']) {
    const rx = new RegExp(`^\\s*${key}:\\s*\\[`, 'm');
    if (!rx.test(body)) errs.push(`missing ${key}[]`);
  }

  const tag = errs.length === 0 ? 'PASS' : 'FAIL';
  const idMatch = body.match(/^\s*id:\s*['"]([^'"]+)['"]/m);
  const graphId = idMatch ? idMatch[1] : '(none)';
  console.log(`  ${tag}  ${name.padEnd(18)}  id=${graphId}`);
  for (const e of errs) {
    hadFailure = true;
    console.log(`         ERROR: ${e}`);
  }
}

console.log(`\n  Checked ${count} graph exports.`);

if (hadFailure) {
  console.log('\nRESULT: FAIL — at least one graph does not conform to v1.0\n');
  process.exit(1);
} else {
  console.log(`\nRESULT: PASS — all ${count} graphs declare schemaVersion "${SCHEMA_VERSION}" + outer shape.`);
  console.log('NOTE:   Deep validation (param ranges, port kinds, reference resolution)');
  console.log('        runs at browser module-load time via validateGraphLoud().\n');
}
