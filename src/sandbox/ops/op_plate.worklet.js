// op_plate.worklet.js — Catalog #108 (Space family).
//
// Dattorro 1997 JAES "Effect Design Part 1: Reverberator" plate-class
// topology, faithful to Fig. 1 and Table 2. Sample-count constants are
// verbatim from the paper (calibrated for Fs=29761 Hz); we scale by
// sr/29761 at construction time.
//
// PRIMARY SOURCE (pp. 662–665):
//
//   Input chain  — predelay · 1-pole bandwidth LPF
//   Input diff.  — 4 serial 2-multiplier allpasses:
//                    142, 107 samples   (coef = input diffusion 1 = 0.750)
//                    379, 277 samples   (coef = input diffusion 2 = 0.625)
//   Tank (figure-eight), left half:
//     modulated allpass (672 + EXCURSION), coef = −(decay diffusion 1) = −0.70
//     delay 4453
//     damping 1-pole LPF · × decay
//     allpass 1800, coef = decay diffusion 2 = decay + 0.15 (floor 0.25, ceil 0.50)
//     delay 3720 · × decay → right half
//   Tank, right half:
//     modulated allpass (908 + EXCURSION), coef = −(decay diffusion 1) = −0.70
//     delay 4217
//     damping · × decay
//     allpass 2656, coef = decay diffusion 2
//     delay 3163 · × decay → left half
//
//   EXCURSION = 16 samples peak (≈8 samples half-excursion) at ~1 Hz.
//
//   Stereo input is collapsed to mono at the predelay: x = 0.5·(xL + xR).
//   Output taps (all wet) per Table 2 — 7 taps per side, alternating sign,
//   all scaled by 0.6, sampled from both tanks' delay lines.
//
// DESIGN NOTES
//
//   • Delay lengths scale linearly with sr: k = sr/29761; len_i = round(base_i · k).
//   • Modulation uses linear interpolation on the tank modulated allpasses
//     (Dattorro §1.3.7 — low-pass artifact is accepted as "uncounted damping"
//     for MVP; allpass interpolation is a future debt row).
//   • Damping: y[n] = (1 − damping)·x[n] + damping·y[n − 1] (1-pole LPF).
//     Coef is the paper's "damping" param (0 = no damping; 1 = fully damped).
//   • Bandwidth: same 1-pole form on the input, coef = bandwidth (default 0.9999999).
//   • DC-trap inside the tank is NOT added by this op — compose dcBlock
//     externally on the returning tank taps if the FB runs near 1.0.
//
// PARAMS
//
//   decay      — tank decay multiplier      (Table 1 "decay"),        0..0.99
//   predelayMs — pre-tank delay (pre input diff.)                     0..200 ms
//   bandwidth  — input LPF coef                                       0..1
//   damping    — tank LPF coef (HF damping)                           0..0.99
//   size       — uniform scale factor on all delay lengths            0.5..1.5
//   modDepth   — modulated-allpass excursion (samples peak)           0..32
//   modRateHz  — LFO rate                                             0.1..5 Hz
//
// OUTPUTS: stereo (l, r) wet-only. Mix externally per dry/wet rule.

const SR_REF = 29761;   // Dattorro's reference sample rate
const TAU = Math.PI * 2;

// Simple writeable delay line with linear-interp read by fractional sample
// offset (0 = most recent write). Size = nextPow2(maxLen).
class Line {
  constructor(maxLen) {
    let n = 1; while (n < maxLen + 2) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
    this.w = 0;
  }
  reset() { this.buf.fill(0); this.w = 0; }
  write(x) { this.buf[this.w] = x; this.w = (this.w + 1) & this.mask; }
  // read integer `d` samples ago (d >= 1 recommended).
  readInt(d) { return this.buf[(this.w - d) & this.mask]; }
  // read fractional samples ago with linear interp.
  readFrac(d) {
    const i = Math.floor(d);
    const f = d - i;
    const a = this.buf[(this.w - i)     & this.mask];
    const b = this.buf[(this.w - i - 1) & this.mask];
    return a + (b - a) * f;
  }
}

