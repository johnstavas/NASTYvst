// Build QC_Rack_Audit.docx — session audit of the Shags VST rack
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat,
} = require('docx');

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

const P = (text) => new Paragraph({
  spacing: { after: 120 },
  children: [new TextRun({ text })],
});
const H1 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 280, after: 160 },
  children: [new TextRun({ text, bold: true, size: 32 })],
});
const H2 = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 220, after: 120 },
  children: [new TextRun({ text, bold: true, size: 26 })],
});
const Bullet = (text) => new Paragraph({
  numbering: { reference: "bullets", level: 0 },
  children: [new TextRun(text)],
});

function row(cells, header = false, colWidth) {
  return new TableRow({
    children: cells.map(text => new TableCell({
      borders: BORDERS,
      width: { size: colWidth, type: WidthType.DXA },
      shading: header ? { fill: "1F2937", type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: String(text), bold: header, color: header ? "FFFFFF" : "111111" })],
      })],
    })),
  });
}

function table(header, rows) {
  const cols = header.length;
  const colWidth = Math.floor(9360 / cols);
  return new Table({
    width: { size: colWidth * cols, type: WidthType.DXA },
    columnWidths: new Array(cols).fill(colWidth),
    rows: [row(header, true, colWidth), ...rows.map(r => row(r, false, colWidth))],
  });
}

