// OpListenPanel.jsx — in-page audio playback for per-op verification.
//
// Listening rig: pick a source (pink noise / drum loop / your own file),
// pick a port to drive (most ops are 'in', some are 'env' or 'cv'), pick a
// mode (THROUGH OP vs BYPASS for A/B), hit play, listen.
//
// Implementation note: instead of registering an AudioWorklet wrapper for
// each op (which would need a custom AudioWorkletProcessor compile per op),
// we render OFFLINE through the same browser worklet runner used by the
// behavioral metrics, then play the rendered buffer through AudioContext.
// Loops the rendered buffer for continuous playback. Cheap, reliable,
// works for every op the metrics do.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { runWorkletBrowser } from './behavioral/runners/run_worklet_browser.js';

const SR = 48000;
const RENDER_SECONDS = 4;       // loop length
const DRUM_LOOP_URL = '/MO_TENNY_110_drum_loop_break_curly.wav';

// Pink noise (Voss-McCartney) — 4 seconds, mono.
function makePinkNoise(N) {
  const out = new Float32Array(N);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < N; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

// Sine sweep 100 Hz → 5 kHz, 4 seconds.
function makeSweep(N, sr) {
  const out = new Float32Array(N);
  const f0 = 100, f1 = 5000, T = N / sr;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const f = f0 * Math.exp(Math.log(f1 / f0) * (t / T));
    const phase = 2 * Math.PI * f0 * (Math.exp(Math.log(f1 / f0) * (t / T)) - 1) / (Math.log(f1 / f0) / T);
    out[i] = 0.4 * Math.sin(phase);
  }
  return out;
}

