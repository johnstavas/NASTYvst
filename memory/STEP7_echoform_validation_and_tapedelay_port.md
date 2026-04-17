# STEP 7 — ECHOFORM A/B VALIDATION + TAPE DELAY PORT

## A. Echoform A/B (analytical, code-level)

| # | Area | Legacy | New (initial) | Verdict | Action |
|---|---|---|---|---|---|
| 1 | DEGRADE damp start | 12 kHz @ d=0 | ~9.6 kHz | break | mapping: damp = 0.40 + 0.55·d → ≈11.3 kHz @ d=0, 2 kHz @ d=1 |
| 2 | DEGRADE drive | tanh(x·2.8)/2.2 | softSat(x·3.2) | hot | mapping: drive = 0.40·d (was 0.55·d) |
| 3 | MOTION depth | 3 ms wow only | 5.1 ms wow+flutter | over-wobbly | mapping: wowDepth = 0.5·m, flutterDepth = 0 |
| 4 | BLUR density | 1 AP, g≤0.7 | 4 AP, g≤0.78 | denser (good) but tunnel-y at b=1 | mapping: amount = 0.55·b, size = 0.10 + 0.40·b |
| 5 | WIDTH stereo offset | R-tap = L − (width/2)·18 ms | R==L | narrow at width=1 | mapping: timeR = max(5 ms, timeL − (width/2)·18 ms) |
| 5b | WIDTH<1 mono-collapse | (L+R)/2 blended | not implemented | minor break | **DEFERRED** — needs `MonoBlendModule` in core |

All five product-layer fixes applied to `src/core/products/echoform.js`. No core DSP touched.

**Remaining known divergence:** WIDTH < 1 doesn't collapse to mono. Acceptable for v1; tracked for a future generic `MonoBlendModule` (2-line addition, useful for many products).

## B. Tape Delay port

### Strategy
Tape Delay needs **3 read taps from one shared tape loop** + per-head pan/vol/on, plus tape character. Three separate `DelayModule` instances would be wrong — heads must share a single buffer (they're physical heads on one tape).

### Core extension
Added one new generic primitive:

- `TapeMultiTapModule` (palette index 3) — single L/R `DelayLine` per channel, three independently-positioned read taps with on/vol/pan, shared wow/flutter (one transport), feedback path = sum-of-enabled-heads → HP → LP → softSat. Reusable for any multitap delay.

Generic — not Tape-specific. Same module would back a "multi-tap rhythmic delay" product.

### Product layer
`src/core/products/tapeDelay.js` — chains `[TapeMultiTap → Tone]` with `engineMix` for final dry/wet. Maps the legacy 17-knob interface 1:1.

### Mapping table
| TapeDelay UI | Maps to |
|---|---|
| TIME 1/2/3 | TapeMultiTap.time1/2/3 (sec) |
| FEEDBACK | TapeMultiTap.feedback × 0.96 |
| WOW | wowDepth=0.7w, wowRate=0.4+1.2w; fltDepth=0.25w, fltRate=6+6w |
| HEAD on/vol ×3 | TapeMultiTap.on1..3 / vol1..3 |
| TREBLE | Tone.lpHz = 1800 + 14200·t |
| BASS | Tone.hpHz = 20 + 380·b ; TapeMultiTap.lowCut mirrored |
| DRIVE | TapeMultiTap.drive |
| SPREAD | TapeMultiTap.spread (head pan amount) |
| MIX | engineMix |

### Intentional omissions vs legacy (deferred to "TapeCharacter" pass)
- Tape **hiss noise** generator (pink-filtered)
- 60 Hz **hum** + 180 Hz buzz
- Output **transformer** shelf
- Dry-path **warmth** filter

These are *voice colorations*, not pitch/time identity. They will land as a small dedicated `TapeCharacterModule` (noise + hum + transformer shelf) once approved. Until then, the new TapeDelay sounds cleaner than legacy — the time-domain behaviour (heads, wow, repeat tone) is faithful.

### Files
- `src/core/dspWorklet.js` — added `TapeMultiTapModule`, registered as palette index 3
- `src/core/fxEngine.js` — added `MODULE.TAPE_MULTITAP` + `TAPE_MULTITAP_PARAMS`
- `src/core/products/tapeDelay.js` — NEW product layer

### Risks to test on real audio
- 3 active heads at FEEDBACK ≥ 0.85 → confirm shared-buffer feedback path doesn't run away (cap at 0.96 + softSat tape limit should hold).
- Heavy WOW at TIME=20 ms → Lagrange-3 read should remain click-free.
- SPREAD=1 with all heads on → confirm ping-pong-like pattern emerges from pan distribution (head1=L, head2=C, head3=R).
- DRIVE=1 + heavy FEEDBACK → softSat ceiling verified by inspection (|y|<1).
