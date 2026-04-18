// Builds Shags_VST_Suite_Migration_Plan.docx — full-suite legacy UI
// preservation migration plan. Research deliverable. No source files edited.
const path = require('path');
const fs = require('fs');
const NODE_GLOBAL = 'C:\\Users\\HEAT2\\AppData\\Roaming\\npm\\node_modules';
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber,
} = require(path.join(NODE_GLOBAL, 'docx'));

const OUT_PATH = 'C:\\Users\\HEAT2\\Desktop\\Shags VST\\Shags_VST_Suite_Migration_Plan.docx';
const FONT = 'Arial', MONO = 'Consolas';
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' };
const borders = { top: border, bottom: border, left: border, right: border };

function runs(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: 22 }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), font: FONT, size: 22, bold: true }));
    else out.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: 20 }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, size: 22 }));
  if (!out.length) out.push(new TextRun({ text: ' ', font: FONT, size: 22 }));
  return out;
}
const P  = (t) => new Paragraph({ spacing: { after: 100 }, children: runs(t) });
const H1 = (t, brk = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: brk,
  spacing: { before: 0, after: 200 }, children: [new TextRun({ text: t, font: FONT, size: 34, bold: true })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 },
  children: [new TextRun({ text: t, font: FONT, size: 28, bold: true })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 },
  children: [new TextRun({ text: t, font: FONT, size: 24, bold: true })] });
const Bul = (t, lvl = 0) => new Paragraph({ numbering: { reference: 'bullets', level: lvl },
  spacing: { after: 40 }, children: runs(t) });
const Code = (t) => t.split('\n').map(l => new Paragraph({ spacing: { after: 0 },
  shading: { fill: 'F2F4F2', type: ShadingType.CLEAR },
  children: [new TextRun({ text: l || ' ', font: MONO, size: 18 })] }));
function TBL(cols, rows) {
  const W = cols.reduce((a,b)=>a+b,0);
  return new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cols,
    rows: rows.map((r,i) => new TableRow({ children: r.map((c,j) => new TableCell({
      borders, width: { size: cols[j], type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: i===0 ? { fill: 'E8EEE8', type: ShadingType.CLEAR } : undefined,
      children: [new Paragraph({ spacing: { after: 0 },
        children: [new TextRun({ text: String(c), font: FONT, size: 18, bold: i===0 })] })],
    }))})) });
}

// ---- content ----
const children = [];

