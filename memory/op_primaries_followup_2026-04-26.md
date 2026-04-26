# gainCOMPUTER op primaries — focused follow-up (14 ops)

**Date:** 2026-04-26
**Context:** Two Perplexity Deep Research runs already ran the full 52-op question. **37 ops are locked from 2-of-2 agreement.** This follow-up targets the remaining **14 ops** where the two runs disagreed, raised honest caveats, or where prompt-definition tier resolution would benefit from a third source.

The diff between the two prior runs is documented at `op_primaries_perplexity_diff.md`. Both prior outputs are at `op_primaries_perplexity_A.md` and `op_primaries_perplexity_B.md`.

---

## What I need from this run

For each op below, the prior runs already surfaced candidate citations. I need you to:
1. **Resolve the specific question raised in each entry** (which patent, which date, which paper).
2. **Confirm or correct the tier classification** per the prompt's tier definitions.
3. **Flag any new bonus citations** the prior runs missed.
4. **Be ruthlessly honest** — if you cannot resolve a question, mark it "couldn't locate / needs library check" rather than guessing. The catalog gates code; bad citations cost a research cycle.

---

## Tier definitions (carry over from original prompt)

- **Tier-S** = manufacturer service manual, named-inventor patent, peer-reviewed paper from the originator, or canonical OSS file with permissive license (MIT/BSD/Apache/public-domain).
- **Tier-A** = textbook chapter by a recognized authority (Zölzer DAFX, JOS PASP/MUS320, Pirkle, Chamberlin, Sedra-Smith), DAFx conference paper, AES paper.
- **Tier-B** = high-quality reverse-engineering (Stinchcombe-class bench reports, ElectroSmash circuit analyses).
- **weak** = forum post, blog, vendor marketing — flag for me to find better.

For OSS code primaries, **note the license explicitly** (MIT/BSD/Apache/public-domain are usable; GPL means re-implement-from-spec only, no code copy).

## Anti-confabulation rule (still binding)

If your search returns nothing concrete for a question, the correct answer is `"couldn't locate / needs library check"`. **Never synthesize a citation from training-data plausibility.**

---

## A. Primary disagreements — different documents cited (5 ops)

The two prior runs cited different primary documents. Resolve which is correct, or determine that both exist and flag the operative one.

### A1. dopplerRotor (Leslie speaker / rotating-horn topology)

- **Run A says:** Leslie, *Vibratone Speaker System*, US Patent **2,855,462** (filed 1941, issued 1958). Hammond reissues through 1950s.
- **Run B says:** Leslie, US Patent **2,489,653** (1949), "Electrical Musical Instrument."
- **Both cite:** Henricksen, "The Dual Rotor Leslie Speaker," JAES 29(6):392–399, June 1981 (Tier-A backup). JOS PASP "The Leslie" page.
- **Question:** Don Leslie filed multiple patents. Which patent number specifically describes the rotating-horn / rotating-baffle topology used in Leslie speakers (the operative patent for the dopplerRotor op)? List ALL Leslie patents with their topologies if multiple are relevant.

### A2. ringMod (ring modulator / four-quadrant multiplier for audio)

- **Run A says:** Bode, "A New Tool for the Manipulation of Sound," 1961 *Electronics* article (transistor ring-modulator). Tier-S.
- **Run B says:** Bode, "History of Electronic Sound Modification," JAES 32(10):730–739, October 1984. Tier-A. **Plus** Cowan, US Patent **1,855,576** (1934) — actual original ring-modulator patent predating Bode.
- **Question:** Confirm Cowan's 1934 patent (US 1,855,576) — is it really the named-inventor Tier-S source for the ring modulator topology used in audio applications? If not, what is the named-inventor patent? Also: is there a Bode-specific patent (audio ring modulator, distinct from his frequency-shifter patent) that should be cited as Tier-S? Bode's 1961 *Electronics* article is the canonical music-application reference but isn't peer-reviewed — confirm tier.

### A3. hilbert (allpass-pair Hilbert transformer for analytic-signal computation)

- **Run A says:** Schüssler & Steffen, "Some Advanced Topics in Filter Design," in *Advanced Topics in Signal Processing* (ed. Lim & Oppenheim), Prentice Hall, **1988**. Notes that the prompt's "1998" date may be wrong.
- **Run B says:** Schüssler & Steffen, "Halfband Filters and Hilbert Transformers," *Circuits, Systems and Signal Processing* **17(2):137–164, 1998**. Confirms 1998.
- **Question:** Both publications likely exist (Schüssler & Steffen wrote multiple Hilbert-transformer papers). Identify both and tell me which is the operative reference for the **IIR allpass-pair Hilbert transformer design method** specifically. If both cover the same topic, flag the more accessible one as primary.

