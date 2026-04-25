// op_minBLEP.worklet.js — Stage-3 op sidecar for the `minBLEP` op.
//
// Minimum-phase Band-Limited Step (MinBLEP) corrected sawtooth oscillator.
//
// PRIMARIES (synth-family rule = 2 minimum):
//
//   A. Eli Brandt, "Hard Sync Without Aliasing", ICMC 2001, CMU-CS.
//      §4.2 windowed-sinc approximation, §6.2 minimum-phase via
//      cepstral homomorphic filtering (MATLAB rceps), §6.3 integrate
//      min-phase impulse → MinBLEP step.
//      Application: at each discontinuity event at continuous time
//      t_ev = n − α (α ∈ [0,1) fractional), add
//          correction(m) = jump · residual((m − n + α) · Ω)
//      for m ≥ n, where residual(τ) = MinBLEP(τ) − 1.
//      Fig 4 params: Ω=64, Nz=16, Blackman window. We ship Ω=32, Nz=8
//      (table = 256 entries) for modest cost — mastering-grade table
//      size is filed as debt.
//
//   B. martinfinke/PolyBLEP (github), ported from Tale/Jesusonic
//      WDL/IPlug license. Confirms the discontinuity-handling
//      convention for saws (jump = −2, residual added forward from
//      event sample). PolyBLEP uses a closed-form parabolic stand-in
//      for the table; we use the true min-phase table per Brandt.
//
// Contract:
//   - Optional `freqMod` control input (Hz added to base freq).
//   - Single AUDIO output `out` — sawtooth in ~[−1, +1].
//   - getLatencySamples() = 0. Minimum-phase is the whole point.
//   - Table is generated ONCE at module load via an inline radix-2
//     FFT and cepstral homomorphic filter (Oppenheim & Schafer 1975,
//     "zero the upper half of the cepstrum"). No runtime FFT cost.
//   - Event bookkeeping is fixed-size (BLEP_LEN slots) with no
//     per-event allocations.

// -------- table-generation-time constants ---------------------------
const OMEGA      = 32;                     // oversampling factor
const NZ         = 8;                      // zero crossings either side
const TABLE_N    = 2 * NZ * OMEGA;         // 512 entries (windowed sinc)
const BLEP_LEN   = NZ;                     // residual decays by NZ samples
const TABLE_RES  = BLEP_LEN * OMEGA;       // 256 entries of usable residual

// -------- inline radix-2 Cooley–Tukey FFT ---------------------------
// In-place. Used three times during table build, then never again.
function fft(re, im, inverse) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t     = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const step = (inverse ? 2 : -2) * Math.PI / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < half; k++) {
        const ang = step * k;
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const rR = re[i + k + half] * cs - im[i + k + half] * sn;
        const rI = re[i + k + half] * sn + im[i + k + half] * cs;
        re[i + k + half] = re[i + k] - rR;
        im[i + k + half] = im[i + k] - rI;
        re[i + k] += rR;
        im[i + k] += rI;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
  }
}

// -------- build the minimum-phase BLEP residual table ---------------
// Brandt §4.2 + §6.2 + §6.3, executed once at module load.
function buildResidualTable() {
  const N = TABLE_N;
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // (1) Linear-phase windowed sinc, fc = 1/Ω (bandlimit to Nyquist/Ω
  //     in oversampled domain), Blackman window, centered at N/2.
  const center = N / 2;
  for (let k = 0; k < N; k++) {
    const x = (k - center) / OMEGA;
    const sinc = (x === 0) ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const w = 0.42
            - 0.5  * Math.cos(2 * Math.PI * k / (N - 1))
            + 0.08 * Math.cos(4 * Math.PI * k / (N - 1));
    re[k] = sinc * w / OMEGA;
  }

  // (2) FFT → log |H(k)|. Complex cepstrum here is real (zero-phase input
  //     would give real-symmetric spectrum; we use magnitude only).
  fft(re, im, false);
  const logMag = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const m = Math.hypot(re[k], im[k]);
    logMag[k] = Math.log(Math.max(m, 1e-30));
  }

  // (3) IFFT of log|H| → real cepstrum c.
  for (let k = 0; k < N; k++) { re[k] = logMag[k]; im[k] = 0; }
  fft(re, im, true);
  const cep = new Float64Array(N);
  for (let k = 0; k < N; k++) cep[k] = re[k];

  // (4) Fold the cepstrum: c[0] unchanged, c[1..N/2-1] doubled,
  //     c[N/2] unchanged, c[N/2+1..N-1] zeroed. This is Oppenheim &
  //     Schafer's homomorphic min-phase reconstruction.
  for (let k = 0; k < N; k++) {
    if (k === 0 || k === N / 2)  re[k] = cep[k];
    else if (k < N / 2)           re[k] = 2 * cep[k];
    else                          re[k] = 0;
    im[k] = 0;
  }

  // (5) FFT → complex spectrum (log|H| + j·phi_min).
  fft(re, im, false);

  // (6) exp() element-wise → H_min(k).
  for (let k = 0; k < N; k++) {
    const em = Math.exp(re[k]);
    const cs = Math.cos(im[k]);
    const sn = Math.sin(im[k]);
    re[k] = em * cs;
    im[k] = em * sn;
  }

  // (7) IFFT → minimum-phase impulse response h_min (real).
  fft(re, im, true);
  // re[] now holds h_min. Discard im (should be ≈0).

  // (8) Integrate → MinBLEP (cumulative sum). Normalize final value to 1.
  const blep = new Float64Array(N);
  let acc = 0;
  for (let k = 0; k < N; k++) { acc += re[k]; blep[k] = acc; }
  const finalVal = blep[N - 1] || 1;
  for (let k = 0; k < N; k++) blep[k] /= finalVal;

  // (9) Residual = MinBLEP − 1 (subtract the instantaneous step). Used
  //     additively on naive oscillator: out = naive + jump · residual(τ).
  const residual = new Float32Array(TABLE_RES);
  for (let k = 0; k < TABLE_RES; k++) residual[k] = blep[k] - 1;
  return residual;
}

