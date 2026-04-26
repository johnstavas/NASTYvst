// op_korg35.worklet.js — Stage-3 op sidecar for the `korg35` op (v2-full).
//
// Korg-35 lowpass filter (Korg MS-10 / MS-20 early board, Korg 700, KARP).
// Sallen-Key topology — but NOT the textbook Pirkle/Tarr SK. This op is
// derived directly from Tim Stinchcombe's bench + SPICE-validated reverse
// engineering of the actual Korg-35 IC schematic.
//
// PRIMARY (locked Tier-S):
//   Stinchcombe, T. — "A study of the Korg MS10 & MS20 Filters" (2008+).
//   Local: docs/primary_sources/stinchcombe/MS20_study.pdf
//   Memory pointer: memory/stinchcombe_korg_moog_filter_studies.md
//
// THREE STRUCTURAL CORRECTIONS vs the prior v2-partial Faust port:
//
//   (C1) SK loading constant a = 7/3, not 2.   [§2.2, eq. (8), p.12]
//        Korg deliberately built the SK with R₁ = R₂/3 and C₁ = 3·C₂ —
//        i.e. unequal R, unequal C. The textbook "equal-R-equal-C SK"
//        gives the wrong characteristic polynomial. The denominator is
//          s²/ωc² + (7/3 − k₁k₂)·s/ωc + 1
//        which moves the self-oscillation gain threshold and changes
//        the resonance lineshape vs an a=2 SK.
//
//   (C2) Forward-path diode shaper.            [§5, pp.30–31]
//        The OTA-board MS-20 puts its diode pair across the OTA output
//        (feedback). The Korg-35 board puts it inside the main forward-
//        path gain element of the SK (a 2N3904 with R_f=270k / R_e=4.7k).
//        Stage gain ≈ 1+270/4.7 ≈ 58. The 1N4148 pair clamps the swing
//        at roughly ±0.5 V (one diode drop). The shape is a smooth
//        soft-knee saturator on V₃ (the second integrator output):
//          g(V₃) = V₃ + V_d · tanh((gain−1)·V₃ / V_d)
//        Below ±V_d/(gain−1) ≈ 9 mV g'≈gain (high loop gain → resonance
//        peak); past the knee g'→1 (loop gain collapses → ringing decays).
//        That signal-dependent loop gain is the source of the MS-20 honk
//        and the asymmetric on-resonance lineshape.
//
//   (C3) Stinchcombe cutoff law.                [§3.2, p.29]
//        Real MS-20 cutoff is exponential in the front-panel V_f:
//          f_c = 87.0 · exp(V_f / 1.3)   Hz, V_f ∈ [−5, +5]
//        → 2 Hz at the bottom, ≈ 4070 Hz at the top. We map normFreq
//        ∈ [0,1] → V_f = 10·normFreq − 5 so the panel sweep matches
//        the documented MS-20 range, not the Faust 20 Hz–20 kHz default.
//
// ACKNOWLEDGED COMPROMISE — one-sample lag on K_dyn:
//   The "true" topology has g(V₃) inside the SK feedback loop, which
//   makes the per-sample TPT solve an implicit nonlinear equation
//   (algebraic loop with a tanh inside it). To stay branch-free / no-
//   iterate / zero-allocation, we evaluate g'(·) on the PREVIOUS sample's
//   y2 (V₃) and use that linearised K_dyn = k₂·g'(y2_prev) for the
//   current sample's α₀. The shaper itself still runs on the current
//   sample's y2. This is the same compromise Vadim Zavalishin's "ZDF
//   with linearised feedback" textbook examples use, and it is stable
//   for the slew rates a Korg-35 actually sees.
//
// DEFERRED (NOT in this op):
//   §4 signal-dependent f_c modulation (Q2/Q3 transistor variable-R
//   pair drift under audio rate). No closed-form in the paper; would
//   require numeric fit. Tracked in qc_backlog.md as a v3 follow-up.
//
// AUTHORING SHAPE:
//   normFreq ∈ [0,1] — maps to V_f ∈ [−5,+5] → f_c ∈ [2 Hz, 4070 Hz].
//   Q ∈ [0.7, 10]    — internal K = (7/3)·(Q−1/√2)/(10−1/√2), clamped
//                      to (0, 7/3 − ε). Self-oscillation near Q=10.
//   trim ∈ [−24,+12] dB — post-gain.
//
// ALGORITHM (per sample; state {s1, s2, y2_prev}):
//   // 1) Linearise diode shaper at last-sample y2:
//   arg_p   = (gain−1)·y2_prev / V_d
//   th_p    = tanh(arg_p)
//   gprime  = 1 + (gain−1)·(1 − th_p²)
//   K_dyn   = K · gprime
//   // 2) TPT integrators with corrected SK polynomial (a = 7/3):
//   alpha0  = (1+G) / (1 + (7/3 − K_dyn)·G + G²)
//   s2_eff  = s2 / (1+G)
//   y1      = alpha0 · ( G·x + s1 + G·(1/3 − K_dyn)·s2_eff )
//   y2      = ( G·y1 + s2 ) / (1+G)
//   // 3) Forward-path diode shaper on V₃ = y2:
//   y_out   = y2 + V_d · tanh((gain−1)·y2 / V_d)
//   // 4) Trapezoidal state update:
//   s1     ← 2·y1 − s1
//   s2     ← 2·y2 − s2
//   y2_prev ← y2

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

