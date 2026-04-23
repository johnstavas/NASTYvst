# Research Targets — DSP Substrate Gaps

**Date:** 2026-04-22
**For:** you to research while I build
**Why:** four concrete gaps block specific plugin classes. The musicdsp.org
canon (61 entries) covers classic DSP cold — but modern / ML-era topics
aren't in it. Each gap below unlocks a plugin class. None are needed for
the current sprint (FJM + Lofi Loofy); they gate the plugins after.

Hand back as: PDFs in a folder, or a doc with links. I'll run each through
the memory intake protocol (INTAKE DECISION block → Layer-4 topical file)
when the matching plugin hits the queue.

---

## 1. Modern pitch detection — YIN family  ✅ CLOSED (2026-04-22)

**Status:** all three papers ingested. Remaining work on CREPE is a runtime decision, not a research gap.

**Unlocks:** auto-tune / melodyne / vocal-correction plugins (cross-index row 57). v1 ships on YIN, v2 on pYIN, v3 ("mastering tier") on CREPE once the ML runtime lands.

**Delivered:**
- ✅ **YIN** (de Cheveigné & Kawahara 2002) → `memory/dsp_code_canon_pitch.md §1`. Validated 440.06 Hz on synthetic A4. Ship-safe paraphrase, no aubio GPL.
- ✅ **pYIN** (Mauch & Dixon 2014) → `memory/dsp_code_canon_pitch.md §2`. Beta-threshold prior + 2M-state HMM/Viterbi. F=0.981 vs YIN 0.854. Ship-safe paraphrase, no QMUL GPL v3.
- ✅ **CREPE** (Kim, Salamon, Li, Bello 2018) → `memory/dsp_code_canon_pitch.md §3`. 6-layer 1-D CNN, 16 kHz input, 360-bin cent-scale output with Gaussian-blurred target. RPA 0.995 @ 10¢ vs pYIN 0.908 @ 10¢. MARL reference impl at github.com/marl/crepe is MIT — ship-safe. Bundled with the shared ML-runtime decision (runtime choice shared with RNNoise / Demucs).

**License watch (resolved):** aubio GPL + QMUL GPL v3 avoided in §1/§2 via original paraphrase. CREPE (MARL) MIT — ship-safe. Deferred constraint: ML runtime selection.

---

## 2. ITU-R BS.1770-5 + EBU R128 — LUFS / true-peak  🟢 NEARLY CLOSED (2026-04-22)

**Status:** All four canon sections landed (§1 deployment / §2 core math / §3 meter mechanics / §4 true-peak). Remaining items are a placeholder upgrade (Tech 3342 LRA) and a cross-check port (libebur128 per-rate tables). Mastering-tier limiter / LUFS meter can now be built against the canon as-is; the two open items harden conformance.

**Unlocks:** mastering-grade limiter, loudness meter, broadcast-compliance gate (cross-index row 71 + row 21; also ship-gate for marketplace mastering tier).

**Delivered:**
- ✅ **EBU R128-2023 V5** (deployment recommendation) → `memory/dsp_code_canon_loudness.md §1`. Target-level matrix, tolerance bands, asymmetric inter-programme jump tolerance, multi-platform delivery checklist, R128 vocabulary.
- ✅ **Lund 2011 "BS.1770 Revisited"** (deployment commentary, TC Electronic) → `memory/dsp_code_canon_loudness.md §1`. Gating rationale, viewer remote-reach tolerance data, CALM-Act Max-Short-term backstop, multi-platform gain-order rule.
- ✅ **ITU-R BS.1770-4** (Oct 2015) Annex 1 + Appendix 1 + Annex 3 → `memory/dsp_code_canon_loudness.md §2`. K-weighting two-stage biquad cascade (48 kHz coefficients to 14 decimal places), per-channel mean-square, channel-weighted sum (L=R=C=1.0 / Ls=Rs=1.41 / LFE excluded), −0.691 dB calibration offset, two-pass gated integration (abs −70 LKFS + rel −10 LU below abs-gated mean), Annex 3 azimuth/elevation rule for 22.2 / 7.1.4, 997 Hz calibration self-check.
- ✅ **EBU Tech 3341 V4 (Nov 2023)** (meter mechanics — "EBU Mode") → `memory/dsp_code_canon_loudness.md §3`. Three time scales, full `EbuModeMeter` driver, EBU +9/+18 scales, 1-decimal precision, 23-signal conformance battery.
- ✅ **ITU-R BS.1770-4** Annex 2 + Appendix 1 (true-peak) → `memory/dsp_code_canon_loudness.md §4`. 5-stage algorithm (attenuate → 4× OS → polyphase FIR → abs → +12.04 dB), full 48-tap 4-phase FIR coefficient table, under-read table (4× → 0.688 dB @ f_norm=0.5; 8× → 0.169 dB recommended for mastering), streaming `TruePeakMeter` class, signal 19 (+3 dBTP) self-check.
- ✅ **ITU-R BS.1770-5** (Nov 2023) delta → `memory/dsp_code_canon_loudness.md §5`. Cross-checked Annex 1 + Annex 2 against landed BS.1770-4 content — **bit-identical**, no code changes in §2/§4. Delta is additive: Annex 3 Table 5 per-channel weight lookup for BS.2051 configs A–J (0+2+0 stereo through 9+10+3 = 22.2, incl. 7.1.4-style J=4+7+0), authoritative rule "only M±060/M±090/M±110 weight at +1.5 dB else 0 dB; LFE excluded"; Annex 4 object-based = render-first pipeline with `(loudspeaker-config, renderer)` pair reported alongside loudness value (objective loudness varies 0.3–5.9 LU across renderers per Attachment 1 Table 6). Channel-based stereo / 5.1 plugins: no action; Atmos / MPEG-H / immersive plugins: must expose config + renderer selectors in UI + export manifest.

