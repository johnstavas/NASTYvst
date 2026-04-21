// src/qc-harness/Analyzer.jsx
//
// Dual-tap analyzer for the QC harness. Sits between the source and the
// engine input (PRE) and on the engine output (POST) so you can A/B the
// signal with no UI bias.
//
// Shows for each tap:
//   - time-domain waveform scope
//   - log-frequency spectrum
//   - peak dBFS (with 1.5 s hold), RMS dBFS
// Plus a pre→post delta (gain reduction / makeup).
//
// Throttled at 30 Hz to match the meter-RAF rule.

import React, { useEffect, useRef, useState } from 'react';
import { runConformanceChecks } from './conformanceChecks.js';
import { analyzeAudit, reportToMarkdown, diffReports, RULE_META, HEADLINE_HINTS, humanSummary } from './qcAnalyzer.js';
import { generateQcPresets, summarizeQcPresets } from './qcPresets.js';
import { renderSeriesNull } from './seriesRender.js';
import {
  getEngineFactory,
  renderImpulseIR,
  renderBypassExact,
  renderLatencyReport,
  renderFbRunaway,
  renderDcRejectionFb,
  renderLoopFilterStabilityRoot,
  renderOrthogonalFeedback,
  renderFreezeStability,
  renderPathologicalStereo,
  renderExtremeFreq,
  renderDenormalTail,
  renderMixIdentity,
  renderMixSanity,
  renderMonosumNull,
  renderSampleRateMatrix,
} from './captureHooks.js';

// ── Approval / acknowledgment persistence ─────────────────────────────────
//
// Approve + Acknowledge both write a localStorage entry keyed by
// productId+version+build.sha. Re-running QC on the same build leaves
// the approval intact (you're re-verifying). Re-running after a rebuild
// invalidates it (SHA changed → different binary → old approval doesn't
// cover it). Approvals are a dev-facing paper trail; the real blessed
// artifact is the .md file the user downloads and commits alongside.
const APPROVAL_LS_KEY    = 'qc:approvals:v2';
const APPROVAL_LS_KEY_V1 = 'qc:approvals:v1';   // old pre-rename namespace
const APPROVAL_MIGRATED  = 'qc:approvals:migratedFromV1';

// One-shot migration: rewrite any v1-namespace approvals (keyed by the
// old `legacy`/`engine_v1` variant strings) into the v2 namespace with
// the new `prototype`/`v1` version strings. Idempotent.
function _migrateApprovalsOnce() {
  try {
    if (localStorage.getItem(APPROVAL_MIGRATED) === '1') return;
    const raw = localStorage.getItem(APPROVAL_LS_KEY_V1);
    if (raw) {
      const all = JSON.parse(raw || '{}');
      const existing = JSON.parse(localStorage.getItem(APPROVAL_LS_KEY) || '{}');
      for (const [k, v] of Object.entries(all)) {
        const [pid, variant] = k.split(':');
        const nextVersion = variant === 'legacy' ? 'prototype'
                          : variant === 'engine_v1' ? 'v1'
                          : variant;
        const nextKey = `${pid}:${nextVersion}`;
        if (existing[nextKey]) continue; // don't clobber v2 entries
        existing[nextKey] = v;
      }
      localStorage.setItem(APPROVAL_LS_KEY, JSON.stringify(existing));
    }
    localStorage.setItem(APPROVAL_MIGRATED, '1');
  } catch {}
}
if (typeof localStorage !== 'undefined') _migrateApprovalsOnce();

function readApprovals() {
  try { return JSON.parse(localStorage.getItem(APPROVAL_LS_KEY) || '{}'); }
  catch { return {}; }
}
function writeApprovals(next) {
  try { localStorage.setItem(APPROVAL_LS_KEY, JSON.stringify(next)); } catch {}
}
function approvalKey(productId, version) {
  return `${productId}:${version}`;
}
function readApproval(productId, version, sha) {
  const all = readApprovals();
  const entry = all[approvalKey(productId, version)];
  if (!entry) return null;
  // Invalidate on SHA drift — a new build is a different binary.
  if (sha && entry.sha && sha !== entry.sha) return null;
  return entry;
}
function saveApproval(productId, version, entry) {
  const all = readApprovals();
  all[approvalKey(productId, version)] = entry;
  writeApprovals(all);
}
function clearApproval(productId, version) {
  const all = readApprovals();
  delete all[approvalKey(productId, version)];
  writeApprovals(all);
}

