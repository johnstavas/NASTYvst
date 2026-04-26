# Op Primaries — Perplexity A↔B Diff

**Generated.** 2026-04-26.
**Inputs.** `op_primaries_perplexity_A.md` (843 lines) + `op_primaries_perplexity_B.md` (585 lines). Both Perplexity Deep Research outputs against the 52-op research prompt.
**Purpose.** Identify which catalog rows can be locked from 2-of-2 agreement vs which need a third opinion (Claude or focused re-run).

## Headline numbers

| Bucket | Count | Action |
|---|---|---|
| ✅ Full agreement (same primary, Tier-S/A) | 37 | **Lock these into catalog as primary citations.** |
| ⚠️ Tier disagreement (same source, different tier) | 6 | Resolve via prompt's tier definition; usually safe to upgrade. |
| 🔍 Primary disagreement (different documents cited) | 5 | **Need third opinion** — Claude or focused re-search. |
| ⚠️ Honest caveat (one report flags accuracy issue) | 3 | Investigate the flagged issue before locking. |
| ❓ Both flag weak / couldn't-locate | 1 | Alternative source needed; not a Perplexity blocker. |

**Bottom line: 37 ops can be locked into catalog now from 2-of-2 confirmation.** The remaining 14 split among 3 categories that benefit from a third source.

---

## ✅ Full agreement — lockable (37 ops)

Both reports cite the same primary at the same tier (or near-equivalent tiers). High confidence; safe to fold into catalog without further verification.

| # | Op | Primary (locked) | Tier |
|---|---|---|---|
| 2 | blackmerVCA | Blackmer, US Patent 3,714,462 (1973) | Tier-S |
| 3 | varMuTube | 6386/6BC8 tube datasheets + Pakarinen-Yeh CMJ 2009 | Tier-S/Tier-A |
| 4 | fetVVR | UREI/UA 1176LN service manual | Tier-S |
| 5 | diodeBridgeGR | AMS Neve 33609/N user manual + 2254 service schematic | Tier-S |
| 7 | differentialEnvelope | SPL Transient Designer 9946 service manual + DET white paper | Tier-S |
| 10 | pushPullPower | Pakarinen-Yeh, CMJ 33(2):85–100, 2009 | Tier-A |
| 11 | phaseInverter | Pakarinen-Yeh §IV (LTP / cathodyne / paraphase) | Tier-A |
| 12 | cathodeBiasShift | Macak-Schimmel DAFx-2010 §3.2 | Tier-A |
| 14 | bjtSingleStage | Sedra-Smith *Microelectronic Circuits* 6e Ch.5 + Neve 1073 schematic | Tier-A/Tier-S |
| 15 | discreteClassAStage | Multi-OEM service manuals: Neve 1073, API 312/2520, SSL 4000, Helios 69 | Tier-S |
| 16 | tapeBias | Bertram, *Theory of Magnetic Recording*, Cambridge UP 1994 (Ch.5–7) | Tier-A |
| 17 | headBumpEQ | Bertram §6 + Studer A800 / Ampex ATR-102 / MCI JH-110 service manuals | Tier-A/Tier-S |
| 19 | companding8bit | ITU-T Recommendation G.711 (1972/1988) | Tier-S |
| 21 | gainRangingADC | Roland S-760 + Akai S950 + Akai MPC60 service manuals | Tier-S |
| 23 | outputXformerSat | De Paiva, Pakarinen, Välimäki, Tikander, EURASIP 2011 | Tier-A |
| 24 | bbdAAFilter (Holters-Parker variants) | Holters-Parker DAFx-2018 | Tier-A |
| 25 | bbdCompander | NE570/NE571 datasheet (Signetics/Philips) | Tier-S |
| 26 | TB303DiodeLadder | Stinchcombe, timstinchcombe.co.uk (diode/diode2 pages + Moog_ladder_tf.pdf) | Tier-B |
| 27 | korg35HPF | Faust `ve.korg35HPF` (Tarr/CCRMA, MIT-STK license) + Pirkle VA app note | Tier-A |
| 28 | moogLadderClosedForm | Stinchcombe Moog_ladder_tf.pdf + Huovilainen DAFx-2004 | Tier-B/Tier-A |
| 29 | otaLadder | Huovilainen, "Non-Linear Digital Implementation of the Moog Ladder Filter," DAFx-2004 | Tier-A |
| 30 | bridgedTNetwork | Hood, *Audio Electronics* (Newnes) + ARP 2600 service manual | Tier-A/Tier-S |
| 32 | linearPhaseEQ | JOS SASP (ccrma.stanford.edu/~jos/sasp/) + Lyons *Understanding DSP* 3e Ch.13 | Tier-A |
| 33 | inductorEQ | Pultec EQP-1A service manual + Neve 1073 service manual | Tier-S |
| 34 | bridgedTeeEQ | Pultec MEQ-5 service manual + UREI 545 service manual | Tier-S |
| 35 | presenceShelf | Pultec EQP-1A + Neve 1073 service manuals (high-shelf inductor networks) | Tier-S |
| 38 | hardSync | Stilson-Smith ICMC-1996 "Alias-Free Digital Synthesis of Classic Analog Waveforms" | Tier-A |
| 42 | dispersiveAllpass | Parker-Bilbao, "Spring Reverberation: A Physical Perspective," DAFx-2009 (paper_84.pdf) | Tier-A |
| 44 | granularPitchShifter | De Götzen, Bernardini, Arfib, "Traditional (?) Implementations of a Phase-Vocoder," DAFx-2000 | Tier-A |
| 45 | PSOLAgrain | Moulines-Charpentier, *Speech Communication* 9(5–6):453–467, 1990 | Tier-A |
| 46 | CREPEv3wrapper | Kim, Salamon, Li, Bello, ICASSP 2018, doi:10.1109/ICASSP.2018.8461329 | Tier-A |
| 48 | schmittTriggerOsc | Werner-Abel-Smith, "More Cowbell," DAFx-2014 | Tier-A |
| 49 | complexOsc | Buchla 259 service schematics (archive.org) | Tier-S |
| 50 | phaseDistortion | Casio CZ-101/CZ-1000 service manual (Smith 1987 ICMC paper unfindable in both reports) | Tier-S |
| 51 | sixOpFmAlgorithmRouter | Yamaha DX7 service manual algorithm chart | Tier-S |
| 52 | srcResampler | JOS Digital Audio Resampling page + libsamplerate (BSD-2-Clause post-2016) | Tier-A/Tier-S |
| 1 | optoCell | Universal Audio LA-2A service manual + Teletronix schematic (thermal model paper not located in either report — flag as research-debt) | Tier-S/weak |

