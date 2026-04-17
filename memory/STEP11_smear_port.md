# STEP 11 — SMEAR port + CombBankModule + TiltEqModule

First reverb-family port. Two new generic core modules + one product file. Zero forks of existing modules.

## New core modules

### `CombBankModule` (palette index 5)
- 4 parallel feedback combs per channel (Freeverb base lengths 35.3 / 36.7 / 33.8 / 32.2 ms, R-channel +0.52 ms stereo offset).
- Per-comb feedback-path 1-pole damp (Freeverb-style: `lp = lp·damp + d·(1-damp)`).
- Single global `fb`, `crossfeed`, `damp`, `sizeScale`.
- **No internal modulation.** External `mod0..mod3` params (-1..+1) shift each comb's length by up to ±64 samples; product layer or future ModMatrix drives them.
- 9 params total. `mix` for solo use; products inside a chain set it to 1.

### `TiltEqModule` (palette index 6)
- Single bipolar `tilt` (0..1, 0.5 neutral) around variable `crossover` (default 1 kHz).
- Implementation: 1-pole LP at crossover, HP derived as `x − LP`. Output = LP·(1 − 0.7·t) + HP·(1 + 0.7·t) with t in -1..+1.
- Two params total. Cheapest possible tilt; no resonance, no multi-band.

## SMEAR product

`src/core/products/smear.js` — chain `[CombBank → TapeCharacter → TiltEq] → engineMix`.

### Macro fan-out
| Smear control | Module writes |
|---|---|
| SMEAR    | CombBank.fb 0.50→0.92 ; CombBank.crossfeed 0→0.45 |
| DRIFT    | CombBank.damp += 0.05·d ; TapeCharacter.stereoDrift = 0.6·d ; **+** control-rate random walk on CombBank.mod0..3 (amplitude scaled by drift) |
| DEGRADE  | TapeCharacter.age = 0.85·d ; TapeCharacter.hiss = 0.35·d ; TapeCharacter.compAmount = 0.20 + 0.50·d |
| SIZE     | CombBank.sizeScale 0.5→1.8 |
| TONE     | TiltEq.tilt 0..1 |
| MIX      | engineMix |

### Drift modulator (control plane only)
- `setInterval(step, 33ms)` — 30 Hz tick.
- Per-comb random walk: target += uniform(-STEP,+STEP), pulled toward 0 by DECAY, clamped ±1.
- value smoothed toward `target × drift` by 0.35 per tick.
- Writes via `fx.setParam(COMB_BANK, 'mod'+k, value)`. The worklet's `ParamSmoother` two-stage chain interpolates samples between updates → audibly smooth pitch wobble.
- This is *control-rate scheduling*, not DSP: no per-sample audio code in the product layer.
- When DRIFT = 0 the timer relaxes mods toward 0 (×0.85 per tick) and stops writing, so idle CPU stays minimal.
- Will be replaced by a generic `ModSourceLFO/RandomWalk` once the ModMatrix layer lands; product API stays unchanged.

### Reused — no new code
- `TapeCharacterModule` provides hiss / age / stereoDrift / comp directly. This is the cross-family reuse proof point: a delay-family core module powers a reverb-family product unmodified.

## Files
| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `CombFilter` helper, `CombBankModule`, `TiltEqModule`; palette indices 5, 6 |
| `src/core/fxEngine.js`   | + `MODULE.COMB_BANK`, `MODULE.TILT_EQ`, `COMB_BANK_PARAMS`, `TILT_EQ_PARAMS` |
| `src/core/products/smear.js` | NEW |

## A/B vs legacy `smearEngine.js` (analytical)

| Area | Legacy | New | Verdict |
|---|---|---|---|
| Comb topology | 4 parallel combs, ~ same Freeverb base lengths | identical | **Match** |
| Crossfeed | write-side L↔R blend by `smear` | same form, capped 0.45 | **Match** |
| Per-comb pitch drift | random-walk on read positions | random-walk on length offsets via mod0..3 | **Match** (different param surface, equivalent audible behaviour) |
| Damp in fb | per-comb 1-pole LP | identical Freeverb form | **Match** |
| DEGRADE bitcrush | sample-rate decimation + bit reduction | not implemented | **Differs — deferred** (CrushModule still pending) |
| DEGRADE noise | per-sample white noise add | TapeCharacter.hiss (LP'd pink-ish) | **Cleaner / improvement** |
| DEGRADE LP aging | extra LP in legacy | TapeCharacter.age handles HF rolloff + LF tightening | **Match-equivalent**, slightly more tonally complete |
| Tilt EQ | inline tilt per-sample with fixed 1 kHz pivot | TiltEqModule (variable crossover, default 1 kHz) | **Match** with bonus configurability |
| Output gain staging | mix + output trim | engineMix | **Match** |

### Now matched / improved
- Comb structure, crossfeed, drift behaviour, damp, tilt: **on parity**.
- Noise floor: **improved** (LP'd pink vs raw white).
- Aging tone: **improved** (combined HF rolloff + LF tightening + slow comp).

### Still differs (acceptable)
- **No bitcrush yet.** Smear's DEGRADE currently exposes age + hiss + comp — sonically in the same family but missing the gritty SR-decimation flavour. CrushModule is the agreed second-consumer trigger (Smear + Playbox CRUSH chain). Adding it is one focused step away.

### Should remain different
- Drift via length-offset modulation (vs legacy's read-position offset) — same pitch-warble effect, but the param surface plays cleanly with the future ModMatrix routing model.

## Risks to test on real audio
- High SMEAR + high SIZE → confirm no comb runaway (fb cap 0.92 × Freeverb-style damp should hold).
- DRIFT max → confirm no zipper artefacts on the 30 Hz updates (ParamSmoother is the line of defence; if audible, raise tick rate to 60 Hz).
- DEGRADE max + DRIFT max → CPU sanity (TapeCharacter has random + comp + filters; should still be cheap).
- TONE sweep across 0↔1 → no audible click at 0.5 crossover (smoother on tilt param).
