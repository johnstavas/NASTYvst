// Builds QC_Rack_Audit.docx — audit document for the QC rack system.
// Run: node scripts/build-qc-audit.js
const path = require('path');
const fs = require('fs');
const NODE_GLOBAL = 'C:\\Users\\HEAT2\\AppData\\Roaming\\npm\\node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber,
  TabStopType, TabStopPosition, PageBreak,
} = require(path.join(NODE_GLOBAL, 'docx'));

const OUT = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\QC_Rack_Audit.docx';
const MONO = 'Consolas';
const FONT = 'Arial';

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };

function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts,
    children: [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
  });
}
function H1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: false,
    spacing: { before: 360, after: 180 }, children: [new TextRun({ text, font: FONT, size: 32, bold: true })] });
}
function H1Break(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true,
    spacing: { before: 0, after: 180 }, children: [new TextRun({ text, font: FONT, size: 32, bold: true })] });
}
function H2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: FONT, size: 26, bold: true })] });
}
function H3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 }, children: [new TextRun({ text, font: FONT, size: 22, bold: true })] });
}
function Bul(text) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22 })],
  });
}
function Code(text) {
  const lines = text.split('\n');
  return lines.map(l => new Paragraph({
    spacing: { after: 0 },
    shading: { fill: 'F2F4F2', type: ShadingType.CLEAR },
    children: [new TextRun({ text: l || ' ', font: MONO, size: 18 })],
  }));
}

// Table helper. rows = [[c1,c2,...], ...]. First row is header.
function TBL(colsDxa, rows) {
  const total = colsDxa.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: colsDxa,
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((cell, j) => new TableCell({
        borders,
        width: { size: colsDxa[j], type: WidthType.DXA },
        shading: { fill: i === 0 ? 'D5E8F0' : 'FFFFFF', type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: (Array.isArray(cell) ? cell : [cell]).map(line =>
          new Paragraph({ children: [new TextRun({ text: String(line), font: FONT, size: 20, bold: i === 0 })] })
        ),
      })),
    })),
  });
}

const content = [];

// ── Title block ─────────────────────────────────────────────────────────
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 2400, after: 120 },
  children: [new TextRun({ text: 'Shags VST — QC Rack System', font: FONT, size: 44, bold: true })],
}));
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  children: [new TextRun({ text: 'Audit Document', font: FONT, size: 28, color: '555555' })],
}));
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 120 },
  children: [new TextRun({ text: 'Session build: STEP 24 → Phase 7 tooltips', font: FONT, size: 22, color: '888888' })],
}));
content.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 720 },
  children: [new TextRun({ text: 'Generated 2026-04-17', font: FONT, size: 20, color: '888888' })],
}));

// ── 1. Executive summary ────────────────────────────────────────────────
content.push(H1Break('1. Executive summary'));
content.push(P('This document audits every component built during the session that produced the QC (Quality Control) rack — an in-browser plugin-chain test environment for comparing legacy versions of Shags VST plugins against their migrated "new engine" (FxEngine / AudioWorklet) counterparts, under strict manual approval.'));
content.push(P('The rack is a self-contained tool reachable at http://127.0.0.1:5173/rack.html when the Vite dev server is running. It does not modify DSP modules. It does not auto-approve anything. The final authority on whether a new version replaces a legacy version is the user performing a studio listening test.'));
content.push(H3('What shipped this session'));
content.push(Bul('STEP 24 — Control-layer policy (UI → fx.setParam → postMessage → ParamSmoother is the only path)'));
content.push(Bul('STEP 25 — Transparency QC rule (neutral vs character-first classification; Panther Buss retuned)'));
content.push(Bul('Two git commits pushed to origin/master: Phaser WIP (3bed0fc) and the engine + Panther Buss checkpoint (04955c0)'));
content.push(Bul('QC rack (rackEngine.js, rackRegistry.js, analyzer.js, rack.html) — chain, click-safe rewire, pre/post analyzers, PUT approval workflow, QC status system with color coding, tooltips'));
content.push(Bul('MorphReverb host wrapper (morphReverbEngineNew.js) — A/B ready'));

