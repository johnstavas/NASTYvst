// op_noise.worklet.js — Stage-3 op sidecar for the `noise` op.
//
// Deterministic noise source for sandbox graphs. Research:
//   - dsp_code_canon_synthesis.md §10 — 32-bit LCG (Numerical Recipes pair:
//     a = 196314165, c = 907633515, m = 2^32). Cheap, stateless aside from
//     a single uint32, period 2^32. Upper 24 bits → float ∈ [-1, 1).
//   - Paul Kellett "economy" 3-stage pink-noise filter (sibling to Canon §8
//     Trammell; different coefficient recipe). Three parallel one-pole LPFs
//     at poles {0.02109238, 0.07113478, 0.68873558} summed with amplitudes
//     {0.3190, 0.2636, 0.4144}, normalized by 0.11, driven by LCG white.
//     Canon §8 Trammell uses poles {0.3190, 0.7756, 0.9613} and amplitudes
//     {0.02109238, 0.07113478, 0.68873558} — same numeric vectors but with
//     role (pole ↔ amplitude) swapped. Both produce 1/f to within audible
//     tolerance; they are DISTINCT recipes, not interchangeable.
//   - Canon §8 is cited as the family reference; the shipped recipe here is
//     Kellett economy. See `sandbox_ops_research_debt.md` noise row.
//   - dsp_code_canon_utilities.md §1 — Jon Watte denormal flush. IIR stages
//     (pink leaky integrators, brown integrator) are the classic source of
//     denormal stalls; we flush any state < 1e-30 to zero.
//
// Brown = 1-pole leaky integrator of white noise (canonical Brownian /
// "red" noise). Leaky coefficient 0.996 gives ~6 dB/oct with bounded DC;
// output scaled by 3.5 to roughly normalize RMS to white.
//
// Contract (per OP_TEMPLATE.md):
//   - No audio inputs; single audio output.
//   - reset() restores seed and clears all IIR state.
//   - setParam('seed', n) re-seeds on the fly. setParam('shape', s) swaps
//     generator; does NOT clear pink/brown state (avoids click at UI change).

// Canon §10 LCG constants — Numerical Recipes pair.
const LCG_A = 196314165 >>> 0;
const LCG_C = 907633515 >>> 0;

// Kellett "economy" pink-noise filter coefficients. Three parallel stages.
// PINK_A[k] = one-pole POLE for stage k (a in y = a·y₋₁ + (1-a)·x).
// PINK_P[k] = output AMPLITUDE for stage k in the mixed sum.
// Published Kellett values — do not perturb without re-calibrating slope.
// Note: Canon §8 Trammell uses the same two number-vectors but with the
// POLE/AMPLITUDE roles swapped; the two recipes are NOT equivalent.
const PINK_A = [0.02109238, 0.07113478, 0.68873558];
const PINK_P = [0.3190,     0.2636,     0.4144];
const PINK_OUT_SCALE = 0.11;  // Kellett normalization → RMS ≈ white.

// Brown (leaky integrator) — Canon tradition. Pole at ~20 Hz @ 48 kHz.
const BROWN_LEAK  = 0.996;
const BROWN_SCALE = 3.5;

// Jon Watte denormal floor (Canon:utilities §1).
const DENORMAL = 1e-30;

const SHAPE = { white: 0, pink: 1, brown: 2 };

export class NoiseOp {
  static opId = 'noise';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'shape',  default: 'white' },
    { id: 'seed',   default: 22222   },
    { id: 'amount', default: 1       },
    { id: 'offset', default: 0       },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;

    this._shape   = SHAPE.white;
    this._seed    = 22222 >>> 0;
    this._seed0   = 22222 >>> 0;  // snapshot for reset()
    this._amount  = 1;
    this._offset  = 0;

    // Pink stages (3 parallel leaky integrators).
    this._p0 = 0;
    this._p1 = 0;
    this._p2 = 0;

    // Brown state (1-pole integrator).
    this._brown = 0;
  }

  reset() {
    this._seed  = this._seed0 >>> 0;
    this._p0 = 0;
    this._p1 = 0;
    this._p2 = 0;
    this._brown = 0;
  }

  setParam(id, v) {
    switch (id) {
      case 'shape':
        if (v in SHAPE) this._shape = SHAPE[v];
        break;
      case 'seed': {
        // Integer, nonzero (LCG dies at 0 for some variants; here OK but we
        // follow Canon convention of nonzero seeds).
        const n = (v | 0) || 1;
        this._seed  = n >>> 0;
        this._seed0 = n >>> 0;
        break;
      }
      case 'amount': this._amount = +v; break;
      case 'offset': this._offset = +v; break;
    }
  }

  getLatencySamples() { return 0; }

  // One LCG step → float in [-1, 1). Upper 24 bits provide the float;
  // lower 8 bits are the weakest (LCG tradition). Divisor 2^23 yields a
  // signed range.
  _whiteSample() {
    this._seed = (Math.imul(this._seed, LCG_A) + LCG_C) >>> 0;
    // Take upper 24 bits as signed 24-bit int → [-2^23, 2^23-1] → /2^23.
    const upper = this._seed >>> 8;         // 0..2^24-1
    const signed = upper - 0x800000;        // -2^23 .. 2^23-1
    return signed / 0x800000;               // -1 .. (1 - 2^-23)
  }

  // process(inputs, outputs, N) — no inputs; writes `out`.
  process(_inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;

    const shape = this._shape;
    const amt   = this._amount;
    const off   = this._offset;

    if (shape === SHAPE.white) {
      for (let i = 0; i < N; i++) {
        outCh[i] = this._whiteSample() * amt + off;
      }
      return;
    }

    if (shape === SHAPE.pink) {
      let p0 = this._p0, p1 = this._p1, p2 = this._p2;
      for (let i = 0; i < N; i++) {
        const w = this._whiteSample();
        p0 = PINK_A[0] * p0 + (1 - PINK_A[0]) * w;
        p1 = PINK_A[1] * p1 + (1 - PINK_A[1]) * w;
        p2 = PINK_A[2] * p2 + (1 - PINK_A[2]) * w;
        let y = (PINK_P[0] * p0 + PINK_P[1] * p1 + PINK_P[2] * p2) / PINK_OUT_SCALE;
        // Denormal flush per Canon:utilities §1.
        if (p0 < DENORMAL && p0 > -DENORMAL) p0 = 0;
        if (p1 < DENORMAL && p1 > -DENORMAL) p1 = 0;
        if (p2 < DENORMAL && p2 > -DENORMAL) p2 = 0;
        outCh[i] = y * amt + off;
      }
      this._p0 = p0; this._p1 = p1; this._p2 = p2;
      return;
    }

    // brown — 1-pole leaky integrator of white.
    let b = this._brown;
    for (let i = 0; i < N; i++) {
      const w = this._whiteSample();
      b = BROWN_LEAK * b + (1 - BROWN_LEAK) * w;
      if (b < DENORMAL && b > -DENORMAL) b = 0;
      outCh[i] = b * BROWN_SCALE * amt + off;
    }
    this._brown = b;
  }
}
