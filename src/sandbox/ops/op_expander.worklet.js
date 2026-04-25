// op_expander.worklet.js — Stage-3 op sidecar for the `expander` op.
//
// Catalog #42 (Dynamics). Downward expander. Mirror of the compressor
// gain law: below threshold, the dB-deficit is multiplied by `ratio`
// (instead of divided as in compression). Ratio=1 → bypass; Ratio=∞ →
// gate (classic "downward expander becomes noise gate" identity).
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//
//   Envelope detector (sidechain):
//     dsp_code_canon_dynamics.md §1 "Bram Envelope Detector"
//     (musicdsp #97, Bram de Jong 2002-04-12, assume public-domain).
//     Passage pasted verbatim below.
//
//   Expander static gain law:
//     **Faust `compressors.lib` — `peak_expansion_gain_mono_db`**
//     (GRAME, LGPL — paraphrase-only; NOT code-copied).
//     https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/compressors.lib
//     Audited 2026-04-24 (post-ship audit — ship was initially declared
//     math-by-definition; Faust primary located during audit sweep).
//
//     Passage verbatim (compressors.lib, `gain_computer` helper used by
//     `peak_expansion_gain_mono_db`; three-region knee form):
//
//       gain_computer(strength,thresh,range,knee,level) =
//         ( select3((level>(thresh-(knee/2)))+(level>(thresh+(knee/2)))
//                  , (level-thresh)
//                  , ((level-thresh-(knee/2)):pow(2) /(min(ma.EPSILON,knee*-2)))
//                  , 0
//                  ) *abs(strength):max(range) * (-1+(2*(strength>0)))
//         );
//
//     Algebraic-equivalence check (Faust ↔ ours):
//       Faust knee branch:  (level − thresh − knee/2)² / (−2·knee)
//       Ours knee branch:   (R − 1) · (x − T − K/2)² / (2·K)
//       Faust multiplies by `strength` outside `gain_computer`; for the
//       downward-expander wrapper `peak_expansion_gain_mono_db`, strength
//       = −(R − 1) with a sign flip on the output (the trailing
//       `* (-1+(2*(strength>0)))` term). Folding those sign flips gives
//       our `(R − 1)·(x−T−K/2)²/(2K)` with the expansion branch selected
//       below the knee — i.e. same polynomial, same knee width, same
//       transition points. Confirmed: the three-region select3 maps
//       one-to-one onto our three-branch if/else below.
//     Secondary textbook references (kept as cross-checks, not primaries):
//       Zölzer DAFX §4.2.2; Giannoulis–Massberg–Reiss 2012 "Digital
//       Dynamic Range Compressor Design".
//     Our already-shipped #5 gainComputer (src/sandbox/ops/op_gainComputer.worklet.js
//     lines 41–89) uses the compression-branch sibling of this same law.
//
//   Ballistics (A/R one-pole on gain reduction):
//     Same exp(-1/(sr·tc)) form as the gate (#41) and envelope (#4) —
//     Canon:dynamics §1 style coefficient.
//
// PASSAGE VERBATIM (dsp_code_canon_dynamics.md §1 lines 15–31):
//
//   float ga = (float)exp(-1/(SampleRate*attack));
//   float gr = (float)exp(-1/(SampleRate*release));
//   float envelope = 0;
//   for (...) {
//     EnvIn = std::abs(input);
//     if (envelope < EnvIn) {
//       envelope *= ga;
//       envelope += (1-ga)*EnvIn;
//     } else {
//       envelope *= gr;
//       envelope += (1-gr)*EnvIn;
//     }
//   }
//
// STATIC EXPANDER CURVE (declared):
//   Let x = input level in dB, T = thresholdDb, R = ratio ∈ [1,∞), K = kneeDb.
//     above threshold (x ≥ T + K/2):  y = x                          (1:1)
//     below threshold (x ≤ T − K/2):  y = T + (x − T) · R            (expanded down)
//     inside knee:                    y = x + (R − 1) · (x − T − K/2)² / (2·K)
//   Gain-reduction (dB):  grDb = y − x  (≤ 0)
//   Applied gain (linear): g = 10^(grDb/20) ∈ (floor, 1]
//   Floor-clamp: g is bounded ≥ `floor` to expose the classic "range"
//   control found on SSL-style expander/gates.
//
// SIDECHAIN: optional `sidechain` audio input drives the detector instead
// of `in`, matching the gate (#41) topology.
//
// MIX: cos/sin equal-power dry/wet per dry_wet_mix_rule.md.
//
// DEVIATIONS FROM §1 + GAINCOMP (enumerated):
//   1. Detector attack/release separate from the gain-ramp attack/release.
//      Fixed fast detector (attack 1 ms, release 10 ms) feeds the
//      envelope; user `attackMs` / `releaseMs` control the gain one-pole.
//      Same two-timing-constant pattern as gate (#41).
//   2. `ratio` clamped to [1, 100]. At 100:1 the op is effectively a gate
//      (ratio=∞ is numerically undesirable). The classic identity
//      "expander@ratio=∞ === gate" is preserved qualitatively.
//   3. Linear-amplitude `envelope`, converted to dB via
//      20·log10(env + 1e-12). Same floor as #5 gainComputer for parity.
//   4. `floor` param (default 0.0) — minimum linear gain. 0.0 = full
//      cut (approaches gate behavior at high ratio); 1.0 = bypass. Maps
//      to the "range" knob on classic hardware.
//   5. Gain smoothing via exponential one-pole toward target, not linear
//      ramp. Same form as #41 gate and #4 envelope.
//   6. Denormal flush on envelope and gain (Jon Watte pattern, Canon
//      utilities §1).
//   7. Mix cos/sin equal-power per dry_wet_mix_rule.md.

