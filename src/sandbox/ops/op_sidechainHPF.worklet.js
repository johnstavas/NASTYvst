// op_sidechainHPF.worklet.js — Stage-3 op sidecar for the `sidechainHPF` op.
//
// Catalog #44 (Dynamics). Sidechain high-pass filter. Fixed-mode HP biquad
// with optional 2nd-stage cascade (12→24 dB/oct). Purpose: pre-filter the
// detector feed of a gate / compressor / expander so bass rumble doesn't
// chatter the envelope while midrange content (kick punch, snare crack,
// sibilant frequencies) still triggers. Standard console dynamics topology
// since the 1970s (SSL channel's 60 Hz sidechain HP being the archetype).
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//
//   Robert Bristow-Johnson, "Cookbook formulae for audio EQ biquad filter
//   coefficients" (the "RBJ Audio EQ Cookbook"). Same text WebAudio's
//   createBiquadFilter cites internally.
//   Fetched 2026-04-24 via curl from musicdsp.org.
//   Local copy: C:/Users/HEAT2/Downloads/rbj_cookbook.txt
//
// PASSAGE VERBATIM (rbj_cookbook.txt lines 116–123):
//
//     HPF:        H(s) = s^2 / (s^2 + s/Q + 1)
//
//                 b0 =  (1 + cos(w0))/2
//                 b1 = -(1 + cos(w0))
//                 b2 =  (1 + cos(w0))/2
//                 a0 =   1 + alpha
//                 a1 =  -2*cos(w0)
//                 a2 =   1 - alpha
//
//   with (cookbook lines 73, 84):
//     w0    = 2*pi*f0/Fs
//     alpha = sin(w0) / (2*Q)
//
//   Direct Form 1 (cookbook line 38, Eq 4):
//     y[n] = (b0/a0)*x[n] + (b1/a0)*x[n-1] + (b2/a0)*x[n-2]
//                         - (a1/a0)*y[n-1] - (a2/a0)*y[n-2]
//
// RELATIONSHIP TO #2 `filter`:
//   The 1-stage path of this op is algebraically identical to #2 filter
//   with mode='hp'. The differentiator is (a) fixed-mode API (no enum
//   switch, smaller graph), (b) default cutoff tuned for sidechain use
//   (100 Hz), (c) optional 2-stage cascade for 24 dB/oct, which a single
//   #2 filter cannot provide. Cascading two #2 filter nodes is
//   functionally equivalent; this op saves one graph hop and exposes a
//   single `order` param.
//
// DEVIATIONS FROM PASSAGE (enumerated):
//   1. Cutoff clamped to [10, Nyq − 100] Hz before pre-warp. Matches the
//      in-tree #2 filter op's clamp. RBJ's passage assumes valid range.
//   2. Q clamped to [1e-3, 40]. Below 1e-3 alpha collapses; above ~40
//      resonance is self-oscillating under small coefficient quantisation.
//      Sidechain use typically needs Q=0.707 (flat Butterworth); high-Q is
//      exposed for surgical resonance peaks (de-esser sidechain shapes).
//   3. `order` param ∈ {1, 2}. order=1 is a single biquad (12 dB/oct).
//      order=2 cascades two identical biquads in series (24 dB/oct,
//      classic Linkwitz-Riley-style steeper slope — NOT an LR2 crossover;
//      just a cascaded -3dB-at-f0 biquad pair, which sums as −6 dB at f0).
//      For textbook Butterworth 24 dB/oct, users should instead cascade
//      two biquads with Q values {0.5412, 1.3066} (Butterworth-4 section
//      Qs) — that upgrade is tracked as debt.
//   4. Denormal flush on DF1 state (x1/x2/y1/y2) per repo convention.
//   5. Mono op. Stereo sidechains wrap in graph-level stereo pair.
//   6. No mix / dry-wet path. A sidechain HPF is an all-wet utility; the
//      dry-wet mix rule does not apply (no comb-filter risk — this op
//      emits the filtered feed, caller decides what to do with it).
//
// LATENCY: 0 samples.

const DENORMAL = 1e-30;

