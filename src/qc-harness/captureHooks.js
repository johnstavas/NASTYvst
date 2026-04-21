// src/qc-harness/captureHooks.js
//
// Offline capture hooks for QC presets that need special stimulus or
// multi-pass rendering. Sibling to seriesRender.js — that file handles
// the two-pass mix_null_series case; this file handles single-pass
// hooks driven off specific signal sources (impulse, silence, max-FB
// sine) and the assertions each ruleId needs.
//
// Each exported hook follows the same contract:
//   Input:  { factory, params, sampleRate, ...ruleSpecific }
//   Output: { ...measurements, notes }
//
// The caller (Analyzer.jsx sweep loop) merges the returned fields into
// `snap.measurements`. Each analyzer rule in qcAnalyzer.js self-disables
// to INFO when its measurement field is missing — so a hook that returns
// `{ notes: 'skipped-no-factory' }` is always safe.
//
// Why this lives outside sources.js / Analyzer.jsx:
//   - sources.js builds live AudioBufferSourceNodes in a single ctx; we
//     need OfflineAudioContext runs + raw Float32Array stimuli so we can
//     reuse deterministic signals across multiple renders.
//   - Analyzer.jsx was growing a TODO mega-block for capture hooks; each
//     hook is a few dozen lines and they're structurally identical —
//     consolidating keeps the sweeper small and the hooks reviewable.
//
// Generalization note (factory lookup):
//   Engine factories are resolved via productId+version. Today the
//   registry is a hardcoded switch in getEngineFactory() below, matching
//   the pattern that's been in Analyzer.jsx for mix_null_series since
//   that feature landed. When the variant registry gains a factory
//   accessor, collapse getEngineFactory() to one call. Until then, each
//   new plugin adds a case here.

// ── Engine factory registry ──────────────────────────────────────────
//
// Central lookup so all hooks (and seriesRender.js, eventually) share
// one source of truth. Factories are dynamically imported so the QC
// harness bundle doesn't pull every engine into its chunk.
//
// Contract: factory returns a promise resolving to an engine with
// { input, output, ...setters } — same shape live-context engines expose.
export async function getEngineFactory(productId, version) {
  if (productId === 'manchild' && version === 'v1') {
    const mod = await import('../manChild/manChildEngine.v1.js');
    return mod.createManChildEngineV1;
  }
  if (productId === 'lofi_loofy' && version === 'v1') {
    const mod = await import('../lofiLoofy/lofiLoofyEngine.v1.js');
    return mod.createLofiLoofyEngineV1;
  }
  // Add new plugins here. Keep the branches narrow (productId + version
  // exact match) so version bumps don't silently route to stale factories.
  return null;
}

// ── Signal generators (deterministic Float32 buffers) ────────────────
//
// Each returns { L, R, length } — same shape seriesRender.js uses for
// pink noise. Deterministic because hooks that run multiple passes
// need bit-identical input across runs (see series-null rationale).

/**
 * Single-sample impulse at t = impulseOffsetSec, silence around it.
 * Offset defaults to 0.3s — past the common silent fade-in window
 * (DEV_RULES H2 uses 0.18–0.24s). If the impulse fires at t=0 on a
 * plugin with a fade-in, the signal gets multiplied by gain=0 and
 * disappears — the rule reports "finite" because silence is finite,
 * but there's no measurement.
 */
function prebuildImpulse(sampleRate, durSec, impulseOffsetSec = 0.3) {
  const length = Math.floor(sampleRate * durSec);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const idx = Math.min(Math.floor(sampleRate * impulseOffsetSec), length - 1);
  L[idx] = 1;
  R[idx] = 1;
  return { L, R, length, impulseIdx: idx };
}

/** Burst of pink noise for durSec, then silence to padSec total. */
function prebuildBurstThenSilence(sampleRate, burstSec, silenceSec) {
  const burst = Math.floor(sampleRate * burstSec);
  const total = burst + Math.floor(sampleRate * silenceSec);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  // Voss–McCartney pink
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  const targetLin = Math.pow(10, -18 / 20);
  for (let i = 0; i < burst; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    const s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * targetLin;
    L[i] = s;
    R[i] = s;
    b6 = w * 0.115926;
  }
  // silence tail left as zeros
  return { L, R, length: total };
}

/** Pure sine at freq, amplitude 1.0 (intentionally hot for FB stress). */
function prebuildSine(sampleRate, durSec, freq) {
  const length = Math.floor(sampleRate * durSec);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const w = 2 * Math.PI * freq / sampleRate;
  for (let i = 0; i < length; i++) {
    const s = Math.sin(w * i);
    L[i] = s;
    R[i] = s;
  }
  return { L, R, length };
}

// ── Shared plumbing ──────────────────────────────────────────────────

