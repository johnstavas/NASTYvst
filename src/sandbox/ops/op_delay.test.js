// op_delay.test.js — real-math tests for op_delay.
// Run via: node scripts/check_op_math.mjs
//
// Research-backed against dsp_code_canon_time_interp.md §1 (Hermite-4).
// Tests cover: impulse arrives at correct sample delay, integer-time
// passthrough is bit-exact, fractional delay interpolates smoothly,
// feedback port scales external return and adds to line, timeMod shifts
// read position, reset clears line, denormal flush, defensive null.

import { DelayOp } from './op_delay.worklet.js';

const SR  = 48000;
const EPS = 1e-6;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new DelayOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, n, { inFill = 0, fbFill = null, modFill = null } = {}) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  const args = { in: inBuf };
  if (fbFill !== null) {
    const fb = new Float32Array(n);
    for (let i = 0; i < n; i++) fb[i] = typeof fbFill === 'function' ? fbFill(i) : fbFill;
    args.fb = fb;
  }
  if (modFill !== null) {
    const m = new Float32Array(n);
    for (let i = 0; i < n; i++) m[i] = typeof modFill === 'function' ? modFill(i) : modFill;
    args.timeMod = m;
  }
  op.process(args, { out }, n);
  return { inBuf, out };
}

const tests = [
  // ---- impulse timing ------------------------------------------------
  {
    name: 'impulse at t=0 arrives at sample = time·sr/1000 (int delay)',
    run() {
      // 1 ms at 48 kHz → exactly 48 samples.
      const op = freshOp({ time: 1, feedback: 0 });
      const { out } = render(op, 128, { inFill: i => i === 0 ? 1 : 0 });
      const expectedIdx = 48;
      if (!approx(out[expectedIdx], 1, 1e-4)) return { pass: false, why: `out[${expectedIdx}]=${out[expectedIdx]}` };
      // Adjacent samples should be nearly zero (Hermite wiggle ok ≤ 1e-3).
      if (Math.abs(out[expectedIdx - 1]) > 1e-3) return { pass: false, why: `pre=${out[expectedIdx - 1]}` };
      if (Math.abs(out[expectedIdx + 1]) > 1e-3) return { pass: false, why: `post=${out[expectedIdx + 1]}` };
      return { pass: true };
    },
  },
  {
    name: 'integer delay: DC step arrives D samples later at unity',
    run() {
      const op = freshOp({ time: 2, feedback: 0 });  // 96 samples
      const { out } = render(op, 512, { inFill: 1 });
      const D = 96;
      // By sample D+4 (Hermite margin) output should be at 1.
      if (!approx(out[D + 4], 1, 1e-4)) return { pass: false, why: `out[${D + 4}]=${out[D + 4]}` };
      // Before D, output should be ~0.
      if (Math.abs(out[D - 4]) > 1e-2) return { pass: false, why: `pre=${out[D - 4]}` };
      return { pass: true };
    },
  },

  // ---- sine passthrough ----------------------------------------------
  {
    name: 'sine at integer delay: output matches input shifted by D samples',
    run() {
      const D  = 48;  // samples
      const op = freshOp({ time: 1, feedback: 0 });  // 1 ms
      const { inBuf, out } = render(op, 2048, {
        inFill: i => Math.sin(2 * Math.PI * 440 * i / SR),
      });
      // Compare out[D+k] ≈ inBuf[k] after initial settling.
      for (let k = 64; k < 1024; k++) {
        if (Math.abs(out[D + k] - inBuf[k]) > 1e-3) {
          return { pass: false, why: `k=${k}: ${out[D + k]} vs ${inBuf[k]}` };
        }
      }
      return { pass: true };
    },
  },

  // ---- Hermite fractional --------------------------------------------
  {
    name: 'fractional delay: smooth sine at non-integer sample delay',
    run() {
      // Pick a delay that is NOT an integer sample count.
      // 1.5 ms = 72 samples exactly at 48k — pick something fractional.
      // 1.02083... ms → 49.0 samples. Use time=1.01 ms → 48.48 samples.
      const op = freshOp({ time: 1.01, feedback: 0 });
      const { out } = render(op, 4096, {
        inFill: i => Math.sin(2 * Math.PI * 440 * i / SR),
      });
      // Output should be a clean sine of amp ≈ 1 after settling.
      let peak = 0;
      for (let i = 512; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
      if (peak < 0.98 || peak > 1.02) return { pass: false, why: `peak=${peak}` };
      return { pass: true };
    },
  },

  // ---- feedback port --------------------------------------------------
  {
    name: 'feedback port: external fb signal scaled by feedback param adds to line',
    run() {
      const op = freshOp({ time: 1, feedback: 0.5 });
      // No in, constant fb = 1. After D samples, out should equal 0.5.
      const { out } = render(op, 256, { inFill: 0, fbFill: 1 });
      // At sample ≥ 52 (D=48 + a few for Hermite settling), out ≈ 0.5.
      if (!approx(out[96], 0.5, 1e-3)) return { pass: false, why: `out[96]=${out[96]}` };
      return { pass: true };
    },
  },
  {
    name: 'feedback unwired: feedback param has no effect (no self-loop baked in)',
    run() {
      const a = freshOp({ time: 1, feedback: 0.0 });
      const b = freshOp({ time: 1, feedback: 0.9 });
      const { out: outA } = render(a, 256, { inFill: i => i === 0 ? 1 : 0 });
      const { out: outB } = render(b, 256, { inFill: i => i === 0 ? 1 : 0 });
      for (let i = 0; i < 256; i++) {
        if (Math.abs(outA[i] - outB[i]) > 1e-9) return { pass: false, why: `i=${i}: ${outA[i]} vs ${outB[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- timeMod -------------------------------------------------------
  {
    name: 'timeMod: positive offset delays output longer',
    run() {
      // Base 1 ms = 48 samples. Add +0.001 s = +1 ms → total 2 ms = 96 samples.
      const op = freshOp({ time: 1, feedback: 0 });
      const { out } = render(op, 256, {
        inFill: i => i === 0 ? 1 : 0,
        modFill: 0.001,  // +1 ms
      });
      // Peak should appear near sample 96, not 48.
      if (!approx(out[96], 1, 1e-3)) return { pass: false, why: `out[96]=${out[96]}` };
      if (Math.abs(out[48]) > 1e-2)  return { pass: false, why: `out[48]=${out[48]} (should be ~0)` };
      return { pass: true };
    },
  },

  // ---- reset ---------------------------------------------------------
  {
    name: 'reset() clears line',
    run() {
      const op = freshOp({ time: 1, feedback: 0 });
      render(op, 256, { inFill: 1 });  // fill line with 1s
      op.reset();
      const { out } = render(op, 256, { inFill: 0 });
      for (let i = 0; i < 256; i++)
        if (Math.abs(out[i]) > 1e-9) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- denormal flush ------------------------------------------------
  {
    name: 'denormal flush: tiny out snapped to 0',
    run() {
      const op = freshOp({ time: 1, feedback: 0 });
      // Write a single denormal-sized impulse, verify it doesn't linger.
      op._line[0] = 1e-35;
      const { out } = render(op, 256, { inFill: 0 });
      for (let i = 0; i < 256; i++)
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- defensive -----------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ time: 1, feedback: 0.5 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'time > max clamps to 2000 ms (no OOB)',
    run() {
      const op = freshOp({ time: 10000, feedback: 0 });
      const { out } = render(op, 512, { inFill: 1 });
      for (let i = 0; i < out.length; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'time < 1 clamps to 1 ms (no sample-stalling)',
    run() {
      const op = freshOp({ time: 0, feedback: 0 });
      const { out } = render(op, 256, { inFill: i => i === 0 ? 1 : 0 });
      // Should behave like time=1 → peak near 48.
      if (!approx(out[48], 1, 1e-3)) return { pass: false, why: `out[48]=${out[48]}` };
      return { pass: true };
    },
  },

  // ---- feedback loop (via external wire) ----------------------------
  {
    name: 'feedback via external FB wire decays correctly (feedback=0.5)',
    run() {
      // Simulate external wire by feeding previous out into fb each call.
      const op = freshOp({ time: 1, feedback: 0.5 });
      const N = 512;
      const inBuf = new Float32Array(N);
      inBuf[0] = 1;
      const fbBuf = new Float32Array(N);
      const out   = new Float32Array(N);
      // Call one-sample-at-a-time so fb[i] reflects previous out.
      for (let i = 0; i < N; i++) {
        const inS = new Float32Array(1); inS[0] = inBuf[i];
        const fbS = new Float32Array(1); fbS[0] = i === 0 ? 0 : out[i - 1];
        const oS  = new Float32Array(1);
        op.process({ in: inS, fb: fbS }, { out: oS }, 1);
        out[i] = oS[0];
        fbBuf[i] = fbS[0];
      }
      // Expect three decaying peaks spaced ≈48 apart, each ×0.5 of previous.
      // There is a 1-sample wiring lag (fb[i] = out[i-1]), so peaks land
      // near 48, 97, 146 rather than exactly 48/96/144.
      const peakIn = (lo, hi) => {
        let m = 0, at = -1;
        for (let i = lo; i <= hi; i++) if (Math.abs(out[i]) > m) { m = Math.abs(out[i]); at = i; }
        return { m, at };
      };
      const p1 = peakIn(40, 60);
      const p2 = peakIn(85, 115);
      const p3 = peakIn(135, 165);
      if (!approx(p1.m, 1.0,  2e-2)) return { pass: false, why: `peak1=${p1.m}@${p1.at}` };
      if (!approx(p2.m, 0.5,  3e-2)) return { pass: false, why: `peak2=${p2.m}@${p2.at}` };
      if (!approx(p3.m, 0.25, 3e-2)) return { pass: false, why: `peak3=${p3.m}@${p3.at}` };
      return { pass: true };
    },
  },

  // ---- determinism ---------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = render(freshOp({ time: 5, feedback: 0 }), 1024, {
        inFill: i => Math.sin(2 * Math.PI * 100 * i / SR),
      }).out;
      const b = render(freshOp({ time: 5, feedback: 0 }), 1024, {
        inFill: i => Math.sin(2 * Math.PI * 100 * i / SR),
      }).out;
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'delay', tests };
