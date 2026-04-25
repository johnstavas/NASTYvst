// op_fm.test.js — real-math tests for op_fm (Chowning 2-operator FM).
// Run via: node scripts/check_op_math.mjs
//
// Primaries in op_fm.worklet.js header (Chowning 1973 / Wikipedia).
// Asserts:
//   - modIndex=0 → pure sine at carrier freq (FM degenerates to carrier)
//   - amp scales linearly
//   - finite + bounded under pathological inputs
//   - spectrum at c:m=1, I=1 has most energy near carrier (Bessel-J_0
//     dominant) and non-trivial energy in ±1 sidebands (Bessel-J_1)
//   - c:m=2 (inharmonic-bright) produces different spectrum than c:m=1
//   - reset + determinism

import { FmOp } from './op_fm.worklet.js';

const SR  = 48000;
const N   = 1024;
const approx = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new FmOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, n = N, extra = {}) {
  const out = new Float32Array(n);
  op.process(extra, { out }, n);
  return out;
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

// O(N²) DFT magnitude at bin k for buf length n.
function dftMag(buf, k) {
  const n = buf.length;
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) {
    const a = -2 * Math.PI * k * i / n;
    re += buf[i] * Math.cos(a);
    im += buf[i] * Math.sin(a);
  }
  return Math.hypot(re, im);
}