// 2-multiplier allpass lattice — Dattorro §1.3.3.
//   y[n] = -g · x[n] + z^-M (x[n] + g · y[n])
// Here implemented with one delay line of length M and one-sample state.
function processAllpass(line, M, g, x) {
  const d = line.readInt(M);
  const v = x + g * d;
  line.write(v);
  return d - g * v;
}

export class PlateOp {
  static opId = 'plate';
  static inputs  = [{ id: 'l', kind: 'audio' }, { id: 'r', kind: 'audio' }];
  static outputs = [{ id: 'l', kind: 'audio' }, { id: 'r', kind: 'audio' }];
  static params = [
    { id: 'decay',      default: 0.5 },
    { id: 'predelayMs', default: 0 },
    { id: 'bandwidth',  default: 0.9999 },
    { id: 'damping',    default: 0.0005 },
    { id: 'size',       default: 1.0 },
    { id: 'modDepth',   default: 16 },
    { id: 'modRateHz',  default: 1.0 },
  ];

  constructor(sampleRate = 48000) {
    this.sr = sampleRate;
    this._decay     = 0.5;
    this._predelayMs = 0;
    this._bandwidth = 0.9999;
    this._damping   = 0.0005;
    this._size      = 1.0;
    this._modDepth  = 16;
    this._modRateHz = 1.0;

    // Build all lines sized for max size=1.5. Values are Dattorro's verbatim.
    const k = (sampleRate / SR_REF) * 1.5;
    this.preMax = Math.ceil(sampleRate * 0.2) + 8;  // 200 ms
    this.pre    = new Line(this.preMax);

    // Input diffusion: 142, 107, 379, 277
    this.id1a = new Line(Math.ceil(142 * k) + 4);
    this.id1b = new Line(Math.ceil(107 * k) + 4);
    this.id2a = new Line(Math.ceil(379 * k) + 4);
    this.id2b = new Line(Math.ceil(277 * k) + 4);

    // Tank left: mod-ap 672, delay 4453, ap 1800, delay 3720
    this.Lmap = new Line(Math.ceil((672 + 32) * k) + 8);
    this.Ld1  = new Line(Math.ceil(4453 * k) + 4);
    this.Lap  = new Line(Math.ceil(1800 * k) + 4);
    this.Ld2  = new Line(Math.ceil(3720 * k) + 4);

    // Tank right: mod-ap 908, delay 4217, ap 2656, delay 3163
    this.Rmap = new Line(Math.ceil((908 + 32) * k) + 8);
    this.Rd1  = new Line(Math.ceil(4217 * k) + 4);
    this.Rap  = new Line(Math.ceil(2656 * k) + 4);
    this.Rd2  = new Line(Math.ceil(3163 * k) + 4);

    // One-sample states.
    this.bwZ   = 0;   // input bandwidth LPF
    this.LdampZ = 0;  // left tank damping
    this.RdampZ = 0;  // right tank damping
    this.fbL   = 0;   // figure-eight: output of Rd2·decay feeds into L input
    this.fbR   = 0;   // figure-eight: output of Ld2·decay feeds into R input

    // LFO state — quadrature. Use coupled sin/cos recursion.
    this.lfoS = 0;
    this.lfoC = 1;
    this._recomputeLfo();

    // Dattorro's verbatim coefficients (Table 1).
    this.id1g = 0.750;    // input diffusion 1
    this.id2g = 0.625;    // input diffusion 2
    this.dd1g = 0.70;     // decay diffusion 1 (used as −dd1g on modulated APs)

    this._recomputeScaled();
  }

  reset() {
    this.pre.reset();
    this.id1a.reset(); this.id1b.reset();
    this.id2a.reset(); this.id2b.reset();
    this.Lmap.reset(); this.Ld1.reset(); this.Lap.reset(); this.Ld2.reset();
    this.Rmap.reset(); this.Rd1.reset(); this.Rap.reset(); this.Rd2.reset();
    this.bwZ = 0; this.LdampZ = 0; this.RdampZ = 0;
    this.fbL = 0; this.fbR = 0;
    this.lfoS = 0; this.lfoC = 1;
  }

