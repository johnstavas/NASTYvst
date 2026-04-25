// op_fpDacRipple.worklet.js — Stage-3 op sidecar for catalog #117.
//
// Floating-point DAC ripple — the ValhallaVintageVerb "70s/80s modes"
// fingerprint. Emulates the 12-bit + gain-ranged "floating point"
// converters in early-80s digital reverbs (AMS RMX16, Lexicon 224).
//
// PRIMARY STATUS: UNRESEARCHED UPSTREAM (math-by-definition primitive).
// The canonical source — Sean Costello's VintageVerb algorithm — is
// closed-source. Costello's own public statements describe the concept
// but not verbatim math or code. See concept sources below.
//
// CONCEPT SOURCES (consulted 2026-04-24):
//
//   - Sean Costello, Valhalla DSP (via KVR forum synthesis):
//     "The 70s and 80s modes have code that replicates the 12 bit
//      'floating point' ADC/DACs of the RMX16. These used the 12-bit
//      ADC and DACs that were state of the art in the early 80s, with
//      some clever hardware that would add 3 bits of gain staging to
//      the signal, so that the quantization noise was closer to a
//      16-bit convertor."
//     "A 12-bit DAC, even with gain staging, sounds really quantized
//      in the tail. The RMX16 itself didn't have weird 'fizzling out'
//      of the reverb because there was enough of a noise floor ...
//      added a bit of noise to his '12 bit floating point DAC' code."
//
//   - Sound On Sound RMX16 review: 12-bit A-D + 2 extra bits gain-
//     ranging → 16-bit word. (SoS says 2 bits, Costello says 3 bits.
//     We parameterize so user picks; default 3 = Costello.)
//
//   - Wikipedia "Block floating point" / TI SPRA948 — structural
//     reference for shared-exponent + mantissa quantize. Not verbatim.
//
// ALGORITHM (math-by-definition):
//
//   For each sample x:
//     (1) Determine gain-range exponent e such that |x|·2^e fits in
//         the mantissa's fullscale range:
//           e = clamp(floor(-log2(|x| + eps)), 0, expBits)
//         — quiet signals get shifted UP (more resolution);
//         — loud signals stay at e=0 (coarsest).
//     (2) Quantize the gain-ranged mantissa to `bits`:
//           m_q = round(x · 2^e · M) / M,  where M = 2^(bits-1)
//     (3) Reconstruct by undoing the exponent shift:
//           y = m_q · 2^(-e)
//     (4) Add tail noise (Costello fix) to mask the "fizzling out" of
//         decaying tails that would otherwise hit the noise floor and
//         audibly stair-step through exponent boundaries:
//           y += noise · (2·r − 1) · 2^(-e)
//         (noise scales with the exponent so it stays proportional to
//          the current step size — matches Costello's description.)
//
// "Ripple" is the audible artifact when the signal crosses a power-of-
// two boundary — step size halves/doubles abruptly, giving the
// characteristic vintage-digital tail texture.
//
// PARAMETERS:
//   bits    (4..16, default 12)  — mantissa bit depth (RMX16 = 12)
//   expBits (0..4,  default 3)   — gain-ranging exponent bits
//                                  (RMX16 per Costello = 3; SoS says 2)
//                                  expBits=0 → plain fixed-point quantize
//   noise   (0..0.01, default 0.0005) — Costello tail-noise amplitude
//   seed    (int ≥1, default 1) — LCG seed for deterministic noise
//
// DEVIATIONS / KNOWN GAPS (see debt ledger for v2 upgrade paths).

const DENORMAL = 1e-30;
const LOG2 = Math.log(2);

export class FpDacRippleOp {
  static opId = 'fpDacRipple';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'bits',    default: 12 },
    { id: 'expBits', default: 3  },
    { id: 'noise',   default: 0.0005 },
    { id: 'seed',    default: 1 },
  ]);

  constructor(sampleRate) {
    this.sr       = sampleRate;
    this._bits    = 12;
    this._expBits = 3;
    this._noise   = 0.0005;
    this._seed0   = 1;
    this._s       = 1;
    this._M       = Math.pow(2, 11);   // 2^(bits-1)
    this._maxE    = 3;
  }

  reset() { this._s = this._seed0 >>> 0; if (this._s === 0) this._s = 1; }

  _rand() {
    // LCG, Canon:synthesis §10 (Numerical Recipes constants)
    this._s = (Math.imul(this._s, 1664525) + 1013904223) >>> 0;
    return this._s / 4294967296;
  }

  setParam(id, v) {
    if (id === 'bits') {
      let b = +v; if (!Number.isFinite(b)) b = 12;
      b = Math.round(b);
      if (b < 4)  b = 4;
      if (b > 16) b = 16;
      this._bits = b;
      this._M = Math.pow(2, b - 1);
    } else if (id === 'expBits') {
      let e = +v; if (!Number.isFinite(e)) e = 3;
      e = Math.round(e);
      if (e < 0) e = 0;
      if (e > 4) e = 4;
      this._expBits = e;
      this._maxE = e;
    } else if (id === 'noise') {
      let n = +v; if (!Number.isFinite(n)) n = 0.0005;
      if (n < 0)    n = 0;
      if (n > 0.01) n = 0.01;
      this._noise = n;
    } else if (id === 'seed') {
      let s = +v; if (!Number.isFinite(s)) s = 1;
      s = Math.max(1, Math.round(s)) >>> 0;
      this._seed0 = s;
      this._s = s;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const M     = this._M;
    const maxE  = this._maxE;
    const nAmp  = this._noise;

    for (let n = 0; n < N; n++) {
      const x = iBuf ? iBuf[n] : 0;
      // (1) Find gain-range exponent. Clamp to [0, maxE].
      const ax = Math.abs(x);
      let e = 0;
      if (ax > DENORMAL && maxE > 0) {
        // e = floor(-log2(ax)) clamped to maxE
        const raw = -Math.log(ax) / LOG2;
        e = raw < 0 ? 0 : (raw > maxE ? maxE : Math.floor(raw));
      }
      const scale = Math.pow(2, e);     // mantissa gain-up factor
      const inv   = 1 / scale;          // reconstruct factor

      // (2) Quantize gain-ranged mantissa to `bits` (mid-tread: round).
      //     m_q = round(x · scale · M) / M
      const mantissa = x * scale;
      const mq = Math.round(mantissa * M) / M;

      // (3) Reconstruct.
      let y = mq * inv;

      // (4) Tail noise, scaled to current step size.
      if (nAmp > 0) {
        const r = this._rand();
        y += nAmp * (2 * r - 1) * inv;
      }

      if (Math.abs(y) < DENORMAL) y = 0;
      oBuf[n] = y;
    }
  }
}
