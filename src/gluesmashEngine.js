// gluesmashEngine.js — GLUESMASH: Macro-Driven Bus Compressor
//
// From polish to destruction in one move.
// Macro sweeps from subtle glue → punch → parallel violence
//
// Controls:
//   MACRO   — master intensity (drives threshold, ratio, parallel mix)
//   ATTACK  — 0.1ms to 100ms
//   RELEASE — 20ms to 800ms
//   TONE    — output tilt EQ (dark ↔ bright)
//   PUNCH   — transient emphasis (look-ahead peak recovery)
//   SMASH   — parallel crush amount
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'gluesmash-v1';

const PROCESSOR_CODE = `
class GluesmashProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'macro',   defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'attack',  defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'release', defaultValue: 0.4, minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'punch',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'smash',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 1,   minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // Compressor state
    this.envL = 0;
    this.envR = 0;
    this.gainReduction = 1; // linear GR for metering

    // Parallel crush state
    this.crushEnvL = 0;
    this.crushEnvR = 0;

    // Tone filter state (one-pole tilt)
    this.tiltLpL = 0;
    this.tiltLpR = 0;

    // Transient detector state (for punch)
    this.transientEnv = 0;
    this.prevPeak = 0;

    // Metering
    this._peakOut = 0;
    this._gr = 0; // dB gain reduction for visual

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

    const macro   = params.macro[0];
    const attack  = params.attack[0];
    const release = params.release[0];
    const tone    = params.tone[0];
    const punch   = params.punch[0];
    const smash   = params.smash[0];
    const mix     = params.mix[0];
    const bypass  = params.bypass[0] > 0.5;

    const sr = this.sr;
    let peakAccum = 0;
    let grAccum = 0;

    // ── True passthrough ──
    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this.envL = 0; this.envR = 0;
      this.crushEnvL = 0; this.crushEnvR = 0;
      this.tiltLpL = 0; this.tiltLpR = 0;
      this.gainReduction = 1;
      this._peakOut = peakAccum;
      this._gr = 0;
      this.port.postMessage({ peak: peakAccum, gr: 0 });
      return true;
    }

    // ── Macro-driven parameter mapping ──
    // Macro 0..0.3: gentle glue (high threshold, low ratio)
    // Macro 0.3..0.7: punchy bus comp (medium threshold, medium ratio)
    // Macro 0.7..1.0: FULL DESTRUCTION (very low threshold, extreme ratio)
    const threshDb = -6 - macro * 40;    // -6dB to -46dB (deeper crush)
    const thresh = Math.pow(10, threshDb / 20);

    // Ratio: 1.5:1 at 0, 4:1 at 0.5, 40:1 at 1.0 (much more extreme)
    const ratio = 1.5 + macro * macro * 38.5;

    // Attack time: 0.1ms to 100ms mapped by knob
    const atkMs = 0.1 * Math.pow(1000, attack);
    const atkCoef = Math.exp(-1 / (sr * atkMs / 1000));

    // Release time: 20ms to 800ms mapped by knob
    const relMs = 20 * Math.pow(40, release);
    const relCoef = Math.exp(-1 / (sr * relMs / 1000));

    // Tone tilt filter
    const tiltFreq = 800 * Math.pow(10, (tone - 0.5) * 2);
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);

    // Punch: transient recovery amount (aggressive)
    const punchGain = punch * 1.2;

    // Smash: parallel crush settings (MUCH more aggressive)
    const smashThreshDb = -12 - smash * 30; // -12 to -42 dB (catches more signal)
    const smashThresh = Math.pow(10, smashThreshDb / 20);
    const smashRatio = 12 + smash * 88; // 12:1 to 100:1 (brutal limiting)
    const smashMix = smash * 0.85; // parallel blend 0..85% (more crush in mix)

    // Crush attack/release (fast/aggressive)
    const crushAtkCoef = Math.exp(-1 / (sr * 0.0002)); // 0.2ms
    const crushRelCoef = Math.exp(-1 / (sr * 0.05));   // 50ms

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];

      // ── Main compressor ──
      const peakIn = Math.max(Math.abs(dryL), Math.abs(dryR));

      // Envelope follower (peak)
      if (peakIn > this.envL) {
        this.envL = atkCoef * this.envL + (1 - atkCoef) * peakIn;
      } else {
        this.envL = relCoef * this.envL + (1 - relCoef) * peakIn;
      }

      // Gain computation
      let gainLin = 1;
      if (this.envL > thresh) {
        const overDb = 20 * Math.log10(this.envL / thresh);
        const reducDb = overDb * (1 - 1 / ratio);
        gainLin = Math.pow(10, -reducDb / 20);
      }

      // Smooth gain changes (fast tracking for aggressive pumpy response)
      const grSmooth = gainLin < this.gainReduction ? 0.15 : 0.05;
      this.gainReduction += (gainLin - this.gainReduction) * grSmooth;

      let compL = dryL * this.gainReduction;
      let compR = dryR * this.gainReduction;

      // ── Punch: transient emphasis ──
      if (punch > 0.01) {
        const transient = Math.max(0, peakIn - this.prevPeak);
        this.transientEnv = Math.max(transient, this.transientEnv * 0.995);
        this.prevPeak = peakIn * 0.999;

        const punchBoost = 1 + this.transientEnv * punchGain * 8;
        compL *= punchBoost;
        compR *= punchBoost;
      }

      // ── Parallel smash ──
      let smashL = 0, smashR = 0;
      if (smash > 0.01) {
        // Separate aggressive compressor
        const crushPeak = peakIn;
        if (crushPeak > this.crushEnvL) {
          this.crushEnvL = crushAtkCoef * this.crushEnvL + (1 - crushAtkCoef) * crushPeak;
        } else {
          this.crushEnvL = crushRelCoef * this.crushEnvL + (1 - crushRelCoef) * crushPeak;
        }

        let crushGain = 1;
        if (this.crushEnvL > smashThresh) {
          const overDb = 20 * Math.log10(this.crushEnvL / smashThresh);
          const reducDb = overDb * (1 - 1 / smashRatio);
          crushGain = Math.pow(10, -reducDb / 20);
        }

        // Hard saturate the crushed signal (heavy drive into tanh)
        const crushDrive = 4 + smash * 6; // 4x to 10x saturation drive
        smashL = Math.tanh(dryL * crushGain * crushDrive);
        smashR = Math.tanh(dryR * crushGain * crushDrive);
      }

      // ── Blend comp + parallel smash ──
      let outL = compL * (1 - smashMix) + smashL * smashMix;
      let outR = compR * (1 - smashMix) + smashR * smashMix;

      // ── Extra destruction stage at high macro (>0.6) ──
      if (macro > 0.6) {
        const destroyAmt = (macro - 0.6) / 0.4; // 0..1 over macro 0.6..1.0
        const destroyDrive = 1 + destroyAmt * 4; // 1x to 5x extra drive
        // Asymmetric waveshaping for gritty harmonics
        outL = Math.tanh(outL * destroyDrive) * (1 - destroyAmt * 0.3)
             + Math.tanh(outL * destroyDrive * 2) * (destroyAmt * 0.3);
        outR = Math.tanh(outR * destroyDrive) * (1 - destroyAmt * 0.3)
             + Math.tanh(outR * destroyDrive * 2) * (destroyAmt * 0.3);
      }

      // ── Tone tilt ──
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * outL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * outR;

      if (tone < 0.5) {
        // Dark: blend toward LP
        const darkAmt = (0.5 - tone) * 2;
        outL = outL * (1 - darkAmt * 0.6) + this.tiltLpL * darkAmt * 0.6;
        outR = outR * (1 - darkAmt * 0.6) + this.tiltLpR * darkAmt * 0.6;
      } else {
        // Bright: emphasize HP (original - LP)
        const brightAmt = (tone - 0.5) * 2;
        outL = outL + (outL - this.tiltLpL) * brightAmt * 0.4;
        outR = outR + (outR - this.tiltLpR) * brightAmt * 0.4;
      }

      // ── Makeup gain (auto, scales with macro for LOUD output even when crushed) ──
      const makeupDb = Math.abs(threshDb) * (0.4 + macro * 0.5);
      const makeup = Math.pow(10, makeupDb / 20);
      outL *= makeup;
      outR *= makeup;

      // ── Soft limiter to prevent clipping from aggressive makeup ──
      outL = Math.tanh(outL);
      outR = Math.tanh(outR);

      // ── Mix ──
      oL[n] = dryL * (1 - mix) + outL * mix;
      oR[n] = dryR * (1 - mix) + outR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;

      const grDb = this.gainReduction < 0.999 ? -20 * Math.log10(this.gainReduction) : 0;
      if (grDb > grAccum) grAccum = grDb;
    }

    this._peakOut = peakAccum;
    this._gr = grAccum;
    this.port.postMessage({ peak: peakAccum, gr: grAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', GluesmashProcessor);
`;

export async function createGluesmashEngine(audioCtx) {
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

  let _peak = 0, _gr = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.gr !== undefined) _gr = e.data.gr;
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
    setMacro:   v => { p('macro').value   = v; },
    setAttack:  v => { p('attack').value  = v; },
    setRelease: v => { p('release').value = v; },
    setTone:    v => { p('tone').value    = v; },
    setPunch:   v => { p('punch').value   = v; },
    setSmash:   v => { p('smash').value   = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getGR: () => _gr,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
