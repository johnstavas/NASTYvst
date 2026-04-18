// eightOhEightEngine.js — 808-style kick voice + lookahead step sequencer.
//
// Standard rack contract:
//   { input, output, chainOutput, setIn/setOut/setMix/setBypass, dispose, ... }
//
// Topology:
//   input  ─► bypassGain ────────────────────────────────────► mixSum
//   input  ─► inGain ─► passGain ─► dryGain ───────────────► mixSum   (input pass-through)
//   kickBus ─► kickShelf ─► kickLP ─► driveIn ─► shaper ─► sidechainDuck ─► wetGain ─► mixSum
//   mixSum ─► outGain ─► output
//
// The kick voice is per-trigger: every hit instantiates fresh OscillatorNode +
// GainNode, connects, schedules envelopes, stops, and disposes via onended.
//
// The sequencer uses the standard Web Audio lookahead pattern:
//   setInterval @ 25 ms tick scans up to 100 ms ahead of ctx.currentTime,
//   schedules trigger() calls at exact audio times → no jitter, no drift.
//
// Trigger modes:
//   free    : sequencer always runs while ON
//   host    : sequencer runs only when setHostPlaying(true) (DAW transport hook)
//   manual  : sequencer never runs; only manual Trigger Knob hits fire
//   hybrid  : sequencer runs while ON + manual hits layer on top
//
// Patterns are { steps: number[] (velocity 0..1), stepDiv: number (beat fraction),
// label: string }. Switching pattern queues to next bar boundary unless `immediate`.

