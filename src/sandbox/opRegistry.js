// Op Registry — Step 2b of sandbox core.
// See memory/sandbox_core_scope.md.
//
// Declarative source of truth for the MVP set of ops. An op is the
// smallest unit a Brick can be decomposed into in the sandbox. Each
// entry describes:
//
//   id          stable string used in graph.json
//   label       short display name shown on the node
//   description one-liner used by the legend
//   ports       { inputs: [...], outputs: [...] } — kind: 'audio' | 'control'
//   params      ordered list of { id, label, type, ...constraints, default, unit, format }
//
// Param types (Step 2b minimum):
//   number    { min, max, step?, unit, format? }
//   enum      { options: [{value, label}], default }
//   bool      { default }
//
// `format(value)` is optional — if present, returns the display string for
// that value (e.g. 510 → "510 ms"). Defaults to `String(value) + (unit||'')`.
//
// MVP set is intentionally six ops (per sandbox_core_scope.md DoD):
//   gain · filter · envelope · delay · mix · saturate
//
// Step 2c will instantiate at least one of these as a real sandbox-native
// brick (Gain+Filter+Mix toy). Step 2d wires graph.json round-trip + undo.

const fmtMs   = (v) => `${v} ms`;
const fmtPct  = (v) => `${Math.round(v * 100)}%`;
const fmtHz   = (v) => v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;
const fmtDb   = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
const fmtX    = (v) => `${v.toFixed(2)}×`;

