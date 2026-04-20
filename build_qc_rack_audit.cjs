// build_qc_rack_audit.cjs — regenerates QC_Rack_Audit.docx
// Captures the QC Rack system built in this session: parity lens,
// QC harness, paramSchema contract, stereo source fix, pending work.

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation,
} = require('docx');

const OUT = path.join(__dirname, 'QC_Rack_Audit.docx');

const FONT = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text, font: FONT, size: 22, ...opts })],
});
const Code = (text) => new Paragraph({
  spacing: { after: 120 },
  shading: { fill: 'F2F2F2', type: ShadingType.CLEAR },
  children: [new TextRun({ text, font: 'Consolas', size: 20 })],
});
const Bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  spacing: { after: 80 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
});
const H = (level, text) => new Paragraph({
  heading: HeadingLevel[`HEADING_${level}`],
  spacing: { before: 320 - level * 40, after: 160 - level * 20 },
  children: [new TextRun({ text, font: FONT, size: 40 - level * 4, bold: true })],
});

function row(cells, { header = false, widths }) {
  return new TableRow({
    tableHeader: header,
    children: cells.map((txt, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: header ? { fill: 'E7E6E6', type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({
        text: txt, font: FONT, size: 20, bold: header,
      })] })],
    })),
  });
}
function table(header, rows) {
  const total = 9360;
  const widths = Array(header.length).fill(Math.floor(total / header.length));
  widths[widths.length - 1] += total - widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [row(header, { header: true, widths }), ...rows.map(r => row(r, { widths }))],
  });
}

