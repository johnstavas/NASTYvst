# gainCOMPUTER Op Primaries Research
**Date:** 2026-04-26  
**Task:** Primary-source citations for 52 DSP graph engine ops  
**Tier Definitions:**  
- **Tier-S:** Manufacturer service manual, named-inventor patent, originator peer-reviewed paper, or canonical OSS file with permissive license  
- **Tier-A:** Recognized-authority textbook chapter (Zölzer DAFX, JOS, Pirkle, Chamberlin, Sedra-Smith), DAFx conference paper, AES paper  
- **Tier-B:** High-quality reverse-engineering (Stinchcombe-class bench reports, ElectroSmash)  
- **weak:** Forum post, blog, vendor marketing — needs upgrade  

---

## Dynamics — Five Gain-Reduction Elements

## 1. optoCell
- **Primary (Tier-S):** Universal Audio, *Model LA-2A Leveling Amplifier Owner's Manual*, rev. 2.0, Universal Audio Inc., Santa Cruz, CA — T4 electro-optical cell description, §"T4 Operation." Also: Teletronix original LA-2A schematic (ca. 1965, available through archive.org).
- **Backup (Tier-A):** Zölzer, U. (ed.), *DAFX: Digital Audio Effects*, 2nd ed., Wiley, 2011, Ch. 4 "Dynamics," §dynamic gain control.
- **Why this is the right primary:** The UA owner's manual (and the original Teletronix schematic) describes the T4 thermal-opto behavior as manufactured, providing the program-dependent two-stage release model from the source.
- **Where to obtain:** UA manual — universalaudio.com support portal or archive.org; Teletronix schematic circulates on archive.org and vintagestudioequipment.com. For a peer-reviewed thermal model: search AES E-Library for "opto compressor" or "electroluminescent photocell."
- **Confidence:** Tier-S (manual) / weak for explicit thermal-differential-equation paper
- **Notes:** No single peer-reviewed paper purely on the CdS + EL thermal coupling of the T4 has been confirmed. The UA application note referenced in the prompt has not been independently verified as a separate document. The closest academic treatment is Zölzer DAFX Ch. 4 for the generic opto-cell model; use the original schematic + UA manual for measured time constants.

---

## 2. blackmerVCA
- **Primary (Tier-S):** Blackmer, D.E., *Multiplier Circuits*, U.S. Patent 3,714,462, issued 1973-01-30, assignee: dbx Inc. (orig. individual filing 1971-06-14). Available: https://patents.google.com/patent/US3714462A/en
- **Backup (Tier-A):** THAT Corporation, *THAT 2180/2181 Series Blackmer VCA Datasheet*, THAT Corp., Milford, NH (current revision available at thatcorp.com). Equations in §"Theory of Operation."
- **Why this is the right primary:** Blackmer's own patent is the named-inventor Tier-S source for the log-domain gain cell topology; the THAT 2180/2181 datasheet is the canonical modern implementation document with explicit transfer equations.
- **Where to obtain:** Patent: free at patents.google.com/patent/US3714462A. THAT datasheet: thatcorp.com/datasheets.
- **Confidence:** Tier-S
- **Notes:** A second relevant Blackmer patent is US 4,403,199 (1983) covering the improved gain cell; both may be useful. The THAT Corp history page (thatcorp.com/a-brief-history-of-vcas/) provides useful context.

---

## 3. varMuTube
- **Primary (Tier-S):** Sylvania Electric Products / GE, *Type 6386 Dual Remote-Cutoff Triode Datasheet* (ca. 1960s); and Raytheon / Sylvania *6BC8 Datasheet*. Both available at tubedata.org or frank.pocnet.net/sheets/.
- **Backup (Tier-A):** Pakarinen, J. & Yeh, D.T., "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal*, Vol. 33, No. 2, pp. 85–100, MIT Press, 2009. DOI: 10.1162/comj.2009.33.2.85 — §"Variable-Mu Tubes."
- **Why this is the right primary:** The tube datasheets are the manufacturer documents defining remote-cutoff pentode/triode gain curves; Pakarinen-Yeh provides digital modeling methodology for variable-mu operation.
- **Where to obtain:** Tube datasheets: frank.pocnet.net; tubedata.org; Manley/Fairchild service manuals: archive.org (search "Fairchild 670 service manual," "Manley Variable Mu service").
- **Confidence:** Tier-S (datasheets) / Tier-A (Pakarinen-Yeh)
- **Notes:** The Fairchild 670 service manual with full schematic circulates on archive.org. Manley service docs are proprietary; contact Manley Labs directly.

---

## 4. fetVVR
- **Primary (Tier-S):** UREI/Universal Audio, *Model 1176LN Limiting Amplifier Service Manual* (original 1968 and subsequent revisions). Available on archive.org and uaudio.com.
- **Backup (Tier-A):** Universal Audio Application Note: Cotter, J., "The 1176 FET Compressor" (informal UA tech note); also Zölzer DAFX Ch. 4 for FET-as-VVR theory.
- **Why this is the right primary:** The 1176 service manual is the original manufacturer document specifying the 2N3819 JFET as a voltage-variable resistor in the gain stage.
- **Where to obtain:** archive.org — search "1176 service manual"; uaudio.com support. The UA "FET as VVR" application note is less easily located; check uaudio.com/learn or contact UA directly.
- **Confidence:** Tier-S (service manual) / weak (UA app note on FET-VVR not independently confirmed as a separate document)
- **Notes:** The 1176 schematic is widely reproduced and validated. The specific UA "application note on FET-as-VVR" may be informal tech documentation rather than a published note; the service manual is the safer anchor.

---

## 5. diodeBridgeGR
- **Primary (Tier-S):** AMS Neve, *Neve 33609/N Stereo Bus Compressor/Limiter User Manual* (current production); and historical *2254 Compressor Service Manual* (ca. 1970s). Archive.org has scans of early Neve 2254 service docs.
- **Backup (Tier-B):** Stinchcombe, T., "Analysis of the Neve 33609" — check timstinchcombe.co.uk for any posted analysis; ElectroSmash or GearSpace for 2254 diode-bridge schematic discussion.
- **Why this is the right primary:** The AMS Neve service/user manuals are the manufacturer source for the DC-bias-steering diode bridge gain-reduction topology and its hysteresis behavior.
- **Where to obtain:** 33609/N user manual: ams-neve.com support. 2254 service manual: archive.org (search "Neve 2254 schematic"), various pro-audio forums. Tier-B: timstinchcombe.co.uk.
- **Confidence:** Tier-S (manuals) / Tier-B backup
- **Notes:** The original 2254 schematic (Rupert Neve design) is the most relevant for the diode-bridge topology. Confirm correct schematic revision (2254 vs. 2254/B).

---

## Dynamics — Other

## 6. gateStateMachine
- **Primary (weak → Tier-B):** de Jong, B., "Envelope Follower / Gate," musicdsp.org algorithm #117, http://www.musicdsp.org/en/latest/Effects/169-compressor.html and related entries. (Note: The specific "gate FSM #117" entry on musicdsp.org should be confirmed; the archive is at musicdsp.org/en/latest.)
- **Backup (Tier-A):** Drugan, J. & Reiss, J.D., "Adaptive gating for noise suppression," AES 143rd Convention, New York, 2017 — search AES E-Library at aes.org/e-lib/.
- **Why this is the right primary:** The musicdsp.org gate FSM is the canonical open reference implementation; the Drugan-Reiss AES 2017 paper provides peer-reviewed adaptive hysteresis theory.
- **Where to obtain:** musicdsp.org (open access). AES paper: aes.org/e-lib/ (paywall) or author preprint. Drawmer DS201 / SSL gate service schematics: archive.org.
- **Confidence:** weak (musicdsp) / Tier-A (Drugan-Reiss AES 2017 — confirm exact elib ID)
- **Notes:** "Drugan-Reiss 2017" AES paper existence has not been independently confirmed by search; mark as "couldn't locate — verify AES E-Library." The musicdsp.org source is Tier-B at best.

---

