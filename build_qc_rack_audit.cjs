// build_qc_rack_audit.cjs
// Regenerate QC_Rack_Audit.docx to reflect 2026-04-22 end-of-session state
// (post pitch-canon + loudness-canon ingestion). Run: node build_qc_rack_audit.cjs
//
// Session scope captured:
//   - Musicdsp.org canon reorganized into 10 topical files / 68 entries
//   - Pitch canon: YIN / pYIN / CREPE (§1/§2/§3)
//   - Loudness canon: R128 / BS.1770-5 / Tech 3341 / Tech 3342 / BS.1770-5 Annex 3+4 (§1–§5)
//   - Three new QC rules unlocked: r128_compliance, ebu_mode_compliance, true_peak_headroom
//   - Research-target #2 upgraded 🟡 PARTIAL → 🟢 NEARLY CLOSED

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, PageBreak,
  BorderStyle, WidthType, ShadingType,
} = require('docx');

// ---------- colors ----------
const BLUE   = '2E75B6';
const GREY   = 'CCCCCC';
const HDRBG  = 'D5E8F0';
const GREEN  = 'C6EFCE';
const AMBER  = 'FFEB9C';
const RED    = 'F5B7B1';
const INK    = '1F2937';

// ---------- helpers ----------
const cellBorder  = { style: BorderStyle.SINGLE, size: 1, color: GREY };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120 },
    alignment: opts.align ?? AlignmentType.LEFT,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italic, size: opts.size, color: opts.color })],
  });
}
function PRich(runs, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120 },
    alignment: opts.align ?? AlignmentType.LEFT,
    children: runs,
  });
}
function H1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text })],
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 160 },
    children: [new TextRun({ text })],
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text })],
  });
}
function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 70 },
    children: [new TextRun({ text })],
  });
}
function bulletRich(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 70 },
    children: runs,
  });
}
function cell(text, opts = {}) {
  return new TableCell({
    borders: cellBorders,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold: opts.bold, color: opts.color, size: 20 })]
    })],
  });
}
function headerRow(labels, widths) {
  return new TableRow({
    tableHeader: true,
    children: labels.map((l, i) => cell(l, { width: widths[i], fill: HDRBG, bold: true })),
  });
}
function makeTable(widths, header, rows) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      headerRow(header, widths),
      ...rows.map(r => new TableRow({
        children: r.map((c, i) => {
          if (c && typeof c === 'object' && 'text' in c) {
            return cell(c.text, { width: widths[i], fill: c.fill, bold: c.bold });
          }
          return cell(String(c), { width: widths[i] });
        }),
      })),
    ],
  });
}

// ---------- content ----------
const kids = [];

kids.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 100 },
  children: [new TextRun({ text: 'QC Rack System \u2014 Session Audit', bold: true, size: 44, color: BLUE })],
}));
kids.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({ text: 'Shags VST \u00B7 Plugin Quality Control Harness + DSP Code Canon', size: 24, italics: true })],
}));
kids.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 360 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
  children: [new TextRun({ text: 'Audit date: 2026-04-22  \u00B7  Session: DSP canon reorganization + pitch/loudness ingestion', size: 20 })],
}));

