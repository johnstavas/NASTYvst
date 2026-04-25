// op_pyin.worklet.js — Catalog #77 (Pitch family).
//
// pYIN: probabilistic YIN. Mauch & Dixon 2014,
//   "PYIN: A Fundamental Frequency Estimator Using Probabilistic Threshold
//    Distributions", ICASSP 2014 (pp. 659–663).
// PRIMARY PAPER: C:/Users/HEAT2/Downloads/MAUCHpYINFundamental2014Accepted.pdf
// PRIMARY CODE:  github.com/c4dm/pyin (GPL v2+) — Mauch's own Vamp plugin.
//   YinUtil.cpp      — prob-threshold stage 1 (lines 178–310)
//   MonoPitchHMM.cpp — HMM build, 2M states with triangular pitch trans
//   SparseHMM.cpp    — fixed-lag sparse Viterbi
//
// PAPER vs CODE: when these conflict, code wins (Mauch wrote both, code is
// authoritative/later). Documented divergences in op header at each site.
//
// =========================================================================
// ALGORITHM — two stages
// =========================================================================
//
//   STAGE 1 (frame-wise, per-hop) — YinUtil::yinPitchProbabilityFunction:
//     1. Compute YIN difference d(τ), Eq. 1 (naive O(W·τmax) same as #76 yin).
//     2. CMNDF d′(τ), Eq. 8 of de Cheveigné.
//     3. Scan τ ∈ [τmin, τmax). At each local minimum of d′ below the
//        largest threshold (0.99), accumulate:
//           peakProb[τ] += Σ_{i: sᵢ > d′(τ)} distribution[i]
//        using a precomputed 100-element probability mass function
//        distribution[i] for i = 0..99 corresponding to thresholds
//        sᵢ = 0.01 + 0.01·i.
//     4. Identify global minimum τ*. Normalize: peakProb[τ] scaled so
//        peakProb[τ*] retains its raw value and the bank sums to that.
//     5. Emit list of (f₀_candidate, probability) pairs:
//           f₀ = sr / τ_parabolic(τ)  with parabolic interpolation on d′
//
//   STAGE 2 (fixed-lag sparse Viterbi) — MonoPitchHMM + SparseHMM:
//     State space: 2·M pitch bins (voiced + unvoiced mirror). Mauch's code
//     uses nBPS = 5 (20 cents / bin), nPitch = 69·nBPS = 345, so 690 states.
//     Transition matrix (sparse, built once): from each voiced state iPitch
//     (and its unvoiced mirror iPitch+M) to targets i ∈ [iPitch−w/2,
//     iPitch+w/2] with w = transitionWidth = 5·(nBPS/2)+1 = 11 (±100 cents):
//       v→v: weight·selfTrans         v→u: weight·(1−selfTrans)
//       u→u: weight·selfTrans         u→v: weight·(1−selfTrans)
//     weight = 1,2,…,⌈w/2⌉,…,2,1 triangular, normalized.
//
//     Observation probability per frame: for each Stage-1 candidate (f, p),
//     bin to nearest HMM pitch, assign p. Voiced-state mass scaled by
//     yinTrust (=0.5). Unvoiced-state mass = (1 − yinTrust·Σp) / M uniform.
//
//     Decode: forward Viterbi with fixed-lag trimming of psi history.
//     At each frame, output argmax of oldDelta (most-likely current state),
//     then traverse back through retained psi to emit the state at t−lag.
//     That state's pitch bin → f₀ Hz; voiced flag = state < M.
//
// =========================================================================
// PARAMS
// =========================================================================
//
//   f0Min      — lower f0 bound, Hz              [20, 500]    default  61.735 (paper/code: B1)
//   f0Max      — upper f0 bound, Hz              [200, 4000]  default 880    (paper: A5)
//   windowMs   — W, ms                           [10, 200]    default 46.4   (paper: 2048 @ 44.1k)
//   hopMs      — frame hop, ms                   [1, 50]      default  5.8   (paper: 256 @ 44.1k)
//   prior      — threshold PMF preset enum       {0..4}       default 2
//                0 = uniform (flat); 1,2,3,4 = betaDist1..4 from Mauch's code
//   yinTrust   — voiced-state scale (Eq. 6)      [0, 1]       default 0.5
//   selfTrans  — voicing self-transition (Eq. 7) [0, 1]       default 0.99
//   lagFrames  — fixed-lag Viterbi window         [1, 64]      default 8
//
// OUTPUTS (control-rate; held between frames)
//   f0          — Hz, 0 if unvoiced or before first frame
//   voicedProb  — [0,1], sum of candidate probabilities
//   voicedFlag  — 0 or 1, Viterbi voiced/unvoiced decision at t−lag
//
// =========================================================================
// DEVIATIONS FROM PRIMARY
// =========================================================================
//   Paper (§2.2)     Code (Mauch's own)               Our ship
//   M=480 @ 10 cents M=345 @ 20 cents (nBPS=5)       Code
//   55 Hz min (A1)   61.735 Hz min (~B1)             Code
//   ±25 bins trans   ±5 bins (±100 cents)            Code
//   Beta CDF online  4 precomputed 100-float tables  Code (copied verbatim)
//   Eq. 4 pₐ=0.01    No pₐ fallback, straight Σ       Code
//   Full Viterbi     Fixed-lag SparseHMM             Code (paper-silent on online)
//
// Our own deviations (not in code or paper):
//   - Silent-frame energy gate (f0=0, voicedProb=0) — matches YIN #76 choice.
//   - Worklet is single-pass streaming; fixed-lag output latency = lagFrames·hop.

