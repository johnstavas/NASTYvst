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

  // Zölzer DAFX Ch. 4.4 dynamics chain + Canon:dynamics §1 (Bram envelope
  // detector): the detector stage is a pure rectifier; averaging and sqrt
  // live in the downstream envelope op. "peak" → |x|. "rms" → x² (power
  // domain; the envelope LPF integrates to mean-square, and if an RMS
  // magnitude is wanted the caller applies sqrt before the gain computer).
  // Splitting sqrt out keeps this op stateless and branch-free per sample.
  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.det;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    if (this._mode === 'rms') {
      for (let i = 0; i < N; i++) { const x = inCh[i]; outCh[i] = x * x; }
    } else {
      for (let i = 0; i < N; i++) outCh[i] = Math.abs(inCh[i]);
    }
  }
}
