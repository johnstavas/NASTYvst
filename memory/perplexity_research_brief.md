# Perplexity Deep Research Brief — Op Catalog Primary-Source Backfill

**Goal:** Find Tier-S primary-source PDFs for the ops in our DSP catalog that
currently have weak or missing research backing. The catalog feeds a future
AI plugin-design agent — when a user prompts "British vintage tube amp," the
agent needs to know that the recipe is `triodeStage + phaseInverter +
pushPullPower + ultraLinearScreen + tubeRectifierSag + xformerSat`, AND
have a citable primary source behind every op so the resulting plugin is
defensibly accurate.

---

## 🛑 NON-NEGOTIABLE: ADDITIVE ONLY

**This research must NEVER modify, replace, or erase any existing source
already locked in the catalog or memory canon.** Findings are strictly
additive:

1. **Existing locked Tier-S sources stay locked.** Cordell 2010, Mullard 1963,
   Stinchcombe filter studies, Whitlock transformers, De Paiva 2011 WDF,
   Razavi SSCM 2021, Giannoulis-Massberg-Reiss JAES 2012, Bilbao DAFX papers,
   Smith JOS PASP, Zölzer DAFX, Pultec EQP-1A manual, Hu-Dannenberg ISMIR 2005
   — none of these are up for "replacement" or "demotion."

2. **New findings are appended, not substituted.** If Perplexity finds a
   "better" source for an op that already has a primary, we ADD the new one
   as a secondary or cross-reference — we do NOT swap the existing one out.
   Format:
   ```
   **Primary (locked):** [existing source]
   **Cross-ref / supplement (new):** [Perplexity finding]
   ```

3. **Catalog rows already containing a primary citation are READ-ONLY for
   this research pass.** Only ⬜ slots with weak/missing backing, AND queued
   slots flagged for "want better source" in this brief, are eligible for
   primary-source updates. Everything else: cite secondaries only.

4. **No catalog row, memory file, or research note may be deleted, overwritten,
   or have content removed by this research pass.** Worst case: a finding
   gets logged as a footnote saying "open question." Existing content
   stands.

5. **Don't trust Perplexity's own summary as primary.** A real PDF/scan/
   archive page is the primary; Perplexity's prose is just the search.

**If a finding contradicts an existing locked source**, that's a research
note for human review — not a license to overwrite. Flag in a separate
"contradictions to review" section at the end of each batch.

---

## What "Tier-S Primary" means

A primary source we'd lock as authority for an op:

- **Original textbook / paper / patent** (not a Wikipedia article or a
  Reddit post). Examples we already have: Cordell 2010, Mullard 1963,
  Stinchcombe filter studies, Whitlock transformers, De Paiva 2011 WDF,
  Razavi SSCM 2021, Giannoulis-Massberg-Reiss JAES 2012, Bilbao DAFX
  papers, Smith JOS PASP, Zölzer DAFX textbook.
- **Bench-validated numbers** if possible — schematic + measured response,
  not just topology hand-waves.
- **Openly accessible** — paper at the publisher, archive.org mirror, or
  author's homepage. Avoid paywalled-only sources unless there's no
  alternative.

If only paywalled is available, note it but flag for "cite-without-PDF."

---

## Research request format per op

For EACH op listed below, return:

1. **Best primary source(s)** with: full citation (author, title, journal/
   publisher, year, page numbers), URL, and brief snippet showing it covers
   the topology / math we need.
2. **Tier-S confidence** — your read on whether this is the canonical
   reference, vs. a "secondary but useful" one.
3. **Implementation-relevance score** — does the source give us actual
   schematics + component values + measured behavior (HIGH), or just a
   conceptual overview (MEDIUM/LOW)?
4. **Cross-reference suggestion** — if a different existing source in our
   memory canon already covers this and we should fold the op there
   instead, say so.

---

## Priority batch 1 — recently queued slots (need primary backing)

These were just added to the catalog from book audits. Fill in any gaps.

- **#184 bootstrapLF** — Elliott article + EveryCircuit. **Want:** any
  bench-validated bootstrap distortion measurements (THD vs frequency vs
  source impedance). Self-published audio articles by Douglas Self?
- **#188 riaaEQ** — Mullard + IEC. **Want:** Lipshitz "On RIAA Equalization
  Networks" (JAES 1979, the canonical math) PDF.
- **#189 baxandallTone** — Mullard + Baxandall WW 1952. **Want:** Open PDF
  of original Baxandall 1952 Wireless World article.
