// finisherEngine.js — FINISHER: End-of-Chain Finalizer
//
// Make it sound done.
// Gentle compression + stereo width + polish EQ + soft limiting
//
// Controls:
//   FINISH  — macro: increases compression, width, polish together
//   WIDTH   — stereo enhancement
//   POLISH  — high-shelf air/shimmer
//   TONE    — tilt EQ
//   LOUD    — output push into soft limiter
//   MIX     — dry/wet
//   BYPASS

const PROCESSOR_VERSION = 'finisher-v1';

const PROCESSOR_CODE = `
class FinisherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'finish', defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'width',  defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'polish', defaultValue: 0.3, minValue: 0, maxValue: 1 },
      { name: 'tone',   defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'loud',   defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 1,   minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }
  constructor() {
    super();
    this.sr = sampleRate;
    this.compEnv = 0;
    this.tiltLpL = 0; this.tiltLpR = 0;
    this.polishHpL = 0; this.polishHpR = 0;
    this.limEnv = 0;
    this._peakOut = 0;
    this.port.postMessage({ ready: true });
  }
  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;
    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];
    const finish = params.finish[0];
    const width  = params.width[0];
    const polish = params.polish[0];
    const tone   = params.tone[0];
    const loud   = params.loud[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr = this.sr;
    let peakAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) { oL[n] = iL[n]; oR[n] = iR[n]; const ap = Math.max(Math.abs(oL[n]),Math.abs(oR[n])); if(ap>peakAccum) peakAccum=ap; }
      this.compEnv=0;this.tiltLpL=0;this.tiltLpR=0;this.polishHpL=0;this.polishHpR=0;this.limEnv=0;
      this._peakOut = peakAccum;
      this.port.postMessage({ peak: peakAccum }); return true;
    }

    // Finish-driven compression
    const threshDb = -8 - finish * 16;
    const thresh = Math.pow(10, threshDb / 20);
    const ratio = 1.5 + finish * 3;
    const atkCoef = Math.exp(-1 / (sr * (0.01 + finish * 0.03)));
    const relCoef = Math.exp(-1 / (sr * (0.08 + finish * 0.15)));

    // Tone tilt
    const toneFreq = 600 * Math.pow(10, (tone - 0.5) * 2);
    const toneCoef = Math.exp(-2 * Math.PI * toneFreq / sr);

    // Polish: HP shelf boost at ~8kHz
    const polishCoef = Math.exp(-2 * Math.PI * 8000 / sr);
    const polishGain = polish * 2;

    // Loud: push into soft limiter
    const loudGain = 1 + loud * 4;
    const limThresh = 0.9;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];
      let outL = dryL, outR = dryR;

      // ── Gentle compression ──
      const peak = Math.max(Math.abs(outL), Math.abs(outR));
      if (peak > this.compEnv) { this.compEnv = atkCoef * this.compEnv + (1 - atkCoef) * peak; }
      else { this.compEnv = relCoef * this.compEnv + (1 - relCoef) * peak; }
      if (this.compEnv > thresh) {
        const overDb = 20 * Math.log10(this.compEnv / thresh);
        const gain = Math.pow(10, -(overDb * (1 - 1/ratio)) / 20);
        outL *= gain; outR *= gain;
      }

      // ── Stereo width ──
      const mid = (outL + outR) * 0.5;
      const side = (outL - outR) * 0.5;
      const w = 0.5 + width * 1.0;
      outL = mid + side * w;
      outR = mid - side * w;

      // ── Polish (air shelf) ──
      if (polish > 0.01) {
        this.polishHpL = polishCoef * this.polishHpL + (1 - polishCoef) * outL;
        this.polishHpR = polishCoef * this.polishHpR + (1 - polishCoef) * outR;
        outL += (outL - this.polishHpL) * polishGain;
        outR += (outR - this.polishHpR) * polishGain;
      }

      // ── Tone tilt ──
      this.tiltLpL = toneCoef * this.tiltLpL + (1 - toneCoef) * outL;
      this.tiltLpR = toneCoef * this.tiltLpR + (1 - toneCoef) * outR;
      if (tone < 0.5) { const a=(0.5-tone)*2; outL=outL*(1-a*0.5)+this.tiltLpL*a*0.5; outR=outR*(1-a*0.5)+this.tiltLpR*a*0.5; }
      else { const a=(tone-0.5)*2; outL+=(outL-this.tiltLpL)*a*0.3; outR+=(outR-this.tiltLpR)*a*0.3; }

      // ── Loud + soft limiter ──
      outL *= loudGain; outR *= loudGain;
      const outPeak = Math.max(Math.abs(outL), Math.abs(outR));
      if (outPeak > limThresh) {
        const limGain = limThresh / outPeak;
        outL *= limGain; outR *= limGain;
      }

      // Makeup
      const makeupDb = Math.abs(threshDb) * 0.3;
      const makeup = Math.pow(10, makeupDb / 20);
      outL *= makeup; outR *= makeup;

      oL[n] = dryL * (1 - mix) + outL * mix;
      oR[n] = dryR * (1 - mix) + outR * mix;
      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }
    this._peakOut = peakAccum;
    this.port.postMessage({ peak: peakAccum }); return true;
  }
}
registerProcessor('${PROCESSOR_VERSION}', FinisherProcessor);
`;