// ── 2. Glossary / definitions ───────────────────────────────────────────
content.push(H1Break('2. Glossary — definitions'));
content.push(TBL([2500, 7000], [
  ['Term', 'Definition'],
  ['Rack', 'A main-thread JavaScript host that chains zero or more plugin engines in series between a single input and a single output gain node.'],
  ['Slot', 'One position in the rack. Holds one engine instance plus metadata (type id, version, bypassed flag).'],
  ['Engine (legacy)', 'The original per-plugin JavaScript module (e.g. src/drumBusEngine.js). Self-contained — builds its own WebAudio subgraph or private worklet. Exists for every plugin in the product catalogue.'],
  ['Engine (new)', 'A thin host wrapper (e.g. src/pantherBussEngine.js) around the unified FxEngine worklet plus a product macro file (src/core/products/*.js). Exists only for migrated plugins.'],
  ['Host contract', 'The minimum object shape every engine must return: { input, output, setBypass, dispose }. Optionally chainOutput, getOutputPeak, product-specific setters.'],
  ['FxEngine', 'The unified AudioWorklet core (src/core/dspWorklet.js) shared by every new-engine product. Built during STEPs 4–21 before this session.'],
  ['Product', 'A macro-to-module mapping file in src/core/products/ (e.g. pantherBuss.js). Owns no DSP. Wires the FxEngine chain and exposes high-level macros.'],
  ['PUT', 'Plugin Under Test. The one slot currently wrapped with pre/post analyzer taps and receiving the dedicated approval panel.'],
  ['Tap', 'Unity-gain GainNode inserted around the PUT slot (tapPre before, tapPost after). AnalyserNodes fan off the taps. Taps are stable across rewires.'],
  ['Rewire', 'Disconnect-all-then-reconnect of the rack graph whenever slot structure or PUT selection changes.'],
  ['Safe rewire', 'Rewire wrapped in a ~4 ms linear ramp-down / rewire / ramp-up on rack.output.gain to eliminate clicks when graph topology changes while audio is playing.'],
  ['QC status', 'One of five per-plugin-type states: not_started, in_qc, approved, needs_work, deferred. Persisted in localStorage. Only approved changes default-version resolution.'],
  ['Approval', 'Explicit, manual, confirm-gated user action. Sets QC status to approved for a plugin type and thereby makes the new engine the default for future inserts.'],
  ['Default version', 'The version (legacy or new) that Add to chain will use for a given plugin type. Resolved per-type from QC status; approved → new, otherwise → legacy.'],
  ['Analyzer', 'Visual-only metering cluster attached to an AudioNode. Reports waveform, peak dB, RMS dB, approximate LUFS (K-weighted), L/R peak difference, stereo correlation, clipping.'],
  ['Registry', 'Static table in src/rack/rackRegistry.js mapping plugin type IDs to legacy/new factory loaders plus approval-state helpers.'],
]));

// ── 3. Architecture ────────────────────────────────────────────────────
content.push(H1Break('3. Architecture'));
content.push(H2('3.1 Signal path'));
content.push(...Code(
`source (BufferSourceNode from user-selected file)
   │
   └─► rack.input (GainNode)
          │
          ├─► slot[0].engine.input
          │         │
          │         └─► slot[0].engine.output
          │                  │
          │                  └─► ... (more slots) ...
          │
          ├─ if slot[k] is PUT:
          │    prev → tapPre → slot[k].engine → tapPost → next
          │              │                         │
          │              └─► preAnalyzer           └─► postAnalyzer
          │                   (visual-only)             (visual-only)
          │
          └─► rack.output (GainNode)
                 │
                 └─► ctx.destination (speakers)`
));
content.push(P('Analyzers are pure fan-outs. AnalyserNodes process their input whether or not their output is connected, so no silent-pull routing is required and they do not affect the audio path.'));

