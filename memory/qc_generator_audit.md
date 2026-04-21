# QC Generator Audit — qcPresets.js vs. Family Map

> Systematic diff of `src/qc-harness/qcPresets.js` (generator) against
> `memory/qc_family_map.md` (spec). Produced 2026-04-20.
>
> **Reading order:** §1 is the concrete gap list. §2 is the "this is
> fine" list. §3 is tier-label mismatches (minor). §4 is the
> prioritized fix order.

---

## 1. Gaps — family-map cells the generator does NOT cover

### 1.1 Missing rule: **loudness-comp** (T3)

Family map marks this as T3 for:
- Character / saturation (tube, tape, transformer)
- Distortion (waveshaper, fuzz, amp sim)
- Clipper — soft
- Cascaded nonlinearity
- Amp sim (multi-stage)

**Generator: no `loudness_comp` preset emitted anywhere.** No rule in
qcAnalyzer.js either.

**What the rule should do:** Plugins in these families are expected to
add ~loudness under drive. The rule asserts that within-plugin loudness
delta is bounded (e.g. ≤ +3 dB vs input at typical drive). Findings
explain loudness is normal for the family; only fire when the delta
exceeds plausible character-plugin expectations.

**Priority: HIGH.** This is the class of rule that directly drives the
"my plugin is too loud" user experience Codex's spec walks through.

---

### 1.2 Missing rule: **hysteresis edge-flutter** (T2)

Family map marks this as T2 for Dynamics — gate / expander.

**Generator: no `hysteresis_flutter` preset emitted.**

**What the rule should do:** Stimulus near threshold, with small
random perturbation, counts gate open/close events per second. Healthy
gate = stable state near threshold; buggy gate = rapid flutter.

**Priority: MEDIUM.** Only fires for gate/expander family. No
gate/expander plugins ship yet, so this can land when the first one
does.

---

### 1.3 Missing rule: **per-band sidechain regime** (T3)

Family map marks this as T3 for Dynamics — multiband comp and
Band-split / multiband.

**Generator: `sidechain_regime` exists (gated on `hasSidechain`) but
fires once, not per-band.**

**What the rule should do:** For each band, run the three SC regimes
(silence / hot / copy) separately. Requires the engine to expose
per-band SC setters.

**Priority: LOW.** No multiband plugins ship yet.

---

### 1.4 Missing rule: **ring-mod critical frequency** (T2)

Family map marks this as T2 critical for Modulation — ring mod / freq
shift: "ring mod at 0.4·Fs aliases violently without OS."

**Generator: covered partially by `extreme_freq` T2 but not
ring-mod-specific.**

**What the rule should do:** Stimulus = sine at 0.4·Fs, assert output
has no components above Nyquist (in OS domain if declared).

**Priority: LOW-MEDIUM.** Only fires if `isRingMod` flag declared. No
ring mod plugins ship yet.

---

### 1.5 Missing rule: **rotary triad** (T3/T4)

Family map marks Modulation — rotary / Leslie as "combines LFO +
filter + delay — inherits all three risks."

**Generator: individual pieces covered (`hasLFO` → drift,
`hasFeedback` → FB runaway) but no rotary-specific combined gate.**

**Priority: LOW.** No rotary plugins ship yet.

---

## 2. Rules the generator covers correctly

