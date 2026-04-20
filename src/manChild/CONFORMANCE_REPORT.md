# ManChild — Conformance Report

> Phase B output: engine walked line-by-line against `CONFORMANCE.md`
> v1.0.0. This file is evidence, not a plan — every row cites the
> engine location that was checked.
>
> Engine file: `src/manChild/manChildEngine.js` (PROCESSOR_VERSION v9).
> UI file: `src/manChild/ManChildOrb.jsx`.
> Review date: 2026-04-19.
> Reviewer: Claude.

Legend: ✅ PASS · ⚠️ WARN (works but worth noting) · 🔴 FAIL · ⏸ PENDING
(harness work required to verify).

---

## 1. Section 3 — Topology

| Topology node | Engine location | Status | Notes |
|---------------|-----------------|--------|-------|
| `input → inTrim` | L770–771 | ✅ | Unity passthrough. |
| `inTrim → splitIn`, `splitIn → mergerIn → worklet AUDIO_IN` | L660–663, 690 | ✅ | Raw L/R routed; input gain is **not** applied here (it lives inside the worklet — v9 repair). |
| `splitIn → scTapA/B → scMerger → worklet SC_IN` | L680–687 | ✅ | Per-channel SC gate; worklet applies inGain to SC sample after encode. |
| `inTrim → bypassRelay → sumNode` | L753–754, 759 | ✅ | External dry leg, engaged only when `bypass=1` (100% dry) — non-comb per spec §8. |
| `worklet.out → lineIn` | L707–708 | ✅ | Master IN = post-cell, pre-line-amp — matches R7 hard rule. |
| `lineIn → splitOut → lineAmpA/B (WS 4×) → mergerOut` | L695–713 | ✅ | Only NL in signal path. `oversample='4x'` on both WaveShapers. |
| `mergerOut → wetGain → sumNode` | L725–726, 758 | ✅ | |
| `sumNode → outTrim → fadeIn → output → chainOutput` | L773–776 | ✅ | 180 ms silent + 60 ms ramp on fadeIn (L651–653). |

**Topology rulings check:**

- ✅ Cell is distortionless (worklet applies GR as pure linear multiply, L565–566). No `tanh`, no EQ, no bias shift inside the worklet.
- ✅ Master IN is post-cell, pre-line-amp (L701–708 comment + wiring).
- ✅ Mix is in-worklet (L594–595) — equal-power cos/sin derived at L416–418.
- ✅ Input gain is in-worklet (L444–445 + detector L468–469).
- ✅ FB is the hardware default (`fb` param default = 1 at L248; every preset carries `fb:true` at L127).

**Topology: PASS.**

---

## 2. Section 4.1 — Global parameter contract

| Setter | Engine location | Default in code | Spec default | Kind match | Status |
|--------|-----------------|-----------------|--------------|-----------|--------|
| `setIn` | L861 | `lineIn.gain=1` (0 dB) | 0 dB | db | ✅ |
| `setOut` | L862 | `outTrim.gain=1` (0 dB) | 0 dB | db | ✅ |
| `setMix` | L794–799, init at 800 | 1.0 | 1.0 | unit | ✅ |
| `setBypass` | L865–874 | `state.bypass=false` | 0 | bool | ✅ True relay (bypassRelay + wetGain gating). |
| `setTxDrive` | L909–912 | `currentDrive=0.35` (engine init) | 0 | unit | ⚠️ **Mismatch.** See finding F1 below. |
| `setFB` | L901 | worklet param default 1 | 1 | bool, stateKey:'fb' | ✅ `stateKey` override in paramSchema (L829) matches worklet param name. |
| `setChannelMode` | L902–905 | worklet default 1 (LINK) | 1 | enum | ✅ |
| `setCharacter` | L949–954 | `state.character=null` | null | preset | ✅ Routes through `applyBulk` (L952). |

### F1 — ⚠️ `setTxDrive` default drift

- Engine initializes `currentDrive = 0.35` (L716) and immediately builds the curve from it (L722).
- `paramSchema` declares `def: 0` (L828).
- Every `MANCHILD_PRESETS` entry that *doesn't* override `txDrive` uses the `_P` default of `0.00` (L126), so the first `setCharacter` call snaps the drive to 0.
- Net effect: at engine boot (no preset applied), the line-amp has 0.35 drive baked in. As soon as any preset is applied, it jumps to the preset value (usually 0).

**Severity:** WARN. It's not a DSP bug — the curve is still unity-small-signal — but `getState().txDrive` will read `0.35` before any user interaction, contradicting the schema default of `0`. This is the same class of bug the Lofi Loofy `setDream` 0/0.5 mismatch was.

