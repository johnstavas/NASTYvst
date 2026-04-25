// op_pitchShift.test.js — math tests for #28 pitchShift.
// Primary: Bernsee smbPitchShift.cpp.

import { PitchShiftOp } from './op_pitchShift.worklet.js';

const SR = 48000;
const LATENCY = 1536; // FFT_SIZE - STEP_SIZE

function freshOp(params = {}) {
  const op = new PitchShiftOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, signalFn, nSamples) {
  const CHUNK = 256;
  const out = new Float32Array(nSamples);
  let pos = 0;
  while (pos < nSamples) {
    const c = Math.min(CHUNK, nSamples - pos);
    const inp = new Float32Array(c);
    for (let i = 0; i < c; i++) inp[i] = signalFn(pos + i);
    const bOut = new Float32Array(c);
    op.process({ in: inp }, { out: bOut }, c);
    out.set(bOut, pos);
    pos += c;
  }
  return out;
}

function rms(buf, from = 0, to = buf.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

// Estimate dominant frequency via zero-crossing density.
function zcFreq(buf, from, to, sr) {
  let zc = 0;
  for (let i = from + 1; i < to; i++) {
    if ((buf[i - 1] < 0 && buf[i] >= 0) || (buf[i - 1] >= 0 && buf[i] < 0)) zc++;
  }
  return (zc / 2) * sr / (to - from);
}

const tests = [
  {
    name: 'latency reported = FFT_SIZE - STEP_SIZE',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== LATENCY) return { pass: false, why: `lat=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'unison (pitch=1) passes sine through with ~correct frequency',
    run() {
      const op = freshOp({ pitch: 1.0, mix: 1.0 });
      const f = 440;
      const out = drive(op, (n) => Math.sin(2 * Math.PI * f * n / SR), SR);
      // Skip initial latency + first few frames for phase-vocoder warmup.
      const est = zcFreq(out, LATENCY + 4096, SR, SR);
      if (Math.abs(est - f) > 20) return { pass: false, why: `est=${est.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'octave up (pitch=2) doubles dominant frequency',
    run() {
      const op = freshOp({ pitch: 2.0, mix: 1.0 });
      const f = 300;
      const out = drive(op, (n) => Math.sin(2 * Math.PI * f * n / SR), SR);
      const est = zcFreq(out, LATENCY + 4096, SR, SR);
      if (Math.abs(est - 2 * f) > 50) return { pass: false, why: `est=${est.toFixed(2)} expected ~${2*f}` };
      return { pass: true };
    },
  },
  {
    name: 'octave down (pitch=0.5) halves dominant frequency',
    run() {
      const op = freshOp({ pitch: 0.5, mix: 1.0 });
      const f = 800;
      const out = drive(op, (n) => Math.sin(2 * Math.PI * f * n / SR), SR);
      const est = zcFreq(out, LATENCY + 4096, SR, SR);
      if (Math.abs(est - 0.5 * f) > 30) return { pass: false, why: `est=${est.toFixed(2)} expected ~${0.5*f}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ pitch: 1.5, mix: 1.0 });
      const out = drive(op, () => 0, SR);
      for (let i = 0; i < SR; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → pure dry passthrough',
    run() {
      const op = freshOp({ pitch: 2.0, mix: 0 });
      const sig = (n) => Math.sin(2 * Math.PI * 440 * n / SR);
      const out = drive(op, sig, 4000);
      for (let i = 0; i < 4000; i++) {
        if (Math.abs(out[i] - sig(i)) > 1e-5) return { pass: false, why: `diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const sig = (n) => Math.sin(n * 0.017) + 0.3 * Math.sin(n * 0.053);
      const a = drive(freshOp({ pitch: 1.3, mix: 1.0 }), sig, 8000);
      const b = drive(freshOp({ pitch: 1.3, mix: 1.0 }), sig, 8000);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears all state',
    run() {
      const op = freshOp({ pitch: 1.5, mix: 1.0 });
      drive(op, (n) => Math.sin(2 * Math.PI * 440 * n / SR), SR);
      op.reset();
      const out = drive(op, () => 0, SR);
      for (let i = 0; i < SR; i++) if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'pitch clamp [0.25, 4.0]',
    run() {
      const op = freshOp();
      op.setParam('pitch', 100);
      if (op._pitch !== 4.0) return { pass: false, why: `hi=${op._pitch}` };
      op.setParam('pitch', 0.0001);
      if (op._pitch !== 0.25) return { pass: false, why: `lo=${op._pitch}` };
      return { pass: true };
    },
  },
  {
    name: 'stability under loud wideband input',
    run() {
      const op = freshOp({ pitch: 1.7, mix: 1.0 });
      const out = drive(op, () => Math.random() * 2 - 1, SR);
      let maxAbs = 0;
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > maxAbs) maxAbs = Math.abs(out[i]);
      }
      if (maxAbs > 10) return { pass: false, why: `maxAbs=${maxAbs}` };
      return { pass: true };
    },
  },
  {
    name: 'output RMS bounded vs input (no runaway gain)',
    run() {
      const op = freshOp({ pitch: 1.5, mix: 1.0 });
      const sig = (n) => 0.5 * Math.sin(2 * Math.PI * 440 * n / SR);
      const out = drive(op, sig, SR);
      const rOut = rms(out, LATENCY + 2048, SR);
      if (rOut > 1.5) return { pass: false, why: `rmsOut=${rOut}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output',
    run() {
      const op = freshOp({ pitch: 1.5, mix: 1.0 });
      const out = new Float32Array(512);
      op.process({}, { out }, 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(out[i]) || out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
];

export default { opId: 'pitchShift', tests };
