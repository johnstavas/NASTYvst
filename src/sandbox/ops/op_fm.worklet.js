// op_fm.worklet.js — Stage-3 op sidecar for the `fm` op.
//
// Two-operator FM synthesis (one carrier + one modulator) after
// Chowning 1973, "The Synthesis of Complex Audio Spectra by Means of
// Frequency Modulation" (JAES 21/7).
//
// PRIMARIES (synth-family rule = 2 minimum):
//
//   A. CCRMA Snd documentation (Chowning formulation):
//        https://ccrma.stanford.edu/software/snd/snd/fm.html
//      Canonical equation verbatim:
//        e(t) = A · sin(ω_c · t + I · sin(ω_m · t))
//      A = amplitude, ω_c = carrier (rad/s), ω_m = modulator (rad/s),
//      I = modulation index. Spectrum = carrier + sidebands at
//      f_c ± k·f_m with amplitudes J_k(I) (Bessel, first kind). C:M
//      ratio = 1 yields harmonics of the carrier; non-integer ratios
//      yield inharmonic spectra (bells, percussion).
//
//   B. Wikipedia "Frequency modulation synthesis" (cross-check):
//        https://en.wikipedia.org/wiki/Frequency_modulation_synthesis
//      Verbatim:
//        FM(t) ≈ A · sin(ω_c·t + β·sin(ω_m·t))
//        FM(t) = A · Σ_n  J_n(β) · sin((ω_c + n·ω_m)·t)
//        β = B / ω_m    (B = modulation amplitude in rad/s)
//      Cross-confirms: sideband count grows with β; Carson's rule
//      bandwidth ≈ 2·(β + 1)·f_m.
//
// Discrete-time form (what we ship):
//   φ_m[n+1] = φ_m[n] + 2π · f_m / sr
//   m[n]     = sin(φ_m[n])
//   φ_c[n+1] = φ_c[n] + 2π · f_c / sr
//   y[n]     = amp · sin(φ_c[n] + I · m[n])
// Phase wraps to [0, 2π) every sample to preserve precision at long runs.
//
// Parameter conventions:
//   carrierFreq  — Hz, the perceived pitch when modRatio = 1.
//   modRatio     — unitless; modulator frequency = carrierFreq · modRatio.
//                  Integer ratios (0.5, 1, 2, 3) = harmonic timbres;
//                  irrational ratios (√2, 1.414, 2.76) = inharmonic.
//   modIndex     — unitless I (same as Chowning's I / Wikipedia's β).
//                  I=0 → pure carrier sine; I≈1 → warm, 2 sidebands
//                  dominant; I≈5 → bright, ~6 sidebands dominant.
//   amp          — linear output gain.
//
// Optional control inputs (all leave-wire-to-override):
//   freqMod      — Hz added to carrierFreq per sample (linear FM of
//                  the whole patch, e.g. vibrato from an LFO).
//   idxMod       — linear value added to modIndex per sample (index
//                  envelope — this is the archetypal DX7 envelope).
//
// Not in scope for v1: multi-operator algorithms, operator feedback,
// fixed-freq operators. Slot #83 is the 2-op primitive; stacked algos
// compose at the graph level or as future ops. Filed as debt.
//
// Contract:
//   - Outputs 1 audio channel `out`.
//   - getLatencySamples() = 0.
//   - reset() returns both phases to 0 (first sample sin(0)=0).
//   - carrierFreq clamped to (0.01, sr/2 − 1) to keep things sane;
//     modulator can run arbitrarily high (sidebands above Nyquist
//     simply alias — Chowning's original papers lived with this).

const TWO_PI   = 2 * Math.PI;
const DENORMAL = 1e-30;

export class FmOp {
  static opId = 'fm';
  static inputs  = Object.freeze([
    { id: 'freqMod', kind: 'control' },
    { id: 'idxMod',  kind: 'control' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'carrierFreq', default: 440 },
    { id: 'modRatio',    default: 1   },
    { id: 'modIndex',    default: 1   },
    { id: 'amp',         default: 1   },
  ]);

  constructor(sampleRate) {
    this.sr           = sampleRate;
    this._carrierFreq = 440;
    this._modRatio    = 1;
    this._modIndex    = 1;
    this._amp         = 1;
    this._phaseC      = 0;
    this._phaseM      = 0;
  }

  reset() {
    this._phaseC = 0;
    this._phaseM = 0;
  }

  setParam(id, v) {
    if (id === 'carrierFreq') {
      let f = +v;
      if (!(f > 0.01))         f = 0.01;
      const nyq = this.sr * 0.5;
      if (f > nyq - 1)         f = nyq - 1;
      this._carrierFreq = f;
    } else if (id === 'modRatio') {
      // Allow negative (phase-inverted modulator); clamp extreme to
      // keep sin() evaluation well-posed in double precision.
      let r = +v;
      if (!Number.isFinite(r)) r = 1;
      if (r >  64)             r =  64;
      if (r < -64)             r = -64;
      this._modRatio = r;
    } else if (id === 'modIndex') {
      let I = +v;
      if (!Number.isFinite(I)) I = 0;
      // Unbounded in theory; soft clamp at 100 for sanity. Past ~20 the
      // spectrum is effectively noise regardless of ratio.
      if (I >  100) I =  100;
      if (I < -100) I = -100;
      this._modIndex = I;
    } else if (id === 'amp') {
      this._amp = +v;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out;
    if (!out) return;
    const fm  = inputs && inputs.freqMod;
    const im  = inputs && inputs.idxMod;

    const sr       = this.sr;
    const carrier0 = this._carrierFreq;
    const ratio    = this._modRatio;
    const idx0     = this._modIndex;
    const amp      = this._amp;
    const nyq      = sr * 0.5;

    let phaseC = this._phaseC;
    let phaseM = this._phaseM;

    for (let n = 0; n < N; n++) {
      let fc = carrier0;
      if (fm) {
        fc += fm[n];
        if (!(fc > 0.01))      fc = 0.01;
        else if (fc > nyq - 1) fc = nyq - 1;
      }
      const fm_freq = fc * ratio;

      let I = idx0;
      if (im) I += im[n];

      // Modulator → carrier via Chowning's equation.
      const m = Math.sin(phaseM);
      out[n]  = amp * Math.sin(phaseC + I * m);

      // Advance phases, wrap into [0, 2π).
      phaseC += TWO_PI * fc      / sr;
      phaseM += TWO_PI * fm_freq / sr;
      if (phaseC >=  TWO_PI) phaseC -= TWO_PI;
      if (phaseC <  0)       phaseC += TWO_PI;
      if (phaseM >=  TWO_PI) phaseM -= TWO_PI;
      if (phaseM <  0)       phaseM += TWO_PI;
    }

    // Denormal flush (idle at zero freq shouldn't happen but cheap guard).
    if (Math.abs(phaseC) < DENORMAL) phaseC = 0;
    if (Math.abs(phaseM) < DENORMAL) phaseM = 0;

    this._phaseC = phaseC;
    this._phaseM = phaseM;
  }
}
