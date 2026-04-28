# Recipe Library Expansion Strategy — Parked Idea (2026-04-28)

**Status.** PARKED. Returned focus to QC ops verification rack. Promote to active work when:
1. Recipe library catches a user-prompt miss in the wild ("agent doesn't know how to build X"), OR
2. User explicitly returns to recipe authoring, OR
3. A new Tier-S source document gets dropped (Helios manual, Neve 80-series, SSL 4000, etc.)

## Current state (baseline)

- **32 archetype recipes** in `recipe_library.md`
- **~50 distinct ops** referenced in recipe vocabulary
- Coverage: tube guitar amps, hi-fi tube amps, plate/spring/digital reverb, tape echo/compression, 5 compressor topologies (VCA/opto/FET/vari-mu/diode-bridge), passive/active EQs, mic preamps, modulation, special (vocoder/drum machines/synths), British 1968–72 germanium-era consoles (TG12345 + B104A/Helios)

## Three expansion paths, ordered by leverage

### Path 1 — Console-handbook ingestion (highest leverage)

Match the TG12345 workflow on other consoles. Each top-tier console drop = 1–3 recipes + 5–10 new ops with full schematic backing.

**Targets ranked by leverage / availability:**

| Console | Era / records | Why high-leverage | Source-availability hint |
|---|---|---|---|
| **Helios** | Olympic / Island / Led Zep III-IV / Sabbath | Robinson designed it — we already have his individual modules in the Germanium folder. **Closest cheap win** — likely 1 day | Mike Robinson / Chandler may have docs |
| **Neve 80-series (8014/8024/8048)** | Air / Townhouse / Genesis / Phil Collins drum sound | Massive 70s/80s corpus | AMS Neve archives, Geoff Tanner |
| **Trident A-Range / 80B** | Bowie / Queen / Genesis | Defining British 70s/80s, no current coverage | Trident archives |
| **SSL 4000 E/G channel strip** | Every 80s record | We have SSL_BUS_COMP via #142, missing the strip | SSL service docs |
| **API 1604 / 2488** | Capricorn / Record Plant LA / 70s American | American counterweight to Neve | API service archives |
| **Fairchild 670** | Beatles Abbey-Road era / mastering classics | varMuTube (#145) is generic — Fairchild-specific deserves its own recipe | Manuals on archive.org |
| **Quad Eight / MCI / Universal Audio 610** | American 70s console era | Currently zero American-console coverage | Mfr archives, GroupDIY |

**Workflow** (proven by TG12345 / Germanium-folder drops):
1. User drops PDF/folder locally
2. Read PDF, route through INTAKE DECISION block per `memory_intake_protocol.md`
3. Create `memory/<console>_canon.md`
4. Append op rows to `sandbox_ops_catalog.md` (additive only)
5. Append recipe to `recipe_library.md`
6. Cross-reference back to canon via § number anchors

### Path 2 — Genre/artist-prompt fingerprints (interview-mining)

Today's recipes are organized by gear. User prompts are often *"sound like Innervisions"* / *"Bonham kick"* — that needs **record→chain** recipes built from engineer interviews.

**Examples to add:**
- Motown / Detroit late-60s — Studio A signal chain
- Stax / Memphis — Universal Audio 610 + Spectra Sonics
- Muscle Shoals — MCI JH-528 + 1176 + EMT
- Westlake / Quincy Jones LA-70s — Trident A + LA-2A + Hidley
- Eddie Kramer / Hendrix at Olympic — Helios + Pye + tape varispeed
- Geoff Emerick / Beatles Revolver-Sgt Pepper — REDD.51 console (TG12345 predecessor) + ADT

**Sources:**
- Mix Magazine "Classic Tracks" archive (PDF-able)
- Sound on Sound classic-track interview archive
- Tape Op interviews
- Howard Massey, *Behind the Glass* books I + II + III
- Mix-with-the-Masters transcripts

**Caveat:** interview claims aren't always factually correct. Cross-validate against any available service docs / period photos before locking.

### Path 3 — Element-specific recipes (highest agent-utility)

Today's recipes are full-chain (mic → console → tape). But prompts are often **element-scoped**: "Bonham kick," "Levee Breaks snare," "Trevor Horn vocal stack." A second taxonomy of element recipes nests beneath the existing chain recipes.

**Schema (proposed):**

```
Element: snare
Reference: "When the Levee Breaks" — Led Zeppelin, 1971
Mic: Beyer M160 ribbon, stairwell of Headley Grange
Pre-amp: Helios long-cable
Console chain: Helios channel strip → Helios buss
Tape: Studer J37 1" 8-track @ 7.5 ips
Effect chain: tape compression on buss
Op composition: xformerSat → neveB104A → ...
Defining elements: stairwell 3-stage reverb cascade, M160 HF rolloff,
                   J37 7.5 ips compression
```

**Initial set to author** (~20–30 element recipes):
- Drums: Bonham kick, Bonham snare, Phil Collins gated snare, Bonzo overhead, Roots snare, 808 kick, 909 snare, hi-hat (LinnDrum vs sampled), tom (Toto IV), brushes (jazz)
- Vocals: Lennon ADT, Sinatra Capitol, Trevor Horn stack, Auto-Tune Cher, lo-fi shoegaze, Marvin Gaye Motown, Quincy Jones-LA, dub vocal (echo+spring)
- Bass: Bootsy P-bass, Macca Hofner, Jaco fretless DI, P-funk synth (Moog Taurus), 808 bass, Detroit techno (TB-303)
- Guitar: clean Strat (Hendrix), driven Les Paul (Page), Edge delay, surf rock spring, fuzz (Big Muff), pedal-steel
- Synth: 808 cowbell, CS-80 vibrato, Prophet 5 brass, Jupiter 8 strings, EMS Synthi (Floyd), DX7 Rhodes

**This is highest agent-utility gain** — when a user says "I want a Bonham snare," the agent maps directly to the element recipe rather than picking apart a full chain.

**Authoring path:** manual curation, not document-drop. Better as a parallel track once we have ~50+ chain recipes.

## Recommendation when work resumes

**Start with Path 1, target Helios.** Reasoning:
- Robinson designed it; his individual modules already in canon
- 1 new console doc → 1 new recipe (#33) + ~3 new ops (mid-stage helios topology + buss-amp + filter)
- Closest source — Chandler Limited likely has Robinson archives accessible

After Helios, pick the next from Path 1 by primary-source availability rather than nominal leverage. The constraint is always "do we have the schematic" — not "do we want this recipe."

When ~50 chain recipes exist, **start Path 3** (element recipes) as parallel curation track.

Path 2 (interview-mining) is lowest priority — interview claims need cross-validation work that exceeds the value-per-hour of Path 1 console drops while we still have low-hanging Path 1 targets.
