// src/qc-harness/sources.js
// Deterministic test sources — all STEREO (2 channels) via AudioBufferSource
// so routing is reliable across browsers. ScriptProcessor is deprecated and
// mono-routes on some hosts.
//
// Stimulus calibration (QC convention — referenced by Analyzer checks):
//   pink  — -18 dBFS RMS        (gain staging, thresholds, mix, bypass)
//   drums — -10 dBFS peak       (attack/release, transient, dynamics)
//   sweep — 0.5 linear (amp)    (harmonics, tone, frequency response)

export const STIMULUS_TARGETS = Object.freeze({
  pink:  { kind: 'rms',  targetDb: -18, name: 'pink'  },
  drum:  { kind: 'peak', targetDb: -10, name: 'drum'  },
  sweep: { kind: 'peak', targetDb: -6,  name: 'sweep' },
  file:  { kind: 'file', targetDb: null, name: 'file' },
});

function _fillPink(data) {
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

// Measure RMS of a Float32Array.
function _rms(data) {
  let ss = 0;
  for (let i = 0; i < data.length; i++) ss += data[i] * data[i];
  return Math.sqrt(ss / data.length);
}
function _peak(data) {
  let m = 0;
  for (let i = 0; i < data.length; i++) {
    const a = data[i] < 0 ? -data[i] : data[i];
    if (a > m) m = a;
  }
  return m;
}
const DBFS_TO_LIN = (db) => Math.pow(10, db / 20);

export function createPinkNoise(ctx) {
  // Calibrated: loudness = -18 dBFS RMS (QC stimulus convention).
  // Pre-generate 4 seconds of independent L/R pink noise, trim to target, loop.
  const durSec = 4;
  const buf = ctx.createBuffer(2, ctx.sampleRate * durSec, ctx.sampleRate);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  _fillPink(L); _fillPink(R);
  const rms = 0.5 * (_rms(L) + _rms(R));
  const targetLin = DBFS_TO_LIN(-18);
  const scale = rms > 0 ? targetLin / rms : 1;
  for (let i = 0; i < L.length; i++) { L[i] *= scale; R[i] *= scale; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

export function createSineSweep(ctx, durationSec = 8, f0 = 20, f1 = 20000) {
  // Mono oscillator; upmix to stereo via a ChannelMerger so routing is
  // explicit. The oscillator's output is duplicated to L and R.
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const amp = ctx.createGain();
  amp.gain.value = 0.5;
  osc.frequency.setValueAtTime(f0, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + durationSec);
  const merger = ctx.createChannelMerger(2);
  osc.connect(amp);
  amp.connect(merger, 0, 0);
  amp.connect(merger, 0, 1);
  // Return a wrapper so stop()/disconnect()/start() all proxy to the osc.
  return {
    connect(dest) { merger.connect(dest); return dest; },
    disconnect()  { try { merger.disconnect(); } catch {} },
    start(when)   { osc.start(when); },
    stop(when)    { try { osc.stop(when); } catch {} },
  };
}

export function createDrumLoopStub(ctx) {
  // 4-bar pattern, stereo out. Returns a BufferSource so API matches others.
  const bpm = 120, beats = 16, sr = ctx.sampleRate;
  const beatSec = 60 / bpm;
  const durSec = beats * beatSec;
  const buf = ctx.createBuffer(2, Math.ceil(sr * durSec), sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);

  function addKick(t0) {
    const start = Math.floor(t0 * sr);
    const len = Math.floor(0.25 * sr);
    let phase = 0;
    for (let i = 0; i < len && start + i < L.length; i++) {
      const env = Math.exp(-i / (0.08 * sr));
      const f = 120 * Math.exp(-i / (0.05 * sr)) + 40;
      phase += (2 * Math.PI * f) / sr;
      const s = Math.sin(phase) * 0.9 * env;
      L[start + i] += s; R[start + i] += s;
    }
  }
  function addHat(t0) {
    const start = Math.floor(t0 * sr);
    const len = Math.floor(0.04 * sr);
    for (let i = 0; i < len && start + i < L.length; i++) {
      const env = 1 - i / len;
      const n = (Math.random() * 2 - 1) * 0.25 * env;
      L[start + i] += n; R[start + i] += n;
    }
  }

  for (let b = 0; b < beats; b++) {
    const t = b * beatSec;
    if (b % 4 === 0) addKick(t);
    if (b % 2 === 1) addHat(t);
  }

  // Calibrated: peak = -10 dBFS (QC stimulus convention for transient material).
  const pk = Math.max(_peak(L), _peak(R));
  const targetLin = DBFS_TO_LIN(-10);
  const scale = pk > 0 ? targetLin / pk : 1;
  for (let i = 0; i < L.length; i++) { L[i] *= scale; R[i] *= scale; }

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

export async function loadFileAsSource(ctx, file) {
  const arr = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}
