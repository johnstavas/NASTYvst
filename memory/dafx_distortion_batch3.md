# DAFx — DISTORTION / NONLINEAR — Batch 3

15 papers covering specific-pedal / specific-unit emulations (Fairchild 670, MXR Phase 90 ×2 generations, Uni-Vibe, Rangemaster, Ibanez Wah, diode + transistor ring mods), waveshaping/phase-shaping methods, Chebyshev sweep identification, Quadric tube model, MorphDrive latent conditioning, diode-VCA, Lipschitz-bounded NN inside WDF, and port-Hamiltonian circuit identification.

---

## 1. Werner, Smith 2012 — Toward a WDF Model of the Fairchild 670 Limiter
**PROBLEM** Fairchild 670 = legendary tube limiter; its tone comes from variable-mu 6386 tubes whose gain depends on grid bias from a sidechain detector. No clean DSP model existed.
**DSP STRUCTURE** WDF tube stage where bias V_g is driven by a sidechain envelope (rectifier + RC); 6386 modeled as Norman-Koren with bias-modulated μ.
**KEY TECHNIQUE** Variable-mu = gain reduction without conventional VCA — modulate triode operating point so harmonic distortion grows with compression amount.
**PLUGIN USE** Vintage tube-limiter plugin; "knee" of compression character is harmonic-shift driven.
**CONTROLS** Threshold, Time Constant, Input Drive, AGC slope.
**SIMPLIFIED IMPL** env = LP(|x|); V_g = bias + slope·env; WDF triode stage with V_g modulated per sample.

---

## 2. Eichas, Möller, Zölzer 2014 — Physical Modeling of the MXR Phase 90
**PROBLEM** Phase 90 uses 4 JFET-as-variable-resistor allpass stages driven by triangle LFO; standard "ideal allpass cascade" misses JFET nonlinearity and bias drift.
**DSP STRUCTURE** 4× WDF allpass stages; each JFET = nonlinear voltage-controlled resistor R_DS(V_GS, V_DS); LFO drives V_GS.
**KEY TECHNIQUE** R_DS = R_DS_on / (1 - V_GS/V_p); audio-rate V_DS dependence adds 2nd-harmonic colour absent from ideal phaser.
**PLUGIN USE** Authentic MXR-90 phaser plugin; R_DS NL adds the "warm" character vs sterile DSP phaser.
**CONTROLS** Rate, Depth, Feedback (Script switch), Drive.
**SIMPLIFIED IMPL** per stage: R[n] = R0/(1 − V_GS[n]/Vp); APF1 with τ = R[n]·C; LFO → V_GS.

---

## 3. Wright, Albertini 2024 — WDF Model of MXR Phase 90 via Time-Varying Resistor JFET Approximation
**PROBLEM** 2014 model required per-sample Newton on JFET NL — too costly for low-CPU plugin instances.
**DSP STRUCTURE** Approximate JFET as pure linear-time-varying resistor (drop V_DS dependence); use Bernardini 2018 energy-correction for time-varying R inside WDF.
**KEY TECHNIQUE** Linearization gives 5–10× speed-up; energy correction prevents the modulation pumping; harmonic loss vs full NL is small in the LFO regime.
**PLUGIN USE** Mobile / multi-instance phaser; same plugin code, lighter mode toggle.
**CONTROLS** Rate, Depth, Quality (NL vs LTV).
**SIMPLIFIED IMPL** R[n] = LUT(V_LFO[n]); WDF APF with energy-corrected R update each sample.

---

## 4. Eichas, Zölzer 2019 — Digital Grey-Box Model of the Uni-Vibe Effects Pedal
**PROBLEM** Uni-Vibe = 4 staggered photo-resistor allpass stages driven by an incandescent lamp + LFO; lamp thermal lag and photoresistor non-linearity produce its unique "swirl".
**DSP STRUCTURE** Grey-box: WDF allpass cascade with photoresistor R(t) modeled as R(t) = R∞ + (R0 − R∞)·exp(−t/τ_lamp); per-stage offset between lamp positions.
**KEY TECHNIQUE** Lamp thermal RC (τ ≈ 50–200 ms) low-passes the LFO triangle into a smoother, asymmetric curve; *staggered* offsets per stage (not synchronous like Phase 90) creates the chorus-like depth.
**PLUGIN USE** Authentic Uni-Vibe / Shin-ei plugin; reuse "lamp-photoresistor" pattern for any opto-modulated effect.
**CONTROLS** Rate, Depth, Vibrato/Chorus mode.
**SIMPLIFIED IMPL** lamp[n] = LP_thermal(LFO[n]); R_k[n] = lamp[n] + offset_k; APF cascade.

