// op_hiss.worklet.js — Catalog #125 (Source family).
//
// White / pink noise generator — tape-hiss style source.
//
// PRIMARIES (both open, musicdsp archive):
//   · White PRNG — gerd.feldkirch@web.de "Fast Whitenoise Generator"
//     https://raw.githubusercontent.com/bdejong/musicdsp/master/source/Synthesis/216-fast-whitenoise-generator.rst
//     (two 32-bit XOR-add counters, scaled by 2/0xffffffff to ±1 float)
//   · Pink filter — Paul Kellett, "Filter to make pink noise from white"
//     https://raw.githubusercontent.com/bdejong/musicdsp/master/source/files/pink.txt
//     ("refined" version, accurate ±0.05 dB above 9.2 Hz at 44.1 kHz; unity
//      gain at Nyquist; weighted sum of 7 first-order filters).
//
// VERBATIM pink filter (Kellett, pink.txt):
//   b0 = 0.99886*b0 + white*0.0555179;
//   b1 = 0.99332*b1 + white*0.0750759;
//   b2 = 0.96900*b2 + white*0.1538520;
//   b3 = 0.86650*b3 + white*0.3104856;
//   b4 = 0.55000*b4 + white*0.5329522;
//   b5 = -0.7616*b5 - white*0.0168980;
//   pink = b0+b1+b2+b3+b4+b5+b6 + white*0.5362;
//   b6 = white*0.115926;
//
// VERBATIM white (feldkirch):
//   x1 ^= x2;
//   out = x2 * (2/0xffffffff) * level;
//   x2 += x1;
//
// DESIGN PICKS (NOT math-by-def; carved explicitly):
//   (i) Kellett's coefficients are tuned at 44.1 kHz. At 48/96/192 kHz the
//       −10 dB/decade slope drifts slightly — Kellett states ±0.05 dB above
//       9.2 Hz at 44.1 kHz, no guarantee off-rate. Ship uses Kellett numbers
//       verbatim; Lubomir's ranged coefficient tables (also in the same rst)
//       are the documented upgrade path (debt row).
//  (ii) PRNG = feldkirch XOR-add. Not a CSPRNG, but spectrum is flat enough
//       for audio (FFT-flat per archive comments). Alternative: PM-LCG
//       (Park-Miller), xorshift64. Not a gate.
// (iii) Seed: constants from the archive (x1=0x67452301, x2=0xefcdab89 —
//       SHA-1 IVs, ensures reproducibility across builds + non-zero start).
//
// PARAMS
//   level — output level (dB)    [-60, 0]   default -24
//   tint  — color enum           {0=white, 1=pink}  default 1
//
// I/O
//   inputs:  (none — pure source)
//   outputs: out (audio)
//
// LATENCY: 0.

const SCALE = 2.0 / 0xffffffff;

export class HissOp {
  static opId = 'hiss';
  static inputs  = Object.freeze([]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'level', default: -24 },
    { id: 'tint',  default: 1   },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._level = -24;  // dB
    this._tint  = 1;
    this._lvlLin = Math.pow(10, this._level / 20);
    // feldkirch seeds (SHA-1 IVs)
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
    // Kellett pink state
    this._b0 = 0; this._b1 = 0; this._b2 = 0;
    this._b3 = 0; this._b4 = 0; this._b5 = 0; this._b6 = 0;
  }

  reset() {
    this._x1 = 0x67452301 | 0;
    this._x2 = 0xefcdab89 | 0;
    this._b0 = this._b1 = this._b2 = this._b3 =
      this._b4 = this._b5 = this._b6 = 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'level': this._level = Math.max(-60, Math.min(0, v));
                    this._lvlLin = Math.pow(10, this._level / 20); break;
      case 'tint':  this._tint = Math.max(0, Math.min(1, v | 0)); break;
    }
  }

  process(_inputs, outputs, N) {
    const out = outputs && outputs.out ? outputs.out : null;
    if (!out) return;

    const lvl = this._lvlLin;
    let x1 = this._x1, x2 = this._x2;
    let b0 = this._b0, b1 = this._b1, b2 = this._b2;
    let b3 = this._b3, b4 = this._b4, b5 = this._b5, b6 = this._b6;
    const wantPink = this._tint === 1;

    for (let n = 0; n < N; n++) {
      // feldkirch white (verbatim)
      x1 = (x1 ^ x2) | 0;
      const white = x2 * SCALE;
      x2 = (x2 + x1) | 0;

      let y;
      if (wantPink) {
        // Kellett (verbatim)
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        y  = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        // Kellett's pink unity-gain-at-Nyquist means total energy ≈ 4× white.
        // Normalize so pink RMS ≈ white RMS for interchangeable "level" param.
        y *= 0.11;   // empirical: RMS(pink·0.11) ≈ RMS(white) for these coefs
      } else {
        y = white;
      }
      out[n] = y * lvl;
    }

    this._x1 = x1; this._x2 = x2;
    this._b0 = b0; this._b1 = b1; this._b2 = b2;
    this._b3 = b3; this._b4 = b4; this._b5 = b5; this._b6 = b6;
  }

  getLatencySamples() { return 0; }
}
