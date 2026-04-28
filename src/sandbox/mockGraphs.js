// Mock op-graphs, Step 2a–2b of sandbox core.
// See memory/sandbox_core_scope.md.
//
// Step 2b update: param values are now *typed* (numbers / enum strings)
// matching opRegistry.js schemas instead of free-form display strings.
// Display formatting now lives in the registry's `format(value)`.
//
// These are hand-written stand-ins for what will eventually be saved
// `graph.json` objects living on disk (or inside a brick bundle). They
// exist so we can drive the BrickZoomView visual from *data* instead of
// from hardcoded SVG, proving the IR shape. No audio is attached yet.
//
// When Step 2b lands, the op-type strings here ('delay', 'tone', 'mix',
// …) will be validated against an op registry, and the `params` shape
// will be typed per-op. For now params are free-form display strings.
//
// When Step 2c lands, at least one of these graphs (likely the toy
// Gain+Filter+Mix) becomes a real sandbox-native brick whose audio is
// produced by the ops declared here, not hand-coded DSP.
//
// ─── Schema (informal, Step 2a–2c) ──────────────────────────────────
// Wire endpoints are strings: "<id>" targets the node/terminal's first
// audio port. "<id>.<port>" targets a specific port (needed for ops
// with multiple inputs, e.g. mix.dry / mix.wet). Compiler + validator
// both understand the dot form.
// GraphMock = {
//   id:       string                — unique graph id
//   label:    string                — display label
//   canvas:   { width, height }     — SVG viewBox size
//   terminals:[                     — external boundary
//     { id, kind: 'input'|'output', x, y }
//   ]
//   nodes:    [                     — op instances
//     { id, op, x, y, w?, h?, params?: { [k]: displayString } }
//   ]
//   wires:    [                     — signal-path connections
//     { from: terminalOrNodeId, to: terminalOrNodeId }
//   ]
//   feedback: [                     — feedback connections (rendered as arcs)
//     { from: nodeId, to: nodeId, label?, value? }
//   ]
//   legend:   [                     — one-liner per distinct op used
//     { op, description }
//   ]
// }
// ─────────────────────────────────────────────────────────────────────

/**
 * Echoform mock — what the brick-zoom showed as a hardcoded SVG in the
 * Step 1b mock. Kept visually identical: IN → delay → tone → mix → OUT
 * with a feedback arc tapping after the tone op back into delay's input.
 */
export const ECHOFORM_MOCK = {
  schemaVersion: '1.0',
  id: 'echoform-mock-v0',
  label: 'EchoForm',
  canvas: { width: 720, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 217 },
    { id: 'out', kind: 'output', x: 680, y: 217 },
  ],
  nodes: [
    { id: 'n_delay',  op: 'delay',  x:  96, y: 190, params: { time: 510, feedback: 0.60 } },
    { id: 'n_filter', op: 'filter', x: 248, y: 190, params: { mode: 'lp', cutoff: 3200, q: 0.7 } },
    { id: 'n_mix',    op: 'mix',    x: 400, y: 190, params: { amount: 0.25 } },
  ],
  wires: [
    { from: 'in',       to: 'n_delay'  },
    { from: 'n_delay',  to: 'n_filter' },
    { from: 'n_filter', to: 'n_mix'    },
    { from: 'n_mix',    to: 'out'      },
  ],
  feedback: [
    { from: 'n_filter', to: 'n_delay', label: 'feedback', value: '60%' },
  ],
  // Legend entries are pulled from the op registry by id so descriptions
  // stay in lockstep with the canonical source. Order = display order.
  legendOps: ['delay', 'filter', 'mix'],
};

/**
 * SandboxToy — the first SANDBOX-NATIVE brick (Step 2c).
 * Audio is built from this graph by compileGraphToWebAudio.js.
 * Topology: IN splits into a dry leg straight to mix.dry, and a wet leg
 * through gain → filter into mix.wet. Mix amount cross-fades (equal-power).
 *
 *      ┌──── dry ──────────────────────┐
 *  IN ─┤                               ├── mix ── OUT
 *      └── gain ── filter ── wet ──────┘
 */
export const SANDBOX_TOY = {
  schemaVersion: '1.0',
  id: 'sandbox-toy-v0',
  label: 'SandboxToy',
  canvas: { width: 720, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 217 },
    { id: 'out', kind: 'output', x: 680, y: 217 },
  ],
  nodes: [
    { id: 'n_gain',   op: 'gain',   x: 120, y: 130, params: { gainDb: 0 } },
    { id: 'n_filter', op: 'filter', x: 280, y: 130, params: { mode: 'lp', cutoff: 4000, q: 0.707 } },
    { id: 'n_mix',    op: 'mix',    x: 460, y: 190, params: { amount: 0.5 } },
  ],
  wires: [
    // wet leg
    { from: 'in',       to: 'n_gain'         },
    { from: 'n_gain',   to: 'n_filter'       },
    { from: 'n_filter', to: 'n_mix.wet'      },
    // dry leg
    { from: 'in',       to: 'n_mix.dry'      },
    // out
    { from: 'n_mix',    to: 'out'            },
  ],
  feedback: [],
  legendOps: ['gain', 'filter', 'mix'],
};

/**
 * FilterFX — Step 2e demo of the panel-mapping layer.
 *
 * Same gain/filter/mix ops as SandboxToy. Same audio topology. But the
 * brick author has:
 *   - Locked gain at 0 dB (hidden, never exposed)
 *   - Locked mix at 80% (baked-in tape-ish wet-dominant character)
 *   - Locked filter mode to lp
 *   - Exposed ONE panel knob "TONE" that sweeps cutoff log 200 Hz → 12 kHz
 *
 * From the user's POV: a one-knob lo-fi tone control. From the builder's
 * POV: identical DSP to SandboxToy. Proves the personality lives in the
 * panel mapping, not the ops.
 */
export const FILTER_FX = {
  schemaVersion: '1.0',
  id: 'filter-fx-v0',
  label: 'FilterFX',
  canvas: { width: 720, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 217 },
    { id: 'out', kind: 'output', x: 680, y: 217 },
  ],
  nodes: [
    { id: 'n_gain',   op: 'gain',   x: 120, y: 130, params: { gainDb: 0 } },
    { id: 'n_filter', op: 'filter', x: 280, y: 130, params: { mode: 'lp', cutoff: 4000, q: 0.707 } },
    { id: 'n_mix',    op: 'mix',    x: 460, y: 190, params: { amount: 0.80 } },
  ],
  wires: [
    { from: 'in',       to: 'n_gain'         },
    { from: 'n_gain',   to: 'n_filter'       },
    { from: 'n_filter', to: 'n_mix.wet'      },
    { from: 'in',       to: 'n_mix.dry'      },
    { from: 'n_mix',    to: 'out'            },
  ],
  feedback: [],
  legendOps: ['gain', 'filter', 'mix'],
  // Panel = the user-facing surface. Step 2e.
  panel: {
    knobs: [
      {
        id:      'tone',
        label:   'Tone',
        default: 0.55,
        mappings: [
          { nodeId: 'n_filter', paramId: 'cutoff', range: [200, 12000], curve: 'log' },
        ],
      },
    ],
  },
};

/**
 * EchoformLite — Step 3 dogfood (sandbox-native "character delay").
 *
 * External feedback loop with Memory Man / dub-delay topology:
 *   • Drive (saturate) lives PRE-loop — colors the input so every
 *     echo inherits the driven character, but does NOT multiply loop
 *     gain. Fixes the FB·Drive > 1 runaway we caught ear-testing
 *     softLimit at FB=90% + Drive=6x (locked into steady sustain
 *     despite the clamp).
 *   • Tone (LP filter) lives INSIDE the loop — each repeat gets
 *     darker (classic dub move). Also the loop's frequency-dependent
 *     loss: loop gain = FB · filter_gain ≤ FB < 1, stable by Nyquist
 *     for all FB settings independent of Drive.
 *   • dcBlock + softLimit on the FB return are pure safety nets now
 *     (they should rarely see signal levels anywhere near the clamp).
 *
 *       ┌──────────────── fb ──────────────────────┐
 *       │                                          │
 *  IN ──┴── saturate ── delay ── filter(lp) ───────┼── mix.wet ── OUT
 *                                                  │
 *  IN ───────────────────────────────────── mix.dry┘
 *
 * Canonical refs: Memory Man / DM-2 preamp placement (drive pre-
 * loop); JOS PASP feedback stability (loop gain Nyquist); Zölzer
 * Ch.12 virtual-analog delay topology.
 *
 * Panel: TIME · FEEDBACK · TONE · DRIVE · MIX
 *
 * This graph is the forcing function that revealed delay needed an
 * external fb port. Adding `allpass`, `lfo`, 2-pole filter, and stereo
 * handling are the next ops — tracked as follow-ups, not required for
 * v1 dogfood to sound musical.
 */
