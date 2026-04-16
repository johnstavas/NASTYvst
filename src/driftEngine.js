// driftEngine.js — DRIFT: Micro-Movement Atmosphere
//
// Make anything feel alive.
// Subtle chorus/detune/vibrato + stereo randomization
//
// Controls:
//   MOTION  — overall modulation intensity
//   SPEED   — LFO rate
//   RANDOM  — randomness/instability added to modulation
//   STEREO  — stereo width / L-R decorrelation
//   TONE    — output brightness
//   DEPTH   — modulation depth (pitch variation)
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'drift-v1';

const PROCESSOR_CODE = `
class DriftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'motion',  defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'speed',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'random',  defaultValue: 0.2, minValue: 0, maxValue: 1 },
      { name: 'stereo',  defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.6, minValue: 0, maxValue: 1 },
      { name: 'depth',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    // Delay buffer for micro-pitch modulation (15ms max)
    this.maxDelay = Math.ceil(this.sr * 0.015);
    this.bufL = new Float32Array(this.maxDelay + 4);
    this.bufR = new Float32Array(this.maxDelay + 4);
    this.writePos = 0;

    // Multiple LFOs for organic movement
    this.lfo1 = 0; this.lfo2 = 0; this.lfo3 = 0;
    this.lfo4 = 0; // random walk

    // Tone filter
    this.lpL = 0; this.lpR = 0;

    // Random walk state
    this.walkL = 0; this.walkR = 0;
    this.walkTarget = 0;

    this._peakOut = 0;
    this.port.postMessage({ ready: true });
  }

  hermite(buf, pos, size) {
    let p = pos; while (p < 0) p += size;
    const i = Math.floor(p) % size;
    const f = p - Math.floor(p);
    const xm1 = buf[(i-1+size)%size], x0 = buf[i], x1 = buf[(i+1)%size], x2 = buf[(i+2)%size];
    const c0=x0, c1=0.5*(x1-xm1), c2=xm1-2.5*x0+2*x1-0.5*x2, c3=0.5*(x2-xm1)+1.5*(x0-x1);
    return ((c3*f+c2)*f+c1)*f+c0;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const motion = params.motion[0];
    const speed  = params.speed[0];
    const random = params.random[0];
    const stereo = params.stereo[0];
    const tone   = params.tone[0];
    const depth  = params.depth[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this.bufL.fill(0); this.bufR.fill(0);
      this.lpL = 0; this.lpR = 0;
      this._peakOut = peakAccum;
      this.port.postMessage({ peak: peakAccum });
      return true;
    }

    // Speed: 0.1Hz to 6Hz
    const rateHz = 0.1 * Math.pow(60, speed);
    const inc1 = rateHz / sr;
    const inc2 = rateHz * 1.37 / sr; // irrational ratio for organic feel
    const inc3 = rateHz * 0.71 / sr;

    // Depth: max 5ms pitch excursion scaled by motion
    const maxDepthSamp = depth * motion * 0.005 * sr;

    // Stereo offset
    const stereoPhase = stereo * 0.4;

    // Tone
    const toneFreq = 3000 + tone * 15000;
    const toneCoef = Math.exp(-2 * Math.PI * toneFreq / sr);

    const bs = this.maxDelay;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];

      // Write to delay
      this.bufL[this.writePos] = dryL;
      this.bufR[this.writePos] = dryR;

      // Multiple layered LFOs
      const s1 = Math.sin(2 * Math.PI * this.lfo1);
      const s2 = Math.sin(2 * Math.PI * this.lfo2);
      const s3 = Math.sin(2 * Math.PI * this.lfo3);

      // Random walk (smooth brownian motion)
      if (random > 0.01) {
        this.walkTarget += (Math.random() - 0.5) * random * 0.1;
        this.walkTarget *= 0.998; // drift back to center
        this.walkL += (this.walkTarget - this.walkL) * 0.002;
        this.walkR += (-this.walkTarget - this.walkR) * 0.002;
      }

      // Combine modulation sources
      let modL = (s1 * 0.5 + s2 * 0.3 + s3 * 0.2) * motion;
      let modR = (Math.sin(2 * Math.PI * (this.lfo1 + stereoPhase)) * 0.5 +
                  Math.sin(2 * Math.PI * (this.lfo2 + stereoPhase * 1.3)) * 0.3 +
                  Math.sin(2 * Math.PI * (this.lfo3 + stereoPhase * 0.7)) * 0.2) * motion;

      // Add random walk
      modL += this.walkL * random;
      modR += this.walkR * random;

      // Delay time modulation
      const centerDelay = 3 * sr / 1000; // 3ms center
      const delayL = Math.max(1, centerDelay + modL * maxDepthSamp);
      const delayR = Math.max(1, centerDelay + modR * maxDepthSamp);

      // Read with Hermite interpolation
      let wetL = this.hermite(this.bufL, this.writePos - delayL, bs);
      let wetR = this.hermite(this.bufR, this.writePos - delayR, bs);

      // Tone filter
      this.lpL = toneCoef * this.lpL + (1 - toneCoef) * wetL;
      this.lpR = toneCoef * this.lpR + (1 - toneCoef) * wetR;
      if (tone < 0.9) {
        wetL = this.lpL;
        wetR = this.lpR;
      }

      // Mix
      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;

      // Advance LFOs
      this.lfo1 += inc1; if (this.lfo1 >= 1) this.lfo1 -= 1;
      this.lfo2 += inc2; if (this.lfo2 >= 1) this.lfo2 -= 1;
      this.lfo3 += inc3; if (this.lfo3 >= 1) this.lfo3 -= 1;

      this.writePos = (this.writePos + 1) % bs;
    }

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: peakAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', DriftProcessor);
`;

export async function createDriftEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
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

  let _peak = 0;
  worklet.port.onmessage = e => { if (e.data?.peak !== undefined) _peak = e.data.peak; };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; }, setOutputGain: v => { outputTrim.gain.value = v; },
    setMotion: v => { p('motion').value = v; }, setSpeed: v => { p('speed').value = v; },
    setRandom: v => { p('random').value = v; }, setStereo: v => { p('stereo').value = v; },
    setTone: v => { p('tone').value = v; }, setDepth: v => { p('depth').value = v; },
    setMix: v => { p('mix').value = v; }, setBypass: v => { p('bypass').value = v ? 1 : 0; },

    getInputPeak: () => { _peakIn = Math.max(getPeak(analyserIn), _peakIn * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn), getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
