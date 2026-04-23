// op_filter.worklet.js — Stage-3 op sidecar for the `filter` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Biquad (LP/HP/BP/notch, resonant). Stub today: shape locked, inner loop
// zeros. Real implementation will use RBJ cookbook biquad coefficients
// (dsp_code_canon_filters.md §9) — same topology WebAudio's createBiquadFilter
// uses internally, so porting lands sample-identical numerical behavior.
//
// Source of truth for the real implementation (when we fill it in):
//   compileGraphToWebAudio.js `filter()` factory (delegates to WebAudio
//   BiquadFilterNode), plus Canon:filters §9 for the explicit coefficients.

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
    this.sr   = sampleRate;
    this._mode = 'lp';
    this._cutoff = 1000;
    this._q      = 0.707;
    // Biquad state — 2-sample history for input + output.
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
    // Coefficients (b0, b1, b2, a1, a2) — recomputed on param change.
    this._b0 = 1; this._b1 = 0; this._b2 = 0;
    this._a1 = 0; this._a2 = 0;
  }

  reset() {
    this._x1 = this._x2 = this._y1 = this._y2 = 0;
  }

  setParam(id, v) {
    if (id === 'mode')   this._mode = v;
    if (id === 'cutoff') this._cutoff = v;
    if (id === 'q')      this._q = v;
    // TODO(stage-3a): recompute RBJ coefficients on param change.
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const outCh = outputs.out;
    for (let i = 0; i < N; i++) outCh[i] = 0;
    // TODO(stage-3a): port RBJ biquad inner loop.
  }
}