For the record (so we don't re-audit later):

| Family-map ✓ cell | Generator ruleId | Status |
|---|---|---|
| Mix null (all families, T1) | `mix_null`, `mix_identity`, `mix_sanity` | ✓ |
| Mix null coloration-bearing (T1) | `mix_null_series` gated on `nonlinearStages>0` | ✓ proven on ManChild |
| FB × Mix coupling (T1) | `fb_mix_coupling` gated on `hasFeedback` | ✓ |
| Zipper (T1) | `zipper` per-param | ✓ |
| Mode storm (T1) | `mode_storm` gated on `modes[]` | ✓ |
| Impulse / IR (T2) | `impulse_ir` | ✓ |
| Denormal tail (T2) | `denormal_tail` — auto-pushes FB to 0.99 | ✓ |
| Pathological stereo (T2) | `pathological_stereo` × 4 variants | ✓ |
| DC + near-Nyquist (T2) | `extreme_freq` × 4 freqs | ✓ |
| Bypass exact (T2) | `bypass_exact` gated on setBypass | ✓ |
| Freeze stability (T3) | `freeze_stability` gated on `hasFreeze` | ✓ |
| Sidechain regime (T3) | `sidechain_regime` × 3 regimes | ✓ (single-band) |
| Feedback runaway (T3) | `feedback_runaway` gated on `hasFeedback` | ✓ |
| Latency report (T3) | `latency_report` gated on `latencySamples>0` | ✓ |
| Monosum null (T3) | `monosum_null` gated on `hasStereoWidth` | ✓ |
| Band reconstruction (T2/T3) | `band_reconstruction` gated on `hasMultiband` | ✓ |
| LPC stability (T3) | `lpc_stability` gated on `hasLPC` | ✓ |
| FFT frame phase (T3) | `fft_frame_phase` gated on `hasFFT` | ✓ |
| WDF convergence (T3) | `wdf_convergence` gated on `hasWDF` | ✓ |
| Pitch idle (T3) | `pitch_idle` gated on `hasPitchDetector` | ✓ |
| Sample-rate matrix (T4) | `sample_rate_matrix` gated on srSensitive tokens | ✓ |
| OS boundary (T4) | `os_boundary` gated on `osThresholds[]` | ✓ |
| Series identity (T4) | `series_identity` gated on subcategory tokens | ✓ |
| Long-session drift (T4) | `long_session_drift` opt-in only | ✓ |

---

## 3. Tier-label mismatches

Cells where the family map says Tier-N but the generator fires it at
Tier-M. All are cases where the generator is **more aggressive**
(fires earlier). Not blocking — listing for awareness.

| Rule | Map tier | Generator tier | Assessment |
|---|---|---|---|
| `mode_storm` | T2 (gate/expander only) | T1 (any plugin with `modes`) | Generator is broader. Fine. |
| `zipper` | T2 (transient designer) | T1 (every continuous param) | Generator is broader. Fine. |
| `latency_report` | T1 (lookahead limiter) | T3 (any `latencySamples>0`) | Map says cheaper; generator gates it anyway. Align later. |
| `band_reconstruction` | T2 (band-split) | T3 (multiband) | Minor. Fine. |

---

## 4. Flag gaps (from capability glossary §3)

The generator gates on 18 known flags. The family map implies 12
more. Adding them would improve precision but not correctness.

Priority order for adding flags:

| Flag | Priority | Unblocks |
|---|---|---|
| `isClipper: 'hard' \| 'soft'` | MEDIUM | Clipper-specific OS mandatory behavior |
| `hasLookahead` | MEDIUM | Tightens `latency_report` to intentional latency only |
| `isPassThrough` | LOW | Utility scope bit-match expectation |
| `isTransientDesigner` | LOW | Tighter zipper + impulse coupling |
| `isRingMod` | LOW | Prereq for §1.4 |
| `hasHysteresis` | LOW | Prereq for §1.2 |
| `hasRegen` | LOW | Tightens phaser FB to intentional regen only |
| `isDeEsser` | LOW | De-esser SC filter stability |
| `isRotary` | LOW | Prereq for §1.5 |
| `hasVariableClockRate` | LOW | BBD rolling OS — prereq for first BBD plugin |
| `isConvolver` | LOW | Replaces subcategory string trigger |
| `isAmpSim` | LOW | Replaces subcategory string trigger |

---

## 5. Prioritized fix order

Based on **what unblocks the most plugins** and **what the existing
roadmap actually needs first:**

1. **[HIGH] Add `loudness_comp` rule + preset (§1.1).** Lands the
   "my plugin is too loud" class of finding. Directly supports Codex's
   three proof-of-concept walk-throughs. No new flags needed — fires
   on `nonlinearStages > 0`.

2. **[MEDIUM] Add `isClipper` + `hasLookahead` flags.** Both tighten
   existing rules. Small generator edit. Low risk.

3. **[MEDIUM] Roll Tier 1 to Lofi Loofy** (existing todo #11). Will
   likely surface capability-declaration misses that this doc has
   already predicted.

4. **[LOW, deferred] §1.2–§1.5 family-specific rules.** Build these
   only when the first plugin in that family ships. No point
   pre-building for empty families.

5. **[LOW, deferred] Remaining flags from §4.** Add each when its
   family's first plugin is being built.

---

## 6. Revision history

- **2026-04-20 v1.0** — First audit. Generator emits 24 rules; map
  implies 29. Five-rule gap; four are deferrable to first-plugin-in-family.
  One — loudness-comp — is a current-plugin blocker.