const children = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Shags VST — QC Rack Audit", bold: true, size: 44 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360 },
    children: [new TextRun({ text: "Session state · 2026-04-18", italics: true, color: "666666" })],
  }),

  H1("1. Executive Summary"),
  P("This audit captures the current state of the Shags VST modular rack after the most recent build session. Two new plugins were brought into the rack — Flap Jack Man (delay) and the 808 Kick (rhythm/voice) — and a new global UI standard for corner radius was added to the plugin contract. All Flap Jack work is committed and pushed to the johnstavas/NASTYvst master branch; the 808 Kick engine and UI files are on disk pending the next registration commit."),

  H1("2. Rack Inventory"),
  table(
    ["Slot ID", "Display Name", "Category", "Status"],
    [
      ["pantherbuss", "Panther Buss", "Character / Buss", "Reference build — 380x500, 5px"],
      ["flapjackman", "Flap Jack Man", "Time / Delay", "NEW — integrated this session"],
      ["eightOhEight", "808 Kick", "Creative / Rhythm", "NEW — engine + UI built this session"],
    ]
  ),

  H1("3. Global Plugin Contract"),
  P("Every plugin in the rack must satisfy the following contract. New entries must pass before being merged."),
  Bullet("Unity-baseline I/O contract (input → output gain stages reach unity by default)"),
  Bullet("Zipper-free macro modulation (smoothed param targets, no audible steps)"),
  Bullet("Mono / stereo channel safety (no channel collapse, no NaN propagation)"),
  Bullet("Reactive-core hook for visual signals (engine exposes analyser / RAF tap)"),
  Bullet("Level metering — input + output, expressive + readable"),
  Bullet("Corner radius — 5 px outer chassis, 3–6 px inner elements (NEW this session)"),

  H1("4. Corner Radius Standard (NEW)"),
  P("Added to the global contract this session. Mandatory across the rack."),
  table(
    ["Element", "Radius", "Notes"],
    [
      ["Outer plugin chassis", "5 px", "Fixed value, no per-plugin variation"],
      ["Inner panels / strips", "3–6 px", "May vary slightly for hierarchy"],
      ["Buttons", "3–6 px", "No 12 px pills, no full-pill 999"],
      ["Knob caps / indicators", "3–6 px", "Stay inside the band"],
    ]
  ),
  P("QC checklist per plugin: outer chassis at 5; all inner panels and buttons in the 3–6 band; no zero-radius squares; no 8+ pixel bubbles; visually matches Panther Buss / Flap Jack Man reference build."),

  H1("5. Flap Jack Man — Delay (NEW)"),
  H2("Origin"),
  P("Promoted from the prior NastyBeast prototype, recategorized from QC into Time/Delay, renamed Flap Jack Man, and resized to match the Panther Buss reference chassis."),
  H2("Chassis"),
  Bullet("380 x 500 px, 5 px border radius, padded 12 px, overflow hidden"),
  Bullet("Art region: 170 px tall, viewBox 0 0 560 280, preserveAspectRatio=none for ~18% vertical desqueeze"),
  Bullet("Bottom helper text removed; AUTO button helper span removed"),
  H2("BPM-locked Scenes"),
  table(
    ["Scene", "Delay", "Feel"],
    [
      ["BUTTER", "Dotted 1/8 (0.75 beats)", "Breakbeat-tight ghost trail"],
      ["SYRUP", "Quarter (1.0 beats)", "Smooth rhythmic doubling"],
      ["GRIDDLE", "Sixteenth (0.25 beats)", "Tight grid stutter"],
    ]
  ),
  P("hauntForBeats(bpm, beats) converts musical division → seconds → normalized macro position, clamped to 80 ms – 1.20 s. Scene/BPM changes retarget the haunt macro instantly."),
  H2("Engine Additions"),
  Bullet("Bidirectional pitch shifter (handles both up- and down-shift via direction-aware sawtooth ramps)"),
  Bullet("Master HPF + LPF inserted between mixSum and outGain"),
  Bullet("TUNE crossfade: tuneDown -12 / passthrough / tuneUp +12 on the wet bus, with time-stretch character"),
  Bullet("setHpf, setLpf, setTune methods exposed on the engine handle"),
  H2("BPM Strip Knobs"),
  P("HPF, LPF, and TUNE knobs added to the BPM strip. All three hide their numeric value display per the user's request — value-on-hover only."),

  H1("6. 808 Kick — Rhythm (NEW)"),
  H2("Engine (eightOhEightEngine.js)"),
  Bullet("Standard rack contract: input/output, setIn/setOut/setMix/setBypass, dispose"),
  Bullet("Topology: input → bypass + (in → pass → duck → dry) → mixSum; kickBus → kickShelf → kickLP → driveIn → shaper → wet → mixSum → out"),
  Bullet("Per-trigger voice: sine osc + exponential pitch sweep + amp envelope, optional triangle click burst"),
  Bullet("Lookahead scheduler: 100 ms lookahead, 25 ms tick — standard Web Audio scheduler pattern"),
  Bullet("Trigger modes: free / host / manual / hybrid"),
  Bullet("Quantize modes: instant / beat / bar"),
  Bullet("Sidechain duck via gain automation on the dry path per hit"),
  H2("Character Presets"),
  table(
    ["Preset", "Flavor"],
    [
      ["Warm", "Low shelf lift, mild drive, soft click"],
      ["Saturate", "Heavier shaper, longer body"],
      ["Punch", "Tight envelope, sharp click"],
      ["Tight", "Short decay, controlled tail"],
      ["Boom", "Long decay, deep sub bias"],
      ["Crunch", "Aggressive shaper + filtered top end"],
    ]
  ),
  H2("Patterns"),
  P("10 preset patterns exported as PATTERNS array: 4-on-the-floor, 3/4 pulse, halftime, double time, trap sparse, trap busy, sync bounce, dotted, triplet, offbeat."),
  H2("UI (EightOhEightOrb.jsx)"),
  Bullet("380 x 500 chassis, 5 px radius, TR-808 palette (#FF5A1F → #FFD23A)"),
  Bullet("Header → Transport row → Pattern grid (5x2) → 110 px Trigger Pad (click to fire, drag = velocity)"),
  Bullet("Character row (6 toggle buttons) → Sound shaping knobs (TUNE / DECAY / CLICK / DRIVE / TONE / MIX)"),
  Bullet("Bottom strip: step indicator, output meter, IN/OUT trims, input mode select, remove button"),
  Bullet("Tooltips on every control via title attribute"),

  H1("7. Integration & Registration"),
  P("Both new plugins follow rack conventions in src/main.jsx: import → add to PLUGIN_CATEGORIES → add chip-label ternary → add render branch in the instance switch. Flap Jack Man is fully wired; 808 Kick is pending registration."),
  table(
    ["Plugin", "Category Slot", "Chip Label", "Registered"],
    [
      ["Flap Jack Man", "Time", "Flap Jack", "Yes"],
      ["808 Kick", "Creative", "808", "Pending"],
    ]
  ),

  H1("8. QC Compliance Matrix"),
  table(
    ["Requirement", "Panther Buss", "Flap Jack Man", "808 Kick"],
    [
      ["Unity-baseline I/O", "Pass", "Pass", "Pass"],
      ["Zipper-free macros", "Pass", "Pass", "Pass"],
      ["Channel safety", "Pass", "Pass", "Pass"],
      ["Reactive-core hook", "Pass", "Pass", "Pass"],
      ["Output meter", "Pass", "Pass", "Pass"],
      ["Input meter", "Pass", "Partial", "Partial"],
      ["5 px chassis radius", "Pass", "Pass", "Pass"],
      ["3–6 px inner elements", "Pass", "Pass", "Pass"],
    ]
  ),

  H1("9. Outstanding Tuning"),
  Bullet("808 Kick: real DAW host transport bridge (host trigger mode currently uses internal clock fallback)"),
  Bullet("808 Kick: gate input mode is stubbed — needs envelope-follower threshold logic"),
  Bullet("808 Kick: modulate mode is stubbed — needs param-mod routing decisions"),
  Bullet("Input meter parity: bring Flap Jack Man and 808 Kick to full input-meter compliance per level_meter_requirement.md"),
  Bullet("Pattern library: validate all 10 808 patterns against breakbeat / trap reference tracks"),
  Bullet("Register 808 Kick in src/main.jsx and verify Vite reload before next commit"),

  H1("10. Git State"),
  P("Last commit: db8798d — 'Add Flap Jack Man delay plugin + integrate into rack' — 13 files, 2557 insertions. Pushed to johnstavas/NASTYvst master. The 808 Kick engine + UI files exist on disk and are ready for the next commit once main.jsx registration is verified."),
];

const doc = new Document({
  creator: "Claude",
  title: "Shags VST — QC Rack Audit",
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } }
      }],
    }],
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 220, after: 120 }, outlineLevel: 1 } },
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

Packer.toBuffer(doc).then(buf => {
  const out = path.join(__dirname, "QC_Rack_Audit.docx");
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, buf.length, "bytes");
});
