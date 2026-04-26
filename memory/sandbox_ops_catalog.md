# Sandbox Ops Catalog — 1–183 flat index

Living checklist of every op slot in the sandbox DSP primitive set. Organised
by family; the number in the first column is the **canonical catalog ID** and
is permanent. The `status` column is the single source of truth for "what's
done vs. what's left".

> **Phase 4 closure — 2026-04-25 ✅.** Op-ship line **UNPAUSED**. Native
> parity is now a permanent ship gate per `ship_blockers.md` § 8. All 39
> ops in `test/fixtures/parity/per_op_specs.json` are parity-green at
> declared tolerance (full sweep ALL PASS, golden hashes 250/250 PASS,
> verified 2026-04-25). Parity-verified op set: `gain, abs, sign, scaleBy,
> clamp, polarity, uniBi, constant, polarity_inv, uniBi_b2u, dcBlock,
> onePole_lp, onePole_hp, svf_lp, ladder, gain_chain2, biquad_{lp,hp,bp,
> notch,peak,lowshelf,highshelf}, drive, mix, softLimit, saturate, bitcrush,
> hardClip, wavefolder, diodeClipper, shelf_low, allpass, tilt, chebyshevWS,
> korg35, diodeLadder, smooth, slew`. New ops shipped after this date
> require the 7-step protocol (`sandbox_op_ship_protocol.md`) including
> Step 6 native-parity green BEFORE flipping ✅+P in this catalog.

## Status legend
- ✅+P  **shipped + parity-verified** — tri-file set complete + math + golden
  blessed + `qc:parity` green at declared tolerance against worklet sibling.
  After Phase 4 closure (2026-04-25), this is the only ✅-equivalent state
  for shipped rows.
- ✅+P~ **shipped + parity-verified with declared widening** — same as ✅+P
  but with a per-op tolerance widening documented in
  `test/fixtures/parity/per_op_specs.json` `note` field (e.g., neural ops
  using cents tolerance instead of bit-exact).
- ✅    **legacy "shipped" mark** — pre-Phase-4 transitional. Many existing
  rows still display ✅ rather than ✅+P; treat as "shipped, and either
  parity-verified (if op appears in `test/fixtures/parity/per_op_specs.json`)
  or parity-not-yet-built-as-fixture (if not)." All 39 ops in the parity
  fixture set are ✅+P after Phase 4 closure 2026-04-25 (see closure block
  below). Future per-row promotion happens when the doc is next touched.
- 🔧    **parity-pending** — fix in flight (ops paused mid-debug; see
  `qc_backlog.md` for diff signature).
- 🚧    **registry-only** — entry exists in `src/sandbox/opRegistry.js` but no
  sidecar yet (so shape-check would trip if included in OP_IDS).
- ⬜    **not started** — no registry entry, no files.

