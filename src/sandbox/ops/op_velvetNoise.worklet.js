// op_velvetNoise.worklet.js — Stage-3 op sidecar for the `velvetNoise` op.
//
// Sparse impulse noise for high-quality decorrelators / lush reverb early-
// reflection generators / convolution-tail substitutes. Output is a stream
// of ±1 impulses placed pseudo-randomly on a regular Td-sample grid, with
// all other samples zero. Density (impulses-per-second) is the only
// perceptually-meaningful knob — at 1500–2000 imp/s the impulse stream
// sounds spectrally indistinguishable from white Gaussian noise, but uses
// only ~3% of the multiplications when convolved (because the output is
// mostly zeros).
//
// PRIMARY (math-by-definition; foundational papers documented but the PDFs
// were not retrievable from public DAFx mirrors at the time of writing —
// the algorithm itself is universally documented and unambiguous):
//   - M. Karjalainen and H. Järveläinen, "Reverberation Modeling Using
//     Velvet Noise," AES 30th International Conference on Intelligent
//     Audio Environments, March 2007 — originator paper. Defines OVN
//     (Original Velvet Noise): split timeline into Td-length cells,
//     place exactly one ±1 impulse per cell at a pseudorandom position
//     drawn from U[0, Td−1].
//   - V. Välimäki, B. Holm-Rasmussen, B. Alary, H.-M. Lehtonen, "Late
//     Reverberation Synthesis Using Filtered Velvet Noise," Applied
//     Sciences 7(5), May 2017 — survey + filtered-VN extension.
//   - V. Välimäki, S. Schlecht, J. Pätynen, "Velvet Noise Decorrelator,"
//     DAFx 2017 — decorrelator application; also Schlecht 2018 "Optimized
//     Velvet-Noise Decorrelator," DAFx 2018, refines optimal density for
//     decorrelation applications.
//
// CLOSED-FORM (the entire algorithm — no hidden recurrence):
//   Given:
//     SR      sample rate (Hz)
//     density target impulses-per-second
//     Td      = round(SR / density)              cell length in samples
//     m       cell index, m = 0, 1, 2, …
//     r1, r2  i.i.d. uniform random variates in [0, 1)
//
//   For each cell m:
//     k_imp(m) = round(r1 · (Td − 1))            impulse position in cell
//     s_imp(m) = sgn(r2 − 0.5) ∈ {−1, +1}        impulse sign
//
//   Output sample at absolute sample index n = m·Td + k where k ∈ [0, Td):
//     y[n] = ⎧ s_imp(m) · amp     if k == k_imp(m)
//            ⎩ 0                  otherwise
//
// PRNG: Numerical Recipes 32-bit LCG (a=196314165, c=907633515, m=2^32),
// matching op_noise — same convention so authors composing
// noise + velvetNoise from the same seed get reproducible co-evolved
// streams. Upper 24 bits → float in [0, 1).
//
// AUTHORING SHAPE:
//   Inputs  : (none)
//   Outputs : out (audio)
//   Params  : density (Hz, default 1500), amp (0..4, default 1),
//             seed (int, default 22222)
//
// State: LCG state (uint32), current cell length, current sample-in-cell
// counter, impulse offset within cell, impulse sign. reset() restores
// seed and clears cell state — first sample after reset re-rolls cell.
//
// Notes:
//   - Output is exactly 0 between impulses (no DC, no leakage). A 1500-
//     impulse-per-second stream at 48 kHz has Td=32, so 1 in 32 samples
//     is non-zero.
//   - Density clamped [50, 5000] Hz. Below 50 the impulse stream sounds
//     audibly sparse (clicky); above 5000 cells become so short
//     (Td<10 at 48 kHz) that the "round(r1·(Td−1))" position quantizes
//     poorly and the stream loses its randomized-feel.
//   - Td recomputed on density change; takes effect at next cell boundary
//     (in-cell change does not retro-shift the current impulse).

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// LCG — Numerical Recipes pair (matches op_noise).
const LCG_A = 196314165 >>> 0;
const LCG_C = 907633515 >>> 0;

export class VelvetNoiseOp {
  static opId = 'velvetNoise';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'density', default: 1500   },
    { id: 'amp',     default: 1      },
    { id: 'seed',    default: 22222  },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate || 48000;
    this._density = 1500;
    this._amp    = 1;
    this._seed   = 22222 >>> 0;
    this._seed0  = 22222 >>> 0;     // snapshot for reset()

    this._Td = this._computeTd(this._density);

    // Cell state — _cellLen=0 forces "begin new cell" on first sample.
    this._cellLen       = 0;
    this._cellSamp      = 0;
    this._impulseOffset = 0;
    this._impulseSign   = 1;
  }

  reset() {
    this._seed = this._seed0 >>> 0;
    this._cellLen       = 0;
    this._cellSamp      = 0;
    this._impulseOffset = 0;
    this._impulseSign   = 1;
  }

  _computeTd(density) {
    const td = Math.round(this.sr / density);
    return td < 1 ? 1 : td;
  }

  setParam(id, v) {
    switch (id) {
      case 'density': {
        const x = +v;
        if (!Number.isFinite(x)) return;
        this._density = clip(x, 50, 5000);
        this._Td = this._computeTd(this._density);
        // New Td takes effect at next cell boundary.
        break;
      }
      case 'amp': {
        const x = +v;
        if (!Number.isFinite(x)) return;
        this._amp = clip(x, 0, 4);
        break;
      }
      case 'seed': {
        const n = (v | 0) || 1;     // nonzero per LCG convention
        this._seed  = n >>> 0;
        this._seed0 = n >>> 0;
        break;
      }
    }
  }

  getLatencySamples() { return 0; }

  // LCG step → uniform float in [0, 1). Upper 24 bits / 2^24.
  _u01() {
    this._seed = (Math.imul(this._seed, LCG_A) + LCG_C) >>> 0;
    return (this._seed >>> 8) / 0x1000000;
  }

  process(_inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;
    const amp = this._amp;

    for (let i = 0; i < N; i++) {
      if (this._cellSamp >= this._cellLen) {
        // Begin new cell — adopt current Td (may have just changed).
        this._cellSamp = 0;
        this._cellLen  = this._Td;
        const r1 = this._u01();
        const r2 = this._u01();
        // Impulse position uniformly in [0, Td−1] (rounded to int).
        this._impulseOffset = (this._cellLen <= 1) ? 0 : Math.round(r1 * (this._cellLen - 1));
        this._impulseSign   = r2 < 0.5 ? -1 : 1;
      }

      outCh[i] = (this._cellSamp === this._impulseOffset) ? (this._impulseSign * amp) : 0;
      this._cellSamp++;
    }
  }
}
