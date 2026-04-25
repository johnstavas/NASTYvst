// op_microDetune.test.js — two-tap crossfading delay-line pitch shifter.

import { MicroDetuneOp } from './op_microDetune.worklet.js';

const SR = 48000;

function fresh(params = {}) {
  const op = new MicroDetuneOp(SR);
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

function zeroCrossings(arr, start = 0) {
  let c = 0;
  for (let i = start + 1; i < arr.length; i++) {
    if ((arr[i - 1] < 0) !== (arr[i] < 0)) c++;
  }
  return c;
}

const tests = [
  {
    name: 'cents=0 → output ≈ delayed input (unity rate)',
    run() {
      // Measure ZC rate well past warm-up: window default = 50 ms ≈ 2400
      // samples; first 2400 samples of output read from the zero-init wrap
      // region. Use 8192 samples and measure in late half (>4096).
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const out = render(fresh({ cents: 0 }), inBuf);
      const inZc  = zeroCrossings(inBuf, 4096);
      const outZc = zeroCrossings(out,    4096);
      if (Math.abs(outZc - inZc) > 4) return { pass: false, why: `inZc=${inZc} outZc=${outZc}` };
      return { pass: true };
    },
  },
  {
    name: 'output finite + bounded for sine drive',
    run() {
      const N = 4096;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 440 / SR) * 0.5;
      const out = render(fresh({ cents: 50 }), inBuf);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(out[i]) > 1.5)   return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const out = render(fresh({ cents: 100 }), new Float32Array(2048));
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'cents=+1200 (octave up) → ZC count ≈ 2× input',
    run() {
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const out = render(fresh({ cents: 1200 }), inBuf);
      // Measure in late portion (after window fills + first xfade cycle)
      const inZc  = zeroCrossings(inBuf, 4096);
      const outZc = zeroCrossings(out,    4096);
      // Octave up should ~double; allow 30% tolerance for window seams.
      if (outZc < inZc * 1.5) return { pass: false, why: `inZc=${inZc} outZc=${outZc} (expected ≈2×)` };
      return { pass: true };
    },
  },
  {
    name: 'cents=-1200 (octave down) → ZC count ≈ ½ input',
    run() {
      const N = 8192;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 880 / SR) * 0.5;
      const out = render(fresh({ cents: -1200 }), inBuf);
      const inZc  = zeroCrossings(inBuf, 4096);
      const outZc = zeroCrossings(out,    4096);
      // Octave down should ~halve; allow tolerance.
      if (outZc > inZc * 0.75) return { pass: false, why: `inZc=${inZc} outZc=${outZc} (expected ≈½×)` };
      return { pass: true };
    },
  },
  {
    name: 'level=0 → silence',
    run() {
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 440 / SR);
      const out = render(fresh({ cents: 50, level: 0 }), inBuf);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'level=0.5 halves output amplitude vs level=1',
    run() {
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 440 / SR) * 0.5;
      const a = render(fresh({ cents: 50, level: 1   }), inBuf);
      const b = render(fresh({ cents: 50, level: 0.5 }), inBuf);
      for (let i = 0; i < N; i++) {
        if (Math.abs(b[i] - a[i] * 0.5) > 1e-5) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops on same input → identical output',
    run() {
      const N = 2048;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const a = render(fresh({ cents: 25 }), inBuf);
      const b = render(fresh({ cents: 25 }), inBuf);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() restores state',
    run() {
      const N = 1024;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const op = fresh({ cents: 25 });
      const before = render(op, inBuf);
      op.reset();
      const after = render(op, inBuf);
      for (let i = 0; i < N; i++) if (before[i] !== after[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: full == half + half',
    run() {
      const N = 1024;
      const inBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) inBuf[i] = Math.sin(2 * Math.PI * i * 220 / SR) * 0.5;
      const op1 = fresh({ cents: 25 });
      const op2 = fresh({ cents: 25 });
      const full = render(op1, inBuf);
      const a = new Float32Array(N/2), b = new Float32Array(N/2);
      op2.process({ in: inBuf.subarray(0, N/2)     }, { out: a }, N/2);
      op2.process({ in: inBuf.subarray(N/2, N)     }, { out: b }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(full[i]       - a[i]) > 1e-5) return { pass: false, why: `A i=${i}` };
        if (Math.abs(full[i + N/2] - b[i]) > 1e-5) return { pass: false, why: `B i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: NaN / out-of-range stay finite',
    run() {
      const op = fresh({});
      for (const p of ['cents', 'windowMs', 'xfadeMs', 'level']) {
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
    name: 'missing input → output stays at 0 (after warmup)',
    run() {
      const op = fresh({ cents: 50 });
      const out = new Float32Array(2048);
      op.process({}, { out }, 2048);
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = fresh({});
      try { op.process({ in: new Float32Array(64) }, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (fresh({}).getLatencySamples() !== 0) return { pass: false };
      return { pass: true };
    },
  },
];

export default { opId: 'microDetune', tests };
