# DAFx — SPATIAL / STEREO — Batch 1

15 papers covering plugin-FX-relevant spatial DSP: parametric stereo (PCA decomposition), mid/side separation & upmix, mono→stereo conversion with mono-compatibility, neural binaural upmix, velvet-noise / resonator decorrelators, dynamic spectral panning, crosstalk cancellation / transaural, and HRTF interpolation for moving sources.

Skipped: WFS rooms, VR/game pipelines, accessibility, large HRTF-dataset research without plugin mapping, MIR localization papers.

**Cross-references**: Pyroadacoustics variable-length-delay Doppler → `dafx_delay_batch2.md` #9. Transaural early-reflection effects (Sæbø 1999) → `dafx_reverb_batch6.md`. Hilbert-pair stereo decorrelation in chorus → `dafx_delay_batch1.md` #1.

---

## 1. Faller 2004 — Parametric Coding of Spatial Audio
**PROBLEM** Coding stereo as L+R doubles bitrate; perceptual stereo cues (ICLD inter-channel level diff, ICTD inter-channel time diff, ICC inter-channel coherence) carry the spatial info.
**DSP STRUCTURE** Encode: STFT → per-band downmix to mono + side-info {ICLD, ICTD, ICC}. Decode: mono + side-info → re-synthesise stereo via per-band gains, delays, decorrelator mix.
**KEY TECHNIQUE** Per-critical-band ICLD = 20log(|R|/|L|), ICTD from cross-correlation peak, ICC from normalized cross-correlation magnitude. Decorrelator (velvet-noise / allpass) generates the diffuse component the ICC says exists.
**AUDIBLE RESULT** Faithful spatial reconstruction from mono + ~5 kbps side info; foundation for "Parametric Stereo" in HE-AAC.
**PLUGIN USE** Stereo-width / upmix / re-pan plugins where you analyze→modify→resynthesise spatial cues; M/S on steroids.
**CONTROLS** Width (scale ICLD/ICTD), Diffuseness (scale ICC), Re-pan (offset ICLD).
**SIMPLIFIED IMPL** per band b: mono[b] = (L[b]+R[b])/2; ICLD[b] = 20log|R/L|; ICTD[b] = argmax_τ corr; ICC[b] = max_corr/(|L||R|); resynth via per-band gain pair + decorrelator mix.

---

## 2. Tournery, Faller 2006 — Parametric Coding of Stereo Audio Based on Principal Component Analysis
**PROBLEM** ICLD/ICTD/ICC parameterization smears the source/ambience boundary; want a cleaner decomposition into "primary" + "ambient" components.
**DSP STRUCTURE** Per band: 2×2 covariance matrix of (L,R) → eigendecomp → primary axis (dominant eigenvector) + ambient component (residual). Encode {primary mono, ambient mono, rotation angle θ}.
**KEY TECHNIQUE** PCA rotation θ_b per band rotates the (L,R) basis so axis 1 captures the panned source, axis 2 captures uncorrelated ambience; perfect for "isolate vocal / isolate reverb" workflows.
**PLUGIN USE** Vocal isolators, ambience extraction, M/S-with-PCA upmixers; reverb/dry separators.
**CONTROLS** Primary/Ambient balance, Width.
**SIMPLIFIED IMPL** per band b: C = [[E[L²], E[LR]], [E[LR], E[R²]]]; eig(C) → primary axis θ_b; primary = L·cos+R·sin; ambient = -L·sin+R·cos.

---

## 3. Avendano, Jot 2008 — Center Channel Separation Based on Spatial Analysis
**PROBLEM** Need to extract the center-panned source (vocal) from a stereo mix without phase artifacts.
**DSP STRUCTURE** Per-bin coherence + similarity panning index ψ = 2|LR*|/(|L|² + |R|²); bins with ψ→1 are center-panned → mask into center channel; rest stays in stereo residual.
**KEY TECHNIQUE** Soft mask m_b = ψ_b^k (k controls aggressiveness); centre = m·(L+R)/2; sides = (1-m)·{L,R}; perfect reconstruction with no phase rotation.
**PLUGIN USE** Vocal isolator, karaoke maker, "center remover" — phase-coherent and mono-safe.
**CONTROLS** Strength (k), Frequency Range, Sensitivity (ψ threshold).
**SIMPLIFIED IMPL** per bin b: ψ = 2|L·R̄|/(|L|²+|R|²); m = ψ^k; center = m·(L+R)/2; L_out = L − m·(L+R)/2.

---

