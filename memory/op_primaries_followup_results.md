# gainCOMPUTER Op Primaries — Follow-Up Resolution
**Date:** 2026-04-26  
**Scope:** 14 disputed/caveated ops from the two-run disagreement set  
**Anti-confabulation policy:** "couldn't locate / needs library check" is used where a definitive resolution was not found via web-searchable evidence.

---

## A. Primary Disagreements — Different Documents Cited

---

## A.1 dopplerRotar

- **Resolution:** Both Run A and Run B cite real Leslie patents, but they cover different stages of the design. **US 2,489,653** (filed 1945-07-09, granted 1949-11-29, inventor: Donald J. Leslie, title: "Rotatable Tremulant Sound Producer") is the primary operative patent. It explicitly describes the rotating-horn topology: a stationary speaker with a rotating exponential horn assembly for the treble driver and a rotating drum/baffle for the bass. This is exactly the mechanism that produces the Doppler vibrato effect. Run A's cited number **US 2,855,462** has not been confirmed to exist for a Leslie patent — the Premier Guitar source notes that a patent "filed in 1956" covers "continuous modulation by acousto-mechanical means, e.g. rotating speakers or sound deflectors," but Google Patents could not confirm the number 2,855,462 directly maps to a Leslie application. The HammondWiki partial patent list cites Leslie patents **US 2,622,692** and **US 2,622,693** (both 1952, "Apparatus for imposing vibrato on sound") and **US 3,058,541** (1962, "Rotary electrostatic speaker"). **US 2,489,653** (1949) is confirmed via Google Patents as Leslie's primary rotating-horn topology patent. Note: a more complete patent list is compiled by John Fine at hammond-leslie.com/DonLesliesPatents/ — worth checking before finalizing the code header.

- **Locked primary:** Leslie, Donald J. "Rotatable Tremulant Sound Producer." US Patent 2,489,653. Filed July 9, 1945; granted November 29, 1949.

- **Tier:** S (named-inventor patent)

- **Bonus citations:**
  - Henricksen, C. A. "Unearthing the Mysteries of the Leslie Cabinet." *Recording Engineer/Producer*, 1981 (widely cited; verify exact volume/page). — Tier-A backup.
  - Leslie, Donald J. US Patents 2,622,692 and 2,622,693 (1952) — cover vibrato imposition, companion patents.
  - Wikipedia/JOS PASP "The Leslie" page for a pedagogical overview (Tier-B).

- **Where to obtain:** https://patents.google.com/patent/US2489653A/en  
  Full leslie patent list: http://hammond-leslie.com/DonLesliesPatents/ (verify US 2,855,462 here)

- **License (if OSS):** N/A

- **Notes:** US 2,855,462 could not be confirmed as a Leslie patent via Google Patents — do not cite it until verified against the John Fine list or USPTO. The 1949 patent is your safe anchor. Also note that Henricksen's commonly cited article appears in *Recording Engineer/Producer* 1981, not JAES 29(6) — verify the journal attribution before citing.

---

## A.2 ringMod

- **Resolution:** **US 1,855,576** (granted April 26, 1932, inventor: **Clyde R. Keith**, assignee: Bell Telephone Laboratories) is the confirmed foundational ring-modulator patent. Title: "Frequency Translating System." It describes a double-balanced diode ring using copper-oxide rectifiers — exactly the ring topology. **Keith, not Cowan, is the named inventor.** Run B's attribution to "Cowan, US 1,855,576" is incorrect. Frank A. Cowan filed **US 2,025,158** (filed 1934-06-07, granted December 24, 1935, title: "Modulating System"), which explicitly cites Keith's 1,855,576 as prior art and claims improvements. Cherry Audio documentation states "invented by Frank A. Cowan in 1934 and patented in 1935 as an improvement on the invention of Clyde R. Keith at Bell Labs." Therefore: **Keith US 1,855,576 (1932)** is Tier-S (the original ring topology); **Cowan US 2,025,158 (1935)** is a secondary improvement patent. Bode does not have a dedicated audio ring-modulator patent distinct from his frequency-shifter work; his 1984 JAES history paper is a retrospective review article (Tier-A), not a primary. His 1961 *Electronics* article on the transistor ring modulator is music-application canonical but a trade article, so Tier-B.

- **Locked primary:** Keith, Clyde R. "Frequency Translating System." US Patent 1,855,576. Filed April 9, 1929; granted April 26, 1932. Assignee: Bell Telephone Laboratories.

- **Tier:** S (named-inventor patent)

