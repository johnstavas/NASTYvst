// op_mix.worklet.js — Stage-3 op sidecar for the `mix` op.
//
// Pins the per-op emission contract defined in memory/codegen_design.md § 4.
// Equal-power dry/wet crossfade (cos/sin). Stateless. Stub today: shape
// locked, inner loop zeros. Real implementation is the same cos/sin form
// mandated by dry_wet_mix_rule.md (NON-NEGOTIABLE):
//   dry = cos(amount · π/2), wet = sin(amount · π/2)
//
// Master-worklet topology means dry and wet legs run at the same clock,
// so the "external dry leg comb-filters the wet leg" problem that rules
// out chain-of-worklets dry legs does not apply here.

export class MixOp {
  static opId = 'mix';
  static inputs  = Object.freeze([
    { id: 'dry', kind: 'audio' },
    { id: 'wet', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'amount', default: 0.5 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._amount = 0.5;
    this._dryGTarget = Math.cos(0.5 * Math.PI * 0.5);
    this._wetGTarget = Math.sin(0.5 * Math.PI * 0.5);
    this._dryGSmoothed = -1;   // <0 sentinel: prime on first block
    this._wetGSmoothed = -1;
  }

  reset() {
    this._dryGSmoothed = -1;
    this._wetGSmoothed = -1;
  }

  setParam(id, v) {
    if (id === 'amount') {
      this._amount = v;
      this._dryGTarget = Math.cos(v * Math.PI * 0.5);
      this._wetGTarget = Math.sin(v * Math.PI * 0.5);
    }
  }

  getLatencySamples() { return 0; }

  // Equal-power crossfade with PER-SAMPLE smoothing of dryG/wetG to kill
  // knob-twiddle clicks (added 2026-04-27, mirrors op_gain smoothing).
  //   dryGain = cos(amount · π/2)
  //   wetGain = sin(amount · π/2)
  //   out     = dry · dryGain + wet · wetGain
  // Mandated by memory/dry_wet_mix_rule.md as the canonical mix law.
  process(inputs, outputs, N) {
    const dryCh = inputs.dry;
    const wetCh = inputs.wet;
    const outCh = outputs.out;
    if (this._dryGSmoothed < 0) {
      this._dryGSmoothed = this._dryGTarget;
      this._wetGSmoothed = this._wetGTarget;
    }
    const dInc = (this._dryGTarget - this._dryGSmoothed) / (N > 0 ? N : 1);
    const wInc = (this._wetGTarget - this._wetGSmoothed) / (N > 0 ? N : 1);
    let dG = this._dryGSmoothed;
    let wG = this._wetGSmoothed;
    if (dryCh && wetCh) {
      for (let i = 0; i < N; i++) {
        dG += dInc; wG += wInc;
        outCh[i] = dryCh[i] * dG + wetCh[i] * wG;
      }
    } else if (dryCh) {
      for (let i = 0; i < N; i++) {
        dG += dInc;
        outCh[i] = dryCh[i] * dG;
      }
    } else if (wetCh) {
      for (let i = 0; i < N; i++) {
        wG += wInc;
        outCh[i] = wetCh[i] * wG;
      }
    } else {
      for (let i = 0; i < N; i++) outCh[i] = 0;
    }
    this._dryGSmoothed = this._dryGTarget;
    this._wetGSmoothed = this._wetGTarget;
  }
}
