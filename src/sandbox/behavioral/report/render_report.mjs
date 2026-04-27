// render_report.mjs — write per-op markdown + JSON behavioral reports.
//
// Path: test/fixtures/behavioral/reports/<opId>.{md,json}

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..', '..', '..', '..');
const reportsDir = resolve(repoRoot, 'test', 'fixtures', 'behavioral', 'reports');
if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

const VERDICT_GLYPH = {
  PASS: '✅ PASS',
  FAIL: '❌ FAIL',
  SKIP: '⏸ SKIP',
  ERROR: '💥 ERROR',
};

const ATTRIBUTION_GLYPH = {
  'verified-end-to-end':       '✅✅ Verified end-to-end (worklet + native both PASS)',
  'math-or-spec-bug':           '❌❌ Math/spec bug — worklet AND native both fail (the reference is wrong)',
  'codegen-or-wiring-bug':      '✅❌ Codegen/wiring bug — worklet PASSES but native FAILS (codegen deviates)',
  'unusual-cross-arm-asymmetry':'❌✅ Unusual: worklet FAILS but native PASSES — manual review',
  'native-skipped':             '⏸ Native arm skipped (VST3 unavailable or multi-input)',
};
function attributionGlyph(a) { return ATTRIBUTION_GLYPH[a] || a; }

export function writeReport(report) {
  const opId = report.opId;
  const md = renderMarkdown(report);
  const json = JSON.stringify(report, jsonReplacer, 2);
  writeFileSync(resolve(reportsDir, `${opId}.md`), md);
  writeFileSync(resolve(reportsDir, `${opId}.json`), json);
}

function jsonReplacer(_key, value) {
  // Float32Array and Array of objects with curve data → keep as-is, but
  // truncate verbose curves to keep the JSON sidecar readable.
  if (value instanceof Float32Array) return Array.from(value);
  return value;
}

function renderMarkdown(report) {
  const lines = [];
  const v = report.summary?.verdict || 'SKIP';

  lines.push(`# ${report.opId} — Behavioral Validation Report`);
  lines.push('');
  lines.push(`**Generated:** ${report.timestamp || new Date().toISOString()}`);
  lines.push(`**Category:** ${report.category || '(none)'}`);
  lines.push(`**Verdict:** ${VERDICT_GLYPH[v] || v}`);
  if (report.error) {
    lines.push(`**Error:** ${report.error}`);
  }
  lines.push(`**Duration:** ${report.durationMs ?? 0} ms`);
  lines.push('');

  if (!report.tests || report.tests.length === 0) {
    lines.push('No tests executed.');
    return lines.join('\n');
  }

  // Two-arm summary if native was run.
  const nativeRan = report.native && report.native.summary?.verdict !== 'SKIP';
  const nativeSkipped = report.native && report.native.summary?.verdict === 'SKIP';

  if (report.attribution) {
    lines.push(`**Attribution:** ${attributionGlyph(report.attribution)}`);
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  if (nativeRan) {
    lines.push('| Test | Worklet | Native |');
    lines.push('|---|---|---|');
    const wlTests = report.worklet?.tests || report.tests;
    const ntTests = report.native?.tests || [];
    const ntByName = {};
    for (const t of ntTests) ntByName[t.name] = t;
    for (const t of wlTests) {
      const wGlyph = t.pass ? '✅ PASS' : '❌ FAIL';
      const nt = ntByName[t.name];
      const nGlyph = nt ? (nt.pass ? '✅ PASS' : '❌ FAIL') : '—';
      lines.push(`| ${t.name} | ${wGlyph} | ${nGlyph} |`);
    }
  } else {
    lines.push(`| Test | Worklet |${nativeSkipped ? ' Native |' : ''}`);
    lines.push(`|---|---|${nativeSkipped ? '---|' : ''}`);
    for (const t of report.tests) {
      const glyph = t.pass ? '✅ PASS' : '❌ FAIL';
      lines.push(`| ${t.name} | ${glyph} |${nativeSkipped ? ' ⏸ SKIP |' : ''}`);
    }
  }
  if (nativeSkipped && report.native?.reason) {
    lines.push('');
    lines.push(`*Native arm skipped: ${report.native.reason}*`);
  }
  lines.push('');

  // Detailed diagnostics for failing tests.
  const failed = report.tests.filter(t => !t.pass);
  if (failed.length > 0) {
    lines.push('## Diagnostics');
    lines.push('');
    for (const t of failed) {
      lines.push(`### ${t.name} — FAIL`);
      lines.push('');
      if (t.declared) {
        lines.push('**Declared:**');
        lines.push('```json');
        lines.push(JSON.stringify(t.declared, null, 2));
        lines.push('```');
      }
      if (t.measured) {
        lines.push('**Measured:**');
        lines.push('```json');
        lines.push(JSON.stringify(t.measured, jsonReplacer, 2));
        lines.push('```');
      }
      if (t.diagnostic) {
        lines.push('**Diagnosis:**');
        lines.push('');
        lines.push('```');
        lines.push(t.diagnostic);
        lines.push('```');
      }
      lines.push('');
    }
  }

  // Pass details (collapsible-ish — just terse readouts)
  const passed = report.tests.filter(t => t.pass);
  if (passed.length > 0) {
    lines.push('## Passing tests');
    lines.push('');
    for (const t of passed) {
      const m = t.measured ? ` → ${summarizeMeasured(t.measured)}` : '';
      lines.push(`- **${t.name}**${m}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Generated by `scripts/check_behavioral.mjs`. See `memory/behavioral_validation_harness.md` for the full design.');

  return lines.join('\n');
}

function summarizeMeasured(m) {
  // Pick a few interesting fields without dumping curve data.
  const parts = [];
  for (const [k, v] of Object.entries(m)) {
    if (Array.isArray(v) || (typeof v === 'object' && v !== null)) continue;
    if (typeof v === 'number') {
      parts.push(`${k} = ${Number.isFinite(v) ? v.toFixed(3) : v}`);
    } else if (v != null) {
      parts.push(`${k} = ${v}`);
    }
  }
  return parts.join(', ');
}
