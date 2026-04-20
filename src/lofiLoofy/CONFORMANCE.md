# Lofi Loofy — DSP Conformance Spec

> Contract this engine is measured against. Pair with
> `lofiLoofyEngine.js` and `docs/UI_ISOLATION_RULES.md`. Written
> against the `CONFORMANCE_SPEC_TEMPLATE.md` skeleton.

---

## 0. Header

- **productId:** `lofi_loofy`
- **variantId:** `legacy` (first shipped rev; per DEV_RULES G4 — promote to `engine_v1` on next rev)
- **spec version:** `1.0.0`
- **last reviewed:** `2026-04-19`
- **reviewer:** Claude (session)

---

## 1. Archetype Declaration

Lofi Loofy is a **tape / cassette / sampler-era vibe box** in the
*Character* system of the Audio Engineer Mental Model, with a **tone +
movement + media-wear** behavior profile. Its identity is movement
(drift / flutter / Dream LFO), media wear (dust, dropouts, bandwidth
narrowing, bit/rate reduction), and emotional softening — *not*
saturation or aggression. Saturation is supporting, never lead.
Latency: **36 ms fixed** (30 ms tape baseline + 6 ms parallel comp
lookahead); dry leg is compensated by `dryCompensate` so MIX is
phase-coherent.

---

## 2. Reference Anchors

| ID | Source | Section | Used for |
|----|--------|---------|----------|
| R1 | DAFX (Zölzer 2011) | Ch. 12 — Virtual Analog (tape echo, spring, plate) | Tape-delay chain; plate-style `dreamReverb`. |
| R2 | DAFX (Zölzer 2011) | Ch. 3 — Modulation | Drift / Flutter LFO modulation of a delay line. |
| R3 | DAFX (Zölzer 2011) | Ch. 4 — NL / tape saturation / valve | `satShape` + `crushShape` asymmetric soft-clip families. |
| R4 | PASP (JOS) | Wow/flutter + delay-line modulation | Drift (~0.35–0.80 Hz) and flutter (~4.5–7.5 Hz) rates and depth conventions. |
| R5 | `audio_engineer_mental_model.md` | Character system | Behavior profile target: warmth + movement + wear; anti-pattern of "character = just saturation". |
| R6 | `pasp_through_design_lens.md` | §warmth / §space / §drive | Plugin-domain → DSP recipe mapping used for Tone, Dream, Texture. |
| R7 | `reverb_engine_architecture.md` | Plate/short FDN | `dreamReverb` is a short plate-style tail on a send. |
| R8 | `bbd_holters_parker_model.md` | BBD conventions | Delay-line aliasing character (informative — current implementation uses native `DelayNode`, not a full BBD model; see Non-Goals). |
| R9 | `feedback_unique_plugins.md` | whole file | "No reskins" rule: this plugin's identity is movement + wear, not saturation. |
| R10 | `DEV_RULES.md` | B1, B4, C3, C5, D2, H1, H2, I1, I4, Q1, G4 | Rack contract, dual-write ban, mix rule, true-mono rule, macro-setter rule, dispose list, fade-in, topology comment, latency reporting, getState mandate. |

---

## 3. Topology Contract

Authoritative topology (mirrors the block comment at engine L17–37):

```
input ─► inGain ─┬─► dryCompensate(36ms) ─► dryGain ────────────────────────┐
                  │                                                          │
                  └─► toneTilt ─► toneLP ─► lowSatPre ─► satShape ─►         │
                      lowSatPost ─► subHum ─► lowBloom ─► ageHP ─►           │
                      ageCrush ─► ageLP ─► bwLP ─► bwHP ─► tapeDelay ─►      │
                      bitsShaper ─► rateLP ─► glueComp ─► wetTrim ─┬─► compDryDelay ─► compDry ─┐
                                                                  │                             │
                                                                  └─► crushShape ─► crushComp ─►│
                                                                      crushMakeup ─► vibeBody ─►│
                                                                      pumpGain ─► compWet ──────┤
                                                                                              compMix
                                                                  compMix ─► boomShelf ─► wetGain ─►│
                      wetTrim ─► reverbSend ─► dreamReverb ─► reverbReturn ─────────► wetGain ─►│
                                                                                                preOut
noiseSrc ─► hissFilters ─► noiseGain ┐                                                           ▲
gritSrc  ─► crackleHP   ─► crackleGain ┴─► dustBus ─► wetGain ──────────────────────────────────┘

preOut ─► widthIn ─► widener ─► widthOut ─► dropDuck ─► outGain ─► output
```

**Topology rulings (read before editing):**

- **Latency is 36 ms by design.** `getLatency()` returns `0.036`. The
  `dryCompensate(36 ms)` on the dry leg is mandatory — removing it
  re-introduces comb filtering at MIX < 1 (R10 C3).
