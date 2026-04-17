# DAFx — DELAY — Batch 1

15 papers covering analog-delay modeling (BBD, tape, tube echo), modulation-delay (chorus/flanger/vibrato/barberpole), fractional delay & interpolation (Thiran/allpass/dispersion), feedback shaping (energy-preserving allpass, Schroeder), time-varying delay systems.

Skip notes: Holters/Parker 2018 BBD model already in dedicated MEMORY (`bbd_holters_parker_model.md`). Lee/Smith 2009 low-order allpass dispersion already covered in `dafx_reverb_batch6.md` — re-summarized here under delay-loop framing because it is the canonical fractional-delay-loop technique.

---

## 1. Dattorro 1997/1998 — Enhanced Quality and Variety for Chorus/Flange Units
**PROBLEM** Stock chorus/flanger sound thin, mono, and "ticky" when LFO crosses zero or wraps around the read pointer.
**DSP STRUCTURE** Single short modulated delay line with linear (or 4-pt cubic) interpolation; multi-tap output read at quasi-incommensurate offsets; per-tap LFO phase offsets fed through Hilbert-style 90°/0° pair for stereo.
**KEY TECHNIQUE** Sum of slow + fast LFOs (e.g., 0.5 Hz + 6 Hz triangle) per tap with prime-related rates → no perceptual repetition; quadrature LFO pairs decorrelate L/R; small DC offset on the LFO so the tap never reaches the write pointer.
**AUDIBLE RESULT** Lush, evolving stereo chorus without ratchet; classic "Dattorro" silken flanger when feedback>0.
**PLUGIN USE** Universal chorus/flanger DNA. Use as the modulation engine inside any analog-style chorus.
**CONTROLS** Rate, Depth, Stereo Spread (per-tap LFO phase), Feedback (signed), Mix.
**SIMPLIFIED IMPL** ~32-ms delay line, 4 read taps at base offsets [11,13,17,19] ms, each tap = base + depth·sin(2π·rate·t + phase_k); cubic-Lagrange fractional read; pan taps across stereo via Hilbert pair.

---

## 2. Dattorro 1999 — Modulation and Delay Line Based Digital Audio Effects (Effect Design Pt 2)
**PROBLEM** Need a unifying primitive for chorus, flanger, vibrato, white-chorus, slapback, pitch-shifter, and Lexicon-style ambience.
**DSP STRUCTURE** Single "modulated tap on a long delay" macro: write pointer + N read pointers each with their own LFO, fractional interpolator, and feedback path; optional per-tap allpass diffuser.
**KEY TECHNIQUE** Treat *modulation depth* as the genre selector — sub-ms = vibrato, 0.5–10 ms = chorus, 1–20 ms with feedback = flanger, ±semitone ramp = pitch-shift, 30–200 ms with diffusion = ambience. Same code, different parameter ranges.
**AUDIBLE RESULT** One DSP block can be repurposed for half a dozen classic effects; consistent CPU and memory budget.
**PLUGIN USE** Architectural pattern: build a "ModDelay" core class, then expose preset envelopes that scope its parameter ranges per effect type.
**CONTROLS** Tap count, base delay, depth, rate, LFO shape, feedback, diffusion, wet/dry.
**SIMPLIFIED IMPL** struct ModTap{base, depthMs, rate, phase}; output = Σ interp(buf, write - (base + depth·lfo)·fs); feed (sum·fb) into write.

---

## 3. Lee, Müller, Kim 2006 — Categories of Perception for Vibrato, Flange, Stereo Chorus
**PROBLEM** What modulation rate/depth ranges are perceptually distinct, and where do effect categories blur?
**DSP STRUCTURE** Listening test on a single modulated delay swept through (rate, depth, base-delay) grid.
**KEY TECHNIQUE** Mapped psychoacoustic boundaries: vibrato lives at <2 ms base-delay, 2–10 Hz, ≤0.5 ms depth; chorus at 5–25 ms base, 0.2–2 Hz, 1–4 ms depth; flange at 0–5 ms base + feedback. Crossover zones produce hybrids ("flangus").
**AUDIBLE RESULT** Quantified rule-of-thumb ranges that stop chorus presets from sounding like flangers and vice-versa.
**PLUGIN USE** Use as preset/limit table for chorus/flanger/vibrato controls — clamp depth and base ranges per mode toggle.
**CONTROLS** Mode (Vibrato/Chorus/Flanger), Rate (clamped per mode), Depth (clamped per mode).
**SIMPLIFIED IMPL** mode-table[mode] = {baseRange, rateRange, depthRange}; clamp UI sliders into ranges; show overlap zones as "Hybrid" indicator.

