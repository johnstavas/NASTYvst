// op_softLimit.worklet.js — Stage-3 op sidecar for the `softLimit` op.
//
// Soft peak limiter. SHIP-CRITICAL companion to `dcBlock` for feedback-loop
// safety: drop inline on any FB return where a transient could push the
// loop toward runaway, and the output stays bounded to ±threshold without
// the harsh edge of a hard clip.
//
// Math: threshold-scaled Padé rational tanh per
//   memory/dsp_code_canon_character.md §11 (musicdsp 238 + batch1 §3).
//
//   padé(u) = u · (27 + u²) / (27 + 9u²)       on u ∈ [-3, 3]
//   padé(u) = sign(u)                          for |u| > 3   (hard clip)
//   y = T · padé(x / T)
//
// Why Padé not tanh():
//   - Canon §11 prescribes rational Padé as the default tanh substitute
//     (~2.6% error, C² continuous at ±3, no audible discontinuity).
//   - Branchless sign + rational — single-precision fast on any target.
//   - Matches the same form used in analog-model NL stages (ladder diff-
//     amp, tube saturation) so authors can re-use softLimit as a
//     transparent drive stage in a pinch.
//
// NOT a character stage. Authors wanting drive / color should use
// `saturate` (tanh w/ drive + trim) — softLimit is a bounded ceiling.
//
// Stateless: no reset state, no denormal concern.

export class SoftLimitOp {
  static opId = 'softLimit';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'threshold', default: 0.95 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._threshold = 0.95;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'threshold') {
      // Registry clamps to [0.1, 1.8]; guard defensively anyway — a
      // threshold of 0 would collapse the Padé domain and divide by zero.
      this._threshold = Math.max(0.01, +v);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const T    = this._threshold;
    const invT = 1 / T;
    for (let i = 0; i < N; i++) {
      let u = inCh[i] * invT;
      if (u >  3) u =  3;
      else if (u < -3) u = -3;
      // Canon §11 Padé rational tanh.
      const u2 = u * u;
      outCh[i] = T * u * (27 + u2) / (27 + 9 * u2);
    }
  }
}
