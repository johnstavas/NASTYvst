// op_lfo.test.js — real-math tests for op_lfo.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_synthesis.md §6 (coupled sin/cos).
// Tests cover: sine frequency accuracy + range, magnitude stability under
// long-run renorm, shape-specific waveform shape (tri peaks, sq alternates,
// saw descends), phase-alignment across shapes, amount/offset scaling,
// reset, defensive null.

import { LfoOp } from './op_lfo.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new LfoOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, n) {
  const out = new Float32Array(n);
  op.process({}, { lfo: out }, n);
  return out;
}

// Count zero-crossings (used for frequency estimation).
function countZeroCrossings(buf) {
  let n = 0;
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i - 1] <= 0 && buf[i] > 0) || (buf[i - 1] >= 0 && buf[i] < 0)) n++;
  }
  return n;
}

// Find peak magnitude across a buffer.
function peak(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i]) > m) m = Math.abs(buf[i]);
  return m;
}

const tests = [
  // ---- sine frequency accuracy --------------------------------------
  {
    name: 'sine: 10 Hz gives ≈ 10 full cycles per second (zero crossings)',
    run() {
      const op = freshOp({ rateHz: 10, shape: 0 });
      const out = render(op, SR);  // 1 second
      const zc = countZeroCrossings(out);
      // 10 cycles/sec → 20 zero crossings.
      if (Math.abs(zc - 20) > 2) return { pass: false, why: `zc=${zc} expected ≈20` };
      return { pass: true };
    },
  },
  {
    name: 'sine: amplitude peaks at ±1 (default amount=1)',
    run() {
      const op = freshOp({ rateHz: 5, shape: 0 });
      const out = render(op, SR);
      const p = peak(out);
      if (p < 0.98 || p > 1.02) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },
  {
    name: 'sine: magnitude stays stable under long run (Canon §6 renorm)',
    run() {
      // Without renorm the coupled form's magnitude drifts. This test runs
      // for 10 seconds at 1 Hz and checks that peak stays within tolerance.
      const op = freshOp({ rateHz: 1, shape: 0 });
      const out = render(op, 10 * SR);
      const p = peak(out);
      if (p < 0.95 || p > 1.05) return { pass: false, why: `peak=${p} after long run` };
      return { pass: true };
    },
  },

  // ---- triangle -----------------------------------------------------
  {
    name: 'triangle: amplitude peaks at ±1',
    run() {
      const op = freshOp({ rateHz: 5, shape: 1 });
      const out = render(op, SR);
      const p = peak(out);
      if (p < 0.98 || p > 1.02) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },
  {
    name: 'triangle: phase-aligned with sine (starts at 0, rises positive)',
    run() {
      const op = freshOp({ rateHz: 1, shape: 1, amount: 1, offset: 0 });
      const out = render(op, 128);
      // First sample after one phase increment is small positive.
      if (!(out[0] > 0 && out[0] < 0.01)) return { pass: false, why: `out[0]=${out[0]}` };
      if (!(out[10] > out[0])) return { pass: false, why: `not rising: out[0]=${out[0]} out[10]=${out[10]}` };
      return { pass: true };
    },
  },
  {
    name: 'triangle: symmetric around zero (mean ≈ 0 over one period)',
    run() {
      const rate = 100;
      const op = freshOp({ rateHz: rate, shape: 1 });
      const n = Math.round(SR / rate);  // exactly one period
      const out = render(op, n);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += out[i];
      const m = sum / n;
      if (Math.abs(m) > 0.01) return { pass: false, why: `mean=${m}` };
      return { pass: true };
    },
  },

  // ---- square -------------------------------------------------------
  {
    name: 'square: output only takes values {+1, -1}',
    run() {
      const op = freshOp({ rateHz: 5, shape: 2 });
      const out = render(op, SR);
      for (let i = 0; i < out.length; i++) {
        if (out[i] !== 1 && out[i] !== -1) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'square: 50% duty cycle (count of +1 ≈ count of -1)',
    run() {
      const op = freshOp({ rateHz: 10, shape: 2 });
      const out = render(op, SR);
      let pos = 0, neg = 0;
      for (let i = 0; i < out.length; i++) { if (out[i] > 0) pos++; else neg++; }
      if (Math.abs(pos - neg) > SR * 0.02) return { pass: false, why: `pos=${pos} neg=${neg}` };
      return { pass: true };
    },
  },

  // ---- saw ----------------------------------------------------------
  {
    name: 'saw (↓): starts near +1 then descends to −1 over one period',
    run() {
      const op = freshOp({ rateHz: 1, shape: 3 });
      const n = SR;  // one full period
      const out = render(op, n);
      // At start, output should be near +1 (saw ↓ per registry label).
      if (!(out[0] > 0.9)) return { pass: false, why: `out[0]=${out[0]}` };
      // Near end of period, near -1.
      if (!(out[n - 10] < -0.9)) return { pass: false, why: `out[n-10]=${out[n - 10]}` };
      return { pass: true };
    },
  },
  {
    name: 'saw: monotonic descent within a period (no wraps tested)',
    run() {
      const op = freshOp({ rateHz: 1, shape: 3 });
      const n = SR - 10;  // avoid the wrap discontinuity
      const out = render(op, n);
      for (let i = 1; i < n; i++) {
        if (out[i] > out[i - 1] + 1e-5) return { pass: false, why: `non-monotonic at ${i}` };
      }
      return { pass: true };
    },
  },

  // ---- amount / offset ----------------------------------------------
  {
    name: 'amount scales amplitude; offset shifts DC',
    run() {
      const op = freshOp({ rateHz: 5, shape: 0, amount: 0.5, offset: 0.2 });
      const out = render(op, SR);
      let max = -Infinity, min = Infinity, sum = 0;
      for (let i = 0; i < out.length; i++) { if (out[i] > max) max = out[i]; if (out[i] < min) min = out[i]; sum += out[i]; }
      const mean = sum / out.length;
      // Expected: max ≈ 0.7, min ≈ -0.3, mean ≈ 0.2
      if (!approx(max, 0.7, 0.02)) return { pass: false, why: `max=${max}` };
      if (!approx(min, -0.3, 0.02)) return { pass: false, why: `min=${min}` };
      if (!approx(mean, 0.2, 0.01)) return { pass: false, why: `mean=${mean}` };
      return { pass: true };
    },
  },
  {
    name: 'amount=0 → DC at offset',
    run() {
      const op = freshOp({ rateHz: 5, shape: 0, amount: 0, offset: 0.42 });
      const out = render(op, 256);
      for (let i = 0; i < out.length; i++)
        if (!approx(out[i], 0.42, 1e-6)) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- rate-change phase sync ---------------------------------------
  {
    name: 'rate change mid-stream: no discontinuity on sine',
    run() {
      const op = freshOp({ rateHz: 2, shape: 0 });
      const a = render(op, 1024);
      op.setParam('rateHz', 5);
      const b = render(op, 1024);
      // Boundary sample should be within a reasonable delta of previous
      // (no large jump from re-seeding). At 5 Hz, per-sample step is small.
      const delta = Math.abs(b[0] - a[a.length - 1]);
      if (delta > 0.1) return { pass: false, why: `boundary delta=${delta}` };
      return { pass: true };
    },
  },
  {
    name: 'shape switch preserves phase (no jump at change)',
    run() {
      const op = freshOp({ rateHz: 5, shape: 0, amount: 1, offset: 0 });
      // Render to phase = 0.5 (sine crosses zero going negative).
      const n = Math.round(SR / 5 / 2);  // half period
      render(op, n);
      // At this point sine ≈ 0 (going negative). Switch to triangle, which
      // is also ≈ 0 (going negative) at phase=0.5. Boundary delta small.
      op.setParam('shape', 1);
      const after = render(op, 16);
      if (Math.abs(after[0]) > 0.05) return { pass: false, why: `tri jumped to ${after[0]}` };
      return { pass: true };
    },
  },

  // ---- reset --------------------------------------------------------
  {
    name: 'reset() returns phase to start (sine output begins at 0)',
    run() {
      const op = freshOp({ rateHz: 1, shape: 0, amount: 1, offset: 0 });
      render(op, 1000);
      op.reset();
      const out = render(op, 4);
      // After reset and one step, sine output = a ≈ 2π·1/SR ≈ 0.000131.
      if (Math.abs(out[0]) > 0.001) return { pass: false, why: `post-reset out[0]=${out[0]}` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------
  {
    name: 'missing output buffer → no throw',
    run() {
      const op = freshOp({ shape: 0 });
      try { op.process({}, {}, 64); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },

  // ---- determinism --------------------------------------------------
  {
    name: 'deterministic: two fresh ops with same params → identical output',
    run() {
      const a = render(freshOp({ rateHz: 3.5, shape: 0 }), 2048);
      const b = render(freshOp({ rateHz: 3.5, shape: 0 }), 2048);
      for (let i = 0; i < 2048; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'lfo', tests };