---

## 4. Pakarinen & Välimäki 2008 — Coefficient-Modulated First-Order Allpass as Distortion Effect
**PROBLEM** Want a non-clipping "distortion" that adds inharmonic, glassy partials for synth/drone use.
**DSP STRUCTURE** Single 1st-order allpass H(z) = (a + z⁻¹)/(1 + a·z⁻¹) with coefficient `a` modulated at audio rate by the input itself or a sidechain.
**KEY TECHNIQUE** Time-varying allpass coefficient creates frequency modulation of its phase response → produces sidebands without amplitude clipping; passivity preserved if |a|<1 instantaneously.
**AUDIBLE RESULT** Bell-like, FM-ish overtone bloom; pitched signals gain non-integer partials; no harshness from hard clipping.
**PLUGIN USE** "Spectral Drive" / inharmonic exciter; alt to waveshaper for clean-spectrum distortion.
**CONTROLS** Drive (coeff modulation depth), Bias (coeff offset), Source (self/sidechain/LFO), Tone (post HP).
**SIMPLIFIED IMPL** for n: a = bias + drive·x[n]; y = -a·x + xz1 + a·yz1; xz1=x; yz1=y;

---

## 5. Kleimola 2008 — Dispersion Modulation Using Allpass Filters
**PROBLEM** Static dispersion allpasses sound static; want pitch-bend/Doppler-like motion.
**DSP STRUCTURE** Cascade of N 1st/2nd-order allpasses whose coefficients are LFO-modulated together.
**KEY TECHNIQUE** Modulating allpass pole angle slides phase delay vs frequency → audible "rubber band" stretch of partials, similar to a fractional-delay sweep but spectrally selective.
**AUDIBLE RESULT** Glassy phaser cousin; chime/spring-like animated dispersion that can't be done with linear delay.
**PLUGIN USE** "Dispersion" effect (between phaser and pitch-shift); great inside guitar/spring/karplus loops.
**CONTROLS** Rate, Depth, Cascade Order (4–32), Pole Angle Center, Feedback (loop it for spring tone).
**SIMPLIFIED IMPL** N×APF1 cascade; angle_k = center_k + depth·LFO(); recompute coeffs each block.

---

## 6. N. Lee & J. O. Smith 2009 — Low-Order Allpass Interpolated Delay Loops
**PROBLEM** Thiran allpass interpolators give the cleanest fractional delay but are tricky to retune in a feedback loop without transient artifacts.
**DSP STRUCTURE** Recursive comb / Karplus-style delay loop where the integer delay is followed by a low-order (N=1 or 2) tunable allpass for the fractional part.
**KEY TECHNIQUE** Choose allpass coefficient so phase delay at the loop's resonant frequency equals the desired fractional sample delay; transient-suppression by ramping `a` over a few samples instead of jumping.
**AUDIBLE RESULT** Glitch-free pitch sweeps in plucked-string and resonator loops; far cleaner than Lagrange when modulating.
**PLUGIN USE** Karplus-Strong synths, comb resonator banks, modulated feedback delays where pitch must glide.
**CONTROLS** Pitch (sets D_total), Decay (loop gain), Slew (coefficient ramp time).
**SIMPLIFIED IMPL** D_total = fs/freq; D_int = floor(D_total - 0.5); frac = D_total - D_int; a = (1-frac)/(1+frac); ramp `a` over 64 samp on change.

---

## 7. Kleimola, Lazzarini, Välimäki, Timoney 2009 — Allpass Chain with Audio-Rate Coefficient Modulation
**PROBLEM** Pursue richer FM-like timbres without operator FM topology.
**DSP STRUCTURE** Series chain of 1st-order allpasses; each coefficient = base + depth·carrier(t); same modulation source feeds all stages.
**KEY TECHNIQUE** Audio-rate coefficient modulation in a cascade multiplies sideband generation — N stages produce richer sideband fans than N-operator FM with comparable CPU.
**AUDIBLE RESULT** Brassy/bell/metallic timbres from a single sine input; spectrally dense at modest mod depth.
**PLUGIN USE** "Spectral Modulator" effect; alt FM oscillator core for synth plugin.
**CONTROLS** Carrier Ratio, Mod Depth, Stage Count (1–16), Feedback.
**SIMPLIFIED IMPL** for stage k: ak = base + depth·sin(2π·ratio·n/fs); apply APF1; chain.

