# STEP 19 — CompressorModule refinements + LimiterModule

## CompressorModule refinements (internal only)

1. **RMS window tied to attack.** `LevelDetector` now exposes `setWindow(ms)`;
   per block, CompressorModule sets `rmsWindowMs = clamp(attackMs · 0.5, 1, 50)`.
   Detector integration automatically matches program response — no
   user-facing knob, no interface change.
2. **Safety clamps.** Explicit `level < 1e-9 → 1e-9` floor applied before
   `log10`. `grL`/`grR` clamped to `≤ 0` after smoothing as belt-and-braces
   (the smoother is already ≤ 0 by construction from bounded inputs).
3. **Stereo-link selector** restructured as a `switch` on a link-mode
   value. Today only `MAX_LINK` (case 1) and `INDEPENDENT` (default) are
   active, matching prior behaviour. Future link modes (min-link, MS,
   RMS-avg) slot in without further refactor.

Interfaces, palette index, parameter mapping — unchanged.

## LimiterModule (palette index 13)

Brick-wall peak limiter. Reuses `LevelDetector` (peak mode) and
`GainComputer` (hard knee, ratio = 100) per Step-18 architecture.

### Signal flow

```
in ─► [write → lookahead buffer] ─► delayed × gainLin ─► out
        │
        └─► LevelDetector (peak) ─► GainComputer(ceiling, 100, 0) ─► dB smoother
            (attack = lookaheadMs; release from param)
```

Lookahead buffer is a pair of circular Float32Arrays sized for 5 ms at
`sr`. Detector runs on the incoming ("future") sample; the smoothed GR
is applied to the delayed sample so the gain is already reduced by the
time the peak reaches the output.

### Parameters

| Param | Range | Default | Notes |
|---|---|---|---|
| `ceiling`     | −24 .. 0 dB   | −0.3  | threshold = output max |
| `releaseMs`   | 1 .. 1000 ms  | 80    | exp skew |
| `lookaheadMs` | 0 .. 5 ms     | 2     | also sets attack time |
| `mix`         | 0 .. 1        | 1.0   | parallel limiting |

Attack time: equals `lookaheadMs` when > 0; falls back to 0.05 ms
otherwise (zero-latency fast limiter for live monitoring).

### Latency reporting

`latencySamples()` returns `round(lookaheadMs · sr / 1000)`. The
FxProcessor doesn't aggregate module latency yet, but the method is
there for the host when the aggregation step lands.

### Reuse tally

- `LevelDetector` — 3 consumers now (2× in CompressorModule, 2× in
  LimiterModule).
- `GainComputer` — 2 consumers now (CompressorModule, LimiterModule).

Helpers validated as the right level of abstraction. No palette bloat.

### Stability notes

- Ratio 100 + hard knee → GR grows linearly with `over_dB` for any input
  above ceiling; bounded.
- `gr ≤ 0` enforced after smoothing.
- Lookahead buffer indices clamped to `[0, _bufSize − 1]`.
- True-stereo link (single `gr`) prevents image skew on asymmetric
  transients — appropriate for a brick-wall peak limiter.
- No feedback path.

### Files

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `LimiterModule`; palette index 13; CompressorModule internal refinements |
| `src/core/fxEngine.js`   | + `MODULE.LIMITER`; `LIMITER_PARAMS` |

### Risks to test on real audio

- `lookaheadMs = 0` on program material with sharp transients → confirm
  no audible overshoot; if audible, user can enable 1–2 ms lookahead.
- `ceiling = 0 dB` with slightly-over signal → verify exact clamp (no
  ISP handling; inter-sample peaks may still exceed by < 0.5 dB on
  narrow spikes — candidate for a future `oversample` param).
- Long `releaseMs` on dense material → verify recovery isn't so slow
  that sustained loud passages lose punch.
- `mix < 1` (parallel) → useful for dual-stage mastering; verify phase
  coherence (the delayed dry and the delayed-and-gained wet share the
  same delay, so phase matches by construction).

### Architectural state after Step 19

Dynamics palette now: EnvelopeFollower (11), Compressor (12), Limiter
(13). All three share the `LevelDetector` + `GainComputer` foundation
(helpers) or the control-rate port pattern (follower). Future additions
— Expander, Gate, Ducker, MultibandComp — continue the pattern: each
is a small palette entry reusing the helpers with a different curve
and smoother policy.
