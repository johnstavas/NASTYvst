// check_behavioral.mjs — L2 behavioral validation gate (worklet arm).
//
// Day 1 scope: dispatch on declared op category, run worklet metric battery,
// emit per-op markdown + JSON report. Native arm wires in Day 3.
//
// Usage:
//   node scripts/check_behavioral.mjs                    # all ops with behavioral specs
//   node scripts/check_behavioral.mjs --op varMuTube     # single op
//   node scripts/check_behavioral.mjs --cluster a        # only Cluster A

import { runBehavioralForOp } from '../src/sandbox/behavioral/runner.mjs';
import { writeReport } from '../src/sandbox/behavioral/report/render_report.mjs';
import { CLUSTER_A_BEHAVIORAL } from '../src/sandbox/behavioral/specs/cluster_a.mjs';
import {
  UTILITY_BEHAVIORAL, FILTER_BEHAVIORAL,
  DISTORTION_BEHAVIORAL, ANALYZER_BEHAVIORAL,
} from '../src/sandbox/behavioral/specs/foundation.mjs';

// Aggregate all known specs.
const ALL_SPECS = {
  ...CLUSTER_A_BEHAVIORAL,
  ...UTILITY_BEHAVIORAL,
  ...FILTER_BEHAVIORAL,
  ...DISTORTION_BEHAVIORAL,
  ...ANALYZER_BEHAVIORAL,
};

function parseArgs(argv) {
  const args = { op: null, cluster: null, native: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--op')      args.op = argv[++i];
    if (argv[i] === '--cluster') args.cluster = argv[++i];
    if (argv[i] === '--native')  args.native = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  let opsToRun;
  if (args.op) {
    if (!ALL_SPECS[args.op]) {
      console.error(`No behavioral spec for op '${args.op}'. Known: ${Object.keys(ALL_SPECS).join(', ')}`);
      process.exit(1);
    }
    opsToRun = [args.op];
  } else if (args.cluster === 'a') {
    opsToRun = Object.keys(CLUSTER_A_BEHAVIORAL);
  } else {
    opsToRun = Object.keys(ALL_SPECS);
  }

  console.log(`\nL2 behavioral validation — ${args.native ? 'TWO-ARM (worklet + native)' : 'worklet arm only'}`);
  console.log(`Running ${opsToRun.length} op(s): ${opsToRun.join(', ')}\n`);

  let totalPass = 0, totalFail = 0, totalSkip = 0;
  const summary = [];

  for (const opId of opsToRun) {
    const spec = ALL_SPECS[opId];
    process.stdout.write(`  ${opId.padEnd(20)}  ... `);
    const report = await runBehavioralForOp(opId, spec, { native: args.native });
    writeReport(report);

    const v = report.summary.verdict;
    if (v === 'PASS') totalPass++;
    else if (v === 'FAIL' || v === 'ERROR') totalFail++;
    else totalSkip++;

    const glyph = v === 'PASS' ? '✅' : v === 'FAIL' ? '❌' : v === 'ERROR' ? '💥' : '⏸';
    let line = `${glyph} ${v}  (worklet ${report.summary.passed}/${report.summary.total})`;
    if (args.native && report.native) {
      const nv = report.native.summary.verdict;
      const ng = nv === 'PASS' ? '✅' : nv === 'FAIL' ? '❌' : nv === 'SKIP' ? '⏸' : '💥';
      line += `   native ${ng} ${report.native.summary.passed ?? 0}/${report.native.summary.total ?? 0}`;
      if (report.attribution) line += `   [${report.attribution}]`;
    }
    console.log(line);

    summary.push({
      opId,
      verdict: v,
      passed: report.summary.passed,
      total: report.summary.total,
      failedTests: report.tests.filter(t => !t.pass).map(t => t.name),
      attribution: report.attribution,
    });
  }

  console.log('');
  console.log(`Summary:  ${totalPass} PASS · ${totalFail} FAIL · ${totalSkip} SKIP`);
  console.log('');

  if (totalFail > 0) {
    console.log('Failed tests:');
    for (const s of summary) {
      if (s.failedTests.length > 0) {
        console.log(`  ${s.opId}:  ${s.failedTests.join(', ')}`);
      }
    }
    console.log('');
    console.log(`Reports written to test/fixtures/behavioral/reports/<opId>.md`);
    console.log('');
    process.exit(1);
  }

  console.log(`Reports written to test/fixtures/behavioral/reports/<opId>.md`);
  console.log(`RESULT: PASS — all ${opsToRun.length} ops cleanly passed L2 behavioral.\n`);
}

main().catch(e => {
  console.error('check_behavioral fatal:', e);
  process.exit(2);
});
