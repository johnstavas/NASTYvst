// op_lrXover.worklet.js — Stage-3 op sidecar for the `lrXover` op.
//
// Catalog #39 (Tone/Routing). 4th-order Linkwitz-Riley crossover.
// Splits mono input into low and high bands that sum back to flat magnitude.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - Siegfried Linkwitz, linkwitzlab.com/filters.htm:
//       "The 24 dB/oct LR4 crossover filter provides outputs which are 360
//        degrees offset in phase at all frequencies. At the transition
//        frequency Fp the response is 6 dB down."
//       "Any order Linkwitz-Riley filters can be implemented by a cascade
//        of 2nd order Sallen-Key filters" — LR4: Q₀ = 0.71 for both stages.
//   - Robert Bristow-Johnson, "Cookbook Formulae for Audio EQ Biquad Filter
//     Coefficients" (the "RBJ Audio Cookbook", canonical since 2005):
//       https://www.w3.org/TR/audio-eq-cookbook/
//     Public-domain coefficient formulas pasted verbatim below.
//
// PASSAGE VERBATIM — RBJ LPF biquad:
//     b0 = (1 - cos(ω0)) / 2
//     b1 =  1 - cos(ω0)
//     b2 = (1 - cos(ω0)) / 2
//     a0 =  1 + α
//     a1 = -2 · cos(ω0)
//     a2 =  1 - α
//
// PASSAGE VERBATIM — RBJ HPF biquad:
//     b0 =  (1 + cos(ω0)) / 2
//     b1 = -(1 + cos(ω0))
//     b2 =  (1 + cos(ω0)) / 2
//     a0 =  1 + α
//     a1 = -2 · cos(ω0)
//     a2 =  1 - α
//
// Common:  ω0 = 2π · f0 / sr,  α = sin(ω0) / (2Q),  Q = 1/√2 (Butterworth).
//
// Difference equation (Direct-Form I, normalized):
//     y[n] = (b0/a0)·x[n] + (b1/a0)·x[n-1] + (b2/a0)·x[n-2]
//                        − (a1/a0)·y[n-1] − (a2/a0)·y[n-2]
//
// LR4 topology:
//     low_out  = LPF(Q=1/√2) → LPF(Q=1/√2)  applied to input
//     high_out = HPF(Q=1/√2) → HPF(Q=1/√2)  applied to input
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Q = 1/√2 exactly (Math.SQRT1_2).** Linkwitz writes "Q₀ = 0.71"
//      which is a rounded printed value. The mathematical requirement
//      for Butterworth cascade is Q = 1/√2 = 0.70710678… exactly, which
//      Math.SQRT1_2 gives to machine precision.
//   2. **4th-order only (LR4).** LR2 exists but requires a polarity flip
//      on one leg (sum is inverted at crossover); we skip it in v1.
//      Declared deviation — P2 debt for LR2 mode.
//   3. **Per-sample biquad evaluation.** Composed inline rather than
//      referencing the existing `filter` op to keep this a single-stage
//      atomic primitive (no cross-op plumbing).
//   4. **Denormal flush** on biquad states (Canon:utilities §1).

const DENORMAL = 1e-30;
const Q_LR  = Math.SQRT1_2;  // 1/√2 exactly

