// op_smooth.worklet.js — Stage-3 op sidecar for the `smooth` op.
//
// One-pole lowpass param smoother — zero-artifact param ramping.
// See opRegistry.js `smooth` entry and:
//   - memory/sandbox_modulation_roadmap.md § 4 item 4 (role)
//   - memory/sandbox_modulation_roadmap.md § 11.4 (time-constant tuning)
//   - memory/pasp_through_design_lens.md § I Gain (math: y = (1-α)y_prev + α·y_new)
//   - memory/pasp_through_design_lens.md § 938 (zipper anti-pattern)
//   - memory/dsp_code_canon_utilities.md § 1 (Jon Watte denormal — SHIP-CRITICAL)
//
// Distinct from `envelope` op:
//   - smooth   : symmetric one-pole LP on an arbitrary control value (param ramps)
//   - envelope : asymmetric attack/release on a rectified audio signal (dynamics)
//
// Math:
//   α = 1 − exp(−1 / (τ · sr))
//   y[n] = y[n-1] + α · (x[n] − y[n-1])
//
// Response: y → target with time constant τ seconds. Reaches (1 − 1/e) ≈ 63.2%
// of a step at n = τ·sr samples. Matches Web Audio `setTargetAtTime(target, τ)`.
//
// τ = 0 short-circuits to α = 1 → bit-exact passthrough.

const DENORMAL = 1e-30;

export class SmoothOp {
  static opId = 'smooth';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'time', default: 0.01 },   // τ in seconds
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._time  = 0.01;
    this._alpha = this._computeAlpha(0.01);
    this._y     = 0;
  }

  _computeAlpha(timeSec) {
    if (!(timeSec > 0)) return 1;                      // τ=0 → passthrough
    return 1 - Math.exp(-1 / (timeSec * this.sr));
  }

  reset() { this._y = 0; }

  setParam(id, v) {
    switch (id) {
      case 'time':
        this._time  = v < 0 ? 0 : +v;
        this._alpha = this._computeAlpha(this._time);
        break;
    }
  }

  getLatencySamples() { return 0; }

  // inputs:  { in?: Float32Array }
  // outputs: { out: Float32Array }
  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!inCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }

    const a = this._alpha;

    // α = 1 → passthrough fast path (also handles τ=0 bypass).
    if (a >= 1) {
      for (let i = 0; i < N; i++) outCh[i] = inCh[i];
      this._y = N > 0 ? inCh[N - 1] : this._y;
      return;
    }

    let y = this._y;
    for (let i = 0; i < N; i++) {
      y += a * (inCh[i] - y);
      // Jon Watte denormal flush — SHIP-CRITICAL per Canon:utilities §1.
      // IIR state can trap sub-normals on long decays toward zero.
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      outCh[i] = y;
    }
    this._y = y;
  }
}