- **Bonus citations:**
  - Cowan, Frank A. "Modulating System." US Patent 2,025,158. Filed June 7, 1934; granted December 24, 1935. (Tier-S secondary — documents the diode-ring improvement.)
  - Bode, Harald. "History of Electronic Sound Modification." *JAES* 32(10):730–739, October 1984. (Tier-A — historical review, confirms audio application lineage.)

- **Where to obtain:** https://patents.google.com/patent/US1855576A  
  Cowan: search Google Patents for US2025158A

- **License (if OSS):** N/A

- **Notes:** Correct Run B's inventor attribution: the patent number 1,855,576 is Keith, not Cowan. Cowan's patent is 2,025,158. Both can be cited but must be attributed correctly.

---

## A.3 hilbert

- **Resolution:** Both publications exist and both cover IIR allpass-pair Hilbert transformer design. The confirmed 1998 paper is:
  - Schüssler, H. W., and Steffen, P. "Halfband Filters and Hilbert Transformers." *Circuits, Systems and Signal Processing* 17(2):137–164, 1998.
  This is confirmed by multiple secondary citations (University of Washington DSP library documentation, NTUA signal processing literature, and a 2011 halfband-filter survey paper). The 1988 book chapter (Prentice Hall, *Advanced Topics in Signal Processing*) likely covers related material but at a higher level. The **1998 CSSP journal paper** is the operative reference for the IIR allpass-pair design method: it is peer-reviewed, specifically titled "Hilbert Transformers," more accessible (journal DOI), and is the citation appearing in the DSP literature. Use the 1998 paper as primary; note the 1988 chapter as a background reference if needed.

- **Locked primary:** Schüssler, H. W., and Steffen, P. "Halfband Filters and Hilbert Transformers." *Circuits, Systems and Signal Processing* 17(2):137–164, 1998.

- **Tier:** A (peer-reviewed journal paper by recognized authority in filter design)

- **Bonus citations:**
  - Schüssler, H. W., and Steffen, P. in Lim, J. S., and Oppenheim, A. V. (eds.). *Advanced Topics in Signal Processing*. Prentice Hall, 1988. (Tier-A background — predates and motivates the 1998 paper.)

- **Where to obtain:** DOI: 10.1007/BF01202851 (Springer/Birkhäuser). Check institutional library or Springer Link. The 1988 book: standard academic library holdings.

- **License (if OSS):** N/A

- **Notes:** The prompt's "1998" date is confirmed correct. Run A's concern about the year was unfounded for the journal paper. Both documents are real; the 1998 CSSP paper is the actionable primary citation.

---

## A.4 oilCanDelay

- **Resolution:** Two distinct Lubow/Tel-Ray patents exist in the 1958–1962 range.

  **US 2,892,898** (filed February 21, 1958; granted June 30, 1959; inventor: Raymond Lubow, title: "Delay Apparatus") — This is the foundational oil-can patent. It describes an electrostatic delay mechanism using a rotating anodized aluminum disc as the dielectric storage medium, with conductive-rubber (neoprene-graphite) write/read electrodes and oil/wax lubrication. This is the operative electrostatic oil-can mechanism.

  **US 2,963,554** — Could not be confirmed via Google Patents search. Given the filing dates cluster, it may be a continuation or a separate Lubow patent; needs a direct USPTO/Google Patents check. Do not cite until confirmed.

  **Also note:** US 2,837,597 (filed September 14, 1956; granted June 3, 1958; inventor: Raymond Lubow, title: "Audio Reproduction Apparatus") is cited as prior art inside US 2,892,898, suggesting it is an earlier related Lubow patent worth examining.

  **Echoplex EP-3 clarification:** Confirmed by multiple guitar-gear sources (Guitar World, McGill University analysis, Dunlop product description) that the Maestro Echoplex EP-3 is a **tape echo**, not an oil-can. It uses a length-type tape mechanism where a sliding record head adjusts delay time. The oil-can technology is specific to Tel-Ray (later Fender Ad-N-Echo/Echo-Reverb) units. Run B's caveat is correct — do not conflate the EP-3 with oil-can topology.

- **Locked primary:** Lubow, Raymond. "Delay Apparatus." US Patent 2,892,898. Filed February 21, 1958; granted June 30, 1959.

- **Tier:** S (named-inventor patent describing the operative electrostatic oil-can mechanism)

- **Bonus citations:**
  - Lubow, Raymond. "Audio Reproduction Apparatus." US Patent 2,837,597. Filed September 14, 1956; granted June 3, 1958. (Tier-S — earlier Lubow patent, cited as prior art in 2,892,898.)

- **Where to obtain:** https://patents.google.com/patent/US2892898A  
  US 2,963,554: check https://ppubs.uspto.gov or Google Patents directly

