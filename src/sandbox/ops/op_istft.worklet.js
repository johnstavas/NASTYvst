// op_istft.worklet.js — Stage-3 op sidecar for the `istft` op.
//
// Catalog #67 (Analysis/Spectral family). Inverse STFT via overlap-add
// (OLA) resynthesis. Companion to #66 stft; closes the spectral
// round-trip chain (fft/ifft handle single-frame; stft/istft handle
// streaming windowed-frame analysis/resynthesis).
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   JOS SASP, "Overlap-Add (OLA) STFT Processing".
//   URL: https://ccrma.stanford.edu/~jos/sasp/Overlap_Add_OLA_STFT_Processing.html
//
// PASSAGE VERBATIM:
//
//   Synthesis:
//       x(n) = Σ_{m=−∞}^{∞} x_m(n)
//     where each frame is the inverse DTFT:
//       x_m(n) = IDTFT_n(X_m)
//
//   COLA condition (prerequisite for perfect reconstruction):
//       Σ_{m=−∞}^{∞} w(n − mR) = 1, ∀n ∈ ℤ   (w ∈ COLA(R))
//
//   FFT implementation (filtered OLA, here with H_m = 1 for pure
//   resynthesis):
//       y = Σ_{m=−∞}^{∞} shift_{mR}(fft_N^{-1}{ fft_N[shift_{-mR}(x)·w_M] })
//
// COLA for the Hann window: Hann satisfies COLA(M/2) with gain 1,
// COLA(M/4) with gain 1.5 (needs normalisation), and NOT COLA(M) or
// COLA(M/3). Default here is size=1024, hop=256 (= M/4) matching #66
// stft — so analysis·synthesis round-trip requires dividing by 1.5.
// That's folded into `_olaScale` on every setParam.
//
// DSP:
//   - Input: two streams (`real`, `imag`), 1 (re,im) pair per cycle.
//   - Output: one stream (`out`), 1 real sample per cycle.
//   - Internal:
//       specRe/specIm — ring of size N accumulating incoming bins
//       olaBuf        — output OLA ring of size N; samples read out
//                       and then zeroed (each slot consumed once)
//   - Every N (re,im) samples: run IDFT (same Cooley-Tukey as #64,
//     twiddle +2π/m, 1/N scale — see #65 ifft), multiply by Hann
//     synthesis window, add into olaBuf starting at `olaWrite`
//     offset, advance `olaWrite` by `hop` (mod N).
//   - Per sample: emit `olaBuf[olaRead]`, zero the slot, advance
//     olaRead by 1 (mod N).
//
// PASSAGE vs CODE DEVIATIONS:
//   1. Finite stream: the passage sums m from −∞ to +∞. We process
//      causally; first output frame appears after N (re,im) samples
//      have been consumed (one full spectrum). This is streaming
//      reality, not a math deviation.
//   2. Filter H_m = 1 (pure resynth). We do NOT apply a frequency-
//      domain filter; that's a separate op.
//   3. Synthesis window = Hann (Harris 1978), identical form to the
//      analysis window in #66 stft. JOS allows any window; using the
//      same one on both sides gives sqrt-like combined weighting that
//      COLA-sums to a known scalar — we track it in `_olaScale`.
//   4. `_olaScale = hop / (M/2)` compensates the Hann×Hann OLA gain
//      at 75%-overlap. Derivation: Σ w²(n − mR) over m = M/(2R)·const,
//      giving gain 2 at R=M/4. We divide by that. See tests for the
//      round-trip null assertion.
//   5. Defensive null I/O (standard op contract).
//   6. Denormal flush on spectrum ring + olaBuf.
//
// This op alone does NOT do fft→modify→ifft — it only does the
// resynthesis side. For analysis, feed in the complex output of #66
// stft; the test `stft → istft round-trip` verifies ~null at hop=N/4.

const DENORMAL = 1e-30;

