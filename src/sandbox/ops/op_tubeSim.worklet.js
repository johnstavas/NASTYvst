// op_tubeSim.worklet.js — Stage-3 op sidecar for catalog #113.
//
// Vacuum-tube triode character via Koren's SPICE triode model.
// Memoryless waveshaper — no HF roll-off, no interstage coupling caps,
// no transformer. Those are composable as separate ops (#9 shelf,
// #17 dcBlock, #111 transformerSim).
//
// PRIMARY (opened 2026-04-24):
//   Norman Koren, "Improved vacuum tube models for SPICE simulations",
//   normankoren.com/Audio/Tubemodspice_article.html (1996, rev 2003).
//   Fetched to node_modules/.koren_primary.html.
//
//   Verbatim equations (article § "The new plate current equation for
//   triodes is", eq. 4):
//
//     E1 = (EP/kP) · log(1 + exp(kP · (1/μ + EG/sqrt(kVB + EP²))))
//     IP = (E1^X / kG1) · (1 + sgn(E1))
//
//   "The signum function, sgn(x) = 1 for x >= 0; sgn(x) = -1 for x < 0,
//   is used to prevent current flow when E1 < 0."
//
//   12AX7 parameter block (Koren's table, row "12AX7"):
//     μ    = 100
//     X    = 1.4       (EX)
//     kG1  = 1060
//     kP   = 600
//     kVB  = 300
//
// SANDBOX MAPPING (math-by-definition on top of Koren):
//   input x ∈ [-1,1] → EG = -bias + drive · x     (grid voltage, volts)
//   EP is held at plateV (constant within block — no coupled B+).
//   IP  computed per Koren eq. 4.
//   Subtract quiescent IP0 = IP(EG = -bias) to remove DC offset.
//   Output = (IP - IP0) · (Kg1/400) · trim   — gain-normalize so 12AX7
//   default params produce O(1) output from unity-drive input.
//
// DEVIATIONS from Koren (all tracked in debt ledger):
//   - No grid-current rectification above EG = 0 (real 12AX7 conducts
//     grid current, causing asymmetric soft-limit + bias shift). Koren's
//     model is accurate to EG ≤ 0; above 0 we rely on the E1 saturation
//     but don't add a separate grid-current term.
//   - No plate-voltage dynamic coupling. Real stage has plate load R_L
//     and supply sag; we fix EP = plateV. Means dynamic compression
//     from load-line swing is absent.
//   - No interstage HF roll-off from Miller capacitance. Users wire
//     #9 shelf or #2 filter externally.
//   - Memoryless — no 1/f flicker or thermal drift modeling.

const DENORMAL = 1e-30;

export class TubeSimOp {
  static opId = 'tubeSim';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive',  default: 1.5 },  // grid-swing scale (volts per unit input)
    { id: 'bias',   default: 1.5 },  // |EG| quiescent magnitude (|bias| volts negative)
    { id: 'plateV', default: 250 },  // EP plate voltage (volts)
    { id: 'mu',     default: 100 },  // 12AX7
    { id: 'ex',     default: 1.4 },  // 12AX7
    { id: 'kg1',    default: 1060 }, // 12AX7
    { id: 'kp',     default: 600 },  // 12AX7
    { id: 'kvb',    default: 300 },  // 12AX7
    { id: 'trim',   default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._drive  = 1.5;
    this._bias   = 1.5;
    this._plateV = 250;
    this._mu  = 100;
    this._ex  = 1.4;
    this._kg1 = 1060;
    this._kp  = 600;
    this._kvb = 300;
    this._trim = 1.0;
    this._ip0 = 0;
    this._gain = 1;
    this._recompute();
  }

  reset() { /* memoryless — nothing to clear */ }

