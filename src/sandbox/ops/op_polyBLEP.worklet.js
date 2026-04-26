// op_polyBLEP.worklet.js — Stage-3 op sidecar for the `polyBLEP` op.
//
// Cheap polynomial bandlimited-step (polyBLEP) sawtooth oscillator. Companion
// to #82 minBLEP — same use-case (anti-aliased subtractive-synth saw) but
// a parabolic two-sample polynomial correction instead of a min-phase
// MinBLEP residual table. ~10 dB more aliasing than minBLEP at the same
// pitch but trivially per-voice scalable: no FFT, no event pool, no
// min-phase computation.
//
// PRIMARY (math-by-definition; widely-documented closed-form):
//   V. Välimäki and A. Huovilainen, "Antialiasing Oscillators in Subtractive
//   Synthesis," IEEE Signal Processing Magazine, vol. 24, no. 2, pp. 116-125,
//   March 2007 — §III.B "Polynomial Transition Region (polyBLEP)".
//   Companion: J. Pekonen, V. Välimäki, J. Nam, J. Smith, J. Abel, "Variable
//   Fractional Delay Filters in Bandlimited Oscillator Algorithms for Music
//   Synthesis," DAFx 2010 / IEEE TSPL — but the earlier IEEE-SPM 2007 §III.B
//   already gives the exact two-piece parabolic correction we use.
//
// CLOSED-FORM (verbatim from V-H 2007 §III.B):
//   For phase t ∈ [0, 1) and per-sample increment dt = f/SR (assume dt < 0.5
//   for no inter-sample aliasing within the polyBLEP window):
//
//     polyBLEP(t, dt) = ⎧  2p − p² − 1     if t < dt,        with p = t/dt
//                      ⎨  p² + 2p + 1     if t > 1 − dt,    with p = (t−1)/dt
//                      ⎩  0                otherwise
//
//   Sawtooth output (downward wrap at t=1):
//     saw_naive(t) = 2t − 1
//     saw(t)       = saw_naive(t) − polyBLEP(t, dt)
//
//   The correction has value −1 at t=0+ and +1 at t=(1−dt)+, smoothly
//   smearing the downward step across two samples. Spectrum: aliasing
//   suppressed by ~6th-order rolloff vs naive saw's 1st-order slope; not
//   as good as MinBLEP's full-band suppression but ~10–15 dB cleaner than
//   naive at musical pitches.
//
// AUTHORING SHAPE:
//   Inputs  : freqMod (control, optional — added to base freq for FM)
//   Outputs : out (audio)
//   Params  : freq (Hz, default 440), amp (0..4, default 1)
//
// State: phase ∈ [0, 1). Reset clears phase.

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

export class PolyBLEPOp {
  static opId = 'polyBLEP';
  static inputs  = Object.freeze([{ id: 'freqMod', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',     kind: 'audio'   }]);
  static params  = Object.freeze([
    { id: 'freq', default: 440 },
    { id: 'amp',  default: 1 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._freq = 440;
    this._amp = 1;
    this.phase = 0;
  }

  reset() { this.phase = 0; }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'freq': this._freq = clip(x, 0.01, 20000); break;
      case 'amp':  this._amp  = clip(x, 0,    4);     break;
    }
  }

  getLatencySamples() { return 0; }

  // Closed-form polyBLEP correction (Välimäki-Huovilainen 2007 §III.B).
  static _polyBLEP(t, dt) {
    if (t < dt) {
      const p = t / dt;
      return p + p - p * p - 1;       // 2p − p² − 1
    }
    if (t > 1 - dt) {
      const p = (t - 1) / dt;
      return p * p + p + p + 1;       // (p+1)² = p² + 2p + 1
    }
    return 0;
  }

  process(inputs, outputs, N) {
    const outCh = outputs.out;
    if (!outCh) return;
    const fm = inputs.freqMod;        // optional control — element-wise Hz offset
    const amp = this._amp;
    const baseFreq = this._freq;
    const sr = this.sr;
    const invSR = 1 / sr;
    let phase = this.phase;

    for (let i = 0; i < N; i++) {
      // Effective freq for this sample (base + optional FM).
      const fmod = fm ? fm[i] : 0;
      let f = baseFreq + (Number.isFinite(fmod) ? fmod : 0);
      if (f < 0) f = 0;                          // negative phase wrap is undefined for polyBLEP
      else if (f > sr * 0.49) f = sr * 0.49;     // guardrail just below Nyquist
      const dt = f * invSR;

      const saw_naive = 2 * phase - 1;
      const blep = PolyBLEPOp._polyBLEP(phase, dt);
      outCh[i] = amp * (saw_naive - blep);

      phase += dt;
      if (phase >= 1) phase -= 1;                // single-step wrap (dt < 0.5 guaranteed)
    }
    this.phase = phase;
  }
}
