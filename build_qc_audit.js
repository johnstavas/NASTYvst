// Build QC_Rack_Audit.docx — full audit of the QC rack system (tiers T1–T4).
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, HeadingLevel, AlignmentType, LevelFormat,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
} = require('docx');

// ---- helpers -------------------------------------------------------------
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, ...opts })] });
const PR = (parts) => new Paragraph({ spacing: { after: 120 }, children: parts.map((p) => new TextRun(p)) });
const BUL = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 },
  children: Array.isArray(t) ? t.map((p) => new TextRun(p)) : [new TextRun(t)] });
const NUM = (t) => new Paragraph({ numbering: { reference: 'numbers', level: 0 }, spacing: { after: 60 },
  children: [new TextRun(t)] });
const MONO = (t) => new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: t, font: 'Consolas', size: 18 })] });

const thinBorder = { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF' };
const CBORDERS = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function cell(text, { bold = false, shade = null, width = 4680, color = null } = {}) {
  return new TableCell({
    borders: CBORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { fill: shade, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold, color: color || undefined, size: 20 })] })],
  });
}

function tableN(rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((txt, c) => cell(txt, {
        bold: i === 0,
        shade: i === 0 ? '2E3440' : (i % 2 === 0 ? 'F5F5F5' : null),
        color: i === 0 ? 'FFFFFF' : null,
        width: widths[c],
      })),
    })),
  });
}

