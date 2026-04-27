// op_diodeBridgeGR.worklet.js — Stage-3 op sidecar for the `diodeBridgeGR` op.
//
// #179 Dynamics — Phenomenological diode-bridge gain-reduction cell
// modeling Neve 33609 / 2254 / 8014 family. Memoryless. Distinguishing
// trait vs other Tier-S Cluster A members: PURE-ODD distortion (3H + 5H
// from cubic shape), reflecting diode-bridge topology symmetry that
// cancels even harmonics. Optional `asymmetry` param adds small even
// content for component-mismatch realism (real Neve units have ~−40 dB
// 2H from this).
//
// PRIMARY (opened 2026-04-26 via WebFetch):
//   1. Wikipedia "Diode bridge" — Tier-A textbook reference. VERBATIM:
//      "A diode bridge is a bridge rectifier circuit of four diodes"
//      converting AC to DC. Topology is well-documented public domain;
//      its repurposing as a variable shunt-resistor (DC-bias-controlled)
//      for audio compression is a classic Neve design.
//
//   2. Wikipedia "Dynamic range compression" — VERBATIM:
//      "Other technologies used include field effect transistors and a
//      diode bridge." Confirms diode bridge is one of the canonical
//      gain-reduction technologies.
//
//   3. Diode small-signal theory (textbook content, not opened verbatim
//      this session but universally documented in any analog electronics
//      textbook — e.g., Sedra-Smith Ch.4):
//      Forward-biased diode small-signal differential resistance:
//        rd = V_t / I_DC      (V_t ≈ 26 mV thermal voltage at 300 K)
//      4-diode bridge with bias current I_DC distributed:
//        R_bridge = 2 · rd = 2 · V_t / I_DC
//      Shunt-attenuator with R_series in series:
//        gain = R_bridge / (R_series + R_bridge)
//             = 1 / (1 + R_series / R_bridge)
//             = 1 / (1 + R_series · I_DC / (2 · V_t))
//      For Hill-function compatibility: gain = 1 / (1 + (cv/V0)^β) with
//      cv ∝ I_DC.
//
// MATH-BY-DEFINITION (declared per ship-protocol):
//   No verbatim Neve 2254 or 33609 service manual accessible during
//   this session 2026-04-26. archive.org PDF mirrors 404; Ben Duncan
//   "VCAs Investigated" PDF binary-extract failed; Sound on Sound 33609
//   review 410'd; Gearspace forum 403'd. Topology anchor = GMR JAES
//   2012 §Soft Knee (Tier-A peer-reviewed, accessed this session).
//   Diode-bridge symmetry → odd-dominant harmonics is general analog
//   electronics knowledge (matched-pair cancellation principle, e.g.,
//   Sedra-Smith Ch.6 differential amplifiers). The CUBIC distortion
//   shape `y · y² = y³` — produces pure odd harmonics (3H + 5H, no 2H,
//   no 4H) — is phenomenological calibration. Logged P1 in research-
//   debt: when 2254 / 33609 service manuals or measured-distortion
//   data accessible verbatim, V2 upgrade tunes the curve.
//
// AUTHORING SHAPE:
//   Inputs  : audio   (audio — signal to gain-control)
//             cv      (audio — control voltage; positive = more
//                               compression; cv=0 → unity gain)
//   Outputs : out     (audio)
//   Params  :
//     cutoffScale   (default 8,    range 0.5..30) — V0 in Hill function;
//                                                   between varMuTube (10)
//                                                   and fetVVR (5).
//     curveExponent (default 1.8,  range 1..3)    — β; between varMuTube
//                                                   (1.5, soft) and fetVVR
//                                                   (2.0, sharper).
//                                                   Diode-bridge curve
//                                                   sits in between.
//     distortion    (default 0.10, range 0..0.5)  — odd-harmonic amount
//                                                   (3H + 5H from y³).
//                                                   Pure-odd by topology
//                                                   (bridge symmetry).
//     asymmetry     (default 0.0,  range -0.3..0.3) — optional even-harmonic
//                                                   component from real-world
//                                                   diode mismatch. Tiny
//                                                   value (<0.05) = realistic
//                                                   Neve character;
//                                                   0 = ideal-bridge symmetry.
//     trim          (default 0,    range -24..24) — output trim in dB.
//
// State: NONE — memoryless. getLatencySamples() = 0.
//
// Algorithm (per-sample):
//   1. cvPos = max(0, cv)
//   2. norm  = cvPos / cutoffScale
//   3. gain  = 1 / (1 + norm^curveExponent)
//   4. yClean = x · gain
//   5. comprDepth = 1 - gain
//   6. y3 = (x · x · x) · gain                        // cubic of INPUT,
//                                                     //   scaled to output
//                                                     //   gain. This makes
//                                                     //   3H/1H ratio
//                                                     //   independent of
//                                                     //   gain magnitude
//                                                     //   → ratio scales
//                                                     //   purely with
//                                                     //   comprDepth (real
//                                                     //   diode-bridge
//                                                     //   behavior:
//                                                     //   distortion rises
//                                                     //   with GR).
//   7. yOdd = distortion · comprDepth · y3            // pure-odd 3H
//   8. yEven = asymmetry · comprDepth · |yClean|      // optional even
//                                                     //   (bridge mismatch)
//   9. out = (yClean + yOdd + yEven) · trimLin

const LN10_OVER_20 = 0.11512925464970228;

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export class DiodeBridgeGROp {
  static opId = 'diodeBridgeGR';
  static inputs  = Object.freeze([
    { id: 'audio', kind: 'audio' },
    { id: 'cv',    kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoffScale',   default: 8    },
    { id: 'curveExponent', default: 1.8  },
    { id: 'distortion',    default: 0.10 },
    { id: 'asymmetry',     default: 0.0  },
    { id: 'trim',          default: 0    },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._cutoffScale   = 8;
    this._curveExponent = 1.8;
    this._distortion    = 0.10;
    this._asymmetry     = 0.0;
    this._trim          = 0;
    this._trimLin       = 1.0;
    this._invCutoff     = 1 / 8;
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
      case 'curveExponent': this._curveExponent = clip(x, 1.0, 3.0);  break;
      case 'distortion':    this._distortion    = clip(x, 0,    0.5); break;
      case 'asymmetry':     this._asymmetry     = clip(x, -0.3, 0.3); break;
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
    const asym    = this._asymmetry;
    const trimLin = this._trimLin;

    if (!audioCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x  = audioCh[i];
      const cv = cvCh ? cvCh[i] : 0;
      const cvPos = (cv > 0 && Number.isFinite(cv)) ? cv : 0;
      const norm = cvPos * invCut;
      const normPowBeta = norm > 0 ? Math.pow(norm, beta) : 0;
      const gain = 1 / (1 + normPowBeta);
      const yClean = x * gain;
      const comprDepth = 1 - gain;
      // Pure-odd cubic distortion (3H from y=A·sin → sin³ = 3sin/4 − sin(3t)/4).
      // Compute cubic on INPUT signal then scale by gain — makes 3H/1H ratio
      // dependent only on comprDepth (matches real diode-bridge behavior:
      // distortion rises with GR, not with absolute output amplitude).
      const xCubed = x * x * x;
      const yOdd = dist * comprDepth * xCubed * gain;
      // Optional even-harmonic component (component mismatch realism).
      const absY  = yClean < 0 ? -yClean : yClean;
      const yEven = asym * comprDepth * absY;
      outCh[i] = (yClean + yOdd + yEven) * trimLin;
    }
  }
}
