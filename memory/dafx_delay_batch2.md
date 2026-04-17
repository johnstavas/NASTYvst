# DAFx — DELAY — Batch 2

15 papers covering tape-machine modeling (analog + neural), tube echo, fractional addressing, multitap architectures, spectral/feedback delays, variable-length doppler delay, alias-free feedback-loop oscillators, differentiable allpass identification, concatenative-feature delay, and FDN topology for delay-effect chaining.

Pulled cross-category from Distortion (tape/tube), Synthesis (feedback delay loop oscillator), Reverb (FDN architectures) where the underlying primitive is a delay technique. Skipped: vented-box group-delay correction (loudspeaker EQ), inverse-comb pitch analysis (MIR), echo cancellation, low-delay codecs.

---

## 1. Dattorro 1997 — Filters, Delays, Modulations and Demodulations: A Tutorial
**PROBLEM** Need a single reference frame for all delay-line based effects (the "Effect Design Pt 1" companion to the chorus/flange paper).
**DSP STRUCTURE** Catalog of delay primitives: comb, allpass-comb, nested allpass, modulated tap, multi-tap; each as DSP block diagram with direct-form code.
**KEY TECHNIQUE** Establishes that any delay-based effect = (write pointer + N read pointers + per-tap interpolator + per-tap modulator + feedback graph + output mix). Proves nested allpass = unity-magnitude diffuser usable as recursive sub-block.
**AUDIBLE RESULT** N/A — taxonomy paper, but its block diagrams underpin every subsequent reverb/delay/chorus design.
**PLUGIN USE** Use as architectural vocabulary; pick primitive blocks per effect (allpass diffuser → reverb; modulated tap → chorus; nested allpass → ambience).
**CONTROLS** Per-block: D, g, LFO {rate,depth}.
**SIMPLIFIED IMPL** Library of: Comb(D,g); APF(D,g); NestedAPF(outer{D,g}, inner{D,g}); ModTap(D_base, depth, rate); MultiTap(D[]);

---

## 2. Arnardottir, Abel, Smith 2008 — Efficient Emulation of Tape-Like Delay Modulation Behavior
**PROBLEM** Tape echo wow & flutter has a specific spectrum (≈0.5 Hz wow + ≈6 Hz flutter + scrape ~50–150 Hz) that random LFOs miss.
**DSP STRUCTURE** Variable-length delay line driven by a *band-limited noise pitch-modulator* shaped by 3 bandpass filters tuned to wow/flutter/scrape bands.
**KEY TECHNIQUE** Sum of three 1/f-shaped band-limited noise sources → realistic tape pitch wobble; fractional-delay read with cubic Lagrange to avoid sweep zipper.
**AUDIBLE RESULT** Convincingly "tape-like" pitch wobble on a delay line — distinct from sine-LFO chorus.
**PLUGIN USE** Tape-echo plugin pitch-wobble engine; layer on any delay for tape feel.
**CONTROLS** Wow, Flutter, Scrape (per-band depth), Age (overall scale).
**SIMPLIFIED IMPL** mod = w·BP_0.5(noise) + f·BP_6(noise) + s·BP_100(noise); D = D_base·(1 + mod); cubic interp read.

---

## 3. Bilbao, Stilson, Smith 2007 — Real-Time Physical Modelling for Analog Tape Machines
**PROBLEM** Tape distortion + head-bump EQ + bias hysteresis + speed-dependent saturation → must be modeled together for authentic tape sound.
**DSP STRUCTURE** Three-stage chain: (1) record-head pre-emphasis (HP shelf), (2) tape transfer = hysteretic Jiles-Atherton or arctan model with bias dither, (3) play-head loss filter (LP + head-bump resonance).
**KEY TECHNIQUE** Hysteresis model has memory → soft saturation that depends on signal history (tape "compression"); head-bump = small resonant peak ~50–100 Hz from playback head geometry.
**AUDIBLE RESULT** Punchy bass bump, soft top-end roll-off, dynamic compression that thickens on transients — the canonical "tape glue".
**PLUGIN USE** Tape saturator/mastering tape; combine with #2 for full tape-echo plugin.
**CONTROLS** Drive, Bias, Speed (7.5/15/30 ips → swaps EQ curves), Head-Bump, Hiss.
**SIMPLIFIED IMPL** y = HP_pre(x); y = JilesAtherton(y, bias) [or scaled tanh + memory]; y = LP_play·HeadBump(y).

