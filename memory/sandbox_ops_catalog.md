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
**30 of ~130 ops shipped (~23%).** BS.1770-5 metering triad complete (kWeighting · loudnessGate · truePeak). Hit 30-op milestone. MVP six (gain · filter · envelope · delay ·
mix · saturate) complete. Feedback-safety triad (dcBlock · softLimit · denormal
flush) complete. Tone-shaping primitive set (filter + shelf + onePole) complete.
Character primitives: saturate · softLimit · bitcrush.

## Family index
| family | slots |
|---|---|
| Core I/O            | 1, 6 |
| Filters             | 2, 32–39 |
| Dynamics            | 3–5, 40–50 |
| Control primitives  | 7–9, 29–31, 89–102 |
| Noise               | 10, 123–125 |
| Movement / Modulation | 11, 58–62 |
| Character / Saturation | 12–14, 88, 111–117 |
| Delay / Time        | 15, 27–28, 48, 68–69 |
| Space               | 16–21, 103–110, 118 |
| Routing             | 22–26, 39, 127–130 |
| Synth generators    | 41, 79–87 |
| Analysis / Spectral | 57, 63–75 |
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
| 34 | ladder (Moog)                    | ⬜ | Canon:filters §2–4 |
| 35 | formant                          | ⬜ | Canon:filters §12 |
| 36 | comb                             | ⬜ | |
| 37 | shelf (low/high parametric)      | ✅ | Canon:filters §9 (RBJ shelving) |
| 38 | tilt                             | ⬜ | |
| 39 | lrXover (Linkwitz-Riley)         | ⬜ | Canon:filters §8 (also Routing) |

### Dynamics (#3–#5, #40–#50)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 3  | detector (peak/abs)   | ✅ | |
| 4  | envelope (AR)         | ✅ | Canon:dynamics §1 (Bram) |
| 5  | gainComputer          | ✅ | Zölzer DAFX §4.2.2 (soft-knee) |
| 40 | adsr                  | ⬜ | Canon:dynamics §5 |
| 41 | gate                  | ⬜ | Canon:dynamics §4 |
| 42 | expander              | ⬜ | Canon:dynamics §3 |
| 43 | transient             | ⬜ | |
| 44 | sidechainHPF          | ⬜ | |
| 45 | lookahead             | ⬜ | |
| 46 | meters (VU/peak)      | ⬜ | |
| 47–50 | _reserved_        | ⬜ | |

### Control primitives (#7–#9, #29–#31, #89–#102)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 7  | curve    | ✅ | sandbox_modulation_roadmap.md §3 (cubic Hermite) |
| 8  | smooth   | ✅ | 1-pole τ-smoother |
| 9  | combine  | ✅ | mul/add/max/min/weighted |
| 29 | scaleBy  | ✅ | linear multiplier; k=1 bypass, k=0 mute, k=-1 polarity flip |
| 30 | polarity | ⬜ | |
| 31 | constant | ⬜ | |
| 89 | abs      | ⬜ | |
| 90 | clamp    | ✅ | min/max saturator; control-safety primitive |
| 91 | sign     | ✅ | three-valued sign(x) ∈ {-1,0,+1}; NaN→0 (was generic `math` placeholder, reassigned) |
| 92 | fanOut   | ⬜ | |
| 93 | z1       | ⬜ | 1-sample delay (control) |
| 94 | uniBi    | ⬜ | uni↔bipolar remap |
| 95 | slew     | ⬜ | |
| 96 | trigger  | ⬜ | |
| 97 | ramp     | ⬜ | |
| 98 | quantizer | ⬜ | |
| 99 | glide    | ⬜ | |
| 100–102 | _reserved_ | ⬜ | |

### Noise (#10, #123–#125)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 10  | noise (white/pink/brown) | ✅ | Canon:synth §8 (Trammell) + §10 (LCG) |
| 123 | sampleHold               | ⬜ | |
| 124 | crackle                  | ⬜ | |
| 125 | hiss                     | ⬜ | |