  _recomputeLfo() {
    const w = TAU * this._modRateHz / this.sr;
    this._lfoA = Math.cos(w);
    this._lfoB = Math.sin(w);
  }

  _recomputeScaled() {
    const k = (this.sr / SR_REF) * this._size;
    this.L_id1a = Math.max(1, Math.round(142 * k));
    this.L_id1b = Math.max(1, Math.round(107 * k));
    this.L_id2a = Math.max(1, Math.round(379 * k));
    this.L_id2b = Math.max(1, Math.round(277 * k));
    this.L_Lmap = Math.max(1, Math.round(672 * k));
    this.L_Ld1  = Math.max(1, Math.round(4453 * k));
    this.L_Lap  = Math.max(1, Math.round(1800 * k));
    this.L_Ld2  = Math.max(1, Math.round(3720 * k));
    this.L_Rmap = Math.max(1, Math.round(908 * k));
    this.L_Rd1  = Math.max(1, Math.round(4217 * k));
    this.L_Rap  = Math.max(1, Math.round(2656 * k));
    this.L_Rd2  = Math.max(1, Math.round(3163 * k));
    // Decay-diffusion-2 coef per Table 1: decay + 0.15, clamped 0.25..0.50.
    this.dd2g = Math.max(0.25, Math.min(0.50, this._decay + 0.15));
    // Predelay in samples.
    this.L_pre = Math.max(0, Math.min(this.preMax - 2,
      Math.round(this._predelayMs * 0.001 * this.sr)));
  }

  setParam(id, v) {
    if (!Number.isFinite(v)) return;
    switch (id) {
      case 'decay':      this._decay     = Math.max(0,   Math.min(0.99, v)); this._recomputeScaled(); break;
      case 'predelayMs': this._predelayMs = Math.max(0,  Math.min(200,  v)); this._recomputeScaled(); break;
      case 'bandwidth':  this._bandwidth = Math.max(0,   Math.min(1,    v)); break;
      case 'damping':    this._damping   = Math.max(0,   Math.min(0.99, v)); break;
      case 'size':       this._size      = Math.max(0.5, Math.min(1.5,  v)); this._recomputeScaled(); break;
      case 'modDepth':   this._modDepth  = Math.max(0,   Math.min(32,   v)); break;
      case 'modRateHz':  this._modRateHz = Math.max(0.1, Math.min(5,    v)); this._recomputeLfo(); break;
    }
  }

