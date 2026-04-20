// build_qc_audit.cjs — generate QC_Rack_Audit.docx
// Session audit: QC rack system built 2026-04-19/20.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, LevelFormat,
  AlignmentType, Table, TableRow, TableCell, BorderStyle,
  WidthType, ShadingType, PageOrientation,
} = require('docx');

const FONT = 'Arial';
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  ...opts,
  children: [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
});
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 }, children: [new TextRun({ text: t, bold: true, font: FONT, size: 32 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, font: FONT, size: 28 })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: t, bold: true, font: FONT, size: 24 })] });
const Bul = (t) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: t, font: FONT, size: 22 })] });
const Code = (t) => new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, font: 'Consolas', size: 20 })] });

const cell = (text, opts = {}) => new TableCell({
  borders,
  width: { size: opts.w || 3120, type: WidthType.DXA },
  shading: opts.header ? { fill: 'E8EEF5', type: ShadingType.CLEAR } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text, font: FONT, size: 20, bold: !!opts.header })] })],
});
const mkTable = (rows, widths) => new Table({
  width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  columnWidths: widths,
  rows: rows.map((r, i) => new TableRow({
    children: r.map((c, j) => cell(c, { w: widths[j], header: i === 0 })),
  })),
});

const children = [];

// TITLE
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 120 },
  children: [new TextRun({ text: 'QC Rack Audit', bold: true, font: FONT, size: 48 })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 360 },
  children: [new TextRun({ text: 'Session of 2026-04-19 / 2026-04-20', font: FONT, size: 22, italics: true })],
}));

// 1. Executive summary
children.push(H1('1. Executive Summary'));
children.push(P('This session closed out the manchild engine_v1 variant drift bug and built the scaffolding for a repeatable per-plugin QC harness. A new variant_drift rule, a diagnostic _targets breadcrumb on the engine, and a durable family/tier reference map were added. All work committed (ef1cd8c) and pushed to origin/master.'));
children.push(Bul('manchild · engine_v1 → GREEN verdict, 0 findings, 41/41 presets applied.'));
children.push(Bul('variant_drift QC rule added: declared-preset vs live engine-state diff with lastTarget breadcrumb.'));
children.push(Bul('qc_family_map.md written: 73-family catalog, four-tier preset taxonomy, capability schema.'));
children.push(Bul('Scope locked: audio effects only. MIDI / VSTi / audio-to-MIDI / multichannel spatial deferred.'));
children.push(Bul('Git: commit ef1cd8c (29 files, 8099 insertions) pushed to origin/master.'));

// 2. Bug that kicked this off
children.push(H1('2. The Bug'));
children.push(P('QC report 02-41-39 showed 2 M-S mode presets where thB drifted to ~0.265 regardless of preset value. Signature matched the silent variant drift anti-pattern: Orb loading a different engine module than the registry label claimed.'));
children.push(H3('Affected presets (pre-fix)'));
children.push(Bul('M/S – Vocal Focus · thB=0.778 → engine.thB=0.260'));
children.push(Bul('M/S – Side Control · thB=0.389 → engine.thB=0.265'));

// 3. Fixes landed
children.push(H1('3. Fixes Landed'));

children.push(H2('3.1 Diagnostic breadcrumb — manChildEngine.v1.js'));
children.push(P('Added _targets object to capture the last-commanded threshold value, so variant_drift can distinguish "setter called with wrong value" from "DSP ramp did not settle".'));
children.push(Code("const _targets = { thA: null, thB: null };"));
children.push(Code("setThresholdA: (v) => { _targets.thA = v; P('thA').setTargetAtTime(v, audioCtx.currentTime, 0.01); },"));
children.push(Code("setThresholdB: (v) => { _targets.thB = v; P('thB').setTargetAtTime(v, audioCtx.currentTime, 0.01); },"));
children.push(Code('// getState() also returns: _thATarget, _thBTarget'));

children.push(H2('3.2 variant_drift rule — qcAnalyzer.js'));
children.push(P('Surfaces the lastTarget alongside the declared-vs-live diff in drift findings.'));
children.push(Code("const tKey = `_${pKey}Target`;"));
children.push(Code("const tVal = (tKey in live) ? live[tKey] : undefined;"));
children.push(Code("const tail = tVal === undefined ? '' : ` [lastTarget=${JSON.stringify(tVal)}]`;"));

children.push(H2('3.3 Result'));
children.push(P('QC report 02-50-35 — Verdict: Looks good. 41/41 presets applied, 0 findings. Build SHA 627263f-dirty. The _targets breadcrumb remains as permanent diagnostic infrastructure.'));

// 4. QC Rack Architecture
children.push(H1('4. QC Rack Architecture'));

