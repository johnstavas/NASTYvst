// Build QC Rack audit docx for the session (ops #7/#8/#9a + template + math gate).
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
         HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
         LevelFormat, PageOrientation } from 'docx';
import { writeFileSync } from 'node:fs';

const ARIAL = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: t, bold: true })] });
const P  = (t) => new Paragraph({ children: [new TextRun(t)] });
const B  = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(t)] });
const BB = (label, t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text: label, bold: true }), new TextRun(' — ' + t)] });
const Mono = (t) => new Paragraph({ children: [new TextRun({ text: t, font: 'Consolas', size: 18 })] });

function cell(text, { header = false, width = 3120 } = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: header ? { fill: 'D5E8F0', type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: header })] })],
  });
}

function table(headers, rows, widths) {
  return new Table({
    width: { size: widths.reduce((a,b)=>a+b, 0), type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })) }),
      ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, { width: widths[i] })) })),
    ],
  });
}

const children = [
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'QC Rack — Session Audit', bold: true, size: 40 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Stage-3 op bring-up: ops #7 curve, #8 smooth, #9a combine', italics: true, size: 24 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Date: 2026-04-23', size: 22 })] }),
  P(''),

  H1('1. Scope'),
  P('This audit covers the foundation-first op-building work done this session: three new tri-file ops, a new math-assertion gate in the QC rack, and a hardening of the op authoring contract (OP_TEMPLATE.md).'),
  B('Ops shipped: curve (#7), smooth (#8), combine (#9a).'),
  B('Op in progress: noise (#10) — design locked, build queued.'),
  B('New gate: qc:math — discovers op_*.test.js and runs real-math assertions.'),
  B('New doc: src/sandbox/ops/OP_TEMPLATE.md — hardens the tri-file contract.'),

  H1('2. QC Rack — Gate Chain'),
  P('qc:all now runs 8 gates in order. Any FAIL halts the chain. This is the full green-light pipeline for any op or graph change.'),
  table(
    ['#', 'Gate', 'Purpose'],
    [
      ['1', 'qc:schema',  'Registry + port/param shape validation'],
      ['2', 'qc:t6',      'T1/T2/T3 graph rules (cycles, arity, types)'],
      ['3', 'qc:graphs',  'Fixture graph compilation'],
      ['4', 'qc:pcof',    'PCOF lowering determinism'],
      ['5', 'qc:goldens', 'SHA-256 hash of sidecar output at fixed drive'],
      ['6', 'qc:math',    'Real-math per-op assertions (NEW)'],
      ['7', 'qc:master',  'Master-worklet codegen round-trip'],
      ['8', 'qc:emit',    'C++ emitter smoke check'],
    ],
    [720, 2340, 6300]
  ),
  P(''),
  P('Before this session the rack had 7 gates. Gate #6 (math) slots between the hash-conformance gate and the master codegen gate so a sidecar math regression is caught before it contaminates master codegen output.'),

  H1('3. Op #7 — curve'),
  H2('Research prescription'),
  BB('Source', 'sandbox_modulation_roadmap.md § 3 (curve authoring).'),
  BB('Primitive', 'Cubic Hermite control points with per-point tangents. Bézier-equivalent for 1D y = f(x).'),
  BB('Anti-pattern rejected', 'Preset-shape enum (linear/exp/log/sCurve). A control-point curve subsumes all presets and stays authoring-friendly.'),
  H2('Implementation'),
  BB('Evaluator', 'Binary-search segment index + Hermite basis.'),
  Mono('H(t) = (2t^3 - 3t^2 + 1)·y0 + (t^3 - 2t^2 + t)·m0·dx'),
  Mono('      + (-2t^3 + 3t^2)·y1 + (t^3 - t^2)·m1·dx'),
  BB('Interp modes', '"hermite" (authored tangents), "catmull" (auto tangents m_i = (y_{i+1} − y_{i−1}) / (x_{i+1} − x_{i−1})), "linear" (lerp fallback).'),
  BB('Bipolar', 'Sign-preserving: |x| through curve, sign reapplied.'),
  BB('Tests (10)', 'Endpoints, identity monotonicity, smoothstep midpoints (0.5 and 0.25), linear exact lerps, Catmull hand-derived tangent (0.125), bipolar sign, clamping, null input.'),
  H2('Deferred'),
  B('T6 rule CURVE_MONOTONIC_FOR_KNOB_TAPER — flagged, not blocking.'),

  H1('4. Op #8 — smooth'),
  H2('Research prescription'),
  BB('Source', 'sandbox_modulation_roadmap.md § 4 item 8; Web Audio setTargetAtTime semantics.'),
  BB('Primitive', 'One-pole lowpass smoother for param/control signals.'),
  H2('Implementation'),
  Mono('alpha = 1 - exp(-1 / (tau · sr))    // tau in seconds'),
  Mono('y += alpha · (x - y)                // per sample'),
  Mono('if (|y| < 1e-30) y = 0              // Jon Watte denormal flush'),
  BB('Fast path', 'tau = 0 → bit-exact passthrough (no state update).'),
  BB('Denormal flush', 'Canon:utilities §1, SHIP-CRITICAL. IIR state is the classic denormal source.'),
  BB('Tests (9)', 'Step response hits 1−1/e at n = tau·sr; zero-input stability; long-run convergence < 1e-4; tau=0 passthrough bit-exact; monotonic approach no overshoot; denormal flush (seed 1e-35 → 0); reset clears state; null input; larger tau slower than smaller.'),

  H1('5. Op #9a — combine'),
  H2('Research prescription'),
  BB('Source', 'sandbox_modulation_roadmap.md § 2 axis 3 (six coupling types), § 4 item 9, § 7 IR (sources[].op).'),
  BB('Primitive', 'Per-pair control-signal coupling. Sample-loop arithmetic is an op; schema-level fan-in trees are a compiler concern.'),
  H2('Split decision'),
  BB('#9a (this op)', 'Per-pair math — mul / add / max / min / weighted / lastWins.'),
  BB('#9b (deferred PR)', 'IR schema extension param.sources: [{source, curve, range, op}] + T6 rules COUPLING_OP_ARITY_VALID, CONTROL_MOD_DAG, MACRO_RECOMPUTE_COMPLETE.'),
  H2('Implementation'),
  BB('Dispatch', 'Mode enum → integer for branch-free hot loop.'),
  BB('Identity substitution', 'Missing input replaced by mode identity: mul/min → 1, add/max → 0, max → −∞, min → +∞, lastWins → NaN sentinel.'),
  BB('Weighted fast path', 'If both wired: (1−w)·a + w·b. If one wired: passthrough of wired side (NOT dimmed by weight — would be a crossfade artifact).'),
  BB('Weight clamp', 'w ∈ [0, 1], defensive clamp in setParam.'),
  BB('Tests (14)', 'Per mode identity + commutativity; weighted at w=0/1/0.5 midpoint; weighted missing-side passthrough; lastWins override + missing-b passthrough; both unwired → 0 across all modes; weight clamp.'),

  H1('6. OP_TEMPLATE.md — Hardened Contract'),
  P('Written to src/sandbox/ops/OP_TEMPLATE.md to lock the tri-file op shape for future AI-agent authoring. Prevents spaghetti drift across ops.'),
  H2('File contract (per op)'),
  table(
    ['File', 'Role'],
    [
      ['op_<id>.worklet.js', 'Reference implementation (runs in sandbox AudioWorklet or Node harness)'],
      ['op_<id>.cpp.jinja',  'C++ mirror, double-precision, Jinja2 templated for master-codegen'],
      ['op_<id>.test.js',    'Real-math assertions discovered by qc:math'],
    ],
    [3120, 6240]
  ),
  H2('JS skeleton — 10 members in order'),
  B('static opId / inputs / outputs / params'),
  B('constructor(sampleRate)'),
  B('reset()'),
  B('setParam(id, v)'),
  B('getLatencySamples()'),
  B('private helpers'),
  B('process(inputs, outputs, N)'),
  H2('C++ skeleton — 7 anchors'),
  B('namespace shags::ops'),
  B('class <Op>_{{ node_id }}'),
  B('static constexpr opId'),
  B('explicit ctor(double sampleRate)'),
  B('reset / setParam / getLatencySamples'),
  B('process(const float* in…, float* out…, int N)'),
  B('private state'),
  H2('Minimum test coverage per op'),
  B('null input defensive behavior'),
  B('reset() clears all state'),
  B('at least one expected-value check'),
  B('at least one edge-behavior check (clamp, identity, saturation, etc.)'),

  H1('7. Files touched this session'),
  table(
    ['Path', 'Change'],
    [
      ['src/sandbox/ops/op_curve.worklet.js',   'Rewritten — Hermite evaluator'],
      ['src/sandbox/ops/op_curve.cpp.jinja',    'Rewritten — C++ mirror'],
      ['src/sandbox/ops/op_curve.test.js',      'New — 10 tests'],
      ['src/sandbox/ops/op_smooth.worklet.js',  'New — one-pole LP'],
      ['src/sandbox/ops/op_smooth.cpp.jinja',   'New — C++ mirror'],
      ['src/sandbox/ops/op_smooth.test.js',     'New — 9 tests'],
      ['src/sandbox/ops/op_combine.worklet.js', 'New — six-mode coupling'],
      ['src/sandbox/ops/op_combine.cpp.jinja',  'New — C++ mirror'],
      ['src/sandbox/ops/op_combine.test.js',    'New — 14 tests'],
      ['src/sandbox/ops/OP_TEMPLATE.md',        'New — hardened authoring contract'],
      ['src/sandbox/opRegistry.js',             'Edited — points/enum/number formatters, 3 new entries'],
      ['scripts/check_op_goldens.mjs',          'Edited — OP_IDS expanded to 9 ops'],
      ['scripts/check_op_math.mjs',             'New — math-assertion gate'],
      ['scripts/goldens/curve.golden.json',     'Blessed'],
      ['scripts/goldens/smooth.golden.json',    'Blessed'],
      ['scripts/goldens/combine.golden.json',   'Blessed'],
      ['package.json',                          'Edited — qc:math wired into qc:all'],
    ],
    [5500, 3860]
  ),

  H1('8. Pending / Deferred'),
  BB('Op #10 noise (in progress)', 'Research-locked: {type: white|pink|sh}, Canon:synthesis §10 32-bit LCG + §8 Trammell 3-stage pink, seeded deterministic, denormal flush per IIR stage, S&H counter-based hold.'),
  BB('#9b coupling schema (deferred PR)', 'PCOF param.sources shape + three T6 validator rules.'),
  BB('T6 rule CURVE_MONOTONIC_FOR_KNOB_TAPER (deferred from #7)', 'Flag non-monotonic curves used as knob tapers.'),
  BB('Test.js backfill (6 ops)', 'gain / filter / detector / envelope / gainComputer / mix — currently golden-only. Backfill under OP_TEMPLATE coverage rules.'),

  H1('9. Ship posture'),
  P('All nine ops that ship today (gain, filter, detector, envelope, gainComputer, mix, curve, smooth, combine) pass qc:schema, qc:goldens, and qc:master. The three ops authored this session additionally pass qc:math against hand-derived expected values. The rack is green.'),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: ARIAL, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: ARIAL },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: ARIAL },
        paragraph: { spacing: { before: 220, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: ARIAL },
        paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync('C:/Users/HEAT2/Desktop/Shags VST/QC_Rack_Audit.docx', buf);
console.log('Wrote QC_Rack_Audit.docx (' + buf.length + ' bytes)');
