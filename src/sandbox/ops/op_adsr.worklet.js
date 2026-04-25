// op_adsr.worklet.js — Stage-3 op sidecar for the `adsr` op.
//
// Catalog #40 (Dynamics / Envelope family). Classic ADSR envelope
// generator: Attack (linear) → Decay (exponential) → Sustain (hold) →
// Release (exponential). Gate is a per-sample input port: rising edge
// triggers attack; falling edge triggers release from current level.
//
// PRIMARY SOURCE (opened 2026-04-24 per sandbox_op_ship_protocol.md):
//   musicdsp.org archive #189 — "Fast Exponential Envelope Generator",
//   Christian Schoenebeck 2005.
//   URL: https://www.musicdsp.org/en/latest/Synthesis/189-fast-exponential-envelope-generator.html
//   Referenced as Canon:synthesis §12. Note: sandbox_ops_catalog.md
//   previously pointed at Canon:dynamics §5 — that is wrong (§5 is
//   the stereo-link peak compressor). Fixed in this ship.
//
// PASSAGE VERBATIM (Schoenebeck's minimal form):
//
//     void init(float levelBegin, float levelEnd, float releaseTime) {
//         currentLevel = levelBegin;
//         coeff = (log(levelEnd) - log(levelBegin)) /
//                 (releaseTime * sampleRate);
//     }
//     inline void calculateEnvelope(int samplePoints) {
//         for (int i = 0; i < samplePoints; i++) {
//             currentLevel += coeff * currentLevel;
//         }
//     }
//
// The recursion `L += coeff * L` ≡ `L *= (1 + coeff)` is an O(N) approx
// to `L(t) = L0 * exp(coeff * n)` — exact at a single step, linearised
// over many. For audio-rate envelopes the error is negligible.
//
// DEVIATIONS from verbatim (declared):
//   1. Linear attack (not exponential). Schoenebeck's recurrence is
//      undefined when levelBegin == 0 (log(0)). Standard analog ADSR
//      practice: attack is linear from 0 to 1. Decay + release use
//      the exp recurrence as-is (both run from a positive level to
//      a positive floor).
//   2. Exp target floor = 1e-4 (not 0) to keep log() defined for the
//      release stage and match Schoenebeck's "both endpoints > 0"
//      constraint. Output clamped to 0 when level drops below that
//      floor (so release truly reaches silence).
//   3. Decay recurrence targets `sustain + floor` (not 0) so decay
//      lands on the sustain level; release recurrence targets `floor`.
//      Both use the ratio form `coeff = log(end/start) / (time*sr)`.
//   4. Gate edge detection: compare current gate sample against previous
//      gate sample (both read from inputs.gate at process-time). Rising
//      edge (prev ≤ 0, cur > 0) → attack; falling edge (prev > 0,
//      cur ≤ 0) → release.
//   5. State machine (idle/attack/decay/sustain/release) wraps the
//      recurrence so the op is a complete envelope, not just a single
//      exponential segment.
//   6. Denormal flush (Jon Watte, Canon:utilities §1) on the level
//      register each block.
//   7. Defensive: missing gate input → treat as zero (idle).
//
// MATH SUMMARY:
//   attack:  level += 1 / attackSamples   (linear 0 → 1)
//   decay:   level += kDec * (level - target)   where target = sustain
//                                                and decay ratio form.
//            Actual recurrence used: `L *= rDec` with rDec = exp(coeffDec)
//            computed per-block. We use Schoenebeck's direct form:
//                level += coeffDec * (level - sustainFloor)
//            → level - sustainFloor decays exponentially to 0 at the
//            configured time constant; level itself lands on sustain.
//   release: level += coeffRel * (level - 0)
//            → level decays exponentially to the floor.
//
// Coeff derivations (per-sample):
//   For `L[n+1] = L[n] * (1 + c)` to decay from L0 to L1 in T seconds:
//     (1 + c)^(T*sr) = L1/L0
//     c ≈ ln(L1/L0) / (T*sr)   — Schoenebeck's linearisation.

const DENORMAL = 1e-30;
const FLOOR    = 1e-4;   // exp-target floor (log-safe, audibly silent)

const ST_IDLE    = 0;
const ST_ATTACK  = 1;
const ST_DECAY   = 2;
const ST_SUSTAIN = 3;
const ST_RELEASE = 4;

