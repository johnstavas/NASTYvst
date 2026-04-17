# DAFx — DISTORTION / NONLINEAR — Batch 4

15 papers covering: drum-machine circuit modeling (TR-808), guitar speaker NL, parametric circuit discretization (DK method), iterative-solver robustness, block-oriented grey-box amp ID, trajectory anti-aliasing for passive NL, deep neural amp modeling lineage (state-space DNN 2019 → grey-box-limited-data 2023 → perceptual genre-specific eval 2023 → Real-LRU 2025 → AA fine-tuning 2025 → unsupervised diffusion/GAN 2025), reservoir-computing black-box, neural multi-port WDF training, and convex-QP real-time NL solver.

This effectively closes plugin-relevant distortion coverage (149 papers in source list).

---

## 1. Werner, Abel, Smith 2014 — Physically-Informed, Circuit-Bendable Digital Model of the TR-808 Bass Drum
**PROBLEM** TR-808 BD is a bridged-T resonator + envelope shaper + distortion stage; clones miss the "circuit-bend" non-ideal interactions.
**DSP STRUCTURE** Bridged-T 2-pole resonator (~50 Hz, high Q) excited by trigger pulse; envelope multiplies output; intentional component-tolerance vector exposed as "bend" knobs.
**KEY TECHNIQUE** Parametrise off-spec resistor/cap values (component drift) → user can detune to "broken" 808 territory; single voice runs <0.1% CPU.
**PLUGIN USE** Drum-synth plugin BD voice; model architecture reusable for TR-606/909 toms.
**CONTROLS** Tune, Decay, Tone, Bend (component drift vector).
**SIMPLIFIED IMPL** trigger → BPF(f0=tune, Q=Q(decay)) → env(decay)·· tanh(g·out).

---

## 2. Pakarinen, Karjalainen 2008 — Nonlinear Modeling of a Guitar Loudspeaker Cabinet
**PROBLEM** Guitar speaker (Celestion-style) compresses + adds harmonics at high SPL — full IR convolution misses this dynamic behaviour.
**DSP STRUCTURE** Linear IR (cab response) + cone-suspension nonlinearity (cubic stiffness) + voice-coil heating LP (long-term gain reduction).
**KEY TECHNIQUE** Two NL paths: (1) instantaneous cone-stiffness cubic = soft compression + 2nd/3rd harmonics, (2) thermal voice-coil LP envelope reduces gain over seconds = "speaker breakup".
**PLUGIN USE** Cab-IR plugin upgrade — adds dynamic colour static IRs miss.
**CONTROLS** SPL Drive, Cone Stiffness, Thermal Time.
**SIMPLIFIED IMPL** y = IR_conv(x); y = y − k_cone·y³; gain *= 1 − thermalLP(y²).

---

## 3. Yeh, Smith 2010 — Discretization of Parametric Analog Circuits for Real-Time Simulations
**PROBLEM** Analog circuits with knob-driven components → recompiling DK matrices per knob change is slow; need interpolation strategy.
**DSP STRUCTURE** Nodal DK matrices factored into knob-dependent and knob-independent parts; precompute factorisation grid over knob space; bilinear interp between grid points at runtime.
**KEY TECHNIQUE** Decompose A(θ) = A0 + Σ θᵢ·Aᵢ; Schur-complement reduction precomputed; per-sample only 2D interpolation in knob space.
**PLUGIN USE** Any DK-style circuit plugin with continuous knobs (drive, tone) needing smooth real-time automation.
**CONTROLS** Knob automation; quality (grid density).
**SIMPLIFIED IMPL** grid θ ∈ [0,1]² @ 16×16; runtime: bilerp(table[θ_x,θ_y]) → coefficients.

---

## 4. Holters, Parker, Zölzer 2015 — Improving Robustness of the Iterative Solver in State-Space Modelling of Distortion Circuitry
**PROBLEM** Newton solver inside DK / WDF root sometimes diverges on transients (huge derivative) or near saturation knees → audible glitches/clicks.
**DSP STRUCTURE** Add damped Newton with line search; fall back to bisection if divergence detected; cap iteration count and clamp output to passive range.
**KEY TECHNIQUE** Hybrid: 3 unbounded Newton iters → if not converged, switch to safeguarded line-search (Armijo); if still bad, bisection on 1D residual; guarantees per-sample completion.
**PLUGIN USE** Production-grade safety wrapper for any WDF / DK plugin; eliminates convergence-driven artefacts.
**CONTROLS** None user — internal robustness layer.
**SIMPLIFIED IMPL** for k<3: Newton; if |res|>tol: while α>ε: try v + α·dv, halve α; if still bad: bisect.

