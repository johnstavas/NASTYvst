// op_ER.test.js — math tests for #21 ER.
// Primary: JOS PASP Early Reflections + Tapped Delay Lines.

import { EROp } from './op_ER.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new EROp(SR);
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

const tests = [
  {
    name: 'impulse produces sparse reflections in first ~100 ms window',
    run() {
      // mix=1 wet-only, airHz high to avoid smearing impulses.
      const op = freshOp({ roomSize: 1, airHz: 15000, level: 1, mix: 1 });
      const out = drive(op, (n) => n === 0 ? 1 : 0, 6000);
      // Expect ≥ 8 distinguishable positive peaks within first 100 ms
      // (4800 samples at 48 kHz). Count samples where local value > 0.03.
      let peaks = 0;
      for (let i = 1; i < 4800; i++) {
        if (out[i] > 0.03 && out[i] > out[i - 1] && out[i] > out[i + 1]) peaks++;
      }
      if (peaks < 8) return { pass: false, why: `only ${peaks} peaks in first 100 ms` };
      return { pass: true };
    },
  },
  {
    name: 'first reflection arrives after ~5 ms (smallest tap)',
    run() {
      const op = freshOp({ roomSize: 1, airHz: 15000, level: 1, mix: 1 });
      const out = drive(op, (n) => n === 0 ? 1 : 0, 1000);
      // First 5 ms ≈ 240 samples. First tap at 5.3 ms ≈ 254 samples.
      // Samples before 200 should be ~zero (nothing reaches wet path yet).
      for (let i = 0; i < 200; i++) {
        if (Math.abs(out[i]) > 1e-6) return { pass: false, why: `early energy at ${i}: ${out[i]}` };
      }
      // Energy should be non-zero by sample 300.
      let found = false;
      for (let i = 200; i < 400; i++) {
        if (Math.abs(out[i]) > 0.01) { found = true; break; }
      }
      if (!found) return { pass: false, why: 'no first reflection' };
      return { pass: true };
    },
  },
  {
    name: 'roomSize scales tap times',
    run() {
      const small = freshOp({ roomSize: 0.5, airHz: 15000, mix: 1 });
      const large = freshOp({ roomSize: 2.0, airHz: 15000, mix: 1 });
      const outS = drive(small, (n) => n === 0 ? 1 : 0, 10000);
      const outL = drive(large, (n) => n === 0 ? 1 : 0, 10000);
      // Last tap at roomSize=0.5 ≈ 39.65 ms (1903 samples), at 2.0 ≈ 158.6 ms (7613 samples).
      // Small: energy should be near-zero by sample 4000; large: still active.
      const tailSmall = rms(outS, 4000, 10000);
      const tailLarge = rms(outL, 4000, 10000);
      if (tailSmall >= tailLarge * 0.5) return { pass: false, why: `small tail ${tailSmall} should be << large ${tailLarge}` };
      return { pass: true };
    },
  },
  {
    name: 'airHz: lower cutoff reduces HF content',
    run() {
      const bright = freshOp({ airHz: 15000, mix: 1 });
      const dark   = freshOp({ airHz: 2000,  mix: 1 });
      const sig = (n) => Math.sin(2 * Math.PI * 8000 * n / SR);
      const b = drive(bright, sig, 4000);
      const d = drive(dark,   sig, 4000);
      const rB = rms(b, 1000, 4000);
      const rD = rms(d, 1000, 4000);
      if (rD >= rB * 0.6) return { pass: false, why: `dark ${rD} not << bright ${rB} at 8k` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ mix: 1, level: 1 });
      const out = drive(op, () => 0, 3000);
      for (let i = 0; i < 3000; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → pure dry passthrough',
    run() {
      const op = freshOp({ mix: 0, level: 1 });
      const sig = (n) => Math.sin(2 * Math.PI * 440 * n / SR);
      const out = drive(op, sig, 2000);
      for (let i = 0; i < 2000; i++) {
        const expected = sig(i);
        if (Math.abs(out[i] - expected) > 1e-5) return { pass: false, why: `diverge at ${i}: ${out[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'level=0 → wet path silent, dry unaffected at mix=1',
    run() {
      const op = freshOp({ mix: 1, level: 0 });
      const out = drive(op, (n) => n === 0 ? 1 : 0, 2000);
      for (let i = 0; i < 2000; i++) if (Math.abs(out[i]) > 1e-9) return { pass: false, why: `level=0 leak at ${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const sig = (n) => Math.sin(n * 0.03) + 0.3 * Math.sin(n * 0.13);
      const a = drive(freshOp({ roomSize: 1.2, airHz: 6000, mix: 0.7 }), sig, 4000);
      const b = drive(freshOp({ roomSize: 1.2, airHz: 6000, mix: 0.7 }), sig, 4000);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears delay line',
    run() {
      const op = freshOp({ mix: 1 });
      drive(op, (n) => n === 0 ? 1 : 0, 3000);
      op.reset();
      const out = drive(op, () => 0, 3000);
      for (let i = 0; i < 3000; i++) if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'roomSize clamp [0.25, 2.0]',
    run() {
      const op = freshOp();
      op.setParam('roomSize', 10);
      if (op._roomSize !== 2.0) return { pass: false, why: `hi clamp: ${op._roomSize}` };
      op.setParam('roomSize', 0.001);
      if (op._roomSize !== 0.25) return { pass: false, why: `lo clamp: ${op._roomSize}` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud wideband input stays finite',
    run() {
      const op = freshOp({ roomSize: 1.5, airHz: 8000, level: 2, mix: 1 });
      const out = drive(op, () => Math.random() * 2 - 1, SR);
      let maxAbs = 0;
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > maxAbs) maxAbs = Math.abs(out[i]);
      }
      if (maxAbs > 50) return { pass: false, why: `maxAbs=${maxAbs}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output',
    run() {
      const op = freshOp({ mix: 1 });
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
  {
    name: 'latency = 0',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
];

export default { opId: 'ER', tests };