export const ECHOFORM_LITE = {
  schemaVersion: '1.0',
  id: 'echoform-lite-v0',
  label: 'EchoformLite',
  canvas: { width: 780, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 220 },
    { id: 'out', kind: 'output', x: 740, y: 220 },
  ],
  nodes: [
    // Drive is PRE-loop (Memory Man topology) — colors input, stays
    // out of the loop-gain product. Dry tap forks BEFORE drive so the
    // dry leg isn't colored.
    { id: 'n_sat',     op: 'saturate', x: 110, y: 190, params: { drive: 1.6, trim: -2 } },
    { id: 'n_delay',   op: 'delay',    x: 220, y: 190, params: { time: 380, feedback: 0.55 } },
    // Tone filter INSIDE the loop — gives each repeat progressive HF
    // damping AND provides the frequency-dependent loss that makes
    // loop gain < 1 for all FB settings (Nyquist-stable by design).
    { id: 'n_filter',  op: 'filter',   x: 360, y: 190, params: { mode: 'lp', cutoff: 3200, q: 0.707 } },
    // DC trap on the FB return path — kills sub-10Hz DC buildup before it
    // self-multiplies through the feedback loop. Retires EFL-SB-02 per
    // qc_backlog.md § Sandbox Brick Audit Sweep. Post-filter / pre-
    // delay.fb so it sees the filtered tap.
    { id: 'n_dcblock', op: 'dcBlock',  x: 360, y: 290, params: { cutoff: 10 } },
    // Soft-limit on the FB return path — pure safety net now that
    // drive is pre-loop and tone provides in-loop loss. Threshold
    // back to 0.95 since loop gain is bounded by FB · filter_gain < 1
    // under all normal settings; this clamp only engages on genuinely
    // pathological input (e.g. huge DC blast that DC-block couldn't
    // catch fast enough). Retires EFL-SB-03.
    { id: 'n_softlim', op: 'softLimit', x: 480, y: 290, params: { threshold: 0.95 } },
    { id: 'n_mix',     op: 'mix',      x: 600, y: 210, params: { amount: 0.35 } },
  ],
  wires: [
    // Pre-loop drive — input hits saturate first, then enters the delay
    { from: 'in',        to: 'n_sat'      },
    { from: 'n_sat',     to: 'n_delay'    },
    // Forward path through the loop (delay → filter)
    { from: 'n_delay',   to: 'n_filter'   },
    // Post-filter signal is the wet send AND the FB tap source.
    // FB tap detours through dcBlock + softLimit so DC and clamp
    // safety are both in place before the signal re-enters delay.fb.
    { from: 'n_filter',  to: 'n_mix.wet'  },
    { from: 'n_filter',  to: 'n_dcblock'  },
    { from: 'n_dcblock', to: 'n_softlim'  },
    { from: 'n_softlim', to: 'n_delay.fb' },   // ← DC-blocked + soft-limited FB tap
    // Dry sum — dry leg taps RAW input, so drive doesn't color it
    { from: 'in',        to: 'n_mix.dry'  },
    { from: 'n_mix',     to: 'out'        },
  ],
  // Visual feedback arc so the zoom view draws the loop cleanly (the
  // wires above already make it real audio; this is just render-hint).
  feedback: [
    { from: 'n_softlim', to: 'n_delay', label: 'feedback' },
  ],
  legendOps: ['delay', 'filter', 'saturate', 'dcBlock', 'softLimit', 'mix'],
  panel: {
    knobs: [
      { id: 'time',     label: 'Time',     default: 0.35,
        mappings: [ { nodeId: 'n_delay',  paramId: 'time',     range: [40, 1200], curve: 'log' } ] },
      { id: 'feedback', label: 'Feedback', default: 0.55,
        mappings: [ { nodeId: 'n_delay',  paramId: 'feedback', range: [0, 0.9],   curve: 'lin' } ] },
      { id: 'tone',     label: 'Tone',     default: 0.45,
        mappings: [ { nodeId: 'n_filter', paramId: 'cutoff',   range: [400, 12000], curve: 'log' } ] },
      { id: 'drive',    label: 'Drive',    default: 0.25,
        mappings: [ { nodeId: 'n_sat',    paramId: 'drive',    range: [1, 6],     curve: 'pow' } ] },
      { id: 'mix',      label: 'Mix',      default: 0.35,
        mappings: [ { nodeId: 'n_mix',    paramId: 'amount',   range: [0, 1],     curve: 'lin' } ] },
    ],
  },
};

/**
 * ModDuck — Stage B-0 dogfood of the modulation layer.
 * See memory/sandbox_modulation_roadmap.md § 10 (next-in-code) + § 11
 * (findings — name chosen to telegraph "modulation test, not a real
 * comp-style ducker"; B-1 will add `gainComputer` + ship a proper
 * Compressor archetype).
 *
 * The thinnest possible slice proving modulated op-params work end-to-end:
 * a self-sidechain VCA mod. Signal is rectified by `detector`, smoothed +
 * scaled + offset by `envelope`, and the resulting control signal is wired
 * into the main `gain` op's `gainMod` AudioParam.
 *
 *            ┌── detector ── envelope ──┐   (control wire)
 *            │                          ▼
 *  IN ───────┴─────────────────── gain ── OUT
 *
 * Panel: AMOUNT (0..1 → env.amount 0..-0.9), ATTACK (ms), RELEASE (ms).
 * At AMOUNT=0 the envelope contributes nothing → flat gain. As AMOUNT
 * climbs the envelope subtracts from gain proportional to input level,
 * producing classic ducking.
 *
 * Stage B-1 will add: real AR follower (worklet), gainComputer op
 * (ratio/threshold/knee), Bézier transfer curve, and split sidechain vs.
 * main-signal paths.
 */
export const MOD_DUCK = {
  schemaVersion: '1.0',
  id: 'mod-duck-v0',
  label: 'ModDuck',
  canvas: { width: 780, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 220 },
    { id: 'out', kind: 'output', x: 740, y: 220 },
  ],
  nodes: [
    // Envelope-duck sidechain (visual: top row)
    { id: 'n_det',      op: 'detector', x: 160, y:  60, params: { mode: 'peak' } },
    { id: 'n_env',      op: 'envelope', x: 320, y:  60, params: {
        // env.amount is baked at -1 (fixed polarity); the user AMOUNT knob
        // routes through n_envDepth downstream.
        attack: 5, release: 120, amount: -1, offset: 0,
    } },
    { id: 'n_envDepth', op: 'scaleBy',  x: 480, y:  60, params: { k: 0.5 } },

    // LFO-pump path (visual: middle row). LFO amount is baked at -0.5 so
    // its bipolar [-1..1] output becomes unipolar-downward [-0.5..+0.5]
    // centered on 0 via the +0.5 offset → downstream scaleBy scales that
    // pre-centered pump. That keeps the "duck" polarity identical to the
    // envelope path (always pulls gain *down*, never above unity).
    //
    // Actually simpler + more intuitive: keep LFO raw bipolar, let the
    // user's LFO DEPTH knob do the polarity math through scaleBy. Below:
    // LFO outputs [-1..1], scaleBy k ∈ [0, 0.45] → [-0.45..+0.45] summed
    // into gain.gain=1 gives [0.55..1.45]. Unbounded upwards is fine for
    // v0 — a gain of 1.45× on peaks sounds like *accent* rather than
    // boost, and the envelope duck usually wins anyway. Stage B-1 can
    // add a clamp op if needed.
    { id: 'n_lfo',      op: 'lfo',      x: 160, y: 130, params: { rateHz: 2, shape: 0, amount: 1, offset: 0 } },
    { id: 'n_lfoDepth', op: 'scaleBy',  x: 320, y: 130, params: { k: 0 } },

    // Main signal path (visual: bottom row)
    { id: 'n_gain',     op: 'gain',     x: 560, y: 220, params: { gainDb: 0 } },
  ],
  wires: [
    // Envelope sidechain tap (self-sidechain)
    { from: 'in',          to: 'n_det'          },
    { from: 'n_det',       to: 'n_env'          },
    { from: 'n_env',       to: 'n_envDepth'     },
    { from: 'n_envDepth',  to: 'n_gain.gainMod' }, // sum 1
    // LFO pump path (no input — pure source)
    { from: 'n_lfo',       to: 'n_lfoDepth'     },
    { from: 'n_lfoDepth',  to: 'n_gain.gainMod' }, // sum 2 (AudioParam sums inputs)
    // Main signal path
    { from: 'in',          to: 'n_gain'         },
    { from: 'n_gain',      to: 'out'            },
  ],
  feedback: [],
  legendOps: ['detector', 'envelope', 'scaleBy', 'lfo', 'gain'],
  panel: {
    knobs: [
      // AMOUNT = envelope duck depth. 0 → no env ducking, 1 → -0.9 gain mod.
      { id: 'amount',  label: 'Amount',  default: 0.5,
        mappings: [ { nodeId: 'n_envDepth', paramId: 'k', range: [0, 0.9], curve: 'lin' } ] },
      // RATE = LFO frequency. Log-tapered so slow rates (0.1–2 Hz) get the
      // lion's share of the knob travel — that's the musical sweet spot.
      { id: 'rate',    label: 'Rate',    default: 0.45,
        mappings: [ { nodeId: 'n_lfo', paramId: 'rateHz', range: [0.1, 20], curve: 'log' } ] },
      // MOD = LFO depth. 0 → pure self-duck (pre-LFO behavior). Max 0.45
      // keeps ±gain swing within about ±3.2 dB per cycle when env contributes
      // nothing — musical, not splatty.
      { id: 'mod',     label: 'Mod',     default: 0.0,
        mappings: [ { nodeId: 'n_lfoDepth', paramId: 'k', range: [0, 0.45], curve: 'lin' } ] },
      { id: 'attack',  label: 'Attack',  default: 0.25,
        mappings: [ { nodeId: 'n_env', paramId: 'attack',  range: [3, 150], curve: 'log' } ] },
      { id: 'release', label: 'Release', default: 0.4,
        mappings: [ { nodeId: 'n_env', paramId: 'release', range: [20, 800],  curve: 'log' } ] },
    ],
  },
};

/**
 * ToyComp — minimal downward compressor, dogfood for the gainComputer op.
 *
 *  IN ─┬─── detector ── envelope ── gainComputer ─┐
 *      │                                           │
 *      │                                           ▼
 *      └──────────────── gain.in          gain.gainMod
 *                         gain.out ──────────────── OUT
 *
 * Panel (5 knobs, stock-comp order):
 *   THRESHOLD · RATIO · ATTACK · RELEASE · MAKEUP
 *
 * env.amount is baked at +1 (linear magnitude — gainComputer needs positive
 * magnitude input, unlike ModDuck which bakes -1 for pulling gain down).
 * Knee is baked at 6 dB for the toy — exposed as a param for future bricks.
 *
 * Post-gain makeup: a SECOND gain op downstream restores level. Threshold
 * knob drops average level; makeup brings it back up. Classic comp UX.
 *
 * This brick is the second sandbox-native dogfood after ModDuck. If its
 * A/B matches hand-coded comps, the sandbox compiler has earned its keep.
 */
