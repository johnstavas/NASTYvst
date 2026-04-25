// op_schroederChain.worklet.js — Catalog #107 (Space family).
//
// Schroeder 1962 reverberator — "Natural Sounding Artificial Reverberation",
// JAES 1962. The "forgotten algorithm" (Sean Costello / Valhalla DSP, 2009):
// 4 parallel feedback comb filters summed, then fed through 2 cascaded
// allpass filters. Historically the FIRST digital reverberator and the
// ancestor of everything downstream (plate #108, spring #109, SDN #110,
// fdnCore #20 all trace their lineage to this topology).
//
// PRIMARY-SOURCE PASSAGES (quoted verbatim in chat at ship time)
//
//   • JOS PASP "Schroeder Reverberators":
//       "A series connection of several allpass filters" after "A parallel
//       bank of feedback comb filters".
//       Allpass example: "when g = 0.708 in Eq.(3.2), the time to decay
//       60 dB (t₆₀) would be 2 seconds" for 100 ms allpass.
//
//   • STK JCRev.cpp (Cook/Scavone 1995–2023, "derived from CLM JCRev"):
//       delays @ 44.1 kHz = {1116, 1356, 1422, 1617, 225, 341, 441, 211, 179};
//       allpassCoefficient_ = 0.7.
//
//   • Schroeder 1962 JAES values (canonical, Valhalla DSP recap):
//       4 parallel comb delays 29.7, 37.1, 41.1, 43.7 ms; gain from T60.
//       2 cascaded allpass delays 5.0, 1.7 ms; allpass g = 0.7.
//       (Valhalla summary quotes 29/37/41/44 ms with g_comb=0.9; we use
//       the more commonly-cited non-integer ms values for better echo-
//       density texture.)
//
//   • Comb-gain / T60 relation (textbook):
//       T60 = 3τ / log10(1/g)  ⇒  g = 10^(−3τ / T60)
//
// DESIGN CHOICES (v1)
//
//   • 4 combs + 2 allpasses — pure Schroeder 1962 topology. Not Freeverb
//     (8+4 with damping) and not JCRev (4+3 with LPF). Those are siblings,
//     not this op. If we want Freeverb or JCRev flavours they ship as
//     separate ops.
//   • Per-comb g derived from rt60 param via Schroeder's T60 formula.
//   • Optional one-pole LPF inside each comb's feedback path (Moorer 1979
//     extension) gated by `damping` param. damping=0 disables — pure
//     Schroeder 1962 behaviour. damping>0 darkens tail (Schroeder-Moorer).
//   • Allpass g fixed at 0.7 (JOS/STK value; Valhalla cites 0.8 — we split
//     the difference by using 0.7 as the published reference point).
//   • Stereo synthesis: second set of comb lengths offset by `spread`
//     samples (Freeverb `stereospread = 23` precedent). Single graph run
//     twice per sample with independent delay reads = N/2 density, but
//     we keep it as two independent parallel banks for proper L/R decorr.
//   • `size` scales all delay lengths. Delays floor to integer samples.
//
// PARAMS
//
//   rt60     — reverb time in seconds (0.1..10)  →  per-comb g via formula
//   damping  — HF absorption in comb FB (0..1)   →  1-pole LP coef
//   size     — delay-length scale (0.3..2)        →  scales all 6 delays
//   spread   — L/R decorrelation in samples (0..40)
//
// PORTS
//   in (audio) → l, r (audio)

// Schroeder 1962 canonical delay values in milliseconds.
const COMB_MS_L     = [29.7, 37.1, 41.1, 43.7];
const ALLPASS_MS    = [5.0, 1.7];   // 2 in series
const ALLPASS_G     = 0.7;          // JOS/STK reference value

function nextPow2(n) { let p = 1; while (p < n + 2) p <<= 1; return p; }

class Comb {
  constructor(maxLen) {
    const sz = nextPow2(maxLen);
    this.buf = new Float32Array(sz);
    this.mask = sz - 1;
    this.w = 0;
    this.len = 1;
    this.g = 0.7;
    this.damp = 0;         // 1-pole LP coef in FB
    this.z = 0;            // LP state
  }
  setLen(len) { this.len = Math.max(1, Math.min(this.mask - 1, len | 0)); }
  setG(g)     { this.g = Math.max(0, Math.min(0.99, g)); }
  setDamp(d)  { this.damp = Math.max(0, Math.min(0.95, d)); }
  reset()     { this.buf.fill(0); this.w = 0; this.z = 0; }
  process(x) {
    const rd = (this.w - this.len) & this.mask;
    const y  = this.buf[rd];
    // One-pole LP on the delayed signal inside the feedback path.
    // y_lp = (1-damp)*y + damp*z   — Moorer 1979 extension.
    const yLp = (1 - this.damp) * y + this.damp * this.z;
    this.z = yLp;
    this.buf[this.w] = x + this.g * yLp;
    this.w = (this.w + 1) & this.mask;
    return y;
  }
}