const BLEP_RESIDUAL = buildResidualTable();

// -------- the op --------------------------------------------------------
export class MinBlepOp {
  static opId = 'minBLEP';
  static inputs  = Object.freeze([{ id: 'freqMod', kind: 'control' }]);
  static outputs = Object.freeze([{ id: 'out',     kind: 'audio'   }]);
  static params  = Object.freeze([
    { id: 'freq', default: 440 },
    { id: 'amp',  default: 1   },
  ]);

  constructor(sampleRate) {
    this.sr    = sampleRate;
    this._freq = 440;
    this._amp  = 1;
    this._dt   = 440 / sampleRate;
    this._phase = 0;

    // Fixed-size event pool. At most BLEP_LEN events can be live
    // simultaneously (one per sample while old ones age out).
    this._evAge    = new Int32Array(BLEP_LEN);
    this._evAlpha  = new Float32Array(BLEP_LEN);
    this._evJump   = new Float32Array(BLEP_LEN);
    this._evActive = new Uint8Array(BLEP_LEN);
  }

  reset() {
    this._phase = 0;
    for (let i = 0; i < BLEP_LEN; i++) this._evActive[i] = 0;
  }

  setParam(id, v) {
    if (id === 'freq') {
      this._freq = +v;
      const nyq = this.sr * 0.5;
      let f = this._freq;
      if (!(f > 0.01))   f = 0.01;
      if (f > nyq - 1)   f = nyq - 1;
      this._dt = f / this.sr;
    } else if (id === 'amp') {
      this._amp = +v;
    }
  }

  getLatencySamples() { return 0; }

  _insertEvent(alpha, jump) {
    for (let k = 0; k < BLEP_LEN; k++) {
      if (!this._evActive[k]) {
        this._evAge[k]    = 0;
        this._evAlpha[k]  = alpha;
        this._evJump[k]   = jump;
        this._evActive[k] = 1;
        return;
      }
    }
    // Pool full — shouldn't happen at audio rates (freq < sr ⇒ < 1 wrap/
    // sample ⇒ ≤ BLEP_LEN events). Drop silently if it ever does.
  }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out;
    if (!out) return;
    const fm  = inputs && inputs.freqMod;
    const amp = this._amp;
    const resid = BLEP_RESIDUAL;
    const evAge    = this._evAge;
    const evAlpha  = this._evAlpha;
    const evJump   = this._evJump;
    const evActive = this._evActive;

    let phase = this._phase;
    let dt    = this._dt;
    const nyq = this.sr * 0.5;

    for (let n = 0; n < N; n++) {
      if (fm) {
        let f = this._freq + fm[n];
        if (!(f > 0.01))      f = 0.01;
        else if (f > nyq - 1) f = nyq - 1;
        dt = f / this.sr;
      }

      // Advance phase. Register wrap event BEFORE emitting so the
      // event's correction at the current sample is applied.
      phase += dt;
      if (phase >= 1) {
        phase -= 1;
        // alpha = fractional number of samples between the ideal
        // continuous event and the current sample. Event is in past
        // of sample n by α samples.
        const alpha = (dt > 0) ? (phase / dt) : 0;
        this._insertEvent(alpha, -2);   // saw wraps +1 → −1, jump = −2
      }

      // Naive saw ∈ [−1, +1).
      const naive = 2 * phase - 1;

      // Sum residual corrections from all active events.
      let correction = 0;
      for (let k = 0; k < BLEP_LEN; k++) {
        if (!evActive[k]) continue;
        const age = evAge[k];
        if (age >= BLEP_LEN) { evActive[k] = 0; continue; }
        const idxF = (age + evAlpha[k]) * OMEGA;
        const idxI = idxF | 0;
        const frac = idxF - idxI;
        const r0 = (idxI   < TABLE_RES) ? resid[idxI]     : 0;
        const r1 = (idxI+1 < TABLE_RES) ? resid[idxI + 1] : 0;
        correction += evJump[k] * (r0 + frac * (r1 - r0));
        evAge[k] = age + 1;
      }

      out[n] = (naive + correction) * amp;
    }

    this._phase = phase;
  }
}