function bufferSourceFromPrebuild(ctx, pre) {
  const buf = ctx.createBuffer(2, pre.length, ctx.sampleRate);
  buf.getChannelData(0).set(pre.L);
  buf.getChannelData(1).set(pre.R);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function applyParams(engine, params) {
  if (!engine || !params) return;
  for (const [name, v] of Object.entries(params)) {
    const fn = engine[name];
    if (typeof fn === 'function') {
      try { fn.call(engine, v); } catch { /* best-effort */ }
    }
  }
}

/**
 * Render one offline graph: source → engine → destination. Returns the
 * rendered AudioBuffer. `chainBuilder(ctx)` must resolve to
 * { input, output } — same contract seriesRender uses.
 */
async function renderGraph({ sampleRate, length, pre, chainBuilder }) {
  // eslint-disable-next-line no-undef
  const offline = new OfflineAudioContext(2, length, sampleRate);
  const src = bufferSourceFromPrebuild(offline, pre);
  const chain = await chainBuilder(offline);
  src.connect(chain.input);
  chain.output.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}

/** Render the plugin once with a given pre-generated stimulus. */
async function renderSinglePass({ factory, params, sampleRate, pre }) {
  return renderGraph({
    sampleRate,
    length: pre.length,
    pre,
    chainBuilder: async (ctx) => {
      const e = await factory(ctx);
      applyParams(e, params);
      return { input: e.input, output: e.output };
    },
  });
}

function channelAveragedRms(buf, startSample = 0, endSample = null) {
  const end = endSample == null ? buf.length : Math.min(endSample, buf.length);
  if (end <= startSample) return 0;
  const chs = buf.numberOfChannels;
  let ss = 0, count = 0;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = startSample; i < end; i++) { ss += d[i] * d[i]; count++; }
  }
  return count > 0 ? Math.sqrt(ss / count) : 0;
}

function rmsToDb(rms) {
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

// ── Hook: impulse_ir ─────────────────────────────────────────────────
//
// Render a single impulse, measure IR tail characteristics:
//   - impulsePeakDb         — peak of the IR (coarse wet-path level)
//   - impulseTail60Ms       — RMS dBFS of samples 60ms+ (post-early-refl)
//   - impulseFinite         — all samples finite (no NaN/Inf)
//
// Analyzer rule `impulse_ir` fires WARN when `impulseFinite === false`,
// INFO when the tail is abnormally long / short for the declared family.

export async function renderImpulseIR({ factory, params, sampleRate, durSec = 2 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const pre = prebuildImpulse(sampleRate, durSec);
  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  // Check finiteness + peak across both channels
  let peak = 0, finite = true;
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { finite = false; break; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    if (!finite) break;
  }

  // 60ms gate → start of what counts as "tail" (past transient arrival)
  const tailStart = Math.min(Math.floor(sampleRate * 0.060), buf.length - 1);
  const tailRms = channelAveragedRms(buf, tailStart);

  return {
    impulsePeakDb:   rmsToDb(peak),  // peak not RMS but reuse helper for sign
    impulseTailDb:   rmsToDb(tailRms),
    impulseFinite:   finite,
    notes:           finite ? 'ok' : 'non-finite-output',
  };
}

// ── Hook: bypass_exact ───────────────────────────────────────────────
//
// Render with bypass engaged, null against input. Any residual above
// the bit-exact floor means bypass ISN'T truly bypassed — some stage
// is still on the signal path.
//
// Expected residual: < −100 dB RMS (float precision floor).

export async function renderBypassExact({ factory, params, sampleRate, durSec = 2, skipSec = 0.5 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  // Pink noise — same convention as seriesRender. Reference = the dry
  // signal itself (prebuild Float32 → AudioBuffer → direct comparison).
  const length = Math.floor(sampleRate * durSec);
  const pre = (() => {
    const L = new Float32Array(length);
    const R = new Float32Array(length);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const targetLin = Math.pow(10, -18 / 20);
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * targetLin;
      L[i] = s;
      R[i] = s;
      b6 = w * 0.115926;
    }
    return { L, R, length };
  })();

  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  // Null: processed − input. Both are bit-identical stereo pink stimuli,
  // so direct subtract. If bypass is exact, residual = float noise only.
  const skip = Math.floor(sampleRate * skipSec);
  const chs = Math.min(buf.numberOfChannels, 2);
  let resEnergy = 0, refEnergy = 0, count = 0;
  for (let c = 0; c < chs; c++) {
    const ref = c === 0 ? pre.L : pre.R;
    const out = buf.getChannelData(c);
    for (let i = skip; i < buf.length; i++) {
      refEnergy += ref[i] * ref[i];
      const d = out[i] - ref[i];
      resEnergy += d * d;
      count++;
    }
  }
  if (count === 0 || refEnergy === 0) {
    return { notes: 'empty-or-silent' };
  }
  const resRms = Math.sqrt(resEnergy / count);
  return {
    bypassResidualDb: rmsToDb(resRms),
    notes: 'ok',
  };
}

// ── Hook: latency_report ─────────────────────────────────────────────
//
// Render a single impulse, find first-nonzero-sample index (per channel,
// take min), compare to declared latencySamples. Large positive delta =
// plugin reports less latency than it actually has (phase-misalignment
// hazard in DAWs). Large negative delta = plugin over-reports (DAW will
// over-compensate → pre-echo).
//
// Threshold for "nonzero": 1% of impulse peak. Under that is the
// numerical tail from filter skirts, not the arrival edge.

export async function renderLatencyReport({ factory, params, sampleRate, declaredLatency, durSec = 1 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const pre = prebuildImpulse(sampleRate, durSec);
  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  // Find peak absolute sample across both channels
  let peak = 0;
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak <= 0) return { notes: 'silent-output' };

  const gate = peak * 0.01;
  let firstIdx = -1;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      if (Math.abs(d[i]) >= gate) {
        if (firstIdx < 0 || i < firstIdx) firstIdx = i;
        break;
      }
    }
  }
  if (firstIdx < 0) return { notes: 'no-arrival-detected' };

  return {
    measuredLatencySamples: firstIdx,
    declaredLatencySamples: declaredLatency ?? null,
    latencyDeltaSamples: declaredLatency != null ? firstIdx - declaredLatency : null,
    notes: 'ok',
  };
}