function triggerMdDownload(fname, md) {
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Prepends an approval/acknowledgment block to the standard QC markdown
// so the downloaded file carries the decision on its face — not just as
// a filename suffix. Any reader of the .md sees "APPROVED by … on …"
// at the top before they scroll to the verdict.
function buildDecisionMarkdown({ md, decision, productId, version, sha, reason }) {
  const lines = [];
  const stamp = new Date().toISOString();
  const heading = decision === 'approved' ? '✅ APPROVED' : '⚠️ ACKNOWLEDGED (shipping with findings)';
  lines.push(`> **${heading}**`);
  lines.push(`> ${productId} · ${version} · build \`${sha || 'unknown'}\``);
  lines.push(`> Decision recorded: ${stamp}`);
  if (reason) lines.push(`> Reason: ${reason}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  return lines.join('\n') + md;
}

const DB_FLOOR = -100;
const FFT_SIZE = 8192;
const PEAK_DECAY_DB_PER_S = 24;   // spectrum peak-hold fall rate
const OCTAVE_BANDS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

function dbfs(x) { return x > 0 ? 20 * Math.log10(x) : DB_FLOOR; }
function fmtDb(x) { return !isFinite(x) || x <= DB_FLOOR + 0.01 ? '−∞' : x.toFixed(1); }

// Offline aligned null between two time-domain buffers.
//
// The live null analyser (input + −output) physically cannot resolve below
// ~−20 dB under any plugin latency because it does the subtraction in real
// time with no sample alignment — 128-sample AudioWorklet quanta + oversampler
// group delay guarantee a phase offset. Per JOS PASP, a 1-sample offset alone
// nulls at ~−20 dB, which is exactly the fingerprint we kept hitting.
//
// This function: searches for the integer-sample lag (±maxLagSamples) that
// maximises cross-correlation magnitude, shifts `post` to match `pre`, and
// returns RMS of the residual in dB. Usable as a < −90 dB null-test gate.
//
// Center crop is taken from both buffers so shifted comparisons stay inside
// the captured window without boundary artefacts.
function computeAlignedNullDb(preBuf, postBuf, maxLagSamples = 256) {
  const fail = { db: DB_FLOOR, lag: null };
  if (!preBuf || !postBuf) return fail;
  const N = Math.min(preBuf.length, postBuf.length);
  if (N < 1024) return fail;
  const margin = maxLagSamples;
  const L = N - 2 * margin;            // compared length
  if (L < 512) return fail;

  // Pre-check: if pre is effectively silent the null is ambiguous.
  let preSs = 0;
  for (let i = margin; i < margin + L; i++) { const v = preBuf[i]; preSs += v * v; }
  const preRmsLin = Math.sqrt(preSs / L);
  if (preRmsLin < 1e-6) return fail;

  // Coarse search: max |Σ pre[i]·post[i+k]| over k ∈ [-margin, +margin].
  let bestK = 0, bestMag = -Infinity;
  for (let k = -margin; k <= margin; k++) {
    let acc = 0;
    for (let i = margin; i < margin + L; i++) {
      acc += preBuf[i] * postBuf[i + k];
    }
    const mag = Math.abs(acc);
    if (mag > bestMag) { bestMag = mag; bestK = k; }
  }

  // Residual RMS at the chosen lag.
  let ss = 0;
  for (let i = margin; i < margin + L; i++) {
    const d = postBuf[i + bestK] - preBuf[i];
    ss += d * d;
  }
  const rmsLin = Math.sqrt(ss / L);
  return {
    db: rmsLin > 0 ? 20 * Math.log10(rmsLin) : DB_FLOOR,
    lag: bestK,
  };
}

// One tap = one AnalyserNode + canvas pair.
function Tap({ label, analyser, color, peak, rms, hold, lufs, crest, centroid, frozenRef }) {
  const scopeRef = useRef(null);
  const specRef  = useRef(null);
  const peakHoldRef = useRef(null);  // per-bin peak-hold dB, decays over time
  const lastTsRef   = useRef(0);

  useEffect(() => {
    if (!analyser) return;
    let raf;
    const tBuf = new Float32Array(analyser.fftSize);
    const fBuf = new Float32Array(analyser.frequencyBinCount);
    const sr   = analyser.context.sampleRate;
    if (!peakHoldRef.current || peakHoldRef.current.length !== fBuf.length) {
      peakHoldRef.current = new Float32Array(fBuf.length).fill(DB_FLOOR);
    }

    const draw = () => {
      if (frozenRef?.current) { raf = requestAnimationFrame(draw); return; }
      // Scope
      const sc = scopeRef.current;
      if (sc) {
        const ctx = sc.getContext('2d');
        const { width: W, height: H } = sc;
        ctx.fillStyle = '#0a0a0c';
        ctx.fillRect(0, 0, W, H);
        // center line
        ctx.strokeStyle = '#1f1f24'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
        // waveform — auto-scale to peak so quiet signals stay visible
        analyser.getFloatTimeDomainData(tBuf);
        let peak = 0.001;
        for (let i = 0; i < tBuf.length; i++) {
          const a = tBuf[i] < 0 ? -tBuf[i] : tBuf[i];
          if (a > peak) peak = a;
        }
        const scale = Math.min(1 / peak, 32); // cap 30 dB of zoom
        ctx.strokeStyle = color; ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let i = 0; i < tBuf.length; i++) {
          const x = (i / (tBuf.length - 1)) * W;
          const y = H / 2 - tBuf[i] * scale * (H / 2 - 2);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // tiny scale badge so you know the zoom level
        ctx.fillStyle = '#555'; ctx.font = '9px monospace';
        ctx.fillText(`×${scale.toFixed(scale < 10 ? 1 : 0)}`, W - 26, 10);
      }

      // Spectrum — log-frequency axis (20 Hz .. Nyquist), -100..0 dB,
      // octave grid with Hz labels, dB ladder, peak-hold trace.
      const sp = specRef.current;
      if (sp) {
        const ctx2 = sp.getContext('2d');
        const { width: W, height: H } = sp;
        ctx2.fillStyle = '#0a0a0c';
        ctx2.fillRect(0, 0, W, H);
        analyser.getFloatFrequencyData(fBuf); // dB already

        const fMin = 20, fMax = sr / 2;
        const logMin = Math.log10(fMin), logMax = Math.log10(fMax);
        const xOf = (f) => ((Math.log10(f) - logMin) / (logMax - logMin)) * W;
        const yOf = (db) => ((db - 0) / (DB_FLOOR - 0)) * H;

        // Octave grid with Hz labels
        ctx2.strokeStyle = '#1d1d24'; ctx2.lineWidth = 1;
        ctx2.fillStyle = '#555'; ctx2.font = '9px monospace';
        for (const f of OCTAVE_BANDS) {
          if (f < fMin || f > fMax) continue;
          const x = xOf(f);
          ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, H); ctx2.stroke();
          const lbl = f >= 1000 ? (f / 1000) + 'k' : String(f);
          ctx2.fillText(lbl, x + 2, H - 2);
        }
        // dB ladder: -20, -40, -60, -80 with labels
        for (const db of [-20, -40, -60, -80]) {
          const y = yOf(db);
          ctx2.strokeStyle = '#17171d';
          ctx2.beginPath(); ctx2.moveTo(0, y); ctx2.lineTo(W, y); ctx2.stroke();
          ctx2.fillStyle = '#555';
          ctx2.fillText(db + 'dB', 2, y - 2);
        }

        // Peak-hold decay in dB per frame
        const now = performance.now();
        const dt = lastTsRef.current ? (now - lastTsRef.current) / 1000 : 0.016;
        lastTsRef.current = now;
        const decay = PEAK_DECAY_DB_PER_S * dt;
        const holdBuf = peakHoldRef.current;
        for (let i = 0; i < holdBuf.length; i++) {
          const v = fBuf[i];
          holdBuf[i] = Math.max(v, holdBuf[i] - decay);
        }

        // Filled spectrum + outline (current)
        const bins = fBuf.length;
        // fill under
        ctx2.fillStyle = color + '33'; // ~20% alpha
        ctx2.beginPath();
        let started = false;
        for (let i = 1; i < bins; i++) {
          const f = (i * sr) / (bins * 2);
          if (f < fMin) continue;
          const x = xOf(f);
          const db = Math.max(DB_FLOOR, Math.min(0, fBuf[i]));
          const y = yOf(db);
          if (!started) { ctx2.moveTo(x, H); ctx2.lineTo(x, y); started = true; }
          else          ctx2.lineTo(x, y);
        }
        ctx2.lineTo(W, H); ctx2.closePath(); ctx2.fill();

        // outline
        ctx2.strokeStyle = color; ctx2.lineWidth = 1.1;
        ctx2.beginPath(); started = false;
        for (let i = 1; i < bins; i++) {
          const f = (i * sr) / (bins * 2);
          if (f < fMin) continue;
          const x = xOf(f);
          const db = Math.max(DB_FLOOR, Math.min(0, fBuf[i]));
          const y = yOf(db);
          if (!started) { ctx2.moveTo(x, y); started = true; }
          else          ctx2.lineTo(x, y);
        }
        ctx2.stroke();

        // peak-hold trace (thin, lighter color)
        ctx2.strokeStyle = '#ffffff66'; ctx2.lineWidth = 1;
        ctx2.beginPath(); started = false;
        for (let i = 1; i < bins; i++) {
          const f = (i * sr) / (bins * 2);
          if (f < fMin) continue;
          const x = xOf(f);
          const db = Math.max(DB_FLOOR, Math.min(0, holdBuf[i]));
          const y = yOf(db);
          if (!started) { ctx2.moveTo(x, y); started = true; }
          else          ctx2.lineTo(x, y);
        }
        ctx2.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, color]);

  return (
    <div style={ST.tap}>
      <div style={ST.tapHead}>
        <span style={{ color, fontWeight: 600 }}>{label}</span>
        <span style={ST.readout}>
          <span style={ST.k}>PK</span> {fmtDb(hold)}{' '}
          <span style={ST.k}>NOW</span> {fmtDb(peak)}{' '}
          <span style={ST.k}>RMS</span> {fmtDb(rms)}
          <span style={ST.unit}> dBFS</span>
        </span>
      </div>
      <div style={ST.subReadout}>
        <span><span style={ST.k}>LUFS-M</span> {fmtDb(lufs)}</span>
        <span><span style={ST.k}>CREST</span> {isFinite(crest) ? crest.toFixed(1) : '—'} dB</span>
        <span><span style={ST.k}>CENT</span> {centroid > 0 ? (centroid >= 1000 ? (centroid/1000).toFixed(2)+'k' : centroid.toFixed(0)) : '—'} Hz</span>
      </div>
      <canvas ref={scopeRef} width={480} height={70}  style={ST.canvas} />
      <canvas ref={specRef}  width={480} height={140} style={ST.canvas} />
    </div>
  );
}

// ── snapshot self-consistency checks ──────────────────────────────────────
// A-level only for v1. Returns [{ level, msg }, ...] with level:
//   'ok' | 'warn' | 'error'.
// Severity taxonomy for checks:
//   critical — QC cannot trust this snapshot (silence, broken routing, NaN)
//   major    — behavior wrong (dead knob, preset didn't apply, bypass broken)
//   minor    — cosmetic (missing schema, undeclared method, small drift)
//   info     — positive confirmation (so we never emit just "all passed")
//   cannot_verify — capability gap (no getState), not a failure
function runChecks({ entries, values, engineState, paramSchema, measurements, productId, engine }) {
  const out = [];
  const push = (severity, msg, extra = {}) => out.push({ severity, msg, ...extra });

  // ── capture-level sanity (these can invalidate the whole snapshot) ──
  if (measurements) {
    const preRms = measurements.pre?.rmsDb;
    if (isFinite(preRms) && preRms < -60) {
      push('critical', `input RMS ${preRms.toFixed(1)} dBFS — signal near silence, snapshot unreliable`);
    }
    for (const side of ['pre', 'post']) {
      const m = measurements[side];
      if (!m) continue;
      for (const k of ['peakDb', 'rmsDb']) {
        if (m[k] !== undefined && !isFinite(m[k]) && m[k] !== -Infinity) {
          push('critical', `${side}.${k} is NaN`);
        }
      }
    }
  }

  let drivenCount = 0, undeclared = 0;
  for (const e of entries || []) {
    if (e.kind === 'noop') continue;
    const v = values?.[e.name];
    if (v !== undefined) drivenCount++;

    if (typeof v === 'number' && typeof e.min === 'number' && typeof e.max === 'number') {
      if (v < e.min - 1e-6 || v > e.max + 1e-6) {
        push('major', `${e.name}=${v} outside schema range [${e.min}..${e.max}]`);
      }
    }
    if (e.kind === 'enum' && Array.isArray(e.values)) {
      const valid = e.values.some(ev => ev.value === v);
      if (!valid) push('minor', `${e.name}=${v} not in enum values`);
    }
    if (e.kind === 'preset' && Array.isArray(e.options)) {
      if (v && !e.options.includes(v)) {
        push('minor', `${e.name}="${v}" not in options`);
      }
    }
    if (e._inSchema === false) undeclared++;
  }

  if (paramSchema && drivenCount !== entries.filter(e => e.kind !== 'noop').length) {
    push('minor', `${drivenCount}/${entries.filter(e => e.kind !== 'noop').length} params driven — some have no captured value`);
  }
  if (undeclared > 0) {
    push('minor', `${undeclared} undeclared method(s) — add to paramSchema`);
  }
  if (!paramSchema) {
    push('minor', 'engine has no paramSchema — values inferred from names');
  }
  if (!engineState) {
    push('cannot_verify', 'engine has no getState() — cannot verify DSP state matches intent');
  }

  // ── Per-product conformance checks (Phase C) ──
  // Every non-ok result carries a checkId that traces back to the plugin's
  // CONFORMANCE.md. See src/qc-harness/conformanceChecks.js.
  if (productId) {
    const conf = runConformanceChecks({ productId, engineState, values, measurements, engine });
    for (const r of conf) {
      if (r.severity === 'ok') continue;
      push(r.severity, `[${r.checkId}] ${r.name}${r.msg ? ' — ' + r.msg : ''}`, { checkId: r.checkId });
    }
  }

  const worst = out.some(c => c.severity === 'critical') ? 'critical'
              : out.some(c => c.severity === 'major')    ? 'major'
              : out.some(c => c.severity === 'minor')    ? 'minor'
              : out.some(c => c.severity === 'cannot_verify') ? 'cannot_verify'
              : 'ok';
  if (worst === 'ok') push('info', 'no issues detected — snapshot looks clean');
  return { severity: worst, items: out };
}

// ── K-weighted filter chain (ITU-R BS.1770) for LUFS-M ────────────────────
// Stage 1: pre-filter (high-shelf, +4 dB @ 1.68 kHz, Q≈0.71)
// Stage 2: RLB weighting (high-pass, 38 Hz, Q≈0.5)
// We route signal through two cascaded BiquadFilterNodes into a dedicated
// AnalyserNode. The RMS of the K-weighted signal is LUFS-momentary (in
// dBFS, roughly equivalent to LUFS for a single 400ms block).
function createKWeightedChain(ctx) {
  // Stage 1 — high-shelf per ITU-R BS.1770-4
  const pre = ctx.createBiquadFilter();
  pre.type = 'highshelf';
  pre.frequency.value = 1681;
  pre.gain.value = 3.99984385397;
  // Stage 2 — high-pass (RLB)
  const rlb = ctx.createBiquadFilter();
  rlb.type = 'highpass';
  rlb.frequency.value = 38.1;
  rlb.Q.value = 0.5003270373;
  pre.connect(rlb);
  return { input: pre, output: rlb };
}

export default function Analyzer({
  ctx, engine, productId, version,
  entries = [], values = {}, valuesRef, setParam, syncFromEngineState,
  sourceKind, droppedName,
}) {
  const [pre, setPre]   = useState(null);
  const [post, setPost] = useState(null);
  const [preK, setPreK]   = useState(null); // K-weighted analyser (pre)
  const [postK, setPostK] = useState(null); // K-weighted analyser (post)
  const [nullAn, setNullAn] = useState(null); // post − pre residual analyser
  // GR readout (if engine exposes getGrDbA / getGrDbB)
  const [grDb, setGrDb] = useState({ A: null, B: null });
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  frozenRef.current = frozen;
  const [loadMsg, setLoadMsg] = useState(null); // { level, text }
  const fileInputRef = useRef(null);
  const [audit, setAudit] = useState([]);   // queue of saved snapshots
  const [sweeping, setSweeping] = useState(false);
  const [longMode, setLongMode] = useState(false); // opt-in: adds Tier 4 long-session drift preset
  // Keep latest stats in a ref so sweep can read fresh values without re-renders
  const statsRef = useRef(null);
  const [stats, setStats] = useState({
    prePk: DB_FLOOR, preRms: DB_FLOOR, preHold: DB_FLOOR, preLufs: DB_FLOOR, preCrest: 0, preCentroidHz: 0,
    postPk: DB_FLOOR, postRms: DB_FLOOR, postHold: DB_FLOOR, postLufs: DB_FLOOR, postCrest: 0, postCentroidHz: 0,
    nullRmsDb: DB_FLOOR,
  });
  const holdRef = useRef({ pre: { v: DB_FLOOR, t: 0 }, post: { v: DB_FLOOR, t: 0 } });

  // Create analysers once engine is available. Pre taps engine.input,
  // post taps engine.output. Both are passive (connect only — no
  // destination) so they don't double-route audio.
  useEffect(() => {
    if (!engine || !ctx) return;
    // Raw taps ─ fast live metering
    const a = ctx.createAnalyser(); a.fftSize = FFT_SIZE; a.smoothingTimeConstant = 0.5; a.minDecibels = DB_FLOOR; a.maxDecibels = 0;
    const b = ctx.createAnalyser(); b.fftSize = FFT_SIZE; b.smoothingTimeConstant = 0.5; b.minDecibels = DB_FLOOR; b.maxDecibels = 0;
    try { engine.input.connect(a); } catch {}
    try { engine.output.connect(b); } catch {}

    // K-weighted taps (LUFS-M) ─ BS.1770 filter chain → analyser
    const kPre  = createKWeightedChain(ctx);
    const kPost = createKWeightedChain(ctx);
    const anKPre  = ctx.createAnalyser(); anKPre.fftSize = 2048;  anKPre.smoothingTimeConstant = 0.3;
    const anKPost = ctx.createAnalyser(); anKPost.fftSize = 2048; anKPost.smoothingTimeConstant = 0.3;
    try { engine.input.connect(kPre.input);  kPre.output.connect(anKPre); } catch {}
    try { engine.output.connect(kPost.input); kPost.output.connect(anKPost); } catch {}

    // Null residual tap ─ sum(post + (-1 * pre)). If the plugin has zero
    // latency this gives a clean null during bypass or Mix=0. Any
    // non-trivial latency will leak energy here; the readout is advisory.
    const inv  = ctx.createGain(); inv.gain.value = -1;
    const sum  = ctx.createGain(); sum.gain.value = 1;
    const anNull = ctx.createAnalyser(); anNull.fftSize = 2048; anNull.smoothingTimeConstant = 0.3;
    try { engine.input.connect(inv); inv.connect(sum); } catch {}
    try { engine.output.connect(sum); sum.connect(anNull); } catch {}

    setPre(a); setPost(b);
    setPreK(anKPre); setPostK(anKPost);
    setNullAn(anNull);

    return () => {
      for (const n of [a, b, anKPre, anKPost, anNull, inv, sum, kPre.input, kPre.output, kPost.input, kPost.output]) {
        try { n.disconnect(); } catch {}
      }
    };
  }, [ctx, engine]);

  // 30 Hz stats loop
  useEffect(() => {
    if (!pre || !post) return;
    let raf, last = 0;
    const tBuf = new Float32Array(2048);
    const fBuf = new Float32Array(pre.frequencyBinCount);
    const sr   = ctx.sampleRate;

    const measureTime = (an) => {
      an.getFloatTimeDomainData(tBuf);
      let pk = 0, ss = 0;
      for (let i = 0; i < tBuf.length; i++) {
        const v = tBuf[i]; const a = v < 0 ? -v : v;
        if (a > pk) pk = a;
        ss += v * v;
      }
      const rmsLin = Math.sqrt(ss / tBuf.length);
      return { peakLin: pk, rmsLin, peakDb: dbfs(pk), rmsDb: dbfs(rmsLin) };
    };
    const measureLufsM = (an) => {
      // Momentary (400 ms) K-weighted loudness ≈ K-weighted RMS in dBFS.
      // 2048 samples @ 48 kHz ≈ 42 ms; good enough for UI readout. For
      // true BS.1770 momentary we'd accumulate 400 ms; deferred.
      an.getFloatTimeDomainData(tBuf);
      let ss = 0;
      for (let i = 0; i < tBuf.length; i++) ss += tBuf[i] * tBuf[i];
      return dbfs(Math.sqrt(ss / tBuf.length));
    };
    const spectralCentroid = (an) => {
      an.getFloatFrequencyData(fBuf);
      let num = 0, den = 0;
      for (let i = 1; i < fBuf.length; i++) {
        const mag = Math.pow(10, fBuf[i] / 20); // dB → linear
        const f   = (i * sr) / (fBuf.length * 2);
        num += mag * f;
        den += mag;
      }
      return den > 0 ? num / den : 0;
    };

    const tick = (now) => {
      if (frozenRef.current) { raf = requestAnimationFrame(tick); return; }
      if (now - last > 33) {
        last = now;
        const p = measureTime(pre), q = measureTime(post);
        const pLufs = preK  ? measureLufsM(preK)  : DB_FLOOR;
        const qLufs = postK ? measureLufsM(postK) : DB_FLOOR;
        const pCent = spectralCentroid(pre);
        const qCent = spectralCentroid(post);
        const nullD = nullAn ? measureTime(nullAn).rmsDb : DB_FLOOR;

        const h = holdRef.current;
        const HOLD_MS = 1500;
        if (p.peakDb > h.pre.v  || now - h.pre.t  > HOLD_MS) h.pre  = { v: p.peakDb, t: now };
        if (q.peakDb > h.post.v || now - h.post.t > HOLD_MS) h.post = { v: q.peakDb, t: now };

        // GR readout — engines expose getGrDbA/B (meter-side values in dB).
        let grA = null, grB = null;
        try { grA = engine?.getGrDbA?.() ?? null; } catch {}
        try { grB = engine?.getGrDbB?.() ?? null; } catch {}
        if (grA !== null || grB !== null) setGrDb({ A: grA, B: grB });

        setStats({
          prePk: p.peakDb,  preRms: p.rmsDb,  preHold: h.pre.v,
          preLufs: pLufs,   preCrest: p.peakDb - p.rmsDb,  preCentroidHz: pCent,
          postPk: q.peakDb, postRms: q.rmsDb, postHold: h.post.v,
          postLufs: qLufs,  postCrest: q.peakDb - q.rmsDb, postCentroidHz: qCent,
          nullRmsDb: nullD,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pre, post, preK, postK, nullAn, engine, ctx]);

  // Track the previous snapshot's params so each new snapshot can report
  // which knobs actually moved since the last capture. This is the
  // canary for "preset sweep but sliders didn't change" bugs.
  const prevParamsRef = useRef(null);

  // ── snapshot build / download / load ────────────────────────────────────
  // Reads valuesRef.current (not the `values` prop) so sweep loops see
  // the freshest state even before React flushes a re-render.
  const buildSnapshot = ({ requestedPresetName = null, presetApplySucceeded = null } = {}) => {
    const paramSchema = Array.isArray(engine?.paramSchema) ? engine.paramSchema : null;
    let engineState = null;
    try { engineState = engine?.getState?.() ?? null; } catch {}
    // Declared preset values — captured so the `variant_drift` rule can
    // diff against engineState post-apply. If engine.getPreset isn't
    // implemented on this plugin, the rule self-disables (cannot_verify).
    let declaredPreset = null;
    if (requestedPresetName) {
      try { declaredPreset = engine?.getPreset?.(requestedPresetName) ?? null; } catch {}
    }
    const liveValues = (valuesRef?.current) ? { ...valuesRef.current } : { ...values };

    // Changed vs schema defaults
    const changedFromDefault = [];
    if (paramSchema) {
      for (const e of paramSchema) {
        if (e.kind === 'noop') continue;
        if (!(e.name in liveValues)) continue;
        const v = liveValues[e.name];
        const d = e.def;
        if (d === undefined) { changedFromDefault.push(e.name); continue; }
        const same = (typeof v === 'number' && typeof d === 'number')
                     ? Math.abs(v - d) < 1e-6
                     : v === d;
        if (!same) changedFromDefault.push(e.name);
      }
    }

    // Changed vs previous snapshot
    const changedFromPrevious = [];
    const prev = prevParamsRef.current;
    if (prev) {
      for (const [k, v] of Object.entries(liveValues)) {
        const p = prev[k];
        const same = (typeof v === 'number' && typeof p === 'number')
                     ? Math.abs(v - p) < 1e-6
                     : v === p;
        if (!same) changedFromPrevious.push(k);
      }
    }

    // Preset verification
    let presetFound = null;
    if (requestedPresetName !== null) {
      const pe = entries.find(e => e.kind === 'preset');
      presetFound = pe && Array.isArray(pe.options) ? pe.options.includes(requestedPresetName) : null;
    }

    // Read statsRef (not the closure-captured `stats`) so sweep loops see
    // the FRESHEST measurements. React doesn't re-render during the async
    // sweep loop, so `stats` in the closure is stale — statsRef is updated
    // synchronously on every RAF tick.
    const s = statsRef.current || stats;

    // Gain-reduction: read LIVE from the engine at capture time, not from
    // the React `grDb` state. The RAF-driven state is fine for meter
    // rendering, but the sweep loop is an async for/await that never lets
    // React re-render between snapshots — so a closure-captured `grDb`
    // would be frozen at the value it held when the loop started, giving
    // a variance of exactly 0.000 across all 41 presets. Calling the
    // engine getters directly matches what the RAF itself does (see the
    // metering effect) and sidesteps the closure trap entirely.
    let liveGrA = null, liveGrB = null;
    try { liveGrA = engine?.getGrDbA?.() ?? null; } catch {}
    try { liveGrB = engine?.getGrDbB?.() ?? null; } catch {}
    const liveGrDb = { A: liveGrA, B: liveGrB };

    // Sample-aligned null residual. The live `nullRmsDb` is a real-time
    // AnalyserNode sum of (input + −output) with no alignment, so it floors
    // at ~−20 dB under any plugin latency (see computeAlignedNullDb header).
    // We pull both time-domain buffers here at snapshot time, cross-correlate
    // for integer-sample lag, and compute a real residual. This field is what
    // the mix_null rule gates on.
    let alignedNullRmsDb = DB_FLOOR;
    let alignedNullLagSamples = null;
    try {
      if (pre && post) {
        const preBuf  = new Float32Array(pre.fftSize);
        const postBuf = new Float32Array(post.fftSize);
        pre.getFloatTimeDomainData(preBuf);
        post.getFloatTimeDomainData(postBuf);
        // Search lag up to 256 samples — covers 128-sample worklet quantum +
        // typical oversampler group delays. Widen later if a plugin declares
        // capabilities.latencySamples > 256.
        const r = computeAlignedNullDb(preBuf, postBuf, 256);
        alignedNullRmsDb = r.db;
        alignedNullLagSamples = r.lag;
      }
    } catch {}

    const measurements = {
      pre: {
        peakDb: s.prePk, rmsDb: s.preRms, holdDb: s.preHold,
        lufsDb: s.preLufs, crestDb: s.preCrest, centroidHz: s.preCentroidHz,
      },
      post: {
        peakDb: s.postPk, rmsDb: s.postRms, holdDb: s.postHold,
        lufsDb: s.postLufs, crestDb: s.postCrest, centroidHz: s.postCentroidHz,
      },
      deltaPkDb:  s.postPk  - s.prePk,
      deltaRmsDb: s.postRms - s.preRms,
      deltaLufsDb: s.postLufs - s.preLufs,
      nullRmsDb:  s.nullRmsDb,                 // live, advisory (graph sum, unaligned)
      alignedNullRmsDb,                         // offline, cross-correlated — contract-grade
      alignedNullLagSamples,                    // integer lag found by correlator
      grDb: liveGrDb,
    };

    const checks = runChecks({ entries, values: liveValues, engineState, paramSchema, measurements, productId, engine });

    const snap = {
      schemaVersion: 2,
      capturedAt: new Date().toISOString(),
      build: {
        sha:     typeof __BUILD_SHA__   !== 'undefined' ? __BUILD_SHA__   : 'dev',
        version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?',
        time:    typeof __BUILD_TIME__  !== 'undefined' ? __BUILD_TIME__  : '',
      },
      product:  { productId, version },
      stimulus: { type: sourceKind || null, file: droppedName || null },
      preset:   { requestedName: requestedPresetName, found: presetFound,
                  applySucceeded: presetApplySucceeded },
      declaredPreset,
      params:   liveValues,
      changedParamsFromDefault:  changedFromDefault,
      changedParamsFromPrevious: changedFromPrevious,
      engineState,
      paramSchema,
      capabilities: engine?.capabilities ?? null,
      measurements,
      checks,
    };
    prevParamsRef.current = liveValues;
    return snap;
  };

  const downloadSnapshot = () => {
    // Freeze if not already, so the numbers in the JSON match what you're
    // seeing on screen right now.
    if (!frozen) setFrozen(true);
    const snap = buildSnapshot();
    const ts = snap.capturedAt.replace(/[:.]/g, '-').slice(0, 19);
    const fname = `qc_${productId}_${version}_${ts}.json`;
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLoadMsg({ level: 'ok', text: `saved ${fname}` });
  };

  const onLoadFile = async (file) => {
    if (!file) return;
    try {
      const txt  = await file.text();
      const snap = JSON.parse(txt);
      if (!snap.params) throw new Error('no params in file');
      const warns = [];
      if (snap.product?.productId && snap.product.productId !== productId) {
        warns.push(`product mismatch: snap=${snap.product.productId} current=${productId}`);
      }
      if (snap.product?.version && snap.product.version !== version) {
        warns.push(`variant mismatch: snap=${snap.product.version} current=${version} — applying anyway`);
      }
      let applied = 0, skipped = 0;
      for (const [name, v] of Object.entries(snap.params)) {
        if (typeof engine?.[name] === 'function') { setParam?.(name, v); applied++; }
        else                                        { skipped++; }
      }
      const level = warns.length || skipped ? 'warn' : 'ok';
      setLoadMsg({ level,
        text: `loaded: ${applied} applied, ${skipped} skipped${warns.length ? ' · ' + warns.join(' · ') : ''}` });
      // Auto-freeze so user can compare loaded-state measurements immediately.
      setFrozen(true);
    } catch (err) {
      setLoadMsg({ level: 'error', text: `load failed: ${err.message}` });
    }
  };

  statsRef.current = stats;

  // ── audit queue ─────────────────────────────────────────────────────────
  const presetEntry = entries.find(e => e.kind === 'preset');
  const activePresetLabel = presetEntry ? values[presetEntry.name] : null;

  const addToAudit = (labelOverride) => {
    const snap = buildSnapshot();
    const label = labelOverride
                  || activePresetLabel
                  || `snap ${audit.length + 1}`;
    setAudit(a => [...a, { label, snap }]);
    setLoadMsg({ level: 'ok', text: `queued "${label}" (${audit.length + 1} total)` });
  };

  // Build the audit bundle in the shape exportAudit writes to disk.
  // Shared between exportAudit (download JSON) and openAnalyzer (in-app
  // report) so both see identical data — no drift between "what the file
  // says" and "what the popup says".
  //
  // `auditOverride` sidesteps React's stale-closure trap on the RE-RUN
  // path: sweepPresets returns its collected array, runReRun passes that
  // array straight through here, so the analyzer reads the data it just
  // captured — not whatever React happens to have committed by the time
  // the callback fires.
  const buildAuditBundle = (auditOverride) => ({
    schemaVersion: 1,
    kind: 'audit',
    capturedAt: new Date().toISOString(),
    build: {
      sha:     typeof __BUILD_SHA__   !== 'undefined' ? __BUILD_SHA__   : 'dev',
      version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?',
    },
    product: { productId, version },
    source:  { kind: sourceKind || null, name: droppedName || null },
    snapshots: (auditOverride || audit).map(a => ({ label: a.label, ...a.snap })),
  });

  const exportAudit = () => {
    if (audit.length === 0) return;
    const bundle = buildAuditBundle();
    const ts = bundle.capturedAt.replace(/[:.]/g, '-').slice(0, 19);
    const fname = `qc_audit_${productId}_${version}_${ts}.json`;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLoadMsg({ level: 'ok', text: `exported ${fname} (${audit.length} snapshots)` });
  };

  // ── In-app analyzer popup ───────────────────────────────────────────────
  // Runs qcAnalyzer.analyzeAudit() on the in-memory audit queue so users
  // never have to export + drag the JSON into an external tool to get a
  // verdict. Deterministic rule table in qcAnalyzer.js; see that file
  // for the full list.
  //
  // `analysis` holds the current popup's report + its diff vs the previous
  // run. `history` keeps the last 5 runs (report + timestamp) so the popup
  // can show a run-history strip and we can diff the new run against the
  // most recent one automatically after RE-RUN.
  const [analysis, setAnalysis] = useState(null); // { report, bundle, diff } | null
  const [history,  setHistory]  = useState([]);   // [{ at, verdict, version, findingKeys }]

  // Variant-gate confirm popup. Asked before any ANALYZE or RE-RUN so the
  // user sees "you're about to analyze LEGACY / ENGINE V1" in plain text
  // and can cancel if the active variant isn't what they meant. Prevents
  // the foot-gun of approving the wrong engine after a variant switch.
  const [pendingAction, setPendingAction] = useState(null); // 'analyze' | 'rerun' | null

  // `auditOverride` is the array of snapshots to analyze. Omit it to read
  // the current React `audit` state (the normal ANALYZE path). Pass it
  // explicitly from runReRun so we analyze the snapshots we just captured
  // instead of whatever state React has committed — see buildAuditBundle.
  const runAnalyze = (auditOverride) => {
    const data = auditOverride || audit;
    if (data.length === 0) return;
    const bundle = buildAuditBundle(auditOverride);
    const report = analyzeAudit(bundle);
    // Diff only against the most recent run of the SAME variant — diffing
    // Legacy vs V1 would be nonsensical (they're different engines).
    const prev = history.find(h => h.version === version) || null;
    const diff = prev ? diffReports(prev, report) : null;
    setAnalysis({ report, bundle, diff });
    setHistory(h => [
      { at: new Date(), verdict: report.verdict, version,
        findingKeys: report.findings.map(f => f.rule) },
      ...h,
    ].slice(0, 5));
  };

  // One-click fix→verify loop. Clears the queue, re-sweeps every preset,
  // then auto-opens the analyzer so the popup appears with a diff against
  // the previous run. Saves ~5 manual clicks per iteration when debugging
  // a failing finding.
  const runReRun = async () => {
    if (!presetEntry || sweeping) return;
    // Re-running invalidates any prior approval for this variant — the
    // user is capturing fresh data, so the old blessed artifact no
    // longer describes the current state. They must re-Approve.
    clearApproval(productId, version);
    setAnalysis(null);
    // sweepPresets({replace:true}) returns the freshly collected array
    // AND atomically replaces the audit state with it — no append race,
    // no stale-closure read inside runAnalyze. See commentary in
    // sweepPresets + buildAuditBundle for why the array is passed through
    // explicitly instead of re-reading state.
    const freshAudit = await sweepPresets({ replace: true });
    if (freshAudit && freshAudit.length > 0) runAnalyze(freshAudit);
  };

  // Confirmation entry points — set pendingAction, popup asks "analyze on
  // LEGACY / ENGINE V1?", and only then calls runAnalyze / runReRun.
  const openAnalyzer = () => { if (audit.length > 0) setPendingAction('analyze'); };
  const reRun        = () => { if (presetEntry && !sweeping) setPendingAction('rerun'); };
  const closeAnalyzer = () => setAnalysis(null);
  const cancelConfirm = () => setPendingAction(null);
  const confirmAction = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (action === 'analyze') runAnalyze();
    else if (action === 'rerun') runReRun();
  };

  const downloadReport = () => {
    if (!analysis) return;
    const md = reportToMarkdown(analysis.report, analysis.bundle);
    const ts = analysis.bundle.capturedAt.replace(/[:.]/g, '-').slice(0, 19);
    const fname = `qc_report_${productId}_${version}_${ts}.md`;
    triggerMdDownload(fname, md);
  };

  // Approve — only safe when verdict is green. Saves approval to
  // localStorage (keyed by productId+version+SHA so re-runs on the
  // same build survive, but new builds invalidate) and downloads a
  // blessed .md with an APPROVED header. The user commits that .md
  // alongside CONFORMANCE_REPORT.md as the ship receipt.
  const approveReport = () => {
    if (!analysis) return;
    if (analysis.report.verdict !== 'ok') return;
    const bundle = analysis.bundle;
    const sha = bundle?.build?.sha || null;
    const ts = bundle.capturedAt.replace(/[:.]/g, '-').slice(0, 19);
    const rawMd = reportToMarkdown(analysis.report, bundle);
    const md = buildDecisionMarkdown({ md: rawMd, decision: 'approved', productId, version, sha });
    const fname = `qc_approval_${productId}_${version}_${ts}.md`;
    saveApproval(productId, version, {
      decision: 'approved',
      at: new Date().toISOString(),
      sha,
      capturedAt: bundle.capturedAt,
      verdict: analysis.report.verdict,
    });
    triggerMdDownload(fname, md);
    // Nudge a re-render so the approval badge lights up immediately.
    setAnalysis(a => a ? { ...a } : a);
  };

  // Acknowledge — the escape hatch. Available when verdict is WARN or
  // FAIL (or INFO-only on green, in case someone wants to annotate
  // declared diagnostics). Requires a reason string — no silent bypass.
  const acknowledgeReport = (reason) => {
    if (!analysis) return;
    if (!reason || !reason.trim()) return;
    const bundle = analysis.bundle;
    const sha = bundle?.build?.sha || null;
    const ts = bundle.capturedAt.replace(/[:.]/g, '-').slice(0, 19);
    const rawMd = reportToMarkdown(analysis.report, bundle);
    const md = buildDecisionMarkdown({
      md: rawMd, decision: 'acknowledged', productId, version, sha, reason: reason.trim(),
    });
    const fname = `qc_acknowledgment_${productId}_${version}_${ts}.md`;
    saveApproval(productId, version, {
      decision: 'acknowledged',
      at: new Date().toISOString(),
      sha,
      capturedAt: bundle.capturedAt,
      verdict: analysis.report.verdict,
      reason: reason.trim(),
    });
    triggerMdDownload(fname, md);
    setAnalysis(a => a ? { ...a } : a);
  };

  // Current decision for this variant (if any), used to light up the
  // "Approved" / "Acknowledged" badge on the verdict banner.
  const currentDecision = analysis
    ? readApproval(productId, version, analysis.bundle?.build?.sha || null)
    : null;

  const clearAudit = () => { setAudit([]); setLoadMsg({ level: 'ok', text: 'audit queue cleared' }); };

  // ── sweep all presets ───────────────────────────────────────────────────
  //
  // `replace: true` means "wipe the queue first, I'm starting fresh" — used
  // by RE-RUN so successive iterations don't double, triple, quadruple the
  // snapshot count. Default (`replace: false`) keeps the main toolbar's
  // SWEEP button appending, which is the normal authoring flow.
  //
  // Returns the next-audit array directly so callers that need to analyze
  // the fresh data can skip React's render cycle entirely (see runReRun).
  const sweepPresets = async ({ replace = false } = {}) => {
    if (!presetEntry || sweeping) return null;
    const options = presetEntry.options || [];
    if (options.length === 0) return null;
    const starting = (valuesRef?.current ?? values)[presetEntry.name]; // restore after
    setSweeping(true);
    setLoadMsg({ level: 'ok', text: `sweeping plugin presets 0/${options.length}…` });
    const collected = [];
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      setParam?.(presetEntry.name, opt);
      // Let engine apply, sync slider state back, meters settle
      await new Promise(r => setTimeout(r, 600));
      const applied = (valuesRef?.current ?? values)[presetEntry.name] === opt;
      const snap = buildSnapshot({ requestedPresetName: opt, presetApplySucceeded: applied });
      collected.push({ label: opt, snap });
      setLoadMsg({ level: 'ok', text: `sweeping plugin presets ${i + 1}/${options.length} · ${opt}` });
    }
    // Restore starting state
    if (starting !== undefined) {
      setParam?.(presetEntry.name, starting);
    }
    const nextAudit = replace ? collected : [...audit, ...collected];
    setAudit(nextAudit);
    setSweeping(false);
    setLoadMsg({ level: 'ok', text: `swept ${collected.length} presets — ${nextAudit.length} queued` });
    return nextAudit;
  };

  // ── sweep QC presets (generator-driven, schema-conditional) ─────────────
  //
  // Reads engine.capabilities + engine.paramSchema and emits tier-gated
  // presets. Applies each preset's `params` map via setParam (same setter
  // fan-out as plugin preset sweep, just per-param instead of via
  // setCharacter). Tags each snapshot with source:'qc' + ruleId so the
  // analyzer can route rule evaluation.
  const sweepQcPresets = async ({ replace = false, includeLong = false, base = null } = {}) => {
    if (sweeping) return null;
    if (!engine) return null;
    const qcPresets = generateQcPresets(engine, { includeLong });
    if (qcPresets.length === 0) {
      setLoadMsg({ level: 'warn', text: 'no QC presets emitted — engine.capabilities missing?' });
      return null;
    }
    const sum = summarizeQcPresets(qcPresets);
    setSweeping(true);
    setLoadMsg({ level: 'ok',
      text: `sweeping QC presets 0/${sum.total} (T1:${sum.t1} T2:${sum.t2} T3:${sum.t3} T4:${sum.t4})…` });

    // Snapshot starting params so we can restore after
    const startingValues = { ...(valuesRef?.current ?? values) };
    const collected = [];
    for (let i = 0; i < qcPresets.length; i++) {
      const qp = qcPresets[i];
      // Apply each param via the React setParam so UI + engine stay in sync
      for (const [name, v] of Object.entries(qp.params || {})) {
        if (typeof engine?.[name] === 'function') setParam?.(name, v);
      }
      await new Promise(r => setTimeout(r, 600));
      const snap = buildSnapshot({ requestedPresetName: qp.id, presetApplySucceeded: true });
      // Tag snapshot with QC metadata (analyzer routes on source + ruleId)
      snap.qc = { source: 'qc', tier: qp.tier, ruleId: qp.ruleId, meta: qp.meta || null };

      // ── Capture-layer: offline render dispatch ──────────────────────
      //
      // Each ruleId below may require its own offline render (different
      // stimulus, multi-pass, or special analysis). The hooks live in
      // captureHooks.js + seriesRender.js so this dispatcher stays thin.
      // Any hook failure is swallowed — rules self-disable to INFO when
      // their measurement field is missing.
      //
      // Factory is resolved once per snapshot via getEngineFactory(). The
      // registry there is hardcoded per (productId, version); when the
      // variant registry gains a factory accessor, collapse to one call.
      const factory = await getEngineFactory(productId, version);
      const captureCtx = { factory, params: qp.params, sampleRate: ctx.sampleRate };

      try {
        if (qp.ruleId === 'mix_null_series') {
          if (factory) {
            const { rmsDb, lagNotes } = await renderSeriesNull(captureCtx);
            snap.measurements.seriesNullRmsDb = rmsDb;
            snap.measurements.seriesNullRefLabel = 'single-instance @ same params';
            snap.measurements.seriesNullNotes = lagNotes;
          } else {
            snap.measurements.seriesNullNotes = `no-factory-for-${productId}/${version}`;
          }
        } else if (qp.ruleId === 'impulse_ir') {
          const r = await renderImpulseIR(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'bypass_exact') {
          const r = await renderBypassExact(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'latency_report') {
          const r = await renderLatencyReport({
            ...captureCtx,
            declaredLatency: qp.meta?.declaredLatency ?? null,
          });
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'feedback_runaway') {
          const r = await renderFbRunaway(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'dc_rejection_fb') {
          const r = await renderDcRejectionFb(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'loop_filter_stability_root') {
          const r = await renderLoopFilterStabilityRoot(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'orthogonal_feedback') {
          const r = await renderOrthogonalFeedback(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'freeze_stability') {
          const r = await renderFreezeStability(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'pathological_stereo') {
          const r = await renderPathologicalStereo({
            ...captureCtx,
            variant: qp.meta?.variant || 'mono_LR',
          });
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'denormal_tail') {
          const r = await renderDenormalTail(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'extreme_freq') {
          const r = await renderExtremeFreq({
            ...captureCtx,
            freq: qp.meta?.freq,
          });
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'mix_identity') {
          const r = await renderMixIdentity(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'mix_sanity') {
          const r = await renderMixSanity({
            ...captureCtx,
            mixName:       qp.meta?.mixName ?? null,
            neutralParams: qp.meta?.neutralParams ?? null,
          });
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'monosum_null') {
          const r = await renderMonosumNull(captureCtx);
          Object.assign(snap.measurements, r);
        } else if (qp.ruleId === 'sample_rate_matrix') {
          const r = await renderSampleRateMatrix({
            factory: captureCtx.factory,
            params: captureCtx.params,
            targetSampleRate: qp.meta?.sampleRate ?? ctx.sampleRate,
          });
          Object.assign(snap.measurements, r);
        }
      } catch (err) {
        // Same policy as before — never let a render failure break the
        // sweep. Record on the snap for diagnostic visibility.
        snap.measurements.captureHookError = `${qp.ruleId}: ${err && err.message || err}`;
      }
      // ────────────────────────────────────────────────────────────────

      collected.push({ label: qp.label, snap });
      setLoadMsg({ level: 'ok',
        text: `sweeping QC presets ${i + 1}/${qcPresets.length} · ${qp.id}` });
    }
    // Restore starting state (best effort — only restores params we know about)
    for (const [name, v] of Object.entries(startingValues)) {
      if (typeof engine?.[name] === 'function') setParam?.(name, v);
    }

    // Use explicit `base` when provided (sweepAll passes the fresh plugin
    // audit through to avoid a stale-closure race on `audit` state — after
    // sweepPresets' setAudit, this function's `audit` closure is still the
    // pre-sweep value, so appending to it silently overwrites the plugin
    // half). Falls back to closure `audit` for solo SWEEP QC.
    const baseAudit = base !== null ? base : audit;
    const nextAudit = replace ? collected : [...baseAudit, ...collected];
    setAudit(nextAudit);
    setSweeping(false);
    setLoadMsg({ level: 'ok',
      text: `swept ${collected.length} QC presets — ${nextAudit.length} queued` });
    return nextAudit;
  };

  // ── sweep ALL (plugin presets + QC presets, tagged) ─────────────────────
  const sweepAll = async ({ includeLong = false } = {}) => {
    if (sweeping) return null;
    // Plugin presets first (wipes queue, tags variant_drift semantics),
    // then QC presets append to the same queue.
    // CRITICAL: pass pluginAudit as `base` — sweepQcPresets' `audit` closure
    // is stale at this point (captured at sweepAll's render, pre-setAudit).
    const pluginAudit = await sweepPresets({ replace: true });
    if (!pluginAudit) return null;
    return await sweepQcPresets({ replace: false, includeLong, base: pluginAudit });
  };

  const delta = stats.postPk - stats.prePk;
  const deltaStr = !isFinite(delta) ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(1);

  return (
    <div style={ST.wrap}>
      <div style={ST.title}>
        <span>ANALYZER {frozen && <span style={{ color: '#ffb86b' }}>· FROZEN</span>}</span>
        <span style={ST.delta}>
          <button
            onClick={() => setFrozen(f => !f)}
            style={{
              ...ST.freezeBtn,
              background: frozen ? '#3a2a12' : '#1a1a22',
              borderColor: frozen ? '#ffb86b' : '#2a2a34',
              color: frozen ? '#ffb86b' : '#aaa',
            }}
          >{frozen ? '▶ RESUME' : '⏸ FREEZE'}</button>
          <button onClick={downloadSnapshot} style={ST.freezeBtn} title="Freeze and download snapshot JSON">💾 SAVE</button>
          <button onClick={() => fileInputRef.current?.click()} style={ST.freezeBtn} title="Load snapshot JSON and re-apply params">📂 LOAD</button>
          <button onClick={() => addToAudit()} style={ST.freezeBtn}
                  title="Add current state to the audit queue">
            + ADD{audit.length > 0 ? ` (${audit.length})` : ''}
          </button>
          <button onClick={openAnalyzer} disabled={audit.length === 0 || sweeping}
                  style={{ ...ST.freezeBtn, opacity: (audit.length === 0 || sweeping) ? 0.4 : 1 }}
                  title={sweeping
                    ? "Sweep in progress — wait for it to finish before analyzing"
                    : "Analyze the audit queue and show a plain-English verdict"}>
            {sweeping ? '⏳ SWEEPING…' : '📊 ANALYZE'}
          </button>
          {presetEntry && (
            <button onClick={reRun} disabled={sweeping}
                    style={{ ...ST.freezeBtn, opacity: sweeping ? 0.5 : 1,
                             borderColor: '#7affc3', color: '#7affc3' }}
                    title="Clear queue, re-sweep all presets, and auto-open the analyzer (fix→verify loop)">
              {sweeping ? '⏳ RE-RUNNING…' : '🔁 RE-RUN'}
            </button>
          )}
          <button onClick={exportAudit} disabled={audit.length === 0}
                  style={{ ...ST.freezeBtn, opacity: audit.length === 0 ? 0.4 : 1 }}
                  title="Download all queued snapshots as one audit JSON">
            📤 EXPORT AUDIT
          </button>
          {audit.length > 0 && (
            <button onClick={clearAudit} style={ST.freezeBtn} title="Empty the audit queue">✕ CLEAR</button>
          )}
          {presetEntry && (
            <button onClick={sweepPresets} disabled={sweeping}
                    style={{ ...ST.freezeBtn, opacity: sweeping ? 0.5 : 1,
                             borderColor: '#6a7aff', color: '#9aa9ff' }}
                    title="Iterate every plugin-authored preset, capture each, restore starting state">
              {sweeping ? '⏳ SWEEPING…' : '🌀 SWEEP PRESETS'}
            </button>
          )}
          {/* QC preset sweep — reads engine.capabilities + paramSchema */}
          {engine?.capabilities && (
            <>
              <button onClick={() => sweepQcPresets({ replace: true, includeLong: longMode })}
                      disabled={sweeping}
                      style={{ ...ST.freezeBtn, opacity: sweeping ? 0.5 : 1,
                               borderColor: '#b97aff', color: '#c89bff' }}
                      title="Generate QC presets from engine capabilities (tier-gated), sweep, replace queue">
                {sweeping ? '⏳ SWEEPING…' : '🧪 SWEEP QC'}
              </button>
              <button onClick={() => sweepAll({ includeLong: longMode })}
                      disabled={sweeping || !presetEntry}
                      style={{ ...ST.freezeBtn, opacity: (sweeping || !presetEntry) ? 0.5 : 1,
                               borderColor: '#7affc3', color: '#7affc3' }}
                      title="Run plugin presets + QC presets in one sweep (plugin first, QC appended)">
                {sweeping ? '⏳ SWEEPING…' : '🔬 SWEEP ALL'}
              </button>
              <label style={{ fontSize: 10, fontFamily: 'monospace', color: longMode ? '#ffb86b' : '#888',
                              display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 4 }}
                     title="Opt-in: when SWEEP ALL or SWEEP QC runs, include Tier 4 long-session drift preset (10-min steady-state)">
                <input type="checkbox" checked={longMode} onChange={e => setLongMode(e.target.checked)} />
                + LONG
              </label>
            </>
          )}
          <input ref={fileInputRef} type="file" accept="application/json,.json"
                 style={{ display: 'none' }}
                 onChange={e => { const f = e.target.files?.[0]; onLoadFile(f); e.target.value = ''; }} />
          <span style={{ marginLeft: 10 }}>
            Δ PK <span style={{ color: delta < 0 ? '#ff9f6a' : '#7affc3' }}>{deltaStr}</span> dB
          </span>
        </span>
      </div>
      {loadMsg && (
        <div style={{
          fontSize: 10, fontFamily: 'monospace', padding: '4px 8px', borderRadius: 4,
          background: loadMsg.level === 'error' ? '#3a1212'
                    : loadMsg.level === 'warn'  ? '#332a12' : '#123a24',
          color:      loadMsg.level === 'error' ? '#ff9a9a'
                    : loadMsg.level === 'warn'  ? '#ffd07a' : '#9affc3',
          border: '1px solid #2a2a34',
        }}>
          {loadMsg.text}
        </div>
      )}
      <div style={ST.tapsRow}>
        <Tap label="PRE"  analyser={pre}  color="#7ab8ff"
             peak={stats.prePk}  rms={stats.preRms}  hold={stats.preHold}
             lufs={stats.preLufs} crest={stats.preCrest} centroid={stats.preCentroidHz}
             frozenRef={frozenRef} />
        <Tap label="POST" analyser={post} color="#7affc3"
             peak={stats.postPk} rms={stats.postRms} hold={stats.postHold}
             lufs={stats.postLufs} crest={stats.postCrest} centroid={stats.postCentroidHz}
             frozenRef={frozenRef} />
      </div>
      <LiveChecks
        entries={entries}
        values={(valuesRef?.current) || values}
        engine={engine}
        productId={productId}
        stats={stats}
        grDb={grDb}
      />
      {analysis && (
        <AnalyzerPopup
          report={analysis.report}
          bundle={analysis.bundle}
          diff={analysis.diff}
          history={history}
          decision={currentDecision}
          onClose={closeAnalyzer}
          onDownload={downloadReport}
          onApprove={approveReport}
          onAcknowledge={acknowledgeReport}
          onReRun={presetEntry ? reRun : null}
          sweeping={sweeping}
        />
      )}
      {pendingAction && (
        <ConfirmVariantPopup
          action={pendingAction}
          version={version}
          productId={productId}
          snapshotCount={audit.length}
          sourceKind={sourceKind}
          onCancel={cancelConfirm}
          onConfirm={confirmAction}
        />
      )}
    </div>
  );
}

// ── Analyzer report popup ──────────────────────────────────────────────────
//
// Renders the plain-English verdict from qcAnalyzer.analyzeAudit(). Three
// sections top-to-bottom: verdict banner, headline-metrics table, findings
// list. Bottom toolbar has CLOSE + DOWNLOAD REPORT (.md).
function AnalyzerPopup({ report, bundle, diff, history, decision, onClose, onDownload, onApprove, onAcknowledge, onReRun, sweeping }) {
  // Acknowledge-reason modal. Lives here (not at Analyzer root) because
  // it's cheap and keeps the decision flow co-located with the verdict.
  const [ackOpen, setAckOpen] = useState(false);
  const [ackReason, setAckReason] = useState('');
  const badge =
    report.verdict === 'fail' ? { t: '❌ Not ready',    bg: '#3a1212', fg: '#ff9a9a', bd: '#ff5050' } :
    report.verdict === 'warn' ? { t: '⚠️ Almost there', bg: '#332a12', fg: '#ffd07a', bd: '#ffb040' } :
                                { t: '✅ Looks good',   bg: '#123a24', fg: '#9affc3', bd: '#50c080' };
  const friendlyLine = humanSummary(report);
  const h = report.headline;
  const fmt = (x) => (typeof x === 'number' && isFinite(x)) ? x.toFixed(2) : '—';

  const verdictPill = (v) => v === 'fail' ? { fg: '#ff9a9a', bd: '#ff5050', icon: '❌' }
                          : v === 'warn' ? { fg: '#ffd07a', bd: '#ffb040', icon: '⚠️' }
                          :                { fg: '#9affc3', bd: '#50c080', icon: '✅' };

  return (
    <div onClick={onClose} style={AP.backdrop}>
      <div onClick={e => e.stopPropagation()} style={AP.shell}>
        <div style={{ ...AP.banner, background: badge.bg, color: badge.fg, borderColor: badge.bd }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.04em' }}>{badge.t}</div>
            <VariantChip version={bundle?.product?.version} />
            {decision && <DecisionChip decision={decision} />}
          </div>
          <div style={{ fontSize: 13, marginTop: 4, opacity: 0.95 }}>{friendlyLine}</div>
          <div style={{ fontSize: 10, marginTop: 6, opacity: 0.7, fontFamily: 'monospace' }}>
            {bundle?.product?.productId} · {h.snapshots} snapshot(s)
            {bundle?.build?.sha ? ` · build ${bundle.build.sha}` : ''}
          </div>
          {bundle?.product?.version === 'prototype' && (
            <div style={{
              marginTop: 10, padding: '8px 10px',
              background: 'rgba(127,180,255,0.08)',
              border: '1px solid rgba(127,180,255,0.35)',
              borderRadius: 4, fontSize: 12, color: '#9fc3ff',
            }}>
              🔵 This is the <b>Prototype baseline</b> — you're measuring, not approving.
              Switch to V1 above to run an approval audit.
            </div>
          )}
        </div>

        {/* Diff strip — only shows after a second run. Tells the user
            whether their code change actually moved the needle: which
            findings went away, which are new, which are still there. */}
        {diff && (
          <div style={{
            ...AP.diffStrip,
            borderColor: diff.verdictChange === 'improved' ? '#50c080'
                       : diff.verdictChange === 'regressed' ? '#ff5050'
                       :                                      '#555',
          }}>
            <div style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.2em', color: '#8aa0b8', marginBottom: 6 }}>
              SINCE LAST RUN · {diff.verdictChange === 'improved' ? '↑ BETTER'
                              : diff.verdictChange === 'regressed' ? '↓ WORSE'
                              : '= SAME'}
            </div>
            {diff.resolved.length > 0 && (
              <div style={{ fontSize: 12, color: '#9affc3', marginBottom: 3 }}>
                ✅ Fixed: {diff.resolved.map(r => (RULE_META[r]?.title || r)).join(' · ')}
              </div>
            )}
            {diff.introduced.length > 0 && (
              <div style={{ fontSize: 12, color: '#ff9a9a', marginBottom: 3 }}>
                🆕 New problem: {diff.introduced.map(r => (RULE_META[r]?.title || r)).join(' · ')}
              </div>
            )}
            {diff.carried.length > 0 && (
              <div style={{ fontSize: 12, color: '#c0c8d0' }}>
                ↻ Still there: {diff.carried.map(r => (RULE_META[r]?.title || r)).join(' · ')}
              </div>
            )}
            {diff.resolved.length === 0 && diff.introduced.length === 0 && diff.carried.length === 0 && (
              <div style={{ fontSize: 12, color: '#9affc3' }}>Nothing flagged then or now — stayed clean.</div>
            )}
          </div>
        )}

        {/* Run history strip — last 5 verdicts as small pills, newest
            first. A visible log of your debugging session inside the popup. */}
        {history && history.length > 1 && (
          <div style={AP.historyStrip}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.2em', color: '#8aa0b8', marginRight: 8 }}>
              HISTORY
            </span>
            {history.map((hst, i) => {
              const p = verdictPill(hst.verdict);
              const t = hst.at instanceof Date ? hst.at : new Date(hst.at);
              const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
              const ageSec = Math.max(0, Math.round((Date.now() - t.getTime()) / 1000));
              const rel = i === 0 ? 'now'
                        : ageSec < 60   ? `${ageSec}s ago`
                        : ageSec < 3600 ? `${Math.round(ageSec / 60)}m ago`
                        :                 `${Math.round(ageSec / 3600)}h ago`;
              const vTag = hst.version === 'v1' ? 'V1' : (hst.version === 'prototype' ? 'Proto' : (hst.version || 'Proto'));
              return (
                <span key={i} title={`${hhmm} · ${hst.version || 'prototype'} · ${hst.findingKeys.length} finding(s)`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '2px 8px', marginRight: 6,
                    border: `1px solid ${p.bd}`, borderRadius: 10,
                    color: p.fg,
                    fontFamily: 'monospace', fontSize: 10,
                    background: i === 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
                  }}>
                  {p.icon} {rel} <span style={{ opacity: 0.6 }}>·</span> {vTag}
                </span>
              );
            })}
          </div>
        )}

        <div style={AP.section}>
          <div style={AP.sectionHead}>THE NUMBERS</div>
          <table style={AP.table}>
            <thead>
              <tr>
                <th style={AP.th}>Metric</th>
                <th style={AP.th}>Typical</th>
                <th style={AP.th}>Range</th>
                <th style={AP.th}>What this tells you</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={AP.td}>How many presets</td>
                <td style={AP.td}>{h.snapshots}</td>
                <td style={AP.td}>{h.presetsApplied}/{h.presetsRequested} applied</td>
                <td style={AP.td}>{HEADLINE_HINTS.snapshots}</td>
              </tr>
              <tr>
                <td style={AP.td}>How much the sound changed</td>
                <td style={AP.td}>{fmt(h.nullRms.p50)} dB</td>
                <td style={AP.td}>{fmt(h.nullRms.min)} … {fmt(h.nullRms.max)} dB</td>
                <td style={AP.td}>{HEADLINE_HINTS.nullRms}</td>
              </tr>
              <tr>
                <td style={AP.td}>Loudness change</td>
                <td style={AP.td}>{fmt(h.lufs.p50)} dB</td>
                <td style={AP.td}>{fmt(h.lufs.min)} … {fmt(h.lufs.max)} dB</td>
                <td style={AP.td}>{HEADLINE_HINTS.lufs}</td>
              </tr>
              <tr>
                <td style={AP.td}>Peak level change</td>
                <td style={AP.td}>{fmt(h.peak.p50)} dB</td>
                <td style={AP.td}>{fmt(h.peak.min)} … {fmt(h.peak.max)} dB</td>
                <td style={AP.td}>{HEADLINE_HINTS.peak}</td>
              </tr>
              <tr>
                <td style={AP.td}>Compression (GR)</td>
                <td style={AP.td}>{fmt(h.gr.p50)} dB</td>
                <td style={AP.td}>variance {fmt(h.gr.variance)} dB</td>
                <td style={AP.td}>{HEADLINE_HINTS.gr}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={AP.section}>
          <div style={AP.sectionHead}>FINDINGS</div>
          {report.findings.length === 0 ? (
            <div style={{ fontSize: 12, color: '#9affc3', padding: '8px 4px' }}>No issues detected.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {report.findings.map((f, i) => {
                const row = f.severity === 'fail' ? { bg: '#2a0d0d', fg: '#ff9a9a', bd: '#ff5050', icon: '🔴', tag: 'Problem' }
                           : f.severity === 'warn' ? { bg: '#281f0d', fg: '#ffd07a', bd: '#ffb040', icon: '🟡', tag: 'Check' }
                           :                         { bg: '#0d1a28', fg: '#9fc3ff', bd: '#5080c0', icon: '🔵', tag: 'Info' };
                // Merge severity-branched copy — same rule can show a
                // FAIL title ("Dry path leaks when Mix = 0") or an INFO
                // title ("Mix knob — automatic check skipped for this
                // plugin") depending on severity. reportToMarkdown does
                // this merge in qcAnalyzer.js; the UI must do the same
                // or the generated .md and the popup disagree.
                const baseMeta = RULE_META[f.rule] || {
                  title:   f.rule,
                  meaning: f.msg,
                  fix:     "No suggested fix on file for this rule yet — open qcAnalyzer.js and add one.",
                };
                const override = baseMeta.bySeverity?.[f.severity] || {};
                const meta = { ...baseMeta, ...override, dev: override.dev || baseMeta.dev };
                return (
                  <div key={i} style={{ ...AP.finding, background: row.bg, borderColor: row.bd, color: row.fg }}>
                    {/* Plain-English header */}
                    <div style={{ fontSize: 13, fontWeight: 700, color: row.fg }}>
                      {row.icon} {row.tag} — {meta.title}
                    </div>

                    {/* What it means */}
                    <div style={{ fontSize: 12, marginTop: 6, color: '#e0e4ea', lineHeight: 1.45 }}>
                      <b style={{ color: '#c8cdd6' }}>What it means:</b> {meta.meaning}
                    </div>

                    {/* Suggested fix */}
                    <div style={{ fontSize: 12, marginTop: 4, color: '#e0e4ea', lineHeight: 1.45 }}>
                      <b style={{ color: '#c8cdd6' }}>Try this:</b> {meta.fix}
                    </div>

                    {/* Affected list */}
                    {f.affected && f.affected.length > 0 && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 11, cursor: 'pointer', color: row.fg, opacity: 0.85 }}>
                          {f.affected.length} affected preset{f.affected.length === 1 ? '' : 's'} — show list
                        </summary>
                        <ul style={{ margin: '6px 0 0 18px', fontSize: 11, color: '#c0c8d0' }}>
                          {f.affected.slice(0, 40).map((a, j) => <li key={j}>{a}</li>)}
                          {f.affected.length > 40 && <li>…and {f.affected.length - 40} more</li>}
                        </ul>
                      </details>
                    )}

                    {/* Developer notes — file paths, references, diagnostic
                        checks, anti-patterns. Collapsed so non-devs skim past,
                        but everything you need to sit down and fix is here. */}
                    {meta.dev && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 10, cursor: 'pointer', color: '#8aa0b8', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                          DEVELOPER NOTES
                        </summary>
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(0,0,0,0.25)', borderRadius: 4, fontSize: 11, color: '#c0c8d0', lineHeight: 1.55 }}>
                          {meta.dev.files?.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: '#8aa0b8', fontFamily: 'monospace', letterSpacing: '0.08em', marginBottom: 3 }}>FILES TO INSPECT</div>
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {meta.dev.files.map((x, k) => <li key={k} style={{ fontFamily: 'monospace', fontSize: 11 }}>{x}</li>)}
                              </ul>
                            </div>
                          )}
                          {meta.dev.refs?.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: '#8aa0b8', fontFamily: 'monospace', letterSpacing: '0.08em', marginBottom: 3 }}>REFERENCES</div>
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {meta.dev.refs.map((x, k) => <li key={k}>{x}</li>)}
                              </ul>
                            </div>
                          )}
                          {meta.dev.checks?.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <div style={{ fontSize: 10, color: '#8aa0b8', fontFamily: 'monospace', letterSpacing: '0.08em', marginBottom: 3 }}>DIAGNOSTIC CHECKS</div>
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {meta.dev.checks.map((x, k) => <li key={k}>{x}</li>)}
                              </ul>
                            </div>
                          )}
                          {meta.dev.antipatterns?.length > 0 && (
                            <div>
                              <div style={{ fontSize: 10, color: '#ff9a9a', fontFamily: 'monospace', letterSpacing: '0.08em', marginBottom: 3 }}>ANTI-PATTERNS (AVOID)</div>
                              <ul style={{ margin: 0, paddingLeft: 18, color: '#e8a0a0' }}>
                                {meta.dev.antipatterns.map((x, k) => <li key={k}>{x}</li>)}
                              </ul>
                            </div>
                          )}
                        </div>
                      </details>
                    )}

                    {/* Raw technical readout — rule ID + raw message */}
                    <details style={{ marginTop: 6 }}>
                      <summary style={{ fontSize: 10, cursor: 'pointer', color: '#8aa0b8', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
                        TECHNICAL DETAILS
                      </summary>
                      <div style={{ marginTop: 6, fontSize: 11, color: '#a8b0bc', fontFamily: 'monospace' }}>
                        rule: <span style={{ color: row.fg }}>{f.rule}</span>
                      </div>
                      <div style={{ marginTop: 2, fontSize: 11, color: '#a8b0bc' }}>{f.msg}</div>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={AP.toolbar}>
          {onReRun && (
            <button onClick={onReRun} disabled={sweeping}
                    style={{ ...AP.btnReRun, opacity: sweeping ? 0.5 : 1 }}
                    title={decision
                      ? 'Re-running will invalidate the current approval for this variant.'
                      : 'Clear queue, re-sweep every preset, re-analyze — one-click fix→verify loop'}>
              {sweeping ? '⏳ RE-RUNNING…' : (decision ? '🔁 RE-RUN (invalidates approval)' : '🔁 RE-RUN QC')}
            </button>
          )}
          <button onClick={onDownload} style={AP.btnPrimary} title="Save the markdown report for the conformance file">
            ⬇ DOWNLOAD REPORT (.md)
          </button>
          {onAcknowledge && (
            <button onClick={() => { setAckReason(''); setAckOpen(true); }}
                    style={AP.btnAck}
                    title="Ship despite findings — requires a short reason so there's a paper trail.">
              ⚠ ACKNOWLEDGE
            </button>
          )}
          {onApprove && (
            <button onClick={onApprove}
                    disabled={report.verdict !== 'ok'}
                    style={{
                      ...AP.btnApprove,
                      opacity: report.verdict === 'ok' ? 1 : 0.4,
                      cursor: report.verdict === 'ok' ? 'pointer' : 'not-allowed',
                    }}
                    title={report.verdict === 'ok'
                      ? 'Record this green sweep as the blessed artifact for this variant + build.'
                      : 'Approve is only available on a green verdict. Fix findings or use Acknowledge.'}>
              ✅ APPROVE
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={AP.btn}>CLOSE</button>
        </div>

        {ackOpen && (
          <AcknowledgeModal
            reason={ackReason}
            onReasonChange={setAckReason}
            onCancel={() => setAckOpen(false)}
            onConfirm={() => {
              onAcknowledge(ackReason);
              setAckOpen(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Decision chip — shown on the verdict banner when an approval or
// acknowledgment exists for this variant+SHA. Lives next to the variant
// chip so the state is obvious at a glance.
function DecisionChip({ decision }) {
  const approved = decision.decision === 'approved';
  const bg = approved ? 'rgba(30,120,50,0.35)' : 'rgba(160,110,30,0.35)';
  const fg = approved ? '#7fff8f' : '#ffc080';
  const when = (() => {
    try {
      const t = new Date(decision.at);
      return `${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;
    } catch { return ''; }
  })();
  return (
    <span title={decision.reason ? `Reason: ${decision.reason}` : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 10px',
        border: `1px solid ${fg}`, borderRadius: 3,
        color: fg, background: bg,
        fontFamily: 'monospace', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
      }}>
      {approved ? '✅ APPROVED' : '⚠ ACKNOWLEDGED'} · {when}
    </span>
  );
}

