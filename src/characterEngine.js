// characterEngine.js — CHARACTER VOCAL BOX: Multi-Style Vocal Character Processor
//
// 6 curated internal chains:
//   0 RADIO VOICE:  Bandpass 300-3.5kHz + mild waveshaper + fast compression
//   1 DREAM POP:    Chorus + allpass reverb tail + gentle saturation
//   2 HYPER POP:    Bright shelf + aggressive compression + stereo widen + pitch micro-shift
//   3 INDIE WARM:   Soft compression + tube saturation + low shelf + plate tail
//   4 AGGRESSIVE RAP: Presence boost 3-5kHz + tight comp + harmonic edge + body 150Hz
//   5 TELEPHONE:    Hard bandpass 500-3kHz + harsh clipping + bit-reduction feel
//
// Controls:
//   STYLE     — mode 0-5 (mapped 0-1, 6 zones)
//   INTENSITY — scales each chain's effect depth (0-1)
//   TONE      — bright/dark shift (0-1)
//   MOTION    — modulation amount (0-1)
//   MIX       — dry/wet (0-1)
//   OUTPUT    — output gain 0-1 mapped -18..+18dB
//   BYPASS

const PROCESSOR_VERSION = 'character-v1';

const PROCESSOR_CODE = `
class CharacterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'style',     defaultValue: 0,    minValue: 0, maxValue: 1 },
      { name: 'intensity', defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'tone',      defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'motion',    defaultValue: 0.3,  minValue: 0, maxValue: 1 },
      { name: 'mix',       defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'output',    defaultValue: 0.5,  minValue: 0, maxValue: 1 },
      { name: 'bypass',    defaultValue: 0,    minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.sr = sampleRate;

    // ── Bandpass filter states (biquad) ──
    this.bp1L = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bp1R = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bp2L = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.bp2R = { x1: 0, x2: 0, y1: 0, y2: 0 };

    // ── Compressor state ──
    this.compEnv = 0;

    // ── Chorus / delay buffer (up to 50ms) ──
    this.maxDelay = Math.ceil(this.sr * 0.05);
    this.delBufL = new Float32Array(this.maxDelay + 4);
    this.delBufR = new Float32Array(this.maxDelay + 4);
    this.writePos = 0;

    // ── Allpass reverb state (4 cascaded allpass filters) ──
    this.ap = [];
    const apSizes = [347, 521, 787, 1123];
    for (let i = 0; i < 4; i++) {
      const sz = apSizes[i];
      this.ap.push({ buf: new Float32Array(sz), pos: 0, size: sz });
    }

    // ── Tone filter state (1-pole LP/HP) ──
    this.toneLpL = 0; this.toneLpR = 0;

    // ── Shelf filter states ──
    this.shelfL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.shelfR = { x1: 0, x2: 0, y1: 0, y2: 0 };

    // ── Low shelf states ──
    this.lshelfL = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.lshelfR = { x1: 0, x2: 0, y1: 0, y2: 0 };

    // ── LFO ──
    this.lfoPhase = 0;

    // ── Haas delay for stereo widening ──
    this.haasMax = Math.ceil(this.sr * 0.002);
    this.haasBuf = new Float32Array(this.haasMax + 2);
    this.haasPos = 0;

    // ── Bit crush state ──
    this.crushHold = 0;
    this.crushCounter = 0;

    // ── Peak metering ──
    this._peak = 0;
    this._mode = 0;

    this.port.postMessage({ ready: true });
  }

  biquad(state, b0, b1, b2, a1, a2, x) {
    const y = b0 * x + b1 * state.x1 + b2 * state.x2 - a1 * state.y1 - a2 * state.y2;
    state.x2 = state.x1; state.x1 = x;
    state.y2 = state.y1; state.y1 = y;
    return y;
  }

  bpfCoeffs(fc, Q) {
    const w0 = 2 * Math.PI * Math.min(fc, this.sr * 0.45) / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha;
    return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: -2 * Math.cos(w0) / a0, a2: (1 - alpha) / a0 };
  }

  highShelfCoeffs(fc, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * Math.min(fc, this.sr * 0.45) / this.sr;
    const cs = Math.cos(w0); const sn = Math.sin(w0);
    const alpha = sn / (2 * 0.707);
    const a0 = (A + 1) - (A - 1) * cs + 2 * Math.sqrt(A) * alpha;
    return {
      b0: (A * ((A + 1) + (A - 1) * cs + 2 * Math.sqrt(A) * alpha)) / a0,
      b1: (-2 * A * ((A - 1) + (A + 1) * cs)) / a0,
      b2: (A * ((A + 1) + (A - 1) * cs - 2 * Math.sqrt(A) * alpha)) / a0,
      a1: (2 * ((A - 1) - (A + 1) * cs)) / a0,
      a2: ((A + 1) - (A - 1) * cs - 2 * Math.sqrt(A) * alpha) / a0,
    };
  }

  lowShelfCoeffs(fc, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * Math.min(fc, this.sr * 0.45) / this.sr;
    const cs = Math.cos(w0); const sn = Math.sin(w0);
    const alpha = sn / (2 * 0.707);
    const a0 = (A + 1) + (A - 1) * cs + 2 * Math.sqrt(A) * alpha;
    return {
      b0: (A * ((A + 1) - (A - 1) * cs + 2 * Math.sqrt(A) * alpha)) / a0,
      b1: (2 * A * ((A - 1) - (A + 1) * cs)) / a0,
      b2: (A * ((A + 1) - (A - 1) * cs - 2 * Math.sqrt(A) * alpha)) / a0,
      a1: (-2 * ((A - 1) + (A + 1) * cs)) / a0,
      a2: ((A + 1) + (A - 1) * cs - 2 * Math.sqrt(A) * alpha) / a0,
    };
  }

  peakEqCoeffs(fc, Q, gainDb) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * Math.min(fc, this.sr * 0.45) / this.sr;
    const alpha = Math.sin(w0) / (2 * Q);
    const a0 = 1 + alpha / A;
    return {
      b0: (1 + alpha * A) / a0,
      b1: (-2 * Math.cos(w0)) / a0,
      b2: (1 - alpha * A) / a0,
      a1: (-2 * Math.cos(w0)) / a0,
      a2: (1 - alpha / A) / a0,
    };
  }

  allpass(ap, x, g) {
    const buf = ap.buf;
    const delayed = buf[ap.pos];
    const y = -g * x + delayed;
    buf[ap.pos] = x + g * y;
    ap.pos = (ap.pos + 1) % ap.size;
    return y;
  }

  hermite(buf, pos, size) {
    let p = pos;
    while (p < 0) p += size;
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

  getMode(v) {
    if (v < 0.167) return 0;
    if (v < 0.333) return 1;
    if (v < 0.500) return 2;
    if (v < 0.667) return 3;
    if (v < 0.833) return 4;
    return 5;
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!inBufs?.length || !inBufs[0] || !outBufs[0]) return true;

    const iL = inBufs[0];
    const iR = inBufs[1] || inBufs[0];
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];

    const mode      = this.getMode(params.style[0]);
    const intensity = params.intensity[0];
    const tone      = params.tone[0];
    const motion    = params.motion[0];
    const mix       = params.mix[0];
    const outRaw    = params.output[0];
    const bypass    = params.bypass[0] > 0.5;
    const outDb     = -18 + outRaw * 36;
    const outGain   = Math.pow(10, outDb / 20);
    const sr        = this.sr;

    this._mode = mode;
    let peakAccum = 0;

    if (bypass || mix < 0.001) {
      for (let n = 0; n < iL.length; n++) {
        oL[n] = iL[n]; oR[n] = iR[n];
        const ap = Math.max(Math.abs(oL[n]), Math.abs(oR[n]));
        if (ap > peakAccum) peakAccum = ap;
      }
      this._peak = peakAccum;
      this.port.postMessage({ peak: peakAccum, mode: mode });
      return true;
    }

    // ── Tone filter coeff ──
    const toneFreq = 800 + tone * 12000;
    const toneCoef = Math.exp(-2 * Math.PI * toneFreq / sr);

    if (mode === 0) {
      // ═══════════════════════════════════════════════════════════════════
      // RADIO VOICE: Bandpass 300Hz-3.5kHz + mild waveshaper + fast comp
      // ═══════════════════════════════════════════════════════════════════
      const bpLo = this.bpfCoeffs(300 + tone * 200, 0.7);
      const bpHi = this.bpfCoeffs(3500 - (1 - tone) * 500, 0.7);
      const compRatio = 2 + intensity * 2;
      const compThresh = 0.3;
      const atkCoef = Math.exp(-1 / (sr * 0.005));
      const relCoef = Math.exp(-1 / (sr * 0.050));

      for (let n = 0; n < iL.length; n++) {
        let sL = iL[n], sR = iR[n];

        // Bandpass cascade
        sL = this.biquad(this.bp1L, bpLo.b0, bpLo.b1, bpLo.b2, bpLo.a1, bpLo.a2, sL);
        sR = this.biquad(this.bp1R, bpLo.b0, bpLo.b1, bpLo.b2, bpLo.a1, bpLo.a2, sR);
        sL = this.biquad(this.bp2L, bpHi.b0, bpHi.b1, bpHi.b2, bpHi.a1, bpHi.a2, sL);
        sR = this.biquad(this.bp2R, bpHi.b0, bpHi.b1, bpHi.b2, bpHi.a1, bpHi.a2, sR);

        // Mild waveshaper
        const drive = 1 + intensity * 3;
        sL = Math.tanh(sL * drive) / drive * (drive * 0.7);
        sR = Math.tanh(sR * drive) / drive * (drive * 0.7);

        // Fast compressor
        const env = Math.max(Math.abs(sL), Math.abs(sR));
        if (env > this.compEnv) this.compEnv = atkCoef * this.compEnv + (1 - atkCoef) * env;
        else this.compEnv = relCoef * this.compEnv;
        let gain = 1;
        if (this.compEnv > compThresh) {
          const over = this.compEnv / compThresh;
          gain = compThresh * Math.pow(over, 1 / compRatio - 1);
        }
        sL *= gain; sR *= gain;

        // Tone
        this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * sL;
        this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * sR;
        sL = tone < 0.5 ? this.toneLpL : sL;
        sR = tone < 0.5 ? this.toneLpR : sR;

        const fL = (iL[n] * (1 - mix) + sL * mix) * outGain;
        const fR = (iR[n] * (1 - mix) + sR * mix) * outGain;
        oL[n] = fL; oR[n] = fR;
        const ap = Math.max(Math.abs(fL), Math.abs(fR));
        if (ap > peakAccum) peakAccum = ap;
      }

    } else if (mode === 1) {
      // ═══════════════════════════════════════════════════════════════════
      // DREAM POP: Chorus + allpass reverb tail + gentle saturation
      // ═══════════════════════════════════════════════════════════════════
      const lfoRate = 0.3 + motion * 2;
      const lfoInc = lfoRate / sr;
      const chorusDepth = (0.5 + intensity * 1.5) * sr / 1000; // 0.5-2ms in samples
      const chorusCenter = 2 * sr / 1000; // 2ms center delay
      const reverbMix = 0.15 + intensity * 0.35;
      const apGain = 0.5 + intensity * 0.15;

      for (let n = 0; n < iL.length; n++) {
        let sL = iL[n], sR = iR[n];

        // Write to delay
        this.delBufL[this.writePos] = sL;
        this.delBufR[this.writePos] = sR;

        // LFO for chorus
        const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
        const lfo2 = Math.sin(2 * Math.PI * this.lfoPhase + Math.PI * 0.5);

        const delSampL = Math.max(1, chorusCenter + lfo * chorusDepth * motion);
        const delSampR = Math.max(1, chorusCenter + lfo2 * chorusDepth * motion);
        const cL = this.hermite(this.delBufL, this.writePos - delSampL, this.maxDelay);
        const cR = this.hermite(this.delBufR, this.writePos - delSampR, this.maxDelay);

        // Mix chorus
        sL = sL * 0.7 + cL * 0.3 * intensity;
        sR = sR * 0.7 + cR * 0.3 * intensity;

        // Allpass reverb tail
        let rv = (sL + sR) * 0.5;
        for (let i = 0; i < 4; i++) {
          rv = this.allpass(this.ap[i], rv, apGain);
        }
        sL += rv * reverbMix;
        sR += rv * reverbMix;

        // Gentle saturation
        sL = Math.tanh(sL * 1.2) * 0.85;
        sR = Math.tanh(sR * 1.2) * 0.85;

        // Tone
        this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * sL;
        this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * sR;
        sL = sL * tone + this.toneLpL * (1 - tone);
        sR = sR * tone + this.toneLpR * (1 - tone);

        const fL = (iL[n] * (1 - mix) + sL * mix) * outGain;
        const fR = (iR[n] * (1 - mix) + sR * mix) * outGain;
        oL[n] = fL; oR[n] = fR;
        const ap2 = Math.max(Math.abs(fL), Math.abs(fR));
        if (ap2 > peakAccum) peakAccum = ap2;

        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= 1;
        this.writePos = (this.writePos + 1) % this.maxDelay;
      }

    } else if (mode === 2) {
      // ═══════════════════════════════════════════════════════════════════
      // HYPER POP: Bright shelf + aggressive comp + stereo widen + micro-shift
      // ═══════════════════════════════════════════════════════════════════
      const shelfGain = 3 + intensity * 6;
      const sh = this.highShelfCoeffs(8000, shelfGain);
      const compRatio = 4 + intensity * 4; // 4:1 to 8:1
      const compThresh = 0.15;
      const atkCoef = Math.exp(-1 / (sr * 0.001));
      const relCoef = Math.exp(-1 / (sr * 0.020));

      // Haas delay time: 0.3-0.8ms
      const haasMs = 0.3 + motion * 0.5;
      const haasSamp = Math.min(Math.round(haasMs * sr / 1000), this.haasMax - 1);

      // Micro-pitch shift via modulated delay
      const lfoRate = 3 + motion * 8;
      const lfoInc = lfoRate / sr;
      const shiftDepth = (0.1 + intensity * 0.4) * sr / 1000;

      for (let n = 0; n < iL.length; n++) {
        let sL = iL[n], sR = iR[n];

        // Bright shelf
        sL = this.biquad(this.shelfL, sh.b0, sh.b1, sh.b2, sh.a1, sh.a2, sL);
        sR = this.biquad(this.shelfR, sh.b0, sh.b1, sh.b2, sh.a1, sh.a2, sR);

        // Aggressive compression
        const env = Math.max(Math.abs(sL), Math.abs(sR));
        if (env > this.compEnv) this.compEnv = atkCoef * this.compEnv + (1 - atkCoef) * env;
        else this.compEnv = relCoef * this.compEnv;
        let gain = 1;
        if (this.compEnv > compThresh) {
          const over = this.compEnv / compThresh;
          gain = compThresh * Math.pow(over, 1 / compRatio - 1);
        }
        sL *= gain * 1.5; sR *= gain * 1.5;

        // Write to delay for micro-shift
        this.delBufL[this.writePos] = sL;
        this.delBufR[this.writePos] = sR;

        // Micro-pitch shift via modulated delay
        const lfo = Math.sin(2 * Math.PI * this.lfoPhase);
        const shiftSamp = Math.max(1, 3 + lfo * shiftDepth);
        const shifted = this.hermite(this.delBufL, this.writePos - shiftSamp, this.maxDelay);
        sL = sL * 0.7 + shifted * 0.3 * intensity;

        // Stereo widening via Haas
        this.haasBuf[this.haasPos] = sR;
        const haasDelayed = this.haasBuf[(this.haasPos - haasSamp + this.haasMax) % this.haasMax];
        sR = sR * 0.6 + haasDelayed * 0.4 * intensity;
        this.haasPos = (this.haasPos + 1) % this.haasMax;

        // Tone
        this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * sL;
        this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * sR;
        sL = sL * tone + this.toneLpL * (1 - tone);
        sR = sR * tone + this.toneLpR * (1 - tone);

        const fL = (iL[n] * (1 - mix) + sL * mix) * outGain;
        const fR = (iR[n] * (1 - mix) + sR * mix) * outGain;
        oL[n] = fL; oR[n] = fR;
        const ap2 = Math.max(Math.abs(fL), Math.abs(fR));
        if (ap2 > peakAccum) peakAccum = ap2;

        this.lfoPhase += lfoInc;
        if (this.lfoPhase >= 1) this.lfoPhase -= 1;
        this.writePos = (this.writePos + 1) % this.maxDelay;
      }

    } else if (mode === 3) {
      // ═══════════════════════════════════════════════════════════════════
      // INDIE WARM: Soft comp + tube sat + low shelf + subtle plate
      // ═══════════════════════════════════════════════════════════════════
      const compRatio = 1.5 + intensity * 0.5;
      const compThresh = 0.35;
      const atkCoef = Math.exp(-1 / (sr * 0.010));
      const relCoef = Math.exp(-1 / (sr * 0.100));
      const lsGain = 2 + intensity * 3;
      const ls = this.lowShelfCoeffs(200, lsGain);
      const plateMix = 0.08 + intensity * 0.15;
      const apGain = 0.45;

      for (let n = 0; n < iL.length; n++) {
        let sL = iL[n], sR = iR[n];

        // Soft compression
        const env = Math.max(Math.abs(sL), Math.abs(sR));
        if (env > this.compEnv) this.compEnv = atkCoef * this.compEnv + (1 - atkCoef) * env;
        else this.compEnv = relCoef * this.compEnv;
        let gain = 1;
        if (this.compEnv > compThresh) {
          const over = this.compEnv / compThresh;
          gain = compThresh * Math.pow(over, 1 / compRatio - 1);
        }
        sL *= gain; sR *= gain;

        // Tube saturation (tanh with asymmetry)
        const drive = 1 + intensity * 2;
        sL = Math.tanh(sL * drive + sL * sL * 0.1 * intensity) / drive * (drive * 0.8);
        sR = Math.tanh(sR * drive + sR * sR * 0.1 * intensity) / drive * (drive * 0.8);

        // Low shelf boost
        sL = this.biquad(this.lshelfL, ls.b0, ls.b1, ls.b2, ls.a1, ls.a2, sL);
        sR = this.biquad(this.lshelfR, ls.b0, ls.b1, ls.b2, ls.a1, ls.a2, sR);

        // Subtle plate reverb tail
        let rv = (sL + sR) * 0.5;
        for (let i = 0; i < 4; i++) rv = this.allpass(this.ap[i], rv, apGain);
        sL += rv * plateMix * (0.5 + motion * 0.5);
        sR += rv * plateMix * (0.5 + motion * 0.5);

        // Tone
        this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * sL;
        this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * sR;
        sL = sL * tone + this.toneLpL * (1 - tone);
        sR = sR * tone + this.toneLpR * (1 - tone);

        const fL = (iL[n] * (1 - mix) + sL * mix) * outGain;
        const fR = (iR[n] * (1 - mix) + sR * mix) * outGain;
        oL[n] = fL; oR[n] = fR;
        const ap2 = Math.max(Math.abs(fL), Math.abs(fR));
        if (ap2 > peakAccum) peakAccum = ap2;
      }

    } else if (mode === 4) {
      // ═══════════════════════════════════════════════════════════════════
      // AGGRESSIVE RAP: Presence 3-5kHz + tight comp + harmonic edge + body
      // ═══════════════════════════════════════════════════════════════════
      const presGain = 3 + intensity * 5;
      const pres = this.peakEqCoeffs(4000, 1.2, presGain);
      const bodyGain = 2 + intensity * 2;
      const body = this.lowShelfCoeffs(150, bodyGain);
      const compRatio = 3 + intensity * 2;
      const compThresh = 0.2;
      const atkCoef = Math.exp(-1 / (sr * 0.001));
      const relCoef = Math.exp(-1 / (sr * 0.030));

      for (let n = 0; n < iL.length; n++) {
        let sL = iL[n], sR = iR[n];

        // Presence boost
        sL = this.biquad(this.shelfL, pres.b0, pres.b1, pres.b2, pres.a1, pres.a2, sL);
        sR = this.biquad(this.shelfR, pres.b0, pres.b1, pres.b2, pres.a1, pres.a2, sR);

        // Body boost
        sL = this.biquad(this.lshelfL, body.b0, body.b1, body.b2, body.a1, body.a2, sL);
        sR = this.biquad(this.lshelfR, body.b0, body.b1, body.b2, body.a1, body.a2, sR);

        // Tight compression
        const env = Math.max(Math.abs(sL), Math.abs(sR));
        if (env > this.compEnv) this.compEnv = atkCoef * this.compEnv + (1 - atkCoef) * env;
        else this.compEnv = relCoef * this.compEnv;
        let gain = 1;
        if (this.compEnv > compThresh) {
          const over = this.compEnv / compThresh;
          gain = compThresh * Math.pow(over, 1 / compRatio - 1);
        }
        sL *= gain * 1.3; sR *= gain * 1.3;

        // Harmonic edge
        const edgeDrive = 1.5 + intensity * 2;
        sL = Math.tanh(sL * edgeDrive) * 0.7;
        sR = Math.tanh(sR * edgeDrive) * 0.7;

        // Tone
        this.toneLpL = toneCoef * this.toneLpL + (1 - toneCoef) * sL;
        this.toneLpR = toneCoef * this.toneLpR + (1 - toneCoef) * sR;
        sL = sL * tone + this.toneLpL * (1 - tone);
        sR = sR * tone + this.toneLpR * (1 - tone);

        const fL = (iL[n] * (1 - mix) + sL * mix) * outGain;
        const fR = (iR[n] * (1 - mix) + sR * mix) * outGain;
        oL[n] = fL; oR[n] = fR;
        const ap2 = Math.max(Math.abs(fL), Math.abs(fR));
        if (ap2 > peakAccum) peakAccum = ap2;
      }

    } else {
      // ═══════════════════════════════════════════════════════════════════
      // TELEPHONE: Hard bandpass 500-3kHz + harsh clipping + bit reduction
      // ═══════════════════════════════════════════════════════════════════
      const bpLo = this.bpfCoeffs(500, 1.0);
      const bpHi = this.bpfCoeffs(3000, 1.0);
      const clipLevel = 0.3 - intensity * 0.2;
      const srReduce = Math.max(1, Math.round(1 + intensity * 15));

      for (let n = 0; n < iL.length; n++) {
        let sL = iL[n], sR = iR[n];
        let sMono = (sL + sR) * 0.5;

        // Hard bandpass
        sMono = this.biquad(this.bp1L, bpLo.b0, bpLo.b1, bpLo.b2, bpLo.a1, bpLo.a2, sMono);
        sMono = this.biquad(this.bp2L, bpHi.b0, bpHi.b1, bpHi.b2, bpHi.a1, bpHi.a2, sMono);

        // Harsh clipping
        sMono = Math.max(-clipLevel, Math.min(clipLevel, sMono * (1 + intensity * 4)));

        // Bit reduction feel
        this.crushCounter++;
        if (this.crushCounter >= srReduce) {
          this.crushCounter = 0;
          const bits = Math.max(4, 12 - Math.round(intensity * 8));
          const levels = Math.pow(2, bits);
          this.crushHold = Math.round(sMono * levels) / levels;
        }
        sMono = this.crushHold;

        const fL = (iL[n] * (1 - mix) + sMono * mix) * outGain;
        const fR = (iR[n] * (1 - mix) + sMono * mix) * outGain;
        oL[n] = fL; oR[n] = fR;
        const ap2 = Math.max(Math.abs(fL), Math.abs(fR));
        if (ap2 > peakAccum) peakAccum = ap2;
      }
    }

    this._peak = peakAccum;
    this.port.postMessage({ peak: peakAccum, mode: mode });
    return true;
  }
}

registerProcessor('${PROCESSOR_VERSION}', CharacterProcessor);
`;

