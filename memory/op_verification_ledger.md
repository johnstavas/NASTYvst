# Op Verification Ledger

Live tracker for the 7-gate verification protocol. Source-of-truth for
which ops are personally signed off vs. still need re-test.

## How to read this

| Gate | Meaning |
|---|---|
| **W** | Worklet exists and is real (not a TODO stub) |
| **C** | C++ port exists and is real (not zero-fill) |
| **S** | Smoke graph file exists in `test/fixtures/codegen/` |
| **T** | T1–T7 sweep passes (proxy: smoke graph exists) |
| **P** | T8 native parity entry exists in `per_op_specs.json` |
| **B** | T8-B behavioral spec exists in `behavioral/specs/*.mjs` |
| **L** | LISTEN — Stav personally heard it in a session and signed off |

Gates W–B are auto-detected and refreshed by `node scripts/generate_verification_ledger.mjs`.
Gate L is manually edited — fill in your initials + date when you sign off (e.g. `JS 2026-05-01`).
Notes column survives regenerations.

**Gold status (✅+P+✓ in catalog) = all 7 gates green.**

Total ops: 132. Auto-gates 6/6 (need only listen): 31.

## Ledger

| Op | W | C | S | T | P | B | L (listen sign-off) | Notes |
|---|---|---|---|---|---|---|---|---|
| ER | ✓ | ✓ | · | · | · | · |  |  |
| SDN | ✓ | ✓ | · | · | · | · |  |  |
| abs | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| adsr | ✓ | ✓ | · | · | · | · |  |  |
| allpass | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| autopan | ✓ | ✓ | · | · | · | · |  |  |
| bbdDelay | ✓ | ✓ | · | · | · | · |  |  |
| bitcrush | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| blackmerVCA | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| blit | ✓ | ✓ | · | · | · | · |  |  |
| bpm | ✓ | ✓ | · | · | · | · |  |  |
| busSum | ✓ | ✓ | · | · | · | · |  |  |
| chamberlinZeroCross | ✓ | ✓ | · | · | · | · |  |  |
| chaos | ✓ | ✓ | · | · | · | · |  |  |
| chebyshevWS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| chromagram | ✓ | ✓ | · | · | · | · |  |  |
| clamp | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| comb | ✓ | ✓ | · | · | · | · |  |  |
| combine | ✓ | ✓ | · | · | · | · |  |  |
| constant | ✓ | ✓ | ✓ | ✓ | ✓ | · |  |  |
| convolution | ✓ | ✓ | · | · | · | · |  |  |
| correlation | ✓ | ✓ | · | · | · | · |  |  |
| crackle | ✓ | ✓ | · | · | · | · |  |  |
| crepe | ✓ | ✓ | · | · | · | · |  |  |
| crossfade | ✓ | ✓ | · | · | · | · |  |  |
| crossfeed | ✓ | ✓ | · | · | · | · |  |  |
| curve | ✓ | ✓ | · | · | · | · |  |  |
| dcBlock | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| delay | ✓ | ✓ | · | · | · | · |  |  |
| detector | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| diffuser | ✓ | ✓ | · | · | · | · |  |  |
| diodeBridgeGR | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| diodeClipper | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| diodeLadder | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| dither | ✓ | ✓ | · | · | · | · |  |  |
| envelope | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| envelopeFollower | ✓ | ✓ | · | · | · | · |  |  |
| expander | ✓ | ✓ | · | · | · | · |  |  |
| fanOut | ✓ | ✓ | · | · | · | · |  |  |
| fdnCore | ✓ | ✓ | · | · | · | · |  |  |
| fetVVR | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| fft | ✓ | ✓ | · | · | · | · |  |  |
| filter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| fm | ✓ | ✓ | · | · | · | · |  |  |
| formant | ✓ | ✓ | · | · | · | · |  |  |
| fpDacRipple | ✓ | ✓ | · | · | · | · |  |  |
| gain | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| gainComputer | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| gate | ✓ | ✓ | · | · | · | · |  |  |
| glide | ✓ | ✓ | · | · | · | · |  |  |
| goertzel | ✓ | ✓ | · | · | · | · |  |  |
| granularBuffer | ✓ | ✓ | · | · | · | · |  |  |
| haas | ✓ | ✓ | · | · | · | · |  |  |
| hardClip | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| hiss | ✓ | ✓ | · | · | · | · |  |  |
| ifft | ✓ | ✓ | · | · | · | · |  |  |
| istft | ✓ | ✓ | · | · | · | · |  |  |
| kWeighting | ✓ | ✓ | · | · | · | · |  |  |
| karplusStrong | ✓ | ✓ | · | · | · | · |  |  |
| kellyLochbaum | ✓ | ✓ | · | · | · | · |  |  |
| korg35 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| ladder | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| lfo | ✓ | ✓ | · | · | · | · |  |  |
| lookahead | ✓ | ✓ | · | · | · | · |  |  |
| loudnessGate | ✓ | ✓ | · | · | · | · |  |  |
| lpc | ✓ | ✓ | · | · | · | · |  |  |
| lrXover | ✓ | ✓ | · | · | · | · |  |  |
| lra | ✓ | ✓ | · | · | · | · |  |  |
| lufsIntegrator | ✓ | ✓ | · | · | · | · |  |  |
| meters | ✓ | ✓ | · | · | · | · |  |  |
| mfcc | ✓ | ✓ | · | · | · | · |  |  |
| microDetune | ✓ | ✓ | · | · | · | · |  |  |
| minBLEP | ✓ | ✓ | · | · | · | · |  |  |
| mix | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| msDecode | ✓ | ✓ | · | · | · | · |  |  |
| msEncode | ✓ | ✓ | · | · | · | · |  |  |
| noise | ✓ | ✓ | · | · | · | · |  |  |
| noiseShaper | ✓ | ✓ | · | · | · | · |  |  |
| onePole | ✓ | ✓ | · | · | ✓ | ✓ |  |  |
| onset | ✓ | ✓ | · | · | · | · |  |  |
| optoCell | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| oversample2x | ✓ | ✓ | · | · | · | · |  |  |
| padSynth | ✓ | ✓ | · | · | · | · |  |  |
| panner | ✓ | ✓ | · | · | · | · |  |  |
| peak | ✓ | ✓ | · | · | · | · |  |  |
| phaseVocoder | ✓ | ✓ | · | · | · | · |  |  |
| pitchShift | ✓ | ✓ | · | · | · | · |  |  |
| plate | ✓ | ✓ | · | · | · | · |  |  |
| polarity | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| polyBLEP | ✓ | ✓ | · | · | · | · |  |  |
| pyin | ✓ | ✓ | · | · | · | · |  |  |
| quantizer | ✓ | ✓ | · | · | · | · |  |  |
| ramp | ✓ | ✓ | · | · | · | · |  |  |
| randomWalk | ✓ | ✓ | · | · | · | · |  |  |
| rms | ✓ | ✓ | · | · | · | · |  |  |
| sampleHold | ✓ | ✓ | · | · | · | · |  |  |
| saturate | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| scaleBy | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| scatteringJunction | ✓ | ✓ | · | · | · | · |  |  |
| schroederChain | ✓ | ✓ | · | · | · | · |  |  |
| select | ✓ | ✓ | · | · | · | · |  |  |
| shelf | ✓ | ✓ | · | · | ✓ | ✓ |  |  |
| sidechainHPF | ✓ | ✓ | · | · | · | · |  |  |
| sign | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| sineOsc | ✓ | ✓ | · | · | · | · |  |  |
| slew | ✓ | ✓ | ✓ | ✓ | ✓ | · |  |  |
| smooth | ✓ | ✓ | ✓ | ✓ | ✓ | · |  |  |
| softLimit | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| spring | ✓ | ✓ | · | · | · | · |  |  |
| srcResampler | ✓ | ✓ | ✓ | ✓ | ✓ | · |  |  |
| stepSeq | ✓ | ✓ | · | · | · | · |  |  |
| stereoWidth | ✓ | ✓ | · | · | · | · |  |  |
| stft | ✓ | ✓ | · | · | · | · |  |  |
| svf | ✓ | ✓ | · | · | ✓ | ✓ |  |  |
| tapeAirwindows | ✓ | ✓ | · | · | · | · |  |  |
| tapeSim | ✓ | ✓ | · | · | · | · |  |  |
| tilt | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| transformerSim | ✓ | ✓ | · | · | · | · |  |  |
| transient | ✓ | ✓ | · | · | · | · |  |  |
| trigger | ✓ | ✓ | · | · | · | · |  |  |
| truePeak | ✓ | ✓ | · | · | · | · |  |  |
| tubeSim | ✓ | ✓ | · | · | · | · |  |  |
| uniBi | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| varMuTube | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| velvetNoise | ✓ | ✓ | · | · | · | · |  |  |
| warpedLPC | ✓ | ✓ | · | · | · | · |  |  |
| wavefolder | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| waveguide | ✓ | ✓ | · | · | · | · |  |  |
| wavetable | ✓ | ✓ | · | · | · | · |  |  |
| xformerSat | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |
| yin | ✓ | ✓ | · | · | · | · |  |  |
| z1 | ✓ | ✓ | · | · | · | · |  |  |
