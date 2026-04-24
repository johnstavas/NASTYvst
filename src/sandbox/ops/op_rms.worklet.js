// op_rms.worklet.js — Stage-3 op sidecar for the `rms` op.
//
// Catalog #50 (Loudness/Metering family). Second op in the 49–56 block.
// Canon:loudness §1 / Canon:dynamics §3 (windowed RMS).
//
// What it does:
//   Reads the root-mean-square level of an audio stream using a one-pole
//   power averager (exponential window), then emits sqrt of the running
//   mean-square as a control-rate signal. This is the canonical way to
//   read "how loud has this signal been over the last few hundred ms,"
//   and it's the building block for:
//     - VU meters (window ≈ 300 ms)
//     - RMS compressors (side-chain detector)
//     - #52 lufsIntegrator (K-weighted RMS over a 400 ms momentary window)
//
// Math (one-pole mean-square averager):
//
//   α  = exp(−1 / (τ · Fs))              (pole radius; τ = window seconds)
//   p[n] = (1 − α)·x[n]² + α·p[n−1]      (running mean-square, "power")
//   y[n] = sqrt(p[n])                    (output = RMS magnitude)
//
// Why one-pole (not rectangular boxcar):
//   - O(1) state vs. O(window-samples) ring buffer.
//   - Smooth ballistics (no discontinuity when a sample leaves the window).
//   - Matches analog VU-meter RC integrators physically — a capacitor in
//     parallel with a resistor is literally this filter.
//   - Equivalent-rectangular-window at τ is ≈ 2τ of boxcar average.
//
// Distinct from neighbors:
//   #3 detector (rms mode)  — stateless x², no averaging
//   #49 peak                — peak-hold ballistics (instant attack + release)
//   #50 rms (this op)       — windowed RMS, square-rooted
//   #52 lufsIntegrator      — kWeighting → rms → gate, absolute loudness
//
// Stability:
//   - `window` clamped to [1, 30000] ms.
//   - Mean-square is always ≥ 0, so sqrt is safe. A tiny negative residual
//     from float rounding is possible; we clamp at 0 before sqrt to avoid NaN.
//   - Denormal flush on the power state (Canon:utilities §1). Silent tails
//     with x² ≈ 1e-38 stall x86 CPUs without FTZ — the cheap branch kills it.

const DENORMAL = 1e-30;

export class RmsOp {
  static opId = 'rms';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'rms', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'window', default: 300 },   // ms, one-pole τ
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._window = 300;
    this._alpha  = 0;   // pole radius
    this._oma    = 1;   // (1 − α)
    this._p      = 0;   // running mean-square
    this._recomputeCoefs();
  }

  reset() {
    this._p = 0;
  }

  setParam(id, v) {
    if (id === 'window') {
      this._window = +v;
      this._recomputeCoefs();
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    // Clamp into musical range.
    const wMs  = Math.min(Math.max(this._window, 1), 30000);
    const tau  = wMs * 0.001;
    // α = exp(−1 / (τ · Fs)). At τ → 0, α → 0 (no smoothing);
    // at τ → ∞, α → 1 (infinite smoothing).
    this._alpha = Math.exp(-1 / (tau * this.sr));
    this._oma   = 1 - this._alpha;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.rms;
    if (!outCh) return;
    if (!inCh) {
      // No input → decay the running power through the averager.
      // Matches expected meter behavior: source drops out → meter falls
      // over the window time, doesn't blank instantly.
      let p = this._p;
      const a = this._alpha;
      for (let i = 0; i < N; i++) {
        p *= a;
        if (p < DENORMAL) p = 0;
        outCh[i] = Math.sqrt(p);
      }
      this._p = p;
      return;
    }
    const a   = this._alpha;
    const oma = this._oma;
    let   p   = this._p;

    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      p = oma * (x * x) + a * p;
      if (p < DENORMAL) p = 0;
      // Float rounding can leave p a whisker below 0; clamp for sqrt safety.
      outCh[i] = p > 0 ? Math.sqrt(p) : 0;
    }
    this._p = p;
  }
}
