// op_xformerSat.worklet.js — Stage-3 op sidecar for the
// `xformerSat` op (catalog #139). **STAGE 2 — through-path topology +
// hysteresis branch.**
//
// Audio transformer character: volt-second core saturation (LF-only soft
// compression) + hysteresis loss (asymmetric low-order distortion) + HF
// leakage rolloff. Distinct from #111 transformerSim (memoryless
// Jiles–Atherton anhysteretic Langevin curve); this op ships the
// De Paiva 2011 frequency-dependent WDF model.
//
// PRIMARY (Tier-S, locked):
//   R. C. D. de Paiva, J. Pakarinen, V. Välimäki,
//   "Real-Time Audio Transformer Emulation for Virtual Analog Models,"
//   Proc. DAFx-11, Paris, 2011.
//   PDF: docs/primary_sources/transformers/DePaiva_2011_Real_Time_Audio_Transformer_Emulation.pdf
//   Memo: memory/depaiva_transformer_emulation.md
//
// PHYSICS WHY-LAYER:
//   B. Whitlock, "Audio Transformers" (Ballou Handbook chapter).
//   Memo: memory/whitlock_audio_transformers.md
//
// MODEL (paper §2, Figure 5 + Figure 6a/b — gyrator-capacitor dual):
//
//   Cc  = core permeance (NL capacitor in GC dual ≡ NL inductor Lm).
//         Saturation: Eq (15) EC(vc) = a·|vc|^n · sign(vc).
//                     Eq (16) Ce(vc) = Cc / (1 + a·|vc|^(n−1)).
//   Rc  = core loss (NL resistor — hysteresis).
//         Eq (17) IR(vr) = b·|vr|^m · sign(vr).
//         Eq (18) Rc(vr) = r  / (1 + b·|vr|^(m−1)).
//   Cw  = winding capacitance (linear).
//   Ll  = leakage inductance (linear; small relative to Lm).
//   Rs, Rs' = source + reflected-load DCR.
//
// REAL-TIME FORM (paper §4.3, Eq 34):
//   Implement the nonlinear capacitor via a variable-turns nonlinear
//   transformer with ratio
//        Nc(vc) = 1 / (1 + a·|vc|^(n−1))
//   so the wave-domain scattering reduces to one `pow` (or LUT) per
//   sample. The Rc branch uses delayed `vr[n−1]` (paper §3.3 unit-delay
//   remedy), avoiding any per-sample Newton iteration.
//
// STAGE-2 TOPOLOGY (through-path; fixes Stage-1 polarity):
//
//   Whitlock §5: at the LOAD side (what we tap), the transformer behaves
//   as a one-pole HIGH-PASS at LF — Lm shunts LF voltage below the
//   corner fc_lf = Rs / (2π·Lm). Under saturation Lm SHRINKS → fc_lf
//   shifts UP → LF response gets eaten more. That is the volt-second
//   compression.
//
//   Per-sample (sample-rate model):
//     xd        = drive · in
//     // Saturation tracker — flux-equivalent integrator (LP):
//     phi      += g_lf_base · (xd − phi)
//     sat       = a · phi^(n−1)              // n = 3 → phi·phi (branchless)
//     // Variable-turns nonlinear cap (Eq 34) drives HP corner up:
//     g_eff     = g_lf_base · (1 + sat)
//     R_hp      = clamp(1 − g_eff, 0, 0.99999)
//     // 1-pole HP through-path (DC-blocker form, movable corner):
//     yHp       = R_hp · yHp + (xd − xPrev)
//     xPrev     = xd
//     // Rc hysteresis loss (Eq 17, m = 3, delayed vr per §3.3):
//     ir        = b · vr_prev · vr_prev · sign(vr_prev)
//     yLoss     = yHp − LOSS_SCALE · ir
//     vr_prev   = yHp
//     // HF leakage rolloff (linear 1-pole LP, `air` modulates corner):
//     yHf      += aHf · (yLoss − yHf)
//     out       = yHf
//
//   Why two state lanes:
//     `phi` = LP-integrator that tracks accumulated flux magnitude →
//             feeds Eq 34 nonlinearity. NEVER tapped to output.
//     `yHp` = HP through-path; corner modulated by `phi`. THIS is what
//             the load resistor "sees" in Fig 5.
//
// PARAMETERS (full contract; matches catalog row #139):
//   drive    (−24..+36 dB,  default 0)   — input gain into the iron
//   coreSize (0.05..10,     default 1)   — Eq (15) `a`. Small ≈ Hammond
//                                          (sat ~30 Hz), large ≈ Fender
//                                          (sat ~100 Hz).
//   sourceZ  (1..10000 Ω,   default 600) — Rs. Sets base LF corner.
//   loss     (0..1,         default 0.3) — Eq (17) `b`. 0 = lossless
//                                          (line iso); high = "cooked"
//                                          Class-A character.
//   air      (0.1..8,       default 1)   — HF leakage corner multiplier
//                                          (1.0 ≈ 12 kHz). Stage 2 ships
//                                          1-pole; Stage 3 will swap to
//                                          a 2nd-order section so `air`
//                                          modulates Q, not corner.
//
// Exponents n,m baked at 3 (typical mid-range from paper Table 1 fits;
// not user-facing per memo §6 — exposing them invites unstable params).
// With n=m=3, |x|^(n−1) = x·x — branchless, no pow()/LUT needed.
//
// PAPER-VALIDATION SCOPE (memo §4):
//   Paper validates against TWO output transformers (Fender NSC041318
//   and Hammond T1750V/Vox-AC30). Recommended starter values for those
//   two are in memory/depaiva_transformer_emulation.md §6. `line` and
//   `micPre` operating regimes are engineering extrapolation — flagged
//   v0 in the catalog. Preset machinery itself is deferred (no other
//   sandbox op exposes presets; user controls are sufficient).
//
// DEFERRED to a future stage:
//   • 2nd-order leakage section so `air` modulates Q.
//   • Mirror primary/secondary topology (Fig 5 right half).
//   • LUT pathway for n ∈ [2.5, 4.5] (current branchless n=3 covers
//     Fender Table 1; Hammond fits at n ≈ 2.7 will need LUT/pow).
//   • Decomposition into reusable WDF adaptor primitives (after a 2nd
//     transformer-bearing op like #140 pultecEQ is in flight).

