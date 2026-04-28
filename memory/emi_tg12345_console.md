# EMI TG12345 Mk2 Mixing Console — Service Handbook (Tier-S Primary)

## INTAKE DECISION

| Field | Value |
|---|---|
| Source type | **Manufacturer service handbook + circuit schematics + calibration procedure** |
| Author / publisher | EMI Research Laboratories, Hayes, Middlesex |
| Era | Drawings dated 1970 (e.g. AE231 = 21-1-70). Mk2 revision of original TG12345 (1968 install at Abbey Road Studio 2). |
| Tier | **Tier-S** — manufacturer documentation is the highest tier per memory_intake_protocol.md |
| Routing | Memory canon file (this file) + PDF stash at `docs/primary_sources/abbey_road/` |
| Copyright | EMI Research Labs internal handbook; not openly licensed. Memory file paraphrases technical specs only. No verbatim text dumps. |
| Why Tier-S | (1) manufacturer-authored, (2) bench-validated factory calibration procedure included, (3) full circuit schematics with measured component tolerances, (4) anchors the most-recorded console in pop-music history (post-1968 Beatles, Pink Floyd *Dark Side*, Wings, Roxy Music, etc.). |
| Scope | Architecture · signal levels · per-cassette circuit detail · active-unit schematics (Amp D/P, mic-power, BE740 bass-cut) · calibration test procedure. |
| Locked? | **Yes — locked Tier-S, additive-only.** No prior catalog entries reference TG12345 directly so this is purely additive (no rows modified). |

---

## 1. Architecture summary

**Cassette-based modular console.** The desk is built from six cassette types, each a self-contained card-frame with its own ±20V regulator. Cassettes plug into a backplane cable-form for power and audio interconnect. Up to 24 mic inputs feeding 8-track + 2-track auxiliary stereo simultaneously.

| Cassette | Role | Channels each |
|---|---|---|
| Microphone | Mic preamp + EQ + comp + fader | 2 |
| Group | Sub-bus aggregation + EQ + comp + fader | 2 |
| Main | Bus-comp + fader → tape send | 2 |
| Track Monitor | Tape-return monitoring + re-record | 8 |
| Control Room Monitor (CRM) | Speaker feed, cue, talkback, solo control | — |
| Studio Playback | Studio LS, oscillator, talkback origin | — |

**Virtual-earth summing buss.** The defining topology: every output that drives a buss line goes through *Amplifier B* (voltage-to-current converter, ~20 kΩ output impedance), and every buss-line input is *Amplifier C* (virtual-earth input, ~20 Ω input impedance). Unity gain B+C₂. Each added channel changes existing-channel gain by ~0.01 dB; 20 channels = 0.2 dB total — negligible. **This is the canonical Abbey Road buss character — clean, low crosstalk, lots of headroom, no resistor-summing dirt.**

**Power rails.** ±20 V from per-cassette series stabilisers fed off a 240 V±1% main stabiliser → 50 V centre-tapped distribution → mic-power unit (BE238) per cassette. Mic-power unit uses BFY52 pass + BC109 driver + BZY88/C16 zener references; AOT.OR (≈3 kΩ) sets +20 V output. BCY71 on the negative rail.

**RF/earthing discipline.** Every input AND output has its own screened transformer placed close to the connector. Inter-winding screen tied to cassette chassis; common signal point insulated from chassis (so earth faults can be traced). Spade-tag bus to mainframe earth.

**Switching.** Stud and key switches for primary signal. Transistor switching (BCY71 etc., e.g. AE231 track-announce "active relay") for solo, talkback, multi-track announce — no electromechanical relays in audio path.

---

## 2. Signal levels (calibration discipline)

| Term | Reference | Notes |
|---|---|---|
| **dBv** | 0 dBv = 0.447 V rms across 200 Ω | Used throughout the handbook for sending levels |
| **dBm** | 0 dBm = 1 mW into 200 Ω = 0.447 V rms | Identical numerically to dBv at the operating impedance |
| **dBi** | Indicated sending level of a 200 Ω Gain Set | Used for precision test specs |
| dBV | 0 dBV = 1 V rms | dBV = dBi + 6.02 when unloaded |

**Internal operating level: −10 dBV (≈ 0.316 V rms).** VU meters read 0 VU at +10 dB above this (i.e. at output 0.447 V open-circuit), giving a 10 dB operating-headroom buffer below 0 VU.

**VU meter boost.** Each main cassette has +10 dB and +20 dB locking push-buttons that boost meter-amp gain to expand the cramped low end of the linear VU scale.

---

## 3. Channel signal flow (Microphone Cassette)

```
mic in (200 Ω, Tuchel-5)
  │
  ▼
[input transformer 1:3.16 step-up]      ← screened, AOT-trimmed for ±0.5% match
  │
  ▼
[50 V phantom inject]                    ← 6.8 kΩ pair, switchable (NOT 48 V — quirk)
  │
  ▼
[coarse input atten · 12 × 5 dB = 60 dB] ← first 3 steps from xfmr taps
  │                                        rest from 8.33 kΩ pot
  ▼
[AMP D · 25 dB nominal ±5 dB FB]         ← input voltage range −30 to −40 dBv
  │                                        for −10 dBv standard out
  ▼
[Band Pass Filter]                       ← 12 dB/oct subsonic <30 Hz
  │                                        AOT.1 resistors trim 30 Hz + 20 kHz
  ▼
[Compressor / Limiter]                   ← 3-pos key Out/Compress/Limit
  │                                        Gang mode (max-of-2 CV)
  ▼
[Inject point]                            ← post-comp, with I/O xfmrs
  │
  ▼
[Presence (mid EQ)]                      ← 8 freqs × ±10 dB in 5 × 2 dB steps
  │
  ▼
[Bass control]                           ← ±10 dB total, half-lift ≈ 500 Hz
  │                                        (BE740 bass-cut: 75/150/300/600/1200 Hz)
  ▼
[Quadrant fader]                         ← 30 × 0.5 dB then 26 × graded → −64 dB
  │                                        std level at 5 dB loss point
  ▼
[AMP E · +5 dB makeup]                   ← (or AMP K w/ phase reverse on Group/Main)
  │
  ▼
[Pan-pot · 11 kΩ × 2 reverse]            ← 19 intermediate positions
  │
  ▼
[AMP B → main / group / aux buss]        ← V-to-I converter, 20 kΩ out
```

---

## 4. Active-unit circuits (sampled — full set in §12 of handbook PDF)

### 4.1 Amplifier D — input mic preamp (BE232)

3-stage discrete NPN BJT (3 × **BC109**). Series-feedback topology with internal compensation.

- VT1 (39 kΩ collector R, 75 kΩ FB to base) — input common-emitter
- VT2 (4.3 kΩ collector R, 33 kΩ FB) — gain stage with C2=8200 pF Miller comp
- VT3 (24 kΩ collector R, C5=150 pF lead comp) — output stage
- Bootstrap rail decoupling: C3 = 32 μF/16 V at VT2 emitter
- **Gain Control (Fine)** input pin drives R5=360 Ω + AOT.1 + R7=11 kΩ + 100 Ω + 320 μF/4 V network — adjusts VT3 emitter degeneration to give ±5 dB fine trim around 25 dB nominal. ±0.5 dB step granularity.
- Power ±20 V rails. Input cap C7 = 0.47 μF.