export function createEightOhEightEngine(ctx) {
  // ── I/O nodes (rack contract) ────────────────────────────────────────────
  const input      = ctx.createGain();
  const output     = ctx.createGain();
  const inGain     = ctx.createGain();    inGain.gain.value     = 1.0;
  const outGain    = ctx.createGain();    outGain.gain.value    = 1.0;
  // Start dry path OPEN so input audio passes the moment the engine is
  // wired into the chain — applyMixAndBypass + Orb's setInputMode then
  // reconcile to the chosen mode without ever muting incoming audio.
  const dryGain    = ctx.createGain();    dryGain.gain.value    = 1.0;
  const wetGain    = ctx.createGain();    wetGain.gain.value    = 1.0;
  const bypassGain = ctx.createGain();    bypassGain.gain.value = 0.0;
  const mixSum     = ctx.createGain();    mixSum.gain.value     = 1.0;
  const passGain   = ctx.createGain();    passGain.gain.value   = 1.0;

  // Use Web Audio default channel handling (max + speakers) so mono
  // sources upmix naturally instead of being clamped to explicit stereo
  // (which can drop signal when upstream is mono).
  for (const n of [input, output, inGain, outGain, dryGain, wetGain,
                   bypassGain, mixSum, passGain]) {
    n.channelCountMode = 'max';
    n.channelInterpretation = 'speakers';
  }

  input.connect(bypassGain);
  input.connect(inGain);
  inGain.connect(passGain);
  passGain.connect(dryGain);
  dryGain.connect(mixSum);
  bypassGain.connect(mixSum);

  // ── Kick voice bus + tone shaping ────────────────────────────────────────
  const kickBus = ctx.createGain(); kickBus.gain.value = 1.0;

  const kickShelf = ctx.createBiquadFilter();
  kickShelf.type = 'lowshelf'; kickShelf.frequency.value = 80; kickShelf.gain.value = 3;

  const kickLP = ctx.createBiquadFilter();
  kickLP.type = 'lowpass'; kickLP.frequency.value = 4500; kickLP.Q.value = 0.5;

  const driveIn = ctx.createGain(); driveIn.gain.value = 1.0;
  const shaper  = ctx.createWaveShaper();
  shaper.oversample = '2x';

  // Saturator with optional asymmetric bias.
  //   amount 0..1 — drive depth (tanh slope)
  //   asym   0..1 — push transfer curve off-axis: positive half compresses
  //                  harder than negative → adds 2nd-harmonic warmth (tube-ish).
  function buildCurve(amount, asym = 0) {
    const N = 2048, c = new Float32Array(N);
    const k = 1 + amount * 5;
    const a = Math.max(0, Math.min(0.6, asym));
    // Normalize so the curve still maps [-1,1] → ~[-1,1]
    const denom = Math.tanh(k * (1 + a));
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      // Asymmetric bias: positive half gets steeper slope.
      const kx = x >= 0 ? k * (1 + a) : k * (1 - a * 0.5);
      c[i] = Math.tanh(x * kx) / denom;
    }
    return c;
  }
  shaper.curve = buildCurve(0, 0);

  // Sidechain duck: ducks input pass-through when kick fires (used by 'duck' mode).
  // Implemented as a gain on the dry path that we automate per hit.
  const duckGain = ctx.createGain(); duckGain.gain.value = 1.0;
  // Re-route dry path through duckGain
  passGain.disconnect(); passGain.connect(duckGain); duckGain.connect(dryGain);

  kickBus.connect(kickShelf);
  kickShelf.connect(kickLP);
  kickLP.connect(driveIn);
  driveIn.connect(shaper);
  shaper.connect(wetGain);
  wetGain.connect(mixSum);

  mixSum.connect(outGain);
  outGain.connect(output);

  // ── Output meter ─────────────────────────────────────────────────────────
  const ana = ctx.createAnalyser();
  ana.fftSize = 1024; ana.smoothingTimeConstant = 0;
  output.connect(ana);
  const buf = new Float32Array(ana.fftSize);
  let peakSm = 0;
  const PEAK_DECAY = 0.92;

  // ── Voice parameters ─────────────────────────────────────────────────────
  let baseFreq    = 55;     // Hz — TUNE (sub fundamental)
  let pitchTop    = 180;    // Hz — start of pitch sweep (auto-derived from drop+punch)
  let pitchDecay  = 0.045;  // s  — pitch env time (auto-shortened by punch)
  let ampDecay    = 1.20;   // s  — amplitude decay (long, fat 808 default)
  let clickAmt    = 0.30;   // 0..1 — transient click level
  let driveAmt    = 0.10;   // 0..1 — saturation
  let saturateBoost = 0;    // multiplier added by character "Saturate"
  let toneShelfDb = 3;      // dB — low shelf @80Hz (warm default)
  let toneLPHz    = 4500;   // Hz — body LP cutoff (warm default)
  let bodyGain    = 0.95;   // base body level (per-hit), set by character

  // New synth controls
  let pitchDropAmt = 0.55;  // 0..1 — depth of downward pitch sweep
  let punchAmt     = 0.45;  // 0..1 — emphasizes attack: faster sweep + more click
  let analogAmt    = 0.35;  // 0..1 — drift, harmonic warmth, nonlinearity, soft tone
  let harmonicMix  = 0.22;  // 0..1 — triangle harmonic blend over the sine body
  let asymAmt      = 0.22;  // 0..1 — asymmetric saturator bias (2nd-harmonic warmth)

  function applyDrive() {
    // Analog adds a tiny amount of base drive + asymmetric bias even at
    // drive=0 — that's why analog mode never sounds sterile.
    const total = Math.min(1, driveAmt + saturateBoost + analogAmt * 0.10);
    const asym  = Math.min(0.6, asymAmt + analogAmt * 0.20);
    shaper.curve = buildCurve(total, asym);
    driveIn.gain.value = 1 + total * 0.6;
  }
  applyDrive();

  // ── Single-hit voice ─────────────────────────────────────────────────────
  let lastTriggerAt = -1;
  let onHitFn = null;

  function trigger(velocity = 1, when) {
    if (when == null) when = ctx.currentTime;
    if (when - lastTriggerAt < 0.004) return;
    lastTriggerAt = when;

    const v = Math.max(0, Math.min(1, velocity));
    if (v <= 0.001) return;

    const t = when;

    // ── Analog per-hit variation ──────────────────────────────────────
    const driftCents  = (Math.random() * 2 - 1) * (analogAmt * 15);
    const driftMul    = Math.pow(2, driftCents / 1200);
    const ampJitter   = 1 + (Math.random() * 2 - 1) * (analogAmt * 0.05);
    const pitchJitter = 1 + (Math.random() * 2 - 1) * (analogAmt * 0.08);

    // ── DECAY ↔ PITCH-SWEEP COUPLING (Werner / TR-808) ────────────────
    // In the real circuit, one envelope discharges through both the amp
    // and the resonator's pitch-modulating element. Longer DECAY =
    // automatically deeper pitch drop AND slower sweep, because the
    // modulating capacitor has more time to discharge. We model that
    // coupling here so DECAY does what it does on a real 808.
    const decay      = Math.max(0.05, ampDecay * ampJitter);
    const decayNorm  = Math.min(1, decay / 1.2);              // 0..1
    const sweepDepth = (60 + pitchDropAmt * 280 + punchAmt * 80)
                     * (0.55 + decayNorm * 0.85);             // longer = deeper
    const sweepT     = Math.max(0.005,
                       pitchDecay * (1 - 0.6 * punchAmt) * pitchJitter
                       * (0.7 + decayNorm * 0.8));            // longer = slower

    const baseHz  = Math.max(20, baseFreq) * driftMul;
    const startHz = Math.min(900, baseHz + sweepDepth);

    // ── Body 1: high-Q resonant bandpass (the Werner-style "ring") ────
    // The actual TR-808 body is the damped natural response of a
    // bridged-T resonator excited by a short pulse. We model that with a
    // BiquadFilter (bandpass, high Q) excited by a brief noise burst.
    // Center frequency sweeps from startHz → baseHz on the same envelope
    // as amp, giving authentic decay-coupled pitch drop.
    const resonator = ctx.createBiquadFilter();
    resonator.type = 'bandpass';
    // Q rises with PUNCH and falls with ANALOG (more drift = looser ring)
    const resQ = 14 + punchAmt * 12 - analogAmt * 4;
    resonator.Q.value = Math.max(4, resQ);
    resonator.frequency.setValueAtTime(startHz, t);
    resonator.frequency.exponentialRampToValueAtTime(baseHz, t + sweepT);

    // Excitation: a very short noise burst (~3 ms) — this is the
    // "trigger pulse" that kicks the resonator into ringing.
    const burstLen = Math.ceil(ctx.sampleRate * 0.003);
    const burstBuf = ctx.createBuffer(1, burstLen, ctx.sampleRate);
    const bd = burstBuf.getChannelData(0);
    for (let i = 0; i < burstLen; i++) {
      // Decaying noise pulse — not white, shaped so the resonator gets
      // a clean impulse-like excitation
      const env = Math.exp(-i / (burstLen * 0.35));
      bd[i] = (Math.random() * 2 - 1) * env;
    }
    const burst = ctx.createBufferSource();
    burst.buffer = burstBuf;

    const resGain = ctx.createGain();
    resGain.gain.value = 0;
    burst.connect(resonator);
    resonator.connect(resGain);
    resGain.connect(kickBus);

    // The resonator's natural decay is slow at high Q; we shape its
    // overall amp envelope on top so DECAY knob still controls tail length.
    const peak  = v * bodyGain;
    resGain.gain.setValueAtTime(0.0001, t);
    resGain.gain.exponentialRampToValueAtTime(peak * 1.10, t + 0.0025);
    resGain.gain.exponentialRampToValueAtTime(peak * 0.55, t + decay * 0.20);
    resGain.gain.exponentialRampToValueAtTime(0.0001,      t + decay);

    burst.start(t);
    burst.stop(t + 0.010);
    const stopAt = t + decay + 0.15;
    setTimeout(() => {
      try { burst.disconnect(); resonator.disconnect(); resGain.disconnect(); } catch {}
    }, (stopAt - ctx.currentTime) * 1000 + 50);

    // ── Body 2: sine SUB reinforcement (mono-safe low end) ────────────
    // The resonator gives character; this sine guarantees rock-solid
    // sub weight on every hit even if the bandpass Q drifts. No sweep —
    // it sits at the fundamental so the low end never wavers.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = baseHz;
    const subGain = ctx.createGain();
    subGain.gain.value = 0;
    sub.connect(subGain); subGain.connect(kickBus);
    const subPeak = peak * 0.85;
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(subPeak,         t + 0.004);
    subGain.gain.exponentialRampToValueAtTime(subPeak * 0.55,  t + decay * 0.22);
    subGain.gain.exponentialRampToValueAtTime(0.0001,          t + decay);
    sub.start(t);
    sub.stop(t + decay + 0.10);
    sub.onended = () => { try { sub.disconnect(); subGain.disconnect(); } catch {} };

    // ── Body 3: triangle harmonic blend (warmth) ──────────────────────
    const harmAmt = Math.min(0.35, harmonicMix + analogAmt * 0.08);
    if (harmAmt > 0.01) {
      const tri = ctx.createOscillator();
      tri.type = 'triangle';
      const triGain = ctx.createGain();
      triGain.gain.value = 0;
      tri.connect(triGain); triGain.connect(kickBus);
      tri.frequency.setValueAtTime(startHz, t);
      tri.frequency.exponentialRampToValueAtTime(baseHz, t + sweepT * 0.9);
      const triPeak = peak * harmAmt;
      triGain.gain.setValueAtTime(0.0001, t);
      triGain.gain.exponentialRampToValueAtTime(triPeak, t + 0.003);
      triGain.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.55);
      tri.start(t);
      tri.stop(t + decay * 0.55 + 0.05);
      tri.onended = () => { try { tri.disconnect(); triGain.disconnect(); } catch {} };
    }

    // ── Click / transient layer ───────────────────────────────────────
    // Punch adds extra click on top of the user-set click amount, so Punch
    // gives both a faster sweep AND more transient definition.
    const totalClick = Math.min(1.4, clickAmt + punchAmt * 0.45);
    if (totalClick > 0.005) {
      const clk = ctx.createOscillator();
      clk.type = 'triangle';
      // Click pitch rides Analog: lower & softer when Analog is up.
      // Default base is 1100 Hz (was 1600) — cuts the harsh edge.
      const clkHz = 1100 - analogAmt * 300;
      clk.frequency.value = clkHz;
      const clkGain = ctx.createGain();
      clkGain.gain.value = 0;
      clk.connect(clkGain); clkGain.connect(kickBus);
      const clkPeak = totalClick * v * 0.40;
      clkGain.gain.setValueAtTime(0.0001, t);
      clkGain.gain.exponentialRampToValueAtTime(clkPeak, t + 0.0008);
      // Analog slightly elongates the click decay → softer attack edge
      const clkDecay = 0.014 + analogAmt * 0.010;
      clkGain.gain.exponentialRampToValueAtTime(0.0001, t + clkDecay);
      clk.start(t);
      clk.stop(t + clkDecay + 0.010);
      clk.onended = () => { try { clk.disconnect(); clkGain.disconnect(); } catch {} };
    }

    // Sidechain duck (input pass-through) if mode set
    if (duckOnHit) {
      const g = duckGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(1 - duckDepth * v, t + 0.005);
      g.exponentialRampToValueAtTime(1.0, t + Math.max(0.05, duckRelease));
    }

    if (onHitFn) onHitFn(when, v);
  }

  // ── Sidechain duck params ────────────────────────────────────────────────
  let duckOnHit  = false;
  let duckDepth  = 0.7;     // 0..1 amount of attenuation at hit
  let duckRelease = 0.18;   // s

  // ── Sequencer (lookahead scheduler) ──────────────────────────────────────
  let bpm = 120;
  let pattern = null;            // { steps: number[], stepDiv: number, label: string }
  let pendingPattern = null;
  let nextStepIdx = 0;
  let nextNoteTime = 0;
  let isRunning = false;
  let quantizeMode = 'beat';     // 'beat' | 'bar' | 'instant'
  let currentStepIdx = -1;
  let triggerMode = 'hybrid';    // free | host | manual | hybrid
  let hostPlaying = false;
  let onStepFn = null;

  function shouldRunSequencer() {
    if (!isRunning) return false;
    if (triggerMode === 'manual') return false;
    if (triggerMode === 'host'   && !hostPlaying) return false;
    return true;   // free, hybrid, host(playing)
  }

  function stepDuration() {
    const beatLen = 60 / Math.max(40, Math.min(240, bpm));
    return beatLen * (pattern?.stepDiv ?? 0.25);
  }

  const LOOKAHEAD = 0.10;
  const TICK_MS   = 25;
  let schedulerInt = null;

  // ── Groove Engine ────────────────────────────────────────────────────────
  // Modifies WHEN steps play, never WHICH steps play. The grid clock
  // (nextNoteTime) stays drift-free; per-step offsets are added at schedule
  // time so accumulated drift is impossible.
  let grooveType   = 'straight';   // straight | swing | shuffle | push | lazy
  let grooveAmount = 0;            // 0..1
  let humanizeMs   = 5;            // ±5 ms max micro-jitter (set 0 to disable)
  let accentAmt    = 0.18;         // 0..1 — velocity boost on strong beats

  // Returns time offset (seconds) to add to step `idx`'s grid time.
  function grooveOffset(idx, stepDur) {
    const amt = Math.max(0, Math.min(1, grooveAmount));
    if (amt === 0 || grooveType === 'straight') return 0;

    switch (grooveType) {
      case 'swing': {
        // Classic 8th-note swing: delay every other step.
        // At amt=1, the off-step lands at 2/3 of the beat (triplet feel).
        // We use the off-position within a beat-pair (idx % 2 === 1).
        if (idx % 2 === 1) return amt * stepDur * (2 / 3);
        return 0;
      }
      case 'shuffle': {
        // Triplet-feel shuffle across groups of 3-against-2.
        // Push step 1 of each pair toward the triplet position; stronger
        // than swing's halfway pull.
        if (idx % 2 === 1) return amt * stepDur * 0.75;
        return 0;
      }
      case 'push': {
        // Shift every step slightly EARLIER. Skip the very first step of
        // the pattern so we never produce a negative absolute time.
        if (idx === 0) return 0;
        return -amt * stepDur * 0.10;   // up to 10% of a step early
      }
      case 'lazy': {
        // Shift every step slightly LATER (drag/laid-back feel).
        return amt * stepDur * 0.10;    // up to 10% of a step late
      }
      default: return 0;
    }
  }

  // Strong-beat detection for accents. Uses the 16-grid musical position
  // when available; downbeats (every 4th step on a 16-grid, every 3rd on a
  // 12-grid) get a velocity boost.
  function accentVelocity(idx, stepsLen) {
    if (accentAmt <= 0) return 1;
    const grid = stepsLen === 12 ? 3 : 4;       // triplet vs duple
    const isDownbeat = (idx % grid) === 0;
    const isBarStart = idx === 0;
    if (isBarStart) return 1 + accentAmt;
    if (isDownbeat) return 1 + accentAmt * 0.6;
    // Subtle ghost-step pull-down on weak 16ths between downbeats
    if (idx % 2 === 1) return 1 - accentAmt * 0.25;
    return 1;
  }

  // Cheap deterministic-ish PRNG seed per step so humanize doesn't sound
  // mechanical but also doesn't compound drift (offsets, not state).
  function humanizeOffset() {
    if (humanizeMs <= 0) return 0;
    // uniform [-1,1] * humanize seconds
    return ((Math.random() * 2) - 1) * (humanizeMs / 1000);
  }

  function scheduleAhead() {
    if (!pattern) return;
    if (!shouldRunSequencer()) return;
    const now = ctx.currentTime;
    while (nextNoteTime < now + LOOKAHEAD) {
      const stepDur = stepDuration();
      const v = pattern.steps[nextStepIdx];

      // Apply groove + humanize as schedule-time OFFSETS only.
      // The grid clock (nextNoteTime) is never modified by groove, so no
      // drift can accumulate across bars.
      const offset   = grooveOffset(nextStepIdx, stepDur) + humanizeOffset();
      const playTime = Math.max(now, nextNoteTime + offset);

      if (v > 0) {
        const accented = v * accentVelocity(nextStepIdx, pattern.steps.length);
        trigger(Math.max(0, Math.min(1.5, accented)), playTime);
      }
      if (onStepFn) onStepFn(nextStepIdx, playTime);
      currentStepIdx = nextStepIdx;
      nextStepIdx = (nextStepIdx + 1) % pattern.steps.length;
      nextNoteTime += stepDur;          // grid advances by un-grooved step

      // Pattern switch on bar boundary (step 0)
      if (nextStepIdx === 0 && pendingPattern) {
        pattern = pendingPattern;
        pendingPattern = null;
      }
    }
  }

  function quantizedStartTime() {
    const now = ctx.currentTime;
    const beatLen = 60 / bpm;
    if (quantizeMode === 'beat') return Math.ceil(now / beatLen) * beatLen;
    if (quantizeMode === 'bar')  return Math.ceil(now / (beatLen * 4)) * (beatLen * 4);
    return now + 0.020;
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    nextStepIdx = 0;
    nextNoteTime = quantizedStartTime();
    if (schedulerInt) clearInterval(schedulerInt);
    schedulerInt = setInterval(scheduleAhead, TICK_MS);
  }
  function stop() {
    isRunning = false;
    if (schedulerInt) { clearInterval(schedulerInt); schedulerInt = null; }
    currentStepIdx = -1;
    if (onStepFn) onStepFn(-1, ctx.currentTime);
  }

  // ── Character presets — cohesive tone-mode bundles ───────────────────────
  // Each preset adjusts a small set of voice/tone params atomically.
  // Character presets — single source of truth lives at module scope
  // (exported as CHARACTERS below) so the Orb can read the same values
  // and sync knob state when a character is clicked.
  let activeCharacter = null;

  function setCharacter(name) {
    activeCharacter = name;
    const p = CHARACTERS[name];
    if (!p) return;
    toneShelfDb  = p.toneShelfDb;
    toneLPHz     = p.toneLPHz;
    driveAmt     = p.drive;
    clickAmt     = p.click;
    ampDecay     = p.ampDecay;
    pitchDecay   = p.pitchDecay;
    pitchDropAmt = p.pitchDrop;
    punchAmt     = p.punch;
    harmonicMix  = p.harmonic;
    asymAmt      = p.asym;
    bodyGain     = p.body;
    if (p.analog != null) analogAmt = p.analog;
    kickShelf.gain.setTargetAtTime(toneShelfDb, ctx.currentTime, 0.04);
    const effLP = toneLPHz * (1 - analogAmt * 0.25);
    kickLP.frequency.setTargetAtTime(effLP,     ctx.currentTime, 0.04);
    applyDrive();
  }

  // ── Mix / Bypass ─────────────────────────────────────────────────────────
  let bypassed = false;
  let mixVal   = 1.0;
  // Default to passing input through — the 808 is meant to LAYER kicks on
  // top of the incoming track. Generate-Only is opt-in via input mode.
  let inputPass = true;

  function applyMixAndBypass() {
    const t = ctx.currentTime, tau = 0.04;
    if (bypassed) {
      bypassGain.gain.setTargetAtTime(1.0, t, tau);
      dryGain.gain.setTargetAtTime(0,   t, tau);
      wetGain.gain.setTargetAtTime(0,   t, tau);
    } else {
      bypassGain.gain.setTargetAtTime(0, t, tau);
      // Input pass-through is FULL when enabled — Mix knob only controls
      // the kick wet level. This matches generator-plugin convention
      // (Mix = "how loud is the kick I'm generating?").
      dryGain.gain.setTargetAtTime(inputPass ? 1.0 : 0, t, tau);
      wetGain.gain.setTargetAtTime(mixVal, t, tau);
    }
  }
  applyMixAndBypass();

  return {
    input, output, chainOutput: output,

    // Standard rack
    setIn:     v => { inGain.gain.setTargetAtTime(Math.max(0, v),  ctx.currentTime, 0.05); },
    setOut:    v => { outGain.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.05); },
    setMix:    v => { mixVal = Math.max(0, Math.min(1, v)); applyMixAndBypass(); },
    setBypass: on => { bypassed = !!on; applyMixAndBypass(); },
    isBypassed: () => bypassed,

    // Audio interaction modes
    //   'gen'      : generate only (input muted)
    //   'genPass'  : generate + input pass-through
    //   'modulate' : input modulates 808 (pitch follower) — stub: enables passthrough only
    //   'duck'     : sidechain ducks input on each hit
    //   'gate'     : input gates kick (output enabled only when input is loud) — stub
    setInputMode: m => {
      inputPass  = (m !== 'gen');
      duckOnHit  = (m === 'duck');
      applyMixAndBypass();
    },
    setDuckDepth:   v => { duckDepth   = Math.max(0, Math.min(1, v)); },
    setDuckRelease: v => { duckRelease = Math.max(0.01, Math.min(2, v)); },

    // Voice
    setTune:       v => { baseFreq   = v; },
    setPitchTop:   v => { pitchTop   = v; },
    setPitchDecay: v => { pitchDecay = v; },
    setAmpDecay:   v => { ampDecay   = v; },
    setClick:      v => { clickAmt   = v; },
    setDrive:      v => { driveAmt   = Math.max(0, Math.min(1, v)); applyDrive(); },
    setToneShelf:  v => { toneShelfDb = v; kickShelf.gain.setTargetAtTime(v, ctx.currentTime, 0.05); },
    setToneLP:     v => { toneLPHz = v;
      // Analog softens the top end slightly — pulls LP cutoff down up to ~25%.
      const eff = v * (1 - analogAmt * 0.25);
      kickLP.frequency.setTargetAtTime(eff, ctx.currentTime, 0.05);
    },
    // New synth controls
    setPitchDrop:  v => { pitchDropAmt = Math.max(0, Math.min(1, v)); },
    setPunch:      v => { punchAmt     = Math.max(0, Math.min(1, v)); },
    setAnalog:     v => {
      analogAmt = Math.max(0, Math.min(1, v));
      // Re-apply drive & tone so analog warmth/softening updates live
      applyDrive();
      const effLP = toneLPHz * (1 - analogAmt * 0.25);
      kickLP.frequency.setTargetAtTime(effLP, ctx.currentTime, 0.05);
    },
    setHarmonicMix: v => { harmonicMix = Math.max(0, Math.min(1, v)); },
    setAsym:        v => { asymAmt     = Math.max(0, Math.min(1, v)); applyDrive(); },
    setCharacter,
    getCharacter:  () => activeCharacter,

    // Trigger
    trigger:       (v=1) => trigger(v, ctx.currentTime),
    setOnHit:      fn => { onHitFn = fn; },
    setOnStep:     fn => { onStepFn = fn; },

    // Trigger / transport modes
    setTriggerMode: m => { triggerMode = m; },
    getTriggerMode: () => triggerMode,
    setHostPlaying: on => { hostPlaying = !!on; },
    isHostPlaying:  () => hostPlaying,

    // Sequencer
    setBpm: b => { bpm = Math.max(40, Math.min(240, b)); },
    getBpm: () => bpm,
    setPattern: (p, immediate=false) => {
      if (immediate || !pattern) { pattern = p; nextStepIdx = 0; }
      else pendingPattern = p;
    },
    getPatternLabel: () => pattern?.label ?? null,
    getCurrentStep: () => currentStepIdx,
    setQuantize: q => { quantizeMode = q; },

    // Groove engine — modifies WHEN steps schedule, never WHICH steps
    setGrooveType:   t => { grooveType   = (t || 'straight'); },
    getGrooveType:   () => grooveType,
    setGrooveAmount: a => { grooveAmount = Math.max(0, Math.min(1, a)); },
    getGrooveAmount: () => grooveAmount,
    setHumanizeMs:   ms => { humanizeMs  = Math.max(0, Math.min(20, ms)); },
    setAccentAmount: a => { accentAmt    = Math.max(0, Math.min(1, a)); },

    start, stop,
    isRunning: () => isRunning,

    // Meter
    getOutputPeak() {
      ana.getFloatTimeDomainData(buf);
      let m = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] < 0 ? -buf[i] : buf[i];
        if (v > m) m = v;
      }
      peakSm = Math.max(m, peakSm * PEAK_DECAY);
      return peakSm;
    },

    dispose() {
      stop();
      try { input.disconnect(); output.disconnect(); } catch {}
    },
  };
}

