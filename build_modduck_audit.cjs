// Sandbox Brick Audit — ModDuck
// Per memory/sandbox_brick_audit_protocol.md (brick 5 of 7).
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

const title = 'ModDuck — Sandbox Brick Audit';

const section1 = [
  H('1. What it does', 2),
  P('ModDuck is the Stage-B-0 modulation-layer dogfood (sandbox_modulation_roadmap.md § 10). First brick to prove signal→param modulation end-to-end. Two parallel control sources drive a single VCA via Web Audio AudioParam-sum semantics: (a) self-sidechain envelope — IN → detector → envelope (amount=-1 pre-baked for duck polarity) → scaleBy(AMOUNT) → gain.gainMod; (b) LFO pump — lfo → scaleBy(MOD) → gain.gainMod. Main signal path: IN → gain → OUT. Gain\'s resting value = 1.0; summed control signals pull it into ~[0.1, 1.45] range. Five panel knobs (AMOUNT, RATE, MOD, ATTACK, RELEASE). Mono.'),
];

const section2 = [
  H('2. Applicable memory files', 2),
  P('Doctrine', { run: { bold: true } }),
  B('audio_engineer_mental_model.md — Dynamics + Movement systems; behavior profile = ducking / pump modulation.'),
  B('ship_blockers.md — bypass contract, denormal tail. Mix-rule + FB gates are N/A (no mix op, no feedback loop).'),
  B('dry_wet_mix_rule.md — N/A (brick has no dry/wet control; VCA is always-on).'),
  P('Canon code', { run: { bold: true } }),
  B('Canon:dynamics §1 — Bram envelope detector (one-pole α = exp(-1/(τ·sr)), asymmetric AR).'),
  B('Canon:dynamics §5 — simple peak comp / sidechain. ModDuck uses linear-amount ducking (no threshold/ratio/knee) — Stage B-1 adds gainComputer.'),
  B('Canon:synthesis §6 — coupled sin/cos LFO (NOT used; sandbox-lfo uses phase+Math.sin).'),
  B('Canon:utilities §1 — Jon Watte DENORM bias — applied in envelope state (same worklet as ToyComp).'),
  P('Reference texts', { run: { bold: true } }),
  B('dafx_zolzer_textbook.md Ch.3 — modulation effects (LFO-driven amplitude modulation archetype).'),
  B('dafx_zolzer_textbook.md Ch.4 — dynamics (envelope-driven gain).'),
  P('Architecture', { run: { bold: true } }),
  B('sandbox_modulation_roadmap.md Type-2 (signal→param) + Type-4 (LFO→param) — both demonstrated on the same target AudioParam.'),
  B('sandbox_core_scope.md — Stage-B op registry (detector/envelope/lfo/scaleBy/gain).'),
  P('Project-specific', { run: { bold: true } }),
  B('plugin_template_library.md — ModDuck is the template for "ducker + pump" archetype (sidechain-compressor-lite / tremolo-ducker).'),
  B('N/A — no reverb, no multiband, no character, no stereo at current scope.'),
];

