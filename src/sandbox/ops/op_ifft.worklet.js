// op_ifft.worklet.js — Stage-3 op sidecar for the `ifft` op.
//
// Catalog #65 (Analysis / Spectral family). Inverse FFT via iterative
// in-place radix-2 Cooley-Tukey with conjugated twiddle and 1/N scale.
// Block-IFFT semantics symmetric to #64 fft: buffer `size` complex
// samples (two input streams: `real`, `imag`), run one IFFT when full,
// emit the real-part time-domain signal on `out`. Between IFFTs the
// output cycles through the held time-domain buffer.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   (a) MATH-BY-DEFINITION. The inverse DFT is defined as
//         x[n] = (1/N) · Σ_{k=0..N-1} X[k] · e^(+2πikn/N)
//       There is no "implementation paper" to consult for the definition.
//   (b) ALGORITHM PRIMARY = same as op_fft.worklet.js:
//       Wikipedia "Cooley-Tukey FFT algorithm" iterative radix-2
//       pseudocode (citing Cormen/Leiserson/Rivest/Stein *Introduction
//       to Algorithms* Ch. 30). Identical butterfly structure to the
//       forward FFT with TWO changes:
//         1. Twiddle ω_m = exp(+2πi/m)     (positive exponent)
//         2. Divide final result by N      (normalisation)
//       This is the standard shared-implementation trick: same code
//       path as forward FFT, sign-flipped theta, /N at the end.
//       Passage already captured verbatim in op_fft.worklet.js header.
//
// DEVIATIONS from the forward-FFT passage (declared):
//   1. `theta = +2π/m` (positive, inverse transform).
//   2. Final scaling: real-part buffer divided by N after butterflies.
//      Imaginary part discarded (output port is audio-real only).
//   3. Complex input (real + imag streams, not one real stream).
//      Bit-reverse-copy reads from BOTH input streams into scratch.
//      When `imag` input is missing, treated as zero-imaginary —
//      equivalent to treating X as real-valued (which is unusual but
//      defensible; most uses will have fed fft → ifft round-trip so
//      imag will be connected).
//   4. Single real output (`out`). For round-trip fft→ifft of real
//      signals the imaginary residue is numerical noise ≤ ~1e-12 at
//      N=1024 and is simply discarded. Users needing the full complex
//      inverse can patch an additional ifft instance reading a second
//      output port — not worth the extra port for the common case.
//   5. Streaming adapter identical to #64 fft (top-of-loop block fire,
//      ring buffer size=N, held output between blocks). See #64 header
//      for the off-by-one story that motivated the top-of-loop ordering.
//   6. `size` clamped to a power of two in [16, 32768], non-pow2 snap
//      down. Defensive: missing outputs → no-op; missing input streams
//      → zero.
//
// MATH SUMMARY (per block of N samples):
//   Given X[k] = (real[k], imag[k]), k=0..N-1:
//     1. re'[rev(k)], im'[rev(k)] ← real[k], imag[k]   (bit-reverse)
//     2. For s = 1..log2(N):
//          m = 2^s, ω_m = exp(+2πi/m),
//          per butterfly: (u + ω·v, u − ω·v)           (same structure)
//     3. For i = 0..N-1: out_time[i] = re'[i] / N
//
// Round-trip (fft → ifft) reproduces the input up to ~1e-12 error at
// N=1024 (double precision accumulated error over log₂N butterfly
// levels — matches the forward-FFT numerical noise floor).

const DENORMAL = 1e-30;

function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }
function floorPow2(n) {
  let p = 1;
  while ((p << 1) <= n) p <<= 1;
  return p;
}

export class IfftOp {
  static opId = 'ifft';
  static inputs  = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'size', default: 1024 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._size = 1024;
    this._alloc(this._size);
  }

  _alloc(n) {
    const N = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size     = N;
    this._bufRe    = new Float64Array(N);
    this._bufIm    = new Float64Array(N);
    this._outBuf   = new Float64Array(N);   // held time-domain result
    this._scratchRe = new Float64Array(N);
    this._scratchIm = new Float64Array(N);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
  }

  reset() {
    this._bufRe.fill(0);
    this._bufIm.fill(0);
    this._outBuf.fill(0);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
  }

  setParam(id, v) {
    if (id === 'size') {
      const N = +v | 0;
      if (N !== this._size) this._alloc(N);
    }
  }

  getLatencySamples() { return this._size; }

  _ifft() {
    const N = this._size;
    const re = this._scratchRe;
    const im = this._scratchIm;

    // bit-reverse-copy from (bufRe, bufIm) into (re, im).
    const logN = Math.log2(N) | 0;
    for (let k = 0; k < N; k++) {
      let r = 0;
      let kk = k;
      for (let b = 0; b < logN; b++) { r = (r << 1) | (kk & 1); kk >>>= 1; }
      re[r] = this._bufRe[k];
      im[r] = this._bufIm[k];
    }

    // Butterflies — identical to forward FFT except +2π/m (positive sign).
    for (let s = 1; s <= logN; s++) {
      const m      = 1 << s;
      const mHalf  = m >> 1;
      const theta  = +2 * Math.PI / m;      // INVERSE: positive exponent
      const wmr    = Math.cos(theta);
      const wmi    = Math.sin(theta);
      for (let k = 0; k < N; k += m) {
        let wr = 1, wi = 0;
        for (let j = 0; j < mHalf; j++) {
          const iT = k + j;
          const iB = k + j + mHalf;
          const tr = wr * re[iB] - wi * im[iB];
          const ti = wr * im[iB] + wi * re[iB];
          const ur = re[iT];
          const ui = im[iT];
          re[iT] = ur + tr;
          im[iT] = ui + ti;
          re[iB] = ur - tr;
          im[iB] = ui - ti;
          const nwr = wr * wmr - wi * wmi;
          const nwi = wr * wmi + wi * wmr;
          wr = nwr; wi = nwi;
        }
      }
    }

    // 1/N scale, real part only → output time-domain buffer.
    const inv = 1 / N;
    for (let i = 0; i < N; i++) this._outBuf[i] = re[i] * inv;
    this._readIdx = 0;
  }

  process(inputs, outputs, N) {
    const inRe = inputs && inputs.real;
    const inIm = inputs && inputs.imag;
    const out  = outputs.out;
    if (!out) return;

    const size = this._size;
    const bufRe = this._bufRe;
    const bufIm = this._bufIm;

    for (let i = 0; i < N; i++) {
      if (this._writeIdx >= size) {
        this._writeIdx = 0;
        this._ifft();        // also resets readIdx = 0
        this._filled = size;
      }

      const idx = this._readIdx++;
      if (this._readIdx >= size) this._readIdx = 0;
      out[i] = this._outBuf[idx];

      bufRe[this._writeIdx] = inRe ? inRe[i] : 0;
      bufIm[this._writeIdx] = inIm ? inIm[i] : 0;
      this._writeIdx++;
      if (this._filled < size) this._filled++;
    }

    // Denormal flush on DC sample of the held buffer.
    if (this._outBuf[0] < DENORMAL && this._outBuf[0] > -DENORMAL) this._outBuf[0] = 0;
  }
}
