// op_hardClip.worklet.js — Stage-3 op sidecar for the `hardClip` op.
//
// Character / drive stage. Sign-preserving symmetric clip at ±threshold,
// with optional 1st-order antiderivative-antialiasing (ADAA). Primitive
// distinct from saturate (Padé tanh, smooth) and softLimit (threshold-
// scaled Padé): hardClip has a DISCONTINUOUS DERIVATIVE at the threshold,
// generating brick-wall harmonic content (cosine series: 4/π · Σ sin(nωt)/n
// for full clipping of a sine). Use as the FX-rack output stage, fuzz
// pedal stage, or as a low-cost waveshaper composition base.
//
// Math (naive form, Canon §5 branchless clip — Laurent de Soras 2004,
// musicdsp.org #81, public-domain):
//
//   clip(x, a, b) = (|x − a| − |x − b| + (a + b)) · 0.5
//
// For symmetric ±T:
//   clip(x, −T, +T) = (|x + T| − |x − T|) · 0.5
//
// ADAA (1st-order antiderivative-antialiasing per Parker-Esqueda-Bilbao
// DAFx 2016 "Antiderivative Antialiasing for Memoryless Nonlinearities"):
//
//   y[n] = (F(x[n]) − F(x[n−1])) / (x[n] − x[n−1])
//
// where F is the antiderivative of the clip transfer:
//
//   F(u) =  T · u − T²/2    if u >  T
//   F(u) =  u²/2             if |u| ≤ T
//   F(u) = −T · u − T²/2    if u < −T
//
// When |x[n] − x[n−1]| falls below numerical epsilon the formula tends
// to 0/0 — fall back to the average of f(x[n]) and f(x[n−1]) (per
// Parker-Esqueda-Bilbao §III, "ill-conditioned case").
//
// State: 1 sample of input + 1 sample of antiderivative (4 bytes each
// at f32) when ADAA is on; zero state when off.
//
// Authoring contract:
//   drive:     pre-gain into the clipper (× 1..16)
//   threshold: clip level (∈ [0, 1])
//   trim:      post-gain (dB)
//   adaa:      enable 1st-order ADAA (bool, default false)

export class HardClipOp {
  static opId = 'hardClip';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive',     default: 1   },
    { id: 'threshold', default: 1   },
    { id: 'trim',      default: 0   },
    { id: 'adaa',      default: 0   },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._drive   = 1;
    this._thr     = 1;
    this._trimLin = 1;
    this._adaa    = 0;
    // ADAA state — previous input and previous antiderivative value.
    this._x1 = 0;
    this._F1 = 0;  // F(x1)
  }

  reset() {
    this._x1 = 0;
    this._F1 = 0;
  }

  setParam(id, v) {
    if (id === 'drive') {
      const x = +v;
      this._drive = Number.isFinite(x) ? Math.max(0.01, x) : 1;
    } else if (id === 'threshold') {
      const x = +v;
      // Threshold floor = 1e-6 to avoid divide-by-near-zero in ADAA branch
      // selection. Negative thresholds clamped to floor.
      this._thr = Number.isFinite(x) ? Math.max(1e-6, Math.min(1, x)) : 1;
    } else if (id === 'trim') {
      const x = +v;
      this._trimLin = Number.isFinite(x) ? Math.pow(10, x / 20) : 1;
    } else if (id === 'adaa') {
      this._adaa = v ? 1 : 0;
    }
  }

  getLatencySamples() { return 0; }

  // F(u) = antiderivative of clip(u, -T, T).
  static _F(u, T) {
    if (u > T)       return T * u - 0.5 * T * T;
    else if (u < -T) return -T * u - 0.5 * T * T;
    else             return 0.5 * u * u;
  }

  // f(u) = clip(u, -T, T) — Canon §5 branchless form.
  static _f(u, T) {
    return 0.5 * (Math.abs(u + T) - Math.abs(u - T));
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const drive   = this._drive;
    const trimLin = this._trimLin;
    const T       = this._thr;
    const useAdaa = this._adaa === 1;

    if (!useAdaa) {
      // Stateless naive form — Canon §5 branchless clip.
      for (let i = 0; i < N; i++) {
        const u = inCh[i] * drive;
        const y = 0.5 * (Math.abs(u + T) - Math.abs(u - T));
        outCh[i] = trimLin * y;
      }
      return;
    }

    // ADAA path (Parker-Esqueda-Bilbao DAFx 2016 §III).
    // Ill-conditioned threshold: if |Δx| < EPS, fall back to f-value avg.
    const EPS_DIV = 1e-6;
    let x1 = this._x1;
    let F1 = this._F1;
    for (let i = 0; i < N; i++) {
      const u  = inCh[i] * drive;
      const Fu = HardClipOp._F(u, T);
      let y;
      const dx = u - x1;
      if (Math.abs(dx) < EPS_DIV) {
        // Fallback: average of clip(u) and clip(x1).
        const fu  = HardClipOp._f(u,  T);
        const fx1 = HardClipOp._f(x1, T);
        y = 0.5 * (fu + fx1);
      } else {
        y = (Fu - F1) / dx;
      }
      outCh[i] = trimLin * y;
      x1 = u;
      F1 = Fu;
    }
    this._x1 = x1;
    this._F1 = F1;
  }
}
