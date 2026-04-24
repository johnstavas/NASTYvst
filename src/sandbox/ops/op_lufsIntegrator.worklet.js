// op_lufsIntegrator.worklet.js — Stage-3 op sidecar for the `lufsIntegrator` op.
//
// Catalog #52 (Loudness/Metering family). Canon:loudness §3 (BS.1770-5,
// EBU Tech 3341 V4 momentary/short-term loudness).
//
// WHAT IT DOES
//
// Reads pre-K-weighted audio (chain with #51 upstream) and emits a LUFS
// reading as a control signal. Two windows available via `mode`:
//
//   'momentary'  — 400 ms integration window (EBU Tech 3341 M)
//   'short-term' — 3   s  integration window (EBU Tech 3341 S)
//
// Output is in LUFS, a dB-scale loudness unit anchored to full-scale
// digital: 0 LUFS = stereo 1 kHz sine at 0 dBFS (both channels). All
// streaming-platform loudness targets (−14 LUFS Spotify, −16 Apple Music,
// −23 LUFS EBU R128 broadcast) are expressed in this unit.
//
// FORMULA (BS.1770-5 §3.1):
//
//   L = −0.691 + 10·log10(G · MS)
//
// where:
//   MS = mean-square of the K-weighted signal over the integration window
//   G  = channel weight (1.0 for L/R/C/mono, 1.41 for LFE, 0 to disable)
//   −0.691 = calibration constant so that stereo 1 kHz 0 dBFS → 0 LUFS
//
// A single channel of 1 kHz 0 dBFS sine through this op reads exactly
// −3 LUFS (because stereo sums the MS of two such channels; per-channel
// is −3 LU relative to that).
//
// WINDOW BALLISTICS
//
// BS.1770 defines the momentary window as a 400 ms rectangular average
// re-sampled at 100 ms stride, and the short-term window as 3 s rectangular.
// EBU Tech 3341 V4 §A.4 explicitly allows equivalent one-pole exponential
// averaging for real-time meter implementations — the error against true
// rectangular is below 0.1 LU for typical programme material, and the
// continuous display looks less steppy.
//
// Equivalent one-pole time constant: τ ≈ window_duration / 2
//   momentary  = 400 ms rect  →  τ = 200 ms
//   short-term = 3000 ms rect →  τ = 1500 ms
//
// STABILITY / FLOOR
//
//   - MS has a minimum floor of 1e-12 (≈ −120 dB) before the log to
//     prevent −∞ readings during absolute silence. Effective LUFS floor
//     is roughly −120 LUFS.
//   - Denormal flush on the MS state (Canon:utilities §1).
//   - Per-sample recomputation of log10 would be wasteful; control-rate
//     output is the MS converted to LUFS per sample, using Math.log10
//     which is cheap on modern V8/V8-like engines.

const MODES       = ['momentary', 'short-term'];
const LUFS_OFFSET = -0.691;     // BS.1770-5 calibration constant
const MS_FLOOR    = 1e-12;      // below this we cap at ~-120 LUFS
const DENORMAL    = 1e-30;

function tauForMode(mode) {
  // Equivalent one-pole τ for the BS.1770 rectangular window.
  // (EBU Tech 3341 V4 §A.4 accepts this approximation.)
  if (mode === 'short-term') return 1.5;    // 1500 ms
  return 0.2;                               // 200 ms  (momentary default)
}

export class LufsIntegratorOp {
  static opId = 'lufsIntegrator';
  static inputs  = Object.freeze([{ id: 'in',   kind: 'audio'   }]);
  static outputs = Object.freeze([{ id: 'lufs', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'mode',          default: 'momentary' },
    { id: 'channelWeight', default: 1.0         },
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._mode     = 'momentary';
    this._G        = 1.0;
    this._alpha    = 0;
    this._oma      = 1;
    this._p        = 0;           // running mean-square of K-weighted signal
    this._recomputeCoefs();
  }

  reset() {
    this._p = 0;
  }

  setParam(id, v) {
    if (id === 'mode') {
      this._mode = MODES.includes(v) ? v : 'momentary';
      this._recomputeCoefs();
      return;
    }
    if (id === 'channelWeight') {
      // Clamp G into the BS.1770 allowed range (0 for bypass, up to ~1.41 for LFE).
      this._G = Math.min(Math.max(+v, 0), 2);
    }
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    const tau = tauForMode(this._mode);
    this._alpha = Math.exp(-1 / (tau * this.sr));
    this._oma   = 1 - this._alpha;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.lufs;
    if (!outCh) return;

    const a   = this._alpha;
    const oma = this._oma;
    const G   = this._G;
    let   p   = this._p;

    if (!inCh) {
      // No input → let MS decay through the window time constant (meter
      // falls naturally, doesn't slam to -∞).
      for (let i = 0; i < N; i++) {
        p *= a;
        if (p < DENORMAL) p = 0;
        const ms = G * p > MS_FLOOR ? G * p : MS_FLOOR;
        outCh[i] = LUFS_OFFSET + 10 * Math.log10(ms);
      }
      this._p = p;
      return;
    }

    for (let i = 0; i < N; i++) {
      const x = inCh[i];
      p = oma * (x * x) + a * p;
      if (p < DENORMAL) p = 0;
      // Apply channel weight and floor before log.
      const ms = G * p > MS_FLOOR ? G * p : MS_FLOOR;
      outCh[i] = LUFS_OFFSET + 10 * Math.log10(ms);
    }

    this._p = p;
  }
}
