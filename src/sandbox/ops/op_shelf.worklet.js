// op_shelf.worklet.js — Stage-3 op sidecar for the `shelf` op.
//
// Low/high shelf EQ. Completes the tone-shaping primitive set alongside
// `filter` (LP/HP/BP/notch). Authors get the full RBJ family without
// having to gang two biquads manually for tilt/tone controls.
//
// Math: RBJ Audio EQ Cookbook shelving formulas (Robert Bristow-Johnson;
//   memory/dsp_code_canon_filters.md §9). Same cookbook as op_filter.js;
//   same DF1 topology; coefficient derivations below.
//
// Topology: Direct Form I.
//   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
//
// Design choices:
//   - Shelf slope S fixed at 1 (Butterworth-equivalent Q for shelves).
//     RBJ: alpha = sin(w0)/2 · sqrt((A + 1/A)(1/S − 1) + 2).
//     At S=1, alpha = sin(w0)/2 · sqrt(2) = sin(w0)/sqrt(2).
//     This matches WebAudio BiquadFilterNode's internal S=1 default —
//     porting to compileGraphToWebAudio lands sample-identical behavior.
//   - gainDb = 0 → full passthrough (b0=1, rest=0 effectively after
//     normalisation). Intentionally transparent at the default so that
//     inserting a shelf with gainDb=0 is a no-op — critical for the
//     bypass contract (ship_blockers.md).
//
// Stability:
//   - freq clamped to [10, sr/2 − 100] before pre-warp.
//   - gainDb not clamped here (registry caps at ±24); RBJ shelves remain
//     stable across the full audio gain range.
//   - Denormal flush on output state (Canon:utilities §1): when |y| drops
//     below 1e-30 the state is snapped to 0 to prevent subnormal-stall
//     CPU spikes in long-tail silence.

const MODES = ['low', 'high'];
const DENORMAL = 1e-30;

export class ShelfOp {
  static opId = 'shelf';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'mode',   default: 'low' },
    { id: 'freq',   default: 200 },
    { id: 'gainDb', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._mode    = 'low';
    this._freq    = 200;
    this._gainDb  = 0;
    // DF1 state — 2-sample history for input + output.
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
    // Normalised coefficients (after dividing by a0).
    this._b0 = 1; this._b1 = 0; this._b2 = 0;
    this._a1 = 0; this._a2 = 0;
    this._recomputeCoefs();
  }

  reset() {
    this._x1 = this._x2 = this._y1 = this._y2 = 0;
  }

  setParam(id, v) {
    if (id === 'mode')   { this._mode = MODES.includes(v) ? v : 'low'; }
    if (id === 'freq')   { this._freq = +v; }
    if (id === 'gainDb') { this._gainDb = +v; }
    this._recomputeCoefs();
  }

  getLatencySamples() { return 0; }

  // RBJ cookbook shelving biquad — Canon:filters §9.
  _recomputeCoefs() {
    const sr    = this.sr;
    const nyq   = 0.5 * sr - 100;
    const f0    = Math.min(Math.max(this._freq, 10), nyq);
    // A = 10^(gainDb/40) — amplitude for a shelf whose plateau is gainDb.
    const A     = Math.pow(10, this._gainDb / 40);
    const w0    = 2 * Math.PI * f0 / sr;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    // S = 1 (Butterworth shelf slope) → alpha = sinw0 / sqrt(2).
    const alpha = sinw0 * Math.SQRT1_2;
    const twoSqrtA_alpha = 2 * Math.sqrt(A) * alpha;

    let b0, b1, b2, a0, a1, a2;
    if (this._mode === 'high') {
      b0 =    A * ((A + 1) + (A - 1) * cosw0 + twoSqrtA_alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 =    A * ((A + 1) + (A - 1) * cosw0 - twoSqrtA_alpha);
      a0 =        (A + 1) - (A - 1) * cosw0 + twoSqrtA_alpha;
      a1 =    2 * ((A - 1) - (A + 1) * cosw0);
      a2 =        (A + 1) - (A - 1) * cosw0 - twoSqrtA_alpha;
    } else {
      // low shelf
      b0 =    A * ((A + 1) - (A - 1) * cosw0 + twoSqrtA_alpha);
      b1 =  2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 =    A * ((A + 1) - (A - 1) * cosw0 - twoSqrtA_alpha);
      a0 =        (A + 1) + (A - 1) * cosw0 + twoSqrtA_alpha;
      a1 =   -2 * ((A - 1) + (A + 1) * cosw0);
      a2 =        (A + 1) + (A - 1) * cosw0 - twoSqrtA_alpha;
    }

    const inv_a0 = 1 / a0;
    this._b0 = b0 * inv_a0;
    this._b1 = b1 * inv_a0;
    this._b2 = b2 * inv_a0;
    this._a1 = a1 * inv_a0;
    this._a2 = a2 * inv_a0;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    let x1 = this._x1, x2 = this._x2;
    let y1 = this._y1, y2 = this._y2;
    const b0 = this._b0, b1 = this._b1, b2 = this._b2;
    const a1 = this._a1, a2 = this._a2;
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      // Canon:utilities §1 denormal flush.
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
      outCh[i] = y;
    }
    this._x1 = x1; this._x2 = x2;
    this._y1 = y1; this._y2 = y2;
  }
}
