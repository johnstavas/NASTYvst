// op_tapeSim.test.js — real-math tests for tape character (#112).
// Run via: node scripts/check_op_math.mjs

import { TapeSimOp } from './op_tapeSim.worklet.js';

const SR = 48000;
const N  = 2048;

function freshOp(params = {}) {
  const op = new TapeSimOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input) {
  const out = new Float32Array(input.length);
  op.process({ in: input }, { out }, input.length);
  return out;
}
function sine(freq, n, amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.sin(2 * Math.PI * freq * i / SR) * amp;
  return b;
}
// RMS of steady-state (skip first 512 for transient)
function rmsSS(buf) {
  let s = 0, cnt = 0;
  for (let i = 512; i < buf.length; i++) { s += buf[i] * buf[i]; cnt++; }
  return Math.sqrt(s / cnt);
}

const tests = [
  {
    name: 'silence in → silence out',
    run() {
      const out = render(freshOp({}), new Float32Array(N));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'low drive + flat bump + high HF cutoff ≈ near-transparent on small signal',
    run() {
      const op = freshOp({ drive: 1, bumpDb: 0, hfHz: 22000, trim: 1 });
      const inp = sine(1000, N, 0.05);
      const out = render(op, inp);
      const rmsIn  = rmsSS(inp);
      const rmsOut = rmsSS(out);
      // Allow ±3 dB
      const ratio = rmsOut / rmsIn;
      if (ratio < 0.7 || ratio > 1.4) return { pass: false, why: `ratio=${ratio.toFixed(3)} (expected near 1)` };
      return { pass: true };
    },
  },
  {
    name: 'gloubi-boulga compression: high-amplitude input produces lower ratio than low-amp',
    run() {
      const op1 = freshOp({ drive: 1, bumpDb: 0, hfHz: 22000, trim: 1 });
      const op2 = freshOp({ drive: 1, bumpDb: 0, hfHz: 22000, trim: 1 });
      const lo = sine(1000, N, 0.05);
      const hi = sine(1000, N, 0.9);
      const outLo = render(op1, lo);
      const outHi = render(op2, hi);
      const gLo = rmsSS(outLo) / rmsSS(lo);
      const gHi = rmsSS(outHi) / rmsSS(hi);
      if (!(gHi < gLo)) return { pass: false, why: `gLo=${gLo.toFixed(3)} gHi=${gHi.toFixed(3)} (hi should compress)` };
      return { pass: true };
    },
  },
  {
    name: 'head-bump: +6 dB at bumpHz boosts vs flat baseline at that freq',
    run() {
      const f = 80;
      const flat = freshOp({ drive: 1, bumpDb: 0, bumpHz: f, hfHz: 22000 });
      const bump = freshOp({ drive: 1, bumpDb: 6, bumpHz: f, bumpQ: 1, hfHz: 22000 });
      const inp = sine(f, N, 0.05);
      const oFlat = rmsSS(render(flat, inp));
      const oBump = rmsSS(render(bump, inp));
      // +6 dB ≈ 2× linear. Allow 30% slack for Q shape + minor saturation.
      const ratio = oBump / oFlat;
      if (ratio < 1.5 || ratio > 2.5) return { pass: false, why: `ratio=${ratio.toFixed(3)} expected ~2` };
      return { pass: true };
    },
  },
  {
    name: 'HF loss: 20 kHz attenuated more than 1 kHz',
    run() {
      // 1-pole LP — use narrow fc so attenuation is unambiguous.
      const op1 = freshOp({ drive: 1, bumpDb: 0, hfHz: 3000, trim: 1 });
      const op2 = freshOp({ drive: 1, bumpDb: 0, hfHz: 3000, trim: 1 });
      const in1k  = sine(1000,  N, 0.05);
      const in15k = sine(15000, N, 0.05);
      const o1k   = rmsSS(render(op1, in1k));
      const o15k  = rmsSS(render(op2, in15k));
      if (!(o15k < o1k * 0.5)) return { pass: false, why: `o1k=${o1k.toFixed(4)} o15k=${o15k.toFixed(4)} (15k should be <0.5× 1k)` };
      return { pass: true };
    },
  },
  {
    name: 'trim=0 → silence on any input',
    run() {
      const op = freshOp({ drive: 5, trim: 0 });
      const out = render(op, sine(440, N, 0.5));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'output bounded under extreme drive — no NaN/Inf',
    run() {
      const op = freshOp({ drive: 20, bumpDb: 12, bumpQ: 10, hfHz: 200 });
      const inp = sine(500, N, 0.99);
      const out = render(op, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
        if (Math.abs(out[i]) > 5) return { pass: false, why: `i=${i}: ${out[i]} (unbounded)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'gloubi is odd-ish: DC at 0 in → near 0 out',
    run() {
      // Gloubi at x=0: (1-1)/(1+1)=0
      const op = freshOp({ drive: 1, bumpDb: 0, hfHz: 22000, trim: 1 });
      const out = render(op, new Float32Array(N)); // zeros
      if (rmsSS(out) !== 0) return { pass: false, why: `nonzero silence output` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears biquad + LP state',
    run() {
      const op = freshOp({ drive: 2, bumpDb: 6, hfHz: 4000 });
      render(op, sine(200, N, 0.8));
      op.reset();
      const out = render(op, new Float32Array(32));
      for (let i = 0; i < 32; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const inp = sine(440, N, 0.5);
      const a = render(freshOp({ drive: 2, bumpDb: 4, bumpHz: 70, hfHz: 12000 }), inp);
      const b = render(freshOp({ drive: 2, bumpDb: 4, bumpHz: 70, hfHz: 12000 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range stay finite and bounded',
    run() {
      const op = freshOp({});
      op.setParam('drive',  999);
      op.setParam('drive',  -5);
      op.setParam('bumpHz', 1e9);
      op.setParam('bumpHz', -5);
      op.setParam('bumpDb', 999);
      op.setParam('bumpDb', -999);
      op.setParam('bumpQ',  999);
      op.setParam('bumpQ',  -5);
      op.setParam('hfHz',   1e9);
      op.setParam('hfHz',   -5);
      op.setParam('trim',   999);
      op.setParam('trim',   -5);
      op.setParam('drive',  NaN);      // ignored
      const out = render(op, sine(500, N, 0.3));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence (state flushes)',
    run() {
      const op = freshOp({});
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      // May have initial transient from denormal zero; allow settling.
      for (let i = 512; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, 128); } catch (e) { return { pass: false, why: e.message }; }
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

export default { opId: 'tapeSim', tests };