---

## 8. Raffel & Smith 2010 — Practical Modeling of Bucket-Brigade Device Circuits
**PROBLEM** Earlier BBD models neglected the input/output anti-alias filters and clock feed-through, missing the "dirty" character.
**DSP STRUCTURE** Discrete sample-and-hold chain at clock rate fc, surrounded by switched-capacitor anti-alias LP at input and reconstruction LP + compander at output.
**KEY TECHNIQUE** Run the BBD core at the BBD clock rate (variable), not at fs; resample on input via the modeled AA filter and on output via the reconstruction filter; compander (NE571-style) restores dynamic range and adds the program-dependent noise modulation.
**AUDIBLE RESULT** Authentic dark, lo-fi analog delay tone with chorus-like clock-noise modulation when delay is swept; pumping noise floor.
**PLUGIN USE** Foundation for analog delay (DM-2, Memory Man), Juno chorus, BBD flanger.
**CONTROLS** Clock Rate (sets delay), Compander Amount, AA Cutoff (chip type), Feedback.
**SIMPLIFIED IMPL** input → AA-LP → resample @ fc → N-stage delay (just N-sample buffer @ fc) → AA-LP → resample @ fs → expander; pre-compress symmetrically.

---

## 9. Norilo 2014 — Exploring the Vectored Time Variant Comb Filter
**PROBLEM** Standard comb feedback either rings stable or blows up; want musically expressive time-varying combs.
**DSP STRUCTURE** Multi-tap comb where the *tap-positions vector* is modulated as a unit (shifted/rotated/scaled), not independent LFOs.
**KEY TECHNIQUE** Treat tap delays as a vector in ℝᴺ and apply matrix transforms (rotation, scaling, permutation) per audio block — generates coherent harmonic motion instead of incoherent chorus blur.
**AUDIBLE RESULT** Animated, harmonically related resonant motion — between phaser, chorus, and pitch-shift; preserves comb pitch identity while sweeping spectrum.
**PLUGIN USE** Harmonic-aware modulation effect; resonator-bank automation.
**CONTROLS** Base Pitch, Vector Transform (Rotate/Scale/Shift), Rate, Depth, Feedback.
**SIMPLIFIED IMPL** taps = R(θ(t)) · taps0; each block recompute interpolated read positions; cubic interp; sum.

---

## 10. Välimäki, Bilbao, Smith, Abel et al. 2015 — Barberpole Phasing and Flanging Illusions
**PROBLEM** Real phaser/flanger sweeps reverse direction; user wants Shepard/Risset endless rising or falling.
**DSP STRUCTURE** Single-sideband modulation of LFO via Hilbert pair OR cascade of allpasses with logarithmically spaced, wrapping-frequency notches.
**KEY TECHNIQUE** Spread N notches/poles equally on log frequency axis; each crossfades-in at the bottom and -out at the top while sweeping upward — collective notch motion is endless.
**AUDIBLE RESULT** Infinite rising (or falling) flange/phase — psychoacoustic Shepard effect in the spectral domain.
**PLUGIN USE** "Barberpole Phaser/Flanger" mode; great for builds, risers, drones.
**CONTROLS** Rate, Direction (Up/Down), Notch Count, Width, Feedback.
**SIMPLIFIED IMPL** N stages; stage k center freq = exp(log(fmin) + ((k/N + t·rate) mod 1)·log(fmax/fmin)); amplitude = window((k/N + t·rate) mod 1) so notches fade at edges.

---

## 11. Werner, Dunkel, Smith 2016 — Hammond Vibrato/Chorus via Wave Digital Filters
**PROBLEM** The Hammond scanner-vibrato is a multi-tap LC delay line scanned mechanically; needs faithful chorus character (V1/V2/V3 + C1/C2/C3).
**DSP STRUCTURE** WDF model of the LC ladder (~19 taps) with a rotating scanner that interpolates between tap pairs; chorus mode mixes scanned + dry.
**KEY TECHNIQUE** WDF preserves the LC delay-line's frequency-dependent dispersion (which is why Hammond chorus is denser than plain modulated delay); scanner rate ≈7 Hz; chorus = scanned signal summed with un-scanned dry.
**AUDIBLE RESULT** Authentic shimmering Hammond chorus — slightly dispersive, unmistakable from BBD chorus.
**PLUGIN USE** Organ plugin chorus/vibrato switch; can be repurposed as a "rotating dispersion" effect on pads.
**CONTROLS** Mode (V1/V2/V3/C1/C2/C3), Scan Rate (fixed ≈7 Hz or sync), Depth.
**SIMPLIFIED IMPL** 18-section LC line via WDF series/parallel adaptors; scanner = fractional read across taps with cosine envelope; chorus mode: 0.5·dry + 0.5·scanned.

