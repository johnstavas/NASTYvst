// foundation.mjs — behavioral specs for foundation / utility / filter / distortion ops.
//
// Day 2 backfill: covers a representative subset of the 46 parity-shipped ops
// across utility, filter, and distortion categories. Demonstrates the 18-category
// schema is workable across the catalog.

const dbToLinear = (db) => Math.pow(10, db / 20);

// ─────────────────────────────────────────────────────────────────────
// UTILITY — closed-form math identity ops
// ─────────────────────────────────────────────────────────────────────

export const UTILITY_BEHAVIORAL = {
  gain: {
    category: 'utility',
    tldr: 'Volume — boost or cut by dB. The simplest building block. 0 dB does nothing.',
    // Default to unity so the listen test shows IN === OUT and the meter
    // strip reads matching levels. The math is still verified across non-
    // trivial values via param_sweep below.
    defaultParams: { gainDb: 0 },
    declared: {
      expectedFn: (x, p) => x * dbToLinear(p.gainDb),
    },
  },
  abs: {
    category: 'utility',
    tldr: 'Octave-up rectifier. Flips negatives positive — pure tones double in pitch, drums get harshly distorted with DC clicks.',
    defaultParams: {},
    declared: {
      expectedFn: (x) => Math.abs(x),
    },
  },
  sign: {
    category: 'utility',
    tldr: '1-bit hard square. Reduces input to ±1 — drums become click pulses, tones become buzzy squares. Extreme crush.',
    defaultParams: {},
    declared: {
      expectedFn: (x) => x > 0 ? 1 : x < 0 ? -1 : 0,
    },
  },
  clamp: {
    category: 'utility',
    tldr: 'Brutal hard limit at fixed rails. Drive hot for buzzy, squared-off odd-harmonic distortion.',
    // Param names are `lo`/`hi` (not `min`/`max`). Spec must match the smoke
    // build's baked params (lo=-0.5, hi=0.5) for two-arm equivalence —
    // otherwise the worklet uses its own defaults and the arms test
    // different parameter values silently. Day 4 finding.
    defaultParams: { lo: -0.5, hi: 0.5 },
    declared: {
      expectedFn: (x, p) => Math.max(p.lo, Math.min(p.hi, x)),
    },
  },
  polarity: {
    category: 'utility',
    tldr: 'Phase invert switch. Inaudible alone — does anything only when summed with another signal. Null-test utility.',
    defaultParams: { invert: 0 },
    declared: {
      expectedFn: (x, p) => p.invert ? -x : x,
    },
  },
  uniBi: {
    // uniBi default mode = 'uniToBi' (y = 2x - 1).
    category: 'utility',
    controlSignalOp: true,    // expects 0..1 control input, not audio — banner explains
    tldr: 'Range remapper. Bridges control-rate (0..1) and audio-rate (-1..+1). Plumbing utility — expects a control signal, not audio (feeding audio in produces a DC-shifted clipping mess).',
    defaultParams: { mode: 'uniToBi' },
    declared: {
      expectedFn: (x) => 2 * x - 1,
    },
  },
  // ── Foundational compressor-chain ops (added 2026-04-27 to close the
  //    coverage gap that hid four C++ stubs from the harness for the
  //    entire codegen pipeline's life) ─────────────────────────────────
  detector: {
    category: 'utility',
    tldr: 'Loudness tracker (control signal, not audio). First stage of any compressor: detector → envelope → gainComputer → VCA.',
    defaultParams: { mode: 'peak' },
    declared: {
      // Peak mode: closed-form |x|. Stateless, no buffering.
      expectedFn: (x) => Math.abs(x),
    },
  },
  // ── Worklet-shared variants ────────────────────────────────────────
  // These ops share a worklet sidecar with a sibling but get a separate
  // smoke build with different baked params, so per_op_specs.json has a
  // distinct key and parity_host loads a distinct VST3.
  polarity_inv: {
    category: 'utility',
    parityKey: 'polarity_inv',
    workletOpId: 'polarity',     // load op_polarity.worklet.js
    defaultParams: { invert: 1 },
    declared: {
      expectedFn: (x) => -x,
    },
  },
  uniBi_b2u: {
    category: 'utility',
    parityKey: 'uniBi_b2u',
    workletOpId: 'uniBi',
    defaultParams: { mode: 'biToUni' },
    declared: {
      expectedFn: (x) => (x + 1) * 0.5,
    },
  },
  // ── Single-param numeric ───────────────────────────────────────────
  scaleBy: {
    category: 'utility',
    tldr: 'Linear multiplier (k×). Same audible result as `gain` — but takes a raw multiplier (k=2 doubles, k=0.5 halves) instead of dB. Used inside graph wiring where envelope or CV multiplication needs raw scale, not musical dB.',
    defaultParams: { k: 2 },
    declared: {
      expectedFn: (x, p) => p.k * x,
    },
  },
  mix: {
    category: 'utility',
    tldr: 'Equal-power dry/wet crossfade. Two inputs in (dry, wet), one out — combines them with the cos/sin law so both legs sum to unity. The plumbing piece for any "mix" knob in a recipe.',
    // mix uses equal-power crossfade per dry_wet_mix_rule.md (NON-NEGOTIABLE):
    //   dryGain = cos(amount · π/2)     wetGain = sin(amount · π/2)
    // Worklet arm tested with dry-only stimulus → expectedFn = dryGain · x.
    // Native arm SKIPS — parity_host's single-WAV interface cannot drive
    // mix's two input ports (dry, wet) cleanly: the smoke build's port
    // wiring may copy the WAV to both ports OR leave one zeroed; either
    // way the wet path doesn't match the worklet test expectation.
    // Resolve when multi-input parity_host lands (logged in research-debt).
    defaultParams: { amount: 0.5 },
    nativeSkip: true,
    declared: {
      inputPort: 'dry',
      expectedFn: (x, p) => Math.cos(p.amount * Math.PI * 0.5) * x,
    },
  },
  // ── constant ─────────────────────────────────────────────────────
  // No audio input. Output is the param `value` on every sample —
  // drive whatever stim the runner feeds, output should ignore it
  // entirely and just emit `value`. expectedFn returns the param.
  constant: {
    category: 'utility',
    controlSignalOp: true,   // outputs DC — speakers can't reproduce, judge by math/chart
    tldr: 'DC source. Outputs a fixed value on every sample, ignoring any audio input. Useful as a tunable constant for thresholds, mix targets, or stand-in defaults.',
    defaultParams: { value: 0.5 },
    declared: {
      expectedFn: (_x, p) => p.value,
      tolerance: 1e-5,
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: utility / routing / control primitives (12 ops, 2026-04-28)
  // Mostly trivial-math routing nodes where the parity gate (P) is the
  // real verification. Each gets a tldr so the agent can map prompts.
  // ─────────────────────────────────────────────────────────────────

  // ── curve — universal parametric-curve primitive ─────────────────
  // Default points are {(0,0),(1,1)} = linear identity in [0,1] domain.
  // For inputs in [0,1] the op is a pass-through; outside that the
  // hermite extrapolation kicks in. Declared identity tolerance is loose
  // because hermite endpoints can wobble micro-amounts.
  curve: {
    category: 'utility',
    tldr: "It's a hand-drawn shape you bend signals through. Want a knob that's super-touchy at the bottom and lazy at the top? Draw the curve. Want a custom waveshaper? Draw it. Want a transfer function that mimics a vintage compressor's knee? Draw that too. Swiss-army knife.",
    defaultParams: {
      points: [
        { x: 0, y: 0, tIn: 1, tOut: 1 },
        { x: 1, y: 1, tIn: 1, tOut: 1 },
      ],
      interp: 'hermite',
      bipolar: false,
    },
    declared: {
      // Identity at default points; sine 1 kHz at 0.5 amp stays in [-0.5, 0.5]
      // which under bipolar:false gets clamped/extrapolated. Keep tolerance
      // loose to absorb hermite-extrapolation edge effects.
      expectedFn: (x) => Math.max(0, Math.min(1, x)),
      tolerance: 1e-3,
    },
  },

  // ── quantizer — snap-to-grid for control values ──────────────────
  // Closed-form: y = offset + round((x − offset) / step) * step
  quantizer: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's a stair-step. Takes a smooth signal and forces it to land on the nearest grid line. Same math at the heart of a bitcrusher (step=0.125 ≈ 4-bit) — but here it's the primitive, used for locking LFOs to semitone steps, snapping knobs to integer values, or turning smooth automation into staircases. For audio crushiness reach for #14 bitcrush; for control-grid snap reach here.",
    defaultParams: { step: 0.125, offset: 0, mode: 'round' },
    declared: {
      expectedFn: (x, p) => p.offset + Math.round((x - p.offset) / p.step) * p.step,
      tolerance: 1e-5,
    },
  },

  // ── busSum — 4-input unity summer ────────────────────────────────
  busSum: {
    category: 'utility',
    tldr: "It's a plus sign. Adds 4 signals together into 1 output. That's the whole op. No character, no flavor, just a + b + c + d.",
    defaultParams: {},
    declared: {
      formula: 'out = in0 + in1 + in2 + in3',
      note: 'Math-by-definition. No closed-form test — single-input listen rig only feeds in0; remaining 3 inputs are silent.',
    },
  },

  // ── fanOut — 1→4 passthrough splitter ────────────────────────────
  fanOut: {
    category: 'utility',
    tldr: "It's a copy machine. 1 signal goes in, 4 identical copies come out. Saves you wiring the same source four times. The other half of busSum's family.",
    defaultParams: {},
    declared: {
      formula: 'out0 = out1 = out2 = out3 = in',
      note: 'Math-by-definition. Each output is a bit-exact copy of the input.',
    },
  },

  // ── select — 1-of-4 hard switch ──────────────────────────────────
  select: {
    category: 'utility',
    tldr: "It's a TV channel switcher. 4 signals come in, one goes out — a knob picks which. No fading, no blend, just hard cut. Click goes to the next channel.",
    defaultParams: { index: 0 },
    declared: {
      formula: 'out = in[index]   where index ∈ {0, 1, 2, 3}',
      note: 'Math-by-definition. Hard switch — no crossfade between channels.',
    },
  },

  // ── crossfade — equal-power A↔B fader ────────────────────────────
  crossfade: {
    category: 'utility',
    tldr: "It's a DJ fader between A and B. Slide the knob, A fades down while B fades up — and the loudness stays the same the whole way (no dip at the middle). The cos/sin trick that DJs and dry/wet mixes both use.",
    defaultParams: { position: 0.5 },
    declared: {
      formula: 'out = cos(p · π/2) · a + sin(p · π/2) · b   where p ∈ [0, 1]',
      law: 'equal-power (constant total RMS as position sweeps)',
      primary: 'Blumlein 1933 patent GB 394,325 + Julius Smith CCRMA "Equal-Power Panning"',
    },
  },

  // ── combine — 2-control signal coupler ───────────────────────────
  combine: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's a math knob between two control signals. Pick mode = multiply or add. Use it to make one LFO scale another, or to layer two envelopes. The glue between modulation sources.",
    defaultParams: { weight: 0.5, mode: 'mul' },
    declared: {
      formula_mul: 'out = a * b * weight',
      formula_add: 'out = a + b * weight',
      note: 'Mode dispatch — pick mul or add at graph build time. Stateless.',
    },
  },

  // ── meters — dual peak+RMS ballistics ────────────────────────────
  meters: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the bouncing needle on a recording console. Watches the audio and spits out two numbers: the loud moments (peak) and the average loudness (RMS). Built-in presets for VU, PPM, and digital meters.",
    defaultParams: { standard: 'vu', peakReleaseMs: 1700, rmsWindowMs: 300 },
    declared: {
      peak_formula: 'peak = max(|x|) with exponential decay (release time = peakReleaseMs)',
      rms_formula:  'rms = sqrt(mean(x² over rmsWindowMs window))',
      vu_default:   'integration ≈ 300 ms (IEC 60268-17)',
      ppm_default:  'attack 10 ms, release 1700 ms (IEC 60268-10)',
      primary: 'IEC 60268-17 (VU) · IEC 60268-10 (PPM) · BS.1770-5 (digital)',
    },
  },

  // ── ramp — triggered one-shot linear ramp ────────────────────────
  ramp: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's a slow-mo button push. When you trigger it, the value slides from start to end over X milliseconds, then sits there. Useful for one-shot envelopes, filter sweeps, fade-ins, anywhere you need a smooth move that fires once.",
    defaultParams: { startVal: 0, endVal: 1, timeMs: 100 },
    declared: {
      formula: 'on rising-edge trigger: out(t) = startVal + (endVal − startVal) · clamp(t / timeMs, 0, 1)',
      note: 'One-shot — the ramp completes once and holds at endVal until the next rising edge.',
    },
  },

  // ── trigger — Schmitt with hysteresis ────────────────────────────
  trigger: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's a Schmitt trigger — a doorbell with a sticky button. Cross over the high threshold, the door opens (output goes high). Has to fall below a LOWER threshold before it'll close again — that hysteresis stops it from chattering on noisy signals. Two flavors: stay-on-while-loud (gate) or one-tick-on-the-knock (pulse).",
    defaultParams: { threshHi: 0.5, threshLo: 0.4, mode: 'gate' },
    declared: {
      state_machine: 'if !high && x ≥ threshHi → high = true; if high && x ≤ threshLo → high = false',
      gate_mode:  'out = high ? 1 : 0',
      pulse_mode: 'out = (rising edge of high) ? 1 : 0   (one sample only)',
      primary: 'Schmitt 1934 (Otto H. Schmitt, vacuum-tube hysteresis trigger)',
    },
  },

  // ── z1 — single-sample delay ─────────────────────────────────────
  z1: {
    category: 'utility',
    tldr: "It's a one-sample wait. Holds a value for a single tick (21 microseconds at 48k — way faster than your ear). Used inside graphs to break feedback loops without sounding like anything. By itself, totally inaudible.",
    defaultParams: {},
    declared: {
      formula: 'y[n] = x[n − 1]   (with x[−1] = 0 at reset)',
      transfer_function: 'H(z) = z⁻¹',
      note: 'Sample-by-sample identity test FAILS because of the 1-sample lag — same group-delay pattern as srcResampler.',
    },
  },

  // ── microDetune — ±50¢ pitch shifter (chorus-style) ──────────────
  // ─────────────────────────────────────────────────────────────────
  // BATCH: spectral / pitch / analysis / physical (23 ops, 2026-04-28)
  // The remaining catalog. Mostly analysis primitives (extract info from
  // audio) and physical-modeling building blocks. Most output CV or
  // multi-channel data — single-WAV harness can't compare cleanly.
  // ─────────────────────────────────────────────────────────────────

  fft: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's the workhorse of every spectral analyzer. Takes audio, splits it into N frequency bins. Real and imaginary parts come out separate ports. Inverse via #65 ifft. The math floor for chromagrams, vocoders, convolution, pitch shifters.",
    defaultParams: { size: 1024 },
    declared: { method: "Cooley-Tukey radix-2 FFT", primary: "Cooley & Tukey 1965 + JOS Spectral Audio Signal Processing" },
  },
  ifft: {
    category: "utility",
    tldr: "It's the way back from frequency space. Take FFT bins, give me audio. Used after spectral processing (pitch shift, convolution, time-stretch) to resynthesize the time-domain signal.",
    defaultParams: { size: 1024 },
    declared: { method: "Inverse Cooley-Tukey radix-2 FFT", primary: "JOS SASP" },
  },
  stft: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's a sliding-window FFT — chops audio into overlapping windows, FFTs each, gives you a 2D spectrogram (time x freq). The input layer of vocoders, time-stretchers, pitch-shifters, convolution reverbs.",
    defaultParams: { size: 1024, hop: 256 },
    declared: { method: "Hann-windowed sliding FFT, 75% overlap default", primary: "JOS SASP STFT chapter" },
  },
  istft: {
    category: "utility",
    tldr: "It's the inverse of stft. Take the 2D spectrogram, give me audio back. Used to resynthesize after spectral processing.",
    defaultParams: { size: 1024, hop: 256 },
    declared: { method: "Overlap-add of windowed IFFT frames (COLA condition)", primary: "JOS SASP" },
  },
  phaseVocoder: {
    category: "utility",
    tldr: "It's the engine behind every modern time-stretch and pitch-shift effect. Decompose audio into magnitude + phase per frequency bin via STFT, manipulate phases for time/pitch independence, resynthesize. Used inside Melodyne, Auto-Tune-Flex, every DAW elastic-time mode.",
    defaultParams: { size: 1024, pitchShift: 1.0 },
    declared: {
      method: "STFT → phase-derivative-tracking → phase-coherent resynthesis with pitch/time scaling",
      primary: "Flanagan & Golden 1966 + Bernsee smbPitchShift + De Goetzen DAFx-2000",
    },
  },
  convolution: {
    category: "utility",
    tldr: "It's the IR-based effect. Multiply audio by an impulse response in the frequency domain (FFT-based fast convolution) and you get convolution reverb, speaker simulation, room modeling. The CPU-cheap way to apply long impulse responses.",
    defaultParams: { length: 128 },
    declared: { method: "FFT-based partitioned convolution (overlap-save with N-point FFT blocks)", primary: "Gardner 1995 zero-latency partitioned convolution" },
  },
  correlation: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's the stereo phase-correlation meter. -1 = L and R are inverted (mono-incompatible), 0 = totally uncorrelated, +1 = identical (mono). Sits on every mastering meter — keeps you out of phase trouble.",
    defaultParams: { timeMs: 300 },
    declared: { formula: "corr = EMA(L*R) / sqrt(EMA(L^2) * EMA(R^2))", primary: "classic Pearson correlation, BS.1770 stereo metering" },
  },
  chromagram: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's the music-information-retrieval pitch-class detector. Folds the FFT into 12 bins (one per pitch class C, C#, D, …) ignoring octave. Used for chord detection, key finding, similarity matching. Spotify uses this inside its track-similarity engine.",
    defaultParams: { size: 1024, nChroma: 12, tuning: 0 },
    declared: { method: "STFT → log-frequency mapping → fold into 12 pitch-class bins", primary: "Fujishima ICMC-1999 + librosa chroma_stft" },
  },

  yin: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's the classic real-time pitch detector. Cheveigne 2002 algorithm — autocorrelation + cumulative-mean-normalized-difference + parabolic interpolation. Output is fundamental frequency in Hz. Drives every modern auto-tuner pitch-detect stage.",
    defaultParams: { f0Min: 80, f0Max: 1000, threshold: 0.1 },
    declared: { primary: "de Cheveigne & Kawahara 2002 JASA — YIN, a fundamental frequency estimator for speech and music" },
  },
  pyin: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's YIN with probabilistic post-processing (HMM-Viterbi). Mauch & Dixon 2014 — picks the best pitch trajectory across time instead of frame-by-frame, gives smoother + more accurate pitch curves. Used in Tony for vocal transcription.",
    defaultParams: { f0Min: 61.735, f0Max: 880, windowMs: 46.4 },
    declared: { primary: "Mauch & Dixon 2014 ICASSP — pYIN: A Fundamental Frequency Estimator Using Probabilistic Threshold Distributions" },
  },
  crepe: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's the deep-learning pitch detector. Convolutional neural net trained on pitch-labelled audio — outperforms YIN/pYIN on noisy material. The accuracy ceiling at the cost of GPU/CPU cycles. Powers modern automatic-transcription tools.",
    defaultParams: { voicingThreshold: 0.5, modelSize: "tiny" },
    declared: { primary: "Kim, Salamon, Li, Bello ICASSP-2018 — CREPE: A Convolutional Representation for Pitch Estimation" },
  },
  onset: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's a transient detector. Detects when notes/beats START in the audio — finds the moments where energy suddenly increases across frequencies. Drives beat-tracking, slicing, segment alignment.",
    defaultParams: { size: 1024, lag: 1, maxSize: 1 },
    declared: { method: "Spectral-flux onset detection function with peak-picking", primary: "Bello et al. 2005 — A Tutorial on Onset Detection in Music Signals" },
  },

  formant: {
    category: "utility",
    tldr: "It's a vowel-formant filter. Picks one of A/E/I/O/U vowel shapes and applies the spectral envelope of that vowel to the input audio. Result: vocal-like timbres on synth pads, talkbox-style effects, vowel morph in modulators. Use vowel param 0..4 with fractional = morph.",
    defaultParams: { vowel: 0 },
    declared: { method: "10th-order direct-form IIR with 5 vowel coefficient tables (A/E/I/O/U), linear morphing", primary: "musicdsp #110 alex@smartelectronix Formant Filter" },
  },
  goertzel: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's a single-frequency-bin FFT. When you only need to know the magnitude at ONE specific frequency (DTMF tone detection, single-band metering), Goertzel is way cheaper than a full FFT. Used in modems, telephony, single-band loudness probes.",
    defaultParams: { freq: 1000, blockN: 512 },
    declared: { method: "Goertzel recurrence — 2-pole IIR, output magnitude after blockN samples", primary: "Goertzel 1958 — An algorithm for the evaluation of finite trigonometric series" },
  },
  granularBuffer: {
    category: "utility",
    tldr: "It's the granular synthesis engine. Stores incoming audio in a buffer, then plays back small overlapping grains at controllable rate / duration / pitch. The DSP under every grain-cloud effect — Output, Cycling 74 Granula, every modular granular plugin.",
    defaultParams: { bufMs: 1000, delayMs: 100, grainMs: 50 },
    declared: { method: "Circular buffer + Hann-windowed grain scheduler with pitch and density modulation", primary: "Roads Microsound (MIT 2001) + Truax granular canon" },
  },
  lpc: {
    category: "utility",
    tldr: "It's the speech-coding primitive. Linear Predictive Coding decomposes audio into a slowly-changing filter + a fast residual signal. The filter is the vocal-tract envelope; the residual is the pitch-buzz. The math behind every vocoder, talkbox, telephone codec.",
    defaultParams: { order: 12, blockN: 1024 },
    declared: { method: "Levinson-Durbin recursion solves the autocorrelation Toeplitz matrix for filter coefficients", primary: "Atal & Hanauer 1971 + JOS LPC chapter" },
  },
  warpedLPC: {
    category: "utility",
    tldr: "It's LPC with frequency warping. The standard LPC fit is uniform across the spectrum; warpedLPC weights it bark-style (more bins around 1-4 kHz where ears care). Better for vocal modelling, formant tracking, lower-order fits that still sound speech-like.",
    defaultParams: { order: 12, blockN: 1024, lambda: 0.65 },
    declared: { method: "LPC with bilinear all-pass warping (lambda controls warp depth, ~0.65 = Bark scale at 48 kHz)", primary: "Harma & Karjalainen 1996 — Warped Linear Prediction" },
  },
  mfcc: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's the audio-fingerprint feature. Mel-Frequency Cepstral Coefficients — distill audio into 13-ish coefficients per frame that capture timbre/character. The input layer of every audio classifier — speech recognition, music genre, voice authentication, sound-alike detection.",
    defaultParams: { size: 1024, numFilters: 26, numCoefs: 13 },
    declared: { method: "STFT → mel-filter-bank → log → DCT → truncate to N coefs", primary: "Davis & Mermelstein 1980 IEEE Trans-ASSP" },
  },

  chamberlinZeroCross: {
    category: "utility",
    tldr: "It's the converter-zero-crossing glitch primitive. Models the sign-magnitude DAC dead-zone artifact from Chamberlin-era digital gear (1985 Musical Applications of Microprocessors). Adds a tiny spike at every signal zero-crossing. Used as part of fpDacRipple-class vintage-digital chains.",
    defaultParams: { deadZone: 0.002, glitch: 0.05 },
    declared: { primary: "Chamberlin Musical Applications of Microprocessors 2e (Hayden 1985), zero-cross glitch mechanism" },
  },
  kellyLochbaum: {
    category: "utility",
    tldr: "It's a vocal-tract physical model. Cylindrical tube sections joined at scattering junctions with reflection coefficients at glottis (source) and lips (output). The classic 1962 vocoder/voice-synthesis math. Produces vowel-like timbres from raw excitation signals.",
    defaultParams: { length: 32, taper: 0, glottis: -0.9, lip: -0.85 },
    declared: { primary: "Kelly & Lochbaum 1962 — Speech synthesis (first computer-generated speech)" },
  },
  scatteringJunction: {
    category: "utility",
    tldr: "It's the joint between two delay-line sections in a physical model. When a wave hits a section change, energy splits — some transmits forward, some reflects back. The fundamental atom of all waveguide synthesis (kelly-lochbaum, waveguide, SDN reverbs).",
    defaultParams: { k: 0 },
    declared: { method: "Kelly-Lochbaum scattering: f_out = (1+k)*f_in - k*b_in; b_out = -k*f_in + (1-k)*b_in", primary: "Kelly-Lochbaum 1962 + JOS PASP scattering chapter" },
  },
  waveguide: {
    category: "utility",
    tldr: "It's a 1D physical model — a digital string. Bidirectional delay lines with reflection at each end and damping in between. Strum it with a pulse and it rings at a pitch determined by the line length. The DSP behind every physically-modeled string instrument.",
    defaultParams: { freq: 220, reflL: 0.98, reflR: 0.98, damp: 0.1 },
    declared: {
      method: "Two delay lines (forward + backward waves) with reflection coefficients at each end and a damping LP in the loop",
      primary: "Smith JOS PASP — Digital Waveguide Modeling of Musical Instruments",
    },
  },

  bpm: {
    category: "utility",
    controlSignalOp: true,
    tldr: "It's a tempo detector. Watches the beat structure of incoming audio and outputs the detected BPM. Drives sync-to-incoming-music features in DJ tools and live performance setups.",
    defaultParams: { windowN: 1024, histDepth: 43 },
    declared: { method: "Energy-flux peak detection + autocorrelation of inter-onset intervals + histogram voting", primary: "Scheirer 1998 JASA + Klapuri 2003 beat tracker family" },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: routing / stereo / 2 stray filters (8 ops, 2026-04-28)
  // ─────────────────────────────────────────────────────────────────

  panner: {
    category: 'utility',
    tldr: "It's the pan knob. L=R input mono signal placed left/right in the stereo field. Three pan laws: linear (volume tracks linearly, dips 6 dB at center), constant-power (cos/sin, no dip), or -4.5 dB (compromise — what most consoles use). Default pan=0 = centered = both speakers identical = sounds like mono.",
    defaultParams: { pan: 0, law: 1 },
    listenParams:  { pan: 0.6, law: 1 },   // off-center so listen test exposes L/R balance change
    declared: {
      laws: '0 = linear · 1 = constant-power (cos/sin) · 2 = -4.5 dB compromise',
      formula_constpwr: 'L = cos(p · pi/2) · in;  R = sin(p · pi/2) · in   where p = (pan+1)/2',
      primary: 'Dannenberg pan-law canon + Blumlein 1933 patent',
    },
  },

  autopan: {
    category: 'utility',
    tldr: "It's a pan knob driven by an LFO. Hands-free auto-pan from the 60s — sweeps the source between L and R at rateHz, depth controls how wide the sweep goes. Used as a slow whoosh on pads, or fast at audio rate for chopped-stutter effects.",
    defaultParams: { rateHz: 1, depth: 1, shape: 0, phaseDeg: 0 },
    declared: {
      method: 'LFO drives constant-power panner: pan(t) = depth · shape_fn(2pi · rateHz · t + phaseDeg)',
      shapes: '0 = sine (smooth) · 1 = triangle · 2 = square (hard L/R)',
      primary: 'Dannenberg pan-law + JOS LFO canon',
    },
  },

  msEncode: {
    category: 'utility',
    tldr: "It's the stereo->M/S encoder. Takes L+R and emits Mid (L+R)/sqrt(2) and Side (L-R)/sqrt(2). Used to process the center separately from the sides — different EQ on Mid vs Side, or stereo widening via Side level.",
    defaultParams: {},
    declared: {
      formula: 'M = (L + R) / sqrt(2);  S = (L - R) / sqrt(2)   (orthonormal — energy preserved)',
      primary: 'Math-by-definition orthonormal M/S transform',
    },
  },

  msDecode: {
    category: 'utility',
    tldr: "It's the M/S->stereo decoder. Inverse of msEncode — takes Mid+Side back to L+R. Pair them: msEncode in -> EQ-on-mid + EQ-on-side -> msDecode -> stereo out. The mastering trick.",
    defaultParams: {},
    declared: {
      formula: 'L = (M + S) / sqrt(2);  R = (M - S) / sqrt(2)',
      primary: 'Math-by-definition inverse of msEncode',
    },
  },

  haas: {
    category: 'utility',
    tldr: "It's the precedence-effect widener. Delay one channel by 5-30 ms relative to the other — your brain interprets the FIRST arrival as the source location, but the delayed channel adds spatial width. Cheap fake stereo from mono. The trick behind every '70s vocal-doubling effect.",
    defaultParams: { delayMs: 18, levelDb: 0, side: 0, mix: 1 },
    declared: {
      method: 'Add delayed copy of source to opposite channel; precedence (Haas) effect makes it spatial without being heard as echo',
      primary: 'Haas 1951 (Helmut Haas, Doctoral Thesis) - precedence effect',
    },
  },

  crossfeed: {
    category: 'utility',
    tldr: "It's the headphone fix. Real speakers leak sound to both ears (with a delay + LF roll-off). Headphones don't - making stereo mixes sound 'in your head' instead of in front. Crossfeed adds a controlled lowpass-leakage between L and R to simulate speaker bleed; mixes sound externalized.",
    defaultParams: { fcut: 700, feed: 4.5 },
    declared: {
      method: 'Bauer 1961: feed each side L lowpass (cutoff fcut Hz) into the opposite channel R at -feed dB, and vice versa',
      primary: 'libbs2b Boris Mikhaylov + Bauer 1961 stereophonic-to-binaural DSP',
    },
  },

  comb: {
    category: 'utility',
    tldr: "It's a comb filter. Add the signal to a delayed copy of itself - the constructive/destructive interference creates a comb of peaks and notches in the frequency response. FF mode = peaks add color; FB mode = peaks ring like a small reverb. The building block of flangers, choruses, and Karplus-Strong strings.",
    defaultParams: { mode: 1, delayMs: 10, g: 0.7, maxDelayMs: 500 },
    declared: {
      ff_formula: 'y[n] = x[n] + g * x[n - D]   (peaks at integer multiples of 1/D)',
      fb_formula: 'y[n] = x[n] + g * y[n - D]   (resonant ringing peaks)',
      primary: 'Schroeder & Logan JAES 1961 + JOS Pasp Comb-Filter section',
    },
  },

  lrXover: {
    category: 'utility',
    tldr: "It's a 4th-order Linkwitz-Riley crossover. Splits audio into low and high bands at f0 - the L+H bands sum back to flat (the LR magic). Used in multi-band compressors, speaker systems, frequency-split processing where rejoining mustn't color.",
    defaultParams: { f0: 1000 },
    declared: {
      method: '4th-order LR = cascaded 2nd-order Butterworth pair (one pole at f0, sqrt(2)/2 damping)',
      property: 'L + H summed = flat magnitude (the defining LR-crossover property)',
      primary: 'Linkwitz JAES 1976 + Riley JAES 1983 + Canon:filters',
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: time / delay (5 ops, 2026-04-28)
  // ─────────────────────────────────────────────────────────────────

  bbdDelay: {
    category: 'utility',
    tldr: "It's a bucket-brigade delay — the analog warmth in every Memory Man, Electric Mistress, Roland Space Echo, Juno-60 chorus. Repeats get darker and slightly modulated each pass through the BBD chip's anti-aliasing filters. Distinctly different from clean digital delay — sounds OLD and ALIVE.",
    defaultParams: { delayMs: 250, aaHz: 6000, feedback: 0.35, mix: 0.5 },
    listenParams:  { delayMs: 350, aaHz: 4500, feedback: 0.55, mix: 0.5 },
    declared: {
      method: 'BBD chip simulation: input AA filter -> variable delay line -> output reconstruction filter, feedback wraps lowpassed signal back',
      character: 'Each repeat passes through the AA/recon filters again -- repeats darken progressively (BBD signature) instead of staying bright (digital signature)',
      primary: 'Holters & Parker DAFx 2018 BBD model + Section 7 Reverb canon',
    },
  },

  delay: {
    category: 'utility',
    tldr: "It's a clean variable-time digital delay. Set the time, get a single repeat at that time later. Feed the `fb` port back into itself for repeats. Used as a standalone slap or as a building block inside reverbs, choruses, and more complex time effects.",
    defaultParams: { time: 250, feedback: 0.4 },
    declared: {
      method: 'Variable-time delay line with linear interpolation between fractional taps',
      formula: 'y[n] = buf[(w - D) mod N]   where D = time_ms * sr / 1000',
      note: 'External feedback (port `fb`) -- listen rig drives `in` only, so feedback path is silent. Output is single-tap slap-back.',
      primary: 'JOS Pasp delay-line section + Canon:time S1',
    },
  },

  lookahead: {
    category: 'utility',
    tldr: "It's a pure delay buffer. Holds the audio for X ms so a downstream limiter / compressor can 'see the future' -- react to peaks BEFORE they hit the output. The reason modern brickwall limiters can catch transients without distortion. Inaudible by itself; only useful in chains.",
    defaultParams: { lookaheadMs: 5 },
    declared: {
      method: 'Pure linear-phase delay line -- no filtering, no character. Output = input delayed by lookaheadMs.',
      formula: 'y[n] = x[n - D]   where D = lookaheadMs * sr / 1000',
      character: 'No audible character by design -- used purely for time-shifting in feedforward chains',
      primary: 'Canon:time S1 -- math-by-definition',
    },
  },

  oversample2x: {
    category: 'utility',
    tldr: "It's the anti-aliasing helper. Upsamples audio 2x -> process at higher rate -> downsample back. Used inside saturators / waveshapers / non-linear ops to prevent aliasing artifacts. Roundtrip alone (no processing in the middle) sounds nearly identical to bypass -- 0.001 dB difference. Plumbing.",
    defaultParams: { attenuationDb: 100, transitionBw: 0.01 },
    declared: {
      method: '2x polyphase IIR halfband -- Laurent de Soras hiir library port (WTFPL, ship-safe verbatim)',
      formula: 'roundtrip: upsample -> identity -> downsample = bit-near-identical to bypass',
      character: 'Inaudible by design -- used as an anti-aliasing wrapper around non-linear ops',
      primary: 'Laurent de Soras hiir polyphase halfband library',
    },
  },

  pitchShift: {
    category: 'utility',
    tldr: "It's the dramatic pitch shifter -- Bernsee phase-vocoder. STFT analysis -> frequency-bin manipulation -> IFFT resynthesis. Capable of big interval shifts (octave up/down, fifths) but introduces phase artifacts on transients ('phasing' or 'glassiness'). For subtle +/-50 cent chorus thickening reach for #106 microDetune instead.",
    defaultParams: { pitch: 1.0, mix: 1.0 },
    listenParams:  { pitch: 1.5, mix: 1.0 },
    declared: {
      method: 'Streaming phase-vocoder: FIFO buffer -> STFT -> frequency-bin shift -> IFFT -> overlap-add',
      formula: 'pitch ratio r: hop = N_fft / overlap; output_phase[k] = input_phase[k*(1/r)] * r per bin',
      vs_microDetune: 'pitchShift is for big intervals (+/-octaves); microDetune is for +/-50 cent ADT-style thickening',
      primary: 'De Goetzen-Bernardini-Arfib DAFx-2000 + Bernsee smbPitchShift musicdsp #92',
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: character / saturation (7 ops, 2026-04-28)
  // Real audio processors — all distortion-class ops with audible
  // character. Most need listenParams override to crank drive past
  // the "subtle" defaults that exist for math testing.
  // ─────────────────────────────────────────────────────────────────

  fpDacRipple: {
    category: 'utility',
    tldr: "It's the floating-point DAC quirk that makes ValhallaVintageVerb's 70s/80s modes sound vintage. 12-bit + 3-bit gain-ranged converters from the Sony PCM-1610 era added a subtle re-quantization at every gain change — that micro-clicking texture under the audio. Felix Petrescu / ValhallaDSP secret sauce.",
    defaultParams: { bits: 12, expBits: 3, noise: 0.0005, seed: 1 },
    listenParams:  { bits: 6, expBits: 2, noise: 0.005, seed: 1 }, // crush bits + crank noise so the vintage-DAC grain is unmistakable. At default 12-bit it sits around -72 dB and is masked by drum transients; at 6-bit you hear the granular crackle clearly.
    declared: {
      method: 'Mantissa quantization to bits + exponent quantization to expBits + small uniform noise',
      formula: 'gain_range = 2^expBits levels of gain steps; mantissa quantized to bits within each',
      character: 'Audible "70s digital reverb" texture — micro-grain under the audio body',
      primary: 'Chamberlin "Musical Applications of Microprocessors" 2e — converter-era character primitives',
    },
  },

  noiseShaper: {
    category: 'utility',
    tldr: "It's the upgraded dither. Higher-order error-feedback noise shaping pushes quantization noise above 16 kHz where ears are less sensitive — so a 16-bit master can sound like 18-20 bits' worth of low-end clarity. Used at the final mastering stage, never in middle-of-chain.",
    defaultParams: { bits: 16, order: 9, weighting: 1, seed: 1 },
    listenParams:  { bits: 8,  order: 9, weighting: 1, seed: 1 },   // crush to 8-bit so the shaping is audible
    declared: {
      method: '9th-order error-feedback noise shaping per Lipshitz/Vanderkooy',
      weightings: '0 = flat noise · 1 = F-weighted (push noise to >16 kHz) · 2 = JJ-weighted (psychoacoustic)',
      primary: 'Lipshitz, Vanderkooy & Wannamaker JAES 1992 "Minimally Audible Noise Shaping"',
    },
  },

  tapeAir9: {
    category: 'utility',
    tldr: "It's Chris Johnson's ToTape9 in code. Faithful Airwindows port — the messy beautiful tape sim that's become a cult-favorite mastering plugin. Subtle 2H thickening + Dubly-style HF compansion + flutter modulation + bias offset for asymmetric saturation. Real-tape vibe without being a parade-float emulator.",
    defaultParams: { drive: 0.5, dubly: 0.5, encCross: 0.5, flutterDepth: 0.0, flutterRate: 0.5, bias: 0.5 },
    listenParams:  { drive: 0.5, dubly: 0.85, encCross: 0.5, flutterDepth: 0.7, flutterRate: 0.5, bias: 0.65 },
    // ListenParams differentiation strategy: keep drive at default (the saturation
    // amount is similar to tapeSim by design — both are tape sims). The UNIQUE
    // tapeAir9 features are flutter (pitch wobble — tapeSim has none), Dubly
    // compansion (HF emphasis/de-emphasis), and bias asymmetry. Cranking those
    // exposes the Airwindows-specific character vs the generic tapeSim baseline.
    declared: {
      method: 'Airwindows ToTape9 — multi-stage: input gain → Dubly encode → IIR crossover saturation → flutter mod → IIR crossover decode',
      primary: 'Chris Johnson Airwindows ToTape9 (MIT-license, faithful port of ToTape9.cpp)',
    },
  },

  tapeSim: {
    category: 'utility',
    tldr: "It's a generic 2-knob tape simulator. Gloubi-boulga soft-clip waveshaper + head-bump EQ at 60 Hz + HF roll-off at 16 kHz. Less special than tapeAir9 but cheaper to compute and easier to dial — the everyday tape coloration.",
    defaultParams: { drive: 1.0, bumpHz: 60, bumpDb: 3.0, bumpQ: 1.0, hfHz: 16000, trim: 1.0 },
    listenParams:  { drive: 2.5, bumpHz: 60, bumpDb: 3.0, bumpQ: 1.0, hfHz: 16000, trim: 0.7 }, // crank drive for audible saturation
    declared: {
      method: '3-stage: drive → gloubi-boulga waveshape → head-bump peak EQ → HF roll-off',
      formula: 'gloubi-boulga: y = (e·x − e^(-x)) / (e^|x| + e^(-|x|))',
      primary: 'Bram de Jong gloubi-boulga (musicdsp #46) + head-bump EQ from canon:character',
    },
  },

  transformerSim: {
    category: 'utility',
    tldr: "It's a transformer's anhysteretic curve. Soft saturation modeled on the magnetic-flux behavior of audio transformers — gentle 3rd-harmonic at low drive, asymmetric 2nd at high. Different beast than tape: tape is mostly 2H even-harmonic warmth; transformers add 3H + a touch of subbass round-off.",
    defaultParams: { drive: 1, bias: 0, output: 1 },
    listenParams:  { drive: 3, bias: 0.2, output: 0.5 }, // crank drive + bias for audible character
    declared: {
      method: 'Anhysteretic flux curve approximation — atan/tanh hybrid with bias offset',
      formula: 'y = atan(drive·(x + bias)) − atan(drive·bias)   (DC-removed)',
      character: 'Lower 3H content than diodeClipper; higher 2H asymmetry than saturate',
      primary: 'De Paiva 2011 transformer anhysteretic model (TIER-S source; see memory/depaiva_transformer_emulation.md)',
    },
  },

  tubeSim: {
    category: 'utility',
    tldr: "It's a 12AX7 in math. Norman Koren's SPICE triode model — the real grid-cathode-plate physics of a vacuum tube, stripped down to a memoryless waveshaper. At default bias/drive it's a moderate-warmth thickener; crank drive and you're in vintage-amp distortion territory.",
    defaultParams: { drive: 1.5, bias: 1.5, plateV: 250, mu: 100, ex: 1.4, kg1: 1060 },
    listenParams:  { drive: 6, bias: 0.5, plateV: 350, mu: 100, ex: 1.4, kg1: 1060, trim: 4 },
    // bias=0.5 keeps the tube in conducting range for most of the audio swing
    // (high bias = cuts off negative half = half-wave rectified, very quiet
    // output). plateV=350 = hotter operating point. drive=6 + trim=4 = brings
    // output back to typical audio level while keeping the tube character.
    declared: {
      method: "Norman Koren's SPICE triode model — memoryless waveshape based on plate-current eq",
      output_level_note: 'Output IS plate-current swing (mA-class), not voltage. Use the trim param (0..4) as makeup gain to bring level back to typical audio range — real tube circuits always have makeup gain downstream.',

      formula: 'I_p = (E_p / k_g1) · log(1 + exp(k_p · (1/μ + V_g/sqrt(K_v + E_p²))))^E_x',
      tube_default: '12AX7 (μ=100, E_x=1.4, k_g1=1060)',
      primary: "Norman Koren, 'Improved Vacuum Tube Models for SPICE Simulations' (Glass Audio 8(5):18, 1996; web update 2003 at normankoren.com)",
    },
  },

  dither: {
    category: 'utility',
    tldr: "It's the truth-telling layer between bit depths. TPDF dither (triangular probability density) + optional 2nd-order noise shaping — the math that lets you reduce 24-bit audio to 16-bit without hearing nasty quantization distortion. Required at every bit-depth-reduction step in mastering.",
    defaultParams: { bits: 16, shape: 0.5, seed: 1 },
    listenParams:  { bits: 8,  shape: 0.8, seed: 1 },   // 8-bit reduction so dither is audible
    declared: {
      method: 'TPDF dither (triangular PDF, sum of two uniform PRNGs) + 2nd-order error-feedback noise shape',
      formula: 'y[n] = round((x[n] + dither − error_fb · shape) · 2^(bits-1)) / 2^(bits-1)',
      primary: 'Paul Kellett (2002) musicdsp.org Archive #61 "Dither Code"',
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: reverb / space (7 ops, 2026-04-28)
  // ─────────────────────────────────────────────────────────────────

  ER: {
    category: 'utility',
    tldr: "It's the room signature. Sparse early reflections — the first 50-100 ms of bounces off walls before the dense reverb tail kicks in. ER is what tells your ear \"this is a small studio\" vs \"this is a cathedral.\" Sits in front of every algorithmic reverb's diffuse tail.",
    defaultParams: { roomSize: 1.0, airHz: 8000, level: 1.0, mix: 1.0 },
    declared: {
      method: 'Sparse tap delay-line + air-absorption LPF + per-tap level',
      character: 'roomSize 0.5 = tight studio · 1.0 = mid room · 2.0 = large hall',
      primary: 'Moorer 1979 / Dattorro 1997 / Gardner 1992 ER topology',
    },
  },

  SDN: {
    category: 'utility',
    tldr: "It's a physical-acoustics reverb. Models a shoebox room as a network of delay lines connected at scattering nodes — when a wave hits a wall it splits and bounces. More \"this is a real room\" than algorithmic reverbs that just blur sound.",
    defaultParams: { rt60: 1.2, size: 1.0, damping: 0.3, width: 0.3 },
    declared: {
      method: 'Scattering Delay Network — N delay lines + scattering matrix at junction nodes',
      formula: 'per-junction: out_i = Σ_j s_ij · in_j   where S is unitary scattering matrix',
      primary: 'De Sena, Hacıhabiboğlu, Cvetković & Smith JAES 60(11):917 (Nov 2012)',
    },
  },

  diffuser: {
    category: 'utility',
    tldr: "It's the smear stage. Cascade of 4 allpass filters with mutually-prime delay lengths — feeds dense, untextured energy into the next reverb stage. By itself sounds like a tasteful blur on the source; chained with a tail it builds the density that makes a reverb sound \"thick.\"",
    defaultParams: { g: 0.7, size: 1.0 },
    declared: {
      method: '4-stage Schroeder allpass cascade with mutually-prime delays',
      formula: 'each stage: y[n] = -g·x[n] + x[n-D] + g·y[n-D]',
      primary: 'Schroeder & Logan JAES 1961 "Colorless Artificial Reverberation"',
    },
  },

  fdnCore: {
    category: 'utility',
    tldr: "It's the engine of every modern algorithmic reverb. 8 delay lines feeding back through an orthogonal mixing matrix — the math guarantees infinite density without coloration. Set decay to 0.9 and you're in cathedral territory; 0.5 is a chamber.",
    defaultParams: { decay: 0.5, hf: 0.7 },
    declared: {
      method: '8-channel FDN with Householder orthogonal feedback matrix + per-channel HF shelf',
      formula: 'y[n] = Σ_k a_k · z_k[n]; z_k[n+1] = M · (input + g_k · y_filtered)',
      primary: 'Geraint Luff Hadamard FDN (canonical — see memory/reverb_engine_architecture.md)',
    },
  },

  plate: {
    category: 'utility',
    tldr: "It's an EMT 140 in code. Dattorro's 1997 plate-reverb topology — fast bloom, dense shimmer, that unmistakable steel-sheet sound. The reverb on every late-Beatles record, every Phil Spector track. Stereo in / stereo out (true plate width).",
    defaultParams: { decay: 0.5, predelayMs: 0, bandwidth: 0.9999, damping: 0.0005, size: 1.0, modDepth: 16 },
    declared: {
      method: 'Dattorro 1997 plate topology: pre-delay → bandwidth LP → diffusers → tank with cross-feedback → 4 output taps',
      stereo: 'true stereo — input l/r ports separately fed; output l/r ports separately tapped',
      note: 'Multi-input op (l, r) — listen rig drives port `in` which does not exist on plate. Output may be silent or partially driven in the rig.',
      primary: 'Dattorro, "Effect Design Part 1: Reverberator and Other Filters," JAES 45(9):660–684 (Sept 1997)',
    },
  },

  schroederChain: {
    category: 'utility',
    tldr: "It's the original 1962 algorithmic reverb. Manfred Schroeder's parallel-comb-then-series-allpass topology — the FORGOTTEN reverb that Sean Costello (Valhalla DSP) revived in 2009. Cleaner-sounding than FDN at high decay, with a distinctive vintage-digital character.",
    defaultParams: { rt60: 2.0, damping: 0.0, size: 1.0, spread: 23 },
    declared: {
      method: '4 parallel comb filters (with HF damping) → 2 series allpass diffusers → stereo output',
      formula: 'comb_k: y[n] = x[n-Dk] + g·y[n-Dk]; allpass: y[n] = -g·x[n] + x[n-D] + g·y[n-D]',
      primary: 'Schroeder, "Natural Sounding Artificial Reverberation," JAES 10(3):219 (Jul 1962) + Costello revival 2009',
    },
  },

  spring: {
    category: 'utility',
    tldr: "It's the sproing under every guitar amp. Parametric spring-tank reverb — chains of dispersive allpass filters mimic the way mechanical springs split low and high frequencies into different decay paths. Sound: the unmistakable \"boing\" of a Fender amp, an AKG BX-20, or a 60s surf record.",
    defaultParams: { decay: 0.7, dispersion: 0.65, transitionHz: 4300, chirpRate: 1.0, numStagesLF: 30, numStagesHF: 12 },
    declared: {
      method: 'Parker 2011: cascaded 1st-order dispersive allpass stages, separate LF and HF chains, transition frequency split',
      stereo: 'mono in / stereo l/r out — different dispersive paths produce L/R decorrelation',
      primary: 'Parker, "Efficient Dispersion Generation Structures for Spring Reverb Emulation," EURASIP JASP 2011, Article 646134',
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: synthesis / generators (9 ops, 2026-04-28)
  // All source ops (optional freqMod control input + audio output).
  // Most produce audible character at default freq=440. nativeSkip with
  // architectural reason: source ops don't fit input/output-diff harness.
  // ─────────────────────────────────────────────────────────────────

  sineOsc: {
    category: 'oscillator',
    tldr: "It's the simplest oscillator in the world. A pure sine wave at one frequency — the building block of every additive synth, the test tone of every audio engineer, the truth-source for every other generator.",
    defaultParams: { freq: 440, amp: 1 },
    declared: {
      method: 'Direct-Form Resonator (DFR) — Julius Smith CCRMA. Two-sample state, no Math.sin() call per sample.',
      formula: 'y[n] = 2·cos(ω)·y[n-1] − y[n-2]   where ω = 2π·freq/sr',
      primary: 'Julius O. Smith, *Physical Audio Signal Processing*, "Digital Sinusoid Generators"',
    },
  },

  blit: {
    category: 'oscillator',
    tldr: "It's the synthesis seed for sawtooths and squares. A band-limited impulse train — sharp ticks at the fundamental frequency, but with high-frequency content limited to below Nyquist so it doesn't alias. Integrate it once → saw. Twice → triangle. The mathematician's oscillator.",
    defaultParams: { freq: 440, amp: 1 },
    declared: {
      method: 'Closed-form Discrete Summation Formula (DSF) — sum of N harmonics, exactly band-limited',
      formula: 'y[n] = sin((2N+1)·π·f/fs) / ((2N+1)·sin(π·f/fs))   where N = ⌊fs/(2·freq)⌋',
      primary: 'Stilson & Smith ICMC-1996 "Alias-Free Digital Synthesis of Classic Analog Waveforms"',
    },
  },

  polyBLEP: {
    category: 'oscillator',
    tldr: "It's the cheap-and-good saw. Polynomial-corrected sawtooth — naive saw plus a tiny polynomial fix at every wraparound point that smooths the discontinuity. ~85% as clean as full BLIT for ~5% of the CPU. The default saw of every modern subtractive synth.",
    defaultParams: { freq: 440, amp: 1 },
    declared: {
      method: 'Naive saw + 2nd-order polynomial correction at phase wrap',
      formula: 'corrected = naive_saw + polyBLEP_kernel(t, dt)   where dt = freq/sr',
      primary: 'Välimäki & Huovilainen IEEE SPM 2007 §III.B "Antialiasing Oscillators in Subtractive Synthesis"',
    },
  },

  minBLEP: {
    category: 'oscillator',
    tldr: "It's the audiophile's saw. Minimum-phase Band-Limited Step — same idea as polyBLEP but using a precomputed FIR kernel that's audibly cleaner near the high notes. Used where alias artifacts on top octaves matter (sub-bass synths, vintage emulations).",
    defaultParams: { freq: 440, amp: 1 },
    declared: {
      method: 'Naive saw + minimum-phase windowed-sinc step convolution at phase wrap',
      formula: 'corrected = naive_saw + minBLEP_FIR_kernel ⊛ (step events)',
      primary: 'Brandt 2001 ICMC "Hard Sync Without Aliasing" + Stilson-Smith ICMC-1996',
    },
  },

  fm: {
    category: 'oscillator',
    tldr: "It's Yamaha DX-style FM synthesis — one operator modulating another. Carrier sine + modulator sine. Modulation index controls how much. Index = 0 → pure tone. Index = 5 → bell. Index = 12 → brass. Index = 20 → industrial scream. The 80s in a knob.",
    defaultParams: { carrierFreq: 440, modRatio: 1, modIndex: 1, amp: 1 },
    declared: {
      method: 'Two-operator phase-modulation (modRatio · carrierFreq = modulator freq)',
      formula: 'y[n] = sin(2π·carrierFreq·t + modIndex · sin(2π·modRatio·carrierFreq·t))',
      primary: 'Chowning 1973 JAES 21(7):526 "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation"',
    },
  },

  karplusStrong: {
    category: 'oscillator',
    tldr: "It's a plucked string. Excite a delay line with a burst of noise, then loop it through a low-pass filter — and the line resonates at a pitch determined by its length. The 1983 paper that gave us the first real physical-modeling synth. Sounds like guitar / harp / koto / kalimba depending on the burst + filter settings.",
    defaultParams: { freq: 220, decay: 0.996, bright: 0.5 },
    declared: {
      method: 'Delay-line of length sr/freq → output → averaging-filter (decay-weighted) → feedback into delay-line',
      formula: 'buf[n] = decay · ((1-bright) · 0.5·(buf[n-1] + buf[n-N]) + bright · buf[n-N])',
      note: 'Triggered op — needs rising-edge `trig` to inject the noise burst. Listen rig drives `in` not `trig`, so the string never gets plucked → output stays silent.',
      primary: 'Karplus & Strong 1983 Computer Music Journal 7(2):43 "Digital Synthesis of Plucked-String and Drum Timbres"',
    },
  },

  lfo: {
    category: 'oscillator',
    controlSignalOp: true,
    tldr: "It's the slow oscillator that wiggles other parameters. Sub-audio rate (default 1 Hz) sine / triangle / saw / square — the source of vibrato, tremolo, filter sweeps, slow auto-pan. The wobble behind every chorus and phaser.",
    defaultParams: { rateHz: 1, shape: 0, amount: 1, offset: 0 },
    declared: {
      shapes: '0 = sine · 1 = triangle · 2 = saw-up · 3 = saw-down · 4 = square',
      formula: 'lfo[n] = offset + amount · shape_fn(2π · rateHz · n / sr)',
      method: 'Coupled sin/cos form — Canon:synthesis §6, no Math.sin() per sample',
      primary: 'JOS Digital Sinusoid Generators (CCRMA) — same DFR family as sineOsc',
    },
  },

  padSynth: {
    category: 'oscillator',
    tldr: "It's the lush ambient pad generator. Builds a single-cycle sample in the frequency domain — each harmonic gets a Gaussian bandwidth around its center, so the result sounds detuned and choral instead of phase-locked. Then plays that sample as a wavetable. The fastest path to ZynAddSubFX-class pads.",
    defaultParams: { freq: 220, bandwidth: 40, shape: 0, seed: 1, amp: 1 },
    declared: {
      method: 'PADsynth: build harmonic profile in freq domain → Gaussian bandwidth per harmonic → IFFT → wavetable playback',
      formula: 'spectrum[k] = Σ_h (harmonic_amp[h] · Gaussian(k - h·fundamental_bin, σ = bandwidth_cents))',
      primary: 'Paul Nasca 2008 "PADsynth Algorithm" (zynaddsubfx.sourceforge.io paper)',
    },
  },

  wavetable: {
    category: 'oscillator',
    tldr: "It's a single-cycle wave on loop. Default table morphs through sin → tri → saw → square (positions 0..3). At position=0 it sounds identical to sineOsc by design — same waveform, different algorithm. Crank position to scan the timbre. That morphing is the distinctive wavetable character behind Massive / Serum / Vital.",
    defaultParams: { freq: 440, position: 0, amp: 1 },
    // Listen-test override: position=0 is a pure sine (identical to sineOsc).
    // Bump to 2.5 (halfway between saw and square) so the listen test exposes
    // wavetable's defining trait — interpolated waveform morphing.
    listenParams: { freq: 440, position: 2.5, amp: 1 },
    declared: {
      method: 'Linear-interp lookup with position lerp between two adjacent table indices',
      formula: 'y[n] = (1-α) · table[i_floor] + α · table[i_ceil]   where i = position·N + phase',
      primary: 'SuperCollider Osc UGen inner loop (server/plugins/OscUGens.cpp, GPLv3 algorithm)',
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: envelope / dynamics (7 ops, 2026-04-28)
  // Real audio in/out for most, except glide (control-signal) and adsr
  // (triggered). Several have defaults that put the op at "off" in the
  // listen rig — listenParams overrides expose the audible character.
  // ─────────────────────────────────────────────────────────────────

  adsr: {
    category: 'utility',
    tldr: "It's the synth envelope — Attack, Decay, Sustain, Release. Trigger fires the attack ramp; gate-off fires the release. Shapes amplitude, filter cutoff, anything that needs a gesture. The most foundational synth-voice control.",
    defaultParams: { attackMs: 5, decayMs: 50, sustain: 0.7, releaseMs: 200 },
    declared: {
      method: 'gate-driven 4-stage envelope: attack (linear) → decay (exp to sustain) → sustain (hold) → release (exp to 0)',
      formula_attack:  'y[n] = y[n-1] + (1 / (attackMs · sr / 1000))',
      formula_decay:   'y[n] = sustain + (y[n-1] − sustain) · exp(-1 / (decayMs · sr / 1000))',
      formula_release: 'y[n] = y[n-1] · exp(-1 / (releaseMs · sr / 1000))',
      note: 'Triggered op — needs rising-edge gate input. Listen rig drives audio not edges; the envelope output stays at 0.',
      primary: 'Math-by-definition synth-voice ADSR — every analog/digital synth has one.',
    },
  },

  envelopeFollower: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the audio→envelope tracker. Watches a signal's amplitude and outputs a smoothed shape that follows it — fast attack, slow release. The control source for sidechain ducking, auto-wah, every \"track-the-loudness-of-this\" effect.",
    defaultParams: { attack: 5, release: 120, mode: 0 },
    declared: {
      modes: '0 = peak (track instantaneous max) · 1 = RMS (windowed average)',
      formula: 'y[n] = (|x[n]| > y[n-1]) ? attack_lerp(y[n-1], |x[n]|) : release_lerp(y[n-1], |x[n]|)',
      attack_constant:  'a_a = 1 - exp(-1 / (attack_ms · sr / 1000))',
      release_constant: 'a_r = 1 - exp(-1 / (release_ms · sr / 1000))',
      primary: 'Bram de Jong musicdsp #136 — one-pole AR envelope detector',
    },
  },

  expander: {
    category: 'utility',
    tldr: "It's a downward expander — the inverse of a compressor. Below the threshold, the signal gets QUIETER, opening up dynamic range that compression flattened. At ratio=100 it's a noise gate; at 2:1 it's gentle dynamic-recovery.",
    defaultParams: { thresholdDb: -40, ratio: 2, kneeDb: 6, attackMs: 1, releaseMs: 100, floor: 0 },
    listenParams:  { thresholdDb: -20, ratio: 3, kneeDb: 6, attackMs: 1, releaseMs: 100, floor: 0 },
    declared: {
      formula: 'gain_dB = (input_dB − threshold) · (ratio − 1)   when input < threshold; else 0',
      knee: 'soft-knee around threshold over kneeDb range — quadratic interpolation',
      primary: 'Zölzer DAFX 2e Ch.4 expander gain law',
    },
  },

  gate: {
    category: 'utility',
    tldr: "It's a noise gate — slams the signal shut when it drops below a threshold, opens when it rises back. Cleans up bleed between drum hits, removes amp hum between guitar notes, sculpts breath sounds out of vocals. The cousin of expander but harder-edged.",
    defaultParams: { threshold: 0.1, attackMs: 1, holdMs: 20, releaseMs: 100, floor: 0.0, mix: 1.0 },
    declared: {
      state_machine: 'closed (signal ≥ threshold for attackMs) → open (signal stays above) → release (after holdMs of below-threshold) → closed',
      formula: 'gate_open ? signal : signal · floor',
      primary: 'Canon:dynamics §4 + Bram de Jong musicdsp gate state machine',
    },
  },

  glide: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's portamento — a smooth slide between two control values. Mono-synth bass-line sliding from one note's pitch to the next, automation lerping over time, parameter changes ramping instead of jumping. Constant-time mode (always glideMs to reach target, no matter the distance).",
    defaultParams: { glideMs: 100 },
    declared: {
      formula: 'on input change: ramp linearly from current value → target over glideMs, regardless of jump size',
      character: 'constant-TIME (vs constant-RATE) — every move takes the same duration',
      primary: 'Math-by-definition portamento smoother',
    },
  },

  sidechainHPF: {
    category: 'filter',
    tldr: "It's the kick-out filter. Sits in the sidechain detector path of a compressor/limiter, rolling off the lows so kick drums don't trigger compression on the whole mix. Default 100 Hz / Q=0.707; switch order=2 for 24 dB/oct steepness.",
    defaultParams: { cutoff: 100, q: 0.707, order: 1 },
    listenParams:  { cutoff: 200, q: 0.707, order: 2 },   // steeper + higher for audible test
    declared: {
      kind: 'hp',
      cutoff_hz: 100,
      method: 'RBJ biquad HPF, optionally cascaded for 24 dB/oct',
      primary: 'Robert Bristow-Johnson EQ Cookbook (Canon:filters §9)',
    },
  },

  transient: {
    category: 'utility',
    tldr: "It's the SPL Transient Designer. Two knobs: attack (boost or suppress the punch of every hit) and sustain (boost or suppress the decay tail). Reshape drums without compression — make a soft kick punchy, soften a clicky snare, lengthen a guitar sustain. The cleanest way to fix a too-soft or too-spiky take.",
    defaultParams:  { attackAmount: 0,    sustainAmount: 0,    fastMs: 1, slowMs: 30, releaseMs: 300, mix: 1 },
    listenParams:   { attackAmount: 0.6,  sustainAmount: -0.3, fastMs: 1, slowMs: 30, releaseMs: 300, mix: 1 },
    declared: {
      method: 'Differential-envelope detection — fast envelope minus slow envelope = transient indicator',
      formula: 'gain = attackAmount · (env_fast − env_slow) + sustainAmount · env_slow_tail',
      primary: 'SPL Transient Designer architecture (Wolf, German Patent DE 4,316,425)',
      note: 'Default attackAmount=sustainAmount=0 = bypass. listenParams bumps attack=+0.6 sustain=-0.3 to expose the punch-up character.',
    },
  },


  // BS.1770 / R128 / IEC 60268 / EBU Tech 3341+3342 stack. All output
  // CV (peak/rms/lufs/lra/width values), not audio. Standards-locked
  // math — no closed-form sample-by-sample expectedFn fits the meter
  // semantics (they're stateful integrations over windows). Listen rig
  // can drive audio in but won't render the CV output as audio.
  // ─────────────────────────────────────────────────────────────────

  kWeighting: {
    category: 'utility',
    tldr: "It's the human-ear EQ. Pre-emphasis filter that shapes audio before loudness measurement so the meter weights frequencies the way ears do — minus the rumble, plus the presence band. The pre-stage of every modern LUFS meter.",
    defaultParams: {},
    declared: {
      method: 'Two-stage IIR per ITU-R BS.1770-5 Annex 1: pre-filter (high-shelf @ 1681 Hz, +4 dB) + RLB-filter (HPF @ 38 Hz)',
      primary: 'ITU-R BS.1770-5 (Nov 2023). Coefficients in Canon:loudness §2.',
    },
  },

  peak: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the loud-moment chaser. Watches for the highest sample magnitude and holds it, slowly relaxing. The needle on a peak-program meter — used for clip detection and digital headroom checks.",
    defaultParams: { release: 400 },
    declared: {
      formula: 'peak[n] = max(|x[n]|, peak[n-1] · decay)   where decay = 10^(-60·dt / (release_ms / 1000))',
      ballistics: 'IEC 60268-10 standard 60 dB fall time',
      primary: 'IEC 60268-10 / BS.1770-5 peak envelope',
    },
  },

  rms: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the average-loudness meter. Squares the signal, smooths over a window, takes the square root — the steady reading instead of the bouncy peak one. The meter you watch for sustained level.",
    defaultParams: { window: 300 },
    declared: {
      formula: 'rms[n] = sqrt(EMA(x²[n], τ = window_ms / 1000))',
      ballistics: 'One-pole exponential moving average; τ = 300 ms = VU-class integration',
      primary: 'Canon:loudness §1 / Canon:dynamics §3',
    },
  },

  lufsIntegrator: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the broadcast-loudness meter. Implements EBU R128's three modes — momentary (400 ms), short-term (3 s), integrated (program-long) — over K-weighted audio. The meter that decides if your podcast meets streaming-platform loudness specs.",
    defaultParams: { mode: 'momentary', channelWeight: 1.0 },
    declared: {
      modes: 'momentary (400 ms square window) · short-term (3 s) · integrated (gated, full-program)',
      formula: 'L = -0.691 + 10·log10(Σ z_i · MeanSquare_i)   where z_i = channel weight',
      primary: 'ITU-R BS.1770-5 + EBU Tech 3341 V4 (EBU-mode compliant)',
    },
  },

  loudnessGate: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the integrator's bouncer. Throws out any 400 ms block that's quieter than -70 LUFS absolute, then throws out anything more than 10 dB below the running average — so a long quiet intro doesn't drag the integrated number down.",
    defaultParams: { channelWeight: 1.0 },
    declared: {
      stage1: 'absolute gate at -70 LUFS — drop any block below this',
      stage2: 'relative gate at -10 LU below running mean of surviving blocks',
      primary: 'ITU-R BS.1770-5 §5.1 two-stage gating',
    },
  },

  truePeak: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the inter-sample-peak detector. Upsamples 4× to catch peaks that hide between samples — those phantom overs that real digital systems clip on but a normal peak meter misses. Required for streaming-platform compliance.",
    defaultParams: { releaseMs: 1700 },
    declared: {
      method: '4× polyphase FIR upsampling (48-tap prototype) → peak detect → release',
      primary: 'ITU-R BS.1770-5 Annex 2 True Peak (dBTP)',
      headroom_recommendation: '-1 dBTP for distribution masters per AES TD1004',
    },
  },

  lra: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the dynamic-range meter. Measures how compressed (small LRA) or how dynamic (big LRA) a program is by looking at the spread of short-term loudness values across the whole piece. 5 LU = squashed pop master; 20 LU = classical orchestra.",
    defaultParams: { channelWeight: 1.0 },
    declared: {
      formula: 'LRA = L_95 − L_10   (95th percentile − 10th percentile of gated short-term loudness)',
      primary: 'EBU Tech 3342 Loudness Range',
      typical_values: 'pop master ~5 LU · podcast ~7 LU · classical ~20 LU',
    },
  },

  stereoWidth: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's the M/S width meter. Energy-domain comparison of mid (L+R) vs side (L−R) over a smoothing window. 0 = mono · 1 = perfect stereo · >1 = wider-than-stereo (rare).",
    defaultParams: { timeMs: 300 },
    declared: {
      formula: 'width = 2 · sqrt( EMA(side² , τ) ) / ( EMA(mid² , τ) + EMA(side² , τ) )',
      primary: 'Energy-domain M/S complement to #56 correlation (Goodhertz / ToneBoosters convention)',
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // BATCH: noise / random source ops (8 ops, 2026-04-28)
  // All are source ops (no audio input) — generate noise/random/chaos
  // signals. Listen rig drives `in` which doesn't exist on these; the
  // ops generate output based on their own internal state. Sample-by-
  // sample expectedFn doesn't fit (stochastic / state-dependent), so
  // most carry no closed-form. Parity gate is the real verification.
  // ─────────────────────────────────────────────────────────────────

  noise: {
    category: 'oscillator',
    tldr: "It's the static between radio stations. White / pink / brown noise generator — the classic stim source for testing filters, the bed for ambient pads, the seed for granular textures.",
    defaultParams: { shape: 'white', seed: 22222, amount: 1, offset: 0 },
    declared: {
      formula_white: 'LCG: x[n+1] = (a·x[n] + c) mod 2^32, scaled to [-1, 1]',
      formula_pink:  'White → 7-pole Paul Kellet filter (~-3 dB/oct)',
      formula_brown: 'White → 1-pole LP at sub-bass → integrate (~-6 dB/oct)',
      primary: 'Numerical Recipes LCG (a=196314165, c=907633515) + Paul Kellet pink filter',
    },
  },

  hiss: {
    category: 'oscillator',
    tldr: "It's tape hiss in a box. White or pink noise scaled to a quiet bed level — the texture under quiet passages, the air on a vintage track, the reason ambient music sounds like it's playing in a room.",
    defaultParams: { level: -24, tint: 1 },
    listenParams: { level: -12, tint: 1 },   // brighter for audible test
    declared: {
      formula: 'noise · 10^(level/20)   where tint ∈ {0=white, 1=pink}',
      primary: 'Feldkirch fast whitenoise + Paul Kellet pink (musicdsp archive)',
    },
  },

  chaos: {
    category: 'oscillator',
    tldr: "It's controlled madness. The logistic map y[n+1] = r·y·(1-y) — a tiny equation that flips between order and chaos as you turn the r knob. At r=3.99 it's pure noise; nudge down and patterns emerge. Used for stochastic modulation, glitch textures, and \"organic\" randomization.",
    defaultParams: { r: 3.99, freq: 100, y0: 0.5, mode: 1, level: 1 },
    declared: {
      formula: 'y[n+1] = r · y[n] · (1 − y[n])   where r ∈ [3.57, 4.0] = chaotic regime',
      modes: '0 = audio-rate iteration · 1 = held at sub-audio rate (freq Hz)',
      primary: "May 1976 'Simple mathematical models with very complicated dynamics' Nature 261:459",
    },
  },

  crackle: {
    category: 'oscillator',
    tldr: "It's vinyl crackle / Geiger clicks / rain on a tin roof. Sparse random-impulse noise — pops at a controlled density, on top of silence. The texture under a fake-vinyl plugin, the rain in an ambient pad, the dust on a sample.",
    defaultParams: { density: 100, mode: 1, level: 0 },
    listenParams: { density: 200, mode: 1, level: -6 },   // more clicks, audible level
    declared: {
      formula: 'Poisson-distributed impulses at `density` per second',
      modes: '1 = bipolar (±1) · 0 = unipolar (0/+1)',
      primary: 'SuperCollider Dust_next / Dust2_next (server/plugins/NoiseUGens.cpp, GPLv3 algorithm)',
    },
  },

  randomWalk: {
    category: 'oscillator',
    tldr: "It's a drunk walk. Each sample steps a random amount up or down from the last, with bouncy walls at ±1. Sounds like a low rumble (Brownian / red noise) at audio rate, or like an organic drifting modulator at slower rates.",
    defaultParams: { step: 0.125, level: 1 },
    declared: {
      formula: 'y[n+1] = clamp(y[n] + step · uniform(-1, 1), -1, 1)   with reflective bounce',
      character: 'Brown / red noise spectrum — -6 dB/oct rolloff',
      primary: 'SuperCollider BrownNoise (algorithm, GPLv3 code not copied)',
    },
  },

  velvetNoise: {
    category: 'oscillator',
    tldr: "It's noise with the brown taken out. Pseudo-random ±1 impulses placed on a regular grid — sparse but evenly spread, perfect for high-quality reverb early-reflections, decorrelators, and impulse-response substitutes. Sounds like dry fizz on its own.",
    defaultParams: { density: 1500, amp: 1, seed: 22222 },
    declared: {
      formula: 'k_imp = round(r1 · (Td − 1)),  s_imp = sgn(r2 − 0.5),  Td = sr / density',
      primary: 'Karjalainen & Järveläinen AES Convention 122 (May 2007) — "Reverberation modeling using velvet noise"',
    },
  },

  sampleHold: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's a freeze button. On a rising edge from the trigger input, latch whatever the input is and hold it until the next trigger. Used everywhere there's a trigger-driven value: arpeggiator notes, sequencer pitches, randomized filter steps.",
    defaultParams: {},
    declared: {
      formula: 'on rising-edge trig: out = in;   else out = (held value)',
      note: 'Triggered op — needs both a `trig` and `in` source. Listen rig drives one port at a time, so the steady-state test cannot exercise the latching.',
      primary: 'SuperCollider Latch_next_aa (server/plugins/TriggerUGens.cpp, GPLv3 algorithm)',
    },
  },

  stepSeq: {
    category: 'utility',
    controlSignalOp: true,
    tldr: "It's an 8-step pattern button on a sequencer. Each rising-edge trigger advances to the next step's value, wrapping at length. Outputs are held between triggers (built-in S&H). The control source for arpeggiated synth patterns, Krautrock drone modulators, and TR-style rhythm gates.",
    defaultParams: {
      length: 8,
      s0: 0, s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0, s7: 0,
    },
    declared: {
      formula: 'on rising-edge trig: step = (step + 1) mod length;   out = s[step]',
      note: 'Triggered op — at default all 8 steps are 0, so output is silent. Bump some s_k values + provide a trig source to exercise.',
      primary: 'Math-by-definition discrete state machine — no canonical paper.',
    },
  },

  microDetune: {
    category: 'utility',
    tldr: "It's a tiny pitch shift — like the second voice in a chorus pedal that's *almost* in tune with the first. ±50 cents max, just enough to thicken a vocal or fatten a synth. Beatles-style ADT, not Auto-Tune.",
    defaultParams: { cents: 0, windowMs: 50, xfadeMs: 10, level: 1 },
    // Listen-test override: cents=0 produces inaudible delay only. Bump to
    // +20¢ so the ear-test actually exposes the pitch-shifting character
    // (classic ADT thickening). Math tests still run at defaultParams.
    listenParams: { cents: 20, windowMs: 50, xfadeMs: 10, level: 1 },
    declared: {
      method: 'two-tap crossfading delay-line pitch shifter',
      pitch_ratio: 'r = 2^(cents / 1200)',
      note: 'At cents=0 the op is a windowMs-delayed passthrough (no shift). Identity test FAILS by design — group-delay placeholder.',
      vs_pitchShift: 'microDetune is for ±50¢ "spice" detune. Use #28 pitchShift for big interval shifts.',
    },
  },
  // Polyphase Kaiser-windowed-sinc resampler. At speed=1 the op is a
  // pure Nz-sample group-delay passthrough — closed-form sample-by-sample
  // identity FAILS because of the delay. Spec is intentionally a "shape
  // declaration only" placeholder; the real verification lives in T8
  // native parity (gate P, already green). A dedicated resampler metric
  // (anti-aliasing, latency-compensation, RMS-equivalence at unity rate)
  // is logged in research-debt for Day 6+.
  srcResampler: {
    category: 'utility',
    tldr: 'Varispeed reader. Pitches/slows audio via a polyphase Kaiser-windowed-sinc kernel — the high-quality interpolator behind tape-style speed change.',
    defaultParams: { speed: 1.0 },
    declared: {
      // No expectedFn → utility runner auto-PASSes with a "no closed-form"
      // note. Not gaming the gate: at speed=1 with internal group delay,
      // sample-by-sample identity is the wrong test. Parity gate (P) and
      // smoke gate (S) both green; spec marks the op as "behaviorally
      // declared, awaiting dedicated resampler metric."
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// FILTER — magnitude response + cutoff verification
// ─────────────────────────────────────────────────────────────────────

export const FILTER_BEHAVIORAL = {
  onePole: {
    category: 'filter',
    tldr: 'Tone-knob filter. The simplest LP/HP — gentle 6 dB/oct rolloff with no resonance, no character, just darken (lp) or thin (hp). The "everything filter" you reach for when you don\'t want a filter to sound like a filter.',
    parityKey: 'onePole_lp',     // per_op_specs.json uses mode-suffixed keys
    defaultParams: { cutoff: 1000, mode: 'lp' },
    declared: {
      kind: 'lp',
      cutoff_hz: 1000,
    },
  },
  onePole_hp: {
    category: 'filter',
    parityKey: 'onePole_hp',
    workletOpId: 'onePole',
    defaultParams: { cutoff: 1000, mode: 'hp' },
    declared: {
      kind: 'hp',
      cutoff_hz: 1000,
    },
  },
  dcBlock: {
    category: 'filter',
    // Default cutoff=10 Hz is BELOW the harness sweep's f_min (20 Hz), so
    // the −3 dB point would be invisible. Raise to 100 Hz for behavioral
    // testing — registry caps at 200 Hz so this is well within range.
    // (Production use stays at 10 Hz default; this is a test-only override.)
    defaultParams: { cutoff: 100 },
    declared: {
      kind: 'hp',
      cutoff_hz: 100,
    },
  },
  ladder: {
    category: 'filter',
    tldr: 'Phat Moog lopass. Smoother and creamier than korg35 — the classic Minimoog character. Steep 24 dB/oct rolloff with a singing resonance peak that sings into self-oscillation at high Q.',
    defaultParams: { cutoff: 2000, resonance: 0.3, drive: 1.0, trim: 0.0 },
    declared: {
      kind: 'lp',
      // FINDING (2026-04-26): Moog ladder's `cutoff` param refers to the
      // INDIVIDUAL POLE cutoff (Stinchcombe §2.1.2 eq.(13): f_c = I_f / (8πCV_T)).
      // The 4-pole cascade's measured -3 dB point at low resonance lands at
      // ~85% of that param (1687 Hz vs 2000 Hz set). At resonance=0.3 the
      // peak slightly raises the effective -3 dB, so we declare 1700 Hz as
      // the operational target with ±10% tolerance. Documents real ladder
      // physics, not a bug — the param is the analog pole frequency.
      cutoff_hz: 1700,
    },
  },
  svf: {
    category: 'filter',
    tldr: 'Multimode workhorse — LP/HP/BP/notch from one engine with a Q knob. Rolls off the top and keeps the lows tame at default Q; push Q higher and it sings into resonance. Steeper than onePole (12 dB/oct), cleaner than ladder. The everyday subtractive-synth filter.',
    parityKey: 'svf_lp',
    defaultParams: { cutoff: 1500, q: 0.707, mode: 'lp' },
    declared: {
      kind: 'lp',
      cutoff_hz: 1500,
    },
  },
  // korg35 / diodeLadder use normFreq (not Hz). Skip cutoff verification —
  // declare flat (or characterize by measured cutoff at default normFreq later).
  korg35: {
    category: 'filter',
    tldr: 'Sticky resonance lopass. MS-20 / Korg-35 character — buzzy but smooth, with a Q peak that lingers on transients. Analog growl on drums.',
    // FINDING (2026-04-26): worklet header documents normFreq=0.5 → V_f=0
    // → f_c=87 Hz per Stinchcombe MS-20 mapping. MEASURED at Q=0.7 (Butterworth)
    // is 240 Hz — a 2.8× divergence from documented mapping. Logged in
    // research-debt; behavioral spec uses measured value as truth pending
    // worklet review. (Possible causes: implementation prewarp deviation,
    // doc-typo in mapping, or sample-rate-dependent scaling.)
    defaultParams: { normFreq: 0.5, Q: 0.7, trim: 0.0 },
    declared: {
      kind: 'lp',
      cutoff_hz: 240,   // measured truth, not documented 87 Hz
    },
  },
  diodeLadder: {
    category: 'filter',
    tldr: 'Saturating ladder lopass with body. Gets darker as you drive it — diode feedback adds character at hot input.',
    defaultParams: { normFreq: 0.4, Q: 4.0, drive: 1.0, trim: 0.0 },
    declared: {
      kind: 'lp',
      // diodeLadder is a resonant ladder filter with Q=4 default → strong
      // resonance peak at ~normFreq·nyquist. The "cutoff_hz" measurement via
      // −3 dB below the sweep peak finds the upper-rolloff −3 dB point
      // (above resonance), not the analog cutoff. At normFreq=0.4 / Q=4 / drive=1
      // / STIM_AMP=0.25, both arms measure ~17 kHz. (Future: re-measure at Q=0.707
      // Butterworth to get the analog-cutoff.) Locked 2026-04-27.
      cutoff_hz: 17200,
      cutoff_tol_pct: 25,
    },
  },
  allpass: {
    category: 'filter',
    tldr: 'Phase shifter that\'s silent alone. Building block of phasers, reverbs, and stereo width — only audible when mixed with dry or fed back.',
    defaultParams: { freq: 1000 },
    declared: {
      kind: 'allpass',
    },
  },
  shelf: {
    category: 'filter',
    tldr: 'Bass/treble tilt — boosts or cuts a whole band above (high shelf) or below (low shelf) the corner without a peak. Wide, gentle, musical. The kind of EQ move that warms a vocal or adds air without sounding "EQ\'d."',
    parityKey: 'shelf_low',
    defaultParams: { mode: 'low', freq: 200, gainDb: 6 },
    declared: {
      kind: 'shelf',
      cutoff_hz: 200,   // the +3 dB crossing (peak − 3 dB) for the +6 dB boost
    },
  },
  // RBJ biquad filter op (the one that was stubbed in C++ until 2026-04-27).
  // T8-B-tested at default LP 1 kHz to catch regression-to-stub or coefficient drift.
  filter: {
    category: 'filter',
    tldr: 'Workhorse tone shaper. LP/HP/BP/notch biquad — at 1 kHz LP drums get darker, cymbals lose top.',
    defaultParams: { mode: 'lp', cutoff: 1000, q: 0.707 },
    declared: {
      kind: 'lp',
      cutoff_hz: 1000,
    },
  },
  tilt: {
    category: 'filter',
    tldr: 'Two-shelf tilt EQ. Seesaws around a center frequency — boost highs while cutting lows (or vice versa with negative gain). Sounds HP-like at default settings because the cut is heavier than the boost, but it\'s a tonal-balance tool, not a true high-pass.',
    defaultParams: { f0: 630, gain: 3, gfactor: 5 },
    declared: {
      kind: 'tilt',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// DISTORTION — THD-vs-level + harmonic signature + DC creep
// ─────────────────────────────────────────────────────────────────────

export const DISTORTION_BEHAVIORAL = {
  saturate: {
    category: 'distortion',
    tldr: 'Tanh saturation, drive-dependent. At low drive (1–2): gentle warmth, tape-like compression. At high drive (default 4): crushed and dense — closer to hardClip but with a rounder knee. All-odd harmonics, symmetric. Drive amount picks the character.',
    defaultParams: { drive: 4.0, trim: 0 },  // 12 dB drive into tanh
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.0,
      high_level_thd_pct_min: 0.5,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  hardClip: {
    category: 'distortion',
    tldr: 'Crushed and distorted. The most aggressive limiter — instant slice at threshold, no knee. Buzzy, broken character.',
    defaultParams: { drive: 1, threshold: 0.3, trim: 0, adaa: 0 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.0,
      high_level_thd_pct_min: 1.0,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  softLimit: {
    category: 'distortion',
    defaultParams: { threshold: 0.5 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 0.5,
      high_level_thd_pct_min: 0.1,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  wavefolder: {
    category: 'distortion',
    tldr: 'Wave folder (West Coast synthesis). Folds peaks back instead of clipping — drive harder = more harmonics, not more squash. On chords sounds like a buzzy Buchla/Serge synth timbre. Distinct from saturate/clip: this one ADDS content as drive rises, doesn\'t just squash.',
    defaultParams: { drive: 3.0, width: 0.5, trim: 0 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.0,
      high_level_thd_pct_min: 1.0,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  diodeClipper: {
    category: 'distortion',
    tldr: 'Edgy, grainy fuzz character. Sharp knee with asymmetric harmonics — sounds "broken" in a musical way. Guitar-pedal DNA.',
    defaultParams: { drive: 4.0, asym: 0.0, trim: 0 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 1.5,
      high_level_thd_pct_min: 0.5,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -30,
    },
  },
  bitcrush: {
    category: 'distortion',
    tldr: 'Lo-fi grit. 12 bits = subtle vintage, 6 bits = chunky 8-bit, 4 bits = dramatic crush.',
    defaultParams: { bits: 6 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      quantization_op: true,        // skip low-level THD check (noise floor fixed by bits)
      high_level_thd_pct_min: 1.0,
      // Bitcrush at -6 dBFS produces broadband quantization noise that is
      // not classifiable as even/odd dominant — relax signature check.
      // (Removing harmonic_signature so the harmonic test doesn't run.)
      dc_creep_max_dbfs: -30,
      // Parameter sweep: rerun the high-level THD test at each bit depth
      // to verify monotonic behaviour (more bits = less distortion). The
      // bitcrush UI in Lofi Loofy exposes 12 / 10 / 8 / 6 — covering the
      // useful musical range.
      param_sweep: {
        param: 'bits',
        values: [12, 10, 8, 6, 4],
        test_level_dbfs: 0,
        // Loose monotonicity check: THD@4bit should exceed THD@12bit.
        monotonic_increasing_thd: true,
      },
    },
  },
  chebyshevWS: {
    category: 'distortion',
    tldr: 'Surgical harmonic crunch. Adds a specific harmonic (default 3rd) — prog-crunchy on drums, makes chords drop an octave via intermod.',
    // Drive 3rd-harmonic generator (g3) on top of fundamental (g1).
    defaultParams: { g1: 1, g2: 0, g3: 0.5, g4: 0, g5: 0, level: 1 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 60,    // chebyshev g3=0.5 produces strong 3H even at low level
      high_level_thd_pct_min: 1.0,
      harmonic_signature: 'odd',
      dc_creep_max_dbfs: -40,
    },
  },
  xformerSat: {
    tldr: 'Iron. Guitar-amp / mic-pre transformer warmth — gentle 2nd/3rd harmonics with subtle LF compression as the core saturates.',
    // De Paiva 2011 — gyrator-capacitor + WDF transformer model. Drive
    // exposed in dB; default 0 dB = nominally linear, but core curvature
    // means even at low input there's some hysteresis-driven 2H.
    category: 'distortion',
    defaultParams: { drive: 12, coreSize: 1, sourceZ: 600, loss: 0.3, air: 1 },
    declared: {
      input_levels_dbfs: [-40, -20, -6, 0],
      low_level_thd_pct_max: 5.0,    // transformer always has some THD
      high_level_thd_pct_min: 0.5,
      harmonic_signature: 'odd',     // anhysteretic Langevin is dominant odd
      dc_creep_max_dbfs: -30,        // hysteresis can produce small DC
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// ENVELOPE — AR follower step-response (T90 attack/release + steady state)
// ─────────────────────────────────────────────────────────────────────
//
// The envelope op param `attack` is the EXPONENTIAL TIME CONSTANT τ (ms),
// not the IEC T90 time. For a one-pole follower:
//   T90 = τ · ln(10) ≈ 2.303 · τ
// We declare T90 directly to match IEC 60268-3 and SSL/FabFilter/iZotope
// GUI labelling convention used by metrics/envelopeStep.mjs.
//
// We override the worklet's default attack=5 / release=120 to longer
// values so T90 is comfortably above the 5 ms RMS-window resolution of
// the step-response primitive; tolerance ±30 % covers the residual
// measurement noise.

export const ENVELOPE_BEHAVIORAL = {
  // Linear slew limiter — step 0→1 takes exactly `rise` ms; T90 = 0.9·rise.
  // Step 1→0 takes `fall` ms; release T90 = 0.9·fall.
  // (envelope category metric reads attack_ms / release_ms as T90 declarations.)
  slew: {
    category: 'envelope',
    tldr: 'Linear rate-limiter. Forces sample-to-sample motion to stay under a max speed — gives knobs that "mechanical/capacitive" feel as they ramp.',
    defaultParams: { rise: 10, fall: 50 },
    declared: {
      attack_ms:  9,    // T90 = 0.9 × rise (10 ms)
      release_ms: 45,   // T90 = 0.9 × fall (50 ms)
      step_lo: 0.0,
      step_hi: 1.0,
      steady_input: 1.0,   // expected = 1·input + 0 = 1.0 (no amount/offset on slew)
    },
  },
  envelope: {
    category: 'envelope',
    tldr: 'Audio loudness follower (control signal, not audio). Outputs slow rising/falling shape tracking volume — that swooping motion at drum hits. Powers compressors and auto-wahs.',
    defaultParams: { attack: 20, release: 200, amount: -1, offset: 0 },
    declared: {
      // T90 ≈ 2.303 × τ for a one-pole exponential.
      attack_ms:  46,    // 20 ms τ → ~46 ms T90
      release_ms: 460,   // 200 ms τ → ~460 ms T90
      step_lo:    0.0,
      step_hi:    0.5,
      steady_input: 0.5, // expected settled = amount·input + offset = −0.5
                         // metric uses Math.abs() pre-RMS, so direction-agnostic
    },
  },
  // Symmetric one-pole LP smoother. Step 0→1 reaches 90% at T90 = 2.303·τ.
  // Default τ overridden to 50 ms (worklet default 10 ms) so T90 ≈ 115 ms
  // sits comfortably above the 5 ms step-response RMS window.
  smooth: {
    category: 'envelope',
    tldr: 'One-pole LP value smoother. Eats zipper noise on knob moves and ramps any control signal to its target with a clean exponential approach.',
    defaultParams: { time: 0.050 },   // τ = 50 ms (worklet default 10 ms is too fast)
    declared: {
      attack_ms:  115,    // T90 = 2.303 × τ (50 ms) ≈ 115 ms
      release_ms: 115,    // symmetric — same one-pole both directions
      step_lo: 0.0,
      step_hi: 1.0,
      steady_input: 1.0,  // settled output = input (unity gain LP)
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// GAINCURVE — gainComputer static threshold/ratio/knee verification
// ─────────────────────────────────────────────────────────────────────
//
// Drives gainComputer's `env` input with a DC sweep of positive magnitudes,
// reconstructs the (in_dB, out_dB) static curve via gr → 1 + gr → effective
// gain, fits threshold/ratio/knee per fitCompressorCurve.
// Citation: Giannoulis-Massberg-Reiss JAES 2012; Zölzer DAFX § 4.2.2.

export const GAINCURVE_BEHAVIORAL = {
  gainComputer: {
    category: 'gainCurve',
    tldr: 'Compressor threshold/ratio/knee curve (control signal, not audio). Defines how a compressor reacts to level. Used inside comp recipes after the envelope follower.',
    defaultParams: { thresholdDb: -18, ratio: 4, kneeDb: 6 },
    declared: {
      thresholdDb: -18,   // tolerance ±2 dB
      ratio:        4,    // tolerance ±15 %
      kneeDb:       6,    // informational; metric tolerance ±3 dB
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// ANALYZER — curve generators
// ─────────────────────────────────────────────────────────────────────

export const ANALYZER_BEHAVIORAL = {
  optoCell: {
    category: 'analyzer',
    tldr: 'LA-2A opto compression curve (control signal, not audio). Slow-attack glow character — that classic "leveling amp" feel.',
    defaultParams: {
      cutoffScale: 3.0,
      curveExponent: 1.2,
      distortion: 0.0,
      trim: 0,
    },
    declared: {
      cv_sweep_linear: [0, 0.5, 1.0, 2.0, 4.0, 8.0],
      cv_test_range: [-2, 10],
      curve_direction: 'decreasing',  // gain output decreases as cv rises (compression)
      output_range: [0, 1.05],         // gain ∈ [0, 1] at unity, allow tiny float slack
    },
  },
};