function flushDenormal(v) {
  return (v > -DENORMAL && v < DENORMAL) ? 0 : v;
}

export class SidechainHPFOp {
  static opId    = 'sidechainHPF';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'cutoff', default: 100 },   // [10, Nyq-100]
    { id: 'q',      default: 0.707 }, // [1e-3, 40]
    { id: 'order',  default: 1 },     // {1, 2}
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._cutoff = 100;
    this._q      = 0.707;
    this._order  = 1;
    // Stage-1 DF1 state
    this._x1a = 0; this._x2a = 0; this._y1a = 0; this._y2a = 0;
    // Stage-2 DF1 state (only used when order=2)
    this._x1b = 0; this._x2b = 0; this._y1b = 0; this._y2b = 0;
    // Normalised coefficients
    this._b0 = 1; this._b1 = 0; this._b2 = 0;
    this._a1 = 0; this._a2 = 0;
    this._recomputeCoefs();
  }

  reset() {
    this._x1a = this._x2a = this._y1a = this._y2a = 0;
    this._x1b = this._x2b = this._y1b = this._y2b = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (id === 'cutoff' && Number.isFinite(n)) this._cutoff = n;
    else if (id === 'q' && Number.isFinite(n)) this._q = n;
    else if (id === 'order' && Number.isFinite(n)) {
      this._order = (n | 0) === 2 ? 2 : 1;
    }
    this._recomputeCoefs();
  }

  getLatencySamples() { return 0; }

  // RBJ cookbook HPF — rbj_cookbook.txt L116-L123.
  _recomputeCoefs() {
    const sr     = this.sr;
    const nyq    = 0.5 * sr - 100;
    const f0     = Math.min(Math.max(this._cutoff, 10), nyq);
    const Q      = Math.min(Math.max(this._q, 1e-3), 40);
    const w0     = 2 * Math.PI * f0 / sr;
    const cosw0  = Math.cos(w0);
    const sinw0  = Math.sin(w0);
    const alpha  = sinw0 / (2 * Q);

    const b0 =  (1 + cosw0) * 0.5;
    const b1 = -(1 + cosw0);
    const b2 =  (1 + cosw0) * 0.5;
    const a0 =   1 + alpha;
    const a1 =  -2 * cosw0;
    const a2 =   1 - alpha;

    const inv_a0 = 1 / a0;
    this._b0 = b0 * inv_a0;
    this._b1 = b1 * inv_a0;
    this._b2 = b2 * inv_a0;
    this._a1 = a1 * inv_a0;
    this._a2 = a2 * inv_a0;
  }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;
    if (!inp) {
      for (let i = 0; i < N; i++) out[i] = 0;
      return;
    }

    const b0 = this._b0, b1 = this._b1, b2 = this._b2;
    const a1 = this._a1, a2 = this._a2;
    const order = this._order;

    let x1a = this._x1a, x2a = this._x2a, y1a = this._y1a, y2a = this._y2a;

    if (order === 1) {
      for (let i = 0; i < N; i++) {
        const x = inp[i];
        const y = b0 * x + b1 * x1a + b2 * x2a - a1 * y1a - a2 * y2a;
        x2a = x1a; x1a = x;
        y2a = y1a; y1a = flushDenormal(y);
        out[i] = y1a;
      }
    } else {
      let x1b = this._x1b, x2b = this._x2b, y1b = this._y1b, y2b = this._y2b;
      for (let i = 0; i < N; i++) {
        const x = inp[i];
        const s1 = b0 * x + b1 * x1a + b2 * x2a - a1 * y1a - a2 * y2a;
        x2a = x1a; x1a = x;
        y2a = y1a; y1a = flushDenormal(s1);
        const s2 = b0 * y1a + b1 * x1b + b2 * x2b - a1 * y1b - a2 * y2b;
        x2b = x1b; x1b = y1a;
        y2b = y1b; y1b = flushDenormal(s2);
        out[i] = y1b;
      }
      this._x1b = x1b; this._x2b = x2b; this._y1b = y1b; this._y2b = y2b;
    }

    this._x1a = x1a; this._x2a = x2a; this._y1a = y1a; this._y2a = y2a;
  }
}
