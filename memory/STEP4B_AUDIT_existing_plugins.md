# STEP 4B — AUDIT OF EXISTING PLUGIN SUITE

Performed before Step 5 implementation. Stack is **JS / Web Audio AudioWorklet** (not C++/JUCE — Step 4 architecture must be re-expressed in JS terms; principles unchanged).

---

## 1. GROUPING BY DSP CORE

### A. DELAY / TIME-BASED
TapeDelay, Echoform, Orbit (also reverb-flavoured), Smear (also reverb-flavoured), Drift, PitchShifter, Playbox.

Shared DSP:
- Single circular Float32Array per channel, fractional read with linear interp
- Independent wp / smoothed read positions per "head"
- Wow/flutter LFOs (sin sums) modulating read position
- 1-pole LP+HP in feedback path
- tanh saturation on write

### B. REVERB
SimpleReverb, FocusReverb, MorphReverb, PlateX, SpringReverb, SpringPhysics, TransientReverb, FreezeField, ReverbBus, NearFar, Orbit, Smear.

Shared DSP:
- Schroeder comb + allpass (3+2 typical)
- Pre-delay line
- HF damping in feedback
- Stereo crossfeed

### C. DISTORTION / SATURATION / TONE
Distortion, Splitdrive, Shagatron, Gluesmash, Reactor, Character, Finisher, Tape, Amp, Ampless, Bassmind.

Shared DSP:
- Static memoryless waveshapers (tanh / soft-clip / asymmetric)
- Tilt-EQ pre/post
- Drive→make-up gain
- DC blocker

### D. DYNAMICS
LA2A, Smoother, AnalogGlue, MixBus, DrumBus, Gravity, PhraseRider, Iron1073, Neve, NastyNeve, Bae73.

Shared DSP:
- Branching peak/RMS detector with attack/release one-poles
- Gain-reduction VCA (linear gain mult)
- Optional sidechain HP
- Make-up gain

### E. MODULATION
Modulation, Flanger, Phaser, Drift, VibeMic.

Shared DSP:
- Short modulated delay line OR cascaded APF chain
- LFO (sin/tri) ± envelope follower
- Feedback path with tone shaping

### F. VOCAL CHAINS
VocalOrb, VocalLock, DeHarsh, VibeMic, PhraseRider, Airlift.

Shared DSP:
- De-esser sidechain (HP detector + dynamic notch)
- Compressor + saturation + air-band shelf
- Pitch-track / tuning (where applicable)

### G. UTILITY
Scope, ClipMeter, PresetSelector — passthrough analysis, no DSP core.

---

## 2. WEAK POINTS PER GROUP

| Group | Weak point | Symptom |
|---|---|---|
| Delay | `wp % maxLen` per sample, naive linear interp | Zipper noise on time mod, HF roll-off, Doppler clicks on jumps |
| Delay | Per-engine ad-hoc smoothing, no shared delay-line class | Bug duplication, divergent quality |
| Reverb | No shared FDN; everyone hand-rolls Schroeder | Metallic / colored / mono-leaning tails |
| Reverb | HF damp = single 1-pole, no Geraint Luff shelf | Damping is rate-dependent, not perceptually flat |
| Distortion | No oversampling, no ADAA — pure tanh at fs | Aliasing on bright/loud material, fizz above 8 kHz |
| Distortion | Memoryless only — no reactive circuit feel | All saturators sound similar |
| Dynamics | Detectors are sample-by-sample branching, no look-ahead | Pumping, distortion on transients, no true peak |
| Dynamics | No K-weighted / RMS LUFS option | Inconsistent loudness behaviour across plugins |
| Modulation | LFO phase reset on param change, no atomic-tick smoothing | Audible step on rate change |
| Modulation | APF phasers built per plugin | No shared phase-coherent topology |
| Vocal | De-esser & compressor not gain-staged consistently | Stacking VocalOrb→VocalLock causes loudness creep |
| All | Zero PDC reporting → mixing parallel paths phase-misaligns | Comb filtering when bypass/parallel toggled |
| All | k-rate AudioParam smoothing only — no two-stage smoother | Zipper on macro sweeps |

---

## 3. MIGRATION STRATEGY

**Shared cores to extract:**
1. `DelayLine` — circular buffer + Lagrange-3 / allpass-frac interp + write API + smoothed read pointer (Schlecht 2020 energy-preserving form for time-varying)
2. `FDN16` (per `reverb_engine_architecture.md`) — replaces every Schroeder roll-out
3. `WaveShaper` w/ ADAA1 + 2× polyphase oversample
4. `Detector` — branching, K-weighted optional, with look-ahead tap
5. `LFO` — Sine/Tri/Sq/SH/Fractal with phase-stable rate change
6. `BiquadCascade` — shared filters (LP/HP/BP/Shelf/Peak/Tilt/AllPass)

**Merge / simplify candidates:**
- TapeDelay + Echoform + Playbox → all delegate to one `TapeDelayCore` with character-preset variations
- SimpleReverb + FocusReverb + MorphReverb + PlateX + ReverbBus → one `FdnCore` with topology presets
- SpringReverb + SpringPhysics → one springy core (waveguide chain)
- Neve + NastyNeve + Bae73 + Iron1073 → one `Console73Core` w/ preamp drive + shelves; differentiate via voicing presets only
- Modulation + Drift + VibeMic → unified modulation block (chorus/vibrato/detune)

**Rebuild order (lowest-risk → highest-leverage):**
1. **Delay group first** ✅ (this Step 5) — least entanglement, most reusable, becomes substrate for modulation + reverb pre-delay
2. Modulation (re-uses DelayLine)
3. Reverb (re-uses DelayLine + LFO + Filters)
4. Dynamics (independent; needs Detector primitive)
5. Distortion (needs WaveShaper + oversample primitive)
6. Vocal chains (compose from above — last)

---

## 4. SELECTED FIRST GROUP: DELAY / TIME-BASED

Rebuild target plugins (all will eventually delegate to the new core):
- TapeDelay, Echoform, Playbox → tape-flavoured chains on top of `DelayModule`
- Drift → modulation chain on `DelayModule`
- PitchShifter → granular path uses `DelayLine` as ring buffer
- Orbit / Smear delay portions → use `DelayLine` for taps, FDN later for tail

Move on to Step 5 implementation in the next file.