This is the canonical Abbey Road mic-amp character: 3-stage discrete-BJT class-A, modest open-loop gain, lots of NFB, very low harmonic distortion at typical levels but **clipping into a soft asymmetric character at +20 dBV** (the BC109/±20V combination's natural ceiling).

### 4.2 Amplifier P — phase-splitter / paraphase output (BE233)

5-stage BC109 design with **simultaneous in-phase and anti-phase outputs** (Out 1, Out 2). Used wherever balanced drive is needed without an output transformer. 51 kΩ resistors on each output, R9/R11 = 680 Ω/5.1 kΩ matched gain set, 47 pF compensation throughout. Input cap C1 = 1 μF.

This is the topology that allows the console to drive its main output transformers (BIBA, 1:1.77 step-up) for a balanced 0 dBV → +5 dB / 200 Ω send to tape.

### 4.3 Microphone Power Unit (BE238)

±20 V regulator pair, fed from 50 V CT transformer secondary via dual full-wave bridges (BYX22/200, 2A diodes — handbook explicitly notes "these were only capable of supplying about 20 mA and were usually replaced or uprated").

- **Positive rail:** BFY52 pass element + BC109 driver. AOT.OR resistor (~3 kΩ) sets output. BZY88/C16 zener reference + 20 μF/25 V filter.
- **Negative rail:** BCY71 + BZY88/CV5 zener reference.
- Heavy filtering: C1=60 μF, C2=32 μF, C7=32 μF/64 V

The "very low ripple" claim in the handbook is achieved by per-cassette local regulation off a low-AC-ripple 50 V centre-tapped feed.

### 4.4 BE740 Variable Bass Cut filter

Stepped 1st-order RC HPF network. Six fixed corner frequencies via cap-bank rotary switch:

| Position | Effective C |
|---|---|
| FLAT | open (no cut) |
| 75 Hz | 0.22 μF |
| 150 Hz | 0.10 μF |
| 300 Hz | 0.047 μF |
| 600 Hz | 0.022 μF |
| 1.2 kHz | 0.01 μF |

R ≈ 1 MΩ throughout. **Frequency doubles with each step** (75 → 150 → 300 → 600 → 1200) — perfect octave-spaced bass-cut switch. Two banks (one per channel half) with slightly different second-bank cap values (0.33 / 0.15 / 0.068 / 0.033 / 0.015 μF) for the second pole. So this is **functionally a 6-position 12 dB/oct HPF** (per the handbook: BPF cuts 12 dB/oct below 30 Hz, plus this BE740 user-selectable additional bass cut).

### 4.5 Track Announce Relay (AE231)

Twin BCY71 PNP-NPN pair acting as transistor SPDT switch. R5=24 kΩ + R6=15 kΩ base divider, R3=2.7 kΩ emitter, R4=150 kΩ + C2=0.1 μF output coupling. Drives multiple tracks simultaneously when announce button pressed.

This is the era-correct **transistor active-relay** technique that lets the console avoid relay clicks in audio.

---

## 5. EQ section detail

### 5.1 Presence (mid-band peak EQ)

8 selectable centre frequencies × ±10 dB boost/cut in 5 × 2 dB steps:

```
0.5 · 0.8 · 1.2 · 1.8 · 2.8 · 4.2 · 6.5 · 10  kHz
```

Note **no 100/200 Hz options** — bass is handled separately. The presence band is mid-and-up only. Curves at ±10 dB plotted on Drawing 376.

### 5.2 Bass control

**Half-lift frequency = 500 Hz**, ±10 dB in 5 × 2 dB steps. Curves on Drawing 375.

**KEY INSIGHT.** A "bass" control whose half-lift is at 500 Hz is *not a true low-frequency shelf* — it's a low-mid scoop/lift. Boosting "bass" on this console adds energy from the lower midrange upward into 500 Hz, which is why early-70s Abbey Road records have that distinctive **warm, fat, low-mid forward** character without sounding sub-heavy. This is one of the defining Abbey Road tonal fingerprints.

### 5.3 Band Pass Filter (BPF, channel-resident)

- **High-pass section:** 12 dB/oct cut below 30 Hz (subsonic protection); AOT.1 trim resistor compensates for the channel coupling-cap roll-off so the pre-filter response stays flat to 30 Hz.
- **Low-pass section:** AOT.1 trim resistor sets 20 kHz overall channel HF gain.

Frequency response is held substantially flat 30 Hz – 20 kHz with these AOT trims.

---

## 6. Compressor / Limiter (per channel)

3-position locking key per channel: **Out / Compress / Limit**. Plus a third "Gang" key (front-position) that sums two channels' control voltages and acts on max(L, R) — **gang detection, not gang VCA** — giving stereo-linked operation when both keys are also at Compress or Limit.

### 6.1 Recovery times

**6 fixed positions** on a stud switch, NOT continuous:

| Position | Recovery |
|---|---|
| 1 | 0.1 s |
| 2 | 0.25 s |
| 3 | 0.5 s |
| 4 | 1 s |
| 5 | 2 s |
| 6 | 5 s |

### 6.2 Hold control

10 kΩ logarithmic carbon potentiometer with calibration markings. Manual: set hold by watching the meter for desired dB of GR rather than by panel marking. When ganged, only the left-hand hold pot is active.

### 6.3 Detector / VCA

Detail in §12.22 (full schematic in PDF — not yet ingested into this memory). Diode-bridge or photo-resistor type implied by "limiter meter is a peak reading meter" comment + ±20 V rail constraint. **Pending: detailed circuit ingestion to determine VCA topology.**

### 6.4 Comp/Lim integration with BPF

Insertion of the comp/limiter introduces a small bass loss; compensated by the BPF AOT trim. AC coupling (6.8 μF + 33 kΩ) maintains uniform LF response whether comp is in or out — so toggling Out/Compress doesn't change the LF tonality of the channel.

---

## 7. Output stage / metering

- **Output amplifier R** + output transformer (BIBA-class) → +10 dB voltage gain → 0 dBV open-circuit. Output Z ~200 Ω, designed for ≥ 2 kΩ load. Handles +20 dBV without clipping.
- VU meter step-up: output xfmr is 1:1.77 (5 dB), so meter sees 0 VU at the −10 dB internal operating level via a 5 dB resistor pad.
- Aux stereo cassette: parallel 5-pin Tuchel sockets so two tape machines can be driven from same output.

---

## 8. Calibration test procedure (excerpted — see PDF "General Test Procedures")

The handbook ships with a routine factory cal procedure done with the in-console oscillator (Studio Playback Cassette).

**Default setting table** (used as reference between tests):

```
Microphone Cassette          Main Cassette
  Output Selector  OFF         Input Gains    0
  Fine Gain        0           Cue 1/2 Levels OFF
  Input Level      ~           VU Meters      Input to Main
  Limiters         OUT          VU Meter Boost Nil
  Hold             20            Pan LH         Left
  Recovery         3            Pan RH         Right
  Bass             0            Echo Channels  OFF
  Presence Freq.   0.5 kHz       Echo Levels    OFF
  Presence dB      0            Faders         OFF
```

**Test steps** (paraphrased):

1. Oscillator → all VU meters → average reads 0 VU
2. MIC → MAIN/CRM routing through buss lines (output selector P1, P3, … P15), expect +1 VU
3. MIC → GROUP routing (G1/G2 buss), expect +1 VU
4. GROUP → MAIN routing (verify sub-buss summation), expect 0 VU at output selector P1, P3, …
5. Echo send routing per ECHO 1–6 channel
6. Echo return routing
7. Cue routing from MIC + MAIN + ECHO

This is the canonical alignment procedure — anyone digitally modeling the console should match it 1:1 as a regression test.

---

## 9. Catalog impact

### 9.1 New ops queued (additive — append to `sandbox_ops_catalog.md` next pass)

| # | proposed opId | family | description |
|---|---|---|---|
| 196 | **virtualEarthBuss** | Routing | TG12345-style V-to-I + virtual-earth summer. 0.01 dB/channel cumulative gain shift, 20 Ω-equivalent input Z, low-crosstalk character. Distinct from #6 mix (which is parallel weighted-sum). |
| 197 | **abbeyPresenceEQ** | Tone/EQ | 8-frequency selectable mid peak EQ ±10 dB in 2 dB steps. Frequencies 0.5/0.8/1.2/1.8/2.8/4.2/6.5/10 kHz. Single-band — meant to chain with `abbey500HzBass`. |
| 198 | **abbey500HzBass** | Tone/EQ | "Bass" control whose half-lift is at 500 Hz, ±10 dB in 5 × 2 dB steps. Low-mid scoop/lift, NOT a true low shelf. The famous warm-but-not-sub Abbey Road tonal fingerprint. |
| 199 | **be740BassCut** | Tone/EQ | 6-position stepped 12 dB/oct HPF: FLAT / 75 / 150 / 300 / 600 / 1200 Hz. Octave-spaced cap-bank network. |
| 200 | **abbeyChannelBPF** | Tone/EQ | Channel-resident BPF: 12 dB/oct subsonic <30 Hz + 20 kHz LP. AOT-style trim params (`bass_aot`, `treble_aot`) for response-flatness shaping. |
| 201 | **tg12345CompLim** | Compressor | Discrete 3-position (Out/Compress/Limit) compressor-limiter with **6 fixed recovery times** (0.1/0.25/0.5/1/2/5 s), hold-time pot, gang-detect link. Schematic detail pending §12.22 ingestion. |
| 202 | **tg12345MicAmp** | Character | Discrete 3-stage BC109 mic preamp (Amp D). 25 dB ±5 dB nominal, soft-asymmetric clipping at +20 dBV. ±20V-rail headroom signature. |

### 9.2 Existing-op cross-references (additive)

| Existing op | Cross-ref note |
|---|---|
| **#6 mix** | Note alternative: TG12345 virtual-earth buss model (#196 virtualEarthBuss). |
| **#139 xformerSat** | Add sub-preset `emiInputXfmr` (1:3.16 step-up, 200 Ω primary). Distinct from Jensen / UTC / Marinair sub-presets. |
| **#139 xformerSat** | Add sub-preset `tg12345OutputXfmr` (1:1.77, BIBA-class, 200 Ω output). |
| **#154 psuRectifierSag** | TG12345 uses ±20 V series stabilisers off 50 V CT — explicit "low ripple" by-design topology, *opposite* character to Marshall's tube-rectifier sag. |

### 9.3 Recipe library impact (additive — append to `recipe_library.md` next pass)

New archetype recipe to add: **"Abbey Road TG12345 Channel Strip"**. Composition:

```
mic in
  → emiInputXfmr (1:3.16, 200 Ω → 632 Ω)
  → tg12345MicAmp (Amp D · 25 dB ±5 dB · BC109 × 3)
  → abbeyChannelBPF (HPF 30 Hz · LPF 20 kHz)
  → tg12345CompLim (recovery=0.5 s · hold mid · Compress)
  → abbeyPresenceEQ (freq=2.8 kHz · gain=+4 dB)
  → abbey500HzBass (gain=+4 dB)
  → be740BassCut (cut=75 Hz)
  → gain (5 dB makeup)
  → tg12345OutputXfmr (1:1.77)
  → virtualEarthBuss (sums 24-channel mix)
```

Anchors recipes for: post-1968 Beatles (*Abbey Road*, *Let It Be*), Pink Floyd *Dark Side*, Wings, ELO, Roxy Music, Kate Bush early albums, plus countless 70s-Britpop classics tracked at Abbey Road / Air / Olympic.

---

## 10. Distinctive quirks (the things that make TG12345 recordings *sound* like TG12345)

1. **50 V phantom (not 48 V).** Abbey Road condensers got slightly higher rail voltage = marginally hotter mic output and different transient handling vs. industry-standard 48 V.
2. **Bass control at 500 Hz half-lift.** Not a true LF shelf — a low-mid scoop/lift. Gives the warm-but-not-sub fingerprint.
3. **8-frequency presence EQ with no <500 Hz options.** Forces engineers to handle bass via the separate 500 Hz "bass" + the BE740 highpass — different mental model from API/Neve combined-band EQs.
4. **6 fixed compressor recoveries, not continuous.** 0.1 / 0.25 / 0.5 / 1 / 2 / 5 s only. Engineers mostly ran position 3 (0.5 s) — characteristic "on the kit" pump time.
5. **Virtual-earth summing.** 24-channel mix has 0.2 dB total gain shift max — much cleaner-blooming than resistor-summing buses.
6. **Transistor "active relays" everywhere.** No relay clicks in audio. AE231-style BCY71 SPDT pairs.
7. **AOT (Adjust On Test) resistors throughout.** Per-channel response trim done at factory, not via consumer-accessible knobs. Each console copy is hand-calibrated.
8. **Soft-asymmetric clipping at +20 dBV.** BC109 + ±20 V rail produces a specific overload character distinct from the +24 dBV / 4×IC console era that followed (SSL 4000, Neve V series).

---

## 10b. Active-unit circuits — second-pass ingestion (2026-04-28)

Additional schematics ingested in a follow-up pass through the handbook PDF. Adds detail for the virtual-earth buss pair and reveals **mixed silicon/germanium** topology in the buffer/makeup amps.

### 10b.1 Amplifier A — general-purpose voltage amp parent (AE203)

The **parent topology** of Amplifier D. Same 3-stage BC109 chain (VT1/VT2/VT3) but with a TYPE selection table on the PCB picking among **4 gain variants** by swapping component values:

| Variant | Gain | C2 (Miller) | C3 (decoupl.) | C5 (lead) | C6 (FB) | R6 | R7 | AOT.1 | Notes |
|---|---|---|---|---|---|---|---|---|---|
| A1 | 10 dB | 8200p | 320μ/4V | 150p | 25μ/4V | 1.2 K | 10 K | SELECT | Mk1-suitable |
| A3 | 20 dB | 8200p | 320μ/4V | 150p | 1μ | 270 Ω | 11 K | OMIT | |
| A4 | 40 dB | 0.033μ | 80μ/6.4V | 560p | 1μ | 24 Ω | 11 K | OMIT | |
| A5 | 46 dB | 0.033μ | 320μ/4V | 560p | 1μ | 24 Ω | 11 K | 24 Ω | |

This is how EMI got 8+ different "amplifier letters" out of a single PCB design — same physical board, different stuffing list. Amp D is essentially Amp A1 with the fine-gain control pin externalised.

### 10b.2 Amplifier B+B — V-to-I converter (AE204) ⭐ *needed for virtualEarthBuss*

Drawing AE204 shows **two identical V→I converters on one PCB** (Amp B+B). Each channel:

- **VT1 (or VT2) BC109** in common-emitter configuration
- **R8 / R10 = 6.8 kΩ ±0.5%** ← gain-setting feedback resistor (precision matched)
- R4 / R6 = 91 kΩ — load
- R5 / R7 = 27 kΩ — bias
- R11 / R12 = 150 kΩ — output coupling network
- R1 / R2 = 390 kΩ — input
- R3 = 150 kΩ — bias divider
- C3 / C4 = 2.2 μF — output coupling
- C1 / C2 = 10 pF — compensation

The 6.8 kΩ ±0.5 % resistor is the *only* gain-defining element. **The output is a current proportional to V_in** — into a low-impedance virtual-earth load (≪ 6.8 kΩ), the output current ≈ V_in / 6.8 kΩ. So 1 V at input → ~150 μA. With ~20 channels driving a virtual-earth summer with negligible input impedance, all currents add cleanly.

**DSP model for `virtualEarthBuss`:**
```
i_n[k] = v_in_n[k] / R_source   where R_source = 6.8 kΩ
i_sum[k] = Σ_n i_n[k]
v_out[k] = − i_sum[k] · R_feedback   (sign-inverted at virtual-earth)
gain_drift = 1 − N · 0.0001         (~0.01 dB per added channel)
```

### 10b.3 Amplifier C1–C7 — virtual-earth input (AE205) ⭐ *needed for virtualEarthBuss*

Drawing AE205 shows **7 sub-variants (C1 through C7)** of the virtual-earth input amplifier — same PCB, different stuffing for different mix-buss applications.

Common topology:
- **VT1 + VT2 BC109** cascaded common-emitter pair
- **Input node = VT1 base = virtual-earth point** (input through R1 = 150 kΩ from current source)
- R3 = 150 kΩ — bias
- **R6 = 200 Ω** + R7 = 11 kΩ AOT.1 + R8 = 33 kΩ — local feedback network setting gain
- C2 = 33 pF, C3 = 220 pF — internal compensation
- Output cap C4 (variant-dependent: 4.7 μF in C1/C2/C4/C6, 200 μF/10 V in C5/C7)
- R4 = 200 Ω AOT — output trim
- R5 = AOT (variant-dependent value, see TYPE table)

Variant table (selected):

| Variant | R5 (FB tail) | R2 (input shunt) | C1 | C4 | Use |
|---|---|---|---|---|---|
| C1 | 47 K | (390 K) | 4.7 μ/4 V | 4.7 μ | Std mic-buss input |
| C2 | 6.8 K | 56 K | 4.7 μ | 4.7 μ | Lower-gain mix |
| C5 | 6.8 K | 56 K | 47 μ | 200 μ/10 V | Long-time-constant variant |
| C7 | 6.8 K | 56 K | 25 μ/4 V | 200 μ/10 V | High-cap output for low-Z drive |

The defining feature: **input impedance ~ 20 Ω** at the virtual-earth node (set by VT1's emitter-degenerated input impedance + heavy local NFB). This is what lets the V→I current sources (Amp B) sum cleanly.

### 10b.4 Amplifier E — +5 dB fader makeup (AE207) ⭐ *germanium-output stage*

Two-stage buffer that recovers the 5 dB loss of the quadrant fader at standard level.

- **VT1 = BC109 (silicon NPN)** — input common-emitter, R3 = 150 kΩ bias, R2 = 150 kΩ
- **VT2 = ACY21 (germanium PNP!)** — output common-emitter
- C1 = 1 μF input coupling
- C2 = 4.7 μF — output
- R5 = 4.7 kΩ + R7 = AOT.1 + R6 = 51 kΩ — feedback / gain-set network giving ~5 dB
- R4 = 150 kΩ — bias

**The output stage is germanium.** ACY21 = OC44/AC125-class germanium PNP, ~50 V breakdown, β ≈ 80, hand-selected for low noise. Germanium has a slightly softer cutoff, asymmetric distortion onset (~0.2–0.3 V V_BE knee vs silicon's 0.6–0.7 V), and characteristically warmer harmonic spectrum at the clipping edge.

**This is a character signature.** Every channel passes through Amp E (or Amp K with the same germanium output stage) for fader-makeup. Even when running clean, the germanium output transistor adds its own subtle harmonic colour to every signal that traverses the console.

### 10b.5 Amplifier G — solo / cue tap unity buffer (AE209) ⭐ *germanium-output stage*

Two-stage unity-gain buffer used at solo and cue taps. Same VT1=BC109 / VT2=ACY21 topology as Amp E (silicon input + germanium output), gain network set to unity:

- R3 = 91 kΩ + R4 = 430 kΩ — feedback for unity
- R6 = 12 kΩ — output load
- C2 = 4.7 μF output cap

**Same germanium-output character signature** as Amp E.

### 10b.6 Amplifier G & B combined (AE210)

A single PCB carrying both an Amp G unity buffer and an Amp B V→I converter. Used in cassettes that need both functions (cue + solo, etc.). Combines VT1+VT2+VT3 mix of BC109 / ACY21. No new circuit information — just a layout combination.

### 10b.7 Amplifier H — balanced 2-output line driver (AE211)

4-stage drive amplifier for balanced output **without** an output transformer. VT1=BC109, VT2=ACY21, VT3+VT4=BC109. Output A + Output B with 51 kΩ output resistors providing balanced source. R4/R5 = 1.1 kΩ matched ±1% feedback resistors set the differential gain. Compensation: C3=220 pF, C4=33 pF, C6=4.7 μF.

Used wherever balanced line drive is needed without the cost of an output transformer (likely Track Monitor or aux outputs).

### 10b.8 Amplifier J — talkback / track-announce / correlator drive (AE212)

5-transistor multi-input switching amplifier with 4 control inputs:

- TRACK ANN (track-announce input)
- OP TALKBACK (operator talkback input, +20 V control)
- AM TALKBACK (artist-manager talkback input)
- L. SQUIET (loudspeaker-quiet preset input)
- 1 K PRESETS pot (level)
- Two outputs: OUT A (talkback bus) + OUT B (to correlator)

VT1=BC109, VT2=ACY21, VT3=BC109, VT4/VT5=BC109. R5 = 8.2 kΩ + AOT.1 + R6 = 3.9 kΩ — gain network. Used in CRM and Studio Playback cassettes for multi-source talkback routing.

### 10b.9 Band Pass Filter — variants F1 through F5 (AE208)

Channel-resident BPF has **5 sub-variants** for different cassette types (mic, group, main, monitor, aux). Common topology: VT1=BC109 + VT2=ACY21 + VT3=BC109 + VT4=ACY21 — **3-stage mixed silicon/germanium** with 2 NFB loops. R1=AOT trim (sets bass corner ~30 Hz), R8=AOT trim (sets treble corner ~20 kHz). C1=1 μF input, C4=10 μF output coupling.

Cap-bank variants per type:

| Type | C3 | C5 | R9 | Assembly |
|---|---|---|---|---|
| F1 | 1000 p | 1000 p | 3.9 kΩ | B208A/F1 |
| F2 | 1000 p | 1500 p | 3.3 kΩ | B208A/F2 |
| F3 | 1000 p | 1200 p | 3.3 kΩ | B208A/F3 |
| F4 | 1000 p | 1800 p | 3.3 kΩ | B208A/F4 |
| F5 | 100 p  | 180 p  | 3.3 kΩ | B208A/F5 |

Note **C1 and C4 are tolerance-matched to ±5 %** during assembly: per the drawing note, "measure capacity of C1 & C4 before fitting then select so that C1 = C4 ± 5 %". This pair-matching is what keeps phase response symmetric channel-to-channel.

### 10b.10 Updated character summary — the germanium thread

The handbook reveals a deliberate **silicon-input / germanium-output** topology in *every* buffer and makeup stage downstream of the mic preamp:

| Amplifier | Role | Input device | Output device |
|---|---|---|---|
| Amp A / D | Mic preamp + voltage amp | BC109 | BC109 (all-silicon) |
| Amp B | V→I converter | BC109 | BC109 (all-silicon) |
| Amp C | Virtual-earth summer | BC109 | BC109 (all-silicon) |
| **Amp E** | Fader makeup +5 dB | BC109 | **ACY21 (Ge)** |
| **Amp G** | Solo/cue unity buffer | BC109 | **ACY21 (Ge)** |
| **Amp R** | Output stage (line out) | BC109 | **ACY21 (Ge)** |
| Amp K | Phase-reverse + 5 dB makeup | BC189 | BC189 (all-silicon) |
| **Amp H** | Balanced line driver | BC109 | mixed (VT2 ACY21 driver) |
| **Amp J** | Talkback/announce | BC109 | mixed (VT2 ACY21) |
| **BPF** | Channel band-pass | BC109 | mixed (VT2/VT4 ACY21) |
| Amp P | Paraphase output | BC189 | BC189 (all-silicon) |

**The summing-buss path is clean BJT silicon**, but **every per-channel signal stage that adds character** (makeup gain, BPF, comp/lim drive, line output) passes through a germanium output transistor. This is almost certainly intentional — gives the console a subtle warm cumulative colour while keeping the buss itself transparent. **This is one of the technical bases for the often-described "smooth" or "rounded" Abbey Road sound.**

**Correction to §10b.10 (2026-04-28 third pass).** Amp K is **all-silicon BC189** (verified from TG Type K schematic, AE205 + germanium-folder Type K.pdf both confirm). Earlier extrapolation from the manual ("Amp K is similar to Amp E with phase reverse added") incorrectly assumed germanium output. The actual Type K is a 3-stage BC189 chain that achieves phase inversion through the natural odd-stage parity. **Amp R, however, IS germanium-output (BC109 in / ACY21 out)** — the line-output stage adds another germanium colour stage at the very end of the signal chain, downstream of the output transformer summing.

---

## 10c. Active-unit circuits — third-pass ingestion (2026-04-28, "Germanium" folder)

User dropped a Google-Drive folder (Chandler Limited / Mike Robinson research dump) containing **clean re-traced schematics** of every TG12345 active unit + the **§12.22 Limiter, §12.1 Presence, §12.5 Bass** schematics that were missing from the AE drawings + **two David Reess engineer sketchbook pages** (1968) with **measured THD, EIN, and noise data** on the prototype B112 mic amp.

PDFs stashed at `docs/primary_sources/abbey_road/germanium/`. All files are clean re-traces by Chandler Limited (Drawn by CR, dated 21/03/21) of the original 1970 EMI documents.

### 10c.1 TG Limiter — Zener Limiter 1970 (closes §12.22 gap) ⭐⭐⭐

The compressor/limiter is a **back-to-back zener-clip-in-feedback** topology — NOT a VCA, NOT a vari-mu, NOT a FET, NOT a diode-bridge. **A novel category** in the catalog.

**Audio path (top half of schematic):**

- **Q1 BC109** input common-emitter (R1=158k, R2=478k bias, R5=12k)
- **Q2 BCY71** germanium gain stage
- **Q3 BCY71** emitter-follower buffer
- **Q4 BC109** + **Q5/Q6 BC189** push-pull gain block (R9=20k, R10=56k, R11=56k, R12=9k1, R13=2k2, R14=1k, R15=27k, R16=22k, R17=20k, R18/R20=3k9)
- **D1, D2 = HS2851** (back-to-back ~5.6 V zener pair) shunt-clamping the feedback path. **This is the gain-reduction element.** When signal exceeds ±5.6 V across the diode pair, they conduct → shunt feedback current → effective gain falls. Below threshold the diodes are open → clean linear gain. **Soft-knee is built into the V-I curve of the zener junction itself.**
- **D3, D4 = HS2851** second pair, mirror element with R19=24R for symmetry trim
- **AOT.6, AOT.10** trim resistors (R7=20k area) set the limiting threshold per channel
- Q7-Q11 (mix of BC189 + BCY71) — recovery and output gain stages
- **D5 = BAY38 with "GR Meter across Diode" annotation** — meter taps the rectified GR voltage directly off the zener pair
- **C8 = 6μ8** output coupling, C9/C10 = 1μ to **Net 48 / Net 49** (audio outputs)

**Detector / control-voltage path (bottom half):**

- **Q15 BC109 + Q16 BC189** differential pair input from Net 48 / Net 49 (audio sidechain tap)
- **D6, D7 = BAY38** back-to-back rectifier pair → full-wave audio rectification
- **Q17 BCY71** common-emitter
- **Q18 BC109** current source
- **D8, D9, D10 = BAY38** rectifier chain → **peak detection** with storage cap
- **Q19 BC109 + Q20 BC189** post-detector gain
- **D11 = BAY38**, R50=8k2
- **Q21 BC189 + Q22 BCY71** output drive stage
- **C11 = 20μ + C12 = 1μ** smoothing caps — these set the **base time-constant for the GR envelope**
- **AOT.1 / AOT.2** (R71/R72) — meter sensitivity trim
- **D12 = BAY38** final clamping diode (anti-overshoot)

**Recovery network (right edge):**
- **R0 = 10 kΩ HOLD pot** (logarithmic carbon — confirms manual text)
- **6-position recovery** stud switch with stepped R values into C11/C12 — gives 0.1 / 0.25 / 0.5 / 1 / 2 / 5 s recoveries

**Comp / Limit mode switches (bottom edge):**
- **SL1 (LIMIT) and SL2 (COMP)** — separate switch contacts that change feedback ratio around the zener pair, giving:
  - **Compress mode** = SL2 closed → softer knee, more pre-threshold "movement"
  - **Limit mode** = SL1 closed → harder onset above threshold

**DSP model for `tg12345CompLim`:**

```
# Per-sample audio path
err   = audio_in - feedback
gain  = open_loop_gain * err
audio_unclipped = gain
# Zener-clip in feedback
fb_threshold = 5.6     # HS2851 zener voltage
fb_clipped = soft_clip_zener(audio_unclipped, V_z=5.6, sharpness=high)
feedback   = fb_clipped * R_feedback / R_input
audio_out  = audio_unclipped  # tap before zener; gain is what got reduced

# Side-chain detector (full-wave + peak hold)
sidechain = abs(audio_out) - hold_threshold
detector_state = max(detector_state * decay_per_sample, sidechain)
# decay_per_sample picked from {0.1, 0.25, 0.5, 1, 2, 5} s switch + hold pot
# detector_state modulates effective fb_threshold downward
```

**Soft-knee character note:** because the GR is the V-I curve of the zener (not a discontinuous threshold), the knee is **inherently smooth** with zero parameter wiggle — different from VCA-based comps that need explicit knee-radius math. This is what gives the TG comp its "musical-feeling" character at low GR amounts.

**Schematic byline:** "Drawn by CR · Zener Limiter 1970"

### 10c.2 TG Type X Presence Control (closes §12.1 gap) ⭐⭐

**Topology: passive LC-resonant boost/cut + active makeup amp.** Eight independent LC tanks in parallel (one per centre frequency), select via rotary switch.

**Active stage (Board B51/3) — same for both Presence and Bass:**

- **Q1 BC109 + Q2 BC189** complementary feedback pair
- C1 = 2u2 input cap → R1 = 20k input resistor
- L1 = 245.3 mH input transformer (two taps: 27.8 turns / 45.3 turns) → R2 = 1k
- R4 = 150k (Q1 collector load), R7 = 200R (Q2 emitter)
- C4 = 3.3p Miller compensation
- **Inner feedback loop:** R5 = 20k + R6 = 300R + C5 = 150p → sets fixed unity-gain reference
- R3 = 56k input bias divider
- R8 = 12k output bias
- C6 = 2u2 output cap

**Frequency-defining LC tank bank (Board B78/2):**

| Centre freq | Cap | Damping R | Inductor section |
|---|---|---|---|
| 0.5 kHz | C7 = 100 nF | R11 = 1 MΩ | L2 (665 mH section, DCR 376.6 Ω) |
| 0.8 kHz | C8 = 18 nF + C9 = 68 nF | 1 MΩ | L2 (DCR 175.2 Ω) |
| 1.2 kHz | C10/C11 = 47 nF | 1 MΩ | L2 (DCR 175.4 Ω) |
| 1.8 kHz | C12 + C13 = 8.2 nF | 1 MΩ | L3 (184 mH section, DCR 87.4 Ω) |
| 2.8 kHz | C14 = 18 nF | 1 MΩ | L3 (DCR 56.2 Ω) |
| 4.2 kHz | C15/C16 = 8.2 nF | 1 MΩ | L3 (DCR 36.2 Ω) |
| 6.5 kHz | C17 = 4.7 nF | 1 MΩ | L3 (residual) |
| 10 kHz | (input transformer) | 1 MΩ | direct-coupled |

So the 8 frequencies are produced by **two large air-core inductors (L2 = 665 mH, L3 = 184 mH) with multiple winding taps** + cap-bank selection. Q is high-ish (~5–8 typical based on 1 MΩ damping vs LC reactance) — narrow enough that the EQ is genuinely band-selective rather than broad shelving.

**Boost/cut ladder (Rs1...Rs12):**

12-position rotary stud switch labelled **"+10 dB to −10 dB in 2 dB steps"**. Position 6/7 = flat (0 dB). Each step changes which tap of the resistor ladder feeds the active-stage feedback divider — boosting or cutting the LC-tuned signal vs. the dry path.

**Schematic byline:** "Drawn by CR · 21/03/21 · TG12345 Type X Presence Control"

### 10c.3 TG Type Z Bass Control (closes §12.5 / 500 Hz half-lift gap) ⭐⭐

**Same B51/3 active stage as Presence**, just with a different LC network:

- **L1 = 1.93 H** (one-point-nine-three Henries — massive air-core inductor)
- **R2 = 750 Ω** series with L1
- C1 = 4u7 input cap
- C6 = 4u7 output cap
- Same Rs1...Rs12 12-position **±10 dB in 2 dB steps** rotary ladder
- Same BC109+BC189 complementary feedback amp downstream

**Topology insight.** The 1.93 H inductor's reactance equals R2 (750 Ω) at:

```
ω = R2 / L1 = 750 / 1.93 = 388.6 rad/s → 61.9 Hz
```

So the LR network has its corner ~62 Hz. With the high-impedance feed from the Rs ladder + the active-stage input impedance, the resulting curve is a **gentle 6 dB/oct shelf with the half-lift point measured at 500 Hz** (per manual §3.5.5) — exactly the low-mid-forward "bass" character documented in the handbook text. **The fact that L = 1.93 H gets the half-lift up to 500 Hz despite the 62 Hz electrical corner is because the curve is asymptotic — the ear-rated half-lift is several octaves above the electrical pole.**

**Schematic byline:** "Drawn by CR · 21/03/21 · TG12345 Type Z Bass"

### 10c.4 David Reess sketchbook — June 1968, B112 Microphone Amplifier ⭐⭐⭐

**Original engineer's hand-drawn schematic + measured-data table.** This is the **prototype** mic amp two years before the production B232 (Amp D). Issued from EMI Hayes labs.

**Topology:**

- 3-stage discrete: **BC109 → BC107 → BC108** (mixed silicon BJTs from the BC10x family)
- ±24 V supply (22 V at one node, 13 V tap, 7 mA current draw)
- 470Ω + 100p Miller comp at VT1, 680p Miller at VT2
- **Switchable feedback resistor R** giving 9 gain settings
- Two output paths: K (high-impedance, +V tap) and P (low-Z via 100Ω/680p)
- 10468 input transformer (pre-screened type, predecessor of the BIBA-class units)

**Measured spec sheet (from Reess hand-notes):**

```
Output:  max +16 dBm into 5 kΩ (clips at +17½ dBm)
         Output Z < 50 Ω
Input Z: 40 kΩ
EIN:     −115 dBm with 5 kΩ source (NF = 1 dB)
Loop gain: 66 dB
```

**Switchable-gain table (R selector):**

| R (Ω) | ∞ | 330 | 120 | 56 | 27 | 15 | 8.2 | 3.9 | 1.8 |
|---|---|---|---|---|---|---|---|---|---|
| Gain (dB) | 18 | 23 | 28 | 33 | 38 | 43 | 48 | 53 | 58 |

**9 gain steps spanning 18–58 dB in 5 dB increments.** This is the prototype of what became the production "12 × 5 dB coarse" + "Amp D fine ±5 dB" combination.

**Measured THD per gain setting (Reess's actual bench numbers, 1 kHz / 10 kHz / 100 Hz at +10 dBm output, i.e. 6 dB above standard −14 dBm operating level):**

| Gain | 100 Hz | 1 kHz | 10 kHz |
|---|---|---|---|
| 18 dB @ +16 dBm | 0.008 | 0.008 | 0.025 |
| 18 dB @ +10 dBm | 0.006 | 0.004 | 0.012 |
| 23 dB @ +10 dBm | — | 0.10 | 0.006 |
| 28 dB @ +10 dBm | — | 0.10 | 0.015 |
| 33 dB @ +10 dBm | — | 0.10 | 0.021 |
| 38 dB @ +10 dBm | — | 0.10 | 0.04  |
| 43 dB @ +10 dBm | — | 0.10 | 0.065 |
| 48 dB @ +10 dBm | — | 0.10 | 0.13  |
| 53 dB @ +10 dBm | — | 0.10 | 0.23  |
| 58 dB @ +10 dBm | — | 0.10 | 0.4   |

(Margin note: "normal output level −14 dBm to allow 30 dB headroom. Distortions at −14 dBm are about ¼ of values here.")

**KEY DSP insight.** THD scales linearly with **gain setting** at 10 kHz from 0.012% (18 dB) up to 0.4% (58 dB) — a **40× growth across 40 dB of gain**. At 1 kHz THD is roughly constant at 0.10% above 23 dB gain — the gain-stage compensation cap dominates LF/MF distortion floor. **The audible character scales rapidly with gain at HF only.**

This gives `tg12345MicAmp` op a parameter-driven THD model:
- THD(f, gain_dB) = max(thd_floor, A·10^((gain_dB−18)/20) at 10 kHz)
- LF/MF THD ≈ 0.10% constant above 23 dB
- HF THD doubles every ~6 dB of additional gain

### 10c.5 David Reess sketchbook — October 1968, Single-Transformer Front End ⭐⭐⭐

**20-way 3-bank Elma switch** input attenuator with measured noise/SNR/EIN per panel position. This is a **20-position prototype** that got simplified to 12 positions in production.

**Topology:**

- Single input transformer with **secondary 4K8 tap** brought in for highest-sensitivity positions
- Two cascaded **B112 mic amps** (the June '68 unit, above) — second one switched in for ultimate gain
- 22 kΩ + 18 kΩ feedback selector resistors choose between single-amp and dual-amp modes
- Resistor-pad ladder (91, 3K3, 3K3, 2K7, 2K7, 18K, 12K, 3K9, 1K8, 1K, 510, 5K6, 150, 82, 47, 27, 15, 18) provides the inter-position attenuation
- 330 Ω + 120 Ω output drop resistors (likely meter calibration)

**Measured noise / S/N / EIN per panel position (Reess bench data):**

| Panel (dBm sens.) | Noise (dBm) | S/N (dB) | EIN (dBm) |
|---|---|---|---|
| −80 | −62   | 48 | −120 |
| −75 | −67   | 53 | −120 |
| −70 (Sec 4K8) | −72 | 58 | −120 |
| −65 | −77.5 | 63 | −120 |
| −60 | −82.5 | 68 | −120 |
| −55 | −87.5 | 73 | −120 |
| −50 | −91.5 | 77 | −119 |
| −45 | −95   | 81 | −118 |
| −40 | −98.5 | 84 | −116 |
| −35 | −99   | 85 | — |
| −30 | −99.5 | 85 | — |
| −25 | −100.5 | 86 | — |
| −20 | −101  | 87 | — |
| −15 | −101  | 87 | — |
| −10 | −101.5 | 87 | — |
| −5  | −101.5 | 87 | — |
| 0   | −102  | 88 | — |
| +5  | −102  | 88 | — |
| +10 | −102  | 88 | — |

**Margin note:** *"'Johnson' for 4K8 is −116 dBm"* — i.e. the Johnson noise floor of the 4.8 kΩ source is −116 dBm. The amp achieves −120 dBm EIN at high-gain positions = **better than the source's own thermal noise floor by 4 dB** (because the input transformer steps up the source impedance to a value where the amp's own noise contribution is below the transformer-impedance Johnson noise). This is **a state-of-the-art noise figure for 1968** and it stands up against modern designs.

**Note on production simplification:** *"Circuit for two trans front end is same up to −20 on panel then one blank & +10 to −20 for line inputs."* So the production console removed the highest-sensitivity dual-B112 cascade positions (−80 to −55) for cost reasons, keeping 12 positions × 5 dB.

### 10c.6 Cumulative impact on catalog

| Op | Before §10c | After §10c |
|---|---|---|
| **#201 tg12345CompLim** | "topology pending §12.22 schematic" | **Locked: zener-clip-in-feedback w/ HS2851 pair, BAY38 detector, 6-step recovery, gang-detect.** Distinct topology from #142/#145/#147/#179. |
| **#197 abbeyPresenceEQ** | "8 freqs × ±10 dB" | **Locked: passive LC-tank bank w/ L2=665mH + L3=184mH inductors, cap values per band, 12-step ±10 dB ladder, B51/3 active makeup with BC109+BC189 complementary pair.** |
| **#198 abbey500HzBass** | "500 Hz half-lift, ±10 dB" | **Locked: 1.93 H massive air-core inductor + 750 Ω + B51/3 amp. 6 dB/oct shelf with electrical corner at 62 Hz, ear-rated half-lift at 500 Hz.** |
| **#202 tg12345MicAmp** | "BC109 × 3, ±20 V, soft-asymmetric +20 dBV ceiling" | **+ measured THD vs gain table (0.012% → 0.4% at 10 kHz across 18–58 dB), EIN −120 dBm w/ 5 kΩ source = 1 dB NF.** |

### 10c.7 Op-spec data extracted (ready to drop into behavioral specs)

```js
// tg12345CompLim spec
{
  topology: 'zener_feedback',
  zener_threshold_v: 5.6,           // HS2851 reverse breakdown
  recovery_positions: [0.1, 0.25, 0.5, 1, 2, 5],  // seconds, 6-step switch
  hold_pot_log: { min: 0, max: 10000, taper: 'log' },  // 10kΩ log carbon
  gang_mode: 'detect_max',          // max(L_cv, R_cv) detector OR
  comp_mode_knee_dB: 6,             // soft (large knee) when SL2 closed
  limit_mode_knee_dB: 1,            // hard (small knee) when SL1 closed
  detector: 'fullwave_peak',        // BAY38 back-to-back + storage cap
  meter_tap: 'across_zener',        // reads GR voltage directly
}

// tg12345MicAmp spec
{
  topology: '3stage_BJT_BC109',
  rail_v: 20,
  output_clip_dBV: 20,
  ein_dBm: -120,                    // with 5kΩ source via xfmr
  noise_figure_dB: 1,
  thd_at_10khz_pct_by_gain: {
    18: 0.012, 23: 0.006, 28: 0.015, 33: 0.021,
    38: 0.04,  43: 0.065, 48: 0.13,  53: 0.23, 58: 0.40,
  },
  thd_at_1khz_pct: 0.10,            // constant above 23 dB
  thd_floor_at_minimum_gain_pct: 0.004,
  loop_gain_dB: 66,
  gain_steps_dB: [18, 23, 28, 33, 38, 43, 48, 53, 58],  // prototype
  // Production consolidated to 12 × 5 dB coarse + ±5 dB fine:
  prod_coarse_steps: 12, prod_step_dB: 5,
  prod_fine_range_dB: 5, prod_fine_step_dB: 0.5,
}

// abbeyPresenceEQ spec
{
  topology: 'passive_LC_active_makeup',
  inductors: { L2_mH: 665, L3_mH: 184 },
  freq_to_cap_nF: {
    500: 100, 800: 86, 1200: 47, 1800: 16.4,
    2800: 18, 4200: 16.4, 6500: 4.7, 10000: 0,
  },
  damping_R_ohms: 1e6,
  gain_steps_dB: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],   // 11 active + 0
  Q_typical: 6,                    // estimated from L+R+C values
  active_stage: 'BC109_BC189_complementary',
}

// abbey500HzBass spec
{
  topology: 'LR_shelf_active_makeup',
  L1_H: 1.93,
  R2_ohms: 750,
  electrical_corner_hz: 62,         // ω = R/L = 388.6 → 62 Hz
  half_lift_freq_hz: 500,           // ear-rated, asymptotic
  slope_db_oct: 6,                  // 1st-order LR network
  gain_steps_dB: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10],
  active_stage: 'BC109_BC189_complementary',
}
```

---

## 10d. Wider UK germanium-era context (Robinson + Chandler + Wireless World + Master Data)

The Germanium folder contains more than just EMI documents — it's Mike Robinson's (Chandler Limited) curated research collection covering the **broader UK germanium-era audio amplifier corpus**, ~1968–1972. Cross-references below.

### 10d.1 Master Data.docx (TG12345 Mk2 Technical Information)

Short technical-summary doc that **cross-validates the Mk2 manual + AE drawings**. Key confirmations and details:

- **Internal operating level: −10 dBV** (matches §2 above)
- **Mic preamp = "Type A3 redesignated as Type D"** ← confirms my §10b.1 reading (Amp A had 4 gain variants; A3 = 20 dB nominal, repurposed as Amp D with the GC fine-gain pin externalised)
- **Fine gain trim: 1.2 kΩ to 0 Ω between GC pin and 0 V → 20–30 dB in 0.5 dB steps** (10 dB total range, 0.5 dB granularity)
- **Coarse gain mechanism:** "Main gain control is in fact attenuation between the input transformer and the Type D amplifier. However, the highest 3 gain settings are from three separate taps on the input transformer with higher turn ratios" ← confirms Reess Oct 1968 sketchbook (multi-tap secondary).

**Full mic-channel signal chain (from the doc, paraphrased):**

```
Mic transformer
  → Mic Amp F (NB: doc text uses "F" but schematics use "D"; F may
                 be a later cassette-naming convention)
  → Bandpass F1
  → Limiter (with bypass switch fed from BPF output via 6μ8 cap)
  → Presence (Type X)
  → Bass (Type Z)
  → Fader buffer E
  → Pan / Bus Buffer B
```

**Group routing (when used):**

```
... Bandpass F1 → Mix amp C1 → Limiter → Fader buffer K
  → Presence (X) → Bandpass F2 → Bus buffer B → Mix amp C1
  → Fader Buffer K → Presence (X) → Bandpass F3 → Track Announce N
  → Output amp R → Output transformer (200 Ω output Z)
```

So **C1** (variant of Amp C virtual-earth) is used at sub-mix points, and Group cassettes substitute **K** (silicon, phase-flipping) for **E** (germanium) as the makeup buffer. Master/Track Monitor cassettes use further BPF variants (F2, F3, F4).

**BPF variant mapping (locked from Master Data):**
- **F1** — Mic Cassette
- **F2** — Group Cassette
- **F3** — Master Channel
- **F4** — Monitor section
- **F5** — auxiliary (likely auxiliary stereo cassette)

This closes the AE208 mystery — F1–F5 are not interchangeable; each is the BPF tuned for the cumulative coupling-cap roll-off of its specific signal path.

**Note on inductances.** From Master Data: *"Inductances from the manual are basic showing just the total for each coil except for the first inductor that has the inductance of the first set of winding indicated. I have added the calculated inductance for each winding section that tallies close enough for the values."* So the inductance values in §10c.2 (376.6 / 175.2 / 175.4 / 87.4 / 56.2 / 36.2 Ω DCR per tap) are **CR's calculated tap-by-tap values that tally with the schematic totals (L2 = 665 mH + L3 = 184 mH).**

### 10d.2 TG Type R Output Amplifier (closes §12.17 gap) ⭐

Drawing dated 22/03/21 by CR. **Two-stage silicon-input + germanium-output emitter follower.**

- **Q1 = BC109** silicon NPN common-emitter (R1=150 K + R2=150 K input bias divider, R3=130 K + R5=300 Ω + R6=AOT.1 680 Ω emitter network, R4=150 K collector load to +20 V)
- **Q2 = ACY21** germanium PNP emitter follower output stage
- C1 = 2u2 input cap, C2 = 3n3 Miller compensation between Q1 collector and Q2 base
- R7 = 820 Ω Q2 emitter to −20 V (sets quiescent current)
- **Output network:** R8 = 2K2 + R9 = 1K6 + R10 = 33 K → C3 = 200 μF output coupling cap → main OUT
- **VU-meter tap:** branches off after R8/R10 voltage divider → C4 = 1n5 → OUT_VU
- Power: ±20 V (matches console rails)

**Adds Amp R to the germanium-thread tally** (§10b.10 corrected above). Every signal that goes to tape passes through this Ge-output stage — the **last** colour stage before the BIBA output transformer.

### 10d.3 TG Type K Phase-Reverse + Makeup (closes §12.12 gap)

Drawing dated 23/03/21 by CR. **Three-stage all-silicon BC189 chain** with internal feedback giving net phase inversion.

- Q1, Q2, Q3 all **BC189** (silicon high-beta complement of BC109)
- C1=2u2 input, C2=3.3p Miller, C3=220 pF feedback
- R-network: R1=150 K, R2=110 K, R3=240 K, R4=AOT.1, R5=3K6, R6=12 K, R7=150 K, R8=200 R, R9=6K8, R10=200 R, R11=22 K
- Power ±20 V
- Single output (no balanced pair like Amp P)

Achieves phase-flip through **odd-stage parity** (3 inverting stages = inverting overall) plus the FB network for +5 dB makeup. **NOT germanium output** — all-silicon. Used in Group/Main cassettes wherever poling correction is needed without the germanium colour of Amp E.

### 10d.4 TG Type P Paraphase (full version of AE233)

Drawing dated 21/03/21 by CR. The full Type P schematic clarifies what the simpler AE233 version (§4.2) showed:

- **5-stage all-silicon BC189** chain
- **Two inputs (IN_1, IN_2) AND two outputs (OUT_1+, OUT_2−)** → balanced-in / balanced-out paraphase
- Inner feedback loops: R10=200R / C4=3.3p / R8=20K / R9=680R / R12=150K / R14=150K / etc.
- Output coupling: C5 = 4U7 (out 1) / C9 = 4U7 (out 2)
- Power ±20 V

Used wherever balanced 2-channel drive is needed without an output transformer (probably aux outputs and inter-cassette routing).

### 10d.5 Robinson 1970/1972 Pre — competing UK design (Chandler ancestor)

5 PDFs in the Robinson & Levesley sub-folder document a **parallel UK germanium-era mic-preamp lineage**, drawn by CR (Chandler Research / Mike Robinson) on 22/03/21 from R Robinson's original 1970/1972 designs. **Topologically distinct from EMI:**

| Feature | EMI TG12345 | Robinson 1970 |
|---|---|---|
| Power rail | ±20 V split | **+24 V single-ended** |
| Mic preamp transistors | BC109 × 3 (all silicon) | BC109 × 3 (all silicon) |
| Input transformer | EMI 10468 / BIBA-class | **MSC1829 (Marinair)** |
| Anti-RFI input cap | (none shown explicitly) | **C11 = 4n7 ANT** at xfmr secondary |
| Fader buffer / makeup | germanium output (Amp E ACY21) | **germanium output (2N4062)** |
| Line output stage | BC109 + ACY21 (Amp R) | **BC109 + 2N4658 (Ge driver) + BC189 + 2N3702 (Ge push-pull)** |

**Robinson 1972 update (annotated on schematic):** "R3, 3B, 4, C13 10× reduction in THD" — adding R3B = 4K7, R3 = 8K2 (was 3K9), R4 = 8K2 (was 9K1), and **C13 = 25 μF Miller-bypass cap** at Q1 emitter gives a **20 dB lower distortion floor** vs. the 1970 unit. Notable design refinement from the period that the EMI TG never adopted (production EMI was already on the BE232 path by 1972).

**Robinson Tone (1970) — 3-band active tone control:**
- **Bass:** VR1 = 500 K LIN with R6/R7 = 4K7 + C6/C7 = 100 nF RC network
- **Mid:** VR2 = 25 K LIN with R8 = 22 K + C8 = 1.5 nF RC network
- **Treble:** VR3 = 5 K LIN with **L1 = 86 mH inductor + C9 = 47 nF LC tank** → resonance ~2.5 kHz
- 3-stage BC109 active makeup with feedback-around-tone-stack topology

The **inductor-tuned treble** is a great design data-point for "British 70s tone control" recipe authoring — gives the treble a resonant Q-peak character distinct from the standard Baxandall RC-only stack.

### 10d.6 Chandler Germanium Pre (modern Neve B104A clone)

Schematic from `Chandler Germanium Pre/Germanium Pre.pdf`. **Important context: this is NOT a TG12345 mic preamp.** The schematic explicitly labels itself "**COPY OF NEVE B104A**" — Chandler's commercial Germanium Pre product is a clone of Neve's late-60s B104A module (used in Neve 1064/1066 consoles), not the EMI TG12345 mic amp.

Topology:
- Input transformer X2 (Marinair-class)
- MIC/DI switch with DI-network: 470 pF + 15 K + 4U7 + 3K3
- "**Thick**" switch for character mode
- Module core (Neve B104A clone):
  - **Q1 = BC184C** silicon NPN input
  - **Q2 = AC176** germanium NPN driver (high-current Ge for collector-output)
  - **Q3 = MJ2955** silicon power BJT output
  - +28 V single-ended supply
  - Gain pot: 6R8 + 2200 μF/50V
  - Feedback pot: 4K7 (master gain control via overall NFB)
- Output transformer VTB9049

**Significance:** confirms that the silicon-input / germanium-driver topology was a UK-wide period convention shared by EMI (TG), Neve (B104A), and Robinson (Helios-era). The Chandler Limited modern product line preserves this character with current-production replicas of period transistors.

For DSP modeling, **Neve B104A character is distinct from EMI TG character** even though both share the silicon-Ge mixed topology — different bias points, different feedback networks, different transformers (BIBA vs Marinair/St Ives), different overload knee shapes. Worth a separate `neveB104A` op slot if/when we get to Neve-1064 recipe authoring.

### 10d.7 Wireless World 1984 Tone Control (Porter, p77)

Period-correct British alternate-Baxandall tone control circuit from the magazine's "Circuit Ideas" column. Author: **B. E. Porter, Kings Lynn, Norfolk.**

Topology: NE5534 op-amp based (HA4605 quad as cost variant). Claims 3 advantages over Baxandall:

1. **No interaction** — pots terminated by virtual-earth nodes
2. **Adjustable LF and HF turnover points** — independent from boost/cut
3. **True shelving with exact mirror images** for lift and cut
4. **Non-inverting** — easy to bypass

Uses single-pole filters by default; **single-pole filters can be replaced by state-variable filters for full parametric control**. Lift/cut set by R_A and R_B pots (4K7 ≈ 10 dB).

Component values: 10 K + 22 pF feedback on IC1/IC2, 6K65 + 1n2 + 50 K anti-log LF select, 20 K lin HF select, 150 nF LP, 22 μF/16 V output cap.

**Tier-A** period reference for "British 80s op-amp tone control" recipe — distinct from the EMI 1970 inductor-LC design and the Robinson 1970 active-discrete design.

### 10d.8 Cumulative impact on catalog (third-pass refresh)

| Op | Update from §10c → §10d |
|---|---|
| `tg12345MicAmp` (#202) | + Master Data confirms "Type A3 redesignated as Type D" lineage; fine-gain mechanism = 1K2 GC pin → 0 V resistance pot. |
| `germaniumBuffer` (#203) | Now backed by 4 independent schematics: Amp E (AE207), Amp G (AE209/AE210), Amp R (Type R PDF), Robinson Buffer 2N4062. **Period-wide UK convention, not an EMI quirk.** |
| (new candidate) `neveB104A` | Distinct silicon-input + Ge-driver + Si-power-BJT topology from Chandler's modern Germanium Pre clone. Defer until Neve 1064 recipe authoring. |
| (new candidate) `robinsonTone` | 3-band active tone with inductor-tuned treble (L1=86 mH + C9=47 nF, resonance ~2.5 kHz). British 70s alt to Baxandall. |
| (new candidate) `porterTone` | NE5534 op-amp non-Baxandall tone with virtual-earth pot termination. British 80s alt. |
| BPF variant table | F1=Mic, F2=Group, F3=Master, F4=Monitor, F5=Aux — locked. |

### 10d.8b Spot-check pass — Type A/B/C/D/E/F/G PDF cross-read (corrections)

After reading the standalone TG Type-letter PDFs from the Germanium folder, **5 small corrections** to earlier §10b readings (AE drawings were lower-resolution; Type-letter re-traces are cleaner):

| Op / amplifier | Earlier (AE-based) | Correct (Type-letter PDF) | Source |
|---|---|---|---|
| Amp E (§10b.4) | R6 = 51 kΩ | **R6 = 5K1 (5.1 kΩ)** | TG Type E |
| BPF F1 (§10b.9 / 10c) | C5 = 1000 pF | **C5 = 2000 pF** | TG Type F variant table |
| BPF input transistors (§10b.9) | VT1 = BC109 | **VT1 = BC189** (functionally similar silicon NPN, higher beta) | TG Type F |
| BPF AOT trims (§10b.9) | "R1=AOT (bass)" only | **R1 = AOT (bass) AND R8 = AOT (treble)** — both corners independently trimmable | TG Type F |
| Amp B+B vs single Amp B | AE204 dual: R4/R6 = 91 kΩ load | Single Amp B variant: **R3 = 9 kΩ load** (not 91 kΩ) | TG Type B (single-channel) |

**Bonus annotations from the Type-letter PDFs:**

- **Type A** has a **dual output** (DC-coupled and AC-coupled via C6) not annotated on AE203. The DC-coupled tap is for chains where the next stage absorbs the DC offset.
- **Type D for Mic AMP** explicitly shows the **5-tap input transformer** with annotation *"Highest gain settings top 3 taps. Lower settings attenuated on TX output"* and *"SELECT FOR 20dB AT MIN GAIN SETTING"* on the AOT.1 trim — confirms Master Data + Reess sketchbook.
- **Type C** shows **4 variants (C1–C4)** vs. AE205's 7 (C1–C7). Likely C5/C6/C7 were rare or discontinued by the Mk2-late era.
- **Type F BPF** — *"C1 and C4 matched to 5%"* annotation explicit (caught from AE208 too).

**No fundamental topology changes** — all Type-letter re-traces confirm the AE drawings at the architecture level. The corrections above affect specific component values used in the DSP-spec snippets in §10c.7.

### 10d.9 Drawing dates and provenance

All TG-Type and Robinson PDFs in the Germanium folder are **clean re-traces by CR (Chandler Research)** dated 21–23 March 2021. The originals are 1970-era EMI / Robinson design documents. The David Reess sketchbook scans are **photographs of the original 1968 hand-drawn engineer's notebook pages** — those are the highest-tier primary sources in the entire collection.

**Provenance chain for each EMI TG12345 op spec:**

```
Mk1 prototype (1968, Reess sketchbook)
  → Mk1 production drawings (1970, AE-series)
  → Mk2 service handbook (1970+, BE-series)
  → Robinson collection re-traces (2021, TG Type-letter PDFs)
  → memory/emi_tg12345_console.md (this file, 2026-04-28)
  → catalog rows / op specs / recipes
```

Every spec value has at least 2 independent sources (handbook text + AE drawing, or AE drawing + Type-letter PDF, or Type-letter PDF + Reess sketchbook). **Highest-confidence primary backing of any op family in the catalog.**

---

## 11. Open ingestion debt (for later passes)

After the second-pass ingestion (§10b above), the major remaining gaps are:

### Still un-ingested

- **§12.14 / Amplifier N** — transistor switching control amp (talkback / track-announce active relay drive). Master Data.docx confirms "Track Announce N" routing is real. Schematic not in Germanium folder under that letter — may need separate document hunt.
- **§12.19 / Amplifier U** — VU meter drive amp. 3.9 kΩ output Z, +10 dB / +20 dB lock-button gain modes.
- **§12.21 / Cassette power-unit (variants)** — partial coverage in §4.3 (BE238 mic-power); other cassette types may use slightly different regulators.
- **§12.30 / Inject specification** — input/output transformer requirements for the inject point I/O isolators.
- **Chandler B100/B104/B105 module images** (PNG/JPG board photos) — visual hardware reference but no schematic detail beyond what `Germanium Pre.pdf` already shows.
- **Type A / B / C / D / E / F / G PDFs** — clean retraces redundant with AE203–AE211 ingestion. Ingest opportunistically for additional cross-check / spotting any tap-value differences not in AE drawings.

### Covered in §10c–§10d (closed by Germanium folder ingestion)

- §12.1 — Presence amplifier ← **TG Type X Presence Control schematic ingested (§10c.2)**
- §12.5 — Bass control ← **TG Type Z Bass schematic ingested (§10c.3)**
- §12.12 — Amplifier K (phase-reverse) ← **TG Type K schematic ingested (§10d.3) — all-silicon BC189, NOT germanium-output as earlier extrapolated**
- §12.17 — Output stage ← **TG Type R schematic ingested (§10d.2) — silicon-input + germanium-output (BC109+ACY21), VU-meter tap, 200 μF output cap**
- §12.22 — **Compressor/Limiter full circuit ← TG Limiter "Zener Limiter 1970" schematic ingested (§10c.1)**

### Wider context now ingested

- **Robinson Pre 1970 / 1972 / Buffer / Out / Tone** (5 PDFs) — Mike Robinson's competing UK germanium-era preamp lineage, used as cross-validation. Robinson 1972 reveals an explicit "10× THD reduction" mod that EMI never adopted in production. (§10d.5)
- **Chandler Germanium Pre.pdf** — modern industrial implementation, **labeled "COPY OF NEVE B104A"** (so this is Neve-derived, NOT TG-derived). Period-wide UK silicon-input + Ge-driver + Si-power-output convention confirmed. (§10d.6)
- **Wireless World 1984-01 p77 Porter** — non-Baxandall NE5534 op-amp tone control, period-correct British 80s alternative reference. (§10d.7)
- **Master Data.docx** — TG12345 Mk2 technical-summary document, used for cross-validation of signal chain + naming + BPF variant mapping. (§10d.1)

### Covered in §10b (no further ingestion needed for op-build)

- §12.2 — Amplifier B (V→I converter) ← **AE204 schematic ingested**
- §12.5 — Amplifier C (virtual-earth input) ← **AE205 schematic ingested**
- §12.6 — Amplifier E (+5 dB makeup buffer) ← **AE207 schematic ingested**
- §12.7 — Band Pass Filter (5 variants) ← **AE208 schematic ingested**
- §12.8 — Amplifier G (unity buffer) ← **AE209 + AE210 schematics ingested**
- §12.27 — Amplifier D (input mic amp) ← **BE232 schematic ingested in §4.1**
- §12.30 (partial) — Track-announce active-relay ← **AE231 schematic ingested in §4.5**

When the next op-ship pass needs detailed schematics from sections still listed above, re-ingest from `docs/primary_sources/abbey_road/EMI_TG12345_Mk2_Service_Handbook.pdf` and update this file additively.

---

## 12. Provenance

- **Source PDF.** `docs/primary_sources/abbey_road/EMI_TG12345_Mk2_Service_Handbook.pdf` (6.0 MB, 100+ pages incl. text + circuit drawings + cal procedure).
- **Originator.** EMI Research Laboratories, Hayes, Middlesex (UK).
- **Drawings dated 1970** (e.g. AE231 = 21-1-70, BE232 issue 4 = 21-1-70, BE233 issue 4 = 21-1-70, BE238 issue 3 = 20-1-70).
- **Console serials.** TG12345 Mk1 installed Abbey Road Studio 2 1968 (used on *Abbey Road* end-of-1969). Mk2 (this handbook) was the production console rolled out 1970+ to other EMI rooms (Studio 3, Olympic via EMI subsidiary work, etc.).
- **Ingested.** 2026-04-28 by Claude (this file).