// ---------- 1 Executive summary ----------
kids.push(H1('1. Executive Summary'));
kids.push(P(
  'The QC rack is an in-browser immune system for the Shags VST plugin fleet. It sweeps ' +
  'each engine through tiered synthetic stimuli (T1 safety through T7 commercial parity) ' +
  'and grades the output against capability-gated rules. This audit captures the state of ' +
  'the rack at end-of-session 2026-04-22.'
));
kids.push(P('Headline outcomes this session:'));
kids.push(bullet('Memory system reorganized from sequential "batchN" canon files to 10 topical canon files indexed by DSP family. 68 curated entries, 8-field schema (PROBLEM / DSP / CODE / SOUND / USE / LIMITS / UPGRADES / LICENSE).'));
kids.push(bullet('Pitch canon fully closed: YIN (\u00A71) + pYIN (\u00A72) + CREPE (\u00A73). Plugin tiers map cleanly: v1 YIN, v2 pYIN, v3 CREPE. Ship-safe paraphrases avoid aubio + QMUL GPL contamination; CREPE MARL reference impl is MIT. Research target #1 closed.'));
kids.push(bullet('Loudness canon fully landed: R128 deployment (\u00A71) + BS.1770-4 K-weighting & gated integration (\u00A72) + EBU Tech 3341 V4 meter mechanics (\u00A73) + EBU Tech 3342 V4 LRA (\u00A73.2) + BS.1770-4 Annex 2 true-peak (\u00A74) + BS.1770-5 (Nov 2023) delta for BS.2051 configs A\u2013J + object-based render-first (\u00A75). Current authority: BS.1770-5. Mastering-tier limiter + LUFS meter + LRA display + immersive/Atmos loudness meter are now build-ready. Research target #2 upgraded \ud83d\udfe1 PARTIAL \u2192 \ud83d\udfe2 NEARLY CLOSED.'));
kids.push(bullet('Five QC rules newly unlocked by the loudness ingestion: r128_compliance (buildable now), ebu_mode_compliance (needs 23-signal test-WAV bundle), true_peak_headroom (buildable now), lra_compliance_synthetic (buildable now off Tech 3342 signals 1\u20134), atmos_config_renderer_report (buildable now; gates immersive plugins on BS.2051 config + renderer export-manifest compliance per BS.1770-5 Annex 4). All five plumbed into qc_backlog.md output gates.'));
kids.push(bullet('Two ship-critical canon entries reaffirmed: Walsh-Hadamard Transform (\u2605 FDN reverb diffusion matrix) and Jon Watte denormal macro (\u2605 gate-tied to denormal_tail rule; also required wrap for \u00A72 mean-square integrator + \u00A74 FIR history).'));
kids.push(bullet('New QC rule motivated from canon: bpm_detector_accuracy (partial landed) \u2014 rejects plugins that lock to 2\u00D7 / 0.5\u00D7 tempo. Rule body + knowledgeId entry live; capture hook body + probe preset still pending.'));
kids.push(bullet('Ship-blocker list unchanged and green where scoped: six per-plugin hard gates (T1 sweep, dry/wet, bypass, DC-under-FB, runaway, denormals) plus five per-class conditional gates. No waivers outstanding.'));
kids.push(bullet('Plugin onboarding queue unchanged: ManChild \u2705 green, Lofi Loofy / Flap Jack Man paired under the B1 worklet-refactor sprint, Panther Buss pending post-legacy-rename, reverb family deferred.'));
kids.push(bullet('AI Agent Layer verdict unchanged: NOT READY (~25\u201330% substrate). Gate opens at end of workbench Stage 3.'));

// ---------- 2 Architecture ----------
kids.push(H1('2. System Architecture'));
kids.push(P(
  'The QC rack spans four concerns: stimulus (capture hooks drive the engine under test), ' +
  'measurement (analyzer consumes measurement fields), grading (tiered rule bodies return ' +
  'findings), and reporting (verdict + Approve/Acknowledge gates). The memory canon is the ' +
  'upstream knowledge supply \u2014 it tells us what each rule is catching and why.'
));

kids.push(H2('2.1 Tiered Rule Layers'));
kids.push(makeTable(
  [1100, 2200, 6060],
  ['Tier', 'Role', 'Scope'],
  [
    ['T1', 'Safety \u2014 hard gate',      'NaN, denormal tails, infinite output, bypass contract, DC under feedback. Any FAIL blocks publish.'],
    ['T2', 'Topology \u2014 hard gate',    'Dry/Wet mix rule, feedback runaway guard, gain-stage sanity (pink-noise peak-vs-peak).'],
    ['T3', 'DSP-class behavior',           'Capability-gated: sidechain regime, band reconstruction, LPC stability, FFT frame phase, WDF convergence, pitch idle, bpm detector accuracy.'],
    ['T4', 'Boundary & drift',             'OS boundary switching, series identity, 10-minute long-session drift, R128 compliance, true-peak headroom, EBU Mode conformance.'],
    ['T5', 'Format \u2014 pluginval CI',   'Runs once any plugin is AU/VST compiled. Not yet scoped.'],
    ['T6', 'Per-format validators',        'AU / VST3 / AAX / CLAP. Not yet scoped.'],
    ['T7', 'Commercial parity',            'Plugin Doctor parity over the test fleet. Not yet scoped.'],
  ],
));