- **#192 williamsonAmp** — **Want:** Open PDF of Williamson 1947 Wireless
  World articles (April + May issues), often hosted on classic-audio sites.
- **#195 hawksfordVAS** — Cordell. **Want:** Hawksford "Essex Echo" series
  in Hi-Fi News & Record Review (1980s), and Hawksford's "Distortion
  Correction in Audio Power Amplifiers" JAES 1981.

## Priority batch 2 — ⬜ ops with thin or missing primary backing

Many of these have placeholder citations. Find the real Tier-S sources.

### Filter family
- **#149 otaLadder** — OTA-based ladder topology (Steiner-Parker variant,
  CEM3320 chip, etc.). Best primary?
- **#151 bridgedTNetwork** — notch filter family. Hood "Audio Electronics
  Handbook" is cited; want better.
- **#158 bridgedTeeEQ** — Pultec MEQ-5 specifically. **Want:** schematic
  reproduction or service-manual scan.

### Character / Tube
- **#143 bjtSingleStage** — basic BJT voltage-amp stage. **Want:** Hawksford
  "Essex Echo" or Self's amplifier articles.
- **#144 inductorEQ** — passive inductor-based EQ (API 550-style, Pultec
  EQP-1A inductor section). **Want:** API 550A schematic + measurements.
- **#146 discreteClassAStage** — class-A discrete amp stage. **Want:** Pass
  Labs articles by Nelson Pass (firstwatt.com), or Cordell Ch 1.
- **#148 triodeStage** — single-triode preamp. **Want:** RCA Tube Manual
  RC-30 (open mirror), Pakarinen-Yeh CMJ 2009, Macak PhD thesis
  (Brno 2012).
- **#152 vactrolLPG** — Buchla 292 / Make Noise Optomix LPG. **Want:**
  Buchla 292 service docs, Felt 2010 vactrol thermal model.
- **#155 pushPullPower** — push-pull tube output stage. **Want:** Macak
  thesis, RCA Receiving Tube Manual.
- **#156 phaseInverter** — cathodyne / paraphase / LTP. **Want:**
  Pakarinen-Yeh CMJ 2009 (specifically covers phase inverter analysis).
- **#157 cathodeBiasShift** — auto-bias dynamics. **Want:** Macak thesis,
  Yeh DAFX 2008 (tube amp simulation paper).

### Compressor / Dynamics
- **#153 gateStateMachine** — noise gate state-machine logic. **Want:**
  Bram de Jong (musicdsp), Drugan-Reiss DAFX paper on gate hysteresis.
- **#178 differentialEnvelope** — transient-shaper-style attack/sustain
  detector. **Want:** Bram envelope detector article, Cordell Ch 5.

### Modulation
- **#159 dopplerRotor** — Leslie speaker simulation. **Want:**
  Smith-Rangertz "The Leslie" papers, Pakarinen-Karjalainen DAFX 2007
  Leslie simulation paper.
- **#162 ringMod** — proper analog ring mod (not just multiply). **Want:**
  Hoffmann-Burchardi DAFX 2009 "Asymmetries make the difference" (analog
  ring mod nonlinearity), Bogdanowicz-Belkin Bode article.
- **#175 wowFlutter** — tape wow/flutter modulation. **Want:** Bertram,
  Marolt 1995 wow detection paper, Wright DAFX 2017 tape mechanics paper.

### Pitch
- **#150 granularPitchShifter** — granular pitch shifting OLA. **Want:**
  De Götzen-Bernardini-Arfib DAFX 2000 "Traditional implementations of a
  phase-vocoder," Bernsee smbPitchShift open-source notes.
- **#163 hardSync** — oscillator hard sync (analog). **Want:** Lazzarini-
  Timoney DAFX 2010 (band-limited sync), Välimäki-Huovilainen IEEE SPM
  2007 (related polyBLEP work).
- **#174 phaseDistortion** — Casio CZ phase-distortion synthesis.
  **Want:** Casio CZ-101 service manual or original Hatanaka-Kashio patent
  (US 4,658,691 or similar).

### Synthesis
- **#173 complexOsc** — Buchla 259 complex osc. **Want:** Buchla 259
  service manual, Make Noise DPO docs, or open recreation papers.
