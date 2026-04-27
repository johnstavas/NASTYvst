# Sandbox Ops — Research Debt Ledger

**Purpose.** Per-op ledger of *known-better* research not yet ingested into
shipped op code. This is the **inverse of an audit doc**: it records what's
*not* done so future-us can measure the gap.

**Not a blocker.** Every row here is a v1 that passes math tests + goldens +
QC. The "debt" is upgrade-path research that would produce a v2 with tighter
fidelity, better stability at extremes, or richer parameter surface.

---

## T8-B BEHAVIORAL DEBT — added 2026-04-26

The behavioral validation harness shipped Days 1–5
(`memory/behavioral_validation_harness.md`). The build surfaced
specific findings that need op-side or harness-side patches but were
not fixed during the harness build itself.

### Confirmed codegen-or-wiring bugs (worklet PASS, native FAIL)

*(empty as of 2026-04-26 — see resolution log below)*

#### Resolved

| Op | Symptom | Resolution | Closed |
|---|---|---|---|
| **tilt** | Worklet shows ~17 dB tilt across band; native VST3 shows ~6 dB at identical params (`f0=630, gain=3, gfactor=5`). | **Was NOT an op bug** — investigated by reading `op_tilt.cpp.jinja` vs `op_tilt.worklet.js`, found math identical bit-for-bit. Real cause: `run_native.mjs` was using `per_op_specs.json` `paramRanges` (which had stale gfactor range `[0.01, 100]`) instead of the authoritative `param_ranges.json` sidecar that codegen emits at build time (actual VST3 range `[0.1, 20]`). Param normalization mismatch → `gfactor=5` linear sent as `0.0499` normalized → VST3 de-normalized to `~1.09` → much less asymmetry → ~6 dB tilt instead of ~17. Fix: one-line merge-order swap in `run_native.mjs` so sidecar wins over `per_op_specs.json`. **Implication:** any op whose per_op_specs ranges had drifted from the actual VST3 ranges was being mis-tested by the native arm. tilt was the only op where the drift was large enough to produce a visibly-failing behavioral measurement; many others may have been silently mis-normalized but landed close enough to PASS. The harness now uses the authoritative sidecar. | 2026-04-26 |

### Doc / implementation divergences (both arms agree, doc is wrong)

| Op | Symptom | Diagnosis | Priority |
|---|---|---|---|
| **korg35** | At default `normFreq=0.5, Q=0.7` measured cutoff = 240 Hz. Worklet header documents Stinchcombe MS-20 mapping `f_c = 87·exp(V_f/1.3)` → 87 Hz at V_f=0. Measured value is 2.8× the documented one. | Verify whether the implementation actually applies the documented MS-20 mapping or a different scale. Either fix the implementation, fix the doc, or add explicit `declared.cutoff_hz = 240` annotation. | P2 |
| **ladder** | Param `cutoff` does not equal cascade −3 dB. At `cutoff=2000` Hz the −3 dB point lands at ~1700 Hz (~85%). | Per Stinchcombe §2.1.2 eq.(13), `cutoff` is the per-pole f_c, not the 4-pole cascade −3 dB. Document this convention in the worklet header explicitly. Behavior matches Stinchcombe; this is a UX/doc gap, not a bug. | P3 |

### Architectural debt

| Item | Description | Priority |
|---|---|---|
| **Multi-input parity_host** | Cluster A compressor cells (audio + cv inputs) cannot run T8-B native arm because parity_host accepts a single WAV input. 4 ops permanently SKIP the native arm until a stereo-WAV variant of parity_host lands (channel 0 → audio, channel 1 → cv). varMuTube / fetVVR / blackmerVCA / diodeBridgeGR stay at ✅+P. | P2 |
| **blackmerVCA cv polarity inversion** | blackmerVCA uses positive cv = boost, negative cv = cut. Sibling Cluster A cells use positive cv = compression depth. Composing graphs across cells is a footgun. Either flip blackmerVCA to match siblings (breaks existing graphs) or add a `cvSignAdapter` op for explicit conversion. | P2 |
| **optoCell port shape** | optoCell is `[cv] → [gain]` (curve generator), not `[audio, cv] → [out]` like sibling Cluster A cells. Currently routed through the analyzer category. Confusing as catalog row #141 alongside other "compressors." Either rename / re-categorize, or document explicitly. | P3 |

### T8-B harness backlog (Day 6+)

#### Backfill closure (2026-04-26 — second pass)

Added behavioral specs for 7 more parity ops: polarity_inv, uniBi_b2u,
scaleBy, mix (worklet-only), dcBlock, onePole_hp, xformerSat.
**Now 33 of 46 parity ops have committed behavioral reports** (28 verified
end-to-end + 4 multi-input native-skips + 1 documented multi-input mix).

Remaining 13 ops require infrastructure work, not just spec authoring:

**Worklet-less ops** — ship via `builtin:` JS reference inside
`check_native_parity.mjs` with no `op_<id>.worklet.js` sidecar. T8-B's
worklet arm requires a class to load. Either upgrade to full tri-files
or build a builtin-reference adapter for the worklet runner. Affected:
  - **biquad_{lp, hp, bp, notch, peak, lowshelf, highshelf}** (7 ops)
  - **drive** (1 op)
  - **gain_chain2** (1 op)

**Resampler** — `srcResampler` has internal lookahead latency even at
speed=1.0; closed-form sample-by-sample identity check fails. Needs a
dedicated resampler metric (anti-aliasing test, latency-compensation,
RMS-equivalence at unity rate).

**Source ops** — `constant` has zero audio inputs, emits a steady control
value. Doesn't fit any current metric module (utility's expectedFn
assumes input). Needs a "source" metric (output range, accuracy) — fits
the `analyzer` category extension.

**Modulation ops** — `smooth`, `slew` are stateful smoothers with
declared time-constants. Need a modulation metric module (rate accuracy,
T90 timing) — listed under "Categories not yet implemented" below.

#### Newer findings from second-pass backfill

| Op | Finding | Disposition |
|---|---|---|
| **mix** | Equal-power crossfade (`cos(amount·π/2)`, `sin(amount·π/2)`) per `dry_wet_mix_rule.md`, NOT linear (1−amount)·x. My initial behavioral spec had the wrong expectedFn — caught immediately by the harness. Native arm must SKIP because parity_host can't cleanly drive 2 input ports from 1 WAV. | spec fixed; nativeSkip=true logged |
| **enum/string param coercion** | run_native was passing string param values (`mode='hp'`, `mode='biToUni'`) raw to parity_host's JSON-numeric interface. JUCE silently fell back to AudioParameterChoice index 0 (= 'lp' / 'uniToBi'), corrupting the smoke build's baked default. Fix: skip non-numeric values in run_native; smoke's baked enum default wins. Surfaced by `onePole_hp` and `uniBi_b2u`. | runner patched 2026-04-26 |

#### Other open items
- **Categories not yet implemented.** modulation, reverb, pitch, envelope (split from analyzer), eq (currently routed through filter), limiter, widener, pitchshift, gate, convolver, synth, stereo. Each needs a metric module per `behavioral_validation_harness.md` § 6.
- **Cross-cutting metrics not yet implemented.** Tracktion-style transient-arrival latency test (any op with non-zero `getLatencySamples()`); clap-validator-style state-reproducibility test (every op).
- **L0 pluginval gate.** Invoke `pluginval.exe --strictness-level 10` per built smoke graph as subprocess; parse stdout for FAIL. License-clean (subprocess only). Adds NaN/Inf/subnormal/audio-thread-alloc/state/thread coverage that L1 + L2 cannot detect.
- **Visibility layer.** Per `behavioral_validation_harness.md` § 14: Nasty Orbs canvas extension (NodeMeterStrip / NodeInspector / PassFailBadge / NativeArmBridge). Days 9–13 of the original 13-day plan; designed but not yet built.

## Usage protocol

- **Populate opportunistically.** When the user drops a PDF / canon entry /
  paper that supersedes a shipped op's baseline, add a row here immediately.
  Don't re-ship the op mid-stream — just log the debt.
- **Populate at ship time.** When shipping a new op, if you know a
  known-better citation existed but was skipped for v1 scope, log it here
  in the same commit as the op lands.
- **Sweep later.** Formal full-ledger sweep happens once before the
  post-MVP cleanup pass (target: when shipped count hits ~80/130, or
  when codegen Stage-3b forces a canonicalization anyway — whichever lands
  first). Do not open a sweep prematurely.
- **Priority tags.** `P0` = stability/correctness gap (rare — those would
  block ship). `P1` = audible fidelity gap. `P2` = parameter-surface gap
  (adds expressiveness but v1 sound is fine). `P3` = academic completeness.

## Ledger

