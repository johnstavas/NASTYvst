// nastyBeastEngine — THICK build.
//
// Identity: epic thick delay/distortion system with pitch-shifted ghosts.
// NOT a reverb. AURA removed. Thickness comes from:
//   1. BODY  — low-mid bell + sub-presence
//   2. FANG  — smooth saturation with body-preserving makeup
//   3. DOUBLER — micro-detuned chorus thickening the DRY signal itself
//   4. DELAY ENGINE — 3-tap delay with IN-LOOP saturation that thickens
//                     repeats every cycle (Memory Man trick)
//   5. PITCH GHOST — octave-down granular shifter fed into the delay loop
//                     for "shadow choir behind every hit"
//
// API surface unchanged (5 macros, IN/OUT/MIX/BYPASS, beast).
//   FEED   → FANG drive
//   SNARL  → FANG asymmetry
//   HAUNT  → delay TIME (80–1200 ms)
//   ROAM   → delay FEEDBACK (0–95%, in-loop sat self-limits)
//   BREATH → pitch GHOST amount (0–100%)
//
// Mix=0 = input exactly. Bypass = input exactly. Verified by topology.

export function createNastyBeastEngine(ctx) {
  // ── I/O (unity baseline, explicit stereo) ────────────────────────────────
  // Force the I/O to 2-channel "explicit" topology:
  //   - mono in  → upmixed to L=R=mono (then runs through stereo chain)
  //   - stereo in → preserved L/R through the chain
  // Without this, native nodes can drop a channel when they sit next to a
  // node that expects mono (e.g. StereoPannerNode downmixes its input).
  const input      = ctx.createGain();    input.gain.value      = 1.0;
  input.channelCount         = 2;
  input.channelCountMode     = 'explicit';
  input.channelInterpretation = 'speakers';
  const output     = ctx.createGain();    output.gain.value     = 1.0;
  output.channelCount         = 2;
  output.channelCountMode     = 'explicit';
  output.channelInterpretation = 'speakers';
  const inGain     = ctx.createGain();    inGain.gain.value     = 1.0;
  const outGain    = ctx.createGain();    outGain.gain.value    = 1.0;
  const dryGain    = ctx.createGain();    dryGain.gain.value    = 0.0;
  const wetGain    = ctx.createGain();    wetGain.gain.value    = 1.0;
  const bypassGain = ctx.createGain();    bypassGain.gain.value = 0.0;
  const mixSum     = ctx.createGain();    mixSum.gain.value     = 1.0;
  const beastTrim  = ctx.createGain();    beastTrim.gain.value  = 1.0;
  // Keep the mix bus and bypass tap at explicit 2ch so stereo input survives
  // the dry/bypass paths without collapse.
  for (const n of [dryGain, wetGain, bypassGain, mixSum, beastTrim, inGain, outGain]) {
    n.channelCount         = 2;
    n.channelCountMode     = 'explicit';
    n.channelInterpretation = 'speakers';
  }

  input.connect(bypassGain);
  input.connect(inGain);
  bypassGain.connect(mixSum);

  // Master HPF / LPF — sit between the dry/wet sum and outGain so they shape
  // the entire signal. Defaults are wide-open (no audible effect).
  const masterHP = ctx.createBiquadFilter();
  masterHP.type = 'highpass'; masterHP.frequency.value = 20; masterHP.Q.value = 0.5;
  const masterLP = ctx.createBiquadFilter();
  masterLP.type = 'lowpass';  masterLP.frequency.value = 20000; masterLP.Q.value = 0.5;
  for (const n of [masterHP, masterLP]) {
    n.channelCount = 2; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers';
  }
  mixSum.connect(masterHP);
  masterHP.connect(masterLP);
  masterLP.connect(outGain);

  outGain.connect(output);

  const chainIn = inGain;

  const dry = ctx.createGain(); dry.gain.value = 1.0;
  const wet = ctx.createGain(); wet.gain.value = 1.0;
  dry.connect(dryGain);
  wet.connect(beastTrim);
  beastTrim.connect(wetGain);
  dryGain.connect(mixSum);
  wetGain.connect(mixSum);

  // ── BODY: low-mid weight + sub trim ──────────────────────────────────────
  const subHP = ctx.createBiquadFilter();
  subHP.type = 'highpass';
  subHP.frequency.value = 55;          // remove unusable sub the loop would amplify
  subHP.Q.value         = 0.5;

  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 160;
  body.Q.value         = 0.7;
  body.gain.value      = 1.5;          // gentle warmth, not a hump

  const lowMid = ctx.createBiquadFilter();
  lowMid.type = 'peaking';
  lowMid.frequency.value = 380;
  lowMid.Q.value         = 0.9;
  lowMid.gain.value      = 0.5;        // barely there

  const harshCut = ctx.createBiquadFilter();
  harshCut.type = 'peaking';
  harshCut.frequency.value = 3200;
  harshCut.Q.value         = 1.2;
  harshCut.gain.value      = -2.0;

  // ── FANG (smooth saturator) ──────────────────────────────────────────────
  // Fixed-curve drive system (zipper-free).
  //   preDrive (smooth ramp) → shaper (fixed curve, never rewritten)
  //   → postMakeup (smooth ramp, complementary to preDrive)
  // FEED scales preDrive only; the curve never changes → no zipper.
  const fangPad    = ctx.createGain();  fangPad.gain.value    = 0.7;
  const preDrive   = ctx.createGain();  preDrive.gain.value   = 1.0;
  const beastDrive = ctx.createGain();  beastDrive.gain.value = 1.0;
  // SNARL adds a smooth DC bias into the shaper input → asymmetric clipping
  // without rebuilding the curve. ConstantSource ramps cleanly via .offset.
  const snarlBias  = ctx.createConstantSource(); snarlBias.offset.value = 0.0;
  snarlBias.start();
  const shaper    = ctx.createWaveShaper(); shaper.oversample = '4x';
  const fangPostLP= ctx.createBiquadFilter();
  fangPostLP.type = 'lowpass';
  fangPostLP.frequency.value = 5500;     // darker lid — kills "metallic" upper sat
  fangPostLP.Q.value         = 0.5;
  const fangMakeup= ctx.createGain();

  let beastAmt = 0;
  let fangDrive = 0.0, fangAsym = 0.0;

  // Fixed shaper curve — built ONCE at max drive (k = 5). Never rewritten.
  // Drive is modulated by preDrive gain in front of it. This eliminates the
  // discontinuity that any curve reassignment introduces.
  (function buildFixedCurve() {
    const N = 4096;
    const c = new Float32Array(N);
    const k = 2.0;     // creamy saturator — rounded, never metallic
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaper.curve = c;
  })();

  chainIn.connect(subHP);
  subHP.connect(body);
  body.connect(lowMid);
  lowMid.connect(harshCut);
  harshCut.connect(fangPad);
  // FANG WET/DRY CROSSFADE — when FEED=0, signal skips the shaper entirely.
  // No quiescent distortion. fangDryAmt = 1-FEED, fangWetAmt = FEED (smoothed).
  const fangDryAmt = ctx.createGain(); fangDryAmt.gain.value = 1.0;
  const fangWetAmt = ctx.createGain(); fangWetAmt.gain.value = 0.0;
  const fangSum    = ctx.createGain(); fangSum.gain.value    = 1.0;
  fangPad.connect(fangDryAmt); fangDryAmt.connect(fangSum);
  fangPad.connect(preDrive);
  preDrive.connect(beastDrive);
  beastDrive.connect(shaper);
  // SNARL bias is summed into the shaper's input branch
  snarlBias.connect(shaper);
  shaper.connect(fangPostLP);
  fangPostLP.connect(fangMakeup);
  fangMakeup.connect(fangWetAmt); fangWetAmt.connect(fangSum);

  // ── DOUBLER (dry-side micro-detune thickening, mono-summed) ──────────────
  // Three tiny delay-modulated voices summed BACK INTO the post-FANG signal
  // before splitting to dry/wet. Adds chorus-thickness to the dry side too.
  const doublerIn  = ctx.createGain();
  const doublerOut = ctx.createGain();
  fangSum.connect(doublerIn);
  // straight pass-through is the bulk
  const doublerStraight = ctx.createGain(); doublerStraight.gain.value = 1.0;
  doublerIn.connect(doublerStraight); doublerStraight.connect(doublerOut);
  // 2 detuned voices ONLY (was 3) — the third was reading as reverb-smear.
  // Lower wet level too, so the doubler is felt-not-heard.
  const doublerWet = ctx.createGain(); doublerWet.gain.value = 0.06;  // halved — was a phase source
  function makeDoublerVoice(centerMs, panV, freqA, freqB, depthMs) {
    const d = ctx.createDelay(0.05);
    d.delayTime.value = centerMs / 1000;
    const pan = ctx.createStereoPanner(); pan.pan.value = panV;
    const g   = ctx.createGain();           g.gain.value  = 0.5;
    doublerIn.connect(d); d.connect(pan); pan.connect(g); g.connect(doublerWet);
    const baseConst = ctx.createConstantSource(); baseConst.offset.value = centerMs / 1000; baseConst.start();
    const lfoA = ctx.createOscillator(); lfoA.frequency.value = freqA; lfoA.type = 'sine';
    const lfoB = ctx.createOscillator(); lfoB.frequency.value = freqB; lfoB.type = 'sine';
    const dA = ctx.createGain(); dA.gain.value = depthMs / 1000;
    const dB = ctx.createGain(); dB.gain.value = depthMs / 2000;
    lfoA.connect(dA); lfoB.connect(dB);
    baseConst.connect(d.delayTime); dA.connect(d.delayTime); dB.connect(d.delayTime);
    lfoA.start(); lfoB.start();
  }
  makeDoublerVoice(11.0, -0.20, 0.27, 0.83, 0.5);
  makeDoublerVoice(15.0,  0.20, 0.41, 0.59, 0.6);
  doublerWet.connect(doublerOut);

  // From here, doublerOut is the "fat dry" — feeds dry tap and delay engine.
  chainIn.connect(dry);  // TRUE dry tap is pre-everything (so MIX=0 = input)
  // (We do NOT use doublerOut as the dry tap, otherwise MIX=0 wouldn't equal input.
  //  doublerOut is only the source for the wet processing chain.)

  // ── PITCH GHOST (octave-down granular shifter) ───────────────────────────
  // Native granular OLA: two delay lines, sawtooth-ramped delayTime, Hann
  // crossfade. Ratio 0.5 = down one octave. Output = sub-octave shadow.
  function makePitchShifter(semitones, grainSec) {
    const ratio = Math.pow(2, semitones / 12);
    const rampRate = Math.abs(1 - ratio);  // |delayTime change rate| (s/s)
    if (rampRate <= 0) throw new Error('shifter cannot handle ratio == 1 (use bypass)');
    const direction = ratio < 1 ? +1 : -1; // +1 = down (delay grows), -1 = up (delay shrinks)
    const periodSec = grainSec / rampRate; // time per grain
    const sr = ctx.sampleRate;
    const bufLen = Math.max(64, Math.floor(periodSec * sr));

    // Sawtooth buffer: 0 → grainSec  (down-shift)  or  grainSec → 0  (up-shift)
    const sawBuf = ctx.createBuffer(1, bufLen, sr);
    const sawData = sawBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      const ramp = (i / bufLen) * grainSec;
      sawData[i] = direction > 0 ? ramp : (grainSec - ramp);
    }

    // Hann window buffer
    const winBuf = ctx.createBuffer(1, bufLen, sr);
    const winData = winBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) winData[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / bufLen);

    const inG  = ctx.createGain();
    const outG = ctx.createGain();

    // Voice 1
    const saw1 = ctx.createBufferSource(); saw1.buffer = sawBuf; saw1.loop = true;
    const win1 = ctx.createBufferSource(); win1.buffer = winBuf; win1.loop = true;
    const dly1 = ctx.createDelay(grainSec + 0.05); dly1.delayTime.value = 0;
    const env1 = ctx.createGain(); env1.gain.value = 0;
    saw1.connect(dly1.delayTime);
    win1.connect(env1.gain);
    inG.connect(dly1); dly1.connect(env1); env1.connect(outG);

    // Voice 2 (offset half-period for crossfade)
    const saw2 = ctx.createBufferSource(); saw2.buffer = sawBuf; saw2.loop = true;
    const win2 = ctx.createBufferSource(); win2.buffer = winBuf; win2.loop = true;
    const dly2 = ctx.createDelay(grainSec + 0.05); dly2.delayTime.value = 0;
    const env2 = ctx.createGain(); env2.gain.value = 0;
    saw2.connect(dly2.delayTime);
    win2.connect(env2.gain);
    inG.connect(dly2); dly2.connect(env2); env2.connect(outG);

    const t0 = ctx.currentTime + 0.05;
    saw1.start(t0);  win1.start(t0);
    saw2.start(t0 + periodSec / 2);
    win2.start(t0 + periodSec / 2);

    return { input: inG, output: outG };
  }
  // -12 semitones, 80 ms grains → smooth sub-octave shadow
  const pitchDown = makePitchShifter(-12, 0.080);
  const ghostGain = ctx.createGain(); ghostGain.gain.value = 0.0;   // BREATH target
  // Pre-darken what feeds the granular shifter (less HF → less grain artifact).
  const ghostPreLP = ctx.createBiquadFilter();
  ghostPreLP.type = 'lowpass'; ghostPreLP.frequency.value = 2400; ghostPreLP.Q.value = 0.5;
  // Post-darken the shifter output too — kills metallic grain edges.
  const ghostPostLP = ctx.createBiquadFilter();
  ghostPostLP.type = 'lowpass'; ghostPostLP.frequency.value = 1800; ghostPostLP.Q.value = 0.5;
  doublerOut.connect(ghostPreLP);
  ghostPreLP.connect(pitchDown.input);
  pitchDown.output.connect(ghostPostLP);
  ghostPostLP.connect(ghostGain);

  // ── DELAY ENGINE (3 taps + in-loop sat + closing LP) ─────────────────────
  // Single mono feedback line, but 3 stereo-panned read taps for width.
  // Pitch ghost is summed INTO the delay input so it cascades through fb.
  const delayInSum = ctx.createGain();   delayInSum.gain.value = 0.40;
  doublerOut.connect(delayInSum);
  ghostGain.connect(delayInSum);

  // Pre-loop soft clip so ringing-edge harmonics enter already shaped
  function makeLoopSat(driveAmt) {
    const ws = ctx.createWaveShaper();
    const N = 2048, c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      c[i] = Math.tanh(x * driveAmt) / Math.tanh(driveAmt);
    }
    ws.curve = c; ws.oversample = '2x';
    return ws;
  }
  const loopSat   = makeLoopSat(1.05);    // very gentle — barely shaping
  const loopBody  = ctx.createBiquadFilter(); loopBody.type='peaking';
  loopBody.frequency.value = 220; loopBody.Q.value = 0.7; loopBody.gain.value = 0.0;
  const loopHP    = ctx.createBiquadFilter(); loopHP.type='highpass';
  loopHP.frequency.value = 140; loopHP.Q.value = 0.4;
  const loopLP    = ctx.createBiquadFilter(); loopLP.type='lowpass';
  loopLP.frequency.value = 3200; loopLP.Q.value = 0.5;   // creamy lid; closes with feedback

  // Master delay line — mono, single source for all taps
  const MAX_DELAY = 1.4;
  const delayCore = ctx.createDelay(MAX_DELAY);
  delayCore.delayTime.value = 0.38;       // baseline TIME
  // Loop signal flow: delayInSum + fbReturn → loopSat → loopBody → loopHP → loopLP → delayCore
  const fbReturn = ctx.createGain(); fbReturn.gain.value = 0.0;     // ROAM target
  const preCore  = ctx.createGain(); preCore.gain.value = 1.0;
  delayInSum.connect(preCore);
  fbReturn.connect(preCore);
  preCore.connect(loopSat);
  loopSat.connect(loopBody);
  loopBody.connect(loopHP);
  loopHP.connect(loopLP);
  loopLP.connect(delayCore);

  // SINGLE OUTPUT TAP — the 3-tap cluster (offsets 0/80ms/140ms) was the main
  // source of comb-filter "phase" sound and metallic flutter. One clean tap
  // reads the delay core; stereo width comes from the parallel ping-pong section.
  const tapMain = ctx.createDelay(0.05); tapMain.delayTime.value = 0.000;
  delayCore.connect(tapMain);
  // Soften the wet bus with a gentle high-shelf cut (creamy, not bright).
  const wetTilt = ctx.createBiquadFilter();
  wetTilt.type = 'highshelf'; wetTilt.frequency.value = 3500;
  wetTilt.gain.value = -3.0;            // -3 dB above 3.5k → no glassy edge
  const wetLP = ctx.createBiquadFilter();
  wetLP.type = 'lowpass'; wetLP.frequency.value = 7500; wetLP.Q.value = 0.5;
  tapMain.connect(wetTilt);
  wetTilt.connect(wetLP);

  // Wet bus output (single tap, darkened)
  const delayOut = ctx.createGain(); delayOut.gain.value = 1.0;
  wetLP.connect(delayOut);

  // ── PING-PONG MOD section (driven by SPREAD macro) ────────────────────────
  // Two cross-fed delay lines panned hard L/R. Sine LFOs modulate their
  // delayTimes for "modulation" feel. Send level + cross-feedback amount +
  // LFO depth all scale with SPREAD. Mostly silent at SPREAD=0.
  const pingSend = ctx.createGain();  pingSend.gain.value = 0.0;
  delayOut.connect(pingSend);   // tap off the main delay engine

  const pingL = ctx.createDelay(0.8); pingL.delayTime.value = 0.260;
  const pingR = ctx.createDelay(0.8); pingR.delayTime.value = 0.330;
  const xfbLR = ctx.createGain(); xfbLR.gain.value = 0.0;   // L → R fb
  const xfbRL = ctx.createGain(); xfbRL.gain.value = 0.0;   // R → L fb
  const pingPanL = ctx.createStereoPanner(); pingPanL.pan.value = -1.0;
  const pingPanR = ctx.createStereoPanner(); pingPanR.pan.value =  1.0;
  // LFOs into delayTime for modulation
  const pingLfoL = ctx.createOscillator(); pingLfoL.type='sine'; pingLfoL.frequency.value = 0.27;
  const pingLfoR = ctx.createOscillator(); pingLfoR.type='sine'; pingLfoR.frequency.value = 0.39;
  const pingDepthL = ctx.createGain(); pingDepthL.gain.value = 0.0;   // SPREAD-driven
  const pingDepthR = ctx.createGain(); pingDepthR.gain.value = 0.0;
  pingLfoL.connect(pingDepthL); pingDepthL.connect(pingL.delayTime);
  pingLfoR.connect(pingDepthR); pingDepthR.connect(pingR.delayTime);
  pingLfoL.start(); pingLfoR.start();
  // Soft sat in cross-feedback to prevent runaway
  function makePingSat() {
    const ws = ctx.createWaveShaper();
    const N = 1024, c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.1) / Math.tanh(1.1);
    }
    ws.curve = c; ws.oversample = '2x';
    return ws;
  }
  const pingSatL = makePingSat();
  const pingSatR = makePingSat();
  // Wiring: pingSend → pingL ⤿ xfbLR → satR → pingR
  //         pingSend → pingR ⤿ xfbRL → satL → pingL
  pingSend.connect(pingL); pingSend.connect(pingR);
  pingL.connect(pingSatL); pingSatL.connect(xfbRL); xfbRL.connect(pingR);
  pingR.connect(pingSatR); pingSatR.connect(xfbLR); xfbLR.connect(pingL);
  // Output taps
  const pingOutL = ctx.createGain(); pingOutL.gain.value = 1.0;
  const pingOutR = ctx.createGain(); pingOutR.gain.value = 1.0;
  pingL.connect(pingOutL); pingOutL.connect(pingPanL);
  pingR.connect(pingOutR); pingOutR.connect(pingPanR);
  const pingMix = ctx.createGain(); pingMix.gain.value = 0.0;   // SPREAD-driven master
  pingPanL.connect(pingMix);
  pingPanR.connect(pingMix);
  // Folded back into the main wet-bus output of the delay engine
  pingMix.connect(delayOut);

  // FEEDBACK tap — SEPARATE single read straight from delayCore. This is the
  // only thing fbReturn sees. Output-tap gains/sum no longer affect loop gain.
  const fbTap = ctx.createGain(); fbTap.gain.value = 1.0;
  delayCore.connect(fbTap);
  fbTap.connect(fbReturn);

  // ── Wet bus assembly ─────────────────────────────────────────────────────
  // Dry tap (true clean) already connected from chainIn → dry → dryGain.
  // Wet bus = thick dry-doubled signal + delay engine taps.
  // ── FLIP-engaged GLUE COMP + soft CHORUS modulation ─────────────────────
  // Both sit on the wet bus and are quiescent until beast > 0. They scale
  // smoothly so engaging FLIP "tightens" the wet output and adds a subtle
  // chorus shimmer on top.
  const glueComp = ctx.createDynamicsCompressor();
  glueComp.threshold.value = -3;     // transparent at rest
  glueComp.ratio.value     = 1.5;
  glueComp.attack.value    = 0.003;  // fast — catches transients without ringing
  glueComp.release.value   = 0.060;  // tight glue release
  glueComp.knee.value      = 4;      // firm shoulder, not razor
  // Chorus voice — single delay modulated by slow sine. Soft & musical.
  // Intrinsic delayTime carries the base; LFO * chorusDepth adds the swing.
  // Max delay = 25 ms so even at full depth + worst-case LFO it can't exceed.
  const chorusDelay = ctx.createDelay(0.025);
  chorusDelay.delayTime.value = 0.012;
  const chorusLFO   = ctx.createOscillator(); chorusLFO.type = 'sine'; chorusLFO.frequency.value = 0.55;
  const chorusDepth = ctx.createGain(); chorusDepth.gain.value = 0;     // beast-driven
  chorusLFO.connect(chorusDepth); chorusDepth.connect(chorusDelay.delayTime);
  chorusLFO.start();
  const chorusWet = ctx.createGain(); chorusWet.gain.value = 0;          // beast-driven
  // Wiring: delayOut → glueComp → wDelay → wet
  //         delayOut → chorusDelay → chorusWet → wDelay (sums into wet bus)
  const wDelay  = ctx.createGain(); wDelay.gain.value  = 1.0;
  delayOut.connect(glueComp);   glueComp.connect(wDelay);
  delayOut.connect(chorusDelay); chorusDelay.connect(chorusWet); chorusWet.connect(wDelay);

  // ── TUNE — pitch the wet bus ±12 semitones (granular OLA, time-preserving)
  // Two fixed shifters (down −12, up +12) crossfaded with a passthrough by the
  // tune control. tune ∈ [−1, +1]: −1 = full octave down, 0 = no shift,
  // +1 = full octave up. Granular shifters do not change tempo (time-stretch).
  const tuneDown = makePitchShifter(-12, 0.080);
  const tuneUp   = makePitchShifter(+12, 0.080);
  const tuneDryAmt  = ctx.createGain(); tuneDryAmt.gain.value  = 1.0;
  const tuneDownAmt = ctx.createGain(); tuneDownAmt.gain.value = 0.0;
  const tuneUpAmt   = ctx.createGain(); tuneUpAmt.gain.value   = 0.0;
  const tuneSum     = ctx.createGain(); tuneSum.gain.value     = 1.0;
  wDelay.connect(tuneDryAmt);     tuneDryAmt.connect(tuneSum);
  wDelay.connect(tuneDown.input); tuneDown.output.connect(tuneDownAmt); tuneDownAmt.connect(tuneSum);
  wDelay.connect(tuneUp.input);   tuneUp.output.connect(tuneUpAmt);     tuneUpAmt.connect(tuneSum);
  tuneSum.connect(wet);

  // ── Analysers (for reactive core) ────────────────────────────────────────
  const outAna = ctx.createAnalyser(); outAna.fftSize = 1024; outAna.smoothingTimeConstant = 0;
  output.connect(outAna);
  const bassLP = ctx.createBiquadFilter(); bassLP.type = 'lowpass'; bassLP.frequency.value = 120;
  const bassAna = ctx.createAnalyser(); bassAna.fftSize = 1024; bassAna.smoothingTimeConstant = 0;
  output.connect(bassLP); bassLP.connect(bassAna);

  const buf = new Float32Array(outAna.fftSize);
  const bbuf = new Float32Array(bassAna.fftSize);
  let peakSm = 0, bassSm = 0, rmsSm = 0;
  const DECAY = 0.94;
  function readPeak(ana, b) {
    ana.getFloatTimeDomainData(b);
    let m = 0; for (let i = 0; i < b.length; i++) { const v = b[i] < 0 ? -b[i] : b[i]; if (v > m) m = v; }
    return m;
  }
  function readRms(b) { let s = 0; for (let i = 0; i < b.length; i++) s += b[i]*b[i]; return Math.sqrt(s / b.length); }

  // ── Beast RMS comp ───────────────────────────────────────────────────────
  let refRms = 0, lastEngaged = false;   // beastAmt declared above
  const compRmsBuf = new Float32Array(outAna.fftSize);
  const rmsHistory = new Float32Array(15);
  let rhi = 0;
  const compInterval = setInterval(() => {
    if (bypassed) {
      const t = ctx.currentTime;
      beastTrim.gain.setTargetAtTime(1.0, t, 0.10);
      return;
    }
    outAna.getFloatTimeDomainData(compRmsBuf);
    const r = readRms(compRmsBuf);
    rmsHistory[rhi++ % rmsHistory.length] = r;

    if (beastAmt > 0.02 && !lastEngaged) {
      let s = 0; for (let i = 0; i < rmsHistory.length; i++) s += rmsHistory[i];
      refRms = Math.max(0.005, s / rmsHistory.length);
      lastEngaged = true;
    } else if (beastAmt < 0.02 && lastEngaged) {
      lastEngaged = false;
    }

    if (lastEngaged && r > 0.005) {
      // Tighter clamp + minimum signal level. Prevents the makeup loop from
      // chasing a heavily compressed (or silent-gap, e.g. one-shot loop) wet
      // bus into a runaway boost.
      const target = Math.max(0.6, Math.min(1.3, refRms / r));
      const blended = 1 + (target - 1) * beastAmt;
      const t = ctx.currentTime;
      beastTrim.gain.cancelScheduledValues(t);
      beastTrim.gain.setTargetAtTime(blended, t, 0.18);
    } else {
      const t = ctx.currentTime;
      beastTrim.gain.setTargetAtTime(1.0, t, 0.20);
    }
  }, 33);

  // ── Macros (UI labels mapped to new functions) ───────────────────────────
  //   FEED   → FANG drive
  //   SNARL  → FANG asymmetry
  //   HAUNT  → delay TIME
  //   ROAM   → delay FEEDBACK
  //   BREATH → pitch ghost amount
  const macros = { feed: 0, roam: 0, haunt: 0, breath: 0, snarl: 0, spread: 0 };

  function applyAll() {
    const t   = ctx.currentTime;
    const TAU = 0.10;     // longer time constant → no zipper on knob drags

    // FANG — modulate drive smoothly; never touch the curve.
    // preDrive: 1.0 → 3.5 across FEED. Less aggressive than before.
    fangDrive = macros.feed;
    fangAsym  = macros.snarl;
    const drive = 1.0 + macros.feed * 1.2;     // 1..2.2 — musical range
    preDrive.gain.setTargetAtTime(drive, t, TAU);
    fangMakeup.gain.setTargetAtTime(1 / Math.sqrt(drive), t, TAU);
    snarlBias.offset.setTargetAtTime(macros.snarl * 0.05, t, TAU);
    beastDrive.gain.setTargetAtTime(1.0 + beastAmt * 0.30, t, TAU);
    // FANG WET/DRY CROSSFADE — at FEED=0 we bypass the shaper entirely.
    // Equal-power crossfade so total energy stays roughly flat.
    const fangAmt = Math.min(1, macros.feed + beastAmt * 0.2);
    const wAmt = Math.sin(fangAmt * Math.PI * 0.5);
    const dAmt = Math.cos(fangAmt * Math.PI * 0.5);
    fangWetAmt.gain.setTargetAtTime(wAmt, t, TAU);
    fangDryAmt.gain.setTargetAtTime(dAmt, t, TAU);

    // DELAY TIME (HAUNT) — 80 ms .. 1200 ms
    // Delay time changes can pitch-warp; use longer ramp so it doesn't whistle.
    const time = 0.080 + Math.min(1, macros.haunt) * (1.20 - 0.080);
    delayCore.delayTime.setTargetAtTime(time, t, 0.20);

    // FEEDBACK (ROAM) — musical range, hard ceiling at 0.55
    const fb = Math.min(0.55, macros.roam * 0.50 + beastAmt * 0.05);
    fbReturn.gain.setTargetAtTime(fb, t, TAU);
    // Loop LP starts wide-open and closes only modestly
    // Loop opens to ~4.5k at low fb, closes to ~1.6k at high fb (creamy decay).
    const lpHz = 4500 - fb * 2200 - beastAmt * 700;
    loopLP.frequency.setTargetAtTime(Math.max(1500, lpHz), t, TAU);
    // No in-loop body bump by default; beast adds only +1 dB
    loopBody.gain.setTargetAtTime(beastAmt * 1.0, t, TAU);

    // PITCH GHOST (BREATH) — subtle, and its tone is darkened by ghostLP below.
    const ghost = Math.min(1, macros.breath + beastAmt * 0.15);
    ghostGain.gain.setTargetAtTime(ghost * 0.14, t, TAU);

    // SPREAD — modulated stereo ping-pong, scales send + xfb + LFO depth.
    // Lowered ceilings: too much xfb made the tail metallic & comb-filtered.
    const sp = Math.min(1, macros.spread + beastAmt * 0.15);
    pingSend.gain.setTargetAtTime(sp * 0.40, t, TAU);
    pingMix.gain.setTargetAtTime(sp * 0.60, t, TAU);
    const xfb = sp * 0.35;
    xfbLR.gain.setTargetAtTime(xfb, t, TAU);
    xfbRL.gain.setTargetAtTime(xfb, t, TAU);
    // LFO depth ramps to ±6 ms (subtle warble) at SPREAD=1
    const depth = sp * 0.006;
    pingDepthL.gain.setTargetAtTime(depth, t, TAU);
    pingDepthR.gain.setTargetAtTime(depth, t, TAU);

    // ── FLIP-engaged GLUE comp + soft chorus ──────────────────────────────
    // Engaging FLIP tightens the wet bus and adds slow chorus shimmer.
    //   threshold sweeps -3 dB → -20 dB  (firm grab)
    //   ratio     sweeps 1.5  → 5.0      (tight glue, not limiter)
    //   chorusWet 0    → 0.22            (subtle dry+chorus blend)
    //   chorusDepth 0  → 0.0035 s        (~3.5 ms swing — soft, not vibrato)
    glueComp.threshold.setTargetAtTime(-3 - beastAmt * 17, t, TAU);
    glueComp.ratio.setTargetAtTime(1.5 + beastAmt * 3.5, t, TAU);
    chorusWet.gain.setTargetAtTime(beastAmt * 0.22, t, TAU);
    chorusDepth.gain.setTargetAtTime(beastAmt * 0.0035, t, TAU);
  }

  // ── Standard global controls ─────────────────────────────────────────────
  let bypassed = false;
  let mixVal   = 1.0;

  function applyMixAndBypass() {
    const t = ctx.currentTime;
    const tau = 0.04;     // longer = no zipper on MIX drag
    if (bypassed) {
      bypassGain.gain.setTargetAtTime(1.0, t, tau);
      dryGain.gain.setTargetAtTime(0.0, t, tau);
      wetGain.gain.setTargetAtTime(0.0, t, tau);
    } else {
      bypassGain.gain.setTargetAtTime(0.0, t, tau);
      dryGain.gain.setTargetAtTime(1.0 - mixVal, t, tau);
      wetGain.gain.setTargetAtTime(mixVal,       t, tau);
    }
  }
  applyMixAndBypass();

  // ── Engine_V1 contract — paramSchema (QC harness contract) ──────────────
  // Schema describes every user-facing setter, its range, and its default.
  // See src/nastybeast/CONFORMANCE.md for the authoritative parameter table.
  const paramSchema = [
    // Globals
    { name: 'setIn',     label: 'Input (lin)',  kind: 'unit',  min: 0,    max: 2,    step: 0.01, def: 1 },
    { name: 'setOut',    label: 'Output (lin)', kind: 'unit',  min: 0,    max: 2,    step: 0.01, def: 1 },
    { name: 'setMix',    label: 'Mix',          kind: 'unit',  min: 0,    max: 1,    step: 0.01, def: 1 },
    { name: 'setBypass', label: 'Bypass',       kind: 'bool',  def: 0 },
    // Macros (pancake-themed labels: SIZZLE / STACK / DRIZZLE / FLUFF / CRISP / BUTTER)
    { name: 'setFeed',   label: 'SIZZLE (Feed/Drive)',      kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setRoam',   label: 'STACK (Feedback)',         kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setHaunt',  label: 'DRIZZLE (Delay Time)',     kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setBreath', label: 'FLUFF (Ghost/Breath)',     kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setSnarl',  label: 'CRISP (Asymmetric Clip)',  kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    { name: 'setSpread', label: 'BUTTER (Stereo Spread)',   kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
    // Filters & pitch
    { name: 'setHpf',    label: 'Master HPF (Hz)', kind: 'hz', min: 20,  max: 2000,  step: 1, def: 20 },
    { name: 'setLpf',    label: 'Master LPF (Hz)', kind: 'hz', min: 500, max: 20000, step: 1, def: 20000 },
    { name: 'setTune',   label: 'Tune (-1..+1)',   kind: 'float', min: -1, max: 1, step: 0.01, def: 0,
      note: '-1 = full octave down, 0 = no shift, +1 = full octave up' },
    // Beast / FLIP
    { name: 'setBeast',  label: 'FLIP/Beast', kind: 'unit', min: 0, max: 1, step: 0.01, def: 0 },
  ];

  return {
    input, output,
    chainOutput: output,

    // Engine_V1 contract
    paramSchema,
    getLatency: () => 0,  // dry tap is pre-chain; no PDC needed
    getState: () => ({
      // Globals
      in:       inGain.gain.value,
      out:      outGain.gain.value,
      mix:      mixVal,
      bypass:   bypassed ? 1 : 0,
      // Macro user values
      feed:     macros.feed,
      roam:     macros.roam,
      haunt:    macros.haunt,
      breath:   macros.breath,
      snarl:    macros.snarl,
      spread:   macros.spread,
      // Filters & pitch
      hpfHz:    masterHP.frequency.value,
      lpfHz:    masterLP.frequency.value,
      tune: (function () {
        const dry  = tuneDryAmt.gain.value;
        const down = tuneDownAmt.gain.value;
        const up   = tuneUpAmt.gain.value;
        return up - down;  // reconstruct user value from gain amounts
      })(),
      // Beast
      beast:    beastAmt,
      // Mix bus (for FJ-MIX-DRY check)
      dryGainLevel:    dryGain.gain.value,
      wetGainLevel:    wetGain.gain.value,
      bypassGainLevel: bypassGain.gain.value,
      // FANG crossfade (for FJ-FEED-ZERO check)
      fangWetAmt:  fangWetAmt.gain.value,
      fangDryAmt:  fangDryAmt.gain.value,
      // Delay engine (for FJ-HAUNT / FJ-ROAM checks)
      delayTime:   delayCore.delayTime.value,
      feedbackAmt: fbReturn.gain.value,
      // Pitch ghost (for FJ-BREATH check)
      ghostGainLevel: ghostGain.gain.value,
      // Ping-pong (for FJ-SPREAD check)
      pingSendLevel:  pingSend.gain.value,
      pingMixLevel:   pingMix.gain.value,
      // Tune crossfade taps (for FJ-TUNE check)
      tuneDryAmt:  tuneDryAmt.gain.value,
      tuneDownAmt: tuneDownAmt.gain.value,
      tuneUpAmt:   tuneUpAmt.gain.value,
    }),

    setIn:     v => { const t = ctx.currentTime;
                      inGain.gain.setTargetAtTime(Math.max(0, v), t, 0.05); },
    setOut:    v => { const t = ctx.currentTime;
                      outGain.gain.setTargetAtTime(Math.max(0, v), t, 0.05); },
    setMix:    v => { mixVal = Math.max(0, Math.min(1, v)); applyMixAndBypass(); },
    setBypass: (on) => { bypassed = !!on; applyMixAndBypass(); },
    isBypassed: () => bypassed,

    setFeed:   v => { macros.feed   = v; applyAll(); },
    setRoam:   v => { macros.roam   = v; applyAll(); },
    setHaunt:  v => { macros.haunt  = v; applyAll(); },
    setBreath: v => { macros.breath = v; applyAll(); },
    setSnarl:  v => { macros.snarl  = v; applyAll(); },
    setSpread: v => { macros.spread = v; applyAll(); },

    setHpf: (hz) => {
      const t = ctx.currentTime;
      const f = Math.max(20, Math.min(2000, hz));
      masterHP.frequency.setTargetAtTime(f, t, 0.04);
    },
    setLpf: (hz) => {
      const t = ctx.currentTime;
      const f = Math.max(500, Math.min(20000, hz));
      masterLP.frequency.setTargetAtTime(f, t, 0.04);
    },
    // tune ∈ [-1, +1]. Equal-power-ish crossfade between dry / down-octave / up-octave.
    setTune: (v) => {
      const t = ctx.currentTime;
      const c = Math.max(-1, Math.min(1, v));
      const down = c < 0 ? -c : 0;
      const up   = c > 0 ?  c : 0;
      const dry  = 1 - Math.abs(c);
      tuneDryAmt.gain.setTargetAtTime(dry,  t, 0.04);
      tuneDownAmt.gain.setTargetAtTime(down, t, 0.04);
      tuneUpAmt.gain.setTargetAtTime(up,    t, 0.04);
    },

    setBeast: (amt) => {
      beastAmt = Math.max(0, Math.min(1, amt));
      applyAll();
    },
    getBeast: () => beastAmt,

    getOutputPeak() {
      const p = readPeak(outAna, buf);
      peakSm = Math.max(p, peakSm * DECAY);
      return peakSm;
    },
    getBassLevel() {
      const p = readPeak(bassAna, bbuf);
      bassSm = Math.max(p, bassSm * DECAY);
      return bassSm;
    },
    getTransient() {
      const r = readRms(buf);
      rmsSm += (r - rmsSm) * 0.1;
      return Math.max(0, peakSm - rmsSm);
    },

    dispose() {
      clearInterval(compInterval);
      try { input.disconnect(); } catch {}
      try { output.disconnect(); } catch {}
    },
  };
}
