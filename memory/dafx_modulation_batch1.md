# DAFx — MODULATION — Batch 1

15 papers covering: Leslie/rotary Doppler, unified analog-modulation-effect emulation, fractal-LFO modulation, adaptive / exponential / practical FM, Hilbert single-sideband frequency shifting, time-variant grey-box & differentiable-spectral phaser modeling, controllable neural modulation effects, LFO modulation extraction (auto-clone), AM/FM control interpretation, phase-vocoder transient handling, time-domain pitch-shifting via NFC-TSM, real-time granular loop construction.

**Cross-references** (do not re-summarise):
- **Chorus/flanger/vibrato basics** — Dattorro 1997+1999 + Categories-of-Perception 2006 → `dafx_delay_batch1.md` #1–3.
- **Hammond scanner-vibrato/chorus, BBD analog flanger, Barberpole illusion** → `dafx_delay_batch1.md` #10–12.
- **Tape-like wow/flutter LFO + scrape model** → `dafx_delay_batch2.md` #2.
- **MXR Phase 90 (full-NL JFET 2014 + LTV-JFET 2024) + Uni-Vibe lamp/photoresistor + Diode/Transistor ring mods** → `dafx_distortion_batch3.md` #2, #3, #4, #7, #8.
- **Pyroadacoustics variable-length-delay Doppler** → `dafx_delay_batch2.md` #9.

---

## 1. Smith, Serafin, Abel, Berners 2002 — Doppler Simulation and the Leslie
**PROBLEM** Leslie rotary speaker = horn (treble) + bass rotor each spinning at independent fast/slow speeds → Doppler + amplitude tremolo + room-reflection comb + crossover.
**DSP STRUCTURE** Two parallel paths (HF/LF) split by 800 Hz Linkwitz-Riley crossover; each path driven by variable-length delay (Doppler) modulated by sin/cos of rotor angle, plus per-path AM (cos²-style cardioid horn pattern).
**KEY TECHNIQUE** Geometry-driven delay modulation: D(t) = D0 + r·sin(2π·f_rot·t)/c gives Doppler natively (no pitch shifter); cardioid AM = (1 + cos(angle - listener_angle))/2; HF & LF rotors at independent rates.
**AUDIBLE RESULT** Authentic Leslie 122/147 sweep — Doppler-pitch wobble + tremolo + cabinet comb; "fast" and "slow" mode = ramp acceleration of f_rot.
**PLUGIN USE** Rotary speaker plugin; Hammond/B3 organ companion. Reuse Doppler-via-delay pattern for any spinning-source effect.
**CONTROLS** Speed (Slow/Fast), Acceleration, Drive (tube preamp upstream), Distance (HF mic), Stereo Spread, Crossover.
**SIMPLIFIED IMPL** crossover(x) → (xLF, xHF); for each: D(t) = D0 + r/c·sin(2π·f_rot·t); y = AM(t)·delay(x, D(t)); add stereo mic pair.

---

## 2. Disch, Zölzer 2005 — Enhanced Digital Models for Analog Modulation Effects
**PROBLEM** Generic chorus/flanger/phaser blocks all sound the same; need a unified parameterization that captures analog-circuit character per type.
**DSP STRUCTURE** Single "modulated allpass-comb" macro: N stages of allpass + summation; per-effect coefficients control LFO depth, feedback, allpass count, sum-vs-difference output.
**KEY TECHNIQUE** Same DSP block becomes phaser (allpass cascade, no delay), flanger (modulated short delay + feedback), chorus (modulated mid delay, low feedback) via parameter morph; analog character = per-stage non-ideality (LFO non-linearity, finite-Q allpass).
**AUDIBLE RESULT** One DSP block produces phaser/flanger/chorus + smooth morphs between them.
**PLUGIN USE** Universal modulation FX engine; expose "Effect Type" as continuous knob.
**CONTROLS** Type (Chorus↔Flange↔Phase), Rate, Depth, Feedback, Stages.
**SIMPLIFIED IMPL** AP cascade with per-stage delay D_k(t) = D0_k + depth·LFO(t); feedback gain g; output = mix(dry, AP_chain).

---