// ── Hook: fb_runaway ─────────────────────────────────────────────────
//
// Render 30 Hz sine at max FB + max drive for ~10s. Assert:
//   - No NaN/Inf samples
//   - Peak bounded (< +6 dBFS, i.e. amplitude < 2.0 — allows headroom
//     above 0 dBFS for oversampler overshoot but catches true runaway)
//
// If ANY assertion fails, plugin's feedback path is unbounded in some
// regime — users will hit it, the plugin will blow the speakers, end of.

export async function renderFbRunaway({ factory, params, sampleRate, durSec = 10 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const pre = prebuildSine(sampleRate, durSec, 30);
  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  let peak = 0, finite = true, firstNonFiniteAt = -1;
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        finite = false;
        if (firstNonFiniteAt < 0) firstNonFiniteAt = i;
        break;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    if (!finite) break;
  }

  return {
    fbRunawayPeakDb:       rmsToDb(peak),
    fbRunawayFinite:       finite,
    fbRunawayFirstBadSamp: firstNonFiniteAt,
    fbRunawayBounded:      finite && peak < 2.0,  // < +6 dBFS amplitude
    notes: finite ? (peak < 2.0 ? 'ok' : 'peak-exceeds-plus6dBFS') : 'non-finite-output',
  };
}

// ── Hook: pathological_stereo ────────────────────────────────────────
//
// Render with a specific stereo variant (mono_LR / side_only / L_only /
// R_only — matches the labels in qcPresets.js tier2) and measure:
//   - stereoPeakL / stereoPeakR           — channel-independent peaks
//   - stereoRmsL / stereoRmsR             — channel-independent RMS
//   - stereoMidRms / stereoSideRms        — mid/side decomposition
//   - stereoLrCorrelation                 — Pearson correlation L vs R
//   - stereoVariant                       — echoes preset.meta.variant
//
// The analyzer rule checks for pathological outcomes:
//   - mono_LR input → stereoSideRms near −∞  (plugin isn't adding width
//     spuriously)
//   - L_only → stereoPeakR >> stereoPeakL    (plugin isn't bleeding L→R
//     in a one-sided input — sign of broken channel routing)
//   - side_only → stereoMidRms near silent   (mono-summing behavior ok)

/** Fill stereo buffers with a given variant at −18 dBFS pink noise. */
function prebuildStereoVariant(sampleRate, durSec, variant) {
  const length = Math.floor(sampleRate * durSec);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  // Generate two independent pink streams
  const fillPink = (data) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  };
  const tmp = new Float32Array(length);
  fillPink(tmp);
  // Normalize to −18 dBFS RMS
  let ss = 0;
  for (let i = 0; i < length; i++) ss += tmp[i] * tmp[i];
  const rms = Math.sqrt(ss / length);
  const targetLin = Math.pow(10, -18 / 20);
  const scale = rms > 0 ? targetLin / rms : 1;
  for (let i = 0; i < length; i++) tmp[i] *= scale;

  switch (variant) {
    case 'mono_LR':
      for (let i = 0; i < length; i++) { L[i] = tmp[i]; R[i] = tmp[i]; }
      break;
    case 'side_only':
      for (let i = 0; i < length; i++) { L[i] = tmp[i]; R[i] = -tmp[i]; }
      break;
    case 'L_only':
      for (let i = 0; i < length; i++) { L[i] = tmp[i]; R[i] = 0; }
      break;
    case 'R_only':
      for (let i = 0; i < length; i++) { L[i] = 0; R[i] = tmp[i]; }
      break;
    default:
      for (let i = 0; i < length; i++) { L[i] = tmp[i]; R[i] = tmp[i]; }
  }
  return { L, R, length };
}

function rmsOfChannel(data, startSample = 0) {
  let ss = 0, count = 0;
  for (let i = startSample; i < data.length; i++) { ss += data[i] * data[i]; count++; }
  return count > 0 ? Math.sqrt(ss / count) : 0;
}

function peakOfChannel(data) {
  let p = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > p) p = a; }
  return p;
}

function pearsonCorrelation(a, b, startSample = 0) {
  const end = Math.min(a.length, b.length);
  let sumA = 0, sumB = 0, count = 0;
  for (let i = startSample; i < end; i++) { sumA += a[i]; sumB += b[i]; count++; }
  if (count === 0) return 0;
  const meanA = sumA / count, meanB = sumB / count;
  let num = 0, dA = 0, dB = 0;
  for (let i = startSample; i < end; i++) {
    const xa = a[i] - meanA, xb = b[i] - meanB;
    num += xa * xb; dA += xa * xa; dB += xb * xb;
  }
  const den = Math.sqrt(dA * dB);
  return den > 0 ? num / den : 0;
}

