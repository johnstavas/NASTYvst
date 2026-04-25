// op_yin.test.js — YIN pitch detector math tests.
// Run via: node scripts/check_op_math.mjs
// Primary: de Cheveigné & Kawahara 2002 JASA 111(4):1917–1930.

import { YinOp } from './op_yin.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new YinOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, input, N) {
  const f0 = new Float32Array(N);
  const c  = new Float32Array(N);
  op.process({ in: input }, { f0, confidence: c }, N);
  return { f0, c };
}

function sine(N, freq, sr = SR, amp = 0.5) {
  const out = new Float32Array(N);
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin(i * w);
  return out;
}

// Harmonic complex tone — stress test Step 4 "too-high" resistance.
function harmonic(N, f0, sr = SR) {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    out[i] = 0.5 * Math.sin(2*Math.PI * f0 * t)
           + 0.3 * Math.sin(2*Math.PI * 2*f0 * t)
           + 0.2 * Math.sin(2*Math.PI * 3*f0 * t);
  }
  return out;
}

// Run long enough to produce several frames and return the last reading.
function lastReading(op, buf) {
  const { f0, c } = render(op, buf, buf.length);
  return { f0: f0[buf.length - 1], conf: c[buf.length - 1] };
}

const tests = [
  {
    name: 'silence → f0=0, confidence=0 for first window',
    run() {
      const op = freshOp({});
      const N = op.W + 128;
      const sil = new Float32Array(N);
      const { f0, c } = render(op, sil, N);
      // Before first frame completes, both should be 0.
      for (let i = 0; i < op.W; i++) {
        if (f0[i] !== 0 || c[i] !== 0) return { pass: false, why: `i=${i} f0=${f0[i]} c=${c[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: '440 Hz sine → f0 ≈ 440 Hz (±1 Hz)',
    run() {
      const op = freshOp({});
      const N = 4 * op.W;
      const { f0 } = lastReading(op, sine(N, 440));
      if (Math.abs(f0 - 440) > 1) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: '220 Hz sine → f0 ≈ 220 Hz (±1 Hz)',
    run() {
      const op = freshOp({});
      const N = 4 * op.W;
      const { f0 } = lastReading(op, sine(N, 220));
      if (Math.abs(f0 - 220) > 1) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: '880 Hz sine → f0 ≈ 880 Hz (±2 Hz)',
    run() {
      const op = freshOp({});
      const N = 4 * op.W;
      const { f0 } = lastReading(op, sine(N, 880));
      if (Math.abs(f0 - 880) > 2) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'harmonic complex @ 220 Hz → f0 ≈ 220 Hz (no octave error)',
    run() {
      const op = freshOp({});
      const N = 4 * op.W;
      const { f0 } = lastReading(op, harmonic(N, 220));
      if (Math.abs(f0 - 220) > 2) return { pass: false, why: `f0=${f0.toFixed(3)} (octave error?)` };
      return { pass: true };
    },
  },
  {
    name: 'confidence high for pure tone (>0.85)',
    run() {
      const op = freshOp({});
      const N = 4 * op.W;
      const { conf } = lastReading(op, sine(N, 440));
      if (conf < 0.85) return { pass: false, why: `conf=${conf.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'confidence low for white noise (<0.7)',
    run() {
      const op = freshOp({});
      const N = 4 * op.W;
      const noise = new Float32Array(N);
      let s = 1;
      for (let i = 0; i < N; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        noise[i] = ((s / 0xFFFFFFFF) - 0.5) * 0.4;
      }
      const { conf } = lastReading(op, noise);
      if (conf >= 0.7) return { pass: false, why: `conf=${conf.toFixed(3)} (should be low)` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 4 * 1200;
      const sig = sine(N, 330);
      const a = render(freshOp({}), sig, N);
      const b = render(freshOp({}), sig, N);
      for (let i = 0; i < N; i++) {
        if (a.f0[i] !== b.f0[i] || a.c[i] !== b.c[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state',
    run() {
      const op = freshOp({});
      render(op, sine(4 * op.W, 440), 4 * op.W);
      op.reset();
      const N = op.W + 64;
      const { f0, c } = render(op, new Float32Array(N), N);
      for (let i = 0; i < op.W; i++) if (f0[i] !== 0 || c[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('f0Min', 999999); op.setParam('f0Min', -1); op.setParam('f0Min', NaN);
      op.setParam('f0Max', 999999); op.setParam('f0Max', -1);
      op.setParam('threshold', 99); op.setParam('threshold', -1);
      op.setParam('windowMs', 99999); op.setParam('windowMs', -1); op.setParam('windowMs', Infinity);
      const N = 4 * op.W;
      const { f0, c } = render(op, sine(N, 330), N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(f0[i]) || !Number.isFinite(c[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence output, no throw',
    run() {
      const op = freshOp({});
      try {
        const f0 = new Float32Array(256), c = new Float32Array(256);
        op.process({}, { f0, confidence: c }, 256);
        for (let i = 0; i < 256; i++) if (f0[i] !== 0 || c[i] !== 0) return { pass: false, why: `i=${i}` };
      } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: sine(128, 440) }, {}, 128); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() == W (25 ms @ 48k = 1200)',
    run() {
      const op = freshOp({});
      const expected = Math.round(0.025 * SR);
      if (op.getLatencySamples() !== expected) {
        return { pass: false, why: `got ${op.getLatencySamples()} expected ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'threshold=0.01 forces local-min-descent path (stable)',
    run() {
      const op = freshOp({ threshold: 0.01 });
      const N = 4 * op.W;
      const { f0 } = lastReading(op, sine(N, 440));
      if (!Number.isFinite(f0) || f0 <= 0) return { pass: false, why: `f0=${f0}` };
      if (Math.abs(f0 - 440) > 2) return { pass: false, why: `f0=${f0.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'paper Step 4 canonical threshold=0.1 recovers 440 Hz within ±0.5 Hz',
    run() {
      const op = freshOp({ threshold: 0.1 });
      const N = 4 * op.W;
      const { f0 } = lastReading(op, sine(N, 440));
      if (Math.abs(f0 - 440) > 0.5) return { pass: false, why: `f0=${f0.toFixed(4)}` };
      return { pass: true };
    },
  },
];

export default { opId: 'yin', tests };
