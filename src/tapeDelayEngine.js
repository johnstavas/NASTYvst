// tapeDelayEngine.js — Warm tape delay via AudioWorklet
//
// Architecture:
//   • Single tape loop with 3 playback heads at different positions
//   • Wow & flutter LFO on read position (pitch warble)
//   • 1-pole LP + HP in feedback path (tape head freq response)
//   • Soft saturation (tanh) on write = tape compression/drive
//   • Head select: any combination of heads 1/2/3
//   • Stereo spread per head

const _WORKLET = `
// Max delay ~2.5 seconds per head
class TapeDelayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time1',    defaultValue: 0.167, minValue: 0.02, maxValue: 1.2,  automationRate: 'k-rate' },
      { name: 'time2',    defaultValue: 0.334, minValue: 0.02, maxValue: 1.2,  automationRate: 'k-rate' },
      { name: 'time3',    defaultValue: 0.501, minValue: 0.02, maxValue: 1.2,  automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.40,  minValue: 0,    maxValue: 0.96, automationRate: 'k-rate' },
      { name: 'wow',      defaultValue: 0.35,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'treble',   defaultValue: 0.5,   minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'bass',     defaultValue: 0.5,   minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'drive',    defaultValue: 0.3,   minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'head1on',  defaultValue: 1,     minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'head2on',  defaultValue: 0,     minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'head3on',  defaultValue: 0,     minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'head1vol', defaultValue: 0.75,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'head2vol', defaultValue: 0.75,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'head3vol', defaultValue: 0.75,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'spread',   defaultValue: 0.5,   minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'mix',      defaultValue: 0.45,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'analogMix', defaultValue: 1,    minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'bypass',    defaultValue: 0,    minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    const maxDL = Math.ceil(sr * 2.6);

    // Stereo tape loop
    this.dlL = new Float32Array(maxDL);
    this.dlR = new Float32Array(maxDL);
    this.wp  = 0;

    // Smoothed read positions per head (avoids Doppler clicks on time change)
    this.headSmooth = [
      { L: -1, R: -1 },
      { L: -1, R: -1 },
      { L: -1, R: -1 },
    ];

    // Wow LFO: 3 slightly detuned oscillators per channel for organic flutter
    this.wowP = [
      [0, 1.1, 2.3],   // L phases
      [1.57, 2.7, 0.4], // R phases
    ];
    this.wowHz = [0.71, 1.13, 0.43]; // Hz — slow, organic

    // Tape motor instability: slow drift that accumulates at high feedback
    // Simulates motor speed wandering when signal keeps recirculating
    this.driftP  = 0;      // primary drift phase
    this.driftP2 = 2.1;    // secondary drift (detuned)
    this.driftAcc = 0;     // accumulated drift offset (fractional write position)
    // Virtual fractional write offset for pitch-shifting the record head
    this.wpFrac = 0;

    // Tape EQ filter states in feedback path
    this.lpL = 0; this.lpR = 0;       // treble LP (1-pole)
    this.bsL = 0; this.bsR = 0;       // bass shelf LP state
    this.hpL = 0; this.hpR = 0;       // DC-block / subsonic HP
    this.hpXL = 0; this.hpXR = 0;     // HP previous input

    // Preamp filter states (tube warmth stage — mono for tape write path)
    this.preLP = 0;
    // Stereo dry warmth filters (same character, applied to dry output)
    this.dryLpL = 0; this.dryLpR = 0;   // dry LP per channel
    this.dryBsL = 0; this.dryBsR = 0;   // dry bass shelf per channel

    // Output transformer shelf state
    this.xfmrL = 0; this.xfmrR = 0;

    // Tape noise
    this.hissLP  = 0;          // pink-ish hiss filter state
    this.humP    = 0;          // 60Hz hum phase
    this.hum3P   = 0;          // 180Hz 3rd harmonic phase (transformer buzz)

    // DC blocker on output
    this.dcInL = 0; this.dcOutL = 0;
    this.dcInR = 0; this.dcOutR = 0;

    // Separate output EQ filter states (so head toggling stays instant)
    this.outLpL = 0; this.outLpR = 0;
    this.outBsL = 0; this.outBsR = 0;
  }

  _readDL(dl, pos, maxLen) {
    const i = pos | 0;
    const f = pos - i;
    const a = dl[(i + maxLen) % maxLen];
    const b = dl[(i - 1 + maxLen) % maxLen];
    return a * (1 - f) + b * f;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]; if (!inp || !inp[0]) return true;
    const out = outputs[0];
    const iL = inp[0], iR = inp[1] || inp[0];
    const oL = out[0], oR = out[1] || out[0];
    const sr = sampleRate, nF = iL.length;
    const maxDL = this.dlL.length;

    const bypass   = parameters.bypass[0] > 0.5;
    if (bypass) {
      for (let n = 0; n < iL.length; n++) { oL[n] = iL[n]; oR[n] = iR[n]; }
      return true;
    }

    const time1    = parameters.time1[0];
    const time2    = parameters.time2[0];
    const time3    = parameters.time3[0];
    const feedback = parameters.feedback[0];
    const wow      = parameters.wow[0];
    const treble   = parameters.treble[0];
    const bass     = parameters.bass[0];
    const drive    = parameters.drive[0];
    const h1       = parameters.head1on[0] > 0.5;
    const h2       = parameters.head2on[0] > 0.5;
    const h3       = parameters.head3on[0] > 0.5;
    const hv1      = parameters.head1vol[0];
    const hv2      = parameters.head2vol[0];
    const hv3      = parameters.head3vol[0];
    const spread   = parameters.spread[0];
    const analogMix = parameters.analogMix[0]; // 0 = clean, 1 = full analog
    const mix      = parameters.mix[0];

    const times = [time1, time2, time3];
    const heads = [h1, h2, h3];
    const hvols = [hv1, hv2, hv3];

    // ── Tape EQ ──────────────────────────────────────────────────────────────
    // Treble: treble=0 → dark (400Hz rolloff), treble=1 → open (5kHz — warm top, no sizzle)
    const lpFc    = 400 + treble * 4600;
    const lpAlpha = Math.min(0.9999, 2 * Math.PI * lpFc / sr);

    // Bass shelf: ±20dB at 300Hz — wide, punchy range you can really hear
    const shelfFc    = 300;
    const shelfAlpha = Math.min(0.9999, 2 * Math.PI * shelfFc / sr);
    const shelfGdB   = (bass - 0.5) * 40;              // ±20 dB
    const shelfGain  = Math.pow(10, shelfGdB / 20);

    // Always-on transformer low shelf: +4dB at 120Hz — fattens both clean and analog
    // Simulates the output transformer naturally reinforcing low end
    const xfmrAlpha = Math.min(0.9999, 2 * Math.PI * 120 / sr);
    const xfmrGain  = Math.pow(10, 4.0 / 20);          // +4dB linear

    // Subsonic HP (fixed, keeps DC out of feedback loop)
    const hpAlpha = Math.min(0.9999, 2 * Math.PI * 25 / sr);

    // Smoothing alpha for head position changes
    const posAlpha = 0.0003;

    // ── Tape saturation ───────────────────────────────────────────────────────
    // Asymmetric waveshaper → generates 2nd harmonics (even = warmth, not harshness)
    // drive=0: barely any saturation, drive=1: obvious tape squash + harmonic bloom
    // Intensity (feedback) drives saturation — high repeats = tape gets pushed harder
    // drive knob adds extra on top, but intensity alone is enough to feel the squash
    const satDrive = 1.0 + drive * 3.0 + feedback * 1.5;
    const satK     = 0.3 + drive * 0.9  + feedback * 0.5;

    // True parallel mix: dry is always full, echo vol just controls wet level
    const dryGain = 1.0;
    const wetGain = mix * mix;

    const twoPi = 2 * Math.PI;

    // Motor instability: compounds pitch drift at high repeat rate.
    // Each recirculating pass re-reads through the same drifted position,
    // so pitch wander stacks up — low feedback = clean, high = sloppy/detuned.
    const motorInstability = feedback * feedback * 3.0;

    for (let n = 0; n < nF; n++) {
      // Slow tape-motor drift oscillators (0.07 Hz & 0.13 Hz)
      this.driftP  += 0.13 / sr * twoPi;
      this.driftP2 += 0.07 / sr * twoPi;
      if (this.driftP  > twoPi) this.driftP  -= twoPi;
      if (this.driftP2 > twoPi) this.driftP2 -= twoPi;
      // Combined drift — max ±30 samples at full feedback, near-zero at low feedback
      const drift = (Math.sin(this.driftP) * 0.65 + Math.sin(this.driftP2) * 0.35)
                    * motorInstability * 30;

      // Wow & flutter: sum 3 detuned LFOs per channel
      let wowL = 0, wowR = 0;
      for (let k = 0; k < 3; k++) {
        this.wowP[0][k] += this.wowHz[k] / sr * twoPi;
        this.wowP[1][k] += this.wowHz[k] / sr * twoPi;
        if (this.wowP[0][k] > twoPi) this.wowP[0][k] -= twoPi;
        if (this.wowP[1][k] > twoPi) this.wowP[1][k] -= twoPi;
        wowL += Math.sin(this.wowP[0][k]);
        wowR += Math.sin(this.wowP[1][k]);
      }
      wowL = wowL * wow * 55 / 3 + drift;        // ~55 samples max — musical warble, no aliasing
      wowR = wowR * wow * 55 / 3 + drift * 0.97;

      let activeCount = 0;
      for (let h = 0; h < 3; h++) { if (heads[h]) activeCount++; }

      // Read all active heads
      // Spread works as a Haas-style L/R time offset per head:
      // L reads slightly earlier, R reads slightly later (up to ~12ms apart at full spread).
      // This creates real perceived width even on a single head, unlike amplitude panning.
      // Each head gets a unique offset direction so multi-head setups widen further.
      const spreadSamps = spread * spread * 530; // up to ~12ms at 44100Hz, quadratic feel
      const headSpreadDir = [-1, 1, -0.6]; // head 1 L-early, head 2 R-early, head 3 slight L

      let wetL = 0, wetR = 0;
      for (let h = 0; h < 3; h++) {
        if (!heads[h]) continue;

        const baseSamp = times[h] * sr;
        const hs = this.headSmooth[h];

        // Smooth base position (avoids Doppler on time knob change)
        if (hs.L < 0) { hs.L = baseSamp; hs.R = baseSamp; }
        else {
          hs.L += posAlpha * (baseSamp - hs.L);
          hs.R += posAlpha * (baseSamp - hs.R);
        }

        // L/R time offset for stereo spread + wow/flutter
        const sOff = spreadSamps * headSpreadDir[h];
        const dL = Math.max(2, Math.min(maxDL - 2, hs.L + wowL + sOff));
        const dR = Math.max(2, Math.min(maxDL - 2, hs.R + wowR - sOff));

        const rpL = (this.wp - (dL | 0) + maxDL * 4) % maxDL;
        const rpR = (this.wp - (dR | 0) + maxDL * 4) % maxDL;

        const readL = this._readDL(this.dlL, rpL, maxDL);
        const readR = this._readDL(this.dlR, rpR, maxDL);

        const vol = hvols[h];
        wetL += readL * vol;
        wetR += readR * vol;
      }

      if (activeCount > 0) {
        wetL /= activeCount;
        wetR /= activeCount;
      }

      // ── Tape EQ in feedback path ──────────────────────────────────────────
      // IIR filters have memory, so we only use EQ output for the feedback signal.
      // The raw wetL/wetR are used for the audible output so head on/off and
      // head volume changes are immediate with no filter lag.

      // 1) Treble LP
      this.lpL += lpAlpha * (wetL - this.lpL);
      this.lpR += lpAlpha * (wetR - this.lpR);

      // 2) Bass shelf
      this.bsL += shelfAlpha * (this.lpL - this.bsL);
      this.bsR += shelfAlpha * (this.lpR - this.bsR);
      const eqL = this.lpL + (shelfGain - 1) * this.bsL;
      const eqR = this.lpR + (shelfGain - 1) * this.bsR;

      // 3) Subsonic HP (DC block in feedback loop)
      const hpOutL = eqL - this.hpXL + hpAlpha * this.hpL;
      const hpOutR = eqR - this.hpXR + hpAlpha * this.hpR;
      this.hpXL = eqL; this.hpL = hpOutL;
      this.hpXR = eqR; this.hpR = hpOutR;

      // Apply EQ directly to wet output too via separate filter states
      // so treble/bass are audible on the first echo, not just in repeats
      this.outLpL += lpAlpha * (wetL - this.outLpL);
      this.outLpR += lpAlpha * (wetR - this.outLpR);
      this.outBsL += shelfAlpha * (this.outLpL - this.outBsL);
      this.outBsR += shelfAlpha * (this.outLpR - this.outBsR);
      const outEqL = this.outLpL + (shelfGain - 1) * this.outBsL;
      const outEqR = this.outLpR + (shelfGain - 1) * this.outBsR;

      // ── Preamp stage ──────────────────────────────────────────────────────
      // ANALOG: rich tube character — 2nd harmonic generator + asymmetric clip + LP
      // CLEAN:  signal passes through untouched
      const inMono = (iL[n] + iR[n]) * 0.5;
      let preOut;
      if (analogMix < 0.001) {
        preOut = inMono;
      } else {
        // Stage 1 — preamp gain scales with analogMix: gentle at low end, cooking at full
        // analogMix=0.1 → barely colored, analogMix=1.0 → fully driven tube character
        const preGain = (1.5 + analogMix * 6.0) + drive * 5.0;
        const driven  = inMono * preGain;

        // Stage 2 — asymmetric transfer: positive = 2nd harmonic bloom,
        // negative = tighter knee → generates dominant even harmonics (warmth not grit)
        // Asymmetry amount also increases with analogMix
        const asymm = 1.0 + analogMix * 0.7;
        const pos = Math.tanh(driven * 1.1);
        const neg = Math.tanh(driven * asymm * 1.5) * 0.75;
        const saturated = driven >= 0 ? pos : neg;

        // Stage 3 — 2nd harmonic amount scales with analogMix too
        const h2Amount = 0.08 + analogMix * 0.22;
        const h2 = saturated * saturated * h2Amount * Math.sign(saturated);
        const colored = saturated + h2;

        // Stage 4 — output LP: cutoff drops as analogMix increases (darker = warmer)
        const preLPFc = 8000 - analogMix * 3500; // 8kHz at clean → 4.5kHz at full analog
        const preLPAlpha = 2 * Math.PI * preLPFc / sr;
        this.preLP += preLPAlpha * (colored - this.preLP);

        // Stage 5 — normalize, then blend with clean signal via analogMix
        const fullAnalog = this.preLP / (1.0 + preGain * 0.28);
        preOut = inMono * (1 - analogMix) + fullAnalog * analogMix;
      }

      // ── Tape saturation on write ──────────────────────────────────────────
      // Asymmetric: positive = soft oxide compression, negative = harder knee → 2nd harmonic
      const tapeSat = (x) => {
        const d = x * satDrive;
        return d >= 0
          ? Math.tanh(d) / (1 + satDrive * 0.3)
          : Math.tanh(d * (1 + satK)) / ((1 + satK) * (1 + satDrive * 0.3));
      };

      // Feedback uses EQ-processed signal (hpOutL/R) — proper tape head coloring per repeat
      const fbL = hpOutL * feedback;
      const fbR = hpOutR * feedback;

      // Write preamp output + feedback to tape
      const writeL = tapeSat(preOut + fbL);
      const writeR = tapeSat(preOut + fbR);

      this.dlL[this.wp] = writeL;
      this.dlR[this.wp] = writeR;
      this.wp = (this.wp + 1) % maxDL;

      // Output uses EQ-processed signal (outEqL/R) — treble/bass audible immediately
      const wetSatAmt = 0.5 + feedback * 2.0 + drive * 1.5;
      const wetSatL = Math.tanh(outEqL * wetSatAmt) / wetSatAmt;
      const wetSatR = Math.tanh(outEqR * wetSatAmt) / wetSatAmt;

      // Always-on output transformer low shelf (+4dB at 120Hz) — fattens wet signal
      this.xfmrL += xfmrAlpha * (wetSatL - this.xfmrL);
      this.xfmrR += xfmrAlpha * (wetSatR - this.xfmrR);
      const warmL = wetSatL + (xfmrGain - 1) * this.xfmrL;
      const warmR = wetSatR + (xfmrGain - 1) * this.xfmrR;

      // ── Tape hiss & hum (analog mode only) ───────────────────────────────
      let noiseL = 0, noiseR = 0;
      if (analogMix > 0.001) {
        // Hiss: white noise → 1-pole LP at ~6kHz → pink-ish tape hiss
        const hissAlpha = 2 * Math.PI * 6000 / sr;
        const whiteL = Math.random() * 2 - 1;
        const whiteR = Math.random() * 2 - 1;
        this.hissLP += hissAlpha * (whiteL - this.hissLP);
        // Very subtle — just enough to feel like tape, not distracting
        const hiss = this.hissLP * 0.0012;

        // Hum: 60Hz fundamental + 180Hz 3rd (transformer character)
        this.humP  += 2 * Math.PI * 60  / sr;
        this.hum3P += 2 * Math.PI * 180 / sr;
        if (this.humP  > 2 * Math.PI) this.humP  -= 2 * Math.PI;
        if (this.hum3P > 2 * Math.PI) this.hum3P -= 2 * Math.PI;
        const hum = Math.sin(this.humP) * 0.0012 + Math.sin(this.hum3P) * 0.0004;

        // Hiss scales with a cubic curve — stays near-silent until slider is 2/3 up
        // Linear ramp — simple and consistent across the full range
        const noiseMix = analogMix;
        noiseL = (hiss + hum) * noiseMix;
        noiseR = ((Math.random() * 2 - 1) * hissAlpha * 0.0012 + hum) * noiseMix;
      }

      // DC block on output (using transformer-warmed signal)
      const dcL = (warmL + noiseL) - this.dcInL + 0.995 * this.dcOutL;
      const dcR = (warmR + noiseR) - this.dcInR + 0.995 * this.dcOutR;
      this.dcInL = warmL + noiseL; this.dcOutL = dcL;
      this.dcInR = warmR + noiseR; this.dcOutR = dcR;

      // ── Analog warmth on dry signal ───────────────────────────────────────
      // Same LP + bass shelf + gentle saturation as the preamp, applied to dry stereo.
      // As analogMix increases the whole instrument gets warmer/darker, not just the echoes.
      let dryL = iL[n], dryR = iR[n];
      if (analogMix > 0.001) {
        const dryPreGain = 1.0 + analogMix * 3.0;
        const dryLPFc    = 9000 - analogMix * 4500; // 9kHz→4.5kHz as slider moves right
        const dryLPAlpha = 2 * Math.PI * dryLPFc / sr;

        // Gentle saturation on dry
        const satL = Math.tanh(iL[n] * dryPreGain) / dryPreGain;
        const satR = Math.tanh(iR[n] * dryPreGain) / dryPreGain;

        // LP — rolls off the top
        this.dryLpL += dryLPAlpha * (satL - this.dryLpL);
        this.dryLpR += dryLPAlpha * (satR - this.dryLpR);

        // Bass shelf — same warm low-mid lift as the tape EQ
        this.dryBsL += shelfAlpha * (this.dryLpL - this.dryBsL);
        this.dryBsR += shelfAlpha * (this.dryLpR - this.dryBsR);
        const warmDryL = this.dryLpL + (shelfGain - 1) * this.dryBsL;
        const warmDryR = this.dryLpR + (shelfGain - 1) * this.dryBsR;

        dryL = iL[n] * (1 - analogMix) + warmDryL * analogMix;
        dryR = iR[n] * (1 - analogMix) + warmDryR * analogMix;
      }

      oL[n] = dryL * dryGain + dcL * wetGain;
      oR[n] = dryR * dryGain + dcR * wetGain;
    }
    return true;
  }
}
registerProcessor('tape-delay-v30', TapeDelayProcessor);
`;