// ── Acknowledge-reason modal — reason is REQUIRED. Silent bypass would
// defeat the point of having a QC system at all; a short string is
// the minimum audit trail that survives the conversation.
function AcknowledgeModal({ reason, onReasonChange, onCancel, onConfirm }) {
  const trimmed = (reason || '').trim();
  const canConfirm = trimmed.length >= 5;
  return (
    <div onClick={onCancel} style={AP.ackBackdrop}>
      <div onClick={e => e.stopPropagation()} style={AP.ackShell}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#ffd07a', marginBottom: 6 }}>
          ⚠ Acknowledge findings
        </div>
        <div style={{ fontSize: 12, color: '#c0c8d0', marginBottom: 12, lineHeight: 1.5 }}>
          Shipping with findings is fine when you know why. Leave a short
          reason (tracking issue, known-expected, declared diagnostic,
          etc.) so the next person reading the .md understands the call.
        </div>
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          autoFocus
          placeholder="e.g. Declared diagnostic per capabilities.dryLegHasColoration — design-intent carve-out, not a bug."
          style={{
            width: '100%', minHeight: 90,
            background: 'rgba(10,14,20,0.85)',
            color: '#e0e4ea',
            border: '1px solid rgba(255,208,122,0.45)',
            borderRadius: 4,
            padding: '8px 10px',
            fontFamily: '"Inter", system-ui, sans-serif',
            fontSize: 12, lineHeight: 1.5,
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <div style={{ fontSize: 10, color: trimmed.length >= 5 ? '#7fff8f' : '#8aa0b8', fontFamily: 'monospace' }}>
            {trimmed.length} chars {trimmed.length < 5 ? '(min 5)' : ''}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} style={AP.btn}>CANCEL</button>
          <button onClick={onConfirm}
            disabled={!canConfirm}
            style={{ ...AP.btnAck, opacity: canConfirm ? 1 : 0.4, cursor: canConfirm ? 'pointer' : 'not-allowed' }}>
            ⚠ CONFIRM ACKNOWLEDGE
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Variant chip — the "you are here" indicator on the verdict banner ─────
function VariantChip({ version }) {
  const isV1 = version === 'v1';
  const c = isV1
    ? { bg: 'rgba(30,120,50,0.35)',  fg: '#7fff8f', bd: '#7fff8f', label: 'V1' }
    : { bg: 'rgba(160,110,30,0.35)', fg: '#ffc080', bd: '#ffc080', label: 'PROTOTYPE' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px',
      background: c.bg, color: c.fg,
      border: `1.5px solid ${c.bd}`,
      borderRadius: 3,
      fontFamily: 'monospace', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em',
    }}>
      {c.label}
    </span>
  );
}

// ── Confirm-variant popup — the safety gate on ANALYZE / RE-RUN ───────────
//
// Gates every analyzer run so the user has to explicitly acknowledge which
// engine version they're about to audit. Prevents the classic foot-gun of
// sweeping presets on PROTOTYPE and then mistakenly approving V1 —
// or vice-versa — because the version switcher isn't in direct eyeline.
function ConfirmVariantPopup({ action, version, productId, snapshotCount, sourceKind, onCancel, onConfirm }) {
  const isV1 = version === 'v1';
  const verb = action === 'rerun' ? 'Re-run' : 'Analyze';
  const variantLabel = isV1 ? 'V1' : 'PROTOTYPE';
  const tone = isV1
    ? { fg: '#7fff8f', bd: '#7fff8f', note: 'V1 is under review. A clean pass here clears it for approval.' }
    : { fg: '#ffc080', bd: '#ffc080', note: 'Prototype is the shipped baseline. Analyzing it measures — it does not re-approve it.' };

  // Sourceless sweep/analyze measures silence and produces meaningless data.
  // Hard-block the CONTINUE button in this case with an explicit fix-it
  // prompt. Only relevant for 'rerun' (which re-sweeps) — 'analyze' over an
  // already-captured queue doesn't need an active source.
  const needsSource    = action === 'rerun';
  const sourceMissing  = needsSource && !sourceKind;
  const continueLocked = sourceMissing;

  return (
    <div onClick={onCancel} style={AP.backdrop}>
      <div onClick={e => e.stopPropagation()} style={{ ...AP.shell, width: 'min(460px, 92vw)' }}>
        <div style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.24em', color: '#8aa0b8', marginBottom: 10 }}>
          CONFIRM — {verb.toUpperCase()}
        </div>

        <div style={{ fontSize: 15, marginBottom: 14, lineHeight: 1.5 }}>
          You're about to <b>{verb.toLowerCase()}</b> audio on:
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          padding: '14px 10px', marginBottom: 12,
          background: 'rgba(255,255,255,0.04)',
          border: `2px solid ${tone.bd}`,
          borderRadius: 5,
        }}>
          <span style={{ color: '#c0c8d0', fontSize: 15, fontWeight: 600 }}>{productId}</span>
          <span style={{ color: '#6a7888', fontSize: 14 }}>·</span>
          <span style={{ color: tone.fg, fontSize: 15, fontWeight: 800, letterSpacing: '0.12em', fontFamily: 'monospace' }}>
            {variantLabel}
          </span>
        </div>

        {/* Source-missing block — only fires on RE-RUN (which drives the
            actual sweep). Hard-blocks CONTINUE until they start a source. */}
        {sourceMissing && (
          <div style={{
            padding: '10px 12px', marginBottom: 12,
            background: 'rgba(255,80,80,0.10)',
            border: '1px solid #ff5050',
            borderRadius: 4, fontSize: 12, color: '#ff9a9a',
          }}>
            🔴 <b>No test source is playing.</b><br />
            A sweep without a source measures silence — the results will be meaningless.
            <br /><br />
            Close this dialog, then click <b>PINK</b> (or SWEEP / DRUMS / FILE) at the top of the drawer before re-running.
          </div>
        )}

        {/* Live source indicator when one IS playing, so users can confirm
            at a glance that they're about to measure against the right
            stimulus. */}
        {needsSource && sourceKind && (
          <div style={{
            padding: '8px 12px', marginBottom: 12,
            background: 'rgba(122,255,195,0.08)',
            border: '1px solid rgba(122,255,195,0.45)',
            borderRadius: 4, fontSize: 12, color: '#9affc3',
          }}>
            ▶ Test source: <b style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>{sourceKind}</b>
          </div>
        )}

        <div style={{ fontSize: 12, color: '#a8b4c0', marginBottom: 6 }}>
          {tone.note}
        </div>
        {action === 'analyze' && (
          <div style={{ fontSize: 12, color: '#8aa0b8', marginBottom: 6 }}>
            Queue currently holds <b style={{ color: '#cfd6dc' }}>{snapshotCount}</b> snapshot(s).
          </div>
        )}
        {action === 'rerun' && (
          <div style={{ fontSize: 12, color: '#8aa0b8', marginBottom: 6 }}>
            This clears the current audit queue and sweeps every preset again (~30 s).
          </div>
        )}

        <div style={{ ...AP.toolbar, marginTop: 14 }}>
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} style={AP.btn}>CANCEL</button>
          <button onClick={continueLocked ? undefined : onConfirm}
                  disabled={continueLocked}
                  title={continueLocked ? 'Start a test source first' : ''}
                  style={{
                    ...AP.btnPrimary,
                    color: continueLocked ? '#6a7888' : tone.fg,
                    borderColor: continueLocked ? '#444' : tone.bd,
                    background: continueLocked ? 'rgba(255,255,255,0.02)' : `${tone.bd}18`,
                    cursor: continueLocked ? 'not-allowed' : 'pointer',
                  }}>
            CONTINUE →
          </button>
        </div>
      </div>
    </div>
  );
}

