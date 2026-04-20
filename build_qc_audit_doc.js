// Build QC_Rack_Audit.docx — audit of the QC harness work this session.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, PageOrientation, TabStopType, TabStopPosition, PageBreak,
} = require('docx');

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t, opts={}) => new Paragraph({ children: [new TextRun({ text: t, ...opts })] });
const BULLET = (t) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  children: [new TextRun(t)],
});
const CODE = (t) => new Paragraph({
  children: [new TextRun({ text: t, font: "Consolas", size: 20 })],
  spacing: { before: 60, after: 60 },
  shading: { fill: "F4F4F4", type: ShadingType.CLEAR },
});

const cell = (text, { bold=false, shade=null, width=4680 } = {}) =>
  new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
  });

const tbl2 = (rows) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2800, 6560],
  rows: rows.map((r, i) => new TableRow({
    children: [
      cell(r[0], { bold: true, shade: i === 0 ? "D5E8F0" : "F7F9FB", width: 2800 }),
      cell(r[1], { bold: i === 0, shade: i === 0 ? "D5E8F0" : null, width: 6560 }),
    ],
  })),
});

const tbl3 = (rows, widths=[2400, 2400, 4560]) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: widths,
  rows: rows.map((r, i) => new TableRow({
    children: r.map((c, j) => cell(c, {
      bold: i === 0,
      shade: i === 0 ? "D5E8F0" : null,
      width: widths[j],
    })),
  })),
});