content.push(H2('3.2 Module map'));
content.push(TBL([3600, 5400], [
  ['File', 'Role'],
  ['src/core/dspWorklet.js', 'Unified AudioWorklet core with 16 DSP modules. Built in STEPs 4–21. Untouched this session except for a template-literal backtick bug fix.'],
  ['src/core/fxEngine.js', 'Main-thread wrapper around the worklet. Owns setParam / setChain / setEngineMix and the postMessage boundary. STEP 24 added a finite-value guard.'],
  ['src/core/products/*.js', 'Product macro mappings. Pure composition, no DSP. Panther Buss tuned per STEP 25. MorphReverb untouched.'],
  ['src/pantherBussEngine.js', 'Host wrapper: FxEngine + Panther Buss product + host contract. Added this session.'],
  ['src/morphReverbEngineNew.js', 'Host wrapper: FxEngine + MorphReverb product + host contract. Added in Phase 5.'],
  ['src/*Engine.js (other)', 'Legacy per-plugin engines. All untouched. 35+ files. Each satisfies the same host contract.'],
  ['src/rack/rackEngine.js', 'Rack host. Ordered slot list, safe-rewire, tap nodes, PUT selection, replace-slot.'],
  ['src/rack/rackRegistry.js', 'Plugin type registry + localStorage-backed approval / QC-status store.'],
  ['src/rack/analyzer.js', 'Visual-only metering cluster (peak, RMS, LUFS~, L/R, correlation).'],
  ['rack.html', 'Self-contained UI. File picker, play/stop, rack bypass, plugin picker, chain list, PUT panel, analyzer panels.'],
  ['panther.html', 'Earlier single-plugin test page from Phase 0. Kept for Panther Buss focused testing.'],
]));

// ── 4. Governing policies ──────────────────────────────────────────────
content.push(H1Break('4. Governing policies'));

content.push(H2('4.1 STEP 24 — Control-layer policy'));
content.push(P('Formalised before rack work began. Codifies the one-way flow of parameter changes:'));
content.push(...Code(`UI (main thread) → fx.setParam(module, name, value)
                → postMessage  (main→worklet, structured clone)
                → ParamSmoother.setTarget (audio thread)
                → per-sample or per-block smoothing
                → DSP module consumes smoothed value`));
content.push(Bul('No UI thread writes DSP state directly.'));
content.push(Bul('No audio thread posts back for control.'));
content.push(Bul('fx.setParam gained a symmetric finite-value guard so NaN / ±Infinity from UI cannot poison the smoother.'));

content.push(H2('4.2 STEP 25 — Transparency QC rule'));
content.push(P('Product-level behaviour policy. Every plugin declares a class and must pass the matching default-state checklist.'));
content.push(H3('Neutral plugins — required at defaults'));
content.push(Bul('ON + defaults is audibly indistinguishable from bypass.'));
content.push(Bul('No saturator drive, no compressor GR > ~0.1 dB, shelves at 0 dB, no level change.'));
content.push(Bul('Dry/wet paths phase-aligned (no uncompensated latency in the wet chain).'));
content.push(Bul('Bypass A/B: < 0.25 dB RMS delta, < 1 dB peak delta on program material.'));
content.push(H3('Character-first plugins — required at defaults'));
content.push(Bul('Baseline coloration is subtle: ≤ ~3 dB drive, ≤ ~2 dB GR, ≤ ±1.5 dB tonal tilt.'));
content.push(Bul('Output level matched to input ±1 dB RMS.'));
content.push(Bul('No harsh artifacts at any legal setting.'));
content.push(Bul('Stable under rapid automation and extreme settings.'));
content.push(P('Panther Buss compliance: reclassified as character-first; defaults tuned drive 0.30 → 0.10 (~+2.8 dB sat), glue 0.40 → 0.20 (~1 dB GR). Memory doc: memory/STEP25_transparency_qc_rule.md.'));

content.push(H2('4.3 Manual-only approval rule'));
content.push(P('Written into the registry as an immutable comment block. No metric, threshold, correlation, LUFS delta, or any other analyzer output ever calls approve(). The only call site is the Approve button in rack.html, which is further gated by window.confirm().'));

// ── 5. Phase-by-phase log ──────────────────────────────────────────────
content.push(H1Break('5. Phase-by-phase build log'));