// ── Pattern library (exported so the Orb + tests share one source of truth) ─
// stepDiv = beat fraction per step:
//   0.25  = 16th notes   (4 steps per beat, 16 steps = one bar of 4/4)
//   0.5   = 8th notes
//   1/3   = 8th-note triplets (3 steps per beat)
export const PATTERNS = [
  { id: '4onfloor',  label: '4 on Floor',  stepDiv: 0.25,
    steps: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0] },
  { id: '34pulse',   label: '3/4 Pulse',   stepDiv: 0.25,
    steps: [1,0,0,0, 1,0,0,0, 1,0,0,0] }, // 12-step (3/4 bar of 16ths)
  { id: 'halftime',  label: 'Halftime',    stepDiv: 0.25,
    steps: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0] },
  { id: 'doubletime',label: 'Double Time', stepDiv: 0.25,
    steps: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0] },
  { id: 'trapsparse',label: 'Trap Sparse', stepDiv: 0.25,
    steps: [1,0,0,0, 0,0,0,0.7, 0,0,1,0, 0,0,0,0] },
  { id: 'trapbusy',  label: 'Trap Busy',   stepDiv: 0.25,
    steps: [1,0,0.6,0, 0,0.6,0,1, 0.8,0,0,0.7, 0,0.6,0,1] },
  { id: 'syncbounce',label: 'Sync Bounce', stepDiv: 0.25,
    steps: [1,0,0,0.8, 0,0,1,0, 1,0,0,0.8, 0,0,1,0] },
  { id: 'dotted',    label: 'Dotted',      stepDiv: 0.25,
    steps: [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0] },
  { id: 'triplet',   label: 'Triplet',     stepDiv: 1/3,
    steps: [1,0,0, 1,0,0, 1,0,0, 1,0,0] },
  { id: 'offbeat',   label: 'Offbeat',     stepDiv: 0.25,
    steps: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0] },
];

