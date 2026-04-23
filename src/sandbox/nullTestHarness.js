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

import { LOFI_LIGHT } from './mockGraphs';
import { compileGraphToWebAudio } from './compileGraphToWebAudio';
import { ensureSandboxWorklets } from './workletLoader';

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
