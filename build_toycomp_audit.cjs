// Sandbox Brick Audit — ToyComp
// Per memory/sandbox_brick_audit_protocol.md (brick 3 of 7).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber,
} = require('docx');

const ACCENT = '2E75B6';
const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const P = (text, opts = {}) => new Paragraph({ spacing: { after: 120 }, ...opts,
  children: [new TextRun({ text, ...(opts.run || {}) })] });
const H = (text, level) => new Paragraph({
  heading: { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 }[level],
  children: [new TextRun(text)] });
const B = (text) => new Paragraph({ numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun(text)] });
const cell = (text, opts = {}) => new TableCell({ borders: BORDERS,
  width: { size: opts.width, type: WidthType.DXA },
  shading: opts.header ? { fill: 'D5E8F0', type: ShadingType.CLEAR } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: (Array.isArray(text) ? text : [text]).map(t =>
    new Paragraph({ children: [new TextRun({ text: String(t), bold: !!opts.header, size: 18 })] })) });
const mkTable = (widths, rows) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths,
  rows: rows.map((r, i) => new TableRow({
    children: r.map((c, j) => cell(c, { width: widths[j], header: i === 0 })) })) });

const title = 'ToyComp — Sandbox Brick Audit';

const section1 = [
  H('1. What it does', 2),
  P('ToyComp is a sandbox-native minimal downward compressor — the second sandbox-native dogfood (per sandbox_core_scope.md Stage B + sandbox_modulation_roadmap.md § 10). Pure feedforward: self-sidechain tap drives `detector` → `envelope` → `gainComputer` → VCA gain via AudioParam `gainMod` → makeup gain → out. Five panel knobs (THRESHOLD, RATIO, ATTACK, RELEASE, MAKEUP) plus five presets (Vocal / Drum Bus / Glue / Pump / Limit). Mono graph (Web Audio default channel handling). Proves the `gainComputer` op works end-to-end and that signal→AudioParam modulation coupling (Stage-B roadmap Type-2) compiles correctly. If a null-test against a hand-coded comp with matched params collapses to silence, ToyComp earns the "dynamics family conformance" claim.'),
];

const section2 = [
  H('2. Applicable memory files', 2),
  P('Doctrine', { run: { bold: true } }),
  B('audio_engineer_mental_model.md — Dynamics system primitive; behavior profile = downward compressor / VCA archetype.'),
  B('ship_blockers.md — bypass contract, denormal tail. Mix-rule + FB gates are N/A (no mix op, no feedback loop).'),
  B('dry_wet_mix_rule.md — N/A (ToyComp is 100% wet by design; no dry/wet control).'),
  P('Canon code', { run: { bold: true } }),
  B('Canon:dynamics §1 — Bram envelope detector (one-pole α = exp(-1/(τ·sr))).'),
  B('Canon:dynamics §2 — 100→1% decay semantics for release time (reference).'),
  B('Canon:dynamics §3 — windowed-RMS compressor with lookahead (NOT used — peak only; documented scope limit).'),
  B('Canon:dynamics §4 — beat detector class (N/A for downward comp).'),
  B('Canon:dynamics §5 — simple peak + stereo-link comp (stereo link NOT implemented — documented scope limit).'),
  B('Canon:utilities §1 — Jon Watte DENORM bias (applied in envelope state).'),
  P('Reference texts', { run: { bold: true } }),
  B('dafx_zolzer_textbook.md Ch.4 — dynamics, Reiss/Zölzer soft-knee formula.'),
  B('jos_pasp_dsp_reference.md — one-pole filter analysis (envelope follower is AR one-pole).'),
  P('Architecture', { run: { bold: true } }),
  B('sandbox_modulation_roadmap.md — Stage-B Type-2 coupling (signal→param) is exactly what this brick demonstrates.'),
  B('sandbox_core_scope.md — Stage-B ops landing (detector / envelope / gainComputer / gain / scaleBy).'),
  P('Project-specific', { run: { bold: true } }),
  B('plugin_template_library.md — ToyComp is the canonical template for the dynamics archetype (downward comp). ManChild green is the shipping-grade reference; ToyComp is the minimum viable sandbox reproduction.'),
  B('N/A — no reverb, no multiband, no sidechain (external), no character saturation at this scope.'),
];

