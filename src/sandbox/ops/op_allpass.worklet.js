// op_allpass.worklet.js — Stage-3 op sidecar for the `allpass` op.
//
// Catalog #16 (Space family). First-order allpass. Unity magnitude at
// every frequency; phase is frequency-dependent (crosses −π/2 at the
// break frequency). Foundational building block for:
//   - Schroeder / Freeverb-style reverb diffusion (cascade N stages)
//   - Phasers (cascade N stages, modulate `freq` with an LFO)
//   - Polyphase halfband filters (oversample2x, #12)
//
// Math: Canon:filters (1st-order allpass, DAFX §5.2).
//
//   break-frequency mapping (bilinear-transformed pole):
//     t = tan(π · fc / Fs)
//     a = (t − 1) / (t + 1)        (allpass coefficient, |a| < 1)
//
//   transfer function:
//     H(z) = (a + z⁻¹) / (1 + a·z⁻¹)
//
//   diff eq:     y[n] + a·y[n−1] = a·x[n] + x[n−1]
//   arranged:    y[n] = a · (x[n] − y[n−1]) + x[n−1]
//
// The arranged form is the canonical efficient implementation — one
// multiply, two adds, two stored samples. Same topology Freeverb and
// Gardner's Schroeder sections use.
//
// Why it's "allpass":
//   |H(e^jω)| = 1 ∀ ω  ←— magnitude is exactly unity at every frequency.
//   H(1)  = (a+1)/(1+a) = 1         (DC: unity, zero phase)
//   H(−1) = (a−1)/(1−a) = −1        (Nyquist: unity mag, π phase flip)
//
// Stability:
//   - |a| < 1 for all fc ∈ (0, Nyquist), so the pole is always inside
//     the unit circle — unconditionally stable.
//   - freq clamped to [1, Nyquist − 100] for safety.
//   - Denormal flush on y-state (Canon:utilities §1).

const DENORMAL = 1e-30;

export class AllpassOp {
  static opId = 'allpass';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'freq', default: 1000 },
  ]);

  constructor(sampleRate) {
    this.sr    = sampleRate;
    this._freq = 1000;
    this._a    = 0;   // allpass coefficient
    this._x1   = 0;   // x[n-1]
    this._y1   = 0;   // y[n-1]
    this._recomputeCoefs();
  }

  reset() {
    this._x1 = 0;
    this._y1 = 0;
  }

  setParam(id, v) {
    if (id === 'freq') {
      this._freq = +v;
      this._recomputeCoefs();
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    const sr  = this.sr;
    const nyq = 0.5 * sr - 100;
    const fc  = Math.min(Math.max(this._freq, 1), nyq);
    const t   = Math.tan(Math.PI * fc / sr);
    this._a   = (t - 1) / (t + 1);
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const a = this._a;
    let x1 = this._x1;
    let y1 = this._y1;
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      // y[n] = a · (x[n] − y[n−1]) + x[n−1]
      let y = a * (x - y1) + x1;
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      x1 = x;
      y1 = y;
      outCh[i] = y;
    }
    this._x1 = x1;
    this._y1 = y1;
  }
}