## 4. Mansbridge, Reiss et al. 2015 — Stereo Signal Separation and Upmixing by Mid-Side Decomposition in the Frequency Domain
**PROBLEM** Time-domain M/S can't differentiate centre source from centre reverb; spectral M/S can.
**DSP STRUCTURE** STFT → per-bin Mid = (L+R)/√2, Side = (L−R)/√2; classify each bin by panning index + transient flag → route center-vocal vs centre-bass vs side-ambience to separate channels.
**KEY TECHNIQUE** Frequency-selective M/S enables width control that's safer than time-domain (no comb filtering on broadband content); per-band routing → 5.1 upmix from stereo.
**PLUGIN USE** Spectral M/S processor; surround upmixer; "vocal width" tool that doesn't smear the centre.
**CONTROLS** Centre Gain, Side Gain, Crossover (per-band M/S), Mono Compat check.
**SIMPLIFIED IMPL** per bin: M = (L+R)/√2; S = (L−R)/√2; apply per-bin M/S gains; ISTFT.

---

## 5. — 2015 — Downmix-Compatible Conversion from Mono to Stereo in Time- and Frequency-Domain
**PROBLEM** Mono→stereo widening must remain mono-compatible (sum still equals original mono) for broadcast/mobile playback.
**DSP STRUCTURE** Generate decorrelated complement c(t) such that L = (m + c)/√2, R = (m − c)/√2; sum = √2·m (mono preserved).
**KEY TECHNIQUE** c(t) = decorrelator(m) via short allpass network or velvet-noise FIR with zero-mean impulse response → guaranteed L+R=√2·m; per-band scaling controls perceived width.
**PLUGIN USE** Mono-to-stereo plugin; podcast / voice widener that survives mono playback.
**CONTROLS** Width, Decorrelator Type, Bass Mono Cutoff.
**SIMPLIFIED IMPL** c = decorrelate(m); L = (m+c)/√2; R = (m−c)/√2; HP the c above 200 Hz to keep bass mono.

---

## 6. — 2024 — An Open-Source Stereo Widening Plugin
**PROBLEM** Existing widening tools either kill mono compat or sound phasey; need a vetted reference design.
**DSP STRUCTURE** Per-band M/S processor with mono-compatible widening: extracts S = (L−R)/2, applies frequency-dependent scale (low-band protection), recombines.
**KEY TECHNIQUE** Frequency-dependent S gain = high-shelf (boost above 1.5 kHz, leave bass) → widens without bass-imaging issues; mono check meter built in.
**PLUGIN USE** Reference plugin — open-source code as starting point for any stereo width tool.
**CONTROLS** Width, Bass Mono Freq, Mono-Sum Meter.
**SIMPLIFIED IMPL** M = (L+R)/2; S = (L−R)/2; S_eq = HShelf(S, freq, gain); L_out = M + S_eq; R_out = M − S_eq.

---

## 7. — 2024 — NBU: Neural Binaural Upmixing of Stereo Content
**PROBLEM** Stereo content played on headphones lacks externalisation; want binaural rendering that doesn't require source separation.
**DSP STRUCTURE** Encoder maps stereo → latent spatial-scene representation; decoder maps latent + virtual HRTF positions → binaural L/R; trained on paired stereo/binaural data.
**KEY TECHNIQUE** End-to-end neural mapping side-steps explicit source separation; preserves musical balance while adding head-related cues.
**PLUGIN USE** Headphone-monitoring plugin; "binaurally enhance my stereo mix" tool.
**CONTROLS** Externalisation Amount, Front-back Balance, HRTF preset.
**SIMPLIFIED IMPL** z = Enc(L, R); [L_bin, R_bin] = Dec(z, virtual_layout).

---

## 8. Schlecht, Välimäki et al. 2017 — Velvet-Noise Decorrelator
**PROBLEM** Allpass-based decorrelators colour the timbre; need spectrally-flat, transient-friendly decorrelator.
**DSP STRUCTURE** Sparse FIR with ±1 impulses at random positions and random signs (velvet noise); short length (~30 ms); identical L/R structure but different random seeds.
**KEY TECHNIQUE** Velvet noise = 4 non-zero samples per ms with random sign → spectrally flat, no comb peaks; near-zero perceived colouration; CPU = sparse-FIR ≈ 4 mul/sample.
**PLUGIN USE** Stereo widener decorrelator path; reverb diffusion stage; surround upmix decorrelators.
**CONTROLS** Length (ms), Density (impulses/ms).
**SIMPLIFIED IMPL** generate impulses: pos = floor((k + rand)·(fs/density)); sign = ±1; convolve sparse FIR.

---