const DENORMAL = 1e-30;
const LOSS_SCALE = 0.25;       // empirical: scales b·vr² loss into
                                // through-path units; chosen so `loss`
                                // parameter range [0,4] covers "lossless"
                                // → "audibly cooked" without runaway.

// Default LF corner at coreSize=1, sourceZ=600 Ω.
// Paper §4.4 Fender fit: linear LF corner ~25 Hz unloaded; saturation
// region begins ~100 Hz under high drive.
const FC_LF_BASE_HZ = 25;

// Default HF leakage corner. Whitlock §4 + Fender NSC041318 ~12 kHz.
const FC_HF_BASE_HZ = 12000;

// Numeric guards for the 1-pole HP coefficient.
const G_HP_MAX = 0.999;        // upper bound on (1 - R) per sample
const G_HP_MIN = 1e-8;

export class XformerSatOp {
  static opId = 'xformerSat';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive',    default: 0   },  // dB
    { id: 'coreSize', default: 1   },  // a in Eq (15)
    { id: 'sourceZ',  default: 600 },  // Ω
    { id: 'loss',     default: 0.3 },  // b in Eq (17)
    { id: 'air',      default: 1   },  // HF corner multiplier
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;

    // User params (clamped in setParam).
    this._driveDb = 0;
    this._a       = 1;
    this._rs      = 600;
    this._b       = 0.3;
    this._air     = 1;

    // Derived (recomputed when params or sr change).
    this._driveLin = 1;
    this._gLfBase  = 0;   // 2π·fc_lf/sr at current sourceZ
    this._aHf      = 0;   // HF 1-pole LP coefficient

    // State:
    //   _phi    : LP flux-tracker integrator (= |saturation|² gauge).
    //   _yHp    : HP through-path output (Lm-shunt, movable corner).
    //   _xPrev  : prior post-drive input (DC-blocker delay).
    //   _yHf    : HF leakage 1-pole LP state.
    //   _vrPrev : prior `yHp` for Eq 17 hysteresis (§3.3 unit-delay).
    this._phi    = 0;
    this._yHp    = 0;
    this._xPrev  = 0;
    this._yHf    = 0;
    this._vrPrev = 0;