export async function renderPathologicalStereo({
  factory, params, sampleRate, variant = 'mono_LR', durSec = 2, skipSec = 0.5,
}) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const pre = prebuildStereoVariant(sampleRate, durSec, variant);
  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  const skip = Math.floor(sampleRate * skipSec);
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;

  // Mid/Side decomposition from post-skip section
  let midSs = 0, sideSs = 0, count = 0;
  for (let i = skip; i < L.length; i++) {
    const m = 0.5 * (L[i] + R[i]);
    const s = 0.5 * (L[i] - R[i]);
    midSs += m * m; sideSs += s * s; count++;
  }
  const midRms = count > 0 ? Math.sqrt(midSs / count) : 0;
  const sideRms = count > 0 ? Math.sqrt(sideSs / count) : 0;

  return {
    stereoVariant:        variant,
    stereoPeakLDb:        rmsToDb(peakOfChannel(L)),
    stereoPeakRDb:        rmsToDb(peakOfChannel(R)),
    stereoRmsLDb:         rmsToDb(rmsOfChannel(L, skip)),
    stereoRmsRDb:         rmsToDb(rmsOfChannel(R, skip)),
    stereoMidRmsDb:       rmsToDb(midRms),
    stereoSideRmsDb:      rmsToDb(sideRms),
    stereoLrCorrelation:  pearsonCorrelation(L, R, skip),
    notes: 'ok',
  };
}

// ── Hook: denormal_tail ──────────────────────────────────────────────
//
// Render burst-then-silence. Measure:
//   - tailDecayDb               — tail RMS vs burst RMS (how much decay)
//   - tailSubnormalCount        — samples with 0 < abs(x) < 1e-30
//   - tailFinalRmsDb            — RMS of last 1s of silence tail
//   - tailRenderMs              — wall-clock render time (offline context
//                                 renders faster than RT; still useful as
//                                 a coarse "does subnormal handling hurt")
//
// Analyzer rule fires WARN when `tailSubnormalCount > 0` or when
// `tailFinalRmsDb > −120` (plugin still generating audible residue 30s
// after stimulus ends → feedback decay is infinite-length, which kills
// CPU on some DAWs via denormals or just never goes silent).

export async function renderDenormalTail({
  factory, params, sampleRate, burstSec = 1, silenceSec = 5,
}) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const pre = prebuildBurstThenSilence(sampleRate, burstSec, silenceSec);
  const burstSamples = Math.floor(sampleRate * burstSec);
  const tailStart = burstSamples;
  const finalWindowStart = Math.max(pre.length - sampleRate, tailStart);

  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }
  const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;

  const chs = buf.numberOfChannels;
  // Burst RMS (post-skip)
  const burstSkip = Math.floor(sampleRate * 0.1);
  let burstSs = 0, burstCount = 0;
  let tailSs = 0, tailCount = 0;
  let finalSs = 0, finalCount = 0;
  let subnormal = 0;
  let finite = true;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = burstSkip; i < burstSamples && i < d.length; i++) {
      burstSs += d[i] * d[i]; burstCount++;
    }
    for (let i = tailStart; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { finite = false; continue; }
      tailSs += v * v; tailCount++;
      const a = Math.abs(v);
      if (a > 0 && a < 1e-30) subnormal++;
      if (i >= finalWindowStart) { finalSs += v * v; finalCount++; }
    }
  }
  const burstRms = burstCount > 0 ? Math.sqrt(burstSs / burstCount) : 0;
  const tailRms  = tailCount  > 0 ? Math.sqrt(tailSs  / tailCount)  : 0;
  const finalRms = finalCount > 0 ? Math.sqrt(finalSs / finalCount) : 0;

  return {
    tailDecayDb:         rmsToDb(tailRms) - rmsToDb(burstRms),
    tailFinalRmsDb:      rmsToDb(finalRms),
    tailSubnormalCount:  subnormal,
    tailFinite:          finite,
    tailRenderMs:        t1 - t0,
    notes: finite ? 'ok' : 'non-finite-output',
  };
}

// ── Hook: mix_identity ───────────────────────────────────────────────
//
// Probe the Mix=100 (wet-only) behaviour. Compares the plugin output
// at Mix=100 against the input signal to confirm the plugin actually
// processes at 100% (not a silent/passthrough bug).
//
// Measures:
//   - mixIdentityResidualDb  — RMS of (out − in), should be WELL above
//                              the bypass_exact floor for any plugin
//                              that actually processes
//   - mixIdentityOutRmsDb    — output RMS (sanity check for silence)
//
// Analyzer rule self-disables unless ruleId === 'mix_identity' and the
// field is present. Purpose: catch "Mix=100 accidentally returns dry"
// bugs (the opposite failure of mix_null leaking).

