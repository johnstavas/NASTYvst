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

  // DC trap — dedicated 1-pole highpass at ~10 Hz for use inside feedback
  // loops. Why it's a separate op from `filter`: the filter op is a 2-pole
  // biquad whose default mode is lowpass — using it as a DC trap would be
  // a schema surprise. dcBlock has ONE job, its cutoff defaults to 10 Hz
  // (musically inaudible), and it composes cleanly as an in-line segment
  // on a feedback return path. Canonical fix for the `denormal_tail` and
  // `dc_under_feedback` ship-gate classes — see qc_backlog.md § Sandbox
  // Brick Audit Sweep.
  //
  // Implementation in compileGraphToWebAudio uses a BiquadFilterNode in
  // highpass mode (Canon:filters §9 RBJ cookbook). Q is stock 0.707 — DC
  // traps never benefit from resonance.
  dcBlock: {
    id: 'dcBlock',
    label: 'dc block',
    description: 'DC-trap HP (1-pole equivalent @ 10 Hz) — drop inline on feedback returns',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      // Cutoff exposed so bricks that need a higher corner (e.g. bass-traps
      // on resonant FB) can push it up without swapping ops. Default 10 Hz
      // sits well below audibility on any typical playback chain.
      { id: 'cutoff', label: 'Cutoff', type: 'number', min: 1, max: 200, step: 0.5, default: 10, unit: 'Hz', format: fmtHz },
    ],
  },

  // Catalog #16. First-order allpass. Unity magnitude at every frequency;
  // phase is frequency-dependent (crosses −π/2 at the break frequency).
  // THE building block for:
  //   - Schroeder/Freeverb-style reverb diffusion (cascade N stages)
  //   - Phaser notches (cascade N stages, modulate `freq` with an LFO)
  //   - Polyphase halfband decimators (#12 oversample2x)
  //
  // Math: Canon:filters (1st-order allpass, DAFX §5.2):
  //   a     = (tan(π·fc/Fs) − 1) / (tan(π·fc/Fs) + 1)   (coefficient)
  //   H(z)  = (a + z⁻¹) / (1 + a·z⁻¹)
  //   y[n]  = a·(x[n] − y[n−1]) + x[n−1]                (efficient form)
  //
  // NOT the delay-line allpass (that's #19 diffuser / Schroeder section),
  // which has an internal delay tap of D samples and is used for long
  // diffusion. Use this op for phase-shifting / phaser / tilt.
  allpass: {
    id: 'allpass',
    label: 'allpass',
    description: '1st-order allpass — unity magnitude, tunable phase shift at break frequency',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'freq', label: 'Freq', type: 'number', min: 20, max: 20000, default: 1000, unit: 'Hz', format: fmtHz },
    ],
  },

  // Catalog #32. Generic 1-pole LP/HP. Half the CPU and cleaner phase than
  // the biquad (#2 filter), gentler 6 dB/oct slope. Use when a tone control
  // or mild shelf-ish tilt is wanted without resonance. `dcBlock` (#17) is
  // a specialised 1-pole HP pinned at fc=10 Hz; `onePole` is the general-
  // purpose version with a full-range cutoff.
  //
  // Math: standard 1-pole IIR (Canon:filters §9 / DAFX §2.1.1):
  //   a     = exp(-2π · fc / Fs)
  //   LP:   y[n] = (1 - a)·x[n] + a·y[n-1]
  //   HP:   y[n] = x[n] - LP(x[n])    (complementary)
  onePole: {
    id: 'onePole',
    label: '1-pole',
    description: '1-pole LP/HP — 6 dB/oct, no resonance, low CPU',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'lp',
        options: [
          { value: 'lp', label: 'low-pass'  },
          { value: 'hp', label: 'high-pass' },
        ] },
      { id: 'cutoff', label: 'Cutoff', type: 'number', min: 20, max: 20000, default: 1000, unit: 'Hz', format: fmtHz },
    ],
  },

  // Catalog #33. Andy Simper's Zero-Delay-Feedback state-variable filter
  // (trapezoidal-integrated SVF). Modern VA topology — stable under fast
  // cutoff modulation (unlike biquad), Q-independent cutoff (unlike ladder),
  // simultaneous LP/BP/HP/notch outputs from the same two-integrator
  // structure. Canon:filters §1.
  //
  // Math (Simper 2013, "Linear Trapezoidal Integrated State Variable Filter"):
  //   g  = tan(π · fc / Fs)
  //   k  = 1 / Q
  //   a1 = 1 / (1 + g·(g + k))
  //   a2 = g · a1
  //   a3 = g · a2
  //   v3 = v0 − ic2eq
  //   v1 = a1·ic1eq + a2·v3
  //   v2 = ic2eq + a2·ic1eq + a3·v3
  //   ic1eq = 2·v1 − ic1eq
  //   ic2eq = 2·v2 − ic2eq
  //   LP = v2, BP = v1, HP = v0 − k·v1 − v2, NOTCH = LP + HP
  // Catalog #49. Peak level reader — instant-attack, exponential-release
  // envelope of |x|. The first op in the Loudness/Metering family (49–56).
  // Canon:loudness §1 ballistics (IEC 60268-10 / BS.1770-5 peak semantics).
  //
  // Use cases:
  //   - UI meters (peak-hold needle)
  //   - Clip-indicator / overs counter driver
  //   - Any brick wanting "how hot is this signal *right now*" as a
  //     control-rate scalar that tracks transients but settles cleanly.
  //
  // Distinct from #3 detector (pure rectifier, no ballistics) and #4
  // envelope (AR-shaped, attack curve is musical not technical). Peak is
  // the unbiased, standards-faithful reading. If you want LUFS-shaped
  // loudness over time, that's #52 lufsIntegrator downstream.
  peak: {
    id: 'peak',
    label: 'peak',
    description: 'peak level reader — instant attack, 60dB-release time constant',
    ports: {
      inputs:  [{ id: 'in',   kind: 'audio'   }],
      outputs: [{ id: 'peak', kind: 'control' }],
    },
    params: [
      // Release = time (ms) for output to fall 60 dB from a held peak.
      // IEC 60268-10 Type I ("Peak Programme Meter") uses 1.7 s (1700 ms).
      // Our default 400 ms is the common DAW "peak meter" behavior —
      // snappier, matches Pro Tools / Logic peak displays.
      { id: 'release', label: 'Release', type: 'number', min: 1, max: 5000, step: 1, default: 400, unit: 'ms', format: fmtMs },
    ],
  },

  // Catalog #51. ITU-R BS.1770-5 K-weighting pre-filter. Canon:loudness §2.
  //
  // Two cascaded biquads with fixed analog-prototype parameters:
  //   Stage 1 (pre-filter, high-shelf) models the acoustic transfer
  //     function of the human head/ear — a gentle +4 dB shelf above
  //     ~1.68 kHz simulating the outer-ear resonance around 2–5 kHz.
  //   Stage 2 (RLB high-pass) — Revised Low-frequency B-curve, a 2nd-order
  //     HP near 38 Hz that attenuates sub-audio rumble so it doesn't
  //     dominate the loudness measurement. Named "RLB" because it
  //     replaced the older IEC 61672 "B-curve" in the BS.1770 revision.
  //
  // Together they form the "K-weighting" curve — the perceptual front-end
  // for every LUFS/LKFS/R128 meter in the industry. This op exists to
  // feed #52 lufsIntegrator: `audio → kWeighting → rms → gating → LUFS`.
  //
  // Source-of-truth analog prototype coefficients (BS.1770-5, Annex 1):
  //   Stage 1: fc = 1681.974450955533 Hz, Q = 0.7071752369554196,
  //            VH = 1.584864701130855, VB = 1.258720930232562, VL = 1.0
  //   Stage 2: fc = 38.13547087602444 Hz, Q = 0.5003270373238773
  // Derivation: bilinear transform with pre-warping at fc.
  //
  // No user-visible params. Coefficients are fully determined by sample
  // rate. At Fs=48 kHz the digital coefs reproduce the canonical BS.1770
  // reference values (tabulated in-code).
  kWeighting: {
    id: 'kWeighting',
    label: 'K-wt',
    description: 'ITU-R BS.1770-5 K-weighting pre-filter (head/ear + RLB HP)',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [],
  },

  // Catalog #52. ITU-R BS.1770-5 loudness integrator — reads mean-square
  // from pre-K-weighted audio and emits LUFS (Loudness Units Full Scale)
  // per the momentary (400 ms) or short-term (3 s) window. Canon:loudness §3.
  //
  // Pipeline (typical wiring):
  //     audio → #51 kWeighting → #52 lufsIntegrator → LUFS reading
  //
  // LUFS formula (single-channel, BS.1770-5 §3.1):
  //     L = −0.691 + 10·log10(G · MS)
  // where G is the channel weight (1.0 for L/R/C/mono, 1.41 for LFE)
  // and MS is the mean-square of the K-weighted signal.
  //
  // Calibration: the −0.691 offset is derived so that a stereo full-scale
  // 1 kHz sine (L=R, each 0 dBFS, G_L+G_R=2) reads exactly 0 LUFS after
  // K-weighting (which boosts 1 kHz by +0.691 dB). This op reads a single
  // channel, so a 1 kHz 0 dBFS sine reads −3 LUFS per channel.
  //
  // Window ballistics (one-pole equivalent of BS.1770 rectangular windows):
  //   momentary  = 400 ms rectangular  →  τ ≈ 200 ms one-pole
  //   short-term = 3000 ms rectangular →  τ ≈ 1500 ms one-pole
  //
  // The one-pole approximation of a rectangular window is standard practice
  // in real-time LUFS meters (EBU Tech 3341 permits it) — the error is
  // negligible for steady programme material and the ballistics match how
  // engineers expect the needle to move.
  //
  // Not yet: integrated (gated long-term) LUFS — that requires a 100 ms
  // block-rate histogram accumulator with absolute (−70 LUFS) and relative
  // (−10 LU below ungated) gates. It'll ship as #55 ebuMode or as a
  // follow-up stretch for this op.
  lufsIntegrator: {
    id: 'lufsIntegrator',
    label: 'LUFS',
    description: 'BS.1770-5 loudness integrator — momentary / short-term LUFS from K-weighted audio',
    ports: {
      inputs:  [{ id: 'in',   kind: 'audio'   }],
      outputs: [{ id: 'lufs', kind: 'control' }],
    },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'momentary',
        options: [
          { value: 'momentary',  label: 'Momentary (400 ms)' },
          { value: 'short-term', label: 'Short-term (3 s)'   },
        ] },
      // Channel weight G (BS.1770 §3.1). Default 1.0 covers L/R/C/mono.
      // Use 1.41 (≈ +1.5 dB) for LFE channels.
      { id: 'channelWeight', label: 'G', type: 'number', min: 0, max: 2, step: 0.01, default: 1.0, unit: '' },
    ],
  },

  // Catalog #50. RMS level reader — one-pole-averaged power, square-rooted.
  // Second op in the Loudness/Metering family (49–56). Canon:loudness §1.
  //
  // What it does:
  //   Tracks the root-mean-square level of an audio stream over a
  //   configurable window. Unlike peak (#49), RMS is a continuous energy
  //   measurement that correlates better with *perceived* loudness — it's
  //   the foundation for VU meters, RMS compressors, and K-weighted LUFS
  //   loudness (#52, which is literally this op preceded by #51).
  //
  // Math (Canon:loudness §1 / Canon:dynamics windowed-RMS):
  //   α = exp(−1 / (τ · Fs))                (one-pole averaging coef)
  //   p[n] = (1 − α)·x[n]² + α·p[n−1]       (mean-square, power domain)
  //   y[n] = sqrt(p[n])                     (RMS magnitude)
  //
  //   Using a one-pole averager instead of a rectangular sliding window:
  //     + 1 state + 1 multiply per sample vs. O(window-samples) memory
  //     + no boundary discontinuities (smooth ballistics)
  //     + matches analog VU behavior (RC integration)
  //     − not *exactly* a boxcar average, but close enough that nobody
  //       building a VU meter cares.
  //
  // BS.1770-5 momentary loudness uses a 400 ms rectangular window; a
  // one-pole with τ=200 ms is equivalent in energy. For VU-style metering
  // (VU spec: 300 ms RC time), τ=300 ms is the classic default.
  rms: {
    id: 'rms',
    label: 'RMS',
    description: 'RMS level reader — one-pole-averaged power, √ output',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio'   }],
      outputs: [{ id: 'rms', kind: 'control' }],
    },
    params: [
      // Window = 1/e time constant (τ) of the one-pole power averager.
      // 300 ms is VU-meter classic; LUFS momentary ≈ 200 ms.
      { id: 'window', label: 'Window', type: 'number', min: 1, max: 5000, step: 1, default: 300, unit: 'ms', format: fmtMs },
    ],
  },

  svf: {
    id: 'svf',
    label: 'SVF',
    description: 'Simper ZDF state-variable filter — LP/BP/HP/notch, mod-stable',
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

  // Hard clamp: saturates any signal between [lo, hi]. Unlike softLimit
  // (Padé tanh), this is a plain min/max — infinite-order sharpness. Not
  // for audio distortion (aliases badly); role is SAFETY / PARAM-WIRING:
  //   - guard FB-loop state against runaway (feed an envelope through clamp)
  //   - keep a control signal inside a param's valid domain before wiring
  //     to an AudioParam (avoids silent no-ops when WebAudio ignores
  //     out-of-range values)
  //   - build idle-gates: clamp(sig, floor, +∞) → noiseFloor gate
  // Stateless. No denormal concern (min/max preserves zero).
  clamp: {
    id: 'clamp',
    label: 'clamp',
    description: 'hard min/max — saturates signal into [lo, hi]; control-safety primitive',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'lo', label: 'Min', type: 'number', min: -10, max: 10, step: 0.001, default: -1, unit: '', format: (v) => v.toFixed(3) },
      { id: 'hi', label: 'Max', type: 'number', min: -10, max: 10, step: 0.001, default:  1, unit: '', format: (v) => v.toFixed(3) },
    ],
  },

  // L/R stereo correlation meter (Pearson). Classic broadcast tool per
  // IEC 60268-18 stereo metering and EBU R128 sidecar practice; output
  // is the running Pearson coefficient ρ = E[LR] / √(E[L²]·E[R²]) with
  // one-pole-smoothed expectations.
  //   ρ = +1 → perfectly correlated (mono)
  //   ρ =  0 → uncorrelated (decorrelated stereo / noise / surround ambience)
  //   ρ = −1 → anti-correlated (mono-sum will cancel — phase fault)
  // The mean-square smoothing time sets the meter ballistic; 300 ms is
  // the IEC/Dorrough convention. Research: DAFX Zölzer Ch. 11 (Spatial),
  // Canon:loudness §1 (one-pole MS averager — same primitive).
  correlation: {
    id: 'correlation',
    label: 'corr',
    description: 'Pearson stereo correlation meter — ρ ∈ [−1,+1]; +1 mono, 0 decorrelated, −1 phase-inverted',
    ports: {
      inputs:  [{ id: 'l', kind: 'audio' }, { id: 'r', kind: 'audio' }],
      outputs: [{ id: 'corr', kind: 'control' }],
    },
    params: [
      { id: 'timeMs', label: 'Window', type: 'number', min: 10, max: 3000, step: 1, default: 300, unit: 'ms', format: (v) => `${v.toFixed(0)} ms` },
    ],
  },

  // BS.1770-5 §5.1 two-stage gating for integrated loudness.
  //   - 400 ms rectangular blocks, hopped every 100 ms (75% overlap).
  //   - Absolute gate: blocks with L_K < -70 LUFS are discarded (below
  //     the noise-floor of any meaningful programme material).
  //   - Relative gate: over the abs-passing pool, compute the mean MS
  //     → ungated loudness Γa, then the relative threshold is Γa − 10 LU.
  //     Blocks below that are discarded.
  //   - Integrated LUFS = convert the mean MS of the two-stage-passing
  //     blocks to LUFS via L = -0.691 + 10·log10(Σ G·MS / N).
  // Input: K-weighted audio (chain kWeighting→this). Output: running
  // integrated LUFS as a control signal, held between block boundaries.
  loudnessGate: {
    id: 'loudnessGate',
    label: 'lufsInt',
    description: 'BS.1770-5 §5.1 two-stage gated integrated loudness (abs -70, rel -10 LU)',
    ports: {
      inputs:  [{ id: 'in',   kind: 'audio' }],
      outputs: [{ id: 'lufs', kind: 'control' }],
    },
    params: [
      { id: 'channelWeight', label: 'G', type: 'number', min: 0, max: 2, step: 0.01, default: 1.0, unit: '', format: (v) => v.toFixed(2) },
    ],
  },

  // BS.1770-5 Annex 2 True Peak meter. 4× oversampling via a 48-tap
  // linear-phase FIR, decomposed into 4 polyphase branches of 12 taps.
  // Emits the running LINEAR true-peak envelope (magnitude); downstream
  // a `curve` or inline 20·log10 converts to dBTP. Instant attack,
  // exponential release (IEC 60268-10 fall time, default 1700 ms).
  truePeak: {
    id: 'truePeak',
    label: 'truePeak',
    description: 'BS.1770-5 Annex 2 4× oversampled true-peak envelope (linear magnitude)',
    ports: {
      inputs:  [{ id: 'in',   kind: 'audio' }],
      outputs: [{ id: 'peak', kind: 'control' }],
    },
    params: [
      { id: 'releaseMs', label: 'Release', type: 'number', min: 10, max: 10000, step: 1, default: 1700, unit: 'ms', format: (v) => `${v.toFixed(0)} ms` },
    ],
  },

  // Sign extractor: out = x > 0 ? +1 : (x < 0 ? -1 : 0). Control-path
  // utility for sign-preserving math patterns:
  //   asymmetric curves:   sign(x) · |x|^γ  (via curve + sign + abs)
  //   crossover gating:    sign(delta) ≠ sign(delta_prev) → zero-cross
  //   polarity-aware FB:   sign(env) chooses clamp branch
  // Stateless. Bit-exact three-valued output.
  sign: {
    id: 'sign',
    label: 'sign',
    description: 'sign(x) ∈ {-1, 0, +1} — sign-preserving math utility',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'control' }],
    },
    params: [],
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

  // Deterministic noise source. Research-backed:
  //   white = 32-bit LCG per dsp_code_canon_synthesis.md §10 (seed' =
  //           seed*196314165 + 907633515 mod 2³²), upper 24 bits → [-1,1).
  //   pink  = Trammell 3-stage leaky-integrator filter per Canon §8, driven
  //           by our LCG (UPGRADE from rand() so output is seed-deterministic
  //           and testable via golden hash).
  //   brown = 1-pole leaky integrator of white (~6 dB/oct roll-off). Canon
  //           tradition. Denormal-flushed per Jon Watte (Canon:utilities §1).
  //
  // `seed` exposed so golden tests can lock hash; default 22222 matches the
  // Canon §10 example seed. `amount`/`offset` let the author gain-stage the
  // output without a downstream `scaleBy` on the hot path.
  noise: {
    id: 'noise',
    label: 'noise',
    description: 'deterministic noise source — LCG white, Trammell-3 pink, leaky-integrator brown. Canon:synthesis §10 + §8. Seeded for golden-testability.',
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
      // Integer seed for the LCG. Determinism is a ship requirement (golden
      // hash harness + plugin-state recall). Range covers full positive int32.
      { id: 'seed',   label: 'Seed',   type: 'number', min: 1, max: 2147483647, step: 1, default: 22222, unit: '', format: (v) => String(v | 0) },
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

  fdnReverb: {
    id: 'fdnReverb',
    label: 'fdn reverb',
    description: 'Geraint Luff FDN — Hadamard diffuser + Householder FB + HF shelf (monolithic port of MorphReverb; re-decomposed at Stage 3)',
    ports: {
      // Stereo-in / stereo-out. Boundary GainNodes upmix mono to stereo
      // automatically via standard WebAudio channel-count rules, so a mono
      // graph in front of this reverb still works.
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      // All normalised 0..1 — the worklet does the internal taper mapping.
      { id: 'morph',   label: 'Morph',   type: 'number', min: 0, max: 1, step: 0.001, default: 0.5,  unit: '', format: fmtPct },
      { id: 'size',    label: 'Size',    type: 'number', min: 0, max: 1, step: 0.001, default: 0.55, unit: '', format: fmtPct },
      { id: 'decay',   label: 'Decay',   type: 'number', min: 0, max: 1, step: 0.001, default: 0.5,  unit: '', format: fmtPct },
      { id: 'tone',    label: 'Tone',    type: 'number', min: 0, max: 1, step: 0.001, default: 0.55, unit: '', format: fmtPct },
      { id: 'density', label: 'Density', type: 'number', min: 0, max: 1, step: 0.001, default: 0.6,  unit: '', format: fmtPct },
      { id: 'warp',    label: 'Warp',    type: 'number', min: 0, max: 1, step: 0.001, default: 0.3,  unit: '', format: fmtPct },
      { id: 'mix',     label: 'Mix',     type: 'number', min: 0, max: 1, step: 0.001, default: 0.3,  unit: '', format: fmtPct },
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

  // Universal parametric-curve primitive per memory/sandbox_modulation_
  // roadmap.md § 3. ONE primitive authors all five contexts the research
  // enumerates: (1) knob→param taper, (2) GR curve, (3) LFO waveform,
  // (4) saturation transfer, (5) routing crossfade.
  //
  // Contract per § 3: ordered list of `{x, y, tangentIn, tangentOut}`
  // control points evaluated via cubic Bézier or Catmull-Rom. Replaces
  // the five hardcoded taper families ('log' / vari-mu formula /
  // hardcoded LFO shapes / tanh / cos-sin). Monotonicity is validator-
  // checked for knob-taper contexts to prevent un-invertible preset
  // display mappings.
  //
  // Implementation note. We use cubic Hermite internally (x is linear
  // in t per segment, tangents are slopes). Cubic Hermite is strictly
  // equivalent to cubic Bézier for 1-D y=f(x) splines and makes the
  // evaluator O(log N) via binary search + a single Hermite basis
  // evaluation per sample. Catmull-Rom is implemented as Hermite with
  // auto-derived tangents (`m_i = (y_{i+1} - y_{i-1}) / (x_{i+1} -
  // x_{i-1})`), so it is NOT a separate code path — just a tangent
  // strategy.
  //
  // NOT nonlinearity for saturation purposes (that's `saturate` /
  // `waveshaper`). `curve` is shape primitive whose job is to remap.
  // Authors SHOULD wire curve before any drive stage, not after.
  curve: {
    id: 'curve',
    label: 'curve',
    description: 'parametric curve primitive — ordered control-point list evaluated via cubic Hermite (Bézier-equivalent). Default = identity. Authors knob-tapers / GR curves / LFO shapes / saturation transfer / crossfade laws. See sandbox_modulation_roadmap.md § 3.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      // Control points — ordered by x ascending. Each point:
      //   { x, y, tIn, tOut }
      // x/y in the curve's domain (typically [0,1] or [-1,1]);
      // tIn  = slope dy/dx coming INTO this point from the left segment
      // tOut = slope dy/dx leaving this point to the right segment
      // For Catmull-Rom authoring, tIn/tOut are auto-derived from
      // neighbors at evaluation time (see `interp` param).
      // Default = identity line [(0,0)→(1,1)], tangents = 1 (matches
      // linear slope so cubic Hermite degenerates to linear).
      { id: 'points', label: 'Points', type: 'points', default: [
          { x: 0, y: 0, tIn: 1, tOut: 1 },
          { x: 1, y: 1, tIn: 1, tOut: 1 },
        ],
        format: (v) => {
          if (!Array.isArray(v)) return '—';
          if (v.length === 2 && v[0]?.x === 0 && v[0]?.y === 0 && v[1]?.x === 1 && v[1]?.y === 1 && v[0]?.tOut === 1 && v[1]?.tIn === 1) return 'identity';
          return `${v.length} pts`;
        } },
      { id: 'interp', label: 'Interp', type: 'enum', default: 'hermite',
        options: [
          // Use the point's own tIn/tOut slopes — full author control.
          { value: 'hermite', label: 'cubic Hermite (Bézier-equiv)' },
          // Ignore authored tangents; derive from neighbors — one-click
          // smoothness, what you get when user only places (x, y).
          { value: 'catmull', label: 'Catmull-Rom (auto-tangent)'   },
          // Straight lines between points — the monotonic safety net.
          { value: 'linear',  label: 'linear (segments)'             },
        ] },
      // Domain flag for sign-preserving bipolar inputs. When true,
      // evaluator applies curve to |x| and restores sign — lets one
      // point list work for both unipolar envelopes and bipolar LFOs.
      { id: 'bipolar', label: 'Bipolar', type: 'bool', default: false },
    ],
  },

  // Control-rate one-pole lowpass for zipper-free param ramping. Distinct
  // from `envelope` — smooth is symmetric, envelope is asymmetric AR on a
  // rectified audio signal (dynamics detection). Without this op every
  // modulated param zippers on step changes — ship failure per
  // pasp_through_design_lens.md § 938. Time-constant semantics match Web
  // Audio `setTargetAtTime` (see sandbox_modulation_roadmap.md § 11.4).
  smooth: {
    id: 'smooth',
    label: 'smooth',
    description: 'one-pole LP param smoother. y = y_prev + α·(x − y_prev), α = 1 − exp(−1/(τ·sr)). time=0 bypasses. Drop on any modulated param to eliminate zipper. Distinct from `envelope` (asymmetric AR dynamics).',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      // Time constant τ in seconds. 0.01 (10 ms) is the Web Audio default;
      // 0.003 is "snappy" per §11.4; higher values for heavily zipper-prone
      // params (gain dB, filter cutoff). time=0 → α=1 → bit-exact passthrough.
      { id: 'time', label: 'Time', type: 'number', min: 0, max: 1, step: 0.001, default: 0.01, unit: 's', format: (v) => v === 0 ? 'bypass' : `${(v * 1000).toFixed(1)} ms` },
    ],
  },

  // Control-signal coupling primitive. Per-pair math for the six coupling
  // types enumerated in sandbox_modulation_roadmap.md § 2 axis 3 (mul / add
  // / max / min / weighted / lastWins). N-way fan-in compiles to a tree of
  // `combine` nodes — this is the atomic-math half of § 4 item 9. The
  // wire-topology / IR-sources / additive-recomputation half (§ 7 +
  // STEP23 § 51) ships separately as a PCOF schema change, NOT an op.
  combine: {
    id: 'combine',
    label: 'combine',
    description: 'control-signal coupling op. Takes two control streams and combines them per `mode`. Covers 5 of the 6 coupling types from sandbox_modulation_roadmap.md § 2 axis 3; additive fan-out is compiler-emitted via trees of `combine` nodes.',
    ports: {
      inputs:  [{ id: 'a', kind: 'control' }, { id: 'b', kind: 'control' }],
      outputs: [{ id: 'out', kind: 'control' }],
    },
    params: [
      // Blend weight used ONLY when mode='weighted'. Ignored otherwise.
      // Range [0,1]; 0 = all a, 1 = all b. For equal-power crossfade, drive
      // this param through a `curve` op shaped as sin²/cos² — combine stays
      // linear & predictable; crossfade law is authored upstream.
      { id: 'weight', label: 'Weight', type: 'number', min: 0, max: 1, step: 0.001, default: 0.5, unit: '', format: (v) => v.toFixed(3) },
      { id: 'mode', label: 'Mode', type: 'enum', default: 'mul',
        options: [
          // Type 1 coupling (ManChild MAKEUP·GR, Panther DRIVE·shelf gains).
          { value: 'mul',       label: 'multiply (a · b)'            },
          // Type 1 add-variant (peak + RMS blend, ManChild dual-detector).
          { value: 'add',       label: 'add (a + b)'                 },
          // Stereo link — max(|L|,|R|) detector fan-in.
          { value: 'max',       label: 'max (max(a, b))'             },
          // Dual-detector OR-gate style (rare, keep for completeness).
          { value: 'min',       label: 'min (min(a, b))'             },
          // Crossfade between two control streams: out = (1−w)·a + w·b.
          // Linear weights; for equal-power law, shape `weight` via `curve`
          // upstream (sin/cos crossfade). Only active when mode=weighted.
          { value: 'weighted',  label: 'weighted ((1−w)·a + w·b)'    },
          // Hard override — b replaces a whenever b is wired.
          { value: 'lastWins',  label: 'last-writer-wins (b over a)' },
        ] },
    ],
  },

  softLimit: {
    id: 'softLimit',
    label: 'soft limit',
    description: 'tanh soft-limit — unity through the linear region, asymptotes to ±threshold. Drop inline on feedback returns alongside dcBlock; NOT a character stage (use `saturate` for drive/color).',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      // Threshold: where the curve starts to bend. Default 0.95 keeps full
      // unity for anything normal-signal and clamps only when the FB loop
      // is about to blow up. Range deliberately excludes 0 (infinite
      // compression) and ≥2 (effectively no bending at normal signal).
      { id: 'threshold', label: 'Thresh', type: 'number', min: 0.1, max: 1.8, step: 0.01, default: 0.95, unit: '', format: fmtX },
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
  if (p.type === 'points') {
    // Curve param: summarize as count + identity detection. Full editor
    // renders the points separately; this is the one-liner under the node.
    if (!Array.isArray(value) || value.length < 2) return '—';
    const isIdentity =
      value.length === 2 &&
      value[0].x === 0 && value[0].y === 0 &&
      value[1].x === 1 && value[1].y === 1;
    return isIdentity ? 'identity' : `${value.length} pts`;
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
    if (p.type === 'enum' || p.type === 'points') continue;
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