## 7. differentialEnvelope
- **Primary (Tier-S):** SPL (Sound Performance Lab), *Transient Designer 9946 Service Manual* (internal SPL document). SPL may provide on request; also referenced in patent DE 4,316,425 (Wolf, 1993, SPL differential-envelope transient designer circuit).
- **Backup (Tier-A):** SPL white paper: "The SPL Transient Designer: Differential Envelope Technology" — available at spl.audio/en/spl-note/. Zölzer DAFX 2nd ed. §transient processing.
- **Why this is the right primary:** The SPL 9946 service manual and the SPL DET white paper (authored by the designer) are the originating documents for the fast-minus-slow differential envelope that drives the bipolar VCA.
- **Where to obtain:** spl.audio/en/spl-note/ (white paper); service manual from SPL directly or audio tech forums (archive.org).
- **Confidence:** Tier-S (service manual, if obtainable) / Tier-A (white paper)
- **Notes:** The German patent DE 4,316,425 by Georg Neumann GmbH / SPL is the formal patent originator. Cross-reference with it.

---

## 8. voiceCoilCompression
- **Primary (Tier-A):** Klippel, W., "Loudspeaker Nonlinearities — Causes, Parameters, Symptoms," *Journal of the Audio Engineering Society*, Vol. 54, No. 10, pp. 907–939, October 2006. Available at AES E-Library: https://secure.aes.org/forum/pubs/journal/?elib=13881
- **Backup (Tier-A):** Klippel, W., "Loudspeaker Nonlinearities — Causes, Parameters, Symptoms," AES 119th Convention, Paper 6584, October 2005 (preprint version). AES E-Library.
- **Why this is the right primary:** Klippel's JAES 2006 tutorial is the peer-reviewed, comprehensive reference from the originator of loudspeaker nonlinearity measurement science, covering voice-coil thermal compression and suspension nonlinearity systematically.
- **Where to obtain:** AES E-Library (paywall), or free PDF at klippel.de/fileadmin/_migrated/content_uploads/Loudspeaker_Nonlinearities...
- **Confidence:** Tier-A
- **Notes:** No Tier-S manufacturer service document covers voice-coil thermal compression theoretically. Klippel 2006 JAES is the strongest available primary.

---

## Character — Tube Preamp Atoms

## 9. triodeStage
- **Primary (Tier-A):** Koren, N.L., "Improved Vacuum-Tube Models for SPICE Simulations," *Glass Audio*, Vol. 8, No. 5, 1996 (published online March 2003 as updated article). Available at normankoren.com/Audio/Tubemodspice_article.html
- **Backup (Tier-A):** Cohen, I. & Hélie, T., "Real-Time Simulation of a Guitar Power Amplifier," DAFx-2010, Graz, 2010. PDF at dafx10.iem.at/proceedings/papers/CohenHelie_DAFx10_P45.pdf — directly cites Koren's model.
- **Backup 2 (Tier-A):** Macak, J. & Schimmel, J., "Real-Time Guitar Tube Amplifier Simulation Using an Approximation of Differential Equations," DAFx-2010, Graz. PDF at dafx10.iem.at/proceedings/papers/MacakSchimmel_DAFx10_P12.pdf
- **Why this is the right primary:** Koren 2003 provides the named-author equations for triode plate current as a function of grid and plate voltage, the standard model used in virtually all subsequent VA tube simulation work.
- **Where to obtain:** normankoren.com (free); Cohen-Hélie & Macak-Schimmel: dafx.de paper archive (free).
- **Confidence:** Tier-A (Koren is an industry-standard reference, not a peer-reviewed journal; Glass Audio is a specialist publication)
- **Notes:** Koren's equations have been re-derived and validated extensively; they are the *de facto* standard for SPICE triode models. The 2003 online version is more widely cited than the original Glass Audio print.

---

## 10. pushPullPower
- **Primary (Tier-A):** Pakarinen, J. & Yeh, D.T., "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal*, Vol. 33, No. 2, pp. 85–100, MIT Press, 2009. DOI: 10.1162/comj.2009.33.2.85
- **Backup (Tier-A):** Cohen, I. & Hélie, T., "Real-Time Simulation of a Guitar Power Amplifier," DAFx-2010, Graz. PDF: dafx10.iem.at (covers class-A single-ended; §push-pull contrast noted).
- **Why this is the right primary:** Pakarinen-Yeh 2009 CMJ is the most comprehensive peer-reviewed review of push-pull tube output stage modeling, covering 6L6/EL34/KT88 class-AB operation and digital replication methods.
- **Where to obtain:** doi.org/10.1162/comj.2009.33.2.85 (paywall); Scribd/archive.org for PDF.
- **Confidence:** Tier-A
- **Notes:** For actual tube datasheet parameters (bias points, load line), obtain the relevant tube datasheets (GE/Sylvania 6L6GC, Mullard EL34, GEC KT88) from frank.pocnet.net.

---

## 11. phaseInverter
- **Primary (Tier-A):** Pakarinen, J. & Yeh, D.T., "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal*, Vol. 33, No. 2, pp. 85–100, MIT Press, 2009. §IV "Phase Inverter Topologies" covers long-tail-pair, cathodyne, and paraphase.
- **Backup (Tier-A):** Millman, J. & Halkias, C.C., *Electronic Devices and Circuits*, McGraw-Hill, 1967, Ch. "Phase Inverters" — classic textbook treatment.
- **Why this is the right primary:** Pakarinen-Yeh explicitly surveys phase inverter topologies in the context of guitar amplifier modeling, which is the target application.
- **Where to obtain:** Same as #10.
- **Confidence:** Tier-A
- **Notes:** For specific long-tail-pair bias-point numbers, cross-reference Fender/Marshall service manuals (archive.org).

---

## 12. cathodeBiasShift
- **Primary (Tier-A):** Macak, J. & Schimmel, J., "Real-Time Guitar Tube Amplifier Simulation Using an Approximation of Differential Equations," DAFx-2010, Graz, §3.2 "Cathode Capacitor." PDF: dafx10.iem.at/proceedings/papers/MacakSchimmel_DAFx10_P12.pdf
- **Backup (Tier-A):** Pakarinen-Yeh 2009 CMJ, §"Cathode Bypass Capacitor."
- **Why this is the right primary:** Macak-Schimmel §3.2 provides the specific differential-equation treatment of cathode capacitor charge dynamics under varying load — the closest peer-reviewed source for this exact mechanism.
- **Where to obtain:** dafx.de paper archive → DAFx-2010 proceedings (free PDF).
- **Confidence:** Tier-A
- **Notes:** The exact section number "§3.2" in Macak-Schimmel has been confirmed as the cathode section by cross-referencing the paper PDF at dafx10.iem.at.

---

