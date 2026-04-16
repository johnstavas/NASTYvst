// springPhysicsEngine.js — Spring reverb tank via AudioWorklet
//
// Architecture (based on Selector Spring Reverb reference):
//   • 3 parallel delay lines per channel (L/R) = 3 springs
//   • 1-pole LP filter in each feedback path (damping)
//   • LFO modulation per spring (wobble/chaos)
//   • 2 allpass diffusers applied post-mix (A mode) / 4 (B mode)
//   • DC blocker per channel
//   • Stereo from L/R slightly detuned delay times (spread with width)
//
// A mode = Classic spring tank (clean, boingy)
// B mode = Spring Fuzz (longer, driven, more diffusion)

const _WORKLET = `
// Classic 3-spring tank — Accutronics-style
const N = 3;
const BASE_TD_A = [0.0279, 0.0354, 0.0439]; // inharmonic delay times (sec)
const BASE_TD_B = [0.0389, 0.0463, 0.0581]; // B mode — longer
const LFO_HZ   = [0.61,  0.83,  0.47 ];    // gentle wobble rates
const LFO_MOD  = [34,    21,    44   ];     // subtle flutter for organic feel

class SpringTankProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'feedback', defaultValue: 0.82, minValue: 0.5,  maxValue: 0.97, automationRate: 'k-rate' },
      { name: 'damp',     defaultValue: 0.30, minValue: 0.01, maxValue: 0.99, automationRate: 'k-rate' },
      { name: 'length',   defaultValue: 1.0,  minValue: 0.3,  maxValue: 2.5,  automationRate: 'k-rate' },
      { name: 'chaos',    defaultValue: 0.25, minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'shape',    defaultValue: 0.5,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'scatter',  defaultValue: 0.5,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'width',    defaultValue: 1.0,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'smooth',   defaultValue: 0.5,  minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
      { name: 'mode',     defaultValue: 0,    minValue: 0,    maxValue: 1,    automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    const maxDL = Math.ceil(sr * 0.22);

    // Delay lines [ch 0=L, 1=R][spring 0-2]
    this.dl  = [
      Array.from({length: N}, () => new Float32Array(maxDL)),
      Array.from({length: N}, () => new Float32Array(maxDL)),
    ];
    this.wp  = [new Int32Array(N), new Int32Array(N)];
    this.lpS = [new Float32Array(N), new Float32Array(N)];
    this.lfoP = [[0, 0.7, 1.4], [3.14, 3.84, 4.54]]; // L/R phase offset for stereo

    // Post-mix allpass: irrational delay ratios = organic, not robotic
    // Ratios chosen to avoid harmonic relationships (no simple fractions)
    const apA = [Math.ceil(sr*0.0149), Math.ceil(sr*0.0097), Math.ceil(sr*0.0053), Math.ceil(sr*0.0021)];
    const apB = [Math.ceil(sr*0.0211), Math.ceil(sr*0.0131), Math.ceil(sr*0.0079), Math.ceil(sr*0.0037), Math.ceil(sr*0.0017)];
    this.apBufA = [apA.map(n => new Float32Array(n)), apA.map(n => new Float32Array(n))];
    this.apBufB = [apB.map(n => new Float32Array(n)), apB.map(n => new Float32Array(n))];
    this.apIdxA = [[0,0,0,0],[0,0,0,0]];
    this.apIdxB = [[0,0,0,0,0],[0,0,0,0,0]];

    this.dcIn = [0,0]; this.dcOut = [0,0];
    this.dSampSmooth = [new Float32Array(N).fill(-1), new Float32Array(N).fill(-1)];
  }

  _ap(bufArr, idxArr, stage, input, fb) {
    const buf = bufArr[stage];
    const i   = idxArr[stage];
    const v   = buf[i];
    const out = -input + v;
    buf[i]     = input + v * fb + 1e-18;
    idxArr[stage] = (i + 1 >= buf.length) ? 0 : i + 1;
    return out;
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0]; if (!inp || !inp[0]) return true;
    const out = outputs[0];
    const iL = inp[0], iR = inp[1] || inp[0];
    const oL = out[0], oR = out[1];
    const sr = sampleRate, nF = iL.length;

    const fb      = parameters.feedback[0];
    const damp    = parameters.damp[0];
    const length  = parameters.length[0];
    const chaos   = parameters.chaos[0];
    const shape   = parameters.shape[0];
    const scatter = parameters.scatter[0];
    const width   = parameters.width[0];
    const smooth  = parameters.smooth[0];
    const modeB   = parameters.mode[0] >= 0.5;

    // LP: damp=0 → very dark/metallic (1200Hz), damp=1 → brighter (5000Hz)
    const fc      = 1200 + damp * 3800;
    const lpAlpha = Math.min(0.9999, 2 * Math.PI * fc / sr);

    // Per-stage allpass feedback — varied values break up the robotic regularity
    const apFbBase = 0.48 + smooth * 0.14;
    const apFb = modeB ? (0.52 + shape * 0.15) : apFbBase;
    // Each stage gets a slightly different coefficient for organic feel
    const apFbV = [apFb * 0.91, apFb * 1.07, apFb * 0.96, apFb * 1.04, apFb * 0.93];

    // Delay smoothing alpha: smooth=0 → 6e-4 (springy), smooth=1 → 4e-5 (very washy)
    const dAlpha = Math.pow(10, -3.22 - smooth * 1.17); // 6e-4 → 4e-5

    const scatterSpreads = modeB
      ? [1.0 - scatter*0.10, 1.0, 1.0 + scatter*0.10]
      : [1.0, 1.0, 1.0];

    const baseTD  = modeB ? BASE_TD_B : BASE_TD_A;
    // R channel gets slightly longer delays for stereo width
    const spreadR = 1.0 + width * 0.015;
    const twoPiSr = 2 * Math.PI / sr;

    for (let n = 0; n < nF; n++) {
      const inputMono = (iL[n] + iR[n]) * 0.5;

      // B mode: tanh input drive (shape controls drive amount)
      const driven = modeB
        ? Math.tanh(inputMono * (1.0 + shape * 3.5)) * 0.75
        : inputMono;

      let wetL = 0, wetR = 0;

      for (let ch = 0; ch < 2; ch++) {
        const spread = ch === 1 ? spreadR : 1.0;
        let wet = 0;

        for (let s = 0; s < N; s++) {
          const tdSec = baseTD[s] * length * spread * scatterSpreads[s];

          // LFO wobble
          this.lfoP[ch][s] += LFO_HZ[s] * twoPiSr;
          if (this.lfoP[ch][s] > 6.28318) this.lfoP[ch][s] -= 6.28318;
          const lfoVal  = Math.sin(this.lfoP[ch][s]);
          const lfoSamp = lfoVal * LFO_MOD[s] * chaos; // delay modulation
          const fbMod   = 1.0 + lfoVal * chaos * 0.06; // ±6% feedback pulse — safe

          const maxLen = this.dl[ch][s].length;
          // Smooth only the base (LENGTH) to avoid stutter — LFO added after
          const baseSamp = tdSec * sr;
          if (this.dSampSmooth[ch][s] < 0) {
            this.dSampSmooth[ch][s] = baseSamp;
          } else {
            this.dSampSmooth[ch][s] += dAlpha * (baseSamp - this.dSampSmooth[ch][s]);
          }
          const dSamp  = Math.max(2, Math.min(maxLen - 2, this.dSampSmooth[ch][s] + lfoSamp));
          const dI     = dSamp | 0, dFrc = dSamp - dI;
          const rp     = (this.wp[ch][s] - dI + maxLen * 4) % maxLen;
          const del    = this.dl[ch][s][rp] * (1 - dFrc)
                       + this.dl[ch][s][(rp - 1 + maxLen) % maxLen] * dFrc;

          // 1-pole LP on feedback (damping)
          this.lpS[ch][s] += lpAlpha * (del - this.lpS[ch][s]);

          // Write: input + LP-filtered feedback, tanh-clipped for safety
          this.dl[ch][s][this.wp[ch][s]] = Math.tanh(driven + this.lpS[ch][s] * fb * fbMod);
          this.wp[ch][s] = (this.wp[ch][s] + 1) % maxLen;

          wet += del;
        }

        wet *= 0.40; // 3 springs

        // Post-mix allpass — varied per-stage feedback for organic drip
        if (modeB) {
          for (let i = 0; i < 5; i++) wet = this._ap(this.apBufB[ch], this.apIdxB[ch], i, wet, apFbV[i]);
        } else {
          for (let i = 0; i < 4; i++) wet = this._ap(this.apBufA[ch], this.apIdxA[ch], i, wet, apFbV[i]);
        }

        // DC block
        const dc = wet - this.dcIn[ch] + 0.995 * this.dcOut[ch];
        this.dcIn[ch] = wet; this.dcOut[ch] = dc;

        if (ch === 0) wetL = dc; else wetR = dc;
      }

      if (oR) {
        oL[n] = wetL;
        oR[n] = wetR;
      } else {
        oL[n] = (wetL + wetR) * 0.5;
      }
    }
    return true;
  }
}
registerProcessor('spring-tank-v10', SpringTankProcessor);
`;

