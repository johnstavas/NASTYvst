// op_fetVVR.worklet.js — Stage-3 op sidecar for the `fetVVR` op.
//
// #147 Dynamics — Phenomenological JFET voltage-variable-resistor gain
// cell modeling the UREI/UA 1176 family (2N3819 JFET in feedback or
// shunt-attenuator topology). Memoryless. Distinguishing trait vs
// optoCell / blackmerVCA / varMuTube:
//   - Sharp knee (high curveExponent default — FET pinch-off curve is
//     steeper than vari-mu Hill curve)
//   - Mixed 2H + 3H distortion (FET asymmetric conduction produces 2H,
//     pinch-off non-linearity produces 3H — both grow with compression
//     depth). Distinct from varMuTube (pure even-only 2H + 4H) and
//     blackmerVCA (configurable bias-induced 2H, no inherent 3H).
//   - "All buttons in" character available by cranking distortion2H and
//     distortion3H together.
//
// PRIMARY (opened 2026-04-26 via WebFetch):
//   1. Wikipedia "1176 Peak Limiter" — VERBATIM:
//      "uses a field-effect transistor (FET) to obtain gain reduction
//      arranged in a feedback configuration." Attack: "20 μs to 800 μs"
//      adjustable. Release: "50 ms to 1100 ms" with program-dependence.
//      "All buttons in" mode: ratio "between 12:1 and 20:1," produces
//      "a substantial increase of harmonic distortion" with "trademark
//      overdriven tone." Tier-B reference.
//
//   2. Wikipedia "JFET" — VERBATIM ohmic-region equation:
//      "I_D = (2 I_DSS / V_P²) · (V_GS - V_P - V_DS/2) · V_DS"
//      For small V_DS (FET as variable resistor):
//        Rds(V_GS) ≈ V_P² / (2 · I_DSS · (V_GS - V_P))
//      Diverges as V_GS → V_P (pinch-off → infinite resistance).
//      For 2N3819 family: V_P ≈ -3 V, I_DSS ≈ 10 mA,
//        Rds(V_GS=0)   ≈ 150 Ω (Rds_on, minimum)
//        Rds(V_GS=-1)  ≈ 225 Ω
//        Rds(V_GS=-2)  ≈ 450 Ω
//        Rds(V_GS=-3)  → ∞ (cutoff)
//      Tier-A textbook content for the equation; tube datasheet
//      values from common knowledge (datasheet PDF inaccessible in
//      this session).
//
//   3. Catalog locked primary citations (could not be opened verbatim):
//      - UREI/UA 1176LN service manual — Tier-S OEM manufacturer doc;
//        archive.org PDF mirrors all 404 in this session.
//      - 2N3819 N-channel JFET datasheet — Tier-S; Frank Pocnet 404'd.
//      Logged research-debt.
//
// MATH-BY-DEFINITION (declared per ship-protocol):
//   The Hill-function gain curve `1/(1 + (cv/cutoffScale)^β)` is the
//   canonical soft-knee compression form per Giannoulis-Massberg-Reiss
//   JAES 2012 §Soft Knee (Tier-A peer-reviewed, accessed in this
//   session). At higher exponent β=2 (default for fetVVR vs 1.5 for
//   varMuTube), this matches the steeper Rds(V_GS) curve approaching
//   pinch-off. Distortion model — combined `bias_2·|y|` (even, 2H+4H)
//   and `bias_3·y·|y|` (odd, 3H+5H) — is phenomenological. Anchored to
//   general JFET physics (asymmetric channel conduction → even harmonic;
//   pinch-off non-linearity → odd harmonic) and 1176 reputation for
//   "trademark overdriven tone" with both even and odd character. No
//   single peer-reviewed paper specifies precise coefficient values for
//   the 1176 distortion-vs-comprDepth relationship that I could verify
//   in this session. Logged P1 in research-debt.
//
// AUTHORING SHAPE:
//   Inputs  : audio       (audio — signal to gain-control)
//             cv          (audio — control voltage; positive = more
//                                  compression. cv=0 → unity gain.
//                                  Typical sidechain range 0..30 V.)
//   Outputs : out         (audio)
//   Params  :
//     cutoffScale   (default 5,    range 0.5..30) — V0 in Hill function;
//                                                   smaller default than
//                                                   varMuTube (more
//                                                   sensitive sidechain).
//     curveExponent (default 2.0,  range 1..4)    — β; steeper than
//                                                   varMuTube's 1.5,
//                                                   matching FET pinch-off.
//     distortion2H  (default 0.10, range 0..0.5)  — even-harmonic amount
//                                                   (2H + 4H from |y|).
//     distortion3H  (default 0.05, range 0..0.5)  — odd-harmonic amount
//                                                   (3H + 5H from y·|y|).
//                                                   Note: "all buttons
//                                                   in" character ≈
//                                                   distortion2H=0.3,
//                                                   distortion3H=0.2.
//     trim          (default 0,    range -24..24) — output trim in dB.
//
// State: NONE — memoryless. getLatencySamples() = 0.
//
// Algorithm (per-sample):
//   1. cvPos = max(0, cv)
//   2. norm = cvPos / cutoffScale
//   3. gain = 1 / (1 + norm^curveExponent)
//   4. yClean = x · gain
//   5. comprDepth = 1 - gain
//   6. yEven = distortion2H · comprDepth · |yClean|     // DC + 2H + 4H
//   7. yOdd  = distortion3H · comprDepth · yClean · |yClean|  // 3H + 5H
//                                                     //   (sign(yClean)·y² →
//                                                     //   odd function of y)
//   8. out = (yClean + yEven + yOdd) · trimLin

