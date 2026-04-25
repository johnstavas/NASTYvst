// op_busSum.worklet.js — Stage-3 op sidecar for the `busSum` op.
//
// Catalog #26 (Routing). 4-input unity-gain summing bus — explicit graph
// convergence node. Dual of op #16 `fanOut` (1→4 splitter).
//
// MATH-BY-DEFINITION primitive — declared per sandbox_op_ship_protocol.md.
// There is no paper for N-input summation: out = Σ inₖ.
//
// IN-REPO PRECEDENT (port shape):
//   src/sandbox/opRegistry.js fanOut entry — 4-port fixed convention.
//   Matched exactly here (4 in, 1 out) so busSum ∘ fanOut = identity for
//   any permutation of connected inputs.
//
// FORMULA:
//     out[n] = in0[n] + in1[n] + in2[n] + in3[n]
//
// DEVIATIONS FROM THE "pure math" form:
//   1. **Fixed 4 ports.** Sandbox shape-check requires static port lists.
//      A variadic form would need registry support we don't have. If a
//      user wires 3 sources, the 4th port is absent and contributes 0;
//      if they need >4, they cascade busSum instances.
//   2. **Unity gain — no −6 dB / −∞ normalization.** Summing analog/digital
//      audio buses are traditionally unity; mixers expose fader gain as a
//      separate control. Users who want N-input averaging chain a `scaleBy`
//      with 1/N downstream. Explicit rather than surprising.
//   3. **Missing-input = 0.** Matches msEncode / msDecode / comb / filter
//      convention — undefined input contributes zero.
//   4. **No denormals.** Pure add; no feedback, no recursion. No flush.

export class BusSumOp {
  static opId = 'busSum';
  static inputs  = Object.freeze([
    { id: 'in0', kind: 'audio' },
    { id: 'in1', kind: 'audio' },
    { id: 'in2', kind: 'audio' },
    { id: 'in3', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
  }

  reset() { /* stateless */ }
  setParam(_id, _v) { /* no params */ }
  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const a = inputs.in0;
    const b = inputs.in1;
    const c = inputs.in2;
    const d = inputs.in3;
    const out = outputs.out;
    if (!out) return;

    for (let i = 0; i < N; i++) {
      let s = 0;
      if (a) s += a[i];
      if (b) s += b[i];
      if (c) s += c[i];
      if (d) s += d[i];
      out[i] = s;
    }
  }
}
