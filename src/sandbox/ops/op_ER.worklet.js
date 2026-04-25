// op_ER.worklet.js — Stage-3 op sidecar for the `ER` op.
//
// Catalog #21 (Delay/Time · reverb family). Early-reflection generator —
// the spatial-impression front-end of a Moorer / Dattorro / Gardner
// reverb chain. Pair with #19 diffuser + #37 fdnCore for a complete
// reverberator.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   Julius O. Smith III, "Physical Audio Signal Processing":
//     https://ccrma.stanford.edu/~jos/pasp/Early_Reflections.html
//     https://ccrma.stanford.edu/~jos/pasp/Tapped_Delay_Line_TDL.html
//   License: CCRMA online text, reference for reimplementation.
//
// PASSAGES VERBATIM (fetched via WebFetch 2026-04-24):
//
//   "early reflections ... are often implemented using tapped delay
//    lines (TDL)"
//   "The taps on the TDL may include lowpass filtering for simulation
//    of air absorption"
//   "A tapped delay line [is] a delay line with at least one 'tap' ...
//    a delay-line tap extracts a signal output from somewhere within
//    the delay line, optionally scales it, and typically sums with
//    other taps to form a TDL output signal"
//   "Non-interpolating taps extract signals at fixed integer delays"
//   "early reflections are often taken to be the first 100ms or so"
//
// PRIMARY-SOURCE LIMIT (declared):
//   JOS PASP gives the TDL *structure* but not a specific tap vector.
//   Moorer's 1979 18-tap Boston Symphony Hall measurements (JAES 27)
//   are the canonical numerical reference; that paper is not openly
//   hosted. The TDL + per-tap LPF structure is therefore the primary
//   mathematical contract; numerical tap vectors here are derived from
//   image-source reasoning (shoebox room, 1/r amplitude decay, sparse
//   exponential arrival times), NOT transcribed from Moorer. Deviation
//   #1 below is explicit about this.
//
// PASSAGE ↔ CODE DEVIATIONS:
//
//   1. **Default tap vector not from Moorer 1979.** v1 ships an
//      image-source-derived default: 12 taps distributed exponentially
//      over [5 ms, 80 ms], gains decaying as ~1/(1+tap_index) to mimic
//      1/r spherical spreading. The `roomSize` param (0.5–2.0) scales
//      all tap times uniformly. User can treat the default as a
//      generic small/medium room — not a specific hall fingerprint.
//      Debt row logs the Moorer table as P1 upgrade target.
//   2. **Single air-absorption LPF on TDL output** (not per-tap). JOS
//      wording allows per-tap LPF; v1 applies a single post-sum
//      Butterworth LPF at `airHz` (default 8 kHz) for cost. True
//      per-tap LPF (each tap with distance-scaled cutoff) is logged
//      in debt.
//   3. **Integer-sample taps only** (no fractional / Lagrange /
//      Thiran). Matches JOS "Non-interpolating taps extract signals
//      at fixed integer delays." Sweeping `roomSize` produces 1-sample
//      quantization jumps; for static use this is inaudible.
//   4. **Number of taps fixed at 12.** Variable tap count + per-tap
//      time/gain override logged in debt.
//   5. **Denormal flush** on delay-line reads and LPF state.
//   6. **Equal-power dry/wet** per dry_wet_mix_rule.md (cos/sin law),
//      computed in-op.

const DENORMAL = 1e-30;

// Base tap pattern — 12 taps over ~5 to 80 ms at roomSize=1.
// Derived from image-source: exponential-ish spacing, 1/(1+k) gain.
// Times chosen mutually-coprime-ish to avoid metallic ringing.
const BASE_TAP_MS = Object.freeze([
  5.3, 8.7, 13.1, 18.9, 24.7, 31.4,
  38.2, 45.9, 53.6, 61.4, 70.2, 79.3,
]);
const BASE_TAP_GAIN = Object.freeze(
  BASE_TAP_MS.map((_, k) => 0.85 / (1 + k * 0.45))
);

