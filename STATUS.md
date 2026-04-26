# gainCOMPUTER — Live Project Status

**Updated:** 2026-04-26 (xformerSat + corpus-sweep extension + srcResampler shipped)
**North star:** Portable artist chain — one app, total-state presets, same sound across every DAW/OS/room. (`portable_chain_platform.md`)

> Open this file first. It's the single dashboard for "what's going on, what's locked, what's next."
> Updated at the end of every session and after every op ship — see [Update protocol](#update-protocol).
> One screen per section. Detail lives in linked files; this stays scannable.

---

## 🎯 Where we are right now

| Layer | Phase / state |
|---|---|
| **Codegen pipeline** | **Phase 4 closed ✅ (2026-04-25)** — native parity is now a hard ship gate. Op-line **UNPAUSED**. |
| **Sandbox ops catalog** | **127/183 shipped (~69%); 41 parity-verified.** 2026-04-26 corpus-sweep added 43 new ⬜ slots (#141–#183) — 8 Tier-S + 22 Tier-A + 13 Tier-B from 86-entry named-gear corpus. **#166 srcResampler shipped ✅+P 2026-04-26** as first cadence-proof ship after primary-source triangulation. |
| **Plugin onboarding (Stage 0.5 dogfood)** | 1 of 4 done — ManChild green. Lofi Loofy partial. FJM, Panther Buss pending. |
| **AI agent layer** | NOT READY (~25–30%). 8/8 gates mapped to workbench stages, none all-green yet. Plausibly unlocked end of Stage 3. |
| **Runtime targets** | Provisional v1: JUCE-VST3+AU (DAW), iPlug2-WAM (in-app). Locked 2026-04-22. |

---

## ✅ Just landed (this session, 2026-04-26)

- **#166 srcResampler shipped ✅+P** — Foundation/utility op. Polyphase Kaiser-windowed-sinc varispeed reader per JOS *Resample/Implementation* page (verbatim two-wing formula; L=32 phases, NZ=8 zero-crossings, β=7 Kaiser → ~70 dB stopband, KBUF=4096 ring). Same N inputs / N outputs per call; `speed` ∈ [0.25, 4.0] controls fractional read advance. v1 honest scope: clean varispeed at speed≤1 (~85 ms drift budget at 48 kHz before phase ceiling clamps), causality clamp at speed>1 (no lookahead). 14-test math suite PASS, golden `905784…`, native parity bit-identical at speed=1. Off-by-one bug caught + fixed during ship: JOS's `P` is fractional past `floor(read_pos)`; with phase = read-lag, `P = ceil(phase) - phase`, NOT `phase - floor(phase)`. Three deferred upgrade paths logged in research-debt: P1 cutoff scaling for downsample anti-alias, P2 elastic buffering for sustained speed>1, P2 multichannel. Cadence-proof first ship after the corpus-sweep primary-source triangulation.
- **Corpus-sweep extension landed.** 86-entry named-gear corpus (15 domains: compressors, console, delay, EQ, filters, gates, guitar/bass amps, mastering, modulation, multi-FX, preamps, reverb, saturation, specialty, synths) swept → 43 new ⬜ catalog slots written (#141–#183): 8 Tier-S (five gain-reduction elements + tube atoms set + inductorEQ), 22 Tier-A (otaLadder, granularPitchShifter, vactrolLPG, dopplerRotor, ringMod, hardSync, hilbert, voiceCoilCompression, srcResampler, linearPhaseEQ, gainRangingADC, tapeBias, etc.), 13 Tier-B (presenceShelf, headBumpEQ, oilCanDelay, complexOsc, phaseDistortion, wowFlutter, varistorVibrato, dispersiveAllpass, blesserReverbCore, fmOperator, schmittTriggerOsc, differentialEnvelope, diodeBridgeGR, sixOpFmAlgorithmRouter). 6 merges (alnicoSag→voiceCoilCompression flag, optoT4/bulbOpto/etc.→optoCell, vcaFader→blackmerVCA, ldrPhaserStage→vactrolLPG, tubeSim→triodeStage). 7 param-flags on existing ops. Cross-cutting: **five gain-reduction elements gap closed** (opto/varMu/FET-VVR/blackmer/diode-bridge all slotted). Catalog title 1–140 → **1–183**. 52-op research prompt drafted for primary-source recovery.
- **#139 xformerSat shipped ✅+P** — De Paiva 2011 WDF transformer (volt-second LF saturation + Rc hysteresis + HF leakage). Through-path topology: flux-tracker drives Eq 34 NL-cap modulating HP corner; Rc hysteresis branch (Eq 17, m=3, §3.3 unit-delay); HF leakage 1-pole LP. Branchless n=3 power. 18-test math suite, golden, registry, native parity all green; worst-case parity −138 dB on dc_step (tol −90). qc:all 11 gates green, 1775 math checks. Topology bug from Stage 1 caught and corrected (was tapping cap voltage → LF expansion; fix routes through HP load branch matching Whitlock §5).
- **(prior session, 2026-04-25)** Phase 3 verified + Phase 4 closed; `qc:parity` wired into `qc:all`.
- 3 Tier-S primaries logged with PDFs filed: Whitlock (Ballou ch.), De Paiva 2011 DAFx, Pultec EQP-1A manual.
- All 8 outstanding `qc:math` failures resolved — every one a stale-test issue (Layer-1→Layer-2 contract drift on diodeLadder, Stinchcombe DC-gain on korg35, small-signal regime on ladder), no op bugs.
- `npm run qc:all` end-to-end **GREEN** (1757 math · 250 goldens · 39 parity ops · all stereo · master · emit · ml · pcof · t6 · graphs · schema).
- `STATUS.md` (this file) created and wired into ship-protocol Step 7.
- **STATUS.md ledger pass on first use:** caught three stale entries — `op_envelope` (Bram detector ✅ Canon:dynamics §1) and `op_lfo` (coupled sin/cos ✅ Canon:synth §6) were listed as next-ups despite being shipped; `op_lra` (Tech 3342 V4 §3.2) was listed ⬜ in catalog despite being fully shipped (worklet+cpp+test+golden, 12/12 PASS, registry-resident). Catalog row #55 corrected; ghost ⬜ row deleted; primary citation fixed (§3.2 not §4).
- **De Paiva memo drift resolved against PDF:** memory file claimed two-form arctan nonlinearity (NL-1/NL-2). Paper actually uses **one** power-law form `a·\|v\|^n·sign(v)` (Eq 15) applied to **two** elements: nonlinear capacitor (saturation, Eq 16) and nonlinear resistor (hysteresis loss, Eq 17). Real-time form is Eq 34's variable-turns nonlinear transformer, not Newton iteration. Paper validates **two** OTs (Fender NSC041318, Hammond T1750V), not three. Fixed `depaiva_transformer_emulation.md` §1/§2/§3/§4/§6, MEMORY.md summary line, and catalog row #139. **#139 xformerSat now genuinely buildable** — promoted to top of Next ops.

## 🚦 QC gate state

| Gate | Status | Notes |
|---|---|---|
| `qc:schema` | ✅ | IR v1.0 conformance |
| `qc:t6` | ✅ | 10 rule checks |
| `qc:graphs` | ✅ | 8 graphs deep-validated |
| `qc:pcof` | ✅ | 8 graphs build PCOF |
| `qc:goldens` | ✅ | 250 op-hash checks |
| `qc:math` | ✅ | **1775 checks** |
| `qc:master` | ✅ | TOY_COMP factory pinned |
| `qc:emit` | ✅ | factory ≡ emitted ≡ golden |
| `qc:ml` | ✅ | 15 checks (skips count as pass; `--strict` opt-in) |
| `qc:stereo` | ✅ | per-channel isolation |
| `qc:parity` | ✅ | **40 ops** native-verified |

---

## 🧱 Catalog scoreboard

| Status | Count | Meaning |
|---|---|---|
| ✅+P | 41 | Shipped + parity-verified post-Phase-4 |
| ✅ (legacy) | 86 | Shipped pre-Phase-4 (rebadge to ✅+P as touched) |
| 🚧 | ~5 | Registry-only (no sidecar yet) |
| ⬜ | ~49 | Not started — pre-sweep: #119 hrtf · #120/121/122 ML · #140 pultecEQ · reserved slots (~6). +43 from 2026-04-26 corpus-sweep extension (#141–#183), minus #166 srcResampler shipped. |

**Per-system coverage (from `audio_engineer_mental_model.md` six-systems):**

| System | Coverage | Gaps |
|---|---|---|
| **Tone** (filters/EQ) | 🟢 Dense | LR/Butter, formant — minor |
| **Character** (drive/sat/clip) | 🟢 Dense | xformer/Pultec analog character pending |
| **Time** (delay/AP/comb) | 🟢 Solid | BBD-family pending |
| **Dynamics** (det/comp/exp) | 🟡 Thin → 🟢 once GR-elements ship | Bram detector ✅; **five GR-element atoms now slotted as ⬜ Tier-S #141–#147 + #179** (opto/blackmer/varMu/FET-VVR/diode-bridge); also #153 gateStateMachine, #178 differentialEnvelope, #165 voiceCoilCompression. |
| **Movement** (chorus/phaser/flanger) | 🟡 Thin | Universal phaser, BBD chorus pending. **#159 dopplerRotor, #176 varistorVibrato, #162 ringMod, #163 hardSync, #164 hilbert** now slotted ⬜. |
| **Space** (reverb/SDN/ER) | 🟢 Solid | Family architecture locked (Geraint Luff FDN) |

> 🟢 = canonical primitive shipped · 🟡 = partial/missing · 🔴 = none

---

## 🚧 In flight

- _nothing._ #139 xformerSat just landed; next pick is #140 pultecEQ (depends on #139, primary in hand).

## ⏭ Next ops (validate post-Phase-4 cycle at speed)

Pick small math-clean ops first to prove the 7-step protocol cadence (~30–45 min/op) before committing heavy character ports.

> **Drift caught 2026-04-25 (round 2):** prior queue listed Bram envelope detector + coupled sin/cos LFO + lra as next-ups; **all three were already shipped** (`op_envelope` Canon:dynamics §1, `op_lfo` Canon:synth §6, `op_lra` Canon:loudness §3.2 — 12-test suite, golden, registry, all green). Catalog row #55 corrected. STATUS.md is doing its job — three drift catches on first use.

1. **#140 pultecEQ** — Pultec EQP-1A manual primary in hand. Parallel LCR boost/atten + tube makeup + UTC-class OT character. Uses xformerSat as the OT stage (now shipped).
2. **#119 hrtf** — **BLOCKED: no primary in hand.** Need an HRIR dataset staged at `docs/primary_sources/hrtf/` (KEMAR / IRCAM LISTEN / ARI candidates, all CC-licensed). Drop a `.sofa` or compact-format set in the repo and this unblocks.

⬜ ML-family slots (#120 rnnoise, #121 demucs, #122 spleeter) are gated on the ONNX runtime path being battle-tested, not on cadence proof.

> **Strategy shift 2026-04-25:** with cadence validated by `op_lra` ledger pass, no further cadence-proof primitives remain (Bram, LFO, lra all shipped). Heavy character port is the right next move. **#139 xformerSat** moves up; **#119 hrtf** drops behind it pending dataset.

## 🗒 Heavy queue (after cadence is proven)

- ~~**#139 xformerSat**~~ ✅+P shipped 2026-04-26.
- ~~**#166 srcResampler**~~ ✅+P shipped 2026-04-26 (first cadence-proof ship after corpus-sweep triangulation).
- **#140 pultecEQ** — Pultec EQP-1A manual. Parallel LCR + tube + UTC OT character. Depends on #139 (now shipped).
- **Five gain-reduction elements (Tier-S, primaries locked in catalog appendix)** — recommended ship-priority cluster: #141 optoCell · #142 blackmerVCA · #145 varMuTube · #147 fetVVR · #179 diodeBridgeGR. Closes the dynamics gap and unlocks ~60% of the compressor corpus.
- **Tube preamp atom set (Tier-S/A)** — #148 triodeStage · #155 pushPullPower · #156 phaseInverter · #157 cathodeBiasShift · #154 psuRectifierSag. Ship as a coherent set; #113 tubeSim deprecates to alias of triodeStage-with-defaults once #148 lands.
- **BBD-family** — Holters–Parker 2018 (Juno/Dimension-D/Electric Mistress/Memory Man).
- **Airwindows Canon shortlist** — ~25 entries (`airwindows_incorporation_plan.md`).
- **Corpus-sweep Tier-A/B remainder** — 30 more ⬜ slots #149–#183 backed by primaries listed in catalog rows; ship-priority dictated by leverage (character/saturation > filters > modulation > reverb > pitch).

---

## 🔌 Plugin onboarding (Stage 0.5 dogfood)

Existing plugins must reproduce as sandbox graphs before greenfield sandbox or AI-agent work proceeds. **Audio path = sandbox ops; visual/UX = bespoke.**

| # | Plugin | Status | Null-test vs shipping worklet |
|---|---|---|---|
| 1 | **ManChild** | ✅ Onboarded (template green) | Pending |
| 2 | **Lofi Loofy** | 🟡 Partial | Pending |
| 3 | **FJM** | ⬜ Pending | — |
| 4 | **Panther Buss** | ⬜ Pending | — |

**Exit criterion:** last plugin null-tests against its shipping worklet inside the sandbox.

---

## 🤖 AI agent layer — readiness gate (8 conditions)

> Not a build plan, a gate. ALL eight must be true before agent work starts. Plausibly unlocked end of workbench Stage 3.

| # | Gate | Stage | Status |
|---|---|---|---|
| 1 | Plugin IR (JSON nodes/edges/controls/worklet + schema + validator) | 1.7 | 🟡 partial — IR v1.0 + qc:schema in place; full validator pending |
| 2 | ≥5 bricks with manifests + `buildInsideWorklet()` | 1 + 3 | 🟡 partial — sandbox ops are the bricks, manifests partial |
| 3 | Graph compiler IR → master-worklet (honors Dry/Wet Mix Rule by construction) | 1.7 | 🟢 Phase 4 closed |
| 4 | Pre-compile validator catches ≥90% of DEV_RULES + ship-blockers BEFORE compile | 2.5 | ⬜ not started |
| 5 | Capability aggregation rolls up from contained bricks | 1.7 | ⬜ not started |
| 6 | Workbench/runtime separation formalized | 2 + 6 | ⬜ not started |
| 7 | Control-surface mapping (internal params vs Orb-face) | 2 | ⬜ not started |
| 8 | Op log + diff/revert at IR level | 1.5 | ⬜ not started |

**Verdict:** rails are excellent (DEV_RULES, Dry/Wet Mix Rule, QC harness, ship blockers); substrate still missing for safe agent-construction. An agent built today would produce beautiful broken plugins at machine speed.

---

## 🔒 Locked decisions (don't relitigate)

- **Codegen Stage-3 architecture** — graph.json → PCOF → two emitters (master-worklet JS + native C++); per-op tri-file contract; native = JUCE 8 + CMake; `.shagsplug/` self-contained. _(2026-04-23)_
- **Runtime targets v1** — DAW: JUCE-VST3+AU. In-app/web: iPlug2-WAM. Single `.shagsplug/` resource directory. _(2026-04-22)_
- **ML runtime** — ONNX Runtime both paths (ORT-Web + ORT-native). Single `.onnx` shared. No per-op runtime decision. _(2026-04-24)_
- **Native parity = ship gate** — every shipped op must be parity-green; `ship_blockers.md` § 8. _(2026-04-25, Phase 4 close)_
- **Sandbox = workbench at brick layer** — Nasty Orbs IS the sandbox canvas, ~80% built; build = extend downward into ops/primitives. _(2026-04-22)_
- **Modulation floor = Stage B** — zero plugins Type-1-only; signal→param coupling is real floor. _(2026-04-22)_
- **Reverb engine standard** — Geraint Luff FDN (Hadamard diffusion, Householder FB, HF shelf, RT60). All reverbs use it.
- **Dry/Wet mix rule** — mix MUST be computed inside the worklet (NON-NEGOTIABLE). External parallel dry legs forbidden.

---

## 📌 Open drifts / debt

| Issue | Location | Severity | Action |
|---|---|---|---|
| Next-ops queue listed already-shipped ops (Bram, coupled-LFO, lra) — corrected this session | STATUS.md | low | fixed 2026-04-25; three first-use drift catches |
| Catalog row #55 lra had a duplicate ghost ⬜ row beneath the ✅ row, mis-citing "Canon:loudness §4" (LRA is §3.2; §4 is true-peak) | sandbox_ops_catalog.md | low | fixed 2026-04-25 |
| ~~`depaiva_transformer_emulation.md` arctan/NL-1/NL-2 wording — paper actually uses power-law `a·\|v\|^n·sign(v)` Eq 15, Eq 34~~ ✅ Fixed 2026-04-25. Memo §1/§2/§3/§4/§6 rewritten against PDF; MEMORY.md summary line corrected. Found additional drift: paper validates **two** transformers (Fender + Hammond), not three — corrected. | user memory | — | done |
| ~~Catalog #139 xformerSat NL-1/NL-2 wording~~ ✅ Fixed 2026-04-25. | repo memory | — | done |
| #119 hrtf has no primary source in repo — `docs/primary_sources/hrtf/` empty. Slot has registry placeholder only. | catalog #119 | medium | drop KEMAR / IRCAM LISTEN HRIR set in `docs/primary_sources/hrtf/` to unblock |
| `qc:graphs` uses `validateGraph()` not `validateGraphLoud()` — warnings non-fatal | scripts/check_all_graphs_deep.mjs | low | tighten when warning baseline clean |
| `qc:ml` SKIP-as-PASS by default | scripts/check_ml_inference.mjs | low | promote `--strict` to default once weights ship in repo |
| `qc:master` covers only TOY_COMP graph | scripts/check_master_worklet.mjs | low | add a feedback-bearing graph for FB-tap topology coverage |
| No CPU-budget gate (silent perf regressions possible) | none yet | low | future qc gate |
| Tech-debt rename: legacy DrumBus → PantherBussLegacy (keep `legacyType:'drumbus'`) | various | low | cosmetic |

---

## 🚫 Hard ship blockers (from `ship_blockers.md`)

All currently green. Must be re-verified per-publish:

- T1 sweep zero FAILs · Dry/Wet Mix Rule · bypass contract · DC rejection under FB · FB runaway guard · denormal tail · **§ 8 Native parity** (added 2026-04-25).

Conditional gates per class. Waiver = user only.

---

## 📚 Where to look for what

| Looking for… | Open this |
|---|---|
| **Current dashboard** | this file (`STATUS.md`) |
| North-star product thesis | user-memory `portable_chain_platform.md` |
| Per-op ledger (183 slots) | `memory/sandbox_ops_catalog.md` |
| Live task queue | user-memory `qc_backlog.md` |
| Hard ship gates | user-memory `ship_blockers.md` |
| 7-step ship protocol | `memory/sandbox_op_ship_protocol.md` |
| Codegen pipeline phases | user-memory `codegen_pipeline_buildout.md` |
| Codegen architecture lock | user-memory `codegen_design.md` |
| AI agent readiness gate | user-memory `ai_agent_layer_roadmap.md` |
| Plugin onboarding strategy | user-memory `plugin_template_library.md` |
| Six-systems mental model | user-memory `audio_engineer_mental_model.md` |
| Research-debt ledger (skipped upgrades) | `memory/sandbox_ops_research_debt.md` |
| All canonical refs index | user-memory `MEMORY.md` |
| Dry/Wet rule (non-negotiable) | user-memory `dry_wet_mix_rule.md` |
| ManChild ship lessons (15 rules) | user-memory `manchild_lessons.md` |

---

## Update protocol

This file only stays useful if it's trusted. **If `STATUS.md` and reality disagree, `STATUS.md` is wrong — fix it before doing other work.**

**Triggers:**

- **After every op ship** (auto, via ship-protocol Step 7) — refresh: Just landed, Catalog scoreboard counts, Next ops, Open drifts.
- **End of every session** — verify: phase status, in-flight, gate state.
- **After any architectural decision** — add to Locked decisions with date.
- **When opening a plugin onboarding** — update Plugin onboarding row.
- **When closing/opening an AI-agent gate** — flip status emoji.

**Steps:**

1. Top date → today.
2. Where-we-are table → re-check each row.
3. Just landed → wipe last session's, add this session's wins.
4. Gate state → re-verify with `npm run qc:all` or note last-good run.
5. Catalog scoreboard counts → recount from catalog if ops shipped.
6. In flight → what's mid-implementation, or "nothing".
7. Next ops → reorder, prune the top item if shipped.
8. Plugin / AI-agent rows → flip emoji if state changed.
9. Locked decisions → append-only; never rewrite history.
10. Open drifts → add new, strike-through fixed.
11. Commit alongside the work it documents.