export async function renderMixIdentity({ factory, params, sampleRate, durSec = 2, skipSec = 0.5 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  // Pink noise stimulus (deterministic, reused across any re-runs)
  const length = Math.floor(sampleRate * durSec);
  const pre = (() => {
    const L = new Float32Array(length);
    const R = new Float32Array(length);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const targetLin = Math.pow(10, -18 / 20);
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * targetLin;
      L[i] = s; R[i] = s;
      b6 = w * 0.115926;
    }
    return { L, R, length };
  })();

  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  const skip = Math.floor(sampleRate * skipSec);
  const chs = Math.min(buf.numberOfChannels, 2);
  let resEnergy = 0, outEnergy = 0, count = 0;
  for (let c = 0; c < chs; c++) {
    const ref = c === 0 ? pre.L : pre.R;
    const out = buf.getChannelData(c);
    for (let i = skip; i < buf.length; i++) {
      const d = out[i] - ref[i];
      resEnergy += d * d;
      outEnergy += out[i] * out[i];
      count++;
    }
  }
  if (count === 0) return { notes: 'empty-render' };

  const resRms = Math.sqrt(resEnergy / count);
  const outRms = Math.sqrt(outEnergy / count);
  return {
    mixIdentityResidualDb: rmsToDb(resRms),
    mixIdentityOutRmsDb:   rmsToDb(outRms),
    notes: 'ok',
  };
}

// ── Hook: mix_sanity ─────────────────────────────────────────────────
//
// Mid-point mix check. The preset fires at Mix=0.5 with pink noise;
// the hook re-renders Mix=0 and Mix=1 with the same stimulus so the
// analyzer can judge whether Mix=0.5 sits inside the dry/wet envelope.
//
// Catches two common defects:
//   1. Mix knob is secretly wired to dry-only (mid matches dry exactly).
//   2. Mix crossfade has a gain bump (mid RMS > max(dry,wet) + 3 dB, or
//      peak overshoots input by > 12 dB — equal-power blend gone wrong).
//
// Measurements:
//   - mixSanityInRmsDb       — reference input RMS (−18 dBFS pink)
//   - mixSanityDryRmsDb      — output RMS at Mix=0
//   - mixSanityMidRmsDb      — output RMS at Mix=0.5 (the preset pass)
//   - mixSanityWetRmsDb      — output RMS at Mix=1
//   - mixSanityMidPeakDb     — peak of Mix=0.5 output (runaway guard)
//   - mixSanityDryWetSepDb   — |wetRmsDb − dryRmsDb|  (how much the
//                              plugin actually colors the signal)
//   - mixSanityMidVsDryDb    — midRmsDb − dryRmsDb
//   - mixSanityMidVsWetDb    — midRmsDb − wetRmsDb
//   - mixSanityEnvelopeDb    — signed distance of midRmsDb from the
//                              [min(dry,wet), max(dry,wet)] envelope.
//                              0 inside envelope, positive = above max,
//                              negative = below min.
//   - mixSanityFinite        — all three renders produced finite samples
//
// Degrades to INFO (capture_pending) when meta.mixName is absent or the
// engine factory can't be resolved — rule self-disables rather than FAIL.

export async function renderMixSanity({
  factory, params, sampleRate, durSec = 2, skipSec = 0.5, mixName, neutralParams,
}) {
  if (typeof factory !== 'function')          return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };
  if (!mixName)                               return { notes: 'skipped-no-mixname' };

  // Deterministic pink stimulus (reused across all three renders).
  const length = Math.floor(sampleRate * durSec);
  const pre = (() => {
    const L = new Float32Array(length);
    const R = new Float32Array(length);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    const targetLin = Math.pow(10, -18 / 20);
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11 * targetLin;
      L[i] = s; R[i] = s;
      b6 = w * 0.115926;
    }
    return { L, R, length };
  })();

  // Compute input RMS once (post-skip window, matches analysis window).
  const skip = Math.floor(sampleRate * skipSec);
  let inE = 0, inN = 0;
  for (let i = skip; i < length; i++) { inE += pre.L[i] * pre.L[i]; inN++; }
  const inRms = inN > 0 ? Math.sqrt(inE / inN) : 0;

  const base = { ...(neutralParams || {}), ...(params || {}) };
  const baseNoMix = { ...base };
  delete baseNoMix[mixName];

  // Three passes at Mix=0, 0.5, 1 — all with identical input.
  const renderAt = async (mix) => {
    const p = { ...baseNoMix, [mixName]: mix };
    try {
      return await renderSinglePass({ factory, params: p, sampleRate, pre });
    } catch (err) {
      return { _err: err && err.message || String(err) };
    }
  };

  const [dryBuf, midBuf, wetBuf] = await Promise.all([
    renderAt(0), renderAt(0.5), renderAt(1),
  ]);
  const errs = [dryBuf, midBuf, wetBuf].map((b) => b && b._err).filter(Boolean);
  if (errs.length) return { notes: `render-threw: ${errs[0]}` };

  // Analyze: RMS per pass + peak + finiteness on mid.
  const measureRms = (buf) => channelAveragedRms(buf, skip);
  const dryRms = measureRms(dryBuf);
  const midRms = measureRms(midBuf);
  const wetRms = measureRms(wetBuf);

  let midPeak = 0, midFinite = true;
  for (let c = 0; c < midBuf.numberOfChannels; c++) {
    const d = midBuf.getChannelData(c);
    for (let i = skip; i < midBuf.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { midFinite = false; break; }
      const a = Math.abs(v);
      if (a > midPeak) midPeak = a;
    }
    if (!midFinite) break;
  }

  const dryDb = rmsToDb(dryRms);
  const midDb = rmsToDb(midRms);
  const wetDb = rmsToDb(wetRms);
  const finiteAll = midFinite
    && Number.isFinite(dryRms) && Number.isFinite(wetRms);

  // Envelope signed-distance: 0 inside [min(dry,wet), max(dry,wet)];
  // positive above max, negative below min.
  const envLo = Math.min(dryDb, wetDb);
  const envHi = Math.max(dryDb, wetDb);
  let envelopeDb = 0;
  if (Number.isFinite(midDb)) {
    if (midDb > envHi) envelopeDb = midDb - envHi;
    else if (midDb < envLo) envelopeDb = midDb - envLo;
  }

  return {
    mixSanityInRmsDb:     rmsToDb(inRms),
    mixSanityDryRmsDb:    dryDb,
    mixSanityMidRmsDb:    midDb,
    mixSanityWetRmsDb:    wetDb,
    mixSanityMidPeakDb:   rmsToDb(midPeak),
    mixSanityDryWetSepDb: (Number.isFinite(dryDb) && Number.isFinite(wetDb))
      ? Math.abs(wetDb - dryDb) : 0,
    mixSanityMidVsDryDb:  (Number.isFinite(midDb) && Number.isFinite(dryDb))
      ? (midDb - dryDb) : 0,
    mixSanityMidVsWetDb:  (Number.isFinite(midDb) && Number.isFinite(wetDb))
      ? (midDb - wetDb) : 0,
    mixSanityEnvelopeDb:  envelopeDb,
    mixSanityFinite:      finiteAll,
    notes: finiteAll ? 'ok' : 'non-finite-output',
  };
}