---

## 12. Huovilainen 2016 — Simulation of Analog Flanger Effect Using BBD Circuit
**PROBLEM** Analog flangers (MXR/Electric Mistress) get character from BBD compander + clock-noise + LFO non-linearity, not just from delay sweep.
**DSP STRUCTURE** BBD model (per Raffel/Holters) with VCO-driven clock; LFO drives a triangle/sine into a non-linear voltage→clock-rate mapping; high feedback path with soft saturation.
**KEY TECHNIQUE** LFO→clock mapping is exponential / non-linear → "scoop" sweep shape; compander pumping in feedback path produces the characteristic gritty regen.
**AUDIBLE RESULT** Liquid analog flange with the right LFO curvature and the regen "snarl" at high resonance.
**PLUGIN USE** Analog-flanger plugin; reuse VCO-mapping idea for any LFO that should feel "voltage-controlled".
**CONTROLS** Manual (clock center), Rate, Width, Regen, LFO Shape (Tri/Sin/Env).
**SIMPLIFIED IMPL** clock_hz = clock_center · exp(lfo_v · k_octaves); feed BBD chain; fb path: y = tanh(g·delayed) → compander → sum.

---

## 13. Kraft, Zölzer 2018 — Group Delay-Based Allpass Filters for Sound Synthesis & Effects
**PROBLEM** Designing allpass cascades by pole placement is unintuitive; designers think in terms of "delay vs frequency" curves.
**DSP STRUCTURE** Specify a target group-delay curve τ(ω); fit a cascade of 2nd-order allpasses (biquad APFs) to approximate it via least-squares on phase-derivative.
**KEY TECHNIQUE** Direct group-delay-domain design avoids hand-tuning poles; lets you draw a τ(ω) curve and instantiate the matching dispersion filter.
**AUDIBLE RESULT** Custom dispersion: thunder-roll, stretched plate, "metallic stretch" effects; tunable per-band delay.
**PLUGIN USE** Dispersion plate, transient stretcher, pre-reverb shaper, abstract "smear" effect.
**CONTROLS** GroupDelay Curve (drawable), Order, Mix, Feedback.
**SIMPLIFIED IMPL** sample target τ at K freqs; solve for biquad coefficients via Levinson or NLS; cascade biquad APFs.

---

## 14. Schlecht 2020 — Energy-Preserving Time-Varying Schroeder Allpass Filters
**PROBLEM** Modulating the coefficient of a Schroeder allpass (a, gain) in real time normally injects/removes energy → audible level pumping or instability when used in reverb diffusers or chorusing combs.
**DSP STRUCTURE** Re-parameterize the allpass as a 2D rotation matrix [cos θ, sin θ; -sin θ, cos θ] acting on the (input, state) pair → unitary transformation regardless of θ(t).
**KEY TECHNIQUE** Replace `g` with `cos θ` and the cross-term with `sin θ`; updating θ at any rate keeps total energy bounded → safe time-variant allpass.
**AUDIBLE RESULT** Modulated diffusers/chorusing without the "swelling" artifact; reverb tail can morph in real time without level glitches.
**PLUGIN USE** Animated reverb diffusers, time-varying chorus stages, modulated allpass loops, modal morphing.
**CONTROLS** Theta Rate, Theta Depth, Loop Length.
**SIMPLIFIED IMPL** read v = buf[D]; c=cos θ; s=sin θ; out = c·x + s·v; new = -s·x + c·v; buf write = new.

---

## 15. Schlecht, Habets, Välimäki 2022 — Flutter Echo Modeling
**PROBLEM** Flutter echo (the "tone" of two parallel walls — a buzzy, pitched echo train) is missing from standard reverb models; has both pitch and decay color.
**DSP STRUCTURE** Comb filter with very short delay (ms range) + a *tonal-shaping* feedback filter that mimics oblique-incidence absorption (low-frequency emphasis).
**KEY TECHNIQUE** Decompose flutter into (i) repetition rate (delay = 2L/c), (ii) per-bounce comb coloration (HF roll-off), (iii) modal pitch perception (ear hears the comb peaks as a pitch). Add small jitter to delay for realism.
**AUDIBLE RESULT** Authentic "stairwell"/"empty corridor" buzzy pitched echo on transients; complements diffuse reverb.
**PLUGIN USE** Layer with reverb to add "small hard-walled space" character; standalone "Flutter Echo" effect.
**CONTROLS** Wall Distance (sets delay), HF Damping, Jitter, Density (parallel combs), Mix.
**SIMPLIFIED IMPL** comb: y = x + g·HP/LPshelf(buf[D + jitter·noise]); D ≈ 5–30 samples for buzzy pitch.

