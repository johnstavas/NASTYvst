# DAFx — DISTORTION / NONLINEAR — Batch 2

15 papers extending: WDF-advanced (grouped NL, OTA, diode-bridge, BJT, multi-tube cascading, time-varying reactances, full Bassman case), block-oriented black-box ID, Norton/CMOS waveshaper circuits, NeuralODE VA, and the next ADAA generation (frequency compensation, combined deriv/antideriv, interpolation filters, RNN-ADAA).

---

## 1. Holters, Parker 2017 — Generalizing Root Variable Choice in WDF with Grouped Nonlinearities
**PROBLEM** Default WDF root variable (wave-domain v) sometimes makes the multi-NL Newton system poorly conditioned — slow convergence or chatter.
**DSP STRUCTURE** Reformulate the root in terms of a chosen subset of wave variables (a, b, mix) per port; pick the formulation that minimizes Jacobian condition number.
**KEY TECHNIQUE** Symbolic analysis of the small NL system → choose port-variable per device that linearizes the dominant term; same circuit, faster solver, more iterations stable.
**PLUGIN USE** Embed in any WDF library to harden multi-NL distortion plugins (transistor pairs, tube push-pull).
**CONTROLS** None user.
**SIMPLIFIED IMPL** For each NL port: evaluate ∂g/∂a, ∂g/∂b; pick variable with largest |∂g/∂·|; reformulate residual.

---

## 2. Bernardini, Werner, Sarti, Smith 2017 — Modeling Circuits with OTAs Using WDF
**PROBLEM** OTAs (CA3080, LM13700) drive synth filters (Diode-ladder, OTA-ladder, MS-20) but classical WDF lacks an adaptor for the controlled-current behaviour.
**DSP STRUCTURE** Model OTA as voltage-controlled current source with hyperbolic-tan transfer; encapsulate as 3-port WDF block (V+, V-, Iout) with internal NL.
**KEY TECHNIQUE** OTA i_out = I_ABC·tanh((V+ − V−)/(2V_T)) implemented as a one-port NL inside a 3-port wave-adaptor; cascade for ladder topology.
**PLUGIN USE** OTA-based VCF/VCA emulations (Korg MS-20, Roland SH-101, JP-8 filter).
**CONTROLS** I_ABC (cutoff), Resonance (loop gain), Drive.
**SIMPLIFIED IMPL** OTA block: i = I_ABC·tanh((va−vb)/(2VT)); export as WDF current source.

---

## 3. Werner, Smith 2017 — WDF Modeling of Korg MS-50 Diode-Bridge VCF
**PROBLEM** Diode-bridge filter (MS-20/MS-50) has 4-diode coupled NL — defies single-NL WDF; classic models miss its scream/feedback character.
**DSP STRUCTURE** WDF tree with R-type adaptor handling the bridge (non-tree topology); 4-port NL root containing all 4 diodes solved jointly.
**KEY TECHNIQUE** R-type adaptor scattering matrix derived from bridge Kirchhoff laws; coupled diode Newton with analytic Jacobian → solver converges in ≤4 iter.
**PLUGIN USE** Korg-flavoured filter for synth/effect plugin; reuse for any bridge-rectifier topology.
**CONTROLS** Cutoff, Resonance, Drive.
**SIMPLIFIED IMPL** R-type adaptor S matrix; 4-diode root: solve f(v1..v4) = bridge_eq → Newton.

---

## 4. D'Angelo, Pakarinen 2017 — Germanium BJT Models for Real-Time Circuit Simulation
**PROBLEM** Germanium fuzz (Fuzz Face, Tone Bender) tone hinges on Ge BJT leakage and low-V_BE; standard Si Ebers-Moll models sound wrong.
**DSP STRUCTURE** Compare Ebers-Moll, Gummel-Poon, and reduced piecewise-linear Ge BJT models inside WDF Fuzz-Face circuit.
**KEY TECHNIQUE** Reduced Gummel-Poon with leakage current Iₛ_leak ≈ 1µA + temperature-dep V_T scaling captures the "thawing" warm-up tone; cheaper than full GP.
**PLUGIN USE** Vintage fuzz plugins; "germanium vs silicon" model toggle.
**CONTROLS** Bias, Temperature (drives leakage), Gain, Tone.
**SIMPLIFIED IMPL** I_C = Iₛ·(exp(V_BE/VT)−1) + I_leak·V_BE; per-sample WDF root Newton.

---