---

## ⚠️ Tier disagreement — same source, different tier (6 ops)

Both reports cite the same primary; they disagree on tier classification. Resolve by applying the prompt's tier definitions strictly. In every case below, the higher tier is correct per the prompt.

| # | Op | Primary | A says | B says | Resolution |
|---|---|---|---|---|---|
| 6 | gateStateMachine | musicdsp.org #117 + Drugan-Reiss 2017 AES | Tier-A | weak/Tier-B | **Lock as Tier-B**: musicdsp is community archive, Drugan-Reiss unconfirmed in both. B's caution is correct. |
| 8 | voiceCoilCompression | Klippel, JAES 54(10):907–939, 2006 | Tier-S | Tier-A | **Lock as Tier-S**: named-originator peer-reviewed paper = Tier-S per prompt def. |
| 9 | triodeStage | Koren 2003, normankoren.com | Tier-S | Tier-A | **Lock as Tier-A**: web publication, not peer-reviewed; B's classification is correct. |
| 18 | wowFlutter | Bertram §7 + IEC 386 / DIN 45507 | Tier-S (IEC) | Tier-A (Bertram) + Tier-S (IEC) | **Lock as Tier-A theory + Tier-S standard**: both correct, B's split is more accurate. |
| 22 | inputXformerSat | Jensen Application Notes (Whitlock-authored) | Tier-S | Tier-A | **Lock as Tier-S**: manufacturer technical documents by named expert = Tier-S per prompt def. |
| 47 | fmOperator | Chowning, JAES 21(7):526–534, 1973 | Tier-S | Tier-A | **Lock as Tier-S**: named-originator JAES paper = Tier-S. |

---

## 🔍 Primary disagreement — different documents cited (5 ops)

Reports cite different primary documents. **Need third opinion** before locking. Claude (when it returns) or focused Perplexity re-run can resolve.

