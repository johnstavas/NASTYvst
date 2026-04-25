// op_lrXover.test.js — real-math tests for op_lrXover.
// Primaries: linkwitzlab.com (LR4 = cascaded Butterworth, Q=1/√2) + RBJ Cookbook.

import { LrXoverOp } from './op_lrXover.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new LrXoverOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, signalFn, nSamples) {
  const CHUNK = 256;
  const outL = new Float32Array(nSamples);
  const outH = new Float32Array(nSamples);
  let pos = 0;
  while (pos < nSamples) {
    const c = Math.min(CHUNK, nSamples - pos);
    const inp = new Float32Array(c);
    for (let i = 0; i < c; i++) inp[i] = signalFn(pos + i);
    const bL = new Float32Array(c);
    const bH = new Float32Array(c);
    op.process({ in: inp }, { low: bL, high: bH }, c);
    outL.set(bL, pos); outH.set(bH, pos);
    pos += c;
  }
  return { outL, outH };
}

function rms(arr, start, end) {
  let s = 0;
  for (let i = start; i < end; i++) s += arr[i] * arr[i];
  return Math.sqrt(s / (end - start));
}

function sine(freqHz, amp = 0.5) {
  return (n) => amp * Math.sin(2 * Math.PI * freqHz * n / SR);
}

const INPUT_RMS = 0.5 / Math.SQRT2;  // 0.3536 for amp=0.5 sine

