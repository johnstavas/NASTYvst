// Generates QC_Rack_Audit.docx — audit of the QC rack system built this session.
const fs = require('fs');
const path = require('path');

// Use globally-installed docx
const docxPath = 'C:\\Users\\HEAT2\\AppData\\Roaming\\npm\\node_modules\\docx';
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  PageOrientation, LevelFormat, Table, TableRow, TableCell, WidthType,
  BorderStyle, ShadingType,
} = require(docxPath);

const FONT = 'Arial';

const P = (text, opts = {}) => new Paragraph({
  spacing: { after: 120 },
  ...opts,
  children: [new TextRun({ text, font: FONT, size: 22, ...(opts.run || {}) })],
});

const H = (text, level) => new Paragraph({
  heading: level,
  spacing: { before: 280, after: 140 },
  children: [new TextRun({ text, font: FONT, bold: true,
    size: level === HeadingLevel.HEADING_1 ? 34 :
          level === HeadingLevel.HEADING_2 ? 28 : 24 })],
});

const CODE = (text) => new Paragraph({
  spacing: { after: 120 },
  shading: { fill: 'F2F2F2', type: ShadingType.CLEAR, color: 'auto' },
  children: [new TextRun({ text, font: 'Consolas', size: 18 })],
});

const BULLET = (text) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [new TextRun({ text, font: FONT, size: 22 })],
});

const border = { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' };
const borders = { top: border, bottom: border, left: border, right: border,
                  insideHorizontal: border, insideVertical: border };

function tableRow(cells, opts = {}) {
  const widths = opts.widths;
  return new TableRow({
    children: cells.map((c, i) => new TableCell({
      borders,
      width: { size: widths[i], type: WidthType.DXA },
      shading: opts.header ? { fill: 'D5E8F0', type: ShadingType.CLEAR, color: 'auto' } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({
        text: c, font: FONT, size: 20, bold: !!opts.header })] })],
    })),
  });
}

function makeTable(header, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      tableRow(header, { header: true, widths }),
      ...rows.map(r => tableRow(r, { widths })),
    ],
  });
}

const children = [];

// Title
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 240 },
  children: [new TextRun({ text: 'QC Rack System — Technical Audit',
    font: FONT, bold: true, size: 44 })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { after: 360 },
  children: [new TextRun({ text: 'Shags VST — Session Deliverable', font: FONT, italics: true, size: 24 })],
}));

// 1. Purpose
children.push(H('1. Purpose', HeadingLevel.HEADING_1));
children.push(P('The QC rack is a browser-hosted host for chaining arbitrary plugin engines into a single signal path for A/B listening tests. Its job is graph plumbing only: no DSP runs here. Every slot hosts an engine that conforms to the host wrapper contract, and the rack routes audio through slots in series with optional bypass, PUT (plugin-under-test) taps, and click-safe rewires.'));
children.push(P('Signal flow:'));
children.push(CODE('src → rack.input → slot0 → slot1 → … → rack.output → dest'));
children.push(P('When a slot is designated the PUT, two unity-gain taps are inserted around it so external analysers can measure pre- and post-processed signal at a stable graph location:'));
children.push(CODE('… prev → tapPre → PUT.engine → tapPost → next …'));

// 2. Host wrapper contract
children.push(H('2. Host Wrapper Contract', HeadingLevel.HEADING_1));
children.push(P('Every engine placed in a rack slot must expose:'));
children.push(makeTable(
  ['Field', 'Type', 'Required', 'Notes'],
  [
    ['input',        'AudioNode',            'yes', 'Rack connects prev stage here.'],
    ['output',       'AudioNode',            'yes', 'Rack pulls audio from here (fallback).'],
    ['chainOutput',  'AudioNode',            'no',  'If present, used instead of output. For wrappers whose dry/wet sum lives on a separate node.'],
    ['setBypass',    '(on:boolean) ⇒ void',  'yes', 'Called when slot.bypassed toggles. Rack still skips the slot in the graph regardless.'],
    ['dispose',      '() ⇒ void',            'opt', 'Called 20 ms after removal/replace so tails are not cut mid-fade.'],
  ],
  [1800, 2200, 1200, 4160]
));

