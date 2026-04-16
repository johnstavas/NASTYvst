// tapeEngine.js — Tascam 424 Portastudio Mk.I "tape preamp" emulator
//
// Faithful to the actual 424 Mk.I dry audio path schematic: a two-op-amp
// channel strip (LM833 input gain + NJM4565D output buffer) with a passive
// Baxandall EQ between them. Mk.gee's signature drive comes from pushing
// the LM833 into soft clip via the INPUT/Trim pot — the NJM4565D buffer at
// the end adds a fixed ~+10 dB of gain and chips in a little grit when
// the EQ has boosted content hot enough to push it too.
//
// On top of the faithful preamp circuit we layer the tape-mechanism vibe
// (sticky compression, head bump, drive-dependent HF rolloff, optional wow
// & flutter, optional hiss) that the user originally asked for. The faith-
// ful preamp gives you the Mk.gee guitar tone; the tape stack gives you
// the cassette feel.
//
// ──────────────────────────────────────────────────────────────────────────
// Signal chain (★ = exposed user control)
// ──────────────────────────────────────────────────────────────────────────
//   input → drivePreGain                              ★ "INPUT" / Trim pot
//         → preEmphasis (+6 dB LF shelf)              (LF hits clipper hotter)
//         → ic1Clipper (LM833 soft clip)              ★ PRIMARY saturation
//         → deEmphasis (−6 dB LF shelf)               (cancels pre, harmonics stay)
//         → bass   (Baxandall lowshelf 100 Hz ±10 dB) ★ user knob
//         → treble (Baxandall highshelf 10 kHz ±10dB) ★ user knob
//         → outputBufferGain (+10 dB fixed)           (IC2B's R10/R11 gain)
//         → ic2Clipper (NJM4565D mild secondary clip) (extra grit when EQ is hot)
//         → tapeComp (DynamicsCompressor)             ★ THE STICKY GLUE
//         → dcBlock                                   (kills clipper DC offset)
//         → headBump (peak ~90 Hz)                    (playback head LF resonance)
//         → hfRolloff (lowpass, drive-dependent)      (bias HF self-erasure)
//         → wfDelay (delay modulated by wow+flutter)  (transport wobble)
//         → outputTrim                                 ★ "VOLUME" / Master
//   noise → noiseHPF → noiseGain ─────────────────────┘  (sums in pre-trim)
//
// ──────────────────────────────────────────────────────────────────────────
// Why a soft op-amp clipper PLUS a slow-release compressor?
// ──────────────────────────────────────────────────────────────────────────
// "Sticky tape sound" is a two-stage phenomenon:
//
//   1. The waveshaper rounds the *peaks* of every transient. That gives you
//      the smooth, even-harmonic warmth and the lack of harsh upper-mid
//      grit — what makes pushed tape sound musical instead of fizzy.
//
//   2. The compressor squashes the *envelope* with a fast attack and a slow
//      release. That's what makes everything "stick together" — peaks get
//      caught, the gain reduction takes ~180 ms to recover, so the ear
//      perceives a constant, dense level even on percussive material. THIS
//      is the glue that nothing else in the chain can give you.
//
// A waveshaper alone gives you saturation but not glue. A compressor alone
// gives you pumping but not warmth. You need both, in that order, to get
// the 424's signature.
//
// ──────────────────────────────────────────────────────────────────────────
// HF self-erasure (bias compression)
// ──────────────────────────────────────────────────────────────────────────
// On real cassette, when you push the input level high, the magnetic field
// in the recording head is strong enough that it partially erases the HF
// content it's trying to lay down. The result: the more you drive the tape,
// the duller it sounds. We model this by sliding the lowpass corner DOWN as
// drive goes UP (`setDrive` modulates `hfRolloff.frequency`).
//
//   drive 0 dB  → corner ≈ 13 kHz   (open and crisp)
//   drive +6 dB → corner ≈ 11 kHz
//   drive +12dB → corner ≈  9 kHz
//   drive +18dB → corner ≈  7 kHz   (proper lo-fi sticky tape)
//
// This is what makes the saturation feel smooth instead of harsh — the
// fizz is automatically removed as you push.