const tests = [
  // ---- degenerate case: I=0 → pure carrier --------------------------
  {
    name: 'modIndex=0: output equals a pure carrier sine',
    run() {
      const op = freshOp({ carrierFreq: 1000, modRatio: 1, modIndex: 0, amp: 1 });
      const out = render(op, 1024);
      // Expect sin(2π·1000·n/48000); check first 10 samples vs exact.
      for (let i = 0; i < 10; i++) {
        const expected = Math.sin(2 * Math.PI * 1000 * i / SR);
        if (Math.abs(out[i] - expected) > 1e-5)
          return { pass: false, why: `i=${i}: ${out[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },

  // ---- amp linearity -------------------------------------------------
  {
    name: 'amp=0.25 scales output linearly vs amp=1',
    run() {
      const a = render(freshOp({ carrierFreq: 440, modIndex: 2, amp: 1    }), 512);
      const b = render(freshOp({ carrierFreq: 440, modIndex: 2, amp: 0.25 }), 512);
      for (let i = 0; i < 512; i++) {
        if (Math.abs(b[i] - 0.25 * a[i]) > 1e-6)
          return { pass: false, why: `i=${i}: ${b[i]} vs ${0.25*a[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- bounded -------------------------------------------------------
  {
    name: 'bounded |y| ≤ amp for all I (sin() of anything ∈ [-1,1])',
    run() {
      const out = render(freshOp({ carrierFreq: 440, modIndex: 50, amp: 1 }), SR);
      const p = peak(out);
      if (p > 1.0001) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },
  {
    name: 'finite across 1 s @ f=440 Hz, I=5, ratio=2',
    run() {
      const out = render(freshOp({ carrierFreq: 440, modRatio: 2, modIndex: 5 }), SR);
      for (let i = 0; i < SR; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- Chowning spectral sanity --------------------------------------
  {
    name: 'c:m=1, I=1: energy at f_c ± f_m sidebands (Bessel J_1 non-zero)',
    run() {
      // Choose fc so carrier bin lands exactly. N=960 @ sr=48000 → bin width
      // = 50 Hz. fc=1000 → bin 20, fm=1000 → sidebands at bins 0 and 40.
      const NN = 960;
      const op = freshOp({ carrierFreq: 1000, modRatio: 1, modIndex: 1, amp: 1 });
      const out = new Float32Array(NN);
      op.process({}, { out }, NN);
      const carrierMag = dftMag(out, 20);
      const upperSide  = dftMag(out, 40);  // f_c + f_m
      // J_1(1) ≈ 0.44, J_0(1) ≈ 0.77 — upper sideband should be a
      // substantial fraction of the carrier magnitude.
      const ratio = upperSide / Math.max(carrierMag, 1e-12);
      if (ratio < 0.2 || ratio > 2.0)
        return { pass: false, why: `sideband/carrier=${ratio.toFixed(3)}` };
      return { pass: true };
    },
  },
  {
    name: 'I=0.01 ≪ 1: sideband energy ≪ carrier (weak-FM regime)',
    run() {
      const NN = 960;
      const op = freshOp({ carrierFreq: 1000, modRatio: 1, modIndex: 0.01, amp: 1 });
      const out = new Float32Array(NN);
      op.process({}, { out }, NN);
      const carrierMag = dftMag(out, 20);
      const upperSide  = dftMag(out, 40);
      // J_1(0.01) ≈ 0.005; expect ≥ 100× ratio carrier:sideband.
      if (!(upperSide < 0.02 * carrierMag))
        return { pass: false, why: `sideband=${upperSide.toFixed(4)} vs carrier=${carrierMag.toFixed(4)}` };
      return { pass: true };
    },
  },

  // ---- ratio != 1 produces different timbre --------------------------
  {
    name: 'changing modRatio changes the spectrum (c:m=1 vs c:m=2)',
    run() {
      const NN = 960;
      const a = new Float32Array(NN);
      const b = new Float32Array(NN);
      freshOp({ carrierFreq: 1000, modRatio: 1, modIndex: 2 }).process({}, { out: a }, NN);
      freshOp({ carrierFreq: 1000, modRatio: 2, modIndex: 2 }).process({}, { out: b }, NN);
      // c:m=1 places first sideband at f_c+f_m=2000 Hz (bin 40);
      // c:m=2 places it at 3000 Hz (bin 60) with NO energy at bin 40
      // (neg-k sidebands fold elsewhere). Assert b has near-zero bin 40
      // while a has substantial energy there — cleanest spectral
      // difference that doesn't require Bessel arithmetic.
      const a40 = dftMag(a, 40), b40 = dftMag(b, 40);
      if (!(a40 > 20 * Math.max(b40, 1e-9)))
        return { pass: false, why: `a40=${a40.toFixed(2)} b40=${b40.toFixed(2)} (expected a40 >> b40)` };
      return { pass: true };
    },
  },

  // ---- zero latency --------------------------------------------------
  {
    name: 'getLatencySamples() === 0',
    run() {
      const op = freshOp({});
      if (op.getLatencySamples() !== 0) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },

  // ---- reset / determinism -------------------------------------------
  {
    name: 'reset() restores phase-0 start for both carrier and modulator',
    run() {
      const op = freshOp({ carrierFreq: 440, modIndex: 3 });
      const a = render(op, 512);
      op.reset();
      const b = render(op, 512);
      for (let i = 0; i < 512; i++) if (!approx(a[i], b[i], 1e-6))
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'two fresh instances at same params produce identical output',
    run() {
      const a = render(freshOp({ carrierFreq: 333, modRatio: 1.5, modIndex: 2.3 }));
      const b = render(freshOp({ carrierFreq: 333, modRatio: 1.5, modIndex: 2.3 }));
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- freq clamps ---------------------------------------------------
  {
    name: 'carrierFreq below floor clamped — no NaN',
    run() {
      const out = render(freshOp({ carrierFreq: -500, modIndex: 5 }));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'carrierFreq above Nyquist clamped — bounded',
    run() {
      const out = render(freshOp({ carrierFreq: 500000, modIndex: 5 }));
      const p = peak(out);
      if (!Number.isFinite(p) || p > 1.0001)
        return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },

  // ---- control-rate inputs -------------------------------------------
  {
    name: 'freqMod=0 path tracks constant-freq path within float eps',
    run() {
      const fm = new Float32Array(N);
      const a = render(freshOp({ carrierFreq: 440, modIndex: 2 }), N, { freqMod: fm });
      const b = render(freshOp({ carrierFreq: 440, modIndex: 2 }), N);
      for (let i = 0; i < N; i++) if (Math.abs(a[i] - b[i]) > 1e-5)
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'idxMod sweeps index without NaN',
    run() {
      const idx = new Float32Array(N);
      for (let i = 0; i < N; i++) idx[i] = 10 * i / N;  // 0..10 ramp
      const out = render(freshOp({ carrierFreq: 440, modIndex: 0 }), N, { idxMod: idx });
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 1.0001) return { pass: false, why: `overshoot ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive -----------------------------------------------------
  {
    name: 'missing out buffer → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
];

export default { opId: 'fm', tests };
