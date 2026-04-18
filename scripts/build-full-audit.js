// Builds Shags_VST_Full_Audit.docx — full technical audit and reference.
// Run: node scripts/build-full-audit.js
//
// Data sources:
//   - scripts/audit-raw.txt : exhaustive DSP-core + product-layer audit
//     produced by an Explore agent that read src/core/dspWorklet.js,
//     src/core/fxEngine.js, and every file in src/core/products/ in full.
//   - Direct file reads: src/rack/*, src/pantherBussEngine.js,
//     src/morphReverbEngineNew.js (already in the transcript / summary).
// The script does NOT modify any source files. It only reads and writes
// QC_Full_Audit.docx alongside the existing QC_Rack_Audit.docx.

const path = require('path');
const fs = require('fs');
const NODE_GLOBAL = 'C:\\Users\\HEAT2\\AppData\\Roaming\\npm\\node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber,
} = require(path.join(NODE_GLOBAL, 'docx'));

const OUT_PATH = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\Shags_VST_Full_Audit.docx';
const RAW_PATH = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\scripts\\audit-raw.txt';

const FONT = 'Arial';
const MONO = 'Consolas';

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };

// -------- helpers --------
function P(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 100 },
    ...opts,
    children: [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
  });
}
function H1(text, brk = true) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: brk,
    spacing: { before: 0, after: 200 },
    children: [new TextRun({ text, font: FONT, size: 34, bold: true })],
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, font: FONT, size: 28, bold: true })],
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, font: FONT, size: 24, bold: true })],
  });
}
function H4(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_4,
    spacing: { before: 160, after: 60 },
    children: [new TextRun({ text, font: FONT, size: 22, bold: true, italics: true })],
  });
}
function Bul(text, level = 0) {
  // Emit bold run for any **...** segments.
  const runs = buildRunsWithBold(text);
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 40 },
    children: runs,
  });
}
function buildRunsWithBold(text) {
  // Parse **bold**, `code`, leave rest as plain. Also strip markdown markers.
  const runs = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) runs.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: 22 }));
    const tok = m[0];
    if (tok.startsWith('**')) {
      runs.push(new TextRun({ text: tok.slice(2, -2), font: FONT, size: 22, bold: true }));
    } else {
      runs.push(new TextRun({ text: tok.slice(1, -1), font: MONO, size: 20 }));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) runs.push(new TextRun({ text: text.slice(last), font: FONT, size: 22 }));
  if (runs.length === 0) runs.push(new TextRun({ text: ' ', font: FONT, size: 22 }));
  return runs;
}
function Para(text) {
  return new Paragraph({
    spacing: { after: 100 },
    children: buildRunsWithBold(text),
  });
}
function Code(text) {
  return text.split('\n').map(l => new Paragraph({
    spacing: { after: 0 },
    shading: { fill: 'F2F4F2', type: ShadingType.CLEAR },
    children: [new TextRun({ text: l.length ? l : ' ', font: MONO, size: 18 })],
  }));
}
function TBL(colsDxa, rows) {
  const totalW = colsDxa.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colsDxa,
    rows: rows.map((r, i) => new TableRow({
      children: r.map((c, j) => new TableCell({
        borders,
        width: { size: colsDxa[j], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: i === 0 ? { fill: 'E8EEE8', type: ShadingType.CLEAR } : undefined,
        children: [new Paragraph({
          spacing: { after: 0 },
          children: [new TextRun({ text: String(c), font: FONT, size: 20, bold: i === 0 })],
        })],
      })),
    })),
  });
}

