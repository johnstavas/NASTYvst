// op_onset.worklet.js — Stage-3 op sidecar for the `onset` op.
//
// Catalog #74 (Analysis/Spectral). Spectral-flux onset detection.
// Consumes complex spectrum (real, imag); emits two audio streams:
//   - `strength` — continuous onset-detection-function value (held per frame)
//   - `onset`    — single-sample trigger pulse of 1.0 at detected peaks (else 0)
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - librosa/onset.py::onset_strength
//       URL: https://raw.githubusercontent.com/librosa/librosa/main/librosa/onset.py
//   - librosa/util/utils.py::peak_pick
//       URL: https://raw.githubusercontent.com/librosa/librosa/main/librosa/util/utils.py
//   - Böck, Widmer 2013 "Maximum filter vibrato suppression for onset detection"
//     (DAFx-13 Maynooth) — cited inline by librosa onset_strength.
//   - Böck, Krebs, Schedl 2012 "Evaluating the Online Capabilities of Onset
//     Detection Methods" (ISMIR 2012) — cited inline by peak_pick.
//   - License: librosa is ISC.
//
// PASSAGE VERBATIM (ODF, from onset_strength docstring):
//
//     mean_f max(0, S[f, t] - ref[f, t - lag])
//
//   where `ref` is S after local max filtering along the frequency axis.
//
// PASSAGE VERBATIM (peak_pick conditions):
//
//     1. x[n] == max(x[n - pre_max : n + post_max])
//     2. x[n] >= mean(x[n - pre_avg : n + post_avg]) + delta
//     3. n - previous_n > wait   (greedy)
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Causal (streaming) peak-pick window.** librosa evaluates peaks
//      offline with post_max / post_avg frames of lookahead. For a realtime
//      op we can't wait — we set post_max = post_avg = 1 (only the current
//      frame) and use pre_max / pre_avg for lookback only. This will miss
//      peaks that are only clear after a few more frames. P2 debt: add a
//      configurable lookahead frame buffer that delays output by `post_max`
//      frames in exchange for offline-quality detection.
//   2. **Spectrogram scaling.** librosa uses a log-power Mel-spectrogram by
//      default (`librosa.feature.melspectrogram` with amplitude_to_db).
//      v1 uses linear power spectrum (re² + im²) directly — mirrors mfcc's
//      "consumer of upstream FFT/STFT" pattern. Log/db + mel pre-transform
//      tracked as P2 (the consumer can pre-compose with mfcc or a
//      hypothetical log op to match).
//   3. **Local max filter on ref.** librosa's `max_size` param runs a 1D
//      maximum filter along the frequency axis of `S` before subtraction
//      (Böck vibrato suppression). We implement it as a sliding window
//      of width `maxSize` (odd; default 1 = disabled).
//   4. **No detrend.** librosa has an optional HP filter on the ODF; we
//      skip it in v1 (deviation, P2).
//   5. **No per-stream normalization in detect stage.** librosa scales
//      ODF to [0, 1] before peak_pick. We do it ourselves with a running
//      max (EMA-ish): track `strMax` = max of last `normWindow` frames
//      and divide by that. Avoids a full offline scan. Declared deviation.
//   6. **Denormal flush on strength and ref ring.**

const DENORMAL = 1e-30;