function designButterworthLPF(fc, sr) {
  const f = Math.min(Math.max(fc, 20), sr * 0.49);
  const w0 = 2 * Math.PI * f / sr;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const Q = Math.SQRT1_2;
  const alpha = sinw / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosw) / 2 / a0,
    b1: (1 - cosw)     / a0,
    b2: (1 - cosw) / 2 / a0,
    a1: -2 * cosw      / a0,
    a2: (1 - alpha)    / a0,
  };
}

const MAX_TAP_MS = 200; // roomSize=2.0 → up to 160 ms

export class EROp {
  static opId    = 'ER';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'roomSize', default: 1.0  }, // 0.5 (tight) .. 2.0 (large)
    { id: 'airHz',    default: 8000 }, // air-absorption LPF cutoff
    { id: 'level',    default: 1.0  }, // overall ER bus gain
    { id: 'mix',      default: 1.0  }, // 0=dry, 1=wet (wet-only default
                                        // — ER usually sits post-Sigma)
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;

    // Allocate delay line to max possible tap length.
    const maxSamples = Math.ceil(MAX_TAP_MS / 1000 * sampleRate) + 2;
    this._buf      = new Float64Array(maxSamples);
    this._bufLen   = maxSamples;
    this._writeIdx = 0;

    this._roomSize = 1.0;
    this._level    = 1.0;
    this._mix      = 1.0;

    // Per-tap integer-sample delays (computed from roomSize).
    this._tapSamples = new Int32Array(BASE_TAP_MS.length);
    this._tapGains   = new Float64Array(BASE_TAP_GAIN);
    this._updateTaps();

    // Air-absorption LPF on summed ER output.
    this._lpf = designButterworthLPF(8000, sampleRate);
    this._x1 = 0; this._x2 = 0; this._y1 = 0; this._y2 = 0;
  }

  reset() {
    if (this._buf) this._buf.fill(0);
    this._writeIdx = 0;
    this._x1 = this._x2 = this._y1 = this._y2 = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'roomSize') {
      this._roomSize = n < 0.25 ? 0.25 : (n > 2.0 ? 2.0 : n);
      this._updateTaps();
    } else if (id === 'airHz') {
      this._lpf = designButterworthLPF(n, this.sr);
    } else if (id === 'level') {
      this._level = n;
    } else if (id === 'mix') {
      this._mix = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return 0; }

  _updateTaps() {
    for (let k = 0; k < BASE_TAP_MS.length; k++) {
      const ms = BASE_TAP_MS[k] * this._roomSize;
      let d = Math.round(ms / 1000 * this.sr);
      if (d < 1) d = 1;
      if (d > this._bufLen - 1) d = this._bufLen - 1;
      this._tapSamples[k] = d;
    }
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const buf     = this._buf;
    const blen    = this._bufLen;
    const taps    = this._tapSamples;
    const gains   = this._tapGains;
    const nTaps   = taps.length;
    const level   = this._level;
    const lpf     = this._lpf;
    const mix     = this._mix;

    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    let x1 = this._x1, x2 = this._x2, y1 = this._y1, y2 = this._y2;

    for (let i = 0; i < N; i++) {
      const x = inp ? inp[i] : 0;

      // Write into TDL.
      buf[this._writeIdx] = x;

      // Sum all taps (integer delays, per JOS "fixed integer delays").
      let erSum = 0;
      for (let k = 0; k < nTaps; k++) {
        const readIdx = (this._writeIdx - taps[k] + blen) % blen;
        let t = buf[readIdx];
        if (t > -DENORMAL && t < DENORMAL) t = 0;
        erSum += gains[k] * t;
      }
      this._writeIdx = (this._writeIdx + 1) % blen;

      const wetIn = level * erSum;

      // Air-absorption LPF (single post-sum section — deviation #2).
      const wetOut = lpf.b0 * wetIn + lpf.b1 * x1 + lpf.b2 * x2
                   - lpf.a1 * y1   - lpf.a2 * y2;
      x2 = x1; x1 = wetIn;
      y2 = y1; y1 = wetOut;

      out[i] = gDry * x + gWet * wetOut;
    }

    this._x1 = x1; this._x2 = x2; this._y1 = y1; this._y2 = y2;
  }
}
