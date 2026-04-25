// op_crackle.worklet.js — Catalog #124 (Source family).
//
// Sparse random-impulse noise — tape/vinyl crackle, Geiger clicks, rain.
//
// PRIMARY (algorithm, open — GPLv3 code NOT copied):
//   SuperCollider · server/plugins/NoiseUGens.cpp · Dust_next / Dust2_next
//   https://github.com/supercollider/supercollider — develop branch, lines 315-368.
//
// VERBATIM PASSAGE (SC Dust_next, for diff only):
//   thresh = density * sampleDur;
//   scale  = thresh > 0 ? 1/thresh : 0;          // Dust  (unipolar)
//   scale  = thresh > 0 ? 2/thresh : 0;          // Dust2 (bipolar)
//   z = frand();                                 // uniform [0,1)
//   out = (z < thresh) ? z*scale        : 0;     // Dust  → [0,1)
//   out = (z < thresh) ? z*scale - 1    : 0;     // Dust2 → [-1,1)
//
// SC's code is GPLv3 so we don't ship the file. The *algorithm* (sparse-
// Bernoulli impulse generator: threshold uniform PRNG at λ·Ts, emit height
// via inverse-CDF so amplitude is uniform over the hit interval) is math-
// by-definition for Poisson-approximated sparse events and unencumbered.
// The PRNG we reuse is feldkirch XOR-add (musicdsp #216, open) shared with
// #125 hiss — consistent noise identity across the Source family.
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) PRNG choice. SC's frand is a 3-component xorshift; ours is feldkirch
//       2-component XOR-add. Both are uniform in [-1,1) mapped to [0,1).
//       Spectrum flatness is comparable (archive-verified); upgrade path is
//       xoshiro128++ or PCG (debt row).
//  (ii) "density" is in Hz (events/sec) — same convention as SC.Dust.
//       Clamped to [0.01, sr/2] so thresh ≤ 0.5 and statistics stay sane.
// (iii) Amplitude under the hit: SC emits z/thresh (uniform over [0,1) by
//       inverse-sampling). We preserve this exactly — it is *the* thing
//       that makes Dust sound like Dust (vs a fixed-height 0/1 gate).
//  (iv) Bipolar mode (Dust2): z*scale - 1 yields uniform [-1, 1). Impulse
//       SIGN is random per hit, not just magnitude. This matches SC exactly.
//   (v) level applied *after* the impulse shaping so dB params compose with
//       hiss and other Source ops.
//
// PARAMS
//   density — events per second (Hz)   [0.01, 24000]   default 100
//   mode    — 0 = unipolar [0,1),  1 = bipolar [-1,1)  default 1
//   level   — output level (dB)        [-60, 0]        default 0
//
// I/O
//   inputs:  (none — pure source)
//   outputs: out (audio)
//
// LATENCY: 0.

const SCALE = 2.0 / 0xffffffff;

export class CrackleOp {
  static opId = 'crackle';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'density', default: 100 },
    { id: 'mode',    default: 1   },
    { id: 'level',   default: 0   },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._density = 100;
    this._mode    = 1;
    this._level   = 0;
    this._lvlLin  = 1;
    this._thresh  = 100 / sampleRate;
    this._scale   = this._mode === 1 ? 2 / this._thresh : 1 / this._thresh;
    // feldkirch seeds (SHA-1 IVs) — matches #125 hiss
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
  }

  reset() {
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
  }

  _recalc() {
    const nyq = this.sr * 0.5;
    const d = Math.max(0.01, Math.min(nyq, this._density));
    this._thresh = d / this.sr;
    this._scale  = this._thresh > 0
      ? (this._mode === 1 ? 2 / this._thresh : 1 / this._thresh)
      : 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'density':
        this._density = v;
        this._recalc();
        break;
      case 'mode':
        this._mode = (v | 0) === 1 ? 1 : 0;
        this._recalc();
        break;
      case 'level':
        this._level  = Math.max(-60, Math.min(0, v));
        this._lvlLin = Math.pow(10, this._level / 20);
        break;
    }
  }

  process(_inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const thresh = this._thresh;
    const scale  = this._scale;
    const lvl    = this._lvlLin;
    const bipolar = this._mode === 1;

    let x1 = this._x1, x2 = this._x2;

    for (let n = 0; n < N; n++) {
      // feldkirch white in [-1, 1) (verbatim algorithm)
      x1 = (x1 ^ x2) | 0;
      const u = x2 * SCALE;          // [-1, 1)
      x2 = (x2 + x1) | 0;

      // Map to z ∈ [0, 1) uniform, SC-Dust compatible
      const z = (u + 1) * 0.5;

      let y;
      if (z < thresh) {
        y = bipolar ? (z * scale - 1) : (z * scale);
      } else {
        y = 0;
      }
      out[n] = y * lvl;
    }

    this._x1 = x1;
    this._x2 = x2;
  }

  getLatencySamples() { return 0; }
}
