// Sandbox Brick Audit — LofiLight
// Per memory/sandbox_brick_audit_protocol.md (brick 4 of 7).
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

const title = 'LofiLight — Sandbox Brick Audit';

const section1 = [
  H('1. What it does', 2),
  P('LofiLight is a sandbox-native ~35% slice of the Lofi Loofy character plugin. Highest op-count brick to date (11 ops). Main wet chain: IN → shelf (tilt) → filter (tone LP) → saturate (Padé + 4× OS) → delay (tape) → bitcrush → filter (rate LP) → mix.wet. Parallel modulation bus: LFO → scaleBy (drift depth) → delay.timeMod. Parallel noise bus: noise (pink, Kellet) → scaleBy (dust level) → out (summed POST-mix, so dust survives MIX=0). Dry leg: IN → mix.dry. Seven panel knobs (TONE, DRIVE, DRIFT, DUST, BITS, RATE, MIX). Mono in / mono out. First brick to exercise multi-op character chains + LFO-driven Type-4 modulation + parallel buses in one graph. Explicit v0 limit (acknowledged in code comments): mix=0 will NOT null because wet path has ~1 quantum of group-delay from the 4× OS WaveShaper.'),
];

const section2 = [
  H('2. Applicable memory files', 2),
  P('Doctrine', { run: { bold: true } }),
  B('dry_wet_mix_rule.md — NON-NEGOTIABLE. Brick has external dry leg → mix op → latent wet path; explicit violation.'),
  B('ship_blockers.md — §2 mix rule, §6 denormal tail are the active gates here.'),
  B('audio_engineer_mental_model.md — Character system primitive; multiple sub-systems (Tone / Dynamics-like crush / Space via modulated delay / Movement via LFO drift).'),
  P('Canon code', { run: { bold: true } }),
  B('Canon:character §11 — Padé rational tanh. Used in saturate op via WaveShaper curve (makeSatCurve). Verified.'),
  B('Canon:time_interp §7 (de Soras halfband 2× OS) — 4× oversample used via browser\'s WaveShaperNode oversample="4x" (polyphase halfband cascade).'),
  B('Canon:synthesis §7 — Trammell pink noise (alternative). LofiLight uses Paul Kellet pink filter (7-pole + white bypass) — different canonical reference, same -3 dB/oct target.'),
  B('Canon:filters §9 (RBJ Cookbook) — `filter` op uses BiquadFilterNode (browser native Cookbook); tone LP + rate LP = two instances.'),
  B('Canon:synthesis §6 — coupled sin/cos LFO (NOT used; sandbox-lfo uses phase+Math.sin per sample — drift-tolerant at LFO rates).'),
  B('Canon:utilities §1 — Watte DENORM. Noise states always fed fresh white → no subnormal risk. Delay buffer Float32 zero-init — safe. Filter states are native Biquad (browser-managed).'),
  P('Reference texts', { run: { bold: true } }),
  B('dafx_zolzer_textbook.md Ch.12.5 — tape/valve NL, bit-crush, tape-saturation archetypes.'),
  B('dafx_zolzer_textbook.md Ch.2 — tape delay topology.'),
  B('jos_pasp_dsp_reference.md — interpolation theory for delay.timeMod.'),
  P('Architecture', { run: { bold: true } }),
  B('sandbox_core_scope.md — LofiLight = extended dogfood, biggest op-count target for the chain-of-worklets compiler.'),
  B('sandbox_modulation_roadmap.md — Type-4 (LFO→param) coupling demonstrated via drift bus.'),
  B('authoring_runtime_precedent.md — multi-op wet chains through the sandbox are the test case for master-worklet codegen (Stage 3).'),
  P('Project-specific', { run: { bold: true } }),
  B('plugin_template_library.md — LofiLight is the canonical template for "multi-system character" archetype. All downstream Lofi variants will fork from this brick.'),
  B('feedback_unique_plugins.md — DRIFT + DUST + crush pairing supplies distinctive identity vs. generic tape plugins.'),
];

