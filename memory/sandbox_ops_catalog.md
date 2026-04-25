# Sandbox Ops Catalog — 1–130 flat index

Living checklist of every op slot in the sandbox DSP primitive set. Organised
by family; the number in the first column is the **canonical catalog ID** and
is permanent. The `status` column is the single source of truth for "what's
done vs. what's left".

## Status legend
- ✅  **shipped** — tri-file set (`.worklet.js` + `.cpp.jinja` + `.test.js`)
  complete, math tests green, `scripts/goldens/<opId>.golden.json` blessed.
- 🚧  **registry-only** — entry exists in `src/sandbox/opRegistry.js` but no
  sidecar yet (so shape-check would trip if included in OP_IDS).
- ⬜  **not started** — no registry entry, no files.

## Running total
**117 of ~130 ops shipped (~90%).**

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
Noise family complete: #10 noise (core, pre-session) ✅, #124 crackle ✅, #125 hiss ✅.
Control/trigger primitive: #123 sampleHold ✅.
Movement family complete: #58 randomWalk ✅, #59 stepSeq ✅, #60 chaos ✅.
Routing slots reconciled: #127–#129 closed as aliases of fanOut/busSum/select; #130 reserved-empty.

### Still open
- **Control primitives**: #100–#102 reserved-empty slots (no specs, not blocking)
- **Pitch**: #78 crepe (ML-gated, honest declination logged)

**Effective state: catalog is closed** modulo #78 crepe (ML-runtime-gated)
and 4 reserved-empty slots (#100–#102, #130) that have no specs to ship
against. Next moves are plugin onboarding / brick assembly, not new ops.

### Closed / complete families
- Character (assigned slots): #13, #88, #111–#117 + #112a all ✅
- Synth: #41, #79–#87 + #87a all ✅
- Dynamics (assigned slots): #3–#5, #40–#46 ✅ (#47–#50 reserved)
- Analysis/Spectral: #57, #62–#75 ✅
- Tone/EQ: #1–#17, #29–#39 ✅ (only #18 reserved-empty)
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
| Filters             | 2, 32–39 |
| Dynamics            | 3–5, 40–50 |
| Control primitives  | 7–9, 29–31, 89–102 |
| Noise               | 10, 123–125 |
| Movement / Modulation | 11, 58–61 |
| Character / Saturation | 12–14, 88, 111–117 |
| Delay / Time        | 15, 27–28, 48, 68–69 |
| Space               | 16–21, 103–110, 118 |
| Routing             | 22–26, 39, 127–130 |
| Synth generators    | 41, 79–87 |
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
| 78 | crepe | ⬜ | Canon:pitch §3 (Kim 2018, ML-gated) |

### Loudness / Metering (#49–#56)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 49 | peak            | ✅ | Canon:loudness §1 — IEC 60268-10 peak ballistics, instant attack + 60 dB-release exponential |
| 50 | rms             | ✅ | Canon:loudness §1 — one-pole mean-square averager, sqrt output; sine 1.0 → RMS ≈ 0.707 validated |
| 51 | kWeighting      | ✅ | Canon:loudness §2 (BS.1770-5) — 2-biquad pre-filter, canonical 48k coefs match to 1e-8, K-curve validated: +0.7 dB @ 1k, +4 dB @ 10k, −1 dB @ 100 Hz |
| 52 | lufsIntegrator  | ✅ | Canon:loudness §3 |
| 53 | loudnessGate    | ✅ | Canon:loudness §3 — BS.1770-5 §5.1 two-stage gate (abs −70, rel −10 LU); integrated LUFS via 400 ms blocks on 100 ms hop; validated abs-gate rejects −80 LU tail, rel-gate drops −25 LU section |
| 54 | truePeak        | ✅ | Canon:loudness §2 Annex 2 — 48-tap polyphase FIR (4× upsample), linear-peak envelope with IEC 60268-10 1.7 s fall; DC step overshoot ≈ 1.116 (Gibbs) + steady-state 1.0016 validated |
| 55 | lra             | ✅ | EBU Tech 3342 LRA = L95−L10 of twice-gated 3 s ST pool; abs −70 LUFS, rel −20 LU (not −10 LU — easy misread); nearest-rank percentile per Annex A; ebuMode aggregate stays unassigned — LRA is its core primitive |
| — | lra             | ⬜ | Canon:loudness §4 (EBU 3342) — slot pending reassignment (was #53) |
| 56 | correlation     | ✅ | Pearson ρ, one-pole E[·]; IEC 60268-18 |

### ML / Neural (#78, #119–#122) — Stage E
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 78  | crepe   | ⬜ | (duplicate of Pitch #78; same op) |
| 119 | hrtf    | ⬜ | |
| 120 | rnnoise | ⬜ | |
| 121 | demucs  | ⬜ | |
| 122 | spleeter | ⬜ | |

---

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
