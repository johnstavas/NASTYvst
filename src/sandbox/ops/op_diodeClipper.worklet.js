// op_diodeClipper.worklet.js — Stage-3 op sidecar for the `diodeClipper` op.
//
// Character / drive stage. Closed-form arcsinh diode clipper, the
// canonical Tube Screamer / Rat / Big Muff / Klon foundation primitive.
//
// Math: derived from Shockley diode equation and op-amp feedback-path
// analysis. For an op-amp inverting stage with anti-parallel diodes in
// the feedback path:
//
//   I_d(v) = 2·I_s·sinh(v / (η·V_t))     (anti-parallel pair)
//   v_in = v_out · (1 + R_f·I_s/V_t · sinh(v_out/V_t)) ≈ R_f·I_s·sinh(v_out/V_t)
//   v_out ≈ η·V_t · arcsinh(v_in / (η·V_t·R_f·I_s))
//
// Collapsing all physical constants (η, V_t, R_f, I_s) into a single
// `drive` coefficient and peak-normalizing so |y|=1 at x=±1 gives:
//
//   y_sym(x) = arcsinh(drive · x) / arcsinh(drive)
//
// Asymmetric clipping (Tube Screamer signature: 1 diode positive, 2
// diodes negative, etc.) is modeled by reducing the effective drive on
// the negative half-cycle: the negative side stays more linear, so its
// peak is lower than the positive side.
//
//   driveP = drive
//   driveN = drive · (1 - asym)
//
// Distinct from saturate (Padé tanh) and softLimit (threshold-Padé):
//   - Padé: rational, even-derivative continuous to all orders.
//   - arcsinh: log-asymptotic past knee — slower roll-off than tanh,
//     producing the "transparent up to threshold, then squeezed" knee
//     that distinguishes diode pedals from tube/transistor stages.
//   - asym: lets one op author Klon (sym) → Tube Screamer (mild asym)
//     → Rat (heavy asym) → Big Muff stage (very asym + drive). Same
//     primitive, three knobs.
//
// Primary citations:
//   - Shockley diode equation: Sedra-Smith "Microelectronic Circuits"
//     6e §3.2 / W. Shockley, Bell Sys Tech J 28 (1949) — universal.
//   - Closed-form arcsinh: Yeh DAFx 2008 "Simulation of the diode
//     limiter in guitar distortion circuits" + Yeh-Smith DAFx 2007
//     "Simulating guitar distortion circuits using wave digital and
//     nonlinear state-space formulations".
//   - Asymmetric extensions: Pakarinen-Yeh DAFx 2009 "A review of
//     digital techniques for modeling vacuum-tube guitar amplifiers".
//
// Stateless: arcsinh is memoryless. No reset state, no denormal concern.

export class DiodeClipperOp {
  static opId = 'diodeClipper';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive', default: 1 },
    { id: 'asym',  default: 0 },
    { id: 'trim',  default: 0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._drive   = 1;
    this._asym    = 0;
    this._trimLin = 1;  // 10^(0/20)
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    if (id === 'drive') {
      const x = +v;
      this._drive = Number.isFinite(x) ? Math.max(0.01, x) : 1;
    } else if (id === 'asym') {
      const x = +v;
      this._asym = Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
    } else if (id === 'trim') {
      const x = +v;
      this._trimLin = Number.isFinite(x) ? Math.pow(10, x / 20) : 1;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const driveP = this._drive;
    const driveN = this._drive * (1 - this._asym);
    const trimLin = this._trimLin;
    // Peak normalization: at x=+1, y = arcsinh(driveP)/arcsinh(driveP) = 1.
    // arcsinh(0) = 0 so guard against drive→0 (clamped above to ≥0.01,
    // arcsinh(0.01) ≈ 0.01, finite). Math.asinh available in modern JS.
    const normP = 1 / Math.asinh(driveP);
    // Negative side: even if driveN→0, arcsinh(driveN·x) → driveN·x and
    // we need the same normalization basis (so positive and negative
    // share scale). Use normP throughout — at asym=0 driveN=driveP and
    // peaks match; at asym=1 driveN=0 and negative side is fully linear
    // with amplitude ~driveN/arcsinh(driveP)=0 → silence on neg, which
    // is the extreme half-wave-rectifier limit case.
    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      const d = x >= 0 ? driveP : driveN;
      // arcsinh(d·x) — odd function, so sign carries through.
      outCh[i] = trimLin * normP * Math.asinh(d * x);
    }
  }
}
