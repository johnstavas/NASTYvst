// op_lpc.worklet.js — Stage-3 op sidecar for the `lpc` op.
//
// Catalog #71 (Analysis). Linear-predictive coding front-end.
// Canon:analysis §2 (musicdsp #137, mailing-list 2004).
//
// ALGORITHM
//
//   1. Accumulate blockN samples into a ring buffer.
//   2. At each block boundary:
//        R[k] = Σ_n  x[n]·x[n−k]        for k = 0..P     (autocorrelation)
//        Levinson–Durbin → a[1..P]      (AR prediction coefs)
//      with reflection-coef stability clamp  |k_i| ≤ 0.999.
//   3. Per-sample apply prediction-error filter:
//        e[n] = x[n] + Σ_{i=1..P}  a[i] · x[n−i]
//      Output `residual` = e[n].
//
// SOURCE-FILTER SEPARATION
//
// Speech / singing / formant-rich signals are near-all-pole. LPC fits an
// all-pole envelope to the short-term spectrum; inverse-filtering by A(z)
// "whitens" the output. What's left in the residual is the EXCITATION —
// the glottal pulses for voiced sounds, the turbulence for unvoiced. The
// formant filter itself is the A(z) coefficients we computed.
//
// USE
//
//   • Vocoder / talkbox front-end — residual becomes the carrier-modulated source
//   • Formant extraction — coefficients drive a filter elsewhere
//   • Cross-synthesis — "make drums talk" by imposing vocal A(z) onto percussion
//   • Whisperizer — the residual alone is an airy, voiceless version of input
//   • Tube-amp model extraction — fit A(z) to a real tube recording, replay as filter
//
// Much of the creative use is the RESIDUAL as a sonic object. It sounds
// like the input with the "throat" removed — very distinctive.
//
// LATENCY
//
// Coefficients update once per blockN samples. First blockN samples of
// output are zero (no coefs yet). Steady-state latency from spectral
// change to coefficient update = blockN. Reported latency = blockN.
//
// V1 SCOPE
//
// Unwarped autocorrelation only (lambda = 0 implicit). Canon:analysis §2
// ships with Bark-warp support via allpass-chain autocorrelation — an
// upgrade path once we need better low-frequency resolution for speech.
// Mixing warped analysis with unwarped synthesis produces coefficient
// mismatch, so we stay fully unwarped in v1.
//
// STABILITY
//
// Reflection coefs |k_i| ≥ 1 mean the all-pole model is unstable.
// We clamp |k_i| ≤ 0.999 during Levinson-Durbin. The residual FIR is
// always stable (it's an FIR), but if a[i] grow large due to numerical
// issues on silent blocks, the residual can explode — we also zero the
// coefs if R[0] is below a tiny epsilon (silence-gate).

const MAX_ORDER = 32;

export class LpcOp {
  static opId = 'lpc';
  static inputs  = Object.freeze([{ id: 'in',       kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'residual', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'order',  default: 12   },
    { id: 'blockN', default: 1024 },
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._order   = 12;
    this._blockN  = 1024;
    // Ring buffer of the last _blockN samples (analysis window) AND history
    // for the prediction FIR. Size = max blockN cap for reallocation safety.
    this._buf     = new Float32Array(8192);
    this._bufLen  = 8192;
    this._wPos    = 0;   // next write index into _buf (mod _blockN)
    this._filled  = 0;   // how many of the current block slots are filled
    this._coefs   = new Float64Array(MAX_ORDER + 1); // a[0..P], a[0]=1 unused
    this._hasCoefs = false;
    // Scratch for Levinson-Durbin.
    this._R       = new Float64Array(MAX_ORDER + 1);
    this._tmp     = new Float64Array(MAX_ORDER + 1);
  }

  reset() {
    this._buf.fill(0);
    this._wPos     = 0;
    this._filled   = 0;
    this._coefs.fill(0);
    this._hasCoefs = false;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'order') {
      const c = Math.round(n);
      const o = c < 1 ? 1 : (c > MAX_ORDER ? MAX_ORDER : c);
      if (o !== this._order) {
        this._order    = o;
        this._coefs.fill(0);
        this._hasCoefs = false;
      }
    } else if (id === 'blockN') {
      const c = Math.round(n);
      const b = c < 64 ? 64 : (c > 8192 ? 8192 : c);
      if (b !== this._blockN) {
        this._blockN   = b;
        this._wPos     = 0;
        this._filled   = 0;
        this._coefs.fill(0);
        this._hasCoefs = false;
      }
    }
  }