---

## 16. Lee, Park, Kim 2025 — Antialiasing in BBD Chips Using BLEP
**PROBLEM** Modeling BBD as ideal sample-and-hold at clock rate fc aliases when fc is below fs/2 in the modeled-clock domain (chorus mode, sweeping).
**DSP STRUCTURE** Treat BBD output as a sequence of step transitions at clock-edges; insert polyBLEP/BLEP correction at each clock edge; resample to host fs.
**KEY TECHNIQUE** Reuse the oscillator-aliasing fix (BLEP) for the BBD's internal sampling-rate conversion; correction is applied in the clock-domain stream before AA reconstruction filter.
**AUDIBLE RESULT** Removes the high-frequency "fizz" aliasing of fast-modulated BBDs (Juno chorus at high rate); preserves authentic clock-feedthrough character.
**PLUGIN USE** Drop-in upgrade for any BBD/analog-delay plugin DSP.
**CONTROLS** None user-facing — internal AA quality switch.
**SIMPLIFIED IMPL** at each BBD clock edge, compute frac = edge_pos - floor; add polyBLEP(frac)·step_size to next 2 host samples; then apply reconstruction LP.

---

## REUSABLE PATTERNS — Delay Batch 1

1. **Modulated-delay primitive is universal.** One ModDelay class (interpolated read + LFO + feedback + diffusion) covers vibrato, chorus, flanger, slapback, pitch-shift, ambience — only parameter ranges change per mode.
2. **Per-tap incommensurate LFO sums** (slow + fast triangle/prime-rate pair) kill perceptual repetition in chorus.
3. **Hilbert-quadrature LFO pair** is the cheap, foolproof way to make a mono modulated delay sound stereo.
4. **Mode-clamped parameter ranges** (vibrato vs chorus vs flanger ranges per Lee 2006) prevent presets from feeling generic.
5. **Allpass coefficient modulation** is a clean (non-clipping) sideband generator — alternative to waveshaping for inharmonic excitement.
6. **Allpass-cascade audio-rate modulation** ≈ FM with smaller CPU and richer sideband fans than equivalent operator FM.
7. **Low-order allpass in delay loop** is the cleanest pitch-modulated delay; ramp the coefficient instead of jumping it.
8. **Ramp coefficients** (slew time = 32–256 samples) on every modulated filter to suppress click/zipper noise.
9. **BBD = SAH chain at variable clock rate, surrounded by AA + reconstruction LP + compander.** Variable clock = delay control.
10. **Companding (NE571-style)** in BBD/analog-delay paths gives the program-dependent noise floor and feedback "snarl"; symmetric pre-compress / post-expand.
11. **Exponential VCO mapping** (clock_hz = center · exp(lfo·k)) is essential for "voltage-controlled" feel of analog modulators; linear LFO→clock kills the vibe.
12. **WDF for LC delay lines** preserves the dispersion that makes Hammond/scanner chorus distinct from plain BBD chorus.
13. **Energy-preserving (rotation-form) allpass** [c,s;-s,c] makes any allpass safely time-variant — use whenever a coefficient modulates faster than a few Hz.
14. **Barberpole illusion** = log-spaced notches/poles with crossfade-in/out at edges; works on phaser, flanger, pitch — anywhere you have a sweepable spectral feature.
15. **Vectored / matrix-modulated tap positions** keep harmonic relationships intact when sweeping a comb (cleaner than independent per-tap LFOs).
16. **Group-delay-domain allpass design** lets you draw a τ(ω) curve and get a dispersion filter — more intuitive than pole placement for plate/spring/thunder/transient-stretch effects.
17. **Flutter echo = short comb + per-bounce shelf + jitter.** Adds "small hard room" character that diffuse reverbs miss.
18. **BLEP at the BBD clock edge** removes sweep-mode aliasing without killing the chip's character.
19. **Treat delay as the system, modulation as the genre.** All classic time effects emerge from where you place the read pointer and how you move it.