- **#177 fmOperator** — Yamaha DX7 operator. **Want:** Chowning 1973 JAES
  ("The Synthesis of Complex Audio Spectra by Means of Frequency
  Modulation"), DX7 service manual.
- **#180 schmittTriggerOsc** — relaxation osc with hysteresis. **Want:**
  Mancini "Op Amps for Everyone" or Sedra-Smith textbook ch. on
  comparator/Schmitt circuits.
- **#183 sixOpFmAlgorithmRouter** — DX7 algorithm chart. **Want:** DX7
  service manual scan with the full 32-algorithm chart.

### Reverb
- **#181 dispersiveAllpass** — frequency-dependent allpass for spring
  reverb. **Want:** Parker DAFX 2010 "Spring Reverberation: A Physical
  Perspective," Bilbao-Parker JASA 2009.
- **#182 blesserReverbCore** — EMT 250 reverb structure. **Want:** Barry
  Blesser US Patent 3,978,289 (1976), Blesser AES Convention 1975 paper.

### Spatial
- **#119 hrtf** — head-related transfer function convolution. **Want:**
  CIPIC HRTF database paper (Algazi et al. 2001), MIT KEMAR database docs.
- **#164 hilbert** — Hilbert transform for analytic signal. **Want:**
  Lyons "Understanding DSP" Ch. 9 (Hilbert), Smith JOS spectral DSP book.

### Neural / ML
- **#120 rnnoise** — Valin GRU noise suppression. **Want:** Jean-Marc Valin
  "A Hybrid DSP/Deep Learning Approach to Real-Time Full-Band Speech
  Enhancement" (RNNoise paper, IWAENC 2018).
- **#121 demucs** — Facebook source separation. **Want:** Défossez et al.
  "Music Source Separation in the Waveform Domain" (2019/2021) and
  Hybrid Demucs (2022).
- **#122 spleeter** — Deezer source separation. **Want:** Hennequin et al.
  "Spleeter: a fast and efficient music source separation tool" JOSS 2020.

### Misc / Niche
- **#160 companding** — μ-law / A-law standards. **Want:** ITU-T G.711 spec.
- **#161 aliasingDecimator** — controlled-aliasing downsampler. **Want:**
  Bilbao "Numerical Sound Synthesis" Ch. on aliasing.
- **#165 voiceCoilCompression** — speaker driver nonlinearity. **Want:**
  Klippel papers on driver nonlinearity (Klippel.de research downloads).
- **#167 linearPhaseEQ** — FIR linear-phase EQ. **Want:** Smith JOS
  "Spectral Audio Signal Processing" Ch. on linear-phase FIR design.
- **#168 gainRangingADC** — auto-ranging A/D character. **Want:** Lavry
  "Sampling Theory For Digital Audio" (Lavry Engineering whitepaper).
- **#169 tapeBias** — tape AC bias. **Want:** Bertram "Theory of Magnetic
  Recording," Wright DAFX 2017.
- **#170 presenceShelf** — vintage presence/air shelf. **Want:** RCA OP-7
  service manual, Pultec MEQ-5 manual.
- **#171 headBumpEQ** — tape head bump. **Want:** Bertram, also Wright DAFX
  2017 tape head response measurements.
- **#172 oilCanDelay** — Tel-Ray / Morley oil-can delay. **Want:** US Patent
  3,521,016 (Goughnour, original oil-can patent), Tel-Ray service docs.
- **#176 varistorVibrato** — VCA-style vibrato via varistor. Limited
  literature. **Want:** any DAFX paper, or fold to a different op.

---

## Priority batch 3 — recipe-level research (the AI-agent killer feature)

For the future "user prompts British tube amp → AI generates recipe"
workflow, return canonical compositions for each archetype below:

### Recipe research questions

For each archetype, find the canonical signal-chain recipe + 1-2
representative real-world products + which of OUR ops would compose it:

1. **British vintage tube amp** (Marshall JTM45 / Vox AC30 / etc.)
2. **American tube amp** (Fender Twin Reverb / Tweed / Bassman)
3. **Hi-fi British tube amp** (Williamson / Mullard 5-20 / Quad II /
   Leak Stereo 20)
4. **Hammond-style spring reverb** (B-3 organ + Hammond Spring tank)
5. **EMT 140 plate reverb**
6. **EMT 250 digital reverb** (the Blesser legend)
7. **Lexicon 224 / 480L digital reverb**
8. **AKG BX-20 / AKG BX-25 spring reverb**
9. **Tape echo** (Roland Space Echo / Echoplex / Watkins Copicat)
10. **Tape compressor** (Studer / Ampex tape saturation)
11. **VCA bus comp** (SSL G-series, dbx 165A)
12. **Opto compressor** (LA-2A / Pultec MB-1)
13. **FET compressor** (UREI 1176 / Cinema Audio Engineering)
14. **Vari-mu compressor** (Manley / Fairchild 670)
15. **Diode-bridge compressor** (Neve 33609 / 2254)
16. **Pultec EQ** (EQP-1A / MEQ-5)
17. **Neve mic pre** (1073 / 1081 / 1066)
18. **API mic pre** (312 / 512c / 550A)
19. **Studer / Telefunken broadcast preamp**
20. **Phaser** (Mu-Tron Bi-Phase / MXR Phase 100 / Boss PH-3)
21. **Flanger** (Electric Mistress / MXR M-117 / TZF)
22. **Chorus** (Roland Dimension D / TC SCF)
23. **Vintage chorus ensemble** (Solina String Ensemble / ARP Quartet)
24. **Leslie rotary speaker** (122 cabinet, 147)
25. **Talkbox / vocoder** (Heil / Roger Troutman / EMS Vocoder 2000)
26. **Lo-fi vintage drum machine** (LinnDrum / SP-1200 / TR-808)
27. **8-bit / NES synth**
28. **Modular West Coast synth** (Buchla 200e style — complex osc + LPG)
29. **Modular East Coast synth** (Moog modular — VCA + ladder + envelope)
30. **Nasty Orb's existing legacy plugins** (~50 plugins, see
    `nasty_orb_legacy_audit.md`)

