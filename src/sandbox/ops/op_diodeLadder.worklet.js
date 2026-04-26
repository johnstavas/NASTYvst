// op_diodeLadder.worklet.js — Stage-3 op sidecar for the `diodeLadder` op
// (v3 Layer 2, 2026-04-25). TB-303 character ladder. Stinchcombe-direct.
//
// Contract: memory/codegen_design.md § 4. Mirrors op_diodeLadder.cpp.jinja
// bit-for-bit. Param schema preserved (normFreq, Q, drive, trim).
//
// LAYER PROGRESSION.
//   v3 Layer 1 (2026-04-25): generic d=1 equal-cap diode ladder
//                            (Moog_ladder_tf.pdf §3.2 eq. 31, polynomial
//                            denominator [1,7,15,10,1]).
//   v3 Layer 2 (2026-04-25, this file): TB-303 character —
//     • core matrix swapped to TB-303 form (d=1, C_1 = C/2; denominator
//       [1, 6.727, 14.142, 9.514, 1] per Moog_ladder_tf.pdf §3.2 eq. 31
//       TB-303 case, p. 34);
//     • coupling-cap network added as a fixed-coefficient cascade of
//       five first-order analog sections, derived from the explicit
//       transfer function H(s) in stinchcombe/diode2.html;
//     • feedback tap moved to the post-network output so the
//       coupling-cap dynamics interact with the resonance loop (which
//       in the real circuit happens because the resonance pot taps the
//       output op-amp, *after* the coupling caps).
//
// PRIMARY (declared, v3 Layer 2):
//   1. Tim Stinchcombe, "Analysis of the Moog Transistor Ladder and
//      Derivative Filters", 25 Oct 2008 — §3.2 p.34 (TB-303 normalised
//      denominator from C_1 = C/2 substitution into eq. 30 → eq. 31).
//      PDF: docs/primary_sources/stinchcombe/Moog_ladder_tf.pdf.
//   2. Tim Stinchcombe, "A Comprehensive TB-303 Diode Ladder Filter
//      Model" (web page, last updated 17 Dec 2022) — full transfer
//      function with the five coupling-cap sections (1.06·s³·(s+109.9)
//      (s+34.0)(s+7.41) numerator; six fixed denominator poles at
//      97.5, 38.5, 4.45, 578.1, 20.0, 7.41 rad/s; +18.7·k·s⁴·(s+46.5)
//      (s+4.40) feedback addend).
//      Local: docs/primary_sources/stinchcombe/diode2.html.
//
// VERBATIM PRIMARY EXTRACTS.
//   Moog_ladder_tf.pdf §3.2 p.34:
//     "For the TB-303 configuration of a single diode and the bottom
//     capacitor half the others, put d=1 and C_1 = C/2 into equation
//     (30): G_tb(s) = -1 / (8a^4·s^4·C^4 + 32a^3·s^3·C^3 + 40a^2·s^2·C^2
//     + 16a·s·C + 1). So this time ω_c^4 = 1/(8a^4·C^4), giving
//     ω_c = 1/(2^(3/4)·a·C) = I_f/(2^(7/4)·C·V_T)."
//
//   Moog_ladder_tf.pdf §3.2 p.34 eq. 31 (TB-303 normalised):
//     G_tb(s) = -1 / (s^4 + 6.727·s^3 + 14.142·s^2 + 9.514·s + 1)
//
//   diode2.html (verbatim H(s)):
//     H(s) = 1.06·s^3·(s+109.9)·(s+34.0)·(s+7.41)
//          / [(s^4/ω_c^4 + 2^(11/4)·s^3/ω_c^3 + 10√2·s^2/ω_c^2
//             + 2^(13/4)·s/ω_c + 1) · (s+97.5)(s+38.5)(s+4.45)
//             · (s+578.1)(s+20.0)(s+7.41)
//             + 18.7·k·s^4·(s+46.5)(s+4.40)]
//
//   diode2.html (8-Hz peak):
//     "The lower resonant peak is very real: shortly before I put this
//     work down in favour of other projects I took some measurements
//     from my TBX-303 clone, and the test set-up I was using was adding
//     just enough capacitive load to enable the filter to oscillate
//     comfortably at around 8Hz. I feel the effect of this peak,
//     boosting the base frequencies as it does, might be a large
//     contributing factor to the sound of the TB-303 overall."
//
// DERIVATION — TB-303 CORE MATRIX (A_tb).
//   Continuous-time recursion eqs. (23), (24) from §3.2 p.30 with
//   C_1 = C/2 give per-stage time constants τ_1 = a·C (stage 1) and
//   τ_2 = 2·a·C (stages 2..4). Normalising to τ_tb = 2^(3/4)·a·C
//   (so ω_c = 1/τ_tb per Stinchcombe §3.2 p.34) gives row scalings
//     row 0:   τ_tb / τ_1 = 2^(3/4)   ≈ 1.681792830507429
//     rows 1-3: τ_tb / τ_2 = 2^(-1/4) ≈ 0.840896415253714
//   The matrix is
//     A_tb = [ -2^(3/4)·1,    2^(3/4)·1,    0,             0           ]
//            [  2^(-1/4)·1,  -2^(-1/4)·2,   2^(-1/4)·1,    0           ]
//            [  0,            2^(-1/4)·1,  -2^(-1/4)·2,    2^(-1/4)·1  ]
//            [  0,            0,            2^(-1/4)·1,   -2^(-1/4)·2  ]
//     b_tb = [ -2^(3/4), 0, 0, 0 ]
//   Trace test: tr(A_tb) = -2^(3/4) - 6·2^(-1/4) = -1.6818 - 5.0454
//                       = -6.7272 — matches eq. (31) s^3 coefficient. ✓
//
// COUPLING-CAP CASCADE (fixed coefficients, sr-dependent, not Q/cutoff
// dependent).
//   The k=0 open-loop H factors after cancelling (s+7.41):
//     G_pre  = [s / (s+97.5)] · [(s+109.9) / (s+578.1)]
//     G_core = 1 / D_tb_core(s, ω_c)
//     G_post = 1.06 · [s / (s+38.5)] · [s / (s+4.45)] · [(s+34) / (s+20)]
//   Each first-order section H(s) = (s + z_a) / (s + p_a) is bilinear-
//   discretized at the OS rate (no pre-warping; all corner frequencies
//   are well below Nyquist):
//     α_z = z_a · T2 / 2,      α_p = p_a · T2 / 2
//     b0  = (1 + α_z) / (1 + α_p)
//     b1  = -(1 - α_z) / (1 + α_p)
//     a1  = -(1 - α_p) / (1 + α_p)
//     y[n] = b0·x[n] + b1·x[n-1] - a1·y[n-1]
//   For pure-HP sections (z_a = 0): b0 = 1/(1+α_p), b1 = -1/(1+α_p).
//
// FEEDBACK PATH.
//   FB tap = y_post_prev (output of G_post, one-sample lag). This
//   matches the actual TB-303 schematic where the resonance pot reads
//   the output op-amp, *after* all five coupling-cap sections. The
//   8-Hz lower peak emerges from the interaction of G_post with the
//   feedback loop. Stinchcombe's explicit +18.7·k·s^4·(s+46.5)(s+4.40)
//   feedback addend in diode2.html refines this peak's exact shape and
//   is queued as v3.1 Layer 2.1 in qc_backlog.md.
//
// OVERSAMPLING. 2× polyphase, 63-tap Kaiser β=10 halfband (lifted from
// op_ladder v3 / op_drive). Latency = 31 samples.
//
// FEEDBACK CALIBRATION. Stinchcombe §3.4 p.36: k=10 gives "similar
// amount of resonance" to Moog k=4. We map Q ∈ [0.7, 20] → k ∈ [0, 10]
// linearly so Q=20 sits at the analytic self-osc edge.

