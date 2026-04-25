// op_crossfeed.test.js — Bauer/libbs2b crossfeed.

import { CrossfeedOp } from './op_crossfeed.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new CrossfeedOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, inL, inR, N) {
  const l = new Float32Array(N), r = new Float32Array(N);
  op.process({ in: inL, in2: inR }, { l, r }, N);
  return { l, r };
}

function ones(N, v = 1) { const a = new Float32Array(N); a.fill(v); return a; }
function impulse(N, i = 0, v = 1) { const a = new Float32Array(N); a[i] = v; return a; }

const tests = [
  {
    name: 'hard-left input bleeds into right (crossfeed exists)',
    run() {
      const op = freshOp({ fcut: 700, feed: 4.5 });
      const { l, r } = render(op, ones(4096), new Float32Array(4096), 4096);
      // Let filters settle, then check: R has non-trivial energy (crossfed L→R)
      let rmsR = 0;
      for (let i = 512; i < 4096; i++) rmsR += r[i] * r[i];
      rmsR = Math.sqrt(rmsR / (4096 - 512));
      if (rmsR < 0.05) return { pass: false, why: `R rms=${rmsR} (no crossfeed)` };
      // And R should be smaller than L (crossfed is attenuated)
      let rmsL = 0;
      for (let i = 512; i < 4096; i++) rmsL += l[i] * l[i];
      rmsL = Math.sqrt(rmsL / (4096 - 512));
      if (rmsR >= rmsL) return { pass: false, why: `R=${rmsR} ≥ L=${rmsL} (crossfeed not attenuated)` };
      return { pass: true };
    },
  },
  {
    name: 'mono input (L=R) passes through unchanged (allpass-ish)',
    run() {
      const op = freshOp({ fcut: 700, feed: 4.5 });
      const sig = ones(2048);
      const { l, r } = render(op, sig, sig, 2048);
      // After settling, L==R==1 (bass-boost gain compensation restores unity for mono).
      for (let i = 512; i < 2048; i++) {
        if (Math.abs(l[i] - 1) > 0.05) return { pass: false, why: `i=${i} L=${l[i]}` };
        if (Math.abs(r[i] - 1) > 0.05) return { pass: false, why: `i=${i} R=${r[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'symmetry: swapping L↔R inputs swaps L↔R outputs',
    run() {
      const a = freshOp({ fcut: 700, feed: 4.5 });
      const b = freshOp({ fcut: 700, feed: 4.5 });
      const N = 1024;
      const sigA = ones(N), sigB = new Float32Array(N);
      const ra = render(a, sigA, sigB, N);
      const rb = render(b, sigB, sigA, N);
      for (let i = 0; i < N; i++) {
        if (Math.abs(ra.l[i] - rb.r[i]) > 1e-6) return { pass: false, why: `L(a)!=R(b) i=${i}` };
        if (Math.abs(ra.r[i] - rb.l[i]) > 1e-6) return { pass: false, why: `R(a)!=L(b) i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse: L and R outputs bounded & finite',
    run() {
      const op = freshOp({ fcut: 700, feed: 4.5 });
      const { l, r } = render(op, impulse(512, 0, 1), new Float32Array(512), 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
        if (Math.abs(l[i]) > 2 || Math.abs(r[i]) > 2)        return { pass: false, why: `i=${i} ovs` };
      }
      return { pass: true };
    },
  },
  {
    name: 'higher feed → more channel separation (less crossfed energy)',
    run() {
      // bs2b "feed" = level difference between direct & crossfed at LF.
      // Higher feed → more separation → LESS R-channel bleed when input is hard L.
      const aOp = freshOp({ fcut: 700, feed: 2  });
      const bOp = freshOp({ fcut: 700, feed: 10 });
      const N = 4096;
      const sigL = ones(N), sigR = new Float32Array(N);
      const a = render(aOp, sigL, sigR, N);
      const b = render(bOp, sigL, sigR, N);
      let ea = 0, eb = 0;
      for (let i = 512; i < N; i++) { ea += a.r[i] * a.r[i]; eb += b.r[i] * b.r[i]; }
      if (eb >= ea) return { pass: false, why: `feed=10 energy=${eb} ≥ feed=2 energy=${ea}` };
      return { pass: true };
    },
  },
  {
    name: 'zero input → zero output',
    run() {
      const op = freshOp({});
      const { l, r } = render(op, new Float32Array(256), new Float32Array(256), 256);
      for (let i = 0; i < 256; i++) {
        if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range / NaN stay finite',
    run() {
      const op = freshOp({});
      op.setParam('fcut', 9999); op.setParam('fcut', -1); op.setParam('fcut', NaN);
      op.setParam('feed', 9999); op.setParam('feed', -1); op.setParam('feed', NaN);
      const { l, r } = render(op, ones(256), ones(256), 256);
      for (let i = 0; i < 256; i++) {
        if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing inputs → silence',
    run() {
      const op = freshOp({});
      const l = new Float32Array(64), r = new Float32Array(64);
      try { op.process({}, { l, r }, 64); } catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < 64; i++) if (l[i] !== 0 || r[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no throw',
    run() {
      const op = freshOp({});
      try { op.process({ in: ones(64), in2: ones(64) }, {}, 64); }
      catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      const op = freshOp({});
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops identical',
    run() {
      const N = 2048;
      const sigL = ones(N), sigR = new Float32Array(N);
      const a = render(freshOp({ fcut: 700, feed: 4.5 }), sigL, sigR, N);
      const b = render(freshOp({ fcut: 700, feed: 4.5 }), sigL, sigR, N);
      for (let i = 0; i < N; i++) {
        if (a.l[i] !== b.l[i] || a.r[i] !== b.r[i]) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state (same output after reset+replay)',
    run() {
      const op = freshOp({});
      const sigL = ones(512), sigR = new Float32Array(512);
      const before = render(op, sigL, sigR, 512);
      op.reset();
      const after = render(op, sigL, sigR, 512);
      for (let i = 0; i < 512; i++) {
        if (Math.abs(before.l[i] - after.l[i]) > 1e-6) return { pass: false, why: `L i=${i}` };
        if (Math.abs(before.r[i] - after.r[i]) > 1e-6) return { pass: false, why: `R i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity',
    run() {
      const op1 = freshOp({}), op2 = freshOp({});
      const N = 1024;
      const sigL = ones(N), sigR = new Float32Array(N);
      const r1 = render(op1, sigL, sigR, N);
      const lA = new Float32Array(N/2), rA = new Float32Array(N/2);
      op2.process({ in: sigL.subarray(0, N/2), in2: sigR.subarray(0, N/2) }, { l: lA, r: rA }, N/2);
      const lB = new Float32Array(N/2), rB = new Float32Array(N/2);
      op2.process({ in: sigL.subarray(N/2, N), in2: sigR.subarray(N/2, N) }, { l: lB, r: rB }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(r1.l[i] - lA[i]) > 1e-6)         return { pass: false, why: `A-block i=${i}` };
        if (Math.abs(r1.l[i + N/2] - lB[i]) > 1e-6)   return { pass: false, why: `B-block i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'DC pass: steady DC input produces steady DC output',
    run() {
      const op = freshOp({});
      const { l, r } = render(op, ones(4096), ones(4096), 4096);
      // After settling, DC passes (allpass-ish on mono).
      if (Math.abs(l[4000] - 1) > 0.05) return { pass: false, why: `L=${l[4000]}` };
      if (Math.abs(r[4000] - 1) > 0.05) return { pass: false, why: `R=${r[4000]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'crossfeed', tests };
