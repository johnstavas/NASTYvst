// op_crossfeed.worklet.js — Catalog #118 (Spatial family).
//
// Headphone crossfeed — Bauer 1961 stereophonic-to-binaural DSP.
//
// PRIMARY (open source, MIT): libbs2b v3.1.0 core,
//   https://raw.githubusercontent.com/DeaDBeeF-Player/bs2b/master/libbs2b-3.1.0/src/bs2b.c
//   init()        L131–L181   coefficient calculation
//   lo_filter /hi_filter  L186–L192   one-pole macros
//   cross_feed_d  L194–L215   per-sample topology
//
// Boris Mikhaylov's libbs2b is the canonical open implementation of the Bauer
// 1961 "Stereophonic Earphones and Binaural Loudspeakers" concept (JAES 9(2),
// paywalled — secondary: bs2b's own coefficient math is the open reference).
// Port is verbatim from the C code; comments mark the few places where the
// port diverges from the reference.
//
// TOPOLOGY per sample (stereo in → stereo out):
//   lo[ch]   = a0_lo·in[ch] + b1_lo·lo[ch]                (one-pole LP)
//   hi[ch]   = a0_hi·in[ch] + a1_hi·asis[ch] + b1_hi·hi[ch] (one-pole high-shelf)
//   asis[ch] = in[ch]                                      (z^-1 register)
//   L_out    = (hi[L] + lo[R]) · gain                      (cross-feed sum)
//   R_out    = (hi[R] + lo[L]) · gain
//
// COEFFICIENTS (bs2b.c L143–L181, verbatim):
//   level_dB = feed         // user gives dB directly
//   GB_lo   = level · -5/6 − 3                       (dB)
//   GB_hi   = level / 6 − 3                          (dB)
//   G_lo    = 10^(GB_lo/20)                          (linear)
//   G_hi    = 1 − 10^(GB_hi/20)                      (linear, "subtractor")
//   Fc_hi   = Fc_lo · 2^((GB_lo − 20·log10(G_hi))/12)   (Hz)
//   x_lo    = exp(−2π·Fc_lo/sr);   b1_lo = x_lo; a0_lo = G_lo·(1−x_lo)
//   x_hi    = exp(−2π·Fc_hi/sr);   b1_hi = x_hi;
//                                  a0_hi = 1 − G_hi·(1−x_hi); a1_hi = −x_hi
//   gain    = 1 / (1 − G_hi + G_lo)         // bass-boost compensates allpass loss
//
// PRESETS (libbs2b defaults):
//   Default  fcut=700 Hz, feed=4.5 dB
//   Chu Moy  fcut=700 Hz, feed=6.0 dB
//   Jan Meier fcut=650 Hz, feed=9.5 dB
//
// PARAMS
//   fcut  — lowpass cutoff (Hz)   [300, 2000]  default 700
//   feed  — crossfeed level (dB)  [1, 15]      default 4.5
//
// I/O
//   inputs:  in (audio, L), in2 (audio, R)
//   outputs: l (audio), r (audio)
//
// NOT in scope (research debt):
//   · ITD (interaural time delay, ~200 µs) — bs2b omits this deliberately
//     for CPU; Meier variants add a Thiran allpass. See debt row.
//   · HRTF-based crossfeed (SOFA file ingestion) — whole-class upgrade.
//   · Preset enum — shipped as raw fcut+feed; wrap as preset sugar later.

export class CrossfeedOp {
  static opId = 'crossfeed';
  static inputs = Object.freeze([
    { id: 'in',  kind: 'audio' },
    { id: 'in2', kind: 'audio' },
  ]);
  static outputs = Object.freeze([
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ]);
  static params = Object.freeze([
    { id: 'fcut', default: 700 },
    { id: 'feed', default: 4.5 },
  ]);

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._fcut = 700;
    this._feed = 4.5;
    // state
    this._loL = 0; this._loR = 0;
    this._hiL = 0; this._hiR = 0;
    this._asL = 0; this._asR = 0;
    // coeffs
    this._recomputeCoeffs();
  }

  _recomputeCoeffs() {
    const Fc_lo = this._fcut;
    const level = this._feed;
    const GB_lo = level * -5 / 6 - 3;
    const GB_hi = level /  6      - 3;
    const G_lo = Math.pow(10, GB_lo / 20);
    const G_hi = 1 - Math.pow(10, GB_hi / 20);
    const Fc_hi = Fc_lo * Math.pow(2, (GB_lo - 20 * Math.log10(G_hi)) / 12);

    let x = Math.exp(-2 * Math.PI * Fc_lo / this.sr);
    this._b1_lo = x;
    this._a0_lo = G_lo * (1 - x);

    x = Math.exp(-2 * Math.PI * Fc_hi / this.sr);
    this._b1_hi = x;
    this._a0_hi = 1 - G_hi * (1 - x);
    this._a1_hi = -x;

    this._gain  = 1 / (1 - G_hi + G_lo);
  }

  reset() {
    this._loL = this._loR = 0;
    this._hiL = this._hiR = 0;
    this._asL = this._asR = 0;
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'fcut': this._fcut = Math.max(300, Math.min(2000, v)); this._recomputeCoeffs(); break;
      case 'feed': this._feed = Math.max(1,   Math.min(15,   v)); this._recomputeCoeffs(); break;
    }
  }

  process(inputs, outputs, N) {
    const inL = inputs && inputs.in  ? inputs.in  : null;
    const inR = inputs && inputs.in2 ? inputs.in2 : null;
    const lOut = outputs && outputs.l ? outputs.l : null;
    const rOut = outputs && outputs.r ? outputs.r : null;
    if (!lOut && !rOut) return;

    const a0_lo = this._a0_lo, b1_lo = this._b1_lo;
    const a0_hi = this._a0_hi, a1_hi = this._a1_hi, b1_hi = this._b1_hi;
    const gain  = this._gain;

    let loL = this._loL, loR = this._loR;
    let hiL = this._hiL, hiR = this._hiR;
    let asL = this._asL, asR = this._asR;

    for (let n = 0; n < N; n++) {
      const xL = inL ? inL[n] : 0;
      const xR = inR ? inR[n] : 0;

      loL = a0_lo * xL + b1_lo * loL;
      loR = a0_lo * xR + b1_lo * loR;
      hiL = a0_hi * xL + a1_hi * asL + b1_hi * hiL;
      hiR = a0_hi * xR + a1_hi * asR + b1_hi * hiR;
      asL = xL; asR = xR;

      if (lOut) lOut[n] = (hiL + loR) * gain;
      if (rOut) rOut[n] = (hiR + loL) * gain;
    }

    this._loL = loL; this._loR = loR;
    this._hiL = hiL; this._hiR = hiR;
    this._asL = asL; this._asR = asR;
  }

  getLatencySamples() { return 0; }
}
