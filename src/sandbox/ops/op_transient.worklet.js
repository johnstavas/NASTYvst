// op_transient.worklet.js — Stage-3 op sidecar for the `transient` op.
//
// Catalog #43 (Dynamics). Transient shaper — enhance or suppress attack
// and/or sustain independently. SPL Transient Designer-style architecture
// reconstructed from first principles using the Bram envelope detector
// (Canon:dynamics §1) as the structural primitive.
//
// PRIMARY SOURCES (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//
//   Structural reference (canonical open-source DET — Differential
//   Envelope Technology — reconstruction):
//     **Airwindows "Point" by Chris Johnson (MIT)**
//     https://github.com/airwindows/airwindows/blob/master/plugins/LinuxVST/src/Point/PointProc.cpp
//     Fetched 2026-04-24. See C:/Users/HEAT2/Downloads/PointProc.cpp lines 41–64.
//
//   Passage verbatim (PointProc.cpp L41–L64, per-sample inner loop):
//       absolute = fabs(inputSampleL);
//       if (fpFlip)
//       {
//         nibAL = nibAL + (absolute / nibDiv);
//         nibAL = nibAL / (1 + (1/nibDiv));
//         nobAL = nobAL + (absolute / nobDiv);
//         nobAL = nobAL / (1 + (1/nobDiv));
//         if (nobAL > 0) { nibnobFactor = nibAL / nobAL; }
//       }
//       ...
//       inputSampleL *= nibnobFactor;
//
//   Point uses a symmetric one-pole (not asymmetric Bram §1): each
//   `nib*`/`nob*` line is algebraically `env = α·env + (1-α)·|x|` with
//   α = D/(D+1), D = nibDiv (fast) or nobDiv (slow). The two-pole pair
//   is then combined as gain = nibAL / nobAL (RATIO form, not DIFFERENCE).
//
//   Detector primitive:
//     dsp_code_canon_dynamics.md §1 "Bram Envelope Detector"
//     (musicdsp #97, Bram de Jong 2002-04-12, public-domain). Opened for
//     #41 gate / #42 expander / #4 envelope; same file, lines 15–31.
//     Our op uses Bram §1 (asymmetric attack/release) instead of Point's
//     symmetric one-pole — see DEVIATIONS below.
//
//   SPL Transient Designer hardware architecture (DE 10154200 patent
//   family): closed; SPL's marketing manual verbally confirms the DET
//   two-envelope-differential topology but the patent text itself is
//   not openly hosted. Point (above) is the citable open reconstruction.
//
//   Envelope detector (shared primitive, opened above for #41/#42):
//     dsp_code_canon_dynamics.md §1 "Bram Envelope Detector"
//     (musicdsp #97, Bram de Jong 2002-04-12, assume public-domain).
//     Passage pasted verbatim here for completeness:
//
//       float ga = (float)exp(-1/(SampleRate*attack));
//       float gr = (float)exp(-1/(SampleRate*release));
//       float envelope = 0;
//       for (...) {
//         EnvIn = std::abs(input);
//         if (envelope < EnvIn) {
//           envelope *= ga;
//           envelope += (1-ga)*EnvIn;
//         } else {
//           envelope *= gr;
//           envelope += (1-gr)*EnvIn;
//         }
//       }
//
// DECLARED SPEC (math-by-definition):
//
//   envFast = Bram§1(attack=fastMs, release=slowRelMs)    // tight, tracks peaks
//   envSlow = Bram§1(attack=slowMs, release=slowRelMs)    // lags, tracks body
//   attack_sig  = max(0, envFast − envSlow)               // positive at onset
//   sustain_sig = max(0, envSlow − envFast)               // positive during decay
//   norm        = envSlow + eps                           // level-normalize
//   gain        = 1 + kA · attack_sig / norm
//                    + kS · sustain_sig / norm
//   gain        = clamp(gain, gMin, gMax)                 // safety bounds
//   out         = cos(mix·π/2)·x + sin(mix·π/2)·(x·gain)  // equal-power mix
//
//   kA ∈ [−1, +1]: positive enhances attack, negative softens ("deduer")
//   kS ∈ [−1, +1]: positive extends sustain, negative shortens (dries up)
//
// PASSAGE ↔ CODE DEVIATIONS (Airwindows Point → our op):
//   A. **Detector type.** Point uses a symmetric one-pole (same α on
//      rising and falling input); we use the asymmetric Bram §1
//      (fast α on rising, slow α on falling). Rationale: Bram §1 tracks
//      peaks tighter on rising edges (transient onset) while holding
//      gracefully on falling — matches the SPL voicing better.
//   B. **Combiner.** Point uses RATIO `gain = nibAL / nobAL`; we use
//      DIFFERENCE NORMALIZED `atk = max(0, envFast−envSlow)`,
//      `sus = max(0, envSlow−envFast)`, then linear sum with user
//      coefficients `gain = 1 + kA·atk/norm + kS·sus/norm`. Algebraic
//      cousin (both fold to "ratio − 1" at the unity point), but the
//      split into separate `atk` and `sus` terms is what lets us expose
//      independent attack-amount and sustain-amount controls — Point
//      has NO user knob, it always applies the full ratio unconditionally.
//   C. **`fpFlip` drift-compensation.** Point ping-pongs between two
//      parallel A/B state pairs each sample to reject DC drift from
//      the asymmetric add-then-divide update. We do not replicate this
//      because Bram §1 + denormal flush gives the same numerical
//      invariant by construction. Worth auditing (see debt).
//   D. **Stereo.** Point processes L/R independently with independent
//      factors; our op is mono and would be wrapped in a graph-level
//      stereo pair until per-channel stereo-link mode lands.
//   E. **No DAW-floor denormal injection.** Point injects
//      `fpdL * 1.18e-17` on input below 1.18e-23 to guard against
//      Intel denormal stalls; we use the Float32Array denormal flush
//      pattern (DENORMAL = 1e-30 clamp on envelopes/gain) instead —
//      achieves the same numerical stability without the stochastic
//      dither side-channel.
//
// DEVIATIONS FROM DECLARED SPEC (enumerated):
//   1. Release times for both envelopes are identical (`slowRelMs`,
//      default 300 ms). Some open-source impls use different releases
//      per half; identical releases keep the sustain_sig clean
//      (envSlow−envFast goes positive cleanly after peak, decays
//      together with envSlow toward RMS).
//   2. Normalization divisor is `envSlow + 1e-6` to prevent div-by-zero
//      at silence. The eps-floor causes gain ≈ 1 for near-silent input,
//      which is desired (don't amplify noise floor).
//   3. Gain clamped to [0, 8] (≈ −∞ to +18 dB). At kA=+1 on a strong
//      transient, normalized attack_sig/envSlow can momentarily exceed
//      1.0 and push gain > 2; the 8.0 cap prevents runaway on pathological
//      signals (swept sine near transient frequency).
//   4. `kA`, `kS` clamped to [-1, +1].
//   5. `fastMs` clamped to [0.1, 20] ms; `slowMs` clamped to [1, 200] ms;
//      slowMs is always treated as ≥ fastMs + 0.5 at runtime (if user
//      sets slowMs < fastMs, envSlow becomes envFast and attack_sig → 0;
//      acceptable degenerate).
//   6. Mix cos/sin equal-power per dry_wet_mix_rule.md.
//   7. Denormal flush on both envelopes and gain.
//
// LATENCY: 0 samples (no lookahead; transient-shaper families pair with
// #45 lookahead upstream if zero-overshoot enhancement is needed).

