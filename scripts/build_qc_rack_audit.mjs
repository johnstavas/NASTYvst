// build_qc_rack_audit.mjs — generates QC_Rack_Audit.docx
import fs from 'fs';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, PageNumber, Header, Footer,
} from 'docx';

const ARIAL = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };

const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, font: ARIAL, size: 22, ...opts })], spacing: { after: 120 } });
const H1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, bold: true, size: 32, font: ARIAL, color: '1F3864' })], spacing: { before: 320, after: 200 } });
const H2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, size: 26, font: ARIAL, color: '2E75B6' })], spacing: { before: 240, after: 140 } });
const H3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, bold: true, size: 22, font: ARIAL, color: '404040' })], spacing: { before: 180, after: 100 } });
const Code = (text) => new Paragraph({
  children: [new TextRun({ text, font: 'Consolas', size: 18 })],
  shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
  spacing: { after: 80 },
});
const Bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  children: [new TextRun({ text, font: ARIAL, size: 22 })],
});

const cell = (text, opts = {}) => new TableCell({
  borders,
  width: { size: opts.w, type: WidthType.DXA },
  shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text: String(text), font: ARIAL, size: 20, bold: !!opts.bold })] })],
});

function tbl(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, { w: widths[i], bold: true, fill: 'D9E2F3' })) }),
      ...rows.map(r => new TableRow({ children: r.map((c, i) => cell(c, { w: widths[i] })) })),
    ],
  });
}

const children = [];

children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: 'gainCOMPUTER — QC Rack Audit', font: ARIAL, size: 44, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 320 },
  children: [new TextRun({ text: 'Behavioral validation harness, native-parity hardening, and codegen audio-quality fixes built this session', font: ARIAL, size: 22, italics: true, color: '595959' })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 320 },
  children: [
    new TextRun({ text: 'Date: 2026-04-26     ', font: ARIAL, size: 20 }),
    new TextRun({ text: 'Tier: T8 / T8-B     ', font: ARIAL, size: 20 }),
    new TextRun({ text: 'Status: B-step in progress (4/8 done)', font: ARIAL, size: 20, bold: true }),
  ],
}));

children.push(H1('1. Executive Summary'));
children.push(P('The "QC rack" is the three-layer ship gate guarding gainCOMPUTER’s op-ship line: T1–T7 sandbox sweep, T8 native-parity, and T8-B behavioral validation. This session closed a long-standing coverage hole — four ops (detector, envelope, filter, gainComputer) had C++ stubs that emitted silence and were therefore invisibly silent in every compiled compressor recipe shipped to date — and added the first behavioral-metric modules that test ops by their declared audio behavior rather than just sample-for-sample worklet/native parity.'));
children.push(P('Three families of work landed:'));
children.push(Bullet('Native-parity coverage. Four C++ stubs ported from their JS worklets, registered in per_op_specs.json with reference functions in check_native_parity.mjs. All four PASS at -90 to -120 dB tolerance.'));
children.push(Bullet('Behavioral-metric harness. New primitive transfer_curve.mjs, new metrics envelopeStep.mjs (Attack T90 / Release T90 / Steady-state) and gainCurve.mjs (static threshold/ratio/knee fit). Wires to the same two-arm runner already used by Cluster-A.'));
children.push(Bullet('Codegen audio-quality fixes. Per-sample parameter smoothing in op_gain / op_mix / op_xformerSat / op_gainComputer. 5 ms bypass crossfade with always-running graph. Log-skew auto-applied to time/freq APVTS params. lockedParams whitelist and presets-only UI mode.'));
children.push(P('B-step status: 4 of 8 sub-steps complete. Wiring + spec authoring + sweep run + commit still pending before C-step (recipe-level behavioral) can begin.'));