export const TOY_COMP = {
  schemaVersion: '1.0',
  id: 'toy-comp-v0',
  label: 'ToyComp',
  canvas: { width: 860, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 220 },
    { id: 'out', kind: 'output', x: 820, y: 220 },
  ],
  nodes: [
    // Sidechain: detector → envelope (magnitude) → gainComputer → GR signal.
    { id: 'n_det',   op: 'detector',     x: 160, y:  70, params: { mode: 'peak' } },
    { id: 'n_env',   op: 'envelope',     x: 310, y:  70, params: {
        attack: 5, release: 120, amount: 1, offset: 0,
    } },
    { id: 'n_comp',  op: 'gainComputer', x: 480, y:  70, params: {
        thresholdDb: -18, ratio: 4, kneeDb: 6,
    } },
    // Main signal path: gain (VCA, controlled by comp GR) → makeup gain.
    { id: 'n_vca',    op: 'gain', x: 560, y: 220, params: { gainDb: 0 } },
    { id: 'n_makeup', op: 'gain', x: 720, y: 220, params: { gainDb: 0 } },
  ],
  wires: [
    // Sidechain tap (self-sidechain)
    { from: 'in',      to: 'n_det'           },
    { from: 'n_det',   to: 'n_env'           },
    { from: 'n_env',   to: 'n_comp'          },
    { from: 'n_comp',  to: 'n_vca.gainMod'   },
    // Main path
    { from: 'in',      to: 'n_vca'           },
    { from: 'n_vca',   to: 'n_makeup'        },
    { from: 'n_makeup', to: 'out'            },
  ],
  feedback: [],
  legendOps: ['detector', 'envelope', 'gainComputer', 'gain'],
  panel: {
    knobs: [
      { id: 'threshold', label: 'Threshold', default: 0.7,
        mappings: [ { nodeId: 'n_comp', paramId: 'thresholdDb', range: [-40, 0], curve: 'lin' } ] },
      { id: 'ratio',     label: 'Ratio', default: 0.25,
        mappings: [ { nodeId: 'n_comp', paramId: 'ratio', range: [1, 20], curve: 'log' } ] },
      { id: 'attack',    label: 'Attack', default: 0.15,
        mappings: [ { nodeId: 'n_env', paramId: 'attack', range: [0.5, 100], curve: 'log' } ] },
      { id: 'release',   label: 'Release', default: 0.45,
        mappings: [ { nodeId: 'n_env', paramId: 'release', range: [20, 1000], curve: 'log' } ] },
      { id: 'makeup',    label: 'Makeup', default: 0.0,
        mappings: [ { nodeId: 'n_makeup', paramId: 'gainDb', range: [0, 18], curve: 'lin' } ] },
    ],
  },
};

/**
 * LofiLight — minimal sandbox dogfood of the Lofi Loofy archetype.
 *
 * Scope intentionally narrow: ~30 % of full LL (tone + drive + drift +
 * dust + mix). No character presets, no crush/pump/glue parallel comp,
 * no dream reverb, no dropouts, no boom/bits/rate. Those land as more
 * ops or as v2 once this v0 proves the compiler can host LL-shape DSP.
 *
 *   in ─► toneTilt(shelf) ─► toneLP(filter) ─► satShape(saturate) ─┐
 *                                                                   │
 *                                        tapeDelay(delay) ──► mix.wet
 *                                          ▲
 *                                          │ timeMod ← lfo→scaleBy (drift)
 *   in ─────────────────────────────────────────────────────► mix.dry
 *   noise ─► scaleBy (dust) ──────────────────────────────────► mix.wet
 *
 *   mix ─► out
 *
 * Known v0 deviations from full LL:
 *  • Single saturation stage (not the satShape + crushShape pair).
 *  • No dry-compensation — mix=0 will NOT null because wet path adds
 *    ~1 quantum of processing latency. This is the same class of problem
 *    LL engine_v1 has (see CONFORMANCE §8.6) and gets fixed later by
 *    moving mix inside a master worklet.
 *  • Dust now parallel — sums into `out` post-mix, so MIX=0 still
 *    passes dust. Matches authentic LL topology.
 */
export const LOFI_LIGHT = {
  schemaVersion: '1.0',
  id: 'loofy-lite-v0',
  label: 'LofiLight',
  canvas: { width: 900, height: 380 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 240 },
    { id: 'out', kind: 'output', x: 860, y: 240 },
  ],
  nodes: [
    // Main wet path (bottom row)
    { id: 'n_tilt',  op: 'shelf',    x: 140, y: 240, params: { mode: 'low',  freq:  250, gainDb: 0 } },
    { id: 'n_tone',  op: 'filter',   x: 260, y: 240, params: { mode: 'lp',   cutoff: 6000, q: 0.707 } },
    { id: 'n_sat',   op: 'saturate', x: 380, y: 240, params: { drive: 1.5, trim: -1.5 } },
    { id: 'n_tape',  op: 'delay',    x: 500, y: 240, params: { time: 30, feedback: 0 } },
    // Digital-wear stage — bits (WaveShaper quantizer) → rate (biquad LP
    // at target/2 as ZOH proxy, per LL §4.5). Off by default (bits=0,
    // cutoff=20000) so the clean path is still clean until you engage.
    { id: 'n_bits',  op: 'bitcrush', x: 600, y: 240, params: { bits: 0 } },
    { id: 'n_rate',  op: 'filter',   x: 690, y: 240, params: { mode: 'lp', cutoff: 20000, q: 0.707 } },
    { id: 'n_mix',   op: 'mix',      x: 790, y: 240, params: { amount: 0.5 } },

    // Drift LFO (top-left) → delay.timeMod
    { id: 'n_lfo',    op: 'lfo',     x: 260, y: 110, params: { rateHz: 0.5, shape: 0, amount: 1, offset: 0 } },
    { id: 'n_driftK', op: 'scaleBy', x: 400, y: 110, params: { k: 0.002 } }, // ±2 ms max, knob-scaled

    // Dust bus (top-right) → mix.wet (sums with tape output)
    { id: 'n_noise', op: 'noise',    x: 260, y: 350, params: { shape: 'pink', amount: 1, offset: 0 } },
    { id: 'n_dustK', op: 'scaleBy',  x: 400, y: 350, params: { k: 0 } },
  ],
  wires: [
    // Dry leg (to mix.dry)
    { from: 'in',        to: 'n_mix.dry'     },
    // Wet chain
    { from: 'in',        to: 'n_tilt'        },
    { from: 'n_tilt',    to: 'n_tone'        },
    { from: 'n_tone',    to: 'n_sat'         },
    { from: 'n_sat',     to: 'n_tape'        },
    { from: 'n_tape',    to: 'n_bits'        },
    { from: 'n_bits',    to: 'n_rate'        },
    { from: 'n_rate',    to: 'n_mix.wet'     },
    // Drift: LFO → scale → delay.timeMod (AudioParam sum)
    { from: 'n_lfo',     to: 'n_driftK'      },
    { from: 'n_driftK',  to: 'n_tape.timeMod' },
    // Dust: noise → scale → out (PARALLEL — sums post-mix so MIX=0 still
    // passes dust. Authentic LL topology per CONFORMANCE §8.6.)
    { from: 'n_noise',   to: 'n_dustK'       },
    { from: 'n_dustK',   to: 'out'           },
    // Output
    { from: 'n_mix',     to: 'out'           },
  ],
  feedback: [],
  legendOps: ['shelf', 'filter', 'saturate', 'delay', 'bitcrush', 'mix', 'lfo', 'scaleBy', 'noise'],
  panel: {
    knobs: [
      // TONE: single knob that sweeps the wet-path voicing — dark to bright.
      // Drives the LP cutoff; future v1 also tilts the shelf.
      { id: 'tone',  label: 'Tone',   default: 0.55,
        mappings: [ { nodeId: 'n_tone',  paramId: 'cutoff', range: [800, 16000], curve: 'log' } ] },
      // DRIVE: saturation drive. Log taper so the bottom of the range
      // (where "warmth" lives) gets the travel.
      { id: 'drive', label: 'Drive',  default: 0.15,
        mappings: [ { nodeId: 'n_sat',   paramId: 'drive',  range: [1, 10], curve: 'log' } ] },
      // DRIFT: depth of the LFO modulating the tape delay time. The LFO
      // runs at a fixed 0.5 Hz here (LL uses 0.35–0.8); depth is the
      // interesting axis for MVP.
      { id: 'drift', label: 'Drift',  default: 0.0,
        mappings: [ { nodeId: 'n_driftK', paramId: 'k', range: [0, 0.008], curve: 'lin' } ] },
      // DUST: pink-noise bed level. Goes straight to mix.wet with the
      // tape output summed. v1 will route it around mix for authentic LL.
      { id: 'dust',  label: 'Dust',   default: 0.0,
        mappings: [ { nodeId: 'n_dustK',  paramId: 'k', range: [0, 0.2], curve: 'log' } ] },
      // BITS: quantization depth. 0 = off (clean passthrough in the
      // bitcrush op); knob up = heavier crush. Range maps knob 0..1 →
      // 16..4 bits so "more" reads as "more crush". At knob=0 we clamp
      // to the op's off-value (0) to guarantee bypass.
      { id: 'bits',  label: 'Bits',   default: 0.0,
        mappings: [ { nodeId: 'n_bits',  paramId: 'bits', range: [16, 4], curve: 'lin' } ] },
      // RATE: sample-rate proxy. Knob up = darker / lower target SR. Maps
      // 0..1 → 20kHz..800Hz via log taper (LP cutoff as ZOH proxy per LL
      // §4.5). At knob=0 the op is effectively off.
      { id: 'rate',  label: 'Rate',   default: 0.0,
        mappings: [ { nodeId: 'n_rate',  paramId: 'cutoff', range: [20000, 800], curve: 'log' } ] },
      // MIX: dry/wet crossfade. Equal-power.
      { id: 'mix',   label: 'Mix',    default: 1.0,
        mappings: [ { nodeId: 'n_mix',   paramId: 'amount', range: [0, 1], curve: 'lin' } ] },
    ],
  },
};

/**
 * FdnHall — Tier-3 dogfood. First sandbox reverb.
 *
 * Thinnest shape possible: a single `fdnReverb` op between in and out.
 * All 7 reverb controls mapped 1:1 to panel knobs. Proves the sandbox
 * compiler can host a stereo feedback-heavy DSP archetype via a
 * monolithic op. The op itself is a faithful port of morphReverbEngine.js
 * (Geraint Luff FDN + Hadamard diffuser + Householder FB matrix).
 *
 *   in ──► fdnReverb ──► out
 *
 * Re-decomposition into delay/matrix/shelf primitives waits for the
 * master-worklet compiler (Stage 3), when feedback-cycle graph support
 * actually exists.
 */
