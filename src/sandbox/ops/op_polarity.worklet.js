// op_polarity.worklet.js — Stage-3 op sidecar for the `polarity` op.
//
// Catalog #30 (Control primitives). One-bit polarity switch:
//
//   invert = false → out = x           (pass-through)
//   invert = true  → out = −x          (polarity inverted)
//
// RATIONALE
//
// A semantically named, switchable phase-flip. Could be expressed as
// scaleBy(k = ±1), and early sandbox graphs did exactly that — but:
//
//   1. scaleBy is *linear*, intended for gain trims; using it as a
//      polarity switch reads as an amplitude reduction by someone
//      inspecting the graph. polarity reads as what it is.
//   2. A bool is the right control type for this: consoles and DAWs
//      all expose polarity as a button, not a knob. A scaleBy(-1) is
//      a knob whose integer values happen to flip polarity — wrong
//      affordance at the UI level.
//   3. polarity is gain-lossless by construction: inverting a float
//      flips the sign bit (an XOR on the MSB) with zero precision
//      loss. scaleBy(-1) technically does the same on IEEE-754 but
//      reads like a multiplication, and JIT inliners won't always
//      prove the unity-magnitude property.
//
// USES
//
//   - Mid/Side return matching: polarity-flip the S channel before
//     decoding back to L/R if upstream processing accidentally
//     inverted it.
//   - Drum bus phase correction: kick bottom mic into polarity flip
//     before summing with top mic.
//   - Parallel-processing nulling: dry - wet = dry + polarity(wet),
//     the canonical null-test routing.
//   - Stereo imaging: flipping only one channel's polarity produces
//     pure side content (mid cancels). Same trick drives #57
//     stereoWidth's pure-side target in its test.
//
// Stateless. Bit-exact output (just a sign flip). No denormal concern.

export class PolarityOp {
  static opId = 'polarity';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'invert', default: 0 },   // 0 = pass-through, 1 = invert
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._invert = false;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'invert') {
      // Accept any truthy number — 0/1 or false/true from graph.json.
      // NaN is coerced to false (pass-through) by the !! idiom.
      this._invert = !!(+v);
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
    if (this._invert) {
      for (let i = 0; i < N; i++) outCh[i] = -inCh[i];
    } else {
      // Pass-through. Do NOT alias — the emitter's downstream topology
      // expects a distinct output buffer, and an audio graph may have
      // an in-place rewrite pass later that depends on ownership.
      for (let i = 0; i < N; i++) outCh[i] = inCh[i];
    }
  }
}
