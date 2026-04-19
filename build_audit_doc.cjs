const fs = require('fs');
const path = require('path');
const docxPath = 'C:\\Users\\HEAT2\\AppData\\Roaming\\npm\\node_modules\\docx';
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageOrientation } = require(docxPath);

const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t) => new Paragraph({ children: [new TextRun(t)] });
const B  = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(t)] });
const Code = (t) => new Paragraph({ children: [new TextRun({ text: t, font: "Consolas", size: 18 })] });

function table(headers, rows) {
  const colCount = headers.length;
  const totalW = 9360;
  const colW = Math.floor(totalW / colCount);
  const cols = Array(colCount).fill(colW);
  const mkCell = (txt, shade) => new TableCell({
    borders,
    width: { size: colW, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    shading: shade ? { fill: "E8E8E8", type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(txt), bold: !!shade })] })]
  });
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: cols,
    rows: [
      new TableRow({ children: headers.map(h => mkCell(h, true)) }),
      ...rows.map(r => new TableRow({ children: r.map(c => mkCell(c, false)) })),
    ],
  });
}

const children = [
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "QC Rack System — Session Audit", bold: true, size: 40 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Shags VST  ·  Phase 1 Reactive Core + NastyBeast Reference Plugin", italics: true, size: 22, color: "666666" })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "2026-04-17", size: 20, color: "888888" })] }),
  P(""),

  H1("1. Executive Summary"),
  P("This session formalized the Shags VST QC rack with three structural additions: a global rack-level Input Pad, a non-invasive Reactive Core layer for audio-reactive UI, and a flagship reference plugin (NastyBeast) that establishes the mandatory IN/OUT/MIX/BYPASS standard for all future plugins. Existing Orbs were preserved; new conventions apply forward."),
  P(""),

  H1("2. Rack-Level Input Pad"),
  P("A global gain pad sits between the shared source and the first plugin in the chain. It is rack-wide, not per-plugin, and is intended for QC headroom control."),
  H3("Specification"),
  B("Values: 0 dB, -5 dB, -10 dB (default 0 dB in main rack; -10 dB in NastyBeast standalone for safety)"),
  B("Position: sharedSource.outputNode → inputPad → chain[0].input"),
  B("Implementation: single GainNode created on first wire, gain = 10^(dB/20)"),
  B("UI: 3-button selector in the rack header, ember active-state highlight"),
  H3("File"),
  Code("src/main.jsx — inputPadDb state, inputPadRef GainNode, rewire effect"),
  P(""),

  H1("3. Reactive Core Layer"),
  P("Lightweight, opt-in helper that provides a uniform set of audio-reactive signals to any Orb without forcing existing plugins to refactor. One requestAnimationFrame loop per instance."),
  H3("Signals"),
  table(
    ["Signal", "Source", "Behavior"],
    [
      ["energy",    "engineRef.getOutputPeak()",       "One-pole IIR smoothed peak (alpha 0.18)"],
      ["pulse",     "time-driven sinusoids",            "Sum of slow (2.4 Hz) and mid (7.0 Hz) sines"],
      ["rage",      "drive parameter",                  "Power S-curve (threshold 0.08, range 0.55, curve 0.7)"],
      ["boom",      "engineRef.getBassLevel()",         "Asymmetric attack 0.95 / release 0.12"],
      ["transient", "engine getTransient or derived",   "Peak minus smoothed RMS, rising-edge useful"],
    ]
  ),
  H3("Files"),
  B("src/reactive/useReactiveCore.js — hook with signalsRef, setDrive, setOnTick"),
  B("src/reactive/reactiveTestEngine.js — minimal tanh-drive validation engine"),
  B("src/reactive/ReactiveTestOrb.jsx — single-surface validation shell with 5 readout bars"),
  B("src/reactiveTestStandalone.jsx + reactiveTest.html — standalone mount"),
  H3("Validation Outcome"),
  B("Pulse breathes correctly at idle"),
  B("Rage is parameter-driven (audible/visible with no audio)"),
  B("Boom asymmetric envelope reads cleanly on kick loop"),
  B("Transient fallback derivation works when engine does not supply"),
  P(""),

  H1("4. NastyBeast — Reference Plugin"),
  P("Flagship internal test plugin, Phase 1. Establishes both the reactive-core integration pattern and the universal IN/OUT/MIX/BYPASS standard."),

  H2("4.1 Signal Architecture"),
  Code("input → bypassTap"),
  Code("      → inGain → chainIn → [body] → FANG → SHIVER → ECHO → AURA"),
  Code("                        → dry tap, wet tap"),
  Code("                        → dry*(1-mix) + wet*mix"),
  Code("→ outGain → output"),

  H2("4.2 DSP Blocks"),
  table(
    ["Block", "Topology", "Purpose"],
    [
      ["FANG",   "preTilt → tanh shaper (2048-sample LUT) → deTilt → LP @ 7-9 kHz → makeup", "Asymmetric saturation, drive character"],
      ["SHIVER", "3 ConstantSource detune voices + 2 LFOs into DelayNode.delayTime",          "Modulated chorus / shiver"],
      ["ECHO",   "2 Schroeder allpass diffusers → stereo dual-tap (420/510 ms) → cross-feedback with tanh soft-sat + LP damp", "Diffuse stereo echo"],
      ["AURA",   "4 parallel LP-damped comb feedback delays → 2 series allpasses",            "Lite FDN reverb, supportive ambience"],
    ]
  ),

  H2("4.3 Macros (5)"),
  table(
    ["Macro", "Targets"],
    [
      ["FEED",   "FANG drive (× 0.55)"],
      ["SNARL",  "FANG asymmetry (× 0.45, symmetric at 0)"],
      ["ROAM",   "SHIVER depth 0.12–0.72 ms"],
      ["HAUNT",  "ECHO send (× 0.35), feedback clamped ≤ 0.85"],
      ["BREATH", "AURA wet 0.03 + b·0.30"],
    ]
  ),

  H2("4.4 Scenes"),
  table(
    ["Scene",  "feed", "snarl", "roam", "haunt", "breath"],
    [
      ["TIDE",  "0.10", "0.00",  "0.20", "0.18",  "0.45"],
      ["FERAL", "0.55", "0.65",  "0.55", "0.50",  "0.35"],
    ]
  ),
  P("Scene morphing: requestAnimationFrame interpolation with ease-in-out over 600 ms. Each scene also re-tunes reactive-core options (pulse frequencies, rage curve)."),

  H2("4.5 Beast Mode"),
  B("Momentary hold (BEAST button pointer-down/up, Spacebar)"),
  B("One-pole envelope: attack τ = 80 ms, release τ = 250 ms"),
  B("Adds harmonic density / weight / pressure — not raw gain"),
  B("RMS compensation: 30 Hz setInterval reads analyser, 0.5 s history, trims beastTrim.gain toward refRms/currentRms (clamped 0.4–1.6) via setTargetAtTime"),

  H2("4.6 Universal IN / OUT / MIX / BYPASS Standard"),
  P("Mandatory for every future plugin. NastyBeast is the reference implementation."),
  B("Topology: input → (bypassGain | inGain → chain → dry/wet taps) → dry/wetGain/bypassGain → mixSum → outGain → output"),
  B("Crossfade is equal-amplitude:  out = dry · (1 - mix) + wet · mix"),
  B("Bypass uses dedicated pre-IN-gain tap so audio truly passes unmodified"),
  B("All transitions use setTargetAtTime (τ = 0.01 s) — click-free"),
  B("API: setIn(dB), setOut(dB), setMix(0..1), setBypass(bool), isBypassed()"),
  B("UI: header strip with GlobalKnob (label + value + range slider, double-click resets to 0 dB / 100 % MIX), BYPASSED / ACTIVE pill"),

  H2("4.7 Visual System"),
  B("SVG creature: asymmetric oval body, spine curve, eye, ghost trail container"),
  B("Body fill = lerp(teal → ember, rage); alpha = energy; scale = boom + transient"),
  B("4-layer drop-shadow bloom driven by heat = energy + pulse · rage · 1.5"),
  B("Eye turns bile-green on transient × rage"),
  B("Ghost trail spawns on transient rising edge > 0.08"),

  H2("4.8 Files"),
  B("src/nastybeast/nastyBeastEngine.js"),
  B("src/nastybeast/NastyBeastOrb.jsx"),
  B("src/nastyBeastStandalone.jsx"),
  B("nastyBeast.html"),
  P(""),

  H1("5. Gain-Staging Fixes"),
  P("Initial NastyBeast build was harsh and clipping. The following changes brought it inside safe headroom while preserving character:"),
  B("Default input pad set to -10 dB in standalone mount"),
  B("FANG shaper: k = 1 + d·8 (was 22); makeup gain = 1 / (1 + d·1.6)"),
  B("FANG asym scaling × 0.5; default SNARL = 0 (fully symmetric)"),
  B("Post-FANG LP @ 7 kHz to tame fizz"),
  B("Pre-ECHO attenuation 0.6 → 0.35; feedback clamped ≤ 0.85 with tanh soft-sat in loops; LP damp @ 5 kHz"),
  B("Pre-AURA dry 1.0 → 0.45; AURA wet 0.55 → 0.30"),
  B("Default TIDE FEED 0.20 → 0.10, SNARL 0.05 → 0.00"),
  P(""),

  H1("6. Preservation Principle"),
  P("Existing 50+ Orbs remain untouched. Reactive Core is opt-in; the IN/OUT/MIX/BYPASS standard applies to new plugins and to NastyBeast as the reference implementation. No legacy plugin was refactored in this session."),
  P(""),

  H1("7. Outstanding QC Items"),
  B("NastyBeast tonal balance: still reads thin / sharp / resonant / reverb-dominant. Pending fixes: low-mid body bell ~120-300 Hz, smoother FANG with LP @ 8-10 kHz, shorter darker AURA, tighter ECHO feedback with HP+LP in loop, narrower early stereo spread, lower default BREATH"),
  B("Roll the IN/OUT/MIX/BYPASS standard out across all new plugin builds"),
  B("Audit existing Orbs for opt-in reactive-core adoption (no forced refactor)"),
  P(""),

  H1("8. Verification Surfaces"),
  B("nastyBeast.html — flagship reference, standalone mount with built-in kick + Am7 pad loop, Spacebar = Beast"),
  B("reactiveTest.html — reactive-core validation rig, 5 signal readouts"),
  B("Main rack (src/main.jsx) — global Input Pad live with 0 / -5 / -10 dB selector"),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1A1A1A" },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2E2E2E" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "4A4A4A" },
        paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [{ reference: "bullets", levels: [{
      level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } }
    }]}]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children
  }]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx', buf);
  console.log('OK');
});
