// op_transformerSim.worklet.js — Stage-3 op sidecar for the
// `transformerSim` op (catalog #111).
//
// Audio transformer soft-saturation character. Models the ANHYSTERETIC
// component of the Jiles-Atherton magnetic model (Langevin function),
// with optional DC-bias for asymmetric even-harmonic content.
//
// PRIMARY: D.C. Jiles & D.L. Atherton, "Theory of ferromagnetic
// hysteresis", Journal of Magnetism and Magnetic Materials 61 (1986) 48.
// Opened via Wikipedia "Jiles-Atherton_model" page (equations verbatim
// from that source, not the original JMMM paper — paper is paywalled):
//
//   Effective field:        H_e = H + α·M
//   Anhysteretic (Langevin): M_an = M_s · (coth(H_e/a) − a/H_e)
//   Flux density:            B(H) = μ₀·(H + M(H))
//
// The Langevin function L(x) = coth(x) − 1/x is the physically correct
// soft-sigmoid shape for iron-core saturation. We ship:
//
//   y(n) = output · [ L(drive·x(n) + bias) − L(bias) ]
//
// where the `− L(bias)` term removes the DC offset that bias would
// otherwise introduce, preserving the even-harmonic content in the
// dynamic signal but keeping silence-in → silence-out.
//
// DEVIATIONS from primary (listed here, diff in ship Step 4):
//
//   1. Only the ANHYSTERETIC component is shipped. The full J-A model
//      has an irreversible branch `dM/dH = (1/(1+c)) · (M_an − M) /
//      (δ·k − α·(M_an−M))` + reversible fraction `c·dM_an/dH`. Those
//      produce the actual hysteresis LOOP (memory + path-dependent
//      response). This v1 ships the memoryless anhysteretic curve only.
//      Full J-A loop = upgrade path in the debt ledger.
//
//   2. No frequency-dependent saturation. Real transformers saturate
//      MORE at low frequencies because flux is the TIME INTEGRAL of
//      voltage (Φ = ∫V·dt). Low-freq content → more flux → earlier
//      saturation. This v1 ignores the integrator-before-saturator.
//      Filed as upgrade.
//
//   3. No HF loss (leakage inductance + winding capacitance). Real
//      transformers roll off ~15-20 kHz. v1 is broadband linear outside
//      the waveshaper. Filed as upgrade.
//
//   4. α inter-domain coupling term not exposed. At audio levels where
//      drive is moderate, α·M contribution is small; the Langevin
//      waveshaper alone captures the essential compression character.
//
// PARAMETERS
//   drive  (0.1..10, default 1)  — H_e/a scaling (input gain into curve)
//   bias   (−1..+1,  default 0)  — DC offset; creates asymmetry →
//                                  even harmonics (core-magnetization
//                                  imbalance, DC-biased transformers)
//   output (0..2,    default 1)  — post-shape output gain trim

const DENORMAL = 1e-30;

// Langevin L(x) = coth(x) − 1/x. Taylor near 0: x/3 − x³/45 + 2x⁵/945 − ...
// Numerically safe for all finite x.
function langevin(x) {
  const ax = Math.abs(x);
  if (ax < 1e-4) {
    // Taylor series (3rd-order accurate at |x|=1e-4 → error ~1e-16)
    return x / 3 - (x * x * x) / 45;
  }
  // coth = 1/tanh. tanh is numerically well-conditioned at all scales.
  const t = Math.tanh(x);
  return (1 / t) - (1 / x);
}

export class TransformerSimOp {
  static opId = 'transformerSim';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive',  default: 1 },
    { id: 'bias',   default: 0 },
    { id: 'output', default: 1 },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._drive  = 1;
    this._bias   = 0;
    this._output = 1;
    this._biasOffset = 0;   // L(bias), recomputed on bias change
  }

  reset() { /* memoryless; state lives in biasOffset which is param-derived */ }

  _recomputeBiasOffset() { this._biasOffset = langevin(this._bias); }

  setParam(id, v) {
    if (id === 'drive') {
      let d = +v;
      if (!Number.isFinite(d)) d = 1;
      if (d < 0.01) d = 0.01;
      if (d > 100)  d = 100;
      this._drive = d;
    } else if (id === 'bias') {
      let b = +v;
      if (!Number.isFinite(b)) b = 0;
      if (b < -10) b = -10;
      if (b >  10) b =  10;
      this._bias = b;
      this._recomputeBiasOffset();
    } else if (id === 'output') {
      let o = +v;
      if (!Number.isFinite(o)) o = 1;
      if (o < 0)  o = 0;
      if (o > 10) o = 10;
      this._output = o;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const d    = this._drive;
    const b    = this._bias;
    const off  = this._biasOffset;
    const out  = this._output;

    for (let n = 0; n < N; n++) {
      const x = iBuf ? iBuf[n] : 0;
      // y = output · [ L(drive·x + bias) − L(bias) ]
      const u = d * x + b;
      let y = out * (langevin(u) - off);
      if (Math.abs(y) < DENORMAL) y = 0;
      oBuf[n] = y;
    }
  }
}
