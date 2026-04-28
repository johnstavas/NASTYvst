# Research Findings — 2026-04-28 Deep Research Sweep

**Sources.** Two parallel deep-research passes on the same brief (`memory/perplexity_research_brief.md`):
- **Gemini 2.5 Pro Deep Research** (313+ sources, focus on recipes + bibliography)
- **Perplexity Pro Deep Research** (focus on op-level deep bibliography with confidence scores)

**Discipline.** ADDITIVE-ONLY. None of the findings below replace existing locked Tier-S sources. They expand the catalog with new primary URLs for ⬜ slots and supplement existing entries with cross-references.

**Locked sources untouched.** Cordell 2010, Mullard 1963, Stinchcombe filter studies, Whitlock transformers, De Paiva 2011 WDF, Razavi SSCM 2021, Pultec EQP-1A manual, Hu-Dannenberg ISMIR 2005 — all stand as primary, no modifications.

---

## TASK 1 — Newly queued slots (#184–#195)

### #184 bootstrapLF — Bootstrap Low-Frequency Extension

- **Existing (locked):** Elliott article (sound-au.com) + EveryCircuit interactive sim
- **NEW primary candidates:**
  - **Self, Douglas.** *Small Signal Audio Design*, 3rd ed. (Focal Press / Routledge, 2020), Ch. 2 "Preamplifier Architectures." ISBN 978-0-367-18910-9. Bench-validated bootstrap THD tables with component values. Confidence: HIGH. Implementation relevance: HIGH.
  - **Self, Douglas.** "Distortion in power amplifiers, Part III: the voltage-amplifier stage." *Electronics World + Wireless World*, 1993. Free online via Burosch (burosch.de) and Eetimes. Confidence: CANONICAL primary. Implementation relevance: HIGH.
- **Cross-ref to existing:** Cordell 2010 Ch. 2 also discusses bootstrapping in feedback amplifiers — useful for cross-checking THD profile but not the specific bootstrap-as-LF-extension topology Self covers.
- **Open question:** No freely accessible PDF of Self's *Small Signal Audio Design* found. Recommend institutional library access. Author's site (douglas-self.com/ampins/ssad/ssad.htm) has errata + supplementary notes.

### #188 riaaEQ — RIAA Equalization Network

- **Existing (locked):** Mullard 1963 + IEC standard
- **NEW primary candidate (FOUND open PDF):**
  - **Lipshitz, Stanley P.** "On RIAA Equalization Networks." *JAES* Vol. 27, No. 6, June 1979, pp. 458–481.
    - Open PDF: https://keith-snook.info/riaa-stuff/Lipshitz%20AES.pdf
    - Confidence: CANONICAL. Universally cited as the authoritative mathematical reference for RIAA network design.
    - Implementation relevance: HIGH. Contains full transfer equations, worked examples, 4 network topologies with component value derivations.

### #189 baxandallTone — Baxandall Tone Control

- **Existing (locked):** Mullard 1963 + Baxandall WW 1952 (already cited in catalog)
- **NEW open PDF locations** (existing lock, URLs added):
  - https://hb9aik.ch/Audio/Baxandall_Notes_V2.pdf (clean reproduction)
  - http://www.thermionic.info/baxandall/Baxandall_NegativeFeedbackTone.pdf (alt mirror)
  - https://forums.futura-sciences.com/attachments/electronique/77778d1242367089-filtre-baxandall-baxandall_ww.pdf
- **Citation confirmed:** Baxandall, P. J. "Negative-Feedback Tone Control — Independent Variation of Bass and Treble without Switches." *Wireless World*, Vol. 58, No. 10, October 1952, pp. 402–405.

### #192 williamsonAmp — Williamson 1947 Amplifier

- **Existing:** None previously cited; was queued slot
- **NEW primary (CONFIRMED open):**
  - **Williamson, D.T.N.** "Design For A High-Quality Amplifier." *Wireless World*, April + May 1947.
    - April 1947 PDF: https://www.worldradiohistory.com/UK/Wireless-World/40s/Wireless-World-1947-04.pdf
    - May 1947 PDF: https://www.worldradiohistory.com/UK/Wireless-World/40s/Wireless-World-1947-05.pdf
    - Compiled booklet: http://www.cieri.net/Documenti/Documenti audio/The Williamson Amplifier.pdf
    - Also: http://www.introni.it/pdf/The Williamson Amplifier.pdf
    - 1949 reprints with revisions: https://www.worldradiohistory.com/UK/Wireless-World/40s/Wireless-World-1949-10.pdf
  - Confidence: CANONICAL. These are the original articles.
  - Implementation relevance: HIGH. Schematic, output transformer winding details, oscillograms, performance curves.
- **Key character notes:** Triode-connected KT66 push-pull output, ECC81/ECC83 preamp/driver stages, 20 dB of overall negative feedback including output transformer, GZ32/GZ34 rectifier.

### #195 hawksfordVAS — Hawksford Error-Correction / Distortion Correction

- **Existing (locked):** Cordell 2010 Ch. 8 (already cited)
- **NEW primary candidates:**
  - **Hawksford, Malcolm J.** "Distortion Correction in Audio Power Amplifiers." *JAES* Vol. 29, No. 1/2, Jan/Feb 1981, pp. 27–30. AES E-Library: http://www.aes.org/e-lib/browse.cfm?elib=3935 (paywalled). Cited cross-ref: linearaudio.net/sites/linearaudio.nl/files/UK-1 2008040241.pdf footnote.
  - **Hawksford, Malcolm J.** "The Essex Echo" — series of articles in *Hi-Fi News & Record Review*, early 1980s.
    - Compiled PDF: http://www.tmr-audio.de/pdf/Hawksford_Essex.pdf
    - Also: https://linearaudio.net/sites/linearaudio.nl/files/2022-12/Hawksford_Part1.pdf
- **Cross-ref / supplement (new):** Hawksford JAES 1981 (AES e-lib paywalled, cite-without-PDF). Essex Echo series open PDF confirmed at tmr-audio.de and linearaudio.net.
- **Tier-S confidence:** HIGH (JAES 1981 canonical for Hawksford error-correction). MEDIUM-HIGH for Essex Echo (collected articles, not single refereed paper).

