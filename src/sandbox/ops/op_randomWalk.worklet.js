// op_randomWalk.worklet.js — Catalog #58 (Movement / Modulation family).
//
// Bounded random walk — a.k.a. Brownian noise, drunk walk, red noise.
// Cumulative sum of small random increments with reflective ±1 boundaries.
//
// PRIMARY (algorithm, open — GPLv3 code NOT copied):
//   SuperCollider · server/plugins/NoiseUGens.cpp · BrownNoise_next
//   (develop branch, lines 285-294)
//   and SC_RGen.h frand8 definition (lines 181-187).
//
// VERBATIM PASSAGE (SC BrownNoise_next, for diff only):
//   z += frand8(s1, s2, s3);
//   if      (z >  1.f) z =  2.f - z;
//   else if (z < -1.f) z = -2.f - z;
//   out = z;
// where frand8 returns uniform [-0.125, +0.125).
//
// This is the textbook bounded 1-D random walk: step, accumulate, reflect.
// Classic −6 dB/octave spectrum (true brown/red noise). Math-by-def for
// a discrete random walk; only judgement calls are step-size and reflect
// vs wrap vs clamp at the boundary.
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) Step size = `step` param, default 0.125 (exactly SC's frand8 range).
//       User can dial down to 0.001 (ultra-slow wander) or up to 0.5
//       (jittery but still bounded by reflection).
//  (ii) Boundary handling = reflective (SC-faithful). Alternatives:
//       - clamp at ±1 (gets "stuck" at the rails; unmusical)
//       - wrap modulo 2 (jump discontinuity; not a walk anymore)
//       Reflective gives smooth bounded wandering and matches SC exactly.
// (iii) PRNG shared with #124 crackle / #125 hiss (feldkirch XOR-add).
//       Consistent noise identity across the Movement + Source families.
//  (iv) Update rate. SC BrownNoise steps every sample (audio-rate).
//       Control-rate variants exist (LFBrownNoise) that hold between
//       steps — that would be a separate op (#59 stepSeq family) with
//       linear interpolation between held values. Kept distinct here.
//   (v) Output scale. Stays in [-1, +1] by construction (reflection
//       keeps z in range). No post-normalisation needed.
//
// PARAMS
//   step  — step size (peak increment per sample)   [0.0001, 0.5]  default 0.125
//   level — output scale (linear)                   [0, 1]         default 1
//
// I/O
//   inputs:  (none — pure source)
//   outputs: out (audio — but typically used as control signal)
//
// LATENCY: 0.

const SCALE = 2.0 / 0xffffffff;   // maps int32 → [-1, 1)

export class RandomWalkOp {
  static opId = 'randomWalk';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'step',  default: 0.125 },
    { id: 'level', default: 1     },
  ]);

  constructor(sampleRate = 48000) {
    this.sr       = sampleRate;
    this._step    = 0.125;
    this._level   = 1;
    this._z       = 0;
    // feldkirch seeds — SHA-1 IVs, shared with crackle/hiss
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
  }

  reset() {
    this._z  = 0;
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'step':  this._step  = Math.max(0.0001, Math.min(0.5, v)); break;
      case 'level': this._level = Math.max(0,      Math.min(1,   v)); break;
    }
  }

  process(_inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const step = this._step;
    const lvl  = this._level;
    let z      = this._z;
    let x1     = this._x1;
    let x2     = this._x2;

    for (let n = 0; n < N; n++) {
      // feldkirch white → u ∈ [-1, 1); scale by step for bounded increment
      x1 = (x1 ^ x2) | 0;
      const u = x2 * SCALE;
      x2 = (x2 + x1) | 0;

      z += u * step;

      // reflective boundaries (SC BrownNoise, verbatim logic)
      if      (z >  1) z =  2 - z;
      else if (z < -1) z = -2 - z;

      out[n] = z * lvl;
    }

    this._z  = z;
    this._x1 = x1;
    this._x2 = x2;
  }

  getLatencySamples() { return 0; }
}
