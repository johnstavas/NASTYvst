# ManChild — DSP Conformance Spec

> Contract this engine is measured against. Written against the
> `CONFORMANCE_SPEC_TEMPLATE.md` skeleton. Pair with
> `manChildEngine.js` (processor version v9) and
> `docs/UI_ISOLATION_RULES.md`.

---

## 0. Header

- **productId:** `manchild`
- **version:** `prototype` (first shipped rev; per DEV_RULES G4 — promote
  to `v1` on the next rev; pre-rename names were `legacy`/`engine_v1`)
- **spec version:** `1.0.0`
- **last reviewed:** `2026-04-19`
- **reviewer:** Claude (session)

---

## 1. Archetype Declaration

ManChild is a Fairchild 670M-inspired stereo **vari-mu bus compressor**
in the *Dynamics* system of the Audio Engineer Mental Model, with a
**glue + tone** behavior profile. Its compression cell is a pure,
distortionless AGC multiply (per Fairchild manual p.2); all harmonic
character lives in a single post-cell line-amp / output-transformer
stage. It is a *feedback* detector by hardware default, with a modern
feed-forward toggle.

---

## 2. Reference Anchors

| ID | Source | Section | Used for |
|----|--------|---------|----------|
| R1 | Fairchild 660/670 service manual | p. 1–6, esp. p. 2 | Topology mandate: cell is distortionless; no phase shift; no bias change during compression. All NL lives downstream. |
| R2 | DAFX (Zölzer 2011) | Ch. 4.2 — Dynamics, soft-knee gain computer, program-dependent release | Gain-reduction law (`grDb`), multi-stage release staging, attack/release coefficients. |
| R3 | DAFX (Zölzer 2011) | Ch. 4 — NL + tape + valve | Line-amp soft-clip with asymmetric bias (2nd + 3rd harmonic). |
| R4 | PASP (JOS) | Nonlinearity chapter + related | Unity-small-signal tanh soft-clip form + biased asymmetric saturation. |
| R5 | `audio_engineer_mental_model.md` | §3 Dynamics; glue + tone profile | Behavior profile target: "glue" = slow macro-GR, bus compressor ratio region; "tone" = post-cell even-order color. |
| R6 | `pasp_through_design_lens.md` | §3 plugin-type → DSP recipe | Vari-mu comp → soft-knee + feedback detector + post-cell NL recipe. |
| R7 | `manchild_lessons.md` | whole file | Implementation rules (master-IN post-cell pre-line-amp, dispose list, fade-in 180 ms silent + 60 ms ramp, comp-into-tube topology, channel-link-before-stage-switch). |
| R8 | UnFairchild 670M II service-data analysis | TC timings | TC1–TC6 attack/release values + piecewise xover thresholds (3 dB / 6 dB). |
| R9 | `DEV_RULES.md` | B2, B3, B4, C1, C3, D2, H1, H2, I1, I4, Q1, G4 | Topology + mix + dispose + latency + state exposure rules. |

---

## 3. Topology Contract

```
externalIn ──► scExternalSum ──┐
                               │
input ► inTrim ─┬─► splitIn ──► mergerIn ────► worklet AUDIO_IN
                │             (raw L/R, no gain — inGainA/B live INSIDE worklet)
                │
                └──► scTapA/B ─► scMerger ──► worklet SC_IN
                     (FF tap = pre-cell, post-splitter; inGain applied inside worklet)
                │
                └──► bypassRelay ──► sumNode  (dry hard-bypass path)

worklet.out ─► lineIn (master IN — drive into the tube)
            └─► splitOut ─► lineAmpA (WS 4x, the ONLY NL) ─┐
                         └─► lineAmpB (WS 4x, the ONLY NL) ┤
                                                           └─► mergerOut ─► wetGain ─► sumNode

sumNode ─► outTrim ─► fadeIn ─► output ─► chainOutput
```

