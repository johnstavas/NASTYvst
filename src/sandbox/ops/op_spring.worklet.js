// op_spring.worklet.js — Catalog #109 (Space family).
//
// Parametric spring reverberation per Parker 2011 §2 (EURASIP JASP
// "Efficient Dispersion Generation Structures for Spring Reverb
// Emulation", which recaps Välimäki, Parker & Abel 2010 JAES structure
// verbatim). v1 implements the *plain* two-loop structure (Fig. 1 +
// Figs. 2, 3), not §3's multirate chirp-straightening optimisation
// (debt row #1 — CPU concern, not a sound concern).
//
// PRIMARY SOURCE (§2, eqns 1–4, Figs. 1–3)
//
//   A(z)        = (a + z^-1) / (1 + a·z^-1)                   (1)
//   H_single(z) = A(z^k)   = (a + z^-k) / (1 + a·z^-k)        (2)
//   H_cascade   = A^M(z^k) = ((a + z^-k)/(1 + a·z^-k))^M       (3)
//   D           = k·M · (1−a²) / (1 + 2a·cos(ωk) + a²)         (4)
//
//   Structure = two parallel feedback loops:
//     C_lf (Fig.2): feedback sum (x − g_lf·delay_read) → A^M(z^k_lf) →
//                   H_low(z) → output; delay line in FB. Dispersive
//                   chirps below f_C (the "transition frequency").
//     C_hf (Fig.3): feedback sum → A^M(z^k_hf) → output; no lowpass,
//                   short stretch — wideband low-amplitude chirps.
//   Figure 1: output = a_dry·dry + a_high·C_hf + a_low·C_lf.
//
// DESIGN CHOICES
//
//   • Stretched allpass implemented as v[n] = x[n] − a·v[n−k],
//     y[n] = a·v[n] + v[n−k]. One delay line of length k per stage,
//     M stages per branch — memory M·k floats per branch.
//   • MVP values keep M small (≤ 40) for real-time: compute budget
//     is O(M·2) multiplies per sample per branch.
//   • H_low on C_lf branch is a 1-pole lowpass at f_C (transitionHz).
//   • Delay line length sets echo period (chirp repetition rate).
//     Scaled by sampleRate so character is sr-independent.
//   • Cross-coupling between loops (Välimäki [7] mentioned in Parker
//     §2) is NOT implemented in v1 — debt row #2.
//   • Delay-line random modulation (Välimäki [7]) NOT implemented —
//     debt row #3. Spring chirps will sound slightly "frozen" in v1.
//
// PARAMS
//
//   decay        — feedback gain on both loops                 0..0.95
//   dispersion   — stretched-AP coefficient |a|, magnitude    0..0.9
//   transitionHz — f_C, lowpass on C_lf branch                1 k..10 k
//   chirpRate    — delay-line length multiplier (spacing)      0.3..3
//   numStagesLF  — M for C_lf  (more = longer chirp)          4..60
//   numStagesHF  — M for C_hf                                  2..40
//   mixLF        — C_lf output gain                            0..1
//   mixHF        — C_hf output gain                            0..1

const TAU = Math.PI * 2;

// Stretched allpass cascade — M stages, each with its own delay line of
// length k. Expensive but clean. y[n] = a·v[n] + v[n−k], v[n] = x[n] − a·v[n−k].
class StretchedAPCascade {
  constructor(maxK, maxM) {
    this.maxK = maxK;
    this.maxM = maxM;
    // One circular buffer per stage. All sized to maxK for flexibility.
    let sz = 1; while (sz < maxK + 2) sz <<= 1;
    this.sz   = sz;
    this.mask = sz - 1;
    this.buf  = new Float32Array(maxM * sz);
    this.w    = 0;                       // shared write head across stages
    this.M    = maxM;
    this.k    = maxK;
    this.a    = 0.0;
  }
  reset() { this.buf.fill(0); this.w = 0; }
  setConfig(M, k, a) {
    this.M = Math.max(0, Math.min(this.maxM, M|0));
    this.k = Math.max(1, Math.min(this.maxK, k|0));
    this.a = Math.max(-0.95, Math.min(0.95, a));
  }
  process(x) {
    const k = this.k, a = this.a, sz = this.sz, mask = this.mask, buf = this.buf;
    const wRead = (this.w - k) & mask;
    let y = x;
    for (let s = 0; s < this.M; s++) {
      const base = s * sz;
      const d = buf[base + wRead];
      const v = y - a * d;
      buf[base + this.w] = v;
      y = a * v + d;
    }
    this.w = (this.w + 1) & mask;
    return y;
  }
}

// Simple circular delay with integer read-before-write.
class Delay {
  constructor(maxLen) {
    let sz = 1; while (sz < maxLen + 2) sz <<= 1;
    this.buf  = new Float32Array(sz);
    this.mask = sz - 1;
    this.w    = 0;
  }
  reset() { this.buf.fill(0); this.w = 0; }
  readInt(d) { return this.buf[(this.w - d) & this.mask]; }
  write(x)   { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
}

// k for the stretched AP branches — chosen to land the group-delay peak
// in the musical band per eq.(4). C_lf uses long k (spring body); C_hf
// uses k=1 (native AP rate).
const K_LF_BASE = 40;   // tuned for ~4 kHz peak with a ≈ 0.65 at 48 kHz
const K_HF      = 1;

export class SpringOp {
  static opId   = 'spring';
  static inputs  = [{ id: 'in',  kind: 'audio' }];
  static outputs = [{ id: 'l',   kind: 'audio' }, { id: 'r', kind: 'audio' }];
  static params = [
    { id: 'decay',        default: 0.7 },
    { id: 'dispersion',   default: 0.65 },
    { id: 'transitionHz', default: 4300 },
    { id: 'chirpRate',    default: 1.0 },
    { id: 'numStagesLF',  default: 30 },
    { id: 'numStagesHF',  default: 12 },
    { id: 'mixLF',        default: 1.0 },
    { id: 'mixHF',        default: 0.3 },
  ];

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;

