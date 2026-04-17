# STEP 16 — ReverbBus (pure reuse, completes the reverb family)

Fifth FDN-branch product (after MorphReverb, Gravity) and second
consumer of `EnvelopeFollowerModule` (after PlateX). **Zero core edits.**
Completes the planned reverb family except NearFar, which the Step-10
plan already marked as pure composition with no new core.

## Signal flow

```
in ─► EnvelopeFollower ─► EarlyReflections ─► FdnReverb ─► TiltEq ─► Width ─► engineMix ─► out
      (audio pass-through, posts level ~50 Hz)
```

Textbook mix-bus reverb layout. Follower reads dry input; product uses
that level to duck `engineMix` — classic bus-reverb ducker.

## Parameter mapping

| ReverbBus | Writes |
|---|---|
| SIZE    | ER.size 0.5→1.3 ; ER.spread 0.4→0.8 ; FDN.sizeScale 0.5→1.5 (bus-appropriate ceiling) |
| DECAY   | FDN.decay 0.5→5 s (exp) — bus range, no cathedrals |
| DENSITY | ER.density 0.30→0.95 |
| TONE    | TiltEq.tilt (minus GLUE warm-bias) ; FDN.dampHz 3.5k→14k (exp) |
| GLUE    | FDN.modDepth 0.10→0.40 ; FDN.modRate 0.12→0.47 Hz ; EnvelopeFollower.releaseMs 140→400 ms ; TiltEq.tilt −0.10·GLUE |
| DUCK    | product-side ducker curve → scales engineMix at ~50 Hz |
| WIDTH   | Width.width |
| MIX     | engineMix base (ducker multiplies) |

### Ducker curve (product layer)

```
x      = min(1, envLvl · 1.8)
sat    = x² · (3 − 2x)              // smoothstep — soft-saturates transients
gMix   = 1 − DUCK · 0.80 · sat       // up to 80% attenuation
engineMix_effective = state.mix · gMix
```

Rewritten on each envelope callback when `DUCK > 0.001`; skipped
otherwise to avoid idle port traffic.

Follower attack/release defaults (8 ms / 220 ms) shifted toward bus
timescales. GLUE extends release to 140–400 ms so the ducker recovers
slowly for the classic "breathing" bus-reverb feel.

## Product / core split

### Core (all reused, unchanged)
- `EnvelopeFollowerModule` — second consumer proved.
- `EarlyReflectionsModule` — second consumer (after Gravity).
- `FdnReverbModule` — third consumer (MorphReverb, Gravity, now ReverbBus).
- `TiltEqModule`, `WidthModule`, engineMix.

### Product (ReverbBus only)
- Macro fan-out.
- Ducker curve (soft-saturated envelope → mix attenuation).
- Envelope subscription + callback re-writing engineMix.
- GLUE: voicing coupling that ties mod depth, mod rate, ducker release,
  and tilt warmth into one knob.

## Parity notes vs legacy `reverbBusEngine.js`

| Area | Legacy | New | Verdict |
|---|---|---|---|
| Topology | ER + custom late net | `EarlyReflections → FdnReverb` | **Improved** — proper modal density, RT60-exact decay |
| Bus-appropriate ranges | hand-clamped | capped in product macros (size 0.5→1.5, decay 0.5→5 s) | **Match** |
| Ducker | inline env follower + per-sample mix scaling | generic `EnvelopeFollowerModule` + control-rate mix rewrite | **Match-equivalent** — 50 Hz rewrite imperceptible at ducker timescales |
| Glue character | bespoke saturation + LP | mod-depth/mod-rate/tilt/release coupling via GLUE macro | **Match-equivalent** — same psychoacoustic intent (subtle motion + slight warmth + slow recovery), different mechanism |
| Tone shaping | single LP | TiltEq + FDN per-channel dampHz | **Improved** — frequency-dependent decay |
| Width | inline M/S | `WidthModule` | **Match**, reusable |

### Now matched / improved
- Topology, decay control, tone shaping, width, ducker plumbing.

### Still differs (acceptable)
- **No inline tape/saturation on the wet bus.** Legacy used a gentle
  tape-style saturation for "bus warmth". Not added here: `TapeCharacter`
  is available in the palette and can be dropped into the chain at any
  time if user testing shows the new GLUE macro doesn't hit the same
  warmth. Adding it is one line.
- **No compressor yet.** The Step-10 plan listed `CompressorModule` as a
  deferred addition. With the reverb-family port complete and ReverbBus
  shipping via ducking alone, the compressor's trigger moves to the
  Dynamics-family phase. No compressor added in this step.

### Should remain different
- GLUE as a coupling macro (not a single-module character effect) keeps
  the product layer honest and the core lean.

## Stability notes

- All cores already proven stable in prior steps.
- Envelope follower: cannot amplify (`env ≤ max(|L|,|R|)`); ducker curve
  is monotone and clamped in [0.20, 1.0] of state.mix.
- engineMix rewrites at 50 Hz — any zipper is below the smoother's
  threshold (engineMix is an AudioParam; `setValueAtTime` is smooth by
  construction for these step sizes).
- No per-sample product code; nothing to destabilize.

## Files

| File | Change |
|---|---|
| `src/core/products/reverbBus.js` | NEW |

**No changes to `dspWorklet.js` or `fxEngine.js`.** Second reverb
product after Orbit to add zero palette or engine changes — the reuse
trajectory is now obvious.

## Rules honoured

- **Reused only** FdnReverb, EarlyReflections, EnvelopeFollower, TiltEq, Width, engineMix.
- **Ducker, glue, tone shaping** all in product layer.
- **FdnReverbModule untouched.**
- **No new core modules.** CompressorModule / DuckerModule deliberately
  not added — ducker lives in the product via the generic follower, and
  the compressor's second-consumer rationale now belongs to the
  Dynamics-family phase, not this pass.

## Risks to test on real audio

- DUCK = 1 on percussive bus (drum group) → confirm mix breathes but
  doesn't pump; tweak ducker release (tied to GLUE) if too fast.
- DUCK = 1 + DECAY = max → verify tail isn't chopped during sustained
  loud passages; release recovery should allow reverb to re-emerge.
- GLUE = 1 at small SIZE → subtle chorus-like motion on the tail; must
  not be audible as LFO wobble (modDepth cap 0.40 chosen for this).
- MIX automation under DUCK → engineMix receives both the manual value
  and the ducker curve; verify no ambiguity (product multiplies before
  writing, so automation of `setMix` is authoritative per callback).

## Architectural payoff

Reverb family is **complete as planned**:

| Product | Branch | New core added |
|---|---|---|
| Smear       | CombBank | CombBankModule, TiltEqModule (Step 11) |
| MorphReverb | FDN      | FdnReverbModule, WidthModule, parallel-chain (Step 12) |
| Gravity     | FDN      | EarlyReflectionsModule (Step 13) |
| Orbit       | CombBank | — (Step 14) |
| PlateX      | CombBank | EnvelopeFollowerModule (Step 15) |
| ReverbBus   | FDN      | — (Step 16) |
| NearFar     | FDN      | — (pending, pure reuse per Step-10 plan) |

Six reverbs shipped from five new generic modules + one small
parallel-chain primitive. Every reverb sits on the same palette; every
new module has ≥2 consumers in practice. Cross-family reuse proven
(TapeCharacter in Smear; EnvelopeFollower in PlateX/ReverbBus).

Next: NearFar for reverb-family completion, or pivot to the
Dynamics-family phase (CompressorModule, expansion, gating) which the
plan now frees to become the next architectural step.
