// Build QC Rack Audit DOCX — snapshot of the QC rack system as it stands at
// end of session 2026-04-24. Destination: ../QC_Rack_Audit.docx
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(__dirname, '..', 'QC_Rack_Audit.docx');

const FONT = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 }, ...opts,
  children: Array.isArray(text) ? text : [new TextRun({ text, font: FONT, size: 22 })],
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 160 }, children: [new TextRun({ text: t, font: FONT, size: 32, bold: true })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 }, children: [new TextRun({ text: t, font: FONT, size: 26, bold: true })] });
const bullet = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
});
const code = (text) => new Paragraph({
  spacing: { after: 100 },
  shading: { fill: 'F2F2F2', type: ShadingType.CLEAR },
  children: [new TextRun({ text, font: 'Consolas', size: 20 })],
});
function cell(text, { bold = false, fill, width } = {}) {
  return new TableCell({
    borders,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20, bold })] })],
  });
}
function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { bold: true, fill: 'D5E8F0', width: colWidths[i] })) }),
      ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(String(c), { width: colWidths[i] })) })),
    ],
  });
}

const children = [];

children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 80 },
  children: [new TextRun({ text: 'QC Rack — Session Audit', font: FONT, size: 44, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 320 },
  children: [new TextRun({ text: 'Shags VST · 2026-04-24', font: FONT, size: 24, color: '555555' })],
}));

// ---- Executive Summary -----------------------------------------------------
children.push(H1('Executive Summary'));
children.push(P('The QC rack is the pre-commit quality gate for the Stage-3 codegen pipeline (graph.json → PCOF → master-worklet JS + C++/JUCE native). It enforces structural contracts (schema, op shape, ports, params), numerical contracts (golden-vector hashes, real-math assertions), and emit parity (JS ↔ C++ byte-equivalence) for every op and plugin graph in the repo.'));
children.push(P('This session pushed the op vocabulary from 16 registry-only entries to 58 ops shipped with the full tri-file contract — roughly 45% of the 130-op foundation ledger. Four of those 58 shipped today alone: istft (#67), convolution (#63), phaseVocoder (#68), and mfcc (newly slotted in the Analysis/Spectral family). Every one landed under the research-first ship protocol: primary source opened via tool call, passage pasted verbatim, deviations declared in the sidecar header, and qc:all green before commit.'));

children.push(H2('Headline Status'));
children.push(bullet('8 pre-commit gates wired through `npm run qc:all` (schema, t6, graphs, pcof, goldens, math, master, emit).'));
children.push(bullet('58 ops shipped with tri-file sidecars (worklet.js + cpp.jinja + test.js). 58 of ~130 target primitives (~45%).'));
children.push(bullet('MVP six complete: gain, filter, detector, envelope, gainComputer, mix. FB-safety triad complete: dcBlock, softLimit, saturate.'));
children.push(bullet('Spectral chain operational: fft → stft → phaseVocoder → istft → ifft. Feature-extraction: mfcc, lpc, goertzel, rms, peak, truePeak, lufsIntegrator.'));
children.push(bullet('5 T6 validator rules live. 4 QC golden-hash fixtures regenerated this session.'));
children.push(bullet('Research-first ship protocol (sandbox_op_ship_protocol.md) binding since #20 fdnCore Householder bug. Zero post-commit math defects since.'));

// ---- The Eight Gates -------------------------------------------------------
children.push(H1('The Eight Gates'));
children.push(P('Each gate runs in isolation and as part of qc:all. A single gate failure blocks the commit. Gates run in dependency order: structural → graph-level → op-level → codegen.'));

children.push(makeTable(
  ['#', 'Gate', 'Script', 'What it enforces'],
  [
    ['1', 'schema',  'check_schema_v1.mjs',         'graph.json conforms to v1 schema. Typed ports, known op ids, well-formed edges.'],
    ['2', 't6',      'check_t6_rules.mjs',          'Semantic rules beyond schema: FB cycle declared, DC trap present, safety node before writeback, GR monotonicity, denormal guard.'],
    ['3', 'graphs',  'check_all_graphs_deep.mjs',   'Every plugin graph passes deep validation — unreachable nodes, orphaned ports, type mismatches.'],
    ['4', 'pcof',    'check_pcof.mjs',              'PCOF (flattened IR) round-trips from graph and matches canonical form. Op ordering, param resolution, port wiring.'],
    ['5', 'goldens', 'check_op_goldens.mjs',        'Shape conformance (A) + SHA-256 of each op sidecar against fixed chirp+impulse drive at SR=48000, N=128.'],
    ['6', 'math',    'check_op_math.mjs',           'Real-math unit tests per op (op_<id>.test.js). Asserts DSP behaviour beyond hash — determinism, clamps, reset, defensive I/O.'],
    ['7', 'master',  'check_master_worklet.mjs',    'Codegen emits a byte-stable master worklet for each graph. Output hash pinned per plugin.'],
    ['8', 'emit',    'check_master_emit_parity.mjs','JS master worklet and C++ native emitter produce equivalent numerical output for the same graph + drive buffer.'],
  ],
  [500, 1100, 2400, 5360],
));