export class OnsetOp {
  static opId = 'onset';
  static inputs  = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static outputs = Object.freeze([
    { id: 'strength', kind: 'audio' },
    { id: 'onset',    kind: 'audio' },
  ]);
  static params  = Object.freeze([
    { id: 'size',    default: 1024 }, // STFT frame size (pow2, clamps)
    { id: 'lag',     default: 1    }, // frames
    { id: 'maxSize', default: 1    }, // freq-axis max-filter width (odd)
    { id: 'preMax',  default: 3    }, // frames
    { id: 'preAvg',  default: 10   }, // frames
    { id: 'delta',   default: 0.07 }, // threshold above local mean
    { id: 'wait',    default: 3    }, // frames since last onset
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._size     = 0;
    this._binCols  = 0;

    this._lag      = 1;
    this._maxSize  = 1;
    this._preMax   = 3;
    this._preAvg   = 10;
    this._delta    = 0.07;
    this._wait     = 3;

    // Analysis buffer — accumulates one frame of (real, imag) at a time.
    this._inRe     = null;
    this._inIm     = null;
    this._writeIdx = 0;
    this._filled   = 0;

    // Ring of past power spectra to implement lag reference (length = lag+1).
    // Stored flat: refRing[f * binCols + k], frame f modulo ringLen.
    this._ringLen  = 2;
    this._refRing  = null;
    this._ringPos  = 0;
    this._framesSeen = 0;

    // Strength history ring — max(preMax, preAvg, wait) + 1 frames.
    this._hist     = new Float64Array(256);
    this._histLen  = 256;
    this._histPos  = 0;

    // Output hold: one strength value held across the next `size` samples.
    // `onset` trigger pulse fires only on the first sample of a new frame
    // where detection criteria met.
    this._heldStr  = 0;
    this._heldOn   = 0;
    this._readIdx  = 0;

    // Running normalization.
    this._strMax   = 1e-12;

    // Last peak frame index (0-based, across all frames seen).
    this._lastPeak = -1;

    this._alloc(1024);
  }

  reset() {
    if (this._inRe) this._inRe.fill(0);
    if (this._inIm) this._inIm.fill(0);
    if (this._refRing) this._refRing.fill(0);
    this._hist.fill(0);
    this._writeIdx = 0;
    this._filled   = 0;
    this._ringPos  = 0;
    this._framesSeen = 0;
    this._histPos  = 0;
    this._heldStr  = 0;
    this._heldOn   = 0;
    this._readIdx  = 0;
    this._strMax   = 1e-12;
    this._lastPeak = -1;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'size') {
      if (n !== this._size) { this._alloc(n); }
    } else if (id === 'lag') {
      const L = Math.min(Math.max(Math.round(n), 1), 128);
      if (L !== this._lag) { this._lag = L; this._reallocRings(); }
    } else if (id === 'maxSize') {
      let M = Math.round(n);
      if (M < 1) M = 1;
      if (M > 99) M = 99;
      if ((M & 1) === 0) M += 1; // force odd
      this._maxSize = M;
    } else if (id === 'preMax') {
      this._preMax = Math.min(Math.max(Math.round(n), 0), 255);
      this._ensureHist();
    } else if (id === 'preAvg') {
      this._preAvg = Math.min(Math.max(Math.round(n), 0), 255);
      this._ensureHist();
    } else if (id === 'delta') {
      this._delta = n < 0 ? 0 : n;
    } else if (id === 'wait') {
      this._wait = Math.min(Math.max(Math.round(n), 0), 255);
      this._ensureHist();
    }
  }

  getLatencySamples() { return this._size; }

  _alloc(n) {
    const isPow2    = (x) => x > 0 && (x & (x - 1)) === 0;
    const floorPow2 = (x) => { let p = 1; while (p * 2 <= x) p *= 2; return p; };
    const size = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size    = size;
    this._binCols = (size >> 1) + 1;
    this._inRe    = new Float64Array(size);
    this._inIm    = new Float64Array(size);
    this._writeIdx = 0; this._filled = 0; this._readIdx = 0;
    this._heldStr  = 0; this._heldOn = 0;
    this._reallocRings();
  }

  _reallocRings() {
    this._ringLen = this._lag + 1;
    this._refRing = new Float64Array(this._ringLen * this._binCols);
    this._ringPos = 0;
    this._framesSeen = 0;
  }

  _ensureHist() {
    const need = Math.max(this._preMax, this._preAvg, this._wait) + 2;
    if (need > this._histLen) {
      const grown = new Float64Array(Math.max(need, this._histLen * 2));
      this._hist    = grown;
      this._histLen = grown.length;
      this._histPos = 0;
    }
  }