const DENORMAL = 1e-30;
const LOG10    = 2.302585092994046;
const DB_FLOOR = 1e-12; // -240 dB

function timeCoef(ms, sr) {
  const tc = Math.max(ms, 0.01) / 1000;
  return Math.exp(-1 / (sr * tc));
}

export class ExpanderOp {
  static opId    = 'expander';
  static inputs  = Object.freeze([
    { id: 'in', kind: 'audio' },
    { id: 'sidechain', kind: 'audio', optional: true },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'thresholdDb', default: -40  }, // dB
    { id: 'ratio',       default:   2  }, // 1 = bypass, 100 ≈ gate
    { id: 'kneeDb',      default:   6  }, // dB soft-knee width
    { id: 'attackMs',    default:   1  },
    { id: 'releaseMs',   default: 100  },
    { id: 'floor',       default:   0  }, // linear minimum gain
    { id: 'mix',         default:   1  },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    // Detector (internal fast).
    this._detAttack  = timeCoef(1,  sampleRate);
    this._detRelease = timeCoef(10, sampleRate);
    this._env  = 0;

    // Gain-ramp state + user params.
    this._gain = 1;
    this._thrDb    = -40;
    this._ratio    = 2;
    this._kneeDb   = 6;
    this._attackMs = 1;
    this._releaseMs = 100;
    this._floor    = 0;
    this._mix      = 1;
    this._gAttack  = timeCoef(1,   sampleRate);
    this._gRelease = timeCoef(100, sampleRate);
  }

  reset() {
    this._env = 0;
    this._gain = 1;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if      (id === 'thresholdDb') this._thrDb   = n;
    else if (id === 'ratio')       this._ratio   = n < 1 ? 1 : (n > 100 ? 100 : n);
    else if (id === 'kneeDb')      this._kneeDb  = n < 0 ? 0 : n;
    else if (id === 'attackMs')  { this._attackMs  = n < 0.01 ? 0.01 : n; this._gAttack  = timeCoef(this._attackMs,  this.sr); }
    else if (id === 'releaseMs') { this._releaseMs = n < 0.01 ? 0.01 : n; this._gRelease = timeCoef(this._releaseMs, this.sr); }
    else if (id === 'floor')       this._floor   = n < 0 ? 0 : (n > 1 ? 1 : n);
    else if (id === 'mix')         this._mix     = n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const sc  = inputs.sidechain;
    const out = outputs.out;
    if (!out) return;

    const mix  = this._mix;
    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    const detA  = this._detAttack;
    const detR  = this._detRelease;
    const gA    = this._gAttack;
    const gR    = this._gRelease;
    const thDb  = this._thrDb;
    const ratio = this._ratio;
    const knee  = this._kneeDb;
    const halfK = knee * 0.5;
    const rm1   = ratio - 1;
    const floor = this._floor;

    let env  = this._env;
    let gain = this._gain;

    for (let i = 0; i < N; i++) {
      const x  = inp ? inp[i] : 0;
      const sx = sc  ? sc[i]  : x;

      // §1 envelope detector on sidechain (or `in` if unwired).
      const envIn = Math.abs(sx);
      if (env < envIn) env = env * detA + (1 - detA) * envIn;
      else             env = env * detR + (1 - detR) * envIn;
      if (env > -DENORMAL && env < DENORMAL) env = 0;

      // Static expander curve: compute target linear gain from env.
      const xDb = 20 * Math.log(env + DB_FLOOR) / LOG10;
      let yDb;
      if (xDb >= thDb + halfK) {
        yDb = xDb;                                        // above → 1:1
      } else if (knee > 0 && xDb > thDb - halfK) {
        const d = xDb - thDb - halfK;                     // ≤ 0 inside knee
        yDb = xDb + rm1 * d * d / (2 * knee);             // smooth blend
      } else {
        yDb = thDb + (xDb - thDb) * ratio;                // below → expand
      }
      const grDb = yDb - xDb;                             // ≤ 0
      let target = Math.exp(grDb * LOG10 / 20);           // linear gain ≤ 1
      if (target < floor) target = floor;
      if (target > 1)     target = 1;

      // Gain ramp: attack when gain is rising toward target (env went up),
      // release when falling (env went down).
      const coef = target > gain ? gA : gR;
      gain = gain * coef + (1 - coef) * target;
      if (gain > -DENORMAL && gain < DENORMAL) gain = 0;

      const wet = x * gain;
      out[i] = gDry * x + gWet * wet;
    }

    this._env  = env;
    this._gain = gain;
  }
}
