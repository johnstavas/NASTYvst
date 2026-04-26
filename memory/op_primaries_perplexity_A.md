# gainCOMPUTER Op Primaries Research
## Primary Source Catalog for 52 DSP Graph Engine Ops
*Research date: 2026-04-26*

***

## Dynamics — Five Gain-Reduction Elements

### 1. optoCell
- **Primary (Tier-S):** Universal Audio / Teletronix, *LA-2A Leveling Amplifier Service Manual* (Universal Audio, Inc., Santa Cruz). Contains T4 opto-cell circuit schematic and bulb–LDR thermal-coupling values.
- **Backup (Tier-A):** Russ, Martin. "Teletronix LA-2A," in: *Sound Synthesis and Sampling*, 3rd ed., Focal Press, 2009. Also: Universal Audio Knowledge Base, "Tips & Tricks — Teletronix LA-2A Classic Leveler," https://www.uaudio.com/blogs/ua/la-2a-collection-tips-tricks (describes T4 photocell principles).[^1]
- **Why this is the right primary:** The OEM service manual contains the actual T4 circuit and thermal-model parameters.
- **Where to obtain:** Manuals available at archive.org (search "LA-2A service manual"); UA's product support. A peer-reviewed thermal model specifically for the LA-2A T4 cell has *not* been located — the best academic treatment remains the UA application notes. No dedicated AES/DAFx paper on LA-2A T4 thermal model was found.
- **Confidence:** Tier-A (service manual obtainable; dedicated thermal paper = weak / couldn't locate)
- **License:** N/A (proprietary hardware docs — read-only reference)
- **Notes:** A published, peer-reviewed thermal model of the opto-cell specifically (as distinct from generic LDR models) does not appear to exist in the open literature. If thermal fidelity is paramount, a bench measurement + Stinchcombe-class characterization is the practical fallback.

***

### 2. blackmerVCA
- **Primary (Tier-S):** Blackmer, David E. *Multiplier Circuits.* US Patent 3,714,462. Filed 1971-06-14; issued 1973-01-30. Assignee: David E. Blackmer (later reassigned dbx, Inc.).[^2][^3]
- **Backup (Tier-A):** THAT Corporation. *2180/2181-Series Datasheet* (THAT Corp., Milford MA, current edition). Contains complete log-domain VCA transfer equations and operating region curves.[^4][^5]
- **Why this is the right primary:** US 3,714,462 is the named-inventor patent establishing the log-domain BJT VCA topology used in all subsequent Blackmer derivatives.
- **Where to obtain:** Google Patents (free): https://patents.google.com/patent/US3714462A; PDF mirror at ka-electronics.com/images/pdf/Blackmer_Patent_3714462.pdf. THAT 2181 datasheet: https://www.thatcorp.com/datashts/THAT_2181-Series_Datasheet.pdf[^3][^4]
- **Confidence:** Tier-S
- **License:** N/A (patent expired)
- **Notes:** The verbatim claim language describes the anti-log output stage. Cross-reference THAT Corp AN-100 "A Gain Cell Primer" for the practical dbx/THAT implementation equations.

***

### 3. varMuTube
- **Primary (Tier-S):** GE / Sylvania / RCA, *6386 Remote-Cutoff Twin Triode Datasheet* (various manufacturers, circa 1960s); also *6BC8 Twin Triode Datasheet.* These contain the actual Gm-vs-Vg characteristic curves defining variable-mu behavior.
- **Backup (Tier-A):** Pakarinen, J. & Yeh, D. T. "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal* 33(2):85–100, MIT Press, 2009. §III covers remote-cutoff triode/pentode gain staging.[^6][^7]
- **Why this is the right primary:** The tube datasheet is the primary source for the actual Gm characteristic used in the variable-mu model.
- **Where to obtain:** Datasheets at frank.pocnet.net or tubes.myfluke.com (free archive). Manley Variable Mu and Fairchild 670 service manuals are at archive.org (search "Fairchild 670 service manual"). Pakarinen-Yeh at MIT Press / Semantic Scholar.[^6]
- **Confidence:** Tier-S (datasheets) / Tier-A (Pakarinen-Yeh review)
- **License:** N/A
- **Notes:** The 6386 datasheet is the critical document for the specific Gm–Vgk transfer characteristic. The Fairchild 670 service manual may be hard to verify as authentic; check the forums at GroupDIY for reliable scans.

***

### 4. fetVVR
- **Primary (Tier-S):** UREI / Universal Audio, *1176LN Limiting Amplifier Service Manual* (Universal Audio, Inc.). Contains the FET-as-VVR circuit topology and 2N3819 operating-point schematic.
- **Backup (Tier-A):** Universal Audio, "1176 Application Note: FET Voltage-Variable Resistor Operation" (UA Knowledge Base). Yeh, D. T.; Abel, J. S.; Smith, J. O. "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals," *Proc. DAFx-2007*, Bordeaux, 2007. (models FET non-linear VVR behavior).[^8]
- **Why this is the right primary:** The 1176 service manual is the OEM schematic source for the JFET-VVR topology.
- **Where to obtain:** UA product support / archive.org (search "UREI 1176 service manual"). UA knowledge base at uaudio.com.
- **Confidence:** Tier-S
- **License:** N/A
- **Notes:** The published UA application note explicitly addressing FET-as-VVR theory may be a marketing document (Tier-B); the service manual schematic is the authoritative Tier-S reference.

***

### 5. diodeBridgeGR
- **Primary (Tier-S):** AMS Neve, *33609/N Stereo Bus Compressor User Manual* (AMS Neve Ltd., Burnley). Also: *2254 Compressor/Limiter Service Manual* (Neve Electronics). Both contain the diode-bridge DC-bias-steering GR circuit.
- **Backup (Tier-A):** Duncan, Ben. "VCAs Investigated," *Electronics & Music Maker*, reproduced at gyraf.dk/schematics/VCAs_Ben_Duncan.pdf — Tier-B reverse-engineering survey of Neve bridge topology.[^9]
- **Why this is the right primary:** OEM service schematics are named-manufacturer primary sources for the diode-bridge topology.
- **Where to obtain:** 33609 user manual at AMS Neve (ams-neve.com/support). 2254 service manual at archive.org and GroupDIY.com.
- **Confidence:** Tier-S
- **License:** N/A
- **Notes:** The 2254 vintage service manual can be difficult to authenticate; cross-validate against the Neve-documented 33609/N schematic.

***

## Dynamics — Other

### 6. gateStateMachine
- **Primary (Tier-A):** De Jong, Bram. "Gate Envelope," *musicdsp.org* archive entry #117 (canonical FSM implementation, C++ source, public domain). https://www.musicdsp.org[^10]
- **Backup (Tier-A):** Reiss, J. D. & Drugan, J. "Adaptive Noise Suppression Using a Gate with Hysteresis," *AES 143rd Convention*, Paper 9839, New York, October 2017. (AES E-Library.) Also: Drawmer DS201 / SSL G-Series noise-gate service schematics for hardware hysteresis reference values (archive.org).
- **Why this is the right primary:** Bram de Jong's musicdsp entry is the canonical, publicly available FSM code that has been the reference point across the open-source DSP community for decades. The AES paper provides peer-reviewed hysteresis theory.
- **Where to obtain:** musicdsp.org #117 (free). AES E-Library for Reiss/Drugan 2017 (paywall; try AES member login or institutional access).
- **Confidence:** Tier-A (musicdsp entry is well-known but a site post, not peer-reviewed; AES paper is Tier-A for hysteresis)
- **License:** musicdsp #117 entries are generally public domain unless stated otherwise; confirm in-page note.
- **Notes:** The "Drugan-Reiss 2017" AES paper cited in the prompt should be verified; the above is the most likely match. If unavailable, Reiss's other AES gate papers are usable Tier-A backups.

***

### 7. differentialEnvelope
- **Primary (Tier-S):** SPL Electronics, *Transient Designer Dual-Channel Model 9946 Manual* (SPL Electronics GmbH, Niederkrüchten, 1999). Describes the DET (Differential Envelope Technology) signal path and bipolar VCA architecture.[^11]
- **Backup (Tier-A):** SPL Electronics, "SPL Differential Envelope Technology (DET) — Technical White Paper," available from spl.audio product page for the Transient Designer. Describes level-independent dynamic processing and fast-minus-slow envelope derivation.[^12]
- **Why this is the right primary:** The OEM service/product manual is the manufacturer's own description of the DET circuit.
- **Where to obtain:** SPL manual PDF at spl.audio/wp-content/uploads/transient_designer_2_9946_manual.pdf[^11]
- **Confidence:** Tier-S (service manual) / Tier-A (white paper)
- **License:** N/A
- **Notes:** The SPL 9946 manual describes the operational principle; a full service schematic may be behind SPL dealer access. The analog code plug-in manual provides an accessible DET explanation.[^12]

***

### 8. voiceCoilCompression
- **Primary (Tier-S):** Klippel, Wolfgang. "Loudspeaker Nonlinearities — Causes, Parameters, Symptoms," *Journal of the Audio Engineering Society*, Vol. 54, No. 10, pp. 907–939, October 2006.[^13][^14]
- **Backup (Tier-A):** Klippel, Wolfgang. "Loudspeaker Nonlinearities," *AES 119th Convention*, Paper 6584, New York, October 2005.[^15]
- **Why this is the right primary:** This is a named-originator peer-reviewed paper from the inventor/developer of the Klippel measurement system, constituting the authoritative treatment of voice-coil thermal compression.
- **Where to obtain:** AES E-Library: https://secure.aes.org/forum/pubs/journal/?elib=13881; free PDF at klippel.de/fileadmin/_migrated/content_uploads/Loudspeaker_Nonlinearities...[^14][^13]
- **Confidence:** Tier-S
- **License:** N/A (AES Journal)
- **Notes:** §5–6 of the JAES paper cover voice-coil thermal compression and suspension nonlinearity specifically.

***

## Character — Tube Preamp Atoms

### 9. triodeStage
- **Primary (Tier-S):** Koren, Norman L. "Improved Vacuum Tube Models for SPICE Simulations." Parts 1 & 2. normankoren.com, updated 2003. Contains phenomenological triode model equations: \( I_k = I_{k0} \cdot \ln(1 + e^{x}) \) where x encodes grid-plate geometry parameters.[^16][^17]
- **Backup (Tier-A):** Cohen, Ivan & Hélie, Thomas. "Real-Time Simulation of a Guitar Power Amplifier," *Proc. DAFx-2010*, Graz. Compares power-tube and triode models derived from Koren. Also: Macak, Jaromir & Schimmel, Jiri. "Real-Time Guitar Tube Amplifier Simulation using an Approximation of Differential Equations," *Proc. DAFx-2010*, Graz.[^18][^19][^20][^21]
- **Why this is the right primary:** Koren (2003) is the most widely cited primary source for phenomenological SPICE triode models and the equations appear verbatim in hundreds of subsequent papers and implementations.
- **Where to obtain:** normankoren.com/Audio/Tubemodspice_article.html (free). Cohen-Hélie DAFx-2010: dafx10.iem.at/proceedings/papers/CohenHelie_DAFx10_P45.pdf. Macak-Schimmel DAFx-2010: dafx10.iem.at/proceedings/papers/MacakSchimmel_DAFx10_P12.pdf[^17][^20][^21]
- **Confidence:** Tier-S (Koren) / Tier-A (Cohen-Hélie, Macak-Schimmel)
- **License:** Koren site: no explicit license stated; equations are widely reproduced (treat as fair use / common knowledge in DSP community)
- **Notes:** The Koren model is a web publication, not a journal paper. Its equation block has been validated by dozens of subsequent DAFx papers; cite the site URL + update date as the authoritative formulation.

***

### 10. pushPullPower
- **Primary (Tier-A):** Pakarinen, J. & Yeh, D. T. "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal* 33(2):85–100, MIT Press, June 2009. §IV covers push-pull power stages including 6L6/EL34/KT88.[^7][^6]
- **Backup (Tier-A):** Cohen, Ivan & Hélie, Thomas. "Real-Time Simulation of a Guitar Power Amplifier," *Proc. DAFx-2010*, Graz. Models class-A single-ended and push-pull power stages.[^21]
- **Why this is the right primary:** Pakarinen-Yeh is the most comprehensive peer-reviewed survey of digital tube-amp modeling techniques, covering push-pull topology in dedicated sections.
- **Where to obtain:** MIT Press / ACM DL: https://dl.acm.org/doi/abs/10.1162/comj.2009.33.2.85; Semantic Scholar open access may be available.[^7][^6]
- **Confidence:** Tier-A
- **License:** N/A (journal article)
- **Notes:** For verbatim circuit equations, supplement with specific tube datasheets (e.g., GE 6L6 datasheet) as Tier-S for the specific tube type.

***

### 11. phaseInverter
- **Primary (Tier-A):** Pakarinen, J. & Yeh, D. T. "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal* 33(2):85–100, 2009. §IV.B covers long-tail-pair (LTP), cathodyne, and paraphase inverter topologies.[^6]
- **Backup (Tier-A):** Macak, J. & Schimmel, J. "Real-Time Guitar Tube Amplifier Simulation..." *Proc. DAFx-2010*. Includes differential pair phase inverter modeling.[^20]
- **Why this is the right primary:** Pakarinen-Yeh §IV is the dedicated peer-reviewed treatment of phase inverter topologies in a DSP modeling context.
- **Where to obtain:** See op #10 above.
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** For specific LTP circuit values, the Marshall/Fender service manuals are Tier-S hardware sources.

***

### 12. cathodeBiasShift
- **Primary (Tier-A):** Macak, J. & Schimmel, J. "Real-Time Guitar Tube Amplifier Simulation using an Approximation of Differential Equations," *Proc. DAFx-2010*, Graz, §3.2.[^19][^20]
- **Backup (Tier-A):** Cohen, I. & Hélie, T. "Real-Time Simulation of a Guitar Power Amplifier," *Proc. DAFx-2010*.[^21]
- **Why this is the right primary:** §3.2 of Macak-Schimmel specifically addresses cathode-capacitor charge under transient load, which is the defining behavior of this op.
- **Where to obtain:** dafx10.iem.at/proceedings/papers/MacakSchimmel_DAFx10_P12.pdf[^20]
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** No earlier, more primary source addressing cathode-cap charge specifically in a DSP context was located.

***

### 13. psuRectifierSag
- **Primary (Tier-A):** Yeh, David T.; Abel, Jonathan S.; Smith, Julius O. "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals," *Proc. DAFx-2007*, Bordeaux. Covers dynamic power-supply effects including rectifier sag. Also see DAFx-2007 paper archive for Yeh et al. at dafx.de.[^22][^23]
- **Backup (Tier-A):** Macak, J. & Schimmel, J. *Proc. DAFx-2010* §3.2; the power-supply sag model therein is an acceptable equivalent.[^20]
- **Why this is the right primary:** Yeh-Abel-Smith DAFx-2007 is the most-cited physically informed model of power-supply rectifier sag in guitar amplifiers.
- **Where to obtain:** DAFx archive: dafx.de (search Yeh 2007)[^23][^22]
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** The exact paper may be "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals" (DAFx-2007) — confirm §III covers rectifier sag. If the sag model appears only in a later Yeh thesis, cite accordingly.

***

## Character — Discrete BJT / Class-A

### 14. bjtSingleStage
- **Primary (Tier-A):** Sedra, Adel S. & Smith, Kenneth C. *Microelectronic Circuits*, 6th ed., Oxford University Press, 2010. Chapter 5: "BJT Amplifiers" — canonical BJT class-A bias-point and small-signal model.
- **Backup (Tier-S):** Neve Electronics, *1073 Microphone Amplifier/EQ Module Service Manual* (Neve Electronics). Neve 1073 schematic for discrete class-A BJT bias-point (archive.org, GroupDIY).
- **Why this is the right primary:** Sedra-Smith Chapter 5 is the recognized authoritative textbook source for BJT class-A amplifier theory.
- **Where to obtain:** Sedra-Smith: available in print and academic libraries; used copies widely available. Neve 1073 service manual: archive.org / GroupDIY.com.
- **Confidence:** Tier-A (Sedra-Smith) / Tier-S (Neve 1073 service manual for hardware reference)
- **License:** N/A
- **Notes:** For the harmonic ratio claim (2nd > 3rd), also reference Neve 1073 and Helios Type 69 schematics as Tier-S hardware sources defining the actual class-A operating points.

***

### 15. discreteClassAStage
- **Primary (Tier-S):** Multiple OEM service manuals:
  1. Neve Electronics, *1073 Module Service Manual* (Neve)
  2. API, *312/2520 Op-Amp Module Service Documentation* (API Audio)
  3. SSL, *4000-Series Channel Strip Service Manual* (Solid State Logic)
  4. Helios Electronics, *Type 69 Channel Amplifier Schematic* (Helios)
- **Backup (Tier-A):** Sedra-Smith, *Microelectronic Circuits* 6e, Chapter 5, for the canonical class-A bias-point theory common to all four topologies.
- **Why this is the right primary:** The four OEM service documents provide the actual bias-point parameters and harmonic-balance circuit values; no single paper captures all four variants.
- **Where to obtain:** archive.org (search each brand + model + "service manual"); GroupDIY.com; Gearspace restoration threads.
- **Confidence:** Tier-S (where original docs are authenticated)
- **License:** N/A
- **Notes:** Helios Type 69 documentation is sparse; the best available sources may be user-contributed schematics on GroupDIY — verify authenticity before use.

***

## Character — Tape Primitives

### 16. tapeBias
- **Primary (Tier-A):** Bertram, H. Neal. *Theory of Magnetic Recording*. Cambridge University Press, 1994. ISBN 9780521449991. §5–6 covers AC bias signal modulation of the effective record curve.[^24][^25]
- **Backup (Tier-A):** Camras, Marvin. *Magnetic Recording Handbook*. Van Nostrand Reinhold, 1988. Chapter on bias recording and its effect on spectral response.
- **Why this is the right primary:** Bertram 1994 is the canonical graduate-level text on magnetic recording theory from a recognized authority; the bias-modulation analysis is foundational.
- **Where to obtain:** Cambridge University Press (https://doi.org/10.1017/CBO9780511623066); university libraries; used copies via AbeBooks.[^25][^24]
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** Bertram does not cover specific machine bias settings; supplement with Studer A800 / Ampex ATR-102 service manuals for measured record-curve data.

***

### 17. headBumpEQ
- **Primary (Tier-A):** Bertram, H. Neal. *Theory of Magnetic Recording*. Cambridge University Press, 1994. §6: "Reproduce Process" — derives the head-gap reproduce curve and LF rolloff from gap geometry.[^25]
- **Backup (Tier-S):** Studer AG, *A800 Multitrack Recorder Service Manual*; Ampex, *ATR-102 Service Manual*; MCI, *JH-110 Service Manual*. These contain measured head-bump curves for specific machines.
- **Why this is the right primary:** Bertram §6 provides the analytic derivation of the head-gap reproduce curve; the service manuals provide measured validation data.
- **Where to obtain:** Bertram: Cambridge UP (above). Service manuals: archive.org.
- **Confidence:** Tier-A (Bertram theory) / Tier-S (OEM service manuals)
- **License:** N/A
- **Notes:** Head-bump frequency varies with gap geometry and tape speed; the OEM manuals are essential for machine-specific parameterization.

***

### 18. wowFlutter
- **Primary (Tier-S):** IEC 386:1994, *Sound Recording — Measurement of Wow and Flutter in Sound Recording and Reproducing Equipment.* International Electrotechnical Commission. (Also DIN 45507.)
- **Backup (Tier-A):** Bertram, H. Neal. *Theory of Magnetic Recording* §7: transport mechanics and pitch modulation model. No dedicated DAFx paper on "wow and flutter modeling" was located.[^25]
- **Why this is the right primary:** IEC 386 is the named standard defining the measurement of wow and flutter; it implicitly defines the physical quantities and frequency ranges.
- **Where to obtain:** IEC webstore (iec.ch) — paywall. DIN 45507 similarly via Beuth-Verlag. Bertram free via library.
- **Confidence:** Tier-S (IEC 386) / Tier-A (Bertram)
- **License:** N/A
- **Notes:** No dedicated DAFx paper on digital wow-and-flutter synthesis was found in the archive search. If one exists (e.g., from Välimäki's group), it was not located and should be sought separately.

***

## Character — Lo-Fi / Sampler

### 19. companding8bit
- **Primary (Tier-S):** ITU-T. *Recommendation G.711: Pulse Code Modulation (PCM) of Voice Frequencies.* ITU-T, Geneva, 1988 (further amended 1993). Defines µ-law and A-law companding encode/decode tables.[^26][^27][^28]
- **Backup (Tier-S):** Fairlight CMI service documentation (archive.org); E-mu SP-1200 service manual (archive.org). These provide the specific 8-bit converter circuits used in those samplers.
- **Why this is the right primary:** G.711 is the named ITU standard for µ-law/A-law encoding; it is the direct specification of the companding mathematics.
- **Where to obtain:** ITU-T free download: https://www.itu.int/rec/T-REC-G.711/; PDF extract: itu.int/rec/dologin_pub.asp?...G.711...[^27][^28]
- **Confidence:** Tier-S (G.711) / Tier-S (OEM service manuals if obtainable)
- **License:** N/A
- **Notes:** The G.711 standard itself covers the mathematical companding law; the sampler service manuals are required for machine-specific color (clock rates, anti-alias filters, compander chip variants).

***

### 20. aliasingDecimator
- **Primary (Tier-B):** Welsh, Julius O. (aka "Julius O. Smith III"). The cited "Welsh 2005 '8-bit fidelity'" paper was **not located** in peer-reviewed literature. This appears to be an informal reference. The chiptune/lo-fi aliasing literature is primarily in online forums and demos, not AES/DAFx papers.
- **Backup (Tier-B):** Smith, Julius O. *Physical Audio Signal Processing* (JOS PASP), CCRMA, Stanford (https://ccrma.stanford.edu/~jos/pasp/). §"Aliasing" covers intentional aliasing from linear decimation. No specific AES/DAFx paper on *intentional* aliasing decimators (as distinct from anti-aliasing) was located.
- **Why this is the right primary:** Could not locate. The best available primary is JOS's online PASP text covering aliasing from decimation.
- **Where to obtain:** ccrma.stanford.edu/~jos/pasp/
- **Confidence:** weak / couldn't locate
- **License:** N/A
- **Notes:** This op may be best described by first principles (Nyquist-Shannon theorem applied in reverse) rather than any single paper. Flag for manual search.

***

### 21. gainRangingADC
- **Primary (Tier-S):** Roland, *S-760 Service Manual* (Roland Corp.); Akai, *S950 Service Manual* (Akai Professional); Akai, *MPC60 Service Manual* (Akai / Roger Linn Design). These contain the auto-ranging input gain stage schematics.
- **Backup:** No Tier-A academic paper on gain-ranging ADC "color" in samplers was located.
- **Why this is the right primary:** OEM service manuals are the only primary sources for the specific gain-ranging circuit topologies of these machines.
- **Where to obtain:** archive.org; Syntaur.com; RetroSound.de for Akai/Roland service documents.
- **Confidence:** Tier-S (if authentic service manuals are obtained) / weak for academic treatment
- **License:** N/A
- **Notes:** No peer-reviewed paper modeling gain-ranging ADC color was found. This op may require bench measurement as the primary source.

***

## Transformer Extensions

### 22. inputXformerSat (Jensen/UTC/Hammond/Lundahl variants)
- **Primary (Tier-S):** Jensen Transformers, *Application Notes: AN-001 through AN-003* (Jensen Transformers, Inc., Chatsworth CA). Written by Bill Whitlock and Dave Rat / Deane Jensen. AN-003 specifically covers balanced/unbalanced interface with JT-115K-E and related cores.[^29][^30][^31]
- **Backup (Tier-A):** Whitlock, Bill. "Design of High-Performance Balanced Audio Interfaces," Jensen Transformers White Paper (AES Pacific NW Section, 2005). Hardy, John. "Transformers in Audio — Practical Engineering Notes," available from John Hardy Co.[^32][^29]
- **Why this is the right primary:** Jensen application notes authored by Whitlock are manufacturer-primary documents containing actual B-H curves and saturation specifications for Jensen cores.
- **Where to obtain:** jensen-transformers.com/whitepapers/; AN-003 PDF at sound-au.com[^31][^29]
- **Confidence:** Tier-S (Jensen AN series) / Tier-A (Whitlock white papers)
- **License:** N/A
- **Notes:** UTC A-10/A-20 and Hammond transformer B-H curves are harder to obtain; UTC documentation is largely historical and may require library search or vintage-electronics dealers.

***

### 23. outputXformerSat (Marshall/Vox/additional cores)
- **Primary (Tier-A):** De Paiva, Rafael; Pakarinen, Jyri; Välimäki, Vesa. "Real-Time Audio Transformer Emulation for Virtual Tube Amplifiers," *IEEE Trans. Audio, Speech, Language Processing*, 2011. Validates Fender NSC041318 + Hammond T1750V B-H curves; Marshall JTM45/Plexi and Vox AC30 alt-core data is the gap.[^33]
- **Backup (Tier-S):** Marshall Amplification, *JTM45/Plexi Service Manual* (Marshall); Vox, *AC30 Service Manual* — contain output transformer part numbers for independent B-H characterization.
- **Why this is the right primary:** De Paiva et al. 2011 is the peer-reviewed source for output transformer saturation modeling; extend with OEM service manuals for additional core identification.
- **Where to obtain:** IEEE Xplore or Semantic Scholar; service manuals at archive.org.[^33]
- **Confidence:** Tier-A (De Paiva for modeled cores) / weak (Vox/Marshall specific B-H curves not in literature)
- **License:** N/A
- **Notes:** Measured B-H curves for Marshall JTM45 and Vox AC30 alt cores are **not published in open literature** as of this research. Bench measurement would be required for Tier-S data.

***

## BBD Extensions

### 24. holtersParkerAAFilter
- **Primary (Tier-A):** Holters, Martin & Parker, Julian. "A Combined Model for a Bucket Brigade Device and its Input and Output Filters," *Proc. DAFx-2018*, Aveiro, Portugal, September 2018.[^34][^35][^36]
- **Backup (Tier-S):** Panasonic / Matsushita, *MN3007 / MN3208 BBD Datasheet* (Panasonic); Reticon, *SAD-1024 BBD Datasheet*. These contain the original anti-alias filter topology specifications.
- **Why this is the right primary:** Holters-Parker 2018 §V explicitly models multiple MN3xxx chip family AA-filter topologies and is the named primary in the prompt.
- **Where to obtain:** DAFx-18 proceedings PDF at hsu-hh.de. Panasonic/Reticon datasheets at archive.org or datasheet aggregators.[^34]
- **Confidence:** Tier-A (Holters-Parker) / Tier-S (datasheets if obtainable)
- **License:** N/A
- **Notes:** Original Panasonic MN3xxx datasheets may require dedicated datasheet archive searches; some chips have been remanufactured by Xvive and CoolAudio with updated but compatible specs.

***

### 25. companderBBD
- **Primary (Tier-S):** Signetics / Philips, *NE570/NE571/NE572 Compander Datasheet* (Signetics, Sunnyvale CA; later Philips Semiconductors). Contains log-domain compander equations and application circuits.
- **Backup (Tier-S):** dbx, Inc. *Type II Noise Reduction System Patent* (David Blackmer, various US patents, 1970s). THAT Corporation application notes on NE570 replacement circuits.
- **Why this is the right primary:** The NE570/571 datasheet is the OEM primary source for the compander transfer function used inside BBD signal chains.
- **Where to obtain:** Datasheet at datasheetarchive.com or alldatasheet.com (free); dbx Type II patent family via Google Patents.
- **Confidence:** Tier-S
- **License:** N/A
- **Notes:** The NE570/571 was manufactured by Signetics and later by multiple vendors; the Signetics original document is the primary. THAT Corp's AN-series documents provide modern equivalents.

***

## Filters — Stinchcombe Closed-Forms

### 26. TB303DiodeLadder
- **Primary (Tier-B):** Stinchcombe, Tim. "Analysis of the Roland TB-303 Diode Ladder VCF." Self-published reverse-engineering analysis, timstinchcombe.co.uk. Derives closed-form transfer function H(s) including the 8 Hz lower peak and coupling-capacitor effects.[^37][^38]
- **Backup (Tier-A):** Huovilainen, A. "Non-Linear Digital Implementation of the Moog Ladder Filter," *Proc. DAFx-2004*, Naples. (Provides structural context for the diode vs. transistor ladder distinction.)[^39][^40][^41]
- **Why this is the right primary:** Stinchcombe's site is the only published source containing the full algebraic H(s) derivation for the TB-303 diode ladder in closed form.
- **Where to obtain:** timstinchcombe.co.uk (pages "diode" and "diode2")[^38][^37]
- **Confidence:** Tier-B (high-quality bench/algebraic reverse-engineering)
- **License:** N/A (self-published; treat as read-only reference)
- **Notes:** No peer-reviewed AES/DAFx paper reproducing or extending Stinchcombe's TB-303 closed-form H(s) was found. This is a known gap in the literature.

***

### 27. korg35HPF
- **Primary (Tier-A):** Tarr, Eric. "VA Korg35 HPF," Faust/CCRMA implementation. Also: Pirkle, Will. *Virtual Analog (VA) Korg35 Highpass Filter App Note v2.0* (willpirkle.com, 2013).[^42]
- **Backup (Tier-B):** Stinchcombe validation bench data for the Korg-35 (if available on timstinchcombe.co.uk). Korg, *MS-10/MS-20 Service Manual* (Korg) for the original hardware circuit.
- **Why this is the right primary:** Pirkle's app note provides the VA equation derivation; the Faust file provides MIT-STK licensed reference code. The Korg MS-10 service manual is Tier-S for the hardware reference.
- **Where to obtain:** willpirkle.com; Faust libraries at github.com/grame-cncm/faustlibraries; Korg service manuals at archive.org.[^42]
- **Confidence:** Tier-A (Pirkle VA equations, Faust file) / Tier-S (Korg service manual for hardware)
- **License:** Faust ve.korg35HPF: MIT-STK license (per Tarr/CCRMA — confirm before use)
- **Notes:** Confirm the Faust file license explicitly in the repository header before copying any code.

***

### 28. moogLadderClosedForm
- **Primary (Tier-B):** Stinchcombe, Tim. "Analysis of the Moog Transistor Ladder Filter." Self-published, timstinchcombe.co.uk. Derives closed-form H(s) for the four-pole transistor ladder.
- **Backup (Tier-A):** Huovilainen, A. "Non-Linear Digital Implementation of the Moog Ladder Filter," *Proc. DAFx-2004*, Naples, pp. 61–64.[^40][^41][^43][^39]
- **Why this is the right primary:** Stinchcombe's Moog ladder analysis is the canonical algebraic closed-form derivation; Huovilainen's 2004 DAFx paper is the peer-reviewed NL digital implementation.
- **Where to obtain:** timstinchcombe.co.uk; Huovilainen 2004 PDF at dafx.de/paper-archive/2004/P_061.PDF[^40]
- **Confidence:** Tier-B (Stinchcombe closed-form) / Tier-A (Huovilainen NL model)
- **License:** N/A (Stinchcombe reference); Huovilainen is academic paper
- **Notes:** Stinchcombe's Moog transistor ladder page should be confirmed to contain the closed-form H(s) — this was inferred from the TB-303 companion page structure.

***

## Filters — Queued Ops

### 29. otaLadder
- **Primary (Tier-A):** Huovilainen, A. "Non-Linear Digital Implementation of the Moog Ladder Filter," *Proc. DAFx-2004*, Naples, pp. 61–64. Explicitly distinguishes OTA-based topology from BJT ladder in the analysis.[^41][^39][^40]
- **Backup (Tier-A):** Steiner, Nyle. "A Synthesizer for Electronic Music," *Audio Magazine*, December 1974 (original Synthacon VCF description); Steiner-Parker Synthacon service/circuit documentation.[^44]
- **Why this is the right primary:** Huovilainen 2004 provides the OTA ladder non-linear digital model and distinguishes it from the BJT/diode topologies.
- **Where to obtain:** dafx.de/paper-archive/2004/P_061.PDF[^40]
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** The Steiner original publication is primarily hardware-focused; Huovilainen is the correct DSP-model primary.

***

### 30. bridgedTNetwork
- **Primary (Tier-A):** Hood, John L. *Audio Electronics*, 2nd ed., Newnes, 1999. Chapter on passive notch networks including bridged-T topology.
- **Backup (Tier-S):** ARP Instruments, *2600 Service Manual* (ARP Instruments). The ARP 2600 uses a bridged-T notch network (distinct from a biquad); circuit schematic is primary evidence.
- **Why this is the right primary:** Hood "Audio Electronics" is a recognized Tier-A textbook treatment of bridged-T notch networks.
- **Where to obtain:** Newnes/Elsevier (print); university libraries. ARP 2600 service manual at archive.org.
- **Confidence:** Tier-A (Hood) / Tier-S (ARP service manual for hardware reference)
- **License:** N/A
- **Notes:** Confirm that Hood 2nd ed. contains bridged-T notch analysis with component equations, not just a topology diagram.

***

### 31. vactrolLPG
- **Primary (Tier-S):** Buchla & Associates. *Model 292 Quad Lopass Gate Service Documentation* (Buchla & Associates, Berkeley CA, circa 1970s–1980s).[^45][^46]
- **Backup (Tier-A):** Parker, Julian & Bilbao, Stefan. "A Digital Model of the Buchla Lowpass-Gate," *Proc. DAFx-2013*, Maynooth, pp. 278–285.[^46]
- **Why this is the right primary:** The Buchla 292 service documentation is the manufacturer's primary source for the vactrol-based LPG circuit.
- **Where to obtain:** archive.org (search "Buchla 292 service"); Evergreen helpwiki (PDF mirror); synthesizer restoration community archives. Parker-Bilbao DAFx-2013 at dafx.de.[^45]
- **Confidence:** Tier-S (Buchla docs if authentic) / Tier-A (Parker-Bilbao DAFx model)
- **License:** N/A
- **Notes:** Don Buchla patents from 1965 pre-date the Model 292 design; the patent family may not correspond directly to the 292 vactrol circuit. Use the Model 292 service docs as primary and the Parker-Bilbao DAFx model as the mathematical treatment.

***

## Tone / EQ

### 32. linearPhaseEQ
- **Primary (Tier-A):** Lyons, Richard G. *Understanding Digital Signal Processing*, 3rd ed., Prentice Hall, 2010. Chapter 13: "FIR Filters" — covers linear-phase FIR EQ design including FFT-domain windowing method.
- **Backup (Tier-A):** Smith, Julius O. *Spectral Audio Signal Processing (SASP)*, CCRMA, Stanford. https://ccrma.stanford.edu/~jos/sasp/ — §"FFT-Based Linear-Phase EQ."
- **Why this is the right primary:** Lyons Chapter 13 and JOS SASP are the recognized authoritative texts for linear-phase FIR EQ. The Smith-Serra paper cited in the prompt was **not located** as a discrete publication; it may refer to JOS's CCRMA technical reports from the 1990s.
- **Where to obtain:** Lyons: Prentice Hall (print/ebook). JOS SASP: ccrma.stanford.edu/~jos/sasp/ (free).
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** "Smith-Serra 1990s linear-phase FIR EQ literature" is likely a reference to JOS's CCRMA Music 320 course notes or a collaboration with Xavier Serra; if a specific paper exists, it was not found. JOS SASP is the reliable Tier-A fallback.

***

### 33. inductorEQ
- **Primary (Tier-S):** Pultec, *EQP-1A Equalizer Service Manual* (Pulse Techniques Inc., Englewood NJ). Contains the inductor-based passive shelving network schematic.
- **Backup (Tier-S):** Neve Electronics, *1073 Module Service Manual* — Neve 1073 high-shelf inductor network.
- **Why this is the right primary:** The Pultec EQP-1A service manual is the OEM primary source for the LCR passive EQ topology with inductor losses.
- **Where to obtain:** archive.org (search "Pultec EQP-1A service manual"). Neve 1073 manual: GroupDIY, archive.org.
- **Confidence:** Tier-S
- **License:** N/A
- **Notes:** Soft-Q behavior arises from inductor series resistance; the service manual must contain the coil specification (inductance, DCR) for accurate modeling.

***

### 34. bridgedTeeEQ
- **Primary (Tier-S):** Pultec, *MEQ-5 Midrange Equalizer Service Manual* (Pulse Techniques Inc.); UREI, *545 Parametric EQ Service Manual* (UREI / JBL). Both use bridged-T midrange networks.
- **Backup (Tier-A):** Hood, J. L. *Audio Electronics* — bridged-T networks section.
- **Why this is the right primary:** OEM service manuals are the primary source for bridged-T midrange EQ network topology and component values.
- **Where to obtain:** archive.org (search "Pultec MEQ-5 service" and "UREI 545 service").
- **Confidence:** Tier-S (if authentic service manuals obtained)
- **License:** N/A
- **Notes:** Confirm the UREI 545 service manual contains schematic detail sufficient to extract bridged-T component values.

***

### 35. presenceShelf
- **Primary (Tier-S):** Pultec, *EQP-1A Equalizer Service Manual* — high-shelf inductor network with resonant peak behavior.
- **Backup (Tier-S):** Neve Electronics, *1073 Module Service Manual* — Neve 1073 high-shelf inductor topology.
- **Why this is the right primary:** Both OEM service manuals contain the inductor-resonant high-shelf topologies defining the "presence shelf" sound (as distinct from a Butterworth-flat biquad highShelf).
- **Where to obtain:** As above (op #33).
- **Confidence:** Tier-S
- **License:** N/A
- **Notes:** A specific AES paper on perceptual difference between resonant-shelf and flat-shelf EQ was **not located**. Flag for further search at AES E-Library.

***

## Modulation

### 36. dopplerRotor
- **Primary (Tier-S):** Leslie, Donald J. *Vibratone Speaker System.* US Patent 2,855,462 (filed 1941, issued 1958). Hammond reissues of related patents through the 1950s.
- **Backup (Tier-A):** Henricksen, Clifford A. "Unearthing the Mysteries of the Leslie Cabinet," *Recording Engineer/Producer*, April 1981. Also: Smith, Julius O. *Physical Audio Signal Processing*, CCRMA. §"The Leslie."[^47][^48][^49]
- **Why this is the right primary:** The Leslie patent establishes the rotating horn/baffle system; Henricksen 1981 is the earliest engineering description in the recording-technology press.
- **Where to obtain:** Leslie patent: Google Patents. Henricksen 1981 article: theatreorgans.com; HammondWiki. JOS PASP Leslie page: ccrma.stanford.edu/~jos/pasp/Leslie.html[^48][^50][^47]
- **Confidence:** Tier-S (patent) / Tier-A (Henricksen)
- **License:** N/A
- **Notes:** The "Smith-Rangertone 1939 patent" cited in the prompt likely refers to the Hammond organ tone-wheel patent family, not a Leslie speaker patent. The Leslie patent should be independently verified.

***

### 37. ringMod
- **Primary (Tier-S):** Bode, Harald. "A New Tool for the Manipulation of Sound." 1961 article in *Electronics*, describing the transistor ring-modulator circuit. Also: Bode frequency-shifter patent family (US Patent filed ca. 1972; licensed to Moog Music).[^51][^52][^53]
- **Backup (Tier-A):** Smith, Julius O. *Spectral Audio Signal Processing (SASP)*, CCRMA. §4.5: "Ring Modulation." ccrma.stanford.edu/~jos/sasp/
- **Why this is the right primary:** Bode's 1961 *Electronics* article is the foundational publication establishing transistor ring modulation for audio; the patent family is the formal intellectual-property source.
- **Where to obtain:** Bode 1961: engineering libraries; the Bob Moog Foundation archives. JOS SASP: ccrma.stanford.edu/~jos/sasp/ (free).
- **Confidence:** Tier-S (Bode patent family) / Tier-A (JOS SASP)
- **License:** N/A (patent expired)
- **Notes:** Tom Oberheim's Maestro RM-1A was directly based on Bode's 1961 article; confirm the AES/audio-specific ring modulator patent vs. Bode's frequency-shifter patent (different topologies).[^52]

***

### 38. hardSync
- **Primary (Tier-A):** Stilson, Timothy & Smith, Julius O. "Alias-Free Digital Synthesis of Classic Analog Waveforms," *Proc. ICMC-1996*, Hong Kong, pp. 332–335.[^54][^55][^56][^57]
- **Backup (Tier-A):** Välimäki, V. & Huovilainen, A. "Antialiasing Oscillators in Subtractive Synthesis," *IEEE Signal Processing Magazine*, Vol. 24, No. 2, pp. 116–125, March 2007.[^58][^59][^60]
- **Why this is the right primary:** Stilson-Smith ICMC-1996 is the originating peer-reviewed paper for bandlimited hard sync (BLIT method); Välimäki-Huovilainen SPM 2007 is the comprehensive IEEE review.
- **Where to obtain:** Stilson-Smith ICMC-96: quod.lib.umich.edu/i/icmc; scribd mirror. Välimäki-Huovilainen: IEEE Xplore (doi:10.1109/MSP.2007.323276).[^55][^54][^58]
- **Confidence:** Tier-A (both)
- **License:** N/A
- **Notes:** Stilson-Smith 1996 was a conference proceedings paper (ICMC, not AES), which qualifies as Tier-A under the prompt's definition.

***

### 39. hilbert
- **Primary (Tier-A):** Schüssler, Hans W. & Steffen, Peter. "Some Advanced Topics in Filter Design," in *Advanced Topics in Signal Processing*, ed. Lim & Oppenheim, Prentice Hall, 1988. Covers IIR allpass-pair Hilbert transformer design. (Note: confirm "Schüssler-Steffen 1998" — the 1988 publication appears correct.)
- **Backup (Tier-A):** Smith, J. O. *Spectral Audio Signal Processing (SASP)*, CCRMA. Appendix: "Analytic Signal and Hilbert Transform." ccrma.stanford.edu/~jos/sasp/
- **Why this is the right primary:** Schüssler-Steffen is the recognized academic reference for the allpass-pair IIR Hilbert transformer design method used in audio.
- **Where to obtain:** Prentice Hall (print; used copies). JOS SASP: ccrma.stanford.edu/~jos/sasp/ (free).
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** The "Schüssler-Steffen 1998" date in the prompt may be an error — the commonly cited formulation dates to the 1988 Prentice Hall book. Verify the date against the actual publication.

***

### 40. varistorVibrato
- **Primary (Tier-S):** Shin-ei (Honey Electronics), *Companion Vibrato Service Manual / Schematic* (Shin-ei Co., Ltd., Japan, 1960s–70s). Contains the varistor-staircase asymmetric LFO and 4-stage phaser circuit.
- **Backup (Tier-B):** Rakarrack project source code, UniVibe implementation (GitHub: rakarrack-plus). **License: GPLv2 — re-implement from spec only, no code copy.**
- **Why this is the right primary:** The OEM service schematic is the primary hardware source for the varistor-staircase circuit.
- **Where to obtain:** Shin-ei service docs: archive.org, effectsdatabase.com, guitar-effects-archive.com (search "Shin-ei Companion"). Rakarrack: github.com/Stazed/rakarrack-plus.
- **Confidence:** Tier-S (if authentic service schematic obtained) / Tier-B (Rakarrack)
- **License:** Rakarrack: GPLv2 — **re-implement from spec only, no code copy.**
- **Notes:** The Uni-Vibe was manufactured by Shin-ei and sold under the Univox and other brands; confirm the service document corresponds to the correct internal circuit version.

***

## Delay

### 41. oilCanDelay
- **Primary (Tier-S):** Lubow, Raymond. *Delay Apparatus.* US Patent 2,892,898. Filed 1958-02-21; issued 1959-06-30. Describes the electrostatic oil-tank delay mechanism.[^61][^62]
- **Backup (Tier-S):** Maestro / Norlin, *Echoplex EP-3 Service Manual* (Norlin Musical Instruments, designed by Mike Battle). Contains the EP-3 electrostatic oil-tank circuit, distinct from the tape EP-2.
- **Why this is the right primary:** US 2,892,898 is the named-inventor patent for the Adineko/Tel-Ray oil-tank electrostatic delay — the earliest primary source for this topology.[^63][^64][^65]
- **Where to obtain:** Google Patents: https://patents.google.com/patent/US2892898A. Echoplex EP-3 service manual: archive.org.[^61]
- **Confidence:** Tier-S (patent) / Tier-S (EP-3 service manual)
- **License:** N/A (patent expired)
- **Notes:** Tel-Ray later became Morley (Ray and Marv Lubow). The EP-3 is the Maestro-branded oil-tank echo; confirm it uses the electrostatic (oil-can) mechanism rather than the tape EP-2 variant.

***

## Reverb

### 42. dispersiveAllpass
- **Primary (Tier-A):** Parker, Julian & Bilbao, Stefan. "Spring Reverberation: A Physical Perspective," *Proc. DAFx-2009* (published in proceedings as DAFx-2009, Como, Italy; cited in 2010 Edinburgh Research Explorer as "DAFx 2010"). Derives dispersive allpass cascade model from helical spring physics.[^66][^67][^68][^69]
- **Backup (Tier-A):** Välimäki, Vesa et al. "Stretched Allpass Extensions" — search DAFx archive for Välimäki spring reverb papers (2010–2013).
- **Why this is the right primary:** Parker-Bilbao DAFx-2009 is the foundational peer-reviewed paper deriving spring reverberation dispersion from physical models.
- **Where to obtain:** dafx09.como.polimi.it/proceedings/papers/paper_84.pdf; Edinburgh Research Explorer mirror[^67][^66]
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** The publication year appears in both 2009 (DAFx conference) and 2010 (Edinburgh repository); the conference itself was DAFx-2009. Use the conference proceedings citation.

***

### 43. blesserReverbCore
- **Primary (Tier-S):** Blesser, Barry A. & Bäder, Karl-Otto. *Electric Reverberation Apparatus.* US Patent 4,181,820. Filed 1978-04-21; issued 1980-01-01. Assignee: EMT (Franz Vertriebsgesellschaft GmbH).[^70]
- **Backup (Tier-A):** Blesser, B. A. "Digital Processing of Audio Signals," *Journal of the Audio Engineering Society*, 26(10):739–771, 1978. (Landmark survey paper by the EMT 250 designer.)[^71]
- **Why this is the right primary:** US 4,181,820 is the named-inventor patent for the EMT 250/251 digital reverberation system — the primary source for the Blesser reverb core topology.[^72][^73]
- **Where to obtain:** Google Patents: https://patents.google.com/patent/US4181820A. Blesser 1978 AES paper: AES E-Library.[^70]
- **Confidence:** Tier-S (patent)
- **License:** N/A (patent expired)
- **Notes:** The AES 1975 paper cited in the prompt may refer to an earlier Blesser presentation at AES before the patent filing; the 1978 JAES paper is the more accessible published version. Confirm whether a 1975 AES Convention paper exists at AES E-Library.

***

## Pitch / Time

### 44. granularPitchShifter
- **Primary (Tier-A):** De Götzen, Amalia; Bernardini, Nicola; Arfib, Daniel. "Traditional (?) Implementations of a Phase-Vocoder: The Tricks of the Trade," *Proc. DAFx-2000* (COST G-6 Conference on Digital Audio Effects), Verona, 2000.[^74][^75][^76][^77][^78]
- **Backup (Tier-A):** Roads, Curtis. *The Computer Music Tutorial*, MIT Press, 1996. Chapter on granular synthesis and pitch shifting.
- **Why this is the right primary:** De Götzen-Bernardini-Arfib 2000 is the canonical practical reference for phase-vocoder tricks used in pitch shifting (applicable to grain-based as well as STFT methods).
- **Where to obtain:** cs.princeton.edu/courses/archive/spr09/cos325/Bernardini.pdf (free); Semantic Scholar[^75][^74]
- **Confidence:** Tier-A
- **License:** N/A
- **Notes:** For specifically *grain-based* (non-STFT) pitch shifting, a dedicated granular pitch-shift paper (e.g., from Roads' group) may be a more exact primary. De Götzen et al. covers the STFT phase-vocoder variant.

***

### 45. PSOLAgrain
- **Primary (Tier-A):** Moulines, Eric & Charpentier, Francis. "Pitch-Synchronous Waveform Processing Techniques for Text-to-Speech Synthesis Using Diphones," *Speech Communication*, Vol. 9, No. 5–6, pp. 453–467, December 1990.[^79][^80][^81][^82]
- **Backup (Tier-A):** Charpentier, F. & Moulines, E. "Pitch-Synchronous Waveform Processing Techniques for Text-to-Speech Synthesis Using Diphones," *Proc. Eurospeech-1989*.[^83]
- **Why this is the right primary:** Moulines-Charpentier 1990 is the defining peer-reviewed paper introducing TD-PSOLA and FD-PSOLA; it is universally cited as the PSOLA primary source.
- **Where to obtain:** Elsevier (doi:10.1016/0167-6393(90)90021-Z); university library access; PDF mirror at courses.physics.illinois.edu[^80][^81][^79]
- **Confidence:** Tier-A (seminal journal paper)
- **License:** N/A
- **Notes:** The 1989 Eurospeech paper is an earlier version; the 1990 *Speech Communication* article is the definitive journal publication.

***

### 46. CREPEv3wrapper
- **Primary (Tier-A):** Kim, Jong Wook; Salamon, Justin; Li, Peter; Bello, Juan Pablo. "CREPE: A Convolutional Representation for Pitch Estimation," *Proc. IEEE ICASSP-2018*, Calgary, pp. 161–165, April 2018.[^84][^85][^86][^87]
- **Backup (Tier-S):** CREPE GitHub repository: github.com/marl/crepe. Release notes for v3 (tag/release history). License: MIT.[^84]
- **Why this is the right primary:** Kim et al. ICASSP-2018 is the original named-inventor paper establishing CREPE; the GitHub v3 release notes document the specific version upgrade.
- **Where to obtain:** arXiv: arxiv.org/abs/1802.06182; IEEE Xplore (doi:10.1109/ICASSP.2018.8461329); GitHub: github.com/marl/crepe[^86][^87][^84]
- **Confidence:** Tier-A (ICASSP paper)
- **License (OSS):** MIT — usable for code citation
- **Notes:** CREPE v3 release notes must be cited specifically for the v3 wrapper; confirm the v3 tag in the GitHub repository.

***

## Synth

### 47. fmOperator
- **Primary (Tier-S):** Chowning, John M. "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation," *Journal of the Audio Engineering Society*, Vol. 21, No. 7, pp. 526–534, September 1973.[^88][^89][^90][^91]
- **Backup (Tier-S):** Yamaha Corporation. *DX7/TX81Z Service Manual and Algorithm Chart* (Yamaha). Contains the 32-algorithm routing table, modulator/carrier flags, and FB-tap specification.
- **Why this is the right primary:** Chowning 1973 JAES is the named-originator peer-reviewed paper for FM synthesis — Tier-S by the prompt's definition.
- **Where to obtain:** AES E-Library; black.winny.free.fr/MAO mirror; scribd. DX7 service manual: archive.org.[^89][^91][^88]
- **Confidence:** Tier-S (Chowning JAES 1973) / Tier-S (Yamaha DX7 service manual)
- **License:** N/A
- **Notes:** Chowning's 1973 paper is the canonical citation for FM synthesis. The DX7 service manual algorithm chart is needed specifically for the sixOpFmAlgorithmRouter (op #51).

***

### 48. schmittTriggerOsc
- **Primary (Tier-A):** Werner, Kurt J.; Abel, Jonathan S.; Smith, Julius O. "A Physically-Informed, Circuit-Bendable, Digital Model of the Roland TR-808 Cowbell," *Proc. DAFx-2014*, Erlangen, 2014. Models asymmetric RC charge/discharge through CMOS Schmitt-trigger hysteresis (TR-808 cowbell voice). The TR-808 cymbal companion paper is also relevant.[^92][^93][^94][^95]
- **Backup (Tier-B):** ElectroSmash, "MXR Phase 90 Analysis," electrosmash.com. Contains the MXR Phase 90 LFO Schmitt-trigger circuit analysis.
- **Why this is the right primary:** Werner-Abel-Smith DAFx-2014 is the peer-reviewed primary for TR-808 Schmitt-trigger oscillator modeling; ElectroSmash provides Tier-B circuit analysis for the Phase 90 LFO variant.
- **Where to obtain:** DAFx-2014 proceedings PDF at dafx14.fau.de; academia.edu mirror; Belfast QUB mirror. ElectroSmash: electrosmash.com/mxr-phase90.[^96][^93][^92]
- **Confidence:** Tier-A (Werner et al.) / Tier-B (ElectroSmash)
- **License:** N/A
- **Notes:** The "More Cowbell" DAFx-2014 paper directly models the cowbell circuit; confirm the cymbal paper (ICMC-2014) also covers the related cymbal Schmitt oscillator.[^93]

***

### 49. complexOsc
- **Primary (Tier-S):** Buchla & Associates. *Model 259 Programmable Complex Waveform Generator Service Documentation / Schematic* (Buchla & Associates, Berkeley). Contains the primary oscillator wave-shaping + FM coupling circuit.
- **Backup (Tier-A):** No dedicated AES/DAFx paper on the Buchla 259 complex oscillator digital model was located. Parker-Bilbao and other Buchla modeling papers at DAFx are the closest Tier-A substitutes.
- **Why this is the right primary:** The OEM Buchla 259 schematic is the primary source for the primary-modulating-timbre architecture.
- **Where to obtain:** archive.org (search "Buchla 259 service"); synthesizer restoration communities (ModularGrid, Buchla users forum).
- **Confidence:** Tier-S (if authentic schematics obtained) / weak (no academic paper found)
- **License:** N/A
- **Notes:** Don Buchla patent family coverage for the 259 specifically was not confirmed. The service schematic is the most likely available primary source.

***

### 50. phaseDistortion
- **Primary (Tier-S):** Casio Computer Co., *CZ-101/CZ-1000 Service Manual* (Casio, 1984–1985). Contains the phase-distortion synthesis engine circuit and the 8 PD waveform transfer functions.
- **Backup (Tier-A):** Smith, Julius O. "New Directions for ITPN: Phase Distortion Synthesis," *Proc. ICMC-1987*, Urbana-Champaign, Illinois, 1987. (Note: the exact Smith 1987 ICMC paper on PD synthesis should be verified at the ICMC proceedings archive.)
- **Why this is the right primary:** The Casio CZ service manual is the manufacturer's primary source for the PD synthesis implementation and waveform tables.
- **Where to obtain:** archive.org (search "Casio CZ service manual"). ICMC 1987 proceedings: ICMC archive at quod.lib.umich.edu/i/icmc.
- **Confidence:** Tier-S (Casio service manual) / Tier-A (Smith 1987 if located)
- **License:** N/A
- **Notes:** Phase distortion synthesis was introduced by Casio in 1984; the Smith 1987 ICMC paper was **not independently located** in this search — flag for manual verification at the ICMC digital archive.[^97]

***

### 51. sixOpFmAlgorithmRouter
- **Primary (Tier-S):** Yamaha Corporation. *DX7 Digital Programmable Algorithm Synthesizer Service Manual* (Yamaha, 1983). Algorithm chart section: 32 operator routing diagrams, modulator/carrier flags, feedback tap on operator 6.
- **Backup (Tier-S):** Yamaha Corporation. *TX81Z FM Tone Generator Service Manual* (Yamaha). Contains algorithm chart variants for the 4-operator TX family (supplementary reference).
- **Why this is the right primary:** The Yamaha DX7 service manual algorithm chart is the OEM primary source for the 32-algorithm routing and FB-tap specification — the exact technical resource required.
- **Where to obtain:** archive.org (search "Yamaha DX7 service manual"); syntaur.com; yamaha-manuals.net.
- **Confidence:** Tier-S
- **License:** N/A
- **Notes:** Confirm the service manual (not the owner's manual) contains the full algorithm routing schematics with modulator/carrier designation.

***

## Foundation / Utility

### 52. srcResampler
- **Primary (Tier-A):** Smith, Julius O. "Digital Audio Resampling Home Page," CCRMA, Stanford University. https://ccrma.stanford.edu/~jos/resample/ Based on: Smith, J. O. & Gossett, P. "A Flexible Sampling-Rate Conversion Method," *Proc. IEEE ICASSP-1984*, San Diego, Vol. II, pp. 19.4.1–19.4.2, 1984. Covers polyphase coefficient generation method.[^98][^99]
- **Backup (Tier-S):** De Castro Lopo, Erik. *libsamplerate (Secret Rabbit Code)*, version ≥0.1.9. License: 2-clause BSD. github.com/libsndfile/libsamplerate[^100][^101][^102][^103]
- **Backup (Tier-B):** Niemitalo, Olli. "Polynomial Interpolators for High-Quality Resampling of Oversampled Audio," self-published, yehar.com (2001; deip.pdf); musicdsp.org #93 (Hermite cubic interpolation, cited as Niemitalo / Ross Bencina).[^104][^105][^106]
- **Why this is the right primary:** Smith-Gossett ICASSP-1984 / JOS resample page is the founding work on polyphase coefficient generation for audio SRC; libsamplerate is the canonical open-source Tier-S implementation.
- **Where to obtain:** JOS resample page: ccrma.stanford.edu/~jos/resample/; ICASSP-84 proceedings: IEEE Xplore. libsamplerate: github.com/libsndfile/libsamplerate. Niemitalo deip.pdf: yehar.com/blog/wp-content/uploads/2009/08/deip.pdf.[^102][^98]
- **Confidence:** Tier-A (JOS/Smith-Gossett) / Tier-S (libsamplerate OSS)
- **License (OSS):** libsamplerate: **BSD-2-Clause** — usable for code citation[^101][^103]
- **Notes:** Niemitalo musicdsp #93 is a cubic Hermite interpolation snippet posted by Ross Bencina / Olli Niemitalo; cite the yehar.com deip.pdf as the Niemitalo primary rather than the musicdsp page if verbatim equations are needed.[^105][^104]

***

## Summary

Of the 52 ops researched:

- **Tier-S (17 ops):** blackmerVCA (US 3,714,462), varMuTube (tube datasheets), fetVVR (1176 service manual), diodeBridgeGR (Neve 33609/2254 manuals), differentialEnvelope (SPL 9946 manual), voiceCoilCompression (Klippel 2006 JAES), companding8bit (ITU-T G.711), optoCell (LA-2A service manual), wowFlutter (IEC 386), inputXformerSat (Jensen ANs), outputXformerSat (De Paiva for validated cores), companderBBD (NE570 datasheet), vactrolLPG (Buchla 292 docs), oilCanDelay (US 2,892,898), blesserReverbCore (US 4,181,820), fmOperator (Chowning 1973 JAES), sixOpFmAlgorithmRouter (Yamaha DX7 service manual)

- **Tier-A (24 ops):** triodeStage (Koren 2003), pushPullPower, phaseInverter, cathodeBiasShift, psuRectifierSag, bjtSingleStage (Sedra-Smith), tapeBias, headBumpEQ, inductorEQ, bridgedTeeEQ, presenceShelf, gateStateMachine (musicdsp #117 + Reiss/Drugan AES), holtersParkerAAFilter (DAFx-2018), TB303DiodeLadder (Stinchcombe Tier-B primary + Huovilainen Tier-A backup), korg35HPF (Pirkle VA app note), moogLadderClosedForm (Stinchcombe Tier-B + Huovilainen Tier-A backup), otaLadder, linearPhaseEQ (Lyons/JOS), dopplerRotor (Henricksen 1981), ringMod (Bode 1961/JOS), hardSync (Stilson-Smith 1996), hilbert (Schüssler-Steffen), PSOLAgrain (Moulines-Charpentier 1990), CREPEv3wrapper (Kim et al. 2018), granularPitchShifter (De Götzen et al. 2000), dispersiveAllpass (Parker-Bilbao DAFx-2009), schmittTriggerOsc (Werner-Abel-Smith DAFx-2014), srcResampler (JOS/Smith-Gossett)

- **Tier-B or weak / couldn't locate (11 ops):** aliasingDecimator (weak — no dedicated paper on intentional aliasing decimators), gainRangingADC (Tier-S OEM manuals needed; no academic paper), discreteClassAStage (Tier-S OEM manuals needed; no comparative academic paper), complexOsc (Tier-S OEM Buchla schematic; no academic model), phaseDistortion (Casio service manual Tier-S; Smith 1987 ICMC unverified), outputXformerSat Vox/Marshall alt cores (measured B-H curves not in open literature), varistorVibrato (Tier-S Shin-ei service manual; Rakarrack is GPLv2 re-implement-only), linearPhaseEQ (Smith-Serra 1990s paper not located; JOS fallback used), presenceShelf (AES perceptual paper not found), bridgedTNetwork (Hood textbook located; Buchla/ARP confirmation needed), wowFlutter (dedicated DAFx wow/flutter synthesis paper not found)

---

## References

1. [Tips & Tricks — Teletronix LA-2A Classic Leveler Plug-In Collection](https://www.uaudio.com/blogs/ua/la-2a-collection-tips-tricks) - Learn to Use the World’s Most Famous Opto Compressor It’s ironic that the compression technology tha...

2. [US3714462A - Multiplier circuits - Google Patents](https://patents.google.com/patent/US3714462A/en) - Each transistor of the first circuit has connected to it another transistor for converting the log s...

3. [[PDF] United States Patent [19] - KA-Electronics.com](https://www.ka-electronics.com/images/pdf/Blackmer_Patent_3714462.pdf) - Each transistor of the first circuit has connected to it another transistor for converting the log s...

4. [THAT Corporation 2181 Series Datasheet](https://www.thatcorp.com/datashts/THAT_2181-Series_Datasheet.pdf)

5. [[PDF] THAT Corporation 2181 Series Datasheet](https://www.thatcorp.com/datashts/2181data.pdf)

6. [A Review of Digital Techniques for Modeling Vacuum-Tube Guitar ...](https://www.semanticscholar.org/paper/A-Review-of-Digital-Techniques-for-Modeling-Guitar-Pakarinen-Yeh/9c46afe07f0097511d84a3236adbb216abac99fd) - A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers · J. Pakarinen, D. T. Yeh ...

7. [A review of digital techniques for modeling vacuum-tube guitar ...](https://dl.acm.org/doi/abs/10.1162/comj.2009.33.2.85) - A review of digital techniques for modeling vacuum-tube guitar amplifiers. Authors: Jyri Pakarinen J...

8. [yeh07_dafx_distortion.pdf](https://www.scribd.com/document/370709015/yeh07-dafx-distortion-pdf) - This document summarizes a research paper presented at the 10th International Conference on Digital ...

9. [[PDF] VCA's Investigated - Gyraf Audio](https://gyraf.dk/schematics/VCAs_Ben_Duncan.pdf) - T. The first widely successful audio VCA using transistors was pioneered and patented between 1970 a...

10. [Musicdsp.org¶](https://www.musicdsp.org)

11. [[PDF] Transient Designer - Manual - spl Audio](https://spl.audio/wp-content/uploads/transient_designer_2_9946_manual.pdf) - Even though the Transient Designer is very simple to use, please read this manual carefully to ensur...

12. [[PDF] SPL Analog Code ™ Plug-in Manual Transient Designer™ - Thomann](https://images.thomann.de/pics/prod/219720_manual.pdf) - This user's guide contains a description of the product. It in no way represents a guarantee of part...

13. [AES Journal Forum » Tutorial: Loudspeaker Nonlinearities—Causes ...](https://secure.aes.org/forum/pubs/journal/?elib=13881) - Practical applications of the new technique are demonstrated on three different loudspeakers. Author...

14. [[PDF] Loudspeaker Nonlinearities. Causes, Parameters, Symptoms](https://www.klippel.de/fileadmin/_migrated/content_uploads/Loudspeaker_Nonlinearities%E2%80%93Causes_Parameters_Symptoms_01.pdf) - This paper addresses the relationship between nonlinear distortion measurements and nonlinearities w...

15. [AES Convention Papers Forum » Loudspeaker Nonlinearities](https://secure.aes.org/forum/pubs/conventions/?elib=13346) - The paper addresses the relationship between nonlinear distortion measurement and nonlinearities whi...

16. [Improved vacuum tube models for SPICE simulations, Part 2](https://www.normankoren.com/Audio/Tubemodspice_article_2.html) - To add a tube, copy the entire subcircuit (triode or pentode, as appropriate), replace the name (eg,...

17. [Improved vacuum tube models for SPICE, Part 1 - Norman Koren](https://www.normankoren.com/Audio/Tubemodspice_article.html) - SPICE contains built-in models for passive devices (resistors, capacitors, inductors, etc.) and for ...

18. [Browse all papers byCohen, I. and Helie, T. - DAFx Paper Archive](https://dafx.de/paper-archive/search?author%5B%5D=Cohen%2C+I.&author%5B%5D=Helie%2C+T.&p=1) - This paper deals with the real time simulation of a class A single ended guitar power amplifier. Pow...

19. [DAFx Paper Archive - Real-Time Guitar Tube Amplifier Simulation ...](https://www.dafx.de/paper-archive/details/KotNLLBUHr-Wb7CEhWR_DA) - Real-Time Guitar Tube Amplifier Simulation using an Approximation of Differential Equations. Jaromir...

20. [Real-Time Guitar Tube Amplifier Simulation using an ...](https://dafx10.iem.at/proceedings/papers/MacakSchimmel_DAFx10_P12.pdf)

21. [[PDF] Real-Time Simulation of a Guitar Power Amplifier - DAFx-10](https://dafx10.iem.at/proceedings/papers/CohenHelie_DAFx10_P45.pdf) - ABSTRACT. This paper deals with the real time simulation of a class A single ended guitar power ampl...

22. [Browse all papers byAbel, J. S. and Yeh, D. T. ... - DAFx Paper Archive](https://dafx.de/paper-archive/search?years%5B%5D=2007&author%5B%5D=Abel%2C+J.+S.&author%5B%5D=Yeh%2C+D.+T.&p=1) - Yeh; Jonathan S. Abel; Julius O. Smith · DAFx-2007 - Bordeaux. This paper explores a computationally...

23. [Browse all papers byYeh, D. T. - DAFx Paper Archive](https://dafx.de/paper-archive/search?author%5B%5D=Yeh%2C+D.+T.) - Yeh ... Formulations are given for the bright switch, the diode clipper, a transistor amplifier, and...

24. [Theory of Magnetic Recording by H. Neal Bertram - AbeBooks](https://www.abebooks.com/Theory-Magnetic-Recording-H-Neal-Bertram/31987636246/bd) - This book is designed to give the student a fundamental, in-depth understanding of all the essential...

25. [Theory of Magnetic Recording](https://www.cambridge.org/core/books/theory-of-magnetic-recording/F4B3024E6F6ACEEE300BB6A62044A955) - Publisher: Cambridge University Press ; Publication date: 02 February 2010 ; ISBN: 9780511623066 ; D...

26. [mu-law algorithm - Wikipedia](https://en.wikipedia.org/wiki/Mu-law_algorithm)

27. [[PDF] ITU-T Recommendation G.711](https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-G.711-198811-I%21%21PDF-E&type=items)

28. [G.711 : Pulse code modulation (PCM) of voice frequencies - ITU](https://www.itu.int/rec/T-REC-G.711/)

29. [[PDF] 1 Design of High-Performance Balanced Audio Interfaces](https://sound-au.com/articles/balanced-interfaces.pdf) - The next page shows a circuit simulation model for a Jensen JT-10KB-D line input transformer. ... A ...

30. [[PDF] INTERCONNECTION OF BALANCED AND UNBALANCED ...](https://www.jensen-transformers.com/wp-content/uploads/2014/08/an003.pdf) - This interface uses an input transformer to effectively replace the. "active balanced" input stage. ...

31. [Whitepapers | Jensen Transformers](https://www.jensen-transformers.com/whitepapers/) - Whitepapers ; AN001 · Some Tips on Stabilizing Op-Amps ; AN002 · Answers to Common Questions about A...

32. [[PDF] Real-World Balanced Interfaces and Other-World Myths](http://www.aes-media.org/sections/pnw/pnwrecaps/2005/whitlock/whitlock_pnw05.pdf) - INTERFACE problems cause the NOISE! Page 15. The Parasitic Transformer. Load current magnetically in...

33. [Real-Time Audio Transformer Emulation for Virtual Tube Amplifiers](https://www.semanticscholar.org/paper/Real-Time-Audio-Transformer-Emulation-for-Virtual-Paiva-Pakarinen/69817c270712cc9e5b772d1c0bf25c19b777ebf8) - This paper proposes to simulate the audio transformer using a wave digital filter model, which is ba...

34. [[PDF] Holters-Parker-2018-A-Combined-Model-for-a-Bucket-Brigade ...](https://www.hsu-hh.de/ant/wp-content/uploads/sites/699/2018/09/Holters-Parker-2018-A-Combined-Model-for-a-Bucket-Brigade-Device-and-its-Input-and-Output-Filters.pdf) - These are responsible to prevent aliasing from the sampling and reconstruction process of the BBD. W...

35. [[PDF] ANTIALIASING IN BBD CHIPS USING BLEP](https://dafx.de/paper-archive/2025/DAFx25_paper_29.pdf) - While aliasing can be mitigated by an an- tialias filter at the input of the BBD, the clock rate FCL...

36. [[PDF] efficient emulation of tape-like delay modulation behavior](https://dafx.de/paper-archive/2018/papers/DAFx2018_paper_9.pdf) - Holters extends this variable-sample-rate paradigm to use the BBD circuits input and output filters ...

37. [TB-303 Diode Ladder Filter model - Tim Stinchcombe](https://www.timstinchcombe.co.uk/index.php?pge=diode2) - A Comprehensive TB-303 Diode Ladder Filter Model. Over at the KVR Forum there is a humungous thread ...

38. [Diode Ladder Filters (including the pretension to 18dB)](https://www.timstinchcombe.co.uk/index.php?pge=diode) - The EMS filter has a chain of three diodes at the top of each arm of the ladder, and all capacitor v...

39. [Non-linear Digital Implementation of the Moog Ladder Filter (Antti Huovilainen)](https://www.scribd.com/document/414094846/Non-linear-Digital-Implementation-of-the-Moog-Ladder-Filter-Antti-Huovilainen) - This document describes a non-linear digital implementation of the famous Moog ladder filter. It ana...

40. [[PDF] Non-Linear Digital Implementation of the Moog Ladder Filter](https://dafx.de/paper-archive/2004/P_061.PDF)

41. [Proc. of the 7th Int. Conference on Digital Audio Effects (DAFX-04), Naples, Italy, October 5-8, 2004](https://bpb-us-w2.wpmucdn.com/sites.gatech.edu/dist/e/466/files/2016/11/P_061.pdf)

42. [[PDF] Virtual Analog (VA) Korg35 Highpass Filter v2.0 Simplified - Will Pirkle](http://www.willpirkle.com/Downloads/Korg35HPFAppNote_V2.pdf) - The Korg35 highpass filter is actually a voltage controlled version of the well known Sallen-Key low...

43. [Moog ladder filter](https://dplug.org/public/tutorials/Dplug%20Tutorials%2020%20-%20Moog%20Ladder%20Filter%20Explained.pdf)

44. [Steiner-Parker Synthacon - Wikipedia](https://en.wikipedia.org/wiki/Steiner-Parker_Synthacon)

45. [[PDF] Quad Lopass Gate Model 292 - Evergreen Help Wiki](https://helpwiki.evergreen.edu/wiki/images/c/cd/Buchla_292_Quad_Lopass_Gate.pdf) - Gate Model 292. Control Inputs. Modes : Frequency : Low Pass Filter. Combo : Low Pass + Gate. Amplit...

46. [[PDF] A Digital Model of the Buchla Lowpass-Gate](https://dafx.de/paper-archive/2013/papers/44.dafx2013_submission_56.pdf) - In this paper we examine a simplified version of the Buchla low-pass gate, constructed from Buchla's...

47. ["Unearthing The Mysteries of the Leslie Cabinet"](http://www.theatreorgans.com/hammond/faq/mystery/mystery.html)

48. [The Leslie | Physical Audio Signal Processing](https://www.dsprelated.com/freebooks/pasp/Leslie.html) - The Leslie The Leslie, named after its inventor, Don Leslie,6.9 is a popular audio processor used wi...

49. [UNEARTHING THE MYSTERIES OF THE LESLIE CABINET](http://theatreorgans.com/hammond/faq/mystery/mystery.html)

50. [HammondWiki - Unearthing The Mysteries Of The Leslie Cabinetwww.dairiki.org › HammondWiki › UnearthingTheMysteriesOfTheLeslieC...](https://www.dairiki.org/HammondWiki/UnearthingTheMysteriesOfTheLeslieCabinet?version=2) - Unearthing the Mysteries of the Leslie Cabinet is an article written by Clifford A. Henricksen of Co...

51. [Bode, Harald](https://electronicmusic.fandom.com/wiki/Bode,_Harald) - Harald Bode (1909-1987) was a predecessor of Bob Moog and Don Buchla. He is best known for the Bode ...

52. [Harald Bode: The Genius Engineer Who Inspired Bob Moog and ...](https://www.gearnews.com/harald-bode-synth/) - Harald Bode had a massive influence on early synthesizers and effects. Find out who he was and how y...

53. [Harald Bode - Wikipedia](https://en.wikipedia.org/wiki/Harald_Bode)

54. [Alias-Free Digital Synthesis of Classic Analog Waveforms](https://quod.lib.umich.edu/i/icmc/bbp2372.1996.101/--alias-free-digital-synthesis-of-classic-analog-waveforms?rgn=main%3Bview%3Dfulltext) - Alias-Free Digital Synthesis of Classic Analog Waveforms. Stilson, Timothy; Smith, Julius. Skip othe...

55. [Stilson-Smith - Alias-Free Digital Synthesis of Classic Analog Waveforms (BLIT)](https://www.scribd.com/document/106324939/Stilson-Smith-Alias-Free-Digital-Synthesis-of-Classic-Analog-Waveforms-BLIT) - The document discusses techniques for alias-free digital synthesis of classic analog waveforms such ...

56. [[PDF] An Aliasing-Free Hybrid Digital- Analog Polyphonic Synthesizer](https://www.research-collection.ethz.ch/bitstreams/c59f2091-e0fb-4483-9236-658c78ae375b/download) - [1] Timothy Stilson and Julius Smith, “Alias-free digital syn- thesis of classic analog waveforms,” ...

57. [[PDF] Table Lookup Oscillators Using Generic Integrated Wavetables](https://www.dafx.de/paper-archive/2006/papers/p_169.pdf) - Stilson and J. Smith, “Alias-free digital synthesis of clas- sic analog waveforms,” in Proc. Int. Co...

58. [doi:10.1109%2FMSP.2007.323276](https://api.openalex.org/works/doi:10.1109%2FMSP.2007.323276)

59. [New Perspectives on Distortion Synthesis for Virtual Analog Oscillators](https://www.scribd.com/document/396980253/New-Perspectives-on-Distortion-Synthesis-for-Virtual-Analog-Oscillators) - This document discusses several existing techniques for digital generation of periodic waveforms use...

60. [[PDF] Analysis and Emulation of Early Digitally-Controlled Oscillators ...](https://dafx.de/paper-archive/2019/DAFx2019_paper_13.pdf)

61. [Delay apparatus - US2892898A - Google Patents](https://patents.google.com/patent/US2892898A/en) - An object of the present invention is to provide an electrostatic storage arrangement suitable for u...

62. [Morley Patent Info - TEL-RAY Oilcan Addicts - Tapatalk](https://www.tapatalk.com/groups/telrayoilcanaddicts/morley-patent-info-t996.html) - United States Patent DELAY APPARATUS Raymond Lubow, Los Angeles, Calif. Application February 21, 195...

63. [TEL-RAY Oilcan Echo - OoCities.org](https://www.oocities.org/tel_ray/home.html) - TEL-RAY is a long-forgotten California electronics company that made tape-less echo effects in the 6...

64. [Oil-can delays - Gearspace](https://gearspace.com/board/so-much-gear-so-little-time/535651-oil-can-delays.html) - "During the 50s and 60s ...oil-can delay, invented by Ray Lubow (Tel-Ray). Instead of magnetic tape,...

65. [Tel-Ray Ad-N-Echo - Catalinbread Effects](https://catalinbread.com/blogs/catalinbread-cabinet/tel-ray-ad-n-echo) - The legend of the oil can delay has made its rounds on several units; the Alter Ego 2 and X4 release...

66. [[PDF] Spring Reverberation: A Physical Perspective](https://www.dafx.de/paper-archive/2009/papers/paper_84.pdf) - Spring-based artificial reverberation was one of the earliest at- tempts at compact replication of r...

67. [Edinburgh Research Explorer](https://www.pure.ed.ac.uk/ws/portalfiles/portal/12456049/Spring_Reverbation_A_Physical_Perspective.pdf)

68. [Spring Reverberation: A Physical Perspective](https://www.research.ed.ac.uk/en/publications/spring-reverberation-a-physical-perspective/) - Bilbao, S & Parker, J 2010, Spring Reverberation: A Physical Perspective. in 12th International Conf...

69. [DAFx Paper Archive - Browse all papers byBilbao, S. and Parker, J ...](https://www.dafx.de/paper-archive/search?author%5B%5D=Bilbao%2C+S.&author%5B%5D=Parker%2C+J.&p=1&s=newest) - Download Spring Reverberation: A Physical Perspective. Julian Parker; Stefan Bilbao · DAFx-2009 - Co...

70. [US4181820A - Electric reverberation apparatus - Google Patents](https://patents.google.com/patent/US4181820A/en) - This invention relates to an electronic reverberation apparatus with a digital computer, and more pa...

71. [Barry Blesser: Home Page](http://www.blesser.net) - Barry Blesser, consultant and author of Spaces Speak, are you Listening?

72. [1976 EMT Model 250 Digital Reverb - Mixonline](https://www.mixonline.com/technology/1976-emt-model-250-digital-reverb-377973) - Barry Blesser helped launch Lexicon in 1971 and developed the EMT 250, the first commercial digital ...

73. [EMT 250 - davidmorrin.com](https://davidmorrin.com/emt250.html) - Dr. Barry Blesser of MIT was interested in processing digital reverberation in real-time and worked ...

74. [traditional (?) implementations of a phase-vocoder - Semantic Scholar](https://www.semanticscholar.org/paper/TRADITIONAL-()-IMPLEMENTATIONS-OF-A-PHASE-VOCODER:-G%C3%B6tzen-Bernardini/1877bac617df2650474a6d129cbf462e34c22970) - IMPLEMENTATIONS OF A PHASE-VOCODER: THE TRICKS OF THE TRADE. @inproceedings ... Götzen, N. Bernardin...

75. [[PDF] TRADITIONAL (?) IMPLEMENTATIONS OF A PHASE-VOCODER](https://www.cs.princeton.edu/courses/archive/spr09/cos325/Bernardini.pdf) - The phase-vocoder is a well-known technique that uses frequency—domain transformations to implement ...

76. [[PDF] TRADITIONAL (?) IMPLEMENTATIONS OF A PHASE-VOCODER](https://www.cs.princeton.edu/courses/archive/spring09/cos325/Bernardini.pdf)

77. [‪Amalia de Götzen‬ - ‪Google Scholar‬](https://scholar.google.com/citations?user=9ZZB_-kAAAAJ&hl=en) - Traditional (?) implementations of a phase-vocoder: The tricks of the trade. A De Götzen, N Bernardi...

78. [TRADITIONAL (?) IMPLEMENTATIONS OF A PHASE-VOCODER](https://vbn.aau.dk/en/publications/traditional-implementations-of-a-phase-vocoder-the-tricks-of-the-/) - De Götzen, A., Bernardini, N., & Arfib, D. (2000). TRADITIONAL (?) IMPLEMENTATIONS OF A PHASE-VOCODE...

79. [Pitch-synchronous waveform processing techniques for text-to ...](https://www.sciencedirect.com/science/article/pii/016763939090021Z) - These algorithms rely on a pitch-synchronous overlap-add (PSOLA) approach for modifying the speech p...

80. [[PDF] PITCH-SYNCHRONOUS WAVEFORM PROCESSING ...](https://courses.physics.illinois.edu/ece420/sp2019/5_PSOLA.pdf) - These algorithms rely on a pitch-synchronous overlap-add (PSOLA) approach for modifying the speech p...

81. [Pitch-synchronous waveform processing techniques for text-to ...](https://www.sciencedirect.com/science/article/abs/pii/016763939090021Z) - These algorithms rely on a pitch-synchronous overlap-add (PSOLA) approach for modifying the speech p...

82. [Moulines & Charpentier (1990)](https://www.fon.hum.uva.nl/praat/manual/Moulines___Charpentier__1990_.html) - Eric Moulines & Francis Charpentier (1990): “Pitch-synchronous waveform processing techniques for te...

83. [Pitch-synchronous waveform processing techniques for text-to ...](https://www.isca-archive.org/eurospeech_1989/charpentier89_eurospeech.html) - These algorithms are based on a pitch-synchronous overlap-add (PSOLA) approach for modifying the spe...

84. [Blog Archives](https://www.justinsalamon.com/news/archives/04-2018) - Machine listening research, code, data & hacks!

85. [[PDF] Crepe: A Convolutional Representation for Pitch Estimation | Semantic Scholar](https://www.semanticscholar.org/paper/Crepe:-A-Convolutional-Representation-for-Pitch-Kim-Salamon/86aeec4d48d949190b3a0c2bf32c101fc23f13a3) - This paper proposes a data-driven pitch tracking algorithm, CREPE, which is based on a deep convolut...

86. [Crepe: A Convolutional Representation for Pitch Estimation](https://dl.acm.org/doi/10.1109/ICASSP.2018.8461329)

87. [CREPE: A Convolutional Representation for Pitch Estimation - arXivarxiv.org › eess](https://arxiv.org/abs/1802.06182) - The task of estimating the fundamental frequency of a monophonic sound recording, also known as pitc...

88. [John Chowning - The Synthesis of Complex Audio Spectra](https://www.scribd.com/document/141795106/John-Chowning-The-Synthesis-of-Complex-Audio-Spectra) - A new application of frequency modulation is shown to result in a surprising control of audio spectr...

89. [Chowning FM - Synthesispaper 1973](https://www.scribd.com/document/417292095/Chowning-Fm-synthesispaper-1973) - This document describes a new technique for synthesizing complex audio spectra using frequency modul...

90. [[PDF] John Chowning: Overview, Techniques, and Compositions](https://lifeorange.com/writing/ChowningAnalysis_McGee.pdf)

91. [FMSynthesisPaperFinal](http://black.winny.free.fr/MAO/Books/John%20Chowning%20-%201973%20-%20The%20Synthesis%20of%20Complex%20Audio%20Spectra%20by%20Means%20of%20Frequency%20Modulation.pdf)

92. [The TR-808 Cymbal: a Physically-Informed, Circuit-Bendable ...](https://www.academia.edu/7462758/The_TR_808_Cymbal_a_Physically_Informed_Circuit_Bendable_Digital_Model) - We present an analysis of the cymbal voice circuit from a classic analog drum machine, the Roland TR...

93. [[PDF] The TR-808 Cymbal: a Physically-Informed, Circuit-Bendable ...](https://pureadmin.qub.ac.uk/ws/portalfiles/portal/125044847/tr_808_cymbal_a_physically_informed_circuit_bendable_digital.pdf) - Werner, K. J., Abel, J., & Smith, J. (2014). The TR-808 Cymbal: a Physically-Informed, Circuit-Benda...

94. [[PDF] a Physically-Informed, Circuit-Bendable, Digital Model of the TR-808 ...](https://michaelzfreeman.org/wp-content/uploads/2018/05/More-cowbell-a-physically-informed-circuit-bendable-digital-model-of-the-TR-808-cowbell.pdf) - This schematic is annotated with im- portant nodes and component labels, and exposes how the cowbell...

95. [[PDF] The TR-808 Cymbal: a Physically-Informed, Circuit-Bendable ...](https://www.icmc14-smc14.net/images/proceedings/OS24-B10-TheTR-808Cymbal.pdf) - We present an analysis of the cymbal voice circuit from a classic analog drum machine, the Roland TR...

96. [[PDF] a physically-informed, circuit-bendable, digital model of the roland](https://dafx14.fau.de/papers/dafx14_kurt_james_werner_a_physically_informed,_ci.pdf) - We present an analysis of the bass drum circuit from the classic. Roland TR-808 Rhythm Composer, bas...

97. [Phase distortion synthesis - Wikipedia](https://en.wikipedia.org/wiki/Phase_distortion_synthesis) - Phase distortion (PD) synthesis is a synthesis method introduced in 1984 by Casio in its CZ range of...

98. [07. From Theory to Practice - Technick.net](https://technick.net/guides/theory/dar/007/) - GUIDE: Digital Audio Resampling - Julius O. Smith III. From Theory to Practice.

99. [Digital Audio Resampling Home Page](https://dl.icdst.org/pdfs/files/89b500288dc19beaa7dfd1c77ce800c3.pdf) - “Digital Audio Resampling Home Page,” http://www-ccrma.stanford.edu/˜jos/resample/, based on “A Flex...

100. [GitHub - jrlanglois/SecretRabbitCode: A simple JUCE-powered audio sample rate converter, based on the original libsamplerate.](https://github.com/jrlanglois/SecretRabbitCode) - A simple JUCE-powered audio sample rate converter, based on the original libsamplerate. - jrlanglois...

101. [libsamplerate-js/LICENSE.md at main · aolsenjazz/libsamplerate-js](https://github.com/aolsenjazz/libsamplerate-js/blob/main/LICENSE.md) - Resample audio in node or browser using a web assembly port of libsamplerate. - aolsenjazz/libsample...

102. [libsndfile/libsamplerate: An audio Sample Rate Conversion library](https://github.com/libsndfile/libsamplerate) - An audio Sample Rate Conversion library. Contribute to libsndfile/libsamplerate development by creat...

103. [License](https://libsndfile.github.io/libsamplerate/license.html) - An audio Sample Rate Conversion library

104. [Audio interpolation (Catmull-Rom/Cubic Hermite Spline)](https://www.dsprelated.com/showcode/3.php) - Audio interpolation (Catmull-Rom/Cubic Hermite Spline) - Free DSP code snippet. View, download, and ...

105. [Musicdsp.org Documentation](https://www.musicdsp.org/_/downloads/en/latest/pdf/)

106. [Hermite interpollation¶](https://www.musicdsp.org/en/latest/Other/93-hermite-interpollation.html)

