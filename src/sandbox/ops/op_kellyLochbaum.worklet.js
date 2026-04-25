// op_kellyLochbaum.worklet.js — Stage-3 op sidecar for the `kellyLochbaum` op.
//
// Catalog #87 (Synthesis / physical modeling). Kelly-Lochbaum lattice —
// concatenated 1-sample cylindrical waveguide sections with 2-port
// scattering at each junction. jos_pasp_physical_modeling.md §7.1 + §10.1.
// First digital physical-modeling synthesis (Kelly, Lochbaum, Mathews 1961).
//
// ALGORITHM
//
// N sections, each one sample wide. At each section store the current
// right-going wave f⁺[i] and left-going wave f⁻[i]. Between sections i
// and i+1 a 2-port scattering junction with reflection coefficient k[i]
// redistributes the traveling waves. One-multiply form (JOS §10.2):
//
//     Δ_i          = k[i] · (f⁺[i] − f⁻[i+1])
//     new_f⁺[i+1]  = f⁺[i] + Δ_i
//     new_f⁻[i]    = f⁻[i+1] + Δ_i
//
//   Glottal (left) boundary:   new_f⁺[0]   = x + glottis · f⁻[0]
//   Lip     (right) boundary:  new_f⁻[N-1] = lip · dampFilt(f⁺[N-1])
//
//   output = f⁺[N-1]                      (right-going at lip — radiated)
//
// This is the 1961 Kelly-Lochbaum vocal-tract model reduced to its
// computational core. With taper=0 (all k[i]=0) every junction is
// transparent and the whole chain collapses to a cylindrical waveguide
// of length N — i.e. it becomes a degenerate case of `waveguide` (#86).
// Nonzero taper makes each junction partially reflective, which clusters
// energy at formant frequencies dictated by the cumulative impedance
// profile.
//
// PARAMETERS
//
//   length  (int 4..512, default 32)  — number of sections. Fundamental
//                                        ≈ sr / (2·length). At sr=48k,
//                                        length=32 → f0 ≈ 750 Hz
//                                        (rough "vocal tract first
//                                        formant" range for [a]).
//   taper   (−1..+1, default 0)       — reflection coefficient at every
//                                        junction (constant along tract
//                                        for v1). 0 = cylinder; positive
//                                        = converging (narrowing toward
//                                        lip); negative = diverging
//                                        (flared horn).
//   glottis (−1..+1, default −0.9)    — glottal-end reflection
//   lip     (−1..+1, default −0.85)   — lip-end reflection
//   damp    ( 0..1,  default 0.05)    — HF loss at lip (two-point-avg mix)
//
// USE
//
//   • Talkbox / vocal-tract coloration — drive with noise or glottal pulse
//   • Tube-preamp-like resonance chain — each junction = resonance
//   • Vowel-ish timbres — sweep `taper` while driving with buzzy sawtooth
//   • Formant stem for LPC-driven vocoder (future sibling op)
//
// LATENCY = 0 (resonator).
//
// LIMITS (v1)
//
//   • Constant reflection coefficient (all k[i] equal). Per-junction
//     array (k[0..N-1] from vowel presets / Fant / Maeda tables) is the
//     upgrade path — requires array-param support in the op system.
//   • Integer delay per section only (single sample). Fractional per-
//     section delay (Thiran) would smooth pitch tuning — upgrade path.
//   • Single lip radiation filter (damp + reflection). Real physical
//     lips are a differentiator / HP — upgrade path.

const MAX_N = 512;

export class KellyLochbaumOp {
  static opId = 'kellyLochbaum';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'length',  default: 32    },
    { id: 'taper',   default: 0     },
    { id: 'glottis', default: -0.9  },
    { id: 'lip',     default: -0.85 },
    { id: 'damp',    default: 0.05  },
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._length   = 32;
    this._taper    = 0;
    this._glottis  = -0.9;
    this._lip      = -0.85;
    this._damp     = 0.05;
    this._fp       = new Float32Array(MAX_N);   // right-going wave per section
    this._fm       = new Float32Array(MAX_N);   // left-going  wave per section
    this._tmpPlus  = new Float32Array(MAX_N);
    this._tmpMinus = new Float32Array(MAX_N);
    this._dampState = 0;                         // one-sample state at lip damp filter
  }

  reset() {
    this._fp.fill(0);
    this._fm.fill(0);
    this._tmpPlus.fill(0);
    this._tmpMinus.fill(0);
    this._dampState = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'length') {
      const c = Math.round(n);
      const newLen = c < 4 ? 4 : (c > MAX_N ? MAX_N : c);
      if (newLen !== this._length) {
        // Flush state — stale samples would be at wrong spatial positions.
        this._fp.fill(0);
        this._fm.fill(0);
        this._tmpPlus.fill(0);
        this._tmpMinus.fill(0);
        this._dampState = 0;
        this._length = newLen;
      }
    } else if (id === 'taper') {
      // KL scattering is passive only for |k| < 1 strictly; at |k|=1 the
      // pressure-wave junction gain is ×2 and the chain amplifies. Clamp
      // to [-0.99, +0.99] to guarantee stability under all configurations.
      this._taper = n < -0.99 ? -0.99 : (n > 0.99 ? 0.99 : n);
    } else if (id === 'glottis') {
      this._glottis = n < -0.99 ? -0.99 : (n > 0.99 ? 0.99 : n);
    } else if (id === 'lip') {
      this._lip = n < -0.99 ? -0.99 : (n > 0.99 ? 0.99 : n);
    } else if (id === 'damp') {
      this._damp = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    const Ns    = this._length;
    const k     = this._taper;
    const gR    = this._glottis;
    const lR    = this._lip;
    const d     = this._damp;
    const dHalf = 0.5 * d;
    const pass  = 1 - dHalf;
    const fp    = this._fp;
    const fm    = this._fm;
    const tp    = this._tmpPlus;
    const tm    = this._tmpMinus;
    let dampState = this._dampState;

    for (let s = 0; s < N; s++) {
      const x = inCh ? inCh[s] : 0;

      // ── Scatter at interior junctions (i between section i and i+1) ──
      // One-multiply form: Δ = k · (f⁺[i] − f⁻[i+1])
      for (let i = 0; i < Ns - 1; i++) {
        const delta = k * (fp[i] - fm[i + 1]);
        tp[i + 1] = fp[i]     + delta;   // new right-going into section i+1
        tm[i]     = fm[i + 1] + delta;   // new left-going  into section i
      }

      // ── Glottal boundary (left end) ──
      tp[0] = x + gR * fm[0];

      // ── Lip boundary (right end) ──
      // Damp filter mix between pass-through and two-point average (DC gain = 1).
      const lipIn = fp[Ns - 1];
      const damped = pass * lipIn + dHalf * dampState;
      dampState = lipIn;
      tm[Ns - 1] = lR * damped;

      // ── Output: right-going wave at the lip (pre-reflection radiated) ──
      outCh[s] = lipIn;

      // ── Commit new state ──
      for (let i = 0; i < Ns; i++) {
        fp[i] = tp[i];
        fm[i] = tm[i];
      }
    }

    this._dampState = dampState;
  }
}