const K_TAPS = 63;
const K_HALF = (K_TAPS - 1) / 2;     // 31
const SQRT2  = Math.SQRT2;

// Modified Bessel I₀, series form (matches op_drive / op_ladder bit-for-bit).
function besselI0(x) {
  let sum = 1.0, term = 1.0;
  const q = x * x * 0.25;
  for (let k = 1; k < 50; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < 1.0e-20 * sum) break;
  }
  return sum;
}

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// Bilinear-discretize one analog section H(s) = (s + z_a) / (s + p_a) at
// sample rate sr2. Returns [b0, b1, a1] for y = b0·x + b1·x_prev - a1·y_prev.
function biln1(z_a, p_a, sr2) {
  const T = 1 / sr2;
  const az = z_a * T * 0.5;
  const ap = p_a * T * 0.5;
  const inv = 1 / (1 + ap);
  return [
    (1 + az) * inv,        // b0
    -(1 - az) * inv,       // b1
    -(1 - ap) * inv,       // a1
  ];
}

// Five fixed coupling-cap sections, in series order:
//   pre  : section[0] = s/(s+97.5)
//          section[1] = (s+109.9)/(s+578.1)
//   post : section[2] = s/(s+38.5)
//          section[3] = s/(s+4.45)
//          section[4] = (s+34.0)/(s+20.0)
const COUPLING_SECTIONS = [
  { za:   0.0, pa:  97.5 },
  { za: 109.9, pa: 578.1 },
  { za:   0.0, pa:  38.5 },
  { za:   0.0, pa:   4.45 },
  { za:  34.0, pa:  20.0 },
];
const POST_GAIN = 1.06;          // numerator constant (diode2.html verbatim)

