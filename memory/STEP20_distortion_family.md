# STEP 20 — Distortion family architecture + SaturatorModule

Opens the distortion-family phase. One new palette module
(`SaturatorModule`, index 14), two small helpers (`_logCosh` free
function for stable `log cosh`, the inline DC-HP inside the module).
Nothing else added to the core.

## Signal flow

```
in ─► pre-gain(drive) ─► f_curve (ADAA-1) ─► DC-HP (20 Hz) ─► post-gain(outputDb) ─► mix(dry, wet) ─► out
```

One per-sample nonlinear stage flanked by gain staging, DC removal, and
parallel blend. Tone shaping is **outside** the module — products compose
with `TiltEq`, `TapeCharacter`, etc. in the chain.

## Module breakdown

One palette entry. Curves + ADAA + DC-HP all live inside
SaturatorModule because they share per-sample state and can't cross
module boundaries without audio-rate routing:

| Piece | Location | Scope |
|---|---|---|
| `SaturatorModule` | palette 14 | full saturation stage |
| Curve selector (`curve` 0/1/2) | inside | soft / hard / tube |
| ADAA-1 engine | inside | per-channel `xPrev` + `FPrev`; ε=1e-6 denominator fallback |
| DC-HP | inside | one-pole, 20 Hz, per channel |
| `_logCosh` | free function | stable log-cosh via `log1p(exp(−2|x|))` |

No sibling "clipper" or "tube" modules — one generic saturator with
curve selection covers every planned distortion product.

## Curves

All three have closed-form antiderivatives → exact ADAA-1, no numerical
integration.

| Mode | f(x) | F(x) (antiderivative) | Notes |
|---|---|---|---|
| 0 Soft | `tanh(x)`                   | `log cosh(x)` | smooth warmth |
| 1 Hard | `clip(x, −1, 1)`            | `x²/2` for \|x\|<1, `\|x\|−1/2` else (C1 at ±1) | transistor / fuzz |
| 2 Tube | `tanh(k⁺·x)` for x≥0, `tanh(k⁻·x)` for x<0 | `log cosh(k·x) / k²` each side (both 0 at 0 → continuous) | asymmetric, even-order harmonics |

Tube asymmetry: `k⁺ = 1 + asym`, `k⁻ = max(0.25, 1 − 0.5·asym)`.
Positive half saturates sooner → second-harmonic-rich.

## Anti-aliasing strategy

**ADAA-1** (antiderivative anti-aliasing, first order — Parker /
Zavalishin / Bilbao). Per sample:

```
if |x − xPrev| > 1e-6:
    y = (F(x) − F(xPrev)) / (x − xPrev)
else:
    y = f(0.5·(x + xPrev))           # numerical fallback (derivative form)
xPrev = x ;  FPrev = F(x)
```

Per channel state: one `xPrev`, one `FPrev`. Adds ~0.5 sample effective
group delay; no buffers, no upsampling FIR.

**Why ADAA-1 over 2× oversampling**:
- CPU ~1.2× the raw nonlinearity; cheaper than a halfband FIR.
- Exact closed-form integrals for all three curves.
- No polyphase-filter latency, no aggregation plumbing.
- Alias floor suppressed ~20–30 dB in the audible band — adequate for
  musical saturation. Extreme wideband drive is the one regime where
  ADAA-1 starts to lose effectiveness; for that case the `aa` toggle
  exposes the raw nonlinearity (for e.g. intentionally-harsh bit-crush
  aesthetics) and a future 2× oversampled mode can slot inside
  SaturatorModule with no interface change.

Stable `log cosh` uses `|x| + log1p(exp(−2|x|)) − log(2)` so large
drive values don't overflow `cosh`.

DC-HP at 20 Hz is the standard one-pole differencing form
`y = a·(yPrev + x − xPrev)` with `a = exp(−2π·20/sr)`. Not user-facing;
removing DC is correctness, not voicing.

## Parameter mapping

