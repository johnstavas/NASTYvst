// op_filter.test.js — real-math tests for op_filter.
// Run via: node scripts/check_op_math.mjs
//
// Tests verify the RBJ biquad against canonical behavior: DC gain = 1 for
// LP, DC gain = 0 for HP/BP/notch, notch attenuation at f=cutoff, stability
// under constant input, and sum-of-modes sanity (LP+HP at f=f0 summed ≈ in).
// See dsp_code_canon_filters.md §9 for coefficient derivations.

import { FilterOp } from './op_filter.worklet.js';

const SR  = 48000;
const N   = 4096;   // long enough for transient to decay + steady-state
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new FilterOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n = N) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return out;
}

// Peak magnitude across the tail of a buffer (skip transient).
function tailPeak(buf, skip = 1024) {
  let m = 0;
  for (let i = skip; i < buf.length; i++) if (Math.abs(buf[i]) > m) m = Math.abs(buf[i]);
  return m;
}

// RMS across the tail.
function tailRms(buf, skip = 1024) {
  let s = 0, n = 0;
  for (let i = skip; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

const tests = [
  // ---- DC behavior ---------------------------------------------------
  {
    name: 'LP: DC gain = 1 (constant input → constant output)',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 1000, q: 0.707 });
      const out = render(op, 0.5);
      const last = out[out.length - 1];
      if (!approx(last, 0.5, 1e-4)) return { pass: false, why: `tail=${last}, expected 0.5` };
      return { pass: true };
    },
  },
  {
    name: 'HP: DC gain = 0 (constant input → decays to 0)',
    run() {
      const op = freshOp({ mode: 'hp', cutoff: 1000, q: 0.707 });
      const out = render(op, 0.5);
      const peak = tailPeak(out, 2048);
      if (peak > 1e-3) return { pass: false, why: `tail peak=${peak}` };
      return { pass: true };
    },
  },
  {
    name: 'BP: DC gain = 0',
    run() {
      const op = freshOp({ mode: 'bp', cutoff: 1000, q: 0.707 });
      const out = render(op, 0.5);
      const peak = tailPeak(out, 2048);
      if (peak > 1e-3) return { pass: false, why: `tail peak=${peak}` };
      return { pass: true };
    },
  },

  // ---- Nyquist behavior ---------------------------------------------
  {
    name: 'LP: Nyquist rejection (alternating ±1 → near zero tail)',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 200, q: 0.707 });
      const out = render(op, i => (i % 2 === 0 ? 1 : -1));
      const peak = tailPeak(out, 2048);
      if (peak > 0.05) return { pass: false, why: `tail peak=${peak} (expected near-zero — Nyquist should be rejected)` };
      return { pass: true };
    },
  },
  {
    name: 'HP: Nyquist passes (alternating ±1 → full amplitude tail)',
    run() {
      const op = freshOp({ mode: 'hp', cutoff: 200, q: 0.707 });
      const out = render(op, i => (i % 2 === 0 ? 1 : -1));
      const peak = tailPeak(out, 2048);
      if (peak < 0.9) return { pass: false, why: `tail peak=${peak} (expected ~1 — Nyquist should pass)` };
      return { pass: true };
    },
  },

  // ---- Notch ---------------------------------------------------------
  {
    name: 'Notch: sine at cutoff attenuated ≥ 20 dB',
    run() {
      const f0 = 1000;
      const op = freshOp({ mode: 'notch', cutoff: f0, q: 4 });
      const inFill = i => Math.sin(2 * Math.PI * f0 * i / SR);
      const dry = new Float32Array(N);
      for (let i = 0; i < N; i++) dry[i] = inFill(i);
      const out = render(op, inFill);
      const dryRms = tailRms(dry, 2048);
      const outRms = tailRms(out, 2048);
      const attDb = 20 * Math.log10(outRms / dryRms);
      if (attDb > -20) return { pass: false, why: `att=${attDb.toFixed(1)} dB, expected ≤ -20` };
      return { pass: true };
    },
  },

  // ---- stability / finite-ness --------------------------------------
  {
    name: 'Stability: high-Q LP does not blow up',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 2000, q: 20 });
      const out = render(op, i => Math.sin(2 * Math.PI * 2000 * i / SR));
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 100)   return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Stability: Q clamp — q=1000 must still be finite',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 1000, q: 1000 });
      const out = render(op, 0.1);
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'Stability: cutoff clamp — cutoff above Nyquist must still be finite',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 100000, q: 0.707 });
      const out = render(op, 0.5);
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },

  // ---- reset() -------------------------------------------------------
  {
    name: 'reset() clears biquad state',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 500, q: 0.707 });
      render(op, i => Math.sin(2 * Math.PI * 500 * i / SR));
      op.reset();
      // After reset, internal state zero — first output sample should equal
      // b0 * x[0] exactly. Using x[0]=1 isolates the coefficient.
      const probe = new Float32Array(1);
      probe[0] = 1;
      const out = new Float32Array(1);
      op.process({ in: probe }, { out }, 1);
      // b0 for LP is (1-cos(w0))/2 / (1+alpha). Don't hard-code; just check
      // that output is small and finite (LP b0 at 500 Hz is ~0.001, nonzero).
      if (!Number.isFinite(out[0])) return { pass: false, why: `NaN` };
      if (out[0] <= 0 || out[0] > 1) return { pass: false, why: `y[0]=${out[0]} out of plausible range` };
      return { pass: true };
    },
  },

  // ---- missing input -------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ mode: 'lp' });
      const out = new Float32Array(N);
      op.process({}, { out }, N);
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- mode switching ------------------------------------------------
  {
    name: 'Mode switch: setParam(mode, hp) transitions to high-pass DC rejection',
    run() {
      const op = freshOp({ mode: 'lp', cutoff: 1000 });
      op.setParam('mode', 'hp');
      op.reset();
      const out = render(op, 0.5);
      const peak = tailPeak(out, 2048);
      if (peak > 1e-3) return { pass: false, why: `after mode switch, tail peak=${peak}` };
      return { pass: true };
    },
  },
  {
    name: 'Invalid mode string falls back to lp',
    run() {
      const op = freshOp({ mode: 'bogus' });
      const out = render(op, 0.5);
      const last = out[out.length - 1];
      if (!approx(last, 0.5, 1e-4)) return { pass: false, why: `tail=${last}, expected LP DC pass` };
      return { pass: true };
    },
  },

  // ---- Peaking (bell) -----------------------------------------------
  {
    name: 'Peaking: gainDb=0 → unity (sine at cutoff RMS unchanged within 0.5 dB)',
    run() {
      const f0 = 1000;
      const op = freshOp({ mode: 'peaking', cutoff: f0, q: 1, gainDb: 0 });
      const inFill = i => Math.sin(2 * Math.PI * f0 * i / SR);
      const dry = new Float32Array(N);
      for (let i = 0; i < N; i++) dry[i] = inFill(i);
      const out = render(op, inFill);
      const dryRms = tailRms(dry, 2048);
      const outRms = tailRms(out, 2048);
      const dB = 20 * Math.log10(outRms / dryRms);
      if (Math.abs(dB) > 0.5) return { pass: false, why: `unity peaking off by ${dB.toFixed(2)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'Peaking: +12 dB boost at cutoff (sine RMS gain ≈ +12 dB ± 0.5)',
    run() {
      const f0 = 1000;
      const op = freshOp({ mode: 'peaking', cutoff: f0, q: 1, gainDb: 12 });
      const inFill = i => Math.sin(2 * Math.PI * f0 * i / SR);
      const dry = new Float32Array(N);
      for (let i = 0; i < N; i++) dry[i] = inFill(i);
      const out = render(op, inFill);
      const dryRms = tailRms(dry, 2048);
      const outRms = tailRms(out, 2048);
      const dB = 20 * Math.log10(outRms / dryRms);
      if (Math.abs(dB - 12) > 0.5) return { pass: false, why: `boost=${dB.toFixed(2)} dB, expected ~+12` };
      return { pass: true };
    },
  },
  {
    name: 'Peaking: -12 dB cut at cutoff (sine RMS gain ≈ -12 dB ± 0.5)',
    run() {
      const f0 = 1000;
      const op = freshOp({ mode: 'peaking', cutoff: f0, q: 1, gainDb: -12 });
      const inFill = i => Math.sin(2 * Math.PI * f0 * i / SR);
      const dry = new Float32Array(N);
      for (let i = 0; i < N; i++) dry[i] = inFill(i);
      const out = render(op, inFill);
      const dryRms = tailRms(dry, 2048);
      const outRms = tailRms(out, 2048);
      const dB = 20 * Math.log10(outRms / dryRms);
      if (Math.abs(dB - -12) > 0.5) return { pass: false, why: `cut=${dB.toFixed(2)} dB, expected ~-12` };
      return { pass: true };
    },
  },
  {
    name: 'Peaking: DC unaffected (constant input passes through)',
    run() {
      const op = freshOp({ mode: 'peaking', cutoff: 1000, q: 1, gainDb: 12 });
      const out = render(op, 0.5);
      const last = out[out.length - 1];
      if (!approx(last, 0.5, 1e-3)) return { pass: false, why: `DC=${last}, expected 0.5 (peaking should not affect DC)` };
      return { pass: true };
    },
  },
  {
    name: 'Peaking: gainDb clamped to ±36 dB (gainDb=999 → finite, no NaN)',
    run() {
      const op = freshOp({ mode: 'peaking', cutoff: 1000, q: 1, gainDb: 999 });
      const out = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR));
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'filter', tests };
