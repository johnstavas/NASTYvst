# QC Family Map

> Canonical Family → Tier map for the QC rack. Referenced by
> `src/qc-harness/qcPresets.js` (see header comment §2) as the source
> of truth for which rules apply to which plugin class.
>
> **How to use this file:**
> - Plugin authors read it to know what to declare on `engine.capabilities`.
> - `qcPresets.js` reads capability flags derived from here to know which
>   tiers/rules to fire.
> - New plugin classes land by adding a row here + declaring the matching
>   capability flag, NOT by editing the generator branches.

---

## 1. Legend

- ✓ — rule runs for this family (not just applicable — actually emitted)
- **✓ bold** — critical, defining QC risk for this family
- — — does not apply
- T1 / T2 / T3 / T4 — tier at which the rule first fires

The tier model:

| Tier | Meaning | Cost | Opt-in? |
|---|---|---|---|
| T1 | Universal correctness | cheap | no — always runs |
| T2 | High-value, cheap | cheap | no — always runs |
| T3 | Schema-conditional | medium | no — gated on capability |
| T4 | Pressure tests | expensive | partial — long-session opt-in |

---

## 2. Family → Tier map

Legend: ✓ = runs, **bold** = critical (defining QC risk for this family),
— = doesn't apply.

| Family | T1 | T2 | T3 | T4 | Defining risk |
|---|---|---|---|---|---|
| Level / utility (gain, pan, width) | ✓ | stereo | — | — | Mix null; stereo width must not collapse mono-sum. |
| EQ — parametric / shelf | ✓ | DC + Nyquist | loudness-comp | SR matrix | HF cramping near Nyquist (bilinear warping). |
| EQ — dynamic / multiband | ✓ | DC + Nyquist, impulse | sidechain, loudness-comp | SR matrix | **Band-splitter phase: Mix null at 0% is critical — allpass-sum must reconstruct perfectly.** |
| Dynamics — comp / limiter | ✓ | impulse, stereo | sidechain, FB runaway (if FB detector) | — | Sidechain-present vs absent. ManChild lives here. |
| Dynamics — multiband comp | ✓ | impulse, DC+Nyquist | sidechain × N bands | SR matrix | Band crossover phase coherence (same as dynamic EQ). |
| Dynamics — gate / expander | ✓ | mode-switching storm | sidechain | — | Hysteresis edge-flutter near threshold; rapid open/close. |
| Dynamics — transient designer | ✓ | impulse, zipper | — | — | Fast envelope → zipper-sensitive. Impulse reveals attack/sustain shaping directly. |
| Dynamics — de-esser | ✓ | DC+Nyquist | sidechain with filter | SR matrix | SC filter rate-dependence + near-Nyquist stability. |
| Character / saturation (tube, tape, transformer) | ✓ | near-Nyquist | loudness-comp, FB runaway | OS boundary, SR matrix | **Aliasing. Panther Buss lives here.** |
| Distortion (waveshaper, fuzz, amp sim) | ✓ | near-Nyquist | loudness-comp, FB runaway | OS boundary, SR matrix | Aliasing + OS crossover clicks. |
| Clipper — hard | ✓ | near-Nyquist | — | **OS + SR matrix mandatory** | Infinite-bandwidth aliasing. |
| Clipper — soft | ✓ | near-Nyquist | loudness-comp | OS boundary | Aliasing + cumulative when cascaded. |
| Limiter — lookahead | ✓ | impulse (latency) | — | drift | **Latency reporting correctness.** |
| Limiter — true-peak | ✓ | near-Nyquist | — | SR matrix mandatory | ISR detection rate-dependence. |
| Band-split / multiband (generic) | ✓ | band-reconstruction null | per-band sidechain | SR matrix | **Crossover phase reconstruction.** |
| Cascaded nonlinearity | ✓ | near-Nyquist × stages | loudness-comp | OS boundary × stages | Compounding aliasing. |
| Modulation — chorus / flanger | ✓ | impulse, stereo | — | drift (LFO phase), SR matrix, OS boundary (if BBD) | LFO phase accumulator drift over 10 min; delay-line interpolation at mod extremes. |
| Modulation — phaser | ✓ | DC+Nyquist | FB runaway (if regen knob) | SR matrix | Allpass cascade stability near Nyquist; pole migration at high feedback. |
| Modulation — tremolo / auto-pan | ✓ | stereo | — | drift (LFO phase) | Pure LFO × gain — low risk except long-session LFO drift. |
| Modulation — rotary / Leslie | ✓ | impulse, stereo | — | drift, SR matrix | Combines LFO + filter + delay — inherits all three risks. |
| Modulation — ring mod / freq shift | ✓ | near-Nyquist (critical), DC | — | OS boundary | Multiplication → extreme aliasing; ring mod at 0.4·Fs aliases violently without OS. |
| Modulation — vibrato (pure delay mod) | ✓ | impulse | — | drift | Delay-line interpolation artifacts at mod peaks. |
| Delay — digital | ✓ | impulse, stereo, denormal tail | FB runaway, freeze | drift, series-identity | Long delay times + 10 min precision decay. |
| Delay — BBD / tape echo | ✓ | impulse, stereo, denormal tail | FB runaway, freeze | OS boundary, SR matrix, drift | **Variable clock rate = rolling OS boundary. Holters–Parker rate-dependent terms.** |
| Reverb — plate / spring / room | ✓ | impulse, denormal tail | freeze | all Tier 4 | FDN stability, tail blowup, precision decay. |
| Reverb — hall / FDN / convolution | ✓ | impulse, denormal tail | freeze | all Tier 4 | Same + large delay-line precision. |
| Reverb — shimmer | ✓ | impulse, denormal tail | freeze, FB runaway | all Tier 4 | **Pitch shifter + reverb in feedback loop — the scariest family in the entire roadmap.** |
| Pitch — shifter / harmonizer | ✓ | near-Nyquist | — | OS boundary, SR matrix | Aliasing on transposition; PSOLA/phase-vocoder grain boundary artifacts. |
| Pitch — auto-tune / formant | ✓ | near-Nyquist, mode-switch storm | — | drift, SR matrix | Pitch-detector lock/unlock edge cases. |
| Time — freeze / time-stretch | ✓ | impulse, denormal tail | freeze | drift, SR matrix | Grain-boundary artifacts + long-state drift. |
| Convolver / IR | ✓ | impulse, denormal tail | — | SR matrix, series-identity | IR resampling + chain use. |
| Amp sim (multi-stage) | ✓ | near-Nyquist × 3, impulse | loudness-comp | OS × stages, SR matrix | Worst aliasing case. |
| Utility pass-through (scope) | bit-match Mix null | — | — | — | Must be exact. |

