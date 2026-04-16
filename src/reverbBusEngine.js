// reverbBusEngine.js — REVERB BUS v3
// Full spec implementation:
//   Early Reflections → FDN 8×8 Hadamard → Modulation → Damping
//   → Color/Saturation → Glue Compression → Ducking → Width → Mix
//
// SPACE  : decay time 0.3 – 12s (RT60-based per-line feedback)
// TUCK   : pre-delay 0–120ms + sidechain ducking + HPF cutoff
// GLUE   : gentle wet compression 1.2:1 – 3:1 + soft clip
// COLOR  : tilt EQ + tape saturation amount
// WIDTH  : M/S balance
// MODE   : Room / Plate / Hall / Ambient / Dirty (affects all internals)

const PROCESSOR_VERSION = 'reverbbus-v3';

const HAD_NORM_VAL = (1 / (2 * Math.SQRT2)).toFixed(10);

const PROCESSOR_CODE = `
// ── Inline constants ───────────────────────────────────────────────────────
const _HN = ${HAD_NORM_VAL};   // Hadamard normalization: 1/(2√2)
const _H8 = [                   // 8×8 Hadamard matrix (unnormalized ±1)
  [ 1, 1, 1, 1, 1, 1, 1, 1],
  [ 1,-1, 1,-1, 1,-1, 1,-1],
  [ 1, 1,-1,-1, 1, 1,-1,-1],
  [ 1,-1,-1, 1, 1,-1,-1, 1],
  [ 1, 1, 1, 1,-1,-1,-1,-1],
  [ 1,-1, 1,-1,-1, 1,-1, 1],
  [ 1, 1,-1,-1,-1,-1, 1, 1],
  [ 1,-1,-1, 1,-1, 1, 1,-1],
];
// Per-mode multipliers  [room, plate, hall, ambient, dirty]
const _MD = [0.45, 0.55, 0.80, 1.00, 0.65]; // decay multiplier
const _MM = [2.5,  5.0,  8.0, 14.0,  3.0 ]; // LFO depth (samples)
const _MF = [4000, 6500, 4500, 3000, 2500]; // damping LP base Hz
const _ME = [0.70, 0.50, 0.40, 0.20, 0.60]; // early reflection level
const _MS = [0.04, 0.05, 0.03, 0.05, 0.18]; // saturation amount

class ReverbBusProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'space',  defaultValue: 0.35, minValue: 0, maxValue: 1 },
      { name: 'tuck',   defaultValue: 0.40, minValue: 0, maxValue: 1 },
      { name: 'glue',   defaultValue: 0.30, minValue: 0, maxValue: 1 },
      { name: 'color',  defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'width',  defaultValue: 0.50, minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 0.20, minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth', defaultValue: 0,    minValue: 0, maxValue: 5 },
      { name: 'mode',   defaultValue: 0,    minValue: 0, maxValue: 4 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const sc = this.sr / 44100;

    // ── Pre-delay buffer (0–130ms max) ──────────────────────────────
    const pdMax = Math.round(0.135 * this.sr) + 8;
    this.pdBufL = new Float32Array(pdMax);
    this.pdBufR = new Float32Array(pdMax);
    this.pdPos  = 0;

    // ── Early Reflections: 8 stereo-offset taps (7–77ms) ────────────
    this.erTapsL = [7,13,20,29,39,51,63,77].map(ms => Math.round(ms * this.sr / 1000));
    this.erTapsR = [9,16,24,33,44,55,67,82].map(ms => Math.round(ms * this.sr / 1000));
    this.erGains = [0.68, 0.54, 0.44, 0.36, 0.29, 0.24, 0.19, 0.15];
    const erMax  = Math.round(0.092 * this.sr) + 8;
    this.erBufL  = new Float32Array(erMax);
    this.erBufR  = new Float32Array(erMax);
    this.erPos   = 0;

    // ── FDN 8×8: L and R with prime-offset lengths ───────────────────
    this.fdnLensL = [1303,1427,1559,1699,1847,1979,2081,2213].map(l => Math.round(l * sc));
    this.fdnLensR = [1327,1451,1583,1723,1871,2003,2107,2239].map(l => Math.round(l * sc));
    const fdnMax  = Math.round(2400 * sc) + 16;
    this.fdnBufsL = Array.from({length:8}, () => new Float32Array(fdnMax));
    this.fdnBufsR = Array.from({length:8}, () => new Float32Array(fdnMax));
    this.fdnPos   = new Int32Array(8);
    this.fdnLpL   = new Float64Array(8);  // damping LP state L
    this.fdnLpR   = new Float64Array(8);  // damping LP state R
    // Pre-allocated mixing buffers (no GC in process loop)
    this._yL  = new Float64Array(8);  // FDN read outputs L
    this._yR  = new Float64Array(8);  // FDN read outputs R
    this._mL  = new Float64Array(8);  // Hadamard mixed L
    this._mR  = new Float64Array(8);  // Hadamard mixed R
    this._fb  = new Float64Array(8);  // per-line feedback

    // ── Per-line LFO modulation ──────────────────────────────────────
    this.lfoPhase = new Float64Array(8);
    this.lfoRates = [0.12, 0.18, 0.08, 0.22, 0.15, 0.10, 0.25, 0.07]; // Hz
    this._lfoVal  = new Float64Array(8);

    // ── Ducking (sidechain from dry signal) ──────────────────────────
    this.duckEnv = 0;

    // ── Glue compressor ──────────────────────────────────────────────
    this.glueEnv = 0;

    // ── HPF on wet output ────────────────────────────────────────────
    this.hpfL = 0; this.hpfR = 0;

    // ── Tilt EQ LP state ─────────────────────────────────────────────
    this.tiltLpL = 0; this.tiltLpR = 0;

    // ── Smooth LP ────────────────────────────────────────────────────
    this.sLpL1 = 0; this.sLpR1 = 0;
    this.sLpL2 = 0; this.sLpR2 = 0;

    // ── Metering ─────────────────────────────────────────────────────
    this._peak = 0; this._energy = 0; this._reverbLevel = 0; this._gr = 0;

    this.port.postMessage({ ready: true });
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0], outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];
    const N  = iL.length, sr = this.sr;

    const space  = params.space[0];
    const tuck   = params.tuck[0];
    const glue   = params.glue[0];
    const color  = params.color[0];
    const width  = params.width[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const smooth = params.smooth[0];
    const mode   = Math.round(Math.max(0, Math.min(4, params.mode[0])));

    let peakAccum = 0, rvAccum = 0, maxGr = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < N; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._energy = 0; this._reverbLevel = 0; this._gr = 0;
      this.port.postMessage({ peak: peakAccum, energy: 0, reverbLevel: 0, gr: 0 });
      return true;
    }

    // ── Mode parameters ───────────────────────────────────────────────
    const decayMult = _MD[mode];
    const modDepth  = _MM[mode];
    const dampBase  = _MF[mode];
    const erLvl     = _ME[mode] * (1 - tuck * 0.55);  // TUCK reduces ER
    const satBase   = _MS[mode];

    // ── SPACE → Decay time (0.3s to 12s, log scale) ───────────────────
    const decayTime = 0.3 * Math.pow(40, space) * decayMult;

    // ── RT60 feedback per line: fb = exp(-6.908 * L / (sr * T60)) ──────
    const fb = this._fb;
    for (let c = 0; c < 8; c++) {
      const raw = Math.exp(-6.908 * this.fdnLensL[c] / (sr * decayTime));
      fb[c] = Math.min(0.97, Math.max(0.05, raw));
    }

    // ── TUCK → Pre-delay (0–120ms) ─────────────────────────────────────
    const pdSamples = Math.round(tuck * 0.120 * sr);
    const pdBs = this.pdBufL.length;

    // ── LFO depth scales with mode + SPACE ────────────────────────────
    const lfoD = modDepth * (0.4 + space * 0.6);
    for (let c = 0; c < 8; c++) {
      this.lfoPhase[c] += this.lfoRates[c] * N / sr;
      if (this.lfoPhase[c] > 1) this.lfoPhase[c] -= 1;
      this._lfoVal[c] = Math.sin(this.lfoPhase[c] * 6.283185) * lfoD;
    }

    // ── COLOR → damping LP inside FDN ─────────────────────────────────
    const dampFreq = dampBase + color * 8000;
    const dampCoef = Math.exp(-6.283185 * dampFreq / sr);

    // ── TUCK → HPF on wet (50Hz → 180Hz — mud removal only)
    // PHASE FIX: was 50–600Hz. That put the HPF into the midrange at moderate
    // TUCK values, phase-shifting the wet signal and causing comb filtering
    // when mixed with the clean dry path. Capping at 180Hz keeps it in the
    // sub/low-bass range where phase shift is inaudible in a wet/dry blend.
    const hpfFreq = 50 + tuck * 130;
    const hpfCoef = Math.exp(-6.283185 * hpfFreq / sr);

    // ── COLOR → Tilt EQ ────────────────────────────────────────────────
    const tiltCoef     = Math.exp(-6.283185 * 800 / sr);
    const tiltGainLow  = 1 + (0.5 - color) * 1.5;
    const tiltGainHigh = 1 + (color - 0.5) * 1.5;

    // ── COLOR + mode → Saturation ─────────────────────────────────────
    const satAmt   = satBase + color * 0.07;
    const satDrive = 1 + satAmt * 4;

    // ── GLUE → gentle compression (1.2:1 – 3:1) ──────────────────────
    const glueThresh  = Math.pow(10, (-20 - glue * 10) / 20); // -20 to -30dB
    const glueRatio   = 1.2 + glue * 1.8;
    const glueAtk     = Math.exp(-1 / (sr * 0.008));
    const glueRel     = Math.exp(-1 / (sr * 0.12));
    const glueMakeup  = 1 + glue * 0.30;

    // ── TUCK → Ducking (sidechain from dry) ──────────────────────────
    const duckAtk   = Math.exp(-1 / (sr * 0.004));
    const duckRel   = Math.exp(-1 / (sr * (0.08 + tuck * 1.1)));
    const duckDepth = tuck * 0.80;

    // ── WIDTH → M/S balance ───────────────────────────────────────────
    const widthScale = width * 2; // 0=mono, 1=unity, 2=wide

    const yL = this._yL, yR = this._yR, mL = this._mL, mR = this._mR;
    const erBs = this.erBufL.length;

    for (let n = 0; n < N; n++) {
      const dryL = iL[n], dryR = iR[n];

      // ── Pre-delay ─────────────────────────────────────────────────
      const pdPos = this.pdPos;
      this.pdBufL[pdPos] = dryL;
      this.pdBufR[pdPos] = dryR;
      const pdRd = (pdPos - pdSamples + pdBs) % pdBs;
      const pdL  = this.pdBufL[pdRd];
      const pdR  = this.pdBufR[pdRd];
      this.pdPos = (pdPos + 1) % pdBs;

      // ── Early Reflections ─────────────────────────────────────────
      const erPos = this.erPos;
      this.erBufL[erPos] = pdL;
      this.erBufR[erPos] = pdR;
      let erL = 0, erR = 0;
      for (let t = 0; t < 8; t++) {
        erL += this.erBufL[(erPos - this.erTapsL[t] + erBs) % erBs] * this.erGains[t];
        erR += this.erBufR[(erPos - this.erTapsR[t] + erBs) % erBs] * this.erGains[t];
      }
      this.erPos = (erPos + 1) % erBs;

      // ── FDN: read outputs with LP damping + LFO ────────────────────
      for (let c = 0; c < 8; c++) {
        const bs   = this.fdnBufsL[c].length;
        const pos  = this.fdnPos[c];
        const lvo  = this._lfoVal[c];
        const lenL = Math.max(64, Math.min(bs-8, Math.round(this.fdnLensL[c] + lvo)));
        const lenR = Math.max(64, Math.min(bs-8, Math.round(this.fdnLensR[c] + lvo * 0.87)));
        this.fdnLpL[c] = dampCoef * this.fdnLpL[c] + (1 - dampCoef) * this.fdnBufsL[c][(pos-lenL+bs)%bs];
        this.fdnLpR[c] = dampCoef * this.fdnLpR[c] + (1 - dampCoef) * this.fdnBufsR[c][(pos-lenR+bs)%bs];
        yL[c] = this.fdnLpL[c];
        yR[c] = this.fdnLpR[c];
      }

      // ── FDN: Hadamard mix (8×8 unrolled) ──────────────────────────
      for (let i = 0; i < 8; i++) {
        const h = _H8[i];
        mL[i] = (h[0]*yL[0]+h[1]*yL[1]+h[2]*yL[2]+h[3]*yL[3]+h[4]*yL[4]+h[5]*yL[5]+h[6]*yL[6]+h[7]*yL[7]) * _HN;
        mR[i] = (h[0]*yR[0]+h[1]*yR[1]+h[2]*yR[2]+h[3]*yR[3]+h[4]*yR[4]+h[5]*yR[5]+h[6]*yR[6]+h[7]*yR[7]) * _HN;
      }

      // ── FDN: write back + sum late output ─────────────────────────
      const fdnInL = pdL * 0.45 + erL * erLvl * 0.30;
      const fdnInR = pdR * 0.45 + erR * erLvl * 0.30;
      let lateL = 0, lateR = 0;
      for (let c = 0; c < 8; c++) {
        const bs  = this.fdnBufsL[c].length;
        const pos = this.fdnPos[c];
        this.fdnBufsL[c][pos] = fdnInL + fb[c] * mL[c];
        this.fdnBufsR[c][pos] = fdnInR + fb[c] * mR[c];
        this.fdnPos[c] = (pos + 1) % bs;
        lateL += yL[c];
        lateR += yR[c];
      }
      lateL *= 0.125;
      lateR *= 0.125;

      // ── Mix Early + Late ──────────────────────────────────────────
      let wetL = erL * erLvl + lateL;
      let wetR = erR * erLvl + lateR;

      // ── HPF (TUCK clears mud) ──────────────────────────────────────
      this.hpfL = hpfCoef * this.hpfL + (1 - hpfCoef) * wetL;
      this.hpfR = hpfCoef * this.hpfR + (1 - hpfCoef) * wetR;
      wetL -= this.hpfL;
      wetR -= this.hpfR;

      // ── COLOR: tilt EQ ────────────────────────────────────────────
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * wetL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * wetR;
      wetL = this.tiltLpL * tiltGainLow + (wetL - this.tiltLpL) * tiltGainHigh;
      wetR = this.tiltLpR * tiltGainLow + (wetR - this.tiltLpR) * tiltGainHigh;

      // ── COLOR: tape-style saturation ──────────────────────────────
      wetL = Math.tanh(wetL * satDrive) / satDrive;
      wetR = Math.tanh(wetR * satDrive) / satDrive;

      // ── GLUE: gentle compression (1.2:1 – 3:1) ───────────────────
      const wLvl = Math.max(Math.abs(wetL), Math.abs(wetR));
      if (wLvl > this.glueEnv) {
        this.glueEnv = glueAtk * this.glueEnv + (1 - glueAtk) * wLvl;
      } else {
        this.glueEnv = glueRel * this.glueEnv + (1 - glueRel) * wLvl;
      }
      let gr = 1;
      if (this.glueEnv > glueThresh) {
        const overDb  = 20 * Math.log10(this.glueEnv / glueThresh);
        const reducDb = overDb * (1 - 1 / glueRatio);
        gr = Math.pow(10, -reducDb / 20);
      }
      if ((1 - gr) > maxGr) maxGr = 1 - gr;
      wetL *= gr * glueMakeup;
      wetR *= gr * glueMakeup;

      // ── TUCK: sidechain ducking ────────────────────────────────────
      const inLvl = Math.max(Math.abs(dryL), Math.abs(dryR));
      if (inLvl > this.duckEnv) {
        this.duckEnv = duckAtk * this.duckEnv + (1 - duckAtk) * inLvl;
      } else {
        this.duckEnv = duckRel * this.duckEnv + (1 - duckRel) * inLvl;
      }
      wetL *= (1 - this.duckEnv * duckDepth);
      wetR *= (1 - this.duckEnv * duckDepth);

      // ── WIDTH: M/S ────────────────────────────────────────────────
      const mid  = (wetL + wetR) * 0.5;
      const side = (wetL - wetR) * 0.5;
      wetL = mid + side * widthScale;
      wetR = mid - side * widthScale;

      // ── SMOOTH ────────────────────────────────────────────────────
      if (smooth > 0.5) {
        const sCoef = Math.exp(-6.283185 * (6500 - smooth * 900) / sr);
        this.sLpL1 = sCoef * this.sLpL1 + (1 - sCoef) * wetL;
        this.sLpR1 = sCoef * this.sLpR1 + (1 - sCoef) * wetR;
        this.sLpL2 = sCoef * this.sLpL2 + (1 - sCoef) * this.sLpL1;
        this.sLpR2 = sCoef * this.sLpR2 + (1 - sCoef) * this.sLpR1;
        wetL = this.sLpL2; wetR = this.sLpR2;
      }

      // ── MIX ───────────────────────────────────────────────────────
      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const rl = Math.max(Math.abs(wetL), Math.abs(wetR));
      if (rl > rvAccum) rvAccum = rl;
      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._energy = this.duckEnv;
    this._reverbLevel = rvAccum;
    this._gr = maxGr;
    this.port.postMessage({ peak: peakAccum, energy: this.duckEnv, reverbLevel: rvAccum, gr: maxGr });
    return true;
  }
}
registerProcessor('${PROCESSOR_VERSION}', ReverbBusProcessor);
`;

