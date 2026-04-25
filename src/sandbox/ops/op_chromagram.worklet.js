// op_chromagram.worklet.js — Stage-3 op sidecar for the `chromagram` op.
//
// Catalog #73 (Analysis/Spectral). 12-pitch-class chroma feature.
// Consumes complex spectrum (real, imag), emits n_chroma values streamed
// one-per-cycle like #62 mfcc and #64 fft.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - librosa/feature/spectral.py::chroma_stft
//       URL: https://raw.githubusercontent.com/librosa/librosa/main/librosa/feature/spectral.py
//   - librosa/filters.py::chroma
//       URL: https://raw.githubusercontent.com/librosa/librosa/main/librosa/filters.py
//   - Ellis 2007 "Chroma feature analysis and synthesis" (chromagram_E).
//     Cited inline in librosa chroma_stft docstring.
//   - License: librosa is ISC — reimpl permitted with attribution.
//
// PASSAGE VERBATIM (chroma filterbank, Python):
//
//   wts = np.zeros((n_chroma, n_fft))
//   frequencies = np.linspace(0, sr, n_fft, endpoint=False)[1:]
//   frqbins = n_chroma * hz_to_octs(frequencies, tuning=tuning,
//                                   bins_per_octave=n_chroma)
//   # 0 Hz kludge — 1.5 octaves below bin 1
//   frqbins = np.concatenate(([frqbins[0] - 1.5*n_chroma], frqbins))
//   binwidthbins = np.concatenate((np.maximum(frqbins[1:] - frqbins[:-1], 1.0), [1]))
//   D = np.subtract.outer(frqbins, np.arange(0, n_chroma, dtype="d")).T
//   n_chroma2 = np.round(float(n_chroma) / 2)
//   D = np.remainder(D + n_chroma2 + 10 * n_chroma, n_chroma) - n_chroma2
//   wts = np.exp(-0.5 * (2 * D / np.tile(binwidthbins, (n_chroma, 1))) ** 2)
//   wts = util.normalize(wts, norm=norm, axis=0)    # L2-normalize columns
//   if octwidth is not None:
//       wts *= np.tile(np.exp(-0.5*(((frqbins/n_chroma - ctroct)/octwidth)**2)),
//                      (n_chroma, 1))
//   if base_c:
//       wts = np.roll(wts, -3 * (n_chroma // 12), axis=0)
//   return wts[:, : int(1 + n_fft / 2)]
//
// PASSAGE VERBATIM (chroma_stft body):
//
//   S, n_fft = _spectrogram(..., power=2, ...)      # power spectrum
//   chromafb = filters.chroma(sr, n_fft, tuning, n_chroma, **kwargs)
//   raw_chroma = np.einsum("cf,...ft->...ct", chromafb, S, optimize=True)
//   return util.normalize(raw_chroma, norm=np.inf, axis=-2)   # L∞ per-frame
//
// hz_to_octs (librosa/convert.py, paraphrase — opening not strictly required
// as the math is trivial and documented inline): log2(f / (A440/16)) with
// A440 = 440 * 2^(tuning/bpo); A0 = A440/16 = 27.5 Hz at tuning=0.
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Upstream is pre-computed complex spectrum, not time-domain y.**
//      librosa's chroma_stft computes STFT internally (power=2). We consume
//      (real, imag) from #66 stft or #64 fft directly → `|X|² = re² + im²`
//      inline. Equivalent math, different graph boundary.
//   2. **L∞ per-frame normalization only** (norm=np.inf default). librosa
//      exposes `norm` param (L1/L2/max). Skipping that knob in v1 — `max`
//      is the default and what every downstream user expects.
//   3. **L2 per-filter normalization at build time** matches librosa's
//      `util.normalize(wts, norm=2, axis=0)` default.
//   4. **DC bin handling**: librosa's first entry in `frequencies` is
//      `sr/n_fft` (skips k=0 via `[1:]`). We iterate k = 1..binCols-1 and
//      set wts[c][0] = 0 (DC has no chroma).
//   5. **Nyquist bin**: librosa slices `wts[:, :1 + n_fft/2]` at the end.
//      We build directly over binCols = size/2 + 1, identical result.
//   6. **Denormal flush** on the output coefs (1e-30 threshold) — librosa
//      runs on float64 numpy, denormals are irrelevant there.
//   7. **No auto-tuning estimation**. librosa runs `estimate_tuning` if
//      tuning=None; we take `tuning` as a param default 0. Auto-tuning
//      requires peak-tracking over multiple frames — scoped out, P2.
//   8. **base_c default true** matches librosa. When true, bin 0 = C.
//      When false, bin 0 = A.