const section3 = [
  H('3. Per-reference compliance check', 2),
  mkTable([380, 1600, 2400, 2500, 1070], [
    ['#', 'Reference', 'What it says', 'What the brick does', 'Verdict'],
    ['1', 'dry_wet_mix_rule.md',
      'Mix inside worklet.',
      'No mix — comp is 100% wet.',
      'N/A'],
    ['2', 'ship_blockers.md §2 (mix rule)',
      'Ship gate.',
      'Same as row 1.',
      'N/A'],
    ['3', 'ship_blockers.md §3 (bypass contract)',
      'Silent bypass with crossfade.',
      'bypassPath gain 5 ms time-constant crossfade; dispose drops node.',
      '✅ PASS'],
    ['4', 'ship_blockers.md §4 (DC rejection under FB)',
      'DC trap in FB loops.',
      'No feedback loop — pure feedforward signal chain.',
      'N/A'],
    ['5', 'ship_blockers.md §5 (FB runaway guard)',
      'Loop must not blow up.',
      'No feedback loop.',
      'N/A'],
    ['6', 'ship_blockers.md §6 (denormal tail)',
      'DENORM=1e-20 on recursive states.',
      'Envelope state has DENORM bias applied on both active (line 132) and silence (line 122) paths. GainComputer is stateless (per-sample function). ✅',
      '✅ PASS'],
    ['7', 'Canon:dynamics §1 (Bram detector)',
      'Envelope follower with separate attack/release α = exp(-1/(τ·sr)).',
      'Exact match: atkAlpha/relAlpha cached, recomputed only on param change; branchless selector per-sample. ✅',
      '✅ PASS'],
    ['8', 'Canon:dynamics §2 (100→1% release semantics)',
      'Release time defined as 99% decay to zero (i.e. time to reach 1% of initial).',
      'Standard τ-63% is used (α = exp(-1/(τ·sr))). Canonical definition differs by ~4.6× — either adjust τ by ln(100)≈4.605 or re-label knob semantics.',
      '⚠️ DEVIATION (labelling)'],
    ['9', 'Canon:dynamics §3 (windowed-RMS + lookahead)',
      'Reference mastering comp: RMS window, lookahead buffer.',
      'Peak only, no lookahead. Documented in Orb header comment as scope limit.',
      '⚠️ DEVIATION (documented)'],
    ['10', 'Canon:dynamics §5 (stereo link)',
      'max(|L|, |R|) detector for linked stereo imaging.',
      'No explicit stereo link — relies on Web Audio default channel handling. Documented scope limit.',
      '⚠️ DEVIATION (documented)'],
    ['11', 'Canon:utilities §1 (Watte DENORM)',
      'DENORM=1e-20 on recursive state.',
      'Applied. Verified lines 122, 132.',
      '✅ PASS'],
    ['12', 'DAFX Zölzer Ch.4 (Reiss soft-knee)',
      'y_dB = x_dB + (1/R - 1)·(over + knee/2)² / (2·knee) inside ±knee/2; y_dB = threshold + over/R above.',
      'Exact formula. Below-knee short-circuits to grDb=0; above-knee uses invRatioMinusOne · over. ✅',
      '✅ PASS'],
    ['13', 'Web Audio AudioParam summation (architectural)',
      'Connecting a signal to an AudioParam sums with its set value.',
      'Clever use: gainComputer outputs (grLin - 1); VCA gain.value = 1 (resting) + signal = grLin. Linear multiplier with no extra `add` op. ✅',
      '✅ PASS (architectural win)'],
    ['14', 'sandbox_modulation_roadmap Type-2',
      'Signal→param coupling primitive.',
      'Exactly what this brick proves end-to-end. ✅',
      '✅ PASS'],
  ]),
];

const section4 = [
  H('4. Ship-gate status', 2),
  mkTable([1800, 900, 1200, 4050], [
    ['Gate', 'Required', 'Status', 'Evidence'],
    ['T1 QC sweep zero FAILs', 'Yes', 'Not-run', 'Sandbox sweep infrastructure not yet targeting bricks; gate on infra, not content.'],
    ['Dry/wet mix rule', 'Yes', 'N/A', 'No mix in brick.'],
    ['Bypass contract', 'Yes', 'Pass', 'bypassPath pattern with 5 ms TC crossfade.'],
    ['DC rejection under FB', 'If FB', 'N/A', 'Pure feedforward.'],
    ['FB runaway guard', 'If FB', 'N/A', 'Pure feedforward.'],
    ['Denormal tail', 'Yes', 'Pass', 'Envelope state + DENORM both branches.'],
    ['Comp-class: gain-reduction monotonicity', 'Dynamics', 'Pass', 'Reiss soft-knee is textbook-monotonic; gainComputer outputs ≤ 0 dB GR everywhere.'],
    ['Comp-class: unity below threshold', 'Dynamics', 'Pass', 'below-knee branch returns grDb=0 → grLin=1 → delta=0 → VCA gain=1.'],
    ['Comp-class: stereo link (if stereo)', 'Dynamics', 'Deferred', 'Mono in current scope. Documented backlog.'],
  ]),
];