## 3. Kahles, Bilbao 2006 — Fractal Modulation Effects
**PROBLEM** Simple sinusoidal LFO modulation gets boring; want LFO with self-similar structure across time scales for evolving textures.
**DSP STRUCTURE** Modulation source = fractional Brownian motion / 1/f noise / Weierstrass function; drives chorus/flanger/phaser depth and rate simultaneously.
**KEY TECHNIQUE** Hurst-parameter H controls roughness: H=0.5 brownian, H<0.5 anti-persistent (jittery), H>0.5 smooth-trending. Multi-octave sum: Σ aⁿ·sin(2π·bⁿ·t) with 0<a·b<1.
**AUDIBLE RESULT** Living, drifting modulation that never repeats and never feels purely random; ambient/evolving texture work.
**PLUGIN USE** "Organic LFO" mode in modulation plugins; pad/ambient sound design.
**CONTROLS** Roughness (H), Octaves, Base Rate, Depth.
**SIMPLIFIED IMPL** lfo(t) = Σ_k aᵏ·sin(2π·bᵏ·t + φ_k); drive depth/rate of host modulation effect.

---

## 4. Lazzarini, Timoney, Lysaght 2007 — Adaptive FM Synthesis
**PROBLEM** Classic FM operator topology requires an oscillator carrier; want to FM-modulate *arbitrary input audio* for vocal/instrument effects.
**DSP STRUCTURE** Use input signal's instantaneous phase (Hilbert) as carrier; modulator is LFO or another input; resynthesise with phase + modulated phase.
**KEY TECHNIQUE** Heterodyne input to baseband via SSB demod, apply phase modulation, re-modulate back → input audio acquires FM sidebands.
**AUDIBLE RESULT** Bell-like, glassy, FM-textured versions of any monophonic input; pitched inharmonic enrichment.
**PLUGIN USE** "FM-ize" effect on vocals/synth/guitar; abstract modulation creative tool.
**CONTROLS** Mod Depth (FM index), Mod Source (LFO/sidechain), Carrier Pitch (re-modulation freq).
**SIMPLIFIED IMPL** φ(t) = unwrap(angle(Hilbert(x))); y = |x| · cos(φ + I·m(t)).

---

## 5. Lazzarini, Timoney 2011 — Exponential FM Bandwidth Criterion for Virtual Analog Applications
**PROBLEM** Exponential (V/oct) FM in synths produces non-band-limited spectra → severe aliasing not addressed by linear-FM Carson rule.
**DSP STRUCTURE** Derive Carson-like bandwidth = 2·(Δf_max + f_mod) where Δf_max comes from peak exponential excursion; use to choose oversampling factor or LP cutoff per voice.
**KEY TECHNIQUE** Conservative band estimate per voice → adaptive oversampling: low-mod voices stay 1×, high-mod voices auto-OS 4×.
**AUDIBLE RESULT** Aliasing-clean exponential FM at low CPU; only voices that need OS pay for it.
**PLUGIN USE** VA modular plugins (Buchla/Moog-style exp-FM); adaptive-quality oscillator.
**CONTROLS** Quality (auto/fixed OS).
**SIMPLIFIED IMPL** BW = 2·f0·(2^(I·m_peak/12) − 1 + f_mod/f0); OS = ceil(BW / (fs/2)).

---

