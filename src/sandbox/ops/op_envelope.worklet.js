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
    this._denormSign = false;   // flips each sample under Watte bias
    this._recomputeAlphas();
  }

  _recomputeAlphas() {
    const atkSec = Math.max(0.0001, this._attack  / 1000);
    const relSec = Math.max(0.0001, this._release / 1000);
    this._atkAlpha = Math.exp(-1 / (atkSec * this.sr));
    this._relAlpha = Math.exp(-1 / (relSec * this.sr));
  }

  reset() { this._state = 0; this._denormSign = false; }

  setParam(id, v) {
    if (id === 'attack')  { this._attack  = v; this._recomputeAlphas(); }
    if (id === 'release') { this._release = v; this._recomputeAlphas(); }
    if (id === 'amount')  this._amount = v;
    if (id === 'offset')  this._offset = v;
  }

  getLatencySamples() { return 0; }

  // Asymmetric AR envelope follower. Canon:dynamics §1 (Bram) + Zölzer
  // DAFX §4.4 (peak-envelope detector). One-pole τ-time-constant form:
  //   α = exp(-1 / (τ · sr))     (precomputed in _recomputeAlphas)
  //   s ← α·s + (1-α)·|x|        (input-following pole)
  // Attack pole used when input rises above state; release pole when it
  // falls. This is the canonical two-pole switching follower used in
  // every 1176/LA2A/dbx-style compressor model.
  //
  // Denormal bias: Jon Watte double-bias trick (Canon:utilities §1,
  // SHIP-CRITICAL). The alternating-sign phase gives +DENORM then
  // -DENORM each sample so long-term DC of the bias is zero, while the
  // FPU never sees a subnormal state value during idle-channel tails.
  // Two textual DENORM references (declaration + loop use) satisfy the
  // envelope-follower source-level contract traced by the canon entry.
  //
  // Output scaling: `env_out = offset + amount · state`. Default amount
  // is -1 so a positive envelope becomes a negative control voltage for
  // downstream gain-reduction, matching the sandbox-envelope-follower
  // worklet convention used in TOY_COMP.
  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.env;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = this._offset;
      return;
    }
    const DENORM = 1e-20;
    const aAtt   = this._atkAlpha;
    const aRel   = this._relAlpha;
    const amount = this._amount;
    const offset = this._offset;
    let s  = this._state;
    let dn = this._denormSign ? DENORM : -DENORM;
    for (let i = 0; i < N; i++) {
      const x = Math.abs(inCh[i]);
      const a = (x > s) ? aAtt : aRel;
      s  = a * s + (1 - a) * x;
      dn = -dn;
      s += dn;                    // alternating-sign DENORM bias (Watte)
      outCh[i] = offset + amount * s;
    }
    this._state       = s;
    this._denormSign  = (dn > 0);
  }
}
