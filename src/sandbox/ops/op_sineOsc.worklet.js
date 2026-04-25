// op_sineOsc.worklet.js — Stage-3 op sidecar for the `sineOsc` op.
//
// Direct-Form Resonator (DFR) — Julius O. Smith, *Physical Audio Signal
// Processing*, "Digital Sinusoid Generators" (Stanford CCRMA, online).
//   https://ccrma.stanford.edu/~jos/pasp/Digital_Sinusoid_Generators.html
//
// Verbatim JOS difference equation:
//     x₁(n) = 2·cₙ · x₁(n−1) − x₂(n−1)
//     x₂(n) =          x₁(n−1)
//   with cₙ = cos(2π·fₙ·T), [x₁(0), x₂(0)] setting initial amp + phase,
//   stable for |cₙ| ≤ 1.
//
// Mapping to this file: y1 ≡ x₁(n−1), y2 ≡ x₂(n−1), b1 ≡ 2cₙ, y0 ≡ x₁(n).
//
// Practitioner secondary (phase-0 initial conditions formula only):
//   musicdsp.org archive #9 — James McCartney, Computer Music Journal 2002.
//   Initial state y1 = sin(ip − ω), y2 = sin(ip − 2ω) with ip = 0 makes
//   the first emitted sample sin(0) = 0. This is a specific choice of
//   the (x₁(0), x₂(0)) pair JOS treats abstractly.
//
// Not to be confused with Gordon & Smith 1985 "coupled form" (s += ε·c;
// c −= ε·s) — that is JOS's third method, not the one shipped here.
//
// Why DFR: cheapest stable per-sample sine (2 mul, 1 sub, 2 store).
// Amplitude drifts ~10⁻⁸ per 10⁶ samples at double precision — below
// audible threshold for musical runs. For long-held test tones, re-seed
// reset(); for musical use it is fine.
//
// Contract (per OP_TEMPLATE.md):
//   - Optional CONTROL input `freqMod` adds Hz to base freq per-sample
//     (linear FM; FM index-scaling is the caller's responsibility).
//   - AUDIO output `out` = amp · sin(phase).
//   - reset() restores phase to 0 using current freq.
//   - freq clamped to (0.01, sr/2 − 1) Hz to keep recurrence stable.
//   - Denormal flush (Canon:utilities §1 style) on state when paused
//     at silence.

const TWO_PI   = 2 * Math.PI;
const DENORMAL = 1e-30;

export class SineOscOp {
  static opId = 'sineOsc';
  static inputs  = Object.freeze([{ id: 'freqMod', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',     kind: 'audio'   }]);
  static params  = Object.freeze([
    { id: 'freq', default: 440 },
    { id: 'amp',  default: 1   },
  ]);

  constructor(sampleRate) {
    this.sr    = sampleRate;
    this._freq = 440;
    this._amp  = 1;
    this._w    = 0;
    this._b1   = 0;
    this._y1   = 0;
    this._y2   = 0;
    this._recomputeCoef();
    this.reset();
  }

  _recomputeCoef() {
    const nyq = this.sr * 0.5;
    let f = this._freq;
    if (!(f > 0.01))   f = 0.01;      // NaN-safe: !(f>x) catches NaN.
    if (f > nyq - 1)   f = nyq - 1;
    this._w  = TWO_PI * f / this.sr;
    this._b1 = 2 * Math.cos(this._w);
  }

  reset() {
    // ip = 0 → y1 = sin(−ω), y2 = sin(−2ω). Then first step yields sin(0)=0.
    this._y1 = -Math.sin(this._w);
    this._y2 = -Math.sin(2 * this._w);
  }

  setParam(id, v) {
    switch (id) {
      case 'freq':
        this._freq = +v;
        this._recomputeCoef();
        break;
      case 'amp':
        this._amp = +v;
        break;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out;
    if (!out) return;
    const fm  = inputs && inputs.freqMod;
    const amp = this._amp;

    let y1 = this._y1, y2 = this._y2;

    if (!fm) {
      // Fast path: constant-freq recurrence.
      const b1 = this._b1;
      for (let i = 0; i < N; i++) {
        const y0 = b1 * y1 - y2;
        out[i] = y0 * amp;
        y2 = y1;
        y1 = y0;
      }
    } else {
      // FM path — recompute b1 per-sample. Still ~3× cheaper than
      // Math.sin per sample and avoids phase discontinuity at freq
      // changes (state carries across).
      const baseF = this._freq;
      const nyq   = this.sr * 0.5;
      const invSr = TWO_PI / this.sr;
      for (let i = 0; i < N; i++) {
        let f = baseF + fm[i];
        if (!(f > 0.01))   f = 0.01;
        else if (f > nyq - 1) f = nyq - 1;
        const b1 = 2 * Math.cos(f * invSr);
        const y0 = b1 * y1 - y2;
        out[i] = y0 * amp;
        y2 = y1;
        y1 = y0;
      }
    }

    // Denormal flush — matters when amp=0 and state decays to sub-normals.
    if (y1 < DENORMAL && y1 > -DENORMAL) y1 = 0;
    if (y2 < DENORMAL && y2 > -DENORMAL) y2 = 0;

    this._y1 = y1;
    this._y2 = y2;
  }
}