## 6. Lazzarini, Timoney 2020 — Practical Linear and Exponential Frequency Modulation for Digital Music Synthesis
**PROBLEM** Plugin authors mix linear and exponential FM ad hoc; need clean, alias-controlled implementations of both.
**DSP STRUCTURE** Linear FM: f(t) = f_c + I·m(t); Exp FM: f(t) = f_c · 2^(I·m(t)/12); both with per-sample band-limited oscillator (BLEP/PolyBLEP) and Carson-rule OS gating.
**KEY TECHNIQUE** Single oscillator class accepting either FM mode; auto-OS based on instantaneous BW estimate (#5); through-zero linear FM via signed phase increment.
**AUDIBLE RESULT** Production-quality Lin/ExpFM synth voices with no aliasing artifacts at extreme indices.
**PLUGIN USE** Synth plugin oscillator core; FM operator block.
**CONTROLS** Mode (Lin/Exp/TZ), Index, Modulator Source, Carrier Ratio.
**SIMPLIFIED IMPL** if mode==exp: phase += f_c·2^(I·m/12)/fs; else phase += (f_c + I·m)/fs; y = polyBLEP_sin(phase).

---

## 7. Hartmann 2002 — A Hilbert-Transformer Frequency Shifter for Audio
**PROBLEM** Frequency shifting (single-sideband modulation) gives inharmonic/Bode-shifter effects — distinct from pitch shift; needs analytic-signal generation.
**DSP STRUCTURE** Hilbert-transform pair (FIR or IIR allpass network) generates analytic signal x_a = x + j·H{x}; multiply by complex exponential e^(j·2π·f_shift·t); take real part = SSB-shifted signal.
**KEY TECHNIQUE** IIR allpass Hilbert (12-stage Olli Niemitalo design) gives low-CPU, low-latency shifter; positive shift moves all partials up by f_shift Hz (not by ratio → inharmonic).
**AUDIBLE RESULT** Bode-shifter classic: bell-like detuning, unrecognisable timbres at large shifts, gentle "frequency drift" at small shifts.
**PLUGIN USE** Frequency-shifter plugin; feedback loop = Klangbox-style spiral inharmonic chorus.
**CONTROLS** Shift (±Hz), Feedback, Mix.
**SIMPLIFIED IMPL** I = HilbertReal(x); Q = HilbertImag(x); y = I·cos(2π·f·t) − Q·sin(2π·f·t).

---

## 8. Kiiski, Eichas, Zölzer 2016 — Time-Variant Gray-Box Modeling of a Phaser Pedal
**PROBLEM** Phaser pedals (Phase 90, Small Stone) have LFO-driven JFET/OTA allpass chains; pure black-box model loses LFO-shape per-pedal personality.
**DSP STRUCTURE** Grey-box: known allpass cascade structure + learned LFO waveform + learned per-stage offset; trained from input/output recordings of real pedal.
**KEY TECHNIQUE** Fix DSP topology (4× APF1, feedback path), learn LFO shape (e.g., asymmetric triangle for Small Stone vs sine for Phase 90) and per-stage frequency offsets.
**AUDIBLE RESULT** Real-pedal-flavoured phaser sweep with the LFO curvature of the original unit.
**PLUGIN USE** Multi-phaser-pedal plugin; preset = (LFO shape, stage offsets) tuple per emulated pedal.
**CONTROLS** Rate, Depth, Feedback, Pedal preset.
**SIMPLIFIED IMPL** APF cascade(N) with f_k(t) = f0_k · LFO_shape(rate·t)·depth + offset_k; learned LFO_shape sampled from recordings.

---

## 9. Carson, Wright, Steinmetz et al. 2024 — Differentiable Grey-Box Modelling of Phaser Effects Using Frame-Based Spectral Processing
**PROBLEM** Time-domain grey-box phaser models limited to short receptive fields; spectral processing captures sweep dynamics across longer windows.
**DSP STRUCTURE** STFT → predict per-frame phaser response (spectral notch positions + depths) via small NN conditioned on knobs → ISTFT.
**KEY TECHNIQUE** Differentiable analytical phaser block (parametric notch positions) + small NN learning the LFO shape & feedback dynamics; trained end-to-end via gradient descent.
**AUDIBLE RESULT** Higher-fidelity phaser cloning than time-domain LSTM at lower CPU; clean knob extrapolation.
**PLUGIN USE** Modern phaser plugin training pipeline; adapt approach to flanger / chorus / wah.
**CONTROLS** Rate, Depth, Feedback, all clone knobs.
**SIMPLIFIED IMPL** STFT(x) · NotchSpectrum(NN(knobs, t)) → ISTFT.

---

## 10. Mitsufuji et al. 2024 — ConMod: Controllable Neural Frame-Based Modulation Effects
**PROBLEM** Neural modulation effects historically lack interpretable user controls — knobs don't map to perceptual qualities.
**DSP STRUCTURE** VAE-style encoder learns a disentangled latent space (rate / depth / character / stereo), decoder generates frame-level modulation envelope; user manipulates latents directly.
**KEY TECHNIQUE** Adversarial disentanglement loss forces axes to align with perceptual rate/depth/character; FiLM-conditioned decoder applies modulation to dry input.
**AUDIBLE RESULT** Wide range of chorus/flanger/phaser/vibrato effects from one model with continuous, interpretable controls.
**PLUGIN USE** "Universal modulation" plugin with morph between effect types via latent navigation.
**CONTROLS** Rate, Depth, Character (latent), Stereo Width.
**SIMPLIFIED IMPL** z = [rate, depth, char]; mod_env = Decoder(z); y = chorus_frame(x, mod_env).

---

## 11. Mitcheltree, Steinmetz et al. 2023 — Modulation Extraction for LFO-Driven Audio Effects
**PROBLEM** Cloning a chorus/phaser pedal needs to know its LFO waveform; extracting it from recordings without access to the LFO signal is hard.
**DSP STRUCTURE** Two-stage: (1) estimate per-frame fractional delay/notch position from input/output cross-correlation; (2) fit an LFO model (sine, triangle, smoothed-noise) to the trajectory.
**KEY TECHNIQUE** Cross-correlation phase tracking gives the modulation trajectory; LFO model = parametric (rate, depth, shape, asymmetry) fit by least squares.
**AUDIBLE RESULT** Reproduces an unknown pedal's LFO shape from a few seconds of audio → drives a synthetic clone.
**PLUGIN USE** "Capture mode" for modulation pedals; extracts LFO into preset for any modulation plugin.
**CONTROLS** Capture clip → auto-fit LFO params.
**SIMPLIFIED IMPL** delay_traj[n] = argmax_k corr(x[n-k], y[n]); fit (rate, depth, shape) to delay_traj.

---

## 12. Lazzarini, Timoney 2018 — Interpretation and Control in AM/FM-Based Audio Effects
**PROBLEM** AM/FM effects' parameters are mathematical (carrier ratio, modulation index) — opaque to non-engineers.
**DSP STRUCTURE** Map low-level AM/FM params to perceptual controls: "Roughness" (sideband density), "Brightness" (mod ratio), "Pitch Shift" (frequency offset), "Detune" (fine ratio).
**KEY TECHNIQUE** Inverse functions: given target sideband count and brightness, compute (I, ratio); given target detune cents, compute frequency offset for SSB shift.
**AUDIBLE RESULT** AM/FM effects with musician-friendly knobs that respond predictably.
**PLUGIN USE** UX layer over any FM/AM/SSB engine; convert math knobs to musical knobs.
**CONTROLS** Roughness, Brightness, Pitch Shift, Detune.
**SIMPLIFIED IMPL** I = log(roughness)·k1; ratio = exp(brightness·k2); freq_shift = cents/100·440·...

---

## 13. Röbel 2003 — A New Approach to Transient Processing in the Phase Vocoder
**PROBLEM** Standard phase vocoder smears transients (drum hits, plosives) → time-stretch / pitch-shift sounds wishy-washy.
**DSP STRUCTURE** Per-frame transient detector (high-frequency-content / spectral flux); on detection, freeze phase update and re-synch all bins to the un-modified onset frame; resume PV processing afterwards.
**KEY TECHNIQUE** Phase reset at onset preserves transient sharpness; "horizontal" phase coherence between bins maintained around onset.
**AUDIBLE RESULT** Pitch/time-shift retains transient bite; "smearing" artifact gone.
**PLUGIN USE** Pitch-shift plugin (Elastique-style), drum-tuner, time-stretch on percussive material.
**CONTROLS** Transient Sensitivity, Stretch/Pitch.
**SIMPLIFIED IMPL** if (HFC[n] > thr): phases[n] = phases_input[n]; else: phases[n] = phases[n-1] + freq·hop.

---

## 14. Pallone et al. — Real-Time Pitch-Shifting via NFC-TSM (Normalized Filtered Correlation Time-Scale Modification)
**PROBLEM** PSOLA needs accurate pitch marks; phase vocoder smears transients; want a single-shot time-domain pitch-shifter for live/loopers.
**DSP STRUCTURE** Time-scale by overlap-add with cross-correlation-based grain alignment (NFC-TSM) → resample → pitch shift; latency = one analysis window.
**KEY TECHNIQUE** Normalized-filtered cross-correlation finds best grain-overlap offset (independent of pitch period) → robust on polyphonic material.
**AUDIBLE RESULT** Robust real-time pitch-shift on polyphonic input with low latency; less artifact than naive SOLA.
**PLUGIN USE** Live pitch-shifter, harmoniser, capo plugin.
**CONTROLS** Pitch (cents), Latency (window).
**SIMPLIFIED IMPL** TSM via NFC-aligned OLA at ratio 1/r; resample by r → pitch shift by r.

---

## 15. Tremblay, Schwarz et al. — Real-Time Loop Music Production via Granular Similarity & Probability Control
**PROBLEM** Granular synthesis usually produces uncontrolled clouds; want musical, beat-aware loop generation from a sample.
**DSP STRUCTURE** Pre-analyse source sample into grain-feature database (MFCC, centroid, loudness); at runtime select grains by feature-distance + probability matrix (Markov chain on features).
**KEY TECHNIQUE** Concatenative granular: each grain = 30–200 ms; select-by-similarity replaces random scattering → coherent musical loops; probability tweaks structure (dense ↔ sparse).
**AUDIBLE RESULT** Loop-able granular textures that retain source's musical character; "infinite remix" of any audio file.
**PLUGIN USE** Creative granular plugin; live performance instrument; texture generator for film/game.
**CONTROLS** Grain Size, Density, Similarity (vs Random), Pitch, Spread.
**SIMPLIFIED IMPL** grains = pre_analyse(source); for each output frame: g_next = select_by_feature(g_prev, P_matrix); render with envelope; OLA.

---

## REUSABLE PATTERNS — Modulation Batch 1

1. **Doppler = variable-length delay driven by source-listener geometry** — no pitch shifter required. Rotor / fly-by / movement effects all use this primitive.
2. **Leslie = per-band Doppler + cardioid AM + speed ramp** — HF/LF rotors at independent rates; "Slow→Fast" is acceleration smoothing, not instant speed change.
3. **Unified modulated-allpass-comb block** can morph chorus ↔ flanger ↔ phaser by parameter morph; sell as "type" knob.
4. **Fractal / 1/f LFO** (Hurst H ∈ [0,1]) replaces sterile sine for "organic" modulation textures.
5. **Adaptive FM** = use input audio's analytic phase as the carrier — turns any input into FM source without an oscillator.
6. **Exponential-FM Carson rule** dictates per-voice oversampling: most voices need none, occasional voices need 4×.
7. **Through-zero linear FM** = signed phase increment — required for classic Buchla / FM-synth deep-modulation effects.
8. **Hilbert SSB shift ≠ pitch shift** — adds a constant Hz offset → inharmonic, "Bode" character; great with feedback.
9. **IIR allpass Hilbert (12 stages, Niemitalo design)** is the cheap real-time Hilbert pair for plugins.
10. **Grey-box phaser/chorus = analytical topology + learned LFO shape + learned per-stage offsets** — cleanest cloning route.
11. **Frame-based spectral grey-box** captures longer-scale modulation dynamics than time-domain LSTM at lower CPU.
12. **Cross-correlation delay tracking** extracts an unknown pedal's LFO waveform from input/output recordings → "capture LFO" UX.
13. **Latent-disentangled VAE** can give continuous Rate/Depth/Character knobs over a multi-effect modulation space.
14. **Perceptual-knob mapping layer** (Roughness/Brightness/Detune) over math params (I/ratio/Hz) is a UX necessity for AM/FM plugins.
15. **Phase-vocoder transient reset** at onset frames preserves drum sharpness through pitch/time shift — mandatory for percussive material.
16. **NFC-TSM / WSOLA** is the right time-domain pitch-shifter for live/looping plugins (polyphonic-robust, low latency).
17. **Concatenative granular with feature-similarity selection + Markov probability matrix** = controllable musical granular (vs random clouds).
18. **Geometry-driven (Doppler) vs LFO-driven (vibrato/chorus) vs envelope-driven (vactrol opto)** — three modulation-source archetypes; pick by what controls your time-varying delay/cutoff/gain.
19. **Capture-style cloning** is now standard: extract LFO shape (Mitcheltree 2023) + analytical block + small NN residual = full pedal clone from recordings.
20. **Modulation primitive recipe**: choose (a) modulation source [LFO/geometry/envelope/noise/audio-derived], (b) destination [delay/cutoff/gain/phase], (c) modulation curve [linear/exp/exp-symmetric/asymmetric], (d) per-channel offsets for stereo. All classic mod effects are points in this 4-D design space.