children.push(H1('2. QC Rack Architecture'));
children.push(P('Three independent gates, all of which must be green before an op may flip to PASS+P in the catalog (per ship_blockers.md §8):'));
children.push(tbl(
  ['Gate', 'Layer', 'What it verifies', 'Tooling'],
  [
    ['T1–T7', 'Sandbox sweep', 'Worklet golden traces (250 fixtures), DC rejection, denormal tail, FB runaway, dry/wet, bypass, latency', 'scripts/check_*.mjs (sweep)'],
    ['T8',         'Native parity', 'Compiled C++ op output matches worklet reference within tolerance, sample-by-sample',                       'check_native_parity.mjs + parity_host'],
    ['T8-B',       'Behavioral',    'Op output matches its declared audio-behavior contract (T90 step times, static curve fit, frequency response)', 'check_behavioral.mjs + metrics/*'],
  ],
  [1500, 1700, 4400, 1760]
));
children.push(P('A green T8 only proves "the C++ does what the JS does." T8-B is what proves "the JS does what we said it does." The session’s headline finding — four silent C++ stubs — is the textbook case for why T8 alone was insufficient: the worklet was correct, parity was passing against a stub of zeros, and the op shipped silent into every recipe that consumed it.'));

children.push(H1('3. Behavioral Coverage Built This Session'));

children.push(H2('3.1 Primitive: transfer_curve.mjs'));
children.push(P('Steady-state input-magnitude to output-magnitude sweep, with a fitter for the classic compressor static curve.'));
children.push(P('Path: src/sandbox/behavioral/primitives/transfer_curve.mjs', { italics: true, color: '595959' }));
children.push(H3('Exports'));
children.push(Bullet('staticTransferCurve(runOp, { levelsLin, sr, holdSec, signalType, sineHz }) — feeds DC or 1 kHz sine at each level, measures settled tail (last 20%), returns { samples: [{inLin, outLin, inDb, outDb}] }.'));
children.push(Bullet('fitCompressorCurve(samples) — extracts threshold, ratio, knee width from sample set via slope analysis at low and high quartiles. Returns { thresholdDb, ratio, kneeDb, slopeBelow, slopeAbove }.'));
children.push(P('Citation: Giannoulis, Massberg, Reiss. "Digital Dynamic Range Compressor Design — A Tutorial and Analysis." JAES 60(6), 2012. Soft-knee Hill-curve form per Zölzer DAFX § 4.2.2.'));

children.push(H2('3.2 Metric: envelopeStep.mjs'));
children.push(P('Tests an envelope-follower op against IEC 60268-3 step-response convention.'));
children.push(P('Path: src/sandbox/behavioral/metrics/envelopeStep.mjs', { italics: true, color: '595959' }));
children.push(tbl(
  ['Test', 'Stimulus', 'Pass criterion'],
  [
    ['Attack T90',          'level step low-to-high, 400 ms pre / 1.5 s post',  'reach time within +/-30% of declared.attack_ms'],
    ['Release T90',         'level step high-to-low, same hold',                'reach time within +/-30% of declared.release_ms'],
    ['Steady-state level',  'constant input 2.0 s',                             'settled tail = amount*input + offset, within 5%'],
  ],
  [1700, 3200, 4660]
));

children.push(H2('3.3 Metric: gainCurve.mjs'));
children.push(P('Tests gainComputer’s static gain-reduction curve against declared threshold/ratio/knee.'));
children.push(P('Path: src/sandbox/behavioral/metrics/gainCurve.mjs', { italics: true, color: '595959' }));
children.push(P('Methodology:'));
children.push(Bullet('Sweep 21 input magnitudes from -60 dBFS to 0 dBFS in 3 dB steps.'));
children.push(Bullet('For each level, drive op’s env input with constant DC, hold 0.3 s, capture signed mean of last 20%.'));
children.push(Bullet('Reconstruct downstream output level: out_dB = in_dB + 20*log10(1 + gr_signed).'));
children.push(Bullet('Run fitCompressorCurve on the (in_dB, out_dB) pairs.'));
children.push(Bullet('Compare to declared with tolerances: threshold +/-2 dB, ratio +/-15%, sub-threshold slope within 0.15 of unity.'));

