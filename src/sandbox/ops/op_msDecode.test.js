// op_msDecode.test.js — real-math tests for op_msDecode.
// Primary: Blumlein 1933 matrix L=M+S, R=M-S. Precedent: WidthModule in
// src/core/dspWorklet.js:1040–1047.

import { MsDecodeOp } from './op_msDecode.worklet.js';

const SR = 48000;

function freshOp() {
  const op = new MsDecodeOp(SR);
  op.reset();
  return op;
}

function run(inputs, nSamples) {
  const op = freshOp();
  const outL = new Float32Array(nSamples);
  const outR = new Float32Array(nSamples);
  op.process(inputs, { left: outL, right: outR }, nSamples);
  return { outL, outR };
}

const tests = [
  {
    name: 'L = M + S, R = M - S — impulse M',
    run() {
      const m = new Float32Array(8); m[0] = 1;
      const s = new Float32Array(8);
      const { outL, outR } = run({ mid: m, side: s }, 8);
      if (outL[0] !== 1 || outR[0] !== 1) return { pass: false, why: `L=${outL[0]} R=${outR[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'L = M + S, R = M - S — impulse S',
    run() {
      const m = new Float32Array(8);
      const s = new Float32Array(8); s[0] = 1;
      const { outL, outR } = run({ mid: m, side: s }, 8);
      if (outL[0] !== 1 || outR[0] !== -1) return { pass: false, why: `L=${outL[0]} R=${outR[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'encode → decode round-trip is identity',
    run() {
      // Given arbitrary L,R, encode to M=(L+R)/2, S=(L-R)/2, decode back.
      const N = 256;
      const origL = new Float32Array(N);
      const origR = new Float32Array(N);
      const mid   = new Float32Array(N);
      const side  = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        origL[i] = Math.sin(2 * Math.PI * i * 3 / N);
        origR[i] = Math.cos(2 * Math.PI * i * 5 / N) * 0.7;
        mid[i]  = (origL[i] + origR[i]) * 0.5;
        side[i] = (origL[i] - origR[i]) * 0.5;
      }
      const { outL, outR } = run({ mid, side }, N);
      for (let i = 0; i < N; i++) {
        if (Math.abs(outL[i] - origL[i]) > 1e-6) return { pass: false, why: `L[${i}] ${outL[i]} vs ${origL[i]}` };
        if (Math.abs(outR[i] - origR[i]) > 1e-6) return { pass: false, why: `R[${i}] ${outR[i]} vs ${origR[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'mono source (side=0) → L = R = M',
    run() {
      const N = 64;
      const m = new Float32Array(N);
      const s = new Float32Array(N);
      for (let i = 0; i < N; i++) m[i] = Math.sin(2 * Math.PI * i / N) * 0.5;
      const { outL, outR } = run({ mid: m, side: s }, N);
      for (let i = 0; i < N; i++) {
        if (outL[i] !== m[i]) return { pass: false, why: `L[${i}] ${outL[i]} vs ${m[i]}` };
        if (outR[i] !== m[i]) return { pass: false, why: `R[${i}] ${outR[i]} vs ${m[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'pure side (mid=0) → L = -R',
    run() {
      const N = 64;
      const m = new Float32Array(N);
      const s = new Float32Array(N);
      for (let i = 0; i < N; i++) s[i] = Math.sin(2 * Math.PI * i / N) * 0.5;
      const { outL, outR } = run({ mid: m, side: s }, N);
      for (let i = 0; i < N; i++) {
        if (outL[i] !== s[i])  return { pass: false, why: `L[${i}] ${outL[i]} vs ${s[i]}` };
        if (outR[i] !== -s[i]) return { pass: false, why: `R[${i}] ${outR[i]} vs ${-s[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing mid → L = S, R = -S',
    run() {
      const N = 32;
      const s = new Float32Array(N); for (let i = 0; i < N; i++) s[i] = 0.3;
      const { outL, outR } = run({ side: s }, N);
      for (let i = 0; i < N; i++) {
        if (outL[i] !== s[i])  return { pass: false, why: `L[${i}]=${outL[i]} vs ${s[i]}` };
        if (outR[i] !== -s[i]) return { pass: false, why: `R[${i}]=${outR[i]} vs ${-s[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing side → L = R = M',
    run() {
      const N = 32;
      const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = 0.4;
      const { outL, outR } = run({ mid: m }, N);
      for (let i = 0; i < N; i++) {
        if (outL[i] !== m[i]) return { pass: false, why: `L[${i}]=${outL[i]} vs ${m[i]}` };
        if (outR[i] !== m[i]) return { pass: false, why: `R[${i}]=${outR[i]} vs ${m[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing both → silent + finite',
    run() {
      const { outL, outR } = run({}, 64);
      for (let i = 0; i < 64; i++) {
        if (outL[i] !== 0 || outR[i] !== 0) return { pass: false, why: `[${i}] L=${outL[i]} R=${outR[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no crash',
    run() {
      const op = freshOp();
      op.process({ mid: new Float32Array(8), side: new Float32Array(8) }, {}, 8);
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same outputs',
    run() {
      const m = new Float32Array(128); for (let i = 0; i < 128; i++) m[i] = Math.sin(i * 0.1);
      const s = new Float32Array(128); for (let i = 0; i < 128; i++) s[i] = Math.cos(i * 0.17);
      const a = run({ mid: m, side: s }, 128);
      const b = run({ mid: m, side: s }, 128);
      for (let i = 0; i < 128; i++) {
        if (a.outL[i] !== b.outL[i]) return { pass: false, why: `L diverge at ${i}` };
        if (a.outR[i] !== b.outR[i]) return { pass: false, why: `R diverge at ${i}` };
      }
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
    name: 'stateless — reset is a no-op on outputs',
    run() {
      const op = freshOp();
      const m = new Float32Array(8); m[0] = 0.5;
      const s = new Float32Array(8); s[0] = 0.2;
      const outL1 = new Float32Array(8);
      const outR1 = new Float32Array(8);
      op.process({ mid: m, side: s }, { left: outL1, right: outR1 }, 8);
      op.reset();
      const outL2 = new Float32Array(8);
      const outR2 = new Float32Array(8);
      op.process({ mid: m, side: s }, { left: outL2, right: outR2 }, 8);
      for (let i = 0; i < 8; i++) {
        if (outL1[i] !== outL2[i]) return { pass: false, why: `L[${i}] ${outL1[i]} vs ${outL2[i]}` };
        if (outR1[i] !== outR2[i]) return { pass: false, why: `R[${i}] ${outR1[i]} vs ${outR2[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'loud noise → no NaN / no runaway',
    run() {
      const N = 2048;
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = rng() * 2;
      const s = new Float32Array(N); for (let i = 0; i < N; i++) s[i] = rng() * 2;
      const { outL, outR } = run({ mid: m, side: s }, N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outL[i]) || Math.abs(outL[i]) > 5) return { pass: false, why: `L[${i}]=${outL[i]}` };
        if (!Number.isFinite(outR[i]) || Math.abs(outR[i]) > 5) return { pass: false, why: `R[${i}]=${outR[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'msDecode', tests };