---

## 4. Rocchesso 2000 — Fractionally-Addressed Delay Lines
**PROBLEM** Fractional-sample delay quality vs CPU: linear interp = cheap+lossy; sinc = perfect+expensive; need a sweet spot for modulated delays.
**DSP STRUCTURE** Comparative analysis of linear, all-pass (1st-order), Lagrange (3rd/5th-order), and Thiran allpass interpolators in a delay-line context with modulation.
**KEY TECHNIQUE** Quantifies error vs CPU; derives that 3rd-order Lagrange is best general-purpose; 1st-order allpass best for slow-moving loops; Thiran best for static fractional in feedback.
**AUDIBLE RESULT** Reduced sweep noise / pitch-glitch artifacts when correct interpolator chosen for use case.
**PLUGIN USE** Pick interpolator per use: chorus/flanger → cubic Lagrange; Karplus loop → 1st-order allpass; static fractional in feedback (e.g., FDN tuning) → Thiran.
**CONTROLS** None user — internal quality preset.
**SIMPLIFIED IMPL** Cubic Lagrange: y = -frac(frac-1)(frac-2)/6 · x[n-1] + (frac+1)(frac-1)(frac-2)/2 · x[n] - frac(frac+1)(frac-2)/2 · x[n+1] + frac(frac+1)(frac-1)/6 · x[n+2].

---

## 5. Mathews, Smith, Jaffe — TAPIIR: A Software Multitap Delay
**PROBLEM** Want a single configurable multitap with per-tap pan, filter, feedback routing — the "swiss army" delay.
**DSP STRUCTURE** N independent read pointers on one shared write buffer; each tap has {gain, pan, filter, feedback-to-input-of-tap-k}.
**KEY TECHNIQUE** Treat multitap as a sparse FIR + per-tap recursive paths → matrix of tap-to-tap feedback enables ping-pong, FDN-lite, rhythmic patterns from one buffer.
**AUDIBLE RESULT** Rhythmic ping-pong, "shimmer-stack", granular-style cluster echoes.
**PLUGIN USE** Architecture for any "creative delay" plugin; expose per-tap matrix.
**CONTROLS** Per tap: Time, Gain, Pan, LP/HP cutoff, Feedback-to-tap-k matrix.
**SIMPLIFIED IMPL** out_k = filter_k(buf[D_k]); write = x + Σ M[k,j]·out_j; pan & sum out_k → L/R.

---

## 6. Välimäki, Tolonen, Karjalainen — Spectral Delay Filters with Feedback and Time-Varying Coefficients
**PROBLEM** Want frequency-dependent delay (different bands delayed by different amounts) for sweeping/dispersive effects.
**DSP STRUCTURE** High-order allpass with a designed group-delay curve τ(ω); placed in feedback loop; coefficients modulated over time.
**KEY TECHNIQUE** Replace the integer-delay element of a comb with an allpass having a sloped τ(ω) → bands repeat at different rates → audible "spectral cascade" / chirped echoes.
**AUDIBLE RESULT** Glassy, descending/ascending chirp echoes; "laser-zap" tails; FM-radio tuning sweep on noise.
**PLUGIN USE** Spectral-delay creative effect; "Chromax"-style effect.
**CONTROLS** τ(ω) Slope (lin/log/curve), Feedback, Modulation Rate, Wet/Dry.
**SIMPLIFIED IMPL** comb feedback loop with N-section APF cascade designed via group-delay-domain LS to target slope; recompute APFs at modulation rate.

---

