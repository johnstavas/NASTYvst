// op_crossfade.worklet.js — Stage-3 op sidecar for the `crossfade` op.
//
// Catalog #25 (Routing). Equal-power A↔B crossfader.
//
// PRIMARY SOURCES (opened 2026-04-24):
//   - In-repo authoritative precedent: src/sandbox/ops/op_mix.worklet.js:43–46
//     (canonical cos/sin equal-power law, enforced by
//     memory/dry_wet_mix_rule.md as NON-NEGOTIABLE for every master-worklet
//     plugin).
//   - Historical canon: Blumlein 1933 patent GB 394,325 (cos/sin pan law);
//     Bauer, B. B. (1961). "Phasor Analysis of Some Stereophonic
//     Phenomena", J. Acoustical Soc. Amer. 33(11), 1536–1539 — analytic
//     derivation of the constant-power pan law. Julius Smith, "Spatial
//     Sound" lecture notes: "Equal-Power Panning" — same cos/sin result.
//
// PASSAGE VERBATIM — src/sandbox/ops/op_mix.worklet.js:43–46:
//     dryGain = cos(amount · π/2)
//     wetGain = sin(amount · π/2)
//     out     = dry · dryGain + wet · wetGain
//
// RELATIONSHIP TO #7 mix:
//   Same DSP law bit-for-bit. This op differs only in vocabulary:
//     - `mix`:       ports (dry, wet),  param `amount`  — effect wet/dry knob.
//     - `crossfade`: ports (a, b),      param `position` — A/B router.
//   Justification for a separate op: sandbox philosophy treats each op as
//   an atomic self-describing primitive (same reason lrXover inlines its
//   own biquad rather than composing `filter`). A wet/dry knob and a
//   routing A/B switch are semantically distinct even though the math
//   matches.
//
// DEVIATIONS FROM passage:
//   1. **Port renaming** (dry→a, wet→b) — declared above. DSP unchanged.
//   2. **Param renaming** (amount→position) — declared above.
//   3. **Missing-input tolerance** — if a or b is absent, it contributes 0
//      (matches op_mix's behavior at lines 60–66 of the passage source).
//   4. **Block-rate position** — resolved via setParam, not per-sample.
//      Same as op_mix. Smoothing deferred to caller. Declared debt.
//
// DRY/WET RULE NOTE: per memory/dry_wet_mix_rule.md, external parallel A/B
// legs would comb-filter if they ran at different sample clocks. Here both
// legs are inside the master worklet at the same rate, so the rule's
// failure mode does not apply — matches op_mix's situation verbatim.

export class CrossfadeOp {
  static opId = 'crossfade';
  static inputs  = Object.freeze([
    { id: 'a', kind: 'audio' },
    { id: 'b', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'position', default: 0.5 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._position = 0.5;
    this._gA = Math.cos(0.5 * Math.PI * 0.5);   // cos(π/4)
    this._gB = Math.sin(0.5 * Math.PI * 0.5);   // sin(π/4)
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'position') {
      const p = n < 0 ? 0 : (n > 1 ? 1 : n);
      this._position = p;
      this._gA = Math.cos(p * Math.PI * 0.5);
      this._gB = Math.sin(p * Math.PI * 0.5);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const aCh = inputs.a;
    const bCh = inputs.b;
    const out = outputs.out;
    if (!out) return;
    const gA = this._gA;
    const gB = this._gB;
    if (aCh && bCh) {
      for (let i = 0; i < N; i++) out[i] = aCh[i] * gA + bCh[i] * gB;
    } else if (aCh) {
      for (let i = 0; i < N; i++) out[i] = aCh[i] * gA;
    } else if (bCh) {
      for (let i = 0; i < N; i++) out[i] = bCh[i] * gB;
    } else {
      for (let i = 0; i < N; i++) out[i] = 0;
    }
  }
}
