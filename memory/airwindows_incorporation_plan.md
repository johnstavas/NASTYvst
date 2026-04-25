# Airwindows Incorporation Plan — Mine, Don't Rip

**Status:** Binding policy. Created 2026-04-24 after #112a tapeAirwindows
landed and user clarified incorporation intent: *"we want it to be a mine
to extract so we aren't directly ripping him off."*

**Source:** github.com/airwindows/airwindows (MIT, Chris Johnson).
~300+ plugins under `plugins/WinVST/` + `plugins/MacVST/` (identical DSP,
differ only in VST plumbing).

## Governing principle — extract, don't transcribe

**The danger is treating Airwindows as a catalog to replicate.** It is a
mine of recurring DSP micro-techniques that Chris has spent decades
hand-dialing. Value is in the *tricks*, not the per-plugin shells.

Three-tier incorporation policy:

| Tier | Action | Attribution |
|---|---|---|
| **Canon** | Extract recurring micro-stage as paste-and-adapt Canon entry. Compose freely in new ops. | "Adapted from Airwindows `<Plugin>`, Chris Johnson, MIT." in Canon entry header. |
| **Shortlist port** | Port whole plugin to a dedicated op slot when the plugin's *identity* is the chain itself (ToTape9, ToVinyl4). | Verbatim primary citation in op `.worklet.js` header. Constants preserved byte-for-byte. |
| **Inspiration ledger** | One-line index of every remaining plugin's distinctive trick. Not shipped. | Reference only. |

**#112a tapeAirwindows is the only shortlist port we commit to in
advance.** Future shortlist additions require a separate decision each
time — no blanket authorization.

## Why "mine" not "port"

1. **Sound-integrity.** Airwindows plugins are chains whose output is the
   interaction of stages. Porting `PurestDrive` standalone loses the
   context it was designed for.
2. **Slot-budget.** Sandbox has ~130 op slots. 300 whole-plugin ports is
   out of budget and crowds out real gap-fillers (FDN variants,
   pitch/time, granular, physical modeling breadth).
3. **Authorship-integrity.** Whole-plugin porting is effectively reselling
   Chris's work. Extracting recurring primitives + giving them new
   compositional context is derivative work in the software sense — still
   MIT-attributed, but substantively different.
4. **Composability.** Canon entries slot into any op author's graph.
   Whole ports are one-shot sounds.

## Canon extraction queue — ~25 entries

Target output: ~25 paste-and-adapt Canon entries across existing Canon
files. Each entry: 8-field schema (PROBLEM·DSP·CODE·SOUND·USE·LIMITS·
UPGRADES·LICENSE), attribution "Adapted from Airwindows `<Plugin>`".

### Canon:character (new entries §15–§22)

| § | Name | Source plugin(s) | Essence |
|---|---|---|---|
| 15 | Taylor-sin saturator | ToTape9, Density | Clamp ±2.305929…, coefs `/6, /69, /2530.08, /224985.6, /9979200` — "degenerate Taylor sin()". Musical odd-harmonic saturator with hardcoded ceiling. |
| 16 | Tan-K golden-ratio BPF + cubic pre-clip | ToTape9, Air3, Desk | `K=tan(π·fc)`, reso=0.618033988…=1/φ, dual-biquad A+B staggered, pre-biquad `x−=x³·0.0618/√ovs`. Analog-voiced resonance. |
| 17 | Dubly encode/decode | ToTape9, ToVinyl4, IronOxide | IIR HF-split + μ-law-ish compressor on high part, additive mix-back. Encode coefs (2.848/1.152) and decode coefs (2.628/1.372) are Chris's specific detuning. |
| 18 | Golden-ratio threshold slew chain | ToTape9, Slew2, IronOxide | 9 thresholds spaced by φ, each with per-threshold slew limit + "stuck" under-bias hysteresis. Cascading analog-magnetization feel. |
| 19 | Chebyshev summation | Console7, Console6, Desk | Per-channel preprocess + per-bus postprocess using Chebyshev-series approximation of tape-console summing nonlinearity. Replaces generic #73 busSum. |
| 20 | PurestConsole HF shimmer | PurestConsole, Air | 3-tap interleaved HF energy redistribution. Subtle but recognizably "Airwindows air." |
| 21 | PopBack transient recovery | PopBack, Surge | Negative-going envelope tracker that re-inflates transients squashed by prior stages. Companion to dynamics upstream. |
| 22 | Acceleration soft-sat | Acceleration | 2nd-derivative-of-signal soft-saturator. Tames HF without a filter. |

### Canon:utilities (append §5–§6)

| § | Name | Source | Essence |
|---|---|---|---|
| 5 | Airwindows `fpd` denormal floor | ubiquitous | 32-bit xorshift `fpdL ^= fpdL<<13; >>17; <<5` seeded 17; injected as `fpdL · 1.18e-17` when `|x|<1.18e-23`. **SHIP-CRITICAL tier** alongside Jon Watte denormal macro. |
| 6 | Cascading averaging filter (2/4/8/16/32-tap) | ToTape9, IronOxide, Slew2 | Geometric cascade of boxcar averages; cheap multi-pole LP w/ characteristic group-delay. `slewsing` gate activates stages based on SR. |

### Canon:dynamics (append §6–§7)

