// op_schroederChain.test.js — Schroeder 1962 reverberator math tests.
// Run via: node scripts/check_op_math.mjs

import { SchroederChainOp } from './op_schroederChain.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new SchroederChainOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input, N) {
  const l = new Float32Array(N), r = new Float32Array(N);
  op.process({ in: input }, { l, r }, N);
  return { l, r };
}
function impulse(N, at = 0, amp = 1.0) {
  const b = new Float32Array(N); b[at] = amp; return b;
}
function rms(buf, s = 0, e = buf.length) {
  let sum = 0, c = 0;
  for (let i = s; i < e; i++) { sum += buf[i]*buf[i]; c++; }
  return Math.sqrt(sum / Math.max(c, 1));
}

const tests = [
  {
    name: 'silence in → silence out',
    run() {
      const { l, r } = render(freshOp({}), new Float32Array(2048), 2048);
      for (let i = 0; i < 2048; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'impulse → first echo arrives near shortest comb (29.7 ms ≈ 1426 samples @ 48k)',
    run() {
      const N = 8192;
      const { l } = render(freshOp({ rt60: 2.0 }), impulse(N), N);
      // Expect measurable energy between 1300..1600 samples (first comb).
      let peak = 0, peakIdx = -1;
      for (let i = 1200; i < 1800; i++) {
        const a = Math.abs(l[i]);
        if (a > peak) { peak = a; peakIdx = i; }
      }
      if (peak < 1e-4) return { pass: false, why: `peak=${peak.toExponential(2)} @ ${peakIdx}` };
      return { pass: true };
    },
  },
  {
    name: 'rt60=4 tail exceeds rt60=0.3 tail at late window',
    run() {
      const N = 48000;
      const hi = render(freshOp({ rt60: 4.0 }), impulse(N), N);
      const lo = render(freshOp({ rt60: 0.3 }), impulse(N), N);
      const eHi = rms(hi.l, 20000, N);
      const eLo = rms(lo.l, 20000, N);
      if (!(eHi > eLo * 3)) return { pass: false, why: `eHi=${eHi.toExponential(2)} eLo=${eLo.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'damping=0.9 attenuates HF more than damping=0',
    run() {
      const N = 24000;
      const dry = render(freshOp({ rt60: 2.5, damping: 0.0 }), impulse(N), N);
      const wet = render(freshOp({ rt60: 2.5, damping: 0.9 }), impulse(N), N);
      const hfE = (buf) => {
        let z = 0, s = 0;
        for (let i = 3000; i < buf.length; i++) {
          z = 0.9*z + 0.1*buf[i];
          const hp = buf[i] - z;
          s += hp*hp;
        }
        return s;
      };
      const hDry = hfE(dry.l), hWet = hfE(wet.l);
      if (!(hWet < hDry * 0.5)) return { pass: false, why: `HF damp=0.9: ${hWet.toExponential(2)}  damp=0: ${hDry.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'size=2 echo arrives later than size=0.5',
    run() {
      const N = 16000;
      const sm = render(freshOp({ size: 0.5, rt60: 1.0 }), impulse(N), N);
      const lg = render(freshOp({ size: 2.0, rt60: 1.0 }), impulse(N), N);
      const firstPeak = (buf) => {
        for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > 1e-4) return i;
        return -1;
      };
      const iS = firstPeak(sm.l), iL = firstPeak(lg.l);
      if (!(iL > iS * 1.5)) return { pass: false, why: `iSmall=${iS} iLarge=${iL}` };
      return { pass: true };
    },
  },
  {
    name: 'spread>0 produces L≠R',
    run() {
      const N = 8000;
      const { l, r } = render(freshOp({ spread: 30, rt60: 2.0 }), impulse(N), N);
      let diff = 0;
      for (let i = 0; i < N; i++) diff += Math.abs(l[i] - r[i]);
      if (!(diff > 0.01)) return { pass: false, why: `Σ|L−R|=${diff.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'spread=0 → L == R (no decorrelation requested)',
    run() {
      const N = 8000;
      const { l, r } = render(freshOp({ spread: 0, rt60: 2.0 }), impulse(N), N);
      for (let i = 0; i < N; i++) {
        if (l[i] !== r[i]) return { pass: false, why: `i=${i} L=${l[i]} R=${r[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const N = 2048;
      const a = render(freshOp({}), impulse(N), N);
      const b = render(freshOp({}), impulse(N), N);
      for (let i = 0; i < N; i++) if (a.l[i] !== b.l[i] || a.r[i] !== b.r[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state',
    run() {
      const op = freshOp({ rt60: 2.0 });
      render(op, impulse(2048), 2048);
      op.reset();
      const { l, r } = render(op, new Float32Array(2048), 2048);
      for (let i = 0; i < 2048; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('rt60', 999); op.setParam('rt60', -1); op.setParam('rt60', NaN);
      op.setParam('damping', 999); op.setParam('damping', -1);
      op.setParam('size', 999); op.setParam('size', -1);
      op.setParam('spread', 999); op.setParam('spread', -1); op.setParam('spread', Infinity);
      const N = 2048;
      const { l, r } = render(op, impulse(N, 0, 0.5), N);
      for (let i = 0; i < N; i++) if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme rt60 stays bounded (no runaway)',
    run() {
      const N = 65536;
      const { l, r } = render(freshOp({ rt60: 10.0, damping: 0 }), impulse(N), N);
      let mx = 0;
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `nan at ${i}` };
        mx = Math.max(mx, Math.abs(l[i]), Math.abs(r[i]));
      }
      if (mx > 50) return { pass: false, why: `peak=${mx}` };
      return { pass: true };
    },
  },
  {
    name: 'Schroeder T60 formula: rt60=2s, τ=29.7ms → g ≈ 10^(-3·0.0297/2) ≈ 0.9017',
    run() {
      const rt60 = 2.0;
      const tau  = 29.7e-3;
      const expected = Math.pow(10, -3 * tau / rt60);
      // Verify formula matches what we know from Schroeder: g ≈ 0.9017
      if (Math.abs(expected - 0.9017) > 0.001) return { pass: false, why: `formula gave ${expected.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence',
    run() {
      const op = freshOp({});
      const l = new Float32Array(256), r = new Float32Array(256);
      op.process({}, { l, r }, 256);
      for (let i = 0; i < 256; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: new Float32Array(128) }, {}, 128); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
];

export default { opId: 'schroederChain', tests };