| # | Op id | Baseline (shipped) | Known-better citation(s) | Upgrade cost | Priority |
|---|---|---|---|---|---|
| 2 | filter | RBJ cookbook biquad (direct-form) | Canon:filters §9 RBJ variants fully enumerated; Zölzer biquad coeff reform (lower noise floor at low fc); TPT/ZDF forms (Zavalishin) for zero-delay feedback parity with SVF | Low — coefficient-only change for Zölzer form | P2 |
| 34 | ladder | musicdsp #24 mistertoast Moog VCF — 4-pole LP cascade + cubic-clip self-limiter, LP-only tap | Canon:filters §1 Stilson (per-stage `saturate()` + gain-table Q correction — richer character); §3 Hötvinen DAFX04 (2× OS + per-stage tanh + half-sample FB delay — warmest, most accurate, highest CPU); §4 Karlsen fast ladder (1-pole smoothers w/ clipped FB — bright/compressive, non-textbook slope). BP/HP taps for completeness: `BP = 3·y3 − y4`, `HP = x − y4` (Stilson §1 convention). Analytic Q-correction instead of empirical cubic fit. 2× OS filter for high-res aliasing at extreme resonance. | Medium — mode enum + tap algebra is low-cost; Hötvinen rewrite is medium (4 tanhs + OS filters in inner loop) | P2 (BP/HP taps) + P1 (Hötvinen fidelity upgrade) |
| 15 | delay | Integer / linear-interp delay line | Thiran fractional-delay allpass; Hermite ×4 (Canon:time_interp §1); Niemitalo cubic (Canon:time_interp §2) for pitch-accurate modulation | Medium — interp touches every read | P1 |
| — | dcBlock | Static one-pole HP | Adaptive cutoff variant (tracks signal envelope); documented low-bass coloration at static pole | Low | P2 |
| — | softLimit | tanh-style soft limiter | Bram soft-sat curve; gloubi-boulga (Canon:character §1) as alt flavor; Padé tanh approx (Canon:character §11) for cheaper eval | Low | P2 |
| — | saturate | Single waveshaper curve | Padé tanh (Canon:character §11); Chebyshev WS; branchless clip; 2nd/9th-order noise-shaping from Canon:character for alias control | Medium — alias control changes DSP topology | P1 |
| — | bitcrush | Naive quantize + decimate | 16→8 error-FB dither (Canon:utilities); proper decimation filter pre-downsample (currently imaging-prone) | Low | P1 |
| — | noise | LCG white (Canon §10 verified) + **Kellett "economy" 3-stage pink** (poles {0.02109, 0.07113, 0.68874}, amps {0.3190, 0.2636, 0.4144}) + leaky-integrator brown. Cite audit 2026-04-24: op was labeled "Trammell §8" but implements the Kellett recipe (same number-vectors, pole/amp roles swapped vs. §8). Both are valid 1/f; not interchangeable. | Canon §8 Trammell (alt recipe, distinct slope flatness); Voss-McCartney refinements; Larry Trammell "+Paul Kellett" comparison test | Low | P3 |
| — | lfo | Naive phasor sin/cos | Coupled sin/cos oscillator (Canon:synthesis §6) — drift-free, lower jitter on slow rates | Low | P2 |
| — | allpass | 1st-order allpass | Thiran fractional-delay form for pitch-accurate resonator loops | Low | P2 |
| — | svf | **Simper/Cytomic 2013 ZDF trapezoidal SVF** (already ZDF — prior ledger row mistakenly claimed pre-ZDF) | No DSP-form upgrade pending. Optional: Chamberlin SVF as alt-flavor "vintage digital" tap per `chamberlin_microprocessors.md §1` (different tone character, not a fidelity upgrade) | — | P3 |
| — | onePole | Direct-form one-pole | TPT/ZDF form (Zavalishin) — better at fc near Nyquist, cheaper for FM-modulated cutoff | Low | P2 |
| — | envelope / detector | Simple attack/release | Bram branchless env detector (Canon:dynamics); two-mode (RMS vs. peak) unified | Low | P2 |
| — | peak | Sample-rate peak | Inter-sample / true-peak aware variant — shares infrastructure with #truePeak | Low | P2 |
| — | slew / glide / smooth | Linear slew / lerp | One-pole TPT for smooth; per-slew semantics per Canon:dynamics (rate vs. time constants) | Low | P3 |
| 42 | karplusStrong | Karplus-Smith 1983 one-zero loop | Jaffe-Smith 1983 Extended KS (EKS); Karjalainen-Välimäki 1993 commuted synth; Sullivan 1990 energy-preserving loop; Smith damping-filter design | Medium — needs commuted-synth excitation table + allpass loop filter | P1 |
| 70 | goertzel | Textbook real-output Goertzel (Canon:analysis §1) | Full-complex W_Nk form; Hann/Hamming pre-window for sidelobe control; energy normalization; sliding Goertzel (Jacobsen-Lyons) for continuous readout | Low — ~30 lines + one FIFO | P2 |
| 71 | lpc | Autocorrelation + Levinson-Durbin (Canon:analysis §2) | Schur algorithm (better finite-precision); Bark/ERB frequency warping at sr≥48k (Härmä-Karjalainen); pre-emphasis + Hamming window before autocorr; stability-guaranteed line-spectral-pair (LSP) form | Medium — warping changes the state math | P1 |
| 86 | waveguide | Cylindrical bidirectional WG, integer delay (JOS §4.3–§4.5); damp filter is 2-tap asymmetric at intermediate damp values (linear-phase only at damp∈{0,1}) | Thiran fractional-delay allpass for continuous pitch; Smith dispersion allpass (piano stiffness); Lauri-Välimäki frequency warping; Bilbao energy-invariant FD forms; **symmetric 3-tap `(g, 1-2g, g)` loop filter** for constant group delay across damp per JOS §4.5 | High — fractional delay touches every loop iteration; symmetric loop filter is low-cost but touches the inner loop | P1 (fractional) + P2 (symmetric FIR) |
| 87* | kellyLochbaum | Cylindrical N-section KL lattice, constant k, integer delay (JOS §7.1, §10.1) | **Välimäki-Karjalainen ICSLP'94** (already in hand — user PDF): conical sections + fractional-delay junctions; taper-discontinuity reflection as 1st-order IIR `R(z)=b₀/(1+a₁z⁻¹)`; closed-end + open-end radiation IIR forms. Strube 1975 fractional delay. Wu et al. 1987 multirate length scaling. Maeda/Fant area tables for per-section k[i] presets. | High — per-junction IIR + fractional delay rewrites inner loop | P1 |
| 50 | rms | One-pole IIR power averager (`p = (1-α)x² + α·p; y = √p`, α = exp(-1/(τ·Fs)), default τ = 300 ms — VU ballistics). Already the upgrade target from Canon:dynamics §3's UPGRADE note. | ITU-R BS.1770-5 momentary (400 ms) / short-term (3 s) K-weighted rectangular windows for metering parity | Low | P2 |
| — | kWeighting | BS.1770 K-weighting biquad cascade (Canon:loudness §2) | libebur128 cross-check (reference impl); EBU Tech 3341 V4 test battery verification | Low — verification pass, not a rewrite | P2 |
| — | lufsIntegrator | Gated 400ms blocks, BS.1770-5 | Object-based BS.2051 rendering for multichannel parity | High — scope expansion (multichannel) | P3 |
| — | truePeak | Annex 2 4× polyphase FIR (48-tap) | 8× oversampling for extreme inter-sample peak catch on digitally-clipped sources | Low | P2 |
| — | lra | EBU Tech 3342 LRA | 3342 V3 refinements (gating thresholds) | Low | P2 |
| 66 | stft | JOS SASP definition + Hann window hard-coded. Default hop=256 (75% overlap). Recomputes window × ring → scratch on each fire (not pre-windowed sliding). | (a) `window` enum param: rect / hamming / blackman / kaiser-bessel(β) / flat-top — ~5 lines each. (b) COLA verification per window×hop combination at construction. (c) Inverse STFT (overlap-add synthesis) as a paired op for phase-vocoder pipelines. (d) True sliding STFT (one FFT per sample) via FFT-shift recurrence — O(log N) per sample, better for extremely short hops. (e) Zero-padding / magnitude interpolation for sub-bin peaks. | Low (window enum) → High (sliding STFT) | P2 |
| 63 | convolution | JOS MDFT §Convolution direct form. Length clamped [1,4096]; IR captured from `ir` stream over first M samples then frozen (no live-reload, no pulse-to-recapture). O(M) mul-adds per sample — direct form is fine at M≤1024 but taxing above. | (a) **FFT-based overlap-add** (Wikipedia §Overlap-add_method): segment input into L-sample blocks, FFT-mul-IFFT with zero-padded IR of size N = L + M − 1, overlap-add by M−1 — O(log N) per sample amortized, viable at M=32k+ IRs. (b) **Partitioned convolution** (Gardner 1995 "Efficient Convolution without Input/Output Delay") — zero-latency variant with tiered partition sizes. (c) Live IR reload via pulse param (recapture next M samples on trigger). (d) Multi-channel IR support (N-in × N-out). (e) Stereo IR convenience port. | Medium (OLA-FFT) → High (Gardner partitioned) | P2 |
| 68 | phaseVocoder | Bernsee smbPitchShift v1 at **osamp=1** (hop=size, no analysis/synthesis overlap between frames). Bernsee's own recommended quality is osamp≥4 (75%+ overlap). Bin-shift magnitude-accumulate form; sum-to-one accumulator naive (no peak-locking). Transient smearing expected per Bernsee's own LIMITS note. pitchShift clamped [0.25, 4.0]. | (a) **Higher osamp** via OLA coordination with #66 stft / #67 istft at hop=size/osamp (requires an op-to-op hop-link mechanism, or making phaseVocoder accept a hop param and synchronizing in the graph scheduler). (b) **Peak-locking** (Puckette 1995, Laroche-Dolson 1999) — detect spectral peaks, propagate their phase to neighbouring bins, reduces transient smear significantly. (c) **Formant-preserving** mode (Roebel 2003) — lift the spectral envelope before bin-shift, re-apply after, preserves vocal formants under large pitch shifts. (d) **PSOLA path** for monophonic sources (Zölzer Ch.6). (e) Independent **time-stretch** param (ratio ≠ pitch) for full "tune + tempo" capability. | Medium (osamp+hop) → High (peak-lock) → High (formant) | P1 (quality v2 ships soon — v1 osamp=1 is a placeholder) |
| 67 | istft | JOS SASP OLA resynth. Hann synthesis window hard-coded. Latency = size. `olaScale = hop/Σw²` assumes Hann² overlap-sum (correct for Hann at R=M/2, M/4; other windows would need per-window derivation). Round-trip with #66 reproduces signal with a frequency-dependent magnitude scaling (test asserts bounded peak, not exact-null). | (a) Window enum matching #66 stft (rect/hamming/blackman/kaiser), with per-window olaScale. (b) COLA-correctness verification in setParam (warn if hop × window combo not COLA-admissible). (c) Exact stft→istft null-test harness (currently only bounded-peak). (d) Output-port `ola-gain` signalling dropout risk when OLA coverage drops below threshold. (e) Pair with phase-vocoder frame-processor op for pitch-shift/time-stretch. | Low (window enum) → Medium (COLA-check) → High (exact-null verification) | P2 |
| 65 | ifft | Cooley-Tukey iterative radix-2 with conjugated twiddle + 1/N scale. Real-output only (imag part of inverse result discarded). Same streaming adapter as #64. | (a) Full complex output (second `outImag` port) for complex-signal processing. (b) Real-signal optimisation: half-size complex IFFT reconstructing via Hermitian symmetry (2× speedup when real-input guaranteed). (c) Shared twiddle LUT with #64 when instance count > 1. (d) Overlap-add output adapter (pair with stft #66). | Low–Medium | P2 |
| 64 | fft | Textbook Cooley-Tukey iterative radix-2 (Wikipedia / Cormen Ch. 30). In-place, no twiddle table (inline incremental `ω ← ω·ω_m`). Rectangular window (no pre-windowing). Block-FFT streaming adapter: one FFT per N samples, output bin-by-bin. | (a) Precomputed twiddle LUT (cos/sin per level) — saves 2·(log N) trig calls per block. (b) Real-FFT optimisation (half-size complex FFT via Hermitian packing) — 2× speed for real input, standard DFT trick. (c) Split-radix / radix-4 / mixed-radix (musicdsp-compatible SplitRadix, Sorensen real-FFT). (d) QFT / DQFT (Joshua Scholar, Canon:analysis §5) as double-precision alt for convolution reverb — keep as an alternative op, not an upgrade. (e) Window op pairing (Hann/Hamming/Blackman/Kaiser) + 50% overlap STFT adapter. (f) Chirp-Z transform for arbitrary-length. | Medium — LUT + real-FFT trick; High — split-radix | P2 |
| 40 | adsr | Linear attack + Schoenebeck (musicdsp #189) exp decay/release. State-machine idle/A/D/S/R, gate-edge triggered. Release coeff computed from sustain (not instantaneous level) — slight absolute-time error on mid-attack/mid-decay retriggers but musically inaudible. | (a) True exponential attack via bootstrap trick (start at FLOOR, end at 1, then offset — avoids log(0)). (b) Per-stage curve shape param (linear↔exp blend) à la Eurorack ADSRs. (c) Velocity scaling + key-tracking input ports. (d) AD / AR / AHDSR / DAHDSR mode variants per Vermona/Nord conventions. (e) Release coeff recomputed from current level (sample-exact decay time regardless of retrigger state). | Low (curve-shape param) → Medium (mode variants) | P2 |
| 73 | chromagram | librosa `chroma_stft` + `filters.chroma` (ISC) + Ellis 2007 `chromagram_E`. v1 takes `tuning` as a user param and applies L∞ per-frame normalization only. DC bin is masked; A0 reference is A440/16 = 27.5 Hz at tuning=0. | (a) **Auto-tuning estimation** — librosa `estimate_tuning` runs a peak-tracker over multiple frames and returns deviation in fractional chroma bins. Requires cross-frame state + peak-picking routine we haven't built yet. (b) **`norm` param exposure** — L1 / L2 / Lp variants for downstream classifiers that expect specific scales. (c) **CQT chromagram** — `librosa.feature.chroma_cqt` uses a Constant-Q transform instead of STFT, which has log-frequency bins natively and much better low-pitch resolution. Separate op. (d) **CENS (Chroma Energy Normalised Statistics)** — Müller-Ewert 2011; robust variant used in music similarity. Wraps chroma with quantization + smoothing. Separate op. (e) **Harmonic-percussive separation pre-filter** — HPSS before chroma cleans tonal content (`chroma_stft_harmonic` equivalent). Out-of-scope for a primitive op — belongs at brick layer. | Low (`norm` knob) → Medium (auto-tuning) → High (CQT / CENS separate ops) | P2 |
| 72 | warpedLPC | Warped autocorrelation from musicdsp #137 verbatim; Levinson-Durbin shared with #71 lpc; inverse filter uses canonical `z⁻¹ → D(z)` allpass-chain substitution (not in primary passage). | (a) **Härmä-Karjalainen primary read** — open "A warped linear prediction approach" / "Frequency-warped signal processing for audio applications" (Härmä 2000, AES J. 48(11)) and verify the inverse-filter construction matches our allpass-chain form. (b) **Lambda autoselect** — Smith-Abel 1999 closed form `λ(sr) ≈ 1.0674·√(2/π·arctan(0.06583·sr/1000)) − 0.1916` could replace the manual default. (c) **Hamming pre-window** — reduces leakage on short blocks (musicdsp comments call "no pre-window" out as a limit). (d) **Schur algorithm** — O(P²) Schur recursion for reflection coefs is numerically better than Levinson on ill-conditioned R. (e) **Lattice-filter synth counterpart** — pair warpedLPC analysis with a warped lattice synthesizer for cross-synth / vocoder Σ use cases. (f) **Coef smoothing** — per-coef AR smoothing across blocks to avoid audible "clicks" at block boundaries under non-stationary input. | Low (lambda autoselect, pre-window) → Medium (Schur, coef smoothing) → High (primary audit + lattice synth) | P2 |
| 38 | tilt | musicdsp archive #267 (Lubomir I. Ivanov, 2009) Elysia mPressor "Niveau" model. One-pole LPF + complementary HPF split, asymmetric `gfactor=5` gain scaling, `exp(g/amp)−1` linear-offset form. | (a) **Bilinear-prewarp accuracy** — current `3·sr + ω` in denominator is the author's specific discrete form; may not map pivot frequency exactly at high f0. Measure vs. analog response, consider standard bilinear `2·sr + ω`. (b) **Parametric Q / bandwidth** — single-knob tilt is fixed-slope; add a `Q` param (or transition-width) by chaining through a 2nd-order LP/HP split instead of 1st-order. (c) **Symmetric mode (`gfactor` = 1)** — default of 5 is the Elysia voicing; add a "flat" mode (linked gains, equal boost/cut) for mastering tilt à la Bax Audio or HoRNet. (d) **True shelving equivalence** — at extreme settings the reference "converts to 1st-order HP/LP"; a proper shelf (RBJ lowShelf/highShelf) preserves high-gain stability better. Consider a `shelfMode` fallback. (e) **Mid pivot crossfade** — compose two tilts at different pivots for a "tilt + bell" broadband console EQ emulation. | Low (symmetric mode, shelf fallback) → Medium (Q param via 2nd-order split, bilinear-prewarp verification) | P2 |
| 36 | comb | JOS PASP Feedforward_Comb_Filters + Feedback_Comb_Filters (verbatim difference equations). FF: `y(n)=x(n)+g·x(n−M)`, FB: `y(n)=x(n)+g·y(n−M)` with `\|g\|<1`. Integer-sample delay, `g` clamped to ±0.999 in FB for safety, denormal flush. | (a) **Fractional delay (Lagrange/Thiran)** — current integer-sample delay is fine for fixed-pitch combing but causes quantized zipper when `delayMs` is modulated for flanger/chorus. JOS PASP Lagrange Interpolation page covers 1st–4th order; 1st-order linear is a 5-line addition. (b) **Damped comb (Schroeder-Moorer)** — insert a 1-pole LPF in the feedback path: `y = x + g·(y[n−M] * filter)`. Used by Freeverb's 8 parallel combs. 2-line addition, enables `damping` param. (c) **Allpass-comb (Schroeder reverb)** — replace the recursive tap with a nested Schroeder allpass `y = -g·x + x[n−M] + g·y[n−M]`; flat magnitude, only phase. Separate mode? (d) **Modulated delay** — accept a CV input port for `delayMs` to build flanger/chorus without hand-wiring LFO→param. Current setParam-per-block is too coarse. (e) **Multi-tap comb** — allow multiple delay-gain pairs (slapback, pre-echo). Generalizes to FDN-lite topologies. (f) **Stereo-paired variant** — two independent combs with decorrelated delays for stereo-widening pink-noise (velvet decorrelator). | Low (fractional delay, damped feedback) → Medium (allpass mode, multi-tap) → High (CV modulation port — needs sandbox param routing) | P2 |
| 28 | pitchShift | Bernsee smbPitchShift ported verbatim with fixed FFT_SIZE=2048, osamp=4, Hann window, clamp pitch [0.25, 4.0]. | (a) **Configurable FFT size** — expose 1024 / 2048 / 4096 options; trades latency (1536 samples at 2048) vs. frequency resolution (smaller FFT = punchier transients). (b) **Configurable osamp** — 4 is safe; 8 gives smoother phase continuity on sustained tones at 2× the CPU. (c) **Peak-locking (Laroche-Dolson 1999)** — identify spectral peaks and lock phase coherence across each peak's bin cluster, eliminates the "phasiness" of naive bin-by-bin phase accumulation. P1 audible. (d) **Transient preservation** — detect transient frames (ODF-based, per #74 onset) and pass them phase-reset rather than phase-accumulated. (e) **Formant correction** — decouple spectral envelope from pitch scaling (PSOLA / Kawahara STRAIGHT / TD-PSOLA). Without this, vocal pitch-shifting produces chipmunk/monster artifacts. P0 for vocal use. (f) **SOLA / WSOLA time-domain alternative** — lower latency, better transient response than phase-vocoder for moderate shifts (±3 semitones). Worth a separate op `pitchShiftTD`. (g) **Smooth pitch automation** — internal interpolation across frames; currently pitch changes step-quantize at frame boundaries (every 512 samples). (h) **Negative frequencies** — formula `qpd = tmp/M_PI; if(qpd>=0) qpd += qpd&1 else qpd -= qpd&1` — the JS `|0` truncation matches C long-cast for positive tmp but needs verification at boundary crossings with large phase drift. | Low (FFT size / osamp params, smooth automation) → Medium (peak-locking, transient preservation) → High (formant correction, TD-PSOLA second op) | P0 (formant correction for vocals) · P1 (peak-locking, transient preservation) · P2 (FFT/osamp params, smooth automation) · P3 (TD variant) |
| 21 | ER | **Image-source-derived default tap vector** (12 taps, 5.3–79.3 ms, 0.85/(1+0.45·k) gain). JOS PASP cited for structure only; specific numerical tap table NOT from Moorer 1979 (paper not openly hosted). Single post-sum Butterworth LPF (not per-tap). Integer-sample taps (no fractional). Fixed 12 taps. | (a) **Moorer 1979 Boston Symphony Hall table** — the canonical 18-tap ER vector from "About This Reverberation Business" JAES 27. If/when the paper is accessible, transcribe verbatim and expose as a `preset` param (default-image-source vs Moorer-BSH). P1 because that specific spatial signature is the sonic target users expect. (b) **Per-tap LPF** — JOS explicitly allows LPF *per tap* for frequency-dependent air absorption (distance-proportional cutoff). v1's single post-sum LPF misses the per-path tone variation that gives realistic depth cues. (c) **Fractional-sample tap interpolation** (Lagrange / Thiran) — eliminates 1-sample quantization jumps when sweeping roomSize; currently sweeps can click on automation. (d) **Configurable tap count / user-editable tap vector** — 8/12/18/24 tap modes; per-tap ms and gain override ports. Unlocks custom spatial signatures. (e) **Stochastic / Gaussian-density tap generator** — generate taps on-the-fly from an RNG seeded by `roomSize` for endless variation; matches Moorer's statistical argument for late-tail transition. (f) **Stereo ER pair** — decorrelated L/R tap vectors from two mic positions; essential for true spatial impression (currently mono). (g) **Image-source exact** — from explicit shoebox room dims (w/h/d in meters) compute the first-order image positions and their delays/gains rigorously. Heavier but physically correct. (h) **Distance-proportional pre-delay** — expose `preDelay` param (0–50 ms) before the tap bank, standard on every commercial reverb. | Low (pre-delay, per-tap LPF, tap-count modes) → Medium (Moorer transcription once accessible, stereo pair, fractional interp) → High (image-source exact, stochastic generator) | P1 (Moorer table, per-tap LPF, stereo pair) · P2 (fractional interp, pre-delay, tap editability) · P3 (image-source exact, stochastic generator) |
| 27 | bbdDelay | **v1 pragmatic reduction.** Holters-Parker 2018 DAFx topology (pre-LPF → BBD FIFO → post-LPF + feedback), but 5-pole modified-impulse-invariant form of Hin/Hout collapsed to a single 2nd-order Butterworth LPF per side (RBJ cookbook). No dn fractional-sample timing. Juno-60 Table 1 coefficients pasted in worklet comment but NOT runtime-consumed. Feedback clamp ±0.95. Delay measured at host rate, not BBD rate. | (a) **Full 5-pole HP model** — implement eqs (26)–(33) real-valued-section form for Hin and Hout, consume Juno-60 Table 1 coefficients (already pasted in source comment), split each into r1/p1 real 1st-order + two conjugate-pair 2nd-order sections. Matches Fig 6 frequency response exactly. (b) **dn fractional-sample timing** — Algorithm 1 inner loop with n/k indices, tn = (k−1+dn)·Ts switching instants; required for continuous-clock modulation (Juno-60 / Dimension-D chorus, Electric Mistress flanger sweep). Alongside: Lagrange/Thiran fractional-delay interpolation on the BBD taps. (c) **Clock-rate-derived aaHz** — on real BBDs the AA filter cutoff physically scales with clock rate; v1 treats aaHz as independent. Tie them together in v2 for authentic "darker as delay lengthens" character. (d) **Companding** — real BBD chips (MN3007, SAD1024) use log-compression in / log-expansion out to extend dynamic range; v1 omits. Adds soft-knee character on transients, reduces FB-path noise. (e) **Stages param N exposed** — expose BBD queue length as (clockHz, N) pair rather than delayMs scalar; N·1/clockHz = delay time, but the pair controls character (higher N at higher clock = cleaner; lower N at lower clock = grittier). (f) **Hardware-specific coefficient presets** — Memory Man (MN3005, 4096 stages), Electric Mistress (SAD1024, 1024 stages), Juno-60 chorus (MN3009, 256 stages), Dimension-D (MN3011 + MN3101). Table per unit; one preset param switches. (g) **Stereo chorus pair** — two BBDs with out-of-phase LFO-modulated clocks, classic Juno-60 / Dimension-D / CE-1 topology. (h) **Noise floor modeling** — real BBDs have ~−70 dB clock-feedthrough + analog noise; for character add scaled pink-noise injection at BBD rate. | Medium (full 5-pole HP form — coefficients in hand, mostly transcription) → Medium (dn timing + fractional interp — algorithmic) → Medium (companding — extra pair of nonlinearities) → Low (presets, stages/clockHz pair) → High (stereo chorus pair = second op `bbdChorus`) | P1 (full HP model + companding — v1 lacks the "bloom" character of real BBDs) · P2 (hardware presets, stereo chorus, clock-tied aaHz) · P3 (noise floor model) |
| 19 | diffuser | Schroeder 1962 / JOS PASP "Allpass as Two-Comb Cascade". 4-section DF-II cascade, shared `g`, mutually-prime delays {23.83, 7.64, 2.56, 0.975} ms (JOS "1051, 337, 113" at 44.1k + 43-samp 4th-stage extension), `size` ∈ [0.5, 2.0] uniform scale. | (a) **Per-section `g_i`** — per-stage coefficient lets the user trade density vs colour (Moorer 1979 notes flatter response with varied per-section g). Cheap change, big voicing surface. (b) **Per-section delay override** — expose 4 independent delay-ms params instead of one `size`; unlocks tuning to room-acoustic targets or matching analog unit impulse responses (EMT 140, AKG BX20). (c) **8-section / 12-section modes** — more stages = denser diffusion, approaches Gaussian tail faster; standard Moorer / Dattorro lengths. (d) **Read Schroeder 1962 primary directly** — JAES 10(3). Currently citing JOS's restatement; debt is to open the original paper for the section-count recommendation and any damping-coefficient detail JOS abstracts away. (e) **Nested allpass (Gardner 1997)** — replace the inner feedback-delay with another allpass for richer texture at equal CPU; Gardner "A Realtime Multichannel Room Simulator", JAES 45(11). (f) **Modulated delay taps** — per-section tiny-depth LFO modulation on M_k (0.1–1 ms) prevents flutter on decayed tails and matches ambience of hardware plate/spring units. (g) **SR-invariant primes** — current ms-based delays drift from true primality at non-44.1 kHz SRs; a runtime prime-finder (nearest-prime-to-target-samples) preserves the JOS diffusion property. | Low (per-section g/delay exposure, 8-section mode) → Medium (modulated taps, nested allpass) → High (SR-invariant prime finder) | P2 |
| 25 | crossfade | Canonical cos/sin equal-power law (Blumlein 1933; Bauer 1961; JOS "Equal-Power Panning") — bit-for-bit clone of #7 mix DSP with A/B vocabulary. Block-rate `position` param, clamped [0,1]. | (a) **Sample-rate smoothing on position** — current block-rate `setParam` can zipper on fast automation; a one-pole smoother (1–10 ms default) would match op_mix's future upgrade path and suppress clicks without full CV plumbing. (b) **Alternate fade curves** — linear (non-constant-power, -6 dB center), square-root (-3 dB like cos/sin but computationally cheaper), logarithmic (perceptual volume) as a `curve` param. JOS documents linear vs sqrt vs cos/sin trade-offs in Spatial Sound §5. (c) **S-curve / tanh crossfade** — faster near endpoints, slower in middle for "hold A until last moment" DJ-style transitions. (d) **Sample-rate CV position input** — `kind:'control'` port for position, enables LFO / env-driven fades without block-rate zipper. Same infra need as #24 select. (e) **Correlation-aware compensation** — when A and B are correlated (e.g. same source, different processing), cos/sin under-sums at the middle; a `correlation` param or auto-detect could bias the curve. Matches a real ear problem when crossfading parallel processing chains. | Low (curve param, smoothing) → Medium (CV position) → High (correlation-aware) | P2 |
| 24 | select | Math-by-definition 1-of-4 hard switch. Fixed 4 ports; block-rate `index` param; floor+clamp on index; missing selected input → silent; no crossfade (hard edge). | (a) **Zero-click switching** — per-sample 1-sample linear ramp between old and new selection on index change (smooth_ms param). Avoids zipper without full crossfade. (b) **Crossfade-on-change** — use equal-power cos/sin over configurable ms; effectively folds #25 crossfade behavior into select for one-stop router. (c) **Variadic ports** — same infra blocker as busSum (d) **Sample-rate CV index input** — `kind:'control'` port for index, enables LFO/env-driven routing. Needs sandbox control-input plumbing. (e) **Fractional-index interpolation mode** — `index=2.7` → 0.3·in2 + 0.7·in3; turns select into a 4-tap linear crossfader. (f) **Boolean / gate mode** — 2-way variant (in0/in1) with a single threshold param for trig-driven A/B. | Low (smooth_ms ramp, fractional-index mode) → Medium (crossfade-on-change, CV index) → High (variadic infra) | P2 |
| 26 | busSum | Math-by-definition N-input summation: `out = Σ inₖ`. 4 fixed ports (in0..in3) to match sandbox shape-check convention; unity gain; missing ports contribute 0. Dual of #16 fanOut. | (a) **Variadic port count** — requires registry + shape-check support for dynamic port lists; would enable `busSum(N)` without cascading. Blocker is infrastructure, not DSP. (b) **Averaging mode** — `out = (Σ inₖ) / N_connected` for dB-consistent merging; useful when summing decorrelated signals at fixed headroom. (c) **Per-channel gain** — optional `gainK` param per port (unity default) turns this into a 4-channel mixer strip; composes with scaleBy today but a single atomic op saves a node. (d) **Soft-clip on output** — headroom guard for pathological cases (4× full-scale input); trivial pairing with `softLimit`. (e) **8-port / 16-port variants** — cascade-free wide busses for FDN cores, early-reflection tap banks. | Low (averaging, per-channel gain, wider fixed-N) → Medium (variadic infrastructure) | P2 |
| 39 | lrXover | Linkwitz-Riley LR4 = cascaded 2nd-order Butterworth (Q=1/√2) per linkwitzlab.com; RBJ Audio EQ Cookbook biquad LPF/HPF coefficients. Two biquad stages per leg, separate low/high outputs. Single `f0` param, clamped [1, sr·0.49], denormal flush. | (a) **LR2 mode (12 dB/oct)** — single biquad per leg with polarity flip on one leg to restore magnitude-flat sum (LR2 sum has 180° phase). Lower-CPU bus splits. (b) **LR8 cascade (48 dB/oct)** — 4× biquad per leg for brick-wall splits (Bag End / Meyer-style). (c) **Composed form** — chain existing `filter` op instances instead of inline biquads once `filter` exposes Q. (d) **TPT / ZDF state-variable form** (Zavalishin 2012, *The Art of VA Filter Design*) — better numerical behavior at high f0/sr ratios; avoids coefficient blow-up near Nyquist. (e) **All-pass-complementary crossover (Linkwitz APC)** — magnitude-flat sum with defined phase; zero group-delay distortion variant. (f) **Linear-phase FIR variant** — for mastering/broadcast where phase-coherent summation matters; long FIR + pre-ring trade-off. (g) **3-/4-way reconstruction** — multi-band via LR4 cascade per Linkwitz three-way design note. | Low (LR2, LR8) → Medium (composed-via-filter, TPT, APC) → High (linear-phase FIR, multi-way) | P2 |
| 35 | formant | musicdsp archive #110 (alex@smartelectronix, 2002): 10th-order all-pole IIR with five 11-coefficient A/E/I/O/U tables. Tables verbatim, direct-form structure, linear morph between vowels. | (a) **SR-scaled tables** — coefs are calibrated for 44.1 kHz; at 48 kHz formants shift ~9% up. Bake a second 48 kHz table, or re-express as 5 cascaded 2nd-order band-pass resonators with pole-pair specs in (f_c, Q) that can be re-warped at runtime (requires factoring the 10th-order polynomial). (b) **U-vowel stability clamp** — author notes U can self-oscillate; add an input level detector + side-chained attenuator, or clamp `vowel` to [0, 3.95] by default. (c) **Formant-pair upgrade (Klatt 1980)** — replace all-pole table with explicit 5-formant parallel bank of 2nd-order resonators (F1..F5 + bandwidths), runtime-tunable. Opens doors for phoneme transitions, pitch-formant decoupling, gender morph. "Software for a cascade/parallel formant synthesizer", Klatt 1980, JASA 67(3). (d) **Log-frequency morph** — current linear lerp between tables is non-physical; formants should move in log-frequency. Build intermediate tables offline by interpolating pole-pair (f, BW) then recomposing the polynomial. (e) **Male/child register tables** — current is female soprano only. Ship additional sets (male baritone, child alto) per Peterson-Barney 1952 vowel formant data. | Low (stability clamp, extra register tables) → Medium (SR rescale, log-freq morph) → High (Klatt parallel bank rewrite) | P2 |
| 75 | bpm | Frédéric Patin "Beat Detection Algorithms" (2003) Simple Sound Energy Algorithm #3 verbatim: R1 energy, R3 mean, R4 variance, R6 linear C-regression, `e > C·<E>` condition. Mono input, configurable windowN/histDepth, no C clamp. | (a) **Stereo-pair input port** — Patin's R1 uses `a[k]² + b[k]²`; add optional `inR` port for true stereo energy (caller-side pre-sum works today but loses channel info). (b) **C floor clamp** — Patin's regression goes below 1.0 for V > 200 (hits zero near V ≈ 589); optional `cMin` param to gate pathological cases. (c) **Frequency-selected sound energy (Patin §I.2)** — run the algorithm per sub-band (bass/mid/treble via filterbank or FFT bin-grouping) and fuse detections; paper pp. 9–14. Separate op or compose with shelf/svf split. (d) **Actual BPM estimation** — this op is a *beat-frame detector*, not a tempo estimator. Adding inter-beat-interval histogramming + autocorrelation gives BPM in Hz (Patin §II covers derivation+combfilter approach; Scheirer 1998 "Tempo and beat analysis of acoustic musical signals" is the canonical upgrade). (e) **Hysteresis / refractory period** — no wait-gate in spec; rapid e-spikes within one frame currently all fire. Add a `wait` frame-count param à la onset. (f) **Histogram-based C adaptation** — Patin's linear regression is from two hand-calibrated points (V=25, V=200); swap in a quantile-based adaptive C for program-material robustness. | Low (C floor, stereo port, wait) → Medium (frequency-selected variant, hysteresis) → High (BPM tempo estimator, Scheirer filterbank) | P2 |
| 74 | onset | librosa `onset_strength` + `util.peak_pick` (ISC); Böck-Widmer 2013 (vibrato suppression via freq-axis local-max); Böck-Krebs-Schedl 2012 (online peak-pick three-condition form). ODF `mean_f max(0, cur−refLM[t−lag])`; causal peak-pick with post_max=post_avg=1; running-max normalization; linear power spectrum (not log-mel). | (a) **Offline-quality lookahead** — librosa uses `post_max`/`post_avg` frames ahead of current; add a configurable frame-delay buffer (N-frame ring) that trades `post_max*hop` latency for offline-parity detection. (b) **Log-mel pre-transform** — librosa default chains `melspectrogram → amplitude_to_db` before flux; compose with mfcc's mel bank or ship a `logMel` op and let user pipe it in. (c) **Detrend HP** — librosa's `detrend=True` path runs a 1st-order HP on ODF to suppress slow drift; 1-line fold-in with a leak-integrator. (d) **Configurable normalization window** — current running-max leak is `normWindow*8` frames; expose as param + consider RMS-based norm for `delta`-invariance across program material. (e) **Aggregate function** — librosa exposes `aggregate=np.mean|np.median`; median is more robust to spectral outliers; swap in a median-of-positive-bins path. (f) **Complex-domain ODF** — Duxbury 2003 complex-domain flux uses expected-phase prediction, often better than magnitude-only on percussive+tonal mixes. Separate op path. | Low (detrend, norm-window param, aggregate) → Medium (offline-lookahead buffer, log-mel) → High (complex-domain ODF as separate op) | P2 |
| 43 | transient | **Airwindows Point (MIT)** audited 2026-04-24 — PointProc.cpp L41–L64 verbatim in op header. 5 documented deviations: (A) Bram §1 asymmetric detector vs Point's symmetric one-pole; (B) difference-normalized `atk`/`sus` split vs Point's pure ratio; (C) no `fpFlip` drift-compensation ping-pong (use denormal flush instead); (D) mono vs Point's per-channel stereo; (E) no stochastic denormal injection. Giannoulis-Massberg-Reiss 2012 JAES confirmed to NOT cover transient shapers (threshold-based DRC only). SPL DE 10154200 patent text not openly hosted. | (a) **`fpFlip` audit** — Point ping-pongs A/B envelope state pairs each sample for DC-drift rejection on the asymmetric add-then-divide update. Our Bram §1 + denormal flush should be numerically equivalent but has not been proven so; run a long-tail stability test at very low levels. (b) **Point symmetric-detector alternative** — ship a second op `transientRatio` using Point's symmetric one-pole + ratio combiner as a character variant; SPL-style asymmetric is our default. (c) **Lookahead path** — pair with #45 lookahead upstream so the gain envelope opens BEFORE the transient reaches audio (eliminates "loss of first cycles" on attack enhancement). P1 for real musical use. (d) **Log-domain gain** — current linear-domain `1+k·atk/norm` is level-dependent in a perceptually-unintuitive way; log-domain `gDb = kA·20·log10(envFast/envSlow)` (clamped) gives dB-linear behavior. (e) **Per-band transient shaping** — split input into 3–4 bands (LR4 via #39), run a transient op per band, sum — enables selective kick-attack vs hi-hat-air shaping. (f) **Program-adaptive normalization** — `norm = max(envSlow, minLevel)` floor adapts automatically; alternatively EMA of program RMS. (g) **Stereo link** — dual-channel with max/average link on gain computation (Point does independent per-channel; linked behavior is more typical on modern plugins). (h) **Sample-accurate onset detection** — onset-flux gating could sharpen attack-enhancement precision. (i) **SPL patent DE 10154200** — track access; would be a 2nd primary to cross-reference against Point. | Low (stereo link, program-adaptive norm, fpFlip audit) → Medium (Point-variant op, log-domain gain, lookahead integration) → High (per-band split, onset-driven gating) | P1 (fpFlip audit, lookahead integration, log-domain gain) · P2 (per-band, stereo link, Point-variant) · P3 (onset-driven gating, SPL patent access) |
| 45 | lookahead | Math-by-definition primitive shipped without opening a PDF primary. Ring-buffer pure delay + monotonic-deque windowed abs-max. Structural reference is Lemire 2006 "Streaming Maximum-Minimum Filter Using No More Than Three Comparisons per Element" (arXiv:cs/0610046) — NOT ingested; deque idea is competitive-programming canon and was reconstructed from first principles. Max lookahead clamped to 50 ms. Block-rate `lookaheadMs` resize resets state (no click-free reshape). Absolute sample counter stored as Number[] to avoid Int32 wraparound. | (a) **Lemire 2006 primary read** — open the arXiv paper, verify our monotonic-deque implementation matches its bounds (≤3 comparisons per element, specifically). Debt only, not a bug. (b) **Click-free resize** — crossfade between old-L and new-L output over a ramp window on param change, instead of hard reset. Requires double-buffering. (c) **Dual min/max output** — Lemire's algorithm produces both simultaneously at marginal cost; second output port `valley` would unblock per-sample dynamic-range estimation. (d) **Sample-accurate `lookaheadMs` via fractional-delay tap** — currently latency is an integer sample count; for sub-sample automation in mod paths (chorus-style lookahead sweep), Lagrange/Thiran interp on the ring read. (e) **Denormal flush on `peak` output** — currently trusts the max-of-abs invariant to stay ≥0 (which holds by construction), but downstream math on peak near-zero could benefit from floor clamp. (f) **Per-channel variant** — currently mono; stereo-linked max (`max(|L|,|R|)` or per-channel independent) is the standard limiter topology. | Low (denormal floor, per-channel stereo) → Medium (Lemire primary read, dual min/max output) → High (click-free resize, fractional-delay tap) | P1 (Lemire primary read, stereo variant) · P2 (dual min/max, click-free resize) · P3 (fractional tap) |
| 42 | expander | Bram env detector (Canon:dynamics §1) + math-by-definition dB static curve (Zölzer §4.2.2 compressor law mirrored: `y = T + (x−T)·R` below thr, 1:1 above, quadratic soft knee). Ratio clamped [1,100]. Single exp one-pole on gain ramp (attack when target>gain, release when target<gain). Linear-amplitude envelope → dB via `20·log10(env+1e-12)`. `floor` as linear-gain clamp. No lookahead. No hold phase (unlike gate). Sidechain optional. | (a) ~~**Zölzer DAFX §4.2.2 primary audit**~~ **RESOLVED 2026-04-24** — Faust `compressors.lib` `peak_expansion_gain_mono_db` (GRAME, LGPL) opened as the citable primary; three-region knee form algebraically identical to ours. Header updated with verbatim passage + equivalence block. Zölzer kept as secondary textbook cross-ref. (b) **Hold phase** — add holdMs between below-thr entry and gain rampdown, matches hardware expander/gate unification. (c) **Lookahead** — N-sample delay so gain ramp opens before transient hits audio path. (d) **Upward expansion** — above-threshold ratio mode for level restoration / "reverse compression" use (parallel upward expander is a classic mastering trick). (e) **Log-domain gain smoothing** — current linear-gain one-pole is perceptually non-ideal at large ratios; log-smoother gives perceptually uniform attack/release. (f) **RMS detector option** — currently peak (abs); RMS would match the compressor #3 family better for musical program material. (g) **External key-listen output** — monitor the envelope for setup. (h) **Soft-knee sign verification** — knee polynomial `y = x + (R−1)·d²/(2·K)` with `d = x − T − K/2 ≤ 0` gives monotonic blend into expansion; re-derive against Zölzer once accessible to confirm sign and pivot. | Low (hold, key-listen, RMS mode) → Medium (lookahead, log-domain smoothing, upward expansion) → Medium (Zölzer audit + knee sign re-derive) | ~~P1 (Zölzer audit)~~ resolved → P1 (lookahead, log-domain smoothing) · P2 (hold, RMS mode, upward expansion) · P3 (key-listen) |
| 41 | gate | Bram envelope detector (Canon:dynamics §1, musicdsp #97) on sidechain with fixed fast internal A/R (1/10 ms); math-by-definition A/H/R state machine (CLOSED/ATTACK/OPEN/HOLD/RELEASE) w/ Schmitt 3 dB hysteresis (`thClose = threshold · 10^(-3/20)`). Exponential one-pole gain ramp toward target (attack rises to 1, release falls to floor). No lookahead, no sample-accurate threshold crossing (block-granular state transitions). Linear-amplitude threshold (not dB). | (a) ~~**Zölzer DAFX Ch.7 §7.3 primary audit**~~ **RESOLVED 2026-04-24** — surveyed Airwindows Gatelope (spectral, divergent), Faust `compressors.lib` (no gate fn), musicdsp Effects index (none), amplessEngine.js (2-state, simpler). No open primary matches our 5-state Schmitt + A/H/R topology end-to-end. Math-by-definition declaration preserved with survey trail now documented in op_gate.worklet.js header. (b) **Lookahead** — N-sample delay line with max-envelope lookup so attack can open before the transient reaches the gain stage (standard in modern digital gates; 1–5 ms typical). (c) **dB-domain threshold** — most users think in dB; convert via `10^(th_dB/20)` at setParam. (d) **Range (downward expander) mode** — instead of hard floor=0 cut, apply a ratio-based attenuation (like a 1:∞ gate turning into 1:4 expander). (e) **Sidechain HP/LP** — internal detector filter so kick-triggered gates on snare bleed work without external filter. (f) **External key listen output** — monitor the sidechain envelope for setup. (g) **Soft-knee threshold** — smooth transition across ±kneeDb window. (h) **Sample-accurate state transitions** — currently state flips at block boundaries via Schmitt; move to per-sample (already per-sample, re-verify). (i) **True linear gain ramp** — match hardware-style fixed-time ramps (ms-to-full) exactly, rather than exp one-pole approximation. | Low (dB threshold, sidechain HP/LP, knee) → Medium (lookahead, range mode, key-listen) → Medium (Zölzer §7.3 audit + ballistic rewrite if needed) | ~~P1 (Zölzer audit)~~ resolved → P1 (lookahead, dB threshold) · P2 (range mode, SC filter, knee) · P3 (key-listen out) |
| 44 | sidechainHPF | RBJ Audio EQ Cookbook HPF biquad (rbj_cookbook.txt L116-L123) in Direct Form 1. Order∈{1,2}; order=2 cascades two identical biquads with the same Q (not the {0.5412, 1.3066} Butterworth-4 section pair). Single Q knob applied to both stages. Mono. No sidechain-key output, no listen port. | (a) **True Butterworth 4th-order cascade** — when order=2, use Butterworth section Qs {0.5412, 1.3066} rather than duplicated user-Q so the cascaded response is a proper Butterworth (-3 dB at f0) instead of a doubled -6 dB at f0. Simplest upgrade. (b) **Linkwitz-Riley LR4 option** — cascade of Butterworth-2 sections at same Q=1/√2 gives LR4 (−6 dB at f0, summed flat with paired HPF). Useful if sidechainHPF is ever paired with a complementary LPF. (c) **dB-dropout spec** — expose slope as dB/oct directly (12/24/48) rather than integer order. (d) **Stereo-link / linked detector pair** — currently mono; stereo sidechain detection usually runs max(|L|, |R|) pre-filter. (e) **Q-smoothing** — block-rate Q changes can click if automated; one-pole smooth on coefficient updates. | Low (Butterworth Qs, Q-smoothing) → Low (dB/oct abstraction) → Medium (LR4 option, stereo-link) | P2 |
| 46 | meters | Pure composition of op_peak (L14-L23) + op_rms (L17-L20). Both passages pasted verbatim in header. Preset enum {vu, ppm, digital, custom}; custom-param set flips standard to 'custom' automatically. No true-peak (#54 is separate), no K-weighting (LUFS path goes through #51 kWeighting + #52 lufsIntegrator). | (a) **True-peak preset** — add a 'digital-tp' standard that wires through #54 truePeak internally (4× oversample). Currently users must compose manually. (b) **Stereo metering** — currently mono; stereo meters typically emit {peakL, peakR, rmsL, rmsR} or the max/sum variant. (c) **Scale output (dB)** — emits linear envelopes; UI widgets convert to dB themselves. Optional dB-scaled output port would save a graph hop. (d) **IEC 60268-17 VU integration curve** — VU is not just 300 ms RMS; it's a specific ballistics shape with 99% response in 300 ms and ≤1% overshoot. Current one-pole is an approximation. (e) **Peak hold** — momentary peak-hold indicator (configurable hold time) on top of continuous peak readout. | Low (dB output, peak-hold) → Medium (stereo variant, true-peak preset) → Medium (exact IEC VU curve) | P2 |
| 76 | yin | de Cheveigné & Kawahara 2002 JASA 111(4):1917–1930 §II Steps 1–5 verbatim (Eq. 6 difference function, Eq. 8 CMNDF, §II.D absolute-threshold 0.1, §II.E parabolic interpolation on RAW d(τ)). Frame-based, hop=W=25ms non-overlap. W·τ_max naive O(W·τ_max) difference loop. No prefilter. Silent-frame gate (energy<1e-10 → f0=0, conf=0) added outside paper — matches librosa/aubio/crepe. Confidence reported as 1−d'(τ_est) clamped [0,1] (paper uses d'(τ) directly as unreliability indicator; we invert for monotonic downstream gating). | (a) **Step 6 "best local estimate"** (paper §II.F) — block-reprocess with adjusted integration interval around τ_est, drops error 0.77%→0.50% per Table I. Requires revisiting past frames; doesn't map cleanly onto single-pass worklet — research debt, biggest fidelity gap. (b) **FFT-accelerated difference function** via Wiener-Khinchin (Guyot `differenceFunction` reference impl) — O(W log W) vs our O(W·τ_max); required for real-time at 25 ms @ 48 kHz when instance count > 1. (c) **Overlapping frame hop** — paper evaluates at 1-sample hop for error statistics; production impls (librosa, aubio) use 256-sample hop. Current hop=W means one estimate every 25 ms; modulating pitch-tracked downstream ops will zipper. (d) **1 kHz low-pass prefilter** (paper Fig. 4c) — reduces octave errors on signals with strong harmonic content above f0; compose external biquad today, could fold in. (e) **Confidence sign convention** — our `1−d'` inversion is a UI choice not in the paper; surface a `rawConfidence` output for callers that want paper-native d'. (f) **Silent-frame gate deviation** — `energy<1e-10` threshold picked heuristically; could be exposed as param or computed from target dBFS floor. (g) **pYIN probabilistic upgrade** (Mauch-Dixon 2014, Canon:pitch §2) — parameterless threshold via Beta-distribution prior + Viterbi temporal smoothing, F=0.981 on MIREX. Separate op slot. (h) **CREPE** (Kim 2018, Canon:pitch §3) — DNN, RPA 0.995@10¢; ML-runtime gated, tier T7+. (i) **Step-4 unvoiced-fallback divergence from Guyot** (cross-check 2026-04-24) — Guyot returns 0 (no pitch) when no CMNDF dip < threshold; we return global-min pitch. For unvoiced-but-non-silent frames (fricatives, bowing noise, breath) our silent-gate passes the frame through and emits a spurious f0 guess. Fix: adopt Guyot convention — on fallback set `lastF0 = 0` and let the low confidence do the downstream gating (confidence is already 1−d'(globalMin), typically near 0 on unvoiced). Small, safe, matches librosa/aubio/Guyot. | Medium (Step 6 requires frame-history, FFT DF is a rewrite of inner loop) → Low (prefilter, confidence sign) → Medium (overlapping hop — needs scheduler hop decoupling) → High (pYIN/CREPE = separate ops) | P1 (Step 6, FFT DF — fidelity + CPU for real-time) · P2 (overlapping hop, 1 kHz prefilter, rawConfidence port) · P3 (silent-gate param, pYIN/CREPE ladder) |
| 62 | mfcc | python_speech_features (James Lyons, Apache-2.0) pipeline: power spec → mel triangular filterbank → log(+LOG_FLOOR=1e-10) → DCT-II per Wikipedia. v1 consumes STFT/FFT complex spectrum and emits the first `numCoefs` MFCCs streamed one-per-cycle. No preemphasis, no ceplifter, no appendEnergy, no orthonormal DCT scaling. | (a) **Preemphasis** — Python ref `preemph=0.97` first-order HP applied pre-STFT; either add standalone preemphasis op upstream or fold as a param on #66 stft. (b) **Cepstral liftering** — `ceplifter=22` (`1 + (L/2)·sin(π·n/L)`) boosts higher coefs for classifier stability. (c) **appendEnergy mode** — reference overwrites c[0] with log of total frame power instead of the DC DCT coef. (d) **Orthonormal DCT scale** — scipy `norm='ortho'`: 1/√(2N) for c[0], 1/√N for c[i>0]. (e) **Log-compression choice** — `log(E + 1e-10)` vs numerically stable `log1p` or floor-at-threshold. | Low (each is a 5-line add) | P2 |

*Slot #87 catalog row is `scatteringJunction` (a bare 2-port primitive, not
yet built). `kellyLochbaum` was shipped as a composite multi-section lattice
and is tracked as a distinct row pending catalog resolution.

## Post-ship research audits

- **fdnCore (#20) — audited 2026-04-23.** Initial v1 had shelf-before-Householder
  ordering that diverged from the proven shipped path in
  `src/morphReverbEngine.js` (morphreverb-v6). Re-read the engine, corrected
  to Householder-first + post-mix shelf + ±1.8 per-channel safety clamp to
  match. Added Stautner-Puckette 1982 (first FDN reverb) and Jot-Chaigne 1991
  (paraunitary FDN canon) as upstream citations. All tests + goldens re-blessed.
  Note: 128-sample golden doesn't catch DSP ordering changes (delays haven't
  wrapped yet); flagged as a harness-quality item for later.

## Synth family — SuperCollider Book 2nd ed. review sweep — P2 (2026-04-24)

The SC Book 2nd ed. code archive is now an authorized second-primary
source (see `sandbox_op_ship_protocol.md` "Authorized second-primary
source archives"). Synth-family ops #79–#87 were shipped against JOS
PASP / ICMC / CCRMA / SuperCollider server-source primaries, BEFORE
the book archive was registered. Sweep each shipped synth op against
the corresponding chapter and log any divergences:

- **#79 sineOsc** → Ch 2 (UGen rate conventions) + Ch 29 code samples
  for C++ UGen idioms.
- **#80 wavetable** → Ch 29 `Figure_29-*` examples for UGen pattern;
  cross-check `lookupi1`-style interp, consider adopting
  `Osc_ikk_perform` control-rate fast-path variants.
- **#81 blit / #82 minBLEP** → no direct SC-book equivalent expected,
  but Ch 29 LPF-rates example shows block-rate update idioms that map
  to our `setParam` path. Low-priority review.
- **#83 fm** → no dedicated SC-book chapter; SinOsc + SinOscFB UGen
  sources on github remain first-primary for feedback-FM upgrade.
- **Future synth ops (#84 padSynth, #85 K-S ✅, #86 waveguide ✅,
  #87 scatteringJunction, #87a kellyLochbaum ✅, grain/microsound
  slots, phys-modeling extensions)** → Ch 16 (Microsound) + Ch 15
  (analysis) + Ch 29 (C++ idioms) must be opened with tool calls
  during Step 1.

Action: when the next synth-family op ships OR when time is cheap,
open each of those chapter files, diff against the shipped worklet
header + catalog row, log concrete upgrades (not vague "review").
Close this entry once #79–#83 are all checked off or a follow-up
per-op entry supersedes it.

## #80 wavetable — P2 (2026-04-24)

Shipped as 4-table bilinear-interp wavetable (SuperCollider Osc UGen
pattern, naive bank). Deferred upgrades:

1. **Bandlimited mipmap bank** (Niemitalo / Wavetable-II style). Generate
   per-octave bandlimited variants of saw/square/triangle and pick by
   playback freq. Eliminates aliasing for non-sine tables. #81 blit
   handles this for impulse trains; wavetable op should too.
2. **User-supplied tables.** Today the bank is hard-coded 4 shapes.
   Extend with a `setTable(idx, float32Array)` method so graph-level
   patches can load serum-style single-cycle WAVs. Schema needs a
   binary-blob side-channel — not yet designed.
3. **Fixed-point phase.** SuperCollider uses `(phase >> xlobits) & lomask`
   with a power-of-two table for branch-free wrap. We use float phase
   with `if (phase >= 1)`. Equivalent semantics, slight perf delta —
   evaluate post master-worklet codegen.
4. **Table count > 4.** Serum / Vital bank sizes are 64–256. Naive
   extension but bumps ROM ~64KB → ~4MB. Needs streaming / lazy-load.
5. **Inter-sample cubic / sinc.** Linear interp adds audible HF loss
   at high freq (narrow-sample-count bright content). Canon:Time
   &Interp §Hermite cubic is the drop-in upgrade.
6. **Position morph curves.** Linear morph is the SC default, but Vital
   exposes `wrap`, `sync`, `bend` modes. Trivial extension once the
   param surface stabilizes.

## #83 fm — P2 (2026-04-24)

Shipped as clean 2-operator Chowning FM (carrier + ratio-locked
modulator + scalar index). Deferred upgrades:

1. **Multi-operator algorithms.** DX7 has 32 algorithms (operator
   routing graphs). Ship as higher-level compositions of #83 `fm` +
   modulator mixing at the graph level, or dedicate a future slot
   for a 4/6-op engine with parameterized algorithm.
2. **Operator feedback.** Each DX7 operator has a self-feedback
   path (φ_m[n] + fb·m[n-1]). Adds saw-like timbres at high
   feedback. Trivial to add to #83 directly as another state +
   param; held for v2 to keep v1 minimal.
3. **Fixed-freq operators.** DX7 lets an operator ignore pitch
   tracking (used for inharmonic bells/drums). Today requires two
   `fm` instances or a workaround; add `modFixedFreq` param flag.
4. **Bandlimited FM / anti-alias.** Carson bandwidth ≈ 2(β+1)·f_m
   can exceed Nyquist easily; today we let it alias (Chowning's
   original papers did too). Moore 1990 §5.2 proposes exponential
   FM with bandlimit on index; track as mastering-grade upgrade.
5. **Phase-modulation (PM) vs true FM.** What we ship is technically
   phase modulation (sin of phase + I·sin(phase_m)). DX7 is PM too.
   True FM integrates the modulator into the carrier phase — see
   Smith PASP "FM Synthesis" chapter. Same audible result at static
   index, differs when index is modulated fast. Noted here for
   completeness; v1 stays with PM convention.
6. **Index as frequency deviation.** Some FM literature expresses I
   in Hz (peak deviation / modulator freq). Our I is unitless (matches
   Chowning/Wikipedia β). Add a helper param `indexHz` that internally
   computes `I = indexHz / f_m` if user workflow wants it.

## #82 minBLEP — P2 (2026-04-24)

Shipped as true min-phase MinBLEP saw per Brandt ICMC 2001 §4.2/§6.2/§6.3
with martinfinke/PolyBLEP discontinuity-convention cross-check. Pending
upgrades:

1. **Mastering-grade table parameters.** Brandt Fig 4 specifies Ω=64,
   Nz=16 (table=1024 entries). We ship Ω=32, Nz=8 (table=256) for sandbox
   cost. Alias floor is ~6 dB worse than the paper target. Bump when
   memory budget allows — table generation is a one-shot at module load.
2. **polyBLEP sibling op** — Välimäki 2007 / Tale-Jesusonic closed-form
   parabolic stand-in. Cheaper per-sample (no table, no events), worse
   alias rejection. Useful for per-voice polyphony where minBLEP's
   event pool becomes a bookkeeping bottleneck.
3. **Hard-sync extension** — Brandt's actual topic. Sync event at master
   crest inserts a MinBLEP at arbitrary fractional time; same residual
   pipeline applies. Slot-it-in after base saw is proven musically.
4. **Square / triangle / pulse-width variants.** Square = two sawtooths
   180° out of phase (two event streams, opposite jumps). Triangle =
   integrated square (carries DC drift — pair with dcBlock). PWM =
   phase-offset event between the two.
5. **BLEP-for-filters composition.** Any discontinuity in a downstream
   waveshaper can feed residual events upstream. Composable but requires
   op-level event-bus protocol not yet designed.
6. **Gibbs overshoot bound.** Current naive+residual can peak ~1.33 at
   440 Hz, ~2.4 near-Nyquist. Consider explicit post-gain soft-clip
   when routing minBLEP directly to DAC (not caller's responsibility
   today — documented in test thresholds).
7. **Table sharing across instances.** C++ sidecar builds the table
   per-instance; JS worklet shares it (module-scope). Unify once static-
   init ordering in emitted C++ is pinned down.

## #81 blit — P2 (2026-04-24)

Shipped as peak-1 closed-form BLIT (Stilson & Smith 1996 §3.7 +
STK Blit.h reference). Pending upgrades:

1. **Saw / square / triangle as separate ops.** Paper §4.1 specifies:
   Saw = leaky-integrate(BLIT − C₂), with C₂ = average(BLIT). For the
   peak-1 shipped normalization, C₂ = 1/P, NOT 1 (paper uses (M/P)·Sinc_M
   form where C₂ = 1). Leaky integrator pole at `r ≈ 0.9995` per paper's
   "slightly in from unit circle" heuristic; proper value is
   frequency-dependent. File as ops #81b/c/d or as a `blitIntegrate` op.
2. **BiPolar BLIT (BP-BLIT).** Paper §4 specifies square generation via
   two phase-offset BLITs subtracted, then integrated. DC = 0 natively
   so no C₂ compensation needed.
3. **PWM / duty-cycle control.** Paper §4 "Rectangle" equations give
   `k₀ ∈ [0, P]` controlling duty; add when square op ships.
4. **BLIT-SWS (windowed-sinc) variant.** Paper §3.8 notes that BLIT-SWS
   avoids audible harmonic on/off "pops" during freq sweeps; shipped DSF
   closed-form does have these (acknowledged in worklet FM-path comment).
5. **Harmonic fall-off control.** DSF can apply `aᵏ` fall-off for softer
   sound (paper §3.5); shipped form is flat. Add `damp` param in v2.
6. **Singularity ε choice.** Shipped `ε = 1e-12` vs STK's `float::epsilon`
   (~1.19e-7). Safe because phase is float64; if state migrates to
   float32 in a future minimal-latency build, bump ε accordingly.

## #79 sineOsc — P3 (2026-04-24; re-audited)

Shipped as JOS Direct-Form Resonator (DFR) — verified against
ccrma.stanford.edu/~jos/pasp/Digital_Sinusoid_Generators.html on ship
day. Phase-0 initial conditions from McCartney (musicdsp #9, CMJ 2002).
Initial ship mis-labeled the form "Gordon–Smith"; corrected to DFR
after second-primary audit (Gordon–Smith is JOS's *third* method, the
coupled form, not shipped here). v1 is correct and stable. Pending:

1. **Coupled-form (Gordon–Smith 1985 / "magic circle") variant** as a
   sibling op. Energy-preserving rotation; slightly better amplitude
   stability under long-duration sweeps. JOS's second/third methods in
   the same reference page.
2. **Phase readout port.** Some downstream ops (sync, phase-modulation
   targets) want explicit phase out in [0, 2π). Add as second output
   when demand surfaces.
3. **De-click on large freq jumps.** Current boundary test shows < 0.1
   step at 440→880; but large jumps (e.g., 100 Hz → 10 kHz) produce
   audible transient. Options: short coef xfade, or snap phase to
   nearest zero-cross. Defer until a caller complains.
4. **Double-precision state option.** Amplitude drifts ~10⁻⁸ / 10⁶
   samples at double; at float32 it would be worse. Currently state is
   double — confirm cpp.jinja port keeps double, not float, for state.

## #12 oversample2x — P2 (2026-04-24)

Shipped under full protocol against hiir (de Soras, WTFPL) — StageProcFpu +
Upsampler2x/Downsampler2x + PolyphaseIir2Designer. Pending upgrades:

1. **Verify lane split bit-exactly vs hiir reference.** Our `_stage` pairs
   coefs (i→lane0, i+1→lane1). hiir's `StageProcFpu` template does the same,
   unrolled by pair recursion — confirm no off-by-one on odd-length coef
   arrays by running a known coef set through both and hashing output.
2. **4× oversample (stacked 2×) + 8× variants.** Same building block, just
   two/three instances. Needed for #113 tube sim (typically 4–8×).
3. **Compile-time coef unrolling in codegen.** cpp.jinja currently keeps
   `nCoefs` runtime; emitter should template on fixed order once we commit a
   canonical atten/TBW preset per host op.
4. **Round-trip THD sweep.** Expected ~−(atten) dB noise floor with flat
   passband; measure and record a baseline so regressions show up.

## Notes on opportunistic ingests

- **Välimäki-Karjalainen 1994** already on disk at
  `C:\Users\HEAT2\Downloads\icslp94.pdf`. Cited inline in
  `op_kellyLochbaum.worklet.js` LIMITS section. Full canon ingest into
  `jos_pasp_physical_modeling.md §7.1` deferred (awaiting explicit go).

## Not on this ledger

Ops whose v1 *is* the canonical form and have no known-better upgrade path
relevant to the sandbox use case (gain, mix, constant, z1, fanOut,
sign/abs/polarity, clamp, etc.) don't need rows here. Add a row only when
there's a real citation to point at.

---

## #84 padSynth — Nasca PADsynth wavetable synth (2026-04-24)

Primaries: zynaddsubfx PADsynth doc §3.2.1 (Paul Nasca) + zynaddsubfx
`src/Params/PADnoteParameters.cpp` (`getprofile()` + `generatespectrum_bandwidthMode()`).

Upgrade-path debt:

1. **Table length N=16384 vs zyn default 2^18 (262144).** Our N trades
   spectral resolution for build cost (~64× faster rebuild). Each harmonic
   Gaussian occupies `bw_Hz · N/sr` bins — at f=55Hz, bw=100c, that's
   ~1.1 bins at our N (crude) vs ~17 bins at zyn's N (smooth profile).
   Audible as slightly "sparkly" low pads. Fix: expose N as build-time
   const or size-tier param (small/medium/huge).

2. **Deterministic LCG phase fill vs rand().** Stable goldens are worth
   it, but real PAD's phase chaos is part of the sound — two seeds
   should sound identifiably different without feeling locked. Upgrade:
   xoroshiro128+ (better distribution) still seeded.

3. **Fixed harmonic banks (saw/square/organ/bell) vs editable.** zynaddsubfx
   ships a harmonic editor per voice. MVP v1 ships 4 presets; v2 exposes
   `A[nh]` as a 64-sample Float32Array input or param-array (blocked on
   op registry supporting array-valued params).

4. **Gaussian-only profile.** zyn also supports "Square" (rect window)
   and "Double-exp" (sharper tails) profiles. Add as `profileType` int
   param when exposed.

5. **No `power` exponent on bandwidth scaling.** Primary B shows
   `bw_Hz = (2^(bw/1200)-1)·basefreq·(realfreq/basefreq)^power` — we
   hard-code power=1. Higher power = brighter harmonics get
   disproportionately more bandwidth (stretched/inharmonic feel).

6. **One base pitch per voice; no crossfaded pitch bands.** Extreme
   re-pitching of a pad stretches formants. Real PAD voices (zyn) build
   N tables across the keyboard range and crossfade. Ours uses a single
   table — acceptable within ~2 octaves of `tableBaseFreq`.

7. **Linear interp playback.** Good enough for a harmonic pad
   (no aliasing because the table is already bandlimited at build).
   Cubic (Hermite, Canon:time §1) would kill last-0.1dB of high-freq
   dullness at extreme down-pitch.

8. **SuperCollider Book V2 review pending** — see `sandbox_op_ship_protocol.md`
   "Authorized second-primary source archives (local)" section. PAD-class
   synthesis isn't covered directly in SC-Book but Ch 2 (SC internals for
   wavetable playback) + Ch 16 (microsound/granular which shares the
   frequency-domain-first mindset) may surface interpolation / phase-
   distribution tricks.

---

## #87 scatteringJunction — bare 2-port (2026-04-24)

Primary: JOS PASP §7 "One-Multiply Scattering Junctions"
(https://ccrma.stanford.edu/~jos/pasp/One_Multiply_Scattering_Junctions.html).

Upgrade-path debt:

1. **|k|≤0.99 clamp vs passage's |k|<1.** JOS assumes k is derived from
   cross-section area ratios where |k|<1 is guaranteed. Our clamp is the
   conservative sandbox choice matching #87a. A strict implementation
   would allow k=±1 with explicit caller responsibility for stability
   (perfect reflector at closed/open tube end). Filed as low-priority.

2. **Control-rate k.** k is currently a scalar param (block-rate via
   setParam). For smooth time-varying topologies (articulatory vowel
   transitions, breathing filters) k should accept a control-rate input
   stream. Blocked on op registry `kind: 'control'` input plumbing for
   multi-input ops.

3. **One-multiply form not used.** We ship the Kelly-Lochbaum form
   (1 mul + 3 adds), not the alternative "one-multiply" form
   `f⁺_out = f⁻_in + α·Δ̃; f⁻_out = f⁺_out - Δ̃` where α = 1+k, Δ̃ = f⁺_in − f⁻_in.
   Both are 1 mul + 3 adds; our choice is numerically symmetric. The
   alternative form has better k=−1 behavior (α=0 decouples cleanly).
   Worth revisiting if (1) is ever relaxed.

4. **No energy-conservation audit.** For lossless junctions, the
   scattering matrix is orthogonal. We don't test that `|oP|² + |oM|² =
   |iP|² + |iM|²` at |k|<1 — only the defining equations. A passivity
   audit test should be added alongside the waveguide energy-balance
   pattern. See #86 waveguide energy tests for precedent.

---

## #115 dither — TPDF + 2nd-order shaping (2026-04-24)

Primary: Paul Kellett 2002, musicdsp.org Archive #61 "Dither Code"
(https://www.musicdsp.org/en/latest/Other/61-dither-code.html).

Upgrade-path debt:

1. **HP-TPDF not implemented.** Kellett's title says "Highpass triangular-PDF"
   but the shipping code uses pairwise `r1 − r2` which is flat-spectrum
   TPDF, not highpass. True HP-TPDF uses `r[n] − r[n−1]` (one-sample
   difference of a single uniform stream), pushing dither noise toward
   Nyquist. 1-line change: replace `r1 − r2` with `r − prevR`. Perceptually
   superior at high bit depths.

2. **RNG: LCG vs. higher-quality PRNG.** Canon:synthesis §10 LCG has a
   correlation between successive samples detectable above 20-bit depth.
   For true 24-bit dither the upgrade path is xoroshiro128+ or PCG.
   Still seedable → goldens remain stable.

3. **Only 2nd-order shaping.** Real mastering dither (POW-r, Apogee UV22,
   Waves L-series) uses 5th- to 9th-order psychoacoustic noise shapers
   (Gerzon/Lipshitz/Vanderkooy 9th-order minimum-noise curve). Filed
   under #114 noiseShaper which will carry the higher-order FIR feedback
   filter.

4. **Output stays float.** Sandbox is float-only; the op *simulates* bit
   reduction by snapping to the `wi` grid. True int16/int24 export lives
   at the plugin-I/O boundary, not in the sandbox graph. Not actually
   a deviation with action — just a pipeline constraint to remember.

5. **No overload guard.** Kellett explicitly notes "doesn't check for
   overloads." For `|in| > 1 − wi` the integer conversion can saturate
   above the nominal range. Our output is clamped implicitly by the
   `q | 0` bit-trunc in JS but still emits values slightly above ±1.
   Shippable as-is (caller is expected to feed nominal ±1 audio), but
   a `saturate=true` option would be nice.

6. **DC offset from `o = wi/2`.** Kellett's half-LSB offset is there to
   center the rounding, but it adds a constant DC of `wi/2` to the
   output. At 16-bit (`wi ≈ 3e-5`) this is inaudible; at 4-bit it's a
   measurable DC step. Fix: subtract `o` from the output (or use proper
   round-to-nearest instead of truncation + offset).

7. **No shape-filter choice.** `2·s1 − s2` is a fixed 2nd-order FIR
   (zeros at DC and Nyquist). Mastering-grade ops expose curve shapes
   (flat / F-weighted / E-weighted / ATH-based). Upgrade path: expose
   `shapeType` enum.

---

## #114 noiseShaper — N-tap shaped dither (2026-04-24)

Primary: musicdsp.org Archive #99 "Noise Shaping Class" (NS9dither16.h,
anonymous submission c.2002). Theory: Gerzon/Lipshitz/Vanderkooy/Wannamaker
"Minimally Audible Noise Shaping", JAES Vol 39 No 11, Nov 1991.

**Known bug in primary:** the shipped "unrolled for speed" form
(NS9dither16.h L105-L107) has `c[2]*EH[HistPos+1] + c[1]*EH[HistPos+1]` —
index 1 appears twice, index 2 is skipped. We ship the canonical
`for x=0..order-1: samp -= c[x]*EH[HistPos+x]` form instead. Worth
verifying whether any existing plugin chain using NS9dither16 historically
heard this bug as "the sound" — unlikely but possible.

Upgrade-path debt:

1. **No TPDF frand-quality audit.** Primary uses LCG `a = a*140359821 + 1`;
   we use Canon:synthesis §10 LCG (1664525/1013904223). Both are 32-bit
   LCGs with similar statistical limitations. Upgrade for mastering-
   grade work: xoroshiro128+. (Shared with #115 dither debt item 2.)

2. **Order limited to 2|3|5|9.** Primary ships 3/5/9 F-weighted + 9 ME/IE
   + 2-tap simple. For intermediate orders (4, 7) we snap to the next
   supported. Upgrade: precompute coefs for missing orders from the
   psychoacoustic weighting curves (Wannamaker 1990 polynomial fit).

3. **No 24-bit specific shaper.** NS9dither16 is a 16-bit shaper — the
   F-weighted curve peaks in the 16-bit noise-floor audible band. At
   24-bit reduction the shaping is inaudible and adds noise above the
   LSB without psychoacoustic benefit. Upgrade: 24-bit-tuned curves or
   automatic bypass at bits ≥ 20.

4. **Single channel.** Stereo should use DECORRELATED dither per channel
   (different RNG seeds) to avoid perceived mono noise image. Currently
   a single op handles one channel; downstream graph editor composition
   handles stereo by instantiating two nodes with distinct seeds.
   Nothing to fix here but worth documenting for preset authors.

5. **No overload guard.** Same as #115. Caller is expected to feed
   nominal ±1 audio; large inputs + aggressive order-9 F-weighted
   feedback could push |output| above 1 in degenerate cases. Test
   #2 bounds peak at <0.5 on silent input (the worst case for pure
   shaping noise), which is safe.

6. **Dual-buffer semantics preserved verbatim.** Primary writes
   `EH[HistPos+order] = EH[HistPos] = err` to avoid the `% order` on
   the read side. We do the same. If we later migrate to a pure ring
   buffer with masked indexing (power-of-2 lengths), this becomes a
   simplification opportunity. No audible difference.

---

## #116 chamberlinZeroCross — sign-mag DAC character (2026-04-24)

**PRIMARY STATUS: UNRESEARCHED UPSTREAM.** The declared primary is
Hal Chamberlin, "Musical Applications of Microprocessors" 2nd ed., Hayden
1985, Ch.12 §12.4 pp.375-394. This is a physical book not openable via
tool call. The op was shipped as a math-by-definition paraphrase of the
two artifacts the memory pointer (`chamberlin_microprocessors.md`)
describes — NO EQUATIONS WERE LIFTED VERBATIM.

**To close this debt:**
1. Find an openable academic primary. Candidates:
   - AES papers on 14-/16-bit linear & sign-magnitude DAC characterization
     (Holman, Lagadec, Stockham era, ~1978-1986)
   - Philips TDA1540 / Burr-Brown PCM55 datasheets (publicly archived)
   - Chamberlin's own cited references in §12.4 (whatever they are)
2. Diff the verbatim equation(s) against our current parameterization.
3. Re-bless the golden if the math changes.

**Algorithmic upgrade-path debt (separate from primary status):**

1. **Rasp on slow zero crossings not modeled.** Real sign-mag DACs
   produce a multi-sample "rasp" when the signal crosses zero slowly
   because many consecutive samples straddle the exponent boundary. Our
   1-sample spike misses this. Fix: scale glitch amplitude by
   `1/max(|dx/dt|, ε)` with a ceiling; files quietly.

2. **Two-sample settling transient.** Real DAC flip + reconstruction-
   filter settling is ~1-2 sample-periods at 48k. Our spike is exactly
   1 sample. Upgrade: biphasic spike (`+g` at n=crossing, `-g/3` at n+1).

3. **No code-dependent dead-zone size.** Sign-mag dead zone scales with
   bit depth (at 16 bits, 2 codes = 2/32768 ≈ 6e-5 full scale). We
   expose `deadZone` as a continuous knob divorced from bit depth.
   Upgrade: link to a `bits` param (share infrastructure with #115/#114)
   so the dead zone tracks quantization realistically.

4. **No floating-point-DAC exponent ripple.** That artifact is #117's
   scope (FP-DAC ripple, separate slot). When #117 ships, consider
   merging both into a single "vintage DAC" op with selectable
   behavior modes — or keep them separate so users can mix-and-match.

5. **Deterministic spike (no stochastic jitter).** Real DAC glitches
   have sample-to-sample amplitude variance (analog component noise,
   temperature, etc.). A seeded RNG scaling of the glitch amplitude
   would give a more lifelike texture. Low priority.

---

## #111 transformerSim — Jiles-Atherton anhysteretic Langevin

**Shipped v1 (2026-04-24).** Primary: Wikipedia "Jiles-Atherton_model"
(verbatim equations; 1986 JMMM paper paywalled). Ships memoryless
anhysteretic Langevin waveshaper `y = output·[L(drive·x+bias) − L(bias)]`
with bias-offset subtraction to preserve silence→silence.

### Upgrade paths

1. **P1 — Full Jiles-Atherton hysteresis loop.** v1 ships only the
   anhysteretic curve. The complete J-A adds the irreversible branch
   `dM/dH = (1/(1+c)) · (M_an − M) / (δ·k − α·(M_an−M))` plus the
   reversible fraction `c·dM_an/dH`. This is what produces actual
   *hysteresis* — path-dependent B-H loops, memory, minor-loop behavior.
   The audible difference: asymmetric attack-vs-release on transients,
   low-level "flutter" from stored magnetization. Requires RK4 (or at
   minimum backward-Euler) integration on `dM/dH` — sample-rate solver
   with care for numerical stability when `M` approaches `M_s`.

2. **P1 — Pre-integrator (Φ = ∫V·dt) for frequency-dependent saturation.**
   Real transformers saturate more at LOW frequencies because flux is the
   time-integral of voltage. v1 has a static waveshaper — same saturation
   at 20 Hz and 20 kHz. A leaky integrator (pole near DC) in front of the
   Langevin curve, with a matching differentiator at the output, would
   give the correct "bass-heavy saturation" character that defines
   transformer sound (consoles, tube amp output stages).

3. **P2 — HF loss model.** Leakage inductance in series with winding
   capacitance to ground forms a natural ~15–20 kHz roll-off on real
   transformers. v1 is broadband-linear outside the waveshaper. Add a
   user-exposed HF shelf or cascaded LR pole pair tuned to transformer
   type (small signal ~18 kHz; larger output transformers 12–14 kHz).

4. **P2 — Expose α (inter-domain coupling) parameter.** Small at audio
   levels, but an advanced preset could use it to shift the knee shape
   subtly. Worth exposing if we ever build a "custom core material"
   preset bank (silicon steel vs mu-metal vs nickel).

5. **P3 — Core-geometry presets.** Real transformer character depends
   on core shape (EI laminate vs toroid vs C-core), winding ratio,
   air gap. These map to M_s / a / α combinations. Could ship a preset
   bank emulating Jensen / UTC / Sowter / Lundahl characteristic values.

6. **P3 — DAFx search turned up nothing transformer-specific.** Future
   upgrade: consult Eichas & Zölzer "Virtual Analog Modeling of Dynamic
   Range Compression" (DAFx-16) only covers compression; need a
   transformer-specific paper. Candidates to chase: Holmes & Reiss
   "Modelling Saturation and Hysteresis in Audio Transformer Coils"
   (AES) if locatable.

---

## #117 fpDacRipple — ValhallaVintageVerb FP-DAC fingerprint

**Shipped v1 (2026-04-24).** `UNRESEARCHED UPSTREAM` — primary (Costello's
VintageVerb code) is closed-source. Math-by-definition primitive built
from Costello's public concept statements (KVR/Valhalla blog synthesis)
+ structural block-FP references (Wikipedia / TI SPRA948). Per-sample
exponent quantize, not block-based. Parameterized 2 vs 3 gain bits to
bridge Costello's and Sound On Sound's conflicting figures.

### Upgrade paths

1. **P1 — Block-exponent form (true RMX16 behavior).** v1 computes `e`
   per-sample. Real RMX16 uses a shared exponent across a short block
   determined from the block peak. This produces coarser ripple —
   exponent steps happen at block boundaries, not sample boundaries.
   Audibly: less fizz, more "chunk." Requires two-pass (peak detect →
   quantize) or 1-block look-behind latency.

2. **P1 — Sign-magnitude mantissa quantize.** v1 rounds symmetrically.
   Real RMX16-era DACs were sign-magnitude (see #116). Adding a
   sign-mag mode would stack cleanly with #116 if user chains
   `fpDacRipple → chamberlinZeroCross`.

3. **P2 — Companded gain-ranging (μ-law / A-law).** Some FP converters
   used log-companded mantissas rather than linear. Not RMX16, but is
   Lexicon 224 territory. Would give different tail character.

4. **P2 — Dither inside the mantissa quantize.** v1 has tail noise
   ADDED after quantize. Cleaner version would TPDF-dither (#115)
   BEFORE the mantissa round. Users can chain #115→#117 meantime.

5. **P2 — Exponent-transition click suppression.** At exponent
   boundaries step size doubles abruptly. Real hardware had S/H +
   analog smoothing. A 1-2 sample micro-crossfade at transitions
   would soften "click" on loud transients straddling a boundary.

6. **P3 — DAC output-filter modeling.** RMX16 output went through a
   steep analog reconstruction filter. Out of scope here (fixed tone-
   shaping — better solved by a dedicated post-filter op).

7. **P3 — Dedicated primary hunt.** Revisit if Costello opens the
   code, or if DAFx publishes a vintage-converter modeling paper.
   Math-by-definition v1 is within shouting distance of target based
   on concept descriptions.

---

## #112 tapeSim — magnetic tape character

**Shipped v1 (2026-04-24).** Three-stage chain (sat → head-bump → HF loss).
Primaries verbatim: musicdsp #86 gloubi-boulga (Laurent de Soras 2002),
RBJ Audio-EQ-Cookbook peakingEQ. 1-pole LP is math-by-definition. Scope
intentionally tight: character *color* only, no hysteresis or pitch
modulation.

### Upgrade paths

1. **P1 — Hysteresis (Jiles-Atherton or Preisach).** v1 is memoryless
   saturation. Real tape has magnetic memory — the M-H curve has a
   loop, producing asymmetric response on attack vs decay, low-level
   "flutter" from stored magnetization, and characteristic even-
   harmonic build-up. Primary candidates: DAFx "Virtual Analog
   Modeling of Magnetic Tape" (Bogdanowicz & Piazza 1986 as cited
   secondary), or more recently Holters/Parker tape models. Shares
   the full-J-A upgrade path with #111 transformerSim — when one
   lands, port to the other.

2. **P1 — Wow & flutter (pitch modulation).** v1 has no pitch modulation.
   Tape wow (slow, ~0.5 Hz, ±0.1%) and flutter (fast, ~6 Hz, ±0.02%)
   are defining tape character. Currently wireable via external LFO
   (#58) → delay (#15) — but packaging as built-in params (wowRate,
   wowDepth, flutterRate, flutterDepth) would be more discoverable.
   Note interaction with head-bump: wow moves the bump frequency too
   in real tape. v2 should co-modulate.

3. **P1 — Pre-emphasis / de-emphasis EQ.** Tape machines apply a
   high-shelf boost BEFORE recording and cut AFTER playback to fight
   HF noise floor. Missing this means v1 saturates HF differently
   than real tape. NAB / IEC curves are standardized (3180 µs / 50 µs
   time-constants typical). Add as `speedIps` param preset that sets
   both pre- and post-emphasis.

4. **P2 — Speed-calibrated HF ceiling.** v1 has hfHz as free param.
   Real tape speed determines the ceiling: 7.5 ips → ~15 kHz, 15 ips
   → ~20 kHz, 30 ips → ~25 kHz. A `speed` enum that auto-sets hfHz
   (and pre-emphasis, and head-bump center) would be more intuitive.

5. **P2 — Biased-signal AC bias HF modulation.** Real tape heads
   apply a ~100 kHz AC bias on top of the audio signal. Signal-
   dependent interaction with the bias produces a characteristic
   "shimmer" (intermodulation with self). Only matters for studio
   machines; most tape-sim plugins skip this. Flag only.

6. **P2 — DF2T state reset on setParam.** v1 recomputes biquad coefs
   but keeps old state; large param changes can zipper. Add crossfade
   or ramp between old/new coef sets over N samples.

7. **P2 — Asymmetric saturation mode.** Gloubi-boulga is close to odd
   symmetric. Real tape has slight even-harmonic asymmetry from
   residual magnetization. A `bias` param (like #111 transformerSim)
   would add this — either as gloubi pre-offset or as a second-order
   chebyshev additive term.

8. **P3 — Multi-stage head network.** Real tape machines have separate
   record head, tape transport, and playback head — each contributes
   character. v1 collapses all into one. A two-stage variant
   (record-side sat + playback-side sat with different curves) would
   be more faithful but probably overkill for sandbox.


### #112 tapeSim — Airwindows ToTape9 reference (logged 2026-04-24)

**Context.** User supplied Airwindows ToTape9 (MIT, 806 lines,
`ToTape9Proc.cpp` fetched from github.com/airwindows/airwindows) as
"best tape sim on the market." Reviewed full pipeline against shipped
v1 (gloubi → RBJ peak → 1-pole LP).

**Resolution.** Shipping as separate slot **#112a tapeAirwindows**
rather than re-blessing #112 — two distinct flavors (de Soros gloubi
minimal vs. Airwindows 12-stage) serve different sandbox use cases.
v1 tapeSim stays as shipped.

**Airwindows ToTape9 pipeline stages (for reference):**

1. Input gain + Dubly encode (Dolby-like HF emphasis, lines 95-118).
2. Flutter: 1000-sample circular buffer w/ LCG-jittered sin-modulated
   fractional offset (lines 121-154).
3. 9-threshold golden-ratio bias/slew chain (`1.618033988749894848`
   spacing, per-threshold slew + under-bias sticking hysteresis,
   lines 156-210).
4. Tiny hysteresis leak (lines 212-220).
5. Pre-averaging cascade (2/4/8/16/32-tap, lines 220-222).
6. **Taylor-sin saturator** clamp ±2.305929007734908, coefs
   `/6, /69, /2530.08, /224985.6, /9979200` — empirically detuned
   (not pure Taylor `/5040, /362880, /39916800`), lines 223-234.
7. Post-averaging cascade (mirror of pre, lines 236-244).
8. **Head-bump dual biquad BPF** — tan-K form, reso = 0.618 (golden-
   ratio inverse), A/B staggered (B = 0.9375·A), cubic soft-clip
   before biquad (`x -= x³ · 0.0618/√overallscale`), lines 290-340.
9. Dubly decode (HF de-emphasis mirror of encode, lines 345-360).
10. ClipOnly3 post-limiter (separate Airwindows module).
11. Output gain.
12. Noise-shape dither (Airwindows house shaper).

**Debt against #112 (v1 gloubi variant).**

| # | Priority | Gap | Airwindows citation |
|---|---|---|---|
| 9 | P1 | No flutter / wow modulation. v1 is DC-stable; real tape has subsonic speed modulation. | ToTape9 lines 121-154 (1000-sample circular w/ LCG-jittered sweep) |
| 10 | P2 | No bias/slew hysteresis. Gloubi is memoryless; real tape retains prior-sample magnetization. | ToTape9 lines 156-210 (9-threshold golden-ratio chain) |
| 11 | P1 | No averaging cascade. Gloubi saturates cleanly w/o pre/post smoothing. Airwindows averages both sides. | ToTape9 lines 220-244 |
| 12 | P2 | Single-biquad head-bump. Airwindows uses dual staggered + cubic soft-clip before. | ToTape9 lines 290-340 |
| 13 | P3 | No Dubly encode/decode. Optional HF companding colors pre/post saturation. | ToTape9 lines 95-118, 345-360 |

All five land in #112a, not #112 — keep v1 lean for CPU-cheap use.


### #113 tubeSim — Koren triode deviations (logged 2026-04-24)

**Baseline shipped.** Norman Koren 1996 SPICE triode model, eq. (4) verbatim,
12AX7 parameter defaults. Math-by-definition sandbox mapping
(EG = -bias + drive·x, DC-subtract quiescent).

**Debt:**

| # | Priority | Gap | Known-better citation |
|---|---|---|---|
| 14 | P1 | **No grid-current rectification.** Real 12AX7 conducts grid current when EG > 0, producing asymmetric soft-limit + bias shift ("grid-compression"). Koren's eq.4 is accurate only for EG ≤ 0. | Pakarinen & Yeh, "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," CMJ 2009 — grid-current term; Yeh PhD thesis 2009 §3.4. |
| 15 | P1 | **No plate-load dynamic coupling.** Real stage has plate resistor R_L forming voltage divider with tube — output is `V_P = B+ - IP·R_L`, load-line swing causes dynamic compression as IP grows. Shipped fixes EP = plateV constant. | Macak & Schimmel 2010 "Real-time guitar tube amplifier simulation using an approximation of differential equations." |
| 16 | P1 | **No Miller-capacitance HF roll-off.** Input capacitance ~C_gk + (1+A)·C_ga rolls off HF at each stage — signature "dark" tube character. Users wire #9 shelf externally as workaround. | Any tube amp design text (Jones "Valve Amplifiers" §3). |
| 17 | P2 | **No supply sag.** B+ rail drops under heavy current draw (class-A output tubes), causing dynamic envelope. Only matters for power stages; preamp (12AX7) draws too little to sag. | Dempwolf/Zölzer 2011 "Discretization of parametric analog circuits." |
| 18 | P2 | **Per-tube variation not modeled.** Real tubes vary ±20% on each parameter (and age-drift). A "tube-variation" seed param would let users voice per-track. | Academic: not standardized; could be a sandbox-specific UX feature. |
| 19 | P2 | **No 1/f flicker or microphony.** Real tubes have shot noise + flicker floor + mechanical vibration pickup. Could layer #58 noise + sidechained envelope. | Vogel, "Sound of Silence," tube noise measurements. |
| 20 | P3 | **Pentode models not exposed.** Koren's eq.(5) covers pentodes (EL34, 6L6, KT88) with additional `arctan(EP/kVB)` term. Power-stage tone. | Koren article eq.(5) — same primary, unsourced in shipped op. |
| 21 | P3 | **No thermal drift.** Cathode temperature modulates μ and cathode-grid distance over seconds. Slow drift audible on long-sustained notes. | Not typically modeled. |

All debt rows are v2 upgrade paths — v1 Koren waveshaper is ship-safe
and sounds recognizably "tube" when wired after #9 shelf (Miller) +
before #17 dcBlock.


---

## #108 plate — Dattorro 1997 JAES "Effect Design Part 1: Reverberator"

Primary source: Dattorro, J. (1997). *Effect Design Part 1:
Reverberator and Other Filters*. Journal of the Audio Engineering
Society, Vol. 45, No. 9, pp. 660–684 (plate topology pp. 662–665,
Fig. 1 + Tables 1, 2). PDF fetched 2026-04-24 from
`ccrma.stanford.edu/~dattorro/EffectDesignPart1.pdf`.

Shipped verbatim: Fig. 1 topology (4-serial input diffusion with
coefs 0.750 and 0.625; figure-eight tank: 2× modulated
decay-diffusion-1 allpasses at 672/908 samples with coef = −0.70;
delays at 4453/4217 and 3720/3163; decay-diffusion-2 allpasses at
1800/2656 with coef = decay+0.15 clamped 0.25..0.50); Table 2
output taps (7+7 × ±0.6 alternating). Sample counts are verbatim
and scaled linearly by `sr/29761 · size`.

Deferred upgrade paths (all ship-safe as v1 exists):

| # | What Dattorro describes | What v1 does | Upgrade |
|---|---|---|---|
| 1 | Allpass interpolation on modulated taps (§1.3.7: "All-pass interpolation overcomes [the time-varying LPF] problem and is perfectly applicable to reverberators") | Linear interpolation — introduces small "uncounted damping" per Dattorro's own note | Swap the two modulated-allpass readFrac calls for allpass-interp reads (Lagrange or Thiran); coefficient needs per-sample update only when the fractional delay crosses integer boundaries |
| 2 | Magnitude truncation (§1.3.4) for limit-cycle suppression in the tank allpasses at reduced internal precision | v1 runs at f32 throughout — no truncation logic, relies on native f32 smoothness | Adds 12–24 dB below limit-cycle floor per Dattorro; only matters if we ever compile to fixed-point or 16-bit |
| 3 | Output-tap structure as the plate's *synthetic stereo* — Dattorro notes the "desired output is a mix of the stereo reverberated signal yL and yR with the original (dry, full-bandwidth) stereo input signal xL and xR" | v1 outputs pure wet; caller composes dry/wet externally per the dry/wet mix rule | Consistent with project-wide mix-inside-worklet policy for real plugins; op stays wet-only by design |
| 4 | Independent modulation rates/depths per diffuser (§1.3.7: "Ideally, all the delay lines in the tank diffusers should be modulated using different modulation rates and depths") | v1 modulates only the two tank-input allpasses, quadrature LFO, shared depth/rate | Optional richness upgrade; Dattorro already concedes this for "computation time constraint" reasons |
| 5 | Predelay as part of tap structure (schematic shows predelay *before* input bandwidth LPF and input diffusion) | v1 matches — predelay is first stage after mono collapse | Correct, no debt |
| 6 | Dense-ER character from the input diffusion chain | v1 matches — 4 serial lattice APs per paper | Correct, no debt |
| 7 | Damping filter "tracks cutoff frequency" inversely (§1.3.5: "the damping coefficient is high when the damping filter cutoff frequency is low") | v1 exposes the raw coefficient as `damping` 0..0.99 — user-facing convention opposite to natural "brightness" knob | Future: add a `brightness = 1-damping` alias param at the brick layer so UIs read naturally |
| 8 | Non-stereo input mode: schematic collapses `(xL+xR)/2` before predelay | v1 matches verbatim | Correct — note the paper's acknowledgement that this converts to mono before producing *synthetic* stereo via tap structure |

v1 is a faithful Dattorro plate. Row 1 (allpass interpolation) is the
most musically consequential upgrade — the tank modulation should be
heard as pitch shimmer only, not as a time-varying low-pass. Row 2 is
irrelevant unless we target fixed-point. Rows 3/5/6 are already
correct; rows 4/7/8 are convenience/naming.

---

## #109 spring — Parker 2011 EURASIP / Välimäki 2010 JAES

Primary source: Parker, J. (2011). *Efficient Dispersion Generation
Structures for Spring Reverb Emulation*. EURASIP Journal on Advances
in Signal Processing, Vol. 2011, Article ID 646134, 8 pp. Open access.
Fetched 2026-04-24 from springeropen.com. §2 recaps the Välimäki,
Parker & Abel 2010 JAES parametric structure [7], which is what v1
actually implements; §3's multirate optimisation is not shipped (debt).

Shipped verbatim: eqns (1)–(3) — first-order allpass A(z), stretched
variant H_single(z)=A(z^k), cascade H_cascade=A^M(z^k). Figs. 2/3
feedback topology on both branches. 1-pole lowpass at the transition
frequency f_C on the C_lf branch only. Output mix per Fig. 1 (wet
only; dry is caller's job).

Deferred upgrade paths:

| # | What the paper / Välimäki [7] describes | What v1 does | Upgrade |
|---|---|---|---|
| 1 | Parker §3.1–3.3: multirate "chirp-straightening" — run C_lf at sr/4, split via Linkwitz-Riley 8th-order crossover, double the stretch factor on C_hf for 3× CPU reduction | Full-rate straight cascade on both branches | Saves ~66% CPU per Parker's Table 2; sonically indistinguishable per §4. Worthwhile when we ship multiple spring instances. |
| 2 | Välimäki [7]: random modulation of the delay lines (§2 ref, "included features" list) | Static delay lines | Adds the subtle "breathing" shimmer real springs have — without it the chirps sound frozen. Implement as slow LFO on `lenL`/`lenR` with allpass-interp reads. |
| 3 | Välimäki [7]: cross-coupling of the two feedback loops (§2 ref) | Loops are independent | Couples chirp families so high band's echo pattern modulates low band's and vice-versa; more authentic "Fender/Accutronics" character. |
| 4 | Välimäki [7]: equalisation filter (§2 ref) — matches measured spring EQ | No EQ | Adds resonant peak around f_C and rolls off < 100 Hz; pre/post the main structure. |
| 5 | Group-delay equation (4): `D = k·M·(1−a²)/(1+2a·cos(ωk)+a²)` | Not exposed as control | Could drive a "chirp pitch target" UI param: user picks the frequency where group delay peaks, op solves eq. (6) for `a` to match. Parker gives the closed form. |
| 6 | Sign of `a` (paper §3.2 discusses negative-a trick on C_lf for chirp straightening) | v1 uses positive a on C_lf, negative on C_hf | Correct for v1's plain-cascade build per §2; rethink if/when §3 is adopted (debt row #1). |
| 7 | Transition frequency f_C as the chirp-series crossover (§2 "the main series of chirps is present only below… f_C") | Exposed as `transitionHz` param → LPF on C_lf | Correct, no debt. |
| 8 | Stereo output | Paper is mono (single spring) | v1 synthesises stereo by routing C_lf → L-dominant, C_hf → R-dominant with 30% cross-bleed. Alternative: ship a true dual-spring (L + R each with its own pair of loops, slightly detuned) for more authentic stereo spring-pair character. |

v1 is ship-safe as "one-spring parametric Välimäki". Debt row #2 is
the most musically consequential upgrade — without delay-line
modulation the chirp series is too regular. Row #1 is the CPU lever
to unlock when we ship a whole plugin built around this op.

---

## #110 SDN — De Sena, Hacıhabiboğlu, Cvetković & Smith 2015 IEEE/ACM TASLP
### (Scattering Delay Networks)

v1 implements §III of the paper verbatim for a rectangular shoebox:
6 wall nodes, K=5 neighbours each, isotropic scattering matrix
A=(2/K)11ᵀ−I, Sabine absorption β=√(1−α), source and mic injection
per eqs 8/11/13/14, LOS path explicit. First-order reflections are
rendered exactly via mirror-image node placement (§III-A claim).

| # | What the paper / follow-ups describe | What v1 does | Upgrade |
|---|---|---|---|
| 1 | §III "frequency-dependent wall filter" via H_k(z) with ISO-354 octave-band α data (Moorer-style shelving) | Single 1-pole LP per node driven by `damping` scalar | Real materials vary absorption sharply with frequency (carpet ≠ concrete); 1-pole can't match measured α(ω). Upgrade = per-octave biquad shelf cascade fit to ISO-354 table. |
| 2 | Source directivity Γ_S(θ_{S,k}) per outgoing line; mic directivity Γ_M(θ_{k,M}) | Omnidirectional (Γ≡1) | Needed for instrument-radiation realism (voice, horn, cabinet). Drop in spherical-harmonic or cardioid/dipole patterns; geometry already computes θ. |
| 3 | §III discussion of Fig.5 second-order reflection paths | Approximated implicitly through the network — no explicit 2nd-order geometric correction | Paper notes "coarser approximations for higher-order reflections"; ship as-is, but for critical rooms (IR matching) add side-chain of 2nd-order image-source taps. |
| 4 | ISO-354 random-incidence α coefficient mapping | Sabine V/(c·S·T60) mapped then clamped | Sabine is approximate for non-diffuse rooms; Eyring or Fitzroy-corrected T60→α would give closer measured-hall match. |
| 5 | §III rectangular-only. Paper: "straightforward extension to arbitrary polyhedral spaces" | Hard-wired 6 walls (shoebox only) | Let user pass a mesh; map one node per face. Needs reflection-point solver for non-parallel walls. |
| 6 | Source+mic position runtime params | Fixed baseline positions (2,2,1.6) / (5,4,1.6); `size` scales uniformly | Expose (x,y,z) per endpoint; already trivial given geometry code. UI question more than DSP. |
| 7 | Multi-mic (binaural / Ambisonics) rendering off the same network | Single stereo pair via two tap sets on one graph | Network state is shared; adding N mic ports is just N tap-delay banks. Enables B-format / HRTF-convolved output. |
| 8 | §IV.A transfer-function form (eqs 25/27) for IR offline export | Realtime only, no IR readback | Expose an offline-render API to dump the RIR for convolution export or null-test against an image-source reference. |

v1 is ship-safe as "Sabine-tuned parametric shoebox SDN". Row #1
(frequency-dependent absorption) is the most musically consequential
upgrade — with flat α, the decay spectrum is unnaturally uniform;
real rooms darken as they decay. Row #5 (non-shoebox rooms) is the
biggest scope expansion and only needed if we ever expose
"drum booth" / "cathedral" / "car interior" presets with distinct
geometry rather than just RT60 scaling.

---

## #107 schroederChain — Schroeder 1962 JAES
### (Natural Sounding Artificial Reverberation)

v1 implements the pure 4-comb + 2-allpass topology with canonical
Schroeder delay values (29.7/37.1/41.1/43.7 ms + 5.0/1.7 ms),
per-comb gain derived via the textbook T60 formula g=10^(−3τ/T60),
allpass g=0.7 (JOS/STK reference). Optional Moorer 1979 1-pole LPF
in comb FB is an opt-in extension (damping=0 disables).

| # | What the literature describes | What v1 does | Upgrade |
|---|---|---|---|
| 1 | Schroeder-Logan 1961 / Schroeder 1962: allpass g=0.708 (JOS/STK) vs Valhalla blog citing 0.8 | Fixed g=0.7 | Two published values exist; our choice matches JOS+STK. Could expose `apG` for users who want the slightly more diffusive 0.8. |
| 2 | Moorer 1979 "About This Reverberation Business": 6-comb + 1-allpass + early-reflection TDL for more convincing rooms | 4-comb + 2-allpass (pure Schroeder 1962) | Moorer's variant is a *sibling op*, not an upgrade — ship as #107a if wanted. |
| 3 | Freeverb (Jezar 2000): 8 combs + 4 allpasses with per-comb damping + stereo `stereospread=23` default | 4+2 with optional damping + spread param | Same: Freeverb is a *sibling*, not an upgrade. #107b slot if we ever want the Freeverb numbers verbatim. |
| 4 | STK JCRev: Chowning 1971 MUS10 variant — 4 combs + 3 allpasses + 2 output-decorr delays + lowpass in comb FB | Not implemented | Could ship as #107c JCRev variant; different texture than Schroeder 1962 proper. |
| 5 | Gardner 1992 (MIT thesis): nested allpass structures give ~2× echo density per cascade | Plain series allpasses | Drop-in: wrap apsL[1] inside apsL[0]'s delay path. Sean Costello / Dattorro popularised this; Dattorro plate (#108) uses the idea. |
| 6 | Moorer 1979: early-reflection TDL added in parallel with comb bank to carry direct-path + first reflections | Combs-only, no ER carve-out | #21 ER op already covers this — compose them at the plugin level. |
| 7 | Schroeder 1962: mono output (single reverb line) | Stereo via Freeverb `spread` offset on R bank | Declared extension. `spread=0` collapses to mono L==R (verified in tests). True stereo would run two independent reverbs on decorrelated L/R inputs. |
| 8 | Mutually-prime delay selection rule (Schroeder 1962 explicit design principle) | Canonical ms values scaled by `size` then floored → may collide on exact coprimality | At size=1 the stock delays at 48kHz (1426/1781/1973/2098 samples) are NOT strictly coprime (e.g. 1426=2·23·31, 1781=13·137); deliberate off-integer ratios still decorrelate the combs well enough. Strict coprime rounding = quality-upgrade debt. |

v1 is ship-safe as "canonical Schroeder 1962 reverb primitive". Rows
#2/#3/#4 are the biggest sibling-ship opportunities (Moorer / Freeverb
/ JCRev variants), not upgrades of this op. Row #5 (nested allpasses)
is the one genuine quality upgrade; #108 plate already demonstrates
how to wire it when we want higher echo density.

---

## #77 pyin — research debt (shipped 2026-04-24)

Ship is faithful to `github.com/c4dm/pyin` (Mauch's own Vamp source,
GPL v2+) — all Beta PMF tables and HMM constants copied verbatim; not
a stripped-down variant. Paper vs code conflicts resolved in code's
favour and logged in op header comment. Outstanding work:

(a) **FFT-accelerated difference function.** Current Stage-1 uses
    naive O(W·τmax) same as op #76 yin. Wiener–Khinchin via FFT
    (d(τ) = r(0) + r_tau_rev(0) − 2·r(τ), where r = autocorrelation)
    collapses this to O(W log W) — meaningful at W=2048. Canon:time
    §5 Sernine / Canon:analysis §5 QFT FFT both applicable. Wire when
    ops #71 `fft` / #59 `stft` land in master-worklet codegen.

(b) **Full backward-Viterbi vs fixed-lag.** Mauch's offline reference
    does full-trajectory backtrace at end of signal (`SparseHMM::decodeViterbi`).
    Our worklet uses fixed-lag online (`SparseHMM::process`), latency =
    `lag·hop` frames behind realtime. Offline variant would be a
    separate sibling op `pyinOffline` for batch analysis / authoring-
    side pitch editors. Not needed for streaming chain.

(c) **Paper-literal preset.** Mauch 2014 paper uses M=480 bins @
    10-cent resolution, 55 Hz minFreq (A1), ±25-bin (±250-cent)
    transition. Code ships M=345 @ 20 cents, 61.735 Hz, ±5 bins.
    Preset flag `paperLiteral=true` would rebuild HMM with paper
    constants — useful for academic replication / A/B comparison.
    Defer until we have a second pYIN user pushing for it.

(d) **Beta-distribution generator.** Beta PMF tables are hard-coded
    for 4 Mauch-chosen (α,β) pairs. Exposing (α,β) as runtime params
    and regenerating the 100-element PMF on param change via the
    reference gamma/beta math would let users dial "prior tightness"
    continuously rather than choosing between 5 fixed priors. Cost:
    ~O(100) CDF evals on param change. Low priority — 5 presets
    span paper's recommended regime.

(e) **Energy gate threshold.** Hard-coded `1e-10` silent-frame cutoff
    matches op #76 yin. Parametrise once enough users ask to tune
    sensitivity for quiet material (gate is equivalent to an RMS
    floor of √(1e-10/W) ≈ 2.2e-7 at W=2048 — already deep into noise
    floor for 16-bit material).

(f) **Parabolic refine site.** We refine τ on d′ (pYIN candidate
    binning) but de Cheveigné §II.E specifies d. Mauch's code also
    uses d′ in `yinPitchProbabilityFunction` for binning, so we match
    code; leave noted.

---

## #105 haas — research debt (shipped 2026-04-24)

Math-by-definition DSP (short delay + gain + side-select). Psychoacoustic
defaults cited from Haas 1951 via Wikipedia secondary — the AES primary
paper was NOT opened. Outstanding work:

(a) **Open the AES primary.** Haas 1951 JAES 20(2):146-159 (1972 English
    translation). Confirm the thresholds Wikipedia cites (<2 / 2-5 /
    5-30 ms; +10 dB ceiling) match the original numerical tables.
    Could reveal more nuanced findings (e.g. speech-vs-music-specific
    thresholds, frequency-dependent echo thresholds).

(b) **Blauert *Spatial Hearing* Ch.3 primary read.** Modern restatement
    of precedence-effect literature; gives per-frequency echo-suppression
    data, build-up effect (repeat-click suppression grows stronger with
    exposure), and breakdown-on-transients. Would inform: (i) low-pass
    filter on delayed leg; (ii) transient-detection that temporarily
    reduces echo-leg gain on onsets so percussion doesn't fracture the
    fused image.

(c) **Strict-precedence mode.** Optional flag that caps `delayMs` at
    30 ms so the op cannot stray into explicit-echo territory. Current
    design permits 0-50 ms for creative freedom; a strict toggle would
    be useful for broadcast/sound-reinforcement use where echo is a bug.

(d) **Low-pass on delayed leg.** Real-world reflections are HF-attenuated
    (wall absorption). Adding a one-pole LPF (default cutoff ~4-6 kHz)
    on the delayed tap gives more natural reflections and strengthens
    the precedence effect. Compose with #22 onePole or fold in.

(e) **All-pass decorrelator alternative.** For mono sources where the
    Haas delay audibly "pulls" the image, replace the delay with a
    short all-pass cascade of differing group-delays per channel:
    equal-energy but differently-phased L/R gives wider image without
    the pre-echo. Kendall 1995 JAES is the primary.

(f) **Transient-aware echo-leg gain.** Precedence-effect breakdown on
    impulsive material (clicks, percussion) — solution is to key a fast
    duck on the delayed side from onset-flux detection so transients
    don't split into two events. Ties #56 onset → delayed-leg gain.

(g) **Per-frequency decorrelation.** Kendall-style multi-band allpass
    chain with different modulation per band is the modern upgrade;
    relates to Orfanidis 1996 spatializer topology.

(h) **Stereo input handling.** Current op sums L+R×0.5 pre-delay to avoid
    compounding width. Alternative: preserve input stereo and apply
    Haas only as an M-side trick (M unchanged, S = M·delayed - M) for
    M/S-native material. Parametrise via a `mode` enum.

### #105 haas — additional unopened-primary debt (added 2026-04-24)

(i) **Fractional-delay tap — open JOS PASP Ch.4 + Zölzer DAFX §11.3.**
    Current ship uses first-order linear interp (Lagrange-1). This is
    one pick from a documented menu, not math-by-def. Tradeoffs: linear
    introduces HF rolloff (cos(πf/fs)-shaped magnitude dip near fs/2)
    and amplitude modulation across fractional-sample boundaries. The
    menu, with Canon:time paste-and-adapt upgrade paths:
      - Hermite cubic (Canon:time §1) — 4-tap, near-flat magnitude
        to ~0.4·fs, good default for transparent delay lines.
      - Niemitalo optimal cubic (Canon:time §2) — 4-tap coefficients
        optimized for minimum interpolation error on audio material.
      - Thiran allpass — phase-correct, magnitude-flat; preferred for
        physical-modeling contexts where group delay matters.
      - Bielik SIMD (Canon:time §3) — performance-optimized variants.
    Acceptable default for haas because the delayed leg is a creative
    effect, not a transparent path — HF loss on the delayed side is
    even arguably pro-Haas (echoes HF-absorb in real rooms, see Blauert
    debt row (d)). Still, upgrade is cheap and would benefit siblings
    that reuse this frac-tap topology.

(j) **Stereo summing — ×0.5 vs ×1/√2 (equal-power).**
    Current `in2`-present path: `x = (a + b) × 0.5`. This is correct
    for **correlated** sources (mono sum scaled down 6 dB to prevent
    clipping; RMS preserved iff signals identical). For **decorrelated**
    stereo program (two near-independent channels), ×1/√2 (equal-power,
    -3 dB each) preserves RMS of the pair, matching what most mixers do
    on LCR-to-L downmix. Real music material sits between these extremes.
    Upgrade: add a `sumLaw` enum {`sum6`, `equalPower`} with `sum6` as
    default (current behavior). Zölzer DAFX §11 on stereo processing
    discusses this tradeoff; Rumsey *Spatial Audio* is the secondary.
    Low priority — only matters when users route explicit stereo into
    the widener rather than a mono bus, which is the less-common case.

---

## #103 panner — research debt (shipped 2026-04-24)

Three canonical pan laws shipped bit-identical to CMU ICM primary.
Outstanding upgrade paths:

(a) **Blumlein 1931 UK Patent 394,325 primary audit.** The sin/cos
    constant-power law is commonly attributed to Blumlein's stereo
    patent; open the patent text (available via UK IPO and Google
    Patents) to confirm the original derivation and any historical
    notes on the compromise laws. Academic-hygiene debt, not a bug.

(b) **JOS *Spatial Audio* cross-cite.** The CCRMA web text primary
    page 404'd at the URL tried. Find Smith's canonical spatial-
    audio reference (likely at `ccrma.stanford.edu/~jos/pasp/` under
    the amplitude-panning section) and cross-cite alongside CMU ICM.

(c) **VBAP (Pulkki 1997 JAES, "Virtual Sound Source Positioning
    Using Vector Base Amplitude Panning").** Two-channel constant-
    power is the degenerate N=2 case. For multi-speaker panning
    (surround, height), VBAP generalizes the geometry. Separate op.

(d) **DBAP (Lossius 2009 ICMC, "DBAP — Distance-Based Amplitude
    Panning").** Geometry-based panning for arbitrary speaker arrays
    where VBAP's triangulation assumptions fail. Separate op.

(e) **Additional pan laws.** The ICM primary only documents three;
    other canonical choices seen in DAWs: (i) **−3 dB equal-power
    but with log taper** (ProTools); (ii) **−4.5 dB** (CMU ICM’s
    third law, already shipped); (iii) **0 dB** (Ableton Live
    default — linear but boosted +6 dB on hard edges); (iv) **sinc
    interpolation** for smoother gain curves on moving pans. Ship
    as additional `law` enum values once a primary consensus exists.

(f) **Per-sample smoothing on `pan` automation.** Current ship recomputes
    `gL, gR` only on `setParam('pan', …)`, which is block-rate.
    Fast sweeps will zipper at block boundaries. Upgrade: one-pole
    smooth on `pan` before the gain recompute, or sample-rate gain
    interpolation between block-boundary targets. P1 once a modulator
    (LFO, envelope) is wired to pan.

(g) **Pan + balance unified mode.** Current op is pan-only (mono→L/R
    via gain pair). "Balance" mode (stereo-in, attenuate far channel
    only) is a distinct operator. Either (i) ship as separate
    `op_balance.worklet.js` or (ii) add `mode` enum {`pan`,
    `balance`} to this op. Mixers traditionally distinguish.

(h) **Stereo-in sum law = ×0.5.** Same design pick as #105 haas;
    see that op's debt row (j) for the full sum6-vs-equalPower
    discussion. When #105(j) lands, apply same fix here.

(i) **Width-compensation option.** When both pan and width are wired
    in series, the constant-power law gives a narrowing-on-pan
    artifact. Width-compensated panning (Moorer 1985 or Gerzon
    ambisonic decoder) preserves apparent source width across pan
    sweeps. Research-only until a width-capable source op exists.

## #104 autopan

(a) BPM-sync. Shipped as free-running Hz only. DAW/transport lookup for
    tempo-synced rates (1/4, 1/8, 1/8T, 1/16 dotted) requires host
    transport API — deferred until transport op exists.

(b) True stereo autopan. Current op mono-sums `in+in2` before panning, so
    a stereo input collapses to mono then re-pans. Proper stereo autopan
    would modulate L and R gains independently (LFO antiphase on the two
    channels), preserving incoming stereo image. Requires 4-gain topology
    (gLL, gLR, gRL, gRR) — design pick, not opened primary.

(c) Ramp-on-shape-change. Switching shape (sine→square) mid-run steps
    the LFO value discontinuously → click. Fix: crossfade old→new shape
    over a few ms. Not in Puckette §5.2; design hygiene.

(d) Band-limited square/triangle. Naïve square/triangle LFOs are fine
    at sub-audio rates (< 20 Hz) because sidebands fold below hearing,
    but if rate range is ever raised into audio (tremolo-ring-mod regime)
    MinBLEP (Canon:synthesis §13) is required. Currently gated by the
    `rateHz ≤ 20` clamp.

## #118 crossfeed

(a) ITD (interaural time delay). Real head adds ~200–700 µs delay to
    the contralateral ear. libbs2b omits this deliberately (CPU). Meier-
    style crossfeeds use a Thiran fractional-delay allpass on the
    cross-fed signal. Upgrade: wire a Thiran(N=1, d≈0.3ms) on the
    lo[] signal before the cross-sum. Primary: JOS PASP "Fractional Delay
    Filters" (already opened for haas debt (i)).

(b) HRTF-based crossfeed. Whole-class upgrade from 1-pole-pair to
    convolution with measured head-related transfer functions (SOFA
    format). Huge quality jump, requires convolution op (#56, ⬜ not
    shipped) + SOFA ingestion. Park until #56 lands.

(c) Preset enum. libbs2b exposes 3 named presets (Default 700/4.5,
    Chu Moy 700/6.0, Jan Meier 650/9.5). Current op exposes raw fcut+feed;
    wrap as preset sugar once UI layer wants dropdowns.

(d) Bauer 1961 paper direct consult. AES paywalled. Math reached via
    libbs2b (MIT, verbatim port). If paper itself opens later, verify
    the (-5/6, 1/6) coefficient partition against the original derivation
    — bs2b's comment says it's Boris Mikhaylov's adaptation, not literal
    Bauer numerics.

(e) Higher-order crossfeed filters. bs2b's 1-pole LP has gentle 6 dB/oct
    rolloff. Meier "Enhanced" and Naim variants use 2nd-order LR or
    analog-modeled 2nd-order for steeper separation above fcut. Upgrade
    path: swap _recomputeCoeffs for biquad pair; reuse Canon:filters §1
    RBJ cookbook.

(f) Sample-rate-dependent headroom. `gain = 1/(1−G_hi+G_lo) > 1` boosts
    bass by up to ~3 dB at feed=9.5. If upstream is already at 0 dBFS,
    crossfeed can clip. bs2b does not apply limiting. Upgrade path:
    optional soft-clip post-gain (or just document the headroom cost
    in Brick UI).

## #61 envelopeFollower

(a) RMS mode not from Bram's primary. musicdsp #136 covers peak-only
    (`tmp = |in|`). RMS mode (`meanSq = rel·(meanSq−x²)+x², tmp=√meanSq`)
    was added without primary consult — style-copied from Zölzer DAFX §4.2
    (not opened; gate-to-consult before RMS behavior is relied on in any
    compressor/gate built on this op). Alternative: windowed RMS with
    block buffer (Canon:dynamics §3, already opened for earlier ships).

(b) Giannoulis/Massberg/Reiss 2012 JAES paper — intended primary, not
    openly reachable. Log: if the paper PDF opens later (QMUL mirror
    restoration / arXiv mirror), cross-check the log-domain smoothing
    variant and "branching vs smoothed branching" taxonomy. Current op
    is linear-domain (Bram's form); G/M/R also specify log-domain which
    matches analog-compressor behavior more closely.

(c) Log-domain envelope. Dedicated add-on (not this op's scope): smooth
    `log(|x| + ε)` instead of `|x|`. Better match to dB-linear analog
    compressors (dbx VCAs). Upgrade path: new mode enum value {2 = log}.

(d) Lookahead variant. #48 lookahead (also ⬜) will combine with this op
    for transparent limiting; no work here, just a topology note.

(e) Denormal audit. Release branch `env = rel·(env-0)+0 = rel·env`
    asymptotes to 0 from above. Release coef < 1, so env eventually
    denormalizes. The `tmp > env` attack branch always writes `|x|`
    including 0, which flushes env to exact 0. But in a pure decay
    scenario (input = 0 forever) env drifts through denormal range.
    Watte bias (Canon:utilities §1) not applied — may need audit if
    rack denormal_tail rule fails.

## #125 hiss

(a) Kellett pink coefficients are tuned at 44.1 kHz. Accuracy drifts
    slightly at 48/96/192 kHz. Upgrade path: Lubomir's 2009 ranged
    coefficient tables (same musicdsp #76 rst, posted 2009-03-15) with
    `k_i = exp(-2π·f_i/sr)` and 4 sample-rate brackets (≤48k, ≤96k,
    ≤192k, ≥192k). Requires per-SR coefficient recompute in
    `setSampleRate`. Ship deferred — ~0.05 dB drift is inaudible
    in practice, but fix if we ever re-bless goldens at 96 kHz.

(b) PRNG is not cryptographic. feldkirch's XOR-add counter has short
    cycle length vs Park-Miller / xorshift64. For audio use the FFT
    looks flat (archive comments confirm), but for modulation seeds
    or long-render reproducibility, swap to xorshift64 or PCG.
    Not a ship gate.

(c) `y *= 0.11` pink normalization is empirical, not from Kellett.
    Kellett's sum has unity gain at Nyquist, but pink has much more
    total energy than white (∫1/f vs ∫1). The 0.11 scalar brings pink
    RMS into rough parity with white RMS so users get comparable
    loudness when switching `tint`. Should measure precisely and
    document the exact energy ratio, or replace with a proper
    normalization constant derived from Kellett's transfer function.

(d) No brown (red / −20 dB/dec) noise option. Common request.
    Implementation: pink output → 1-pole LP at low cutoff (~20 Hz).
    Cheap. Add as `tint=2`.

(e) No sample-and-hold noise option. Useful for S&H-style modulation.
    Add as `tint=3` with a secondary rate param.

(f) No stereo-decorrelated noise. Currently single-channel. Stereo
    hiss wants two independent PRNG streams (seeds offset). Add as
    `out2` port or as a stereo mode flag once a source needs it.

---

## #124 crackle — SC Dust/Dust2 algorithm (shipped 2026-04-24)

Primary: `supercollider/server/plugins/NoiseUGens.cpp` Dust_next / Dust2_next
(GPLv3). Algorithm copied (math-by-def for sparse-Bernoulli sampling), code
not copied. PRNG shared with #125 hiss (feldkirch).

(a) PRNG choice. feldkirch XOR-add is good enough for audio but not
    state-of-the-art. Upgrade path: xoshiro128++ or PCG32 — better
    equidistribution, period, and block-correlation behaviour. Worth
    a one-time swap across #124/#125 together if any test flakes.

(b) Poisson vs Bernoulli. SC Dust is strictly Bernoulli at sample rate
    (one draw per sample). For density > sr/2 the hit distribution
    degenerates. True Poisson process would draw inter-arrival times
    from exp(λ) and skip forward — cleaner at high density and allows
    sub-sample accuracy. Upgrade path when Source family gets a
    "scientific" rework.

(c) No density-smoothing. Ramping density from 10 → 10000 Hz over time
    will audibly step at param updates (one threshold change per
    setParam). Upgrade: smooth density via a one-pole (shared with
    #96 smooth op) before recomputing thresh.

(d) No amplitude jitter knob. SC only exposes density; our impulses'
    amplitude is already uniform [0,1) from the inverse-CDF. A user-
    facing "jitter" (truncate the CDF to [a,1)) would expose the
    hidden height distribution for creative use. Parked — not a
    faithfulness concern.

(e) No frequency-weighted modes. Vinyl crackle has more LF energy than
    Dust's flat spectrum predicts. A post-crackle 1-pole LP or Kellett
    pink filter stage would give true "vinyl" feel. Currently user can
    chain crackle → filter; could be folded into tint parameter later.

(f) SC's Dust2 sign is carried by the same z used for magnitude
    (z*scale - 1). This means |hit amplitude| and sign are correlated:
    small-|z| hits are always negative, large-|z| hits always positive.
    Not a bug — this is SC's exact behaviour. Documented here so no one
    "fixes" it later.

---

## #123 sampleHold — SC Latch_next_aa semantics (shipped 2026-04-24)

Primary: `supercollider/server/plugins/TriggerUGens.cpp` Latch_next_aa
(lines 1014-1026, GPLv3). Algorithm copied (rising-edge latch is math-
by-def for S&H), code not copied.

(a) No slew / glide on held value. Real-world S&H (ARP, Buchla 266) can
    slew between samples for "smooth sampleHold" variant. Upgrade path:
    add `slew` param coupling to #52 slew or #53 glide. Currently a
    chain-of-ops job; a `glide` param on the primitive would save a
    node.

(b) No trigger threshold / schmitt. SC uses bare `> 0`. Noisy trigger
    sources can cause false retriggers near zero. Upgrade: optional
    schmitt hysteresis (upper/lower thresholds). Matches #117 trigger
    family; parked until a user hits the glitch.

(c) No "track & hold" mode. When trig > 0 hold-output follows input;
    when trig ≤ 0 holds last value. Common sibling primitive in
    modular (e.g. Serge TKB). Could fold in as a `mode` param.

(d) No latency-free variant for feedback loops. With `trig=in`, the
    output is last-block's latched value of itself — fine as-is. But
    users may want an "instantaneous" variant where rising edge
    immediately updates both level AND output. Current ship matches
    SC (level is updated then copied to out — already instantaneous).
    Documented here to prevent future "fix" attempts.

---

## #58 randomWalk — SC BrownNoise reflective walk (shipped 2026-04-24)

Primary: `supercollider/server/plugins/NoiseUGens.cpp` BrownNoise_next
(lines 285-294, GPLv3). Algorithm copied (math-by-def bounded walk),
code not copied.

(a) PRNG = feldkirch. Same upgrade path as #124/#125 — swap to
    xoshiro128++ or PCG if any block-correlation artefact surfaces.

(b) No control-rate / interpolated variant (SC's LFBrownNoise). That's
    step-and-interpolate between held values at sub-audio rate — a
    separate primitive best slotted at #59 stepSeq (whose spec is
    already a stepped-hold with interpolation). Document cross-ref in
    #59 when it ships.

(c) No seed input. Reset always goes back to fixed SHA-1 IVs, so two
    randomWalk instances in the same graph produce the SAME walk —
    not independently stochastic. Upgrade: optional `seed` param that
    XORs the initial state. Currently users can stagger by adding a
    one-sample #72 z1 or using different downstream transformations.
    Noted for stereo-decorrelation use cases.

(d) No fractional-dimension / Lévy-flight variant. Brownian walk has
    Hausdorff dim 2; heavier-tail distributions (Lévy) produce more
    "jumpy" walks musically useful for unpredictable modulation.
    Upgrade path: optional `tail` param driving a power-law inverse-
    CDF on the increment. Parked — not a SC-parity concern.

(e) Reflection causes a very slight statistical bias toward the
    centre (time near boundary is reduced by bouncing). SC has this
    too; it's the whole point. Document so no one "fixes" it.

(f) Output is marked as `audio` kind but is typically used as a
    control signal (mod source). No separate `control` kind in the
    current port-kind enum. When/if control-rate ports land, revisit.

---

## #59 stepSeq — SC Stepper-counter + value table (shipped 2026-04-24)

Primary: `supercollider/server/plugins/TriggerUGens.cpp` Stepper_next_a0
(lines 1322-1338, GPLv3). Counter-advance algorithm copied; value-table
lookup is math-by-def composition.

(a) Fixed 8 steps (s0..s7 individual params). Hardware-faithful (Moog
    960, Doepfer A-155, Serge Sequencer all ship 8). 16/32-step is a
    graph-level macro: chain two stepSeqs through a Stepper-clocked
    select. Real upgrade path: array params if/when opRegistry grows
    a `type:'array'` param kind. Until then, blocking 16-step dropdown
    use cases.

(b) No CV "skip" / "reset to step N" inputs. SC's full Stepper has
    `reset` and configurable [zmin,zmax] range, plus pre-step `step`.
    These would unlock per-step skip patterns (Buchla 246-style).
    Currently a graph macro; could fold in as `reset` audio input
    later.

(c) No glide / portamento between steps. Slewed step sequencers (ARP
    1623, Buchla 250e) glide between values. Couples to slew via
    chain — could fold a `glide` param onto the primitive directly.

(d) No probability per step. Modern step seqs (Make Noise René,
    Korg SQ-1) expose per-step probability. Out of scope for the
    primitive — composes via #124 crackle gating the trig.

(e) idx-sentinel = -1. Different from SC's "init at zmin, advance on
    first trig" (which would skip step 0). Documented as design pick
    so no one "fixes" it later.

(f) Step values clamped to [-1, 1]. CV applications often want larger
    range (semitones, frequencies). Could expose `range` (linear gain)
    or use a downstream #95 scaleBy. Currently chain-of-ops.

---

## #60 chaos — SC Logistic-map / May 1976 (shipped 2026-04-24)

Primaries:
- `supercollider/server/plugins/NoiseUGens.cpp` Logistic_next_1 / _next_k
  (lines 395-428, GPLv3). Algorithm copied; code not copied.
- May, R. M. (1976) "Simple mathematical models with very complicated
  dynamics", Nature 261, 459-467.

(a) Only the logistic map ships. Other 1-D / N-D chaotic systems are
    musically distinct: Hénon (2-D fold), Lorenz (3-D continuous-time),
    Rössler, Ikeda, Chua. Each is its own primitive — slot here ships
    the simplest. Upgrade path: separate ops or a `system` enum param.
    Memory cross-ref: Canon — Synthesis covers map-based chaos broadly.

(b) Period-doubling windows (r ∈ [3.0, 3.5699]) produce stable cycles
    rather than chaos. Useful musically (oscillators) but not what most
    users want from a "chaos" op. Could split as separate `period_doubler`
    op or document the r→behaviour map in plugin UI tooltip.

(c) `period = round(sr / freq)` vs SC's `(int32)(sr / freq)`. Off-by-one
    drift at unrepresentable freqs is < 1 sample, inaudible. SC truncates;
    we round. Documented so no one "fixes" toward bit-parity later.

(d) No CV-rate `r` modulation. SC's `paramf` is read once per process
    block (audio-rate variant treats it as scalar). Smoothly modulating
    chaos into and out of the period-doubling cascade is musically
    powerful. Upgrade: audio-rate `r` input port. Currently a graph
    macro via setParam at param-update rate.

(e) Sub-audio iteration is held (no interpolation). Hard steps between
    iterations create audible stair-step at low freq. Upgrade: optional
    cubic / linear interpolation between iterations (matches SC LFNoise2
    / LFNoise1 family). Couples to #59 stepSeq glide debt.

(f) Output of unipolar mode does NOT have zero mean (mean ≈ 0.5 for
    chaotic regime). Bipolar mode (default) re-centres via 2y-1; users
    selecting unipolar should chain a #29 dcBlock if they care about DC.
    Documented to prevent accidental DC into reverb feedback paths.

(g) Determinism only across identical y0 + identical r + identical
    block alignment. Reset clears y AND counter; no PRNG involved (the
    map is deterministic by construction). Decorrelation across multiple
    chaos instances requires distinct y0 values.

---

## #69 granularBuffer (2026-04-24) — SC GrainBuf active-grain pool

PRIMARY: SuperCollider `server/plugins/GrainUGens.cpp` (GrainBuf_next_play_active
lines 1070–1115; GrainBuf_next_start_new lines 1119–1185, GPLv3). Algorithm
copied (active-grain pool + per-grain phase advance + Hann window mul +
linear-interp read + retire on counter≤0); code NOT copied. Cross-ref:
Bencina "Implementing Real-Time Granular Synthesis" open chapter
(rossbencina.com/static/code/granular-synthesis/) — same structural shape
restated for self-contained granulators.

Math-by-def primitives: Hann window w[t] = 0.5·(1 − cos(2π·t/(N−1)));
linear-interp fractional read y = (1−α)·b[i] + α·b[i+1] (DAFX §3.5).

Design picks (carved, not math-by-def):

(a) **Self-owned circular buffer.** SC reads from an external host SndBuf;
    sandbox ops are stateless w.r.t. host objects, so we own a 2000 ms
    cap buffer allocated at construction. Upgrade: external buffer-port
    if/when the sandbox grows that kind. `bufMs` param is a label-only
    cap — runtime resize would invalidate the in-flight grain phases.

(b) **Window = Hann only.** SC supports custom windows via host-buffer
    + builtin Hann/Triangle/Sine. Hann is the canonical default (smooth
    bell, low sidelobes). Upgrade: window-enum (Hann / Tukey / Hamming /
    Triangle / rectangular).

(c) **Interp = linear only.** SC offers cubic. Cubic costs ~3× the
    lookup and matters most for extreme stretch/pitch — typical granular
    use (short grains) doesn't justify it. Upgrade: interp-enum (linear
    / cubic / Lagrange-4) per memory/dsp_code_canon_time_interp.md.

(d) **Pool size = 16 grains, fixed.** Bencina recommends ≥ density·grainSec
    for no-clip scheduling. At density=20 Hz × grainMs=50 ms → expected
    1.0 grain active; pool covers up to ~20 short grains (16 cap, hard
    drop above). New triggers when pool is full are silently dropped
    (matches SC "Too many grains!" path, sans the print spam).

(e) **Trigger source = internal Bernoulli at `density` Hz.** Each sample,
    P(trigger) = density / sr. Reuses the feldkirch PRNG (shared seed
    family with #58 randomWalk / #60 chaos / #124 crackle / #125 hiss
    — all start from SHA-1 IVs 0x67452301 + 0xefcdab89). Upgrade:
    external trig-input port (ext rising-edge → spawn) for hosts that
    want clock-locked grains.

(f) **Bug-found-in-test: spawn() must be passed the block-local write
    head.** Original draft read `this._w` — but the process loop holds
    `w` in a local for the inner sample sweep and only flushes back at
    end-of-block. So in block-mode every spawn computed phase from
    stale `this._w = 0` and read the buffer's unwritten region (silence).
    Caught by the "silent-input → silent-output" + density-monotone
    tests in op_granularBuffer.test.js. Fix: spawn(wHead) parametrised.
    C++ jinja patched in lockstep. Recorded here in case anyone reaches
    for "make _w a member, just write through it on each iteration" —
    works in C++ but NOT in JS unless we also drop the local-`w`
    optimisation, and the optimisation matters in the inner loop.

(g) **PRNG cross-grain coupling.** Same _rand() stream drives the
    Bernoulli trigger AND grain-spawn (jitter + detune). Two parallel
    granularBuffer instances with identical seeds produce identical
    grain spawns at identical sample positions — fine for determinism,
    bad for ensemble. Decorrelation requires per-instance seed (debt
    cross-ref with #58 / #60 / #124 / #125; will land as a single
    `seed` param across the noise/chaos family).

(h) **Output normalisation = 1/√16.** Statistical sum-of-independents
    keeps RMS bounded as density rises. Slight under-gain at sparse
    densities, slight over-gain when many uncorrelated grains stack.
    Trade documented; upgrade is a per-sample running-active-count
    normaliser (cheap but argues for headroom that tracks density jumps,
    so ramp it). Not blocking.

(i) **No anti-aliasing on grain reads.** Pitch up by N cents reads the
    buffer at 2^(N/1200)× rate via linear interp — aliasing rises at
    high pitch shifts. SC has the same property. Upgrade: optional
    halfband 2× oversample on the read path for ratios > 1.5 (per
    memory/dsp_code_canon_time_interp.md §7).

(j) **getLatencySamples() = 0.** The user-visible delay knob (`delayMs`,
    0–2000 ms) is *algorithmic spacing* between read and write heads,
    not introduced latency — the host-graph compensation path doesn't
    apply. Same convention as fdnCore's pre-delay.

---

## #106 microDetune (2026-04-24) — Faust transpose, two-tap crossfading delay line

PRIMARY: Faust stdlib `misceffects.lib` `transpose(w, x, s, sig)` function
(MIT). Opened via WebFetch on
https://raw.githubusercontent.com/grame-cncm/faustlibraries/master/misceffects.lib.
Algorithm and exact formula transcribed in worklet header.

Math-by-def primitives: linear-interp fractional read; cents-to-rate
r = 2^(c/1200).

Design picks:

(a) **Cents not semitones.** Faust exposes `s` in semitones; we ship
    cents to match the rest of the family (#28 pitchShift, #69
    granularBuffer detune param). Conversion is identity-equivalent.

(b) **Window cap = 200 ms.** Faust's `maxDelay = 65536` is a sample
    count — at 48 kHz that's 1.36 s, which is overkill for "small
    detune" use. 200 ms cap keeps the buffer at 9600 floats (~38 kB)
    and matches typical chorus-class window sizes. Upgrade row:
    expose maxBufMs as a build-time constant if anyone needs the long
    formant-shift territory (>±500 cents requires bigger window for
    smooth crossfade).

(c) **Crossfade weight = `min(d/X, 1)`.** Verbatim Faust formula. Ramps
    tap1 from 0→1 over the first X samples after wrap; outside that
    range tap1 dominates. Tap2 reads from the previous "lap" (offset
    by W) so the seam is hidden in the xfade region. Asymmetric ramp
    is intentional — it follows the phase counter's wrap geometry.

(d) **Single voice, no anti-aliasing.** Faust transpose is single-tap
    pair; for ratios >2× (i.e. > +1200 cents) the delay-line read
    aliases. Acceptable for ±100 cents detune; honest declination
    for big shifts (use #28 pitchShift instead). Upgrade: optional
    halfband 2× oversample on the read taps.

(e) **Positive-modulo wrap not C-fmod.** Faust's `fmod` follows the
    C standard (sign matches dividend); for negative `i` (cents>0,
    rate>1) the phase counter goes negative and C-fmod returns
    negative results. We use `d - W·floor(d/W)` which always returns
    [0, W). Equivalent for positive `i`; correct for negative.

(f) **Determinism.** No PRNG involved. Two parallel instances at the
    same params produce identical output (in fact, identical to a
    single instance running in series — there's no decorrelation
    needed because there's no random component).

(g) **getLatencySamples() = 0.** Window length is *delay between
    write and read taps*, not introduced latency vs unprocessed
    signal. For cents=0 the output is the input delayed by W samples
    (because tap2 dominates at d=0); but reporting algorithmic
    latency is reserved for cases where the host needs PDC. Same
    convention as #5 mix and #28 pitchShift's pre-FIFO.

(h) **No mix param.** Sandbox convention: dry/wet is composed via
    explicit #5 mix op, not built into character ops. (Plugin-level
    dry/wet rule from MEMORY.md applies to plugins, not ops.)

---

## #179 diodeBridgeGR — shipped 2026-04-26, ✅+P

**Baseline.** Phenomenological diode-bridge gain-reduction cell modeling
Neve 33609 / 2254 / 8014 family. Memoryless. Hill-function gain curve
(β=1.8 default, between varMuTube's 1.5 and fetVVR's 2.0) + PURE-ODD
3H distortion from cubic shape (`x³ · gain · distortion · comprDepth`)
+ optional `asymmetry` knob for component-mismatch even-harmonic content.
**Distinguishing trait vs other Tier-S Cluster A members:** topology
symmetry of 4-diode bridge cancels even harmonics by design — the
classic Neve "warm" 3H character.

**Math-by-definition declared at ship time.** Multiple PRIMARY sources
inaccessible during this ship session 2026-04-26:
- **Neve 2254 service schematic** (archive.org / GroupDIY 404)
- **AMS Neve 33609/N user manual** (ams-neve.com support links 404)
- **Ben Duncan "VCAs Investigated"** — PDF binary-extract failed
- **Sound on Sound 33609JD review** (410 gone)
- **Gearspace 2254-clones thread** (403 forbidden)
- **Wikipedia "Neve 33609"** + **"Neve 2254"** (404 — articles don't exist)
Topology anchored to **Giannoulis-Massberg-Reiss JAES 2012 §Soft Knee**
(Tier-A peer-reviewed, accessed in this session). Diode small-signal
theory `rd = V_t / I_DC` is universal textbook content (Sedra-Smith
Ch.4 — known but not opened verbatim this session). Diode-bridge
symmetry → odd-only harmonics is general analog-electronics knowledge
(matched-pair cancellation, e.g. Sedra-Smith Ch.6 differential
amplifiers). The cubic `y³` shape is one canonical odd-distortion form.

**Critical model adjustment caught + fixed during ship:** initial
implementation used `y³ = (x · gain)³` which produces 3H/1H ratio that
DROPS with compression (cubic scales as A·gain to the third power).
Real diode-bridge behavior: distortion RISES with compression depth.
Fixed by computing cubic on raw INPUT signal then scaling by gain:
`yChar ∝ x³ · gain`. Now 3H/1H ratio depends only on `comprDepth`
(matches real diode-bridge: distortion grows with GR).

**Known-better citations (deferred, P1):**

| # | Upgrade | Citation | Cost | Priority |
|---|---|---|---|---|
| 179-a | Verbatim Neve 2254 service schematic + 33609 user manual | Tier-S OEM. Need verified-authentic PDF copy. | Low — re-tune curve coefficients | **P1** |
| 179-b | Ben Duncan "VCAs Investigated" (Electronics & Music Maker) | Tier-B reverse-engineering survey covering Neve diode-bridge topology. PDF binary-extract failed this session. | Low — verify our model against measured | P1 |
| 179-c | tanh / sinh-based saturation shape (alternative to cubic) | Real diodes saturate via exponential I-V curve, not pure cubic. tanh model produces 3H + 5H + 7H rolloff, more authentic. | Medium — replace `x³` with `tanh(x · k)` | P2 |
| 179-d | Asymmetric diode forward voltages (in addition to current asymmetry) | Real diode bridges have small Vbe spread between matched pairs → contributes to 2H beyond current mismatch. Currently `asymmetry` only models current asymmetry. | Low | P3 |
| 179-e | Attack/release dynamics (~10 ms attack, 100-1500 ms program-dep release) | Memoryless at op level; user wires #smooth + envelope upstream of cv. Could absorb for full Neve-cell composition. | Medium — adds state | P2 (recipe-layer) |
| 179-f | Output transformer coloration (Neve units have UTC-class output xfmrs) | Composes via #139 xformerSat downstream. Not an issue at this op. | None | n/a (composition concern) |

**v1 honest behavior recap:**
- cv ≤ 0 → unity gain
- cv > 0 → soft-knee compression (β=1.8)
- distortion=0, asymmetry=0 → clean (no harmonics)
- distortion>0 → pure 3H content (no 2H, no 4H — diode-bridge symmetry)
- asymmetry>0 → small 2H + 4H added (component-mismatch realism)
- Distortion grows with compression depth (real Neve behavior)
- Memoryless: getLatencySamples()=0; reset is no-op
- Smoke parity bit-identical at default (cv=0 → pure pass-through)

---

## #147 fetVVR — shipped 2026-04-26, ✅+P

**Baseline.** Phenomenological JFET-VVR gain-reduction cell modeling
UREI/UA 1176 family (2N3819 JFET in feedback or shunt-attenuator
topology). Memoryless. Distinguishing trait vs varMuTube: sharper knee
(β=2 default) AND mixed even+odd distortion (independent `distortion2H`
+ `distortion3H` params). "All buttons in" character available by
cranking both distortion params.

**Math-by-definition declared at ship time.** 1176 service manual +
2N3819 datasheet inaccessible during ship session 2026-04-26 (multiple
mirror sites 404). Topology anchored to GMR JAES 2012 §Soft Knee
(Tier-A, accessed this session). FET ohmic-region equation captured
from Wikipedia JFET article (Tier-A textbook): `I_D ≈ (2 I_DSS / V_P²) ·
(V_GS - V_P) · V_DS` for small V_DS, → Rds(V_GS) curve diverging at
pinch-off. Distortion model — split into `distortion2H · |y|` (even
2H+4H from FET asymmetric channel conduction) + `distortion3H · y · |y|`
(odd 3H+5H from pinch-off non-linearity) — is phenomenological and
calibrated to 1176 reputation for "trademark overdriven tone." No
peer-reviewed paper specifies precise coefficient values that I could
verify in this session.

**Known-better citations (deferred, P1):**

| # | Upgrade | Citation | Cost | Priority |
|---|---|---|---|---|
| 147-a | UREI/UA 1176LN service manual — exact FET topology, gain curve, "all buttons in" mode component values | Tier-S OEM document. archive.org PDF mirrors 404 in this session; would need verified-authentic copy. | Low — re-tune curve params + distortion coefficients | **P1** |
| 147-b | 2N3819 datasheet Vp / I_DSS values for accurate Rds(V_GS) curve | Tier-S manufacturer doc. Frank Pocnet 404'd. | Low | **P1** |
| 147-c | Measured 1176 distortion-vs-GR curve from real units | Bench measurements published in: Cliff Maag's Mercury MK7-1176 measurement reports, Mike Senior's Sound on Sound 1176 reviews, etc. | Low — curve-shape correction | P2 |
| 147-d | "All buttons in" mode authentic curve | At extreme settings the 1176's compression curve becomes "severe plateau" per Wikipedia. Currently modeled as continuous Hill function — doesn't capture the plateau onset. | Medium — piecewise gain curve | P2 |
| 147-e | Attack/release dynamics (20 µs–800 µs / 50 ms–1100 ms program-dep) | Op is memoryless; user wires #smooth or envelope follower upstream of cv input for dynamics. Could absorb into op for full 1176-cell composition. | Medium — adds state | P2 (recipe-layer concern) |
| 147-f | Tube-stage saturation at large signals (separate from FET compression) | At very large signal swings, the op-amp + transformer output saturates. | Low | P3 |
| 147-g | Asymmetric distortion (positive vs negative half-cycle differs slightly) | Real FET conduction is somewhat polarity-dependent. Currently `bias·|y|` term is symmetric. | Low | P3 |

**v1 honest behavior recap:**
- cv ≤ 0 → unity gain (no compression)
- cv > 0 → soft-knee compression via `1/(1 + (cv/cutoffScale)^β)`
- Sharper knee than varMuTube (β=2 default vs 1.5)
- Independent 2H/3H distortion control via `distortion2H` (even) + `distortion3H` (odd)
- "All buttons in" character: distortion2H=0.3-0.4, distortion3H=0.2-0.4 (cranked)
- Note: y·|y| odd-harmonic term scales as A² of signal amplitude, so 3H is
  intrinsically smaller than 2H at small signals or heavy compression
- Memoryless: getLatencySamples()=0; reset is no-op
- Smoke parity bit-identical at default (cv=0 → pure pass-through)

---

## #145 varMuTube — shipped 2026-04-26, ✅+P

**Baseline.** Phenomenological variable-mu tube gain-reduction cell
modeling Manley Variable Mu / Fairchild 670 / Altec 436 family.
Memoryless. Soft-knee Hill-function gain curve `1/(1 + (cv/V0)^β)`
+ even-symmetric distortion (DC + 2H + 4H) that scales with
compression depth — the canonical vari-mu "more GR = more 2H"
character signature.

**Math-by-definition declared at ship time.** Multiple PRIMARY sources
were inaccessible during this ship session 2026-04-26:
- **6386 / 6BC8 dual-triode datasheets** (Frank Pocnet PDFs all 404)
- **Pakarinen-Yeh CMJ 2009 §III variable-mu treatment** (Aalto +
  Semantic Scholar + MIT Press paywalled / 404)
- **Manley Vari-Mu / Fairchild 670 service docs** (proprietary,
  not in public access)
- **Norman Koren site** (403 forbidden via WebFetch — bot detection)
Topology anchored to **Giannoulis-Massberg-Reiss JAES 2012 §Soft Knee**
(Tier-A peer-reviewed, accessed in this session). Distortion-couples-
with-compression-depth principle is general tube-physics folklore
(Langford-Smith *Radiotron Designer's Handbook* 4e Ch.13; RCA Tube
Manual RC-30) but no peer-reviewed paper specifies coefficient values
for the Manley/670 specifically that I could verify in this session.

**Known-better citations (deferred, P1):**

| # | Upgrade | Citation | Cost | Priority |
|---|---|---|---|---|
| 145-a | Verbatim-citable 6386/6BC8 datasheet Gm vs Vgk curve data | GE/Sylvania 6386 datasheet original — currently scattered across hobbyist sites with broken links. Need locally-archived PDF to extract specific Gm values. | Low — re-tune curve params once data in hand | **P1** |
| 145-b | Pakarinen-Yeh CMJ 2009 §III variable-mu DSP treatment | doi:10.1162/comj.2009.33.2.85 — paywalled; need institutional access OR author preprint at Aalto | Low — verify our model matches their treatment, tune as needed | **P1** |
| 145-c | Macak's Brno PhD thesis variable-mu section (referenced 2026-04-26 but full PDF not located) | Brno UT digital library; needs library check | Low | P2 |
| 145-d | Manley Variable Mu / Fairchild 670 service-manual gain curves | Vintage proprietary docs, sometimes available via vintage-audio forums or US Patent search | Medium — service-manual reverse-engineering | P2 |
| 145-e | Asymmetric distortion (positive vs negative half-cycle differs) | Real tube class-A asymmetry. Currently model is symmetric `bias·\|y\|`. Add small `bias_half · y · sign(y)` term for class-A character. | Low | P3 |
| 145-f | Smooth attack/release dynamics inherent to tube thermal effects | Real vari-mu cells have small thermal time constants (~50ms) on top of fast electrical response. Currently fully memoryless. | Medium — adds state | P3 |
| 145-g | Tube-stage saturation at large signals (separate from compression) | At very large signal swings, tube output stage saturates regardless of bias. Currently no saturation modeled — peak bound only by `(1 + dist · comprDepth) · gain`. | Low — add tanh wrapper | P2 |

**v1 honest behavior recap:**
- cv ≤ 0 → gain = 1 (no compression, vari-mu only triggers on positive cv)
- cv > 0 → soft-knee compression via `1 / (1 + (cv/cutoffScale)^β)`
- cv = cutoffScale → −6 dB GR
- cv → ∞ → gain → 0 (tube cutoff)
- Distortion couples with comprDepth: `2H/1H ratio = distortion·comprDepth·(4/3π)` (verified by test)
- Even-symmetric distortion (DC + 2H + 4H) — same Fourier signature as blackmerVCA's bias term
- Memoryless: getLatencySamples() = 0; reset is no-op
- Smoke parity bit-identical at default (cv=0 → pure pass-through)

---

## #142 blackmerVCA — shipped 2026-04-26, ✅+P

**Baseline.** Log-add-antilog VCA gain cell modeling Blackmer (dbx /
THAT 2180) topology per US Patent 3,714,462. Memoryless. cv input
interpreted as gain in dB (cv=0 → unity); `bias` param adds class-AB
even-order distortion (DC + 2H + 4H) modeling Vbe-mismatch between
Q3/Q4 antilog pair. Default bias=0 → ideal linear multiplier; ±0.025
≈ patent matching tolerance (1 mV / 40 µA → ~−40 dB 2H character).

**Math-by-definition declared at ship time.** Patent specifies topology
(log-add-antilog, 4-transistor PNP/NPN class-AB) and ±50 dB range with
"very low distortion" — but does NOT specify the precise harmonic
distortion vs signal level curve shape. The `bias · |y|` even-order
generator is a phenomenological model anchored to the patent's matching
tolerance. Logged as research-debt P2 below.

**Known-better citations (deferred):**

| # | Upgrade | Citation | Cost | Priority |
|---|---|---|---|---|
| 142-a | Measured 2H-vs-signal-level curve from real Blackmer cells | Bench measurements on dbx 162SL / THAT 2180 ICs across input level + control voltage. None located in public literature 2026-04-26. | Low — shape correction in `bias·|y|` only | P2 |
| 142-b | Control feedthrough modeling (cv leaks ~−80 dB into audio path via parasitic capacitance) | THAT 2180/2181 datasheet specifies typical CV feedthrough of −80 dBV at 1 kHz; not currently modeled. Op produces clean cv-to-output decoupling. | Low — additive cv·tiny_factor term | P3 |
| 142-c | Control bandwidth limit (real VCAs ~10 kHz cv bandwidth via parasitic R/C) | Real chips can't track audio-rate cv perfectly; produces low-pass-filtered control. User can wire `#smooth` upstream of cv if needed. | None at op level — sandbox composition | P3 (recipe-layer) |
| 142-d | Self-noise floor (~−95 dBu typical for THAT 2180) | Manufacturer-published noise spec. Not modeled. User wires `#noise` for that if needed. | None at op level — sandbox composition | P3 (recipe-layer) |
| 142-e | DC offset blocking | `bias > 0` produces audible DC offset (control-feedthrough proxy). Recipes that need clean output should wire `#17 dcBlock` after this op. | None at op level — documented composition pattern | n/a (recipe rule) |

**v1 honest behavior recap:**
- cv = 0 (or missing) → output = audio · trim_linear (pure pass-through)
- cv > 0 → audio scaled up by 10^(cv/20) (dB convention)
- cv < 0 → audio scaled down by 10^(cv/20)
- bias = 0 → ideal linear multiplier (no distortion)
- bias > 0 → DC offset (bias · A · 2/π) + 2H (bias · A · 4/(3π)) + 4H + ...
- Memoryless: getLatencySamples() = 0; reset is no-op
- Half-wave rectification of `|y_clean|` is ALL the distortion source

---

## #141 optoCell — shipped 2026-04-26, ✅+P

**Baseline.** Phenomenological LA-2A T4-style optical-isolator gain-
reduction cell. Two-state envelope (envFast asymmetric attack/release
+ envSlow symmetric one-pole following envFast); effective env =
max(envFast, envSlow); gain mapping `1 / (1 + responsivity · env²)`
(LDR resistance ~ 1/intensity² approximation). Parameter values
calibrated to Universal Audio's published T4 numbers (10 ms attack,
60 ms initial release, 1–15 s program-dependent slow release).

**Math-by-definition declared at ship time.** No peer-reviewed paper
specifically models the LA-2A T4 thermal coupling in DSP terms.
Searched DAFx archive, Faust libs, Eichas-Möller-Zölzer family, JAES
E-Library 2026-04-26 — no match. Topology anchored to Giannoulis-
Massberg-Reiss JAES 2012 (Tier-A); parameter values anchored to UA's
published T4 numbers (Tier-B vendor blog). The two-state envelope
phenomenology is canonical opto-cell folklore (textbook lineage:
Zölzer DAFX 2e Ch.4, Reiss-McPherson "Audio Effects") but no single
peer-reviewed origin.

**Known-better citations (deferred):**

| # | Upgrade | Citation | Cost | Priority |
|---|---|---|---|---|
| 141-a | Validated T4 thermal-coupling DSP model | Future DAFx contribution OR a peer-reviewed paper specifically measuring + modeling T4 thermal accumulation/release as a function of signal history. None located 2026-04-26. | High — full re-implementation if model differs structurally | **P1** |
| 141-b | Tunable LDR exponent (currently fixed at p=2) | CdS photoresistor datasheets typically show p ∈ [1.5, 2.5] depending on cell type. Could become a per-preset constant or user param. | Low — single param + recompute | P2 |
| 141-c | Asymmetric slow-envelope (warm-up vs cool-down rates) | Real EL panels have slightly different thermal time constants on warm-up vs cool-down (cool-down is typically longer). Currently slow envelope is symmetric. | Low — split α_slow into α_slowAttack / α_slowRelease | P2 |
| 141-d | Felt 2010 (LDR thermal model) if obtainable | Referenced in some opto-compressor literature; not located in public access 2026-04-26. | Unknown — check AES E-Library | P3 |

**v1 honest behavior recap:**
- cv = 0 → gain = 1 (identity, no compression)
- cv > 0 → cell engages with 10 ms attack, 60 ms initial release
- Sustained pinning (≥ 5 sec at default releaseSecSlow) → recovery
  slows to ~5 sec scale per UA T4 spec
- Brief peaks (< 100 ms) → fast recovery via envFast path
- Half-wave rectification on input (cell only triggers on positive cv)
- Output is a multiplier ∈ (0, 1] — compose with audio path via
  external multiplication or #5 mix

---

## #166 srcResampler — shipped 2026-04-26, ✅+P

**Baseline.** Polyphase Kaiser-windowed-sinc varispeed reader per JOS
*Digital Audio Resampling / Implementation* page (NZ=8 zero-crossings,
L=32 phases, β=7 → 70 dB stopband, KBUF=4096 ring). Same N inputs / N
outputs per `process()` call; `speed` param controls per-sample read-
pointer advance into a circular history.

**Known-better citations (deferred):**

| # | Upgrade | Citation | Cost | Priority |
|---|---|---|---|---|
| 166-a | Elastic input/output buffering for sustained speed > 1 | libsamplerate (BSD-2-Clause post-2016) elastic buffering pattern; or Smith-Gossett ICASSP 1984 §III rate-changing pull-style API | High — breaks per-call N-in/N-out contract; needs engine-layer plumbing or a separate `kind: 'rate-changing'` op-class | P2 |
| 166-b | Cutoff scaling for downsample anti-alias (ρ < 1) | JOS *Theory_Ideal_Bandlimited_Interpolation*: `hs(t) = ρ · sinc(ρ·t)` at speed > 1. Practical implementations: libsamplerate cutoff scaling per ratio | Medium — kernel construction parameterized by ρ at `setParam('speed')` time; or a second precomputed table for ρ-scaled kernel | P1 |
| 166-c | Higher-quality preset (libsamplerate "best") | NZ=23 / L=1024 → ≥130 dB stopband at significantly higher CPU cost. JOS resample example explicitly cites NZ=13/L=512 as "good quality." | Low — recompile-time constants, larger table | P2 |
| 166-d | Multichannel with shared kernel | Currently single-channel. For stereo/multichannel, share the precomputed kernel + run independent xbuf/wpos/phase per channel. | Low — straightforward extension | P2 |

**Why deferred for v1.** Op contract in sandbox is N inputs → N outputs
in lockstep. Elastic buffering (166-a) breaks that contract and needs
either a dedicated rate-changing op-class or engine-layer plumbing.
Cutoff scaling (166-b) is a real fidelity gap at sustained speed > 1
but doesn't help speed=1 (the dominant use case as a fixed delay-line
read for fractional pitch / wow / flutter).

**v1 honest behavior recap:**
- speed = 1: pure NZ-sample filter delay; native parity bit-identical.
- speed < 1: clean varispeed read for ~ (KBUF − 2·NZ) output samples
  before phase clamps to ceiling. At KBUF = 4096 → ~85 ms at 48 kHz.
- speed > 1: phase clamps to NZ minimum within ~NZ output samples;
  beyond that the op behaves as speed=1. Causality limit (no lookahead).
- Anti-alias above unity not applied; relies on natural HF rolloff of
  the 17-tap kernel (Kaiser β=7 sidelobes ≈ −70 dB).