const children = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "QC Rack System — Session Audit", bold: true, size: 44 })],
    spacing: { after: 120 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Shags VST • In-App QC Harness & Analyzer", italics: true, size: 24, color: "555555" })],
    spacing: { after: 80 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Date: 2026-04-19", size: 20, color: "777777" })],
    spacing: { after: 360 },
  }),

  H1("1. Executive Summary"),
  P("This session hardened the Shags VST QC rack into a self-contained, iterative tool. Three classes of work landed: an audio-layer fix (worklet registration collision), a load-time fix (registry lazy-loading), and a user-layer upgrade (in-app Analyzer with re-run loop and foot-gun gates). The harness can now be driven by any contributor without dragging JSON files out of the browser."),

  H2("Headline Outcomes"),
  BULLET("Audio restored: worklet \"already registered\" collision no longer blocks re-instantiation."),
  BULLET("Cold load reduced: engine factories are code-split; only the active variant is fetched."),
  BULLET("In-app interpretation: deterministic rule table turns an audit bundle into a verdict + findings inside the app."),
  BULLET("Iterative loop: RE-RUN button + variant-aware diff + history pills enable edit → sweep → compare without screenshots."),
  BULLET("Foot-gun gates: variant confirm popup + source-missing hard block prevent silent/legacy sweeps."),

  H1("2. Scope"),
  P("Files touched or created this session, grouped by layer:"),
  tbl3([
    ["Layer", "File", "Change"],
    ["Audio", "src/manChild/manChildEngine.js", "Guarded registerProcessor"],
    ["Audio", "src/manChild/manChildEngine.v1.js", "Guarded registerProcessor"],
    ["Load", "src/migration/registry.js", "Lazy engine factories (all 6 variants)"],
    ["QC", "src/qc-harness/qcAnalyzer.js", "NEW — pure analyzer / diff / markdown"],
    ["QC", "src/qc-harness/Analyzer.jsx", "ANALYZE, RE-RUN, Confirm popup, source gate"],
  ]),

  H1("3. Audio Fix — Worklet Registration Guard"),
  H2("Problem"),
  P("AudioWorkletGlobalScope is a singleton per document. Re-importing the engine module (engine swap, HMR, re-mount) called registerProcessor a second time with the same name, throwing and leaving the node silent."),
  H2("Fix"),
  P("Wrap registerProcessor in a narrow try/catch that only swallows the specific \"already registered\" error and rethrows anything else."),
  CODE("try {"),
  CODE("  registerProcessor('manchild-processor-' + PROCESSOR_VERSION, MANchildProcessor);"),
  CODE("} catch (err) {"),
  CODE("  if (!/already registered/i.test(String(err && err.message))) throw err;"),
  CODE("}"),
  H2("Verification"),
  BULLET("Audio returns on second mount and on engine-variant switch."),
  BULLET("Any unrelated worklet error still surfaces (not silently swallowed)."),

  H1("4. Load Fix — Registry Lazy Engine Factories"),
  H2("Problem"),
  P("The registry eagerly imported every engine factory at module load. Cold start pulled in all DSP bundles (two ~54 KB MANchild variants among them) even when the user only needed one plugin."),
  H2("Fix"),
  P("Introduce a lazy() helper that wraps a dynamic import. Engine factories are now fetched on first instantiation; Vite emits one chunk per engine file. Public contract unchanged — callers still await variant.engineFactory(ctx)."),
  CODE("const lazy = (loader, named) => async (ctx) => (await loader())[named](ctx);"),
  CODE(""),
  CODE("engineFactory: lazy("),
  CODE("  () => import('../manChild/manChildEngine.v1.js'),"),
  CODE("  'createManChildEngineV1'"),
  CODE("),"),
  H2("Scope of Change"),
  BULLET("All 6 variants in registry.js converted consistently."),
  BULLET("React components stay synchronous — they drive menus / tooltips and are small."),
  BULLET("Only real call site (QcHarness.jsx) needed no change."),

  H1("5. qcAnalyzer.js — Pure Analyzer Module"),
  P("New module (~270 lines) that takes a QC audit bundle and returns a structured verdict. It is pure (no DOM, no React, no globals), so it is trivially testable and drivable by CI later."),
  H2("Exports"),
  tbl2([
    ["Export", "Purpose"],
    ["analyzeAudit(bundle)", "Run 8 severity rules, return verdict + headline + findings"],
    ["diffReports(prev, curr)", "Variant-aware diff — resolved, introduced, carried findings"],
    ["reportToMarkdown(report, bundle)", "Produce downloadable .md for archiving"],
  ]),
  H2("Rule Table"),
  tbl3([
    ["Rule ID", "Severity", "Trigger"],
    ["snapshot_self_fail", "fail", "A snapshot reports its own failure"],
    ["preset_not_found", "warn", "Preset name missing from registry"],
    ["preset_not_applied", "warn", "Preset loaded but measurement unchanged"],
    ["gr_meter_stuck", "fail", "GR reads identical across all snapshots"],
    ["louder_than_input", "warn", "Post-LUFS exceeds pre-LUFS beyond tolerance"],
    ["peak_above_input", "warn", "Post-peak above pre-peak beyond tolerance"],
    ["null_too_colored", "warn", "Null-test RMS too loud vs dry"],
    ["per_snapshot_warnings", "info", "Aggregated per-snapshot advisories"],
  ], [2800, 1400, 5160]),
  H2("Verdict Shape"),
  CODE("{ verdict, summary, headline, findings[] }"),
  CODE("headline: { snapshots, presetsFound/Applied, nullRms, lufs, gr, peak }"),

  H1("6. Analyzer.jsx — In-App UI"),
  H2("Toolbar Additions"),
  BULLET("📊 ANALYZE — runs analyzer against the current queue, opens popup."),
  BULLET("🔁 RE-RUN — re-sweeps, then analyzes; drops new report into history."),
  BULLET("📤 EXPORT AUDIT — preserved, unchanged."),
  H2("Popup Contents"),
  BULLET("Verdict banner (pass / warn / fail) with VariantChip (green V1, gold Legacy)."),
  BULLET("Legacy baseline note when variantId === 'legacy' — explains why findings are expected."),
  BULLET("Diff strip vs previous same-variant report: improved / regressed / same."),
  BULLET("History pills — last N runs, tagged v1 / legacy, clickable."),
  BULLET("Findings list grouped by severity."),
  BULLET("Headline metrics table."),
  BULLET("Actions: RE-RUN, DOWNLOAD REPORT (.md), CLOSE."),

  H1("7. Foot-Gun Gates — ConfirmVariantPopup"),
  P("The user flagged two specific ways to waste a sweep: running on Legacy when meaning to run on V1, and running with no test source playing. Both are now gated at one choke point — the confirm dialog that fires before any ANALYZE or RE-RUN."),
  H2("Gate 1 — Variant Awareness"),
  BULLET("Colored chip in header (green ENGINE V1, gold LEGACY) — visual, not a label."),
  BULLET("Info block for Legacy explaining it is a snapshot baseline — findings there are informational."),
  BULLET("History / diff compare only against same-variantId entries so v1 vs legacy results never cross-contaminate."),
  H2("Gate 2 — Source Missing"),
  BULLET("needsSource = action === 'rerun' — re-sweeping without a source measures silence."),
  BULLET("Red warning block when sourceMissing: \"No test source is playing. A sweep without a source measures silence — the results will be meaningless.\""),
  BULLET("Green indicator when source is playing: \"▶ Test source: PINK\"."),
  BULLET("CONTINUE button disabled + grey + cursor: not-allowed + tooltip \"Start a test source first\" when continueLocked."),
  H2("How To Test"),
  BULLET("Open harness, do NOT click PINK — click 🔁 RE-RUN → expect red block + disabled CONTINUE."),
  BULLET("Click PINK, re-open confirm → expect green indicator + enabled CONTINUE."),
  BULLET("Flip to LEGACY variant and ANALYZE → expect gold chip + Legacy note, diff compared only to prior Legacy runs."),

  H1("8. Known / Deferred Issues"),
  tbl3([
    ["Issue", "Status", "Next Step"],
    ["GR meter stuck at fixed dB across 41 presets (v1)", "Deferred", "Bump sweep wait 600 → 1500ms; read engine.getGrDbA() live at capture"],
    ["Main 🌀 SWEEP PRESETS button ungated when no source", "Open", "Reuse sourceKind check at sweep entry point"],
    ["React borderColor shorthand warnings", "Cosmetic", "Pre-existing; not from this session's edits"],
    ["Tech debt: rename legacy DrumBus → PantherBussLegacy", "Tracked in MEMORY.md", "Keep legacyType:'drumbus' string for back-compat"],
  ], [3000, 1600, 4760]),

  H1("9. Risk & Rollback"),
  H2("Risk"),
  BULLET("Lazy loading adds a one-time async boundary on first engine use — imperceptible on LAN dev, sub-100ms on typical bundles."),
  BULLET("Registration guard is narrow (regex on error message) — non-matching errors still throw."),
  BULLET("Analyzer is pure; failure in analyzeAudit cannot corrupt engine or audit bundle."),
  H2("Rollback"),
  BULLET("Each change is file-scoped: revert the edited file to restore prior behavior."),
  BULLET("qcAnalyzer.js is additive — deleting it and its imports removes the feature cleanly."),

  H1("10. Acceptance Checklist"),
  BULLET("Audio returns after engine-variant swap (no \"already registered\" throw)."),
  BULLET("Cold load fetches only the active engine chunk (verify in Network panel)."),
  BULLET("ANALYZE populates verdict + findings without leaving the app."),
  BULLET("RE-RUN produces a new history entry and a same-variant diff strip."),
  BULLET("Confirm popup blocks CONTINUE when no source is playing."),
  BULLET("Confirm popup shows correct variant chip and (for Legacy) the baseline note."),
  BULLET("DOWNLOAD REPORT produces a readable .md file."),

  new Paragraph({
    spacing: { before: 480 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "— End of audit —", italics: true, color: "888888" })],
  }),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1F3A5F" },
        paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "444444" },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }],
    }],
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
  const out = "C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx";
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