// Precomputed threshold distributions (100-element PMFs over s=0.01..1.0).
// Copied verbatim from c4dm/pyin YinUtil.cpp L178–L181.
const UNIFORM_DIST = new Float32Array(100).fill(0.01);

const BETA_DIST_1 = new Float32Array([
  0.028911,0.048656,0.061306,0.068539,0.071703,0.071877,0.069915,0.066489,0.062117,0.057199,
  0.052034,0.046844,0.041786,0.036971,0.032470,0.028323,0.024549,0.021153,0.018124,0.015446,
  0.013096,0.011048,0.009275,0.007750,0.006445,0.005336,0.004397,0.003606,0.002945,0.002394,
  0.001937,0.001560,0.001250,0.000998,0.000792,0.000626,0.000492,0.000385,0.000300,0.000232,
  0.000179,0.000137,0.000104,0.000079,0.000060,0.000045,0.000033,0.000024,0.000018,0.000013,
  0.000009,0.000007,0.000005,0.000003,0.000002,0.000002,0.000001,0.000001,0.000001,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
]);

const BETA_DIST_2 = new Float32Array([
  0.012614,0.022715,0.030646,0.036712,0.041184,0.044301,0.046277,0.047298,0.047528,0.047110,
  0.046171,0.044817,0.043144,0.041231,0.039147,0.036950,0.034690,0.032406,0.030133,0.027898,
  0.025722,0.023624,0.021614,0.019704,0.017900,0.016205,0.014621,0.013148,0.011785,0.010530,
  0.009377,0.008324,0.007366,0.006497,0.005712,0.005005,0.004372,0.003806,0.003302,0.002855,
  0.002460,0.002112,0.001806,0.001539,0.001307,0.001105,0.000931,0.000781,0.000652,0.000542,
  0.000449,0.000370,0.000303,0.000247,0.000201,0.000162,0.000130,0.000104,0.000082,0.000065,
  0.000051,0.000039,0.000030,0.000023,0.000018,0.000013,0.000010,0.000007,0.000005,0.000004,
  0.000003,0.000002,0.000001,0.000001,0.000001,0.000000,0.000000,0.000000,0.000000,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
]);

const BETA_DIST_3 = new Float32Array([
  0.006715,0.012509,0.017463,0.021655,0.025155,0.028031,0.030344,0.032151,0.033506,0.034458,
  0.035052,0.035331,0.035332,0.035092,0.034643,0.034015,0.033234,0.032327,0.031314,0.030217,
  0.029054,0.027841,0.026592,0.025322,0.024042,0.022761,0.021489,0.020234,0.019002,0.017799,
  0.016630,0.015499,0.014409,0.013362,0.012361,0.011407,0.010500,0.009641,0.008830,0.008067,
  0.007351,0.006681,0.006056,0.005475,0.004936,0.004437,0.003978,0.003555,0.003168,0.002814,
  0.002492,0.002199,0.001934,0.001695,0.001481,0.001288,0.001116,0.000963,0.000828,0.000708,
  0.000603,0.000511,0.000431,0.000361,0.000301,0.000250,0.000206,0.000168,0.000137,0.000110,
  0.000088,0.000070,0.000055,0.000043,0.000033,0.000025,0.000019,0.000014,0.000010,0.000007,
  0.000005,0.000004,0.000002,0.000002,0.000001,0.000001,0.000000,0.000000,0.000000,0.000000,
  0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
]);