children.push(H2('Gate 5 — Op Golden Harness'));
children.push(P('Two independent contracts per op: (A) sidecar static opId/inputs/outputs/params match opRegistry.js entry exactly (order-insensitive); (B) sidecar driven with fixed chirp (96 samples) + impulse (sample 100), output hashed SHA-256, compared against scripts/goldens/<opId>.golden.json. First run creates the golden. Later math changes break the hash — author re-blesses deliberately via `--bless`. Sidecars are plain ES modules (no AudioWorkletGlobalScope), because master-worklet codegen stitches them flat.'));

children.push(H2('Gate 6 — Op Math Harness'));
children.push(P('Each op ships op_<id>.test.js exporting { opId, tests: [{ name, run }] }. Tests assert real DSP properties — determinism, parameter clamps, reset semantics, defensive null I/O, numerical relationships the golden hash cannot encode (e.g. mfcc silent-spectrum DC coefficient ≈ nfilt · log(1e-10), istft→stft round-trip identity under COLA, phase-vocoder bin-shift at pitch=2 doubles the peak bin index). Introduced mid-session and retrofitted to every previously shipped op.'));

// ---- Tri-File Contract -----------------------------------------------------
children.push(H1('Op Vocabulary — Tri-File Contract'));
children.push(P('Every op ships three files:'));
children.push(code('src/sandbox/ops/op_<id>.worklet.js   — JS sidecar (authoritative math + verbatim passage)\nsrc/sandbox/ops/op_<id>.cpp.jinja    — C++ template (codegen source for JUCE build)\nsrc/sandbox/ops/op_<id>.test.js      — real-math unit tests (Gate 6)'));
children.push(P('opRegistry.js is the single source of truth for op metadata (label, description, ports, params, defaults, formatters). Registry and sidecar must agree — Gate 5A fails the commit if they drift.'));

// ---- Shipped ops by family -------------------------------------------------
children.push(H2('58 Ops Shipped (2026-04-24)'));
children.push(makeTable(
  ['Family', 'Ops'],
  [
    ['Level / Mix',       'gain, mix, scaleBy, clamp, polarity, sign, abs, constant, uniBi, fanOut'],
    ['Tone / Filter',     'filter, shelf, onePole, svf, allpass, ladder, dcBlock'],
    ['Dynamics',          'detector, envelope, gainComputer, softLimit, saturate, peak, rms, truePeak'],
    ['Metering / Loud.',  'kWeighting, lufsIntegrator, loudnessGate, lra, correlation, stereoWidth'],
    ['Modulation',        'lfo, noise, smooth, slew, glide, ramp, trigger, z1, quantizer, curve'],
    ['Time / Delay',      'delay, combine, bitcrush, phaseVocoder'],
    ['Synthesis / Phys.', 'karplusStrong, waveguide, kellyLochbaum, fdnCore, adsr'],
    ['Analysis / Spectral', 'fft, ifft, stft, istft, convolution, mfcc, goertzel, lpc'],
  ],
  [2600, 6760],
));

children.push(H2('Ops Shipped This Session (4)'));
children.push(makeTable(
  ['Slot', 'Op', 'Primary Source', 'Deviations Declared'],
  [
    ['#63', 'convolution',   'JOS MDFT — Convolution (direct-form FIR)', 'Linear (not circular); capture-based IR over first `length` samples then frozen; no FFT-OLA (tracked as P2 Gardner partitioned).'],
    ['#67', 'istft',         'JOS SASP — OLA resynthesis, Hann synthesis window', 'Single OLA policy (no WOLA norm); olaScale = hop / Σw²; size+hop params match stft.'],
    ['#68', 'phaseVocoder',  'Bernsee smbPitchShift via TarsosDSP port',  'osamp=1 placeholder (P1 debt — proper quality needs osamp≥4 and graph-level hop-coord); no peak-locking; no formant preservation.'],
    ['#62', 'mfcc',          'python_speech_features + Wikipedia MFCC',   'No preemphasis, no ceplifter, no appendEnergy, no ortho DCT scale, LOG_FLOOR=1e-10 (all tracked as P2).'],
  ],
  [700, 1400, 3200, 4060],
));