const A_LOADING  = 7.0 / 3.0;            // §2.2 eq. (8): SK a-constant for R₁=R₂/3, C₁=3·C₂
const M_FB       = 1.0 / 3.0;            // R₁/R₂ — feedback summing weight on V₃
const DIODE_GAIN = 58.0;                 // §5 p.31: 1 + 270k/4.7k forward-path stage gain
const DIODE_VD   = 0.5;                  // §5 p.31: 1N4148 drop ≈ 0.5 V
const FC_BASE    = 87.0;                 // §3.2 p.29
const FC_TAU     = 1.3;                  // §3.2 p.29

export class Korg35Op {
  static opId = 'korg35';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'normFreq', default: 0.5 },    // V_f = 0 → f_c ≈ 87 Hz at default
    { id: 'Q',        default: 3.5 },
    { id: 'trim',     default: 0.0 },    // dB
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._normFreq = 0.5;
    this._Q = 3.5;
    this._trim = 0.0;
    this.s1 = 0; this.s2 = 0; this.y2_prev = 0;
    this._cacheValid = false;
    this._recomputeCoeffs();
  }

  reset() { this.s1 = 0; this.s2 = 0; this.y2_prev = 0; }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'normFreq': this._normFreq = clip(x, 0,    1);  this._cacheValid = false; break;
      case 'Q':        this._Q        = clip(x, 0.7,  10); this._cacheValid = false; break;
      case 'trim':     this._trim     = clip(x, -24,  12); break;
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoeffs() {
    const sr = this.sr || 48000;
    const T = 1 / sr;
    // (C3) Stinchcombe cutoff law: V_f ∈ [−5,+5], f_c = 87·exp(V_f/1.3).
    const V_f  = 10 * this._normFreq - 5;
    const f_c  = FC_BASE * Math.exp(V_f / FC_TAU);
    // Pre-warp guarded against tan singularity at Nyquist.
    const wd     = 2 * Math.PI * f_c;
    const preArg = Math.min(wd * T / 2, Math.PI / 2 - 1e-4);
    const g      = Math.tan(preArg);
    const G      = g / (1 + g);
    // Q → K (resonance attenuator k₂). Clamp short of (7/3) so the
    // linear-region pole-pair stays inside the LHP; nonlinearity
    // (forward-path diodes) absorbs the rest as the user pushes Q.
    const invSqrt2 = 1 / Math.sqrt(2);
    const Kraw = A_LOADING * (this._Q - invSqrt2) / (10 - invSqrt2);
    const K    = clip(Kraw, 0, A_LOADING - 1e-3);
    this._G            = G;
    this._invOnePlusG  = 1 / (1 + G);
    this._K            = K;
    this._cacheValid   = true;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }
    if (!this._cacheValid) this._recomputeCoeffs();

    const trimLin     = Math.pow(10, this._trim / 20);
    const G           = this._G;
    const invOnePlusG = this._invOnePlusG;
    const K           = this._K;
    const dGm1        = DIODE_GAIN - 1;
    const invVd       = 1 / DIODE_VD;

    let s1 = this.s1, s2 = this.s2, y2_prev = this.y2_prev;

    for (let i = 0; i < N; i++) {
      const x = inCh[i];

      // (1) Linearise forward-path diode shaper at last sample's y2 (V₃):
      const arg_p  = dGm1 * y2_prev * invVd;
      const th_p   = Math.tanh(arg_p);
      const gprime = 1 + dGm1 * (1 - th_p * th_p);
      const K_dyn  = K * gprime;

      // (2) TPT solve with Stinchcombe SK polynomial (a = 7/3):
      //     denominator coefficient for s/ωc is (a − K_dyn) = (7/3 − K_dyn).
      const alpha0 = (1 + G) / (1 + (A_LOADING - K_dyn) * G + G * G);
      const s2_eff = s2 * invOnePlusG;
      const y1     = alpha0 * (G * x + s1 + G * (M_FB - K_dyn) * s2_eff);
      const y2     = (G * y1 + s2) * invOnePlusG;

      // (3) Forward-path diode shaper on V₃ = y2 (current sample):
      const arg   = dGm1 * y2 * invVd;
      const y_out = y2 + DIODE_VD * Math.tanh(arg);

      // (4) Trapezoidal state updates:
      s1 = 2 * y1 - s1;
      s2 = 2 * y2 - s2;
      y2_prev = y2;

      outCh[i] = trimLin * y_out;
    }
    this.s1 = s1; this.s2 = s2; this.y2_prev = y2_prev;
  }
}