    // Max resource bounds — these decide memory footprint up front.
    this.MAX_M_LF = 60;
    this.MAX_M_HF = 40;
    this.MAX_K_LF = 120;

    this.apLF = new StretchedAPCascade(this.MAX_K_LF, this.MAX_M_LF);
    this.apHF = new StretchedAPCascade(2,             this.MAX_M_HF);

    // Delay lines: feedback echo period. At 48 kHz ~50 ms = 2400 samples.
    // Use two slightly different lengths to decorrelate L vs R.
    this.delayL = new Delay(Math.ceil(sampleRate * 0.12));
    this.delayR = new Delay(Math.ceil(sampleRate * 0.12));
    this.lenL   = Math.max(1, Math.round(0.055 * sampleRate));
    this.lenR   = Math.max(1, Math.round(0.061 * sampleRate));

    // Lowpass state for C_lf (1-pole).
    this.lpZ = 0;

    // Params.
    this._decay        = 0.7;
    this._dispersion   = 0.65;
    this._transitionHz = 4300;
    this._chirpRate    = 1.0;
    this._mLF          = 30;
    this._mHF          = 12;
    this._mixLF        = 1.0;
    this._mixHF        = 0.3;

    this._recompute();
  }

  reset() {
    this.apLF.reset();
    this.apHF.reset();
    this.delayL.reset();
    this.delayR.reset();
    this.lpZ = 0;
  }

  _recompute() {
    const k_lf = Math.max(1, Math.min(this.MAX_K_LF,
      Math.round(K_LF_BASE * this._chirpRate)));
    // Paper eq.(1)/(3): a in [−1, 1]. v1 uses positive a for C_lf (puts
    // group-delay peak above DC per §3) and negative a for C_hf.
    this.apLF.setConfig(this._mLF, k_lf,  this._dispersion);
    this.apHF.setConfig(this._mHF, K_HF, -this._dispersion);

    this.lenL = Math.max(1, Math.round(0.055 * this.sr * this._chirpRate));
    this.lenR = Math.max(1, Math.round(0.061 * this.sr * this._chirpRate));
    // Cap at buffer size.
    const cap = Math.floor(this.delayL.buf.length * 0.8);
    if (this.lenL > cap) this.lenL = cap;
    if (this.lenR > cap) this.lenR = cap;

    // 1-pole lowpass coef for H_low on C_lf.
    const fc = Math.max(200, Math.min(this.sr * 0.45, this._transitionHz));
    this.lpA = Math.exp(-TAU * fc / this.sr);   // 1-pole pole
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'decay':        this._decay        = Math.max(0,    Math.min(0.95, v)); break;
      case 'dispersion':   this._dispersion   = Math.max(0,    Math.min(0.9,  v)); this._recompute(); break;
      case 'transitionHz': this._transitionHz = Math.max(500,  Math.min(12000, v)); this._recompute(); break;
      case 'chirpRate':    this._chirpRate    = Math.max(0.3,  Math.min(3,    v)); this._recompute(); break;
      case 'numStagesLF':  this._mLF          = Math.max(0,    Math.min(this.MAX_M_LF, v|0)); this._recompute(); break;
      case 'numStagesHF':  this._mHF          = Math.max(0,    Math.min(this.MAX_M_HF, v|0)); this._recompute(); break;
      case 'mixLF':        this._mixLF        = Math.max(0,    Math.min(1,    v)); break;
      case 'mixHF':        this._mixHF        = Math.max(0,    Math.min(1,    v)); break;
    }
  }

  process(inputs, outputs, N) {
    const inp  = inputs && inputs.in ? inputs.in : null;
    const outL = outputs && outputs.l ? outputs.l : null;
    const outR = outputs && outputs.r ? outputs.r : null;
    if (!outL && !outR) return;

    const g      = this._decay;
    const mixLF  = this._mixLF;
    const mixHF  = this._mixHF;
    const lpA    = this.lpA;
    const lenL   = this.lenL;
    const lenR   = this.lenR;

    for (let n = 0; n < N; n++) {
      const x = inp ? inp[n] : 0;

      // ---- C_lf branch → left output ----
      const fbL = this.delayL.readInt(lenL);
      // Fig.2: sum → A^M(z^k_lf) → H_low → output; delay in FB path.
      let vL = this.apLF.process(x - g * fbL);
      // H_low (1-pole, y = (1-a)x + a·y_prev).
      this.lpZ = (1 - lpA) * vL + lpA * this.lpZ;
      vL = this.lpZ;
      this.delayL.write(vL);

      // ---- C_hf branch → right output ----
      const fbR = this.delayR.readInt(lenR);
      // Fig.3: sum → A^M(z) → output; no lowpass.
      const vR = this.apHF.process(x - g * fbR);
      this.delayR.write(vR);

      // Output mix — Fig.1 shows C_hf + C_lf (+ dry). v1 ships wet-only
      // per the mix-inside-worklet rule; caller does dry.
      // Left = C_lf-dominant, right = C_hf-dominant with the opposite
      // branch bled in for width.
      const yL = mixLF * vL + 0.3 * mixHF * vR;
      const yR = mixHF * vR + 0.3 * mixLF * vL;

      if (outL) outL[n] = yL;
      if (outR) outR[n] = yR;
    }
  }

  getLatencySamples() { return 0; }
}
