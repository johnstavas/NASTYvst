// Build QC Rack Audit document
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber,
  PageBreak, TabStopType, TabStopPosition,
} = require('docx');

const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2; // 9360

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

// ───────── helpers ─────────
const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: Array.isArray(text)
      ? text
      : [new TextRun({ text, ...(opts.run || {}) })],
  });

const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 200 },
    children: [new TextRun({ text, bold: true, size: 32, font: "Arial" })],
  });

const H2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 140 },
    children: [new TextRun({ text, bold: true, size: 26, font: "Arial" })],
  });

const H3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22, font: "Arial" })],
  });

const Bullet = (text) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60 },
    children: typeof text === 'string'
      ? [new TextRun(text)]
      : text,
  });

const Code = (text) =>
  new Paragraph({
    spacing: { before: 60, after: 120 },
    shading: { fill: "F2F2F2", type: ShadingType.CLEAR },
    children: [new TextRun({ text, font: "Consolas", size: 18 })],
  });

const cell = (text, opts = {}) => new TableCell({
  borders,
  width: { size: opts.width, type: WidthType.DXA },
  shading: opts.fill
    ? { fill: opts.fill, type: ShadingType.CLEAR }
    : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({
    children: [new TextRun({
      text,
      bold: !!opts.bold,
      size: opts.size || 20,
      font: "Arial",
    })],
  })],
});

// ───────── content ─────────
const children = [];

// Title block
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 0, after: 120 },
  children: [new TextRun({
    text: "gainCOMPUTER — QC Rack System Audit",
    bold: true, size: 44, font: "Arial",
  })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 80 },
  children: [new TextRun({
    text: "Per-op verification rack: protocol, tooling, and ledger",
    italics: true, size: 24, color: "666666",
  })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 320 },
  children: [new TextRun({
    text: "Session audit · 2026-04-28",
    size: 20, color: "888888",
  })],
}));

// ───────── 1. Executive Summary ─────────
children.push(H1("1. Executive Summary"));
children.push(P(
  "The QC Rack is the per-op verification system that decides which sandbox ops are allowed to ship. " +
  "It enforces a 7-gate protocol on every op (Worklet, C++, Smoke, T1–T7, T8 parity, T8-B behavioral, Listen) " +
  "and exposes both the test runners and a browser-side listening rig so an engineer can hear, see, and " +
  "measure what each op does before flipping it green."
));
children.push(P(
  "This session brought the rack from a partial scaffold to a working production line: ~28 ops are now " +
  "gold-flagged (✅+P+✓), behavioral specs were calibrated against actual measurements, and three new metric " +
  "categories (filter / distortion / compressor / analyzer) were added so non-utility ops can verify in the " +
  "browser without leaving the rack."
));

children.push(H2("Headline outcomes this session"));
[
  "7-gate protocol formalized and applied uniformly per op.",
  "OpListenPanel rebuilt: 8 audio sources, IN/OUT dBFS metering, file-drop, double-click reset, debounced sliders, signal-flow tooltip, control-signal banner.",
  "Browser metric runners added for filter, distortion, compressor, analyzer categories — aligned with headless math.",
  "Behavioral specs calibrated to measurement (blackmerVCA, fetVVR, diodeBridgeGR Hill-curve recalculation).",
  "tldr field backfilled on verified ops in plain sound-designer voice for the future AI agent.",
  "Catalog and recipe library separated: ops vs. compositions, with a research-findings doc behind both.",
].forEach(t => children.push(Bullet(t)));

// ───────── 2. The 7-Gate Protocol ─────────
children.push(H1("2. The 7-Gate Verification Protocol"));
children.push(P(
  "An op is not permitted to ship until it passes every gate. The gates are intentionally redundant: " +
  "they catch the same failure from different angles — math, codegen, audio, and ear."
));