export const FDN_HALL = {
  schemaVersion: '1.0',
  id: 'fdn-hall-v0',
  label: 'FdnHall',
  canvas: { width: 540, height: 260 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 130 },
    { id: 'out', kind: 'output', x: 500, y: 130 },
  ],
  nodes: [
    { id: 'n_rev', op: 'fdnReverb', x: 220, y: 110, params: {
        morph: 0.5, size: 0.55, decay: 0.5, tone: 0.55,
        density: 0.6, warp: 0.3, mix: 0.3,
    } },
  ],
  wires: [
    { from: 'in',    to: 'n_rev' },
    { from: 'n_rev', to: 'out'   },
  ],
  feedback: [],
  legendOps: ['fdnReverb'],
  panel: {
    knobs: [
      { id: 'morph',   label: 'Morph',   default: 0.5,
        mappings: [{ nodeId: 'n_rev', paramId: 'morph',   range: [0, 1], curve: 'lin' }] },
      { id: 'size',    label: 'Size',    default: 0.55,
        mappings: [{ nodeId: 'n_rev', paramId: 'size',    range: [0, 1], curve: 'lin' }] },
      { id: 'decay',   label: 'Decay',   default: 0.5,
        mappings: [{ nodeId: 'n_rev', paramId: 'decay',   range: [0, 1], curve: 'lin' }] },
      { id: 'tone',    label: 'Tone',    default: 0.55,
        mappings: [{ nodeId: 'n_rev', paramId: 'tone',    range: [0, 1], curve: 'lin' }] },
      { id: 'density', label: 'Density', default: 0.6,
        mappings: [{ nodeId: 'n_rev', paramId: 'density', range: [0, 1], curve: 'lin' }] },
      { id: 'warp',    label: 'Warp',    default: 0.3,
        mappings: [{ nodeId: 'n_rev', paramId: 'warp',    range: [0, 1], curve: 'lin' }] },
      { id: 'mix',     label: 'Mix',     default: 0.3,
        mappings: [{ nodeId: 'n_rev', paramId: 'mix',     range: [0, 1], curve: 'lin' }] },
    ],
  },
};

/**
 * PultecLite — sandbox-native Pultec EQP-1A homage. Recipe #19 from
 * memory/recipe_library.md, with manual locked at docs/primary_sources/pultec/.
 *
 * Topology:
 *   IN → lfBoost(peaking, Q=0.7) → lfAtten(peaking, Q=1.0)
 *      → hfBoost(peaking, Q=1.5) → hfAtten(shelf, high)
 *      → saturate (4× OS tanh makeup) → OUT
 *
 * The "Pultec trick" emerges naturally: LF boost (wider Q=0.7) + LF atten
 * (narrower Q=1.0) at the SAME stepped freq → boost shoulders spread out
 * while atten cuts deep at center → shelf-with-dip shape. Set both to
 * ~+8 dB for the classic kick-low "boost everything except 60 Hz" sound.
 *
 * Lite scope (declared deviations from real Pultec):
 *   • LF + HF freq knobs sweep continuously over the canonical range
 *     (real Pultec is rotary-stepped at 20/30/60/100 Hz LF and
 *     3/4/5/8/10/12/16 kHz HF). v2 will discretize.
 *   • HF Q (BANDWIDTH knob on real unit) fixed at 1.5 — characteristic
 *     bell width.
 *   • Makeup stage is `saturate` (tanh soft-clip, 4× oversampled) instead
 *     of `tubeSim` (Koren 12AX7 plate-current model). Saturate has a
 *     WebAudio factory; tubeSim is worklet-only and the sandbox compiler
 *     uses native WebAudio nodes for time-to-first-sound speed. v2 graph
 *     can swap to tubeSim once the worklet path lands in the compiler.
 *   • Output transformer (xformerSat #139 with `tubeOT` preset) skipped
 *     for v1.
 *   • Tube is post-EQ here; real Pultec has the makeup amp inside the
 *     EQ feedback loop. Static frequency response identical; dynamic
 *     coupling simplified — declared deviation.
 *
 * Panel: LF FREQ · LF BOOST · LF ATTEN · HF FREQ · HF BOOST · HF ATTEN · DRIVE
 */
export const PULTEC_LITE = {
  schemaVersion: '1.0',
  id: 'pultec-lite-v0',
  label: 'PultecLite',
  canvas: { width: 900, height: 280 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 140 },
    { id: 'out', kind: 'output', x: 860, y: 140 },
  ],
  nodes: [
    { id: 'n_lfBoost', op: 'filter', x: 140, y: 120,
      params: { mode: 'peaking', cutoff: 60,    q: 0.7, gainDb: 0 } },
    { id: 'n_lfAtten', op: 'filter', x: 280, y: 120,
      params: { mode: 'peaking', cutoff: 60,    q: 1.0, gainDb: 0 } },
    { id: 'n_hfBoost', op: 'filter', x: 420, y: 120,
      params: { mode: 'peaking', cutoff: 8000,  q: 1.5, gainDb: 0 } },
    { id: 'n_hfAtten', op: 'shelf',  x: 560, y: 120,
      params: { mode: 'high',    freq:   10000, gainDb: 0 } },
    { id: 'n_drive',   op: 'saturate', x: 700, y: 120,
      params: { drive: 1.0, trim: 0 } },
  ],
  wires: [
    { from: 'in',         to: 'n_lfBoost' },
    { from: 'n_lfBoost',  to: 'n_lfAtten' },
    { from: 'n_lfAtten',  to: 'n_hfBoost' },
    { from: 'n_hfBoost',  to: 'n_hfAtten' },
    { from: 'n_hfAtten',  to: 'n_drive'   },
    { from: 'n_drive',    to: 'out'       },
  ],
  feedback: [],
  legendOps: ['filter', 'shelf', 'saturate'],
  panel: {
    knobs: [
      { id: 'lfFreq',  label: 'LF FREQ',  default: 0.35,
        // 0..1 → 20..100 Hz log on the BOOST (matches canonical 20/30/60/100
        // dial stops). The ATTEN center is offset to a higher frequency
        // (boost × ~2.5) — this mirrors the real Pultec LCR network design
        // where boost and atten don't overlap exactly. Selecting 60 Hz on
        // the dial lifts the punch at 60 AND carves the mud at ~150.
        // Reference: A Designs Audio + MusicRadar Pultec-trick teardowns.
        mappings: [
          { nodeId: 'n_lfBoost', paramId: 'cutoff', range: [20, 100],  curve: 'log' },
          { nodeId: 'n_lfAtten', paramId: 'cutoff', range: [50, 250],  curve: 'log' },
        ] },
      { id: 'lfBoost', label: 'LF BOOST', default: 0.0,
        mappings: [{ nodeId: 'n_lfBoost', paramId: 'gainDb', range: [0, 12],   curve: 'lin' }] },
      { id: 'lfAtten', label: 'LF ATTEN', default: 0.0,
        // Negative gainDb on n_lfAtten = cut. Range maps 0..1 → 0..-12 dB.
        mappings: [{ nodeId: 'n_lfAtten', paramId: 'gainDb', range: [0, -12],  curve: 'lin' }] },
      { id: 'hfFreq',  label: 'HF FREQ',  default: 0.55,
        // 0..1 → 3..16 kHz log.
        mappings: [{ nodeId: 'n_hfBoost', paramId: 'cutoff', range: [3000, 16000], curve: 'log' }] },
      { id: 'hfBoost', label: 'HF BOOST', default: 0.0,
        mappings: [{ nodeId: 'n_hfBoost', paramId: 'gainDb', range: [0, 12],   curve: 'lin' }] },
      { id: 'hfAtten', label: 'HF ATTEN', default: 0.0,
        // Shelf cut: 0..1 → 0..-12 dB.
        mappings: [{ nodeId: 'n_hfAtten', paramId: 'gainDb', range: [0, -12],  curve: 'lin' }] },
      { id: 'drive',   label: 'DRIVE',    default: 0.0,
        // saturate drive: 0..1 → 1..4 (unity to characterful tanh push).
        mappings: [{ nodeId: 'n_drive',   paramId: 'drive',  range: [1, 4],    curve: 'lin' }] },
    ],
  },
};

/**
 * VintageAmp — sandbox-native homage to British/American tube guitar amps.
 * Recipes #1 (Marshall JTM45) / #2 (Vox AC30) / #3 (Fender Twin) /
 * #4 (Fender Tweed) all map to one chassis with different presets.
 *
 * Three-tube signal path mirrors the canonical guitar-amp anatomy:
 *
 *    IN → tube₁ (preamp, 12AX7) → BASS shelf → MID peak → TREBLE shelf
 *       → tube₂ (driver / phase-inverter, 12AT7-style)
 *       → tube₃ (power amp, EL34 / 6L6)
 *       → cab LP (6 kHz rolloff) → cab peak (2.5 kHz speaker bump)
 *       → master gain → OUT
 *
 * Each tube is `saturate` (4×-OS tanh waveshaper) with different drive
 * ranges to mimic the harmonic profile of each stage:
 *   • Tube 1 (preamp): user-driven 1..8 — sets the dirt
 *   • Tube 2 (driver): fixed mild drive ~1.6 — tone-shaping glue, adds
 *     2nd-harmonic warmth between preamp + power
 *   • Tube 3 (power): scales with MASTER 1..4 — push-pull crunch when
 *     turned up, clean compression when down
 *
 * Tone stack lives BETWEEN tubes 1 and 2 — historically the Marshall /
 * Fender position. Vox places it post-power; that's an alternate routing
 * for v2 with a `voicing` preset switch.
 *
 * Cab sim is a 2-filter approximation: 6 kHz LP rolls off the post-power
 * fizz (real cab cone resonance + voice-coil inductance), and a +4 dB
 * peak at 2.5 kHz emulates the SM57-on-12-inch-Celestion bump that's on
 * every classic record. Crude vs a real IR but ~95% of the character
 * for ~5% of the CPU. v2 swaps to convolution when the IR loader lands.
 *
 * Lite scope (declared deviations from real amps):
 *   • saturate tanh ≠ Koren plate-current model — same family of curves,
 *     simpler harmonics. v2 swaps in tubeSim once the worklet path lands
 *     in the WebAudio compiler.
 *   • No output transformer — xformerSat is queued for v2.
 *   • No bias / sag / compression-pumping (real amps sag under power).
 *   • No reverb tank — Twin's spring is its own brick.
 *   • Tone stack is a 3-band parametric, not the actual Fender/Marshall
 *     interactive R-C network. Frequency response close enough that the
 *     same knob positions land in the same musical neighborhood.
 *
 * Panel: DRIVE · BASS · MID · TREBLE · PRESENCE · MASTER
 */
