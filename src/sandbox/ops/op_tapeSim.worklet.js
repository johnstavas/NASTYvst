// op_tapeSim.worklet.js — Stage-3 op sidecar for catalog #112.
//
// Magnetic tape character. Three-stage chain:
//
//   x → drive → gloubi-boulga waveshape → head-bump peak → HF roll-off → y
//
// PRIMARIES (opened 2026-04-24):
//
//   (A) Gloubi-boulga waveshaper — musicdsp.org Effects #86
//       https://www.musicdsp.org/en/latest/Effects/86-waveshaper-gloubi-boulga.html
//       Verbatim:
//         const double x = input * 0.686306;
//         const double a = 1 + exp(sqrt(fabs(x)) * -0.75);
//         output = (exp(x) - exp(-x*a)) / (exp(x) + exp(-x));
//       Author's note: "Multiply input by gain before processing."
//       Laurent de Soras contribution (2002), public-domain.
//
//   (B) RBJ Audio-EQ-Cookbook peakingEQ biquad — w3.org/TR/audio-eq-cookbook/
//       Verbatim:
//         A = √(10^(dBgain/20)) = 10^(dBgain/40)
//         ω₀ = 2π f₀/Fs
//         α = sin(ω₀)/(2Q)
//         b0 = 1 + α·A         a0 = 1 + α/A
//         b1 = -2·cos(ω₀)      a1 = -2·cos(ω₀)
//         b2 = 1 − α·A         a2 = 1 − α/A
//       Public-domain math.
//
//   (C) 1-pole LP HF loss — math-by-definition (standard):
//         α = 1 − exp(−2π · fc / Fs)
//         y[n] = y[n−1] + α · (x[n] − y[n−1])
//
// DEVIATIONS / DEFERRED (see debt ledger for v2):
//   - No hysteresis (Preisach / Jiles-Atherton inner loop).
//   - No wow/flutter (pitch modulation) — users wire LFO (#58) externally.
//   - No pre-emphasis / post-de-emphasis EQ (tape spec curves).
//   - No speed-dependent HF ceiling calibration (user sets hfHz freely).
//   - Biquad DF2T (transposed direct form II) for peak stage — best numerics
//     at low fc per Canon:filters §9 LIMITS.

const DENORMAL = 1e-30;

function gloubiBoulga(input) {
  // Verbatim port of musicdsp #86. Input is already drive-scaled.
  const x = input * 0.686306;
  const a = 1 + Math.exp(Math.sqrt(Math.abs(x)) * -0.75);
  const ex  = Math.exp(x);
  const enx = Math.exp(-x);
  const enxa = Math.exp(-x * a);
  return (ex - enxa) / (ex + enx);
}

export class TapeSimOp {
  static opId = 'tapeSim';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'drive',  default: 1.0  },
    { id: 'bumpHz', default: 60   },
    { id: 'bumpDb', default: 3.0  },
    { id: 'bumpQ',  default: 1.0  },
    { id: 'hfHz',   default: 16000 },
    { id: 'trim',   default: 1.0  },
  ]);

  constructor(sampleRate) {
    this.sr      = sampleRate;
    this._drive  = 1.0;
    this._bumpHz = 60;
    this._bumpDb = 3.0;
    this._bumpQ  = 1.0;
    this._hfHz   = 16000;
    this._trim   = 1.0;

    // Peak biquad coefficients (DF2T: two state vars s1, s2)
    this._b0 = 1; this._b1 = 0; this._b2 = 0;
    this._a1 = 0; this._a2 = 0;
    this._s1 = 0; this._s2 = 0;

    // 1-pole LP HF-loss
    this._lpA = 0;    // coefficient
    this._lpY = 0;    // state

    this._recomputeBump();
    this._recomputeHF();
  }

  reset() {
    this._s1 = 0;
    this._s2 = 0;
    this._lpY = 0;
  }

  _recomputeBump() {
    const f0 = this._bumpHz;
    const Q  = this._bumpQ;
    const dB = this._bumpDb;
    const A  = Math.pow(10, dB / 40);
    const w0 = 2 * Math.PI * f0 / this.sr;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Q);
    const b0 = 1 + alpha * A;
    const b1 = -2 * cw;
    const b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A;
    const a1 = -2 * cw;
    const a2 = 1 - alpha / A;
    // Normalize by a0
    const inv = 1 / a0;
    this._b0 = b0 * inv;
    this._b1 = b1 * inv;
    this._b2 = b2 * inv;
    this._a1 = a1 * inv;
    this._a2 = a2 * inv;
  }

  _recomputeHF() {
    // α = 1 − exp(−2π · fc / Fs)
    const fc = this._hfHz;
    if (fc >= this.sr * 0.5) {
      this._lpA = 1; // pass-through
    } else {
      this._lpA = 1 - Math.exp(-2 * Math.PI * fc / this.sr);
    }
  }

  setParam(id, v) {
    let f = +v;
    if (!Number.isFinite(f)) return;
    if (id === 'drive') {
      this._drive = f < 0 ? 0 : (f > 20 ? 20 : f);
    } else if (id === 'bumpHz') {
      const ny = this.sr * 0.49;
      this._bumpHz = f < 10 ? 10 : (f > ny ? ny : f);
      this._recomputeBump();
    } else if (id === 'bumpDb') {
      this._bumpDb = f < -12 ? -12 : (f > 12 ? 12 : f);
      this._recomputeBump();
    } else if (id === 'bumpQ') {
      this._bumpQ = f < 0.1 ? 0.1 : (f > 10 ? 10 : f);
      this._recomputeBump();
    } else if (id === 'hfHz') {
      const ny = this.sr * 0.49;
      this._hfHz = f < 200 ? 200 : (f > ny ? ny : f);
      this._recomputeHF();
    } else if (id === 'trim') {
      this._trim = f < 0 ? 0 : (f > 4 ? 4 : f);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const oBuf = outputs && outputs.out;
    if (!oBuf) return;
    const iBuf = inputs && inputs.in;
    const drv  = this._drive;
    const trim = this._trim;
    const b0 = this._b0, b1 = this._b1, b2 = this._b2;
    const a1 = this._a1, a2 = this._a2;
    let s1 = this._s1, s2 = this._s2;
    const lpA = this._lpA;
    let lpY = this._lpY;

    for (let n = 0; n < N; n++) {
      const x0 = iBuf ? iBuf[n] : 0;

      // (1) Drive + gloubi-boulga saturation
      const sat = gloubiBoulga(x0 * drv);

      // (2) DF2T peaking biquad (head-bump)
      // y = b0·x + s1;  s1' = b1·x − a1·y + s2;  s2' = b2·x − a2·y
      const yp = b0 * sat + s1;
      s1 = b1 * sat - a1 * yp + s2;
      s2 = b2 * sat - a2 * yp;

      // (3) 1-pole LP (HF loss)
      lpY = lpY + lpA * (yp - lpY);

      // Output trim
      let y = lpY * trim;
      if (Math.abs(y) < DENORMAL) y = 0;
      oBuf[n] = y;
    }

    // Denormal flush on state
    if (Math.abs(s1) < DENORMAL) s1 = 0;
    if (Math.abs(s2) < DENORMAL) s2 = 0;
    if (Math.abs(lpY) < DENORMAL) lpY = 0;
    this._s1 = s1;
    this._s2 = s2;
    this._lpY = lpY;
  }
}