  process(inputs, outputs, N) {
    const inL = inputs && inputs.l ? inputs.l : null;
    const inR = inputs && inputs.r ? inputs.r : (inL || null);
    const outL = outputs && outputs.l ? outputs.l : null;
    const outR = outputs && outputs.r ? outputs.r : null;
    if (!outL && !outR) return;

    const bwG   = this._bandwidth;
    const dmpG  = this._damping;
    const dd1g  = this.dd1g;
    const dd2g  = this.dd2g;
    const id1g  = this.id1g;
    const id2g  = this.id2g;
    const decay = this._decay;
    const modD  = this._modDepth;
    const lfoA  = this._lfoA, lfoB = this._lfoB;

    const Lid1a = this.L_id1a, Lid1b = this.L_id1b;
    const Lid2a = this.L_id2a, Lid2b = this.L_id2b;
    const LLmap = this.L_Lmap, LLd1 = this.L_Ld1, LLap = this.L_Lap, LLd2 = this.L_Ld2;
    const LRmap = this.L_Rmap, LRd1 = this.L_Rd1, LRap = this.L_Rap, LRd2 = this.L_Rd2;
    const Lpre  = this.L_pre;

    // Tap offsets from Table 2 (Dattorro verbatim), scaled.
    const k = (this.sr / SR_REF) * this._size;
    const R = Math.round;

    for (let n = 0; n < N; n++) {
      const xl = inL ? inL[n] : 0;
      const xr = inR ? inR[n] : 0;
      let x = 0.5 * (xl + xr);

      // Predelay (read-before-write).
      let pre = Lpre > 0 ? this.pre.readInt(Lpre) : x;
      this.pre.write(x);
      x = Lpre > 0 ? pre : x;

      // Input bandwidth LPF (§1.3.5).
      this.bwZ = (1 - bwG) * x + bwG * this.bwZ;
      x = this.bwZ;

      // Input diffusion chain — 4 serial allpasses.
      x = processAllpass(this.id1a, Lid1a, id1g, x);
      x = processAllpass(this.id1b, Lid1b, id1g, x);
      x = processAllpass(this.id2a, Lid2a, id2g, x);
      x = processAllpass(this.id2b, Lid2b, id2g, x);

      // LFO step (coupled sin/cos).
      const sN = lfoA * this.lfoS + lfoB * this.lfoC;
      const cN = lfoA * this.lfoC - lfoB * this.lfoS;
      this.lfoS = sN; this.lfoC = cN;
      const modL = modD * sN;
      const modR = modD * cN;

      // ----- Left tank half -----
      // Modulated allpass 672 + excursion (linear-interp read).
      const LmapD = LLmap + modL;
      const LmapRead = this.Lmap.readFrac(LmapD);
      const LmapV = (x + this.fbL) + (-dd1g) * LmapRead;   // note sign
      this.Lmap.write(LmapV);
      const Lmap_out = LmapRead - (-dd1g) * LmapV;

      // Delay z^-4453.
      const Ld1_out = this.Ld1.readInt(LLd1);
      this.Ld1.write(Lmap_out);

      // Damping LPF then × decay.
      this.LdampZ = (1 - dmpG) * Ld1_out + dmpG * this.LdampZ;
      const Lpost = this.LdampZ * decay;

      // Decay-diff-2 allpass 1800.
      const Lap_out = processAllpass(this.Lap, LLap, dd2g, Lpost);

      // Delay z^-3720, × decay into right half.
      const Ld2_out = this.Ld2.readInt(LLd2);
      this.Ld2.write(Lap_out);
      this.fbR = Ld2_out * decay;

      // ----- Right tank half -----
      const RmapD = LRmap + modR;
      const RmapRead = this.Rmap.readFrac(RmapD);
      const RmapV = (x + this.fbR) + (-dd1g) * RmapRead;
      this.Rmap.write(RmapV);
      const Rmap_out = RmapRead - (-dd1g) * RmapV;

      const Rd1_out = this.Rd1.readInt(LRd1);
      this.Rd1.write(Rmap_out);

      this.RdampZ = (1 - dmpG) * Rd1_out + dmpG * this.RdampZ;
      const Rpost = this.RdampZ * decay;

      const Rap_out = processAllpass(this.Rap, LRap, dd2g, Rpost);

      const Rd2_out = this.Rd2.readInt(LRd2);
      this.Rd2.write(Rap_out);
      this.fbL = Rd2_out * decay;

      // ----- Output taps (Table 2) -----
      // Tap names map to delay lines:
      //   node24_30 = Ld1 (z^-4453, left)
      //   node31_33 = Lap (1800 ap, left)
      //   node33_39 = Ld2 (z^-3720, left)
      //   node48_54 = Rd1 (z^-4217, right)
      //   node55_59 = Rap (2656 ap, right)
      //   node59_63 = Rd2 (z^-3163, right)
      const t = (line, d) => line.readInt(Math.max(1, R(d * k)));

      const yL =
          0.6 * t(this.Rd1,  266)
        + 0.6 * t(this.Rd1, 2974)
        - 0.6 * t(this.Rap, 1913)
        + 0.6 * t(this.Rd2, 1996)
        - 0.6 * t(this.Ld1, 1990)
        + 0.6 * t(this.Lap,  187)
        - 0.6 * t(this.Ld2, 1066);

      const yR =
          0.6 * t(this.Ld1,  353)
        + 0.6 * t(this.Ld1, 3627)
        - 0.6 * t(this.Lap, 1228)
        + 0.6 * t(this.Ld2, 2673)
        - 0.6 * t(this.Rd1, 2111)
        + 0.6 * t(this.Rap,  335)
        - 0.6 * t(this.Rd2,  121);

      if (outL) outL[n] = yL;
      if (outR) outR[n] = yR;
    }
  }

  getLatencySamples() { return 0; }
}