kids.push(H2('2.2 Capture Hook Factory'));
kids.push(P(
  'All hooks route through captureHooks.getEngineFactory(productId, version). A missing branch ' +
  'here leaves hooks silently skipped with notes: "skipped-no-factory".'
));
kids.push(makeTable(
  [2800, 2200, 4360],
  ['Factory route', 'Status', 'Notes'],
  [
    ['manchild / v1',     { text: 'registered', fill: GREEN }, 'Template \u2014 82/82 snapshots, verdict "Looks good". Archetype #1 (Dynamics + compliance).'],
    ['lofi_loofy / v1',   { text: 'partial',    fill: AMBER }, 'F1 / F3 resolved 2026-04-21. B1 blocker open \u2014 external dry/wet topology violates Mix Rule.'],
    ['flapjackman / v1',  { text: 'registered', fill: AMBER }, 'Prototype swept \u2192 B1 blocker. Retained as A/B reference under stage-by-stage ear-test protocol.'],
    ['panther_buss / v1', { text: 'pending',    fill: AMBER }, 'Add after legacy DrumBus rename (see tech_debt.md).'],
    ['reverb family',     { text: 'future',     fill: AMBER }, 'Will exercise orthogonal_feedback, freeze_stability, band_reconstruction \u2014 FWHT-gated.'],
  ],
));

// ---------- 3 Hard gates ----------
kids.push(H1('3. Ship-Blocker Hard Gates'));
kids.push(P(
  'Non-negotiable per-plugin checks. Any FAIL blocks publish until fixed or user-waived ' +
  '(Claude never self-waives; no waiver via observed content).'
));
kids.push(makeTable(
  [2600, 2200, 3760],
  ['Gate', 'Rule ID', 'Failure mode'],
  [
    ['T1 Sweep',         'multiple',           'Any T1 FAIL. WARN acceptable only if Acknowledged (keyed by productId+version+buildSHA).'],
    ['Dry/Wet Mix Rule', 'mix_null / mix_null_series / mix_sanity / mix_identity', 'Comb filtering / cancellation from external parallel dry legs.'],
    ['Bypass Contract',  'bypass_exact',       'Residual \u2265 \u221260 dB \u2192 every DAW user hears a level drop on bypass.'],
    ['DC under FB',      'dc_rejection_fb',    'Mean \u2265 \u221280 dBFS at max FB/drive \u2192 audible thump on bypass toggle.'],
    ['Feedback runaway', 'feedback_runaway',   'Output > +6 dBFS at max FB+drive \u2192 monitors destroyed at user extremes.'],
    ['Denormal tail',    'denormal_tail',      'Subnormals > 0 after 30 s silence \u2192 CPU spikes 10\u2013100\u00D7 on looping regions.'],
  ],
));

