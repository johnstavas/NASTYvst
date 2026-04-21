# Lofi Loofy — Conformance Report

> Phase B output: engine walked against `CONFORMANCE.md` v1.0.0.
> Engine file: `src/lofiLoofy/lofiLoofyEngine.js`.
> UI file: `src/lofiLoofy/LofiLoofyOrb.jsx`.
> Review date: 2026-04-19. Reviewer: Claude.

Legend: ✅ PASS · ⚠️ WARN · 🔴 FAIL · ⏸ PENDING (Phase C work).

---

## 1. §3 Topology

| Claim | Status | Evidence |
|-------|--------|----------|
| `dryCompensate(36 ms)` exists and feeds dry leg | ✅ | Engine block comment L97–100; `getLatency() === 0.036` L1374. |
| `satShape` + `crushShape` are the only NL in main path (plus bits/rate/age) | ✅ | No other WaveShapers in the main topology. |
| Dust bus is additive, not modulating | ✅ | `noiseGain` + `crackleGain` sum into `wetGain`; no feedback into main. |
| Width=0 produces exact mono | ⚠️ | Self-flagged at L1141–1145 as known-soft; catalogued in §8.1. |
| Dream `mix` target does not dual-write user's Mix | ✅ | **Fixed 2026-04-21.** Dream `mix` now writes dedicated series `dryMixMod` / `wetMixMod` gain nodes (unity at rest, equal-power swing); user's `dryGain` / `wetGain` have a single writer (setMix). See F1 in §7 and engine L85–90 / L795–812. |

**Topology: PASS with 1 catalogued deviation (in §8.1).**

---

## 2. §4 Parameter Contract

paramSchema L985–1024 structurally audited against setter surface.

| Check | Status |
|-------|--------|
| All 28 schema rows have a corresponding engine setter | ✅ |
| All engine setters (non-getter) have a schema row | ✅ (including `setCompOff` with `stateKey: 'compOff'`, `setCompVibe` with `stateKey: 'compVibe'`) |
| Schema defaults match engine init | ✅ `setDream` def=0.5 matches `dreamAmount = 0.5` init (post-fix; this is the one that was wrong pre-harness). |
| Enum values for `setDreamTarget` sourced from `DREAM_TARGETS` | ✅ L1020 |
| Preset values for `setCharacter` sourced from `LOFI_CHARACTERS` keys | ✅ L1023 |

### 2.1 Smoothing consistency

All user-facing setters except the trivial JS-var Dream details
(`setDreamRate`, `setDreamDepth`, `setDreamDrift`, `setDreamTarget`)
use `setTargetAtTime`. No ManChild-style F2 finding here.

### 2.2 `setCompOff` restore path

L1221–1253: on `setCompOff(false)`, restores via `this.setGlue(_glueAmt)`
/ `setCrush(_crushAmt)` / `setPump(_pumpAmt)` / `setCompBlend(_compBlendAmt)`.
Public-setter routing ✅. Stored values verified to match `_glueAmt`,
`_crushAmt`, `_pumpAmt`, `_compBlendAmt` which are authoritatively
written in each corresponding setter.

**Parameter contract: PASS.**

---

## 3. §5 Macro Setters

### 3.1 `setCharacter` (L951–978)

| Claim | Status | Evidence |
|-------|--------|----------|
| Writes authoritative `_toneLPBase` + calls `recomputeToneLP` | ✅ | L961–963 |
| Legacy mirror `toneLPBase` kept in sync (for Dream tone-target) | ✅ | L962 |
| Character DSP vars cached (`charTilt`…`charFlutterRate`, `satBase`) and exposed in `getState` | ✅ | L971–977, L1060–1065 |
| Does NOT bypass public setters for user-controlled knobs | ✅ | `setCharacter` only writes character-owned DSP; it does not write `_drift_depth_knob`, `_flutter_depth_knob`, `_glueAmt`, `_crushAmt`, etc. |
| `currentCharacter` exposed in `getState()` | ✅ | L1057 |

**This is the reference pattern for "macro that writes authoritative
DSP + recomputer" (DEV_RULES D2 route B).**

### 3.2 `applyBulk` (L1333–1353)

| Claim | Status | Evidence |
|-------|--------|----------|
| Map-driven fan-out to public setters only | ✅ | `map` table at L1336 contains only engine-method references. |
| Unknown keys silently ignored (intentional per §8.5) | ✅ | `if (typeof fn === 'function') fn(obj[k])` at L1350–1351. |
| Covers all 24 bulk-recallable fields | ✅ | Verified against §4 contract minus character-owned + rack-globals (`in`/`out`). |

