// op_SDN.test.js — Scattering Delay Network (De Sena et al. 2015) math tests.
// Run via: node scripts/check_op_math.mjs

import { SDNOp } from './op_SDN.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new SDNOp(SR);
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
    name: 'impulse → LOS arrival followed by discrete early reflections',
    run() {
      const N = 16384;
      const { l } = render(freshOp({}), impulse(N), N);
      // LOS + at least 6 wall reflections should produce energy in early window.
      const early = rms(l, 0, 1500);
      if (early <= 1e-6) return { pass: false, why: `early=${early.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'rt60=3.0 tail exceeds rt60=0.3 tail at late window',
    run() {
      const N = 32000;
      const hi = render(freshOp({ rt60: 3.0 }), impulse(N), N);
      const lo = render(freshOp({ rt60: 0.3 }), impulse(N), N);
      const eHi = rms(hi.l, 16000, N);
      const eLo = rms(lo.l, 16000, N);
      if (!(eHi > eLo * 2)) return { pass: false, why: `eHi=${eHi.toExponential(2)} eLo=${eLo.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'damping=0.95 attenuates HF more than damping=0.05',
    run() {
      const N = 16000;
      const hiD = render(freshOp({ rt60: 2.0, damping: 0.95 }), impulse(N), N);
      const loD = render(freshOp({ rt60: 2.0, damping: 0.05 }), impulse(N), N);
      const hfE = (buf) => {
        let z = 0, s = 0;
        for (let i = 2000; i < buf.length; i++) {
          z = 0.9*z + 0.1*buf[i];
          const hp = buf[i] - z;
          s += hp*hp;
        }
        return s;
      };
      const hHi = hfE(hiD.l), hLo = hfE(loD.l);
      if (!(hHi < hLo * 0.5)) return { pass: false, why: `HF hi-damp=${hHi.toExponential(2)} lo-damp=${hLo.toExponential(2)}` };
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
    name: 'reset() clears state — no residual tail after reset',
    run() {
      const op = freshOp({ rt60: 2.0 });
      render(op, impulse(1024), 1024);
      op.reset();
      const { l, r } = render(op, new Float32Array(1024), 1024);
      for (let i = 0; i < 1024; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'size=2 LOS delay larger than size=0.5 LOS delay',
    run() {
      const N = 6000;
      const sm = render(freshOp({ size: 0.5, rt60: 0.3 }), impulse(N), N);
      const lg = render(freshOp({ size: 2.0, rt60: 0.3 }), impulse(N), N);
      // Find first non-trivial peak.
      const firstPeak = (buf) => {
        for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > 1e-4) return i;
        return -1;
      };
      const iS = firstPeak(sm.l), iL = firstPeak(lg.l);
      if (!(iL > iS)) return { pass: false, why: `iSmall=${iS} iLarge=${iL}` };
      return { pass: true };
    },
  },
  {
    name: 'width>0 produces L≠R',
    run() {
      const N = 4000;
      const { l, r } = render(freshOp({ width: 0.8, rt60: 1.5 }), impulse(N), N);
      let diff = 0;
      for (let i = 0; i < N; i++) diff += Math.abs(l[i] - r[i]);
      if (!(diff > 0.01)) return { pass: false, why: `Σ|L−R|=${diff.toExponential(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('rt60', 999); op.setParam('rt60', -1);
      op.setParam('size', 999); op.setParam('size', -1);
      op.setParam('damping', 999); op.setParam('damping', -1);
      op.setParam('width', 999); op.setParam('width', -1);
      op.setParam('rt60', NaN); op.setParam('damping', Infinity);
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
      const { l, r } = render(freshOp({ rt60: 8.0, damping: 0.0 }), impulse(N), N);
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

export default { opId: 'SDN', tests };
