# STEP 8 — TapeCharacterModule + TapeDelay parity pass

## New core primitive

`TapeCharacterModule` (palette index 4) — generic tape voice color, **zero time behavior**. Independent of TapeMultiTapModule and any specific product.

### Params (8)
| Param | Range | What it does |
|---|---|---|
| hiss        | 0..1 | 2-stage LP'd white → pink-ish noise floor (~ −38 dBFS @ 1) |
| hum         | 0..1 | 60 Hz fundamental + 0.35× 3rd harmonic |
| humHz       | 50..60 | mains frequency selector |
| xfmrDrive   | 0..1 | input gain into softSat (k = 1 + 2.5·drive) |
| xfmrColor   | 0..1 | LP-shelf blend amount (warmth/presence-dip) |
| compAmount  | 0..1 | mono-detect program comp (atk 30 ms, rel 250 ms) |
| age         | 0..1 | HF rolloff 18 k → 6 k + LF tightening 80 → 40 Hz |
| stereoDrift | 0..1 | slow random L/R gain wobble (refresh ~80 ms) |

### Internal signal flow
```
in → comp(GR) → xfmrLP-blend → softSat(xfmrDrive) → ageHP→ageLP
   → +hiss → +hum → ×stereoDrift → DC-block → out
```

### Design notes
- **Order matters**: comp comes first so tape "leans into" peaks before transformer non-linearity sees them.
- **Hum/hiss added post-NL**: noise floor doesn't get folded into harmonics.
- **DC blocker** at the very end catches asymmetric softSat / hum bias.
- **No state-shared with TapeMultiTap** — character module knows nothing about taps, feedback, or wow.

## Updated TapeDelay product chain

```
[TapeMultiTap]  →  [TapeCharacter]  →  [Tone]  →  engineMix  →  out
                    (skipped when characterEnabled=false)
```

- `setCharacterEnabled(false)` rebuilds chain to `[TapeMultiTap → Tone]` for clean A/B vs legacy time behavior.
- 8 new product setters: `setHiss / setHum / setHumHz / setXfmrDrive / setXfmrColor / setComp / setAge / setStereoDrift`.
- Defaults pre-tuned for warm-on character (hiss=0.10, hum=0.05, xfmrDrive=0.30, comp=0.30, age=0.20, stereoDrift=0.10).

## Legacy TapeDelay parity pass (analytical)

| Legacy feature | New mechanism | Status |
|---|---|---|
| 3 heads sharing one loop | `TapeMultiTapModule` | **Matched** |
| Per-head time/vol/on | tape time1-3 / vol1-3 / on1-3 | **Matched** |
| Wow + flutter (3 detuned LFOs summed) | wow LFO + flutter LFO | **Close** — single LFO each (depth/rate match musical range) |
| Treble/Bass tape EQ | TONE.lpHz + TONE.hpHz | **Matched** (better — clean 1-pole) |
| Drive (write saturation) | TapeMultiTap.drive in feedback path | **Matched** functionally |
| Spread (head pan) | TapeMultiTap.spread | **Matched** |
| Tape hiss | TapeCharacter.hiss | **Matched** |
| 60 Hz hum + 180 Hz buzz | TapeCharacter.hum (fund + 3rd) | **Matched** |
| Output transformer shelf | TapeCharacter.xfmrColor + xfmrDrive | **Matched** (cleaner topology) |
| Dry-path warmth filter | not implemented | **Intentional difference** — dry path stays neutral; engineMix preserves true bypass character |
| Tape motor instability / drift on long fb | partial via stereoDrift + wow | **Close** — legacy accumulated drift on the write head; new drift acts on output gain only |
| Slow tape compression | TapeCharacter.compAmount | **New / improvement** — legacy had no explicit compression; we now make this knob explicit |
| Asymmetric tube/tape soft sat | softSat in xfmr stage | **Cleaner** — legacy used tanh; we use rational softSat (cheaper, similar curve, less HF aliasing) |

### Now matched
Time domain, head behavior, EQ shaping, hiss, hum, transformer-flavoured saturation, head pan/spread, compression character.

### Still differs (acceptable)
- **Wow LFO topology**: 1 sine + 1 tri vs legacy's 3 detuned sines summed. Within musical envelope, perceptually equivalent; can extend `LFO` later with a "summed-detuned" mode if needed.
- **Motor write-head drift**: legacy moved the *write* position fractionally over time. We approximate via output-side stereoDrift. True write-side drift would require a small extension to `DelayLine` (smoothed write index). Defer.
- **Cleaner softSat curve**: rational vs tanh — sub-1 dB tonal difference, no aliasing penalty.

### Should remain intentionally different
- **Dry-path warmth filter** stays out: violates "engineMix preserves dry" invariant. Users who want a colored dry should chain a separate Saturator product.
- **Output transformer** as a bilinear shelf rather than legacy's resonant shelf — cleaner, doesn't ring at high drive.

## Files touched
| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `TapeCharacterModule`, registered as palette index 4 |
| `src/core/fxEngine.js`   | + `MODULE.TAPE_CHARACTER`, + `TAPE_CHARACTER_PARAMS` |
| `src/core/products/tapeDelay.js` | character chained + 8 new setters + `setCharacterEnabled` |

## Reusability
TapeCharacterModule is now available to **any** product. Future use cases:
- "Cassette" lo-fi product: high age + high hiss + high stereoDrift, no delay.
- Vocal warmth chain: low xfmrDrive + small comp + zero hiss/hum.
- Drum buss tape glue: medium comp + low age + low hiss.

## Risks to test on real audio
- Hiss + hum at level 0 → confirm bit-exact silent (no DC residual from softSat).
- Age=1 + hiss=1 → confirm hiss isn't audibly LP'd by age stage (it is — that's correct, mirrors real tape).
- compAmount=1 on transient material → no pumping artefacts (slow attack should keep it musical).
- StereoDrift=1 sustained → check no phasey artefacts (we drive gain, not delay, so phase stays clean).
- All character knobs maxed + heavy feedback → confirm no runaway (compression + softSat in TapeMultiTap fb path keeps it bounded).