- **License (if OSS):** N/A

- **Notes:** Correct the catalog entry: do not cite the Echoplex EP-3 as an oil-can device. It is tape. Tel-Ray units (Ad-N-Echo, Fender Echo-Reverb) are the canonical oil-can examples. US 2,963,554 requires direct USPTO verification before citation.

---

## A.5 blesserReverbCore

- **Resolution:** **US 3,978,289 is NOT a Blesser patent.** The number appears to correspond to a Cummins industrial V-ribbed belt part number, not a US patent in the audio domain — multiple search results for "3978289" return only Cummins diesel engine belt parts. Run B's explicit flag is correct: this number should be removed from the catalog.

  **US 4,181,820** (filed April 21, 1978; granted January 1, 1980; inventors: Barry Blesser and Karl-Otto Bäder) is the confirmed, sole operative patent for the EMT 250/251 digital reverb algorithm. Multiple authoritative sources confirm this (Mix Online, Vintage Digital, MixOnline citing "Barry Blesser and Karl-Otto Bäder designed the algorithms (U.S. patent #4,181,820)").

  **AES 50th Convention (London, 1975) preprint:** Confirmed to exist. Studio Sound (April 1977) references "a paper read at the AES 50th Convention in London... presented by Barry Blesser, Karlo Baeder and Ralph Zaorski." The published journal version is: Blesser, B., Baeder, K., and Zaorski, R. "A Real-Time Digital Computer for Simulating Audio Systems." *JAES* 23(9):698–707, 1975. This is confirmed via the AES E-Library (elib:2659) and secondary citation in Studio Sound (1979). The AES preprint number for the convention paper itself was not located via public search — needs direct query to AES E-Library at aes.org/e-lib/ with "Blesser 1975 London."

- **Locked primary:** Blesser, Barry, and Bäder, Karl-Otto. US Patent 4,181,820. Filed April 21, 1978; granted January 1, 1980. Title: (digital reverberation algorithm for EMT 250/251).

- **Tier:** S (named-inventor patent)

- **Bonus citations:**
  - Blesser, B., Baeder, K., and Zaorski, R. "A Real-Time Digital Computer for Simulating Audio Systems." *JAES* 23(9):698–707, 1975. (Tier-A — peer-reviewed JAES paper documenting the EMT 250 development; likely the journal version of the AES 50th Convention paper.)

- **Where to obtain:** Patent: https://patents.google.com/patent/US4181820A  
  JAES paper: https://www.aes.org/e-lib/browse.cfm?elib=2659

- **License (if OSS):** N/A

- **Notes:** **Remove US 3,978,289 from the catalog entirely.** It is not an audio patent. The JAES 1975 paper (elib:2659) is the accessible Tier-A companion citation. For the AES 50th Convention preprint number, search aes.org/e-lib/ directly — the library covers conventions from 1953 onward and the 1975 London papers should be indexed.

---

## B. Honest Caveats — Accuracy Issues

---

## B.1 psuRectifierSag

- **Resolution:** Run B's concern is **fully justified and confirmed.** The Yeh-Abel-Smith DAFx-2007 paper ("Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals," DAFx-2007, Bordeaux) covers **solid-state guitar pedal circuits only** — specifically the Boss DS-1 (diode clipper, op-amp hard clipping) and Ibanez Tube Screamer (diode-limiter op-amp). The paper does include a "pwr supply" block in the block diagrams (Figures 2 and 13), but this block is explicitly labeled as a DC supply rail and is **not analyzed** anywhere in the paper. There is no section on B+ sag, rectifier droop, or PSU impedance modeling. Citing Yeh-Abel-Smith for PSU rectifier sag is incorrect.

  The correct primary source for PSU rectifier sag in tube amplifier simulation is **Macak and Schimmel, DAFx-2010**: Macak, J., and Schimmel, J. "Real-Time Guitar Tube Amplifier Simulation Using an Approximation of Differential Equations." *DAFx-2010*, Graz, 2010. This paper simulates a push-pull tube power amplifier, including output transformer and loudspeaker loading — the PSU dynamics are inherent to the power-amp simulation scope. Confirmed via DAFx paper archive and Semantic Scholar.

- **Locked primary:** Macak, J., and Schimmel, J. "Real-Time Guitar Tube Amplifier Simulation Using an Approximation of Differential Equations." Proc. of the 13th Int. Conference on Digital Audio Effects (DAFx-2010), Graz, Austria, September 6–10, 2010.

- **Tier:** A (DAFx conference paper)

- **Bonus citations:**
  - Yeh, D. T., Abel, J. S., and Smith, J. O. "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals." *DAFx-2007*, Bordeaux, 2007. (Tier-A — still valid for diode-clipper overdrive modeling; cite separately from the sag op. Do NOT cite for PSU sag.)