// TB-303 row scalings (Stinchcombe §3.2 p.34, C_1 = C/2):
const TB_ROW0 = Math.pow(2, 0.75);    // 2^(3/4)  ≈ 1.681792830507429
const TB_ROWN = Math.pow(2, -0.25);   // 2^(-1/4) ≈ 0.840896415253714

export class DiodeLadderOp {
  static opId = 'diodeLadder';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'normFreq', default: 0.4 },
    { id: 'Q',        default: 4.0 },
    { id: 'drive',    default: 1.0 },
    { id: 'trim',     default: 0.0 },  // dB
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._normFreq = 0.4;
    this._Q = 4.0;
    this._drive = 1.0;
    this._trim = 0.0;

    // 4 ladder cap states (TB-303 differential voltages V₁..V₄).
    this.x0 = 0; this.x1 = 0; this.x2 = 0; this.x3 = 0;
    // 5 coupling-cap section states (each: prev x, prev y).
    this._cxp = new Float64Array(5);    // x_{n-1}
    this._cyp = new Float64Array(5);    // y_{n-1}
    // FB lag (post-network output) and core-input lag.
    this.y_post_prev = 0;
    this.u_prev = 0;

    // Discretized core matrices.
    this._Ad = new Float64Array(16);
    this._bd = new Float64Array(4);
    this._k  = 0;

    // Coupling-cap section coefficients [b0, b1, a1] × 5.
    this._cb0 = new Float64Array(5);
    this._cb1 = new Float64Array(5);
    this._ca1 = new Float64Array(5);

    // 2× polyphase halfband.
    this._hb = new Float64Array(K_TAPS);
    this._upBuf = new Float64Array(K_TAPS);
    this._dnBuf = new Float64Array(K_TAPS);
    this._upIdx = 0;
    this._dnIdx = 0;
    this._designHalfband();
    this._designCoupling();

    this._cacheValid = false;
    this._recomputeCoeffs();
  }

  reset() {
    this.x0 = 0; this.x1 = 0; this.x2 = 0; this.x3 = 0;
    this._cxp.fill(0);
    this._cyp.fill(0);
    this.y_post_prev = 0;
    this.u_prev = 0;
    this._upBuf.fill(0);
    this._dnBuf.fill(0);
    this._upIdx = 0;
    this._dnIdx = 0;
  }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'normFreq': this._normFreq = clip(x, 0,    1);   this._cacheValid = false; break;
      case 'Q':        this._Q        = clip(x, 0.7,  20);  this._cacheValid = false; break;
      case 'drive':    this._drive    = clip(x, 0,    1);   break;
      case 'trim':     this._trim     = clip(x, -24,  12);  break;
    }
  }

  getLatencySamples() { return K_HALF; }

  _designHalfband() {
    const beta = 10.0;
    const i0Beta = besselI0(beta);
    const N = K_TAPS - 1;
    const half = (K_TAPS / 2) | 0;
    for (let n = 0; n < K_TAPS; n++) {
      const m = n - half;
      let sinc;
      if (m === 0)             sinc = 0.5;
      else if ((m & 1) === 0)  sinc = 0.0;
      else                     sinc = Math.sin(0.5 * Math.PI * m) / (Math.PI * m);
      const r = (2 * n - N) / N;
      const a = beta * Math.sqrt(1 - r * r);
      const w = besselI0(a) / i0Beta;
      this._hb[n] = sinc * w;
    }
  }

  _designCoupling() {
    const sr2 = 2 * (this.sr || 48000);
    for (let i = 0; i < 5; i++) {
      const sec = COUPLING_SECTIONS[i];
      const [b0, b1, a1] = biln1(sec.za, sec.pa, sr2);
      this._cb0[i] = b0;
      this._cb1[i] = b1;
      this._ca1[i] = a1;
    }
  }

  _pushAndConvolve(buf, idxRef, x) {
    let idx = idxRef[0];
    buf[idx] = x;
    idx = (idx + 1) % K_TAPS;
    let y = 0;
    let j = idx;
    for (let t = 0; t < K_TAPS; t++) {
      y += this._hb[t] * buf[j];
      j = (j + 1) % K_TAPS;
    }
    idxRef[0] = idx;
    return y;
  }

  // Build A_d = (I−αA_tb)⁻¹·(I+αA_tb) and b_d = (I−αA_tb)⁻¹·(2α·b_tb)
  // for the TB-303 d=1 C_1=C/2 state-space (per-row scaled). Solved
  // column-by-column via 4×4 Gauss-Jordan (the matrix is no longer
  // tridiagonal-symmetric after row scaling, so a generic solver is used).
  _recomputeCoeffs() {
    const sr  = this.sr || 48000;
    const sr2 = 2 * sr;
    const nyq2 = 0.5 * sr2 - 100;
    // Exponential cutoff map: 20 Hz → 20 kHz.
    const fc  = clip(2 * Math.pow(10, 3 * this._normFreq + 1), 20, nyq2);
    const a   = clip(Math.tan(Math.PI * fc / sr2), 1e-9, 1e9);   // pre-warp α

    // Resonance.
    const Q = this._Q;
    this._k = clip((Q - 0.7) * 10 / (20 - 0.7), 0, 10);

    // A_tb (row-scaled per Stinchcombe §3.2 p.34). Row 0 scaled by
    // 2^(3/4); rows 1..3 scaled by 2^(-1/4).
    //   A_tb = [[-r0,    r0,   0,    0   ],
    //           [ rN,   -2rN,  rN,   0   ],
    //           [ 0,     rN,  -2rN,  rN  ],
    //           [ 0,     0,    rN,  -2rN ]]
    //   b_tb = [-r0, 0, 0, 0]
    const r0 = TB_ROW0;
    const rN = TB_ROWN;

    // (I − α·A_tb): general 4×4 with tridiag-like sparsity but row-asymm.
    //   L[0] = [1+α·r0,  -α·r0,   0,        0       ]
    //   L[1] = [-α·rN,   1+2α·rN, -α·rN,    0       ]
    //   L[2] = [0,       -α·rN,   1+2α·rN,  -α·rN   ]
    //   L[3] = [0,       0,       -α·rN,    1+2α·rN ]
    const L00 = 1 + a * r0,        L01 = -a * r0,    L02 = 0,         L03 = 0;
    const L10 = -a * rN,           L11 = 1 + 2 * a * rN, L12 = -a * rN, L13 = 0;
    const L20 = 0,                 L21 = -a * rN,    L22 = 1 + 2 * a * rN, L23 = -a * rN;
    const L30 = 0,                 L31 = 0,          L32 = -a * rN,    L33 = 1 + 2 * a * rN;

    // (I + α·A_tb):
    const R00 = 1 - a * r0,        R01 =  a * r0,    R02 = 0,         R03 = 0;
    const R10 =  a * rN,           R11 = 1 - 2 * a * rN, R12 =  a * rN, R13 = 0;
    const R20 = 0,                 R21 =  a * rN,    R22 = 1 - 2 * a * rN, R23 =  a * rN;
    const R30 = 0,                 R31 = 0,          R32 =  a * rN,    R33 = 1 - 2 * a * rN;

    // Solve L·X = M for 4 RHS vectors (4 columns of R) and one (2α·b_tb).
    // Generic 4×4 Gauss elimination (matrix is small; runs only on
    // parameter change). We construct an augmented matrix [L | rhs]
    // and reduce.
    const solve = (r0v, r1v, r2v, r3v) => {
      // local aug = 4×5
      let A = [
        [L00, L01, L02, L03, r0v],
        [L10, L11, L12, L13, r1v],
        [L20, L21, L22, L23, r2v],
        [L30, L31, L32, L33, r3v],
      ];
      // Forward elimination with partial pivoting.
      for (let p = 0; p < 4; p++) {
        let piv = p;
        let pivAbs = Math.abs(A[p][p]);
        for (let r = p + 1; r < 4; r++) {
          const v = Math.abs(A[r][p]);
          if (v > pivAbs) { piv = r; pivAbs = v; }
        }
        if (piv !== p) { const tmp = A[p]; A[p] = A[piv]; A[piv] = tmp; }
        const inv = 1 / A[p][p];
        for (let r = p + 1; r < 4; r++) {
          const f = A[r][p] * inv;
          for (let c = p; c < 5; c++) A[r][c] -= f * A[p][c];
        }
      }
      // Back-substitute.
      const x = [0, 0, 0, 0];
      for (let r = 3; r >= 0; r--) {
        let s = A[r][4];
        for (let c = r + 1; c < 4; c++) s -= A[r][c] * x[c];
        x[r] = s / A[r][r];
      }
      return x;
    };

    // 4 columns of R.
    const c0 = solve(R00, R10, R20, R30);
    const c1 = solve(R01, R11, R21, R31);
    const c2 = solve(R02, R12, R22, R32);
    const c3 = solve(R03, R13, R23, R33);

    const Ad = this._Ad;
    Ad[0]  = c0[0]; Ad[1]  = c1[0]; Ad[2]  = c2[0]; Ad[3]  = c3[0];
    Ad[4]  = c0[1]; Ad[5]  = c1[1]; Ad[6]  = c2[1]; Ad[7]  = c3[1];
    Ad[8]  = c0[2]; Ad[9]  = c1[2]; Ad[10] = c2[2]; Ad[11] = c3[2];
    Ad[12] = c0[3]; Ad[13] = c1[3]; Ad[14] = c2[3]; Ad[15] = c3[3];

    // b_d = L⁻¹·(2α·b_tb),  b_tb = [-2^(3/4), 0, 0, 0].
    const bdv = solve(-2 * a * r0, 0, 0, 0);
    this._bd[0] = bdv[0];
    this._bd[1] = bdv[1];
    this._bd[2] = bdv[2];
    this._bd[3] = bdv[3];

    this._cacheValid = true;
  }

  // Run a single coupling-cap section i: y = b0·x + b1·x_prev - a1·y_prev.
  _section(i, x) {
    const y = this._cb0[i] * x + this._cb1[i] * this._cxp[i] - this._ca1[i] * this._cyp[i];
    this._cxp[i] = x;
    this._cyp[i] = y;
    return y;
  }

  // Single ladder sample at 2·Fs. Returns post-network output y_post.
  _ladderStep(x_in) {
    const drive = this._drive;
    const k     = this._k;

    // ---- Pre-network: section 0 (HP@97.5 rad/s), section 1 (shelf 109.9/578.1).
    const p0 = this._section(0, x_in);
    const p1 = this._section(1, p0);

    // ---- Driver pair tanh on (drive·p1 − k·y_post_prev). One-sample lag on FB.
    const u = Math.tanh(drive * p1 - k * this.y_post_prev);
    const u_avg = 0.5 * (u + this.u_prev);

    // ---- Ladder core (TB-303 state-space).
    const Ad = this._Ad, bd = this._bd;
    const x0 = this.x0, x1 = this.x1, x2 = this.x2, x3 = this.x3;
    const n0 = Ad[0]*x0 + Ad[1]*x1 + Ad[2]*x2 + Ad[3]*x3 + bd[0]*u_avg;
    const n1 = Ad[4]*x0 + Ad[5]*x1 + Ad[6]*x2 + Ad[7]*x3 + bd[1]*u_avg;
    const n2 = Ad[8]*x0 + Ad[9]*x1 + Ad[10]*x2 + Ad[11]*x3 + bd[2]*u_avg;
    const n3 = Ad[12]*x0 + Ad[13]*x1 + Ad[14]*x2 + Ad[15]*x3 + bd[3]*u_avg;
    this.x0 = n0; this.x1 = n1; this.x2 = n2; this.x3 = n3;
    this.u_prev = u;

    // ---- Post-network: sections 2, 3 (HPs at 38.5, 4.45 rad/s),
    //                    section 4 (shelf 34/20), then ×1.06 gain.
    const q0 = this._section(2, n3);
    const q1 = this._section(3, q0);
    const q2 = this._section(4, q1);
    const y_post = POST_GAIN * q2;

    this.y_post_prev = y_post;
    return y_post;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }
    if (!this._cacheValid) this._recomputeCoeffs();

    const trimLin = Math.pow(10, this._trim / 20);
    const upIdxRef = [this._upIdx];
    const dnIdxRef = [this._dnIdx];

    for (let i = 0; i < N; i++) {
      const x   = 2 * inCh[i];
      const up0 = this._pushAndConvolve(this._upBuf, upIdxRef, x);
      const up1 = this._pushAndConvolve(this._upBuf, upIdxRef, 0);

      const y0 = this._ladderStep(up0);
      const y1 = this._ladderStep(up1);

      this._pushAndConvolve(this._dnBuf, dnIdxRef, y0);                   // discarded
      const dn = this._pushAndConvolve(this._dnBuf, dnIdxRef, y1);

      outCh[i] = trimLin * dn;
    }

    this._upIdx = upIdxRef[0];
    this._dnIdx = dnIdxRef[0];
  }
}
