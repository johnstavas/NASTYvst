// la2aEngine.js — Teletronix LA-2A style optical leveling amplifier
//
// Faithful T4-cell opto compressor with program-dependent release.
//
// Signal flow:
//   Audio:     input → tube input stage → GR apply → tube output → makeup → out
//   Sidechain: input × peak-reduction → [HF emphasis] → detector
//              → dual envelopes (fast + slow) → soft-knee gain computer
//              → smoothed GR → feeds back to audio path
//
// Core T4 behavior (the reason this compressor sounds the way it does):
//   • ~10 ms attack — never truly fast. Transients always kiss through.
//   • DUAL RELEASE — a fast stage (~60 ms) and a slow stage (1.5 s) run in
//     parallel. We BLEND them by the current GR depth:
//        light GR  → fast release    (breathes, stays out of the way)
//        heavy GR  → slow release    (hangs, that famous "leveling" feel)
//     This IS the program-dependent character of the real T4 cell.
//   • Soft 8 dB knee — no audible threshold transition.
//   • Compress = 3:1, Limit = 10:1 with a slightly harder knee.
//   • Subtle tube saturation on input AND output, input drive couples a
//     little with GR depth so the plugin "warms up" as it works harder.

const PROCESSOR_VERSION = 'v8';

const PROCESSOR_CODE = `
class LA2AProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'peakReduction', defaultValue: 0.5, minValue: 0, maxValue: 1 },
      { name: 'gainDb',        defaultValue: 0,   minValue: 0, maxValue: 40 },
      { name: 'mode',          defaultValue: 0,   minValue: 0, maxValue: 1 },  // 0=Compress, 1=Limit
      { name: 'hfEmphasis',    defaultValue: 0,   minValue: 0, maxValue: 1 },  // R37 mod — HF sidechain emphasis
      { name: 'bypass',        defaultValue: 0,   minValue: 0, maxValue: 1 },
      { name: 'juice',         defaultValue: 0,   minValue: 0, maxValue: 1 },  // LF harmonic sweetener
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Detector (post-input-stage rectified + attack-smoothed) ──────────
    this.detL = 0; this.detR = 0;

    // ── Dual envelopes: fast + slow, per channel ──────────────────────────
    //    fast ≈ 60 ms release — breathes on light GR
    //    slow ≈ 1.5 s release — hangs on heavy GR
    this.fastL = 0; this.fastR = 0;
    this.slowL = 0; this.slowR = 0;

    // ── Time constants (recomputed below if SR changes are relevant) ─────
    // Attack ~10 ms — slow enough to let transients through, the defining
    // "can't grab a snare hit" feel of an opto.
    const attackMs   = 10;
    const fastRelMs  = 60;
    const slowRelMs  = 1500;
    this.atkCoef     = Math.exp(-1 / (this.sr * attackMs * 0.001));
    this.fastRelCoef = Math.exp(-1 / (this.sr * fastRelMs * 0.001));
    this.slowRelCoef = Math.exp(-1 / (this.sr * slowRelMs * 0.001));

    // ── Smoothed output GR (for zipper-free gain application) ────────────
    this.grSmooth = 0;  // in dB, always ≤ 0
    this.grSmoothCoef = Math.exp(-1 / (this.sr * 0.005));  // 5 ms

    // ── HF emphasis sidechain filter (one-pole HP @ 1 kHz) ───────────────
    // Real LA-2A "R37 mod": gives the detector a bit more snap on cymbals
    // and sibilance without actually EQing the audio path.
    this.hfStateL = 0; this.hfStateR = 0;
    this.hfPrevL  = 0; this.hfPrevR  = 0;
    this.hfCoef   = Math.exp(-2 * Math.PI * 1000 / this.sr);

    // ── Juice — LF harmonic sweetener ───────────────────────────────────
    // One-pole LP at ~280 Hz isolates bass + low-mid content, runs it
    // through an asymmetric shaper (H2 + H3), mixes harmonics back in.
    this.juiceLpL = 0; this.juiceLpR = 0;
    this.juiceLpCoef = Math.exp(-2 * Math.PI * 280 / this.sr);

    // ── R37 audio-path presence lift ─────────────────────────────────────
    // One-pole LP used to build a simple HF shelf on the audio path.
    // Adds ~2 dB of air at 8 kHz+ so R37 is felt, not just measured.
    this.r37LpL = 0; this.r37LpR = 0;
    this.r37LpCoef = Math.exp(-2 * Math.PI * 8000 / this.sr);

    // ── Meter feedback ────────────────────────────────────────────────────
    this._lastGrDb = 0;

    this.port.postMessage({ ready: true });
  }

  // Soft tube input stage — tanh with unity gain at small signal.
  // drive > 1 curves the response above ~-10 dBFS; below that it's nearly
  // linear. This is the "character" — NOT a clipper.
  tubeStage(x, drive) {
    // tanh(x * drive) / tanh(drive) preserves peak level but curves the
    // waveshape. We use the series limit for tanh(drive) to keep the
    // denominator stable at low drive.
    const td = Math.tanh(drive);
    return Math.tanh(x * drive) / (td < 1e-6 ? 1 : td);
  }

  // Soft-knee gain reduction in dB.
  //   below (thresh - knee/2)  → 0 dB (no GR)
  //   above (thresh + knee/2)  → linear ratio region
  //   in knee                  → quadratic interpolation
  computeGrDb(xDb, threshDb, ratio, kneeDb) {
    const halfK = kneeDb * 0.5;
    const over = xDb - threshDb;
    if (over <= -halfK) return 0;
    if (over >=  halfK) return over * (1 - 1/ratio);
    // Quadratic soft knee — matches classic Zolzer textbook curve
    const t = (over + halfK);
    return (1 - 1/ratio) * (t * t) / (2 * kneeDb);
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const pr        = params.peakReduction[0];
    const gainDb    = params.gainDb[0];
    const mode      = params.mode[0] > 0.5 ? 1 : 0;
    const hfMix     = params.hfEmphasis[0];
    const bypass    = params.bypass[0] > 0.5;
    const juice     = params.juice[0] > 0.5;

    // Peak Reduction knob → detector-path drive. Smoothly curved so the
    // knob feels musical end-to-end (exponential mapping: 0 → 1×, 1 → ~32×).
    //   At pr=0 the signal barely crosses threshold → gentle, occasional GR.
    //   At pr=1 the signal hits the iron hard → constant leveling, ~-10 dB GR.
    const peakReductionGain = Math.pow(10, pr * 30 / 20);  // 0..30 dB of drive

    // Mode: Compress = 3:1 / 8 dB knee,  Limit = 10:1 / 6 dB knee.
    const ratio    = mode === 0 ? 3  : 10;
    const kneeDb   = mode === 0 ? 8  : 6;
    // Threshold is fixed. The Peak Reduction knob drives the signal INTO
    // this threshold — classic LA-2A topology, one knob does the work.
    const threshDb = -22;

    // Input tube drive — couples with recent GR depth for the "warms up as
    // it works harder" character. Base drive 0.3 (very mild — an opto comp
    // should be smooth and transparent), adds up to 0.3 when sitting at
    // -10 dB GR. The warmth comes from the subtle asymmetry in tanh, not
    // from slamming the shaper.
    const grDepth = Math.min(1, Math.max(0, -this._lastGrDb / 10));
    const tubeDrive = 0.3 + 0.3 * grDepth;

    // Output tube — very subtle constant so program material stays
    // transparent until you push the makeup gain.
    const outTubeDrive = 0.15;

    const makeupLin = Math.pow(10, gainDb / 20);

    const atkC  = this.atkCoef;
    const fastC = this.fastRelCoef;
    const slowC = this.slowRelCoef;
    const grSC  = this.grSmoothCoef;
    const hfC   = this.hfCoef;

    let grAccum = 0;

    for (let n = 0; n < iL.length; n++) {
      const xL = iL[n];
      const xR = iR[n];

      // ── 1. Input tube stage (audio path — NOT boosted by Peak Reduction)
      //     The audio path stays at unity. Subtle tube warmth from the
      //     input stage, but no Peak Reduction drive here.
      const tubL = this.tubeStage(xL, tubeDrive);
      const tubR = this.tubeStage(xR, tubeDrive);

      // ── 2. Sidechain: Peak Reduction drives the DETECTOR only ──────────
      //     On a real LA-2A the Peak Reduction knob controls how much
      //     signal hits the T4 opto cell. The audio path is untouched.
      let scL = xL * peakReductionGain;
      let scR = xR * peakReductionGain;

      // ── 3. Optional HF emphasis on sidechain ──────────────────────────
      if (hfMix > 0.001) {
        // One-pole HP: y = a * (y_prev + x - x_prev)
        const hpL = hfC * (this.hfStateL + scL - this.hfPrevL);
        const hpR = hfC * (this.hfStateR + scR - this.hfPrevR);
        this.hfStateL = hpL; this.hfPrevL = scL;
        this.hfStateR = hpR; this.hfPrevR = scR;
        scL += hpL * hfMix * 1.5;
        scR += hpR * hfMix * 1.5;
      }

      // ── 4. Detector — rectify + attack smooth (opto rise) ──────────────
      const rectL = Math.abs(scL);
      const rectR = Math.abs(scR);
      // Use max of L/R for linked stereo GR (LA-2A is mono; for stereo we
      // link both detectors so the image doesn't wander under compression)
      const rect = Math.max(rectL, rectR);
      // Attack smoothing — one-pole towards the rectified level.
      //   When signal rises (rect > det) → move towards it at the attack TC
      //   When signal falls (rect < det) → let it decay very fast so the
      //     next attack starts from the right place (this is NOT release —
      //     release happens on the envelopes below, not on the detector)
      if (rect > this.detL) {
        this.detL = atkC * this.detL + (1 - atkC) * rect;
      } else {
        this.detL = rect + (this.detL - rect) * 0.9995;
      }
      const det = this.detL;

      // ── 5. Dual envelopes (fast + slow) ────────────────────────────────
      //     Attack shared. Release split.
      if (det > this.fastL) {
        this.fastL = atkC * this.fastL + (1 - atkC) * det;
      } else {
        this.fastL = fastC * this.fastL + (1 - fastC) * det;
      }
      if (det > this.slowL) {
        this.slowL = atkC * this.slowL + (1 - atkC) * det;
      } else {
        this.slowL = slowC * this.slowL + (1 - slowC) * det;
      }

      // ── 6. Program-dependent blend ─────────────────────────────────────
      //     Weight slow envelope by recent GR depth (0 → 1 over 10 dB).
      //     Light GR → fast release dominates → natural breathing.
      //     Heavy GR → slow release dominates → sustained hang.
      const blendW = Math.min(1, Math.max(0, -this._lastGrDb / 10));
      const env = blendW * this.slowL + (1 - blendW) * this.fastL;

      // ── 7. Compression curve (dB domain, soft knee) ────────────────────
      const envDb = env > 1e-9 ? 20 * Math.log10(env) : -200;
      const grDb  = -this.computeGrDb(envDb, threshDb, ratio, kneeDb);

      // ── 8. Smooth GR to kill zipper noise ──────────────────────────────
      //     grSmooth is in dB (≤0). One-pole towards the new target.
      this.grSmooth = grSC * this.grSmooth + (1 - grSC) * grDb;
      const gainLin = Math.pow(10, this.grSmooth / 20);

      grAccum += -this.grSmooth;

      // ── 9. Apply gain to the TUBE-processed signal ─────────────────────
      let yL = tubL * gainLin;
      let yR = tubR * gainLin;

      // ── 10. Juice — LF harmonic sweetener ──────────────────────────────
      //     Two parts: (a) direct bass lift for immediate low-end weight,
      //     (b) pre-driven polynomial shaper for H2+H3 harmonic color.
      //     Pre-drive (×6) is critical — raw signal levels after compression
      //     are ~0.1–0.3, and x² of 0.1 is 0.01 (inaudible). We need to
      //     boost into the shaper, generate harmonics, then soft-limit.
      if (juice) {
        this.juiceLpL = this.juiceLpCoef * this.juiceLpL + (1 - this.juiceLpCoef) * yL;
        this.juiceLpR = this.juiceLpCoef * this.juiceLpR + (1 - this.juiceLpCoef) * yR;
        const bL = this.juiceLpL;
        const bR = this.juiceLpR;
        // (a) Direct bass lift — +2.5 dB of low-end weight
        yL += bL * 0.35;
        yR += bR * 0.35;
        // (b) Pre-drive into shaper for audible harmonics
        const dL = bL * 6, dR = bR * 6;
        const h2L = 0.5 * dL * Math.abs(dL);  // H2 — warm even harmonic
        const h2R = 0.5 * dR * Math.abs(dR);
        const h3L = 0.15 * dL * dL * dL;       // H3 — body/fullness
        const h3R = 0.15 * dR * dR * dR;
        // Soft-limit so it doesn't blow up on hot material, then mix
        yL += Math.tanh((h2L + h3L) * 0.5) * 0.15;
        yR += Math.tanh((h2R + h3R) * 0.5) * 0.15;
      }

      // ── 11. R37 audio-path presence lift ───────────────────────────────
      //     On top of the sidechain emphasis, add a gentle HF shelf to the
      //     audio so R37 is felt as "air", not just changed compression.
      //     Extract HF by subtracting LP from signal, mix in ~2 dB worth.
      if (hfMix > 0.001) {
        this.r37LpL = this.r37LpCoef * this.r37LpL + (1 - this.r37LpCoef) * yL;
        this.r37LpR = this.r37LpCoef * this.r37LpR + (1 - this.r37LpCoef) * yR;
        const hfL = yL - this.r37LpL;
        const hfR = yR - this.r37LpR;
        // +2 dB shelf ≈ 0.26× the HF content added back on top
        yL += hfL * 0.26 * hfMix;
        yR += hfR * 0.26 * hfMix;
      }

      // ── 12. Output tube stage — very subtle ────────────────────────────
      yL = this.tubeStage(yL, outTubeDrive);
      yR = this.tubeStage(yR, outTubeDrive);

      // ── 13. Makeup gain ─────────────────────────────────────────────────
      yL *= makeupLin;
      yR *= makeupLin;

      // ── 14. Bypass / output ────────────────────────────────────────────
      if (bypass) {
        oL[n] = xL;
        oR[n] = xR;
      } else {
        oL[n] = yL;
        oR[n] = yR;
      }
    }

    // GR metering: average smoothed GR (positive dB of reduction)
    const avgGrPositive = grAccum / iL.length;
    this._lastGrDb = -avgGrPositive;
    this.port.postMessage({ gr: this._lastGrDb });

    return true;
  }
}

registerProcessor('la2a-processor-${PROCESSOR_VERSION}', LA2AProcessor);
`;