let _workletReady = null;

async function _loadWorklet(ctx) {
  if (_workletReady) return _workletReady;
  const blob = new Blob([_WORKLET], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  _workletReady = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  return _workletReady;
}

export async function createTapeDelayEngine(ctx) {
  await _loadWorklet(ctx);

  const worklet = new AudioWorkletNode(ctx, 'tape-delay-v30', {
    numberOfInputs:     1,
    numberOfOutputs:    1,
    outputChannelCount: [2],
  });

  const input       = ctx.createGain();
  const output      = ctx.createGain();
  const chainOutput = ctx.createGain();
  const inputGain   = ctx.createGain(); inputGain.gain.value = 1;
  const outputGain  = ctx.createGain(); outputGain.gain.value = 1;

  // Analysers for metering
  const analyserIn  = ctx.createAnalyser(); analyserIn.fftSize  = 4096; analyserIn.smoothingTimeConstant  = 0.0;
  const analyserOut = ctx.createAnalyser(); analyserOut.fftSize = 4096; analyserOut.smoothingTimeConstant = 0.0;

  // Signal chain
  input.connect(analyserIn);       // tap input signal for IN meter
  input.connect(inputGain);
  inputGain.connect(worklet);
  worklet.connect(outputGain);
  outputGain.connect(analyserOut); // tap output signal for OUT meter
  outputGain.connect(output);
  outputGain.connect(chainOutput);

  // Parameter refs
  const p = worklet.parameters;
  const pTime1    = p.get('time1');
  const pTime2    = p.get('time2');
  const pTime3    = p.get('time3');
  const pFeedback = p.get('feedback');
  const pWow      = p.get('wow');
  const pTreble   = p.get('treble');
  const pBass     = p.get('bass');
  const pDrive    = p.get('drive');
  const pH1       = p.get('head1on');
  const pH2       = p.get('head2on');
  const pH3       = p.get('head3on');
  const pHV1      = p.get('head1vol');
  const pHV2      = p.get('head2vol');
  const pHV3      = p.get('head3vol');
  const pSpread   = p.get('spread');
  const pMix      = p.get('mix');
  const pAnalogMix = p.get('analogMix');
  const pBypass    = p.get('bypass');

  const t = (v) => ctx.currentTime + 0.001;
  const sm = 0.08;

  function setTime1(v)    { pTime1.setTargetAtTime(v, t(), sm); }
  function setTime2(v)    { pTime2.setTargetAtTime(v, t(), sm); }
  function setTime3(v)    { pTime3.setTargetAtTime(v, t(), sm); }
  function setFeedback(v) { pFeedback.setTargetAtTime(v * 0.985, t(), sm); }
  function setWow(v)      { pWow.setTargetAtTime(v, t(), sm); }
  function setTreble(v)   { pTreble.setTargetAtTime(v, t(), sm); }
  function setBass(v)     { pBass.setTargetAtTime(v, t(), sm); }
  function setDrive(v)    { pDrive.setTargetAtTime(v, t(), sm); }
  function setHead1(on)    { pH1.setTargetAtTime(on ? 1 : 0, t(), 0.02); }
  function setHead2(on)    { pH2.setTargetAtTime(on ? 1 : 0, t(), 0.02); }
  function setHead3(on)    { pH3.setTargetAtTime(on ? 1 : 0, t(), 0.02); }
  function setHead1Vol(v)  { pHV1.setTargetAtTime(v, t(), sm); }
  function setHead2Vol(v)  { pHV2.setTargetAtTime(v, t(), sm); }
  function setHead3Vol(v)  { pHV3.setTargetAtTime(v, t(), sm); }
  function setSpread(v)   { pSpread.setTargetAtTime(v, t(), sm); }
  function setMix(v)      { pMix.setTargetAtTime(v, t(), sm); }
  function setBypass(on)    { pBypass.setTargetAtTime(on ? 1 : 0, t(), 0.02); }
  function setInputGain(v)  { inputGain.gain.setTargetAtTime(v, t(), sm); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v, t(), sm); }
  function setAnalogMix(v) { pAnalogMix.setTargetAtTime(v, t(), sm); }

  // Metering — peak for LED bars, RMS for VU needles
  const _buf = new Float32Array(4096);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94; // per RAF frame — falls to silence in ~2s

  function getPeak(analyser) {
    analyser.getFloatTimeDomainData(_buf);
    let max = 0;
    for (let i = 0; i < _buf.length; i++) {
      const a = Math.abs(_buf[i]);
      if (a > max) max = a;
    }
    return max;
  }

  function getRms(analyser) {
    analyser.getFloatTimeDomainData(_buf);
    let sum = 0;
    for (let i = 0; i < _buf.length; i++) sum += _buf[i] * _buf[i];
    return Math.sqrt(sum / _buf.length);
  }

  return {
    input, output, chainOutput,
    setTime1, setTime2, setTime3,
    setFeedback, setWow, setTreble, setBass, setDrive,
    setHead1, setHead2, setHead3, setHead1Vol, setHead2Vol, setHead3Vol,
    setSpread, setMix, setBypass, setAnalogMix, setInputGain, setOutputGain,
    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    dispose() {
      worklet.disconnect(); inputGain.disconnect(); outputGain.disconnect();
    },
  };
}
