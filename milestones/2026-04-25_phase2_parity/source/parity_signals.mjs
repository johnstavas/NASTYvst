// parity_signals.mjs — deterministic test-signal generators.
// Per memory/codegen_pipeline_buildout.md § 5.3.
//
// Every generator returns a Float32Array. Results are bit-reproducible across
// platforms (no Math.random — uses a seeded mulberry32 PRNG).

import { readFileSync, writeFileSync } from 'node:fs';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

export function impulse(N = 4096) {
  const x = new Float32Array(N);
  x[0] = 1.0;
  return x;
}

export function dcStep(N = 4096, level = 1.0) {
  const x = new Float32Array(N);
  x.fill(level);
  return x;
}

export function silence(N = 4096) {
  return new Float32Array(N);
}

export function sine(N, sr, freq, amp = 0.5) {
  const x = new Float32Array(N);
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < N; i++) x[i] = amp * Math.sin(w * i);
  return x;
}

export function sineSweep(N, sr, f0 = 20, f1 = 20000, amp = 0.5) {
  // exp sweep, classic Farina
  const x = new Float32Array(N);
  const T = N / sr;
  const K = (T * 2 * Math.PI * f0) / Math.log(f1 / f0);
  const L = T / Math.log(f1 / f0);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    x[i] = amp * Math.sin(K * (Math.exp(t / L) - 1));
  }
  return x;
}

export function pinkNoise(N, seed = 0xC0FFEE, amp = 0.25) {
  // Voss-McCartney, 16 octaves, seeded.
  const rnd = mulberry32(seed);
  const NUM = 16;
  const rows = new Float32Array(NUM);
  let runningSum = 0;
  let counter = 1;
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let n = counter;
    let k = 0;
    while ((n & 1) === 0 && k < NUM - 1) { n >>= 1; k++; }
    const newVal = rnd() * 2 - 1;
    runningSum += newVal - rows[k];
    rows[k] = newVal;
    const white = rnd() * 2 - 1;
    x[i] = amp * (runningSum + white) / (NUM + 1);
    counter++;
  }
  return x;
}

export function twoTone(N, sr, f1 = 440, f2 = 1000, amp = 0.4) {
  const x = new Float32Array(N);
  const w1 = 2 * Math.PI * f1 / sr;
  const w2 = 2 * Math.PI * f2 / sr;
  for (let i = 0; i < N; i++) x[i] = amp * (Math.sin(w1 * i) + Math.sin(w2 * i)) * 0.5;
  return x;
}

export function burst(N, sr) {
  // silence, loud sine 1 kHz, silence — 1/3 each
  const x = new Float32Array(N);
  const seg = (N / 3) | 0;
  const w = 2 * Math.PI * 1000 / sr;
  for (let i = seg; i < 2 * seg; i++) x[i] = 0.8 * Math.sin(w * (i - seg));
  return x;
}

// ─── canonical registry ────────────────────────────────────────────────
export const CANON_SIGNALS = {
  impulse:    () => impulse(4096),
  dc_step:    () => dcStep(4096),
  silence:    () => silence(4096),
  sine_440:   () => sine(16384, 48000, 440),
  sweep:      () => sineSweep(65536, 48000),
  pink_noise: () => pinkNoise(65536),
  two_tone:   () => twoTone(16384, 48000),
  burst:      () => burst(16384, 48000),
};

// ─── WAV writer (16-bit PCM, mono, sr=48k by default) ──────────────────
export function writeWav(path, samples, sr = 48000) {
  const buf = Buffer.alloc(44 + samples.length * 4);
  // RIFF
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 4, 4);
  buf.write('WAVE', 8);
  // fmt  (Float32 = format 3)
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);   // IEEE float
  buf.writeUInt16LE(1, 22);   // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(32, 34);
  // data
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4);

  writeFileSync(path, buf);
}

export function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not RIFF');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not WAVE');
  // walk chunks
  let p = 12;
  let fmt = null;
  let data = null;
  while (p < buf.length) {
    const id   = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      fmt = {
        format:   buf.readUInt16LE(p + 8),
        channels: buf.readUInt16LE(p + 10),
        sr:       buf.readUInt32LE(p + 12),
        bits:     buf.readUInt16LE(p + 22),
      };
    } else if (id === 'data') {
      data = buf.slice(p + 8, p + 8 + size);
    }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('missing fmt/data');
  const N = (data.length / (fmt.bits / 8)) | 0;
  const out = new Float32Array(N);
  if (fmt.format === 3 && fmt.bits === 32) {
    for (let i = 0; i < N; i++) out[i] = data.readFloatLE(i * 4);
  } else if (fmt.format === 1 && fmt.bits === 16) {
    for (let i = 0; i < N; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  } else {
    throw new Error(`unsupported wav format=${fmt.format} bits=${fmt.bits}`);
  }
  return { samples: out, sr: fmt.sr, channels: fmt.channels };
}