---

## 3. Plugin-class → tier summary

A coarser roll-up of the above — useful for quick mental-model checks.

| Class | T1 | T2 | T3 | T4 |
|---|---|---|---|---|
| Static gain / trim | ✓ | — | — | — |
| EQ (linear-phase or minimum-phase) | ✓ | ✓ | loudness-comp | SR matrix |
| Comp / gate (ManChild) | ✓ | ✓ | sidechain | — |
| Distortion / saturation | ✓ | ✓ | loudness-comp, FB runaway | OS boundary, SR matrix |
| Character (Panther Buss) | ✓ | ✓ | loudness-comp, FB runaway | OS boundary |
| Digital delay | ✓ | ✓ | FB runaway, freeze | drift, series-identity |
| BBD / tape delay | ✓ | ✓ | FB runaway, freeze | OS boundary, SR matrix, drift |
| Reverb | ✓ | ✓ | freeze | all T4 |
| Chorus / flanger / phaser (Juno) | ✓ | ✓ | — | OS boundary, SR matrix, drift |

**Tier-4 hotspots outside reverb:** Distortion and BBD delay exercise
T4 harder than their reputations suggest. OS boundary + SR matrix +
(for BBD) drift all apply.

---

## 4. Family coverage sanity check

Reverse-scan against the current plugin list to confirm every plugin
maps to at least one family row:

- Orbit, Gravity, Smear, Echoform, PlateX, MorphReverb, NearFar,
  FocusReverb, FreezeField — all spatial/reverb rows cover them.
- Digital delay plugins → Delay — digital (T1+T2+T3+T4 drift + series-identity).
- BBD / tape delays → Delay — BBD / tape echo (full T4 OS + SR matrix + drift).
- ManChild → Dynamics — comp / limiter.
- Panther Buss → Character / saturation.
- Lofi Loofy → Character / saturation + possibly Modulation — vibrato
  (vibrato sub-stage).

If a new plugin doesn't fit any row, **add a new family row first**,
then declare the capability flag, then the generator in `qcPresets.js`
picks it up automatically.

---

## 5. Relationship to capability flags

Every ✓ cell in §2 is reached by `qcPresets.js` gating on a capability
flag. The mapping from family rows to capability flags is derived in
a separate doc (coming): `qc_capability_flags.md`.

Known flags in use today (authoritative list is the generator itself
at `src/qc-harness/qcPresets.js`):

- `nonlinearStages` (number)
- `dryLegHasColoration` (bool)
- `hasFeedback` (bool)
- `hasFreeze` (bool)
- `hasSidechain` (bool)
- `hasStereoWidth` (bool)
- `hasMultiband` (bool)
- `hasLPC` (bool)
- `hasFFT` (bool)
- `hasWDF` (bool)
- `hasPitchDetector` (bool)
- `hasTruePeak` (bool)
- `hasLFO` (bool)
- `latencySamples` (number)
- `osThresholds` (number[])
- `subcategories` (string[])
- `modes` (string[])

Known flags the family map implies but are NOT YET in the generator
(to be added during §6 audit):

- `isClipper` (bool) — distinguish Clipper — hard vs soft behavior
- `hasLookahead` (bool) — drives latency report rule for lookahead limiters
- `hasHysteresis` (bool) — gate / expander edge-flutter rule
- `hasVariableClockRate` (bool) — BBD / tape echo rolling-OS rule
- `hasRegen` (bool) — phaser regen knob feedback rule
- `isTransientDesigner` (bool) — transient designer impulse + zipper rule
- `isDeEsser` (bool) — de-esser near-Nyquist + SC filter rule
- `isRingMod` (bool) — ring mod / freq shift near-critical aliasing rule
- `isRotary` (bool) — rotary / Leslie LFO+filter+delay triad
- `isTruePeak` (bool) — true-peak limiter ISR detection rule (also `hasTruePeak` above — reconcile)
- `isConvolver` (bool) — convolver / IR resampling rule
- `isAmpSim` (bool) — multi-stage amp sim compounding aliasing rule
- `isPassThrough` (bool) — utility scope bit-match expectation

---

## 6. Pending work

Tracked in the QC rack todo list:

1. Derive full capability-flag glossary from this map (`qc_capability_flags.md`).
2. Audit `qcPresets.js` coverage against this map — gap list of ✓ cells
   the generator doesn't yet emit.
3. Add missing capability flags (§5 bottom list) to the generator gating.
4. Roll new family rows to remaining plugins as they ship.

---

## 7. Revision history

- **2026-04-20 v1.0** — Canonicalized from chat-history screenshots +
  manchild_lessons.md + dry_wet_mix_rule.md. First on-disk canonical
  reference.
