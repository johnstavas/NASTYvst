// Generate QC_Rack_Audit.docx — audit of the QC rack system.
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation,
} = require('docx');

const FONT = 'Arial';
const INK = '000000';
const border = { style: BorderStyle.SINGLE, size: 4, color: '888888' };
const borders = { top: border, bottom: border, left: border, right: border };

const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t, bold: true, font: FONT, size: 32, color: INK })], spacing: { before: 280, after: 160 } });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true, font: FONT, size: 26, color: INK })], spacing: { before: 220, after: 120 } });
const P  = (t, opts = {}) => new Paragraph({ children: [new TextRun({ text: t, font: FONT, size: 22, color: INK, ...opts })], spacing: { after: 100 } });
const B  = (t) => new Paragraph({ numbering: { reference: 'bul', level: 0 }, children: [new TextRun({ text: t, font: FONT, size: 22, color: INK })] });

function row(cells, header = false) {
  return new TableRow({
    children: cells.map(c => new TableCell({
      borders,
      width: { size: c.w, type: WidthType.DXA },
      shading: header ? { fill: 'E8EEF2', type: ShadingType.CLEAR } : undefined,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: c.t, font: FONT, size: 20, bold: header, color: INK })] })],
    })),
  });
}

const registryRows = [
  ['drumbus',      'Drum / Panther Buss', 'legacy + nu', 'A/B + approval'],
  ['la2a',         'LA-2A',               'legacy',      'no nu yet'],
  ['analogGlue',   'Analog Glue',         'legacy',      'no nu yet'],
  ['gluesmash',    'Glue Smash',          'legacy',      'no nu yet'],
  ['neve',         'Neve',                'legacy',      'no nu yet'],
  ['iron1073',     'Iron 1073',           'legacy',      'no nu yet'],
  ['nastyNeve',    'Nasty Neve',          'legacy',      'no nu yet'],
  ['distortion',   'Distortion',          'legacy',      'no nu yet'],
  ['shagatron',    'Shagatron',           'legacy',      'no nu yet'],
  ['tape',         'Tape (424)',          'legacy',      'no nu yet'],
  ['flanger',      'Flanger',             'legacy',      'no nu yet'],
  ['modulation',   'Modulation',          'legacy',      'no nu yet'],
  ['tapeDelay',    'Tape Delay',          'legacy',      'no nu yet'],
  ['echoform',     'Echoform',            'legacy',      'no nu yet'],
  ['simpleReverb', 'Simple Reverb',       'legacy',      'no nu yet'],
  ['morphReverb',  'Morph Reverb',        'legacy + nu', 'A/B + approval'],
  ['springReverb', 'Spring Reverb',       'legacy',      'no nu yet'],
];

const colW = [1800, 2700, 2200, 2660]; // sums to 9360 (US Letter, 1" margins)

const regTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: colW,
  rows: [
    row([{ t: 'Type ID', w: colW[0] }, { t: 'Label', w: colW[1] }, { t: 'Versions', w: colW[2] }, { t: 'Notes', w: colW[3] }], true),
    ...registryRows.map(r => row([
      { t: r[0], w: colW[0] }, { t: r[1], w: colW[1] }, { t: r[2], w: colW[2] }, { t: r[3], w: colW[3] },
    ])),
  ],
});