### Movement / Modulation (#11, #58–#62)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 11 | lfo              | ✅ | Canon:synth §6 (coupled sin/cos) + phase-sync shapes |
| 58 | randomWalk       | ⬜ | |
| 59 | stepSeq          | ⬜ | |
| 60 | chaos            | ⬜ | |
| 61 | envelopeFollower | ⬜ | (distinct from #4 envelope) |
| 62 | _reserved_       | ⬜ | |

### Character / Saturation (#12–#14, #88, #111–#117)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 12  | oversample2x    | ⬜ | Canon:time_interp §7 (de Soras halfband) |
| 13  | saturate        | ✅ | Canon:character §11 (Padé, drive+trim) |
| 14  | bitcrush        | ✅ | Canon:character §8 (primitive core; dither/NS are #114/#115) |
| 17  | dcBlock         | ✅ | 1-pole HP, FB-safety · ship_blockers.md |
| 88  | softLimit       | ✅ | Canon:character §11 (Padé, threshold-scaled) |
| 111 | transformer sim | ⬜ | |
| 112 | tape sim        | ⬜ | Canon:character §1 (gloubi-boulga) |
| 113 | tube sim        | ⬜ | |
| 114 | noiseShaper     | ⬜ | Canon:character §8-9 |
| 115 | dither          | ⬜ | Canon:utilities §3 |
| 116 | Chamberlin zero-cross | ⬜ | chamberlin_microprocessors.md |
| 117 | FP-DAC ripple   | ⬜ | ValhallaVintageVerb fingerprint |

### Delay / Time (#15, #27–#28, #48, #68–#69)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 15 | delay (unified, Hermite-4) | ✅ | Canon:time_interp §1 |
| 27 | bbdDelay      | ⬜ | bbd_holters_parker_model.md |
| 28 | pitchShift    | ⬜ | Canon:time_interp §6 (smbPitchShift) |
| 48 | lookahead     | ⬜ | (duplicate of Dynamics #45; unified entry) |
| 68 | phaseVocoder  | ⬜ | Zölzer DAFX §8 |
| 69 | granularBuffer | ⬜ | |

### Space (#16–#21, #103–#110, #118)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 16 | allpass    | ✅ | Canon:filters / DAFX §5.2 — 1st-order allpass, unity magnitude, phase-shifting building block |
| 18 | _reserved_ | ⬜ | |
| 19 | diffuser   | ⬜ | JOS PASP |
| 20 | fdnCore    | ⬜ | Geraint Luff FDN (reverb_engine_architecture.md) |
| 21 | ER (early reflections) | ⬜ | |
| 103 | panner     | ⬜ | |
| 104 | autopan    | ⬜ | |
| 105 | haas       | ⬜ | |
| 106 | microDetune | ⬜ | |
| 107 | Schroeder chain | ⬜ | |
| 108 | plate      | ⬜ | |
| 109 | spring     | ⬜ | |
| 110 | SDN        | ⬜ | JOS PASP deep §SDN |
| 118 | crossfeed  | ⬜ | |

### Routing (#22–#26, #39, #127–#130)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 22 | msEncode   | ⬜ | |
| 23 | msDecode   | ⬜ | |
| 24 | select     | ⬜ | |
| 25 | crossfade  | ⬜ | |
| 26 | busSum     | ⬜ | |
| 127 | splitter  | ⬜ | |
| 128 | merge     | ⬜ | |
| 129 | multiplex | ⬜ | |
| 130 | _reserved_ | ⬜ | |

### Synth generators (#41, #79–#87)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 41 | adsr (synth)         | ⬜ | (see Dynamics #40) |
| 79 | sineOsc              | ⬜ | Canon:synth §6 |
| 80 | wavetable            | ⬜ | Canon:synth |
| 81 | blit                 | ⬜ | Canon:synth §2 |
| 82 | minBLEP              | ⬜ | Canon:synth §13 |
| 83 | fm                   | ⬜ | |
| 84 | padSynth             | ⬜ | Canon:synth §1 |
| 85 | karplusStrong        | ⬜ | JOS PASP |
| 86 | waveguide            | ⬜ | JOS PASP deep |
| 87 | scatteringJunction   | ⬜ | JOS PASP deep §scattering |

### Analysis / Spectral (#57, #63–#75)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 57 | spectrum             | ⬜ | |
| 63 | convolution          | ⬜ | |
| 64 | fft                  | ⬜ | Canon:analysis §5 (QFT) |
| 65 | ifft                 | ⬜ | |
| 66 | stft                 | ⬜ | |
| 67 | istft                | ⬜ | |
| 70 | goertzel             | ⬜ | Canon:analysis §1 |
| 71 | lpc                  | ⬜ | Canon:analysis §2 |
| 72 | warpedLPC            | ⬜ | Canon:analysis §2 |
| 73 | chromagram           | ⬜ | |
| 74 | onset                | ⬜ | |
| 75 | bpm                  | ⬜ | Canon:dynamics §4 (beat detector) |

### Pitch detection (#76–#78)
| # | opId | status | research / notes |
|---|------|--------|------------------|
| 76 | yin   | ⬜ | Canon:pitch §1 (de Cheveigné 2002) |
| 77 | pyin  | ⬜ | Canon:pitch §2 (Mauch 2014) |
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
| 55 | ebuMode         | ⬜ | Canon:loudness §3 |
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
1. **#89 abs** — |x|; pairs with sign to reconstruct/split odd-symmetric signals
2. **#57 stereoWidth** — M/S decomposition width meter; extends correlation story
3. **lra** — EBU Tech 3342 Loudness Range; reuses loudnessGate's abs-passing pool + 10/95-percentile stats

## Notes on reconstruction
- Slot #17 (dcBlock) is outside the Space/Filters family ranges shown in the
  original family table; assigned here because dcBlock is ship-critical but
  doesn't neatly fit "generic onePole" at #32.
- Slots `#18`, `#47–#50` surplus, `#62`, `#100–#102`, `#126`, `#130` left
  as _reserved_ — can be reassigned when the need arises.
- Duplicate listings (adsr in both Dynamics & Synth, lookahead in both
  Dynamics & Time, crepe in both Pitch & ML): same op, one slot, cross-ref.
- When adding a new op: update registry + ship tri-file + **update this file's
  status column** before closing the task.
