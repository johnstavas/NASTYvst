# STEP 17 — Near/Far (pure reuse, completes the reverb family)

Seventh and final reverb in the family as laid out in Step 10. Zero new
core modules, zero core edits — DISTANCE is a single macro that
simultaneously re-weights the direct / early / late balance and applies
the psychoacoustic cues of air absorption, reflection spread and room
growth.

## Signal flow

```
in ─► EarlyReflections ─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
```

Identical topology to ReverbBus and Gravity. The product layer alone
differentiates the voice.

## Psychoacoustic mapping

All driven off DISTANCE (0 = on-top-of-listener, 1 = far across a large
room):

| Cue | Module write | Near (d=0) | Far (d=1) |
|---|---|---|---|
| Weight of early set | `ER.mix`         | 0.25 | 1.00 |
| Weight of late field | `FDN.mix`       | 0.10 | 1.00 |
| Room size | `ER.size` / `FDN.sizeScale` composite with SIZE | 0.5 / 0.5 | 1.4 / 1.8 |
| Decay time | `FDN.decay` (exp)          | 0.6 s | 6.0 s |
| Tonal tilt | `TiltEq.tilt`              | 0.55  | 0.30 (−0.10 DAMPING) |
| Air absorption | `FDN.dampHz` (exp)     | 14 kHz | 3 kHz (× (1 − 0.25·DAMPING)) |
| Image width | `Width.width` × user trim | 0.7 × WIDTH | 1.5 × WIDTH |
| Wet floor | `engineMix` = MIX × (0.5 + 0.5·d) | MIX·0.5 | MIX·1.0 |
| Mod depth / rate | `FDN.modDepth` / `modRate` | 0.10 / 0.15 Hz | 0.35 / 0.40 Hz |

### Why ER.mix and FDN.mix vary (and engineMix is still the master)

The chain's inner modules already expose their own dry/wet (`mix`),
which the other reverbs snap to 1.0 so engineMix alone governs. Near/Far
deliberately uses those inner mixes to stage the three fields
(direct/ER/late) against each other inside the wet bus, then engineMix
crossfades the whole stack against the true dry input. This is the only
reverb in the family that uses inner-mix balancing, and it does so with
no core changes — the hooks were already present for cross-family reuse.

### Independent offsets

- **SIZE** — biases room size independently of DISTANCE (so you can have
  a small near space or a large near space).
- **DAMPING** — biases air-absorption independently (humid vs dry rooms).
- **WIDTH** — user trim multiplied onto the distance-derived width.
- **MIX** — overall wet trim.

## Product / core split

### Core (all reused, unchanged)
- `EarlyReflectionsModule`
- `FdnReverbModule`           — **third consumer after MorphReverb, Gravity, ReverbBus** (now four total, still untouched)
- `TiltEqModule`
- `WidthModule`
- engineMix

### Product (Near/Far only)
- Single `applyAll()` re-compute: every macro recomputes the full mapping
  so DISTANCE + SIZE + DAMPING + WIDTH + MIX stay coherent.
- No timers, no DSP, no envelope subscriptions.

## Parity notes vs legacy `nearFarEngine.js`

| Area | Legacy | New | Verdict |
|---|---|---|---|
| ER / late topology | custom ER table + one-pole-damped feedback net | `EarlyReflections` + 8-ch Householder FDN | **Improved** — industry-standard late field, cleaner ER decorrelation |
| Distance mapping | single DISTANCE knob driving 6 parameters | single DISTANCE knob driving 10 parameters (inner-mix stages added) | **Improved** — inner-mix staging gives finer dry/ER/late weighting |
| Tone with distance | fixed LP roll-off | TiltEq tilt + FDN per-channel dampHz | **Improved** — frequency-dependent decay, not just flat LP |
| Width with distance | L/R gain scaling | `WidthModule` M/S | **Match-equivalent**, reusable |
| Decay growth with distance | fb scaled by distance | RT60-exact, 0.6→6 s exp | **Improved** — predictable decay times |
| Size coupling | SIZE ≈ DISTANCE | SIZE is an independent offset | **Improved** — orthogonal control |
| Output staging | mix + trim | engineMix × distance-derived floor | **Match** |

### Now matched / improved
- All legacy psychoacoustic cues are present; several upgraded
  (frequency-dependent damping, RT60-exact decay, orthogonal SIZE).

### Still differs (acceptable)
- Legacy had a subtle bandpass colouring around 1.5 kHz at max distance
  to mimic "voice-through-room" resonance. Not reproduced: would
  require a single-product resonator. If a user wants that timbre the
  TiltEq crossover can be moved there and tilt pushed negative.
- No HRTF-style near-field filtering. The product is not a binaural
  plugin; pure stereo distance cues only.

### Should remain different
- SIZE as an independent macro (not locked to DISTANCE). Plays cleanly
  with the rest of the plugin family; invites creative presets.

## Stability notes

- Pure composition of already-stable modules.
- All writes bounded: ER.mix/FDN.mix ∈ [0, 1]; engineMix clamped in
  setter; width clamped [0, 2] inside the product and again inside
  `WidthModule`.
- No timers, no port traffic.

## Files

| File | Change |
|---|---|
| `src/core/products/nearFar.js` | NEW |

**No changes to `dspWorklet.js` or `fxEngine.js`.** Third reverb
(after Orbit, ReverbBus) to ship as pure composition.

## Rules honoured

- **Reused only** EarlyReflections, FdnReverb, TiltEq, Width, engineMix.
- **No new core modules.**
- **DISTANCE, balance, tone and width behaviour all in product layer.**
- **FdnReverbModule untouched.**

## Reverb family — final tally

| Product | Branch | New core added in step |
|---|---|---|
| Smear       | CombBank | `CombBankModule`, `TiltEqModule` (Step 11) |
| MorphReverb | FDN      | `FdnReverbModule`, `WidthModule`, parallel-chain primitive (Step 12) |
| Gravity     | FDN      | `EarlyReflectionsModule` (Step 13) |
| Orbit       | CombBank | — (Step 14) |
| PlateX      | CombBank | `EnvelopeFollowerModule` (Step 15) |
| ReverbBus   | FDN      | — (Step 16) |
| Near/Far    | FDN      | — (Step 17) |

**7 products / 5 new generic modules + 1 primitive.** Every new module
has ≥2 real consumers. Cross-branch / cross-family reuse confirmed
(TapeCharacter in Smear, EnvelopeFollower in PlateX + ReverbBus).

## Risks to test on real audio

- DISTANCE sweep end-to-end → the psychoacoustic illusion should be
  convincing; tune the exact curves only if tests say the middle (d≈0.5)
  feels wrong.
- DISTANCE = 1 at short SIZE → composite size still grows; may need
  clamp if it feels incoherent ("far" in a small room).
- DAMPING = 1 at distance = 0 → tilt pulls slightly dark and dampHz
  drops to 10.5 k; expected, not a bug.
- WIDTH trim < 1 at DISTANCE = 1 → verify mono-compat; correlated
  far-field reverb collapses cleanly.
- Automating DISTANCE in real time → `applyAll()` re-writes ~10 params
  per call; fine for knob motion, fine for slow automation. If audio-rate
  DISTANCE automation is ever required it should move into a worklet
  macro primitive.

## Architectural state after Step 17

**Reverb family complete.** The plan in Step 10 is fully executed with
no scope creep. The next architectural phase (Dynamics: compressor,
expander, ducker, gate) is now cleanly unblocked — all deferred modules
in the Step-10 table either shipped (EnvelopeFollower) or remain
legitimately deferred pending second-consumer triggers.
