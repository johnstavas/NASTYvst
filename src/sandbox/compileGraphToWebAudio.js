// Graph → WebAudio compiler — Step 2c of sandbox core.
// See memory/sandbox_core_scope.md.
//
// Takes a sandbox graph (mockGraphs.js schema) and turns it into a live
// WebAudio sub-graph using vanilla nodes (GainNode / BiquadFilterNode /
// DelayNode / WaveShaperNode). Returns:
//
//   {
//     inputNode,     // pass into chain[i-1] → here
//     outputNode,    // here → chain[i+1] (summed wet+dry, bypass-aware)
//     setParam(nodeId, paramId, value),  // live param update
//     setBypass(on, tcMs?),              // brick-level bypass (default 5 ms ramp)
//     dispose(),     // disconnects + drops all node references
//   }
//
// Bypass topology (owned here, not per-brick):
//   inputNode ──┬─▶ (graph…) ──▶ wetOutputNode ──▶ wetMute ──┐
//               │                                             ├──▶ outputNode
//               └────────────────▶ bypassPath ────────────────┘
//   setBypass(on): wetMute→(on?0:1), bypassPath→(on?1:0) with setTargetAtTime.
//   This is the canonical fix for ST-SB-02 and its siblings. Every brick
//   inherits correct bypass for free; per-brick code must NOT re-roll this.
//
// What this proves:
//   - The op registry (declarative DSP description) drives audio.
//   - Param mutation flows graph.json → setParam → WebAudio AudioParam.
//   - The same graph data drives both audio (here) and the brick-zoom
//     visual (OpGraphCanvas). One source of truth.
//
// What this is NOT:
//   - Not a worklet. WebAudio nodes only. Audio quality matches the
//     browser's stock biquad/gain/delay — fine for a toy brick, will be
//     replaced by master-worklet codegen in a future step.
//   - Not safe against feedback cycles in the wire graph. The Step 2c
//     toy is feed-forward only; cycles will land with the codegen path.
//   - No envelope op yet (no audio-domain consumer in MVP toy). Stub
//     entry exists so a future op can hook a control input.

import { getOp } from './opRegistry';
import { validateGraph } from './validateGraph';
import { isSandboxWorkletReady } from './workletLoader';

// ── AudioParam._set helper ────────────────────────────────────────────
// Every factory writes params via `param._set(v, t, tau)`. The helper
// branches on a module-level flag:
//   _directMode = true  → setValueAtTime(v, 0)        (compile-time init)
//   _directMode = false → setTargetAtTime(v, t, tau)  (live UI writes)
//
// Why: setTargetAtTime at compile time leaves a ~5×tau exponential ramp
// at render start, which defeats the null-test harness and causes an
// audible spectral transient on brick instantiation. Initial writes must
// land before sample 0. Live knob moves keep smoothing to prevent zipper.
let _directMode = false;
(function installAudioParamSet() {
  if (typeof AudioParam === 'undefined') return;
  if (AudioParam.prototype._set) return;
  AudioParam.prototype._set = function (v, t, tau) {
    if (_directMode) this.setValueAtTime(v, 0);
    else             this.setTargetAtTime(v, t, tau);
  };
})();

/** Strip optional ".port" suffix → { id, port } */
function splitRef(ref) {
  const s = String(ref);
  const dot = s.indexOf('.');
  if (dot < 0) return { id: s, port: null };
  return { id: s.slice(0, dot), port: s.slice(dot + 1) };
}

const dbToLin = (db) => Math.pow(10, db / 20);

/** Build a WaveShaper curve — Padé rational tanh (canon:character §11).
 *
 *  Pre-gained by `drive`, then passed through Padé `x(27+x²)/(27+9x²)`
 *  which is C² continuous on [-3, 3] with hard-clip beyond. Identical
 *  shape to `Math.tanh` within ~2.6% error but canon-aligned so the
 *  eventual master-worklet codegen can lift this verbatim.
 *
 *  Output is normalized so the curve hits ±1 at the drive boundaries
 *  (i.e. whatever `drive` input would saturate, we scale to unity).
 */