// -------- parse the raw audit markdown into docx blocks --------
function parseMarkdown(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  let codeBuf = null;
  while (i < lines.length) {
    const line = lines[i];
    // Code fence
    if (/^```/.test(line)) {
      if (codeBuf == null) { codeBuf = []; i++; continue; }
      out.push(...Code(codeBuf.join('\n')));
      codeBuf = null;
      i++; continue;
    }
    if (codeBuf != null) { codeBuf.push(line); i++; continue; }

    if (/^---+\s*$/.test(line)) { i++; continue; }

    // Headings — map #/##/###/#### to H2/H3/H4/H4 since H1 is reserved for
    // numbered top-level sections authored below.
    if (/^####\s+/.test(line)) { out.push(H4(line.replace(/^####\s+/, ''))); i++; continue; }
    if (/^###\s+/.test(line))  { out.push(H3(line.replace(/^###\s+/, '')));  i++; continue; }
    if (/^##\s+/.test(line))   { out.push(H2(line.replace(/^##\s+/, '')));   i++; continue; }
    if (/^#\s+/.test(line))    { out.push(H2(line.replace(/^#\s+/, '')));    i++; continue; }

    // Bullets — count leading spaces/2 for nesting.
    const bm = line.match(/^(\s*)-\s+(.*)$/);
    if (bm) {
      const lvl = Math.min(3, Math.floor(bm[1].length / 2));
      out.push(Bul(bm[2], lvl));
      i++; continue;
    }

    if (line.trim() === '') { i++; continue; }
    out.push(Para(line));
    i++;
  }
  return out;
}

// -------- authored sections --------

function sectionOverview() {
  return [
    H1('1. SYSTEM OVERVIEW', false),
    H2('What the system is'),
    Para('Shags VST is a browser-hosted audio-effects suite written in JavaScript. Audio processing runs inside a single unified AudioWorkletProcessor (FxProcessor) that is reconfigured at runtime to host different combinations of DSP modules. Above the worklet sits a main-thread wrapper (FxEngine), a product layer that voices module combinations into named plugins, per-plugin host wrappers that adapt each product to the common host contract, a React/vanilla UI layer (the Orb components and the rack UI), and a QC rack that chains plugins for A/B listening and approval.'),
    H2('What it is designed to do'),
    Bul('Host any of the migrated products (MorphReverb, PantherBuss, PlateX, Orbit, Drift, Echoform, Gravity, NearFar, Playbox, ReverbBus, Smear, TapeDelay) inside a single shared DSP core with zero core edits per product.'),
    Bul('Run legacy per-plugin engines side-by-side with migrated products so both can be compared in a QC rack.'),
    Bul('Enforce a one-way control flow (UI \u2192 wrapper \u2192 FxEngine.setParam \u2192 postMessage \u2192 ParamSmoother) so UI code never writes DSP state directly.'),
    Bul('Provide a rack environment where plugins can be inserted, reordered, bypassed, tap-analysed, toggled between legacy and new engines, and promoted from legacy to new through a strictly manual approval step.'),
    H2('High-level architecture'),
    ...Code([
      '  UI (React Orbs, rack.html controls)',
      '        \u2193  setDrive / setMorph / setSize / ...',
      '  PRODUCT WRAPPER  (src/core/products/<name>.js)',
      '        \u2193  fx.setParam(id, value)',
      '  FxEngine          (src/core/fxEngine.js, main thread)',
      '        \u2193  worklet.port.postMessage({type:"param", ...})',
      '  FxProcessor       (src/core/dspWorklet.js, audio thread)',
      '        \u2193  ParamSmoother.setTarget(v)  \u2192  tickBlock \u2192 tickSample',
      '  DSP MODULE chain  (Delay, Reverb, Diffusion, Drive, ...)',
      '        \u2193  inL/inR \u2192 outL/outR',
      '  ENGINE WRAPPER    (src/<name>Engine.js or EngineNew.js)',
      '        \u2193  { input, output, chainOutput, setBypass, dispose }',
      '  HOST GRAPH        (App.jsx or rack.html)',
      '        \u2193  rack.input \u2192 slot0 \u2192 ... \u2192 rack.output \u2192 ctx.destination',
    ].join('\n')),
    Para('Audio is always real data flowing through Web Audio nodes. Control data is always messages over worklet ports. The two domains never cross in either direction without going through one of these four boundary objects.'),
  ];
}

function sectionControl() {
  return [
    H1('4. CONTROL SYSTEM'),
    H2('Parameter path from UI to DSP'),
    Para('All parameter changes follow a single path. There is no other supported path. This is STEP 24 in the project\'s engineering log ("Control-layer policy").'),
    ...Code([
      'UI event (slider move, button click, preset load)',
      '   \u2193',
      'Orb / rack control handler',
      '   \u2193',
      'engineWrapper.setDrive(v)  // or setMorph, setSize, etc.',
      '   \u2193',
      'product.setDrive(v)        // defined in src/core/products/<name>.js',
      '   \u2193',
      'fx.setParam(paramId, value)',
      '   \u2193',
      'worklet.port.postMessage({ type: "param", id, value })',
      '   \u2193  (audio thread)',
      'FxProcessor.onmessage  \u2192  module.params[name].setTarget(v)',
      '   \u2193',
      'per-block:   P[name].tickBlock()',
      'per-sample:  P[name].tickSample()  \u2192  read P[name].value',
    ].join('\n')),
    H2('postMessage protocol'),
    Para('All message shapes are defined in fxEngine.js and consumed by FxProcessor in dspWorklet.js. The minimum message vocabulary is:'),
    TBL([1800, 2600, 4800], [
      ['type', 'payload', 'effect'],
      ['setChain',  '{ chain: [{type, id}, ...] }', 'Replace the module chain. Processor instantiates new modules and calls prepare().'],
      ['param',     '{ id, value }',                'Route value to the matching ParamSmoother; NaN/Infinity rejected by setTarget.'],
      ['engineMix', '{ value }',                    'Set global dry/wet crossfade applied after the chain.'],
      ['bypass',    '{ on }',                       'Short-circuit the chain and emit input unchanged.'],
      ['reset',     '{}',                           'Call reset() on every module; clear all filter/delay state.'],
    ]),
    H2('ParamSmoother timing rules'),
    Bul('Two stages. Block stage: exponential approach at blockTauMs (default 25 ms). Sample stage: exponential approach at sampleTauMs (default 5 ms).'),
    Bul('Coefficient precomputed in prepare(sr, blockSize). `_aBlock = 1 - exp(-1/(blockHz \u00b7 blockTauMs/1000))`. `_aSample = 1 - exp(-1/(sr \u00b7 sampleTauMs/1000))`.'),
    Bul('setTarget(v) guarded by `Number.isFinite(v)`; non-finite values are silently dropped so an invalid UI write cannot poison the smoother.'),
    Bul('snap(v) is the only way to bypass the exponential approach and is reserved for preset loads.'),
    Bul('tickBlock() runs once per 128-sample quantum before tickSample() is called inside the inner loop.'),
    H2('Constraints and guards'),
    Bul('UI \u2192 DSP direct writes are forbidden. Orb components must never reach into engine internals; they must call the engine wrapper methods, which in turn call fx.setParam.'),
    Bul('Audio-thread \u2192 UI messages are read-only (level meters). No control data is returned from the audio thread.'),
    Bul('Preset loads snap the smoothers to avoid cross-fading across preset boundaries. Live parameter automation always uses setTarget.'),
  ];
}

function sectionWrappers() {
  return [
    H1('6. WRAPPERS / HOST INTEGRATION'),
    Para('Every engine, legacy or new, conforms to the same minimal host contract:'),
    ...Code([
      '{',
      '  input:       AudioNode,   // graph entry',
      '  output:      AudioNode,   // graph exit',
      '  chainOutput: AudioNode,   // optional; falls back to .output',
      '  setBypass(on: boolean): void,',
      '  dispose(): void,',
      '  getOutputPeak?(): number, // optional UI clip meter',
      '  // plus product-specific macros: setDrive, setGlue, setMorph, ...',
      '}',
    ].join('\n')),
    H2('Legacy wrappers (src/<name>Engine.js)'),
    Bul('Each legacy engine builds its own Web Audio graph out of BiquadFilter / DelayNode / WaveShaper / ConvolverNode primitives. There is no worklet involvement. DSP state lives in the native nodes and is driven directly by AudioParam automation.'),
    Bul('Bypass is implemented by a crossfade Gain pair or by setting a wet/dry gain; the graph topology does not change.'),
    Bul('Dispose tears down the internal nodes and disconnects from input/output.'),
    H2('New wrappers (src/<name>EngineNew.js)'),
    Para('Example: src/morphReverbEngineNew.js. These wrappers compose the unified core with a product voicing:'),
    ...Code([
      'import { createFxEngine } from \'./core/fxEngine.js\';',
      'import { createMorphReverb } from \'./core/products/morphReverb.js\';',
      '',
      'export async function createMorphReverbEngineNew(ctx) {',
      '  const fx      = await createFxEngine(ctx);       // locked-core worklet',
      '  const product = createMorphReverb(fx);           // product macros',
      '',
      '  // Peak analyser on fx.output \u2014 UI-thread clip glow only.',
      '  const analyser = ctx.createAnalyser();',
      '  analyser.fftSize = 512;',
      '  analyser.smoothingTimeConstant = 0;',
      '  fx.output.connect(analyser);',
      '',
      '  return {',
      '    input:       fx.input,',
      '    output:      fx.output,',
      '    chainOutput: fx.output,',
      '    setMorph, setSize, setDecay, setTone, setDensity, setWarp,',
      '    setWidth, setMix,',
      '    setBypass:  on => fx.setBypass(!!on),',
      '    getState:   () => product.getState(),',
      '    loadPreset: p  => product.loadPreset(p),',
      '    getOutputPeak,',
      '    dispose() { product.dispose?.(); /* + disconnect input/output/analyser */ }',
      '  };',
      '}',
    ].join('\n')),
    H2('Differences between legacy and new wrappers'),
    TBL([2400, 3200, 3200], [
      ['Aspect', 'Legacy wrapper', 'New wrapper'],
      ['DSP host',       'Native Web Audio nodes',                 'Single AudioWorklet (FxProcessor) running the module chain'],
      ['Parameter path', 'AudioParam automation',                  'fx.setParam \u2192 postMessage \u2192 ParamSmoother'],
      ['Chain topology', 'Fixed per plugin',                       'setChain([{type,id}, ...]) at startup; reconfigurable'],
      ['Bypass',         'Wet/dry gain pair inside the plugin',    'fx.setBypass toggles FxProcessor short-circuit'],
      ['Peak meter',     'Usually absent',                         'ctx.createAnalyser on fx.output, DECAY=0.94'],
      ['File pattern',   'src/<name>Engine.js',                    'src/<name>EngineNew.js plus src/core/products/<name>.js'],
    ]),
  ];
}

function sectionRack() {
  return [
    H1('7. RACK SYSTEM'),
    H2('rackEngine.js — graph host'),
    Para('Exports createRack(ctx). Returns { input, output, tapPre, tapPost, addSlot, replaceSlot, removeSlot, moveSlot, setSlotBypass, setRackBypass, setPUT, getPUT, listSlots, dispose }.'),
    Bul('input and output are GainNodes at unity. input is the rack entry, output is the rack exit; the host connects rack.output to ctx.destination.'),
    Bul('Slots are stored in an ordered array of { id, kind, version, engine, bypassed }. id is "slot_<n>" assigned by an internal counter. kind is the plugin type id from the registry. version is "legacy" or "nu" (UI metadata only).'),
    Bul('On every structural change (add/remove/move/bypass/replace/setPUT/setRackBypass), the rack disconnects every node it owns and rewires from scratch. O(n) slots; trivial for QC scale.'),
    Bul('If rackBypassed, rewire connects input \u2192 output directly and skips all slots.'),
    Bul('Otherwise rewire walks the slot array, skips any bypassed slot, and connects prev \u2192 slot.engine.input, then prev = (engine.chainOutput || engine.output).'),
    Bul('If a slot.id equals putId, the walk inserts tapPre before the slot and tapPost after, so external AnalyserNodes get stable tap points that survive rewires.'),
    Bul('Initial wiring runs _rewire() synchronously inside createRack so an empty chain has a live input \u2192 output passthrough. Without this, the rack is silent on first load.'),
    H2('Click-safe rewire envelope (_safeRewire)'),
    Bul('RAMP_MS = 4. On any structural change, output.gain is linearly ramped to 0 over 4 ms, then a setTimeout(RAMP_MS + 1) performs the _rewire() and ramps output.gain back to 1.'),
    Bul('_rewirePending coalesces bursts of mutations: the first mutation schedules the rewire, subsequent ones just extend the mute window.'),
    Bul('removeSlot and replaceSlot dispose the removed engine after a 20 ms deferred timeout so any internal tail/delay/reverb state is not cut mid-ramp.'),
    H2('rackRegistry.js — plugin-type registry'),
    Para('Each REGISTRY entry is a plugin type (not a version) with up to two lazy factory loaders: legacy and nu. A type with only legacy has no migrated version yet. A type with both supports A/B comparison and approval. The loaders are dynamic imports wrapped in closures so modules are only fetched when the type is first instantiated.'),
    Para('Current REGISTRY (as of this audit):'),
    TBL([2400, 3200, 3200], [
      ['id', 'label', 'versions present'],
      ['drumbus',     'Drum / Panther Buss', 'legacy: drumBusEngine, nu: pantherBussEngine'],
      ['la2a',        'LA-2A',               'legacy only'],
      ['analogGlue',  'Analog Glue',         'legacy only'],
      ['gluesmash',   'Glue Smash',          'legacy only'],
      ['neve',        'Neve',                'legacy only'],
      ['iron1073',    'Iron 1073',           'legacy only'],
      ['nastyNeve',   'Nasty Neve',          'legacy only'],
      ['distortion',  'Distortion',          'legacy only'],
      ['shagatron',   'Shagatron',           'legacy only'],
      ['tape',        'Tape (424)',          'legacy only'],
      ['flanger',     'Flanger',             'legacy only'],
      ['modulation',  'Modulation',          'legacy only'],
      ['tapeDelay',   'Tape Delay',          'legacy only'],
      ['echoform',    'Echoform',            'legacy only'],
      ['simpleReverb','Simple Reverb',       'legacy only'],
      ['morphReverb', 'Morph Reverb',        'legacy: morphReverbEngine, nu: morphReverbEngineNew'],
      ['springReverb','Spring Reverb',       'legacy only'],
    ]),
    H2('Version resolution'),
    ...Code([
      'function resolveDefaultVersion(typeId) {',
      '  const t = findType(typeId);',
      '  if (!t) return null;',
      '  if (t.nu && isApproved(typeId)) return \'nu\';',
      '  if (t.legacy) return \'legacy\';',
      '  if (t.nu)     return \'nu\';',
      '  return null;',
      '}',
    ].join('\n')),
    Bul('A type with both versions resolves to legacy by default until the type is explicitly approved by a human.'),
    Bul('A type with only legacy always resolves to legacy. The Approve button is disabled in the UI.'),
    H2('PUT (plugin-under-test) subsystem'),
    Bul('setPUT(slotId) stores putId and triggers _safeRewire; setPUT(null) clears it.'),
    Bul('The rack always owns tapPre and tapPost (two unity-gain GainNodes). They are connected into the audio path only when a PUT is set; otherwise they exist but are disconnected. AnalyserNodes can be attached to them at any time and will survive rewires because their node identity never changes.'),
    Bul('The legacy/new toggle on a PUT slot calls replaceSlot(id, factory, { version }) which swaps the engine in place without disturbing slot order or the PUT selection.'),
  ];
}

function sectionAnalyzer() {
  return [
    H1('8. ANALYZER SYSTEM'),
    Para('Implemented in src/rack/analyzer.js. Exports createAnalyzer(ctx, sourceNode), drawWave(c, buf, w, h, color), fmtDb(v).'),
    H2('Branches'),
    Bul('Stereo split: ChannelSplitter(2) \u2192 two AnalyserNodes (fftSize 2048, smoothingTimeConstant 0). Used for L/R peak difference and stereo correlation.'),
    Bul('Mono: sourceNode \u2192 single AnalyserNode (fftSize 2048, smoothingTimeConstant 0). Used for waveform, peak dBFS, RMS dBFS.'),
    Bul('K-weighted loudness: sourceNode \u2192 highpass (f=38 Hz, Q=0.5) \u2192 highshelf (f=1500 Hz, gain=+4 dB) \u2192 AnalyserNode (fftSize 4096, smoothingTimeConstant 0). Momentary LUFS approximation only; labelled "LUFS ~" in the UI.'),
    H2('Metrics returned by sample()'),
    TBL([2400, 6400], [
      ['field', 'definition'],
      ['wave',        'Float32Array, last 2048 samples of the mono tap.'],
      ['peakDb',      '20\u00b7log10(peakHold). peakHold = max(peak, peakHold\u00b70.93) per frame; peak = max(|buf[i]|).'],
      ['rmsDb',       '20\u00b7log10(sqrt(\u03a3 buf[i]\u00b2 / N)) over the 2048-sample mono buffer.'],
      ['lufs',        '-0.691 + 10\u00b7log10(meanSquare) on the K-weighted branch (4096-sample buffer). Momentary approximation, not a certified meter.'],
      ['clipping',    'True for 300 ms after any mono sample reaches |x| \u2265 0.999.'],
      ['lrDiffDb',    'toDb(peakL) - toDb(peakR) over the 2048-sample L and R buffers.'],
      ['correlation', '\u03a3(L\u00b7R) / sqrt(\u03a3L\u00b2 \u00b7 \u03a3R\u00b2). +1 mono, 0 decorrelated, -1 inverted. Returns 1 when denominator < 1e-9.'],
    ]),
    H2('Audio-path invariance'),
    Bul('AnalyserNode processes whatever it is fed without modifying it. The Web Audio spec requires AnalyserNode to pull input regardless of whether its output is connected, so the analyzer does not need a silent-pull gain to keep it running.'),
    Bul('sourceNode is fanned out; the original connection from sourceNode to its downstream node is never severed. There is no additional mixing, gain change, or filter inserted on the main audio path.'),
    Bul('The K-weighting HPF and highshelf are on a dedicated branch that terminates at an AnalyserNode. They do not feed back into the rack output.'),
    Bul('dispose() only disconnects the fan-out edges it created.'),
  ];
}

function sectionQC() {
  return [
    H1('9. QC / APPROVAL SYSTEM'),
    H2('Status states'),
    TBL([1800, 1400, 5600], [
      ['state', 'color', 'meaning'],
      ['not_started', '#777 gray',    'Type has never been opened in the rack for listening. Default when no entry exists.'],
      ['in_qc',       '#5aa0ff blue', 'Currently under review. Soft flag set by "Start QC". Does not affect version resolution.'],
      ['approved',    '#7fff8f green','Studio-listened and accepted. This is the ONLY state that flips the default version to nu.'],
      ['needs_work',  '#ff5a5a red',  'Listened and rejected. Legacy stays default.'],
      ['deferred',    '#ffd24a yellow','Skipped for now. Legacy stays default.'],
    ]),
    H2('Storage'),
    Bul('Primary key: localStorage[\'shagsvst.rack.qcStatus.v1\']. Shape: `{ [typeId]: statusString }`. Missing entries are treated as `not_started`.'),
    Bul('Legacy key: localStorage[\'shagsvst.rack.approved.v1\']. Read-only. Any `true` entry is folded in at read time as `approved` in the new store. Kept as a cheap rollback anchor.'),
    Bul('Writes only happen through setStatus(typeId, status). approve(id) and revert(id) are thin wrappers. setStatus enforces: status must be in STATUSES; typeId must be registered; status === \'approved\' requires the type to have a `nu` factory.'),
    H2('Strict manual approval invariant'),
    Para('The file-level comment in rackRegistry.js encodes this rule in prose. It is also enforced operationally:'),
    Bul('No metric, threshold, correlation, LUFS delta, bypass-null test, or any analyzer output is wired to approve().'),
    Bul('approve() is called from exactly one place in the UI: a click handler on the Approve button in rack.html, wired to a user gesture.'),
    Bul('The click handler is gated by window.confirm() so a stray click cannot promote a plugin.'),
    Bul('Fresh installs and unknown types always resolve to legacy.'),
    Bul('Approval is per plugin type, per browser profile. It does not propagate across machines or users.'),
    H2('A/B flow (legacy vs new)'),
    ...Code([
      '1. User adds a type to the rack.  resolveDefaultVersion(typeId) picks',
      '   \'legacy\' unless the type is already approved, then loadFactory()',
      '   dynamically imports the matching engine module.',
      '2. User selects the slot as PUT.  rack.setPUT(slotId) rewires with',
      '   tapPre/tapPost around that slot.',
      '3. User toggles LEGACY / NEW on the PUT panel.  The UI calls',
      '   rack.replaceSlot(slotId, factory, { version }).  The old engine',
      '   is disposed 20 ms after the rewire; slot id is preserved.',
      '4. User listens with the analyzer running on tapPost (and optionally',
      '   tapPre).  Nothing in the audio path changes except the engine.',
      '5. User clicks Approve.  confirm() dialog.  On yes, approve(typeId)',
      '   writes status \'approved\'.  Next session, resolveDefaultVersion',
      '   will return \'nu\' for this type.',
      '6. Revert sets status back to \'not_started\'.',
    ].join('\n')),
  ];
}

function sectionData() {
  return [
    H1('10. DATA STRUCTURES'),
    H2('Slot shape (rackEngine.js)'),
    ...Code([
      '{',
      '  id:       string,   // "slot_1", "slot_2", ... assigned by idSeq',
      '  kind:     string,   // plugin type id, e.g. "drumbus", "morphReverb"',
      '  version:  string,   // "legacy" | "nu"  (UI metadata only)',
      '  engine:   { input, output, chainOutput?, setBypass, dispose, ... },',
      '  bypassed: boolean,  // true = skipped in the routing graph',
      '}',
    ].join('\n')),
    H2('Registry entry shape (rackRegistry.js)'),
    ...Code([
      '{',
      '  id:     string,           // e.g. "morphReverb"',
      '  label:  string,           // human label for the UI picker',
      '  legacy: () => factoryFn,  // lazy loader; factoryFn : async(ctx)=>engine',
      '  nu?:    () => factoryFn,  // optional; missing = legacy-only type',
      '}',
    ].join('\n')),
    H2('QC status store'),
    ...Code([
      'localStorage["shagsvst.rack.qcStatus.v1"] =',
      '  \'{"drumbus":"approved","morphReverb":"in_qc","la2a":"deferred"}\'',
      '',
      '// All keys optional. Missing key = "not_started".',
    ].join('\n')),
    H2('Chain message (postMessage)'),
    ...Code([
      '{ type: "setChain", chain: [',
      '    { type: "Delay",     id: "dly" },',
      '    { type: "Reverb",    id: "rv"  },',
      '    { type: "Diffusion", id: "dif" },',
      '] }',
    ].join('\n')),
    H2('Param message'),
    ...Code([
      '{ type: "param", id: "dly.timeMs", value: 350 }',
    ].join('\n')),
    H2('Preset shape (product layer, example)'),
    ...Code([
      '{',
      '  name: "Plate 2.4s",',
      '  params: { morph: 0.35, size: 0.6, decay: 0.7, tone: 0.5,',
      '            density: 0.4, warp: 0.0, width: 1.0, mix: 0.25 }',
      '}',
    ].join('\n')),
  ];
}

function sectionSafety() {
  return [
    H1('11. SAFETY SYSTEMS'),
    Bul('DC blocking: every module that can produce DC (saturation, drive, reverb output) runs a DcBlock with r = 0.995. Transfer: y[n] = x[n] - x[n-1] + r\u00b7y[n-1].'),
    Bul('ADAA fallback: when the ADAA (antiderivative anti-aliasing) denominator |x[n] - x[n-1]| is below a threshold, the module falls back to the instantaneous nonlinearity to avoid 0/0. Threshold is module-local and is documented per-module in section 3.'),
    Bul('softSat rational clipper used in feedback paths (DelayModule, TapeMultiTapModule): y = x / (1 + |x|). Keeps feedback bounded below ~\u00b10.5 and prevents runaway.'),
    Bul('Limiter / compressor self-heal: detectors reset on reset() and on any non-finite input sample. Envelope registers are clamped to finite values each tick.'),
    Bul('Delay clamps: fractional read pointer d is clamped to [0, N-4] to keep the 4-sample Lagrange window in bounds. NaN read pointers are caught by `if (!(d >= 0)) d = 0`.'),
    Bul('ParamSmoother.setTarget guards with Number.isFinite; NaN/Infinity from UI are dropped at the boundary.'),
    Bul('Rack _safeRewire ramps output.gain to 0 for 4 ms before and after the graph mutation to eliminate clicks on topology changes.'),
    Bul('replaceSlot / removeSlot defer dispose() by 20 ms so a plugin tail is not cut mid-ramp.'),
    Bul('Empty-chain passthrough: createRack calls _rewire() once synchronously to guarantee a live input \u2192 output path before any audio is played.'),
  ];
}

function sectionRules() {
  return [
    H1('12. KNOWN CONSTRAINTS / RULES'),
    H2('Engine is locked (STEP 24)'),
    Bul('src/core/dspWorklet.js and src/core/fxEngine.js are not to be edited when adding a new product. New products are pure composition over the existing module palette.'),
    Bul('If a new product needs DSP that no existing module provides, the correct move is to add a new module class to dspWorklet.js, not to edit existing modules.'),
    H2('No UI \u2192 DSP direct writes (STEP 24)'),
    Bul('All parameter changes must go through the engine wrapper\'s setXxx methods, which call product.setXxx, which calls fx.setParam. UI components never touch engine internals.'),
    Bul('This rule is the reason the product layer exists even when a product exposes parameters that map 1:1 to module parameters.'),
    H2('Manual approval only (STEP 3.5 / rackRegistry.js header)'),
    Bul('No metric ever triggers approve(). Approval is a human listening decision in a studio environment.'),
    Bul('Approve button is gated by window.confirm().'),
    Bul('Fresh installs resolve to legacy. Approval is per plugin type, per browser profile.'),
    H2('Neutral vs character-first plugin rules (STEP 25)'),
    Bul('Neutral plugins (e.g. MorphReverb in low-mix settings, SimpleReverb, analyzers) must pass a bypass-null QC: at mix = 0 or bypass = true, the signal out must be identical to the signal in within noise floor.'),
    Bul('Character-first plugins (e.g. PantherBuss, Shagatron, Gluesmash, Iron1073, NastyNeve, Distortion) are exempt from bypass-null. Their identity is the processing; bypass is still expected to be clean, but mix = 0 is not required to be transparent.'),
    Bul('Classification is recorded in the plugin\'s product file and in the QC notes. It determines which QC tests the reviewer runs.'),
  ];
}

function sectionHistory() {
  return [
    H1('13. BUILD HISTORY (FACTUAL)'),
    Bul('Phase 0 \u2014 Legacy engines. Every plugin originally shipped as a standalone src/<name>Engine.js module wiring native Web Audio nodes. These files still exist and are still the default for any type that has not been migrated.'),
    Bul('Phase 1 \u2014 Unified core. src/core/dspWorklet.js (WORKLET_SOURCE) and src/core/fxEngine.js introduced. Single AudioWorklet hosts a runtime-configurable chain of modules.'),
    Bul('Phase 2 \u2014 Module palette. 16 DSP modules added to dspWorklet.js (Delay, Reverb, Diffusion, Saturation, ShelfEQ, ParametricEQ, Compressor, Limiter, Flanger, Phaser, PitchShift, etc.). All share the IDspModule contract and the ParamSmoother primitive.'),
    Bul('Phase 3 \u2014 Product layer. src/core/products/*.js introduced. Each product builds a chain via fx.setChain and exposes macro setters (setMorph, setSize, etc.). 12 products currently exist: drift, echoform, gravity, morphReverb, nearFar, orbit, pantherBuss, plateX, playbox, reverbBus, smear, tapeDelay.'),
    Bul('Phase 4 \u2014 New-engine host wrappers. src/<name>EngineNew.js files wrap each product into the host contract. Current wrappers: pantherBussEngine.js (for drumbus type) and morphReverbEngineNew.js (for morphReverb type).'),
    Bul('Phase 5 \u2014 QC rack. src/rack/rackEngine.js built. Disconnect-and-rewire strategy. Slot model with kind/version/bypassed. rack.html UI with plugin picker, chain list, PUT panel.'),
    Bul('Phase 5.5 \u2014 Click safety. _safeRewire added to rackEngine.js. 4 ms mute envelope around _rewire. Coalescing via _rewirePending. 20 ms deferred dispose.'),
    Bul('Phase 6 \u2014 Analyzer. src/rack/analyzer.js built. Three branches (mono, L/R, K-weighted). Visual-only, no audio-path modification.'),
    Bul('Phase 7 \u2014 Approval workflow. rackRegistry.js introduced. Per-type factories with lazy loaders. Per-slot LEGACY/NEW toggle via replaceSlot. Approve button gated by window.confirm().'),
    Bul('Phase 7.5 \u2014 Strict manual-only approval. rackRegistry.js file header encodes the invariant in prose; no code path other than the UI Approve button writes approved status.'),
    Bul('Phase 8 \u2014 QC status system. STATUSES, STATUS_COLORS, STATUS_LABELS added. setStatus replaces the flat boolean approval store. One-shot migration folds legacy approved=true into status=\'approved\'.'),
    Bul('Phase 9 \u2014 Plugin-by-plugin listening QC. Process started with Panther Buss and Morph Reverb as the two types that currently have both versions. MorphReverb host wrapper (morphReverbEngineNew.js) built to enable A/B for that type.'),
    Bul('Phase 10 \u2014 Rack playback fix. createRack was not calling _rewire on construction, leaving empty chains silent. Single _rewire() call at end of constructor fixed it. Console logs added to both createRack and the Play handler in rack.html.'),
    Bul('Phase 11 \u2014 Tooltips. Native title attributes replaced with CSS [data-tip] pseudo-element tooltips (150 ms delay, 260 px max width, arrow pointer).'),
    Bul('Phase 12 \u2014 Audit documents. QC_Rack_Audit.docx (rack-focused) and this document (full system).'),
  ];
}

function sectionState() {
  return [
    H1('14. CURRENT STATE'),
    H2('Complete'),
    Bul('Unified core (dspWorklet.js, fxEngine.js) and the 16-module palette.'),
    Bul('12 product wrappers in src/core/products/. All build valid chains through fx.setChain and expose their macros through fx.setParam.'),
    Bul('Rack system (rackEngine.js, rackRegistry.js). Add/remove/move/bypass, PUT selection, LEGACY/NEW replaceSlot, click-safe rewire.'),
    Bul('Analyzer (analyzer.js) with mono waveform/peak/RMS, stereo L/R diff + correlation, K-weighted LUFS approx.'),
    Bul('QC status store with five states, color mapping, localStorage persistence, one-shot legacy migration.'),
    Bul('Manual approval path gated by confirm(). No automated approval anywhere.'),
    Bul('Host wrappers: pantherBussEngine.js, morphReverbEngineNew.js.'),
    H2('Partially complete'),
    Bul('Plugin-by-plugin QC. Only drumbus (Panther Buss) and morphReverb have both legacy and new versions in the registry. The listening QC itself is in progress and depends on user ear-level reports; no approvals have been written from code.'),
    Bul('Rack UI tooltips exist on the main PUT controls; coverage of every button has not been audited.'),
    H2('Not complete'),
    Bul('Host wrappers for the other 10 products in src/core/products/ (drift, echoform, gravity, nearFar, orbit, plateX, playbox, reverbBus, smear, tapeDelay). These products exist and run inside the unified core, but there is no src/<name>EngineNew.js exposing them to the rack, so A/B comparison is not possible for those types yet.'),
    Bul('Listening approvals. No plugin has been approved in the new QC flow; all types still resolve to legacy.'),
    Bul('Automated bypass-null QC tests. Manual only at this point.'),
  ];
}

// -------- assemble --------
const raw = fs.readFileSync(RAW_PATH, 'utf8')
  // Strip the agent\'s preface line and horizontal rules.
  .replace(/^Perfect\..*?\n/, '')
  .replace(/^## TECHNICAL AUDIT:.*?\n/m, '');

const parsedCore = parseMarkdown(raw);

const children = [
  new Paragraph({ spacing: { after: 240 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Shags VST', font: FONT, size: 48, bold: true })] }),
  new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Full Technical Audit and Reference', font: FONT, size: 32, bold: true })] }),
  new Paragraph({ spacing: { after: 400 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'System as it currently exists \u2014 no redesign, no interpretation.', font: FONT, size: 22, italics: true })] }),

  ...sectionOverview(),

  H1('2. CORE ENGINE & 3. DSP MODULES (FULL BREAKDOWN)'),
  Para('The following two sections (core engine, and the full per-module breakdown) are reproduced verbatim from the code-reading audit pass over src/core/dspWorklet.js, src/core/fxEngine.js, and every file in src/core/products/. No content has been summarized away.'),
  ...parsedCore,

  ...sectionControl(),

  H1('5. PRODUCT LAYER'),
  Para('The per-product definitions (macro lists, default values, voicing, loadPreset/getState shapes) are covered in the parsed audit content above under each product file (drift.js, echoform.js, gravity.js, morphReverb.js, nearFar.js, orbit.js, pantherBuss.js, plateX.js, playbox.js, reverbBus.js, smear.js, tapeDelay.js). The cross-cutting rules are:'),
  Bul('A product is a function createXxx(fx) that returns a set of macro setters plus getState/loadPreset/dispose.'),
  Bul('The product\'s constructor calls fx.setChain([...]) once with the ordered list of modules it needs.'),
  Bul('Every macro setter is a pure mapping from a user-facing value (usually 0..1) to one or more module parameter writes through fx.setParam.'),
  Bul('Defaults are defined inside the product constructor and are applied by calling the same macros with their default values, never by writing module parameters directly.'),
  Bul('Product identity (what makes MorphReverb a "morph reverb" and not a raw reverb module) lives entirely in the macro mapping and default voicing. Two products can share the same modules and still sound nothing alike.'),

  ...sectionWrappers(),
  ...sectionRack(),
  ...sectionAnalyzer(),
  ...sectionQC(),
  ...sectionData(),
  ...sectionSafety(),
  ...sectionRules(),
  ...sectionHistory(),
  ...sectionState(),
];

const doc = new Document({
  creator: 'Shags VST',
  title: 'Shags VST Full Technical Audit',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 34, bold: true },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 28, bold: true },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 24, bold: true },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
      { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: FONT, size: 22, bold: true, italics: true },
        paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 3 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
          { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
          { level: 2, format: LevelFormat.BULLET, text: '\u25AA', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1620, hanging: 270 } } } },
        ],
      },
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
      default: new Header({ children: [ new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: 'Shags VST \u2014 Full Technical Audit', font: FONT, size: 18, color: '777777' })],
      })]}),
    },
    footers: {
      default: new Footer({ children: [ new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Page ', font: FONT, size: 18, color: '777777' }),
                   new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '777777' })],
      })]}),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT_PATH, buf);
  console.log('Wrote', OUT_PATH, buf.length, 'bytes');
});