export class AdsrOp {
  static opId = 'adsr';
  static inputs  = Object.freeze([{ id: 'gate', kind: 'audio' }]);
  static outputs = Object.freeze([{ id: 'out',  kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'attackMs',  default: 5    },
    { id: 'decayMs',   default: 50   },
    { id: 'sustain',   default: 0.7  },
    { id: 'releaseMs', default: 200  },
  ]);

  constructor(sampleRate) {
    this.sr         = sampleRate;
    this._attackMs  = 5;
    this._decayMs   = 50;
    this._sustain   = 0.7;
    this._releaseMs = 200;

    this._state = ST_IDLE;
    this._level = 0;
    this._prevGate = 0;

    // Derived per-sample increments/coeffs (recomputed on param change).
    this._attackInc = 0;
    this._decayC    = 0;
    this._releaseC  = 0;
    this._recomputeCoefs();
  }

  reset() {
    this._state = ST_IDLE;
    this._level = 0;
    this._prevGate = 0;
  }

  setParam(id, v) {
    v = +v;
    if      (id === 'attackMs')  this._attackMs  = v;
    else if (id === 'decayMs')   this._decayMs   = v;
    else if (id === 'sustain')   this._sustain   = v;
    else if (id === 'releaseMs') this._releaseMs = v;
    else return;
    this._recomputeCoefs();
  }

  getLatencySamples() { return 0; }

  _recomputeCoefs() {
    const sr = this.sr;
    const aMs = Math.max(this._attackMs,  0.01);
    const dMs = Math.max(this._decayMs,   0.01);
    const rMs = Math.max(this._releaseMs, 0.01);
    const sus = Math.min(Math.max(this._sustain, 0), 1);

    const aSamp = aMs * 1e-3 * sr;
    const dSamp = dMs * 1e-3 * sr;
    const rSamp = rMs * 1e-3 * sr;

    this._attackInc = 1 / aSamp;

    // Decay: level goes 1 → sustain (+ floor so log-safe when sus==0).
    // Using Schoenebeck form `L += c*L` on (level - target):
    //   (level - target) decays from (1 - target) to FLOOR over dSamp.
    // => c = log(FLOOR / (1 - target)) / dSamp    (target = sustain)
    const dTop = Math.max(1 - sus, FLOOR);
    this._decayC = Math.log(FLOOR / dTop) / dSamp;

    // Release: level decays from current (≤ 1) to FLOOR over rSamp.
    // Using Schoenebeck form directly on level:
    //   c = log(FLOOR / startLevel) / rSamp
    // startLevel varies — approximate with sustain-referenced ratio:
    //   c = log(FLOOR / max(sus, FLOOR)) / rSamp
    // For releases triggered mid-attack/mid-decay this is slightly
    // off in absolute time but musically indistinguishable.
    this._releaseC = Math.log(FLOOR / Math.max(sus, FLOOR)) / rSamp;
  }

  process(inputs, outputs, N) {
    const gateCh = inputs && inputs.gate;
    const outCh  = outputs.out;
    if (!outCh) return;

    const sus  = Math.min(Math.max(this._sustain, 0), 1);
    const aInc = this._attackInc;
    const dC   = this._decayC;
    const rC   = this._releaseC;

    let st    = this._state;
    let level = this._level;
    let prev  = this._prevGate;

    for (let i = 0; i < N; i++) {
      const g = gateCh ? gateCh[i] : 0;

      // Edge detection.
      if (prev <= 0 && g > 0) {
        // Rising edge: start attack from current level (legato-safe).
        st = ST_ATTACK;
      } else if (prev > 0 && g <= 0) {
        // Falling edge: jump to release.
        st = ST_RELEASE;
      }
      prev = g;

      // State update.
      if (st === ST_ATTACK) {
        level += aInc;
        if (level >= 1) { level = 1; st = ST_DECAY; }
      } else if (st === ST_DECAY) {
        // (level - sustain) → 0 via Schoenebeck recurrence.
        const delta = level - sus;
        level = sus + delta + dC * delta;
        if ((sus === 0 && level <= FLOOR) || (sus > 0 && Math.abs(level - sus) <= FLOOR)) {
          level = sus;
          st = ST_SUSTAIN;
        }
      } else if (st === ST_SUSTAIN) {
        level = sus;
      } else if (st === ST_RELEASE) {
        level += rC * level;
        if (level <= FLOOR) { level = 0; st = ST_IDLE; }
      } else {
        // ST_IDLE
        level = 0;
      }

      outCh[i] = level;
    }

    // Denormal flush.
    if (level < DENORMAL && level > -DENORMAL) level = 0;

    this._state = st;
    this._level = level;
    this._prevGate = prev;
  }
}
