// Sandbox Brick Audit — EchoformLite
// Per memory/sandbox_brick_audit_protocol.md
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require('docx');

const ACCENT = '2E75B6';
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, ...(opts.run || {}) })],
  });
}
function H(text, level) {
  const map = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  return new Paragraph({ heading: map[level], children: [new TextRun(text)] });
}
function B(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun(text)],
  });
}
function cell(text, opts = {}) {
  return new TableCell({
    borders: BORDERS,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.header ? { fill: 'D5E8F0', type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: (Array.isArray(text) ? text : [text]).map(t =>
      new Paragraph({ children: [new TextRun({ text: String(t), bold: !!opts.header, size: 18 })] })
    ),
  });
}
function mkTable(widths, rows) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      children: r.map((c, j) => cell(c, { width: widths[j], header: i === 0 })),
    })),
  });
}

// ───────────────────────────────────────────────────────────── content
const title = 'EchoformLite — Sandbox Brick Audit';

const section1 = [
  H('1. What it does', 2),
  P('EchoformLite is a sandbox-native "character delay" brick: a delay line with a tone filter and a Padé-soft-clip saturator placed *inside* an external feedback loop so each repeat gets progressively darker and grittier. Five panel knobs (TIME, FEEDBACK, TONE, DRIVE, MIX). Graph: IN → delay → filter → saturate → mix.wet / mix ← IN.dry; feedback tap from saturate.out → delay.fb. Mono in / mono out. Character lives in the loop.'),
];

const section2 = [
  H('2. Applicable memory files', 2),
  P('Doctrine', { run: { bold: true } }),
  B('dry_wet_mix_rule.md — mix must be computed inside the worklet with same-sample raw dry.'),
  B('ship_blockers.md — hard gates, especially FB/denormal/DC under feedback.'),
  B('audio_engineer_mental_model.md — Time system; delay is the primitive; character belongs in the loop (Rule: echo darkens).'),
  B('memory_intake_protocol.md — N/A for DSP audit, referenced for citation shorthand.'),
  P('Canon code', { run: { bold: true } }),
  B('Canon:character §11 — Padé rational tanh (x(27+x²)/(27+9x²)) — primary soft-clip kernel.'),
  B('Canon:utilities §1 — Jon Watte denormal bias (1e-20) — ship-critical for FB tails.'),
  B('Canon:filters §9 — RBJ Cookbook — tone LP inside loop is 1-pole OnePole at present (upgrade path: Cookbook biquad).'),
  B('Canon:time_interp §2/§3 — Hermite / Niemitalo fractional delay interpolation (N/A at current scope — integer-sample delay).'),
  P('Reference texts', { run: { bold: true } }),
  B('dafx_zolzer_textbook.md Ch.2 — delay lines, feedback delay structure.'),
  B('dafx_zolzer_textbook.md Ch.12.5 — tape/valve saturation and non-linearity in the loop (archetype reference).'),
  B('jos_pasp_dsp_reference.md — comb / feedback comb filter analysis (stability, DC pole behaviour).'),
  P('Architecture', { run: { bold: true } }),
  B('sandbox_core_scope.md — EchoformLite = Step 3 dogfood, proves external-FB pattern in the sandbox.'),
  B('sandbox_modulation_roadmap.md — Stage B primitives; EchoformLite is Type-3 coupling candidate (FB→LP cutoff) on the roadmap, not yet implemented.'),
  P('Project-specific', { run: { bold: true } }),
  B('plugin_template_library.md — EchoformLite is the archetype template for "external-FB character delay" family (Echoform / tape echo).'),
  B('N/A — no reverb content, no multiband, no stereo, no sidechain at current scope.'),
];