const phases = [
  {
    h: 'Phase 0 — Git checkpoint',
    body: [
      'Separated Phaser WIP into its own commit (3bed0fc), then landed the engine + Panther Buss checkpoint (04955c0) — 65 files, +26,181 / −1,790.',
      'Both pushed to origin/master at https://github.com/johnstavas/NASTYvst.git.',
    ],
    files: [],
  },
  {
    h: 'Phase 1 — Rack skeleton',
    body: [
      'Goal: chain arbitrary plugin engines for A/B listening tests.',
      'Design: ordered slot array, disconnect-all-then-rewire on every structural change. O(n) slots, negligible for QC and simpler than surgical edits.',
      'Registry exposed a flat list; every entry had a lazy dynamic import() loader so unused engines did not load at startup.',
    ],
    files: ['src/rack/rackEngine.js (new)', 'src/rack/rackRegistry.js (new)', 'rack.html (new)'],
  },
  {
    h: 'Phase 1.5 — Click safety',
    body: [
      'Every public mutator (addSlot, removeSlot, moveSlot, setSlotBypass, setRackBypass, setPUT, replaceSlot) wraps its _rewire() call in _safeRewire().',
      '_safeRewire sequence: cancelScheduledValues → setValueAtTime(current) → linearRampToValueAtTime(0, +4 ms) → setTimeout(5 ms) → _rewire() → setValueAtTime(0) → linearRampToValueAtTime(1, +4 ms).',
      'Coalesces bursts: if a second mutation arrives inside the window, it extends the mute but does not schedule a second rewire.',
      'removeSlot / replaceSlot defer the old engine.dispose() by 20 ms so reverb/delay tails are not cut mid-fade.',
    ],
    files: ['src/rack/rackEngine.js (modified)'],
  },
  {
    h: 'Phase 2 — Analyzer system',
    body: [
      'Two stable unity-gain GainNodes tapPre / tapPost inserted around the PUT slot during rewire.',
      'analyzer.js attaches three AnalyserNodes to any source: mono (waveform + peak + RMS), stereo split via ChannelSplitter (L and R peaks + correlation), K-weighted branch (HPF 38 Hz → highshelf +4 dB @ 1.5 kHz → AnalyserNode) for momentary-LUFS approximation.',
      'LUFS approximation: -0.691 + 10·log10(mean(x²)). Labelled "LUFS~" in the UI because it is not a certified meter.',
      'Clip indicator fires on peak ≥ 0.999 with 300 ms hold.',
    ],
    files: ['src/rack/analyzer.js (new)', 'src/rack/rackEngine.js (tap insertion)', 'rack.html (analyzer panels)'],
  },
  {
    h: 'Phase 3 — PUT + approval workflow',
    body: [
      'Registry reshaped to type-based entries: each type has legacy and/or nu (new) factory loaders.',
      'Added rack.replaceSlot(slotId, factory, meta) — swaps an engine in place, preserving slot id / position / PUT selection.',
      'PUT panel: LEGACY / NEW toggle, Approve New Version (confirm-gated), Revert to Legacy.',
      'Approval flag stored in localStorage["shagsvst.rack.approved.v1"] as { [typeId]: true }.',
      'resolveDefaultVersion(typeId): nu if type.nu && isApproved, else legacy. Fresh installs always resolve to legacy.',
    ],
    files: ['src/rack/rackEngine.js (replaceSlot)', 'src/rack/rackRegistry.js (reshape)', 'rack.html (PUT panel)'],
  },
  {
    h: 'Phase 3.5 — Strict manual-approval reinforcement',
    body: [
      'Added a STRICT MANUAL APPROVAL RULE comment block in rackRegistry.js documenting the invariant.',
      'Added window.confirm() gate on the Approve button in rack.html so a single accidental click cannot flip the default.',
    ],
    files: ['src/rack/rackRegistry.js (comment)', 'rack.html (confirm dialog)'],
  },
  {
    h: 'Phase 4 — QC status system with colors',
    body: [
      'Five statuses per plugin type: not_started (gray), in_qc (blue), approved (green), needs_work (red), deferred (yellow).',
      'New localStorage key: shagsvst.rack.qcStatus.v1. Shape: { [typeId]: statusString }. Missing = not_started.',
      'Migration: on first read, any entries from the legacy boolean approval store are folded in as status=approved. Legacy key left in place for rollback.',
      'isApproved / approve / revert are now thin wrappers over getStatus / setStatus. Single source of truth.',
      'UI: colored dot in every slot row, colored pill in PUT panel, status symbol in picker (○ ◐ ● ✕ ▷).',
      'Buttons: Start QC, Approve New Version, Mark Needs Work, Defer / Skip, Revert to Legacy.',
    ],
    files: ['src/rack/rackRegistry.js (status store + constants)', 'rack.html (colors + buttons)'],
  },
  {
    h: 'Phase 5 — MorphReverb host wrapper',
    body: [
      'Built src/morphReverbEngineNew.js following the exact pattern of pantherBussEngine.js.',
      'Exposes the 8 MorphReverb macros (morph, size, decay, tone, density, warp, width, mix) plus setBypass, getOutputPeak, dispose.',
      'No scale conversion: legacy UI sends 0–100, new product expects 0–1. Flagged for UI-layer QC later, not relevant to rack-level A/B at defaults.',
      'Registry entry for morphReverb now carries both legacy and nu loaders; NEW button in PUT panel becomes enabled.',
    ],
    files: ['src/morphReverbEngineNew.js (new)', 'src/rack/rackRegistry.js (nu loader added)'],
  },
  {
    h: 'Phase 6 — Empty-chain silence fix',
    body: [
      'User report: audio not playing in rack.html. Investigation traced to rack constructor never calling _rewire(), so an empty chain had no input→output connection.',
      'Fix: added a single _rewire() call at the end of createRack() before return. Added console.log lines on rack construction and on Play click to confirm the graph.',
      'Play console output confirms src → rack.input → N slot(s) → rack.output → ctx.destination and current rack.output.gain.',
    ],
    files: ['src/rack/rackEngine.js (init rewire + log)', 'rack.html (play log)'],
  },
  {
    h: 'Phase 7 — Tooltips',
    body: [
      'First attempt used native HTML title="..." — user could not see them (1–2 s hover delay).',
      'Replaced with CSS data-tip tooltips using ::after + ::before pseudo-elements. Appear ~150 ms after hover with a pointer arrow.',
      'Applied to: Set PUT / Clear PUT, ▲ ▼ (move), Bypass / Enable, ✕ (remove), LEGACY, NEW, Start QC, Approve New Version, Mark Needs Work, Defer / Skip, Revert to Legacy.',
    ],
    files: ['rack.html (CSS + data-tip attributes)'],
  },
];

