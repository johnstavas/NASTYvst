# Nasty Orb — Plugin × Ops List

50 legacy plugins from the Nasty Orb app, with the ops each one needs.

**Status legend:**
- ✅ = parity-shipped (ready to use)
- 🚧 = worklet exists, C++ stub or unverified (port + parity-test work)
- ❌ = no worklet; needs design from scratch

---

## 1. airlift
✅ gain, mix, filter, saturate, envelope, abs, clamp
🚧 onePole, shelf, uniBi, envelopeFollower, tapeSim

## 2. amp
✅ gain, mix, filter, saturate, gainComputer, envelope, detector
🚧 tubeSim, panner
❌ muLawCompander

## 3. ampless
✅ gain, mix, filter, saturate, gainComputer, clamp
🚧 onePole, tilt, detector, gate

## 4. analogGlue
✅ gain, gainComputer, envelope, saturate, softLimit
🚧 transformerSim, xformerSat, sidechainHPF, detector, rms, peak, lookahead, convolution, filter
❌ crestFactor, stereoLinkMode

## 5. bae73
✅ filter, saturate, chebyshevWS, gain, xformerSat
🚧 transformerSim, tubeSim, envelopeFollower, shelf, crossfade, rms

## 6. bassmind
✅ saturate, tilt, mix, blackmerVCA, gainComputer, detector
🚧 onePole, crossfade

## 7. character
✅ saturate, hardClip, bitcrush, allpass, biquad_bp, biquad_lowshelf, biquad_highshelf, biquad_peak, blackmerVCA, gainComputer, detector, mix
🚧 schroederChain, diffuser, delay, lfo, sineOsc, haas, select, crossfade, onePole_lp

## 8. deharsh
✅ onePole_lp, onePole_hp, biquad_peak, biquad_highshelf, detector, gainComputer, smooth, polarity, mix, tilt
🚧 select, crossfade, lrXover

## 9. distortion
✅ biquad_peak, biquad_lp, biquad_bp, saturate, hardClip, diodeClipper, wavefolder, varMuTube, chebyshevWS, bitcrush, drive, mix
🚧 panner, crackle, noise, tubeSim, oversample2x, crossfade, busSum, msEncode, msDecode

## 10. drift
✅ mix
🚧 delay, lfo, sineOsc, noise, onePole_lp, crossfade, randomWalk

## 11. drumBus
✅ saturate, hardClip, gain, detector, envelope, gainComputer
🚧 onePole, sineOsc, wavetable, transient, msEncode, msDecode, crossfade
❌ triggeredSubGen

## 12. echoform
✅ saturate, allpass, mix
🚧 delay, lfo, sineOsc, onePole, msEncode, msDecode, crossfeed, crossfade

## 13. eightOhEight (808)
✅ filter, saturate, envelope, detector, gainComputer
🚧 shelf, svf, sineOsc, wavetable, blit, noise, oversample2x, adsr
*Step sequencer is control-plane, not a DSP op*

## 14. finisher
✅ detector, envelope, gainComputer, tilt, softLimit, gain, mix
🚧 onePole, msEncode, msDecode, stereoWidth, shelf, crossfade

## 15. flanger
✅ gain, saturate, onePole_lp, mix
🚧 delay, lfo, stereoWidth, crossfeed, dcBlock

## 16. focusReverb
✅ comb, allpass, filter, gain, mix, detector, gainComputer
🚧 onePole, schroederChain, msEncode, msDecode, stereoWidth, svf, crossfade

## 17. freezefield
✅ allpass, saturate, softLimit, tilt, mix
🚧 onePole, lfo, sineOsc, msEncode, msDecode, stereoWidth, diffuser, peak, meters, delay (Hermite)
❌ modulatedAllpass (or interp param on allpass)

## 18. gluesmash
✅ detector, gainComputer, envelope, saturate, chebyshevWS, tilt, softLimit, mix, gain, scaleBy, smooth
🚧 transient

## 19. gravity
✅ tilt, saturate, mix, gain
🚧 fdnCore, ER, lfo, sineOsc, onePole, msEncode, msDecode, stereoWidth, delay (Hermite)

## 20. iron1073
✅ filter, saturate, varMuTube, xformerSat, gain, mix
🚧 shelf, transformerSim, tubeSim, lrXover, rms, crossfade

## 21. la2a
✅ gain, filter, optoCell, detector, envelope, gainComputer, smooth, onePole_hp, shelf_low, xformerSat
🚧 tubeSim

## 22. lofiLoofy
✅ gain, mix, filter, tilt, saturate, bitcrush, detector, envelope, gainComputer, smooth, dcBlock
🚧 delay, lfo, noise, crackle, convolution, haas, stereoWidth, sidechainHPF
*"Pump ducker" is composable: lfo → gainComputer.threshold (Stage B coupling)*

## 23. manChild
✅ detector, envelope, gainComputer, varMuTube, xformerSat, gain, slew, mix
🚧 rms, sidechainHPF, msEncode, msDecode, tubeSim, transformerSim, crossfade
❌ envelopeMultiStage (Fairchild TC5/TC6 program-dependent release)

## 24. mixBus
✅ filter, biquad_hp, biquad_lowshelf, biquad_peak, biquad_highshelf, detector, envelope, gainComputer, gain
🚧 lookahead, truePeak, panner

