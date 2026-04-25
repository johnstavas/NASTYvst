// op_comb.test.js — real-math tests for op_comb.
// Primary: Julius O. Smith III, PASP (Feedforward/Feedback Comb Filters).

import { CombOp } from './op_comb.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new CombOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, signalFn, nSamples) {
  const CHUNK = 256;
  const out = new Float32Array(nSamples);
  let pos = 0;
  while (pos < nSamples) {
    const c = Math.min(CHUNK, nSamples - pos);
    const inp = new Float32Array(c);
    for (let i = 0; i < c; i++) inp[i] = signalFn(pos + i);
    const bOut = new Float32Array(c);
    op.process({ in: inp }, { out: bOut }, c);
    out.set(bOut, pos);
    pos += c;
  }
  return out;
}

const tests = [
  {
    name: 'FF mode: impulse → x(n) + g·x(n-M) at n=0 and n=M',
    run() {
      const op = freshOp({ mode: 0, delayMs: 10, g: 0.5 });
      // delay = round(0.01 * 48000) = 480
      const out = drive(op, (n) => n === 0 ? 1 : 0, 2000);
      if (Math.abs(out[0] - 1) > 1e-9) return { pass: false, why: `out[0]=${out[0]}` };
      if (Math.abs(out[480] - 0.5) > 1e-9) return { pass: false, why: `out[480]=${out[480]}` };
      for (let i = 1; i < 480; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      for (let i = 481; i < 2000; i++) if (out[i] !== 0) return { pass: false, why: `tail out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'FB mode: impulse → 1, g, g², g³... at n=0, M, 2M, 3M',
    run() {
      const op = freshOp({ mode: 1, delayMs: 10, g: 0.5 });
      const out = drive(op, (n) => n === 0 ? 1 : 0, 2500);
      const taps = [0, 480, 960, 1440, 1920];
      const expected = [1, 0.5, 0.25, 0.125, 0.0625];
      for (let k = 0; k < taps.length; k++) {
        const got = out[taps[k]];
        if (Math.abs(got - expected[k]) > 1e-6) return { pass: false, why: `tap ${k} @ ${taps[k]}: got ${got} exp ${expected[k]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'FB stability: g clamped below 1.0, no runaway',
    run() {
      const op = freshOp({ mode: 1, delayMs: 5, g: 10 }); // user sets insane g
      const out = drive(op, (n) => n === 0 ? 1 : 0, 48000);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 100)   return { pass: false, why: `runaway at ${i}=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'FF g=0 → passthrough',
    run() {
      const op = freshOp({ mode: 0, delayMs: 5, g: 0 });
      const sig = (n) => Math.sin(2 * Math.PI * 440 * n / SR);
      const out = drive(op, sig, 2000);
      for (let i = 0; i < 2000; i++) {
        const expected = sig(i);
        if (Math.abs(out[i] - expected) > 1e-6) return { pass: false, why: `passthrough diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output both modes',
    run() {
      for (const mode of [0, 1]) {
        const op = freshOp({ mode, delayMs: 5, g: 0.7 });
        const out = drive(op, () => 0, 1000);
        for (let i = 0; i < 1000; i++) {
          if (out[i] !== 0) return { pass: false, why: `mode=${mode} out[${i}]=${out[i]}` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const sig = (n) => Math.sin(n * 0.05);
      const a = drive(freshOp({ mode: 1, delayMs: 7, g: 0.6 }), sig, 4000);
      const b = drive(freshOp({ mode: 1, delayMs: 7, g: 0.6 }), sig, 4000);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears delay line',
    run() {
      const op = freshOp({ mode: 1, delayMs: 5, g: 0.8 });
      drive(op, (n) => n === 0 ? 1 : 0, 3000);
      op.reset();
      const out = drive(op, () => 0, 2000);
      for (let i = 0; i < 2000; i++) {
        if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'delayMs param clamps below 1 sample and to buffer limit',
    run() {
      const op = freshOp({ maxDelayMs: 100 });
      op.setParam('delayMs', 0.000001); // → 0 samples → clamp to 1
      if (op._delay !== 1) return { pass: false, why: `min delay got ${op._delay}` };
      op.setParam('delayMs', 99999);     // way past buffer
      if (op._delay >= op._bufLen) return { pass: false, why: `delay ${op._delay} >= bufLen ${op._bufLen}` };
      return { pass: true };
    },
  },
  {
    name: 'mode switch changes behavior',
    run() {
      const sig = (n) => n === 0 ? 1 : 0;
      const ff = drive(freshOp({ mode: 0, delayMs: 5, g: 0.5 }), sig, 5000);
      const fb = drive(freshOp({ mode: 1, delayMs: 5, g: 0.5 }), sig, 5000);
      // FF: exactly 2 non-zero samples (0 and M). FB: geometric decay.
      let ffNonZero = 0, fbNonZero = 0;
      for (let i = 0; i < 5000; i++) {
        if (ff[i] !== 0) ffNonZero++;
        if (Math.abs(fb[i]) > 1e-10) fbNonZero++;
      }
      if (ffNonZero !== 2) return { pass: false, why: `FF non-zero count ${ffNonZero} != 2` };
      if (fbNonZero < 10)  return { pass: false, why: `FB non-zero count ${fbNonZero} too low` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output, no NaN',
    run() {
      const op = freshOp({ mode: 1, g: 0.5 });
      const out = new Float32Array(512);
      op.process({}, { out }, 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(out[i]) || out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op',
    run() {
      const op = freshOp();
      op.process({ in: new Float32Array(256) }, {}, 256);
      return { pass: true };
    },
  },
  {
    name: 'latency = 0',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `latency=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
];

export default { opId: 'comb', tests };
