# STEP 21 — EqModule (5-band RBJ biquad EQ utility)

Final utility module before the refinement phase. One palette entry,
zero colouration.

## Signal flow

```
in ─► HP ─► LowShelf ─► PeakBell ─► HighShelf ─► LP ─► out
      (biquad, RBJ cookbook coefficients, transposed DF-II, stereo)
```

Five biquad sections in series. Each section holds its own
`[b0, b1, b2, a1, a2]` coefficients (normalized by `a0`) plus two pairs
of state variables `(sL1, sL2)` and `(sR1, sR2)` for stereo transposed
direct-form II.

Why transposed DF-II: best numerical behaviour at low frequencies for
fixed-Q designs (fewer cancellation issues than DF-I). Coefficient
recomputation happens once per block; the inner loop is pure
multiply-adds.

## Module API

```
EqModule (palette 15)

  params:
    hpOn, hpFreq, hpQ                      # HP: no gain
    lsFreq, lsGain, lsQ                    # low shelf
    pkFreq, pkGain, pkQ                    # peaking bell
    hsFreq, hsGain, hsQ                    # high shelf
    lpFreq, lpQ, lpOn                      # LP: no gain

  process(inL, inR, outL, outR, n)
  reset()
  latencySamples() → 0
```

Internal `BiquadSection` helper exposes:
- `setHP(f, q, sr)`
- `setLP(f, q, sr)`
- `setPeak(f, gainDb, q, sr)`
- `setLowShelf(f, gainDb, q, sr)`
- `setHighShelf(f, gainDb, q, sr)`
- `setBypass()` → coefficients `[1, 0, 0, 0, 0]` (pass-through)
- `processL(x)`, `processR(x)`
- `reset()`

`BiquadSection` is an internal helper (not a palette entry); reusable
inside future filter-based modules if we ever build a true parametric
per-band module.

## Per-block coefficient update

Each block, for each section:
- Shelves / bell: if `|gain| < 0.01 dB` → `setBypass()`, else recompute.
- HP / LP: if `on < 0.5` → `setBypass()`, else recompute.

This means "flat at 0 dB" is free (identity coefficients, no multiplies
beyond `b0·x = x`) and wideband sweeps smoothly follow the 50/25 ms
smoothers without per-sample trigonometry.

## Parameter mapping

| Param | Range | Default | Skew |
|---|---|---|---|
| `hpOn`    | 0 / 1            | 0     | linear |
| `hpFreq`  | 20 .. 1000 Hz    | 80    | **exp** |
| `hpQ`     | 0.3 .. 2         | 0.707 | linear |
| `lsFreq`  | 30 .. 400 Hz     | 120   | **exp** |
| `lsGain`  | −18 .. +18 dB    | 0     | linear |
| `lsQ`     | 0.3 .. 2         | 0.707 | linear |
| `pkFreq`  | 100 .. 10000 Hz  | 1000  | **exp** |
| `pkGain`  | −18 .. +18 dB    | 0     | linear |
| `pkQ`     | 0.3 .. 10        | 1.0   | linear |
| `hsFreq`  | 1k .. 16k Hz     | 6000  | **exp** |
| `hsGain`  | −18 .. +18 dB    | 0     | linear |
| `hsQ`     | 0.3 .. 2         | 0.707 | linear |
| `lpFreq`  | 2k .. 20k Hz     | 18000 | **exp** |
| `lpQ`     | 0.3 .. 2         | 0.707 | linear |
| `lpOn`    | 0 / 1            | 0     | linear |

All frequency params log-skewed in `fxEngine`. Smoother windows
50/25 ms on every param (coefficient recomputation is per-block, so the
audible rate of change is the smoother's block-window).

## Product / core split

### Core
- `EqModule`: clean biquad cascade. No colouration, no dynamic EQ, no
  linear-phase, no mid/side, no oversampling, no analog modelling.
  RBJ formulas as-is.

### Product layer (where any voicing lives)
- Console-style voicings (Pultec curves, SSL lows, API mids) → product
  macros that write specific `(freq, gain, q)` combinations.
- Tilt-plus-presence or mastering EQ products → compose EqModule with
  existing `TiltEqModule` in the chain.
- Adaptive / dynamic EQ behaviour → product-layer control-rate timers
  write `pkGain` from an `EnvelopeFollower` subscription, following the
  PlateX pattern.

## Stability notes

- RBJ biquads are stable for all `Q > 0`, `0 < f < sr/2`. Worklet
  clamps `f` to `min(sr·0.499, max(1, f))` and `q ≥ 0.05` before
  coefficient calculation → no pole-on-unit-circle edge case.
- Coefficient normalization divides by `a0`; `a0 > 0` always for RBJ
  forms.
- Gain clamp |gainDb| ≤ 18 dB keeps coefficients well-conditioned.
- Transposed DF-II: state variables are bounded for bounded input.
- `setBypass()` for flat bands costs one multiply per sample (identity
  `b0·x`), a minor wastage acceptable for code simplicity; can be
  promoted to a literal `y = x` branch later if profiling shows it
  matters.

## Files

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `BiquadSection` helper, + `EqModule`; palette index 15 |
| `src/core/fxEngine.js`   | + `MODULE.EQ`; `EQ_PARAMS` |

## Rules honoured

- **Single palette entry.** Five biquads live inside, not as separate
  palette modules.
- **3–5 bands max.** Exactly 5 (HP, LowShelf, Bell, HighShelf, LP).
- **Standard RBJ cookbook.** No custom curves, no analog modelling,
  no dynamic or linear-phase modes.
- **Clean and generic.** Zero product-specific voicing. No extra
  features. `BiquadSection` is internal; reusable if a second consumer
  ever appears.
- **Stable and efficient.** Per-block coefficient recompute, per-sample
  pure multiply-adds, transposed DF-II for low-frequency conditioning,
  identity-coefficient bypass when a band is effectively flat.

## Architectural state after Step 21

Palette: 16 modules. All core DSP families are complete:

- **Delay / reverb**: Delay, Diffuser ×2, TapeMultiTap, TapeCharacter,
  CombBank, TiltEq, FdnReverb, EarlyReflections, Width.
- **Dynamics**: EnvelopeFollower, Compressor, Limiter.
- **Distortion**: Saturator.
- **Filtering / tone**: Tone, TiltEq, **EQ**.

Next phase is refinement — integrating everything, polishing product
wrappers, metering, preset systems, and UI glue. No further core
modules planned.
