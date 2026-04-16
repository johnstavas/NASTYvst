// Web Audio API engine that maps plugin controls to real-time DSP

// Track active engines for HMR cleanup
const _activeEngines = new Map();
let _sharedSource = null;

// Shared audio source — one file/mic feeds all engines
export function createSharedSource() {
  if (_sharedSource) {
    _sharedSource.destroy();
    _sharedSource = null;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const outputNode = ctx.createGain(); // engines connect to this
  outputNode.gain.value = 1;

  let sourceNode = null;
  let mediaStream = null;
  let isPlaying = false;
  let looping = true;

  async function loadFile(file) {
    stop();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.loop = looping;
    sourceNode.connect(outputNode);
    sourceNode.start();
    isPlaying = true;
    if (ctx.state === 'suspended') ctx.resume();
    return audioBuffer.duration;
  }

  async function useMic() {
    stop();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = ctx.createMediaStreamSource(mediaStream);
    sourceNode.connect(outputNode);
    isPlaying = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function stop() {
    if (sourceNode) {
      try { sourceNode.stop?.(); } catch {}
      try { sourceNode.disconnect(); } catch {}
      sourceNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    isPlaying = false;
  }

  function setLooping(v) {
    looping = v;
    if (sourceNode && sourceNode.loop !== undefined) sourceNode.loop = v;
  }

  function destroy() {
    stop();
    ctx.close();
    _sharedSource = null;
  }

  const source = {
    ctx, outputNode,
    loadFile, useMic, stop, setLooping,
    getIsPlaying: () => isPlaying,
    destroy,
  };
  _sharedSource = source;
  return source;
}

export function createAudioEngine(instanceId = 'default', sharedSource = null) {
  // Kill previous engine for this instance (HMR safety)
  if (_activeEngines.has(instanceId)) {
    _activeEngines.get(instanceId).destroy();
    _activeEngines.delete(instanceId);
  }
  // Use shared source's context or create own
  const ctx = sharedSource ? sharedSource.ctx : new (window.AudioContext || window.webkitAudioContext)();

  // --- Nodes ---
  const input = ctx.createGain();        // entry point
  const output = ctx.createGain();       // final out (post-panner, to destination)
  const chainOutput = ctx.createGain();  // series chain output (pre-panner, to next module)
  chainOutput.gain.value = 1;
  const outputGain = ctx.createGain();   // user-controlled output level
  outputGain.gain.value = 1;
  const outputPanner = ctx.createStereoPanner(); // per-module stereo pan — only affects final destination
  outputPanner.pan.value = 0;

  // ========= 10-BAND GRAPHIC EQ =========
  const eqFreqs = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const eqBands = eqFreqs.map((freq, i) => {
    const filter = ctx.createBiquadFilter();
    if (i === 0) {
      filter.type = 'lowshelf';
    } else if (i === eqFreqs.length - 1) {
      filter.type = 'highshelf';
    } else {
      filter.type = 'peaking';
      filter.Q.value = 1.4; // moderate Q for graphic EQ
    }
    filter.frequency.value = freq;
    filter.gain.value = 0; // flat by default
    return filter;
  });
  // Chain EQ bands in series
  for (let i = 0; i < eqBands.length - 1; i++) {
    eqBands[i].connect(eqBands[i + 1]);
  }

  // Tone: lowpass + highshelf combo
  const toneLP = ctx.createBiquadFilter();
  toneLP.type = 'lowpass';
  toneLP.frequency.value = 20000; // wide open at init
  toneLP.Q.value = 0.7;

  const toneHS = ctx.createBiquadFilter();
  toneHS.type = 'highshelf';
  toneHS.frequency.value = 3000;
  toneHS.gain.value = 0;

  // Character: Passive Massage (Elysia xfilter-inspired)
  // LC circuit: resonance peak at 12kHz, steep rolloff above 17kHz
  // Adds sheen/air without pushing the full HF spectrum
  const charResonance = ctx.createBiquadFilter();
  charResonance.type = 'peaking';
  charResonance.frequency.value = 12000;
  charResonance.Q.value = 1.8;
  charResonance.gain.value = 0; // 0 = transparent

  const charRolloff = ctx.createBiquadFilter();
  charRolloff.type = 'lowpass';
  charRolloff.frequency.value = 20000; // wide open at init
  charRolloff.Q.value = 0.8; // slight resonance at cutoff like LC circuit

  // Chain them: resonance peak → rolloff
  charResonance.connect(charRolloff);

  // ========= TAPE (Airwindows-inspired) =========
  // Asymmetric saturation + head bump (low shelf boost) + flutter (pitch wobble via modulated delay)
  const tapeShaper = ctx.createWaveShaper();
  tapeShaper.oversample = '4x';
  tapeShaper.curve = null; // null = linear passthrough

  const tapeGain = ctx.createGain();
  tapeGain.gain.value = 1;

  // Head bump: low shelf that adds analog warmth (like tape machine head resonance)
  const headBump = ctx.createBiquadFilter();
  headBump.type = 'lowshelf';
  headBump.frequency.value = 100;
  headBump.gain.value = 0; // set by setTape()

  // Flutter: subtle pitch wobble via modulated micro-delay.
  // Base delay 0 for full phase-transparency when tape=0. setTape() lifts the
  // base delay as tape engages so modulation has headroom to wobble both ways.
  const flutterDelay = ctx.createDelay(0.05);
  flutterDelay.delayTime.value = 0;
  const flutterLFO = ctx.createOscillator();
  flutterLFO.type = 'triangle';
  flutterLFO.frequency.value = 4.8; // ~5Hz flutter rate
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.value = 0; // set by setTape()
  flutterLFO.connect(flutterDepth);
  flutterDepth.connect(flutterDelay.delayTime);
  flutterLFO.start();

  // Tape high-frequency rolloff (tape machines lose highs)
  const tapeHFRolloff = ctx.createBiquadFilter();
  tapeHFRolloff.type = 'lowpass';
  tapeHFRolloff.frequency.value = 20000; // transparent at init
  tapeHFRolloff.Q.value = 0.5;

  // ========= DISTORTION ORB =========
  // Dedicated distortion with multiple characters controlled by second orb
  const distShaper = ctx.createWaveShaper();
  distShaper.oversample = '4x';
  distShaper.curve = makeDistCurve(0, 0); // (amount, angle)
  const distPreGain = ctx.createGain();
  distPreGain.gain.value = 1;
  const distPostGain = ctx.createGain();
  distPostGain.gain.value = 1;
  const distFilter = ctx.createBiquadFilter(); // post-distortion tone shaping
  distFilter.type = 'lowpass';
  distFilter.frequency.value = 20000;
  distFilter.Q.value = 0.5;
  const distMix = ctx.createGain(); // wet signal
  distMix.gain.value = 0;
  const distDry = ctx.createGain(); // dry signal for parallel distortion
  distDry.gain.value = 1;

  // ========= GLUE (Airwindows-inspired bus comp) =========
  // Sidechain-filtered compression — HP the sidechain so bass doesn't pump
  const glueComp = ctx.createDynamicsCompressor();
  glueComp.threshold.value = 0;  // transparent at init
  glueComp.knee.value = 0;
  glueComp.ratio.value = 1;
  glueComp.attack.value = 0.008;
  glueComp.release.value = 0.08;

  // ========= LIMITER =========
  // preLimiter sums dry + all space effects, then limiter catches peaks before output
  const preLimiter = ctx.createGain();
  preLimiter.gain.value = 1;
  // dryLevel attenuates the dry signal as space effects increase (prevents stacking)
  const dryLevel = ctx.createGain();
  dryLevel.gain.value = 1;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = 0;   // transparent at init
  limiter.knee.value = 0;
  limiter.ratio.value = 1;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;

  // ========= SPACE: Two convolvers for different characters =========
  // Bloom: long lush reverb — keep it dark and wide, cut sub rumble
  const bloomConvolver = ctx.createConvolver();
  const bloomGain = ctx.createGain();
  bloomGain.gain.value = 0;
  const bloomHP = ctx.createBiquadFilter(); // cut sub rumble only
  bloomHP.type = 'highpass';
  bloomHP.frequency.value = 80;
  bloomHP.Q.value = 0.5;
  const bloomLP = ctx.createBiquadFilter(); // tame highs — bloom should be dark and lush
  bloomLP.type = 'lowpass';
  bloomLP.frequency.value = 6000;
  bloomLP.Q.value = 0.5;

  // Room: short tight reverb — brighter early reflections, tighter filtering
  const roomConvolver = ctx.createConvolver();
  const roomGain = ctx.createGain();
  roomGain.gain.value = 0;
  const roomLP = ctx.createBiquadFilter(); // shape the room tail
  roomLP.type = 'lowpass';
  roomLP.frequency.value = 12000; // let more presence through
  roomLP.Q.value = 0.5;
  const roomHP = ctx.createBiquadFilter(); // cut low mud
  roomHP.type = 'highpass';
  roomHP.frequency.value = 180; // lower cut = more body
  roomHP.Q.value = 0.5;

  // Shared space output with harmonic saturation — effects get dirtier when pushed
  const spaceGain = ctx.createGain();
  spaceGain.gain.value = 1;
  // Space drive: saturation on the wet bus — all effects get harmonics when cranked
  const spaceDriveGain = ctx.createGain(); // pre-drive level
  spaceDriveGain.gain.value = 1;
  const spaceDriveShaper = ctx.createWaveShaper();
  spaceDriveShaper.oversample = '2x';
  // Variable saturation curve — starts clean, gets crunchy.
  // PERFORMANCE CRITICAL: setSpaceWeights() runs at ~60Hz (driven by the
  // modeWeights interpolation interval in OrbPluginDemo). We must NEVER
  // allocate a new Float32Array or reassign WaveShaper.curve on every call
  // — both cause GC pressure on the main thread AND force the audio thread
  // to flush oversampling state, which is exactly the kind of work that
  // causes stutter on top of the (already heavy) 3.5-second Bloom convolver.
  //
  // Strategy: persistent buffer, written in-place. We track the last drive
  // value and skip the rewrite + curve assignment unless it's moved enough
  // to actually change the output. At rest (drive=0) this drops from 60Hz
  // to 0Hz of curve work.
  const SHAPE_N = 512;
  const _spaceDriveBuf = new Float32Array(SHAPE_N);
  let _spaceDriveLastAmt = -1;
  function _writeSpaceDriveCurve(drive) {
    const amt = 1 + drive * 8; // 1x = clean, 9x = heavy saturation
    if (Math.abs(amt - _spaceDriveLastAmt) < 0.08) return; // no meaningful change
    _spaceDriveLastAmt = amt;
    const denom = Math.tanh(amt);
    for (let i = 0; i < SHAPE_N; i++) {
      const x = (i / (SHAPE_N - 1)) * 2 - 1;
      _spaceDriveBuf[i] = Math.tanh(x * amt) / denom;
    }
    spaceDriveShaper.curve = _spaceDriveBuf;
  }
  _writeSpaceDriveCurve(0); // initial clean curve

  // ========= DELAY =========
  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = 0.35;
  const delayFeedback = ctx.createGain();
  delayFeedback.gain.value = 0;
  const delayGain = ctx.createGain();
  delayGain.gain.value = 0;
  // Darken delay repeats (like analog delay)
  const delayDamping = ctx.createBiquadFilter();
  delayDamping.type = 'lowpass';
  delayDamping.frequency.value = 4500;
  delayDamping.Q.value = 0.5;
  // Delay feedback saturation — repeats get warmer/dirtier each bounce.
  // Same persistent-buffer + change-threshold approach as spaceDriveShaper
  // (see comment above). At rest (delay=0) this is a no-op after the first
  // call instead of a 60Hz curve thrash.
  const delayFbShaper = ctx.createWaveShaper();
  delayFbShaper.oversample = '2x';
  const _delayFbBuf = new Float32Array(SHAPE_N);
  let _delayFbLastAmt = -1;
  function _writeDelayFbCurve(drive) {
    const amt = 1 + drive * 5;
    if (Math.abs(amt - _delayFbLastAmt) < 0.06) return;
    _delayFbLastAmt = amt;
    const denom = Math.tanh(amt);
    for (let i = 0; i < SHAPE_N; i++) {
      const x = (i / (SHAPE_N - 1)) * 2 - 1;
      _delayFbBuf[i] = Math.tanh(x * amt) / denom;
    }
    delayFbShaper.curve = _delayFbBuf;
  }
  _writeDelayFbCurve(0);

  // ========= SMEAR: Analog diffusion network with modulation + saturation =========
  // 4 micro-delay taps with cross-feedback, per-tap LFO modulation, and feedback saturation
  const smearDelays = [];
  const smearGains = [];
  const smearFeedbacks = [];
  const smearCrossFeedbacks = []; // cross-feed between adjacent taps
  const smearFbShapers = [];      // subtle saturation in feedback path
  const smearLFOs = [];           // per-tap delay time modulation
  const smearLFOGains = [];       // modulation depth per tap
  const smearPanners = [];        // stereo ping-pong panning per tap
  const smearPanLFOs = [];        // slow auto-pan oscillators
  const smearPanLFOGains = [];    // pan modulation depth
  const smearMixer = ctx.createGain();
  smearMixer.gain.value = 0;
  // Longer delay times for obvious pitch-shifting chorus effect
  const smearTimes = [0.012, 0.019, 0.027, 0.037];
  const smearFbAmts = [0.52, 0.48, 0.44, 0.40];
  // Per-tap LFO rates — faster for obvious warble/chorus
  const smearLFORates = [0.8, 1.1, 0.6, 1.4];
  // Cross-feedback amounts — heavier for dense, washy diffusion
  const smearCrossFbAmts = [0.22, 0.18, 0.15, 0.12];

  // Aggressive saturation curve — real harmonic crunch in the feedback path
  function makeSmearSatCurve() {
    const n = 512;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      // Hard-driven tanh — lots of odd harmonics, gets gnarly on recirculation
      curve[i] = Math.tanh(x * 3.0) / Math.tanh(3.0);
    }
    return curve;
  }
  const smearSatCurve = makeSmearSatCurve();

  for (let i = 0; i < 4; i++) {
    const d = ctx.createDelay(0.1);
    d.delayTime.value = smearTimes[i];
    const g = ctx.createGain();
    g.gain.value = 0.25;
    const fb = ctx.createGain();
    fb.gain.value = smearFbAmts[i];

    // Per-tap LFO modulating delay time for chorus-like movement
    const lfoNode = ctx.createOscillator();
    lfoNode.type = 'sine';
    lfoNode.frequency.value = smearLFORates[i];
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0; // starts off, controlled by smear amount
    lfoNode.connect(lfoDepth);
    lfoDepth.connect(d.delayTime); // modulate delay time directly
    lfoNode.start();

    // Saturation waveshaper in feedback path
    const fbShaper = ctx.createWaveShaper();
    fbShaper.curve = smearSatCurve;
    fbShaper.oversample = '2x';

    // Cross-feedback gain (routes to next tap)
    const crossFb = ctx.createGain();
    crossFb.gain.value = 0;

    // Stereo panner — taps alternate L/R with slow auto-pan movement
    const panner = ctx.createStereoPanner();
    // Static offset: taps hard-panned to opposite sides
    const panPositions = [-1.0, 1.0, -0.6, 0.6];
    panner.pan.value = panPositions[i];
    // Slow auto-pan LFO — sweeps the pan position for dramatic ping-pong
    const panLFO = ctx.createOscillator();
    panLFO.type = 'sine';
    // Slow rates for obvious L/R sweeping — different per tap so they don't sync
    const panLFORates = [0.07, 0.09, 0.05, 0.11];
    panLFO.frequency.value = panLFORates[i];
    const panLFOGain = ctx.createGain();
    panLFOGain.gain.value = 0; // starts off, controlled by smear amount
    panLFO.connect(panLFOGain);
    panLFOGain.connect(panner.pan); // modulate pan position
    panLFO.start();

    smearDelays.push(d);
    smearGains.push(g);
    smearFeedbacks.push(fb);
    smearFbShapers.push(fbShaper);
    smearLFOs.push(lfoNode);
    smearLFOGains.push(lfoDepth);
    smearCrossFeedbacks.push(crossFb);
    smearPanners.push(panner);
    smearPanLFOs.push(panLFO);
    smearPanLFOGains.push(panLFOGain);
  }
  // Smear filters — LP to darken + HP to remove sub rumble from feedback
  const smearLP = ctx.createBiquadFilter();
  smearLP.type = 'lowpass';
  smearLP.frequency.value = 6000;
  smearLP.Q.value = 0.5;
  const smearHP = ctx.createBiquadFilter();
  smearHP.type = 'highpass';
  smearHP.frequency.value = 120;
  smearHP.Q.value = 0.5;

  // ========= MODULATION: LFO -> tremolo =========
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 2;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0;
  const tremoloGain = ctx.createGain();
  tremoloGain.gain.value = 1;
  lfo.connect(lfoGain);
  lfoGain.connect(tremoloGain.gain);
  lfo.start();

  // Generate impulse responses — Bloom (long/lush) and Room (short/tight)
  // Bloom = long lush reverb, Room = short tight reflections
  generateLushImpulse(ctx, 3.5).then(buf => { bloomConvolver.buffer = buf; });
  generateShortImpulse(ctx, 0.8).then(buf => { roomConvolver.buffer = buf; });

  // --- Routing ---
  // Main chain: input -> [EQ bypassed by default] -> tone -> character -> tape -> glue -> mod -> limiter -> output
  // EQ starts bypassed to avoid phase shift from 10 biquad filters
  input.connect(toneLP);
  toneLP.connect(toneHS);
  toneHS.connect(charResonance);
  // charResonance → charRolloff already connected above
  charRolloff.connect(tapeShaper);
  tapeShaper.connect(headBump);
  headBump.connect(flutterDelay);
  flutterDelay.connect(tapeHFRolloff);
  tapeHFRolloff.connect(tapeGain);
  // Distortion: parallel wet/dry after tape, before glue
  tapeGain.connect(distDry);       // dry path
  tapeGain.connect(distPreGain);   // wet path: pre-gain -> shaper -> filter -> post-gain -> mix
  distPreGain.connect(distShaper);
  distShaper.connect(distFilter);
  distFilter.connect(distPostGain);
  distPostGain.connect(distMix);
  // Glue comp starts BYPASSED — routing skips glueComp entirely at rest so the
  // DynamicsCompressor (which is never truly transparent, even at ratio=1) is
  // out of the signal path until the user pushes glue > 0.
  distDry.connect(tremoloGain);
  distMix.connect(tremoloGain);
  // NOTE: glueComp connections are managed dynamically by setGlue()
  tremoloGain.connect(dryLevel);    // dry path → dryLevel → preLimiter
  dryLevel.connect(preLimiter);
  // Limiter starts BYPASSED — preLimiter routes direct to outputGain until limit > 0.
  preLimiter.connect(outputGain);
  // NOTE: limiter connections are managed dynamically by setLimit()
  outputGain.connect(chainOutput);   // series chain: no panner, clean signal to next module
  outputGain.connect(outputPanner);  // destination path: panned final output
  outputPanner.connect(output);

  // === STEREO SPREAD — mid/hi widens as orb is pushed out ===
  // Split dry signal into low (mono) and mid+hi (widened)
  const spreadCrossoverLow = ctx.createBiquadFilter(); // LP: keeps low end mono
  spreadCrossoverLow.type = 'lowpass';
  spreadCrossoverLow.frequency.value = 300;
  spreadCrossoverLow.Q.value = 0.5;
  const spreadCrossoverHigh = ctx.createBiquadFilter(); // HP: mid+hi gets spread
  spreadCrossoverHigh.type = 'highpass';
  spreadCrossoverHigh.frequency.value = 300;
  spreadCrossoverHigh.Q.value = 0.5;
  // Two micro-delays for Haas-effect stereo widening (L earlier, R later)
  const spreadDelayL = ctx.createDelay(0.03);
  spreadDelayL.delayTime.value = 0;
  const spreadDelayR = ctx.createDelay(0.03);
  spreadDelayR.delayTime.value = 0;
  const spreadPanL = ctx.createStereoPanner();
  spreadPanL.pan.value = -1;
  const spreadPanR = ctx.createStereoPanner();
  spreadPanR.pan.value = 1;
  const spreadMidMono = ctx.createGain(); // mid+hi mono (center)
  spreadMidMono.gain.value = 1;
  const spreadMidWide = ctx.createGain(); // mid+hi widened (sides)
  spreadMidWide.gain.value = 0; // starts off — controlled by orb distance

  // Dry path: direct to preLimiter (100% phase-transparent at rest).
  // Width is PARALLEL-ADDED via an HP → Haas → pan bus scaled by spreadMidWide,
  // which sits at 0 until the user pushes the orb out, so the dry signal is
  // completely unaffected when spread=0.
  // (dryLevel → preLimiter is already wired above — we leave it alone.)
  dryLevel.connect(spreadCrossoverHigh);
  spreadCrossoverHigh.connect(spreadDelayL);
  spreadCrossoverHigh.connect(spreadDelayR);
  spreadDelayL.connect(spreadPanL);
  spreadDelayR.connect(spreadPanR);
  spreadPanL.connect(spreadMidWide);
  spreadPanR.connect(spreadMidWide);
  spreadMidWide.connect(preLimiter);
  // spreadCrossoverLow and spreadMidMono are no longer in the signal path —
  // the direct dryLevel→preLimiter connection carries the full-range dry.

  // Space drive chain: all wet effects → spaceGain → spaceDrive → preLimiter
  spaceGain.connect(spaceDriveGain);
  spaceDriveGain.connect(spaceDriveShaper);
  spaceDriveShaper.connect(preLimiter);

  // Bloom reverb send: post-tremolo -> bloom convolver -> HP (sub cut only) -> gain -> space bus
  tremoloGain.connect(bloomConvolver);
  bloomConvolver.connect(bloomHP);
  bloomHP.connect(bloomLP);
  bloomLP.connect(bloomGain);
  bloomGain.connect(spaceGain);

  // Room reverb send: post-tremolo -> room convolver -> LP (tighten) -> HP (cut mud) -> gain -> space bus
  tremoloGain.connect(roomConvolver);
  roomConvolver.connect(roomLP);
  roomLP.connect(roomHP);
  roomHP.connect(roomGain);
  roomGain.connect(spaceGain);

  // Delay send: post-tremolo -> delay -> damping -> saturation -> feedback loop -> gain -> space bus
  tremoloGain.connect(delayNode);
  delayNode.connect(delayDamping);
  delayDamping.connect(delayFbShaper);    // saturate in feedback path
  delayFbShaper.connect(delayFeedback);
  delayFeedback.connect(delayNode);
  delayFbShaper.connect(delayGain);       // output from saturated signal
  delayGain.connect(spaceGain);           // delay goes through space drive too

  // Smear send: post-tremolo -> 4 micro-delays with cross-feedback + saturation -> LP -> HP -> mixer
  for (let i = 0; i < 4; i++) {
    tremoloGain.connect(smearDelays[i]);
    // Output of delay -> saturation shaper -> self-feedback + cross-feedback to next tap
    smearDelays[i].connect(smearFbShapers[i]);
    smearFbShapers[i].connect(smearFeedbacks[i]);
    smearFeedbacks[i].connect(smearDelays[i]); // self-feedback loop (through saturation)
    // Cross-feedback: each tap feeds into the next (wraps around)
    smearFbShapers[i].connect(smearCrossFeedbacks[i]);
    smearCrossFeedbacks[i].connect(smearDelays[(i + 1) % 4]);
    // Tap output -> panner (stereo placement) -> mix bus
    smearDelays[i].connect(smearGains[i]);
    smearGains[i].connect(smearPanners[i]);
    smearPanners[i].connect(smearLP);
  }
  smearLP.connect(smearHP);
  smearHP.connect(smearMixer);
  smearMixer.connect(spaceGain);  // smear goes through space drive too

  // Don't auto-connect to speakers — App manages the chain
  // output.connect(ctx.destination);

  // Analysers for metering
  const inputAnalyser = ctx.createAnalyser();
  inputAnalyser.fftSize = 2048;
  inputAnalyser.smoothingTimeConstant = 0.8;
  input.connect(inputAnalyser);

  const outputAnalyser = ctx.createAnalyser();
  outputAnalyser.fftSize = 2048;
  outputAnalyser.smoothingTimeConstant = 0.8;
  output.connect(outputAnalyser);

  // Keep old analyser for spectrum display
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  output.connect(analyser);

  // Dedicated analyser for audio-reactive visuals (faster response)
  const reactiveAnalyser = ctx.createAnalyser();
  reactiveAnalyser.fftSize = 512;
  reactiveAnalyser.smoothingTimeConstant = 0.6;
  output.connect(reactiveAnalyser);

  // Reconnect analysers after output.disconnect() clears them
  function reconnectAnalysers() {
    output.connect(outputAnalyser);
    output.connect(analyser);
    output.connect(reactiveAnalyser);
  }

  // Don't auto-connect to shared source — App manages the chain

  // --- State (for standalone mode without shared source) ---
  let sourceNode = null;
  let mediaStream = null;
  let isPlaying = false;
  let looping = true;

  // --- Parameter update functions ---
  function setTone(v) {
    // v: 0=dark, 0.5=neutral (transparent), 1=bright
    // At 0.5: LP at 20kHz (wide open), shelf at 0dB = transparent
    const freq = v <= 0.5
      ? 800 + (v / 0.5) * 19200   // 0→800Hz, 0.5→20kHz
      : 20000;                      // 0.5-1.0: LP stays open
    toneLP.frequency.setTargetAtTime(freq, ctx.currentTime, 0.02);
    const shelfGain = (v - 0.5) * 12; // -6 to +6 dB
    toneHS.gain.setTargetAtTime(shelfGain, ctx.currentTime, 0.02);
  }

  // EQ bypass — routes around the 10-band EQ to eliminate phase shift
  let eqBypassed = false;
  function setEQBypass(on) {
    eqBypassed = on;
    if (on) {
      try { input.disconnect(eqBands[0]); } catch {}
      try { eqBands[eqBands.length - 1].disconnect(toneLP); } catch {}
      input.connect(toneLP);
    } else {
      try { input.disconnect(toneLP); } catch {}
      input.connect(eqBands[0]);
      eqBands[eqBands.length - 1].connect(toneLP);
    }
  }

  // Set individual EQ band gain. bandIndex: 0-9, gainDb: -12 to +12
  function setEQBand(bandIndex, gainDb) {
    if (bandIndex >= 0 && bandIndex < eqBands.length) {
      eqBands[bandIndex].gain.setTargetAtTime(gainDb, ctx.currentTime, 0.02);
    }
  }

  // Set all 10 EQ bands at once. gains: array of 10 dB values
  function setEQ(gains) {
    gains.forEach((g, i) => setEQBand(i, g));
  }

  function setCharacter(v) {
    // Passive Massage: resonance peak at 12kHz + rolloff above 17kHz
    // Quadratic ramp — subtle sheen at low, pronounced at high
    const curved = v * v;
    const t = ctx.currentTime;
    // Resonance peak: 0 to +5dB at 12kHz (gentle, musical)
    charResonance.gain.setTargetAtTime(curved * 5, t, 0.02);
    // Q widens slightly as you push it — more "airy" spread
    charResonance.Q.setTargetAtTime(1.8 - curved * 0.8, t, 0.02);
    // Rolloff engages: 20kHz (transparent) down to 17kHz (Elysia LC character)
    charRolloff.frequency.setTargetAtTime(20000 - curved * 3000, t, 0.02);
    // LC resonance at the rolloff point increases with amount
    charRolloff.Q.setTargetAtTime(0.7 + curved * 1.2, t, 0.02);
  }

  function setTape(v) {
    const curved = v * v; // quadratic — subtle at low, gritty at high
    tapeShaper.curve = v < 0.01 ? null : makeTapeCurve(curved);
    headBump.gain.setTargetAtTime(curved * 4.5, ctx.currentTime, 0.02);
    flutterDepth.gain.setTargetAtTime(curved * 0.00015, ctx.currentTime, 0.02);
    // Base delay: 0 when tape=0 (full transparency), 0.5ms when engaged so the
    // bipolar LFO modulation has headroom to wobble above and below center.
    flutterDelay.delayTime.setTargetAtTime(v < 0.01 ? 0 : 0.0005, ctx.currentTime, 0.02);
    tapeHFRolloff.frequency.setTargetAtTime(20000 - curved * 14000, ctx.currentTime, 0.02);
    tapeGain.gain.setTargetAtTime(1 / (1 + curved * 0.5), ctx.currentTime, 0.02);
  }

  // Distortion orb: amount (distance from center) + angle (character type)
  // angle: 0=top (hard clip), 90=right (fuzz), 180=bottom (bitcrush feel), 270=left (fold)
  function setDistortion(amount, angle) {
    const t = ctx.currentTime;
    if (amount < 0.01) {
      // Bypass: full dry, no wet
      distMix.gain.setTargetAtTime(0, t, 0.02);
      distDry.gain.setTargetAtTime(1, t, 0.02);
      return;
    }
    // Wet/dry blend — more amount = more wet
    distMix.gain.setTargetAtTime(amount, t, 0.02);
    distDry.gain.setTargetAtTime(1 - amount * 0.6, t, 0.02); // keep some dry for body
    // Pre-gain drives the shaper harder
    distPreGain.gain.setTargetAtTime(1 + amount * 8, t, 0.02);
    // Post-gain compensates for volume increase
    distPostGain.gain.setTargetAtTime(1 / (1 + amount * 3), t, 0.02);
    // Post-distortion filter: angle controls brightness
    // Top (hard clip) = bright, Bottom (crush) = dark, Left/Right = mid
    const deg = ((angle * 180) / Math.PI + 360) % 360;
    const brightness = Math.cos((deg / 360) * Math.PI * 2); // +1 at top, -1 at bottom
    distFilter.frequency.setTargetAtTime(4000 + brightness * 8000 + (1 - amount) * 8000, t, 0.02);
    // Generate new curve based on character
    distShaper.curve = makeDistCurve(amount, deg);
  }

  // Glue engaged state — managed via routing so DynamicsCompressor is
  // OUT of the signal path entirely when glue = 0 (truly transparent rest state).
  // Engagement still happens under bypass so the routing is correct when bypass releases.
  let _glueActive = false;
  function _engageGlue() {
    if (_glueActive) return;
    _glueActive = true;
    try { distDry.disconnect(tremoloGain); } catch {}
    try { distMix.disconnect(tremoloGain); } catch {}
    try { distDry.connect(glueComp);       } catch {}
    try { distMix.connect(glueComp);       } catch {}
    try { glueComp.connect(tremoloGain);   } catch {}
  }
  function _bypassGlue() {
    if (!_glueActive) return;
    _glueActive = false;
    try { distDry.disconnect(glueComp);    } catch {}
    try { distMix.disconnect(glueComp);    } catch {}
    try { glueComp.disconnect(tremoloGain);} catch {}
    try { distDry.connect(tremoloGain);    } catch {}
    try { distMix.connect(tremoloGain);    } catch {}
  }
  function setGlue(v) {
    // At exactly zero: bypass the compressor via routing (true transparency).
    if (v <= 0.001) {
      _bypassGlue();
      return;
    }
    _engageGlue();
    // Quadratic ramp — first half is gentle glue, second half is heavy pump
    const curved = v * v;
    glueComp.threshold.setTargetAtTime(0 - curved * 32, ctx.currentTime, 0.02);
    glueComp.knee.setTargetAtTime(curved * 20, ctx.currentTime, 0.02);
    glueComp.ratio.setTargetAtTime(1 + curved * 4.5, ctx.currentTime, 0.02);
    glueComp.attack.setTargetAtTime(0.008 + curved * 0.025, ctx.currentTime, 0.02);
    glueComp.release.setTargetAtTime(0.08 + curved * 0.3, ctx.currentTime, 0.02);
  }

  // Limiter engaged state — OUT of signal path at rest. preLimiter → outputGain direct
  // until the user turns limit up. DynamicsCompressor is only wired when needed.
  // Engagement still happens under bypass so the routing is correct when bypass releases.
  let _limitActive = false;
  function _engageLimit() {
    if (_limitActive) return;
    _limitActive = true;
    try { preLimiter.disconnect(outputGain); } catch {}
    try { preLimiter.connect(limiter);       } catch {}
    try { limiter.connect(outputGain);       } catch {}
  }
  function _bypassLimit() {
    if (!_limitActive) return;
    _limitActive = false;
    try { preLimiter.disconnect(limiter);    } catch {}
    try { limiter.disconnect(outputGain);    } catch {}
    try { preLimiter.connect(outputGain);    } catch {}
  }
  function setLimit(v) {
    // At exactly zero: bypass the limiter via routing (true transparency).
    if (v <= 0.001) {
      _bypassLimit();
      return;
    }
    _engageLimit();
    // Quadratic ramp — gentle safety net at low, brick wall at high
    const curved = v * v;
    limiter.threshold.setTargetAtTime(0 - curved * 18, ctx.currentTime, 0.02);
    limiter.ratio.setTargetAtTime(1 + curved * 19, ctx.currentTime, 0.02);
  }

  // BPM-synced delay system
  let currentBPM = 0; // 0 = no BPM, freerun
  // Musical divisions: 1/16, 1/8, dotted 1/8, 1/4, dotted 1/4, 1/2
  const divisions = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
  const divisionNames = ['1/16', '1/8', '3/16', '1/4', '3/8', '1/2'];

  function getDelayTime(delayWeight) {
    if (currentBPM <= 0) {
      // Freerun: 0.15s to 0.55s
      return 0.15 + delayWeight * 0.4;
    }
    // Beat duration in seconds
    const beatSec = 60 / currentBPM;
    // Map delay weight (0-1) across musical divisions
    const idx = Math.min(divisions.length - 1, Math.floor(delayWeight * divisions.length));
    return beatSec * divisions[idx];
  }

  function setBPM(bpm) {
    currentBPM = bpm;
    // Re-apply delay timing
    setSpaceWeights(lastWeights);
  }

  function getBPM() { return currentBPM; }
  function getDelayDivision(delayWeight) {
    if (currentBPM <= 0) return '';
    const idx = Math.min(divisions.length - 1, Math.floor(delayWeight * divisions.length));
    return divisionNames[idx];
  }

  function setSpaceWeights(weights) {
    lastWeights = weights;
    const m = currentMix;
    const t = ctx.currentTime;
    const { bloom = 0, room = 0, delay = 0, smear = 0 } = weights;

    // Attenuate dry signal as total wet increases to keep output near unity
    const totalWet = Math.min(1, bloom + room * 0.8 + delay * 0.5 + smear * 0.6);
    dryLevel.gain.setTargetAtTime(1 - totalWet * 0.5 * m, t, 0.12);

    // === SPACE HARMONICS — effects get dirtier when pushed ===
    const maxWet = Math.max(bloom, room, delay, smear);
    const drive = maxWet * maxWet;
    spaceDriveGain.gain.setTargetAtTime(1 + drive * 0.8, t, 0.08);
    // Curve write is throttled internally — only rebuilds on meaningful change
    _writeSpaceDriveCurve(drive * 0.32);

    // === STEREO SPREAD — mid/hi widens as you push out ===
    // Haas delay increases with push (0 → ~8ms asymmetric L/R)
    const spread = maxWet * maxWet;
    spreadDelayL.delayTime.setTargetAtTime(spread * 0.003, t, 0.08);  // L: up to 3ms
    spreadDelayR.delayTime.setTargetAtTime(spread * 0.008, t, 0.08);  // R: up to 8ms (asymmetric = width)
    // Crossfade mono center down, wide sides up
    spreadMidMono.gain.setTargetAtTime(1 - spread * 0.5, t, 0.08);    // mono fades to 50%
    spreadMidWide.gain.setTargetAtTime(spread * 0.7, t, 0.08);        // sides fade in

    // Bloom
    bloomGain.gain.setTargetAtTime(bloom * 0.224 * m, t, 0.15);
    bloomLP.frequency.setTargetAtTime(6000 + bloom * bloom * 2560, t, 0.08);

    // Room
    roomGain.gain.setTargetAtTime(room * 0.48 * m, t, 0.12);
    roomLP.frequency.setTargetAtTime(12000 + room * room * 1920, t, 0.08);

    // Delay
    delayGain.gain.setTargetAtTime(delay * 0.32 * m, t, 0.12);
    delayFeedback.gain.setTargetAtTime(delay > 0.01 ? 0.08 + delay * 0.16 : 0, t, 0.10);
    delayNode.delayTime.setTargetAtTime(getDelayTime(delay), t, 0.15);
    delayDamping.frequency.setTargetAtTime(3000 + (1 - delay) * 4000, t, 0.10);
    // Curve write throttled — see _writeSpaceDriveCurve comment above
    _writeDelayFbCurve(delay * delay * 0.32);

    // Smear
    smearMixer.gain.setTargetAtTime(smear * 0.45 * m, t, 0.12);
    for (let i = 0; i < 4; i++) {
      smearFeedbacks[i].gain.setTargetAtTime(smearFbAmts[i] * (0.4 + smear * 0.18), t, 0.10);
      smearCrossFeedbacks[i].gain.setTargetAtTime(smearCrossFbAmts[i] * (0.1 + smear * 0.22), t, 0.10);
      smearLFOGains[i].gain.setTargetAtTime(smear * 0.00064, t, 0.10);
      smearPanLFOGains[i].gain.setTargetAtTime(0.1 + smear * 0.38, t, 0.12);
    }
    smearLP.frequency.setTargetAtTime(5000 + smear * 2880, t, 0.02);
    smearHP.frequency.setTargetAtTime(80 + smear * 48, t, 0.02);
  }

  function setModulation(v) {
    lfo.frequency.setTargetAtTime(1 + v * 8, ctx.currentTime, 0.02);
    lfoGain.gain.setTargetAtTime(v * 0.3, ctx.currentTime, 0.02);
  }

  // Mix = space send level. Dry always passes through at full volume.
  // Reverb/delay get added on top, scaled by mix.
  let currentMix = 1.0;
  let lastWeights = { bloom: 0, room: 0, delay: 0, smear: 0 };
  function setMix(v) {
    currentMix = v;
    // Re-apply space gains so the mix slider works
    setSpaceWeights(lastWeights);
  }

  function setInputGain(v) {
    // v: 0..1 mapped to -inf..0dB (unity max, no boost)
    const gain = v === 0 ? 0 : v * v; // 0 to 1x (0dB max)
    input.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
  }

  function setOutputGain(v) {
    // v: 0..1 mapped to -inf..0dB (unity max, no boost)
    const gain = v === 0 ? 0 : v * v;
    outputGain.gain.setTargetAtTime(gain, ctx.currentTime, 0.02);
  }

  function setPan(v) {
    // v: -1 (full left) to +1 (full right), 0 = center
    outputPanner.pan.setTargetAtTime(v, ctx.currentTime, 0.02);
  }

  // Bypass: route input straight to outputGain, skipping the entire processing chain.
  // Preserves outputGain + outputPanner + chainOutput so the user's output level, pan,
  // and the series-chain routing still work in bypass (matches vocalEngine behavior).
  let bypassed = false;
  function setBypass(on) {
    const want = !!on;
    // Early-return guard: prevents the duplicate-connect bug where calling
    // setBypass(false) on a fresh engine (or repeatedly with the same state)
    // would re-issue input → toneLP / input → eqBands[0] / spaceDriveShaper
    // → preLimiter / terminal-stage → outputGain on top of the connections
    // construction already made. Web Audio sums duplicates and silently
    // doubles the live-path signal.
    if (want === bypassed) return;
    bypassed = want;
    if (bypassed) {
      // Disconnect whichever node is currently feeding outputGain from the chain.
      // preLimiter feeds outputGain directly when limit bypassed, else via limiter.
      try { input.disconnect(toneLP);                } catch {}
      try { input.disconnect(eqBands[0]);            } catch {}
      try { spaceDriveShaper.disconnect(preLimiter); } catch {}
      if (_limitActive) { try { limiter.disconnect(outputGain);    } catch {} }
      else              { try { preLimiter.disconnect(outputGain); } catch {} }
      // Route input directly into outputGain — outputPanner + chainOutput still fed
      try { input.connect(outputGain);               } catch {}
    } else {
      // Tear down the bypass patch
      try { input.disconnect(outputGain);            } catch {}
      // Reconnect chain respecting EQ bypass state
      if (eqBypassed) {
        try { input.connect(toneLP);                 } catch {}
      } else {
        try { input.connect(eqBands[0]);             } catch {}
        try { eqBands[eqBands.length - 1].connect(toneLP); } catch {}
      }
      // Restore whichever terminal routing matches the current limit state
      if (_limitActive) { try { limiter.connect(outputGain);    } catch {} }
      else              { try { preLimiter.connect(outputGain); } catch {} }
      try { spaceDriveShaper.connect(preLimiter);    } catch {}
    }
  }

  // --- Source management ---
  // When using shared source, delegate file/mic/stop to it
  async function loadFile(file) {
    if (sharedSource) return sharedSource.loadFile(file);
    stop();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    sourceNode = ctx.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.loop = looping;
    sourceNode.connect(input);
    sourceNode.start();
    isPlaying = true;
    if (ctx.state === 'suspended') ctx.resume();
    return audioBuffer.duration;
  }

  async function useMic() {
    if (sharedSource) return sharedSource.useMic();
    stop();
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    sourceNode = ctx.createMediaStreamSource(mediaStream);
    sourceNode.connect(input);
    isPlaying = true;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function stop() {
    if (sharedSource) return sharedSource.stop();
    if (sourceNode) {
      try { sourceNode.stop?.(); } catch {}
      try { sourceNode.disconnect(); } catch {}
      sourceNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    isPlaying = false;
  }

  function setLooping(v) {
    if (sharedSource) return sharedSource.setLooping(v);
    looping = v;
    if (sourceNode && sourceNode.loop !== undefined) sourceNode.loop = v;
  }

  function getAnalyserData() {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    return data;
  }

  // RMS level in dB from a time-domain analyser
  function getRMS(analyserNode) {
    const buf = new Float32Array(analyserNode.fftSize);
    analyserNode.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // Convert to dB, clamp to -60..0
    const db = rms > 0 ? 20 * Math.log10(rms) : -60;
    return Math.max(-60, Math.min(0, db));
  }

  function getInputLevel() { return getRMS(inputAnalyser); }
  function getOutputLevel() { return getRMS(outputAnalyser); }

  // Peak level (for clip indicators)
  function getPeak(analyserNode) {
    const buf = new Float32Array(analyserNode.fftSize);
    analyserNode.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const abs = Math.abs(buf[i]);
      if (abs > peak) peak = abs;
    }
    const db = peak > 0 ? 20 * Math.log10(peak) : -60;
    return Math.max(-60, Math.min(0, db));
  }

  function getInputPeak() { return getPeak(inputAnalyser); }
  function getOutputPeak() { return getPeak(outputAnalyser); }

  // Audio-reactive data: returns normalized 0-1 energy for low/mid/high bands + transient detection
  const _freqBuf = new Uint8Array(reactiveAnalyser.frequencyBinCount);
  const _timeBuf = new Float32Array(reactiveAnalyser.fftSize);
  let _prevRMS = 0;
  function getReactiveData() {
    reactiveAnalyser.getByteFrequencyData(_freqBuf);
    reactiveAnalyser.getFloatTimeDomainData(_timeBuf);

    const binCount = _freqBuf.length;
    const nyquist = ctx.sampleRate / 2;
    const binHz = nyquist / binCount;

    // Band boundaries in bins
    const lowEnd = Math.floor(250 / binHz);     // 0-250 Hz (kick, bass)
    const midEnd = Math.floor(2500 / binHz);     // 250-2500 Hz (vocals, snare body)
    const highEnd = Math.floor(8000 / binHz);    // 2500-8000 Hz (presence, hats)

    let lowSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < lowEnd; i++) lowSum += _freqBuf[i];
    for (let i = lowEnd; i < midEnd; i++) midSum += _freqBuf[i];
    for (let i = midEnd; i < highEnd; i++) highSum += _freqBuf[i];

    const low = lowEnd > 0 ? lowSum / (lowEnd * 255) : 0;
    const mid = (midEnd - lowEnd) > 0 ? midSum / ((midEnd - lowEnd) * 255) : 0;
    const high = (highEnd - midEnd) > 0 ? highSum / ((highEnd - midEnd) * 255) : 0;

    // RMS for overall energy
    let rmsSum = 0;
    for (let i = 0; i < _timeBuf.length; i++) rmsSum += _timeBuf[i] * _timeBuf[i];
    const rms = Math.sqrt(rmsSum / _timeBuf.length);
    const energy = Math.min(1, rms * 3); // normalized 0-1

    // Transient detection: sharp rise in energy = hit
    const transient = Math.max(0, Math.min(1, (energy - _prevRMS) * 8));
    _prevRMS = _prevRMS * 0.85 + energy * 0.15; // smoothed baseline

    return { low, mid, high, energy, transient };
  }

  function getIsPlaying() { return sharedSource ? sharedSource.getIsPlaying() : isPlaying; }

  function destroy() {
    if (!sharedSource) stop();
    // Disconnect from shared source
    if (sharedSource) {
      try { sharedSource.outputNode.disconnect(input); } catch {}
    }
    // Stop smear oscillators
    smearLFOs.forEach(o => { try { o.stop(); } catch {} });
    smearPanLFOs.forEach(o => { try { o.stop(); } catch {} });
    // Don't close shared ctx — only close our own
    if (!sharedSource) ctx.close();
    _activeEngines.forEach((v, k) => { if (v === engine) _activeEngines.delete(k); });
  }

  const engine = {
    ctx, input, output, chainOutput, reconnectAnalysers,  // exposed for series chaining
    setTone, setCharacter, setTape, setGlue, setLimit, setDistortion, setEQ, setEQBand, setEQBypass,
    setSpaceWeights, setModulation, setMix, setBPM, getBPM, getDelayDivision,
    loadFile, useMic, stop, setLooping,
    getAnalyserData, getIsPlaying, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
    setInputGain, setOutputGain, setPan, setBypass, getReactiveData,
  };

  _activeEngines.set(instanceId, engine);
  return engine;
}

// --- Helpers ---

function makeTapeCurve(amount) {
  const samples = 512;
  const curve = new Float32Array(samples);
  const drive = 1 + amount * 6;
  // Asymmetric saturation — positive peaks compress differently than negative
  // This generates even harmonics like real tape
  const asymmetry = amount * 0.15;
  for (let i = 0; i < samples; i++) {
    let x = (i / (samples - 1)) * 2 - 1;
    // Asymmetric bias — shifts the zero crossing slightly
    x += asymmetry * x * x * Math.sign(x);
    // Soft saturation with tanh
    const saturated = Math.tanh(x * drive) / Math.tanh(drive);
    // Blend in a touch of even-harmonic warmth
    const evenHarmonic = x > 0 ? saturated * 0.97 : saturated * 1.03;
    curve[i] = evenHarmonic;
  }
  return curve;
}

// Distortion curve generator — 4 characters blended by angle
// Top (270°) = hard clip, Right (0°) = fuzz, Bottom (90°) = bitcrush, Left (180°) = wavefold
function makeDistCurve(amount, deg) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  if (amount < 0.01) {
    // Clean passthrough
    for (let i = 0; i < samples; i++) curve[i] = (i / (samples - 1)) * 2 - 1;
    return curve;
  }

  // Weights for each character based on angle
  const angleDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };
  const w = (target) => Math.max(0, Math.cos((Math.min(angleDist(deg, target), 90) / 90) * Math.PI / 2));
  const wClip = w(270);   // top = hard clip
  const wFuzz = w(0);     // right = fuzz
  const wCrush = w(90);   // bottom = bitcrush
  const wFold = w(180);   // left = wavefold
  const wTotal = wClip + wFuzz + wCrush + wFold || 1;

  const drive = 1 + amount * 10;
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const input = x * drive;

    // Hard clip: flat tops
    const clip = Math.max(-1, Math.min(1, input));
    // Fuzz: asymmetric, gritty — positive side squashed more
    const fuzz = Math.tanh(input * 1.5) * 0.7 + Math.tanh(input * input * Math.sign(input) * 2) * 0.3;
    // Bitcrush feel: quantize + slight stairstep
    const steps = Math.max(2, Math.floor(32 - amount * 28));
    const crush = Math.round(Math.tanh(input) * steps) / steps;
    // Wavefold: signal folds back on itself
    const fold = Math.sin(input * Math.PI * (1 + amount * 2));

    const mixed = (clip * wClip + fuzz * wFuzz + crush * wCrush + fold * wFold) / wTotal;
    // Soft limit the output
    curve[i] = Math.tanh(mixed * 1.2);
  }
  return curve;
}

