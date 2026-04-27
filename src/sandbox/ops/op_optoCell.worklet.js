// op_optoCell.worklet.js — Stage-3 op sidecar for the `optoCell` op.
//
// #141 Dynamics — Phenomenological optical-isolator gain-reduction cell.
// Models the LA-2A-style T4 cell (electroluminescent panel + CdS LDR
// in a divider with thermal-coupling memory). NOT a physically-accurate
// T4 model; this is a two-state envelope phenomenology with parameter
// values anchored to Universal Audio's published T4 numbers.
//
// Cell topology: control signal (cv) modulates an EL panel; LDR
// resistance falls with intensity (~1/V^p); LDR sits in a divider that
// produces gain reduction. Two thermal time constants:
//   - Fast (~10 ms attack, ~60 ms initial release) — EL panel + LDR
//     reach 50% within milliseconds.
//   - Slow (1–15 s program-dependent) — sustained pinning warms the
//     EL panel; recovery slows as a function of how long the cell was
//     held in compression.
//
// PRIMARY (opened 2026-04-26 via WebFetch + memory cross-check):
//   1. Universal Audio, LA-2A application/blog page
//      (https://www.uaudio.com/blog/la-2a-collection-tips-tricks)
//      VERBATIM: "the average Attack time is 10 milliseconds, and the
//      Release time is about 60 milliseconds for 50% of the release,
//      and anywhere from 1 to 15 seconds for the rest" — program- and
//      frequency-dependent. T4 cell described as "light panel in the T4
//      cell" + "the photo resistor's impedance."
//      Tier: B (vendor educational blog, NOT service-manual technical
//      doc). Authoritative for the time-constant numbers we calibrate
//      against; not authoritative for circuit-level claims.
//
//   2. Giannoulis, D., Massberg, M., Reiss, J. D., "Digital Dynamic
//      Range Compressor Design — A Tutorial and Analysis," JAES
//      60(6):399–408, June 2012 (AES E-Library elib:16354). Tier: A
//      peer-reviewed JAES tutorial. Anchors compressor topology
//      (envelope follower → smoothing filter → gain computer →
//      multiplication). Does NOT cover optical cells specifically;
//      used as the topology anchor for the envelope/gain-mapping flow.
//
// MATH-BY-DEFINITION (declared per ship-protocol):
//   No peer-reviewed paper specifically models the LA-2A T4 thermal
//   coupling in DSP terms. DAFx archive, Faust libs, Eichas-Möller-
//   Zölzer family, JAES E-Library all checked 2026-04-26 — no match.
//   The two-state envelope phenomenology below is canonical opto-cell
//   folklore (textbook lineage: Zölzer DAFX 2e Ch.4, Reiss-McPherson
//   "Audio Effects") but no single peer-reviewed origin. Logged in
//   sandbox_ops_research_debt.md as P1 — when a peer-reviewed thermal-
//   model paper surfaces (e.g. a future DAFx contribution), V2 upgrade
//   replaces this phenomenology with the validated model.
//
// AUTHORING SHAPE:
//   Inputs  : cv   (audio — control signal, typically envelope output;
//                   half-wave rectified internally so polarity-agnostic)
//   Outputs : gain (audio — gain-reduction multiplier ∈ (0, 1])
//   Params  :
//     attackMs       (default 10,  range 0.1..100)  — UA: ~10 ms avg
//     releaseMsFast  (default 60,  range 5..500)    — UA: 60 ms for 50%
//     releaseSecSlow (default 5,   range 0.5..15)   — UA: 1–15 s program-dep
//     responsivity   (default 1.0, range 0.05..4.0) — k in 1/(1 + k·env^p)
//
// State: envFast, envSlow (both Float64), 2 doubles total.
//
// Algorithm:
//   For each sample:
//     1. Half-wave rectify input: cv_pos = max(0, cv).
//     2. Fast envelope follower: attack with α_attack, release with
//        α_releaseFast (asymmetric peak follower).
//     3. Slow envelope: low-pass of envFast at α_slow (symmetric;
//        always slow on both directions). This produces the
//        program-dependent thermal memory — sustained envFast
//        builds envSlow up; slow signals envSlow stays low.
//     4. Effective envelope: env = max(envFast, envSlow). After a
//        sustained transient, envFast drops fast but envSlow holds
//        → recovery slows to releaseSecSlow scale.
//     5. Gain mapping: gainOut = 1 / (1 + responsivity · env²).
//        Power p=2 captures LDR resistance ~ 1/intensity² behavior;
//        cell character emerges from the saturation of the divider
//        as env grows.
//
// AT cv == 0: gainOut = 1 (no compression, pass-through).
// AT cv steady-state: gainOut → 1/(1 + k·V²) (static GR curve).

