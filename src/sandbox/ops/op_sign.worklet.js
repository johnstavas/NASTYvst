// op_sign.worklet.js — Stage-3 op sidecar for the `sign` op.
//
// Catalog #91 (Control primitives). Three-valued sign extractor:
//
//   out = +1  if x > 0
//         -1  if x < 0
//          0  if x == 0 (including -0, NaN collapses to 0)
//
// USES
//
//   - Odd-symmetric character curves: |x|^γ · sign(x)
//     (abs → curve(power γ) → multiply by sign → preserves polarity
//     through a one-sided transfer function).
//
//   - Crossover / zero-crossing detection: feed a control signal into
//     sign → downstream differentiator triggers on every sign flip.
//
//   - Polarity-aware FB routing: clamp(sig, lo, hi) cannot preserve
//     sign of an input whose magnitude differs per half; sign splits
//     the signal so each half can be processed separately.
//
// Research: none — exact semantics of Math.sign with the tweak that
// NaN → 0 (because a meter reading NaN should not imply polarity).
//
// Stateless. No denormal concern (output is -1, 0, or +1 exactly).

export class SignOp {
  static opId = 'sign';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
  }

  reset() { /* stateless */ }
  setParam(_id, _v) { /* no params */ }
  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      // Manual three-way: avoids Math.sign's -0 preservation AND maps NaN
      // to 0 (NaN comparisons are false → falls through all branches).
      outCh[i] = x > 0 ? 1 : (x < 0 ? -1 : 0);
    }
  }
}
