// Sandbox Brick Audit — FilterFX
// Per memory/sandbox_brick_audit_protocol.md (brick 6 of 7).
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

const title = 'FilterFX — Sandbox Brick Audit';

const section1 = [
  H('1. What it does', 2),
  P('FilterFX is the Step-2e panel-mapping demonstration brick — the thinnest real brick in the sandbox. Three-op graph: gain (unity) → filter (biquad LP, cutoff 200 Hz–12 kHz) → mix.wet; in → mix.dry. Single panel knob (TONE) driving filter.cutoff via log taper. Its value is demonstrating the panel→op-param mapping layer: author-side abstraction where the brick exposes ONE knob but the user could still see three ops in brick-zoom view. Structurally identical to SandboxToy; UI is the difference.'),
];

const section2 = [
  H('2. Applicable memory files', 2),
  P('Doctrine', { run: { bold: true } }),
  B('dry_wet_mix_rule.md — external dry leg through `mix` op; same violation class as LofiLight / EchoformLite but with much smaller group-delay mismatch (biquad only).'),
  B('ship_blockers.md — §2 mix rule, §3 bypass.'),
  B('audio_engineer_mental_model.md — Tone system primitive; behavior profile = LP sweeper.'),
  P('Canon code', { run: { bold: true } }),
  B('Canon:filters §9 (RBJ Cookbook) — native BiquadFilterNode uses browser Cookbook implementation.'),
  B('Canon:utilities §1 — no recursive float64 state under author control (native biquad managed by browser).'),
  P('Reference texts', { run: { bold: true } }),
  B('dafx_zolzer_textbook.md Ch.2 — biquad filter structures.'),
  B('jos_pasp_dsp_reference.md — biquad topology + group-delay analysis.'),
  P('Architecture', { run: { bold: true } }),
  B('sandbox_core_scope.md — Step 2e panel-mapping; FilterFX = canonical demonstration of the panel layer.'),
  B('plugin_template_library.md — FilterFX is a template for "single-knob filter FX" archetype.'),
  B('N/A — no modulation, no FB, no character, no stereo, no reverb.'),
];

const section3 = [
  H('3. Per-reference compliance check', 2),
  mkTable([380, 1600, 2400, 2500, 1070], [
    ['#', 'Reference', 'What it says', 'What the brick does', 'Verdict'],
    ['1', 'dry_wet_mix_rule.md',
      'Mix computed inside worklet; external dry legs forbidden because group-delay is implementation-defined.',
      'External dry leg via IN→mix.dry. Wet chain = gain + biquad; biquad adds a few samples of group delay at low Q. Mismatch is smaller than LofiLight (no OS, no delay line) but still non-zero and rule-forbidden.',
      '❌ FAIL (small magnitude)'],
    ['2', 'ship_blockers.md §2 (mix rule)',
      'Ship gate.',
      'Same as row 1.',
      '❌ FAIL'],
    ['3', 'ship_blockers.md §3 (bypass)',
      'Silent bypass crossfade.',
      'Standard bypassPath pattern.',
      '✅ PASS'],
    ['4', 'ship_blockers.md §4 (DC under FB)',
      'DC trap in FB loop.',
      'No FB loop.',
      'N/A'],
    ['5', 'ship_blockers.md §5 (FB runaway)',
      'Loop limiter.',
      'No FB.',
      'N/A'],
    ['6', 'ship_blockers.md §6 (denormal)',
      'DENORM on recursive states.',
      'Biquad state managed by browser; gain is stateless; mix is summation. No author-side recursive state at risk.',
      '✅ PASS'],
    ['7', 'Canon:filters §9 (RBJ Cookbook)',
      'Canonical biquad coefficients for LP/HP/BP/notch/peak/shelf.',
      'Native BiquadFilterNode = browser Cookbook impl. Q=0.707 LP default is textbook Butterworth. ✅',
      '✅ PASS'],
    ['8', 'Filter topology (1-pole vs 2-pole)',
      '2-pole biquad is expected for musical LP sweeps.',
      'Uses full biquad (not 1-pole). ✅ Better than EchoformLite\'s 1-pole LP.',
      '✅ PASS'],
    ['9', 'TONE knob range (200 Hz – 12 kHz)',
      'Musical sweep range.',
      'Log taper, 200 Hz–12 kHz — textbook tone-sweep range.',
      '✅ PASS'],
    ['10', 'Panel-mapping abstraction',
      'One knob should drive one op-param via declarative mapping.',
      'Exactly that: knob.tone → mappings[{ nodeId, paramId, range, curve }]. Canonical demonstration.',
      '✅ PASS (architectural)'],
  ]),
];

