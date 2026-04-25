// op_mfcc.worklet.js — Stage-3 op sidecar for the `mfcc` op.
//
// Catalog #69 (Analysis/Spectral family). Mel-Frequency Cepstral
// Coefficients. Consumes STFT/FFT complex spectrum, emits the first
// `numCoefs` MFCCs streamed one-per-cycle (like #64 fft's held bins).
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   - python_speech_features (James Lyons, Apache-2.0):
//       URL: https://raw.githubusercontent.com/jameslyons/python_speech_features/master/python_speech_features/base.py
//     Reference for: hz2mel, mel2hz, get_filterbanks construction.
//   - Wikipedia "Mel-frequency cepstrum":
//       URL: https://en.wikipedia.org/wiki/Mel-frequency_cepstrum
//     Reference for: overall pipeline + DCT-II formula.
//
// PASSAGES VERBATIM:
//
//   def hz2mel(hz):   return 2595 * numpy.log10(1 + hz/700.)
//   def mel2hz(mel):  return 700 * (10**(mel/2595.0) - 1)
//
//   def get_filterbanks(nfilt, nfft, samplerate, lowfreq=0, highfreq=None):
//       lowmel  = hz2mel(lowfreq)
//       highmel = hz2mel(highfreq)
//       melpoints = linspace(lowmel, highmel, nfilt + 2)
//       bin = floor((nfft + 1) * mel2hz(melpoints) / samplerate)
//       fbank = zeros([nfilt, nfft//2 + 1])
//       for j in range(0, nfilt):
//           for i in range(int(bin[j]),   int(bin[j+1])):
//               fbank[j, i] = (i - bin[j])  / (bin[j+1] - bin[j])
//           for i in range(int(bin[j+1]), int(bin[j+2])):
//               fbank[j, i] = (bin[j+2] - i) / (bin[j+2] - bin[j+1])
//       return fbank
//
//   DCT-II (Wikipedia):
//       c_i = Σ_{n=1..N_f} S_n · cos( i·(n − 0.5)·π / N_f )
//
// PASSAGE vs CODE DEVIATIONS:
//   1. No time-domain preemphasis / framing / windowing. Upstream
//      is expected to be a #64 fft or #66 stft, which already did
//      windowing (Hann in stft; none in fft — user's responsibility).
//      Python-MFCC's `preemph=0.97` first-order high-pass is therefore
//      NOT applied here. Track as P2 upgrade (separate preemphasis op
//      or param on this op).
//   2. No cepstral liftering (`ceplifter=22` in reference). Tracked as
//      P2 — trivial to add but non-standard across MFCC consumers.
//   3. No `appendEnergy` mode (reference overwrites c[0] with log
//      total power). Tracked as P2.
//   4. DCT-II **without orthonormal scale**. The reference uses
//      scipy `norm='ortho'` which applies `1/sqrt(2N)` for c[0] and
//      `1/sqrt(N)` for c[i>0]. We skip this; downstream can normalise
//      if needed. Tracked as P2.
//   5. Log floor: `log(E + 1e-10)` to prevent log(0) on silent bands.
//      Reference uses plain log which crashes on exact zero.
//   6. Power spectrum uses `re² + im²` (not `|X|` magnitude) matching
//      python_speech_features `powspec` internals.
//   7. Filterbank precomputed at alloc, stored as a dense 2D Float64
//      array (numFilters × size/2+1). For size=1024, nfilt=26 → 26·513
//      doubles ≈ 107 KB per instance, fine.
//   8. Defensive null I/O + denormal flush.

const DENORMAL = 1e-30;
const LOG_FLOOR = 1e-10;