// 3. Data model
children.push(H('3. Internal Data Model', HeadingLevel.HEADING_1));
children.push(CODE('slot = { id, kind, version: "legacy"|"nu", engine, bypassed:boolean }'));
children.push(BULLET('id — opaque, auto-generated ("slot_N"). Used for PUT selection and UI keys.'));
children.push(BULLET('kind — plugin type id. Opaque to the rack; carried through listSlots().'));
children.push(BULLET('version — UI label for legacy vs migrated engine. Opaque here.'));
children.push(BULLET('engine — the host-contract object. Rack never touches engine internals.'));
children.push(BULLET('bypassed — if true, slot is skipped entirely in _rewire().'));

// 4. Click-safe rewire envelope
children.push(H('4. Click-Safe Rewire Envelope', HeadingLevel.HEADING_1));
children.push(P('Every public mutator (addSlot, replaceSlot, removeSlot, moveSlot, setSlotBypass, setRackBypass, setPUT) calls _safeRewire(). The envelope ramps rack.output to 0 over 4 ms, defers the structural rewire by one setTimeout tick so the mute takes effect, then ramps back to 1.'));
children.push(P('Coalescing: if another mutation arrives while a rewire is pending, it is dropped — the one already queued will pick up the latest state of the slots array. This lets bursts of UI actions (e.g. rapid bypass toggles during auditioning) land on a single rewire.'));
children.push(CODE('RAMP_MS = 4;  // inaudible, covers 1-2 quanta at 48 kHz'));
children.push(P('Engine disposal is deferred 20 ms after replaceSlot/removeSlot so engine tails (reverbs, delays) are not cut during the fade.'));

// 5. Edge registry — the critical fix
children.push(H('5. Edge Registry (critical correctness fix)', HeadingLevel.HEADING_1));
children.push(P('The rack keeps a registry of every edge it creates:'));
children.push(CODE('const _edges = []; // [{from, to}, ...]'));
children.push(CODE('function _rackConnect(from, to) { from.connect(to); _edges.push({ from, to }); }'));
children.push(P('Every wire the rack lays goes through _rackConnect. Teardown is symmetric: _disconnectAll() iterates _edges and calls the targeted form from.disconnect(to), never the blanket from.disconnect().'));
children.push(H('5.1 Why this matters', HeadingLevel.HEADING_2));
children.push(P('The earlier design used blanket disconnects (engine.input.disconnect(), tapPre.disconnect()). Two classes of bug followed:'));
children.push(BULLET('Wrapper-internal wiring destroyed. fxEngine.js connects fx.input → AudioWorkletNode as an edge owned by the wrapper, not by the rack. engine.input.disconnect() severed that edge too. Result: rack active = silence; rack bypassed = audible. Exact symptom seen in this session before the fix.'));
children.push(BULLET('External analyser fan-outs destroyed. UI analyser code connects AnalyserNodes directly to tapPre and tapPost. tapPre.disconnect() nuked those, leaving PRE/POST meters flat and reading -inf while audio was actually flowing.'));
children.push(P('Targeted disconnect via the edge registry preserves both: the rack only undoes edges it created, so wrapper internals and external fan-outs survive every rewire.'));

// 6. Rewire algorithm
children.push(H('6. Rewire Algorithm', HeadingLevel.HEADING_1));
children.push(P('O(n) over slots. Pseudocode of _rewire():'));
children.push(CODE(
`_disconnectAll();
if (rackBypassed) { _rackConnect(input, output); return; }
let prev = input;
for (const s of slots) {
  if (s.bypassed) continue;
  if (s.id === putId) {
    _rackConnect(prev, tapPre);         prev = tapPre;
    _rackConnect(prev, s.engine.input); prev = _out(s.engine);
    _rackConnect(prev, tapPost);        prev = tapPost;
  } else {
    _rackConnect(prev, s.engine.input);
    prev = _out(s.engine);
  }
}
_rackConnect(prev, output);`
));
children.push(P('_out() returns engine.chainOutput ?? engine.output. Bypassed slots are skipped from the graph entirely; their engines still exist but do not see audio. engine.setBypass(true) is still called so engines that track their own bypass state can stop internal processing (e.g. oscillator shutdown, modulator sleep).'));

