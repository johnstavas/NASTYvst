# STEP 18 — Dynamics family architecture + CompressorModule

Opens the dynamics-family phase. Adds one palette module
(`CompressorModule`) and two shared helper classes (`LevelDetector`,
`GainComputer`). `EnvelopeFollowerModule` stays as-is — it remains the
control-rate sidechain source; `LevelDetector` is the per-sample
equivalent used inside the insert-style compressor.

## Signal flow (compressor insert)

```
in ─► CompressorModule ─► out
       │
       ├─ LevelDetector ×2   (peak | RMS | hybrid)          per-sample level
       ├─ GainComputer       (threshold / ratio / knee)     GR dB
       └─ dB-domain GR smoother (asymmetric atk/rel) + gain applier + parallel-mix
```

All three stages live in one module because the full loop is per-sample
and can't cross module boundaries without audio-rate routing.

## Module breakdown

| Piece | Kind | Notes |
|---|---|---|
| `LevelDetector`        | helper class (not palette) | per-sample, single-channel; peak / RMS / hybrid. Two instances per CompressorModule (one per channel). Reusable by Expander / Limiter / Gate / Ducker. |
| `GainComputer`         | helper class (not palette) | stateless soft-knee curve (Giannoulis). `(xdB) → grDb ≤ 0`. |
| `CompressorModule`     | palette index **12** | insert dynamics. Owns 2×LevelDetector + GainComputer. Feedforward. |
| `EnvelopeFollowerModule` | palette index 11 (existing) | **unchanged.** Control-rate sidechain — posts level via port. Conceptual "detector base"; the audio-rate descendant is `LevelDetector` + CompressorModule. |

Helpers (not palette) keep the palette lean. Adding Expander / Limiter /
Gate later reuses `LevelDetector` + `GainComputer` with a different curve
and smoother.

## Detector modes

- **0 Peak**: `|x|` instantaneous. Fastest transient response.
- **1 RMS**: one-pole LP on `x²` (5 ms default window), then `sqrt`. Loudness-correlated, smoother.
- **2 Hybrid**: `max(peak, √2 · rms)`. Catches both transient and sustained energy — SSL bus-comp feel.

Detector mode is orthogonal to attack/release — any mode pairs with any atk/rel.

## Attack / release — dB-domain gain smoothing

Classic VCA topology. Per sample:

```
lvl     = LevelDetector.tick(x, mode)
xdB     = 20·log10(lvl)
grInst  = GainComputer.compute(xdB)       // ≤ 0
if grInst < grSmooth:  grSmooth = atkC·grSmooth + (1−atkC)·grInst   // attack = gain drops
else                   grSmooth = relC·grSmooth + (1−relC)·grInst   // release = gain recovers
gainLin = 10^((grSmooth + makeup) / 20)
out     = in·(1−mix) + in·gainLin·mix
```

Why dB-domain (not level-domain): attack/release times then correspond
directly to how fast the VCA moves, independent of input level. This is
the textbook Zölzer Ch.4 / Reiss formulation.

## Topology

Feedforward. Detector reads pre-gain input. Feedback (detector reads
output post-gain, vintage-authentic for LA-2A/1176) can be added later
via a single `topology` param inside CompressorModule — no new module.
Not wired now.

## Parameter mapping

| Param | Range | Default | Notes |
|---|---|---|---|
| `threshold`  | −60 .. +6 dB  | −18 | |
| `ratio`      | 1 .. 30       | 4   | 1 = off, large = limiter feel |
| `knee`       | 0 .. 24 dB    | 6   | soft-knee width |
| `attackMs`   | 0.1 .. 200 ms | 10  | exp skew |
| `releaseMs`  | 5 .. 2000 ms  | 120 | exp skew |
| `makeupDb`   | −12 .. +24 dB | 0   | |
| `detectMode` | 0 / 1 / 2     | 0   | rounded to nearest int in worklet |
| `stereoLink` | 0 / 1         | 1   | 1 = max(L,R) drives both; 0 = independent |
| `mix`        | 0 .. 1        | 1.0 | parallel / NY compression |

All smoothed by the worklet's two-stage `ParamSmoother` with
comp-appropriate time constants (25/5 ms for `threshold/makeup/mix`,
50/25 ms for everything else so ratio/knee/times step softly without
zipper).

## Product / core split

