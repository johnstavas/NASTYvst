// Build QC_Rack_Audit.docx — snapshot of QC rack system built this session.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat,
  BorderStyle, WidthType, ShadingType,
} = require('docx');

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t, opts={}) => new Paragraph({ children: [new TextRun({ text: t, ...opts })] });
const BUL = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(t)] });
const NUM = (t) => new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun(t)] });
const MONO = (t) => new Paragraph({ children: [new TextRun({ text: t, font: 'Consolas', size: 20 })] });

const border = { style: BorderStyle.SINGLE, size: 1, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };

function cell(text, { bold=false, shade=null, width=4680 } = {}) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });
}

function table2(rows, widths=[3000, 6360]) {
  return new Table({
    width: { size: widths[0]+widths[1], type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r, i) => new TableRow({
      children: [
        cell(r[0], { bold: i === 0, shade: i === 0 ? 'E6ECF2' : null, width: widths[0] }),
        cell(r[1], { bold: i === 0, shade: i === 0 ? 'E6ECF2' : null, width: widths[1] }),
      ],
    })),
  });
}

const children = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'QC RACK SYSTEM \u2014 AUDIT', bold: true, size: 40 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Shags VST \u00b7 Engine V1 Conformance Harness \u00b7 2026-04-19', size: 20, color: '666666' })],
  }),
  P(''),

  H1('1. Executive Summary'),
  P('This session unified the two previously-separate apps (the main Nasty Orbs host and the standalone ?qc= harness) into a single in-app QC experience. The standalone route still works, but plugins can now be QC-audited in place, against the exact engine making sound, without leaving the rack.'),
  P('Three user-facing problems were solved:'),
  BUL('Old absolute-positioned QC button panel sat on top of knob hit-targets. Fixed by moving QC chrome to a horizontal strip rendered above each plugin, not overlaid.'),
  BUL('No visibility into Engine V1 compliance per instance. A QC-Steps expandable checklist now runs seven live checks per plugin (paramSchema, getState, getLatency, setBypass, dispose, CONFORMANCE.md presence, V1 parity).'),
  BUL('The standalone harness spawned its own AudioContext and engine, defeating the point of "hear what you measure." The new docked QcDrawer binds directly to the live enginesRef and borrows the engine\'s own AudioContext.'),

  H1('2. Architecture'),
  H2('2.1 Module layout'),
  table2([
    ['File', 'Role'],
    ['src/qc-harness/entries.js',      'Shared helpers: inferKind, buildEntries, candidateKeys, groupEntries, buildDefaults. Consumed by both standalone and docked UIs.'],
    ['src/qc-harness/Controls.jsx',    'Shared slider/toggle/enum/preset renderers: ControlPanel, Control, Row, Section, Btn, ST, SliderThumbStyle. Extracted from QcHarness so drawer and route render identically.'],
    ['src/qc-harness/QcHarness.jsx',   'Standalone ?qc= route. Builds its own engine; consumes ControlPanel from Controls.jsx.'],
    ['src/qc-harness/QcDrawer.jsx',    'Docked 55vh bottom drawer. Binds to LIVE engine via enginesRef; AudioContext = engine.input.context.'],
    ['src/qc-harness/Analyzer.jsx',    'Shared sweep/null/measurement panel. Same component drives both UIs.'],
    ['src/migration/QcStrip.jsx',      'Per-plugin horizontal strip above each orb. Badge, variant switcher, QC-Steps, Open-QC button, Approve/Revoke.'],
    ['src/migration/registry.js',      'productId -> { variants[], engineFactory, component, displayLabel }.'],
    ['src/hooks/useQcMode.js',         'Persistent qcMode toggle (localStorage).'],
    ['src/hooks/useProductStatus.js',  'Per-product approval lifecycle state.'],
  ], [3400, 5960]),

  P(''),
  H2('2.2 Engine V1 contract'),
  P('Every migrated plugin engine must expose:'),
  MONO('engine.paramSchema:  Array<{ name, kind, min, max, step, def, label?, group?, stateKey? }>'),
  MONO('engine.getState():   { [paramName | stateKey]: currentValue }'),
  MONO('engine.getLatency(): number   // samples'),
  MONO('engine.setBypass(b): void'),
  MONO('engine.dispose():    void'),
  MONO('engine.input:        AudioNode  // ctx = engine.input.context'),
  P('When paramSchema is present the harness treats it as authoritative; any setX method NOT declared in the schema appears flagged "(UNDECLARED)". When paramSchema is absent the harness falls back to heuristic kind-inference by method name (setBypass/setFB -> bool, *threshold* -> db, *freq*|*Hz -> hz, setIn/setOut -> db +/-24, else unit 0..1).'),

  H2('2.3 Live-engine binding (docked drawer)'),
  P('The docked drawer does not construct anything. It reads from App state:'),
  MONO('const engine   = enginesRef.current.get(instanceId);'),
  MONO('const ctx      = engine.input.context;           // shared AudioContext'),
  MONO('const entries  = buildEntries(engine);            // schema or heuristic'),
  MONO('const defaults = buildDefaults(entries);          // seeded from getState()'),
  P('Setting a parameter calls engine[name](value) directly and re-reads getState() on a 0/50/200 ms schedule so preset/enum fan-outs that set sibling parameters are captured in the UI.'),

  H1('3. UI Changes in main.jsx'),
  BUL('Removed absolute-positioned <QcPanel> overlay (was blocking knob clicks).'),
  BUL('Each instance now renders in a flex column: <QcStrip> above, orb (inside heat-glow wrapper) below.'),
  BUL('Added switchInstanceVariant(instId, nextVariantId) callback so the strip\'s variant dropdown can hot-swap legacy vs engine_v1 per instance.'),
  BUL('QcDrawer is mounted at App root, conditional on qcMode && qcDrawerId != null.'),
  BUL('App root gets paddingBottom: calc(55vh + 24px) while drawer is open so the bottom row is never occluded.'),

  H1('4. QcStrip \u2014 per-plugin chrome'),
  P('Rendered above every instance when QC mode is on.'),
  table2([
    ['Element', 'Behavior'],
    ['Badge',            'Shows productId + current variantId. Colored by status (legacy / v1 / approved).'],
    ['Variant switcher', 'Dropdown enumerated from registry.variants; calls switchInstanceVariant.'],
    ['QC Steps',         'Expandable checklist running seven live checks against the bound engine.'],
    ['Open QC',          'Sets qcDrawerId = instanceId -> opens docked drawer on this engine.'],
    ['Approve / Revoke', 'Toggles product status through useProductStatus().'],
  ], [2400, 6960]),
  P(''),
  P('Seven live checks run by the Steps component:'),
  NUM('paramSchema present and Array.'),
  NUM('getState() callable, returns object.'),
  NUM('getLatency() callable, returns finite number.'),
  NUM('setBypass(true/false) callable without throw.'),
  NUM('dispose present and callable.'),
  NUM('CONFORMANCE.md exists for this productId (import.meta.glob eager raw).'),
  NUM('V1 parity: every setX on the engine is declared in paramSchema (else flagged UNDECLARED).'),

  H1('5. QcDrawer \u2014 docked harness'),
  P('55vh bottom sheet. Mounts Analyzer against the live engine and renders the shared ControlPanel so the full slider surface is present. Header shows:'),
  BUL('Plugin picker (all instances with a registered productId).'),
  BUL('Live stats: "{N} params \u00b7 schema|heuristic \u00b7 getState OK/missing"'),
  BUL('Close button.'),
  P('Empty state: if no migrated plugins are in the chain, the drawer invites the user to add Lofi Loofy, MANchild, Flap Jack Man, or Panther Buss (engine_v1).'),

  H1('6. Shared-controls refactor'),
  P('QcHarness.jsx originally contained an inline Control router, groupEntries helper, and style constants \u2014 all duplicated in the drawer. Refactor:'),
  BUL('groupEntries moved into entries.js alongside inferKind/buildEntries/candidateKeys/buildDefaults.'),
  BUL('Control router + Row/Section/Btn/ST + SliderThumbStyle moved into Controls.jsx and exported as ControlPanel.'),
  BUL('QcHarness.jsx now imports ControlPanel and renders it in place of its inline common/pair maps.'),
  BUL('QcDrawer.jsx imports and renders the same ControlPanel, guaranteeing parity between the two UIs.'),

  H1('7. Plugins Audited'),
  table2([
    ['Plugin', 'Status'],
    ['MANchild',       'engine_v1, paramSchema complete, getState OK. Approved.'],
    ['Lofi Loofy',     'engine_v1 with LL-M16 preset fan-out defect logged (see \u00a78).'],
    ['Flap Jack Man',  'engine_v1, paramSchema complete, productId aliased to nastybeast folder for CONFORMANCE.md lookup.'],
    ['Panther Buss',   'engine_v1 (migrated this session). Legacy files retain string "drumbus" for back-compat.'],
  ], [2600, 6760]),

  H1('8. Defect Log'),
  H3('LL-M16 \u2014 Lofi Loofy preset enum fan-out'),
  P('Selecting a preset fires setTexturePreset which then updates multiple sibling parameters on the engine. The drawer now schedules syncFromEngineState at 0/50/200 ms post-set so the UI sliders catch the fan-out. Action item: add a schema-level marker to flag preset/enum parameters that mutate siblings so the sync scheduler is declarative rather than heuristic.'),

  H1('9. Process Changes'),
  BUL('QC is now ambient: any instance in the rack can be audited in place with one click.'),
  BUL('Standalone ?qc= remains the canonical "fresh engine" benchmark. Both UIs share the same entries/controls/analyzer modules so results are comparable.'),
  BUL('Per-plugin CONFORMANCE.md is surfaced as a checklist item, pushing spec discipline.'),
  BUL('Variant switcher means A/B-ing legacy vs engine_v1 takes no code change.'),

  H1('10. Next Steps'),
  NUM('Declarative preset/enum fan-out markers in paramSchema, retiring the setTimeout(0/50/200) heuristic.'),
  NUM('Wire Analyzer sweep/null results into useProductStatus so "Approve" requires a green sweep.'),
  NUM('Rename legacy DrumBus files to PantherBussLegacy (tracked in tech_debt.md; keep legacyType:"drumbus").'),
  NUM('Add a "Last QC run" timestamp per instance so the strip shows stale/fresh state.'),
  NUM('Finish migrating remaining plugins to engine_v1 and register CONFORMANCE.md per productId.'),

  H1('Appendix A \u2014 Registry Snapshot'),
  table2([
    ['productId', 'Variants'],
    ['manchild',     'legacy, engine_v1'],
    ['lofiloofy',    'legacy, engine_v1'],
    ['flapjackman',  'legacy, engine_v1 (CONFORMANCE.md at nastybeast/)'],
    ['pantherbuss',  'legacy (drumbus), engine_v1'],
  ], [2600, 6760]),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: '1A2A3A' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: '2A3A4A' },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, font: 'Arial', color: '3A4A5A' },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
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
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:/Users/HEAT2/Desktop/Shags VST/QC_Rack_Audit.docx', buf);
  console.log('wrote', buf.length, 'bytes');
});