// dBFS helpers for the meter strip.
function peakDbfs(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}
function rmsDbfs(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const r = Math.sqrt(s / Math.max(1, buf.length));
  return r > 0 ? 20 * Math.log10(r) : -Infinity;
}
function fmtDb(db) {
  if (!Number.isFinite(db)) return '−∞';
  return `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

// Pure 440 Hz sine — clean reference tone.
function makeSine(N, sr, f = 440, amp = 0.4) {
  const out = new Float32Array(N);
  const w = 2 * Math.PI * f / sr;
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin(w * i);
  return out;
}

// A-major triad: 220 + 277.18 + 329.63 Hz, equal-power summed.
function makeChord(N, sr) {
  const out = new Float32Array(N);
  const fs = [220, 277.18, 329.63];
  const amp = 0.3 / Math.sqrt(fs.length);
  for (const f of fs) {
    const w = 2 * Math.PI * f / sr;
    for (let i = 0; i < N; i++) out[i] += amp * Math.sin(w * i);
  }
  return out;
}

// 220 Hz band-limited square (DSF-ish, 12 odd harmonics rolled off) — rich
// harmonic content for revealing filter/saturation behaviour. Clean (no
// aliasing within audible band).
function makeSquare(N, sr) {
  const out = new Float32Array(N);
  const f0 = 220;
  const maxHarm = Math.min(31, Math.floor(sr / 2 / f0));
  for (let h = 1; h <= maxHarm; h += 2) {
    const w = 2 * Math.PI * (f0 * h) / sr;
    const amp = 0.5 / h;
    for (let i = 0; i < N; i++) out[i] += amp * Math.sin(w * i);
  }
  return out;
}

// Click train: 500 ms spacing, 2 ms cosine-windowed clicks @ 0.7 amplitude.
// Surfaces transient response of comp/dynamics/saturation.
function makeClicks(N, sr) {
  const out = new Float32Array(N);
  const interval = Math.round(0.5 * sr);
  const clickLen = Math.round(0.002 * sr);
  for (let start = 0; start + clickLen < N; start += interval) {
    for (let i = 0; i < clickLen; i++) {
      const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / clickLen);
      out[start + i] = 0.7 * env;
    }
  }
  return out;
}

let _drumLoopCache = null;
async function loadDrumLoop() {
  if (_drumLoopCache) return _drumLoopCache;
  try {
    const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, SR * RENDER_SECONDS, SR);
    const r = await fetch(DRUM_LOOP_URL);
    if (!r.ok) throw new Error(`drum loop fetch ${r.status}`);
    const arr = await r.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    // Mono-fold first channel, scale into our render length (loop or trim).
    const src = buf.getChannelData(0);
    const out = new Float32Array(SR * RENDER_SECONDS);
    for (let i = 0; i < out.length; i++) out[i] = src[i % src.length];
    _drumLoopCache = out;
    return out;
  } catch (e) {
    console.warn('[OpListenPanel] drum loop load failed:', e);
    return null;
  }
}

// For compressor / GR-cell ops we need to drive the CV input with a moving
// signal — otherwise the cell is silent (cv=0 = unity = inaudible). LFO-mod
// the CV at 4 Hz so you hear the gain pump.
//
// CV convention varies per cell:
//   - blackmerVCA: NEGATIVE cv = attenuation (so pump 0 → -12 dB)
//   - varMuTube / fetVVR / diodeBridgeGR: POSITIVE cv = compression depth
//     (so pump 0 → +1.0 ish, since these are unitless compression-depth scales,
//      not dB)
function makeCVPump(N, sr, peak = -12, rateHz = 4) {
  const out = new Float32Array(N);
  const w = 2 * Math.PI * rateHz / sr;
  for (let i = 0; i < N; i++) {
    const u = 0.5 - 0.5 * Math.cos(w * i);   // 0..1
    out[i] = peak * u;
  }
  return out;
}

export default function OpListenPanel({
  opId, params,
  defaultPort = 'in', cvPort = null, cvPumpPeak = -12,
  controlSignalOp = false,    // when true, show a banner saying listen test is informational only
}) {
  const [source, setSource] = useState('sine');         // see SOURCES list below
  const [mode, setMode] = useState('through');           // 'through' | 'bypass'
  const [driveCv, setDriveCv] = useState(true);          // for compressor cells
  const [inputGainDb, setInputGainDb] = useState(0);     // pre-op drive (to push clamp/sat/etc. into engagement)
  const [meters, setMeters] = useState(null);            // { in: {peakDb,rmsDb}, out: {peakDb,rmsDb} }
  const [showFlow, setShowFlow] = useState(false);       // info panel toggle
  const [playing, setPlaying] = useState(false);
  const [renderingMessage, setRenderingMessage] = useState(null);
  const [error, setError] = useState(null);
  const [userFile, setUserFile] = useState(null);        // { name, buffer: Float32Array }
  const ctxRef = useRef(null);
  const srcNodeRef = useRef(null);
  const gainRef = useRef(null);
  const renderedRef = useRef({ through: null, bypass: null, source: null });
  const [outGainDb, setOutGainDb] = useState(0);    // 0 dB = unity = "what's in the buffer is what you hear"

  const stop = useCallback(() => {
    // Fast ramp the current source's gain to zero before stopping, so we
    // don't hard-cut mid-cycle (= click). 8 ms ramp is below perceptual
    // threshold but long enough to kill the discontinuity.
    const ctx = ctxRef.current;
    const sn  = srcNodeRef.current;
    const gn  = gainRef.current;
    srcNodeRef.current = null;
    gainRef.current    = null;
    if (sn && ctx) {
      const t0 = ctx.currentTime;
      try {
        if (gn) {
          gn.gain.cancelScheduledValues(t0);
          gn.gain.setValueAtTime(gn.gain.value, t0);
          gn.gain.linearRampToValueAtTime(0, t0 + 0.008);
        }
        sn.stop(t0 + 0.012);
      } catch {
        try { sn.stop(); } catch {}
      }
    } else if (sn) {
      try { sn.stop(); } catch {}
    }
    setPlaying(false);
  }, []);

  useEffect(() => () => { stop(); ctxRef.current?.close().catch(() => {}); }, [stop]);

  const play = useCallback(async () => {
    setError(null);
    setRenderingMessage('rendering…');
    try {
      // 1. Build stimulus buffer based on source choice.
      const N = SR * RENDER_SECONDS;
      let stim;
      if (source === 'sine')   stim = makeSine(N, SR, 440, 0.4);
      else if (source === 'chord')  stim = makeChord(N, SR);
      else if (source === 'square') stim = makeSquare(N, SR);
      else if (source === 'clicks') stim = makeClicks(N, SR);
      else if (source === 'pink')   stim = makePinkNoise(N);
      else if (source === 'sweep')  stim = makeSweep(N, SR);
      else if (source === 'drum') {
        const loop = await loadDrumLoop();
        if (!loop) throw new Error('drum loop not loadable');
        stim = loop;
      } else if (source === 'file') {
        if (!userFile) throw new Error('drop an audio file first');
        stim = userFile.buffer;
      }

      // 2. Render through the op (or bypass).
      //    Input gain is applied ONLY in the through-op path, because the
      //    point of bypass is to hear the un-processed source. Otherwise
      //    bypass also gets driven and hits the destination's hard clip
      //    at ±1.0, making both modes sound identical at high IN GAIN.
      let processed;
      let driveStim = stim;     // what we feed the op (track for meters)
      if (mode === 'through') {
        if (inputGainDb !== 0) {
          const k = Math.pow(10, inputGainDb / 20);
          const driven = new Float32Array(stim.length);
          for (let i = 0; i < stim.length; i++) driven[i] = stim[i] * k;
          driveStim = driven;
        }
        const inputs = { [defaultPort]: driveStim };
        if (cvPort && driveCv) {
          inputs[cvPort] = makeCVPump(driveStim.length, SR, cvPumpPeak);
        }
        const r = await runWorkletBrowser(opId, params || {}, inputs, { sampleRate: SR });
        const outKey = Object.keys(r.outputs)[0];
        processed = r.outputs[outKey];
      } else {
        // Bypass = source as-is. No input gain. So you hear what the op had to chew on.
        processed = stim;
      }

      // 2b. Compute meter readings from the actual buffers we just rendered.
      // IN = what fed the op (driveStim if through, raw stim if bypass).
      // OUT = post-op buffer.
      setMeters({
        in:  { peakDb: peakDbfs(driveStim), rmsDb: rmsDbfs(driveStim) },
        out: { peakDb: peakDbfs(processed), rmsDb: rmsDbfs(processed) },
      });

      // 3. Set up AudioContext + BufferSourceNode for live playback.
      if (!ctxRef.current) {
        ctxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
      }
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      // Stop any prior playback.
      stop();

      // Apply a short cosine fade-in/out so the loop wraps seamlessly
      // (otherwise the last sample != first sample = audible click on every
      // buffer wrap). 10 ms each end, barely affects audible content.
      const FADE_S = 0.010;
      const fadeN = Math.min(Math.floor(FADE_S * SR), Math.floor(processed.length / 4));
      const looped = new Float32Array(processed.length);
      looped.set(processed);
      for (let i = 0; i < fadeN; i++) {
        const w = 0.5 - 0.5 * Math.cos(Math.PI * i / fadeN);    // 0 → 1
        looped[i] *= w;                                          // fade in
        looped[looped.length - 1 - i] *= w;                      // fade out (mirror)
      }
      const ab = ctx.createBuffer(1, looped.length, SR);
      ab.getChannelData(0).set(looped);
      const sn = ctx.createBufferSource();
      sn.buffer = ab;
      sn.loop = true;

      const gn = ctx.createGain();
      const targetGain = Math.pow(10, outGainDb / 20);
      // Fade IN the new source so transitioning between sources is click-free.
      const t0 = ctx.currentTime;
      gn.gain.setValueAtTime(0, t0);
      gn.gain.linearRampToValueAtTime(targetGain, t0 + 0.012);
      sn.connect(gn).connect(ctx.destination);
      sn.start();
      srcNodeRef.current = sn;
      gainRef.current = gn;
      setPlaying(true);
      setRenderingMessage(null);
    } catch (e) {
      setError(e.message);
      setRenderingMessage(null);
    }
  }, [opId, params, defaultPort, cvPort, cvPumpPeak, source, mode, inputGainDb, outGainDb, driveCv, userFile, stop]);

  // Live gain update without re-rendering.
  useEffect(() => {
    if (gainRef.current && ctxRef.current) {
      gainRef.current.gain.setTargetAtTime(Math.pow(10, outGainDb / 20),
        ctxRef.current.currentTime, 0.02);
    }
  }, [outGainDb]);

  // Re-render + swap audio buffer when mode/source changes during playback.
  // Mode + source switch immediately (button clicks → discrete state changes).
  // inputGainDb is debounced because dragging the slider would otherwise
  // trigger a re-render on every pixel of motion — zipper-fest.
  useEffect(() => {
    if (playing) play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, source, userFile]);    // userFile triggers replay when a new file is loaded with source already === 'file'

  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => { play(); }, 220);    // wait for slider to settle
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputGainDb]);

  const sources = [
    { id: 'sine',   label: 'Sine 440 Hz', tip: 'Pure tone — clearest reference for distortion/harmonics.' },
    { id: 'chord',  label: 'Chord',       tip: 'A-major triad — reveals IMD and tonal shift.' },
    { id: 'square', label: 'Square 220',  tip: 'Band-limited square — rich harmonics, exposes filtering.' },
    { id: 'clicks', label: 'Clicks',      tip: 'Transient train — surfaces dynamics/transient response.' },
    { id: 'pink',   label: 'Pink noise',  tip: 'Broadband — even spectral coverage.' },
    { id: 'sweep',  label: 'Sweep',       tip: 'Log sine sweep 100 Hz → 5 kHz.' },
    { id: 'drum',   label: 'Drum loop',   tip: 'Real drums (already has its own character).' },
    { id: 'file',   label: 'Drop file',   tip: 'Drop your own audio — decoded mono, 4-second loop.' },
  ];

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const arr = await file.arrayBuffer();
      // Use a placeholder OfflineAudioContext just for decodeAudioData; the
      // returned AudioBuffer carries the full file length regardless of ctx size.
      const ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, SR * 4, SR);
      const decoded = await ctx.decodeAudioData(arr);
      const ch0 = decoded.getChannelData(0);
      // Use the FULL decoded length — don't truncate. Mono-fold by taking ch0.
      // The buffer source loops it via .loop=true so short samples still loop
      // gaplessly, and long samples play their entire content end-to-end before
      // looping. Resampling: if the file was decoded at the AudioContext's
      // sample rate (which decodeAudioData does automatically), no further work.
      const out = new Float32Array(ch0.length);
      out.set(ch0);
      setUserFile({ name: file.name, buffer: out, durationSec: ch0.length / SR });
      setSource('file');
    } catch (e) {
      setError('Could not decode file: ' + e.message);
    }
  }, []);

  return (
    <div style={{
      padding: 14, marginBottom: 14, borderRadius: 6,
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.1)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.5)', fontWeight: 700, marginBottom: 10,
      }}>
        <span>Listen — gate 7 helper</span>
        <button
          onClick={() => setShowFlow(v => !v)}
          title="Show signal flow"
          style={{
            width: 18, height: 18, borderRadius: 9,
            border: '1px solid rgba(255,255,255,0.25)',
            background: showFlow ? 'rgba(217,159,207,0.2)' : 'transparent',
            color: showFlow ? '#d99fcf' : 'rgba(255,255,255,0.6)',
            fontSize: 11, fontFamily: 'system-ui',
            cursor: 'pointer', padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
          ?
        </button>
      </div>

      {/* Signal flow help panel — onboarding for new users so they don't
          confuse IN GAIN (drive into op) with MONITOR (listening volume). */}
      {showFlow && (
        <pre style={{
          margin: '0 0 12px 0', padding: 12,
          background: 'rgba(0,0,0,0.35)', borderRadius: 4,
          border: '1px solid rgba(217,159,207,0.25)',
          fontSize: 11, lineHeight: 1.5, color: 'rgba(255,255,255,0.8)',
          fontFamily: 'monospace', whiteSpace: 'pre',
        }}>{`[input source]
   ↓
[IN GAIN]   ← optional drive into the op
   ↓
[OP]        ← the thing being verified
   ↓
[meters]    ← what gets measured (and what tests run on)
   ↓
[MONITOR]   ← your listening volume (doesn't affect tests)
   ↓
[Speakers]`}</pre>
      )}
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginBottom: 12, lineHeight: 1.5 }}>
        Drives a test signal through the op's worklet (offline render, looped playback).
        A/B between THROUGH OP and BYPASS to confirm the op is doing what its declared
        behavior says. Driving port: <code style={{
          fontFamily: 'monospace',
          background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 3,
        }}>{defaultPort}</code>.
      </div>

      {/* Banner for control-signal ops where the listen test is informational only.
          These ops produce control signals (gain coefficients, envelopes, GR signals)
          rather than audio — playing them as audio doesn't reveal much. */}
      {controlSignalOp && (
        <div style={{
          padding: '10px 12px', marginBottom: 12, borderRadius: 4,
          background: 'rgba(229,184,90,0.08)',
          border: '1px solid rgba(229,184,90,0.45)',
          fontSize: 11, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5,
        }}>
          <span style={{
            fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
            color: '#e5b85a', fontWeight: 700, marginRight: 8,
          }}>Heads up</span>
          This is a <strong>control-signal op</strong> — it outputs a gain coefficient,
          envelope, or GR signal, not audio. Playing it through speakers will sound
          like silence or a low rumble. The math/curve test above is the real
          verification. Sign off based on the chart, not the ears.
        </div>
      )}

      {/* Source */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
                       color: 'rgba(255,255,255,0.4)', fontWeight: 700, marginRight: 4 }}>
          Source
        </span>
        {sources.map(s => (
          <button key={s.id} onClick={() => setSource(s.id)} title={s.tip}
            style={{
              fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
              fontWeight: 600, padding: '6px 10px', borderRadius: 4,
              background: source === s.id ? 'rgba(94,209,132,0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${source === s.id ? 'rgba(94,209,132,0.5)' : 'rgba(255,255,255,0.12)'}`,
              color: source === s.id ? '#5ed184' : 'rgba(255,255,255,0.6)', cursor: 'pointer',
            }}>{s.label}</button>
        ))}
      </div>

      {/* File drop zone — only renders when "Drop file" source is selected. */}
      {source === 'file' && (
        <div
          onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'rgba(94,209,132,0.6)'; }}
          onDragLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
          onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; handleFile(e.dataTransfer.files?.[0]); }}
          style={{
            padding: 14, marginBottom: 8, borderRadius: 6, textAlign: 'center',
            background: 'rgba(255,255,255,0.02)',
            border: '1.5px dashed rgba(255,255,255,0.15)',
            cursor: 'pointer',
          }}
          onClick={() => document.getElementById(`file-input-${opId}`)?.click()}
        >
          <input
            id={`file-input-${opId}`} type="file" accept="audio/*" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])}
          />
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
            {userFile
              ? <>Loaded: <code style={{ color: '#5ed184' }}>{userFile.name}</code>
                  {' · '}
                  <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {userFile.durationSec ? `${userFile.durationSec.toFixed(1)} s` : ''}
                  </span>
                  {' · click to swap'}
                </>
              : 'Drag an audio file here, or click to browse (any format the browser decodes — wav/mp3/ogg/flac/m4a)'}
          </div>
        </div>
      )}

      {/* Mode */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
                       color: 'rgba(255,255,255,0.4)', fontWeight: 700, alignSelf: 'center', marginRight: 4 }}>
          A/B
        </span>
        <button onClick={() => setMode('through')}
          style={{
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            fontWeight: 600, padding: '6px 10px', borderRadius: 4,
            background: mode === 'through' ? 'rgba(217,159,207,0.18)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${mode === 'through' ? 'rgba(217,159,207,0.55)' : 'rgba(255,255,255,0.12)'}`,
            color: mode === 'through' ? '#d99fcf' : 'rgba(255,255,255,0.6)', cursor: 'pointer',
          }}>Through op</button>
        <button onClick={() => setMode('bypass')}
          style={{
            fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            fontWeight: 600, padding: '6px 10px', borderRadius: 4,
            background: mode === 'bypass' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${mode === 'bypass' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)'}`,
            color: mode === 'bypass' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.6)', cursor: 'pointer',
          }}>Bypass</button>
      </div>

      {/* Input gain — push the signal hot to engage threshold-based ops. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
                       color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>In gain</span>
        <input type="range" min={-12} max={24} step={0.5} value={inputGainDb}
               onChange={e => setInputGainDb(parseFloat(e.target.value))}
               onDoubleClick={() => setInputGainDb(0)}
               style={{ flex: 1, maxWidth: 240 }}
               title="Pre-op drive — boost to push clamp/clip/saturator into engagement (double-click to reset to 0 dB)" />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)',
                       fontFamily: 'monospace', minWidth: 50 }}>
          {inputGainDb >= 0 ? '+' : ''}{inputGainDb.toFixed(1)} dB
        </span>
      </div>

      {/* Monitor — playback volume only, NOT a signal-chain stage. The IN/OUT
          meters below report the actual buffer levels (post-op), independent
          of this slider. Renamed from "OUT GAIN" because that read like an
          output-stage gain, which it isn't. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase',
                       color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}
              title="Playback volume — does NOT affect the metered output or what the harness measures.">
          Monitor
        </span>
        <input type="range" min={-30} max={6} step={0.5} value={outGainDb}
               onChange={e => setOutGainDb(parseFloat(e.target.value))}
               onDoubleClick={() => setOutGainDb(0)}
               style={{ flex: 1, maxWidth: 240 }}
               title="Listening volume only — does NOT affect tests or metered values (double-click to reset to 0 dB)" />
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)',
                       fontFamily: 'monospace', minWidth: 50 }}>
          {outGainDb >= 0 ? '+' : ''}{outGainDb.toFixed(1)} dB
        </span>
      </div>

      {/* Meter strip — IN vs OUT peak / RMS in dBFS, refreshed each render. */}
      {meters && (
        <div style={{
          display: 'grid', gridTemplateColumns: '50px 1fr 50px 1fr',
          gap: 10, marginBottom: 12, padding: '8px 10px',
          background: 'rgba(0,0,0,0.25)', borderRadius: 4,
          fontFamily: 'monospace', fontSize: 11,
        }}>
          <div style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em' }}>IN</div>
          <div style={{ color: '#5ed184' }}>
            peak {fmtDb(meters.in.peakDb)}
            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 14 }}>
              rms {fmtDb(meters.in.rmsDb)}
            </span>
          </div>
          <div style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em' }}>OUT</div>
          <div style={{ color: meters.out.peakDb > 0 ? '#e5b85a' : '#d99fcf' }}>
            peak {fmtDb(meters.out.peakDb)}
            {meters.out.peakDb > 0 && (
              <span style={{ marginLeft: 4, color: '#e5b85a' }}>⚠ over 0 dBFS</span>
            )}
            <span style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 14 }}>
              rms {fmtDb(meters.out.rmsDb)}
            </span>
          </div>
        </div>
      )}

      {/* Transport */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {!playing ? (
          <button onClick={play} disabled={renderingMessage != null}
            style={{
              fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
              fontWeight: 700, padding: '10px 18px', borderRadius: 6,
              background: 'rgba(94,209,132,0.18)',
              border: '1px solid rgba(94,209,132,0.55)',
              color: '#5ed184', cursor: 'pointer',
            }}>
            {renderingMessage || '▶ Play'}
          </button>
        ) : (
          <button onClick={stop}
            style={{
              fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase',
              fontWeight: 700, padding: '10px 18px', borderRadius: 6,
              background: 'rgba(217,159,207,0.18)',
              border: '1px solid rgba(217,159,207,0.55)',
              color: '#d99fcf', cursor: 'pointer',
            }}>
            ⏹ Stop
          </button>
        )}
        {playing && (
          <span style={{ fontSize: 10, color: '#5ed184', fontFamily: 'monospace',
                         letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            ● playing · {mode} · {source}
          </span>
        )}
      </div>

      {error && (
        <div style={{
          marginTop: 10, padding: 8, borderRadius: 4, fontSize: 11,
          background: 'rgba(217,159,207,0.08)', color: '#d99fcf',
          fontFamily: 'monospace',
        }}>{error}</div>
      )}
    </div>
  );
}