export const OPS = {
  gain: {
    id: 'gain',
    label: 'gain',
    description: 'linear amplifier, dB-tapered — accepts control-rate gainMod',
    ports: {
      inputs: [
        { id: 'in',      kind: 'audio'   },
        // Control mod port — a control signal wired here is *summed* into
        // the underlying AudioParam (linear gain, not dB). Used by the
        // envelope op in the ModDuck brick. Leave unwired for static gain.
        { id: 'gainMod', kind: 'control', optional: true },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'gainDb', label: 'Gain', type: 'number', min: -60, max: 24, step: 0.1, default: 0, unit: 'dB', format: fmtDb },
    ],
  },

  filter: {
    id: 'filter',
    label: 'filter',
    description: 'biquad — LP/HP/BP/notch, resonant',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'lp',
        options: [
          { value: 'lp',    label: 'low-pass'  },
          { value: 'hp',    label: 'high-pass' },
          { value: 'bp',    label: 'band-pass' },
          { value: 'notch', label: 'notch'     },
        ] },
      { id: 'cutoff', label: 'Cutoff', type: 'number', min: 20, max: 20000, default: 1000, unit: 'Hz', format: fmtHz },
      { id: 'q',      label: 'Q',      type: 'number', min: 0.1, max: 24, step: 0.01, default: 0.707, unit: '' },
    ],
  },

  envelope: {
    id: 'envelope',
    label: 'env',
    description: 'AR envelope follower → scale/offset control signal',
    ports: {
      // Input is typically a rectified (detector) signal, but any audio
      // works — envelope smooths + scales + offsets.
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'env', kind: 'control' }],
    },
    params: [
      { id: 'attack',  label: 'Attack',  type: 'number', min: 0.1, max: 500,  step: 0.1, default: 5,   unit: 'ms', format: fmtMs },
      { id: 'release', label: 'Release', type: 'number', min: 1,   max: 2000, step: 1,   default: 120, unit: 'ms', format: fmtMs },
      // `amount` scales the smoothed envelope (signed — negative for ducking).
      // `offset` is a DC bias added to the output (before connecting to an
      // AudioParam). Together they give the brick author full control over
      // the shape & polarity of the control signal.
      { id: 'amount', label: 'Amount', type: 'number', min: -4, max: 4,  step: 0.001, default: -1, unit: '',   format: (v) => v.toFixed(2) },
      { id: 'offset', label: 'Offset', type: 'number', min: -4, max: 4,  step: 0.001, default:  0, unit: '',   format: (v) => v.toFixed(2) },
    ],
  },

  shelf: {
    id: 'shelf',
    label: 'shelf',
    description: 'low/high shelf EQ — boost or cut above/below a corner frequency',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'low',
        options: [
          { value: 'low',  label: 'low shelf'  },
          { value: 'high', label: 'high shelf' },
        ] },
      { id: 'freq',   label: 'Freq', type: 'number', min:  20, max: 20000, default: 200, unit: 'Hz', format: fmtHz },
      { id: 'gainDb', label: 'Gain', type: 'number', min: -24, max: 24, step: 0.1, default: 0, unit: 'dB', format: fmtDb },
    ],
  },

  detector: {
    id: 'detector',
    label: 'detect',
    description: 'signal detector — full-wave rectifier (peak/abs)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio'   }],
      outputs: [{ id: 'det', kind: 'control' }],
    },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'peak',
        options: [
          { value: 'peak', label: 'peak (|x|)' },
          { value: 'rms',  label: 'rms (x²)'   },
        ] },
    ],
  },

  delay: {
    id: 'delay',
    label: 'delay',
    description: 'variable-time line — external FB via `fb` port',
    ports: {
      inputs:  [
        { id: 'in',      kind: 'audio'   },
        { id: 'fb',      kind: 'audio',   optional: true },  // external feedback return
        { id: 'timeMod', kind: 'control', optional: true },
      ],
      outputs: [{ id: 'out',    kind: 'audio'   }],
    },
    params: [
      { id: 'time',     label: 'Time',     type: 'number', min: 1, max: 2000, step: 1, default: 250, unit: 'ms', format: fmtMs },
      // feedback scales signal arriving on the `fb` input port. If fb is
      // unwired, this param has no effect (no self-loop baked in).
      { id: 'feedback', label: 'Feedback', type: 'number', min: 0, max: 0.98, step: 0.01, default: 0.4, unit: '', format: fmtPct },
    ],
  },

  mix: {
    id: 'mix',
    label: 'mix',
    description: 'equal-power dry/wet cross-fade',
    ports: {
      inputs:  [{ id: 'dry', kind: 'audio' }, { id: 'wet', kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'amount', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5, unit: '', format: fmtPct },
    ],
  },

  scaleBy: {
    id: 'scaleBy',
    label: 'scale',
    description: 'linear multiplier — static gain scalar, 0 = mute, 1 = unity',
    // Works on audio OR a control signal. WebAudio makes no distinction at
    // the GainNode level; the registry's `kind: 'audio'` here is just the
    // default — wiring a control signal through it is valid and common
    // (e.g. envelope.env → scaleBy → gain.gainMod to trim mod depth).
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'k', label: 'Scale', type: 'number', min: -4, max: 4, step: 0.001, default: 1, unit: '', format: (v) => v.toFixed(3) },
    ],
  },

  gainComputer: {
    id: 'gainComputer',
    label: 'gainComp',
    description: 'threshold / ratio / knee → delta-from-unity gain-reduction signal',
    ports: {
      // Input: linear-magnitude envelope (typically envelope.env with amount=+1).
      // Output: delta-from-unity GR signal (0 = no reduction, negative = duck).
      // Wire directly to an AudioParam whose resting value is 1.0, e.g.
      // gain.gainMod — the signals sum, pulling gain below unity.
      inputs:  [{ id: 'env', kind: 'control' }],
      outputs: [{ id: 'gr',  kind: 'control' }],
    },
    params: [
      { id: 'thresholdDb', label: 'Threshold', type: 'number', min: -60, max:  0, step: 0.1, default: -18, unit: 'dB', format: fmtDb },
      { id: 'ratio',       label: 'Ratio',     type: 'number', min:   1, max: 20, step: 0.1, default:   4, unit: ':1', format: (v) => `${v.toFixed(1)}:1` },
      { id: 'kneeDb',      label: 'Knee',      type: 'number', min:   0, max: 24, step: 0.1, default:   6, unit: 'dB', format: fmtDb },
    ],
  },

  noise: {
    id: 'noise',
    label: 'noise',
    description: 'noise source — white / pink / brown, mono audio-rate',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'shape', label: 'Color', type: 'enum', default: 'white',
        options: [
          { value: 'white', label: 'white'  },
          { value: 'pink',  label: 'pink'   },
          { value: 'brown', label: 'brown'  },
        ] },
      { id: 'amount', label: 'Amount', type: 'number', min: -4, max: 4, step: 0.001, default: 1, unit: '', format: (v) => v.toFixed(2) },
      { id: 'offset', label: 'Offset', type: 'number', min: -4, max: 4, step: 0.001, default: 0, unit: '', format: (v) => v.toFixed(2) },
    ],
  },

  lfo: {
    id: 'lfo',
    label: 'lfo',
    description: 'low-frequency oscillator — bipolar control signal (sine/tri/sq/saw)',
    ports: {
      // No audio input — LFO is a pure source. Output is a control-rate
      // signal ready to sum into any AudioParam (via a downstream scaleBy
      // for depth-trim, or wired directly for amount-baked use).
      inputs:  [],
      outputs: [{ id: 'lfo', kind: 'control' }],
    },
    params: [
      { id: 'rateHz', label: 'Rate',  type: 'number', min: 0.01, max: 40, step: 0.01, default: 1, unit: 'Hz',
        format: (v) => v >= 1 ? `${v.toFixed(2)} Hz` : `${(1 / v).toFixed(2)} s` },
      { id: 'shape',  label: 'Shape', type: 'enum',   default: 0,
        options: [
          { value: 0, label: 'sine'     },
          { value: 1, label: 'triangle' },
          { value: 2, label: 'square'   },
          { value: 3, label: 'saw (↓)'  },
        ] },
      { id: 'amount', label: 'Amount', type: 'number', min: -4, max: 4, step: 0.001, default: 1, unit: '', format: (v) => v.toFixed(2) },
      { id: 'offset', label: 'Offset', type: 'number', min: -4, max: 4, step: 0.001, default: 0, unit: '', format: (v) => v.toFixed(2) },
    ],
  },

  bitcrush: {
    id: 'bitcrush',
    label: 'bits',
    description: 'quantization — reduce bit depth (4..16 bits) or bypass (0)',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      // 0 = off (pass through); 4..16 = target bit depth.
      { id: 'bits', label: 'Bits', type: 'number', min: 0, max: 16, step: 1, default: 0, unit: '', format: (v) => v === 0 ? 'off' : `${v}-bit` },
    ],
  },

  saturate: {
    id: 'saturate',
    label: 'sat',
    description: 'tanh-style soft-clip with drive comp',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'drive', label: 'Drive', type: 'number', min: 1,  max: 16, step: 0.01, default: 1, unit: '', format: fmtX },
      { id: 'trim',  label: 'Trim',  type: 'number', min: -24, max: 12, step: 0.1, default: 0, unit: 'dB', format: fmtDb },
    ],
  },
};