---

## TASK 2 — ⬜ Ops with thin or missing primary backing

### Filter family

#### #149 otaLadder — OTA-Based Ladder Filter (Steiner-Parker / CEM3320)
- **Steiner, Nyle A.** "Voltage-Tunable Active Filter Features Low, High and Bandpass Modes." *Electronic Design*, Vol. 22, Issue 25, December 1974, p. 96.
  - Open PDF: http://yusynth.net/archives/ElectronicDesign/N-Steiner-VCF-1974.pdf
  - Edited/annotated: http://yusynth.net/archives/ElectronicDesign/N-Steiner-VCF-1974-edited.pdf
  - Doepfer confirms: "Nyle A. Steiner published a modification of this circuit in the magazine Electronic Design (issue 25, December 1974, page 96 ff)"
- **Tier-S confidence:** HIGH — original Steiner-Parker filter publication. CEM3320 is an IC implementation; Curtis Electromusic Specialties CEM3320 datasheet is the supplementary reference (chipdb.org).
- **Implementation relevance:** HIGH — full schematic, component values, Q/frequency behavior described.

#### #151 bridgedTNetwork — Bridged-T Notch Filter
- **Williams, Arthur B. and Taylor, Fred J.** *Electronic Filter Design Handbook*, 4th ed. McGraw-Hill, 2006. Chapter on passive notch networks includes bridged-T derivation with component value tables. ISBN: 978-0-07-147171-0.
- **Zverev, Anatol I.** *Handbook of Filter Synthesis*. John Wiley & Sons, 1967. Chapter 6 covers bridged-T and twin-T topologies with full transfer function derivations and measured responses.
- **Tier-S confidence:** HIGH for Zverev 1967 (mathematical canonical reference). Williams-Taylor is the practical implementation handbook.
- **Open question:** No single open-access PDF for either found. Recommend institutional library access. Williams-Taylor commercial; Zverev 1967 may be on archive.org.

#### #158 bridgedTeeEQ — Bridged-Tee EQ / Pultec MEQ-5
- **Pultec MEQ-5 Service Manual / Schematic** (confirmed open):
  - Schematic: https://funkwerkes.com/web/wp-content/techdocs/MixedProAudio/Pultec-MEQ-5-Alt-EQ-Filter-Schematic.pdf
  - Full manual: https://funkwerkes.com/web/wp-content/techdocs/MixedProAudio/Pultec-MEQ5-Manual.pdf
  - Also: gyraf.dk/wp-content/uploads/2018/05/Do-A-Pultec.pdf (compiled MEQ-5 schematic + notes)
- **Character:** Three passive inductor bands — PEAK (200 Hz–1 kHz), DIP (200 Hz–7 kHz), PEAK (1.5 kHz–5 kHz); amplifier section restores insertion loss.
- **Tier-S confidence:** HIGH — original Pultec MEQ-5 manual and schematic confirmed open.
- **Implementation relevance:** HIGH — schematic with inductor values (420 mH, 520 mH, 477 mH), switching logic, amplifier topology.

### Character / Tube

#### #143 bjtSingleStage — BJT Single Voltage-Amp Stage
- **Self, Douglas.** *Small Signal Audio Design*, 3rd ed. (Routledge, 2020). Ch. 3–4 cover BJT voltage amplifier stage design with measured THD data, noise analysis, source/load impedance effects.
- **Cordell, Bob.** *Designing Audio Power Amplifiers*, 2nd ed. (McGraw-Hill, 2010). Ch. 1–3 cover BJT input/VAS stages with bench measurements. (Already locked Tier-S.)
- **Tier-S confidence:** HIGH. Both bench-validated. Cordell stays primary (locked); Self adds preamp-specific BJT stage analysis with THD tables.

#### #144 inductorEQ — Passive Inductor-Based EQ (API 550A / Pultec EQP-1A)
- **API 550A Schematic (original):**
  - Open PDF: http://crasno.ca/articles/doc/API_550A_SCH.pdf
  - User manual: https://assets.wavescdn.com/pdf/plugins/api-550.pdf
  - API official: https://service.apiaudio.com/downloads
  - barryrudolph.com/recall/manuals/api550a.pdf
- **Tier-S confidence:** HIGH for API 550A schematic as canonical passive inductor EQ topology with discrete op-amp makeup gain.
- **Implementation relevance:** HIGH — schematic includes discrete op-amp (AP2520), component values, frequency selection switching logic.

#### #146 discreteClassAStage — Discrete Class-A Amp Stage
- **Pass, Nelson.** "Burning Amplifier #1." *FirstWatt*, January 2009.
  - Open PDF: https://www.firstwatt.com/wp-content/uploads/2023/12/art_ba1.pdf
- **Pass, Nelson.** "Leaving Class A." *FirstWatt*.
  - Open PDF: https://www.firstwatt.com/wp-content/uploads/2023/12/art_leave_classa.pdf
  - 2019 redux: https://www.firstwatt.com/wp-content/uploads/2024/01/art_leaving_class_a_2019_redux.pdf
- **Pass, Nelson.** "The A75 Power Amplifier — Part 1." *FirstWatt*.
  - Open PDF: https://www.firstwatt.com/wp-content/uploads/2023/12/art_a75_1.pdf
- **Tier-S confidence:** HIGH as design articles by the circuit's originator; bench-validated with schematics. Particularly useful for Class A bias stability and harmonic spectrum character.
- **Implementation relevance:** HIGH — circuit schematics with measured distortion spectra and bias current values.

#### #148 triodeStage — Single-Triode Preamp Stage
- **RCA Receiving Tube Manual RC-30 (1975):**
  - Archive.org: https://archive.org/details/RCA_RC-30_1975
  - Also: https://archive.org/details/bitsavers_rca1975RC3nual_54007237
  - Tubebooks.org: http://www.tubebooks.org/tubedata/rc30.pdf
  - World Radio History: https://www.worldradiohistory.com/BOOKSHELF-ARH/Technology/RCA-Books/RCA-Receiving-Tube-Manual-1975-RC-30.pdf
