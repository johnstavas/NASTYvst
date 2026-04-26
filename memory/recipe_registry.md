# Recipe Registry

**Scope.** Named compositions of sandbox ops. A *recipe* is a graph
fragment that has a culturally-recognized name (e.g. "ping-pong delay")
but is NOT an irreducible primitive — it composes from shipped ops at
the brick layer. Recipes are the lingua franca between the named-gear
vocabulary corpus and the agent layer.

**Why this file exists.** The 2026-04-26 corpus sweep identified ~23
named compositions during op triage. Promoting them to ops would have
inflated the catalog with duplicate-by-decomposition entries. Killing
them entirely would have lost the named-vocabulary mapping that the
agent layer needs. This registry is the third bucket: documented
compositions, addressable by name, NOT in the ops catalog.

**Related.** `sandbox_ops_catalog.md` (irreducible primitives, 1–183),
`sandbox_op_ship_protocol.md` (how to ship an op), `airwindows_incorporation_plan.md`
(extraction/inspiration policy that produces recipes).

---

## How to read each entry

```
### <recipeName>
- **What it is.** One-line description.
- **Composition.** Op chain or graph. References ops by `#N opId`.
- **Reference units.** Corpus entries this recipe abstracts.
- **Status.** `locked` (composition validated against a shipped graph) /
              `sketch` (composition plausible, not yet built) /
              `TBD` (named, composition not yet specified).
