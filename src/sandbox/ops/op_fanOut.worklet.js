// op_fanOut.worklet.js — Stage-3 op sidecar for the `fanOut` op.
//
// Catalog #92 (Control primitives). One-to-four passthrough splitter:
//
//   in → out0, out1, out2, out3    (all four identical to in)
//
// WHY THIS OP EXISTS
//
// The sandbox graph already lets a single output wire connect to
// multiple downstream inputs — so strictly, fanOut is not a DSP
// necessity. It exists for three graph-level reasons:
//
//   1. EXPLICIT TOPOLOGY. A `fanOut` node in graph.json is a visible,
//      named split point. Without it, a signal that feeds five
//      downstream consumers looks no different from one that feeds
//      one — the graph renderer can show it, but the graph
//      *document* doesn't call it out. fanOut makes the intent
//      "this is a distribution hub" a first-class object.
//
//   2. INSTRUMENTATION HOOK. When troubleshooting, wrapping a
//      suspect signal in fanOut and leaving 3 of the 4 outputs for
//      probes (meters, recorders, scopes) keeps the production path
//      clean. The brick-audit workflow uses this.
//
//   3. FUTURE: PER-BRANCH TRIM. A v2 of this op can add optional
//      per-output gain trims (out_k = trim_k · in). For now we keep
//      the schema simple — four unity outputs — so authoring is
//      trivial and the golden stays stable. If per-branch trim
//      lands later, it's an additive param change.
//
// DESIGN CHOICES
//
// - Four outputs, not variable. Static schemas are mandatory in the
//   Stage-3 contract (opRegistry must enumerate ports). Four covers
//   every sandbox use we've seen so far; graph authors who need 6+
//   chain two fanOut nodes.
//
// - Output kind = audio, not control. An audio output can feed both
//   audio and control inputs downstream (both are Float32Array N-
//   sample buffers); a control-declared output, by convention, can
//   only feed control inputs. Audio is the more permissive choice
//   and matches how `scaleBy`/`polarity` declare.
//
// - Missing input → all outputs zero. Consistent with every other
//   op's "defensive null" contract.
//
// Stateless. Bit-exact copy (no sign or precision mutation).

export class FanOutOp {
  static opId = 'fanOut';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'out0', kind: 'audio' },
    { id: 'out1', kind: 'audio' },
    { id: 'out2', kind: 'audio' },
    { id: 'out3', kind: 'audio' },
  ]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
  }

  reset() { /* stateless */ }
  setParam(_id, _v) { /* no params */ }
  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh = inputs.in;
    const o0 = outputs.out0;
    const o1 = outputs.out1;
    const o2 = outputs.out2;
    const o3 = outputs.out3;

    if (!inCh) {
      // Defensive: zero-fill every wired output.
      if (o0) for (let i = 0; i < N; i++) o0[i] = 0;
      if (o1) for (let i = 0; i < N; i++) o1[i] = 0;
      if (o2) for (let i = 0; i < N; i++) o2[i] = 0;
      if (o3) for (let i = 0; i < N; i++) o3[i] = 0;
      return;
    }

    // Per-branch copy. We could Float32Array.set() each destination,
    // but a manual loop keeps the hot path uniform with other ops —
    // the master-worklet compiler may inline these into a single
    // multi-destination store.
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      if (o0) o0[i] = x;
      if (o1) o1[i] = x;
      if (o2) o2[i] = x;
      if (o3) o3[i] = x;
    }
  }
}