const section3 = [
  H('3. Per-reference compliance check', 2),
  mkTable([380, 1600, 2400, 2500, 1070], [
    ['#', 'Reference', 'What it says', 'What the brick does', 'Verdict'],
    ['1', 'dry_wet_mix_rule.md',
      'Mix inside worklet, same-sample raw dry. External dry legs forbidden because of group-delay mismatch.',
      'External dry leg via IN→mix.dry. Wet chain routes through 4× OS WaveShaper (~120–200 sample latency) + 3 biquads + delay. Group-delay mismatch → comb-filter at MIX ≈ 50%. EXPLICITLY acknowledged in Orb header comment.',
      '❌ FAIL'],
    ['2', 'ship_blockers.md §2 (mix rule)',
      'Ship gate.',
      'Same as row 1.',
      '❌ FAIL'],
    ['3', 'ship_blockers.md §3 (bypass contract)',
      'Silent bypass with crossfade.',
      'bypassPath gain 5 ms TC. Dispose also drops dust/drift sidechains via compiler tree.',
      '✅ PASS'],
    ['4', 'ship_blockers.md §4 (DC rejection under FB)',
      'DC trap required inside feedback loops.',
      'delay.feedback = 0 — no FB loop anywhere in LofiLight. Tape delay is a pure delay line.',
      'N/A'],
    ['5', 'ship_blockers.md §5 (FB runaway guard)',
      'Loop limiter required.',
      'No loop.',
      'N/A'],
    ['6', 'ship_blockers.md §6 (denormal tail)',
      'DENORM=1e-20 on all recursive states.',
      'Noise: pink Kellet filter states always receive fresh white (Math.random per sample) — states physically can\'t starve to subnormal. Brown: clamped ±1. Delay buffer: Float32 zero-init — safe. Biquads: native browser BiquadFilterNode manages own state.',
      '✅ PASS'],
    ['7', 'Canon:character §11 (Padé)',
      'x·(27+x²)/(27+9x²) soft-clip, C² continuous on [-3,3], hard-clip beyond.',
      'Implemented exactly in makeSatCurve (compileGraphToWebAudio.js:64–84). WaveShaper curve normalized so k=drive maps to ±1. ✅',
      '✅ PASS'],
    ['8', 'Canon:time_interp §7 (de Soras halfband)',
      '2× or 4× oversample via polyphase halfband FIR cascade around non-linearity.',
      'WaveShaperNode.oversample = "4x" — browser runs native polyphase halfband cascade. Implementation-defined latency (hence mix-rule cost). ✅',
      '✅ PASS'],
    ['9', 'Canon:synthesis §7 (Trammell pink)',
      'Voss-McCartney / Trammell pink generator.',
      'Uses Paul Kellet instead — different canonical pink recipe, equivalent -3 dB/oct target, both accepted. Document as canon-adjacent, not failure.',
      '⚠️ DEVIATION (canon-adjacent)'],
    ['10', 'Canon:filters §9 (RBJ)',
      'Cookbook biquads.',
      'Native BiquadFilterNode (browser Cookbook impl). ✅',
      '✅ PASS'],
    ['11', 'Canon:synthesis §6 (coupled sin/cos LFO)',
      'Drift-free coupled osc.',
      'Uses phase + Math.sin per-sample. At 0.5 Hz over reasonable session lengths drift is < ULP. Backlog upgrade.',
      '⚠️ DEVIATION (documented)'],
    ['12', 'Canon:utilities §1 (Watte DENORM)',
      'DENORM on recursive states.',
      'No recursive float64 state at risk of subnormal — see row 6 analysis. Verified safe by construction.',
      '✅ PASS'],
    ['13', 'DAFX Zölzer Ch.12.5',
      'Tape sat + bit-crush + sample-rate reduction topology.',
      'Sat (Padé) → tape delay → bitcrush (WaveShaper staircase) → rate (LP as ZOH proxy per LL §4.5). ✅ textbook.',
      '✅ PASS'],
    ['14', 'sandbox_modulation_roadmap Type-4 (LFO→param)',
      'LFO routed through curve/scaleBy into op AudioParam.',
      'LFO → scaleBy(k) → tape.timeMod. Exactly the Type-4 pattern. ✅',
      '✅ PASS'],
    ['15', 'Bitcrush bypass semantics',
      'bits=0 must pass signal unchanged.',
      'Staircase curve generator short-circuits to identity line when bits ≤ 0. Verified.',
      '✅ PASS'],
    ['16', 'Rate-LP bypass semantics',
      'LP at 20 kHz = effectively inaudible at 48 kHz SR (near-transparent).',
      'Knob at 0 maps to cutoff=20 kHz — transparent enough for dogfood. Not bit-exact bypass. Quality-tier.',
      '⚠️ DEVIATION (transparent, not bit-exact)'],
  ]),
];