- **Notes.** Anything non-obvious.
```

**Status legend:**
- `locked` — At least one shipped sandbox graph implements this composition. The recipe IS this composition (no drift risk).
- `sketch` — Composition is the best inference from the corpus + DSP textbooks at sweep time but no shipped graph yet validates it. Expect minor revision when first instantiated.
- `TBD` — Name claimed by corpus, composition not yet specified. Resolve before agent layer can address it.

---

## 1. Section: Killed-as-recipe (canonical "things people expect to build")

These were proposed during the 2026-04-24 / 2026-04-26 sweeps as *ops*
and demoted: they compose from shipped primitives without a distinct
topology of their own. Listed here so the agent layer can resolve the
name without a missing-op error.

### brickwallLimiter
- **What it is.** Lookahead peak limiter with hard ceiling and program-dependent release.
- **Composition.** `lookahead delay → envelopeFollower (peak, fast) → gainComputer (∞:1, hard knee) → smooth (program-dependent release) → gain (× envelope) → hardClip (post-safety net at ceiling)`.
- **Reference units.** Waves L2, FabFilter Pro-L 2, Sonnox Oxford Limiter.
- **Status.** `sketch`.
- **Notes.** True-peak detection adds 4× polyphase upsample around the hardClip stage per BS.1770-5 Annex 2.

### multibandCompressor
- **What it is.** N-band parallel compression with phase-coherent crossover.
- **Composition.** `linkwitzRiley4 splitter → per-band {envelopeFollower → gainComputer → gain} → busSum`.
- **Reference units.** FabFilter Pro-MB, Waves C4/C6, Multipressor.
- **Status.** `sketch`.
- **Notes.** Waiting on per-band sidechain regime in QC harness (`qc_generator_audit.md §1.3`). Crossover phase coherence is the defining QC risk.

### deEsser
- **What it is.** Frequency-selective compressor centered on sibilance band.
- **Composition.** `bandSplit (5–10 kHz HP sidechain) → envelopeFollower → gainComputer → gain (× original signal)`. Split-band variant: `bandSplit → high-band → compress → recombine`.
- **Reference units.** Waves DeEsser, FabFilter Pro-DS, SPL DeEsser.
- **Status.** `sketch`.
- **Notes.** Two flavors per corpus: wideband sidechain vs split-band processing. Both compose from shipped ops.

### pingPongDelay
- **What it is.** Stereo delay where successive taps alternate L/R.
- **Composition.** `delay (L) → cross-feed → delay (R) → cross-feed → delay (L) ...` via `panner` per tap + feedback bus.
- **Reference units.** Soundtoys EchoBoy ping-pong mode, generic DAW delay ping-pong.
- **Status.** `locked` (TOY_COMP-class sandbox graphs already do this).
- **Notes.** Sample-accurate L↔R alternation falls out of the topology — no special op needed.

### tapeDelay
- **What it is.** Delay with tape-character coloration on the feedback path.
- **Composition.** `delay → tape (#117) → wowFlutter (#175) → headBumpEQ (#171) → feedback bus`. Optional: `tapeBias (#169)` pre-record.
- **Reference units.** Soundtoys EchoBoy Tape, Waves H-Delay tape mode, Roland RE-201.
- **Status.** `sketch`.
- **Notes.** With the tape primitive split (sweep promotion of #171, #175), this becomes a clean composition. Pre-split it had to live as a monolithic op.

### parametricEQ
- **What it is.** N-band biquad EQ with bell + shelf + cut configurable per band.
- **Composition.** `serial chain of biquad (#29-39) with per-band type/freq/Q/gain params`.
- **Reference units.** FabFilter Pro-Q 4, Waves Q10, generic DAW EQ.
- **Status.** `locked` (shipped sandbox graphs do this).
- **Notes.** Linear-phase variant uses `linearPhaseEQ (#167)` once shipped.

### vocoder
- **What it is.** Modulator (voice) controls carrier (synth) via per-band envelope.
- **Composition.** `bandSplit modulator → per-band envelopeFollower (#61) → gain on matching bandSplit carrier → busSum`.
- **Reference units.** Waves Morphoder, Roland VP-330, generic DAW vocoder.
- **Status.** `sketch`.
- **Notes.** 16- to 32-band typical. Phase coherence between modulator and carrier band-splits is the QC risk.

### autoTune
- **What it is.** Pitch-correct vocal to nearest scale tone with formant preservation.
- **Composition.** `pyin (#77) or crepe (#78) → quantize-to-scale → granularPitchShifter (#150) or phaseVocoder (#68) → mix`.
- **Reference units.** Antares Auto-Tune, Celemony Melodyne (manual mode), Waves Tune.
- **Status.** `sketch`.
- **Notes.** Formant preservation requires LPC (#71) or warpedLPC (#72) split. Hard-tune ("T-Pain" mode) skips formant preservation.

### ambisonics
- **What it is.** B-format spatial encode/decode for periphonic playback.
- **Composition.** Custom encode matrix (per Zotter-Frank 2019) + decode matrix per loudspeaker rig. Pure linear algebra over multichannel buses.
- **Reference units.** IEM Plug-in Suite, Sennheiser AMBEO Orbit.
- **Status.** `TBD`.
- **Notes.** Deferred to `deferred_domains_roadmap §5` (multichannel spatial). Not blocking V1.

---

## 2. Section: Corpus-sweep recipes (named compositions from 2026-04-26)

### vhdBlend
- **What it is.** Variable harmonic distortion blend — drives a clean signal in parallel with several distinct waveshapers and crossfades by character knob.
- **Composition.** `dryBus → parallel { saturate, diodeClipper (#132), wavefolder (#131), chebyshevWS (#134) } → per-branch gain → busSum`. Character knob drives a Bézier curve over the four branch gains.
- **Reference units.** Soundtoys Decapitator, Slate VMR FG-Stress, Vertigo VSC-2.
- **Status.** `sketch`.
- **Notes.** "Style" knob in Decapitator IS this Bézier curve. Open-source recreation in Saike's plug-ins follows the same topology.

### analogClockDrift
- **What it is.** Slow random walk applied to clock/sample-rate-dependent params, simulating analog component thermal drift.
- **Composition.** `randomWalk (#58) at <0.1 Hz → smooth (#smoothing op) → param target (delay time, LFO rate, BBD clock, etc.)`.
- **Reference units.** UAD analog emulations with "drift" knob, Waves Abbey Road plugins, Slate "analog-style" toggles.
- **Status.** `locked` — randomWalk + smooth + param routing already a shipped pattern.
- **Notes.** Universal pattern. Add as a default sub-routine on any modulation/delay op declared "analog-flavored."

### dynamicDelay
- **What it is.** Delay whose feedback or wet gain is sidechained off the input envelope (ducks during transients).
- **Composition.** `delay → feedback bus`, with `envelopeFollower (#61) on input → invert → gain on feedback bus`.
- **Reference units.** Valhalla Delay "Ducking" mode, Soundtoys EchoBoy ducking.
- **Status.** `sketch`.
- **Notes.** Composes into existing delay ops trivially.

### slidingHeadDelay
- **What it is.** Tape-style delay where moving the playhead changes pitch via Doppler (not just delay time).
- **Composition.** `delay with smoothly-modulated read pointer → wowFlutter (#175)`. Doppler emerges naturally from non-zero d(delayTime)/dt through the read pointer.
- **Reference units.** Roland RE-201 Space Echo, Echoplex EP-3, Soundtoys EchoBoy "Slap" mode.
- **Status.** `sketch`.
- **Notes.** The slide IS the modulation; no separate Doppler op needed (Doppler falls out of fractional delay-line interpolation).

### fetPreampColor
- **What it is.** FET-front-end preamp character — input gain into JFET soft-clip with class-A bias.
- **Composition.** `gain → fetVVR (#147 — when shipped) OR softLimit + saturate → bjtSingleStage (#143) → trim`.
- **Reference units.** API 312, BAE 1073 FET version, Universal Audio 610-style.
- **Status.** `sketch`.
- **Notes.** When #143 + #147 ship as Tier-S, this recipe becomes `locked`.

### multiSpringTank
- **What it is.** Multi-spring reverb tank — three or more parallel dispersive-allpass cascades with slightly different lengths and Q.
- **Composition.** `parallel { dispersiveAllpass (#181) × 3 with detuned lengths } → busSum → lowPass + highShelf`.
- **Reference units.** AKG BX-20E (3-spring), Hammond reverb tank (2-spring), Fender 6G15 (3-spring).
- **Status.** `sketch`.
- **Notes.** Depends on #181 dispersiveAllpass shipping.

### nonLin2Gate
- **What it is.** Two-stage nonlinearity feeding a gate — the second NL stage is bypassed when gate is closed (re-opens cleanly without re-arming).
- **Composition.** `saturate → gateStateMachine (#153) → diodeClipper (#132) — with gate state controlling stage-2 bypass`.
- **Reference units.** Drawmer DS201 with "expand" mode + saturator, SPL Transient Designer with drive.
- **Status.** `sketch`.
- **Notes.** Depends on #153 gateStateMachine shipping.

### splitDecayReverb
- **What it is.** Reverb with separate decay times per band — long lows, short highs (or inverse).
- **Composition.** `bandSplit → per-band fdnCore (#20) with per-band rt60 → busSum`.
- **Reference units.** Valhalla VintageVerb (per-band damping), TC 6000 Hall, Bricasti M7.
- **Status.** `sketch`.
- **Notes.** Single-band shipped fdnCore doesn't need modification — the split-decay character emerges from the multi-band wrapper.

### subBassReverbEngine
- **What it is.** Reverb specifically tuned for sub-bass content — long LF tail with HF rolloff to avoid mud.
- **Composition.** `lowPass (60–120 Hz) → fdnCore (#20) with long rt60 → highShelf-cut → mix back at low gain`.
- **Reference units.** Valhalla Sub33, custom FX bus reverbs in mastering chains.
- **Status.** `sketch`.

### multiHeadTapeEcho
- **What it is.** Multiple read-heads on a single tape line, each at a different distance from the record head.
- **Composition.** `delay-line write → multiple read taps at fixed offsets → per-tap tape (#117) coloration → busSum`.
- **Reference units.** Roland RE-201 Space Echo (4 heads), Maestro Echoplex EP-2 (3 heads).
- **Status.** `sketch`.
- **Notes.** RE-201's 12 mode-combinations are head-on/off permutations on this topology.

### bbdCompander
- **What it is.** BBD line with NE570/dbx-style compander on input + expander on output (canonical analog noise reduction).
- **Composition.** `companderEncoder → bbdDelay (#112) → companderDecoder`. With #112+companding stages of #160 companding8bit at low bit depth, this approximates BBD-line noise behavior.
- **Reference units.** Boss CE-1 chorus, MXR Carbon Copy, EHX Memory Man.
- **Status.** `sketch`.
- **Notes.** Once #160 companding8bit (mu-law/A-law) ships, this is `locked`.

### octaveFold
- **What it is.** Wavefolder configured for musical 1-octave harmonic, distinct from generic fold.
- **Composition.** `wavefolder (#131) with width tuned to first-fold-at-half-amplitude → highPass (DC removal) → trim`.
- **Reference units.** Buchla 259 (timbre fold), Make Noise Optomix octave knee.
- **Status.** `locked` (wavefolder shipped).
- **Notes.** This is purely a preset of #131 with width=0.5. Documented here because the named-gear corpus references "octave fold" as a discrete sound, not as "wavefolder set to 50%."

### parallelBlendDrive
- **What it is.** Drive in parallel with dry signal, blendable. Simplest "saturation send-return" topology.
- **Composition.** `splitter → { dryBus → gain, driveBus → drive (#16) → gain } → busSum`.
- **Reference units.** Waves NLS parallel mode, generic "blend" knob on saturators.
- **Status.** `locked`.
- **Notes.** This is the canonical answer to "wet/dry" on a saturator without fighting the dry/wet mix rule.

### aphexHarmonicGenerator
- **What it is.** Aural Exciter / "presence" enhancer — high-band harmonic generation phase-aligned back to dry.
- **Composition.** `highPass (3–8 kHz) → softLimit + chebyshevWS (#134) → phase-aligned mix back to dry via allpass on dry path`.
- **Reference units.** Aphex Aural Exciter Type C, BBE Sonic Maximizer (related but different).
- **Status.** `sketch`.
- **Notes.** Phase-alignment via dry-path allpass is the secret sauce. `chebyshevWS` per-T_k harmonic dialing is the right primitive for this.

### companderEncoder / companderDecoder
- **What it is.** Canonical 2:1 compress / 1:2 expand pair for noise-reduction systems (dbx Type II, dolby B-equivalent).
- **Composition (encoder).** `envelopeFollower → log → ×0.5 → exp → ×original`.
- **Composition (decoder).** `envelopeFollower → log → ×2 → exp → ×original`.
- **Reference units.** dbx Type II tape NR, Boss CE-1 chorus internal NR, NE570/571 IC.
- **Status.** `sketch`.
- **Notes.** Pre-emphasis/de-emphasis filters wrap the encoder/decoder pair on real units. Recipe captures the gain-mapping core only.

### slidingBandCompander
- **What it is.** Compander whose band edges shift with input level — the "sliding band" of dbx 905 / DigiTech VCFs.
- **Composition.** `envelopeFollower → maps to bandSplit edge frequency → companderEncoder/Decoder per band → recombine`.
- **Reference units.** dbx 905 DeEsser, DigiTech Vocalist Workstation NR.
- **Status.** `sketch`.

### sidebandPhaseAligner
- **What it is.** Phase-aligns two parallel processing chains so their wet outputs sum coherently with dry.
- **Composition.** `path A → measure latency → path B → match latency via delay + allpass network → sum`.
- **Reference units.** UAD's "Comp/Limiter" linked-mode internals, Pro Tools delay-compensation in summing.
- **Status.** `sketch`.
- **Notes.** This is a topology pattern, not a sonic effect. Useful as a recipe because the agent layer needs to know "when you parallel-process, do this."

### stereoSynthesizer
- **What it is.** Mono-to-stereo widener via decorrelation (Haas + comb + light reverb).
- **Composition.** `mono in → { directBus, hass (#105) ←left, allpass cascade →right, velvetNoise (#138) decorrelator } → recombine with width control`.
- **Reference units.** Waves S1 Stereo Imager, Brainworx bx_solo (inverse), iZotope Imager.
- **Status.** `sketch`.

### thrustSidechainHP
- **What it is.** Sidechain compressor pumping in time with kick — "EDM thrust" pattern. Compressor's sidechain is HP-filtered to lock onto kick fundamental.
- **Composition.** `kickBus → highPass (40–80 Hz) → envelopeFollower (#61) → drives gain on bassBus`.
- **Reference units.** Xfer Records LFOTool (related — LFO instead of follower), Cableguys VolumeShaper, side-chain ducking patches.
- **Status.** `locked` (already a shipped sandbox pattern).

### ratioCurveBank
- **What it is.** Compressor ratio knob mapped through one of N pre-baked curves (linear, exponential, "vintage soft," "modern firm").
- **Composition.** Param-flag on the compressor recipe — not a separate graph. The flag selects between Bézier curves applied to the gainComputer ratio param.
- **Reference units.** SSL G-comp's distinct ratio "feel" vs Distressor's, etc.
- **Status.** `locked`.
- **Notes.** Documented here for the agent layer to address by name; implementation is a flag + curve table on existing comp ops.

### softLimitADC
- **What it is.** Pre-converter soft-clip emulating early A/D converter overload character.
- **Composition.** `softLimit at -0.5 dBFS → bitcrush (#15) → trim`. With #168 gainRangingADC: `gainRangingADC → softLimit → bitcrush`.
- **Reference units.** Apogee Soft Limit (legacy A/D), Crane Song HEDD-192.
- **Status.** `sketch`.

### roomCorrection
- **What it is.** Multi-band EQ + delay correction matched to a measured room IR.
- **Composition.** `convolution (#63) with inverse-room IR + parametricEQ correction overlay`.
- **Reference units.** Sonarworks SoundID, IK ARC, Dirac Live.
- **Status.** `TBD`.
- **Notes.** Inverse-IR generation is an offline tool, not an op. Recipe captures the playback-side topology only.

### hardwareConverterColor
- **What it is.** Catch-all "sounds like an old ADC/DAC" composition — gain ranging + soft-limit + ditherless quantize + analog filter.
- **Composition.** `gainRangingADC (#168) → softLimit → bitcrush (#15) at 16-bit → analogFilter cascade`.
- **Reference units.** Apogee Rosetta, Crane Song HEDD, generic "vintage A/D" emulations.
- **Status.** `sketch`.

---

## 3. Promotion / demotion criteria

A recipe **promotes to op** when:
- A primary source establishes it as a single circuit/algorithm (not a composition), OR
- The composition has irreducible state coupling (output of step N feeds back to state of step N-K in a way that can't be expressed as op-level wires).

A recipe **stays a recipe** when:
- It's pure topology over shipped ops, OR
- The "name" is cultural shorthand for a well-known multi-stage pattern (vocoder, ping-pong, parametric EQ).

**Anti-pattern.** Promoting "ping-pong delay" to an op because Soundtoys
sells a thing called Ping-Pong Delay. The op layer is irreducible
primitives, not product names.

---

## 4. Update protocol

- New recipe lands when a corpus entry is parsed and its decomposition is documented.
- A recipe's status moves `sketch` → `locked` the first time a sandbox graph instantiates it cleanly.
- A recipe's status moves `TBD` → `sketch` when its composition is specified.
- When a new op ships that simplifies a recipe, update the composition line — keep the recipe entry, just update which `#N opId` it references.
- When a recipe is determined to be redundant with another, mark `→ alias of <other>` and keep both names so the agent layer can resolve either.

---

## 5. Revision history

- **2026-04-26 v1.0.** First registry. Captured 23 corpus-sweep recipes + 9 killed-as-recipe entries from the 2026-04-26 op-triage. Most entries `sketch` status pending first instantiation.
