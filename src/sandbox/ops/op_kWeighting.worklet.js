// op_kWeighting.worklet.js — Stage-3 op sidecar for the `kWeighting` op.
//
// Catalog #51 (Loudness/Metering family). ITU-R BS.1770-5 K-weighting
// pre-filter. Canon:loudness §2.
//
// WHAT / WHY
//
// K-weighting is the perceptual front-end for every LUFS/LKFS/R128
// loudness meter shipped since 2011. It reshapes the raw audio spectrum
// so that the subsequent mean-square integration (#50 rms → #52
// lufsIntegrator) produces a number that correlates with *perceived*
// loudness rather than raw signal energy.
//
// Two cascaded biquads:
//
//   Stage 1 — "pre-filter" — a gentle high-shelf centered around 1.68 kHz
//     with ~+4 dB boost. Models the 2–5 kHz outer-ear resonance and
//     modest chest/diffraction gain that a listener physically experiences.
//
//   Stage 2 — "RLB" (Revised Low-frequency B-curve) — a 2nd-order
//     Butterworth high-pass at ~38 Hz. Kills sub-audio rumble and DC
//     content that would otherwise inflate LUFS readings without
//     contributing to perceived loudness.
//
// The cascade gives the familiar K-curve: ~−10 dB at 100 Hz, ~0 dB at
// 1 kHz (the reference), ~+4 dB at 10 kHz.
//
// SOURCE OF TRUTH (BS.1770-5, Annex 1):
//   Stage 1 analog prototype:
//     fc = 1681.974450955533 Hz
//     Q  = 0.7071752369554196
//     VH = 1.584864701130855   (gain at HF asymptote)
//     VB = 1.258720930232562   (mid-band coupling)
//     VL = 1.0                 (gain at LF asymptote)
//     H(s) = (VH·s² + VB·(ω0/Q)·s + VL·ω0²) / (s² + (ω0/Q)·s + ω0²)
//
//   Stage 2 analog prototype (RLB high-pass):
//     fc = 38.13547087602444 Hz
//     Q  = 0.5003270373238773
//     H(s) = s² / (s² + (ω0/Q)·s + ω0²)
//
// Canonical digital coefs at Fs = 48 kHz (verified by test):
//   Stage 1: b = [1.53512485958697, -2.69169618940638, 1.19839281085285]
//            a = [1,               -1.69065929318241,  0.73248077421585]
//   Stage 2: b = [1, -2, 1]
//            a = [1, -1.99004745483398, 0.99007225036621]
//
// For other sample rates, we derive coefs via bilinear transform of the
// analog prototype with pre-warping at the design frequency. This is
// standard practice (also what the EBU Tech 3341 V4 reference does).
//
// DSP (per biquad, direct form I):
//   y[n] = b0·x[n] + b1·x[n−1] + b2·x[n−2] − a1·y[n−1] − a2·y[n−2]
//
// Stability:
//   - Both biquads have complex-conjugate poles strictly inside the unit
//     circle at every sample rate from 22.05 kHz to 192 kHz. Pre-warping
//     preserves stability by design.
//   - Denormal flush on both filter states (Canon:utilities §1).

const DENORMAL = 1e-30;

// Analog prototype constants — BS.1770-5 Annex 1.
const S1_FC = 1681.974450955533;
const S1_Q  = 0.7071752369554196;
const S1_VH = 1.584864701130855;
const S1_VB = 1.258720930232562;
const S1_VL = 1.0;

const S2_FC = 38.13547087602444;
const S2_Q  = 0.5003270373238773;

/**
 * Bilinear transform of an analog biquad with pre-warping at fc.
 * Analog prototype:   H(s) = (β0·s² + β1·s + β2) / (α0·s² + α1·s + α2)
 * Digital output:     y[n] = b0·x[n] + b1·x[n−1] + b2·x[n−2] − a1·y[n−1] − a2·y[n−2]
 *
 * Pre-warp: K = ω0 / tan(ω0 · T / 2)  (preserves gain and phase at fc exactly)
 */