/** O(1) lookup; returns null if op id is unknown. */
export function getOp(id) {
  return OPS[id] || null;
}

/** Format a single param value using its schema's `format` if present. */
export function formatParam(opId, paramId, value) {
  const op = getOp(opId);
  if (!op) return String(value);
  const p = op.params.find(p => p.id === paramId);
  if (!p) return String(value);
  if (value == null) return '';
  if (p.type === 'enum') {
    const opt = p.options.find(o => o.value === value);
    return opt ? opt.label : String(value);
  }
  if (p.format) {
    try { return p.format(value); } catch { return String(value); }
  }
  return p.unit ? `${value} ${p.unit}` : String(value);
}

/** Return the most informative param's display string for a node —
 *  used by OpGraphCanvas to print a hint under the node's label.
 *  Prefers numeric params (the moving values) over enums (which read
 *  more as the node's identity). */
export function primaryParamDisplay(node) {
  const op = getOp(node.op);
  if (!op || !node.params) return null;
  // Pass 1: first numeric/bool param with a value.
  for (const p of op.params) {
    if (p.type === 'enum') continue;
    const v = node.params[p.id];
    if (v != null) return formatParam(node.op, p.id, v);
  }
  // Pass 2: fall back to enums if there's nothing else.
  for (const p of op.params) {
    const v = node.params[p.id];
    if (v != null) return formatParam(node.op, p.id, v);
  }
  return null;
}

/** All registered op ids — useful for UI palettes. */
export function listOps() {
  return Object.keys(OPS);
}

/** Return the first enum param's display string for a node — used by
 *  OpGraphCanvas to render an enum subtitle (e.g. "low-pass" on a
 *  filter) alongside the numeric primary value. Returns null if no
 *  enum params have a value. */
export function enumParamDisplay(node) {
  const op = getOp(node.op);
  if (!op || !node.params) return null;
  for (const p of op.params) {
    if (p.type !== 'enum') continue;
    const v = node.params[p.id];
    if (v != null) return formatParam(node.op, p.id, v);
  }
  return null;
}