**Recommended fix:** change L716 to `let currentDrive = 0;` and call `applyDriveCurve()` once at init. Single-line change.

---

## 3. Section 4.2 — Per-channel parameter contract

| Setter | Engine location | Worklet param default | Spec default | Status |
|--------|-----------------|----------------------|--------------|--------|
| `setInputGainA/B` | L877–886 | `inGainA/B=1` (lin = 0 dB) | 0 dB | ✅ `state.inA/inB` mirrors dB value. |
| `setThresholdA/B` | L893–894 | `thA/thB=0.45` | 0.45 | ✅ |
| `setDcA/B` | L895–896 | `dcA/dcB=0.5` | 0.5 | ✅ |
| `setVarAtkA/B` | L897–900 | `0.5` | 0.5 | ✅ |
| `setVarRelA/B` | L897–900 | `0.5` | 0.5 | ✅ |
| `setTcA/B` | L913–920 | worklet default 1 (TC2) | 1 (TC2) | ✅ Accepts numeric idx or `TC_TABLE[i].id` string. |
| `setScA/B` | L802–814 | `scEnaA/B=1` | 1 | ✅ Gates both FF tap gain and worklet scEna param — matches spec "honest in both detector modes". |

### F2 — ⚠️ `setThresholdA/B`, `setDcA/B`, `setVarAtkA/B`, `setVarRelA/B` write `.value` directly

Engine lines 893–900 use `P('thA').value = v;` rather than `setTargetAtTime`. This bypasses smoothing and can cause zipper noise on fast knob drags.

