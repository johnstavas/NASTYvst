// op_blit.worklet.js — Stage-3 op sidecar for the `blit` op.
//
// Band-Limited Impulse Train (BLIT), closed-form DSF expression.
//
// PRIMARIES (synth-family ship rule = 2 minimum):
//
//   A. Stilson & Smith, "Alias-Free Digital Synthesis of Classic Analog
//      Waveforms", ICMC 1996, CCRMA. (stilti + jos @ ccrma).
//      §3.7 Eq. 3:
//          y(n) = (M/P) · Sinc_M[(M/P)·n]
//          Sinc_M(x) ≜ sin(π·x) / (M · sin(π·x/M))
//          M = 2·⌊P/2⌋ + 1   (largest odd integer ≤ P)
//          P = T₁/Tₛ = period in samples (may be fractional)
//
//   B. Gary Scavone / STK `Blit.h` tick() — original by Robin Davies 2005,
//      revised by Scavone 2005. STK BSD-family license (ships in STK).
//      Phase-driven form with wrap-at-π and singularity fallback to 1.0:
//          den = sin(phase)
//          if |den| <= eps:
//              out = 1.0
//          else:
//              out = sin(M · phase) / (M · den)
//          phase += π/P   ; if phase >= π: phase -= π
//
// Mapping A↔B: paper argument (π/P)·n ≡ STK phase; wrap-at-π is valid
// because M is odd → Sinc_M has period π in this argument.
//
// This v1 ships the raw bandlimited impulse train ("pulse" waveform).
// Saw / square / triangle via successive integration of BLIT (paper §4.1)
// are deliberately separate future ops — they need leaky-integrator state
// and a DC-offset compensator that varies with frequency.
//
// Contract:
//   - optional `freqMod` control input (Hz added to base freq)
//   - single AUDIO output `out`
//   - `reset()` restores phase = 0
//   - freq clamped to (0.01, sr/2 − 1) Hz. Below ~1 Hz the period P is
//     huge and M grows; above Nyquist M → 1 (bare sine fundamental).
//   - no denormals possible in the pulse output (bounded ±1).

const PI    = Math.PI;
const EPS   = 1e-12;          // STK uses FP epsilon; 1e-12 is safely below
                              // any legitimate sin(phase) near a peak.

export class BlitOp {
  static opId = 'blit';
  static inputs  = Object.freeze([{ id: 'freqMod', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',     kind: 'audio'   }]);
  static params  = Object.freeze([
    { id: 'freq', default: 440 },
    { id: 'amp',  default: 1   },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._freq   = 440;
    this._amp    = 1;
    this._phase  = 0;
    this._rate   = 0;
    this._M      = 1;
    this._updateCoefs();
  }

  _updateCoefs() {
    const nyq = this.sr * 0.5;
    let f = this._freq;
    if (!(f > 0.01))   f = 0.01;
    if (f > nyq - 1)   f = nyq - 1;
    const P = this.sr / f;                 // period in samples, fractional
    this._P    = P;
    this._M    = 2 * Math.floor(P * 0.5) + 1;  // largest odd integer ≤ P
    this._rate = PI / P;                   // phase increment per sample
  }

  reset() {
    this._phase = 0;
  }

  setParam(id, v) {
    switch (id) {
      case 'freq':
        this._freq = +v;
        this._updateCoefs();
        break;
      case 'amp':
        this._amp = +v;
        break;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out;
    if (!out) return;
    const fm  = inputs && inputs.freqMod;
    const amp = this._amp;

    let phase = this._phase;

    if (!fm) {
      // Constant-freq fast path — M and rate are cached.
      const M    = this._M;
      const rate = this._rate;
      for (let i = 0; i < N; i++) {
        const den = Math.sin(phase);
        let y;
        if (den <= EPS && den >= -EPS) {
          y = 1.0;                         // limit of Sinc_M at phase=0 (and π)
        } else {
          y = Math.sin(M * phase) / (M * den);
        }
        out[i] = y * amp;
        phase += rate;
        if (phase >= PI) phase -= PI;
      }
    } else {
      // FM path — per-sample P, M, rate. Paper notes (§3.8 "Exact BL vs.
      // some fall-off rate") that harmonic transitions during sweep are
      // audible; we accept that for v1. The BLIT-SWS windowed method would
      // fix it at higher cost — filed as debt.
      const baseF = this._freq;
      const nyq   = this.sr * 0.5;
      const sr    = this.sr;
      for (let i = 0; i < N; i++) {
        let f = baseF + fm[i];
        if (!(f > 0.01))      f = 0.01;
        else if (f > nyq - 1) f = nyq - 1;
        const P    = sr / f;
        const M    = 2 * Math.floor(P * 0.5) + 1;
        const rate = PI / P;
        const den = Math.sin(phase);
        let y;
        if (den <= EPS && den >= -EPS) {
          y = 1.0;
        } else {
          y = Math.sin(M * phase) / (M * den);
        }
        out[i] = y * amp;
        phase += rate;
        if (phase >= PI) phase -= PI;
      }
    }

    this._phase = phase;
  }
}