export const VINTAGE_AMP = {
  schemaVersion: '1.0',
  id: 'vintage-amp-v0',
  label: 'VintageAmp',
  canvas: { width: 1100, height: 280 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 140 },
    { id: 'out', kind: 'output', x: 1060, y: 140 },
  ],
  nodes: [
    // ── Tube 1 — preamp drive (12AX7 voiced) ──
    { id: 'n_t1',     op: 'saturate', x: 120, y: 100,
      params: { drive: 2.5, trim: 0 } },

    // ── Tone stack (between t1 and t2 — Marshall / Fender layout) ──
    { id: 'n_bass',   op: 'shelf',  x: 240, y: 100,
      params: { mode: 'low',  freq:  120,  gainDb: 0 } },
    { id: 'n_mid',    op: 'filter', x: 360, y: 100,
      params: { mode: 'peaking', cutoff: 700, q: 0.9, gainDb: 0 } },
    { id: 'n_treble', op: 'shelf',  x: 480, y: 100,
      params: { mode: 'high', freq: 4000,  gainDb: 0 } },

    // ── Tube 2 — driver / phase-inverter (12AT7 voiced, milder) ──
    { id: 'n_t2',     op: 'saturate', x: 600, y: 100,
      params: { drive: 1.6, trim: 0 } },

    // ── Tube 3 — power amp (EL34 / 6L6, scales with master) ──
    { id: 'n_t3',     op: 'saturate', x: 720, y: 100,
      params: { drive: 1.0, trim: 0 } },

    // ── Cab sim — LP rolloff + 2.5 kHz speaker bump ──
    { id: 'n_cabLP',  op: 'filter', x: 820, y: 100,
      params: { mode: 'lp',      cutoff: 6000, q: 0.707, gainDb: 0 } },
    { id: 'n_cabPk',  op: 'filter', x: 920, y: 100,
      params: { mode: 'peaking', cutoff: 2500, q: 1.4,   gainDb: 4.0 } },

    // ── Glue comp — baked-in 1-2 dB GR averaging across the program.
    //    Same topology as ToyComp (detector → envelope → gainComputer →
    //    VCA gainMod) but with always-on glue settings: low threshold,
    //    gentle ratio, slow attack so transients pass, quick release so
    //    it doesn't pump. No user controls — this is the "tying it all
    //    together" character that every studio amp DI gets from a real
    //    bus comp downstream. Knit, don't squash.
    { id: 'n_glueDet', op: 'detector',     x: 980, y:  20,
      params: { mode: 'peak' } },
    { id: 'n_glueEnv', op: 'envelope',     x: 980, y:  60,
      params: { attack: 30, release: 120, amount: 1, offset: 0 } },
    { id: 'n_glueGC',  op: 'gainComputer', x: 980, y: 100,
      params: { thresholdDb: -16, ratio: 1.8, kneeDb: 8 } },
    { id: 'n_glueVca', op: 'gain',         x: 980, y: 140,
      params: { gainDb: 0 } },

    // ── Hum bed — three noise sources shaped into the harmonic profile
    //    of a real amp at idle: 60 Hz mains rumble + 120 Hz rectifier
    //    buzz + broadband tube hiss. lfo can't go above 40 Hz (k-rate
    //    sub-audio control source), so we use white noise → resonant
    //    bandpass filters to "tune" noise to the hum frequencies. Net
    //    result is more authentic than pure sines anyway because real
    //    amp hum has flicker-noise modulation on the carriers.
    { id: 'n_humSrc60',  op: 'noise',  x: 140, y: 200,
      params: { shape: 'white', amount: 4.0, offset: 0 } },
    { id: 'n_humBP60',   op: 'filter', x: 260, y: 200,
      // Tight Q — keeps the resonance focused on 60 Hz, low rumble only.
      params: { mode: 'bp', cutoff: 60, q: 7 } },
    { id: 'n_humSrc120', op: 'noise',  x: 380, y: 200,
      // Much quieter source than 60 Hz — 120 Hz ripple is supporting
      // character, not the main event. Real amps have 120 < 60 in level.
      params: { shape: 'white', amount: 1.5, offset: 0 } },
    { id: 'n_humBP120',  op: 'filter', x: 500, y: 200,
      params: { mode: 'bp', cutoff: 120, q: 6 } },
    // Tube hiss is barely there — just a touch above the noise floor.
    // Was masking the LF hum tones at the previous level (0.08).
    { id: 'n_humHiss',   op: 'noise',  x: 620, y: 200,
      params: { shape: 'pink', amount: 0.015, offset: 0 } },
    // n_humLevel: -60 dB floor (off), -6 dB top (audibly present idle
    // hum without becoming the dominant feature). Sums to `out` post-
    // master so it stays present regardless of master position.
    { id: 'n_humLevel',  op: 'gain',  x: 760, y: 200,
      params: { gainDb: -60 } },

    // ── Master volume ──
    { id: 'n_master', op: 'gain',   x: 1010, y: 100,
      params: { gainDb: 0 } },
  ],
  wires: [
    // Main audio path
    { from: 'in',         to: 'n_t1'     },
    { from: 'n_t1',       to: 'n_bass'   },
    { from: 'n_bass',     to: 'n_mid'    },
    { from: 'n_mid',      to: 'n_treble' },
    { from: 'n_treble',   to: 'n_t2'     },
    { from: 'n_t2',       to: 'n_t3'     },
    { from: 'n_t3',       to: 'n_cabLP'  },
    { from: 'n_cabLP',    to: 'n_cabPk'  },
    // Glue comp — sidechain off cabPk into detector→env→GC,
    // GR drives n_glueVca.gainMod. Audio goes through n_glueVca.
    { from: 'n_cabPk',    to: 'n_glueDet'         },
    { from: 'n_glueDet',  to: 'n_glueEnv'         },
    { from: 'n_glueEnv',  to: 'n_glueGC'          },
    { from: 'n_glueGC',   to: 'n_glueVca.gainMod' },
    { from: 'n_cabPk',    to: 'n_glueVca'         },
    { from: 'n_glueVca',  to: 'n_master'          },

    // Hum bed — noise → resonant BP for 60 Hz mains, same for 120 Hz
    // ripple, plus broadband pink noise for tube hiss. All three sum
    // into n_humLevel (WebAudio GainNode auto-sums multiple connect()s),
    // which sums DIRECTLY to `out` alongside n_master — bypassing the
    // master volume so hum stays audible regardless of master position
    // (matches real amp behavior: heater hum bypasses the master vol
    // pot, comes from heater wires + power supply ripple).
    { from: 'n_humSrc60',  to: 'n_humBP60'   },
    { from: 'n_humBP60',   to: 'n_humLevel'  },
    { from: 'n_humSrc120', to: 'n_humBP120'  },
    { from: 'n_humBP120',  to: 'n_humLevel'  },
    { from: 'n_humHiss',   to: 'n_humLevel'  },
    { from: 'n_humLevel',  to: 'out'         },

    { from: 'n_master',   to: 'out'      },
  ],
  feedback: [],
  legendOps: ['saturate', 'shelf', 'filter', 'noise', 'gain', 'detector', 'envelope', 'gainComputer'],
  panel: {
    knobs: [
      { id: 'drive',    label: 'DRIVE',    default: 0.25,
        // Preamp tube drive: 0..1 → 1..8 (clean to slammed)
        mappings: [{ nodeId: 'n_t1', paramId: 'drive', range: [1, 8], curve: 'lin' }] },
      { id: 'bass',     label: 'BASS',     default: 0.5,
        // 0..1 → -12..+12 dB, centered
        mappings: [{ nodeId: 'n_bass', paramId: 'gainDb', range: [-12, 12], curve: 'lin' }] },
      { id: 'mid',      label: 'MID',      default: 0.5,
        mappings: [{ nodeId: 'n_mid',  paramId: 'gainDb', range: [-12, 12], curve: 'lin' }] },
      { id: 'treble',   label: 'TREBLE',   default: 0.5,
        mappings: [{ nodeId: 'n_treble', paramId: 'gainDb', range: [-12, 12], curve: 'lin' }] },
      { id: 'presence', label: 'PRESENCE', default: 0.4,
        // Cab peak (the SM57 "bump" intensity): 0..1 → 0..+9 dB
        mappings: [{ nodeId: 'n_cabPk', paramId: 'gainDb', range: [0, 9], curve: 'lin' }] },
      { id: 'master',   label: 'MASTER',   default: 0.3,
        // Drives BOTH tube 3 (power amp drive) AND master gain.
        // 0..1 → power-tube drive 1..4 + master gain -24..0 dB.
        mappings: [
          { nodeId: 'n_t3',     paramId: 'drive',  range: [1, 4],     curve: 'lin' },
          { nodeId: 'n_master', paramId: 'gainDb', range: [-24, 0],   curve: 'lin' },
        ] },
      { id: 'hum',      label: 'HUM',      default: 0.0,
        // 0..1 → -60..-6 dB on the hum-bed gain. -60 = floor (off),
        // -6 = audibly present idle hum without dominating the signal.
        // The hum bed sums directly to `out` (post-master) so it stays
        // audible regardless of master position.
        mappings: [
          { nodeId: 'n_humLevel', paramId: 'gainDb', range: [-60, -6], curve: 'lin' },
        ] },
    ],
  },
};