const content = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'QC Rack System \u2014 Audit', font: FONT, size: 44, bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [new TextRun({
      text: `Shags VST \u00B7 Session audit \u00B7 ${new Date().toISOString().slice(0, 10)}`,
      font: FONT, size: 22, italics: true, color: '666666',
    })],
  }),

  H(1, '1. Purpose'),
  P('The QC Rack is a DSP-first quality-control surface for Shags VST plugins. It lets us tune and audit any engine with zero visual bias: a raw slider UI, explicit parameter semantics, deterministic test sources, and a drift report that compares legacy-engine capability against the new FxEngine v1 equivalents.'),
  P('It exists because (a) Orb UIs hide bad DSP, and (b) migrating legacy plugins to Engine v1 silently loses features when nobody checks parameter-by-parameter parity.'),

  H(1, '2. Components shipped this session'),

  H(2, '2.1 Parity Lens'),
  Bullet('scripts/parity-audit.cjs \u2014 static-parses src/registry.js, locates each product/variant engine file, extracts every public set* method with four regex patterns (object props, shorthand methods, named exports, prototype assignments), blacklists Web Audio internals, writes public/parity-report.json.'),
  Bullet('src/migration/parity.js \u2014 useParity(productId) hook; fetches /parity-report.json once and caches.'),
  Bullet('src/migration/QcOverlay.jsx \u2014 adds a Parity row to the InfoIcon tooltip and a DRIFT confirmation dialog gating the Approve button when v1 is missing legacy capability.'),
  P('Status per report: panther_buss DRIFT (12 legacyOnly, 3 v1Only). manchild LEGACY_ONLY (no v1 equivalent mapped yet).'),

  H(2, '2.2 QC Harness'),
  Bullet('src/qc-harness/QcHarness.jsx \u2014 stripped slider UI mounted at ?qc=<productId>[&variant=<id>].'),
  Bullet('Schema-first: reads engine.paramSchema if present, falls back to name heuristics with a yellow warning banner. Flags undeclared setX methods.'),
  Bullet('Groups A/B params automatically. Routes each kind (unit, gain, db, hz, bool, enum, preset, noop, float) to the right control.'),
  Bullet('30 Hz meter RAF throttle with a change-enough threshold, matching the canonical metering rule.'),
  Bullet('src/main.jsx \u2014 render-root URL-param hook bypasses the main App when ?qc= is present, so the harness is truly UI-free.'),

  H(2, '2.3 paramSchema contract (DEV_RULE Q1)'),
  P('Every engine MUST export a paramSchema array declaring the kind, range, default, and values/options of every public setter. Name-based heuristics lie \u2014 they were guessing wrong on 7+ ManChild/drumBus methods.'),
  Code(`paramSchema: [
  { name: 'setDrive',  label: 'Drive',  kind: 'unit',  min: 0, max: 1, def: 0.3 },
  { name: 'setTrim',   label: 'Trim',   kind: 'db',    min: -12, max: 12, def: 0 },
  { name: 'setBypass', label: 'Bypass', kind: 'bool',  def: 0 },
  { name: 'setMode',   label: 'Mode',   kind: 'enum',
    values: [{ value: 0, label: 'CLASSIC' }, { value: 1, label: 'MODERN' }] },
  { name: 'setChar',   label: 'Preset', kind: 'preset', options: Object.keys(PRESETS) },
  { name: 'setOld',    label: 'Retired', kind: 'noop', note: 'back-compat only' },
]`),

  H(2, '2.4 Engines schema\u2019d this session'),
  table(
    ['Engine', 'Schema entries', 'Notable corrections vs. heuristics'],
    [
      ['drumBusEngine.js', '15', 'setFreq is 0..1 (not Hz); setTrim is dB; setInputGain is linear.'],
      ['pantherBussEngine.js', '6', 'Collapsed macros (Drive/Glue/Tone/Output/Mix). Parity drift surfaced.'],
      ['manChildEngine.js', '22 + 2 noop', 'setOutputGainA/B marked noop (Fairchild topology). setTcA/B has 10 values (TC1\u20136 + VAR1\u20134). setChannelMode labels verified: IND, LINK, M-S, M-S LINK. setCharacter is a preset dropdown.'],
    ]
  ),

  H(2, '2.5 Test sources \u2014 stereo fix'),
  P('ScriptProcessor (deprecated) mono-routed on some hosts \u2014 hence the "only left speaker" bug. Rewritten to use AudioBufferSourceNode throughout, with ChannelMerger for oscillator upmix.'),
  Bullet('createPinkNoise \u2014 4 s stereo buffer, independent L/R pink, looped.'),
  Bullet('createSineSweep \u2014 mono osc \u2192 Gain \u2192 ChannelMerger(2) \u2192 stereo, returns start/stop/connect proxy.'),
  Bullet('createDrumLoopStub \u2014 pre-rendered 4-bar 120 BPM stereo buffer (kick + hat), looped.'),
  Bullet('loadFileAsSource \u2014 decodeAudioData \u2192 BufferSource (stereo if source is).'),

  H(1, '3. Architecture contract'),
  P('Every engine returned to the host AND the harness MUST expose:'),
  Code(`{
  input, output, chainOutput,
  setBypass, getOutputPeak, dispose,
  paramSchema: [...],        // Q1 \u2014 mandatory
  // plus any product-specific set* methods declared in the schema
}`),
  P('Optional: getSidechainInput() for plugins with an external SC node. The harness does not auto-route to it yet (see Pending Work).'),

  H(1, '4. Pending work'),
  H(2, '4.1 Proper audio analyzer (user request, highest priority)'),
  Bullet('Dual AnalyserNode taps \u2014 one on engine.input (pre), one on engine.output (post).'),
  Bullet('Waveform scope canvas per tap (time-domain, getFloatTimeDomainData).'),
  Bullet('Frequency spectrum canvas per tap (getFloatFrequencyData, log-frequency axis).'),
  Bullet('Readouts: peak dBFS, RMS dBFS, peak-hold, pre\u2192post delta (gain reduction / makeup).'),
  Bullet('Target file: src/qc-harness/Analyzer.jsx wired into QcHarness.jsx.'),

  H(2, '4.2 Phase 3 \u2014 Panther Buss legacy \u2192 v1 migration'),
  P('Parity report shows 12 legacyOnly methods to port or intentionally retire:'),
  Bullet('setBoom, setComp, setCrunch, setDamp, setDecay, setDriveMode, setFreq, setInputGain, setOutputGain, setTransients, setTrim, setWidth.'),

  H(2, '4.3 Phase 4 \u2014 next legacy plugins'),
  Bullet('Flap Jack Man \u2192 808 Kick \u2192 Space Orb, same 6-step template from next_session_plan.md.'),

  H(2, '4.4 Harness UX cleanup'),
  Bullet('Readability pass (user feedback: "hard to read"): larger labels, tighter grouping, value badges on every slider.'),
  Bullet('External sidechain source picker \u2014 detect engine.getSidechainInput() and offer a second test-source routed there.'),

  H(1, '5. Rules codified'),
  Bullet('DEV_RULE Q1 \u2014 paramSchema parity: no plugin ships without schema entries for every public setter.'),
  Bullet('manchild_lessons.md rules 16\u201318: DSP-first prototype, schema mandatory, sidechain is a separate feature.'),
  Bullet('Test sources must be stereo. ScriptProcessor is forbidden going forward.'),

  H(1, '6. Files touched'),
  table(
    ['Path', 'Change'],
    [
      ['scripts/parity-audit.cjs', 'Created \u2014 static parity scanner.'],
      ['public/parity-report.json', 'Generated \u2014 current drift state.'],
      ['src/migration/parity.js', 'Created \u2014 useParity hook.'],
      ['src/migration/QcOverlay.jsx', 'Edited \u2014 parity row + approve gate.'],
      ['src/qc-harness/QcHarness.jsx', 'Created \u2014 schema-first harness.'],
      ['src/qc-harness/sources.js', 'Created & rewritten \u2014 stereo sources.'],
      ['src/main.jsx', 'Edited \u2014 ?qc= render-root bypass.'],
      ['src/drumBusEngine.js', 'Edited \u2014 paramSchema added.'],
      ['src/pantherBussEngine.js', 'Edited \u2014 paramSchema added.'],
      ['src/manChild/manChildEngine.js', 'Edited \u2014 paramSchema added.'],
      ['memory/manchild_lessons.md', 'Created \u2014 18 rules.'],
      ['memory/next_session_plan.md', 'Created \u2014 phased plan.'],
    ]
  ),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: FONT },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
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
        size: { width: 12240, height: 15840, orientation: PageOrientation.PORTRAIT },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: content,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${buf.length} bytes)`);
});
