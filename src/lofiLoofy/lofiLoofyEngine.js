// lofiLoofyEngine.js — Lo-fi degradation + movement + nostalgia plugin.
//
// ─────────────────────────────────────────────────────────────────────────
// GOVERNED BY: /DEV_RULES.md — read it before editing this file.
// BYPASS BEHAVIOR: phase-safe, 36 ms latency (see getLatency()).
// ─────────────────────────────────────────────────────────────────────────
//
// Standard rack contract (see DEV_RULES B1):
//   { input, output, chainOutput, setIn/setOut/setMix/setBypass,
//     isBypassed, applyBulk, dispose, getLatency, ... }
//
// Sound philosophy:
//   This is NOT a distortion plugin. Saturation is supporting only. The
//   identity is movement (drift, flutter, Dream LFO), media wear (dust,
//   dropouts, bandwidth), and emotional softening — not aggression.
//
// Topology (authoritative — DEV_RULES I1: if you change the graph, update
// this comment in the SAME commit):
//
//   input ─► inGain ┬─► dryCompensate(36ms) ─► dryGain ──────────────────┐
//                   │                                                    │
//                   └─► toneTilt → toneLP → lowSatPre → satShape →       │
//                       lowSatPost → subHum → lowBloom → ageHP →         │
//                       ageCrush → ageLP → bwLP → bwHP → tapeDelay →     │
//                       bitsShaper → rateLP → glueComp → wetTrim →       │
//                       ┬─► compDryDelay(6ms) → compDry ────► compMix ───┤
//                       └─► crushShape → crushComp → crushMakeup →       │
//                           vibeBody → pumpGain → compWet ── → compMix → │
//                                                          ↓            │
//                                        compMix → boomShelf → wetGain ─┤
//                       wetTrim ─► reverbSend → dreamReverb →           │
//                                  reverbReturn ────────────► wetGain ──┤
//                                                                       ▼
//   noiseSrc ─► hissFilters ─► noiseGain ┐                            preOut
//   gritSrc  ─► crackleHP   ─► crackleGain ┴─► dustBus ─► wetGain       │
//                                                                       │
//   preOut ─► widthIn → widener → widthOut ─► dropDuck ─► outGain ─► output
//
// Dream LFO: a smoothed sine modulator with diffusion-style trailing.
// It does NOT add reverb to audio — it smooths the modulation signal
// itself so destinations move in soft, lingering arcs rather than steps.
//
// DEV_RULES B4 — Dream targets must NOT dual-write any AudioParam the user
// directly controls. `mix` target currently writes dryGain/wetGain — this
// is flagged for migration to a dedicated `mixMod` series node.