/**
 * TapeSat — sandbox-native magnetic tape saturation. Recipe #13 from
 * memory/recipe_library.md (Studer / Ampex tape compression family).
 *
 * Three-layer character stack:
 *
 *   1. Pre-emphasis / de-emphasis trick — boost HF before the saturator,
 *      cut HF after. Net frequency response stays flat, but the saturator
 *      hits HF harder, putting the distortion energy in the highs where
 *      the ear is more forgiving. This is THE move that makes tape sound
 *      "smooth" instead of "honky." NAB / IEC tape standards both rely
 *      on this; we approximate with complementary +/-6 dB high shelves.
 *
 *   2. Head bump — gentle peak at ~75 Hz from the playback head's
 *      frequency response. The signature "tape weight" on kick + bass.
 *
 *   3. HF rolloff — gradual LP at 12-18 kHz (lower for cassette) from
 *      tape-head gap loss. The thing that makes tape feel "warmer" —
 *      it's literally less HF energy.
 *
 * Topology:
 *
 *      ┌──────────────────────────────────────────────── mix.dry ──┐
 *      │                                                            │
 *      IN ─► drive ─► preE(+HF) ─► sat ─► deE(-HF) ─► hb ─► hfR ───► mix.wet
 *                                                                    │
 *                                                            mix ──► trim ──► OUT
 *
 * Lite scope (declared deviations from real tape machines):
 *   • saturate tanh ≠ Bezier-Olafsson tape model — same family of soft
 *     curves, simpler harmonics. v2 swaps in a dedicated tape worklet.
 *   • No wow/flutter (delay-line modulation is wired up but commented
 *     out — tuning a non-seasick wow needs a careful pass; queue for v2).
 *   • No bias-curve nonlinearity, no print-through, no asymmetric
 *     hysteresis. Those are the deltas a real tape machine has over a
 *     simple soft-clipper.
 *   • Pre/de-emph slopes are fixed 6 dB shelves, not the curved NAB/IEC
 *     standard curves.
 *
 * Panel: DRIVE · HEAD · HF · MIX · TRIM
 */
export const TAPE_SAT = {
  schemaVersion: '1.0',
  id: 'tape-sat-v0',
  label: 'TapeSat',
  canvas: { width: 980, height: 280 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 140 },
    { id: 'out', kind: 'output', x: 940, y: 140 },
  ],
  nodes: [
    // ── Wet path ───────────────────────────────────
    { id: 'n_drive',   op: 'gain',    x: 120, y:  90,
      params: { gainDb: 0 } },
    { id: 'n_preEmph', op: 'shelf',   x: 220, y:  90,
      // High shelf, +6 dB at 4 kHz — pushes HF into the saturator harder.
      params: { mode: 'high', freq: 4000, gainDb: 6 } },
    { id: 'n_sat',     op: 'tapeAir9', x: 320, y:  90,
      // Airwindows ToTape9 mono port. Drive knob below maps to this
      // node's `drive` param (Airwindows A control). All other params
      // baked at musical defaults — bias=0.5 (centered), bumpHz=0.5,
      // bumpMix=0.25, dubly=0.5, encCross=0.5, flutter off (we have a
      // separate clean head bump downstream so we don't double up).
      params: {
        drive:        0.5,
        dubly:        0.5,
        encCross:     0.5,
        flutterDepth: 0.0,
        flutterRate:  0.5,
        bias:         0.5,
        bumpMix:      0.0,   // skip ToTape9's own head bump — we have n_headBump
        bumpHz:       0.5,
      } },
    { id: 'n_deEmph',  op: 'shelf',   x: 420, y:  90,
      // Complementary -6 dB at 4 kHz — net FR flat, distortion stays in HF.
      params: { mode: 'high', freq: 4000, gainDb: -6 } },
    // ── Tape compression — baked-in 2:1ish gentle limiting that
    //    naturally activates when DRIVE is pushed (because input gain
    //    rises into a fixed-threshold comp). This is THE "tape glue"
    //    character: tape's saturation curve mathematically clips peaks
    //    before clipping average level, which is just compression.
    //    No user knob — drive controls it via input level.
    { id: 'n_compDet', op: 'detector',     x: 460, y: 30,
      params: { mode: 'peak' } },
    { id: 'n_compEnv', op: 'envelope',     x: 460, y: 60,
      // Faster than glue comp — tape's compression has more snap.
      params: { attack: 8, release: 60, amount: 1, offset: 0 } },
    { id: 'n_compGC',  op: 'gainComputer', x: 460, y: 90,
      // 2.5:1 with a 4 dB knee. Threshold -14 means at DRIVE=0 the comp
      // is barely engaged; at DRIVE=10 (input +12 dB) it's pulling 4-6
      // dB GR. The harder you push, the more it grabs — natural tape feel.
      params: { thresholdDb: -14, ratio: 2.5, kneeDb: 4 } },
    { id: 'n_compVca', op: 'gain',         x: 480, y: 120,
      params: { gainDb: 0 } },

    { id: 'n_warmth',  op: 'shelf',  x: 580, y:  90,
      // Baked-in low-mid warmth shelf — +2 dB at 250 Hz. The "body"
      // of tape that doesn't come from the head bump alone. Always on,
      // not user-controlled. Reference: every analog tape machine has
      // this regardless of head EQ alignment.
      params: { mode: 'low', freq: 250, gainDb: 2 } },
    { id: 'n_headBump', op: 'filter', x: 600, y:  90,
      // Peaking @ 90 Hz — the "tape weight" head bump. Wider Q (0.6 vs
      // v0's 0.9) so the bump has shoulders, not a surgical bell.
      params: { mode: 'peaking', cutoff: 90, q: 0.6, gainDb: 4 } },
    { id: 'n_subCut',   op: 'filter', x: 700, y:  90,
      // HP @ 25 Hz — tape's sub-30 Hz rumble cut (mentioned in reference).
      // Cleans up subsonic content without affecting kick fundamental.
      params: { mode: 'hp', cutoff: 25, q: 0.707 } },
    { id: 'n_hfRoll',   op: 'filter', x: 800, y:  90,
      // LP — tape head gap loss. Default 12 kHz (~2-inch tape territory,
      // -3 dB at 18 kHz with the 12 dB/oct biquad slope).
      params: { mode: 'lp', cutoff: 12000, q: 0.707 } },

    // ── Noise floor — baked-in tape hiss + mains hum bleed.
    //    No user knob — just always-on character at very low level
    //    (-48 dB) that adds to the wet path so BYP cleanly removes it.
    //    Real tape always has this: pink-spectrum hiss from magnetic
    //    grain noise + a touch of 60 Hz from the playback head + power
    //    supply. Very light by default; voicings can push it via TRIM
    //    if user wants more "rented machine" vibe.
    { id: 'n_humSrc',     op: 'noise',  x: 200, y: 200,
      // amount=0 default → truly silent at HISS=OFF. Knob mapping
      // scales this up to 4.0 at full so we get real source level,
      // not just a gain attenuation of an always-running source.
      params: { shape: 'white', amount: 0, offset: 0 } },
    { id: 'n_humBP',      op: 'filter', x: 320, y: 200,
      params: { mode: 'bp', cutoff: 60, q: 5 } },
    { id: 'n_hissSrc',    op: 'noise',  x: 440, y: 200,
      params: { shape: 'pink', amount: 0, offset: 0 } },
    { id: 'n_noiseFloor', op: 'gain',   x: 600, y: 200,
      // Fixed -12 dB output stage. Throttling is done at the source
      // amounts (above) so HISS=OFF means literal silence, not -60 dB.
      params: { gainDb: -12 } },

    // ── Mix (wet/dry) + Trim ────────────────────────
    { id: 'n_mix',  op: 'mix',  x: 760, y: 140,
      params: { amount: 1.0 } },         // 100% wet default — "tape on"
    { id: 'n_trim', op: 'gain', x: 860, y: 140,
      params: { gainDb: 0 } },
  ],
  wires: [
    // Wet path
    { from: 'in',          to: 'n_drive'   },
    { from: 'n_drive',     to: 'n_preEmph' },
    { from: 'n_preEmph',   to: 'n_sat'     },
    { from: 'n_sat',       to: 'n_deEmph'  },

    // Tape compression sidechain — det → env → gainComp → vca.gainMod.
    { from: 'n_deEmph',    to: 'n_compDet'         },
    { from: 'n_compDet',   to: 'n_compEnv'         },
    { from: 'n_compEnv',   to: 'n_compGC'          },
    { from: 'n_compGC',    to: 'n_compVca.gainMod' },
    { from: 'n_deEmph',    to: 'n_compVca'         },

    { from: 'n_compVca',   to: 'n_warmth'  },
    { from: 'n_warmth',    to: 'n_headBump'},
    { from: 'n_headBump',  to: 'n_subCut'  },
    { from: 'n_subCut',    to: 'n_hfRoll'  },
    { from: 'n_hfRoll',    to: 'n_mix.wet' },

    // Noise floor — hum + hiss → noiseFloor gain → sums into mix.wet
    // alongside the tape audio. WebAudio GainNode auto-sums multiple
    // connect()s, so n_noiseFloor's output stacks with n_hfRoll's at
    // the mix.wet input.
    { from: 'n_humSrc',     to: 'n_humBP'      },
    { from: 'n_humBP',      to: 'n_noiseFloor' },
    { from: 'n_hissSrc',    to: 'n_noiseFloor' },
    { from: 'n_noiseFloor', to: 'n_mix.wet'    },

    // Dry path
    { from: 'in',          to: 'n_mix.dry' },

    // Mix → Trim → Out
    { from: 'n_mix',       to: 'n_trim'    },
    { from: 'n_trim',      to: 'out'       },
  ],
  feedback: [],
  legendOps: ['gain', 'shelf', 'tapeAir9', 'filter', 'mix', 'detector', 'envelope', 'gainComputer', 'noise'],
  panel: {
    knobs: [
      { id: 'drive',  label: 'DRIVE',  default: 0.35,
        // Drives BOTH the input gain AND the tapeAir9 `drive` param —
        // gives the knob real character. 0..1 → input gain 0..+12 dB +
        // tape drive 0.3..0.85 (Airwindows A control, normalized).
        // Pre-emph/de-emph bracket gives the saturator HF-heavy push,
        // ToTape9's own pipeline does the actual sat character.
        mappings: [
          { nodeId: 'n_drive', paramId: 'gainDb', range: [0, 12],     curve: 'lin' },
          { nodeId: 'n_sat',   paramId: 'drive',  range: [0.3, 0.85], curve: 'lin' },
        ] },
      { id: 'head',   label: 'HEAD',   default: 0.5,
        // Head bump amount — 0..+6 dB at 75 Hz.
        mappings: [{ nodeId: 'n_headBump', paramId: 'gainDb', range: [0, 6], curve: 'lin' }] },
      { id: 'hf',     label: 'HF',     default: 0.55,
        // HF rolloff frequency — log sweep 4 kHz to 18 kHz. Lower range
        // than v0 (6-20 kHz) so even at noon the highs are slightly tamed.
        // Left = cassette-dark, right = mastering-tape-open.
        mappings: [{ nodeId: 'n_hfRoll', paramId: 'cutoff', range: [4000, 18000], curve: 'log' }] },
      { id: 'mix',    label: 'MIX',    default: 1.0,
        // Equal-power crossfade. 1.0 = full wet (tape engaged), 0 = bypass.
        mappings: [{ nodeId: 'n_mix', paramId: 'amount', range: [0, 1], curve: 'lin' }] },
      { id: 'hiss',   label: 'HISS',   default: 0.0,
        // Throttles BOTH noise sources' amount params directly so that
        // OFF = literal silence (sources output zero, not just attenuated).
        // n_humSrc 0..4 (white into BP60 → 60 Hz hum), n_hissSrc 0..0.15
        // (pink-spectrum tube/tape grain). The fixed -12 dB output gain
        // makes the per-source amounts read more like "loudness".
        mappings: [
          { nodeId: 'n_humSrc',  paramId: 'amount', range: [0, 4],    curve: 'lin' },
          { nodeId: 'n_hissSrc', paramId: 'amount', range: [0, 0.15], curve: 'lin' },
        ] },
      { id: 'trim',   label: 'TRIM',   default: 0.5,
        // Output trim -12..+12 dB, centered at noon.
        mappings: [{ nodeId: 'n_trim', paramId: 'gainDb', range: [-12, 12], curve: 'lin' }] },
    ],
  },
};