children.push(H2('4.1 Pipeline'));
children.push(Bul('1. Sweep: iterate over presets, apply each via engine.applyBulk, render pink-noise buffer.'));
children.push(Bul('2. Snapshot: capture engine.getState() + LUFS / peak / GR / spectral metrics per preset.'));
children.push(Bul('3. Analyze: run rule set (variant_drift + baseline checks) over snapshot array.'));
children.push(Bul('4. Report: Markdown verdict (Looks good / Not ready) + numbers table + findings with dev-notes.'));

children.push(H2('4.2 Four-tier preset taxonomy'));
children.push(mkTable([
  ['Tier', 'Purpose', 'Applicability'],
  ['T1', 'Universal defaults — bypass, unity, extreme min/max', 'Every plugin'],
  ['T2', 'High-value coverage — full parameter sweep at mid + extremes', 'Every plugin'],
  ['T3', 'Schema-conditional — only when capability flag is set (sidechain, freeze, LFO, MB, etc.)', 'Conditional'],
  ['T4', 'Pressure tests — sustained abuse, PRNG reproducibility, long-session drift', 'Conditional / opt-in'],
], [900, 4260, 4200]));

children.push(H2('4.3 Capability schema (paramSchema extension)'));
children.push(Code('{ categories: string[], subcategories: string[], modes: string[] | null,'));
children.push(Code('  hasSidechain, hasFeedback, hasFreeze, hasLFO, hasStereoWidth,'));
children.push(Code('  hasMultiband, hasLookahead, hasTruePeak, hasPitchDetector,'));
children.push(Code('  hasLPC, hasFFT, hasWDF: boolean,'));
children.push(Code('  nonlinearStages: number, osThresholds: number[] | null,'));
children.push(Code('  latencySamples: number,'));
children.push(Code("  crossoverPhase: 'linear' | 'minimum' | null }"));

// 5. Family map
children.push(H1('5. Family / Tier Map (current internal chart)'));
children.push(P('qc_family_map.md locks a 73-family catalog grouped by the six systems (Time / Tone / Dynamics / Character / Movement / Space) plus Pitch-Spectral, Restoration, Creative-FX, Neural-AI, Analysis, Composite, Instrument-specific, Specialized, Utility. Each family carries a required tier set.'));
children.push(P('Note: the internal catalog is DSP-implementation-granular (73 families) because QC checks attach to DSP primitives (FFT, WDF, LPC, lookahead, etc.), not to marketing categories. A coarser 13-family industry-aligned roll-up is proposed in Section 8.'));

// 6. New QC checks queued
children.push(H1('6. QC Checks Catalog'));
children.push(mkTable([
  ['Rule ID', 'What it proves', 'Required for'],
  ['variant_drift', 'Declared preset == live engine state', 'All plugins (shipped)'],
  ['mix_null', 'Dry leg + wet leg == input at Mix=0', 'Any plugin with Mix'],
  ['monosum_null', 'Width=0 collapses cleanly to mono', 'Stereo-width plugins'],
  ['band_reconstruction', 'Sum of bands at unity == input', 'Multiband plugins'],
  ['latency_report', 'Reported latency matches measured impulse delay', 'Lookahead / linear-phase'],
  ['lpc_stability', '|k_i| < 1 for all reflection coeffs', 'Formant / vocoder / Kelly-Lochbaum'],
  ['wdf_convergence', 'Iteration converges within budget', 'Diode / fuzz / nonlinear WDF'],
  ['fft_frame_phase', 'Phase coherence across frame boundary', 'Phase vocoder'],
  ['neural_determinism', 'Same input + seed == same output', 'NAM / neural reverb'],
  ['prng_seeded', 'Seeded PRNG reproducible run-to-run', 'Creative FX / glitch'],
], [2000, 4560, 2800]));

// 7. Deferred
children.push(H1('7. Deferred to Future Sessions'));
children.push(Bul('MIDI effects (arpeggiators, note shapers, quantizers).'));
children.push(Bul('Virtual instruments (VSTi) — sampler, synth, drum machine harnesses.'));
children.push(Bul('Audio-to-MIDI transcription.'));
children.push(Bul('Multichannel spatial (Atmos, Ambisonics, binaural).'));
children.push(Bul('Workflow meta-plugins (routing, scene recall, macro hubs).'));
children.push(Bul('Layer C userFix database — populated organically as plugins pass QC.'));