  // Koren's triode plate-current eq. 4 (verbatim). Returns IP ≥ 0.
  _koren(EG) {
    const EP  = this._plateV;
    const mu  = this._mu;
    const ex  = this._ex;
    const kg1 = this._kg1;
    const kp  = this._kp;
    const kvb = this._kvb;

    // E1 = (EP/kP) · log(1 + exp(kP · (1/μ + EG/sqrt(kVB + EP²))))
    //
    // Numerical safety: log(1+exp(z)) overflows for large z.
    // For z > 30, log(1+exp(z)) ≈ z (< 10⁻¹³ error).
    const inner = kp * (1 / mu + EG / Math.sqrt(kvb + EP * EP));
    let softplus;
    if (inner > 30)       softplus = inner;
    else if (inner < -30) softplus = Math.exp(inner); // ≈ 0
    else                  softplus = Math.log(1 + Math.exp(inner));
    const E1 = (EP / kp) * softplus;

    // IP = (E1^X / kG1) · (1 + sgn(E1))
    // E1 ≥ 0 by construction of softplus, so (1 + sgn(E1)) = 2
    // for E1 > 0 and = 1 for E1 = 0. We honor Koren's form exactly.
    if (E1 <= 0) return 0;
    const sgn = E1 >= 0 ? 1 : -1; // always 1 here, kept for fidelity
    return (Math.pow(E1, ex) / kg1) * (1 + sgn);
  }

  _recompute() {
    // Quiescent plate current at grid voltage -bias
    this._ip0 = this._koren(-this._bias);
    // Normalize so 12AX7 defaults give O(1) output at unity input+drive.
    // Empirical normalizer kg1/400 keeps gain sane across tube swaps.
    this._gain = this._kg1 / 400;
  }

  setParam(id, v) {
    const f = +v;
    if (!Number.isFinite(f)) return;
    if      (id === 'drive')  this._drive  = f < 0 ? 0 : (f > 20 ? 20 : f);
    else if (id === 'bias')   { this._bias   = f < 0 ? 0 : (f > 5 ? 5 : f); this._recompute(); }
    else if (id === 'plateV') { this._plateV = f < 50 ? 50 : (f > 500 ? 500 : f); this._recompute(); }
    else if (id === 'mu')     { this._mu  = f < 5 ? 5 : (f > 200 ? 200 : f); this._recompute(); }
    else if (id === 'ex')     { this._ex  = f < 1 ? 1 : (f > 2 ? 2 : f); this._recompute(); }
    else if (id === 'kg1')    { this._kg1 = f < 100 ? 100 : (f > 5000 ? 5000 : f); this._recompute(); }
    else if (id === 'kp')     { this._kp  = f < 50 ? 50 : (f > 2000 ? 2000 : f); this._recompute(); }
    else if (id === 'kvb')    { this._kvb = f < 10 ? 10 : (f > 1000 ? 1000 : f); this._recompute(); }
    else if (id === 'trim')   this._trim = f < 0 ? 0 : (f > 4 ? 4 : f);
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const drive = this._drive;
    const bias  = this._bias;
    const ip0   = this._ip0;
    const g     = this._gain;
    const trim  = this._trim;

    for (let n = 0; n < N; n++) {
      const x = iBuf ? iBuf[n] : 0;
      // EG = -bias + drive·x  (bias is the positive magnitude of
      // quiescent grid bias; grid sits at -bias volts at rest)
      const EG = -bias + drive * x;
      const ip = this._koren(EG);
      // Output tracks plate-current deviation from quiescent, NOT plate-
      // voltage (which would invert). This keeps the polarity convention
      // of sandbox character ops: positive input → positive output, with
      // the asymmetric soft/hard character intact (positive side soft-
      // saturates via softplus curve, negative side hard-clips at IP=0
      // cutoff). A downstream #17 dcBlock handles any residual offset.
      let y = (ip - ip0) * g * trim;
      if (Math.abs(y) < DENORMAL) y = 0;
      if (!Number.isFinite(y)) y = 0;
      oBuf[n] = y;
    }
  }
}
