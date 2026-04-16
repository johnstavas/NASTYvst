// analogGlueEngine.js — SSL G-Bus style glue compressor  v4
//
// DSP features:
//   • RMS-leaning detector (20% peak / 80% fast RMS) — smooth, "gluey"
//     behavior, avoids the twitchy grab of pure peak detection
//   • Stereo link modes: Dual Mono / Average / Max (per-channel env state)
//   • Dual parallel release: fast + slow stages blended by crest factor
//     — high crest (drums/transients) → more fast release, no pumping
//     — low crest (pads/bass)        → more slow release, smooth tail
//   • Sidechain HP only: 30/60/90/120/150 Hz — tames low-end pumping
//   • Optional FIR lookahead (128 samps): Hann-windowed GR smoothing,
//     zero artefacts at zero attack, ~2.9ms compensated latency
//   • Soft-knee feed-forward VCA
//   • Input analog saturation (transformer-style tanh + HP 20Hz coupling)
//   • Drive knob couples slightly with GR depth — "breathes harder when
//     working harder" — matches hardware glue comp behavior
//   • Subtle output soft-clip stage (engages only on hot signal)

const PROCESSOR_VERSION = 'v4';

const PROCESSOR_CODE = `
class AnalogGlueProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold',  defaultValue: -12,  minValue: -60,  maxValue: 0    },
      { name: 'ratio',      defaultValue: 2,    minValue: 1,    maxValue: 10   },
      { name: 'knee',       defaultValue: 6,    minValue: 0,    maxValue: 24   },
      { name: 'attackMs',   defaultValue: 10,   minValue: 0,    maxValue: 300  },
      { name: 'releaseMs',  defaultValue: 200,  minValue: 10,   maxValue: 3000 },
      { name: 'makeup',     defaultValue: 0,    minValue: -12,  maxValue: 24   },
      { name: 'mix',        defaultValue: 1,    minValue: 0,    maxValue: 1    },
      { name: 'inputGain',  defaultValue: 1,    minValue: 0,    maxValue: 4    },
      { name: 'outputGain', defaultValue: 1,    minValue: 0,    maxValue: 4    },
      { name: 'drive',      defaultValue: 0.3,  minValue: 0,    maxValue: 1    },
      { name: 'bypass',     defaultValue: 0,    minValue: 0,    maxValue: 1    },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Per-channel dual parallel release envelopes ─────────────────────────
    this.envSlowL = 1.0; this.envFastL = 1.0;
    this.envSlowR = 1.0; this.envFastR = 1.0;

    // ── Detector envelopes — 20% peak + 80% fast RMS ────────────────────────
    // Fast RMS window ~15ms, fast peak decay ~5ms.
    this.detRmsAccL = 0; this.detRmsAccR = 0;
    this.detPeakL   = 0; this.detPeakR   = 0;
    this.detRmsTau   = Math.exp(-1 / (this.sr * 0.015));
    this.detPeakDecay = Math.exp(-1 / (this.sr * 0.005));

    // ── Crest factor (for release blend) ────────────────────────────────────
    this.peak    = 0;
    this.rmsAcc  = 0;
    this.crest   = 1;
    this.rmsTau  = Math.exp(-1 / (this.sr * 0.1));   // 100ms RMS window
    this.crTau   = Math.exp(-1 / (this.sr * 0.3));   // 300ms crest smoother

    // ── Sidechain HP filter state ────────────────────────────────────────────
    // scFilter: 0=off  1=HP30  2=HP60  3=HP90  4=HP120  5=HP150
    this.scFilter = 0;
    this.scHpL = 0; this.scHpR = 0;
    this.scXpL = 0; this.scXpR = 0;

    // ── Stereo link mode ────────────────────────────────────────────────────
    // 0 = Dual Mono, 1 = Average (default), 2 = Max
    this.linkMode = 1;

    // ── FIR lookahead ────────────────────────────────────────────────────────
    // DELAY = 128 samples (~2.9ms @ 44100)
    const DELAY = 128;
    const BUFLEN = 256;  // >= DELAY*2, power of 2 for fast masking
    this.DELAY  = DELAY;
    this.BUFLEN = BUFLEN;
    this.MASK   = BUFLEN - 1;

    this.delayL  = new Float32Array(BUFLEN);
    this.delayR  = new Float32Array(BUFLEN);
    this.grRingL = new Float32Array(BUFLEN);
    this.grRingR = new Float32Array(BUFLEN);
    this.writePos = 0;

    // 32-tap Hann window for GR smoothing, normalised
    const WIN = 32;
    this.WIN = WIN;
    this.hannWin = new Float32Array(WIN);
    let wsum = 0;
    for (let k = 0; k < WIN; k++) {
      this.hannWin[k] = 0.5 * (1 - Math.cos(2 * Math.PI * k / (WIN - 1)));
      wsum += this.hannWin[k];
    }
    for (let k = 0; k < WIN; k++) this.hannWin[k] /= wsum;

    this.lookahead = false;

    // ── Analog saturation state ──────────────────────────────────────────────
    this.satHpL = 0; this.satHpR = 0;
    this.hpTc = Math.exp(-2 * Math.PI * 20 / this.sr);

    // ── GR metering + drive-coupling feedback ───────────────────────────────
    this._grSmooth = 1.0;
    this._lastGrDb = 0;

    // ── Message handler ─────────────────────────────────────────────────────
    this.port.onmessage = (e) => {
      if (e.data?.scFilter !== undefined) this.scFilter = e.data.scFilter;
      if (e.data?.linkMode !== undefined) this.linkMode = e.data.linkMode;
      if (e.data?.lookahead !== undefined) {
        this.lookahead = e.data.lookahead;
        this.port.postMessage({ latencySamples: this.lookahead ? this.DELAY : 0 });
      }
    };

    // Report initial latency
    this.port.postMessage({ latencySamples: 0 });
  }

  // ── Soft-knee gain computer (dB domain) ──────────────────────────────────
  gcDb(xDb, threshDb, ratio, kneeDb) {
    const half = kneeDb * 0.5;
    const over = xDb - threshDb;
    if (kneeDb > 0 && over > -half && over < half) {
      return (1/ratio - 1) * (over + half) * (over + half) / (2 * kneeDb);
    }
    if (over <= -half) return 0;
    return (1/ratio - 1) * over;
  }

  process(inputs, outputs, params) {
    const inBufs  = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const thresh    = params.threshold[0];
    const ratio     = params.ratio[0];
    const knee      = params.knee[0];
    const attackMs  = params.attackMs[0];
    const relMs     = params.releaseMs[0];
    const makeup    = params.makeup[0];
    const mix       = params.mix[0];
    const inGain    = params.inputGain[0];
    const outGain   = params.outputGain[0];
    const baseDrive = params.drive[0];
    const bypass    = params.bypass[0];

    // Drive couples with recent GR depth — capped so heavy compression
    // gets slightly more density without running away into distortion.
    // grDepth goes 0..1 as GR crosses 0..-6 dB.
    const grDepth = Math.min(1, Math.max(0, (-this._lastGrDb) / 6));
    const drive   = Math.min(1, baseDrive + 0.15 * grDepth);

    // Attack: true zero at 0ms, otherwise exponential
    const atkTc     = attackMs < 0.0001 ? 0 : Math.exp(-1 / (this.sr * attackMs * 0.001));
    // Dual release TCs
    const relTcSlow = Math.exp(-1 / (this.sr * relMs * 0.001));
    const relTcFast = Math.exp(-1 / (this.sr * Math.max(10, relMs * 0.1) * 0.001));
    const makeupLin = Math.pow(10, makeup / 20);

    // Sidechain HP coefficient
    const scHpFreqs = [0, 30, 60, 90, 120, 150];
    const scHpFreq  = scHpFreqs[this.scFilter] || 0;
    const scHpTc    = scHpFreq > 0 ? Math.exp(-2 * Math.PI * scHpFreq / this.sr) : 0;

    let grAccum = 0;
    const MASK  = this.MASK;
    const DELAY = this.DELAY;
    const WIN   = this.WIN;
    const linkMode = this.linkMode;
    const detRmsTau = this.detRmsTau;
    const detPeakDecay = this.detPeakDecay;

    for (let n = 0; n < iL.length; n++) {
      // ── Input gain ──────────────────────────────────────────────────────
      let sL = iL[n] * inGain;
      let sR = iR[n] * inGain;

      // ── Analog input saturation (transformer) ───────────────────────────
      if (drive > 0.001) {
        const driveAmt = 1 + drive * 2.5;
        const satL = Math.tanh(sL * driveAmt) / driveAmt;
        const satR = Math.tanh(sR * driveAmt) / driveAmt;
        // HP 20Hz transformer coupling
        const hpOutL = this.hpTc * (this.satHpL + satL - sL);
        const hpOutR = this.hpTc * (this.satHpR + satR - sR);
        this.satHpL = hpOutL;
        this.satHpR = hpOutR;
        sL = satL * (1 - drive * 0.12) + hpOutL * drive * 0.12;
        sR = satR * (1 - drive * 0.12) + hpOutR * drive * 0.12;
      }

      // ── Sidechain HP (detector path only) ───────────────────────────────
      let dL = sL, dR = sR;
      if (scHpTc > 0) {
        const yL = scHpTc * (this.scHpL + dL - this.scXpL);
        const yR = scHpTc * (this.scHpR + dR - this.scXpR);
        this.scXpL = dL; this.scXpR = dR;
        this.scHpL = yL; this.scHpR = yR;
        dL = yL; dR = yR;
      }

      // ── RMS-leaning detector + stereo link ──────────────────────────────
      const aL = Math.abs(dL);
      const aR = Math.abs(dR);

      let levelL_lin, levelR_lin;
      if (linkMode === 0) {
        // Dual Mono — each channel detects independently
        this.detPeakL = Math.max(aL, this.detPeakL * detPeakDecay);
        this.detPeakR = Math.max(aR, this.detPeakR * detPeakDecay);
        this.detRmsAccL = detRmsTau * this.detRmsAccL + (1 - detRmsTau) * aL * aL;
        this.detRmsAccR = detRmsTau * this.detRmsAccR + (1 - detRmsTau) * aR * aR;
        const rmsL = Math.sqrt(Math.max(0, this.detRmsAccL));
        const rmsR = Math.sqrt(Math.max(0, this.detRmsAccR));
        levelL_lin = 0.2 * this.detPeakL + 0.8 * rmsL;
        levelR_lin = 0.2 * this.detPeakR + 0.8 * rmsR;
      } else {
        // Average (default) or Max link — both channels share one detector
        const linked = linkMode === 2 ? Math.max(aL, aR) : 0.5 * (aL + aR);
        this.detPeakL = Math.max(linked, this.detPeakL * detPeakDecay);
        this.detRmsAccL = detRmsTau * this.detRmsAccL + (1 - detRmsTau) * linked * linked;
        const rmsLvl = Math.sqrt(Math.max(0, this.detRmsAccL));
        const lvl = 0.2 * this.detPeakL + 0.8 * rmsLvl;
        levelL_lin = lvl;
        levelR_lin = lvl;
      }

      // ── Crest factor (uses max abs for release blend) ───────────────────
      const absD = Math.max(aL, aR);
      this.peak  = Math.max(absD, this.peak * 0.99985);
      this.rmsAcc = this.rmsTau * this.rmsAcc + (1 - this.rmsTau) * absD * absD;
      const rms = Math.sqrt(Math.max(0, this.rmsAcc));
      const rawCrest = rms > 1e-9 ? Math.min(5, this.peak / rms) : 1;
      this.crest = this.crTau * this.crest + (1 - this.crTau) * rawCrest;

      // ── Gain computer (per channel) ─────────────────────────────────────
      const levelDbL = levelL_lin > 1e-10 ? 20 * Math.log10(levelL_lin) : -200;
      const levelDbR = levelR_lin > 1e-10 ? 20 * Math.log10(levelR_lin) : -200;
      const tgtL = Math.pow(10, this.gcDb(levelDbL, thresh, ratio, knee) / 20);
      const tgtR = Math.pow(10, this.gcDb(levelDbR, thresh, ratio, knee) / 20);

      // ── Branching detector with dual parallel release — L ───────────────
      if (tgtL <= this.envSlowL) {
        if (atkTc === 0) {
          this.envSlowL = tgtL;
          this.envFastL = tgtL;
        } else {
          this.envSlowL = atkTc * this.envSlowL + (1 - atkTc) * tgtL;
          this.envFastL = atkTc * this.envFastL + (1 - atkTc) * tgtL;
        }
      } else {
        this.envSlowL = relTcSlow * this.envSlowL + (1 - relTcSlow) * tgtL;
        this.envFastL = relTcFast * this.envFastL + (1 - relTcFast) * tgtL;
      }
      // ── Branching detector with dual parallel release — R ───────────────
      if (tgtR <= this.envSlowR) {
        if (atkTc === 0) {
          this.envSlowR = tgtR;
          this.envFastR = tgtR;
        } else {
          this.envSlowR = atkTc * this.envSlowR + (1 - atkTc) * tgtR;
          this.envFastR = atkTc * this.envFastR + (1 - atkTc) * tgtR;
        }
      } else {
        this.envSlowR = relTcSlow * this.envSlowR + (1 - relTcSlow) * tgtR;
        this.envFastR = relTcFast * this.envFastR + (1 - relTcFast) * tgtR;
      }

      // Blend slow/fast by crest factor:
      //   crest=1 (pure tone) → 0% fast (all slow, smooth tail)
      //   crest=3+ (drums)    → 100% fast (snap back, no pumping)
      const blend = Math.min(1, Math.max(0, (this.crest - 1.0) / 2.0));
      const envBlendL = this.envSlowL + blend * (this.envFastL - this.envSlowL);
      const envBlendR = this.envSlowR + blend * (this.envFastR - this.envSlowR);
      const rawGrL = Math.min(1, envBlendL);
      const rawGrR = Math.min(1, envBlendR);

      // ── Bypass ──────────────────────────────────────────────────────────
      if (bypass > 0.5) {
        oL[n] = iL[n];
        oR[n] = iR[n];
        grAccum += 1.0;
        continue;
      }

      if (this.lookahead) {
        // ── Lookahead path ───────────────────────────────────────────────
        const wp = this.writePos & MASK;

        this.delayL[wp]  = sL;
        this.delayR[wp]  = sR;
        this.grRingL[wp] = rawGrL;
        this.grRingR[wp] = rawGrR;

        // Read delayed audio (both dry and wet share this source so
        // parallel mix stays phase-aligned — no comb filter)
        const rp = (this.writePos - DELAY + 2048) & MASK;
        const delL = this.delayL[rp];
        const delR = this.delayR[rp];

        // Hann-windowed GR smooth over WIN taps
        let smoothGrL = 0, smoothGrR = 0;
        for (let k = 0; k < WIN; k++) {
          const ri = (this.writePos - k + 2048) & MASK;
          smoothGrL += this.hannWin[k] * this.grRingL[ri];
          smoothGrR += this.hannWin[k] * this.grRingR[ri];
        }

        this.writePos++;
        const wetGainL = smoothGrL * makeupLin * outGain;
        const wetGainR = smoothGrR * makeupLin * outGain;
        grAccum += 0.5 * (smoothGrL + smoothGrR);

        let mixedL = delL * outGain * (1 - mix) + delL * wetGainL * mix;
        let mixedR = delR * outGain * (1 - mix) + delR * wetGainR * mix;

        // Subtle output soft-clip (transparent below ~0.7, gentle above)
        oL[n] = Math.tanh(mixedL * 0.5) / 0.5;
        oR[n] = Math.tanh(mixedR * 0.5) / 0.5;

      } else {
        // ── Zero-latency path ────────────────────────────────────────────
        grAccum += 0.5 * (rawGrL + rawGrR);
        const wetGainL = rawGrL * makeupLin * outGain;
        const wetGainR = rawGrR * makeupLin * outGain;

        let mixedL = sL * outGain * (1 - mix) + sL * wetGainL * mix;
        let mixedR = sR * outGain * (1 - mix) + sR * wetGainR * mix;

        oL[n] = Math.tanh(mixedL * 0.5) / 0.5;
        oR[n] = Math.tanh(mixedR * 0.5) / 0.5;
      }
    }

    // GR metering: average linear GR → dB
    const avgGrLin = grAccum / iL.length;
    this._grSmooth = 0.88 * this._grSmooth + 0.12 * avgGrLin;
    const grDb = this._grSmooth > 1e-10 ? 20 * Math.log10(this._grSmooth) : 0;
    this._lastGrDb = grDb;
    this.port.postMessage({ gr: grDb });

    return true;
  }
}

registerProcessor('analog-glue-processor-${PROCESSOR_VERSION}', AnalogGlueProcessor);
`;