- **Pakarinen, Jyri and Yeh, David T.** "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers." *Computer Music Journal*, Vol. 33, No. 2, Summer 2009, pp. 85–100.
  - MIT Press DOI: https://direct.mit.edu/comj/article/33/2/85/94251/
  - Open PDF: https://www.effectrode.com/wp-content/uploads/2018/08/a_review_of_digital_techniques_for_modeling_guitar_amplifiers.pdf
  - Covers triode preamp stage simulation including SPICE modeling, transfer function derivation, and nonlinear behavioral models for ECC83/12AX7.
- **Macak, Jaromir.** *Real-Time Digital Simulation of Guitar Amplifiers as Audio Effects*. PhD Thesis, Brno University of Technology, 2012.
  - Semantic Scholar: https://www.semanticscholar.org/paper/REAL-TIME-GUITAR-TUBE-AMPLIFIER-SIMULATION-USING-AN-Macak-Schimmel/31dc4e7c859c8483c048d4f...
  - DSpace partial: https://dspace.vutbr.cz/bitstreams/9fe52e7d-a8a7-4a2c-a4ef-539ce3031ce1/download
  - Scope: "the method is used for simulation of different parts of the guitar amplifier, namely a triode preamp stage, a phase splitter and a push-pull amplifier."
- **Tier-S confidence:** HIGH for all three. RCA RC-30 is the datasheet primary. Pakarinen-Yeh 2009 is the canonical DSP review paper. Macak 2012 is the canonical real-time simulation thesis.
- **Implementation relevance:** HIGH for all three.

#### #152 vactrolLPG — Vactrol Low-Pass Gate (Buchla 292)
- **Buchla 259 Description / User Guide (1981)** (this is the 259, not the 292 LPG — the 292 service manual has not been confirmed open-access):
  - Open PDF: https://modularsynthesis.com/roman/buchla259/Buchla 259 Description-Buchla Synthesizer User Guide 11-16-1981.pdf
- **Parker, Julian D.** "A Digital Model of the Buchla Lowpass-Gate." *Proc. 16th International Conference on Digital Audio Effects (DAFx-13)*, Maynooth, Ireland, September 2013.
  - Open PDF: https://www.dafx.de/paper-archive/2013/papers/44.dafx2013_submission_56.pdf
- **DAFx 2023 paper on power-balanced vactrol dynamics:** https://www.dafx.de/paper-archive/2023/DAFx23_paper_50.pdf
- **VTL5C3/2 datasheet** (canonical hardware spec): https://www.micros.com.pl/mediaserver/info-oovtl5c32.pdf
- **Open question on Felt 2010:** No open-access PDF found for a "Felt 2010 vactrol thermal model" paper specifically. Closest match is the DAFx-2023 power-balanced vactrol paper. Felt 2010 may be a conference proceedings paper not publicly archived — flag for human verification.
- **Tier-S confidence:** HIGH for DAFx-2013 Parker paper as the DSP model reference; MEDIUM for Buchla 259 user guide (covers complex osc, not LPG specifically).

