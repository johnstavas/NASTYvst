# Flap Jack Man — Conformance Spec

**Product ID:** `flapjackman`
**Engine file:** `src/nastybeast/nastyBeastEngine.js` (internal codename: NastyBeast)
**UI:** `src/nastybeast/NastyBeastOrb.jsx`
**Spec version:** 1.0.0 (2026-04-19)
**Status:** Phase A drafted during V1 migration.

---

## 1. Archetype

**Thick delay / distortion system with pitch-shifted octave ghosts.** Memory Man / Space Echo / lo-fi delay lineage, with a granular octave-down shifter summed back into the feedback loop (Breath/FLUFF = "shadow choir behind every hit"). Pancake-themed UI.

Not a reverb. Not a compressor. Primary motion = repeats; primary color = in-loop tanh saturation.

---

## 2. Reference Anchors

- **R1** DAFX Ch.2 — delay lines, feedback loops
- **R2** DAFX Ch.3 — modulation (chorus/flanger), LFO-driven delay
- **R3** DAFX Ch.4 — nonlinearities (tanh saturator, in-loop sat)
- **R4** DAFX Ch.12 — virtual analog (Memory Man, BBD lineage)
- **R5** JOS PASP — granular OLA pitch shifting (2-voice Hann-windowed crossfade, sawtooth delay ramp)
- **R6** DEV_RULES C3 — Mix=0 must equal input (verified by topology: `chainIn → dry → dryGain`, dry tap pre-everything)
- **R7** DEV_RULES Q1 — getState() mandatory
- **R8** DEV_RULES G4 — first shipped revision labelled `legacy`

---

## 3. Topology (signal flow)

```
input → bypassGain ─────────────────────────────────────────────────┐
     └→ inGain (chainIn) ──┬→ dry → dryGain ────────────────────────┤
                           │                                        │
                           └→ subHP → body → lowMid → harshCut →    │
                               fangPad ──┬→ fangDryAmt ─────────────┼→ fangSum
                                         └→ preDrive → beastDrive   │
                                            (+snarlBias)→ shaper →  │
                                            fangPostLP → fangMakeup ┘
                                            → fangWetAmt → fangSum
                                            → doublerIn → doublerOut
                                            ├→ ghostPreLP → pitchDown
                                            │   → ghostPostLP → ghostGain
                                            └→ delayInSum ← ghostGain
                                               → preCore ← fbReturn
                                               → loopSat → loopBody
                                               → loopHP → loopLP → delayCore
                                               → tapMain → wetTilt → wetLP
                                               → delayOut
                                                  ├→ pingSend → pingL/pingR (xfb)
                                                  │   → pingPanL/R → pingMix
                                                  ├→ glueComp → wDelay
                                                  └→ chorusDelay → chorusWet → wDelay
                                               → tuneDry / tuneDown / tuneUp
                                               → tuneSum → wet → beastTrim → wetGain
                                                                                 │
mixSum ← dryGain + wetGain + bypassGain                                          │
mixSum → masterHP → masterLP → outGain → output ─────────────────────────────────┘
```

**Key invariants:**

- `chainIn → dry → dryGain` is a **pre-everything** tap. MIX=0 or BYPASS=1 must sound exactly like input. (R6)
- The delay loop sits **after** the pitch ghost; ghost feeds `delayInSum`, so octaved content cascades through feedback.
- Ping-pong section is a parallel branch off `delayOut`, summed back into `delayOut` via `pingMix`.
- FANG uses a **fixed waveshaper curve** (tanh k=2 built once). Drive is modulated by `preDrive.gain` only — no curve rebuilds → zipper-free.
- FANG has an **equal-power dry/wet crossfade** (`fangDryAmt` = cos, `fangWetAmt` = sin). At FEED=0 the shaper is bypassed entirely.

---

## 4. Parameter Contract (paramSchema mirror)

| Setter | Kind | Range | Default | Notes |
|---|---|---|---|---|
| `setIn` | unit | 0–2 | 1 | Linear input gain |
| `setOut` | unit | 0–2 | 1 | Linear output gain |
| `setMix` | unit | 0–1 | 1 | Dry/wet crossfade (engine default = 1) |
| `setBypass` | bool | 0/1 | 0 | Hard bypass (bypassGain=1, dry/wet=0) |
| `setFeed` | unit | 0–1 | 0 | FANG drive (SIZZLE). preDrive 1.0 → 2.2 |
| `setRoam` | unit | 0–1 | 0 | Delay feedback (STACK). fbReturn → 0.50 ceiling + beast bump (hard ceiling 0.55) |
| `setHaunt` | unit | 0–1 | 0 | Delay time (DRIZZLE). 80 ms → 1200 ms |
| `setBreath` | unit | 0–1 | 0 | Pitch-ghost amount (FLUFF). ghostGain → 0.14 ceiling |
| `setSnarl` | unit | 0–1 | 0 | Asymmetric clip bias (CRISP). snarlBias.offset → 0.05 ceiling |
| `setSpread` | unit | 0–1 | 0 | Stereo ping-pong (BUTTER). pingMix/pingSend/xfb/LFO-depth all scale |
| `setHpf` | Hz | 20–2000 | 20 | Master HPF |
| `setLpf` | Hz | 500–20000 | 20000 | Master LPF |
| `setTune` | float | -1..+1 | 0 | Wet-bus pitch: -1 = octave down, 0 = no shift, +1 = octave up |
| `setBeast` | unit | 0–1 | 0 | FLIP engagement: tightens glue comp, adds chorus, bumps fb/ghost/spread |