const section4 = [
  H('4. Ship-gate status', 2),
  mkTable([1800, 900, 1200, 4050], [
    ['Gate', 'Required', 'Status', 'Evidence'],
    ['T1 QC sweep zero FAILs', 'Yes', 'Not-run', 'No sandbox sweep runner for bricks yet.'],
    ['Dry/wet mix rule', 'Yes', 'FAIL', 'External dry leg + 4× OS in wet chain. Fix options: (a) fold entire wet chain into master worklet with internal equal-power mix (Stage-3 codegen solves this for free); (b) emit per-op group-delay reports and have compiler insert a dry-delay match node before mix.dry; (c) document as preview-only and gate MIX knob from publish. Note: acknowledged in-code.'],
    ['Bypass contract', 'Yes', 'Pass', 'Standard bypassPath pattern.'],
    ['DC rejection under FB', 'If FB', 'N/A', 'No FB.'],
    ['FB runaway guard', 'If FB', 'N/A', 'No FB.'],
    ['Denormal tail', 'Yes', 'Pass', 'Verified safe by construction.'],
    ['Saturate: bounded output', 'Character', 'Pass', 'Padé + normalization + WaveShaper natural clamp beyond curve range.'],
    ['Bitcrush: clean bypass at bits=0', 'Character', 'Pass', 'Identity-curve short-circuit in compileGraph factory.'],
    ['Rate: clean bypass at knob=0', 'Character', 'Near-pass', 'LP @ 20 kHz ≈ transparent, not bit-exact. Acceptable for dogfood.'],
  ]),
];

const section5 = [
  H('5. Canonical-recipe deviations', 2),
  B('DEV-LL-01 — Mix rule violation. Why: sandbox graph composition uses external dry leg + wet chain (4× OS adds latency). When: Ship blocker. Resolution path: Stage-3 master-worklet codegen naturally folds the whole chain into one worklet with internal mix — fix comes free with that milestone. Interim: document as preview-only; do not publish.'),
  B('DEV-LL-02 — Pink noise uses Paul Kellet filter, not Canon:synthesis §7 Trammell. Why: Kellet is canonical/equivalent and already in use. When: Future — both are accepted "pink" recipes; pick one as library standard and standardize across plugins.'),
  B('DEV-LL-03 — LFO uses phase+Math.sin, not canon §6 coupled osc. Why: readable, drift negligible at LFO rates. When: Future.'),
  B('DEV-LL-04 — Rate LP at knob=0 maps to cutoff=20 kHz, not bit-exact bypass. Why: simpler than adding a bypass toggle. When: Quality — compiler could emit a Ø-tap identity when a filter-op\'s cutoff pins to SR/2.'),
  B('DEV-LL-05 — Tape delay (n_tape) has no saturation/filter in loop — it\'s just a pure delay. Lofi Loofy\'s real tape has in-loop NL + HF rolloff. Why: LofiLight is a 35% slice; in-loop character tracked for v1. When: Future — requires the full tape op (delay+filter+sat fused, per memory authorship) once chain-of-worklets can host feedback.'),
  B('DEV-LL-06 — No parallel comp / no reverb / no boom primitive. Why: scope — sandbox_core_scope.md explicitly lists this as 35% coverage. When: Future (post-Stage-3).'),
];

