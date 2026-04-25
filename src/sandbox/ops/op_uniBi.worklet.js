// op_uniBi.worklet.js — Stage-3 op sidecar for the `uniBi` op.
//
// Catalog #94 (Control primitives). Unipolar ↔ bipolar range remap.
//
//   mode = 'uniToBi' → y = 2x − 1     ([0, 1] → [−1, +1])
//   mode = 'biToUni' → y = (x + 1)/2  ([−1, +1] → [0, 1])
//
// WHY THIS OP EXISTS
//
// The modulation roadmap (sandbox_modulation_roadmap.md) lays out two
// canonical signal ranges used across sources and destinations:
//
//   - Unipolar (0..1): envelope, trigger, depth-style controls.
//   - Bipolar (−1..+1): LFO, audio, centered-modulation controls.
//
// Without a remap, an LFO (bipolar) driving a depth knob (unipolar)
// produces negative depth during the negative half-cycle — garbage.
// Every modulation router in every commercial synth (Ableton, Bitwig,
// Reaktor) has a uni/bi toggle per mod slot for this exact reason.
//
// uniBi is the sandbox's equivalent: insert between any
// mismatched-range source and destination to bring them into sync.
//
// NO CLAMP
//
// This op does NOT clamp its output. uniToBi on an input of 2 gives 3;
// biToUni on 1.5 gives 1.25. That's deliberate: it's a linear remap,
// not a saturator. For hard bounds, follow with `clamp`.
//
// The reasoning: a mod source with occasional overshoot (e.g. a
// slew-limited LFO) should pass through uniBi with overshoot intact;
// downstream clamp (or the param's own range) decides what to do
// with out-of-range values.
//
// Stateless. Bit-exact within Float32 precision.

const MODE_UNI_TO_BI = 0;
const MODE_BI_TO_UNI = 1;

export class UniBiOp {
  static opId = 'uniBi';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'mode', default: 'uniToBi' },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._mode = MODE_UNI_TO_BI;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'mode') {
      // Accept either string names or numeric 0/1. Numeric form is
      // what the JSON IR will use after codegen canonicalizes;
      // string form is what graph authors write.
      if (v === 'uniToBi' || v === 0) this._mode = MODE_UNI_TO_BI;
      else if (v === 'biToUni' || v === 1) this._mode = MODE_BI_TO_UNI;
      // Anything else: sticky last-good (typo-resilient).
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      // No input: emit the neutral value for the current mode.
      // uniToBi: 0 (unipolar "off") → -1 ? No, silence in = silence out.
      // Actually: biToUni of 0 is 0.5, uniToBi of 0 is -1. The graph
      // convention for "unwired" is numeric zero, which produces the
      // same output as "input = 0". So we DO apply the remap to 0.
      if (this._mode === MODE_UNI_TO_BI) {
        for (let i = 0; i < N; i++) outCh[i] = -1;  // 2·0 − 1
      } else {
        for (let i = 0; i < N; i++) outCh[i] = 0.5; // (0 + 1)/2
      }
      return;
    }

    if (this._mode === MODE_UNI_TO_BI) {
      for (let i = 0; i < N; i++) outCh[i] = 2 * inCh[i] - 1;
    } else {
      for (let i = 0; i < N; i++) outCh[i] = (inCh[i] + 1) * 0.5;
    }
  }
}