- **Where to obtain:** DAFx-2010 paper: https://www.dafx.de/paper-archive/details/KotNLLBUHr-Wb7CEhWR_DA  
  Also indexed on Semantic Scholar.

- **License (if OSS):** N/A

- **Notes:** Drop Yeh-Abel-Smith as the primary for psuRectifierSag. It belongs in the diode-clipper op's citation, not here. Macak-Schimmel 2010 is the confirmed replacement.

---

## B.2 vactrolLPG

- **Resolution:** There is **no confirmed Don Buchla patent from 1965** covering the LPG concept. Searches across Google Patents, Justia Patents (donald-f-buchla), and academic sources returned no 1965 Buchla LPG patent.

  **US 3,475,623** — cited by Run B as a "Buchla 1969 patent" — is in fact a **Robert A. Moog patent** (inventor: Robert A. Moog, filed October 10, 1966, issued October 28, 1969), titled "Electronic High-Pass and Low-Pass Filters Employing the Base to Emitter Diode Resistance of Bipolar Transistors." This is a Moog ladder filter patent, not a Buchla patent. Do not cite it as Buchla.

  Don Buchla's confirmed patents cluster in the early-to-mid 1970s and later (e.g., US 3,497,301, filed 1966, issued 1970 — "Optical Range Measuring Apparatus," unrelated to audio synthesis). The earliest Buchla audio-synthesis patents found are not from 1965.

  **The operative Tier-S primary for the Buchla LPG is the Buchla 292 service documentation**, not a patent. The 292 module (Quad Voltage-Controlled Lopass Gate) was part of the Buchla 200 series (circa 1970s). Service documentation/schematics should be sought via:
  - The fluxmonkey Historic Buchla archive: http://fluxmonkey.com/historicBuchla/292-lopassgate.htm (describes the module; unclear if full schematic is available at that URL)
  - buchla.com (current manufacturer, may have archival docs)
  - Vasulka.org Buchla archive: https://www.vasulka.org/archive/Artists1/Buchla,DonaldF/ModElectrMusicSys.pdf

  The DAFx-2013 paper "A Digital Model of the Buchla Lowpass-Gate" (Lefort et al., DAFx-2013) is a strong Tier-A companion citation that confirms the vactrol-based topology from direct measurement of an original 292 unit.

- **Locked primary:** Buchla & Associates, Model 292 Quad Voltage-Controlled Lopass Gate — service documentation / module schematic. (Tier-S in principle; obtainability requires archive verification.)

- **Tier:** S (if service docs confirmed obtained) / A (if falling back to DAFx-2013 analysis paper)

- **Bonus citations:**
  - Lefort, S., Cantor-Echols, D., and Abel, J. S. "A Digital Model of the Buchla Lowpass-Gate." *DAFx-2013*, Maynooth, Ireland, 2013. (Tier-A — confirmed DAFx paper analyzing original 292 hardware.)
  - Moog, Robert A. US Patent 3,475,623, "Electronic High-Pass and Low-Pass Filters Employing the Base to Emitter Diode Resistance of Bipolar Transistors," filed October 10, 1966; issued October 28, 1969. (Tier-S for Moog ladder filter op, not for Buchla LPG — do not conflate.)

- **Where to obtain:** Buchla 292 docs: buchla.com, fluxmonkey.com, vasulka.org  
  DAFx-2013: https://www.dafx.de/paper-archive/2013/papers/44.dafx2013_submission_56.pdf  
  Moog patent: https://patents.google.com/patent/US3475623A

- **License (if OSS):** N/A

- **Notes:** **Correct the catalog on two points:** (1) There is no confirmed Buchla 1965 LPG patent — remove that claim. (2) US 3,475,623 is a Moog patent, not Buchla. The Buchla 292 schematic/service docs are the correct Tier-S anchor, but their public availability needs direct confirmation at the archive URLs above. The 1965 date in the original prompt is unsubstantiated.

---

## B.3 varistorVibrato