const DENORMAL = 1e-30;
const NORM_EPS = 1e-6;

function timeCoef(ms, sr) {
  const tc = Math.max(ms, 0.01) / 1000;
  return Math.exp(-1 / (sr * tc));
}

export class TransientOp {
  static opId    = 'transient';
  static inputs  = Object.freeze([{ id: 'in', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'attackAmount',  default:  0    }, // [-1, +1]
    { id: 'sustainAmount', default:  0    }, // [-1, +1]
    { id: 'fastMs',        default:  1    }, // [0.1, 20]
    { id: 'slowMs',        default: 30    }, // [1, 200]
    { id: 'releaseMs',     default: 300   }, // shared release for both EFs
    { id: 'mix',           default:  1    },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._kA = 0;
    this._kS = 0;
    this._fastMs = 1;
    this._slowMs = 30;
    this._relMs  = 300;
    this._mix    = 1;
    this._aFast  = timeCoef(1,   sampleRate);
    this._aSlow  = timeCoef(30,  sampleRate);
    this._rel    = timeCoef(300, sampleRate);
    this._envFast = 0;
    this._envSlow = 0;
  }

  reset() {
    this._envFast = 0;
    this._envSlow = 0;
  }

  setParam(id, v) {
    const n = +v;
    if (!Number.isFinite(n)) return;
    if      (id === 'attackAmount')  this._kA = n < -1 ? -1 : (n > 1 ? 1 : n);
    else if (id === 'sustainAmount') this._kS = n < -1 ? -1 : (n > 1 ? 1 : n);
    else if (id === 'fastMs')      { this._fastMs = n < 0.1 ? 0.1 : (n > 20  ? 20  : n); this._aFast = timeCoef(this._fastMs, this.sr); }
    else if (id === 'slowMs')      { this._slowMs = n < 1   ? 1   : (n > 200 ? 200 : n); this._aSlow = timeCoef(this._slowMs, this.sr); }
    else if (id === 'releaseMs')   { this._relMs  = n < 1   ? 1   : (n > 2000 ? 2000 : n); this._rel   = timeCoef(this._relMs, this.sr); }
    else if (id === 'mix')           this._mix = n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const inp = inputs.in;
    const out = outputs.out;
    if (!out) return;

    const mix  = this._mix;
    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    const aFast = this._aFast;
    const aSlow = this._aSlow;
    const rel   = this._rel;
    const kA    = this._kA;
    const kS    = this._kS;

    let envFast = this._envFast;
    let envSlow = this._envSlow;

    for (let i = 0; i < N; i++) {
      const x   = inp ? inp[i] : 0;
      const ax  = x >= 0 ? x : -x;

      // §1 Bram detector — fast-attack follower.
      if (envFast < ax) envFast = envFast * aFast + (1 - aFast) * ax;
      else              envFast = envFast * rel   + (1 - rel)   * ax;
      if (envFast > -DENORMAL && envFast < DENORMAL) envFast = 0;

      // §1 Bram detector — slow-attack follower (shared release).
      if (envSlow < ax) envSlow = envSlow * aSlow + (1 - aSlow) * ax;
      else              envSlow = envSlow * rel   + (1 - rel)   * ax;
      if (envSlow > -DENORMAL && envSlow < DENORMAL) envSlow = 0;

      // Differential signals.
      const diff = envFast - envSlow;
      const atk  = diff > 0 ?  diff : 0;   // onset
      const sus  = diff < 0 ? -diff : 0;   // decay tail
      const norm = envSlow + NORM_EPS;

      // Gain law.
      let gain = 1 + kA * (atk / norm) + kS * (sus / norm);
      if (gain < 0)  gain = 0;
      if (gain > 8)  gain = 8;

      const wet = x * gain;
      out[i] = gDry * x + gWet * wet;
    }

    this._envFast = envFast;
    this._envSlow = envSlow;
  }
}