## 5. Pasini, Sarti, Bernardini 2018 — Real-Time WDF of Cascaded Vacuum Tube Amps via Modified Blockwise Method
**PROBLEM** Multi-stage tube amp (preamp → tonestack → power amp) blows CPU when each stage runs full WDF; need block-wise decoupling.
**DSP STRUCTURE** Process input in short blocks (32–64 samples); each stage's input/output buffered with one-block delay; intra-block WDF stays simple per stage.
**KEY TECHNIQUE** Block-decoupling injects ~0.7 ms latency but lets each WDF tree ignore downstream impedance — solver per stage is small/fast.
**PLUGIN USE** Multi-stage amp plugin where total CPU dominates; trade 1-block latency for 3-5× speed-up.
**CONTROLS** Per-stage gain/EQ.
**SIMPLIFIED IMPL** stage_buf[k] = WDF_stage_k(stage_buf[k−1]); fixed-load termination at each stage's output port.

---

## 6. Bernardini, Sarti 2018 — Modeling Time-Varying Reactances Using Wave Digital Filters
**PROBLEM** WDF assumes fixed L/C values; phasers, wahs, compressors have caps/inductors modulated by control voltages — naive coefficient updates inject energy.
**DSP STRUCTURE** Re-derive WDF reactance adaptor with explicit time-varying R_p(n); add an energy-correction term proportional to dR_p/dt.
**KEY TECHNIQUE** Energy-balance correction = small extra wave injection that compensates for the impedance change → no zipper / level pumping under modulation.
**PLUGIN USE** WDF phasers (MXR-90), wahs, modulated tone-stacks, compressors with VCA caps.
**CONTROLS** Modulation rate, depth, AA quality.
**SIMPLIFIED IMPL** R_p[n] = T/(2C[n]); b[n] = a[n] − dR_p_correction; energy-stable update.

---

## 7. Holters, Krüger, Zölzer 2016 — Fender Bassman 5F6-A WDF Case Study
**PROBLEM** Need a worked end-to-end WDF model of the canonical tweed amp (Bassman) for benchmarking and as a template.
**DSP STRUCTURE** Full circuit: 12AY7 input triode → cathode-follower → tonestack (Bass/Mid/Treble) → 12AX7 phase splitter → push-pull 6L6 + transformer.
**KEY TECHNIQUE** Modular WDF: each stage as a sub-tree with its own root NL; tone-stack as 4-port linear adaptor with knob-driven resistors.
**PLUGIN USE** Reference model for any tweed-style amp plugin; reuse stage modules for other tube amps.
**CONTROLS** Bass, Mid, Treble, Volume, Bright switch.
**SIMPLIFIED IMPL** Chain: TriodeStage → CFStage → ToneStack(B,M,T) → PhaseSplitter → PushPullPower → Output.

---

## 8. Eichas, Zölzer 2016 — Black-Box Modeling of Distortion via Block-Oriented Models
**PROBLEM** Want to clone an unknown overdrive pedal from input/output recordings without circuit knowledge.
**DSP STRUCTURE** Hammerstein-Wiener identification: pre-filter (FIR) → static curve (polynomial or LUT) → post-filter (FIR); fit by alternating LS / Wiener-Hammerstein iteration.
**KEY TECHNIQUE** Use exponential sine sweep + IR deconvolution to get linear FIRs; isolate static curve via mid-band single-tone sweep; iterate.
**PLUGIN USE** Pedal-cloning plugin, "capture mode"; lighter than full neural model.
**CONTROLS** Drive (scales pre-filter gain), Tone (post-filter LP).
**SIMPLIFIED IMPL** y = postFIR( shaper( preFIR(x · drive) ) ); shaper = Σ aₖ·xᵏ or LUT.

---

## 9. Holters, Parker 2018 — Waveshaping with Norton Amplifiers: Modeling the Serge Triple Waveshaper
**PROBLEM** Serge Triple Waveshaper uses Norton (current-input) op-amps → exotic transfer curves not in any pedal cookbook.
**DSP STRUCTURE** WDF model of LM3900 Norton amp + diode network; outputs three simultaneous shaped versions (full-wave, half-wave, custom curve).
**KEY TECHNIQUE** Norton amp = current-mirror difference at inverting input → naturally produces signed full-wave / asymmetric folding without precision-rectifier hacks.
**PLUGIN USE** Wavefolder plugin; "West Coast" synth FX; harmonic exciter with three flavours.
**CONTROLS** Drive, Bias (asymmetry), Mix (3 outputs).
**SIMPLIFIED IMPL** WDF: current-mirror block + diode pairs; outputs = {|x|, max(0,x)+offset, custom-piecewise}.