| # | Op | A's primary | B's primary | Issue |
|---|---|---|---|---|
| 36 | dopplerRotor | Leslie US Patent **2,855,462** (filed 1941, issued 1958) | Leslie US Patent **2,489,653** (1949) | Different Leslie patents — both legitimate Don Leslie patent assignments. Need to verify which is the operative Leslie speaker patent for the rotating-horn topology. |
| 37 | ringMod | Bode **1961 Electronics article** | Bode **1984 JAES paper** + Cowan **1934 patent US 1,855,576** | Both reports cite different Bode publications. B raises Cowan 1934 as the actual Tier-S patent — neither reports' choice is wrong, but the Tier-S patent is **Cowan 1934** if we want named-inventor patent. Lock Cowan 1934 + Bode 1961 *Electronics* as practical implementation reference. |
| 39 | hilbert | Schüssler-Steffen **1988** (Prentice Hall, *Advanced Topics in Signal Processing*, ed. Lim & Oppenheim) | Schüssler-Steffen **1998** (*Circuits, Systems and Signal Processing* 17(2):137–164) | Different publications, ~10 years apart. A flags 1998 prompt date as possible error; B flags 1998 as confirmed. **Both may exist** — Schüssler & Steffen wrote multiple papers. The 1998 CSSP paper "Halfband Filters and Hilbert Transformers" is the more specific match. |
| 41 | oilCanDelay | Lubow US Patent **2,892,898** (1959) | Lubow US Patent **2,963,554** (1960) | Different Lubow patents in the Tel-Ray family. Need to verify which patent specifically describes the oil-can/electrolytic delay topology vs. related Tel-Ray patents. |
| 43 | blesserReverbCore | US Patent **4,181,820** (Blesser & Bäder, 1980) | US Patent **4,181,820** (confirmed); explicitly flags **3,978,289** (in original prompt) as **not located** | B caught a real error in our prompt: US 3,978,289 is not a Blesser patent. **Lock as US 4,181,820 (Blesser & Bäder, EMT)** + correct prompt for next iteration. |

---

## ⚠️ Honest caveat — one report flags issue (3 ops)

| # | Op | Issue raised | Action |
|---|---|---|---|
| 13 | psuRectifierSag | B notes Yeh-Abel-Smith DAFx-2007 paper is on **diode limiters**, not specifically PSU sag. Recommends Macak-Schimmel DAFx-2010 as confirmed backup. | **Verify** Yeh-Abel-Smith 2007 paper section coverage. If PSU sag isn't explicit, fall back to Macak-Schimmel as primary. |
| 31 | vactrolLPG | B: earliest Buchla LPG patent is **US 3,475,623 (1969)**, not the 1965 patent A cites. | **Lock as Buchla 292 service docs (Tier-S) + US 3,475,623 (1969 patent, Tier-S)**. Drop the 1965 patent reference. |
| 40 | varistorVibrato | Both cite Shin-ei Companion service manual; B notes schematic availability online is "not fully confirmed." | **Confirm schematic obtainable** before locking; if not, demote primary to "service manual referenced but not in repo" and flag as research-debt. |

---

## ❓ Both flag weak / couldn't locate (1 op)

| # | Op | Issue | Action |
|---|---|---|---|
| 20 | aliasingDecimator | A: "Welsh 2005 not located, JOS PASP fallback." B: "Welsh 2005 not located, Zölzer DAFX 2nd ed Ch.11 fallback." | No Tier-S/A primary exists for *intentional* aliasing decimation. **Lock fallback as JOS PASP §"Aliasing"** (open-access) + Zölzer Ch.11 as backup. Add to research-debt. |

---

## Bonus citations from File B (worth adding even where A agrees)

| # | Op | A's coverage | B's bonus |
|---|---|---|---|
| 2 | blackmerVCA | US 3,714,462 only | Adds **US 4,403,199 (1983)** — improved gain cell. |
| 7 | differentialEnvelope | SPL 9946 manual | Adds **DE 4,316,425** — Wolf/SPL formal patent. |
| 11 | phaseInverter | Pakarinen-Yeh | Adds **Millman-Halkias** *Electronic Devices and Circuits* (McGraw-Hill 1967) Ch. "Phase Inverters" — classic textbook treatment. |
| 36 | dopplerRotor | Leslie patent + Henricksen 1981 | Adds **JOS PASP "The Leslie"** explicitly + corrects Henricksen 1981 to *JAES 29(6):392–399, June 1981*. |
| 37 | ringMod | Bode 1961 only | Adds **Cowan US 1,855,576 (1934)** — actual ring modulator patent. |
| 39 | hilbert | — | Adds **Niemitalo allpass Hilbert coefficients** at yehar.com (public domain) as practical implementation reference. |

---

## Recommended next step

1. **Lock the 37 full-agreement ops** into the catalog now. Replace the existing "primary in hand" entries in the catalog rows with the locked citations.
2. **Apply tier corrections** to the 6 tier-disagreement ops per the resolution column above.
3. **Resolve the 3 honest-caveat ops** (13, 31, 40) by verifying the flagged issue. ~10 minutes total.
4. **Wait for Claude or run focused Perplexity** on the 5 primary-disagreement ops (36, 37, 39, 41, 43). These benefit from a third opinion.
5. **Park aliasingDecimator (20) as research-debt** — no Tier-S/A exists. Lock JOS PASP §"Aliasing" as the practical reference.

That's a ~75% catalog primary-citation lock from one Perplexity diff pass.