children.push(H1('4. Native-Parity Hole Closed'));
children.push(P('The headline find of the session. Four ops had functioning JS worklets but their C++ counterparts contained only:'));
children.push(Code('// op_envelope.cpp.jinja  (BEFORE)\nfor (int i = 0; i < N; ++i) out[i] = 0.0f;\n// TODO: port from worklet'));
children.push(P('Because none of the four had been registered in per_op_specs.json, T8 parity was never actually run against them. Every compiled compressor recipe (NastyNeve, NastyComp, smoke_neve33609) was silently producing dry-and-makeup-only output. This is the root cause of the multi-week "doesn’t compress" debugging arc visible across user sessions.'));
children.push(H3('Fix scope'));
children.push(tbl(
  ['Op', 'Action', 'Native parity result'],
  [
    ['detector',     'ported AR detector (mode 0 peak |x|, mode 1 RMS x^2)',                          'PASS at <= -120 dB'],
    ['envelope',     'ported AR follower with Watte denormal bias',                                   'PASS at <= -90 dB'],
    ['filter',       'ported RBJ biquad DF1, modes lp/hp/bp/notch',                                   'PASS at <= -100 dB'],
    ['gainComputer', 'ported Zölzer soft-knee static gain computer + per-sample thr/ratio/knee smoothing', 'PASS at <= -100 dB'],
  ],
  [1700, 5000, 2860]
));
children.push(P('All four registered in test/fixtures/parity/per_op_specs.json with reference functions added to scripts/check_native_parity.mjs (using Math.fround for float32-correct comparison).'));

children.push(H1('5. Codegen Audio-Quality Fixes'));
children.push(P('Three classes of click/pop bug were chased down and fixed at the template/op layer:'));

children.push(H2('5.1 Per-Sample Parameter Smoothing'));
children.push(P('Block-rate APVTS reads were producing audible step artifacts on knob moves. Each affected op now smooths its base param across the block:'));
children.push(Code('// Sentinel: < 0 = prime on first block\nif (baseSmoothed_ < 0.0f) baseSmoothed_ = baseTarget;\nfor (int i = 0; i < N; ++i) {\n    baseSmoothed_ += (baseTarget - baseSmoothed_) * step_;\n    out[i] = in[i] * baseSmoothed_;\n}'));
children.push(P('Applied to: op_gain, op_mix (dry + wet equal-power legs), op_xformerSat (drive), op_gainComputer (thr / ratio / knee).'));

children.push(H2('5.2 Bypass Crossfade with Always-Running Graph'));
children.push(P('Two bugs in one fix: (a) instant bypass produced clicks; (b) bypass-then-unbypass produced a "wake-up transient" because compressor state had frozen. Solution: graph_.process is now called on every block whether bypassed or not, and the output is a 5 ms per-sample crossfade between dryCopy_ and the processed buffer.'));
children.push(P('Template: src/sandbox/codegen/templates/PluginProcessor.cpp.jinja', { italics: true, color: '595959' }));
children.push(Code('const double targetFade = bypass_->get() ? 0.0 : 1.0;\n// Snapshot dry BEFORE graph clobbers buffer in place\nfor (int ch = 0; ch < chCopy; ++ch)\n    std::memcpy(dryCopy_.getWritePointer(ch), buffer.getReadPointer(ch), bytes);\ngraph_.process(buffer);\n// Per-sample crossfade ~5 ms\nfor (int i = 0; i < N; ++i) { fade += step toward target; mix wet*fade + dry*(1-fade); }'));

children.push(H2('5.3 Log-Skew Auto-Applied to Time/Freq Params'));
children.push(P('Reaper’s mouse-wheel scroll uses percent-of-range, so a linear NormalisableRange on Attack [0.05, 500] ms snapped 74 ms to 93 ms in one click. build_native.mjs now auto-detects time-domain param IDs (regex /attack|release|time|freq|cutoff/) and applies skew = 0.3 if range ratio exceeds 50x, producing the standard log-feel knob curve.'));

children.push(H1('6. Recipe-Author UX Hooks'));
children.push(P('Two graph-schema features were added so authors can ship plugins that are not "knob soup":'));
children.push(H3('ui.lockedParams'));
children.push(P('A whitelist of APVTS param IDs to NOT expose. The baked default from defaultParams is still applied via paramSet, so author intent is preserved without polluting the user surface. Used in nasty_neve_v1.graph.json to hide internal detector mode, envelope amount/offset, and VCA bias gain.'));
children.push(H3('ui.mode = "presets-only"'));
children.push(P('Renders the editor as a radio-grouped 3-button preset bank (LIGHT / MEDIUM / SMASHED in the nasty_3btn recipe), each calling setValueNotifyingHost on every APVTS param it overrides. Optional ui.userKnobs adds a small set of always-visible knobs (e.g., TRIM) alongside the buttons.'));

