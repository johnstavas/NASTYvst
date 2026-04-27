// demote_catalog_statuses.mjs — one-shot trust reset.
// Demotes every ✅-variant status in the main catalog table rows to 🚧.
// Leaves ⬜ alone. Does NOT touch commentary/legend lines that contain ✅
// outside table cells.
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'memory/sandbox_ops_catalog.md';
const lines = readFileSync(path, 'utf8').split(/\r?\n/);

// Two table formats in this file:
//   4-col:  | # | opId         | status | notes |
//   5-col:  | # | opId | family | status | notes |
// Status cell may include trailing parenthetical: "✅+P (2026-04-26)".
const ROW_RE_4 = /^(\| *\d+[a-z]?(?:\.\d+)? *\| *[^|]+? *\| *)([^|]*?)( *\|[^|]*\|.*)$/;
const ROW_RE_5 = /^(\| *\d+[a-z]?(?:\.\d+)? *\| *[^|]+? *\| *[^|]+? *\| *)([^|]*?)( *\|[^|]*\|.*)$/;
const STATUS_RE = /^(✅\+P\+✓|✅\+P~|✅\+P|✅|🔧)(\s|\(|$)/;

function demote(status) { return status.replace(STATUS_RE, '🚧$2'); }

let changed = 0;
const out = lines.map(line => {
  // Try 5-col first (more specific) then 4-col.
  for (const re of [ROW_RE_5, ROW_RE_4]) {
    const m = line.match(re);
    if (!m) continue;
    const status = m[2].trim();
    if (STATUS_RE.test(status)) {
      changed++;
      return `${m[1]}${demote(status)}${m[3]}`;
    }
  }
  return line;
});

// Prepend a trust-reset header right after the H1 + intro block.
// Locate the line where the first H2 (## Status legend) begins; insert above it.
let insertIdx = out.findIndex(l => l.startsWith('## Status legend'));
if (insertIdx < 0) insertIdx = 1;

const banner = [
  '',
  '> **🛑 2026-04-26 TRUST RESET.** Every op in the main catalog table was',
  '> demoted to 🚧 status on this date. Prior ✅ marks were inherited from',
  '> batched/automated work without per-op personal verification. After we',
  '> discovered four silent C++ stubs (detector / envelope / filter /',
  '> gainComputer) marked ✅ that were emitting zeros into every shipped',
  '> compressor recipe, the decision was: **no more inherited trust**.',
  '> Each op now earns ✅+P+✓ only after individual verification through the',
  '> 7-gate protocol (worklet real, C++ real, smoke graph, T1–T7 sweep, T8',
  '> native parity, T8-B behavioral, listen-and-sign-off). Live ledger:',
  '> `memory/op_verification_ledger.md`. Run `node scripts/audit_op_progress.mjs`',
  '> to see auto-detectable gate progress (gates 1–6); gate 7 is manual.',
  '',
];
out.splice(insertIdx, 0, ...banner);

writeFileSync(path, out.join('\n'));
console.log(`Demoted ${changed} catalog rows to 🚧.`);
console.log(`Trust-reset banner inserted before line ${insertIdx + 1}.`);
