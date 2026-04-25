// op_stft.worklet.js — Stage-3 op sidecar for the `stft` op.
//
// Catalog #66 (Analysis / Spectral family). Short-Time Fourier Transform
// — sliding windowed FFT analyser. On every hop of R samples, computes
// the Hann-windowed FFT of the most recent `size` samples. Outputs the
// most recent spectrum on (real, imag) streams, one bin per sample,
// cycling at rate 1/R frames per second. Composes #64 fft internally.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   Julius O. Smith, "Spectral Audio Signal Processing" (SASP),
//   Stanford CCRMA, "Mathematical Definition of the STFT".
//   URL: https://ccrma.stanford.edu/~jos/sasp/Mathematical_Definition_STFT.html
//
// PASSAGE VERBATIM (STFT definition + COLA):
//
//   X_m(ω) = Σ_{n=-∞..∞} x(n) · w(n − mR) · e^{−jωn}
//
//   where
//     x(n)    is the input signal at time n,
//     w(n)    is the analysis window function of length M,
//     R       is the hop size in samples between successive analyses,
//     X_m(ω)  is the DTFT of the windowed data centred at time mR.
//
//   COLA (Constant OverLap-Add) condition for perfect reconstruction:
//     Σ_{m=-∞..∞} w(n − mR) = 1   ∀n ∈ ℤ
//
// Hann window (standard M-point form, separately cited — Harris 1978
// "On the use of windows for harmonic analysis with the discrete
// Fourier transform", Proc. IEEE 66(1)):
//     w[n] = 0.5 · (1 − cos(2πn / (M − 1))),   n = 0..M−1
//   At R = M/4 (75% overlap) Hann satisfies COLA at amplitude 1.5
//   (standard analysis-window gain; JOS SASP Ch. 9).
//
// DEVIATIONS from verbatim (declared):
//   1. Finite sum: `n` ranges 0..M−1 (not −∞..+∞) — standard finite-
//      support window, implicit in any practical implementation.
//      Samples outside the window carry zero weight by definition.
//   2. Discrete ω at bin grid: X_m[k] = X_m(2πk/M), k = 0..M−1.
//      Computed via iterative Cooley-Tukey radix-2 FFT (see #64 for
//      the full algorithm passage).
//   3. Hann hard-wired as the only window for v1. Rectangular /
//      Hamming / Blackman / Kaiser tracked in the debt ledger —
//      trivial ~5-line addition behind a `window` param enum.
//   4. Streaming adapter: FFT fires once per R samples (not per
//      sample as strict STFT definition implies). `m` advances by 1
//      per FFT fire; between fires, the `out` ports cycle through
//      the most recent spectrum bin-by-bin. Standard block-analysis
//      form.
//   5. Window applied to the ring buffer in temporal order on each
//      fire (copy-multiply into FFT scratch). Slightly redundant vs.
//      applying window once and sliding, but correct — the canonical
//      form for clarity over micro-optimisation.
//   6. `size` and `hop` both clamped — size pow2 in [16, 32768], hop
//      in [1, size]. Non-pow2 size snaps down; default size=1024,
//      hop=256 (M/4, canonical Hann COLA).
//   7. Defensive: missing input → zero-padded frame; missing output
//      buffers → partial no-op.
//
// MATH SUMMARY (per hop):
//   Frame extracted: frame[n] = buf[(writeIdx − size + n) mod size]
//     for n = 0..size−1.
//   Windowed:        w_frame[n] = frame[n] · hann[n]
//   FFT:             X[k] = Σ w_frame[n] · exp(−2πikn/size)
//   Emitted:         (real[k], imag[k]) = (Re X[k], Im X[k]), held
//                    until next hop fires.
//
// LATENCY: size samples (frame length). Matches #64 fft exactly —
// a frame's worth of samples must be buffered before the first FFT.

const DENORMAL = 1e-30;

function isPow2(n) { return n > 0 && (n & (n - 1)) === 0; }
function floorPow2(n) {
  let p = 1;
  while ((p << 1) <= n) p <<= 1;
  return p;
}