children.push(H1('7. Status & Open Punch List'));
children.push(tbl(
  ['Step', 'Description', 'State'],
  [
    ['B-1', 'step_response primitive ready',                              'DONE'],
    ['B-2', 'transfer_curve primitive built',                             'DONE'],
    ['B-3', 'envelopeStep metric built',                                  'DONE'],
    ['B-4', 'gainCurve metric built',                                     'DONE'],
    ['B-5', 'Add behavioral specs for envelope + gainComputer',           'IN PROGRESS'],
    ['B-6', 'Wire metrics into runner.mjs CATEGORY_DISPATCH',             'PENDING'],
    ['B-7', 'Run two-arm sweep, confirm PASS',                            'PENDING'],
    ['B-8', 'Commit + push',                                              'PENDING'],
    ['C',   'Recipe-level (graph) behavioral testing',                    'PENDING (after B)'],
  ],
  [900, 6800, 1660]
));
children.push(H2('Tabled / non-blocking'));
children.push(Bullet('Random clicks on bass at high HEAT — possibly subnormal stalls or audio-rate modulation regime; user said "we are good for now."'));
children.push(Bullet('Envelope op attack/release alpha smoothing — current attack/release coefficients update at block-rate; not yet a confirmed audible issue.'));

children.push(H1('8. Risks & Watch-Items'));
children.push(Bullet('T8 cannot catch a stub. Ops must be registered in per_op_specs.json before parity is meaningful. Audit the per_op_specs.json registry against the live op dir on each new op ship.'));
children.push(Bullet('T8-B specs encode declared behavior. A wrong declared.attack_ms in foundation.mjs will silently green-light a wrong op. Specs should reference the primary source they came from (Giannoulis, Zölzer, IEC 60268-3, etc.).'));
children.push(Bullet('Bypass crossfade assumes graph_.process is real-time-safe under bypass. Heavy ops (FFT-based, large FDN) may need a separate "bypass-cheap" path if CPU becomes an issue.'));
children.push(Bullet('Per-sample smoothing time-constant is currently hard-coded per op. Consider unifying on a shared smoothing primitive driven by a graph-wide block-size-aware tau.'));

children.push(H1('9. References'));
children.push(Bullet('Giannoulis, Massberg, Reiss. Digital Dynamic Range Compressor Design — A Tutorial and Analysis. JAES 60(6), 2012.'));
children.push(Bullet('Zölzer (ed.), DAFX: Digital Audio Effects, 2nd ed. § 4.2.2 (soft-knee static gain computer).'));
children.push(Bullet('IEC 60268-3 — step-response measurement convention (T90).'));
children.push(Bullet('RBJ Audio EQ Cookbook — biquad coefficients (op_filter).'));
children.push(Bullet('ship_blockers.md § 8 — native-parity ship gate.'));
children.push(Bullet('sandbox_op_ship_protocol.md — 7-step op ship checklist.'));

const doc = new Document({
  creator: 'Claude',
  title: 'gainCOMPUTER QC Rack Audit',
  styles: {
    default: { document: { run: { font: ARIAL, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: ARIAL, color: '1F3864' },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: ARIAL, color: '2E75B6' },
        paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: ARIAL, color: '404040' },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ],
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
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'gainCOMPUTER — QC Rack Audit', font: ARIAL, size: 18, color: '808080' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', font: ARIAL, size: 18, color: '808080' }),
          new TextRun({ children: [PageNumber.CURRENT], font: ARIAL, size: 18, color: '808080' }),
          new TextRun({ text: ' of ', font: ARIAL, size: 18, color: '808080' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: ARIAL, size: 18, color: '808080' }),
        ],
      })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx';
  fs.writeFileSync(out, buf);
  console.log('WROTE', out, buf.length, 'bytes');
});