| Param | Range | Default | Notes |
|---|---|---|---|
| `drive`     | 0..48 dB    | 12   | pre-gain |
| `curve`     | 0 / 1 / 2   | 0    | soft / hard / tube; rounded per sample |
| `asym`      | 0..1        | 0.35 | active only in tube mode |
| `outputDb`  | −24..+12 dB | 0    | post-gain |
| `aa`        | 0 / 1       | 1    | ADAA-1 toggle |
| `mix`       | 0..1        | 1.0  | parallel blend |

Smoother windows: 25/5 ms for signal-domain params (drive, outputDb,
mix) and 50/25 ms for selectors (curve, aa) and asym.

## Product / core split

### Core (SaturatorModule)
- Pre-gain, curve, ADAA, DC-HP, post-gain, mix. Nothing else.
- Stateless except for `xPrev / FPrev` (ADAA) and HP state.

### Product layer (every distortion voicing)
Products compose SaturatorModule with the existing palette:

- **Tape warmth**: `TapeCharacter → Saturator(curve=2, drive low, asym 0.5) → TiltEq`.
- **Fuzz**: `Saturator(curve=1, drive high, mix=1) → TiltEq (HF cut)`.
- **Console drive**: `Saturator(curve=0, drive med) → TapeCharacter(xfmrDrive)`.
- **Overdrive pedal**: `TiltEq (mid-push) → Saturator(curve=0 or 2) → TiltEq (cab sim HF cut)`.

Macro fan-outs (DRIVE / TONE / MIX), HF-roll-off voicings, cabinet
simulation (via filter chaining), asymmetry dialing — all product-side.
Exactly the same composition pattern the reverb and dynamics families
use.

## Files

| File | Change |
|---|---|
| `src/core/dspWorklet.js` | + `SaturatorModule`; `_logCosh` helper; palette index 14 |
| `src/core/fxEngine.js`   | + `MODULE.SATURATOR`; `SATURATOR_PARAMS` |

## Rules honoured

- **Reuses existing chain system** — SaturatorModule is a plain palette
  entry, inserted into any serial chain like any other module.
- **Distortion core kept generic** — only drive, curve, asym, out, aa, mix.
  No tonal pre/post EQ inside.
- **Product voicing in product layer** — every planned distortion
  product ships as `[TiltEq? / TapeCharacter? → Saturator → TiltEq?]`
  chain + macro fan-out.

## Stability notes

- All three curves are bounded: soft & tube ∈ [−1, +1] by tanh; hard is
  clipped to [−1, +1] by construction. Combined with bounded post-gain
  (≤ +12 dB), output stays within ±4 — well inside float32 range.
- ADAA-1 denominator has a 1e-6 ε-fallback → no division-by-zero.
- DC-HP is a one-pole with `a < 1` → stable unconditionally.
- `aa` rounded by threshold (> 0.5) so smoother interpolation mid-change
  doesn't produce an ill-defined intermediate mode.
- `curve` rounded to {0,1,2} every sample — no illegal indices, and the
  smoother's interpolation during a curve switch briefly straddles
  modes for a handful of samples (audible as a short crossfade, not a
  glitch).

## Risks to test on real audio

- `curve = 1` (hard) + `drive = 48 dB` → verify no audible aliasing on
  clean sinewaves around 1 kHz. ADAA-1 is known to degrade at extreme
  slopes — consider a documented recommended-drive ceiling.
- Switching `aa` live under heavy drive → the ADAA path and raw path
  produce slightly different waveforms; expect a soft timbral shift,
  not a click.
- `asym = 1` in tube mode on bass-heavy material → DC-HP should remove
  the asymmetry-induced DC; verify no LF pump.
- `mix < 1` with `aa = 1` → dry and wet are sample-aligned (no latency
  in aa path); parallel blend should phase-coherently add.

## Architectural state after Step 20

Palette now at 15 modules (0..14): core delays + diffuser + tone +
tape-multitap + tape-character + comb-bank + tilt-eq + FDN + second
diffuser + width + early-reflections + envelope-follower + compressor +
limiter + **saturator**. Three families online: delay/reverb, dynamics,
distortion.

Every new family has added a single generic primitive ( + helpers) and
deferred every voicing to products. Next family: probably modulation
(chorus / flanger / phaser) or EQ (multiband / parametric), depending
on product-roadmap priority.
