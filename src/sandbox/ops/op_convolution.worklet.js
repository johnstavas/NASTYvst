// op_convolution.worklet.js — Stage-3 op sidecar for the `convolution` op.
//
// Catalog #68 (Analysis/Spectral family). Direct-form linear FIR
// convolution. IR is captured from the `ir` input stream over the
// first `length` samples; thereafter the IR is frozen and `in` is
// convolved against it per sample.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   JOS, Mathematics of the Discrete Fourier Transform (MDFT),
//   "Convolution":
//     URL: https://ccrma.stanford.edu/~jos/mdft/Convolution.html
//
//   Circular form verbatim:
//     (x ⊛ y)_n  ≝  Σ_{m=0}^{N-1} x(m)·y(n-m)
//
//   Linear FIR convolution (specialization, no circular wrap):
//     y[n] = Σ_{k=0}^{M-1} h[k]·x[n-k]
//
// PASSAGE vs CODE DEVIATIONS:
//   1. Linear (not circular) convolution — we don't wrap the input
//      signal. We use a length-M history ring and compute a direct
//      inner product per sample. Wrap-around in the ring is an
//      implementation detail (not circular conv semantically: we
//      walk k=0..M-1 backwards from the write cursor).
//   2. IR is captured, not provided as a literal parameter. The
//      first M samples of the `ir` input stream ARE the impulse
//      response; after capture it is frozen. This gives the op a
//      clean "load IR once, then convolve" contract without needing
//      array params. During capture the output emits zero.
//   3. `length` param is clamped [1, 4096]. Above 4096 direct-form
//      cost per sample (M mul-adds) starts to hurt in a worklet —
//      FFT-based overlap-add (Wikipedia / JOS SASP §Overlap_Add) is
//      the standard upgrade path, tracked as P2 debt.
//   4. Denormal flush on ring + accumulator (Canon:utilities §1).
//   5. Defensive null I/O (standard op contract).
//
// COST: O(M) mul-adds per sample. At M=128 that's trivial; at M=4096
// it's ~200 MOP/s at 48 kHz — still fine for a single instance but
// not for dozens. FFT OLA would be O(log N) per sample at the cost
// of block latency — deferred.

const DENORMAL = 1e-30;

export class ConvolutionOp {
  static opId = 'convolution';
  static inputs  = Object.freeze([
    { id: 'in', kind: 'audio' },
    { id: 'ir', kind: 'audio' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'length', default: 128 },
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._length  = 0;
    this._ir      = null;     // captured IR coefficients
    this._ring    = null;     // ring of last M input samples
    this._writeIdx = 0;
    this._captured = 0;       // samples of IR captured so far
    this._alloc(128);
  }

  reset() {
    if (this._ir)   this._ir.fill(0);
    if (this._ring) this._ring.fill(0);
    this._writeIdx = 0;
    this._captured = 0;
  }

  setParam(id, v) {
    if (id === 'length') {
      const n = Math.min(Math.max((+v) | 0, 1), 4096);
      if (n !== this._length) this._alloc(n);
    }
  }

  getLatencySamples() { return this._length; }

  _alloc(n) {
    this._length   = n;
    this._ir       = new Float64Array(n);
    this._ring     = new Float64Array(n);
    this._writeIdx = 0;
    this._captured = 0;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const irCh  = inputs.ir;
    const outCh = outputs.out;
    if (!outCh) return;

    const M   = this._length;
    const ir  = this._ir;
    const ring = this._ring;

    for (let i = 0; i < N; i++) {
      // Capture phase — load IR from `ir` input over first M samples.
      if (this._captured < M) {
        ir[this._captured] = irCh ? irCh[i] : 0;
        this._captured++;
        // During capture, still collect `in` into ring so we don't
        // lose input alignment, but emit zero.
        ring[this._writeIdx] = inCh ? inCh[i] : 0;
        this._writeIdx = (this._writeIdx + 1) % M;
        outCh[i] = 0;
        continue;
      }

      // Write current input into ring.
      ring[this._writeIdx] = inCh ? inCh[i] : 0;
      this._writeIdx = (this._writeIdx + 1) % M;

      // Direct-form inner product: y[n] = Σ h[k]·x[n-k].
      // ring[writeIdx-1] is x[n], ring[writeIdx-2] is x[n-1], etc.
      let acc = 0;
      let r = this._writeIdx - 1;
      if (r < 0) r += M;
      for (let k = 0; k < M; k++) {
        acc += ir[k] * ring[r];
        r--;
        if (r < 0) r = M - 1;
      }
      if (acc < DENORMAL && acc > -DENORMAL) acc = 0;
      outCh[i] = acc;
    }
  }
}