// Lush: long, diffuse reverb — swells and sustains (used for Room)
async function generateLushImpulse(ctx, duration) {
  const sr = ctx.sampleRate;
  const len = sr * duration;
  const buffer = ctx.createBuffer(2, len, sr);
  const preDelay = 0.035;

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);

    // Generate raw noise first, then filter it
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Apply one-pole lowpass to remove hiss (simulates air absorption)
    // Cutoff decreases over time — tail gets darker like a real hall
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < preDelay) { data[i] = 0; continue; }
      const rt = t - preDelay;

      // Time-varying filter — HF decays faster than LF (like real rooms)
      const hfDecay = Math.exp(-rt * 6);   // HF dies fast
      const cutoff = 0.15 + hfDecay * 0.6; // filter coefficient: lower = darker
      lp += cutoff * (data[i] - lp);        // one-pole lowpass

      // Bloom envelope: slow build, long sustain, gradual decay
      const attack = 1 - Math.exp(-rt * 5);
      const decay = Math.exp(-rt * 1.2);

      // Stereo decorrelation via phase offset
      const stereoPhase = ch === 0 ? 1 : -1;
      const stereoMod = 1 + stereoPhase * Math.sin(rt * 2.3 + ch * 1.7) * 0.2;

      data[i] = lp * attack * decay * stereoMod * 0.5;
    }

    // Second pass: add early reflections for definition
    const earlyRefs = [
      { time: 0.011, gain: 0.4 }, { time: 0.023, gain: 0.3 },
      { time: 0.041, gain: 0.22 }, { time: 0.059, gain: 0.15 },
      { time: 0.079, gain: 0.10 }, { time: 0.103, gain: 0.06 },
    ];
    for (const ref of earlyRefs) {
      const idx = Math.floor((preDelay + ref.time) * sr);
      if (idx < len) {
        const sign = ch === 0 ? 1 : -1;
        data[idx] += ref.gain * sign * 0.5;
        // Spread each reflection over a few samples for smoothness
        if (idx + 1 < len) data[idx + 1] += ref.gain * sign * 0.3;
        if (idx + 2 < len) data[idx + 2] += ref.gain * sign * 0.1;
      }
    }
  }
  return buffer;
}