## 9. Schlecht, Alary, Välimäki 2018 — Optimized Velvet-Noise Decorrelator
**PROBLEM** Random velvet-noise has occasional spectral notches; want optimised pulse positions for guaranteed flat magnitude.
**DSP STRUCTURE** Same sparse-FIR structure but pulse positions determined via gradient descent on spectral-flatness loss; sign assignment via combinatorial search.
**KEY TECHNIQUE** Optimisation removes worst-case spectral notches → flat ±0.5 dB across full band; same sparse cost at runtime.
**PLUGIN USE** Drop-in upgrade to any velvet-noise decorrelator (replace seed with optimised position table).
**CONTROLS** Length, Density.
**SIMPLIFIED IMPL** ship pre-computed position+sign LUT per (length, density, channel-count); convolve.

---

## 10. Lugger, Schlecht 2025 — Perceptual Decorrelator Based on Resonators
**PROBLEM** Velvet-noise decorrelators are time-domain noise-like → can sound "rough" on tonal sources; want a smoother, music-friendly decorrelator.
**DSP STRUCTURE** Bank of slightly-detuned modal resonators (different per channel); summed output = original-spectrum but per-bin-randomised phase.
**KEY TECHNIQUE** Per-channel random phase per resonator preserves perceived timbre but decorrelates the channels — smoother on harmonic content than velvet noise.
**PLUGIN USE** Vocal/lead-instrument widener where smoothness matters; reverb diffusion on tonal material.
**CONTROLS** Density (resonator count), Detune, Length.
**SIMPLIFIED IMPL** N resonators per channel: y_ch = Σ_k a_k·sin(2π·f_k·t + φ_{ch,k}); φ_L ≠ φ_R.

---

## 11. Bryan, Mysore et al. 2023 — Decorrelation for Immersive Audio Applications and Sound Effects
**PROBLEM** Immersive (Atmos / HOA) needs decorrelators per channel; quality varies wildly; need a comparative framework.
**DSP STRUCTURE** Survey + benchmark of decorrelator families: allpass-cascade, velvet-noise, modal-resonator, NN-based; per-application tuning (music vs SFX vs dialogue).
**KEY TECHNIQUE** Match decorrelator type to source: tonal → resonator; transient → optimised velvet; broadband ambience → allpass cascade.
**PLUGIN USE** Decorrelator selector inside any immersive / surround plugin; per-bus settings.
**CONTROLS** Type, Length, Strength, Source-class hint.
**SIMPLIFIED IMPL** dispatch by source class → call appropriate decorrelator; expose unified Width knob.

---

## 12. Pestana, Reiss 2014 — Cross-Adaptive Dynamic Spectral Panning Technique
**PROBLEM** Static panning leaves bands fighting; want auto-mixing where each track's per-band pan adapts to other tracks' busy bands.
**DSP STRUCTURE** Per-band loudness meter on each track; allocate stereo position per band so loud bands don't collide; smooth pan over time to avoid swirling.
**KEY TECHNIQUE** Cross-adaptive: panning of track A depends on tracks B,C... Per-band collision detection → push collisions to opposite sides.
**PLUGIN USE** Auto-mixer plugin; multi-track panner.
**CONTROLS** Adaptivity, Smoothing, Per-track Centre Bias.
**SIMPLIFIED IMPL** per band b: detect tracks competing at b; assign pans at ±(b/N − 0.5); LP smooth pan trajectory.

---

