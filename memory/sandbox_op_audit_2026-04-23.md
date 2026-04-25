# Sandbox Op Audit — 2026-04-23

**Purpose.** Per-op research-first audit ledger. Each row is the evidence
that the op's DSP was diffed against a primary source, not against a memory
summary. Enforces `sandbox_op_ship_protocol.md`.

**Trigger.** 2026-04-23: fdnCore (#20) shipped with a DSP ordering bug found
only after user pushback. Root cause: worked off memory summaries instead
of primary sources. Full retroactive audit of all 49 shipped ops.

**Row format.** Each op entry records:
- **Primary source(s)** opened (file path, line number or §)
- **Pasted passage** — the exact algorithm/coef specification
- **Diff** — what in the op matches / diverges
- **Verdict** — ✅ PASS · ⚠️ FIX · ⚠️ REWORK
- **Action** — if not PASS, what changed

---

## Pre-audit batch (done before this ledger existed)

### #20 fdnCore — ⚠️ FIX
- **Primary source:** `src/morphReverbEngine.js` (morphreverb-v6 proven shipped)
- **Finding:** v1 had shelf-before-Householder; reference engine uses
  Householder-first + ±1.8 per-channel clamp + post-mix shelf.
- **Fix:** Reordered worklet.js + cpp.jinja to match reference engine.
- **Citations added:** Stautner-Puckette 1982, Jot-Chaigne 1991.
- **Golden:** hash unchanged (128-sample test window ends before delays wrap —
  harness-gap noted in research debt ledger).

### #52 kWeighting — ✅ PASS
- **Primary source:** `dsp_code_canon_loudness.md §2` (BS.1770-5 Annex 1 Tables 1+2)
- **Finding:** Stage-1 head-shelf + stage-2 RLB HP biquad coefs at f_s=48 kHz
  are bit-identical to canon. Bilinear pre-warp at other rates present.
- **No change.**

### #53 lufsIntegrator — ⚠️ REWORK
- **Primary source:** `dsp_code_canon_loudness.md §3` (EBU Tech 3341 V4)
- **Finding:** v1 used IIR one-pole (τ=0.2s momentary / τ=1.5s short-term).
  Canon §3 explicit: EBU Mode requires sliding rectangular windows, NOT IIR.
  BS.1771-1 IIR τ=0.4s is specifically *not* EBU Mode and can differ by ~2 LU.
- **Fix:** Full rewrite to ring-buffer running-sum sliding rectangular
  (400 ms momentary / 3 s short-term), float64 accumulator, mode-change flush.
- **Golden:** re-blessed `b244229144f2a741…` (DSP semantics changed).

### #54 truePeak — ✅ PASS
- **Primary source:** `dsp_code_canon_loudness.md §4` (BS.1770-5 Annex 2
  48-tap polyphase table, `dsp_code_canon_loudness.md:866-881`)
- **Finding:** H0/H1/H2/H3 coefs bit-identical to canon Phase 0–3 table.
  Polyphase indexing correct (h[0]=newest; H0[6]=0.9722 passband-center
  matches canon row 7). 6-sample latency matches group delay.
- **No change.**

### #55 lra — ⚠️ FIX
- **Primary source:** `dsp_code_canon_loudness.md §3.2`
  (`dsp_code_canon_loudness.md:490-496`) Tech 3342 V4 §5 Nov 2023
- **Finding:** Percentile formula used `floor(p·m)`; canon specifies
  `p_idx_1based = round((n-1)·p/100 + 1)`, i.e. 0-based `round((m-1)·p/100)`.
  Off-by-one at p=95% whenever `0.95·m` is integer — mismatches
  libebur128/TC reference.
- **Fix:** Both worklet.js + cpp.jinja now use `Math.round((m-1)*p)`.
- **Golden:** unchanged (128-sample test window never completes a 3 s block).

### #34 svf — ✅ PASS (docs only)
- **Primary source:** Simper/Cytomic 2013 "Linear Trapezoidal Integrated SVF"
  paper (direct — canon `dsp_code_canon_filters.md` does not have this form;
  §1 is Stilson Moog, §2 is older musicdsp-92 double-sampled Simper).
- **Finding:** DSP math matches Simper 2013 paper exactly:
  `g=tan(π·fc/Fs)`, `k=1/Q`, `a1=1/(1+g(g+k))`, `a2=g·a1`, `a3=g·a2`.
  Per-sample: `v3=v0-ic2; v1=a1·ic1+a2·v3; v2=ic2+a2·ic1+a3·v3;
  ic1=2v1-ic1; ic2=2v2-ic2`. Taps LP=v2, BP=v1, HP=v0-k·v1-v2, notch=v0-k·v1.
- **Fix (doc only):** Comment citation was wrong (`Canon:filters §1` is
  Stilson Moog). Updated to cite Cytomic 2013 paper directly. Debt-ledger
  row was also obsolete (claimed "pre-ZDF baseline" — false, op is ZDF).
  Both fixed.

---

## Group 1 — instrument / spectral

### #70 goertzel — ✅ PASS
- **Primary source:** `dsp_code_canon_analysis.md §1` (`:9-36`)
- **Canon code shown (musicdsp 107, Riskedal 2004):**
  ```
  Skn = 2·cos(2π·f/fs)·Skn1 − Skn2 + x[i]
  WNk = exp(−2π·f/fs)    // real-only — LIMITS: magnitude underestimate
  return Skn − WNk·Skn1  // buggy
  ```
  Canon LIMITS explicitly flags the real-only `WNk` as buggy;
  UPGRADES specifies full-complex form.
- **Op form:**
  ```
  Skn = x + coeff·Skn1 − Skn2                    // coeff = 2·cos(ω)
  |X|² = Skn² + Skn1² − coeff·Skn·Skn1           // full-complex magnitude
  mag  = √|X|² · (2/N)                           // peak-normalised
  ```
- **Diff:** Op avoids the canon LIMITS bug by using the full squared-
  magnitude form. Derivation: `X(k) = Skn − e^(−jω)Skn1`, so
  `|X|² = (Skn−cos·Skn1)² + sin²·Skn1² = Skn² + Skn1² − 2cos·Skn·Skn1`.
  With `coeff=2cos(ω)` ⇒ matches op exactly. Recursion matches canon.
- **Action:** None.

### #71 lpc — ✅ PASS
- **Primary sources:**
  - `dsp_code_canon_analysis.md §2` (`:39-76`) — warped autocorrelation
    reference (op uses unwarped — v1 scope declared).
  - Levinson-Durbin recursion: standard Rabiner & Schafer / Zölzer Ch.8
    textbook form (not in canon file; referenced via `jos_pasp_dsp_reference.md`
    LPC pointer).
- **Diff:**
  - Autocorrelation: unnormalized `R[k] = Σ x[n]·x[n-k]`, ring-buffer
    walked in chronological order from `_wPos` (oldest slot). ✓
  - LD recursion: `k = -num/E` with `num = R[i] + Σa[j]R[i-j]`;
    update `a[i]=k; a[j]←a[j]+k·a[i-j]`; `E·=(1-k²)`. Matches textbook. ✓
  - Sign convention: op computes `e[n]=x[n]+Σa[k]x[n-k]` which pairs
    correctly with `k=-num/E`. Consistent all-pole model `A(z)=1+Σa[i]z^(-i)`. ✓
  - Stability: |k|≤0.999 clamp ✓; E≤0 degenerate bail ✓; R[0]<1e-12 silence
    gate ✓; first-block zero-output guard ✓.
- **Action:** None.

### #85 karplusStrong — ✅ PASS
- **Primary source:** `jos_pasp_physical_modeling.md §3.2` (KS original),
  §1.3 (damped plucked string loop gain), §3.5 (one-zero loop filter form).
- **Canon formula:** H(z) = 0.5 + 0.5·z⁻¹; N = Fs/freq; delay line noise-init;
  loop gain g ≤ 1 via §1.3 single-filter-point consolidation.
- **Op formula:** `y = decay · (bright · x + (1-bright) · 0.5·(x+prev))`.
  - At `bright=0`: reduces to `decay · 0.5·(x+prev)` = JOS §3.2 canonical KS ✓
  - At `bright=1`: `decay · x` = pure delay+gain (benign blend extension)
  - `bright` param is a natural musical control that doesn't break §3.2
- **Support:** N=round(Fs/freq) integer (fractional-delay Thiran is P1 debt);
  LCG PRNG per Canon:synthesis §10; rising-edge trigger with refill.
- **Action:** None.

### #86 waveguide — ✅ PASS (with debt-ledger row updated)
- **Primary source:** `jos_pasp_dsp_reference.md §4.1–§4.5`
- **Match:**
  - Two traveling waves, opposite directions, two delay lines (§4.1) ✓
  - Loop gain |r| ≤ 1 via reflection coefs on both ends (§4.4) ✓
  - DC constraint on loop filter (coefs sum to 1) — `(1-d/2)+(d/2)=1` ✓
  - L = round(Fs/(2·freq)) so round-trip = 2L, fundamental = Fs/(2L) ✓
  - Sign convention: +r closed (pressure-preserving), −r open
    (pressure-inverting) — canonical acoustic convention ✓
- **Nuance (not a bug):** Damp filter `(1-d/2) + (d/2)·z⁻¹` is
  linear-phase ONLY at damp∈{0,1}. Intermediate values give
  asymmetric 2-tap → group-delay variation across freq → slight
  partial detuning. JOS §4.5 canonical form is symmetric FIR.
- **Action:** No inline change. Updated debt-ledger row 86 to add
  "symmetric 3-tap `(g, 1-2g, g)`" as P2 upgrade alongside the
  existing P1 fractional-delay/dispersion entries.

### #87a kellyLochbaum — ✅ PASS
- **Primary source:** `jos_pasp_physical_modeling.md §10.1` (KL 2-port),
  §10.2 (one-multiply form).
- **Canon §10.2 formulas:**
  ```
  Δf(t)        = ρ_c · [f_pimo(t−T) − f_mi(t)]
  f_pi(t)      = f_pimo(t−T) + Δf(t)
  f_mimo(t+T)  = f_mi(t)     + Δf(t)
  ```
- **Op (interior junction i..i+1):**
  ```
  delta   = k · (fp[i] - fm[i+1])
  tp[i+1] = fp[i]    + delta
  tm[i]   = fm[i+1]  + delta
  ```
  Bit-identical to §10.2 — 1 mul + 3 adds per junction. ✓
- **Sign convention:** §10.1 `k = (R_i − R_{i-1})/(R_i + R_{i-1})`, |k|≤1
  for passive. Op clamps ±0.99 (conservative, avoids edge-case gain at |k|=1). ✓
- **Boundaries:** glottal `tp[0] = x + gR·fm[0]` ✓; lip damp+reflect ✓.
- **State discipline:** Scratch `tp/tm` then commit to `fp/fm` — required
  because adjacent junctions' reads would be corrupted by in-place update. ✓
- **Output:** `fp[N-1]` = right-going wave at lip (pre-reflection, radiated). ✓
- **Shared nuance w/ #86:** Same 2-tap damp FIR (linear-phase only at
  damp∈{0,1}). Already logged under #86 debt-ledger row.
- **v1 scope:** constant k across all junctions. Per-junction k[i] from
  Fant/Maeda vowel tables already logged in row 87* as P1 upgrade.
- **Action:** None.

---

## Group 2 — filter primitives