export class StftOp {
  static opId = 'stft';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([
    { id: 'real', kind: 'audio' },
    { id: 'imag', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'size', default: 1024 },
    { id: 'hop',  default: 256  },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._size = 1024;
    this._hop  = 256;
    this._alloc(this._size);
  }

  _alloc(N) {
    const size = Math.min(Math.max(isPow2(N) ? N : floorPow2(N), 16), 32768);
    this._size     = size;
    this._hann     = new Float64Array(size);
    for (let n = 0; n < size; n++) {
      this._hann[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (size - 1)));
    }
    this._ring      = new Float64Array(size);
    this._re        = new Float64Array(size);
    this._im        = new Float64Array(size);
    this._scratchRe = new Float64Array(size);
    this._scratchIm = new Float64Array(size);
    this._writeIdx  = 0;
    this._hopCount  = 0;
    this._filled    = 0;
    this._readIdx   = 0;
    // Clamp hop to [1, size] without requiring a user reset.
    this._hop = Math.min(Math.max(this._hop | 0, 1), size);
  }

  reset() {
    this._ring.fill(0);
    this._re.fill(0);
    this._im.fill(0);
    this._writeIdx = 0;
    this._hopCount = 0;
    this._filled   = 0;
    this._readIdx  = 0;
  }

  setParam(id, v) {
    if (id === 'size') {
      const N = +v | 0;
      if (N !== this._size) this._alloc(N);
    } else if (id === 'hop') {
      this._hop = Math.min(Math.max((+v) | 0, 1), this._size);
    }
  }

  getLatencySamples() { return this._size; }

  _fire() {
    const N  = this._size;
    const re = this._scratchRe;
    const im = this._scratchIm;
    const ring = this._ring;
    const hann = this._hann;

    // Extract frame in temporal order, apply window, bit-reverse into
    // (re, im). Most recent sample is at (writeIdx - 1) mod N; frame
    // starts at writeIdx (the oldest sample of the ring).
    const logN = Math.log2(N) | 0;
    let frameStart = this._writeIdx;  // oldest in ring
    for (let k = 0; k < N; k++) {
      let rk = 0, kk = k;
      for (let b = 0; b < logN; b++) { rk = (rk << 1) | (kk & 1); kk >>>= 1; }
      const idx = (frameStart + k) % N;
      re[rk] = ring[idx] * hann[k];
      im[rk] = 0;
    }

    // Cooley-Tukey butterflies (same as #64).
    for (let s = 1; s <= logN; s++) {
      const m     = 1 << s;
      const mHalf = m >> 1;
      const theta = -2 * Math.PI / m;
      const wmr   = Math.cos(theta);
      const wmi   = Math.sin(theta);
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

    for (let i = 0; i < N; i++) { this._re[i] = re[i]; this._im[i] = im[i]; }
    this._readIdx = 0;
  }

  process(inputs, outputs, N) {
    const inCh = inputs && inputs.in;
    const outRe = outputs.real;
    const outIm = outputs.imag;
    if (!outRe && !outIm) return;

    const size = this._size;
    const hop  = this._hop;
    const ring = this._ring;

    for (let i = 0; i < N; i++) {
      // Fire FFT at top-of-loop (same pattern as #64 fft / #65 ifft),
      // so the fresh spectrum is emitted starting on THIS sample.
      if (this._filled >= size && this._hopCount >= hop) {
        this._hopCount = 0;
        this._fire();
      }

      // Emit one bin.
      const bin = this._readIdx++;
      if (this._readIdx >= size) this._readIdx = 0;
      if (outRe) outRe[i] = this._re[bin];
      if (outIm) outIm[i] = this._im[bin];

      // Ingest sample into ring buffer at writeIdx (overwrite oldest).
      ring[this._writeIdx] = inCh ? inCh[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % size;
      if (this._filled < size) this._filled++;
      this._hopCount++;
    }

    if (this._re[0] < DENORMAL && this._re[0] > -DENORMAL) this._re[0] = 0;
    if (this._im[0] < DENORMAL && this._im[0] > -DENORMAL) this._im[0] = 0;
  }
}