/**
 * ShimmerDly — wild pitch-shift delay. Bernsee phase-vocoder pitch
 * shifter inside a feedback delay loop. Each repeat goes through the
 * shifter, so:
 *
 *   PITCH at +12 semitones = each repeat goes up an octave →
 *     classic Eventide H910 / Strymon BigSky shimmer cascade
 *
 *   PITCH at -12 semitones = each repeat goes down an octave →
 *     sub-bass dive into infinity, "Inception" texture
 *
 *   PITCH at +7 (perfect fifth) = each repeat ascends a fifth →
 *     stacked-harmony pad
 *
 *   PITCH at small detune (±50¢) = analog-chorus delay,
 *     each repeat slightly more out of tune
 *
 * Topology — same external-feedback pattern as EchoformLite, with a
 * pitch shifter inserted post-tone-filter so each looped tap gets
 * shifted again:
 *
 *      ┌──────────────────────────────────────────► mix.dry
 *      │
 *      IN ─► delay ─► filter(LP) ─► pitchShift ─┬─► mix.wet
 *           ▲                                    │
 *           │                                    │
 *           └── softLimit ◄ dcBlock ◄────────────┘
 *
 * Stability: feedback gain is bounded by `FB · filter_gain · 1.0`
 * (pitch shifter has unity loop gain at any pitch ratio, by design),
 * so loop is Nyquist-stable for FB < 1. dcBlock + softLimit on the FB
 * return are pure safety nets.
 *
 * Latency note: pitchShift adds 1536 samples (~32 ms @ 48 kHz) per
 * trip through the loop. Below ~32 ms TIME settings the loop won't
 * actually shift faster than the latency — minimum useful TIME is ~50 ms.
 *
 * Panel: TIME · FEEDBACK · PITCH · TONE · MIX
 */
export const SHIMMER_DLY = {
  schemaVersion: '1.0',
  id: 'shimmer-dly-v0',
  label: 'ShimmerDly',
  canvas: { width: 900, height: 340 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 220 },
    { id: 'out', kind: 'output', x: 860, y: 220 },
  ],
  nodes: [
    { id: 'n_delay',   op: 'delay',      x: 160, y: 190,
      params: { time: 380, feedback: 0.6 } },
    { id: 'n_tone',    op: 'filter',     x: 290, y: 190,
      params: { mode: 'lp', cutoff: 4500, q: 0.707 } },
    { id: 'n_pitch',   op: 'pitchShift', x: 420, y: 190,
      // pitch=2.0 by default = +1 octave shimmer.
      // Mix=1.0 → 100% wet inside the shifter (we use external mix at the end).
      params: { pitch: 2.0, mix: 1.0 } },
    // High-pass filter post-pitch — removes sub-rumble that the pitch
    // shifter can introduce when stretching bins downward, AND keeps the
    // shimmer tail clean as repeats stack. Sits in the loop alongside
    // the LP tone — together they form a band-pass on the recirculation.
    { id: 'n_hp',      op: 'filter',     x: 540, y: 190,
      params: { mode: 'hp', cutoff: 100, q: 0.707 } },
    // FB return-path safety: DC block + soft limit. Same pattern as EchoformLite.
    { id: 'n_dcblock', op: 'dcBlock',    x: 540, y: 290,
      params: { cutoff: 10 } },
    { id: 'n_softlim', op: 'softLimit',  x: 660, y: 290,
      params: { threshold: 0.95 } },
    { id: 'n_mix',     op: 'mix',        x: 740, y: 210,
      params: { amount: 0.4 } },
  ],
  wires: [
    // Forward path
    { from: 'in',        to: 'n_delay'    },
    { from: 'n_delay',   to: 'n_tone'     },
    { from: 'n_tone',    to: 'n_pitch'    },
    { from: 'n_pitch',   to: 'n_hp'       },
    { from: 'n_hp',      to: 'n_mix.wet'  },

    // Feedback tap: hp out → dcBlock → softLimit → delay.fb
    { from: 'n_hp',      to: 'n_dcblock'  },
    { from: 'n_dcblock', to: 'n_softlim'  },
    { from: 'n_softlim', to: 'n_delay.fb' },

    // Dry leg
    { from: 'in',        to: 'n_mix.dry'  },
    { from: 'n_mix',     to: 'out'        },
  ],
  feedback: [
    { from: 'n_softlim', to: 'n_delay', label: 'feedback (pitched)' },
  ],
  legendOps: ['delay', 'filter', 'pitchShift', 'dcBlock', 'softLimit', 'mix'],
  panel: {
    knobs: [
      { id: 'time',     label: 'TIME',     default: 0.35,
        // 50 ms .. 2000 ms log
        mappings: [{ nodeId: 'n_delay', paramId: 'time', range: [50, 2000], curve: 'log' }] },
      { id: 'feedback', label: 'FEEDBACK', default: 0.6,
        // Cap at 0.85 — pitchShift's HF buildup makes higher feedback
        // run away faster than a flat delay would.
        mappings: [{ nodeId: 'n_delay', paramId: 'feedback', range: [0, 0.85], curve: 'lin' }] },
      { id: 'pitch',    label: 'PITCH',    default: 0.625,
        // Log sweep 0.5 .. 4.0 (= -12 to +24 semitones), centered at
        // 1.0 (unison) at knob ~0.33. Default 0.625 → ratio ≈ 2.0 (+1 oct).
        // The wildness is on either side of unison — knob far left = sub
        // dive, knob far right = ear-piercing octaves up.
        mappings: [{ nodeId: 'n_pitch', paramId: 'pitch', range: [0.5, 4.0], curve: 'log' }] },
      { id: 'tone',     label: 'TONE',     default: 0.45,
        // 400 Hz .. 12 kHz log — LP filter inside the loop. Lower = each
        // repeat darker (shimmer fades into a wash); higher = bright
        // and aggressive shimmer ladder.
        mappings: [{ nodeId: 'n_tone', paramId: 'cutoff', range: [400, 12000], curve: 'log' }] },
      { id: 'hp',       label: 'HP',       default: 0.18,
        // 20 Hz .. 1 kHz log — HP filter inside the loop. Left = barely
        // engaged (just DC removal), middle/right = aggressive low-cut
        // that keeps the shimmer tail clean and prevents bass-mud
        // buildup as repeats stack. Especially useful with -12 PITCH
        // (Sub Dive / Inception modes) where the sub keeps multiplying.
        mappings: [{ nodeId: 'n_hp', paramId: 'cutoff', range: [20, 1000], curve: 'log' }] },
      { id: 'mix',      label: 'MIX',      default: 0.4,
        mappings: [{ nodeId: 'n_mix', paramId: 'amount', range: [0, 1], curve: 'lin' }] },
    ],
  },
};

/**
 * PingPong — classic stereo ping-pong delay. Mono-in (or stereo-summed),
 * stereo-out. Single dedicated worklet (`pingPong` op) handles the
 * cross-coupled topology + built-in tone filter inside the loop:
 *
 *   bufL[w] = inMono + readR · fb       ← input lands on L
 *   bufR[w] =          readL · fb        ← R gets cross-fed only
 *
 * Pattern: a single input pulse fires L, R, L, R alternating, each
 * repeat fb× quieter. SPREAD knob blends between full ping-pong (1.0)
 * and mono-summed wet (0.0) for in-the-mix usage that bounces internally
 * but doesn't hard-pan to the speakers.
 *
 * Topology — single worklet handles delay, fb, tone, mix internally:
 *
 *      IN ─► pingPong ─► OUT (stereo)
 *
 * Panel: TIME · FEEDBACK · TONE · SPREAD · MIX
 */
export const PINGPONG_DLY = {
  schemaVersion: '1.0',
  id: 'pingpong-dly-v0',
  label: 'PingPong',
  canvas: { width: 540, height: 220 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 110 },
    { id: 'out', kind: 'output', x: 500, y: 110 },
  ],
  nodes: [
    { id: 'n_pp', op: 'pingPong', x: 270, y: 90,
      params: { time: 380, feedback: 0.55, tone: 4500, spread: 1.0, mix: 0.45 } },
  ],
  wires: [
    { from: 'in',   to: 'n_pp' },
    { from: 'n_pp', to: 'out'  },
  ],
  feedback: [],
  legendOps: ['pingPong'],
  panel: {
    knobs: [
      { id: 'time',     label: 'TIME',     default: 0.4,
        // 50 ms .. 2000 ms log
        mappings: [{ nodeId: 'n_pp', paramId: 'time', range: [50, 2000], curve: 'log' }] },
      { id: 'feedback', label: 'FEEDBACK', default: 0.55,
        mappings: [{ nodeId: 'n_pp', paramId: 'feedback', range: [0, 0.85], curve: 'lin' }] },
      { id: 'tone',     label: 'TONE',     default: 0.55,
        // 600 Hz .. 16 kHz log — LP cutoff inside the FB loop. Lower =
        // each repeat darker (dub / Roland Space Echo vibe), higher =
        // bright present pongs.
        mappings: [{ nodeId: 'n_pp', paramId: 'tone', range: [600, 16000], curve: 'log' }] },
      { id: 'spread',   label: 'SPREAD',   default: 1.0,
        // 0 = mono-sum wet (bounce stays internal, no hard panning),
        // 1 = full stereo separation (classic L/R ping-pong)
        mappings: [{ nodeId: 'n_pp', paramId: 'spread', range: [0, 1], curve: 'lin' }] },
      { id: 'mix',      label: 'MIX',      default: 0.45,
        mappings: [{ nodeId: 'n_pp', paramId: 'mix', range: [0, 1], curve: 'lin' }] },
    ],
  },
};

