// shagatronEngine.js — Shagatron Bass Tone Shaper / Tube Drive
//
// A bass-first tone conditioner inspired by Class A valve preamps (Sebatron).
// NOT a compressor — it's a harmonic drive with bass-safe band splitting.
//
// Signal flow:
//   Audio: input × SHAG drive
//        → tube drive stage (Class A style)
//        → band split (LP 120 Hz / HP 120 Hz)
//        → low band:  gentle tube warmth (half drive, preserves sub)
//        → mid/high:  full tube drive + HAIR saturation
//        → recombine
//        → dynamic smoothing (subtle program-dependent leveling)
//        → tone stage (WEIGHT shelf, BITE mid peak, TIGHT LP control)
//        → output trim (LEVEL)
//        → parallel MIX with dry
//        → output

const PROCESSOR_VERSION = 'v4';

const PROCESSOR_CODE = `
class ShagatronProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'shag',    defaultValue: 0.4, minValue: 0, maxValue: 1 },   // input drive
      { name: 'level',   defaultValue: 0,   minValue: -12, maxValue: 12 }, // output trim dB
      { name: 'weight',  defaultValue: 0,   minValue: 0, maxValue: 1 },   // low-end body
      { name: 'bite',    defaultValue: 0,   minValue: 0, maxValue: 1 },   // mid definition
      { name: 'tight',   defaultValue: 0,   minValue: 0, maxValue: 1 },   // low-end control
      { name: 'hair',    defaultValue: 0,   minValue: 0, maxValue: 1 },   // harmonic edge
      { name: 'mix',     defaultValue: 1,   minValue: 0, maxValue: 1 },   // dry/wet
      { name: 'mode',    defaultValue: 0,   minValue: 0, maxValue: 2 },   // 0=Smooth, 1=Thick, 2=Angry
      { name: 'air',     defaultValue: 0,   minValue: 0, maxValue: 1 },   // HF presence / shimmer
      { name: 'smooth',  defaultValue: 0,   minValue: 0, maxValue: 1 },   // transient softener
      { name: 'bypass',  defaultValue: 0,   minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Band split state (Linkwitz-Riley style, 2nd order via 2× one-pole) ──
    // LP and HP at 120 Hz for bass-safe processing
    this.lpCoef = Math.exp(-2 * Math.PI * 120 / this.sr);
    this.lp1L = 0; this.lp1R = 0;  // first pole
    this.lp2L = 0; this.lp2R = 0;  // second pole

    // ── Dynamic smoothing envelope ──────────────────────────────────────────
    this.envL = 0; this.envR = 0;
    this.envAtk  = Math.exp(-1 / (this.sr * 0.010));  // 10 ms attack
    this.envRel  = Math.exp(-1 / (this.sr * 0.200));  // 200 ms release (slow, musical)

    // ── Tone stage filters ──────────────────────────────────────────────────
    // WEIGHT: one-pole LP at 200 Hz for low shelf boost
    this.weightLpL = 0; this.weightLpR = 0;
    this.weightCoef = Math.exp(-2 * Math.PI * 200 / this.sr);

    // BITE: bandpass via LP-HP cascade around 1.2 kHz
    this.biteLpL = 0; this.biteLpR = 0;
    this.biteHpL = 0; this.biteHpR = 0;
    this.biteLpCoef = Math.exp(-2 * Math.PI * 2400 / this.sr);  // LP at 2.4k
    this.biteHpCoef = Math.exp(-2 * Math.PI * 600 / this.sr);   // HP at 600 Hz

    // TIGHT: 2nd-order HP for low-end tightening (two cascaded one-pole)
    this.tightHp1L = 0; this.tightHp1R = 0;
    this.tightHp2L = 0; this.tightHp2R = 0;
    this.tightPrev1L = 0; this.tightPrev1R = 0;
    this.tightPrev2L = 0; this.tightPrev2R = 0;

    // AIR: one-pole LP to extract HF via subtraction, ~3.5 kHz
    // Lower crossover catches more mid-highs for bass content
    this.airLpL = 0; this.airLpR = 0;
    this.airLpCoef = Math.exp(-2 * Math.PI * 3500 / this.sr);

    // SMOOTH: dynamic LP filter — catches transient clicks, opens for sustain
    // Fast attack grabs the finger/pick click, slow release preserves tone
    this.smoothEnv = 0;
    this.smoothAtk = Math.exp(-1 / (this.sr * 0.0003));  // 0.3 ms attack — catches click
    this.smoothRel = Math.exp(-1 / (this.sr * 0.060));    // 60 ms release — opens for sustain
    this.smoothLpL = 0; this.smoothLpR = 0;

    // ── Meter feedback ──────────────────────────────────────────────────────
    this._peakOut = 0;

    this.port.postMessage({ ready: true });
  }

  // Class A tube stage — tanh with unity gain at small signal.
  // Asymmetric: positive half clips slightly earlier for H2 generation.
  tubeStage(x, drive) {
    const td = Math.tanh(drive);
    const denom = td < 1e-6 ? 1 : td;
    // Asymmetric bias: shift input slightly for H2 (even harmonic warmth)
    const biased = x + 0.05 * x * x;
    return Math.tanh(biased * drive) / denom;
  }

  // Harmonic enhancer — adds H2 + H3 via polynomial, pre-driven for audibility
  addHarmonics(x, amount) {
    const d = x * 4;  // pre-drive
    const h2 = 0.4 * d * Math.abs(d);  // H2 warmth
    const h3 = 0.15 * d * d * d;        // H3 punch
    return x + Math.tanh((h2 + h3) * 0.5) * amount * 0.2;
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const shag    = params.shag[0];
    const levelDb = params.level[0];
    const weight  = params.weight[0];
    const bite    = params.bite[0];
    const tight   = params.tight[0];
    const hair    = params.hair[0];
    const mix     = params.mix[0];
    const air     = params.air[0];
    const smooth  = params.smooth[0];
    const mode    = Math.round(params.mode[0]);  // 0, 1, 2
    const bypass  = params.bypass[0] > 0.5;

    // Mode-dependent parameters
    // SMOOTH: clean, wide, minimal sat
    // THICK:  stronger H2/H3, fuller mid
    // ANGRY:  aggressive harmonics, tighter low, harder drive
    const modeDrive   = mode === 0 ? 1.0 : mode === 1 ? 1.4 : 2.0;
    const modeHarmMul = mode === 0 ? 0.3 : mode === 1 ? 0.7 : 1.0;
    const modeTightAdd = mode === 0 ? 0 : mode === 1 ? 0.1 : 0.25;

    // Input drive — SHAG knob: exponential map 0→1 to 1→18× gain
    const shagDrive = 1 + shag * shag * 17;
    const effectiveDrive = shagDrive * modeDrive * (1 + 0.3 * hair);

    // Tube drive level (controls saturation curve steepness)
    const tubeDriveLevel = 0.5 + shag * 1.5 * modeDrive;

    // Output trim
    const levelLin = Math.pow(10, levelDb / 20);

    // Dynamic smoothing threshold — mode-dependent
    const dynThresh = mode === 0 ? 0.7 : mode === 1 ? 0.55 : 0.4;
    const dynRatio  = mode === 0 ? 2.0 : mode === 1 ? 2.5 : 3.5;

    // LP coef for band split
    const lpC = this.lpCoef;
    const envA = this.envAtk;
    const envR = this.envRel;

    let peakAccum = 0;

    for (let n = 0; n < iL.length; n++) {
      const dryL = iL[n];
      const dryR = iR[n];

      // ── 1. Input drive ─────────────────────────────────────────────────
      let xL = dryL * effectiveDrive;
      let xR = dryR * effectiveDrive;

      // ── 2. Initial tube stage (Class A) ────────────────────────────────
      xL = this.tubeStage(xL, tubeDriveLevel);
      xR = this.tubeStage(xR, tubeDriveLevel);

      // ── 3. Band split: 2× one-pole LP for 2nd order (~12 dB/oct) ─────
      this.lp1L = lpC * this.lp1L + (1 - lpC) * xL;
      this.lp1R = lpC * this.lp1R + (1 - lpC) * xR;
      this.lp2L = lpC * this.lp2L + (1 - lpC) * this.lp1L;
      this.lp2R = lpC * this.lp2R + (1 - lpC) * this.lp1R;

      const lowL = this.lp2L;
      const lowR = this.lp2R;
      const midL = xL - lowL;
      const midR = xR - lowR;

      // ── 4. Low band: gentle warmth, preserve sub ──────────────────────
      //     Half drive — never crush the lows
      const lowProcL = this.tubeStage(lowL * 0.5, tubeDriveLevel * 0.4) * 2;
      const lowProcR = this.tubeStage(lowR * 0.5, tubeDriveLevel * 0.4) * 2;

      // ── 5. Mid/high band: full drive + HAIR harmonics ─────────────────
      let midProcL = this.tubeStage(midL, tubeDriveLevel);
      let midProcR = this.tubeStage(midR, tubeDriveLevel);

      // HAIR: additional harmonic saturation on mids
      if (hair > 0.01) {
        midProcL = this.addHarmonics(midProcL, hair * modeHarmMul);
        midProcR = this.addHarmonics(midProcR, hair * modeHarmMul);
      }

      // ── 6. Recombine ──────────────────────────────────────────────────
      let wetL = lowProcL + midProcL;
      let wetR = lowProcR + midProcR;

      // ── 7. Dynamic smoothing (subtle, program-dependent) ──────────────
      //     Soft leveling — NOT a compressor, just tames peaks
      const absL = Math.abs(wetL);
      const absR = Math.abs(wetR);
      const peak = Math.max(absL, absR);
      const coef = peak > this.envL ? (1 - envA) : (1 - envR);
      this.envL += coef * (peak - this.envL);

      if (this.envL > dynThresh) {
        const over = this.envL - dynThresh;
        const gr = 1 - over / (over + dynRatio);  // soft knee reduction
        wetL *= gr;
        wetR *= gr;
      }

      // ── 8. Tone stage ─────────────────────────────────────────────────

      // WEIGHT: low shelf boost — add LP-filtered bass back on top
      if (weight > 0.01) {
        this.weightLpL = this.weightCoef * this.weightLpL + (1 - this.weightCoef) * wetL;
        this.weightLpR = this.weightCoef * this.weightLpR + (1 - this.weightCoef) * wetR;
        wetL += this.weightLpL * weight * 0.6;
        wetR += this.weightLpR * weight * 0.6;
      }

      // BITE: mid peak boost around 1.2 kHz (bandpass: LP 2.4k → HP 600 Hz)
      if (bite > 0.01) {
        this.biteLpL = this.biteLpCoef * this.biteLpL + (1 - this.biteLpCoef) * wetL;
        this.biteLpR = this.biteLpCoef * this.biteLpR + (1 - this.biteLpCoef) * wetR;
        const bpRawL = this.biteLpL;
        const bpRawR = this.biteLpR;
        this.biteHpL = this.biteHpCoef * this.biteHpL + (1 - this.biteHpCoef) * bpRawL;
        this.biteHpR = this.biteHpCoef * this.biteHpR + (1 - this.biteHpCoef) * bpRawR;
        const midBandL = bpRawL - this.biteHpL;
        const midBandR = bpRawR - this.biteHpR;
        wetL += midBandL * bite * 1.2;
        wetR += midBandR * bite * 1.2;
      }

      // TIGHT: 2nd-order HP for low-end tightness
      //   Modulates HP cutoff from ~50 Hz (tight=0) to ~350 Hz (tight=1)
      //   Two cascaded one-pole stages = 12 dB/oct slope — really carves lows
      if (tight > 0.01 || modeTightAdd > 0) {
        const tTotal = Math.min(1, tight + modeTightAdd);
        const tFreq = 50 + tTotal * 300;
        const tCoef = Math.exp(-2 * Math.PI * tFreq / this.sr);
        // 1st stage
        this.tightHp1L = tCoef * (this.tightHp1L + wetL - this.tightPrev1L);
        this.tightHp1R = tCoef * (this.tightHp1R + wetR - this.tightPrev1R);
        this.tightPrev1L = wetL;
        this.tightPrev1R = wetR;
        // 2nd stage
        this.tightHp2L = tCoef * (this.tightHp2L + this.tightHp1L - this.tightPrev2L);
        this.tightHp2R = tCoef * (this.tightHp2R + this.tightHp1R - this.tightPrev2R);
        this.tightPrev2L = this.tightHp1L;
        this.tightPrev2R = this.tightHp1R;
        // Blend — 80% wet at max so the effect is unmistakable
        const tBlend = tTotal * 0.8;
        wetL = wetL * (1 - tBlend) + this.tightHp2L * tBlend;
        wetR = wetR * (1 - tBlend) + this.tightHp2R * tBlend;
      }

      // ── 9. AIR — HF presence / shimmer ─────────────────────────────
      //     Extract HF by subtracting LP (3.5kHz) from signal.
      //     Boost it back with soft saturation for harmonic shimmer.
      //     +8 dB shelf at max — unmistakable on bass content.
      if (air > 0.01) {
        this.airLpL = this.airLpCoef * this.airLpL + (1 - this.airLpCoef) * wetL;
        this.airLpR = this.airLpCoef * this.airLpR + (1 - this.airLpCoef) * wetR;
        const hfL = wetL - this.airLpL;
        const hfR = wetR - this.airLpR;
        // Saturated HF boost — tanh keeps it musical, higher gain makes it heard
        const airBoostL = Math.tanh(hfL * 3) * air * 0.8;
        const airBoostR = Math.tanh(hfR * 3) * air * 0.8;
        wetL += airBoostL;
        wetR += airBoostR;
      }

      // ── 9b. SMOOTH — dynamic transient softener ──────────────────────
      //     Envelope follower catches the HF click from finger/pick attack.
      //     When transient spikes, LP cutoff drops to swallow the click,
      //     then opens back up to preserve sustain and tone.
      if (smooth > 0.01) {
        const absMax = Math.max(Math.abs(wetL), Math.abs(wetR));
        const sCoef = absMax > this.smoothEnv ? (1 - this.smoothAtk) : (1 - this.smoothRel);
        this.smoothEnv += sCoef * (absMax - this.smoothEnv);

        // Map envelope to cutoff: high envelope → low cutoff (kills click)
        // Range: 18kHz (open/sustain) down to 1.2kHz (transient spike)
        const envNorm = Math.min(1, this.smoothEnv * 4);  // normalize envelope 0-1
        const cutoff = 18000 - envNorm * smooth * 16800;  // 18k → 1.2k at max smooth + max transient
        const sLpCoef = Math.exp(-2 * Math.PI * cutoff / this.sr);

        this.smoothLpL = sLpCoef * this.smoothLpL + (1 - sLpCoef) * wetL;
        this.smoothLpR = sLpCoef * this.smoothLpR + (1 - sLpCoef) * wetR;

        // Blend: at smooth=1, fully filtered; at smooth=0.5, half
        wetL = wetL * (1 - smooth) + this.smoothLpL * smooth;
        wetR = wetR * (1 - smooth) + this.smoothLpR * smooth;
      }

      // ── 10. Output trim ───────────────────────────────────────────────
      wetL *= levelLin;
      wetR *= levelLin;

      // ── 10. Parallel mix ──────────────────────────────────────────────
      const outL = dryL * (1 - mix) + wetL * mix;
      const outR = dryR * (1 - mix) + wetR * mix;

      // ── 11. Output ────────────────────────────────────────────────────
      if (bypass) {
        oL[n] = dryL;
        oR[n] = dryR;
      } else {
        oL[n] = outL;
        oR[n] = outR;
      }

      const ap = Math.max(Math.abs(outL), Math.abs(outR));
      if (ap > peakAccum) peakAccum = ap;
    }

    this._peakOut = peakAccum;
    this.port.postMessage({ peak: this._peakOut });

    return true;
  }
}

registerProcessor('shagatron-processor-${PROCESSOR_VERSION}', ShagatronProcessor);
`;

