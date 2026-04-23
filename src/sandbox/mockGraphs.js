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
    { id: 'n_dcblock', op: 'dcBlock',  x: 440, y: 270, params: { cutoff: 10 } },
    // Soft-limit on the FB return path — pure safety net now that
    // drive is pre-loop and tone provides in-loop loss. Threshold
    // back to 0.95 since loop gain is bounded by FB · filter_gain < 1
    // under all normal settings; this clamp only engages on genuinely
    // pathological input (e.g. huge DC blast that DC-block couldn't
    // catch fast enough). Retires EFL-SB-03.
    { id: 'n_softlim', op: 'softLimit', x: 500, y: 270, params: { threshold: 0.95 } },
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
