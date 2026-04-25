// op_crackle.test.js — SC Dust/Dust2 over feldkirch PRNG.

import { CrackleOp } from './op_crackle.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new CrackleOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, N) {
  const out = new Float32Array(N);
  op.process({}, { out }, N);
  return out;
}

function countNonZero(arr) {
  let c = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] !== 0) c++;
  return c;
}

const tests = [
  {
    name: 'output finite and bounded for all modes',
    run() {
      for (const mode of [0, 1]) {
        for (const density of [1, 100, 10000]) {
          const out = render(freshOp({ density, mode, level: 0 }), 2048);
          for (let i = 0; i < out.length; i++) {
            if (!Number.isFinite(out[i]))   return { pass: false, why: `m=${mode} d=${density} i=${i}` };
            if (Math.abs(out[i]) > 1.0001)  return { pass: false, why: `m=${mode} d=${density} out=${out[i]}` };
          }
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'unipolar mode: all non-zero samples are in [0, 1)',
    run() {
      const out = render(freshOp({ density: 5000, mode: 0, level: 0 }), 8192);
      for (let i = 0; i < out.length; i++) {
        if (out[i] < 0) return { pass: false, why: `i=${i} out=${out[i]}` };
        if (out[i] >= 1.0001) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'bipolar mode: some samples negative, some positive',
    run() {
      const out = render(freshOp({ density: 5000, mode: 1, level: 0 }), 8192);
      let neg = 0, pos = 0;
      for (let i = 0; i < out.length; i++) {
        if (out[i] < 0) neg++;
        if (out[i] > 0) pos++;
      }
      if (neg < 10 || pos < 10) return { pass: false, why: `neg=${neg} pos=${pos}` };
      return { pass: true };
    },
  },
  {
    name: 'density=0 → all zeros (no impulses)',
    run() {
      const out = render(freshOp({ density: 0, mode: 1, level: 0 }), 2048);
      if (countNonZero(out) !== 0) return { pass: false, why: `nz=${countNonZero(out)}` };
      return { pass: true };
    },
  },
  {
    name: 'event rate ≈ density (within 30% over 1s @ 500 Hz)',
    run() {
      const density = 500;
      const N = SR;  // 1 second
      const op = freshOp({ density, mode: 0, level: 0 });
      // Render in quanta to keep Float32Array sizes reasonable
      let hits = 0;
      const B = 1024;
      const buf = new Float32Array(B);
      for (let off = 0; off < N; off += B) {
        for (let i = 0; i < B; i++) buf[i] = 0;
        op.process({}, { out: buf }, B);
        for (let i = 0; i < B; i++) if (buf[i] !== 0) hits++;
      }
      const expected = density;
      if (Math.abs(hits - expected) > 0.3 * expected) {
        return { pass: false, why: `hits=${hits} expected≈${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'higher density → more hits (monotone)',
    run() {
      const N = 8192;
      const a = countNonZero(render(freshOp({ density: 100,  mode: 0, level: 0 }), N));
      const b = countNonZero(render(freshOp({ density: 1000, mode: 0, level: 0 }), N));
      const c = countNonZero(render(freshOp({ density: 5000, mode: 0, level: 0 }), N));
      if (!(a < b && b < c)) return { pass: false, why: `a=${a} b=${b} c=${c}` };
      return { pass: true };
    },
  },
  {
    name: 'unipolar hits are NOT identical (inverse-CDF, not fixed-height)',
    run() {
      const out = render(freshOp({ density: 5000, mode: 0, level: 0 }), 8192);
      const hits = [];
      for (let i = 0; i < out.length; i++) if (out[i] !== 0) hits.push(out[i]);
      if (hits.length < 20) return { pass: false, why: `too few hits=${hits.length}` };
      let minH = hits[0], maxH = hits[0];
      for (const h of hits) { if (h < minH) minH = h; if (h > maxH) maxH = h; }
      if (maxH - minH < 0.1) return { pass: false, why: `range=${maxH - minH} (flat-height?)` };
      return { pass: true };
    },
  },
  {
    name: 'level = -60 dB → barely audible (max |out| < 0.002)',
    run() {
      const out = render(freshOp({ density: 10000, mode: 1, level: -60 }), 4096);
      let m = 0;
      for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > m) m = Math.abs(out[i]);
      if (m > 0.002) return { pass: false, why: `max=${m}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops identical',
    run() {
      const a = render(freshOp({ density: 500, mode: 1, level: 0 }), 4096);
      const b = render(freshOp({ density: 500, mode: 1, level: 0 }), 4096);
      for (let i = 0; i < 4096; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset() restores seed',
    run() {
      const op = freshOp({ density: 500, mode: 1, level: 0 });
      const before = render(op, 512);
      op.reset();
      const after = render(op, 512);
      for (let i = 0; i < 512; i++) if (before[i] !== after[i]) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'block-boundary continuity: N one-shot == two half-blocks',
    run() {
      const op1 = freshOp({ density: 500, mode: 1, level: 0 });
      const op2 = freshOp({ density: 500, mode: 1, level: 0 });
      const N = 1024;
      const full = render(op1, N);
      const a = new Float32Array(N/2), b = new Float32Array(N/2);
      op2.process({}, { out: a }, N/2);
      op2.process({}, { out: b }, N/2);
      for (let i = 0; i < N/2; i++) {
        if (Math.abs(full[i] - a[i]) > 1e-6)       return { pass: false, why: `A i=${i}` };
        if (Math.abs(full[i + N/2] - b[i]) > 1e-6) return { pass: false, why: `B i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: NaN / out-of-range stay finite',
    run() {
      const op = freshOp({});
      op.setParam('density', 1e9); op.setParam('density', -1e9); op.setParam('density', NaN);
      op.setParam('mode', 99); op.setParam('mode', -99); op.setParam('mode', NaN);
      op.setParam('level', 999); op.setParam('level', -999); op.setParam('level', NaN);
      const out = render(op, 256);
      for (let i = 0; i < 256; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, 64); }
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
];

export default { opId: 'crackle', tests };