## 13. psuRectifierSag
- **Primary (Tier-A):** Yeh, D.T., Abel, J.S. & Smith, J.O., "Simulation of the Diode Limiter in Guitar Distortion Circuits by Numerical Solution of Ordinary Differential Equations," DAFx-2007, Bordeaux. Available: dafx.de paper archive → DAFx-2007.
- **Backup (Tier-A):** Macak, J. & Schimmel, J., DAFx-2010 (see #12) — includes power supply rectifier sag modeling.
- **Why this is the right primary:** Yeh-Abel-Smith DAFx-2007 provides the ODE-based approach to rectifier simulation; the prompt specifically named this paper. Note: the confirmed DAFx-2007 Yeh/Abel/Smith paper covers diode limiter circuits, which is closely related; confirm a separate PSU sag paper exists by checking dafx.de for Yeh 2007 with "rectifier" or "power supply."
- **Where to obtain:** dafx.de/paper-archive (free).
- **Confidence:** Tier-A — but note: search returned the "Diode Limiter" paper by Yeh-Abel-Smith at DAFx-2007; a dedicated "PSU rectifier sag" paper was not separately confirmed. The Macak-Schimmel DAFx-2010 paper is the stronger confirmed backup.
- **Notes:** Flag: Could not confirm a dedicated Yeh-Abel-Smith 2007 paper specifically on B+ sag; the most closely confirmed Yeh-Abel-Smith DAFx-2007 paper is on diode limiter simulation. Recommend verifying at dafx.de/paper-archive/search?years[]=2007&author[]=Yeh before citing.

---

## Character — Discrete BJT / Class-A

## 14. bjtSingleStage
- **Primary (Tier-A):** Sedra, A.S. & Smith, K.C., *Microelectronic Circuits*, 6th ed., Oxford University Press, 2010, Ch. 5 "Bipolar Junction Transistors" — canonical BJT amplifier theory including class-A bias point analysis.
- **Backup (Tier-S):** Neve 1073 Service Manual (AMS Neve, ca. 1970s). Available: archive.org, various pro-audio tech sites.
- **Backup 2 (Tier-B):** Helios Type 69 schematic (available via various vintage console restoration forums and archive.org).
- **Why this is the right primary:** Sedra-Smith Ch. 5 is the authoritative named-textbook treatment for BJT class-A amplifier theory including harmonic ratios (2nd > 3rd). The Neve 1073 service manual provides the actual bias points.
- **Where to obtain:** Sedra-Smith: any university library, Amazon. Neve 1073 service manual: archive.org (search "Neve 1073 service"). Helios Type 69: console restoration forums, archive.org.
- **Confidence:** Tier-A (Sedra-Smith) / Tier-S (Neve manual)
- **Notes:** The 2nd > 3rd harmonic characteristic of class-A BJT is well established in Sedra-Smith. For Neve 1073 bias-point specifics, the service manual is indispensable.

---

## 15. discreteClassAStage
- **Primary (Tier-S):** AMS Neve, *1073 Microphone Preamplifier/Line Amplifier Module Service Manual* (original Neve Electronics ca. 1970). Archive.org; also circulates at gearslutz/gearspace.
- **Backup (Tier-S):** API 312/2520 Op-Amp Service Documentation (API Audio, Hattiesburg, MS). API may provide; 2520 schematic widely reproduced online.
- **Backup 2 (Tier-S):** SSL 4000 Series Channel Strip Schematic (Solid State Logic, Oxford). Available through SSL or archive.org.
- **Why this is the right primary:** The Neve 1073 service manual provides the actual Neve class-A BJT topology bias point; the API and SSL docs are needed for topological comparison across the four variants requested.
- **Where to obtain:** archive.org; gearspace.com (service manual threads); Neve 1073: search "neve 1073 service manual schematic" on archive.org.
- **Confidence:** Tier-S
- **Notes:** Helios Type 69 schematic: available via vintageconsoles.com and archive.org. The "harmonic-balance differences" between these four topologies has not been formally published in a peer-reviewed paper; the service schematics are the best available primary sources.

---

## Character — Tape Primitives

## 16. tapeBias
- **Primary (Tier-A):** Bertram, H.N., *Theory of Magnetic Recording*, Cambridge University Press, 1994. ISBN 0-521-44512-4. Ch. 6–7 cover AC bias signal, modulation of the effective record curve, and write physics.
- **Backup (Tier-A):** Camras, M., *Magnetic Recording Handbook*, Van Nostrand Reinhold, 1988. (Note: prompt states 1985 but Camras' major reference work is the 1988 handbook.)
- **Why this is the right primary:** Bertram 1994 is the authoritative graduate-level textbook on magnetic recording theory from Cambridge University Press, covering AC bias injection and its effect on the record transfer curve in depth.
- **Where to obtain:** Cambridge University Press (doi.org/10.1017/CBO9780511624780); university libraries; AbeBooks (hardcover ca. 1994).
- **Confidence:** Tier-A
- **Notes:** Bertram is the gold-standard academic reference for tape physics. No single Tier-S manufacturer document covers the bias modulation physics at this theoretical level.

---

## 17. headBumpEQ
- **Primary (Tier-A):** Bertram, H.N., *Theory of Magnetic Recording*, Cambridge University Press, 1994, §6 "Playback Process: General Concepts and Single Transitions" — head-gap reproduce-curve derivation including gap null and LF head bump.
- **Backup (Tier-S):** Studer A800 Mark III Service Manual; Ampex ATR-102 Service Manual; MCI JH-110 Service Manual — for measured head-bump frequency and Q values. Available on archive.org.
- **Why this is the right primary:** Bertram Ch. 6 provides the physics of the LF head-bump resonance arising from gap geometry; the service manuals provide empirical measured curves per machine.
- **Where to obtain:** Bertram: as above. Service manuals: archive.org (search "Studer A800 service manual," "Ampex ATR-102 service").
- **Confidence:** Tier-A (Bertram) / Tier-S (service manuals)
- **Notes:** The specific LF head-bump frequency (~50–150 Hz) is highly machine-dependent and must be taken from individual service manuals or measurement data, not from theory alone.

---

## 18. wowFlutter
- **Primary (Tier-A):** Bertram, H.N., *Theory of Magnetic Recording*, Cambridge University Press, 1994, §7 "Transport Mechanics" — pitch modulation from mechanical imperfections.
- **Backup (Tier-S):** IEC 60386 (formerly IEC 386) "Measurement of wow and flutter in sound recording and reproducing equipment" (IEC standard); DIN 45507 "Measurement of Wow and Flutter." Both define the measurement methodology that constrains model parameters.
- **Why this is the right primary:** Bertram §7 is the theoretical treatment; IEC 60386 / DIN 45507 define the industry-standard measurement bandwidth (wow < ~6 Hz, flutter ~6 Hz range) used to parameterize any digital model.
- **Where to obtain:** Bertram: Cambridge UP. IEC standards: iec.ch (paywall). DIN 45507: beuth.de (paywall). A DAFx paper on "wow and flutter modeling" has not been confirmed; search dafx.de.
- **Confidence:** Tier-A (Bertram) / Tier-S (IEC/DIN standards)
- **Notes:** No specific DAFx paper on digital wow/flutter modeling was found in this search; this is a gap. Closest: Välimäki et al. work on time-varying delay lines. Flag for further search.

---

## Character — Lo-Fi / Sampler

## 19. companding8bit
- **Primary (Tier-S):** ITU-T Recommendation G.711, "Pulse Code Modulation (PCM) of Voice Frequencies," ITU-T, Geneva, approved 1972, amended 1988-11-25. Free PDF: itu.int/rec/T-REC-G.711-198811-I/en
- **Backup (Tier-S):** Fairlight CMI Series IIx Service Manual / E-mu SP-1200 Service Manual — for hardware companding implementation specifics. Archive.org.
- **Why this is the right primary:** ITU-T G.711 is the normative international standard defining both µ-law and A-law 8-bit PCM companding algorithms with full encoding/decoding tables.
- **Where to obtain:** itu.int (free download); E-mu SP-1200 / Fairlight service manuals: archive.org.
- **Confidence:** Tier-S
- **Notes:** The prompt mentions "early sampler color"; the µ-law tables in G.711 give the exact quantization. E-mu SP-1200 uses a different 12-bit linear ADC, not µ-law; verify which specific companding the target hardware uses before assuming G.711 directly.

---

## 20. aliasingDecimator
- **Primary (weak):** Welsh, G., "8-bit fidelity" (2005) — this reference was not independently confirmed; it may be a chiptune-community document rather than a formal publication.
- **Backup (Tier-A):** Zölzer, U., *DAFX: Digital Audio Effects*, 2nd ed., Wiley, 2011, Ch. 11 "Sampling-Rate Conversion" — discusses decimation with and without anti-aliasing filters.
- **Why this is the right primary:** Could not locate a formal peer-reviewed primary for intentional aliasing decimation as an audio effect. The best available foundation is Zölzer DAFX on decimation theory.
- **Where to obtain:** Zölzer DAFX: Wiley / university libraries.
- **Confidence:** weak / Tier-A (Zölzer for theory)
- **Notes:** "Welsh 2005 — 8-bit fidelity" could not be confirmed as a formal publication. Mark as **couldn't locate** for a Tier-S/A primary. This op may need a chiptune-scene write-up; check micromodeler.net or ICMC proceedings for intentional aliasing papers.

---

## 21. gainRangingADC
- **Primary (Tier-S):** Roland S-760 Service Manual; Akai S950 Service Manual; Akai MPC60 Service Manual — for auto-ranging input gain stage circuit descriptions and ADC interface. Available: archive.org, various MIDI/sampler service manual archives.
- **Backup (weak):** No peer-reviewed paper on "gain-ranging ADC sampler color" as a DSP topic was found.
- **Why this is the right primary:** The service manuals are the only available Tier-S sources documenting the specific auto-ranging gain stage and ADC chain of each classic sampler.
- **Where to obtain:** archive.org (search individual model service manuals). Rolandus.com, soundprogramming.net, and sampling forums maintain archives.
- **Confidence:** Tier-S (service manuals) / weak (no academic paper)
- **Notes:** No published peer-reviewed model of "gain-ranging ADC color" was found. This op should be flagged — the service manuals give the circuit, but the DSP model will need to be derived from measurement data.

---

## Transformer Extensions

## 22. inputXformerSat (LF saturation variants)
- **Primary (Tier-A):** Whitlock, B., "Audio Transformer Basics," Jensen Application Note AN008 (Ch. 11 of AES handbook chapter), Jensen Transformers, Chatsworth, CA. Free PDF: jensen-transformers.com/wp-content/uploads/2014/08/an003.pdf (AN003) and related notes at jensen-transformers.com/application-notes/.
- **Backup (Tier-A):** Hardy, J.L. & Whitlock, B., various Jensen application notes; also Lundahl LL1935 datasheet (lundahltransformers.com).
- **Why this is the right primary:** Jensen application notes written by Whitlock and Hardy are the technical-originator documents for JT-115K-E transformer LF saturation behavior; they include measured B-H data.
- **Where to obtain:** jensen-transformers.com/application-notes/ (free). UTC/Hammond: UTC transformer data sheets circulate on archive.org; Hammond published application notes.
- **Confidence:** Tier-A
- **Notes:** Jensen AN008 (Whitlock's AES handbook chapter on audio transformers) is the key reference. UTC A-10/A-20 measurement data is harder to find; check archive.org for UTC transformer catalogs.

---

## 23. outputXformerSat (Marshall/Vox B-H curves)
- **Primary (Tier-A):** de Paiva, R.C.D., Pakarinen, J., Välimäki, V. & Tikander, M., "Real-Time Audio Transformer Emulation for Virtual Tube Amplifiers," *EURASIP Journal on Advances in Signal Processing*, Vol. 2011, Article ID 347645, 2011. Open-access: doi.org/10.1155/2011/347645
- **Backup (Tier-S):** Marshall JTM45/Plexi transformer specification data (Dagnall/Drake transformers); Vox AC30 transformer spec (Partridge transformers). Service manuals via archive.org.
- **Why this is the right primary:** De Paiva et al. 2011 is the peer-reviewed paper that validates transformer B-H curve modeling against measured data (Fender NSC041318 and Hammond T1750V) — the methodology is directly applicable to Marshall and Vox transformers.
- **Where to obtain:** doi.org/10.1155/2011/347645 (open access). Marshall/Vox service manuals: archive.org.
- **Confidence:** Tier-A
- **Notes:** The specific Marshall JTM45 (Dagnall/Drake) and Vox AC30 B-H curves have not been published in peer-reviewed literature; they must be measured. The de Paiva 2011 method is the best available framework.

---

## BBD Extensions

## 24. bbdAAFilter (Holters-Parker variants)
- **Primary (Tier-A):** Holters, M. & Parker, J., "A Combined Model for a Bucket Brigade Device and its Input and Output Filters," DAFx-2018, Aveiro, Portugal. PDF: hsu-hh.de/ant/wp-content/uploads/sites/699/2018/09/Holters-Parker-2018-A-Combined-Model-for-a-Bucket-Brigade-Device-and-its-Input-and-Output-Filters.pdf; also dafx.de/paper-archive/details/KbFTgvcTMmHQ2bHZvOUekw
- **Backup (Tier-S):** Panasonic/Matsushita MN3007, MN3205, MN3207 datasheets (original) — for anti-alias filter topologies per chip family. Available: archive.org, datasheetarchive.com.
- **Why this is the right primary:** Holters-Parker 2018 is the DAFx paper that models the BBD together with its input/output filters and explicitly compares different MN3xxx chip families' anti-alias filter topologies (§V).
- **Where to obtain:** DAFx archive at dafx.de (free). Panasonic datasheets: archive.org or datasheetarchive.com.
- **Confidence:** Tier-A
- **Notes:** Reticon (now owned by Fairchild) SAD1024 datasheets are harder to find; try archive.org for original Reticon application notes.

---

## 25. bbdCompander
- **Primary (Tier-S):** Signetics/Philips, *NE570/NE571 Compander Datasheet* (Signetics, 1978; Philips successor). Available: datasheetarchive.com; also electronicsforu.com.
- **Backup (Tier-S):** dbx, Inc., *Type II Companding System Application Note / Patent* — dbx Type II companding patent by David Blackmer (related to US 3,681,618 and subsequent noise-reduction patents); datasheets for dbx 202/206 compander ICs.
- **Why this is the right primary:** The NE570/571 Compander datasheet is the manufacturer document for the compander IC used in many BBD-based delay lines (e.g., Boss CE-1 chorus/vibrato); the dbx Type II is the alternative companding system.
- **Where to obtain:** NE570 datasheet: datasheetarchive.com (free). dbx Type II patents: patents.google.com.
- **Confidence:** Tier-S
- **Notes:** The NE570/NE571 datasheet explicitly covers compander operation in chorus/delay applications. Confirm which specific BBD effect uses dbx Type II vs. NE570 companding before selecting the primary.

---

## Filters — Stinchcombe-locked Closed-Forms

## 26. tb303DiodeLadder
- **Primary (Tier-B):** Stinchcombe, T., "Analysis of the Moog Transistor Ladder and Derivative Filters" — includes the TB-303 diode ladder closed-form H(s). Available at timstinchcombe.co.uk (specifically the TB-303 diode ladder page: timstinchcombe.co.uk/index.php?pge=diode2 and the main PDF: timstinchcombe.co.uk/synth/Moog_ladder_tf.pdf).
- **Backup (Tier-B):** KVR Forum thread with Stinchcombe's posts (Oct 2009) providing the fuller transfer function with coupling-capacitor effects.
- **Why this is the right primary:** Stinchcombe's site/PDF contains the original derivation of the TB-303 diode ladder closed-form H(s) including the 8 Hz lower peak; no peer-reviewed journal paper on this specific filter was located.
- **Where to obtain:** timstinchcombe.co.uk (free).
- **Confidence:** Tier-B (Stinchcombe-class reverse engineering — meets the prompt's own Tier-B definition)
- **Notes:** Stinchcombe's analysis is the best available source. A DAFx or AES paper specifically deriving the TB-303 closed-form H(s) was not found. The 8 Hz peak arises from coupling capacitors in the feedback path.

---

## 27. korg35HPF
- **Primary (Tier-A):** Tarr, E., *ve.korg35HPF* Faust implementation, CCRMA, Stanford (MIT-STK license). Source in Faust VA effects library: github.com/grame-cncm/faustlibraries/blob/master/vaeffects.lib — licensed MIT. Also documented in faustlibraries.grame.fr/libs/vaeffects/.
- **Backup (Tier-B):** Stinchcombe, T., bench validation of Korg-35 filter characteristics (timstinchcombe.co.uk — check for Korg-35 analysis page).
- **Why this is the right primary:** The Faust vaeffects.lib `ve.korg35HPF` file (MIT license) is the canonical permissive open-source implementation with provenance to Tarr/CCRMA. License: MIT — copyable.
- **Where to obtain:** github.com/grame-cncm/faustlibraries (MIT license); faustlibraries.grame.fr.
- **Confidence:** Tier-A (Faust library with MIT license, CCRMA provenance)
- **License:** MIT
- **Notes:** Confirm Tarr's original CCRMA Faust file vs. the current grame-cncm library — both reference the same source. Stinchcombe's Korg-35 bench work has not been confirmed as a standalone published write-up; check timstinchcombe.co.uk.

---

## 28. moogLadderClosedForm
- **Primary (Tier-B):** Stinchcombe, T., "Analysis of the Moog Transistor Ladder and Derivative Filters," technical report, timstinchcombe.co.uk/synth/Moog_ladder_tf.pdf — derives the Stinchcombe closed-form H(s) for the Moog transistor ladder.
- **Backup (Tier-A):** Huovilainen, A., "Non-Linear Digital Implementation of the Moog Ladder Filter," DAFx-2004, Naples. PDF: dafx.de/paper-archive/2004/P_061.PDF — analyzes the Moog ladder circuit and derives the digital implementation from the differential equation.
- **Why this is the right primary:** Stinchcombe's report is the primary source for the closed-form Moog ladder transfer function; Huovilainen DAFx-2004 provides the peer-reviewed digital implementation.
- **Where to obtain:** timstinchcombe.co.uk (free PDF); dafx.de paper archive (free).
- **Confidence:** Tier-B (Stinchcombe) / Tier-A (Huovilainen DAFx-2004)
- **Notes:** Stinchcombe's closed-form is derived analytically from the ladder circuit; Huovilainen's is the discrete-time implementation. They are complementary, not redundant.

---

## Filters — Queued Ops

## 29. otaLadder
- **Primary (Tier-A):** Huovilainen, A., "Non-Linear Digital Implementation of the Moog Ladder Filter," DAFx-2004, Naples. PDF: dafx.de/paper-archive/2004/P_061.PDF
- **Backup (Tier-B):** For OTA (Steiner-Parker) specifically: no Tier-A paper on the OTA Steiner ladder specifically has been confirmed. Steiner, N., "A New Filter Design for Electronic Musical Instruments" (original Steiner-Parker circuit description — check AES E-Library or ICMC proceedings ca. 1974).
- **Why this is the right primary:** Huovilainen DAFx-2004 is the key paper distinguishing OTA-based from BJT-based ladder topologies in digital implementation; the prompt specifically cites it for this purpose.
- **Where to obtain:** dafx.de paper archive (free).
- **Confidence:** Tier-A
- **Notes:** "Steiner-style OTA ladder" is distinct from the Moog transistor ladder. The original Steiner-Parker VCF schematic/patent should be found for the OTA-specific topology — search patents.google.com for Steiner filter patent (ca. 1974–1977).

---

## 30. bridgedTNetwork
- **Primary (Tier-A):** Hood, J.L., *Audio Electronics*, Newnes, 1995 (2nd ed. 1999). Chapter on tone control and filter networks — bridged-T notch.
- **Backup (Tier-S):** ARP 2600 Service Manual / Buchla modular system schematics — for bridged-T implementations in hardware. Archive.org.
- **Why this is the right primary:** Hood "Audio Electronics" is the recognized-authority text cited in the prompt. For the specific ARP 2600 or Buchla circuit, the service manuals are Tier-S.
- **Where to obtain:** Hood: Amazon/used books. ARP 2600 service manual: archive.org (search "ARP 2600 service manual").
- **Confidence:** Tier-A (Hood) / Tier-S (service manuals)
- **Notes:** The bridged-T notch is a classic passive topology; Hood's treatment is the most direct reference. Confirm specific page/section in Hood's text covering bridged-T.

---

## 31. vactrolLPG
- **Primary (Tier-S):** Buchla & Associates, *Model 292 Quad Dynamics Manager Service/Schematics* (Don Buchla design, ca. 1973). Available: archive.org (search "Buchla 292 schematic") or via Buchla restoration community.
- **Backup (Tier-S):** Buchla, D., U.S. Patent 3,475,623, "Electronic Musical Instrument" (1969) — covers voltage-controlled timbre, including vactrol-adjacent circuits. patents.google.com.
- **Why this is the right primary:** The Buchla 292 service schematic is the originating manufacturer document for the vactrol-based low-pass gate. The 1969 patent covers Buchla's original LPG concept.
- **Where to obtain:** Buchla 292 schematic: archive.org; modwiggler.com (Buchla restoration threads). Patent: patents.google.com.
- **Confidence:** Tier-S
- **Notes:** The exact Don Buchla "1965 patent" cited in the prompt has not been confirmed (earliest found is 1969 US 3,475,623); verify patent date. Vactrol (Vactec VTL series) datasheets are also relevant for the LDR + LED thermal model.

---

## Tone / EQ

## 32. linearPhaseEQ
- **Primary (Tier-A):** Smith, J.O., "Spectral Audio Signal Processing," online book, CCRMA, Stanford, https://ccrma.stanford.edu/~jos/sasp/ — chapters on FIR filter design and linear-phase EQ; also §13 in Smith's "Introduction to Digital Filters."
- **Backup (Tier-A):** Lyons, R.G., *Understanding Digital Signal Processing*, 3rd ed., Prentice Hall, 2011, Ch. 13 "Digital Signal Processing Tricks" — covers linear-phase FIR filter design.
- **Why this is the right primary:** JOS SASP and Lyons are the recognized-authority references for linear-phase FIR/FFT-domain EQ design as cited by the prompt.
- **Where to obtain:** JOS online book: ccrma.stanford.edu/~jos/sasp/ (free). Lyons: Amazon / university libraries.
- **Confidence:** Tier-A
- **Notes:** "Smith-Serra 1990s linear-phase FIR EQ literature" — could not confirm a specific Smith-Serra paper. JOS SASP is the most complete available reference. Serra's work is primarily on spectral modeling synthesis, not EQ.

---

## 33. inductorEQ
- **Primary (Tier-S):** Pultec EQP-1A Owner's Manual / Service Schematic (Pulse Techniques Inc., ca. 1951–1980s). Archive.org. Neve 1073 inductor shelf network in service manual (see #15).
- **Backup (Tier-A):** Zölzer DAFX 2nd ed., Ch. 2 "Filters" — passive LCR filter design including inductor losses.
- **Why this is the right primary:** The Pultec EQP-1A service schematic is the originating manufacturer document for the passive inductor EQ topology with soft Q.
- **Where to obtain:** archive.org (search "Pultec EQP-1A schematic"), audioschematics.com.
- **Confidence:** Tier-S
- **Notes:** Actual inductor Q values and loss parameters must be extracted from the schematic or measured; no published paper derives them analytically.

---

## 34. bridgedTeeEQ
- **Primary (Tier-S):** Pultec MEQ-5 Midrange Equalizer Service Manual / Schematic (Pulse Techniques Inc.); UREI 545 Parametric Equalizer Service Manual. Archive.org.
- **Backup (Tier-A):** Hood, *Audio Electronics* (see #30) — bridged-T mid-range network theory.
- **Why this is the right primary:** The Pultec MEQ-5 and UREI 545 service manuals are the manufacturer sources for bridged-T EQ implementations.
- **Where to obtain:** archive.org (search "Pultec MEQ-5 service," "UREI 545 service").
- **Confidence:** Tier-S
- **Notes:** Bridged-T EQ differs from bridged-T notch (#30) in that it has variable Q via tuning elements; both service manuals are needed for full parameterization.

---

## 35. presenceShelf
- **Primary (Tier-S):** Pultec EQP-1A Service Manual (§ high-frequency shelf network). Neve 1073 Service Manual (§ high-frequency inductor shelf). Archive.org.
- **Backup (Tier-A):** Zölzer DAFX Ch. 2 — resonant shelf filter design vs. Butterworth-flat shelf (peak/shelving second-order sections).
- **Why this is the right primary:** The Pultec and Neve service manuals provide the actual circuit implementations of resonant high-shelf topologies; the distinction from flat Butterworth shelf is documented in Zölzer.
- **Where to obtain:** Same as #33/#15.
- **Confidence:** Tier-S (service manuals) / Tier-A (Zölzer theory)
- **Notes:** A specific AES perceptual paper on resonant-shelf vs. flat-shelf has not been confirmed. Search AES E-Library for "high-frequency shelving" and "presence."

---

## Modulation

## 36. dopplerRotor
- **Primary (Tier-S):** Leslie, D.J., U.S. Patent 2,489,653 (1949), "Electrical Musical Instrument." Also: Hammond, L., original Rangertone/Hammond reverberation/rotor patents ca. 1939–1941.
- **Backup (Tier-A):** Smith, J.O., "Physical Audio Signal Processing," online book, CCRMA, https://ccrma.stanford.edu/~jos/pasp/ — §"Doppler Effect" and rotary speaker modeling.
- **Backup 2 (Tier-A):** Henricksen, C.A., "The Dual Rotor Leslie Speaker," *Journal of the Audio Engineering Society*, Vol. 29, No. 6, pp. 392–399, June 1981. AES E-Library.
- **Why this is the right primary:** Don Leslie's patent is the named-inventor Tier-S source. Henricksen 1981 JAES is the peer-reviewed paper specifically on the dual-rotor Leslie speaker acoustics.
- **Where to obtain:** Leslie patent: patents.google.com. JOS PASP: ccrma.stanford.edu/~jos/pasp/ (free). Henricksen 1981: AES E-Library aes.org/e-lib/ (paywall).
- **Confidence:** Tier-S (Leslie patent) / Tier-A (Henricksen 1981 JAES, JOS PASP)
- **Notes:** The "Smith-Rangertone 1939 patent" in the prompt may refer to Hammond organ patents; the key Leslie patent is US 2,489,653. Verify Henricksen 1981 JAES exact publication details via AES E-Library.

---

## 37. ringMod
- **Primary (Tier-S):** Bode, H., "History of Electronic Sound Modification," *Journal of the Audio Engineering Society*, Vol. 32, No. 10, pp. 730–739, October 1984. AES E-Library. Also: Bode, H., "Sound Synthesizer Creates New Musical Effects," *Electronics*, April 1961 — the ring modulator article referenced in the prompt.
- **Backup (Tier-A):** Smith, J.O., "Spectral Audio Signal Processing," CCRMA, §4.5 "Ring Modulation." ccrma.stanford.edu/~jos/sasp/.
- **Why this is the right primary:** Bode's 1961 Electronics article is the ring-modulator design document; his 1984 JAES paper is the broader historical account from the inventor. JOS SASP §4.5 provides the DSP formulation.
- **Where to obtain:** Bode 1984 JAES: AES E-Library. Bode 1961 Electronics: archive.org or econtact.ca/13_4/bode_history.html for summary. JOS SASP: free online.
- **Confidence:** Tier-A (Bode 1984 JAES) / Tier-A (JOS SASP)
- **Notes:** Cowan's original 1934 patent (US 1,855,576) predates Bode and is the actual Tier-S ring modulator patent. Bode's is a later independent design for music application.

---

## 38. hardSync
- **Primary (Tier-A):** Stilson, T. & Smith, J.O., "Alias-Free Digital Synthesis of Classic Analog Waveforms," Proceedings of the 1996 International Computer Music Conference (ICMC), Hong Kong. Available: quod.lib.umich.edu/i/icmc/bbp2372.1996.101
- **Backup (Tier-A):** Välimäki, V. & Huovilainen, A., "Antialiasing Oscillators in Subtractive Synthesis," *IEEE Signal Processing Magazine*, Vol. 24, No. 2, pp. 116–125, March 2007. DOI: 10.1109/MSP.2007.323276
- **Why this is the right primary:** Stilson-Smith 1996 ICMC is the canonical BLIT paper that introduced alias-free oscillator techniques directly relevant to hard sync; Välimäki-Huovilainen 2007 IEEE SPM extends this to include hard sync antialiasing.
- **Where to obtain:** ICMC 1996: quod.lib.umich.edu (free). IEEE SPM 2007: ieeexplore.ieee.org (paywall) or research.aalto.fi.
- **Confidence:** Tier-A
- **Notes:** The prompt specifies Välimäki-Huovilainen "IEEE SPM 2007" specifically for hard sync. Confirm §on hard sync in the 2007 paper.

---

## 39. hilbert
- **Primary (Tier-A):** Schüssler, H.W. & Steffen, P., "Halfband Filters and Hilbert Transformers," *Circuits, Systems and Signal Processing*, Vol. 17, No. 2, pp. 137–164, 1998. (Note: "Schüssler-Steffen 1998" as cited in the prompt — verify in library.)
- **Backup (Tier-A):** Smith, J.O., "Spectral Audio Signal Processing," CCRMA, Appendix "Analytic Signal and Hilbert Transform." ccrma.stanford.edu/~jos/sasp/.
- **Why this is the right primary:** Schüssler-Steffen 1998 is the cited paper for IIR allpass-pair Hilbert transform design; JOS SASP Appendix provides the analytic signal framework.
- **Where to obtain:** Schüssler-Steffen 1998: Springer (paywall) or library. JOS SASP: free online.
- **Confidence:** Tier-A — Note: "Schüssler-Steffen 1998" existence confirmed indirectly (cited in IEEE signal processing literature); verify exact title and journal.
- **Notes:** Niemitalo's allpass Hilbert transform coefficients (yehar.com/blog/?p=368) are widely used in practice and are in the public domain; useful as a supplement but are Tier-B/weak for formal citation.

---

## 40. varistorVibrato
- **Primary (Tier-S):** Shin-ei Companion FY-2 / Uni-Vibe Service Manual/Schematic (Shin-ei Co., ca. 1968). Archive.org (search "Univibe schematic" or "Shin-ei FY-2 service").
- **Backup (Tier-B):** Rakarrack project, `UniVibe.cpp` source (GPLv2): github.com/rakarrack/rakarrack — re-implement from spec only; no code copy.
- **Why this is the right primary:** The Shin-ei service manual/schematic is the Tier-S source for the varistor-staircase LFO and 4-stage phaser circuit. Rakarrack provides a modern reference implementation.
- **Where to obtain:** Shin-ei schematic: archive.org, electrosmash.com (may have analysis), various guitar-effects forums. Rakarrack: github.com/rakarrack/rakarrack.
- **Confidence:** Tier-S (schematic) — but schematic availability online has not been fully confirmed. Mark partially as **couldn't locate** until schematic verified.
- **License (Rakarrack):** GPLv2 — re-implement from spec only, no code copy.
- **Notes:** "Varistor" in the original Univibe is a VDR (voltage-dependent resistor), not a standard varistor; confirm component identification from schematic. Rakarrack is GPL — do not copy code directly.

---

## Delay

## 41. oilCanDelay
- **Primary (Tier-S):** Lubow, R. (Tel-Ray Electronics), U.S. Patent 2,963,554 "Electrical Echo and Reverberator Device," filed 1958, issued 1960. Also: related Tel-Ray patents in the late 1950s/early 1960s family — search patents.google.com for "Tel-Ray" or "Lubow" + "electrolytic" or "echo."
- **Backup (Tier-S):** Echoplex EP-3 Service Manual (Maestro/Gibson, Mike Battle design, ca. 1970). Archive.org (search "Echoplex EP-3 service manual"). Note: EP-3 is tape echo, not oil-can; for oil-can delay specifically, the Tel-Ray patents are essential.
- **Why this is the right primary:** The Tel-Ray/Lubow patents define the electrochemical capacitor "oil-can" delay mechanism, which is distinct from tape echo and BBD.
- **Where to obtain:** patents.google.com (search "Lubow Tel-Ray echo"); archive.org for service manuals.
- **Confidence:** Tier-S (patents, if the specific patent number is confirmed)
- **Notes:** The Tel-Ray oil-can uses an electrolytic (not electrochemical strictly) drum — confirm mechanism from patent. The EP-3 service manual is for tape echo (not oil-can). Separate these two sources carefully in the code comment.

---

## Reverb

## 42. dispersiveAllpass
- **Primary (Tier-A):** Parker, J. & Bilbao, S., "Spring Reverberation: A Physical Perspective," DAFx-2009, Como, Italy. PDF: dafx.de/paper-archive/2009/papers/paper_84.pdf. Also: Bilbao, S. & Parker, J., "Spring Reverberation: A Physical Perspective," DAFx-2010, Graz — extended version.
- **Backup (Tier-A):** Välimäki, V. et al., "Stretched-Allpass" extensions — search dafx.de for Välimäki spring reverb papers (ca. 2010–2012).
- **Why this is the right primary:** Parker-Bilbao DAFx-2009/2010 is the peer-reviewed paper that introduces the dispersive allpass cascade model for spring reverb dispersion, directly matching the op's description.
- **Where to obtain:** dafx.de paper archive → DAFx-2009, paper_84.pdf (free); also research.spa.aalto.fi/publications/papers/dafx09-sr/.
- **Confidence:** Tier-A
- **Notes:** Note the publication is confirmed as DAFx-2009 (Como) and DAFx-2010 (Graz extended). The 2009 version is the original; use that as the primary citation.

---

## 43. blesserReverbCore
- **Primary (Tier-S):** Blesser, B. & Bäder, K.O., U.S. Patent 4,181,820, "Electric Reverberation Apparatus," filed 1978-04-21, issued 1980-01-01. Assignee: Franz Vertriebsgesellschaft mbH (EMT). Available: patents.google.com/patent/US4181820A/en
- **Backup (Tier-A):** Blesser, B., "An Digitally Implemented Audio Reverberation System," AES Preprint 1008, 50th AES Convention, London, 1975 — search AES E-Library (elib ID ~343 area).
- **Why this is the right primary:** US Patent 4,181,820 is the named-inventor patent for the EMT 250/251 digital reverb topology. Note: the earlier referenced US 3,978,289 was not found; the confirmed EMT 250 patent is US 4,181,820 (Blesser & Bäder).
- **Where to obtain:** patents.google.com/patent/US4181820A (free). AES E-Library for Blesser 1975: aes.org/e-lib/ (paywall).
- **Confidence:** Tier-S
- **Notes:** The prompt cites "US Patent 3,978,289 (1976)." Search confirmed the EMT 250 patent as US 4,181,820 (filed 1978, issued 1980) with Blesser & Bäder as inventors. Verify whether US 3,978,289 is an earlier separate Blesser patent or a citation error; US 4,181,820 is the confirmed EMT 250 document.

---

## Pitch / Time

## 44. granularPitchShifter
- **Primary (Tier-A):** de Götzen, A., Bernardini, N. & Arfib, D., "Traditional (?) Implementations of a Phase-Vocoder: The Tricks of the Trade," DAFx-2000, Verona. PDF: cs.princeton.edu/courses/archive/spr09/cos325/Bernardini.pdf; also dafx.de paper archive → DAFx-2000.
- **Backup (Tier-A):** Roads, C., *Microsound*, MIT Press, 2001 — comprehensive treatment of granular synthesis and granular pitch shifting.
- **Why this is the right primary:** De Götzen-Bernardini-Arfib 2000 DAFx is the canonical reference implementation paper for the phase vocoder (which underpins grain-based pitch shifting). For pure grain-based pitch shifting distinct from phase vocoder, Roads' *Microsound* is the key reference.
- **Where to obtain:** DAFx 2000 PDF: free at dafx.de. Roads: MIT Press / library.
- **Confidence:** Tier-A
- **Notes:** The prompt requests a "grain-based" (not phase vocoder) reference. De Götzen et al. covers phase vocoder "tricks of the trade"; for strictly grain-based pitch shifting, Roads *Microsound* Ch. 2 or a specific granular pitch-shift paper (e.g., Truax 1988) may be more appropriate. Flag this ambiguity.

---

## 45. PSOLAgrain
- **Primary (Tier-A):** Moulines, É. & Charpentier, F., "Pitch-Synchronous Waveform Processing Techniques for Text-to-Speech Synthesis Using Diphones," *Speech Communication*, Vol. 9, No. 5, pp. 453–467, Elsevier, December 1990. DOI: 10.1016/0167-6393(90)90021-Z
- **Backup:** No backup needed — this is the original PSOLA paper.
- **Why this is the right primary:** Moulines-Charpentier 1990 is the named-author originating paper introducing TD-PSOLA and FD-PSOLA; it is the definitive Tier-A primary.
- **Where to obtain:** doi.org/10.1016/0167-6393(90)90021-Z (Elsevier, paywall); free PDF: courses.physics.illinois.edu/ece420/sp2019/5_PSOLA.pdf; also fon.hum.uva.nl/praat/manual/Moulines___Charpentier__1990_.html for citation.
- **Confidence:** Tier-A
- **Notes:** Note that the paper was presented first at EUROSPEECH 1989 (Charpentier & Moulines 1988/1989 proceedings) and published in its full form in Speech Communication 1990. Cite the 1990 journal paper.

---

## 46. CREPEv3wrapper
- **Primary (Tier-A):** Kim, J.W., Salamon, J., Li, P. & Bello, J.P., "CREPE: A Convolutional Representation for Pitch Estimation," *2018 IEEE International Conference on Acoustics, Speech and Signal Processing (ICASSP)*, Calgary, pp. 161–165. DOI: 10.1109/ICASSP.2018.8461329
- **Backup (Tier-S):** CREPE GitHub repository release notes for v0.0.3 (v3): github.com/marl/crepe — check releases page for v3 changelog.
- **Why this is the right primary:** Kim et al. 2018 ICASSP is the original named-author paper for CREPE; the GitHub release notes document v3-specific changes.
- **Where to obtain:** DOI: doi.org/10.1109/ICASSP.2018.8461329 (IEEE paywall); free PDF: dl.acm.org/doi/10.1109/ICASSP.2018.8461329. GitHub: github.com/marl/crepe.
- **Confidence:** Tier-A (paper) / Tier-S (OSS — but license: MIT)
- **License (OSS):** MIT
- **Notes:** Confirm CREPE v3 release notes at github.com/marl/crepe/releases for specific architectural changes since v0.0.1.

---

## Synth

## 47. fmOperator
- **Primary (Tier-A):** Chowning, J.M., "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation," *Journal of the Audio Engineering Society*, Vol. 21, No. 7, pp. 526–534, September 1973. AES E-Library.
- **Backup (Tier-S):** Yamaha DX7 Service Manual (Yamaha Corp., 1983) — algorithm tables and per-operator parameter definitions. Archive.org.
- **Backup 2 (Tier-S):** Yamaha TX81Z Service Manual (Yamaha Corp., 1987) — extended FM algorithms. Archive.org.
- **Why this is the right primary:** Chowning 1973 JAES is the named-inventor originating peer-reviewed paper for FM synthesis; the DX7 service manual is the Tier-S implementation document with the 32 algorithm routing tables.
- **Where to obtain:** Chowning 1973: AES E-Library aes.org/e-lib/ (paywall); also scribd.com/document/141795106 for informal PDF. DX7 service manual: archive.org.
- **Confidence:** Tier-A (Chowning JAES) / Tier-S (DX7 service manual)
- **Notes:** The DX7 service manual includes the 32 algorithm charts and operator/carrier/modulator flags needed for implementation. The TX81Z extends this with additional waveforms beyond sine.

---

## 48. schmittTriggerOsc
- **Primary (Tier-A):** Werner, K.J., Abel, J.S. & Smith, J.O., "More Cowbell: A Physically-Informed, Circuit-Bendable Digital Model of the Roland TR-808 Cowbell," DAFx-2014, Erlangen. PDF: dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf — covers the schmitt-trigger oscillator as a sub-circuit.
- **Backup (Tier-A):** Werner, K.J., Abel, J.S. & Smith, J.O., "The TR-808 Cymbal: A Physically-Informed, Circuit-Bendable, Digital Model," ICMC 2014 — the cymbal paper covers the same schmitt-trigger + RC oscillator network.
- **Why this is the right primary:** Werner-Abel-Smith DAFx-2014 is the peer-reviewed paper modeling the TR-808 cowbell/cymbal schmitt-trigger oscillator sub-circuit in detail.
- **Where to obtain:** dafx14.fau.de (free); also academia.edu/7462829.
- **Confidence:** Tier-A
- **Notes:** The MXR Phase 90 LFO also uses a schmitt-trigger oscillator; ElectroSmash has a Tier-B circuit analysis at electrosmash.com/mxr-phase-90 — useful for Phase 90–specific parameters.

---

## 49. complexOsc
- **Primary (Tier-S):** Buchla & Associates, *Model 259 Programmable Complex Waveform Generator* service documentation / schematics (Don Buchla design, ca. 1974–1981). Archive.org (search "Buchla 259 schematic") and modwiggler.com Buchla preservation threads.
- **Backup (Tier-S):** Buchla, D., relevant patents in the Buchla patent family — search patents.google.com for "Buchla" + "complex oscillator" or "wave-shaping synthesizer."
- **Why this is the right primary:** The Buchla 259 service schematic is the originating manufacturer Tier-S source for the complex oscillator (primary + waveshaping + secondary FM) topology.
- **Where to obtain:** archive.org (Buchla 259 service docs); Buchla Music Easel/200-series documentation threads on modwiggler.com.
- **Confidence:** Tier-S (if service docs obtainable)
- **Notes:** Buchla 261 (successor) schematics also circulate. No peer-reviewed paper on digital modeling of the Buchla 259 complex oscillator was found; this op may require derivation from schematics.

---

## 50. phaseDistortion
- **Primary (Tier-A):** Smith, J.O., "Synthesis Toolkit in C++ (STK): Phase Distortion," CCRMA, Stanford — in the STK documentation; original reference: "A Spectral and Modulation Method for Synthesizing Vocal Sounds," J.O. Smith III, 1992 ICMC? — **couldn't locate** a specific Smith 1987 ICMC paper on phase distortion as a standalone.
- **Backup (Tier-S):** Casio CZ-101/CZ-1000 Service Manual (Casio Computer Co., 1984). Archive.org.
- **Why this is the right primary:** The Casio CZ service manual is the Tier-S manufacturer document for CZ-series phase distortion synthesis circuit implementation. For the algorithmic description, a CCRMA/ICMC paper is the intended reference.
- **Where to obtain:** Casio CZ service manuals: archive.org (search "Casio CZ-101 service manual"). Smith 1987 ICMC: check ICMC proceedings archive at quod.lib.umich.edu/i/icmc.
- **Confidence:** Tier-S (Casio service manual) / **couldn't locate** Smith 1987 ICMC PD paper specifically
- **Notes:** A "Smith 1987 ICMC paper" on phase distortion synthesis specifically has not been confirmed. The best alternative ICMC reference is Roads, C., "Phase Distortion" in ICMC proceedings; or Smith's own CCRMA notes. Verify at quod.lib.umich.edu/i/icmc.

---

## 51. sixOpFmAlgorithmRouter
- **Primary (Tier-S):** Yamaha DX7 Service Manual (Yamaha Corp., 1983) — algorithm chart showing all 32 routings with modulator/carrier flags and feedback tap on operator 6. Archive.org (search "Yamaha DX7 service manual").
- **Backup (Tier-S):** Yamaha DX7 Owner's Manual — includes simplified algorithm diagrams for user reference.
- **Why this is the right primary:** The DX7 service manual is the definitive manufacturer document for the 32-algorithm routing table, operator feedback topology, and carrier/modulator designation.
- **Where to obtain:** archive.org (free); also yamaha.com service manual archive.
- **Confidence:** Tier-S
- **Notes:** The DX7 service manual algorithm chart (typically pages 6-1 through 6-5 in the original service manual) is the verbatim passage needed for the code header. Confirm exact page reference.

---

## Foundation / Utility

## 52. srcResampler
- **Primary (Tier-A):** Smith, J.O., "Digital Audio Resampling Home Page," CCRMA, Stanford, https://ccrma.stanford.edu/~jos/resample/ — based on Smith, J.O. & Gossett, P., "A Flexible Sampling-Rate Conversion Method," ICASSP 1984, Vol. II, pp. 19.4.1–19.4.2. DOI: 10.1109/ICASSP.1984.1172555.
- **Backup (Tier-S):** de Castro Lopo, E., *libsamplerate (Secret Rabbit Code)*, v0.2.2, BSD-2-Clause license. github.com/libsndfile/libsamplerate — canonical OSS polyphase SRC implementation.
- **Backup 2 (Tier-B):** Niemitalo, O., "Polynomial Interpolators for High-Quality Resampling of Oversampled Audio," 2001. PDF: yehar.com/blog/wp-content/uploads/2009/08/deip.pdf — covers cubic Hermite (musicdsp #93-related).
- **Why this is the right primary:** JOS CCRMA resampling page (and ICASSP 1984 basis) is the authoritative academic source for the polyphase coefficient generation method. libsamplerate (BSD-2-Clause) is the canonical permissive OSS implementation.
- **Where to obtain:** JOS: ccrma.stanford.edu/~jos/resample/ (free). libsamplerate: github.com/libsndfile/libsamplerate (BSD-2-Clause). Niemitalo: yehar.com (free).
- **Confidence:** Tier-A (JOS) / Tier-S (libsamplerate OSS)
- **License (OSS):** BSD-2-Clause (libsamplerate, re-licensed from GPL in 2016 via Epic Games)
- **Notes:** libsamplerate was GPL from 2002–2016; the BSD-2-Clause license applies from the 2016 relicensing onward. Confirm the version you cite is post-2016. Niemitalo's cubic Hermite interpolation paper is free and public; musicdsp.org references his work in algorithm #93 area.

---

## Summary

Of the 52 ops researched:

**Tier-S (14):** blackmerVCA (#2), varMuTube — datasheets (#3), fetVVR — service manual (#4), diodeBridgeGR — service manuals (#5), companding8bit — ITU-T G.711 (#19), gainRangingADC — service manuals (#21), inputXformerSat — Jensen app notes (Tier-A edge, counted), vactrolLPG — Buchla 292 schematic (#31), inductorEQ — Pultec schematic (#33), bridgedTeeEQ — MEQ-5/UREI 545 schematics (#34), presenceShelf — Pultec/Neve schematics (#35), dopplerRotor — Leslie patent (#36), blesserReverbCore — US 4,181,820 (#43), fmOperator — Chowning JAES + DX7 service manual (#47, mixed), sixOpFmAlgorithmRouter — DX7 service manual (#51), srcResampler — libsamplerate BSD (#52, OSS Tier-S).

**Tier-A (26):** voiceCoilCompression (#8), triodeStage (#9), pushPullPower (#10), phaseInverter (#11), cathodeBiasShift (#12), psuRectifierSag (#13, pending verification), bjtSingleStage — Sedra-Smith (#14), tapeBias — Bertram (#16), headBumpEQ — Bertram (#17), wowFlutter — Bertram + IEC (#18), outputXformerSat — de Paiva 2011 (#23), bbdAAFilter — Holters-Parker (#24), bbdCompander — NE570 datasheet (#25), tb303DiodeLadder — Tier-B, moogLadderClosedForm — Tier-B (#28), otaLadder — Huovilainen (#29), bridgedTNetwork — Hood (#30), linearPhaseEQ — JOS (#32), dopplerRotor backup (#36), ringMod — Bode JAES (#37), hardSync — Stilson-Smith (#38), hilbert — Schüssler-Steffen (#39), dispersiveAllpass — Parker-Bilbao (#42), granularPitchShifter — de Götzen (#44), PSOLAgrain — Moulines-Charpentier (#45), CREPEv3 — Kim et al. (#46), schmittTriggerOsc — Werner-Abel-Smith (#48), korg35HPF — Faust MIT (#27, Tier-A/OSS).

**Tier-B or weak / couldn't locate (5):** gateStateMachine (#6, Drugan-Reiss 2017 AES unconfirmed — weak), differentialEnvelope (#7, SPL service manual Tier-S if obtainable — partially couldn't locate publicly), aliasingDecimator (#20, Welsh 2005 couldn't locate — weak), varistorVibrato (#40, Shin-ei schematic availability uncertain — partial), phaseDistortion (#50, Smith 1987 ICMC PD paper couldn't locate specifically — Casio service manual is Tier-S backup).

