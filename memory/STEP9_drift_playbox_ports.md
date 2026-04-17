# STEP 9 — Drift + Playbox ports

Goal: prove the delay-family core supports multiple distinct products without forking. Result: **two products, zero new core modules.**

---

## DRIFT

### Spec mapping
| Drift control | Module / param |
|---|---|
| MOTION   | DELAY.wowDepth (× DEPTH) |
| DEPTH    | DELAY.wowDepth multiplier |
| SPEED    | DELAY.wowRate + DELAY.flutterRate |
| RANDOM   | DELAY.flutterDepth |
| STEREO   | DELAY.timeR offset (±4 ms) + stereoMode (cross at >0.7) |
| TONE     | TONE.lpHz |
| MIX      | engineMix |
| (static) | timeL=6 ms, feedback=0, drive=0 |

### Gap analysis
None. DelayModule with feedback=0 is a single-tap modulated delay = chorus engine. ToneModule supplies output color.

### Implementation
`src/core/products/drift.js`. Chain `[DELAY → TONE]`, engineMix. ~70 lines, zero DSP.

### Parity vs legacy `driftEngine.js`
- Multi-LFO (legacy summed 4 LFOs incl. random walk) approximated by wow + flutter at non-integer ratios — beats produce the same "non-repeating" feel.
- Random-walk on stereo replaced by R-tap offset + cross-feed mode at high STEREO. Acceptable difference; eliminates the legacy zipper risk on RANDOM=1.

### Migration
`DriftOrb.jsx` setter calls map 1:1 (`setMotion/Speed/Random/Stereo/Tone/Depth/Mix/Bypass`). Swap `createDriftEngine` → `createFxEngine` + `createDrift`. Delete `driftEngine.js` after sign-off.

---

## PLAYBOX

### Spec mapping
Playbox is a **runtime chain reconfigurator**. CHAIN selects a configurator function that rewrites the chain and reprograms DELAY/TONE for that effect identity. Macros INTENSITY/SPEED/COLOR are reinterpreted per chain.

| CHAIN | Configurator behaviour |
|---|---|
| 0 FLANGE | DELAY: 2–6 ms tap, fb=0.85·I, wow 0.5+0.3·I @ 0.1–4 Hz, stereoMode=cross. TONE 1.8 k–16 k via COLOR. |
| 1 ECHO   | DELAY: 60–560 ms tap (SPEED maps to time), fb=0.85·I, R-detune 1.4 %, ping-pong, drive 0.2·I. TONE 1.8 k–16 k. |
| 2 FILTER | DEFERRED → falls through to ECHO until `ResonantFilterModule` lands. |
| 3 WIDEN  | DELAY: 5 ms L, 5+3..17 ms R offset by INTENSITY, fb=0, light wow chorus, stereo cross. |
| 4 CRUSH  | DEFERRED → bypass until `CrushModule` lands. |

### Gap analysis
- FILTER (resonant LP sweep) — not in core.
- CRUSH (bitcrush + SR reduction) — not in core.

Per Rule 3 ("only add core if BOTH products need it"), neither Drift nor any other current product needs FILTER or CRUSH → **defer**. Playbox v1 ships 3 of 5 chains live; the deferred two route to ECHO and BYPASS respectively. The architectural proof point — runtime chain switching — is fully demonstrated.

`ResonantFilterModule` and `CrushModule` will land when a future product (Lo-fi / Filter pedal / etc.) also requires them.

### Implementation
`src/core/products/playbox.js`. ~140 lines, zero DSP.

### Parity vs legacy `playboxEngine.js`
- FLANGE / ECHO / WIDEN: equivalent topology to legacy on these three chains; arguably better (Lagrange-3 read, two-stage smoothing, no zipper on COLOR sweep).
- FILTER / CRUSH: not yet at parity (deferred — documented as known v1 limitation).

### Migration
`PlayboxOrb.jsx` setter calls map 1:1 (`setChain/Intensity/Speed/Color/Mix/Bypass`). Until FILTER/CRUSH land, the UI should either disable those chain options or surface a "coming soon" badge.

---

## Architectural validation

| Goal | Result |
|---|---|
| Reuse existing core | ✅ Both products use only existing palette modules |
| No core forking | ✅ Zero core modifications this step |
| Product identity in product layer only | ✅ All chain-specific behavior lives in the configurator functions |
| Runtime chain reconfiguration | ✅ Playbox proves it via `setChain` per CHAIN selection |
| Macro reinterpretation per product | ✅ INTENSITY means different things per Playbox chain; COLOR drives fb-damp + output-LP simultaneously |

Files added:
- `src/core/products/drift.js`
- `src/core/products/playbox.js`

Files unchanged:
- `src/core/dspWorklet.js`
- `src/core/fxEngine.js`

## Next candidates
With 4 delay-family products on the unified core (Echoform, TapeDelay, Drift, Playbox), the time-based group is fundamentally proven. Reasonable next moves:
1. **PitchShifter port** — granular path needs a fractional read at multiple grain offsets; shape will reveal whether DelayModule needs a "free read at arbitrary offset" API or whether a dedicated `GranularModule` belongs in the core.
2. **Begin Modulation group** (Flanger / Phaser / VibeMic) — Flanger is essentially Playbox's FLANGE chain; Phaser needs an `AllpassChainModule` (cascaded APF, NOT the diffuser). Lays groundwork for a cleanly-shared phaser core.
3. **Add `MonoBlendModule`** — tiny generic primitive (1-line process loop) that finally lets Echoform's WIDTH<1 mono-collapse divergence close out.
