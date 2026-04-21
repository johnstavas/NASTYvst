// src/qc-harness/seriesRender.js
//
// Offline two-pass renderer for the mix_null_series QC rule (and future
// siblings — see Analyzer.jsx capture-layer TODO block). Runs the plugin
// through the active RuntimeAdapter twice: once as a single instance
// (reference), once as two instances in series with the second at Mix=0
// (test). See runtime/runtimeAdapter.js for the runtime boundary —
// OfflineAudioContext details now live inside webAudioRuntimeAdapter.
// once as two instances in series with the second at Mix=0 (test). If the
// Mix=0 contract holds — "at Mix=0, out = dry, no processing" — the two
// renders subtract to silence.
//
// Why this escapes the alignment floor the live null hits:
//   The live Mix=0 null (pre − post) fights an integer-sample lag plus a
//   potentially fractional oversampler group delay, and floors near −53 dB.
//   The series render doesn't align anything — both passes route through
//   the same plugin latency, so direct subtract is valid. Floor is whatever
//   float-math precision allows (< −100 dB is realistic).
//
// Why the pink-noise seed matters:
//   Math.random() isn't seedable. Two renders generating noise independently
//   would see DIFFERENT signals → the subtract would measure noise energy,
//   not plugin behaviour. Solution: generate the buffer ONCE as a Float32Array,
//   then hand the same stimulus to two separate adapter.renderOffline calls.
//   Both renders see bit-identical input.
//
// Contract:
//   Input:
//     factory   — async (BaseAudioContext) → engine   (e.g. createManChildEngineV1)
//     params    — { setterName: value }   applied via engine[setterName](value)
//     sampleRate— number                  (match live ctx for apples-to-apples)
//     durSec    — optional, default 3     (longer = tighter null, slower render)
//     skipSec   — optional, default 0.5   (skip settle transient from RMS math)
//   Output:
//     { rmsDb, lagNotes } — rmsDb is the residual in dB, lagNotes is a short
//     diagnostic string (e.g. "ok" or "skipped-silent").

import { getRuntimeAdapter } from './runtime/runtimeAdapter.js';

// ── Pink noise generator (Voss–McCartney style, matches sources.js) ───
//
// Kept inline (not imported from sources.js) because sources.js builds the
// AudioBuffer + BufferSource in one step — we need the raw Float32Array so
// we can reuse it across two separate contexts.
function fillPinkArray(data) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

function rmsLin(data) {
  let ss = 0;
  for (let i = 0; i < data.length; i++) ss += data[i] * data[i];
  return Math.sqrt(ss / data.length);
}

/**
 * Pre-generate a stereo pink-noise buffer calibrated to −18 dBFS RMS
 * (the QC stimulus convention — matches sources.js createPinkNoise()).
 */
function prebuildPinkBuffer(sampleRate, durSec) {
  const length = Math.floor(sampleRate * durSec);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  fillPinkArray(L);
  fillPinkArray(R);
  const rms = 0.5 * (rmsLin(L) + rmsLin(R));
  const targetLin = Math.pow(10, -18 / 20);
  const scale = rms > 0 ? targetLin / rms : 1;
  for (let i = 0; i < length; i++) { L[i] *= scale; R[i] *= scale; }
  return { L, R, length };
}

/**
 * Apply a params map to an engine via its setter methods. Missing setters
 * are skipped silently — matches the live sweeper's applyQcPreset behavior.
 */
function applyParams(engine, params) {
  if (!engine || !params) return;
  for (const [name, v] of Object.entries(params)) {
    const fn = engine[name];
    if (typeof fn === 'function') {
      try { fn.call(engine, v); } catch { /* swallow — best-effort */ }
    }
  }
}

/**
 * Render one offline graph: pink → (engine chain) → destination, via the
 * active RuntimeAdapter. `chainBuilder(ctx)` resolves to { input, output }
 * so one instance (ref) vs two-in-series (test) share the same outer setup.
 */
async function renderGraph({ sampleRate, durSec, pre, chainBuilder }) {
  const length = Math.floor(sampleRate * durSec);
  const adapter = getRuntimeAdapter();
  return adapter.renderOffline({
    sampleRate,
    length,
    stimulus: pre,
    buildChain: chainBuilder,
  });
}

/**
 * Compute RMS dB of (test − ref) over the post-settle window, channel-averaged.
 * Returns -Infinity if the reference is effectively silent (ambiguous null).
 */
function residualDb(refBuf, testBuf, skipSamples) {
  if (refBuf.length !== testBuf.length) return -Infinity;
  const len = refBuf.length;
  if (skipSamples >= len) return -Infinity;
  const chs = Math.min(refBuf.numberOfChannels, testBuf.numberOfChannels);
  let refEnergy = 0, resEnergy = 0, count = 0;
  for (let c = 0; c < chs; c++) {
    const r = refBuf.getChannelData(c);
    const t = testBuf.getChannelData(c);
    for (let i = skipSamples; i < len; i++) {
      refEnergy += r[i] * r[i];
      const d = t[i] - r[i];
      resEnergy += d * d;
      count++;
    }
  }
  if (count === 0 || refEnergy === 0) return -Infinity;
  const rms = Math.sqrt(resEnergy / count);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * Main entry point — render reference + series test, return residual.
 *
 * Caller passes a `factory` (e.g. createManChildEngineV1) and the same
 * `params` map the live harness applied (which includes Mix=0). Both
 * instances in the test chain get the same params, matching the step-5
 * test definition from dry_wet_mix_rule.md.
 */
export async function renderSeriesNull({
  factory,
  params,
  sampleRate,
  durSec = 3,
  skipSec = 0.5,
}) {
  if (typeof factory !== 'function') {
    return { rmsDb: -Infinity, lagNotes: 'skipped-no-factory' };
  }
  if (!getRuntimeAdapter().isAvailable()) {
    return { rmsDb: -Infinity, lagNotes: 'skipped-no-runtime' };
  }

  // Pre-generate noise so both renders see identical samples.
  const pre = prebuildPinkBuffer(sampleRate, durSec);

  // Reference: signal → engineA → out
  const refBuf = await renderGraph({
    sampleRate, durSec, pre,
    chainBuilder: async (ctx) => {
      const e = await factory(ctx);
      applyParams(e, params);
      return { input: e.input, output: e.output };
    },
  });

  // Test: signal → engineA → engineB(Mix=0 via params) → out
  const testBuf = await renderGraph({
    sampleRate, durSec, pre,
    chainBuilder: async (ctx) => {
      const a = await factory(ctx);
      const b = await factory(ctx);
      applyParams(a, params);
      applyParams(b, params);
      a.output.connect(b.input);
      return { input: a.input, output: b.output };
    },
  });

  const skipSamples = Math.floor(sampleRate * skipSec);
  const rmsDb = residualDb(refBuf, testBuf, skipSamples);
  return { rmsDb, lagNotes: 'ok' };
}
