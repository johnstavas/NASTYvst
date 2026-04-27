# Mullard — Circuits for Audio Amplifiers (1963)

**Tier:** TIER-S PRIMARY (locked 2026-04-27)
**Local copy:** `C:\Users\HEAT2\Desktop\AI Audio dataset\Circuits-For-Audio-Amplifiers-Mullard-1963 .pdf`
**Open mirror:** worldradiohistory.com/BOOKSHELF-ARH/Circuits-For-Audio-Amplifiers-Mullard-1963.pdf
**Publisher:** Mullard Limited (UK), TP413
**First ed:** April 1959 · **Second ed:** August 1960 · **This reprint:** October 1963

## Why this is locked authority

Mullard was the British valve manufacturer (a Philips subsidiary) — their
applications-engineering guides defined the canonical circuits for an
entire era of British tube hi-fi and studio gear:

- **Mullard 5-10** (10 W EL84 push-pull) → countless British integrated amps
- **Mullard 5-20** (20 W EL34 push-pull, cross-coupled NFB) → studio
  monitors, broadcast amps, classic British home hi-fi
- **Williamson** topology references → Quad, Leak, Radford, Lowther
- **EF86 + ECC83 (12AX7) preamp** → mic / phono / tape input stages

These circuits are what shaped the British tube sound. When someone says
"a 5-20-style power section" or "an EF86 mic pre," they mean exactly the
component values, biasing, and feedback topology pinned in this book.

## Pairs with the other Tier-S amp authority

Cordell book (modern SS) + Mullard 1963 (classic valve) = full coverage of
the analog amp lineage. Use Cordell for solid-state ops; use Mullard for
valve ops.

| Domain | Tier-S source |
|---|---|
| Modern solid-state amps | **Cordell** *Designing Audio Power Amplifiers* (2010) |
| Classic vacuum-tube amps | **Mullard 1963** *Circuits for Audio Amplifiers* (this) |
| Filter circuits | **Stinchcombe** Korg-35 / MS-20 / Moog ladder studies |
| Audio transformers (physics) | **Whitlock** (Ballou Handbook ch.) |
| Audio transformers (DSP) | **De Paiva 2011** WDF emulation |
| Tube physics (deeper) | Pakarinen-Yeh CMJ 2009 (when accessible) |

## Coverage / topic map

Typical Mullard applications-guide structure (TP413):

- **Valve characteristics** — EF86 (low-noise pentode preamp), ECC83/12AX7
  (high-mu twin triode), ECC82/12AU7, ECC81/12AT7, EL84 (output pentode,
  ~10 W), EL34 (output pentode, ~20–30 W per pair), GZ34 (rectifier)
- **Preamplifier circuits** — magnetic gramophone (RIAA EQ), ceramic, tape,
  microphone, line-level. Each with full schematics + component values +
  measured response/distortion.
- **Tone controls** — Baxandall passive + active variants
- **NFB topologies** — global feedback from secondary, local cathode FB,
  ultra-linear (UL) screen tap, cross-coupled (Mullard 5-20)
- **Power-amp circuits** — Mullard 3-3 (3 W EL84 SE), Mullard 5-10
  (EL84 PP), Mullard 5-20 (EL34 PP UL)
- **Phase splitters** — cathodyne (concertina), paraphase, long-tail-pair
  (LTP / "differential" phase inverter — most common in these designs)
- **Output transformer specs** — primary impedance, secondary taps,
  bandwidth, primary inductance per topology
- **Cathode bias** — auto-bias resistor sizing, bypass cap selection,
  fixed-bias circuits with grid-leak resistors
- **Power supply** — full-wave rectifier with GZ34, ripple filtering,
  decoupling for sensitive stages
- **Stereo conversion** — adapting mono designs to L/R pairs

## Which ops in our catalog this book backs

**Direct primary source for queued ⬜ slots:**