const statusW = [2200, 1500, 5660];
const statusTable = new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: statusW,
  rows: [
    row([{ t: 'Status', w: statusW[0] }, { t: 'Color', w: statusW[1] }, { t: 'Meaning', w: statusW[2] }], true),
    row([{ t: 'not_started', w: statusW[0] }, { t: 'gray',  w: statusW[1] }, { t: 'never opened in the rack for listening', w: statusW[2] }]),
    row([{ t: 'in_qc',       w: statusW[0] }, { t: 'blue',  w: statusW[1] }, { t: 'currently being reviewed (soft flag)',   w: statusW[2] }]),
    row([{ t: 'approved',    w: statusW[0] }, { t: 'green', w: statusW[1] }, { t: 'studio-listened and approved — nu becomes default', w: statusW[2] }]),
    row([{ t: 'needs_work',  w: statusW[0] }, { t: 'red',   w: statusW[1] }, { t: 'listened, not acceptable — legacy stays default', w: statusW[2] }]),
    row([{ t: 'deferred',    w: statusW[0] }, { t: 'yellow',w: statusW[1] }, { t: 'skipped for now — legacy stays default, revisit', w: statusW[2] }]),
  ],
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
  },
  numbering: {
    config: [{
      reference: 'bul',
      levels: [{ level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
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
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 },
        children: [new TextRun({ text: 'QC Rack System — Audit', bold: true, font: FONT, size: 44, color: INK })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 320 },
        children: [new TextRun({ text: 'Shags VST  ·  src/rack/  +  src/migration/  +  MANchild Build & Preset System', italics: true, font: FONT, size: 22, color: '333333' })] }),

      H1('1. Purpose'),
      P('The QC rack is a host harness for performing A/B listening tests between the legacy per-plugin engines and migrated "nu" (FxEngine) versions. It exists so that promotion of a new engine to the user-facing default is gated on a deliberate human listening decision, never on an automated metric.'),

      H1('2. Architecture'),
      P('Three files, no DSP of their own — pure plumbing and policy:'),
      B('src/rack/rackEngine.js — chained-slot host. Builds: src → rack.input → slot[0] → slot[1] → … → rack.output → dest.'),
      B('src/rack/rackRegistry.js — type registry, lazy factory loaders, QC status store (localStorage), default-version resolution.'),
      B('src/rack/analyzer.js — visual-only inspection tap (waveform, peak/RMS dBFS, LUFS approx, L/R diff, stereo correlation).'),
      P('UI overlay lives in src/migration/QcOverlay.jsx (info icon + per-instance status badge / Approve / Revoke / Load Alternate Variant). State lives in src/migration/store.js.'),

      H1('3. rackEngine.js'),
      H2('Slot model'),
      P('Each slot is { id, kind, version, engine, bypassed }. Engines must satisfy the host contract:'),
      B('input: AudioNode'),
      B('output: AudioNode (chainOutput optional, falls back to output)'),
      B('setBypass(on)'),
      B('dispose()'),
      H2('Rewire policy'),
      P('Disconnect-all-then-rewire on every structural change. O(n) over slots; negligible for QC use. The rack tracks every edge it created in an internal _edges registry so _disconnectAll() severs only rack-created connections — wrapper-internal wiring (e.g. fx.input → AudioWorkletNode) and external analyser fan-outs survive untouched.'),
      H2('Click-safe rewire envelope'),
      P('Public mutators call _safeRewire(), which fades rack.output to 0 over ~4 ms, performs the disconnect/reconnect on the next tick, then fades back to 1. Bursts of mutations within the fade window are coalesced — the first schedules the actual rewire; subsequent ones extend the mute. Audible clicks from graph mutation are eliminated.'),
      H2('PUT (Plugin Under Test) taps'),
      P('tapPre / tapPost are unity-gain GainNodes that wrap the currently-selected PUT slot: prev → tapPre → PUT → tapPost → next. They are always present so analyser fan-outs survive rewires; only their position in the chain changes when setPUT(id) is called.'),
      H2('Bypass'),
      P('Two levels: per-slot (slot.bypassed skips the slot in routing while still calling engine.setBypass(true) for engines that honour it) and rack-level (setRackBypass(on) wires input straight to output).'),
      H2('Public API'),
      B('addSlot(kind, factory, meta) → id'),
      B('replaceSlot(id, factory, meta)  — preserves slot id and position; disposes displaced engine after the mute window'),
      B('removeSlot(id), moveSlot(id, delta)'),
      B('setSlotBypass(id, on), setRackBypass(on)'),
      B('setPUT(id), getPUT(), listSlots()'),
      B('input, output, tapPre, tapPost (raw nodes)'),
      B('dispose()'),

      H1('4. rackRegistry.js'),
      H2('Type registry'),
      P('A flat list of plugin types. Each entry has up to two factories — legacy and nu (named "nu" to avoid the new keyword). Types with both versions support A/B + approval; legacy-only types have approval disabled in the UI.'),
      regTable,
      P(''),
      P('Currently 17 registered types. 2 have a nu version (drumbus → pantherBuss, morphReverb → morphReverbNew). The remaining 15 are legacy-only.', { italics: true }),

      H2('QC status model'),
      statusTable,
      P(''),
      P('Only the approved status changes default-version resolution; everything else keeps legacy as the user-facing default. All transitions are manual.'),

      H2('Strict manual approval rule'),
      P('Approval is the exclusive product of a human listening decision. There is no automated path in the codebase that writes to the approval store:'),
      B('No metric, threshold, correlation, LUFS delta, or null-test result triggers approve().'),
      B('approve() is called only from a UI button explicitly wired to a user gesture (and gated by a confirm dialog).'),
      B('Fresh installs / unknown types always resolve to legacy.'),
      B('Approval is per plugin-type, per browser profile. It does not propagate across machines or users.'),

      H2('Storage'),
      P('localStorage with two keys:'),
      B('shagsvst.rack.approved.v1 — legacy flat-boolean store (read-only, kept as a rollback anchor).'),
      B('shagsvst.rack.qcStatus.v1 — current per-type status map.'),
      P('A one-shot migration on first read folds any true entries from the legacy store into the new store as status="approved".'),

      H2('Version resolution'),
      P('resolveDefaultVersion(typeId) returns "nu" only if the type has a nu factory AND status === approved. Otherwise it returns "legacy" if present, else "nu" (last-resort fallback). Always returns a version the type actually has, or null for unregistered types.'),

      H1('5. analyzer.js'),
      P('Strictly visual. Source signal fans out to AnalyserNodes only; nothing in the audio path is altered. AnalyserNodes process their input regardless of whether their output is connected, so no silent-pull plumbing is required.'),
      H2('Reported metrics'),
      B('waveform (time-domain, 2048-sample buffer)'),
      B('peak dBFS with hold + decay (factor 0.93 per sample) and 300 ms clip light at >= 0.999'),
      B('RMS dBFS (windowed)'),
      B('LUFS ~ momentary (K-weighted approximation, 4096-sample window)'),
      B('L/R peak difference in dB'),
      B('stereo correlation: +1 mono · 0 decorrelated · -1 inverted'),
      H2('K-weighting (BS.1770 approximation)'),
      P('Two biquads on a silent analysis branch:'),
      B('Stage 1: highpass ~38 Hz, Q 0.5'),
      B('Stage 2: high-shelf +4 dB at ~1.5 kHz'),
      P('LUFS momentary formula: -0.691 + 10 · log10(meanSquare). Close enough for eyeballing loudness deltas across a plugin; UI labels it "LUFS ~" — not a certified meter.'),

      H1('6. UI overlay (src/migration/)'),
      P('QcOverlay.jsx exposes two widgets per plugin instance:'),
      B('InfoIcon — always rendered (QC on or off). Small ⓘ glyph; hover shows the full engine-truth block.'),
      B('QcPanel — rendered only when QC Mode is on. Status badge, Approve / Revoke buttons, "Load Alternate Variant".'),
      P('Both read from the registry + store only. No assumption about which menu spawned the instance.'),
      P('Note: QcOverlay uses a richer status vocabulary (legacy_only, in_qc, approved_engine_v1, needs_work, deferred) than rackRegistry (not_started, in_qc, approved, needs_work, deferred). The two stores are not yet unified — see Findings.'),

      H1('7. Findings'),
      H2('Strengths'),
      B('Clear separation: rackEngine = plumbing, rackRegistry = policy, analyzer = inspection. No DSP leakage anywhere.'),
      B('Targeted edge tracking in rackEngine prevents the classic "blanket disconnect destroys wrapper internals" bug.'),
      B('Click-safe rewire envelope makes structural mutations inaudible without changing the synchronous rewire architecture.'),
      B('PUT taps are persistent nodes — analyser fan-outs survive rewires.'),
      B('Strict manual-approval rule is enforced by codebase convention and clearly documented in-file.'),
      B('Analyzer is read-only — provably cannot colour the signal under test.'),

      H2('Risks / observations'),
      B('Status vocabulary mismatch between rackRegistry (5 statuses) and QcOverlay (5 statuses, different names — legacy_only vs not_started, approved_engine_v1 vs approved). Either consolidate or document the mapping.'),
      B('Approval persistence is per-browser-profile only. A reinstall or new machine reverts every approval to legacy. Acceptable for current scope; flag if the team ever wants approvals to ride with the project.'),
      B('LUFS approximation is a two-biquad shorthand, not BS.1770-compliant. UI label "LUFS ~" already disclaims this — keep the tilde.'),
      B('No null-test or bypass-vs-engine A/B oscilloscope is built into analyzer.js. If null-testing becomes a routine QC step, add it as an additional read-only branch.'),
      B('rackEngine has no enforcement that an engine actually conforms to the host contract — a missing setBypass or dispose silently no-ops via optional chaining. Consider a dev-mode assert at addSlot/replaceSlot time.'),
      B('Coalesced rewire window is 4 ms; mutation bursts longer than that fall outside the coalesce. Acceptable for human-driven UI gestures; flag if programmatic batching is ever added.'),

      H2('Recommendations'),
      B('Unify the QC status vocabulary in one module and import from both rackRegistry and QcOverlay.'),
      B('Add a dev-mode contract check in addSlot/replaceSlot that warns if engine.input / engine.output / engine.setBypass / engine.dispose are missing.'),
      B('Consider exposing a null-test analyser branch (engine output minus engine bypass) for routine "is this transparent at default?" checks.'),
      B('Document the localStorage keys in DEV_RULES.md so a future migration script knows to clear/transform them.'),

      H1('8. Verdict'),
      P('The QC rack system is a tight, single-purpose harness that does exactly what its in-file comments promise: chain plugins, A/B legacy vs nu, gate promotion on a human listening decision. The plumbing is defensive (targeted edge tracking, click-safe rewire), the policy is explicit (manual-only approval), and the inspection layer is provably non-invasive. The two action items worth scheduling are the status-vocabulary unification and a host-contract assert; everything else is housekeeping.'),

      // ───────────────── PART 2 — Build & Preset System ─────────────────
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 200 },
        children: [new TextRun({ text: 'PART 2 — Plugin Build, Validation & Preset System', bold: true, font: FONT, size: 36, color: INK })] }),
      P('Mandatory eight-step system for any plugin build (engine-first → user-test gate → final UI → full preset reset → validation → final audit → output). This is not optional.'),

      H1('Step 1 — Load Memory (mandatory)'),
      P('Before doing anything, load:'),
      B('DAFx DSP memory'),
      B('Fairchild / vari-mu research'),
      B('Plugin system rules'),
      B('Routing + channel mapping rules'),
      B('UI reference rules'),
      B('Engine-first build rules'),
      P('Confirm what memory was loaded and how it will be used.'),

      H1('Step 2 — Engine-first build'),
      P('Build, in order:'),
      B('DSP engine'),
      B('Routing'),
      B('Detector'),
      B('Envelope'),
      B('Gain stage'),
      B('Mix'),
      B('Bypass'),
      P('Then build a simple test UI with no styling.'),

      H1('Step 3 — Stop for user'),
      P('Say: "Engine V1 is complete. Please test it and tell me when to move on to the final UI step."', { bold: true }),

      H1('Step 4 — Final UI'),
      P('Only after approval:'),
      B('Build full UI'),
      B('Follow reference'),
      B('Enforce readability'),
      B('Enforce hierarchy'),
      B('No generic styling'),

      H1('Step 5 — Preset system (full reset)'),
      P('Delete ALL existing presets. Confirm preset list is empty before rebuilding.'),

      H2('Target gain reduction'),
      (() => {
        const w = [3120, 6240];
        return new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: w,
          rows: [
            row([{ t: 'Source', w: w[0] }, { t: 'Target GR', w: w[1] }], true),
            row([{ t: 'Glue',  w: w[0] }, { t: '1–2 dB',  w: w[1] }]),
            row([{ t: 'Vocal', w: w[0] }, { t: '3–6 dB',  w: w[1] }]),
            row([{ t: 'Drums', w: w[0] }, { t: '4–8 dB',  w: w[1] }]),
            row([{ t: 'Heavy', w: w[0] }, { t: '8–15 dB', w: w[1] }]),
          ],
        });
      })(),
      P(''),

      H1('Preset bank (1–41)'),
      (() => {
        const presets = [
          // VOCALS
          ['VOCALS', null, null, null, null, null, null, null],
          [1,  'Vocal – 4dB Smooth Level',     'LINK', 'TC3', '+6',  '-18', '0.5', 'Mix 100'],
          [2,  'Vocal – 6dB Forward',          'LINK', 'TC2', '+8',  '-22', '0.6', ''],
          [3,  'Vocal – Thick Tube',           'LINK', 'TC4', '+10', '-20', '0.4', ''],
          // DRUMS
          ['DRUMS', null, null, null, null, null, null, null],
          [4,  'Drum Bus – Glue 2dB',          'LINK', 'TC2', '+4',  '-14', '',    ''],
          [5,  'Drum Bus – Punch 6dB',         'LINK', 'TC1', '+8',  '-24', '',    ''],
          [6,  'Drum Smash – Parallel',        'IND',  'TC1', '+12', '-30', '',    'Mix 40'],
          // INSTRUMENTS
          ['INSTRUMENTS', null, null, null, null, null, null, null],
          [7,  'Bass – 5dB Control',           'IND',  'TC3', '+6',  '-20', '',    ''],
          [8,  'Guitar – Smooth 2dB',          'LINK', 'TC4', '+3',  '-12', '',    ''],
          // MIX BUS
          ['MIX BUS', null, null, null, null, null, null, null],
          [9,  'Mix Bus – Glue 1.5dB',         'LINK', 'TC2', '+2',  '-10', '',    ''],
          [10, 'Mix Bus – Warm 2dB',           'LINK', 'TC3', '+4',  '-14', '0.4', ''],
          // M/S
          ['M/S', null, null, null, null, null, null, null],
          [11, 'M/S – Center Control',         'M-S',  '',    'M+6 / S+2', '', '', ''],
          [12, 'M/S – Width Enhance',          'M-S',  '',    'M light / S stronger', '', '', ''],
          // CHARACTER
          ['CHARACTER', null, null, null, null, null, null, null],
          [13, 'Tube Drive – Light',           'LINK', 'TC4', '+10', '-8',  '',    'Mix 80'],
          [14, 'Heavy Comp – 10dB',            'LINK', 'TC1', '+12', '-30', '',    ''],
          [15, 'Parallel Glue – Mix 50',       'LINK', 'TC2', '+10', '-28', '',    'Mix 50'],
          // DRUM DETAIL
          ['DRUM DETAIL', null, null, null, null, null, null, null],
          [16, 'Snare – Crack',                'IND',  'TC1', '+10', '-26', '',    ''],
          [17, 'Kick – Tight Punch',           'IND',  'TC2', '+8',  '-22', '',    ''],
          [18, 'Drum Bus – Smash Hard',        'LINK', 'TC1', '+14', '-32', '',    ''],
          [19, 'Drum Bus – Parallel Energy',   'LINK', 'TC1', '+12', '-30', '',    'Mix 35'],
          // VOCAL DETAIL
          ['VOCAL DETAIL', null, null, null, null, null, null, null],
          [20, 'Vocal – Air Control',          'LINK', 'TC4', '+5',  '-14', '0.6', ''],
          [21, 'Vocal – Tight Modern',         'LINK', 'TC2', '+9',  '-24', '',    ''],
          [22, 'Vocal – Parallel Thick',       'LINK', 'TC3', '+12', '-30', '',    'Mix 50'],
          // INSTRUMENT DETAIL
          ['INSTRUMENT DETAIL', null, null, null, null, null, null, null],
          [23, 'Guitar – Edge Control',        'IND',  'TC2', '+6',  '-18', '',    ''],
          [24, 'Guitar – Drive Tube',          'IND',  'TC4', '+12', '-10', '',    'Mix 90'],
          [25, 'Bass – Aggressive Clamp',      'IND',  'TC1', '+10', '-28', '',    ''],
          // MASTERING
          ['MASTERING', null, null, null, null, null, null, null],
          [26, 'Master – Clean Glue',          'LINK', 'TC2', '+1',  '-8',  '',    ''],
          [27, 'Master – Polish',              'LINK', 'TC3', '+3',  '-12', '0.45',''],
          [28, 'Master – Tube Tone',           'LINK', 'TC4', '+8',  '-6',  '',    'Mix 80'],
          // M/S ADVANCED
          ['M/S ADVANCED', null, null, null, null, null, null, null],
          [29, 'M/S – Vocal Focus',            'M-S',  '',    'M strong / S light', '', '', ''],
          [30, 'M/S – Side Control',           'M-S',  '',    'S strong / M light', '', '', ''],
          // VAR MODE
          ['VAR MODE (CRITICAL)', null, null, null, null, null, null, null],
          [31, 'VAR – Snare Crack Tight',      'VAR1', '',    'Fast atk / Fast rel', '', '', ''],
          [32, 'VAR – Snare Body + Snap',      'VAR2', '',    'Med atk / Med-fast rel', '', '', ''],
          [33, 'VAR – Drum Bus Bounce',        'VAR3', '',    'Med atk / Slow rel', '', '', ''],
          [34, 'VAR – Drum Pump Parallel',     'VAR1', '',    'Fast atk / Fast rel', '', '', 'Mix 40'],
          [35, 'VAR – Vocal Rider Smooth',     'VAR3', '',    'Slow atk / Med rel', '', '', ''],
          [36, 'VAR – Vocal Tight Modern',     'VAR2', '',    'Fast atk / Fast rel', '', '', ''],
          [37, 'VAR – Vocal Breath Control',   'VAR4', '',    'Slow atk / Slow rel', '', '', ''],
          [38, 'VAR – Bass Tight Groove',      'VAR2', '',    'Med atk / Med rel', '', '', ''],
          [39, 'VAR – Guitar Sustain Lift',    'VAR4', '',    'Slow atk / Slow rel', '', '', ''],
          [40, 'VAR – Mix Glue Breathing',     'VAR3', '',    'Med atk / Slow rel', '', '', ''],
          [41, 'VAR – Mix Punch Control',      'VAR2', '',    'Fast atk / Med rel', '', '', ''],
        ];
        const w = [560, 2700, 760, 760, 880, 880, 700, 2120];
        const headers = ['#','Name','Mode','TC','Input','Threshold','DC','Mix / Notes'];
        const rows = [row(headers.map((h,i) => ({ t: h, w: w[i] })), true)];
        for (const p of presets) {
          if (p[0] && typeof p[0] === 'string' && p[1] === null) {
            // section header row spanning all cols
            rows.push(new TableRow({
              children: [new TableCell({
                borders,
                width: { size: 9360, type: WidthType.DXA },
                columnSpan: 8,
                shading: { fill: 'D4DCE2', type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: p[0], bold: true, font: FONT, size: 20, color: INK })] })],
              })],
            }));
          } else {
            rows.push(row(p.map((v,i) => ({ t: String(v ?? ''), w: w[i] }))));
          }
        }
        return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: w, rows });
      })(),
      P(''),

      H1('Step 6 — Validate presets'),
      P('For each preset, verify:'),
      B('Correct GR range (matches the source-target table)'),
      B('Correct routing'),
      B('Correct channel mapping'),
      B('Audible usefulness'),
      B('No broken behavior'),

      H1('Step 7 — Final audit'),
      P('Audit:'),
      B('Routing'),
      B('Channels'),
      B('DSP behavior'),
      B('UI mapping'),
      B('Meters'),

      H1('Step 8 — Output'),
      P('Provide:'),
      B('Memory confirmation'),
      B('Preset list (1–41)'),
      B('Validation results'),
      B('Any issues'),
      B('Test instructions'),

      H1('Final directive'),
      P('This must result in:'),
      B('A working DSP system'),
      B('A readable UI'),
      B('A professional preset bank'),
      B('Zero fake controls'),
      B('Zero routing errors'),
      P('No shortcuts.', { bold: true }),
    ],
  }],
});

const out = path.join('C:', 'Users', 'HEAT2', 'Desktop', 'Shags VST', 'QC_Rack_Audit.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(out, buf);
  console.log('Wrote', out, buf.length, 'bytes');
});