### #2 filter — ✅ PASS
- **Primary source:** RBJ Audio-EQ-Cookbook (W3C-hosted canonical text,
  Bristow-Johnson 2004) — WebFetch `https://www.w3.org/TR/audio-eq-cookbook/`
  this session. Canon cross-ref: `dsp_code_canon_filters.md §9` (`:256-284`).
- **RBJ verbatim (from fetch):**
  - Intermediates: `ω₀ = 2π·f₀/Fs`, `α = sin(ω₀)/(2Q)`
  - **LPF:** `b0=(1−cos ω₀)/2, b1=1−cos ω₀, b2=(1−cos ω₀)/2, a0=1+α,
    a1=−2cos ω₀, a2=1−α`
  - **HPF:** `b0=(1+cos ω₀)/2, b1=−(1+cos ω₀), b2=(1+cos ω₀)/2, a0=1+α,
    a1=−2cos ω₀, a2=1−α`
  - **BPF (const 0 dB peak):** `b0=α, b1=0, b2=−α, a0=1+α, a1=−2cos ω₀, a2=1−α`
  - **Notch:** `b0=1, b1=−2cos ω₀, b2=1, a0=1+α, a1=−2cos ω₀, a2=1−α`
- **Op (worklet.js:73-107):** all four modes bit-identical to RBJ. DF1
  topology, `1/a0` multiplied into stored b/a after the switch.
- **cpp.jinja (op_filter.cpp.jinja):** same DF1 state + same coef formulas.
- **Action:** None. Carries P2 debt row 2 (Zölzer / TPT upgrade) — not a bug.

### #23 shelf — ✅ PASS
- **Primary source:** RBJ Audio-EQ-Cookbook (same W3C fetch).
- **RBJ verbatim:**
  - `A = 10^(dBgain/40)`, `α = sin(ω₀)/(2Q)` (with S=1, Q=1/√2 ⇒ α=sin(ω₀)/√2)
  - **lowShelf:**
    `b0 = A[(A+1) − (A−1)cos ω₀ + 2√A·α]`
    `b1 = 2A[(A−1) − (A+1)cos ω₀]`
    `b2 = A[(A+1) − (A−1)cos ω₀ − 2√A·α]`
    `a0 = (A+1) + (A−1)cos ω₀ + 2√A·α`
    `a1 = −2[(A−1) + (A+1)cos ω₀]`
    `a2 = (A+1) + (A−1)cos ω₀ − 2√A·α`
  - **highShelf:**
    `b0 = A[(A+1) + (A−1)cos ω₀ + 2√A·α]`
    `b1 = −2A[(A−1) + (A+1)cos ω₀]`
    `b2 = A[(A+1) + (A−1)cos ω₀ − 2√A·α]`
    `a0 = (A+1) − (A−1)cos ω₀ + 2√A·α`
    `a1 = 2[(A−1) − (A+1)cos ω₀]`
    `a2 = (A+1) − (A−1)cos ω₀ − 2√A·α`
- **Op (worklet.js:86-102):** bit-identical to RBJ. Op uses S=1 explicitly
  (`alpha = sinw0 · √(1/2)`). `A = 10^(gainDb/40)` matches.
- **Bypass at gainDb=0:** A=1 ⇒ (A−1)=0 kills cross-terms; b0/a0 reduces to
  `(2 + 2α)/(2 + 2α) = 1`, other b/a ratios = 0. Passthrough. ✓
- **cpp.jinja:** line-for-line mirror (confirmed via grep).
- **Action:** None.

### #32 onePole — ✅ PASS (topology verified; coefficient mapping is
  textbook but not explicitly on JOS page)
- **Primary source:** JOS "One-Pole Filter Equations"
  `https://ccrma.stanford.edu/~jos/filters/One_Pole.html` (WebFetch this session).
- **JOS verbatim:**
  - Difference eq: `y(n) = b₀·x(n) − a₁·y(n−1)`
  - Transfer fn:  `H(z) = b₀ / (1 + a₁·z⁻¹)`
  - Pole at `z = −a₁`; stability `|a₁| < 1`.
  - **Note from fetch:** JOS page does NOT give an explicit
    `a₁ = −exp(−2π·fc/Fs)` formula.
- **Op (worklet.js:64-71, 87-95):**
  - `a = exp(−2π·fc/Fs)`, `y = (1−a)·x + a·y₁`
  - Map to JOS: `a₁_JOS = −a_op`, `b₀_JOS = (1−a_op)` ⇒ same topology. ✓
  - Pole at `z = a_op ∈ (0,1)` ⇒ |pole| < 1 ⇒ stable. ✓
  - DC gain: `b₀/(1+a₁) = (1−a)/(1−a) = 1`. Nyquist gain: `(1−a)/(1+a) < 1`. ✓
  - HP mode: `out = x − lp` — canonical complementary 1-pole HP; LP+HP=x exact. ✓
- **Coefficient mapping (not on JOS page):** `a = exp(−1/(τ·Fs))` with
  τ=1/(2π·fc) is the standard analog-prototype-matching mapping (Zölzer
  DAFX §2.2.1 and every smoothing-filter text). Not primary-sourced here.
  Flagging in debt-ledger note below.
- **Denormal flush on LP state ✓.
- **Action:** None (DSP correct). Adding debt-ledger note that the fc→a
  mapping wants a Zölzer §2.2.1 fetch for full primary-source coverage.

### #16 allpass — ✅ PASS (topology verified; bilinear mapping derived)
- **Primary source:** Wikipedia "All-pass filter" (WebFetch this session):
  discrete-time first-order form. JOS `filters/Allpass_Filters.html` +
  `filters/Allpass_Examples.html` (both fetched; neither gives the specific
  first-order bilinear mapping directly).
- **Wikipedia verbatim:** `H(z) = (z⁻¹ − z̄₀)/(1 − z₀·z⁻¹)`, pole and zero
  reflections across unit circle.
- **For real coefficient `a = −z₀`:** H(z) = (z⁻¹ + a)/(1 + a·z⁻¹) =
  (a + z⁻¹)/(1 + a·z⁻¹). ✓ matches op topology.
- **Magnitude proof (computed this session):** |a+e^(−jω)|² = a²+2a·cos ω+1
  = 1+2a·cos ω+a² = |1+a·e^(−jω)|² ⇒ |H|=1 ∀ω. ✓
- **Op (worklet.js:70-75, 89-93):** `y = a·(x−y₁) + x₁` — one-mul
  arrangement of `y + a·y₁ = a·x + x₁`. Bit-identical to Wiki form. ✓
- **Bilinear mapping `a = (tan(πfc/Fs)−1)/(tan(πfc/Fs)+1)`:** derived
  this session by bilinear-transforming analog `H(s)=(s−Ωc)/(s+Ωc)` with
  pre-warping `Ωc=(2/T)·tan(πfc·T)`. Result is
  `H(z) = −(a+z⁻¹)/(1+a·z⁻¹)` with `a=(c−1)/(c+1)`, c=tan(πfc/Fs).
  Op omits the leading `−1` (equivalent allpass up to overall phase —
  still |H|=1 ∀ω). Two equivalent conventions exist in the literature.
- **Stability:** for fc∈(0,Nyq), c∈(0,∞) ⇒ |a|=|c−1|/|c+1|<1 ⇒ pole
  inside unit circle ⇒ unconditionally stable. ✓
- **cpp.jinja:** mirror of worklet.
- **Action:** None.

### #17 dcBlock — ✅ PASS (SHIP-CRITICAL)
- **Primary source:** JOS "DC Blocker"
  `https://ccrma.stanford.edu/~jos/fp/DC_Blocker.html` (WebFetch this session).
- **JOS verbatim:**
  - Difference eq: `y(n) = x(n) − x(n−1) + R·y(n−1)`
  - Transfer fn:  `H(z) = (1−z⁻¹)/(1−R·z⁻¹)`
  - R: "typically somewhere between 0.9 and 1"; "for 44.1 kHz, R=0.995 is good"
  - **Note:** JOS page does NOT give an explicit `R = exp(−2π·fc/Fs)` formula.
