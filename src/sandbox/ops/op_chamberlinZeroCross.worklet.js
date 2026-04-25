// op_chamberlinZeroCross.worklet.js — Stage-3 op sidecar for the
// `chamberlinZeroCross` op (catalog #116).
//
// Simulates the zero-crossing artifact of 1980s sign-magnitude DACs.
// Canonical description: Hal Chamberlin, "Musical Applications of
// Microprocessors" 2nd ed., Hayden 1985, Ch.12 "D/A" §12.4, pp.375-394.
//
// PRIMARY STATUS (honest declaration — ship protocol Step 4):
// The primary is a physical book not openable via tool call. This op
// is a MATH-BY-DEFINITION paraphrase of the TWO artifacts that book
// describes, with no equations lifted verbatim:
//
//   1. SIGN-MAGNITUDE DEAD ZONE. Two's-complement has one LSB step
//      between −1 LSB and +1 LSB. Sign-magnitude has none — both
//      codes (−0, +0) collapse to "zero" and the DAC reads any
//      sub-LSB signal as dead silence. Net effect: |x| < deadZone → 0.
//
//   2. ZERO-CROSSING SPIKE. Sign-magnitude DACs flip the entire
//      code word (sign bit + all magnitude bits) at every zero
//      crossing. Output-stage settling is not instantaneous, so the
//      signal briefly passes through an incorrect intermediate code,
//      producing a one-sample impulse "glitch" at each crossing.
//      Net effect: on sign change, add ±glitchAmp to output for
//      one sample.
//
// Cross-reference: general crossover-distortion mechanism
// (Wikipedia → class-B amplifier kink near 0V) is SAME SUBJECTIVE
// character but DIFFERENT MECHANISM (analog-amplifier kink vs. digital-
// converter spike). This op models the digital-converter spike.
//
// Secondary cross-check (not verbatim): Sean Costello's
// ValhallaVintageVerb (2013) reproduces this artifact as one of the
// "digital-vintage" fingerprints. Also not openable (closed source).
//
// DEBT FILED: find an openable academic primary (likely an AES paper
// on 14-bit linear / 16-bit sign-mag DAC characterization circa 1978-
// 1985) before declaring this ship "verbatim research-first."

const DENORMAL = 1e-30;

export class ChamberlinZeroCrossOp {
  static opId = 'chamberlinZeroCross';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'deadZone', default: 0.002 },   // dead-zone half-width (linear)
    { id: 'glitch',   default: 0.05  },   // zero-crossing spike amplitude
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._deadZone  = 0.002;
    this._glitch    = 0.05;
    this._prev      = 0;   // last input sample (for sign-change detection)
  }

  reset() { this._prev = 0; }

  setParam(id, v) {
    if (id === 'deadZone') {
      let dz = +v;
      if (!Number.isFinite(dz)) dz = 0.002;
      if (dz < 0)   dz = 0;
      if (dz > 0.5) dz = 0.5;
      this._deadZone = dz;
    } else if (id === 'glitch') {
      let g = +v;
      if (!Number.isFinite(g)) g = 0.05;
      if (g < 0) g = 0;
      if (g > 1) g = 1;
      this._glitch = g;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const dz   = this._deadZone;
    const gl   = this._glitch;
    let   prev = this._prev;

    for (let n = 0; n < N; n++) {
      const x = iBuf ? iBuf[n] : 0;

      // (1) sign-magnitude dead zone
      let y = (Math.abs(x) < dz) ? 0 : x;

      // (2) zero-crossing spike: detect sign change vs previous INPUT
      //     (using input, not output, so the spike fires on the real
      //     crossing even when the current sample is inside the dead
      //     zone).
      const sx = x    > 0 ? 1 : (x    < 0 ? -1 : 0);
      const sp = prev > 0 ? 1 : (prev < 0 ? -1 : 0);
      if (sx !== 0 && sp !== 0 && sx !== sp) {
        // Spike in direction of new sign. Amplitude `gl` is the
        // glitch peak as a fraction of full scale.
        y += gl * sx;
      }

      if (Math.abs(y) < DENORMAL) y = 0;
      oBuf[n] = y;
      prev = x;
    }

    this._prev = prev;
  }
}