const section6 = [
  H('6. Findings', 2),
  P('Ship blockers (must fix before publish)', { run: { bold: true } }),
  B('F-LL-SB-01 — Mix rule violation (comb-filter at mid-mix). Acknowledged. Fix path: Stage-3 master-worklet codegen folds the chain → internal mix → rule satisfied. Alternatively: document LofiLight as sandbox-preview-only and block publish via marketplace gate.'),
  P('Quality (land before next review)', { run: { bold: true } }),
  B('F-LL-Q-01 — Bit-exact bypass on rate filter at knob=0 (teach compiler to emit identity when filter-cutoff pins to SR/2).'),
  B('F-LL-Q-02 — Shared `dcBlock` primitive (outcome of EchoformLite+FdnHall findings) — not needed here but worth verifying shelf state doesn\'t drift under DC at high tilt gain.'),
  B('F-LL-Q-03 — T1 QC sweep target once sweep infrastructure exists.'),
  B('F-LL-Q-04 — Null-test LofiLight bypass-path (MIX=1 = fully wet) vs. hand-wired chain of same ops — proves compiler determinism at high op count.'),
  P('Future (logged in qc_backlog.md)', { run: { bold: true } }),
  B('F-LL-F-01 — Pink noise canon standardization (Trammell vs Kellet).'),
  B('F-LL-F-02 — Coupled sin/cos LFO.'),
  B('F-LL-F-03 — Full tape delay with in-loop NL + HF rolloff (requires Stage-3 FB-cycle compiler).'),
  B('F-LL-F-04 — Remaining 65% of LL: character presets, parallel comp, dream reverb, boom/bits/rate macros.'),
  B('F-LL-F-05 — Consider routing dust through mix (not post-mix) if Lofi Loofy canonical topology says so — verify against LL engine_v1.'),
];

const section7 = [
  H('7. Sign-off', 2),
  mkTable([2600, 6350], [
    ['Field', 'Value'],
    ['Audit author', 'Claude'],
    ['Audit date', '2026-04-23'],
    ['Audit SHA', 'HEAD (sandbox-brick-audit-protocol sweep)'],
    ['Verdict', 'RED — one ship blocker (mix rule, acknowledged in code)'],
    ['Debt-logged', 'qc_backlog.md rows to add: F-LL-SB-01, F-LL-Q-01…04, F-LL-F-01…05'],
    ['User sign-off required?', 'YES — RED verdict. Claude never self-waives per ship_blockers.md.'],
  ]),
  P(''),
  P('Summary: LofiLight is the strongest multi-op stress-test of the sandbox so far. Padé soft-clip + 4× OS + Kellet pink + Cookbook biquads + LFO→delay.timeMod Type-4 coupling all land canon-aligned. No denormal hazards (analyzed by construction). The single ship blocker is the mix-rule violation — already a known issue, and already has a known fix path via Stage-3 master-worklet codegen. That makes LofiLight the primary motivation for prioritizing Stage-3, and the brick that most benefits from it. Until then: sandbox-preview only, no publish.'),
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
        children: [new TextRun({ text: 'Sandbox Brick Audit · LofiLight', size: 16, color: '888888' })],
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
      P('Protocol: memory/sandbox_brick_audit_protocol.md · Brick 4 of 7.'),
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

const out = path.join('C:/Users/HEAT2/Desktop/Shags VST/Sandbox_Audits', 'LofiLight_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
