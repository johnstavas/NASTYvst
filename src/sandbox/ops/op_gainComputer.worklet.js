// op_gainComputer.worklet.js — Stage-3 op sidecar for the `gainComputer` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Threshold / ratio / knee → delta-from-unity gain-reduction signal.
// Pure sidechain math — no audio path. Stub today: shape locked, inner loop
// zeros. Real implementation will port sandbox-gain-computer worklet body
// (workletSources.js:258) — Zölzer soft-knee form, dB-domain.
//
// Curve-monotonicity is enforced at the graph validator tier
// (T6.GAINCOMP_MONOTONIC in validateGraph.js). Any inner-loop change here
// that breaks monotonicity for valid (threshold, ratio, knee) will also
// show up as a golden-vector delta.

export class GainComputerOp {
  static opId = 'gainComputer';
  static inputs  = Object.freeze([{ id: 'env', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'gr',  kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'thresholdDb', default: -18 },
    { id: 'ratio',       default:   4 },
    { id: 'kneeDb',      default:   6 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._thr   = -18;
    this._ratio = 4;
    this._knee  = 6;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'thresholdDb') this._thr   = v;
    if (id === 'ratio')       this._ratio = Math.max(1, v);
    if (id === 'kneeDb')      this._knee  = Math.max(0, v);
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const outCh = outputs.gr;
    for (let i = 0; i < N; i++) outCh[i] = 0;
    // TODO(stage-3a): port Zölzer soft-knee gain-computer inner loop.
  }
}