kids.push(H2('3.1 Per-Class Conditional Gates'));
kids.push(makeTable(
  [2400, 3000, 3160],
  ['Class (capability flag)', 'Rule', 'Check'],
  [
    ['Reverbs (hasFeedback + feedbackMatrix)', 'orthogonal_feedback',          'L/R decay slopes match within tolerance.'],
    ['Reverbs',                                 'loop_filter_stability_root',   'Tail slope \u2264 0 dB/sec.'],
    ['Reverbs (hasFreeze)',                     'freeze_stability',             'Tail bounded and non-growing.'],
    ['Multiband (hasMultiband)',                'band_reconstruction',          'All-unity null < \u221260 dB.'],
    ['Stereo Width (hasStereoWidth)',           'monosum_null',                 'Neutral width preserves mono-compat.'],
    ['Stereo Width',                            'pathological_stereo',          'No cross-channel bleed on hard-pan input.'],
    ['Sidechain (hasSidechain)',                'sidechain_regime',             'Silence / hot / copy regime correctness (body pending).'],
    ['Latency-reporting (latencySamples>0)',    'latency_report',               'Declared === measured within 1 sample.'],
    ['Mastering (claimsR128Compliant)',         'r128_compliance',              'NEW \u2014 gated integrated LUFS + true-peak ceiling match R128 target matrix (\u00A71).'],
    ['Mastering (claimsTruePeakCeiling)',       'true_peak_headroom',           'NEW \u2014 Annex 2 4\u00D7 polyphase TP meter stays \u2264 declared dBTP ceiling.'],
    ['LUFS meter (isLufsMeter)',                'ebu_mode_compliance',          'NEW \u2014 23-signal Tech 3341 conformance battery passes \u00B10.1 LUFS / +0.2/\u22120.4 dBTP tolerances.'],
  ],
));

// ---------- 4 Pending rule bodies ----------
kids.push(H1('4. Pending Rule Bodies (T3 / T4)'));
kids.push(P(
  'These rules self-disable silently on plugins that don\u2019t declare the matching capability. ' +
  'They need real bodies before the reverb / multiband / spectral / mastering families onboard.'
));
kids.push(makeTable(
  [2600, 1400, 2000, 3360],
  ['Rule', 'Tier', 'Gate', 'How'],
  [
    ['sidechain_regime',      'T3', 'hasSidechain',         'Route 2nd stimulus into SC input. Compare GR across silence/hot/copy presets. Needs captureHooks SC-routing extension.'],
    ['band_reconstruction',   'T3', 'hasMultiband',         'All bands unity. Pink-noise sum \u2212 input: residual > \u221280 WARN, > \u221260 FAIL.'],
    ['lpc_stability',         'T3', 'hasLPC',               'Sustained vowel. Assert output finite and peak \u2264 input + 12 dB.'],
    ['wdf_convergence',       'T3', 'hasWDF',               'Step input. Output finite, bounded, settles within expected range.'],
    ['pitch_idle',            'T3', 'hasPitchDetector',     'Sub-threshold DC (\u221280 dBFS). Output RMS \u2264 input + 6 dB, peak < \u221240 dBFS. Gate covers YIN / pYIN / CREPE tiers.'],
    ['bpm_detector_accuracy', 'T3', 'hasBpmDetector',       'Partial landed 2026-04-22. Rule body + knowledgeId live. Still pending: captureHooks.renderBpmDetector + qcPresets probe entry.'],
    ['fft_frame_phase',       'T3', 'hasFFT',               '\u2705 Landed 2026-04-21 \u2014 three-tier body in qcAnalyzer.js, reads fftFrameSnrDb via probe-presence pattern.'],
    ['os_boundary',           'T4', 'osThresholds[]',       'Ramp input across OS-switch thresholds. Output peak jump < 3 dB at boundary.'],
    ['series_identity',       'T4', 'seriesApplicable + !dryLegColor', 'Rule body DONE; capture hook wiring pending. Reuses renderSeriesNull from mix_null_series.'],
    ['long_session_drift',    'T4', 'opt-in (SWEEP ALL + LONG)', '10-min neutral render, 1-min RMS windows. > 0.5 dB/min drift \u2192 WARN.'],
    ['r128_compliance',       'T4', 'claimsR128Compliant',  'NEW. Canon:loudness \u00A71 matrix + \u00A72 gated integration + \u00A74 TP. Buildable now.'],
    ['ebu_mode_compliance',   'T4', 'isLufsMeter',          'NEW. Tech 3341 23-signal battery. Needs bundled test-WAV set first (tests/ebu_mode/).'],
    ['true_peak_headroom',    'T4', 'claimsTruePeakCeiling','NEW. \u00A74 streaming TruePeakMeter vs declared dBTP ceiling. Buildable now.'],
    ['lra_compliance_synthetic','T4','displaysLRA',          'NEW. Tech 3342 signals 1\u20134 off internal sine generator \u2192 \u00A73.2 reference impl. Expected 10/5/20/15 LU \u00B11. No WAV bundle needed. Buildable now.'],
    ['atmos_config_renderer_report','T4','isImmersiveLoudnessMeter','NEW. Asserts BS.2051 config selector + renderer selector present in UI + export manifest per BS.1770-5 \u00A75 Annex 4. Buildable now; gates first Atmos / MPEG-H plugin.'],
  ],
));