const DENORMAL = 1e-30;

function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// Convert a time constant (in seconds) to a one-pole filter coefficient
// such that the filter reaches 1 - 1/e ≈ 63.2% in `tauSec`. Standard
// per-sample formula: α = 1 - exp(-1 / (tauSec · sr)).
function tauToAlpha(tauSec, sr) {
  if (tauSec <= 0) return 1;
  return 1 - Math.exp(-1 / (tauSec * sr));
}

export class OptoCellOp {
  static opId = 'optoCell';
  static inputs  = Object.freeze([{ id: 'cv',   kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'gain', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'attackMs',       default: 10  },
    { id: 'releaseMsFast',  default: 60  },
    { id: 'releaseSecSlow', default: 5   },
    { id: 'responsivity',   default: 1.0 },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate || 48000;
    this._attackMs       = 10;
    this._releaseMsFast  = 60;
    this._releaseSecSlow = 5;
    this._responsivity   = 1.0;

    // State (Float64 for thermal-memory accuracy at slow time constants).
    this.envFast = 0;
    this.envSlow = 0;

    // Derived coefficients.
    this._aAttack       = 0;
    this._aReleaseFast  = 0;
    this._aSlow         = 0;
    this._recompute();
  }

  reset() {
    this.envFast = 0;
    this.envSlow = 0;
  }

  setParam(id, v) {
    const x = +v;
    if (!Number.isFinite(x)) return;
    switch (id) {
      case 'attackMs':        this._attackMs       = clip(x, 0.1,  100);  break;
      case 'releaseMsFast':   this._releaseMsFast  = clip(x, 5,    500);  break;
      case 'releaseSecSlow':  this._releaseSecSlow = clip(x, 0.5,  15);   break;
      case 'responsivity':    this._responsivity   = clip(x, 0.05, 4.0);  break;
      default: return;
    }
    this._recompute();
  }

  getLatencySamples() { return 0; }

  _recompute() {
    this._aAttack      = tauToAlpha(this._attackMs       * 1e-3, this.sr);
    this._aReleaseFast = tauToAlpha(this._releaseMsFast  * 1e-3, this.sr);
    this._aSlow        = tauToAlpha(this._releaseSecSlow,         this.sr);
  }

  process(inputs, outputs, N) {
    const outCh = outputs.gain;
    if (!outCh) return;
    const cvCh  = inputs.cv;
    const aAtk  = this._aAttack;
    const aRelF = this._aReleaseFast;
    const aSlow = this._aSlow;
    const k     = this._responsivity;
    let envFast = this.envFast;
    let envSlow = this.envSlow;

    for (let i = 0; i < N; i++) {
      const cv = cvCh ? cvCh[i] : 0;
      // Half-wave rectify (cell only triggers on positive control).
      const cvPos = cv > 0 ? cv : 0;

      // Fast envelope: asymmetric peak follower.
      // Attack when input above current state, release when below.
      const aFast = (cvPos > envFast) ? aAtk : aRelF;
      envFast = envFast + aFast * (cvPos - envFast);
      if (envFast < DENORMAL) envFast = 0;  // denormal flush

      // Slow envelope: symmetric one-pole following envFast.
      // Tracks slow thermal accumulation in the EL panel; rises
      // slowly during sustained signals, releases slowly after.
      envSlow = envSlow + aSlow * (envFast - envSlow);
      if (envSlow < DENORMAL) envSlow = 0;

      // Effective envelope: max preserves fast attack, slow release.
      // - Brief peaks: envFast spikes, envSlow barely moves → env = envFast → fast recovery
      // - Sustained: envFast saturated, envSlow climbs to match → after release,
      //   envFast drops fast but envSlow holds → env = envSlow → slow recovery
      const env = envFast > envSlow ? envFast : envSlow;

      // Gain mapping: 1 / (1 + k · env²)
      // - env = 0 → gain = 1 (no compression)
      // - env grows → gain decreases (compression)
      // - Power-2 captures LDR resistance ~ 1/intensity² behavior
      const env2 = env * env;
      outCh[i] = 1 / (1 + k * env2);
    }
    this.envFast = envFast;
    this.envSlow = envSlow;
  }
}