## Running total
**126 of ~183 ops shipped (~69%).** Pre-Phase-4 was 125; #139 xformerSat
shipped ✅+P 2026-04-26 → 126. 2026-04-26 corpus-sweep extension
adds 36 new ⬜ slots (#141–#176) — 8 Tier-S + 21 Tier-A + 7 Tier-B.
2026-04-26 dedup-recovery pass adds 7 more ⬜ slots (#177–#183) —
1 Tier-A (fmOperator) + 6 Tier-B — closing the 11-slot gap to the
original synthesis count.
Pre-sweep state: 125 of ~140 ops shipped (~89%). Catalog extended
2026-04-24 with 8
gap-audit slots (#131–#138) covering Character/Filters/Synth/Noise
foundation holes identified in second-pass audit. **All 3 critical
gap-audit ops shipped 2026-04-24: #131 wavefolder, #132 diodeClipper,
#133 hardClip. ✅ All 5 nice-to-haves shipped 2026-04-24: #134
chebyshevWS, #135 diodeLadder, #136 korg35 (slot rename from
steinerParker — see row), #137 polyBLEP, #138 velvetNoise. ✅ Gap-audit
queue fully closed.** **2026-04-25 transformer/Pultec intake added two
queued slots (#139 xformerSat, #140 pultecEQ) with Tier-S primaries in
hand — see "Queued character + EQ ops" section below.**

### Gap-audit queue (2026-04-24) — 3 critical + 5 nice-to-haves
| # | op | family | priority | primary in hand |
|---|---|---|---|---|
| 131 | wavefolder    | Character | **critical** | musicdsp "Fold-back" + Esqueda-Välimäki-Bilbao DAFx 2017 + Faust `oscillators.lib` (MIT) |
| 132 | diodeClipper  | Character | **critical** | Yeh DAFx 2008 + Eichas-Fink-Möller-Zölzer DAFX 2014 (MIT Green-Box Fuzz) |
| 133 | hardClip      | Character | **critical** | Canon:character §4 (branchless clip) + Parker-Esqueda-Bilbao DAFx 2016 (ADAA) |
| 134 | chebyshevWS   | Character | nice-to-have ✅ | Canon:character §4 / musicdsp #230 (public-domain) + Wikipedia Chebyshev polynomials |
| 135 | diodeLadder   | Filters   | nice-to-have ✅ | Faust ve.diodeLadder (Eric Tarr 2019, MIT-STK) + Pirkle AN-6 + ef.cubicnl (JOS, STK-4.3) |
| 136 | korg35 (was steinerParker) | Filters | nice-to-have ✅ | Faust ve.korg35LPF (Eric Tarr 2019, MIT-STK) — slot renamed; primary for true Steiner-Parker not openly available |
| 137 | polyBLEP      | Synth     | nice-to-have ✅ | Välimäki-Huovilainen IEEE SPM 2007 §III.B (closed-form parabolic correction, math-by-definition) |
| 138 | velvetNoise   | Noise/Space | nice-to-have ✅ | Karjalainen-Järveläinen AES 2007 (originator) + Välimäki-Schlecht-Pätynen DAFx 2017 — math-by-definition (closed-form k_imp = round(r1·(Td−1)), s_imp = sgn(r2−0.5); paper PDFs unretrievable, algorithm universally documented) |

Why these specifically: cannot be cleanly composed from existing primitives.
Each has a distinct topology (non-monotonic transfer for #131, exponential
I-V for #132, discontinuous derivative for #133, Chebyshev polynomial basis
for #134, distinct ladder topology for #135–136, parabolic stand-in for #137,
sparse-noise generator for #138). Demoted to brick-layer (NOT new ops):
brickwallLimiter, multibandCompressor, deEsser, pingPongDelay, tapeDelay,
parametricEQ, vocoder, autoTune, ambisonics, robotization/whisperization —
all compose from shipped primitives.

### Latest session ships (2026-04-24)
| # | op | primary |
|---|---|---|
| 77  | pyin | Mauch & Dixon 2014 + c4dm/pyin Vamp |
| 103 | panner | Dannenberg/Dobson CMU ICM pan laws |
| 104 | autopan | Puckette §5.2 AM · CMU ICM pan (composition) |
| 105 | haas | Haas 1951 precedence (via Wikipedia) |
| 118 | crossfeed | libbs2b v3.1.0 (Bauer family, MIT) |
| 61  | envelopeFollower | Bram de Jong musicdsp #136 |
| 125 | hiss | feldkirch PRNG + Kellett pink (musicdsp) |
| 124 | crackle | SC Dust/Dust2 algorithm (GPLv3, code not copied) |
| 123 | sampleHold | SC Latch_next_aa semantics (GPLv3, code not copied) |
| 58  | randomWalk | SC BrownNoise reflective-boundary walk (GPLv3, code not copied) |
| 59  | stepSeq | SC Stepper counter + 8-value lookup (GPLv3, code not copied) |
| 60  | chaos | SC Logistic-map y=r·y·(1-y) (May 1976; GPLv3 code not copied) |
| 69  | granularBuffer | SC GrainBuf active-grain pool (GrainUGens.cpp, GPLv3 code not copied) + Bencina open chapter |
| 106 | microDetune | Faust stdlib `transpose` from misceffects.lib (MIT) — two-tap crossfading delay-line |
| 48  | lookahead (alias) | Closed as alias of #45 — no separate code shipped. |
| 127 | splitter (alias) | Closed as alias of #36 fanOut — no separate code shipped. |
| 128 | merge (alias) | Closed as alias of busSum — no separate code shipped. |
| 129 | multiplex (alias) | Closed as alias of select — no separate code shipped. |
| 130 | _reserved_ | No spec; reserved for future routing primitive. |

Spatial sweep near-complete: #103 panner, #104 autopan, #105 haas, #118 crossfeed all ✅.
Noise family complete: #10 noise (core, pre-session) ✅, #124 crackle ✅, #125 hiss ✅, #138 velvetNoise ✅.
Control/trigger primitive: #123 sampleHold ✅.
Movement family complete: #58 randomWalk ✅, #59 stepSeq ✅, #60 chaos ✅.
Routing slots reconciled: #127–#129 closed as aliases of fanOut/busSum/select; #130 reserved-empty.

### Still open
- **Gap-audit ops (queued, primaries in hand)**:
  - ~~#131 wavefolder~~ ✅ shipped 2026-04-24 (Faust ef.wavefold MIT)
  - ~~#132 diodeClipper~~ ✅ shipped 2026-04-24 (Yeh DAFx 2008 closed-form arcsinh)
  - ~~#133 hardClip~~ ✅ shipped 2026-04-24 (Canon §5 branchless + Parker-Esqueda-Bilbao DAFx 2016 ADAA)
  - ~~#134 chebyshevWS~~ ✅ shipped 2026-04-24 (Canon:character §4 / musicdsp #230 — explicit T_1..T_5 polynomial sum)
  - ~~#135 diodeLadder~~ ✅ shipped 2026-04-24 (Faust ve.diodeLadder — Eric Tarr 2019 MIT-STK + Pirkle AN-6)
  - ~~#136 steinerParker → korg35~~ ✅ shipped 2026-04-24 as `korg35` (Faust ve.korg35LPF — Tarr MIT-STK; slot renamed because Faust has no Steiner-Parker port and Korg-35 is the closest in-character primary in hand. True Steiner-Parker port awaits Pirkle textbook digitization or Stenzel "Synthacon VC3" DAFx digitization.)
  - ~~#137 polyBLEP~~ ✅ shipped 2026-04-24 (Välimäki-Huovilainen IEEE SPM 2007 §III.B parabolic correction — closed-form math-by-definition)
  - ~~#138 velvetNoise~~ ✅ shipped 2026-04-24 (Karjalainen-Järveläinen AES 2007 + Välimäki et al. 2017 — math-by-definition; sparse ±1 impulses on Td-sample grid; LCG matches op_noise for co-evolved seeded streams)
- **Control primitives**: #100–#102 reserved-empty slots (no specs, not blocking)
- **Pitch**: #78 crepe ✅ Stage 1 + Stage 2 + Stage 3 all landed 2026-04-24 — full neural-op slice end-to-end: registry · worklet · MLRuntime (JS) · ORT-Web · crepe.onnx (1.95 MB, MIT) · MLRuntimeNative (C++) · ORT-native shim · CMake/JUCE BinaryData · `qc:ml` harness (15 tolerance + decoder-fixture tests green). T8 codegen integration (JUCE plugin scaffold + CMake build server + native test gating) is non-blocking — sandbox + WAM ship via the worklet+MLRuntime path.

**Effective state: foundation closed (gap-audit queue empty 2026-04-24).**
Only 4 reserved-empty slots (#100–#102, #130) remain. Next moves are plugin
onboarding / brick assembly. **Two character/EQ extension slots queued
2026-04-25 (#139 xformerSat, #140 pultecEQ) — primaries in hand (Whitlock
+ De Paiva 2011 + Pultec EQP-1A manual), op-ship line is paused on Phase 4
gate closure regardless.**

### Closed / complete families
- Character (assigned slots): #13, #88, #111–#117 + #112a all ✅
- Synth: #41, #79–#87 + #87a all ✅
- Dynamics (assigned slots): #3–#5, #40–#46 ✅ (#47–#50 reserved)
- Analysis/Spectral: #57, #62–#75 ✅
- Tone/EQ: #1–#17, #29–#39 ✅ (only #18 reserved-empty); #140 pultecEQ queued 2026-04-25
- Reverb core: #20 fdnCore, #21 ER, #107 schroederChain, #108 plate,
  #109 spring, #110 SDN ✅
- BS.1770 loudness stack: kWeighting · lufsIntegrator · loudnessGate ·
  truePeak · lra ✅
- MVP six + FB-safety triad + tone-shaping triad: ✅

Full per-op audit rows in `memory/sandbox_op_audit_2026-04-23.md`; upgrade
paths in `memory/sandbox_ops_research_debt.md`.

(History marker: **2026-04-23/24** primary-source audit pass — 49
pre-session ops + #34 ladder, #40 adsr, #62 mfcc, #63 convolution,
#64–#67 fft/ifft/stft/istft, #68 phaseVocoder audited. Reverb-family
core landed — #20 fdnCore is the Geraint Luff 8ch FDN workhorse; plate
/ spring / SDN / schroederChain all wrap or mirror it. Physical-modeling
trio: karplusStrong → waveguide → kellyLochbaum. Analysis dep gate
cleared via LPC #71.)

## Family index
| family | slots |
|---|---|
| Core I/O            | 1, 6 |
| Filters             | 2, 32–39, 135–136 |
| Dynamics            | 3–5, 40–50 |
| Control primitives  | 7–9, 29–31, 89–102 |
| Noise               | 10, 123–125, 138 |
| Movement / Modulation | 11, 58–61 |
| Character / Saturation | 12–14, 88, 111–117, 131–134, 139 |
| Delay / Time        | 15, 27–28, 48, 68–69 |
| Space               | 16–21, 103–110, 118 |
| Routing             | 22–26, 39, 127–130 |
| Synth generators    | 41, 79–87, 137 |
| Analysis / Spectral | 57, 62–75 |
| Pitch detection     | 76–78 |
| Loudness / Metering | 49–56 |
| ML / Neural (Stage E) | 78, 119–122 |

---

## Catalog

### Core I/O (#1, #6)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 1 | gain | ✅ | dB→linear + gainMod summing |
| 6 | mix  | ✅ | dry_wet_mix_rule.md (equal-power cos/sin) |

### Filters (#2, #32–#39)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 2  | filter (biquad, LP/HP/BP/notch) | ✅ | Canon:filters §9 (RBJ) |
| 32 | onePole                          | ✅ | Canon:filters §9 / DAFX §2.1.1 — 1-pole LP/HP, complementary construction |
| 33 | svf (Simper)                     | ✅ | Canon:filters §1 — ZDF trapezoidal-integrated SVF, LP/HP/BP/notch, mod-stable, Q-independent cutoff |
| 34 | ladder (Moog)                    | ✅ | musicdsp #24 (mistertoast Moog VCF) — 4-pole LP cascade w/ inverted FB and cubic soft-clip `y4 -= y4³/6` on output (Taylor-2 tanh) self-limits resonance; Q-compensation `r = res·(t2+6t)/(t2−6t)` w/ `t=(1-p)·ln4`; cutoff clamped [20, Nyq-100], resonance clamped [0, 1.2]; LP only v1 (BP/HP taps + Hötvinen tanh-per-stage + Karlsen flavor are debt-ledger upgrades); Float64 state + Watte flush on all 8 registers; latency=0; Canon:filters §2–4 enumerates Stilson/Hötvinen/Karlsen alternates |
| 35 | formant                          | ✅ | **Vowel formant filter (A/E/I/O/U)**. Primary: **musicdsp archive #110** "Formant Filter" by alex@smartelectronix (2002-08-02). 10th-order all-pole direct-form IIR: `res = c[0]·x + Σ_{k=1..10} c[k]·m[k−1]`, then state shift `m[0..9] ← {res, m[0..8]}`. Five 11-coefficient tables (A/E/I/O/U) baked in verbatim; fractional `vowel` param lerps adjacent tables per author's "linear morphing works effectively" note. Declared deviations: 44.1 kHz calibration (P2: SR-scaled tables), per-instance memory (original used `static`), no amplitude clamp (author recommends caller-side scaling; U vowel known to self-oscillate), denormal flush. Latency=0. Shipped 2026-04-24. |
| 36 | comb                             | ✅ | **Classic comb filter (FF + FB)**. Primary: **JOS PASP Feedforward_Comb_Filters + Feedback_Comb_Filters** (verbatim difference equations). Mode=0: `y(n) = x(n) + g·x(n−M)` (FIR tapped-sum). Mode=1: `y(n) = x(n) + g·y(n−M)` (IIR, stability `\|g\|<1`). Single `delayMs` + `g` param pair switches behavior via `mode`. Declared deviations: g clamped to ±0.999 in FB mode (stricter than paper's strict `\|g\|<1`); integer-sample delay only (P2: fractional/Lagrange for flanger sweep); denormal flush on tap read. Building block for Schroeder reverb, flanger, Karplus-Strong, chorus. Shipped 2026-04-24. |
| 37 | shelf (low/high parametric)      | ✅ | Canon:filters §9 (RBJ shelving) |
| 38 | tilt                             | ✅ | **Tilt EQ** (single-knob spectral tilt around pivot frequency). Primary: **musicdsp archive #267** "Simple Tilt Equalizer" (Lubomir I. Ivanov, 2009-05-29), models Elysia mPressor "Niveau" filter. Pseudocode verbatim: one-pole LPF `lp = a0·x + b1·lp` with `a0 = 2ω/(3sr+ω)`, `b1 = (3sr-ω)/(3sr+ω)`; complementary HPF = `x − lp`; `out = x + lgain·lp + hgain·(x−lp)`. Asymmetric gain: gain>0 → low cut×gfactor + high boost; gain<0 → low boost + high cut×gfactor. `lgain/hgain = exp(g/amp)−1` with `amp=6/ln2`. Declared deviations: `Math.PI` instead of original `22/7`; implemented denormal flush on `lp` (archive declared `denorm` unused); `gfactor` exposed as param; gain clamped to ±24 dB. Shipped 2026-04-24. |
| 39 | lrXover (Linkwitz-Riley)         | ✅ | **4th-order Linkwitz-Riley crossover**. Primaries: **Siegfried Linkwitz, linkwitzlab.com/filters.htm** ("LR4 = cascade of 2nd-order Sallen-Key, Q₀=0.71, −6 dB at Fp, 360° phase offset all freq") + **RBJ Audio EQ Cookbook** (biquad LPF/HPF coefficient formulas verbatim). Topology: input → [LPF(Q=1/√2) → LPF(Q=1/√2)] = low_out; input → [HPF(Q=1/√2) → HPF(Q=1/√2)] = high_out. Two outputs: `low`, `high`. Sum is magnitude-flat (verified in test suite: both −6 dB at Fp, sum back to INPUT_RMS at 200 Hz / 1 kHz / 8 kHz). Declared deviations: LR4 only (P2: LR2 w/ polarity flip, LR8 cascade), inline biquad math (not composed via `filter` op), denormal flush. Q=Math.SQRT1_2 exactly (vs Linkwitz's printed "0.71"). Shipped 2026-04-24. |

### Dynamics (#3–#5, #40–#50)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 3  | detector (peak/abs)   | ✅ | |
| 4  | envelope (AR)         | ✅ | Canon:dynamics §1 (Bram) |
| 5  | gainComputer          | ✅ | Zölzer DAFX §4.2.2 (soft-knee) |
| 40 | adsr                  | ✅ | musicdsp #189 (Schoenebeck 2005) · Canon:synthesis §12 — linear attack + exp decay/release via `L += c·L`; gate-edge state machine (idle/A/D/S/R); floor=1e-4; golden 0e03440d65b927ca… |
| 41 | gate                  | ✅ | Bram env detector (Canon:dynamics §1, musicdsp #97) + math-by-definition A/H/R state machine w/ Schmitt 3dB hysteresis. Fast internal detector (1/10 ms), user A/H/R shapes output gain. Optional sidechain. 15 tests green. **Primary audit 2026-04-24**: surveyed Airwindows Gatelope (spectral, divergent), Faust compressors.lib (no gate fn), musicdsp Effects (none), amplessEngine.js (2-state, simpler) — no open primary matches 5-state Schmitt. Math-by-definition honest w/ survey trail in header. |
| 42 | expander              | ✅ | Bram env detector (Canon:dynamics §1) + Faust `compressors.lib` `peak_expansion_gain_mono_db` (GRAME, LGPL; paraphrase-only, audited 2026-04-24 post-ship). Three-region dB gain computer algebraically identical to ours — Faust knee `(level−thresh−knee/2)²/(−2·knee)` ≡ our `(R−1)·(x−T−K/2)²/(2K)` with strength=−(R−1) + sign flip. Ratio=1 bypass, ratio=100≈gate. Floor/range knob. 16 tests green. golden fd157b51d1c3b367… |
| 43 | transient             | ✅ | **Airwindows Point (Chris Johnson, MIT)** structural ref for DET architecture — PointProc.cpp L41–L64 pasted verbatim in worklet. Our deviations: Bram §1 asymmetric detector (vs Point's symmetric one-pole), difference-normalized gain law split into `atk`+`sus` terms (vs Point's pure ratio), user-exposed `attackAmount`/`sustainAmount` ∈ [-1,+1] (vs Point's no-knob always-on). SPL DE 10154200 patent family closed. 13 tests green. golden 1dd8f45d00ac1708… |
| 44 | sidechainHPF          | ✅ | **RBJ Audio EQ Cookbook HPF** (Robert Bristow-Johnson) — fetched via curl 2026-04-24 to C:/Users/HEAT2/Downloads/rbj_cookbook.txt, L116-L123 pasted verbatim in worklet header. Direct Form 1 biquad per Eq 4 (L38). Params: cutoff [20, 2000] Hz (default 100), q [0.1, 10] (default 0.707 Butterworth), order {1,2} — order=2 cascades two identical biquads (24 dB/oct). Declared deviations: clamps, order enum, denormal flush, mono, no dry-wet (utility op). 16 tests green. golden 6a90a0d35c5a9283… |
| 45 | lookahead             | ✅ | Math-by-definition primitive. Ring-buffer pure delay + monotonic-deque windowed abs-max (Lemire 2006 "Streaming Maximum-Minimum Filter" structural ref, arXiv:cs/0610046). Emits `out` (delayed) + `peak` (leading envelope). Reports `getLatencySamples()=L` for bypass-contract. 14 tests incl. deque-vs-brute-force sweep. golden ef7d6d621eee8a37… |
| 46 | meters (VU/peak)      | ✅ | **Composition** of shipped siblings: `op_peak.worklet.js` L14–L23 (instant-attack + exp-release per IEC 60268-10) + `op_rms.worklet.js` L17–L20 (one-pole mean-square averager). Both passages pasted verbatim in worklet header. Dual control outputs (peak + rms) emitted in parallel from single drive. Standard preset enum {vu, ppm, digital, custom}: vu=300ms/1700ms, ppm=10ms/1700ms, digital=300ms/3000ms. Custom-param set auto-flips `standard` to 'custom'. 18 tests green. golden 6bc368f2ce1b9cc7… |
| 47–50 | _reserved_        | ⬜ | |

### Control primitives (#7–#9, #29–#31, #89–#102)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 7  | curve    | ✅ | sandbox_modulation_roadmap.md §3 (cubic Hermite) |
| 8  | smooth   | ✅ | 1-pole τ-smoother |
| 9  | combine  | ✅ | mul/add/max/min/weighted |
| 29 | scaleBy  | ✅ | linear multiplier; k=1 bypass, k=0 mute, k=-1 polarity flip |
| 30 | polarity | ✅ | switchable phase flip (bool param), gain-lossless sign-bit flip; preferred over scaleBy(-1) for UI clarity and null-test routing (x + polarity(x) = 0) |
| 31 | constant | ✅ | zero-input fixed-value source; NaN/±Inf rejected (sticky last-good); instant jump on setParam (wrap w/ smooth for click-free ramps); DC bias / mod-port default / stub-out utility |
| 89 | abs      | ✅ | |x| full-wave rectifier; partner of `sign` for magnitude/polarity splits; NaN preserved |
| 90 | clamp    | ✅ | min/max saturator; control-safety primitive |
| 91 | sign     | ✅ | three-valued sign(x) ∈ {-1,0,+1}; NaN→0 (was generic `math` placeholder, reassigned) |
| 92 | fanOut   | ✅ | explicit 1→4 unity-gain splitter; graph already supports multi-connect, but named distribution node aids readability + instrumentation; unwired outputs skipped |
| 93 | z1       | ✅ | y[n]=x[n-1]; atomic feedback primitive — minimum-latency cycle-breaker; Float64 state + denormal flush; latency=1; chainable for multi-sample delays |
| 94 | uniBi    | ✅ | uni↔bi range remap (mod-router primitive); uniToBi=2x-1, biToUni=(x+1)/2; linear (no clamp); numeric or string mode accepted; per sandbox_modulation_roadmap.md |
| 95 | slew     | ✅ | linear-rate slew limiter, asymmetric rise/fall (ms per unit); sharp corners at rate transitions (no exponential tail — sister op to `smooth`); Float64 state + denormal flush; zero latency (transients attenuated, not delayed); default 10ms rise / 50ms fall matches analog envelope follower |
| 96 | trigger  | ✅ | Schmitt trigger w/ hysteresis (arm≥threshHi / disarm≤threshLo) + optional rising-edge pulse; gate mode = persistent 1 while armed, pulse mode = single-sample tick on arm-up; inverted thresholds coerced; Canon:dynamics §4 (beat detector pattern extracted as primitive) |
| 97 | ramp     | ✅ | triggered one-shot linear ramp generator; rising-edge trig starts sweep startVal→endVal over timeMs then holds; timeMs=0 = instant jump (clean latch-on-trigger utility); sister to `slew` (reactive) and `envelope` (signal-driven), complements `lfo` (free-running periodic) |
| 98 | quantizer | ✅ | snap-to-grid quantiser for control signals; y=offset+f((x−offset)/step)·step with f∈{round,floor,ceil}; step=0 bypass; negative step → abs; distinct from bitcrush (arbitrary-step any-range vs 2^bits amplitude); use for stepped LFO, semitone-snap pitch CV, N-position macro |
| 99 | glide    | ✅ | constant-time glide / portamento; each target change recomputes step = (newTarget − y)/glideSamples so y arrives in glideMs regardless of distance; first-sample snap (no from-zero glide); glideMs=0 instant; mid-glide retarget honors new time-to-target from current y; distinct from slew (const rate) and smooth (exponential asymptote) |
| 100–102 | _reserved_ | ⬜ | |

### Noise (#10, #123–#125)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 10  | noise (white/pink/brown) | ✅ | Canon:synth §8 (Trammell) + §10 (LCG) |
| 123 | sampleHold               | ✅ | SC Latch_next_aa semantics: rising-edge (prevT≤0 && curT>0) latches `in`; two audio inputs (in, trig), no params; golden 076a27c7… (14 tests) |
| 124 | crackle                  | ✅ | SC Dust/Dust2 algorithm over feldkirch PRNG; uni/bipolar; density in Hz; golden 721f60ca… (14 tests) |
| 125 | hiss                     | ✅ | Shipped 2026-04-24. **Two open primaries**: (1) feldkirch "Fast Whitenoise Generator" musicdsp archive (2006-02-23) — two 32-bit XOR-add counters scaled by `2/0xffffffff`, seeds `x1=0x67452301, x2=0xefcdab89` (SHA-1 IVs); (2) Paul Kellett "Filter to make pink noise from white" (musicdsp/pink.txt, March 2000) — refined 7-tap weighted sum of 1st-order filters, ±0.05 dB above 9.2 Hz at 44.1 kHz, unity gain at Nyquist. Both ported verbatim. PRNG: `x1^=x2; out=x2·SCALE; x2+=x1`. Kellett pink: `b0=0.99886·b0+white·0.0555179; ...; pink=Σb_i+white·0.5362; b6=white·0.115926`. Design picks NOT math-by-def (carved): (i) Kellett coefs sample-rate-locked at 44.1 kHz; Lubomir's ranged tables are upgrade path (debt a); (ii) PRNG not CSPRNG-grade (debt b); (iii) `y·=0.11` post-scale to match pink-RMS↔white-RMS under shared `level` dB (empirical, not in Kellett — debt c). Params: `level∈[-60,0]` dB default −24, `tint∈{0 white, 1 pink}` default 1. Pure source, zero-latency. Golden committed. 14/14 tests PASS (finiteness, bounds, spectral tilt pink<white, level dB accuracy ±12/−60 dB, white RMS ≈ 0.577, determinism, block continuity, DC≈0). |

### Movement / Modulation (#11, #58–#61)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 11 | lfo              | ✅ | Canon:synth §6 (coupled sin/cos) + phase-sync shapes |
| 58 | randomWalk       | ✅ | SC BrownNoise reflective-boundary walk over feldkirch PRNG; `step` scalar + `level`; golden f2ad50ff… (14 tests) |
| 59 | stepSeq          | ✅ | SC Stepper-counter + 8-step value table (s0..s7); rising-edge trig advances; `length` 1..8 wrap; idx=-1 sentinel for clean step-0 first-fire; golden 076a27c7… (14 tests) |
| 60 | chaos            | ✅ | SC Logistic-map y=r·y·(1-y) (May 1976); audio-rate or held at `freq` Hz; uni/bipolar; r∈[2.5,4]; golden c3860085… (15 tests) |
| 61 | envelopeFollower | ✅ | Shipped 2026-04-24. Primary: Bram de Jong, "Envelope follower with different attack and release", musicdsp.org archive #136, 2003-01-15 (open). Verbatim recursion: `if (|x|>env) env = atk·(env−|x|) + |x|; else env = rel·(env−|x|) + |x|`. Coefficient formula per Bram: `coef = exp(log(0.01)/(ms·sr·0.001))` — **−40 dB time-constant convention** (time for env to fall 100 %→1 %), ~4.6× faster than the e-folding (1/e) convention used by this codebase's #4 envelope. **Distinct from #4 envelope**: #4 is control-rate + amount/offset remap (modulation use, e-folding τ); #61 is audio-rate raw linear magnitude (sidechain/meter use, Bram −40 dB τ). Added non-primary RMS mode (mode=1, smoothed x² → √) using release coef per Zölzer DAFX §4.2 style; flagged as debt (a). Params: `attack∈[0.1,1000]` default 5 ms, `release∈[1,5000]` default 120 ms, `mode∈{0 peak,1 RMS}` default 0. Zero-latency, one-sided output. Golden committed. 16/16 math tests PASS (DC rise, −40 dB release convention, attack lag, release decay, rectification symmetry, RMS settles to sig/√2, one-sidedness, block continuity). |
| — | (#62 reassigned to Analysis/Spectral for mfcc, 2026-04-24) | | |

### Character / Saturation (#12–#14, #88, #111–#117)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 12  | oversample2x    | ✅ | hiir by Laurent de Soras (WTFPL) — StageProcFpu.hpp L60-L80 + Upsampler2x/Downsampler2x process_sample + PolyphaseIir2Designer.h L451-L585 (full designer ported: atten+TBW → coef array; lane split even/odd). Round-trip op: in → 2× up → pair(prevOdd,curEven) → 2× down → out. Latency=1. Golden 881a62d8b9f94b66…. |
| 13  | saturate        | ✅ | Canon:character §11 (Padé, drive+trim) |
| 13a | drive           | ✅ | Codegen-tier (T8) tanh saturator with 2× oversampling. `y = tanh(k·x)/tanh(k)` where `k=drive` clamped [0.1, 20]; pre-tanh upsample via 63-tap Kaiser β=10 halfband FIR (≈100 dB stopband, passband flat to 19 kHz @ 48k); decimate symmetric. Latency 31 samples. JS↔native parity bit-exact (-100 dB tol). First FIR-bearing op shipped through codegen — discovery surface for the MasterGraph stereo state-isolation bug (codegen_design.md §4.1, ship_blockers.md §7); regression-gated by `qc:stereo`. |
| 14  | bitcrush        | ✅ | Canon:character §8 (primitive core; dither/NS are #114/#115) |
| 17  | dcBlock         | ✅ | 1-pole HP, FB-safety · ship_blockers.md |
| 88  | softLimit       | ✅ | Canon:character §11 (Padé, threshold-scaled) |
| 111 | transformerSim  | ✅ | Jiles-Atherton 1986 anhysteretic Langevin waveshaper. Primary: Wikipedia "Jiles-Atherton_model" (verbatim equations: `H_e=H+α·M`, `M_an=M_s·(coth(H_e/a)−a/H_e)`, `B=μ₀(H+M)`; original JMMM paper paywalled). Ships `y = output·[L(drive·x+bias) − L(bias)]` with L(x)=coth(x)−1/x (Taylor near 0 for numerical safety). DC-bias term removes static offset while preserving even-harmonic content (asymmetric core magnetization). Deviations: (1) anhysteretic-only — no hysteresis loop (no irreversible branch, no memory); (2) no freq-dep saturation (missing Φ=∫V·dt pre-integrator); (3) no HF loss (leakage L + winding C roll-off not modeled); (4) α inter-domain coupling term not exposed. Golden `32dd8faeb67388f7…`. 2026-04-24. |
| 112 | tapeSim         | ✅ | Magnetic tape character — 3-stage chain: gloubi-boulga waveshape → RBJ peaking biquad (head-bump) → 1-pole LP (HF loss). Primaries opened: (A) **Gloubi-boulga** musicdsp #86 (Laurent de Soras 2002, verbatim: `x=in·0.686306; a=1+exp(sqrt(|x|)·-0.75); out=(e^x − e^-xa)/(e^x + e^-x)`). (B) **RBJ peakingEQ** w3.org/TR/audio-eq-cookbook verbatim: `b0=1+αA, b1=-2cos ω₀, b2=1-αA, a0=1+α/A, a1=-2cos ω₀, a2=1-α/A` with `A=10^(dB/40)`, `α=sin(ω₀)/(2Q)`. (C) 1-pole LP `α=1-exp(-2π·fc/Fs)` math-by-definition. Peak uses DF2T. Params: drive, bumpHz, bumpDb, bumpQ, hfHz, trim. Deferred: hysteresis, wow/flutter, pre-emphasis, speed-calibrated HF ceiling. Golden `24d5b7de6e51770a…`. 2026-04-24. |
| 112a | tapeAirwindows | ✅ | Airwindows ToTape9 faithful mono port (MIT, Chris Johnson). PRIMARY: `ToTape9Proc.cpp` (806 lines, github.com/airwindows/airwindows raw, fetched to `node_modules/.totape9_primary.cpp`). 12-stage chain ported verbatim: Dubly encode → flutter (1000-sample circular + LCG-jittered sin sweep) → 9-threshold golden-ratio bias/slew (spacing=φ=1.618033988…) + under-bias sticking → tiny hysteresis leak → pre-avg cascade (2/4/8/16/32-tap) → **Taylor-sin saturator** clamp ±2.305929007734908, coefs `/6, /69, /2530.08, /224985.6, /9979200` (lines 223-234, "degenerate Taylor sin()") → post-avg cascade → head-bump **tan-K dual-biquad BPF** (reso=0.618033988…=1/φ, A/B staggered B.freq=0.9375·A.freq, cubic soft-clip `x-=x³·0.0618/√ovs` pre-biquad, lines 65-81,284-305) → Dubly decode → output gain. Stereo→mono, double→float. Skipped: ClipOnly3 post-limiter (→ #88 softLimit), noise-shape dither (→ #114). xorshift PRNG seeded 17 per Airwindows canonical init. 8 params all 0..1 normalized. Debt against #112 logged. Golden `3f9e3e603910bce9…`. 2026-04-24. |
| 113 | tubeSim         | ✅ | Norman Koren 1996 SPICE triode model (12AX7). PRIMARY: `normankoren.com/Audio/Tubemodspice_article.html` fetched to `node_modules/.koren_primary.html`, eq.(4): `E1 = (EP/kP)·log(1+exp(kP·(1/μ + EG/sqrt(kVB+EP²))))`, `IP = (E1^X/kG1)·(1+sgn(E1))`. 12AX7 params from Koren's table: μ=100, X=1.4, kG1=1060, kP=600, kVB=300. Sandbox mapping (math-by-definition): `EG = -bias + drive·x`, subtract quiescent IP0=koren(-bias), scale by kg1/400. Memoryless waveshaper — asymmetric: positive side soft-saturates via softplus curve, negative side hard-clips at cutoff (IP=0 when E1≤0). Overflow guards on inner>30 / inner<-30 (<1e-13 error). Deviations: no grid-current above EG=0, no plate-load dynamic coupling, no Miller HF roll-off (compose externally: #9 shelf, #17 dcBlock, #111 transformerSim). 9 params expose full Koren parameter vector for tube-swapping. Golden `6f456deecdf6b20b…`. 2026-04-24. |
| 114 | noiseShaper     | ✅ | musicdsp #99 "Noise Shaping Class" (NS9dither16.h, 2002–04) — generalizes #115 dither to N-tap FIR error-feedback with psychoacoustic coefficient banks (Gerzon/Lipshitz/Vanderkooy/Wannamaker JAES 1991). Verbatim coefs: F9={2.412,-3.370,3.937,-4.174,3.353,-2.205,1.281,-0.569,0.0847}, ME9, IE9, IE5, F3, Simple2. Canonical loop (NOT the primary's unrolled version — that has an EH-index typo, flagged in header). TPDF wi·(r1-r2) dither. Order snap 2|3|5|9; weighting 0..3 only active at order=9. Deterministic LCG (Canon:synthesis §10). Golden `b8a601fe7aefe136…`. 2026-04-24. |
| 115 | dither          | ✅ | Paul Kellett 2002, musicdsp #61 "Dither Code" — TPDF `wi·(r1−r2)` + 2nd-order error-feedback shaping `in += s·(2·s1−s2)`. Kellett constants: `w=2^(bits-1); wi=1/w; o=wi/2`. C-truncation floor fix for negative `tmp`. Deterministic LCG (Canon:synthesis §10) replaces `rand()` for golden stability. Output stays float (simulated bit reduction, not int conversion — sandbox pipeline constraint). Params: bits(1..24), shape(0..1 feedback gain), seed. Golden `616ddc32c31263bb…`. 2026-04-24. |
| 116 | chamberlinZeroCross | ✅ | Sign-magnitude DAC zero-crossing character (Chamberlin 1985 §12.4, physical book — PRIMARY NOT DIRECTLY OPENED, math-by-definition paraphrase). Two artifacts: (1) dead zone `|x|<dz → 0` (sign-mag missing two's-comp ±LSB adjacency); (2) one-sample spike `±glitch` at each sign change (DAC code-flip settling transient). Wikipedia crossover-distortion consulted for mechanism cross-check (same subjective kink character, different cause). Rasp-on-slow-crossings not modeled (debt). Golden `25c298a2db3b774a…`. 2026-04-24. |
| 117 | fpDacRipple     | ✅ | Floating-point DAC ripple (ValhallaVintageVerb 70s/80s-mode fingerprint). **PRIMARY NOT DIRECTLY OPENED** — Costello's algorithm closed-source; Valhalla public statements describe the concept only, no verbatim math. Concept sources (via WebSearch 2026-04-24): Sean Costello KVR synthesis ("12 bit 'floating point' ADC/DACs of the RMX16 ... clever hardware that would add 3 bits of gain staging ... added a bit of noise to his '12 bit floating point DAC' code"); Sound On Sound RMX16 review (2 bits gain-ranging; conflicts with Costello's 3 — parameterized). Structural ref: Wikipedia "Block floating point" + TI SPRA948. Ships math-by-definition: per-sample `e = clamp(floor(-log2|x|), 0, expBits)`, mantissa quantize `round(x·2^e·M)/M` with `M=2^(bits-1)`, reconstruct `·2^-e`, add exponent-scaled tail noise (Costello fix for decaying-tail fizzle). Params: bits(4..16, 12=RMX16), expBits(0..4, 3=Costello), noise(0..0.01), seed. Deterministic LCG. Golden `bfe1c79c14fd8bbc…`. 2026-04-24. |

### Delay / Time (#15, #27–#28, #48, #68–#69)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 15 | delay (unified, Hermite-4) | ✅ | Canon:time_interp §1 |
| 27 | bbdDelay      | ✅ | Holters-Parker 2018 DAFx (§3.3 eqs 26-33 + Juno-60 Table 1) — **v1 pragmatic reduction**: topology only (pre-LPF → BBD FIFO → post-LPF + feedback); 2nd-order Butterworth LPF per side (RBJ cookbook) replaces the 5-pole modified-impulse-invariant form; no dn fractional-sample timing; Juno-60 Table 1 coefficients pasted into worklet comment for v2 port but NOT consumed at runtime. Params: delayMs / aaHz / feedback (clamped ±0.95) / mix (cos/sin equal-power per dry_wet_mix_rule). |
| 28 | pitchShift    | ✅ | Bernsee smbPitchShift.cpp (1999-2015) — downloaded via curl to C:/Users/HEAT2/Downloads/smbPitchShift.cpp, lines 60–219 read verbatim. Streaming phase-vocoder: internal FIFO → Hann-windowed 2048 FFT → bin-shift (⌊k·pitchShift⌋) → phase-accumulated synthesis → OLA (osamp=4, hop=512). Self-contained Cooley-Tukey radix-2 `smbFft`. All analysis/processing/synthesis/OLA formulas pasted verbatim in worklet docstring; transcribed line-for-line. pitch clamp [0.25, 4.0]. Latency = 1536 samples reported. Distinct from #68 phaseVocoder (frame-in/frame-out, osamp=1) — #28 is the user-facing shifter with OLA + FIFO. |
| 48 | lookahead     | ✅(alias) | Duplicate slot — resolves to #45 lookahead. No separate worklet; opRegistry has one `lookahead` entry. Closed 2026-04-24. |
| 68 | phaseVocoder  | ✅ | Bernsee **smbPitchShift** (WOL, cited via TarsosDSP port) — analysis: magn=`2·√(re²+im²)`, phase=`atan2(im,re)`, phase-diff wrap `qpd = trunc(tmp/π)` → true-freq `k·fpb + tmp·fpb`; bin-shift by `pitchShift` (clamped [0.25, 4.0]); synthesis: phase accumulation `sumPhase[k] += …` → `re=magn·cos(φ), im=magn·sin(φ)`. **osamp=1, hop=size** (no OLA overlap — contract: one frame in → one frame out). Verbatim loops pasted in header. Denormal flush on sumPhase. Quality OLA (osamp≥4 w/ STFT-hop coordination) + peak-locking Puckette/Laroche tracked as P2. |
| 69 | granularBuffer | ✅ | SC GrainBuf active-grain pool · 16 grains · Hann · linear interp · self-owned ring buf |

### Space (#16–#21, #103–#110, #118)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 16 | allpass    | ✅ | Canon:filters / DAFX §5.2 — 1st-order allpass, unity magnitude, phase-shifting building block |
| 18 | _reserved_ | ⬜ | |
| 19 | diffuser   | ✅ | Schroeder allpass diffuser — 4-section DF-II cascade, mutually-prime delays {23.83, 7.64, 2.56, 0.975} ms (JOS "1051, 337, 113" set at 44.1k + 43-samp extension). `v(n)=x-g·v(n-M); y=g·v+v(n-M)` per JOS PASP "Allpass as Two-Comb Cascade". True allpass (flat magnitude verified at 200/1k/4k/10k Hz); `g` clamped ±0.99; `size` ∈ [0.5,2.0]; denormal flush per section. Composes with #20 fdnCore for full Schroeder/Moorer/Freeverb-style reverb graphs. |
| 20 | fdnCore    | ✅ | 8-channel Geraint Luff FDN — exponentially-spaced delays (100·2^(c/8) ms, 100…183ms), Householder orthogonal feedback x -= 0.25·Σx (less mixing than Hadamard so channels stay distinct), per-channel 1.5kHz HF shelf for frequency-dependent decay; params decay(0..1, RT60 0.3s…30s exponential, freeze at ≥0.99) + hf(0..1, 0.02…0.99 HF retention); mono sum output (1/√N energy-normalized); THE reverb-family workhorse — every full reverb wraps this; latency=0; reverb_engine_architecture.md |
| 21 | ER (early reflections) | ✅ | JOS PASP "Early Reflections" + "Tapped Delay Lines" — TDL structure quoted verbatim ("taps on the TDL may include lowpass filtering for simulation of air absorption", "Non-interpolating taps extract signals at fixed integer delays"). 12 integer-delay taps over 5.3–79.3 ms at roomSize=1, gain ~0.85/(1+0.45·k) (image-source-derived, NOT Moorer 1979 Boston Symphony Hall — that table not openly hosted; declared deviation #1). Post-sum Butterworth LPF at `airHz` replaces JOS's per-tap-LPF option (deviation #2). Params: roomSize [0.25,2.0] / airHz / level / mix (cos/sin equal-power). |
| 103 | panner     | ✅ | Shipped 2026-04-24. Primary: Dannenberg/Dobson "Loudness Concepts & Panning Laws" (CMU ICM online readings, https://www.cs.cmu.edu/~music/icm-online/readings/panlaws/index.html, open). Three canonical laws shipped verbatim: **linear** `L=(π/2−θ)·2/π, R=θ·2/π` (−6 dB center dip); **constant-power** `L=cos θ, R=sin θ` (−3 dB center, `cos²+sin²=1`, 0 dB power); **−4.5 dB compromise** `L=√((π/2−θ)·2/π·cos θ), R=√(θ·2/π·sin θ)` (geometric mean of the first two). User-facing `pan ∈ [-1,+1]` maps to `θ = (pan+1)·π/4` (DAW convention). `law` enum {0 linear, 1 const-pow default, 2 −4.5 dB}. Stereo `in2` mono-sums at ×0.5 (inherits haas debt (j)). Stateless, zero-latency. Golden `2165c0d49202658c…`. 18/18 math tests PASS. |
| 104 | autopan    | ✅ | Shipped 2026-04-24. Declared **composition** of two already-opened primaries: #11 lfo (Puckette *Theory and Technique of Electronic Music* §5.2 "Multiplying audio signals", AM formula `[2a cos(ωn)] · [cos(ξn)]`, sub-audio modulator → time-varying gain) driving #103 panner (Dannenberg/Dobson CMU ICM constant-power pan law, `gL=cos θ, gR=sin θ`). Per-sample gain recompute (not block-rate like #103) → no zipper on fast rates. Three LFO shapes shipped: sine `sin(phase)`, triangle `1−4·|p−0.5|`, square `phase<π ? +1 : −1`. `θ = π/4·(1+depth·lfo)` maps LFO ∈ [-1,+1] to θ ∈ [0, π/2] at depth=1. Params: `rateHz∈[0.01,20]` default 1, `depth∈[0,1]` default 1, `shape∈{0,1,2}` default 0 (sine), `phaseDeg∈[0,360]` default 0. Stereo `in2` mono-sums at ×0.5 (inherits haas debt (j)). Zero-latency. Golden `90c9fb4be1cc86b5…`. 15/15 math tests PASS. |
| 105 | haas       | ✅ | Shipped 2026-04-24. Primary: Haas 1951 "Über den Einfluss eines Einfachechos auf die Hörsamkeit von Sprache" Acustica 1(2):49-58 / JAES 1972 20(2):146-159 — **AES-paywalled, not opened**. Accessible secondary: Wikipedia "Precedence effect" (fetched 2026-04-24) restating Haas's four time-window thresholds verbatim: <2 ms summing-localization; 2-5 ms precedence; 5-30 ms echo-suppression with up to +10 dB lagging-level headroom; >30 ms discrete echo. DSP **core** is math-by-definition (ring-buf delay + scalar gain + routing + crossfade); primary constrains only param ranges & defaults. Two sub-decisions NOT math-by-def, shipped without primary consult: (1) fractional-delay tap = first-order linear interp — menu alternatives (Hermite / Niemitalo / Thiran) documented in JOS PASP Ch.4, Zölzer DAFX §11.3, Canon:time §1–3; (2) stereo `in2` summed at scalar ×0.5 — equal-power ×1/√2 is the correlated-source alternative. Both upgrade paths in research_debt #105 (i) + (j). Ship: `delayMs∈[0,50]` default 18 (mid echo-suppression window), `levelDb∈[-24,+10]` default 0 (Haas ceiling honored), `side∈{0,1}`, `mix∈[0,1]`. Stereo input auto-sums to mono before widening. Outputs L/R audio-rate. Golden `5e30d246bc68a8d5…`. 16/16 math tests PASS. |
| 106 | microDetune | ✅ | Two-tap crossfading delay-line pitch shifter (Faust `transpose` from misceffects.lib, MIT). Cents-param surface, positive-modulo phase wrap, 200 ms ring buffer cap. 14 tests incl. octave-up/down ZC ratios + block-boundary continuity. |
| 107 | schroederChain | ✅ | Schroeder 1962 JAES "Natural Sounding Artificial Reverberation" — 4 parallel combs (29.7/37.1/41.1/43.7 ms) → 2 series allpasses (5.0/1.7 ms, g=0.7); per-comb g=10^(−3τ/T60); opt-in Moorer 1979 damping LPF in comb FB; stereo via Freeverb `spread` offset; first digital reverb — ancestor of #20/#108/#109/#110 |
| 108 | plate      | ✅ | Dattorro 1997 JAES verbatim Fig.1 + Table 2; synthetic stereo from mono tank. **Lexicon 224 lineage** — Dattorro's figure was authored by David Griesinger (Lexicon chief scientist, 1977 Lexicon 224 prototype onward) and published with Griesinger's written permission (see `Downloads/Griesinger.pdf` attribution letter). This op IS the canonical substrate for any Lexicon 224 / 480L / PCM-family clone — tune via `decay` (tank RT60), `damping` (HF absorption = 224 "HF Cut"), `bandwidth` (input 1-pole LPF = 224 "Bass"/rolloff), `modDepth`/`modRateHz` (EXCURSION=16 samples @ ~1 Hz matches 224 chorus default), `size` (uniform delay-line scale). Do NOT ship a separate `lexicon224`/`griesingerTank` op — it would duplicate this topology verbatim. |
| 109 | spring     | ✅ | Parker 2011 EURASIP §2 / Välimäki 2010 — stretched-AP cascade in FB, C_lf+C_hf dual loop |
| 110 | SDN        | ✅ | De Sena et al. 2015 IEEE/ACM TASLP §III — 6-wall shoebox, K=5 isotropic scatter A=(2/K)11ᵀ−I, Sabine β, first-order exact via mirror-image nodes |
| 118 | crossfeed  | ✅ | Shipped 2026-04-24. Primary: libbs2b v3.1.0 (Boris Mikhaylov, MIT) — canonical open implementation of Bauer 1961 "Stereophonic Earphones and Binaural Loudspeakers" concept (AES paywalled, paraphrased via bs2b math). Ported verbatim from `DeaDBeeF-Player/bs2b/libbs2b-3.1.0/src/bs2b.c` L131–L215. Coefficient init and per-sample topology: two one-pole IIRs per channel (lowpass on cross-fed signal, high-shelf on direct), cross-summed `L=hi[L]+lo[R]`, `R=hi[R]+lo[L]`, then `·gain` where `gain = 1/(1−G_hi+G_lo)` compensates the bass-boost allpass loss. Coefficient derivation: `GB_lo=feed·−5/6−3`, `GB_hi=feed/6−3` (dB), `G_lo=10^(GB_lo/20)`, `G_hi=1−10^(GB_hi/20)`, `Fc_hi=Fc_lo·2^((GB_lo−20log10 G_hi)/12)`. Only deviation: user `feed` param is dB directly (bs2b stores tenths-dB internally; pre-divide dropped). Params: `fcut∈[300,2000]` default 700 Hz, `feed∈[1,15]` default 4.5 dB. Zero-latency, denormal-safe (x<1). Golden committed. 14/14 math tests PASS (hard-L→R bleed, mono=allpass unity, swap symmetry, separation scales with feed, DC-pass, determinism, block continuity). |
| —   | fdnReverb (monolithic brick) | 🟨 | Pre-Stage-3 MorphReverb port wired into `FdnHallOrb`. Not on canonical 1–130 list; stays in `opRegistry.js` as a monolithic wrapper around the Geraint Luff FDN (Hadamard diffuser + Householder FB + HF shelf). Re-decomposes into #20 fdnCore + diffuser/shelf primitives at Stage 3. Params: morph/size/decay/tone/density/warp/mix (all 0..1 normalised). |

### Routing (#22–#26, #39, #127–#130)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 22 | msEncode   | ✅ | Blumlein 1933 sum-and-difference matrix. M=(L+R)/2, S=(L−R)/2. Stateless, zero-latency, denormal-clean. Inverse of #23 msDecode — round-trip identity verified cross-op. In-repo precedent: `WidthModule` at `src/core/dspWorklet.js:1043`. |
| 23 | msDecode   | ✅ | Blumlein 1933 sum-and-difference matrix. L=M+S, R=M−S. Stateless, zero-latency, denormal-clean (no recursion). Inverse of #22 msEncode. In-repo precedent: `WidthModule` at `src/core/dspWorklet.js:1040`. |
| 24 | select     | ✅ | 1-of-4 hard switch — out = in_k where k = clamp(floor(index),0,3). Stateless, zero-latency, block-rate param. Hard-edge (zipper at index change); smooth switching is #25 crossfade. Math-by-definition; fixed-N matches sandbox convention. |
| 25 | crossfade  | ✅ | Equal-power A↔B crossfader. Canonical cos/sin law `gA=cos(p·π/2), gB=sin(p·π/2)` per Blumlein 1933 / Bauer 1961 / JOS "Equal-Power Panning". Same DSP bit-for-bit as #7 mix; A/B routing vocabulary with `position` param. Stateless, zero-latency. Constant-power invariance verified on uncorrelated inputs. |
| 26 | busSum     | ✅ | 4-input unity-gain summing bus. out = in0+in1+in2+in3; missing ports contribute 0. Stateless, zero-latency. Dual of #16 fanOut. Math-by-definition; fixed-N shape matches sandbox port convention. |
| 127 | splitter  | ✅(alias) | Duplicate slot — resolves to #36 `fanOut` (1→4 splitter). No separate worklet. Closed 2026-04-24. |
| 128 | merge     | ✅(alias) | Duplicate slot — resolves to `busSum` (4→1 unity-gain summer). No separate worklet. Closed 2026-04-24. |
| 129 | multiplex | ✅(alias) | Duplicate slot — resolves to `select` (4→1 index-routed switcher). No separate worklet. Closed 2026-04-24. |
| 130 | _reserved_ | ✅(reserved-empty) | No spec. Reserved for a future routing primitive (e.g. N×M matrix) when a real need surfaces. Not blocking. |

### Synth generators (#41, #79–#87)

> ⚠ **Ship rule for this family** (see `sandbox_op_ship_protocol.md` →
> Family-specific rules → Synthesis). Two primaries minimum per op.
> Before any sine/osc variant, open JOS PASP **Digital Sinusoid
> Generators** — it enumerates DFR / 2D-rotation / coupled-form as
> three *distinct* ops, not aliases. Before any BL osc, open Stilson &
> Smith 1996 + Brandt 2001 + Välimäki 2007. Canon entries are pointers,
> not sources.

| # | opId | status | research / notes |
|---|------|--------|------------------|
| 41 | adsr (synth)         | ✅ | cross-ref → #40 (shipped 2026-04-24) |
| 79 | sineOsc              | ✅ | Direct-Form Resonator (DFR) per JOS PASP, Digital Sinusoid Generators — `ccrma.stanford.edu/~jos/pasp/Digital_Sinusoid_Generators.html`. x₁(n)=2cₙ·x₁(n−1)−x₂(n−1); cₙ=cos(2πfT); stable \|cₙ\|≤1. Phase-0 init from McCartney CMJ 2002 (musicdsp #9). Optional freqMod control input (linear FM). Golden `1a00b947ee174c20…`. 2026-04-24. |
| 80 | wavetable            | ✅ | Single-cycle wavetable oscillator with bilinear (inter-sample × inter-table) linear interp — pattern from SuperCollider `server/plugins/OscUGens.cpp` Osc UGen `lookupi1(table0, table1, phase, lomask)` (~L1137). 4-table built-in bank (sin/tri/saw/square), 2048 samples each, +1 guard sample. `position ∈ [0,3]` morphs between adjacent tables. Float phase accumulator (not SC's fixed-point; filed as debt). Naive / non-bandlimited — use #81 blit or #82 minBLEP for alias-free. Optional `freqMod` + `posMod` control inputs. Golden `057862ba7486cde9…`. 2026-04-24. |
| 81 | blit                 | ✅ | Stilson & Smith ICMC 1996 §3.7 closed-form BLIT `sin(Mφ)/(M·sinφ)`, M=2⌊P/2⌋+1; STK Blit.h (Davies/Scavone 2005) reference for singularity fallback `y=1` at `sin(phase)≤ε` and wrap-at-π. Peak=1 normalization (not paper's M/P prefactor). Pulse-only v1 — saw/square/triangle are downstream integration ops (paper §4.1). Golden `169208ad011c4cd7…`. 2026-04-24. |
| 82 | minBLEP              | ✅ | Brandt ICMC 2001 "Hard Sync Without Aliasing" §4.2 windowed-sinc + §6.2 cepstral homomorphic min-phase (Oppenheim & Schafer fold) + §6.3 integrate→subtract step; martinfinke/PolyBLEP cross-check for discontinuity convention (saw jump=−2, forward-only). Inline radix-2 FFT runs once at module load. Ω=32, Nz=8, TABLE_N=512, TABLE_RES=256 (Brandt Fig 4 ships Ω=64/Nz=16 — sandbox cost tradeoff, logged as debt). Fixed-size event pool (parallel typed arrays, zero per-event allocation). getLatencySamples()=0. Golden `2916721f3d11081c…`. 2026-04-24. |
| 83 | fm                   | ✅ | Two-operator FM — Chowning 1973 `e(t) = A·sin(ω_c·t + I·sin(ω_m·t))` (CCRMA Snd docs verbatim) + Wikipedia FM cross-check for Bessel spectrum form `Σ J_n(β)·sin((ω_c+n·ω_m)t)`. Ratio-locked modulator (`f_m = f_c · modRatio`), scalar modIndex. Control inputs `freqMod` (carrier Hz offset) + `idxMod` (index offset — the DX7 envelope path). Bounded `|y| ≤ amp` by construction. Golden `200dd69f689b925c…`. 2026-04-24. |
| 84 | padSynth             | ✅ | Nasca PADsynth — zynaddsubfx §3.2.1 Gaussian `profile(fi,bwi)=exp(-(fi/bwi)²)/bwi`, per-harmonic cents bandwidth `bw_Hz=(2^(bw/1200)−1)·f·nh`, LCG random-phase fill (Canon:synthesis §10), inline radix-2 IFFT, peak-normalized N=16384 table; named harmonic profiles saw/square/organ/bell; freq change = playback-rate retune only (no rebuild). Deviations: N=16384 (vs 2^18 zyn default), deterministic LCG (vs rand()), fixed harmonic banks. Golden `7088c83a8215dbfb…`. 2026-04-24. |
| 85 | karplusStrong        | ✅ | original 1983 K-S plucked-string synth; noise-filled delay line (N=round(sr/freq)), two-point avg loop filter H(z)=½+½z⁻¹ × decay, `bright` crossfade (avg↔raw); rising-edge trig refills noise; Canon:synthesis §10 LCG PRNG; jos_pasp_dsp_reference.md §4.3 + jos_pasp_physical_modeling.md §3.2 |
| 86 | waveguide            | ✅ | Bidirectional lossy digital waveguide — two delay lines length L=round(sr/(2·freq)) with reflect+damp terminations; closed-closed (both refl>0) → full harmonic series, open-closed (one refl<0) → odd-only harmonics; K-S (#85) is the degenerate single-delay form; tube/bore/horn/cabinet/howl resonator; integer-delay only v1 (Thiran fractional is upgrade path); latency=0; JOS §4.3–§4.5 |
| 87 | scatteringJunction   | ✅ | Bare 2-port scattering junction — JOS PASP §7 "One-Multiply Scattering Junctions" Kelly-Lochbaum form: `Δ = k·(f⁺_in − f⁻_in); f⁺_out = f⁺_in + Δ; f⁻_out = f⁻_in + Δ` (1 mul + 3 adds per sample). Memoryless primitive (delays belong to surrounding waveguide sections); composable into branched tubes / T-junctions / asymmetric horns that the uniform #87a kellyLochbaum lattice can't express. |k|≤0.99 passivity clamp. Latency=0. Golden `5e30d246bc68a8d5…`. 2026-04-24. |
| 87a | kellyLochbaum       | ✅ | N-section Kelly-Lochbaum lattice (2-port scattering chain) — JOS §7.1 + §10.1 one-multiply form Δ=k·(f⁺[i]−f⁻[i+1]); params length(4..512)/taper(±0.99)/glottis/lip/damp; taper=0 collapses to cylindrical waveguide (#86); clamp to |k|≤0.99 (strict passivity); v2 upgrade path = Välimäki-Karjalainen ICSLP'94 (conical sections + fractional-delay junctions + 1st-order boundary IIRs) — see sandbox_ops_research_debt.md; latency=0 |

### Analysis / Spectral (#57, #62–#75)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 57 | stereoWidth          | ✅ | M/S energy ratio E[S²]/(E[M²]+E[S²]); 0=mono, 1=side, 0.5=decorr; pairs w/ #56 correlation (spectrum slot reassigned — generic FFT spectrum lives under #64 fft) |
| 62 | mfcc                 | ✅ | Mel-Frequency Cepstral Coefficients. Primary: **python_speech_features** (James Lyons, Apache-2.0) `hz2mel`/`mel2hz`/`get_filterbanks` + **Wikipedia MFCC** DCT-II. Pipeline: power spectrum (re²+im²) → mel-spaced triangular filterbank (precomputed dense Float64, nfilt×binCols) → log(+LOG_FLOOR=1e-10) → DCT-II `c_i = Σ S_n·cos(i·(n+0.5)·π/N_f)`. Consumes STFT/FFT complex spectrum, emits first `numCoefs` MFCCs streamed one-per-cycle. Defaults: size=1024, numFilters=26, numCoefs=13, lowFreq=0, highFreq=Nyquist. Deviations declared (all P2): no preemphasis (0.97 HP), no ceplifter (22), no appendEnergy, no ortho DCT scale (1/√2N for c[0], 1/√N rest). Slot reassigned from Movement/Modulation reserved bucket 2026-04-24. |
| 63 | convolution          | ✅ | JOS MDFT §Convolution definition `(x⊛y)_n = Σ x(m)·y(n-m)` specialized to linear FIR `y[n]=Σ h[k]·x[n-k]`. Direct-form v1: IR captured from `ir` input stream over first `length` samples (emits zero during capture), then frozen; `in` convolved each sample via O(M) inner product over a length-M history ring. `length` clamped [1,4096]; latency = length. FFT-based overlap-add (Wikipedia §Overlap-add_method / JOS SASP §Overlap_Add_Decomposition) tracked as P2 upgrade for long IRs. Float64 state, Watte denormal flush, defensive null I/O. |
| 64 | fft                  | ✅ | Cooley-Tukey iterative radix-2 (Wikipedia / Cormen Ch. 30). Canon:analysis §5 (QFT) is a convolution-reverb-targeted external tar.gz with single-precision stability limits — not appropriate baseline. Block-FFT streaming adapter: ring buffer size N (pow2, 16–32768, default 1024), one FFT per N samples, outputs real/imag bin-by-bin, held between FFTs. Golden 5f70bf18a0860070… |
| 65 | ifft                 | ✅ | Math-by-definition inverse DFT + Cooley-Tukey iterative radix-2 with conjugated twiddle (+2π/m) and 1/N scale. Same algorithm as #64 with sign flip + normalisation. Shipped 2026-04-24. Golden 076a27c79e5ace2a… (default size=1024, zero-stream hash). |
| 66 | stft                 | ✅ | JOS SASP "Mathematical Definition of the STFT" + Harris 1978 Hann window. Sliding hann-windowed FFT, hop-driven fire (default size=1024, hop=256 = 75% overlap = COLA for Hann). Top-of-loop fire ordering (same pattern as #64/#65). Golden 5f70bf18a0860070… |
| 67 | istft                | ✅ | JOS SASP "Overlap-Add (OLA) STFT Processing" — OLA resynth via bit-rev Cooley-Tukey IDFT (+2π/m twiddle, 1/N scale) + Hann synthesis window; output ring zeroes each slot on read (each OLA slot consumed once); `olaScale = hop / Σw²` compensates Hann² OLA gain (at hop=M/4, ≈0.667); default size=1024, hop=256; latency=size; denormal flush on OLA ring; COLA-condition documented in header; stft→istft round-trip asserted by test |
| 70 | goertzel             | ✅ | Single-tone magnitude detector — 2nd-order IIR tuned to freq, O(N) vs FFT O(N log N); coeff=2cos(2π·freq/sr); proper `\|X\|²=Skn²+Skn1²−coeff·Skn·Skn1` (not buggy real-only `Skn−WNk·Skn1` variant); peak-norm mag × 2/N; block-based update, latency=blockN; DTMF/tuner/sine-presence/watermark; Canon:analysis §1 |
| 71 | lpc                  | ✅ | Linear-predictive coding residual — autocorrelation + Levinson-Durbin with reflection-coef stability clamp (\|k\|≤0.999); unwarped v1 (warped Bark autocorr is upgrade path); per-block coef update, per-sample prediction-error FIR `e[n]=x[n]+Σa[k]·x[n-k]`; residual = "throat-stripped" input, standalone whisperizer FX + front-end for future vocoder/cross-synth/formant-shift; silence-gate on R[0]<1e-12; latency=blockN; Canon:analysis §2 |
| 72 | warpedLPC            | ✅ | **Bark-warped LPC**. Primary: **musicdsp #137** `wAutocorrelate` verbatim (analysis; first-order allpass `dl[k] = r1 − λ(x[k] − r2)` iterated per lag). Levinson-Durbin reused from #71 lpc. Inverse filter = warped-FIR allpass chain (canonical `z⁻¹ → D(z)` substitution; not in primary, declared deviation). Default λ=0.65 (Bark-like at 48 kHz). order ∈ [1,32], blockN ∈ [64,8192], lambda ∈ [−0.99, 0.99]. Silence-gate + |k|≤0.999 stability clamp. Shipped 2026-04-24. |
| 73 | chromagram           | ✅ | **12-pitch-class chroma**. Primary: **librosa `chroma_stft`** (feature/spectral.py) + **librosa `chroma`** (filters.py), derived from **Ellis 2007 `chromagram_E`**. ISC. Pipeline: power spec (re²+im²) → chroma filterbank (log-freq Gaussian bumps mod octave, L2 col-norm, Gaussian dominance window centred at ctroct=5 oct over A0) → L∞ per-frame norm. Pitch-class argmax verified: A4→bin 9 (C-based), C4→bin 0, octave-invariance 440↔880 Hz. Defaults: size=1024, nChroma=12, tuning=0, ctroct=5, octwidth=2, baseC=1. DC masked. Declared deviations (all v1 scope): no auto-tuning estimation (librosa runs peak-tracker over multiple frames; we take `tuning` as param, P2), L∞ only (norm knob skipped). Shipped 2026-04-24. |
| 74 | onset                | ✅ | **Spectral-flux onset detection**. Primary: **librosa `onset_strength`** + **`util.peak_pick`** (ISC); **Böck-Widmer 2013** (DAFx vibrato suppression); **Böck-Krebs-Schedl 2012** (ISMIR online peak-pick). ODF = `mean_f max(0, cur[f] − refLM[f, t−lag])` where `refLM` = freq-axis local-max-filtered lag frame. Causal peak-pick (post_max=post_avg=1 — declared deviation from librosa's offline lookahead) with three gates: local-max over preMax, ≥ mean+delta over preAvg, curFrame−lastPeak > wait. Emits `strength` (continuous, running-max normalized) + `onset` (1-sample trigger pulse at frame boundary). Params: size/lag/maxSize/preMax/preAvg/delta/wait. Shipped 2026-04-24. |
| 75 | bpm                  | ✅ | **Energy-based beat detector**. Primary: **Frédéric Patin, "Beat Detection Algorithms" (Feb 2003) pp. 5–7**, Simple Sound Energy Algorithm #3. Per-window instant energy `e = Σ x[k]²` (R1), mean `<E> = (1/H)·Σ E[i]` (R3), variance `V = (1/H)·Σ(E[i]−<E>)²` (R4), adaptive constant `C = −0.0025714·V + 1.5142857` (R6), beat iff `e > C·<E>`. Two outputs: `energy` (held instant-power per-sample-normalized `e/W`) + `beat` (1-sample trigger at window boundary). Declared deviations: mono input (stereo callers pre-sum L+R), configurable W & H (Patin hardcodes 1024/43@44.1kHz), warmup suppression for first H frames, no C clamp (faithful to paper), denormal flush. Shipped 2026-04-24. |

### Pitch detection (#76–#78)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 76 | yin   | ✅ | de Cheveigné & Kawahara 2002 JASA 111(4):1917–1930 §II — Steps 1–5 verbatim: Eq. 6 difference function, Eq. 8 CMNDF, §II.D absolute-threshold (0.1 default), §II.E parabolic interpolation over RAW d(τ) (not d′). W=25ms, f0∈[80,1000] defaults. Frame-based (hop=W, non-overlap). Silent-frame gate added (not in paper — matches librosa/aubio/crepe). Step 6 skipped (research debt). Control-rate outputs f0/confidence. 15/15 math tests green. Guyot (github.com/patriceguyot/Yin, MIT) cross-checked 2026-04-24 — CMNDF + getPitch bit-identical; 3 logged divergences (Step-4 unvoiced fallback returns global-min vs Guyot 0, Step-5 parabolic added by us, τ_max ceil vs int). |
| 77 | pyin  | ✅ | Canon:pitch §2 (Mauch 2014). Shipped 2026-04-24. Primary paper `MAUCHpYINFundamental2014Accepted.pdf` (user-supplied) + **code-wins** against `github.com/c4dm/pyin` (GPL v2+) Vamp source — Mauch's own reference. Beta PMF tables (4×100 floats) copied verbatim from `YinUtil.cpp` L178–L181. HMM constants verbatim from `MonoPitchHMM.cpp`: `nBPS=5, nPitch=345, transitionWidth=11, selfTrans=0.99, yinTrust=0.5, minFreq=61.735 Hz`. Two stages: (1) prob-threshold scan over 100 thresholds w/ cumulative Beta mass; (2) 2M-state sparse HMM (voiced + unvoiced mirror) with triangular pitch transition, fixed-lag online Viterbi (`SparseHMM.cpp`, default lag=8 frames). Outputs `f0 / voicedProb / voicedFlag`. Latency = W + lag·hop. Paper-vs-code divergences logged in op header (M=345 not 480, 61.735 Hz not 55, ±5 bins not ±25, no Eq. 4 pₐ fallback). Our own: silent-frame gate; parabolic refine on d′. Golden `80422bc3d307b4a2…`. 16/16 math tests PASS. |
| 78 | crepe | ✅ | Canon:pitch §3 (Kim, Salamon, Li, Bello ICASSP 2018, pp. 161–165). **Shipped in two stages, both landed 2026-04-24.** **STAGE 1 — architectural foundation:** registry entry w/ `kind:'neural'`, worklet shell (16 kHz resample buffer + 1024-sample frame ring + 10 ms hop + MessagePort `ml.frame`/`ml.result` protocol + Stage-1 zero-crossing mock estimator), cpp.jinja stub (mirrors I/O contract; ORT-native insertion point reserved), 22 plumbing tests, Neural Op Exception clause authored in `sandbox_op_ship_protocol.md`, codegen_design.md §12+§13 authored, golden-hash `kind:'neural'` skip-path active. **STAGE 2 — real inference (this ship):** host-side `MLRuntime.js` (isomorphic, ORT-injected, lazy+memoized session cache, MessagePort attach/detach, dispose lifecycle) + `MLRuntime.web.js` (browser ORT-Web wiring with `fetch('/models/<opId>.onnx', {cache:'force-cache'})` loader). Decoder pipeline (CREPE-canonical local-average-cents): argmax in 360-bin sigmoid → weighted mean over 9 bins (±4) using `cents = 7180·i/(N-1) + 1997.3794084376191` → `Hz = 10·2^(cents/1200)` → confidence = max sigmoid value clamped [0,1]. Weights: `public/models/crepe.onnx` = github.com/yqzhishen/onnxcrepe v1.1.0 `tiny.onnx` (1,955,762 bytes, MIT). Worklet ring-buffer chronological-ordering bug found via real ORT inference (naïve `.slice()` of the storage-order ring after wraparound put a discontinuity mid-frame and the CNN drifted ~12¢) — fixed in both worklet (`snapshot[i] = _frameBuf[(wp+i)%FRAME_SIZE]`) and cpp.jinja mirror; same fix applied to native path. New harness `scripts/check_ml_inference.mjs` (gated `qc:ml` script + `qc:ml:strict`; folded into `qc:all`); 11 tolerance-based tests pass — getSession lazy/memo, A4-440=±5¢, A3-220=±10¢, A5-880=±5¢, A2-110=±10¢, C4-261.63=±5¢, white-noise confidence<0.5, silence finite, determinism≤0.5¢, MessageChannel end-to-end, full worklet→runtime integration over 1 s of host-rate 440 Hz @ 48 kHz=±5¢. Skips gracefully if ORT-Node missing or weights absent (unless `--strict`). **PRIMARY SOURCES CONSULTED (both stages):** (1) Architecture: Kim et al. ICASSP 2018 §2 (paper) + `marl/crepe/core.py:build_and_load_model` (MIT, code-wins). (2) Weights: github.com/yqzhishen/onnxcrepe v1.1.0 `tiny.onnx` (MIT, weights converted from marl/crepe Keras MIT). (3) Inference reference: `marl/crepe/core.py:to_local_average_cents` (verbatim 9-bin ±4 weighted-mean recipe) + `predict()`. **DIFF VS REFERENCE:** I/O contract + cents grid + zero-mean unit-variance normalize all mirror reference. Verified single-frame decode: 440 Hz sine → 440.424 Hz (1.7¢ from truth). Tolerances widened from a flat 5¢ to 5¢/10¢ banded by frequency to honor CREPE-tiny's published RPA ≈0.92 single-frame reality (centre of trained distribution clean at 5¢; lower octaves widen). Worklet/native asymmetry declared in header (microsoft/onnxruntime#13072 — ORT-Web cannot run inside `AudioWorkletGlobalScope`; main-thread `MLRuntime` proxies frames over `AudioWorkletNode.port`; native path runs ORT-native inline). **STAGE 3 — native ORT-native wiring (this ship):** new shared shim `src/sandbox/host/ml_runtime_native.{h,cpp}.jinja` (`shags::ml::MLRuntimeNative` class — lazy `Ort::Session` cache keyed by opId, per-op typed `runCrepe(frame, frameLen) → CrepeResult` helper, pre-allocated 360-bin output buffer to avoid audio-thread alloc, `Ort::SessionOptions` tuned for low-latency: 1 intra-op thread, ORT_ENABLE_ALL graph optimizations, CPU EP). Decoder C++ port `decodeCrepe()` is a verbatim line-for-line mirror of `DECODERS.crepe` in `MLRuntime.js` — same argmax/9-bin/cents-grid/Hz pipeline, identical to JS within float epsilon. CMake fragment `ml_runtime_native.cmake.jinja` emits the JUCE `juce_add_binary_data` stanza for `crepe.onnx` (resource symbols `ShagsPlugModels::crepe_onnx`/`crepe_onnxSize`) + locates ORT-native via `find_package(onnxruntime)` w/ `ORT_DIR` env-var fallback + cross-platform shared-lib linkage (Win .dll/.lib, macOS .dylib, Linux .so). `op_crepe.cpp.jinja` rewritten: mock estimator gone, `dispatchFrame()` snapshots ring chronologically (Stage-2 fix mirrored), normalizes z-mean/u-std, calls `mlRuntime->runCrepe(snap.data(), FRAME_SIZE)`. Op holds non-owning `MLRuntimeNative*` wired by codegen at construction. Constructor + `setParam(const char*, double)` brought into canonical cpp.jinja convention (mirrors `OpFft`/`OpLpc`); `namespace shags::ops` added. Fail-safe: if `mlRuntime == nullptr` (graph emitted without weights, or unit-test isolation), op holds last (f0, conf) — same fail-safe the worklet uses pre-MessagePort-attach. Stage-3 native test harness deferred to T8 codegen integration (no JUCE/CMake build chain in sandbox repo); cross-language decoder regression pin lives in `qc:ml` as 4 synthetic-salience fixtures (peak at bin 180, weighted-mean over symmetric 9-bin window, edge-clamp at bins 0/359, silent/negative salience) — same fixtures will replay against `decodeCrepe()` in the future native harness. **15 of 15 `qc:ml` tests green.** **PRIMARY SOURCES (Stage 3):** ONNX Runtime C++ API headers (Ort::Env, Ort::Session, Ort::Value, Ort::MemoryInfo) + JUCE 8 `juce_add_binary_data` docs + ORT release tarball layout; decoder algorithm: same `marl/crepe/core.py:to_local_average_cents` already cited for Stage 2. **REMAINING WORK:** T8 codegen integration (JUCE plugin scaffold, CMake build server, Stage-3 native test gating) — non-blocking; sandbox + WAM both ship the worklet+MLRuntime path. |

### Loudness / Metering (#49–#56)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 49 | peak            | ✅ | Canon:loudness §1 — IEC 60268-10 peak ballistics, instant attack + 60 dB-release exponential |
| 50 | rms             | ✅ | Canon:loudness §1 — one-pole mean-square averager, sqrt output; sine 1.0 → RMS ≈ 0.707 validated |
| 51 | kWeighting      | ✅ | Canon:loudness §2 (BS.1770-5) — 2-biquad pre-filter, canonical 48k coefs match to 1e-8, K-curve validated: +0.7 dB @ 1k, +4 dB @ 10k, −1 dB @ 100 Hz |
| 52 | lufsIntegrator  | ✅ | Canon:loudness §3 |
| 53 | loudnessGate    | ✅ | Canon:loudness §3 — BS.1770-5 §5.1 two-stage gate (abs −70, rel −10 LU); integrated LUFS via 400 ms blocks on 100 ms hop; validated abs-gate rejects −80 LU tail, rel-gate drops −25 LU section |
| 54 | truePeak        | ✅ | Canon:loudness §2 Annex 2 — 48-tap polyphase FIR (4× upsample), linear-peak envelope with IEC 60268-10 1.7 s fall; DC step overshoot ≈ 1.116 (Gibbs) + steady-state 1.0016 validated |
| 55 | lra             | ✅ | EBU Tech 3342 V4 (Nov 2023) LRA = L95−L10 of twice-gated 3 s ST pool; abs −70 LUFS, rel −20 LU (not −10 LU — easy misread); nearest-rank percentile `round((n-1)·p/100)` per Tech 3342 V4 §5; relative gate computed in MS domain (×0.01 = −20 LU); 30 × 100 ms sub-blocks → 3 s rect window @ 10 Hz; primary: Canon:loudness **§3.2** (not §4 — §4 is true-peak); 12-test suite (pre-roll, abs/rel-gate edges, two-level 20-LU spread, reset, frozen tail, NaN/clamp params, determinism); golden 076a27c79e5ace2a…; ship-verified post-Phase-4 2026-04-25 |
| 56 | correlation     | ✅ | Pearson ρ, one-pole E[·]; IEC 60268-18 |

### ML / Neural (#78, #119–#122) — Stage E
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 78  | crepe   | ✅ | (duplicate of Pitch #78 — see that row for full Stage 1 + Stage 2 ship summary) |
| 119 | hrtf    | ⬜ | |
| 120 | rnnoise | ⬜ | |
| 121 | demucs  | ⬜ | |
| 122 | spleeter | ⬜ | |

### Gap-audit extensions (#131–#138) — queued 2026-04-24
Three critical (Character/nonlinearity primitives that cannot be composed
from existing #13/#88/#111–#117) plus five nice-to-haves identified by
second-pass audit against research_debt P1 ledger + Canon:character
pointers + Zavalishin VA-filter taxonomy. Family-tagged for index but
listed together to keep the audit context contiguous.

| # | opId | status | research / notes |
|---|------|--------|------------------|
| 131 | wavefolder    | ✅ | Shipped 2026-04-24. Primary: **Faust `ef.wavefold`** (David Braun, MIT — `faust_misceffects.lib` lines 1243–1259, header citing **U. Zölzer "Digital Audio Signal Processing" Ch 10 Fig 10.7**, Wiley 2022). Verbatim Faust passage in worklet header. Algorithm: `makeOdd(f, x)` makes the transfer odd-symmetric; `f(x) = ((x>1−2a) ? tri : x)·g` with `a = width·0.4`, `g = 1/(1−2a)` peak normalization, `tri = 1 − 2.5a + a·|frac((x−(1−2a))/(2a)) − 0.5|`. Buchla 259 / Serge DUSG fold-back fingerprint — **non-monotonic** transfer that cannot be composed from tanh/Padé/softLimit (all monotonic sigmoids). At width=0 → pass-through; at width=1 → fold-zone starts at \|x\|=0.2, peaks at +1, valleys at \|x\|=0.6 / 1.4. Authoring contract mirrors saturate: `drive` (1–8, pre-gain into fold), `width` (0–1, fold shape), `trim` (−24..+12 dB post-gain). Stateless. Golden committed `5fe9d191ec4f7996…`. 17/17 math tests PASS (pass-through at width=0, Faust ref match across drive/width/trim sweep, peak +1 at threshold, valley=0 at first fold, non-monotonicity, odd symmetry, drive pushes through valleys, integer-cycle DC=0). ADAA per Parker-Esqueda-Bilbao DAFx 2016 tracked as P2 upgrade. |
| 132 | diodeClipper  | ✅ | Shipped 2026-04-24. Primary: **Shockley diode equation** (Sedra-Smith "Microelectronic Circuits" 6e §3.2; W. Shockley, Bell Sys Tech J 28, 1949) + **Yeh DAFx 2008** "Simulation of the diode limiter in guitar distortion circuits" closed-form derivation + **Pakarinen-Yeh DAFx 2009** asymmetric extensions. Algorithm: closed-form arcsinh diode-pair clipper. From op-amp inverting-stage with anti-parallel diodes in feedback `I_d(v)=2·I_s·sinh(v/(η·V_t))`, the implicit equation `v_in = R_f·I_s·sinh(v_out/V_t)` solves analytically to `v_out = η·V_t·arcsinh(v_in/(η·V_t·R_f·I_s))`. Collapsing physical constants into `drive` and peak-normalizing: `y_sym = arcsinh(drive·x)/arcsinh(drive)`. Asymmetric mode reduces drive on negative side (`driveN = drive·(1−asym)`) — Tube Screamer / Big Muff signature, generates DC offset and even harmonics. Distinct from saturate (Padé tanh, bounded asymptote) and softLimit (threshold-Padé): log-asymptotic past knee, NOT bounded. Params: `drive ∈ [1,16]`, `asym ∈ [0,1]`, `trim ∈ [−24,+12] dB`. Stateless. Golden committed `f0aafe1da63c142f…`. 18/18 math tests PASS (closed-form sweep, peak norm, bounded, drive monotonicity, log-asymptote distinct from tanh, asym DC offset, asym=1 half-wave-rectifier limit, trim post-gain). Wright Omega WDF (Faust vaeffects.lib Centaur) tracked as P2 upgrade for sub-V_t accuracy. |
| 133 | hardClip      | ✅ | Shipped 2026-04-24. Primary (naive form): **Canon:character §5 "Branchless Clip" — Laurent de Soras 2004, musicdsp.org #81 (public-domain)**: `clip(x,a,b) = (\|x−a\| − \|x−b\| + (a+b))·0.5`. For symmetric ±T this reduces to `(\|x+T\| − \|x−T\|)·0.5`. Primary (ADAA mode): **Parker-Esqueda-Bilbao DAFx 2016 §III** "Antiderivative Antialiasing for Memoryless Nonlinearities". 1st-order ADAA: `y[n] = (F(x[n])−F(x[n−1]))/(x[n]−x[n−1])` where `F(u) = T·u−T²/2 if u>T; u²/2 if \|u\|≤T; −T·u−T²/2 if u<−T`. Ill-conditioned `\|Δx\|<eps` falls back to `0.5(f(x[n])+f(x[n−1]))`. Distinct from saturate/softLimit: discontinuous derivative at threshold → brick-wall harmonic content (sine → 4/π·Σ sin(nωt)/n series). Params: `drive ∈ [1,16]`, `threshold ∈ [1e−6,1]`, `trim ∈ [−24,+12] dB`, `adaa` bool default false. State: 2 doubles when ADAA enabled, zero when off. Golden committed `7251c182d54f9898…`. 16/16 math tests PASS (branchless ≡ if-then-else across sweep, drive pushes through threshold, ADAA bounded, ADAA reduces HF on aggressive clip, ADAA block continuity). |
| 134 | chebyshevWS   | ✅ | Shipped 2026-04-24. Primary: **Canon:character §4 "Chebyshev T_k Waveshaper"** (musicdsp.org #230, public-domain) + **Wikipedia "Chebyshev polynomials"** for recurrence/closed-form T_1..T_5. Algorithm: explicit memoryless polynomial sum `y = level · (g_1·T_1(x) + g_2·T_2(x) + g_3·T_3(x) + g_4·T_4(x) + g_5·T_5(x))` with `T_1=x, T_2=2x²−1, T_3=4x³−3x, T_4=8x⁴−8x²+1, T_5=16x⁵−20x³+5x`. Exploits identity `T_k(cos θ) = cos(k·θ)` — feeding a unit-amplitude sinusoid through `T_k` produces exactly the k-th harmonic, so the per-T_k weights `g_k` give precise per-harmonic dialing (mastering exciter / tape-style harmonic injector). Distinct from saturate/hardClip/wavefolder which produce harmonic spectra as a side-effect of nonlinearity — chebyshevWS lets the author specify the spectrum directly. Limitation called out per Canon §4 LIMITS: harmonic-isolation property is exact only for unit-amplitude pure sinusoidal input; complex inputs produce IM, |x|>1 produces large polynomial growth → input clamped to [−1,1] to bound output. Stateless. Params: `g1..g5 ∈ [−2,2]` (defaults g1=1, others=0 → identity), `level ∈ [0,4]`. Golden committed `1dd8f45d00ac1708…`. 16/16 math tests PASS (defaults identity, per-T_k closed-form match across [−1..1] sweep, recurrence `T_{k+1} = 2x·T_k − T_{k−1}` cross-validated, boundary `T_k(1)=1` and `T_k(−1)=(−1)^k`, harmonic-isolation via 32 zero-crossings in 16-cycle cos through T_2 = 2× harmonic, linear combination Σg_k·T_k, level scaling, |x|>1 clamp T_2(2)→1 not 7, stateless reset, defensive nulls, NaN/inf clamp). |
| 135 | diodeLadder   | ✅ | Shipped 2026-04-24. Primary: **Faust `ve.diodeLadder`** (Eric Tarr, 2019 Embedded DSP With Faust Workshop, CCRMA — `vaeffects.lib`, MIT-style STK-4.3 license) + **Will Pirkle AN-6** "Virtual Analog Diode Ladder Filter" (willpirkle.com/Downloads/AN-6DiodeLadderFilter.pdf) for the underlying TPT/ZDF formulation + **Vadim Zavalishin "Art of VA Filter Design" §7** for general ZDF ladder theory. Input shaper: **Faust `ef.cubicnl`** (JOS, STK-4.3) — pregain=10^(2·drive)·x → clip[-1,1] → x−x³/3, then ×1.5. **Verbatim Faust passage in worklet header.** Algorithm: 4-pole ZDF/TPT ladder with trapezoidal state updates `s_i' = 2·y_i − s_i`. Asymmetric stage gains `a1=1, a2=a3=a4=0.5` (diode-pair coupling — distinct from Moog #34 OTA-based 4×identical stages). Pirkle k-compensation: `k = (17 − normFreq^10·9.7)·(Q − 1/√2)/(25 − 1/√2)`. Bilinear pre-warp `wa = (2/T)·tan(wd·T/2)`. Verbatim coefficient anomaly preserved: third feedback subtraction in each cascade uses `*B2*SG3*k` (i.e. SG3, not the canonically-expected SG2) — this is Tarr's verbatim coefficient and we honor it per ship-protocol primary-fidelity rule (one-symbol fix if later proven a typo). 4 doubles state {s1, s2, s3, s4}, reset clears them. Params: `normFreq ∈ [0,1]` (cutoff, exponentially mapped 20 Hz–20 kHz), `Q ∈ [0.7, 20]` (Pirkle-compensated; self-oscillates near 20), `drive ∈ [0,1]` (cubicnl input shaper drive — at 0 pregain=1 near-linear, at 1 pregain=100 hard-clips before ladder for TB-303 acid character), `trim ∈ [-24,+12] dB`. Golden committed `4e4e269c37c0a7f6…`. 11/11 math tests PASS (LP property: 8 kHz attenuated >6 dB vs 100 Hz at midband cutoff, cutoff sweep monotonic, self-oscillation at Q=18 stays bounded over 8 k samples, stateful blocks differ from fresh, reset() returns to clean state, drive=0 near-linear, drive=1 100× pregain hard-clips, cubicnl(0.5)·1.5 ≈ 0.6875 verified, trim ±6 dB ratio = 1.995, defensive nulls, NaN/inf clamp). |
| 136 | korg35 (was steinerParker) | ✅ | Shipped 2026-04-24. **Slot renamed from `steinerParker` → `korg35`.** Honest framing: Faust public libraries do not contain a Steiner-Parker port. The closest in-character verbatim primary in hand is the Korg-35 (Korg MS-10 / MS-20 / KARP / Korg 700) — same family of Sallen-Key VA topologies with feedback nonlinearity, same MS-20 target the original slot description cited. A true Steiner-Parker (Synthacon / Crumar Bit-99) port awaits openly accessible primary (Pirkle "Designing Software Synthesizer Plug-Ins in C++" Ch 12 digitization or Stenzel "Synthacon VC3" DAFx digitization). Primary: **Faust `ve.korg35LPF`** (Eric Tarr, 2019 Embedded DSP With Faust Workshop, CCRMA — `vaeffects.lib`, MIT-style STK-4.3 license). **Verbatim Faust passage in worklet header.** Algorithm: 3-state Sallen-Key VA — stage 1 TPT LPF, resolved feedback via `(y1 + s3·B3 + s2·B2)·α0`, stage 3 TPT LPF (output), stage 2 TPT LPF on `K·y_out`. State updates `s_i ← 2·y_i − s_i` (TPT trapezoidal). Bilinear pre-warp `wa = (2/T)·tan(wd·T/2)`. Pirkle K-compensation `K = 2·(Q − 1/√2)/(10 − 1/√2)`. Self-oscillates near Q=10. State: 3 doubles {s1, s2, s3}. Params: `normFreq ∈ [0,1]` (cutoff, exp 20 Hz–20 kHz, default 0.35), `Q ∈ [0.7, 10]` (default 3.5), `trim ∈ [-24,+12] dB`. Diode-feedback nonlinearity (the analog Korg-35's "real" character) tracked as P2 — Tarr's port is the linear ZDF skeleton. HPF variant `ve.korg35HPF` exists in Faust and is reserved as a future slot or `mode` param. Golden committed `982207aa9d92e5f5…`. 10/10 math tests PASS (LP property, cutoff sweep, resonance peaking 4× over Butterworth at Q=8, self-osc bounded at Q=10, stateful blocks, reset() clean, DC gain ≈ 1, trim ±6 dB ratio = 1.995, defensive nulls, NaN/inf clamp). |
| 137 | polyBLEP      | ✅ | Shipped 2026-04-24. Primary: **V. Välimäki and A. Huovilainen, "Antialiasing Oscillators in Subtractive Synthesis," IEEE Signal Processing Magazine, vol. 24, no. 2, pp. 116-125, March 2007 — §III.B "Polynomial Transition Region (polyBLEP)"** — closed-form, widely-documented (paraphrased math-by-definition; primary read for derivation). Algorithm: two-piece quadratic correction subtracted from naive sawtooth `2t−1` to band-limit each downward step over 2 samples. For phase `t ∈ [0,1)` and increment `dt = f/SR`: `polyBLEP(t,dt) = 2p−p²−1 if t<dt (p=t/dt); (p+1)² if t>1−dt (p=(t−1)/dt); 0 otherwise`. Output: `saw(t) = (2t−1) − polyBLEP(t,dt)`. Companion to #82 minBLEP — same use (anti-aliased subtractive saw) but no FFT/event-pool/min-phase machinery, ~10 dB more aliasing at musical pitches but trivially per-voice scalable. State: 1 double (phase). freqMod control input enables linear FM. Params: `freq ∈ [0.01, 20000] Hz` (default 440), `amp ∈ [0,4]` (default 1). Golden committed `bd5c1b01944b030c…`. 14/14 math tests PASS (closed-form polyBLEP correction at 5 boundary points, first-sample output 0 at phase=0, period 440 Hz = 109 samples/cycle exact, amplitude ±1 at low freq, amp scales linearly, alias suppression vs naive saw via max-step comparison at 4 kHz, freqMod adds to base freq, reset() returns clean phase, defensive nulls + NaN/inf clamp). |
| 138 | velvetNoise   | ✅ | Shipped 2026-04-24. Primary: **M. Karjalainen and H. Järveläinen, "Reverberation Modeling Using Velvet Noise," AES 30th International Conference on Intelligent Audio Environments, March 2007** (originator) + **V. Välimäki, S. Schlecht, J. Pätynen, "Velvet Noise Decorrelator," DAFx 2017** (decorrelator application) + **S. Schlecht, "Optimized Velvet-Noise Decorrelator," DAFx 2018** (density optimization) + **V. Välimäki, B. Holm-Rasmussen, B. Alary, H.-M. Lehtonen, "Late Reverberation Synthesis Using Filtered Velvet Noise," Applied Sciences 7(5), May 2017**. **Math-by-definition** declared: paper PDFs were unretrievable from public DAFx mirrors at ship time but the algorithm itself is universally documented and unambiguous in the broader literature. Algorithm: `Td = round(SR/density)` cell length; for each cell `m`: `k_imp(m) = round(r1·(Td−1))` impulse position with `r1 ~ U[0,1)`, `s_imp(m) = sgn(r2 − 0.5) ∈ {−1,+1}` impulse sign with `r2 ~ U[0,1)`; output `y[m·Td + k] = s_imp(m)·amp` if `k == k_imp(m)` else 0. PRNG: Numerical Recipes 32-bit LCG (a=196314165, c=907633515, m=2^32) — same constants as op_noise so authors composing noise + velvetNoise from a single seed get reproducible co-evolved streams. State: 32-bit LCG state, current cell length, sample-in-cell counter, impulse offset, impulse sign. Density clamped [50, 5000] Hz; Td recomputed on density change, takes effect at next cell boundary. Sparse output (1500 imp/s at 48 kHz → Td=32, 1 in 32 samples non-zero) — when convolved as IR, ~3% of the multiplications of a dense FIR. Foundational primitive for high-quality decorrelators / lush reverb early reflections / convolution-tail substitutes / late-reverb diffusion sections. Distinct from #10 noise (dense Gaussian-like) and #124 crackle (random Poisson burst, no grid structure). Params: `density ∈ [50, 5000] imp/s` (default 1500), `amp ∈ [0,4]` (default 1), `seed ∈ [1, 2^31−1]` (default 22222). Golden committed `038518bd9536deb7…`. 14/14 math tests PASS (exactly one impulse per Td-sample cell over 200 cells, non-zero samples are exactly ±1 — no fractional values, sign distribution balanced over 4000 cells, measured impulse rate 1500/s and 500/s within ±10 of param, same seed → identical sequence, different seed → ≥50 sample differences, reset() restores seed-equivalent state, amp=0.5 halves magnitudes, amp=0 → all zeros, density change applies on next cell boundary, defensive null/NaN-clamp, density clamped to 5000 max). |

---

### Queued character + EQ ops (#139–#140) — primaries in hand 2026-04-25
Two extension slots added after intake of three Tier-S primary sources
(Whitlock "Audio Transformers" Ballou Handbook chapter, De Paiva 2011
DAFx transformer-emulation paper, Pultec EQP-1A manufacturer manual).
Op-ship line is paused on Phase 4 gate closure — these are queued, not
in flight. Primaries are versioned at `docs/primary_sources/transformers/`
and `docs/primary_sources/pultec/`.

**2026-04-26 update:** #139 xformerSat **shipped ✅+P**. Through-path WDF
implementation (flux-tracker + Eq-34 NL-cap modulating HP corner + Eq-17
Rc hysteresis + HF leakage LP). 18-test math suite, golden, native parity
green at −138 dB worst case (tol −90). Row retained for primary-source
trail.

| # | opId | family | status | primary in hand |
|---|---|---|---|---|
| 139 | xformerSat | Character / Saturation | ✅+P (2026-04-26) | **De Paiva 2011** "Real-Time Audio Transformer Emulation for Virtual Analog Models" (EURASIP J. Adv. Signal Process., Helsinki/Aalto) — gyrator-capacitor + WDF, parameters extractable from electrical measurements alone (no destructive B-H probing). **Single power-law nonlinearity** `a·\|v\|^n·sign(v)` (Eq 15) applied to two elements: nonlinear capacitor `Cc` for B-H saturation (Eq 16, real-time form Eq 34) and nonlinear resistor `Rc` for hysteresis loss (Eq 17, Eq 18 with `vr` delayed one sample). Real-time cost ~10 mul + 1 LUT-pow per sample. Pair with **Whitlock** "Audio Transformers" (Ballou *Handbook for Sound Engineers* 4e ch.) for physics intuition (volt-second saturation, source/load impedance shaping HF resonance + LF corner). See `depaiva_transformer_emulation.md` + `whitlock_audio_transformers.md`. Five user-facing controls proposed: `drive`, `coreSize` (`a` in Eq 15), `sourceZ` (HF damping + LF corner), `loss` (`b` in Eq 17, 0 = lossless line iso), `air` (leakage HF Q). Paper-validated against **two** guitar-amp OTs (Fender NSC041318 + Hammond T1750V); preset roadmap (`tubeOT` paper-validated; `hammondOT` paper-validated; `line` and `micPre` are engineering extrapolations — flag as "v0 extrapolation" until measurements added). Backs both Pultec OT stage (#140) and standalone "iron" character. |
| 140 | pultecEQ | Tone / EQ | ⬜ next | **Pultec EQP-1A Operating & Service Manual** (manufacturer manual = highest possible source tier for circuit emulation). Six controls: LF freq (20/30/60/100 Hz, stepped) + LF boost + LF atten; HF freq (3/4/5/8/10/12/16 kHz) + HF boost + HF bandwidth + HF atten freq (5/10/20 kHz) + HF atten. **Three character mechanisms in series:** (a) parallel LCR boost (Q≈0.7) + LCR atten (Q≈1.0) networks → "Pultec trick" shelf-with-dip when both engaged at same frequency, (b) tube makeup amplifier (12AX7 + 12AU7) → asymmetric soft-clip with 2nd > 3rd > 4th harmonic ratio, (c) UTC-class output transformer → composes with `xformerSat` (#139) preset `tubeOT`. THD ~3% at 30 Hz under full LF boost confirms De Paiva LF-only saturation characterization. Frequency selectors stay stepped (do not interpolate — authentic behavior is rotary-stepped). Compose order: input gain → LF boost network ⊕ LF atten network → HF boost peak ⊕ HF atten shelf → tube waveshaper → xformerSat → output trim. See `pultec_eqp1a.md`. **Depends on #139 shipping first (or being inlined).** |

## Next-up queue (⬜, easy picks)
(Prior picks abs/stereoWidth/lra all shipped; refresh on next session.)
1. ~~**#34 ladder (Moog)**~~ ✅ shipped (pre-audit; confirmed green this session) — primary **musicdsp.org #24 "Moog VCF"** (mistertoast port). 4-pole LP cascade, inverted FB, cubic soft-clip `y4 -= y4³/6` Taylor-2 tanh self-limiter. Hötvinen 2×OS + per-stage tanh + BP/HP taps tracked as upgrade debt.
2. ~~**#40 adsr**~~ ✅ shipped 2026-04-24 — primary was **Canon:synthesis §12** (musicdsp #189, Schoenebeck 2005), NOT Canon:dynamics §5 as previously listed (§5 is the stereo-link peak compressor). Corrected in this pass.
3. ~~**#64 fft**~~ ✅ shipped 2026-04-24 — primary was **Wikipedia Cooley-Tukey iterative radix-2 / Cormen Ch. 30** (not QFT §5 as catalog suggested — QFT is convolution-reverb-targeted external tar.gz with known single-precision stability issues). Gate-opener for the spectral family (ifft/stft/convolution) now open.
4. ~~**#65 ifft**~~ ✅ shipped 2026-04-24 — math-by-definition IDFT (conjugated twiddle +2π/m + 1/N scale) over same Cooley-Tukey passage as #64. Closes spectral round-trip; fft→ifft null-test now a harness primitive.
5. ~~**#66 stft**~~ ✅ shipped 2026-04-24 — primary **JOS SASP "Mathematical Definition of the STFT"** + **Harris 1978** Hann window. Default size=1024, hop=256 (75% overlap, COLA-satisfied). Established top-of-loop fire-ordering pattern for streaming block transforms.
6. ~~**#67 istft**~~ ✅ shipped 2026-04-24 — primary **JOS SASP "Overlap-Add (OLA) STFT Processing"**. OLA resynth via Cooley-Tukey IDFT + Hann synthesis window; `olaScale = hop/Σw²` compensates Hann² OLA gain. stft→istft round-trip asserted as bounded-peak; exact-null verification is P2 debt.
7. ~~**#63 convolution**~~ ✅ shipped 2026-04-24 — primary **JOS MDFT §Convolution**. Direct-form linear FIR `y[n] = Σ h[k]·x[n-k]`; IR captured from `ir` input stream over first `length` samples then frozen. FFT-based overlap-add (Wikipedia §Overlap-add_method) tracked as P2 for long IRs.
8. ~~**#68 phaseVocoder**~~ ✅ shipped 2026-04-24 — primary **Bernsee smbPitchShift** (WOL, via TarsosDSP port). Analysis/bin-shift/synthesis at osamp=1 (hop=size, no OLA overlap — one frame in → one frame out). Peak-locking (Puckette/Laroche) + OLA-coordinated osamp≥4 tracked as P2.
9. ~~**#62 mfcc**~~ ✅ shipped 2026-04-24 — primary **python_speech_features** (James Lyons, Apache-2.0) + **Wikipedia MFCC**. Pipeline: power spec → mel triangular filterbank → log(+1e-10) → DCT-II. Slot reassigned from Movement/Modulation reserved bucket into Analysis/Spectral. Preemphasis / ceplifter / appendEnergy / ortho DCT scale tracked as P2.
10. ~~**#72 warpedLPC**~~ ✅ shipped 2026-04-24 — primary **musicdsp #137** `wAutocorrelate` (first-order allpass chain; `dl[k] = r1 − λ(x[k] − r2)` iterated per lag). Levinson-Durbin reused from #71 lpc. Inverse filter = canonical warped-FIR allpass-chain substitution (not in primary passage — declared deviation). Default λ=0.65 (Bark-like at 48 kHz).
11. ~~**#73 chromagram**~~ ✅ shipped 2026-04-24 — primary **librosa `chroma_stft` + `filters.chroma`** (ISC), derived from **Ellis 2007 `chromagram_E`**. Power spec → log-freq Gaussian filterbank mod octave → L2 col-norm → optional Gaussian dominance window (ctroct=5 oct, octwidth=2) → L∞ per-frame norm. Pitch-class argmax verified musically (A4→9 C-based, 0 A-based; octave invariance 440↔880). Auto-tuning estimation tracked as P2.

---

### Corpus-sweep extension queue (#141–#176) — 2026-04-26

**Origin.** Sweep of 86 corpus entries across 15 named-gear domains
(Compressors/Limiters, Console, Delay, EQ, Filters, Gates/Expanders/De-essers,
Guitar/Bass Amps, Mastering, Modulation, MultiFX, PreAmps, Reverb,
Saturation/Distortion/Color, Specialty/Exciters/Enhancers, Synths/Drum
Machines). Triage produced ~80 candidates → **30 surviving new ops**
(8 Tier-S + 22 Tier-A) + **17 Tier-B** + 4 merges + 7 param-flags + 23
recipes + 9 kills + 2 defers. Tier-B count reduced to 7 in this catalog
write — additional Tier-B slots will be added when their corpus entries
are next touched (see Tier-B note below).

**Cross-cutting headlines.**
- **Five gain-reduction elements gap.** opto / varMu / FET-VVR /
  diode-bridge / blackmer-VCA were ALL missing pre-sweep. Five new
  Tier-S slots address (#141 optoCell, #142 blackmerVCA, #145 varMuTube,
  #147 fetVVR; diode-bridge composes from #132 diodeClipper + bridge
  topology — recipe registry).
- **Tube preamp atom set.** triodeStage / pushPullPower / phaseInverter /
  cathodeBiasShift / psuRectifierSag should ship as a coherent set
  (#148, #155, #156, #157, #154). Existing #113 tubeSim becomes alias of
  triodeStage-with-defaults once #148 ships.
- **Tape primitive split.** Existing #117 tape stays as integrated
  preset; new sweep extracts wow/flutter (#175 Tier-B) and head-bump EQ
  (#171 Tier-B) as composable atoms per Korg-engineer-style mining.
- **VSTi-corner derisking.** #151 bridgedTNetwork + #152 vactrolLPG +
  #160 companding8bit derisk `deferred_domains_roadmap §9 #1`
  (VSTi exit-criteria) — synth-corpus primitives now have a home.

**Status (all rows).** ⬜ pending the 7-step ship protocol per
`sandbox_op_ship_protocol.md`. Phase 4 native-parity gate applies — every
flip to ✅+P requires Step 6 green.

#### Tier-S — primary in hand, ship-priority

| # | opId | status | family | primary in hand |
|---|---|---|---|---|
| 141 | optoCell | ⬜ | Dynamics | T4 / LA-2A opto-isolator literature; bulb-LDR thermal model (Felt 2010 / Universal Audio AN). Replaces 4 alias names: optoT4, bulbOptoEnvelope, optoCompressorCell, vactrolLPG-as-cell. Slow attack, asymmetric release, program-dependent. |
| 142 | blackmerVCA | ⬜ | Dynamics | David Blackmer dbx VCA patent (US 3,714,462) + THAT Corp 2180/2181 datasheet. Log-domain gain-cell; "vcaFader" alias closed into this slot. |
| 143 | bjtSingleStage | ⬜ | Character | Sedra-Smith "Microelectronic Circuits" 6e §5 + Helios / Neve 1073 schematic family. Discrete bipolar transistor stage with class-A bias; harmonic ratio 2nd > 3rd. |
| 144 | inductorEQ | ⬜ | Tone/EQ | Pultec EQP-1A primary (already in hand) + Neve 1073 inductor-shelf circuit. Distinct from biquad family — passive LCR with inductor losses, soft Q. |
| 145 | varMuTube | ⬜ | Dynamics | Manley Variable-Mu / Fairchild 670 service manuals. 6386 / 6BC8 remote-cutoff pentode/triode gain reduction via grid-bias modulation. Non-linear gain curve, program-dependent ratio. |
| 146 | discreteClassAStage | ⬜ | Character | Topology-parameterized BJT/JFET class-A stage covering Neve / API / SSL / Helios variants. Param `topology: 'neve' \| 'api' \| 'ssl' \| 'helios'` selects bias point + harmonic balance. |
| 147 | fetVVR | ⬜ | Dynamics | 1176 service manual + Universal Audio 2N3819 FET voltage-variable-resistor model. Fast attack (20 µs), aggressive harmonics, program-coupled THD. |
| 148 | triodeStage | ⬜ | Character | Koren 2003 "Improved vacuum-tube models for SPICE simulations" + Cohen-Helie 2010 DAFx + Macak-Schmutzhard 2010 "Real-time guitar tube amplifier simulation using approximations of differential equations." Single-triode stage with grid/plate/cathode params. **#113 tubeSim deprecates to alias of triodeStage-with-defaults once shipped.** |

#### Tier-A — primary in hand, second-wave

| # | opId | status | family | primary in hand |
|---|---|---|---|---|
| 149 | otaLadder | ⬜ | Filters | Huovilainen 2004 DAFx "Non-linear digital implementation of the Moog ladder" — distinguishes OTA (Steiner) from transistor (Moog). |
| 150 | granularPitchShifter | ⬜ | Pitch | De Götzen-Bernardini-Arfib 2000 "Traditional implementations of a phase-vocoder: the tricks of the trade" + Bernsee smbPitchShift (already shipped at #68). Distinct grain-based vs. PV. |
| 151 | bridgedTNetwork | ⬜ | Filters | Hood "Audio Electronics" + ARP 2600 / Buchla schematic family. Notch filter via bridged-T topology — distinct from biquad notch. |
| 152 | vactrolLPG | ⬜ | Filters | Buchla 292 / Make Noise Optomix / Don Buchla 1965 vactrol-based low-pass-gate spec. **Op-level** — composes with #141 optoCell at recipe level for envelope. |
| 153 | gateStateMachine | ⬜ | Dynamics | Bram de Jong canonical gate FSM (musicdsp #117) + Drugan-Reiss 2017 "Adaptive gating for noise suppression." Open / hold / release / closed states with hysteresis. |
| 154 | psuRectifierSag | ⬜ | Character | Macak-Schmutzhard 2010 + Yeh-Abel-Smith 2007 PSU droop modeling. Rectifier diode + reservoir cap; under heavy current draw, B+ sags → output level + harmonic ratio shift. |
| 155 | pushPullPower | ⬜ | Character | Cohen-Helie 2010 DAFx + Pakarinen-Yeh DAFx 2009 "A review of digital techniques for modeling vacuum-tube guitar amplifiers." 6L6 / EL34 / KT88 push-pull output stage. |
| 156 | phaseInverter | ⬜ | Character | Pakarinen-Yeh DAFx 2009 §IV. Long-tail-pair / cathodyne / paraphase variants — couples to #155 pushPullPower. |
| 157 | cathodeBiasShift | ⬜ | Character | Macak-Schmutzhard 2010 §3.2 "Self-biasing cathode behavior under signal." Cathode-cap charge state under load — slow-time-constant compression atom inside tube stages. |
| 158 | bridgedTeeEQ | ⬜ | Tone/EQ | Pultec MEQ-5 + UREI 545 manuals. Bridged-Tee mid-range EQ network — distinct from #144 inductorEQ. |
| 159 | dopplerRotor | ⬜ | Modulation | Smith-Rangertone 1939 Leslie patent + JOS PASP "Doppler effect" + Henricksen 1981 "The dual rotor Leslie speaker." LFO-driven Doppler shift + amplitude tremolo + horn-throw spectral shaping. |
| 160 | companding8bit | ⬜ | Character | µ-law / A-law (ITU-T G.711) + early sampler companding (Fairlight CMI / E-mu SP-1200 service manuals). Log-encode → 8-bit decimate → log-decode. Distinct from #15 bitcrush (linear). |
| 161 | aliasingDecimator | ⬜ | Character | Welsh 2005 "8-bit fidelity" + intentional-aliasing literature. Linear decimate without antialiasing filter — chiptune / lo-fi character. |
| 162 | ringMod | ⬜ | Modulation | Bode 1960s ring-modulator patent family + JOS "Spectral Audio Signal Processing" §4.5. Carrier × signal multiplication. **Maps to QC `isRingMod` flag once that lands.** |
| 163 | hardSync | ⬜ | Synth | Stilson-Smith 1996 ICMC "Alias-free oscillators" + Välimäki-Huovilainen 2007. Phase-reset of slave oscillator on master period boundary. |
| 164 | hilbert | ⬜ | Filters | Schüssler-Steffen 1998 + JOS SASP §A "Analytic signal." Allpass-pair quadrature network for SSB / freq-shift / pitch-shift. |
| 165 | voiceCoilCompression | ⬜ | Dynamics | Klippel 2006 "Loudspeaker nonlinearities — causes, parameters, symptoms." Voice-coil thermal compression + suspension nonlinearity. **alnicoSag merges into this slot as `magnetType: 'alnico' \| 'ceramic' \| 'neo'` flag.** |
| 166 | srcResampler | ⬜ | Foundation | Smith 2002 "Digital audio resampling home page" + libsamplerate (SSC) + Niemitalo cubic Hermite. Arbitrary-ratio polyphase. |
| 167 | linearPhaseEQ | ⬜ | Tone/EQ | Smith-Serra 1990s linear-phase FIR EQ literature + Lyons "Understanding DSP" §13. FFT-domain or long-FIR linear-phase shelf/bell. |
| 168 | gainRangingADC | ⬜ | Character | Olympus / Roland S-760 / Akai S950 service manuals — auto-ranging input gain stages, characteristic "soft-limit then digitize" hardware-converter color. |
| 169 | tapeBias | ⬜ | Character | Bertram 1994 "Theory of magnetic recording" + Camras 1985. AC bias signal injected pre-record — modulates effective record curve. Pairs with #117 tape and #175 wowFlutter. |

#### Tier-B — promoted from kill-list re-triage

| # | opId | status | family | rationale |
|---|---|---|---|---|
| 170 | presenceShelf | ⬜ | Tone/EQ | Distinct from biquad highShelf — Pultec/Neve "presence" character is a resonant shelf, not a Butterworth shelf. |
| 171 | headBumpEQ | ⬜ | Tone/EQ | Tape head-bump (LF resonant peak ~50–150 Hz from gap geometry) — extracted as composable atom from #117 tape. |
| 172 | oilCanDelay | ⬜ | Delay | Tel-Ray oil-can / Echoplex EP-3 oil-tank delay — distinct from #51 delay and tape-echo. Capacitive plate dielectric storage, narrow bandwidth, thick mod character. |
| 173 | complexOsc | ⬜ | Synth | Buchla 259 / 261 complex oscillator topology — primary modulating timbre via wave-shaping + secondary FM. Distinct from #80 osc + #163 hardSync. |
| 174 | phaseDistortion | ⬜ | Synth | Casio CZ series phase-distortion synthesis (Smith 1987 + Casio service manual). Wraps phase through a non-linear transfer pre-cosine — distinct from #82 minBLEP / #137 polyBLEP. |
| 175 | wowFlutter | ⬜ | Modulation | Tape transport pitch modulation (low-freq wow ~0.5 Hz + high-freq flutter ~6 Hz). Composable atom — promoted from "tape sub-feature" because corpus has 12+ tape-flavored entries that need it parameterized independently. |
| 176 | varistorVibrato | ⬜ | Modulation | Univibe / Shin-ei Companion vibrato — varistor-staircase asymmetric LFO drives 4-stage phaser. Composes with #141 optoCell. Primary: Rakarrack UniVibe Canon §2 (GPLv2 reimpl) + Shin-ei service manual. |

**Tier-B note.** Sweep produced 17 Tier-B candidates total; 7 written
above (#170–#176) + 6 recovered in dedup pass below (#178–#183). 4
candidates collapsed onto already-handled atoms during recovery
(bbdLine→bbdCompander recipe, aphexPhaseCompensator→aphexHarmonicGenerator
recipe, kepexExpander→gateStateMachine, omnipressorRatio→ratioCurveBank
flag) — see Notes in §Dedup recovery.

#### Dedup-recovery pass (#177–#183) — 2026-04-26

Targeted second pass over the 15-domain corpus to close the 11-slot gap
between original synthesis (47 new) and first-write count (36). Recovery
found 7 ops with confident primary backing; honest stop short of the
projected 11 to avoid duplicate-or-recipe hallucination.

##### Tier-A — late addition

| # | opId | status | family | primary in hand |
|---|---|---|---|---|
| 177 | fmOperator | ⬜ | Synth | Chowning 1973 JAES "Synthesis of Complex Audio Spectra by Means of Frequency Modulation" + Yamaha DX7 / TX81Z service-manual algorithm tables (32 algorithms, 6 ops, env-controlled index). Sine carrier with PM input + per-op env-coupled output level + feedback tap. Distinct from #80 osc (BL/wavetable, no PM input, no per-op env-coupling). 6-op routing graph is patch-graph layer (see #183 sixOpFmAlgorithmRouter), not the op itself. Backs DX7, PPG Wave 2.x, REV7 SPX FM-tinged algorithms, Roland D-50 partial structure, FM drum models (TR-909 successor algorithms in `06_synth_drum_machines_digital_mpc.json`). |

##### Tier-B — late additions

| # | opId | status | family | primary in hand |
|---|---|---|---|---|
| 178 | differentialEnvelope | ⬜ | Dynamics | SPL Transient Designer Model 9946 service docs + SPL DET (Differential Envelope Technology) white paper. Fast-minus-slow envelope drives bipolar VCA — distinct from #61 envelopeFollower (single time constant). Backs SPL Transient Designer 9946, SPL TD4, mastering ref §05_specialty_dynamics_unique. |
| 179 | diodeBridgeGR | ⬜ | Dynamics | AMS Neve 33609/N User Manual 527-409 Issue 1.0 + Neve 2254 service schematic. Diode-bridge gain-reduction element — chemically distinct from #132 diodeClipper (signal-path soft clip). Bridge configuration steers DC bias to control instantaneous gain. Backs Neve 2254, Neve 33609/33609N, 8014 console GR module. |
| 180 | schmittTriggerOsc | ⬜ | Synth/Modulation | Werner-Abel-Smith DAFx-14 "More Cowbell" TR-808 cymbal paper + ElectroSmash MXR Phase 90 analysis. Asymmetric RC charge/discharge through CMOS hysteresis → audible non-50% duty + thermal jitter. Cannot be reproduced by #80 osc (band-limited, symmetric). Backs TR-808 cymbal/cowbell (6 osc array), MXR Phase 90 LFO core, Minimoog overload-lamp driver. |
| 181 | dispersiveAllpass | ⬜ | Reverb | Parker 2010 DAFx "Spring Reverberation: A Physical Perspective" (Välimäki/Parker stretched-allpass cascade for dispersive bending-wave delay). Distinct from #15 allpass (frequency-flat group delay) — dispersive variant has frequency-dependent group delay matching spring physics. Backs Hammond Spring Tank, Fender 6G15 Reverb Unit, AKG BX-20E, Roland RE-201 spring section. |
| 182 | blesserReverbCore | ⬜ | Reverb | Barry Blesser US Patent 3,978,289 "Electronic Reverberation Method and Apparatus" (1976) + Blesser 1975 AES paper. Distinct from #20 fdnCore (Hadamard/Householder matrix) — Blesser's structure uses a different scattering topology specific to EMT 250/251. Backs EMT 250, EMT 251. |
| 183 | sixOpFmAlgorithmRouter | ⬜ | Synth | Yamaha DX7 service manual algorithm chart (32 routings, modulator/carrier flags, FB tap on op6). Patch-graph addressed primitive: `algorithm# 1–32` selects a fixed routing of 6 #177 fmOperator instances. Borderline — could be relocated to patch-graph layer if/when that exposes per-op routing as first-class. Backs DX7, DX7 II, TX81Z, FS1R. **Marked tentative — downgrade to recipe if patch-graph layer absorbs.** |

##### Recovery notes

- **Collapsed candidates** (proposed during recovery, not slotted): `bbdLine` → covered by #112 bbdDelay + #160 companding8bit composition; `aphexPhaseCompensator` → covered by aphexHarmonicGenerator recipe; `kepexExpander` → covered by #153 gateStateMachine + ratio params; `omnipressorRatio` → covered by ratioCurveBank flag on compressor family; `analogClap`, `phaseShiftLFO`, `slidingBandFilter` → all collapse onto shipped atoms or queued recipes.
- **Skipped:** `karplusStrong` — not surfaced strongly in corpus (DX7 plucked-string is FM-emulated, no dedicated KS unit). Defer until physical-modeling corpus pass per `deferred_domains_roadmap §3` VSTi exit criteria.
- **Sweep total reconciled:** 8 Tier-S + 22 Tier-A (21 first-write + 1 recovery) + 13 Tier-B (7 first-write + 6 recovery) = **43 new slots**, not the originally-projected 47. The 4-slot delta is the 4 candidates that collapsed to existing atoms during recovery — honest synthesis correction, not a write-side miss.

#### Merges (no new slot — capability folds into existing op)

| existing op | absorbs | mechanism |
|---|---|---|
| #117 tape | tape-bias-coupling sub-feature | adds `bias` param flag (separate op #169 tapeBias remains for standalone use) |
| (#141 optoCell) | optoT4 / bulbOptoEnvelope / optoCompressorCell / vactrolLPG-as-cell | 4 alias names → single slot at ship time |
| (#142 blackmerVCA) | vcaFader | alias closed into this slot |
| (#165 voiceCoilCompression) | alnicoSag | folds in as `magnetType` flag |
| (#152 vactrolLPG) | ldrPhaserStage | folds in as `cellModel` flag — phaser-stage variant of vactrol |
| (#148 triodeStage) | #113 tubeSim deprecation | once #148 ships, #113 becomes alias of triodeStage-with-defaults |

#### Param-flags on existing ops (no new slots)

7 capability flags surfaced by the sweep that should be added to
existing ops at next-touch:

| op | new param/flag | rationale |
|---|---|---|
| #34 ladder (Moog) | `topology: 'moog' \| 'transistor' \| 'ota'` | unifies with #149 otaLadder when shipped |
| #136 korg35 | `mode: 'lp' \| 'hp'` | Faust ve.korg35HPF reserve from original ship |
| (compressor family) | `gainComputer.topology: 'feedforward' \| 'feedback'` | corpus disambiguates per-unit topology declaration (already exists on engine.capabilities — formalize as op param) |
| (compressor family) | `envelope.release: 'linear' \| 'log' \| 'program-dependent'` | covers SSL / 1176 / LA-2A spread |
| #6 lfo | `shape: 'sine' \| 'triangle' \| 'staircase' \| 'random' \| 'varistor'` | absorbs varistor-style asymmetric LFO without new op |
| #15 bitcrush | `companding: 'linear' \| 'mu-law' \| 'a-law'` | distinct from #160 companding8bit (which is the full encode→decimate→decode pipeline) |
| #20 fdnCore | `diffusion.matrix: 'hadamard' \| 'householder' \| 'random-orthogonal'` | corpus-flagged FDN matrix variants |

#### Kills (9 — composed from existing primitives, no slot)

`brickwallLimiter`, `multibandCompressor`, `deEsser`, `pingPongDelay`,
`tapeDelay` (already kill in 2026-04-24 gap-audit), `parametricEQ`,
`vocoder`, `autoTune`, `ambisonics` — all compose from shipped primitives
at the brick layer. Recipes documented in pending `recipe_registry.md`.

#### Defers (2 — agent-pipeline scope, not sandbox primitive)

- `kemperProfile` — capture/profile pipeline; belongs to agent-pipeline
  layer, not op layer. Defer until Agent Layer Roadmap gate review.
- `vssRayTrace` — VSS / wavefield-simulated reverb ray-tracing; defer
  to deferred_domains_roadmap §5 (multichannel spatial domain).

---

## Notes on reconstruction
- Slot #17 (dcBlock) is outside the Space/Filters family ranges shown in the
  original family table; assigned here because dcBlock is ship-critical but
  doesn't neatly fit "generic onePole" at #32.
- Slots `#18`, `#47–#50` surplus, `#100–#102`, `#126`, `#130` left
  as _reserved_ — can be reassigned when the need arises.
- Duplicate listings (adsr in both Dynamics & Synth, lookahead in both
  Dynamics & Time, crepe in both Pitch & ML): same op, one slot, cross-ref.
- When adding a new op: update registry + ship tri-file + **update this file's
  status column** before closing the task.
