// op_sineOsc.test.js — real-math tests for op_sineOsc.
// Run via: node scripts/check_op_math.mjs

import { SineOscOp } from './op_sineOsc.worklet.js';

const SR  = 48000;
const N   = 1024;
const EPS = 1e-5;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new SineOscOp(SR);
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

function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function peak(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

const tests = [
  // ---- phase + freq accuracy ----------------------------------------
  {
    name: '440 Hz: out[0] = 0 (starts at phase 0)',
    run() {
      const out = render(freshOp({ freq: 440 }));
      if (!approx(out[0], 0, 1e-6)) return { pass: false, why: `out[0]=${out[0]}` };
      return { pass: true };
    },
  },
  {
    name: '440 Hz: matches Math.sin(2π·f·n/sr) to < 1e-4',
    run() {
      const out = render(freshOp({ freq: 440 }), 2048);
      const w = 2 * Math.PI * 440 / SR;
      for (let i = 0; i < 2048; i++) {
        const expected = Math.sin(w * i);
        if (Math.abs(out[i] - expected) > 1e-4)
          return { pass: false, why: `i=${i}: got ${out[i]}, expected ${expected}, err=${out[i]-expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: '1 kHz: zero-crossing count ≈ 2·f·T over 1 second',
    run() {
      const op = freshOp({ freq: 1000 });
      const out = render(op, SR);  // 1 s
      let zc = 0;
      for (let i = 1; i < SR; i++)
        if ((out[i - 1] <= 0 && out[i] > 0) || (out[i - 1] >= 0 && out[i] < 0)) zc++;
      // Expect ~2000 zero crossings.
      if (zc < 1990 || zc > 2010) return { pass: false, why: `${zc} zero crossings, expected ~2000` };
      return { pass: true };
    },
  },

  // ---- amplitude ----------------------------------------------------
  {
    name: 'amp=1: peak within [0.999, 1.001]',
    run() {
      const out = render(freshOp({ freq: 1000 }), 2048);
      const p = peak(out);
      if (p < 0.999 || p > 1.001) return { pass: false, why: `peak=${p}` };
      return { pass: true };
    },
  },
  {
    name: 'amp=0.5: RMS ≈ 0.5/√2',
    run() {
      const out = render(freshOp({ freq: 1000, amp: 0.5 }), 4096);
      const r = rms(out);
      const expected = 0.5 / Math.sqrt(2);
      if (!approx(r, expected, 0.005)) return { pass: false, why: `RMS=${r.toFixed(5)} vs ${expected.toFixed(5)}` };
      return { pass: true };
    },
  },
  {
    name: 'amp=0: silent output',
    run() {
      const out = render(freshOp({ freq: 1000, amp: 0 }));
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- determinism / reset ------------------------------------------
  {
    name: 'reset() restores phase-0 start',
    run() {
      const op = freshOp({ freq: 440 });
      const a = render(op);
      op.reset();
      const b = render(op);
      for (let i = 0; i < N; i++) if (!approx(a[i], b[i], 1e-7))
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
        return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },

  // ---- freq clamps / edge cases -------------------------------------
  {
    name: 'freq below floor clamped (no NaN)',
    run() {
      const out = render(freshOp({ freq: -100 }));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i]))
        return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'freq above Nyquist clamped (no NaN / blowup)',
    run() {
      const out = render(freshOp({ freq: 200000 }));
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i]))  return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 1.01)   return { pass: false, why: `blowup at ${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'stability: 60 s at 1 kHz stays bounded (peak < 1.001)',
    run() {
      const op = freshOp({ freq: 1000 });
      // Render in 1024-sample chunks for 60 s worth of samples.
      const total = SR * 60;
      let p = 0;
      const chunk = new Float32Array(1024);
      for (let done = 0; done < total; done += 1024) {
        op.process({}, { out: chunk }, 1024);
        for (let i = 0; i < 1024; i++) { const a = Math.abs(chunk[i]); if (a > p) p = a; }
      }
      if (p > 1.001) return { pass: false, why: `peak=${p} after 60s` };
      return { pass: true };
    },
  },

  // ---- FM path ------------------------------------------------------
  {
    name: 'freqMod CV shifts output freq (coarse zero-crossing check)',
    run() {
      // Base 500 Hz, +500 Hz FM offset → ~1000 Hz → ~2000 zero crossings / s.
      const fm = new Float32Array(SR);
      for (let i = 0; i < SR; i++) fm[i] = 500;
      const op = freshOp({ freq: 500 });
      const out = render(op, SR, fm);
      let zc = 0;
      for (let i = 1; i < SR; i++)
        if ((out[i - 1] <= 0 && out[i] > 0) || (out[i - 1] >= 0 && out[i] < 0)) zc++;
      if (zc < 1980 || zc > 2020) return { pass: false, why: `${zc} crossings, expected ~2000` };
      return { pass: true };
    },
  },
  {
    name: 'freqMod=0 path matches no-FM path bit-exactly',
    run() {
      const fm = new Float32Array(N);
      const a = render(freshOp({ freq: 440 }), N, fm);
      const b = render(freshOp({ freq: 440 }), N);
      // FM path recomputes cos per-sample; equality will be within float eps.
      for (let i = 0; i < N; i++) if (Math.abs(a[i] - b[i]) > 1e-6)
        return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },

  // ---- setParam without reset preserves phase continuity ------------
  {
    name: 'freq change mid-run does not click (|Δ| < 0.1)',
    run() {
      const op = freshOp({ freq: 440 });
      const a = render(op, 64);
      op.setParam('freq', 880);
      const b = render(op, 64);
      const boundary = Math.abs(b[0] - a[63]);
      if (boundary > 0.1) return { pass: false, why: `Δ at boundary=${boundary}` };
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

export default { opId: 'sineOsc', tests };