const AP = {
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 5000,
    background: 'rgba(0,0,0,0.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: '"Inter", system-ui, sans-serif',
  },
  shell: {
    width: 'min(780px, 92vw)', maxHeight: '88vh',
    overflow: 'auto',
    background: '#0e1218', color: '#cfd6dc',
    border: '1px solid #2a2f3a',
    borderRadius: 6,
    padding: 18,
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
  },
  banner: {
    border: '2px solid', borderRadius: 5,
    padding: '14px 16px',
    marginBottom: 14,
  },
  section: { marginTop: 14 },
  sectionHead: {
    fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.24em',
    color: '#8aa0b8', marginBottom: 6,
  },
  table: {
    width: '100%', borderCollapse: 'collapse', fontSize: 12,
    fontFamily: 'monospace',
  },
  th: {
    textAlign: 'left', padding: '6px 8px',
    borderBottom: '1px solid #2a2f3a',
    color: '#7a8a9a', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em',
  },
  td: {
    padding: '5px 8px',
    borderBottom: '1px solid #1a1f28',
    color: '#c0c8d0',
  },
  finding: {
    border: '1px solid', borderRadius: 4,
    padding: '8px 10px',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    marginTop: 16, paddingTop: 12,
    borderTop: '1px solid #2a2f3a',
  },
  btn: {
    cursor: 'pointer', padding: '7px 14px',
    background: 'rgba(255,255,255,0.04)', color: '#cfd6dc',
    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  },
  btnPrimary: {
    cursor: 'pointer', padding: '7px 14px',
    background: 'rgba(127,180,255,0.12)', color: '#8fc1ff',
    border: '1px solid rgba(127,180,255,0.55)', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  },
  btnReRun: {
    cursor: 'pointer', padding: '7px 14px',
    background: 'rgba(122,255,195,0.12)', color: '#7affc3',
    border: '1px solid rgba(122,255,195,0.55)', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  },
  btnApprove: {
    cursor: 'pointer', padding: '7px 14px',
    background: 'rgba(30,120,50,0.35)', color: '#9affc3',
    border: '1px solid #50c080', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    boxShadow: '0 0 8px rgba(80,192,128,0.25)',
  },
  btnAck: {
    cursor: 'pointer', padding: '7px 14px',
    background: 'rgba(255,176,64,0.12)', color: '#ffd07a',
    border: '1px solid rgba(255,176,64,0.55)', borderRadius: 3,
    fontFamily: 'monospace', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
  },
  ackBackdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2100,
  },
  ackShell: {
    width: 'min(520px, 92vw)',
    padding: 18,
    background: 'linear-gradient(180deg, #121418 0%, #0e1014 100%)',
    border: '1px solid rgba(255,208,122,0.45)',
    borderRadius: 6,
    boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
    color: '#cfd6dc',
  },
  diffStrip: {
    marginBottom: 12,
    padding: '10px 12px',
    border: '1px solid',
    borderRadius: 5,
    background: 'rgba(255,255,255,0.02)',
  },
  historyStrip: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap',
    gap: 2, marginBottom: 12,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid #2a2f3a',
    borderRadius: 4,
  },
  code: {
    fontFamily: 'monospace', fontSize: 11,
    background: 'rgba(255,255,255,0.06)',
    padding: '1px 5px', borderRadius: 2,
  },
};

