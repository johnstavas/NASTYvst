// Builds QC_Rack_Audit.docx — audit of the QC rack system as it stood at end of session 2026-04-25.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation, PageBreak,
} = require('docx');

const ROOT = path.resolve(__dirname, '..');
const OUT  = path.join(ROOT, 'QC_Rack_Audit.docx');

const ARIAL = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    ...opts,
    children: opts.children || [new TextRun({ text, font: ARIAL, size: 22, ...(opts.run || {}) })],
  });
}
function H(text, level) {
  return new Paragraph({
    heading: level,
    spacing: { before: 220, after: 120 },
    children: [new TextRun({ text, font: ARIAL, bold: true, size: level === HeadingLevel.HEADING_1 ? 32 : level === HeadingLevel.HEADING_2 ? 28 : 24 })],
  });
}
function bullet(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    children: [new TextRun({ text, font: ARIAL, size: 22 })],
  });
}
function code(text) {
  return new Paragraph({
    spacing: { after: 80 },
    shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
    children: [new TextRun({ text, font: 'Consolas', size: 20 })],
  });
}
function cell(text, opts = {}) {
  const runOpts = opts.bold ? { bold: true } : {};
  return new TableCell({
    borders,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shade ? { fill: opts.shade, type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, font: ARIAL, size: 20, ...runOpts })] })],
  });
}

// Verified ops grouped by category and tolerance (from per_op_specs.json at session end)
const VERIFIED = [
  // category, op, tolerance, key params, source/algo
  ['Trivial / utility',   'gain',          '-120 dB', 'gainDb=-6',                       'linear gain (dB→amp)'],
  ['Trivial / utility',   'abs',           '-120 dB', '—',                               '|x|'],
  ['Trivial / utility',   'sign',          '-120 dB', '—',                               'sgn(x)'],
  ['Trivial / utility',   'scaleBy',       '-120 dB', 'k=2',                             'x·k'],
  ['Trivial / utility',   'clamp',         '-120 dB', 'lo=-0.5, hi=0.5',                 'min/max'],
  ['Trivial / utility',   'polarity',      '-120 dB', 'invert=false',                    'pass-through'],
  ['Trivial / utility',   'polarity_inv',  '-120 dB', 'invert=true',                     'unary minus'],
  ['Trivial / utility',   'uniBi',         '-120 dB', 'mode=uniToBi',                    '2x-1'],
  ['Trivial / utility',   'uniBi_b2u',     '-120 dB', 'mode=biToUni',                    '0.5x+0.5'],
  ['Trivial / utility',   'constant',      '-120 dB', 'value=500000',                    'const broadcast'],
  ['FB-safety',           'dcBlock',       '-90 dB',  'cutoff=10 Hz',                    'one-pole HP'],
  ['Tone-shaping',        'onePole_lp',    '-90 dB',  'cutoff=1 kHz',                    'one-pole LP'],
  ['Tone-shaping',        'onePole_hp',    '-90 dB',  'cutoff=1 kHz',                    'one-pole HP'],
  ['Tone-shaping',        'svf_lp',        '-90 dB',  'cutoff=10 kHz, Q=12',             'Simper SVF (TPT)'],
  ['Tone-shaping',        'ladder',        '-90 dB',  'cutoff=10 kHz, res=0.6',          'Stilson/Smith ladder'],
  ['Tone-shaping',        'biquad_lp',     '-90 dB',  'cutoff=1.2k Q=0.707',             'RBJ DF1'],
  ['Tone-shaping',        'biquad_hp',     '-90 dB',  'cutoff=800 Q=0.707',              'RBJ DF1'],
  ['Tone-shaping',        'biquad_bp',     '-90 dB',  'cutoff=1.5k Q=4',                 'RBJ DF1'],
  ['Tone-shaping',        'biquad_notch',  '-90 dB',  'cutoff=1k Q=6',                   'RBJ DF1'],
  ['Tone-shaping',        'biquad_peak',   '-90 dB',  'cutoff=2k Q=2 +6 dB',             'RBJ DF1'],
  ['Tone-shaping',        'biquad_lowshelf', '-90 dB','cutoff=250 Hz +6 dB',             'RBJ DF1'],
  ['Tone-shaping',        'biquad_highshelf','-90 dB','cutoff=6 kHz -6 dB',              'RBJ DF1'],
  ['Tone-shaping',        'shelf_low',     '-90 dB',  'mode=low, freq=250, +6 dB',       'RBJ shelf, S=1, alpha=√½'],
  ['Tone-shaping',        'allpass',       '-90 dB',  'freq=1 kHz',                      '1st-order AP'],
  ['Tone-shaping',        'tilt',          '-90 dB',  'f0=630, g=+3 dB, gf=5',           'musicdsp #267 (Ivanov 2009)'],
  ['Topology',            'gain_chain2',   '-120 dB', 'A=-6 dB, B=-6 dB',                'two gains in series'],
  ['Mix / saturation',    'drive',         '-100 dB', 'drive=4',                         'tanh drive'],
  ['Mix / saturation',    'mix',           '-110 dB', 'amount=0.3, wet=0.5',             'in-worklet equal-power'],
  ['Mix / saturation',    'softLimit',     '-120 dB', 'threshold=0.5',                   'soft-knee tanh limit'],
  ['Mix / saturation',    'saturate',      '-120 dB', 'drive=2, trim=-3 dB',             'tanh + trim'],
  ['Mix / saturation',    'bitcrush',      '-120 dB', 'bits=6',                          'mid-tread quantizer'],
  ['Mix / saturation',    'hardClip',      '-120 dB', 'drive=1.5, thr=0.7, adaa=false',  'clamp + ADAA opt'],
  ['Mix / saturation',    'wavefolder',    '-120 dB', 'drive=1.5, width=0.6, trim=-2',   'Faust ef.wavefold'],
  ['Mix / saturation',    'diodeClipper',  '-120 dB', 'drive=3, asym=0.3',               'arcsinh diode (Yeh DAFx \'08)'],
  ['Mix / saturation',    'chebyshevWS',   '-120 dB', 'g1..g5, level=0.8',               'Chebyshev T1..T5 sum'],
];

