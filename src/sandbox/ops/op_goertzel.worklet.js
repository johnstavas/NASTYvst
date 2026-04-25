// op_goertzel.worklet.js — Stage-3 op sidecar for the `goertzel` op.
//
// Catalog #70 (Analysis). Goertzel single-tone magnitude detector.
// Canon:analysis §1 (musicdsp #107, Riskedal 2004).
//
// ALGORITHM
//
//   coeff = 2·cos(2π · freq / sr)
//   per sample: Skn2 = Skn1; Skn1 = Skn;
//               Skn  = x + coeff · Skn1 − Skn2
//   after N samples:
//     |X(k)|² = Skn² + Skn1² − coeff · Skn · Skn1
//     mag    = sqrt(max(0, |X|²)) · (2 / N)   // peak-normalised
//
// We use the CORRECT squared-magnitude form above, not the buggy
// real-only `Skn − WNk·Skn1` variant flagged in canon §1 LIMITS.
//
// USE
//
//   DTMF decoder — one goertzel per target freq, parallel.
//   Tuner / pitch-lock — compute mag at candidate freqs.
//   Sine-presence probe — classical feedback-howl detector stub.
//   Watermark detection — narrow-band tone beacons.
//
// Much cheaper than FFT when you only care about a handful of bins.
// O(N·numFreqs) total; FFT is O(N log N) but gives you all bins.
//
// LATENCY
//
// Output updates once per `blockN` samples, held between. Reported
// latency = blockN (worst-case delay from input energy change to mag
// update). This matches how block-based analysis ops are treated in
// the PCOF latency graph.
//
// STATE
//
// Accumulators reset at each block boundary. No running-window
// sliding — simple non-overlapping block analysis. For smoother
// tracking, compose downstream with `smooth` or `slew`.

export class GoertzelOp {
  static opId = 'goertzel';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'mag', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'freq',   default: 1000 },
    { id: 'blockN', default: 512  },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._freq      = 1000;
    this._blockN    = 512;
    this._coeff     = 0;
    this._invN2     = 0;     // 2/N for peak normalization
    this._skn       = 0;
    this._skn1      = 0;
    this._skn2      = 0;
    this._cnt       = 0;
    this._lastMag   = 0;
    this._recompute();
  }

  reset() {
    this._skn     = 0;
    this._skn1    = 0;
    this._skn2    = 0;
    this._cnt     = 0;
    this._lastMag = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'freq') {
      const hi = this.sr * 0.5;
      this._freq = n < 1 ? 1 : (n > hi ? hi : n);
      this._recompute();
    } else if (id === 'blockN') {
      const c = Math.round(n);
      this._blockN = c < 16 ? 16 : (c > 8192 ? 8192 : c);
      // Reset accumulators on window-size change — stale Skn from
      // partial window would otherwise bias the next magnitude.
      this._skn = this._skn1 = this._skn2 = 0;
      this._cnt = 0;
      this._recompute();
    }
  }

  getLatencySamples() { return this._blockN; }

  _recompute() {
    this._coeff = 2 * Math.cos(2 * Math.PI * this._freq / this.sr);
    this._invN2 = 2 / this._blockN;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.mag;
    if (!outCh) return;

    const coeff   = this._coeff;
    const blockN  = this._blockN;
    const invN2   = this._invN2;
    let skn       = this._skn;
    let skn1      = this._skn1;
    let skn2      = this._skn2;
    let cnt       = this._cnt;
    let lastMag   = this._lastMag;

    if (!inCh) {
      // No input — feed zeros. Accumulators stay pinned to 0, mag → 0.
      for (let i = 0; i < N; i++) {
        skn2 = skn1;
        skn1 = skn;
        skn  = coeff * skn1 - skn2;  // x = 0
        cnt++;
        if (cnt >= blockN) {
          const mag2 = skn * skn + skn1 * skn1 - coeff * skn * skn1;
          lastMag = mag2 > 0 ? Math.sqrt(mag2) * invN2 : 0;
          skn = skn1 = skn2 = 0;
          cnt = 0;
        }
        outCh[i] = lastMag;
      }
    } else {
      for (let i = 0; i < N; i++) {
        const x = inCh[i];
        skn2 = skn1;
        skn1 = skn;
        skn  = x + coeff * skn1 - skn2;
        cnt++;
        if (cnt >= blockN) {
          const mag2 = skn * skn + skn1 * skn1 - coeff * skn * skn1;
          lastMag = mag2 > 0 ? Math.sqrt(mag2) * invN2 : 0;
          skn = skn1 = skn2 = 0;
          cnt = 0;
        }
        outCh[i] = lastMag;
      }
    }

    this._skn     = skn;
    this._skn1    = skn1;
    this._skn2    = skn2;
    this._cnt     = cnt;
    this._lastMag = lastMag;
  }
}
