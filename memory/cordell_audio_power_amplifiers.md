# Cordell — Designing Audio Power Amplifiers (book)

**Tier:** TIER-S PRIMARY (locked 2026-04-27)
**Local copy:** `C:\Users\HEAT2\Desktop\AI Audio dataset\Designing_Audio_Pwr_Amps_Cordell.pdf`
**Author:** Bob Cordell — career engineer at Bell Labs, contributor to Audio
Amateur / audioXpress, originator of the Cordell Distortion Magnifier and
several class-D / lateral-MOSFET designs.
**Publisher:** McGraw-Hill (2010, 1st ed.)

## Why this is locked authority

Cordell is the modern gold-standard reference for **discrete audio amplifier
design** — every topology, every distortion mechanism, every measurement
technique covered with bench-validated numbers. Pairs naturally with our
existing Tier-S sources:

- **Stinchcombe** (filters / Korg-35 / Moog ladder) → covers SK / OTA / ladder
- **Whitlock** (transformers — Ballou Handbook ch.) → covers magnetics
- **De Paiva 2011** (transformer DSP emulation) → covers WDF transformer
- **Cordell** (this book) → covers everything BETWEEN those — voltage gain,
  output stage, biasing, feedback, power supply, distortion mechanisms

Together these four cover ~90% of the analog signal path from input jack
to speaker terminal at primary-source rigor.

## Topology / topic coverage

Skim of the table of contents:

- **Ch 1–3** Power amp basics — class A/B/AB/D/G/H, output stage topologies
- **Ch 4** BJT and MOSFET output stages — push-pull, EF, CFP, Sziklai
- **Ch 5** Distortion mechanisms — crossover, thermal, beta nonlinearity,
  capacitor distortion, transformer distortion
- **Ch 6** Negative feedback — loop gain, phase margin, slew rate
- **Ch 7** Compensation — Miller, two-pole, dominant-pole, cherry's nested
- **Ch 8** Voltage amplifier stages (VAS) — single-ended, cascode, Hawksford
- **Ch 9** Differential pairs and current mirrors
- **Ch 10–11** Bias circuits — Vbe multiplier, thermal compensation
- **Ch 12** Power supply — rectifier sag, ripple, regulation
- **Ch 13** Protection — current limit, SOA, fuses, DC offset
- **Ch 14** Class D — switching topologies, output filters
- **Ch 15+** Bench measurements — THD, IMD, slew, square-wave, distortion
  magnification, FFT-based analysis

## Which ops in our catalog this book backs

**Already shipped (primary-source backing / cross-reference):**
- (Many character ops — provides depth on what's happening inside.)

**Queued ⬜ slots — Cordell is direct primary source:**

| Slot | Op | Cordell coverage |
|------|----|------------------|
| #143 | bjtSingleStage | Ch 4 (BJT output stage), Ch 8 (BJT VAS), Ch 9 (differential pair) |
| #146 | discreteClassAStage | Ch 1 (class A overview) + Ch 8 (single-ended VAS) |
| #148 | triodeStage | (Less direct — book is solid-state focused; Cordell does briefly compare to tube preamps, e.g. soft-clip behavior) |
| #154 | psuRectifierSag | Ch 12 (power supply, rectifier behavior, sag under load) |
| #155 | pushPullPower | Ch 4 (push-pull output stages — class A, B, AB biasing) |
| #156 | phaseInverter | Ch 9 (paraphase / long-tail-pair / cathodyne phase splitter — secondary cross-ref to Pakarinen-Yeh CMJ 2009) |
| #157 | cathodeBiasShift | Ch 10 (Vbe multiplier biasing — analogous DSP target for cathode bias dynamics) |
| #184 | bootstrapLF | Ch 4, Ch 8 — Cordell uses bootstrapping in VAS and output stages; pairs with Elliott article for the textbook treatment |
| #185 | samplerNonlinearity | Less direct — Cordell focuses on analog amp distortion, not ADC sampling. Razavi 2021 stays primary for #185. |

**Future op candidates the book directly motivates (not yet in catalog):**

- **`crossoverDistortion`** — Cordell Ch 5: the canonical class-AB crossover
  glitch when both output devices momentarily conduct. Audible "buzz" on
  zero-crossings at low listening levels. DSP model: a small dead-zone
  nonlinearity around zero crossing, parameterized by `bias_amount`.
- **`miller_compensation`** (or `domPoleAmp`) — Ch 6/7: dominant-pole
  amplifier behavior with negative feedback. The canonical "amp roll-off
  + linearization" character. Models a TPC (two-pole compensation) or
  Miller-compensated amp's slew-rate-limited large-signal behavior.
- **`outputStageProtection`** — Ch 13: SOA limiting, V-I current foldback.
  Hard-knee dynamic threshold with hysteresis. (Niche, but exists in some
  vintage tube amps as audible "roll-off when cooked" character.)
- **`thermalDistortion`** — Ch 5: temperature-coefficient-driven gain
  variation in BJT stages over a sustained note. Slow-drift nonlinearity.
- **`hawksfordVAS`** — Ch 8: Malcolm Hawksford's nested feedback VAS topology
  with very low THD. A "hi-fi clean" character target.

## Status

- PDF available locally at user's `Desktop\AI Audio dataset\` collection.
- **Not yet copied** into `docs/primary_sources/` — leave the user's local
  copy as the canonical source for now, noted here.
- Citations from this book should reference chapter numbers in the catalog
  rows (e.g. "Cordell Ch 4 §4.3 push-pull EF").

## How to cite in catalog rows

Format:
> **Cordell, *Designing Audio Power Amplifiers* (McGraw-Hill 2010), Ch X §X.X**

For multi-source rows:
> **Primary:** Cordell Ch 5 §5.4 (crossover distortion mechanism). **Pair with:**
> Self, *Audio Power Amplifier Design Handbook* (where applicable for cross-check).

## Anti-patterns (when NOT to use Cordell as primary)

- **Tube amp character** — Cordell is solid-state focused; for tube
  topologies use Pakarinen-Yeh CMJ 2009, Macak thesis, or RCA RC-30 manual.
- **Transformer DSP** — De Paiva 2011 is the implementation primary;
  Whitlock is the physics primary; Cordell has limited coverage of magnetics.
- **Filter design** — Cordell isn't a filter book. Use Stinchcombe / Tarr.

## Related memory files

- `whitlock_audio_transformers.md` — magnetics physics
- `depaiva_transformer_emulation.md` — transformer WDF
- `stinchcombe_korg_moog_filter_studies.md` — filter circuit studies
- `dafx_zolzer_textbook.md` — DSP-side effects reference
- `dsp_code_canon_character.md` — canonical tanh/saturation/etc snippets