export async function createCharacterEngine(audioCtx) {
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

  let _peak = 0, _mode = 0;
  worklet.port.onmessage = e => {
    if (e.data?.peak !== undefined) _peak = e.data.peak;
    if (e.data?.mode !== undefined) _mode = e.data.mode;
  };

  const _buf = new Float32Array(2048);
  function getRms(an) {
    an.getFloatTimeDomainData(_buf);
    let s = 0; for (let i = 0; i < _buf.length; i++) s += _buf[i] * _buf[i];
    return Math.sqrt(s / _buf.length);
  }
  function getPeak(an) {
    an.getFloatTimeDomainData(_buf);
    let m = 0; for (let i = 0; i < _buf.length; i++) { const a = Math.abs(_buf[i]); if (a > m) m = a; }
    return m;
  }

  const p = name => worklet.parameters.get(name);
  let _peakIn = 0, _peakOut = 0;
  const DECAY = 0.94;

  return {
    input, output, chainOutput,
    setInputGain:  v => { inputTrim.gain.value  = v; },
    setOutputGain: v => { outputTrim.gain.value = v; },
    setStyle:      v => { p('style').value     = v; },
    setIntensity:  v => { p('intensity').value = v; },
    setTone:       v => { p('tone').value      = v; },
    setMotion:     v => { p('motion').value    = v; },
    setMix:        v => { p('mix').value       = v; },
    setOutput:     v => { p('output').value    = v; },
    setBypass:     v => { p('bypass').value    = v ? 1 : 0; },

    getInputPeak:  () => { _peakIn  = Math.max(getPeak(analyserIn),  _peakIn  * DECAY); return _peakIn; },
    getOutputPeak: () => { _peakOut = Math.max(getPeak(analyserOut), _peakOut * DECAY); return _peakOut; },
    getInputLevel: () => getRms(analyserIn),
    getOutputLevel:() => getRms(analyserOut),
    getPeakOutput: () => _peak,
    getMode:       () => _mode,

    destroy() {
      worklet.disconnect(); input.disconnect(); inputTrim.disconnect();
      output.disconnect(); outputTrim.disconnect(); chainOutput.disconnect();
      analyserIn.disconnect(); analyserOut.disconnect();
    },
    dispose() { this.destroy(); },
  };
}