const section3 = [
  H('3. Per-reference compliance check', 2),
  mkTable([450, 1600, 2400, 2400, 1100], [
    ['#', 'Reference', 'What it says', 'What the brick does', 'Verdict'],
    ['1', 'dry_wet_mix_rule.md', 'Mix computed inside AudioWorklet, same-sample raw input as dry, processed signal as wet. External dry legs forbidden.',
      'Uses `mix` op that sums IN.dry and saturate.wet at graph level. Two external nodes group-delay-mismatched: dry path = zero nodes, wet path = delay + filter + saturate (each an AudioWorkletNode). Comb-filter risk on null-test.',
      '❌ FAIL'],
    ['2', 'ship_blockers.md §2 (dry/wet mix rule)', 'Non-negotiable ship gate.',
      'Same as row 1 — blocked.',
      '❌ FAIL'],
    ['3', 'ship_blockers.md §4 (DC rejection under FB)', 'Any node with feedback must have a DC trap in the loop so DC bias cannot accumulate.',
      'No DC trap in loop. Padé soft-clip is symmetric so DC injection is low-probability, but not zero (asymmetric input / denormal drift). Needs a 1-pole HP (~5 Hz) inside the loop.',
      '❌ FAIL'],
    ['4', 'ship_blockers.md §5 (FB runaway guard)', 'Feedback path must include a limiter/saturator that cannot blow up when fb≥1 or numerically stuck.',
      'Padé tanh IS the guard (bounded). Feedback knob clamped to [0, 0.9]. ✅ but untested with DC injection → upgrade to "documented PASS" once test-suite row lands.',
      '⚠️ DEVIATION'],
    ['5', 'ship_blockers.md §6 (denormal tail)', 'Feedback / recursive states must include Watte denormal bias.',
      'Delay line and filter states in respective worklets — need audit of workletSources.js to confirm denormal bias present in both. Current suspicion: delay buffer OK (float32 zeroing acceptable), 1-pole filter state NEEDS bias.',
      '⚠️ DEVIATION (pending workletSources grep)'],
    ['6', 'Canon:character §11 (Padé)', 'Soft-clip: x·(27+x²) / (27+9x²). Order-5 Padé, monotonic, bounded ±1.',
      'Saturate op uses Padé kernel per prior canon alignment pass. ✅',
      '✅ PASS'],
    ['7', 'Canon:utilities §1 (Watte denormal)', 'DENORM = 1e-20 added to any recursive state.',
      'Partial — see row 5. Needs explicit verification row per worklet.',
      '⚠️ DEVIATION'],
    ['8', 'Canon:filters §9 (RBJ)', 'Cookbook biquads for tone control.',
      'Current filter op is 1-pole LP (simpler). Acceptable for dogfood; upgrade tracked.',
      '⚠️ DEVIATION (documented)'],
    ['9', 'DAFX Zölzer Ch.2', 'Delay line + feedback tap, standard IIR comb topology, tap-before-mix.',
      'Matches structurally. FB tap is post-saturate → delay.fb. ✅',
      '✅ PASS'],
    ['10', 'DAFX Zölzer Ch.12.5 / mental model', 'Non-linearity inside loop = repeats darken/drive organically.',
      'Exactly the design. ✅',
      '✅ PASS'],
    ['11', 'Canon:time_interp §2/§3 (Hermite)', 'Fractional delay for modulated/de-zippered time changes.',
      'Not applicable at current scope — TIME knob uses log-mapped integer ms. Parked for Stage-C modulation.',
      'N/A'],
    ['12', 'sandbox_modulation_roadmap.md Type-3 (signal→param)', 'FB-level → LP cutoff coupling documented as a B-stage candidate.',
      'Not implemented. Parked.',
      'N/A'],
  ]),
];

const section4 = [
  H('4. Ship-gate status', 2),
  mkTable([1600, 900, 1200, 4250], [
    ['Gate', 'Required', 'Status', 'Evidence'],
    ['T1 QC sweep zero FAILs', 'Yes', 'Not-run', 'Sandbox QC sweep not yet targeted at per-brick bricks; only compiler null-test run this session.'],
    ['Dry/wet mix rule', 'Yes', 'FAIL', 'External dry leg via `mix` op — comb-filter hazard. Fix: move mix inside a single worklet that owns delay+filter+sat+dry, OR accept delay-matched dry via sample-accurate group-delay report (not currently emitted).'],
    ['Bypass contract', 'Yes', 'Pass', 'bypassPath gain crossfades input→output at 5ms time-constant; dispose drops bypass node.'],
    ['DC rejection under FB', 'If FB', 'FAIL', 'No HP trap in loop. Add 1-pole HP @ ~5 Hz between saturate and delay.fb tap.'],
    ['FB runaway guard', 'If FB', 'Pass (soft)', 'Padé tanh bounds loop; FB knob ceiled at 0.9. Upgrade to documented PASS with explicit stability test row.'],
    ['Denormal tail', 'Yes', 'Unknown', 'Needs workletSources.js grep: confirm 1e-20 bias in filter state + saturate state. Delay buffer is safe by construction.'],
  ]),
];

