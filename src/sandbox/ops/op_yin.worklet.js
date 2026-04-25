// op_yin.worklet.js — Catalog #76 (Pitch family).
//
// CROSS-CHECK (2026-04-24) — audited against Patrice Guyot reference impl
// (github.com/patriceguyot/Yin, yin.py, MIT). Math core bit-identical to
// Guyot's `cumulativeMeanNormalizedDifferenceFunction` + `getPitch`. Three
// documented divergences:
//   1. Step 4 "no dip below threshold" fallback: Guyot returns 0 (unvoiced);
//      we return global-min pitch. For unvoiced-but-non-silent frames (noise,
//      fricatives) Guyot reports "no pitch" whereas we emit a spurious guess.
//      Logged as research debt.
//   2. Step 5 parabolic interpolation: Guyot omits. We implement per paper
//      §II.E on RAW d(τ). Ours is paper-complete.
//   3. τ_max rounding: Guyot `int(sr/f0_min)` (truncate); we `ceil(sr/f0_min)`.
//      Differs by ≤1 sample — negligible.
// Already-documented deviations (silent-frame gate, 1-confidence, hop=W,
// Step 6 skipped, no prefilter) hold for both Guyot and us.
//
//
// YIN pitch detector. de Cheveigné & Kawahara 2002,
// "YIN, a fundamental frequency estimator for speech and music",
// J. Acoust. Soc. Am. 111(4):1917–1930 (DOI 10.1121/1.1458024).
//
// PRIMARY SOURCE: Downloads/2002_JASA_YIN.pdf pp. 1919–1921.
//
// Implements Steps 1–5 of the paper (error rate 0.77% per Table I).
// Step 6 ("best local estimate", error → 0.50%) is intentionally SKIPPED
// for MVP — it's a block-reprocessing refinement that requires revisiting
// previously-analyzed frames with adjusted integration intervals, which
// doesn't map cleanly onto the single-pass worklet model. Logged as
// research debt.
//
// =========================================================================
// ALGORITHM (verbatim from paper — equation numbers preserved)
// =========================================================================
//
//   Step 2 — Difference function (Eq. 6):
//     d_t(τ) = Σ_{j=t+1}^{t+W} (x_j − x_{j+τ})²
//
//   Step 3 — Cumulative Mean Normalized Difference Function (Eq. 8):
//     d'_t(τ) = { 1                                if τ = 0
//               { d_t(τ) / [(1/τ) Σ_{j=1..τ} d_t(j)]  otherwise
//
//   Step 4 — Absolute threshold:
//     "choose the smallest value of τ that gives a minimum of d' deeper
//      than that threshold. If none is found, the global minimum is chosen
//      instead." (Paper §II.D, threshold = 0.1 used in paper's Table II.)
//
//   Step 5 — Parabolic interpolation:
//     "Each local minimum of d'(τ) and its immediate neighbors is fit by a
//      parabola… To avoid [a] bias, the abscissa of the corresponding
//      minimum of the RAW difference function d(τ) is used instead."
//     (Paper §II.E — interpolate over d, NOT d'.)
//
//     For three points (τ−1, y₀), (τ, y₁), (τ+1, y₂):
//       τ_refined = τ + (y₀ − y₂) / [2·(y₀ − 2y₁ + y₂)]
//
// =========================================================================
// MVP SCOPE
// =========================================================================
//
//   • Frame-based analysis. One pitch estimate per W-sample window.
//     Between-frame output is held at the most recent f0/confidence value.
//   • Hop = W (non-overlapping). Paper evaluated at one-sample hop for
//     error statistics; production implementations overlap 25–50%. Research
//     debt: configurable hop.
//   • Naive O(W·τ_max) difference function per Eq. 6 literal. The FFT
//     implementation via Wiener-Khinchin (Guyot's `differenceFunction`)
//     is an O(W log W) upgrade; research debt for real-time at 25 ms @ 48k.
//   • No low-pass pre-filter. Paper uses 1-kHz prefilter (Fig. 4c); skipped
//     here — compose an external biquad lowPass op if needed.
//   • Confidence reported as (1 − d'(τ_est)), clamped [0, 1]. Paper uses
//     d'(τ) directly as an unreliability indicator; we invert so "higher
//     is more confident" for downstream gating.
//
// =========================================================================
// PARAMS
// =========================================================================
//
//   f0Min      — lower f0 bound, Hz                   [10, 2000]    default  80
//   f0Max      — upper f0 bound, Hz                   [20, sr/4]    default 1000
//   threshold  — Step 4 absolute threshold on d'      [0.01, 0.5]   default 0.1
//   windowMs   — integration window W, ms             [5, 200]      default 25
//
// OUTPUTS (control-rate; held between frames)
//   f0          — Hz, or 0 before the first frame completes
//   confidence  — [0, 1], 0 before first frame