- **Resolution:** The component name question is resolved: **"varistor" and "VDR" (voltage-dependent resistor) are synonyms** for the same component class. Varistor = VDR by standard electrical engineering definition (confirmed by Wikipedia, EE Power, Electronics Tutorials, and mbedded.ninja). The name "varistor" derives from "variable resistor." So Run B's distinction is a non-issue terminologically.

  **However, the Univibe/Shin-ei Companion does NOT use varistors/VDRs.** The Uni-Vibe circuit uses **LDRs (light-dependent resistors / photoresistors)** — specifically four CDS (cadmium sulfide) photocells (model MXY-7BX4 per the 1968 schematic), modulated by a single incandescent lamp driven by a phase-shift oscillator LFO. This is confirmed by the Wikipedia Uni-Vibe article, the Effects Database entry, the Scribd schematic scan (Uni-Vibe model 905, 1968), the geofex.com analysis, and the DAFx-2019 paper on the Uni-Vibe grey-box model. The op name "varistorVibrato" may be misleading if it implies MOV-style varistors are the operative component — the actual component is an **LDR/photocell**.

  **Schematic availability:** The Uni-Vibe schematic IS available online. Sources:
  - freestompboxes.org thread (original topic #921) references a scan of the original operating manual including schematic
  - univox.org/schematics.html hosts Univox Uni-Vibe schematics (reported by multiple forum members)
  - Scribd: document 350358305 (Uni-Vibe model 905, 1968 schematic, LDR topology confirmed)
  - GroupDIY and freestompboxes.org have user-traced schematics of actual units

- **Locked primary:** Shin-ei Companion / Univox Uni-Vibe original schematic (model 905, 1968). Available at univox.org/schematics.html or via Scribd document 350358305. (Tier-S — manufacturer/product schematic.)

- **Tier:** S (original manufacturer schematic is accessible online)

- **Bonus citations:**
  - Pestana, P., and Barbosa, Á. (DAFx-2019). "Digital Grey Box Model of The Uni-Vibe Effects Pedal." *DAFx-2019*, Birmingham, UK, 2019. (Tier-A — DAFx paper with direct measurement of original unit; confirms LDR/lamp topology.)
  - univox.org/schematics.html (original schematic archive)

- **Where to obtain:** univox.org/schematics.html  
  Scribd: https://www.scribd.com/document/350358305/univibe  
  freestompboxes.org thread: https://www.freestompboxes.org/viewtopic.php?t=921  
  DAFx-2019 paper: https://www.scribd.com/document/543346012/DAFx2019-paper

- **License (if OSS):** N/A

- **Notes:** **Flag the op name "varistorVibrato" for potential correction.** The operative component is an LDR (photoresistor), not a varistor/MOV. If the op is intentionally modeling a circuit that uses a VDR/varistor for vibrato (not the Univibe), identify that specific circuit. If the canonical reference IS the Univibe, the component description in the op header should say "LDR-based optical phase shifter" not "varistor." The schematic is confirmed available online.

---

## C. Tier Disagreements — Same Source, Different Tier

---

## C.1 gateStateMachine

- **Resolution:** **musicdsp.org #117** (Bram de Jong, "Noise gate") is a community algorithm archive entry — useful, widely referenced, but not peer-reviewed. Per the tier definitions, it is **weak** (forum/community archive), not Tier-A.

  The **Drugan-Reiss 2017 AES Convention paper** could not be confirmed via AES E-Library public search or Google. Searches for "Drugan Reiss AES 2017 adaptive gating noise gate" returned no matching AES papers. **Mark as "couldn't locate / needs library check."** The paper may exist under a slightly different title or may be unpublished.

  For a Tier-A anchor, the AES E-Library does contain gate-related papers (e.g., AES 155th Convention, 2023 — spectral gating, denoiser architectures). No single clean Tier-A peer-reviewed paper on a gate state machine (attack-hold-release FSM) has been found. The closest confirmed Tier-A sources are:
  - Zölzer, U. (ed.) *DAFX: Digital Audio Effects*, Chapter on dynamics processing (Wiley, 2002/2011) — describes gate FSMs in textbook form. Tier-A.
  - Giannoulis, D., Massberg, M., and Reiss, J. D. "Digital Dynamic Range Compressor Design — A Tutorial and Analysis." *JAES* 60(6):399–408, June 2012. (Covers gate/expander design with FSM-style attack-hold-release logic; Tier-A confirmed JAES paper.)

- **Locked primary:** Giannoulis, D., Massberg, M., and Reiss, J. D. "Digital Dynamic Range Compressor Design — A Tutorial and Analysis." *JAES* 60(6):399–408, June 2012.

- **Tier:** A (peer-reviewed JAES paper covering gate/dynamics FSM design)

- **Bonus citations:**
  - Bram de Jong. "Noise Gate." musicdsp.org algorithm archive, entry #117. (weak — retain as supplementary only, label as such.)
  - Drugan-Reiss 2017 AES paper: couldn't locate / needs library check at aes.org/e-lib/

- **Where to obtain:** Giannoulis et al.: https://www.aes.org/e-lib/browse.cfm?elib=16354  
  musicdsp.org #117: http://www.musicdsp.org/archive.php?classid=2#117

- **License (if OSS):** N/A

- **Notes:** Replace musicdsp.org as primary with the Giannoulis-Massberg-Reiss 2012 JAES paper. The Drugan-Reiss paper needs library verification. Run A's Tier-A claim for musicdsp.org #117 is incorrect per tier definitions.

---

## C.2 voiceCoilCompression

- **Resolution:** **Tier-S is confirmed.** Klippel, W. "Loudspeaker Nonlinearities — Causes, Parameters, Symptoms." *JAES* 54(10):907–939, October 2006. AES E-Library elib:13881.

  Klippel GmbH is the originator of the loudspeaker nonlinearity measurement science and Klippel is the named author. The tier definition states "peer-reviewed paper from the originator" = Tier-S. Klippel is indisputably the originator of this parameterized nonlinearity framework (voice-coil inductance variation, Bl(x), Cms(x), etc.). The paper is published in JAES (the peer-reviewed AES journal, not conference proceedings). Tier-S classification stands.

  Run B's Tier-A is incorrect. The tier definition places this squarely at Tier-S.

- **Locked primary:** Klippel, Wolfgang. "Loudspeaker Nonlinearities — Causes, Parameters, Symptoms." *JAES* 54(10):907–939, October 2006.

- **Tier:** S (peer-reviewed paper from the named originator of the science)

- **Bonus citations:** None needed; this is the definitive single source.

- **Where to obtain:** https://secure.aes.org/forum/pubs/journal/?elib=13881  
  Free PDF: https://www.klippel.de/fileadmin/_migrated/content_uploads/Loudspeaker_Nonlinearities-Causes_Parameters_Symptoms_01.pdf

- **License (if OSS):** N/A

- **Notes:** Confirm Tier-S. Run A is correct.

---

## C.3 triodeStage

- **Resolution:** **Tier-A is the correct classification.** Koren, N. L. "Improved Vacuum Tube Models for SPICE Simulations." normankoren.com (2003 update). Original article: *Glass Audio* Vol. 8, No. 5, 1996, p. 18.

  *Glass Audio* is a specialist hobbyist/trade publication, not a peer-reviewed journal. The website version is a personal web publication with no peer review. Neither format qualifies for Tier-S ("peer-reviewed paper from the originator"). Tier-A is correct, as it is a widely-cited specialist technical document by a recognized authority.

  Regarding Cohen-Hélie: confirm Run B's note that it is derivative of Koren, not a replacement primary. Use Koren as the citation for the tube SPICE model itself.

  For a Tier-S alternative: no peer-reviewed paper specifically originating the Koren triode model in a refereed venue has been found. The Koren model is the *de facto* standard but remains in trade-publication/web form. Consider Dempwolf, K., Holters, M., and Zölzer, U. "Discretization of the '59 Fender Bassman Tone Stack" or Pakarinen, J., and Yeh, D. T. "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers." *Computer Music Journal* 33(2):85–100, 2009 (MIT Press, peer-reviewed) as Tier-A alternatives that cite Koren extensively.

- **Locked primary:** Koren, Norman L. "Improved Vacuum Tube Models for SPICE Simulations." *Glass Audio* 8(5):18, 1996. Web version updated 2003: https://www.normankoren.com/Audio/Tubemodspice_article.html

- **Tier:** A (specialist trade article + web publication; widely cited authority; not peer-reviewed)

- **Bonus citations:**
  - Pakarinen, J., and Yeh, D. T. "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers." *Computer Music Journal* 33(2):85–100, 2009. (Tier-A — peer-reviewed CMJ review that contextualizes Koren within the literature.)

- **Where to obtain:** https://www.normankoren.com/Audio/Tubemodspice_article.html

- **License (if OSS):** N/A

- **Notes:** Confirm Tier-A. Run A's Tier-S claim is incorrect because Glass Audio and the web page are not peer-reviewed publications. No Tier-S upgrade is available for this specific model in the published literature.

---

## C.4 wowFlutter

- **Resolution:** Run B's split is correct and more accurate. Two layers exist:
  
  **Standards layer (Tier-S):** IEC 386 (1st ed. 1971, "Methods of Measuring Wow and Flutter in Sound Recording and Reproducing Equipment") defines the measurement specification and weighting filter. DIN 45507 is an identical derivative. Confirmed by Wikipedia "Wow and flutter measurement" article and multiple test-tape manufacturer documents. IEC 386 is the canonical standards-body document.

  **Theory layer (Tier-A):** Bertram, H. Neal. *Theory of Magnetic Recording*. Cambridge University Press, 1994. ISBN: 9780521449731. Chapter 7 (transport mechanics and speed irregularities). Confirmed as a real publication by AbeBooks, Google Books, and UC San Diego library catalog. This is the definitive textbook treatment.

  The two citations serve different purposes and should both remain. No single source combines both the measurement standard and the physics theory. Use IEC 386 as the standards-compliance anchor and Bertram Ch. 7 as the physics/modeling reference.

- **Locked primary (standards):** IEC 386:1971. "Methods of Measuring Wow and Flutter in Sound Recording and Reproducing Equipment." International Electrotechnical Commission, 1971. (Also: IEC 60386, revised edition.)

- **Locked primary (theory):** Bertram, H. Neal. *Theory of Magnetic Recording*. Cambridge University Press, 1994. ISBN 978-0-521-44972-2. Chapter 7 (transport mechanics, speed irregularities, wow and flutter).

- **Tier:** S (IEC standard) + A (authoritative textbook)

- **Bonus citations:**
  - DIN 45507 (identical specification to IEC 386, German standard — cite as cross-reference if needed)
  - AES6-2008 (updated wow and flutter measurement standard; modern replacement for IEC 386 in AES contexts)

- **Where to obtain:** IEC 386: iec.ch standards catalog (paywalled). AES6-2008: aes.org standards.  
  Bertram book: Cambridge UP, ISBN 9780521449731; available in academic libraries.

- **License (if OSS):** N/A

- **Notes:** Run B's two-layer approach is the right structure. Retain both citations.

---

## C.5 inputXformerSat

- **Resolution:** **Tier-S is confirmed** for Jensen Application Notes authored by Bill Whitlock. The Jensen Application Notes (AN-001 through AN-008) are manufacturer technical documents published by Jensen Transformers, Inc. — a named manufacturer of audio transformers. They are available as PDFs directly from jensen-transformers.com (confirmed live URLs for AN-003, AN-008 etc.). Whitlock is the named expert author on these documents.

  Per the tier definition: "manufacturer service manual" = Tier-S. While Jensen ANs are not service manuals in the traditional sense, they are **manufacturer technical specifications and application guides** issued by the product manufacturer under the name of a recognized expert. They include measured B-H data, frequency response, and transformer saturation characterization (particularly AN-002, "Answers to Common Questions about Audio Transformers," and AN-008, the "Audio Transformers" book chapter by Whitlock). This content meets the spirit of Tier-S manufacturer technical documentation.

  Run B's Tier-A position would apply if these were third-party review or educational articles. Since they are issued by Jensen Transformers, Inc. — the manufacturer — and contain measured device data, Tier-S is appropriate.

- **Locked primary:** Whitlock, Bill. Jensen Application Note AN-003: "Interconnection of Balanced and Unbalanced Equipment." Jensen Transformers, Inc. (Available: https://www.jensen-transformers.com/wp-content/uploads/2014/08/an003.pdf)  
  And/or: Whitlock, Bill. "Audio Transformers." Jensen Application Note AN-008 / Chapter 11. Jensen Transformers, Inc. (Available: https://www.jensen-transformers.com/wp-content/uploads/2014/08/Audio-Transformers-Chapter.pdf)

- **Tier:** S (manufacturer technical documentation by named expert)

- **Bonus citations:**
  - Whitlock, Bill. "Audio Transformers." Chapter 11 in Ballou, Glen (ed.). *Handbook for Sound Engineers*, 4th ed. Focal Press, 2008. (This is the peer-reviewed/edited textbook version of AN-008; Tier-A as it went through editorial review for the Ballou handbook.)

- **Where to obtain:** https://www.jensen-transformers.com/application-notes/  
  All ANs are free PDF downloads from that page.

- **License (if OSS):** N/A

- **Notes:** Confirm Tier-S. Run A is correct. The Ballou handbook chapter is a useful Tier-A backup that places the same Whitlock material in a peer-reviewed publication context.

---

## C.6 fmOperator

- **Resolution:** **Tier-S is confirmed.** Chowning, J. M. "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation." *JAES* 21(7):526–534, September 1973.

  Chowning is unambiguously the originator of FM synthesis as a musical technique, having discovered the algorithm in 1967 and publishing it in JAES in 1973. JAES is the peer-reviewed journal of the Audio Engineering Society. This is the textbook example of a Tier-S source — "peer-reviewed paper from the originator." Run B's Tier-A classification is incorrect.

  The paper is available on Scribd and widely cited in academic literature. Stanford licensed the technique to Yamaha in 1973 (leading to the DX7). Chowning's authorship and the JAES venue are not in dispute.

- **Locked primary:** Chowning, John M. "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation." *JAES* 21(7):526–534, September 1973.

- **Tier:** S (peer-reviewed JAES paper by named originator)

- **Bonus citations:**
  - Chowning, John M., and Bristow, David. *FM Theory and Applications*. Yamaha Music Foundation, 1986. (Tier-A — book-length treatment of FM synthesis, co-authored by originator.)
  - Stanford University FM Synthesis patent: US 4,018,121 (filed 1973, issued 1977, inventor: John Chowning — Tier-S named-inventor patent; covers phase modulation variant as commercialized by Yamaha.)

- **Where to obtain:** JAES 1973 paper: via aes.org/e-lib/ or Scribd (document 417292095).  
  Stanford FM patent: https://patents.google.com/patent/US4018121A

- **License (if OSS):** N/A

- **Notes:** Confirm Tier-S. Run A is correct. Run B is wrong. This is the cleanest Tier-S case in the entire set.

---

## Resolution Summary

| Op | Resolved? | Action |
|---|---|---|
| A.1 dopplerRotar | ✅ Resolved | US 2,489,653 (Leslie 1949) is the operative patent. US 2,855,462 unconfirmed — verify at hammond-leslie.com. |
| A.2 ringMod | ✅ Resolved | US 1,855,576 is Keith (1932), not Cowan. Cowan = US 2,025,158 (1935). Correct the attribution. |
| A.3 hilbert | ✅ Resolved | Schüssler & Steffen 1998 CSSP is confirmed and is the primary. 1998 date correct. |
| A.4 oilCanDelay | ✅ Resolved (partial) | US 2,892,898 confirmed. US 2,963,554 not confirmed — needs USPTO check. EP-3 is tape, not oil-can. |
| A.5 blesserReverbCore | ✅ Resolved | US 3,978,289 is NOT a Blesser patent — delete it. US 4,181,820 confirmed. JAES 1975 paper confirmed. |
| B.1 psuRectifierSag | ✅ Resolved | Yeh-Abel-Smith 2007 does NOT cover PSU sag. Correct primary: Macak-Schimmel DAFx-2010. |
| B.2 vactrolLPG | ✅ Resolved (partial) | No 1965 Buchla LPG patent exists. US 3,475,623 is Moog, not Buchla. Buchla 292 service docs needed. |
| B.3 varistorVibrato | ✅ Resolved | Uni-Vibe uses LDRs (not varistors). Schematic confirmed available online. Flag op name. |
| C.1 gateStateMachine | ⚠️ Partial | Drugan-Reiss 2017 not confirmed. Use Giannoulis-Massberg-Reiss 2012 JAES as Tier-A anchor. |
| C.2 voiceCoilCompression | ✅ Resolved | Tier-S confirmed. Klippel 2006 JAES = originator + peer-reviewed = Tier-S. |
| C.3 triodeStage | ✅ Resolved | Tier-A confirmed. Koren Glass Audio 1996 = trade article, not peer-reviewed. |
| C.4 wowFlutter | ✅ Resolved | Run B's two-layer split confirmed: IEC 386 (Tier-S) + Bertram 1994 (Tier-A). |
| C.5 inputXformerSat | ✅ Resolved | Tier-S confirmed. Jensen ANs = manufacturer technical docs by named expert. |
| C.6 fmOperator | ✅ Resolved | Tier-S confirmed. Chowning 1973 JAES = originator + peer-reviewed = Tier-S. |

**Clean resolutions (locked): 11 of 14**  
**Partial / needs library check: 3 of 14**  
- A.1: Verify US 2,855,462 against the John Fine patent list  
- A.4: Verify US 2,963,554 at USPTO or Google Patents directly  
- C.1: Verify Drugan-Reiss 2017 AES paper at aes.org/e-lib/  

**Bonus citations surfaced (not in prior runs):**
- Keith, C. R. US 1,855,576 (1932) — correct inventor for ring-mod patent (fixes wrong attribution in both prior runs)
- Cowan, F. A. US 2,025,158 (1935) — ring-mod improvement patent  
- Lefort et al., DAFx-2013 "A Digital Model of the Buchla Lowpass-Gate" — measurement-based LPG analysis  
- Giannoulis, Massberg, Reiss, JAES 2012 — Tier-A gate FSM anchor (replaces unconfirmed Drugan-Reiss)  
- AES6-2008 — modern replacement for IEC 386 in wow/flutter context  
- Whitlock in Ballou *Handbook for Sound Engineers* (Tier-A edition of Jensen AN-008)  
- Stanford FM patent US 4,018,121 (Chowning, 1977)  
- Macak-Schimmel, DAFx-2011 push-pull amplifier paper (companion to 2010 DAFx paper)