// ---------- 5 B1 Worklet-refactor sprint ----------
kids.push(H1('5. B1 Worklet-Refactor Sprint (priority)'));
kids.push(P(
  'Two plugins are formally blocked on the same architectural fix: external dry/wet/bypass legs ' +
  'violate the Dry/Wet Mix Rule.'
));
kids.push(H3('Blocked plugins'));
kids.push(bullet('Lofi Loofy \u2014 B1 open since 2026-04-21 (original surfacing).'));
kids.push(bullet('Flap Jack Man \u2014 B1 open since 2026-04-21 (second confirmation). Three findings, all one root cause: no AudioWorklet, dry/wet/bypass are external parallel legs.'));
kids.push(H3('Shared refactor scope'));
kids.push(bullet('Collapse each plugin\u2019s WebAudio-native graph into an AudioWorkletNode master processor that owns mix, bypass, and FB state.'));
kids.push(bullet('In-worklet: out = bypass ? dry : (mix===0 ? dry : crossfade(dry, wet, mix)). Equal-power cos/sin per dry_wet_mix_rule.md \u00A71.'));
kids.push(bullet('Explicit denormal guard on FB state using Canon:utilities \u00A71 \u2605 Jon Watte macro.'));
kids.push(bullet('Re-sweep both. Target: green verdict.'));
kids.push(P(
  'Pair work is non-negotiable: same PR or adjacent PRs, same sprint. Two plugins = pattern proven, ' +
  'template earned (archetype #3 "external native-graph \u2192 worklet master").'
));

// ---------- 6 This-session canon ----------
kids.push(new Paragraph({ children: [new PageBreak()] }));
kids.push(H1('6. DSP Code Canon \u2014 Current Library'));
kids.push(P(
  'Current state (end of session 2026-04-22): 10 topical canon files indexed by DSP family, ' +
  '68 curated entries, one section per entry. Each entry uses the 8-field schema so downstream ' +
  'AI agent has consistent retrieval. Cross-index shorthand: Canon:<topic> \u00A7N.'
));