export async function createFinisherEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob); await audioCtx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
  const input=audioCtx.createGain(),output=audioCtx.createGain(),chainOutput=audioCtx.createGain();
  const inputTrim=audioCtx.createGain(),outputTrim=audioCtx.createGain();
  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, { numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'explicit' });
  const analyserIn=audioCtx.createAnalyser();analyserIn.fftSize=2048;
  const analyserOut=audioCtx.createAnalyser();analyserOut.fftSize=2048;
  input.connect(inputTrim);inputTrim.connect(analyserIn);analyserIn.connect(worklet);
  worklet.connect(analyserOut);analyserOut.connect(outputTrim);outputTrim.connect(output);outputTrim.connect(chainOutput);
  let _peak=0; worklet.port.onmessage=e=>{if(e.data?.peak!==undefined)_peak=e.data.peak;};
  const _buf=new Float32Array(2048);
  function getRms(an){an.getFloatTimeDomainData(_buf);let s=0;for(let i=0;i<_buf.length;i++)s+=_buf[i]*_buf[i];return Math.sqrt(s/_buf.length);}
  function getPeak(an){an.getFloatTimeDomainData(_buf);let m=0;for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;}return m;}
  const p=name=>worklet.parameters.get(name);let _peakIn=0,_peakOut=0;const DECAY=0.94;
  return {
    input,output,chainOutput,
    setInputGain:v=>{inputTrim.gain.value=v;},setOutputGain:v=>{outputTrim.gain.value=v;},
    setFinish:v=>{p('finish').value=v;},setWidth:v=>{p('width').value=v;},
    setPolish:v=>{p('polish').value=v;},setTone:v=>{p('tone').value=v;},
    setLoud:v=>{p('loud').value=v;},setMix:v=>{p('mix').value=v;},
    setBypass:v=>{p('bypass').value=v?1:0;},
    analyserOut,
    getInputPeak:()=>{_peakIn=Math.max(getPeak(analyserIn),_peakIn*DECAY);return _peakIn;},
    getOutputPeak:()=>{_peakOut=Math.max(getPeak(analyserOut),_peakOut*DECAY);return _peakOut;},
    getInputLevel:()=>getRms(analyserIn),getOutputLevel:()=>getRms(analyserOut),getPeakOutput:()=>_peak,
    destroy(){worklet.disconnect();input.disconnect();inputTrim.disconnect();output.disconnect();outputTrim.disconnect();chainOutput.disconnect();analyserIn.disconnect();analyserOut.disconnect();},
    dispose(){this.destroy();},
  };
}
