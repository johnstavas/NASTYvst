# STEP 25 — Transparency QC rule (product-level behaviour policy)

Product-layer rule. DSP engine unchanged. Every current and future
product must declare its class and satisfy the corresponding checklist
before shipping.

## Rule

Plugins must be transparent at their neutral / default settings unless
explicitly classified as **character-first**.

### Neutral plugins — required at defaults
1. ON with all controls at default is audibly indistinguishable from
   bypass.
2. No saturator drive, no compressor GR above ~0.1 dB, no shelves away
   from 0 dB, no level change.
3. Dry / wet paths phase-aligned (no latency-introducing modules in
   the wet chain unless the dry path is compensated).
4. Bypass A/B test: < 0.25 dB RMS delta, < 1 dB peak delta on program
   material.

### Character-first plugins — required at defaults
1. Baseline coloration is *subtle*: ≤ ~3 dB drive, ≤ ~2 dB GR,
   ≤ ±1.5 dB tonal tilt.
2. Output level matched to input ±1 dB RMS.
3. No harsh artifacts at any legal setting: no aliasing above the
   noise floor at normal drive, no pumping, no DC offset, no clipping
   at MIX=1 on normal program material.
4. Stable under rapid automation and extreme settings (engine's Step-22
   self-heal policy is sufficient; products inherit it).

## Classification of existing and planned plugins

### Neutral
- **Clean EQ**: neve, iron1073, nastyneve, ampless, bassmind
- **Clean reverb**: reverb, gravity, focusreverb, nearfar, morphreverb,
  transientreverb, reverbbus, platex, smear, orbit
- **Clean delay**: tapedelay, echoform, space (OrbPluginDemo)
- **Modulation**: modulation, flanger, phaser, drift, reactor
- **Dynamics utilities**: mixbus, smoother, la2a, analogglue, gluesmash
- **Vocal utilities**: vocallock, deharsh, phraserider
- **Spatial / analysis / pitch**: scope, splitdrive, pitchshift

### Character-first
- **Saturation / drive**: distortion, amp, shagatron
- **Tape emulation**: tape (424 Tape)
- **Analog buss / console**: **drumbus (Panther Buss)**, finisher
- **Vocal character**: vibemic, airlift, character (CharacterBox)
- **Creative**: playbox, vocal
- **Spring / plate physical**: spring, spring2

Unlisted future plugins default to **neutral** unless the product file
documents a character-first justification.

## Panther Buss — compliance audit and fix

Classification: **character-first** (analog-console bus processor
archetype).

Defaults before this step:

| Macro  | Value | At default | Verdict |
|---|---|---|---|
| drive  | 0.30  | +8.4 dB saturator drive, tube curve, asym 0.35 | FAIL — not subtle |
| glue   | 0.40  | threshold −11.6 dB, ratio 1.98, rel 288 ms     | borderline |
| tone   | 0.50  | flat                                           | PASS |
| output | 0.50  | 0 dB makeup                                    | PASS |
| mix    | 1.00  | full wet                                       | PASS |

Defaults after:

| Macro  | Value | At default | Verdict |
|---|---|---|---|
| drive  | 0.10  | +2.8 dB saturator drive (tube barely touching) | PASS |
| glue   | 0.20  | threshold −8.8 dB, ratio 1.64, rel 344 ms (≈1 dB GR on bus material) | PASS |
| tone   | 0.50  | flat                                           | PASS |
| output | 0.50  | 0 dB makeup                                    | PASS |
| mix    | 1.00  | full wet                                       | PASS |

No DSP change. `defaults` object edited in
`src/core/products/pantherBuss.js`.

## Applied to future migrations

Before flipping a legacy plugin to the new engine, the product file
must:
1. State its class at the top (`// Class: neutral` or
   `// Class: character-first — <one-line justification>`).
2. Pass the corresponding default-state checklist during local QC
   (bypass A/B, RMS / peak delta, automation sweep).
3. If neutral, structure the chain so MIX=1 + defaults = transparent.
   (Typically: internal wet/dry mixes at 1, engine mix = user MIX,
   dry-path latency-compensated if any wet-path module adds latency.)

## Files

| File | Change |
|---|---|
| `src/core/products/pantherBuss.js` | defaults tuned to subtle (drive 0.10, glue 0.20); comment cites STEP 25 |

No engine or DSP-module changes.
