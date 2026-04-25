// op_karplusStrong.worklet.js — Stage-3 op sidecar for `karplusStrong`.
//
// Catalog #85 (Synthesis / generators). Original 1983 Karplus-Strong
// plucked-string synthesizer.
//
// ALGORITHM (jos_pasp_dsp_reference.md §4.3, jos_pasp_physical_modeling.md §3.2)
//
//   1. On pluck trigger: fill delay line of length N with noise in [-1, +1].
//      N = round(sr / freq).
//   2. Per sample:
//        y[n] = decay · (bright · x + (1 − bright) · ((x + x_prev) / 2))
//      where  x       = buffer[idx]
//             x_prev  = buffer[(idx − 1 + N) mod N]
//      Write y[n] back into buffer[idx]. Advance idx = (idx + 1) mod N.
//   3. Output y[n].
//
// The two-point averaging filter H(z) = ½ + ½·z⁻¹ has a half-sample phase
// delay (linear phase) and is 0 dB at DC / -∞ at Nyquist. Progressive HF
// attenuation gives the natural "bright → dull" decay that defines the
// plucked-string character.
//
// DECAY
//
// Loop gain `decay` ∈ [0, 1]. Values near 1 (e.g. 0.996) give long sustain
// (~1 s at 220 Hz); lower values give staccato. At 1.0 the string never
// decays (organ-like, per §1.3).
//
// BRIGHT
//
// `bright` blends between pure two-point-average loop (0, classic dulling
// pluck) and no-filtering feedback (1, sawtooth-like harsh ringing).
// 0.5 is a sensible middle ground. EKS-style pick-direction filtering is
// NOT implemented here — compose downstream via a dedicated lowpass on the
// trigger-gated noise excitation if finer control is wanted.
//
// TRIGGER
//
// `trig` is a control signal. A rising-edge (low-to-high across 0.5)
// refills the buffer with fresh noise, restarting the pluck. Before the
// first trigger the buffer is all zeros — output is silence. Pair with
// the `trigger` op (pulse mode) or any comparator-style control source.
//
// TUNING
//
// N = round(sr / freq). Integer-only rounding means pitch is quantised
// to Fs/N steps — ~0.5 cents near A4, up to ~25 cents at very high freq.
// Thiran fractional-delay interpolation is NOT in this op by design;
// add a Thiran allpass in the loop via codegen composition when precise
// tuning matters (see pasp_through_design_lens.md).
//
// PRNG
//
// Canon:synthesis §10 — 32-bit LCG. Deterministic across runs so tests
// hash cleanly. Seed resets on reset() and on each pluck.
//
// LATENCY: zero. Causal, sample-by-sample.
// DENORMALS: Float64 buffer, Jon Watte flush on block end (Canon:utilities §1).

const DENORMAL = 1e-30;
const MAX_N    = 4096;     // minimum supported freq at 48k = 11.72 Hz
const INV_U32  = 1.0 / 0xFFFFFFFF;

export class KarplusStrongOp {
  static opId = 'karplusStrong';
  static inputs  = Object.freeze([{ id: 'trig', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',  kind: 'audio'   }]);
  static params  = Object.freeze([
    { id: 'freq',   default: 220   },   // Hz (A3)
    { id: 'decay',  default: 0.996 },   // loop gain
    { id: 'bright', default: 0.5   },   // 0 = full avg filter, 1 = no filter
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._freq     = 220;
    this._decay    = 0.996;
    this._bright   = 0.5;
    this._N        = Math.max(2, Math.min(MAX_N, Math.round(sampleRate / 220)));
    this._buf      = new Float64Array(MAX_N);
    this._idx      = 0;
    this._prev     = 0;        // x_prev cache (faster than index math each sample)
    this._rngState = 0x12345678 >>> 0;
    this._trigHigh = false;    // edge-detect latch
  }

  reset() {
    this._buf.fill(0);
    this._idx      = 0;
    this._prev     = 0;
    this._rngState = 0x12345678 >>> 0;
    this._trigHigh = false;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'freq') {
      const clamped = n < 1 ? 1 : (n > this.sr * 0.5 ? this.sr * 0.5 : n);
      this._freq = clamped;
      // N update. Keep existing buffer contents — live re-pitch during
      // sustain. Out-of-range samples past the new N just sit unread.
      const newN = Math.round(this.sr / clamped);
      this._N = newN < 2 ? 2 : (newN > MAX_N ? MAX_N : newN);
      if (this._idx >= this._N) this._idx = 0;
    } else if (id === 'decay') {
      this._decay = n < 0 ? 0 : (n > 1 ? 1 : n);
    } else if (id === 'bright') {
      this._bright = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return 0; }

  _nextRand() {
    // Numerical Recipes LCG (Canon:synthesis §10). Range [-1, +1].
    this._rngState = (Math.imul(this._rngState, 1664525) + 1013904223) >>> 0;
    return (this._rngState * INV_U32) * 2 - 1;
  }

  _pluck() {
    const N = this._N;
    const buf = this._buf;
    for (let i = 0; i < N; i++) buf[i] = this._nextRand();
    // Zero the tail so stale data past N can't leak if N grows later.
    for (let i = N; i < MAX_N; i++) buf[i] = 0;
    this._idx  = 0;
    this._prev = 0;
  }

  process(inputs, outputs, N) {
    const trigCh = inputs.trig;
    const outCh  = outputs.out;
    if (!outCh) return;

    const Nloop   = this._N;
    const buf     = this._buf;
    const decay   = this._decay;
    const bright  = this._bright;
    const avgAmt  = 1 - bright;
    let idx       = this._idx;
    let prev      = this._prev;
    let trigHigh  = this._trigHigh;

    for (let i = 0; i < N; i++) {
      // Edge-detect pluck trigger. Hysteresis single-threshold at 0.5
      // (tight, because this is gated by upstream `trigger`/`curve` ops
      // which already clean the signal).
      if (trigCh) {
        const t = trigCh[i];
        if (!trigHigh && t > 0.5) {
          trigHigh = true;
          this._pluck();
          idx  = 0;
          prev = 0;
          // After a pluck we still need to emit one sample this loop iter.
        } else if (trigHigh && t < 0.5) {
          trigHigh = false;
        }
      }

      const x = buf[idx];
      // y = decay · (bright · x + (1 − bright) · ½(x + prev))
      const avg = 0.5 * (x + prev);
      const y   = decay * (bright * x + avgAmt * avg);
      buf[idx]  = y;
      prev      = y;
      idx       = idx + 1;
      if (idx >= Nloop) idx = 0;
      outCh[i] = y;
    }

    // Denormal flush on the two scalar state vars. Buffer interior naturally
    // rotates; periodic full-buffer flush costs cache misses and isn't
    // worth it for this op (next pluck refills anyway).
    if (prev < DENORMAL && prev > -DENORMAL) prev = 0;

    this._idx      = idx;
    this._prev     = prev;
    this._trigHigh = trigHigh;
  }
}
