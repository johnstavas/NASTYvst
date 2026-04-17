# STEP 23 — Panther Buss (first product on the locked engine)

Opens the product-layer phase. Composition only — zero DSP changes.

## Signal flow

```
in ─► EQ ─► Saturator ─► Compressor ─► Limiter ─► engineMix ─► out
```

One serial chain, four palette modules, engine-level parallel mix.

## Module chain configuration

| Slot | Module (palette idx) | Fixed voicing (product-side, snap) | User macro targets |
|---|---|---|---|
| 1 | `EQ` (15)         | HP 30 Hz on, LP off, peak band anchored at 1.8 kHz / Q 0.8 / 0 dB, shelf freqs 120 Hz & 8 kHz | `lsGain`, `hsGain` ← TONE + DRIVE pre-emphasis |
| 2 | `Saturator` (14)  | `curve=2` (tube), `asym=0.35`, `aa=1`, internal `mix=1` | `drive` ← DRIVE |
| 3 | `Compressor` (12) | `detectMode=2` (hybrid), `stereoLink=1`, `attackMs=20`, `knee=8 dB`, internal `mix=1` | `threshold`, `ratio`, `releaseMs` ← GLUE; `makeupDb` ← OUTPUT |
| 4 | `Limiter` (13)    | `ceiling=−0.3 dB`, `lookaheadMs=2`, `releaseMs=120`, internal `mix=1` | none (safety net) |
| — | engine mix        | parallel blend | `mix` ← MIX |

All module-internal `mix` params pinned to 1 at construction — parallel
blend is owned by the engine (`setEngineMix`), so the dry path skips
all four modules entirely on MIX < 1.

## Macro → parameter mapping

```
DRIVE  (0..1)
  ├─ SATURATOR.drive          =  d · 28 dB                        (0..28 dB)
  ├─ EQ.lsGain                =  _lsBase(TONE) + d · 1.5 dB
  └─ EQ.hsGain                =  _hsBase(TONE) + d · 2.0 dB

GLUE   (0..1)
  ├─ COMPRESSOR.threshold     =  −6 + (−14)·g                     (−6..−20 dB)
  ├─ COMPRESSOR.ratio         =   1.3 + 1.7·g                      (1.3..3.0)
  └─ COMPRESSOR.releaseMs     =   400 − 280·g                      (400..120 ms)

TONE   (0..1, 0.5 = flat)         — bipolar symmetric shelves
  ├─ EQ.lsGain                =  (0.5 − t)·6 dB  + DRIVE lift      (−3..+3 dB)
  └─ EQ.hsGain                =  (t − 0.5)·6 dB  + DRIVE lift      (−3..+3 dB)

OUTPUT (0..1, 0.5 = 0 dB)         — bipolar trim
  └─ COMPRESSOR.makeupDb      =  (o − 0.5)·24                      (−12..+12 dB)

MIX    (0..1)
  └─ engine mix               =   v                                (dry..wet)
```

### Fan-out / coupling notes

- DRIVE and TONE both write `EQ.lsGain` and `EQ.hsGain`. To keep them
  additive without racing, each macro's apply function recomputes both
  shelf gains from the current state of the other macro. A single
  source of truth per parameter, re-derived on every write.
- GLUE is three coupled moves on one knob. Threshold and ratio move
  together (soft touch ↔ firmer pull); release shortens as glue tightens
  so the compressor feels more active rather than just louder in GR.
- OUTPUT lives on `makeupDb` instead of `sat.outputDb` so moving OUTPUT
  does not change what the compressor sees. The comp's program level
  (and therefore its feel) is a function of DRIVE + incoming material
  only.

## Rationale for sound design

### Why this chain order

EQ first cleans pre-saturation input (HP trims sub-rumble that would
generate unmusical LF products through the tube curve). Saturator
second provides harmonic colour. Compressor third uses the post-colour
signal so glue responds to the voiced material, not the raw input.
Limiter last is the safety ceiling — anything the compressor misses on
transients, the limiter clamps.

### Why tube curve, not soft or hard

- Tube asymmetry (`asym=0.35`) produces even-order harmonics — the
  warm, "bigger than life" character typical of console / bus
  processors.
- Soft (tanh) is too symmetric → third-order-dominated, less flattering
  on mix buses.
- Hard is for fuzz / destruction — wrong archetype for a glue strip.

### Why slow attack + soft knee + low ratio

This is bus-compressor territory, not peak control:

- 20 ms attack lets transients through → preserves punch.
- 8 dB soft knee → onset is gradual, not a hard pumping action.
- Ratio capped at 3:1 even at GLUE=1 → never squashes the mix.
- Release from 400 ms down to 120 ms as glue tightens — long releases
  at low glue give the transparent "everything just sits together"
  effect; tighter releases at high glue introduce audible movement
  ("pumping is a feature") without going full ducking.

### Why hybrid detector (peak+RMS)

Peak-only compressors clamp transients but let sustained material
sneak through above threshold; pure RMS is too slow on drums. Hybrid
(peak with RMS smoothing tied to attack by the Step-19 refinement) is
the bus-compressor default and matches the "controls both program and
peaks" brief.

### Why a small built-in limiter

The strip is a bus product — user expectation is that the output does
not clip the host. Ceiling at −0.3 dBFS with 2 ms lookahead gives a
transparent safety net on anything the compressor misses, without
colouring the sound under normal use. Not user-facing because exposing
it invites abuse ("crush it with the brick-wall"); that's a different
product archetype.

### Why MIX at engine level, not per-module

Parallel compression / parallel saturation are common tricks, but the
product decision here is that MIX should blend the *whole coloured
chain* against the dry signal. A per-module mix would force the user
to reason about partial chains. Engine-level mix is one concept: "how
much Panther is on this bus."

## Rules honoured

- **Existing modules only.** Chain uses four palette entries; no new
  modules, no API changes.
- **Product-layer voicing.** Every curve choice, shelf frequency,
  attack/knee value lives in `pantherBuss.js`. The DSP modules remain
  generic.
- **Macro fan-out, no DSP.** All five user controls are pure parameter
  writes — no audio-rate code in the product file.
- **Reuse validated.** Saturator + Compressor + Limiter + EQ all
  confirmed composable into a channel-strip archetype with zero engine
  changes. The locked engine supports bus processors out of the box.

## Files

| File | Change |
|---|---|
| `src/core/products/pantherBuss.js` | + `createPantherBuss(fx)` |

## State after Step 23

First dynamics/saturation-family product shipped. Engine remains
locked. Next product uses the same engine and the same composition
pattern — no core work required.