export class IstftOp {
  static opId = 'istft';
  static inputs  = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'size', default: 1024 },
    { id: 'hop',  default: 256  },
  ]);

  constructor(sampleRate) {
    this.sr     = sampleRate;
    this._size  = 0;
    this._hop   = 256;
    this._hann  = null;
    this._specRe = null;
    this._specIm = null;
    this._sRe   = null;       // scratch for IFFT
    this._sIm   = null;
    this._olaBuf = null;

    this._writeIdx = 0;       // cursor into specRe/specIm
    this._filled   = 0;       // samples collected into current spectrum
    this._olaWrite = 0;       // ring offset where next IFFT frame adds in
    this._olaRead  = 0;       // read cursor for output

    this._olaScale = 1;       // Hann² OLA gain compensation
    this._alloc(1024);
  }

  reset() {
    if (this._specRe) this._specRe.fill(0);
    if (this._specIm) this._specIm.fill(0);
    if (this._olaBuf) this._olaBuf.fill(0);
    this._writeIdx = 0;
    this._filled   = 0;
    this._olaWrite = 0;
    this._olaRead  = 0;
  }

  setParam(id, v) {
    if (id === 'size') {
      const n = +v;
      if (n !== this._size) this._alloc(n);
      return;
    }
    if (id === 'hop') {
      this._hop = Math.min(Math.max(+v | 0, 1), this._size);
      this._recomputeScale();
      return;
    }
  }

  getLatencySamples() { return this._size; }

  _alloc(n) {
    const isPow2 = (x) => x > 0 && (x & (x - 1)) === 0;
    const floorPow2 = (x) => { let p = 1; while (p * 2 <= x) p *= 2; return p; };
    const size = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size = size;
    this._hann = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      this._hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
    }
    this._specRe = new Float64Array(size);
    this._specIm = new Float64Array(size);
    this._sRe    = new Float64Array(size);
    this._sIm    = new Float64Array(size);
    this._olaBuf = new Float64Array(size);
    this._writeIdx = 0;
    this._filled   = 0;
    this._olaWrite = 0;
    this._olaRead  = 0;
    this._hop = Math.min(Math.max(this._hop, 1), size);
    this._recomputeScale();
  }

  _recomputeScale() {
    // Sum of Hann²(n) samples at OLA stride R = hop. For a symmetric
    // Hann window of length M with 75%-overlap (R = M/4), the OLA
    // overlap-sum of w² converges to 0.375·M/R. We divide output by it.
    const M = this._size;
    const R = this._hop;
    let s = 0;
    for (let i = 0; i < M; i++) s += this._hann[i] * this._hann[i];
    const olaGain = s / R;
    this._olaScale = olaGain > 0 ? 1 / olaGain : 1;
  }

  process(inputs, outputs, N) {
    const inRe = inputs.real;
    const inIm = inputs.imag;
    const out  = outputs.out;
    if (!out) return;

    const size = this._size;
    const hop  = this._hop;
    const spRe = this._specRe;
    const spIm = this._specIm;
    const ola  = this._olaBuf;

    for (let i = 0; i < N; i++) {
      // Fire IDFT when we've collected a full spectrum.
      if (this._filled >= size) {
        this._ifftAndOverlap();
        this._filled = 0;
      }

      // Emit from OLA ring; zero the slot (each consumed once).
      const rIdx = this._olaRead;
      const y = ola[rIdx];
      ola[rIdx] = 0;
      out[i] = y;
      this._olaRead = (rIdx + 1) % size;

      // Collect next (re, im) sample into spectrum buffer.
      spRe[this._writeIdx] = inRe ? inRe[i] : 0;
      spIm[this._writeIdx] = inIm ? inIm[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % size;
      this._filled++;
    }
  }

  _ifftAndOverlap() {
    const N = this._size;
    const sRe = this._sRe;
    const sIm = this._sIm;
    const inRe = this._specRe;
    const inIm = this._specIm;

    // Bit-reverse permutation copy.
    let logN = 0; { let t = N; while (t > 1) { t >>= 1; logN++; } }
    for (let k = 0; k < N; k++) {
      let rk = 0, kk = k;
      for (let b = 0; b < logN; b++) { rk = (rk << 1) | (kk & 1); kk >>= 1; }
      sRe[rk] = inRe[k];
      sIm[rk] = inIm[k];
    }

    // Cooley-Tukey butterflies, twiddle +2π/m (IDFT sign).
    for (let s = 1; s <= logN; s++) {
      const m = 1 << s;
      const mHalf = m >> 1;
      const theta = 2 * Math.PI / m;  // inverse: +theta
      const wmr = Math.cos(theta);
      const wmi = Math.sin(theta);
      for (let k = 0; k < N; k += m) {
        let wr = 1, wi = 0;
        for (let j = 0; j < mHalf; j++) {
          const iT = k + j;
          const iB = k + j + mHalf;
          const tr = wr * sRe[iB] - wi * sIm[iB];
          const ti = wr * sIm[iB] + wi * sRe[iB];
          const ur = sRe[iT];
          const ui = sIm[iT];
          sRe[iT] = ur + tr;
          sIm[iT] = ui + ti;
          sRe[iB] = ur - tr;
          sIm[iB] = ui - ti;
          const nwr = wr * wmr - wi * wmi;
          const nwi = wr * wmi + wi * wmr;
          wr = nwr; wi = nwi;
        }
      }
    }

    // 1/N scale + window + overlap-add into OLA ring.
    const inv = 1 / N;
    const scale = inv * this._olaScale;
    const hann = this._hann;
    const ola = this._olaBuf;
    let o = this._olaWrite;
    for (let k = 0; k < N; k++) {
      ola[o] += sRe[k] * scale * hann[k];
      o = (o + 1) % N;
    }
    this._olaWrite = (this._olaWrite + this._hop) % N;

    // Denormal flush on OLA buffer (long-tail slots).
    for (let k = 0; k < N; k++) {
      const v = ola[k];
      if (v < DENORMAL && v > -DENORMAL) ola[k] = 0;
    }
  }
}