const section5 = [
  H('5. Canonical-recipe deviations', 2),
  B('DEV-TC-01 — No windowed-RMS mode (Canon:dynamics §3). Why: peak-only keeps v0 simple. When: Quality — land as gainComputer mode="rms" + env op "mode" param.'),
  B('DEV-TC-02 — No lookahead. Why: no lookahead op exists yet. When: Future — add `lookahead` op (delay + latency-report) to op registry.'),
  B('DEV-TC-03 — No stereo link. Why: sandbox still mono. When: Quality — add `stereoLink` op or fold into detector ("mode":"stereoMax").'),
  B('DEV-TC-04 — Release tau semantics = 63%, not canon §2 99%. Why: textbook one-pole form. When: Quality — either multiply knob-ms by ln(100)/1≈4.605 when setting τ, or re-label semantics.'),
  B('DEV-TC-05 — No auto-release / program-dependent release. Why: scope. When: Future — can be expressed as a second slower envelope summed into release τ.'),
  B('DEV-TC-06 — GR metering not exposed. Why: sandbox UI has no meter primitive yet. When: Future — add `readout` op + panel-binding.'),
];

const section6 = [
  H('6. Findings', 2),
  P('Ship blockers (must fix before publish)', { run: { bold: true } }),
  B('(none) — ToyComp has no FB loop, no mix op, and the required primitives (bypass, denormal, canon-aligned detector/envelope/gainComputer) all PASS. This is the cleanest brick in the audit so far.'),
  P('Quality (land before next review)', { run: { bold: true } }),
  B('F-TC-Q-01 — Reconcile release τ semantics (63% vs canon §2 99%). One-line coefficient adjustment OR label-only fix; pick one and document.'),
  B('F-TC-Q-02 — Null-test vs. hand-coded peak comp at matched params (expect ≤ -80 dB null; confirms compiler conformance for Stage-B signal→param coupling).'),
  B('F-TC-Q-03 — T1 QC sweep target once sweep infrastructure exists.'),
  P('Future (logged in qc_backlog.md)', { run: { bold: true } }),
  B('F-TC-F-01 — RMS detector mode per Canon:dynamics §3.'),
  B('F-TC-F-02 — Lookahead op (delay + latency-report) → unlocks "mastering" tier.'),
  B('F-TC-F-03 — Stereo link — unblocks any stereo dynamics plugin.'),
  B('F-TC-F-04 — Auto-release / program-dependent release (Canon:dynamics §2 decay semantics).'),
  B('F-TC-F-05 — GR metering primitive (`readout` op).'),
  B('F-TC-F-06 — External sidechain port on the brick (not self-SC only).'),
];

const section7 = [
  H('7. Sign-off', 2),
  mkTable([2600, 6350], [
    ['Field', 'Value'],
    ['Audit author', 'Claude'],
    ['Audit date', '2026-04-23'],
    ['Audit SHA', 'HEAD (sandbox-brick-audit-protocol sweep)'],
    ['Verdict', 'GREEN-WITH-DEBT — no ship blockers, documented scope limits'],
    ['Debt-logged', 'qc_backlog.md rows to add: F-TC-Q-01…03, F-TC-F-01…06'],
    ['User sign-off required?', 'YES — GREEN-WITH-DEBT requires user confirmation per ship_blockers.md. Claude never self-waives.'],
  ]),
  P(''),
  P('Summary: ToyComp is the strongest audit outcome so far. Canon-aligned DSP in every op (Bram envelope, Reiss soft-knee, Watte denormal), no FB hazards by design, clever Web Audio architectural win with gainComputer output summing into VCA unity-gain param. No ship blockers. All deviations are documented scope limits, not canon violations. Recommended as the canonical dynamics template for the plugin template library once the release-semantics fix (F-TC-Q-01) lands.'),
];

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
        children: [new TextRun({ text: 'Sandbox Brick Audit · ToyComp', size: 16, color: '888888' })],
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
      P('Protocol: memory/sandbox_brick_audit_protocol.md · Brick 3 of 7.'),
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

const out = path.join('C:/Users/HEAT2/Desktop/Shags VST/Sandbox_Audits', 'ToyComp_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
