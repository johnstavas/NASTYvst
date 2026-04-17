# STEP 6 — ECHOFORM PORT TO UNIFIED CORE

First production migration onto the Step-5 core. Legacy `src/echoformEngine.js` left untouched; new product lives at `src/core/products/echoform.js`.

## Files added / extended

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `AllpassDelay` + `DiffuserModule` (4-stage Schroeder allpass, generic) |
| `src/core/dspWorklet.js` | + `ToneModule` (LP+HP, optional 2-pole cascade, generic) |
| `src/core/dspWorklet.js` | `FxProcessor` now hosts a stable module palette (Delay/Diffuser/Tone) and runs an indexed `chain[]` in series, with a new `engineMix` AudioParam crossfading against the dry that entered the chain |
| `src/core/fxEngine.js` | + `MODULE` enum, `DIFFUSER_PARAMS`, `TONE_PARAMS`, `setChain`, `setEngineMix`, `setEngineMixMode` |
| `src/core/products/echoform.js` | NEW — thin product layer, no DSP of its own |

## Chain configuration

```
fx.setChain([MODULE.DELAY, MODULE.DIFFUSER, MODULE.TONE]);
fx.setEngineMixMode(true);   // chain modules run wet-only
fx.setParam(DELAY,'mix',1, {snap:true});
```

## Macro fan-out (from `echoform.js`)

| Echoform control | Module writes |
|---|---|
| TIME (0..1)   | DELAY.timeL = 50 ms + 1150 ms·t; DELAY.timeR = timeL · widthDetune |
| FEEDBACK      | DELAY.feedback = fb · 0.92 |
| DEGRADE       | DELAY.damp = 0.5 + 0.5·d ; DELAY.lowCut = 80 + 180·d ; DELAY.drive = 0.55·d |
| MOTION        | DELAY.wowDepth = 0.8·m ; wowRate = 0.5 + 2·m ; flutterDepth = 0.3·m ; flutterRate = 6 + 4·m |
| BLUR          | DIFFUSER.amount = b ; size = 0.3 + 0.7·b |
| TONE          | TONE.lpHz = (2 k + 14 k·t) · smoothScale |
| SMOOTH        | TONE.stages = 2 if smooth>0.05 ; lpHz scaled by (1 − 0.5·smooth) |
| WIDTH         | <1: stereoMode=0 + L/R micro-detune via timeR ; 1..1.5: stereoMode=2 (cross-feed) ; ≥1.5: stereoMode=1 (ping-pong) |
| MIX           | engineMix |
| BYPASS        | FxProcessor.bypass AudioParam |

## Architectural rules upheld

- `DelayModule` was not modified — Echoform composes around it.
- `DiffuserModule` and `ToneModule` are generic primitives, not Echoform-private.
- `FxProcessor.chain` extension benefits every future product.
- Echoform owns: control mapping, presets, defaults — nothing else.

## A/B test plan vs legacy

1. Drum loop at TIME=0.4, FB=0.5, all character knobs 0 → both outputs should be perceptually identical (clean digital delay).
2. Sweep DEGRADE 0→1 with FB=0.7 → legacy uses LP+HP-thin+sat in feedback; new uses damp+lowCut+drive in feedback. Confirm tone trajectory matches (target: indistinguishable in blind A/B; small differences acceptable since underlying filter form differs slightly).
3. BLUR 0→1 with DEGRADE=0 → legacy uses single allpass at 50–250 samples; new uses 4-stage Schroeder. New should sound denser/more diffuse (intentional improvement; document as character upgrade).
4. WIDTH 0/1/2 with mono input → confirm collapsed mono / stereo spread / ping-pong behaviour.
5. MOTION sweep at TIME=80 ms → check no Doppler clicks (Lagrange-3 read).
6. Automate MIX 0↔1 fast → no zipper (engine equal-power crossfade on smoothed AudioParam).

## UI swap (next pass)

`EchoformOrb.jsx` currently calls `createEchoformEngine`. To migrate: import `createFxEngine` and `createEchoform`, replace setter calls 1:1 (same names). When confirmed, delete `src/echoformEngine.js` and unregister `'echoform-v1'`.

## Known divergences from legacy (intentional)

- Diffusion is now genuinely cascaded (richer, less metallic).
- HP-thin in DEGRADE is via 1-pole HP (block-rate coefficient) instead of subtractive trick — cleaner, fewer zipper risks.
- Output tone is a true 1-pole (or 2-pole when SMOOTH active) LP at the chain tail — legacy applied output LP only when `tone < 0.8`; new applies always but with cutoff up to 18 kHz at TONE=1, perceptually equivalent.

## What this unlocks

- TapeDelay port now reduces to: chain [Delay × 3 (parallel — pending RoutingGraph)] + Tone, with heavy wow/flutter and drive presets.
- Drift port: chain [Delay] only, time ≈ 8 ms, fb=0, wow+flutter high.
- Reverb pre-diffusion: future `FdnReverbModule` can re-use `DiffuserModule` directly.