### A4. oilCanDelay (Tel-Ray / Echoplex EP-3 oil-can topology)

- **Run A says:** Lubow, *Delay Apparatus*, US Patent **2,892,898** (filed 1958-02-21, issued 1959-06-30). Electrostatic oil-tank delay mechanism.
- **Run B says:** Lubow (Tel-Ray Electronics), US Patent **2,963,554**, "Electrical Echo and Reverberator Device" (filed 1958, issued 1960).
- **Question:** The Tel-Ray/Lubow patent family includes multiple patents in the 1958–1962 range. Which specific patent describes the **operative oil-can mechanism** (electrolytic capacitor with charge sloshing as the delay element)? List all Lubow Tel-Ray patents and their distinct claims. Also: is the Echoplex EP-3 (Mike Battle, Maestro) really an oil-can or is it tape? Run B notes EP-3 may be tape, not oil-can — confirm.

### A5. blesserReverbCore (EMT 250/251 digital reverb)

- **Run A says:** Blesser & Bäder, US Patent **4,181,820** (filed 1978-04-21, issued 1980-01-01). EMT/Franz Vertriebsgesellschaft GmbH assignee. Earlier prompt cited US 3,978,289 (1976) — A retains both.
- **Run B says:** US Patent **4,181,820 confirmed**. Explicitly flags US 3,978,289 in the original prompt as **not located / not a Blesser patent**.
- **Question:** Confirm: is US 3,978,289 a real Blesser patent at all? If yes, what does it cover? If no, the original prompt was wrong and the catalog should be corrected to US 4,181,820 only. Also: Blesser presented at AES 50th Convention (London, 1975) — find the AES preprint number for the EMT 250 or earlier digital reverb work.

---

## B. Honest caveats — one run flagged accuracy issue (3 ops)

### B1. psuRectifierSag (B+ supply sag under heavy current draw)

- **Run A says:** Yeh, Abel, Smith, "Simplified, Physically-Informed Models of Distortion and Overdrive Guitar Effects Pedals," DAFx-2007, Bordeaux. Tier-A.
- **Run B says:** Yeh-Abel-Smith DAFx-2007 paper is on **diode limiter circuits**, NOT specifically PSU rectifier sag. Recommends Macak-Schmutzhard DAFx-2010 §3.2 as confirmed backup.
- **Question:** Verify Run B's concern. Does Yeh-Abel-Smith DAFx-2007 cover PSU rectifier sag? If so, in which section? If not, what is the correct primary source for PSU rectifier sag modeling (B+ droop under heavy current draw in tube amplifiers)? Macak-Schmutzhard DAFx-2010 may be the actual primary.

### B2. vactrolLPG (Buchla low-pass-gate / Optomix-style)

- **Run A says:** Buchla & Associates Model 292 Quad Lopass Gate service docs (Tier-S). Mentions "Don Buchla 1965 patent" but doesn't cite a number.
- **Run B says:** Buchla 292 service docs (Tier-S confirmed). Notes earliest Buchla LPG patent found is **US 3,475,623 (1969)**, NOT 1965 as the original prompt suggested.
- **Question:** Is there a Don Buchla 1965 patent at all? List all Don Buchla patents from 1964–1972 with their titles and topics. Identify which patent (if any) covers the original LPG concept. Also: provide the operative Buchla 292 service-document URL or archive.org link if obtainable.

### B3. varistorVibrato (Univibe / Shin-ei Companion vibrato)