// ── live severity strip + null/GR readouts ─────────────────────────────────
function LiveChecks({ entries, values, engine, productId, stats, grDb }) {
  const paramSchema = Array.isArray(engine?.paramSchema) ? engine.paramSchema : null;
  let engineState = null;
  try { engineState = engine?.getState?.() ?? null; } catch {}
  const measurements = {
    pre:  { peakDb: stats.prePk,  rmsDb: stats.preRms },
    post: { peakDb: stats.postPk, rmsDb: stats.postRms },
  };
  const { severity, items } = runChecks({ entries, values, engineState, paramSchema, measurements, productId, engine });
  const sevColor = {
    critical: '#ff6a6a', major: '#ffae6a', minor: '#ffd87a',
    info: '#9affc3', cannot_verify: '#9aa9ff', ok: '#9affc3',
  };
  const badge = (text, color) => (
    <span style={{
      fontSize: 10, fontFamily: 'monospace', letterSpacing: 0.5,
      padding: '1px 6px', borderRadius: 3, marginRight: 6,
      border: `1px solid ${color}55`, color, background: `${color}11`,
    }}>{text}</span>
  );
  const grLine = (grDb.A !== null || grDb.B !== null)
    ? `GR A ${grDb.A !== null ? grDb.A.toFixed(1)+' dB' : '—'} · B ${grDb.B !== null ? grDb.B.toFixed(1)+' dB' : '—'}`
    : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4,
                  borderTop: '1px solid #1f1f28' }}>
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#888',
                    display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        {badge(severity.toUpperCase(), sevColor[severity] || '#888')}
        <span style={{ marginRight: 10 }}>
          <span style={ST.k}>NULL</span> {isFinite(stats.nullRmsDb) && stats.nullRmsDb > -200
            ? stats.nullRmsDb.toFixed(1) + ' dBFS' : '—'}
        </span>
        {grLine && <span style={{ marginRight: 10 }}>{grLine}</span>}
        <span style={{ color: '#555' }}>{items.length} check{items.length === 1 ? '' : 's'}</span>
      </div>
      {items.length > 0 && (
        <div style={{ fontSize: 10, fontFamily: 'monospace', maxHeight: 72,
                      overflowY: 'auto', paddingRight: 4 }}>
          {items.map((it, i) => (
            <div key={i} style={{ color: sevColor[it.severity] || '#aaa', lineHeight: 1.4 }}>
              <span style={{ opacity: 0.7 }}>[{it.severity}]</span> {it.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ST = {
  wrap: {
    background: '#121217', border: '1px solid #23232b', borderRadius: 6,
    padding: 8, margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 6,
  },
  tapsRow:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  canvasRow: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 },
  title: {
    fontSize: 11, letterSpacing: 1.5, color: '#888', fontWeight: 600,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  delta: { fontSize: 11, fontFamily: 'monospace', color: '#aaa', display: 'flex', alignItems: 'center' },
  freezeBtn: {
    fontSize: 10, fontFamily: 'monospace', letterSpacing: 1,
    padding: '3px 8px', borderRadius: 4, border: '1px solid #2a2a34',
    cursor: 'pointer', fontWeight: 600,
  },
  tap:   { display: 'flex', flexDirection: 'column', gap: 4 },
  tapHead: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    fontSize: 11, fontFamily: 'monospace',
  },
  readout: { color: '#cfcfd6', fontSize: 11 },
  subReadout: {
    display: 'flex', gap: 10, fontSize: 10, fontFamily: 'monospace',
    color: '#9a9aa4', paddingLeft: 2,
  },
  k:       { color: '#666', marginRight: 2 },
  unit:    { color: '#666', marginLeft: 4 },
  canvas:  { width: '100%', height: 'auto', borderRadius: 4, background: '#0a0a0c', display: 'block' },
};