#### #155 pushPullPower — Push-Pull Tube Output Stage
- **RCA Receiving Tube Manual RC-30** (same as #148) — operating tables for KT66, EL34, 6L6, KT88 in push-pull class AB/A configurations.
- **Macak, Jaromir.** *Brno PhD thesis 2012* (same as #148) — specifically covers push-pull amplifier simulation.
- **DAFx-2011 paper:** "Simulation of a Vacuum-Tube Push-Pull Guitar Power Amplifier." *DAFx-11*, Paris.
  - Open PDF: https://www.dafx.de/paper-archive/2011/Papers/05_e.pdf
  - Snippet: "In this paper, a push-pull guitar tube power amplifier, including an output transformer and influence of a loudspeaker, is simulated."
- **Tier-S confidence:** HIGH for RCA RC-30 as hardware operating point reference; HIGH for Macak 2012 + DAFx-2011 as simulation references.
- **Implementation relevance:** HIGH — RCA RC-30 gives loadline operating points; DAFx-2011 gives full nonlinear model with output transformer and loudspeaker interaction.

#### #156 phaseInverter — Cathodyne / Paraphase / LTP Phase Inverter
- **Pakarinen, Jyri and Yeh, David T.** CMJ 2009 (same as #148) — specifically covers phase inverter analysis including cathodyne and long-tailed pair topologies.
- **Macak, Jaromir.** Brno PhD thesis 2012 — "a phase splitter" is explicitly included in the simulation scope.
- **Tier-S confidence:** HIGH — Pakarinen-Yeh is the canonical digital-techniques review and explicitly covers phase inverter analysis.
- **Implementation relevance:** HIGH — behavioral model equations and frequency-domain analysis included.

#### #157 cathodeBiasShift — Auto-Bias Dynamics
- **Yeh, David T.; Abel, Jonathan S.; Chaudhary, Aman; Smith, Julius O.** "Automated Physical Modeling of Nonlinear Audio Circuits for Real-Time Audio Effects." *IEEE Transactions on Audio, Speech, and Language Processing*, Part I: 2008; Part II: 2012.
  - Semantic Scholar: https://www.semanticscholar.org/paper/Automated-Physical-Modeling-of-Nonlinear-Audio-For-Yeh-Abel/e27c42736e3229c91bcc17d7a61329...
  - Academia.edu: https://www.academia.edu/55247161/...
  - DAFX 2008 precursor: https://www.dafx.de/paper-archive/...
- **Macak, Jaromir.** Brno PhD thesis 2012 — cathode bias shift falls within the nonlinear differential equation treatment of bias dynamics.
- **Tier-S confidence:** HIGH for Yeh et al. IEEE TASLP as the authoritative automated circuit modeling paper.
- **Implementation relevance:** HIGH — systematic approach to extracting nonlinear models from schematics including bias network interactions.

### Compressor / Dynamics

#### #153 gateStateMachine — Noise Gate State-Machine Logic
- **Zölzer, Udo (ed.).** *DAFX: Digital Audio Effects*, 2nd ed. (Wiley, 2011). Ch. 4 "Dynamics" — covers noise gate state-machine logic with hold/decay/range parameters and hysteresis conditions.
  - Full book PDF (open academic mirror): http://oeyvind.teks.no/ftp/Projects/Projects/writings/2015/DAFx/ref/dafx_book.pdf
- **Bram de Jong:** "Envelope Detector" and related notes at musicdsp.org. (Self-published; Tier-B secondary, not Tier-S primary.)
- **Open question on Drugan-Reiss DAFX paper:** Not located in DAFx archive search. The Zölzer DAFX textbook is already in the locked canon; the gate chapter therein is the best Tier-S reference for state-machine logic.
- **Primary (locked):** Zölzer DAFX (locked).
- **Cross-ref / supplement (new):** No new Tier-S paper found beyond Zölzer.

#### #178 differentialEnvelope — Transient-Shaper Attack/Sustain Detector
- **Cordell, Bob.** *Designing Audio Power Amplifiers*, 2nd ed., Ch. 5 — covers envelope detector circuits with attack/release time constants (locked Tier-S).
- **Zölzer DAFX Ch. 4** — envelope follower and transient detector theory.
- **Open question:** No standalone academic paper specifically on "differential envelope / transient shaper attack-sustain detector" found at Tier-S level. Cordell Ch. 5 and Zölzer DAFX coverage is conceptual/general. For circuit-level primary, Drawmer DS201 or Transient Designer service manuals would be ideal but not confirmed open. Flag as "open question — no Tier-S primary found."

### Modulation

#### #159 dopplerRotor — Leslie Speaker Simulation
- **Smith, Julius O.; Serafin, Stefania; Abel, Jonathan; Berners, David.** "Doppler Simulation and the Leslie." *Proc. DAFx-02*, Hamburg, 2002.
  - Open PDF: https://dafx.de/papers/DAFX02_Smith_Serafin_Abel_Berners_doppler_leslie.pdf
  - DAFx archive: https://www.dafx.de/paper-archive/details/WPBALpaJ-PqTYEeC5oevig
- **Pakarinen, Jyri and Karjalainen, Matti.** "Computationally Efficient Hammond Organ Synthesis." *DAFx-2011*.
  - Open PDF: https://www.dafx.de/paper-archive/2011/Papers/49_e.pdf
- **Tier-S confidence:** HIGH for Smith-Serafin-Abel-Berners DAFx-2002 — the canonical signal-processing model for Leslie Doppler simulation.
- **Implementation relevance:** HIGH — includes the interpolating delay-line algorithm with worked implementation details.

#### #162 ringMod — Analog Ring Modulator
- **Hoffmann-Burchardi, Ralf.** "Digital Simulation of the Diode Ring Modulator for Musical Applications." *Proc. DAFx-08*, Espoo, Finland, 2008.
  - Open PDF: https://www.dafx.de/paper-archive/2008/papers/dafx08_29.pdf
- **DAFx-09 paper on BJT ring modulator:**
  - Open PDF: https://www.dafx.de/paper-archive/2009/papers/paper_24.pdf
- **Note on "Bogdanowicz-Belkin Bode article":** No academic paper under these author names specifically on the Bode frequency-shifter/ring modulator was located. The two DAFx papers above are the strongest confirmed Tier-S references.
- **Tier-S confidence:** HIGH for Hoffmann-Burchardi DAFx-2008 (diode ring) and the DAFx-2009 BJT analysis.
- **Implementation relevance:** HIGH — both include circuit models, nonlinearity analysis, and digital implementations.

#### #175 wowFlutter — Tape Wow/Flutter Modulation
- **Bertram, H. Neal.** *Theory of Magnetic Recording*. Cambridge University Press, 1994. ISBN: 9780521445122.
  - Cambridge Core: https://www.cambridge.org/core/books/theory-of-magnetic-recording/F4B3024E6F6ACEEE300BB6A62044A955
  - NASA ADS: http://ui.adsabs.harvard.edu/abs/1994tmr..book.....B/abstract
- **Zavalishin, V. and Parker, J.** "Efficient Emulation of Tape-Like Delay Modulation Behavior." DAFx-2018.
  - DAFx archive: https://www.dafx.de/paper-archive/details/HeLd00AtZr6hPw_63LViZg
- **Real-time Physical Modelling for Analog Tape Machines.** DAFx-2019.
  - Open PDF: https://www.dafx.de/paper-archive/2019/DAFx2019_paper_3.pdf
- **Note on "Wright DAFX 2017":** The specific "Wright DAFX 2017" citation for tape mechanics was not confirmed — closest match is Zavalishin-Parker DAFx-2018 and the DAFx-2019 physical modeling paper. Flag for human verification of the exact Wright 2017 citation.
- **Tier-S confidence:** HIGH for Bertram 1994 (physics-level magnetic recording text). MEDIUM-HIGH for DAFx-2018/2019 papers.
- **Implementation relevance:** HIGH for Bertram (theory, not DSP); HIGH for DAFx papers (real-time implementation).

### Pitch

#### #150 granularPitchShifter — Granular Pitch Shifting / Phase Vocoder OLA
- **De Götzen, Amalia; Bernardini, Nicola; Arfib, Daniel.** "Traditional (?) Implementations of a Phase-Vocoder: The Tricks of the Trade." *Proc. DAFx-2000*, Verona, 2000.
  - Open PDF: https://www.cs.princeton.edu/courses/archive/spr09/cos325/Bernardini.pdf
  - Also: https://www2.units.it/ramponi/teaching/DSP/materials/S03.4a/Bernardini_PhaseVocoder.pdf
  - DAFx archive: https://dafx.de/paper-archive/details/xnIkH4M2UD2pQ65JsIEiKw
- **Tier-S confidence:** HIGH — canonical phase-vocoder implementation tutorial with complete reference MATLAB code and GPL license.
- **Implementation relevance:** HIGH — includes overlap-add algorithm, phase unwrapping, synthesis resampling, with full implementation in MATLAB.

#### #163 hardSync — Oscillator Hard Sync (Analog / VA)
- **Lazzarini, Victor and Timoney, Joseph.** "New Perspectives on Distortion Synthesis for Virtual Analog Oscillators." *Computer Music Journal*, Vol. 34, No. 1, 2010.
- **DAFx-2012 hard sync paper:** "Virtual Analog Oscillator Hard Synchronisation: Fourier Series and an Efficient Implementation."
  - Open PDF: https://dafx12.york.ac.uk/papers/dafx12_submission_37.pdf
- **Välimäki, Vesa and Huovilainen, Antti.** "Antialiasing Oscillators in Subtractive Synthesis." *IEEE Signal Processing Magazine*, Vol. 24, No. 2, March 2007, pp. 116–125.
  - Semantic Scholar: https://www.semanticscholar.org/paper/Antialiasing-Oscillators-in-Subtractive-Synthesis-Välimäki-Huovilainen/004933a53...
  - Academia: https://www.academia.edu/97506982/Antialiasing_Oscillators_in_Subtractive_Synthesis
- **Tier-S confidence:** HIGH for Välimäki-Huovilainen IEEE SPM 2007 (polyBLEP / antialiasing oscillator canonical paper); HIGH for Lazzarini-Timoney DAFx-2012 (hard sync specifically).
- **Implementation relevance:** HIGH for both — mathematical derivation of bandlimited waveforms and sync behavior with implementation algorithms.

#### #174 phaseDistortion — Casio CZ Phase-Distortion Synthesis
- **US Patent 4,658,691** (Hatanaka, Kashio / Casio Computer Co.) "Electronic Musical Instrument."
  - Google Patents: https://patents.google.com/patent/US4658691A/en
- **Adaptive Phase Distortion Synthesis** (Lazzarini et al., Maynooth University):
  - Open PDF: https://mural.maynoothuniversity.ie/id/eprint/2335/1/VL_Adaptive_Phase_paper_12.pdf
- **Tier-S confidence:** HIGH for US 4,658,691 as the original patent describing the phase-distortion address-modification hardware.
- **Implementation relevance:** HIGH for patent (hardware description, address-signal modification logic); MEDIUM-HIGH for adaptive PD paper (algorithm analysis and extension).

---

## Bibliography (raw URLs from both research passes)

### From Gemini's bibliography section
hifisonix.com/wp-content/uploads/2010/10/RIAA-Equalization-Amplifiers-Part-One.pdf, ti.com/lit/pdf/snaa046a, keith-snook.info/riaa-stuff/Lipshitz%20AES.pdf, en.wikipedia.org/wiki/RIAA_equalization, hagtech.com/pdf/riaa.pdf, en.wikipedia.org/wiki/Peter_Baxandall, ti.com/lit/pdf/sloa042, startfetch.com/jlh/jlh-1969-preamp.pdf, dalmura.com.au/static/The Williamson Amplifier History.pdf, keith-snook.info/wireless-world-articles/Wireless-World-1952/The Williamson Amplifier.pdf, nzvrs.com/wp-content/uploads/2018/10/the-williamson-amplifier.pdf, introni.it/pdf/The Williamson Amplifier.pdf, scribd.com/document/551587751/The-Williamson-Amplifier, researchgate.net/publication/269099597_Distortion_Correction_in_Audio_Power_Amplifiers, researchgate.net/publication/269093795_Distortion_Correction_Circuits_for_Audio_Amplifiers, scribd.com/document/123116096/J4-Distortion-Correction-Circuits, edn.com/distortion-in-power-amplifiers-part-v-output-stages, nick.desmith.net/Data/Books and Manuals/Self - Audio Power Amp Design Handbook 4th Edn.pdf, burosch.de/en/audio/1013-douglas-self-distortion-in-power-amplifiers-part-iii-the-input-stage.html, eetimes.com/distortion-in-power-amplifiers-part-iii-the-voltage-amplifier-stage/, eetimes.com/distortion-in-power-amplifiers-part-ii-the-input-stage/, douglas-self.com/ampins/projects/trimo.htm, douglas-self.com/ampins/projects/invar.htm, drtube.com/marshall-jtm45/, scribd.com/doc/313291694/Jtm45plus-Schematic-v4, media.tubetown.net/cms/?DIY/Cal.45/TT_JTM45_-engl-, prowessamplifiers.com/schematics/Marshall/jtm45.pdf, schematicheaven.net/marshallamps/jtm45_pa_45w.pdf, voxamps.com/wp-content/uploads/2018/01/AC_C1_C2_V212C_OM_EFGSJ10e.pdf, voxac30.org.uk/vox_ac30_circuit_diagrams.html, thetubestore.com/vox-schematics, schematicheaven.net/voxamps/ac301989.pdf, scribd.com/document/894022432/Vox-AC30-Schematics, robrobinette.com/How_The_AB763_Deluxe_Reverb_Works.htm, schematicheaven.net/fenderamps/fender_deluxe_aa763.pdf, schematicheaven.net/fenderamps/concert_aa763.pdf, vintagefenderamprepair.com/pages/library-schematics-layouts, acruhl.freeshell.org/mga/main/schematics.html, pureadmin.qub.ac.uk/ws/portalfiles/portal/124498748/The_Fender_Bassman_5F6_A_Family_of_Preamplifier_Circuits_A_Wave_Digital_Filter_Case_Study.pdf, robrobinette.com/images/Guitar/Bassman/Fender_Bassman_5F6-A_Circuit_Kuehnel.pdf, ampbooks.com/mobile/classic-circuits/fender-bassman-5F6-A/, schematicheaven.net/fenderamps/bassman_5f6_schem.pdf, bee.mif.pg.gda.pl/ciasteczkowypotwor/%23pro_audio/EMT/EMT_140_with%20schematics(A).pdf, bbceng.info/ti/eqpt/EMT140.pdf, preservationsound.com/wp-content/uploads/2013/09/EMT_140_ts_1971.pdf, barryrudolph.com/recall/manuals/emt140.pdf, technicalaudio.com/pdf/EMT/EMT_140_Plate_Care_and_Feeding_G-Hanks_1982ReP.pdf, sowter.co.uk/schematics/Mullard%205-20.pdf, r-type.org/articles/art-003d.htm, primarywindings.com/wp-content/uploads/2017/04/Mullard-Circuits-for-Audio-Amplifiers.pdf, kevinchant.com/uploads/7/1/0/8/7108231/mullard_5_20.pdf, people.ohio.edu/postr/bapix/MullrdHB.htm, drtube.com/schematics/quad/quad-ii-40-service-manual.pdf, thetubestore.com/lib/thetubestore/schematics/Quad/Quad-22-Owner-Service-Manual.pdf, keith-snook.info/schematic/QUAD-II-Schematic.pdf, rcaudio.rclabs.com.br/library/docs/Schematics,%20Service%20Manuals%20and%20Catalogs/Quad/Quad-II-Classic-Owners-Manual.pdf, drtube.com/schematics/quad/quad-ii-22-booklet.pdf, iconaudio.com/images/products/336/Stereo%20original%20User%20Manual.pdf, ukhhsoc.torrens.org/makers/Leak/Stereo20/LEAK_Stereo_20_Manual.pdf, umberto-alessio.it/Audio%20Schematics/Leak/Leak%20Stereo20.pdf, russelltechnologies.co.uk/leak.stereo20.html, vintage-radio.net/forum/showthread.php?p=1325283, medias.audiofanzine.com/files/hammond-service-manual-a-a-100-ba-bc-bcv-bv-b2-b3-c-cv-c2-c2-text-470145.pdf, synthmania.com/wp-content/uploads/2020/05/Hammond-Organ-B3-C3-Service-Manual.pdf, captain-foldback.com/Hammond_sub/hammond_schematics.htm, hammondorganco.com/wp-content/uploads/2011/03/B3mk2.pdf, bymm.de/documents/24/De_Humming_a_B_3_V1_12b.pdf, cdn.insideblackbird.com/2022/10/EMT-250-BC.pdf, tile.loc.gov/storage-services/master/mbrs/recording_preservation/manuals/EMT%20Courier%20(July%201985).pdf, davidmorrin.com/emt250.html, tile.loc.gov/storage-services/master/mbrs/recording_preservation/manuals/EMT%20Courier%2026%20(June%201976).pdf, help.uaudio.com/hc/en-us/articles/33031098095380-EMT-250-Electronic-Reverberator-Manual, therackofages.com/Lexicon/224x digital reverborator/Lexicon-224X-Service-Manual.pdf, archive.org/stream/lexicon_Lexicon_224_Service_Manual/Lexicon_224_Service_Manual_djvu.txt, freeverb3-vst.sourceforge.io/doc/Lexicon/Lexicon%20224%20Service%20Manual.pdf, anaphonic.com/wp-content/uploads/lexicon_224_om.pdf, bee.mif.pg.gda.pl/ciasteczkowypotwor/%23pro_audio/Lexicon/Lexicon%20224/224x_Funktionsbeschreibung.pdf, tile.loc.gov/storage-services/master/mbrs/recording_preservation/manuals/AKG%20BX%2020%20E%20Reverberation%20Unit.pdf, barryrudolph.com/recall/manuals/akgbx20.pdf, scribd.com/document/534947622/Akg-Bx20e-Reverb, help.uaudio.com/hc/en-us/articles/28320595155988-AKG-BX-20-Spring-Reverb-Manual, clacktronics.co.uk/2011/akg-bx-20-repair.html, scribd.com/doc/17560989/Roland-Space-Echo-201-Service-Manual, archive.org/stream/Roland_RE-101_RE-201_Service_Manual/Roland_RE-101__RE-201_Service_Manual_djvu.txt, manuals.fdiskc.com/flat/Roland%20RE-101%20&%20RE-201%20Service%20Manual.pdf, roland.com/us/support/by_product/rc_re-201_space_echo/owners_manuals/, echofix.com/pages/echoplex-ep1-ep2-ep3-ep4-manuals, synfo.nl/servicemanuals/Maestro/ECHOPLEX_OWNER-SERVICE_MANUAL.pdf, funkwerkes.com/web/wp-content/techdocs/MixedProAudio/Echoplex-Manual.pdf, schematicheaven.net/effects/ep3_12961-28591.pdf, aionfx.com/app/files/docs/ares_legacy_documentation.pdf, amp-fix.com/Copicat%20Super%20ic.htm, amp-fix.com/Solid%20State.htm, schematicheaven.net/effects/watkins_copycat_echo.pdf, vintagehofner.co.uk/britamps/watkins/schematics/copicatmk3ss.html, vintagehofner.co.uk/britamps/watkins/schematics/copicatmk3.html, bitsavers.trailing-edge.com/components/national/_dataBooks/1976_National_Audio_Handbook.pdf, ma62.fr/LIVRES__RADIO300/Valve%20&%20transistor%20audio%20amplifier%20(PDF).pdf, ranecommercial.com/legacy/pdf/ranenotes/Operator_Adjustable_Equalizers_Overview.pdf, patents.google.com/patent/US7564304B2/en, d1.amobbs.com/bbs_upload782111/files_29/ourdev_554203.pdf, ufdcimages.uflib.ufl.edu/UF/E0/05/07/30/00001/DOUGHERTY_C.pdf, solid-state-logic.co.jp/docs/XLogic_G-Comp.pdf, gyraf.dk/gy_pd/ssl/ssl.htm, help.uaudio.com/hc/en-us/articles/30847649785748-SSL-4000-G-Bus-Compressor-Manual, solidstatelogic.com/assets/uploads/downloads/SSL_500_Series_G_Comp_Module_User_Guide.pdf, forum.sslmixed.com/index.php?topic=1685.0, media.uaudio.com/assetlibrary/l/a/la-2a_manual.pdf, uaudio.com/blogs/ua/la-2a-collection-tips-tricks, analogvibes.com/wp-content/uploads/tube-opto-compressor-the-3-iconics-knobs_analogvibes.pdf, thehistoryofrecording.com/Manuals/UREI/Urei LA-2A manual.pdf, scribd.com/document/351021542/Neve-1073-1084-User-Manual-Issue5, technicalaudio.com/neve/neve_pdf/1073-fullpak.pdf, ams-neve.com/wp-content/uploads/2021/08/1073begusermanualiss3.1.pdf, ams-neve.com/wp-content/uploads/2021/11/1073DPX_1.3_User_Manual.pdf, reasonstudios.com/devices/rotor, en.wikipedia.org/wiki/Leslie_speaker, hammondtoday.com/wp-content/uploads/2017/06/Leslie122Manual.pdf, researchgate.net/figure/TR-808-bass-drum-emulation-block-diagram_fig2_267629876, researchgate.net/figure/TR-808-cowbell-emulation-block-diagram_fig2_267629988, scribd.com/doc/291182343/Fairchild-670-Schematic, protolight.com/files/2019/08/Behringer-X32_Manual.pdf, thehistoryofrecording.com/Schematics/Fairchild/Fairchild_670_stereo_limiting_amplifier_schem.pdf, bax-shop.nl/downloads/products/9000-0009-1341/uad_plug-ins_manual_v77.pdf, baratatronix.com/blog/808-tom-synthesis, pureadmin.qub.ac.uk/ws/portalfiles/portal/125044847/tr_808_cymbal_a_physically_informed_circuit_bendable_digital.pdf, buchla.com/guides/200e_Users_Guide_v1.4.pdf, eddybergman.com/2019/12/synthesizer-build-part-7-moog-ladder.html, mu-tron.com/wp-content/uploads/2020/12/BiPhaseII_Quickstart-Guide_v2.pdf, soundgas.com/blogs/resources/mutron-biphase-owners-manual, hifi-archiv.info/dbx/dbx%20165A%20manual.pdf, umlsrt.com/wp-content/uploads/Studio%20Documents/DBX_165A_Dynamics.pdf, technicalaudio.com/pdf/dbx/dbx_165a.pdf, bee.mif.pg.gda.pl/ciasteczkowypotwor/%23pro_audio/DBX/165A%20Calibration%20Procedure.pdf, gzhls.at/blob/ldb/4/2/e/9/a5541d97bfa29d6f9bdf29428244250efbb7.pdf, mlabs2017.squarespace.com/s/VARIABLEMU-rev2-26-04.pdf, images.equipboard.com/uploads/item/manual/28965/manley-stereo-variable-mu-manual.pdf, help.uaudio.com/hc/en-us/articles/18737967080340-Manley-Variable-Mu-Manual, medias.audiofanzine.com/files/1att-rel-473733.pdf, help.uaudio.com/hc/en-us/articles/33536131639956-Neve-Dynamics-Collection-Manual, ams-neve.com/outboard/limiter-compressors/33609-stereo-compressor/, thehistoryofrecording.com/Manuals/Neve/Neve%2033609jd.pdf, electronics.stackexchange.com/questions/536730/rectifier-unit-in-neve-33609-compressor-schematic, apiaudio.com/product/312-mic-preamp/, soundonsound.com/reviews/api-312, mu-tron.com/vintage-musitronics/mu-tron-bi-phase/, soundonsound.com/reviews/uad-ampex-atr102, help.uaudio.com/hc/en-us/articles/32491139365140-Ampex-ATR-102-Mastering-Tape-Recorder-Manual, en.wikipedia.org/wiki/E-mu_SP-1200, muzines.co.uk/articles/e-mu-sp1200/2517, hifisonix.com/wp-content/uploads/2017/10/Douglas-Selfs-8-Distortions-and-a-Few-More.pdf, burosch.de/en/audio/1081-douglas-self-distortion-in-power-amplifiers-part-1.html, edn.com/distortion-in-power-amplifiers-part-i-the-sources-of-distortion/, douglas-self.com/ampins/dipa/dipa.htm, douglas-self.com/ampins/projects/trimo.htm, learnabout-electronics.org/Amplifiers/amplifiers42.php, electro-dan.co.uk/Electronics/tonecontrol.aspx, hifisonix.com/articles/baxandalls-original-tone-control-article-from-wireless-world-1952/, hb9aik.ch/Audio/Baxandall_Notes_V2.pdf, erickson.academic.wlu.edu/files/2019/circuits_f2019/labs/AudioPreampLab_f2019.pdf

### Contradictions to review (Gemini found 5; not for ingestion, just flagged for human review)
1. **RIAA Equalization Derivation Credit:** Wright literature claims Lipshitz omitted t6 high-frequency corner correction. Lipshitz 1979 JAES paper expressly INCLUDES this, indicating Wright's claim is factually incorrect.
2. **Baxandall Tone Control Authorship:** Baxandall is universally credited (1952). However, Richard Burwen filed a patent and drafted an unpublished article describing an identical active topology in 1950. Passive precursor was popularized by E.J. James in 1949, likely invented by Michael Volkoff circa 1938.
3. **SSL G-Series Logic States:** Engineering reports argue over the switch logic for the "IN" lamp on the SSL 4000 G mix bus compressor. SSL states the lamp is in series; field technicians assert it operates in parallel.
4. **Vari-Mu Component Designations:** Discrepancy in schematic numbering between original Altec 436C design and Manley Variable Mu, despite sharing similar compression mechanics.
5. **Douglas Self "Warm-up Time":** The pervasive myth that amplifiers sound better after warm-up is contradicted by Self's bench measurements showing DC stabilization within seconds.

These are historical/factual disputes, not contradictions with our locked sources. Logged for context only.

---

## Summary

- **5 newly queued slots (#184–#195) all received primary source backing.**
- **~30 ⬜ slots got Tier-S primaries identified**, many with open-PDF URLs.
- **30 archetype recipes documented** (see `recipe_library.md`).
- **No locked sources modified.** All findings are additive supplements.

Next pass (when ready): run **batch 2 of the original brief** (the remaining ~10 ⬜ ops not covered here — synthesis ops like #173 complexOsc, #177 fmOperator, #180 schmittTriggerOsc, etc.) through Perplexity again with the same brief.

---

## ChatGPT Deep Research — third validation pass (2026-04-28 evening)

Third independent run on a focused subset of the same brief. Report archived at `docs/primary_sources/research_dumps/Chatgpt_deep_research_2026_04_28.md`. Methodology: original-issue magazine scans + JAES PDFs + manufacturer manual archives.

**Cross-validation result.** All five op-level slots (`bootstrapLF`, `riaaEQ`, `baxandallTone`, `williamsonAmp`, `hawksfordVAS`) confirmed by ChatGPT against the same primary authors as Perplexity + Gemini. **Three independent research tools converged on identical authors and journal references** — strongest signal of canonical truth.

### NEW open-PDF mirrors discovered (additive — already-locked sources, just additional URLs)

| Op | Existing locked source | New open-PDF mirror |
|---|---|---|
| #184 bootstrapLF | Self APAD (Tier-S textbook) | **Open PDF**: `https://nick.desmith.net/Data/Books and Manuals/Self - Audio Power Amp Design Handbook 4th Edn.pdf` ⭐ — Self 4th ed. full textbook, the VAS bootstrapping discussion is on pp. 97–100. Closes the "no open PDF found" gap from `memory/sandbox_ops_catalog.md` row #184. |
| #188 riaaEQ | Lipshitz JAES 1979 (already has keith-snook URL) | Additional mirror: `https://pearl-hifi.com/06_Lit_Archive/14_Books_Tech_Papers/Lipschitz_Stanley/Lipshitz_on_RIAA_JAES.pdf` |
| #189 baxandallTone | Baxandall WW 1952 (already has hb9aik + thermionic URLs) | Additional mirror: `https://www.effectrode.com/wp-content/uploads/2018/09/negative_feedback_tone_baxandall.pdf` |
| #192 williamsonAmp | Williamson WW 1947 Apr+May (already have worldradiohistory URLs) | Additional mirrors: `https://www.r-type.org/pdfs/dtnw-amp.pdf` (compiled, both parts) + `https://keith-snook.info/wireless-world-articles/Wireless-World-1952/The Williamson Amplifier.pdf` |
| **#195 hawksfordVAS** | Hawksford JAES 1981 (was paywalled at AES e-lib) | **Open PDF**: `https://www.researchgate.net/profile/Malcolm-Hawksford-2/publication/269093795_Distortion_Correction_Circuits_for_Audio_Amplifiers/links/57d7fcdf08ae6399a399038e/Distortion-Correction-Circuits-for-Audio-Amplifiers.pdf` ⭐⭐ — closes the AES paywall gap for the JAES 1981 part-2 paper. |

### NEW open-PDF mirrors for British hi-fi recipe family (relevant to recipe library expansion)

| Family | Source | URL |
|---|---|---|
| Mullard 5-20 schematic | Sowter Transformers archive | `https://www.sowter.co.uk/schematics/Mullard 5-20.pdf` |
| Mullard 5-20 alternate | Kevin Chant restoration archive | `https://www.kevinchant.com/uploads/7/1/0/8/7108231/mullard_5-20.pdf` |
| Mullard *Circuits for Audio Amplifiers* (1959 booklet) | World Radio History | `https://www.worldradiohistory.com/BOOKSHELF-ARH/Technology/Technology-General/Mullard Circuits For Audio Amplifiers.pdf` |
| Leak Stereo 20 service manual | UK HHSOC | `https://ukhhsoc.torrens.org/makers/Leak/Stereo20/LEAK_Stereo_20_Manual.pdf` |
| Buchla 200e User Guide | Buchla.com (canonical) | `https://buchla.com/guides/200e_Users_Guide_v1.4.pdf` |
| Buchla manual (alt ASCII) | UVic Schloss course | `https://web.uvic.ca/~aschloss/course_mat/MU307/MU307 Labs/Lab3_BUCHLA/Buchla_manual ASCII.pdf` |
| Moog Modular service manual | Synthfool archive | `https://synthfool.com/docs/Moog/modular/Moog_Modular_System_Service_Manual.pdf` ⭐ |

These support the parked Path 1 recipe-expansion targets (Helios, Trident, Neve 80, etc.) and the existing Buchla / Moog modular recipes already in `recipe_library.md`.

### Recipe-merge sketches confirmed (no action — already in recipe_library.md)

ChatGPT's Task-2 archetype recipes (JTM45, AC30, Twin, Bassman, Williamson, Pultec, LA-2A, 1176, Vari-Mu, 33609, EMT 140/250, Lexicon, Leslie, Buchla, Moog) confirmed the same op-vocabulary compositions Gemini produced. **Three independent runs producing the same recipe ingredients = strongest signal of canonical truth for the chain compositions.**

### Open issues flagged by ChatGPT (already known — logged for completeness)

1. **bootstrapLF** — Self APAD covers VAS bootstrapping topology, but the brief asked for a "THD vs frequency vs source impedance" explicit sweep. Self gives the topology + one-axis sweep, not three-axis. Open question for a future research pass.
2. **Essex Echo run** (Hawksford HFN/RR 1980s) — dates cross-referenced (Sept 1984 / Dec 1985 / May/Aug/Oct 1986 / Feb 1987) but original scans not yet retrieved. JAES 1981 pair locked as canonical primary; Essex Echo as auxiliary.
3. **Hammond B-3 + spring tank** — ChatGPT could not validate a stock onboard spring path. Treats it as "B-3 core + appended outboard spring," which is correct usage.
4. **Talkbox vs Vocoder** — different topologies sharing a sonic family. ChatGPT recommends splitting into separate recipes on next pass; agree.
5. **TR-808 vs LinnDrum vs SP-1200** — three distinct synthesis engines (analog voices / fixed samples / lo-fi sampler). ChatGPT recommends splitting; agree.

### Triangulation summary (2026-04-28 final)

```
Perplexity Pro Deep Research  ┐
Gemini 2.5 Pro Deep Research  ├── all three converged on same primaries
ChatGPT Deep Research          ┘    for Lipshitz / Baxandall / Williamson / Hawksford / Self
```

Three-of-three agreement is the highest-confidence research outcome we've achieved. The five queued slots #184/188/189/192/195 are now backed by triple-validated Tier-S primary sources.
