// Sandbox Brick Audit — FdnHall
// Per memory/sandbox_brick_audit_protocol.md (brick 2 of 7).
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

const title = 'FdnHall — Sandbox Brick Audit';

const section1 = [
  H('1. What it does', 2),
  P('FdnHall is a Tier-3 sandbox-native stereo FDN hall reverb built as a single monolithic `fdnReverb` op (Path A, per sandbox_core_scope.md). Port of morphReverbEngine.js. DSP stack: stereo pre-delay (≤65 ms, SIZE-scaled) → two 4-step DiffuserHalfLengths (tight 30/15/7.5/3.75 ms and loose 80/40/20/10 ms, MORPH-blended equal-power) → 8-channel FDN with Householder feedback matrix, exponentially-spaced delays 100–200 ms → per-channel 1st-order HF shelf (crossover 1.5 kHz, TONE sets HF/LF decay ratio) → fractional-delay LFO modulation on even channels (WARP, 0.15/0.22/0.31/0.44 Hz) → 8-tap stereo-spread early reflections tapped from diffused signal → equal-power dry/wet mix inside the worklet. Seven panel knobs (MORPH, SIZE, DECAY, TONE, DENSITY, WARP, MIX), all k-rate with one-pole block-level smoothing (α=0.85). Stereo in / stereo out.'),
];

const section2 = [
  H('2. Applicable memory files', 2),
  P('Doctrine', { run: { bold: true } }),
  B('dry_wet_mix_rule.md — equal-power mix inside worklet; no external dry leg.'),
  B('ship_blockers.md — per-plugin gates + reverb-class conditional gates (RT60 sanity, DC rejection under FB, denormal tail).'),
  B('audio_engineer_mental_model.md — Space system primitive; behavior profile = hall / bloom.'),
  P('Canon code', { run: { bold: true } }),
  B('Canon:analysis §3 — Fast Walsh-Hadamard Transform (ship-critical for FDN diffusion matrix). Directly used.'),
  B('Canon:utilities §1 — Jon Watte DENORM = 1e-20 (ship-critical for FDN tails). Applied to shelf state.'),
  B('Canon:character §11 — Padé rational tanh (NOT used for FB safety; hard clip ±1.8 used instead — deviation).'),
  B('Canon:time_interp §2/§3 — Hermite / Niemitalo cubic (NOT used; linear interp on fractional delay — documented deviation).'),
  B('Canon:synthesis §6 — coupled sin/cos LFO (NOT used; Math.sin per-sample — tolerable at these rates, backlog upgrade).'),
  P('Reference texts', { run: { bold: true } }),
  B('jos_pasp_dsp_reference.md — FDN topology, Householder/Hadamard feedback matrices, stability analysis.'),
  B('jos_pasp_physical_modeling.md — SDN / scattering junction parallels.'),
  B('dafx_zolzer_textbook.md Ch.5 — spatial effects + FDN; Ch.2 — delay lines.'),
  P('Architecture', { run: { bold: true } }),
  B('reverb_engine_architecture.md — Geraint Luff FDN standard. ALL reverbs must use this. FdnHall = canonical template instance.'),
  B('sandbox_core_scope.md — Path A monolithic op; re-decomposition deferred to Stage 3 master-worklet compiler.'),
  B('sandbox_modulation_roadmap.md — Type-2 (signal→param) / Type-4 (LFO) roadmap; FdnHall uses raw LFOs, not yet routed through canonical control graph.'),
  P('Project-specific', { run: { bold: true } }),
  B('plugin_template_library.md — FdnHall = first reverb-family template; all downstream reverbs (hall/plate/spring variants) will fork from this brick.'),
  B('feedback_unique_plugins.md — must have distinctive sonic character; MORPH / WARP / DENSITY provide identity vs generic FDN.'),
];

