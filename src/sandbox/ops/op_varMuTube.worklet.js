// op_varMuTube.worklet.js — Stage-3 op sidecar for the `varMuTube` op.
//
// #145 Dynamics — Phenomenological variable-mu tube gain-reduction cell
// modeling Manley Variable Mu / Fairchild 670 / Altec 436 family. The
// canonical "tube compressor" character: smooth knee, gentle ratio, and
// ** distortion that couples with compression depth ** (heavier GR =
// more 2H content, because the tube is operating closer to grid cutoff).
// Distinct from optoCell (clean LDR-divider mapping) and blackmerVCA
// (clean log-add-antilog with optional bias-mismatch character).
//
// PRIMARY (opened 2026-04-26 via WebFetch):
//   1. Giannoulis, D., Massberg, M., Reiss, J. D., "Digital Dynamic
//      Range Compressor Design — A Tutorial and Analysis," JAES
//      60(6):399–408, June 2012 (AES E-Library elib:16354). Tier-A
//      peer-reviewed JAES tutorial. Already accessed in this session
//      (anchors blackmerVCA + gateStateMachine topologies). Used here
//      as topology anchor for the soft-knee Hill-function gain curve.
//      Section: §Static Compressor Curve, §Soft Knee.
//
//   2. Catalog locked primary citations (could not be opened verbatim
//      in this session due to repeated 404/binary-PDF failures):
//      - Pakarinen, J. & Yeh, D. T., "A Review of Digital Techniques
//        for Modeling Vacuum-Tube Guitar Amplifiers," Computer Music
//        Journal 33(2):85–100, MIT Press, 2009. DOI: 10.1162/comj.
//        2009.33.2.85. Tier-A. Variable-mu §III treatment cited but
//        not verifiable in this session. Logged as research-debt.
//      - GE/Sylvania 6386 Dual Remote-Cutoff Triode Datasheet.
//        Tier-S manufacturer document. Frank Pocnet PDF mirror
//        404'd 2026-04-26; canonical document but inaccessible.
//        Logged as research-debt.
//      - Manley Labs Variable Mu / Fairchild 660–670 service
//        documentation. Tier-S OEM but not in public access.
//
// MATH-BY-DEFINITION (declared per ship-protocol):
//   The static gain curve (Hill function `1 / (1 + (cv/cutoffScale)^β)`)
//   is the canonical soft-knee compression form per Giannoulis-Massberg-
//   Reiss 2012 §Soft Knee. The distortion-couples-with-compression-depth
//   relationship is documented general tube physics (Langford-Smith
//   "Radiotron Designer's Handbook" 4e Ch.13; Pakarinen-Yeh CMJ 2009
//   §III) but no single peer-reviewed paper specifies the exact
//   coupling-coefficient values for the Manley/Fairchild 670 vari-mu
//   topology that I could verify in this session. Phenomenological
//   model below is calibrated to subjective character (gentle 2H at
//   moderate GR, more pronounced at heavy GR). Logged P1 in research-
//   debt — when the Pakarinen-Yeh paper, Manley service docs, or 6386
//   datasheet are accessible verbatim, V2 upgrade tunes the curves.
//
// AUTHORING SHAPE:
//   Inputs  : audio  (audio — signal to gain-control)
//             cv     (audio — control voltage; positive = more
//                              compression. cv=0 → unity gain. Typical
//                              sidechain range 0..30 V equivalent.)
//   Outputs : out    (audio)
//   Params  :
//     cutoffScale   (default 10,   range 1..50)   — V0 in Hill function;
//                                                   sets where -6 dB knee
//                                                   falls. Smaller =
//                                                   sensitive (early
//                                                   compression onset).
//     curveExponent (default 1.5,  range 0.5..3)  — β in Hill function;
//                                                   sets knee softness.
//                                                   1.0 = soft / gentle;
//                                                   3.0 = sharper.
//     distortion    (default 0.1,  range 0..0.5)  — 2H amount at full
//                                                   compression depth.
//                                                   Scales linearly with
//                                                   (1 - gain). Default
//                                                   0.1 ≈ moderate vari-mu
//                                                   character; 0 = clean
//                                                   compressor.
//     trim          (default 0,    range -24..+24) — output trim in dB.
//
// State: NONE — memoryless. getLatencySamples() = 0.
//
// Algorithm (per-sample):
//   1. cvPos = max(0, cv)                             // tube only compresses
//                                                     //   on positive bias-
//                                                     //   reduction commands;
//                                                     //   negative cv → unity
//   2. norm = cvPos / cutoffScale                     // normalized control
//   3. gain = 1 / (1 + norm^curveExponent)            // Hill function gain
//                                                     //   curve. cv=0 → 1.0;
//                                                     //   cv=cutoffScale → 0.5
//                                                     //   (-6 dB); cv→∞ → 0
//   4. yClean = x · gain                              // apply gain reduction
//   5. comprDepth = 1 - gain                          // 0 (no GR) to ~1
//   6. distScale = distortion · comprDepth            // 2H scales with GR
//   7. yChar = distScale · |yClean|                   // |y| Fourier produces
//                                                     //   DC + 2H + 4H even
//                                                     //   harmonics (same
//                                                     //   signature as
//                                                     //   blackmerVCA)
//   8. out = (yClean + yChar) · trimLin               // apply output trim

const LN10_OVER_20 = 0.11512925464970228;

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export class VarMuTubeOp {
  static opId = 'varMuTube';
  static inputs  = Object.freeze([
    { id: 'audio', kind: 'audio' },
    { id: 'cv',    kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoffScale',   default: 10  },
    { id: 'curveExponent', default: 1.5 },
    { id: 'distortion',    default: 0.1 },
    { id: 'trim',          default: 0   },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._cutoffScale   = 10;
    this._curveExponent = 1.5;
    this._distortion    = 0.1;
    this._trim          = 0;
    this._trimLin       = 1.0;
    this._invCutoff     = 0.1;
  }

  reset() { /* memoryless — nothing to reset */ }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'cutoffScale':
        this._cutoffScale = clip(x, 1, 50);
        this._invCutoff   = 1 / this._cutoffScale;
        break;
      case 'curveExponent': this._curveExponent = clip(x, 0.5, 3.0); break;
      case 'distortion':    this._distortion    = clip(x, 0,   0.5); break;
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
    const dist    = this._distortion;
    const trimLin = this._trimLin;

    if (!audioCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x  = audioCh[i];
      const cv = cvCh ? cvCh[i] : 0;
      // Half-wave rectify cv (tube vari-mu only compresses on positive
      // grid-bias-reduction commands; negative cv → no compression).
      const cvPos = (cv > 0 && Number.isFinite(cv)) ? cv : 0;
      // Hill-function gain curve: 1 / (1 + (cv/V0)^β).
      const norm = cvPos * invCut;
      // Math.pow(norm, β) handles norm=0 cleanly (returns 0).
      const normPowBeta = norm > 0 ? Math.pow(norm, beta) : 0;
      const gain = 1 / (1 + normPowBeta);
      const yClean = x * gain;
      // Distortion couples with compression depth: full GR → full dist.
      const comprDepth = 1 - gain;
      const distScale  = dist * comprDepth;
      const absY  = yClean < 0 ? -yClean : yClean;
      const yChar = distScale * absY;
      outCh[i] = (yClean + yChar) * trimLin;
    }
  }
}
