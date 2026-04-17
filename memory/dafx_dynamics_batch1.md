# DAFx — DYNAMICS — Batch 1 (full coverage)

15 papers covering: peak-limiter control-signal smoothing, compression inversion, automatic gate/DRC parameter setting, ITU-R BS.1770 / excitation-based loudness metering, multi-time-scale loudness visualisation, Buchla low-pass-gate (vactrol), and the modern neural-compressor lineage (deep optical comp 2022 → grey-box DRC 2022 → fully-conditioned low-latency black-box 2023 → SSL bus-comp dataset 2025).

Cross-reference: Fairchild 670 variable-mu WDF lives in `dafx_distortion_batch3.md` #1; diode-VCA in `dafx_distortion_batch3.md` #13; both are dynamics units.

DAFx coverage of dynamics is shallow (24 indexed) — this single batch closes plugin-relevant territory. Skipped: data-compression / codec / MIR-classification papers from the same category.

---

## 1. Zölzer 2002 — Smoothing of the Control Signal Without Clipped Output in Digital Peak Limiters
**PROBLEM** Peak-limiter sidechain (max of |x|) is non-smooth → audible distortion / clicks at attack onset; naive LP smoothing causes overshoot and clipping.
**DSP STRUCTURE** Look-ahead delay equal to attack time + dual-stage envelope: instant peak detect → LP smoother whose attack < look-ahead → guarantees zero overshoot.
**KEY TECHNIQUE** "Branching" smoother: attack uses fast 1-pole; release uses slow 1-pole; the look-ahead aligns the fast-attack peak with the input sample so output never exceeds threshold.
**AUDIBLE RESULT** Brick-wall true-peak limiting with no clipping, no zipper, no audible attack distortion.
**PLUGIN USE** Master-bus brick-wall limiter; reference architecture for any modern look-ahead limiter.
**CONTROLS** Threshold, Attack (= look-ahead), Release, Ceiling.
**SIMPLIFIED IMPL** delay x by N=attack samples; env_n = max(α_a·env_{n-1}, |x_n|) on attack else α_r·env_{n-1}; gain = min(1, T/env); y = delayed_x · gain.

---

## 2. Stark, Brookes 2008 — Inverting Dynamics Compression with Minimal Side Information
**PROBLEM** Want to undo a compressor's effect on a master to recover dynamics, given only a few side-info bits per frame.
**DSP STRUCTURE** Side info = quantised gain-reduction trace at low rate (≈ 50 Hz, 4–6 bits/sample); inversion = multiply by reciprocal of unpacked envelope.
**KEY TECHNIQUE** Use perceptually-weighted quantisation of log-gain trace; interpolate between frames with cubic spline → audibly transparent uncompression.
**PLUGIN USE** "Dynamics restore" plugin for over-compressed sources; DRC pre/post pair where both ends are coordinated.
**CONTROLS** Side-info bitrate, Restore amount.
**SIMPLIFIED IMPL** g_q = encode(gain_reduction); decode → cubic spline at fs; y = x / g_decoded.

---

## 3. Skovenborg, Lund 2007 — Real-Time Visualisation of Loudness Along Different Time Scales
**PROBLEM** A single loudness reading is meaningless; engineers think in momentary, short-term, integrated time scales (eventually codified in ITU-R BS.1770/EBU R128).
**DSP STRUCTURE** Three parallel K-weighted RMS detectors with windows: 400 ms (momentary M), 3 s (short-term S), gated-mean (integrated I); display as three concurrent bars.
**KEY TECHNIQUE** Pre-filter with K-weighting (HPF + high shelf @ 1.5 kHz +4 dB), then mean-square in three time windows; gating threshold (-70 LUFS absolute, -10 LU relative) for I.
**PLUGIN USE** Loudness meter plugin; scaffolding for any LUFS-aware tool (LU normaliser, AGC, stream-target limiter).
**CONTROLS** Reference (-23 / -16 / -14 LUFS), Window display.
**SIMPLIFIED IMPL** k = K_filter(x); ms = k·k; M = mean(ms, 400ms); S = mean(ms, 3s); I = gated_mean(ms).

---