| # | Node | Purpose | Anchor |
|---|------|---------|--------|
| 1 | `inTrim` | Unity passthrough + bypass tap point | R9 (I1) |
| 2 | `splitIn`, `mergerIn` | Route raw L/R to worklet audio in; per-channel input gain is *inside* the worklet so it applies in the active (L/R or M-S) domain | R9 (B3); R7 |
| 3 | `scTapA`, `scTapB`, `scMerger` | FF sidechain tap, per-channel SC enable. Raw L/R feed; worklet re-encodes + applies inGain so FF/FB read the same domain as cell | R9 (B2/B3) |
| 4 | `worklet` (AUDIO_IN / SC_IN) | M-S encode → FF/FB detector tap → full-wave + RMS blend → piecewise program-dep release → soft-knee vari-mu law → PURE LINEAR GR multiply → M-S decode → internal dry/wet sum | R1; R2; R9 (C3) |
| 5 | `lineIn` (master IN knob) | Drive level into the tube stage — post-cell, pre-line-amp. Separate from per-channel inGain. | R7 (master-IN rule) |
| 6 | `splitOut`, `lineAmpA/B` (4× WS), `mergerOut` | The ONLY nonlinearity in the whole path. Unity small-signal gain, C1-continuous, asymmetric (2nd + 3rd harmonic). Oversampled 4× inside WaveShaper. | R1 (p.2); R3; R4 |
| 7 | `wetGain` | Wet path gate (used by bypass relay only; mix blending lives in-worklet) | R9 (C3) |
| 8 | `bypassRelay` | Hard pre-cell pass-through used only at 100% bypass (no fractional mix → no comb) | R9 (H1) |
| 9 | `sumNode`, `outTrim`, `fadeIn`, `output`, `chainOutput` | Sum + output trim + 180 ms silent + 60 ms ramp mount | R9 (H2, I4) |

**Deliberate topology rulings (read before editing):**

- **Cell is distortionless.** The worklet applies GR as a *pure linear
  multiply*. No tanh, no EQ, no bias-shift inside the worklet. Any NL
  in the worklet is a violation of R1 p.2. *(DEV_RULES D5.)*
- **Master IN is post-cell, pre-line-amp.** R7 hard rule. Comp-into-tube
  topology. Moving it changes the plugin's identity.
- **Mix lives inside the worklet.** External parallel dry legs
  comb-filter due to 4× WS group-delay + worklet 128-sample quantum.
  *(DEV_RULES C3.)*
- **Input gain lives inside the worklet** (engine v9, "repair v1") so
  A/B labels track the active domain in M-S modes.
- **FB detector is the hardware default** (`fb: true` on every preset).
  FF is the modern extension. R1.

---

## 4. Parameter Contract

Mirrors `paramSchema` in `manChildEngine.js`. Any drift from this table
is a violation.

### 4.1 Global

| Setter | Range | Default | Unit | Kind | Audible effect | Anchor |
|--------|-------|---------|------|------|----------------|--------|
| `setIn` | −24…+24 dB | 0 dB | dB | db | Drive into the tube (post-cell line-amp). Higher = more saturation character. | R7 master-IN rule |
| `setOut` | −24…+24 dB | 0 dB | dB | db | Output trim; no DSP character. | — |
| `setMix` | 0…1 | 1.0 | norm | unit | Equal-power cos/sin parallel compression; dry = raw worklet input, wet = compressed + line-amp. | R9 (C1, C3) |
| `setBypass` | 0/1 | 0 | bool | bool | Hard relay around entire amp chain (cell + line amp). Not a worklet-only bypass. | R1 relay; R9 (H1) |
| `setTxDrive` | 0…1 | 0 | norm | unit | Rebuilds WaveShaper curve: clipper stiffness `k = 1 + 3.5·d`; DC bias `0.22·d` (2nd harmonic); cubic trim `0.04·d` (tiny 3rd). Unity small-signal. | R3; R4 |
| `setFB` | 0/1 | 1 | bool | bool | Feedback detector on (hardware default) vs feed-forward. | R1 |
| `setChannelMode` | 0..3 enum | 1 (LINK) | enum | enum | IND / LINK (deeper-GR wins) / M-S / M-S LINK (0.7·Mid + 0.3·Side blend). | R9 (B2); R2 |
| `setCharacter` | enum of preset keys | null | enum | preset | Applies bulk preset from `MANCHILD_PRESETS` through public setters only (via `applyBulk`). | R9 (D2) |

### 4.2 Per-channel (A = Left/Mid, B = Right/Side)

| Setter | Range | Default | Unit | Kind | Audible effect | Anchor |
|--------|-------|---------|------|------|----------------|--------|
| `setInputGainA` / `B` | 0…+24 dB | 0 dB | dB | db | Pre-cell input drive in the active domain. In M-S mode: A drives Mid, B drives Side. | R9 (B3); v9 repair note |
| `setThresholdA` / `B` | 0…1 (→ −36…0 dBFS) | 0.45 | norm | unit | Vari-mu detection threshold. `thDb = −36 + thPos·36`. | R2 §4.2 |
| `setDcA` / `setDcB` | 0…1 | 0.5 | norm | unit | Detector sensitivity trim (sensDb = −3…+7). Does NOT change knee or ratio — these are tube constants. | R1 rear-panel DC |
| `setVarAtkA` / `B` | 0…1 | 0.5 | norm | unit | When TC is VAR1–VAR4, scales attack log between `aMin…aMax`. | R8 |
| `setVarRelA` / `B` | 0…1 | 0.5 | norm | unit | When TC is VAR1–VAR4, scales release between `rMin…rMax`. | R8 |
| `setTcA` / `setTcB` | 0..9 enum | 1 (TC2) | enum | enum | TC1–TC6 fixed + VAR1–VAR4 variable; TC5 dual, TC6 tri piecewise release. | R8; R2 |
| `setScA` / `setScB` | 0/1 | 1 | bool | bool | Sidechain enable; gates both FF tap and FB param. | R9 (B2) |