// ── Hook: extreme_freq ───────────────────────────────────────────────
//
// Drives the plugin with an edge-case single-tone stimulus (DC, 10 Hz,
// 0.45·Nyquist, 0.49·Nyquist) and checks that the plugin doesn't:
//   (a) go non-finite (NaN / Inf from divide-by-zero near DC or
//       un-bandlimited cosines near Nyquist), or
//   (b) produce runaway output peaks from filter instability or
//       resonator ringing at those edge rates.
//
// Inputs (from preset meta):
//   - freq: 0 | 10 | 'nyquist_0_45' | 'nyquist_0_49'
//           (0 → DC, strings scale by sampleRate)
//
// Measurements written:
//   - efFreqHz       — resolved frequency in Hz (0 for DC)
//   - efInPeakDb     — reference input peak (pink tone is −18 dBFS)
//   - efOutPeakDb    — peak of the rendered output
//   - efOutRmsDb     — RMS of the rendered output
//   - efGainDb       — efOutPeakDb − efInPeakDb (signed; positive = overshoot)
//   - efFinite       — all samples finite across both channels
//   - efDcOutDb      — 20·log10(|mean(output)|) — meaningful mostly for DC input
//
// Analyzer gates (qcAnalyzer.js QC-R8e):
//   - efFinite === false         → FAIL (catastrophic)
//   - efGainDb > 12 dB           → FAIL (runaway / filter instability)
//   - 3 dB ≤ efGainDb ≤ 12 dB    → WARN
//   - otherwise                  → INFO ok

/** Build a single-tone or DC buffer at −18 dBFS, length = sampleRate * durSec. */
function prebuildSineOrDc(sampleRate, durSec, freqHz) {
  const length = Math.floor(sampleRate * durSec);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const targetLin = Math.pow(10, -18 / 20);
  if (!Number.isFinite(freqHz) || freqHz <= 0) {
    // DC: constant level
    for (let i = 0; i < length; i++) { L[i] = targetLin; R[i] = targetLin; }
    return { L, R, length };
  }
  const w = 2 * Math.PI * freqHz / sampleRate;
  for (let i = 0; i < length; i++) {
    const s = Math.sin(w * i) * targetLin;
    L[i] = s; R[i] = s;
  }
  return { L, R, length };
}