## 7. Chromax — The Other Side of the Spectral Delay
**PROBLEM** Compositional use of spectral delay — make it a musical instrument, not just a curiosity.
**DSP STRUCTURE** Spectral delay (#6) wrapped with per-band gating, MIDI/key-tracking of delay slope, and tempo-synced rate.
**KEY TECHNIQUE** Map MIDI note → group-delay slope so each note triggers a unique chirp signature; band-gate output with envelope follower for rhythmic spectral patterns.
**AUDIBLE RESULT** Musical "spectral arpeggios" — input transient sprays out as chirped, pitched echo cluster.
**PLUGIN USE** Creative spectral-FX plugin; MIDI-controlled delay slope.
**CONTROLS** Slope, Slope-per-Note, Sync, Gate Threshold, Pattern.
**SIMPLIFIED IMPL** wrap #6 with MIDI handler that updates τ(ω) coefficients; envelope-follow for per-band gate.

---

## 8. Karjalainen, Esquef et al. — Flutter Echoes: Timbre and Possible Use as Sound Effect
**PROBLEM** Catalog the perceptual/timbre properties of flutter echo and turn it into a usable creative effect (vs the unwanted-room-defect framing).
**DSP STRUCTURE** Short comb (delay = ms range) with shaped feedback filter + modulated jitter; characterized via NED/spectral-peak analysis.
**KEY TECHNIQUE** Identifies that perceived flutter "pitch" = c/(2L) and "timbre" = comb-peak amplitude envelope shaped by per-bounce filter; controllable as design param.
**AUDIBLE RESULT** Stairwell/parking-garage buzzy pitched tail; pitchable as a tonal effect.
**PLUGIN USE** Standalone "Flutter" effect; layer on hi-hat/snare for "concrete corridor" feel.
**CONTROLS** Pitch (= c/2L), Color (HF damping per bounce), Density (parallel combs), Jitter, Mix.
**SIMPLIFIED IMPL** parallel combs with delays D_k = round(fs/pitch_k); feedback gain·shelf; mix.

---

## 9. Pezzoli et al. 2024 — Pyroadacoustics: Road Acoustics via Variable-Length Delay Lines
**PROBLEM** Vehicle pass-by Doppler + ground-reflection delay + LP air absorption with realistic time-varying delay.
**DSP STRUCTURE** Two variable-length delay lines (direct + ground-reflect) per source, each with cubic-interpolated read driven by source-receiver geometry; LP filter for air absorption.
**KEY TECHNIQUE** Smooth time-varying read-pointer = native Doppler — no separate pitch shifter; ramp delay length per sample using geometry update at lower rate, interpolate at audio rate to suppress zipper.
**AUDIBLE RESULT** Authentic Doppler whoosh for moving sources without pitch-shift artifacts.
**PLUGIN USE** Game-audio Doppler, "fly-by" creative effect, sound-design movement.
**CONTROLS** Source XYZ (or trajectory preset), Speed, Ground Damp, Air Distance.
**SIMPLIFIED IMPL** D_n = ||src - mic|| · fs / c; smooth D_n at audio rate via 1-pole LP; cubic-interp read; HP/LP for air absorption.

---

## 10. Mikkonen, Wright, Välimäki 2023 — Neural Modeling of Magnetic Tape Recorders
**PROBLEM** Hand-crafted tape models miss subtle nonlinear/hysteretic detail and don't capture specific machine personalities (e.g., Studer A800 vs Tascam 488).
**DSP STRUCTURE** Conditioned RNN (LSTM/GRU) trained on direct-input/tape-output pairs from real machines; small footprint for real-time.
**KEY TECHNIQUE** Black-box neural surrogate captures hysteresis + bias + head-bump + saturation as one learned mapping; condition vector = speed/bias/EQ knobs.
**AUDIBLE RESULT** Per-machine character with sample-accurate fidelity; adapts to drive level.
**PLUGIN USE** Multi-machine tape plugin where users select unit; combine with #2 wow/flutter for full pipeline.
**CONTROLS** Machine (preset), Drive, Speed, (knobs are conditioning inputs).
**SIMPLIFIED IMPL** GRU(hidden=16–32) per channel; pre-emphasis → GRU(input, [drive,speed]) → de-emphasis.

---

## 11. Holmes, McPherson 2017 — A Virtual Tube Delay Effect
**PROBLEM** Vintage "tube echo" units (Echoplex, Roland RE-201) get character from tube preamps in send + return paths, not just tape.
**DSP STRUCTURE** Tape-delay core (BBD or tape model) sandwiched between two tube preamp models (state-space or WDF) with per-stage HP/LP coupling caps.
**KEY TECHNIQUE** Pre-tube saturates input transients before delay → soft compression + harmonic richness; post-tube compresses regenerated repeats → "growling" feedback that doesn't go shrill.
**AUDIBLE RESULT** Echoplex-style warm, breathing repeats with harmonic bloom on feedback; high regen growls instead of squeals.
**PLUGIN USE** Tube-tape echo plugin; reuse pre-/post-tube sandwich on any delay for "vintage warmth".
**CONTROLS** Drive (tube), Time, Repeats, Bias, Tone, Mix.
**SIMPLIFIED IMPL** y = tube_pre(x); d = tape_delay(y + fb); fb = tube_post(d)·g; out = mix(x, d).

---

## 12. Välimäki, Pekonen 2010 — Alias-Free VA Oscillators Using a Feedback Delay Loop
**PROBLEM** Want band-limited classic-waveform synth osc without polyBLEP/BLIT bookkeeping.
**DSP STRUCTURE** Closed feedback delay loop tuned by fractional-delay (Lagrange/allpass) so loop period = 1/f0; injected impulse train shapes the spectrum; loop filter shapes harmonic envelope.
**KEY TECHNIQUE** Karplus-style loop with carefully shaped loop filter approximates ideal sawtooth/square spectra; aliasing controlled by loop-filter LP and fractional-delay smoothness.
**AUDIBLE RESULT** Clean band-limited oscillators with built-in tone control via loop filter.
**PLUGIN USE** VA synth oscillator core; alt to BLEP for synth plugin.
**CONTROLS** Pitch, Wave (filter shape), Brightness (loop LP cutoff).
**SIMPLIFIED IMPL** D = fs/f0; APF for frac; injection = single sample/period; loop: y = APF(LP(buf[D] + injection·g)); buf write = y.

---

## 13. Mitcheltree, Steinmetz, Reiss et al. 2023 — Differentiable All-Pass Filters for Phase Response Estimation & Auto Alignment
**PROBLEM** Aligning two captures of the same instrument (DI vs amp, mic vs pickup) requires phase-only filter — manually painful.
**DSP STRUCTURE** Cascade of differentiable biquad APFs; gradient-descent on phase-difference loss vs target capture; PyTorch implementation.
**KEY TECHNIQUE** All-pass phase response is differentiable in pole position via re-parameterization (frequency, Q); fit by minimizing complex log-spectral phase distance over short window.
**AUDIBLE RESULT** Auto-aligned phase between two recordings without comb-filtering.
**PLUGIN USE** Mix-utility "auto-phase-align"; pre-stage for parallel processing chains.
**CONTROLS** Reference Source, Stages (4–16), (rest automatic).
**SIMPLIFIED IMPL** APF_cascade(θ); loss = ||∠STFT(out) - ∠STFT(ref)||²; Adam updates θ; freeze and run.

---

## 14. Bernardini, Sanfilippo et al. 2023 — Feature-Based Delay Line Using Real-Time Concatenative Synthesis
**PROBLEM** Standard delay returns a delayed copy; want a delay whose output is selected by *audio similarity* rather than time.
**DSP STRUCTURE** Circular buffer + per-frame feature extractor (MFCC/spectral centroid); read pointer = best-match frame to current input; concatenate matched grains.
**KEY TECHNIQUE** Replace time-based read-pointer with feature-distance-minimum lookup → "delay" returns past audio that *resembles* the present input.
**AUDIBLE RESULT** Eerie self-mirroring "echo" — when you whisper, past whispers come back; when you hit a transient, past transients echo.
**PLUGIN USE** Creative effect for ambient/experimental work; sound-design tool.
**CONTROLS** Memory Length, Feature Set, Match Strictness, Crossfade.
**SIMPLIFIED IMPL** for each frame: feat = extract(x); idx = argmin ||feat - hist_feats||; out = window·hist_audio[idx] + xfade.

---

## 15. Jot 1992 / Schlecht — Delay Network Architectures for Room and Coupled-Space Modeling
**PROBLEM** Single FDN can't model coupled spaces (e.g., nave + side chapel) where sound exchanges between rooms with different RT60s.
**DSP STRUCTURE** Two (or more) FDNs cross-coupled by a small additional feedback matrix; each sub-FDN has its own RT60 / EQ; coupling matrix sets aperture.
**KEY TECHNIQUE** Block-diagonal feedback matrix with off-diagonal "leakage" terms gives multi-slope EDC (early fast decay + later slow decay) — the audible signature of coupled spaces.
**AUDIBLE RESULT** Realistic coupled-room reverb where late tail seems "trapped" in the secondary space.
**PLUGIN USE** "Coupled Hall" reverb mode; also use as architecture for any multi-decay reverb (close + far, dry + plate, room + tail).
**CONTROLS** Room A RT60, Room B RT60, Coupling Aperture, A/B Balance.
**SIMPLIFIED IMPL** s_A_next = M_A·s_A + κ·s_B + B_A·x; s_B_next = M_B·s_B + κ·s_A; output = c·s_A + c·s_B.

---

## REUSABLE PATTERNS — Delay Batch 2

1. **Tape pitch wobble** = sum of 3 band-limited noise sources at wow/flutter/scrape bands — never a sine LFO.
2. **Tape tone pipeline** = pre-emphasis HP shelf → hysteretic saturator → playback LP + head-bump resonance — model all three or the saturator alone won't sound "tape".
3. **Hysteretic saturation** ≠ memoryless tanh; signal-history dependence is what makes tape "compressed and warm".
4. **Interpolator selection rules**: cubic Lagrange for modulated taps; 1st-order allpass for slow tunable loops; Thiran for static-fractional in feedback. Use the cheapest acceptable for the use-case.
5. **Multitap = sparse FIR + per-tap routing matrix** — single buffer, many architectures (ping-pong, FDN-lite, granular).
6. **Spectral delay = APF cascade (sloped τ(ω)) inside a comb feedback loop** — bands repeat at different rates → musical chirped echoes.
7. **Variable-length delay = Doppler for free** — no pitch shifter needed; just smooth-ramp delay length and cubic-interp read.
8. **Smooth delay-length ramp** at audio rate (1-pole LP on D_n) is the cheapest fix for sweep zipper noise.
9. **Black-box neural surrogate (small GRU/RNN)** captures per-machine character of tape/tube units in real-time CPU budget; condition on knob values.
10. **Tube-pre/tube-post sandwich on a delay** = vintage echo formula; pre = transient softening, post = feedback bloom limiter.
11. **Karplus-loop oscillator**: a feedback delay loop with shaped loop filter is a viable alt to BLEP/BLIT for VA oscillators.
12. **Differentiable APF cascades** make auto phase-alignment a one-button mix utility — no comb-filtering between parallel sources.
13. **Feature-keyed read pointer** turns "delay" into "concatenative echo" — recall past audio by similarity, not by time.
14. **Cross-coupled FDN pair** is the simplest way to model coupled rooms / multi-slope decay; off-diagonal feedback = aperture between spaces.
15. **Delay-line vocabulary** (Comb / APF / NestedAPF / ModTap / MultiTap / VarDelay) covers ~all delay-based effects; build them as reusable C++ classes once and recombine for each plugin.
16. **Flutter pitch is a design knob, not a defect** — exposes c/(2L) as user-facing "Pitch" control.
17. **Per-band gating + MIDI-driven slope** transforms a spectral-delay effect from curiosity into playable instrument.
18. **Geometry update at control rate, interpolate at audio rate** — the standard pattern for any geometry-driven delay (Doppler, room, head-tracked).
19. **Pre-emphasis / de-emphasis around any nonlinear stage** (tape, tube, BBD compander) shapes which frequencies see most distortion — designer's primary tone-control on saturation character.