const section3 = [
  H('3. Per-reference compliance check', 2),
  mkTable([380, 1600, 2400, 2500, 1070], [
    ['#', 'Reference', 'What it says', 'What the brick does', 'Verdict'],
    ['1', 'dry_wet_mix_rule.md',
      'Mix computed inside worklet, same-sample raw input as dry.',
      'dryCoeff = cos(mx·π/2), wetCoeff = sin(mx·π/2); both applied inside worklet process loop on sample-accurate raw input. Single-node graph so no external mix op.',
      '✅ PASS'],
    ['2', 'ship_blockers.md §2 (mix rule)',
      'Ship gate.',
      'Same as row 1.',
      '✅ PASS'],
    ['3', 'ship_blockers.md §4 (DC rejection under FB)',
      'Feedback path must have DC trap.',
      'No explicit HP in FB loop. Per-channel filter is 1-pole LP (shelf), not HP. At decay≥0.99 / g≈0.9998, DC can circulate indefinitely. Hadamard spreads DC across 8 channels but does not kill it.',
      '❌ FAIL'],
    ['4', 'ship_blockers.md §5 (FB runaway guard)',
      'Loop must not blow up under fb≥1 / DC / denormal.',
      'Hard clip ±1.8 on per-channel FB write provides bounded amplitude. Output safety tanh at 0.98. Functional guard, but hard-branched rather than smooth.',
      '⚠️ DEVIATION (works, non-canonical)'],
    ['5', 'ship_blockers.md §6 (denormal tail)',
      'DENORM=1e-20 on recursive states.',
      'DENORM added on per-channel shelf state (fsh[c] += coeff·(mix[c]-fsh[c]) + DENORM). Delay buffers are Float32 — zero-init safe. LFO phase / ER buffers non-recursive.',
      '✅ PASS'],
    ['6', 'Canon:analysis §3 (FWHT)',
      'N=8 butterfly + 1/√8 normalization.',
      'Hand-unrolled 3-stage butterfly, s = 0.35355339059327373. Bit-exact to canon.',
      '✅ PASS'],
    ['7', 'Canon:utilities §1 (Watte DENORM)',
      'DENORM=1e-20 on recursive state.',
      'Applied to shelf state. Verified line 729.',
      '✅ PASS'],
    ['8', 'Canon:character §11 (Padé)',
      'Soft-clip kernel x·(27+x²)/(27+9x²).',
      'NOT used for FB limiter. Hard clip ±1.8 instead. Should swap to Padé for smoother behaviour at high decay.',
      '❌ FAIL (minor — behavioural)'],
    ['9', 'Canon:time_interp §2 (Hermite)',
      '4-tap Hermite for fractional delay under modulation.',
      'Linear interp (line 718: del[c] = fb[c][r0] + fr·(fb[c][r1]-fb[c][r0])). Adequate at 0.15–0.44 Hz / modAmt≤22 samples but contributes audible dulling on WARP near max.',
      '⚠️ DEVIATION (documented, upgrade path)'],
    ['10', 'Canon:synthesis §6 (coupled sin/cos LFO)',
      'Drift-free coupled oscillator for LFOs.',
      'Uses Math.sin(phase) directly. At 0.15 Hz × 48 kHz SR phase drift is negligible over seconds, but coupled form would be cheaper + canonical.',
      '⚠️ DEVIATION (documented, backlog)'],
    ['11', 'reverb_engine_architecture.md',
      'Luff FDN: Hadamard diffusion, Householder FB, HF shelf, RT60 formula, ranges.',
      'Hadamard ✅, Householder (f=sum·0.25) ✅, per-channel shelf @ 1.5 kHz ✅, RT60 = 0.3·100^decay ✅, 8-ch ✅, ER from diffused ✅.',
      '✅ PASS'],
    ['12', 'jos_pasp / dafx Ch.5 (FDN stability)',
      'Householder matrix is lossless under unit-modulus; feedback gain must be <1 per eigenvalue.',
      'g_dc capped at 0.9998 (below unity). Householder lossless. Stable by construction modulo DC concern above.',
      '✅ PASS'],
    ['13', 'sandbox_modulation_roadmap.md (Type-4 LFO)',
      'LFO primitives routed through canonical control graph.',
      'LFOs internal to worklet, not exposed on control graph. Acceptable for Path-A monolithic op.',
      'N/A (by design — redecomposed in Stage 3)'],
  ]),
];

const section4 = [
  H('4. Ship-gate status', 2),
  mkTable([1800, 900, 1200, 4050], [
    ['Gate', 'Required', 'Status', 'Evidence'],
    ['T1 QC sweep zero FAILs', 'Yes', 'Not-run', 'Sandbox QC sweep does not yet target bricks directly. Block on sweep infrastructure, not on FdnHall content.'],
    ['Dry/wet mix rule', 'Yes', 'Pass', 'Equal-power inside worklet, same-sample raw dry. Lines 651–652, 743–744.'],
    ['Bypass contract', 'Yes', 'Pass', 'bypassPath gain 5 ms time-constant crossfade; dispose drops node + disconnects.'],
    ['DC rejection under FB', 'Reverb (yes)', 'FAIL', 'No HP trap. Fix: add 1-pole HP @ ~5 Hz on each channel BEFORE shelf, OR at FB write input.'],
    ['FB runaway guard', 'Reverb (yes)', 'Deviation-Pass', 'Hard clip ±1.8 works; upgrade to Padé soft-clip per Canon:character §11.'],
    ['Denormal tail', 'Yes', 'Pass', 'DENORM on shelf state line 729. No other recursive float64 states.'],
    ['RT60 sanity (reverb)', 'Reverb', 'Pass', 'Formula 0.3·100^decay; range 0.3 s → 30 s; freeze at decay≥0.99 with g=0.9998.'],
    ['Stereo correctness (reverb)', 'Reverb', 'Pass', 'Stereo pre-delay, ER taps have distinct L/R weights (erTapWL/WR), mono input upmixed via iR=iL fallback.'],
  ]),
];

