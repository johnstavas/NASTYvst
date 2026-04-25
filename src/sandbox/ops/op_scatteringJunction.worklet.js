// op_scatteringJunction.worklet.js — Stage-3 op sidecar for the
// `scatteringJunction` op (catalog #87).
//
// Bare 2-port scattering junction — the memoryless primitive used to
// connect two digital waveguide sections of differing impedance. The
// 1-multiply form is lifted verbatim from:
//
// PRIMARY: J.O. Smith III, "Physical Audio Signal Processing"
//   §7 "One-Multiply Scattering Junctions"
//   https://ccrma.stanford.edu/~jos/pasp/One_Multiply_Scattering_Junctions.html
//
// Verbatim equations (Kelly-Lochbaum form, delays factored out into the
// surrounding waveguide sections — THIS op is memoryless):
//
//     Δf(t)      = κ · (f⁺_in − f⁻_in)
//     f⁺_out     = f⁺_in + Δf
//     f⁻_out     = f⁻_in + Δf
//
//   where  f⁺_in  is the right-going wave arriving from section i−1
//          f⁻_in  is the left-going  wave arriving from section i
//          f⁺_out continues right (into section i)
//          f⁻_out continues left  (into section i−1)
//
// "only one multiplication and three additions per junction" (JOS §7).
//
// This op is DISTINCT from #87a kellyLochbaum (N-section lattice): it
// exposes the single junction as a reusable primitive so users can
// compose arbitrary topologies — branched tubes, T-junctions, asymmetric
// horns, vocal tract + nasal coupling — that the uniform N-section
// lattice cannot express.
//
// PARAMETERS
//   k  (−0.99..+0.99, default 0)  — reflection coefficient.
//      k=0  → transparent junction (both sections see the same impedance)
//      k>0  → section i−1 sees a narrower / higher-impedance section i
//             (wave partially reflects back with same sign)
//      k<0  → section i−1 sees a wider / lower-impedance section i
//             (wave partially reflects back with inverted sign)
//      |k|≤0.99 is the strict passivity clamp (same as #87a).
//
// INPUTS  (audio)
//   fInPlus   — right-going wave entering junction
//   fInMinus  — left-going  wave entering junction
//
// OUTPUTS (audio)
//   fOutPlus  — right-going wave leaving junction
//   fOutMinus — left-going  wave leaving junction
//
// LATENCY: 0 (memoryless — scattering redistributes instantaneously).

const DENORMAL = 1e-30;

export class ScatteringJunctionOp {
  static opId = 'scatteringJunction';
  static inputs  = Object.freeze([
    { id: 'fInPlus',  kind: 'audio' },
    { id: 'fInMinus', kind: 'audio' },
  ]);
  static outputs = Object.freeze([
    { id: 'fOutPlus',  kind: 'audio' },
    { id: 'fOutMinus', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'k', default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._k = 0;
  }

  reset() { /* memoryless */ }

  setParam(id, v) {
    if (id === 'k') {
      let k = +v;
      if (!Number.isFinite(k)) k = 0;
      if (k >  0.99) k =  0.99;
      if (k < -0.99) k = -0.99;
      this._k = k;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oP = outputs && outputs.fOutPlus;
    const oM = outputs && outputs.fOutMinus;
    if (!oP && !oM) return;

    const iP = inputs && inputs.fInPlus;
    const iM = inputs && inputs.fInMinus;
    const k  = this._k;

    for (let n = 0; n < N; n++) {
      const fp = iP ? iP[n] : 0;
      const fm = iM ? iM[n] : 0;
      // JOS §7 Kelly-Lochbaum form:
      //   Δ = κ · (f⁺_in − f⁻_in)
      let d = k * (fp - fm);
      if (Math.abs(d) < DENORMAL) d = 0;
      if (oP) oP[n] = fp + d;
      if (oM) oM[n] = fm + d;
    }
  }
}
