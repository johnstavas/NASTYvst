// op_fft.worklet.js — Stage-3 op sidecar for the `fft` op.
//
// Catalog #64 (Analysis / Spectral family). Real-input FFT via iterative
// in-place radix-2 Cooley-Tukey. Block-FFT semantics: buffer `size`
// samples, run one FFT when full, emit the most recent spectrum on
// two output ports (`real`, `imag`). Between FFTs the outputs hold
// the previous spectrum (cyclic by bin index, one bin per sample).
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   Wikipedia — "Cooley-Tukey FFT algorithm", iterative radix-2
//   pseudocode, itself citing Cormen/Leiserson/Rivest/Stein,
//   "Introduction to Algorithms", 3rd ed., Chapter 30.
//   URL: https://en.wikipedia.org/wiki/Cooley%E2%80%93Tukey_FFT_algorithm
//   Canon:analysis §5 is the QFT form (Joshua Scholar 2003, external
//   tar.gz, double-precision convolution-reverb target with known
//   single-precision stability limits) — not appropriate as the
//   baseline for a general sandbox FFT primitive. Using the textbook
//   Cooley-Tukey form instead: math-by-definition (DFT) + the
//   canonical O(N log N) algorithm.
//
// PASSAGE VERBATIM (Wikipedia, iterative-fft):
//
//     algorithm iterative-fft is
//         input:  Array a of n complex values where n is a power of 2.
//         output: Array A the DFT of a.
//
//         bit-reverse-copy(a, A)
//         n ← a.length
//         for s = 1 to log(n) do
//             m ← 2^s
//             ω_m ← exp(−2πi/m)
//             for k = 0 to n-1 by m do
//                 ω ← 1
//                 for j = 0 to m/2 – 1 do
//                     t ← ω · A[k + j + m/2]
//                     u ← A[k + j]
//                     A[k + j]         ← u + t
//                     A[k + j + m/2]   ← u − t
//                     ω ← ω · ω_m
//         return A
//
//     algorithm bit-reverse-copy(a, A) is
//         n ← a.length
//         for k = 0 to n − 1 do
//             A[rev(k)] := a[k]
//
// DEVIATIONS from verbatim (declared):
//   1. Real input (not complex): input is an audio stream of real
//      samples; imaginary part of A is initialised to 0 during
//      bit-reverse-copy. Standard reduction — produces the full N-
//      length complex spectrum (Hermitian-symmetric for real input).
//   2. Split-array storage (real[] + imag[]) instead of complex[].
//      JS has no native complex type; two Float64Arrays are cache-
//      friendly and match the two-output-port shape.
//   3. `ω` cosine/sine computed inline per butterfly level with
//      incremental update `ω ← ω · ω_m` using real multiplication
//      `(wr, wi) ← (wr·wmr − wi·wmi, wr·wmi + wi·wmr)`. No twiddle
//      table — keeps the op self-contained; `size` is typically ≤
//      2^15 so compute budget is comfortable.
//   4. Streaming adapter: op runs one FFT per `size` input samples.
//      Between FFTs the outputs emit the previous spectrum, one bin
//      per output sample, cycling (`bin = readIdx % size`). This is
//      the standard sandbox adapter for block transforms and matches
//      `karplusStrong`/`waveguide`/`kellyLochbaum` which also carry
//      internal state across process calls.
//   5. `size` param clamped to a power of two in [16, 32768]. Non-
//      pow2 values snap down to the nearest pow2 (defensive; the
//      iterative algorithm requires n = 2^k).
//   6. Defensive: missing input → FFT buffer fills with zeros, spectrum
//      settles to zero after `size` samples. Missing output buffers
//      are no-ops.
//   7. No window function applied (raw rectangular). Window ops are
//      a separate primitive; composing window → fft is an explicit
//      graph decision.
//
// MATH SUMMARY:
//   For input x[0..N-1] real, output X[k] = Σ_{n=0..N-1} x[n] · e^(-2πikn/N)
//   for k = 0..N-1. Hermitian: X[N-k] = conj(X[k]).
//
// COMPLEXITY: O(N log N) time, O(N) space. At N=1024 that's ~10240
// complex multiplies per FFT; one FFT per 1024 input samples → ~10
// mul/sample amortised.

