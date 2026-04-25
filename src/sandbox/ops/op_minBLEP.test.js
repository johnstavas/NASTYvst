// op_minBLEP.test.js — real-math tests for op_minBLEP.
// Run via: node scripts/check_op_math.mjs
//
// Primaries in op_minBLEP.worklet.js header (Brandt 2001 + PolyBLEP).
// MinBLEP output is a naive saw + forward-only residual corrections at
// each wrap event. These tests check bounds, periodicity, zero-crossing
// count, no-NaN, freq/FM/amp/reset semantics, and that the min-phase
// residual actually reduces aliasing vs naive saw.

import { MinBlepOp } from './op_minBLEP.worklet.js';

const SR  = 48000;
const N   = 1024;
const approx = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new MinBlepOp(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}

function render(op, n = N, withFM = null) {
  const out = new Float32Array(n);
  const inputs = withFM ? { freqMod: withFM } : {};
  op.process(inputs, { out }, n);
  return out;
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

// Naive (non-BL) saw reference — used for alias-energy comparison above Nyquist.
function naiveSaw(freq, n) {
  const out = new Float32Array(n);
  let phase = 0;
  const dt = freq / SR;
  for (let i = 0; i < n; i++) {
    phase += dt;
    if (phase >= 1) phase -= 1;
    out[i] = 2 * phase - 1;
  }
  return out;
}

// Zero-crossings in rising direction (saw resets produce one per period).
function countRisingZeroCrossings(buf) {
  let c = 0;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] < 0 && buf[i] >= 0) c++;
  }
  return c;
}

// Energy above a cutoff bin via DFT magnitude. Small N, O(N²) — fine for tests.
function energyAboveBin(buf, cutoffBin) {
  const N = buf.length;
  let e = 0;
  for (let k = cutoffBin; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const a = -2 * Math.PI * k * n / N;
      re += buf[n] * Math.cos(a);
      im += buf[n] * Math.sin(a);
    }
    e += re * re + im * im;
  }
  return e;
}

const tests = [
  // ---- basic shape / range ------------------------------------------
  {
    name: 'finite output across 1 second @ 440 Hz',
    run() {
      const out = render(freshOp({ freq: 440 }), SR);
      for (let i = 0; i < SR; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `NaN/Inf at i=${i}, val=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'bounded |y| ≤ 1.5 for 1 second @ 440 Hz (naive saw + correction)',
    run() {
      const out = render(freshOp({ freq: 440 }), SR);
      const p = peak(out);
      // Naive saw is in [−1,+1). MinBLEP residual has Gibbs-like
      // overshoot (~15–25%) after the min-phase integration — Brandt
      // §6.3, Fig 5. Post-gain softclip or explicit ceiling are
      // downstream concerns; here we just bound gross overshoot.
      if (p > 1.5) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },

  // ---- period / count -----------------------------------------------
  {
    name: '~1000 rising zero-crossings in 1 s @ 1 kHz (one per wrap)',
    run() {
      const out = render(freshOp({ freq: 1000 }), SR);
      const c = countRisingZeroCrossings(out);
      if (c < 980 || c > 1020) return { pass: false, why: `${c} crossings, expected ~1000` };
      return { pass: true };
    },
  },

  // ---- aliasing reduction vs naive (the whole point of MinBLEP) -----
  {
    name: 'less aliasing than naive saw at 4 kHz (energy in top octave)',
    run() {
      // Render a power-of-two so DFT bins line up cleanly.
      const NN  = 2048;
      const f   = 4000;
      const bl  = render(freshOp({ freq: f }), NN);
      const nv  = naiveSaw(f, NN);
      // Compare energy above Nyquist/2 — naive saw has loads of aliased
      // components folded down; min-phase BLEP suppresses high-band
      // energy. "Less than naive" is the defining claim of the op.
      const cutoff = Math.floor(NN / 4);   // Nyquist/2 in bins
      const eBL = energyAboveBin(bl, cutoff);
      const eNV = energyAboveBin(nv, cutoff);
      if (!(eBL < eNV)) return { pass: false, why: `blep=${eBL.toFixed(2)} naive=${eNV.toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- state / reset -------------------------------------------------
  {
    name: 'reset() restores phase-0 start and clears events',
    run() {
      const op = freshOp({ freq: 440 });
      const a = render(op, 512);
      op.reset();
      const b = render(op, 512);
      for (let i = 0; i < 512; i++) if (!approx(a[i], b[i], 1e-6))
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'two fresh instances at same freq produce identical output',
    run() {
      const a = render(freshOp({ freq: 123.45 }));
      const b = render(freshOp({ freq: 123.45 }));
      for (let i = 0; i < N; i++) if (a[i] !== b[i])
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- getLatencySamples = 0 (the whole point of min-phase) ---------
  {
    name: 'getLatencySamples() === 0 (min-phase residual is causal)',
    run() {
      const op = freshOp({ freq: 440 });
      const lat = op.getLatencySamples();
      if (lat !== 0) return { pass: false, why: `latency=${lat}` };
      return { pass: true };
    },
  },

  // ---- freq change mid-stream ---------------------------------------
  {
    name: 'freq change mid-stream: no huge boundary jump',
    run() {
      const op = freshOp({ freq: 440 });
      const a = render(op, 64);
      op.setParam('freq', 880);
      const b = render(op, 64);
      const jump = Math.abs(b[0] - a[63]);
      if (jump > 2.2) return { pass: false, why: `boundary jump=${jump}` };
      return { pass: true };
    },
  },

  // ---- freq clamps --------------------------------------------------
  {
    name: 'freq below floor clamped — no NaN',
    run() {
      const out = render(freshOp({ freq: -50 }));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'freq above Nyquist clamped — bounded output',
    run() {
      const out = render(freshOp({ freq: 500000 }));
      const p = peak(out);
      // Clamps to nyq-1; at that rate events stack to BLEP_LEN=8
      // simultaneously, so correction magnitude compounds. Bound for
      // finiteness + sanity, not for musical usability.
      if (!Number.isFinite(p) || p > 4)
        return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },

  // ---- amp ----------------------------------------------------------
  {
    name: 'amp=0 → silent',
    run() {
      const out = render(freshOp({ freq: 440, amp: 0 }));
      for (let i = 0; i < N; i++) if (out[i] !== 0)
        return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'amp=0.25 scales linearly (peak of 440 Hz scaled by 1/4)',
    run() {
      const a = render(freshOp({ freq: 440, amp: 1    }));
      const b = render(freshOp({ freq: 440, amp: 0.25 }));
      const pa = peak(a), pb = peak(b);
      const ratio = pb / pa;
      if (!approx(ratio, 0.25, 1e-5))
        return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },

  // ---- FM path -------------------------------------------------------
  {
    name: 'freqMod=0 path tracks constant-freq path within float eps',
    run() {
      const fm = new Float32Array(N);
      const a = render(freshOp({ freq: 440 }), N, fm);
      const b = render(freshOp({ freq: 440 }), N);
      for (let i = 0; i < N; i++) if (Math.abs(a[i] - b[i]) > 1e-5)
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'FM sweep (440→880): output finite, bounded',
    run() {
      const fm = new Float32Array(N);
      for (let i = 0; i < N; i++) fm[i] = 440 * i / N;
      const out = render(freshOp({ freq: 440 }), N, fm);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 1.5)   return { pass: false, why: `overshoot ${out[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing out buffer → no throw',
    run() {
      const op = freshOp({ freq: 440 });
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
];

export default { opId: 'minBLEP', tests };
