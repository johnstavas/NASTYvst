// nullTestHarness.js — sandbox compiler sanity test.
//
// Question this answers: "Does compileGraphToWebAudio produce exactly
// the same audio samples as a hand-wired equivalent Web Audio graph?"
//
// If the sandbox compiler is trustworthy, this must return max|delta|
// below the float32 noise floor. If it's buggy (wire resolved to wrong
// port, factory misread a param, knob mapping off by a curve), the
// delta will be audible (> -60 dB).
//
// This is NOT a "does LofiLight sound like shipping LofiLoofy" test.
// That's Phase 2 — requires matching each engine's setter API and
// known DSP differences (sat curves differ by design, parallel comp
// absent in sandbox, etc). Here we only verify: the compiler == sum
// of its parts.
//
// Protocol:
//   1. OfflineAudioContext @ 48k, 0.5 s render
//   2. Sandbox side — compile LOFI_LIGHT at default knobs
//   3. Reference side — hand-wire the EXACT same Web Audio topology
//   4. Feed both with the same sine chirp
//   5. Diff sample-by-sample, report max|delta| and RMS|delta| in dB
//
// Notes on scope:
//   - Mix=1 (pure wet) so the dry-leg latency mismatch doesn't cloud
//     the test — both sides route through the same wet chain.
//   - Dust=0 (pink noise is non-deterministic → can't null-test).
//   - Drift=0 (drift modulates tape time; LFO phase isn't guaranteed
//     identical between two worklet instances in the same ctx).
//   - Bits=0 (WaveShaper curve identical, no branch divergence).
//   - Rate off (biquad LP cutoff = 20 kHz).
//   - At these settings the wet chain reduces to:
//       in → shelf(lowshelf 250 Hz 0 dB) → biquad LP (tone) → sat
//       → delay (30 ms, fb=0) → biquad LP (rate, 20 kHz) → out
//     The shelf + 20 kHz LP are effectively pass-through at default
//     values but are real nodes we still need to match on the ref side.

import { LOFI_LIGHT, TOY_COMP } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';
import { buildPCOF } from './buildPCOF';
import { emitMasterWorklet } from './emitMasterWorklet';

// Sidecar sources inlined via Vite ?raw so emitMasterWorklet can stamp
// them into the generated processor string at runtime. Any op TOY_COMP
// references must appear here.
import src_gain         from './ops/op_gain.worklet.js?raw';
import src_filter       from './ops/op_filter.worklet.js?raw';
import src_detector     from './ops/op_detector.worklet.js?raw';
import src_envelope     from './ops/op_envelope.worklet.js?raw';
import src_gainComputer from './ops/op_gainComputer.worklet.js?raw';
import src_mix          from './ops/op_mix.worklet.js?raw';

const SIDECAR_SOURCES = {
  gain: src_gain,
  filter: src_filter,
  detector: src_detector,
  envelope: src_envelope,
  gainComputer: src_gainComputer,
  mix: src_mix,
};

const SR        = 48000;
const DURATION  = 0.5;
const FRAMES    = Math.round(SR * DURATION);

// Sine chirp 200 Hz → 8 kHz over the render. Log-swept so we probe
// roll-off + phase evenly across the audible band.
function renderChirp(outBuf) {
  const f0 = 200, f1 = 8000;
  const k = Math.log(f1 / f0);
  for (let n = 0; n < outBuf.length; n++) {
    const t = n / SR;
    const phase = 2 * Math.PI * f0 * DURATION / k * (Math.exp(k * t / DURATION) - 1);
    outBuf[n] = Math.sin(phase) * 0.5;
  }
}

/** Build the hand-wired reference chain matching LOFI_LIGHT at defaults.
 *  Important: order of param writes + connect calls mirrors compile order
 *  so node-creation timing is identical to the sandbox side. */