  getLatencySamples() { return this._blockN; }

  // ────────────────────────────────────────────────────────────────────────
  // Core: compute AR coefs from the current window.
  //
  // R[k] = Σ_{n=k..N-1}  w[n] · w[n−k]     where w[] is the analysis window
  //        at contiguous, time-ordered positions.
  //
  // Levinson-Durbin:
  //   E = R[0]
  //   a[0] = 1
  //   for i = 1..P:
  //     k = -(R[i] + Σ_{j=1..i-1} a[j]·R[i-j]) / E
  //     clamp |k| ≤ 0.999
  //     a'[i] = k
  //     for j = 1..i-1:  a'[j] = a[j] + k · a[i-j]
  //     copy a' → a
  //     E = E · (1 − k²)
  //     if E ≤ 0: break (model degenerate)
  //
  _computeCoefs() {
    const P  = this._order;
    const N  = this._blockN;
    const R  = this._R;
    const a  = this._coefs;
    const t  = this._tmp;

    // Rebuild the window in-order from the ring. _wPos points at the
    // oldest sample (because we just wrote there and wrapped), or equivalently
    // at the next write slot — both interpretations agree when the buffer
    // is full. We walk it in time order.
    // Pull indices relative to the ring.
    const buf = this._buf;

    // Autocorrelation (O(N·P))
    for (let k = 0; k <= P; k++) R[k] = 0;
    for (let k = 0; k <= P; k++) {
      let sum = 0;
      for (let n = k; n < N; n++) {
        const i1 = (this._wPos + n)     % N;
        const i2 = (this._wPos + n - k) % N;
        sum += buf[i1] * buf[i2];
      }
      R[k] = sum;
    }

    // Silence-gate: if R[0] is tiny, zero out coefs and bail.
    if (R[0] < 1e-12) {
      for (let i = 0; i <= P; i++) a[i] = 0;
      this._hasCoefs = false;
      return;
    }

    // Levinson-Durbin
    a.fill(0, 0, P + 1);
    a[0] = 1;
    let E = R[0];
    for (let i = 1; i <= P; i++) {
      let num = R[i];
      for (let j = 1; j < i; j++) num += a[j] * R[i - j];
      let k = -num / E;
      if (k >  0.999) k =  0.999;
      if (k < -0.999) k = -0.999;
      // a' = a + k · reverse(a)
      for (let j = 0; j <= i; j++) t[j] = a[j];
      t[i] = k;
      for (let j = 1; j < i; j++) t[j] = a[j] + k * a[i - j];
      for (let j = 0; j <= i; j++) a[j] = t[j];
      E *= (1 - k * k);
      if (E <= 0) {
        // Degenerate — zero out remaining, mark unusable.
        for (let z = 0; z <= P; z++) a[z] = 0;
        this._hasCoefs = false;
        return;
      }
    }
    this._hasCoefs = true;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.residual;
    if (!outCh) return;

    const P      = this._order;
    const bN     = this._blockN;
    const buf    = this._buf;
    const coefs  = this._coefs;

    for (let i = 0; i < N; i++) {
      const x = inCh ? inCh[i] : 0;

      // Write to ring.
      buf[this._wPos] = x;

      // Compute residual using current coefs + history.
      // e[n] = x[n] + Σ a[k]·x[n−k] for k=1..P
      let e = x;
      if (this._hasCoefs) {
        // history sample k steps back lives at (_wPos − k) mod bN
        for (let k = 1; k <= P; k++) {
          let idx = this._wPos - k;
          if (idx < 0) idx += bN;
          e += coefs[k] * buf[idx];
        }
      } else {
        e = 0;  // first block: silence out until coefs exist
      }
      outCh[i] = e;

      // Advance ring.
      this._wPos = (this._wPos + 1) % bN;
      this._filled++;
      if (this._filled >= bN) {
        this._filled = 0;
        this._computeCoefs();
      }
    }
  }
}