const LN10_OVER_20 = 0.11512925464970228;

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export class FetVVROp {
  static opId = 'fetVVR';
  static inputs  = Object.freeze([
    { id: 'audio', kind: 'audio' },
    { id: 'cv',    kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoffScale',   default: 5    },
    { id: 'curveExponent', default: 2.0  },
    { id: 'distortion2H',  default: 0.10 },
    { id: 'distortion3H',  default: 0.05 },
    { id: 'trim',          default: 0    },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._cutoffScale   = 5;
    this._curveExponent = 2.0;
    this._distortion2H  = 0.10;
    this._distortion3H  = 0.05;
    this._trim          = 0;
    this._trimLin       = 1.0;
    this._invCutoff     = 1 / 5;
  }

  reset() { /* memoryless — nothing to reset */ }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'cutoffScale':
        this._cutoffScale = clip(x, 0.5, 30);
        this._invCutoff   = 1 / this._cutoffScale;
        break;
      case 'curveExponent': this._curveExponent = clip(x, 1.0, 4.0); break;
      case 'distortion2H':  this._distortion2H  = clip(x, 0,   0.5); break;
      case 'distortion3H':  this._distortion3H  = clip(x, 0,   0.5); break;
      case 'trim':
        this._trim    = clip(x, -24, 24);
        this._trimLin = Math.exp(this._trim * LN10_OVER_20);
        break;
      default: return;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;
    const audioCh = inputs.audio;
    const cvCh    = inputs.cv;
    const invCut  = this._invCutoff;
    const beta    = this._curveExponent;
    const d2      = this._distortion2H;
    const d3      = this._distortion3H;
    const trimLin = this._trimLin;

    if (!audioCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x  = audioCh[i];
      const cv = cvCh ? cvCh[i] : 0;
      // Half-wave rectify cv (FET only attenuates on positive control
      // commands; negative cv → unity gain).
      const cvPos = (cv > 0 && Number.isFinite(cv)) ? cv : 0;
      const norm = cvPos * invCut;
      const normPowBeta = norm > 0 ? Math.pow(norm, beta) : 0;
      const gain = 1 / (1 + normPowBeta);
      const yClean = x * gain;
      const comprDepth = 1 - gain;
      const absY = yClean < 0 ? -yClean : yClean;
      // Even harmonic content (FET asymmetric conduction).
      const yEven = d2 * comprDepth * absY;
      // Odd harmonic content (FET pinch-off non-linearity). y·|y| is an
      // odd function of y → produces 3H + 5H + ... (sin·|sin| Fourier).
      const yOdd  = d3 * comprDepth * yClean * absY;
      outCh[i] = (yClean + yEven + yOdd) * trimLin;
    }
  }
}
