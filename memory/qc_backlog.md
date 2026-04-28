
---

## 2026-04-28 PM — Per-op QC view doesn't surface `qc:ml` results — RETRACTION of earlier CREPE-park decision

**Original entry (retracted).** Earlier today I logged "CREPE parked pending ML runtime + pitchAccuracy harness" based on the per-op QC view showing "PASS — 0 of 0 tests passed." That entry was wrong on the facts.

**Reality (per `sandbox_ops_catalog.md` row #78 crepe).** CREPE has the most rigorous verification of any analysis op in the catalog:
- Real ORT-Web inference in browser worklet path (main-thread MLRuntime + MessagePort, onnxcrepe tiny.onnx 1.95 MB MIT)
- Real ORT-native inference in C++ path (`MLRuntimeNative` shim, `find_package(onnxruntime)`)
- `qc:ml` harness — **15/15 tolerance-based tests green**:
  - A4=440 Hz ±5¢, A5=880 ±5¢, C4=261.63 ±5¢
  - A3=220 Hz ±10¢, A2=110 Hz ±10¢ (banded by frequency to honor CREPE-tiny RPA ≈0.92)
  - Determinism ≤0.5¢, white-noise confidence < 0.5, silence finite
  - End-to-end worklet→runtime over 1s of 48kHz 440Hz = ±5¢

The verification IS there — it just lives in `npm run qc:ml`, not in the in-browser metric runner the per-op view consumes.

**Real backlog item (this).** Wire `qc:ml` results into `public/verification_ledger.json` so the per-op QC view shows them as a fourth panel (alongside identity / measurement-curve / behavioral). Same shape as how we surface gates W/C/S/T/P/B/L — add an **ML** lane for ops with `kind:'neural'`.

**Affected ops.** Only #78 crepe today; future neural ops (#119 hrtf, #120 rnnoise, future neural denoisers / source separators) will all benefit.

**Effort.** ~30-60 min: extend ledger generator to read `qc:ml` JSON output, add ML panel renderer to OpQcView.

**Decision (corrected).** CREPE signs off **green**. Final tally = 132 GOLD, no parks.

**Lesson.** Don't trust an "0 of 0" placeholder as a signal of "no verification" — check the actual catalog row + adjacent harnesses (`qc:ml`, `qc:all`) before parking an op. The DECLARED block in the per-op view should also surface the harness test count + tolerances when present, so this misread doesn't recur.

---

## 2026-04-28 — microDetune C++ codegen bug — **RESOLVED same day**

**Symptom (was).** Build failed with `error C2039: 'MicroDetuneOp_n_microdetune': is not a member of 'shags::ops'`.

**Root cause.** `op_microDetune.cpp.jinja` was authored using an old/non-canonical convention:
- `struct OpMicroDetune_{{ instance }}` instead of `class MicroDetuneOp_{{ node_id }}`
- No `namespace shags::ops { … }` wrapper
- Missing `setParam(const char* id, double v)` dispatch method
- Missing `explicit ClassName(double sampleRate)` constructor

**Fix.** Rewrote the template header + dispatch + constructor to match the canonical convention used by `op_curve.cpp.jinja` and every other op. One template-file edit; renderer logic was always correct.

**Verification.** Rebuild emits clean .vst3; parity test PASS bit-exact across impulse / pink_noise / sine_440. microDetune flipped 5/6 → 6/6 → gold-eligible.

**Lesson.** When adding a new op's C++ port file, copy the structure of an existing working op rather than authoring fresh — saves the canonical-convention drift this bug demonstrated.

---

## 2026-04-28 PM — Listen rig: CV-output display gap

**Symptom.** For `controlSignalOp: true` ops (meters, envelopes, gain-curves, LUFS family), the OUT level meter labels output as "peak X dB rms Y dB" — but the output IS the CV value, not audio levels. Stav noticed during loudness-batch sign-off.

**Two paths:**

1. **Quick relabel** — when `controlSignalOp === true`, swap "OUT peak X dB rms Y dB" → "CV value: X.X (units)". Map units from spec.declared (LUFS / dBTP / 0..1 width / dB envelope / etc).

2. **Proper CV scope** — rolling time-series plot of the last 1-2 s of CV output, like a logic-analyzer trace. Better for envelopes (`slew`, `envelope`, `peak`, `rms`) where the time-shape matters.

**Recommended:** ship (1) first — 5-min fix that makes the next bucket of envelope/dynamics ops actually intelligible. Plumb (2) in the same pass if cheap.

**Affected ops** (8 already at 6/6 awaiting + 7 envelope/dynamics coming): peak, rms, lufsIntegrator, loudnessGate, truePeak, lra, stereoWidth, kWeighting, plus the upcoming adsr / envelopeFollower / expander / gate / glide / sidechainHPF / transient batch.

---

## 2026-04-28 PM — Missing test category: meter compliance

**Symptom.** Loudness/metering ops (`peak`, `rms`, `lufsIntegrator`, `lra`, `truePeak`, `loudnessGate`, `kWeighting`, `stereoWidth`) have no math/curve test in the QC view — they show "PASS — 0 of 0 tests" (auto-PASS placeholder). Stav noticed for truePeak; same applies to all 8.

**Root cause.** The utility metric runner expects a closed-form `expectedFn(x, p)` that maps each input sample to an output sample. Meter ops don't fit:
- Stateful (peak-hold + release decay)
- Block-level (oversampling adds group delay)
- Statistical (meaningful tests are "feed -23 LUFS sine, expect -23 LUFS reading")

**Right architecture.** A new metric category — `meterCompliance` — that:
1. Drives standardized test signals from the EBU Tech 3341 V4 test battery (23 signals)
2. Renders through the op
3. Asserts steady-state meter reading is within tolerance of the standard's expected value

**Schema sketch:**
```js
{
  category: 'meterCompliance',
  defaultParams: { mode: 'momentary' },
  declared: {
    standard: 'EBU Tech 3341 V4',
    test_battery: [
      { signal: '0 dBFS 1 kHz sine, 1s', expected: { lufs: -3.01 }, tolerance: 0.1 },
      { signal: '-23 LUFS pink noise, 20s', expected: { lufs: -23.00 }, tolerance: 0.1 },
      // ... 21 more
    ],
  },
}
```

**Affected ops.** All 8 loudness/metering ops would gain real green-mark verification instead of auto-PASS placeholder.

**Effort estimate.** ~1-2 day session — write the test-battery generator + assertion runner, plus per-op signal selection. The 23 EBU test signals are public-domain.

**Priority.** ~~Medium~~ → **Low / parked** (downgraded 2026-04-28 PM). Confirmed with Stav: project doesn't ship public-facing meters or mastering tools, so external compliance claims aren't needed. Standards-citation + parity-skip + ear-test of CV-scope ballistics is sufficient verification for internal-plumbing meters that feed downstream limiters / auto-gain / dynamics. **Promote only if** the project pivots into a mastering / loudness-tool product (see recipe_expansion_strategy.md Path 2 — broadcast loudness processors).

---

## 2026-04-28 PM — Gate/expander missing transfer-curve charts

**Symptom.** `gate`, `expander`, and `transient` show "PASS — 0 of 0 tests passed" auto-PASS placeholder instead of a transfer-curve chart. Stav noticed when comparing to the proper magnitude-response plots on `sidechainHPF` after that op got recategorized to `filter`.

**Root cause.** Existing `gainCurve` metric runner is compressor-specific — drives a CV sweep that gets bigger, expects gain reduction (compressor curve). Gate/expander curves go the OPPOSITE direction (unity at high inputs, gain reduction at low inputs).

**Right architecture.**

Option A — generalize runner: extend `runGainCurveMetric` in `src/sandbox/behavioral/runBrowserMetric.js` to detect curve direction from `declared.kind: 'compressor' | 'expander' | 'gate'` and fit either way. ~30-min extension.

Option B — separate categories: `expanderCurve`, `gateCurve` runners with their own fit routines.

**Affected ops.** `gate`, `expander`, plus future ops that follow expander/gate gain-law (kepex, Drawmer DS-class units). `transient` doesn't fit either — needs a dedicated transient-shaper test (differential-envelope detection).

**Priority.** Low. Currently sign-off-blind on standards citation + listen rig (which works fine for engagement testing). Real curve plots would give visual proof but no new safety guarantee. Promote when next dynamics batch starts coming through, or when one of these ops gets a bug regression that the CV scope misses.

---

## 2026-04-28 PM — Listen rig: stateful-tail loop boundary cut

**Symptom.** Stateful audio ops (bbdDelay, plate reverb, schroederChain, fdnCore, spring, ER, SDN, pitchShift) get their decay tails cut at the listen-rig loop boundary. Stav noticed on bbdDelay.

**Root cause.** Listen rig renders a single 2-second offline buffer with op state = zero at sample 0, then loops that buffer for playback. At loop wrap, BOTH the audio source AND the op's internal state reset to zero, breaking the decay tail.

**In production.** Real plugin chains run the op continuously — state carries across audio buffers, decay tails are smooth. So the loop-cut artifact is rig-only.

**Fix paths:**

1. **Pre-warm state.** Render 1-2 seconds of "warm-up" audio before the captured 2-second loop. Discard the warm-up output but carry the state. ~10 lines of runWorkletBrowser.js.

2. **Render-then-decay-tail.** Render 2 seconds of audio + 1 extra second of silence at the end. The op's tail decays into the silent tail. Loop the FULL 3-second buffer. 10ms cosine fade still works at the wrap.

3. **Continuous worklet streaming.** Replace offline-render-then-loop with live-render via AudioWorkletNode. State naturally runs continuously. Bigger refactor.

**Recommended:** path 2 — simple, effective, no rig refactor.

**Priority.** Low. Doesn't block sign-offs (each affected op is signing off via standards + audible-engagement check). Polish for future ear-test pass when stateful tails matter.

---

## 2026-04-28 PM — Listen rig: missing live param tweaker

**Symptom.** Listen rig has no UI to tweak individual op params at playback time. To make ops with "off" defaults (panner pan=0, transient amount=0, shelf gainDb=0, microDetune cents=0, etc.) audible, we have to bake `listenParams` into the spec — a static override that's set once when the spec is authored.

**Limitations of the current approach:**
- One-size-fits-all per op — every user sees the same demo settings
- No way to A/B different param values during a single listen session
- Param-sweep ops (filter cutoff, comp threshold) would benefit from a slider UI

**Right architecture.** Add a per-op param-control row to OpListenPanel:
- Auto-populate from the op's `static params` declaration
- Render a slider per param with min/max derived from spec
- Slider position drives setParam() on the live worklet (re-render on change with debounce)
- Initial value = listenParams (if present) else defaultParams

**Effort.** ~30-60 min. Touches OpListenPanel.jsx + needs runWorkletBrowser to accept dynamic param updates between renders.

**Priority.** Medium. Would replace the listenParams-as-override pattern with a real interactive UI. Would also unlock proper ear-tests for filter cutoff sweeps, compressor threshold knee testing, etc. Promote when the next listen-heavy bucket comes through.