function resolveExtremeFreqHz(freqSpec, sampleRate) {
  if (freqSpec === 0 || freqSpec === '0' || freqSpec === 'dc' || freqSpec === 'DC') return 0;
  if (typeof freqSpec === 'number' && Number.isFinite(freqSpec)) return freqSpec;
  if (typeof freqSpec === 'string') {
    // Accept 'nyquist_0_45' → 0.45 · (sr/2); fall-through handled below.
    const m = freqSpec.match(/^nyquist_(\d+)_(\d+)$/);
    if (m) {
      const frac = parseFloat(`${m[1]}.${m[2]}`);
      if (Number.isFinite(frac) && frac > 0 && frac < 1) return frac * (sampleRate / 2);
    }
    // Plain numeric string
    const n = parseFloat(freqSpec);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

export async function renderExtremeFreq({
  factory, params, sampleRate, durSec = 1.5, skipSec = 0.4, freq,
}) {
  if (typeof factory !== 'function')              return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const freqHz = resolveExtremeFreqHz(freq, sampleRate);
  if (!Number.isFinite(freqHz) || freqHz < 0)     return { notes: `skipped-bad-freq:${String(freq)}` };
  // Guard against above-Nyquist specs (would just be aliased input — nonsensical).
  if (freqHz > sampleRate / 2)                    return { notes: `skipped-above-nyquist:${freqHz}` };

  const pre = prebuildSineOrDc(sampleRate, durSec, freqHz);

  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  const skip = Math.floor(sampleRate * skipSec);
  const chs  = Math.min(buf.numberOfChannels, 2);

  // Output: peak, RMS, DC component, finiteness.
  let peak = 0, rmsE = 0, rmsN = 0, dcSum = 0, dcN = 0, finite = true;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = skip; i < buf.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { finite = false; break; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      rmsE += v * v; rmsN++;
      dcSum += v;  dcN++;
    }
    if (!finite) break;
  }
  const rms    = rmsN > 0 ? Math.sqrt(rmsE / rmsN) : 0;
  const dcMean = dcN > 0 ? Math.abs(dcSum / dcN) : 0;

  // Input peak: for both DC and sine the −18 dBFS target gives peak == targetLin.
  const inPeakLin = Math.pow(10, -18 / 20);
  const inPeakDb  = rmsToDb(inPeakLin);
  const outPeakDb = rmsToDb(peak);
  const gainDb    = (Number.isFinite(outPeakDb) && Number.isFinite(inPeakDb))
    ? (outPeakDb - inPeakDb) : 0;

  return {
    efFreqHz:   freqHz,
    efInPeakDb: inPeakDb,
    efOutPeakDb: outPeakDb,
    efOutRmsDb:  rmsToDb(rms),
    efGainDb:    gainDb,
    efFinite:    finite,
    efDcOutDb:   rmsToDb(dcMean),
    notes: finite ? 'ok' : 'non-finite-output',
  };
}

// ── Hook: monosum_null ───────────────────────────────────────────────
//
// Mono-compatibility check for stereo-width plugins. Runs at width=neutral
// (paramSchema-provided, usually setWidth(1)) with decorrelated stereo
// pink noise and measures:
//   - monosumOutRmsDb    — RMS of (L+R)/2 on output (mono-fold energy)
//   - monosumChanRmsDb   — average RMS of L and R channels independently
//   - monosumCompatDb    — 20·log10(outMonoRms / avgChanRms)
//                          0 dB = perfectly mono (L==R)
//                         −3 dB = ideal decorrelated stereo (expected here)
//                         < −6 dB = partial phase cancellation (mono hazard)
//                         ≪ −∞ = hard anti-phase (broadcast-mono collapse)
//   - monosumInOutDeltaDb — 20·log10(outMonoRms / inMonoRms)
//                           Non-zero means the plugin altered mono content
//                           at "neutral" width — a neutrality violation
//                           even if mono compat itself is fine.
//
// Analyzer rule `monosum_null` gates:
//   - monosumCompatDb < −6 dB AND input was decorrelated pink → FAIL
//     (plugin is introducing anti-phase artifacts; will collapse in mono)
//   - −6 dB ≤ monosumCompatDb < −4 dB → WARN (worse than ideal decorrelation)
//   - monosumCompatDb ≥ −4 dB → INFO ok
//   - |monosumInOutDeltaDb| > 3 dB → INFO (width=1 is not transparent)

/** Two decorrelated pink streams, normalized to −18 dBFS each. */
function prebuildDecorrelatedPinkStereo(sampleRate, durSec) {
  const length = Math.floor(sampleRate * durSec);
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const fillPink = (data) => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < data.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  };
  const targetLin = Math.pow(10, -18 / 20);
  const normalize = (data) => {
    let ss = 0;
    for (let i = 0; i < data.length; i++) ss += data[i] * data[i];
    const rms = Math.sqrt(ss / data.length);
    const scale = rms > 0 ? targetLin / rms : 1;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  };
  fillPink(L); normalize(L);
  fillPink(R); normalize(R);
  return { L, R, length };
}

export async function renderMonosumNull({ factory, params, sampleRate, durSec = 2, skipSec = 0.5 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };

  const pre = prebuildDecorrelatedPinkStereo(sampleRate, durSec);

  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate, pre });
  } catch (err) {
    return { notes: `render-threw: ${err && err.message || err}` };
  }

  const skip = Math.floor(sampleRate * skipSec);
  const endN = Math.min(pre.length, buf.length);
  if (endN <= skip) return { notes: 'empty-render' };

  const outL = buf.getChannelData(0);
  const outR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : outL;

  // Accumulators
  let inMonoE = 0, outMonoE = 0, outLE = 0, outRE = 0, count = 0;
  // Also track non-finite count — catastrophic failure signal
  let nonFinite = 0;
  for (let i = skip; i < endN; i++) {
    const inMono  = (pre.L[i] + pre.R[i]) * 0.5;
    const oL = outL[i], oR = outR[i];
    if (!Number.isFinite(oL) || !Number.isFinite(oR)) { nonFinite++; continue; }
    const outMono = (oL + oR) * 0.5;
    inMonoE  += inMono * inMono;
    outMonoE += outMono * outMono;
    outLE    += oL * oL;
    outRE    += oR * oR;
    count++;
  }

  if (count === 0) return { notes: 'all-samples-non-finite' };

  const inMonoRms  = Math.sqrt(inMonoE  / count);
  const outMonoRms = Math.sqrt(outMonoE / count);
  const outLRms    = Math.sqrt(outLE    / count);
  const outRRms    = Math.sqrt(outRE    / count);
  const avgChanRms = (outLRms + outRRms) * 0.5;

  const compatRatio = avgChanRms > 0 ? outMonoRms / avgChanRms : 0;
  // Input-vs-output mono delta: plugin's effect on mono content at width=1
  const inOutRatio  = inMonoRms > 0 ? outMonoRms / inMonoRms : 0;

  return {
    monosumInRmsDb:      rmsToDb(inMonoRms),
    monosumOutRmsDb:     rmsToDb(outMonoRms),
    monosumOutLRmsDb:    rmsToDb(outLRms),
    monosumOutRRmsDb:    rmsToDb(outRRms),
    monosumCompatDb:     rmsToDb(compatRatio),   // 0 dB = mono, −3 dB = ideal decorrelated, < −6 dB = hazard
    monosumInOutDeltaDb: rmsToDb(inOutRatio),    // plugin's coloration/level effect on mono content
    monosumNonFinite:    nonFinite,
    notes: nonFinite > 0 ? `non-finite-samples: ${nonFinite}` : 'ok',
  };
}