class Allpass {
  constructor(maxLen) {
    const sz = nextPow2(maxLen);
    this.buf = new Float32Array(sz);
    this.mask = sz - 1;
    this.w = 0;
    this.len = 1;
    this.g = ALLPASS_G;
  }
  setLen(len) { this.len = Math.max(1, Math.min(this.mask - 1, len | 0)); }
  reset() { this.buf.fill(0); this.w = 0; }
  process(x) {
    // Schroeder allpass, 1-multiply transposed form:
    //   v[n]   = x[n] + g·v[n-M]
    //   y[n]   = -g·v[n] + v[n-M]
    // equivalent bit-exact to the (x - g·d); (g·v + d) form used elsewhere.
    const rd = (this.w - this.len) & this.mask;
    const d  = this.buf[rd];
    const v  = x - this.g * d;         // v[n] with rewrite: v = x - g·d
    this.buf[this.w] = v;
    this.w = (this.w + 1) & this.mask;
    return this.g * v + d;
  }
}

export class SchroederChainOp {
  static opId   = 'schroederChain';
  static inputs = [{ id: 'in', kind: 'audio' }];
  static outputs = [
    { id: 'l', kind: 'audio' },
    { id: 'r', kind: 'audio' },
  ];
  static params = [
    { id: 'rt60',    default: 2.0 },
    { id: 'damping', default: 0.0 },
    { id: 'size',    default: 1.0 },
    { id: 'spread',  default: 23 },
  ];

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this.p_rt60    = 2.0;
    this.p_damping = 0.0;
    this.p_size    = 1.0;
    this.p_spread  = 23;

    // Max delay = max(COMB_MS_L) * maxSize * sr/1000 + maxSpread + slack
    const maxSamps = Math.ceil(44 * 2.0 * this.sr / 1000) + 64;
    this.combsL = COMB_MS_L.map(() => new Comb(maxSamps));
    this.combsR = COMB_MS_L.map(() => new Comb(maxSamps));
    const maxAP = Math.ceil(6 * 2.0 * this.sr / 1000) + 16;
    this.apsL = ALLPASS_MS.map(() => new Allpass(maxAP));
    this.apsR = ALLPASS_MS.map(() => new Allpass(maxAP));
    this.recompute();
  }

  recompute() {
    const size = Math.max(0.3, Math.min(2, this.p_size));
    const rt60 = Math.max(0.1, Math.min(10, this.p_rt60));
    const damp = Math.max(0, Math.min(0.95, this.p_damping));
    const sprd = Math.max(0, Math.min(40, this.p_spread | 0));

    for (let i = 0; i < 4; i++) {
      const tauMs = COMB_MS_L[i] * size;
      const tau   = tauMs / 1000.0;                           // seconds
      // Schroeder: T60 = 3τ / log10(1/g)  ⇒  g = 10^(−3τ/T60).
      const g = Math.pow(10, -3 * tau / rt60);
      const lenL = Math.round(this.sr * tau);
      const lenR = lenL + sprd;                               // Freeverb-style decorr
      this.combsL[i].setLen(lenL); this.combsL[i].setG(g); this.combsL[i].setDamp(damp);
      this.combsR[i].setLen(lenR); this.combsR[i].setG(g); this.combsR[i].setDamp(damp);
    }
    for (let i = 0; i < 2; i++) {
      const tau  = (ALLPASS_MS[i] * size) / 1000.0;
      const lenL = Math.round(this.sr * tau);
      const lenR = lenL + Math.min(sprd, 7);                  // smaller spread on APs
      this.apsL[i].setLen(lenL);
      this.apsR[i].setLen(lenR);
    }
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'rt60':    this.p_rt60    = Math.max(0.1, Math.min(10, v)); this.recompute(); break;
      case 'damping': this.p_damping = Math.max(0,   Math.min(0.95, v)); this.recompute(); break;
      case 'size':    this.p_size    = Math.max(0.3, Math.min(2,  v)); this.recompute(); break;
      case 'spread':  this.p_spread  = Math.max(0,   Math.min(40, v)); this.recompute(); break;
    }
  }

  reset() {
    for (const c of this.combsL) c.reset();
    for (const c of this.combsR) c.reset();
    for (const a of this.apsL)   a.reset();
    for (const a of this.apsR)   a.reset();
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inBuf = inputs && inputs.in ? inputs.in : null;
    const outL  = outputs && outputs.l ? outputs.l : null;
    const outR  = outputs && outputs.r ? outputs.r : null;
    if (!outL && !outR) return;
    if (!inBuf) {
      if (outL) outL.fill(0);
      if (outR) outR.fill(0);
      return;
    }

    const combsL = this.combsL, combsR = this.combsR;
    const apsL   = this.apsL,   apsR   = this.apsR;

    for (let n = 0; n < N; n++) {
      const x = inBuf[n];
      // 4 parallel combs, sum their outputs. Schroeder 1962 Fig. 1.
      const sL = combsL[0].process(x) + combsL[1].process(x)
               + combsL[2].process(x) + combsL[3].process(x);
      const sR = combsR[0].process(x) + combsR[1].process(x)
               + combsR[2].process(x) + combsR[3].process(x);
      // 2 series allpasses.
      const aL = apsL[1].process(apsL[0].process(sL));
      const aR = apsR[1].process(apsR[0].process(sR));
      // 1/N comb-count normalisation for unity-ish peak.
      if (outL) outL[n] = 0.25 * aL;
      if (outR) outR[n] = 0.25 * aR;
    }
  }
}