const BETA_DIST_4 = new Float32Array([
  0.003996,0.007596,0.010824,0.013703,0.016255,0.018501,0.020460,0.022153,0.023597,0.024809,
  0.025807,0.026607,0.027223,0.027671,0.027963,0.028114,0.028135,0.028038,0.027834,0.027535,
  0.027149,0.026687,0.026157,0.025567,0.024926,0.024240,0.023517,0.022763,0.021983,0.021184,
  0.020371,0.019548,0.018719,0.017890,0.017062,0.016241,0.015428,0.014627,0.013839,0.013068,
  0.012315,0.011582,0.010870,0.010181,0.009515,0.008874,0.008258,0.007668,0.007103,0.006565,
  0.006053,0.005567,0.005107,0.004673,0.004264,0.003880,0.003521,0.003185,0.002872,0.002581,
  0.002312,0.002064,0.001835,0.001626,0.001434,0.001260,0.001102,0.000959,0.000830,0.000715,
  0.000612,0.000521,0.000440,0.000369,0.000308,0.000254,0.000208,0.000169,0.000136,0.000108,
  0.000084,0.000065,0.000050,0.000037,0.000027,0.000019,0.000014,0.000009,0.000006,0.000004,
  0.000002,0.000001,0.000001,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,0.000000,
]);

const DIST_TABLE = [UNIFORM_DIST, BETA_DIST_1, BETA_DIST_2, BETA_DIST_3, BETA_DIST_4];

// HMM constants from MonoPitchHMM.cpp.
const HMM_MIN_FREQ = 61.735;       // ~B1
const HMM_N_BPS    = 5;            // bins per semitone → 20 cents each
const HMM_N_PITCH  = 69 * HMM_N_BPS; // = 345 (paper conflict: paper says 480)
const HMM_TRANS_W  = 5 * (HMM_N_BPS >> 1) + 1; // = 11, ±5 bins = ±100 cents

