// op_granularBuffer.test.js — SC GrainBuf-style live granulator.

import { GranularBufferOp } from './op_granularBuffer.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new GranularBufferOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, inArr) {
  const N = inArr.length;
  const out = new Float32Array(N);
  op.process({ in: inArr }, { out }, N);
  return out;
}

function rms(arr, start = 0, end = arr.length) {
  let s = 0; let n = 0;
  for (let i = start; i < end; i++) { s += arr[i] * arr[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

const tests = [
  {
    name: 'output finite + bounded for sine drive',
    run() {
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const out = render(freshOp({ density: 50, grainMs: 30 }), inBuf);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(out[i]) > 1.5)   return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output (after warmup)',
    run() {
      const op = freshOp({ density: 100, grainMs: 30 });
      const out = render(op, new Float32Array(8192));
      // grains read from (zero) buffer → output stays at 0
      let any = false;
      for (let i = 0; i < 8192; i++) if (out[i] !== 0) { any = true; break; }
      if (any) return { pass: false, why: 'silent in produced non-zero out' };
      return { pass: true };
    },
  },
  {
    name: 'density=0.1 (rare grains): output sparse but bounded',
    run() {
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const out = render(freshOp({ density: 0.1, grainMs: 30 }), inBuf);
      const r = rms(out);
      if (r > 0.5) return { pass: false, why: `rms=${r} (sparse should be small)` };
      return { pass: true };
    },
  },
  {
    name: 'higher density → higher RMS (more overlapping grains)',
    run() {
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const a = render(freshOp({ density: 5,   grainMs: 30 }), inBuf);
      const b = render(freshOp({ density: 100, grainMs: 30 }), inBuf);
      // RMS of late portion (after warmup)
      const ra = rms(a, 4096);
      const rb = rms(b, 4096);
      if (rb <= ra) return { pass: false, why: `lo=${ra} hi=${rb}` };
      return { pass: true };
    },
  },
  {
    name: 'level=0 → silence',
    run() {
      const N = 4096;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR);
      const out = render(freshOp({ density: 50, level: 0 }), inBuf);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'level=0.5 halves output amplitude vs level=1 (same seed)',
    run() {
      const N = 4096;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const a = render(freshOp({ density: 50, level: 1   }), inBuf);
      const b = render(freshOp({ density: 50, level: 0.5 }), inBuf);
      for (let i = 0; i < N; i++) {
        if (Math.abs(b[i] - a[i] * 0.5) > 1e-5) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pitch up by +1200 cents → grains read 2× faster (≈half-len in audible energy)',
    run() {
      // Drive a sine that is steady; pitch shift produces a higher sine (1 octave up).
      // Verify by checking spectral centroid via simple zero-crossing rate proxy.
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const a = render(freshOp({ density: 100, grainMs: 50, pitchCents: 0    }), inBuf);
      const b = render(freshOp({ density: 100, grainMs: 50, pitchCents: 1200 }), inBuf);
      // Count zero crossings in last 4096 samples
      const zc = (arr) => { let c = 0; for (let i = 4097; i < arr.length; i++) if ((arr[i-1] < 0) !== (arr[i] < 0)) c++; return c; };
      const za = zc(a), zb = zc(b);
      if (zb <= za * 1.3) return { pass: false, why: `zc base=${za} pitched=${zb} (expected ≈2× ratio)` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops on same input → identical output',
    run() {
      const N = 4096;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const a = render(freshOp({ density: 50, jitterMs: 5, detuneCents: 50 }), inBuf);
      const b = render(freshOp({ density: 50, jitterMs: 5, detuneCents: 50 }), inBuf);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() restores PRNG seed and clears buffer',
    run() {
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const op = freshOp({ density: 50 });
      const before = render(op, inBuf);
      op.reset();
      const after = render(op, inBuf);
      for (let i = 0; i < N; i++) if (before[i] !== after[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: N one-shot == two half-blocks (same input)',
    run() {
      const N = 1024;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const op1 = freshOp({ density: 30 });
      const op2 = freshOp({ density: 30 });
      const full = render(op1, inBuf);
      const a = new Float32Array(N/2), b = new Float32Array(N/2);
      op2.process({ in: inBuf.subarray(0, N/2)     }, { out: a }, N/2);
      op2.process({ in: inBuf.subarray(N/2, N)     }, { out: b }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(full[i]       - a[i]) > 1e-5) return { pass: false, why: `A i=${i} full=${full[i]} half=${a[i]}` };
        if (Math.abs(full[i + N/2] - b[i]) > 1e-5) return { pass: false, why: `B i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pool full → silently drop new grains, no throw',
    run() {
      // density 200 Hz, grainMs 500 ms → expected active = 100 grains, but pool only 16.
      // Should not throw; output should still be finite.
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const out = render(freshOp({ density: 200, grainMs: 500 }), inBuf);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(out[i]) > 2) return { pass: false, why: `i=${i} out=${out[i]} (clip from over-density)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: NaN / out-of-range stay finite',
    run() {
      const op = freshOp({});
      for (const p of ['delayMs', 'grainMs', 'density', 'jitterMs', 'pitchCents', 'detuneCents', 'level']) {
        op.setParam(p, 1e9); op.setParam(p, -1e9); op.setParam(p, NaN);
      }
      const N = 512;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(i * 0.1) * 0.5;
      const out = render(op, inBuf);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → output stays at 0',
    run() {
      const op = freshOp({ density: 100 });
      const out = new Float32Array(2048);
      op.process({}, { out }, 2048);
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: new Float32Array(64) }, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false };
      return { pass: true };
    },
  },
];

export default { opId: 'granularBuffer', tests };