export async function createReverbBusEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input = audioCtx.createGain(), output = audioCtx.createGain(), chainOutput = audioCtx.createGain();
  const inputTrim = audioCtx.createGain(), outputTrim = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, PROCESSOR_VERSION, {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(inputTrim); inputTrim.connect(analyserIn); analyserIn.connect(worklet);
  worklet.connect(analyserOut); analyserOut.connect(outputTrim);
  outputTrim.connect(output); outputTrim.connect(chainOutput);

  let _peak = 0, _energy = 0, _rv = 0, _gr = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak        !== undefined) _peak   = e.data.peak;
    if (e.data?.energy      !== undefined) _energy = e.data.energy;
    if (e.data?.reverbLevel !== undefined) _rv     = e.data.reverbLevel;
    if (e.data?.gr          !== undefined) _gr     = e.data.gr;
  };

  const _buf = new Float32Array(2048);
  function getRms(an)  { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setSpace:  v => { p('space').value  = v; },
    setTuck:   v => { p('tuck').value   = v; },
    setGlue:   v => { p('glue').value   = v; },
    setColor:  v => { p('color').value  = v; },
    setWidth:  v => { p('width').value  = v; },
    setMix:    v => { p('mix').value    = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },
    setMode:   v => { p('mode').value   = v; },

    getInputPeak:   () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn;  },
    getOutputPeak:  () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,
    getEnergy:      () => _energy,
    getReverbLevel: () => _rv,
    getGR:          () => _gr,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose()  { this.destroy(); },
  };
}
