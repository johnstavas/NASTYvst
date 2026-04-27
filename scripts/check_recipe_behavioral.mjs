#!/usr/bin/env node
// check_recipe_behavioral.mjs — recipe-level (graph) behavioral validation.
//
// Drives a whole graph.json end-to-end and verifies the recipe's declared
// audio behavior — static curve, attack/release T90, sub-threshold unity.
//
// v1: worklet arm only. Native arm (compile VST3 + drive parity_host) is
// deferred — see C-step 2 in qc_backlog.md.
//
// Usage:
//   node scripts/check_recipe_behavioral.mjs                      # all recipes
//   node scripts/check_recipe_behavioral.mjs --recipes nasty_neve_v1
//   node scripts/check_recipe_behavioral.mjs --json               # machine output

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RECIPE_BEHAVIORAL }    from '../src/sandbox/behavioral/specs/recipes.mjs';
import { runCompressorRecipeMetrics } from '../src/sandbox/behavioral/metrics/compressorRecipe.mjs';

const CATEGORY_DISPATCH = {
  compressorRecipe: runCompressorRecipeMetrics,
};

function parseArgs(argv) {
  const out = { recipes: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recipes' && argv[i + 1]) {
      out.recipes = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    } else if (a === '--json') {
      out.json = true;
    }
  }
  return out;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

async function main() {
  const args = parseArgs(process.argv);
  const allIds = Object.keys(RECIPE_BEHAVIORAL);
  const ids = args.recipes ?? allIds;

  console.log(`L2 RECIPE behavioral validation — worklet arm only`);
  console.log(`Running ${ids.length} recipe(s): ${ids.join(', ')}\n`);

  const reportDir = resolve('test/fixtures/behavioral/recipe_reports');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const results = [];
  let pass = 0, fail = 0, skip = 0;

  for (const id of ids) {
    const spec = RECIPE_BEHAVIORAL[id];
    if (!spec) {
      console.log(`  ${pad(id, 22)} ... ❓ unknown recipe id`);
      skip++;
      continue;
    }
    const fn = CATEGORY_DISPATCH[spec.category];
    if (!fn) {
      console.log(`  ${pad(id, 22)} ... ⏸ no metric for category '${spec.category}'`);
      skip++;
      continue;
    }
    let result;
    try {
      result = await fn(id, spec);
    } catch (e) {
      console.log(`  ${pad(id, 22)} ... ❌ THREW: ${e.message}`);
      fail++;
      results.push({ id, error: e.message, stack: e.stack });
      continue;
    }
    const v = result.summary.verdict;
    const sym = v === 'PASS' ? '✅' : v === 'FAIL' ? '❌' : '⏸';
    console.log(`  ${pad(id, 22)} ... ${sym} ${v}  (${result.summary.passed}/${result.summary.total})`);
    if (v === 'PASS') pass++;
    else if (v === 'FAIL') fail++;
    else skip++;

    // Per-test diagnostic summary on FAIL.
    if (v !== 'PASS') {
      for (const t of result.tests) {
        if (!t.pass && t.diagnostic) console.log(`      · ${t.name}: ${t.diagnostic}`);
      }
    }

    // Persist report.
    const reportPath = resolve(reportDir, `${id}.json`);
    writeFileSync(reportPath, JSON.stringify({ id, spec, ...result }, null, 2));
    results.push({ id, ...result });
  }

  console.log(`\nSummary:  ${pass} PASS · ${fail} FAIL · ${skip} SKIP`);
  console.log(`Reports: ${reportDir}`);

  if (args.json) {
    console.log('\n--- JSON ---');
    console.log(JSON.stringify({ pass, fail, skip, results }, null, 2));
  }

  if (fail > 0) {
    console.log('RESULT: FAIL');
    process.exit(1);
  }
  console.log(`RESULT: PASS — ${pass}/${pass + fail + skip} recipe(s) cleanly passed L2 recipe-behavioral.`);
}

main().catch(e => { console.error(e); process.exit(2); });
