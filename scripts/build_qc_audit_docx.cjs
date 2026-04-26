// One-shot builder for QC_Rack_Audit.docx. Run:  node scripts/build_qc_audit_docx.cjs
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, LevelFormat, BorderStyle, WidthType,
  ShadingType, PageOrientation,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true, size: 32 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true, size: 26 })] });
const P  = (t) => new Paragraph({ children: [new TextRun({ text: t, size: 22 })], spacing: { after: 120 } });
const B  = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun({ text: t, size: 22 })] });
const Code = (t) => new Paragraph({ children: [new TextRun({ text: t, font: "Consolas", size: 20 })], spacing: { after: 80 } });

function shaded(text, fill) {
  return new TableCell({
    borders,
    width: { size: 2340, type: WidthType.DXA },
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, size: 20, bold: true })] })],
  });
}
function cell(text, width = 2340) {
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [new TextRun({ text, size: 20 })] })],
  });
}

// ---- QC rack stage table --------------------------------------------------
const stageRows = [
  ["qc:schema",        "check_schema_v1.mjs",       "graph.json conforms to schema v1"],
  ["qc:t6",            "check_t6_rules.mjs",        "T6 rule-set (FB safety, DC, denormal tail, dry/wet, bypass)"],
  ["qc:graphs",        "check_all_graphs_deep.mjs", "Every plugin graph deep-validates"],
  ["qc:pcof",          "check_pcof.mjs",            "PCOF IR canonicalization stable"],
  ["qc:goldens",       "check_op_goldens.mjs",      "Sidecar shape + SHA-256 golden hashes (85 ops)"],
  ["qc:math",          "check_op_math.mjs",         "Per-op sidecar unit tests (real-math assertions)"],
  ["qc:master",        "check_master_worklet.mjs",  "Master-worklet codegen golden parity"],
  ["qc:emit",          "check_master_emit_parity.mjs","WAsm vs native emitter byte/structural parity"],
];

const stageTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [2340, 2700, 4320],
  rows: [
    new TableRow({ children: [shaded("Stage", "D5E8F0"), shaded("Script", "D5E8F0"), shaded("What it enforces", "D5E8F0")] }),
    ...stageRows.map(r => new TableRow({ children: [cell(r[0]), cell(r[1], 2700), cell(r[2], 4320)] })),
  ],
});

// ---- Session ship table ---------------------------------------------------
const shipRows = [
  ["#79", "sineOsc", "JOS PASP Digital Sinusoid Generators (Direct-Form Resonator)",
   "JOS §DFR + McCartney CMJ 2002 phase-0 init", "SHIPPED, re-audited"],
  ["#81", "blit",    "Stilson & Smith 1996 §3.7 + STK Blit.h (Davies/Scavone 2005)",
   "Peak-1 normalization, M = 2⌊P/2⌋+1", "SHIPPED"],
  ["#82", "minBLEP", "Brandt ICMC 2001 §4.2/§6.2/§6.3 + martinfinke/PolyBLEP",
   "Ω=32 Nz=8 table, inline FFT + cepstral min-phase, zero latency", "WORKLET WRITTEN (cpp/test/registry/golden pending)"],
];
const shipTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: [720, 1440, 3600, 2400, 1200],
  rows: [
    new TableRow({ children: [
      shaded("#", "FFE6B3"), shaded("Op", "FFE6B3"), shaded("Primaries consulted", "FFE6B3"),
      shaded("Key params / form", "FFE6B3"), shaded("Status", "FFE6B3"),
    ]}),
    ...shipRows.map(r => new TableRow({ children: [
      cell(r[0], 720), cell(r[1], 1440), cell(r[2], 3600), cell(r[3], 2400), cell(r[4], 1200),
    ]})),
  ],
});