function bilinear(β0, β1, β2, α0, α1, α2, fc, sr) {
  const ω0 = 2 * Math.PI * fc;
  const K  = ω0 / Math.tan(ω0 / (2 * sr));
  const K2 = K * K;

  const a0 = α0 * K2 + α1 * K + α2;
  const a1 = (-2 * α0 * K2 + 2 * α2) / a0;
  const a2 = (α0 * K2 - α1 * K + α2) / a0;

  const b0 = (β0 * K2 + β1 * K + β2) / a0;
  const b1 = (-2 * β0 * K2 + 2 * β2) / a0;
  const b2 = (β0 * K2 - β1 * K + β2) / a0;

  return { b0, b1, b2, a1, a2 };
}

function computeCoefs(sr) {
  const ω1 = 2 * Math.PI * S1_FC;
  const ω1Q = ω1 / S1_Q;
  const ω1sq = ω1 * ω1;
  // Stage 1 pre-filter: β = [VH, VB·ω0/Q, VL·ω0²],  α = [1, ω0/Q, ω0²]
  const stage1 = bilinear(S1_VH, S1_VB * ω1Q, S1_VL * ω1sq, 1, ω1Q, ω1sq, S1_FC, sr);

  const ω2 = 2 * Math.PI * S2_FC;
  const ω2Q = ω2 / S2_Q;
  const ω2sq = ω2 * ω2;
  // Stage 2 RLB high-pass: β = [1, 0, 0], α = [1, ω0/Q, ω0²]
  // BS.1770 canonical convention: normalize Stage 2 numerator to b=[1,-2,1]
  // (the "pure-HP" form). Raw bilinear gives b = b0·[1,-2,1] with b0 ≈ 0.995;
  // dividing by b0 pins b0=1 to match the tabulated reference exactly. This
  // introduces a constant overall gain of 1/b0 ≈ +0.04 dB, flat across all
  // frequencies — it's a cosmetic rescaling that makes coefs match the
  // published table and libebur128, without changing the K-curve shape.
  const stage2 = bilinear(1, 0, 0, 1, ω2Q, ω2sq, S2_FC, sr);
  const s2Norm = stage2.b0;
  stage2.b0 /= s2Norm;
  stage2.b1 /= s2Norm;
  stage2.b2 /= s2Norm;

  return { stage1, stage2 };
}

export class KWeightingOp {
  static opId = 'kWeighting';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    const { stage1, stage2 } = computeCoefs(sampleRate);
    this._s1 = stage1;
    this._s2 = stage2;
    // DF1 state: 2 input + 2 output history taps per stage.
    this._s1x1 = 0; this._s1x2 = 0; this._s1y1 = 0; this._s1y2 = 0;
    this._s2x1 = 0; this._s2x2 = 0; this._s2y1 = 0; this._s2y2 = 0;
  }

  reset() {
    this._s1x1 = 0; this._s1x2 = 0; this._s1y1 = 0; this._s1y2 = 0;
    this._s2x1 = 0; this._s2x2 = 0; this._s2y1 = 0; this._s2y2 = 0;
  }

  setParam(/* no params */) {}

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }

    const { b0: b10, b1: b11, b2: b12, a1: a11, a2: a12 } = this._s1;
    const { b0: b20, b1: b21, b2: b22, a1: a21, a2: a22 } = this._s2;

    let s1x1 = this._s1x1, s1x2 = this._s1x2, s1y1 = this._s1y1, s1y2 = this._s1y2;
    let s2x1 = this._s2x1, s2x2 = this._s2x2, s2y1 = this._s2y1, s2y2 = this._s2y2;

    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      // Stage 1 (pre-filter high-shelf)
      let y1 = b10 * x + b11 * s1x1 + b12 * s1x2 - a11 * s1y1 - a12 * s1y2;
      if (y1 < DENORMAL && y1 > -DENORMAL) y1 = 0;
      s1x2 = s1x1; s1x1 = x;
      s1y2 = s1y1; s1y1 = y1;

      // Stage 2 (RLB HP) — input is stage 1 output
      let y2 = b20 * y1 + b21 * s2x1 + b22 * s2x2 - a21 * s2y1 - a22 * s2y2;
      if (y2 < DENORMAL && y2 > -DENORMAL) y2 = 0;
      s2x2 = s2x1; s2x1 = y1;
      s2y2 = s2y1; s2y1 = y2;

      outCh[i] = y2;
    }

    this._s1x1 = s1x1; this._s1x2 = s1x2; this._s1y1 = s1y1; this._s1y2 = s1y2;
    this._s2x1 = s2x1; this._s2x2 = s2x2; this._s2y1 = s2y1; this._s2y2 = s2y2;
  }
}
