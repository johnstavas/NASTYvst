// echoformEngine.js — ECHOFORM: Evolving Character Delay
//
// A delay that evolves over time.
// Repeats change tone, blur, density, and motion as they continue.
//
// Controls:
//   TIME    — delay time (50ms to 1200ms)
//   FEEDBACK— repeat amount
//   DEGRADE — tone/character decay per repeat (LP darkening + saturation + noise)
//   MOTION  — pitch wobble/tape flutter on repeats
//   BLUR    — smear/diffusion on repeats
//   TONE    — initial delay brightness
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'echoform-v1';

const PROCESSOR_CODE = `
class EchoformProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time',     defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'feedback', defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'degrade',  defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'motion',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'blur',     defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'tone',     defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'mix',      defaultValue: 0.35,minValue: 0, maxValue: 1 },
      { name: 'bypass',   defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    // 1.5 seconds max delay
    this.maxDelay = Math.ceil(this.sr * 1.5);
    this.bufL = new Float32Array(this.maxDelay + 4);
    this.bufR = new Float32Array(this.maxDelay + 4);
    this.writePos = 0;

    // Feedback filter state (degrades per pass)
    this.fbLpL = 0; this.fbLpR = 0;
    this.fbHpL = 0; this.fbHpR = 0;

    // Blur (allpass diffusion)
    this.blurBufL = new Float32Array(512);
    this.blurBufR = new Float32Array(512);
    this.blurPos = 0;

    // Motion LFO
    this.lfoPhase = 0;

    // Output tone filter
    this.outLpL = 0; this.outLpR = 0;

    // Metering
    this._peakOut = 0;
    this._fbLevel = 0;

    this.port.postMessage({ ready: true });
  }

  hermite(buf, pos, size) {
    let p = pos; while (p < 0) p += size;
    const i = Math.floor(p) % size;
    const f = p - Math.floor(p);
    const xm1 = buf[(i - 1 + size) % size];
    const x0  = buf[i];
    const x1  = buf[(i + 1) % size];
    const x2  = buf[(i + 2) % size];
    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2;
    const c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + c0;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const time     = params.time[0];
    const feedback = params.feedback[0];
    const degrade  = params.degrade[0];
    const motion   = params.motion[0];
    const blur     = params.blur[0];
    const tone     = params.tone[0];
    const mix      = params.mix[0];
    const bypass   = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;
    let fbAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this.fbLpL = 0; this.fbLpR = 0; this.fbHpL = 0; this.fbHpR = 0;
      this.outLpL = 0; this.outLpR = 0;
      this.bufL.fill(0); this.bufR.fill(0);
      this.blurBufL.fill(0); this.blurBufR.fill(0);
      this.lfoPhase += (2 / sr) * iL.length;
      if (this.lfoPhase > 1) this.lfoPhase -= Math.floor(this.lfoPhase);
      this._peakOut = peakAccum; this._fbLevel = 0;
      this.port.postMessage({ peak: peakAccum, fb: 0 });
      return true;
    }

    // Delay time: 50ms to 1200ms
    const delayMs = 50 + time * 1150;
    const delaySamp = delayMs * sr / 1000;

    // Feedback amount (up to 92%)
    const fbAmt = feedback * 0.92;

    // Degrade: LP cutoff drops per-pass, simulated by single filter with low cutoff
    const degradeFreq = 12000 - degrade * 10000; // 12kHz to 2kHz
    const degradeCoef = Math.exp(-2 * Math.PI * degradeFreq / sr);
    const degradeHpFreq = 80 + degrade * 300; // HP rises (thins out repeats)
    const degradeHpCoef = Math.exp(-2 * Math.PI * degradeHpFreq / sr);
    const degradeSat = degrade * 0.6; // subtle saturation

    // Motion: LFO modulates delay time
    const motionDepth = motion * 0.003 * sr; // up to 3ms of wobble
    const motionRate = 0.5 + motion * 3; // 0.5 to 3.5Hz

    // Blur: allpass diffusion amount
    const blurAmt = blur * 0.7;
    const blurDelay = Math.floor(blur * 200 + 50); // 50..250 samples

    // Tone LP on output
    const toneFreq = 2000 + tone * 14000; // 2kHz to 16kHz
    const toneCoef = Math.exp(-2 * Math.PI * toneFreq / sr);

    const lfoInc = motionRate / sr;
    const bs = this.maxDelay;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];

      // LFO for motion
      const lfo = Math.sin(2 * Math.PI * this.lfoPhase) * motionDepth;
      const lfoR = Math.sin(2 * Math.PI * (this.lfoPhase + 0.25)) * motionDepth;

      // Read from delay with motion wobble
      const readPosL = this.writePos - delaySamp + lfo;
      const readPosR = this.writePos - delaySamp + lfoR;
      let wetL = this.hermite(this.bufL, readPosL, bs);
      let wetR = this.hermite(this.bufR, readPosR, bs);

      // ── Degrade the feedback path ──
      // LP filter (darkening)
      this.fbLpL = degradeCoef * this.fbLpL + (1 - degradeCoef) * wetL;
      this.fbLpR = degradeCoef * this.fbLpR + (1 - degradeCoef) * wetR;
      wetL = this.fbLpL;
      wetR = this.fbLpR;

      // HP filter (thin out lows over repeats)
      this.fbHpL = degradeHpCoef * this.fbHpL + (1 - degradeHpCoef) * wetL;
      this.fbHpR = degradeHpCoef * this.fbHpR + (1 - degradeHpCoef) * wetR;
      wetL = wetL - this.fbHpL * degrade * 0.5;
      wetR = wetR - this.fbHpR * degrade * 0.5;

      // Saturation (adds grit with repeats)
      if (degradeSat > 0.01) {
        wetL = Math.tanh(wetL * (1 + degradeSat * 3)) / (1 + degradeSat * 2);
        wetR = Math.tanh(wetR * (1 + degradeSat * 3)) / (1 + degradeSat * 2);
      }

      // ── Blur (simple allpass diffusion) ──
      if (blur > 0.01) {
        const bpos = this.blurPos;
        const bd = blurDelay;
        const oldL = this.blurBufL[(bpos - bd + 512) % 512];
        const oldR = this.blurBufR[(bpos - bd + 512) % 512];
        const diffL = wetL + oldL * blurAmt;
        const diffR = wetR + oldR * blurAmt;
        this.blurBufL[bpos] = wetL - oldL * blurAmt;
        this.blurBufR[bpos] = wetR - oldR * blurAmt;
        wetL = diffL * 0.5 + wetL * 0.5;
        wetR = diffR * 0.5 + wetR * 0.5;
        this.blurPos = (bpos + 1) % 512;
      }

      // Track feedback level
      const fl = Math.max(Math.abs(wetL), Math.abs(wetR));
      if (fl > fbAccum) fbAccum = fl;

      // Write to delay buffer
      this.bufL[this.writePos] = dryL + wetL * fbAmt;
      this.bufR[this.writePos] = dryR + wetR * fbAmt;

      // Output tone filter
      this.outLpL = toneCoef * this.outLpL + (1 - toneCoef) * wetL;
      this.outLpR = toneCoef * this.outLpR + (1 - toneCoef) * wetR;
      let outWetL = tone < 0.8 ? this.outLpL : wetL;
      let outWetR = tone < 0.8 ? this.outLpR : wetR;

      // Mix
      oL[n] = dryL * (1 - mix) + outWetL * mix;
      oR[n] = dryR * (1 - mix) + outWetR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;

      this.lfoPhase += lfoInc;
      if (this.lfoPhase >= 1) this.lfoPhase -= 1;
      this.writePos = (this.writePos + 1) % bs;
    }

    this._peakOut = peakAccum;
    this._fbLevel = fbAccum;
    this.port.postMessage({ peak: peakAccum, fb: fbAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', EchoformProcessor);
`;

export async function createEchoformEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input = audioCtx.createGain(), output = audioCtx.createGain(), chainOutput = audioCtx.createGain();
  const inputTrim = audioCtx.createGain(), outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });

  const analyserIn = audioCtx.createAnalyser(); analyserIn.fftSize = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim); inputTrim.connect(analyserIn); analyserIn.connect(worklet);
  worklet.connect(analyserOut); analyserOut.connect(outputTrim);
  outputTrim.connect(output); outputTrim.connect(chainOutput);

  let _peak = 0, _fb = 0;
  worklet.port.onmessage = e => { if (e.data?.peak !== undefined) _peak = e.data.peak; if (e.data?.fb !== undefined) _fb = e.data.fb; };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; }, setOutputGain: v => { outputTrim.gain.value = v; },
    setTime:     v => { p('time').value     = v; },
    setFeedback: v => { p('feedback').value = v; },
    setDegrade:  v => { p('degrade').value  = v; },
    setMotion:   v => { p('motion').value   = v; },
    setBlur:     v => { p('blur').value     = v; },
    setTone:     v => { p('tone').value     = v; },
    setMix:      v => { p('mix').value      = v; },
    setBypass:   v => { p('bypass').value   = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn), getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak, getFbLevel: () => _fb,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