const DENORMAL = 1e-30;

function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }
function floorPow2(n) {
  let p = 1;
  while ((p << 1) <= n) p <<= 1;
  return p;
}

export class FftOp {
  static opId = 'fft';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'size', default: 1024 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._size = 1024;
    this._alloc(this._size);
  }

  _alloc(n) {
    const N = Math.min(Math.max(isPow2(n) ? n : floorPow2(n), 16), 32768);
    this._size    = N;
    this._buf     = new Float64Array(N);   // rolling input buffer
    this._re      = new Float64Array(N);   // FFT result real
    this._im      = new Float64Array(N);   // FFT result imag
    this._scratchRe = new Float64Array(N);
    this._scratchIm = new Float64Array(N);
    this._writeIdx = 0;
    this._readIdx  = 0;
    this._filled   = 0;
  }

  reset() {
    this._buf.fill(0);
    this._re.fill(0);
    this._im.fill(0);
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

  _fft() {
    const N = this._size;
    const re = this._scratchRe;
    const im = this._scratchIm;

    // bit-reverse-copy: write input (real) into re[rev(k)], im=0.
    const logN = Math.log2(N) | 0;
    for (let k = 0; k < N; k++) {
      let r = 0;
      let kk = k;
      for (let b = 0; b < logN; b++) { r = (r << 1) | (kk & 1); kk >>>= 1; }
      re[r] = this._buf[k];
      im[r] = 0;
    }

    // Butterflies: for s = 1 to log2(N).
    for (let s = 1; s <= logN; s++) {
      const m      = 1 << s;
      const mHalf  = m >> 1;
      const theta  = -2 * Math.PI / m;
      const wmr    = Math.cos(theta);
      const wmi    = Math.sin(theta);
      for (let k = 0; k < N; k += m) {
        let wr = 1, wi = 0;
        for (let j = 0; j < mHalf; j++) {
          const idxTop = k + j;
          const idxBot = k + j + mHalf;
          const tr = wr * re[idxBot] - wi * im[idxBot];
          const ti = wr * im[idxBot] + wi * re[idxBot];
          const ur = re[idxTop];
          const ui = im[idxTop];
          re[idxTop] = ur + tr;
          im[idxTop] = ui + ti;
          re[idxBot] = ur - tr;
          im[idxBot] = ui - ti;
          // ω ← ω · ω_m
          const nwr = wr * wmr - wi * wmi;
          const nwi = wr * wmi + wi * wmr;
          wr = nwr; wi = nwi;
        }
      }
    }

    // Copy scratch → held spectrum (reset readIdx so the next block
    // emits from bin 0).
    for (let i = 0; i < N; i++) { this._re[i] = re[i]; this._im[i] = im[i]; }
    this._readIdx = 0;
  }

  process(inputs, outputs, N) {
    const inCh    = inputs && inputs.in;
    const outRe   = outputs.real;
    const outIm   = outputs.imag;
    if (!outRe && !outIm) return;

    const size = this._size;
    const buf  = this._buf;

    for (let i = 0; i < N; i++) {
      // Fire FFT at top-of-loop once buffer has filled, so bin 0 emits
      // on the sample AFTER the fill completes (not the same sample).
      if (this._writeIdx >= size) {
        this._writeIdx = 0;
        this._fft();          // also resets readIdx = 0
        this._filled = size;
      }

      // Emit one spectrum bin per sample, cycling.
      const bin = this._readIdx++;
      if (this._readIdx >= size) this._readIdx = 0;
      if (outRe) outRe[i] = this._re[bin];
      if (outIm) outIm[i] = this._im[bin];

      // Write input sample into the ring buffer.
      buf[this._writeIdx++] = inCh ? inCh[i] : 0;
      if (this._filled < size) this._filled++;
    }

    // Denormal flush on bin 0 (DC); others scaled comparably.
    if (this._re[0] < DENORMAL && this._re[0] > -DENORMAL) this._re[0] = 0;
    if (this._im[0] < DENORMAL && this._im[0] > -DENORMAL) this._im[0] = 0;
  }
}