function makeSatCurve(drive) {
  const N = 2048;
  const c = new Float32Array(N);
  const k = drive;
  // Normalization: what does Padé return at x=k? Scale so that maps to 1.
  const clamp = (x) => x < -3 ? -1 : x > 3 ? 1 : (x * (27 + x*x)) / (27 + 9*x*x);
  const norm  = 1 / Math.max(1e-6, clamp(k));
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    c[i] = clamp(k * x) * norm;
  }
  return c;
}

/** Per-op factory: creates the AudioNode(s), returns the compiled
 *  instance with `inputs` (port→AudioNode) / `outputs` (port→AudioNode)
 *  and a `setParam(paramId, value, atTime)` function. */
const FACTORIES = {
  gain(ctx, params) {
    // The `gainMod` control input exposes `g.gain` (the AudioParam). Anything
    // connected there is *summed* into the linear gain value — classic WebAudio
    // param automation. Leave unwired for static gain behavior.
    const g = ctx.createGain();
    g.gain.value = dbToLin(params.gainDb ?? 0);
    return {
      nodes: [g],
      inputs:  { in:  g, gainMod: g.gain },
      outputs: { out: g },
      setParam(id, v, t) {
        if (id === 'gainDb') g.gain._set(dbToLin(v), t, 0.005);
      },
    };
  },

  filter(ctx, params) {
    const f = ctx.createBiquadFilter();
    const setMode = (m) => {
      const map = { lp: 'lowpass', hp: 'highpass', bp: 'bandpass', notch: 'notch' };
      f.type = map[m] || 'lowpass';
    };
    setMode(params.mode ?? 'lp');
    f.frequency.value = params.cutoff ?? 1000;
    f.Q.value         = params.q      ?? 0.707;
    return {
      nodes: [f],
      inputs:  { in:  f },
      outputs: { out: f },
      setParam(id, v, t) {
        if (id === 'mode')   setMode(v);
        if (id === 'cutoff') f.frequency._set(v, t, 0.005);
        if (id === 'q')      f.Q._set(v, t, 0.005);
      },
    };
  },

  // DC trap — BiquadFilterNode in highpass at ~10 Hz, Q=0.707. The
  // browser's native biquad is RBJ-cookbook-canonical (Canon:filters §9)
  // so we lean on it rather than roll a worklet. Q is locked — resonance
  // on a DC trap is never useful. Use on feedback return paths to stop
  // sub-audible DC buildup from self-multiplying into a DC runaway.
  // Soft-limit — tanh saturator wrapped as a limiter rather than a drive
  // stage. The curve is y = threshold * tanhPade(x / threshold):
  //
  //   - Near x=0:      y ≈ x                (unity through linear region)
  //   - At x=threshold: y ≈ 0.76 * threshold (the bend)
  //   - As x → ∞:      y → ±threshold        (the asymptote, no blowup)
  //
  // Drop inline on feedback returns alongside dcBlock. Explicitly NOT a
  // character op — use `saturate` for drive/color. This exists to keep
  // FB loops bounded without the brick-local hard-clip kludge (FDN used
  // to clamp at ±1.8 raw; that's non-canonical per the Luff reference).
  //
  // No oversampling — a limiter only bends when signal is already near/
  // past the threshold, so alias content is small relative to the wet
  // signal. Can be promoted to 4× later if needed; keep it cheap for now.
  softLimit(ctx, params) {
    const ws = ctx.createWaveShaper();
    const buildCurve = (threshold) => {
      const N = 2048;
      const c = new Float32Array(N);
      const t = Math.max(0.01, threshold);
      // Padé tanh on [-3, 3], hard-clip beyond, then scaled by threshold.
      const tanhPade = (u) => (u < -3 ? -1 : u > 3 ? 1 : (u * (27 + u*u)) / (27 + 9*u*u));
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;  // x ∈ [-1, 1]
        c[i] = t * tanhPade(x / t);
      }
      return c;
    };
    ws.curve = buildCurve(params.threshold ?? 0.95);
    return {
      nodes: [ws],
      inputs:  { in:  ws },
      outputs: { out: ws },
      setParam(id, v, _t) {
        if (id === 'threshold') ws.curve = buildCurve(v);
      },
    };
  },

  dcBlock(ctx, params) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = params.cutoff ?? 10;
    f.Q.value = 0.707;
    return {
      nodes: [f],
      inputs:  { in:  f },
      outputs: { out: f },
      setParam(id, v, t) {
        if (id === 'cutoff') f.frequency._set(v, t, 0.005);
      },
    };
  },

  // Shelf EQ — BiquadFilterNode in lowshelf/highshelf mode. Native WebAudio
  // handles the transfer-function math; we just own the mode switching and
  // param writes. Q is stock (0.707) — shelves don't benefit from high Q.
  shelf(ctx, params) {
    const f = ctx.createBiquadFilter();
    const setMode = (m) => { f.type = m === 'high' ? 'highshelf' : 'lowshelf'; };
    setMode(params.mode ?? 'low');
    f.frequency.value = params.freq   ?? 200;
    f.gain.value      = params.gainDb ?? 0;
    return {
      nodes: [f],
      inputs:  { in:  f },
      outputs: { out: f },
      setParam(id, v, t) {
        if (id === 'mode')   setMode(v);
        if (id === 'freq')   f.frequency._set(v, t, 0.005);
        if (id === 'gainDb') f.gain._set(v, t, 0.005);
      },
    };
  },

  delay(ctx, params) {
    // External-feedback delay. Two audio inputs (in + fb) sum into the
    // delay line. `feedback` param scales the fb path; no self-loop is
    // baked in. The `timeMod` control port exposes the delayTime AudioParam
    // directly — anything wired there is summed into the base delay time
    // (in seconds). Typical use: lfo.amount = 0.005 (±5 ms) → lfo → scaleBy
    // → delay.timeMod for drift/flutter modulation.
    const maxDelay = 2.0;
    const d  = ctx.createDelay(maxDelay);
    const sumIn  = ctx.createGain(); // in + fb_scaled → delay line
    const fbGain = ctx.createGain(); // scales external fb-return signal
    sumIn.gain.value  = 1;
    fbGain.gain.value = params.feedback ?? 0.4;
    d.delayTime.value = (params.time ?? 250) / 1000;
    sumIn.connect(d);
    fbGain.connect(sumIn);
    return {
      nodes: [d, sumIn, fbGain],
      inputs:  { in: sumIn, fb: fbGain, timeMod: d.delayTime },
      outputs: { out: d },
      setParam(id, v, t) {
        if (id === 'time')     d.delayTime._set(v / 1000, t, 0.01);
        if (id === 'feedback') fbGain.gain._set(Math.min(0.98, v), t, 0.01);
      },
    };
  },

  mix(ctx, params) {
    // Equal-power crossfade. dry + wet → sum.
    //
    // ⚠️ KNOWN LIMITATION — violates the dry/wet mix rule by construction.
    // Memory `dry_wet_mix_rule.md`: "Mix must be computed INSIDE the DSP
    // core (AudioWorklet), using the same-sample raw input as dry." That's
    // not possible in sandbox preview mode — the wet path is a chain of
    // independently-latent worklets + biquads + waveshapers, so dry and
    // wet pick up different group delays and MIX<100% combs.
    //
    // This op is the best we can do in chain-of-worklets preview mode.
    // The structural fix is Stage-3 master-worklet codegen per roadmap
    // § 1.7 — fuse the whole graph into one worklet where dry=raw-input
    // and wet=same-sample-processed live side by side.
    //
    // Do NOT treat this mix as null-testable. Treat it as "mostly right,
    // phasey at low-mix on resonant or long-latency chains."
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const sum = ctx.createGain();
    const setAmt = (a, t) => {
      const aa = Math.max(0, Math.min(1, a));
      dry.gain._set(Math.cos(aa * Math.PI / 2), t, 0.005);
      wet.gain._set(Math.sin(aa * Math.PI / 2), t, 0.005);
    };
    dry.connect(sum);
    wet.connect(sum);
    setAmt(params.amount ?? 0.5, ctx.currentTime);
    return {
      nodes: [dry, wet, sum],
      inputs:  { dry, wet },
      outputs: { out: sum },
      setParam(id, v, t) {
        if (id === 'amount') setAmt(v, t);
      },
    };
  },

  // Linear multiplier. Single k param → GainNode.gain. Accepts audio OR
  // a control signal. Used to trim mod depth (envelope → scaleBy →
  // gain.gainMod) or as a cheap gain stage without the dB taper.
  scaleBy(ctx, params) {
    const g = ctx.createGain();
    g.gain.value = params.k ?? 1;
    return {
      nodes: [g],
      inputs:  { in:  g },
      outputs: { out: g },
      setParam(id, v, t) {
        if (id === 'k') g.gain._set(v, t, 0.003);
      },
    };
  },

  // Bit-depth quantizer via WaveShaper curve. Builds a staircase curve
  // with 2^bits steps across [-1..1]; the shaper snaps every sample to
  // the nearest step. bits=0 → straight-line identity curve (bypass).
  // Low bit depths produce classic digital "crunch"; 8-bit approximates
  // old samplers, 4-bit goes properly nasty.
  bitcrush(ctx, params) {
    const ws = ctx.createWaveShaper();
    const setBits = (bits) => {
      const b = bits | 0;
      const N = 4096;
      const c = new Float32Array(N);
      if (b <= 0) {
        for (let i = 0; i < N; i++) c[i] = (i / (N - 1)) * 2 - 1;
      } else {
        // 2^(b-1) positive levels + 2^(b-1) negative (signed). Round each
        // curve sample to the nearest quantized level.
        const levels = Math.pow(2, b - 1);
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * 2 - 1;
          c[i] = Math.round(x * levels) / levels;
        }
      }
      ws.curve = c;
    };
    setBits(params.bits ?? 0);
    return {
      nodes: [ws],
      inputs:  { in:  ws },
      outputs: { out: ws },
      setParam(id, v) {
        if (id === 'bits') setBits(v);
      },
    };
  },

  saturate(ctx, params) {
    const pre  = ctx.createGain();   // drive front-end
    const ws   = ctx.createWaveShaper();
    // 4× oversample — browser runs a polyphase halfband FIR around the
    // waveshape op, killing aliasing at all drive levels. Adds ~120–200
    // samples of latency (implementation-defined) which is the whole
    // reason the dry/wet mix rule exists. In sandbox preview mode this
    // adds to the wet-path latency budget; master-worklet codegen will
    // lift the OS inside the fused worklet.
    ws.oversample = '4x';
    const post = ctx.createGain();   // trim back-end
    const setDrive = (drive) => {
      pre.gain.value = drive;
      ws.curve = makeSatCurve(drive);
    };
    setDrive(params.drive ?? 1);
    post.gain.value = dbToLin(params.trim ?? 0);
    pre.connect(ws);
    ws.connect(post);
    return {
      nodes: [pre, ws, post],
      inputs:  { in:  pre  },
      outputs: { out: post },
      setParam(id, v, t) {
        if (id === 'drive') setDrive(v);
        if (id === 'trim')  post.gain._set(dbToLin(v), t, 0.005);
      },
    };
  },

  // Stage B-1 envelope follower — proper asymmetric AR via AudioWorklet.
  // Replaces the biquad-LP approximation (which AM'd the audio whenever
  // the faster knob fell into the audio band). Caller MUST have awaited
  // ensureSandboxWorklets(ctx) before compileGraphToWebAudio, otherwise
  // the worklet processor name isn't registered yet and the constructor
  // throws synchronously.
  //
  // Signal path lives entirely inside the worklet:
  //   in (rectified defensively) → asymmetric AR smoother → *amount +offset → env.
  //
  // Ports stay identical to the biquad version so graphs don't change:
  //   inputs.in, outputs.env.
  envelope(ctx, params) {
    if (!isSandboxWorkletReady(ctx)) {
      throw new Error(
        'envelope op: sandbox worklet not registered — ' +
        'await ensureSandboxWorklets(ctx) before compileGraphToWebAudio.'
      );
    }
    const node = new AudioWorkletNode(ctx, 'sandbox-envelope-follower', {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const pAtk = node.parameters.get('attackMs');
    const pRel = node.parameters.get('releaseMs');
    const pAmt = node.parameters.get('amount');
    const pOff = node.parameters.get('offset');
    pAtk.value = params.attack  ?? 5;
    pRel.value = params.release ?? 120;
    pAmt.value = params.amount  ?? -1;
    pOff.value = params.offset  ?? 0;

    return {
      nodes: [node],
      inputs:  { in:  node },
      outputs: { env: node },
      setParam(id, v, t) {
        // k-rate times: setTargetAtTime with a tiny TC keeps knob moves
        // feeling 1:1 while still preventing zipper. a-rate amount/offset
        // can also take setTargetAtTime — same shape.
        if (id === 'attack')  pAtk._set(v, t, 0.003);
        if (id === 'release') pRel._set(v, t, 0.003);
        if (id === 'amount')  pAmt._set(v, t, 0.003);
        if (id === 'offset')  pOff._set(v, t, 0.003);
      },
    };
  },

  // Compressor gain-computer. Pure sidechain math — no audio path. Takes
  // a linear-magnitude envelope (typically envelope.env with amount=+1) and
  // outputs a delta-from-unity control signal ready to sum into gain.gainMod.
  // Same worklet-prep requirement as envelope / lfo.
  gainComputer(ctx, params) {
    if (!isSandboxWorkletReady(ctx)) {
      throw new Error(
        'gainComputer op: sandbox worklet not registered — ' +
        'await ensureSandboxWorklets(ctx) before compileGraphToWebAudio.'
      );
    }
    const node = new AudioWorkletNode(ctx, 'sandbox-gain-computer', {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const pThr   = node.parameters.get('thresholdDb');
    const pRatio = node.parameters.get('ratio');
    const pKnee  = node.parameters.get('kneeDb');
    pThr.value   = params.thresholdDb ?? -18;
    pRatio.value = params.ratio       ?? 4;
    pKnee.value  = params.kneeDb      ?? 6;
    return {
      nodes: [node],
      inputs:  { env: node },
      outputs: { gr:  node },
      setParam(id, v, t) {
        if (id === 'thresholdDb') pThr._set(v, t, 0.005);
        if (id === 'ratio')       pRatio._set(v, t, 0.005);
        if (id === 'kneeDb')      pKnee._set(v, t, 0.005);
      },
    };
  },

  // Pure noise source — white/pink/brown. Same worklet-prep requirement.
  noise(ctx, params) {
    if (!isSandboxWorkletReady(ctx)) {
      throw new Error(
        'noise op: sandbox worklet not registered — ' +
        'await ensureSandboxWorklets(ctx) before compileGraphToWebAudio.'
      );
    }
    const node = new AudioWorkletNode(ctx, 'sandbox-noise', {
      numberOfInputs:  0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const pShape = node.parameters.get('shape');
    const pAmt   = node.parameters.get('amount');
    const pOff   = node.parameters.get('offset');
    const shapeMap = { white: 0, pink: 1, brown: 2 };
    const toShape = (v) => typeof v === 'string' ? (shapeMap[v] ?? 0) : (v | 0);
    pShape.value = toShape(params.shape ?? 'white');
    pAmt.value   = params.amount ?? 1;
    pOff.value   = params.offset ?? 0;
    return {
      nodes: [node],
      inputs:  {},
      outputs: { out: node },
      setParam(id, v, t) {
        if (id === 'shape')  pShape.value = toShape(v); // k-rate int
        if (id === 'amount') pAmt._set(v, t, 0.003);
        if (id === 'offset') pOff._set(v, t, 0.003);
      },
    };
  },

  // Pure LFO source — no audio in, bipolar mono control signal out.
  // Implemented as an AudioWorkletNode so we get stable phase, branchless
  // shape dispatch, and a clean path to the master-worklet compiler (same
  // processor source string the codegen will lift).
  lfo(ctx, params) {
    if (!isSandboxWorkletReady(ctx)) {
      throw new Error(
        'lfo op: sandbox worklet not registered — ' +
        'await ensureSandboxWorklets(ctx) before compileGraphToWebAudio.'
      );
    }
    const node = new AudioWorkletNode(ctx, 'sandbox-lfo', {
      numberOfInputs:  0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const pRate  = node.parameters.get('rateHz');
    const pShape = node.parameters.get('shape');
    const pAmt   = node.parameters.get('amount');
    const pOff   = node.parameters.get('offset');
    const shapeMap = { sine: 0, triangle: 1, square: 2, saw: 3 };
    const toShape = (v) => typeof v === 'string' ? (shapeMap[v] ?? 0) : (v | 0);
    pRate.value  = params.rateHz ?? 1;
    pShape.value = toShape(params.shape ?? 0);
    pAmt.value   = params.amount ?? 1;
    pOff.value   = params.offset ?? 0;
    return {
      nodes: [node],
      inputs:  {},
      outputs: { lfo: node },
      setParam(id, v, t) {
        if (id === 'rateHz') pRate._set(v, t, 0.003);
        if (id === 'shape')  pShape.value = toShape(v); // k-rate int — no smoothing
        if (id === 'amount') pAmt._set(v, t, 0.003);
        if (id === 'offset') pOff._set(v, t, 0.003);
      },
    };
  },

  // Geraint-Luff FDN reverb — monolithic worklet. Same worklet-prep
  // requirement as envelope/lfo/noise. Stereo in/out; boundary gain nodes
  // upmix mono sources automatically per WebAudio channel-count rules.
  fdnReverb(ctx, params) {
    if (!isSandboxWorkletReady(ctx)) {
      throw new Error(
        'fdnReverb op: sandbox worklet not registered — ' +
        'await ensureSandboxWorklets(ctx) before compileGraphToWebAudio.'
      );
    }
    const node = new AudioWorkletNode(ctx, 'sandbox-fdn-reverb', {
      numberOfInputs:  1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    const pMorph   = node.parameters.get('morph');
    const pSize    = node.parameters.get('size');
    const pDecay   = node.parameters.get('decay');
    const pTone    = node.parameters.get('tone');
    const pDensity = node.parameters.get('density');
    const pWarp    = node.parameters.get('warp');
    const pMix     = node.parameters.get('mix');
    pMorph.value   = params.morph   ?? 0.5;
    pSize.value    = params.size    ?? 0.55;
    pDecay.value   = params.decay   ?? 0.5;
    pTone.value    = params.tone    ?? 0.55;
    pDensity.value = params.density ?? 0.6;
    pWarp.value    = params.warp    ?? 0.3;
    pMix.value     = params.mix     ?? 0.3;
    return {
      nodes: [node],
      inputs:  { in:  node },
      outputs: { out: node },
      setParam(id, v, t) {
        if (id === 'morph')   pMorph._set(v,   t, 0.02);
        if (id === 'size')    pSize._set(v,    t, 0.02);
        if (id === 'decay')   pDecay._set(v,   t, 0.02);
        if (id === 'tone')    pTone._set(v,    t, 0.02);
        if (id === 'density') pDensity._set(v, t, 0.02);
        if (id === 'warp')    pWarp._set(v,    t, 0.02);
        if (id === 'mix')     pMix._set(v,     t, 0.02);
      },
    };
  },

  // Full-wave rectifier. `peak` = |x|, `rms` ≈ x² (not scaled — envelope
  // normalizes downstream). Output is an audio-rate control-like signal.
  detector(ctx, params) {
    const ws = ctx.createWaveShaper();
    const setMode = (mode) => {
      const N = 2048;
      const c = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        c[i] = mode === 'rms' ? x * x : Math.abs(x);
      }
      ws.curve = c;
    };
    setMode(params.mode || 'peak');
    return {
      nodes: [ws],
      inputs:  { in:  ws },
      outputs: { det: ws },
      setParam(id, v) {
        if (id === 'mode') setMode(v);
      },
    };
  },
};

/** Default port pickers when a wire endpoint omits ".port". */
function defaultInPort(opDef) {
  const audioIn = opDef.ports.inputs.find(p => p.kind === 'audio');
  return audioIn ? audioIn.id : opDef.ports.inputs[0]?.id;
}
function defaultOutPort(opDef) {
  const audioOut = opDef.ports.outputs.find(p => p.kind === 'audio');
  return audioOut ? audioOut.id : opDef.ports.outputs[0]?.id;
}

/** Main entry. Throws on validation error. */
export function compileGraphToWebAudio(graph, ctx) {
  const v = validateGraph(graph);
  if (!v.ok) {
    throw new Error(`compileGraphToWebAudio: invalid graph — ${v.errors.join('; ')}`);
  }

  // Boundary nodes for the brick. The chain host sees `inputNode` and
  // `outputNode`. Internally `outputNode` is a summing bus fed by the
  // wet path (graph collector → wetMute) and the dry path (inputNode →
  // bypassPath). setBypass ramps the two mutes inverse. This keeps
  // bypass topology in ONE place — per-brick hand-rolled bypass is the
  // anti-pattern that produced ST-SB-02 / EFL-SB-04 / LL-SB-02 /
  // FFX-SB-02 / FDN-SB-03 / TC-SB-01 / MD-SB-01.
  const inputNode      = ctx.createGain(); inputNode.gain.value      = 1.0;
  const wetOutputNode  = ctx.createGain(); wetOutputNode.gain.value  = 1.0; // graph `out` terminal
  const wetMute        = ctx.createGain(); wetMute.gain.value        = 1.0; // wet on by default
  const bypassPath     = ctx.createGain(); bypassPath.gain.value     = 0.0; // dry off by default
  const outputNode     = ctx.createGain(); outputNode.gain.value     = 1.0; // summing bus
  wetOutputNode.connect(wetMute).connect(outputNode);
  inputNode.connect(bypassPath).connect(outputNode);

  // Compile every node. Factories run under _directMode so any param
  // writes during construction (e.g. mix's setAmt init) land immediately
  // via setValueAtTime rather than smoothing in from whatever the node's
  // boot-time default was.
  const compiled = new Map(); // nodeId → factory result
  _directMode = true;
  try {
    for (const n of graph.nodes) {
      const opDef  = getOp(n.op);
      const make   = FACTORIES[n.op];
      if (!make) throw new Error(`compileGraphToWebAudio: no factory for op "${n.op}"`);
      compiled.set(n.id, { def: opDef, ...make(ctx, n.params || {}) });
    }
  } finally {
    _directMode = false;
  }

  // Resolve a wire endpoint to an AudioNode (or null for terminal/unwired).
  function resolveOut(ref) {
    const { id, port } = splitRef(ref);
    if (id === 'in') return inputNode; // graph input terminal — feed downstream
    const c = compiled.get(id);
    if (!c) return null;
    const portId = port || defaultOutPort(c.def);
    return c.outputs[portId] ?? null;
  }
  function resolveIn(ref) {
    const { id, port } = splitRef(ref);
    if (id === 'out') return wetOutputNode; // graph output terminal — collected into wet bus (pre-bypass sum)
    const c = compiled.get(id);
    if (!c) return null;
    const portId = port || defaultInPort(c.def);
    return c.inputs[portId] ?? null;
  }

  // Wire it.
  const connections = []; // for clean disconnect
  for (const w of graph.wires) {
    const src = resolveOut(w.from);
    const dst = resolveIn(w.to);
    if (!src || !dst) continue; // control ports / stubs — skip silently
    src.connect(dst);
    connections.push([src, dst]);
  }

  // Live param mutation.
  function setParam(nodeId, paramId, value) {
    const c = compiled.get(nodeId);
    if (!c) return;
    c.setParam(paramId, value, ctx.currentTime);
  }

  // ── Panel knob → op-param fan-out (Step 2e) ─────────────────────────
  // A panel knob holds a normalized 0..1 value. Each mapping maps that
  // through a per-mapping range + curve to a real op-param value.
  // Hidden ops (no panel knob touches them) keep their initial params
  // — i.e. they're "baked in" by the brick author.
  const knobIndex = new Map();
  if (graph.panel?.knobs) {
    for (const k of graph.panel.knobs) knobIndex.set(k.id, k);
  }
  function setKnob(knobId, v01) {
    const k = knobIndex.get(knobId);
    if (!k) return;
    const v = Math.max(0, Math.min(1, v01));
    for (const m of k.mappings) {
      const [lo, hi] = m.range || [0, 1];
      let t = v;
      if      (m.curve === 'log') t = Math.pow(v, 2.5);  // gentler-than-linear bias to low end
      else if (m.curve === 'pow') t = v * v;             // squared
      // 'lin' (default) keeps t = v
      let mapped;
      if (m.curve === 'log' && lo > 0 && hi > 0) {
        // True geometric/log mapping — the natural taper for frequency.
        mapped = lo * Math.pow(hi / lo, v);
      } else {
        mapped = lo + (hi - lo) * t;
      }
      setParam(m.nodeId, m.paramId, mapped);
    }
  }
  function listKnobs() {
    return graph.panel?.knobs?.map(k => ({ ...k })) || [];
  }
  // Apply each knob's default once at compile time so the audio reflects
  // the panel's intended starting state. Direct writes (no smoothing) so
  // render sample 0 already sees the intended param values — matches the
  // reference chain and keeps the null-test honest.
  _directMode = true;
  try {
    for (const k of (graph.panel?.knobs || [])) {
      setKnob(k.id, k.default ?? 0.5);
    }
  } finally {
    _directMode = false;
  }

  // ── Brick-level bypass ────────────────────────────────────────────────
  // Equal-inverse ramp on wetMute and bypassPath. Default time constant
  // 5 ms — short enough to feel instant, long enough to avoid clicks.
  // This is the ONLY place sandbox bricks get bypass; per-brick code
  // should not create its own bypassPath / setBypass closure.
  let _bypassOn = false;
  function setBypass(on, tcMs = 5) {
    _bypassOn = !!on;
    const t  = ctx.currentTime;
    const tc = Math.max(0.0005, (tcMs || 5) / 1000);
    wetMute   .gain.setTargetAtTime(_bypassOn ? 0.0 : 1.0, t, tc);
    bypassPath.gain.setTargetAtTime(_bypassOn ? 1.0 : 0.0, t, tc);
  }
  function isBypassed() { return _bypassOn; }

  function dispose() {
    for (const [s, d] of connections) {
      try { s.disconnect(d); } catch {}
    }
    for (const c of compiled.values()) {
      for (const n of c.nodes) {
        try { n.disconnect(); } catch {}
      }
    }
    try { inputNode    .disconnect(); } catch {}
    try { wetOutputNode.disconnect(); } catch {}
    try { wetMute      .disconnect(); } catch {}
    try { bypassPath   .disconnect(); } catch {}
    try { outputNode   .disconnect(); } catch {}
    compiled.clear();
    connections.length = 0;
  }

  return {
    inputNode, outputNode,
    setParam, setKnob, listKnobs,
    setBypass, isBypassed,
    dispose,
  };
}
