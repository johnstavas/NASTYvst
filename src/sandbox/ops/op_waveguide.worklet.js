// op_waveguide.worklet.js — Stage-3 op sidecar for the `waveguide` op.
//
// Catalog #86 (Synthesis / physical modeling). Bidirectional lossy
// digital waveguide — the canonical JOS model of a 1D acoustic medium
// (tube, bore, string). jos_pasp_dsp_reference.md §4.3 –§4.5.
//
// ALGORITHM
//
// Two traveling waves in opposite directions, each a delay line of length
// L = round(sr / (2·freq)). At each endpoint the wave is reflected
// (gain `reflL` / `reflR`) and lowpass-damped (`damp`, a two-point-average
// mix) before being fed back into the other delay line.
//
//     input x[n]
//         │
//         ▼          ┌──────────── bufR (length L) ────────────┐
//    [ + ]────────►  │ right-going wave                         │ ──►  endR
//         ▲          └──────────────────────────────────────────┘       │
//         │                                                              ▼
//   reflectedL ◄─ reflL · dampFilt_L ◄── endL                     dampFilt_R
//                                          ▲                             │
//         ┌──────────── bufL (length L) ────┘                            │
//         │ ◄ left-going wave ◄──────────────────────────── reflR · ◄────┘
//         └────────────────────────────────────────────────► reflectedR
//
//     out = (x + reflectedL) + endL    // pressure at the left (mouth) end:
//                                      // newly-injected right-going wave
//                                      // plus left-going wave arriving back
//
// Karplus-Strong (#85) is a degenerate case — single delay line with a
// single reflection and a damp filter. Waveguide is the general form:
// two delays, two ends, independent boundary conditions.
//
// PARAMETERS
//
//   freq  (Hz, default 220) — fundamental; sets L = round(sr / (2·freq))
//   reflL (−1..+1, default 0.98) — left-end reflection coefficient
//   reflR (−1..+1, default 0.98) — right-end reflection coefficient
//   damp  (0..1,   default 0.1)  — HF loss per reflection (0 = lossless,
//                                   1 = full two-point average of K-S)
//
// SIGN OF REFLECTION
//
//   +r  = pressure-preserving (rigid wall, closed end)
//   −r  = pressure-inverting   (open end / horn mouth)
//
// Default is closed-closed. Flip a sign for open/closed boundary (gives
// odd-only harmonic series, classic clarinet / stopped-pipe sound).
//
// USE
//
//   • Horn / cabinet / bore coloration — drive with any audio source
//   • Plucked/bowed string — drive with noise burst or sawtooth
//   • Feedback-howl simulation — proper comb structure (not fake allpass)
//   • Speaker-cabinet mode — stack several at different freqs in parallel
//   • Base layer for Kelly-Lochbaum vocal tract (tapered waveguide, future)
//
// LATENCY = 0  — resonator, not an analyzer. Output starts responding to
// input immediately. Steady-state resonant build-up takes L samples but
// that's acoustic reality, not reportable latency.
//
// LIMITS (v1)
//
//   • Integer delay only — no fractional tuning. Pitch is quantized to
//     sr/(2·L); at high freq the granularity is audible. Upgrade:
//     Thiran allpass fractional delay (see JOS §3, ladder spec).
//   • No dispersion filter — fine for air-column tubes, inadequate for
//     stiff strings (piano). Upgrade: dispersion allpass (§4.6).
//   • Single tap point (left end). Upgrade: parameterized pickup position.
//   • Symmetric damp filter both ends. Upgrade: per-end loop filters.

const MAX_L = 4096;

export class WaveguideOp {
  static opId = 'waveguide';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'freq',  default: 220  },
    { id: 'reflL', default: 0.98 },
    { id: 'reflR', default: 0.98 },
    { id: 'damp',  default: 0.1  },
  ]);

  constructor(sampleRate) {
    this.sr     = sampleRate;
    this._freq  = 220;
    this._reflL = 0.98;
    this._reflR = 0.98;
    this._damp  = 0.1;
    this._L     = 109;       // set by _recomputeL below
    this._bufR  = new Float32Array(MAX_L);
    this._bufL  = new Float32Array(MAX_L);
    this._idx   = 0;
    this._prevR = 0;          // damp-filter state at right end
    this._prevL = 0;          // damp-filter state at left  end
    this._recomputeL();
  }

  reset() {
    this._bufR.fill(0);
    this._bufL.fill(0);
    this._idx   = 0;
    this._prevR = 0;
    this._prevL = 0;
  }

  _recomputeL() {
    const minL = 4;                             // safety floor
    const maxL = MAX_L;
    let L = Math.round(this.sr / (2 * this._freq));
    if (L < minL) L = minL;
    if (L > maxL) L = maxL;
    if (L !== this._L) {
      // Length change → flush delay lines (stale samples would be at wrong
      // spatial position). idx also reset so readout indexing is consistent.
      this._bufR.fill(0);
      this._bufL.fill(0);
      this._idx   = 0;
      this._prevR = 0;
      this._prevL = 0;
      this._L     = L;
    }
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if (id === 'freq') {
      // Clamp: min 20 Hz, max sr/8 (keeps L ≥ 4 at any sr).
      const lo = 20, hi = this.sr * 0.125;
      this._freq = n < lo ? lo : (n > hi ? hi : n);
      this._recomputeL();
    } else if (id === 'reflL') {
      this._reflL = n < -1 ? -1 : (n > 1 ? 1 : n);
    } else if (id === 'reflR') {
      this._reflR = n < -1 ? -1 : (n > 1 ? 1 : n);
    } else if (id === 'damp') {
      this._damp = n < 0 ? 0 : (n > 1 ? 1 : n);
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;

    const L     = this._L;
    const bufR  = this._bufR;
    const bufL  = this._bufL;
    const reflL = this._reflL;
    const reflR = this._reflR;
    const damp  = this._damp;
    const dHalf = 0.5 * damp;        // mix coefficient for two-point average
    const passThru = 1 - dHalf;
    let idx   = this._idx;
    let prevR = this._prevR;
    let prevL = this._prevL;

    for (let i = 0; i < N; i++) {
      const x = inCh ? inCh[i] : 0;

      // Read oldest samples from each delay line.
      const endR = bufR[idx];      // right-going wave arriving at right end
      const endL = bufL[idx];      // left-going  wave arriving at left  end

      // Damping filter at each end: out = (1 - d/2)·in + (d/2)·prev
      // This is a mix between pass-through and two-point average (the
      // Karplus-Strong filter). DC gain = 1, Nyquist gain = 1 − damp.
      const dampedR = passThru * endR + dHalf * prevR;
      const dampedL = passThru * endL + dHalf * prevL;
      prevR = endR;
      prevL = endL;

      // Reflect — coefficient in [−1, +1] sets boundary character.
      const reflectedR = reflR * dampedR;   // travels leftward from right end
      const reflectedL = reflL * dampedL;   // travels rightward from left end

      // New samples entering each delay line.
      const newR = x + reflectedL;           // right-going: input + left reflection
      const newL = reflectedR;               // left-going:  right reflection
      bufR[idx] = newR;
      bufL[idx] = newL;

      // Output = pressure at the left (mouth) end:
      //   newly-injected right-going wave  +  left-going wave arriving
      outCh[i] = newR + endL;

      idx++;
      if (idx >= L) idx = 0;
    }

    this._idx   = idx;
    this._prevR = prevR;
    this._prevL = prevL;
  }
}
