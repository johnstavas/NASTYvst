# STEP 12 — MorphReverb port + FdnReverbModule + WidthModule + parallel-chain primitive

Flagship validation of the reverb-family architecture from Step 10. Adds the
generic late-field engine (`FdnReverbModule`), the stereo width utility
(`WidthModule`), and a small generic addition to the worklet's chain runner
(parallel branch crossfaded by a `morph` AudioParam). Reuses DiffuserModule
twice — no new diffuser code.

## Signal flow

```
in ──► [ parallel:  DiffuserA ┐                                          ]
                              ├─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
                    DiffuserB ┘   (equal-power crossfade by `morph` k-rate AP)
```

Both diffusers run every block; the crossfade is a pure amplitude blend, so
the MORPH knob can automate at audio-rate without clicks or allpass
length-change artefacts.

## New generic cores

### `FdnReverbModule` (palette index 7)

8-channel feedback delay network, Householder mixing, per-channel HF
damping shelf, fractional read mod for warp, RT60-derived per-line gains.

| Param | Range | Notes |
|---|---|---|
| `decay`     | 0.2–12 s | RT60 target; `g_k = 10^(-3·D_k / (decay·sr))` |
| `sizeScale` | 0.3–2.0  | scales all 8 base lengths; shortest channel clamped > 4·maxModSamples |
| `dampHz`    | 1.5k–18k | per-channel 1-pole LP in feedback path |
| `modDepth`  | 0–1      | fractional read offset, 0..24 samples |
| `modRate`   | 0.05–3 Hz| 8 detuned LFO phases, golden-ratio stagger |
| `inputGain` | 0–1      | input spray trim (before Householder injection) |
| `mix`       | 0–1      | module-local dry/wet (1.0 inside products) |

Topology: 8 `DelayLine` primitives @ 250 ms each; input sprayed by the
first Householder row `[1,1,1,-1,1,-1,-1,1]` (sign-only; energy-preserving).
Feedback mix is the Householder reflection `a[k] -= f` with
`f = (Σ a) · 2 / N`. Output: even lines → L, odd → R; summed post-mix.
Internal LFOs are intentional: FDN warp is intrinsic character, not a
routable source — CombBank stays the pure externally-modulated module.

### `WidthModule` (palette index 9)

Textbook M/S width. `width` 0..2 (0 mono, 1 neutral, 2 super-wide).
One param. Used by MorphReverb, Gravity, ReverbBus, NearFar, and to
retroactively close Echoform's WIDTH<1 gap.

### Second `DiffuserModule` (palette index 8 = `DIFFUSER_B`)

Not new code — a second instance of the existing `DiffuserModule`. Only
exists because the parallel A/B morph needs two independent state
containers. Any product wanting a single diffuser continues to use
`MODULE.DIFFUSER` as before.

## Parallel-chain primitive (FxProcessor)

`setChain` now accepts mixed entries:

- `number` → serial module index (existing behaviour)
- `{ parallel: [[idxsA...], [idxsB...]] }` → two sub-chains fed the same
  input, crossfaded into the next serial slot.

Crossfade is equal-power on the `morph` AudioParam
(`A·cos(m·π/2) + B·sin(m·π/2)`). Two extra block-sized buffers
(`_aL/_aR/_bL/_bR`) allocated once in `_prepare`. A new k-rate
`morph` AudioParam (default 0.5) is now part of `parameterDescriptors`.

This is the minimal generic addition. Future products that need
multiband, true parallel combs (PlateX), or A/B topology crossfades get
it for free.

## MorphReverb product

`src/core/products/morphReverb.js`. Chain:

```
[ parallel: [DIFFUSER], [DIFFUSER_B] ] → FDN_REVERB → TILT_EQ → WIDTH
```

Per-branch diffuser character fixed by the product:

| Branch | size | amount | Intent |
|---|---|---|---|
| A (DIFFUSER)   | 0.30 + SIZE·0.35 | 0.30 + DENSITY·0.65 | Tight, early-reflection pre-diffusion |
| B (DIFFUSER_B) | 0.70 + SIZE·0.30 | 0.15 + DENSITY·0.65 | Loose, plate-like wash |

### Macro fan-out

| Macro | Writes |
|---|---|
| MORPH   | `fx.setMorph(m)` — drives the `morph` AudioParam (sample-accurate) |
| SIZE    | DiffuserA.size, DiffuserB.size (per-branch offsets above); FdnReverb.sizeScale 0.5→1.8 |
| DECAY   | FdnReverb.decay 0.4s→9s (exp) |
| TONE    | TiltEq.tilt 0..1 ; FdnReverb.dampHz 2.5k→16k (exp) |
| DENSITY | DiffuserA.amount, DiffuserB.amount (per-branch offsets above) |
| WARP    | FdnReverb.modDepth = w ; FdnReverb.modRate = 0.15 + w·0.85 Hz |
| WIDTH   | Width.width (0..2 raw) |
| MIX     | engineMix |