- **Saturation is supporting.** `satShape` and `crushShape` are the
  only NL stages in the path (plus the bits/rate/age trio). Adding
  additional saturation nodes violates the archetype (R9).
- **Dust bus is additive, not modulating.** Pink noise + grit → summed
  into `wetGain`. No dust-bus coupling back into the main chain.
- **Width = 0 MUST equal (L+R)/2 on both channels at matched level.**
  The `setWidth` setter has a self-flag in the code: the current
  cross-swap path is FLAGGED for correction (R10 C5). See Non-Goals
  §8.1.
- **Dream MAY modulate internal DSP but NOT user-controlled
  AudioParams.** The `mix` target currently dual-writes `dryGain` /
  `wetGain` — flagged for migration to a dedicated `mixMod` series
  node (R10 B4). See Non-Goals §8.2.

---

## 4. Parameter Contract

Mirrors `paramSchema` at engine L985–1024. 28 setters across 6 groups.

### 4.1 Rack (standard contract)

| Setter | Range | Default | Kind | Effect | Anchor |
|--------|-------|---------|------|--------|--------|
| `setIn` | 0…2 | 1 | unit (lin) | Master input trim. Feeds BOTH dry and wet legs so MIX ratio stays stable as IN moves. | R10 B1 |
| `setOut` | 0…2 | 1 | unit (lin) | Output trim (post-duck). | — |
| `setMix` | 0…1 | 1 | unit | Equal-power dry/wet crossfade; dry is 36 ms-compensated. | R10 C3 |
| `setBypass` | 0/1 | 0 | bool | Relay-style bypass (silences wet chain). | R10 H1 |

### 4.2 Macros (knob-driven movement / wear)

| Setter | Range | Default | Audible effect | Anchor |
|--------|-------|---------|----------------|--------|
| `setAge` | 0…1 | 0 | Composite macro: BW narrow + LP roll-off + age-crush + subtle sat bump. | R3, R6 |
| `setDrift` | 0…1 | 0 | Delay-line pitch drift: 0–14 ms depth, LFO 0.35→0.80 Hz. Also softens top end. | R2, R4 |
| `setFlutter` | 0…1 | 0 | Delay-line flutter: 0–1.8 ms depth, LFO 4.5→7.5 Hz. Softens head-loss curve. | R2, R4 |
| `setDust` | 0…1 | 0 | Independent dust bus (hiss + grit). Pure additive; no main-chain coupling. | R3 |
| `setDropouts` | 0…1 | 0 | Timed amplitude dropouts + HF dip on trigger. | R2 |
| `setTexture` | 0…1 | 0 | Adds to Age's sat contribution (composer max-mode, not overwrite). | R3 |

### 4.3 Tone / Width / Glue

| Setter | Range | Default | Audible effect | Anchor |
|--------|-------|---------|----------------|--------|
| `setTone` | 0…1 | 0.5 | Authoritative LP base: 1200 → 16000 Hz. Also tilts shelf. Overrides Age's LP contribution. | R6 warmth |
| `setWidth` | 0…2 | 1 | 1 = neutral; <1 Haas-narrow (→ mono); >1 Haas cross-feed. | R10 C5 |
| `setGlue` | 0…1 | 0 | Main-chain `DynamicsCompressor`: thr −8→−28, ratio 1→3. | R3 |
| `setDream` | 0…1 | 0.5 | Plate-tail reverb send scaled 0 → 0.55. | R7 |

### 4.4 Parallel Comp (Crush + Pump + Blend + Vibe)

| Setter | Range | Default | Audible effect | Anchor |
|--------|-------|---------|----------------|--------|
| `setCrush` | 0…1 | 0 | Wet-leg sat curve rebuild + threshold −10→−30, ratio 1→6, makeup 1→1.55. | R3 |
| `setPump` | 0…1 | 0 | Unipolar ducking: baseline shifts down; LFO swings [1−depth, 1]. | R2 |
| `setCompBlend` | 0…1 | 0.5 | Linear crossfade dry↔wet comp leg. Linear, not equal-power — legs are correlated. | — |
| `setCompOff` | 0/1 | 0 | Whole-stage neutral: Glue/Crush/Pump/Blend forced to unity DSP without clearing stored values. | R10 D2 |
| `setCompVibe` | 0/1 | 0 | Slower/deeper character: softer knee (14 vs 6), slower attack (10 vs 2 ms), longer release (340 vs 90 ms), body-bump at 220 Hz +2.5 dB. | R3 |

### 4.5 Low / Digital