  _computeFrame() {
    const nfft    = this._size;
    const binCols = this._binCols;
    const refRing = this._refRing;
    const ringLen = this._ringLen;
    const maxSize = this._maxSize;
    const half    = (maxSize - 1) >> 1;

    // 1) Current-frame power spectrum.
    const cur = new Float64Array(binCols);
    for (let k = 0; k < binCols; k++) {
      const re = this._inRe[k];
      const im = this._inIm[k];
      cur[k] = re * re + im * im;
    }

    // 2) Fetch lagged reference frame. If we haven't seen `lag` frames yet,
    //    use zeros (so the first `lag` ODF values are exactly `mean(cur)`).
    let ref = null;
    if (this._framesSeen >= this._lag) {
      const lagIdx = (this._ringPos - this._lag + ringLen * 2) % ringLen;
      ref = refRing.subarray(lagIdx * binCols, (lagIdx + 1) * binCols);
    }

    // 3) Local max filter along frequency axis on `ref` (Böck vibrato
    //    suppression). maxSize=1 disables.
    let refLM = ref;
    if (ref && maxSize > 1) {
      refLM = new Float64Array(binCols);
      for (let k = 0; k < binCols; k++) {
        let m = 0;
        const k0 = Math.max(0, k - half);
        const k1 = Math.min(binCols - 1, k + half);
        for (let j = k0; j <= k1; j++) if (ref[j] > m) m = ref[j];
        refLM[k] = m;
      }
    }

    // 4) ODF = mean_f max(0, cur[f] - refLM[f]).
    let sum = 0;
    if (refLM) {
      for (let k = 0; k < binCols; k++) {
        const d = cur[k] - refLM[k];
        if (d > 0) sum += d;
      }
    } else {
      for (let k = 0; k < binCols; k++) sum += cur[k]; // ref all zero
    }
    let strength = sum / binCols;
    if (strength < DENORMAL) strength = 0;

    // 5) Store cur into ring for future lag lookups.
    for (let k = 0; k < binCols; k++) {
      refRing[this._ringPos * binCols + k] = cur[k];
    }
    this._ringPos = (this._ringPos + 1) % ringLen;
    this._framesSeen++;

    // 6) Running-max normalization (causal, decays slowly).
    if (strength > this._strMax) this._strMax = strength;
    const normWindow = Math.max(this._preMax, this._preAvg) + 1;
    this._strMax *= (1 - 1 / (normWindow * 8));   // slow leak
    if (this._strMax < 1e-12) this._strMax = 1e-12;
    const normStrength = strength / this._strMax;

    // 7) Push normalized strength into history ring.
    this._hist[this._histPos] = normStrength;
    this._histPos = (this._histPos + 1) % this._histLen;
    // Current frame index in hist = histPos − 1 (circular).
    const curHistIdx = (this._histPos - 1 + this._histLen) % this._histLen;

    // 8) Causal peak-pick (post_max = post_avg = 1; declared deviation).
    //    (a) local max over [n - preMax, n]
    //    (b) x[n] >= mean([n - preAvg, n]) + delta
    //    (c) n - lastPeak > wait
    let isPeak = false;
    if (this._framesSeen > this._preAvg && this._framesSeen > this._preMax) {
      // (a)
      let localMax = normStrength;
      for (let i = 1; i <= this._preMax; i++) {
        const idx = (curHistIdx - i + this._histLen) % this._histLen;
        if (this._hist[idx] > localMax) { localMax = this._hist[idx]; break; }
      }
      const isLocalMax = (localMax === normStrength);

      // (b)
      let meanN = 0, cnt = 0;
      for (let i = 0; i <= this._preAvg; i++) {
        const idx = (curHistIdx - i + this._histLen) % this._histLen;
        meanN += this._hist[idx]; cnt++;
      }
      meanN = cnt > 0 ? meanN / cnt : 0;

      const aboveMean = normStrength >= meanN + this._delta;

      // (c)
      const curFrame = this._framesSeen - 1;  // zero-based
      const spaced   = (this._lastPeak < 0) || (curFrame - this._lastPeak > this._wait);

      if (isLocalMax && aboveMean && spaced) {
        isPeak = true;
        this._lastPeak = curFrame;
      }
    }

    // 9) Latch held outputs for the next `size` samples.
    this._heldStr = normStrength;
    this._heldOn  = isPeak ? 1 : 0;
    this._readIdx = 0;
  }

  process(inputs, outputs, N) {
    const inRe = inputs.real;
    const inIm = inputs.imag;
    const outS = outputs.strength;
    const outO = outputs.onset;

    const size = this._size;
    for (let i = 0; i < N; i++) {
      // Output phase first (held values from the last completed frame).
      if (outS) outS[i] = this._heldStr;
      if (outO) outO[i] = (this._readIdx === 0 ? this._heldOn : 0);
      this._readIdx = (this._readIdx + 1) % size;

      // Collect input samples into the frame buffer.
      this._inRe[this._writeIdx] = inRe ? inRe[i] : 0;
      this._inIm[this._writeIdx] = inIm ? inIm[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % size;
      this._filled++;

      // At frame boundary, compute a new frame.
      if (this._filled >= size) {
        this._filled = 0;
        this._computeFrame();
      }
    }
  }
}