---

## 5. Eichas, Möller, Zölzer 2017 — Block-Oriented Grey-Box Modeling of Guitar Amplifiers
**PROBLEM** Pure black-box clones generalize badly across knob settings; pure white-box (full WDF) is CPU-heavy.
**DSP STRUCTURE** Grey box = known topology (Wiener-Hammerstein per stage) + learned blocks (each filter & shaper fit to data) + circuit-aware knob mappings.
**KEY TECHNIQUE** Embed circuit prior (which knob affects which block) → cleaner knob extrapolation than pure NN; cheaper than full circuit sim.
**PLUGIN USE** Capture-mode amp plugin where user tunes knobs and the model interpolates correctly.
**CONTROLS** Drive, Bass/Mid/Treble, Master.
**SIMPLIFIED IMPL** y = post(knob_b,m,t)( shaper_drive( pre(knob_d)(x) ) ); fit all blocks jointly.

---

## 6. Holters, Parker 2017 — Trajectory Anti-Aliasing on Guaranteed-Passive Simulation of Nonlinear Physical Systems
**PROBLEM** ADAA's averaging can violate energy-passivity in feedback NL → audible blow-up at resonance.
**DSP STRUCTURE** Combine ADAA with discrete-gradient method (port-Hamiltonian style) → integrate NL along the trajectory using energy-consistent discrete derivative.
**KEY TECHNIQUE** Replace ∂H/∂v with (H(v) − H(v_prev))/(v − v_prev) inside the solver — both anti-aliases and conserves energy → safe for high-feedback nonlinear filters.
**PLUGIN USE** Required when ADAA is needed inside resonating NL filters (Moog, MS-20, screaming wah).
**CONTROLS** AA quality (off / passive ADAA).
**SIMPLIFIED IMPL** dgrad = (F(v)−F(v_prev))/(v − v_prev); use as derivative term in implicit solver.

---

## 7. Damskägg, Juvela, Välimäki 2019 — Modelling Nonlinear State-Space Systems Using a Deep Neural Network
**PROBLEM** Map measured analog amp behaviour into a single DNN that captures stateful nonlinearity.
**DSP STRUCTURE** Encoder-decoder LSTM/GRU with input feature = (x, knobs); learns latent state; trained on input/output amp pairs.
**KEY TECHNIQUE** Treat amp as discrete state-space ẋ = f_NN(x, u); back-prop through time; small enough (32-unit LSTM) for real-time.
**PLUGIN USE** Foundation paper for the NAM/GuitarML lineage; first real-time-capable DNN amp.
**CONTROLS** Drive, Tone, Master (conditioning inputs).
**SIMPLIFIED IMPL** h[n] = LSTMCell(h[n−1], [x[n], knobs]); y[n] = W·h[n].

---

## 8. Holzmann 2009 — Reservoir Computing: Powerful Black-Box Framework for Nonlinear Audio Processing
**PROBLEM** Want NN-style flexibility without back-prop training cost; was important pre-deep-learning.
**DSP STRUCTURE** Echo State Network: random fixed recurrent reservoir of N neurons with sparse random weights; only readout layer trained (linear regression).
**KEY TECHNIQUE** Train-by-LS instead of gradient descent → seconds, not hours; reservoir's "memory" captures NL dynamics.
**PLUGIN USE** Quick prototyping of black-box effects; modern niche use as initialiser for deeper models.
**CONTROLS** Reservoir size, spectral radius (memory), input scaling.
**SIMPLIFIED IMPL** h[n] = tanh(W_in·x + W_res·h[n−1]); y[n] = W_out·h[n]; train W_out by ridge regression.

---

## 9. Wright, Damskägg, Välimäki 2023 — Neural Grey-Box Guitar Amplifier Modelling with Limited Data
**PROBLEM** Capturing an amp at every knob position requires hours of data; users want to capture in minutes.
**DSP STRUCTURE** Grey-box: fixed circuit-prior backbone (LTI pre/post + simple stateful NL) + small NN refining each block; condition on knobs.
**KEY TECHNIQUE** Circuit prior reduces effective parameter count → models learn from minutes of audio rather than hours; knob extrapolation works because prior is correct.
**PLUGIN USE** "Capture mode" for end-user amp profiling on consumer hardware.
**CONTROLS** Standard amp knobs (interpolated by NN).
**SIMPLIFIED IMPL** y = post_NN(shaper_NN(pre_NN(x, knob_drive), knobs), knob_tone) + skip; train on 5-min clip.