const section5 = [
  H('5. Canonical-recipe deviations', 2),
  B('DEV-FH-01 — FB limiter is hard clip ±1.8, not Padé soft-clip. Why: simpler port from reference engine. When: Quality tier; swap for Padé per Canon:character §11 — one-line change, improves character at high-decay extremes.'),
  B('DEV-FH-02 — Fractional-delay interpolation is linear, not Hermite. Why: lower CPU cost in monolithic op. When: Quality tier; upgrade to Canon:time_interp §2 Hermite if WARP at max sounds dull.'),
  B('DEV-FH-03 — LFO uses Math.sin(phase) per-sample instead of canonical coupled sin/cos. Why: readability. When: Quality tier; swap to Canon:synthesis §6. Negligible audible effect at these rates.'),
  B('DEV-FH-04 — Output safety tanh hard-branched at 0.98. Why: only activate on extreme output. When: parkable (Future).'),
  B('DEV-FH-05 — LFOs not routed through sandbox control graph. Why: Path-A monolithic design per sandbox_core_scope.md. When: retires on Stage-3 master-worklet compiler + re-decomposition.'),
  B('DEV-FH-06 — Seven random() calls in _buildDiffuser constructor (diffuser delay times + flip polarity). Non-deterministic across brick instances. Why: adds diffusion character variety. When: Future — accept Luff-style non-determinism OR seed PRNG (Canon:synthesis §10) for reproducibility.'),
];

const section6 = [
  H('6. Findings', 2),
  P('Ship blockers (must fix before publish)', { run: { bold: true } }),
  B('F-FH-SB-01 — No DC trap in FB loop. Fix: add a 1-pole HP (~5 Hz, coeff = 1 - exp(-2π·5/sr)) applied to each channel BEFORE the FB write OR before the shelf. Small addition, low CPU. Required by ship_blockers.md §4 and conditional reverb gate.'),
  P('Quality (land before next review)', { run: { bold: true } }),
  B('F-FH-Q-01 — Swap hard clip ±1.8 → Padé soft-clip (Canon:character §11). Shared fix pattern with EchoformLite.'),
  B('F-FH-Q-02 — Add T1 QC runner target for FdnHall once sweep infrastructure exists.'),
  B('F-FH-Q-03 — Stability fuzz: 60 s of DC + silence + white at decay=1.0 / decay=0.995; confirm no blow-up, no NaN, no denormal slow-down on tail.'),
  B('F-FH-Q-04 — Null-test FdnHall via compileGraphToWebAudio against the same FDN graph — sanity-check the compiler on stereo monolithic ops.'),
  P('Future (logged in qc_backlog.md)', { run: { bold: true } }),
  B('F-FH-F-01 — Hermite fractional-delay per Canon:time_interp §2 when WARP dulling becomes audible.'),
  B('F-FH-F-02 — Coupled sin/cos LFO per Canon:synthesis §6.'),
  B('F-FH-F-03 — Seeded diffuser PRNG (Canon:synthesis §10) if reproducibility becomes a template requirement.'),
  B('F-FH-F-04 — Re-decompose into primitives (delay / hadamard / householder / shelf / scale / mix) once master-worklet compiler lands (Stage 3, sandbox_core_scope.md).'),
  B('F-FH-F-05 — Route internal LFOs through control graph once sandbox_modulation_roadmap Type-4 primitives ship.'),
];

const section7 = [
  H('7. Sign-off', 2),
  mkTable([2600, 6350], [
    ['Field', 'Value'],
    ['Audit author', 'Claude'],
    ['Audit date', '2026-04-23'],
    ['Audit SHA', 'HEAD (FdnHall landing + audit-protocol ritual)'],
    ['Verdict', 'RED — one ship blocker (DC rejection under FB)'],
    ['Debt-logged', 'qc_backlog.md rows to add: F-FH-SB-01, F-FH-Q-01…04, F-FH-F-01…05'],
    ['User sign-off required?', 'YES — RED verdict. Claude never self-waives per ship_blockers.md.'],
  ]),
  P(''),
  P('Summary: FdnHall is the strongest sandbox brick to date. Luff FDN topology is canonical, Hadamard is bit-exact to Canon:analysis §3, denormal bias is present, mix rule is satisfied by construction (monolithic + in-worklet equal-power). The one ship blocker is a missing DC trap in the feedback loop — a ~3-line fix. Quality-tier deviations (hard clip → Padé, linear → Hermite, Math.sin → coupled LFO) are all documented and do not compromise the sonic identity. This brick is the canonical template for the reverb family; the DC trap fix must land before any downstream reverb forks from it.'),
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
        children: [new TextRun({ text: 'Sandbox Brick Audit · FdnHall', size: 16, color: '888888' })],
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
      P('Protocol: memory/sandbox_brick_audit_protocol.md · Brick 2 of 7.'),
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

const out = path.join('C:/Users/HEAT2/Desktop/Shags VST/Sandbox_Audits', 'FdnHall_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