const section4 = [
  H('4. Ship-gate status', 2),
  mkTable([1800, 900, 1200, 4050], [
    ['Gate', 'Required', 'Status', 'Evidence'],
    ['T1 QC sweep zero FAILs', 'Yes', 'Not-run', 'No sandbox sweep for bricks yet.'],
    ['Dry/wet mix rule', 'Yes', 'FAIL', 'External dry leg. Impact: smaller than LofiLight (biquad GD only, no OS) but per-rule still a violation.'],
    ['Bypass contract', 'Yes', 'Pass', 'Standard bypassPath.'],
    ['DC rejection under FB', 'If FB', 'N/A', 'No FB.'],
    ['FB runaway guard', 'If FB', 'N/A', 'No FB.'],
    ['Denormal tail', 'Yes', 'Pass', 'No author-side recursive state.'],
    ['Filter-class: bounded response', 'Filter', 'Pass', 'Biquad at Q=0.707 is Butterworth — flat passband, no ringing.'],
    ['Filter-class: stable at cutoff extremes', 'Filter', 'Pass', 'Native biquad clamps coefficients internally.'],
  ]),
];

const section5 = [
  H('5. Canonical-recipe deviations', 2),
  B('DEV-FX-01 — Mix-rule violation via external dry leg. Why: shared compiler-level issue (same as LofiLight, EchoformLite). When: Stage-3 master-worklet codegen resolves for all bricks simultaneously.'),
  B('DEV-FX-02 — Only one filter mode exposed (LP). Why: scope — Step-2e is panel-mapping demo, not filter-feature demo. When: Future — expose filter.mode in panel to unlock HP/BP/notch/peak/shelf.'),
  B('DEV-FX-03 — No Q control. Why: scope. When: Future.'),
  B('DEV-FX-04 — No drive / no post-filter character. Why: scope. When: Future — fork into a FilterDrive variant.'),
];

const section6 = [
  H('6. Findings', 2),
  P('Ship blockers (must fix before publish)', { run: { bold: true } }),
  B('F-FX-SB-01 — Mix-rule violation. Shared with LofiLight/EchoformLite — same Stage-3 codegen fix retires all three.'),
  P('Quality (land before next review)', { run: { bold: true } }),
  B('F-FX-Q-01 — T1 QC sweep target once sweep infrastructure exists.'),
  B('F-FX-Q-02 — Null-test at MIX=1 (100% wet) vs hand-wired biquad — low-hanging proof of compiler determinism on the thinnest graph.'),
  P('Future (logged in qc_backlog.md)', { run: { bold: true } }),
  B('F-FX-F-01 — Expose filter.mode + Q in panel (unlock a true filter plugin archetype).'),
  B('F-FX-F-02 — Add drive/character variant (FilterDrive fork).'),
  B('F-FX-F-03 — Envelope-follower sidechain variant (FilterAuto).'),
];

const section7 = [
  H('7. Sign-off', 2),
  mkTable([2600, 6350], [
    ['Field', 'Value'],
    ['Audit author', 'Claude'],
    ['Audit date', '2026-04-23'],
    ['Audit SHA', 'HEAD (sandbox-brick-audit-protocol sweep)'],
    ['Verdict', 'RED — one ship blocker (mix rule, shared compiler-level issue)'],
    ['Debt-logged', 'qc_backlog.md rows to add: F-FX-SB-01, F-FX-Q-01…02, F-FX-F-01…03'],
    ['User sign-off required?', 'YES — RED verdict. Claude never self-waives per ship_blockers.md.'],
  ]),
  P(''),
  P('Summary: FilterFX is the thinnest meaningful brick in the sandbox. Canon-aligned (RBJ biquad, textbook Butterworth LP, denormal-safe, proper bypass). The single ship blocker is the shared mix-rule violation — same root cause as LofiLight and EchoformLite, same Stage-3 codegen fix retires all three. Audibly the smallest magnitude of the three since there\'s no oversampling and no delay line, just a biquad — but per-rule still a FAIL. Excellent template candidate for single-knob filter FX once the mix-rule fix lands.'),
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
        children: [new TextRun({ text: 'Sandbox Brick Audit · FilterFX', size: 16, color: '888888' })],
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
      P('Protocol: memory/sandbox_brick_audit_protocol.md · Brick 6 of 7.'),
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

const out = path.join('C:/Users/HEAT2/Desktop/Shags VST/Sandbox_Audits', 'FilterFX_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
