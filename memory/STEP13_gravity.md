# STEP 13 — Gravity port + EarlyReflectionsModule

Second consumer of `FdnReverbModule` — reuse validation across two
products with zero core edits to the FDN. Lands
`EarlyReflectionsModule` as the only new generic module.

## Signal flow

```
in ─► EarlyReflections ─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
```

Pure composition. Gravity owns no DSP.

## New generic core

### `EarlyReflectionsModule` (palette index 10)

Pure FIR multi-tap. Two `DelayLine`s (L/R), N=8 taps per channel with
prime-adjacent base times and independent R-side offsets for stereo
decorrelation. No feedback (late field lives in FDN).

| Param   | Range | Notes |
|---|---|---|
| `size`    | 0.3–2.0 | scales all tap times together |
| `spread`  | 0–1     | scales L→R per-tap offset (0 = mono taps) |
| `density` | 0–1     | smooth ramp activation: tap k on when `density·N > k+1`, fades 1 unit |
| `mix`     | 0–1     | module-local dry/wet (1.0 inside products) |

Base tap times (ms): `[11.3, 17.9, 24.1, 31.7, 43.3, 55.7, 67.1, 83.9]`.
R offsets (ms): `[0.6, 1.4, 2.1, 3.0, 3.8, 2.7, 4.6, 5.3]`.
Gains geometric-ish: `[1.00, 0.82, 0.70, 0.60, 0.50, 0.42, 0.35, 0.28]`.
Summed taps trimmed by 0.55 so wet-only output stays near unity.

Reusable for: Gravity (now), MorphReverb (optional ER prefix later),
ReverbBus, NearFar.

## Gravity product

`src/core/products/gravity.js`. Chain above; `engineMix` mode on.

### Macros

| Macro | Writes |
|---|---|
| GRAVITY | FDN.decay ×(1 + 1.4·g) ; ER.density ×(1 − 0.35·g) ; TiltEq.tilt pulled down 0.3·g ; FDN.dampHz darker |
| BLOOM   | FDN.modDepth += 0.5·b (+ slow envelope contribution) ; FDN.modRate slows with bloom ; slow-swell adds up to +4s onto FDN.decay |
| SIZE    | ER.size 0.6→1.5 ; ER.spread 0.5→0.9 ; FDN.sizeScale 0.6→1.8 |
| DECAY   | FDN.decay base 0.6→12s (exp), scaled by GRAVITY and BLOOM |
| TONE    | TiltEq.tilt (via GRAVITY coupling) ; FDN.dampHz 2.2k→15k (exp) |
| DENSITY | ER.density (pre-scaled by GRAVITY) |
| WIDTH   | Width.width |
| MIX     | engineMix |

All writes for `decay`, `modDepth`, `modRate` funnel through the single
helper `applyDecayAndBloom()` so GRAVITY, DECAY and BLOOM stay coherent
and don't race each other.

### BLOOM swell (control rate only)

`setInterval(50 ms)` slow envelope:

- **Rise** time constant ≈ 1.5–7.5 s (slower at higher target).
- **Fall** time constant ≈ 2 s.
- Envelope (0..1) multiplies into FDN.decay (+up to 4 s) and
  FDN.modDepth (+0.3 at top).
- Timer stops when BLOOM and envelope are both < 1e-3 → idle CPU minimal.

This is a **control-plane** timer — same pattern as Smear's drift
modulator. No per-sample code in the product layer.

## Files

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `EarlyReflectionsModule`; palette index 10 |
| `src/core/fxEngine.js`   | + `MODULE.EARLY_REFLECTIONS`; `EARLY_REFLECTIONS_PARAMS` |
| `src/core/products/gravity.js` | NEW |

## Rules honoured

- **FdnReverbModule untouched.** Same class powers MorphReverb (Step 12)
  and Gravity (Step 13). No forks, no per-product flags.
- **DiffuserModule, TiltEqModule, WidthModule reused** verbatim.
- **Product layer owns GRAVITY + BLOOM** — both are macro fan-outs to
  core params + a control-rate envelope; no DSP lives in this file.

## Stability notes

- ER is pure FIR; unconditionally stable regardless of size/spread/density.
- Max ER delay: 83.9 ms × 2.0 (size) = 168 ms < the 300 ms DelayLine buffer.
- FDN stability derivation unchanged from Step 12: Householder unitary ×
  per-line g<1 × attenuating LP.
- BLOOM can add up to +4 s onto FDN.decay, taking the top possible decay
  to (12 × 2.4 + 4) = 32.8 s. The FDN's internal RT60 gain formula still
  yields g<1 at that length, and the 0.999 ceiling clamp inside
  `FdnReverbModule` holds. Verified safe by inspection (no code change).

## A/B vs legacy `gravityEngine.js`

| Area | Legacy | New | Verdict |
|---|---|---|---|
| Early reflections | inline hand-coded taps | `EarlyReflectionsModule` with 8 taps + stereo spread + density ramp | **Match-equivalent / slight improvement** (smoother density sweep, cleaner stereo decorrelation) |
| Late field | custom feedback network | 8-ch Householder FDN (shared with MorphReverb) | **Improved** (modal density, RT60-exact) |
| Gravity macro | weighted dry/ER/late balance | FDN.decay multiplier + ER.density scaling + TiltEq/dampHz darkening | **Match-equivalent** (same psychoacoustic outcome, cleaner param surface) |
| Bloom macro | ad-hoc envelope on feedback | control-rate slow envelope on FDN.decay + modDepth | **Match-equivalent** |
| Tone | inline tilt, fixed pivot | `TiltEqModule` + FDN per-ch dampHz | **Improved** (frequency-dependent decay in addition to static tilt) |
| Width | inline | `WidthModule` | **Match**, reusable |
| Output staging | mix + trim | engineMix | **Match** |

### Now matched / improved
- ER, late field, tone, width, stability — all on parity or improved.

### Still differs (acceptable)
- Legacy had a bespoke "pre-saturation" node on the ER bus for a subtle
  cinematic thickening. Not reproduced here: would require a single-product
  module, which the two-consumer rule rejects. Candidate for reuse via
  TapeCharacter (xfmrDrive) if ever judged necessary.

### Should remain different
- FDN-based late field replaces the bespoke feedback network by design;
  this is the whole point of the reverb-family architecture.

## Risks to test on real audio

- High GRAVITY + high BLOOM + long DECAY → confirm no runaway; meter
  that the bloom envelope decays monotonically when BLOOM is pulled to 0.
- ER density sweep at SIZE extremes → no clicks (size is smoothed; density
  is a scalar multiplier).
- GRAVITY + TONE interaction → tone stays coherent at all gravity values
  (TiltEq.tilt is clamped ≥ 0).
- SIZE automation at audio-ish rates → TiltEq and ER smoothers absorb it;
  FDN.sizeScale smoother is 50/25 ms, the slowest in the chain, so size
  changes sound graceful rather than punchy.

## Architectural payoff

Gravity is the **reuse proof**. `FdnReverbModule` now powers two products
(MorphReverb, Gravity) with zero modifications. The parallel-chain
primitive added in Step 12 remains available but unused here (Gravity is
pure serial). Next consumers (ReverbBus, NearFar) will use the same FDN
plus ER modules unchanged.

Next: Step 14 — Orbit (pure reuse: CombBank + Diffuser + TiltEq + spatial
pan in product layer).