### 4.3 Declared no-ops (documented, not removed — UI continuity)

| Setter | Reason |
|--------|--------|
| `setOutputGainA`, `setOutputGainB` | No per-channel output on Fairchild 670 topology. Use `setOut`. *(Legacy UI knob retained; DSP intentionally empty.)* |

**Fixed tube constants (not user-facing; no setters):**

- `VARI_MU_KNEE = 8 dB`
- `VARI_MU_RATIO = 10:1` (effective; most programme sees 3:1–6:1 because
  content rarely clears the full knee)
- Detector RMS window = 30 ms
- GR smoothing = 4 ms exp (zipper-free)
- Meter push = every 6 blocks (~16 ms @ 48k)

---

## 5. Macro Setters

### `setCharacter(name)` — preset applicator

- **Inputs:** key of `MANCHILD_PRESETS` (41 entries across vocal, drum,
  instrument, mix bus, M/S, character, drum detail, vocal detail,
  instrument detail, mastering, M/S advanced, VAR mode groups).
- **Underlying params written:** `inDb, outDb, mix, bypass, inA, inB,
  thA, thB, dcA, dcB, varAtkA, varRelA, varAtkB, varRelB, fb, chanMode,
  txDrive, tcA, tcB, scA, scB`.
- **Routing:** routes through `applyBulk()`, which calls the public
  setters one per field. Therefore every preset change is observable by
  a param-diff harness and respects D2.
- **Authoritative-state check:** `state.character = name` is set after
  `applyBulk` completes. Exposed read-only in `getState()`.
