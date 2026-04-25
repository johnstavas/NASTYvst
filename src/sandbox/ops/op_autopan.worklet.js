// op_autopan.worklet.js — Catalog #104 (Spatial family).
//
// Autopanner — LFO-driven stereo pan, using the constant-power pan law.
//
// PRIMARIES (both previously opened for sibling ops):
//   · Pan law: Dannenberg/Dobson "Loudness Concepts & Panning Laws"
//     (CMU ICM online readings, https://www.cs.cmu.edu/~music/icm-online/
//     readings/panlaws/index.html). Formulas in op_panner.worklet.js header.
//   · AM / LFO modulation: Puckette, *Theory and Technique of Electronic
//     Music* §5.2 "Multiplying audio signals" (DRAFT, openly hosted at
//     newblankets.org/worth_a_look/puckette_book.pdf). Verbatim from §5.2:
//
//       "multiply two sinusoids and you get a result with two partials, one
//        at the sum of the two original frequencies, and one at their
//        difference"
//
//       carrier · modulator form:  [2a cos(ωn)] · [cos(ξn)]
//
//     When ω (modulator) is sub-audio (< 20 Hz), sidebands fall below
//     hearing and the result is perceived as time-varying gain (tremolo
//     for mono, autopan for stereo when L/R are modulated in antiphase).
//
// DSP: MATH-BY-DEFINITION composition of the two primaries. The op is
// equivalent to `#11 lfo → #103 panner.pan`, shipped as a single node
// because:
//   (a) external callers expect an atomic "autopan" effect;
//   (b) the LFO and pan both live in the same worklet, so composing them
//       here avoids an extra control-rate scheduling hop;
//   (c) the constant-power gain pair is recomputed per-sample (not block-
//       rate like #103 panner), so there's no zipper on fast rates.
//
// TOPOLOGY per sample:
//   phase += 2π · rateHz / sr                     // wrap [0, 2π)
//   lfo    = shape(phase)                          // ∈ [-1, +1]
//   θ      = π/4 · (1 + depth · lfo)               // ∈ [0, π/2] at depth=1
//   gL     = cos θ                                 // constant-power pair
//   gR     = sin θ
//   L      = x · gL
//   R      = x · gR
//
// SHAPES:
//   0 = sine      sin(phase)
//   1 = triangle  1 − 4·|phase/(2π) − 0.5|   (range ±1, linear rate)
//   2 = square    phase < π ? +1 : −1         (hard L↔R flip)
//
// PARAMS
//   rateHz    — LFO rate               [0.01, 20]  default 1   Hz
//   depth     — pan sweep amount       [0, 1]      default 1
//   shape     — LFO waveform enum      {0,1,2}     default 0   (sine)
//   phaseDeg  — initial phase offset   [0, 360]    default 0
//
// OUTPUTS (audio-rate): l, r
//
// NOT in scope (research debt):
//   · BPM-sync (host transport lookup).
//   · Stereo input = proper stereo autopan (L and R independently panned).
//   · Ramp-on-shape-change (avoids click when switching waveforms mid-run).
//   · Band-limited square/triangle (MinBLEP from Canon:synthesis §13).

const TWO_PI = Math.PI * 2;
const PI_OVER_4 = Math.PI / 4;

export class AutopanOp {
  static opId = 'autopan';
  static inputs = Object.freeze([
    { id: 'in',  kind: 'audio' },
    { id: 'in2', kind: 'audio', optional: true },
  ]);
  static outputs = Object.freeze([
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'rateHz',   default: 1   },
    { id: 'depth',    default: 1   },
    { id: 'shape',    default: 0   },
    { id: 'phaseDeg', default: 0   },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._rateHz   = 1;
    this._depth    = 1;
    this._shape    = 0;
    this._phaseDeg = 0;
    this._phase = 0;  // [0, 2π)
    this._recomputePhase();
  }

  _recomputePhase() {
    // Apply phaseDeg as an initial offset; user calls reset() to re-seed.
    this._phase = ((this._phaseDeg / 360) * TWO_PI) % TWO_PI;
    if (this._phase < 0) this._phase += TWO_PI;
  }

  reset() { this._recomputePhase(); }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'rateHz':   this._rateHz   = Math.max(0.01, Math.min(20,  v)); break;
      case 'depth':    this._depth    = Math.max(0,    Math.min(1,   v)); break;
      case 'shape':    this._shape    = Math.max(0,    Math.min(2,   v | 0)); break;
      case 'phaseDeg': this._phaseDeg = Math.max(0,    Math.min(360, v)); break;
    }
  }

  _lfo(phase) {
    switch (this._shape) {
      case 1: { // triangle
        const p = phase / TWO_PI; // [0,1)
        return 1 - 4 * Math.abs(p - 0.5);
      }
      case 2: // square
        return phase < Math.PI ? 1 : -1;
      case 0:
      default: // sine
        return Math.sin(phase);
    }
  }

  process(inputs, outputs, N) {
    const inA = inputs && inputs.in  ? inputs.in  : null;
    const inB = inputs && inputs.in2 ? inputs.in2 : null;
    const lOut = outputs && outputs.l ? outputs.l : null;
    const rOut = outputs && outputs.r ? outputs.r : null;
    if (!lOut && !rOut) return;

    const phaseInc = TWO_PI * this._rateHz / this.sr;
    const depth = this._depth;
    let phase = this._phase;

    for (let n = 0; n < N; n++) {
      const a = inA ? inA[n] : 0;
      const b = inB ? inB[n] : 0;
      const x = inB ? (a + b) * 0.5 : a;

      const lfo = this._lfo(phase);
      const theta = PI_OVER_4 * (1 + depth * lfo);
      const gL = Math.cos(theta);
      const gR = Math.sin(theta);
      if (lOut) lOut[n] = x * gL;
      if (rOut) rOut[n] = x * gR;

      phase += phaseInc;
      if (phase >= TWO_PI) phase -= TWO_PI;
    }
    this._phase = phase;
  }

  getLatencySamples() { return 0; }
}