for (const ph of phases) {
  content.push(H2(ph.h));
  for (const b of ph.body) content.push(P(b));
  if (ph.files.length) {
    content.push(H3('Files touched'));
    for (const f of ph.files) content.push(Bul(f));
  }
}

// ── 6. Data stores ─────────────────────────────────────────────────────
content.push(H1Break('6. Data stores — how state is persisted'));
content.push(P('All state lives in the browser — no server, no config file, no build step. Two localStorage keys:'));

content.push(H2('6.1 QC status store (primary)'));
content.push(P('Key: shagsvst.rack.qcStatus.v1'));
content.push(P('Shape: JSON object keyed by plugin-type ID. Missing keys mean not_started.'));
content.push(...Code(`{
  "drumbus":      "approved",
  "la2a":         "needs_work",
  "tapeDelay":    "deferred",
  "morphReverb":  "in_qc"
}`));
content.push(H3('Value constraints'));
content.push(Bul('status ∈ { "not_started", "in_qc", "approved", "needs_work", "deferred" }'));
content.push(Bul('setStatus refuses to write status="approved" if the type has no nu (new) factory.'));
content.push(Bul('setStatus(typeId, "not_started") deletes the key so the object does not accumulate dead entries.'));
content.push(H3('Write path'));
content.push(P('Only setStatus() writes this key. It is called from exactly five button handlers in rack.html: Start QC, Approve New Version, Mark Needs Work, Defer / Skip, Revert to Legacy. No metric, analyzer output, or automated process calls setStatus.'));

content.push(H2('6.2 Legacy approval store (read-only, migration only)'));
content.push(P('Key: shagsvst.rack.approved.v1'));
content.push(P('Shape: { [typeId]: true }. Created by Phase 3 before the QC status system existed.'));
content.push(P('On first read of the QC status store, any "true" entries here are folded into the new store as status="approved". The legacy key is never written again but is kept on disk as a rollback anchor.'));

content.push(H2('6.3 Rack runtime state (in-memory only)'));
content.push(P('Per slot, held in the rack closure:'));
content.push(...Code(`{
  id:       "slot_3",        // unique per rack instance
  kind:     "drumbus",       // plugin type id from registry
  version:  "nu",             // "legacy" | "nu"
  engine:   { input, output, setBypass, dispose, ... },
  bypassed: false,
}`));
content.push(P('Additional rack-level state: rackBypassed (bool), putId (string | null), tapPre / tapPost (GainNode), idSeq (int). None persisted.'));