// ---- T6 Rules --------------------------------------------------------------
children.push(H1('T6 Validator Rules'));
children.push(P('Gate 2 runs semantic rules that schema validation cannot catch. Current rule set:'));
children.push(makeTable(
  ['Rule', 'What it catches', 'Ship-gate?'],
  [
    ['FB_CYCLE_DECLARED',       'Any feedback edge must be explicitly flagged (prevents accidental cycles).', 'Yes'],
    ['FB_DC_TRAP',              'Feedback loops must pass through a dcBlock or shelf before writeback (prevents DC runaway).', 'Yes'],
    ['FB_SAFETY_NODE',          'Writeback path must have a soft-clip/tanh safety node (prevents FB runaway under extreme params).', 'Yes'],
    ['GAINCOMP_MONOTONIC',      'gainComputer transfer curve must be monotonic non-increasing vs. input level.', 'Yes'],
    ['ENVELOPE_DENORMAL_GUARD', 'Envelope followers must apply Jon Watte denormal macro (Canon:utilities §1).', 'Yes'],
  ],
  [3200, 5300, 860],
));

// ---- Pipeline --------------------------------------------------------------
children.push(H1('Pipeline Position'));
children.push(P('The QC rack sits between authoring and codegen:'));
children.push(code('graph.json  ──▶ [schema] ──▶ [t6] ──▶ [graphs] ──▶ PCOF\nPCOF        ──▶ [pcof]  ──▶ master-worklet.js  ──▶ [master] ──▶ AudioWorklet runtime\nPCOF        ──▶ [pcof]  ──▶ master.cpp         ──▶ [emit]   ──▶ JUCE VST3/AU build\nop sidecars ──▶ [goldens] + [math]  (independent of any graph)'));
children.push(P('Every gate must green before a commit lands. The rack replaces the previous chain-of-worklets runtime once master-worklet codegen is live across all plugins — a Stage-3 completion marker.'));

// ---- Research-first ship protocol -----------------------------------------
children.push(H1('Research-First Ship Protocol'));
children.push(P('Binding since 2026-04-23, after #20 fdnCore shipped with a Householder-ordering bug caught only on post-ship user pushback. Every op ship now requires:'));
children.push(bullet('Primary source opened via WebFetch / Read tool call — memory files are pointers, not sources.'));
children.push(bullet('Passage pasted verbatim into the sidecar header (authoritative reference text, license-tagged).'));
children.push(bullet('Declared deviations block — any passage↔code difference itemised (e.g. "no preemphasis", "osamp=1 placeholder").'));
children.push(bullet('Tri-file set written (worklet.js + cpp.jinja + test.js) with math mirrored bit-for-bit across JS and C++.'));
children.push(bullet('npm run qc:all green — all 8 gates pass with new golden + new math tests.'));
children.push(bullet('Catalog (sandbox_ops_catalog.md) + debt ledger (sandbox_ops_research_debt.md) updated.'));

// ---- Known gaps ------------------------------------------------------------
children.push(H1('Known Gaps & Next Work'));
children.push(H2('Immediate'));
children.push(bullet('Continue op vocab build-out toward 130: next front is Analysis/Spectral completion (warpedLPC #72, chromagram #73, onset #74, bpm #75).'));
children.push(bullet('phaseVocoder v2 — osamp≥4 quality pass; requires graph-level hop coordination between stft/istft/pv (P1 debt).'));
children.push(bullet('mfcc P2 upgrades: preemphasis, ceplifter, appendEnergy, ortho DCT scale.'));
children.push(H2('Structural'));
children.push(bullet('Extend Gate 7 (master-worklet) coverage to every plugin graph as master-worklet codegen rolls out per-plugin.'));
children.push(bullet('Plugin onboarding gate — each plugin graph must pass qc:all AND a dry/wet null test against spec before shipping (per dry_wet_mix_rule.md).'));
children.push(bullet('Ship-blocker integration — ship_blockers.md hard-gates (dcBlock, FB safety, denormal tail, band reconstruction) mechanically enforced by the rack, not authored into checklist comments.'));

// ---- Doctrine --------------------------------------------------------------
children.push(H1('Doctrine'));
children.push(bullet('Foundation-first. No plugin work proceeds until its ops exist as tested primitives.'));
children.push(bullet('Research-backed. Every op cites a Canon entry or primary source. No citation → do the research before coding.'));
children.push(bullet('One at a time. Ops land sequentially: research → registry → sidecar → cpp template → test → golden → qc:all green → catalog update → next.'));
children.push(bullet('Declare deviations. Any divergence from primary source is named in the sidecar header and logged as P1/P2 debt.'));

children.push(new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: '— End of audit —', font: FONT, size: 20, color: '888888', italics: true })] }));

// ---- build -----------------------------------------------------------------
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: FONT },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
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

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log(`Wrote: ${outPath} (${buffer.length} bytes)`);