| Setter | Range | Default | Audible effect | Anchor |
|--------|-------|---------|----------------|--------|
| `setBoom` | 0…1 | 0 | 120 Hz low-shelf 0→+8 dB. Additive weight, not compression. | — |
| `setBits` | 0 or 6…16 | 0 (off) | Quantization curve (WaveShaper); 0 = passthrough. | R3 |
| `setRate` | 0 or 100…48000 Hz | 0 (off) | Biquad LP at target/2 as a ZOH proxy. 0 = passthrough. | R3 |

### 4.6 Dream (modulation subsystem)

| Setter | Range | Default | Effect | Anchor |
|--------|-------|---------|--------|--------|
| `setDreamRate` | 0.05…5 Hz | 0.25 | LFO rate for Dream modulator. | R2, R4 |
| `setDreamDepth` | 0…1 | 0.5 | LFO depth. | — |
| `setDreamDrift` | 0…1 | 0.3 | Smoothing/trailing diffusion on LFO output. | R7 |
| `setDreamTarget` | enum `DREAM_TARGETS` | `'tone'` | Destination of the Dream modulator. `mix` target currently dual-writes — see §8.2. | R10 B4 |

### 4.7 Character

| Setter | Values | Default | Effect | Anchor |
|--------|--------|---------|--------|--------|
| `setCharacter` | keys of `LOFI_CHARACTERS` (`Tape`, `Cassette`, `Sampler`, `Radio`, `Dusty`, `Slam`) | null | Macro: sets `tilt`, `toneLP` (authoritative `_toneLPBase`), `bwLP`, `bwHP`, `driftRate`, `flutterRate`, `satBase`, `dreamRate`, `dreamTarget`. | R5, R9 |

---

## 5. Macro Setters

### `setCharacter(name)` (L951–978)

- **Writes authoritative state, then calls recomputer** (DEV_RULES D2
  route B):
  - `_toneLPBase = p.toneLP` → `recomputeToneLP()` so Age/Drift/Flutter
    multipliers still apply.
  - `satBase = p.satBase` → `satShape.curve = buildSatCurve(satBase)`.
  - Direct writes to `toneTilt.gain`, `bwLP.frequency`, `bwHP.frequency`,
    `driftLFO.frequency`, `flutterLFO.frequency` via `setTargetAtTime`
    — NOT dead mirrors; these are the authoritative nodes.
- **Exposed state:** `currentCharacter` + `charTilt`, `charBwLPHz`,
  `charBwHPHz`, `charDriftRate`, `charFlutterRate`, `satBase` in
  `getState()` — so QC can distinguish characters even when main
  sliders don't move.
- **Scope limit (intentional):** `setCharacter` does NOT touch
  Crush/Pump/Glue/Boom/Bits/Rate. This is deliberate — character is a
  *vibe* macro, not a full state recall. (See §8.3.)

### `applyBulk(obj)` (L1333–1353)