**Macro setters: PASS.**

---

## 4. §6 Measurable Targets (harness-capability audit)

| ID | Target | Can harness verify today? | Notes |
|----|--------|---------------------------|-------|
| M1 | Bypass null < −90 dB (36 ms aligned) | ⏸ | Phase C — null test needs latency-aware alignment (ManChild was 0 ms; Lofi is 36 ms). |
| M2 | `getLatency() === 0.036` | ✅ | Trivial call; add to sweep. |
| M3 | `engineState.bypass === 1` when bypassed | ✅ | Already in `getState()`. |
| M4 | Mix=0 null < −80 dB | ⏸ | Phase C — same alignment requirement. |
| M5 | Width=0 exact mono | ⏸ | Phase C — known-soft per §8.1; check will likely WARN not FAIL at v1.0.0. |
| M6 | Width=1 passthrough < −90 dB | ⏸ | Phase C. |
| M7 | All macros zero → neutral wet chain | ⏸ | Phase C — composer test. |
| M8 | Drift pitch deviation at full | ⏸ | Phase C — pitch-tracker infrastructure. |
| M9 | Flutter pitch deviation at full | ⏸ | Phase C — same. |
| M10 | `setBits(8)` quant noise ~ −48 dB | ⏸ | Phase C — FFT noise-floor measurement. |
| M11 | `setRate(8000)` LP at 4 kHz | ⏸ | Phase C — sweep response. |
| M12 | `setBoom(1)` shelf +8 dB at 120 Hz | ⏸ | Phase C — EQ response. |
| M13 | Glue=1, pink −10 dBFS, GR 4–8 dB | ⏸ | Phase C — comp measurement. |
| M14 | `setCompOff(true)` neutralizes comp stage | ⏸ | Phase C — null test. |
| M15 | `setCompOff` round-trip restores values | ✅ | Checkable now — pre/post `engineState` comparison. |
| M16 | Character DSP vars match `LOFI_CHARACTERS` def | ✅ | Checkable now — `engineState` inspection across sweep. (Already de facto green in the 2026-04-19T19-37-31 audit JSON.) |
| M17 | `setCharacter` preserves main knob values | ✅ | Checkable now — diff main knobs across character changes. |
| M18 | `setDream(0)` → reverbSend.gain === 0 | ⚠️ | Partly checkable — `reverbSend` is not in `getState()`. Would need to expose or measure indirectly. See F4 below. |
| M19 | Dream `mix` target does NOT mutate `mixVal` | ⏸ | Expected to FAIL at v1.0.0 — this is the catalogued §8.2 violation. |
| M20 | `setDust(0)` → noiseGain/crackleGain === 0 | ⚠️ | Not in `getState()`. See F4. |

**Summary:** 5 targets checkable today (M2, M3, M15, M16, M17); 2
indirect/partial (M18, M20); 13 Phase C.

---

## 5. §7 UI-Isolation

### Layer 1 (static) on `LofiLoofyOrb.jsx`

Forbidden-pattern grep: **0 matches.** No `new *Node(`, no AudioParam
schedulers, no `.connect(` / `.disconnect(`, no context-factory calls.

**Layer 1: PASS.**

### Layer 2 (runtime proxy) & Layer 3 (idle null)

⏸ PENDING — Phase C deliverables. Same status as ManChild.

---

## 6. §8 Non-Goals — cross-check

| Non-goal | Engine evidence | Status |
|----------|-----------------|--------|
| §8.1 Width=0 soft-mono | Self-flagged comment L1141–1145 present | ✅ Documented |
| §8.2 Dream `mix` target dual-write | **Fixed 2026-04-21** — now writes `dryMixMod`/`wetMixMod` series nodes (L85–90, L795–812); `dryGain`/`wetGain` single-writer restored | ✅ Fixed |
| §8.3 Character doesn't touch comp/crush/etc. | Verified by reading setCharacter L951–978 | ✅ |
| §8.4 No BBD model | `tapeDelay` uses native `DelayNode` (L22, L24 in topology comment) | ✅ |
| §8.5 applyBulk silent on unknown keys | L1349–1351 | ✅ |

**Non-goals: PASS (all honestly documented in-code and in spec).**

---

## 7. Findings

### F1 — ✅ FIXED (2026-04-21) · `setDreamTarget('mix')` now honors B4