---

## 10. Esqueda, Pukki, Välimäki 2020 — Taming the Red Llama: Modeling a CMOS-Based Overdrive
**PROBLEM** Red Llama uses CMOS inverter (CD4049) for distortion — gives rounder, "tube-like" clipping but standard WDF tube/diode models don't fit.
**DSP STRUCTURE** WDF circuit + CMOS inverter NL = tanh-style transfer with V_DD-dependent supply rail; accurate for low-V_DD "starve" mode.
**KEY TECHNIQUE** Model CMOS inverter as I = β·((V_in - V_th)² - (V_DD - V_in - V_th_p)²); drops out-of-range terms; smooth knee = "tube-like" character.
**PLUGIN USE** Vintage CMOS-overdrive plugin; "starve" knob exposes V_DD as user param for sag.
**CONTROLS** Drive, V_DD (Sag), Tone, Output.
**SIMPLIFIED IMPL** y = clamp_to_VDD((β/2)·sign·(V_in − V_th)²) inside WDF gain stage.

---

## 11. Parker, Esqueda, Bergner 2022 — VA Modeling of Distortion Circuits Using Neural ODEs
**PROBLEM** Black-box LSTM amp models lose physical interpretability and don't generalize to unseen knob values.
**DSP STRUCTURE** Neural ODE: dv/dt = NN(v, x, knobs); solver (RK4/Trapezoidal) integrates per sample; NN learns the circuit's continuous-time dynamics.
**KEY TECHNIQUE** Encodes ODE structure in the model → smaller NN than discrete LSTM, smoother knob interpolation, easier ADAA-style aliasing control.
**PLUGIN USE** Knob-continuous neural amp model; ADAA-friendly alternative to LSTM/TCN black-box.
**CONTROLS** All emulated circuit knobs (continuous).
**SIMPLIFIED IMPL** v[n] = RK4(v[n−1], x[n], NN, knobs, dt=1/fs).

---

## 12. Bilbao, La Pastina 2022 — ADAA with Frequency Compensation for Stateful Systems
**PROBLEM** Stateful ADAA (Bilbao 2019) introduces a small low-pass tilt at high frequencies — audible dulling on bright sources.
**DSP STRUCTURE** Add a complementary high-shelf compensator after the ADAA stage to flatten the inadvertent LP roll-off.
**KEY TECHNIQUE** Derive analytic LP error introduced by ADAA averaging; design 1st-order high-shelf inverse; tiny CPU.
**PLUGIN USE** Drop-in upgrade for any plugin using stateful ADAA — restores top-end clarity.
**CONTROLS** None user.
**SIMPLIFIED IMPL** y = HShelf(adaa_stage(x)); shelf coeffs precomputed per fs.

---

## 13. La Pastina, Bilbao 2022 — Combined Derivative / Antiderivative Antialiasing
**PROBLEM** ADAA fights aliasing from high-derivative segments; DAA (derivative-AA) fights aliasing from sharp corners (clip break-points). Each leaves artifacts the other doesn't.
**DSP STRUCTURE** Hybrid: detect locally-large derivative → switch to ADAA; detect break-point crossing → switch to DAA; weighted blend in transition.
**KEY TECHNIQUE** Per-sample classifier (max(|dv|, |Δslope|)) selects which AA path runs; combined error 6–10 dB lower than either alone on hard-clip+folder cascades.
**PLUGIN USE** Wavefolders, hard-clippers chained with stateful filters where neither AA flavour suffices alone.
**CONTROLS** AA Quality (off / standard / combined).
**SIMPLIFIED IMPL** if break_in_segment: y = DAA(...); else: y = ADAA(...); crossfade in ε-band.

---

## 14. Najnudel, Holters, Bilbao 2024 — Interpolation Filters for Antiderivative Antialiasing
**PROBLEM** ADAA quality limited by how trajectory between samples is interpolated — linear assumption is the dominant error source.
**DSP STRUCTURE** Replace implicit linear v(t) trajectory with a higher-order polynomial / spline interpolant; integrate the antiderivative analytically over the new trajectory.
**KEY TECHNIQUE** Cubic Hermite interpolation between v[n-1], v[n], v[n+1] gives ~12 dB extra alias reduction at fixed CPU; closed-form ∫F(v(t))dt available for low-order polynomials.
**PLUGIN USE** Higher-quality saturator plugin; replaces 2nd-order ADAA with cubic-trajectory ADAA at similar cost.
**CONTROLS** AA Order (linear / cubic).
**SIMPLIFIED IMPL** v(τ) = Hermite(v_prev, v); y = ∫₀¹ f(v(τ))dτ — closed form for cubic + polynomial f.