// ── 7. QC status reference ─────────────────────────────────────────────
content.push(H1Break('7. QC status reference'));
content.push(TBL([1800, 1400, 1800, 1400, 3000], [
  ['Status', 'Symbol', 'Color', 'Default version', 'Meaning'],
  ['not_started', '○', 'Gray #777', 'legacy', 'Never reviewed. Initial state for every plugin type.'],
  ['in_qc', '◐', 'Blue #5aa0ff', 'legacy', 'Currently under review. Soft flag; no behavior change beyond visibility.'],
  ['approved', '●', 'Green #7fff8f', 'new', 'Studio-listened and approved. Only state that flips default to the new engine.'],
  ['needs_work', '✕', 'Red #ff5a5a', 'legacy', 'Listened, not acceptable. Legacy remains the default. Requires the plugin to have a new version.'],
  ['deferred', '▷', 'Yellow #ffd24a', 'legacy', 'Skipped for now. Come back to it later. Legacy remains the default.'],
]));

content.push(H2('State transitions'));
content.push(...Code(`                           ┌──────────────┐
                           │ not_started  │  (initial / after revert)
                           └──────┬───────┘
                                  │ Start QC
                                  ▼
                           ┌──────────────┐
                           │    in_qc     │
                           └──────┬───────┘
           ┌──────────────┬──────┼────────────────┐
           │              │      │                │
  Mark Needs Work   Defer/Skip  Approve New   (Start QC is a no-op)
           │              │      │
           ▼              ▼      ▼
    ┌────────────┐ ┌──────────┐ ┌──────────┐
    │ needs_work │ │ deferred │ │ approved │  → default = new
    └─────┬──────┘ └────┬─────┘ └────┬─────┘
          │             │            │ Revert to Legacy
          │             │            ▼
          └──────┬──────┴─→  not_started`));

// ── 8. Host contract ───────────────────────────────────────────────────
content.push(H1Break('8. Host contract reference'));
content.push(P('Every engine (legacy or new) returned by a factory function must satisfy:'));
content.push(...Code(`{
  input:       AudioNode,          // entry point for audio into the plugin
  output:      AudioNode,          // exit point for processed audio
  chainOutput: AudioNode,          // optional. Falls back to output if absent.
  setBypass:   (on: boolean) => void,
  dispose:     () => void,         // disconnect + free resources

  // Optional, for visualisation:
  getOutputPeak: () => number,     // rAF-rate smoothed peak

  // Plugin-specific setters (e.g. setDrive, setMix, setSize, ...)
  ...
}`));
content.push(P('The rack treats every engine as opaque. It only ever reads input / output / chainOutput, and calls setBypass / dispose. Plugin-specific setters are never called by the rack — they are reserved for future per-plugin UI work (control panels), which is out of scope for this session.'));

// ── 9. Signal integrity tests ──────────────────────────────────────────
content.push(H1Break('9. Analyzer reference'));
content.push(P('The createAnalyzer(ctx, sourceNode) function attaches three measurement branches in parallel, all fan-outs — the audio path is untouched.'));
content.push(TBL([2400, 2800, 4200], [
  ['Branch', 'Topology', 'Reports'],
  ['Mono', 'source → AnalyserNode (fftSize 2048, smoothing 0)', 'wave buffer, peak (with 0.93 decay hold), RMS'],
  ['L / R', 'source → ChannelSplitter → AnalyserNode×2', 'per-channel peak, L−R difference, correlation = Σ(L·R)/√(ΣL²·ΣR²)'],
  ['K-weighted', 'source → HPF@38 Hz → HighShelf +4 dB @ 1.5 kHz → AnalyserNode', 'momentary LUFS≈ = -0.691 + 10·log10(meanSquare)'],
]));
content.push(P('The K-weighting chain is a well-known approximation, not a certified BS.1770 meter. It is sufficient for eyeballing loudness deltas across a plugin during A/B.'));

// ── 10. File inventory ────────────────────────────────────────────────
content.push(H1Break('10. File inventory'));
content.push(H2('10.1 New files created this session'));
content.push(TBL([4200, 5200], [
  ['Path', 'Purpose'],
  ['src/rack/rackEngine.js', 'Rack host: slots, safe rewire, taps, PUT, replace-slot.'],
  ['src/rack/rackRegistry.js', 'Type-based registry + localStorage-backed QC status store.'],
  ['src/rack/analyzer.js', 'Visual metering cluster (waveform, peak, RMS, LUFS~, L/R, corr).'],
  ['rack.html', 'QC rack UI: chain, PUT panel, analyzers, tooltips.'],
  ['src/morphReverbEngineNew.js', 'New-engine MorphReverb host wrapper.'],
  ['scripts/build-qc-audit.js', 'Generator for this audit document.'],
]));

