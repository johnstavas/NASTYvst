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
      // mod stops cleanly when the brick is silent.
      for (let i = 0; i < N; i++) {
        s = relA * s; // target = 0 → s = relA*s + (1-relA)*0
        const amt = amtIsArr ? amtArr[i] : amtArr[0];
        const off = offIsArr ? offArr[i] : offArr[0];
        outCh[i] = s * amt + off;
      }
    } else {
      for (let i = 0; i < N; i++) {
        // Defensive rectification — detector op normally handles this.
        const target = inCh[i] < 0 ? -inCh[i] : inCh[i];
        const a = (target > s) ? atkA : relA;
        s = a * s + (1 - a) * target;
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
`;