const section5 = [
  H('5. Canonical-recipe deviations', 2),
  B('DEV-EL-01 — Mix rule: uses graph-level `mix` op instead of intra-worklet dry sum. Why: dogfoods graph-level composition. When it lands: ship-blocker fix before marketplace publish — either intra-worklet fold OR group-delay-matched dry + contract update.'),
  B('DEV-EL-02 — Tone filter is 1-pole, not Cookbook biquad. Why: simpler / cheaper for dogfood. When: Quality tier, upgrade alongside FilterFX 2-pole work.'),
  B('DEV-EL-03 — No DC trap in feedback loop. Why: overlooked. When: Ship blocker — land a `dcBlock` op or fold into filter op as mode="dcHp".'),
  B('DEV-EL-04 — No fractional-delay interpolation. Why: scope — no delay-modulation at Stage B. When: Stage-C, Hermite per Canon:time_interp §2.'),
  B('DEV-EL-05 — No stereo width / LFO motion / allpass blur. Why: sandbox_core_scope § 3 notes these ops are backlog. When: Stage-C.'),
  B('DEV-EL-06 — Denormal bias verification outstanding for filter + saturate worklets. Why: not audited yet. When: Ship blocker — verify next session.'),
];

const section6 = [
  H('6. Findings', 2),
  P('Ship blockers (must fix before publish)', { run: { bold: true } }),
  B('F-EL-SB-01 — Mix-rule violation. External dry leg will comb-filter. Fix: collapse delay+filter+sat+mix into a single monolithic worklet that sums dry inside (Path-A pattern, same as FdnHall), OR emit group-delay report and delay-match dry at compile time.'),
  B('F-EL-SB-02 — No DC trap in feedback loop. Asymmetric input or denormal drift can bias the loop. Fix: 1-pole HP @ ~5 Hz between `saturate` output and `delay.fb` input.'),
  B('F-EL-SB-03 — Denormal bias unverified in filter + saturate worklets. Fix: grep workletSources.js, confirm DENORM=1e-20 in all recursive states; add if missing.'),
  P('Quality (land before next review)', { run: { bold: true } }),
  B('F-EL-Q-01 — Upgrade 1-pole LP to Cookbook biquad per Canon:filters §9 (shared with FilterFX quality item).'),
  B('F-EL-Q-02 — Stability test row: fuzz feedback at 0.9 with DC + denormal inputs for 60 s; confirm no blow-up, no NaN.'),
  B('F-EL-Q-03 — T1 QC sweep target: add EchoformLite to sandbox QC runner once sweep exists.'),
  P('Future (logged in qc_backlog.md)', { run: { bold: true } }),
  B('F-EL-F-01 — Stage-C: add LFO + Hermite fractional delay for time modulation / tape wow.'),
  B('F-EL-F-02 — Stage-C: stereo width (ping-pong / M-S decorrelator).'),
  B('F-EL-F-03 — Stage-B Type-3 coupling: FB-level → LP cutoff (roadmap call-out, unmet).'),
];

const section7 = [
  H('7. Sign-off', 2),
  mkTable([2600, 6350], [
    ['Field', 'Value'],
    ['Audit author', 'Claude'],
    ['Audit date', '2026-04-23'],
    ['Audit SHA', 'HEAD (sandbox-brick-audit-protocol landing)'],
    ['Verdict', 'RED — three ship blockers'],
    ['Debt-logged', 'qc_backlog.md rows to add: F-EL-SB-01, F-EL-SB-02, F-EL-SB-03, F-EL-Q-01, F-EL-Q-02, F-EL-Q-03'],
    ['User sign-off required?', 'YES — RED verdict, Claude never self-waives per ship_blockers.md'],
  ]),
  P(''),
  P('Summary: EchoformLite proves the external-FB authoring pattern but is NOT ship-ready. The three ship blockers (mix-rule violation, missing DC trap, unverified denormal bias) must be resolved before this brick — or any downstream brick that inherits this pattern — goes to marketplace. The Padé soft-clip, FB topology, and bypass contract are canon-aligned and carry forward cleanly.'),
];

// ─────────────────────────────────────────────────────────── document
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: ACCENT },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
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
    headers: {
      default: new Header({ children: [new Paragraph({
        children: [new TextRun({ text: 'Sandbox Brick Audit · EchoformLite', size: 16, color: '888888' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Page ', size: 16, color: '888888' }),
                   new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '888888' })],
      })] }),
    },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] }),
      P('Protocol: memory/sandbox_brick_audit_protocol.md · Brick 1 of 7 in audit order (worst-debt first).'),
      ...section1,
      ...section2,
      ...section3,
      ...section4,
      ...section5,
      ...section6,
      ...section7,
    ],
  }],
});

const out = path.join('C:/Users/HEAT2/Desktop/Shags VST/Sandbox_Audits', 'EchoformLite_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