// ─── Module-level worklet load (shared across instances) ─────────────────────
const _workletKey = 'spring-tank-v10';
let _workletReady = null;

async function _loadWorklet(ctx) {
  if (_workletReady) return _workletReady;
  const blob = new Blob([_WORKLET], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  _workletReady = ctx.audioWorklet.addModule(url)
    .finally(() => URL.revokeObjectURL(url));
  return _workletReady;
}

// ─── Engine factory ───────────────────────────────────────────────────────────
export async function createSpringPhysicsEngine(ctx) {
  await _loadWorklet(ctx);

  const worklet = new AudioWorkletNode(ctx, 'spring-tank-v10', {
    numberOfInputs:     1,
    numberOfOutputs:    1,
    outputChannelCount: [2],
  });

  // === I/O nodes ===
  const input        = ctx.createGain();
  const output       = ctx.createGain();
  const chainOutput  = ctx.createGain();
  const outputGain   = ctx.createGain();          outputGain.gain.value  = 1;
  const outputPanner = ctx.createStereoPanner();  outputPanner.pan.value = 0;
  const inputGain    = ctx.createGain();          inputGain.gain.value   = 1;

  input.connect(inputGain);
  outputGain.connect(outputPanner);
  outputPanner.connect(output);
  outputGain.connect(chainOutput);

  // === Dry/Wet ===
  const dryGain = ctx.createGain(); dryGain.gain.value = 1.0;
  const wetGain = ctx.createGain(); wetGain.gain.value = 0.0;
  inputGain.connect(dryGain);
  dryGain.connect(outputGain);
  wetGain.connect(outputGain);

  // === Worklet → tone shelf → wetGain ===
  inputGain.connect(worklet);

  const toneShelf = ctx.createBiquadFilter();
  toneShelf.type            = 'highshelf';
  toneShelf.frequency.value = 3500;
  toneShelf.gain.value      = 0;
  worklet.connect(toneShelf);
  toneShelf.connect(wetGain);

  // === Analysers ===
  const inputAnalyser  = ctx.createAnalyser(); inputAnalyser.fftSize  = 2048; inputAnalyser.smoothingTimeConstant = 0.8;
  const outputAnalyser = ctx.createAnalyser(); outputAnalyser.fftSize = 2048; outputAnalyser.smoothingTimeConstant = 0.8;
  inputGain.connect(inputAnalyser);
  output.connect(outputAnalyser);

  // === Worklet param handles ===
  const pFeedback = worklet.parameters.get('feedback');
  const pDamp     = worklet.parameters.get('damp');
  const pLength   = worklet.parameters.get('length');
  const pChaos    = worklet.parameters.get('chaos');
  const pShape    = worklet.parameters.get('shape');
  const pScatter  = worklet.parameters.get('scatter');
  const pWidth    = worklet.parameters.get('width');
  const pSmooth   = worklet.parameters.get('smooth');
  const pMode     = worklet.parameters.get('mode');

  let _mix = 0.3;

  // === Setters ===
  function setMix(v) {
    v = Math.max(0, Math.min(1, v));
    _mix = v;
    const t   = ctx.currentTime;
    const dry = v <= 0.7 ? 1.0 : Math.max(0, 1.0 - (v - 0.7) * 3.33);
    const wet = v * v * 0.75; // quadratic — gentle at low end, full at top
    dryGain.gain.setTargetAtTime(dry, t, 0.04);
    wetGain.gain.setTargetAtTime(wet, t, 0.04);
  }

  function setDecay(v) {
    // 0→1 maps to feedback: 0.80→1.02
    pFeedback.setTargetAtTime(0.40 + v * v * 0.55, ctx.currentTime, 0.12); // squared: 0.40–0.95, longer tails
  }

  function setLength(v) {
    // 0→1 maps to length multiplier: 0.4→2.0
    pLength.setTargetAtTime(0.4 + v * 1.6, ctx.currentTime, 0.08);
  }

  function setDamp(v) {
    // 0→1 knob: 0=dark (damp→low fc), 1=bright (damp→high fc)
    pDamp.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  function setChaos(v) {
    pChaos.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  function setShape(v) {
    pShape.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  function setScatter(v) {
    pScatter.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  function setWidth(v) {
    pWidth.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  function setSmooth(v) {
    pSmooth.setTargetAtTime(v, ctx.currentTime, 0.08);
  }

  function setMode(m) {
    pMode.setTargetAtTime(m, ctx.currentTime, 0.02);
  }

  function setTone(v) {
    const gain = (v - 0.5) * 22;
    toneShelf.gain.setTargetAtTime(gain, ctx.currentTime, 0.08);
  }

  function setWobble(v) { setChaos(v); } // backward compat

  function setInputGain(v)  { inputGain.gain.setTargetAtTime(v,  ctx.currentTime, 0.02); }
  function setOutputGain(v) { outputGain.gain.setTargetAtTime(v, ctx.currentTime, 0.02); }
  function setPan(v)        { outputPanner.pan.setTargetAtTime(v, ctx.currentTime, 0.02); }

  let _bypassed = false;
  function setBypass(v) {
    const want = !!v;
    if (want === _bypassed) return;
    _bypassed = want;
    if (want) {
      try { inputGain.disconnect(worklet);  } catch {}
      try { inputGain.disconnect(dryGain);  } catch {}
      try { input.connect(outputGain);      } catch {}
    } else {
      try { input.disconnect(outputGain);   } catch {}
      try { inputGain.connect(worklet);     } catch {}
      try { inputGain.connect(dryGain);     } catch {}
    }
  }

  // === Metering ===
  const _inBuf  = new Float32Array(inputAnalyser.fftSize);
  const _outBuf = new Float32Array(outputAnalyser.fftSize);
  let iPeak = 0, oPeak = 0, iPeakT = 0, oPeakT = 0;

  function _rms(buf) {
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function getInputLevel()  { inputAnalyser.getFloatTimeDomainData(_inBuf);   return _rms(_inBuf);  }
  function getOutputLevel() { outputAnalyser.getFloatTimeDomainData(_outBuf); return _rms(_outBuf); }
  function getInputPeak()  { const l = getInputLevel(),  n = ctx.currentTime; if (l > iPeak || n - iPeakT > 2) { iPeak = l; iPeakT = n; } return iPeak; }
  function getOutputPeak() { const l = getOutputLevel(), n = ctx.currentTime; if (l > oPeak || n - oPeakT > 2) { oPeak = l; oPeakT = n; } return oPeak; }

  function destroy() {
    try { worklet.disconnect(); } catch {}
    try { worklet.port.close(); } catch {}
  }

  // Apply defaults
  setDecay(0.38);
  setLength(0.35);
  setDamp(0.55);
  setChaos(0.15);
  setShape(0.5);
  setScatter(0.5);
  setWidth(1.0);
  setSmooth(0.5);
  setMix(0.3);
  setTone(0.5);

  return {
    ctx, input, output, chainOutput,
    setMix, setDecay, setLength, setDamp, setChaos, setShape, setScatter, setWidth,
    setMode, setSmooth, setTone, setWobble,
    setInputGain, setOutputGain, setPan, setBypass, destroy,
    getInputLevel, getOutputLevel, getInputPeak, getOutputPeak,
  };
}
