// op_haas.test.js — Haas widener tests.
// Primary: Haas 1951 (psychoacoustic defaults only; dsp is math-by-def).

import { HaasOp } from './op_haas.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new HaasOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, input, N, input2 = null) {
  const l = new Float32Array(N), r = new Float32Array(N);
  op.process({ in: input, in2: input2 }, { l, r }, N);
  return { l, r };
}

function impulse(N, at = 0) {
  const out = new Float32Array(N);
  if (at >= 0 && at < N) out[at] = 1;
  return out;
}

function sine(N, freq, sr = SR, amp = 0.5) {
  const out = new Float32Array(N);
  const w = 2 * Math.PI * freq / sr;
  for (let i = 0; i < N; i++) out[i] = amp * Math.sin(i * w);
  return out;
}

const tests = [
  {
    name: 'impulse: direct side has spike at n=0',
    run() {
      const op = freshOp({ delayMs: 10, side: 0 }); // R delayed → L direct
      const { l } = render(op, impulse(2048), 2048);
      if (Math.abs(l[0] - 1) > 1e-6) return { pass: false, why: `l[0]=${l[0]}` };
      for (let i = 1; i < 2048; i++) if (Math.abs(l[i]) > 1e-6) return { pass: false, why: `l[${i}]=${l[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'impulse: delayed side has spike at n = round(delayMs*sr/1000)',
    run() {
      const delayMs = 10;
      const op = freshOp({ delayMs, side: 0, levelDb: 0 });
      const { r } = render(op, impulse(2048), 2048);
      const expected = Math.round(delayMs * 0.001 * SR);  // 480
      if (Math.abs(r[expected] - 1) > 1e-3)
        return { pass: false, why: `r[${expected}]=${r[expected]}` };
      // Pre-delay samples should be zero (exact at integer delay).
      for (let i = 0; i < expected - 1; i++)
        if (Math.abs(r[i]) > 1e-6) return { pass: false, why: `r[${i}]=${r[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'side=1 flips: L delayed, R direct',
    run() {
      const op = freshOp({ delayMs: 5, side: 1 });
      const { l, r } = render(op, impulse(1024), 1024);
      if (Math.abs(r[0] - 1) > 1e-6) return { pass: false, why: `r[0]=${r[0]}` };
      const expected = Math.round(5 * 0.001 * SR); // 240
      if (Math.abs(l[expected] - 1) > 1e-3) return { pass: false, why: `l[${expected}]=${l[expected]}` };
      return { pass: true };
    },
  },
  {
    name: 'delayMs=0 produces L == R (pure mono)',
    run() {
      const op = freshOp({ delayMs: 0, levelDb: 0, mix: 1 });
      const sig = sine(512, 440);
      const { l, r } = render(op, sig, 512);
      for (let i = 0; i < 512; i++) {
        if (Math.abs(l[i] - r[i]) > 1e-5) return { pass: false, why: `i=${i} L=${l[i]} R=${r[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'mix=0 bypasses: L == R == input',
    run() {
      const op = freshOp({ delayMs: 18, mix: 0 });
      const sig = sine(512, 440);
      const { l, r } = render(op, sig, 512);
      for (let i = 0; i < 512; i++) {
        if (Math.abs(l[i] - sig[i]) > 1e-6 || Math.abs(r[i] - sig[i]) > 1e-6)
          return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'levelDb=-6 dB → delayed-side peak ≈ 0.5× lead peak',
    run() {
      const op = freshOp({ delayMs: 10, levelDb: -6.0206, side: 0 });
      const { r } = render(op, impulse(1024), 1024);
      const expected = Math.round(10 * 0.001 * SR);
      const peakR = Math.abs(r[expected]);
      if (Math.abs(peakR - 0.5) > 1e-3) return { pass: false, why: `r peak=${peakR}` };
      return { pass: true };
    },
  },
  {
    name: 'levelDb=+10 dB (Haas ceiling) does not clip or NaN',
    run() {
      const op = freshOp({ delayMs: 15, levelDb: 10 });
      const { l, r } = render(op, sine(2048, 440), 2048);
      for (let i = 0; i < 2048; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('delayMs', 9999); op.setParam('delayMs', -10); op.setParam('delayMs', NaN);
      op.setParam('levelDb', 999);  op.setParam('levelDb', -999);
      op.setParam('side',    99);   op.setParam('side',    -99);
      op.setParam('mix',     9);    op.setParam('mix',     -9);
      const { l, r } = render(op, sine(512, 440), 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'stereo input sums before widening (no extra width compounding)',
    run() {
      const op = freshOp({ delayMs: 10, side: 0, mix: 1, levelDb: 0 });
      const a = impulse(1024, 0);
      const b = impulse(1024, 0);
      const { l, r } = render(op, a, 1024, b);
      // (a+b)/2 = 1 at n=0 → L gets 1, R gets 1 at delay.
      if (Math.abs(l[0] - 1) > 1e-6) return { pass: false, why: `l[0]=${l[0]}` };
      const expected = Math.round(10 * 0.001 * SR);
      if (Math.abs(r[expected] - 1) > 1e-3) return { pass: false, why: `r[${expected}]=${r[expected]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 2048;
      const sig = sine(N, 330);
      const a = render(freshOp({}), sig, N);
      const b = render(freshOp({}), sig, N);
      for (let i = 0; i < N; i++) {
        if (a.l[i] !== b.l[i] || a.r[i] !== b.r[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state',
    run() {
      const op = freshOp({ delayMs: 18 });
      render(op, sine(2048, 440), 2048);
      op.reset();
      const { l, r } = render(op, new Float32Array(2048), 2048);
      for (let i = 0; i < 2048; i++) {
        if (Math.abs(l[i]) > 1e-9 || Math.abs(r[i]) > 1e-9) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence on both sides',
    run() {
      const op = freshOp({});
      const l = new Float32Array(256), r = new Float32Array(256);
      try { op.process({}, { l, r }, 256); } catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < 256; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: sine(256, 440) }, {}, 256); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() == ceil(delayMs·sr/1000)',
    run() {
      const op = freshOp({ delayMs: 18 });
      const expected = Math.ceil(18 * 0.001 * SR);
      if (op.getLatencySamples() !== expected)
        return { pass: false, why: `got ${op.getLatencySamples()} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'Haas sweet-spot 18 ms sine → RMS(R) ≈ RMS(L) within 0.1 dB',
    run() {
      // Energy on both sides should match at levelDb=0 (sine is stationary).
      const op = freshOp({ delayMs: 18, levelDb: 0, side: 0 });
      const N = 48000; // 1 second
      const { l, r } = render(op, sine(N, 440), N);
      // Skip warmup hop so the delay line is full.
      const start = 1000;
      let el = 0, er = 0;
      for (let i = start; i < N; i++) { el += l[i]*l[i]; er += r[i]*r[i]; }
      const db = 10 * Math.log10(er / el);
      if (Math.abs(db) > 0.1) return { pass: false, why: `L vs R ${db.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'fractional delay: 17.5 samples lies between 17 and 18 peaks',
    run() {
      // At SR=48000, delayMs = 17.5/48 = 0.3645833… → between integer samples.
      const op = freshOp({ delayMs: 17.5 / 48, levelDb: 0, side: 0 });
      const { r } = render(op, impulse(256), 256);
      // Linear interp: spike energy split across samples 17 and 18.
      const e17 = Math.abs(r[17]), e18 = Math.abs(r[18]);
      if (e17 < 0.1 || e18 < 0.1) return { pass: false, why: `r[17]=${e17} r[18]=${e18}` };
      if (e17 + e18 < 0.95) return { pass: false, why: `sum=${(e17+e18).toFixed(3)}` };
      return { pass: true };
    },
  },
];

export default { opId: 'haas', tests };
