# STEP 10 — REVERB FAMILY ARCHITECTURE PLAN (no implementation)

Planning pass before any reverb porting. Mirrors the response delivered to user.

## Family roster
Gravity, NearFar, MorphReverb, PlateX, ReverbBus, Smear, Orbit.

## Existing core to reuse
- DiffuserModule (4-stage AP) — MorphReverb diffusers, PlateX pre/post AP, Orbit's 2 AP, generic pre-diffusion.
- ToneModule — output tonal shaping when tilt isn't required.
- TapeCharacterModule — Smear's DRIFT/DEGRADE/noise voice (cross-family reuse).
- engineMix — universal dry/wet.

## New generic modules required (each justified by ≥2 consumers)
| Module | Purpose | Consumers |
|---|---|---|
| FdnReverbModule        | N-ch FDN (4 or 8), Hadamard or Householder, per-ch HF shelf, fractional-length mod, RT60 gain | Gravity, MorphReverb, ReverbBus, NearFar |
| EarlyReflectionsModule | Multi-tap (8 default), size-scaled, stereo-spread, density param | Gravity, MorphReverb, ReverbBus, NearFar |
| CombBankModule         | N parallel combs, per-comb LFO mod, crossfeed, optional dynamic-fb input | PlateX, Smear, Orbit |
| TiltEqModule           | True tilt EQ (~1 kHz crossover, bipolar param) | All 7 |
| WidthModule            | M/S width 0..2 (also closes Echoform WIDTH<1 retroactively) | Gravity, ReverbBus, MorphReverb, NearFar, Echoform |

## Deferred until consumer count justifies
- EnvelopeFollowerModule — add at PlateX (consumer #2 = ReverbBus duck).
- CompressorModule — add at Dynamics-family phase or ReverbBus.
- DuckerModule — add at NearFar/ReverbBus.
- CrushModule — add at Smear (consumer #2 = Playbox CRUSH chain still pending).
- SpatialPanModule — single-product (Orbit) → product layer.
- ResonantPeakModule — single-product (PlateX METAL) → product layer.

## Product split
| Product | Generic core | Product layer |
|---|---|---|
| Smear        | CombBank, TapeCharacter, TiltEq | Macro fan-out (DRIFT/SMEAR/DEGRADE) |
| MorphReverb  | Diffuser×2, FdnReverb (8 Householder), TiltEq, Width | Diffuser A↔B crossfade for MORPH |
| Gravity      | EarlyReflections, FdnReverb (4 Hadamard), TiltEq, Width | GRAVITY weighting, BLOOM mod, DENSITY |
| Orbit        | CombBank (3), Diffuser (2), TiltEq | Spatial pan rotator (PATH 0..3) |
| PlateX       | CombBank (8 dyn-fb), Diffuser×2, TiltEq, EnvFollower | METAL resonant peaks, TENSION fan-out |
| ReverbBus    | EarlyReflections, FdnReverb, TiltEq, Width, Compressor, Ducker | MODE preset reconfigurator |
| NearFar      | EarlyReflections, FdnReverb, TiltEq, Ducker | Distance psychoacoustic mapping |

## Migration order
1. Smear (easiest; lands CombBank + TiltEq; cross-family reuse proof)
2. MorphReverb (highest payoff; lands FdnReverb + Width)
3. Gravity (lands EarlyReflections)
4. Orbit (pure reuse)
5. PlateX (lands EnvelopeFollower; METAL stays in product)
6. ReverbBus (lands Compressor + Ducker)
7. NearFar (composition only, no new core)

## First target: SMEAR
Reasons: smallest topology; lets CombBank/TiltEq prove themselves before FdnReverb commitment; direct reuse of TapeCharacter validates cross-family architecture; lowest risk.

Open architectural question for Smear step:
- CombBankModule should NOT embed its own drift modulator. Drift comes externally (LFO routed to per-channel comb-length mod). Keeps CombBank pure; drift becomes routable; future ModMatrix benefits.

## Reference
All reverb DSP standards anchored to `memory/reverb_engine_architecture.md` (Geraint Luff FDN), `memory/jos_pasp_dsp_reference.md` (Schroeder/Freeverb/allpass), and `memory/dafx_zolzer_textbook.md` Ch.5/12 (FDN + plate/spring VA).