- **D2 compliance:** ✅ — no dead mirror vars; no direct AudioParam
  writes bypassing setters (the *setters* write params; the macro
  doesn't).

### Implicit macro: `applyBulk(obj)`

Field-by-field fan-out to public setters. Public API by design (used by
QC harness for preset sweeps and by `setCharacter`).

---

## 6. Measurable Conformance Targets

Phase C targets the harness must be able to evaluate against a QC
snapshot. Every row here is a check the harness Phase C runner is
expected to implement.

| ID | Condition | Metric | Expected | Tolerance | Anchor |
|----|-----------|--------|----------|-----------|--------|
| M1 | Bypass on; pink −18 dBFS LUFS-M; fadeIn settled | Null residual (input vs output) | < −120 dB RMS | — | R9 (H1, I4) |
| M2 | `getLatency()` query | reported latency | 0 samples | exact | R9 (I4) |
| M3 | Bypass on; settle 500 ms; pink −18 dBFS | `engineState.bypass` | 1 | exact | §4.1 |
| M4 | `setFB(false)`; input = sine 1 kHz −12 dBFS; `setThresholdA(pos for −20 dB)`; DC=0.5 | Steady-state `grDbA` at `detDb ≈ −12` | ≈ 4.0 dB | ±1.0 dB | R2 soft-knee formula with knee=8, ratio=10 |
| M5 | `setTxDrive(0.0)`; sine 1 kHz −12 dBFS, no GR | THD | < 0.05 % (−66 dB) | — | R1 p.2 |
| M6 | `setTxDrive(0.7)`; sine 1 kHz −6 dBFS, bypass cell (threshold above signal) | H2/H3 amplitude ratio | H2 > H3 (H2/H3 > 2) | — | R3; `makeLineAmpCurve` |
| M7 | `setTxDrive(0.7)`; sine 1 kHz −6 dBFS | DC offset at output | < −60 dB of RMS (dcOut subtraction working) | — | `makeLineAmpCurve` `dcOut` |
| M8 | `setTcA(TC1)`, `setFB(false)`; step pink at −12 dBFS; threshold at −20 | Attack time-constant (90% target) | ≈ 0.2 ms | ±25% | R8 TC1 |
| M9 | `setTcA(TC4)`; same step test | Attack time-constant | ≈ 0.8 ms | ±25% | R8 TC4 |
| M10 | `setTcA(TC1)`; release from 6 dB GR | Release τ, stage-1 | ≈ 300 ms | ±20% | R8 TC1 |
| M11 | `setTcA(TC6)`; hold 10 dB GR for 2 s then release | 3-stage piecewise release (300 ms → ~10 s → ~25 s), xover at 3 dB / 6 dB | Stages transition at ±1 dB of xover | — | R8 TC6 |
| M12 | `setChannelMode('LINK')`; L at −12 dBFS, R at −6 dBFS, threshold such that R is hitting | `grDbA ≈ grDbB` (deeper-GR wins) | diff < 0.5 dB | — | §4.1 |
| M13 | `setChannelMode('M-S')`; L=R signal (pure mid) | Side channel envelope (`peakInB`) | ≈ 0 | < −80 dB | §4.1 |
| M14 | `setMix(0.0)` at any settings | Null residual vs. dry | < −90 dB | — | R9 (C3) |
| M15 | `setMix(0.5)`; swap `chanMode` during playback | No comb-filter notch audible; no amplitude droop | equal-power cos/sin preserved | — | R9 (C1) |
| M16 | `setScA(false)`; drive SC bus at any level | `grDbA` | 0 (no compression) | exact | §4.2 |
| M17 | Preset `'Drum Bus – Glue 2dB'` @ pink −14 dBFS programme | Steady-state `grDbA` | ≈ 2 dB | ±1 dB | Preset intent |
| M18 | Preset `'Heavy Comp – 10dB'` @ pink −14 dBFS programme | Steady-state `grDbA` | ≈ 10 dB | ±2 dB | Preset intent |
| M19 | After `setCharacter(...)` for every preset key | `applyBulk` resolved all 21 fields; `engineState` matches preset object within setter rounding | diff per field < 1 step | — | R9 (D2) |
| M20 | Any preset change | `changedParamsFromPrevious` includes setters whose value actually changed | no false positives, no false negatives | — | Snapshot schema v2 |

---

## 7. UI-Isolation Conformance

- **Public setter surface (allowed from React):** `setIn, setOut,
  setMix, setBypass, setTxDrive, setFB, setChannelMode, setCharacter,
  setInputGainA, setInputGainB, setOutputGainA (no-op),
  setOutputGainB (no-op), setThresholdA, setThresholdB, setDcA, setDcB,
  setVarAtkA, setVarRelA, setVarAtkB, setVarRelB, setTcA, setTcB,
  setScA, setScB, applyBulk`.
- **Observer surface (read-only; allowed from React):** `input`,
  `output`, `chainOutput`, `getSidechainInput()`, `getInputPeakA/B`,
  `getOutputPeakA/B`, `getGrDbA/B`, `getLatency`, `getState`,
  `isBypassed`.
- **No exceptions.** All three UI-isolation enforcement layers (static
  grep, write-origin proxy, idle null) must pass.

Phase B review note: the JSX side (`ManChildOrb.jsx`) must be audited
against this surface — it is not in scope for this spec file but is in
scope for the Conformance Report.

---

## 8. Non-Goals / Known Deviations

- **Only one TC table.** We implement TC1–TC6 per R8. The physical 670
  has an additional mode-6/mode-7 variant in some service-data sheets;
  we deliberately do not model those.
- **Fixed knee & ratio.** The 670 has no front-panel ratio or knee
  control; VARI_MU_KNEE and VARI_MU_RATIO are tube constants here. This
  is intentional, not missing functionality.
- **Line-amp model is single-stage.** R1 allows for more elaborate
  transformer modeling; we intentionally ship a single C1 asymmetric
  soft-clip + cubic-3 trim as a clean, measurable NL. Transformer
  low-end saturation, hysteresis, and core loss are out of scope for
  v1.
- **No oversampling on the cell.** Oversampling lives only in the
  WaveShaper (4×). The cell is distortionless by design (R1 p.2), so
  no new harmonics are generated inside the worklet and no OS is
  required there.
- **`setOutputGainA/B` are intentionally no-ops.** Left in the
  `paramSchema` so legacy UI bindings don't break; documented here so
  a reviewer doesn't "fix" them.
- **Bypass relay is an external dry leg.** Allowed because it is only
  engaged at 100% dry (bypass=on), never at fractional mix — so comb
  filtering (DEV_RULES C3) cannot occur.

---

## 9. Change Log

| Date | Spec version | Change | Reviewer |
|------|--------------|--------|----------|
| 2026-04-19 | 1.0.0 | Initial spec, written against engine v9 / PROCESSOR_VERSION v9. | Claude |
