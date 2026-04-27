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
      // ui:'slider' per codegen_pipeline_buildout.md § 4.4 — gain/level/mix/output default to linear slider in native editor.
      { id: 'gainDb', label: 'Gain', type: 'number', min: -60, max: 24, step: 0.1, default: 0, unit: 'dB', format: fmtDb, ui: 'slider' },
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

  // ───────────────────────────────────────────────────────────────────────
  // goertzel — single-tone magnitude detector (Canon:analysis §1).
  //
  // 2nd-order IIR tuned to one frequency; O(N) per block vs. FFT's
  // O(N log N). Classic uses: DTMF, tuners, sine-presence probes,
  // narrowband watermark detection. Output updates once per blockN
  // samples and is held between — reported latency = blockN.
  //
  //   coeff = 2·cos(2π · freq / sr)
  //   per sample: Skn2 = Skn1; Skn1 = Skn; Skn = x + coeff·Skn1 − Skn2
  //   per block : |X|² = Skn² + Skn1² − coeff·Skn·Skn1
  //               mag  = sqrt(max(0, |X|²)) · (2 / N)     // peak-normalised
  //
  // Uses the CORRECT squared-magnitude form — not the buggy real-only
  // `Skn − WNk·Skn1` variant flagged in canon §1 LIMITS.
  goertzel: {
    id: 'goertzel',
    label: 'Goertzel',
    description: 'Goertzel single-tone magnitude detector — O(N) narrowband probe',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio'   }],
      outputs: [{ id: 'mag', kind: 'control' }],
    },
    params: [
      { id: 'freq',   label: 'Freq',    type: 'number', min: 1,  max: 20000, step: 1, default: 1000, unit: 'Hz',      format: fmtHz },
      { id: 'blockN', label: 'Block N', type: 'number', min: 16, max: 8192,  step: 1, default: 512,  unit: 'samples', format: (v) => `${v|0}` },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // lpc — Linear-predictive coding front-end (Canon:analysis §2).
  //
  // Autocorrelation + Levinson-Durbin; outputs the prediction-error
  // ("residual") signal. The residual is the input with its all-pole
  // spectral envelope stripped — it sounds like a whispery, throat-less
  // version of the source and IS the excitation for vocoder / cross-
  // synthesis / formant-shift applications downstream.
  //
  //   R[k] = Σ_n x[n]·x[n-k]        for k=0..P
  //   Levinson-Durbin → a[1..P]     (AR coefs, reflections clamped |k|≤0.999)
  //   e[n] = x[n] + Σ a[k]·x[n-k]   (prediction-error FIR)
  //
  // Coefs update once per blockN samples; first block emits silence until
  // coefs exist. Latency = blockN.
  lpc: {
    id: 'lpc',
    label: 'LPC',
    description: 'Linear-predictive coding residual — whitens the spectral envelope',
    ports: {
      inputs:  [{ id: 'in',       kind: 'audio' }],
      outputs: [{ id: 'residual', kind: 'audio' }],
    },
    params: [
      { id: 'order',  label: 'Order',   type: 'number', min: 1,  max: 32,   step: 1, default: 12,   unit: 'poles',   format: (v) => `${v|0}` },
      { id: 'blockN', label: 'Block N', type: 'number', min: 64, max: 8192, step: 1, default: 1024, unit: 'samples', format: (v) => `${v|0}` },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // warpedLPC — Bark-warped linear-predictive coding residual.
  // Primary: musicdsp #137 (analysis) + canonical warped-FIR allpass chain
  // (inverse filter). Same residual semantics as #71 lpc, with frequency
  // resolution concentrated in low bands via first-order allpass warp.
  warpedLPC: {
    id: 'warpedLPC',
    label: 'Warped LPC',
    description: 'Bark-warped LPC residual — low-band-resolved spectral envelope whitening',
    ports: {
      inputs:  [{ id: 'in',       kind: 'audio' }],
      outputs: [{ id: 'residual', kind: 'audio' }],
    },
    params: [
      { id: 'order',  label: 'Order',   type: 'number', min: 1,    max: 32,   step: 1,    default: 12,   unit: 'poles',   format: (v) => `${v|0}` },
      { id: 'blockN', label: 'Block N', type: 'number', min: 64,   max: 8192, step: 1,    default: 1024, unit: 'samples', format: (v) => `${v|0}` },
      { id: 'lambda', label: 'Warp λ',  type: 'number', min: -0.99, max: 0.99, step: 0.01, default: 0.65,                format: (v) => v.toFixed(2) },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // waveguide — bidirectional lossy digital waveguide (JOS §4.3–§4.5).
  //
  // Two delay lines of length L = round(sr / (2·freq)) representing the
  // right- and left-going traveling waves in a 1D acoustic medium (tube,
  // bore, string). Each end has a reflection coefficient and a damping
  // filter (two-point-average mix) before the wave feeds back into the
  // opposite delay. Karplus-Strong (#85) is this reduced to one delay.
  //
  //   closed-closed (both refl > 0)  → full harmonic series (clarinet-ish
  //                                     with reed driver, organ-pipe idle)
  //   open-closed   (one refl < 0)   → odd-only harmonics (stopped pipe)
  //   both zero + damp=1             → single-pass, no resonance
  //
  // Latency = 0 (resonator, not block analyzer). Integer-delay only in v1;
  // fractional tuning (Thiran) is the upgrade path.
  waveguide: {
    id: 'waveguide',
    label: 'Waveguide',
    description: 'Bidirectional lossy waveguide — 1D acoustic tube / string / bore',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'freq',  label: 'Freq',   type: 'number', min: 20,   max: 4000, step: 1,    default: 220,  unit: 'Hz', format: fmtHz },
      { id: 'reflL', label: 'Refl L', type: 'number', min: -1,   max: 1,    step: 0.01, default: 0.98 },
      { id: 'reflR', label: 'Refl R', type: 'number', min: -1,   max: 1,    step: 0.01, default: 0.98 },
      { id: 'damp',  label: 'Damp',   type: 'number', min: 0,    max: 1,    step: 0.01, default: 0.1  },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // kellyLochbaum — concatenated 1-sample waveguide sections with 2-port
  // scattering junctions (JOS §7.1, §10.1; first digital physical-modeling
  // synthesis, Kelly/Lochbaum/Mathews 1961).
  //
  // With taper=0, every junction is transparent and the whole chain
  // collapses to a cylindrical waveguide of `length` samples (degenerate
  // case of #86 waveguide). Nonzero taper makes each junction partially
  // reflective → formant clustering → vowel-like / horn-like coloration.
  //
  //   Δ_i         = k · (f⁺[i] − f⁻[i+1])     // one-mult scatter
  //   new_f⁺[i+1] = f⁺[i] + Δ_i
  //   new_f⁻[i]   = f⁻[i+1] + Δ_i
  //
  // Latency = 0. Constant k along tract in v1 (per-junction vowel presets
  // require array-param support — upgrade path).
  kellyLochbaum: {
    id: 'kellyLochbaum',
    label: 'Kelly-Lochbaum',
    description: 'Kelly-Lochbaum lattice — N-section scattering tube, vocal-tract core',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'length',  label: 'Length',  type: 'number', min: 4,  max: 512, step: 1,    default: 32,    unit: 'sections', format: (v) => `${v|0}` },
      { id: 'taper',   label: 'Taper',   type: 'number', min: -1, max: 1,   step: 0.01, default: 0     },
      { id: 'glottis', label: 'Glottis', type: 'number', min: -1, max: 1,   step: 0.01, default: -0.9  },
      { id: 'lip',     label: 'Lip',     type: 'number', min: -1, max: 1,   step: 0.01, default: -0.85 },
      { id: 'damp',    label: 'Damp',    type: 'number', min: 0,  max: 1,   step: 0.01, default: 0.05  },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // chamberlinZeroCross — sign-magnitude DAC zero-crossing character.
  // Paraphrase of Chamberlin 1985 §12.4 (physical book, not directly
  // opened — math-by-definition ship). Two artifacts: dead zone near
  // |x|=0, and a one-sample glitch at each sign change.
  // ───────────────────────────────────────────────────────────────────────
  // tapeSim — magnetic tape character. gloubi-boulga waveshape → RBJ peaking
  // biquad (head-bump LF resonance) → 1-pole LP (HF loss). Hysteresis /
  // wow-flutter / pre-emphasis deferred to v2 (debt).
  tapeSim: {
    id: 'tapeSim',
    label: 'Tape',
    description: 'Gloubi-boulga sat · head-bump · HF loss (musicdsp #86 + RBJ)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'drive',  label: 'Drive',    type: 'number', min: 0,    max: 20,    step: 0.01, default: 1.0 },
      { id: 'bumpHz', label: 'Bump Hz',  type: 'number', min: 10,   max: 500,   step: 1,    default: 60  },
      { id: 'bumpDb', label: 'Bump dB',  type: 'number', min: -12,  max: 12,    step: 0.1,  default: 3.0 },
      { id: 'bumpQ',  label: 'Bump Q',   type: 'number', min: 0.1,  max: 10,    step: 0.01, default: 1.0 },
      { id: 'hfHz',   label: 'HF Loss',  type: 'number', min: 200,  max: 22000, step: 10,   default: 16000 },
      { id: 'trim',   label: 'Output',   type: 'number', min: 0,    max: 4,     step: 0.01, default: 1.0 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // tapeAirwindows — Airwindows ToTape9 faithful mono port (MIT). 12-stage
  // chain: Dubly encode → flutter → 9-threshold golden-ratio bias → tiny
  // hysteresis → pre-avg cascade → Taylor-sin sat (±2.305929… clamp, coefs
  // /6, /69, /2530.08, /224985.6, /9979200) → post-avg → tan-K dual-biquad
  // BPF head-bump + cubic soft-clip → Dubly decode → output. See debt #112.
  tapeAirwindows: {
    id: 'tapeAirwindows',
    label: 'Tape (Airwindows)',
    description: 'Airwindows ToTape9 port · Dubly·flutter·bias·Taylor-sin·head-bump',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'drive',        label: 'Drive',        type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'dubly',        label: 'Dubly',        type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'encCross',     label: 'Enc X-over',   type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'flutterDepth', label: 'Flutter',      type: 'number', min: 0, max: 1, step: 0.001, default: 0.0 },
      { id: 'flutterRate',  label: 'Flutter Rate', type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'bias',         label: 'Bias',         type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'bumpMix',      label: 'Head Bump',    type: 'number', min: 0, max: 1, step: 0.001, default: 0.25 },
      { id: 'bumpHz',       label: 'Bump Freq',    type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // tubeSim — Norman Koren 1996 SPICE triode model (12AX7 defaults).
  // Memoryless waveshaper: EG = -bias + drive·x → Koren eq.4 → IP, then
  // DC-subtract quiescent. Asymmetric: positive side soft-saturates
  // (softplus curve), negative side hard-clips at cutoff (IP=0). No grid
  // current, no plate-load dynamics, no Miller HF — compose externally.
  tubeSim: {
    id: 'tubeSim',
    label: 'Tube',
    description: 'Koren 1996 triode model (12AX7) — asymmetric soft+hard waveshaper',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'drive',  label: 'Drive',    type: 'number', min: 0,   max: 20,   step: 0.01, default: 1.5 },
      { id: 'bias',   label: 'Bias',     type: 'number', min: 0,   max: 5,    step: 0.01, default: 1.5 },
      { id: 'plateV', label: 'Plate V',  type: 'number', min: 50,  max: 500,  step: 1,    default: 250 },
      { id: 'mu',     label: 'μ',        type: 'number', min: 5,   max: 200,  step: 0.1,  default: 100 },
      { id: 'ex',     label: 'Exponent', type: 'number', min: 1,   max: 2,    step: 0.01, default: 1.4 },
      { id: 'kg1',    label: 'kG1',      type: 'number', min: 100, max: 5000, step: 1,    default: 1060 },
      { id: 'kp',     label: 'kP',       type: 'number', min: 50,  max: 2000, step: 1,    default: 600 },
      { id: 'kvb',    label: 'kVB',      type: 'number', min: 10,  max: 1000, step: 1,    default: 300 },
      { id: 'trim',   label: 'Output',   type: 'number', min: 0,   max: 4,    step: 0.01, default: 1.0 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // plate — Dattorro 1997 JAES "Effect Design Part 1" plate-class reverb.
  // Verbatim Fig. 1 topology and Table 2 tap structure. Sample-count
  // constants are calibrated at Fs=29761 Hz and scaled linearly by sr·size.
  // Synthetic stereo: mono input → 7+7 taps across both tank halves.
  plate: {
    id: 'plate',
    label: 'Plate',
    description: 'Dattorro 1997 plate reverb · figure-8 tank · synthetic stereo taps',
    ports: {
      inputs:  [{ id: 'l', kind: 'audio' }, { id: 'r', kind: 'audio' }],
      outputs: [{ id: 'l', kind: 'audio' }, { id: 'r', kind: 'audio' }],
    },
    params: [
      { id: 'decay',      label: 'Decay',      type: 'number', min: 0,    max: 0.99, step: 0.001, default: 0.5 },
      { id: 'predelayMs', label: 'Pre-Delay',  type: 'number', min: 0,    max: 200,  step: 0.1,   default: 0,    unit: 'ms' },
      { id: 'bandwidth',  label: 'Bandwidth',  type: 'number', min: 0,    max: 1,    step: 0.0001,default: 0.9999 },
      { id: 'damping',    label: 'Damping',    type: 'number', min: 0,    max: 0.99, step: 0.001, default: 0.0005 },
      { id: 'size',       label: 'Size',       type: 'number', min: 0.5,  max: 1.5,  step: 0.001, default: 1.0 },
      { id: 'modDepth',   label: 'Mod Depth',  type: 'number', min: 0,    max: 32,   step: 0.1,   default: 16, unit: 'smp' },
      { id: 'modRateHz',  label: 'Mod Rate',   type: 'number', min: 0.1,  max: 5,    step: 0.01,  default: 1.0,  unit: 'Hz' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // schroederChain — Schroeder 1962 JAES "Natural Sounding Artificial
  // Reverberation": 4 parallel feedback combs (29.7/37.1/41.1/43.7 ms)
  // summed → 2 series Schroeder allpasses (5.0/1.7 ms, g=0.7). Per-comb
  // gain from rt60 via g=10^(−3τ/T60). Optional Moorer 1979 damping LPF
  // in comb FB (damping=0 = pure 1962 behaviour). Stereo via Freeverb-
  // style delay-offset (`spread`) on R bank.
  // ───────────────────────────────────────────────────────────────────────
  // yin — de Cheveigné & Kawahara 2002 JASA fundamental-frequency estimator.
  // Steps 1–5 per paper (Table I error rate 0.77%). Step 6 "best local
  // estimate" skipped for MVP (block-reprocessing, research debt).
  // Frame-based: one pitch estimate per W-sample integration window.
  // Control-rate outputs: f0 (Hz) and confidence (1 − d'(τ), clamped).
  yin: {
    id: 'yin',
    label: 'YIN',
    description: 'YIN pitch detector · de Cheveigné 2002 · difference-fn + CMNDF + parabolic',
    ports: {
      inputs:  [{ id: 'in',         kind: 'audio'   }],
      outputs: [{ id: 'f0',         kind: 'control' }, { id: 'confidence', kind: 'control' }],
    },
    params: [
      { id: 'f0Min',     label: 'f0 Min',    type: 'number', min: 10,   max: 2000, step: 1,    default: 80,   unit: 'Hz' },
      { id: 'f0Max',     label: 'f0 Max',    type: 'number', min: 20,   max: 12000,step: 1,    default: 1000, unit: 'Hz' },
      { id: 'threshold', label: 'Threshold', type: 'number', min: 0.01, max: 0.5,  step: 0.01, default: 0.1 },
      { id: 'windowMs',  label: 'Window',    type: 'number', min: 5,    max: 200,  step: 1,    default: 25,   unit: 'ms' },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // pyin — Mauch & Dixon 2014 ICASSP probabilistic YIN. Two stages:
  // Stage 1 per-frame prob-threshold scan over 100 thresholds with Beta-PMF
  // weighting (4 priors from c4dm/pyin verbatim); Stage 2 2M-state sparse
  // HMM (voiced + unvoiced mirror, M=345 @ 20-cent bins, ±100-cent triangular
  // transition, selfTrans=0.99) decoded by fixed-lag online Viterbi.
  // Code (github.com/c4dm/pyin) beats paper when they conflict; see op header.
  // Outputs: f0 (Hz), voicedProb ([0,1]), voicedFlag (0/1).
  pyin: {
    id: 'pyin',
    label: 'pYIN',
    description: 'pYIN · Mauch 2014 · prob-threshold YIN + 2M-state fixed-lag HMM Viterbi',
    ports: {
      inputs:  [{ id: 'in',         kind: 'audio'   }],
      outputs: [
        { id: 'f0',         kind: 'control' },
        { id: 'voicedProb', kind: 'control' },
        { id: 'voicedFlag', kind: 'control' },
      ],
    },
    params: [
      { id: 'f0Min',     label: 'f0 Min',     type: 'number', min: 20,  max: 500,  step: 0.001, default: 61.735, unit: 'Hz' },
      { id: 'f0Max',     label: 'f0 Max',     type: 'number', min: 200, max: 4000, step: 1,     default: 880,    unit: 'Hz' },
      { id: 'windowMs',  label: 'Window',     type: 'number', min: 10,  max: 200,  step: 0.1,   default: 46.4,   unit: 'ms' },
      { id: 'hopMs',     label: 'Hop',        type: 'number', min: 1,   max: 50,   step: 0.1,   default: 5.8,    unit: 'ms' },
      { id: 'prior',     label: 'Prior',      type: 'number', min: 0,   max: 4,    step: 1,     default: 2 },
      { id: 'yinTrust',  label: 'YIN Trust',  type: 'number', min: 0,   max: 1,    step: 0.001, default: 0.5 },
      { id: 'selfTrans', label: 'Self Trans', type: 'number', min: 0,   max: 1,    step: 0.001, default: 0.99 },
      { id: 'lagFrames', label: 'Lag',        type: 'number', min: 1,   max: 64,   step: 1,     default: 8 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // crepe — Kim, Salamon, Li, Bello ICASSP 2018: "CREPE: A Convolutional
  // Representation for Pitch Estimation". CNN F0 tracker, 1024-sample
  // frames @ 16 kHz, 360-bin sigmoid → cents (linspace(0,7180,360)+1997.379)
  // → Hz. ML-runtime-gated: kind:'neural' marks the op for the golden-hash
  // harness skip-list (Neural Op Exception clause). Worklet path runs
  // inference off-worklet via MessagePort → host MLRuntime; native path
  // runs ORT-native synchronously inline. See op_crepe.worklet.js header
  // and codegen_design.md §13 for the asymmetry rationale.
  //
  // STAGE 1 (2026-04-24): architectural foundation only — registry entry,
  // worklet shell with mocked zero-crossing F0 estimator (math tests
  // verify framing/resample/dispatch plumbing). STAGE 2 wires real
  // ORT-Web inference + crepe-tiny.onnx weight bundle.
  // ───────────────────────────────────────────────────────────────────────
  crepe: {
    id: 'crepe',
    label: 'CREPE',
    description: 'CREPE pitch detector · Kim 2018 · CNN @ 16 kHz · ML-gated · Stage 1 architectural-foundation ship',
    kind: 'neural',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [
        { id: 'f0',         kind: 'control' },
        { id: 'confidence', kind: 'control' },
      ],
    },
    params: [
      { id: 'voicingThreshold', label: 'Voicing', type: 'number', min: 0, max: 1, step: 0.001, default: 0.5 },
      { id: 'modelSize',        label: 'Model',   type: 'enum',   default: 'tiny',
        options: ['tiny', 'small', 'medium', 'large', 'full'] },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // haas — Haas stereo widener (Haas 1951, Acustica 1:49-58 / JAES 1972
  // 20(2):146-159). Psychoacoustic-defaults op: mono→stereo via a single
  // 5-30 ms reflection with up to +10 dB headroom before echo perception
  // kicks in (precedence effect). DSP is math-by-definition (ring-buffer
  // delay + gain + side-select); primary constrains only param ranges &
  // defaults (delayMs∈[0,50], levelDb∈[-24,+10], mid-window defaults).
  haas: {
    id: 'haas',
    label: 'Haas',
    description: 'Haas widener · Haas 1951 precedence · mono→stereo via one delayed reflection',
    ports: {
      inputs:  [
        { id: 'in',  kind: 'audio' },
        { id: 'in2', kind: 'audio', optional: true },
      ],
      outputs: [
        { id: 'l', kind: 'audio' },
        { id: 'r', kind: 'audio' },
      ],
    },
    params: [
      { id: 'delayMs', label: 'Delay',  type: 'number', min: 0,   max: 50, step: 0.01, default: 18, unit: 'ms' },
      { id: 'levelDb', label: 'Level',  type: 'number', min: -24, max: 10, step: 0.1,  default: 0,  unit: 'dB' },
      { id: 'side',    label: 'Side',   type: 'number', min: 0,   max: 1,  step: 1,    default: 0 },
      { id: 'mix',     label: 'Mix',    type: 'number', min: 0,   max: 1,  step: 0.001, default: 1 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // panner — Three canonical stereo pan laws (linear / constant-power /
  // -4.5 dB compromise). Primary: Dannenberg/Dobson "Loudness Concepts &
  // Panning Laws" (CMU ICM readings, open): formulas verbatim in op header.
  // DAW-standard pan ∈ [-1,+1] → θ ∈ [0, π/2]. Constant-power default.
  panner: {
    id: 'panner',
    label: 'Panner',
    description: 'Stereo pan · linear / constant-power (-3 dB) / -4.5 dB · CMU ICM panning laws',
    ports: {
      inputs:  [
        { id: 'in',  kind: 'audio' },
        { id: 'in2', kind: 'audio', optional: true },
      ],
      outputs: [
        { id: 'l', kind: 'audio' },
        { id: 'r', kind: 'audio' },
      ],
    },
    params: [
      { id: 'pan', label: 'Pan', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 'law', label: 'Law', type: 'number', min: 0,  max: 2, step: 1,     default: 1 },
    ],
  },

  // autopan — LFO-driven constant-power stereo pan. Composition of #11 lfo
  // (Puckette §5.2 AM formula, sub-audio modulator) and #103 panner (CMU ICM
  // constant-power pan law). Per-sample gain recompute → no zipper on fast rates.
  autopan: {
    id: 'autopan',
    label: 'Autopan',
    description: 'LFO-driven constant-power autopan · Puckette §5.2 AM · CMU ICM pan',
    ports: {
      inputs:  [
        { id: 'in',  kind: 'audio' },
        { id: 'in2', kind: 'audio', optional: true },
      ],
      outputs: [
        { id: 'l', kind: 'audio' },
        { id: 'r', kind: 'audio' },
      ],
    },
    params: [
      { id: 'rateHz',   label: 'Rate',  type: 'number', min: 0.01, max: 20,  step: 0.01,  default: 1, unit: 'Hz' },
      { id: 'depth',    label: 'Depth', type: 'number', min: 0,    max: 1,   step: 0.001, default: 1 },
      { id: 'shape',    label: 'Shape', type: 'number', min: 0,    max: 2,   step: 1,     default: 0 },
      { id: 'phaseDeg', label: 'Phase', type: 'number', min: 0,    max: 360, step: 1,     default: 0, unit: '°' },
    ],
  },

  // chaos — logistic-map chaos generator (SC Logistic algorithm; May 1976).
  chaos: {
    id: 'chaos',
    label: 'Chaos',
    description: 'Logistic-map chaos · y = r·y·(1-y) · SC Logistic algorithm',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'r',     label: 'Chaos', type: 'number', min: 2.5,   max: 4,     step: 0.001, default: 3.99 },
      { id: 'freq',  label: 'Rate',  type: 'number', min: 0.01,  max: 24000, step: 0.01,  default: 100, unit: 'Hz' },
      { id: 'y0',    label: 'Seed',  type: 'number', min: 0.001, max: 0.999, step: 0.001, default: 0.5 },
      { id: 'mode',  label: 'Mode',  type: 'number', min: 0,     max: 1,     step: 1,     default: 1 },
      { id: 'level', label: 'Level', type: 'number', min: 0,     max: 1,     step: 0.001, default: 1 },
    ],
  },

  // stepSeq — 8-step value-table sequencer (SC Stepper counter algorithm).
  stepSeq: {
    id: 'stepSeq',
    label: 'Step Seq',
    description: '8-step sequencer · rising-edge trig advances · SC Stepper algorithm',
    ports: {
      inputs:  [{ id: 'trig', kind: 'audio' }],
      outputs: [{ id: 'out',  kind: 'audio' }],
    },
    params: [
      { id: 'length', label: 'Length', type: 'number', min: 1, max: 8, step: 1, default: 8 },
      { id: 's0', label: 'Step 0', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's1', label: 'Step 1', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's2', label: 'Step 2', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's3', label: 'Step 3', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's4', label: 'Step 4', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's5', label: 'Step 5', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's6', label: 'Step 6', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
      { id: 's7', label: 'Step 7', type: 'number', min: -1, max: 1, step: 0.001, default: 0 },
    ],
  },

  // randomWalk — bounded random walk (SC BrownNoise reflective-boundary algorithm).
  randomWalk: {
    id: 'randomWalk',
    label: 'Random Walk',
    description: 'Bounded random walk / brown noise · reflective ±1 · SC BrownNoise algorithm',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'step',  label: 'Step',  type: 'number', min: 0.0001, max: 0.5, step: 0.0001, default: 0.125 },
      { id: 'level', label: 'Level', type: 'number', min: 0,      max: 1,   step: 0.001,  default: 1 },
    ],
  },

  // sampleHold — SC Latch semantics (rising-edge trigger latches input).
  sampleHold: {
    id: 'sampleHold',
    label: 'Sample & Hold',
    description: 'Latch input on rising-edge trigger · SC Latch semantics',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }, { id: 'trig', kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [],
  },

  // crackle — sparse random-impulse noise (SC Dust/Dust2 algorithm, GPLv3 code not copied).
  crackle: {
    id: 'crackle',
    label: 'Crackle',
    description: 'Sparse random impulses · tape/vinyl crackle · SC Dust-family algorithm',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'density', label: 'Density', type: 'number', min: 0.01, max: 24000, step: 0.01, default: 100, unit: 'Hz' },
      { id: 'mode',    label: 'Mode',    type: 'number', min: 0,    max: 1,     step: 1,    default: 1 },
      { id: 'level',   label: 'Level',   type: 'number', min: -60,  max: 0,     step: 0.1,  default: 0, unit: 'dB' },
    ],
  },

  // hiss — white/pink noise source (feldkirch PRNG + Kellett pink filter, both open).
  hiss: {
    id: 'hiss',
    label: 'Hiss',
    description: 'White / pink noise source · feldkirch PRNG + Kellett pink filter',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'level', label: 'Level', type: 'number', min: -60, max: 0, step: 0.1, default: -24, unit: 'dB' },
      { id: 'tint',  label: 'Tint',  type: 'number', min: 0,   max: 1, step: 1,   default: 1 },
    ],
  },

  // envelopeFollower — Bram de Jong AR envelope follower (musicdsp #136).
  // Audio-rate output; distinct from #4 envelope (which is control-rate + remap).
  envelopeFollower: {
    id: 'envelopeFollower',
    label: 'Envelope Follower',
    description: 'Audio-rate AR envelope · peak / RMS · Bram de Jong musicdsp #136',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'attack',  label: 'Attack',  type: 'number', min: 0.1, max: 1000, step: 0.1, default: 5,   unit: 'ms' },
      { id: 'release', label: 'Release', type: 'number', min: 1,   max: 5000, step: 1,   default: 120, unit: 'ms' },
      { id: 'mode',    label: 'Mode',    type: 'number', min: 0,   max: 1,    step: 1,   default: 0 },
    ],
  },

  // crossfeed — Bauer/libbs2b stereo→binaural headphone crossfeed.
  // Primary: libbs2b v3.1.0 (MIT). Two 1-pole IIRs + cross-sum topology.
  crossfeed: {
    id: 'crossfeed',
    label: 'Crossfeed',
    description: 'Bauer headphone crossfeed · libbs2b math verbatim · stereo → binaural',
    ports: {
      inputs:  [
        { id: 'in',  kind: 'audio' },
        { id: 'in2', kind: 'audio' },
      ],
      outputs: [
        { id: 'l', kind: 'audio' },
        { id: 'r', kind: 'audio' },
      ],
    },
    params: [
      { id: 'fcut', label: 'Cutoff', type: 'number', min: 300, max: 2000, step: 1,    default: 700, unit: 'Hz' },
      { id: 'feed', label: 'Feed',   type: 'number', min: 1,   max: 15,   step: 0.1,  default: 4.5, unit: 'dB' },
    ],
  },

  schroederChain: {
    id: 'schroederChain',
    label: 'Schroeder',
    description: 'Schroeder 1962 · 4 parallel combs → 2 series allpasses · first digital reverb',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'l',  kind: 'audio' }, { id: 'r', kind: 'audio' }],
    },
    params: [
      { id: 'rt60',    label: 'RT60',    type: 'number', min: 0.1,  max: 10, step: 0.01,  default: 2.0, unit: 's' },
      { id: 'damping', label: 'Damping', type: 'number', min: 0,    max: 0.95, step: 0.001, default: 0.0 },
      { id: 'size',    label: 'Size',    type: 'number', min: 0.3,  max: 2,  step: 0.001, default: 1.0 },
      { id: 'spread',  label: 'Spread',  type: 'number', min: 0,    max: 40, step: 1,     default: 23 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // spring — Parker 2011 EURASIP / Välimäki 2010 JAES parametric spring
  // reverb. Two parallel feedback loops (C_lf + C_hf), each = cascade of
  // stretched allpasses A^M(z^k) in FB with delay line; C_lf has a lowpass
  // at f_C (transition frequency). v1 skips Parker §3 multirate optimisation
  // (computational, not sonic) and Välimäki's cross-coupling/modulation
  // extras (debt rows).
  spring: {
    id: 'spring',
    label: 'Spring',
    description: 'Parker 2011 spring reverb · stretched-AP dispersion · lo/hi chirped FB',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'l',  kind: 'audio' }, { id: 'r', kind: 'audio' }],
    },
    params: [
      { id: 'decay',        label: 'Decay',       type: 'number', min: 0,    max: 0.95,  step: 0.001, default: 0.7 },
      { id: 'dispersion',   label: 'Dispersion',  type: 'number', min: 0,    max: 0.9,   step: 0.001, default: 0.65 },
      { id: 'transitionHz', label: 'Transition',  type: 'number', min: 500,  max: 12000, step: 1,     default: 4300, unit: 'Hz' },
      { id: 'chirpRate',    label: 'Chirp Rate',  type: 'number', min: 0.3,  max: 3,     step: 0.001, default: 1.0 },
      { id: 'numStagesLF',  label: 'LF Stages',   type: 'number', min: 0,    max: 60,    step: 1,     default: 30 },
      { id: 'numStagesHF',  label: 'HF Stages',   type: 'number', min: 0,    max: 40,    step: 1,     default: 12 },
      { id: 'mixLF',        label: 'LF Mix',      type: 'number', min: 0,    max: 1,     step: 0.001, default: 1.0 },
      { id: 'mixHF',        label: 'HF Mix',      type: 'number', min: 0,    max: 1,     step: 0.001, default: 0.3 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // SDN — Scattering Delay Network (De Sena, Hacıhabiboğlu, Cvetković &
  // Smith 2015, IEEE/ACM TASLP vol.23 no.9). Fully-connected DWN with one
  // scattering node per wall (K=5 neighbours, rectangular room). Isotropic
  // scattering matrix A=(2/K)11ᵀ−I applied per node, wall absorption β=√(1−α)
  // from Sabine rt60. First-order reflections rendered exactly by placing
  // wall nodes at mirror-image intersection points. v1 skips directivity,
  // frequency-dependent wall filters beyond 1-pole, 2nd-order corrections.
  SDN: {
    id: 'SDN',
    label: 'SDN',
    description: 'Scattering Delay Network · De Sena 2015 · 6-wall shoebox · first-order exact',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'l',  kind: 'audio' }, { id: 'r', kind: 'audio' }],
    },
    params: [
      { id: 'rt60',    label: 'RT60',    type: 'number', min: 0.2, max: 8, step: 0.01,  default: 1.2, unit: 's' },
      { id: 'size',    label: 'Size',    type: 'number', min: 0.3, max: 3, step: 0.001, default: 1.0 },
      { id: 'damping', label: 'Damping', type: 'number', min: 0,   max: 1, step: 0.001, default: 0.3 },
      { id: 'width',   label: 'Width',   type: 'number', min: 0,   max: 1, step: 0.001, default: 0.3 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // fpDacRipple — floating-point DAC ripple. ValhallaVintageVerb 70s/80s-
  // mode fingerprint. 12-bit mantissa + N-bit gain-ranging exponent gives
  // signal-dependent step size (quiet = fine, loud = coarse); the audible
  // "ripple" is step-size doubling at power-of-two boundaries. Costello
  // tail-noise masks the fizzle on decays.
  fpDacRipple: {
    id: 'fpDacRipple',
    label: 'FP-DAC Ripple',
    description: 'Floating-point DAC gain-ranging quantize (Costello/RMX16-style)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'bits',    label: 'Bits',     type: 'number', min: 4, max: 16,   step: 1,      default: 12 },
      { id: 'expBits', label: 'Exp Bits', type: 'number', min: 0, max: 4,    step: 1,      default: 3  },
      { id: 'noise',   label: 'Noise',    type: 'number', min: 0, max: 0.01, step: 0.0001, default: 0.0005 },
      { id: 'seed',    label: 'Seed',     type: 'number', min: 1, max: 2147483647, step: 1, default: 1 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // xformerSat — audio transformer with frequency-dependent core saturation
  // (volt-second LF compression) + hysteresis loss + HF leakage rolloff.
  // De Paiva 2011 WDF model: variable-turns nonlinear capacitor (Eq 34) on
  // an HP through-path, plus delayed-vr nonlinear resistor (Eq 17, §3.3).
  // Distinct from #111 transformerSim (memoryless Langevin waveshaper).
  // Primary: docs/primary_sources/transformers/DePaiva_2011_*.pdf
  xformerSat: {
    id: 'xformerSat',
    label: 'Xformer Sat',
    description: 'De Paiva 2011 WDF transformer (volt-second LF sat + hysteresis)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'drive',    label: 'Drive',     type: 'number', min: -24, max: 36,    step: 0.1,  default: 0   },
      { id: 'coreSize', label: 'Core Size', type: 'number', min: 0.05, max: 10,   step: 0.01, default: 1   },
      { id: 'sourceZ',  label: 'Source Z',  type: 'number', min: 1,    max: 10000, step: 1,   default: 600 },
      { id: 'loss',     label: 'Loss',      type: 'number', min: 0,    max: 1,    step: 0.01, default: 0.3 },
      { id: 'air',      label: 'Air',       type: 'number', min: 0.1,  max: 8,    step: 0.01, default: 1   },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // transformerSim — audio transformer soft-saturation character. Anhysteretic
  // component of the Jiles-Atherton 1986 magnetic model (Langevin function),
  // with optional DC-bias for asymmetric even-harmonic content.
  //   y(n) = output · [ L(drive·x + bias) − L(bias) ],  L(x) = coth(x) − 1/x
  transformerSim: {
    id: 'transformerSim',
    label: 'Transformer',
    description: 'Jiles-Atherton anhysteretic Langevin waveshaper (1986)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'drive',  label: 'Drive',  type: 'number', min: 0.1, max: 10, step: 0.01, default: 1 },
      { id: 'bias',   label: 'Bias',   type: 'number', min: -1,  max: 1,  step: 0.01, default: 0 },
      { id: 'output', label: 'Output', type: 'number', min: 0,   max: 2,  step: 0.01, default: 1 },
    ],
  },

  chamberlinZeroCross: {
    id: 'chamberlinZeroCross',
    label: 'Zero-Cross',
    description: 'Sign-mag DAC dead zone + zero-crossing glitch (Chamberlin §12.4)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'deadZone', label: 'Dead Zone', type: 'number', min: 0, max: 0.5, step: 0.0001, default: 0.002 },
      { id: 'glitch',   label: 'Glitch',    type: 'number', min: 0, max: 1,   step: 0.001,  default: 0.05  },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // noiseShaper — higher-order noise-shaping dither. Generalizes #115 from
  // the fixed 2nd-order feedback to an N-tap FIR error-feedback filter with
  // psychoacoustically-weighted coefficients (F / modE / impE per
  // Gerzon/Lipshitz/Vanderkooy/Wannamaker JAES 1991).
  noiseShaper: {
    id: 'noiseShaper',
    label: 'Noise Shaper',
    description: 'Higher-order shaped dither (musicdsp #99 NS9dither16)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'bits',      label: 'Bits',      type: 'number', min: 1, max: 24, step: 1, default: 16 },
      { id: 'order',     label: 'Order',     type: 'number', min: 2, max: 9,  step: 1, default: 9  },
      { id: 'weighting', label: 'Weighting', type: 'number', min: 0, max: 3,  step: 1, default: 1  },
      { id: 'seed',      label: 'Seed',      type: 'number', min: 1, max: 2147483647, step: 1, default: 1 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // dither — TPDF dither + optional 2nd-order noise shaping. Paul Kellett
  // 2002 (musicdsp #61). Requantizes float audio to `bits` resolution,
  // keeping the output float; used for simulating bit-depth reduction
  // with psychoacoustically correct noise-floor (non-correlated with signal).
  dither: {
    id: 'dither',
    label: 'Dither',
    description: 'TPDF dither + 2nd-order noise shaping (Kellett 2002)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'bits',  label: 'Bits',  type: 'number', min: 1, max: 24, step: 1,    default: 16 },
      { id: 'shape', label: 'Shape', type: 'number', min: 0, max: 1,  step: 0.01, default: 0.5 },
      { id: 'seed',  label: 'Seed',  type: 'number', min: 1, max: 2147483647, step: 1, default: 1 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // scatteringJunction — bare 2-port scattering primitive (JOS PASP §7).
  // Memoryless. Building block for user-composed waveguide topologies
  // (branched tubes, T-junctions, asymmetric horns) that the uniform
  // N-section kellyLochbaum lattice cannot express.
  //   Δ = k·(f⁺_in − f⁻_in); f⁺_out = f⁺_in + Δ; f⁻_out = f⁻_in + Δ
  scatteringJunction: {
    id: 'scatteringJunction',
    label: 'Scattering Junction',
    description: 'Bare 2-port scattering junction — one-multiply Kelly-Lochbaum form',
    ports: {
      inputs:  [
        { id: 'fInPlus',  kind: 'audio' },
        { id: 'fInMinus', kind: 'audio' },
      ],
      outputs: [
        { id: 'fOutPlus',  kind: 'audio' },
        { id: 'fOutMinus', kind: 'audio' },
      ],
    },
    params: [
      { id: 'k', label: 'k', type: 'number', min: -0.99, max: 0.99, step: 0.01, default: 0 },
    ],
  },

  // ───────────────────────────────────────────────────────────────────────
  // fdnCore — 8-channel Feedback Delay Network reverb core
  // (Geraint Luff "Let's Write A Reverb" / reverb_engine_architecture.md).
  //
  // 8 exponentially-spaced delay lines (100…200ms), Householder orthogonal
  // feedback (x -= 0.25·Σx — less mixing than Hadamard so channels stay
  // distinct), per-channel 1.5kHz HF shelf for frequency-dependent decay.
  // decay=1 freezes the tail. THE reverb-family workhorse; every full
  // reverb in the catalog wraps this.
  fdnCore: {
    id: 'fdnCore',
    label: 'FDN Core',
    description: 'Geraint Luff FDN reverb core — 8ch Householder, HF-shelf damping, freeze',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'decay', label: 'Decay', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
      { id: 'hf',    label: 'HF',    type: 'number', min: 0, max: 1, step: 0.01, default: 0.7 },
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

  mix: {
    id: 'mix',
    label: 'mix',
    description: 'Equal-power dry/wet crossfade — out = cos(amount·π/2)·dry + sin(amount·π/2)·wet. Honors memory/dry_wet_mix_rule.md (NON-NEGOTIABLE): mix happens inside the same DSP unit, same-sample, no external parallel dry legs. First multi-input op in the catalog — proves N-port input dispatch end-to-end.',
    ports: {
      inputs: [
        { id: 'dry', kind: 'audio' },
        { id: 'wet', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'amount', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.001, default: 0.5, unit: '' },
    ],
  },

  biquad: {
    id: 'biquad',
    label: 'biquad',
    description: 'RBJ Audio EQ Cookbook biquad — LP/HP/BP/notch/peak/lowShelf/highShelf, Direct Form II Transposed (JOS-recommended for low-Q stability under coefficient modulation)',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'lp',
        options: [
          { value: 'lp',        label: 'low-pass'   },
          { value: 'hp',        label: 'high-pass'  },
          { value: 'bp',        label: 'band-pass'  },
          { value: 'notch',     label: 'notch'      },
          { value: 'peak',      label: 'peak'       },
          { value: 'lowShelf',  label: 'low shelf'  },
          { value: 'highShelf', label: 'high shelf' },
        ] },
      { id: 'cutoff', label: 'Cutoff', type: 'number', min: 20, max: 20000, default: 1000, unit: 'Hz', format: fmtHz },
      { id: 'q',      label: 'Q',      type: 'number', min: 0.1, max: 24, step: 0.01, default: 0.707, unit: '' },
      { id: 'gainDb', label: 'Gain',   type: 'number', min: -24, max: 24, step: 0.01, default: 0, unit: 'dB' },
    ],
  },

  drive: {
    id: 'drive',
    label: 'drive',
    description: 'Soft saturator — y = tanh(k·x) / tanh(k) where k = drive. Memoryless, amplitude-normalized so |peak in| ≈ |peak out| across the drive range.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'drive', label: 'Drive', type: 'number', min: 0.1, max: 20, step: 0.001, default: 1, unit: '' },
    ],
  },

  ladder: {
    id: 'ladder',
    label: 'ladder',
    description: '4-pole Moog ladder LP (Stinchcombe-direct, v3) — TPT trap. one-pole per stage, 5 tanh saturators, 2× polyphase OS.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'cutoff',    label: 'Cutoff',    type: 'number', min: 20,  max: 20000, default: 1000, unit: 'Hz', format: fmtHz },
      { id: 'resonance', label: 'Resonance', type: 'number', min: 0,   max: 1.2,   step: 0.001, default: 0,   unit: '' },
      { id: 'drive',     label: 'Drive',     type: 'number', min: 0.1, max: 8,     step: 0.01,  default: 1,   unit: '×' },
      { id: 'trim',      label: 'Trim',      type: 'number', min: -24, max: 12,    step: 0.1,   default: 0,   unit: 'dB', format: fmtDb },
    ],
  },

  adsr: {
    id: 'adsr',
    label: 'adsr',
    description: 'ADSR envelope — linear attack + exp decay/release (musicdsp #189, Schoenebeck 2005)',
    ports: {
      inputs:  [{ id: 'gate', kind: 'audio' }],
      outputs: [{ id: 'out',  kind: 'audio' }],
    },
    params: [
      { id: 'attackMs',  label: 'Attack',  type: 'number', min: 0.1, max: 2000,  step: 0.1, default: 5,   unit: 'ms' },
      { id: 'decayMs',   label: 'Decay',   type: 'number', min: 0.1, max: 5000,  step: 0.1, default: 50,  unit: 'ms' },
      { id: 'sustain',   label: 'Sustain', type: 'number', min: 0,   max: 1,     step: 0.001, default: 0.7, unit: '' },
      { id: 'releaseMs', label: 'Release', type: 'number', min: 0.1, max: 10000, step: 0.1, default: 200, unit: 'ms' },
    ],
  },

  fft: {
    id: 'fft',
    label: 'fft',
    description: 'Real-input FFT — iterative radix-2 Cooley-Tukey (Wikipedia / Cormen Ch. 30); block transform with held spectrum output',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
    },
    params: [
      { id: 'size', label: 'Size', type: 'number', min: 16, max: 32768, step: 1, default: 1024, unit: '' },
    ],
  },

  stft: {
    id: 'stft',
    label: 'stft',
    description: 'Short-Time Fourier Transform — Hann-windowed sliding FFT (JOS SASP definition); hop-driven spectrum output',
    ports: {
      inputs: [{ id: 'in', kind: 'audio' }],
      outputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
    },
    params: [
      { id: 'size', label: 'Size', type: 'number', min: 16, max: 32768, step: 1, default: 1024, unit: '' },
      { id: 'hop',  label: 'Hop',  type: 'number', min: 1,  max: 32768, step: 1, default: 256,  unit: '' },
    ],
  },

  ifft: {
    id: 'ifft',
    label: 'ifft',
    description: 'Inverse FFT — Cooley-Tukey iterative radix-2 with conjugated twiddle + 1/N scale; real-output time-domain stream',
    ports: {
      inputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'size', label: 'Size', type: 'number', min: 16, max: 32768, step: 1, default: 1024, unit: '' },
    ],
  },

  mfcc: {
    id: 'mfcc',
    label: 'mfcc',
    description: 'Mel-Frequency Cepstral Coefficients — power-spec → mel-filterbank → log → DCT-II (python_speech_features / Wikipedia MFCC)',
    ports: {
      inputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'size',       label: 'Size',       type: 'number', min: 16, max: 32768, step: 1, default: 1024, unit: '' },
      { id: 'numFilters', label: 'Filters',    type: 'number', min: 1,  max: 128,   step: 1, default: 26,   unit: '' },
      { id: 'numCoefs',   label: 'Coefs',      type: 'number', min: 1,  max: 128,   step: 1, default: 13,   unit: '' },
      { id: 'lowFreq',    label: 'Low',        type: 'number', min: 0,  max: 24000, step: 1, default: 0,    unit: 'Hz' },
      { id: 'highFreq',   label: 'High',       type: 'number', min: 0,  max: 24000, step: 1, default: 0,    unit: 'Hz' },
    ],
  },

  chromagram: {
    id: 'chromagram',
    label: 'Chromagram',
    description: '12-pitch-class chroma feature from complex spectrum (librosa chroma_stft / Ellis 2007).',
    ports: {
      inputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'size',     label: 'Size',     type: 'number', min: 16,   max: 32768, step: 1,    default: 1024, unit: '' },
      { id: 'nChroma',  label: 'Classes',  type: 'number', min: 3,    max: 64,    step: 1,    default: 12,   unit: '' },
      { id: 'tuning',   label: 'Tuning',   type: 'number', min: -0.5, max: 0.5,   step: 0.01, default: 0,    unit: 'bins' },
      { id: 'ctroct',   label: 'CtrOct',   type: 'number', min: 1,    max: 10,    step: 0.1,  default: 5.0,  unit: 'oct' },
      { id: 'octwidth', label: 'OctWidth', type: 'number', min: 0,    max: 10,    step: 0.1,  default: 2.0,  unit: 'oct' },
      { id: 'baseC',    label: 'BaseC',    type: 'number', min: 0,    max: 1,     step: 1,    default: 1,    unit: '' },
    ],
  },

  lrXover: {
    id: 'lrXover',
    label: 'LR Xover',
    description: '4th-order Linkwitz-Riley crossover — cascaded Butterworth (Q=1/√2), −6 dB at Fp, LP+HP magnitude-flat (Linkwitz; RBJ Cookbook biquads).',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [
        { id: 'low',  kind: 'audio' },
        { id: 'high', kind: 'audio' },
      ],
    },
    params: [
      { id: 'f0', label: 'Fp', type: 'number', min: 20, max: 20000, step: 1, default: 1000, unit: 'Hz' },
    ],
  },

  diffuser: {
    id: 'diffuser',
    label: 'Diffuser',
    description: 'Schroeder allpass diffuser — 4-section DF-II cascade with mutually-prime delays (JOS PASP "Allpass as Two-Comb Cascade" + Schroeder 1962). Flattens transients into a dense wash; flat magnitude (true allpass), only phase reshaped.',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'g',    label: 'Coef', type: 'number', min: -0.99, max: 0.99, step: 0.01, default: 0.7, unit: '' },
      { id: 'size', label: 'Size', type: 'number', min: 0.5,   max: 2.0,  step: 0.01, default: 1.0, unit: '' },
    ],
  },

  crossfade: {
    id: 'crossfade',
    label: 'Crossfade',
    description: 'Equal-power A↔B crossfader — cos/sin constant-energy law (Blumlein 1933; Bauer 1961). Same DSP as op mix, A/B routing vocabulary.',
    ports: {
      inputs: [
        { id: 'a', kind: 'audio' },
        { id: 'b', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'position', label: 'A↔B', type: 'number', min: 0, max: 1, step: 0.001, default: 0.5, unit: '' },
    ],
  },

  select: {
    id: 'select',
    label: 'Select',
    description: '1-of-4 hard switch — out = in_k where k = clamp(floor(index),0,3). Hard-edge (zipper at index change); crossfading is #25 crossfade.',
    ports: {
      inputs: [
        { id: 'in0', kind: 'audio' },
        { id: 'in1', kind: 'audio' },
        { id: 'in2', kind: 'audio' },
        { id: 'in3', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'index', label: 'Index', type: 'number', min: 0, max: 3, step: 1, default: 0, unit: '' },
    ],
  },

  busSum: {
    id: 'busSum',
    label: 'Bus Sum',
    description: '4-input unity-gain summing bus — explicit graph convergence node. Dual of fanOut (1→4 splitter). out = in0+in1+in2+in3; missing ports contribute 0.',
    ports: {
      inputs: [
        { id: 'in0', kind: 'audio' },
        { id: 'in1', kind: 'audio' },
        { id: 'in2', kind: 'audio' },
        { id: 'in3', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [],
  },

  msEncode: {
    id: 'msEncode',
    label: 'M/S Encode',
    description: 'Left/Right → Mid/Side sum-and-difference matrix: M=(L+R)/2, S=(L−R)/2 (Blumlein 1933). Inverse of op #23 msDecode.',
    ports: {
      inputs: [
        { id: 'left',  kind: 'audio' },
        { id: 'right', kind: 'audio' },
      ],
      outputs: [
        { id: 'mid',  kind: 'audio' },
        { id: 'side', kind: 'audio' },
      ],
    },
    params: [],
  },

  msDecode: {
    id: 'msDecode',
    label: 'M/S Decode',
    description: 'Mid/Side → Left/Right sum-and-difference matrix: L=M+S, R=M−S (Blumlein 1933). Inverse of op #22 msEncode.',
    ports: {
      inputs: [
        { id: 'mid',  kind: 'audio' },
        { id: 'side', kind: 'audio' },
      ],
      outputs: [
        { id: 'left',  kind: 'audio' },
        { id: 'right', kind: 'audio' },
      ],
    },
    params: [],
  },

  tilt: {
    id: 'tilt',
    label: 'Tilt',
    description: 'Tilt EQ — single knob tilts spectrum around pivot frequency (Elysia mPressor "Niveau" filter, musicdsp #267).',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'f0',      label: 'Pivot',   type: 'number', min: 20,  max: 20000, step: 1,    default: 630, unit: 'Hz' },
      { id: 'gain',    label: 'Tilt',    type: 'number', min: -24, max: 24,    step: 0.1,  default: 0,   unit: 'dB' },
      { id: 'gfactor', label: 'GFactor', type: 'number', min: 0.1, max: 20,    step: 0.1,  default: 5,   unit: '' },
    ],
  },

  comb: {
    id: 'comb',
    label: 'Comb',
    description: 'Classic comb filter — feedforward `y=x+g·x[n−M]` OR feedback `y=x+g·y[n−M]` (JOS PASP). Building block for Schroeder reverbs, flangers, Karplus-Strong.',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'mode',       label: 'Mode',       type: 'number', min: 0,    max: 1,     step: 1,    default: 1,   unit: '' },
      { id: 'delayMs',    label: 'Delay',      type: 'number', min: 0.02, max: 10000, step: 0.01, default: 10,  unit: 'ms' },
      { id: 'g',          label: 'Gain',       type: 'number', min: -2,   max: 2,     step: 0.01, default: 0.7, unit: '' },
      { id: 'maxDelayMs', label: 'MaxDelay',   type: 'number', min: 1,    max: 10000, step: 1,    default: 500, unit: 'ms' },
    ],
  },

  formant: {
    id: 'formant',
    label: 'Formant',
    description: 'Vowel-formant filter (A/E/I/O/U morph) — musicdsp #110 alex@smartelectronix, 10th-order all-pole IIR.',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'vowel', label: 'Vowel', type: 'number', min: 0, max: 4, step: 0.01, default: 0, unit: '' },
    ],
  },

  bpm: {
    id: 'bpm',
    label: 'BPM',
    description: 'Energy-based beat detector — Frédéric Patin Simple Sound Energy Algorithm #3 (variance-driven adaptive threshold C = -0.0025714·V + 1.5142857).',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [
        { id: 'energy', kind: 'audio' },
        { id: 'beat',   kind: 'audio' },
      ],
    },
    params: [
      { id: 'windowN',   label: 'WindowN',   type: 'number', min: 32, max: 16384, step: 1, default: 1024, unit: 'smp' },
      { id: 'histDepth', label: 'HistDepth', type: 'number', min: 2,  max: 512,   step: 1, default: 43,   unit: 'fr'  },
    ],
  },

  onset: {
    id: 'onset',
    label: 'Onset',
    description: 'Spectral-flux onset detection — librosa onset_strength + peak_pick (Böck-Widmer 2013, Böck-Krebs-Schedl 2012). Causal/streaming.',
    ports: {
      inputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
      outputs: [
        { id: 'strength', kind: 'audio' },
        { id: 'onset',    kind: 'audio' },
      ],
    },
    params: [
      { id: 'size',    label: 'Size',    type: 'number', min: 16, max: 32768, step: 1,    default: 1024, unit: '' },
      { id: 'lag',     label: 'Lag',     type: 'number', min: 1,  max: 128,   step: 1,    default: 1,    unit: 'fr' },
      { id: 'maxSize', label: 'MaxSize', type: 'number', min: 1,  max: 99,    step: 2,    default: 1,    unit: 'bins' },
      { id: 'preMax',  label: 'PreMax',  type: 'number', min: 0,  max: 255,   step: 1,    default: 3,    unit: 'fr' },
      { id: 'preAvg',  label: 'PreAvg',  type: 'number', min: 0,  max: 255,   step: 1,    default: 10,   unit: 'fr' },
      { id: 'delta',   label: 'Delta',   type: 'number', min: 0,  max: 10,    step: 0.01, default: 0.07, unit: '' },
      { id: 'wait',    label: 'Wait',    type: 'number', min: 0,  max: 255,   step: 1,    default: 3,    unit: 'fr' },
    ],
  },

  phaseVocoder: {
    id: 'phaseVocoder',
    label: 'phaseVocoder',
    description: 'Phase-vocoder bin-shift pitch shifter — Bernsee smbPitchShift (WOL). Composes between stft and istft.',
    ports: {
      inputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
      outputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
    },
    params: [
      { id: 'size',       label: 'Size',  type: 'number', min: 16,   max: 32768, step: 1,    default: 1024, unit: '' },
      { id: 'pitchShift', label: 'Pitch', type: 'number', min: 0.25, max: 4.0,   step: 0.01, default: 1.0,  unit: '×' },
    ],
  },

  convolution: {
    id: 'convolution',
    label: 'convolution',
    description: 'Direct-form FIR convolution — IR captured from `ir` input over first `length` samples, then frozen (JOS MDFT §Convolution)',
    ports: {
      inputs: [
        { id: 'in', kind: 'audio' },
        { id: 'ir', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'length', label: 'Length', type: 'number', min: 1, max: 4096, step: 1, default: 128, unit: 'samp' },
    ],
  },

  istft: {
    id: 'istft',
    label: 'istft',
    description: 'Inverse STFT — Hann-windowed OLA resynthesis (JOS SASP "Overlap-Add STFT Processing"); companion to stft',
    ports: {
      inputs: [
        { id: 'real', kind: 'audio' },
        { id: 'imag', kind: 'audio' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'size', label: 'Size', type: 'number', min: 16, max: 32768, step: 1, default: 1024, unit: '' },
      { id: 'hop',  label: 'Hop',  type: 'number', min: 1,  max: 32768, step: 1, default: 256,  unit: '' },
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

  pitchShift: {
    id: 'pitchShift',
    label: 'pitch shift',
    description: 'streaming phase-vocoder pitch shifter (Bernsee smbPitchShift — FFT 2048, osamp 4, Hann + OLA)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'pitch', label: 'Pitch', type: 'number', min: 0.25, max: 4.0, step: 0.001, default: 1.0, unit: '×', format: (v) => `${v.toFixed(3)}×` },
      { id: 'mix',   label: 'Mix',   type: 'number', min: 0,    max: 1,   step: 0.01,  default: 1.0, unit: '',  format: fmtPct },
    ],
  },

  ER: {
    id: 'ER',
    label: 'early reflections',
    description: 'tapped-delay-line early reflections (JOS PASP) — 12 integer-delay taps over 5–80 ms with post-sum air-absorption LPF',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'roomSize', label: 'Size',  type: 'number', min: 0.25, max: 2.0,   step: 0.01, default: 1.0,  unit: '',   format: fmtPct },
      { id: 'airHz',    label: 'Air',   type: 'number', min: 500,  max: 18000, step: 1,    default: 8000, unit: 'Hz', format: fmtHz },
      { id: 'level',    label: 'Level', type: 'number', min: 0,    max: 2.0,   step: 0.01, default: 1.0,  unit: '',   format: fmtPct },
      { id: 'mix',      label: 'Mix',   type: 'number', min: 0,    max: 1,     step: 0.01, default: 1.0,  unit: '',   format: fmtPct },
    ],
  },

  bbdDelay: {
    id: 'bbdDelay',
    label: 'bbd delay',
    description: 'bucket-brigade device delay (Juno-60/Memory Man character) — pre-LPF → BBD FIFO → post-LPF + feedback',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'delayMs',  label: 'Time',     type: 'number', min: 1,   max: 1000,  step: 1,    default: 250,  unit: 'ms', format: fmtMs },
      { id: 'aaHz',     label: 'Tone',     type: 'number', min: 500, max: 15000, step: 1,    default: 6000, unit: 'Hz', format: fmtHz },
      { id: 'feedback', label: 'Repeats',  type: 'number', min: -0.95, max: 0.95, step: 0.01, default: 0.35, unit: '',  format: fmtPct },
      { id: 'mix',      label: 'Mix',      type: 'number', min: 0,   max: 1,     step: 0.01, default: 0.5,  unit: '',   format: fmtPct },
    ],
  },

  transient: {
    id: 'transient',
    label: 'transient',
    description: 'transient shaper — differential Bram §1 envelope followers (fast vs slow attack). attackAmount ∈ [-1,+1] enhances/softens attack; sustainAmount ∈ [-1,+1] extends/dries sustain. SPL-style architecture, math-by-definition.',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'attackAmount',  label: 'Attack',  type: 'number', min: -1,  max: 1,   step: 0.01, default: 0,   unit: '',   format: (v) => `${(v*100).toFixed(0)}%` },
      { id: 'sustainAmount', label: 'Sustain', type: 'number', min: -1,  max: 1,   step: 0.01, default: 0,   unit: '',   format: (v) => `${(v*100).toFixed(0)}%` },
      { id: 'fastMs',        label: 'Fast',    type: 'number', min: 0.1, max: 20,  step: 0.1,  default: 1,   unit: 'ms', format: fmtMs },
      { id: 'slowMs',        label: 'Slow',    type: 'number', min: 1,   max: 200, step: 1,    default: 30,  unit: 'ms', format: fmtMs },
      { id: 'releaseMs',     label: 'Release', type: 'number', min: 1,   max: 2000,step: 1,    default: 300, unit: 'ms', format: fmtMs },
      { id: 'mix',           label: 'Mix',     type: 'number', min: 0,   max: 1,   step: 0.01, default: 1,   unit: '',   format: fmtPct },
    ],
  },

  lookahead: {
    id: 'lookahead',
    label: 'lookahead',
    description: 'pure primitive — delays audio by L samples and emits a parallel `peak` stream holding the windowed abs-max over [n−L,n]. Feeds gainComputer for zero-overshoot limiters/gates. Monotonic-deque O(1) windowed-max (Lemire 2006 structural ref).',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }, { id: 'peak', kind: 'control' }],
    },
    params: [
      { id: 'lookaheadMs', label: 'Ahead', type: 'number', min: 0, max: 50, step: 0.1, default: 5, unit: 'ms', format: fmtMs },
    ],
  },

  meters: {
    id: 'meters',
    label: 'meters',
    description: 'dual-ballistic meter — peak-hold envelope (IEC 60268-10 / op_peak) + windowed RMS (one-pole / op_rms) emitted in parallel. Standard preset enum (vu/ppm/digital/custom) loads canonical ballistics.',
    ports: {
      inputs:  [{ id: 'in',   kind: 'audio' }],
      outputs: [{ id: 'peak', kind: 'control' }, { id: 'rms', kind: 'control' }],
    },
    params: [
      { id: 'standard',      label: 'Std',   type: 'enum',   options: [{ value: 'vu', label: 'VU' }, { value: 'ppm', label: 'PPM' }, { value: 'digital', label: 'Digital' }, { value: 'custom', label: 'Custom' }], default: 'vu' },
      { id: 'peakReleaseMs', label: 'Peak',  type: 'number', min: 1, max: 30000, step: 1, default: 1700, unit: 'ms', format: fmtMs },
      { id: 'rmsWindowMs',   label: 'RMS',   type: 'number', min: 1, max: 30000, step: 1, default: 300,  unit: 'ms', format: fmtMs },
    ],
  },

  oversample2x: {
    id: 'oversample2x',
    label: '2× OS',
    description: '2× polyphase IIR halfband oversampler roundtrip — Laurent de Soras hiir (WTFPL): StageProcFpu.hpp L60-L80 + Upsampler2x/Downsampler2x. Designer ported from PolyphaseIir2Designer.h (atten+TBW → coef array). Shared primitive for downstream character ops.',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'attenuationDb', label: 'Atten',    type: 'number', min: 20,    max: 200,  step: 1,     default: 100,  unit: 'dB', format: (v) => `${v|0}` },
      { id: 'transitionBw',  label: 'Trans BW', type: 'number', min: 0.001, max: 0.45, step: 0.001, default: 0.01, unit: 'fs', format: (v) => v.toFixed(3) },
    ],
  },

  sidechainHPF: {
    id: 'sidechainHPF',
    label: 'sc HPF',
    description: 'sidechain high-pass filter — RBJ HPF biquad (Audio EQ Cookbook L116-L123). Fixed-mode, optional 2-stage cascade (24 dB/oct). Pre-filter for gate/compressor/expander detector feeds so bass rumble does not chatter the envelope.',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'cutoff', label: 'Cutoff', type: 'number', min: 20,    max: 2000, step: 1,    default: 100,   unit: 'Hz', format: fmtHz },
      { id: 'q',      label: 'Q',      type: 'number', min: 0.1,   max: 10,   step: 0.01, default: 0.707, unit: '',   format: (v) => v.toFixed(2) },
      { id: 'order',  label: 'Order',  type: 'number', min: 1,     max: 2,    step: 1,    default: 1,     unit: '',   format: (v) => `${v}×` },
    ],
  },

  expander: {
    id: 'expander',
    label: 'expander',
    description: 'downward expander — Bram envelope detector (Canon:dynamics §1) + math-by-definition dB static curve (Zölzer §4.2.2 compressor law mirrored). Optional sidechain. Ratio=1 bypass, ratio=100≈gate.',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }, { id: 'sidechain', kind: 'audio', optional: true }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'thresholdDb', label: 'Thresh',  type: 'number', min: -80,  max: 0,    step: 0.1,   default: -40, unit: 'dB', format: (v) => `${v.toFixed(1)} dB` },
      { id: 'ratio',       label: 'Ratio',   type: 'number', min: 1,    max: 100,  step: 0.1,   default: 2,   unit: ':1', format: (v) => `${v.toFixed(1)}:1` },
      { id: 'kneeDb',      label: 'Knee',    type: 'number', min: 0,    max: 24,   step: 0.1,   default: 6,   unit: 'dB', format: (v) => `${v.toFixed(1)} dB` },
      { id: 'attackMs',    label: 'Attack',  type: 'number', min: 0.01, max: 200,  step: 0.1,   default: 1,   unit: 'ms', format: fmtMs },
      { id: 'releaseMs',   label: 'Release', type: 'number', min: 0.01, max: 2000, step: 1,     default: 100, unit: 'ms', format: fmtMs },
      { id: 'floor',       label: 'Floor',   type: 'number', min: 0,    max: 1,    step: 0.01,  default: 0,   unit: '',   format: fmtPct },
      { id: 'mix',         label: 'Mix',     type: 'number', min: 0,    max: 1,    step: 0.01,  default: 1,   unit: '',   format: fmtPct },
    ],
  },

  gate: {
    id: 'gate',
    label: 'gate',
    description: 'noise gate — Bram envelope detector (musicdsp #97) + Schmitt-hysteresis A/H/R state machine. Optional sidechain input.',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }, { id: 'sidechain', kind: 'audio', optional: true }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'threshold', label: 'Thresh',  type: 'number', min: 0,    max: 1,    step: 0.001, default: 0.1,  unit: '',   format: fmtPct },
      { id: 'attackMs',  label: 'Attack',  type: 'number', min: 0.01, max: 200,  step: 0.1,   default: 1,    unit: 'ms', format: fmtMs },
      { id: 'holdMs',    label: 'Hold',    type: 'number', min: 0,    max: 500,  step: 1,     default: 20,   unit: 'ms', format: fmtMs },
      { id: 'releaseMs', label: 'Release', type: 'number', min: 0.01, max: 2000, step: 1,     default: 100,  unit: 'ms', format: fmtMs },
      { id: 'floor',     label: 'Floor',   type: 'number', min: 0,    max: 1,    step: 0.01,  default: 0,    unit: '',   format: fmtPct },
      { id: 'mix',       label: 'Mix',     type: 'number', min: 0,    max: 1,    step: 0.01,  default: 1,    unit: '',   format: fmtPct },
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

  // Catalog #89. Absolute value |x|. Partner of `sign`: together they
  // split a signal into (magnitude, polarity) so one-sided transfers
  // like |x|^γ or magnitude-domain saturation preserve odd-symmetry.
  // Also the canonical full-wave rectifier feeding user-built detectors.
  // NaN is preserved (unlike `sign` which collapses NaN→0) — abs is a
  // pure magnitude op; gate/clamp downstream if needed. Stateless.
  // Catalog #30. Named, switchable polarity flip. Prefer over
  // scaleBy(-1): polarity is a bool (UI reads as a button not a knob),
  // semantically clear in graph inspection, and documented as
  // gain-lossless (sign-bit flip only). Canonical for null-tests
  // (x + polarity(x) = 0), drum phase correction, M/S decode fix-ups.
  // Catalog #31. Constant value source. Zero inputs, one control
  // output at user-set value. Jumps instantly on setParam (wrap with
  // `smooth` for click-free parameter ramps). Canonical uses: DC
  // bias, mod-port defaults, stub-outs for unwired control inputs.
  // Catalog #92. Explicit 1→4 signal splitter. The graph already
  // supports multi-connection, but fanOut is a visible, named
  // distribution node for graph readability and instrumentation
  // (leave 3 branches for probes while production uses 1). Unity
  // gain on all four outputs; v2 may add per-branch trim.
  // Catalog #93. One-sample delay z^-1. Atomic feedback primitive:
  // the minimum-latency cycle-breaker for graph-level feedback loops.
  // Chainable (N × z1 = N-sample delay). Float64 state register for
  // precision inside tight FB topologies. Latency reported = 1.
  // Classic usage: hand-rolled one-pole LP, differentiator
  // (x - z1(x)), custom comb/allpass loops, cycle-break markers.
  // Catalog #94. Unipolar ↔ bipolar range remap. Modulation-router
  // primitive: LFOs are bipolar (−1..+1), envelopes/triggers are
  // unipolar (0..1), and connecting them without remap produces
  // garbage (negative depth during LFO negative half-cycle, etc.).
  // Every commercial modulation matrix has this toggle; uniBi is
  // the sandbox's exposed primitive. Linear (no clamp) — follow
  // with `clamp` if bounding is needed. Matches
  // sandbox_modulation_roadmap.md signal-range convention.
  uniBi: {
    id: 'uniBi',
    label: 'uni/bi',
    description: 'unipolar ↔ bipolar remap (mod router primitive)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'control' }],
      outputs: [{ id: 'out', kind: 'control' }],
    },
    params: [
      { id: 'mode', label: 'Mode', type: 'enum', default: 'uniToBi', options: [
        { value: 'uniToBi', label: 'uni→bi' },
        { value: 'biToUni', label: 'bi→uni' },
      ]},
    ],
  },

  z1: {
    id: 'z1',
    label: 'z⁻¹',
    description: 'one-sample delay — atomic feedback primitive',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [],
  },

  fanOut: {
    id: 'fanOut',
    label: 'fanOut',
    description: '1→4 unity-gain splitter — explicit graph distribution node',
    ports: {
      inputs:  [{ id: 'in', kind: 'audio' }],
      outputs: [
        { id: 'out0', kind: 'audio' },
        { id: 'out1', kind: 'audio' },
        { id: 'out2', kind: 'audio' },
        { id: 'out3', kind: 'audio' },
      ],
    },
    params: [],
  },

  constant: {
    id: 'constant',
    label: 'const',
    description: 'emit fixed value on every sample (control source)',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'control' }],
    },
    params: [
      { id: 'value', label: 'Value', type: 'number', min: -1e6, max: 1e6, step: 0.0001, default: 0, unit: '', format: (v) => v.toFixed(4) },
    ],
  },

  polarity: {
    id: 'polarity',
    label: 'polarity',
    description: 'switchable polarity flip — bool, gain-lossless',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'invert', label: 'Invert', type: 'bool', default: false },
    ],
  },

  abs: {
    id: 'abs',
    label: 'abs',
    description: '|x| — full-wave rectifier / magnitude extractor',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [],
  },

  // Catalog #57. M/S energy-ratio width meter — companion to
  // `correlation` (#56). correlation answers "are L and R the same
  // waveform?" (coherence); stereoWidth answers "how much side energy
  // vs mid energy?" (spatial spread). Output is the side-energy
  // FRACTION of total stereo energy, bounded [0,1]:
  //   L=R (mono)     → 0
  //   L=−R (side)    → 1
  //   decorrelated   → 0.5
  //   L-only / pan   → 0.5
  //   silence        → 0.5 (neutral, not NaN)
  // One-pole τ smoothing on E[M²] and E[S²]; default 300 ms matches
  // IEC/EBU broadcast ballistic.
  // Catalog #55. EBU Tech 3342 Loudness Range (LRA). Completes the
  // BS.1770 mastering meter stack: kWeighting → lufsIntegrator (M/S),
  // loudnessGate (I), truePeak (TP), lra (LRA). Input is expected to
  // be K-weighted audio. Output is LRA in LU (a range, not an absolute
  // LUFS). 3 s ST blocks on 100 ms hop; abs gate -70 LUFS, rel gate
  // -20 LU (NOT -10 LU like the integrated-loudness gate — easy
  // misread). Percentile method: nearest rank (Annex A pseudocode).
  lra: {
    id: 'lra',
    label: 'lra',
    description: 'EBU Tech 3342 loudness range (L95 − L10 of gated short-term pool)',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'lra', kind: 'control' }],
    },
    params: [
      { id: 'channelWeight', label: 'ChW', type: 'number', min: 0, max: 2, step: 0.01, default: 1.0, unit: '', format: (v) => v.toFixed(2) },
    ],
  },

  stereoWidth: {
    id: 'stereoWidth',
    label: 'stereoW',
    description: 'M/S energy-ratio width meter (0=mono, 1=side, 0.5=decorrelated)',
    ports: {
      inputs:  [
        { id: 'l',     kind: 'audio' },
        { id: 'r',     kind: 'audio' },
      ],
      outputs: [{ id: 'width', kind: 'control' }],
    },
    params: [
      { id: 'timeMs', label: 'Time', type: 'number', min: 1, max: 10000, step: 1, default: 300, unit: 'ms', format: fmtMs },
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

  blit: {
    id: 'blit',
    label: 'blit',
    description: 'band-limited impulse train — Stilson & Smith ICMC 1996 closed-form DSF, normalized per STK Blit.h (Davies/Scavone 2005). Peak=1, period=sr/freq, harmonics auto-clipped to Nyquist. Optional freqMod control for linear FM.',
    ports: {
      inputs:  [{ id: 'freqMod', kind: 'control' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'freq', label: 'Freq', type: 'number', min: 0.01, max: 20000, step: 0.01, default: 440, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'amp',  label: 'Amp',  type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
    ],
  },

  padSynth: {
    id: 'padSynth',
    label: 'padSynth',
    description: 'PADsynth algorithm (Nasca zynaddsubfx) — per-harmonic Gaussian bandwidth profile + random-phase spectral fill → IFFT → looped wavetable playback. Lush ensemble/pad timbres. Bandwidth in cents; shape chooses harmonic amplitude profile (saw/square/organ/bell). Deterministic (seed-driven). Optional freqMod control input.',
    ports: {
      inputs:  [{ id: 'freqMod', kind: 'control' }],
      outputs: [{ id: 'out',     kind: 'audio'   }],
    },
    params: [
      { id: 'freq',      label: 'Freq',      type: 'number', min: 0.01, max: 20000, step: 0.01, default: 220, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'bandwidth', label: 'Bandwidth', type: 'number', min: 0, max: 1200, step: 0.1, default: 40, unit: 'cents',
        format: (v) => `${v.toFixed(1)}¢` },
      { id: 'shape',     label: 'Shape',     type: 'enum', options: [
          { value: 0, label: 'saw' },
          { value: 1, label: 'square' },
          { value: 2, label: 'organ' },
          { value: 3, label: 'bell' },
        ], default: 0 },
      { id: 'seed',      label: 'Seed',      type: 'number', min: 1, max: 1e6, step: 1, default: 1, unit: '',
        format: (v) => String(v | 0) },
      { id: 'amp',       label: 'Amp',       type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
    ],
  },

  wavetable: {
    id: 'wavetable',
    label: 'wavetable',
    description: 'single-cycle wavetable oscillator with linear inter-sample AND inter-table interpolation (SuperCollider Osc UGen form). Built-in 4-table bank: sin/tri/saw/square. Optional freqMod and posMod control inputs. Naive (non-bandlimited) v1.',
    ports: {
      inputs:  [
        { id: 'freqMod', kind: 'control' },
        { id: 'posMod',  kind: 'control' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'freq',     label: 'Freq',     type: 'number', min: 0.01, max: 20000, step: 0.01, default: 440, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'position', label: 'Position', type: 'number', min: 0, max: 3, step: 0.001, default: 0, unit: '',
        format: (v) => v.toFixed(3) },
      { id: 'amp',      label: 'Amp',      type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
    ],
  },

  fm: {
    id: 'fm',
    label: 'fm',
    description: 'two-operator FM synthesis — Chowning 1973 e(t)=A·sin(ω_c·t+I·sin(ω_m·t)). Carrier + ratio-locked modulator + index; Bessel sidebands at f_c±k·f_m. Optional freqMod and idxMod control inputs.',
    ports: {
      inputs:  [
        { id: 'freqMod', kind: 'control' },
        { id: 'idxMod',  kind: 'control' },
      ],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'carrierFreq', label: 'Carrier',   type: 'number', min: 0.01, max: 20000, step: 0.01, default: 440, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'modRatio',    label: 'Ratio',     type: 'number', min: -64, max: 64, step: 0.001, default: 1, unit: '',
        format: (v) => `${v.toFixed(3)}×` },
      { id: 'modIndex',    label: 'Index',     type: 'number', min: 0, max: 100, step: 0.01, default: 1, unit: '',
        format: (v) => v.toFixed(2) },
      { id: 'amp',         label: 'Amp',       type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
    ],
  },

  minBLEP: {
    id: 'minBLEP',
    label: 'minBLEP',
    description: 'minimum-phase band-limited sawtooth — Brandt ICMC 2001 (cepstral min-phase MinBLEP residual, Ω=32, Nz=8). Zero-latency alias-suppressed saw. Optional freqMod control for linear FM.',
    ports: {
      inputs:  [{ id: 'freqMod', kind: 'control' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'freq', label: 'Freq', type: 'number', min: 0.01, max: 20000, step: 0.01, default: 440, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'amp',  label: 'Amp',  type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
    ],
  },

  sineOsc: {
    id: 'sineOsc',
    label: 'sineOsc',
    description: 'audio-rate sine oscillator — Gordon–Smith two-sample recurrence (McCartney CMJ 2002). Optional freqMod control input for linear FM.',
    ports: {
      inputs:  [{ id: 'freqMod', kind: 'control' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'freq', label: 'Freq', type: 'number', min: 0.01, max: 20000, step: 0.01, default: 440, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'amp',  label: 'Amp',  type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
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

  // Original 1983 Karplus-Strong plucked-string synthesizer. Noise-
  // filled delay line (N = round(sr/freq)), two-point averaging loop
  // filter H(z) = ½ + ½·z⁻¹ scaled by `decay` for sustain control.
  // `bright` crossfades between pure-avg (classic dulling pluck) and
  // no-filter (harsh/organ-like) modes. Rising-edge trigger refills
  // buffer with fresh noise. See jos_pasp_dsp_reference.md §4.3 and
  // jos_pasp_physical_modeling.md §3.2. Extended KS pick filter,
  // stiffness dispersion, pick-position comb are intentionally NOT
  // included — compose via downstream ops when needed.
  karplusStrong: {
    id: 'karplusStrong',
    label: 'pluck',
    description: 'Karplus-Strong plucked-string synth (1983 original). Rising-edge trigger fills a noise delay line; two-point averaging loop filter with decay and bright blend gives the classic bright→dull pluck envelope. Compose downstream ops for EKS extensions.',
    ports: {
      inputs:  [{ id: 'trig', kind: 'control' }],
      outputs: [{ id: 'out',  kind: 'audio'   }],
    },
    params: [
      { id: 'freq',   label: 'Freq',   type: 'number', min: 20,   max: 20000, step: 0.1,   default: 220,   unit: 'Hz', format: (v) => `${v.toFixed(1)} Hz` },
      { id: 'decay',  label: 'Decay',  type: 'number', min: 0,    max: 1,     step: 0.0001, default: 0.996, unit: '',   format: (v) => v.toFixed(4) },
      { id: 'bright', label: 'Bright', type: 'number', min: 0,    max: 1,     step: 0.001,  default: 0.5,   unit: '',   format: (v) => v.toFixed(3) },
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

  // Linear-rate slew limiter. Sister op to `smooth` — same problem class
  // (rate-limit a control/audio signal) but opposite character. `smooth`
  // is exponential (always decelerating toward target, analog-knob feel);
  // `slew` is linear (full-rate or stopped, sharp corners at transitions,
  // mechanical/capacitor-discharge feel). Use slew when modeling real-
  // world controls with inertia or driver-circuit rate limits (DC servo,
  // tape head, speaker cone), smooth when modeling RC damping.
  // Asymmetric rise/fall mimics envelope followers and capacitor charge-
  // vs-discharge. Zero latency (transients past rate limit are
  // attenuated, not delayed). See op_slew.worklet.js header.
  slew: {
    id: 'slew',
    label: 'slew',
    description: 'linear-rate slew limiter with asymmetric rise/fall. rise/fall expressed as ms per unit of travel. Sharp corners at rate transitions (no exponential tail — contrast with `smooth`). Use for mechanical/capacitive-discharge character and envelope-follower-like control shaping.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      // Time to travel 1 unit UP, in ms. Lower = faster upward slew.
      // Clamped to [0.001, 10000] in the op. Default 10 ms matches analog
      // envelope attack ballistics.
      { id: 'riseMs', label: 'Rise', type: 'number', min: 0.001, max: 10000, step: 0.1, default: 10, unit: 'ms', format: (v) => `${v.toFixed(1)} ms` },
      // Time to travel 1 unit DOWN, in ms. Default 50 ms matches slow
      // capacitor discharge / envelope release.
      { id: 'fallMs', label: 'Fall', type: 'number', min: 0.001, max: 10000, step: 0.1, default: 50, unit: 'ms', format: (v) => `${v.toFixed(1)} ms` },
    ],
  },

  // Triggered one-shot linear ramp generator. Sister to `slew`
  // (reactive rate-limiter) but trigger-gated and finite-time. Pairs
  // with `trigger`/`curve` upstream for classic note-on envelope
  // behaviour. timeMs=0 → instant jump (clean "latch-on-trigger"
  // utility). Before the first trigger, output is held at startVal.
  ramp: {
    id: 'ramp',
    label: 'ramp',
    description: 'triggered one-shot linear ramp. Rising-edge trig → sweeps startVal→endVal linearly over timeMs, then holds at endVal. timeMs=0 = instant jump. Canonical attack-only envelope generator / filter-sweep primitive.',
    ports: {
      inputs:  [{ id: 'trig', kind: 'control' }],
      outputs: [{ id: 'out',  kind: 'control' }],
    },
    params: [
      { id: 'startVal', label: 'Start', type: 'number', min: -10,   max: 10,    step: 0.001, default: 0,   unit: '',   format: (v) => v.toFixed(3) },
      { id: 'endVal',   label: 'End',   type: 'number', min: -10,   max: 10,    step: 0.001, default: 1,   unit: '',   format: (v) => v.toFixed(3) },
      { id: 'timeMs',   label: 'Time',  type: 'number', min: 0,     max: 60000, step: 0.1,   default: 100, unit: 'ms', format: (v) => v === 0 ? 'instant' : `${v.toFixed(1)} ms` },
    ],
  },

  // Snap-to-grid quantiser for control signals. y = offset +
  // f((x − offset)/step)·step with f ∈ {round, floor, ceil}. Distinct
  // from `bitcrush` (fixed 2^bits amplitude quantisation): this op
  // quantises arbitrary-step any-range control signals. Classic uses:
  // stepped LFO, semitone-snap pitch CV, N-position macro.
  quantizer: {
    id: 'quantizer',
    label: 'quantize',
    description: 'snap-to-grid quantiser for control signals. y = offset + f((x−offset)/step)·step. step=0 = bypass. Distinct from bitcrush (audio-amplitude bits); use for stepped LFO, semitone-snap pitch CV, N-position macros.',
    ports: { inputs: [{ id: 'in', kind: 'control' }], outputs: [{ id: 'out', kind: 'control' }] },
    params: [
      { id: 'step',   label: 'Step',   type: 'number', min: 0, max: 10, step: 0.001, default: 0.125, unit: '', format: (v) => v === 0 ? 'bypass' : v.toFixed(4) },
      { id: 'offset', label: 'Offset', type: 'number', min: -10, max: 10, step: 0.001, default: 0, unit: '', format: (v) => v.toFixed(3) },
      { id: 'mode', label: 'Mode', type: 'enum', default: 'round',
        options: [
          { value: 'round', label: 'round'  },
          { value: 'floor', label: 'floor'  },
          { value: 'ceil',  label: 'ceil'   },
        ] },
    ],
  },

  // Constant-time glide (portamento). On each target change the step
  // is recomputed as (newTarget − currentY) / glideSamples so y arrives
  // exactly at target in glideMs regardless of distance. Distinct from
  // `slew` (constant rate; time varies with distance) and `smooth`
  // (exponential; never truly arrives). First-sample snap avoids the
  // from-zero glide trap at plugin load. Mid-glide retarget honours
  // the NEW time-to-target from the current position.
  glide: {
    id: 'glide',
    label: 'glide',
    description: 'constant-time glide / portamento. Each target change triggers a new linear advance that arrives in glideMs regardless of distance (rate recomputed on change). First-sample snap. glideMs=0 = instant. Distinct from slew (constant rate) and smooth (exponential).',
    ports: { inputs: [{ id: 'in', kind: 'control' }], outputs: [{ id: 'out', kind: 'control' }] },
    params: [
      { id: 'glideMs', label: 'Time', type: 'number', min: 0, max: 60000, step: 0.1, default: 100, unit: 'ms', format: (v) => v === 0 ? 'instant' : `${v.toFixed(1)} ms` },
    ],
  },

  // Schmitt trigger + rising-edge pulse. Canon:dynamics §4 (beat
  // detector, musicdsp #200) isolates the pattern: threshold-with-
  // hysteresis gates a control signal, and optional rising-edge
  // detection emits one-sample pulses on arm-up. Gate mode feeds
  // sequencer-style state; pulse mode feeds sample-accurate
  // cue/retrigger primitives. Hysteresis band (threshHi − threshLo)
  // prevents chatter on signals hovering near a single threshold.
  trigger: {
    id: 'trigger',
    label: 'trigger',
    description: 'Schmitt trigger with hysteresis. Gate mode = persistent 1 while armed. Pulse mode = single-sample 1 on arm-up only. threshHi arms, threshLo disarms. Inverted thresholds coerced (lo ≤ hi enforced).',
    ports: { inputs: [{ id: 'in', kind: 'control' }], outputs: [{ id: 'out', kind: 'control' }] },
    params: [
      { id: 'threshHi', label: 'Arm',    type: 'number', min: -10, max: 10, step: 0.001, default: 0.5, unit: '', format: (v) => v.toFixed(3) },
      { id: 'threshLo', label: 'Disarm', type: 'number', min: -10, max: 10, step: 0.001, default: 0.4, unit: '', format: (v) => v.toFixed(3) },
      { id: 'mode', label: 'Mode', type: 'enum', default: 'gate',
        options: [
          { value: 'gate',  label: 'gate (persistent)'     },
          { value: 'pulse', label: 'pulse (edge)'          },
        ] },
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

  // granularBuffer — self-contained live granulator (SC GrainBuf-style
  // active-grain pool over an internal circular write buffer). See
  // op_granularBuffer.worklet.js for the algorithm provenance + design picks.
  granularBuffer: {
    id: 'granularBuffer',
    label: 'Granular',
    description: 'live granulator · 16-grain Hann pool over internal ring buf · SC GrainBuf algorithm',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'bufMs',       label: 'Buf',     type: 'number', min: 10,    max: 2000, step: 1,    default: 1000, unit: 'ms', format: fmtMs },
      { id: 'delayMs',     label: 'Delay',   type: 'number', min: 0,     max: 2000, step: 1,    default: 100,  unit: 'ms', format: fmtMs },
      { id: 'grainMs',     label: 'Grain',   type: 'number', min: 1,     max: 500,  step: 1,    default: 50,   unit: 'ms', format: fmtMs },
      { id: 'density',     label: 'Density', type: 'number', min: 0.1,   max: 200,  step: 0.1,  default: 20,   unit: 'Hz' },
      { id: 'jitterMs',    label: 'Jitter',  type: 'number', min: 0,     max: 1000, step: 1,    default: 0,    unit: 'ms', format: fmtMs },
      { id: 'pitchCents',  label: 'Pitch',   type: 'number', min: -2400, max: 2400, step: 1,    default: 0,    unit: 'ct' },
      { id: 'detuneCents', label: 'Detune',  type: 'number', min: 0,     max: 1200, step: 1,    default: 0,    unit: 'ct' },
      { id: 'level',       label: 'Level',   type: 'number', min: 0,     max: 1,    step: 0.001, default: 1,   unit: '',  format: fmtPct },
    ],
  },

  // microDetune — two-tap crossfading delay-line pitch shifter (Faust
  // `transpose`). Light fixed-cents detune for chorus-class spice.
  microDetune: {
    id: 'microDetune',
    label: 'µDetune',
    description: 'two-tap crossfading delay-line detune · Faust transpose · light pitch shift',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'cents',    label: 'Cents',  type: 'number', min: -1200, max: 1200, step: 1,    default: 0,  unit: 'ct' },
      { id: 'windowMs', label: 'Window', type: 'number', min: 10,    max: 200,  step: 1,    default: 50, unit: 'ms', format: fmtMs },
      { id: 'xfadeMs',  label: 'Xfade',  type: 'number', min: 1,     max: 50,   step: 1,    default: 10, unit: 'ms', format: fmtMs },
      { id: 'level',    label: 'Level',  type: 'number', min: 0,     max: 1,    step: 0.001, default: 1, unit: '',   format: fmtPct },
    ],
  },

  // Chebyshev waveshaper — Canon §4 (musicdsp #230). Memoryless harmonic
  // exciter: weighted sum of T_1..T_5 polynomials lets the author dial
  // each harmonic order independently. T_k(cos θ) = cos(k θ) → exact
  // harmonic isolation on unit-amplitude pure sines (intended use:
  // exciter on already-normalized signal). |x|>1 clamped to bound output.
  chebyshevWS: {
    id: 'chebyshevWS',
    label: 'cheby',
    description: 'Chebyshev T_k harmonic exciter — dial harmonics 1..5 independently. Memoryless (stateless). Best on unit-amplitude pre-normalized signals.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'g1', label: 'H1', type: 'number', min: -2, max: 2, step: 0.001, default: 1, unit: '', format: fmtPct },
      { id: 'g2', label: 'H2', type: 'number', min: -2, max: 2, step: 0.001, default: 0, unit: '', format: fmtPct },
      { id: 'g3', label: 'H3', type: 'number', min: -2, max: 2, step: 0.001, default: 0, unit: '', format: fmtPct },
      { id: 'g4', label: 'H4', type: 'number', min: -2, max: 2, step: 0.001, default: 0, unit: '', format: fmtPct },
      { id: 'g5', label: 'H5', type: 'number', min: -2, max: 2, step: 0.001, default: 0, unit: '', format: fmtPct },
      { id: 'level', label: 'Level', type: 'number', min: 0, max: 4, step: 0.001, default: 1, unit: '', format: fmtPct },
    ],
  },

  // Hard-clip — sign-preserving clamp at ±threshold. Naive form: Canon §5
  // branchless clip (de Soras 2004, musicdsp #81). Optional ADAA per
  // Parker-Esqueda-Bilbao DAFx 2016 §III. Distinct from saturate/softLimit:
  // discontinuous derivative at threshold → brick-wall harmonic content
  // (sine → 4/π · Σ sin(nωt)/n series). Use as FX-rack output stage,
  // fuzz-pedal stage, or composition base.
  hardClip: {
    id: 'hardClip',
    label: 'clip',
    description: 'hard clip — sign-preserving clamp at ±threshold; optional 1st-order ADAA. Discontinuous derivative → brick-wall harmonics (distinct from saturate/softLimit).',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'drive',     label: 'Drive',  type: 'number', min: 1,    max: 16, step: 0.01,  default: 1, unit: '',   format: fmtX },
      { id: 'threshold', label: 'Thresh', type: 'number', min: 1e-6, max: 1,  step: 0.001, default: 1, unit: '',   format: fmtPct },
      { id: 'trim',      label: 'Trim',   type: 'number', min: -24,  max: 12, step: 0.1,   default: 0, unit: 'dB', format: fmtDb },
      { id: 'adaa',      label: 'ADAA',   type: 'bool',   default: false },
    ],
  },

  // Diode-pair clipper — Tube Screamer / Rat / Big Muff / Klon foundation.
  // Closed-form arcsinh(drive·x)/arcsinh(drive), derived from Shockley
  // diode equation (Sedra-Smith §3.2) + Yeh DAFx 2008 op-amp feedback
  // analysis. Distinct primitive from saturate (Padé tanh) and softLimit
  // (threshold-Padé): log-asymptotic past the knee, NOT bounded-asymptotic.
  // `asym` reduces drive on negative side — Tube Screamer / Big Muff
  // signature when asym > 0. See op_diodeClipper.worklet.js header.
  diodeClipper: {
    id: 'diodeClipper',
    label: 'diode',
    description: 'diode-pair clipper — Shockley closed-form arcsinh, Tube Screamer/Rat/Klon foundation. Asym creates Big Muff-style even harmonics.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'drive', label: 'Drive', type: 'number', min: 1,   max: 16, step: 0.01,  default: 1, unit: '',   format: fmtX },
      { id: 'asym',  label: 'Asym',  type: 'number', min: 0,   max: 1,  step: 0.001, default: 0, unit: '',   format: fmtPct },
      { id: 'trim',  label: 'Trim',  type: 'number', min: -24, max: 12, step: 0.1,   default: 0, unit: 'dB', format: fmtDb },
    ],
  },

  // Wavefolder — buchla / serge / make-noise non-monotonic shaper.
  // Algorithm: Faust ef.wavefold (David Braun, MIT — faust_misceffects.lib
  // line 1243+, citing U. Zölzer "Digital Audio Signal Processing" Ch 10
  // Fig 10.7). Distinct primitive from saturate/softLimit: above threshold
  // the transfer FOLDS BACK rather than asymptoting, generating even
  // harmonics that no sigmoid produces. See op_wavefolder.worklet.js.
  wavefolder: {
    id: 'wavefolder',
    label: 'fold',
    description: 'wavefolder — non-monotonic transfer (Buchla/Serge fingerprint), even harmonics. Faust ef.wavefold.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'drive', label: 'Drive', type: 'number', min: 1,   max: 8,  step: 0.01,  default: 1,   unit: '',   format: fmtX },
      { id: 'width', label: 'Width', type: 'number', min: 0,   max: 1,  step: 0.001, default: 0.5, unit: '',   format: fmtPct },
      { id: 'trim',  label: 'Trim',  type: 'number', min: -24, max: 12, step: 0.1,   default: 0,   unit: 'dB', format: fmtDb },
    ],
  },

  // Diode ladder — generic 4-pole diode-coupled LP (Stinchcombe-direct, v3
  // Layer 1). Coupled (non-buffered) cap-chain state-space from
  // Moog_ladder_tf.pdf §3, d=1 equal-cap config. Distinct from Moog #34
  // ladder: denominator [1,7,15,10,1] vs [1,4,6,4,1], k≈10 self-osc edge.
  // TB-303-specific 7th-order coupling-cap network with 8-Hz lower peak is
  // queued as Layer 2 (see qc_backlog.md). NOT a TB-303 emulation.
  diodeLadder: {
    id: 'diodeLadder',
    label: 'diodLP',
    description: 'diode-ladder LP (Stinchcombe-direct, v3 Layer 2) — TB-303 character: TB-303 core matrix (d=1, C₁=C/2) + 5 fixed coupling-cap sections, 2× polyphase OS, tanh on driver pair, 8-Hz lower-peak interaction via post-network FB tap.',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'normFreq', label: 'Cutoff', type: 'number', min: 0,   max: 1,    step: 0.001, default: 0.4, unit: '',   format: fmtPct },
      { id: 'Q',        label: 'Q',      type: 'number', min: 0.7, max: 20,   step: 0.01,  default: 4,   unit: '',   format: fmtX },
      { id: 'drive',    label: 'Drive',  type: 'number', min: 0,   max: 1,    step: 0.001, default: 1,   unit: '',   format: fmtPct },
      { id: 'trim',     label: 'Trim',   type: 'number', min: -24, max: 12,   step: 0.1,   default: 0,   unit: 'dB', format: fmtDb },
    ],
  },

  // Korg 35 lowpass — MS-10 / MS-20 / KARP character. Sallen-Key state-
  // variable VA topology with explicit feedback path; very different edge
  // under high resonance vs Moog ladder (#34) or diode ladder (#135).
  // Self-oscillates near Q=10. Verbatim port of Faust ve.korg35LPF
  // (Eric Tarr 2019, MIT-style STK-4.3). Slot originally proposed as
  // `steinerParker` — renamed because Faust has no Steiner-Parker port
  // and Korg-35 is the closest in-the-same-family primary in hand. See
  // op_korg35.worklet.js header for naming-rationale + verbatim source.
  korg35: {
    id: 'korg35',
    label: 'k35LP',
    description: 'Korg 35 LPF — MS-20 character, Sallen-Key VA with feedback path. Faust ve.korg35LPF (Tarr).',
    ports: { inputs: [{ id: 'in', kind: 'audio' }], outputs: [{ id: 'out', kind: 'audio' }] },
    params: [
      { id: 'normFreq', label: 'Cutoff', type: 'number', min: 0,   max: 1,    step: 0.001, default: 0.35, unit: '',   format: fmtPct },
      { id: 'Q',        label: 'Q',      type: 'number', min: 0.7, max: 10,   step: 0.01,  default: 3.5,  unit: '',   format: fmtX },
      { id: 'trim',     label: 'Trim',   type: 'number', min: -24, max: 12,   step: 0.1,   default: 0,    unit: 'dB', format: fmtDb },
    ],
  },

  // polyBLEP — Cheap parabolic anti-aliased sawtooth oscillator. Two-piece
  // quadratic correction per Välimäki-Huovilainen IEEE SPM 2007 §III.B.
  // Companion to #82 minBLEP (similar use, ~10 dB more aliasing but no
  // FFT/event-pool/min-phase machinery — trivially per-voice scalable).
  // freqMod control input enables linear FM. See op_polyBLEP.worklet.js.
  polyBLEP: {
    id: 'polyBLEP',
    label: 'polyBLEP',
    description: 'polyBLEP saw oscillator — Välimäki-Huovilainen IEEE SPM 2007 §III.B parabolic correction. Cheap polyphonic-friendly cousin of #82 minBLEP. Linear FM via freqMod.',
    ports: {
      inputs:  [{ id: 'freqMod', kind: 'control' }],
      outputs: [{ id: 'out',     kind: 'audio'   }],
    },
    params: [
      { id: 'freq', label: 'Freq', type: 'number', min: 0.01, max: 20000, step: 0.01, default: 440, unit: 'Hz',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(2)} Hz` },
      { id: 'amp',  label: 'Amp',  type: 'number', min: 0,    max: 4,     step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
    ],
  },

  // diodeBridgeGR — #179 Dynamics. Phenomenological diode-bridge GR cell
  // modeling Neve 33609 / 2254 / 8014 family. PURE-ODD distortion (3H + 5H
  // from y³ cubic shape) — diode-bridge symmetry cancels even harmonics.
  // Optional `asymmetry` adds small even content for component-mismatch
  // realism. Memoryless. Math-by-definition: 2254/33609 service manuals
  // inaccessible at ship time. P1 research-debt.
  diodeBridgeGR: {
    id: 'diodeBridgeGR',
    label: 'diodeBridgeGR',
    description: 'Diode-bridge GR cell — Neve 33609/2254 phenomenology. Pure-odd 3H+5H from cubic; optional asymmetry knob for component-mismatch 2H. cv > 0 = more compression.',
    ports: {
      inputs:  [{ id: 'audio', kind: 'audio' }, { id: 'cv', kind: 'audio' }],
      outputs: [{ id: 'out',   kind: 'audio' }],
    },
    params: [
      { id: 'cutoffScale',   label: 'Cutoff',    type: 'number', min: 0.5, max: 30,  step: 0.1,   default: 8,    unit: '',   format: (v) => v.toFixed(1) },
      { id: 'curveExponent', label: 'Knee',      type: 'number', min: 1.0, max: 3.0, step: 0.01,  default: 1.8,  unit: '',   format: (v) => v.toFixed(2) },
      { id: 'distortion',    label: 'Odd',       type: 'number', min: 0,   max: 0.5, step: 0.001, default: 0.10, unit: '',   format: (v) => v.toFixed(3) },
      { id: 'asymmetry',     label: 'Asymmetry', type: 'number', min: -0.3, max: 0.3, step: 0.001, default: 0.0,  unit: '',  format: (v) => v.toFixed(3) },
      { id: 'trim',          label: 'Trim',      type: 'number', min: -24, max: 24,  step: 0.1,   default: 0,    unit: 'dB', format: (v) => `${v.toFixed(1)} dB` },
    ],
  },

  // fetVVR — #147 Dynamics. Phenomenological JFET voltage-variable-resistor
  // gain cell modeling UREI/UA 1176 family (2N3819 JFET, fast attack /
  // aggressive harmonics signature). Memoryless. Distinct from varMuTube
  // (vari-mu) by sharper knee (β=2 default vs 1.5) AND mixed 2H+3H
  // distortion (FET asymmetric + pinch-off non-linearity) vs varMuTube's
  // pure-even 2H+4H. "All buttons in" mode = crank both distortion2H and
  // distortion3H. Math-by-definition: 1176 service manual + 2N3819
  // datasheet inaccessible at ship time. P1 research-debt.
  fetVVR: {
    id: 'fetVVR',
    label: 'fetVVR',
    description: 'JFET-VVR GR cell — UREI 1176 phenomenology. Sharp knee + mixed 2H/3H distortion. cv > 0 = more compression. distortion2H + distortion3H independently tunable for "all buttons in" character.',
    ports: {
      inputs:  [{ id: 'audio', kind: 'audio' }, { id: 'cv', kind: 'audio' }],
      outputs: [{ id: 'out',   kind: 'audio' }],
    },
    params: [
      { id: 'cutoffScale',   label: 'Cutoff',   type: 'number', min: 0.5, max: 30,  step: 0.1,   default: 5,    unit: '',   format: (v) => v.toFixed(1) },
      { id: 'curveExponent', label: 'Knee',     type: 'number', min: 1.0, max: 4.0, step: 0.01,  default: 2.0,  unit: '',   format: (v) => v.toFixed(2) },
      { id: 'distortion2H',  label: 'Even',     type: 'number', min: 0,   max: 0.5, step: 0.001, default: 0.10, unit: '',   format: (v) => v.toFixed(3) },
      { id: 'distortion3H',  label: 'Odd',      type: 'number', min: 0,   max: 0.5, step: 0.001, default: 0.05, unit: '',   format: (v) => v.toFixed(3) },
      { id: 'trim',          label: 'Trim',     type: 'number', min: -24, max: 24,  step: 0.1,   default: 0,    unit: 'dB', format: (v) => `${v.toFixed(1)} dB` },
    ],
  },

  // varMuTube — #145 Dynamics. Phenomenological variable-mu tube gain
  // cell modeling Manley Variable Mu / Fairchild 670 / Altec 436 family.
  // Soft-knee Hill-function gain curve + 2H distortion that scales with
  // compression depth (the tube character — heavier GR = more 2H content).
  // Memoryless. cv positive = compression amount; cv=0 → unity gain.
  // Math-by-definition: primary tube datasheets (6386, 6BC8) and
  // Pakarinen-Yeh CMJ 2009 inaccessible at ship time; topology anchored
  // to Giannoulis-Massberg-Reiss JAES 2012 §Soft Knee. P1 research-debt.
  varMuTube: {
    id: 'varMuTube',
    label: 'varMuTube',
    description: 'Variable-mu tube GR cell — Manley Vari-Mu / Fairchild 670 phenomenology. Soft-knee Hill curve + compression-depth-coupled 2H. cv > 0 = more compression.',
    ports: {
      inputs:  [{ id: 'audio', kind: 'audio' }, { id: 'cv', kind: 'audio' }],
      outputs: [{ id: 'out',   kind: 'audio' }],
    },
    params: [
      { id: 'cutoffScale',   label: 'Cutoff',    type: 'number', min: 1,    max: 50,  step: 0.1,  default: 10,  unit: '',   format: (v) => v.toFixed(1) },
      { id: 'curveExponent', label: 'Knee',      type: 'number', min: 0.5,  max: 3.0, step: 0.01, default: 1.5, unit: '',   format: (v) => v.toFixed(2) },
      { id: 'distortion',    label: 'Character', type: 'number', min: 0,    max: 0.5, step: 0.001, default: 0.1, unit: '',   format: (v) => v.toFixed(3) },
      { id: 'trim',          label: 'Trim',      type: 'number', min: -24,  max: 24,  step: 0.1,  default: 0,   unit: 'dB', format: (v) => `${v.toFixed(1)} dB` },
    ],
  },

  // blackmerVCA — #142 Dynamics. Log-add-antilog VCA gain cell modeling
  // the Blackmer (dbx / THAT 2180) topology per US Patent 3,714,462.
  // Memoryless. cv input interpreted as gain in dB (cv=0 → unity gain).
  // bias param adds class-AB Vbe-mismatch character (signed 2H distortion).
  // Default bias=0 → ideal linear multiplier; ±0.025 ≈ patent matching
  // tolerance (1 mV / 40 µA) → audible "warm" character. Composes with
  // any envelope follower to build full compressors.
  blackmerVCA: {
    id: 'blackmerVCA',
    label: 'blackmerVCA',
    description: 'Log-add-antilog VCA — Blackmer US Patent 3,714,462 (dbx/THAT 2180). cv in dB; bias adds Vbe-mismatch 2H character. ±50 dB range per patent.',
    ports: {
      inputs:  [{ id: 'audio', kind: 'audio' }, { id: 'cv', kind: 'audio' }],
      outputs: [{ id: 'out',   kind: 'audio' }],
    },
    params: [
      { id: 'bias', label: 'Bias',  type: 'number', min: -0.5, max: 0.5, step: 0.001, default: 0.0,  unit: '',  format: (v) => v.toFixed(3) },
      { id: 'trim', label: 'Trim',  type: 'number', min: -24,  max: 24,  step: 0.1,   default: 0.0,  unit: 'dB', format: (v) => `${v.toFixed(1)} dB` },
    ],
  },

  // optoCell — #141 Dynamics. Phenomenological optical-isolator gain-reduction
  // cell modeling LA-2A T4-style behavior (EL panel + CdS LDR with thermal
  // memory). Two-state envelope: fast (10ms attack / 60ms initial release per
  // UA spec) + slow (1-15s program-dep). max(envFast, envSlow) gives quick
  // recovery on brief peaks but slow recovery on sustained pinning. Gain
  // mapping 1/(1 + k·env²) approximates LDR resistance ~ 1/intensity². NOT a
  // physically-accurate T4 model — phenomenology only; exact thermal-coupling
  // DSP model logged as research-debt P1.
  optoCell: {
    id: 'optoCell',
    label: 'optoCell',
    description: 'Optical-isolator GR cell (LA-2A T4 phenomenology — UA T4 numbers, two-state thermal memory). Outputs gain-reduction multiplier (0..1); compose with #5 mix or external multiplication for full compressor.',
    ports: {
      inputs:  [{ id: 'cv',   kind: 'audio' }],
      outputs: [{ id: 'gain', kind: 'audio' }],
    },
    params: [
      { id: 'attackMs',       label: 'Attack',     type: 'number', min: 0.1, max: 100, step: 0.1, default: 10,  unit: 'ms', format: (v) => `${v.toFixed(1)} ms` },
      { id: 'releaseMsFast',  label: 'Release Fast', type: 'number', min: 5,   max: 500, step: 1,   default: 60,  unit: 'ms', format: (v) => `${v.toFixed(0)} ms` },
      { id: 'releaseSecSlow', label: 'Release Slow', type: 'number', min: 0.5, max: 15,  step: 0.1, default: 5,   unit: 's',  format: (v) => `${v.toFixed(1)} s` },
      { id: 'responsivity',   label: 'Depth',      type: 'number', min: 0.05, max: 4.0, step: 0.01, default: 1.0, unit: '', format: (v) => v.toFixed(2) },
    ],
  },

  // srcResampler — #166 Foundation/Utility. Polyphase Kaiser-windowed-sinc
  // varispeed reader per JOS Implementation page (ccrma.stanford.edu/~jos/
  // resample/Implementation.html). NOT a true elastic-buffered SRC: same N
  // inputs / N outputs per call; `speed` controls per-sample read advance
  // into a 1024-sample circular history. NZ=8 zero-crossings × L=32 phases
  // → 17-tap effective FIR with 70 dB stopband (Kaiser β=7). At speed=1
  // op is a pure NZ-sample filter delay. Drift at speed≠1 over many blocks
  // is documented limitation (P2 elastic buffering in research-debt).
  srcResampler: {
    id: 'srcResampler',
    label: 'srcResampler',
    description: 'Polyphase varispeed reader — JOS Implementation page, Kaiser-windowed-sinc (NZ=8, L=32, β=7). Same N in / N out per call; `speed` controls fractional read-pointer advance. P2 elastic buffering for sustained heavy varispeed.',
    ports: {
      inputs:  [{ id: 'in',  kind: 'audio' }],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'speed', label: 'Speed', type: 'number', min: 0.25, max: 4.0, step: 0.001, default: 1.0, unit: '×',
        format: (v) => v.toFixed(3) + '×' },
    ],
  },

  // velvetNoise — Sparse ±1/0 impulse stream on a Td-sample grid. One
  // impulse per cell, position uniform within cell, sign 50/50. Foundational
  // primitive for high-quality decorrelators / lush reverb early reflections /
  // convolution-tail substitutes (~3% of the multiplications of a dense FIR
  // when convolved). Per Karjalainen-Järveläinen AES 2007 (originator); see
  // op_velvetNoise.worklet.js for full citation chain.
  velvetNoise: {
    id: 'velvetNoise',
    label: 'velvetNoise',
    description: 'Velvet noise — sparse ±1 impulses on a Td-sample grid. Karjalainen-Järveläinen 2007 / Välimäki et al. 2017. Decorrelator + ER primitive. Density-only knob; deterministic from seed.',
    ports: {
      inputs:  [],
      outputs: [{ id: 'out', kind: 'audio' }],
    },
    params: [
      { id: 'density', label: 'Density', type: 'number', min: 50, max: 5000, step: 1, default: 1500, unit: 'imp/s',
        format: (v) => v >= 1000 ? `${(v/1000).toFixed(2)}k imp/s` : `${Math.round(v)} imp/s` },
      { id: 'amp',     label: 'Amp',     type: 'number', min: 0,  max: 4,    step: 0.001, default: 1, unit: '',
        format: (v) => v.toFixed(3) },
      { id: 'seed',    label: 'Seed',    type: 'number', min: 1,  max: 2147483647, step: 1, default: 22222, unit: '',
        format: (v) => `${v | 0}` },
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