export function createLofiLoofyEngine(ctx) {
  // ── I/O ──────────────────────────────────────────────────────────────
  const input      = ctx.createGain();
  const preOut     = ctx.createGain();   // dry+wet sum (pre-duck)
  const output     = ctx.createGain();   // public output (post-duck)
  // Silent start, then linear fade-in. Hides the transient created by the
  // UI's initial parameter burst (WaveShaper curve rebuilds in setAge /
  // setTexture / setCharacter cannot be ramped — replacing the .curve takes
  // effect instantly, which sounds like a click). 40 ms is below the
  // perceptual threshold for an attack envelope but long enough to cover
  // all the setTargetAtTime settling.
  // Silent for a hold window, then linear fade to unity. The hold covers
  // the UI's synchronous burst of setXxx calls (each uses
  // setTargetAtTime with tau≈0.05 s → ~150 ms to settle) and any
  // WaveShaper curve swaps in setAge / setTexture / setCharacter (those
  // are instantaneous and cannot be ramped). Total silence window 180 ms,
  // then 60 ms ramp to 1. Imperceptible on a plugin load, inaudible tick.
  output.gain.value = 0;
  {
    const t0 = ctx.currentTime;
    output.gain.setValueAtTime(0, t0);
    output.gain.setValueAtTime(0, t0 + 0.18);
    output.gain.linearRampToValueAtTime(1, t0 + 0.24);
  }
  // inGain = master input trim. Starts at unity and feeds BOTH the dry and
  // wet legs, so raising IN boosts the mix balance point equally — the
  // MIX knob keeps its proportional blend against the same reference
  // level the wet chain sees.
  const inGain     = ctx.createGain();    inGain.gain.value     = 1.0;
  const outGain    = ctx.createGain();    outGain.gain.value    = 1.0;
  const dryGain    = ctx.createGain();    dryGain.gain.value    = 0.0;
  const wetGain    = ctx.createGain();    wetGain.gain.value    = 1.0;
  const bypassGain = ctx.createGain();    bypassGain.gain.value = 0.0;
  const mixSum     = ctx.createGain();    mixSum.gain.value     = 1.0;

  for (const n of [input, output, preOut, inGain, outGain, dryGain, wetGain,
                   bypassGain, mixSum]) {
    n.channelCountMode = 'max';
    n.channelInterpretation = 'speakers';
  }

  // Topology — proper equal-power dry/wet crossfade (no comb filtering):
  //   input ─► inGain ┬─► dryGain ────────────────────────► preOut   (dry, cos(mix·π/2))
  //                    └─► [wet chain] ─► wetGain ─► preOut          (wet, sin(mix·π/2))
  // Dry taps AFTER inGain so the IN trim affects both legs equally —
  // the MIX knob always blends against the same input reference,
  // no level-offset between dry and wet as IN is adjusted.
  dryGain.gain.value = 1.0;
  input.connect(inGain);
  // Time-align the dry leg with the wet chain. The wet path carries the
  // tape-delay baseline (~30 ms, needed for drift/flutter modulation
  // headroom) plus the parallel comp stage (~6 ms). Without a matching
  // delay on dry, MIX at 50% sums dry + 36 ms-late wet = audible slapback.
  // This makes the plugin add ~36 ms of latency overall — a non-issue on
  // a mix bus, minor on live monitoring.
  const dryCompensate = ctx.createDelay(0.08);
  dryCompensate.delayTime.value = 0.036;
  inGain.connect(dryCompensate);
  dryCompensate.connect(dryGain);
  dryGain.connect(preOut);
  // Final post-merge duck node — Drop knob controls this so dips affect
  // the WHOLE signal (dry + wet), not just the wet path.
  const dropDuck = ctx.createGain(); dropDuck.gain.value = 1.0;
  // preOut → dropDuck → output, but the WIDENER is wired in between
  // (see Width section). This keeps dry+wet phase-aligned: widening is
  // applied to the SUM, not just the wet leg, so Mix doesn't comb-filter.

  // ── Tone shaping (tilt + LP) ─────────────────────────────────────────
  // Tone knob = single perceptual slider:
  //   low  → darker (LP cuts top, low shelf lift)
  //   high → brighter (LP opens, top shelf gently lifts)
  const toneTilt = ctx.createBiquadFilter();
  toneTilt.type = 'lowshelf';
  toneTilt.frequency.value = 250;
  toneTilt.gain.value = 0;

  const toneLP = ctx.createBiquadFilter();
  toneLP.type = 'lowpass';
  toneLP.frequency.value = 8200;          // milky default top
  toneLP.Q.value = 0.4;                   // soft slope, no resonance bump

  // ── Subtle saturation (supporting, not identity) ─────────────────────
  // Soft tanh — used to add only warmth/body, never crunch.
  const satShape = ctx.createWaveShaper();
  satShape.oversample = '2x';
  function buildSatCurve(amount) {
    // Warm "lofi crush": soft tanh + a touch of asymmetry (even harmonics
    // = tube/tape warmth) + gentle quantization shoulder for body. Stays
    // gentle — never crunch.
    const N = 1024, c = new Float32Array(N);
    const k    = 1 + amount * 1.6;          // gentle drive
    const asym = amount * 0.28;             // even-harmonic warmth (tube-y)
    const crush = amount * 0.006;           // barely-there crush — flavor only
    const denom = Math.tanh(k);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const xa = x + asym * x * x * Math.sign(x);
      let y = Math.tanh(xa * k) / denom;
      // crush blended in at only 15% — adds body, not bitcrush sound
      if (crush > 0) y = Math.round(y / crush) * crush * 0.15 + y * 0.85;
      c[i] = Math.max(-1, Math.min(1, y));
    }
    return c;
  }
  // Start with a hint of warmth even at Age=0
  satShape.curve = buildSatCurve(0.10);

  // ── Bandwidth reduction (the "small speaker / aged tape" feel) ───────
  const bwLP = ctx.createBiquadFilter();
  bwLP.type = 'lowpass';
  bwLP.frequency.value = 16000;
  bwLP.Q.value = 0.5;

  const bwHP = ctx.createBiquadFilter();
  bwHP.type = 'highpass';
  bwHP.frequency.value = 35;
  bwHP.Q.value = 0.5;

  // ── Modulated delay (drift + flutter — tape pitch wobble) ────────────
  // Two sine LFOs sum into a tiny delay-time modulation. Drift = slow,
  // wide; flutter = fast, narrow. Together they produce gentle pitch
  // wobble — never seasick.
  // Tape delay for drift+flutter+Dream(pitch) modulation. The baseline
  // must exceed the maximum negative excursion of the combined LFOs, or
  // delayTime clamps at 0 and produces a click at every LFO bottom. With
  // current ranges (drift ±8 ms knob, flutter ±4 ms, age ±1.3 ms, dream
  // pitch ±6 ms → worst case ~19 ms negative swing), baseline 25 ms with
  // a 60 ms buffer gives headroom both directions.
  const tapeDelay = ctx.createDelay(0.08);
  tapeDelay.delayTime.value = 0.030;

  const driftLFO  = ctx.createOscillator();
  driftLFO.type   = 'sine';
  driftLFO.frequency.value = 0.28;         // slower, dreamier wow
  const driftGain = ctx.createGain();
  driftGain.gain.value = 0.0;

  const flutterLFO = ctx.createOscillator();
  flutterLFO.type  = 'sine';
  flutterLFO.frequency.value = 5.2;        // softer, less buzzy shimmer
  const flutterGain = ctx.createGain();
  flutterGain.gain.value = 0.0;

  driftLFO.connect(driftGain);
  flutterLFO.connect(flutterGain);
  driftGain.connect(tapeDelay.delayTime);
  flutterGain.connect(tapeDelay.delayTime);
  driftLFO.start();
  flutterLFO.start();

  // ── Dropouts (random soft gain dips) ─────────────────────────────────
  const dropoutGain = ctx.createGain(); dropoutGain.gain.value = 1.0;
  let dropoutAmt = 0;                      // 0..1
  let dropoutTimer = null;
  function fireStutter() {
    const g = dropDuck.gain;       // duck the WHOLE signal (post dry+wet sum)
    let t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    // Number of stutter "skips" in this burst — 1 at low Drop, up to 4 high
    const burst = 1 + Math.floor(dropoutAmt * 3 * Math.random() + 0.5);
    for (let i = 0; i < burst; i++) {
      // Real audio drop — up to ~95% gone (near-silence)
      const depth = 0.45 + dropoutAmt * 0.50 + Math.random() * 0.05;
      const dur   = 0.05 + Math.random() * 0.10;        // 50–150ms each dip
      const target = Math.max(0, 1 - depth);
      // Soft attack/release so dips feel mechanical not clicky
      g.linearRampToValueAtTime(target, t + 0.008);
      g.linearRampToValueAtTime(target, t + dur * 0.7);
      g.linearRampToValueAtTime(1.0,    t + dur);
      // Gap before next stutter in the burst
      t += dur + 0.06 + Math.random() * 0.12;
    }
  }
  function scheduleNextDropout() {
    if (dropoutTimer) clearTimeout(dropoutTimer);
    if (dropoutAmt <= 0.005) return;
    // Much more frequent at higher amounts — clearly hearable rhythm of skips
    const meanGap = 4.5 - dropoutAmt * 4.0;        // 4.5 → 0.5 sec
    const wait    = meanGap * (0.4 + Math.random() * 0.8);
    dropoutTimer = setTimeout(() => {
      // Same late-cancel guard as crackle: callback may fire after
      // dropouts knob was set to 0.
      if (dropoutAmt <= 0.005) { dropoutTimer = null; return; }
      fireStutter();
      scheduleNextDropout();
    }, wait * 1000);
  }

  // ── Dust (noise + crackle layer) ─────────────────────────────────────
  // Continuous loop of pre-rendered colored noise + occasional crackle pops.
  function makeNoiseBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Warm tape hiss = pink (Voss-McCartney) blended with brown (integrated
      // white). Much warmer than plain pink — sits like real tape noise.
      let b0 = 0, b1 = 0, b2 = 0, brown = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        // pink components
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        const pink = (b0 + b1 + b2 + w * 0.1848) * 0.14;
        // brown noise — integrated white, leaky to prevent DC drift
        brown = (brown + w * 0.025) * 0.996;
        // mostly brown for warmth, a touch of pink for air
        d[i] = brown * 1.6 + pink * 0.35;
      }
    }
    return buf;
  }
  const noiseBuf  = makeNoiseBuffer(4);
  const noiseSrc  = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop   = true;
  // Soft tape hiss band — rolled top, gentle low cut, never sibilant
  const noiseHP = ctx.createBiquadFilter();
  noiseHP.type = 'highpass'; noiseHP.frequency.value = 280; noiseHP.Q.value = 0.5;
  const noiseLP = ctx.createBiquadFilter();
  noiseLP.type = 'lowpass';  noiseLP.frequency.value = 5500; noiseLP.Q.value = 0.5;
  const noiseTilt = ctx.createBiquadFilter();
  noiseTilt.type = 'highshelf'; noiseTilt.frequency.value = 3500; noiseTilt.gain.value = -6;
  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0;
  noiseSrc.connect(noiseHP); noiseHP.connect(noiseLP);
  noiseLP.connect(noiseTilt); noiseTilt.connect(noiseGain);
  noiseSrc.start();

  // Grit layer — a continuous "rough" noise source that replaces the
  // old discrete crackle pops. Pre-rendered buffer contains sparse
  // impulse-like spikes embedded in low-level pink noise, baked in so
  // there are no envelope boundaries for the ear to read as ticks.
  // Dust knob only scales the output gain of this steady stream.
  let crackleAmt = 0;                  // name kept for compatibility
  let crackleTimer = null;             // unused, kept to avoid refactor churn
  function makeGritBuffer(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        // Pink-ish bed, quiet
        b0 = 0.99765 * b0 + w * 0.0990460;
        b1 = 0.96300 * b1 + w * 0.2965164;
        b2 = 0.57000 * b2 + w * 1.0526913;
        const pink = (b0 + b1 + b2 + w * 0.1848) * 0.08;
        // Occasional baked-in "spike" — statistically sparse so the
        // buffer sounds like irregular surface crackle, not a pulse train.
        // The attack/decay is a few samples → sub-ms, but embedded in a
        // continuous stream so there's no silence→event boundary.
        let spike = 0;
        if (Math.random() < 0.0012) {   // ~53 spikes/sec @ 44.1 kHz
          spike = (Math.random() - 0.5) * 0.55 * Math.pow(Math.random(), 3);
        }
        d[i] = pink + spike;
      }
    }
    return buf;
  }
  const gritBuf = makeGritBuffer(6);
  const gritSrc = ctx.createBufferSource();
  gritSrc.buffer = gritBuf;
  gritSrc.loop = true;
  const crackleGain = ctx.createGain(); crackleGain.gain.value = 0;
  gritSrc.connect(crackleGain);
  gritSrc.start();
  // No-op stub so legacy callers (setDust, applyAge) still compile.
  function scheduleNextCrackle() { /* grit is continuous; nothing to schedule */ }
  // Filter chain retained for tonal shaping of the grit stream.
  const crackleHP = ctx.createBiquadFilter();
  crackleHP.type = 'highpass'; crackleHP.frequency.value = 1200; crackleHP.Q.value = 0.5;
  // Rewire the grit stream through the HP for tonal shaping, then into
  // crackleGain (the Dust-scaled output). The old tapping of noiseSrc
  // into this path is gone — crackle no longer shares a source with hiss.
  gritSrc.disconnect();
  gritSrc.connect(crackleHP); crackleHP.connect(crackleGain);

  // ── Glue (soft compression + tiny saturation) ────────────────────────
  const glueComp = ctx.createDynamicsCompressor();
  glueComp.threshold.value = -20;
  glueComp.knee.value      = 18;
  glueComp.ratio.value     = 1.8;       // intentionally low — glue, not crush
  glueComp.attack.value    = 0.012;
  glueComp.release.value   = 0.18;

  // ── Width: Haas-style cross-channel delay widener ───────────────────
  // Real stereo widening (works on mono too): each channel gets a small
  // delayed copy of the OTHER channel mixed in. Widens perceptually via
  // inter-aural time difference. width=1 = passthrough, width>1 = wider.
  // The widening level is what we modulate (sideGain alias).
  const widthIn  = ctx.createGain(); widthIn.gain.value  = 1.0;
  const widthOut = ctx.createGain(); widthOut.gain.value = 1.0;
  const wSplit   = ctx.createChannelSplitter(2);
  const wMerge   = ctx.createChannelMerger(2);
  const wDelayL  = ctx.createDelay(0.05); wDelayL.delayTime.value = 0.013; // 13ms
  const wDelayR  = ctx.createDelay(0.05); wDelayR.delayTime.value = 0.011; // 11ms (asym = nicer image)
  const wDirectL = ctx.createGain();      wDirectL.gain.value = 1.0;
  const wDirectR = ctx.createGain();      wDirectR.gain.value = 1.0;
  const wCrossL  = ctx.createGain();      wCrossL.gain.value  = 0.0;  // delayed-R into L
  const wCrossR  = ctx.createGain();      wCrossR.gain.value  = 0.0;  // delayed-L into R

  // Direct L→L, R→R + delayed cross-feed for widening + un-delayed
  // cross-feed for narrowing toward mono (width<1).
  const wMonoL = ctx.createGain(); wMonoL.gain.value = 0.0;  // R into L (no delay)
  const wMonoR = ctx.createGain(); wMonoR.gain.value = 0.0;  // L into R (no delay)
  widthIn.connect(wSplit);
  wSplit.connect(wDirectL, 0); wDirectL.connect(wMerge, 0, 0);
  wSplit.connect(wDirectR, 1); wDirectR.connect(wMerge, 0, 1);
  // delayed cross-feed for widening (>1)
  wSplit.connect(wDelayL, 0); wDelayL.connect(wCrossR); wCrossR.connect(wMerge, 0, 1);
  wSplit.connect(wDelayR, 1); wDelayR.connect(wCrossL); wCrossL.connect(wMerge, 0, 0);
  // straight cross-feed for narrowing (<1)
  wSplit.connect(wMonoR, 0); wMonoR.connect(wMerge, 0, 1);
  wSplit.connect(wMonoL, 1); wMonoL.connect(wMerge, 0, 0);
  wMerge.connect(widthOut);

  // sideGain alias = the cross-feed level. Dream 'width' target writes here.
  const sideGain = { gain: { setTargetAtTime: (v, t, tau) => {
    wCrossL.gain.setTargetAtTime(v * 0.45, t, tau);
    wCrossR.gain.setTargetAtTime(v * 0.45, t, tau);
  } } };

  // ── Noise sum bus (passthrough for the main chain) ───────────────────
  // Dust no longer merges into the main signal chain — it's now a fully
  // independent texture layer routed straight to wetGain below. This
  // keeps hiss/grit OUT of glueComp, wetTrim, and the parallel comp
  // stage (which was causing metallic comb-filtering artifacts), so
  // dust stays lush and pink-noise-shaped no matter what the comp
  // settings are.
  const noiseSumNode = ctx.createGain(); noiseSumNode.gain.value = 1.0;

  // ── Tape low-end bloom: lift lows into the saturator, cut after ──────
  // This is the classic tape-warmth trick: pushing the low-mids harder
  // through the soft saturator generates 2nd-harmonic body in the bass,
  // then a complementary low cut keeps the level neutral, leaving the
  // harmonics behind. = thick low-end glow without mud.
  const lowSatPre = ctx.createBiquadFilter();
  lowSatPre.type = 'lowshelf'; lowSatPre.frequency.value = 220; lowSatPre.gain.value = 7.0;
  const lowSatPost = ctx.createBiquadFilter();
  lowSatPost.type = 'lowshelf'; lowSatPost.frequency.value = 220; lowSatPost.gain.value = -3.0;
  // Tape low-bloom band: classic 80–150 Hz body
  const lowBloom = ctx.createBiquadFilter();
  lowBloom.type = 'peaking'; lowBloom.frequency.value = 110;
  lowBloom.Q.value = 0.8; lowBloom.gain.value = 3.0;
  // Sub-hum resonance — the warm "tape-machine body" 50-65 Hz
  const subHum = ctx.createBiquadFilter();
  subHum.type = 'peaking'; subHum.frequency.value = 60;
  subHum.Q.value = 1.2; subHum.gain.value = 2.5;

  // ── Age chain — dedicated HP + bit crush after saturation ────────────
  // Age is a single-character effect: soft sat (shared satShape) +
  // a sweepable highpass that thins detail as the sound "ages" + a
  // gentle bit-crush stage for lo-fi grit. Age no longer touches
  // drift / flutter / tone LP / bandwidth / hiss — one knob, one
  // coherent flavor.
  const ageHP = ctx.createBiquadFilter();
  ageHP.type = 'highpass';
  ageHP.frequency.value = 20;    // effectively off at Age=0
  ageHP.Q.value = 0.5;
  // Bit-crush via WaveShaper with a quantizing curve. At amount=0 the
  // curve is the identity (bypass-ish); at amount=1 roughly 6-bit effective.
  const ageCrush = ctx.createWaveShaper();
  ageCrush.curve = buildCrushCurve(0);
  ageCrush.oversample = '2x';
  // Smoothing lowpass AFTER the crush — tames the harsh high-frequency
  // quantization noise that bit reduction produces. Sweeps with Age:
  // wide open (16 kHz) at Age=0, closed down to ~5 kHz at full Age so
  // the more you crush, the more the nasty aliased top gets removed.
  const ageLP = ctx.createBiquadFilter();
  ageLP.type = 'lowpass';
  ageLP.frequency.value = 16000;
  ageLP.Q.value = 0.5;
  function buildCrushCurve(amount) {
    // amount 0..1 → step count 65536 → 64 (monotonic quantize)
    const N = 2048, c = new Float32Array(N);
    const maxSteps = 65536, minSteps = 64;
    const steps = Math.round(maxSteps * Math.pow(minSteps / maxSteps, amount));
    const mix = Math.min(1, amount * 1.4); // fade in the crushed signal
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const q = Math.round(x * steps) / steps;
      c[i] = x * (1 - mix) + q * mix;
    }
    return c;
  }

  // ── Wire main signal path ────────────────────────────────────────────
  inGain.connect(toneTilt);
  toneTilt.connect(toneLP);
  toneLP.connect(lowSatPre);
  lowSatPre.connect(satShape);
  satShape.connect(lowSatPost);
  lowSatPost.connect(subHum);
  subHum.connect(lowBloom);
  // Age chain sits between the saturation body and the bandwidth block.
  lowBloom.connect(ageHP);
  ageHP.connect(ageCrush);
  ageCrush.connect(ageLP);
  ageLP.connect(bwLP);
  bwLP.connect(bwHP);
  bwHP.connect(tapeDelay);
  tapeDelay.connect(dropoutGain);
  dropoutGain.connect(noiseSumNode);          // signal joins noise here

  // ── SAMPLE block: BITS (quantization) + RATE (bandlimit) ─────────────
  // Sits between the noise-sum passthrough and GLUE so the comp stage
  // reacts to the already-crushed signal — matches how SP-1200 style
  // chains work (sample → compress, not the other way around).
  //
  // BITS: WaveShaper with a quantizer curve rebuilt on setBits.
  //   OFF = linear passthrough.
  // RATE: Biquad lowpass at the Nyquist of the target rate. Gives the
  //   muffled high-cut character of classic sampler downsampling
  //   without the ScriptProcessor audio-thread risk (which was
  //   glitching hard). Not aliased like true decimation, but stable
  //   and very lofi-sounding.
  const bitsShaper = ctx.createWaveShaper();
  function buildBitsCurve(bits) {
    const N = 2048;
    const arr = new Float32Array(N);
    if (!bits || bits >= 16) {
      for (let i = 0; i < N; i++) arr[i] = (i / (N - 1)) * 2 - 1;
      return arr;
    }
    const half = Math.pow(2, bits) / 2;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      arr[i] = Math.round(x * half) / half;
    }
    return arr;
  }
  bitsShaper.curve = buildBitsCurve(0);

  const rateLP = ctx.createBiquadFilter();
  rateLP.type = 'lowpass';
  rateLP.Q.value = 0.707;
  rateLP.frequency.value = 20000;   // OFF = effectively bypass

  noiseSumNode.connect(bitsShaper);
  bitsShaper.connect(rateLP);
  rateLP.connect(glueComp);
  // Wet-path makeup trim. The internal chain (low-shelf into saturator,
  // sub/bloom peaks, widener cross-feed) produces roughly +5 dB of
  // perceived-level boost vs. dry. This static trim pulls that back so
  // the Mix knob is a true dry/wet crossfade — flipping to full-wet
  // doesn't feel louder than bypass.
  const wetTrim = ctx.createGain();
  wetTrim.gain.value = 0.56;            // ≈ −5 dB
  glueComp.connect(wetTrim);

  // ── Parallel CRUSH / PUMP compressor stage ───────────────────────────
  // Sits between wetTrim and wetGain. Taps off wetTrim into a dry path
  // and a comp path (crush saturation → fast FET-style compressor →
  // pump ducker). BLEND crossfades them. VIBE softens the comp and
  // slows the pump for a dreamier feel.
  //
  // Signal:
  //   wetTrim ┬─► compDry ──────────────────────────► compMix ► wetGain
  //           └─► crushShape ► crushComp ► pumpGain ► compWet ► compMix
  //
  // reverbSend still taps wetTrim directly (pre-comp), so the reverb
  // tail isn't squashed by the parallel compressor.
  // Shared state for the comp stage (read by setters when rebuilding curve).
  let _crushAmt     = 0;
  let _pumpAmt      = 0;
  let _vibeOn       = false;
  let _glueAmt      = 0;         // last setGlue input
  let _compBlendAmt = 0.5;       // last setCompBlend input
  let _compOff      = false;     // whole-stage bypass flag

  // Time-align the dry leg with the comp leg — Web Audio's
  // DynamicsCompressorNode has ~6 ms of internal lookahead, so without
  // this delay the dry+wet sum combs and the signal sounds metallic /
  // phased out. Matches standard parallel-compression best practice.
  const compDryDelay = ctx.createDelay(0.02);
  compDryDelay.delayTime.value = 0.006;
  const compDry = ctx.createGain(); compDry.gain.value = 1.0;   // dry parallel leg
  const compWet = ctx.createGain(); compWet.gain.value = 0.0;   // comp parallel leg
  const compMix = ctx.createGain(); compMix.gain.value = 1.0;   // sum point

  // CRUSH saturation (static waveshaper, curve rebuilt on setCrush).
  // oversample='none' — 2x/4x oversampling introduces anti-aliasing filter
  // latency (~1–3 ms at 44.1 k) that the compDryDelay can't account for,
  // which caused comb filtering in the BLEND crossfade. The tiny bit of
  // extra aliasing is on-brand for lo-fi anyway.
  const crushShape = ctx.createWaveShaper();
  crushShape.oversample = 'none';
  function buildCrushSatCurve(drive, vibe) {
    // drive 0..1. Vibe adds slight 2nd-harmonic asymmetry for warmth.
    // CRITICAL: at drive=0 the curve MUST be pure linear (y=x) so the wet
    // leg is transparent when CRUSH is off — otherwise tanh(x)/tanh(1)
    // pre-colors dust/noise and makes it buzzy even at zero drive.
    const N = 1024;
    const arr = new Float32Array(N);
    const d = Math.max(0, Math.min(1, drive));
    const k = d * 4.0;
    const norm = Math.tanh(1 + k) || 1;
    // Juicier VIBE: heavier 2nd-harmonic bloom. Also gets a small baseline
    // even at drive=0 when vibe is on so flipping VIBE is audibly "warmer"
    // immediately, not just at higher CRUSH.
    const h2 = vibe ? (0.05 + 0.14 * d) : 0.0;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      const sat = Math.tanh(x * (1 + k)) / norm;
      // Blend from linear (d=0) to saturated (d=1). Transparent at zero.
      const y = x * (1 - d) + sat * d;
      arr[i] = y + h2 * (y * y - 0.5);
    }
    return arr;
  }
  crushShape.curve = buildCrushSatCurve(0, false);

  // CRUSH compressor — fast, FET-ish. Threshold/ratio scale with knob.
  const crushComp = ctx.createDynamicsCompressor();
  crushComp.threshold.value = -12;  // idle: barely touching
  crushComp.knee.value      = 6;
  crushComp.ratio.value     = 1;    // idle: no comp
  crushComp.attack.value    = 0.002;
  crushComp.release.value   = 0.09;

  // PUMP — free-running sine LFO modulating a gain node for that gentle
  // dreamy breathing. Oscillator → scaler → gain.gain (additive AudioParam
  // automation around baseline 1.0).
  const pumpGain = ctx.createGain();
  pumpGain.gain.value = 1.0;
  const pumpLFO = ctx.createOscillator();
  pumpLFO.type = 'sine';
  pumpLFO.frequency.value = 0.75;   // slower default for a breathing feel
  const pumpScale = ctx.createGain();
  pumpScale.gain.value = 0;          // depth = 0 at start
  pumpLFO.connect(pumpScale);
  pumpScale.connect(pumpGain.gain);  // additive modulation on gain param
  pumpLFO.start();

  // CRUSH makeup — compensates the level drop when the compressor is
  // actually squashing. Without it, raising CRUSH makes the wet leg
  // quieter than the dry leg and BLEND stops sounding parallel.
  const crushMakeup = ctx.createGain(); crushMakeup.gain.value = 1.0;

  // VIBE body bump — peaking filter on the comp wet leg. Flat when VIBE
  // is off (gain = 0 dB). When VIBE engages, lifts the 220 Hz low-mid
  // area for that "fat lo-fi" body you can't get from a shelf alone.
  const vibeBody = ctx.createBiquadFilter();
  vibeBody.type = 'peaking';
  vibeBody.frequency.value = 220;
  vibeBody.Q.value = 0.9;
  vibeBody.gain.value = 0;

  // ── Independent DUST bus ─────────────────────────────────────────────
  // Texture layer that bypasses the entire wet processing chain. Hiss +
  // grit sum here, get a gentle tone shape, and go straight to wetGain
  // so they ride the Mix knob but never get compressed / parallel-comped
  // / wet-trimmed. Solves the "metallic phased dust" problem caused by
  // running noise through the comp stage.
  const dustBus = ctx.createGain(); dustBus.gain.value = 1.0;
  noiseGain.connect(dustBus);
  crackleGain.connect(dustBus);
  dustBus.connect(wetGain);

  // Wire the comp stage.
  wetTrim.connect(compDryDelay);
  compDryDelay.connect(compDry);
  wetTrim.connect(crushShape);
  crushShape.connect(crushComp);
  crushComp.connect(crushMakeup);
  crushMakeup.connect(vibeBody);
  vibeBody.connect(pumpGain);
  pumpGain.connect(compWet);
  compDry.connect(compMix);
  compWet.connect(compMix);

  // ── BOOM: post-comp low-shelf for weight ─────────────────────────────
  // Lifts the bottom end AFTER the compressor so pumped/crushed signals
  // still feel full. Sits before wetGain so it respects Mix/Bypass, and
  // between compMix and wetGain so it does NOT boost the dust bus or
  // the reverb return (no boomy hiss, no rumbly reverb).
  const boomShelf = ctx.createBiquadFilter();
  boomShelf.type = 'lowshelf';
  boomShelf.frequency.value = 120;
  boomShelf.gain.value = 0;           // dB, setBoom ramps this 0..+8
  compMix.connect(boomShelf);
  boomShelf.connect(wetGain);

  // ── Soft Dream reverb ────────────────────────────────────────────────
  // A short, dark convolver tail. The Dream knob scales its send level so
  // raising Dream doesn't just modulate tone — it also "opens up the
  // room" a touch. IR is generated once: exponential-decay noise with
  // a gentle HF rolloff for a plate/tape-dub feel.
  function buildDreamIR(seconds = 3.2, decay = 1.8) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Small pre-delay so the tail sits behind the signal rather than
      // blurring its transient.
      const pre = Math.floor(ctx.sampleRate * 0.015);
      // Two blended one-poles: one keeps the air band, the other adds
      // body. Lower coefficient on the high-band LP preserves HF sparkle
      // (the "air" on top of the tail) that the previous 0.18 killed.
      let lpAir = 0, lpBody = 0;
      for (let i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        const t = (i - pre) / (len - pre);
        // Gentler decay curve so the tail lingers. decay=1.8 gives a
        // slow-fading cloud instead of a fast plate snap.
        const env = Math.pow(1 - t, decay);
        const n = Math.random() * 2 - 1;
        lpAir  += 0.55 * (n - lpAir);   // keeps shimmer/air
        lpBody += 0.20 * (n - lpBody);  // plate-like body
        d[i] = (lpBody * 0.75 + lpAir * 0.55) * env;
      }
    }
    return buf;
  }
  const dreamReverb = ctx.createConvolver();
  dreamReverb.buffer = buildDreamIR();
  // Parallel send: wetTrim → reverbSend → convolver → reverbReturn →
  // back into wetGain so the tail rides the Mix knob and bypass cleanly.
  const reverbSend   = ctx.createGain(); reverbSend.gain.value   = 0;
  const reverbReturn = ctx.createGain(); reverbReturn.gain.value = 0.70;
  wetTrim.connect(reverbSend);
  reverbSend.connect(dreamReverb);
  dreamReverb.connect(reverbReturn);
  reverbReturn.connect(wetGain);
  wetGain.connect(preOut);   // wet sums into preOut (alongside dry)
  // Widener now sits AFTER the dry/wet merge so dry & wet are delay-
  // aligned (no comb filtering across Mix). Then duck for Drop.
  preOut.connect(widthIn);
  widthOut.connect(dropDuck);
  // Fix: insert outGain into the path so the OUT knob actually attenuates.
  // Previously dropDuck → output left outGain orphaned and OUT was a dead knob.
  dropDuck.connect(outGain);
  outGain.connect(output);

  // ── Meters ───────────────────────────────────────────────────────────
  const inAna  = ctx.createAnalyser(); inAna.fftSize = 1024; inAna.smoothingTimeConstant = 0;
  const outAna = ctx.createAnalyser(); outAna.fftSize = 1024; outAna.smoothingTimeConstant = 0;
  inGain.connect(inAna);
  output.connect(outAna);
  const inBuf  = new Float32Array(inAna.fftSize);
  const outBuf = new Float32Array(outAna.fftSize);
  let inPk = 0, outPk = 0;
  const PK_DECAY = 0.92;

  // ── Dream LFO (signature feature) ────────────────────────────────────
  // Sine LFO + smoothing (diffusion of modulation) + slow random walk for
  // drift. Output is a normalized [-1..1] value polled by the modulation
  // dispatcher. NOT routed to audio — modulates parameter setpoints.
  let dreamRate    = 0.25;     // Hz
  let dreamDepth   = 0.5;      // 0..1
  let dreamDrift   = 0.3;      // 0..1 (random walk amount)
  const dreamSpread = 0.4;     // fixed L/R phase offset (no UI control; kept const so downstream code still reads a stable value)
  const DREAM_TARGETS = new Set(['tone', 'width', 'texture', 'pitch', 'mix']);
  let dreamTarget  = 'tone';   // 'tone' | 'width' | 'texture' | 'pitch' | 'mix'
  let dreamAmount  = 0.5;      // master macro 0..1

  let dreamPhase   = 0;
  let dreamSmoothed = 0;
  let dreamWalk    = 0;
  let lastDreamT   = ctx.currentTime;

  // Smoothing parameter — higher = more diffusion / lingering trails.
  // This is what makes Dream feel "blurred" rather than tremolo-ish.
  const DREAM_SMOOTH_TAU_BASE = 0.55;   // longer smear = more lingering dream

  function tickDream() {
    const now = ctx.currentTime;
    const dt  = Math.min(0.1, now - lastDreamT);
    lastDreamT = now;

    // Phase advance (sine-based)
    dreamPhase += 2 * Math.PI * dreamRate * dt;
    if (dreamPhase > 1e6) dreamPhase -= 1e6;
    const sine = Math.sin(dreamPhase);

    // Slow random walk for non-mechanical drift
    dreamWalk += (Math.random() * 2 - 1) * dreamDrift * dt * 0.6;
    dreamWalk *= 0.995;                       // mild decay to keep bounded
    dreamWalk = Math.max(-1, Math.min(1, dreamWalk));

    // Combined modulation source
    const raw = sine * dreamDepth + dreamWalk * 0.4 * dreamDrift;

    // Diffusion of MODULATION (one-pole LP). Rate-aware: tau is capped at
    // ~⅓ of the LFO period so faster rates still reach full amplitude.
    // Without this cap, high D-RATE settings smooth away to silence.
    const periodLimit = 0.33 / Math.max(0.05, dreamRate);
    const tauBase = Math.min(DREAM_SMOOTH_TAU_BASE, periodLimit);
    const tau = tauBase * (1 + dreamDrift * 1.5);
    const a = 1 - Math.exp(-dt / tau);
    dreamSmoothed += (raw - dreamSmoothed) * a;

    // Apply to active target with master amount macro
    const m = dreamSmoothed * dreamAmount;
    applyDreamMod(m, now);
  }

  // Modulation dispatcher — pushes Dream value into the chosen target
  // using setTargetAtTime so it remains zipper-free.
  function applyDreamMod(m, now) {
    const tau = 0.04;
    switch (dreamTarget) {
      case 'tone': {
        // Big LP sweep + bold tilt shift — unmistakable "breathing"
        // filter motion.
        _toneMul_dream = 1 + m * 1.5;
        recomputeToneLP();
        toneTilt.gain.setTargetAtTime(m * 6, now, tau);
        break;
      }
      case 'width': {
        const w = Math.max(0, Math.min(2, widthBase + m * 0.9));
        sideGain.gain.setTargetAtTime(w, now, tau);
        _toneMul_dream = 1 + m * 0.30;
        recomputeToneLP();
        break;
      }
      case 'texture': {
        // Stronger sat modulation — texture breathes obviously instead
        // of being a "listen really hard" effect.
        _satDream = m * 0.55;
        recomputeSat();
        break;
      }
      case 'pitch': {
        // Dream owns its own drift-depth slot — ±10 ms sway, clearly
        // audible pitch warping that stacks on top of Drift.
        _drift_depth_dream = m * 0.010;
        recomputeDrift();
        driftLFO.frequency.setTargetAtTime(0.28 + m * 0.22, now, tau * 3);
        break;
      }
      case 'mix': {
        // Fatter wet/dry breathing — ±0.35 swing on the crossfade.
        const baseM = Math.max(0, Math.min(1, mixVal + m * 0.35));
        const d = Math.cos(baseM * Math.PI * 0.5);
        const w = Math.sin(baseM * Math.PI * 0.5);
        dryGain.gain.setTargetAtTime(d, now, tau);
        wetGain.gain.setTargetAtTime(w, now, tau);
        break;
      }
      default: break;
    }
  }

  // RAF tick driver for Dream — safe because we use setTargetAtTime,
  // not direct value writes, and dispatch on audio clock for timing.
  let dreamRafId = null;
  function dreamLoop() {
    tickDream();
    dreamRafId = requestAnimationFrame(dreamLoop);
  }
  // ── State for Dream targets (Dream reads these as base values) ───────
  let toneLPBase = 9000;
  let widthBase  = 1.0;
  let satBase    = 0.0;
  let driftBase  = 0.0;
  let mixBase    = 1.0;
  // Drift + flutter depth composer. Each knob writes its OWN depth slot,
  // applyAge writes only its slot, and the effective delay-time modulation
  // is the sum. Previously both wrote the same `driftBase` variable, so
  // whichever setter ran last (Age in the init sync) silently clobbered
  // the other.
  let _drift_depth_knob = 0;   // from setDrift   (max ~0.008 s = 8 ms wow)
  let _drift_depth_age  = 0;   // from applyAge   (small contribution)
  let _flutter_depth_knob = 0;
  let _flutter_depth_age  = 0;
  let _drift_depth_dream  = 0; // from Dream when target='pitch'
  function recomputeDrift() {
    const d = _drift_depth_knob + _drift_depth_age + _drift_depth_dream;
    driftBase = d;
    driftGain.gain.setTargetAtTime(d, ctx.currentTime, 0.05);
  }
  function recomputeFlutter() {
    const f = _flutter_depth_knob + _flutter_depth_age;
    flutterGain.gain.setTargetAtTime(f, ctx.currentTime, 0.05);
  }
  // dreamLoop() moved below the composer block so its TDZ deps are ready

  // ── Mix / Bypass ─────────────────────────────────────────────────────
  let bypassed = false;
  let mixVal = 1.0;

  // ─────────────────────────────────────────────────────────────────────
  // DEV_RULES C1: MIX MUST USE EQUAL-POWER CROSSFADE (cos/sin).
  // DEV_RULES B4: Do NOT add a second writer to dryGain/wetGain here or
  // elsewhere. If a modulator needs to affect mix, add a dedicated
  // series `mixMod` gain node and write that instead.
  // DEV_RULES I3: Bypass here is phase-safe but inherits the 36 ms
  // dryCompensate latency. Do not advertise as zero-latency.
  // ─────────────────────────────────────────────────────────────────────
  function applyMixAndBypass() {
    const t = ctx.currentTime, tau = 0.05;
    if (bypassed) {
      // Pure dry, no wet — no comb interaction possible
      dryGain.gain.setTargetAtTime(1.0, t, tau);
      wetGain.gain.setTargetAtTime(0.0, t, tau);
    } else {
      // Equal-power crossfade: constant perceived energy across the sweep
      const m = Math.max(0, Math.min(1, mixVal));
      const d = Math.cos(m * Math.PI * 0.5);
      const w = Math.sin(m * Math.PI * 0.5);
      dryGain.gain.setTargetAtTime(d, t, tau);
      wetGain.gain.setTargetAtTime(w, t, tau);
      mixBase = w;
    }
  }
  applyMixAndBypass();

  // ── Filter / saturation composers ────────────────────────────────────
  // Multiple knobs (Tone, Age, Drift, Flutter, Drop, Dust, Dream) want to
  // affect the same biquads. Instead of letting them stomp each other,
  // each contributes a multiplier and we recompute the final value.
  let _toneLPBase = 8200;
  let _bwLPBase   = 16000, _bwHPBase = 35;
  let _toneMul_drift = 1, _toneMul_flutter = 1, _toneMul_drop = 1, _toneMul_dream = 1;
  // Age's contribution to the Tone LP is a MULTIPLIER, not an overwrite of
  // _toneLPBase. This lets Age and Tone both influence the LP independently
  // without clobbering each other (fixes "tone knob goes dead when age is
  // moved" bug).
  let _toneLPMul_age = 1;
  let _bwLPMul_drift = 1, _bwLPMul_dust = 1;
  let _bwHPMul_dust  = 1;
  function recomputeToneLP() {
    const f = _toneLPBase * _toneLPMul_age * _toneMul_drift * _toneMul_flutter * _toneMul_drop * _toneMul_dream;
    toneLP.frequency.setTargetAtTime(Math.max(300, Math.min(18000, f)), ctx.currentTime, 0.05);
  }
  function recomputeBwLP() {
    const f = _bwLPBase * _bwLPMul_drift * _bwLPMul_dust;
    bwLP.frequency.setTargetAtTime(Math.max(2000, Math.min(20000, f)), ctx.currentTime, 0.05);
  }
  function recomputeBwHP() {
    const f = _bwHPBase * _bwHPMul_dust;
    bwHP.frequency.setTargetAtTime(Math.max(20, Math.min(400, f)), ctx.currentTime, 0.05);
  }
  // Sat composer — Character baseline + Age + Texture + Dream, all additive.
  // _satAge is driven by applyAge on a cubic curve — starts at 0 so the
  // plugin is transparent at Age=0 (no baked-in distortion).
  // _satChar holds the character's saturation baseline (written by setCharacter).
  // Previously setCharacter wrote `satBase` directly and recomputeSat then
  // overwrote it with Age+Texture+Dream only — silently zeroing the character
  // contribution whenever those three were low. DEV_RULES D2 aliasing bug
  // caught by QC check [LL-M16] (Sampler / satBase mismatch, 2026-04-19).
  let _satChar = 0, _satAge = 0, _satTexture = 0, _satDream = 0;
  function recomputeSat() {
    const s = Math.max(0, Math.min(1, _satChar + _satAge + _satTexture + _satDream));
    satBase = s;
    satShape.curve = buildSatCurve(s);
  }

  // Now safe to start the Dream RAF loop — all deps are initialized
  dreamLoop();

  // ── Age macro — ONE focused effect ──────────────────────────────────
  // Age is no longer a multi-parameter macro. It drives three things, and
  // nothing else:
  //   (a) soft saturation via satShape (cubic ramp — silent below ~0.4,
  //       warm grit when pushed)
  //   (b) dedicated highpass ageHP sweeping 20 Hz → ~380 Hz, thinning
  //       the low end as things "age"
  //   (c) gentle bit-crush via ageCrush, from 16-bit effective down to
  //       ~6-bit at full Age
  // Drift / flutter / tone LP / bandwidth / tape hiss / dream amount are
  // all owned by their own knobs now. Moving Age never silently changes
  // anything you didn't ask for.
  let ageVal = 0.0;
  function applyAge(v) {
    ageVal = Math.max(0, Math.min(1, v));
    const now = ctx.currentTime, tau = 0.06;

    // (a) Soft saturation — cubic so most of the dial is clean.
    _satAge = ageVal * ageVal * ageVal * 0.40;
    recomputeSat();

    // (b) Highpass sweep — Age 0 → 1 ⇒ 20 Hz → 380 Hz. Exponential so the
    // movement feels linear to the ear.
    const hpFreq = 20 * Math.pow(19, ageVal);   // 20, 42, 88, 184, 380
    ageHP.frequency.setTargetAtTime(hpFreq, now, tau);

    // (c) Bit crush — WaveShaper curve swap only when amount moved
    // meaningfully. Curve swaps are instantaneous so we rebuild sparingly
    // and only when actually changing character.
    ageCrush.curve = buildCrushCurve(ageVal * ageVal); // squared → subtle until ~0.5

    // (d) Smoothing LP that follows Age — kills crush aliasing. Sweeps
    // 16 kHz → 5 kHz so the more you crush the more the nasty top comes
    // off. Exponential sweep matches perceived brightness movement.
    const lpFreq = 16000 * Math.pow(5000 / 16000, ageVal); // 16k, 12k, 9k, 7k, 5k
    ageLP.frequency.setTargetAtTime(lpFreq, now, tau);
  }

  // ── Character presets (tone + modulation flavor bundles) ─────────────
  // DEV_RULES D2: setCharacter MUST apply every parameter the preset owns,
  // or this function must be removed from the returned public API. Do NOT
  // let this drift back into a partial "tone-and-drift-only" recall — that
  // is how ghost states happen. If SLAM needs comp/crush/boom/bits/rate,
  // setCharacter applies them. No exceptions.
  // Tracked for getState() — not stored elsewhere.
  let bitsVal = 0;          // 0=off, otherwise 6..16
  let rateVal = 0;          // 0=off, otherwise Hz
  let currentCharacter = null;
  // Character-driven DSP that has no user-facing knob. Exposed via getState
  // so QC snapshots can tell characters apart even when main sliders don't
  // move (they aren't supposed to — character is an independent macro).
  let charTilt = 0, charBwLPHz = 0, charBwHPHz = 0, charDriftRate = 0, charFlutterRate = 0;
  function setCharacter(name) {
    const p = LOFI_CHARACTERS[name];
    if (!p) return;
    currentCharacter = name;
    const now = ctx.currentTime, tau = 0.05;
    toneTilt.gain.setTargetAtTime(p.tilt, now, tau);
    // Write the AUTHORITATIVE tone var (_toneLPBase), then route through
    // recomputeToneLP so the Age/Drift/Flutter multipliers still apply and
    // getState.tone readouts stay truthful. Previously this wrote to a dead
    // mirror var (toneLPBase) that no DSP path reads — DEV_RULES D2.
    _toneLPBase = p.toneLP;
    toneLPBase  = p.toneLP;             // keep the legacy mirror in sync
    recomputeToneLP();
    bwLP.frequency.setTargetAtTime(p.bwLP, now, tau);
    bwHP.frequency.setTargetAtTime(p.bwHP, now, tau);
    driftLFO.frequency.setTargetAtTime(p.driftRate, now, tau);
    flutterLFO.frequency.setTargetAtTime(p.flutterRate, now, tau);
    // Write the character baseline into its own slot (_satChar), then route
    // through recomputeSat so Age/Texture/Dream contributions still add
    // correctly. Previously wrote `satBase` directly, which recomputeSat
    // would then overwrite with (Age+Texture+Dream) only — DEV_RULES D2.
    if (p.satBase != null) { _satChar = p.satBase; recomputeSat(); }
    if (p.dreamRate != null) dreamRate = p.dreamRate;
    if (p.dreamTarget != null) dreamTarget = p.dreamTarget;
    // Cache the character-driven DSP params that have no user-facing knob,
    // so getState() can expose them to QC (otherwise sweeps look identical).
    charTilt       = p.tilt;
    charBwLPHz     = p.bwLP;
    charBwHPHz     = p.bwHP;
    charDriftRate  = p.driftRate;
    charFlutterRate= p.flutterRate;
  }

  // ── API ──────────────────────────────────────────────────────────────
  return {
    input, output, chainOutput: output,

    // ── QC HARNESS SCHEMA (authoritative) ────────────────────────────────
    paramSchema: [
      // Rack
      { name: 'setIn',         label: 'Input (lin)',   kind: 'unit', min: 0,    max: 2,   step: 0.01, def: 1 },
      { name: 'setOut',        label: 'Output (lin)',  kind: 'unit', min: 0,    max: 2,   step: 0.01, def: 1 },
      { name: 'setMix',        label: 'Mix',           kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 1 },
      { name: 'setBypass',     label: 'Bypass',        kind: 'bool', def: 0 },
      // Macros
      { name: 'setAge',        label: 'Age',           kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setDrift',      label: 'Drift',         kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setFlutter',    label: 'Flutter',       kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setDust',       label: 'Dust',          kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setDropouts',   label: 'Dropouts',      kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setTexture',    label: 'Texture',       kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      // Tone
      { name: 'setTone',       label: 'Tone',          kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0.5 },
      { name: 'setWidth',      label: 'Width',         kind: 'unit', min: 0,    max: 2,   step: 0.01, def: 1 },
      { name: 'setGlue',       label: 'Glue',          kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setDream',      label: 'Dream',         kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0.5 },
      // Parallel comp
      { name: 'setCrush',      label: 'Crush',         kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setPump',       label: 'Pump',          kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setCompBlend',  label: 'Comp Blend',    kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0.5 },
      { name: 'setCompOff',    label: 'Comp Off',      kind: 'bool', def: 0, stateKey: 'compOff' },
      { name: 'setCompVibe',   label: 'Comp Vibe',     kind: 'bool', def: 0, stateKey: 'compVibe' },
      // Low / digital
      { name: 'setBoom',       label: 'Boom',          kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0 },
      { name: 'setBits',       label: 'Bits',          kind: 'float',min: 0,    max: 16,  step: 1,    def: 0,
        note: '0 = OFF, otherwise 6..16' },
      { name: 'setRate',       label: 'Rate (Hz)',     kind: 'hz',   min: 0,    max: 48000, step: 100, def: 0,
        note: '0 = OFF, otherwise sample-rate reduce' },
      // Dream details
      { name: 'setDreamRate',  label: 'Dream Rate (Hz)', kind: 'float', min: 0.05, max: 5,  step: 0.05, def: 0.25 },
      { name: 'setDreamDepth', label: 'Dream Depth',   kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0.5 },
      { name: 'setDreamDrift', label: 'Dream Drift',   kind: 'unit', min: 0,    max: 1,   step: 0.01, def: 0.3 },
      { name: 'setDreamTarget',label: 'Dream Target',  kind: 'enum', def: 'tone',
        values: [...DREAM_TARGETS].map(s => ({ value: s, label: s })) },
      // Character preset
      { name: 'setCharacter',  label: 'Character',     kind: 'preset',
        options: Object.keys(LOFI_CHARACTERS) },
    ],

    // ── QC HARNESS: live runtime state ───────────────────────────────────
    // Keys match candidateKeys() convention (camelCase of setter minus 'set')
    // so the harness sync picks them up without per-engine wiring.
    getState() {
      return {
        in:           inGain.gain.value,
        out:          outGain.gain.value,
        mix:          mixVal,
        bypass:       bypassed ? 1 : 0,
        age:          ageVal,
        drift:        _drift_depth_knob / 0.014,
        flutter:      _flutter_depth_knob / 0.0018,
        dust:         crackleAmt,
        dropouts:     dropoutAmt,
        texture:      _satTexture / 0.4,
        tone:         Math.max(0, Math.min(1, (_toneLPBase - 1200) / 14800)),
        width:        widthBase,
        glue:         _glueAmt,
        dream:        dreamAmount,
        crush:        _crushAmt,
        pump:         _pumpAmt,
        compBlend:    _compBlendAmt,
        compOff:      _compOff ? 1 : 0,
        compVibe:     _vibeOn ? 1 : 0,
        boom:         boomShelf.gain.value / 8,
        bits:         bitsVal,
        rate:         rateVal,
        dreamRate:    dreamRate,
        dreamDepth:   dreamDepth,
        dreamDrift:   dreamDrift,
        dreamTarget:  dreamTarget,
        character:    currentCharacter,
        // Character-driven DSP (read-only; no slider). Present so QC can
        // distinguish presets that only alter internal coefficients.
        charTilt,
        charBwLPHz,
        charBwHPHz,
        charDriftRate,
        charFlutterRate,
        // satBase is the LIVE sum (_satChar + _satAge + _satTexture + _satDream);
        // charSatBase is the pure character baseline so LL-M16 can diff
        // against LOFI_CHARACTERS without false positives from user-driven Age/Texture/Dream.
        satBase,
        charSatBase: _satChar,
        // Wet-chain levels for QC targets M18 / M20 (Conformance finding F3).
        // Without these, "Dream=0 means no reverb send" and "Dust=0 means
        // silent dust bus" require indirect audio measurement.
        reverbSendLevel: reverbSend.gain.value,
        dustHiss:        noiseGain.gain.value,
        dustGrit:        crackleGain.gain.value,
      };
    },

    // Standard rack
    setIn:     v => { inGain.gain.setTargetAtTime(Math.max(0, v),  ctx.currentTime, 0.05); },
    setOut:    v => { outGain.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.05); },
    setMix:    v => { mixVal = Math.max(0, Math.min(1, v)); applyMixAndBypass(); },
    setBypass: on => { bypassed = !!on; applyMixAndBypass(); },
    isBypassed: () => bypassed,

    // Macros
    setAge: applyAge,
    getAge: () => ageVal,

    // Movement (manual control beyond Age) — each knob also "massages" a
    // related filter so you HEAR the dial move, not just feel it.
    setDrift: v => {
      const x = Math.max(0, Math.min(1, v));
      // More defined drift: max depth 14 ms (clearly hearable pitch
      // wobble), LFO range 0.35 → 0.80 Hz so it actually breathes across
      // the dial, and a stronger top-end softening so the wobble reads
      // as "tape slowing down" not just vibrato.
      _drift_depth_knob = x * 0.014;
      recomputeDrift();
      driftLFO.frequency.setTargetAtTime(0.35 + x * 0.45, ctx.currentTime, 0.10);
      _bwLPMul_drift = 1 - x * 0.40;
      recomputeBwLP();
    },
    setFlutter: v => {
      const x = Math.max(0, Math.min(1, v));
      // Gentler max depth (1.8 ms) and slower top rate — prior 4 ms
      // with 10 Hz felt pitchy / seasick on presets. This settles into
      // subtle tape-head flutter character at full.
      _flutter_depth_knob = x * 0.0018;
      recomputeFlutter();
      flutterLFO.frequency.setTargetAtTime(4.5 + x * 3.0, ctx.currentTime, 0.10);
      _toneMul_flutter = 1 - x * 0.10;        // softened head-loss contribution
      recomputeToneLP();
    },

    // Texture / dust / dropouts
    setDust: v => {
      // Independent texture layer. Only controls the dust bus — no
      // main-chain coupling. Pure additive pink-noise + grit floor.
      const x = Math.max(0, Math.min(1, v));
      // Continuous hiss floor.
      noiseGain.gain.setTargetAtTime(x * 0.0105, ctx.currentTime, 0.05);
      // Grit layer (squared so low values barely register).
      crackleAmt = x;
      crackleGain.gain.setTargetAtTime(x * x * 0.1225, ctx.currentTime, 0.08);
      // Darken the hiss as Dust rises so it sits behind the signal
      // instead of turning sizzly.
      noiseLP.frequency.setTargetAtTime(8000 - x * 3500, ctx.currentTime, 0.10);
    },
    setDropouts: v => {
      const x = Math.max(0, Math.min(1, v));
      dropoutAmt = x;
      if (!dropoutTimer && dropoutAmt > 0.005) scheduleNextDropout();
      _toneMul_drop = 1 - x * 0.22;
      recomputeToneLP();
    },
    setTexture: v => {
      // ADDS to whatever Age contributes (composer max-mode), not overwrites
      _satTexture = Math.max(0, Math.min(0.4, v * 0.4));
      recomputeSat();
    },

    // Tone / width / glue
    setTone: v => {
      // Tone is the AUTHORITY on the LP — overrides Age's contribution
      _toneLPBase = 1200 + v * 14800;
      toneLPBase = _toneLPBase;             // mirror for Dream
      recomputeToneLP();
      toneTilt.gain.setTargetAtTime((1 - v * 2) * 6, ctx.currentTime, 0.05);
    },
    // DEV_RULES C5: Width=0 MUST equal (L+R)/2 on both channels at matched
    // level. Current cross-swap path is FLAGGED for correction — do not
    // ship any downstream code that assumes this behavior is already true.
    // If you edit this setter, re-verify true mono with a pink-noise null
    // test before committing.
    setWidth: v => {
      widthBase = Math.max(0, Math.min(2, v));
      const x = widthBase - 1;            // -1..+1
      const wide = Math.max(0, x);        // 0..1 widening
      const narrow = Math.max(0, -x);     // 0..1 narrowing
      const t = ctx.currentTime, tau = 0.05;
      // Widening: Haas cross-feed
      wCrossL.gain.setTargetAtTime(wide * 0.55, t, tau);
      wCrossR.gain.setTargetAtTime(wide * 0.55, t, tau);
      // Narrowing: un-delayed L↔R cross-feed sums toward mono
      wMonoL.gain.setTargetAtTime(narrow, t, tau);
      wMonoR.gain.setTargetAtTime(narrow, t, tau);
      // Reduce direct as we narrow so we don't stack into +6dB at width=0
      const directLvl = 1 - narrow * 0.5;
      wDirectL.gain.setTargetAtTime(directLvl, t, tau);
      wDirectR.gain.setTargetAtTime(directLvl, t, tau);
    },
    setGlue: v => {
      // 0..1 maps threshold -8 → -28 and ratio 1 → 3
      const g = Math.max(0, Math.min(1, v));
      _glueAmt = g;
      if (_compOff) return;   // bypass holds DSP at neutral
      glueComp.threshold.setTargetAtTime(-8 - g * 20, ctx.currentTime, 0.05);
      glueComp.ratio.setTargetAtTime(1 + g * 2.0,     ctx.currentTime, 0.05);
    },

    // Dream LFO — each setter writes exactly one variable. No cross-talk,
    // no hidden auto-lifts. If depth feels low, the Depth knob should be
    // raised — the engine does not silently override user intent.
    setDream: v => {
      const x = Math.max(0, Math.min(1, v));
      dreamAmount = x;
      // Gentle plate tail scales with Dream — 0 at fully clockwise off,
      // ~0.35 send at full. Subtle; meant to "open the room" not drown
      // the signal.
      reverbSend.gain.setTargetAtTime(x * 0.55, ctx.currentTime, 0.08);
    },
    // ── Parallel compressor (CRUSH / PUMP / BLEND / VIBE) ─────────────
    setCrush: v => {
      const x = Math.max(0, Math.min(1, v));
      _crushAmt = x;
      if (_compOff) return;
      // Saturation curve rebuilds only on crush or vibe change.
      crushShape.curve = buildCrushSatCurve(x, _vibeOn);
      // Threshold slides from -10 (idle) down to -30 dB at full. Slightly
      // softer range than before so CRUSH is musical across its travel.
      crushComp.threshold.setTargetAtTime(-10 - x * 20, ctx.currentTime, 0.05);
      // Ratio ramps from 1 (no comp) to 6:1. Capped below 8 to avoid the
      // wet leg turning brickwall/plasticky.
      crushComp.ratio.setTargetAtTime(1 + x * 5, ctx.currentTime, 0.05);
      // Makeup gain climbs with crush to counter squash-level-loss. Tuned
      // so wet-leg loudness stays ~flat as CRUSH sweeps 0→1.
      crushMakeup.gain.setTargetAtTime(1 + x * 0.55, ctx.currentTime, 0.08);
    },
    setPump: v => {
      // Unipolar ducking: baseline shifts down, LFO swings between
      // [1-depth, 1]. So PUMP only pulls the level DOWN from unity,
      // never boosts above it — the classic pump/breathe feel.
      const x = Math.max(0, Math.min(1, v));
      _pumpAmt = x;
      if (_compOff) return;
      const depth = x * (_vibeOn ? 0.65 : 0.38);
      pumpGain.gain.setTargetAtTime(1 - depth / 2, ctx.currentTime, 0.08);
      pumpScale.gain.setTargetAtTime(depth / 2, ctx.currentTime, 0.08);
    },
    setCompBlend: v => {
      // LINEAR crossfade (not equal-power) because the two legs are
      // correlated — equal-power sums +3 dB hot at center when wet≈dry.
      // Linear keeps levels sane at all blend positions.
      const b = Math.max(0, Math.min(1, v));
      _compBlendAmt = b;
      if (_compOff) return;
      compDry.gain.setTargetAtTime(1 - b, ctx.currentTime, 0.04);
      compWet.gain.setTargetAtTime(b,     ctx.currentTime, 0.04);
    },
    setCompOff(on) {
      // Whole-stage bypass: forces GLUE/CRUSH/PUMP/BLEND to neutral DSP
      // without clearing stored knob values. Toggle OFF → restore
      // everything exactly as it was. BOOM is a low-shelf, not a
      // compressor, so it stays live.
      _compOff = !!on;
      const now = ctx.currentTime;
      const tau = 0.05;
      if (_compOff) {
        // GLUE neutral
        glueComp.threshold.setTargetAtTime(0, now, tau);
        glueComp.ratio.setTargetAtTime(1, now, tau);
        // CRUSH neutral — linear curve, no ratio, no makeup
        crushShape.curve = buildCrushSatCurve(0, false);
        crushComp.threshold.setTargetAtTime(0, now, tau);
        crushComp.ratio.setTargetAtTime(1, now, tau);
        crushMakeup.gain.setTargetAtTime(1, now, tau);
        // PUMP neutral — stop ducking
        pumpGain.gain.setTargetAtTime(1, now, tau);
        pumpScale.gain.setTargetAtTime(0, now, tau);
        // BLEND force fully dry (wet leg muted) — guarantees true bypass
        // even if something slipped past the neutral setters above.
        compDry.gain.setTargetAtTime(1, now, tau);
        compWet.gain.setTargetAtTime(0, now, tau);
      } else {
        // Restore stored knob values via public setters. Each one will
        // see _compOff=false and actually write DSP this time.
        this.setGlue(_glueAmt);
        this.setCrush(_crushAmt);
        this.setPump(_pumpAmt);
        this.setCompBlend(_compBlendAmt);
      }
    },
    setBits: v => {
      // 0 = OFF (passthrough). Otherwise the target bit depth (6..16).
      const b = (v | 0);
      bitsVal = b > 0 ? b : 0;
      bitsShaper.curve = buildBitsCurve(bitsVal);
    },
    setRate: v => {
      // 0 = OFF (passthrough). Otherwise target sample rate in Hz — drive
      // the biquad LP at ~Nyquist of the target rate as a proxy for ZOH.
      const target = +v || 0;
      rateVal = target;
      const f = (target <= 0 || target >= ctx.sampleRate / 2) ? 20000 : target / 2;
      rateLP.frequency.setTargetAtTime(f, ctx.currentTime, 0.05);
    },

    setBoom: v => {
      // 0..1 maps to 0..+8 dB of 120 Hz low-shelf. No makeup needed —
      // it's additive weight, not a compressor band.
      const x = Math.max(0, Math.min(1, v));
      boomShelf.gain.setTargetAtTime(x * 8, ctx.currentTime, 0.06);
    },
    setCompVibe: on => {
      _vibeOn = !!on;
      const now = ctx.currentTime;
      // Rebuild crush curve so 2nd-harmonic kick engages.
      crushShape.curve = buildCrushSatCurve(_crushAmt, _vibeOn);
      // Softer knee + slightly slower attack for dreamier squash.
      crushComp.knee.setTargetAtTime(_vibeOn ? 14 : 6, now, 0.1);
      crushComp.attack.setTargetAtTime(_vibeOn ? 0.010 : 0.002, now, 0.1);
      // Longer release = more audible movement / settle.
      crushComp.release.setTargetAtTime(_vibeOn ? 0.34 : 0.09, now, 0.1);
      // Slower, deeper pump when vibe engaged.
      pumpLFO.frequency.setTargetAtTime(_vibeOn ? 0.40 : 0.75, now, 0.15);
      // Re-apply pump depth so the unipolar baseline follows vibe depth change.
      // Deeper breathe in VIBE (0.65) vs 0.38 normal.
      const depth = _pumpAmt * (_vibeOn ? 0.65 : 0.38);
      pumpGain.gain.setTargetAtTime(1 - depth / 2, now, 0.15);
      pumpScale.gain.setTargetAtTime(depth / 2, now, 0.15);
      // Body bump at 220 Hz — flat off, +2.5 dB on.
      vibeBody.gain.setTargetAtTime(_vibeOn ? 2.5 : 0, now, 0.12);
    },

    setDreamRate:    v => { dreamRate   = Math.max(0.05, Math.min(5, v)); },
    setDreamDepth:   v => { dreamDepth  = Math.max(0, Math.min(1, v)); },
    setDreamDrift:   v => { dreamDrift  = Math.max(0, Math.min(1, v)); },
    setDreamTarget:  s => {
      // Whitelist — silently ignores bad payloads from old saves/presets.
      if (DREAM_TARGETS.has(s)) dreamTarget = s;
    },
    getDreamValue:   () => dreamSmoothed,    // for UI wobble indicator

    // Character
    setCharacter,

    // Meters
    getInputPeak() {
      inAna.getFloatTimeDomainData(inBuf);
      let m = 0;
      for (let i = 0; i < inBuf.length; i++) {
        const v = inBuf[i] < 0 ? -inBuf[i] : inBuf[i];
        if (v > m) m = v;
      }
      inPk = Math.max(m, inPk * PK_DECAY);
      return inPk;
    },
    getOutputPeak() {
      outAna.getFloatTimeDomainData(outBuf);
      let m = 0;
      for (let i = 0; i < outBuf.length; i++) {
        const v = outBuf[i] < 0 ? -outBuf[i] : outBuf[i];
        if (v > m) m = v;
      }
      outPk = Math.max(m, outPk * PK_DECAY);
      return outPk;
    },

    // Atomic multi-param write — used by preset application so the UI can
    // suppress its per-knob useEffects and push one coherent state change.
    // Unknown keys are ignored so stale/old-save blobs never crash.
    applyBulk(obj) {
      if (!obj) return;
      const api = this;
      const map = {
        age: api.setAge, drift: api.setDrift, flutter: api.setFlutter,
        dust: api.setDust, dropouts: api.setDropouts,
        tone: api.setTone, width: api.setWidth, glue: api.setGlue, texture: api.setTexture,
        dream: api.setDream, dreamRate: api.setDreamRate,
        dreamDepth: api.setDreamDepth, dreamDrift: api.setDreamDrift,
        dreamTarget: api.setDreamTarget,
        crush: api.setCrush, pump: api.setPump,
        compBlend: api.setCompBlend, compVibe: api.setCompVibe,
        compOff: api.setCompOff, boom: api.setBoom,
        bits: api.setBits, rate: api.setRate,
        mix: api.setMix, bypass: api.setBypass,
      };
      for (const k of Object.keys(obj)) {
        const fn = map[k];
        if (typeof fn === 'function') fn(obj[k]);
      }
    },

    // DEV_RULES H1: dispose() MUST stop every Oscillator, every
    // BufferSource, cancel every RAF, clear every setTimeout, and
    // disconnect input/output. If you add a new node above, add its
    // teardown here in the same commit.
    dispose() {
      try {
        if (dreamRafId) cancelAnimationFrame(dreamRafId);
        if (dropoutTimer) clearTimeout(dropoutTimer);
        if (crackleTimer) clearTimeout(crackleTimer);
        driftLFO.stop();   flutterLFO.stop();
        pumpLFO.stop();
        noiseSrc.stop();   gritSrc.stop();
        input.disconnect(); output.disconnect();
      } catch {}
    },

    // DEV_RULES I4: Every engine reports its total latency in seconds.
    // 0.036 = 30 ms tape baseline + 6 ms DynamicsCompressor lookahead.
    // Update this if dryCompensate or comp-stage latency changes.
    getLatency() { return 0.036; },
  };
}