// Short: tight, bright impulse with early reflections (used for Bloom)
async function generateShortImpulse(ctx, duration) {
  const sr = ctx.sampleRate;
  const len = sr * duration;
  const buffer = ctx.createBuffer(2, len, sr);
  const preDelay = 0.008; // minimal pre-delay — room feels close

  // Early reflection pattern (simulates wall bounces in a small room)
  const reflections = [
    { time: 0.012, gain: 0.7 },
    { time: 0.019, gain: 0.55 },
    { time: 0.028, gain: 0.45 },
    { time: 0.037, gain: 0.35 },
    { time: 0.048, gain: 0.28 },
    { time: 0.063, gain: 0.20 },
    { time: 0.081, gain: 0.14 },
  ];

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    // Early reflections as discrete impulses
    for (const ref of reflections) {
      const idx = Math.floor((preDelay + ref.time) * sr);
      // Stereo: slightly different times per channel
      const offset = ch === 0 ? 0 : Math.floor(0.002 * sr);
      if (idx + offset < len) {
        data[idx + offset] = ref.gain * (0.8 + Math.random() * 0.4) * (ch === 0 ? 1 : 0.9);
      }
    }
    // Late diffuse tail — short and fast-decaying
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (t < preDelay + 0.05) continue; // start after early reflections
      const rt = t - preDelay - 0.05;
      const decay = Math.exp(-rt * 7); // fast decay = tight room
      const diffusion = (Math.random() * 2 - 1);
      data[i] += diffusion * decay * 0.25;
    }
  }
  return buffer;
}