const DENORMAL  = 1e-30;
const A0_HZ     = 27.5;         // A0 = A440 / 16 at tuning=0

export class ChromagramOp {
  static opId = 'chromagram';
  static inputs  = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'size',     default: 1024 },
    { id: 'nChroma',  default: 12   },
    { id: 'tuning',   default: 0    },
    { id: 'ctroct',   default: 5.0  },
    { id: 'octwidth', default: 2.0  },
    { id: 'baseC',    default: 1    },  // 1 = C-based, 0 = A-based
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._size     = 0;
    this._nChroma  = 12;
    this._tuning   = 0;
    this._ctroct   = 5.0;
    this._octwidth = 2.0;
    this._baseC    = 1;

    this._fbank    = null;   // [nChroma * binCols]
    this._binCols  = 0;

    this._inRe     = null;
    this._inIm     = null;
    this._coefs    = null;   // output ring, only first nChroma slots non-zero
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
    this._alloc(1024);
  }

  reset() {
    if (this._inRe)  this._inRe.fill(0);
    if (this._inIm)  this._inIm.fill(0);
    if (this._coefs) this._coefs.fill(0);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'size') {
      if (n !== this._size) { this._alloc(n); this._buildFbank(); }
      return;
    }
    if (id === 'nChroma') {
      const c = Math.min(Math.max(Math.round(n), 3), 64);
      if (c !== this._nChroma) { this._nChroma = c; this._buildFbank(); }
      return;
    }
    if (id === 'tuning')   { this._tuning   = n; this._buildFbank(); return; }
    if (id === 'ctroct')   { this._ctroct   = n; this._buildFbank(); return; }
    if (id === 'octwidth') { this._octwidth = n; this._buildFbank(); return; }
    if (id === 'baseC')    { this._baseC    = n ? 1 : 0; this._buildFbank(); return; }
  }

  getLatencySamples() { return this._size; }

  _alloc(n) {
    const isPow2    = (x) => x > 0 && (x & (x - 1)) === 0;
    const floorPow2 = (x) => { let p = 1; while (p * 2 <= x) p *= 2; return p; };
    const size = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size    = size;
    this._inRe    = new Float64Array(size);
    this._inIm    = new Float64Array(size);
    this._coefs   = new Float64Array(size);
    this._binCols = (size >> 1) + 1;
    this._writeIdx = 0; this._readIdx = 0; this._filled = 0;
    this._buildFbank();
  }

  _buildFbank() {
    // librosa chroma filterbank construction. All comments in this fn map
    // one-to-one onto the PASSAGE VERBATIM block above.
    const nC      = this._nChroma;
    const binCols = this._binCols;
    const nFft    = this._size;
    const sr      = this.sr;
    const tuning  = this._tuning;
    const ctroct  = this._ctroct;
    const octwid  = this._octwidth;
    const baseC   = this._baseC;

    // hz_to_octs(f) = log2(f / A0)  with A0 = 27.5 · 2^(tuning/nC).
    // Returns octaves above A0. Convert to "chroma units" by × nC.
    const A0 = A0_HZ * Math.pow(2, tuning / nC);
    const toFrqBin = (hz) => nC * Math.log2(hz / A0);

    // frequencies = linspace(0, sr, nFft, endpoint=False)[1:]  (skip DC)
    //   but we build over binCols = nFft/2+1 and skip k=0 ourselves.
    // Build `frqbins` for k = 0..binCols-1. k=0 gets the "1.5 octaves below
    // bin 1" kludge after we compute bin 1.
    const frqbins = new Float64Array(binCols);
    for (let k = 1; k < binCols; k++) {
      frqbins[k] = toFrqBin(sr * k / nFft);
    }
    frqbins[0] = frqbins[1] - 1.5 * nC;

    // binwidthbins[k] = max(frqbins[k+1] - frqbins[k], 1.0); last = 1
    const binw = new Float64Array(binCols);
    for (let k = 0; k < binCols - 1; k++) {
      const d = frqbins[k + 1] - frqbins[k];
      binw[k] = d > 1 ? d : 1;
    }
    binw[binCols - 1] = 1;

    // D[c][k] = ((frqbins[k] - c) + nC/2 + 10*nC) mod nC - nC/2
    // wts[c][k] = exp(-0.5 * (2·D / binw[k])²)
    const wts = new Float64Array(nC * binCols);
    const half = Math.round(nC / 2);
    for (let c = 0; c < nC; c++) {
      for (let k = 0; k < binCols; k++) {
        let D = frqbins[k] - c;
        D = ((D + half + 10 * nC) % nC) - half;
        const z = 2 * D / binw[k];
        wts[c * binCols + k] = Math.exp(-0.5 * z * z);
      }
    }

    // L2-normalize each column (axis=0 in librosa).
    for (let k = 0; k < binCols; k++) {
      let n2 = 0;
      for (let c = 0; c < nC; c++) n2 += wts[c * binCols + k] ** 2;
      const norm = Math.sqrt(n2);
      if (norm > 1e-12) {
        for (let c = 0; c < nC; c++) wts[c * binCols + k] /= norm;
      }
    }

    // Dominance window (Gaussian in octaves around ctroct).
    if (Number.isFinite(octwid) && octwid > 0) {
      for (let k = 0; k < binCols; k++) {
        const octs = frqbins[k] / nC - ctroct;
        const w    = Math.exp(-0.5 * (octs / octwid) ** 2);
        for (let c = 0; c < nC; c++) wts[c * binCols + k] *= w;
      }
    }

    // DC has no chroma.
    for (let c = 0; c < nC; c++) wts[c * binCols + 0] = 0;

    // base_c: rotate rows by -3 (A → C) if using 12 bins.
    if (baseC && (nC % 12 === 0)) {
      const shift = 3 * (nC / 12);
      const rotated = new Float64Array(nC * binCols);
      for (let c = 0; c < nC; c++) {
        const src = ((c + shift) % nC + nC) % nC;
        for (let k = 0; k < binCols; k++) {
          rotated[c * binCols + k] = wts[src * binCols + k];
        }
      }
      this._fbank = rotated;
    } else {
      this._fbank = wts;
    }
  }

  process(inputs, outputs, N) {
    const inRe = inputs.real;
    const inIm = inputs.imag;
    const out  = outputs.out;
    if (!out) return;

    const size = this._size;
    for (let i = 0; i < N; i++) {
      if (this._filled >= size) {
        this._computeFrame();
        this._filled  = 0;
        this._readIdx = 0;
      }
      out[i] = this._coefs[this._readIdx];
      this._readIdx = (this._readIdx + 1) % size;

      this._inRe[this._writeIdx] = inRe ? inRe[i] : 0;
      this._inIm[this._writeIdx] = inIm ? inIm[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % size;
      this._filled++;
    }
  }

  _computeFrame() {
    const nC      = this._nChroma;
    const binCols = this._binCols;
    const fbank   = this._fbank;
    const inRe    = this._inRe;
    const inIm    = this._inIm;
    const coefs   = this._coefs;

    coefs.fill(0);

    // Power spectrum |X|² on bins k=0..binCols-1 (DC contributes zero via
    // fbank masking; Nyquist is included).
    // Pipeline: raw_chroma[c] = Σ_k fbank[c,k] · |X[k]|²; then L∞ normalize.
    let maxAbs = 0;
    for (let c = 0; c < nC; c++) {
      let s = 0;
      const row = c * binCols;
      for (let k = 0; k < binCols; k++) {
        const re = inRe[k];
        const im = inIm[k];
        s += fbank[row + k] * (re * re + im * im);
      }
      if (s < DENORMAL && s > -DENORMAL) s = 0;
      coefs[c] = s;
      const a = s < 0 ? -s : s;
      if (a > maxAbs) maxAbs = a;
    }

    // L∞ per-frame normalization (librosa default).
    if (maxAbs > 1e-20) {
      const inv = 1 / maxAbs;
      for (let c = 0; c < nC; c++) coefs[c] *= inv;
    }
  }
}