// ── Character presets (single source of truth) ───────────────────────────
export const LOFI_CHARACTERS = {
  // NOTE: flutterRate here sets the Hz the character prefers; the depth
  // is governed by the Flutter knob via CHAR_MACROS in the UI. Keep
  // flutterRate gentle — prior values (up to 8 Hz) were too seasick.
  Tape:     { tilt:  2, toneLP: 7000, bwLP: 11000, bwHP:  60,
              driftRate: 0.40, flutterRate: 5.0, satBase: 0.18,
              dreamRate: 0.30, dreamTarget: 'tone' },
  Cassette: { tilt:  1, toneLP: 6000, bwLP:  9000, bwHP: 110,
              driftRate: 0.50, flutterRate: 5.5, satBase: 0.22,
              dreamRate: 0.45, dreamTarget: 'tone' },
  Sampler:  { tilt:  0, toneLP: 5500, bwLP:  8000, bwHP:  80,
              driftRate: 0.20, flutterRate: 3.5, satBase: 0.15,
              dreamRate: 0.18, dreamTarget: 'texture' },
  Radio:    { tilt: -2, toneLP: 4500, bwLP:  6000, bwHP: 250,
              driftRate: 0.32, flutterRate: 4.5, satBase: 0.20,
              dreamRate: 0.25, dreamTarget: 'tone' },
  Dusty:    { tilt:  4, toneLP: 5000, bwLP:  7500, bwHP: 130,
              driftRate: 0.45, flutterRate: 5.0, satBase: 0.15,
              dreamRate: 0.35, dreamTarget: 'mix' },
  // SLAM — aggressive parallel squash. Hot crush + real pump + heavy
  // low-end body, bit-reduced + rate-reduced for sampler grit.
  Slam:     { tilt:  1, toneLP: 5500, bwLP:  8500, bwHP: 110,
              driftRate: 0.35, flutterRate: 4.5, satBase: 0.24,
              dreamRate: 0.40, dreamTarget: 'tone' },
};
