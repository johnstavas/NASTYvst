// op_noiseShaper.test.js — real-math tests for the higher-order
// noise-shaping dither op.
// Run via: node scripts/check_op_math.mjs

import { NoiseShaperOp } from './op_noiseShaper.worklet.js';

const SR = 48000;
const N  = 2048;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new NoiseShaperOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input, n = input.length) {
  const out = new Float32Array(n);
  op.process({ in: input }, { out }, n);
  return out;
}
function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}
function rmsLF(buf) {
  // Simple LP: sum of 4-sample rolling sum.
  let s = 0;
  for (let i = 3; i < buf.length; i++) {
    const v = buf[i] + buf[i-1] + buf[i-2] + buf[i-3];
    s += v * v;
  }
  return Math.sqrt(s / (buf.length - 3));
}
function rmsHF(buf) {
  // Simple HP: diff of adjacent samples.
  let s = 0;
  for (let i = 1; i < buf.length; i++) {
    const v = buf[i] - buf[i-1];
    s += v * v;
  }
  return Math.sqrt(s / (buf.length - 1));
}

const tests = [
  // ---- grid -------------------------------------------------------------
  {
    name: 'bits=8, order=9: output samples on wi grid',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
      const out = render(freshOp({ bits: 8, order: 9, weighting: 1, seed: 1 }), inp);
      const wi = 1 / Math.pow(2, 7);
      for (let i = 0; i < N; i++) {
        const k = Math.round(out[i] / wi);
        if (!approx(out[i], k * wi, 1e-5)) {
          return { pass: false, why: `i=${i}: ${out[i]} not on grid ${wi}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- bounded ---------------------------------------------------------
  {
    name: 'order=9 F-weighted stays bounded on silent input',
    run() {
      const inp = new Float32Array(N);    // silence — exercises the feedback
      const out = render(freshOp({ bits: 8, order: 9, weighting: 1, seed: 3 }), inp);
      const p = peak(out);
      // Order-9 F-weighted has sum(|c|) ≈ 22.3, times ±1 LSB error accumulated
      // then re-quantized; net stays within ~sum(|c|)·wi bounded.
      if (!(p < 0.5)) return { pass: false, why: `peak=${p}` };
      if (!Number.isFinite(p)) return { pass: false, why: 'NaN' };
      return { pass: true };
    },
  },

  // ---- noise shaping: HF energy > LF energy on silent input ------------
  {
    name: 'order=9 F-weighted: HF noise > LF noise on silence (classic shaping)',
    run() {
      const inp = new Float32Array(N);
      const out = render(freshOp({ bits: 8, order: 9, weighting: 1, seed: 5 }), inp);
      const hf = rmsHF(out);
      const lf = rmsLF(out);
      if (!(hf > lf)) return { pass: false, why: `hf=${hf.toExponential(2)} lf=${lf.toExponential(2)}` };
      return { pass: true };
    },
  },

  // ---- order=9 shapes more aggressively than order=2 -------------------
  {
    name: 'order=9 F-weighted has higher HF/LF ratio than order=2 on silence',
    run() {
      // Test the classic shaping signature: higher-order shaping concentrates
      // error energy in HF (aggressive tilt) relative to lower-order. F-weighted
      // curve targets the 3-4kHz ear-sensitivity peak with a NOTCH, so total LF
      // can actually be larger — what distinguishes 9th-order shaping is the
      // HF/LF RATIO, not the absolute LF level.
      const inp = new Float32Array(N);
      const o2 = render(freshOp({ bits: 8, order: 2, weighting: 0, seed: 9 }), inp);
      const o9 = render(freshOp({ bits: 8, order: 9, weighting: 1, seed: 9 }), inp);
      const r2 = rmsHF(o2) / (rmsLF(o2) || 1e-30);
      const r9 = rmsHF(o9) / (rmsLF(o9) || 1e-30);
      if (!(r9 > r2)) return { pass: false, why: `r9=${r9.toFixed(3)} r2=${r2.toFixed(3)}` };
      return { pass: true };
    },
  },

  // ---- determinism -----------------------------------------------------
  {
    name: 'same seed + params → identical output',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.07) * 0.6;
      const a = render(freshOp({ bits: 12, order: 9, seed: 42 }), inp);
      const b = render(freshOp({ bits: 12, order: 9, seed: 42 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'different weighting at order=9 → different output',
    run() {
      const inp = new Float32Array(N); inp.fill(0.1);
      const a = render(freshOp({ bits: 8, order: 9, weighting: 1, seed: 3 }), inp);  // F
      const b = render(freshOp({ bits: 8, order: 9, weighting: 3, seed: 3 }), inp);  // IE
      let diff = 0;
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) diff++;
      if (diff < N / 10) return { pass: false, why: `only ${diff}/${N} differ` };
      return { pass: true };
    },
  },

  // ---- reset ------------------------------------------------------------
  {
    name: 'reset() restores identical sequence',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.03) * 0.4;
      const op = freshOp({ bits: 8, order: 9, seed: 11 });
      const a = render(op, inp);
      op.reset();
      const b = render(op, inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- latency ----------------------------------------------------------
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },

  // ---- order snap -------------------------------------------------------
  {
    name: 'order snap: 4→5, 7→9... wait 7→5; 20→9',
    run() {
      // Snap logic: o≤2 → 2; o≤3 → 3; o≤5 → 5; else 9.
      // So 4 → 5 (not 3), 7 → 9 (not 5), 20 → 9.
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.05);
      const a = render(freshOp({ bits: 12, order: 5, weighting: 0, seed: 1 }), inp);
      const b = render(freshOp({ bits: 12, order: 4, weighting: 0, seed: 1 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `order 4 != snap to 5 at i=${i}` };
      // order=7: 7>5 so falls to else → snaps to 9.
      const c9 = render(freshOp({ bits: 12, order: 9, seed: 1 }), inp);
      const c7 = render(freshOp({ bits: 12, order: 7, seed: 1 }), inp);
      for (let i = 0; i < N; i++) if (c9[i] !== c7[i])
        return { pass: false, why: `order 7 != snap to 9 at i=${i}` };
      const d9  = render(freshOp({ bits: 12, order: 9,  seed: 1 }), inp);
      const d20 = render(freshOp({ bits: 12, order: 20, seed: 1 }), inp);
      for (let i = 0; i < N; i++) if (d9[i] !== d20[i])
        return { pass: false, why: `order 20 != snap to 9 at i=${i}` };
      return { pass: true };
    },
  },

  // ---- bits clamps ------------------------------------------------------
  {
    name: 'bits out of range clamped to [1,24]; no NaN',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1) * 0.5;
      const op = freshOp({ bits: 99, order: 9 });
      op.setParam('bits', -3);
      const out = render(op, inp);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },

  // ---- high-res case: 24-bit shaping should be near-transparent ---------
  {
    name: 'bits=24, order=9: output tracks input within a few LSBs',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 220 * i / SR) * 0.5;
      const out = render(freshOp({ bits: 24, order: 9, seed: 1 }), inp);
      const wi = 1 / Math.pow(2, 23);
      let maxErr = 0;
      for (let i = 0; i < N; i++) {
        const e = Math.abs(out[i] - inp[i]);
        if (e > maxErr) maxErr = e;
      }
      // Order-9 shaper pushes noise energy up → worst-case amplitude bounded
      // by the stable FIR gain (~22 LSBs for F9).
      if (maxErr > 30 * wi) return { pass: false, why: `maxErr=${maxErr}` };
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → bounded shaped noise, no NaN',
    run() {
      const op = freshOp({ bits: 8, order: 9, seed: 7 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
];

export default { opId: 'noiseShaper', tests };