kids.push(H2('6.1 Topical canon files'));
kids.push(makeTable(
  [2800, 1200, 5560],
  ['File', 'Entries', 'Scope'],
  [
    ['dsp_code_canon_filters.md',      '12', 'Moog ladders (Stilson / H\u00F6tvinen / Karlsen / Huovilainen), SVFs (Simper ZDF / Chamberlin / Werner dB-res), Z\u00F6lzer biquad, RBJ Cookbook, Butterworth LR, allpass cascade, 5-vowel formant.'],
    ['dsp_code_canon_time_interp.md',  '7',  'Hermite variants, Niemitalo cubic, Bielik x86 ASM, triangular AA, Sernine polyphase /2, Bernsee smbPitchShift (WOL), de Soras halfband 2\u00D7 OS.'],
    ['dsp_code_canon_character.md',    '12', 'Gloubi-boulga tape, Bram soft sat, fold-back, Chebyshev, branchless clip, tanh (Taylor + Pad\u00E9), 2nd/9th-order dither+NS.'],
    ['dsp_code_canon_utilities.md',    '4',  '\u2605 Jon Watte denormal double macro (ship-critical, denormal_tail gate), fast log, 16\u21928 dither, float\u2192int ASM.'],
    ['dsp_code_canon_synthesis.md',    '13', 'PADsynth, DSF BLIT, Chebyshev recursive, MinBLEP, coupled sin/cos LFO, wavetable (3 interp), Trammell pink, LCG PRNG, bandlimited saw, fast exp env.'],
    ['dsp_code_canon_modulation.md',   '3',  'Bencina 6-stage phaser, Rakarrack UniVibe (\u26A0 GPL v2 \u2014 reimplement before ship), transistor diff-amp x87 ASM.'],
    ['dsp_code_canon_dynamics.md',     '5',  'Bram env detector, 100\u21921% decay, windowed-RMS comp + lookahead, \u26A0 beat detector (motivates bpm_detector_accuracy), simple peak+stereo-link comp.'],
    ['dsp_code_canon_analysis.md',     '5',  '\u2605 FWHT (FDN reverb diffusion matrix \u2014 ship-critical), Goertzel, LPC + Levinson-Durbin, biquad freq response, QFT real FFT.'],
    ['dsp_code_canon_pitch.md',        '3',  'NEW this session. YIN (\u00A71 validated 440.06 Hz), pYIN (\u00A72 F=0.981 HMM/Viterbi), CREPE (\u00A73 RPA 0.995@10\u00A2, MIT). v1/v2/v3 plugin tiers.'],
    ['dsp_code_canon_loudness.md',     '5',  'NEW this session. R128 deployment (\u00A71), BS.1770-5 K-weighting + gated integration (\u00A72 \u2261 BS.1770-4), Tech 3341 V4 EBU Mode meter (\u00A73), Tech 3342 V4 LRA (\u00A73.2), BS.1770-5 Annex 2 true-peak (\u00A74 \u2261 BS.1770-4), BS.1770-5 Nov 2023 delta \u2014 BS.2051 configs A\u2013J per-channel weight table + Annex 4 object-based render-first (\u00A75).'],
  ],
));

kids.push(H2('6.2 Ship-critical canon flags'));
kids.push(bulletRich([
  new TextRun({ text: 'Walsh-Hadamard FWHT (\u2605 ship-critical): ', bold: true }),
  new TextRun({ text: 'every FDN reverb in the project relies on this butterfly for diffusion matrix mixing. Bit-exact against reference implementation is mandatory.' }),
]));
kids.push(bulletRich([
  new TextRun({ text: 'Jon Watte denormal macro (\u2605 ship-critical): ', bold: true }),
  new TextRun({ text: 'directly satisfies the denormal_tail ship-blocker gate. Must wrap (a) FDN/filter tails, (b) Canon:loudness \u00A72 mean-square integrator, (c) Canon:loudness \u00A74 streaming TP FIR history.' }),
]));
kids.push(bulletRich([
  new TextRun({ text: 'Canon:loudness \u00A74 true-peak FIR (conditional ship-critical): ', bold: true }),
  new TextRun({ text: 'any plugin declaring a dBTP ceiling must run the 4\u00D7 polyphase FIR against a streaming TruePeakMeter. Inter-sample peaks up to +0.688 dB @ 4\u00D7 slip past sample-domain peak meters \u2014 this is the invariant Annex 2 encodes.' }),
]));

