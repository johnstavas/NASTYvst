// op_constant.worklet.js — Stage-3 op sidecar for the `constant` op.
//
// Catalog #31 (Control primitives). Emits a user-set constant value
// onto every sample of a control-rate output:
//
//   out[n] = value   for all n
//
// RATIONALE
//
// A fixed-value "source" primitive. Useful wherever a graph needs to
// inject a DC bias, hold a downstream control input at a tunable
// constant, or stand in for an unwired mod source during A/B work.
//
// USES
//
//   - Threshold driver for compressors: feed a constant LUFS value
//     into a `combine (mode: add)` with a sidechain LUFS signal to
//     produce a threshold-shifted gain-reduction path.
//
//   - Mix default: a `mix` brick with the mod port fed by
//     constant(0.7) behaves as a fixed 70% wet. Swapping to an LFO
//     at design time uses the same socket.
//
//   - Stub-out during development: constant(0) plugged into an
//     unwired control input lets the rest of the graph still
//     validate/build without "hanging" inputs.
//
//   - Test fixtures: golden-vector harness uses constants to drive
//     parameters whose natural default is zero.
//
// VS. SMOOTH
//
// constant is NOT a ramped value. When setParam('value') fires, the
// output jumps in one sample to the new value. For click-free
// parameter changes, wrap constant in a `smooth` op downstream:
//   constant → smooth(τ=5ms) → target
//
// Stateless. No denormal concern (output is a user-controlled scalar;
// clipping to ±FLOOR here would corrupt the user's intent).

export class ConstantOp {
  static opId = 'constant';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'value', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._value = 0;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'value') {
      const n = +v;
      // Reject NaN and ±Infinity — downstream math assumes finite.
      // Silent ignore: caller keeps the previous valid value, which
      // matches the "sticky last-good" pattern used by other ops.
      if (!Number.isFinite(n)) return;
      this._value = n;
    }
  }

  getLatencySamples() { return 0; }

  process(_inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;
    const v = this._value;
    for (let i = 0; i < N; i++) outCh[i] = v;
  }
}
