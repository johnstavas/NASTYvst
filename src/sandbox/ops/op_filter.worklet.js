// op_filter.worklet.js — Stage-3 op sidecar for the `filter` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Biquad (LP / HP / BP / notch), resonant. Coefficients per the RBJ Audio
// EQ Cookbook (Robert Bristow-Johnson; memory/dsp_code_canon_filters.md §9)
// — the same topology WebAudio's createBiquadFilter uses internally, so
// porting lands sample-identical numerical behavior with compileGraphToWebAudio.
//
// Topology: Direct Form I.
//   y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
//
// Stability guards:
//   - cutoff clamped to [10, sr/2 - 100] before the pre-warp;
//   - Q clamped to [1e-3, 40] (below 1e-3 alpha collapses; above ~40 the
//     resonance is self-oscillating and unstable under small coefficient
//     quantisation). Matches WebAudio's documented ranges.
//
// Source of truth cross-reference:
//   compileGraphToWebAudio.js `filter()` factory (delegates to WebAudio
//   BiquadFilterNode). Canon:filters §9 for the coefficient derivations.

const MODES = ['lp', 'hp', 'bp', 'notch'];

export class FilterOp {
  static opId = 'filter';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'mode',   default: 'lp' },
    { id: 'cutoff', default: 1000 },
    { id: 'q',      default: 0.707 },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._mode   = 'lp';
    this._cutoff = 1000;
    this._q      = 0.707;
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
    if (id === 'mode')   { this._mode = MODES.includes(v) ? v : 'lp'; }
    if (id === 'cutoff') { this._cutoff = +v; }
    if (id === 'q')      { this._q = +v; }
    this._recomputeCoefs();
  }

  getLatencySamples() { return 0; }

  // RBJ cookbook biquad — Canon:filters §9.
  // a0 is factored out; stored coefficients are already normalised.
  _recomputeCoefs() {
    const sr     = this.sr;
    const nyq    = 0.5 * sr - 100;
    const f0     = Math.min(Math.max(this._cutoff, 10), nyq);
    const Q      = Math.min(Math.max(this._q, 1e-3), 40);
    const w0     = 2 * Math.PI * f0 / sr;
    const cosw0  = Math.cos(w0);
    const sinw0  = Math.sin(w0);
    const alpha  = sinw0 / (2 * Q);

    let b0, b1, b2, a0, a1, a2;
    switch (this._mode) {
      case 'hp':
        b0 =  (1 + cosw0) * 0.5;
        b1 = -(1 + cosw0);
        b2 =  (1 + cosw0) * 0.5;
        a0 =   1 + alpha;
        a1 =  -2 * cosw0;
        a2 =   1 - alpha;
        break;
      case 'bp':
        // Constant-0-dB peak (skirt gain = Q).
        b0 =  alpha;
        b1 =  0;
        b2 = -alpha;
        a0 =  1 + alpha;
        a1 = -2 * cosw0;
        a2 =  1 - alpha;
        break;
      case 'notch':
        b0 =  1;
        b1 = -2 * cosw0;
        b2 =  1;
        a0 =  1 + alpha;
        a1 = -2 * cosw0;
        a2 =  1 - alpha;
        break;
      case 'lp':
      default:
        b0 =  (1 - cosw0) * 0.5;
        b1 =   1 - cosw0;
        b2 =  (1 - cosw0) * 0.5;
        a0 =   1 + alpha;
        a1 =  -2 * cosw0;
        a2 =   1 - alpha;
        break;
    }

    const inv_a0 = 1 / a0;
    this._b0 = b0 * inv_a0;
    this._b1 = b1 * inv_a0;
    this._b2 = b2 * inv_a0;
    this._a1 = a1 * inv_a0;
    this._a2 = a2 * inv_a0;
  }

  // inputs:  { in: Float32Array }
  // outputs: { out: Float32Array }
  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
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
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
      outCh[i] = y;
    }
    this._x1 = x1; this._x2 = x2;
    this._y1 = y1; this._y2 = y2;
  }
}