const gateRows = [
  ["W", "Worklet", "Op runs without errors in the AudioWorklet runtime; correct port shape; no NaN/Inf; bypass contract honored.", "src/sandbox/worklets/*.js"],
  ["C", "C++", "C++ emitter produces compilable code matching the worklet semantics. Build succeeds in JUCE harness.", "src/codegen/emitters/cpp/*.cc"],
  ["S", "Smoke", "Op renders a known-good test signal end-to-end without crashing or producing garbage.", "T0 smoke harness"],
  ["T", "T1–T7", "Family-of-rules sweep: bypass, dry/wet, DC under FB, FB runaway guard, denormal tail, etc.", "ship_blockers.md gates"],
  ["P", "T8 Parity", "Worklet vs. C++ sample-by-sample parity within declared tolerance across full sweep.", "T8 parity harness"],
  ["B", "T8-B Behavioral", "Op meets its declared behavioral spec (cutoff, GR, THD curve, attack/release, etc.) in the browser metric runner.", "src/sandbox/behavioral/specs/*.mjs"],
  ["L", "Listen", "Engineer hears the op on multiple sources (sine, chord, drums, file drop) and confirms the character matches the tldr.", "OpListenPanel.jsx"],
];

children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [720, 1440, 5760, 1440],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Gate", { width: 720, bold: true, fill: "D5E8F0" }),
        cell("Name", { width: 1440, bold: true, fill: "D5E8F0" }),
        cell("What it proves", { width: 5760, bold: true, fill: "D5E8F0" }),
        cell("Where it lives", { width: 1440, bold: true, fill: "D5E8F0" }),
      ],
    }),
    ...gateRows.map(([g, n, d, w]) => new TableRow({
      children: [
        cell(g, { width: 720, bold: true }),
        cell(n, { width: 1440, bold: true }),
        cell(d, { width: 5760 }),
        cell(w, { width: 1440 }),
      ],
    })),
  ],
}));

children.push(P(""));
children.push(P(
  "Catalog status legend used on every op row:",
  { run: { bold: true } }
));
[
  "⬜ — not started",
  "🚧 — in progress (one or more gates open)",
  "✅+P — parity-verified (gates W/C/S/T/P green)",
  "✅+P+✓ — gold (all 7 gates green; ship-eligible)",
].forEach(t => children.push(Bullet(t)));

// ───────── 3. The Listen Rig ─────────
children.push(H1("3. The Listen Rig (OpListenPanel)"));
children.push(P(
  "The Listen gate is the human-in-the-loop check. The rig was rebuilt this session to make that check fast, " +
  "honest, and free of the tooling artifacts that previously hid op character."
));

children.push(H2("Sources"));
[
  "Sine 440 Hz — purity and harmonic distortion ear-test.",
  "Chord (root + 5th + octave) — intermodulation and movement.",
  "Square wave — slew, transient response, fold-back behavior.",
  "Click train — attack-time and transient handling.",
  "Pink noise — broadband tilt and resonance reveal.",
  "Sine sweep — frequency-dependent character.",
  "Drum loop — real-program stress.",
  "File drop — full-length user audio (no truncation).",
].forEach(t => children.push(Bullet(t)));

children.push(H2("Controls and metering"));
[
  "IN GAIN slider (-24 to +24 dB) with double-click reset to 0 dB.",
  "MONITOR slider (renamed from OUT GAIN) — playback-only, does not affect tests or meters; tooltip clarifies the path.",
  "IN / OUT dBFS strip with peak + RMS readouts; over-0-dBFS warning highlight.",
  "Bypass toggle for instant A/B against the raw source.",
  "Signal-flow ASCII diagram behind a '?' info button.",
  "Control-signal banner (amber) on analyzer/envelope/gainCurve ops to warn 'listen test informational only'.",
].forEach(t => children.push(Bullet(t)));

children.push(H2("Engineering fixes baked into the rig"));
[
  "Cosine fade in/out at buffer boundaries (10 ms each side) — kills loop-pop.",
  "8 ms ramp-down before stop; 12 ms ramp-up on start — kills source-switch click.",
  "220 ms debounce on IN GAIN-triggered re-render — kills slider zipper noise.",
  "useEffect dependency array includes userFile — fixes file-drop replay bug.",
  "Drop file uses ch0.length, not RENDER_SECONDS — full file length plays.",
  "useCallback deps include all reactive values (inputGainDb, cvPort, cvPumpPeak, driveCv, userFile) — kills stale closures.",
].forEach(t => children.push(Bullet(t)));