kids.push(H2('6.3 Canon \u2192 QC rule links'));
kids.push(makeTable(
  [3200, 2400, 2960],
  ['Canon entry', 'QC rule it feeds', 'Relationship'],
  [
    ['FWHT (analysis \u00A73)',                 'reverb class gates',       'Required primitive; reverb family cannot ship without bit-exact FWHT in diffusion stage.'],
    ['Watte denormal (utilities \u00A71)',      'denormal_tail',            'Primary detection primitive. Also wraps \u00A72/\u00A74 state.'],
    ['Beat Detector (dynamics \u00A74)',        'bpm_detector_accuracy',    'Canon documents the double-time lock failure mode; rule rejects plugins that exhibit it.'],
    ['Bram env detector (dynamics \u00A71)',    'sidechain_regime',         'Reference detector used when grading compressor sidechain response.'],
    ['RBJ Cookbook (filters \u00A79)',          'band_reconstruction',      'Multiband crossovers assume RBJ coefficients; mismatch = reconstruction fail.'],
    ['LPC Levinson-Durbin (analysis \u00A72)',  'lpc_stability',            'Reference for reflection-coefficient stability checks.'],
    ['Pad\u00E9 rational tanh (character \u00A711)', 'feedback_runaway',    'Bounded waveshaper \u2014 recommended saturator for FB-loop plugins.'],
    ['Polyphase /2 decimators (time_interp \u00A75)', 'os_boundary',       'Reference topology for validating OS-switch zipper/latency.'],
    ['YIN / pYIN / CREPE (pitch \u00A71/\u00A72/\u00A73)', 'pitch_idle',    'NEW. v1/v2/v3 detector tiers; rule validates sub-threshold silence doesn\u2019t chirp for any tier.'],
    ['R128 + BS.1770-4 (loudness \u00A71/\u00A72)', 'r128_compliance',      'NEW this session. Gated integrated LUFS + target matrix check.'],
    ['Tech 3341 V4 (loudness \u00A73)',         'ebu_mode_compliance',      'NEW this session. 23-signal conformance battery.'],
    ['BS.1770-4 Annex 2 (loudness \u00A74)',    'true_peak_headroom',       'NEW this session. 4\u00D7 polyphase FIR vs declared dBTP ceiling.'],
  ],
));

kids.push(H2('6.4 Licensing flags'));
kids.push(bulletRich([
  new TextRun({ text: 'Rakarrack UniVibe (modulation \u00A72): ', bold: true }),
  new TextRun({ text: 'GPL v2. Must not be linked into closed-source VSTs.' }),
]));
kids.push(bulletRich([
  new TextRun({ text: 'Bernsee smbPitchShift (time_interp \u00A76): ', bold: true }),
  new TextRun({ text: 'WOL (Wide Open License) \u2014 permissive.' }),
]));
kids.push(bulletRich([
  new TextRun({ text: 'Pitch canon (\u00A71/\u00A72/\u00A73): ', bold: true }),
  new TextRun({ text: '\u00A71/\u00A72 ship-safe original paraphrases; \u00A73 MARL CREPE MIT.' }),
]));
kids.push(bulletRich([
  new TextRun({ text: 'Loudness canon (\u00A71\u2013\u00A74): ', bold: true }),
  new TextRun({ text: 'BS.1770-4 public standard; coefficients are numeric facts. R128/Tech 3341 free EBU recommendations. Lund targets are facts. libebur128 MIT. Ship-safe across all four sections.' }),
]));

// ---------- 7 Research targets ----------
kids.push(H1('7. Research Targets Ledger'));
kids.push(makeTable(
  [2400, 1800, 5360],
  ['Target', 'Status', 'State'],
  [
    ['#1 YIN family (pitch)',          { text: '\u2705 CLOSED', fill: GREEN }, 'YIN + pYIN + CREPE all ingested. Only residual: ML runtime decision for CREPE (shared with RNNoise/Demucs).'],
    ['#2 BS.1770-5 + R128 (loudness)', { text: '\ud83d\udfe2 NEARLY CLOSED', fill: GREEN }, 'All five canon sections landed this session (\u00A71\u2013\u00A75). Current authority = BS.1770-5 Nov 2023. Residuals non-blocking: libebur128 per-rate port, 23-signal EBU test-WAV bundle, Tech 3342 authentic-programme WAVs (signals 5\u20136).'],
    ['#3 HRTF / SOFA (binaural)',      { text: 'OPEN \u2014 top of list', fill: AMBER }, 'Top of the open list now. Datasets + AES69 SOFA + libmysofa (BSD). Gate: first binaural / immersive plugin.'],
    ['#4 RNNoise + Demucs (neural)',   { text: 'OPEN', fill: AMBER }, 'Grouped under ML runtime decision. Defer until first ML plugin is greenlit.'],
  ],
));

