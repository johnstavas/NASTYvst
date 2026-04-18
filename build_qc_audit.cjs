// Build QC_Rack_Audit.docx — NastyBeast / Flap Jack Man QC rack audit.
const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  PageOrientation,
} = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P  = (t, opts={}) => new Paragraph({ children: [new TextRun({ text: t, ...opts })] });
const B  = (t) => new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun(t)] });
const Code = (t) => new Paragraph({ children: [new TextRun({ text: t, font: "Consolas", size: 18 })] });

function row(cells, header=false) {
  return new TableRow({
    children: cells.map(c => new TableCell({
      borders,
      width: { size: Math.floor(9360 / cells.length), type: WidthType.DXA },
      shading: header ? { fill: "EAEAEA", type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: c, bold: header })] })],
    })),
  });
}
function table(headers, rows) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: headers.map(() => Math.floor(9360 / headers.length)),
    rows: [row(headers, true), ...rows.map(r => row(r))],
  });
}

const children = [
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "Shags VST — QC Rack Audit", bold: true, size: 36 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "NastyBeast / Flap Jack Man — Session Build Report", size: 22, color: "666666" })] }),
  P(""),

  H1("1. Scope"),
  P("This document audits the QC rack work performed on the NastyBeast / Flap Jack Man plugin, the reference build for the Shags VST rack. It records the I/O contract, signal chain, macro mappings, scene system, FLIP mode, visual integration, fixes applied, and outstanding items."),

  H1("2. I/O Contract"),
  B("Unity-baseline: with all macros at 0 and BEAST disengaged, output ≈ input within ±0.1 dB."),
  B("Explicit 2-channel stereo speaker topology (channelCountMode='explicit', channelInterpretation='speakers')."),
  B("inGain (post input) → engine bus; outGain (post engine) → ctx.destination."),
  B("Mono and stereo sources both supported via ChannelSplitter/Merger normalization."),

  H1("3. Signal Chain"),
  H2("3.1 Dry / Wet Topology"),
  B("Dry path: input → padDry → dryBus → mixDry → output."),
  B("Wet path: input → fangPad → [FANG dry/wet crossfade] → fangSum → preDelay → delayCore → tapMain → wetTilt → wetLP → wDelay → wet → mixWet → output."),
  B("Ghost path (haunt) tapped after delayCore, darkened by ghostPreLP/ghostPostLP."),
  B("Ping-pong cross-feedback bus running parallel to delay loop, low ceiling to prevent metallic resonance."),
  B("Glue compressor inserted on wet bus, swept by BEAST amount."),

  H2("3.2 FANG Drive Crossfade"),
  P("Eliminates quiescent distortion at FEED=0. Equal-power sin/cos crossfade between fangDryAmt and fangWetAmt, driven by feed + 0.2·beastAmt."),
  Code("const wAmt = Math.sin(fangAmt * Math.PI * 0.5);"),
  Code("const dAmt = Math.cos(fangAmt * Math.PI * 0.5);"),

  H2("3.3 Delay & Saturation Warmth Pass"),
  B("Single-tap delay output (was 3-tap cluster — comb-filtering removed)."),
  B("Wet tilt: high-shelf @3500 Hz, −3 dB; wet LP @7500 Hz, Q 0.5."),
  B("Loop LP base 3200 Hz, modulated 4500→1500 Hz with feedback amount."),
  B("FANG curve k softened 3 → 2; fangPostLP 9000 → 5500 Hz."),
  B("Ghost path: ghostPreLP @2400 Hz, ghostPostLP @1800 Hz; ghostGain ceiling 0.14."),
  B("wDouble removed from wet bus (was comb-filtering vs dry on MIX sweeps)."),

  H1("4. Macros"),
  table(
    ["UI Label", "Internal", "Function"],
    [
      ["SIZZLE", "feed",   "Drive into FANG, gates wet/dry crossfade"],
      ["STACK",  "roam",   "Delay feedback amount + loop LP sweep"],
      ["DRIZZLE","haunt",  "Ghost-path send (darkened reverb-tail flavor)"],
      ["FLUFF",  "breath", "Pre-delay + air shelf"],
      ["CRISP",  "snarl",  "Wet-side bite / character"],
      ["BUTTER", "spread", "Stereo width on wet bus"],
    ]
  ),
  P("MIX default: 0.35. All macro setters use setTargetAtTime with TAU ≈ 0.012s (zipper-free)."),

  H1("5. Scene System (BPM-Quantized)"),
  P("Scenes: BUTTER, SYRUP, GRIDDLE. Click queues a scene change; engine waits for next downbeat then morphs over one bar at current BPM with smoothstep ease."),
  B("Wait time = beatLen − sinceBeat (snaps to next beat)."),
  B("Morph duration = 4 × beatLen (one bar)."),
  B("ROAM dip mid-morph (parabolic) prevents feedback overshoot during transitions."),

  H1("6. FLIP Mode"),
  B("Tight glue compression engaged on wet bus: threshold sweeps −3 → −20 dB, ratio 1.5 → 5.0, attack 3 ms, release 60 ms, knee 4 dB."),
  B("Soft chorus modulation: single-source delay, depth 0.0035s, rate 0.55 Hz, wet up to 0.22."),
  B("RMS makeup clamp tightened to [0.6, 1.3] with r > 0.005 gate to avoid blowups on transient sources."),
  B("Visual: pancakes flip (cosine scaleY swing + parabolic vertical lift), syrup downpour spawned over the plate, fork/knife tilt with energy."),

  H1("7. BPM"),
  H2("7.1 Manual Input"),
  P("Local string state (bpmInput) decoupled from clamped numeric BPM. Commit on blur or Enter — no per-keystroke clamping (fixes 'stuck while typing 120' bug)."),
  H2("7.2 Auto-Detect"),
  B("Onset detector on transient envelope with adaptive floor (0.997 decay, raised to 55% of last peak)."),
  B("Inter-onset intervals (180–1500 ms) collected in 16-deep ring buffer."),
  B("Median interval → BPM, octave-folded into 70–180 range, snapped to integer."),
  B("Updates BPM only if delta ≥ 1 and last update > 500 ms ago. Resets beat phase to onset time."),

  H1("8. Flap Jack Visual Integration"),
  B("Face removed from pancakes. Audio-first envelopes drive all motion."),
  B("Per-cake envelope refs: { punch (45 ms atk / 380 ms rel), low (90 ms / 500 ms), bright (180 ms one-pole) }."),
  B("Beat clock: cakeIdx % 4 === beatBar → strong bob on this beat (round-robin)."),
  B("Real flips (FLIP engaged + on-beat): cosine scaleY 1 → −1 → 1 with parabolic lift."),
  B("Background: 8 butter people in fixed positions, smiley faces, butter-stick arms, brown shoes."),
  B("Foreground: fork (4 tines) + knife (tapered blade), tilt with energy + beatPulse."),
  B("Plate: solid radial gradient (no alpha) with darker rim shadow."),
  B("Knob glow removed."),

  H1("9. Fixes Applied This Session"),
  table(
    ["Symptom", "Root Cause", "Fix"],
    [
      ["MIX phase errors", "wDouble in wet bus comb-filtered against dry", "Removed wDouble from wet path"],
      ["Distortion at FEED=0", "Wet always passed through tanh shaper", "FANG dry/wet equal-power crossfade"],
      ["Metallic delay sound", "3-tap delay cluster + bright filters", "Single tap, wet tilt −3 dB @3500, LP @7500, darker ghosts"],
      ["Scene clicks chaotic", "Hard 600 ms morph spiked all macros", "BPM-quantized 1-bar morph + smoothstep + ROAM dip"],
      ["Pancakes random", "Autonomous Math.sin(t) wobbles", "Replaced with envelope followers on live audio"],
      ["FLIP comp crash", "Attack 1 ms / ratio 8 / clamp [0.4,1.6]", "Walked back to 3 ms / ratio 5 / clamp [0.6,1.3]"],
      ["BPM input stuck typing", "Per-keystroke clamp to 40–240", "Local string state, commit on blur/Enter"],
    ]
  ),

  H1("10. Outstanding — Level Meter Compliance"),
  P("A new global plugin standard was added this session (memory/level_meter_requirement.md). It mandates input + output meters on every plugin in the rack. Flap Jack Man currently has only an output AnalyserNode and is non-compliant. Required to bring to spec:"),
  B("Add dedicated input AnalyserNode tapped post-inGain."),
  B("Peak follower with ≤5 ms attack, 150–300 ms release on both taps."),
  B("Clip latch: peak ≥ 0.99 sets clipUntil = now + 500 ms; visual hold for that window."),
  B("Expressive integration (per spec example): top pancake browning intensity = output level; plate glow = input level; clip = syrup splash burst."),
  B("Readable meter: always-visible dBFS-referenced bar/numeric for QC."),
  B("Apply same standard retroactively to Panther Buss, vocal/reverb suite."),

  H1("11. Outstanding — Other"),
  B("One-shot upload crash: simplified chorus path and tightened RMS clamp as defensive measures; awaiting user diagnostic on what 'crash' looks like (page crash vs audio dropout vs UI freeze)."),
  B("Verify auto-BPM tracker on sparse / non-percussive material (current detector tuned for transient-rich loops)."),

  H1("12. Preservation Principles"),
  B("Unity-baseline I/O contract — never violated."),
  B("Zipper-free macro modulation — all params via setTargetAtTime."),
  B("Mono/stereo channel safety — explicit speaker topology throughout."),
  B("Reactive-core hook — engine exposes input/output for visual signal taps."),
  B("Level metering (NEW) — input + output meters on every plugin, expressive + readable."),
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 30, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "444444" },
        paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [{
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]
    }]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      }
    },
    children,
  }]
});

Packer.toBuffer(doc).then(buf => {
  const out = "C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx";
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, buf.length, "bytes");
});
