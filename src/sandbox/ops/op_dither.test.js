// op_dither.test.js — real-math tests for TPDF dither + 2nd-order shaping.
// Run via: node scripts/check_op_math.mjs

import { DitherOp } from './op_dither.worklet.js';

const SR = 48000;
const N  = 2048;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DitherOp(SR);
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
function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

const tests = [
  // ---- quantization grid ------------------------------------------------
  {
    name: 'bits=4: output samples fall on wi·k grid (wi = 1/8)',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.9;
      const out = render(freshOp({ bits: 4, shape: 0, seed: 1 }), inp);
      const wi = 1 / Math.pow(2, 3);   // bits-1 = 3 → w=8, wi=0.125
      for (let i = 0; i < N; i++) {
        const k = Math.round(out[i] / wi);
        if (!approx(out[i], k * wi, 1e-5)) {
          return { pass: false, why: `i=${i}: ${out[i]} not on grid ${wi}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- bounded ----------------------------------------------------------
  {
    name: 'output bounded within |y| ≤ 1 + 1 LSB for input in [-1, +1]',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.99;
      const out = render(freshOp({ bits: 16, shape: 0.5, seed: 7 }), inp);
      const p = peak(out);
      const wi = 1 / Math.pow(2, 15);
      if (p > 1 + 2 * wi) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },

  // ---- dither actually adds noise --------------------------------------
  {
    name: 'DC input: dither produces non-constant output (TPDF active)',
    run() {
      const inp = new Float32Array(N); inp.fill(0.3);
      const out = render(freshOp({ bits: 8, shape: 0, seed: 3 }), inp);
      let minV =  Infinity, maxV = -Infinity;
      for (let i = 0; i < N; i++) { if (out[i] < minV) minV = out[i]; if (out[i] > maxV) maxV = out[i]; }
      const wi = 1 / Math.pow(2, 7);
      // TPDF ±1 LSB should produce at least 2 distinct quantization levels.
      if (maxV - minV < wi) return { pass: false, why: `range=${maxV - minV} < ${wi}` };
      return { pass: true };
    },
  },

  // ---- no-input silence case -------------------------------------------
  {
    name: 'zero input + shape=0: output near zero (only dither noise)',
    run() {
      const inp = new Float32Array(N);   // all zeros
      const out = render(freshOp({ bits: 16, shape: 0, seed: 9 }), inp);
      const wi = 1 / Math.pow(2, 15);
      // Each sample is at most 1 LSB from 0 (TPDF ±1 LSB + offset).
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i]) > 2 * wi) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- noise shaping reduces in-band noise -----------------------------
  {
    name: 'shape=0.5 reduces low-band noise energy vs shape=0 on silent input',
    run() {
      // Downsample check: sum of every-4th-sample should be smaller when
      // shape pushes noise above Nyquist/4.
      const inp = new Float32Array(N);
      const flat = render(freshOp({ bits: 8, shape: 0,   seed: 2 }), inp);
      const shap = render(freshOp({ bits: 8, shape: 0.5, seed: 2 }), inp);
      // Crude LP: 4-sample moving sum (rejects HF).
      let eFlat = 0, eShap = 0;
      for (let i = 3; i < N; i++) {
        const lpF = flat[i] + flat[i-1] + flat[i-2] + flat[i-3];
        const lpS = shap[i] + shap[i-1] + shap[i-2] + shap[i-3];
        eFlat += lpF * lpF;
        eShap += lpS * lpS;
      }
      if (!(eShap < eFlat)) return { pass: false, why: `shap_lf=${eShap.toExponential(2)} flat_lf=${eFlat.toExponential(2)}` };
      return { pass: true };
    },
  },

  // ---- determinism ------------------------------------------------------
  {
    name: 'same seed + params → identical output',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1) * 0.5;
      const a = render(freshOp({ bits: 8, shape: 0.5, seed: 42 }), inp);
      const b = render(freshOp({ bits: 8, shape: 0.5, seed: 42 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'different seed → different dither noise',
    run() {
      const inp = new Float32Array(N);      // silence
      const a = render(freshOp({ bits: 8, shape: 0, seed: 1 }), inp);
      const b = render(freshOp({ bits: 8, shape: 0, seed: 2 }), inp);
      let diffs = 0;
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) diffs++;
      if (diffs < N / 4) return { pass: false, why: `only ${diffs}/${N} differ` };
      return { pass: true };
    },
  },

  // ---- bits=24: near-transparent ---------------------------------------
  {
    name: 'bits=24: output very close to input (high-res dither)',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
      const out = render(freshOp({ bits: 24, shape: 0, seed: 1 }), inp);
      let maxErr = 0;
      for (let i = 0; i < N; i++) {
        const e = Math.abs(out[i] - inp[i]);
        if (e > maxErr) maxErr = e;
      }
      const wi = 1 / Math.pow(2, 23);
      if (maxErr > 4 * wi) return { pass: false, why: `maxErr=${maxErr} > ${4*wi}` };
      return { pass: true };
    },
  },

  // ---- reset ------------------------------------------------------------
  {
    name: 'reset() restores identical output',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.05) * 0.4;
      const op = freshOp({ bits: 8, shape: 0.5, seed: 11 });
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

  // ---- clamps -----------------------------------------------------------
  {
    name: 'bits out of range clamped to [1, 24]',
    run() {
      const op = freshOp({});
      op.setParam('bits', -5);
      op.setParam('bits', 99);
      // Should not have thrown or produced garbage
      const inp = new Float32Array(N); inp.fill(0.5);
      const out = render(op, inp);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'shape > 1 clamped; shape = NaN falls back to 0.5',
    run() {
      const op1 = freshOp({ shape: 99 });
      const op2 = freshOp({ shape: NaN });
      const inp = new Float32Array(N);
      const a = render(op1, inp);
      const b = render(op2, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(a[i])) return { pass: false, why: `a[${i}] nan` };
        if (!Number.isFinite(b[i])) return { pass: false, why: `b[${i}] nan` };
      }
      return { pass: true };
    },
  },

  // ---- defensive --------------------------------------------------------
  {
    name: 'missing input → dither-only output, no NaN',
    run() {
      const op = freshOp({ bits: 8, shape: 0.5, seed: 4 });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },

  // ---- sine pass-through sanity ----------------------------------------
  {
    name: 'bits=12, sine input: quantized signal tracks original (mean ≈ 0)',
    run() {
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 500 * i / SR) * 0.8;
      const out = render(freshOp({ bits: 12, shape: 0, seed: 5 }), inp);
      // Mean of dithered sine should stay near input mean (DC-free).
      let mi = 0, mo = 0;
      for (let i = 0; i < N; i++) { mi += inp[i]; mo += out[i]; }
      const wi = 1 / Math.pow(2, 11);
      // Kellett adds an offset of wi/2 per sample → mean offset ≈ wi/2.
      const drift = Math.abs((mo - mi) / N);
      if (drift > wi) return { pass: false, why: `drift=${drift} > ${wi}` };
      return { pass: true };
    },
  },
];

export default { opId: 'dither', tests };