export function patternById(id) { return PATTERNS.find(p => p.id === id) || PATTERNS[0]; }

// ── Character presets (single source of truth) ──────────────────────────────
// Used by the engine internally AND read by the Orb so the visible knob
// values stay in sync with whatever the active character set them to.
// All presets are level-balanced within ±1 dB.
export const CHARACTERS = {
  Warm:     { toneShelfDb:  4, toneLPHz: 4500, drive: 0.10, click: 0.10,
              ampDecay: 0.85, pitchDecay: 0.060, pitchDrop: 0.40, punch: 0.20,
              harmonic: 0.28, asym: 0.30, body: 0.98, analog: 0.70 },
  Saturate: { toneShelfDb:  2, toneLPHz: 5500, drive: 0.55, click: 0.20,
              ampDecay: 0.70, pitchDecay: 0.050, pitchDrop: 0.50, punch: 0.35,
              harmonic: 0.30, asym: 0.40, body: 0.86, analog: 0.55 },
  Punch:    { toneShelfDb:  1, toneLPHz: 7000, drive: 0.18, click: 0.40,
              ampDecay: 0.45, pitchDecay: 0.030, pitchDrop: 0.65, punch: 0.80,
              harmonic: 0.16, asym: 0.18, body: 0.95, analog: 0.30 },
  Tight:    { toneShelfDb:  0, toneLPHz: 5500, drive: 0.14, click: 0.28,
              ampDecay: 0.30, pitchDecay: 0.035, pitchDrop: 0.50, punch: 0.50,
              harmonic: 0.14, asym: 0.18, body: 0.95, analog: 0.35 },
  Boom:     { toneShelfDb:  6, toneLPHz: 4000, drive: 0.10, click: 0.08,
              ampDecay: 2.40, pitchDecay: 0.085, pitchDrop: 0.35, punch: 0.15,
              harmonic: 0.20, asym: 0.20, body: 1.02, analog: 0.65 },
  Crunch:   { toneShelfDb:  1, toneLPHz: 5000, drive: 0.80, click: 0.30,
              ampDecay: 0.60, pitchDecay: 0.045, pitchDrop: 0.55, punch: 0.45,
              harmonic: 0.22, asym: 0.50, body: 0.78, analog: 0.55 },
};