// ---- content -------------------------------------------------------------
const today = '2026-04-20';
const children = [
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: 'QC RACK SYSTEM — AUDIT', bold: true, size: 44 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
    children: [new TextRun({ text: 'Shags VST · qc-harness subsystem', size: 22, color: '555555' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 360 },
    children: [new TextRun({ text: `Report date: ${today}`, size: 20, italics: true, color: '777777' })] }),

  // 1. Executive summary
  H1('1. Executive summary'),
  PR([
    { text: 'The QC rack is a four-tier automated test harness that renders each plugin through an OfflineAudioContext, measures invariants, and surfaces failures in a drawer UI with user-facing fix text. ' },
    { text: 'As of this session, 14 of 26 planned rules (54%) are fully wired end-to-end — generator → capture hook → analyzer emitter → sweep-loop branch.', bold: true },
  ]),
  PR([
    { text: 'Two MUST-have gaps were discovered in the baseline tiers during the closing audit: ' },
    { text: 'T1.mix_sanity', bold: true }, { text: ' and ' },
    { text: 'T2.extreme_freq', bold: true },
    { text: '. Both have probes emitted in qcPresets.js but no capture hook and no analyzer emitter, so they silently produce nothing. They are now top-of-queue.' },
  ]),
  PR([
    { text: 'Net new rules wired this session: ' },
    { text: 'T3.3 monosum_null', bold: true },
    { text: ' (mono-compatibility check) and ' },
    { text: 'T4.1 sample_rate_matrix', bold: true },
    { text: ' (cross-sample-rate invariance). Both landed in captureHooks.js, qcAnalyzer.js (RULE_META + emitter), and Analyzer.jsx (sweep dispatch).' },
  ]),

  // 2. Architecture
  H1('2. Architecture'),
  H2('2.1 Four-layer model'),
  BUL([{ text: 'Layer A — Harness', bold: true }, { text: ': QcDrawer / QcHarness / Analyzer.jsx orchestrate offline renders and collect per-rule snapshots.' }]),
  BUL([{ text: 'Layer B — Rules', bold: true }, { text: ': qcPresets.js emits probes across four tiers; qcAnalyzer.js owns RULE_META and per-rule severity emitters.' }]),
  BUL([{ text: 'Layer C — userFix', bold: true }, { text: ': non-developer fix copy + wizard flow consumed by the drawer UI.' }]),
  BUL([{ text: 'Layer D — Decision', bold: true }, { text: ': capability-gated rule selection via engine.capabilities so each plugin only runs relevant probes.' }]),

  H2('2.2 Module layout'),
  tableN([
    ['File', 'Role'],
    ['src/qc-harness/QcHarness.jsx',  'Standalone ?qc= route. Builds its own engine.'],
    ['src/qc-harness/QcDrawer.jsx',   'Docked 55vh drawer. Binds to LIVE engine via enginesRef.'],
    ['src/qc-harness/Analyzer.jsx',   'Sweep/null/measurement panel; dispatches to capture hooks per ruleId.'],
    ['src/qc-harness/qcPresets.js',   'Probe-spec generators for all four tiers (26 rules total).'],
    ['src/qc-harness/qcAnalyzer.js',  'RULE_META metadata + severity emitters (FAIL / WARN / INFO).'],
    ['src/qc-harness/captureHooks.js','OfflineAudioContext render hooks, one per rule that needs audio.'],
    ['src/qc-harness/Controls.jsx',   'Shared slider/toggle/enum/preset renderers (ControlPanel).'],
    ['src/qc-harness/entries.js',     'inferKind / buildEntries / candidateKeys / groupEntries / buildDefaults.'],
    ['src/qc-harness/userFix/',       'Non-dev copy + wizard flow consumed by the drawer.'],
    ['src/migration/QcStrip.jsx',     'Per-plugin chrome: badge, variant switcher, QC-Steps, Open-QC, Approve/Revoke.'],
    ['src/migration/registry.js',     'productId → { variants[], engineFactory, component, displayLabel }.'],
  ], [3400, 5960]),

  new Paragraph({ spacing: { after: 120 }, children: [new TextRun('')] }),

  H2('2.3 Capture-hook contract'),
  MONO('// every hook signature'),
  MONO("hook({ factory, params, sampleRate, ...ruleSpecific }) → { ...measurements, notes }"),
  P('When a required measurement field is absent the analyzer emits INFO with code capture_pending rather than a false FAIL. This keeps speculative rules honest while still giving them a slot in the report.'),

  H2('2.4 Engine V1 contract'),
  MONO('engine.paramSchema:  Array<{ name, kind, min, max, step, def, label?, group?, stateKey? }>'),
  MONO('engine.getState():   { [paramName | stateKey]: currentValue }'),
  MONO('engine.getLatency(): number   // samples'),
  MONO('engine.setBypass(b): void'),
  MONO('engine.dispose():    void'),
  MONO('engine.input:        AudioNode  // ctx = engine.input.context'),
  P('When paramSchema is present the harness treats it as authoritative; any setX method NOT declared in the schema is flagged "(UNDECLARED)". When absent the harness falls back to heuristic kind-inference (setBypass/setFB → bool, *threshold* → db, *freq*|*Hz → hz, setIn/setOut → db ±24, else unit 0..1).'),

  H2('2.5 Variant promotion'),
  BUL([{ text: 'getEngineFactory(productId, variantId)', font: 'Consolas' }, { text: ' returns the async factory the harness renders through.' }]),
  BUL([{ text: 'Frozen v1 pattern: ' }, { text: 'legacy', font: 'Consolas' }, { text: ' is snapshotted and promoted to ' }, { text: 'engine_v1', font: 'Consolas' }, { text: '; a future engine_v2 addresses findings without disturbing the audit trail.' }]),

  new Paragraph({ children: [new PageBreak()] }),

  // 3. Tier completeness matrix
  H1('3. Tier completeness matrix'),
  P(`Baseline audit as of ${today}. A rule counts as "done" only when all four layers are present: generator, capture hook, analyzer emitter, sweep-loop branch.`, { italics: true }),
  tableN([
    ['Tier', 'Purpose', 'Done', 'Total', 'Gap'],
    ['T1', 'Core correctness', '6', '7', 'mix_sanity'],
    ['T2', 'Stability & edges', '4', '5', 'extreme_freq'],
    ['T3', 'Advanced regimes', '3', '10', '7 rules'],
    ['T4', 'Pressure tests',   '1', '4', '3 rules'],
    ['All', 'Totals',           '14', '26', '12 rules'],
  ], [900, 3300, 1000, 1000, 3160]),

  // 4. Rule inventory
  H1('4. Rule inventory'),

  H2('4.1 T1 — Core correctness'),
  tableN([
    ['Rule ID', 'Status', 'What it catches'],
    ['mix_null',        'DONE', 'Dry/wet null at Mix=0 (NON-NEGOTIABLE guard)'],
    ['mix_null_series', 'DONE', 'Bypass exactness across series stages'],
    ['mix_identity',    'DONE', 'Wet path identity at Mix=1'],
    ['mix_sanity',      'GAP',  'Coarse mix-law sweep (probes exist, no hook/emitter)'],
    ['fb_mix_coupling', 'DONE', 'Feedback tap placement vs mix law'],
    ['zipper',          'DONE', 'Param smoothing / zipper artifacts'],
    ['mode_storm',      'DONE', 'Rapid mode switching stability'],
  ], [2400, 1200, 5760]),

  H2('4.2 T2 — Stability & edges'),
  tableN([
    ['Rule ID', 'Status', 'What it catches'],
    ['impulse_ir',          'DONE', 'IR shape, length, energy'],
    ['denormal_tail',       'DONE', 'Subnormal CPU hazards on decay tails'],
    ['pathological_stereo', 'DONE', 'L/R imbalance under degenerate input'],
    ['extreme_freq',        'GAP',  'DC / Nyquist / near-Nyquist (probes exist, no hook/emitter)'],
    ['bypass_exact',        'DONE', 'Sample-exact bypass'],
  ], [2400, 1200, 5760]),

  H2('4.3 T3 — Advanced regimes'),
  tableN([
    ['Rule ID', 'Status', 'Priority'],
    ['latency_report',     'DONE',                   '—'],
    ['feedback_runaway',   'DONE',                   '—'],
    ['monosum_null',       'DONE (this session)',    'MUST'],
    ['freeze_stability',   'PENDING',                'SHOULD'],
    ['sidechain_regime',   'PENDING',                'SHOULD'],
    ['wdf_convergence',    'PENDING',                'SHOULD'],
    ['band_reconstruction','PENDING',                'COULD'],
    ['lpc_stability',      'PENDING',                'COULD'],
    ['fft_frame_phase',    'PENDING',                'COULD'],
    ['pitch_idle',         'PENDING',                'COULD'],
  ], [2800, 2600, 3960]),

  H2('4.4 T4 — Pressure tests'),
  tableN([
    ['Rule ID', 'Status', 'Priority'],
    ['sample_rate_matrix','DONE (this session)', 'MUST'],
    ['os_boundary',       'PENDING',             'SHOULD'],
    ['series_identity',   'PENDING',             'SHOULD'],
    ['long_session_drift','PENDING',             'COULD'],
  ], [2800, 2600, 3960]),

  new Paragraph({ children: [new PageBreak()] }),

  // 5. Session findings
  H1('5. Session findings'),

  H2('5.1 New rules wired'),
  H3('T3.3 monosum_null'),
  BUL('Builds decorrelated pink stereo, renders wet, and compares mono-sum RMS to the avg of L/R RMS.'),
  BUL('Thresholds: compatDb < −6 dB FAIL; −6 to −4 dB WARN; ≥ −4 dB INFO; non-finite FAIL.'),
  BUL([{ text: 'Touches: captureHooks.js renderMonosumNull · qcAnalyzer.js RULE_META + QC-R8b emitter · Analyzer.jsx sweep branch.', font: 'Consolas', size: 18 }]),

  H3('T4.1 sample_rate_matrix'),
  BUL('Renders a pink burst at the target sample rate via OfflineAudioContext; captures RMS/peak/finiteness.'),
  BUL('Emitter: per-SR non-finite → FAIL; cross-SR variance > 6 dB → FAIL; 3–6 dB → WARN; < 3 dB → INFO.'),
  BUL([{ text: 'Touches: captureHooks.js renderSampleRateMatrix · qcAnalyzer.js RULE_META + QC-R8c emitter · Analyzer.jsx sweep branch.', font: 'Consolas', size: 18 }]),

  H2('5.2 Lofi Loofy engine_v1 findings'),
  P('Documented in CONFORMANCE.md §8.6 (not fixed — frozen for audit trail). Engine_v2 will address.'),
  tableN([
    ['Check', 'Value', 'Verdict'],
    ['mix_null_series',                          '−15.7 dB',       'Problem'],
    ['bypass_exact',                             '−29.6 dB',       'Check'],
    ['peak_above_input (5 character presets)',   '+1.2 to +5.0 dB','Check'],
  ], [4200, 2200, 2960]),

  H2('5.3 Baseline gaps discovered'),
  BUL([{ text: 'T1.mix_sanity', bold: true }, { text: ' — generator emits probes but there is no capture hook and no analyzer emitter. Silent no-op.' }]),
  BUL([{ text: 'T2.extreme_freq', bold: true }, { text: ' — DC / Nyquist / near-Nyquist sine probes emitted, but no hook/emitter. Silent no-op.' }]),
  P('Reclassified MUST-GAP (baseline correctness, fires on every plugin). Now top-of-queue ahead of all SHOULD/COULD work.'),

  // 6. Pending queue
  H1('6. Pending queue (MoSCoW)'),
  H2('6.1 MUST — ship next'),
  BUL('T1.4 mix_sanity — hook + META + emitter + sweep branch'),
  BUL('T2.4 extreme_freq — hook + META + emitter + sweep branch'),
  BUL('Re-sweep Lofi Loofy to verify T3.3 + T4.1 fire correctly'),

  H2('6.2 SHOULD — once plugin coverage expands'),
  BUL('T3.4 freeze_stability · T3.5 sidechain_regime · T3.9 wdf_convergence'),
  BUL('T4.2 os_boundary · T4.3 series_identity'),

  H2('6.3 COULD — speculative / plugin-class-specific'),
  BUL('T3.6 band_reconstruction · T3.7 lpc_stability · T3.8 fft_frame_phase · T3.10 pitch_idle'),
  BUL('T4.4 long_session_drift'),

  H2('6.4 Plugin onboarding'),
  BUL('ManChild T3+T4 isolation sweep → findings into CONFORMANCE'),
  BUL('Lofi Loofy T3+T4 isolation sweep (extend §8.6)'),
  BUL('Flap Jack Man: capabilities + v1 fork + factory route + full-tier sweep'),
  BUL('Panther Buss: capabilities + v1 fork + factory route + full-tier sweep'),
  BUL('Cross-plugin T3/T4 rollup with priority fix queue'),

  H2('6.5 Hygiene'),
  BUL('Rename legacy → prototype (~55 edits across ~15 files)'),
  BUL('Lofi Loofy engine_v2 in-worklet Mix surgery (dry_wet_mix_rule §1)'),
  BUL('Wizard UX review (FORK step confusion)'),
  BUL('userFix copy rewrite'),

  // 7. Plugins audited
  H1('7. Plugins audited'),
  tableN([
    ['Plugin', 'Status'],
    ['MANchild',      'engine_v1, paramSchema complete, getState OK. Approved.'],
    ['Lofi Loofy',    'engine_v1; findings documented in CONFORMANCE §8.6; engine_v2 pending.'],
    ['Flap Jack Man', 'engine_v1, paramSchema complete; CONFORMANCE under nastybeast/.'],
    ['Panther Buss',  'engine_v1 (migrated this session). Legacy keeps string "drumbus" for back-compat.'],
  ], [2600, 6760]),

  // 8. Risks
  H1('8. Risks & watch items'),
  BUL([{ text: 'Silent rule no-ops', bold: true }, { text: ': the T1/T2 gaps prove that generator-without-hook is a recurring failure mode. Propose startup assertion that every emitted ruleId has a registered capture hook.' }]),
  BUL([{ text: 'Mix rule drift', bold: true }, { text: ': dry_wet_mix_rule is NON-NEGOTIABLE; external parallel dry legs are forbidden. Keep mix_null + mix_null_series in every baseline sweep.' }]),
  BUL([{ text: 'Variant promotion discipline', bold: true }, { text: ': v1 snapshots must stay frozen once findings are documented; changes belong in v2.' }]),
  BUL([{ text: 'Per-plugin isolation learning', bold: true }, { text: ': each onboarding must run T1→T4 in isolation and roll findings into CONFORMANCE; cross-plugin patterns drive architecture fixes.' }]),

  // 9. Next steps
  H1('9. Next steps'),
  NUM('Wire T1.4 mix_sanity (hook + meta + emitter + sweep branch).'),
  NUM('Wire T2.4 extreme_freq (hook + meta + emitter + sweep branch).'),
  NUM('Re-sweep Lofi Loofy with T3.3 + T4.1 live and verify emitter paths.'),
  NUM('Begin SHOULD-tier T3/T4 wiring once plugin coverage expands.'),
  NUM('Onboard Flap Jack Man and Panther Buss to the full tier matrix.'),
  NUM('Add a "Last QC run" timestamp per instance so the strip shows stale/fresh state.'),

  // Appendix
  H1('Appendix A — Registry snapshot'),
  tableN([
    ['productId', 'Variants'],
    ['manchild',    'legacy, engine_v1'],
    ['lofiloofy',   'legacy, engine_v1'],
    ['flapjackman', 'legacy, engine_v1 (CONFORMANCE.md at nastybeast/)'],
    ['pantherbuss', 'legacy (drumbus), engine_v1'],
  ], [2600, 6760]),

  H1('Appendix B — Definitions'),
  BUL([{ text: 'capture_pending', font: 'Consolas' }, { text: ' — INFO-level emission when a required measurement field is missing. Keeps rules honest without producing false FAILs.' }]),
  BUL([{ text: 'RULE_META', font: 'Consolas' }, { text: ' — per-rule metadata: title, meaning, fix, dev block, bySeverity overrides.' }]),
  BUL([{ text: 'Variant', bold: true }, { text: ' — a specific engine revision of a plugin (legacy/prototype, engine_v1, engine_v2). Selected via getEngineFactory(productId, variantId).' }]),
  BUL([{ text: 'Isolation sweep', bold: true }, { text: ' — running the full tier matrix against a single plugin, documenting findings per-plugin before cross-plugin rollup.' }]),
];

// ---- document ------------------------------------------------------------
const doc = new Document({
  creator: 'Claude',
  title: 'QC Rack Audit',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: '1F3864' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '2E74B5' },
        paragraph: { spacing: { before: 260, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '2E74B5' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
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
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'QC Rack Audit — Shags VST', size: 18, color: '777777' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', size: 18, color: '777777' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '777777' }),
          new TextRun({ text: ' of ',  size: 18, color: '777777' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: '777777' }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join('C:\\Users\\HEAT2\\Desktop\\Shags VST', 'QC_Rack_Audit.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