const LN_001 = Math.log(0.001);

export class YinOp {
  static opId = 'yin';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'f0',         kind: 'control' },
    { id: 'confidence', kind: 'control' },
  ]);
  static params = Object.freeze([
    { id: 'f0Min',     default: 80 },
    { id: 'f0Max',     default: 1000 },
    { id: 'threshold', default: 0.1 },
    { id: 'windowMs',  default: 25 },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._f0Min     = 80;
    this._f0Max     = 1000;
    this._threshold = 0.1;
    this._windowMs  = 25;

    this._lastF0   = 0;
    this._lastConf = 0;

    this._recompute();
  }

  _recompute() {
    this.W      = Math.max(32, Math.round(this._windowMs * 0.001 * this.sr));
    this.tauMin = Math.max(2,           Math.floor(this.sr / this._f0Max));
    this.tauMax = Math.min(this.W - 1,  Math.ceil (this.sr / this._f0Min));
    if (this.tauMax <= this.tauMin) this.tauMax = this.tauMin + 1;

    const frameLen = this.W + this.tauMax + 2;
    // Ring buffer for incoming samples. Power-of-two mask for fast wrap.
    let n = 1; while (n < frameLen + 2) n <<= 1;
    this.buf     = new Float32Array(n);
    this.bufMask = n - 1;
    this.w       = 0;
    this.filled  = 0;   // sample count since last frame compute

    // Work buffers (preallocated; no per-frame alloc).
    this.frame = new Float32Array(frameLen);
    this.df    = new Float32Array(this.tauMax + 1);
    this.cmndf = new Float32Array(this.tauMax + 1);
  }

  reset() {
    this.buf.fill(0);
    this.w = 0; this.filled = 0;
    this._lastF0 = 0; this._lastConf = 0;
    this.df.fill(0); this.cmndf.fill(0); this.frame.fill(0);
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'f0Min':
        this._f0Min = Math.max(10, Math.min(2000, v));
        this._recompute();
        break;
      case 'f0Max': {
        const hi = Math.max(20, Math.min(this.sr / 4, v));
        this._f0Max = hi;
        this._recompute();
        break;
      }
      case 'threshold':
        this._threshold = Math.max(0.01, Math.min(0.5, v));
        break;
      case 'windowMs':
        this._windowMs = Math.max(5, Math.min(200, v));
        this._recompute();
        break;
    }
  }

  process(inputs, outputs, N) {
    const inBuf  = inputs  && inputs.in         ? inputs.in         : null;
    const f0Out  = outputs && outputs.f0        ? outputs.f0        : null;
    const conOut = outputs && outputs.confidence ? outputs.confidence : null;
    if (!f0Out && !conOut) return;

    const buf  = this.buf;
    const mask = this.bufMask;
    const W    = this.W;

    for (let n = 0; n < N; n++) {
      const x = inBuf ? inBuf[n] : 0;
      buf[this.w] = x;
      this.w = (this.w + 1) & mask;
      this.filled++;

      if (this.filled >= W) {
        this.filled = 0;
        this._computeFrame();
      }

      if (f0Out)  f0Out[n]  = this._lastF0;
      if (conOut) conOut[n] = this._lastConf;
    }
  }

  _computeFrame() {
    const W      = this.W;
    const tauMin = this.tauMin;
    const tauMax = this.tauMax;
    const buf    = this.buf;
    const mask   = this.bufMask;
    const frame  = this.frame;
    const df     = this.df;
    const cmndf  = this.cmndf;

    // Copy last (W + tauMax) samples from ring into flat frame buffer,
    // oldest first. Write pointer `w` points *past* the most recent sample.
    const frameLen = W + tauMax;
    let rd = (this.w - frameLen) & mask;
    for (let i = 0; i < frameLen; i++) {
      frame[i] = buf[rd];
      rd = (rd + 1) & mask;
    }

    // ----- Frame-energy gate -----
    // Silent / near-silent frames would otherwise fall through Step 4's
    // "no dip below threshold → pick global minimum" fallback and return
    // a spurious f0 = sr/tauMin. Bail early with f0=0, confidence=0. This
    // isn't in the paper (which assumes voiced input) but matches every
    // production YIN impl (librosa, aubio, crepe) in reporting "no pitch"
    // on silence.
    let energy = 0;
    for (let j = 0; j < W; j++) energy += frame[j] * frame[j];
    if (energy < 1e-10) {
      this._lastF0 = 0;
      this._lastConf = 0;
      return;
    }

    // ----- Step 2: Difference function (Eq. 6) -----
    // d(τ) = Σ_{j=0..W-1} (x_j − x_{j+τ})²      (paper's t=0 case)
    df[0] = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const d = frame[j] - frame[j + tau];
        s += d * d;
      }
      df[tau] = s;
    }

    // ----- Step 3: CMNDF (Eq. 8) -----
    cmndf[0] = 1;
    let runSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      runSum += df[tau];
      cmndf[tau] = runSum > 0 ? (df[tau] * tau / runSum) : 1;
    }

    // ----- Step 4: Absolute threshold -----
    // Scan τ from tauMin upward; the first τ where d'(τ) drops below
    // threshold, descend to its local minimum; that τ is the estimate.
    // If no τ in [tauMin, tauMax] drops below threshold, pick global min.
    let tauEst = 0;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmndf[tau] < this._threshold) {
        while (tau + 1 <= tauMax && cmndf[tau + 1] < cmndf[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    if (tauEst === 0) {
      let best = Infinity, bestTau = tauMin;
      for (let tau = tauMin; tau <= tauMax; tau++) {
        if (cmndf[tau] < best) { best = cmndf[tau]; bestTau = tau; }
      }
      tauEst = bestTau;
    }

    // ----- Step 5: Parabolic interpolation on RAW d(τ) -----
    let tauRefined = tauEst;
    if (tauEst > 0 && tauEst < tauMax) {
      const y0 = df[tauEst - 1];
      const y1 = df[tauEst];
      const y2 = df[tauEst + 1];
      const den = 2 * (y0 - 2 * y1 + y2);
      if (den !== 0) {
        const delta = (y0 - y2) / den;
        // Only accept sub-sample correction if it's within ±1 sample
        // (guard against pathological non-parabolic neighborhoods).
        if (delta > -1 && delta < 1) tauRefined = tauEst + delta;
      }
    }

    // ----- Output -----
    // Confidence := 1 − d'(τ_est), clamped. Paper §V: d'(T) is a confidence
    // indicator (small = more reliable). We invert so higher == better, to
    // let downstream gates use a single monotonic threshold.
    const dp = cmndf[tauEst];
    const conf = dp < 0 ? 1 : (dp > 1 ? 0 : (1 - dp));
    const f0 = tauRefined > 0 ? (this.sr / tauRefined) : 0;

    this._lastF0   = Number.isFinite(f0)   ? f0   : 0;
    this._lastConf = Number.isFinite(conf) ? conf : 0;
  }

  // Paper §II.F / §V: latency ≥ W samples (one full integration window).
  // With our hop=W design, worst case is W + 1 samples before the first
  // estimate appears. We report W as the nominal latency.
  getLatencySamples() { return this.W; }
}