### Format per archetype

```
**Archetype:** Marshall JTM45
**Canonical signal chain:** input → input-cap HPF → ECC83 V1 (gain stage 1) →
  EQ stack (Marshall passive treble/middle/bass) → ECC83 V2 (gain stage 2) →
  ECC83 V3 (cathodyne phase splitter) → KT66 push-pull output stage →
  output transformer → speaker
**Our op composition:**
  - `bjtSingleStage` × 0 (it's a tube amp — use triode equivalents)
  - `triodeStage` × 2-3 for V1/V2/V3 cathodyne
  - `phaseInverter` × 1 (cathodyne mode, not LTP)
  - `pushPullPower` × 1 (KT66 character preset)
  - `xformerSat` × 1 (output transformer)
  - Optional: `bootstrapLF`, `cathodeBiasShift`
**Primary source:** Aiken Amplifiers schematic library (aikenamps.com),
  Doug Hoffman amp schematics (el34world.com), JTM45 service manual.
**Key character notes:** Marshall's "British crunch" comes from the
  ECC83 V2 + cathodyne overdrive, NOT the output stage. Mid-bump in the
  passive tone stack at ~700 Hz. KT66 power tubes give a softer compression
  than EL34 under hard drive.
```

Repeat for each archetype.

---

## What to deliver

1. A markdown file per priority batch (op-level batch 1, op-level batch 2,
   recipe batch 3). Each entry follows the format requests above.
2. **PDF URLs gathered into one bibliography section** at the bottom of each
   batch file, so we can download them in bulk.
3. **Flag any op that's hard to source** — if you can't find a primary,
   say so plainly. Don't make up sources.
4. **Contradictions section** — any finding that disagrees with an
   existing locked source goes in a separate "Contradictions to review"
   section. These are read-only flags for human triage; the existing source
   stays locked.

## What NOT to deliver

- Do not return rewrites, replacements, or "improved versions" of existing
  catalog rows or memory files. Return only NEW content (sources, citations,
  recipe compositions) that Stav can manually merge.
- Do not suggest demoting any locked Tier-S source. Even if you find a
  "more recent" or "more comprehensive" alternative, propose it as a
  cross-reference, not a replacement.

## Skip / don't research

- Anything we already have a Tier-S source for (Cordell, Mullard, Stinchcombe,
  Whitlock, De Paiva, Razavi — see `memory/*.md`).
- Anything where the existing memory file already cites the canonical paper.
- Closed proprietary software internals (FabFilter / iZotope / Soundtoys
  algorithms — those aren't research, those are reverse-engineering targets).

---

## Why this matters (for context)

Our DSP plugin builder ingests user prompts like "give me a vintage British
bus comp" and emits a graph.json that compiles to a working VST3. For the
output to be musically credible, every op in the recipe needs to behave
according to its declared spec, and that spec needs to be backed by primary
research — otherwise the plugin sounds wrong but in a way the user can't
debug.

We've locked 5 Tier-S references so far (Cordell, Mullard, Stinchcombe,
Whitlock, De Paiva). We have ~57 ⬜ slots in the catalog needing primary
backing, and ~30 archetypal recipes that haven't been formalized yet. This
research closes both gaps.