- **Was:** Dream modulator wrote `dryGain` / `wetGain` directly (the
  same gain nodes owned by the user's Mix setter) — DEV_RULES B4
  violation, spec §8.2.
- **Fix shipped:** added dedicated series `dryMixMod` / `wetMixMod`
  gain nodes (unity at rest) between the user gains and `preOut`.
  Topology now:
  - `dryCompensate → dryGain → dryMixMod → preOut` (L116–117)
  - `wetGain → wetMixMod → preOut`                 (L686–687)
  Dream's `case 'mix'` writes only `dryMixMod` / `wetMixMod` using an
  equal-power swing around unity (±0.45 bias, `cos/sin(bias·π/2)`
  normalized by √2/2 at centre) so perceived loudness is stable across
  the breath and swing=0 ⇒ both nodes = 1.0 exactly. L795–812.
- **Single-writer audit:** `grep` confirms `dryGain.gain` / `wetGain.gain`
  are only written in `setMix` (L867–875) and init (L77, L104); Dream
  no longer touches them.
- **R10 B4:** compliant. §8.2 deviation closed.

### F2 — ⚠️ `setWidth(0)` is not exact `(L+R)/2` mono

- **Where:** L1141–1145 (self-flagged).
- **Severity:** WARN against R10 C5. Spec §8.1.
- **Recommended fix:** replace cross-swap with an explicit matrix mix:
  out L = out R = `0.5·(inL + inR)` at width=0, interpolated against
  the current Haas/direct mix as width moves 0 → 1. ~12 lines.

### F3 — ⚠️ `reverbSend` / `noiseGain` / `crackleGain` not in `getState()`

- **Where:** `getState()` at L1029–1067 exposes knob mirrors and
  character vars but not these wet-chain gains.
- **Severity:** WARN — blocks clean M18 and M20 auto-checks. Indirect
  measurement via audio output still works but is more fragile than a
  state inspection.
- **Recommended fix:** add `reverbSendLevel: reverbSend.gain.value`,
  `dustHiss: noiseGain.gain.value`, `dustGrit: crackleGain.gain.value`
  to `getState()`. ~3 lines.

### F4 — ℹ️ `applyBulk` silent-ignore is intentional but audit-friendly logging would help

- **Where:** L1349–1351.
- **Severity:** INFO (not WARN). §8.5 specifies this stance.
- **Recommended fix:** optional dev-mode `console.info` (not warn) on
  unknown keys, gated by `process.env.NODE_ENV !== 'production'`, so
  developers can spot drift without the error noise.

---

## 8. Summary

| Section | Result |
|---------|--------|
| §3 Topology | ✅ PASS (2 deviations catalogued in §8) |
| §4 Parameter contract | ✅ PASS |
| §5 Macro setters | ✅ PASS (reference pattern for D2 route B) |
| §6 Measurable targets | 5 checkable today, 2 indirect, 13 Phase C |
| §7 UI-isolation static | ✅ PASS |
| §7 UI-isolation runtime + idle | ⏸ Phase C |
| §8 Non-goals cross-check | ✅ all documented |

**0 FAIL** (F1 fixed 2026-04-21; §8.2 deviation closed).
**2 WARN** (F2, F3 — both self-flagged, tracked for spec v1.1.0).
**1 INFO** (F4).

No surprise regressions. F1 now compliant with R10 B4. Remaining open
items (F2, F3) are pre-existing self-flagged deviations.

---

## 9. Recommended next steps

1. ~~**F1** Dream `mix` target fix.~~ **Landed 2026-04-21** —
   series `dryMixMod`/`wetMixMod` nodes, equal-power swing, B4 compliant.
2. **Land F3** (3-line `getState` extension). Zero-risk; unlocks
   M18 and M20 clean auto-checks.
3. **Schedule F2** (Width=0 mono) for spec v1.1.0. Medium-risk, ~12
   lines, needs a null-test proof-of-fix.
4. **F4 is optional** — land it if/when dev-mode logging lands
   elsewhere.
5. **Phase C harness work** is the real next chunk. Priority order:
   - M2, M3, M15, M16, M17 (already checkable — wire them into the
     sweep now).
   - M1, M4 (bypass null + mix null with 36 ms alignment — shared
     infra with ManChild M1/M14).
   - M10, M11, M12 (spectrum-based — bits noise floor, rate LP,
     boom shelf — shared FFT infra with ManChild M5/M6).
   - M13 (Glue GR — shared with ManChild M17/M18).
   - M14 (CompOff null — write once, reuse for future bypass-style
     toggles).
   - M8, M9 (pitch-tracker — most expensive infra; pairs with any
     future delay-based plugin).
   - M7 (all-macros-zero composer test).