export async function createLA2AEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, `la2a-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  const analyserIn = audioCtx.createAnalyser();
  analyserIn.fftSize = 4096;
  analyserIn.smoothingTimeConstant = 0.0;

  const analyserOut = audioCtx.createAnalyser();
  analyserOut.fftSize = 4096;
  analyserOut.smoothingTimeConstant = 0.0;

  // ── Transformer bandwidth filters ──────────────────────────────────────
  // A real LA-2A has input/output transformers that roll off the extremes.
  // Without these, tube-stage harmonics extend to Nyquist → digital harshness.
  // HP at 30 Hz (coupling cap), LP at 15 kHz (output transformer).
  const txHP = audioCtx.createBiquadFilter();
  txHP.type = 'highpass';
  txHP.frequency.value = 30;
  txHP.Q.value = 0.707;

  const txLP = audioCtx.createBiquadFilter();
  txLP.type = 'lowpass';
  txLP.frequency.value = 15000;
  txLP.Q.value = 0.707;

  input.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(txHP);
  txHP.connect(txLP);
  txLP.connect(analyserOut);
  analyserOut.connect(output);
  analyserOut.connect(chainOutput);

  let _grDb = 0;
  worklet.port.onmessage = e => {
    if (e.data?.gr !== undefined) _grDb = e.data.gr;
  };

  const _buf = new Float32Array(4096);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) {
      const a = Math.abs(_buf[i]); if (a > m) m = a;
    }
    return m;
  }
  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0;
    for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }

  const p = name => worklet.parameters.get(name);

  return {
    input, output, chainOutput,

    setPeakReduction: v => { p('peakReduction').value = v; },
    setGain:          v => { p('gainDb').value        = v; },
    setMode:          v => { p('mode').value          = v ? 1 : 0; },  // false=Compress, true=Limit
    setHfEmphasis:    v => { p('hfEmphasis').value    = v; },
    setBypass:        v => { p('bypass').value        = v ? 1 : 0; },
    setJuice:         v => { p('juice').value         = v ? 1 : 0; },

    getInputPeak:     () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:    () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:    () => getRms(analyserIn),
    getOutputLevel:   () => getRms(analyserOut),
    getGainReduction: () => _grDb,

    destroy() {
      worklet.disconnect();
      txHP.disconnect();
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