## 13. — 2016 — A Robust Stochastic Approximation Method for Crosstalk Cancellation
**PROBLEM** Loudspeaker stereo crosstalk cancellation (so each ear hears only its channel) is sensitive to head movement and HRTF mismatch.
**DSP STRUCTURE** Adaptive 2×2 inverse-HRTF filter matrix updated by stochastic gradient on a perceptual error metric; robust against head displacement.
**KEY TECHNIQUE** Stochastic approximation with regularisation prevents the inverse from inverting nulls in the HRTF → stable crosstalk cancellation across a head-sized sweet spot.
**PLUGIN USE** Speaker-3D plugin (binaural over loudspeakers); transaural for stereo monitoring.
**CONTROLS** Speaker Spread, Listener Distance, Robustness (regularisation).
**SIMPLIFIED IMPL** H_inv = (H'H + λI)⁻¹H'; update λ adaptively; convolve [L,R] with H_inv 2x2.

---

## 14. Cuevas et al. 2019 — STAR: Synthetic Transaural Audio Rendering — Perceptive Approach for Sound Spatialisation
**PROBLEM** Full transaural HRTF inversion is CPU-heavy and HRTF-specific; want a perceptive shortcut for stereo speakers.
**DSP STRUCTURE** Per-source: ITD via short delay (≤0.7 ms) + ILD via shelf-EQ (HF cut on far ear) + simple HRTF spectral colour; combine across sources; pre-compensate stereo crosstalk with fixed inverse.
**KEY TECHNIQUE** Skip individual HRTF measurements → use averaged perceptive cues (ITD + ILD + spectral notch) → "good enough" 3D over speakers at fraction of CPU.
**PLUGIN USE** Lightweight 3D-panner plugin for stereo speakers; game audio bridge.
**CONTROLS** Azimuth, Elevation, Distance.
**SIMPLIFIED IMPL** per src: ITD = sin(az)·0.7ms; ILD_HF = sin(az)·6dB; spectral_notch(elevation); transaural inverse 2x2.

---

## 15. Hartung, Wendt et al. 2013 — Selection and Interpolation of HRTFs for Rendering Moving Virtual Sound Sources
**PROBLEM** Discrete HRTF measurements (5° grid) cause clicks when source moves; need smooth interpolation.
**DSP STRUCTURE** Decompose HRTF into minimum-phase magnitude + linear-phase ITD → interpolate magnitudes (log-domain triangular weighting between 3 nearest measurements) and ITD (linear) separately.
**KEY TECHNIQUE** Min-phase decomposition decouples magnitude from delay → magnitudes interpolate smoothly without comb-filtering; ITD interpolated separately as a fractional delay.
**PLUGIN USE** 3D-panner plugin with smooth source movement; binaural-rendering core for any positioner.
**CONTROLS** Azimuth, Elevation (continuous).
**SIMPLIFIED IMPL** at (az,el): find 3 nearest grid points; ITD = Σ wᵢ·ITDᵢ; |H(f)| = exp(Σ wᵢ·log|Hᵢ(f)|); H = |H|·minphase + ITD delay.

---

## REUSABLE PATTERNS — Spatial Batch 1

1. **Spatial cues = (ICLD, ICTD, ICC) per critical band.** Every stereo width / upmix tool starts from this triple. Modify them, resynthesise, get new spatialisation.
2. **Per-band PCA (primary/ambient decomposition)** is the cleanest separation of source vs ambience in stereo — better than M/S for vocal isolation.
3. **Similarity panning index ψ = 2|LR*|/(|L|²+|R|²)** is the canonical center-extraction metric — phase-coherent, mono-safe.
4. **Spectral M/S (per-bin)** is safer than time-domain M/S for width control on broadband material.
5. **Mono compatibility recipe**: L = (M+c)/√2, R = (M−c)/√2 with decorrelator c → guaranteed perfect mono sum.
6. **Frequency-dependent side-gain** (high-shelf above 1.5 kHz, bass mono below 200 Hz) is the safe default for stereo widening.
7. **Velvet-noise FIR (4 ±1 impulses/ms)** = spectrally-flat decorrelator at sparse-FIR cost (~4 mul/sample); the modern default.
8. **Optimised velvet-noise position tables** ship pre-computed; runtime cost identical to random velvet but with guaranteed flat magnitude.
9. **Resonator-based decorrelator** is smoother on tonal material than velvet; per-channel phase randomisation preserves timbre.
10. **Decorrelator family selection**: tonal → resonator; transient → velvet; broadband ambience → allpass cascade; speech → minimum-phase variants.
11. **Cross-adaptive panning** (pan one track based on what other tracks are doing) is the auto-mixer paradigm — eliminates per-band collisions.
12. **Crosstalk cancellation** = 2×2 inverse-HRTF filter + regularisation; required for any speaker-binaural / transaural plugin.
13. **STAR-style perceptive transaural** (ITD + ILD + spectral notch + fixed inverse) is the cheap, robust 3D-over-speakers approach for plugins.
14. **HRTF interpolation = min-phase decomposition + ITD-as-fractional-delay**; interpolate magnitudes in log-domain, ITDs in linear-domain.
15. **Neural binaural upmix** (NBU-style) is the new "headphone enhancer" paradigm — sidesteps explicit source separation.
16. **Mono-sum meter is mandatory** in any stereo-width plugin UI — engineers need the safety net.
17. **Bass mono below 120–200 Hz** is universal best practice — preserves vinyl/clubs/PA compatibility and avoids low-end phase issues.
18. **Three decorrelator quality knobs**: length (ms), density (impulses/ms), spectral-tilt — together cover most use cases.
19. **Width control hierarchy**: mid/side gain (cheapest) → per-band M/S → PCA primary/ambient → parametric (ICLD/ICTD/ICC) → neural latent. Pick by needed precision and CPU.
20. **Three spatial primitives** = (a) inter-channel level, (b) inter-channel time, (c) decorrelation. Every spatial plugin manipulates one or more of these. Build a small library covering all three; combine for any spatial effect.
