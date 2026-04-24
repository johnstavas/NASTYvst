// op_truePeak.worklet.js — Stage-3 op sidecar for the `truePeak` op.
//
// Catalog #54 (Loudness / Metering). ITU-R BS.1770-5 Annex 2 True Peak
// (dBTP) meter. 4× oversampling via a 48-tap linear-phase FIR prototype,
// decomposed into 4 polyphase branches of 12 taps each. Peak envelope
// is instant-attack, exponential-release (IEC 60268-10 fall time).
//
// RESEARCH
//
// BS.1770-5 Annex 2 Table A2.1 specifies the 48-tap FIR for 4× upsampling.
// In polyphase form each phase is a 12-tap convolution with the most
// recent 12 input samples; phases 0–3 interleave to form the ×4-upsampled
// output. Phase 2 is the time-reversal of phase 1, and phase 3 is the
// time-reversal of phase 0 (linear-phase symmetry of the prototype FIR).
//
// Coefficients here come from the public ITU recommendation; cross-verify
// against `libebur128` (MIT) interpolator.c which implements the identical
// table. Canon:loudness §2 Annex 2.
//
// WHY OVERSAMPLING
//
// Inter-sample peaks (ISP) — peaks of the continuous waveform between
// sample instants — can exceed the max digital sample by up to ~3 dB on
// pathological material. A sample-domain peak meter misses these and
// can let a track clip on a D/A converter after being declared "under
// 0 dBFS". 4× oversampling recovers peaks to within ~0.5 dB of the
// true continuous peak, which is the BS.1770 guarantee and why
// streaming targets (e.g., −1 dBTP for Spotify/Apple/YouTube) are
// specified in dBTP, not dBFS.
//
// OUTPUT
//
// Linear peak magnitude (|y|). Downstream: wire into `curve` or inline
// 20·log10 to convert to dBTP. Resting value = 0 (silence → envelope
// decays to floor). Attack is sample-accurate (max of current peak
// sample vs decayed envelope); release is one-pole exponential with
// time constant `releaseMs / 1000` s.
//
// LATENCY
//
// Polyphase FIR has a group delay of (12−1)/2 = 5.5 samples at the input
// rate (≈22 samples at the 4× rate). We report 6 samples rounded up;
// the per-sample output is the peak envelope after the filter has
// absorbed that much history. A proper metering chain compensates this
// upstream or downstream — but since this op drives a control signal
// (not the audio path), the latency is diagnostic, not audible.

// ---- BS.1770-5 Annex 2 48-tap polyphase coefficients -----------------
// Phase 0 (taps 0, 4, 8, ..., 44)
const H0 = new Float64Array([
   0.0017089843750000,
   0.0109863281250000,
  -0.0196533203125000,
   0.0332031250000000,
  -0.0594482421875000,
   0.1373291015625000,
   0.9721679687500000,
  -0.1022949218750000,
   0.0476074218750000,
  -0.0266113281250000,
   0.0148925781250000,
  -0.0083007812500000,
]);
// Phase 1 (taps 1, 5, 9, ..., 45)
const H1 = new Float64Array([
  -0.0291748046875000,
   0.0292968750000000,
  -0.0517578125000000,
   0.0891113281250000,
  -0.1665039062500000,
   0.4650878906250000,
   0.7797851562500000,
  -0.2003173828125000,
   0.1015625000000000,
  -0.0582275390625000,
   0.0330810546875000,
  -0.0189208984375000,
]);
// Phase 2 (taps 2, 6, 10, ..., 46) = time-reverse of H1
const H2 = new Float64Array([
  -0.0189208984375000,
   0.0330810546875000,
  -0.0582275390625000,
   0.1015625000000000,
  -0.2003173828125000,
   0.7797851562500000,
   0.4650878906250000,
  -0.1665039062500000,
   0.0891113281250000,
  -0.0517578125000000,
   0.0292968750000000,
  -0.0291748046875000,
]);
// Phase 3 (taps 3, 7, 11, ..., 47) = time-reverse of H0
const H3 = new Float64Array([
  -0.0083007812500000,
   0.0148925781250000,
  -0.0266113281250000,
   0.0476074218750000,
  -0.1022949218750000,
   0.9721679687500000,
   0.1373291015625000,
  -0.0594482421875000,
   0.0332031250000000,
  -0.0196533203125000,
   0.0109863281250000,
   0.0017089843750000,
]);
const NTAPS    = 12;
const DENORMAL = 1e-30;

