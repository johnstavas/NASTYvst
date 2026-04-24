// op_peak.worklet.js — Stage-3 op sidecar for the `peak` op.
//
// Catalog #49 (Loudness/Metering family). First op in the 49–56 block.
// Canon:loudness §1 — peak ballistics per IEC 60268-10 / BS.1770-5.
//
// What it does:
//   Reads the instantaneous peak magnitude of an audio stream and emits
//   a control-rate signal that tracks transients instantly and decays
//   exponentially during quiet passages. This is the unbiased sample-peak
//   reader — *not* true-peak (#54) and *not* RMS (#50).
//
// Math (Canon:loudness §1 / Canon:dynamics §2):
//
//   Instant attack:      if |x[n]| > y[n−1]:  y[n] = |x[n]|
//   Exponential release: else:                 y[n] = r · y[n−1]
//
//   release coefficient mapped from "60 dB fall time":
//     r = exp(ln(0.001) / (release_sec · Fs))
//       = exp(−6.907755 / (release_sec · Fs))
//
//   Rationale for 60 dB definition: it's the standards convention (IEC
//   60268-10, EBU R 68), matches what DAW meter specs publish ("1.7 s
//   Type I PPM"), and is monotonic — user turns "release" up, meter
//   visibly falls slower. The alternative (1/e time constant) would
//   technically be cleaner math but users don't calibrate meters in
//   time-constants, they calibrate them in "how long until it's gone."
//
// Distinct from neighboring ops:
//   #3 detector (peak mode)  — stateless |x|, no ballistics
//   #4 envelope              — AR shape, musical attack curve
//   #49 peak (this op)       — instant attack, exponential release, standards-aligned
//   #50 rms                  — windowed RMS energy
//   #54 truePeak             — 4× oversampled peak (BS.1770-5 Annex 2)
//
// Output is `control` kind: downstream envelope readers / meter drivers
// connect by reading the per-sample control buffer. At 48 kHz control-rate
// equals audio-rate here, which is intentional — meter ballistics must
// resolve individual transients at audio rate or they miss clips.
//
// Stability:
//   - `release` clamped to [1, 30000] ms. Below 1 ms the coefficient
//     would underflow float32; above 30 s the meter would appear frozen.
//   - Denormal flush on the held state (Canon:utilities §1). Long silent
//     passages leave tiny residual values that stall CPU without FTZ.

const LN_1E_MINUS_3 = -6.907755278982137;  // ln(0.001), 60 dB
const DENORMAL      = 1e-30;

export class PeakOp {
  static opId = 'peak';
  static inputs  = Object.freeze([{ id: 'in',   kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'peak', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'release', default: 400 },   // ms, 60 dB fall time
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._release = 400;
    this._rCoef   = 0;
    this._y1      = 0;   // held peak
    this._recomputeCoefs();
  }

  reset() {
    this._y1 = 0;
  }

  setParam(id, v) {
    if (id === 'release') {
      this._release = +v;
      this._recomputeCoefs();
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    // Clamp release into a sane audio-engineering range.
    const rMs    = Math.min(Math.max(this._release, 1), 30000);
    const rSec   = rMs * 0.001;
    // r such that y · r^(rSec·Fs) = y · 0.001 → 60 dB decay in rSec seconds.
    this._rCoef  = Math.exp(LN_1E_MINUS_3 / (rSec * this.sr));
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.peak;
    if (!outCh) return;
    if (!inCh) {
      // No input → bleed the held state down through release; don't slam to zero.
      // This matches the expectation that a meter keeps falling when the source
      // disconnects mid-song, rather than blanking instantly.
      let y = this._y1;
      const r = this._rCoef;
      for (let i = 0; i < N; i++) {
        y *= r;
        if (y < DENORMAL) y = 0;
        outCh[i] = y;
      }
      this._y1 = y;
      return;
    }
    const r = this._rCoef;
    let y   = this._y1;
    for (let i = 0; i < N; i++) {
      const ax = Math.abs(inCh[i]);
      // Instant attack (max hold), exponential release otherwise.
      y = ax > y ? ax : y * r;
      if (y < DENORMAL) y = 0;
      outCh[i] = y;
    }
    this._y1 = y;
  }
}
