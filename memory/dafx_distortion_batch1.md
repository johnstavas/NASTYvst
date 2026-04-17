# DAFx — DISTORTION / NONLINEAR — Batch 1

15 foundational papers covering: diode/tube/transistor circuit models (ODE + WDF + state-space), Volterra series for weakly-nonlinear circuits, the antiderivative-antialiasing (ADAA) family (memoryless → stateful → IIR-arbitrary-order → polynomial → nonlinear-WDF), and neural amp modeling (WDF-embedded NN + smoothing activations for alias reduction).

Skipped here (will revisit): MIR/codec/speech papers; instrument-physics nonlinearity (collisions, plate, bowed string); ring modulators; phaser/wah pedals (own batch later); Volterra-identification math papers.

---

## 1. Schattschneider, Zölzer 1999 — Discrete-Time Models for Nonlinear Audio Systems
**PROBLEM** Need a unified taxonomy for digitally implementing analog nonlinearities (preamps, fuzz, soft clip, tube).
**DSP STRUCTURE** Block taxonomy: (a) memoryless waveshaper f(x); (b) Hammerstein f(x) → LTI; (c) Wiener LTI → f(x); (d) Hammerstein-Wiener LTI₁ → f(x) → LTI₂; (e) Volterra kernel.
**KEY TECHNIQUE** Most "amp tone" reduces to **Wiener-Hammerstein**: input EQ pre-filter → static curve → output cab/tone filter. Pre-filter shapes which frequencies see most distortion, post-filter shapes harmonic envelope.
**AUDIBLE RESULT** Same waveshaper f(x) sounds bright/buzzy or dark/woolly purely by changing pre/post filters.
**PLUGIN USE** Architectural template for all "drive/saturator" plugins; expose Tilt-EQ-like pre and post controls.
**CONTROLS** Pre HP/LP (pre-emphasis), Drive (input gain), Curve (f), Post LP/HP (de-emphasis), Mix.
**SIMPLIFIED IMPL** y = LTI_post(f(LTI_pre(x · drive)))

---

## 2. Yeh, Abel, Smith 2007 — Simulation of the Diode Limiter via Numerical ODE Solution
**PROBLEM** Soft-clip op-amp+diode-pair (DS-1, TS9 clipping stage) is implicit (Shockley equation transcendental); naive memoryless tanh misses the RC behavior.
**DSP STRUCTURE** Op-amp + feedback diode pair = first-order ODE: C·dv/dt + (v - vin)/R + 2·Is·sinh(v/Vt) = 0; solved per-sample.
**KEY TECHNIQUE** Trapezoidal-rule discretization → implicit equation per sample → Newton-Raphson (3–5 iters) or one-shot Lambert-W; cache as 1D LUT for speed.
**AUDIBLE RESULT** Frequency-dependent soft clipping with proper "compressed-then-clipped" attack — sounds like the actual circuit, not a static curve.
**PLUGIN USE** Diode-clipper stage of any overdrive/distortion pedal model.
**CONTROLS** Drive, Tone (post LP), Symmetry (1 vs 2 diodes one direction).
**SIMPLIFIED IMPL** Per sample solve f(v) = (v-vin)/R + 2Is·sinh(v/Vt) + C·(v-v_prev)·2/T = 0 via Newton; or precompute v = LUT[vin, v_prev].

---