content.push(H2('10.2 Existing files modified this session'));
content.push(TBL([4200, 5200], [
  ['Path', 'Change summary'],
  ['src/core/fxEngine.js', 'Added symmetric finite-value guard in setParam (STEP 24).'],
  ['src/core/products/pantherBuss.js', 'Defaults tuned per STEP 25 (drive 0.30→0.10, glue 0.40→0.20). Limiter lookahead pinned at 0.'],
  ['src/main.jsx', 'drumbus slot flipped to createPantherBussEngine. Out of scope for rack, still live in main app.'],
  ['src/core/dspWorklet.js', 'Fixed three unescaped backticks in comments that terminated the WORKLET_SOURCE template literal.'],
]));

content.push(H2('10.3 Files unchanged (for reference)'));
content.push(P('All legacy *Engine.js files remain untouched. The migration audit flagged 1 migrated product (Panther Buss) and 11 products ready in src/core/products/ without host wrappers. MorphReverb gained its wrapper this session; the other 10 are still legacy-only in the rack.'));

// ── 11. How to run ────────────────────────────────────────────────────
content.push(H1Break('11. How to run'));
content.push(...Code(`# From the Shags VST project root
npm run dev

# Then open in Chrome:
http://127.0.0.1:5173/rack.html`));
content.push(P('On page load the console logs confirm the graph is live:'));
content.push(...Code(`[rack] constructed. graph: {...} input→output passthrough active (empty chain)
[rack.html] ctx.state = suspended | rack.output → ctx.destination connected`));
content.push(P('Click Play and the console confirms the signal path:'));
content.push(...Code(`[rack.html] Play clicked. ctx.state = running
[rack.html] audio graph: src → rack.input → N slot(s) → rack.output → ctx.destination`));

content.push(H2('QC workflow (end-to-end)'));
const workflow = [
  'Load an audio file (file input at top).',
  'Add a plugin with both versions (Drum / Panther Buss, Morph Reverb). It inserts as legacy by default.',
  'Set PUT on that slot — pre/post analyzers appear below the chain.',
  'Click Play. Audio now flows src → rack.input → PUT → rack.output → destination with analyzer fan-outs on the taps.',
  'Click Start QC (optional; blue status is a visual reminder).',
  'A/B LEGACY vs NEW in the PUT panel. Rack mutes for ~8 ms around each switch.',
  'Listen. Compare meters. Decide.',
  'Outcome: Approve New Version (confirm dialog) → status green, default flips, slot switches to new. OR Mark Needs Work (red) / Defer / Skip (yellow) → legacy stays default.',
  'Close browser. Reload. All statuses persist. Pick up where you left off.',
];
for (const s of workflow) content.push(Bul(s));

// ── 12. Open items ────────────────────────────────────────────────────
content.push(H1Break('12. Known limitations and open items'));
content.push(Bul('Rack exercises plugins at defaults only. No per-plugin control surface. Control-level QC still requires the main app UIs.'));
content.push(Bul('Only two plugin types currently support A/B: drumbus (Panther Buss) and morphReverb. Other 10 migrated products need host wrappers before they can be A/B tested in the rack.'));
content.push(Bul('LUFS reading is an approximation, not a certified BS.1770 meter. Good for deltas, not for absolute loudness targets.'));
content.push(Bul('Scale conversion between legacy UI ranges (0–100) and new product ranges (0–1) is not applied in the MorphReverb wrapper. Relevant only when the main-app Orb is repointed at the new engine — not for rack-at-defaults QC.'));
content.push(Bul('Legacy approval store (shagsvst.rack.approved.v1) is kept on disk as a rollback anchor but never written by current code.'));

// ── Build document ────────────────────────────────────────────────────
const doc = new Document({
  creator: 'Shags VST QC',
  title: 'QC Rack Audit',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, font: FONT, color: '1a1a1a' },
        paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 26, bold: true, font: FONT, color: '2a2a2a' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: FONT, color: '3a3a3a' },
        paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
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
        children: [new TextRun({ text: 'Shags VST — QC Rack Audit', font: FONT, size: 18, color: '888888' })],
      })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Page ', font: FONT, size: 18, color: '888888' }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '888888' }),
        ],
      })] }),
    },
    children: content,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf);
  console.log('Wrote', OUT, buf.length, 'bytes');
});