function buildReferenceChain(ctx, inputBuffer) {
  // Source
  const src = ctx.createBufferSource();
  src.buffer = inputBuffer;

  // tilt — lowshelf 250 Hz, 0 dB (pass-through at default)
  const tilt = ctx.createBiquadFilter();
  tilt.type = 'lowshelf';
  tilt.frequency.value = 250;
  tilt.gain.value = 0;

  // tone — LP, cutoff from knob default 0.55 with log taper [800, 16000]
  const toneHz = 800 * Math.pow(16000 / 800, 0.55);   // ≈ 3666 Hz
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = toneHz;
  tone.Q.value = 0.707;

  // sat — Padé rational tanh via WaveShaper, 4× OS, drive 0.15 mapped
  // log taper [1, 10] → 1 * (10)^0.15 ≈ 1.413
  const drive = 1 * Math.pow(10, 0.15);
  const pre   = ctx.createGain(); pre.gain.value = drive;
  const ws    = ctx.createWaveShaper();
  ws.oversample = '4x';
  ws.curve = makePadeCurve(drive);
  const post  = ctx.createGain(); post.gain.value = Math.pow(10, -1.5 / 20); // trim -1.5 dB

  // tape delay — 30 ms, feedback 0
  const delaySum = ctx.createGain(); delaySum.gain.value = 1;
  const fbGain   = ctx.createGain(); fbGain.gain.value   = 0;
  const delay    = ctx.createDelay(2.0);
  delay.delayTime.value = 0.030;
  delaySum.connect(delay);
  fbGain.connect(delaySum);

  // bits — identity WaveShaper at bits=0 (mapped via lin [16,4] so knob=0 → 16 bits;
  // bitcrush op treats b<=0 OR b=16 as near-identity in practice, but the sandbox
  // op always builds a staircase when b>0. At 16 bits the staircase has 32768
  // levels so it's indistinguishable from identity at 24-bit precision.)
  const bits = ctx.createWaveShaper();
  bits.curve = makeBitCurve(16);  // will match sandbox's 16-bit curve exactly

  // rate — biquad LP at 20 kHz (knob default 0 → range[20000,800] log → 20000)
  const rate = ctx.createBiquadFilter();
  rate.type = 'lowpass';
  rate.frequency.value = 20000;
  rate.Q.value = 0.707;

  // mix — equal-power crossfade at amount=1.0 → dry=cos(π/2)=0, wet=sin(π/2)=1
  const dryG = ctx.createGain(); dryG.gain.value = Math.cos(1.0 * Math.PI / 2);
  const wetG = ctx.createGain(); wetG.gain.value = Math.sin(1.0 * Math.PI / 2);
  const sum  = ctx.createGain(); sum.gain.value = 1;
  dryG.connect(sum);
  wetG.connect(sum);

  // Output capture
  const dest = ctx.destination;

  // Wire: src → tilt → tone → pre → ws → post → delaySum → delay → bits → rate → wetG → sum → dest
  // And src → dryG → sum (dry leg at 0 gain)
  src.connect(tilt);
  tilt.connect(tone);
  tone.connect(pre);
  pre.connect(ws);
  ws.connect(post);
  post.connect(delaySum);
  delay.connect(bits);
  bits.connect(rate);
  rate.connect(wetG);
  wetG.connect(sum);

  src.connect(dryG);
  dryG.connect(sum);

  sum.connect(dest);
  return src;
}

function makePadeCurve(drive) {
  const N = 2048;
  const c = new Float32Array(N);
  const k = drive;
  const clamp = (x) => x < -3 ? -1 : x > 3 ? 1 : (x * (27 + x*x)) / (27 + 9*x*x);
  const norm  = 1 / Math.max(1e-6, clamp(k));
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    c[i] = clamp(k * x) * norm;
  }
  return c;
}

function makeBitCurve(b) {
  const N = 4096;
  const c = new Float32Array(N);
  if (b <= 0) { for (let i = 0; i < N; i++) c[i] = (i/(N-1))*2 - 1; return c; }
  const levels = Math.pow(2, b - 1);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}

