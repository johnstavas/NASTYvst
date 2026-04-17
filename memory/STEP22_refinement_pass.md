# STEP 22 — Engine refinement pass (documentation)

Closes the core-DSP phase. No new modules, no API changes, no signal-flow
edits. Six targeted refinements applied to `src/core/dspWorklet.js`; this
note documents the two behaviours worth calling out explicitly.

## Limiter attack behaviour

`LimiterModule` intentionally exposes no `attackMs` parameter. Attack is
derived internally from `lookaheadMs`:

```
atkMs = lookaheadMs > 0 ? max(0.1, lookaheadMs · 0.4) : 0.05
```

Rationale:

- The defining property of a brick-wall limiter is that gain reduction
  must be *already applied* when the triggering peak reaches the output.
- With lookahead `L` samples of delay in the audio path and attack time
  constant τ, the GR envelope reaches `1 − e^{−L/τ}` of its target by
  the time the peak arrives. `τ = L` leaves a ~37 % overshoot; `τ ≈
  0.4·L` gives ~2.5 time-constants of settling and effectively clamps
  the peak.
- Exposing attack as a separate control would let users break the
  invariant (attack > lookahead → overshoot, attack ≪ lookahead → early
  pumping). Tying them removes that failure mode entirely.
- When `lookaheadMs = 0` (zero-latency mode), attack falls back to
  0.05 ms — fast enough to act as a transparent ceiling in live
  monitoring, with the understanding that inter-sample transients can
  still exceed the ceiling briefly.

Behaviour summary: `lookaheadMs` is both the latency knob *and* the
attack-speed knob. This is the correct shape — one dial controls the
one trade-off (latency ↔ peak control).

## Engine stability — self-healing and finite guards

Five small guards were added across the engine. All are bounded-cost
(one branch or one finite check) and exist to prevent a single
transient NaN / out-of-range value from latching the engine into a
degraded state.

| Site | Guard | Why it matters |
|---|---|---|
| `ParamSmoother.setTarget(v)` | `if (Number.isFinite(v)) this.target = v;` | A non-finite target from main-thread automation would poison `target → block → value` forever, silencing every downstream coefficient. Dropping the update is strictly safer than propagating NaN. |
| `DelayLine.read(d)` | `if (!(d >= 0)) d = 0; if (d > N − 4) d = N − 4;` | The first test also catches NaN (NaN fails `>= 0`). Rapid length modulation or an upstream LFO glitch can briefly produce d < 0 or NaN, which would make the Lagrange-3 interpolation explode. Clamping keeps every time-varying delay bulletproof. |
| `CompressorModule` block tail | `this._grDbL = Number.isFinite(grL) ? grL : 0;` (and R) | If a NaN sample slipped into the detector, the smoothed GR state would latch at NaN and silence the channel permanently. Resetting to 0 dB GR self-heals on the next block. |
| `LimiterModule` block tail | `this._grDb = Number.isFinite(gr) ? gr : 0;` | Same pattern, single shared GR state (true-stereo link). |
| `SaturatorModule` ADAA quotient | `if (!Number.isFinite(yL)) yL = this._f(xL, …);` (and R) | The `|Δx| > 1e-6` threshold catches the obvious division-by-zero, but float32 rounding in `F(x) − F(xPrev)` at very high drive can still yield Infinity/NaN for Δx values that squeak past the threshold. Fallback to the raw nonlinearity gives the mathematically-correct value and costs nothing on the normal path. |

Design stance:

- These are **belt-and-braces** guards, not replacements for correct
  arithmetic. The DSP is already bounded by construction (ADAA ε
  fallback, RBJ stability, bounded curves). The guards exist so that
  *external* contamination (upstream plugin glitch, bad automation
  value, host-side NaN) cannot turn a one-sample fault into a
  permanent silence or sustained spike.
- Per-sample cost is negligible — the compressor/limiter checks run
  once per block, the smoother check once per parameter write, the
  delay-read check is a single comparison that the branch predictor
  handles trivially, and the ADAA check is only evaluated when the
  quotient branch runs.
- No change to module APIs, no change to palette indices, no change
  to parameter maps. `src/core/fxEngine.js` is untouched.

## Refinement phase — closed

Six refinements applied and documented. Further refinement is deferred
until a real listening or profiling signal appears (measured aliasing,
audible overshoot, CPU hotspot, instability reproduced on specific
material). No speculative tuning.

Core DSP phase is complete. Next phase is product/UI polish —
metering, preset systems, product wrappers, UI glue — none of which
touches the core palette.