| Slot | Op | Mullard 1963 coverage |
|------|----|------------------------|
| #148 | triodeStage | ECC83/EF86 voltage-amp stage circuits with cathode bias + plate load + coupling cap |
| #155 | pushPullPower | Mullard 5-20 is the canonical EL34 push-pull design — bias, NFB topology, transformer match. |
| #156 | phaseInverter | Cathodyne (concertina), paraphase, and long-tail-pair circuits all schematic'd with component values |
| #157 | cathodeBiasShift | Auto-bias resistor + cap behavior under load (cathode voltage rises with quiescent → bias shifts → distortion changes) |
| #184 | bootstrapLF | Mullard preamps use bootstrap in voltage-amp stages — confirms Elliott/EveryCircuit pattern is the classic British approach |

**Future op candidates this book directly motivates (not in catalog yet):**

- **`riaaEQ`** — magnetic phono preamp curve. Inverse RIAA boost on phono
  signals (+20 dB at 20 Hz, -20 dB at 20 kHz, with poles at 50/500/2122 Hz).
  A specialty op for phono-emulation recipes; would back any "vintage
  vinyl preamp" plugin. Mullard book has the full circuit + curve.
- **`baxandallTone`** — passive Baxandall bass/treble tone stack (the
  British counterpart to the American "Fender stack"). Different shape,
  different audible character. Mullard schematizes the canonical version.
- **`williamsonAmp`** — D.T.N. Williamson's 1947 topology that influenced
  every British hi-fi amp afterward. Could be a "recipe-level" model
  (combining `triodeStage` + `phaseInverter` + `pushPullPower` + custom
  feedback) rather than a single op slot.
- **`ultraLinearScreen`** — Mullard 5-20's ultra-linear (UL) screen-grid
  tap on the output transformer primary, sitting between pure pentode and
  pure triode operation. Distinct sonic character (more linear than
  pentode, more efficient than triode). Could be a parameter on
  `pushPullPower` (`pentode_ratio`) rather than a separate op.
- **`tubeRectifierSag`** — GZ34 rectifier behavior (gentler than SS rectifier
  due to internal resistance, gives the "tube amp breathing" feel under
  heavy program). Cordell #154 `psuRectifierSag` already covers this
  conceptually; Mullard provides the GZ34 datasheet curves.

## Citation format for catalog rows

For Mullard-only:
> **Mullard 1963 *Circuits for Audio Amplifiers* (TP413), §[circuit name], pp. [X–Y]**

For paired with Cordell or other:
> **Primary:** Mullard 1963 §[circuit] · **Cross-ref:** Cordell Ch X for SS-equivalent

## Anti-patterns (when NOT to use Mullard 1963)

- **Solid-state amps** — Mullard book has no transistor coverage. Use
  Cordell.
- **Modern feedback theory** — Mullard's NFB analysis is correct but
  qualitative. Cordell Ch 6/7 has the rigorous loop-gain / phase-margin
  treatment.
- **Filter design beyond simple RC tone stacks** — Mullard's filter
  coverage is limited to RIAA + Baxandall. Use Stinchcombe / Tarr /
  Pirkle for resonant filter design.
- **Class D / digital amplification** — book predates Class D era
  entirely. Use Cordell Ch 14.

## Status

- PDF available locally at user's `Desktop\AI Audio dataset\` collection.
- **Not yet copied** into `docs/primary_sources/` — leave the user's local
  copy as the canonical source for now, noted here.
- Open mirror at worldradiohistory.com — historical archive, stable URL.

## Related memory files

- `cordell_audio_power_amplifiers.md` — modern SS amp counterpart
- `whitlock_audio_transformers.md` — output transformer physics
- `depaiva_transformer_emulation.md` — output transformer DSP
- `stinchcombe_korg_moog_filter_studies.md` — analog filter circuits
- `dsp_code_canon_character.md` — saturation / nonlinearity reference snippets