// ───────── 4. Browser Metric Runners ─────────
children.push(H1("4. Browser Metric Runners"));
children.push(P(
  "src/sandbox/behavioral/runBrowserMetric.js gained four new runners this session, so any op category " +
  "can pass the T8-B behavioral gate without leaving the browser."
));

children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [2160, 7200],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Runner", { width: 2160, bold: true, fill: "D5E8F0" }),
        cell("What it measures", { width: 7200, bold: true, fill: "D5E8F0" }),
      ],
    }),
    new TableRow({ children: [
      cell("runFilterMetric", { width: 2160, bold: true }),
      cell("Peak-referenced -3 dB cutoff via log-frequency interpolation. STIM_AMP=0.25 (-12 dBFS) to match headless.", { width: 7200 }),
    ]}),
    new TableRow({ children: [
      cell("runDistortionMetric", { width: 2160, bold: true }),
      cell("Peak THD across input-level sweep. Spectrum plot via magnitudeSpectrum. Supports param_sweep arrays.", { width: 7200 }),
    ]}),
    new TableRow({ children: [
      cell("runCompressorMetric", { width: 2160, bold: true }),
      cell("CV → gain-reduction curve. Falls back to a fresh stim at cv_for_6db_gr if not present in cv_sweep_linear.", { width: 7200 }),
    ]}),
    new TableRow({ children: [
      cell("runAnalyzerMetric", { width: 2160, bold: true }),
      cell("CV-curve generators (e.g. optoCell). Plots input-vs-output linearity over the declared range.", { width: 7200 }),
    ]}),
  ],
}));

// ───────── 5. Spec Calibrations ─────────
children.push(H1("5. Behavioral Spec Calibrations"));
children.push(P(
  "Several Cluster A specs held pre-measurement guesses that didn't survive contact with actual Hill-curve math. " +
  "All changes were additive: op math untouched, spec values updated to match measurement, change date in the comment."
));

children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [1800, 2400, 2580, 2580],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Op", { width: 1800, bold: true, fill: "D5E8F0" }),
        cell("Field", { width: 2400, bold: true, fill: "D5E8F0" }),
        cell("Was", { width: 2580, bold: true, fill: "D5E8F0" }),
        cell("Now", { width: 2580, bold: true, fill: "D5E8F0" }),
      ],
    }),
    new TableRow({ children: [
      cell("blackmerVCA", { width: 1800, bold: true }),
      cell("gr_at_max_cv_db", { width: 2400 }),
      cell("18 (arbitrary guess)", { width: 2580 }),
      cell("24 (linear-in-dB law: cv=-24 → 24 dB GR)", { width: 2580 }),
    ]}),
    new TableRow({ children: [
      cell("fetVVR", { width: 1800, bold: true }),
      cell("cv_for_6db_gr", { width: 2400 }),
      cell("0.5", { width: 2580 }),
      cell("1.0 (Hill β=2 → -6 dB at cv=cutoffScale)", { width: 2580 }),
    ]}),
    new TableRow({ children: [
      cell("fetVVR", { width: 1800, bold: true }),
      cell("gr_at_max_cv_db", { width: 2400 }),
      cell("20", { width: 2580 }),
      cell("24 (cv=4 → 1/17 → -24.6 dB)", { width: 2580 }),
    ]}),
    new TableRow({ children: [
      cell("diodeBridgeGR", { width: 1800, bold: true }),
      cell("cv_for_6db_gr", { width: 2400 }),
      cell("0.5", { width: 2580 }),
      cell("1.0 (Hill β=1.8)", { width: 2580 }),
    ]}),
    new TableRow({ children: [
      cell("diodeBridgeGR", { width: 1800, bold: true }),
      cell("gr_at_max_cv_db", { width: 2400 }),
      cell("16", { width: 2580 }),
      cell("22 (cv=4 → 1/13.13 → -22.4 dB)", { width: 2580 }),
    ]}),
    new TableRow({ children: [
      cell("gain", { width: 1800, bold: true }),
      cell("defaultParams.gainDb", { width: 2400 }),
      cell("-6", { width: 2580 }),
      cell("0 (DAW unity convention)", { width: 2580 }),
    ]}),
    new TableRow({ children: [
      cell("uniBi", { width: 1800, bold: true }),
      cell("controlSignalOp", { width: 2400 }),
      cell("(unset)", { width: 2580 }),
      cell("true (suppresses misleading audio test)", { width: 2580 }),
    ]}),
  ],
}));