- **Op (worklet.js:39-57, 73-80):**
  - `R = exp(−2π·fc/Fs)`, `y = x − x₁ + R·y₁` — bit-identical to JOS. ✓
  - Default fc=10 Hz @ 48 kHz ⇒ R ≈ 0.998694 (in JOS's 0.9–1 range). ✓
  - DC zero: H(1)=0 ⇒ infinite DC attenuation. ✓
- **Coefficient mapping:** `R = exp(−2π·fc/Fs)` is the standard 1-pole
  pole-radius mapping. Not on JOS page — carried from Smith/Zölzer
  convention. For the specific HP topology `(1−z⁻¹)/(1−R·z⁻¹)` the true
  −3 dB point drifts above fc at higher cutoffs, but at fc=10 Hz @ 48 kHz
  the mapping is accurate to sub-Hz. Documented as approximate.
- **Denormal flush on y-state ✓ (Canon:utilities §1, SHIP-CRITICAL for
  feedback returns).
- **cpp.jinja:** line-for-line mirror.
- **Action:** None.

---

## Group 3 — delay / drive / mix

### #15 delay — ✅ PASS (doc citation imprecise; math is canon §2 not §1)
- **Primary source:** `dsp_code_canon_time_interp.md §1` (`:9-36`) de Soras
  Hermite-4; `§2` (`:40-66`) Niemitalo direct-algebraic cubic.
- **Canon §2 verbatim (Niemitalo):**
  ```
  a = (3*(x0-x1) - xm1 + x2) / 2
  b = 2*x1 + xm1 - (5*x0 + x2) / 2
  c = (x1 - xm1) / 2
  y = (((a*frac) + b)*frac + c)*frac + x0
  ```
  Mapping op names → canon names: `y0=xm1, y1=x0, y2=x1, y3=x2`.
- **Op (worklet.js:131-136):**
  ```
  c0 = y1
  c1 = 0.5*(y2 - y0)
  c2 = y0 - 2.5*y1 + 2*y2 - 0.5*y3
  c3 = 0.5*(y3 - y0) + 1.5*(y1 - y2)
  out = ((c3*t + c2)*t + c1)*t + c0
  ```
- **Diff (expanded side-by-side):**
  - canon `c = (x1-xm1)/2 = (y2-y0)/2` ⇔ op `c1` ✓
  - canon `b = 2*y2 + y0 - (5*y1+y3)/2 = y0 - 2.5y1 + 2y2 - 0.5y3` ⇔ op `c2` ✓
  - canon `a = (3(y1-y2) - y0 + y3)/2 = -0.5y0 + 1.5y1 - 1.5y2 + 0.5y3`
    ⇔ op `c3 = 0.5(y3-y0) + 1.5(y1-y2) = -0.5y0 + 1.5y1 - 1.5y2 + 0.5y3` ✓
  - canon `x0 = y1` ⇔ op `c0` ✓
  - Bit-identical to Niemitalo §2 (same cubic as §1 de Soras, just
    different arithmetic arrangement).
- **Op doc says "Canon §1 (Laurent/Niemitalo form)":** imprecise — §1 is de
  Soras ILP-optimized; the op's algebraic form is literally §2. Same math,
  wrong citation number.
- **Action (doc-only):** update op comment `Canon:time_interp §1` →
  `Canon:time_interp §2 (Niemitalo direct-algebraic; same cubic as §1)`.
  Non-semantic.
- **Ring buffer + fractional read:** `readPos = w − delaySamples`,
  `delaySamples ≥ 1` so read never overlaps write. ✓
- **External FB tap:** `line[w] = in[i] + fb_gain · fb[i]` — pre-mix on
  the incoming-to-line side, matches dry/wet rule (FB is signal path, not
  parallel). ✓ Feedback gain clamped [0, 0.98].
- **Denormal flush on both read-out and line-in. ✓

### #13 saturate — ✅ PASS
- **Primary source:** `dsp_code_canon_character.md §11` (`:306-319`) —
  Rational Tanh (Padé, C² continuous).
- **Canon §11 verbatim:**
  ```c
  float rational_tanh(float x) {
    if (x < -3)  return -1;
    if (x >  3)  return  1;
    return x * (27 + x*x) / (27 + 9*x*x);
  }
  ```
- **Op (worklet.js:74-81):**
  ```
  u = drive * x
  if (u > 3) u = 3
  else if (u < -3) u = -3
  out = trimLin * u * (27 + u²) / (27 + 9u²)
  ```
- **Diff:** Op clamps u to ±3 instead of returning ±1 directly. At the
  boundary u=±3, `u(27+9)/(27+81) = ±3·36/108 = ±1`. So clamping to ±3
  and evaluating the rational is equivalent to canon's `return ±1` branch.
  ✓ bit-identical math, C² continuous across the clip boundary.
- **Pre/post gain:** `drive` scales into curve; `trim` (dB→lin) scales
  after. Canon §11 has no gain wrapping; this is a composition, not a
  deviation from the primary.
- **Action:** None.

### #6 softLimit — ✅ PASS (SHIP-CRITICAL for FB safety)
- **Primary source:** same `dsp_code_canon_character.md §11`.
- **Op (worklet.js:63-70):**
  ```
  u = x / T              (T = threshold)
  if (u > 3) u = 3
  else if (u < -3) u = -3
  out = T * u * (27 + u²) / (27 + 9u²)
  ```
- **Diff vs canon §11:** Identical Padé kernel; threshold-scaled via
  `T·padé(x/T)` (standard soft-limiter framing: limiter with ceiling=T
  normalised to ±1 internally, then scaled back up). At |x| ≤ T the
  output tracks x linearly within ~2.6% canon-specified error; at
  |x| ≥ 3T output saturates at exactly ±T. ✓
- **Threshold guard:** op clamps T ≥ 0.01 (registry caps at [0.1, 1.8]).
  T=0 would divide by zero. ✓
- **Action:** None.

### #50 bitcrush — ✅ PASS
- **Primary source:** `dsp_code_canon_character.md §8` (`:208-240`, Paul
  Kellett 2002, musicdsp 61). NOTE §8 is a dither+NS *composite*, not a
  bare quantizer — the quantizer core lives inside that composite.
- **Canon §8 verbatim (lines :215-230, full block):**
  ```c
  int r1, r2;
  float s1, s2;
  float s  = 0.5f;
  float w  = pow(2.0, bits - 1);
  float wi = 1.0f / w;
  float d  = wi / RAND_MAX;
  float o  = wi * 0.5f;
  r2 = r1;  r1 = rand();
  in += s * (s1 + s1 - s2);
  tmp = in + o + d*(float)(r1 - r2);
  out = (int)(w * tmp);
  if (tmp < 0.0f) out--;
  s2 = s1;
  s1 = in - wi*(float)out;
  ```
  - `w = 2^(bits-1)` = half of total levels over ±1.
  - `wi = 1/w` = step between adjacent levels on [-1,+1].
  - `o = wi*0.5` = half-step offset. `(int)(w*tmp); if(tmp<0) out--;` is
    floor-toward-minus-infinity. Adding `o` before flooring converts
    floor → round-to-nearest.
  - `s*(s1+s1−s2)` = 2nd-order error feedback (NS). `d*(r1−r2)` =
    triangular dither from two uniform rands.
- **Op (worklet.js:62-72):**
  ```
  if (bits === 0) { passthrough }
  invStep = (1 << bits) * 0.5     // = 2^bits/2 = 2^(bits-1)  ⇔ canon w
  step    = 1 / invStep            // = 1/w                   ⇔ canon wi
  out = Math.round(x * invStep) * step
  ```
- **Diff (quantizer-core only):**
  - Grid: canon `w = 2^(bits-1)` ⇔ op `invStep = 2^(bits-1)`. ✓ same levels.
  - Step: canon `wi = 1/w` ⇔ op `step = 1/invStep`. ✓ same spacing.
  - Rounding: canon does `floor(w·tmp + 0.5)` (via `o` offset + floor
    trick); op does `Math.round(x · invStep)`. Both are round-half-away-
    from-zero; differ only at exact half-boundaries (JS `Math.round`
    rounds −0.5 → 0, canon's `floor(x+0.5); if(x<0) --` rounds −0.5 →
    −1). Negligible for audio — a sub-LSB edge case on an already
    quantised grid. ✓ equivalent for all practical inputs.
- **Diff (what op omits vs canon §8):**
  - NS 2nd-order error feedback: canon has `in += s*(s1+s1-s2)` before
    quantise, `s1 = in − wi*out` after. Op has none — this is deliberate
    per op doc :10-14 (separate slot #114 noiseShaper). Canon §8 LIMITS
    `:236` notes "error feedback can drift DC; no clip guard" — another
    reason to keep NS separable.
  - Dither: canon has `+ d*(r1−r2)` (TPDF). Op has none — separate slot
    #115 dither. Also deliberate.
- **Bypass contract:** bits=0 ⇒ bit-exact passthrough (op :62-65). ✓
- **No denormal concern:** output lives on a discrete grid.
- **Verdict:** Op ships the quantizer core of canon §8 correctly; the
  dither+NS wrapping is intentionally split to separate ops. No bug.
- **Action:** None.

### #11 mix — ✅ PASS (SHIP-CRITICAL — dry/wet rule)
- **Primary source:** `memory/dry_wet_mix_rule.md` `:109-117` — equal-power
  cos/sin law, declared NON-NEGOTIABLE at file top.
- **Canon verbatim (`:113-117`):**
  ```js
  const theta  = (1 - mixP) * Math.PI * 0.5;
  const wet    = Math.cos(theta);
  const dry    = Math.sin(theta);
  ```
- **Op (worklet.js:36-37, 52-65):**
  ```
  dryG = Math.cos(amount * Math.PI * 0.5);
  wetG = Math.sin(amount * Math.PI * 0.5);
  out  = dry * dryG + wet * wetG;
  ```
- **Diff:** Op swaps the sense of `amount` relative to canon's `mixP`.
  Canon: mixP=0 ⇒ wet=0, dry=1 (all dry); mixP=1 ⇒ wet=1, dry=0 (all wet).
  Op:    amount=0 ⇒ dryG=1, wetG=0 (all dry); amount=1 ⇒ dryG=0, wetG=1
  (all wet). Identity: `sin(a·π/2) = cos((1-a)·π/2)` and vice versa, so
  the two parametrisations are mathematically equivalent — the op stores
  dryG where canon stores `dry`, and both equal `sin((1-amount)·π/2)`
  = `cos(amount·π/2)`. ✓ Equal-power preserved (dryG²+wetG²=1 ∀amount).
- **Same-sample operation:** op is a pure per-sample sum of dry+wet inputs
  — no external dry-leg comb-filter concern (dry/wet rule's forbidden
  pattern). ✓
- **Null tests:** amount=0 ⇒ out=dry exactly; amount=1 ⇒ out=wet exactly.
  Bypass contract satisfied when authors wire raw input to `dry`. ✓
- **Action:** None.

---

## Group 4 — dynamics-chain core + curve primitive

### #? envelope — ✅ PASS
- **Primary source:** `memory/dsp_code_canon_dynamics.md` §1 Bram (lines 9–41) +
  `memory/dsp_code_canon_utilities.md` §1 Jon Watte denormal (lines 9–37).
- **Canon §1 paste (verbatim):**
  ```cpp
  float ga = (float)exp(-1/(SampleRate*attack));
  float gr = (float)exp(-1/(SampleRate*release));
  float envelope = 0;
  for (...) {
    EnvIn = std::abs(input);
    if (envelope < EnvIn) { envelope *= ga; envelope += (1-ga)*EnvIn; }
    else                  { envelope *= gr; envelope += (1-gr)*EnvIn; }
  }
  ```
- **Op paste (core, `op_envelope.worklet.js:89-99`):**
  ```js
  const x = Math.abs(inCh[i]);
  const a = (x > s) ? aAtt : aRel;
  s  = a * s + (1 - a) * x;
  dn = -dn;
  s += dn;                    // alternating-sign DENORM bias (Watte)
  outCh[i] = offset + amount * s;
  ```
- **Diff:** Algebra identical (`a·s + (1-a)·x` ≡ `s*a + (1-a)*x`). α = exp(-1/(τ·Fs)) ✓ (canon uses attack in **seconds**; op converts ms→s in `_recomputeAlphas`). State-dependent branch on `x > s` identical to canon's `envelope < EnvIn` ✓.
- **Denormal:** Canon §1 UPGRADES explicitly says "denormal guard on envelope"; op implements Watte alternating-sign double-bias (±1e-20 flips each sample, zero long-term DC) — stronger than canon's suggested single-sided bias. T6 rule `ENVELOPE_DENORMAL_GUARD` enforces ≥2 textual DENORM references. ✓
- **Output scaling:** `env_out = offset + amount·s` with default `amount=-1` → gain-reduction polarity. Not in canon §1 (canon returns envelope magnitude); op's scaling is a sandbox convention matching TOY_COMP's wiring, doesn't alter detector math.
- **Action:** None.

### #? detector — ✅ PASS
- **Primary source:** `memory/dsp_code_canon_dynamics.md` §1 Bram rectifier line (`EnvIn = std::abs(input)`, line 22). No standalone "rectifier" canon section — the detector stage is the `abs()` call inside the Bram follower.
- **Canon passage:** `EnvIn = std::abs(input);` (then fed into one-pole follower)
- **Op paste (`op_detector.worklet.js:43-48`):**
  ```js
  if (this._mode === 'rms') {
    for (let i = 0; i < N; i++) { const x = inCh[i]; outCh[i] = x * x; }
  } else {
    for (let i = 0; i < N; i++) outCh[i] = Math.abs(inCh[i]);
  }
  ```
- **Diff:** `peak` mode = `|x|` — identical to canon's `std::abs(input)`. `rms` mode = `x²` (power-domain, expected to be averaged+sqrt'd by downstream `rms` op per inline comment). Stateless, branch-free per sample ✓.
- **Action:** None.

### #? gainComputer — ✅ PASS
- **Primary source:** CTAGDRC `Source/dsp/GainComputer.cpp` (GPLv3, Phillip Lamp 2020) — open-source implementation of Giannoulis/Massberg/Reiss 2012 / Zölzer DAFX §4.2.2 soft-knee static curve. Fetched via curl from github raw. Giannoulis 2012 PDF itself inaccessible (QMUL/AES/ResearchGate 403s).
- **CTAGDRC paste (verbatim):**
  ```cpp
  slope = 1.0f / newRatio - 1.0f;
  // ...
  const float overshoot = input - threshold;
  if (overshoot <= -kneeHalf)
      return 0.0f;
  if (overshoot > -kneeHalf && overshoot <= kneeHalf)
      return 0.5f * slope * ((overshoot + kneeHalf) * (overshoot + kneeHalf)) / knee;
  return slope * overshoot;
  ```
  (CTAGDRC returns `grDb` directly; linear conversion done by caller.)
- **Op paste (`op_gainComputer.worklet.js:71-88`):**
  ```js
  const invRm1 = (1 / ratio) - 1;          // == CTAGDRC `slope`
  ...
  if (knee > 0 && xDb > thr - halfK && xDb < thr + halfK) {
    const t = (xDb - thr + halfK) / knee;   // t ∈ [0,1]
    yDb = xDb + invRm1 * knee * t * t * 0.5;
  } else if (xDb >= thr + halfK) {
    yDb = thr + (xDb - thr) / ratio;
  } else {
    yDb = xDb;
  }
  const grDb = yDb - xDb;
  outCh[i] = Math.exp(grDb * LOG10 / 20) - 1;
  ```
- **Diff:** Op returns `yDb` (output level); CTAGDRC returns `grDb` (reduction). Relation: `grDb = yDb − xDb`. Substitute:
  - below knee (xDb < thr−halfK): op yDb=xDb ⇒ grDb=0 ✓ matches CTAGDRC `return 0.0f`.
  - above knee (xDb ≥ thr+halfK): op yDb = thr + (xDb−thr)/ratio ⇒ grDb = (xDb−thr)(1/ratio − 1) = slope·overshoot ✓ matches `return slope * overshoot`.
  - in knee: op `yDb = xDb + invRm1·knee·t²·0.5` ⇒ grDb = invRm1·knee·t²·0.5. With t=(overshoot+kneeHalf)/knee: grDb = invRm1 · (overshoot+kneeHalf)² / (2·knee) = `0.5 * slope * (overshoot + kneeHalf)² / knee` ✓ bit-identical to CTAGDRC.
- **Output sense:** Op returns `exp(grDb·ln10/20) − 1` = `grLin − 1` ∈ [−1, 0] (delta-from-unity) so it sums cleanly into `gain.gainMod` where base=1.0. Not in CTAGDRC (CTAGDRC returns grDb for separate makeup-gain stage); op's linear-delta form is a sandbox wiring convention, doesn't alter curve math.
- **Action:** None.

### #? curve — ✅ PASS
- **Primary source:** Wikipedia "Cubic Hermite spline" — basis functions `h00`, `h10`, `h01`, `h11` on unit interval [0,1] (the canonical reference form). `memory/dsp_code_canon_time_interp.md` §1/§2 give Niemitalo/de Soras arithmetic arrangements of the same cubic but use the `c0/c1/c2/c3` Horner form; the op uses the literal basis form instead, so Wikipedia is the closer primary.
- **Canon paste (Wikipedia basis, unit interval):**
  ```
  h00(t) =  2t³ − 3t² + 1
  h10(t) =   t³ − 2t² + t
  h01(t) = −2t³ + 3t²
  h11(t) =   t³ −  t²
  p(t)   = h00·p₀ + h10·m₀ + h01·p₁ + h11·m₁
  ```
- **Op paste (`op_curve.worklet.js:154-161`):**
  ```js
  const t2 = t  * t;
  const t3 = t2 * t;
  const h00 =  2*t3 - 3*t2 + 1;
  const h10 =     t3 - 2*t2 + t;
  const h01 = -2*t3 + 3*t2;
  const h11 =     t3 -   t2;
  return h00 * p0.y + h10 * m0 * dx + h01 * p1.y + h11 * m1 * dx;
  ```
- **Diff:** Basis functions bit-identical. Op multiplies tangent terms by `dx = p1.x − p0.x` because Wikipedia's form assumes unit-interval tangents (slopes per unit `t`); op's tangents are slopes per unit `x`, so multiplication by segment width rescales them — standard non-unit-interval Hermite form (see Wikipedia "Interpolation on an arbitrary interval"). ✓
- **Catmull-Rom:** `m_i = (y_{i+1} − y_{i−1}) / (x_{i+1} − x_{i−1})`; endpoints one-sided. Matches Wikipedia centripetal-free Catmull-Rom tangent formula. ✓
- **Bipolar mode:** `y = sign(x) · curve(|x|)` — sandbox convention for symmetric waveshaping; not part of standard Hermite, doesn't affect interpolator math.
- **Action:** None.

### #50 rms — ✅ PASS (gap-documented)
- **Primary source:** `memory/dsp_code_canon_dynamics.md` §3 UPGRADES note (line 114): "1-pole IIR RMS instead of rectangular window." Canon §3 ships the rectangular form verbatim; the one-pole form is named as the upgrade target but its formula isn't pasted in any single canon block. Op implements the one-pole form directly.
- **Canon §3 paste (rectangular baseline for comparison, line 98):**
  ```cpp
  double rms = sqrt(summ/nrms);   // rectangular window, O(n·nrms)
  ```
  UPGRADE note: "1-pole IIR RMS instead of rectangular window."
- **Gap-honesty note:** The verbatim formula `p[n] = (1−α)x[n]² + α·p[n−1]; y = √p[n]` does not appear in any single primary source I could open in this pass. It is the direct application of §3's UPGRADE directive via the standard one-pole exponential-average form (which is already canonical for envelope followers; see §1 Bram, where `s ← α·s + (1−α)·x` is applied to `|x|` instead of `x²`). The op's math is the `x²`-input variant of the exact same one-pole that §1 and `op_envelope` use — re-deriving "one-pole on squared input" is not a novel step. Logged as a gap rather than claimed verbatim.
- **Op paste (`op_rms.worklet.js:106-112`):**
  ```js
  for (let i = 0; i < N; i++) {
    const x = inCh[i];
    p = oma * (x * x) + a * p;
    if (p < DENORMAL) p = 0;
    outCh[i] = p > 0 ? Math.sqrt(p) : 0;
  }
  ```
- **α form:** `α = exp(−1 / (τ · Fs))` with τ = window·1e-3 s ✓ (identical to canon §1's time-constant form, applied to a 300 ms default window → VU-meter ballistics).
- **Stability:** denormal flush (canon utilities §1) on state ✓; `p > 0` sqrt guard handles float rounding residual ✓.
- **Action:** None. Row noted in `sandbox_ops_research_debt.md` only if one-pole vs. true BS.1770-rectangular becomes a fidelity concern downstream (currently P2 — see existing `rms` debt row).

---

## Group 5 — meter ballistics + control primitives + generator

### #49 peak — ✅ PASS (gap-documented)
- **Primary source:** `memory/dsp_code_canon_loudness.md` §1 (PPM/true-peak terminology, standards matrix) and `memory/dsp_code_canon_dynamics.md` §2 (100→1% decay semantics — 1% is the dual of 60 dB since 20·log₁₀(0.001) = −60 dB).
- **Canon §2 paste (decay-constant pattern):**
  ```cpp
  attack_coef  = exp(log(0.01)/(attack_in_ms  * samplerate * 0.001));
  // = exp(−4.605 / (ms·sr·1e-3))   for 100%→1% (−40 dB) semantics
  ```
- **Op paste (`op_peak.worklet.js:46,82-83`):**
  ```js
  const LN_1E_MINUS_3 = -6.907755278982137;  // ln(0.001), 60 dB
  this._rCoef = Math.exp(LN_1E_MINUS_3 / (rSec * this.sr));
  // process:
  y = ax > y ? ax : y * r;        // instant attack / exponential release
  ```
- **Diff:** Op uses 60 dB (ln(10⁻³)) decay target vs. canon §2's 40 dB (ln(10⁻²)). Both are valid ballistics conventions; 60 dB is the **IEC 60268-10 / EBU R68 PPM convention** (standards-aligned for peak meters), 40 dB is the dynamics-processor convention. Op's choice matches its stated use case (meter driver). ✓
- **Gap-honesty:** Verbatim IEC 60268-10 "1.7 s Type I PPM fall time" coefficient isn't pasted in any single memory primary source; the `exp(ln(0.001)/(rSec·Fs))` derivation is a one-line standard-textbook arrangement. Same caliber of gap as onePole's fc→a.
- **Algorithm:** `y = max(|x|, y·r)` — instant attack, exponential release — is the textbook peak-hold ballistic (Zölzer DAFX §4.4.1 "peak programme meter"). ✓
- **Stability:** denormal flush on state ✓.
- **Action:** None.

### #8 smooth — ✅ PASS
- **Primary source:** Web Audio API `AudioParam.setTargetAtTime` specification (W3C Web Audio §1.6.3): `v(t) = target + (v₀ − target)·exp(−t/τ)` — the canonical one-pole exponential approach. Companion ref `memory/dsp_code_canon_utilities.md` §1 Watte denormal (already pasted in Group 4 envelope row).
- **Canon/spec form:** `α = 1 − exp(−1/(τ·Fs));  y[n] = y[n−1] + α·(x[n] − y[n−1])`
- **Op paste (`op_smooth.worklet.js:42-43, 76-80`):**
  ```js
  if (!(timeSec > 0)) return 1;                      // τ=0 → passthrough
  return 1 - Math.exp(-1 / (timeSec * this.sr));
  // process:
  y += a * (inCh[i] - y);
  if (y < DENORMAL && y > -DENORMAL) y = 0;
  ```
- **Diff:** α form `1 − exp(−1/(τ·Fs))` bit-identical to spec. `y += α·(x − y)` is the algebraic rearrangement of `y = (1−α)·y + α·x` (one multiply fewer). ✓
- **Passthrough:** τ=0 ⇒ α=1 ⇒ `y = y + 1·(x − y) = x` — bit-exact bypass matches `setTargetAtTime(τ=0)` behavior. ✓
- **Denormal:** Watte flush on state ✓ (canon §1).
- **Action:** None.

### #95 slew — ✅ PASS (no single canonical primary — trivial rate-limiter algo)
- **Primary source:** No dedicated canon section for linear-rate slew limiters (the op sits between canon §1 Bram exponential follower and analog `dV/dt = I/C` op-amp slew-rate spec). Companion ref: Zölzer DAFX §4.4 dynamics chain, which treats slew as a special case of asymmetric rate-limited follower.
- **Gap-honesty:** Linear slew is a ~5-line trivial algorithm (per-sample step, clamp delta-to-step). No authority paper exists because the algorithm is below the threshold for peer-reviewed DSP literature — every synth/compressor manual re-derives it in a paragraph. Documenting as a gap rather than citing a dubious secondary source.
- **Op paste (`op_slew.worklet.js:123-135`):**
  ```js
  for (let i = 0; i < N; i++) {
    const target = inCh[i];
    const delta = target - y;
    if      (delta >  up)  { y += up;  }
    else if (delta < -down){ y -= down;}
    else                   { y = target; }  // within rate → snap
    outCh[i] = y;
  }
  ```
- **Math:** `step = 1 / (ms · sr · 1e-3)` = 1 unit traversed in `ms` milliseconds ✓. Asymmetric (rise/fall) matches analog capacitor charge/discharge asymmetry stated in op comment.
- **Edge cases:** `delta ∈ [−down, up]` triggers the snap branch — prevents residual hop past the target (distinguishes slew from smooth's exponential asymptote). Guarded by numerical `>=`/`<=` boundaries. ✓
- **Stability:** denormal flush on block-end state ✓.
- **Action:** None.

### #99 glide — ✅ PASS (no single canonical primary — trivial constant-time interpolator)
- **Primary source:** No dedicated canon section. Closest analog: monophonic-synth portamento semantics (Minimoog, MS-20) — the algorithm is "recompute step size so traversal time is constant regardless of distance," which is one division per target change. Below the threshold for peer-reviewed literature, same as slew.
- **Gap-honesty:** Documenting as gap rather than citing secondary sources. Family positioning vs. slew/smooth/ramp is spelled out in op header comment and matches sandbox modulation roadmap §4.
- **Op paste (`op_glide.worklet.js:121-133`):**
  ```js
  } else if (x !== target) {
    target = x;
    if (glideSamples <= 0) {
      y = target; step = 0; active = false;
    } else {
      step = (target - y) / glideSamples;
      active = step !== 0;
      if (!active) y = target;
    }
  }
  if (active) {
    y += step;
    if (step > 0) { if (y >= target) { y = target; active = false; } }
    else           { if (y <= target) { y = target; active = false; } }
  }
  ```
- **Math:** step = Δ/(glideMs·sr·1e-3) per sample ⇒ reaches target in exactly glideMs regardless of Δ ✓. Direction-aware snap terminates glide when passing the target (prevents overshoot from float rounding). ✓
- **Retargeting:** Mid-glide target change recomputes step from *current* `y`, not from original start — matches Minimoog-style portamento ("every new note takes glideMs from wherever you are"). ✓
- **First-sample snap:** Avoids gliding a filter cutoff from 0 Hz at load — documented UX invariant. ✓
- **glideMs=0 fast path:** Bit-exact passthrough ✓.
- **Action:** None.

### #? noise — ⚠ CITE FIXED (code unchanged)
- **Primary sources:** `memory/dsp_code_canon_synthesis.md` §8 (Trammell 3-stage pink, musicdsp 220) and §10 (32-bit LCG, musicdsp 59). Companion: `memory/dsp_code_canon_utilities.md` §1 Watte denormal.
- **Canon §10 paste (LCG, verbatim):**
  ```c
  randSeed = (randSeed * 196314165) + 907633515;
  ```
- **Canon §8 paste (Trammell, verbatim):**
  ```cpp
  static const float A[] = {0.02109238, 0.07113478, 0.68873558};
  static const float P[] = {0.3190, 0.7756, 0.9613};
  state[0] = P[0]*(state[0]-t) + t;         // ← P is POLE
  return (A[0]*state[0] + ...) * RMI2 - offset   // ← A is AMPLITUDE
  ```
- **Op paste (`op_noise.worklet.js:33-35, 133-137`):**
  ```js
  const PINK_A = [0.02109238, 0.07113478, 0.68873558];   // used as POLE
  const PINK_P = [0.3190,     0.2636,     0.4144];       // used as AMPLITUDE
  p0 = PINK_A[0] * p0 + (1 - PINK_A[0]) * w;
  y  = (PINK_P[0]*p0 + PINK_P[1]*p1 + PINK_P[2]*p2) / PINK_OUT_SCALE;
  ```
- **Diff — LCG (white):** bit-identical constants (a=196314165, c=907633515, m=2³²) ✓.
- **Diff — pink:** Op uses canon §8's `A` vector as one-pole poles; canon §8 uses the same numbers as amplitudes. Op's amplitude vector `{0.3190, 0.2636, 0.4144}` doesn't appear in §8 at all. This is the **Paul Kellett "economy" pink-noise** recipe — a sibling to Trammell with poles/amps swapped. Both are valid 1/f approximations but produce different spectral flatness. Op's prior cite ("Canon §8 Trammell") was wrong.
- **Fix applied (2026-04-24):**
  - `op_noise.worklet.js` — rewrote header comment + coefficient-block comment to cite "Paul Kellett economy pink" and explicitly flag the pole/amp-swap relationship to canon §8 Trammell.
  - `op_noise.cpp.jinja` — mirrored the cite fix on the C++ sidecar.
  - `memory/sandbox_ops_research_debt.md` — updated noise row baseline description + added "Canon §8 Trammell (alt recipe, distinct slope flatness)" as the known-alternative upgrade path (P3).
  - **Code unchanged** — coefficients and algorithm ship as-is; the recipe is well-published and the op's behavior is unaltered. Only documentation was wrong.
- **Diff — brown:** 1-pole leaky integrator `b = 0.996·b + 0.004·w`, output scaled by 3.5. Not in any canon §; standard textbook Brownian / "red noise" definition. Gap-honesty logged.
- **Stability:** denormal flush on all three pink stages + brown state ✓.
- **Action:** Cite fix shipped. No DSP change, no golden re-bless expected (only comments touched).

---

## Group 6 — modulation source, loudness statistics, stereo metering, control snap

### #? lfo — ✅ PASS
- **Primary source:** `memory/dsp_code_canon_synthesis.md` §6 "Fast Sine/Cosine Oscillator — Coupled Form (musicdsp 10)".
- **Canon §6 paste (verbatim):**
  ```c
  float a = 2.f * (float)sin(Pi*frequency/samplerate);
  float s[2] = {0.5f, 0.f};
  // per sample:
  s[0] = s[0] - a*s[1];
  s[1] = s[1] + a*s[0];
  // periodic resync:
  const float tmp = 1.5f - 0.5f*(s[1]*s[1] + s[0]*s[0]);
  s[0] *= tmp;  s[1] *= tmp;
  ```
- **Op paste (`op_lfo.worklet.js:69, 128-143`):**
  ```js
  return 2 * Math.sin(Math.PI * hz / this.sr);   // a coefficient
  // per sample:
  s0 -= a * s1;
  s1 += a * s0;
  // renorm every RENORM_INTERVAL=128 samples:
  const mag2 = s0 * s0 + s1 * s1;
  const tmp = 1.5 - 0.5 * mag2;
  s0 *= tmp; s1 *= tmp;
  ```
- **Diff:** `a = 2·sin(π·f/Fs)` ✓, update pair `s0−=a·s1; s1+=a·s0` ✓, renorm `tmp = 1.5 − 0.5·(s0²+s1²); scale both` ✓. Renorm cadence: canon says "periodic"; op runs every 128 samples (documented as "imperceptible drift at N=128, f ≤ 40 Hz" — drift is O(a²·N), acceptable). ✓
- **Seed difference:** Canon seeds `s0=0.5, s1=0`; op seeds `s0=1, s1=0`. The renorm pulls `|s|²` toward 1 (fixed point of `x ← x·(1.5 − 0.5x)`), so canon's seed converges to unit amplitude anyway — op's unit-amplitude seed just starts at the steady state. Both produce the same long-term behaviour; op's choice matches its stated "s1 ≈ sin(2π·f·t)" contract without waiting for convergence. Not a defect. ✓
- **Shape extensions:** tri/sq/saw driven from parallel `phase` accumulator in lockstep with coupled oscillator. Phase-reseed on rate change (`_reseedFromPhase`) keeps shapes locked. Not in canon §6 (canon is sine-only); sandbox extension, doesn't alter sine math. ✓
- **Action:** None.

### #53 loudnessGate — ✅ PASS
- **Primary source:** `memory/dsp_code_canon_loudness.md` §2 (BS.1770-4 Annex 1 core math, cross-checked bit-identical with BS.1770-5 Nov 2023) + §1 gate-parameter summary.
- **Canon §2 paste (verbatim, eqs. 3–7):**
  > **Gating** (eqs. 3–7): block-wise, T_g = 400 ms, 75% overlap (100 ms hop), incomplete trailing block discarded. Two-pass:
  > - Absolute gate Γ_a = −70 LKFS — drop any block whose loudness l_j is below it.
  > - Relative gate Γ_r = mean_abs_lufs − 10 LKFS — recompute the mean loudness from the surviving (absolute-gated) blocks, subtract 10 LU, drop any block below that.
  > - Final gated loudness is the log of the channel-weighted energy mean over the twice-gated block set.
  >
  > `L_K = −0.691 + 10·log₁₀(Σ G_i · z_i)` in LKFS.
- **Op paste (`op_loudnessGate.worklet.js:61-66, 118-163`):**
  ```js
  const LUFS_OFFSET   = -0.691;
  const ABS_THRESH_DB = -70;
  const REL_OFFSET_DB = -10;
  // 400ms block = 4 × 100ms sub-blocks
  this._subLen   = Math.round(sampleRate * 0.1);
  this._blockLen = this._subLen * 4;
  // after each new block:
  const ms = blockSumSq / this._blockLen;
  const absPassMin = Math.pow(10, (ABS_THRESH_DB - LUFS_OFFSET) / 10);
  if (G * ms <= absPassMin) return;                // abs gate
  // re-compute relative threshold over whole abs-passing pool
  const msRel = meanMsAbs * 0.1;                   // 10^(-10/10) = 0.1
  // twice-gated mean
  this._integratedLufs = LUFS_OFFSET + 10 * Math.log10(G * meanMs2);
  ```
- **Diff — block geometry:** 400 ms block, 100 ms hop (75% overlap, incomplete trailing discarded via the `_subRingFill < 4` guard) ✓. Ring of four 100 ms sub-blocks = sum-of-squares over last 400 ms ✓.
- **Diff — thresholds:** Γ_abs = −70 LUFS ✓. Γ_rel = ungated_mean − 10 LU, applied as MS threshold `msRel = meanMsAbs · 10^(−10/10) = meanMsAbs · 0.1` (algebraically equivalent after taking the inverse of `L = −0.691 + 10·log10(G·MS)`) ✓.
- **Diff — core formula:** `L_I = −0.691 + 10·log₁₀(G · mean(MS_k))` over twice-gated pool ✓.
- **Re-gate on every block:** spec requires re-scanning whole abs-passing history for each new block; op does this (`for (i=0; i<absPassN; i++)`). ✓
- **Channel weights:** K-weighting upstream (#51); op receives pre-weighted audio and applies a single `G` param (per-channel). Correct separation of concerns per canon §2 stage ordering.
- **Stability:** Denormal flush on `subAcc` ✓. `MS_FLOOR = 1e-12` bottom-caps the log argument ✓.
- **Action:** None.

### #56 correlation — ✅ PASS (gap-documented on IEC 60268-18)
- **Primary source:** Textbook Pearson correlation `ρ = E[LR] / √(E[L²]·E[R²])` + `memory/dsp_code_canon_loudness.md` §1 one-pole averager convention. Op cites IEC 60268-18 (stereo programme-level metering) and EBU Tech 3341 V4 — neither is ingested verbatim into memory; the formula is a textbook closed-form Cauchy-Schwarz-bounded ratio and doesn't require authority quotation to verify.
- **Canon reference (pattern):** One-pole smoothed expectation `E[z][n] = (1-α)·z[n] + α·E[z][n-1]` — same form used by RMS (#50) and envelope (#4). 300 ms default τ matches IEC broadcast convention.
- **Op paste (`op_correlation.worklet.js:128-147`):**
  ```js
  eLL = oma * (l * l) + a * eLL;
  eRR = oma * (r * r) + a * eRR;
  eLR = oma * (l * r) + a * eLR;
  const denom2 = eLL * eRR;
  let rho;
  if (denom2 < DENOM_FLOOR) rho = 0;
  else {
    rho = eLR / Math.sqrt(denom2);
    if (rho > 1) rho = 1;
    else if (rho < -1) rho = -1;
  }
  ```
- **Diff:** Three one-pole expectations (`eLL`, `eRR`, `eLR`) all share `α = exp(−1/(τ·Fs))` ✓. `ρ = eLR / √(eLL·eRR)` bit-identical to Pearson ✓. Defensive `[−1,+1]` clamp against float error past Cauchy-Schwarz bound ✓. Silence sentinel: denom² below 1e-20 → ρ=0 (reads as "no information", not NaN) ✓.
- **Gap-honesty:** IEC 60268-18 not ingested verbatim; formula is textbook. Same gap caliber as slew/glide (below authority-paper threshold).
- **Stability:** Denormal flush on all three expectations ✓.
- **Action:** None.

### #98 quantizer — ✅ PASS (trivial snap-to-grid)
- **Primary source:** No canonical authority needed — snap-to-grid `y = offset + f((x−offset)/step)·step` is a one-line construction below the threshold of peer-reviewed DSP literature. Family-positioning vs. `bitcrush` (#26, which quantises audio amplitude in 2^bits levels) is spelled out in the op header.
- **Op paste (`op_quantizer.worklet.js:116-123`):**
  ```js
  const inv = 1 / step;
  if (mode === 1)      for (i) outCh[i] = offset + Math.floor((inCh[i] - offset) * inv) * step;
  else if (mode === 2) for (i) outCh[i] = offset + Math.ceil ((inCh[i] - offset) * inv) * step;
  else                 for (i) outCh[i] = offset + Math.round((inCh[i] - offset) * inv) * step;
  ```
- **Math:** Invariants — `x = offset + k·step` for integer `k` ⇔ output = input (fixed points are the grid itself) ✓. `step = 0` → bypass guarded ✓. Negative step absolute-value'd ✓.
- **Mode semantics:** round/floor/ceil map to `Math.round/floor/ceil` — floor gives monotone-non-increasing on descent (arp-on-grid), round gives symmetric half-up (JS convention), ceil for completeness ✓.
- **Gap-honesty:** Documented as gap rather than citing secondary sources for a trivial formula.
- **Action:** None.

### #57 stereoWidth — ✅ PASS (gap-documented on Bauer 1963)
- **Primary source:** Bauer 1963 "Stereophonic Earphones and Binaural Loudspeakers" for the √2-normalised M/S matrix + DAFX Zölzer Ch. 11 for M/S decomposition in spatial effects. Neither is ingested verbatim into memory; the M/S formula is a basic linear transform and the `width = E[S²]/(E[M²]+E[S²])` form is op-specific (energy-fraction mapping to [0,1]).
- **Bauer M/S (standard form, from literature):**
  ```
  M = (L + R) / √2
  S = (L − R) / √2
  ```
- **Op paste (`op_stereoWidth.worklet.js:137-147`):**
  ```js
  const m = (l + r) * INV_SQRT2;     // 0.7071067811865475
  const s = (l - r) * INV_SQRT2;
  eMM = oma * (m * m) + a * eMM;
  eSS = oma * (s * s) + a * eSS;
  const total = eMM + eSS;
  outCh[i] = total < DENOM_FLOOR ? 0.5 : eSS / total;
  ```
- **Diff — M/S matrix:** Bauer √2-normalisation ✓ (`1/√2 = 0.7071067811865475`, 16-digit Double precision). Preserves energy: `E[M²] + E[S²] = E[L²] + E[R²]` (easy algebra: `(l+r)²/2 + (l−r)²/2 = l² + r²`).
- **Diff — width formula:** `width = E[S²] / (E[M²] + E[S²])` — the side-fraction form. Mapped to [0,1] (bounded, monotone in side-energy). Edge-case table in op comment (L=R → 0, L=−R → 1, decorr → 0.5, mono-panned → 0.5) is correct by construction.
- **Silence sentinel:** total energy < 1e-20 → width=0.5 (centre, matches meter-needle-parks-centre UX convention) ✓.
- **Gap-honesty:** Bauer 1963 not ingested into memory; M/S is textbook and trivially verifiable. The energy-fraction output mapping is sandbox-convention, not a citation.
- **Stability:** Denormal flush on both expectations ✓.
- **Action:** None.

---

## Group 7 — control primitives (triggered + arithmetic)

### #97 ramp — ✅ PASS (trivial trigger-driven linear envelope)
- **Primary source:** No dedicated canonical section. Closest pattern is in `memory/dsp_code_canon_dynamics.md` §4 beat detector, which combines Schmitt + edge-detection + peak follower — `ramp` is the "linear envelope following the rising edge" extension of that pattern. The algorithm (phase-accumulator-bounded-to-1) is below the literature threshold.
- **Gap-honesty:** No authority-paper paste; textbook one-shot linear envelope.
- **Op paste (`op_ramp.worklet.js:112-132`):**
  ```js
  if (trigCh) {
    const t = trigCh[i];
    if (!trigHigh && t > 0.5) { trigHigh = true; phase = 0; active = true; }
    else if (trigHigh && t < 0.5) { trigHigh = false; }
  }
  if (active) {
    phase += step;
    if (phase >= 1) { phase = 1; active = false; }
  }
  outCh[i] = start + span * phase;
  ```
- **Math:** `step = 1 / (timeMs · sr · 1e-3)` units per sample — phase traverses [0,1] in exactly `timeMs` from the rising edge ✓. `out = start + (end − start) · phase` is linear interpolation ✓.
- **Edge semantics:** Rising-edge detection `!trigHigh && t > 0.5`, falling reset at `t < 0.5` — same 0.5-midpoint convention as `trigger` in pulse mode (consistent across the op family). ✓
- **timeMs = 0:** `step = +Infinity` → first active sample saturates phase to 1 ⇒ instant jump from start to end. Documented invariant. ✓
- **State is bounded:** phase ∈ [0,1], startVal/endVal are author-supplied scalars — no recursive IIR state ⇒ no denormal risk ✓.
- **Action:** None.

### #96 trigger — ✅ PASS
- **Primary source:** `memory/dsp_code_canon_dynamics.md` §4 Beat Detector (musicdsp 200) — the canonical Schmitt + rising-edge pattern.
- **Canon §4 paste (verbatim, lines 141-149):**
  ```cpp
  if (!BeatTrigger) {
    if (PeakEnv > 0.3)  BeatTrigger = true;
  } else {
    if (PeakEnv < 0.15) BeatTrigger = false;
  }
  BeatPulse = false;
  if (BeatTrigger && !PrevBeatPulse) BeatPulse = true;
  PrevBeatPulse = BeatTrigger;
  ```
- **Op paste (`op_trigger.worklet.js:104-118`):**
  ```js
  // gate mode:
  if      (!high && x >= hi) high = true;
  else if ( high && x <= lo) high = false;
  outCh[i] = high ? 1 : 0;

  // pulse mode:
  if (!high && x >= hi) { high = true; edge = 1; }
  else if (high && x <= lo) { high = false; }
  outCh[i] = edge;
  ```
- **Diff:** Schmitt state machine bit-identical to canon (`!high && x ≥ hi → arm; high && x ≤ lo → disarm`) ✓. Canon hardcodes thresholds 0.3/0.15; op exposes them as params (defaults 0.5/0.4) — generalization without changing the math. ✓
- **Gate vs pulse:** Canon §4 outputs `BeatPulse = high && !prevHigh` (one-sample tick on arm-up). Op's `pulse` mode matches this exactly (edge=1 only on the transition sample). Op's `gate` mode is the persistent-square extension (high ? 1 : 0), useful for envelope sustain — a clean superset of canon.
- **Safety:** Op coerces `threshLo ≤ threshHi` when authors misconfigure — canon doesn't guard this (assumes hardcoded 0.3/0.15). Op's guard prevents a degenerate `lo > hi` state that would break the arm-down transition. ✓
- **Action:** None.

### #94 uniBi — ✅ PASS (trivial linear remap)
- **Primary source:** No canonical authority — `y = 2x − 1` and `y = (x+1)/2` are elementary-algebra range remaps below the DSP-literature threshold. Pattern is universal in modulation-routing systems (Ableton / Bitwig / Reaktor all ship a uni/bi toggle per mod slot per op header comment).
- **Gap-honesty:** No citation.
- **Op paste (`op_uniBi.worklet.js:86-90`):**
  ```js
  if (this._mode === MODE_UNI_TO_BI) {
    for (let i = 0; i < N; i++) outCh[i] = 2 * inCh[i] - 1;
  } else {
    for (let i = 0; i < N; i++) outCh[i] = (inCh[i] + 1) * 0.5;
  }
  ```
- **Math:** `uniToBi`: [0,1] → [−1,+1] via `2x−1`, inverse is `biToUni`: [−1,+1] → [0,1] via `(x+1)/2`. Compose both in either order ⇒ identity (bit-exact in float since the numbers are exact powers of 2). ✓
- **No clamp:** Deliberate — documented as linear remap, not saturator. Authors chain `clamp` for hard bounds. Matches mod-router convention. ✓
- **Unwired input:** Remaps 0 → −1 (uniToBi) or 0 → 0.5 (biToUni). Consistent with "unwired is numeric zero" sandbox convention; symmetric under the remap ✓.
- **Action:** None.

### #29 scaleBy — ✅ PASS (single multiply)
- **Primary source:** No canonical authority — `y = k · x` is a single multiply, below any literature threshold. Op's role vs. `gain` (#1): gain is dB-based with gainMod summing for mod buses; scaleBy is the raw linear scalar for polarity/mute/trim.
- **Gap-honesty:** No citation.
- **Op paste (`op_scaleBy.worklet.js:54-64`):**
  ```js
  const k = this._k;
  if (k === 1) { for (i) outCh[i] = inCh[i]; return; }   // bypass contract
  if (k === 0) { for (i) outCh[i] = 0;       return; }   // mute
  for (i) outCh[i] = k * inCh[i];
  ```
- **Math:** `y = k·x`. Fast paths for `k=1` (bit-exact bypass — ship_blockers bypass contract ✓) and `k=0` (mute). General case: one multiply per sample.
- **No state, no denormal concern** — multiply preserves zero; `k · 0 = 0` exactly in IEEE 754 ✓.
- **Polarity flip:** `k = −1` works for free as a special case (no branch needed) ✓.
- **Action:** None.

### #? combine — ✅ PASS
- **Primary source:** `memory/sandbox_modulation_roadmap.md` §2 axis-3 (six coupling types) + §7 (IR uses `op: 'mul'|'add'` in `param.sources` lists). This is a sandbox-internal design spec, not a DSP-literature citation — the operations themselves (pairwise mul/add/max/min/linear-crossfade/replace) are elementary.
- **Gap-honesty:** No DSP-literature citation needed for pairwise scalar arithmetic.
- **Op paste (`op_combine.worklet.js:112-123`):**
  ```js
  switch (mode) {
    case MODE.mul:      y = a * b; break;
    case MODE.add:      y = a + b; break;
    case MODE.max:      y = a > b ? a : b; break;
    case MODE.min:      y = a < b ? a : b; break;
    case MODE.lastWins: y = Number.isNaN(b) ? a : b; break;
  }
  // weighted: out = (1 − w)·a + w·b     (fast-path in separate branch)
  ```
- **Math:** All six modes are standard:
  - `mul/add` — the two param-modulation recomposition rules declared in the modulation roadmap ✓.
  - `max/min` — order statistics (used for one-shot-gated mod shaping) ✓.
  - `weighted` — linear crossfade `(1−w)·a + w·b`, clamped weight ∈ [0,1] ✓.
  - `lastWins` — NaN-sentinel `b` means "b unwired → pass a", else overwrite ✓.
- **Identity elements:** `_identityA/_identityB` returns the neutral value of each mode when one side is unwired (1 for mul, 0 for add, ±∞ for max/min, 0 for weighted). This makes unwired-side behaviour correct for all modes without per-sample branching inside the hot loop. ✓
- **Weighted fast path:** Separate pre-loop check avoids the per-sample NaN trick and isolates the weight scalar. ✓
- **Stateless, no denormal concern** — per-sample arithmetic only ✓.
- **Action:** None.

---

## Group 8 — canonical primitives (math-by-definition)

Five ops whose "primary source" is the mathematical definition + IEEE-754
float semantics; no DSP paper or reference implementation applies.
Gap-honesty: no canonical-code primary available because none exists.
Each row documents the exact definition shipped + any op-specific tweak
beyond the textbook form.

### #1 gain — ✅ PASS (canonical-by-construction)

- **Primary source** — algebraic definition: dB→linear via
  `base = 10^(gainDb/20)`; sample-wise multiply `y = x · base`.
  Op also mirrors the shipped `compileGraphToWebAudio.js gain()` factory
  (control-rate `gainMod` summed into the AudioParam's resting value).
- **Code** (`op_gain.worklet.js` 48–62): `base = Math.pow(10, _gainDb/20)`;
  three branches — no input → zero out; `modCh` wired → `outCh[i] =
  inCh[i] * (base + modCh[i])`; else `outCh[i] = inCh[i] * base`.
- **Diff**: exact. `gainMod` summed as linear offset on top of base is the
  contract the compiler promises; loops are stateless and unrolled.
- **Verdict**: PASS. No debt. SHIP-CRITICAL only insofar as dB↔linear
  conversion must remain exact for `bypass` / `mix` parity tests.

### #31 constant — ✅ PASS (canonical-by-construction)

- **Primary source** — DC source definition: `y[n] = v` for all n.
  Op-specific tweak: setParam silently rejects NaN/±Inf and holds the
  previous finite value ("sticky last-good", matching other ops).
- **Code** (`op_constant.worklet.js` 56–74): `Number.isFinite` guard on
  setParam; block loop writes `v` to every sample; no state.
- **Diff**: definition-exact. Guard is a defensive doc item, not math.
- **Verdict**: PASS. No debt.

### #93 z1 — ✅ PASS (canonical-by-construction)

- **Primary source** — Z-transform definition `H(z) = z⁻¹`, i.e.
  `y[n] = x[n-1]` with x[-1]=0 at reset. The atomic feedback primitive
  used by every graph-level cycle-break; `getLatencySamples()` returns
  1 and the master compiler aligns sibling dry/wet paths accordingly.
  Denormal flush applies — Jon Watte Canon:utilities §1 — because
  ARM worklets don't guarantee FTZ on subnormals.
- **Code** (`op_z1.worklet.js` 75–102): Float64 register `_z`; emit `z`
  then store `x[i]`; no-input branch flushes state to 0 after emitting
  the single stored sample; Watte flush at block-end.
- **Diff**: definition-exact. Float64 state vs Float32 I/O is
  deliberate (one cast/sample buys ~40 dB accumulated headroom inside
  tight feedback loops — same convention as dcBlock/onePole/svf).
- **Verdict**: PASS. Already covered by 12 qc tests (impulse, series
  composition, block-boundary, reset, denormal collapse, difference
  filter, missing-input flush, deterministic across instances). No debt.

### #91 sign — ✅ PASS (canonical-by-construction)

- **Primary source** — three-valued sign extractor. Standard `Math.sign`
  preserves -0 and propagates NaN; op deliberately collapses BOTH to 0
  (a meter reading NaN should not imply polarity, and -0 polarity is
  audibly meaningless).
- **Code** (`op_sign.worklet.js` 41–55): branchless ternary
  `x > 0 ? 1 : (x < 0 ? -1 : 0)` — NaN comparisons are false so NaN
  falls through both branches to 0; -0 matches `x < 0 == false` and
  `x > 0 == false` → 0.
- **Diff**: codified tweak vs `Math.sign` (NaN→0 and -0→0), documented
  in the op header and test-covered by the PCOF goldens.
- **Verdict**: PASS. No debt.

### #89 abs — ✅ PASS (canonical-by-construction)

- **Primary source** — absolute value: `y = |x|`. Uses `Math.abs`
  (IEEE-754 semantics: `|-0| = +0`, `|NaN| = NaN`). Deliberately does
  NOT flush denormals — a meter reading a genuinely tiny-but-real
  signal must pass through; denormal suppression is the downstream
  op's responsibility.
- **Code** (`op_abs.worklet.js` 44–58): zero-branch when input missing;
  otherwise straight `Math.abs(inCh[i])`. V8 inlines Math.abs to a
  single VABS / ANDPS so this is also the optimal form.
- **Diff**: definition-exact. NaN-preserve is deliberate (contrast with
  `sign` which collapses NaN to 0).
- **Verdict**: PASS. No debt.

## Group 9 — final primitives (polarity / domain-guard / topology)

Three ops. Same posture as Group 8: math-by-definition with no upstream
DSP paper. `polarity` is an IEEE-754 sign-bit flip, `clamp` is a pair of
`min`/`max`, `fanOut` is an explicit-topology passthrough splitter.

### #30 polarity — ✅ PASS (canonical-by-construction)

- **Primary source** — IEEE-754 negation: flipping the MSB of the float
  gives exact `-x` with zero precision loss (bit-exact null-test grade).
  Distinct from `scaleBy(-1)` by intent: polarity reads as a phase-flip
  in graph.json and is a bool at the UI, matching how consoles/DAWs
  expose the affordance.
- **Code** (`op_polarity.worklet.js` 56–82): setParam coerces via
  `!!(+v)` (so NaN → false pass-through); block loop is `-inCh[i]`
  when inverted, distinct-buffer copy otherwise (no aliasing — the
  emitter's downstream topology expects distinct output buffers).
- **Diff**: exact.
- **Verdict**: PASS. SHIP-CRITICAL for the null-test pattern
  (`dry + polarity(wet)`) the QC rack uses. No debt.

### #90 clamp — ✅ PASS (canonical-by-construction)

- **Primary source** — `y = min(max(x, lo), hi)`. Hard-corner domain
  guard (NOT a musical clipper — infinite-order break corners alias
  severely on audio-rate; use #12 saturate / #13 softLimit for that).
  Role: FB-loop runaway guard, param-domain wiring, floor/ceiling gate.
- **Code** (`op_clamp.worklet.js` 43–71): setParam NaN/Inf guard via
  `Number.isFinite`; hot loop is branchless-friendly ternary
  `x < lo ? lo : (x > hi ? hi : x)` (JIT typically emits minss/maxss);
  no-input branch emits zero pinned into `[lo, hi]`.
- **Diff**: exact. Degenerate `lo > hi` collapses to `lo` (user-visible
  error rather than silent surprise).
- **Verdict**: PASS. SHIP-CRITICAL for `ship_blockers.md` FB-runaway
  guard. No debt.

### #92 fanOut — ✅ PASS (canonical-by-construction)

- **Primary source** — topology primitive, not a DSP operation. Four
  identical passthroughs. Sandbox wiring already supports one-to-many,
  but fanOut makes "this is a distribution hub" a first-class object
  in graph.json (brick-audit workflow uses 3-of-4 outputs for probes
  while keeping the production path clean on output0).
- **Code** (`op_fanOut.worklet.js` 68–95): per-sample distribute
  `x = inCh[i]; o0[i]=x; o1[i]=x; o2[i]=x; o3[i]=x` (with per-output
  null-check so unwired branches are skipped); no-input branch
  zero-fills every wired output.
- **Diff**: exact. Output kind declared audio (the more permissive
  kind — can feed both audio and control inputs downstream), matching
  scaleBy/polarity convention.
- **Verdict**: PASS. Future per-branch trim noted as an additive
  param change, not tracked as debt (no DSP gap, pure schema
  expansion). No debt.

## Audit complete (49/49)

All shipped sandbox ops verified against primary sources where available,
or explicitly gap-documented where no canonical DSP reference exists
(primitives, trivial math, and topology-only ops). Group-level verdicts:

| Group | Ops | Result |
|---|---|---|
| Pre-audit batch | fdnCore + 4 loudness | 1 FIX, 2 PASS, 1 REWORK, 1 FIX |
| 1 instruments | goertzel, lpc, karplusStrong, waveguide, kellyLochbaum | 5 PASS (debt rows added) |
| 2 filters | filter, shelf, onePole, allpass, dcBlock | 5 PASS |
| 3 time/drive/mix | delay, saturate, softLimit, bitcrush, mix | 5 PASS (1 doc cite fix) |
| 4 dynamics | envelope, detector, gainComputer, curve, rms | 5 PASS (rms gap) |
| 5 meter/control/gen | peak, smooth, slew, glide, noise | 5 PASS (noise cite fix) |
| 6 mod/loudness/stereo | lfo, loudnessGate, correlation, quantizer, stereoWidth | 5 PASS |
| 7 triggered/arith | ramp, trigger, uniBi, scaleBy, combine | 5 PASS |
| 8 primitives A | gain, constant, z1, sign, abs | 5 PASS |
| 9 primitives B | polarity, clamp, fanOut | 3 PASS |

**Totals (this session):** 43 op rows + 5 pre-audit = 48 distinct ops
audited. (Catalog count 49 includes aliases; all unique shipped ops
covered.) All 8 QC gates green at every checkpoint. Debt ledger updated
where upgrade-paths exist (waveguide fractional delay, kellyLochbaum
V-K conical, rms BS.1770 windows, noise Kellett/Trammell sibling, etc.).

Next: sandbox_ops_catalog.md status-column sweep to reflect the audit pass.

## Post-audit ships

### #34 ladder — ✅ SHIPPED 2026-04-24 (research-first protocol)

- **Primary source opened** (WebFetch):
  `https://www.musicdsp.org/en/latest/Filters/24-moog-vcf.html`
  — "Moog VCF" C++ port by "mistertoast", a Huovilainen-inspired 4-pole
  LP cascade with inverted feedback + cubic soft-clip on y4.
- **Passage captured verbatim** in `op_ladder.worklet.js` header
  (`calc()` + `process()` blocks).
- **Deviations declared** (in header + below):
  1. Cutoff clamped to [20, Nyq−100] (cubic fit `p = f(1.8−0.8f)` breaks
     near Nyquist where `p` → 0 / negative).
  2. Resonance clamped to [0, 1.2] (cubic clip insufficient to bound
     state at certain cutoffs above this).
  3. Float64 state (vs Float32 C++) — JS convention for cascaded IIR.
  4. Watte denormal flush on all 8 state registers (Canon:utilities §1)
     — C++ source does not flush; ARM worklets without FTZ would stall.
  5. Defensive null-input → zero output (op contract).
- **Tests**: 11 math tests (LP passband/stopband, ≥18 dB/oct slope,
  resonance-increases-peak, self-osc bounded by cubic clip, reset,
  denormal flush, defensive null, extreme-cutoff/resonance clamping,
  determinism). All PASS (716/716 math checks green).
- **Golden blessed**: `db65386bb5d1585d…` at sr=48000 n=128.
- **Debt ledger row added**: BP/HP taps (Stilson §1 `BP = 3·y3−y4`,
  `HP = x−y4` algebra) as P2; Hötvinen DAFX04 fidelity upgrade
  (2×OS + per-stage tanh + half-sample FB delay) as P1.
- **Side fix caught**: `scripts/goldens/lufsIntegrator.golden.json`
  still held the pre-rework hash `d1d2b20a…` — the audit doc above
  (#53 row) documents the correct re-blessed hash `b244229144f2a741…`
  from the EBU Tech 3341 V4 rework. Updated the JSON to match.
  Unrelated to #34 ladder ship; cleanup of committed work.
- **QC gates**: all 8 green post-ship (100 goldens, 716 math, master,
  emit parity).

### #40 adsr — ✅ SHIPPED 2026-04-24 (research-first protocol)
- **Primary source**: `https://www.musicdsp.org/en/latest/Synthesis/189-fast-exponential-envelope-generator.html`
  (musicdsp archive #189, Christian Schoenebeck 2005). Canon:synthesis §12.
- **Catalog pointer corrected**: `sandbox_ops_catalog.md` pointed at
  Canon:dynamics §5, but §5 is the stereo-link peak compressor — not
  an envelope. Caught at research-first step (step 1 of protocol) before
  any code was written. Updated catalog row + Next-up queue entry.
- **Passage captured verbatim** in `op_adsr.worklet.js` header:
  `currentLevel += coeff * currentLevel` with
  `coeff = (log(end) - log(begin)) / (time * sr)`.
- **Declared deviations** (7): linear attack (log(0)-safe) instead of
  exponential; floor=1e-4 on decay/release endpoints (log-safe);
  decay targets `sustain`, release targets `floor`; gate-edge state
  machine (idle/A/D/S/R) wraps the single-segment recurrence; legato-
  safe retrigger (attack starts from current level); denormal flush
  on level register; defensive missing-gate → idle.
- **Code**: `src/sandbox/ops/op_adsr.{worklet.js,cpp.jinja,test.js}`.
  Registry entry added after `ladder`. Four params: attackMs (5 ms),
  decayMs (50 ms), sustain (0.7), releaseMs (200 ms). Single audio
  input `gate`, single audio output `out`.
- **Math invariants** (11): idle silence, rising-edge attack reaches
  ≥0.99 within attackMs, attack monotonic non-decreasing, decay
  settles at sustain, sustain holds steady, falling-edge releases
  toward 0, output in [0,1], reset → idle, legato retrigger peaks at
  ~1, missing-gate → silence, determinism.
- **Golden blessed**: `0e03440d65b927ca…` (scripts/goldens/adsr.golden.json).
- **Test caught**: initial retrigger test checked `last` sample; at
  attackMs=2 + decayMs=5 the 10 ms window landed on sustain (0.5),
  not peak. Fixed to track max across the buffer. A real bug in
  the test, not the code — the envelope was behaving correctly.
- **Debt ledger**: logged (a) true-exponential attack via bootstrap,
  (b) per-stage curve-shape param, (c) velocity/key-tracking ports,
  (d) AD/AR/AHDSR/DAHDSR mode variants, (e) release-coeff from
  current level. All P2.
- **QC gates**: all 8 green post-ship (102 goldens, 727 math, master,
  emit parity).

### #64 fft — ✅ SHIPPED 2026-04-24 (research-first protocol)
- **Primary source**: `https://en.wikipedia.org/wiki/Cooley%E2%80%93Tukey_FFT_algorithm`
  (iterative radix-2 pseudocode, citing Cormen/Leiserson/Rivest/Stein
  *Introduction to Algorithms* 3rd ed. Ch. 30).
- **Canon pointer rejected**: Catalog pointed at Canon:analysis §5 (QFT,
  Joshua Scholar 2003). §5 says "CODE. (external `qft.tar_1.gz`)" — a
  multi-file convolution-reverb-targeted archive with documented single-
  precision stability issues (1–6 LSB error at 2¹⁵). Not an appropriate
  baseline for a general sandbox FFT primitive. Caught at research-first
  step 1 before code was written. Textbook Cooley-Tukey is the right
  primary: math-by-definition (DFT) + canonical O(N log N) algorithm.
- **Passage captured verbatim** in `op_fft.worklet.js` header
  (bit-reverse-copy + iterative-fft pseudocode).
- **Declared deviations** (7): real input (imag init=0 during bit-reverse);
  split Float64 arrays (re/im) instead of complex; inline `ω←ω·ω_m`
  incremental twiddle (no table); streaming ring-buffer adapter (one FFT
  per N samples, held output between); size clamped to pow2 ∈ [16, 32768];
  defensive null I/O; no window function (rectangular).
- **Streaming-adapter design note**: initial v1 had off-by-one (FFT fired
  on sample N-1 which shifted spectrum emission by one bin). Caught by
  math suite (DC test, impulse test, sine-at-bin-4 test, Hermitian test
  all red). Fixed: FFT fires at top-of-loop BEFORE emit+write, so bin 0
  emits on the first sample after the fill completes. Both worklet and
  cpp.jinja updated.
- **Code**: `src/sandbox/ops/op_fft.{worklet.js,cpp.jinja,test.js}`.
  Registry entry added after `adsr`. One param (`size`, 1024 default),
  one input (`in`), two outputs (`real`, `imag`).
- **Math invariants** (11): DC → bin 0 = N, impulse → flat |X|=1, sine
  at bin 4 → peaks at ±k, Parseval energy conservation, silent before
  first FFT, pow2/range clamp, reset, null-input, missing-output no-op,
  determinism, Hermitian symmetry.
- **Golden blessed**: `5f70bf18a0860070…` (with default size=1024, the
  128-sample drive never fills the buffer → golden is all zeros and the
  hash is the zero-stream hash).
- **Debt ledger**: logged (a) precomputed twiddle LUT, (b) real-FFT
  Hermitian-packed optimisation, (c) split-radix/radix-4, (d) QFT as
  an alternative op (not upgrade), (e) Window + STFT pairing, (f) CZT.
  All P2.
- **QC gates**: all 8 green post-ship (104 goldens, 738 math, master,
  emit parity).
- **Gate-opener**: spectral-family (ifft/stft/convolution #65–#67) now
  unblocked.

### #65 ifft — ✅ SHIPPED 2026-04-24 (research-first protocol)
- **Primary source**:
  (a) Math-by-definition inverse DFT: `x[n] = (1/N)·Σ X[k]·e^(+2πikn/N)`.
  (b) Same Cooley-Tukey iterative radix-2 algorithm as #64 (Wikipedia /
  Cormen Ch. 30) — identical butterfly structure with twiddle sign
  flipped (+2π/m instead of −2π/m) and final 1/N scale. Declared math-
  by-definition per protocol step 1.
- **Passage**: already captured verbatim in `op_fft.worklet.js` header;
  `op_ifft.worklet.js` cross-references it and lists the two algorithmic
  deltas (sign + scale).
- **Declared deviations** (6): `theta = +2π/m` (positive); 1/N scale of
  real part to output buffer; complex input (two streams: `real`, `imag`)
  instead of one real stream; single real output (imag residue discarded
  — ≤ 1e-12 at N=1024 for real round-trips); same streaming adapter
  top-of-loop ordering as #64; pow2 clamp 16–32768.
- **Code**: `src/sandbox/ops/op_ifft.{worklet.js,cpp.jinja,test.js}`.
  Registry entry added after `fft`. One param (`size`), two inputs
  (`real`, `imag`), one output (`out`).
- **Math invariants** (11): IFFT of δ[k=0] → constant 1/N; IFFT of bin
  k=4 mirror → cosine at k=4; **fft→ifft round-trip reproduces arbitrary
  input ≤ 1e-4** (the null-test that motivated shipping the pair
  together); missing-imag → zero; silent before first IFFT; pow2 clamp;
  reset; missing-output no-op; determinism; zero spectrum → silence;
  unit cosine spectrum → `cos(2πn/N)`.
- **Golden blessed**: `076a27c79e5ace2a…` (default size=1024, 128-sample
  drive doesn't fill buffer → all-zero stream, matches the zero-hash).
- **Debt ledger**: logged (a) full complex output port, (b) real-IFFT
  Hermitian-packed optimisation, (c) shared twiddle LUT with #64,
  (d) overlap-add adapter pairing with stft #66. All P2.
- **QC gates**: all 8 green first try (106 goldens, 749 math, master,
  emit parity). No side-catches.
- **Spectral round-trip closed**: fft→ifft null-test now usable as
  a harness primitive for downstream spectral ops (stft, convolution,
  freeze, smear).

### #66 stft — ✅ SHIPPED 2026-04-24 (research-first protocol)
- **Primary source**: Julius O. Smith, "Spectral Audio Signal
  Processing" (SASP), Stanford CCRMA,
  `https://ccrma.stanford.edu/~jos/sasp/Mathematical_Definition_STFT.html`.
  Definition `X_m(ω) = Σ x(n)·w(n − mR)·e^{−jωn}` and COLA condition
  captured verbatim. Secondary: Harris 1978 "On the use of windows
  for harmonic analysis with the discrete Fourier transform" (IEEE)
  for the Hann window form.
- **Declared deviations** (7): finite sum over 0..M−1 (not ±∞);
  discrete ω on the bin grid; Hann hard-wired (other windows in debt
  ledger); hop-driven streaming adapter (one FFT per R samples, not
  per sample as strict STFT implies); window copy-multiply into FFT
  scratch on each fire (redundant vs. sliding but clearer); size/hop
  clamps (pow2 16–32768, hop ∈ [1, size]); defensive I/O.
- **Code**: `src/sandbox/ops/op_stft.{worklet.js,cpp.jinja,test.js}`.
  Registry entry added before `ifft`. Two params (size=1024, hop=256),
  one input (`in`), two outputs (`real`, `imag`). Cooley-Tukey FFT
  inlined (same butterfly as #64 for self-containment).
- **Math invariants** (11): Hann endpoints=0, centre=1, symmetric;
  silent input → silent spectrum; DC input → bin 0 = Σ w[n] (Hann DC
  gain); sine at bin 8 → bin 8 is max of lower-half spectrum;
  hop-timing verified (bin-0 re-emit every `hop` samples); pow2+hop
  clamp; reset; null I/O safety; determinism.
- **Golden blessed**: `5f70bf18a0860070…` (zero-stream hash; at
  default size=1024 the 128-sample drive never fills the ring).
- **Side-catches** (2):
  1. First attempt had same fire-at-bottom off-by-one as #64. Caught
     by `DC → bin 0 peak` and `sine at bin 8 peak` tests. Fixed by
     hoisting fire-check to top-of-loop. Pattern is now consistent
     across #64/#65/#66 — worth codifying in the ship protocol.
  2. Initial sine-at-bin-8 test required non-peak bins < 0.5·peak,
     which a Hann main-lobe width of ~4 bins trivially violates at
     adjacent bins. Relaxed to `peak is the maximum of the lower
     half-spectrum` — the correct physical check.
- **Debt ledger**: logged (a) `window` enum param (rect/hamming/
  blackman/kaiser-bessel/flat-top), (b) COLA verification at construct
  time, (c) inverse STFT op for phase-vocoder, (d) true sliding STFT
  via FFT-shift recurrence, (e) zero-padding + sub-bin interpolation.
  All P2.
- **QC gates**: all 8 green post-ship (108 goldens, 760 math, master,
  emit parity).
- **Protocol observation**: three consecutive spectral ops (#64, #65,
  #66) all required the same top-of-loop fire-ordering fix after
  initial bottom-of-loop attempts. Adding this as a reusable pattern
  note: *any streaming op that fires a block transform on a counter
  threshold MUST check the threshold before emit+ingest, not after.*
  Filed under "sandbox op patterns" for the next spectral/block op.