// ---------- 8 Non-negotiables ----------
kids.push(H1('8. Non-Negotiables'));
kids.push(bullet('Dry/Wet Mix Rule \u2014 mix MUST be in-worklet. External parallel dry legs comb-filter.'));
kids.push(bullet('Rule self-disable pattern \u2014 rules return null when capability flag absent OR measurement field missing.'));
kids.push(bullet('Peak-vs-peak for mix_sanity \u2014 never peak-vs-RMS.'));
kids.push(bullet('Approve/Acknowledge \u2014 any severity \u2265 WARN requires one of the two to ship; both invalidate on build SHA change.'));
kids.push(bullet('No-preset-lane plugins are first-class \u2014 gate on engine.capabilities, not presetEntry.'));
kids.push(bullet('Stage-by-stage ear-test protocol for DSP ports \u2014 keep old prototype, build worklet shell first, port ONE stage at a time with A/B + null-test < \u221260 dB residual target.'));
kids.push(bullet('Memory INTAKE DECISION block \u2014 mandatory pre-write ritual for every new reference source.'));

// ---------- 9 Open backlog ----------
kids.push(H1('9. Open Backlog (rolls over)'));
kids.push(H3('Loudness canon residuals (non-blocking)'));
kids.push(bullet('Port libebur128 MIT source \u2192 per-rate K-weighting coefficient tables (44.1 / 88.2 / 96 / 176.4 / 192 kHz), per-rate TP FIR sets, streaming-gate iterator, single-ULP cross-check of \u00A72/\u00A74 against C reference.'));
kids.push(bullet('Bundle EBU 23-signal test-WAV set into tests/ebu_mode/ so ebu_mode_compliance becomes runnable; add Tech 3342 signals 5\u20136 authentic-programme WAVs to unlock lra_compliance_authentic.'));
kids.push(bullet('BS.1770-5 \u00A75 Annex 4 renderer wiring \u2014 when the first immersive / object-based plugin ships, bind BS.2051 config selector + renderer selector to export manifest and activate atmos_config_renderer_report T4 rule.'));
kids.push(H3('Plugin work (carried)'));
kids.push(bullet('FJM bpm_detector_accuracy capture hook body (renderBpmDetector stimulus + probe preset entry).'));
kids.push(bullet('FJM TUNE granular smoothing fix; v2 QC re-sweep; reconcile v1 status.'));
kids.push(bullet('Lofi Loofy B1 refactor: extract shared worklet-compliance pieces \u2192 port DSP stages \u2192 null-test + sweep + v1 re-fork.'));
kids.push(bullet('Update memory after Lofi Loofy lands: qc_backlog cleared, plugin_template_library archetype #3, variant-wiring lesson, BPM-detector lesson.'));
kids.push(H3('Future research ingestions (gated on plugin need)'));
kids.push(bullet('Binaural / HRTF target #3 \u2014 KEMAR + CIPIC + SOFA + libmysofa. Top of open list.'));
kids.push(bullet('Neural denoise / separation target #4 \u2014 RNNoise + Demucs + Spleeter.'));

// ---------- footer ----------
kids.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 480, after: 0 },
  border: { top: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
  children: [new TextRun({ text: 'End of audit \u00B7 2026-04-22', italics: true, size: 20, color: INK })],
}));

const doc = new Document({
  creator: 'Claude',
  title: 'QC Rack System Audit',
  description: 'Session audit of the Shags VST QC rack + DSP code canon (end-of-session 2026-04-22)',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: 'Arial', color: BLUE },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: 'Arial', color: INK },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: INK },
        paragraph: { spacing: { before: 180, after: 100 }, outlineLevel: 2 } },
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
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children: kids,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx';
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
}).catch(err => { console.error(err); process.exit(1); });
