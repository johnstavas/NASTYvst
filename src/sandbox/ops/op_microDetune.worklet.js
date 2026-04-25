// op_microDetune.worklet.js — Catalog #106 (Space / Pitch family).
//
// Two-tap crossfading delay-line pitch shifter. Light, single-voice,
// fixed-cents shift suitable for chorus-style detune (±50 cents class)
// without the cost of an STFT. Distinct from #28 pitchShift (Bernsee
// phase-vocoder) — that one is for big shifts; this one is for spice.
//
// PRIMARY (opened 2026-04-24 via WebFetch):
//   https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/misceffects.lib
//   `transpose(w, x, s, sig)` — Faust stdlib, MIT.
//
// VERBATIM PASSAGE:
//   transpose(w, x, s, sig) = de.fdelay(maxDelay,d,sig)*ma.fmin(d/x,1) +
//       de.fdelay(maxDelay,d+w,sig)*(1-ma.fmin(d/x,1))
//   with {
//       maxDelay = 65536;
//       i = 1 - pow(2, s/12);
//       d = i : (+ : +(w) : fmod(_,w)) ~ _;
//   };
//
// PASSAGE ↔ CODE DEVIATIONS:
//   1. Param surface = cents not semitones.   `i = 1 - 2^(c/1200)`.
//   2. Window/xfade exposed as ms, converted to samples at param-time.
//   3. Wrap of `d` uses positive-modulo math (handles negative `i`).
//      Faust's fmod is C-style fmod; we use `d - W·floor(d/W)` so
//      negative cents (downward shift, i>0 → d grows positive, fine;
//      upward shift, i<0 → d grows negative, must wrap into [0, W)).
//   4. Linear-interp fractional read inline (DAFX §3.5 math-by-def);
//      Faust's `de.fdelay` is also linear-interp by default.
//
// MATH-BY-DEF PRIMITIVES (no primary needed):
//   · Linear-interp fractional read: y = (1−α)·b[i] + α·b[i+1]
//   · Cents-to-rate: r = 2^(c/1200)
//
// PARAMS
//   cents     pitch shift             [-1200, 1200]  default 0
//   windowMs  delay-line window       [10, 200]      default 50
//   xfadeMs   crossfade ramp length   [1, 50]        default 10
//   level     output gain             [0, 1]         default 1
//
// I/O
//   inputs:  in  (audio)
//   outputs: out (audio)
//
// LATENCY: 0 algorithmic — output is read from the past via the ring
//          buffer; there is no host-graph compensation needed.

const MAX_WINDOW_MS = 200;

export class MicroDetuneOp {
  static opId = 'microDetune';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cents',    default: 0  },
    { id: 'windowMs', default: 50 },
    { id: 'xfadeMs',  default: 10 },
    { id: 'level',    default: 1  },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._N = Math.max(1, Math.ceil(MAX_WINDOW_MS * 0.001 * sampleRate));
    this._buf = new Float32Array(this._N);
    this._w = 0;            // write head
    this._d = 0;            // phase counter, wrapped into [0, W) where W=windowSamples

    // params (clamped + converted)
    this._cents     = 0;
    this._rate      = 1;     // 2^(c/1200)
    this._step      = 0;     // i = 1 - rate, advance for d each sample
    this._winSamps  = Math.max(2, Math.round(0.050 * sampleRate));
    this._xfadeSamps = Math.max(1, Math.round(0.010 * sampleRate));
    this._level     = 1;
  }

  reset() {
    this._buf.fill(0);
    this._w = 0;
    this._d = 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'cents': {
        this._cents = Math.max(-1200, Math.min(1200, v));
        this._rate  = Math.pow(2, this._cents / 1200);
        this._step  = 1 - this._rate;     // i = 1 - 2^(c/1200)
        break;
      }
      case 'windowMs': {
        const ms = Math.max(10, Math.min(MAX_WINDOW_MS, v));
        this._winSamps = Math.max(2, Math.round(ms * 0.001 * this.sr));
        // keep d in range
        const W = this._winSamps;
        this._d = this._d - W * Math.floor(this._d / W);
        break;
      }
      case 'xfadeMs': {
        const ms = Math.max(1, Math.min(50, v));
        this._xfadeSamps = Math.max(1, Math.round(ms * 0.001 * this.sr));
        break;
      }
      case 'level': {
        this._level = Math.max(0, Math.min(1, v));
        break;
      }
    }
  }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const inBuf = inputs && inputs.in ? inputs.in : null;
    const buf   = this._buf;
    const M     = this._N;             // ring-buffer capacity
    const W     = this._winSamps;      // window in samples (<= M)
    const X     = this._xfadeSamps;
    const lvl   = this._level;
    const step  = this._step;
    let   w     = this._w;
    let   d     = this._d;

    for (let n = 0; n < N; n++) {
      // 1) capture
      buf[w] = inBuf ? inBuf[n] : 0;
      w++; if (w >= M) w = 0;

      // 2) advance phase d, wrap into [0, W)
      d = d + step;
      d = d - W * Math.floor(d / W);

      // 3) two read taps at delays d and d+W (mod M); linear interp
      const read = (off) => {
        let p = w - off;
        p = p - M * Math.floor(p / M);    // [0, M)
        const i0 = p | 0;
        const i1 = (i0 + 1) % M;
        const a  = p - i0;
        return (1 - a) * buf[i0] + a * buf[i1];
      };
      const tap1 = read(d);
      const tap2 = read(d + W);

      // 4) crossfade weight = min(d/X, 1)
      const wgt = d < X ? d / X : 1;
      out[n] = (wgt * tap1 + (1 - wgt) * tap2) * lvl;
    }

    this._w = w;
    this._d = d;
  }

  getLatencySamples() { return 0; }
}