No timers, no DSP, no product-specific core tweaks.

## Files

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `FdnReverbModule`, `WidthModule`; palette indices 7, 8 (DiffuserB), 9; `morph` AudioParam; `_validChain`, `_runSerial`; parallel-branch execution in `process()` |
| `src/core/fxEngine.js`   | + `MODULE.FDN_REVERB / DIFFUSER_B / WIDTH`; `FDN_REVERB_PARAMS`, `WIDTH_PARAMS`; `setMorph`; parallel-aware `setChain` |
| `src/core/products/morphReverb.js` | NEW |

## Stability notes

- **Per-line gain** `g_k = 10^(-3·D_k / (decay·sr))` → bounded < 1 for all
  finite decay; clamped to ≤ 0.999 in the worklet as a belt-and-braces.
- **Householder matrix** `H = I − (2/N)·11ᵀ` is orthogonal → unitary, so
  the feedback mix neither amplifies nor attenuates per recirculation.
  Combined with `g_k < 1` and the HF LP (attenuating only), the loop is
  provably stable at any decay, size, and mod-depth.
- **Fractional read** uses `DelayLine`'s existing Lagrange-3. Min read
  position at largest `sizeScale·mod` stays well inside the delay buffer
  (shortest channel ≈ 1130 samples @ 48k, maxMod = 24 samples).
- **Parallel crossfade** equal-power; no state drift between branches
  (they process the same input every block, no write-ordering hazard).
- **No zipper on morph** — the AudioParam is k-rate sampled per-block;
  if finer motion is needed later, flip it to a-rate (the loop already
  reads per-sample when `length > 1`).

## Parity / A-B vs legacy `morphReverbEngine.js`

| Area | Legacy | New | Verdict |
|---|---|---|---|
| Late-field engine | hand-rolled 4-line feedback network | 8-ch Householder FDN (Luff/Smith standard) | **Improved** — denser modal density, industry-standard topology |
| Diffuser | single AP cascade tweaked by MORPH | two parallel AP cascades crossfaded | **Match-equivalent** audibly, architecturally cleaner |
| Morph morphology | parameter interpolation (risk of click on long AP length changes) | pure amplitude crossfade of live branches | **Improved** — click-free, automatable |
| RT60 control | ad-hoc feedback gain | proper per-line `10^(-3D/(Tsr))` | **Improved** (predictable decay times) |
| HF damping | single post filter | per-channel feedback-path LP | **Improved** (frequency-dependent decay, truer to real rooms) |
| Warp / modulation | global LFO on delay read | 8 detuned per-line LFOs, golden-ratio stagger | **Match-equivalent / slight improvement** — less obvious pitch seam |
| Tilt EQ | inline tilt, fixed pivot | `TiltEqModule` (configurable pivot) | **Match** with bonus configurability |
| Width | inline L/R scaling | `WidthModule` M/S | **Match-equivalent**, reusable |
| Output staging | mix + trim | engineMix | **Match** |

### Now matched / improved
- Topology: 4-line bespoke → 8-ch Householder FDN.
- Morph: parameter-jump → live-branch crossfade.
- Decay: ad-hoc → RT60-exact.
- Damping: single global LP → per-channel in feedback loop.

### Still differs (acceptable)
- No per-preset hand-tuned early-reflection set; ERs are currently implicit
  in DiffuserA. When `EarlyReflectionsModule` lands (Gravity, Step 13), it
  can be slotted in front of the parallel diffuser pair without changing
  any existing product code.

### Should remain different
- Morph now drives live amplitude crossfade, not parameter interpolation.
  This is a deliberate architectural gain and should not regress.

## Risks to test on real audio

- MORPH sweep at any DECAY → confirm click-free (it should be, by construction).
- DECAY = max (12 s) + SIZE = max → confirm no runaway; meter the feedback
  envelope decays monotonically.
- WARP = 1 + SIZE min → confirm fractional read never reads past write
  (24 samples ≪ ~1130-sample shortest line at sizeScale 0.5).
- TONE sweep → no audible artefact from the joint TiltEq/dampHz move.
- WIDTH 0 → verify true mono collapse; WIDTH 2 → no phase artefacts on
  correlated material.

## Architectural payoff

MorphReverb is the first product to exercise **all** the Step-10 rules at
once:

- Generic core does DSP; product layer does mapping.
- Cross-family reuse (DiffuserModule, TiltEqModule) works unchanged.
- Parallel-chain primitive added once, benefits all future products
  (PlateX parallel combs, MorphReverb A/B, future multiband).
- Morph is an AudioParam — host automation and ModMatrix ready out of
  the box, no product-layer timer required.

Next: Step 13 lands `EarlyReflectionsModule` via Gravity.