- Map-driven fan-out to public setters. 24 recognized keys.
- **Unknown keys silently ignored** (comment L1332: "stale/old-save
  blobs never crash"). This is the opposite stance from ManChild's F3
  fix — intentional here because saves/presets may carry fields from
  future or past revs.
- **D2 compliance:** ✅ — every write goes through a public setter; no
  direct AudioParam writes in the macro.

---

## 6. Measurable Conformance Targets

Phase C targets. Numbers derived from the engine's own constants; any
drift from these is a regression.

| ID | Condition | Metric | Expected | Tolerance | Anchor |
|----|-----------|--------|----------|-----------|--------|
| M1 | `setBypass(true)`; pink −18 dBFS; settle 500 ms | Null residual (input vs output, 36 ms aligned) | < −90 dB RMS | — | R10 H1 |
| M2 | `getLatency()` query | reported latency | 0.036 s | exact | R10 I4 |
| M3 | `setBypass(true)` | `engineState.bypass` | 1 | exact | §4.1 |
| M4 | `setMix(0.0)`; any settings | Null residual (input vs output, 36 ms aligned) | < −80 dB RMS | — | R10 C3 |
| M5 | `setWidth(0.0)`; stereo pink, L≠R | L[n] == R[n] == (Lin+Rin)/2 | < −70 dB RMS L/R diff | — | R10 C5 (known-soft; see §8.1) |
| M6 | `setWidth(1.0)`; stereo pink | L/R passthrough unity | < −90 dB per channel | — | §4.3 |
| M7 | `setAge(0) + setDrift(0) + setFlutter(0) + setDust(0) + setDropouts(0) + setTexture(0) + setCrush(0) + setPump(0) + setGlue(0) + setBits(0) + setRate(0) + setBoom(0)`, all other defaults | Wet chain contributes minimal character | `deltaRmsDb` < 1.5 dB; centroid shift < 10 % | — | Archetype neutrality |
| M8 | `setDrift(1.0)`; sine 1 kHz −12 dBFS | Peak-to-peak pitch deviation | ~ ±14 ms × 0.35–0.80 Hz LFO = audible drift | ±25 % | R2 |
| M9 | `setFlutter(1.0)`; sine 1 kHz −12 dBFS | Peak-to-peak pitch deviation | ~ ±1.8 ms × 4.5–7.5 Hz LFO | ±25 % | R2 |
| M10 | `setBits(8)`; sine 1 kHz −6 dBFS | Quantization noise floor | ~ −48 dB (8-bit theoretical) | ±6 dB | R3 |
| M11 | `setRate(8000)`; full-band sweep | HF roll-off at 4 kHz (rateLP = target/2) | −3 dB at 4 kHz | ±1 kHz | §4.5 |
| M12 | `setBoom(1.0)`; pink input | 120 Hz shelf gain | +8 dB | ±1 dB | §4.5 |
| M13 | `setGlue(1.0)`; pink −10 dBFS | Steady-state GR on `glueComp` | 4–8 dB | — | §4.3 |
| M14 | `setCompOff(true)` after any Crush/Pump/Glue setting | Wet-chain null vs `setCompOff(false)` followed by `setCrush(0)/setPump(0)/setGlue(0)` | < −60 dB | — | R10 D2 |
| M15 | `setCompOff(true) → setCompOff(false)` | Stored `_crushAmt/_pumpAmt/_glueAmt/_compBlendAmt` restored via public setters | `engineState` matches pre-toggle snapshot | exact | R10 D2 |
| M16 | For every character in `LOFI_CHARACTERS` | `engineState.character`, `charTilt`, `charBwLPHz`, `charBwHPHz`, `charDriftRate`, `charFlutterRate`, `satBase` match character definition | exact | — | §4.7 |
| M17 | After `setCharacter(name)` | Main knob values (`age`, `drift`, `flutter`, `dust`, `dropouts`, `texture`, `crush`, `pump`, `glue`, `boom`, `bits`, `rate`) UNCHANGED from pre-call | exact | — | §5 (intentional scope limit) |
| M18 | `setDream(0)` | `reverbSend.gain.value` | 0 | exact | §4.3 |
| M19 | `setDreamTarget('mix')` + `setDream(1)` + `setDreamRate(1)` | `mixVal` stays constant in `getState()` | exact | — | §8.2 flagged: currently fails — DSP dual-writes dryGain/wetGain |
| M20 | `setDust(0)` | `noiseGain.gain`, `crackleGain.gain` | both 0 | — | §4.2 |

---

## 7. UI-Isolation Conformance

- **Public setter surface:** as enumerated in §4 (28 setters).
- **Observer surface:** `input`, `output`, `chainOutput`,
  `getInputPeak`, `getOutputPeak`, `getAge`, `getDreamValue`,
  `getLatency`, `getState`, `isBypassed`.
- **Exceptions:** none.

All three enforcement layers (static, runtime proxy, idle null) must
pass for conformance.

---

## 8. Non-Goals / Known Deviations

### 8.1 `setWidth(0)` not guaranteed exactly mono

Cross-swap topology does not produce exact `(L+R)/2` on both channels.
Self-flagged in engine comment at L1141–1145. Tolerated at spec v1.0.0
under the expectation of a follow-up mono-collapse fix. Scheduled for
spec v1.1.0.

### 8.2 Dream `mix` target dual-writes user-controlled params

`setDreamTarget('mix')` currently drives `dryGain` / `wetGain` — the
same AudioParams `setMix` writes. Violates R10 B4. Migration plan:
insert a dedicated `mixMod` series gain node in the dry+wet sum so
Dream can modulate *after* the user's Mix setting without mutating it.
Scheduled for spec v1.1.0.

### 8.3 `setCharacter` does not touch Crush/Pump/Glue/Boom/Bits/Rate

Intentional. Character = vibe macro (tone/movement character), not a
full state recall. Slam's aggressive comp/crush is a user choice on top
of the Slam *character*, not a side effect of it. Documented so a
future reviewer doesn't "fix" it.

### 8.4 BBD model not implemented

Delay-line modulation uses native `DelayNode`; full Holters-Parker BBD
model (R8) is out of scope for v1. The effect is tape-delay-ish, not
bucket-brigade-accurate.

### 8.5 `applyBulk` silently ignores unknown keys

Opposite of ManChild's F3 fix. Intentional here because save/preset
blobs routinely carry legacy or forward-rev fields. Logging is OK; hard
errors are not.

---

## 9. Change Log

| Date | Spec version | Change | Reviewer |
|------|--------------|--------|----------|
| 2026-04-19 | 1.0.0 | Initial spec. Written against post-fix engine (stale-closure fix + `_toneLPBase` sync fix + `setDream` default fix landed). | Claude |