children.push(P(""));
children.push(P(
  "Sign-convention footgun documented in cluster_a.mjs: blackmerVCA uses positive cv = amplification, " +
  "while varMuTube / fetVVR / diodeBridgeGR use positive cv = compression depth. Sign conversion belongs " +
  "upstream of the cell.",
  { run: { italics: true } }
));

// ───────── 6. Verified Ops ─────────
children.push(H1("6. Verified Ops This Session"));
children.push(P(
  "Approximately 28 ops cleared all 7 gates this session. Listed by category with the tldr that ships in the catalog:"
));

const verifiedRows = [
  ["gain", "Utility", "Unity-default volume control. IN === OUT at 0 dB."],
  ["polarity", "Utility", "Phase flip. Inaudible on its own; reveals on parallel sum."],
  ["mix", "Utility", "Equal-power dry/wet crossfade (cos/sin)."],
  ["abs", "Utility", "Full-wave rectify. Octave-up character on monophonic sources."],
  ["sign", "Utility", "Hard square-up to ±1. Extreme bitcrush feel."],
  ["clamp", "Utility", "Hard ceiling/floor. Subtle on chord, square-up on sine."],
  ["slew", "Envelope", "Per-sample rate limiter. Smooths transients, kills clicks."],
  ["envelope", "Envelope", "Audio → CV peak/RMS follower."],
  ["dcBlock", "Filter", "1-pole HPF at sub-bass — removes DC and rumble."],
  ["filter", "Filter", "General-purpose biquad."],
  ["allpass", "Filter", "Phase shift only; magnitude flat."],
  ["ladder", "Filter", "Moog-flavored 4-pole lowpass."],
  ["korg35", "Filter", "Sticky resonance lopass — Korg-35 character."],
  ["tilt", "Filter", "Bass-vs-treble seesaw EQ."],
  ["saturate", "Character", "Soft clip / tanh shaping."],
  ["hardClip", "Character", "Brick-wall ceiling. Crushed and distorted."],
  ["chebyshevWS", "Character", "Polynomial waveshaper. Drum-prew character."],
  ["wavefolder", "Character", "Buchla-style fold-back distortion."],
  ["bitcrush", "Character", "Bit-depth quantize. U-curve THD across level."],
  ["diodeClipper", "Character", "Asymmetric/symmetric soft clip."],
  ["xformerSat", "Character", "Transformer LF saturation (De Paiva WDF)."],
  ["scaleBy", "Math", "Linear scalar multiply."],
  ["gainComputer", "GainCurve", "CV from input level — no audio out."],
  ["optoCell", "Analyzer", "LA-2A T4 transfer-curve generator."],
  ["blackmerVCA", "Compressor", "Clean dbx 2180 / SSL bus-comp DNA."],
  ["varMuTube", "Compressor", "Manley Vari-Mu / Fairchild 670 — tube glow blooms with depth."],
  ["fetVVR", "Compressor", "Snappy UREI 1176 FET pump."],
  ["diodeBridgeGR", "Compressor", "Neve 33609 / 2254 — 3rd-harmonic glow under compression."],
];

children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [1800, 1800, 5760],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        cell("Op", { width: 1800, bold: true, fill: "D5E8F0" }),
        cell("Category", { width: 1800, bold: true, fill: "D5E8F0" }),
        cell("tldr", { width: 5760, bold: true, fill: "D5E8F0" }),
      ],
    }),
    ...verifiedRows.map(([op, cat, t]) => new TableRow({
      children: [
        cell(op, { width: 1800, bold: true }),
        cell(cat, { width: 1800 }),
        cell(t, { width: 5760 }),
      ],
    })),
  ],
}));

// ───────── 7. Architecture: catalog / recipe / research ─────────
children.push(H1("7. Documentation Architecture"));
children.push(P(
  "Three memory files now coexist, each answering a different question:"
));

