// op_bbdDelay.test.js — math tests for #27 bbdDelay.
// Primary: Holters & Parker 2018 DAFx — v1 pragmatic reduction (topology only).

import { BbdDelayOp } from './op_bbdDelay.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new BbdDelayOp(SR);
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

function rms(buf, from = 0, to = buf.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (to - from));
}

const tests = [
  {
    name: 'impulse produces delayed echo near delayMs',
    run() {
      // delayMs=10 → 480 samples; expect energy near index 480
      const op = freshOp({ delayMs: 10, aaHz: 10000, feedback: 0, mix: 1 });
      const out = drive(op, (n) => n === 0 ? 1 : 0, 2000);
      // early region should be near-zero (post-filter has group delay, but
      // mix=1 means we only hear wet; wet path passes input through pre-LPF,
      // FIFO, post-LPF — so the initial pre-filter impulse is buried in the
      // delay line, not output. Output is post-filter of delayed BBD tap.
      // Peak should be within +-20 samples of 480.
      let peakIdx = 0, peakVal = 0;
      for (let i = 100; i < 1000; i++) {
        if (Math.abs(out[i]) > peakVal) { peakVal = Math.abs(out[i]); peakIdx = i; }
      }
      if (peakVal < 0.01) return { pass: false, why: `no echo, peak=${peakVal}` };
      if (Math.abs(peakIdx - 480) > 30) return { pass: false, why: `peak at ${peakIdx}, expected near 480` };
      return { pass: true };
    },
  },
  {
    name: 'HF attenuation: 15 kHz input suppressed relative to 500 Hz',
    run() {
      // aaHz=6000 → 15 kHz should be attenuated by the cascaded pre+post LPF.
      const opHi = freshOp({ delayMs: 5, aaHz: 6000, feedback: 0, mix: 1 });
      const opLo = freshOp({ delayMs: 5, aaHz: 6000, feedback: 0, mix: 1 });
      const hi = drive(opHi, (n) => Math.sin(2*Math.PI*15000*n/SR), 4000);
      const lo = drive(opLo, (n) => Math.sin(2*Math.PI*500 *n/SR), 4000);
      const rHi = rms(hi, 1000, 4000);
      const rLo = rms(lo, 1000, 4000);
      if (rHi >= rLo * 0.5) return { pass: false, why: `HF rms ${rHi} not << LF rms ${rLo}` };
      return { pass: true };
    },
  },
  {
    name: 'feedback: repeats decay, no runaway at max',
    run() {
      const op = freshOp({ delayMs: 20, aaHz: 8000, feedback: 10, mix: 1 }); // user sets huge fb
      // clamped to 0.95 internally
      const out = drive(op, (n) => n === 0 ? 1 : 0, SR);
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 50)    return { pass: false, why: `runaway ${out[i]} at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ delayMs: 15, aaHz: 6000, feedback: 0.5, mix: 1 });
      const out = drive(op, () => 0, 3000);
      for (let i = 0; i < 3000; i++) {
        if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → pure dry passthrough',
    run() {
      const op = freshOp({ delayMs: 20, aaHz: 6000, feedback: 0.5, mix: 0 });
      const sig = (n) => Math.sin(2*Math.PI*1000*n/SR);
      const out = drive(op, sig, 2000);
      for (let i = 0; i < 2000; i++) {
        const expected = sig(i);
        if (Math.abs(out[i] - expected) > 1e-5) return { pass: false, why: `dry diverge at ${i}: ${out[i]} vs ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const sig = (n) => Math.sin(n * 0.03) + 0.3 * Math.sin(n * 0.17);
      const a = drive(freshOp({ delayMs: 12, aaHz: 5000, feedback: 0.4, mix: 0.6 }), sig, 4000);
      const b = drive(freshOp({ delayMs: 12, aaHz: 5000, feedback: 0.4, mix: 0.6 }), sig, 4000);
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears all state',
    run() {
      const op = freshOp({ delayMs: 15, aaHz: 6000, feedback: 0.7, mix: 1 });
      drive(op, (n) => n === 0 ? 1 : 0, 3000);
      op.reset();
      const out = drive(op, () => 0, 3000);
      for (let i = 0; i < 3000; i++) {
        if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'delayMs clamps below 1 sample and to buffer limit',
    run() {
      const op = freshOp();
      op.setParam('delayMs', 0.000001);
      if (op._delay !== 1) return { pass: false, why: `min delay got ${op._delay}` };
      op.setParam('delayMs', 99999);
      if (op._delay >= op._bufLen) return { pass: false, why: `delay ${op._delay} >= bufLen ${op._bufLen}` };
      return { pass: true };
    },
  },
  {
    name: 'feedback param clamped to |fb| <= 0.95',
    run() {
      const op = freshOp();
      op.setParam('feedback', 5);
      if (op._fb !== 0.95) return { pass: false, why: `pos clamp got ${op._fb}` };
      op.setParam('feedback', -5);
      if (op._fb !== -0.95) return { pass: false, why: `neg clamp got ${op._fb}` };
      return { pass: true };
    },
  },
  {
    name: 'long-run stability with feedback — bounded output',
    run() {
      const op = freshOp({ delayMs: 40, aaHz: 6000, feedback: 0.8, mix: 1 });
      const out = drive(op, (n) => 0.5 * Math.sin(2*Math.PI*400*n/SR), SR * 3);
      let maxAbs = 0;
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > maxAbs) maxAbs = Math.abs(out[i]);
      }
      if (maxAbs > 20) return { pass: false, why: `unbounded, maxAbs=${maxAbs}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output, no NaN',
    run() {
      const op = freshOp({ mix: 1 });
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

export default { opId: 'bbdDelay', tests };