## 25. modulation
✅ biquad_lp, gain, mix, constant
🚧 sineOsc, lfo, polyBLEP, minBLEP, blit, sampleHold, noise, onePole_lp, delay, panner, autopan, chebyshevWS, randomWalk

## 26. morphReverb
✅ saturate, mix, onePole_lp
🚧 fdnCore, diffuser, ER, delay, crossfade

## 27. nastyBeast
✅ biquad family, saturate, constant, detector, envelope, gainComputer, gain, mix
🚧 oversample2x, delay, lfo, panner, microDetune, pitchShift, granularBuffer, crossfeed, haas, rms, crossfade

## 28. nearfar
✅ allpass, biquad_peak, mix, saturate, envelope, onePole_lp
🚧 ER, delay, schroederChain, msEncode, msDecode, stereoWidth, haas, envelopeFollower, transient, rms, shelf

## 29. neve
✅ gain, scaleBy, filter, biquad_lowshelf, xformerSat, saturate
🚧 oversample2x, rms, peak, meters

## 30. orbit
✅ allpass, tilt, softLimit, saturate, mix, smooth
🚧 comb, onePole, lfo, sineOsc, autopan, panner, stereoWidth, diffuser, schroederChain, crossfade

## 31. pantherBuss
✅ filter, saturate, chebyshevWS, detector, gainComputer, envelope, blackmerVCA, softLimit, mix
🚧 oversample2x, lookahead, truePeak

## 32. phaser
✅ allpass, clamp, hardClip, mix
🚧 lfo, sineOsc, z1

## 33. phraseRider
✅ abs, envelope, detector, smooth, slew, clamp, gain
🚧 onePole, combine, crossfade

## 34. pitchShifter
✅ gain, bitcrush, srcResampler, saturate, onePole_lp, mix
🚧 pitchShift, granularBuffer

## 35. platex
✅ allpass, biquad_bp, biquad_peak, tilt, softLimit, saturate, mix, detector, envelope
🚧 comb, onePole_lp, lfo, sineOsc, crossfeed

## 36. playbox
✅ delay, saturate, onePole_lp, svf_lp, bitcrush, mix, crossfade
🚧 lfo, select

## 37. reactor
✅ detector, envelope, mix
🚧 transient, lfo, noise, slew, delay, onePole_lp

## 38. reverbBus
✅ tilt, saturate, detector, envelope, gainComputer, mix, onePole_hp
🚧 delay, ER, fdnCore, lfo, sineOsc, msEncode, msDecode, stereoWidth, tapeSim, onePole_lp

## 39. shagatron
✅ saturate, chebyshevWS, detector, gainComputer, shelf_low, biquad_lowshelf, biquad_bp, onePole_hp, biquad_hp, biquad_lp, xformerSat, gain, mix
🚧 tubeSim, lrXover, onePole_lp

## 40. simpleReverb
✅ gain, biquad_hp, biquad_lp, biquad_highshelf, mix
🚧 delay, convolution, panner

## 41. smear
✅ onePole_lp, saturate, softLimit, tilt, mix, allpass
🚧 comb, schroederChain, lfo, sineOsc, randomWalk, tapeSim

## 42. smoother
✅ onePole_lp, onePole_hp, biquad_peak, envelope, mix
🚧 envelopeFollower
*"Dynamic peaking EQ" is composable: envelope → gainComputer → biquad_peak.gain*

## 43. splitdrive
✅ onePole_lp, saturate, tilt, mix
🚧 lrXover, busSum

## 44. springPhysics (spring)
✅ onePole_lp, saturate, softLimit, dcBlock, biquad_highshelf, mix, allpass
🚧 delay, lfo, sineOsc, schroederChain, stereoWidth, crossfade, spring (whole-plugin op)

## 45. springReverb
✅ gain, saturate, allpass, shelf, dcBlock
🚧 panner, convolution, comb, lfo, delay, spring (whole-plugin op)

## 46. tape
✅ gain, biquad_lowshelf, biquad_highshelf, biquad_peak, biquad_lp, biquad_hp, saturate, detector, envelope, gainComputer, dcBlock, delay
🚧 tubeSim, lfo, noise

## 47. tapeDelay
✅ delay, dcBlock, saturate, xformerSat, mix, gain
🚧 lfo, noise, haas, tubeSim, onePole_lp, transformerSim

## 48. transientReverb
✅ allpass, tilt, mix
🚧 ER, transient, onePole_lp

## 49. vibemic
✅ onePole_lp, onePole_hp, biquad_peak, biquad_bp, saturate, detector, mix, gain

## 50. vocal
✅ biquad_lowshelf, biquad_peak, biquad_highshelf, sineOsc, mix, saturate, detector, envelope, gainComputer, gain
🚧 phaseVocoder, stft, istft, panner

## 51. vocalLock
✅ detector, envelope, gainComputer, slew, biquad_bp, onePole_lp, onePole_hp, saturate, mix
🚧 transient

---

## Summary

- **Plugins fully ✅ shippable today:** vibemic, smoother, bassmind, splitdrive, finisher, panther, gluesmash, vocalLock (~8 plugins)
- **Plugins blocked only by 🚧 worklet ports:** ~39 plugins
- **Plugins requiring some new design (❌):** 4 (amp, analogGlue, drumBus, manChild)

The complete shopping list of unique 🚧 ops to ship to unblock everything is in `memory/nasty_orb_legacy_audit.md`.