## 3. Yeh, Abel, Smith 2007 — Simplified Physically-Informed Models of Distortion / Overdrive Pedals
**PROBLEM** Full SPICE-level pedal models too expensive; want plugin-grade approximations of TS9 / DS-1 / Big Muff that still capture circuit topology.
**DSP STRUCTURE** Per-pedal: input HP (capacitor coupling) → op-amp gain stage with diode feedback (= soft-clip ODE from #2) → tone-stack filter → output LP.
**KEY TECHNIQUE** Reduce circuit to chain of (filter → static-or-ODE nonlinearity → filter) blocks. Each pedal's character lies in the *EQ around* the clipping stage, not the clipping curve itself.
**AUDIBLE RESULT** Recognizable TS9 mid-hump, DS-1 scoop, Big Muff sustain — all from the same diode-clipper core with different EQs.
**PLUGIN USE** Multi-pedal "drive" plugin with model selector; each model = (pre-EQ, clip type, tone-stack) tuple.
**CONTROLS** Drive, Tone, Level, Model (pedal type).
**SIMPLIFIED IMPL** PRESETS = {TS9: {pre=LP@720, clip=2-diode-asym, tone=Sallen-Key, post=LP@6k}, DS1: {...}, BigMuff: {...}}.

---

## 4. Hélie 2006 — Volterra Series for Real-Time Simulation of Weakly Nonlinear Analog Devices: Moog Ladder
**PROBLEM** Want analytic decomposition of a mildly nonlinear circuit (Moog ladder) into a linear part + harmonic-distortion correction terms — no iterative solver.
**DSP STRUCTURE** 3-term Volterra series H₁(ω) + H₂(ω₁,ω₂) + H₃(...); each kernel = multidim transfer function discretized as cascaded linear filters fed by signal-products.
**KEY TECHNIQUE** Truncate to order 3–5; compute kernels symbolically from circuit equations; implement as parallel branches: branch₁ = LTI(x), branch₂ = LTI(x·LTI(x)), etc.
**AUDIBLE RESULT** Captures the warm 2nd/3rd-order distortion + self-oscillation onset of Moog ladder without per-sample Newton iteration.
**PLUGIN USE** Filter-with-character (Moog/MS20/SEM) when input drive is moderate; cheaper than full WDF.
**CONTROLS** Cutoff, Resonance, Drive (scales the kernel branches).
**SIMPLIFIED IMPL** y = H1*x + drive·H2*(x·H1*x) + drive²·H3*(...); each H_n is a precomputed linear filter.

---

## 5. Holters, Parker, Zölzer 2008 — Simulating Distortion Circuits Using WDF + Nonlinear State-Space
**PROBLEM** Pure WDF can't easily handle multi-port / coupled nonlinearities (e.g., transistor + diode in same loop); state-space alone loses the modular topology of WDF.
**DSP STRUCTURE** Hybrid: linear sub-circuit as WDF, nonlinear ports collected into one nonlinear state-space block solved iteratively per sample.
**KEY TECHNIQUE** Partition circuit into linear ports (handled by WDF tree) and a single nonlinear "root" containing all NL devices; solve the small NL system implicitly via Newton each sample.
**AUDIBLE RESULT** Accurate simulation of transistor fuzz (Fuzz Face), tube triode pairs, multi-diode networks where simple WDF stalls.
**PLUGIN USE** Backbone for any modular "circuit emulator" plugin (DK-style amp/pedal modeling).
**CONTROLS** Per-circuit topology + component values exposed as knobs.
**SIMPLIFIED IMPL** WDF tree → bjac matrix; NL solver: solve A·v + g(v) = b each sample with Newton (≤5 iters).

---

## 6. Pakarinen, Karjalainen 2009 — Wave Digital Modeling of the Output Chain of a Vacuum-Tube Amplifier
**PROBLEM** Output stage (push-pull tubes + transformer + speaker load) is where most "amp warmth" and power-amp distortion lives — needs accurate WDF model.
**DSP STRUCTURE** WDF tree: power tubes (Norman-Koren triode model on nonlinear root) → output transformer (mutual-inductance WDF block) → speaker impedance (LCR network).
**KEY TECHNIQUE** Triode I_p = G·(μ·V_g + V_p)^(3/2) with cutoff handled by max(0, ...); transformer winding ratio = WDF reflection coefficient at junction; speaker = R_voice + L + parallel resonance.
**AUDIBLE RESULT** Power-amp sag, transformer compression, speaker resonance bump — the "feel" of cranked tube amp output.
**PLUGIN USE** Tube power-amp stage of guitar/bass amp plugin; pair with preamp model upstream and cab IR downstream.
**CONTROLS** Bias, Pentode/Triode, Output Power (sag), Speaker Model (preset).
**SIMPLIFIED IMPL** Tube root: solve V_p Newton from I_p eq; transformer adaptor with ratio n; LCR speaker as series-parallel WDF.

---

## 7. Macak, Schimmel 2010 — Real-Time Guitar Tube Amplifier Simulation Using ODE Approximation
**PROBLEM** Full DK-method (Yeh) is CPU-heavy; want approximate ODE simulation that's RT-feasible for full multi-stage amp.
**DSP STRUCTURE** Per gain stage: small ODE (1–3 states) for triode + coupling cap; explicit RK or implicit trapezoidal with cached LUT for the nonlinear function.
**KEY TECHNIQUE** Replace per-sample Newton iteration with a 2D LUT keyed on (V_g, V_p_prev) → branchless O(1) lookup; bilinear interp keeps continuity.
**AUDIBLE RESULT** Multi-stage tube amp (3+ triodes + tone stack + power amp) running real-time with character-correct distortion.
**PLUGIN USE** Performance-critical full-amp plugin; alt to neural model when interpretability matters.
**CONTROLS** Gain (per stage), Bias, Tone Stack (Bass/Mid/Treble/Presence).
**SIMPLIFIED IMPL** for stage k: V_p[n] = LUT_k[V_g[n], V_p[n-1]]; chain stages with coupling cap HP between.

---

## 8. Werner, Bernardini, Sarti et al. 2016 — RT-WDF: Modular Wave Digital Filter Library with Arbitrary Topologies & Multiple Nonlinearities
**PROBLEM** Ad-hoc WDF code per circuit doesn't scale; need a reusable C++ library for plugin development.
**DSP STRUCTURE** Tree of WDF adaptors (series/parallel/R-type for non-tree topologies); root container handles M-port nonlinearity via Newton with analytical Jacobian.
**KEY TECHNIQUE** R-type adaptor (computed from Kirchhoff matrices, not just series/parallel) opens the door to non-treelike circuits (bridges, Wheatstone) inside WDF; multi-NL root solves coupled diodes/transistors in one iteration.
**AUDIBLE RESULT** Accurate emulation of bridge-rectifier ring mods, tone stacks, and other circuits historically untreatable by classical WDF.
**PLUGIN USE** Backbone for any DIY WDF plugin (Bassman, Fender, ring-mod, fuzz). Use the open-source RT-WDF code.
**CONTROLS** Per-component values; topology fixed at compile time per circuit.
**SIMPLIFIED IMPL** Build tree of Adaptor objects, attach Resistor/Cap/Inductor leaves, attach NLRoot at root; per sample: down-going waves → root solve → up-going.

---

## 9. Albertini, D'Angelo et al. 2016 — Audio Nonlinear Modeling Through Hyperbolic Tangent Functionals
**PROBLEM** Plain `tanh(g·x)` is the universal cheap saturator but lacks character per device; want richer family without circuit modeling.
**DSP STRUCTURE** Generalized tanh functional: y = (a·tanh(b·x + c) + d·tanh(e·x + f) + ...) / norm; sum of shifted/scaled tanh terms approximates any monotone curve.
**KEY TECHNIQUE** Fit a target measured I/O curve with N-term tanh-sum via least-squares; preserves smoothness (low aliasing energy) and has analytic antiderivative → ADAA-friendly.
**AUDIBLE RESULT** Per-device-flavored saturation curves with smoother tone than hard-clip and richer than single-tanh.
**PLUGIN USE** "Voicing" curves on a saturator plugin; preset library of tanh-sum coefficients per emulated device.
**CONTROLS** Drive, Voicing (preset coefficient set), Asymmetry (DC offset c).
**SIMPLIFIED IMPL** y = Σ a_k·tanh(b_k·x + c_k); precompute LUT or evaluate directly (~5 tanh's = cheap).

---

## 10. Bilbao, Esqueda et al. 2019 — Antiderivative Antialiasing for Stateful Systems
**PROBLEM** Classic ADAA (Parker/Zavalishin 2016) requires memoryless f(x); doesn't directly extend to nonlinearities inside a stateful filter (1-pole NL, ladder NL, etc.).
**DSP STRUCTURE** For a discrete update v[n] = G(v[n-1], x[n]), replace G's nonlinear evaluation by the difference of antiderivatives of the *trajectory* between time-steps.
**KEY TECHNIQUE** Approximate per-sample integral of the NL function over the trajectory v[n-1] → v[n] using F(v) = ∫f(v)dv: y ≈ (F(v[n]) - F(v[n-1]))/(v[n] - v[n-1]). Reduces aliasing by ~10–20 dB at half-Nyquist with no oversampling.
**AUDIBLE RESULT** Sharp audible reduction of intermodulation aliasing in NL filters / stateful waveshapers; no oversample CPU cost.
**PLUGIN USE** Any 1-pole/ladder/state-variable filter with input drive or feedback NL; tube models with stateful caps.
**CONTROLS** None user — internal AA quality switch.
**SIMPLIFIED IMPL** F = antideriv(f); per sample: dv = v - v_prev; y = (|dv|>ε) ? (F(v)-F(v_prev))/dv : f((v+v_prev)/2); use in update G.

---

## 11. Albertini, Bernardini et al. 2020 — Antiderivative Antialiasing in Nonlinear Wave Digital Filters
**PROBLEM** Apply ADAA inside the WDF nonlinear root, where the NL is *implicit* (defined by Kirchhoff residual) not explicit.
**DSP STRUCTURE** Reformulate the WDF root's residual equation in antiderivative form; Newton solver iterates on F(v) instead of f(v).
**KEY TECHNIQUE** Symbolic antiderivative of the diode/triode I-V curve; Newton on the integrated residual; tiny CPU overhead vs standard WDF.
**AUDIBLE RESULT** Diode clippers, tube stages inside WDF lose ~12 dB of aliasing energy at half-Nyquist without oversampling.
**PLUGIN USE** Apply to any WDF distortion plugin to upgrade alias performance for free.
**CONTROLS** None user — internal toggle.
**SIMPLIFIED IMPL** Replace `solve f(v)=0` with `solve (F(v)-F(v_prev))/(v-v_prev) = 0`; use 2-sample memory for v_prev.

---

## 12. La Pastina, Gröhn, Bilbao 2021 — Arbitrary-Order IIR Antiderivative Antialiasing
**PROBLEM** First-order ADAA still leaves audible aliasing under heavy modulation; want higher-order without polynomial blow-up.
**DSP STRUCTURE** Treat ADAA as integrator → multiply → differentiator chain; replace integrator/differentiator with higher-order IIR (Butterworth-style) whose joint magnitude is flat in passband.
**KEY TECHNIQUE** N-th order ADAA = N integrators + N differentiators around the NL; designed as IIR pair for arbitrary N with bounded numerical conditioning.
**AUDIBLE RESULT** 6 dB extra alias suppression per ADAA order; 4th-order ≈ 2× oversampling at lower CPU.
**PLUGIN USE** High-quality saturator/tube plugin where 2× OS still aliases.
**CONTROLS** AA Order (1–4), Quality preset.
**SIMPLIFIED IMPL** chain: x → IntFilter_N → f(·) → DiffFilter_N → y; coefficient sets precomputed per N.

---

## 13. Esqueda, Bilbao, Välimäki 2023 — Antialiasing Piecewise Polynomial Waveshapers
**PROBLEM** Piecewise polynomial shapers (hard clip, half-wave rect, polynomial folders) are ubiquitous but discontinuities cause severe aliasing; ADAA helps but choice of polynomial pieces matters.
**DSP STRUCTURE** Express the shaper as Σₖ pₖ(x)·𝟙[bₖ ≤ x < bₖ₊₁]; integrate each piece symbolically; ADAA on the piecewise antiderivative with break-point handling.
**KEY TECHNIQUE** When trajectory crosses a break-point bₖ within a sample, split the integral at the crossing — preserves continuity of the antiderivative; analytic break-point handling avoids the (v - v_prev)→0 singularity.
**AUDIBLE RESULT** Hard-clip, fold, and bit-crush shapers run ADAA-cleanly with no spurious clicks at break-point crossings.
**PLUGIN USE** Wavefolder, hard-clipper, rectifier, bit-crusher — apply this scheme everywhere.
**CONTROLS** Drive, Fold/Clip threshold, AA on/off.
**SIMPLIFIED IMPL** per sample: detect break-point crossings between v_prev, v; integrate F piecewise; y = ΣᵢΔFᵢ / (v - v_prev).

---

## 14. Wright, Damskägg, Välimäki 2022 — Neural Net Tube Models for Wave Digital Filters
**PROBLEM** Real triodes don't fit Norman-Koren cleanly; want data-driven tube model that drops into WDF root.
**DSP STRUCTURE** Train MLP (small, ~3 hidden layers, 16–32 units) on measured triode I-V data; replace analytical I_p = f(V_g, V_p) inside WDF nonlinear root with NN forward pass + autodiff Jacobian.
**KEY TECHNIQUE** NN provides f and ∂f/∂v for Newton iteration; trained offline per tube type (12AX7, EL34, ECC83); preserves WDF passivity if NN is monotone.
**AUDIBLE RESULT** Per-sample-accurate emulation of specific tube units, including aging/drift characteristics, while keeping WDF-circuit context.
**PLUGIN USE** "Tube selector" in amp plugin — swap NN weights to change tube model without recompiling circuit.
**CONTROLS** Tube Type (preset weights), Bias, all circuit knobs.
**SIMPLIFIED IMPL** WDF root NL: (f, df) = MLP_forward_with_jacobian(v); Newton update v -= f/df.

---

## 15. Carson, Wright, Välimäki 2025 — Aliasing Reduction in Neural Amp Modeling by Smoothing Activations
**PROBLEM** Neural amp models (LSTM/GRU/TCN) trained on amp recordings alias badly at high input levels because ReLU/tanh activations introduce broadband sharp curvature.
**DSP STRUCTURE** Replace standard activations (ReLU, tanh) with band-limited / smoothed variants (e.g., GELU, soft-relu, ADAA-tanh); fine-tune on original training data.
**KEY TECHNIQUE** Smoother activation = lower spectral content above Nyquist when chained → less aliasing on resample-back; combine with ADAA on the activation itself.
**AUDIBLE RESULT** ~10 dB reduction of audible aliasing in NAM/LSTM amp plugins without changing model architecture or oversampling.
**PLUGIN USE** Drop-in upgrade for any neural amp/distortion plugin (NAM, Proteus, etc.).
**CONTROLS** None user.
**SIMPLIFIED IMPL** swap `tanh` → ADAA-tanh (use F(x) = log(cosh(x))); fine-tune with same dataset for 1–5 epochs.

---

## REUSABLE PATTERNS — Distortion Batch 1

1. **Wiener-Hammerstein is the universal saturator template**: pre-EQ → static curve → post-EQ. Pre-EQ shapes *which* harmonics dominate; post-EQ shapes the harmonic envelope. Same curve, different EQs = different "amp".
2. **Pre-/de-emphasis around any nonlinearity** is the most powerful tone control on a distortion (more than the curve itself).
3. **Diode-pair clipper = transcendental ODE**, not memoryless. Solve via Newton (3–5 iters) or 1D LUT keyed on (vin, v_prev) for RT.
4. **Pedal personality lives in the EQ around the clipper**, not the clipper. Build a multi-pedal plugin from one diode-clipper core + per-pedal pre/tone-stack/post EQs.
5. **Wiener / Hammerstein / Volterra hierarchy**: increase order only when audible distortion has memory or is multi-tone-IMD-sensitive.
6. **Volterra series** is the right tool for *weakly* nonlinear circuits (filters with drive, mild tubes) — analytic, no iteration.
7. **WDF tree + single nonlinear root** is the canonical clean structure for circuit-accurate distortion plugins; use RT-WDF or PyWDF as starting point.
8. **R-type WDF adaptor** unlocks non-tree topologies (bridges, ring-mod) that classical WDF can't handle.
9. **Tube triode = Norman-Koren I_p = G(μV_g + V_p)^(3/2)** with positive cutoff; reasonable for plugin-grade preamp; for accuracy, train a small NN on real measurements.
10. **Output-stage triple = power tube + transformer + speaker LCR** — half the "amp tone" lives here, not in the preamp.
11. **2D LUT replaces per-sample Newton** for stateful triode/diode stages — branchless RT performance with bilinear interp keeping continuity.
12. **Tanh-sum (Σ aₖ·tanh(bₖx+cₖ))** approximates any monotone curve, has analytic antiderivative → ADAA-friendly. Library of presets per device.
13. **ADAA hierarchy**: memoryless ADAA (Parker 2016) → stateful ADAA (Bilbao 2019) → WDF-internal ADAA (2020) → arbitrary-order IIR ADAA (2021) → polynomial-piecewise ADAA (2023) → ADAA-on-RNN-activations (2024). Pick the lowest stage your DSP needs.
14. **ADAA core formula**: y ≈ (F(v) - F(v_prev)) / (v - v_prev); fall back to f((v+v_prev)/2) when |v-v_prev|<ε.
15. **Hard-clip, fold, rectify need break-point splitting** in piecewise ADAA — naive ADAA on discontinuous shapers leaves clicks at the joints.
16. **Order-N ADAA ≈ N×-oversampling alias performance at lower CPU** — usually 2nd-order ADAA beats 2× OS for monotone shapers.
17. **Smooth activations (GELU / ADAA-tanh / soft-ReLU)** in neural amp models are a free, drop-in alias reducer — no architectural change required.
18. **NN inside WDF root** (with autodiff Jacobian) gives data-driven device fidelity while keeping circuit-context flexibility (knob automation, topology swaps).
19. **Same circuit + different curve-fit data = different real units** — capture multiple physical amps and ship as preset library.
20. **Cache strategy hierarchy**: precomputed coefficients > 1D LUT > 2D LUT > Newton iteration > full ODE solve. Move down only when audible quality demands.
