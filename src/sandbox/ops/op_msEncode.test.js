// op_msEncode.test.js — real-math tests for op_msEncode.
// Primary: Blumlein 1933 matrix M=(L+R)/2, S=(L-R)/2. Precedent:
// src/core/dspWorklet.js:1043–1044.

import { MsEncodeOp } from './op_msEncode.worklet.js';
import { MsDecodeOp } from './op_msDecode.worklet.js';

const SR = 48000;

function freshOp() {
  const op = new MsEncodeOp(SR);
  op.reset();
  return op;
}

function run(inputs, nSamples) {
  const op = freshOp();
  const outM = new Float32Array(nSamples);
  const outS = new Float32Array(nSamples);
  op.process(inputs, { mid: outM, side: outS }, nSamples);
  return { outM, outS };
}

const tests = [
  {
    name: 'M = (L+R)/2, S = (L-R)/2 — impulse L',
    run() {
      const l = new Float32Array(8); l[0] = 1;
      const r = new Float32Array(8);
      const { outM, outS } = run({ left: l, right: r }, 8);
      if (outM[0] !== 0.5 || outS[0] !== 0.5) return { pass: false, why: `M=${outM[0]} S=${outS[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'M = (L+R)/2, S = (L-R)/2 — impulse R',
    run() {
      const l = new Float32Array(8);
      const r = new Float32Array(8); r[0] = 1;
      const { outM, outS } = run({ left: l, right: r }, 8);
      if (outM[0] !== 0.5 || outS[0] !== -0.5) return { pass: false, why: `M=${outM[0]} S=${outS[0]}` };
      return { pass: true };
    },
  },
  {
    name: 'encode → decode round-trip is identity (cross-op)',
    run() {
      // Critical contract: msEncode + msDecode must compose to identity.
      const N = 256;
      const origL = new Float32Array(N);
      const origR = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        origL[i] = Math.sin(2 * Math.PI * i * 3 / N);
        origR[i] = Math.cos(2 * Math.PI * i * 5 / N) * 0.7;
      }
      // encode
      const enc = new MsEncodeOp(SR); enc.reset();
      const mid  = new Float32Array(N);
      const side = new Float32Array(N);
      enc.process({ left: origL, right: origR }, { mid, side }, N);
      // decode
      const dec = new MsDecodeOp(SR); dec.reset();
      const outL = new Float32Array(N);
      const outR = new Float32Array(N);
      dec.process({ mid, side }, { left: outL, right: outR }, N);
      for (let i = 0; i < N; i++) {
        if (Math.abs(outL[i] - origL[i]) > 1e-6) return { pass: false, why: `L[${i}] ${outL[i]} vs ${origL[i]}` };
        if (Math.abs(outR[i] - origR[i]) > 1e-6) return { pass: false, why: `R[${i}] ${outR[i]} vs ${origR[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'mono source (L=R) → side = 0',
    run() {
      const N = 64;
      const l = new Float32Array(N);
      const r = new Float32Array(N);
      for (let i = 0; i < N; i++) { l[i] = Math.sin(i * 0.1) * 0.5; r[i] = l[i]; }
      const { outM, outS } = run({ left: l, right: r }, N);
      for (let i = 0; i < N; i++) {
        if (outM[i] !== l[i]) return { pass: false, why: `M[${i}] ${outM[i]} vs ${l[i]}` };
        if (outS[i] !== 0)    return { pass: false, why: `S[${i}]=${outS[i]} (expected 0 for mono)` };
      }
      return { pass: true };
    },
  },
  {
    name: 'anti-phase (L=-R) → mid = 0',
    run() {
      const N = 64;
      const l = new Float32Array(N);
      const r = new Float32Array(N);
      for (let i = 0; i < N; i++) { l[i] = Math.sin(i * 0.1) * 0.5; r[i] = -l[i]; }
      const { outM, outS } = run({ left: l, right: r }, N);
      for (let i = 0; i < N; i++) {
        if (outM[i] !== 0)    return { pass: false, why: `M[${i}]=${outM[i]} (expected 0 for anti-phase)` };
        if (outS[i] !== l[i]) return { pass: false, why: `S[${i}] ${outS[i]} vs ${l[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing left → M = R/2, S = -R/2',
    run() {
      const N = 32;
      const r = new Float32Array(N); for (let i = 0; i < N; i++) r[i] = 0.6;
      const { outM, outS } = run({ right: r }, N);
      for (let i = 0; i < N; i++) {
        const expM = r[i] * 0.5;
        const expS = -r[i] * 0.5;
        if (outM[i] !== expM) return { pass: false, why: `M[${i}]=${outM[i]} vs ${expM}` };
        if (outS[i] !== expS) return { pass: false, why: `S[${i}]=${outS[i]} vs ${expS}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing right → M = L/2, S = L/2',
    run() {
      const N = 32;
      const l = new Float32Array(N); for (let i = 0; i < N; i++) l[i] = 0.4;
      const { outM, outS } = run({ left: l }, N);
      for (let i = 0; i < N; i++) {
        const exp = l[i] * 0.5;
        if (outM[i] !== exp) return { pass: false, why: `M[${i}]=${outM[i]} vs ${exp}` };
        if (outS[i] !== exp) return { pass: false, why: `S[${i}]=${outS[i]} vs ${exp}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing both → silent + finite',
    run() {
      const { outM, outS } = run({}, 64);
      for (let i = 0; i < 64; i++) {
        if (outM[i] !== 0 || outS[i] !== 0) return { pass: false, why: `[${i}] M=${outM[i]} S=${outS[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing outputs → no crash',
    run() {
      const op = freshOp();
      op.process({ left: new Float32Array(8), right: new Float32Array(8) }, {}, 8);
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same outputs',
    run() {
      const l = new Float32Array(128); for (let i = 0; i < 128; i++) l[i] = Math.sin(i * 0.1);
      const r = new Float32Array(128); for (let i = 0; i < 128; i++) r[i] = Math.cos(i * 0.17);
      const a = run({ left: l, right: r }, 128);
      const b = run({ left: l, right: r }, 128);
      for (let i = 0; i < 128; i++) {
        if (a.outM[i] !== b.outM[i]) return { pass: false, why: `M diverge at ${i}` };
        if (a.outS[i] !== b.outS[i]) return { pass: false, why: `S diverge at ${i}` };
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
      const l = new Float32Array(8); l[0] = 0.5;
      const r = new Float32Array(8); r[0] = 0.2;
      const outM1 = new Float32Array(8);
      const outS1 = new Float32Array(8);
      op.process({ left: l, right: r }, { mid: outM1, side: outS1 }, 8);
      op.reset();
      const outM2 = new Float32Array(8);
      const outS2 = new Float32Array(8);
      op.process({ left: l, right: r }, { mid: outM2, side: outS2 }, 8);
      for (let i = 0; i < 8; i++) {
        if (outM1[i] !== outM2[i]) return { pass: false, why: `M[${i}] ${outM1[i]} vs ${outM2[i]}` };
        if (outS1[i] !== outS2[i]) return { pass: false, why: `S[${i}] ${outS1[i]} vs ${outS2[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'loud noise → no NaN / no runaway',
    run() {
      const N = 2048;
      const rng = (() => { let s = 1; return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5; })();
      const l = new Float32Array(N); for (let i = 0; i < N; i++) l[i] = rng() * 2;
      const r = new Float32Array(N); for (let i = 0; i < N; i++) r[i] = rng() * 2;
      const { outM, outS } = run({ left: l, right: r }, N);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(outM[i]) || Math.abs(outM[i]) > 5) return { pass: false, why: `M[${i}]=${outM[i]}` };
        if (!Number.isFinite(outS[i]) || Math.abs(outS[i]) > 5) return { pass: false, why: `S[${i}]=${outS[i]}` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'msEncode', tests };