---

## 5. Eichas, Möller, Zölzer 2016 — Physical Model Parameter Optimisation: Dallas Rangemaster Treble Booster
**PROBLEM** Rangemaster character depends on aging Ge transistor with poorly-known parameters (β, V_BE, leakage); literature values give wrong tone.
**DSP STRUCTURE** WDF circuit with parametrised Ge BJT; gradient-descent on parameter vector to minimize spectral error vs measured pedal output for sine sweeps.
**KEY TECHNIQUE** Differentiable WDF (manual Jacobian) → automated parameter ID per real unit; capture vintage-pedal-by-pedal variation.
**PLUGIN USE** "Capture" workflow for Ge fuzz/booster pedals; ship multiple "real-unit" presets per circuit.
**CONTROLS** Treble, Boost; preset = unit ID.
**SIMPLIFIED IMPL** loop: simulate WDF with θ; loss = ||spec(out) − spec(target)||; θ ← θ − lr·∇loss.

---

## 6. Holters, Möller, Zölzer 2015 — Digitizing the Ibanez Weeping Demon Wah Pedal
**PROBLEM** Wah pedals are RLC bandpass with inductor + transistor buffer; the inductor's iron-core saturation and buffer NL shape the iconic "vowel".
**DSP STRUCTURE** WDF: input cap → BJT buffer → series-RLC tank with potentiometer-driven Q → output stage.
**KEY TECHNIQUE** Inductor modeled as nonlinear L(I) = L0/(1 + α·|I|) — saturation at high signal levels lowers Q and softens peak; pot taper modeled as exp curve.
**PLUGIN USE** Wah / auto-wah plugin with realistic pedal-position taper and dynamic-Q response.
**CONTROLS** Pedal Position, Q, Drive, Range.
**SIMPLIFIED IMPL** WDF tank with L[n] = L0/(1+α·|I[n−1]|); pot resistor = R_max·exp(−k·position).

---

## 7. Hoffmann, Pakarinen 2008 — Digital Simulation of the Diode Ring Modulator
**PROBLEM** Diode ring mod (Bode/Buchla/EMS) gives non-ideal, harmonic-rich modulation; ideal multiplier sounds wrong.
**DSP STRUCTURE** WDF bridge of 4 diodes with carrier+signal transformers; carrier saturates the diodes → switching-function multiplication with aperture/leakage.
**KEY TECHNIQUE** Replace ideal x·c with switching function s(c) ≈ tanh(c/Vt) where Vt sets the rounding; result = x · tanh(c/Vt) + bleed terms.
**PLUGIN USE** Vintage ring-mod plugin; "vintage-ness" knob = Vt control (sharp ideal → rounded soft).
**CONTROLS** Carrier Freq, Drive, Vintage (Vt).
**SIMPLIFIED IMPL** y = x · tanh(c/Vt) + ε_bleed·(x + c).

---

## 8. Stilson, Smith 2009 — Asymmetries Make the Difference: Transistor-Based Analog Ring Modulators
**PROBLEM** Transistor-pair ring mods (Korg MS-50, EMS Synthi) sound different from diode ring mods — analysis missing.
**DSP STRUCTURE** Differential transistor pair with carrier on bases, signal on emitters; output = collector difference.
**KEY TECHNIQUE** Slight β/V_BE mismatch between pair → asymmetric carrier feedthrough + 2nd-harmonic injection — this asymmetry is the audible signature.
**PLUGIN USE** "Transistor RM" mode toggle next to "Diode RM"; expose mismatch as "Drift" knob.
**CONTROLS** Carrier, Mismatch (β1/β2 ratio), Drift.
**SIMPLIFIED IMPL** y = β1·tanh((c+x)/2VT) − β2·tanh((c−x)/2VT); mismatch β1≠β2 → asymmetric harmonics.

---

## 9. Tan, Lazzarini, Timoney 2010 — Digital Emulation of Distortion Effects by Wave and Phase Shaping
**PROBLEM** Pure waveshaping = limited harmonic options; phase-shaping (PWM-like phase modulation pre-shaper) opens spectra without circuit modeling.
**DSP STRUCTURE** Pipeline: input → phase shaper f_ψ(φ) (warps oscillator phase) → wave shaper f_w(sin(2π·f_ψ(φ))) → output.
**KEY TECHNIQUE** Two-stage shaping decouples odd/even harmonic balance from spectral envelope: phase shaper picks harmonic ratios, wave shaper picks brightness. Cheap, no NL solver.
**PLUGIN USE** Synth-distortion / "abstract drive" effect with two-knob harmonic control.
**CONTROLS** Phase Shape (skew), Wave Shape (clip type), Mix.
**SIMPLIFIED IMPL** φ' = φ + d·sin(2πφ); y = clip(sin(2πφ'), drive).