export class PyinOp {
  static opId = 'pyin';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'f0',         kind: 'control' },
    { id: 'voicedProb', kind: 'control' },
    { id: 'voicedFlag', kind: 'control' },
  ]);
  static params = Object.freeze([
    { id: 'f0Min',     default: 61.735 },
    { id: 'f0Max',     default: 880 },
    { id: 'windowMs',  default: 46.4 },
    { id: 'hopMs',     default: 5.8 },
    { id: 'prior',     default: 2 },    // betaDist2 (mean 0.1 — paper's headline)
    { id: 'yinTrust',  default: 0.5 },
    { id: 'selfTrans', default: 0.99 },
    { id: 'lagFrames', default: 8 },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._f0Min     = 61.735;
    this._f0Max     = 880;
    this._windowMs  = 46.4;
    this._hopMs     = 5.8;
    this._prior     = 2;
    this._yinTrust  = 0.5;
    this._selfTrans = 0.99;
    this._lagFrames = 8;

    this._lastF0 = 0;
    this._lastVoicedProb = 0;
    this._lastVoicedFlag = 0;

    this._recompute();
    this._buildHMM();
  }

  _recompute() {
    this.W      = Math.max(32, Math.round(this._windowMs * 0.001 * this.sr));
    this.hop    = Math.max(1,  Math.round(this._hopMs    * 0.001 * this.sr));
    this.tauMin = Math.max(2,           Math.floor(this.sr / this._f0Max));
    this.tauMax = Math.min(this.W - 1,  Math.ceil (this.sr / this._f0Min));
    if (this.tauMax <= this.tauMin) this.tauMax = this.tauMin + 1;

    const frameLen = this.W + this.tauMax + 2;
    let n = 1; while (n < frameLen + 2) n <<= 1;
    this.buf     = new Float32Array(n);
    this.bufMask = n - 1;
    this.w       = 0;
    this.filled  = 0;

    this.frame    = new Float32Array(frameLen);
    this.df       = new Float32Array(this.tauMax + 1);
    this.cmndf    = new Float32Array(this.tauMax + 1);
    this.peakProb = new Float32Array(this.tauMax + 1);
  }

  _buildHMM() {
    const M = HMM_N_PITCH;
    const W = HMM_TRANS_W;
    const halfW = W >> 1;
    const self = this._selfTrans;

    // Pitch-bin center frequencies (voiced half). Unvoiced half mirrors with
    // negated freqs (Mauch's convention — used only to flag voiced state).
    const freqs = new Float32Array(2 * M);
    for (let i = 0; i < M; i++) {
      freqs[i]     = HMM_MIN_FREQ * Math.pow(2, i / (12 * HMM_N_BPS));
      freqs[i + M] = -freqs[i];
    }
    this.hmmFreqs = freqs;
    this.nState = 2 * M;

    // Sparse transition matrix: parallel (from, to, prob) arrays.
    const from = [], to = [], prob = [];
    for (let iPitch = 0; iPitch < M; iPitch++) {
      const theoreticalMinNext = iPitch - halfW;
      const minNext = Math.max(0, theoreticalMinNext);
      const maxNext = Math.min(M - 1, iPitch + halfW);

      // Triangular weights, peak at iPitch, linear decay to edges.
      let weightSum = 0;
      const weights = [];
      for (let i = minNext; i <= maxNext; i++) {
        const w = (i <= iPitch)
          ? (i - theoreticalMinNext + 1)
          : (iPitch - theoreticalMinNext + 1 - (i - iPitch));
        weights.push(w);
        weightSum += w;
      }
      for (let i = minNext; i <= maxNext; i++) {
        const w = weights[i - minNext] / weightSum;
        // v→v
        from.push(iPitch);         to.push(i);          prob.push(w * self);
        // v→u
        from.push(iPitch);         to.push(i + M);      prob.push(w * (1 - self));
        // u→u
        from.push(iPitch + M);     to.push(i + M);      prob.push(w * self);
        // u→v
        from.push(iPitch + M);     to.push(i);          prob.push(w * (1 - self));
      }
    }
    this.trFrom = new Int32Array(from);
    this.trTo   = new Int32Array(to);
    this.trProb = new Float32Array(prob);
    this.nTrans = prob.length;

    // Uniform initial over all states.
    this.init = new Float32Array(this.nState).fill(1 / this.nState);
    this.delta    = new Float32Array(this.nState);
    this.oldDelta = new Float32Array(this.nState);
    this.psiRing  = [];  // circular deque of Int32Arrays, length ≤ lagFrames+1
    this.obsScratch = new Float32Array(this.nState);
    this.hmmInitialized = false;
  }

  reset() {
    this.buf.fill(0);
    this.frame.fill(0); this.df.fill(0); this.cmndf.fill(0); this.peakProb.fill(0);
    this.w = 0; this.filled = 0;
    this._lastF0 = 0; this._lastVoicedProb = 0; this._lastVoicedFlag = 0;
    this.delta.fill(0); this.oldDelta.fill(0);
    this.psiRing.length = 0;
    this.hmmInitialized = false;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'f0Min':     this._f0Min     = Math.max(20,  Math.min(500,  v)); this._recompute(); break;
      case 'f0Max':     this._f0Max     = Math.max(200, Math.min(this.sr * 0.25, v)); this._recompute(); break;
      case 'windowMs':  this._windowMs  = Math.max(10,  Math.min(200,  v)); this._recompute(); break;
      case 'hopMs':     this._hopMs     = Math.max(1,   Math.min(50,   v)); this._recompute(); break;
      case 'prior':     this._prior     = Math.max(0,   Math.min(4,    v|0)); break;
      case 'yinTrust':  this._yinTrust  = Math.max(0,   Math.min(1,    v)); break;
      case 'selfTrans': this._selfTrans = Math.max(0,   Math.min(1,    v)); this._buildHMM(); break;
      case 'lagFrames': this._lagFrames = Math.max(1,   Math.min(64,   v|0)); break;
    }
  }

  process(inputs, outputs, N) {
    const inBuf  = inputs  && inputs.in         ? inputs.in         : null;
    const f0Out  = outputs && outputs.f0        ? outputs.f0        : null;
    const vpOut  = outputs && outputs.voicedProb ? outputs.voicedProb : null;
    const vfOut  = outputs && outputs.voicedFlag ? outputs.voicedFlag : null;
    if (!f0Out && !vpOut && !vfOut) return;

    const buf = this.buf, mask = this.bufMask, hop = this.hop;
    for (let n = 0; n < N; n++) {
      const x = inBuf ? inBuf[n] : 0;
      buf[this.w] = x;
      this.w = (this.w + 1) & mask;
      this.filled++;

      if (this.filled >= hop) {
        this.filled = 0;
        this._computeFrame();
      }

      if (f0Out) f0Out[n] = this._lastF0;
      if (vpOut) vpOut[n] = this._lastVoicedProb;
      if (vfOut) vfOut[n] = this._lastVoicedFlag;
    }
  }

  _computeFrame() {
    const W = this.W, tauMin = this.tauMin, tauMax = this.tauMax;
    const buf = this.buf, mask = this.bufMask;
    const frame = this.frame, df = this.df, cmndf = this.cmndf, peakProb = this.peakProb;
    const frameLen = W + tauMax;

    // --- Copy ring → flat frame (oldest first) ---
    let rd = (this.w - frameLen) & mask;
    for (let i = 0; i < frameLen; i++) { frame[i] = buf[rd]; rd = (rd + 1) & mask; }

    // --- Silent-frame gate (our deviation, matches #76 yin) ---
    let energy = 0;
    for (let j = 0; j < W; j++) energy += frame[j] * frame[j];
    if (energy < 1e-10) {
      this._lastF0 = 0; this._lastVoicedProb = 0; this._lastVoicedFlag = 0;
      return;
    }

    // --- YIN Step 2: d(τ) (de Cheveigné Eq. 6, same as #76) ---
    df[0] = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let j = 0; j < W; j++) {
        const d = frame[j] - frame[j + tau];
        s += d * d;
      }
      df[tau] = s;
    }

    // --- YIN Step 3: CMNDF (de Cheveigné Eq. 8) ---
    cmndf[0] = 1;
    let runSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      runSum += df[tau];
      cmndf[tau] = runSum > 0 ? (df[tau] * tau / runSum) : 1;
    }

    // --- pYIN Stage 1: probabilistic thresholding (YinUtil.cpp L270-L304) ---
    peakProb.fill(0);
    const dist = DIST_TABLE[this._prior];
    const nThr = 100;
    // thresholds[i] = 0.01 + 0.01·i; max = thresholds[99] = 1.00.
    const maxThresh = 0.01 + 0.01 * (nThr - 1);
    let minVal = Infinity, minInd = 0;
    let sumProb = 0;

    let tau = tauMin;
    while (tau + 1 < tauMax) {
      if (cmndf[tau] < maxThresh && cmndf[tau + 1] < cmndf[tau]) {
        // Descend to local minimum.
        while (tau + 1 < tauMax && cmndf[tau + 1] < cmndf[tau]) tau++;
        if (cmndf[tau] < minVal && tau > 2) {
          minVal = cmndf[tau];
          minInd = tau;
        }
        // Accumulate Beta PMF mass for all thresholds > cmndf[tau].
        // Mauch loops currThreshInd from nThr-1 downward while thresholds[i] > cmndf[tau].
        let ci = nThr - 1;
        const dp = cmndf[tau];
        while (ci >= 0 && (0.01 + 0.01 * ci) > dp) {
          peakProb[tau] += dist[ci];
          ci--;
        }
        sumProb += peakProb[tau];
        tau++;
      } else {
        tau++;
      }
    }

    // --- Stage-1 normalization (YinUtil.cpp L310-L320 in original) ---
    // "peakProb[i] = peakProb[i] / sumProb * peakProb[minInd]" — Mauch's odd
    // renormalization preserves the global-min mass, scales others by its ratio.
    if (sumProb > 0 && peakProb[minInd] > 0) {
      const scale = peakProb[minInd] / sumProb;
      for (let i = tauMin; i < tauMax; i++) peakProb[i] *= scale;
    }

    // --- Stage 2: observation probabilities per HMM state ---
    const M = HMM_N_PITCH;
    const nState = this.nState;
    const obs = this.obsScratch;
    obs.fill(0);

    let probYinPitched = 0;
    // Bin each τ candidate to nearest HMM pitch bin.
    for (let tauC = tauMin; tauC < tauMax; tauC++) {
      const p = peakProb[tauC];
      if (p <= 0) continue;
      // Parabolic refine on d′ (paper §2.1 says on d′; our #76 uses d).
      let tauR = tauC;
      if (tauC > 0 && tauC < tauMax) {
        const y0 = cmndf[tauC - 1], y1 = cmndf[tauC], y2 = cmndf[tauC + 1];
        const den = 2 * (y0 - 2 * y1 + y2);
        if (den !== 0) {
          const delta = (y0 - y2) / den;
          if (delta > -1 && delta < 1) tauR = tauC + delta;
        }
      }
      const f = this.sr / tauR;
      if (f <= HMM_MIN_FREQ) continue;
      // MonoPitchHMM::calculateObsProb nearest-bin lookup.
      let oldd = 1e9;
      for (let iPitch = 0; iPitch < M; iPitch++) {
        const d = Math.abs(f - this.hmmFreqs[iPitch]);
        if (oldd < d && iPitch > 0) {
          obs[iPitch - 1] += p;
          probYinPitched += p;
          break;
        }
        oldd = d;
      }
    }

    const yinTrust = this._yinTrust;
    const probReallyPitched = yinTrust * probYinPitched;
    if (probYinPitched > 0) {
      const scale = probReallyPitched / probYinPitched; // = yinTrust
      for (let iPitch = 0; iPitch < M; iPitch++) obs[iPitch] *= scale;
    }
    const unvoicedMass = (1 - probReallyPitched) / M;
    for (let iPitch = 0; iPitch < M; iPitch++) obs[iPitch + M] = unvoicedMass;

    // --- Stage 2: forward Viterbi step (SparseHMM.cpp process()) ---
    if (!this.hmmInitialized) {
      // Initialize with first observation.
      let dsum = 0;
      for (let s = 0; s < nState; s++) {
        this.oldDelta[s] = this.init[s] * obs[s];
        dsum += this.oldDelta[s];
      }
      if (dsum > 0) for (let s = 0; s < nState; s++) this.oldDelta[s] /= dsum;
      else          for (let s = 0; s < nState; s++) this.oldDelta[s] = 1 / nState;
      this.psiRing.push(new Int32Array(nState)); // trivial psi[0] = 0
      this.hmmInitialized = true;
      // No retrospective output at lag yet; keep last (zero) output.
      return;
    }

    const tempPsi = new Int32Array(nState);
    this.delta.fill(0);
    for (let t = 0; t < this.nTrans; t++) {
      const fs = this.trFrom[t], ts = this.trTo[t];
      const v = this.oldDelta[fs] * this.trProb[t];
      if (v > this.delta[ts]) {
        this.delta[ts] = v;
        tempPsi[ts] = fs;
      }
    }
    let dsum = 0;
    for (let s = 0; s < nState; s++) {
      this.delta[s] *= obs[s];
      dsum += this.delta[s];
    }
    if (dsum > 0) {
      for (let s = 0; s < nState; s++) { this.oldDelta[s] = this.delta[s] / dsum; this.delta[s] = 0; }
    } else {
      for (let s = 0; s < nState; s++) { this.oldDelta[s] = 1 / nState; this.delta[s] = 0; }
    }
    this.psiRing.push(tempPsi);

    // --- Fixed-lag trim + output at t−lag ---
    const lag = this._lagFrames;
    while (this.psiRing.length > lag + 1) this.psiRing.shift();

    // Best current state.
    let bestState = 0, bestVal = -1;
    for (let s = 0; s < nState; s++) {
      if (this.oldDelta[s] > bestVal) { bestVal = this.oldDelta[s]; bestState = s; }
    }
    // Walk back through retained psi to get state at oldest-retained frame.
    let state = bestState;
    for (let f = this.psiRing.length - 1; f > 0; f--) {
      state = this.psiRing[f][state];
    }

    // state ∈ [0, M) voiced; [M, 2M) unvoiced.
    const voiced = state < M;
    const pitchBin = voiced ? state : (state - M);
    this._lastVoicedFlag = voiced ? 1 : 0;
    this._lastF0 = voiced ? this.hmmFreqs[pitchBin] : 0;
    // voicedProb = raw probYinPitched (post-scale, pre-unvoiced redistribution).
    // Matches paper Eq. 6 interpretation: Σₖ p*ₖ · yinTrust = probReallyPitched.
    this._lastVoicedProb = Math.max(0, Math.min(1, probReallyPitched));
  }

  // Total latency: one full analysis window + lagFrames hops.
  getLatencySamples() { return this.W + this._lagFrames * this.hop; }
}
