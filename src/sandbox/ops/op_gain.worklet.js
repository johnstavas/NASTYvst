// op_gain.worklet.js — Stage-3 op sidecar for the `gain` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// The master-worklet emitter (Stage 3-a) stitches one instance of this class
// per graph node into a single flat AudioWorkletProcessor. Today the class is
// a stub: correct shape (static id/inputs/outputs/params matching
// opRegistry.js), empty inner loop that zeros the output. Real math lands
// during Stage 3-a implementation and is held to the golden vector stored
// in scripts/check_op_goldens.mjs — once filled in, any subsequent change
// to the math trips the harness until the author deliberately re-blesses
// the golden.
//
// Source of truth for the real implementation (when we fill it in):
//   compileGraphToWebAudio.js `gain()` factory.

export class GainOp {
  static opId = 'gain';
  static inputs  = Object.freeze([
    { id: 'in',      kind: 'audio' },
    { id: 'gainMod', kind: 'control', optional: true },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'gainDb', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._gainDb = 0;
  }

  reset() { /* gain is stateless */ }

  setParam(id, v) {
    if (id === 'gainDb') this._gainDb = v;
  }

  getLatencySamples() { return 0; }

  // inputs:  { in?: Float32Array, gainMod?: Float32Array }
  // outputs: { out: Float32Array }
  //
  // Matches compileGraphToWebAudio's gain() factory: a control signal wired
  // to `gainMod` is summed into the AudioParam whose resting value is the
  // linear gain derived from gainDb. Unwired `gainMod` means static gain;
  // unwired `in` means silence out (defensive — compiler shouldn't leave
  // audio inputs unwired but ops must not throw on it).
  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const modCh = inputs.gainMod;
    const outCh = outputs.out;
    const base  = Math.pow(10, this._gainDb / 20);
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    if (modCh) {
      for (let i = 0; i < N; i++) outCh[i] = inCh[i] * (base + modCh[i]);
    } else {
      for (let i = 0; i < N; i++) outCh[i] = inCh[i] * base;
    }
  }
}