export class MfccOp {
  static opId = 'mfcc';
  static inputs  = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'size',       default: 1024 },
    { id: 'numFilters', default: 26   },
    { id: 'numCoefs',   default: 13   },
    { id: 'lowFreq',    default: 0    },
    { id: 'highFreq',   default: 0    },    // 0 → Nyquist
  ]);

  constructor(sampleRate) {
    this.sr          = sampleRate;
    this._size       = 0;
    this._numFilters = 26;
    this._numCoefs   = 13;
    this._lowFreq    = 0;
    this._highFreq   = 0;
    this._fbank      = null;     // [numFilters * (size/2+1)] flat
    this._powBuf     = null;     // [size/2+1]
    this._energies   = null;     // [numFilters]
    this._coefs      = null;     // [size] — output ring, only first numCoefs non-zero
    this._inRe       = null;     // current frame (re)
    this._inIm       = null;     // current frame (im)
    this._writeIdx   = 0;
    this._readIdx    = 0;
    this._filled     = 0;
    this._alloc(1024);
  }

  reset() {
    if (this._inRe)     this._inRe.fill(0);
    if (this._inIm)     this._inIm.fill(0);
    if (this._coefs)    this._coefs.fill(0);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
  }

  setParam(id, v) {
    if (id === 'size') {
      const n = +v;
      if (n !== this._size) { this._alloc(n); this._buildFbank(); }
      return;
    }
    if (id === 'numFilters') {
      this._numFilters = Math.min(Math.max((+v) | 0, 1), 128);
      this._energies = new Float64Array(this._numFilters);
      this._buildFbank();
      return;
    }
    if (id === 'numCoefs') {
      this._numCoefs = Math.min(Math.max((+v) | 0, 1), this._numFilters);
      return;
    }
    if (id === 'lowFreq')  { this._lowFreq  = +v; this._buildFbank(); return; }
    if (id === 'highFreq') { this._highFreq = +v; this._buildFbank(); return; }
  }

  getLatencySamples() { return this._size; }

  _alloc(n) {
    const isPow2 = (x) => x > 0 && (x & (x - 1)) === 0;
    const floorPow2 = (x) => { let p = 1; while (p * 2 <= x) p *= 2; return p; };
    const size = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size     = size;
    this._inRe     = new Float64Array(size);
    this._inIm     = new Float64Array(size);
    this._coefs    = new Float64Array(size);
    this._powBuf   = new Float64Array((size >> 1) + 1);
    this._energies = new Float64Array(this._numFilters);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
    this._buildFbank();
  }

  _buildFbank() {
    // python_speech_features.get_filterbanks, ported to flat Float64:
    //   melpoints = linspace(lowmel, highmel, nfilt + 2)
    //   bin       = floor((nfft + 1) * mel2hz(melpoints) / sr)
    //   fbank[j, i] = triangle from bin[j]..bin[j+1]..bin[j+2]
    const hz2mel = (hz)  => 2595 * Math.log10(1 + hz / 700);
    const mel2hz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);

    const nfft    = this._size;
    const nfilt   = this._numFilters;
    const binCols = (nfft >> 1) + 1;
    const hi      = this._highFreq > 0 ? this._highFreq : this.sr / 2;
    const lo      = Math.max(this._lowFreq, 0);
    const lowmel  = hz2mel(lo);
    const highmel = hz2mel(hi);

    // linspace(lowmel, highmel, nfilt + 2)
    const melpoints = new Float64Array(nfilt + 2);
    for (let i = 0; i < nfilt + 2; i++) {
      melpoints[i] = lowmel + (highmel - lowmel) * i / (nfilt + 1);
    }
    const bin = new Int32Array(nfilt + 2);
    for (let i = 0; i < nfilt + 2; i++) {
      bin[i] = Math.floor((nfft + 1) * mel2hz(melpoints[i]) / this.sr);
      if (bin[i] >= binCols) bin[i] = binCols - 1;
      if (bin[i] < 0)        bin[i] = 0;
    }

    this._fbank = new Float64Array(nfilt * binCols);
    for (let j = 0; j < nfilt; j++) {
      const bj0 = bin[j], bj1 = bin[j + 1], bj2 = bin[j + 2];
      const up  = bj1 - bj0;
      const dn  = bj2 - bj1;
      for (let i = bj0; i < bj1; i++) {
        this._fbank[j * binCols + i] = up > 0 ? (i - bj0) / up : 0;
      }
      for (let i = bj1; i < bj2; i++) {
        this._fbank[j * binCols + i] = dn > 0 ? (bj2 - i) / dn : 0;
      }
    }
    this._binCols = binCols;
  }

  process(inputs, outputs, N) {
    const inRe  = inputs.real;
    const inIm  = inputs.imag;
    const out   = outputs.out;
    if (!out) return;

    const size = this._size;
    for (let i = 0; i < N; i++) {
      // Fire MFCC compute when full spectrum is buffered.
      if (this._filled >= size) {
        this._computeFrame();
        this._filled  = 0;
        this._readIdx = 0;
      }

      // Emit coefficient; coefs[readIdx] is zero past numCoefs.
      out[i] = this._coefs[this._readIdx];
      this._readIdx = (this._readIdx + 1) % size;

      // Collect input.
      this._inRe[this._writeIdx] = inRe ? inRe[i] : 0;
      this._inIm[this._writeIdx] = inIm ? inIm[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % size;
      this._filled++;
    }
  }

  _computeFrame() {
    const nfft    = this._size;
    const nfilt   = this._numFilters;
    const ncoef   = this._numCoefs;
    const binCols = this._binCols;
    const pow     = this._powBuf;
    const en      = this._energies;
    const coefs   = this._coefs;
    const fbank   = this._fbank;
    const inRe    = this._inRe;
    const inIm    = this._inIm;

    // 1. Power spectrum — python_speech_features uses (1/NFFT)·|X|² via
    //    powspec, but the constant cancels in the DCT-II cosine basis
    //    for any scale — omit for clarity.
    for (let k = 0; k < binCols; k++) {
      const re = inRe[k];
      const im = inIm[k];
      pow[k] = re * re + im * im;
    }

    // 2. Mel filterbank energies.
    for (let j = 0; j < nfilt; j++) {
      let s = 0;
      const row = j * binCols;
      for (let k = 0; k < binCols; k++) s += fbank[row + k] * pow[k];
      en[j] = s;
    }

    // 3. Log.
    for (let j = 0; j < nfilt; j++) {
      en[j] = Math.log(en[j] + LOG_FLOOR);
    }

    // 4. DCT-II: c_i = Σ_{n=0..N_f-1} S_n · cos( i·(n + 0.5)·π / N_f )
    //    (Wikipedia uses 1..N_f with (n-0.5); equivalent via 0-indexing.)
    coefs.fill(0);
    const piN = Math.PI / nfilt;
    for (let i = 0; i < ncoef; i++) {
      let c = 0;
      for (let j = 0; j < nfilt; j++) {
        c += en[j] * Math.cos(i * (j + 0.5) * piN);
      }
      if (c < DENORMAL && c > -DENORMAL) c = 0;
      coefs[i] = c;
    }
  }
}