const BATCH_THIS_SESSION = new Set([
  'softLimit', 'saturate', 'bitcrush', 'hardClip', 'chebyshevWS',
  'wavefolder', 'diodeClipper', 'shelf_low', 'allpass', 'tilt',
]);

const IN_FLIGHT = [
  ['korg35',      '-90 dB',  'normFreq=0.5, Q=4',          'Faust ve.korg35LPF (Tarr/MIT-STK)', 'built; per_op_specs entry pending'],
  ['diodeLadder', '-90 dB',  'normFreq=0.45, Q=5',         'Faust ve.diodeLadder + Pirkle AN-6', 'built; per_op_specs entry pending'],
  ['smooth',      '-90 dB',  'time=5 ms',                  'one-pole α=1−e^(−1/(τ·sr))',        'built; per_op_specs entry pending'],
  ['slew',        '-120 dB', 'rise=5 ms, fall=20 ms',      'linear-rate asymmetric slew',        'BUILD FAILURE — op_slew.cpp.jinja namespace/class missing'],
];

// ---- Build doc -----------------------------------------------------------
const tableWidth = 9360; // 6.5" content width
const tocCols = [1500, 1200, 1100, 2700, 2860];

function row(cells, shade) {
  return new TableRow({ children: cells.map((t, i) => cell(t, { width: tocCols[i], shade })) });
}
function header(cells) {
  return new TableRow({
    tableHeader: true,
    children: cells.map((t, i) => cell(t, { width: tocCols[i], shade: 'D9E2F3', bold: true })),
  });
}

const verifiedTable = new Table({
  width: { size: tableWidth, type: WidthType.DXA },
  columnWidths: tocCols,
  rows: [
    header(['Category', 'Op', 'Tolerance', 'Key params', 'Algorithm / source']),
    ...VERIFIED.map((r) => {
      const isNew = BATCH_THIS_SESSION.has(r[1]);
      return row([r[0], r[1], r[2], r[3], r[4]], isNew ? 'FFF2CC' : undefined);
    }),
  ],
});