## 4. Maddams, Finn, Reiss 2009 — Automatic Noise Gate Settings for Multitrack Drum Recordings
**PROBLEM** Manually setting per-mic gate threshold/attack/release across a drum kit is tedious and inconsistent.
**DSP STRUCTURE** Per-track feature extraction (peak, crest factor, spectral centroid) → rule-based mapping to (threshold, attack, release, hold).
**KEY TECHNIQUE** Threshold = noise floor + 6 dB margin; attack = inverse of crest factor (transient mics fast, body mics slow); release = decay-time estimate from autocorrelation.
**PLUGIN USE** "Auto-gate" mode in drum-mixing plugin; reusable feature → param mapping for any auto-mixer.
**CONTROLS** Auto / manual override; sensitivity.
**SIMPLIFIED IMPL** floor = percentile(|x|, 5); thr = floor·2; atk = 1/crest; rel = decay_estimate(ACF).

---

## 5. Ma, Reiss 2012 — An Autonomous Method for Multi-Track Dynamic Range Compression
**PROBLEM** Setting per-track compressor knobs across a multitrack mix to achieve a target loudness balance — manual, slow, inconsistent.
**DSP STRUCTURE** Per-track DRC with thresholds set so each track's post-comp loudness equals target; ratio chosen from track's loudness variance; release = 1/(low-freq energy).
**KEY TECHNIQUE** Loudness-variance-driven ratio selection (high variance → high ratio); cross-track gain-staging keeps perceived balance.
**PLUGIN USE** "Auto-mix" multi-channel compressor; per-track preset generator.
**CONTROLS** Target LUFS, Style (gentle/heavy), per-track override.
**SIMPLIFIED IMPL** for each track: thr = LUFS_target + adj; ratio = clamp(σ_LUFS/3, 1.5, 6); set atk/rel from spectrum.

---

## 6. — 2012 — Audio ADC Dynamic Range Matching by DSP Equalizer + Dynamics Combination
**PROBLEM** Cheap ADCs have limited dynamic range; want to match a higher-DR source by clever DSP pre-conditioning.
**DSP STRUCTURE** Pre-EQ tilts spectrum to match where ADC noise dominates; soft-knee compressor lowers peaks just enough to keep within ADC headroom; post-EQ + expander undoes the conditioning.
**KEY TECHNIQUE** Spectral pre-shaping moves signal energy away from ADC's noisy bands; post-expander restores dynamics by inverse compressor with the same envelope.
**PLUGIN USE** "Lo-fi capture" / dirty-ADC emulation effect; or genuine ADC matching for hardware bridge.
**CONTROLS** ADC Bits, Tilt, Headroom.
**SIMPLIFIED IMPL** y = expand( ADC_round( comp( EQ_pre(x))) ); EQ_pre = inverse of EQ_post.

---