    this._recomputeDerived();
  }

  reset() {
    this._phi = 0;
    this._yHp = 0;
    this._xPrev = 0;
    this._yHf = 0;
    this._vrPrev = 0;
  }

  _recomputeDerived() {
    this._driveLin = Math.pow(10, this._driveDb / 20);

    // LF corner scales with sourceZ (Whitlock §3: fc_lf = Rs/(2π·Lm)).
    // Normalize so sourceZ=600 Ω → FC_LF_BASE_HZ.
    const rsRatio = this._rs / 600;
    const fcLf = FC_LF_BASE_HZ * rsRatio;
    let gLf = (2 * Math.PI * fcLf) / this.sr;
    if (gLf < G_HP_MIN) gLf = G_HP_MIN;
    if (gLf > 0.5)      gLf = 0.5;
    this._gLfBase = gLf;

    // HF 1-pole LP coefficient. Use `1 − exp(−2π·fc/sr)` form so the
    // coefficient stays in (0, 1) for any fc up to Nyquist — the simple
    // `2π·fc/sr` linearization breaks above ~sr/(4π) ≈ 3.8 kHz at 48 k.
    const fcHf = FC_HF_BASE_HZ * this._air;
    let aHf = 1 - Math.exp(-2 * Math.PI * fcHf / this.sr);
    if (aHf < 1e-6) aHf = 1e-6;
    if (aHf > 0.99999) aHf = 0.99999;
    this._aHf = aHf;
  }

  setParam(id, v) {
    let x = +v;
    if (!Number.isFinite(x)) {
      const def = XformerSatOp.params.find(p => p.id === id);
      x = def ? def.default : 0;
    }
    if (id === 'drive') {
      if (x < -24) x = -24;
      if (x >  36) x =  36;
      this._driveDb = x;
    } else if (id === 'coreSize') {
      if (x < 0.05) x = 0.05;
      if (x > 10)   x = 10;
      this._a = x;
    } else if (id === 'sourceZ') {
      if (x < 1)     x = 1;
      if (x > 10000) x = 10000;
      this._rs = x;
    } else if (id === 'loss') {
      // Cap at 1.0: above this the b·vr² term dominates the through-path
      // and the signal collapses (148% THD at loss=3 in smoke). 0.3
      // default ≈ Pultec EQP-1A measured ~3% THD at 30 Hz under LF boost.
      if (x < 0) x = 0;
      if (x > 1) x = 1;
      this._b = x;
    } else if (id === 'air') {
      if (x < 0.1) x = 0.1;
      if (x > 8)   x = 8;
      this._air = x;
    } else {
      return;
    }
    this._recomputeDerived();
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;

    const drv     = this._driveLin;
    const gLfBase = this._gLfBase;
    const aHf     = this._aHf;
    const a       = this._a;
    const b       = this._b;

    let phi    = this._phi;
    let yHp    = this._yHp;
    let xPrev  = this._xPrev;
    let yHf    = this._yHf;
    let vrPrev = this._vrPrev;

    for (let n = 0; n < N; n++) {
      const xin = iBuf ? iBuf[n] : 0;
      const xd  = drv * xin;

      // ── Flux tracker (LP integrator → saturation gauge) ───────────
      phi = phi + gLfBase * (xd - phi);
      if (phi < DENORMAL && phi > -DENORMAL) phi = 0;

      // ── Eq 34 nonlinear-cap → HP corner modulation ────────────────
      // n = 3 baked → |phi|^(n-1) = phi·phi (branchless).
      const sat = a * phi * phi;
      let gEff = gLfBase * (1 + sat);
      if (gEff > G_HP_MAX) gEff = G_HP_MAX;
      const Rhp = 1 - gEff;

      // ── 1-pole HP through-path (DC-blocker, movable corner) ───────
      yHp = Rhp * yHp + (xd - xPrev);
      xPrev = xd;
      if (yHp < DENORMAL && yHp > -DENORMAL) yHp = 0;

      // ── Rc hysteresis (Eq 17, m=3, §3.3 unit-delay) ───────────────
      // ir = b · |vr|^(m-1) · vr   (with m=3 → b · vr² · sign(vr)
      //                              ≡ b · vr · |vr|, branchless.)
      const ir = b * vrPrev * (vrPrev < 0 ? -vrPrev : vrPrev);
      const yLoss = yHp - LOSS_SCALE * ir;
      vrPrev = yHp;

      // ── HF leakage 1-pole LP (linear) ─────────────────────────────
      yHf = yHf + aHf * (yLoss - yHf);
      if (yHf < DENORMAL && yHf > -DENORMAL) yHf = 0;

      oBuf[n] = yHf;
    }

    this._phi    = phi;
    this._yHp    = yHp;
    this._xPrev  = xPrev;
    this._yHf    = yHf;
    this._vrPrev = vrPrev;
  }
}
