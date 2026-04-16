// smearEngine.js — SMEAR: Dream/Lo-Fi Unstable Reverb
//
// Blur reality with dense, overlapping reflections that smear together.
// 4 parallel comb filters with crossfeed, slow random-walk pitch drift,
// bit-depth degradation, noise injection, and tilt EQ.
//
// Controls:
//   SMEAR   — comb feedback + crossfeed density (0-1)
//   DRIFT   — pitch instability / warble depth (0-1)
//   DEGRADE — bit crush + noise + LP aging (0-1)
//   SIZE    — comb delay length scaling (0-1)
//   TONE    — tilt EQ dark-bright (0-1)
//   MIX     — dry/wet (0-1)
//   BYPASS

const PROCESSOR_VERSION = 'smear-v2';

const PROCESSOR_CODE = `
class SmearProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'smear',   defaultValue: 0.4,  minValue: 0, maxValue: 1 },
      { name: 'drift',   defaultValue: 0.2,  minValue: 0, maxValue: 1 },
      { name: 'degrade', defaultValue: 0.15, minValue: 0, maxValue: 1 },
      { name: 'size',    defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'tone',    defaultValue: 0.45, minValue: 0, maxValue: 1 },
      { name: 'mix',     defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'bypass',  defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'smooth',  defaultValue: 0,    minValue: 0, maxValue: 5 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    const scale = this.sr / 44100;

    // ── Allpass diffuser (4 stages, 5–30 ms) ────────────────────────────────
    this.apBufL = []; this.apBufR = []; this.apPos = [];
    const apLens = [347, 613, 1061, 1801].map(l => Math.round(l * scale));
    for (let i = 0; i < 4; i++) {
      this.apBufL.push(new Float32Array(apLens[i] + 4));
      this.apBufR.push(new Float32Array(apLens[i] + 4));
      this.apPos.push(0);
    }
    this.apLens = apLens;

    // ── 6 comb filters — longer delays (35–270 ms range with SIZE) ──────────
    // Base lengths at 44.1k: 2837–4799 samples (~64–109 ms)
    // SIZE 0.5→2.5 scales these to 35 ms min … 270 ms max
    const combBase = [2837, 3217, 3659, 4073, 4523, 4799];
    this.combLens = combBase.map(l => Math.round(l * scale));

    this.combBufL = []; this.combBufR = [];
    this.combPos  = [];
    this.combLpL  = new Float32Array(6);
    this.combLpR  = new Float32Array(6);

    // Max buffer must cover SIZE=2.5 × largest base (4799) at max SR ratio
    const maxLen = Math.round(4799 * scale * 2.6) + 64;
    for (let i = 0; i < 6; i++) {
      this.combBufL.push(new Float32Array(maxLen));
      this.combBufR.push(new Float32Array(maxLen));
      this.combPos.push(0);
    }

    // ── Drift LFOs — slow sines, 0.05–0.15 Hz ──────────────────────────────
    // 6 combs, slightly different rates and starting phases
    this.driftPhase  = [0, 0.17, 0.33, 0.50, 0.67, 0.83];
    this.driftRate   = [0.05, 0.071, 0.089, 0.107, 0.13, 0.149];
    // Random-walk layer (same as v1, just extended to 6)
    this.driftWalk   = new Float32Array(6);
    this.driftTarget = new Float32Array(6);
    this.driftCounter = new Int32Array(6);

    // ── Tilt EQ + degrade LP state ──────────────────────────────────────────
    this.tiltLpL = 0; this.tiltLpR = 0;
    this.tiltHpL = 0; this.tiltHpR = 0;
    this.degLpL  = 0; this.degLpR  = 0;

    // ── Metering ────────────────────────────────────────────────────────────
    this._peak = 0;
    this._smearLevel = 0;

    // ── Smooth LP state ─────────────────────────────────────────────────────
    this.smoothLpL1 = 0; this.smoothLpR1 = 0;
    this.smoothLpL2 = 0; this.smoothLpR2 = 0;

    this.port.postMessage({ ready: true });
  }

  // Hermite cubic interpolation (unchanged from v1)
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

    const smear   = params.smear[0];
    const drift   = params.drift[0];
    const degrade = params.degrade[0];
    const size    = params.size[0];
    const tone    = params.tone[0];
    const mix     = params.mix[0];
    const bypass  = params.bypass[0] > 0.5;
    const sr      = this.sr;

    let peakAccum  = 0;
    let smearAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum; this._smearLevel = 0;
      this.port.postMessage({ peak: peakAccum, smearLevel: 0 });
      return true;
    }

    // ── Per-block constants ──────────────────────────────────────────────────

    // Comb feedback: 0.50 (short decay) → 0.90 (very long lush decay)
    const baseFb = 0.50 + smear * 0.40;

    // Crossfeed between adjacent combs: 0 → 0.15
    const crossfeed = smear * 0.15;

    // SIZE: 0.5× → 2.5× base delay lengths  (35 ms → ~270 ms)
    const sizeScale = 0.5 + size * 2.0;

    // LP damping inside comb feedback — darker as smear rises
    const dampFreq = 3500 - smear * 2000;   // 1500–3500 Hz
    const dampCoef = Math.exp(-2 * Math.PI * dampFreq / sr);

    // Drift depth: ±60 samples at full drift (audible pitch wander)
    const driftDepth = drift * 60;

    // Degrade settings — tape warmth/smear, not hiss
    // Low (0-0.4):  gentle tape saturation + subtle LP warmth
    // High (0.4-1): heavy saturation + strong LP + pitch smearing (warbly tape)
    const degradeSat   = degrade * 2.2;          // saturation drive 0→2.2
    const degradeLpFreq = 18000 - degrade * 13000; // LP cutoff 18kHz→5kHz
    const degradeLpCoef = Math.exp(-2 * Math.PI * degradeLpFreq / sr);
    const pitchInstab = Math.max(0, (degrade - 0.2) / 0.8) * 18; // aggressive tape wobble above 0.2

    // Tilt EQ: dark(0)=heavy LP at 800 Hz, bright(1)=HP shelf boost — ±1.5×
    const tiltFreq    = 800;
    const tiltCoef    = Math.exp(-2 * Math.PI * tiltFreq / sr);
    const tiltGainLow  = 1 + (0.5 - tone) * 1.5;   // 0.25→1.75
    const tiltGainHigh = 1 + (tone - 0.5) * 1.5;   // 0.25→1.75

    // Allpass coefficient (fixed)
    const apCoef = 0.7;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n], dryR = iR[n];

      // ── 1. Allpass diffuser — 4 Schroeder stages ──────────────────────────
      let diffL = dryL, diffR = dryR;
      for (let a = 0; a < 4; a++) {
        const len  = this.apLens[a];
        const bufL = this.apBufL[a], bufR = this.apBufR[a];
        const pos  = this.apPos[a];
        const delayedL = bufL[pos], delayedR = bufR[pos];
        // Standard Schroeder allpass: w = x − g·d;  y = d + g·w
        const wL = diffL - apCoef * delayedL;
        const wR = diffR - apCoef * delayedR;
        bufL[pos] = wL; bufR[pos] = wR;
        diffL = delayedL + apCoef * wL;
        diffR = delayedR + apCoef * wR;
        this.apPos[a] = (pos + 1) % len;
      }
      // diffL/diffR is now the early-reflection cloud fed into the combs

      // ── 2. 6 parallel comb filters ────────────────────────────────────────
      let wetL = 0, wetR = 0;

      // Store each comb's output for crossfeed into the next
      const cOutStore = [0, 0, 0, 0, 0, 0];

      for (let c = 0; c < 6; c++) {
        const baseLen = Math.round(this.combLens[c] * sizeScale);
        const bufSize = this.combBufL[c].length;

        // Update drift LFO + random walk
        this.driftPhase[c] += this.driftRate[c] / sr;
        if (this.driftPhase[c] > 1) this.driftPhase[c] -= 1;
        this.driftCounter[c]++;
        if (this.driftCounter[c] > sr * 0.3) {
          this.driftCounter[c] = 0;
          this.driftTarget[c] = (Math.random() * 2 - 1);
        }
        this.driftWalk[c] += (this.driftTarget[c] - this.driftWalk[c]) * 0.0001;
        const lfoVal   = Math.sin(2 * Math.PI * this.driftPhase[c]) * 0.7
                       + this.driftWalk[c] * 0.3;
        // At high degrade, add extra pitch instability on top of normal drift
        const instabExtra = pitchInstab > 0
          ? (Math.random() * 2 - 1) * pitchInstab
          : 0;
        const modOffset = lfoVal * driftDepth + instabExtra;

        // Read from comb with hermite interpolation
        const readPos = this.combPos[c] - baseLen + modOffset;
        let cOutL = this.hermite(this.combBufL[c], readPos, bufSize);
        let cOutR = this.hermite(this.combBufR[c], readPos, bufSize);

        // LP damping in feedback path
        this.combLpL[c] = dampCoef * this.combLpL[c] + (1 - dampCoef) * cOutL;
        this.combLpR[c] = dampCoef * this.combLpR[c] + (1 - dampCoef) * cOutR;
        cOutL = this.combLpL[c];
        cOutR = this.combLpR[c];

        cOutStore[c] = cOutL; // store for crossfeed (mono proxy)

        // Crossfeed from the previous comb
        const prevC = (c + 5) % 6;
        const xfL = cOutStore[prevC] * crossfeed;
        const xfR = cOutStore[prevC] * crossfeed; // symmetric stereo crossfeed

        // Write: diffused input + feedback + crossfeed
        this.combBufL[c][this.combPos[c]] = diffL + cOutL * baseFb + xfL;
        this.combBufR[c][this.combPos[c]] = diffR + cOutR * baseFb + xfR;

        this.combPos[c] = (this.combPos[c] + 1) % bufSize;

        wetL += cOutL;
        wetR += cOutR;
      }

      // Normalize 6 comb outputs
      wetL /= 6;
      wetR /= 6;

      // ── 3. Degrade layer — tape warmth, not hiss ─────────────────────────
      if (degrade > 0.01) {
        // Tape saturation: soft clip with drive — adds warmth/harmonics not noise
        wetL = Math.tanh(wetL * (1 + degradeSat)) / (1 + degradeSat * 0.5);
        wetR = Math.tanh(wetR * (1 + degradeSat)) / (1 + degradeSat * 0.5);
        // LP warmth: progressively rolls off highs like old tape
        this.degLpL = degradeLpCoef * this.degLpL + (1 - degradeLpCoef) * wetL;
        this.degLpR = degradeLpCoef * this.degLpR + (1 - degradeLpCoef) * wetR;
        const lpBlend = Math.min(1, degrade * 1.1);
        wetL = wetL * (1 - lpBlend * 0.55) + this.degLpL * lpBlend * 0.55;
        wetR = wetR * (1 - lpBlend * 0.6) + this.degLpR * lpBlend * 0.6;
      }

      // ── 4. Tilt EQ ────────────────────────────────────────────────────────
      this.tiltHpL = tiltCoef * this.tiltHpL + (1 - tiltCoef) * wetL;
      this.tiltHpR = tiltCoef * this.tiltHpR + (1 - tiltCoef) * wetR;
      const lowL = this.tiltHpL, lowR = this.tiltHpR;
      const highL = wetL - lowL, highR = wetR - lowR;
      wetL = lowL * tiltGainLow + highL * tiltGainHigh;
      wetR = lowR * tiltGainLow + highR * tiltGainHigh;

      // ── 5. Tanh soft clip ─────────────────────────────────────────────────
      wetL = Math.tanh(wetL);
      wetR = Math.tanh(wetR);

      // ── 6. 2-pole smooth LP filter on wet signal ──────────────────────────
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

      // ── 7. Mix ────────────────────────────────────────────────────────────
      oL[n] = dryL * (1 - mix) + wetL * mix;
      oR[n] = dryR * (1 - mix) + wetR * mix;

      const sl = Math.max(Math.abs(wetL), Math.abs(wetR));
      if (sl > smearAccum) smearAccum = sl;
      const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peak = peakAccum;
    this._smearLevel = smearAccum;
    this.port.postMessage({ peak: peakAccum, smearLevel: smearAccum });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', SmearProcessor);
`;

export async function createSmearEngine(audioCtx) {
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

  let _peak = 0, _smearLevel = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.smearLevel !== undefined) _smearLevel = e.data.smearLevel;
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
    setSmear:   v => { p('smear').value   = v; },
    setDrift:   v => { p('drift').value   = v; },
    setDegrade: v => { p('degrade').value = v; },
    setSize:    v => { p('size').value    = v; },
    setTone:    v => { p('tone').value    = v; },
    setMix:     v => { p('mix').value     = v; },
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },
    setSmooth:  v => { p('smooth').value  = v; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getSmearLevel: () => _smearLevel,

    destroy() { worklet.disconnect(); input.disconnect(); inputTrim.disconnect(); output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect(); analyserIn.disconnect(); analyserOut.disconnect(); },
    dispose() { this.destroy(); },
  };
}