---

## 10. Wright, Välimäki 2023 — Perceptual Evaluation and Genre-Specific Training of Deep NN Models of a High-Gain Guitar Amplifier
**PROBLEM** MSE/spectral loss in NN training doesn't predict perceived amp quality; same-loss models sound different per genre.
**DSP STRUCTURE** Listening study comparing models trained on metal/blues/clean datasets; perceptual loss (MR-STFT + adversarial) vs MSE.
**KEY TECHNIQUE** Genre-specific training data → model learns the dynamic / spectral region the genre uses; adversarial perceptual loss > MSE for high-gain transients.
**PLUGIN USE** Ship multiple "voicings" of the same amp model trained on different stylistic datasets; expose as "Genre" preset.
**CONTROLS** Genre Preset, standard knobs.
**SIMPLIFIED IMPL** train per genre with data subset; loss = MR-STFT + 0.1·adv.

---

## 11. Moliner et al. 2025 — Unsupervised Estimation of Nonlinear Audio Effects: Diffusion vs Adversarial
**PROBLEM** Capture an unknown effect from *unpaired* audio (only the wet signal exists, no clean reference).
**DSP STRUCTURE** Two approaches benchmarked: (a) diffusion-based "wet → clean" inverse model + cycle-consistency, (b) GAN with discriminator distinguishing real vs simulated wet.
**KEY TECHNIQUE** Diffusion gives more stable training and higher-fidelity inversion; GAN faster but mode-collapse-prone. Both circumvent the need for paired DI/wet recordings.
**PLUGIN USE** "Reverse engineer this guitar tone from a record" → blind capture of effects on commercial recordings.
**CONTROLS** Source recording → auto-fit model.
**SIMPLIFIED IMPL** Train inverse-diffusion on wet samples; sample clean estimate; refit forward NN on (clean_est, wet) pairs.

---

## 12. Carson, Wright, Välimäki 2025 — Antialiased Black-Box Modeling of Audio Distortion Using Real Linear Recurrent Units
**PROBLEM** LSTM/GRU amp models alias under heavy gain; complex-valued S5/LRU work but increase compute.
**DSP STRUCTURE** Real-valued Linear Recurrent Unit (real-LRU) with diagonal recurrence + ADAA-style smooth nonlinear gating.
**KEY TECHNIQUE** Diagonal recurrent matrix has analytic per-channel impulse response → exact band-limit per channel → inherent anti-aliasing without oversampling.
**PLUGIN USE** State-of-the-art replacement for LSTM in neural amp plugins; cleaner top-end + lower CPU.
**CONTROLS** Same as LSTM models.
**SIMPLIFIED IMPL** h[n] = λ·h[n−1] + B·x[n] (per channel); y = C·h + D·x; ADAA on output activation.

---

## 13. Wright, Carson, Välimäki 2025 — Anti-Aliasing of Neural Distortion Effects via Model Fine Tuning
**PROBLEM** Existing trained NAM/Proteus models alias; retraining from scratch is expensive.
**DSP STRUCTURE** Take pre-trained black-box amp model; fine-tune with augmented loss including aliasing penalty (HF energy above Nyquist on 2× oversampled output).
**KEY TECHNIQUE** Few epochs of fine-tuning (≤ 1 hour) push the network toward smoother activations → lower aliasing without architectural change.
**PLUGIN USE** Drop-in upgrade path for existing model libraries; user retains preferred voicing.
**CONTROLS** None user — model upgrade.
**SIMPLIFIED IMPL** loss = orig_loss + λ·||HF(2×OS(model(x)))||²; fine-tune 5 epochs.

---

## 14. Bernardini et al. 2025 — Efficient Emulation of Nonlinear Analog Circuits Using Constraint Stabilization and Convex Quadratic Programming
**PROBLEM** Some NL circuit equations are stiff or have multi-valued branches → Newton fails; want a deterministic-time solver.
**DSP STRUCTURE** Reformulate per-sample circuit residual as a convex QP with linear constraints encoding device operating-region branches.
**KEY TECHNIQUE** Convex QP solved by interior-point in fixed iterations → bounded latency, no divergence; constraint stabilization keeps state on manifold.
**PLUGIN USE** Stiff / multi-branch circuits (Schmitt triggers, comparators, latching fuzz) where Newton can't be trusted.
**CONTROLS** Per circuit.
**SIMPLIFIED IMPL** min ½v'Pv + q'v s.t. Av ≤ b → 4-iter interior-point; deterministic.