const tests = [
  {
    name: 'low leg passes DC / sub-crossover content',
    run() {
      const op = freshOp({ f0: 1000 });
      const { outL, outH } = drive(op, sine(100), 4096);
      const rL = rms(outL, 2000, 4096);
      const rH = rms(outH, 2000, 4096);
      if (rL < INPUT_RMS * 0.9) return { pass: false, why: `low leg attenuates lows: rL=${rL}` };
      if (rH > 0.02)              return { pass: false, why: `high leg leaks lows: rH=${rH}` };
      return { pass: true };
    },
  },
  {
    name: 'high leg passes super-crossover content',
    run() {
      const op = freshOp({ f0: 1000 });
      const { outL, outH } = drive(op, sine(10000), 4096);
      const rL = rms(outL, 2000, 4096);
      const rH = rms(outH, 2000, 4096);
      if (rH < INPUT_RMS * 0.9) return { pass: false, why: `high leg attenuates highs: rH=${rH}` };
      if (rL > 0.02)              return { pass: false, why: `low leg leaks highs: rL=${rL}` };
      return { pass: true };
    },
  },
  {
    name: 'at crossover frequency Fp, each leg is −6 dB (≈0.5 amplitude)',
    run() {
      // Linkwitz: "At the transition frequency Fp the response is 6 dB down."
      // −6 dB in amplitude = 0.5011872…, so RMS should be ≈ INPUT_RMS · 0.5.
      const op = freshOp({ f0: 1000 });
      const { outL, outH } = drive(op, sine(1000), 8192);
      const rL = rms(outL, 4000, 8192);
      const rH = rms(outH, 4000, 8192);
      const expected = INPUT_RMS * 0.5;
      if (Math.abs(rL - expected) > 0.015) return { pass: false, why: `low leg @ Fp: got ${rL}, exp ${expected}` };
      if (Math.abs(rH - expected) > 0.015) return { pass: false, why: `high leg @ Fp: got ${rH}, exp ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'LP + HP sums to magnitude-flat at crossover',
    run() {
      // Linkwitz: "360° phase offset at all frequencies". Both legs in-phase
      // after full 720° (or 360° total) sum → Magnitude flat. Test at Fp.
      const op = freshOp({ f0: 1000 });
      const { outL, outH } = drive(op, sine(1000), 8192);
      // sum samples index-by-index, compute RMS
      let s = 0;
      for (let i = 4000; i < 8192; i++) {
        const v = outL[i] + outH[i];
        s += v * v;
      }
      const rSum = Math.sqrt(s / (8192 - 4000));
      if (Math.abs(rSum - INPUT_RMS) > 0.02) return { pass: false, why: `sum RMS ${rSum} != input ${INPUT_RMS}` };
      return { pass: true };
    },
  },
  {
    name: 'LP + HP sum is magnitude-flat at passband frequencies too',
    run() {
      const op1 = freshOp({ f0: 1000 });
      const r1 = drive(op1, sine(200), 8192);
      let s1 = 0;
      for (let i = 4000; i < 8192; i++) { const v = r1.outL[i] + r1.outH[i]; s1 += v*v; }
      const sum1 = Math.sqrt(s1 / (8192 - 4000));
      if (Math.abs(sum1 - INPUT_RMS) > 0.02) return { pass: false, why: `200Hz sum ${sum1} != ${INPUT_RMS}` };

      const op2 = freshOp({ f0: 1000 });
      const r2 = drive(op2, sine(8000), 8192);
      let s2 = 0;
      for (let i = 4000; i < 8192; i++) { const v = r2.outL[i] + r2.outH[i]; s2 += v*v; }
      const sum2 = Math.sqrt(s2 / (8192 - 4000));
      if (Math.abs(sum2 - INPUT_RMS) > 0.02) return { pass: false, why: `8kHz sum ${sum2} != ${INPUT_RMS}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent outputs',
    run() {
      const op = freshOp({ f0: 500 });
      const { outL, outH } = drive(op, () => 0, 2048);
      for (let i = 0; i < 2048; i++) {
        if (outL[i] !== 0 || outH[i] !== 0) return { pass: false, why: `non-zero at ${i}: L=${outL[i]} H=${outH[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same outputs',
    run() {
      const a = drive(freshOp({ f0: 800 }), sine(1500), 4096);
      const b = drive(freshOp({ f0: 800 }), sine(1500), 4096);
      for (let i = 0; i < a.outL.length; i++) {
        if (a.outL[i] !== b.outL[i]) return { pass: false, why: `L diverge at ${i}` };
        if (a.outH[i] !== b.outH[i]) return { pass: false, why: `H diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'reset clears all 4 biquad states',
    run() {
      const op = freshOp({ f0: 1000 });
      drive(op, sine(1000), 4096);
      op.reset();
      const keys = ['_lx1','_lx2','_ly1','_ly2','_Lx1','_Lx2','_Ly1','_Ly2',
                    '_hx1','_hx2','_hy1','_hy2','_Hx1','_Hx2','_Hy1','_Hy2'];
      for (const k of keys) if (op[k] !== 0) return { pass: false, why: `${k}=${op[k]}` };
      return { pass: true };
    },
  },
  {
    name: 'param clamps — f0 ∈ [1, sr·0.49], NaN ignored',
    run() {
      const op = freshOp();
      op.setParam('f0', -1);    if (op._f0 !== 1) return { pass: false, why: `f0 min ${op._f0}` };
      op.setParam('f0', 1e9);   if (op._f0 !== SR*0.49) return { pass: false, why: `f0 max ${op._f0}` };
      op.setParam('f0', NaN);   if (op._f0 !== SR*0.49) return { pass: false, why: `NaN ignored` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent outputs, no NaN',
    run() {
      const op = freshOp({ f0: 500 });
      const outL = new Float32Array(512);
      const outH = new Float32Array(512);
      op.process({}, { low: outL, high: outH }, 512);
      for (let i = 0; i < 512; i++) {
        if (!Number.isFinite(outL[i]) || outL[i] !== 0) return { pass: false, why: `outL[${i}]=${outL[i]}` };
        if (!Number.isFinite(outH[i]) || outH[i] !== 0) return { pass: false, why: `outH[${i}]=${outH[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no-op (no crash)',
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
  {
    name: 'stability on loud noise — no runaway',
    run() {
      const op = freshOp({ f0: 1000 });
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const { outL, outH } = drive(op, () => rng() * 0.9, 8192);
      for (let i = 0; i < outL.length; i++) {
        if (!Number.isFinite(outL[i]) || Math.abs(outL[i]) > 10) return { pass: false, why: `outL runaway at ${i}=${outL[i]}` };
        if (!Number.isFinite(outH[i]) || Math.abs(outH[i]) > 10) return { pass: false, why: `outH runaway at ${i}=${outH[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'lrXover', tests };