// 8. 13-family industry roll-up question
children.push(H1('8. Internal-vs-Industry Chart — Do We Update?'));
children.push(P('The user proposed folding the 73-family internal catalog under a 13-family industry-aligned taxonomy:'));
children.push(Bul('Dynamics'));
children.push(Bul('Equalization (EQ / Filtering)'));
children.push(Bul('Saturation / Distortion / Harmonics'));
children.push(Bul('Time-Based Effects (Reverb / Delay)'));
children.push(Bul('Modulation'));
children.push(Bul('Pitch / Time Processing'));
children.push(Bul('Stereo / Spatial Processing'));
children.push(Bul('Analysis / Metering'));
children.push(Bul('Restoration / Repair'));
children.push(Bul('Creative / Glitch / Sound Design FX'));
children.push(Bul('Mastering / Finalization Suites'));
children.push(Bul('Channel Strip / Console Emulation'));
children.push(Bul('Utility / Gain / Routing'));

children.push(H2('Recommendation'));
children.push(P('YES — add it as a parallel top-level axis, do NOT replace the 73-family catalog. The two serve different masters:'));
children.push(Bul('13-family industry chart = user-facing browse / marketing / pill grouping / store taxonomy.'));
children.push(Bul('73-family DSP catalog = QC tier assignment, capability schema, rule dispatch. Each industry category maps to N DSP families.'));
children.push(P('Concrete schema change: add `categories: string[]` (industry) AND `subcategories: string[]` (DSP families). The `categories` field is what UI/browse uses; `subcategories` drives QC. Example for Lofi Loofy: categories=["Saturation / Distortion / Harmonics", "Creative / Glitch FX"], subcategories=["bitcrush", "sample-rate-reduce", "chorus", "wow-flutter", "noise", "vinyl-sim", ...].'));

children.push(H2('Mapping sketch (13 industry → DSP families it covers)'));
children.push(mkTable([
  ['Industry category', 'DSP families from internal 73'],
  ['Dynamics', 'Comp, limiter, gate, expander, de-esser, transient, upward comp, MB-comp, MB-limiter, M-S comp'],
  ['EQ / Filtering', 'Parametric EQ, graphic, shelving, dynamic EQ, linear-phase, tilt, filter, vowel filter, resonator'],
  ['Saturation / Distortion', 'Tape, tube, transformer, diode WDF, soft/hard clip, bitcrush, fuzz, waveshaper, folder'],
  ['Time-Based', 'Reverb (FDN, plate, spring, convolution, shimmer), delay (tape, BBD, digital, ping-pong, granular)'],
  ['Modulation', 'Chorus, flanger, phaser, tremolo, vibrato, rotary, ensemble, auto-pan'],
  ['Pitch / Time', 'Pitch shift, formant, auto-tune, harmonizer, time-stretch (PSOLA / PV), vari-speed'],
  ['Stereo / Spatial', 'Width, M-S, Haas, stereo image, binaural, crossfeed'],
  ['Analysis / Metering', 'Spectrum, goniometer, correlation, loudness (LUFS / K-sys), phase, transient'],
  ['Restoration', 'De-noise, de-click, de-hum, de-crackle, de-reverb, spectral repair'],
  ['Creative / Glitch FX', 'Granular, buffer repeat, stutter, reverse, glitch, freeze, bit-mangle, PRNG FX'],
  ['Mastering suites', 'Composite — comp + EQ + limiter + imager chains'],
  ['Channel strip', 'Composite — preamp + EQ + comp + gate per-channel'],
  ['Utility / Routing', 'Gain, pan, phase-invert, mono-maker, trim, channel-split, side-chain router'],
], [3200, 6160]));

children.push(H2('Action items'));
children.push(Bul('Update qc_family_map.md: add Section 3.5 "Industry roll-up axis (13)" with the mapping table above.'));
children.push(Bul('Extend capability schema: rename current field to subcategories; add categories[] of 13-industry strings.'));
children.push(Bul('Store/pill UI can switch to categories[] without touching QC dispatch logic.'));
children.push(Bul('No QC semantics change — only presentation taxonomy.'));

// 9. Artifacts
children.push(H1('9. Artifacts'));
children.push(Bul('src/manChild/manChildEngine.v1.js — _targets breadcrumb + getState() exposure.'));
children.push(Bul('src/qc-harness/qcAnalyzer.js — variant_drift lastTarget surfacing.'));
children.push(Bul('memory/qc_family_map.md — 73-family catalog + tier taxonomy + schema.'));
children.push(Bul('Downloads/qc_report_manchild_engine_v1_2026-04-20T02-50-35.md — green verdict proof.'));
children.push(Bul('Git: ef1cd8c on origin/master.'));

// DOC
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: '1F3A5F' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: '2E5A8F' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: FONT },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ] },
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

Packer.toBuffer(doc).then((buf) => {
  const out = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx';
  fs.writeFileSync(out, buf);
  console.log('wrote', out, buf.length, 'bytes');
});
