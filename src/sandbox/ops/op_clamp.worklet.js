// op_clamp.worklet.js — Stage-3 op sidecar for the `clamp` op.
//
// Catalog #90 (Control primitives). Hard saturating limiter:
//   out = min(max(in, lo), hi)
//
// Role: control-path SAFETY / DOMAIN-GUARD primitive. NOT a distortion
// effect — the break corners are infinite-order sharp and alias severely
// on audio-rate signals. Use #12 saturate / #13 softLimit for musical
// clipping; reach for clamp when you need:
//
//   1. FB-loop runaway guard — feed a comp's envelope through clamp(0, 4)
//      to prevent coefficient blowup if a pathological signal hits
//      (ship_blockers.md: "FB runaway guard").
//   2. Param-domain wiring — WebAudio AudioParams silently ignore values
//      outside their declared range. Clamping upstream makes the final
//      value predictable.
//   3. Floor / ceiling gate — clamp(sig, floorDb, +∞) implements the
//      "noise floor" half of a gate without ballistics.
//
// Research: none — pair of std::min/std::max ops. Template still enforced:
//   - Bypass contract: signals already in [lo, hi] → bit-exact passthrough.
//   - Degenerate case: lo > hi → both sides collapse to `lo` (user error
//     visible in output, not silent).
//   - Stateless. No reset state. No denormal concern (min/max preserves 0).

export class ClampOp {
  static opId = 'clamp';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'lo', default: -1 },
    { id: 'hi', default:  1 },
  ]);

  constructor(sampleRate) {
    this.sr  = sampleRate;
    this._lo = -1;
    this._hi =  1;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'lo') this._lo = n;
    else if (id === 'hi') this._hi = n;
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    const lo = this._lo;
    const hi = this._hi;
    if (!inCh) {
      // No input: emit zero, clamped to bounds (mirrors "0 as the resting
      // value of a control line" semantics; if the user's domain excludes
      // 0 they see it pinned into [lo, hi]).
      const zc = 0 < lo ? lo : (0 > hi ? hi : 0);
      for (let i = 0; i < N; i++) outCh[i] = zc;
      return;
    }
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      // Branchless-friendly form; JIT typically emits minss/maxss.
      outCh[i] = x < lo ? lo : (x > hi ? hi : x);
    }
  }
}