export class LrXoverOp {
  static opId = 'lrXover';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'low',  kind: 'audio' },
    { id: 'high', kind: 'audio' },
  ]);
  static params  = Object.freeze([
    { id: 'f0', default: 1000 }, // crossover frequency (Hz)
  ]);

  constructor(sampleRate) {
    this.sr  = sampleRate;
    this._f0 = 1000;

    // Two cascaded biquads per leg: stages A and B share coefs (same RBJ spec).
    // LPF coefs
    this._lb0 = 0; this._lb1 = 0; this._lb2 = 0;
    this._la1 = 0; this._la2 = 0;
    // HPF coefs
    this._hb0 = 0; this._hb1 = 0; this._hb2 = 0;
    this._ha1 = 0; this._ha2 = 0;

    // State for 4 biquads (2 LP stages, 2 HP stages), each holding 2 x + 2 y history.
    this._lx1 = 0; this._lx2 = 0; this._ly1 = 0; this._ly2 = 0;  // LP stage A
    this._Lx1 = 0; this._Lx2 = 0; this._Ly1 = 0; this._Ly2 = 0;  // LP stage B
    this._hx1 = 0; this._hx2 = 0; this._hy1 = 0; this._hy2 = 0;  // HP stage A
    this._Hx1 = 0; this._Hx2 = 0; this._Hy1 = 0; this._Hy2 = 0;  // HP stage B

    this._recalc();
  }

  reset() {
    this._lx1 = 0; this._lx2 = 0; this._ly1 = 0; this._ly2 = 0;
    this._Lx1 = 0; this._Lx2 = 0; this._Ly1 = 0; this._Ly2 = 0;
    this._hx1 = 0; this._hx2 = 0; this._hy1 = 0; this._hy2 = 0;
    this._Hx1 = 0; this._Hx2 = 0; this._Hy1 = 0; this._Hy2 = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'f0') {
      this._f0 = Math.min(Math.max(n, 1), this.sr * 0.49);
      this._recalc();
    }
  }

  getLatencySamples() { return 0; }

  _recalc() {
    const w0 = 2 * Math.PI * this._f0 / this.sr;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Q_LR);

    const a0 = 1 + alpha;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha;

    // LPF (verbatim RBJ)
    const lp_b0 = (1 - cosw) / 2;
    const lp_b1 =  1 - cosw;
    const lp_b2 = (1 - cosw) / 2;
    this._lb0 = lp_b0 / a0;
    this._lb1 = lp_b1 / a0;
    this._lb2 = lp_b2 / a0;
    this._la1 = a1 / a0;
    this._la2 = a2 / a0;

    // HPF (verbatim RBJ)
    const hp_b0 =  (1 + cosw) / 2;
    const hp_b1 = -(1 + cosw);
    const hp_b2 =  (1 + cosw) / 2;
    this._hb0 = hp_b0 / a0;
    this._hb1 = hp_b1 / a0;
    this._hb2 = hp_b2 / a0;
    this._ha1 = a1 / a0;
    this._ha2 = a2 / a0;
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const outL = outputs.low;
    const outH = outputs.high;

    const lb0 = this._lb0, lb1 = this._lb1, lb2 = this._lb2;
    const la1 = this._la1, la2 = this._la2;
    const hb0 = this._hb0, hb1 = this._hb1, hb2 = this._hb2;
    const ha1 = this._ha1, ha2 = this._ha2;

    let lx1 = this._lx1, lx2 = this._lx2, ly1 = this._ly1, ly2 = this._ly2;
    let Lx1 = this._Lx1, Lx2 = this._Lx2, Ly1 = this._Ly1, Ly2 = this._Ly2;
    let hx1 = this._hx1, hx2 = this._hx2, hy1 = this._hy1, hy2 = this._hy2;
    let Hx1 = this._Hx1, Hx2 = this._Hx2, Hy1 = this._Hy1, Hy2 = this._Hy2;

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;

      // --- LP leg: stage A then stage B (identical coefs) ---
      let yA = lb0 * x + lb1 * lx1 + lb2 * lx2 - la1 * ly1 - la2 * ly2;
      if (yA > -DENORMAL && yA < DENORMAL) yA = 0;
      lx2 = lx1; lx1 = x; ly2 = ly1; ly1 = yA;

      let yB = lb0 * yA + lb1 * Lx1 + lb2 * Lx2 - la1 * Ly1 - la2 * Ly2;
      if (yB > -DENORMAL && yB < DENORMAL) yB = 0;
      Lx2 = Lx1; Lx1 = yA; Ly2 = Ly1; Ly1 = yB;

      if (outL) outL[i] = yB;

      // --- HP leg: stage A then stage B ---
      let zA = hb0 * x + hb1 * hx1 + hb2 * hx2 - ha1 * hy1 - ha2 * hy2;
      if (zA > -DENORMAL && zA < DENORMAL) zA = 0;
      hx2 = hx1; hx1 = x; hy2 = hy1; hy1 = zA;

      let zB = hb0 * zA + hb1 * Hx1 + hb2 * Hx2 - ha1 * Hy1 - ha2 * Hy2;
      if (zB > -DENORMAL && zB < DENORMAL) zB = 0;
      Hx2 = Hx1; Hx1 = zA; Hy2 = Hy1; Hy1 = zB;

      if (outH) outH[i] = zB;
    }

    this._lx1 = lx1; this._lx2 = lx2; this._ly1 = ly1; this._ly2 = ly2;
    this._Lx1 = Lx1; this._Lx2 = Lx2; this._Ly1 = Ly1; this._Ly2 = Ly2;
    this._hx1 = hx1; this._hx2 = hx2; this._hy1 = hy1; this._hy2 = hy2;
    this._Hx1 = Hx1; this._Hx2 = Hx2; this._Hy1 = Hy1; this._Hy2 = Hy2;
  }
}