// ---- Build the doc --------------------------------------------------------
const children = [
  H1("QC Rack Audit — Sandbox Op Ship Pipeline"),
  P("Date: 2026-04-24.  Repo: Shags VST.  Scope: the quality-control rack that gates every sandbox op ship, and the ops shipped through it during this session."),

  H1("1. What the QC Rack Is"),
  P("The QC rack is an 8-stage Node pipeline (npm run qc:all) that every op must pass before the catalog row flips from ⬜ to ✅.  Each stage is a standalone script under scripts/ and runs without any browser/AudioWorklet dependency — sidecars are pure JS classes, master-worklet codegen stitches them flat."),
  stageTable,
  P(""),
  P("Two artifacts back the rack: scripts/goldens/<opId>.golden.json (one SHA-256 per op output, 85 files committed) and the tri-file op contract under src/sandbox/ops/: op_<id>.worklet.js, op_<id>.cpp.jinja, op_<id>.test.js."),

  H1("2. Shape + Golden Conformance (check_op_goldens.mjs)"),
  P("The central guard.  For every opId in its OP_IDS list it performs:"),
  B("(A) Shape conformance — sidecar static opId / inputs / outputs / params match opRegistry.js exactly.  Any divergence (filesystem vs registry vs sidecar static fields) fails at pre-commit."),
  B("(B) Numerical contract — drives each sidecar with a fixed deterministic buffer (chirp over 96 samples + impulse at sample 100 + zeros), hashes concatenated Float32 output bytes with SHA-256, compares to the stored golden.  First run or --bless captures; later math changes trip the hash."),
  P("Drive buffer is PRNG-free on purpose: reproducible across x86 + arm64, TypedArray buffer little-endian in practice on all target platforms."),

  H1("3. Ship Protocol Governing Every Op"),
  P("memory/sandbox_op_ship_protocol.md is binding.  Research-first, six steps:"),
  B("1. Load the catalog row and read the linked primary source(s)."),
  B("2. Synth-family rule: minimum TWO primary sources.  For sine/osc ops, open JOS PASP Digital Sinusoid Generators first — it enumerates three distinct methods (Direct-Form Resonator, 2D rotation, coupled Gordon-Smith) that are commonly mis-attributed."),
  B("3. Write the code across the tri-file contract (.worklet.js + .cpp.jinja + .test.js)."),
  B("4. Diff the passage vs shipped code side-by-side.  Call out every deviation in chat."),
  B("5. npm run qc:all — must be green."),
  B("6. Update sandbox_ops_catalog.md row to ✅ and log any deferred upgrade path in sandbox_ops_research_debt.md."),
  P("The synth-family rule was added this session after #79 sineOsc was mis-attributed as Gordon-Smith on first ship (it was in fact JOS's Direct-Form Resonator).  Code was correct; naming was wrong.  Re-audit produced a stronger catalog entry and the permanent rule."),

  H1("4. Session Ship Ledger"),
  shipTable,
  P(""),
  P("Catalog total advanced from ~82 ⇒ 84 shipped (≈65%).  Row #82 flips on completion of the pending tri-file + golden steps."),

  H1("5. #82 minBLEP — Method Audit"),
  P("Implementation follows Brandt §4.2 windowed-sinc + §6.2 cepstral homomorphic min-phase + §6.3 integrate.  Inline radix-2 Cooley-Tukey FFT runs once at module load; no runtime FFT cost.  Build stages:"),
  Code("(1) Blackman-windowed sinc, fc=1/Ω, centered at N/2"),
  Code("(2) FFT → log|H(k)|"),
  Code("(3) IFFT(log|H|) → real cepstrum c"),
  Code("(4) Fold: c[0] & c[N/2] unchanged, c[1..N/2-1] doubled, rest zeroed"),
  Code("(5) FFT → log-spectrum with min-phase phase"),
  Code("(6) exp() element-wise → H_min"),
  Code("(7) IFFT → h_min (real, minimum-phase)"),
  Code("(8) Cumulative sum, normalize → MinBLEP"),
  Code("(9) residual[k] = MinBLEP[k] − 1  (subtract instantaneous step)"),
  P("Parameters: OMEGA=32, NZ=8, TABLE_N=512, BLEP_LEN=8, TABLE_RES=256.  Debt: mastering-grade Ω=64/Nz=16 per Brandt Fig 4 is filed in sandbox_ops_research_debt.md.  Per-sample path: advance phase; on wrap compute α=phase/dt and insert event with jump=−2; sum jump·residual[(age+α)·Ω] (linear interp) over active events; emit (naive + correction) * amp.  getLatencySamples() = 0 — minimum phase is the whole point."),

  H1("6. Ship-Critical Gates Enforced by qc:t6"),
  B("FB safety: denormal flush under feedback, no runaway."),
  B("DC rejection in feedback loops."),
  B("Denormal tail (Jon Watte macro, Canon Utilities §1)."),
  B("Dry/Wet computed inside worklet (no external parallel dry leg)."),
  B("Bypass contract sample-accurate."),

  H1("7. Open Items at End of Session"),
  B("#82 minBLEP: cpp.jinja, test.js, registry entry, golden bless, qc:all, catalog + debt update."),
  B("Protocol Step 4 diff for minBLEP pending in-chat call-out."),
  B("Debt entries to log: mastering-grade MinBLEP table, polyBLEP sibling op, hard-sync extension, square/triangle variants via residual integration (C₂ offset known), BLEP-for-filters composition."),

  H1("8. Review Verdict"),
  P("The QC rack is doing what it was designed to do.  The sineOsc mis-attribution was caught by user challenge, not by the rack itself — the rack enforces numerical + shape conformance, not bibliographic accuracy.  That gap was closed this session by the synth-family primary-source rule encoded in the ship protocol, which is now loaded automatically via MEMORY.md every session.  No code regressions; 84 ops green; pipeline ready for #82 completion and downstream synth-family ops."),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
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
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  const out = path.resolve("C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx");
  fs.writeFileSync(out, buf);
  console.log("wrote", out, buf.length, "bytes");
});