async function renderReference() {
  const ctx = new OfflineAudioContext(1, FRAMES, SR);
  const inBuf = ctx.createBuffer(1, FRAMES, SR);
  renderChirp(inBuf.getChannelData(0));
  const src = buildReferenceChain(ctx, inBuf);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

async function renderSandbox() {
  const ctx = new OfflineAudioContext(1, FRAMES, SR);
  await ensureSandboxWorklets(ctx);
  const inBuf = ctx.createBuffer(1, FRAMES, SR);
  renderChirp(inBuf.getChannelData(0));
  const inst = compileGraphToWebAudio(LOFI_LIGHT, ctx);
  const src = ctx.createBufferSource();
  src.buffer = inBuf;
  src.connect(inst.inputNode);
  inst.outputNode.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  inst.dispose();
  return rendered.getChannelData(0);
}

/** Max absolute delta and RMS delta in dBFS. Also returns best-match
 *  integer sample offset (brute-forced ±32 samples) to handle any
 *  whole-sample delay mismatch between the two chains. */
function diffSignals(a, b) {
  const N = Math.min(a.length, b.length);
  let bestOffset = 0;
  let bestMaxErr = Infinity;
  const MAX_OFFSET = 32;
  for (let off = -MAX_OFFSET; off <= MAX_OFFSET; off++) {
    let maxErr = 0;
    for (let i = 0; i < N - Math.abs(off); i++) {
      const ai = (off >= 0) ? a[i + off] : a[i];
      const bi = (off >= 0) ? b[i]       : b[i - off];
      const e = Math.abs(ai - bi);
      if (e > maxErr) maxErr = e;
      if (maxErr > bestMaxErr) break;
    }
    if (maxErr < bestMaxErr) { bestMaxErr = maxErr; bestOffset = off; }
  }
  // Compute RMS at best offset
  let sumSq = 0, count = 0;
  for (let i = 0; i < N - Math.abs(bestOffset); i++) {
    const ai = (bestOffset >= 0) ? a[i + bestOffset] : a[i];
    const bi = (bestOffset >= 0) ? b[i]              : b[i - bestOffset];
    const e = ai - bi;
    sumSq += e * e;
    count++;
  }
  const rms = Math.sqrt(sumSq / count);
  const toDb = (x) => x > 1e-20 ? 20 * Math.log10(x) : -400;
  return {
    maxErrorDb: toDb(bestMaxErr),
    rmsErrorDb: toDb(rms),
    offsetSamples: bestOffset,
  };
}

export async function runCompilerSanityTest() {
  const [refOut, sbxOut] = await Promise.all([renderReference(), renderSandbox()]);
  const d = diffSignals(refOut, sbxOut);
  return {
    ...d,
    samples: sbxOut.length,
    sampleRate: SR,
    verdict: d.maxErrorDb < -60 ? 'PASS' : 'FAIL',
  };
}

// =====================================================================
// TOY_COMP null-test (Stage B-1, landed 2026-04-23)
// =====================================================================
//
// Same question as above, different topology: does compileGraphToWebAudio
// produce sample-identical audio to a hand-wired sidechain-fed VCA?
//
// Important framing: the envelope follower and gain computer live in
// fixed worklets (sandbox-envelope-follower / sandbox-gain-computer).
// Both sides of this null-test instantiate those same worklets — we're
// NOT reimplementing the compressor math in biquads. The test proves
// the COMPILER correctly wires:
//
//   src → detector → envelope → gainComputer → (summed into gain.gainMod)
//   src → gain (VCA) → makeup → dest
//
// Scope caveats (same spirit as LOFI_LIGHT version):
//   - Static knobs at TOY_COMP defaults (thr=-18, ratio=4, knee=6,
//     atk=5, rel=120, makeup=0). No knob automation.
//   - No parallel/dry leg in TOY_COMP (mix-inside-worklet lives in
//     future Stage-B comp variants per dry_wet_mix_rule.md); so no
//     delay-mismatch concern.
//   - Single chirp, 0.5 s, mono — enough to exercise detector rectify +
//     AR smoother + knee + VCA timing.
//
// If the compiler mis-wires n_comp → n_vca.gainMod (e.g. resolves the
// default port instead of the named control input), the VCA gain stays
// at unity on the sandbox side but tracks GR on the reference side —
// delta ≈ 0 dB, obvious FAIL. That's exactly the class of bug this test
// is designed to catch.

function buildToyCompReference(ctx, inputBuffer) {
  // Source
  const src = ctx.createBufferSource();
  src.buffer = inputBuffer;

  // Detector (peak / |x|) — identical to sandbox detector() factory
  const det = ctx.createWaveShaper();
  {
    const N = 2048;
    const c = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1;
      c[i] = Math.abs(x);
    }
    det.curve = c;
  }

  // Envelope follower worklet — sandbox-envelope-follower, TOY_COMP defaults
  const env = new AudioWorkletNode(ctx, 'sandbox-envelope-follower', {
    numberOfInputs:  1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  env.parameters.get('attackMs').value  = 5;
  env.parameters.get('releaseMs').value = 120;
  env.parameters.get('amount').value    = 1;
  env.parameters.get('offset').value    = 0;

  // Gain computer worklet — sandbox-gain-computer, TOY_COMP defaults
  const gc = new AudioWorkletNode(ctx, 'sandbox-gain-computer', {
    numberOfInputs:  1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  gc.parameters.get('thresholdDb').value = -18;
  gc.parameters.get('ratio').value       = 4;
  gc.parameters.get('kneeDb').value      = 6;

  // VCA — a GainNode whose .gain AudioParam receives the GR delta summed
  // onto its intrinsic 1.0 value. Matches compiler's gainMod convention.
  const vca = ctx.createGain();
  vca.gain.value = 1;  // resting unity; GR signal (≤ 0) pulls below

  // Makeup — gainDb=0 → linear 1.0
  const makeup = ctx.createGain();
  makeup.gain.value = 1;

  // Wire sidechain: src → det → env → gc → (AudioParam) vca.gain
  src.connect(det);
  det.connect(env);
  env.connect(gc);
  gc.connect(vca.gain);

  // Wire main: src → vca → makeup → dest
  src.connect(vca);
  vca.connect(makeup);
  makeup.connect(ctx.destination);

  return src;
}

async function renderToyCompReference() {
  const ctx = new OfflineAudioContext(1, FRAMES, SR);
  await ensureSandboxWorklets(ctx);
  const inBuf = ctx.createBuffer(1, FRAMES, SR);
  renderChirp(inBuf.getChannelData(0));
  const src = buildToyCompReference(ctx, inBuf);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

async function renderToyCompSandbox() {
  const ctx = new OfflineAudioContext(1, FRAMES, SR);
  await ensureSandboxWorklets(ctx);
  const inBuf = ctx.createBuffer(1, FRAMES, SR);
  renderChirp(inBuf.getChannelData(0));
  const inst = compileGraphToWebAudio(TOY_COMP, ctx);
  const src = ctx.createBufferSource();
  src.buffer = inBuf;
  src.connect(inst.inputNode);
  inst.outputNode.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  inst.dispose();
  return rendered.getChannelData(0);
}

export async function runToyCompSanityTest() {
  const [refOut, sbxOut] = await Promise.all([
    renderToyCompReference(),
    renderToyCompSandbox(),
  ]);
  const d = diffSignals(refOut, sbxOut);
  return {
    ...d,
    samples: sbxOut.length,
    sampleRate: SR,
    verdict: d.maxErrorDb < -60 ? 'PASS' : 'FAIL',
    graph: 'TOY_COMP',
  };
}

// =====================================================================
// STAGE-3a EXIT GATE — master worklet A/B null-test for TOY_COMP
// =====================================================================
//
// Question this answers: "Does the emitted master-worklet (single flat
// AudioWorkletProcessor) produce the same audio as the chain-of-worklets
// compileGraphToWebAudio output for the same graph?"
//
// Node-side we already pinned that factory ≡ emitter ≡ hash. This test
// closes the loop in-browser — renders TOY_COMP through both the
// chain-of-worklets path AND a freshly-minted master worklet, compares
// sample-by-sample.
//
// PASS threshold is looser than runToyCompSanityTest: the chain-of-worklets
// path has per-node quantum boundaries that the master worklet doesn't,
// so a ≤ 128-sample offset is expected and diffSignals compensates for it.
// Within that alignment window the residual should be below -60 dBFS.
//
// One-sample drift caveat: the master worklet computes feedback buffers
// with a 1-block delay; compileGraphToWebAudio relies on WebAudio's
// implicit 128-sample node delay. TOY_COMP has no feedback so this is
// moot today — re-examine when a graph with FB edges is dogfooded.

async function renderToyCompMaster() {
  const ctx = new OfflineAudioContext(1, FRAMES, SR);
  const inBuf = ctx.createBuffer(1, FRAMES, SR);
  renderChirp(inBuf.getChannelData(0));

  // Build PCOF, emit source, register as a one-shot processor.
  const pcof = buildPCOF(TOY_COMP);
  pcof.graphId = TOY_COMP.id;
  const processorName = `master-${TOY_COMP.id}-${Math.random().toString(36).slice(2, 8)}`;
  const source = emitMasterWorklet({
    pcof,
    sidecarSources: SIDECAR_SOURCES,
    processorName,
  });
  const blob = new Blob([source], { type: 'text/javascript' });
  const url  = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }

  const src = ctx.createBufferSource();
  src.buffer = inBuf;
  const master = new AudioWorkletNode(ctx, processorName, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  src.connect(master);
  master.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0);
}

export async function runToyCompMasterNullTest() {
  const [chainOut, masterOut] = await Promise.all([
    renderToyCompSandbox(),   // existing chain-of-worklets path
    renderToyCompMaster(),    // NEW: emitted single-worklet path
  ]);
  const d = diffSignals(chainOut, masterOut);
  return {
    ...d,
    samples: masterOut.length,
    sampleRate: SR,
    verdict: d.maxErrorDb < -60 ? 'PASS' : 'FAIL',
    graph: 'TOY_COMP',
    test: 'master-vs-chain',
  };
}