children.push(
  new Paragraph({ spacing: { after: 200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Shags VST', font: FONT, size: 48, bold: true })] }),
  new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Full-Suite Legacy UI Migration Plan', font: FONT, size: 32, bold: true })] }),
  new Paragraph({ spacing: { after: 400 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Same face, same interaction model, new brain underneath.', font: FONT, size: 22, italics: true })] }),
);

// ========================================================================
children.push(H1('1. MIGRATION PHILOSOPHY & INVARIANTS', false));
children.push(P('This document is the authoritative plan for replacing the legacy DSP engines of every Shags VST plugin with the unified FxEngine core while preserving each plugin\'s legacy UI, interaction model, and product identity exactly. The legacy faces ARE the products. The new engine lives underneath them.'));
children.push(H2('Hard invariants (global to every plugin)'));
children.push(
  Bul('**Preserve the face.** No Orb rewrites. No control-layout reshuffles. No visual identity changes. The panther canvas stays the panther canvas; the LA-2A chicken-head knobs stay chicken-head knobs; the spring-reverb physics bobs stay physics bobs.'),
  Bul('**Preserve the interaction model.** Orb-drag, XY pads, radial/angle selection, spring physics, 3-way mode buttons, preset rows, stepped rotary selectors — every one of these is product identity and stays exactly as shipped.'),
  Bul('**Preserve labels and naming.** MANUAL stays MANUAL. REGEN stays REGEN. R37 stays R37. SHAG stays SHAG. No silent renames.'),
  Bul('**Preserve visual-linked feedback.** Drive halos, aurora trails, particle fields, VU needle physics, LED bars, clip meters, canvas overlays — all are audio-reactive and stay reactive.'),
  Bul('**Never let UI write DSP directly.** The control flow is fixed: `Legacy Orb → Adapter → Product Macros → FxEngine.setParam → Worklet`.'),
  Bul('**Never drop silently.** Any legacy control that has no current new-engine equivalent is listed explicitly in the per-plugin mapping as `missing-macro` or `legacy-only`. It is never just removed.'),
  Bul('**Never flatten.** An 8-zone orb does not become 8 knobs. A spring bob does not become a slider. A discrete 5-way HPF selector does not become a continuous frequency dial. The interaction stays; only the DSP under it changes.'),
);
children.push(H2('Architecture (global)'));
children.push(...Code([
  'Legacy Orb component (unchanged JSX)',
  '   │  state changes (same state names as before)',
  '   ▼',
  'src/adapters/<plugin>Adapter.js  ← NEW per plugin, thin + stateless',
  '   │  engine.setXxx(...)',
  '   ▼',
  'src/<plugin>EngineNew.js  ← host wrapper around the product',
  '   │  product.setXxx(...)',
  '   ▼',
  'src/core/products/<plugin>.js  ← product macros',
  '   │  fx.setParam(moduleIdx, paramId, value)',
  '   ▼',
  'src/core/fxEngine.js  → port.postMessage → FxProcessor worklet',
]));
children.push(P('One adapter per plugin. The adapter is the only new surface UI code touches. The Orb keeps calling the same setters it always called; the adapter translates them into the new engine\'s macros.'));
children.push(H2('Mapping classification (applied per control)'));
children.push(
  Bul('**direct 1:1** — same range, same default, same meaning. Adapter is a passthrough.'),
  Bul('**rescale** — same meaning, different range or units (e.g. legacy ±12 dB → new 0..1 bipolar). Adapter applies a closed-form transform.'),
  Bul('**one-to-many** — a single legacy control drives multiple new parameters. Adapter fans out to several macros.'),
  Bul('**many-to-one** — several legacy controls collapse into one new macro (rare; only where legacy coupled them already).'),
  Bul('**missing macro** — no current new-engine macro covers it; one must be added at the product layer (not the worklet). Worklet palette edits forbidden unless a genuinely new module is required.'),
  Bul('**legacy-only behavior** — requires architectural recreation (a new palette module, a new envelope/oscillator, etc.). Moves to its own phase and is blocked on a product decision.'),
  Bul('**deprecated** — explicitly dropped with written justification. Default position: never use this class unless explicitly chosen.'),
);

// ========================================================================
children.push(H1('2. SUITE INVENTORY'));
children.push(P('Every plugin Orb file found under `src/`, matched to its legacy engine and to the rack-registry type. "Registered" means currently instantiable in the QC rack via `src/rack/rackRegistry.js`.'));
children.push(H2('Rack-registered legacy plugins (17)'));
children.push(TBL([1600, 2200, 2200, 1600, 1800], [
  ['type id', 'Legacy Orb', 'Legacy engine', 'New product', 'New host wrapper'],
  ['drumbus',      'DrumBusOrb.jsx',      'drumBusEngine.js',      'pantherBuss.js',    'pantherBussEngine.js'],
  ['la2a',         'LA2AOrb.jsx',         'la2aEngine.js',         '—',                 '—'],
  ['analogGlue',   'AnalogGlueOrb.jsx',   'analogGlueEngine.js',   '—',                 '—'],
  ['gluesmash',    'GluesmashOrb.jsx',    'gluesmashEngine.js',    '—',                 '—'],
  ['neve',         'NeveOrb.jsx',         'neveEngine.js',         '—',                 '—'],
  ['iron1073',     'Iron1073Orb.jsx',     'iron1073Engine.js',     '—',                 '—'],
  ['nastyNeve',    'NastyNeveOrb.jsx',    'bae73Engine.js',        '—',                 '—'],
  ['distortion',   'DistortionOrb.jsx',   'distortionEngine.js',   '—',                 '—'],
  ['shagatron',    'ShagatronOrb.jsx',    'shagatronEngine.js',    '—',                 '—'],
  ['tape',         'TapeOrb.jsx',         'tapeEngine.js',         '—',                 '—'],
  ['flanger',      'FlangerOrb.jsx',      'flangerEngine.js',      '—',                 '—'],
  ['modulation',   'ModulationOrb.jsx',   'modulationEngine.js',   '—',                 '—'],
  ['tapeDelay',    'TapeDelayOrb.jsx',    'tapeDelayEngine.js',    'tapeDelay.js',      '—'],
  ['echoform',     'EchoformOrb.jsx',     'echoformEngine.js',     'echoform.js',       '—'],
  ['simpleReverb', 'SimpleReverbOrb.jsx', 'simpleReverbEngine.js', '—',                 '—'],
  ['morphReverb',  'MorphReverbOrb.jsx',  'morphReverbEngine.js',  'morphReverb.js',    'morphReverbEngineNew.js'],
  ['springReverb', 'SpringReverbOrb.jsx', 'springReverbEngine.js', '—',                 '—'],
]));
children.push(H2('Orb-only plugins, not yet in rack (inventory)'));
children.push(P('Plugins that have a legacy Orb but are not registered in `rackRegistry.js`. Each needs, eventually: (a) a registry entry, (b) a product (if its DSP fits the unified palette), (c) a host wrapper, (d) an adapter. Listed here so nothing falls off the plan.'));
children.push(TBL([2000, 1800, 1800, 4200], [
  ['Plugin', 'Orb', 'Engine', 'Identity / hero interaction'],
  ['Airlift',          'AirliftOrb.jsx',          'airliftEngine.js',          'Cloud/Sky Atmosphere — luminous cloud canvas, gold light rays, drifting particles'],
  ['Amp',              'AmpOrb.jsx',              'ampEngine.js',              'Tube amp — 2D XY pad (Bass/Mid/Treble/Presence + Sag + Mix)'],
  ['Ampless',          'AmplessOrb.jsx',          'amplessEngine.js',          'Hand-wired tube pedal — vacuum-tube glow, stompbox switch'],
  ['Bassmind',         'BassmindOrb.jsx',         'bassmindEngine.js',         'Submarine sonar — circular sonar sweep, dive klaxon toggle'],
  ['Character',        'CharacterOrb.jsx',        'characterEngine.js',        'Neon CRT vocal box — 6-mode selector (Radio/Dream/Hyper/Indie/Rap/Phone)'],
  ['DeHarsh',          'DeHarshOrb.jsx',          'deharshEngine.js',          'Crystal prism light refraction — desser with prismatic viz'],
  ['Drift',            'DriftOrb.jsx',            'driftEngine.js',            'Aurora field — northern lights, modulation/detune/spread/time'],
  ['Finisher',         'FinisherOrb.jsx',         'finisherEngine.js',         'Mastering console — loudness + metering'],
  ['FocusReverb',      'FocusReverbOrb.jsx',      'focusReverbEngine.js',      'Magnifying lens / focus ring reverb'],
  ['FreezeField',      'FreezeFieldOrb.jsx',      'freezefieldEngine.js',      'Frozen crystal cave — crystalline growth animation'],
  ['Gravity',          'GravityOrb.jsx',          'gravityEngine.js',          'Black-hole gravitational field — orbiting particles'],
  ['MixBus',           'MixBusOrb.jsx',           'mixBusEngine.js',           'Console channel strip — level/pan/width/tone with faders'],
  ['NearFar',          'NearFarOrb.jsx',          'nearfarEngine.js',          'Depth/distance landscape — near↔far spatial reverb'],
  ['Orbit',            'OrbitOrb.jsx',            'orbitEngine.js',            'Spatial movement reverb — planetary orbits'],
  ['Phaser',           'PhaserOrb.jsx',           'phaserEngine.js',           'Deep violet/magenta phaser'],
  ['PhraseRider',      'PhraseRiderOrb.jsx',      'phraseRiderEngine.js',      'Waveform automation lane — drag points for gain automation'],
  ['PitchShifter',     'PitchShifterOrb.jsx',     'pitchShifterEngine.js',     'Minimal dark knob — pitch/delay/mix'],
  ['PlateX',           'PlateXOrb.jsx',           'platexEngine.js',           'Vibrating metal plate (Chladni patterns) — tension/size/energy'],
  ['Playbox',          'PlayboxOrb.jsx',          'playboxEngine.js',          'Arcade / toy-box sampler — keys, pads, playback controls'],
  ['Reactor',          'ReactorOrb.jsx',          'reactorEngine.js',          'Hacker terminal — matrix animation + synthesis'],
  ['ReverbBus',        'ReverbBusOrb.jsx',        'reverbBusEngine.js',        'Bus-friendly reverb — pre-delay / room / decay / tone / mix'],
  ['Smear',            'SmearOrb.jsx',            'smearEngine.js',            'Dream / lo-fi unstable reverb — pitch+tone distortion'],
  ['Smoother',         'SmootherOrb.jsx',         'smootherEngine.js',         'Zen garden / water-pool LP/HP with ripple animation'],
  ['Splitdrive',       'SplitdriveOrb.jsx',       'splitdriveEngine.js',       'Muscle-car dashboard — dual (normal + split) distortion'],
  ['SpringPhysics',    'SpringPhysicsOrb.jsx',    'springPhysicsEngine.js',    'LED meter bar — spring-based metering animation'],
  ['TransientReverb',  'TransientReverbOrb.jsx',  'transientReverbEngine.js',  'Impact shockwave reverb — transient-emphasized'],
  ['VibeMic',          'VibeMicOrb.jsx',          'vibemicEngine.js',          'Ribbon mic — proximity/warmth'],
  ['Vocal',            'VocalOrb.jsx',            'vocalEngine.js',            'Vocal enhancement — EQ/comp/mix'],
  ['VocalLock',        'VocalLockOrb.jsx',        'vocalLockEngine.js',        'Holographic targeting reticle — vocal processing'],
]));
children.push(P('Utility / non-plugin components excluded: ClipMeter, PresetSelector, OrbPluginDemo, ScopeOrb, PantherBussOrb (test rig).'));

// ========================================================================
children.push(H1('3. PER-PLUGIN MIGRATION AUDITS'));
children.push(P('One subsection per registered plugin. Each lists the legacy control inventory, the new-engine surface if one exists, a control-by-control mapping with classification, the adapter plan, and the explicit gap list.'));

// --- Panther Buss (full plan already exists; summarized here) ---
children.push(H2('3.1 Drum Bus → Panther Buss (type `drumbus`)'));
children.push(P('Files: `DrumBusOrb.jsx` (835), `drumBusEngine.js` (406), `pantherBussEngine.js` (67), `core/products/pantherBuss.js` (182). Hero interaction: panther canvas with audio-reactive eye/mouth/fur glow, breath animation when idle. Drive pulse on 3-way mode buttons.'));
children.push(H3('Control mapping'));
children.push(TBL([1700, 1200, 1700, 2200, 1400, 1800], [
  ['Legacy', 'Range/default/unit', 'Musical intent', 'New mapping', 'Class', 'Notes'],
  ['DRIVE',        '0..1 / 0.3',             'Saturator pre-gain',                    '`engine.setDrive(v)`',                                    'direct 1:1',       'Default shifts only; voicing differs, not scale'],
  ['CRUNCH',       '0..1 / 0',               'Hi-band (3 kHz) isolation + tanh',      'add `setCrunch(v)` macro; drives EQ pk @ ~3 kHz',         'missing macro',     'Product-layer only; EQ module already in chain'],
  ['BOOM',         '0..1 / 0',               'Transient-triggered sine osc',          'Phase 4: new palette module `BoomOsc`',                   'legacy-only',       'Product decision required; may split to separate plugin'],
  ['FREQ',         '0..1 → 20–120 Hz / 0.25','Boom oscillator frequency',             'Coupled to BOOM',                                          'legacy-only',       'No-op without boom recreation'],
  ['DAMP',         '0..1 → 2–20 kHz / 0.75', 'Post-boom LP cutoff',                   'add `setHighCut(v)` macro; EQ lpOn + lpFreq',             'missing macro',     'All underlying params exist; product exposes them'],
  ['TRANS',        '0..1 bip / 0.5',         'Transient shaper',                      'Phase 1: map to compressor attackMs; Phase 2: new module','missing macro',     'Approximation first; real module later if desired'],
  ['DECAY',        '0..1 bip / 0.5',         'Sustain gain + boom env release',       'Phase 1: map to compressor releaseMs; Phase 4: boom env','multi-param',      'Half maps now; other half blocked on BOOM'],
  ['COMP',         'toggle / 0',             'Glue compressor on/off',                'Phase 1: GLUE=0 bypass-ish; Phase 2: `setCompEnable`',    'rescale/missing',   'Two-stage plan'],
  ['DRIVE MODE',   '0/1/2 / 0',              'Saturator curve (SOFT/MED/HARD)',       'add `setDriveMode(m)`; writes SATURATOR.curve',           'missing macro',     'Worklet param already exists, currently pinned at 2'],
  ['MIX',          '0..1 / 1.0',             'Parallel dry/wet',                      '`engine.setMix(v)`',                                      'direct 1:1',       ''],
  ['TRIM',         '±12 dB / 0',             'Output trim',                           '`engine.setOutput(0.5 + trimDb/24)`',                      'rescale',           'Closed-form; `getState()` inverses for readback'],
  ['WIDTH',        '0..1 / 0.5',             'M/S side gain (HPF 150 Hz)',            'add `setWidth(v)`; include WIDTH module in product chain', 'missing macro',     'WIDTH module already in palette'],
  ['BYPASS',       'bool',                   'Chain on/off',                          '`engine.setBypass(on)`',                                  'direct 1:1',       ''],
  ['INPUT GAIN',   '0..2 / 1',               'Pre-DSP trim (header)',                 'add `setInputGain(v)` to wrapper → fx.input.gain',        'missing wrapper',   'One-liner on the engine wrapper'],
  ['OUTPUT GAIN',  '0..2 / 1',               'Post-DSP trim (header)',                'add `setOutputGain(v)` to wrapper → fx.output.gain',      'missing wrapper',   'Distinct from TRIM/OUTPUT macro'],
  ['Telemetry',    'peakIn/Out/GR/trans/bass','Panther canvas reactivity',            'Phases 2–5: analyser + worklet telemetry plumbing',        'missing surface',   'Canvas degrades gracefully until present'],
]));
children.push(H3('Adapter'));
children.push(...Code([
  '// src/adapters/drumBusAdapter.js',
  'export function applyDrumBusState(engine, s) {',
  '  engine.setDrive (s.drive);',
  '  engine.setMix   (s.mix);',
  '  engine.setOutput(0.5 + s.trim / 24);              // ±12 dB → 0..1 bip',
  '  engine.setGlue  (s.comp > 0.5 ? 0.4 : 0);         // Phase 1 COMP',
  '  engine.setTone  (0.5 - 0.25 * (1 - s.damp));      // temp until setHighCut exists',
  '  engine.setBypass(!!s.bypassed);',
  '  // Phase 2 additions (guarded — adapter tolerates missing methods):',
  '  engine.setHighCut?.(s.damp);',
  '  engine.setCrunch?.(s.crunch);',
  '  engine.setDriveMode?.(s.driveMode);',
  '  engine.setWidth?.(s.width);',
  '  engine.setTransient?.(s.transients);',
  '  engine.setDecay?.(s.decay);',
  '  engine.setInputGain?.(s.inputGain);',
  '  engine.setOutputGain?.(s.outputGain);',
  '}',
]));

// --- LA-2A ---
children.push(H2('3.2 LA-2A (type `la2a`)'));
children.push(P('Files: `LA2AOrb.jsx` (843), `la2aEngine.js` (418). Hero: chicken-head knobs, VU needle (spring physics) with 3-mode click cycle (GR / Out×4 / Out×10), JUICE (LF warm) and R37 (HF emphasis) buttons, 7 factory presets. Legacy engine surface: `setPeakReduction`, `setGain`, `setMode`, `setHfEmphasis`, `setJuice`, `setBypass`, `getGainReduction`, `getOutputLevel`, `getInputLevel`, `getInputPeak`, `getOutputPeak`.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/la2a.js`**. Chain: `SATURATOR (optional opto-bias) → COMPRESSOR (opto program-dependent) → EQ (juice + HF emph shelves)`. Exposes macros: `setPeakReduction(v)`, `setGain(v)`, `setMode(lim)`, `setHfEmphasis(v)`, `setJuice(on)`.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1400, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['PEAK REDUCTION', '0..1 / 0.45',    '`setPeakReduction(v)`', 'drives COMPRESSOR threshold (−10..−30 dB, exp) + auto program-dependent attack/release blend inside product', 'direct 1:1 (product maps)'],
  ['GAIN',           '0..40 dB / 0',   '`setGain(db)`',         'COMPRESSOR.makeupDb',                                                                                     'direct 1:1'],
  ['LIMIT/COMPRESS', 'bool / false',   '`setMode(lim)`',        'toggles COMPRESSOR ratio 3:1 ↔ 10:1 and knee 8 dB ↔ 6 dB at product layer',                               'direct'],
  ['HF EMPH (R37)',  '0..1 / 0',       '`setHfEmphasis(v)`',    'EQ highshelf or presence peak (~1 kHz sidechain emphasis — requires sidechain HPF macro on COMPRESSOR)',   'missing macro (sidechain HP)'],
  ['JUICE (LF warm)','bool / false',   '`setJuice(on)`',        'EQ low-shelf +2.5 dB @ ~120 Hz + SATURATOR drive nudge with asym=high → H2/H3',                          'missing macro (compound)'],
  ['BYPASS',         'bool',           '`setBypass()`',         'fx.setBypass',                                                                                            'direct 1:1'],
  ['Meter mode',     'cycled',         '(UI only)',             'No engine impact — UI reads `getGainReduction()` / `getOutputPeak()`',                                    'direct (telemetry)'],
  ['Telemetry',      'GR+RMS+peak',    'getGainReduction etc.', 'Wrapper exposes: getGainReduction (from COMPRESSOR telemetry), getOutputLevel, getInputLevel, peaks.',    'missing surface'],
  ['Presets (7)',    'INIT, GENTLE…',  '(preset loader)',       'Each preset is a normalized macro set stored on the Orb. Adapter calls macros in order.',                 'direct'],
]));

// --- Analog Glue ---
children.push(H2('3.3 Analog Glue (type `analogGlue`)'));
children.push(P('Files: `AnalogGlueOrb.jsx` (652), `analogGlueEngine.js` (459). Hero: chrome SSL-style panel, GR-history oscilloscope (380×h canvas, ~4.7 s window), GR needle VU, discrete attack/release/ratio/SC-HPF pill buttons, 6 presets. This is the most control-dense compressor in the suite (13 setters).'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/analogGlue.js`** → chain `COMPRESSOR → SATURATOR (drive coupling) → WIDTH (optional stereo link mode)`. Keep 1:1 macro parity with legacy to minimize adapter work.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1600, 2000, 2400, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['THRESHOLD',   '−60..0 dB / −12',             '`setThreshold(db)`', 'COMPRESSOR.threshold',                                  'direct 1:1'],
  ['RATIO',       '{1.5, 2, 4, 10} / 2',         '`setRatio(r)`',       'COMPRESSOR.ratio; UI keeps stepped pills',              'direct 1:1'],
  ['ATTACK',      '{0,.1,.3,1,3,10,30} ms / 10', '`setAttack(ms)`',     'COMPRESSOR.attackMs',                                   'direct 1:1'],
  ['RELEASE',     '{100,200,400,800,1600,Auto} / Auto','`setRelease(ms)`','Auto = 200 ms fixed; otherwise direct',               'direct 1:1'],
  ['KNEE',        '0..24 dB / 6',                '`setKnee(db)`',       'COMPRESSOR.knee',                                       'direct 1:1'],
  ['MAKEUP',      '−6..+24 dB / 0',              '`setMakeup(db)`',     'COMPRESSOR.makeupDb',                                   'direct 1:1'],
  ['MIX',         '0..1 / 1',                    '`setMix(v)`',         '`fx.setEngineMix(v)`',                                   'direct 1:1'],
  ['INPUT GAIN',  '0..2 / 1',                    '`setInputGain(v)`',   'wrapper → fx.input.gain',                                'missing wrapper'],
  ['OUTPUT GAIN', '0..2 / 1',                    '`setOutputGain(v)`',  'wrapper → fx.output.gain',                               'missing wrapper'],
  ['DRIVE',       '0..1 / 0.3',                  '`setDrive(v)`',       'SATURATOR.drive (scaled) + asym nudge',                  'direct 1:1'],
  ['S/C HP',      '{OFF,30,60,90,120,150 Hz}/0', '`setSidechainFilter(hz)`','requires sidechain HPF on COMPRESSOR (currently absent in compressor module)','missing macro (core feature)'],
  ['STEREO LINK', '{DUAL,AVG,MAX} / AVG',        '`setStereoLink(mode)`','requires stereoLink input on COMPRESSOR (currently exposed 0..1; enum rescale)','rescale'],
  ['LOOKAHEAD',   'bool / false',                '`setLookahead(on)`',  '128-sample FIR — requires worklet input delay path',      'legacy-only (core add)'],
  ['BYPASS',      'bool',                        '`setBypass()`',       'fx.setBypass',                                            'direct 1:1'],
  ['Telemetry',   'GR + RMS + Peak + latency',   '(metering API)',      'Wrapper exposes `getGainReduction`, `getInputPeak`, `getOutputPeak`, `getLatency`.','missing surface'],
]));

// --- Gluesmash ---
children.push(H2('3.4 Gluesmash (type `gluesmash`)'));
children.push(P('Files: `GluesmashOrb.jsx` (1060), `gluesmashEngine.js` (332). Hero: giant 260×260 pressure gauge with spring-physics needle, 24 rim LEDs, screen-shake on transients, glass-crack overlay at >10 dB GR, danger-zone arc. No factory presets — purely algorithmic morphing.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/gluesmash.js`**. Chain: `COMPRESSOR (main) → COMPRESSOR (parallel crush branch via engineMixMode) → SATURATOR → EQ (tone tilt)`. Legacy macros already collapse multiple params (MACRO coupling), so product-layer design matches.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1500, 2000, 2500, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['MACRO',   '0..1 / 0.3', '`setMacro(v)`',  'drives threshold −6..−46 dB, ratio 1.5:1..40:1, parallel crush 12:1..100:1 inside product',      'direct 1:1'],
  ['ATTACK',  '0..1 / 0.3', '`setAttack(v)`', 'exp → 0.1..100 ms → COMPRESSOR.attackMs',                                                          'direct 1:1'],
  ['RELEASE', '0..1 / 0.4', '`setRelease(v)`','exp → 20..800 ms → COMPRESSOR.releaseMs',                                                          'direct 1:1'],
  ['TONE',    '0..1 / 0.5', '`setTone(v)`',   'EQ tilt blend (TILT_EQ module)',                                                                   'direct 1:1'],
  ['PUNCH',   '0..1 / 0',   '`setPunch(v)`',  'peak-recovery gain; nudges COMPRESSOR attack shorter + SATURATOR transient emphasis',              'missing macro'],
  ['SMASH',   '0..1 / 0',   '`setSmash(v)`',  'parallel crush branch mix (engineMix parallel chain with second COMPRESSOR @ extreme ratio)',      'missing macro (parallel chain)'],
  ['MIX',     '0..1 / 1',   '`setMix(v)`',    '`fx.setEngineMix(v)`',                                                                              'direct 1:1'],
  ['IN/OUT GAIN','0..2 / 1','setInputGain/setOutputGain','wrapper one-liners',                                                                     'missing wrapper'],
  ['BYPASS',  'bool',       '`setBypass()`',  'fx.setBypass',                                                                                       'direct 1:1'],
  ['Telemetry','GR + Peak', 'getGR/getPeakOutput','drives pressure gauge needle + rim LEDs + crack overlay',                                       'missing surface'],
]));

// --- Neve 1073 ---
children.push(H2('3.5 Neve 1073 (type `neve`)'));
children.push(P('Files: `NeveOrb.jsx` (843), `neveEngine.js` (327). Hero: "juicing" heat effect — drive knob glows red-hot, panel hue warps cool→warm, orange vignette, 1073 badge picks up heat glow. Audio-transparent at low drive, character only crosses in near −5 dBFS peaks.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/neve1073.js`**. Chain: `SATURATOR (input xfmr) → EQ (HPF + low shelf + mid peak + high shelf) → SATURATOR (output xfmr)`. Uses the existing EQ module\'s hpOn/lsFreq/pkFreq/hsFreq — stepped discrete frequencies land cleanly on the continuous EQ params.'));
children.push(H3('Control mapping'));
children.push(TBL([1800, 1800, 2000, 2400, 1000], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['DRIVE',       '0..18 dB / 0',                 '`setDrive(db)`',       'drives both SATURATORs (pre + post), scales asym',     'direct 1:1'],
  ['HPF SELECT',  '{OFF,50,80,160,300 Hz} / OFF', '`setHpf(hz)`',         'EQ hpOn + hpFreq; OFF → hpOn=0',                       'direct 1:1 (stepped)'],
  ['LOW FREQ',    '{35,60,110,220 Hz} / 110',     '`setLowFreq(hz)`',     'EQ lsFreq',                                            'direct 1:1'],
  ['LOW GAIN',    '±12 dB / 0',                   '`setLowGain(db)`',     'EQ lsGain',                                            'direct 1:1'],
  ['MID FREQ',    '{360,700,1.6k,3.2k,4.8k,7.2k Hz}/1600','`setMidFreq(hz)`','EQ pkFreq',                                           'direct 1:1'],
  ['MID GAIN',    '±12 dB / 0',                   '`setMidGain(db)`',     'EQ pkGain',                                            'direct 1:1'],
  ['HIGH GAIN',   '±12 dB / 0',                   '`setHighGain(db)`',    'EQ hsGain (hsFreq pinned 8 kHz to match legacy)',      'direct 1:1'],
  ['OUTPUT TRIM', '−24..+6 dB / 0',               '`setOutputTrim(db)`',  'SATURATOR.outputDb',                                   'direct 1:1'],
  ['BYPASS',      'bool',                         '`setBypass()`',        'fx.setBypass',                                         'direct 1:1'],
]));
children.push(P('Notable: Neve is the cleanest migration in the suite. Every control has a 1:1 landing on existing EQ / SATURATOR params. No missing macros.'));

// --- Iron 1073 ---
children.push(H2('3.6 Iron 1073 (type `iron1073`)'));
children.push(P('Files: `Iron1073Orb.jsx` (306), `iron1073Engine.js` (425). Hero: three-knob minimalism (Drive · Thickness · Output), curve rebuild debounced to 60 ms, band-split output saturation @ 250 Hz. Needs product with pre-emphasis EQ between two saturation stages.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/iron1073.js`**. Chain: `EQ (thickness pre-emph) → SATURATOR (input tx) → SATURATOR (class-A) → EQ (output tone softening) → SATURATOR (output tx)`. Thickness is a macro that writes multiple EQ and SATURATOR params at once.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1600, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['DRIVE',     '0..18 dB / 0',   '`setDrive(db)`',      'All three SATURATOR drives (scaled)',                                       'direct 1:1'],
  ['THICK',     '0..1 / 0.5',     '`setThickness(v)`',   'EQ lsGain + lsFreq(180) + hsGain(−2 @ 14k) — one-to-many',                  'one-to-many'],
  ['OUT',       '−24..+6 / 0',    '`setOutputTrim(db)`', 'output SATURATOR.outputDb',                                                 'direct 1:1'],
  ['MIX',       '0..1 / 1',       '`setMix(v)`',         '`fx.setEngineMix(v)`',                                                       'direct 1:1'],
  ['IN GAIN',   '0..2 / 1',       '`setInputGain(v)`',   'wrapper',                                                                    'missing wrapper'],
  ['AUTOMAKEUP','bool / off',     '`setAutoMakeup(on)`', 'RAF compensation loop — keep in wrapper (not worklet)',                      'legacy-only (wrapper)'],
  ['BYPASS',    'bool',           '`setBypass()`',       'fx.setBypass',                                                               'direct 1:1'],
]));

// --- Nasty Neve ---
children.push(H2('3.7 Nasty Neve (type `nastyNeve`)'));
children.push(P('Files: `NastyNeveOrb.jsx` (568), `bae73Engine.js` (988 — largest legacy engine). Hero: 5-stage signal path (input cond → input xfmr → class-A → output xfmr → dynamic HF softening), envelope-follower RAF @ 30 Hz drives class-A even/odd crossfader + HF damper. EQL button dynamically inserts/removes the EQ section from the chain.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/nastyNeve.js`**. Chain: `EQ (input cond) → SATURATOR (input xfmr, asym) → SATURATOR (class-A, env-follower driven) → SATURATOR (output xfmr) → EQ (dynamic HF softening)`. Full EQL section (HPF + LS + PK + HS) toggles by writing `lsGain=0, pkGain=0, hsGain=0, hpOn=0`.'));
children.push(H3('Control mapping (same 11 controls as Neve + PAD + EQL)'));
children.push(P('All HPF/LOW/MID/HIGH controls map identically to Neve 1073 (direct 1:1 on EQ module params). Additions:'));
children.push(
  Bul('**PAD** (bool) → wrapper `setInputGain(pad ? 0.1 : 1)` — a wrapper one-liner.'),
  Bul('**EQL** (bool) → product-level `setEqlEnabled(on)` that zeroes all EQ gains when off (preserves graph; no worklet reshuffle).'),
  Bul('**DRIVE** → all three SATURATORs, plus an envelope-follower hook that modulates the class-A SATURATOR\'s `curve`/`asym`. Requires **new macro `setEnvelopeModulation(on)`** and ENVELOPE_FOLLOWER module inclusion in the chain.'),
  Bul('**THICK** → `setThickness(v)` one-to-many (180 Hz shelf + 3.5 kHz presence peak).'),
);

// --- Distortion ---
children.push(H2('3.8 Distortion (type `distortion`)'));
children.push(P('Files: `DistortionOrb.jsx` (552), `distortionEngine.js` (160). Hero: **8-zone orb drag**. Angle selects one of 8 distortion characters (Tape/Tube/Diode/Fold/Fuzz/Crush/Drive/Vinyl); distance from center = drive amount. Center 45 px is the "clean zone". 10-band graphic EQ with 11 named curves. 40 animated rings, hue-shifting core fracture with drive.'));
children.push(H3('Interaction preservation'));
children.push(P('The 8-zone orb is the plugin. It does NOT become 8 knobs. The adapter keeps the exact `setPosition(angleDeg, drive)` contract — only the function body changes. Zone weights (cosine taper, 45° window) stay on the UI side; what was a set of hard-coded waveshaper tables in the legacy engine becomes a weighted cross-fade of SATURATOR curves at the product layer.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/distortion.js`**. Chain: `EQ (pre-shape) → SATURATOR (with `curve` + `asym` + `drive` programmed by orb-weighted blend) → EQ (10-band graphic) → WIDTH (pan)`. The 8 zones collapse to one SATURATOR whose `curve`/`asym` are set from a weighted combination dependent on orb angle.'));
children.push(H3('Control mapping'));
children.push(TBL([1800, 1600, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['Orb position', 'angle 0..360°, dist 0..1', '`setPosition(ang, dist)`', 'product computes zone weights (cosine taper 45°), blends SATURATOR.curve / asym / drive', 'direct 1:1 (contract)'],
  ['MIX',         '0..1 / 0',     '`setMix(v)`',       'fx.setEngineMix',                                      'direct 1:1'],
  ['TONE',        '0..1 / 0.7',   '`setTone(v)`',      'exponential LP 600 Hz..12 kHz on wet',                'direct 1:1'],
  ['INPUT/OUTPUT','0..2 / 1',     'setInputGain/setOutputGain','wrapper',                                       'missing wrapper'],
  ['PAN',         '−1..+1 / 0',   '`setPan(v)`',       'WIDTH module (balance)',                              'rescale'],
  ['EQ band i=0..9','±12 dB / 0', '`setEqBand(i, db)`','10 EQ.pkFreq instances (32/64/125/250/500/1k/2k/4k/8k/16k); needs a multi-band EQ product','missing macro (multi-band)'],
  ['EQ BYPASS',   'bool',          '`setEqBypass(on)`','zero all 10 gains when on',                             'direct 1:1 (product)'],
  ['EQ PRESETS',  '11 curves',     '(preset loader)',  'adapter calls setEqBand × 10',                          'direct 1:1'],
  ['BYPASS',      'bool',          '`setBypass()`',    'fx.setBypass',                                           'direct 1:1'],
]));
children.push(P('Gap: the product layer needs a **multi-band graphic EQ macro system**. The existing EQ module has only one peak band. Options: (a) add a new `MULTIBAND_EQ` palette module (worklet edit — 10 cascaded biquads); or (b) instantiate 10 EQ modules in the product chain. Option (b) is the cleanest preserving-the-palette route.'));

// --- Shagatron ---
children.push(H2('3.9 Shagatron (type `shagatron`)'));
children.push(P('Files: `ShagatronOrb.jsx` (425), `shagatronEngine.js` (424, AudioWorklet). Hero: cream Sebatron/Neve faceplate, bakelite knobs, red jewel pilot light, LED in/out meters, central analog VU, 3-way mode switch (Smooth/Thick/Angry), 8 factory presets.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/shagatron.js`**. Chain: `EQ (bite + air + tight + weight) → SATURATOR (mode-dependent curve) → COMPRESSOR (smooth) → EQ (output tone)`. Mode switch changes SATURATOR.curve and COMPRESSOR ratio/attack.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1600, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['SHAG',    '0..1 / 0.4',   '`setShag(v)`',    'SATURATOR.drive exp 1×..18×',                                             'direct 1:1'],
  ['LEVEL',   '−12..+12 / 0', '`setLevel(db)`',  'SATURATOR.outputDb',                                                       'direct 1:1'],
  ['WEIGHT',  '0..1 / 0.3',   '`setWeight(v)`',  'EQ lsGain @ 200 Hz',                                                       'direct 1:1'],
  ['BITE',    '0..1 / 0.2',   '`setBite(v)`',    'EQ pkGain @ 1.2 kHz',                                                      'direct 1:1'],
  ['TIGHT',   '0..1 / 0.2',   '`setTight(v)`',   'EQ hpOn + hpFreq 50..350 Hz',                                              'direct 1:1'],
  ['HAIR',    '0..1 / 0.1',   '`setHair(v)`',    'SATURATOR.asym nudge (mid saturation)',                                    'direct 1:1'],
  ['AIR',     '0..1 / 0',     '`setAir(v)`',     'EQ hsGain @ 3.5 kHz',                                                      'direct 1:1'],
  ['SMOOTH',  '0..1 / 0',     '`setSmooth(v)`',  'COMPRESSOR threshold + envelope-follower LP',                              'direct 1:1'],
  ['MIX',     '0..1 / 1',     '`setMix(v)`',     'fx.setEngineMix',                                                           'direct 1:1'],
  ['MODE',    '0/1/2 / 1',    '`setMode(m)`',    'SATURATOR.curve + COMPRESSOR ratio/attack profile set inside product',     'direct 1:1'],
  ['BYPASS',  'bool',         '`setBypass()`',   'fx.setBypass',                                                              'direct 1:1'],
]));

// --- Tape (424) ---
children.push(H2('3.10 Tape 424 (type `tape`)'));
children.push(P('Files: `TapeOrb.jsx` (1082), `tapeEngine.js` (573). Hero: 4 cream VU meters across top, spinning tape reels (speed increases with drive), 4 hero knobs with colored caps (red INPUT, yellow BASS/TREBLE, white VOLUME). VU needle physics asymmetric (rise 2× faster than fall).'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/tape.js`** using the existing `TAPE_MULTITAP` and `TAPE_CHARACTER` palette modules (already built for tapeDelay). Chain: `EQ (bass + treble Baxandall) → SATURATOR (tape sat) → TAPE_CHARACTER (wow/flutter/hiss)`.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1600, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['INPUT',     '0..18 dB / 0', '`setInputDrive(db)`','SATURATOR.drive + pre-emphasis shelf at product layer',     'direct 1:1'],
  ['BASS',      '±10 dB / 0',   '`setBass(db)`',      'EQ lsGain @ 100 Hz',                                        'direct 1:1'],
  ['TREBLE',    '±10 dB / 0',   '`setTreble(db)`',    'EQ hsGain @ 10 kHz',                                        'direct 1:1'],
  ['VOLUME',    '±12 dB / 0',   '`setVolume(db)`',    'SATURATOR.outputDb',                                         'direct 1:1'],
  ['WOW/FLUT',  '−1..+1 / 0',   '`setWowFlutter(v)`', 'TAPE_CHARACTER.wowDepth/flutDepth (product maps bipolar)',   'direct 1:1'],
  ['HISS',      '0..1 / 0',     '`setHiss(v)`',       'TAPE_CHARACTER.hiss',                                        'direct 1:1'],
  ['BYPASS',    'bool',         '`setBypass()`',      'fx.setBypass',                                               'direct 1:1'],
]));

// --- Flanger ---
children.push(H2('3.11 Flanger (type `flanger`)'));
children.push(P('Files: `FlangerOrb.jsx` (549), `flangerEngine.js` (464). Hero: **dual theme** — ENGINE knob toggles MX (blue sparkle, 350 particles) vs SBF (black+gold, warmer). MODE knob is 4-way per engine (CLASSIC/WIDE/TZ for MX; FL1/FL2/FL3/CHO for SBF). 8 factory presets with engine+mode baked in.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/flanger.js`**. The unified palette does NOT currently have a flanger/chorus module; the legacy engine is a custom worklet with feedback short-delay + LFO + through-zero logic. This is **legacy-only** at the palette level.'));
children.push(
  Bul('Option A: Add `FLANGER` to the palette (minimal — delay line ≤ 20 ms + feedback + LFO + output filter). Non-trivial but well-scoped.', 1),
  Bul('Option B: Leave legacy engine in place; just wrap it with the minimum contract `{input, output, setBypass, setDrive, ...}` and skip product-layer integration. This is acceptable if the flanger is not needed for QC A/B.', 1),
);
children.push(P('Recommendation: Option A is required for full suite integration. ENGINE + MODE select the curve family inside the product (no separate worklet branches).'));

// --- Modulation ---
children.push(H2('3.12 Modulation (type `modulation`)'));
children.push(P('Files: `ModulationOrb.jsx` (517), `modulationEngine.js` (434). Hero: **8-zone orb** (same as Distortion) — waveform zones (Sine/Tri/Saw↑/Saw↓/Square/Pulse/S&H/~Random) by angle, depth by distance. 3 independent effect toggles (TREMOLO/FILTER/VIBRATO) — any combination. BPM + beat-division (1/32..4 bar) tempo sync. Ping-pong depth.'));
children.push(H3('Required new product'));
children.push(P('Modulation reuses the palette\'s LFO primitive but routes it into three different destinations (amplitude, filter cutoff, delay time). Requires **one new palette module** or composition of existing ones. `core/products/modulation.js` composes: one LFO generator driving up to three destinations selectable by the 3 toggles.'));
children.push(H3('Control mapping'));
children.push(TBL([1800, 1600, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['Orb position',  'ang/dist',   '`setPosition(ang, dist)`',   'Waveform blend → LFO.shape; depth → LFO modulation scale', 'direct 1:1'],
  ['DEPTH',         '0..1 / 0',   '`setDepth(v)`',              'shared modulation depth',                                   'direct 1:1'],
  ['MIX',           '0..1 / 0',   '`setMix(v)`',                'fx.setEngineMix',                                           'direct 1:1'],
  ['BPM + DIV',     '60..240, 0..7','`setRate(bpm, beats)`',    'LFO.rate = bpm/60/beats',                                   'direct 1:1'],
  ['TREMOLO',       'bool / true','`setTremolo(on)`',           'routes LFO → amplitude',                                    'missing macro'],
  ['FILTER',        'bool / false','`setFilter(on)`',           'routes LFO → BiquadFilter cutoff',                          'missing macro'],
  ['VIBRATO',       'bool / false','`setVibrato(on)`',          'routes LFO → short delay time',                             'missing macro'],
  ['PING-PONG',     '0..1 / 0',   '`setPingPong(v)`',           'cross-pan sine LFO depth',                                  'missing macro'],
  ['IN/OUT GAIN',   '0..',         'setInputGain/setOutputGain','wrapper',                                                   'missing wrapper'],
  ['PAN',           '−1..+1 / 0', '`setPan(v)`',                'WIDTH module',                                               'rescale'],
  ['BYPASS',        'bool',       '`setBypass()`',              'fx.setBypass',                                               'direct 1:1'],
]));

// --- Tape Delay ---
children.push(H2('3.13 Tape Delay (type `tapeDelay`)'));
children.push(P('Files: `TapeDelayOrb.jsx` (563), `tapeDelayEngine.js` (536), new product `core/products/tapeDelay.js`. Hero: 3 playback heads (independent on/off + volume), gold-accent chrome knobs, spinning reels, VU needle + LED bar. RE-201 / Studer identity. New product already exists — only adapter + wrapper needed.'));
children.push(P('**This plugin is the easiest to wire first after Panther Buss** because `core/products/tapeDelay.js` already composes `TAPE_MULTITAP + TAPE_CHARACTER + COMB_BANK`. All 18 legacy controls map directly to macros already planned in the product.'));

// --- Echoform ---
children.push(H2('3.14 Echoform (type `echoform`)'));
children.push(P('Files: `EchoformOrb.jsx` (864), `echoformEngine.js` (314), new product `core/products/echoform.js`. Hero: infinite-tunnel canvas (rainbow rings + nebula + corner crystals), audio-reactive. 8 named presets (TAPE ECHO / DISSOLVE / etc.). Product already exists — adapter + wrapper only.'));

// --- Simple Reverb ---
children.push(H2('3.15 Simple Reverb (type `simpleReverb`)'));
children.push(P('Files: `SimpleReverbOrb.jsx` (322), `simpleReverbEngine.js` (172). Hero: **XY pad** (tone ↔ decay) with expanding aura tied to RMS. Settings panel with redundant in/out gain + pan sliders. Transparent-at-rest (mix = 0 default).'));
children.push(H3('Required new product'));
children.push(P('Could be served by MorphReverb with a fixed morph position, or by a new minimal plate product. Simplest path: add **`core/products/simpleReverb.js`** that reuses the FDN_REVERB + DIFFUSER + WIDTH chain with tone/decay as single macros. XY pad maps (x=tone, y=decay) via adapter — no product-layer change needed beyond two macros.'));

// --- Morph Reverb ---
children.push(H2('3.16 Morph Reverb (type `morphReverb`)'));
children.push(P('Files: `MorphReverbOrb.jsx` (584), `morphReverbEngine.js` (417), `morphReverbEngineNew.js` (wrapper exists), `core/products/morphReverb.js`. Hero: dual-realm canvas (left cyan geometric particles / right amber nebula), morph-line shimmer boundary, SMOOTH knob (0..5 stages), 5 factory presets (INIT/PLATE ROOM/HALL/MORPH SPACE/DARK NEBULA).'));
children.push(P('**Fully plumbed.** Only the adapter is missing. The Orb already calls: setMorph, setSize, setDecay, setTone, setDensity, setWarp, setMix, setBypass, setSmooth, setInputGain, setOutputGain. All 11 legacy methods have identical-named new-engine macros. This is the quickest adapter in the suite.'));

// --- Spring Reverb ---
children.push(H2('3.17 Spring Reverb (type `springReverb`)'));
children.push(P('Files: `SpringReverbOrb.jsx` (555), `springReverbEngine.js` (279). Hero: **3 interactive spring bobs** with damped physics (k=0.18, d=0.14). Drag vertically, release, bob oscillates. Color-coded (decay=cyan, wobble=yellow, mix=green). Tank window with audio-reactive shimmer ripple on coils.'));
children.push(H3('Required new product'));
children.push(Bul('**New product: `core/products/springReverb.js`**. Chain: `SATURATOR (input preshape) → COMB_BANK (dispersion chain, 4 allpass) → FDN_REVERB (tank body) → EQ (tone)`. Convolver IR + dispersion allpass chain is the legacy signature — approximate via FDN + comb; exact IR-convolution parity requires new palette module.'));
children.push(H3('Control mapping'));
children.push(TBL([1600, 1600, 2000, 2600, 1400], [
  ['Legacy', 'Range / default', 'New macro', 'Mapping detail', 'Class'],
  ['DECAY spring',  '0..1 / 0.38',  '`setDecay(v)`',      'FDN decay 0.6..4 s (from bob Y)',                                      'direct 1:1'],
  ['WOBBLE spring', '0..1 / 0.35',  '`setWobble(v)`',     'COMB_BANK fb + modDepth + FDN modRate',                                 'one-to-many'],
  ['MIX spring',    '0..1 / 0.30',  '`setMix(v)`',        'fx.setEngineMix (quadratic wet = mix² × 0.55 preserved)',               'rescale'],
  ['TONE',          '0..1 / 0.5',   '`setTone(v)`',       'EQ hsGain ±11 dB @ 3.5 kHz',                                            'direct 1:1'],
  ['IN/OUT GAIN',   '0..1 / 0.5',   'setInputGain/Output','wrapper (0.5 maps to unity — UI convention preserved)',                 'rescale'],
  ['BYPASS',        'bool',         '`setBypass()`',      'fx.setBypass',                                                           'direct 1:1'],
]));
children.push(P('Interaction preservation: the physics stays on the UI side. Adapter only receives final settled values — the spring damping, shimmer-ripple audio reaction, and glow amplitude are Orb-local.'));

// ========================================================================
children.push(H1('4. MASTER MISSING-MACRO LIST'));
children.push(P('Every product-layer and wrapper-layer macro that must be added across the suite. Grouped by scope. No worklet (palette) edits unless called out as such.'));
children.push(H2('Universal (every wrapper)'));
children.push(
  Bul('**`setInputGain(v)`** on every new wrapper → `fx.input.gain.setTargetAtTime(v, ctx.currentTime, 0.01)`. Needed by nearly every legacy Orb header.'),
  Bul('**`setOutputGain(v)`** on every new wrapper → `fx.output.gain`. Needed universally. Distinct from any product OUTPUT/TRIM macro.'),
  Bul('**`getInputPeak()` / `getInputLevel()`** mirror of existing `getOutputPeak()` — every Orb reads both for clip meters.'),
);
children.push(H2('Product-layer additions (per type)'));
children.push(TBL([1800, 5200], [
  ['Plugin', 'New macros'],
  ['pantherBuss',  'setHighCut, setCrunch, setDriveMode, setWidth, setTransient, setDecay, setCompEnable'],
  ['la2a',         'setPeakReduction, setGain, setMode, setHfEmphasis, setJuice (whole product is new)'],
  ['analogGlue',   'setThreshold, setRatio, setAttack, setRelease, setKnee, setMakeup, setSidechainFilter, setStereoLink, setLookahead, setDrive (whole product is new; SC-HP + lookahead require worklet-level features)'],
  ['gluesmash',    'setMacro, setAttack, setRelease, setTone, setPunch, setSmash (whole product is new; SMASH requires parallel-chain support in fxEngine — already exposed via engineMixMode)'],
  ['neve',         'setDrive, setHpf, setLowFreq, setLowGain, setMidFreq, setMidGain, setHighGain, setOutputTrim (whole product is new; all map 1:1 to existing EQ + SATURATOR)'],
  ['iron1073',     'setDrive, setThickness, setOutputTrim, setMix, setAutoMakeup (whole product is new)'],
  ['nastyNeve',    'Neve controls + setEqlEnabled, setEnvelopeModulation, setThickness (ENVELOPE_FOLLOWER module already in palette)'],
  ['distortion',   'setPosition (orb), setTone, setPan, setEqBand × 10, setEqBypass (multi-band EQ requires either 10 EQ modules or new MULTIBAND_EQ palette module)'],
  ['shagatron',    'setShag, setLevel, setWeight, setBite, setTight, setHair, setAir, setSmooth, setMode (all direct 1:1 on existing modules)'],
  ['tape',         'setInputDrive, setBass, setTreble, setVolume, setWowFlutter, setHiss (reuse TAPE_CHARACTER + TAPE_MULTITAP palette modules)'],
  ['flanger',      '**Blocked on new palette module `FLANGER`** (short-delay + feedback + LFO + filter). ENGINE + MODE select curve families inside product.'],
  ['modulation',   'setPosition, setDepth, setMix, setRate, setTremolo, setFilter, setVibrato, setPingPong (requires LFO routing primitive in product layer)'],
  ['tapeDelay',    'Already present in core/products/tapeDelay.js; only wrapper + adapter needed'],
  ['echoform',     'Already present in core/products/echoform.js; only wrapper + adapter needed'],
  ['simpleReverb', 'setTone, setDecay, setMix (minimal; reuse FDN_REVERB + DIFFUSER)'],
  ['morphReverb',  'All present; only adapter needed'],
  ['springReverb', 'setDecay, setWobble, setMix, setTone (whole product is new; IR convolver currently legacy-only)'],
]));
children.push(H2('Worklet palette additions (defer until forced)'));
children.push(
  Bul('**FLANGER** — short-delay + LFO + feedback + filter. Required for type `flanger`.'),
  Bul('**MULTIBAND_EQ** — optional; needed if 10 separate EQ instances in type `distortion` prove expensive.'),
  Bul('**BoomOsc** — transient-triggered sine with envelope. Required only if Panther Buss Phase 4 (BOOM recreation) is greenlit.'),
  Bul('**Spring IR Convolver** — if exact legacy spring-tank IR is required. Otherwise FDN + dispersion approximates.'),
  Bul('**Compressor sidechain HPF** — adds a `scHp` param to the existing COMPRESSOR module. Needed by `analogGlue`.'),
  Bul('**Compressor lookahead FIR** — adds a 128-sample input delay. Needed by `analogGlue`.'),
);

// ========================================================================
children.push(H1('5. PHASED SUITE ROLL-OUT ORDER'));
children.push(P('Ordered by adapter-effort required and by identity-preservation risk. Each phase is self-contained and shippable.'));
children.push(H2('Phase A — already-plumbed migrations (adapter only)'));
children.push(P('Products exist in `src/core/products/`. Only the wrapper file `<name>EngineNew.js` and the adapter need to be written. Lowest risk, fastest wins.'));
children.push(
  Bul('1. **morphReverb** — wrapper exists; adapter is trivial (11 methods are already 1:1 named).'),
  Bul('2. **tapeDelay** — product fully built; adapter is straightforward (all 18 controls direct).'),
  Bul('3. **echoform** — product fully built; adapter maps 10 controls direct.'),
);
children.push(H2('Phase B — cleanest product additions (1:1 mappings)'));
children.push(P('Product is new but every control lands directly on existing EQ + SATURATOR + COMPRESSOR params. No missing worklet features.'));
children.push(
  Bul('4. **neve** — 8 controls, all 1:1.'),
  Bul('5. **iron1073** — 4 controls + thickness (one-to-many but trivial).'),
  Bul('6. **shagatron** — 10 controls, all 1:1.'),
  Bul('7. **tape** — 7 controls via TAPE_CHARACTER + TAPE_MULTITAP + EQ.'),
  Bul('8. **simpleReverb** — 3 reverb controls over FDN_REVERB + DIFFUSER.'),
);
children.push(H2('Phase C — character compressors'));
children.push(P('Heavier product-layer work; legacy-specific telemetry (GR meters, needle physics, history scope) must be plumbed.'));
children.push(
  Bul('9. **drumbus (Panther Buss)** — detailed plan in §3.1.'),
  Bul('10. **la2a** — opto character product, 7 macros, 3-mode meter.'),
  Bul('11. **gluesmash** — macro-driven morphing; SMASH uses engineMixMode parallel branch.'),
  Bul('12. **nastyNeve** — 5-stage character path; needs ENVELOPE_FOLLOWER module integration.'),
);
children.push(H2('Phase D — preserved-interaction specials'));
children.push(P('Orb / XY / physics interaction is the identity. Adapters must be written exactly so the UI event contract is byte-identical.'));
children.push(
  Bul('13. **distortion** — 8-zone orb. Needs multi-band EQ plumbing.'),
  Bul('14. **modulation** — 8-zone orb + BPM sync + 3 effect toggles.'),
  Bul('15. **springReverb** — 3 physics bobs; dispersion chain approximation vs exact-IR.'),
);
children.push(H2('Phase E — blocked on palette or product decisions'));
children.push(
  Bul('16. **analogGlue** — needs COMPRESSOR sidechain HPF + lookahead FIR (worklet-level additions).'),
  Bul('17. **flanger** — needs new FLANGER palette module.'),
);
children.push(H2('Phase F — Orb-only plugins'));
children.push(P('Every plugin in §2 \'Orb-only plugins, not yet in rack\' follows the same procedure once its turn comes: (1) inventory controls, (2) classify each, (3) decide whether to build a new product or keep legacy-only, (4) register in `rackRegistry.js`, (5) write wrapper + adapter. No scheduling commitment here; these are tracked so they don\'t disappear from the plan.'));

// ========================================================================
children.push(H1('6. PER-PHASE IMPLEMENTATION TEMPLATE'));
children.push(P('Every phase entry follows this checklist. A plugin is "migrated" when every item is checked. No item is skipped silently.'));
children.push(
  Bul('**Inventory.** Enumerate legacy Orb controls (labels, state names, ranges, defaults, units) into the per-plugin audit table in this document.'),
  Bul('**Classify.** Each control gets one of seven classes (direct / rescale / one-to-many / many-to-one / missing-macro / legacy-only / deprecated).'),
  Bul('**Product.** If required, add `src/core/products/<name>.js`. Compose from the existing palette. Worklet palette edits only if the plugin\'s identity demands a module that does not exist.'),
  Bul('**Wrapper.** Add `src/<name>EngineNew.js`. Expose the same method names the legacy engine exposed. Include analyser(s) for the telemetry the Orb reads.'),
  Bul('**Adapter.** Add `src/adapters/<name>Adapter.js`. Pure translation from legacy state into `engine.setXxx()` calls. No branching logic other than rescales and guards.'),
  Bul('**Registry.** Add a `nu` factory to the `rackRegistry.js` entry.'),
  Bul('**QC.** Use the rack to A/B legacy vs new. Log listening notes. No approval flag is written by code — manual-only as before.'),
  Bul('**Gap log.** Every `missing-macro` or `legacy-only` item that is not landed in this pass is carried forward into the plan\'s gap log so the next phase picks it up.'),
);

// ========================================================================
children.push(H1('7. GLOBAL GAP LOG (current state)'));
children.push(P('Aggregated across all per-plugin audits. This is the full list of things the new engine currently does not express.'));
children.push(H2('Product-layer (no worklet edits required)'));
children.push(
  Bul('Compressor-gate toggle (panther `COMP`).'),
  Bul('Saturator curve switching exposed as a product macro (panther `DRIVE MODE`, shagatron `MODE`).'),
  Bul('10-band graphic EQ with per-band gain (distortion).'),
  Bul('LFO routing to multiple destinations (modulation).'),
  Bul('SMOOTH filter stages on wet bus (morphReverb has it; echoform + others would benefit).'),
  Bul('Parallel-chain crush branch (gluesmash SMASH) — uses `fx.setEngineMixMode`.'),
  Bul('Envelope-follower modulating SATURATOR curve/asym (nastyNeve).'),
);
children.push(H2('Wrapper-layer'));
children.push(
  Bul('Universal `setInputGain` / `setOutputGain` on every new wrapper.'),
  Bul('Telemetry surface: `getInputPeak`, `getGainReduction`, `getLatency` (for lookahead).'),
  Bul('Pad toggle (nastyNeve): one-liner `setInputGain(0.1)` when on.'),
  Bul('Auto-makeup loop (iron1073): RAF-driven gain compensation in wrapper, never in worklet.'),
);
children.push(H2('Worklet / palette-level (defer until demanded)'));
children.push(
  Bul('Compressor sidechain HPF and lookahead (analogGlue).'),
  Bul('FLANGER palette module.'),
  Bul('Transient shaper module (panther TRANS).'),
  Bul('Boom oscillator module (panther BOOM, if recreated).'),
  Bul('Spring-tank IR convolver (springReverb exact).'),
);
children.push(H2('Interaction-layer (UI only, no engine impact)'));
children.push(P('None required. Every Orb in the suite stays as shipped. Adapters take whatever setters the Orb currently calls and route them into the new engine. The panther canvas, the 3 spring bobs, the 8-zone orb drag, the XY pad, the GR-history scope, the spinning tape reels, the neon CRT mode selector, the sonar sweep — none of these need changes.'));

// ========================================================================
children.push(H1('8. NON-NEGOTIABLES (repeat)'));
children.push(
  Bul('No engine redesign.'),
  Bul('No Orb redesign.'),
  Bul('No generic temporary UI for any plugin. Adapters exist so the face never changes during migration.'),
  Bul('No silent control drops. Every un-mapped legacy control is named in this document under its plugin with classification and a planned phase.'),
  Bul('No casual renames. Labels, state names, engine setter names preserved to the character where possible; renames documented when unavoidable.'),
  Bul('UI never writes DSP state directly. Path is always Legacy Orb → Adapter → Product → fx.setParam → Worklet.'),
  Bul('Manual approval remains the only way a type flips default to `nu` (unchanged from prior doc).'),
);

// ---- assemble ----
const doc = new Document({
  creator: 'Shags VST',
  title: 'Shags VST Full-Suite Legacy UI Migration Plan',
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
    ],
  },
  numbering: {
    config: [{ reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '\u2022', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 540, hanging: 270 } } } },
      { level: 1, format: LevelFormat.BULLET, text: '\u25E6', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 1080, hanging: 270 } } } },
    ]}],
  },
  sections: [{
    properties: { page: {
      size: { width: 12240, height: 15840 },
      margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    }},
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ text: 'Shags VST \u2014 Full-Suite Legacy UI Migration Plan', font: FONT, size: 18, color: '777777' })],
    })]})},
    footers: { default: new Footer({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Page ', font: FONT, size: 18, color: '777777' }),
                 new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '777777' })],
    })]})},
    children,
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT_PATH, buf);
  console.log('Wrote', OUT_PATH, buf.length, 'bytes');
});