---

## 5. Macro Setters (DEV_RULES D2 — route B reference pattern)

All 6 pancake macros (`feed/roam/haunt/breath/snarl/spread`) write to the `macros` struct then call `applyAll()`, which is the **single source of truth** for downstream `setTargetAtTime` writes. `setBeast` takes the same path. No macro writes an AudioParam directly.

**`applyAll()` is idempotent** — calling it multiple times with the same `macros` struct produces identical results, modulo already-in-progress setTargetAtTime ramps.

---

## 6. Measurable Targets (Phase C)

Severity: **critical** = loop-runaway / silence / crash; **major** = audible spec violation; **minor** = quiet deviation; **info** = catalogued deviation.

| ID | Target | Severity |
|---|---|---|
| U1 | `getLatency()` returns finite non-negative (universal) | major |
| U2 | `engineState.bypass` tracks `setBypass` (universal) | major |
| FJ-MIX-DRY | setMix=0 → `dryGainLevel≈1, wetGainLevel≈0` after 200 ms | major |
| FJ-BYPASS-DRY | setBypass=1 → `bypassGainLevel≈1, dryGainLevel≈0, wetGainLevel≈0` after 200 ms | major |
| FJ-FEED-ZERO | setFeed=0 → `fangWetAmt≈0, fangDryAmt≈1` after 500 ms (shaper bypassed) | minor |
| FJ-HAUNT-MAP | `delayTime ≈ 0.080 + haunt·1.120` within 5 % (80 ms → 1200 ms mapping) | major |
| FJ-ROAM-MAP | `feedbackAmt ≤ 0.55` for any `roam` value (hard ceiling) | critical |
| FJ-ROAM-ZERO | setRoam=0 + setBeast=0 → `feedbackAmt < 0.01` after 500 ms | minor |
| FJ-BREATH-ZERO | setBreath=0 + setBeast=0 → `ghostGainLevel < 1e-3` after 500 ms (ghost bus quiet) | minor |
| FJ-SPREAD-ZERO | setSpread=0 + setBeast=0 → `pingMixLevel < 1e-3, pingSendLevel < 1e-3` after 500 ms | minor |
| FJ-TUNE-ZERO | setTune=0 → `tuneDryAmt≈1, tuneDownAmt≈0, tuneUpAmt≈0` after 200 ms | major |
| FJ-TUNE-DOWN | setTune=-1 → `tuneDryAmt≈0, tuneDownAmt≈1, tuneUpAmt≈0` after 200 ms | minor |
| FJ-TUNE-UP | setTune=+1 → `tuneDryAmt≈0, tuneDownAmt≈0, tuneUpAmt≈1` after 200 ms | minor |

---

## 7. UI-Isolation Surface

UI must **only** write to engine parameters via the setters in §4. No AudioParam `.value =` or `.setTargetAtTime()` calls from React components. Grep-verified by Layer 1 (`UI_ISOLATION_RULES.md`). Orb currently uses `useEffect → engine.setX(v)` throughout — compliant.

---

## 8. Non-Goals / Known Deviations

- **§8.1** Pitch shifter is granular OLA (Hann-windowed 2-voice crossfade). It produces audible grain-edge artifacts on transient material. This is **by design** — the plugin sells "shadow choir" character, not glassy SMB-style shifting. Not a bug.
- **§8.2** In-loop `loopLP` closes with feedback (4.5 kHz → 1.6 kHz as `roam` rises). This is **intentional** Memory Man behavior (darkening repeats). Do not add compensation.
- **§8.3** The `doubler` is mono-summed to the post-FANG bus, **not** the dry tap. MIX=0 bypasses it entirely. MIX>0 engages two micro-detuned voices (11 ms / 15 ms centers, ±0.5 ms LFO depth) at 6% wet.
- **§8.4** `tuneSum` currently uses linear crossfade (sum of three gains). At `tune=±1` the two unused branches are 0 and the active branch is 1 — energy-preserving at extremes, but intermediate positions may show slight loudness dip. Acceptable per Orb usage pattern (discrete ±octave or off).
- **§8.5** `glueComp` threshold/ratio/chorus-depth are all beast-driven. At `beast=0` the comp is transparent (-3 dB thresh, 1.5:1). Not tested for beast < 0.02 edge case.

---

## 9. Change Log

- **v1.0.0 (2026-04-19)** — initial spec drafted alongside Engine_V1 port. Adds `paramSchema`, `getState()`, `getLatency()` to `createNastyBeastEngine`. Registers `flapjackman` product. No DSP changes in this pass — pure contract scaffolding.