| § | Name | Source | Essence |
|---|---|---|---|
| 6 | ClipOnly3 post-limiter | ClipOnly3 | Sample-by-sample hard clip with lookback adjustment for overshoot. Intended as *final* stage post-DAC-like saturation. Not a replacement for true-peak limiting. |
| 7 | Slew-limit distortion | Slew2, SlewOnly | `dy/dt` clamp as an effect rather than a bug. Character enhancement for aggressive material. |

### Canon:filters (append §13)

| § | Name | Source | Essence |
|---|---|---|---|
| 13 | Air 3-tap HF network | Air3, Air2 | Minimal-state HF shelving alternative using 3 interleaved sample taps. Not RBJ — Chris's own form. |

### Canon:time_interp (append §8)

| § | Name | Source | Essence |
|---|---|---|---|
| 8 | LCG-jittered sin-sweep flutter | ToTape9, IronOxide | 1000-sample circular buffer + fractional read offset from `flutDepth + flutDepth·sin(sweep)`; sweep turnover injects xorshift-derived `nextmax` picked as whichever of two LCG draws is closer to `sin(sweep+prev)`. Chris's specific "wow+flutter" recipe. |

### Canon:synthesis (append §14)

| § | Name | Source | Essence |
|---|---|---|---|
| 14 | Subharmonic octave-down oscillator | Fathom5 | Zero-cross-triggered half-rate flip-flop summed back into fundamental. Sub-bass without pitch-tracking latency. |

### Canon:modulation (append §4)

| § | Name | Source | Essence |
|---|---|---|---|
| 4 | Groove-wear RIAA + needle-drag | ToVinyl4 | Pre-emphasis RIAA curve + signal-dependent HF loss simulating worn groove. Vinyl character primitive. |

### Canon:loudness (no additions)

Airwindows `Monitoring` plugins pre-date BS.1770; not useful to Canon.

## Shortlist — ports, locked list (beyond #112a)

**None.** Every additional whole-plugin port requires a separate
decision. This locks future-us to *consider* the Canon-first path each
time.

Candidates flagged for future consideration (NOT pre-authorized):

- ToVinyl4 — whole vinyl chain, if Canon:modulation §4 + other
  primitives don't compose cleanly
- Galactic / Verbity — after stereo-op graph-node type lands
- Console7 bus chain — if Canon:character §19 Chebyshev summation alone
  proves insufficient
- Fathom5 — if Canon:synthesis §14 needs further-integrated version

## Inspiration ledger

Separate file to be created: `memory/airwindows_inspiration_ledger.md`
— one-line-per-plugin index of distinctive trick for each Airwindows
plugin not covered above. Grep-target for future gap-filling. Build
opportunistically; not a sweep.

## Execution order

1. **Session N (next):** Write Canon:character §15 (Taylor-sin) + §16
   (tan-K BPF) + Canon:utilities §5 (`fpd` floor). These three close the
   loop on techniques already *used* in #112a — no new plugin study
   needed. Retrofit #112a to cite Canon entries instead of inlining.
2. **Session N+1:** Canon:character §17 Dubly + §18 golden-ratio slew +
   Canon:utilities §6 averaging cascade. Same story — already ported in
   #112a, just externalize.
3. **Session N+2 onward:** New material. One or two Canon entries per
   session, each requiring primary-source read of the originating
   Airwindows plugin per `sandbox_op_ship_protocol.md`.
4. **Inspiration ledger:** build opportunistically alongside Canon work
   — when reading a plugin for Canon extraction, note sibling plugins'
   distinctive tricks in one-line rows.

## Rules of engagement

1. **Verbatim constants or nothing.** Chris's empirical tunings
   (`/2530.08`, `0.618033988…`, `2.848`, `1.152`, etc.) are load-bearing.
   Preserve byte-for-byte. If you must rename a symbol, don't change
   its value.
2. **Attribution in every derived file.** Canon entry header: "Adapted
   from Airwindows `<Plugin>` (Chris Johnson, MIT)." Op header: full
   file path + line range of primary.
3. **Primary-source rule still applies.** Each Canon entry requires
   actually reading the source plugin (via curl to
   `node_modules/.<plugin>_primary.cpp`, cleanup after). No summarizing
   from memory or blog posts.
4. **No "Airwindows-inspired" as a license.** Even Canon-extracted
   techniques credit the source plugin. Better to over-attribute than
   under.
5. **Never claim authorship of Chris's empirical math.** The Canon
   entry's "PROBLEM" and "USE" fields are ours. The "DSP" and "CODE"
   fields are Chris's work re-expressed.
6. **Stop-condition.** If at any point Canon extraction feels like
   we're just copying Airwindows' structure into differently-named
   files, stop and ask whether we're still mining or now ripping.

## Non-goals

- Building a sandbox "Airwindows emulation layer." No.
- Matching Airwindows UI idioms. No — we're extracting DSP primitives
  only, never the plugin-shell chrome.
- Chasing plugin parity with Chris. He ships ~1 plugin/week. We're not
  racing him — we're using his published research as upstream literature.

## Success criterion

A year from now, a user plays a sandbox graph composed of Canon-extracted
primitives, and an Airwindows fan says "this sounds like it's in the
same *family* as Chris's work, but I can't point to which plugin."
That's the right outcome. Direct "this is PurestDrive with a
different name" is failure.