children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: [3120, 3120, 3120],
  rows: [
    new TableRow({
      tableHeader: true,
      children: [
        cell("File", { width: 3120, bold: true, fill: "D5E8F0" }),
        cell("Question it answers", { width: 3120, bold: true, fill: "D5E8F0" }),
        cell("Consumer", { width: 3120, bold: true, fill: "D5E8F0" }),
      ],
    }),
    new TableRow({ children: [
      cell("sandbox_ops_catalog.md", { width: 3120, bold: true }),
      cell("What tools do I have?", { width: 3120 }),
      cell("Engineer + AI agent", { width: 3120 }),
    ]}),
    new TableRow({ children: [
      cell("recipe_library.md", { width: 3120, bold: true }),
      cell("How do I combine them to build X gear?", { width: 3120 }),
      cell("AI agent (primary)", { width: 3120 }),
    ]}),
    new TableRow({ children: [
      cell("research_findings_2026_04_28.md", { width: 3120, bold: true }),
      cell("Where did the primary sources come from?", { width: 3120 }),
      cell("Engineer (audit trail)", { width: 3120 }),
    ]}),
  ],
}));

children.push(P(""));
children.push(P(
  "recipe_library.md contains 30 archetypal compositions — JTM45, AC30, Twin Reverb, Mullard 5-20, Williamson, " +
  "Hammond/EMT 140/EMT 250/Lexicon 224, tape echo, SSL G, LA-2A, 1176, Vari-Mu, 33609, Pultec, Neve, API, " +
  "Bi-Phase, Leslie, vocoder, Buchla, Moog. Each entry maps to ops in the catalog vocabulary."
));

// ───────── 8. Open Items ─────────
children.push(H1("8. Open Items"));
[
  "Step 3 of research-ingestion plan: update specific ⬜ catalog rows with new Tier-S primaries (additive only).",
  "A4: Per-op T1-T7 sweep adapter (deferred from earlier session).",
  "Continue Listen-gate verification for the remaining 🚧 ops (catalog tracks the queue).",
  "Commit the new memory files (recipe_library.md, research_findings_2026_04_28.md).",
  "Batch 2 of the Perplexity research brief — ~10 synthesis ops (#173 complexOsc, #177 fmOperator, #180 schmittTriggerOsc, etc.).",
  "Bench measurements for xformerSat presets (marinair, utc108x, malotki, we111c, haufeV178, utcO12) before flipping any to 'paper-validated'.",
  "Triage diodeBridgeGR catalog row — was set to 🚧 but content is gold.",
].forEach(t => children.push(Bullet(t)));

// ───────── 9. Ship-Gate Reminder ─────────
children.push(H1("9. Ship-Gate Reminder"));
children.push(P(
  "The QC Rack does not relax the existing global ship blockers documented in ship_blockers.md. Native parity " +
  "remains a permanent ship gate. The 7-gate per-op protocol is in addition to — not instead of — the global gates."
));
[
  "T1 sweep zero FAILs.",
  "Dry/wet mix computed inside the worklet (same-sample raw=dry, processed=wet).",
  "Bypass contract honored.",
  "DC rejection under FB.",
  "FB runaway guard.",
  "Denormal tail.",
  "Native parity green at declared tolerance.",
].forEach(t => children.push(Bullet(t)));

children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(P(
  "End of audit.",
  { alignment: AlignmentType.CENTER, run: { italics: true, color: "888888" } }
));

// ───────── document ─────────
const doc = new Document({
  creator: "gainCOMPUTER",
  title: "QC Rack System Audit",
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1F3A5F" },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2E5C8A" },
        paragraph: { spacing: { before: 240, after: 140 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "3A6B9E" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets",
        levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({
            text: "gainCOMPUTER · QC Rack Audit",
            size: 18, color: "888888", italics: true,
          })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "Page ", size: 18, color: "888888" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "888888" }),
            new TextRun({ text: " of ", size: 18, color: "888888" }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "888888" }),
          ],
        })],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("C:/Users/HEAT2/Desktop/Shags VST/QC_Rack_Audit.docx", buf);
  console.log("wrote QC_Rack_Audit.docx", buf.length, "bytes");
});