## 7. Parker, D'Angelo 2013 — Digital Model of the Buchla Low-Pass Gate
**PROBLEM** LPG = vactrol (LDR + LED) driving an OTA filter; behaves as combined VCA+VCF with characteristic "bonk" decay; nothing else sounds like it.
**DSP STRUCTURE** Vactrol thermal LP (τ_attack ≈ 1 ms, τ_release ≈ 50–500 ms, asymmetric) drives both filter cutoff (slope-controlled) AND amplitude (resistive divider).
**KEY TECHNIQUE** Single envelope (vactrol response) modulates two destinations with different curves → cutoff and amplitude couple in the way ear identifies as "Buchla".
**PLUGIN USE** Buchla-style synth voice / "bonk" plugin; reuse vactrol model for opto-compressor and Uni-Vibe (cross-ref: distortion batch 3 #4).
**CONTROLS** Decay, Mode (LP-only / VCA-only / both), Resonance.
**SIMPLIFIED IMPL** vac[n] = (gate_on) ? min(1, vac+α_a) : vac·α_r; cutoff = f0·(0.05 + vac); amp = vac·input.

---

## 8. Skovenborg 2015 — Real-Time Excitation-Based Binaural Loudness Meters
**PROBLEM** ITU loudness ignores binaural masking + per-ear excitation; matters for headphone-targeted content.
**DSP STRUCTURE** Per-channel cochlear filter bank → per-band excitation pattern → binaural summation with inter-aural masking → integrated loudness in sones.
**KEY TECHNIQUE** Use 24-band gammatone bank; ML-style excitation; binaural sum = √(L² + R²) per band; total = Σ band-loudness.
**PLUGIN USE** Headphone-aware loudness meter; mastering tool for binaural / immersive content.
**CONTROLS** Headphone vs Speaker mode; reference SPL.
**SIMPLIFIED IMPL** for band b: e_L = LP(GTb(L)²); e_R = LP(GTb(R)²); loud_b = (e_L^0.3 + e_R^0.3); total = Σ loud_b.

---

## 9. Mansbridge et al. 2017 — Automatic Control of the DRC Using Regression and a Reference Sound
**PROBLEM** User wants "compress this guitar like that reference snippet" — needs auto-set knobs from reference audio.
**DSP STRUCTURE** Extract dynamic features (RMS, crest, attack-time histogram) from reference + source; regression maps Δfeatures → (threshold, ratio, attack, release).
**KEY TECHNIQUE** Random-forest regression trained on synthetic (input, knob) → output triples; predicts knobs that drive source toward reference's dynamics signature.
**PLUGIN USE** "Match my reference" compressor preset generator; classroom-style auto-mix tool.
**CONTROLS** Reference clip; weight (apply / suggest).
**SIMPLIFIED IMPL** f_ref = features(ref); f_src = features(src); knobs = RF.predict([f_ref, f_src]).

---

## 10. Schmid, Schlecht 2020 — Relative Music Loudness Estimation Using Temporal Convolutional Networks + CNN Front-End
**PROBLEM** Perceptual "loudness against background music" doesn't match LUFS — needs ML model.
**DSP STRUCTURE** Mel-spectrogram CNN front end → TCN time aggregator → scalar relative-loudness output (dB above bed).
**KEY TECHNIQUE** Trained on crowdsourced pair-wise loudness comparisons; outperforms LUFS on speech-over-music dialogue normalisation.
**PLUGIN USE** Dialogue-leveler plugin for podcast/post-production; auto-ducking smarter than RMS sidechain.
**CONTROLS** Target dialogue/bed offset.
**SIMPLIFIED IMPL** mel = melspec(x); h = CNN(mel); rel_loud = TCN(h); gain_bed = target_offset - rel_loud.

---

## 11. Pestana et al. 2022 — Analysis of Musical Dynamics in Vocal Performances Using Loudness Measures
**PROBLEM** Vocal expressive dynamics (mp/mf/ff) don't map cleanly to LUFS — performers shift timbre as they push.
**DSP STRUCTURE** Multi-feature dynamics descriptor: short-term LUFS + spectral-centroid trajectory + harmonic-noise ratio; fitted to perceived dynamic markings.
**KEY TECHNIQUE** Centroid + HNR are stronger predictors of perceived loudness than LUFS in vocal solo material.
**PLUGIN USE** Vocal-aware compressor / leveler that responds to *expressive* level cue, not raw RMS; preserves performance dynamics.
**CONTROLS** Expression-aware threshold, intensity weight.
**SIMPLIFIED IMPL** dyn_score = a·LUFS + b·centroid + c·HNR; sidechain on dyn_score instead of RMS.

---

## 12. Hawley, Colburn, Mimilakis 2022 — Deep Learning Conditioned Modeling of Optical Compression (LA-2A)
**PROBLEM** LA-2A optical compressor's program-dependent attack/release defies static-knob models.
**DSP STRUCTURE** Conditioned TCN (or LSTM) with control inputs (Peak Reduction, Limit/Compress) feeding a black-box mapping from input to compressed output.
**KEY TECHNIQUE** Conditional FiLM layers inject knob values into hidden activations → single network covers continuous knob range; learns the optical lag implicitly.
**PLUGIN USE** Modern LA-2A clone with smooth knob automation; template for any opto-compressor neural model.
**CONTROLS** Peak Reduction, Mode (Limit/Compress), Gain.
**SIMPLIFIED IMPL** y = TCN(x, FiLM(knobs)); train on (input, knobs, output) triples.

---

## 13. Steinmetz, Reiss 2022 — Grey-Box Modelling of Dynamic Range Compression
**PROBLEM** Black-box NN comp models lose interpretability; want a structure that exposes threshold/ratio/attack/release as actual knobs even though learned from data.
**DSP STRUCTURE** Differentiable DRC core (analytical envelope detector + soft-knee gain function) with NN refining the residual; knobs remain meaningful.
**KEY TECHNIQUE** End-to-end gradient training through differentiable detector → optimise knob mapping + small NN correction; preserves knob-level UX.
**PLUGIN USE** Capture an analog comp's knob behaviour while keeping a normal compressor UI.
**CONTROLS** Threshold, Ratio, Attack, Release, Knee, Makeup — all interpretable post-training.
**SIMPLIFIED IMPL** g = soft_knee_gain(env(x), thr, ratio, knee); residual = NN(x, g); y = x·g + residual.

---

## 14. Comunità, Steinmetz, Reiss 2023 — Fully Conditioned and Low-Latency Black-Box Modeling of Analog Compression
**PROBLEM** Earlier NN comp models had high latency (TCN receptive field) and partial conditioning (couldn't change all knobs in real-time).
**DSP STRUCTURE** Causal small-receptive-field TCN with FiLM conditioning on every comp knob; trained with multi-resolution STFT + waveform losses.
**KEY TECHNIQUE** ≤ 2 ms algorithmic latency; full knob conditioning ⇒ live tweakable; smaller model → CPU-cheap.
**PLUGIN USE** Live-tracking neural compressor plugin (1176, dbx 160 etc); real-time UI feedback.
**CONTROLS** All compressor knobs (Threshold, Ratio, Attack, Release, Input, Output).
**SIMPLIFIED IMPL** y[n] = sum_{k=0..N-1} TCN_layer_k(x[n-k], FiLM(knobs)); receptive < 100 samples.

---

## 15. Steinmetz et al. 2025 — Solid State Bus-Comp: A Large-Scale Diverse Dataset for DRC Virtual Analog Modelling
**PROBLEM** Prior neural-comp datasets are tiny / single-source; can't train robust general models.
**DSP STRUCTURE** Open dataset of SSL G-bus compressor at thousands of (source, knob, attack-mode) configurations; paired DI/comp recordings + metadata.
**KEY TECHNIQUE** Large + diverse + parameter-grid coverage → enables learning that generalises across sources and full knob space.
**PLUGIN USE** Train any new neural-comp architecture (TCN/LRU/LSTM) on this dataset; benchmark against published baselines.
**CONTROLS** N/A — dataset.
**SIMPLIFIED IMPL** download → split train/val/test by source; train architecture of choice with knob-conditioning.

---

## REUSABLE PATTERNS — Dynamics Batch 1

1. **Look-ahead = attack time** is the universal way to get brick-wall limiting with no overshoot; envelope must be computed on the *un-delayed* signal so it lands in time.
2. **Branching attack/release smoother** (instant peak hold + asymmetric 1-pole pair) is the canonical limiter detector — simple, rock-solid, deterministic.
3. **Detector hierarchy**: peak < RMS < K-weighted RMS < cochlear excitation. Pick the lowest tier that meets your perceptual goal.
4. **K-weighting (HPF + 1.5 kHz +4 dB shelf)** is the ITU/EBU standard pre-filter for any LUFS-aware metering or sidechain.
5. **Three-window loudness display** (M/S/I + true peak) is the de facto modern meter UI.
6. **Vactrol = asymmetric thermal LP** (fast attack, slow release, exponential) — same model serves Buchla LPG, opto-compressor (LA-2A), Uni-Vibe; just retune τ.
7. **One vactrol envelope → two destinations (cutoff + amplitude)** = Buchla "bonk" signature — single-source coupled modulation is the sound.
8. **Auto-knob setting via feature regression** (peak/crest/centroid → thr/atk/rel/ratio) is reliable for noise gate and DRC; useful for "auto" plugin modes.
9. **Reference-driven matching** (extract features from target clip → predict knobs) is the new UX paradigm — better than presets.
10. **Conditional FiLM layers** are the cleanest way to inject continuous-valued knob inputs into a neural-comp network.
11. **Grey-box DRC** (differentiable analytical core + small NN residual) keeps knob-level UX while gaining capture-data fidelity — best of both worlds.
12. **Causal small-receptive-field TCN** with full knob conditioning hits the live-tracking sweet spot (≤ 2 ms latency, real-time tweakable).
13. **Dataset matters more than architecture** at this point — SSL Bus-Comp dataset is the new training baseline.
14. **Compression inversion is feasible** with low-bitrate side info — opens the door to coordinated send/return DRC pairs.
15. **Spectral / centroid / HNR sidechain** beats RMS sidechain for vocal-aware compression (preserves expressive dynamics).
16. **Binaural / excitation-based loudness** is the right metric for headphone-targeted content; ITU LUFS undercounts inter-aural masking.
17. **Pre-EQ + comp + post-EQ + expand** = ADC range matching template; reusable pattern for any "dirty capture" or lo-fi emulation.
18. **Plugin lineage strategy**: ship analytical baseline → grey-box version → pure neural version; user picks per CPU/quality preference.
19. **Cross-category compressor units already covered**: Fairchild 670 (variable-mu, distortion batch 3 #1) and diode-VCA (distortion batch 3 #13) — combine with this batch's detector + knob-UX patterns to ship full plugin emulations.
20. **The compressor universe = (detector, gain-curve, knob-UX, character-NL)**. Pick each independently; modern neural models capture the character-NL while analytical core handles the rest.
