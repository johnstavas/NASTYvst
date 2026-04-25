// op_envelopeFollower.worklet.js — Catalog #61 (Dynamics family).
//
// Audio-rate envelope follower — peak or windowed-RMS detector with
// asymmetric attack/release smoothing (one-pole IIR, AR topology).
//
// PRIMARY (open, musicdsp.org archive, MIT-spirit public): Bram de Jong,
//   "Envelope follower with different attack and release", 2003-01-15
//   https://www.musicdsp.org/en/latest/Analysis/136-envelope-follower-with-different-attack-and-release.html
//
// VERBATIM code block:
//   init:
//     attack_coef  = exp(log(0.01) / (attack_ms  · samplerate · 0.001))
//     release_coef = exp(log(0.01) / (release_ms · samplerate · 0.001))
//     envelope = 0
//   loop:
//     tmp = fabs(in)
//     if (tmp > envelope) envelope = attack_coef  · (envelope − tmp) + tmp
//     else                envelope = release_coef · (envelope − tmp) + tmp
//
// Time constant interpretation (Bram's footnote, confirmed by 2007
// commenter): the *ms parameters are the time for the envelope to fall
// from 100 % to 1 % (−40 dB). This is ~4.6× faster than the e-folding
// (1/e ≈ 36.8 %) convention used by some other detectors (including
// this codebase's #4 envelope op — that op stays e-folding for control-
// rate modulation use; #61 uses Bram's −40 dB convention for sidechain-
// style dynamics use).
//
// DISTINCT FROM #4 envelope:
//   · #4 envelope:          control-rate output, amount/offset remap, e-folding τ.
//   · #61 envelopeFollower: audio-rate output, no remap, Bram's −40 dB τ,
//                           adds peak | RMS mode selector.
//
// MODES:
//   0 = peak — `tmp = |x|` (Bram's original)
//   1 = RMS  — `tmp = sqrt(meanSq)` where meanSq is 1-pole-smoothed x²;
//              the smoothing coefficient is `release_coef` (Zölzer DAFX
//              §4.2 style). Per-sample output, no window-buffer.
//
// PARAMS
//   attack  — attack time  [0.1, 1000] ms   default 5 ms
//   release — release time [1,   5000] ms   default 120 ms
//   mode    — 0=peak, 1=RMS                  default 0
//
// I/O
//   inputs:  in  (audio)
//   outputs: out (audio-rate envelope, linear magnitude, ≥ 0)
//
// STATE:
//   env       — envelope value (peak mode: |x| smoothed; RMS mode: √(x² smoothed))
//   meanSq    — smoothed x² (RMS mode only)
//
// DENORMAL: env is strictly ≥ 0 and the attack branch always writes
// `|x|` (floor = 0). Release branch asymptotes to 0 from above. No
// Watte bias needed here (denormals don't accumulate: the coefficient
// multiplies envelope-tmp which flushes as envelope → tmp from above).

export class EnvelopeFollowerOp {
  static opId = 'envelopeFollower';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'attack',  default: 5   },
    { id: 'release', default: 120 },
    { id: 'mode',    default: 0   },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._attack  = 5;
    this._release = 120;
    this._mode    = 0;
    this._env     = 0;
    this._meanSq  = 0;
    this._recompute();
  }

  _recompute() {
    // Bram de Jong (musicdsp #136): coef = exp(log(0.01) / (ms · sr · 0.001))
    const sr = this.sr;
    const atkMs = Math.max(0.1, this._attack);
    const relMs = Math.max(0.1, this._release);
    this._atkCoef = Math.exp(Math.log(0.01) / (atkMs * sr * 0.001));
    this._relCoef = Math.exp(Math.log(0.01) / (relMs * sr * 0.001));
  }

  reset() {
    this._env = 0;
    this._meanSq = 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'attack':  this._attack  = Math.max(0.1, Math.min(1000, v)); this._recompute(); break;
      case 'release': this._release = Math.max(1,   Math.min(5000, v)); this._recompute(); break;
      case 'mode':    this._mode    = Math.max(0,   Math.min(1,    v | 0));                break;
    }
  }

  process(inputs, outputs, N) {
    const inBuf = inputs && inputs.in ? inputs.in : null;
    const out   = outputs && outputs.out ? outputs.out : null;
    if (!out) return;
    if (!inBuf) { for (let n = 0; n < N; n++) out[n] = 0; this._env = 0; this._meanSq = 0; return; }

    const atk = this._atkCoef, rel = this._relCoef;
    let env = this._env, meanSq = this._meanSq;
    const isRms = this._mode === 1;

    for (let n = 0; n < N; n++) {
      const x = inBuf[n];
      let tmp;
      if (isRms) {
        // Smooth x² with the release coefficient (Zölzer DAFX §4.2 style).
        meanSq = rel * (meanSq - x * x) + x * x;
        if (meanSq < 0) meanSq = 0;
        tmp = Math.sqrt(meanSq);
      } else {
        tmp = x < 0 ? -x : x;
      }
      // Bram de Jong branch, unchanged:
      if (tmp > env) env = atk * (env - tmp) + tmp;
      else           env = rel * (env - tmp) + tmp;
      out[n] = env;
    }

    this._env = env;
    this._meanSq = meanSq;
  }

  getLatencySamples() { return 0; }
}