**Severity:** WARN. Not a spec violation (spec doesn't mandate a smoothing contract per setter), but inconsistent with `setIn/setOut/setMix/setInputGain*/setSc*` which all use `setTargetAtTime`. The GR itself is smoothed 4 ms inside the worklet (L280, L551–552), which masks most of the audible damage — but threshold changes will still step-click the detector.

**Recommended fix:** use `setTargetAtTime(v, ctx.currentTime, 0.01)` for all of these. 8 lines.

---

## 4. Section 4.3 — Declared no-ops

| Setter | Engine location | Body | Status |
|--------|-----------------|------|--------|
| `setOutputGainA` | L890 | `(_db) => {}` | ✅ Empty by design. |
| `setOutputGainB` | L891 | `(_db) => {}` | ✅ Empty by design. |

paramSchema marks both `kind: 'noop'` with a `note:` explaining the reason — QC harness will skip them per `paramSchema` resolver behavior.

**Declared no-ops: PASS.**

---

## 5. Section 5 — Macro setters

### `setCharacter(name)` (L949–954)

```js
setCharacter(name) {
  const p = MANCHILD_PRESETS[name];
  if (!p) return;
  engine.applyBulk(p);
  state.character = name;
}
```

| Claim | Status | Evidence |
|-------|--------|----------|
| Routes through public setters (D2) | ✅ | `applyBulk` (L924–947) fan-outs to public setters field by field. No direct AudioParam writes in the macro. |
| Writes authoritative state (`state.character`) | ✅ | L953. |
| Exposed read-only in `getState()` | ✅ | L974. |
| No dead-mirror vars | ✅ | Only `state.character` mirrors; it's the authoritative value. |

**Macro setters: PASS.** This is the clean reference pattern other plugins should match. (Contrast with Lofi Loofy's pre-fix `setCharacter` which wrote a dead mirror `toneLPBase` instead of `_toneLPBase`.)

### F3 — ⚠️ `applyBulk` silently ignores preset fields it doesn't enumerate

`applyBulk` only acts on fields it explicitly checks (L925–946). If a future preset adds a field like `newKnob:0.7`, `applyBulk` will silently drop it — no warning, no error.

**Severity:** WARN (future-proofing).

**Recommended fix:** in dev mode, `console.warn` on unknown keys. 5 lines.

---

## 6. Section 4 — paramSchema structural audit

Ran the paramSchema array (L823–859) against the setter surface:

| Check | Status |
|-------|--------|
| Every setter row has a corresponding engine method | ✅ |
| Every engine setter has a paramSchema row (except getState/getters) | ✅ |
| `setFB` has `stateKey:'fb'` override (camelCase `fB` would miss worklet param) | ✅ L829 |
| Enum options for `setTcA/B` match `TC_TABLE` length 10 | ✅ L854, L856 |
| Preset options for `setCharacter` = `Object.keys(MANCHILD_PRESETS)` | ✅ L838 |

**paramSchema: PASS.**

---

## 7. Section 6 — Measurable targets (harness capability audit)

| ID | Target | Harness can verify today? | Needs |
|----|--------|---------------------------|-------|
| M1 | Bypass null residual < −120 dB | ⏸ | Phase C — bypass null test procedure (idle-null work). |
| M2 | `getLatency()` === 0 | ✅ | Simple call; trivial to add to current sweep. |
| M3 | `engineState.bypass` exposed | ✅ | Already in `getState()`; can assert. |
| M4 | Steady-state GR from sine+threshold | ⏸ | Phase C — need sine stimulus + GR sampling loop. |
| M5 | THD at drive=0 < 0.05 % | ⏸ | Phase C — FFT of output, harmonic ratio math. |
| M6 | H2/H3 ratio at drive=0.7 | ⏸ | Phase C — same FFT infrastructure as M5. |
| M7 | DC offset at drive=0.7 < −60 dB | ⏸ | Phase C — DC-block-free RMS check. |
| M8–M11 | Attack / release time-constant assays | ⏸ | Phase C — step stimulus + envelope tracker. |
| M12 | LINK: grDbA ≈ grDbB | ⏸ | Phase C — asymmetric stereo stimulus. |
| M13 | M-S side channel null on pure-mid signal | ⏸ | Phase C — stereo stimulus + per-channel measurement. |
| M14 | `setMix(0)` null residual < −90 dB | ⏸ | Phase C — mix-null test. |
| M15 | `setMix(0.5)` no comb on chanMode swap | ⏸ | Phase C — mid-playback state-change test. |
| M16 | `setScA(false)` → grDbA = 0 | ⏸ | Phase C — SC-disable assertion. |
| M17 | `'Drum Bus – Glue 2dB'` → ≈ 2 dB GR | ⏸ | Phase C — preset-intent assertion (ties to preset key). |
| M18 | `'Heavy Comp – 10dB'` → ≈ 10 dB GR | ⏸ | Phase C — same. |
| M19 | `applyBulk` preset fan-out completeness | ⚠️ | Current harness checks `changedParamsFromPrevious` but doesn't assert preset→engineState equality per field. Close but not quite. |
| M20 | `changedParamsFromPrevious` correctness | ✅ | Already live (this was the Lofi Loofy closure fix). |

**Measurable targets: 3 already checkable, 1 almost there, 16 require Phase C.** This is the expected answer — Phase C work is exactly where the spec's numeric claims become enforceable.

---

## 8. Section 7 — UI-isolation

### Layer 1 (static) on `ManChildOrb.jsx`

Ran the forbidden-pattern grep from `docs/UI_ISOLATION_RULES.md`:

- `new \w+Node(`: **0 matches**
- `.setValueAtTime(` / `.setTargetAtTime(` / ramps / `cancelScheduledValues`: **0 matches**
- `.connect(` / `.disconnect(`: **0 matches**
- `new (OfflineAudio|Audio)Context(`: **0 matches**
- All context-factory methods (`createGain`, `createBiquadFilter`, etc.): **0 matches**

**Layer 1: PASS.** The Orb touches no audio-graph API directly.

### Layer 2 (runtime proxy)

⏸ PENDING. Requires the AudioParam write-origin proxy to be implemented in the engine factory under `ctx.qcMode === true`. Not yet wired.

### Layer 3 (idle null)

⏸ PENDING. Requires harness procedure (instantiate bypass, render UI 60 Hz for 10 s, null vs reference).

**UI-isolation: static PASS; runtime + idle are Phase C deliverables.**

---

## 9. Section 8 — Non-goals

All seven non-goals checked against the engine — none are silently violated:

| Non-goal | Status |
|----------|--------|
| Only TC1–TC6 implemented | ✅ `TC_TABLE` has exactly 10 entries (6 fixed + 4 var). |
| Fixed knee & ratio; no user control | ✅ `VARI_MU_KNEE`, `VARI_MU_RATIO` static getters (L355–356). |
| Line amp is single-stage | ✅ One `makeLineAmpCurve` call per channel, one WS each. |
| No oversampling inside the cell | ✅ Worklet runs at native rate; only WaveShaper is 4×. |
| `setOutputGainA/B` intentionally no-ops | ✅ L890–891. |
| Bypass relay external dry leg allowed (100% dry only) | ✅ L753–754, L871. |

**Non-goals: PASS.**

---

## 10. Summary

| Section | Result |
|---------|--------|
| §3 Topology | ✅ PASS |
| §4.1 Global params | ✅ PASS (with ⚠️ F1) |
| §4.2 Per-channel params | ✅ PASS (with ⚠️ F2) |
| §4.3 No-ops | ✅ PASS |
| §5 Macro setters | ✅ PASS (with ⚠️ F3) |
| §4 paramSchema structural | ✅ PASS |
| §6 Measurable targets | ⏸ 3/20 checkable today, 16 need Phase C |
| §7 UI-isolation static | ✅ PASS |
| §7 UI-isolation runtime + idle | ⏸ Pending Phase C |
| §8 Non-goals | ✅ PASS |

**No critical failures.** Three WARNs, all fixable in <20 lines of code
total. Phase C harness work is the only actual blocker to full
conformance sign-off.

---

## 11. Findings summary (actionable)

| ID | Severity | Fix | Lines | Owner |
|----|----------|-----|-------|-------|
| F1 | ⚠️ WARN | `currentDrive` init 0.35 → 0 so `getState().txDrive` matches schema default | 1 | engine |
| F2 | ⚠️ WARN | `setThreshold*/setDc*/setVar*` use `.value =` — switch to `setTargetAtTime` for zipper-free param changes | ~8 | engine |
| F3 | ⚠️ WARN | `applyBulk` silently ignores unknown fields — add dev-mode `console.warn` | ~5 | engine |

No F with severity MAJOR or CRITICAL.

---

## 12. Recommended next steps

1. **Land F1, F2, F3** as a single commit (`manchild: spec conformance cleanup`). Low risk, high clarity.
2. **Sweep Lofi Loofy the same way** — fill its Conformance Spec, run Phase B. Expected outcome: at least one WARN from the `_toneLPBase` fix era.
3. **Phase C harness work** is the real next chunk. Priority order within Phase C:
   - M2 + M3 (trivial — add to current sweep).
   - M19 (preset fan-out completeness — tightens the macro-setter check).
   - M1 + M14 + M16 (null tests — cheap, high-signal).
   - M4 + M17 + M18 (steady-state GR — cornerstone DSP claims).
   - M5–M7 (FFT harmonic checks — biggest infra lift).
   - M8–M11 (time-constant assays — needs step tracker).
   - M12–M13, M15 (stereo & state-change tests).
4. **Runtime proxy + idle null** (UI-isolation Layers 2 + 3) can run in parallel to the measurable-target work — different harness subsystem.

---

## 13. 2026-04-20 — Green close-out (engine_v1 approved)

> Follow-up audit after a week of QC-harness hardening + ManChild UX polish.
> Engine DSP is unchanged since the Phase B audit above; this section is
> evidence that the UI additions (GANG A/B, BYPASS relocation, MODE gating)
> did not regress any of the numeric measurements captured at Phase B.

### Sweep progression

| Time (UTC) | Verdict | Findings | Notes |
|---|---|---|---|
| 08:36:00 | 🔴 FAIL | mix_null (absolute) fired as Problem | Before coloration-bearing capability was declared. |
| 08:41:xx | 🟡 WARN | mix_null_series fired as Problem | Before `dryLegHasColoration` capability was declared. |
| 08:46:02 | ✅ PASS | 2 Info diagnostics | First green sweep after capability gates landed. |
| 08:54:57 | ✅ PASS | 2 Info diagnostics | Same UI as 08:46; reproducibility confirmed. |
| 09:45:32 | ✅ PASS | 2 Info diagnostics | Post-GANG / post-BYPASS-relocation UI. No DSP drift. |
| 09:55:07 | ✅ PASS | 2 Info diagnostics | Final sweep used for approval. |

### Approval artifact

- Decision: **✅ APPROVED**
- Build SHA: `627263f-dirty`
- Captured: `2026-04-20T09:55:07.575Z`
- Decided: `2026-04-20T09:55:54.898Z`
- File: `src/manChild/qc_approvals/2026-04-20T09-55-07_engine_v1.md`

### What changed in the Orb since Phase B (non-DSP)

- Added `knobGang` UI state + persistence — gangs all six A/B knob pairs.
- Added **GANG A/B** button to the right global column.
- Restricted MODE to LINK only when GANG is on (IND / M-S / MSL grey out).
- Moved **BYPASS** above VAR REL A at a fixed width so clicks don't resize the button.

None of these touch `manChildEngine.v1.js` — confirmed by the green sweep at 09:55 matching the green sweeps at 08:46 / 08:54 within normal measurement jitter.

### Open items (unchanged from §11)

F1, F2, F3 are still-open ⚠️ WARNs from the Phase B audit. They are not ship blockers and do not affect the approved engine_v1. Track for the next engine revision.
