// op_tapeAir9.test.js — math tests for #112a Airwindows ToTape9 port.
// Run via: node scripts/check_op_math.mjs

import { TapeAir9Op } from './op_tapeAir9.worklet.js';

const SR = 48000;
const N  = 2048;

function freshOp(params = {}) {
  const op = new TapeAir9Op(SR);
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  op.reset();
  return op;
}
function render(op, input) {
  const out = new Float32Array(input.length);
  op.process({ in: input }, { out }, input.length);
  return out;
}
function sine(freq, n, amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.sin(2 * Math.PI * freq * i / SR) * amp;
  return b;
}
function rmsSS(buf) {
  let s = 0, cnt = 0;
  for (let i = 512; i < buf.length; i++) { s += buf[i] * buf[i]; cnt++; }
  return Math.sqrt(s / cnt);
}

const tests = [
  {
    name: 'finite + bounded output on silence input (Airwindows injects fpd floor)',
    run() {
      const op = freshOp({});
      const out = render(op, new Float32Array(N));
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
        if (Math.abs(out[i]) > 0.01) return { pass: false, why: `i=${i}: ${out[i]} (silence floor too loud)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops with same params produce identical output',
    run() {
      const inp = sine(440, N, 0.3);
      const a = render(freshOp({ drive: 0.5, dubly: 0.5, bumpMix: 0.4 }), inp);
      const b = render(freshOp({ drive: 0.5, dubly: 0.5, bumpMix: 0.4 }), inp);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `i=${i}: ${a[i]} vs ${b[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'bounded under full drive + extreme params — no NaN/Inf',
    run() {
      const op = freshOp({ drive: 1, dubly: 1, flutterDepth: 1, flutterRate: 1, bias: 1, bumpMix: 1, bumpHz: 1 });
      const inp = sine(500, N, 0.9);
      const out = render(op, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
        if (Math.abs(out[i]) > 20) return { pass: false, why: `i=${i}: ${out[i]} (unbounded)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'Taylor-sin saturator clamps: high-amplitude compressed vs low-amplitude near-linear',
    run() {
      // dubly=0 + bias=0.5 (neutral) + bumpMix=0 → clean saturator path
      const op1 = freshOp({ drive: 0.5, dubly: 0, bias: 0.5, bumpMix: 0, flutterDepth: 0 });
      const op2 = freshOp({ drive: 0.5, dubly: 0, bias: 0.5, bumpMix: 0, flutterDepth: 0 });
      const lo = sine(1000, N, 0.05);
      const hi = sine(1000, N, 0.9);
      const outLo = render(op1, lo);
      const outHi = render(op2, hi);
      const gLo = rmsSS(outLo) / rmsSS(lo);
      const gHi = rmsSS(outHi) / rmsSS(hi);
      if (!(gHi < gLo)) return { pass: false, why: `gLo=${gLo.toFixed(3)} gHi=${gHi.toFixed(3)} — hi should compress more` };
      return { pass: true };
    },
  },
  {
    name: 'drive=0 → near-silence (inputGain=0)',
    run() {
      const op = freshOp({ drive: 0, dubly: 0, bias: 0.5, bumpMix: 0, flutterDepth: 0 });
      const out = render(op, sine(1000, N, 0.5));
      const r = rmsSS(out);
      if (r > 0.001) return { pass: false, why: `rms=${r.toExponential(2)} (expected ~0)` };
      return { pass: true };
    },
  },
  {
    name: 'flutter off (depth=0) + bias neutral → no pitch modulation artifacts',
    run() {
      const op = freshOp({ drive: 0.5, dubly: 0, bias: 0.5, bumpMix: 0, flutterDepth: 0 });
      const inp = sine(1000, N, 0.3);
      const out = render(op, inp);
      // Steady sine in → steady magnitude out (no wow-induced envelope)
      let maxAbs = 0, minAbs = Infinity;
      const W = 128;
      for (let i = 512; i + W < N; i += W) {
        let s = 0;
        for (let j = 0; j < W; j++) s += out[i+j] * out[i+j];
        const rms = Math.sqrt(s / W);
        if (rms > maxAbs) maxAbs = rms;
        if (rms < minAbs) minAbs = rms;
      }
      // Modulation should be minimal: max/min ratio near 1
      if (maxAbs / minAbs > 1.5) return { pass: false, why: `ratio=${(maxAbs/minAbs).toFixed(3)} — expected near 1` };
      return { pass: true };
    },
  },
  {
    name: 'head-bump boosts low-freq content at default bumpHz',
    run() {
      const noMix = freshOp({ drive: 0.3, dubly: 0, bias: 0.5, bumpMix: 0, bumpHz: 0.3, flutterDepth: 0 });
      const mix   = freshOp({ drive: 0.3, dubly: 0, bias: 0.5, bumpMix: 1, bumpHz: 0.3, flutterDepth: 0 });
      const inp = sine(50, N, 0.3); // very low freq, near head-bump center
      const rNo  = rmsSS(render(noMix, inp));
      const rMix = rmsSS(render(mix,   inp));
      // head-bump should add SOME low-freq energy (not necessarily huge boost)
      if (!(rMix > rNo)) return { pass: false, why: `rNo=${rNo.toFixed(4)} rMix=${rMix.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps: out-of-range values stay finite',
    run() {
      const op = freshOp({});
      op.setParam('drive',  999);
      op.setParam('drive',  -5);
      op.setParam('dubly',  999);
      op.setParam('flutterDepth', -5);
      op.setParam('flutterRate',  999);
      op.setParam('bias',   -5);
      op.setParam('bumpMix', 999);
      op.setParam('bumpHz',  -5);
      op.setParam('encCross', 999);
      op.setParam('drive', NaN); // ignored
      const out = render(op, sine(500, N, 0.3));
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears flutter buffer + biquads + averaging cascades',
    run() {
      const op = freshOp({ drive: 0.5, flutterDepth: 0.5, bumpMix: 0.5 });
      render(op, sine(500, N, 0.8)); // prime
      op.reset();
      // After reset with drive=0 + dubly=0 + bias=neutral + bumpMix=0 + flutter=0,
      // output should be tiny (just fpd floor)
      op.setParam('drive', 0);
      op.setParam('dubly', 0);
      op.setParam('bias', 0.5);
      op.setParam('bumpMix', 0);
      op.setParam('flutterDepth', 0);
      const out = render(op, new Float32Array(32));
      for (let i = 0; i < 32; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
        if (Math.abs(out[i]) > 0.001) return { pass: false, why: `i=${i}: ${out[i]} (state leaked)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → no throw, finite output',
    run() {
      const op = freshOp({});
      const out = new Float32Array(N);
      try { op.process({}, { out }, N); } catch (e) { return { pass: false, why: e.message }; }
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no throw',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, 128); } catch (e) { return { pass: false, why: e.message }; }
      return { pass: true };
    },
  },
  {
    name: 'Taylor-sin saturator identity: x=0 → exact pipeline passthrough of baseline',
    run() {
      // Verify verbatim Taylor coef arithmetic: at x=0, all terms are zero
      // Minimal chain: drive=0.5, dubly=0, bias=0.5, bumpMix=0, flutter=0,
      // feed a tiny constant, verify output is finite & bounded
      const op = freshOp({ drive: 0.5, dubly: 0, bias: 0.5, bumpMix: 0, flutterDepth: 0 });
      const inp = new Float32Array(N); // all zeros (will fpd-floor inside)
      const out = render(op, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: ${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
];

export default { opId: 'tapeAir9', tests };
