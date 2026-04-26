// Generate QC_Rack_Audit.docx documenting the sandbox op QC rack system.
import fs from 'node:fs';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, WidthType, BorderStyle,
  ShadingType, PageOrientation
} from 'docx';

const OUT = 'C:/Users/HEAT2/Desktop/Shags VST/QC_Rack_Audit.docx';

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t) => new Paragraph({ children: [new TextRun(t)] });
const B  = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun(t)] });
const BB = (label, rest) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [ new TextRun({ text: label, bold: true }), new TextRun(rest) ]
});
const Code = (t) => new Paragraph({
  children: [new TextRun({ text: t, font: 'Consolas', size: 18 })],
  shading: { type: ShadingType.CLEAR, fill: 'F4F4F4' }
});

// 8-gate table
function gateRow(gate, cmd, enforces, outputs) {
  return new TableRow({ children: [
    new TableCell({ borders, margins: cellMargins, width: { size: 1400, type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: gate, bold: true })] })] }),
    new TableCell({ borders, margins: cellMargins, width: { size: 2400, type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: cmd, font: 'Consolas', size: 18 })] })] }),
    new TableCell({ borders, margins: cellMargins, width: { size: 3200, type: WidthType.DXA },
      children: [new Paragraph(enforces)] }),
    new TableCell({ borders, margins: cellMargins, width: { size: 2360, type: WidthType.DXA },
      children: [new Paragraph(outputs)] }),
  ]});
}

const gateHeader = new TableRow({ tableHeader: true, children: [
  ['Gate','Command','Enforces','Artifact'].map(h =>
    new TableCell({ borders, margins: cellMargins,
      shading: { type: ShadingType.CLEAR, fill: 'D5E8F0' },
      width: { size: [1400,2400,3200,2360][['Gate','Command','Enforces','Artifact'].indexOf(h)], type: WidthType.DXA },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })
  )
]});

const gateTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [1400, 2400, 3200, 2360],
  rows: [
    gateHeader,
    gateRow('1. schema', 'qc:schema',     'graph.json conforms to schema v1 (port typing, param ranges, id uniqueness).', 'pass/fail per graph'),
    gateRow('2. t6',     'qc:t6',         'Tier-6 rules: dry/wet mix inside worklet, bypass contract, FB-tap pre-mix, DC block under FB, denormal tail, FB runaway guard.', 'rule pass matrix'),
    gateRow('3. graphs', 'qc:graphs',     'Every graph compiles: ops exist in registry, ports wired, no dangling edges, cycle-set has z-1.', 'deep compile report'),
    gateRow('4. pcof',   'qc:pcof',       'Param-Control Ordering Form: param events arrive before audio block, no stale reads.', 'ordering matrix'),
    gateRow('5. goldens',    'qc:goldens',    'Per-op 128-sample SHA-256 rendered at sr=48k vs blessed JSON hash.', 'scripts/goldens/<op>.golden.json'),
    gateRow('6. math',   'qc:math',       'Per-op mathematical invariants (frequency response, monotonicity, DC, energy, clamp safety).', '716 assertions (2026-04-24)'),
    gateRow('7. master', 'qc:master',     'Master worklet: chain-of-worklets ordering, port-type parity, parameter flattening.', 'master shape golden'),
    gateRow('8. emit',   'qc:emit',       'Emit parity: graph.json → chain-worklet ≡ graph.json → codegen emitter (PCOF invariant).', 'emit-parity report'),
  ],
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 34, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 260, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
    }]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Sandbox Op QC Rack — Session Audit', bold: true, size: 40 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Shags VST  \u00b7  2026-04-24', color: '666666' })]
      }),

      H1('1. Purpose'),
      P('The QC rack is the automated, gated quality bar that every sandbox op must clear before it is considered shipped. It replaces ad-hoc spot-checks with a reproducible, source-of-truth pipeline: graph\u2192op\u2192worklet\u2192master\u2192emit. This document audits the state of that rack at the close of the 2026-04-23/24 session.'),
      P('The rack grew out of the fdnCore (#20) near-miss, where a v1 shipped with a Householder-ordering bug that all prior checks passed. The response was two-fold: a binding research-first ship protocol (sandbox_op_ship_protocol.md) and this eight-gate automated rack.'),

      H1('2. The Eight Gates'),
      P('All gates are driven from package.json scripts and composed by qc:all, which must be green before any op is considered shipped. Gates fail fast \u2014 the first red gate aborts the chain.'),
      gateTable,

      H1('3. Artifacts and Source Layout'),
      H2('3.1 Per-op tri-file contract'),
      P('Every op lives in exactly three files under src/sandbox/ops/:'),
      BB('op_<id>.worklet.js', ' \u2014 the runtime DSP (AudioWorkletProcessor-compatible shape).'),
      BB('op_<id>.cpp.jinja',  ' \u2014 the native emitter template; must be bit-identical math to the worklet.'),
      BB('op_<id>.test.js',    ' \u2014 the mathematical invariant suite consumed by qc:math.'),
      P('Registration happens in src/sandbox/opRegistry.js. Golden hashes live at scripts/goldens/<op>.golden.json.'),

      H2('3.2 Check scripts'),
      B('scripts/check_schema_v1.mjs \u2014 graph.json schema v1 validator'),
      B('scripts/check_t6_rules.mjs \u2014 Tier-6 rule body runner'),
      B('scripts/check_all_graphs_deep.mjs \u2014 deep compile/link of every graph'),
      B('scripts/check_pcof.mjs \u2014 param/control ordering verifier'),
      B('scripts/check_op_goldens.mjs \u2014 per-op 128-sample SHA-256 render (--bless to rewrite)'),
      B('scripts/check_op_math.mjs \u2014 invariant suite aggregator'),
      B('scripts/check_master_worklet.mjs \u2014 master shape-hash verifier (--bless to rewrite)'),
      B('scripts/check_master_emit_parity.mjs \u2014 chain-of-worklets vs codegen emit parity'),

      H1('4. Ship Protocol Integration'),
      P('sandbox_op_ship_protocol.md (binding 2026-04-23) wraps the rack with research-first discipline. The QC rack catches mechanical deviation; the protocol catches semantic deviation from the primary source. Both are required.'),
      P('Six-step pre-ship checklist, applied to every op ship this session:'),
      new Paragraph({ numbering: { reference: 'bullets', level: 0 }, children: [new TextRun('Open the primary source with a tool call (paper PDF, canonical repo file, reference implementation) \u2014 not a memory summary. Paste file path + line range.')] }),
      B('Paste the relevant passage verbatim in the worklet header.'),
      B('Write the three files (worklet.js, cpp.jinja, test.js).'),
      B('Diff passage vs code side-by-side; call out every deviation.'),
      B('npm run qc:all \u2014 must be green.'),
      B('Update sandbox_ops_catalog.md and log skipped upgrade paths in sandbox_ops_research_debt.md.'),

      H1('5. Session Activity (2026-04-23 \u2192 2026-04-24)'),
      H2('5.1 Post-audit ships under research-first protocol'),
      BB('#34 ladder', ' \u2014 Moog VCF 4-pole LP. Primary: musicdsp.org #24 (mistertoast). 11 math invariants added. Golden blessed at db65386bb5d1585d\u2026 Upgrade paths logged: BP/HP taps (P2), Hötvinen DAFX04 2\u00d7 OS fidelity (P1).'),
      BB('#40 adsr', ' \u2014 ADSR envelope. Primary: musicdsp.org #189 (Schoenebeck 2005, fast exponential envelope). Ship in progress at session end.'),

      H2('5.2 Side-catches the rack produced'),
      BB('lufsIntegrator golden drift', ' \u2014 op code had been reworked for EBU Tech 3341 V4 sliding rectangular windows without re-blessing the golden JSON. The stale hash d1d2b20a0694aacb\u2026 was silently wrong until qc:goldens ran during the ladder ship. Corrected in-session to b244229144f2a741\u2026 matching the audit doc of record.'),
      BB('Wrong canon pointer for adsr', ' \u2014 sandbox_ops_catalog.md pointed at Canon:dynamics \u00a75, which is the stereo-link peak compressor, not an envelope. Correct primary lives at Canon:synthesis \u00a712. The research-first step caught it before any code was written.'),

      H2('5.3 Numbers'),
      B('Shipped ops: 17 (16 pre-session + #34 ladder). #40 adsr in flight.'),
      B('Math assertions: 716 (up from 705 \u2014 +11 ladder invariants).'),
      B('Goldens: 100 blessed.'),
      B('Audit coverage: 49/49 pre-session ops verified.'),

      H1('6. Known Gaps and Follow-ups'),
      BB('128-sample golden length', ' \u2014 does not catch DSP ordering changes when delay lines have not wrapped yet. Flagged as a harness-quality item during the fdnCore audit; still open.'),
      BB('Research debt ledger', ' \u2014 sandbox_ops_research_debt.md tracks known-better upgrade paths not yet ingested (P0/P1/P2/P3). Formal sweep deferred until ~80/130 ships or codegen Stage-3b canonicalization, whichever lands first.'),
      BB('Codegen emit path', ' \u2014 qc:emit gate is live but the native JUCE+CMake emit path (Stage-3c) is not yet the shipped runtime. The chain-of-worklets is still authoritative pending master-compiler landing.'),

      H1('7. Verdict'),
      P('The QC rack is load-bearing. Two independent silent-failure conditions (lufsIntegrator golden drift, wrong canon pointer for adsr) were caught in a single session \u2014 one by the rack, one by the protocol that wraps it. Neither would have been caught by spot-checking, and either would have shipped as a latent regression without this infrastructure.'),
      P('Recommendation: keep qc:all as the hard gate for every op ship, and continue pairing it with research-first primary-source reads. Address the 128-sample golden length limitation before the next reverb-class op ships.'),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('wrote', OUT, buf.length, 'bytes');
});