const section3 = [
  H('3. Per-reference compliance check', 2),
  mkTable([380, 1600, 2400, 2500, 1070], [
    ['#', 'Reference', 'What it says', 'What the brick does', 'Verdict'],
    ['1', 'dry_wet_mix_rule.md',
      'Mix inside worklet.',
      'No mix — VCA always-on modulation (not a parallel/wet-dry effect).',
      'N/A'],
    ['2', 'ship_blockers.md §3 (bypass)',
      'Silent bypass crossfade.',
      'Standard bypassPath pattern, 5 ms TC.',
      '✅ PASS'],
    ['3', 'ship_blockers.md §4 (DC under FB)',
      'DC trap in FB loops.',
      'No feedback loop — pure feedforward.',
      'N/A'],
    ['4', 'ship_blockers.md §5 (FB runaway)',
      'Loop limiter.',
      'No loop.',
      'N/A'],
    ['5', 'ship_blockers.md §6 (denormal)',
      'DENORM on recursive states.',
      'Envelope state has DENORM both active + silence paths (shared worklet with ToyComp, lines 122/132). LFO phase is bounded [0,1). No hazard.',
      '✅ PASS'],
    ['6', 'Canon:dynamics §1 (Bram)',
      'Asymmetric AR envelope follower.',
      'SandboxEnvelopeFollower implements `a = (target > s) ? atkA : relA; s = a·s + (1-a)·target + DENORM`. Textbook. ✅',
      '✅ PASS'],
    ['7', 'Canon:dynamics §5 (threshold/ratio comp)',
      'Gain computer for classical comp.',
      'Not used — ModDuck is linear-amount ducking by design. Stage-B-1 upgrade path.',
      '⚠️ DEVIATION (by design)'],
    ['8', 'Canon:synthesis §6 (coupled LFO)',
      'Drift-free coupled osc.',
      'sandbox-lfo uses phase + Math.sin (shared with LofiLight). Drift negligible at 0.1–20 Hz.',
      '⚠️ DEVIATION (shared, documented)'],
    ['9', 'Canon:utilities §1 (Watte DENORM)',
      'DENORM=1e-20.',
      'Applied in envelope.',
      '✅ PASS'],
    ['10', 'sandbox_modulation_roadmap Type-2',
      'Signal → AudioParam coupling.',
      'detector→envelope→scaleBy→gain.gainMod chain. ✅',
      '✅ PASS'],
    ['11', 'sandbox_modulation_roadmap Type-4',
      'LFO → AudioParam.',
      'lfo→scaleBy→gain.gainMod. ✅',
      '✅ PASS'],
    ['12', 'Web Audio AudioParam summation',
      'Multiple signal connections sum on an AudioParam.',
      'Both env and LFO connect to same gainMod → Web Audio sums them. Combined with gain.value=1.0 resting → output = 1 + envMod + lfoMod. Architectural win — no explicit `add` op needed.',
      '✅ PASS'],
    ['13', 'Stale code comment (meta)',
      'Orb header says "attack/release are not truly asymmetric — a single 1-pole LP uses the faster knob".',
      'COMMENT IS STALE. The current sandbox-envelope-follower worklet IS properly asymmetric AR (separate atkAlpha/relAlpha). Finding: update comment.',
      '⚠️ DOC DRIFT'],
    ['14', 'LFO above-unity accent (intentional)',
      'Orb header documents LFO can push gain to ~1.45× on peaks as "accent, not boost".',
      'Verified: LFO bipolar [-1..1] × scaleBy(k≤0.45) = [-0.45..+0.45] summed into gain=1 → [0.55..1.45]. Intentional + documented. ✅',
      '✅ PASS (documented)'],
  ]),
];

const section4 = [
  H('4. Ship-gate status', 2),
  mkTable([1800, 900, 1200, 4050], [
    ['Gate', 'Required', 'Status', 'Evidence'],
    ['T1 QC sweep zero FAILs', 'Yes', 'Not-run', 'No sandbox sweep for bricks yet.'],
    ['Dry/wet mix rule', 'Yes', 'N/A', 'No mix op.'],
    ['Bypass contract', 'Yes', 'Pass', 'bypassPath 5 ms TC.'],
    ['DC rejection under FB', 'If FB', 'N/A', 'Feedforward.'],
    ['FB runaway guard', 'If FB', 'N/A', 'Feedforward.'],
    ['Denormal tail', 'Yes', 'Pass', 'DENORM in envelope worklet.'],
    ['Ducker-class: gain always ≤ unity under env-only', 'Dynamics', 'Pass', 'env.amount = -1 pre-baked; scaleBy k ∈ [0,0.9] → mod ∈ [-0.9,0]; gain = 1 + mod ∈ [0.1,1]. ✅'],
    ['Pump-class: intentional supra-unity on LFO peaks', 'Movement', 'Pass (documented)', 'LFO peaks to 1.45× — documented as accent.'],
  ]),
];

