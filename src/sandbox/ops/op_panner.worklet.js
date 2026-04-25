// op_panner.worklet.js — Catalog #103 (Spatial family).
//
// Stereo pan law — three canonical curves selectable via `law`.
//
// PRIMARY: Roger Dannenberg / Richard Dobson, "Loudness Concepts & Panning
// Laws", CMU School of Music ICM online readings (accessed 2026-04-24):
//   https://www.cs.cmu.edu/~music/icm-online/readings/panlaws/index.html
//
// Passages quoted verbatim (θ ∈ [0, π/2], θ=0 hard-L, θ=π/4 center, θ=π/2 hard-R):
//
//   LINEAR:        L(θ) = (π/2 − θ) · 2/π
//                  R(θ) =      θ    · 2/π
//                  Center gain: 0.5 each (−6 dB dip).
//
//   CONSTANT POWER (−3 dB):
//                  L(θ) = cos(θ)
//                  R(θ) = sin(θ)
//                  "power is proportional to the squared amplitude, and
//                   cos² + sin² = 1"
//                  Center gain: cos(π/4) = sin(π/4) ≈ 0.7071 (0 dB power).
//
//   −4.5 dB COMPROMISE:
//                  L(θ) = √((π/2 − θ) · 2/π · cos(θ))
//                  R(θ) = √(    θ      · 2/π · sin(θ))
//                  Center gain: ≈ 0.59 each.
//                  Geometric mean of linear × constant-power curves;
//                  compromise between equal-amplitude and equal-power.
//
// USER-FACING PAN MAPPING (DAW-standard):
//   pan ∈ [-1, +1], 0 = center → θ = (pan + 1) · π/4.
//
// STEREO `in2` HANDLING: mono-sum pre-pan at ×0.5 scalar (same design pick
// as #105 haas; see that op's debt (j) for sumLaw debate). The panner is a
// mono-to-stereo operator by spec; stereo-input handling is a UX convenience.
//
// NOT in scope (research debt):
//   · Balance-mode (stereo-in, attenuate far channel only) — distinct op.
//   · Blumlein 1931 UK Patent 394,325 primary audit.
//   · VBAP / DBAP multi-speaker generalizations (Pulkki 1997, Lossius 2009).
//   · ITD+ILD head-model panning.
//   · Log/dB-taper pan curve alternatives beyond the three canonical laws.

const TWO_OVER_PI = 2 / Math.PI;

export class PannerOp {
  static opId = 'panner';
  static inputs = Object.freeze([
    { id: 'in',  kind: 'audio' },
    { id: 'in2', kind: 'audio', optional: true },
  ]);
  static outputs = Object.freeze([
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'pan', default: 0 },
    { id: 'law', default: 1 }, // 0 = linear, 1 = constant-power, 2 = -4.5 dB
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._pan = 0;
    this._law = 1;
    this._gL = Math.SQRT1_2;
    this._gR = Math.SQRT1_2;
    this._recomputeGains();
  }

  reset() { /* stateless */ }

  _recomputeGains() {
    // pan ∈ [-1, +1] → θ ∈ [0, π/2]
    const theta = (this._pan + 1) * (Math.PI / 4);
    let gL, gR;
    switch (this._law) {
      case 0: // linear
        gL = (Math.PI / 2 - theta) * TWO_OVER_PI;
        gR = theta * TWO_OVER_PI;
        break;
      case 2: // -4.5 dB compromise (geometric mean)
        gL = Math.sqrt((Math.PI / 2 - theta) * TWO_OVER_PI * Math.cos(theta));
        gR = Math.sqrt(theta * TWO_OVER_PI * Math.sin(theta));
        break;
      case 1: // constant-power (default)
      default:
        gL = Math.cos(theta);
        gR = Math.sin(theta);
        break;
    }
    this._gL = gL;
    this._gR = gR;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'pan': this._pan = Math.max(-1, Math.min(1, v)); this._recomputeGains(); break;
      case 'law': this._law = Math.max(0, Math.min(2, v | 0)); this._recomputeGains(); break;
    }
  }

  process(inputs, outputs, N) {
    const inA = inputs && inputs.in  ? inputs.in  : null;
    const inB = inputs && inputs.in2 ? inputs.in2 : null;
    const lOut = outputs && outputs.l ? outputs.l : null;
    const rOut = outputs && outputs.r ? outputs.r : null;
    if (!lOut && !rOut) return;

    const gL = this._gL, gR = this._gR;

    for (let n = 0; n < N; n++) {
      const a = inA ? inA[n] : 0;
      const b = inB ? inB[n] : 0;
      const x = inB ? (a + b) * 0.5 : a;
      if (lOut) lOut[n] = x * gL;
      if (rOut) rOut[n] = x * gR;
    }
  }

  getLatencySamples() { return 0; }
}