// ── Hook: sample_rate_matrix ─────────────────────────────────────────
//
// Render pink noise through the plugin at a target sample rate. The
// qcPresets generator emits one probe per rate in {44100, 48000, 88200,
// 96000, 192000} for SR-sensitive plugins (BBD, tape, amp-sim, clipper,
// true-peak, convolution, FFT, WDF, filter-resonance). The analyzer
// cross-compares all probes on the same plugin and flags SR-dependent
// level/stability divergence.
//
// Measurements (per probe):
//   - srTargetSampleRate  — echoed back for cross-SR comparison
//   - srOutputFinite      — all samples finite (catastrophic fail if not)
//   - srOutputPeakDb      — peak level at this SR
//   - srOutputRmsDb       — RMS level at this SR
//   - srInputRmsDb        — input RMS at this SR (reference, per-render)
//   - srOutVsInDeltaDb    — output − input RMS, dB
//
// Analyzer gating:
//   - any srOutputFinite === false → FAIL (plugin broken at that SR)
//   - peak-to-peak srOutputRmsDb variance across SRs > 6 dB → FAIL
//     (plugin's gain depends on SR — likely a hardcoded sample-rate
//      constant, uncompensated filter frequency, or broken OS)
//   - 3 dB ≤ variance ≤ 6 dB → WARN (audit SR-dependent constants)
//   - variance < 3 dB → INFO ok

export async function renderSampleRateMatrix({ factory, params, targetSampleRate, durSec = 1, skipSec = 0.3 }) {
  if (typeof factory !== 'function') return { notes: 'skipped-no-factory' };
  if (typeof OfflineAudioContext === 'undefined') return { notes: 'skipped-no-offline' };
  if (!(targetSampleRate > 0)) return { notes: 'skipped-no-target-sr' };

  // Build deterministic pink at the TARGET sample rate — independent of
  // the live-context rate. OfflineAudioContext supports arbitrary rates
  // within browser-dependent bounds (typically 8k…384k).
  const pre = prebuildBurstThenSilence(targetSampleRate, durSec, 0);

  let buf;
  try {
    buf = await renderSinglePass({ factory, params, sampleRate: targetSampleRate, pre });
  } catch (err) {
    // Browser may reject unsupported SRs — surface cleanly.
    return {
      srTargetSampleRate: targetSampleRate,
      srRenderError:      `${err && err.message || err}`,
      notes: `render-threw: ${err && err.message || err}`,
    };
  }

  const skip = Math.floor(targetSampleRate * skipSec);
  const endN = Math.min(pre.length, buf.length);
  if (endN <= skip) {
    return {
      srTargetSampleRate: targetSampleRate,
      notes: 'empty-render',
    };
  }

  // Input RMS (deterministic reference)
  let inE = 0, inCount = 0;
  for (let i = skip; i < pre.length; i++) { inE += pre.L[i] * pre.L[i]; inCount++; }
  const inRms = inCount > 0 ? Math.sqrt(inE / inCount) : 0;

  // Output RMS + peak + finiteness
  let peak = 0, outE = 0, count = 0, finite = true;
  const chs = buf.numberOfChannels;
  for (let c = 0; c < chs; c++) {
    const d = buf.getChannelData(c);
    for (let i = skip; i < endN; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { finite = false; break; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      outE += v * v;
      count++;
    }
    if (!finite) break;
  }
  const outRms = count > 0 ? Math.sqrt(outE / count) : 0;

  return {
    srTargetSampleRate: targetSampleRate,
    srOutputFinite:     finite,
    srOutputPeakDb:     rmsToDb(peak),
    srOutputRmsDb:      rmsToDb(outRms),
    srInputRmsDb:       rmsToDb(inRms),
    srOutVsInDeltaDb:   (inRms > 0 && outRms > 0) ? (rmsToDb(outRms) - rmsToDb(inRms)) : 0,
    notes: finite ? 'ok' : 'non-finite-output',
  };
}

// ── Exports (named so Analyzer.jsx can dispatch on ruleId) ───────────
export const captureHooks = {
  impulse_ir:           renderImpulseIR,
  bypass_exact:         renderBypassExact,
  latency_report:       renderLatencyReport,
  feedback_runaway:     renderFbRunaway,
  pathological_stereo:  renderPathologicalStereo,
  extreme_freq:         renderExtremeFreq,
  denormal_tail:        renderDenormalTail,
  mix_identity:         renderMixIdentity,
  mix_sanity:           renderMixSanity,
  monosum_null:         renderMonosumNull,
  sample_rate_matrix:   renderSampleRateMatrix,
};