---

## 15. Carson, Damskägg, Wright, Välimäki 2025 — Antiderivative Antialiasing for Recurrent Neural Networks
**PROBLEM** Neural amp models with recurrent hidden state can't directly use memoryless ADAA — state evolves between samples.
**DSP STRUCTURE** Apply ADAA to each activation function inside the RNN cell; integrate hidden-state update with sub-sample antiderivative trick from Bilbao 2019.
**KEY TECHNIQUE** Replace `tanh(W·h + U·x)` with ADAA-tanh fed by the linearly-interpolated argument; preserves training-time weights, modifies only inference.
**PLUGIN USE** NAM, GuitarML, Proteus, any RNN amp plugin → drop-in alias reduction (~10 dB) without retraining or oversampling.
**CONTROLS** None user.
**SIMPLIFIED IMPL** for each activation a = act(z): replace with (F_act(z) - F_act(z_prev))/(z - z_prev); cache z_prev per neuron.

---

## REUSABLE PATTERNS — Distortion Batch 2

1. **Choose WDF root variable per circuit** to minimise Jacobian condition number — slow Newton convergence is usually a wrong-variable problem, not a math problem.
2. **OTA = controlled current source with tanh transfer**, modeled as one-port NL inside a 3-port WDF adaptor — opens MS-20/SH-101/JP-8 filter emulations.
3. **R-type WDF adaptor** is required for any non-tree topology (diode bridges, Wheatstone, transformer secondaries).
4. **Germanium BJT ≠ Silicon BJT** — must include leakage current and temperature-dep V_T; this is what makes Ge fuzz "warm up".
5. **Block-wise WDF decoupling** trades 1-block latency for 3–5× speed in cascaded multi-stage tube amps; acceptable for guitar plugins.
6. **Time-varying reactances need energy-correction term** in the WDF adaptor — naive coefficient updates pump level and zipper.
7. **Tone-stack as a 4-port linear adaptor with knob-driven resistors** is the clean way to expose Bass/Mid/Treble in WDF amp plugins (Bassman, Marshall).
8. **Hammerstein-Wiener (preFIR → static curve → postFIR)** is the right structure for *cloning* unknown distortion units from input/output recordings.
9. **Norton (current-input) op-amps** = natural full-wave / asymmetric folding without precision-rectifier complexity.
10. **CMOS inverter (CD4049/CD4069)** distortion gives a tube-like rounded knee with V_DD as a "sag/starve" knob — a plugin-friendly alternative to triode emulation.
11. **Neural ODE = continuous-time NN circuit model** — smaller, knob-interpolatable, ADAA-friendly versus discrete LSTM.
12. **Stateful ADAA leaves a HF tilt** — pair with a 1st-order high-shelf inverse to keep top end intact.
13. **ADAA + DAA combined** — switch by max(|dv|, |Δslope|); each AA flavour wins on different signal segments.
14. **Cubic-Hermite trajectory inside ADAA** ≈ 12 dB alias reduction over linear-trajectory ADAA at same CPU.
15. **ADAA on RNN activations** drops into trained models without retraining; cache per-neuron z_prev.
16. **Per-circuit modular WDF stage library**: Triode, CathodeFollower, ToneStack, PhaseSplitter, PushPullPower, OTA, BJT, MOSFET — assemble new amps by recombining vetted blocks.
17. **Sweep + deconv + iterate** is the canonical recipe for capturing real units (Hammerstein-Wiener identification).
18. **Knob continuity matters more than instantaneous accuracy** for plugins — Neural ODE / parametric WDF beat black-box LSTM on automation feel.
19. **AA cascade**: choose 1) curve smoothness (tanh-sum > polynomial > clip), 2) ADAA order/trajectory, 3) interpolation filter, 4) post-shelf compensation — each tier ≈ 6–12 dB alias improvement.
20. **Cloning vs simulation hierarchy**: parametric WDF (highest control) → Hammerstein-Wiener (cheap clone) → Neural ODE (best knob interp) → black-box RNN (highest fidelity, weakest extrapolation). Pick by use case.
