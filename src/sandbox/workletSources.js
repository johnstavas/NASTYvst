// workletSources.js — AudioWorklet processor sources for sandbox ops.
//
// Each processor here is loaded via the Blob + addModule() pattern (see
// workletLoader.js). This is the first AudioWorklet in the sandbox —
// the pattern established here becomes the template for every future
// sample-accurate op (gainComputer, lfo, crush, state machines …).
//
// Why worklets for ops like envelope/gainComputer and not just native
// WebAudio nodes:
//   • Proper asymmetric attack/release needs sample-by-sample branching
//     ("is target above or below current state?") — a biquad can't do
//     that.
//   • Nonlinear transfer curves with memory (feedback + NL) need
//     sample-accurate state to stay stable.
//   • State machines (comp TC1–6, vari-mu bias coupling, dual-gate
//     chains) are inherently sample-loop logic.
//
// Keep each processor SMALL and FOCUSED. One op = one processor =
// roughly one codegen template. That way the eventual master-worklet
// compiler can lift these directly.

export const SANDBOX_WORKLET_SOURCE = `
// ---------------------------------------------------------------------
//  Shared — anti-denormal bias (Jon Watte, per dsp_code_canon_utilities §1).
// ---------------------------------------------------------------------
// Float32 denormals start around 1.18e-38 and murder CPU on x86 when
// recursive filter states converge toward zero under silence. Add a
// tiny positive bias (~-400 dB acoustically — inaudible) every sample
// on any state that can coast to zero: envelope followers, FDN lines,
// delay-line FB paths, one-pole filters inside feedback loops.
//
// Only needed for states not continuously pumped by a fresh non-zero
// signal. (Pink-noise filter states get fresh white every sample, so
// they're self-safe. Envelope state under silence is NOT self-safe.)
const DENORM = 1e-20;

// ---------------------------------------------------------------------
//  sandbox-envelope-follower — proper asymmetric AR envelope follower.
// ---------------------------------------------------------------------
//
// Input:  already-rectified audio-rate signal (detector op's output).
//         We still take |x| defensively in case someone wires audio
//         directly into it without a detector.
// Output: smoothed, scaled, offset control signal (audio-rate so it can
//         drive any downstream AudioParam via .connect()).
//
// AudioParams (all k-rate — one value per render quantum is plenty):
//   attackMs    Range 0.1..500   — time to ~63% rise when target > state
//   releaseMs   Range 1..2000    — time to ~63% fall when target <= state
//   amount      Range -4..4      — multiplier applied to smoothed env
//   offset      Range -4..4      — DC bias added after amount
//
// Param math:
//   tauSamples = tauSec * sampleRate
//   alpha      = exp(-1 / tauSamples)    // retention factor
//   state      = alpha * state + (1-alpha) * target
//
// Coefs are recomputed when attackMs/releaseMs change. Comparing
// against a cached last-value is cheaper than recomputing every frame.

class SandboxEnvelopeFollower extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'attackMs',  defaultValue: 5,    minValue: 0.1, maxValue: 500,  automationRate: 'k-rate' },
      { name: 'releaseMs', defaultValue: 120,  minValue: 1,   maxValue: 2000, automationRate: 'k-rate' },
      { name: 'amount',    defaultValue: -1,   minValue: -4,  maxValue: 4,    automationRate: 'a-rate' },
      { name: 'offset',    defaultValue: 0,    minValue: -4,  maxValue: 4,    automationRate: 'a-rate' },
    ];
  }

  constructor() {
    super();
    this._state     = 0;
    this._lastAtkMs = -1;
    this._lastRelMs = -1;
    this._atkAlpha  = 0;
    this._relAlpha  = 0;
  }

  _recomputeAlphas(atkMs, relMs) {
    const sr = sampleRate; // global inside worklet scope
    // Guard against zero/neg — shouldn't happen, but defensive.
    const atkSec = Math.max(0.0001, atkMs / 1000);
    const relSec = Math.max(0.0001, relMs / 1000);
    this._atkAlpha = Math.exp(-1 / (atkSec * sr));
    this._relAlpha = Math.exp(-1 / (relSec * sr));
    this._lastAtkMs = atkMs;
    this._lastRelMs = relMs;
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const outCh = out[0];
    const inCh  = (inp && inp.length > 0) ? inp[0] : null;
    const N     = outCh.length;

    // k-rate params: take [0] (single value for whole quantum).
    const atkMs = params.attackMs[0];
    const relMs = params.releaseMs[0];
    if (atkMs !== this._lastAtkMs || relMs !== this._lastRelMs) {
      this._recomputeAlphas(atkMs, relMs);
    }
    const atkA = this._atkAlpha;
    const relA = this._relAlpha;

    // a-rate params may be full arrays (length N) or single-sample arrays.
    const amtArr = params.amount;
    const offArr = params.offset;
    const amtIsArr = amtArr.length > 1;
    const offIsArr = offArr.length > 1;

    let s = this._state;

    if (!inCh) {
      // No input connected — decay the state toward 0 over release, so
      // mod stops cleanly when the brick is silent. +DENORM bias keeps
      // the state out of subnormal range under long silence (Watte).
      for (let i = 0; i < N; i++) {
        s = relA * s + DENORM; // target = 0 → s = relA*s + (1-relA)*0
        const amt = amtIsArr ? amtArr[i] : amtArr[0];
        const off = offIsArr ? offArr[i] : offArr[0];
        outCh[i] = s * amt + off;
      }
    } else {
      for (let i = 0; i < N; i++) {
        // Defensive rectification — detector op normally handles this.
        const target = inCh[i] < 0 ? -inCh[i] : inCh[i];
        const a = (target > s) ? atkA : relA;
        s = a * s + (1 - a) * target + DENORM;
        const amt = amtIsArr ? amtArr[i] : amtArr[0];
        const off = offIsArr ? offArr[i] : offArr[0];
        outCh[i] = s * amt + off;
      }
    }

    this._state = s;
    return true; // stay alive forever; disposed by disconnecting
  }
}

registerProcessor('sandbox-envelope-follower', SandboxEnvelopeFollower);

// ---------------------------------------------------------------------
//  sandbox-lfo — low-frequency oscillator, bipolar mono control signal.
// ---------------------------------------------------------------------
//
// Output: audio-rate signal in [-1..1]·amount + offset. Ready to sum
// directly into any AudioParam via .connect(param).
//
// AudioParams:
//   rateHz   0.01..40   k-rate — cycles per second
//   shape    0..3       k-rate — 0=sine, 1=tri, 2=square, 3=saw(down)
//   amount   -4..4      a-rate — final scalar on the waveform
//   offset   -4..4      a-rate — DC added after amount
//
// Phase is stored in [0..1). Per-sample increment = rateHz / sampleRate.
// Shape is read once per render quantum (k-rate) to keep the inner loop
// branch-free on shape changes; flip-zipper on shape is negligible at
// sub-audio rates.

class SandboxLFO extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rateHz', defaultValue: 1,   minValue: 0.01, maxValue: 40,  automationRate: 'k-rate' },
      { name: 'shape',  defaultValue: 0,   minValue: 0,    maxValue: 3,   automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 1,   minValue: -4,   maxValue: 4,   automationRate: 'a-rate' },
      { name: 'offset', defaultValue: 0,   minValue: -4,   maxValue: 4,   automationRate: 'a-rate' },
    ];
  }

  constructor() {
    super();
    this._phase = 0; // [0..1)
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outCh = out[0];
    const N     = outCh.length;

    const rateHz = params.rateHz[0];
    const shape  = Math.round(params.shape[0]) | 0;
    const inc    = rateHz / sampleRate;

    const amtArr = params.amount;
    const offArr = params.offset;
    const amtIsArr = amtArr.length > 1;
    const offIsArr = offArr.length > 1;

    let p = this._phase;
    const TWO_PI = 6.283185307179586;

    for (let i = 0; i < N; i++) {
      let w;
      switch (shape) {
        case 1: // triangle: 0→1→0→-1→0 mapped from phase
          w = p < 0.5 ? (4 * p - 1) : (3 - 4 * p);
          break;
        case 2: // square (naive — fine for LFO rates; aliasing is inaudible sub-audio)
          w = p < 0.5 ? 1 : -1;
          break;
        case 3: // saw-down (1 → -1 across the cycle)
          w = 1 - 2 * p;
          break;
        default: // sine
          w = Math.sin(TWO_PI * p);
      }
      const amt = amtIsArr ? amtArr[i] : amtArr[0];
      const off = offIsArr ? offArr[i] : offArr[0];
      outCh[i] = w * amt + off;

      p += inc;
      if (p >= 1) p -= 1;
      else if (p < 0) p += 1;
    }

    this._phase = p;
    return true;
  }
}

registerProcessor('sandbox-lfo', SandboxLFO);

// ---------------------------------------------------------------------
//  sandbox-gain-computer — threshold/ratio/knee → gain-reduction signal.
// ---------------------------------------------------------------------
//
// Input:  linear-magnitude envelope (audio-rate control signal, typically
//         the output of envelope.env with amount=+1, offset=0). Values
//         below ~1e-5 clamp to -100 dB to dodge log(0).
// Output: delta-from-unity gain-reduction signal. 0 = no reduction;
//         negative values pull a downstream gain.gainMod below unity.
//         Wire directly to an AudioParam whose resting value is 1.0.
//
// Math (Reiss/Zölzer soft-knee compressor, computed in dB domain):
//   x_dB    = 20·log10(|env|)
//   over    = x_dB - threshold
//   if 2·over < -knee:
//       y_dB = x_dB                              // below knee → unity
//   else if 2·|over| <= knee:
//       y_dB = x_dB + (1/ratio - 1)·(over + knee/2)² / (2·knee)
//   else:
//       y_dB = threshold + over / ratio          // above knee → full ratio
//   grDb    = y_dB - x_dB                        // gain change (≤ 0)
//   grLin   = 10^(grDb/20)                       // multiplier in (0..1]
//   out     = grLin - 1                          // delta-from-unity (≤ 0)
//
// knee param is the *total* knee width in dB (so ±knee/2 around threshold).
// knee=0 collapses to a hard knee.
//
// Params are k-rate — these are tone-shaping knobs, not modulation
// targets, so per-quantum updates are plenty.

class SandboxGainComputer extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'thresholdDb', defaultValue: -18, minValue: -60, maxValue:  0, automationRate: 'k-rate' },
      { name: 'ratio',       defaultValue:   4, minValue:   1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'kneeDb',      defaultValue:   6, minValue:   0, maxValue: 24, automationRate: 'k-rate' },
    ];
  }

  process(inputs, outputs, params) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outCh = out[0];
    const N     = outCh.length;
    const inCh  = (inp && inp.length > 0) ? inp[0] : null;

    const thr   = params.thresholdDb[0];
    const ratio = Math.max(1, params.ratio[0]);
    const knee  = Math.max(0, params.kneeDb[0]);

    const invRatioMinusOne = (1 / ratio) - 1;   // ≤ 0
    const halfKnee = knee * 0.5;
    const LN10_OVER_20 = Math.LN10 / 20;        // for 10^(x/20) via exp
    const INV_LN10_OVER_20 = 20 / Math.LN10;    // for 20*log10(x) via log

    if (!inCh) {
      // No envelope wired → no reduction. Fill with zeros defensively.
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return true;
    }

    for (let i = 0; i < N; i++) {
      // Magnitude → dB, with a -100 dB floor.
      const mag = Math.abs(inCh[i]);
      const xDb = mag > 1e-5 ? Math.log(mag) * INV_LN10_OVER_20 : -100;
      const over = xDb - thr;

      let grDb;
      if (knee > 0 && 2 * over > -knee && 2 * over < knee) {
        // Soft-knee region — quadratic interpolation.
        const t = over + halfKnee;          // 0..knee
        grDb = invRatioMinusOne * (t * t) / (2 * knee);
      } else if (over > 0) {
        // Above knee — full ratio.
        grDb = invRatioMinusOne * over;
      } else {
        // Below knee — unity.
        grDb = 0;
      }

      // grDb ≤ 0 always. Convert to linear multiplier, then delta-from-unity.
      // exp() is faster than Math.pow(10, x) in V8.
      const grLin = grDb < 0 ? Math.exp(grDb * LN10_OVER_20) : 1;
      outCh[i] = grLin - 1;
    }

    return true;
  }
}

registerProcessor('sandbox-gain-computer', SandboxGainComputer);

// ---------------------------------------------------------------------
//  sandbox-noise — white / pink / brown mono noise generator.
// ---------------------------------------------------------------------
//
// Input:  none. Pure source.
// Output: mono noise, approximately bounded in [-1..1] pre-amount.
//
// Shapes:
//   0 = white   — uniform [-1..1] (Math.random()*2-1)
//   1 = pink    — Paul Kellet's filter (~-3 dB/octave), 7-pole sum
//   2 = brown   — leaky integrator of white, clamped to [-1..1]
//
// Params (k-rate shape, a-rate level/offset):
//   shape   0..2        which color
//   amount  -4..4       multiplier on the noise sample
//   offset  -4..4       DC bias added after amount
//
// Notes on pink: Paul Kellet filter coefficients are canonical; the
// 0.11 scale at the end keeps peaks mostly within [-1..1] (not a hard
// bound — statistical). No seeding for now; add a seeded LCG later if
// reproducibility matters for conformance tests.

class SandboxNoise extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'shape',  defaultValue: 0, minValue: 0,  maxValue: 2, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 1, minValue: -4, maxValue: 4, automationRate: 'a-rate' },
      { name: 'offset', defaultValue: 0, minValue: -4, maxValue: 4, automationRate: 'a-rate' },
    ];
  }

  constructor() {
    super();
    // Pink-noise filter state (Paul Kellet).
    this._b0 = 0; this._b1 = 0; this._b2 = 0;
    this._b3 = 0; this._b4 = 0; this._b5 = 0; this._b6 = 0;
    // Brown-noise leaky integrator state.
    this._brown = 0;
  }

  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const outCh = out[0];
    const N     = outCh.length;

    const shape = Math.round(params.shape[0]) | 0;
    const amtArr = params.amount;
    const offArr = params.offset;
    const amtIsArr = amtArr.length > 1;
    const offIsArr = offArr.length > 1;

    let b0 = this._b0, b1 = this._b1, b2 = this._b2, b3 = this._b3;
    let b4 = this._b4, b5 = this._b5, b6 = this._b6;
    let brown = this._brown;

    for (let i = 0; i < N; i++) {
      const white = Math.random() * 2 - 1;
      let n;
      if (shape === 1) {
        // Pink — Paul Kellet. Magic coefficients, leave them alone.
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        n = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (shape === 2) {
        // Brown — leaky integrator with a soft bound so the state can't
        // drift off. 0.02 step + clamp gives a usable bass rumble.
        brown += white * 0.02;
        if (brown > 1)       brown = 1;
        else if (brown < -1) brown = -1;
        n = brown * 3.5;
        // Scale above can exceed [-1..1] briefly; downstream scaleBy/trim
        // handles any taste-level headroom.
        if (n >  1) n =  1;
        if (n < -1) n = -1;
      } else {
        n = white;
      }

      const amt = amtIsArr ? amtArr[i] : amtArr[0];
      const off = offIsArr ? offArr[i] : offArr[0];
      outCh[i] = n * amt + off;
    }

    this._b0 = b0; this._b1 = b1; this._b2 = b2; this._b3 = b3;
    this._b4 = b4; this._b5 = b5; this._b6 = b6;
    this._brown = brown;
    return true;
  }
}

registerProcessor('sandbox-noise', SandboxNoise);

// ---------------------------------------------------------------------
//  sandbox-fdn-reverb — Geraint Luff FDN (Hadamard diffuser + Householder
//  feedback matrix), ported from src/morphReverbEngine.js.
// ---------------------------------------------------------------------
//
// Tier-3 Path A: the whole reverb as ONE monolithic op. Once the master-
// worklet compiler lands (Stage 3), this gets re-decomposed into delay
// / matrix / shelf primitives — keeping it as a single worklet now is
// the honest shape for chain-of-worklets preview mode, because 8-channel
// feedback cycles can't be expressed in the current feed-forward-only
// compiler.
//
// DSP architecture (see reverb_engine_architecture.md):
//   1. Stereo pre-delay (0..60 ms, SIZE-scaled)
//   2. Two 4-step DiffuserHalfLengths (A=tight 30/15/7.5/3.75 ms,
//      B=loose 80/40/20/10 ms); MORPH blends between them.
//   3. 8-channel FDN with Householder feedback matrix; delays
//      exponentially spaced 100..200 ms.
//   4. Per-channel first-order HF shelf → frequency-dependent decay
//      (TONE sets the HF/LF ratio, crossover ~1.5 kHz).
//   5. Fractional delay modulation on even channels (WARP → chorus/shimmer).
//   6. 8-tap stereo-spread early reflections, tapped from the diffused
//      signal (not raw input) per Luff's recipe.
//   7. Equal-power dry/wet mix inside the worklet (mix-rule compliant
//      for this op in isolation; the host graph still violates the rule
//      if a separate mix op is used downstream).
//
// I/O:
//   Input  : stereo (upmixed automatically if host hands us mono)
//   Output : stereo (2 channels)
//
// Params (all normalised 0..1, k-rate — LP smoothed internally):
//   morph   A↔B diffuser blend
//   size    Pre-delay + ER tap scaling (room scale)
//   decay   RT60 via reference formula (0.3 s → 30 s, freeze @ >99%)
//   tone    HF/LF decay ratio (dark → bright)
//   density A/B diffuser vs raw signal blend
//   warp    Fractional-delay mod depth (subtle → chorus/shimmer)
//   mix     Equal-power dry/wet

class SandboxHadamard8 {
  // Static method — kept class-scoped to avoid polluting worklet globals.
  static apply(a) {
    let t;
    t=a[0]; a[0]=t+a[1]; a[1]=t-a[1]; t=a[2]; a[2]=t+a[3]; a[3]=t-a[3];
    t=a[4]; a[4]=t+a[5]; a[5]=t-a[5]; t=a[6]; a[6]=t+a[7]; a[7]=t-a[7];
    t=a[0]; a[0]=t+a[2]; a[2]=t-a[2]; t=a[1]; a[1]=t+a[3]; a[3]=t-a[3];
    t=a[4]; a[4]=t+a[6]; a[6]=t-a[6]; t=a[5]; a[5]=t+a[7]; a[7]=t-a[7];
    t=a[0]; a[0]=t+a[4]; a[4]=t-a[4]; t=a[1]; a[1]=t+a[5]; a[5]=t-a[5];
    t=a[2]; a[2]=t+a[6]; a[6]=t-a[6]; t=a[3]; a[3]=t+a[7]; a[7]=t-a[7];
    const s = 0.35355339059327373; // 1/sqrt(8)
    a[0]*=s; a[1]*=s; a[2]*=s; a[3]*=s; a[4]*=s; a[5]*=s; a[6]*=s; a[7]*=s;
  }
  static householder(a) {
    const f = (a[0]+a[1]+a[2]+a[3]+a[4]+a[5]+a[6]+a[7]) * 0.25; // 2/N, N=8
    a[0]-=f; a[1]-=f; a[2]-=f; a[3]-=f; a[4]-=f; a[5]-=f; a[6]-=f; a[7]-=f;
  }
}

class SandboxFdnReverb extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'morph',   defaultValue: 0.5,  minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'size',    defaultValue: 0.55, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'decay',   defaultValue: 0.5,  minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'tone',    defaultValue: 0.55, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'density', defaultValue: 0.6,  minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'warp',    defaultValue: 0.3,  minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mix',     defaultValue: 0.3,  minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;

    // Smoothed params (block-level)
    this._sm=0.5; this._ss=0.55; this._sd=0.5;
    this._st=0.55; this._sden=0.6; this._sw=0.3; this._smix=0.3;

    // Two DiffuserHalfLengths (tight + loose)
    this.diffA = this._buildDiffuser(sr, 60);
    this.diffB = this._buildDiffuser(sr, 160);

    // FDN — 8 channels, exponentially spaced 100..200 ms
    const fdnBase = Math.round(0.100 * sr);
    this.fdnDelays = new Int32Array(8);
    this.fdnBufs   = [];
    this.fdnIdxs   = new Int32Array(8);
    this.fdnShelf  = new Float64Array(8); // per-channel HF shelf LP state
    // Per-channel DC trap state (1-pole HP @ ~10 Hz on FB signal). Retires
    // FDN-SB-02 per qc_backlog.md § Sandbox Brick Audit Sweep. Applied to
    // fb_sig before the hard-clip so DC can't accumulate in the ring
    // buffer and can't drive the limiter into one-sided clipping.
    // y[n] = x[n] - x[n-1] + R·y[n-1];  R = exp(-2π·fc/sr)
    this.fdnDcX    = new Float64Array(8);
    this.fdnDcY    = new Float64Array(8);
    this.fdnDcR    = Math.exp(-2 * Math.PI * 10 / sr); // ~0.998692 at 48k
    for (let c = 0; c < 8; c++) {
      this.fdnDelays[c] = Math.round(Math.pow(2, c / 8) * fdnBase);
      this.fdnBufs.push(new Float32Array(this.fdnDelays[c] + 16));
    }

    // Fractional-delay LFOs on even channels only
    const lfoHz = [0.15, 0, 0.22, 0, 0.31, 0, 0.44, 0];
    this.fdnLfoPhase = new Float64Array(8);
    this.fdnLfoRate  = new Float64Array(8);
    for (let c = 0; c < 8; c++) {
      this.fdnLfoRate[c]  = lfoHz[c] > 0 ? 2 * Math.PI * lfoHz[c] / sr : 0;
      this.fdnLfoPhase[c] = Math.random() * Math.PI * 2;
    }

    // Early reflections (8 stereo-spread taps)
    this.erTapMs   = [7, 13, 17, 23, 29, 37, 43, 53];
    this.erTapGain = [0.65, 0.56, 0.50, 0.44, 0.38, 0.32, 0.27, 0.22];
    this.erTapWL   = [1.0, 0.3, 0.8, 0.4, 1.0, 0.5, 0.7, 0.3];
    this.erTapWR   = [0.3, 1.0, 0.5, 0.9, 0.3, 0.8, 0.4, 1.0];
    this.erMaxLen  = Math.ceil(sr * 0.075);
    this.erBufL    = new Float32Array(this.erMaxLen);
    this.erBufR    = new Float32Array(this.erMaxLen);
    this.erIdx     = 0;
    this._erSamps  = new Int32Array(8);

    // Pre-delay (up to 60 ms)
    this.pdMax = Math.ceil(sr * 0.065);
    this.pdL   = new Float32Array(this.pdMax);
    this.pdR   = new Float32Array(this.pdMax);
    this.pdIdx = 0;

    // Scratch (zero allocation in process)
    this._inp = new Float64Array(8);
    this._dA  = new Float64Array(8);
    this._dB  = new Float64Array(8);
    this._bl  = new Float64Array(8);
    this._del = new Float64Array(8);
    this._mix = new Float64Array(8);
  }

  _buildDiffuser(sr, initMs) {
    const steps = [];
    let ms = initMs;
    for (let s = 0; s < 4; s++) {
      ms *= 0.5;
      const rangeS = ms * 0.001 * sr;
      const delays = new Int32Array(8);
      const bufs   = [];
      const idxs   = new Int32Array(8);
      const flips  = new Uint8Array(8);
      for (let c = 0; c < 8; c++) {
        const lo = rangeS * c / 8;
        const hi = rangeS * (c + 1) / 8;
        delays[c] = Math.max(2, Math.round(lo + Math.random() * (hi - lo)));
        bufs.push(new Float32Array(delays[c] + 4));
        flips[c] = Math.random() < 0.5 ? 1 : 0;
      }
      steps.push({ delays, bufs, idxs, flips });
    }
    return steps;
  }

  _diffuse(diff, inArr, outArr) {
    for (let c = 0; c < 8; c++) outArr[c] = inArr[c];
    for (let s = 0; s < 4; s++) {
      const st = diff[s];
      for (let c = 0; c < 8; c++) {
        const buf = st.bufs[c];
        const len = buf.length;
        const wi  = st.idxs[c];
        buf[wi] = outArr[c];
        let ri = wi - st.delays[c];
        if (ri < 0) ri += len;
        outArr[c] = buf[ri];
        st.idxs[c] = wi + 1 < len ? wi + 1 : 0;
      }
      SandboxHadamard8.apply(outArr);
      for (let c = 0; c < 8; c++) { if (st.flips[c]) outArr[c] = -outArr[c]; }
    }
  }

  process(inputs, outputs, params) {
    const inBufs = inputs[0];
    const outBufs = outputs[0];
    if (!outBufs || !outBufs[0]) return true;

    const iL = (inBufs && inBufs[0]) ? inBufs[0] : null;
    const iR = (inBufs && inBufs[1]) ? inBufs[1] : iL;
    const oL = outBufs[0];
    const oR = outBufs[1] || outBufs[0];
    const N  = oL.length;
    const sr = this.sr;

    // Block-level param smoothing
    const PS = 0.85;
    this._sm   = PS * this._sm   + (1 - PS) * params.morph[0];
    this._ss   = PS * this._ss   + (1 - PS) * params.size[0];
    this._sd   = PS * this._sd   + (1 - PS) * params.decay[0];
    this._st   = PS * this._st   + (1 - PS) * params.tone[0];
    this._sden = PS * this._sden + (1 - PS) * params.density[0];
    this._sw   = PS * this._sw   + (1 - PS) * params.warp[0];
    this._smix = PS * this._smix + (1 - PS) * params.mix[0];

    const mo = this._sm, sz = this._ss, dc = this._sd;
    const tn = this._st, dn = this._sden, wp = this._sw, mx = this._smix;

    // DECAY → g_dc. RT60 reference formula over the actual 150 ms loop.
    const actualLoopMs = 150.0;
    let g_dc;
    if (dc >= 0.99) {
      g_dc = 0.9998;
    } else {
      const rt60         = 0.3 * Math.pow(100.0, dc);
      const loopsPerRt60 = rt60 / (actualLoopMs * 0.001);
      const dbPerCycle   = -60.0 / loopsPerRt60;
      g_dc = Math.min(0.9997, Math.pow(10, dbPerCycle * 0.05));
    }

    // TONE → per-channel HF shelf (crossover ~1.5 kHz)
    const shelfCoeff = 1 - Math.exp(-2 * Math.PI * 1500 / sr);
    const hfRatio    = 0.02 + tn * 0.97;
    const g_hf       = g_dc * hfRatio;
    const g_shelf    = g_dc - g_hf;

    // SIZE → pre-delay + ER spread
    const pdSamps = Math.min(Math.round(sz * 75 * sr * 0.001), this.pdMax - 2);
    const erScale = 0.1 + sz * 1.1;

    // WARP → fractional-delay mod depth (quadratic)
    const modAmt = wp * wp * 22.0;

    // Pre-compute ER tap sample counts (once per block)
    for (let t = 0; t < 8; t++) {
      this._erSamps[t] = Math.min(
        Math.max(1, Math.round(this.erTapMs[t] * erScale * sr * 0.001)),
        this.erMaxLen - 2
      );
    }

    const blendA   = Math.cos(mo * Math.PI * 0.5);
    const blendB   = Math.sin(mo * Math.PI * 0.5);
    const dryCoeff = Math.cos(mx * Math.PI * 0.5);
    const wetCoeff = Math.sin(mx * Math.PI * 0.5);

    for (let n = 0; n < N; n++) {
      const dL = iL ? iL[n] : 0;
      const dR = iR ? iR[n] : 0;

      // Pre-delay
      this.pdL[this.pdIdx] = dL;
      this.pdR[this.pdIdx] = dR;
      let pdRi = this.pdIdx - pdSamps;
      if (pdRi < 0) pdRi += this.pdMax;
      const pdL = this.pdL[pdRi];
      const pdR = this.pdR[pdRi];
      this.pdIdx = this.pdIdx + 1 < this.pdMax ? this.pdIdx + 1 : 0;

      // Diffusion (runs before ER — diffused signal feeds ER taps)
      const inp = this._inp;
      inp[0]=pdL; inp[1]=pdR; inp[2]=pdL; inp[3]=pdR;
      inp[4]=pdL; inp[5]=pdR; inp[6]=pdL; inp[7]=pdR;

      this._diffuse(this.diffA, inp, this._dA);
      this._diffuse(this.diffB, inp, this._dB);

      // Morph blend + density
      const bl = this._bl, dA = this._dA, dB = this._dB;
      for (let c = 0; c < 8; c++) {
        const morphed = dA[c] * blendA + dB[c] * blendB;
        bl[c] = inp[c] * (1 - dn) + morphed * dn;
      }

      // Early reflections — tapped from diffused signal
      const blL = (bl[0] + bl[2] + bl[4] + bl[6]) * 0.25;
      const blR = (bl[1] + bl[3] + bl[5] + bl[7]) * 0.25;
      this.erBufL[this.erIdx] = blL;
      this.erBufR[this.erIdx] = blR;
      let erL = 0, erR = 0;
      const erSamps = this._erSamps, erGain = this.erTapGain;
      const erWL = this.erTapWL, erWR = this.erTapWR;
      for (let t = 0; t < 8; t++) {
        let tri = this.erIdx - erSamps[t];
        if (tri < 0) tri += this.erMaxLen;
        let samp = this.erBufL[tri]; erL += samp * erGain[t] * erWL[t];
        samp     = this.erBufR[tri]; erR += samp * erGain[t] * erWR[t];
      }
      this.erIdx = this.erIdx + 1 < this.erMaxLen ? this.erIdx + 1 : 0;
      erL *= 0.15; erR *= 0.15;

      // FDN read (fractional delay on even channels)
      const del = this._del, mix = this._mix;
      const fb  = this.fdnBufs, fd = this.fdnDelays;
      const fi  = this.fdnIdxs, fsh = this.fdnShelf;
      const flp = this.fdnLfoPhase, flr = this.fdnLfoRate;

      for (let c = 0; c < 8; c++) {
        const flen = fb[c].length;
        const fwi  = fi[c];
        let fracDel = fd[c];
        if (flr[c] > 0) {
          flp[c] += flr[c];
          fracDel += Math.sin(flp[c]) * modAmt;
          if (fracDel < 2) fracDel = 2;
        }
        const iD = Math.floor(fracDel);
        const fr = fracDel - iD;
        let r0 = fwi - iD;     if (r0 < 0) r0 += flen;
        let r1 = fwi - iD - 1; if (r1 < 0) r1 += flen;
        del[c] = fb[c][r0] + fr * (fb[c][r1] - fb[c][r0]);
        mix[c] = del[c];
      }

      // Householder feedback mix
      SandboxHadamard8.householder(mix);

      // Per-channel HF shelf → DC trap → hard-clip → FB write.
      // +DENORM bias on the shelf state keeps long-decay tails out of
      // subnormal range (Canon:utilities §1, ship-critical for FDN reverb).
      // DC trap (1-pole HP @ 10 Hz) sits between shelf and hard-clip so
      // accumulated DC can't push the limiter into one-sided clipping and
      // can't poison the ring buffer. Retires FDN-SB-02.
      const dcX = this.fdnDcX, dcY = this.fdnDcY, dcR = this.fdnDcR;
      for (let c = 0; c < 8; c++) {
        fsh[c] += shelfCoeff * (mix[c] - fsh[c]) + DENORM;
        let fb_sig = mix[c] * g_hf + fsh[c] * g_shelf;
        // HP: y = x - x_prev + R·y_prev (+ DENORM bias — geometric decay
        // of the HP state goes subnormal otherwise; Canon:utilities §1).
        const y = fb_sig - dcX[c] + dcR * dcY[c] + DENORM;
        dcX[c] = fb_sig;
        dcY[c] = y;
        fb_sig = y;
        // Soft-limit the FB return via Padé tanh (y = T·tanh(x/T)).
        // Unity through the linear region (tail tone preserved) and
        // asymptotes to ±T when the loop tries to blow up. Replaces
        // the pre-2026-04-23 hard-clip at ±1.8 which was non-canonical
        // per the Geraint Luff FDN reference.
        //
        // Threshold T=2.0 (raised from 0.95 on 2026-04-23): FDN internal
        // channel levels legitimately peak at 1.5–3.0 during transient
        // buildup before Hadamard redistributes energy across channels —
        // that's normal and musical per JOS PASP § FDN + Luff's recipe.
        // Clamping at 0.95 was audibly intruding on dense material at
        // 100% mix ("touch of distortion"). T=2.0 is still more
        // conservative than the ±1.8 hard-clip it replaced (smooth tanh
        // instead of sharp clip) while staying clear of normal operating
        // range. FDN stability is already guaranteed by unitary Hadamard
        // + per-channel decay < 1; this clamp is a pure safety net for
        // pathological DC/denormal edge cases. Retires FdnHall leg of
        // EFL-SB-03.
        {
          const T = 2.0;
          const u = fb_sig / T;
          const ua = u < -3 ? -3 : u > 3 ? 3 : u;
          fb_sig = T * (ua * (27 + ua * ua)) / (27 + 9 * ua * ua);
        }
        const flen = fb[c].length;
        const fwi  = fi[c];
        fb[c][fwi] = bl[c] + fb_sig;
        fi[c] = fwi + 1 < flen ? fwi + 1 : 0;
      }

      // 8ch → stereo + ER
      let wL = (del[0] + del[2] + del[4] + del[6]) * 0.25 + erL;
      let wR = (del[1] + del[3] + del[5] + del[7]) * 0.25 + erR;

      oL[n] = dL * dryCoeff + wL * wetCoeff;
      oR[n] = dR * dryCoeff + wR * wetCoeff;

      // Safety soft-clip
      if (oL[n] >  0.98 || oL[n] < -0.98) oL[n] = Math.tanh(oL[n] * 0.95);
      if (oR[n] >  0.98 || oR[n] < -0.98) oR[n] = Math.tanh(oR[n] * 0.95);
    }
    return true;
  }
}

registerProcessor('sandbox-fdn-reverb', SandboxFdnReverb);

// ---------------------------------------------------------------------
//  sandbox-tape-air9 — Airwindows ToTape9 faithful mono port.
// ---------------------------------------------------------------------
//
// Mirrors src/sandbox/ops/op_tapeAir9.worklet.js (the standalone class
// version used by the headless math harness). This inline copy is what
// the WebAudio compiler instantiates as an AudioWorkletNode for live
// sandbox bricks. Same pipeline, same constants, k-rate params.
//
// 11-stage pipeline (verbatim ToTape9 math, MIT license, Chris Johnson):
//   input gain → dubly encode → flutter → bias/slew chain (9 thresholds,
//   golden-ratio spaced) → tiny hysteresis → pre-averaging cascade →
//   Taylor-sin saturator (clamp ±2.305929007734908, 5 verbatim coefs)
//   → post-averaging cascade → head-bump dual biquad (tan-K, golden-
//   ratio reso) → dubly decode → output gain.
//
// Params (all k-rate, normalized 0..1):
//   drive        A (input gain → (A·2)²)
//   dubly        B (encode/decode depth)
//   encCross     C (Dubly IIR crossover freq)
//   flutterDepth D (pow(D,6)·overallscale·50 samples)
//   flutterRate  E (0.02·D³ / overallscale)
//   bias         F ((F·2)-1 → ±1 bias offset)
//   bumpMix      G (head-bump wet amount)
//   bumpHz       H ((H²·175+25) Hz / sr)
//
// Skipped from full ToTape9 (live elsewhere in catalog):
//   ClipOnly3 post-limiter (use op #88 softLimit downstream)
//   Noise-shape dither    (use op #114 noiseShaper downstream)

class SandboxTapeAir9 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const def = (name, defaultValue) => ({
      name, defaultValue, minValue: 0, maxValue: 1, automationRate: 'k-rate',
    });
    return [
      def('drive',        0.5),
      def('dubly',        0.5),
      def('encCross',     0.5),
      def('flutterDepth', 0.0),
      def('flutterRate',  0.5),
      def('bias',         0.5),
      def('bumpMix',      0.25),
      def('bumpHz',       0.5),
    ];
  }

  constructor() {
    super();
    this.overallscale = sampleRate / 44100;
    this.slewsing = Math.floor(this.overallscale * 2);
    if (this.slewsing < 2)  this.slewsing = 2;
    if (this.slewsing > 32) this.slewsing = 32;

    this._d = new Float32Array(1002);
    this._gcount = 0;
    this._sweep = 0;
    this._nextmax = 0.5;
    this._fpd = 17;

    this._iirEnc = 0; this._avgEnc = 0; this._compEnc = 0;
    this._iirDec = 0; this._avgDec = 0; this._compDec = 0;

    this._gsPrev   = new Float64Array(9);
    this._gsThresh = new Float64Array(9);

    this._hyst = 0;

    this._avg2  = new Float64Array(2);
    this._avg4  = new Float64Array(4);
    this._avg8  = new Float64Array(8);
    this._avg16 = new Float64Array(16);
    this._avg32 = new Float64Array(32);
    this._post2  = new Float64Array(2);
    this._post4  = new Float64Array(4);
    this._post8  = new Float64Array(8);
    this._post16 = new Float64Array(16);
    this._post32 = new Float64Array(32);
    this._avgPos = 0;
    this._lastDark = 0;

    this._hbSample = 0;
    this._hdbA = { a0: 0, a1: 0, a2: 0, b1: 0, b2: 0, s1: 0, s2: 0 };
    this._hdbB = { a0: 0, a1: 0, a2: 0, b1: 0, b2: 0, s1: 0, s2: 0 };

    this._lastBumpHz = -1;
  }

  _recomputeBiquads(H) {
    const INV_PHI = 0.618033988749894848;
    const freqA = ((H * H) * 175 + 25) / sampleRate;
    const freqB = freqA * 0.9375;
    const reso  = INV_PHI;
    const setBiquad = (biq, freq) => {
      const K = Math.tan(Math.PI * freq);
      const norm = 1 / (1 + K / reso + K * K);
      biq.a0 = (K / reso) * norm;
      biq.a1 = 0;
      biq.a2 = -biq.a0;
      biq.b1 = 2 * (K * K - 1) * norm;
      biq.b2 = (1 - K / reso + K * K) * norm;
    };
    setBiquad(this._hdbA, freqA);
    setBiquad(this._hdbB, freqB);
  }

  process(inputs, outputs, params) {
    const TWO_PI = Math.PI * 2;
    const PHI    = 1.618033988749894848;
    const DENORMAL = 1e-30;

    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const oBuf = out[0];
    const N = oBuf.length;

    const inp = inputs[0];
    const iBuf = (inp && inp.length > 0) ? inp[0] : null;

    const A = params.drive[0],        B = params.dubly[0];
    const C = params.encCross[0],     D = params.flutterDepth[0];
    const E = params.flutterRate[0],  F = params.bias[0];
    const G = params.bumpMix[0],      H = params.bumpHz[0];

    if (H !== this._lastBumpHz) {
      this._recomputeBiquads(H);
      this._lastBumpHz = H;
    }

    const ovs = this.overallscale;
    const slewsing = this.slewsing;

    const inputGain  = (A * 2) * (A * 2);
    const outputGain = inputGain * 2;
    const dublyAmount = B * 2;
    let outlyAmount = (1 - B) * -2;
    if (outlyAmount < -1) outlyAmount = -1;
    const iirEncFreq = (1 - C) / ovs;
    const iirDecFreq = C / ovs;

    let flutDepth = Math.pow(D, 6) * ovs * 50;
    if (flutDepth > 498) flutDepth = 498;
    const flutFrequency = (0.02 * Math.pow(E, 3)) / ovs;

    const bias = (F * 2) - 1;
    let underBias = (Math.pow(bias, 4) * 0.25) / ovs;
    let overBias  = Math.pow(1 - bias, 3) / ovs;
    if (bias > 0) underBias = 0;
    if (bias < 0) overBias  = 1 / ovs;

    let ob = overBias;
    for (let i = 8; i >= 0; i--) { this._gsThresh[i] = ob; ob *= PHI; }

    const headBumpDrive = (G * 0.1) / ovs;
    const headBumpMix   = G * 0.5;
    const cubicClipK = 0.0618 / Math.sqrt(ovs);

    const d = this._d;
    let gcount = this._gcount, sweep = this._sweep, nextmax = this._nextmax;
    let fpd = this._fpd >>> 0;
    let iirEnc = this._iirEnc, avgEnc = this._avgEnc, compEnc = this._compEnc;
    let iirDec = this._iirDec, avgDec = this._avgDec, compDec = this._compDec;
    const gsPrev = this._gsPrev, gsThresh = this._gsThresh;
    let hyst = this._hyst;
    const avg2 = this._avg2, avg4 = this._avg4, avg8 = this._avg8;
    const avg16 = this._avg16, avg32 = this._avg32;
    const post2 = this._post2, post4 = this._post4, post8 = this._post8;
    const post16 = this._post16, post32 = this._post32;
    let avgPos = this._avgPos;
    let lastDark = this._lastDark;
    let hb = this._hbSample;
    const hA = this._hdbA, hB = this._hdbB;

    for (let n = 0; n < N; n++) {
      let x = iBuf ? +iBuf[n] : 0;
      if (Math.abs(x) < 1.18e-23) x = fpd * 1.18e-17 / 0x100000000;
      if (inputGain !== 1) x *= inputGain;

      // (1) Dubly encode
      if (B > 0) {
        iirEnc = (iirEnc * (1 - iirEncFreq)) + (x * iirEncFreq);
        let highPart = (x - iirEnc) * 2.848;
        highPart += avgEnc;
        avgEnc = (x - iirEnc) * 1.152;
        if (highPart >  1) highPart =  1;
        if (highPart < -1) highPart = -1;
        let dub = Math.abs(highPart);
        if (dub > 0) {
          const adj = Math.log(1 + 255 * dub) / 2.40823996531;
          if (adj > 0) dub /= adj;
          compEnc = (compEnc * (1 - iirEncFreq)) + (dub * iirEncFreq);
          x += (highPart * compEnc) * dublyAmount;
        }
      }

      // (2) Flutter
      if (flutDepth > 0) {
        if (gcount < 0 || gcount > 999) gcount = 999;
        d[gcount] = x;
        let count = gcount;
        const offset = flutDepth + (flutDepth * Math.sin(sweep));
        sweep += nextmax * flutFrequency;
        if (sweep > TWO_PI) {
          sweep -= TWO_PI;
          const flutA = 0.24 + (fpd / 0xFFFFFFFF) * 0.74;
          fpd ^= fpd << 13; fpd >>>= 0;
          fpd ^= fpd >>> 17;
          fpd ^= fpd << 5;  fpd >>>= 0;
          const flutB = 0.24 + (fpd / 0xFFFFFFFF) * 0.74;
          const target = Math.sin(sweep + nextmax);
          nextmax = (Math.abs(flutA - target) < Math.abs(flutB - target)) ? flutA : flutB;
        }
        count += Math.floor(offset);
        const frac = offset - Math.floor(offset);
        const i0 = count - (count > 999 ? 1000 : 0);
        const i1 = (count + 1) - ((count + 1) > 999 ? 1000 : 0);
        x  = d[i0] * (1 - frac);
        x += d[i1] * frac;
        gcount--;
      }

      // (3) Bias/slew chain
      if (Math.abs(bias) > 0.001) {
        for (let k = 0; k < 9; k++) {
          const prev = gsPrev[k];
          const th   = gsThresh[k];
          if (underBias > 0) {
            const stuck = Math.abs(x - (prev / 0.975)) / underBias;
            if (stuck < 1) x = (x * stuck) + ((prev / 0.975) * (1 - stuck));
          }
          if ((x - prev) >  th) x = prev + th;
          if (-(x - prev) > th) x = prev - th;
          gsPrev[k] = x * 0.975;
        }
      }

      // (4) Tiny hysteresis
      const ax = Math.abs(x);
      const apply = (1 - ax) * (1 - ax) * 0.012;
      hyst = Math.max(Math.min(hyst + (x * ax), 0.011449), -0.011449) * 0.999;
      x += hyst * apply;

      // (5) Pre-averaging cascade
      let dark = x;
      let posCap = avgPos; if (posCap > 31) posCap = 0;
      if (slewsing > 31) {
        avg32[posCap] = dark; let s = 0;
        for (let k = 0; k < 32; k++) s += avg32[k]; dark = s / 32;
      }
      if (slewsing > 15) {
        avg16[posCap % 16] = dark; let s = 0;
        for (let k = 0; k < 16; k++) s += avg16[k]; dark = s / 16;
      }
      if (slewsing > 7) {
        avg8[posCap % 8] = dark; let s = 0;
        for (let k = 0; k < 8; k++) s += avg8[k]; dark = s / 8;
      }
      if (slewsing > 3) {
        avg4[posCap % 4] = dark; let s = 0;
        for (let k = 0; k < 4; k++) s += avg4[k]; dark = s / 4;
      }
      if (slewsing > 1) {
        avg2[posCap % 2] = dark; let s = 0;
        for (let k = 0; k < 2; k++) s += avg2[k]; dark = s / 2;
      }
      let avgSlew = Math.min(Math.abs(lastDark - x) * 0.12 * ovs, 1);
      avgSlew = 1 - (1 - avgSlew * 1 - avgSlew);
      x = (x * (1 - avgSlew)) + (dark * avgSlew);
      lastDark = dark;

      // (6) Taylor-sin saturator (verbatim Airwindows coefs)
      if (x >  2.305929007734908) x =  2.305929007734908;
      if (x < -2.305929007734908) x = -2.305929007734908;
      const xx = x * x;
      let emp = x * xx;        x -= emp / 6.0;
      emp *= xx;               x += emp / 69.0;
      emp *= xx;               x -= emp / 2530.08;
      emp *= xx;               x += emp / 224985.6;
      emp *= xx;               x -= emp / 9979200.0;

      // (7) Post-averaging cascade
      dark = x;
      posCap = avgPos; if (posCap > 31) posCap = 0;
      if (slewsing > 31) {
        post32[posCap] = dark; let s = 0;
        for (let k = 0; k < 32; k++) s += post32[k]; dark = s / 32;
      }
      if (slewsing > 15) {
        post16[posCap % 16] = dark; let s = 0;
        for (let k = 0; k < 16; k++) s += post16[k]; dark = s / 16;
      }
      if (slewsing > 7) {
        post8[posCap % 8] = dark; let s = 0;
        for (let k = 0; k < 8; k++) s += post8[k]; dark = s / 8;
      }
      if (slewsing > 3) {
        post4[posCap % 4] = dark; let s = 0;
        for (let k = 0; k < 4; k++) s += post4[k]; dark = s / 4;
      }
      if (slewsing > 1) {
        post2[posCap % 2] = dark; let s = 0;
        for (let k = 0; k < 2; k++) s += post2[k]; dark = s / 2;
      }
      avgPos++;
      x = (x * (1 - avgSlew)) + (dark * avgSlew);

      // (8) Head-bump dual biquad
      let hbOut = 0;
      if (headBumpMix > 0) {
        hb += x * headBumpDrive;
        hb -= (hb * hb * hb) * cubicClipK;
        const yA = hA.a0 * hb + hA.s1;
        hA.s1 = hA.a1 * hb - hA.b1 * yA + hA.s2;
        hA.s2 = hA.a2 * hb - hA.b2 * yA;
        const yB = hB.a0 * yA + hB.s1;
        hB.s1 = hB.a1 * yA - hB.b1 * yB + hB.s2;
        hB.s2 = hB.a2 * yA - hB.b2 * yB;
        hbOut = yB;
      }
      x += hbOut * headBumpMix;

      // (9) Dubly decode
      if (B > 0) {
        iirDec = (iirDec * (1 - iirDecFreq)) + (x * iirDecFreq);
        let highPart = (x - iirDec) * 2.628;
        highPart += avgDec;
        avgDec = (x - iirDec) * 1.372;
        if (highPart >  1) highPart =  1;
        if (highPart < -1) highPart = -1;
        let dub = Math.abs(highPart);
        if (dub > 0) {
          const adj = Math.log(1 + 255 * dub) / 2.40823996531;
          if (adj > 0) dub /= adj;
          compDec = (compDec * (1 - iirDecFreq)) + (dub * iirDecFreq);
          x += (highPart * compDec) * outlyAmount;
        }
      }

      // (10) Output gain
      if (outputGain !== 1) x *= outputGain;
      if (Math.abs(x) < DENORMAL) x = 0;
      if (!Number.isFinite(x)) x = 0;
      oBuf[n] = x;
    }

    const flush = (v) => (Math.abs(v) < DENORMAL ? 0 : v);
    this._gcount = gcount; this._sweep = sweep; this._nextmax = nextmax;
    this._fpd = fpd >>> 0;
    this._iirEnc = flush(iirEnc); this._avgEnc = flush(avgEnc); this._compEnc = flush(compEnc);
    this._iirDec = flush(iirDec); this._avgDec = flush(avgDec); this._compDec = flush(compDec);
    this._hyst = flush(hyst);
    this._avgPos = avgPos;
    this._lastDark = flush(lastDark);
    this._hbSample = flush(hb);
    hA.s1 = flush(hA.s1); hA.s2 = flush(hA.s2);
    hB.s1 = flush(hB.s1); hB.s2 = flush(hB.s2);
    return true;
  }
}

registerProcessor('sandbox-tape-air9', SandboxTapeAir9);

// ---------------------------------------------------------------------
//  sandbox-pitch-shift — Bernsee smbPitchShift mono port (catalog #28).
// ---------------------------------------------------------------------
//
// Streaming phase-vocoder pitch shifter — FFT_SIZE=2048, OSAMP=4,
// stepSize=512, latency=1536 samples (~32 ms @ 48 kHz). Verbatim port
// of Stephan Bernsee's smbPitchShift.cpp (1999-2015, free use license).
// Mirrors src/sandbox/ops/op_pitchShift.worklet.js bit-for-bit; this
// is the inline copy the WebAudio compiler instantiates for live
// sandbox bricks (shimmer delays, shifters, etc.).
//
// Pipeline: input FIFO → Hann-windowed FFT → magn/freq analysis →
//           bin-shift (k → ⌊k·pitch⌋) → phase-coherent resynth →
//           inverse FFT → OLA → output FIFO.
//
// Params (k-rate):
//   pitch  0.25..4.0  ratio (1.0 = unison, 2.0 = +1 oct, 0.5 = -1 oct)
//   mix    0..1       equal-power dry/wet inside the op

class SandboxPitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1.0, minValue: 0.25, maxValue: 4.0, automationRate: 'k-rate' },
      { name: 'mix',   defaultValue: 1.0, minValue: 0.0,  maxValue: 1.0, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    const FFT_SIZE = 2048;
    const OSAMP = 4;
    const STEP_SIZE = FFT_SIZE / OSAMP;
    const LATENCY = FFT_SIZE - STEP_SIZE;
    const TWO_PI = Math.PI * 2;
    this._FFT_SIZE = FFT_SIZE;
    this._FFT_SIZE_2 = FFT_SIZE / 2;
    this._OSAMP = OSAMP;
    this._STEP_SIZE = STEP_SIZE;
    this._LATENCY = LATENCY;
    this._TWO_PI = TWO_PI;
    this._EXPCT = TWO_PI * STEP_SIZE / FFT_SIZE;

    this._WINDOW = new Float64Array(FFT_SIZE);
    for (let k = 0; k < FFT_SIZE; k++) {
      this._WINDOW[k] = -0.5 * Math.cos(TWO_PI * k / FFT_SIZE) + 0.5;
    }

    this.freqPerBin = sampleRate / FFT_SIZE;

    this._inFIFO    = new Float64Array(FFT_SIZE);
    this._outFIFO   = new Float64Array(FFT_SIZE);
    this._fft       = new Float64Array(2 * FFT_SIZE);
    this._lastPhase = new Float64Array(this._FFT_SIZE_2 + 1);
    this._sumPhase  = new Float64Array(this._FFT_SIZE_2 + 1);
    this._outAccum  = new Float64Array(2 * FFT_SIZE);
    this._anaFreq   = new Float64Array(FFT_SIZE);
    this._anaMagn   = new Float64Array(FFT_SIZE);
    this._synFreq   = new Float64Array(FFT_SIZE);
    this._synMagn   = new Float64Array(FFT_SIZE);
    this._rover     = LATENCY;
  }

  // In-place radix-2 Cooley-Tukey FFT. buf interleaved re/im, length 2*N.
  // sign=-1 forward, +1 inverse. Verbatim Bernsee smbFft.
  _smbFft(buf, N, sign) {
    for (let i = 2, j = 0; i < 2 * N - 2; i += 2) {
      let bitm = N;
      for (; bitm >= 2; bitm >>= 1) {
        if (!(j & bitm)) break;
        j ^= bitm;
      }
      j ^= bitm;
      if (i < j) {
        let t = buf[i];     buf[i]     = buf[j];     buf[j]     = t;
        t     = buf[i + 1]; buf[i + 1] = buf[j + 1]; buf[j + 1] = t;
      }
    }
    const kMax = Math.log(N) / Math.log(2);
    for (let k = 0, le = 2; k < kMax; k++) {
      le <<= 1;
      const le2 = le >> 1;
      let ur = 1.0, ui = 0.0;
      const arg = Math.PI / (le2 >> 1);
      const wr  = Math.cos(arg);
      const wi  = sign * Math.sin(arg);
      for (let j = 0; j < le2; j += 2) {
        for (let i = j; i < 2 * N; i += le) {
          const tr = buf[i + le2]     * ur - buf[i + le2 + 1] * ui;
          const ti = buf[i + le2]     * ui + buf[i + le2 + 1] * ur;
          buf[i + le2]     = buf[i]     - tr;
          buf[i + le2 + 1] = buf[i + 1] - ti;
          buf[i]           = buf[i]     + tr;
          buf[i + 1]       = buf[i + 1] + ti;
        }
        const tr = ur * wr - ui * wi;
        ui       = ur * wi + ui * wr;
        ur       = tr;
      }
    }
  }

  _processFrame(pitch) {
    const FFT_SIZE = this._FFT_SIZE;
    const FFT_SIZE_2 = this._FFT_SIZE_2;
    const OSAMP = this._OSAMP;
    const STEP_SIZE = this._STEP_SIZE;
    const TWO_PI = this._TWO_PI;
    const EXPCT = this._EXPCT;
    const WINDOW = this._WINDOW;

    const fft       = this._fft;
    const inFIFO    = this._inFIFO;
    const lastPhase = this._lastPhase;
    const sumPhase  = this._sumPhase;
    const outAccum  = this._outAccum;
    const anaFreq   = this._anaFreq;
    const anaMagn   = this._anaMagn;
    const synFreq   = this._synFreq;
    const synMagn   = this._synMagn;
    const freqPerBin = this.freqPerBin;

    for (let k = 0; k < FFT_SIZE; k++) {
      fft[2 * k]     = inFIFO[k] * WINDOW[k];
      fft[2 * k + 1] = 0;
    }
    this._smbFft(fft, FFT_SIZE, -1);

    for (let k = 0; k <= FFT_SIZE_2; k++) {
      const real = fft[2 * k];
      const imag = fft[2 * k + 1];
      const magn = 2.0 * Math.sqrt(real * real + imag * imag);
      const phase = Math.atan2(imag, real);
      let tmp = phase - lastPhase[k];
      lastPhase[k] = phase;
      tmp -= k * EXPCT;
      let qpd = tmp / Math.PI | 0;
      if (qpd >= 0) qpd += qpd & 1;
      else          qpd -= qpd & 1;
      tmp -= Math.PI * qpd;
      tmp = OSAMP * tmp / TWO_PI;
      tmp = k * freqPerBin + tmp * freqPerBin;
      anaMagn[k] = magn;
      anaFreq[k] = tmp;
    }

    synMagn.fill(0, 0, FFT_SIZE);
    synFreq.fill(0, 0, FFT_SIZE);
    for (let k = 0; k <= FFT_SIZE_2; k++) {
      const index = Math.floor(k * pitch);
      if (index <= FFT_SIZE_2) {
        synMagn[index] += anaMagn[k];
        synFreq[index]  = anaFreq[k] * pitch;
      }
    }

    for (let k = 0; k <= FFT_SIZE_2; k++) {
      const magn = synMagn[k];
      let tmp = synFreq[k];
      tmp -= k * freqPerBin;
      tmp /= freqPerBin;
      tmp = TWO_PI * tmp / OSAMP;
      tmp += k * EXPCT;
      sumPhase[k] += tmp;
      const phase = sumPhase[k];
      fft[2 * k]     = magn * Math.cos(phase);
      fft[2 * k + 1] = magn * Math.sin(phase);
    }
    for (let k = FFT_SIZE + 2; k < 2 * FFT_SIZE; k++) fft[k] = 0;

    this._smbFft(fft, FFT_SIZE, 1);

    const olaScale = 2.0 / (FFT_SIZE_2 * OSAMP);
    for (let k = 0; k < FFT_SIZE; k++) {
      outAccum[k] += olaScale * WINDOW[k] * fft[2 * k];
    }

    const outFIFO = this._outFIFO;
    for (let k = 0; k < STEP_SIZE; k++) outFIFO[k] = outAccum[k];

    outAccum.copyWithin(0, STEP_SIZE);
    for (let k = FFT_SIZE; k < 2 * FFT_SIZE; k++) outAccum[k] = 0;
    inFIFO.copyWithin(0, STEP_SIZE);
  }

  process(inputs, outputs, params) {
    const DENORMAL = 1e-30;
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const oBuf = out[0];
    const N = oBuf.length;
    const inp = inputs[0];
    const iBuf = (inp && inp.length > 0) ? inp[0] : null;

    let pitch = params.pitch[0];
    if (!Number.isFinite(pitch)) pitch = 1.0;
    if (pitch < 0.25) pitch = 0.25;
    if (pitch > 4.0)  pitch = 4.0;

    const mix = params.mix[0];
    const gDry = Math.cos(mix * Math.PI * 0.5);
    const gWet = Math.sin(mix * Math.PI * 0.5);

    const FFT_SIZE = this._FFT_SIZE;
    const LATENCY = this._LATENCY;

    for (let i = 0; i < N; i++) {
      const x = iBuf ? iBuf[i] : 0;
      this._inFIFO[this._rover] = x;
      let y = this._outFIFO[this._rover - LATENCY];
      if (y > -DENORMAL && y < DENORMAL) y = 0;
      oBuf[i] = gDry * x + gWet * y;
      this._rover++;
      if (this._rover >= FFT_SIZE) {
        this._rover = LATENCY;
        this._processFrame(pitch);
      }
    }
    return true;
  }
}

registerProcessor('sandbox-pitch-shift', SandboxPitchShift);

// ---------------------------------------------------------------------
//  sandbox-pingpong — equal-level stereo ping-pong (mono-in, stereo-out).
// ---------------------------------------------------------------------
//
// Single mono delay buffer with TWO staggered read taps:
//   readR at -TIME/2  (half-delay tap → R speaker)
//   readL at -TIME    (full-delay tap → L speaker)
//
// A pulse fires R at TIME/2, L at TIME, R at 3·TIME/2, L at 2·TIME, …
// Both taps come from the same buffer at the SAME amplitude per cycle,
// so the bounce is properly balanced L/R — no "stuck-on-one-side" feel
// the asymmetric cross-coupled topology has.
//
// Feedback is tapped from the long (L) read and fed back into the
// buffer write. Built-in one-pole LP "tone" filter on the FB tap so
// repeats progressively darken (Space Echo / TimeLine character).
// Frequency-dependent loop loss also bounds FB — Nyquist-stable for
// fb < 1.
//
// SPREAD knob blends wet output between full ping-pong (1.0) and
// mono-summed wet (0.0). At spread=0 the bounce still happens but you
// hear the L+R wet summed equally on both speakers — useful for
// in-the-mix ping-pong without hard L/R panning.
//
// TIME = bounce-to-bounce interval (R→L spacing). Full L→L round trip
// is 2·TIME. Buffer is sized for max round-trip 4 s (= 2·max TIME).
//
// Latency: zero.
//
// Params (all k-rate):
//   time      ms    10..2000   (R/L stagger interval)
//   feedback        0..0.85
//   tone      Hz    200..18000  (LP cutoff inside loop)
//   spread          0..1        (0 = mono wet, 1 = full ping-pong)
//   mix             0..1

class SandboxPingPong extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time',     defaultValue: 350,   minValue: 10,  maxValue: 2000,  automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.5,   minValue: 0,   maxValue: 0.85,  automationRate: 'k-rate' },
      { name: 'tone',     defaultValue: 4500,  minValue: 200, maxValue: 18000, automationRate: 'k-rate' },
      { name: 'spread',   defaultValue: 1.0,   minValue: 0,   maxValue: 1,     automationRate: 'k-rate' },
      { name: 'mix',      defaultValue: 0.5,   minValue: 0,   maxValue: 1,     automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    // Buffer must hold the long (L) tap = 2× max TIME = 4 s @ max 2000ms.
    // Add a margin for the smoother + interpolation read.
    this._MAX = Math.ceil(4.5 * sampleRate);
    this._buf = new Float32Array(this._MAX);
    this._write = 0;
    this._lp = 0;
    this._delaySamplesSmooth = -1;
  }

  process(inputs, outputs, params) {
    const DENORMAL = 1e-30;
    const out = outputs[0];
    if (!out || out.length === 0) return true;

    const oL = out[0];
    const oR = out.length > 1 ? out[1] : out[0];
    const N = oL.length;

    const inp = inputs[0];
    const iL = (inp && inp.length > 0) ? inp[0] : null;
    const iR = (inp && inp.length > 1) ? inp[1] : iL;

    const timeMs = params.time[0];
    const fb     = params.feedback[0];
    const toneHz = params.tone[0];
    const spread = params.spread[0];
    const mix    = params.mix[0];

    // TIME = R/L stagger interval. R reads at -TIME, L reads at -2·TIME.
    let target = Math.max(1, timeMs * sampleRate * 0.001);
    const targetL = target * 2;
    if (targetL >= this._MAX - 4) target = (this._MAX - 4) * 0.5;

    if (this._delaySamplesSmooth < 0) this._delaySamplesSmooth = target;

    const smoothCoef = 1 - Math.exp(-1 / (0.05 * sampleRate));
    const alpha = 1 - Math.exp(-2 * Math.PI * toneHz / sampleRate);
    const dryGain = Math.cos(mix * Math.PI * 0.5);
    const wetGain = Math.sin(mix * Math.PI * 0.5);

    let lp = this._lp;
    let w = this._write;
    let dSmooth = this._delaySamplesSmooth;
    const MAX = this._MAX;
    const buf = this._buf;

    // Linear-interpolated read helper.
    const read = (offset) => {
      let rf = w - offset;
      while (rf < 0) rf += MAX;
      while (rf >= MAX) rf -= MAX;
      const r0 = Math.floor(rf);
      const r1 = (r0 + 1) % MAX;
      return buf[r0] * (1 - (rf - r0)) + buf[r1] * (rf - r0);
    };

    for (let i = 0; i < N; i++) {
      dSmooth += smoothCoef * (target - dSmooth);

      const inL = iL ? iL[i] : 0;
      const inR = iR ? iR[i] : 0;
      const inMono = (inL + inR) * 0.5;

      // R tap at -TIME, L tap at -2·TIME.
      const wetR = read(dSmooth);
      const wetL = read(dSmooth * 2);

      // LP tone-filter on the FB tap (uses long L tap, the loop point).
      lp += alpha * (wetL - lp);

      // Write input + LP-filtered FB.
      let next = inMono + lp * fb;
      if (next >  1.5) next =  1.5;
      if (next < -1.5) next = -1.5;

      buf[w] = next;
      w++;
      if (w >= MAX) w -= MAX;

      // SPREAD blends wet between full L/R (1) and mono-summed (0).
      const wetMid = (wetL + wetR) * 0.5;
      const finalWetL = wetL * spread + wetMid * (1 - spread);
      const finalWetR = wetR * spread + wetMid * (1 - spread);

      let yL = inL * dryGain + finalWetL * wetGain;
      let yR = inR * dryGain + finalWetR * wetGain;
      if (Math.abs(yL) < DENORMAL) yL = 0;
      if (Math.abs(yR) < DENORMAL) yR = 0;
      oL[i] = yL;
      oR[i] = yR;
    }

    this._lp = (Math.abs(lp) < DENORMAL) ? 0 : lp;
    this._write = w;
    this._delaySamplesSmooth = dSmooth;
    return true;
  }
}

registerProcessor('sandbox-pingpong', SandboxPingPong);
`;
