// op_correlation.worklet.js — Stage-3 op sidecar for the `correlation` op.
//
// Catalog #56 (Analysis / Spectral, stereo metering). Pearson correlation
// coefficient between L and R channels, smoothed by a one-pole on each
// of the three running expectations:
//
//   ρ(t) = E[LR] / √( E[L²] · E[R²] )
//
// References:
//   - IEC 60268-18 (stereo programme-level metering) defines the
//     correlation meter as a running Pearson coefficient on linear
//     samples (no weighting, no AC-coupling — we're asking about
//     instantaneous L/R sample coherence, not loudness).
//   - EBU Tech 3341 V4 app. notes treat correlation as a companion
//     display to LUFS; typical integration 300 ms.
//   - DAFX (Zölzer) Ch. 11 (Spatial Effects) uses the same formula
//     for mid/side diagnostics.
//   - Canon:loudness §1 — the per-channel E[x²] averager is exactly
//     the RMS one-pole primitive; reused here for E[LR] too.
//
// MATH
//
//   Three running expectations, all one-pole-smoothed with the same τ:
//     eLL[n] = oma·L²   + a·eLL[n-1]
//     eRR[n] = oma·R²   + a·eRR[n-1]
//     eLR[n] = oma·L·R  + a·eLR[n-1]
//
//   where a = exp(-1 / (τ·sr)), oma = 1 − a, τ = timeMs / 1000.
//
//   Output:
//     denom = √(eLL · eRR)
//     ρ     = denom > FLOOR ? eLR / denom : 0
//
//   ρ is mathematically bounded to [-1, +1] by Cauchy-Schwarz on the
//   expectation operator; we clamp defensively against float error.
//
// SILENCE HANDLING
//
// When either channel is silent, eLL or eRR → 0 and ρ is undefined.
// A correlation meter in this state conventionally reads "0" (no
// information) rather than "+1" or "NaN". We gate with a small FLOOR
// on the denominator (1e-20, well below any real audio mean-square).
//
// WINDOW TIME
//
// `timeMs` is the one-pole time constant (not the rectangular-equivalent
// window). 300 ms matches broadcast convention (IEC/Dorrough); smaller
// values (50–100 ms) give a jumpier meter that tracks transients,
// larger (1–3 s) gives a programme-average reading.
//
// Denormal flush on all three states per Jon Watte (Canon:utilities §1).

const DENORMAL = 1e-30;
const DENOM_FLOOR = 1e-20; // below √(eLL·eRR) this, output 0 (silence)

export class CorrelationOp {
  static opId = 'correlation';
  static inputs  = Object.freeze([
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'corr', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'timeMs', default: 300 },
  ]);

  constructor(sampleRate) {
    this.sr     = sampleRate;
    this._tauS  = 0.3;
    this._alpha = 0;
    this._oma   = 1;
    this._eLL   = 0;
    this._eRR   = 0;
    this._eLR   = 0;
    this._recomputeCoefs();
  }

  reset() {
    this._eLL = 0;
    this._eRR = 0;
    this._eLR = 0;
  }

  setParam(id, v) {
    if (id === 'timeMs') {
      const ms = +v;
      if (!Number.isFinite(ms)) return;
      // Clamp: 1 ms minimum (one-sample window is nonsense), 10 s max.
      const clamped = ms < 1 ? 1 : (ms > 10000 ? 10000 : ms);
      this._tauS = clamped / 1000;
      this._recomputeCoefs();
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    this._alpha = Math.exp(-1 / (this._tauS * this.sr));
    this._oma   = 1 - this._alpha;
  }

  process(inputs, outputs, N) {
    const lCh = inputs.l;
    const rCh = inputs.r;
    const outCh = outputs.corr;
    if (!outCh) return;

    const a   = this._alpha;
    const oma = this._oma;
    let eLL = this._eLL;
    let eRR = this._eRR;
    let eLR = this._eLR;

    if (!lCh || !rCh) {
      // Can't compute correlation with only one channel wired. Let the
      // running expectations decay toward zero and emit 0 (undefined).
      for (let i = 0; i < N; i++) {
        eLL *= a; eRR *= a; eLR *= a;
        if (eLL < DENORMAL && eLL > -DENORMAL) eLL = 0;
        if (eRR < DENORMAL && eRR > -DENORMAL) eRR = 0;
        if (eLR < DENORMAL && eLR > -DENORMAL) eLR = 0;
        outCh[i] = 0;
      }
      this._eLL = eLL; this._eRR = eRR; this._eLR = eLR;
      return;
    }

    for (let i = 0; i < N; i++) {
      const l = lCh[i];
      const r = rCh[i];
      eLL = oma * (l * l) + a * eLL;
      eRR = oma * (r * r) + a * eRR;
      eLR = oma * (l * r) + a * eLR;
      if (eLL < DENORMAL && eLL > -DENORMAL) eLL = 0;
      if (eRR < DENORMAL && eRR > -DENORMAL) eRR = 0;
      if (eLR < DENORMAL && eLR > -DENORMAL) eLR = 0;
      const denom2 = eLL * eRR;
      let rho;
      if (denom2 < DENOM_FLOOR) {
        rho = 0;
      } else {
        rho = eLR / Math.sqrt(denom2);
        // Defensive clamp — Cauchy-Schwarz bounds this to [-1,1] in
        // exact math, but accumulated float error can exceed slightly.
        if (rho > 1) rho = 1;
        else if (rho < -1) rho = -1;
      }
      outCh[i] = rho;
    }

    this._eLL = eLL; this._eRR = eRR; this._eLR = eLR;
  }
}
