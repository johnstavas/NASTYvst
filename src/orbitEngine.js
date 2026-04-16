// orbitEngine.js — ORBIT: Spatial Movement Reverb
//
// Reflections orbit through the stereo field.
// 3 comb + 2 allpass Schroeder reverb with 4 spatial taps
// that rotate/move through stereo via selectable path patterns.
//
// Controls:
//   SPEED  — orbit rate (0-1, maps to 0.05-2 Hz)
//   PATH   — mode 0=Circle, 1=Figure-8, 2=Drift, 3=Spiral
//   WIDTH  — L-R panning range (0-1)
//   DEPTH  — how much orbiting modulates reverb gain (0-1)
//   TONE   — tilt EQ dark-bright (0-1)
//   MIX    — dry/wet (0-1)
//   BYPASS

const PROCESSOR_VERSION = 'orbit-v1';

const PROCESSOR_CODE = `
class OrbitProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'speed',  defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'path',   defaultValue: 0,    minValue: 0, maxValue: 3 },
      { name: 'width',  defaultValue: 0.6,  minValue: 0, maxValue: 1 },
      { name: 'depth',  defaultValue: 0.4,  minValue: 0, maxValue: 1 },
      { name: 'tone',   defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'mix',    defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'bypass', defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth', defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;
    const scale = this.sr / 44100;

    // ── 8 parallel Freeverb-style comb filters (longer, more spread delays = lush)
    // Delay times in samples at 44.1kHz — prime-ish numbers for even diffusion
    const combMsL = [29.7, 37.1, 41.1, 43.7, 47.1, 53.5, 59.1, 63.3];
    const combMsR = [30.1, 37.5, 41.5, 44.1, 47.5, 54.0, 59.7, 63.9]; // slightly offset for stereo width
    this.combLensL = combMsL.map(ms => Math.round(ms * 0.001 * this.sr));
    this.combLensR = combMsR.map(ms => Math.round(ms * 0.001 * this.sr));
    const maxComb  = Math.round(70 * 0.001 * this.sr) + 32;
    this.combBufL  = Array.from({length:8}, () => new Float32Array(maxComb));
    this.combBufR  = Array.from({length:8}, () => new Float32Array(maxComb));
    this.combPosL  = new Int32Array(8);
    this.combPosR  = new Int32Array(8);
    this.combLpL   = new Float32Array(8);
    this.combLpR   = new Float32Array(8);

    // ── LFO modulation per comb (prevents metallic flutter, adds chorus lushness)
    this.lfoPhase  = Float32Array.from([0, 0.13, 0.25, 0.38, 0.50, 0.63, 0.75, 0.88]);
    this.lfoRate   = Float32Array.from([0.37, 0.41, 0.31, 0.43, 0.29, 0.47, 0.53, 0.37]); // Hz — slow chorus
    this.lfoDepthSamples = 6; // ±6 samples of modulation

    // ── 4 series allpass diffusers (smooth early reflections)
    const apMs = [12.7, 6.3, 3.1, 1.7];
    this.apLensL = apMs.map(ms => Math.round(ms * 0.001 * this.sr));
    this.apLensR = apMs.map(ms => Math.round((ms + 0.1) * 0.001 * this.sr));
    const maxAp  = Math.round(15 * 0.001 * this.sr) + 16;
    this.apBufL  = Array.from({length:4}, () => new Float32Array(maxAp));
    this.apBufR  = Array.from({length:4}, () => new Float32Array(maxAp));
    this.apPosL  = new Int32Array(4);
    this.apPosR  = new Int32Array(4);

    // ── Orbit / spatial movement
    this.orbitPhase = 0;
    this.driftX = 0; this.driftY = 0;
    this.driftTargetX = 0; this.driftTargetY = 0;
    this.driftTimer = 0;
    this.spiralRadius = 0.5;
    this.spiralDir = 1;

    // ── Tilt EQ
    this.tiltLpL = 0; this.tiltLpR = 0;

    this._peak = 0; this._orbX = 0; this._orbY = 0;

    // Smooth LP state
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  // Hermite interpolation for smooth LFO-modulated reads
  hermite(buf, pos, frac, size) {
    const i  = ((pos % size) + size) % size;
    const xm1 = buf[(i - 1 + size) % size];
    const x0  = buf[i];
    const x1  = buf[(i + 1) % size];
    const x2  = buf[(i + 2) % size];
    const c0 = x0;
    const c1 = 0.5 * (x1 - xm1);
    const c2 = xm1 - 2.5*x0 + 2*x1 - 0.5*x2;
    const c3 = 0.5*(x2 - xm1) + 1.5*(x0 - x1);
    return ((c3*frac + c2)*frac + c1)*frac + c0;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0]; const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0], iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0], oR = outBufs[1] || outBufs[0];

    const speed  = params.speed[0];
    const path   = Math.round(params.path[0]);
    const width  = params.width[0];
    const depth  = params.depth[0];
    const tone   = params.tone[0];
    const mix    = params.mix[0];
    const bypass = params.bypass[0] > 0.5;
    const sr     = this.sr;

    let peakAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const a = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (a > peakAccum) peakAccum = a;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, orbX: 0, orbY: 0 });
      return true;
    }

    // Lush reverb time — size mapped to 0.82–0.93 feedback
    const combFb   = 0.82 + depth * 0.11;
    // Damping: tone 0=warm/dark (2kHz cutoff), 1=bright (18kHz)
    const dampFreq = 2000 + tone * 16000;
    const dampCoef = Math.exp(-2 * Math.PI * dampFreq / sr);
    const apCoef   = 0.5;

    // Orbit LFO rate
    const orbitHz  = 0.05 + speed * speed * 3.0;
    const orbitInc = orbitHz / sr;

    // Tilt EQ — gentle, not dramatic
    const tiltFreq = 1000;
    const tiltCoef = Math.exp(-2 * Math.PI * tiltFreq / sr);
    const tiltGainLow  = 1 + (0.5 - tone) * 1.2;
    const tiltGainHigh = 1 + (tone - 0.5) * 1.2;

    // Drift update
    this.driftTimer += iL.length;
    if (this.driftTimer > sr * 0.5) {
      this.driftTimer = 0;
      this.driftTargetX = Math.random() * 2 - 1;
      this.driftTargetY = Math.random() * 2 - 1;
    }
    this.driftX += (this.driftTargetX - this.driftX) * 0.001;
    this.driftY += (this.driftTargetY - this.driftY) * 0.001;

    // Spiral
    this.spiralRadius += this.spiralDir * 0.00015 * (0.3 + speed);
    if (this.spiralRadius > 1)    { this.spiralRadius = 1;    this.spiralDir = -1; }
    if (this.spiralRadius < 0.1)  { this.spiralRadius = 0.1;  this.spiralDir =  1; }

    // Per-block LFO increment
    const lfoInc = new Float32Array(8);
    for (let i = 0; i < 8; i++) lfoInc[i] = this.lfoRate[i] / sr;

    let lastOrbX = 0, lastOrbY = 0;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];
      // Decorrelated stereo input
      const inL = dryL * 0.5 + dryR * 0.15;
      const inR = dryR * 0.5 + dryL * 0.15;

      // ── 8 parallel lush comb filters
      let reverbL = 0, reverbR = 0;
      for (let c = 0; c < 8; c++) {
        // LFO modulates read position for chorus lushness
        this.lfoPhase[c] += lfoInc[c];
        if (this.lfoPhase[c] >= 1) this.lfoPhase[c] -= 1;
        const lfoVal = Math.sin(this.lfoPhase[c] * 2 * Math.PI);
        const modSamples = lfoVal * this.lfoDepthSamples * (0.3 + depth * 0.7);

        // Left comb
        const bsL   = this.combBufL[c].length;
        const readPL = this.combPosL[c] - this.combLensL[c] + modSamples;
        const rL     = Math.floor(readPL);
        const fL     = readPL - rL;
        const cL_raw = this.hermite(this.combBufL[c], rL, fL, bsL);
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * cL_raw;
        const cL = this.combLpL[c];
        this.combBufL[c][this.combPosL[c]] = inL + cL * combFb;
        this.combPosL[c] = (this.combPosL[c] + 1) % bsL;

        // Right comb
        const bsR   = this.combBufR[c].length;
        const readPR = this.combPosR[c] - this.combLensR[c] - modSamples; // inverse mod = wider stereo
        const rR     = Math.floor(readPR);
        const fR     = readPR - rR;
        const cR_raw = this.hermite(this.combBufR[c], rR, fR, bsR);
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * cR_raw;
        const cR = this.combLpR[c];
        this.combBufR[c][this.combPosR[c]] = inR + cR * combFb;
        this.combPosR[c] = (this.combPosR[c] + 1) % bsR;

        reverbL += cL;
        reverbR += cR;
      }
      reverbL *= 0.125; // /8
      reverbR *= 0.125;

      // ── 4 series allpass diffusers
      for (let a = 0; a < 4; a++) {
        const bsL  = this.apBufL[a].length;
        const posL = this.apPosL[a];
        const ridL = ((posL - this.apLensL[a]) % bsL + bsL) % bsL;
        const delL = this.apBufL[a][ridL];
        const outL = -apCoef * reverbL + delL;
        this.apBufL[a][posL] = reverbL + apCoef * delL;
        this.apPosL[a] = (posL + 1) % bsL;

        const bsR  = this.apBufR[a].length;
        const posR = this.apPosR[a];
        const ridR = ((posR - this.apLensR[a]) % bsR + bsR) % bsR;
        const delR = this.apBufR[a][ridR];
        const outR = -apCoef * reverbR + delR;
        this.apBufR[a][posR] = reverbR + apCoef * delR;
        this.apPosR[a] = (posR + 1) % bsR;

        reverbL = outL; reverbR = outR;
      }

      // ── Spatial orbit: 4 taps panned around stereo field
      this.orbitPhase += orbitInc;
      if (this.orbitPhase > 1) this.orbitPhase -= 1;
      const t = this.orbitPhase * Math.PI * 2;

      let spatialL = 0, spatialR = 0;
      for (let tap = 0; tap < 4; tap++) {
        const tapPhase = t + (tap / 4) * Math.PI * 2;
        let panX, panY;

        if (path === 0) {
          panX = Math.cos(tapPhase); panY = Math.sin(tapPhase);
        } else if (path === 1) {
          panX = Math.sin(tapPhase); panY = Math.sin(tapPhase * 2);
        } else if (path === 2) {
          panX = this.driftX + Math.sin(tapPhase) * 0.4;
          panY = this.driftY + Math.cos(tapPhase) * 0.4;
        } else {
          const r = this.spiralRadius;
          panX = Math.cos(tapPhase) * r; panY = Math.sin(tapPhase) * r;
        }

        if (tap === 0) { lastOrbX = panX; lastOrbY = panY; }

        const pan      = Math.max(0, Math.min(1, panX * width * 0.5 + 0.5));
        const panL     = Math.cos(pan * Math.PI * 0.5);
        const panR     = Math.sin(pan * Math.PI * 0.5);
        const gainMod  = 1 + panY * depth * 0.4;
        const tapSig   = reverbL * 0.5 + reverbR * 0.5;

        spatialL += tapSig * gainMod * panL * 0.3;
        spatialR += tapSig * gainMod * panR * 0.3;
      }

      // Tilt EQ
      this.tiltLpL = tiltCoef * this.tiltLpL + (1 - tiltCoef) * spatialL;
      this.tiltLpR = tiltCoef * this.tiltLpR + (1 - tiltCoef) * spatialR;
      let wetL = this.tiltLpL * tiltGainLow + (spatialL - this.tiltLpL) * tiltGainHigh;
      let wetR = this.tiltLpR * tiltGainLow + (spatialR - this.tiltLpR) * tiltGainHigh;

      // Soft limit
      wetL = Math.tanh(wetL * 0.9) * 1.05;
      wetR = Math.tanh(wetR * 0.9) * 1.05;

      // Smooth LP filter on wet signal
      const smooth = params.smooth[0];
      if (smooth > 0.5) {
        const smoothFreq = 6500 - smooth * 900;
        const smoothCoef = Math.exp(-2 * Math.PI * smoothFreq / sr);
        this.smoothLpL1 = smoothCoef * this.smoothLpL1 + (1 - smoothCoef) * wetL;
        this.smoothLpR1 = smoothCoef * this.smoothLpR1 + (1 - smoothCoef) * wetR;
        this.smoothLpL2 = smoothCoef * this.smoothLpL2 + (1 - smoothCoef) * this.smoothLpL1;
        this.smoothLpR2 = smoothCoef * this.smoothLpR2 + (1 - smoothCoef) * this.smoothLpR1;
        wetL = this.smoothLpL2;
        wetR = this.smoothLpR2;
      }

      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._orbX = lastOrbX; this._orbY = lastOrbY;
    this.port.postMessage({ peak: peakAccum, orbX: lastOrbX, orbY: lastOrbY, phase: this.orbitPhase });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', OrbitProcessor);
`;

