// op_envelope.worklet.js — Stage-3 op sidecar for the `envelope` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Asymmetric AR envelope follower — exponential smoothing with separate
// attack/release time constants, output scaled and offset to control-range.
// Stub today: shape locked, inner loop zeros. Real implementation will port
// the sandbox-envelope-follower worklet body (workletSources.js:61).
//
// CRITICAL: the real implementation MUST preserve the Jon Watte denormal
// bias (canon/dsp_code_canon_utilities.md §1) on both accumulating state
// paths. T6 rule ENVELOPE_DENORMAL_GUARD (check_t6_rules.mjs) enforces ≥ 2
// DENORM additions in this file's body once the inner loop lands.

export class EnvelopeOp {
  static opId = 'envelope';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'env', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'attack',  default: 5   },
    { id: 'release', default: 120 },
    { id: 'amount',  default: -1  },
    { id: 'offset',  default: 0   },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._attack  = 5;
    this._release = 120;
    this._amount  = -1;
    this._offset  = 0;
    this._state   = 0;
    this._atkAlpha = 0;
    this._relAlpha = 0;
    this._recomputeAlphas();
  }

  _recomputeAlphas() {
    const atkSec = Math.max(0.0001, this._attack  / 1000);
    const relSec = Math.max(0.0001, this._release / 1000);
    this._atkAlpha = Math.exp(-1 / (atkSec * this.sr));
    this._relAlpha = Math.exp(-1 / (relSec * this.sr));
  }

  reset() { this._state = 0; }

  setParam(id, v) {
    if (id === 'attack')  { this._attack  = v; this._recomputeAlphas(); }
    if (id === 'release') { this._release = v; this._recomputeAlphas(); }
    if (id === 'amount')  this._amount = v;
    if (id === 'offset')  this._offset = v;
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const outCh = outputs.env;
    for (let i = 0; i < N; i++) outCh[i] = 0;
    // TODO(stage-3a): port sandbox-envelope-follower inner loop with
    //                 DENORM on both s-update paths (Watte).
  }
}
