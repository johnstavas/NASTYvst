// op_abs.worklet.js — Stage-3 op sidecar for the `abs` op.
//
// Catalog #89 (Control primitives). Absolute value: out = |x|.
//
// USES
//
//   - Odd-symmetric character curves: pair with `sign` to split a signal
//     into magnitude and polarity, run magnitude through any one-sided
//     transfer (curve, saturate, shelf...), then multiply polarity back in.
//     This is how analog |x|^γ tone-shaping is reproduced cleanly.
//
//   - Full-wave rectification for detection: |x| is the rectifier feeding
//     the envelope/peak/rms ops in most VU/compressor topologies. The
//     detector op already rectifies internally; abs is the exposed
//     primitive for user-built detectors.
//
//   - Polarity-symmetric FB coupling: |fbTap| keeps a feedback return
//     sign-agnostic so clamp/softLimit operate on magnitude alone.
//
// Research: trivial. NaN is preserved (Math.abs(NaN) === NaN) — unlike
// `sign` which collapses NaN to 0, abs is a pure magnitude operator and
// callers downstream are expected to handle NaN via clamp/gate if needed.
// -0 → +0 (JS IEEE-754 semantics of Math.abs).
//
// Stateless. No denormal concern (output is always ≥ 0; if |x| is
// denormal, the downstream denormal flush in the chain handles it —
// abs itself does NOT flush, because doing so would corrupt a meter
// reading a genuinely tiny-but-real signal).

export class AbsOp {
  static opId = 'abs';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
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
      // Use Math.abs — handles -0 → +0 correctly (a manual `x < 0 ? -x : x`
      // leaves -0 intact because `-0 < 0` is false in IEEE-754). V8 inlines
      // Math.abs to a single VABS / ANDPS, so this is also optimal.
      outCh[i] = Math.abs(inCh[i]);
    }
  }
}