const inflightCols = [1500, 1100, 2400, 2400, 1960];
const inflightTable = new Table({
  width: { size: tableWidth, type: WidthType.DXA },
  columnWidths: inflightCols,
  rows: [
    new TableRow({
      tableHeader: true,
      children: ['Op', 'Tolerance', 'Params', 'Algorithm', 'Status']
        .map((t, i) => cell(t, { width: inflightCols[i], shade: 'F4B084', bold: true })),
    }),
    ...IN_FLIGHT.map((r) => new TableRow({
      children: r.map((t, i) => cell(t, { width: inflightCols[i] })),
    })),
  ],
});

const children = [
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'gainCOMPUTER — QC Rack Audit', font: ARIAL, bold: true, size: 40 })],
  }),
  new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: 'Phase 3 retroactive parity sweep · session of 2026-04-25', font: ARIAL, italics: true, size: 22, color: '595959' })],
  }),

  H('1. What the QC rack is', HeadingLevel.HEADING_1),
  P('The QC rack is the offline verification harness that gates every shipped sandbox op against bit-equivalence between the in-browser JS worklet (the authoring runtime) and the generated JUCE/VST3 native build (the deployment runtime). It is the hard ship-gate per memory/codegen_pipeline_buildout.md § 5.4 and ship_blockers.md.'),
  P('The rack consists of three coordinated components:'),
  bullet('parity_host.exe — JUCE-driven CLI that loads a built .vst3, drives standard test signals through it, and emits per-block float buffers.'),
  bullet('check_native_parity.mjs — the JS reference runtime; mirrors each op\'s worklet math (with Math.fround() to truncate to float32) and computes the max-abs-diff vs the parity_host capture.'),
  bullet('per_op_specs.json — the registry. One entry per shipped op binds: the .vst3 path, signal battery, tolerance in dB, parameter set, parameter ranges, and JS reference key.'),
  P('A fourth check, check_stereo_isolation.mjs (qc:stereo), regressions the MasterGraph stereo state-isolation contract independently of the per-op battery.'),

  H('2. Per-op recipe', HeadingLevel.HEADING_1),
  P('Every shipped op walks the same path before it can be marked verified:'),
  new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Read the worklet source in src/sandbox/ops/op_<name>.worklet.js.', font: ARIAL, size: 22 })] }),
  new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Mirror the per-sample math as a builtin:<name> entry in scripts/check_native_parity.mjs, wrapping every float op in Math.fround() to match float32 truncation.', font: ARIAL, size: 22 })] }),
  new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Author a smoke graph fixture at test/fixtures/codegen/smoke_<name>.graph.json — single node, in→op→out, schema v1.0.', font: ARIAL, size: 22 })] }),
  new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Build the native plugin via scripts/build_native.mjs with a per-build BUILD_SUFFIX (Smoke<Name>V0_YYMMDDhhmm) so caching never serves a stale binary.', font: ARIAL, size: 22 })] }),
  new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Append an entry to test/fixtures/parity/per_op_specs.json with the resolved .vst3 path, params, ranges, and tolerance.', font: ARIAL, size: 22 })] }),
  new Paragraph({ numbering: { reference: 'numbers', level: 0 }, children: [new TextRun({ text: 'Run npm run qc:parity (and qc:stereo) — both must report PASS at the declared tolerance.', font: ARIAL, size: 22 })] }),

  H('3. Tolerance policy', HeadingLevel.HEADING_1),
  P('Tolerance ceilings are tied to whether the op carries state across samples and whether nonlinearities defeat float associativity:'),
  bullet('-120 dB (stateless, deterministic): trivial utilities and pure waveshapers — gain, abs, clamp, polarity, scaleBy, drive, mix, softLimit, saturate, bitcrush, hardClip, wavefolder, diodeClipper, chebyshevWS.'),
  bullet('-100 to -110 dB: stateless but with transcendentals or chained math (drive, mix).'),
  bullet('-90 dB (stateful filters): one-pole, biquad, SVF, ladder, shelf, allpass, tilt, dcBlock — IIR feedback amplifies float ordering drift.'),

  H('4. Verified op inventory', HeadingLevel.HEADING_1),
  P('All entries below have a green qc:parity verdict at the declared tolerance and are bound in per_op_specs.json. Yellow rows = added or re-verified during this session.'),
  verifiedTable,
  P(' '),
  P(`Verified count: ${VERIFIED.length} ops. New / re-verified this session: ${BATCH_THIS_SESSION.size}.`),

  H('5. In-flight (batch 3 — partially closed)', HeadingLevel.HEADING_1),
  P('Batch 3 added linear/exponential smoothers and zero-delay-feedback ladder filters. JS references and graph fixtures are landed for all four; three native builds completed; one is the live blocker.'),
  inflightTable,
  P(' '),
  P('Blocker detail: Compiling the slew smoke plugin emits C2039 errors — "ops": is not a member of "shags" and "SlewOp_n_sl" not in shags. The first 20 lines of src/sandbox/ops/op_slew.cpp.jinja contain only #pragma once and an include; the namespace shags::ops { class SlewOp_{{ node_id }} ... } block must be added or repaired before the build will close. Per_op_specs entries for korg35, diodeLadder, smooth, and slew are intentionally held until the whole batch can be committed atomically.'),

  H('6. Risks & follow-ups', HeadingLevel.HEADING_1),
  bullet('Op-ship line is paused (codegen_pipeline_buildout.md § 6) until the retroactive sweep closes. Roughly ~80 shipped ops in src/sandbox/ops still need the same six-step recipe applied.'),
  bullet('--op <name> filter on qc:parity does not actually filter; it always sweeps all ops. Cosmetic — does not affect the verdict — but should be fixed before the verified list grows large enough to make full sweeps slow.'),
  bullet('Schema constraint surfaced this session: graph.json boolean params (e.g. hardClip.adaa) must be JSON booleans, not 0/1. T6 schema validator rejects numeric coercions.'),
  bullet('Per-build BUILD_SUFFIX is mandatory — without it the JUCE/CMake artefact cache silently serves the previous binary and parity verdicts become meaningless.'),
  bullet('JS references must use Math.fround() everywhere a float32 round-trip happens in the worklet, including intermediate sums. Missing one fround is the most common false-FAIL pattern.'),

  H('7. Sources & references', HeadingLevel.HEADING_1),
  bullet('memory/codegen_pipeline_buildout.md § 5.4–6 — Phase 3 retroactive sweep spec.'),
  bullet('memory/sandbox_op_ship_protocol.md — research-first ship rule and 6-step pre-ship checklist.'),
  bullet('memory/ship_blockers.md — hard-gate list (parity is on it).'),
  bullet('memory/dsp_code_canon_filters.md (RBJ §9, Stilson ladder, Simper SVF) — biquad / ladder / SVF references.'),
  bullet('memory/dsp_code_canon_character.md — tanh / Padé / fold-back / Chebyshev waveshaper canon.'),
  bullet('Faust ve.korg35LPF, ve.diodeLadder (Eric Tarr 2019, MIT-STK) — verbatim coefficient sources for the two ZDF ladder ops.'),
  bullet('musicdsp.org #267 — Lubomir Ivanov 2009 tilt EQ structure.'),
  bullet('Yeh, "Automated physical modeling of nonlinear audio circuits", DAFx 2008 — diode clipper arcsinh model.'),
];

const doc = new Document({
  creator: 'Claude (gainCOMPUTER QC)',
  title: 'gainCOMPUTER QC Rack Audit',
  styles: {
    default: { document: { run: { font: ARIAL, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: ARIAL, color: '1F3864' },
        paragraph: { spacing: { before: 280, after: 140 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: ARIAL, color: '2E74B5' },
        paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'numbers',
        levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // US Letter
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('Wrote', OUT, buf.length, 'bytes');
});