export function createTapeEngine(ctx) {
  // === I/O ===
  const input       = ctx.createGain();
  const output      = ctx.createGain();
  const chainOutput = ctx.createGain();

  // === Drive stage ===
  const drivePreGain = ctx.createGain(); drivePreGain.gain.value = 1;

  // ── Pre-emphasis chain ────────────────────────────────────────────────────
  // Two shelves before the clipper, two complementary shelves after, so the
  // OVERALL magnitude response is flat but the clipper sees a frequency-
  // weighted version of the signal. This is what gives us the two physical
  // hallmarks of analog tape — but ALL of these gains are SCALED BY DRIVE in
  // setDrive() below. At INPUT=0 dB they're literally 0 (flat / no shelving)
  // so the clipper barely engages and the module is transparent. The shelves
  // grow in only as the user pushes INPUT, which matches how real analog
  // hardware works: clean at unity, dirty when you crank it.
  //
  //   1. LF pre-emphasis (up to +3 dB shelf at 200 Hz):
  //      lows hit the clipper hotter → more LF/low-mid harmonic distortion,
  //      which is the "warm body" the user described ("adds quite a bit of
  //      low mids"). De-emphasis cancels the magnitude lift so the EQ stays
  //      flat — only the harmonics survive the round trip.
  //
  //   2. HF pre-emphasis (up to +8 dB shelf at 5 kHz):
  //      THIS is the big one. At cassette speed real tape saturates the highs
  //      ∼20 dB sooner than the lows. We model this by lifting the highs
  //      into the clipper much harder than the lows so the highs run out of
  //      headroom first. The post-clipper de-emphasis cuts the highs back
  //      down by the same amount, restoring magnitude flatness AND pulling
  //      the harmonic fizz down with it.
  const preEmphasisLF = ctx.createBiquadFilter();
  preEmphasisLF.type = 'lowshelf';
  preEmphasisLF.frequency.value = 200;
  preEmphasisLF.gain.value = 0;       // OFF at default — scaled by drive

  const preEmphasisHF = ctx.createBiquadFilter();
  preEmphasisHF.type = 'highshelf';
  preEmphasisHF.frequency.value = 5000;
  preEmphasisHF.gain.value = 0;       // OFF at default — scaled by drive

  // IC1A — LM833 input gain stage. The PRIMARY clipper. Pushed by INPUT/Trim,
  // produces the warm dominant-2nd-harmonic soft clip that defines the Mk.gee
  // tone. LM833 is a low-THD audio op-amp so the curve is very gentle —
  // it's the 424's secret that this stage doesn't sound "distorted" at all,
  // it just sounds rounder and warmer the harder you push it.
  const ic1Clipper = ctx.createWaveShaper();
  ic1Clipper.oversample = '4x';

  // De-emphasis chain — perfect inverse of pre-emphasis. The clipper sits
  // between them, so harmonic content generated by clipping is preserved
  // here while the pre-shaping is cancelled. Net magnitude response = flat.
  // Both gains are scaled by drive (mirror of pre-emphasis), so at INPUT=0
  // these are 0 dB and contribute nothing.
  const deEmphasisLF = ctx.createBiquadFilter();
  deEmphasisLF.type = 'lowshelf';
  deEmphasisLF.frequency.value = 200;
  deEmphasisLF.gain.value = 0;

  const deEmphasisHF = ctx.createBiquadFilter();
  deEmphasisHF.type = 'highshelf';
  deEmphasisHF.frequency.value = 5000;
  deEmphasisHF.gain.value = 0;

  // === Baxandall 2-band EQ (Bass / Treble) ===
  // The real 424 channel has these two pots, ±10 dB at 100 Hz and 10 kHz,
  // built from R5/R8/R7 + C5/C6/C7 around IC2A. Wide, musical, "always
  // sounds right" — the Baxandall is the most-used tone control in audio
  // for a reason. Cap range at ±10 dB to match the schematic spec.
  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 100;
  bass.gain.value = 0;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 10000;
  treble.gain.value = 0;

  // === IC2B output buffer — modeled at unity ===
  // R10/R11 in the schematic set the real buffer gain to 1 + 110k/47k ≈ 3.34
  // (about +10.4 dB). In the real unit that gain exists because the channel
  // strip needs to drive the cassette write head; the master fader after it
  // attenuates back down. We DON'T want that here — running a +10 dB stage
  // in the middle of a plugin chain just smashes the file on insertion.
  //
  // Instead we keep the buffer node (so the second clipper still sees a
  // post-EQ signal) but at unity, and we let the user push the second
  // clipper themselves via the INPUT knob. Plenty of grit available, no
  // forced 10 dB boost on every track.
  const outputBufferGain = ctx.createGain();
  outputBufferGain.gain.value = 1.0;        // unity — no fixed boost

  const ic2Clipper = ctx.createWaveShaper();
  ic2Clipper.oversample = '4x';

  // === The sticky tape compressor ===
  // Fast attack catches transients, very slow release means the level
  // takes ~180 ms to recover — that's the audible "glue" that makes
  // everything feel constant and dense. The threshold is SCALED BY DRIVE
  // in setDrive(): at INPUT=0 the threshold sits at +6 dBFS (effectively
  // never triggers, so the module stays transparent), and as the user
  // pushes INPUT the threshold drops down toward -8 dBFS so the comp
  // starts grabbing the loud transients.
  const tapeComp = ctx.createDynamicsCompressor();
  tapeComp.threshold.value = 6;      // way above program — comp idle at default
  tapeComp.knee.value      = 18;     // soft idle — tightens with drive
  tapeComp.ratio.value     = 2.2;    // gentle idle ratio — climbs with drive
  tapeComp.attack.value    = 0.004;  // 4 ms — fast catch on transients
  tapeComp.release.value   = 0.140;  // 140 ms — sticky tail with audible pump

  // DC block — soft asymmetric clippers introduce DC, kill it before it
  // reaches anything stateful.
  const dcBlock = ctx.createBiquadFilter();
  dcBlock.type = 'highpass';
  dcBlock.frequency.value = 12;
  dcBlock.Q.value = 0.707;

  // === Head bump — playback head LF resonance ===
  // Real tape playback heads have a low-frequency resonance around 80–120 Hz.
  // Scaled by drive: 0 dB at INPUT=0, up to +1.5 dB at INPUT=+18.
  const headBump = ctx.createBiquadFilter();
  headBump.type = 'peaking';
  headBump.frequency.value = 90;
  headBump.Q.value = 1.4;
  headBump.gain.value = 0;

  // === Low-mid build (250–400 Hz) ===
  // The user's research nailed it: "[tape] tends to add quite a bit of low
  // mids to the signal, usually somewhere between 250 Hz and 400 Hz." This
  // is the body/warmth that makes pushed tape feel dense without sounding
  // dull. Scaled by drive: 0 dB at INPUT=0, up to ~+4 dB at INPUT=+18.
  const lowMidBuild = ctx.createBiquadFilter();
  lowMidBuild.type = 'peaking';
  lowMidBuild.frequency.value = 320;
  lowMidBuild.Q.value = 0.8;
  lowMidBuild.gain.value = 0;

  // === HF rolloff — bias compression / tape bandwidth ===
  // Base corner is 13 kHz; setDrive() slides this down as drive increases.
  const hfRolloff = ctx.createBiquadFilter();
  hfRolloff.type = 'lowpass';
  hfRolloff.frequency.value = 13000;
  hfRolloff.Q.value = 0.6;

  // === Wow & flutter — modulated delay for pitch wobble ===
  // Two LFOs sum into a delay node's delayTime: slow "wow" (~0.6 Hz) gives
  // the long pitch drift, faster "flutter" (~6 Hz) gives the buttery
  // shimmer. Depth is set by setWowFlutter() — 0 = perfectly stable
  // transport, 1 = noticeably warbled.
  const wfDelay = ctx.createDelay(0.05);
  wfDelay.delayTime.value = 0.005;   // 5 ms baseline so modulation has room

  const wowOsc = ctx.createOscillator();
  wowOsc.type = 'sine';
  wowOsc.frequency.value = 0.55;

  const flutterOsc = ctx.createOscillator();
  flutterOsc.type = 'sine';
  flutterOsc.frequency.value = 6.2;

  const wowDepth     = ctx.createGain(); wowDepth.gain.value     = 0.0;
  const flutterDepth = ctx.createGain(); flutterDepth.gain.value = 0.0;

  wowOsc.connect(wowDepth).connect(wfDelay.delayTime);
  flutterOsc.connect(flutterDepth).connect(wfDelay.delayTime);
  wowOsc.start();
  flutterOsc.start();

  // === Hiss generator ===
  // Authentic compact-cassette tape hiss:
  //   • Source: flat white noise (random magnetization of oxide particles)
  //   • HPF at 3 kHz — tape hiss is most noticeable 3 kHz and above;
  //     everything below that is programme material / head rumble, not hiss
  //   • Presence peak at 6 kHz (+5 dB, Q=1.4) — the characteristic "shhh"
  //     quality of cassette hiss lives here
  //   • Soft LPF at 16 kHz — extends naturally to 15–18 kHz like real tape
  //     without the artificial hard brick of the old 6.5 kHz cutoff
  //   • Amplitude floor: -50 to -60 dBFS (0.003–0.001 linear) so it truly
  //     sits as the noise floor, never foregrounded
  //
  // Three seconds of white noise so the loop period is inaudible.
  const noiseBufLen = ctx.sampleRate * 3;
  const noiseBuf = ctx.createBuffer(2, noiseBufLen, ctx.sampleRate);
  // Fill both channels with independent white noise for a stereo hiss spread
  for (let ch = 0; ch < 2; ch++) {
    const d = noiseBuf.getChannelData(ch);
    for (let i = 0; i < noiseBufLen; i++) d[i] = Math.random() * 2 - 1;
  }

  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  noiseSrc.loop = true;

  // HPF at 3 kHz — removes all low-frequency content, leaving only the
  // high-frequency hiss band (3 kHz → 20 kHz).
  const noiseHPF = ctx.createBiquadFilter();
  noiseHPF.type      = 'highpass';
  noiseHPF.frequency.value = 3000;
  noiseHPF.Q.value         = 0.65;

  // Presence peak at 6 kHz — the "shhh" formant of cassette hiss.
  // Without this the hiss reads as flat air; with it you get the soft
  // rushing quality that's immediately recognisable as tape.
  const noisePresence = ctx.createBiquadFilter();
  noisePresence.type          = 'peaking';
  noisePresence.frequency.value = 6000;
  noisePresence.Q.value         = 1.4;
  noisePresence.gain.value      = 5;

  // Soft LPF at 16 kHz — real tape rolls off here naturally.
  // Keeps the air and sparkle without the harsh digital-static edge.
  const noiseLPF = ctx.createBiquadFilter();
  noiseLPF.type      = 'lowpass';
  noiseLPF.frequency.value = 16000;
  noiseLPF.Q.value         = 0.55;

  const noiseGain = ctx.createGain(); noiseGain.gain.value = 0.0;
  noiseSrc.connect(noiseHPF)
          .connect(noisePresence)
          .connect(noiseLPF)
          .connect(noiseGain);
  noiseSrc.start();

  // === Output trim ===
  const outputTrim = ctx.createGain(); outputTrim.gain.value = 1;

  // === Wire the chain ===
  // 424 schematic order (IC1A clip → Baxandall → output buffer → IC2B clip)
  // wrapped in the tape pre/de-emphasis sandwich (LF + HF shelves either
  // side of IC1A) and followed by the tape-mechanism stack (sticky comp,
  // head bump, low-mid build, HF rolloff, wow/flutter) before the master.
  input.connect(drivePreGain);
  drivePreGain.connect(preEmphasisLF);
  preEmphasisLF.connect(preEmphasisHF);
  preEmphasisHF.connect(ic1Clipper);
  ic1Clipper.connect(deEmphasisHF);
  deEmphasisHF.connect(deEmphasisLF);
  deEmphasisLF.connect(bass);
  bass.connect(treble);
  treble.connect(outputBufferGain);
  outputBufferGain.connect(ic2Clipper);
  ic2Clipper.connect(tapeComp);
  tapeComp.connect(dcBlock);
  dcBlock.connect(headBump);
  headBump.connect(lowMidBuild);
  lowMidBuild.connect(hfRolloff);
  hfRolloff.connect(wfDelay);
  wfDelay.connect(outputTrim);
  noiseGain.connect(outputTrim);   // hiss sums in just before the master trim
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  // === Build IC1A (LM833) clipping curve ===
  // CRITICAL: this curve has unity slope at x=0. Small and mid-amplitude
  // signals pass through PERFECTLY LINEAR — y = x. Only when |x| exceeds
  // the threshold does the soft knee kick in and round off the peak.
  //
  // The previous version normalized peak to ±1 but accidentally had a
  // slope of ~2.6 at the origin, which meant midrange content got +8 dB
  // of unwanted gain just walking through the clipper. That made the
  // module slam the audio even at INPUT=0 and caused the "crazy loud"
  // jump when toggling bypass off (re-entering the gainy chain). With
  // the threshold-knee design below, the chain has UNITY GAIN at default,
  // and only starts shaping the signal when the user pushes INPUT enough
  // to drive amplitude past 0.7 (≈ -3 dBFS).
  //
  // The asymmetric knee (positive lobe a touch tighter than the negative)
  // gives the LM833 its dominant-2nd-harmonic warmth.
  ic1Clipper.curve = (() => {
    const n = 4096;
    const curve = new Float32Array(n);
    const softClip = (x, threshold, asym) => {
      const t = threshold * asym;
      const ax = Math.abs(x);
      if (ax <= t) return x;                 // perfectly linear below threshold
      // Smooth knee above the threshold using tanh — slope continuous at t,
      // asymptotes toward sign(x) (the rail).
      const over = (ax - t) / (1 - t);
      const knee = t + (1 - t) * Math.tanh(over);
      return Math.sign(x) * knee;
    };
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      // More asymmetry on the positive half = stronger 2nd-harmonic /
      // fatter "tube-like" warmth. Threshold dropped from 0.70 → 0.58 so
      // that as soon as the user starts pushing INPUT, the soft knee
      // engages and the LF pre-emphasis content starts generating audible
      // tape-style harmonics — that's "more warm and tape like".
      const asym = x > 0 ? 0.88 : 1.0;
      curve[i] = softClip(x, 0.58, asym);
    }
    return curve;
  })();

  // === Build IC2B (NJM4565D) clipping curve ===
  // Same unity-slope philosophy as IC1A but with a slightly tighter knee
  // (threshold 0.78 instead of 0.70) and symmetric — the NJM4565D output
  // buffer in the real schematic doesn't have the same single-supply
  // asymmetry as the LM833 input stage. Because the input to this stage
  // is post-buffer (now unity), it really only kicks in if the previous
  // stages have summed up to clipping levels.
  ic2Clipper.curve = (() => {
    const n = 4096;
    const curve = new Float32Array(n);
    const softClip = (x, threshold) => {
      const ax = Math.abs(x);
      if (ax <= threshold) return x;
      const over = (ax - threshold) / (1 - threshold);
      const knee = threshold + (1 - threshold) * Math.tanh(over);
      return Math.sign(x) * knee;
    };
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      curve[i] = softClip(x, 0.68);
    }
    return curve;
  })();

  // === Analysers for metering ===
  const inputAnalyser  = ctx.createAnalyser(); inputAnalyser.fftSize  = 2048;
  const outputAnalyser = ctx.createAnalyser(); outputAnalyser.fftSize = 2048;
  input.connect(inputAnalyser);
  outputTrim.connect(outputAnalyser);

  const _inBuf  = new Float32Array(2048);
  const _outBuf = new Float32Array(2048);
  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;

  // ───────────────────────────────────────────────────────────────────────────
  // Setters
  // ───────────────────────────────────────────────────────────────────────────
  let _driveDb = 0;
  function setDrive(db) {
    _driveDb = db;
    const lin = Math.pow(10, db / 20);
    const t   = ctx.currentTime;
    drivePreGain.gain.setTargetAtTime(lin, t, 0.02);

    // ── EVERY tape coloration scales with drive ─────────────────────────────
    // At INPUT = 0 dB:  f = 0  → all coloration nodes are flat / off,
    //                              clipper sees pristine signal,
    //                              comp threshold sits above program.
    // At INPUT = +18 dB: f = 1 → full character.
    //
    // This is what the user asked for: "you shouldnt hear that distortion or
    // that warm tape compresion until you are pushing the gain input."
    const f      = Math.max(0, Math.min(1, db / 18));
    const fEased = f * f;       // squared so the bottom of the range is gentle

    // Pre/de-emphasis shelves — clipper only sees frequency-weighted signal
    // when the user is pushing INPUT. At rest these are flat, so the clipper
    // is essentially bypassed in the audible sense. LF is bigger now so the
    // low-mids hit IC1A harder → more 2nd-harmonic warmth in the body of the
    // sound, which is what gives pushed tape its meat.
    preEmphasisLF.gain.setTargetAtTime( 4.5 * f, t, 0.05);
    preEmphasisHF.gain.setTargetAtTime( 9   * f, t, 0.05);
    deEmphasisLF.gain.setTargetAtTime(-4.5 * f, t, 0.05);
    deEmphasisHF.gain.setTargetAtTime(-9   * f, t, 0.05);

    // Bias compression: HF rolloff slides DOWN as drive goes UP, with a
    // gentle curve that matches the research — "gentle decline above 10
    // kHz–15 kHz, depending on tape speed". At rest the corner sits at
    // 18 kHz (effectively transparent), at max drive it lands around 7.5 kHz
    // for that proper warm/dull pushed-cassette sound.
    const corner = 18000 - fEased * (18000 - 7500);
    hfRolloff.frequency.setTargetAtTime(corner, t, 0.05);

    // Tape-mechanism EQ (head bump and low-mid body) only color the signal
    // when the user is pushing INPUT. Both bumped a bit for more obvious
    // tape body when pushed.
    headBump.gain.setTargetAtTime(    2.2 * f,        t, 0.05);
    lowMidBuild.gain.setTargetAtTime( 5.5 * fEased,   t, 0.05);

    // ── Tape comp scales aggressively with drive ─────────────────────────
    // We sweep three parameters together so the comp transforms from
    // "transparent / never triggers" at idle into a hard squeezing tape
    // glue at full drive:
    //
    //                        idle (f=0)      max (f=1)
    //   threshold (dBFS)        +6               -16
    //   ratio                    2.2              5.5
    //   knee  (dB)              18                 6
    //
    // The wider knee at low drive keeps the onset gentle; the tight knee +
    // low threshold + high ratio at full drive give you the audible
    // squashing/pumping the user asked for.
    const compThresh = 6 - f * 22;
    const compRatio  = 2.2 + f * 3.3;
    const compKnee   = 18  - f * 12;
    tapeComp.threshold.setTargetAtTime(compThresh, t, 0.05);
    tapeComp.ratio    .setTargetAtTime(compRatio,  t, 0.05);
    tapeComp.knee     .setTargetAtTime(compKnee,   t, 0.05);

    // NOTE: no hidden auto-makeup. The UI compensates visibly via the
    // Volume slider — see TapeOrb.handleDriveChange + compensationDb.
  }

  function setBass(db)      { bass.gain.setTargetAtTime(db,    ctx.currentTime, 0.02); }
  function setTreble(db)    { treble.gain.setTargetAtTime(db,  ctx.currentTime, 0.02); }
  function setOutputTrim(db) {
    outputTrim.gain.setTargetAtTime(Math.pow(10, db / 20), ctx.currentTime, 0.02);
  }

  // 0..1 → wow/flutter modulation depth in seconds of peak deviation.
  // Bumped to ~3× the previous values so the wobble is actually audible:
  //   wow     0.0040 s  → ±4 ms slow drift = obvious pitch shimmer
  //   flutter 0.0012 s  → ±1.2 ms fast wobble = the "tape weeping" character
  // We also use a quadratic curve so the bottom of the slider is gentle and
  // the top is dramatic — the user has range to play with.
  function setWowFlutter(amount) {
    const a  = Math.max(0, Math.min(1, amount));
    const a2 = a * (0.4 + 0.6 * a);    // soft toe, full top
    wowDepth.gain.setTargetAtTime(0.0040 * a2, ctx.currentTime, 0.05);
    flutterDepth.gain.setTargetAtTime(0.0012 * a2, ctx.currentTime, 0.05);
  }

  // 0..1 → hiss level.
  // At amount=1.0 → gain ≈ 0.006 ≈ -44 dBFS (loud cassette noise floor).
  // At amount=0.5 → gain ≈ 0.002 ≈ -54 dBFS (typical well-maintained deck).
  // Quadratic curve gives fine control at low settings where hiss lives.
  function setHiss(amount) {
    const a = Math.max(0, Math.min(1, amount));
    noiseGain.gain.setTargetAtTime(0.006 * a * a, ctx.currentTime, 0.05);
  }

  // Click-free bypass: ramp output silent, swap routing during the gap,
  // ramp back up. Two-stage ramps with a 12 ms gap so the swap happens
  // while the output gain is at zero — no transients, no pops.
  //
  // CRITICAL: we track the current bypass state internally and bail out if
  // the requested state already matches. Without this, the very first
  // setBypass(false) call on a freshly-constructed engine would ADD a
  // SECOND `input → drivePreGain` connection on top of the one made during
  // construction (line 291). Web Audio sums duplicate connections, so the
  // signal entering drivePreGain would be 2× — exactly +6 dB of phantom
  // gain at "default" settings. That's why a zeroed-out 424 was reading
  // +6 dB hotter on the OUT meter than the IN meter.
  let _bypassed = false;   // matches the post-construction routing
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;   // no-op — routing already correct
    _bypassed = want;

    const t = ctx.currentTime;
    const FADE = 0.012;
    const GAP  = FADE + 0.002;

    // Stage 1: fade out
    output.gain.cancelScheduledValues(t);
    output.gain.setValueAtTime(output.gain.value, t);
    output.gain.linearRampToValueAtTime(0, t + FADE);

    // Stage 2: swap routing during the silence
    setTimeout(() => {
      if (want) {
        try { input.disconnect(drivePreGain); } catch {}
        try { input.connect(outputTrim);      } catch {}
      } else {
        try { input.disconnect(outputTrim);   } catch {}
        try { input.connect(drivePreGain);    } catch {}
      }
      // Stage 3: fade back up
      const t2 = ctx.currentTime;
      output.gain.cancelScheduledValues(t2);
      output.gain.setValueAtTime(0, t2);
      output.gain.linearRampToValueAtTime(1, t2 + FADE);
    }, GAP * 1000);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Metering
  // ───────────────────────────────────────────────────────────────────────────
  function _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function getInputLevel()  { inputAnalyser.getFloatTimeDomainData(_inBuf);   return _rms(_inBuf);  }
  function getOutputLevel() { outputAnalyser.getFloatTimeDomainData(_outBuf); return _rms(_outBuf); }
  function getInputPeak()   { const l=getInputLevel(),  n=ctx.currentTime; if(l>iPeak||n-iPeakT>2){iPeak=l;iPeakT=n;} return iPeak; }
  function getOutputPeak()  { const l=getOutputLevel(), n=ctx.currentTime; if(l>oPeak||n-oPeakT>2){oPeak=l;oPeakT=n;} return oPeak; }
  function getCompReduction() { return tapeComp.reduction; }   // ≤ 0 dB

  function destroy() {
    try { wowOsc.stop();     } catch {}
    try { flutterOsc.stop(); } catch {}
    try { noiseSrc.stop();   } catch {}
  }

  return {
    ctx, input, output, chainOutput,
    setDrive,
    setBass, setTreble,
    setOutputTrim,
    setWowFlutter, setHiss,
    setBypass,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
    getCompReduction,
    destroy,
  };
}