**Remaining (all non-blocking for a first ship):**
- ✅ **EBU Tech 3342 V4 (Nov 2023)** → `memory/dsp_code_canon_loudness.md §3.2`. Landed 2026-04-22. `ABS_THRES = −70 LUFS`, `REL_THRES = −20 LU` (note: more permissive than R128 Programme Loudness's −10 LU), `PRC_LOW/HIGH = 10/95`, nearest-rank 1-based index, 3 s sliding rectangular window, ≥ 10 Hz rate, ≥ 1.5 s trailing silence pad. Reference Python + 6-signal ±1 LU compliance battery bundled. Unlocks `lra_compliance_synthetic` QC rule (signals 1–4, no WAV bundle needed). Ship-safe paraphrase.
- ⬜ **libebur128 port** (MIT, Jan Kokemüller) — reference C implementation to (a) bundle per-rate K-weighting coefficients (44.1 / 88.2 / 96 / 176.4 / 192 kHz), (b) bundle per-rate true-peak polyphase FIR sets, (c) copy the streaming-gate iteration pattern for sub-second-update live meters, (d) cross-check every numeric result in §2/§4 to within single-ULP. [github.com/jiixyj/libebur128](https://github.com/jiixyj/libebur128).
- ⬜ **EBU test-signal WAV set** (48 kHz, public, tech.ebu.ch/loudness) — bundle all 23 into `tests/ebu_mode/` for the future `ebu_mode_compliance` QC rule.

**License watch:** libebur128 is MIT — can port or wrap directly. BS.1770-4 is a public standard; filter coefficients are numeric facts reproduced by every compliant implementation. R128 + Tech 3341 are freely-downloadable EBU recommendations. Lund 2011 is an AES paper; numeric targets are facts not copyrightable expression. Ship-safe across the board.

---

## 3. Binaural / HRTF — KEMAR + CIPIC + SOFA

**Unlocks:** binaural pan, head-tracked immersive, crossfeed (row 54; also any "3D placement" creative plugin).
**Why the canon is insufficient:** Canon:analysis §5 handles FFT convolution of HRIRs, but the measured HRTF datasets and the SOFA file format live outside musicdsp. Personalized HRTF from anthropometry is current research.

**Datasets (public, free):**
- **KEMAR** (Gardner & Martin, MIT Media Lab 1994) — the reference dummy-head set. [sound.media.mit.edu/resources/KEMAR](https://sound.media.mit.edu/resources/KEMAR.html)
- **CIPIC** (UC Davis) — 45 subjects, anthropometric data included.
- **SADIE II** (University of York) — high-resolution.
- **HUTUBS** (TU Berlin) — large subject pool + anthropometry.

**Format + loader:**
- **AES69 SOFA** spec (Spatially Oriented Format for Acoustics) — free PDF.
- **libmysofa** (BSD, Christian Hoene) — ship-safe SOFA reader.

**Papers:**
- Meshram et al. 2014 — personalized HRTF synthesis from scans (if we want adaptive).

**License watch:** all datasets above are free for research + commercial (verify per dataset license). libmysofa is BSD — ship-safe.

---

## 4. Neural denoise / speech enhancement — RNNoise + Demucs

**Unlocks:** AI de-noise, un-mix, de-reverb (rows 62, 65); also first ML plugin (upstream of AI agent layer gate).
**Why the canon is insufficient:** Canon:analysis §5 (QFT STFT) is the signal-processing baseline; modern DNN models outperform it on speech + music by a wide margin.

**Papers + code:**
- Valin 2018 — **RNNoise** (GRU-based, real-time, BSD-3-Clause, TFLite-portable). Paper + repo at [jmvalin.ca/demo/rnnoise](https://jmvalin.ca/demo/rnnoise/).
- Défossez et al. 2021 — **Demucs** (source separation, MIT). Repo at [github.com/facebookresearch/demucs](https://github.com/facebookresearch/demucs).
- Hennequin et al. 2020 — **Spleeter** (Deezer, MIT).

**Platform decision (flag, not block):** on-device DNN inference means picking a runtime (ONNX Runtime / TFLite / Core ML / WebNN). Not a drop-in paste — needs a platform call. Gather the papers + models first; platform decision when the first ML plugin is scoped.

**License watch:** RNNoise BSD-3, Demucs MIT, Spleeter MIT — all ship-safe.

---

## Priority order (revised 2026-04-22, sandbox-thesis aware)

Context shift: platform thesis is no longer "ship 40 plugins we designed" —
it's **"sandbox where non-coder friends build plugins and author them to
runtime across DAWs"** (see `portable_chain_platform.md` +
`ai_agent_layer_roadmap.md`). Research gaps now evaluated against
"would a friend need this brick?" not "will we ship this plugin?"

1. ~~**YIN / pYIN / CREPE**~~ ✅ **All three ingested.** Only runtime decision remains for CREPE (bundled under #3).
2. ~~**BS.1770-5 + EBU R128 stack**~~ 🟢 **NEARLY CLOSED** — all five canon sections landed (§1–§5 incl. Tech 3342 LRA + BS.1770-5 delta). Residual items (libebur128 port, 23-signal WAV bundle, Tech 3342 signals 5–6) are conformance hardening, not build-blocking.
3. **ML runtime decision + RNNoise / Demucs / CREPE inference** — **now top of the open list.** Non-coder friends will request "de-noise this," "remove the vocals," "make it sound like a Rhodes" — those are all ML-first. Single runtime selection (ONNX Runtime / TFLite / Core ML / WebNN) unlocks the whole ML brick class. Papers are already flagged (§4 below, below); the gate is the platform call, not more research.
4. ~~**Authoring-layer precedent study**~~ ✅ **LANDED 2026-04-22.** `memory/authoring_runtime_precedent.md` written. Verdict: no precedent nails non-coder-authoring + portable-to-DAW together, so we build — but we steal Faust's one-IR-many-adapters shape, Reaktor Core's Brick/Op/Primitive layered authoring, Cmajor's JSON patch-bundle format, and iPlug2's WAM/WASM AudioWorkletProcessor pattern (same compiled graph runs as in-app sandbox AND as DAW VST3). Provisional v1 target stack: **JUCE-VST3 + JUCE-AU (native) + iPlug2-WAM (in-app preview)**; CLAP/WCLAP deferred to v2/v3. IR closed as JSON with named ops + bricks. Stage 1.7 unblocked.
5. **DDSP / Differentiable DSP** (Engel et al., Google 2020, Apache-2) — strings / brass / voice synthesis from audio input. "Make this guitar sound like a violin" class. Pairs with #3 ML runtime.
6. **Basic Pitch** (Spotify 2022, MIT) — polyphonic pitch detection (distinct from monophonic YIN/pYIN/CREPE). Natural "auto-transcribe" / "MIDI-from-audio" brick. Pairs with #3 ML runtime.
7. **HRTF / SOFA** — **DEFERRED indefinitely.** Reactivation criteria: greenlight of a concrete binaural / immersive-audio plugin with a documented product thesis. Rationale: (a) measured HRTF datasets carry per-file licensing complexity incompatible with a user-authored plugin marketplace; (b) 95% of "spatial" creative intent is served by M/S + crossfeed (Bauer/Moy/Linkwitz) + Haas + FDN stereo decorrelation — all already in the canon; (c) genuine HRTF use cases (Waves-NX-class binaural panner, Apple-Spatial-Audio-class head-tracked output) are specialty tools outside the music-production sandbox thesis. Revisit only on explicit product greenlight.
8. **Auto-mixing / Reiss lineage** — gated on concrete "auto-mix these stems" feature scope.
9. **Psychoacoustic masking models** (MPEG Model 2, PEAQ) — gated on masking-aware compressor or perceptual-encoder scope.

---

## Deliverable format

Whichever is easiest for you:

- **Best:** folder with PDFs named per paper, any reference code as zip or git-clone-ready URL list.
- **Also fine:** a doc with links + which items you've gathered.
- **Not useful:** copy-pasted chunks of papers (I'll read the originals).

When you drop the folder/doc, I'll route each through `memory_intake_protocol.md` and write the Layer-4 file (`pitch_detection_yin.md`, `loudness_bs1770.md`, `binaural_hrtf.md`, `neural_denoise.md`). Each will get wired into `dsp_family_research_index.md` and `MEMORY.md` the same way the canon library did.

No rush — none of this blocks the current FJM + Lofi Loofy sprint.