### Core
- `LevelDetector`, `GainComputer` (helpers).
- `CompressorModule` (palette 12): per-sample DSP only. No product knowledge.

### Product layer (where voicing lives)
- **LVL-2A** (opto, program-dependent release):
  - `detectMode = 1` (RMS), `ratio = 3`, `knee = 6`, `attackMs = 10`.
  - Product-layer timer runs a second slow envelope of the input (or of the reported GR) and writes `releaseMs` dynamically 60 → 2000 ms — the opto two-time-constant memory.
  - PEAK REDUCTION macro → `threshold` + slight ratio bias. GAIN macro → `makeupDb`.
- **GlueSmash** (1176 all-buttons):
  - `detectMode = 0` (peak), `knee = 0`, `ratio = 20`, `attackMs = 0.3`, `releaseMs = 50`.
  - SQUASH macro → threshold ↓ and ratio ↑ together. MIX macro → parallel blend via `mix`.
  - Optional `TapeCharacterModule` in front for 1176 transformer character — **no new core**.
- **Panther Buss** (bus glue):
  - `detectMode = 2` (hybrid), `knee = 10`, `ratio = 2`, `attackMs = 10`, `releaseMs = 220`.
  - GLUE macro couples release + knee + makeup together.
  - Optional TiltEq in front of compressor for frequency-weighted detection.

None of these products require new core code. All voicings are macro
fan-outs + optional prepended palette modules + optional control-rate
timers (the same pattern Smear/Orbit/PlateX already proved).

## Files

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `LevelDetector`, + `GainComputer`, + `CompressorModule`; palette index 12 |
| `src/core/fxEngine.js`   | + `MODULE.COMPRESSOR`; `COMPRESSOR_PARAMS` |

## Rules honoured

- **EnvelopeFollowerModule unchanged.** It remains the sidechain source;
  `LevelDetector` is the per-sample descendant used where port round-trips
  are too slow. The conceptual lineage is documented; code duplication is
  minimal (`LevelDetector` adds RMS + hybrid on top of the peak tracking
  the follower already does).
- **No unnecessary modules.** Detector and gain computer are helper
  classes, not palette entries, because palette entries require audio-buffer
  I/O and these stages exchange scalars.
- **Clean separation** of level measurement (LevelDetector), curve
  (GainComputer), and application (smoother + mul). Each stage is
  self-contained and testable.
- **Product-specific behaviour deferred to products.** LVL-2A / GlueSmash
  / Panther Buss all ship as macro fan-out on top of CompressorModule —
  no per-product core changes anticipated.

## Stability notes

- Gain reduction is ≤ 0 dB by construction (`GainComputer._slope ≤ 0`,
  and the quadratic branch inside the knee window is also ≤ 0). The
  smoother is a one-pole on a bounded input → bounded output.
- `gainLin = 10^(grDb/20)` with `grDb ≤ 0` and `makeup` clamped in
  parameter range → output gain ≤ 10^(24/20) ≈ 15.85 worst-case, well
  within float32 range.
- No feedback path from output to detector (FF topology) → no self-osc
  possible under any parameter combination.
- `detectMode` is rounded to {0,1,2} per sample — no illegal indices.
- `1e-9` floor inside the `log10` prevents `-Infinity` on silence.

## Risks to test on real audio

- Very fast `attackMs` (< 1 ms) on transient-heavy material → verify
  no distortion from gain-change artefacts; if audible, consider adding
  a 1-sample-ahead lookahead (would require latency reporting).
- `stereoLink = 0` on wide stereo sources → verify image doesn't skew
  when one channel peaks hard.
- `ratio = 30` + `attackMs = 0.1` + `knee = 0` → limiter territory;
  verify no overshoot beyond threshold by more than a handful of samples.
- `mix < 1` at extreme GR → NY compression should sum cleanly without
  cancellation artefacts.

## Architectural state after Step 18

Dynamics-family core is online. Three in-plan products (LVL-2A,
GlueSmash, Panther Buss) are now trivially shippable as product files.
Future dynamics additions — **Expander**, **Limiter**, **Gate**,
**Ducker** — will each be a new small palette entry that reuses the
same `LevelDetector` + `GainComputer` helpers with a different curve
shape or smoother policy. No further palette bloat anticipated.

Next: pick a first dynamics product (recommend GlueSmash — fewest
product-layer dependencies, fastest validation of CompressorModule
under aggressive settings).