// 7. Public API
children.push(H('7. Public API', HeadingLevel.HEADING_1));
children.push(makeTable(
  ['Method', 'Effect', 'Triggers rewire?'],
  [
    ['addSlot(kind, factory, meta)',    'Awaits factory(ctx), appends slot, returns id.',            'yes (safe)'],
    ['replaceSlot(id, factory, meta)',  'Swaps engine in-place. Old engine disposed after 20 ms.',   'yes (safe)'],
    ['removeSlot(id)',                  'Removes slot. Old engine disposed after 20 ms.',            'yes (safe)'],
    ['moveSlot(id, delta)',             'Reorders within slots array.',                              'yes (safe)'],
    ['setSlotBypass(id, on)',           'Toggles slot.bypassed and calls engine.setBypass().',       'yes (safe)'],
    ['setRackBypass(on)',               'Routes rack.input → rack.output directly when on.',          'yes (safe)'],
    ['setPUT(id|null)',                 'Designates the PUT slot. Inserts tapPre/tapPost around it.', 'yes (safe)'],
    ['getPUT()',                        'Returns current putId (or null).',                          'no'],
    ['listSlots()',                     'Snapshot: [{id,kind,version,bypassed,engine}].',            'no'],
    ['dispose()',                       'Tears down the entire rack and all engines.',                'no'],
  ],
  [3600, 4000, 1760]
));

// 8. Invariants
children.push(H('8. Invariants', HeadingLevel.HEADING_1));
children.push(BULLET('The rack never touches engine internals. Everything goes through the host contract.'));
children.push(BULLET('Every connect() goes through _rackConnect. Every disconnect() is the targeted form.'));
children.push(BULLET('tapPre and tapPost always exist. Only their position in the graph changes.'));
children.push(BULLET('An empty rack is a passthrough (input → output) wired at construction.'));
children.push(BULLET('Rewire is synchronous and O(n); the envelope only schedules the mute ramps.'));
children.push(BULLET('No DSP, timing-critical code, or sample-rate logic lives in this file.'));

// 9. Session history — what was fixed
children.push(H('9. Session History — Bugs Fixed', HeadingLevel.HEADING_1));
children.push(H('9.1 PRE/POST analysers flat / -inf', HeadingLevel.HEADING_2));
children.push(P('Symptom: both analyser displays read silence while audio was audible. Cause: blanket tapPre.disconnect() / tapPost.disconnect() in the old teardown nuked the external AnalyserNode fan-outs the UI had attached. Fix: edge-registry + targeted disconnect.'));
children.push(H('9.2 Silence when rack active; audio only when bypassed', HeadingLevel.HEADING_2));
children.push(P('Symptom: after the first fix, analysers worked but rack-active produced no audible output; rack-bypass restored audio. Cause: engine.input.disconnect() (blanket form) also severed the wrapper-internal edge fx.input → AudioWorkletNode inside fxEngine.js. Once severed, the worklet stopped receiving audio, fx.output was silent, tapPost carried silence. Fix: the same edge-registry pattern, extended to every edge in _rewire(). No DSP, product-layer, or wrapper changes required.'));
children.push(H('9.3 Rack Bypass button UX', HeadingLevel.HEADING_2));
children.push(P('Label and colour now reflect state directly: green "Rack: ACTIVE" vs red "Rack: BYPASSED", with paintRackBypassBtn() invoked on every toggle.'));

// 10. Files touched
children.push(H('10. Files Touched This Session', HeadingLevel.HEADING_1));
children.push(makeTable(
  ['Path', 'Nature of change'],
  [
    ['src/rack/rackEngine.js', 'Edge registry (_edges, _rackConnect, _disconnectAll), _rewire rewritten on top of it, _safeRewire envelope retained.'],
    ['rack.html',              'Rack Bypass button: class-based ACTIVE / BYPASSED styling, paint helper on state change.'],
  ],
  [4000, 5360]
));

// 11. Future considerations
children.push(H('11. Future Considerations', HeadingLevel.HEADING_1));
children.push(BULLET('Sample-accurate rewire. Current 4 ms fade is inaudible but not sample-locked. For bit-exact null tests, a ConstantSourceNode-driven crossfade between two parallel chains would be tighter.'));
children.push(BULLET('Parallel racks. The current model is strictly serial. A siblings-sum extension would need a second registry (branch edges) and a mix bus.'));
children.push(BULLET('Latency reporting. Host wrappers do not currently report processing latency; a getLatencySamples?() field on the contract would let the rack time-align tapPre vs tapPost for phase-accurate null tests.'));
children.push(BULLET('Per-slot tap. Today only the PUT slot has taps. Exposing taps around any slot would enable richer QC layouts (e.g. A/B two slots side-by-side).'));

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 34, bold: true, font: FONT, color: '1F3A5F' },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: FONT, color: '2E5A8A' },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ],
  },
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
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

const outPath = path.join('C:\\Users\\HEAT2\\Desktop\\Shags VST', 'QC_Rack_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, buf.length, 'bytes');
});