---

## 15. Pasini, Bernardini et al. 2025 — Training Neural Models of Nonlinear Multi-Port Elements within Wave Digital Structures via Discrete-Time Simulation
**PROBLEM** NN-as-WDF-port (Pasini 2024) requires training on isolated NL device data; want to train *in-circuit* so NN learns device behaviour as it actually appears in the WDF graph.
**DSP STRUCTURE** Embed untrained NN in target WDF circuit; train end-to-end with circuit-output loss; back-prop through WDF iteration via differentiable fixed-point.
**KEY TECHNIQUE** Implicit-function theorem → gradient flows through fixed-point solver without unrolling iterations → tractable training.
**PLUGIN USE** Highest-fidelity per-circuit neural emulation; combines circuit interpretability (WDF topology) with data-driven NL.
**CONTROLS** Per-circuit knobs.
**SIMPLIFIED IMPL** for each batch: forward = WDF_solve(NN(v)); backward via implicit-grad; AdamW.

---

## REUSABLE PATTERNS — Distortion Batch 4

1. **Drum-synth voices = bridged-T resonator + envelope + soft-clip + intentional component drift** ("circuit-bend") — TR-808 template generalises to other analog drum voices.
2. **Cab IR + cone NL + thermal LP** — full speaker model is two NL paths (instantaneous + slow-thermal); both are perceptually important.
3. **Knob-dependent matrix decomposition + bilinear interp grid** is the standard trick to keep DK-method circuits real-time-knob-smooth.
4. **Hybrid Newton → line-search → bisection** safeguard layer is mandatory for production WDF/DK plugins; eliminates divergence-induced clicks.
5. **Grey-box (known topology + learned blocks)** consistently beats both pure white-box (CPU) and pure black-box (knob extrapolation) for amp/pedal modelling.
6. **Trajectory ADAA + discrete-gradient = anti-aliasing inside passive NL** — the only safe way to apply ADAA inside resonant feedback NL filters.
7. **Real-LRU (diagonal recurrent) inherently anti-aliases** per channel via analytic IR — preferable to LSTM/GRU in new neural amp designs.
8. **Reservoir computing** is the cheap-train baseline; train W_out by ridge regression for sub-second iteration; use to bootstrap deeper models.
9. **Genre-specific training datasets** matter as much as architecture — perceptual quality differs across styles even at equal MSE.
10. **Adversarial / multi-resolution STFT loss > MSE** for perceptual fidelity, especially on high-gain transients.
11. **Diffusion-based unsupervised inversion** is the new state-of-the-art for cloning effects from unpaired audio (e.g. recordings without DI).
12. **Fine-tuning with aliasing penalty** is the cheap upgrade path for any deployed NN amp model — no architectural change needed.
13. **Convex QP solver** = deterministic-latency replacement for Newton on stiff / multi-branch circuits (Schmitt, comparators, latching).
14. **Differentiable fixed-point WDF (implicit-function gradient)** lets neural elements be trained *inside* a circuit context — best of both worlds.
15. **Capture data minimisation** is a competitive frontier: grey-box-with-prior > black-box for "5-minute capture" workflows.
16. **Plugin ship strategy**: ship the model, ship multiple genre-trained voicings, ship knob-mapped capture data, fine-tune online if user requests.
17. **AA hierarchy decision tree**: smooth shaper (no AA needed) → ADAA-1 → ADAA-N + cubic-trajectory → ADAA-on-RNN → smoothed activations + fine-tune → 2× OS as last resort.
18. **Solver hierarchy decision tree**: closed-form > LUT > Newton (fast convergent) > damped Newton > QP/IP (stiff cases) > implicit-grad (training-time).
19. **Capture vs simulation vs latent-morph** — three deployable plugin paradigms; latent-morph wins for "many-pedals-in-one" UX.
20. **Model lifecycle**: train (perceptual loss + genre data + AA penalty) → fine-tune (AA + CPU pruning) → deploy (with NL-safe solver + AA wrapper) → ship variants (different captures / latent morphs).