---

## 10. Novak, Simon, Lotton 2010 — Chebyshev Model and Synchronized Swept Sine for Nonlinear Audio Effect Modeling
**PROBLEM** Identify a nonlinear system's harmonic kernels from a single sweep — standard Volterra ID needs many measurements.
**DSP STRUCTURE** Excite with synchronized exponential sine sweep; deconvolve output to separate per-harmonic IRs (1st = linear, 2nd = h₂, ...); each kernel = LTI filter.
**KEY TECHNIQUE** Synchronized sweep (Farina-style with exact-octave timing) makes harmonic IRs appear at predictable time-offsets in deconvolution → trivial separation.
**PLUGIN USE** Pedal-capture workflow; convert single-sweep recording → Chebyshev-Hammerstein model.
**CONTROLS** N harmonics captured.
**SIMPLIFIED IMPL** sweep = exp_sweep; rec = play(sweep) thru pedal; ir_k = deconv(rec, sweep) windowed at offset_k; model: y = Σ chebyshev_k(x) * ir_k.

---

## 11. Albertini, D'Angelo et al. 2023 — A Quadric Surface Model of Vacuum Tubes for Virtual Analog Applications
**PROBLEM** Norman-Koren tube model has discontinuous derivatives at cutoff → solver issues + audible kinks at low V_g.
**DSP STRUCTURE** Replace I_p formula with a single quadric surface I_p = a·V_g² + b·V_g·V_p + c·V_p² + d·V_g + e·V_p + f, fit to measured tube data.
**KEY TECHNIQUE** C∞ smooth analytic surface → cleaner Newton convergence + ADAA-compatible (analytic ∫); compact 6-coefficient model per tube.
**PLUGIN USE** Drop-in replacement for Norman-Koren in any tube WDF/state-space plugin; better ADAA, fewer iter.
**CONTROLS** Tube Type (preset coefficients).
**SIMPLIFIED IMPL** I_p = clip0(a·Vg² + b·Vg·Vp + c·Vp² + d·Vg + e·Vp + f).

---

## 12. Comunità et al. 2025 — MorphDrive: Latent Conditioning for Cross-Circuit Effect Modeling
**PROBLEM** Each pedal needs its own neural model — can't morph between Tube Screamer and DS-1 in one plugin.
**DSP STRUCTURE** Encoder-conditioned RNN/TCN where pedal identity = learned latent vector z; decoder = single shared neural model conditioned on (x, knobs, z).
**KEY TECHNIQUE** Train on a parametric dataset of multiple pedals; latent space lets users interpolate between pedal types in real time → "morph" knob.
**PLUGIN USE** Multi-pedal "morphdrive" plugin with continuous pedal-style selector + traditional knobs.
**CONTROLS** Drive, Tone, Style (latent dim 1), Character (latent dim 2).
**SIMPLIFIED IMPL** y = NN(x, [drive,tone, z_x, z_y]); z_x,z_y = user interp.

---

## 13. Najnudel, Holters et al. 2025 — Real-Time Virtual Analog Modelling of Diode-Based VCAs
**PROBLEM** Diode VCA (CA3080, BA6110-style) has signal-dependent distortion absent from textbook OTA-VCA models.
**DSP STRUCTURE** WDF with diode-pair input attenuator driven by control current I_C; diode forward voltages clip large signals before reaching the gain core.
**KEY TECHNIQUE** Signal pre-clip is *current-dependent* — control signal modulates the clipping threshold → "VCA distortion that opens with gain".
**PLUGIN USE** Synth/effect VCA plugin where output crunch grows with envelope amplitude; modular-style colour.
**CONTROLS** CV input, Drive, Bleed.
**SIMPLIFIED IMPL** v_in_lim = sign(v)·min(|v|, V_T·log(I_C/Is)); y = G(I_C)·v_in_lim.

---

## 14. Pasini, Bernardini et al. 2024 — WDF of Circuits with Multiple One-Port Nonlinearities Using Lipschitz-Bounded Neural Networks
**PROBLEM** Putting NN into WDF root risks instability — unbounded NN outputs can break passivity / Newton convergence.
**DSP STRUCTURE** Constrain each NN one-port to Lipschitz-bounded architecture (spectral-norm-clipped weights); jointly solve coupled NN one-ports inside WDF root.
**KEY TECHNIQUE** Lipschitz constant L < 1/h (h = step-size) guarantees Banach contraction → fixed-point iteration converges; replaces Newton with simple iteration.
**PLUGIN USE** Multiple-NL neural pedal plugins (transistor pairs + diode networks captured by NN) with provable stability.
**CONTROLS** Pedal preset (NN weights).
**SIMPLIFIED IMPL** for each NN port: enforce ||W||_2 ≤ L during training; runtime: fixed-point iteration v ← g_NN(v).