- **Both runs say:** Shin-ei Companion (or FY-2 / Uni-Vibe) service manual/schematic (Tier-S, in principle).
- **Run B caveat:** "Schematic availability online has not been fully confirmed."
- **Question:** Is the Shin-ei Companion or Uni-Vibe service manual / schematic actually available online? Provide a direct archive.org / electrosmash / GroupDIY link to a verified-authentic copy. If not available, what is the strongest available alternative (Tom Coronel's analyses, ElectroSmash teardowns, etc.)? Also: is "varistor" the correct component name, or is it actually a VDR (voltage-dependent resistor) or some other component? Run B notes this distinction matters.

---

## C. Tier disagreements — same source, different tier (6 ops)

The two prior runs cite the same primary but disagree on tier. Resolve per the prompt's tier definitions.

For each, tell me:
- Whether you agree with the higher tier or the lower tier
- Why (which clause of the tier definition applies)
- Any bonus citation that would strengthen the row

### C1. gateStateMachine

- **Both runs cite:** musicdsp.org #117 (Bram de Jong) + Drugan-Reiss 2017 AES Convention paper.
- **Run A:** Tier-A (musicdsp #117 is well-known archive entry).
- **Run B:** weak / Tier-B (musicdsp is a community archive, not peer-reviewed; AES paper unconfirmed).
- **Resolve:** Is the Drugan-Reiss 2017 AES Convention paper on adaptive gating actually published? Find its e-Library number if so. If not, is there a different peer-reviewed AES/DAFx gate-FSM paper from any year that would cleanly anchor this op at Tier-A?

### C2. voiceCoilCompression

- **Both cite:** Klippel, "Loudspeaker Nonlinearities — Causes, Parameters, Symptoms," JAES 54(10):907–939, October 2006.
- **Run A:** Tier-S (named-originator JAES paper).
- **Run B:** Tier-A.
- **Resolve:** The prompt's tier definition treats "peer-reviewed paper from the originator" as Tier-S. Klippel is the originator of measurement-based loudspeaker nonlinearity science. Confirm Tier-S, or explain why Tier-A is more accurate.

### C3. triodeStage

- **Both cite:** Koren, "Improved Vacuum Tube Models for SPICE Simulations," normankoren.com (2003 update of Glass Audio 1996).
- **Run A:** Tier-S.
- **Run B:** Tier-A (web publication, not peer-reviewed; Glass Audio is a specialist publication).
- **Resolve:** Web publications and trade-magazine articles are not peer-reviewed. Confirm Tier-A. If there is a peer-reviewed paper that supersedes Koren (Cohen-Hélie 2010 perhaps), flag it — but Cohen-Hélie is itself derivative of Koren, not a replacement.

### C4. wowFlutter

- **Both cite:** Bertram, *Theory of Magnetic Recording* §7 (transport mechanics) + IEC 386 / DIN 45507 measurement standards.
- **Run A:** Tier-S (IEC 386 as primary).
- **Run B:** Tier-A (Bertram theory) + Tier-S (IEC standard).
- **Resolve:** Run B's split is more accurate (theory layer + standards layer). Confirm the citation pair, or propose a single primary that combines both.

### C5. inputXformerSat (sub-preset of #139 xformerSat)

- **Both cite:** Jensen Application Notes (AN-001 through AN-008, Whitlock-authored).
- **Run A:** Tier-S (manufacturer technical documents by named expert).
- **Run B:** Tier-A.
- **Resolve:** Per the prompt's definition, "manufacturer service manual" is Tier-S. Are Jensen Application Notes manufacturer service manuals or marketing/educational materials? If technical-spec content with measured B-H data, they qualify Tier-S. Confirm.

### C6. fmOperator

- **Both cite:** Chowning, "The Synthesis of Complex Audio Spectra by Means of Frequency Modulation," JAES 21(7):526–534, September 1973.
- **Run A:** Tier-S (named-originator JAES paper).
- **Run B:** Tier-A.
- **Resolve:** Chowning is THE originator of FM synthesis as published in JAES. This is the textbook example of a Tier-S source per the prompt definition. Confirm Tier-S.

---

## Output format

Use the same format as the original 52-op prompt:

```
## <category>.<sub> <opId>
- **Resolution:** <which patent / paper / tier is correct, with rationale>
- **Locked primary:** <full citation>
- **Tier:** <S / A / B / weak>
- **Bonus citations:** <any new ones the prior runs missed>
- **Where to obtain:** <DOI / URL / archive>
- **License (if OSS):** <MIT/BSD/Apache/public-domain/GPL>
- **Notes:** <anything I should know>
```

## Deliverable

**Output as a single Markdown file** named `op_primaries_followup_results_2026-04-26.md`. UTF-8, plain markdown, no PDFs/images. End with a short summary of how many of the 14 you resolved cleanly, how many remain "couldn't locate," and any bonus citations worth incorporating.

---

## Constraints

- **Do not regenerate the 37 already-locked ops.** Those are confirmed; touching them wastes effort.
- **Do not generate code or algorithms.** Citations only.
- **Honesty over completeness.** A "couldn't locate" answer is better than a hallucinated patent number.
- For paywalled material, name the most likely archive (DAFx archive at dafx.de, AES E-Library at aes.org/e-lib/, JOS at ccrma.stanford.edu/~jos/, archive.org for service manuals, Google Patents for US patents, FreePatentsOnline for older patents).
