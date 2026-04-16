// bassmindEngine.js — BASSMIND: Intelligent Bass Processor
//
// Fix your bass in one move.
// Sub stabilizer + harmonic growl + note focus
//
// Controls:
//   WEIGHT    — sub bass boost/shape (20-80Hz shelf)
//   TIGHT     — low-end compression/tightening
//   FOCUS     — midrange definition (200-800Hz presence)
//   GROWL     — harmonic saturation on lows
//   TONE      — overall tilt
//   AIR       — subtle top-end sheen
//   MIX       — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'bassmind-v1';

const PROCESSOR_CODE = `
class BassmindProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'weight',  defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'tight',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'focus',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'growl',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'air',     defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 1,   minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Sub boost filter state (2nd order LP for sub shelf)
    this.subLp1L = 0; this.subLp2L = 0;
    this.subLp1R = 0; this.subLp2R = 0;

    // Tightening compressor envelope
    this.tightEnvL = 0;
    this.tightEnvR = 0;

    // Focus band (bandpass state)
    this.focBpL = 0; this.focLpL = 0;
    this.focBpR = 0; this.focLpR = 0;

    // Air filter state
    this.airHpL = 0; this.airHpR = 0;

    // Tone tilt
    this.tiltLpL = 0; this.tiltLpR = 0;

    // Growl harmonic state
    this.growlLpL = 0; this.growlLpR = 0;

    // Metering
    this._peakOut = 0;
    this._subLevel = 0;  // for visual weight field

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const weight = params.weight[0];
    const tight  = params.tight[0];
    const focus  = params.focus[0];
    const growl  = params.growl[0];
    const tone   = params.tone[0];
    const air    = params.air[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr = this.sr;

    let peakAccum = 0;
    let subAccum = 0;

    // True passthrough
    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this.subLp1L = 0; this.subLp2L = 0; this.subLp1R = 0; this.subLp2R = 0;
      this.tightEnvL = 0; this.tightEnvR = 0;
      this.focBpL = 0; this.focLpL = 0; this.focBpR = 0; this.focLpR = 0;
      this.airHpL = 0; this.airHpR = 0;
      this.tiltLpL = 0; this.tiltLpR = 0;
      this.growlLpL = 0; this.growlLpR = 0;
      this._peakOut = peakAccum; this._subLevel = 0;
      this.port.postMessage({ peak: peakAccum, sub: 0 });
      return true;
    }

    // Sub filter coefficient (~60Hz 2-pole LP)
    const subFreq = 40 + weight * 40; // 40-80Hz
    const subCoef = Math.exp(-2 * Math.PI * subFreq / sr);
    const subGain = 1 + weight * 3; // up to 4x boost

    // Tight compressor
    const tightThresh = 0.3 - tight * 0.2; // lower threshold = more tightening
    const tightAtkCoef = Math.exp(-1 / (sr * 0.003)); // 3ms attack
    const tightRelCoef = Math.exp(-1 / (sr * 0.05));  // 50ms release
    const tightRatio = 2 + tight * 6; // 2:1 to 8:1

    // Focus bandpass (~400Hz)
    const focFreq = 300 + focus * 400; // 300-700Hz
    const focCoef = Math.exp(-2 * Math.PI * focFreq / sr);
    const focGain = focus * 2;

    // Growl: LP isolate lows, then saturate
    const growlCoef = Math.exp(-2 * Math.PI * 250 / sr);
    const growlDrive = 1 + growl * 5;

    // Air HP filter (~8kHz)
    const airCoef = Math.exp(-2 * Math.PI * 8000 / sr);
    const airGain = air * 1.5;

    // Tone tilt
    const tiltFreq = 600 * Math.pow(8, (tone - 0.5) * 2);
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);

    for (let n = 0; n < iL.length; n++) {
      let dryL = iL[n], dryR = iR[n];
      let outL = dryL, outR = dryR;

      // ── Sub weight boost ──
      this.subLp1L = subCoef * this.subLp1L + (1 - subCoef) * outL;
      this.subLp2L = subCoef * this.subLp2L + (1 - subCoef) * this.subLp1L;
      this.subLp1R = subCoef * this.subLp1R + (1 - subCoef) * outR;
      this.subLp2R = subCoef * this.subLp2R + (1 - subCoef) * this.subLp1R;

      const subL = this.subLp2L;
      const subR = this.subLp2R;
      outL += subL * (subGain - 1);
      outR += subR * (subGain - 1);

      // Track sub level for metering
      const sl = Math.max(Math.abs(subL), Math.abs(subR));
      if (sl > subAccum) subAccum = sl;

      // ── Tightening compression on lows ──
      if (tight > 0.01) {
        const lowPeak = Math.max(Math.abs(subL * subGain), Math.abs(subR * subGain));
        if (lowPeak > this.tightEnvL) {
          this.tightEnvL = tightAtkCoef * this.tightEnvL + (1 - tightAtkCoef) * lowPeak;
        } else {
          this.tightEnvL = tightRelCoef * this.tightEnvL + (1 - tightRelCoef) * lowPeak;
        }

        if (this.tightEnvL > tightThresh) {
          const overDb = 20 * Math.log10(this.tightEnvL / tightThresh);
          const reducDb = overDb * (1 - 1 / tightRatio);
          const gain = Math.pow(10, -reducDb / 20);
          // Only compress the sub component
          outL = (outL - subL * (subGain - 1)) + subL * (subGain - 1) * gain;
          outR = (outR - subR * (subGain - 1)) + subR * (subGain - 1) * gain;
        }
      }

      // ── Growl: harmonic saturation on lows ──
      if (growl > 0.01) {
        this.growlLpL = growlCoef * this.growlLpL + (1 - growlCoef) * outL;
        this.growlLpR = growlCoef * this.growlLpR + (1 - growlCoef) * outR;
        const satL = Math.tanh(this.growlLpL * growlDrive);
        const satR = Math.tanh(this.growlLpR * growlDrive);
        outL += (satL - this.growlLpL) * growl * 0.5;
        outR += (satR - this.growlLpR) * growl * 0.5;
      }

      // ── Focus: midrange definition ──
      if (focus > 0.01) {
        this.focLpL = focCoef * this.focLpL + (1 - focCoef) * outL;
        this.focBpL = outL - this.focLpL;
        this.focLpR = focCoef * this.focLpR + (1 - focCoef) * outR;
        this.focBpR = outR - this.focLpR;
        outL += this.focBpL * focGain;
        outR += this.focBpR * focGain;
      }

      // ── Air ──
      if (air > 0.01) {
        this.airHpL = airCoef * this.airHpL + (1 - airCoef) * outL;
        this.airHpR = airCoef * this.airHpR + (1 - airCoef) * outR;
        outL += (outL - this.airHpL) * airGain;
        outR += (outR - this.airHpR) * airGain;
      }

      // ── Tone tilt ──
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * outL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * outR;
      if (tone < 0.5) {
        const amt = (0.5 - tone) * 2;
        outL = outL * (1 - amt * 0.5) + this.tiltLpL * amt * 0.5;
        outR = outR * (1 - amt * 0.5) + this.tiltLpR * amt * 0.5;
      } else {
        const amt = (tone - 0.5) * 2;
        outL += (outL - this.tiltLpL) * amt * 0.3;
        outR += (outR - this.tiltLpR) * amt * 0.3;
      }

      // ── Mix ──
      oL[n] = dryL * (1 - mix) + outL * mix;
      oR[n] = dryR * (1 - mix) + outR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peakOut = peakAccum;
    this._subLevel = subAccum;
    this.port.postMessage({ peak: peakAccum, sub: subAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', BassmindProcessor);
`;

export async function createBassmindEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();
  const inputTrim   = audioCtx.createGain();
  const outputTrim  = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1,
    outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim);
  inputTrim.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(outputTrim);
  outputTrim.connect(output);
  outputTrim.connect(chainOutput);

  let _peak = 0, _sub = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.sub !== undefined) _sub = e.data.sub;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setWeight:  v => { p('weight').value  = v; },
    setTight:   v => { p('tight').value   = v; },
    setFocus:   v => { p('focus').value   = v; },
    setGrowl:   v => { p('growl').value   = v; },
    setTone:    v => { p('tone').value    = v; },
    setAir:     v => { p('air').value     = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getSubLevel: () => _sub,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