export async function createAnalogGlueEngine(audioCtx) {
  const blob = new Blob([PROCESSOR_CODE], { type: 'application/javascript' });
  const url  = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  const input       = audioCtx.createGain();
  const output      = audioCtx.createGain();
  const chainOutput = audioCtx.createGain();

  const worklet = new AudioWorkletNode(audioCtx, `analog-glue-processor-${PROCESSOR_VERSION}`, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
  });

  // Analysers for metering
  const analyserIn = audioCtx.createAnalyser();
  analyserIn.fftSize = 4096;
  analyserIn.smoothingTimeConstant = 0.0;

  const analyserOut = audioCtx.createAnalyser();
  analyserOut.fftSize = 4096;
  analyserOut.smoothingTimeConstant = 0.0;

  // Signal chain — input taps analyserIn, then through worklet, taps analyserOut,
  // then fans out to BOTH `output` (to master when last in chain) and
  // `chainOutput` (to next module when mid-chain). Matches TapeDelayEngine.
  input.connect(analyserIn);
  analyserIn.connect(worklet);
  worklet.connect(analyserOut);
  analyserOut.connect(output);
  analyserOut.connect(chainOutput);

  // Messages from worklet (GR + latency)
  let _grDb = 0;
  let _latencySamples = 0;
  worklet.port.onmessage = e => {
    if (e.data?.gr           !== undefined) _grDb           = e.data.gr;
    if (e.data?.latencySamples !== undefined) _latencySamples = e.data.latencySamples;
  };

  // Metering
  const _buf = new Float32Array(4096);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0;
    for (let i = 0; i < _buf.length; i++) { const a = Math.abs(_buf[i]); if (a > m) m = a; }
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

    setThreshold:  v => { p('threshold').value  = v; },
    setRatio:      v => { p('ratio').value       = v; },
    setKnee:       v => { p('knee').value        = v; },
    setAttack:     v => { p('attackMs').value    = v; },
    setRelease:    v => { p('releaseMs').value   = v; },
    setMakeup:     v => { p('makeup').value      = v; },
    setMix:        v => { p('mix').value         = v; },
    setInputGain:  v => { p('inputGain').value   = v; },
    setOutputGain: v => { p('outputGain').value  = v; },
    setDrive:      v => { p('drive').value       = v; },
    setBypass:     v => { p('bypass').value      = v ? 1 : 0; },
    setSidechainFilter: v => { worklet.port.postMessage({ scFilter: v }); },
    setStereoLink: v => { worklet.port.postMessage({ linkMode: v }); },
    setLookahead:  v => {
      // Update latency readout immediately on the main thread so the UI
      // reflects the toggle without waiting for a worklet round-trip.
      _latencySamples = v ? 128 : 0;
      worklet.port.postMessage({ lookahead: v });
    },

    getInputPeak:     () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak:    () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel:    () => getRms(analyserIn),
    getOutputLevel:   () => getRms(analyserOut),
    getGainReduction: () => _grDb,
    getLatency:       () => _latencySamples,

    destroy() {
      worklet.disconnect();
      input.disconnect();
      output.disconnect();
      chainOutput.disconnect();
      analyserIn.disconnect();
      analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