export class TruePeakOp {
  static opId = 'truePeak';
  static inputs  = Object.freeze([{ id: 'in',   kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'peak', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'releaseMs', default: 1700 },
  ]);

  constructor(sampleRate) {
    this.sr          = sampleRate;
    this._releaseS   = 1.7;
    this._alpha      = 0;
    this._env        = 0;
    // Circular history buffer of the last 12 input samples.
    this._hist       = new Float64Array(NTAPS);
    this._histIdx    = 0; // index of next write
    this._recomputeCoefs();
  }

  reset() {
    this._env = 0;
    this._hist.fill(0);
    this._histIdx = 0;
  }

  setParam(id, v) {
    if (id === 'releaseMs') {
      const n = +v;
      if (!Number.isFinite(n)) return;
      const clamped = n < 1 ? 1 : (n > 10000 ? 10000 : n);
      this._releaseS = clamped / 1000;
      this._recomputeCoefs();
    }
  }

  // Latency — polyphase FIR group delay (rounded up to samples at 1× rate).
  getLatencySamples() { return 6; }

  _recomputeCoefs() {
    this._alpha = Math.exp(-1 / (this._releaseS * this.sr));
  }

  // Convolve polyphase branch `h` against the 12-tap ring starting at
  // histIdx (which is the position of the OLDEST sample; the newest is
  // at histIdx-1 mod 12). We evaluate h[k] * hist[(histIdx - 1 - k) mod 12]
  // so that h[0] aligns with the newest sample.
  _convBranch(h) {
    const hist = this._hist;
    const idx = this._histIdx; // points to next-write (oldest slot)
    let acc = 0;
    // Taps: h[0] is newest sample coefficient.
    // Newest sample index = (idx - 1) mod NTAPS
    let p = (idx - 1 + NTAPS) & (NTAPS - 1); // NTAPS=12 — not a power of 2
    // NTAPS=12 is not pow-of-2; use modular arithmetic inline.
    p = (idx - 1 + NTAPS) % NTAPS;
    for (let k = 0; k < NTAPS; k++) {
      acc += h[k] * hist[p];
      p--;
      if (p < 0) p += NTAPS;
    }
    return acc;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.peak;
    if (!outCh) return;

    const a    = this._alpha;
    const hist = this._hist;
    let idx    = this._histIdx;
    let env    = this._env;

    if (!inCh) {
      // Decay envelope, still advance history toward zero.
      for (let i = 0; i < N; i++) {
        hist[idx] = 0;
        idx = (idx + 1) % NTAPS;
        env *= a;
        if (env < DENORMAL) env = 0;
        outCh[i] = env;
      }
      this._histIdx = idx;
      this._env = env;
      return;
    }

    for (let i = 0; i < N; i++) {
      // Push current input.
      hist[idx] = inCh[i];
      idx = (idx + 1) % NTAPS;

      // Convolve all four phases.
      // phase 0 output corresponds to the input sample itself (it is the
      // identity tap: H0[6] = 0.9722, dominates; other taps are the
      // interpolator's anti-aliasing). Phases 1–3 are the three new
      // samples inserted between this input and the next.
      let pmax = 0;
      // Inline convolution for speed — 4 phases × 12 taps.
      // Newest sample index = (idx - 1 + NTAPS) % NTAPS
      const newest = (idx - 1 + NTAPS) % NTAPS;
      for (let ph = 0; ph < 4; ph++) {
        const h = ph === 0 ? H0 : (ph === 1 ? H1 : (ph === 2 ? H2 : H3));
        let acc = 0;
        let p = newest;
        for (let k = 0; k < NTAPS; k++) {
          acc += h[k] * hist[p];
          p--;
          if (p < 0) p += NTAPS;
        }
        const a_ = acc < 0 ? -acc : acc;
        if (a_ > pmax) pmax = a_;
      }

      // Instant attack, exponential release.
      const decayed = env * a;
      env = pmax > decayed ? pmax : decayed;
      if (env < DENORMAL) env = 0;
      outCh[i] = env;
    }

    this._histIdx = idx;
    this._env     = env;
  }
}
