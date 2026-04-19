// scripts/parity-audit.cjs
//
// Static parity audit — for each product in the registry, diff the set-method
// surface area of its `legacy` vs `engine_v1` engine files.
//
// Answers ONE question: "did I forget to port a knob/control when I migrated
// to v1?" (surface-level, not DSP-behavior-level — ears do that via the QC
// harness.)
//
// Output: public/parity-report.json   — consumed at runtime by src/migration/parity.js
// Console: human-readable per-product report.
//
// Usage:
//   node scripts/parity-audit.cjs

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ── Engine source discovery ─────────────────────────────────────────────────
// We can't import registry.js from a .cjs script (ES modules), so we parse
// its text to learn which files back which (product, variant).

function loadRegistrySources() {
  const src = fs.readFileSync(path.join(ROOT, 'src/migration/registry.js'), 'utf8');

  // Map engineFactory name → file path via the import lines at top.
  // e.g. `import { createDrumBusEngine } from '../drumBusEngine.js';`
  const imports = {};
  const importRe = /import\s*\{\s*([a-zA-Z0-9_]+)\s*\}\s*from\s*['"]\.\.\/([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(src))) imports[m[1]] = path.join(ROOT, 'src', m[2]);

  // Parse product entries — productId + each variant's engineFactory name.
  // We walk the REGISTRY array object by object.
  const products = [];
  const productRe = /productId:\s*['"]([^'"]+)['"]/g;
  const variantRe = /(\w+):\s*\{\s*variantId:\s*['"](\w+)['"][\s\S]*?engineFactory:\s*(\w+)[\s\S]*?\}/g;

  // Simple: find each product block by productId, then scan variants inside.
  const productBlocks = src.split(/productId:\s*['"]/).slice(1);
  for (const block of productBlocks) {
    const pid = block.match(/^([^'"]+)['"]/)?.[1];
    if (!pid) continue;
    // Scan the following chunk for variant entries until next productId or array end.
    const scanEnd = block.search(/productId:\s*['"]/);
    const scan = scanEnd === -1 ? block : block.slice(0, scanEnd);
    const variants = {};
    let vm;
    const vre = /(\w+):\s*\{\s*variantId:\s*['"](\w+)['"][\s\S]*?engineFactory:\s*(\w+)/g;
    while ((vm = vre.exec(scan))) {
      const variantKey = vm[1];
      const variantId  = vm[2];
      const factory    = vm[3];
      if (variantKey !== variantId) continue;
      variants[variantId] = { factory, file: imports[factory] || null };
    }
    products.push({ productId: pid, variants });
  }
  return products;
}

// ── Method extraction ───────────────────────────────────────────────────────
// Three patterns, matching how the engines in this repo actually return APIs:
//   1. returned-object shorthand:    setFoo: v => ...
//   2. returned-object function:     setFoo(v) { ... }
//   3. exported named:               export function setFoo(v) { ... }
//   4. export.setFoo / module.exports.setFoo

function extractSetMethods(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { methods: [], error: 'file not found' };
  const src = fs.readFileSync(filePath, 'utf8');
  const found = new Set();

  const patterns = [
    /(?:^|[\s,{])\s*(set[A-Z]\w*)\s*:\s*(?:function|async|\(|[a-zA-Z_$])/gm, // setFoo: v => ... | fn | (v)=>...
    /(?:^|[\s,{])\s*(set[A-Z]\w*)\s*\(/gm,                           // setFoo(v) {
    /export\s+(?:async\s+)?function\s+(set[A-Z]\w*)\s*\(/gm,         // export function setFoo
    /\.(set[A-Z]\w*)\s*=\s*(?:function|\()/gm,                       // obj.setFoo = ...
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src))) found.add(m[1]);
  }

  // Strip method names that are obviously AudioNode / DOM / lifecycle internals,
  // not a public engine API surface. Conservative list.
  const BLACKLIST = new Set([
    'setValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime',
    'setPosition', 'setOrientation', 'setPeriodicWave',
    'setAttribute', 'setAttributeNS', 'setProperty',
    'setInterval', 'setTimeout', 'setImmediate',
  ]);
  for (const b of BLACKLIST) found.delete(b);

  return { methods: [...found].sort(), error: null };
}

// ── Diff ────────────────────────────────────────────────────────────────────

function diffVariants(legacyMethods, v1Methods) {
  const L = new Set(legacyMethods);
  const V = new Set(v1Methods);
  const legacyOnly = [...L].filter(x => !V.has(x)).sort();
  const v1Only     = [...V].filter(x => !L.has(x)).sort();
  const matched    = [...L].filter(x =>  V.has(x)).sort();

  let status = 'OK';
  if (legacyOnly.length > 0) status = 'DRIFT';
  else if (v1Only.length > 0) status = 'EXTENDED';

  return { status, legacyOnly, v1Only, matched };
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const products = loadRegistrySources();
  const report = {
    generatedAt: new Date().toISOString(),
    products: {},
  };

  const lines = [];
  lines.push(`=== PARITY REPORT — ${new Date().toLocaleString()} ===\n`);

  for (const p of products) {
    const legacyVar = p.variants.legacy;
    const v1Var     = p.variants.engine_v1;

    if (!legacyVar) {
      lines.push(`${p.productId}:  NO LEGACY (skipped)\n`);
      report.products[p.productId] = { status: 'NO_LEGACY' };
      continue;
    }

    const legacyExtract = extractSetMethods(legacyVar.file);

    if (!v1Var) {
      lines.push(`${p.productId}:  LEGACY_ONLY (no engine_v1 yet)`);
      lines.push(`    legacy methods (${legacyExtract.methods.length}): ${legacyExtract.methods.join(', ')}`);
      lines.push('');
      report.products[p.productId] = {
        status: 'LEGACY_ONLY',
        legacyMethods: legacyExtract.methods,
      };
      continue;
    }

    const v1Extract = extractSetMethods(v1Var.file);
    const diff = diffVariants(legacyExtract.methods, v1Extract.methods);

    report.products[p.productId] = {
      status:        diff.status,
      legacyMethods: legacyExtract.methods,
      v1Methods:     v1Extract.methods,
      legacyOnly:    diff.legacyOnly,
      v1Only:        diff.v1Only,
      matched:       diff.matched,
    };

    const statusColor =
      diff.status === 'OK'       ? '\x1b[32m'  // green
    : diff.status === 'EXTENDED' ? '\x1b[36m'  // cyan
    :                              '\x1b[33m'; // yellow
    const reset = '\x1b[0m';

    lines.push(`${p.productId}:  ${statusColor}${diff.status}${reset}  ` +
               `(matched ${diff.matched.length}, legacyOnly ${diff.legacyOnly.length}, v1Only ${diff.v1Only.length})`);
    if (diff.legacyOnly.length) lines.push(`    legacyOnly:  ${diff.legacyOnly.join(', ')}`);
    if (diff.v1Only.length)     lines.push(`    v1Only:      ${diff.v1Only.join(', ')}`);
    lines.push('');
  }

  // Summary counts
  const statuses = Object.values(report.products).map(p => p.status);
  const counts = statuses.reduce((a, s) => (a[s] = (a[s] || 0) + 1, a), {});
  lines.push(`--- ${products.length} products: ` +
    Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', '));

  const out = lines.join('\n');
  console.log(out);

  // Write JSON report for runtime consumption
  const outDir = path.join(ROOT, 'public');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'parity-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${path.relative(ROOT, path.join(outDir, 'parity-report.json'))}`);
}

main();
