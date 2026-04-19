// src/qc-harness/sources.js
// Deterministic test sources for the QC harness. No music bias, just signal.

export function createPinkNoise(ctx) {
  const node = ctx.createScriptProcessor(4096, 0, 2);
  // Paul Kellet's pink noise algorithm.
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  node.onaudioprocess = (e) => {
    const L = e.outputBuffer.getChannelData(0);
    const R = e.outputBuffer.getChannelData(1);
    for (let i = 0; i < L.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
      L[i] = pink; R[i] = pink;
    }
  };
  return node;
}

export function createSineSweep(ctx, durationSec = 8, f0 = 20, f1 = 20000) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + durationSec);
  return osc;
}

export function createDrumLoopStub(ctx) {
  // Simple kick+hat pattern at 120 BPM using oscillators — substitute for a
  // real loop until the user drops in a file.
  const out = ctx.createGain();
  const bpm = 120, beat = 60 / bpm;
  const now = ctx.currentTime + 0.05;
  for (let bar = 0; bar < 64; bar++) {
    const t = now + bar * beat;
    // Kick on 1
    if (bar % 4 === 0) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + 0.3);
    }
    // Hat every 8th
    if (bar % 2 === 1) {
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      noise.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      noise.connect(hp).connect(g).connect(out);
      noise.start(t);
    }
  }
  return out;
}

export async function loadFileAsSource(ctx, file) {
  const arr = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}
