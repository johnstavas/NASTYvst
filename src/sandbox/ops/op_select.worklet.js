// op_select.worklet.js — Stage-3 op sidecar for the `select` op.
//
// Catalog #24 (Routing). 1-of-4 hard switch — param-driven input selector.
//
// MATH-BY-DEFINITION primitive — declared per sandbox_op_ship_protocol.md.
// There is no paper / canon for a switch: `out = in_k` where k is the
// selected index.
//
// IN-REPO PRECEDENT (port shape):
//   src/sandbox/opRegistry.js fanOut / busSum — 4-port fixed convention.
//
// FORMULA:
//     k       = clamp(floor(index), 0, 3)
//     out[n]  = in_k[n]  (0 if in_k is not connected)
//
// DEVIATIONS FROM the "pure switch" form:
//   1. **Fixed 4 ports.** Sandbox shape-check requires static port lists.
//      For >4 sources, cascade two select instances (`select(a,b,c,select(d,e,f,g))`).
//   2. **Hard switch, no crossfade.** Index changes can produce a sample
//      discontinuity → click. v1 contract accepts this; crossfading is
//      op #25 `crossfade`'s job. Declared deviation.
//   3. **Block-rate index.** `index` is a param, resolved once per process()
//      call via setParam. Sample-rate control would require a CV input,
//      which the sandbox doesn't expose as kind:'control' yet. Declared.
//   4. **Missing selected input = 0.** Matches every other routing op
//      (busSum, msEncode/Decode). No error; silent.
//   5. **Fractional index clamps to floor.** `index=2.7` selects in2, not
//      a 70/30 mix between in2 and in3. Crossfading lives in #25.

export class SelectOp {
  static opId = 'select';
  static inputs  = Object.freeze([
    { id: 'in0', kind: 'audio' },
    { id: 'in1', kind: 'audio' },
    { id: 'in2', kind: 'audio' },
    { id: 'in3', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'index', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._index = 0;  // normalized to integer 0..3
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'index') {
      const k = Math.floor(n);
      this._index = k < 0 ? 0 : (k > 3 ? 3 : k);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const out = outputs.out;
    if (!out) return;
    const src = this._index === 0 ? inputs.in0
              : this._index === 1 ? inputs.in1
              : this._index === 2 ? inputs.in2
              :                     inputs.in3;
    if (src) {
      for (let i = 0; i < N; i++) out[i] = src[i];
    } else {
      for (let i = 0; i < N; i++) out[i] = 0;
    }
  }
}
