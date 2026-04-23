// op_detector.worklet.js — Stage-3 op sidecar for the `detector` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Full-wave rectifier (peak = |x|, rms ≈ x² — scaling handled by downstream
// envelope op). Stateless. Stub today: shape locked, inner loop zeros.
//
// Source of truth for the real implementation (when we fill it in):
//   compileGraphToWebAudio.js `detector()` factory (WaveShaper curve).

export class DetectorOp {
  static opId = 'detector';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'det', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'mode', default: 'peak' },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._mode = 'peak';
  }

  reset() { /* detector is stateless */ }

  setParam(id, v) {
    if (id === 'mode') this._mode = v;
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const outCh = outputs.det;
    for (let i = 0; i < N; i++) outCh[i] = 0;
    // TODO(stage-3a): inCh ? (mode==='rms' ? x*x : Math.abs(x)) : 0
  }
}