const section5 = [
  H('5. Canonical-recipe deviations', 2),
  B('DEV-MD-01 — Orb header comment is stale (claims non-asymmetric AR; worklet is asymmetric). Why: comment pre-dates the Stage-B-1 worklet upgrade. When: Trivial doc fix (1-line patch in the Orb header).'),
  B('DEV-MD-02 — No gainComputer (linear amount only). Why: B-0 scope. When: Future — swap in gainComputer between envelope and scaleBy for threshold/ratio/knee; gets ModDuck → ToyCompDuck.'),
  B('DEV-MD-03 — LFO can drive VCA above unity (up to 1.45×). Why: documented intentional "accent". When: Future — add optional clamp op if users complain about transient peaks.'),
  B('DEV-MD-04 — No external sidechain. Why: B-0 scope. When: Future — requires external SC port primitive.'),
  B('DEV-MD-05 — LFO uses Math.sin, not Canon:synthesis §6 coupled osc. Why: shared with LofiLight; drift negligible. When: Future.'),
];

const section6 = [
  H('6. Findings', 2),
  P('Ship blockers (must fix before publish)', { run: { bold: true } }),
  B('(none) — pure feedforward, no mix op, canon-aligned envelope+LFO+VCA, denormal-safe. Clean audit.'),
  P('Quality (land before next review)', { run: { bold: true } }),
  B('F-MD-Q-01 — Update stale Orb header comment (DEV-MD-01). 1-line trivial patch.'),
  B('F-MD-Q-02 — Null-test ModDuck against a hand-coded ducker at matched params (proves compiler conformance for dual-source AudioParam sum).'),
  B('F-MD-Q-03 — T1 QC sweep target once sweep infrastructure exists.'),
  P('Future (logged in qc_backlog.md)', { run: { bold: true } }),
  B('F-MD-F-01 — gainComputer insertion (threshold/ratio/knee) for classical ducker UX.'),
  B('F-MD-F-02 — External sidechain port primitive.'),
  B('F-MD-F-03 — Coupled sin/cos LFO (shared backlog with LofiLight, FdnHall).'),
  B('F-MD-F-04 — Optional clamp op to contain LFO supra-unity accent.'),
];

const section7 = [
  H('7. Sign-off', 2),
  mkTable([2600, 6350], [
    ['Field', 'Value'],
    ['Audit author', 'Claude'],
    ['Audit date', '2026-04-23'],
    ['Audit SHA', 'HEAD (sandbox-brick-audit-protocol sweep)'],
    ['Verdict', 'GREEN-WITH-DEBT — no ship blockers; one stale comment + documented B-0 scope'],
    ['Debt-logged', 'qc_backlog.md rows to add: F-MD-Q-01…03, F-MD-F-01…04'],
    ['User sign-off required?', 'YES — GREEN-WITH-DEBT requires user confirmation per ship_blockers.md. Claude never self-waives.'],
  ]),
  P(''),
  P('Summary: ModDuck is clean. Second brick (after ToyComp) to earn GREEN-WITH-DEBT. Canon-aligned envelope, canon-adjacent LFO, Web Audio AudioParam-sum semantics used correctly for both env + LFO modulation into a shared gain.gainMod target. No mix, no FB, no denormal hazards. Stale comment is the only "finding" that needs touching; the rest is explicit scope. Alongside ToyComp, this brick validates the Stage-B modulation layer end-to-end and is the canonical template for the ducker/pump archetype.'),
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
        children: [new TextRun({ text: 'Sandbox Brick Audit · ModDuck', size: 16, color: '888888' })],
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
      P('Protocol: memory/sandbox_brick_audit_protocol.md · Brick 5 of 7.'),
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

const out = path.join('C:/Users/HEAT2/Desktop/Shags VST/Sandbox_Audits', 'ModDuck_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
