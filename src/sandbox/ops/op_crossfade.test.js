// op_crossfade.test.js — real-math tests for op_crossfade.
// Primary: cos/sin equal-power law (Blumlein 1933; Bauer 1961).
// Precedent: op_mix.worklet.js:43–46.

import { CrossfadeOp } from './op_crossfade.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new CrossfadeOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function run(op, inputs, nSamples) {
  const out = new Float32Array(nSamples);
  op.process(inputs, { out }, nSamples);
  return out;
}

function sine(freqHz, amp = 0.5) {
  return (n) => amp * Math.sin(2 * Math.PI * freqHz * n / SR);
}

function rms(buf) {
  let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function fill(fn, N) {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) b[i] = fn(i);
  return b;
}

const tests = [
  {
    name: 'position=0 → pure A (gA=1, gB=0)',
    run() {
      const N = 16;
      const a = fill((i) => 0.1 * (i + 1), N);
      const b = fill((i) => 99, N);
      const out = run(freshOp({ position: 0 }), { a, b }, N);
      for (let i = 0; i < N; i++) if (Math.abs(out[i] - a[i]) > 1e-6) return { pass: false, why: `[${i}] ${out[i]} vs ${a[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'position=1 → pure B (gA=0, gB=1)',
    run() {
      const N = 16;
      const a = fill((i) => 99, N);
      const b = fill((i) => 0.2 * (i + 1), N);
      const out = run(freshOp({ position: 1 }), { a, b }, N);
      for (let i = 0; i < N; i++) if (Math.abs(out[i] - b[i]) > 1e-6) return { pass: false, why: `[${i}] ${out[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'position=0.5 → gA = gB = cos(π/4) = 1/√2',
    run() {
      const N = 16;
      const a = fill((_) => 1, N);
      const b = fill((_) => 1, N);
      const out = run(freshOp({ position: 0.5 }), { a, b }, N);
      const exp = Math.SQRT1_2 + Math.SQRT1_2;  // ≈ 1.4142
      for (let i = 0; i < N; i++) if (Math.abs(out[i] - exp) > 1e-5) return { pass: false, why: `[${i}] ${out[i]} vs ${exp}` };
      return { pass: true };
    },
  },
  {
    name: 'constant power law — uncorrelated equal-RMS A,B: total RMS invariant',
    run() {
      // For UNCORRELATED signals, sum-RMS = √(a²·gA² + b²·gB²) = gA²+gB² = 1
      // independent of position. Use two different sine frequencies → uncorrelated
      // on long buffers.
      const N = 8192;
      const a = fill(sine(440, 0.5), N);
      const b = fill(sine(631, 0.5), N);  // non-harmonically related → ~uncorrelated
      // Constant-power: out RMS² ≈ rms²·(gA²+gB²) = rms² for equal-RMS A,B.
      const baseline = rms(a);
      for (const pos of [0, 0.25, 0.5, 0.75, 1]) {
        const out = run(freshOp({ position: pos }), { a, b }, N);
        const r = rms(out);
        // Cross-terms average to ~0 on long uncorrelated buffers.
        if (Math.abs(r - baseline) > 0.02) return { pass: false, why: `pos=${pos}: RMS ${r.toFixed(4)} vs baseline ${baseline.toFixed(4)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'position clamps to [0, 1]',
    run() {
      const N = 8;
      const a = fill((_) => 1, N);
      const b = fill((_) => 99, N);
      const outLo = run(freshOp({ position: -5 }), { a, b }, N);
      for (let i = 0; i < N; i++) if (Math.abs(outLo[i] - 1) > 1e-6) return { pass: false, why: `neg clamp: out[${i}]=${outLo[i]}` };
      const a2 = fill((_) => 99, N);
      const b2 = fill((_) => 1, N);
      const outHi = run(freshOp({ position: 42 }), { a: a2, b: b2 }, N);
      for (let i = 0; i < N; i++) if (Math.abs(outHi[i] - 1) > 1e-6) return { pass: false, why: `pos clamp: out[${i}]=${outHi[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN position ignored — holds previous',
    run() {
      const N = 8;
      const a = fill((_) => 1, N);
      const b = fill((_) => 99, N);
      const op = freshOp({ position: 0 });
      op.setParam('position', NaN);
      const out = run(op, { a, b }, N);
      for (let i = 0; i < N; i++) if (Math.abs(out[i] - 1) > 1e-6) return { pass: false, why: `[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing a @ position=0.5 → out = b · sin(π/4)',
    run() {
      const N = 8;
      const b = fill((_) => 1, N);
      const out = run(freshOp({ position: 0.5 }), { b }, N);
      const exp = Math.SQRT1_2;
      for (let i = 0; i < N; i++) if (Math.abs(out[i] - exp) > 1e-6) return { pass: false, why: `[${i}]=${out[i]} vs ${exp}` };
      return { pass: true };
    },
  },
  {
    name: 'missing b @ position=0.5 → out = a · cos(π/4)',
    run() {
      const N = 8;
      const a = fill((_) => 1, N);
      const out = run(freshOp({ position: 0.5 }), { a }, N);
      const exp = Math.SQRT1_2;
      for (let i = 0; i < N; i++) if (Math.abs(out[i] - exp) > 1e-6) return { pass: false, why: `[${i}]=${out[i]} vs ${exp}` };
      return { pass: true };
    },
  },
  {
    name: 'missing both → silent',
    run() {
      const out = run(freshOp({ position: 0.5 }), {}, 32);
      for (let i = 0; i < 32; i++) if (out[i] !== 0) return { pass: false, why: `[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no crash',
    run() {
      const op = freshOp();
      op.process({ a: new Float32Array(8), b: new Float32Array(8) }, {}, 8);
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const N = 128;
      const a = fill(sine(500), N);
      const b = fill(sine(700), N);
      const o1 = run(freshOp({ position: 0.3 }), { a, b }, N);
      const o2 = run(freshOp({ position: 0.3 }), { a, b }, N);
      for (let i = 0; i < N; i++) if (o1[i] !== o2[i]) return { pass: false, why: `diverge at ${i}` };
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
  {
    name: 'stateless — reset is a no-op',
    run() {
      const op = freshOp({ position: 0.4 });
      const N = 16;
      const a = fill(sine(440), N);
      const b = fill(sine(880), N);
      const o1 = run(op, { a, b }, N);
      op.reset();
      const o2 = run(op, { a, b }, N);
      for (let i = 0; i < N; i++) if (o1[i] !== o2[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'loud input → no NaN / no runaway',
    run() {
      const N = 2048;
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const a = fill(() => rng() * 2, N);
      const b = fill(() => rng() * 2, N);
      const out = run(freshOp({ position: 0.5 }), { a, b }, N);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]) || Math.abs(out[i]) > 4) return { pass: false, why: `[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'crossfade', tests };