---

## 15. Falaize, Hélie 2021 — Identification of Nonlinear Circuits as Port-Hamiltonian Systems
**PROBLEM** Most NL circuit DSP isn't energy-conservative; numerical drift / passivity loss appear under modulation.
**DSP STRUCTURE** Reframe circuit as port-Hamiltonian system: dx/dt = (J − R)·∇H(x) + B·u, with energy H, dissipation R, ports B; discretize via discrete-gradient method that preserves H exactly.
**KEY TECHNIQUE** Energy-preserving discretization → guaranteed passive numerics regardless of step-size or NL strength → no blowup, no parasitic damping.
**PLUGIN USE** Stable backbone for any high-feedback NL plugin (oscillating filters, fuzz with large feedback, modal+NL physical instruments).
**CONTROLS** Per-circuit parameters.
**SIMPLIFIED IMPL** discrete grad ∇̄H = (H(x_{n+1})−H(x_n))/(x_{n+1}−x_n); update x_{n+1} via implicit solve preserving H.

---

## REUSABLE PATTERNS — Distortion Batch 3

1. **Variable-mu compression** (bias modulation of triode μ) is a one-stage device that combines gain reduction + harmonic generation — Fairchild/Vari-Mu signature.
2. **JFET as VCR** in allpass stages = Phase 90 / Univibe colour; cheap LTV approximation viable when V_DS swing is small.
3. **Lamp + photoresistor opto-modulator** = thermal LP on the LFO + per-stage offset = Uni-Vibe swirl. Reuse for opto-compressors and ENV-modulated effects.
4. **Differentiable WDF + gradient descent on real measurements** = automated capture of vintage Ge / op-amp pedals; ship per-unit presets.
5. **Wah = nonlinear inductor + BJT buffer**, not just parametric BPF; iron-core saturation lowers Q at high level → dynamic vowel.
6. **Diode ring mod = x · tanh(c/Vt) + small bleed** — Vt knob controls "ideal ↔ vintage rounded".
7. **Transistor-pair ring mod asymmetry (β1≠β2)** is the audible signature distinguishing it from diode RM — expose as "Drift".
8. **Wave + Phase shaping cascade** decouples harmonic ratio (phase) from brightness (wave) — two-knob abstract drive.
9. **Synchronized exponential sweep + per-harmonic deconv** = single-shot Hammerstein-Chebyshev capture; the standard pedal-cloning measurement.
10. **Quadric surface (6-coeff smooth)** beats Norman-Koren for tube I-V — better ADAA + Newton convergence; fit per-tube to data.
11. **Latent-conditioned NN** = one model, many pedals; expose latent as "style/character" knobs for Morph effects.
12. **Diode-VCA crunch grows with control voltage** — current-dependent input clip; gives "louder = dirtier" vibe in synth chains.
13. **Lipschitz-bounded NN** as WDF one-port → provable stable fixed-point iteration; necessary for any NN-in-circuit production code.
14. **Port-Hamiltonian / discrete-gradient discretization** for high-feedback / oscillating circuits — guaranteed energy-passive numerics, no blow-up.
15. **Pedal personality recipe**: identify (a) the pre-EQ, (b) the active device(s) with their drift/aging params, (c) the tone-stack, (d) the post-EQ. Each modulates the same shaping core differently.
16. **Generation hierarchy of a unit's plugin model**: ideal-DSP (bad) → parametric WDF (best fidelity, slow knob automation) → grey-box (fast, captures key NLs) → black-box / latent NN (capture-driven, generalizes via training data) → port-Hamiltonian (best for unstable / extreme settings).
17. **Use the cheapest model that beats the perceptual threshold** — full WDF only when ABX testing shows it matters; otherwise grey-box or LUT.
18. **Energy-correction is the universal fix** for time-variant elements (caps, inductors, resistors) inside WDF — without it, modulation pumps level.
19. **Photoresistor / lamp / iron core / Ge BJT** all share the same DSP archetype: a slow nonlinear control element shaping a fast audio path — model the slow path with thermal/hysteresis LP, the fast path with WDF.
20. **Ship one DSP, swap the data**: latent-NN, captured-Hammerstein, and parametric WDF all admit a "preset = unit ID" UX — design the plugin around this from day one.
