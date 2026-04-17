# STEP 14 — Orbit port (pure reuse)

Non-FDN reverb branch validation. Zero new core modules. Orbit is
composition + a control-rate rotator that drives CombBank's existing
external mod inputs in preset motion topologies.

## Signal flow

```
in ─► CombBank ─► Diffuser ─► TiltEq ─► engineMix ─► out
```

No FDN — Orbit is a Schroeder-family late field (4 parallel combs + AP
diffusion). `FdnReverbModule` **untouched** and not in the chain.

## Parameter mapping

| Orbit control | Module writes |
|---|---|
| MOTION    | rotator base rate 0.05→4 Hz (exp); read by the tick timer |
| DEPTH     | mod amplitude (writes CombBank.mod0..3 via rotator) |
| PATH      | rotator topology selector: 0=CIRCLE, 1=FIGURE-8, 2=PENDULUM, 3=CHAOS |
| SIZE      | CombBank.sizeScale 0.5→1.8 ; Diffuser.size 0.25→0.90 |
| TONE      | TiltEq.tilt 0..1 |
| SPREAD    | CombBank.crossfeed 0→0.45 ; Diffuser.amount 0.30→0.85 ; CombBank.damp 0.25→0.50 (inverse) |
| FEEDBACK  | CombBank.fb 0.45→0.90 |
| MIX       | engineMix |

Four scalar control params (MOTION, DEPTH, PATH, SIZE/TONE/SPREAD/FEEDBACK/MIX).
PATH is integer 0..3, everything else normalized.

## Product / core split

### Core (reused, unmodified)
- **CombBankModule** — 4 parallel feedback combs, external `mod0..3` inputs.
- **DiffuserModule** — single 4-stage AP cascade (the A-instance, palette
  index 1). `DIFFUSER_B` is not used; Orbit is a serial chain.
- **TiltEqModule** — bipolar tilt.
- **engineMix** — universal dry/wet.

### Product (Orbit only)
- 60 Hz `setInterval` rotator.
- Rotates a scalar phase; per comb k applies a path-specific function of
  `(phase, k)`:
  - **CIRCLE**   — `sin(φ + k·π/2)` — 90° quadrature, pure rotation.
  - **FIGURE-8** — odd combs at 2φ, even combs at φ — 2:1 Lissajous.
  - **PENDULUM** — shared `sin(φ)` axis scaled by `cos(k·π/4)` — co-linear
    sway with per-comb amplitude distribution.
  - **CHAOS**    — per-comb random walk with mild pull-back to 0.
- Result is multiplied by DEPTH and written to `CombBank.mod0..mod3`.
  Worklet ParamSmoother handles per-sample interpolation → no zipper.
- Relaxation: when MOTION and DEPTH both ≈ 0, timer decays mods toward 0
  (×0.85/tick) and self-stops → idle CPU minimal.

This is the exact same control-plane pattern Smear uses for DRIFT —
reuse validates the pattern.

## Parity notes vs legacy `orbitEngine.js`

| Area | Legacy | New | Verdict |
|---|---|---|---|
| Comb topology | 4 parallel Freeverb-style combs | identical (via CombBank) | **Match** |
| Diffusion | 2 AP stages in series | 1 DiffuserModule (4 AP stages internally) | **Match-equivalent / slightly denser** |
| Tilt EQ | inline fixed-pivot | TiltEqModule | **Match** with configurability |
| Spatial pan rotator | per-sample L/R pan law on each comb output | control-rate length-mod rotation across 4 combs | **Match-equivalent audible intent** (see below) |
| PATH modes | CIRCLE / FIG-8 / PENDULUM / CHAOS | identical set, same names | **Match** |
| FB / crossfeed | `smear`-style writes | same param surface | **Match** |
| Output staging | mix + trim | engineMix | **Match** |

### Now matched / improved
- Comb, diffusion, tilt, topology — all on parity.
- Rotator paths retain the four legacy archetypes.

### Still differs (acceptable)
- **Spatial motion via length-mod rotation vs amplitude panning.** Legacy
  implemented orbital motion as per-sample L/R amplitude panning of each
  comb's output. The new version rotates each comb's *length* instead,
  which creates an audible pitched Doppler-like motion across the
  existing L/R stereo split (even combs → L, odd → R inside CombBank).
  The perceptual result is comparable — a rotating stereo image with
  subtle pitch shimmer — but the mechanism is different.
- Reason: a per-sample amplitude-pan rotator would be a single-product
  DSP module (rule #4 — no new core without a second consumer). Choosing
  length-mod rotation delivers the motion effect using only existing
  generic hooks. If a future reverb (e.g. ReverbBus or a dedicated panner
  plugin) needs true amplitude-pan motion, `SpatialPanModule` will be
  promoted out of Orbit at that point.

### Should remain different
- Length-mod rotation plays cleanly with the future ModMatrix — the same
  mod0..3 surface that Smear's DRIFT writes to. Keeps Orbit's motion
  routable when the matrix lands.

## Stability notes

- No new DSP paths; stability inherited from CombBank + Diffuser (already
  validated in Step 11 + earlier).
- Rotator writes are bounded: `pathValue` outputs ∈ [−1, +1], multiplied
  by DEPTH ∈ [0, 1], written to CombBank.mod0..3 which are already clamped
  to ±1 internally and scale to ±64 samples of length mod. No stability
  coupling to CombBank.fb.
- CHAOS path's random walk is clamped ±1 per tick; cannot runaway.
- Motion timer self-stops when MOTION and DEPTH both ≈ 0 → no idle cost.

## Rules honoured

- **CombBank / Diffuser / TiltEq / engineMix reused** verbatim.
- **No new core modules.** Second-consumer rule preserved.
- **FdnReverbModule untouched** and not in the chain.
- **All motion code in the product layer.** PATH modes, rotating taps,
  motion macros all live in `src/core/products/orbit.js`.

## Files

| File | Change |
|---|---|
| `src/core/products/orbit.js` | NEW |

No changes to `dspWorklet.js` or `fxEngine.js` — first reverb-family
product that adds zero palette entries. This is exactly what the plan
predicted in the Step 10 table ("pure reuse").

## Risks to test on real audio

- PATH = CHAOS at high DEPTH → confirm no audible clicks on random-walk
  transitions (worklet ParamSmoother is the line of defence).
- MOTION = max + DEPTH = max + FEEDBACK near top → confirm no comb
  runaway (fb cap 0.90 + Freeverb damp already proven stable under mod).
- Path switch while playing → mod values continue smoothly (rotator
  re-enters with a new path function but the same phase/depth).
- MOTION = 0 + DEPTH ≠ 0 → frozen offsets per comb (detuned combs,
  useful pad-like voice). No audio artefact expected.

## Architectural payoff

Orbit validates the non-FDN reverb branch and the "pure composition
product" pattern: a new reverb ships with zero palette changes,
zero core edits, zero new generic modules. The existing hooks —
external mod inputs on CombBank, the Diffuser, TiltEq, engineMix, and
the control-plane timer pattern — are sufficient. Every future
reverb that follows this pattern is now trivially cheap to add.

Next: Step 15 — PlateX (lands `EnvelopeFollowerModule`, METAL resonances
stay in product).
