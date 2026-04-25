// op_chaos.worklet.js — Catalog #60 (Movement / Modulation family).
//
// Logistic-map chaos generator: y[n+1] = r·y[n]·(1 - y[n]).
// Optionally held between iterations at sub-audio rate (SC's `Logistic.kr`).
//
// PRIMARIES (algorithm, open — GPLv3 code NOT copied):
//   SuperCollider · server/plugins/NoiseUGens.cpp
//     Logistic_next_1 (audio-rate)         lines 395-404
//     Logistic_next_k (held at freq Hz)    lines 406-428
//   May, R. M. (1976) "Simple mathematical models with very complicated
//     dynamics", Nature 261, 459-467 — original chaos paper for the map.
//
// VERBATIM PASSAGES (SC, for diff only):
//   audio-rate:        ZXP(out) = y1 = paramf * y1 * (1.0 - y1);
//   sub-audio-rate:    counter = (int32)(sampleRate / sc_max(freq, .001f));
//                      y1 = paramf * y1 * (1.0 - y1);
//                      LOOP(nsmps, ZXP(out) = y1;);
//
// Math-by-def primitive (one of the two textbook 1-D chaotic maps,
// Feigenbaum bifurcation cascade, period-doubling route to chaos).
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) Internal rate counter with `freq` param (mirrors SC `_next_k`).
//       freq ≥ sr/2 collapses to audio-rate iteration (SC `_next_1`).
//       Held between iterations — produces stair-step output, audible
//       as a chaotic sample-and-hold modulator. Most musical use case.
//  (ii) `r` (chaos) range = [2.5, 4.0]. Below ~3.0 the map converges to a
//       fixed point (boring). Above 4 the map escapes to infinity (broken).
//       3.5699 ≈ Feigenbaum point — first onset of chaos. 3.99 = strong
//       chaos default. Period-doubling windows live in [3.0, 3.5699].
// (iii) Initial y0 ∈ [0.001, 0.999]. Excludes the two fixed points (0 and
//       1) and avoids 0.5 lockup for r = 2 (where y stabilises at 0.5
//       within one iteration). 0.5 is a fine seed for r ≥ 3 since the
//       map immediately wanders.
//  (iv) Bipolar mode (`mode=1`) maps y ∈ [0,1] → [-1, 1] via 2y-1. Audio-
//       rate use wants this; SC outputs raw [0,1] and lets the user scale
//       downstream. We expose both.
//   (v) Reset returns y to the user's `y0`, not to a hard-coded constant.
//       SC ditto (Logistic_Ctor reads ZIN0(2) for init).
//
// PARAMS
//   r     — chaos parameter        [2.5, 4.0]   default 3.99
//   freq  — iteration rate (Hz)    [0.01, 24000] default 100
//   y0    — initial seed           [0.001, 0.999] default 0.5
//   mode  — output mode            {0=unipolar [0,1], 1=bipolar [-1,1]}  default 1
//   level — output scale (linear)  [0, 1]        default 1
//
// I/O
//   inputs:  (none — pure source)
//   outputs: out (audio — typically used as control signal)
//
// LATENCY: 0.

export class ChaosOp {
  static opId = 'chaos';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'r',     default: 3.99 },
    { id: 'freq',  default: 100  },
    { id: 'y0',    default: 0.5  },
    { id: 'mode',  default: 1    },
    { id: 'level', default: 1    },
  ]);

  constructor(sampleRate = 48000) {
    this.sr      = sampleRate;
    this._r      = 3.99;
    this._freq   = 100;
    this._y0     = 0.5;
    this._mode   = 1;
    this._level  = 1;
    this._y      = 0.5;
    this._counter = 0;
    this._period  = Math.max(1, Math.round(sampleRate / 100));
  }

  reset() {
    this._y       = this._y0;
    this._counter = 0;
  }

  _recalcPeriod() {
    const f = Math.max(0.001, this._freq);
    this._period = Math.max(1, Math.round(this.sr / f));
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'r':     this._r     = Math.max(2.5,    Math.min(4,      v)); break;
      case 'freq':  this._freq  = Math.max(0.01,   Math.min(24000,  v));
                    this._recalcPeriod(); break;
      case 'y0':    this._y0    = Math.max(0.001,  Math.min(0.999,  v)); break;
      case 'mode':  this._mode  = (v | 0) === 1 ? 1 : 0; break;
      case 'level': this._level = Math.max(0,      Math.min(1,      v)); break;
    }
  }

  process(_inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const r       = this._r;
    const period  = this._period;
    const lvl     = this._level;
    const bipolar = this._mode === 1;

    let y       = this._y;
    let counter = this._counter;

    for (let n = 0; n < N; n++) {
      if (counter <= 0) {
        // y[n+1] = r·y·(1-y)  — verbatim logistic map
        y = r * y * (1.0 - y);
        counter = period;
      }
      counter--;

      const ymapped = bipolar ? (2 * y - 1) : y;
      out[n] = ymapped * lvl;
    }

    this._y       = y;
    this._counter = counter;
  }

  getLatencySamples() { return 0; }
}
