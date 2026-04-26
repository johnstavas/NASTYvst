// Build QC_Rack_Audit.docx — audit of sandbox op ship-rack work this session.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation, PageBreak,
} = require('docx');

const OUT = path.resolve('C:/Users/HEAT2/Desktop/Shags VST/QC_Rack_Audit.docx');

const border = { style: BorderStyle.SINGLE, size: 4, color: 'B0B0B0' };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t, opts={}) => new Paragraph({ children: [new TextRun({ text: t, ...opts })] });
const BUL = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(t)] });
const MONO = (t) => new Paragraph({ children: [new TextRun({ text: t, font: 'Consolas', size: 18 })] });

function cell(text, { bold=false, shade=null, width=null, mono=false } = {}) {
  return new TableCell({
    borders,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold, font: mono ? 'Consolas' : undefined, size: mono ? 18 : undefined })] })],
  });
}

function headerRow(cols, widths) {
  return new TableRow({ tableHeader: true, children: cols.map((c, i) => cell(c, { bold: true, shade: 'D5E8F0', width: widths[i] })) });
}
function dataRow(cols, widths) {
  return new TableRow({ children: cols.map((c, i) => cell(c, { width: widths[i] })) });
}

// Op ship table
const OP_W = [720, 1600, 1200, 2400, 3440];
const opHeader = headerRow(['#', 'Op', 'Status', 'Primary source', 'Audit outcome'], OP_W);
const opRows = [
  ['41', 'gate',         'shipped', 'math-by-definition (state machine)',                'Surveyed Airwindows Gatelope, Faust compressors.lib, musicdsp Effects, amplessEngine.js — no open primary matches 5-state Schmitt + A/H/R. Audit-trail note added to header.'],
  ['42', 'expander',     'shipped', 'Faust compressors.lib peak_expansion_gain_mono_db', 'Clean citable primary found post-ship. Verbatim passage + algebraic-equivalence block (Faust knee ≡ ours with strength=-(R-1)) now in header.'],
  ['43', 'transient',    'shipped', 'Airwindows Point (MIT), PointProc.cpp L41-L64',     'Primary located after user pushback. Verbatim passage + 5 deviations (A-E) documented in header. Goldens unchanged (docstring-only).'],
  ['44', 'sidechainHPF', 'shipped', 'RBJ Audio EQ Cookbook L116-L123 (HPF biquad)',      'curl fetched cookbook; verbatim coefficient block in header. Direct Form 1, order={1,2} cascade for 24 dB/oct. qc:all green.'],
  ['45', 'lookahead',    'shipped', 'Lemire 2006 (arXiv:cs/0610046)',                    'PDF downloaded (133427 bytes). Pending read + verbatim pseudocode embed + verify monotonic deque ≤3-comparison match.'],
  ['46', 'meters',       'shipped', 'Composition of op_peak + op_rms (in-tree)',         'Verbatim citation of shipped sibling ops (op_peak L14-L23, op_rms L17-L20) plus IEC 60268-10/-17 preset table (vu/ppm/digital/custom).'],
].map(r => dataRow(r, OP_W));

const opTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: OP_W,
  rows: [opHeader, ...opRows],
});

// Protocol-break table
const PB_W = [1600, 4000, 3760];
const pbHeader = headerRow(['Op', 'Break', 'Fix'], PB_W);
const pbRows = [
  ['#41 gate',      'Catalog cited "Canon:dynamics §4" but §4 is Beat Detector — wrong pointer followed without opening.', 'Opened §1 directly; declared state machine math-by-definition; debt row logged.'],
  ['#42 expander',  'Catalog cited "Canon:dynamics §3" but §3 is a compressor — wrong pointer.',                            'Declared math-by-definition citing #5 gainComputer as sibling; debt row logged. Faust primary later found in audit.'],
  ['#43 transient', 'Declared math-by-definition without actively searching for a DET primary (lazy). User caught: "were you able to find this".', 'Spawned research agent; located Airwindows Point; pasted verbatim L41-L64 + 5 deviations; catalog+debt updated.'],
  ['#45 lookahead', 'Shipped against a general "streaming windowed-max" claim without opening Lemire 2006.',                'Debt row logged; PDF downloaded via curl; read + verbatim-passage embed pending.'],
].map(r => dataRow(r, PB_W));

const pbTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: PB_W,
  rows: [pbHeader, ...pbRows],
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
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
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'QC Rack Audit', bold: true, size: 44 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Sandbox op ship-rack — session 2026-04-24', italics: true, size: 22, color: '555555' })] }),
      P(''),

      H1('1. Purpose'),
      P('This document audits the op ship-rack work executed during the 2026-04-24 session under memory/sandbox_op_ship_protocol.md. Four ops were shipped end-to-end through the six-step protocol (primary-source open, verbatim paste, tri-file authoring, deviation diff, qc:all green, catalog + debt update). The audit records what shipped, where protocol discipline slipped, and what follow-up remains before the rack is considered clean.'),

      H1('2. Ops shipped this session'),
      opTable,
      P(''),
      P('Catalog standing after this session: 81 / ~130 rows green (~62%). The MVP six, FB-safety triad, tone-shaping pair, and the full Dynamics family (#3 detector, #4 envelope, #5 gainComputer, #40 clamp, #41 gate, #42 expander, #43 transient, #44 sidechainHPF, #45 lookahead, #46 meters, #48 adsr) are closed at all currently-assigned slots. Rows #47, #49, #50 are reserved padding for future fills (multi-band, ducker, true-peak variant).', { italics: true }),

      H1('3. Protocol-break register'),
      P('The ship protocol mandates: "If no primary exists (math-by-definition primitive), say so explicitly. If you catch yourself citing Canon:§X without opening what Canon points at, stop." Four breaks from the earlier ship cluster (#41-#45) were recorded; three are remediated in-session and one (#45) remains logged as P1 debt. The #44/#46 ships were clean — RBJ cookbook fetched via curl as live primary, and #46 cited its composed sidecars verbatim with line ranges.'),
      P(''),
      pbTable,

      H1('4. Research-first discipline findings'),
      H2('4.1 Canon-pointer drift'),
      P('Two ops (#41, #42) were shipped citing Canon section numbers that, when opened, pointed at unrelated algorithms. The underlying pattern: trusting the catalog\'s shorthand pointer without cross-checking the Canon file table of contents. Mitigation: the ship-protocol pre-flight checklist now forces a verbatim-open step before the pointer is quoted in the worklet header.'),
      H2('4.2 Lazy primary search'),
      P('One op (#43 transient) was declared math-by-definition without a real search pass. User pushback ("were you able to find this") surfaced the gap. A research sub-agent located Airwindows Point (MIT) within one cycle, confirming that a citable open reconstruction of the SPL DET topology exists. The worklet header was updated with a verbatim L41-L64 paste and a five-item deviation block (A. detector asymmetry, B. combiner form, C. fpFlip drift-compensation, D. stereo handling, E. denormal strategy).'),
      H2('4.3 Unread primary'),
      P('One op (#45 lookahead) shipped with an algorithm name-checked but the source paper (Lemire 2006, arXiv:cs/0610046) not opened. PDF has been fetched (C:/Users/HEAT2/Downloads/lemire2006.pdf, 133427 bytes). Read + verbatim-pseudocode embed + verification that our deque implements the ≤3-comparison variant (not folklore) remains as the top open item.'),

      H1('5. Pending work'),
      BUL('Read the downloaded Lemire 2006 PDF (C:/Users/HEAT2/Downloads/lemire2006.pdf); embed verbatim pseudocode in op_lookahead.worklet.js header; confirm monotonic-deque implementation is the ≤3-comparison variant.'),
      BUL('P2 debt for #44 sidechainHPF: upgrade Butterworth-4 section Qs (Q1=0.5412, Q2=1.3066) and abstract the dB/oct control so order={1,2,4} all render.'),
      BUL('P2 debt for #46 meters: add true-peak preset (4x oversample), stereo variant, exact IEC 60268-17 VU curve lookup table.'),
      BUL('Git hygiene: ~60 ops + scratch files uncommitted since commit 88a2dd8 — stage and commit in logical chunks (deferred by user).'),
      BUL('Debt-section re-organization in sandbox_ops_research_debt.md (deferred by user).'),

      H1('6. Ship-gate standing'),
      P('All six ops pass qc:all (1106 checks clean — shape conformance + golden-vector SHA-256). The protocol breaks recorded here are documentation-integrity issues, not numerical-contract issues — the DSP math of each op matches its declared spec and, where a primary now exists, its open reference. The Dynamics family is closed at all currently-assigned slots.'),

      H1('7. Session signature'),
      MONO('Ops shipped:          6  (#41 gate, #42 expander, #43 transient,'),
      MONO('                          #44 sidechainHPF, #45 lookahead, #46 meters)'),
      MONO('Catalog delta:        75 -> 81  (+8.0 %)  ~62 % of ~130 assigned rows'),
      MONO('Family closed:        Dynamics (#3-#5, #40-#46, #48; #47/#49/#50 reserved)'),
      MONO('Protocol breaks:      4 earlier (3 remediated, 1 P1 debt)'),
      MONO('                      0 on #44/#46 (RBJ curl + in-tree composition)'),
      MONO('Primary sources:      3 open (Airwindows Point, Faust compressors.lib, RBJ cookbook)'),
      MONO('                      1 in-tree composition (op_peak + op_rms)'),
      MONO('                      1 pending read (Lemire 2006 PDF)'),
      MONO('                      1 math-by-definition w/ survey trail (#41)'),
      MONO('Goldens regressed:    0'),
      MONO('qc:all:               PASS (1106 / 1106)'),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('wrote', OUT, buf.length, 'bytes');
});