/**
 * HarmonyPad — instant 4-voice chord pad. Single note in → arena-rock
 * vocal stack out. Four parallel Bernsee pitch shifters tuned to chord
 * intervals + a Valhalla-style FDN reverb wash to soften the digital
 * edge of the shifters.
 *
 * Topology:
 *
 *   IN ┬─ pitchShift voice1 (unison) ─┐
 *      ├─ pitchShift voice2 (3rd)     ├─► sum(gain) ─► tone(LP) ─► wash(fdnReverb) ─► mix.wet
 *      ├─ pitchShift voice3 (5th)     │                                                │
 *      └─ pitchShift voice4 (octave) ─┘                                                │
 *   IN ─────────────────────────────────────────────────────────► mix.dry             │
 *                                                                       mix ─► trim ─► OUT
 *
 * Voicing presets reset the four `pitch` ratios. Voice 1 is always at
 * unison so user gets a "thickened" original + harmony voices around it.
 *
 * Latency note: each pitchShift adds ~32 ms (FFT_SIZE=2048, OSAMP=4).
 * All four voices run in parallel so they stay aligned with each other,
 * but the wet path is ~32 ms behind dry. Means the chord "swells in"
 * after the dry note — actually feels musical for a pad effect.
 *
 * Lite scope:
 *   • Hard chord intervals (no smart key tracking — feed it the wrong
 *     note and it'll sound dissonant).
 *   • No detune/spread per-voice (queued for v2).
 *   • Reverb is fdnReverb (Geraint Luff Tier-3 port) — close to Valhalla
 *     character but not identical.
 *
 * Panel: BLEND · WASH · SIZE · TONE · MIX
 */
export const HARMONY_PAD = {
  schemaVersion: '1.0',
  id: 'harmony-pad-v0',
  label: 'HarmonyPad',
  canvas: { width: 980, height: 380 },
  terminals: [
    { id: 'in',  kind: 'input',  x:  40, y: 200 },
    { id: 'out', kind: 'output', x: 940, y: 200 },
  ],
  nodes: [
    // ── Four pitch-shifter voices in parallel ───────
    { id: 'n_v1', op: 'pitchShift', x: 160, y:  80,
      params: { pitch: 1.0,    mix: 1.0 } },   // unison
    { id: 'n_v2', op: 'pitchShift', x: 160, y: 150,
      params: { pitch: 1.2599, mix: 1.0 } },   // major 3rd  (+4 st)
    { id: 'n_v3', op: 'pitchShift', x: 160, y: 220,
      params: { pitch: 1.4983, mix: 1.0 } },   // perfect 5th (+7 st)
    { id: 'n_v4', op: 'pitchShift', x: 160, y: 290,
      params: { pitch: 2.0,    mix: 1.0 } },   // octave     (+12 st)

    // Voice gains — used to balance unison vs harmonies via BLEND knob.
    { id: 'n_g1', op: 'gain', x: 320, y:  80, params: { gainDb: 0 } },
    { id: 'n_g2', op: 'gain', x: 320, y: 150, params: { gainDb: 0 } },
    { id: 'n_g3', op: 'gain', x: 320, y: 220, params: { gainDb: 0 } },
    { id: 'n_g4', op: 'gain', x: 320, y: 290, params: { gainDb: 0 } },

    // Sum point — WebAudio GainNode auto-sums multiple connections.
    // Trim down because 4 voices summed equally would be hot.
    { id: 'n_sum',  op: 'gain',   x: 460, y: 185,
      params: { gainDb: -9 } },

    // Tone LP — softens the digital crunch of bin-shifted pitchShift.
    { id: 'n_tone', op: 'filter', x: 580, y: 185,
      params: { mode: 'lp', cutoff: 6000, q: 0.707 } },

    // Valhalla-style wash. fdnReverb is the Geraint Luff Tier-3 port —
    // mix=1.0 inside the reverb so the wash IS the wet (we control wet
    // amount externally via n_mix).
    { id: 'n_wash', op: 'fdnReverb', x: 700, y: 185,
      params: {
        morph:   0.55,    // mid-warm voicing
        size:    0.55,    // medium room
        decay:   0.65,    // long-ish tail
        tone:    0.55,    // slightly dark
        density: 0.7,     // high density (smoother)
        warp:    0.25,    // light modulation for that Valhalla shimmer
        mix:     1.0,     // 100% wet inside the reverb
      } },

    // External dry/wet + output trim
    { id: 'n_mix',  op: 'mix',  x: 820, y: 200,
      params: { amount: 0.55 } },  // wet-leaning default for chord-pad use
    { id: 'n_trim', op: 'gain', x: 900, y: 200,
      params: { gainDb: 0 } },
  ],
  wires: [
    // Input fans out to all four voices (and dry leg)
    { from: 'in', to: 'n_v1' },
    { from: 'in', to: 'n_v2' },
    { from: 'in', to: 'n_v3' },
    { from: 'in', to: 'n_v4' },

    // Each voice → its gain (for BLEND control)
    { from: 'n_v1', to: 'n_g1' },
    { from: 'n_v2', to: 'n_g2' },
    { from: 'n_v3', to: 'n_g3' },
    { from: 'n_v4', to: 'n_g4' },

    // All four voice gains sum into n_sum (WebAudio auto-sums multi-connect)
    { from: 'n_g1', to: 'n_sum' },
    { from: 'n_g2', to: 'n_sum' },
    { from: 'n_g3', to: 'n_sum' },
    { from: 'n_g4', to: 'n_sum' },

    // Sum → tone → wash → mix.wet
    { from: 'n_sum',  to: 'n_tone' },
    { from: 'n_tone', to: 'n_wash' },
    { from: 'n_wash', to: 'n_mix.wet' },

    // Dry leg
    { from: 'in',     to: 'n_mix.dry' },

    // Mix → trim → out
    { from: 'n_mix',  to: 'n_trim' },
    { from: 'n_trim', to: 'out' },
  ],
  feedback: [],
  legendOps: ['pitchShift', 'gain', 'filter', 'fdnReverb', 'mix'],
  panel: {
    knobs: [
      { id: 'blend',  label: 'BLEND',  default: 0.55,
        // 0 = only unison voice (no harmony), 1 = harmonies dominate.
        // Maps inversely between unison gain and the three harmony gains.
        // At 0: unison +6 dB, harmonies -60 dB (silent).
        // At 1: unison -12 dB, harmonies 0 dB.
        mappings: [
          { nodeId: 'n_g1', paramId: 'gainDb', range: [6, -12], curve: 'lin' },  // unison fades down
          { nodeId: 'n_g2', paramId: 'gainDb', range: [-60, 0], curve: 'lin' },  // harmonies fade up
          { nodeId: 'n_g3', paramId: 'gainDb', range: [-60, 0], curve: 'lin' },
          { nodeId: 'n_g4', paramId: 'gainDb', range: [-60, 0], curve: 'lin' },
        ] },
      { id: 'wash',   label: 'WASH',   default: 0.65,
        // fdnReverb decay — 0 = short slap, 1 = infinite freeze.
        mappings: [{ nodeId: 'n_wash', paramId: 'decay', range: [0.2, 0.95], curve: 'lin' }] },
      { id: 'size',   label: 'SIZE',   default: 0.55,
        // fdnReverb size — small room → big hall.
        mappings: [{ nodeId: 'n_wash', paramId: 'size', range: [0.2, 0.95], curve: 'lin' }] },
      { id: 'tone',   label: 'TONE',   default: 0.55,
        // LP cutoff before the reverb — 1 kHz to 16 kHz log.
        // Lower = darker, more "synth pad" feel; higher = bright vocal stack.
        mappings: [{ nodeId: 'n_tone', paramId: 'cutoff', range: [1000, 16000], curve: 'log' }] },
      { id: 'mix',    label: 'MIX',    default: 0.55,
        mappings: [{ nodeId: 'n_mix', paramId: 'amount', range: [0, 1], curve: 'lin' }] },
    ],
  },
};

/** Registry of brick-type → mock graph. Used by BrickZoomView to decide
 *  whether to show a graph or fall back to the opaque placeholder. */
export const MOCK_GRAPHS_BY_BRICK_TYPE = {
  echoform:     ECHOFORM_MOCK,
  sandboxToy:   SANDBOX_TOY,
  filterFx:     FILTER_FX,
  echoformLite: ECHOFORM_LITE,
  modDuck:      MOD_DUCK,
  toyComp:      TOY_COMP,
  lofiLight:    LOFI_LIGHT,
  fdnHall:      FDN_HALL,
  pultecLite:   PULTEC_LITE,
  vintageAmp:   VINTAGE_AMP,
  tapeSat:      TAPE_SAT,
  shimmerDly:   SHIMMER_DLY,
  pingPong:     PINGPONG_DLY,
  harmonyPad:   HARMONY_PAD,
};

/** Convenience lookup. */
export function getMockGraphForBrick(type) {
  return MOCK_GRAPHS_BY_BRICK_TYPE[type] || null;
}

// --- Dev-time conformance check ------------------------------------------
// Validate every mock graph against the op registry at module load. Any
// schema drift (unknown op, out-of-range param, dangling wire) shows up
// in the browser console immediately, before any UI work is done.
import { validateGraphLoud } from './validateGraph';
for (const [brickType, g] of Object.entries(MOCK_GRAPHS_BY_BRICK_TYPE)) {
  validateGraphLoud(g, `mockGraph[${brickType}]`);
}