export async function createOrbitEngine(audioCtx) {
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

  let _peak = 0, _orbX = 0, _orbY = 0, _phase = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.orbX !== undefined) _orbX = e.data.orbX;
    if (e.data?.orbY !== undefined) _orbY = e.data.orbY;
    if (e.data?.phase !== undefined) _phase = e.data.phase;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) { an.getFloatTimeDomainData(_buf); let s=0; for(let i=0;i<_buf.length;i++) s+=_buf[i]*_buf[i]; return Math.sqrt(s/_buf.length); }
  function getPeak(an) { an.getFloatTimeDomainData(_buf); let m=0; for(let i=0;i<_buf.length;i++){const a=Math.abs(_buf[i]);if(a>m)m=a;} return m; }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0; const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain: v => { inputTrim.gain.value = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setSpeed:  v => { p('speed').value  = v; },
    setPath:   v => { p('path').value   = v; },
    setWidth:  v => { p('width').value  = v; },
    setDepth:  v => { p('depth').value  = v; },
    setTone:   v => { p('tone').value   = v; },
    setMix:    v => { p('mix').value    = v; },
    setBypass: v => { p('bypass').value = v ? 1 : 0; },
    setSmooth: v => { p('smooth').value = v; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getOrbX: () => _orbX,
    getOrbY: () => _orbY,
    getPhase: () => _phase,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