export async function createShagatronEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, `shagatron-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  // Transformer bandwidth — tame the top end so drive doesn't fizz
  const txLP = audioCtx.createBiquadFilter();
  txLP.type = 'lowpass';
  txLP.frequency.value = 14000;
  txLP.Q.value = 0.707;

  const analyserIn  = audioCtx.createAnalyser(); analyserIn.fftSize  = 2048;
  const analyserOut = audioCtx.createAnalyser(); analyserOut.fftSize = 2048;

  input.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(txLP);
  txLP.connect(analyserOut);
  analyserOut.connect(output);
  analyserOut.connect(chainOutput);

  let _peak = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
  };

  const _buf = new Float32Array(2048);

  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0;
    for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) {
      const a = Math.abs(_buf[i]); if (a > m) m = a;
    }
    return m;
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,

    setShag:    v => { p('shag').value    = v; },
    setLevel:   v => { p('level').value   = v; },
    setWeight:  v => { p('weight').value  = v; },
    setBite:    v => { p('bite').value    = v; },
    setTight:   v => { p('tight').value   = v; },
    setHair:    v => { p('hair').value    = v; },
    setAir:     v => { p('air').value     = v; },
    setSmooth:  v => { p('smooth').value  = v; },
    setMix:     v => { p('mix').value     = v; },
    setMode:    v => { p('mode').value    = v; },  // 0=Smooth, 1=Thick, 2=Angry
    setBypass:  v => { p('bypass').value  = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:  () => getRms(analyserIn),
    getOutputLevel: () => getRms(analyserOut),
    getPeakOutput:  () => _peak,

    destroy() {
      worklet.disconnect();
      txLP.disconnect();
      input.disconnect();
      output.disconnect();
      chainOutput.disconnect();
      analyserIn.disconnect();
      analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
