// op_transient.test.js — math tests for #43 transient shaper.
// Math-by-definition: differential Bram §1 envelope followers → attack/sustain gain.

import { TransientOp } from './op_transient.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new TransientOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inp) {
  const N = inp.length;
  const out = new Float32Array(N);
  const CHUNK = 256;
  let pos = 0;
  while (pos < N) {
    const c = Math.min(CHUNK, N - pos);
    const ix = inp.slice(pos, pos + c);
    const o = new Float32Array(c);
    op.process({ in: ix }, { out: o }, c);
    out.set(o, pos);
    pos += c;
  }
  return out;
}

// Percussive burst: short quiet tail, then loud impulse train, then sustain.
function makeBurst(N, impulseIdx, impulseAmp, sustainAmp) {
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = sustainAmp * Math.sin(2 * Math.PI * 110 * i / SR);
  // Envelope: sharp attack at impulseIdx.
  for (let i = impulseIdx; i < impulseIdx + 100; i++) {
    const d = (i - impulseIdx) / 100;
    a[i] += impulseAmp * (1 - d) * Math.sin(2 * Math.PI * 440 * i / SR);
  }
  return a;
}

function peak(buf, from, to) {
  let m = 0;
  for (let i = from; i < to; i++) { const a = Math.abs(buf[i]); if (a > m) m = a; }
  return m;
}

const tests = [
  {
    name: 'zero attack/sustain amount → passthrough (unity gain)',
    run() {
      const op = freshOp({ attackAmount: 0, sustainAmount: 0, mix: 1 });
      const N = 2048;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1);
      const out = drive(op, inp);
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i] - inp[i]) > 1e-5) return { pass: false, why: `i=${i} diverge` };
      }
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → pure dry passthrough',
    run() {
      const op = freshOp({ attackAmount: 1, sustainAmount: 1, mix: 0 });
      const N = 2048;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(i * 0.1);
      const out = drive(op, inp);
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i] - inp[i]) > 1e-5) return { pass: false, why: `i=${i} diverge` };
      }
      return { pass: true };
    },
  },
  {
    name: 'positive attackAmount increases transient peak',
    run() {
      const opN = freshOp({ attackAmount: 0, sustainAmount: 0, mix: 1 });
      const opP = freshOp({ attackAmount: 1, sustainAmount: 0, mix: 1 });
      const N = 4096;
      const inp = makeBurst(N, 1000, 0.8, 0.05);
      const outN = drive(opN, inp);
      const outP = drive(opP, inp);
      const pN = peak(outN, 1000, 1200);
      const pP = peak(outP, 1000, 1200);
      if (pP <= pN * 1.05) return { pass: false, why: `attack+1 peak ${pP} not > baseline ${pN}` };
      return { pass: true };
    },
  },
  {
    name: 'negative attackAmount softens transient peak',
    run() {
      const opN = freshOp({ attackAmount: 0, sustainAmount: 0, mix: 1 });
      const opS = freshOp({ attackAmount: -1, sustainAmount: 0, mix: 1 });
      const N = 4096;
      const inp = makeBurst(N, 1000, 0.8, 0.05);
      const outN = drive(opN, inp);
      const outS = drive(opS, inp);
      const pN = peak(outN, 1000, 1200);
      const pS = peak(outS, 1000, 1200);
      if (pS >= pN * 0.95) return { pass: false, why: `attack-1 peak ${pS} not < baseline ${pN}` };
      return { pass: true };
    },
  },
  {
    name: 'steady tone: gain ≈ 1 (no transient/sustain material)',
    run() {
      // Steady-state tone → envFast ≈ envSlow → atk=sus=0 → gain=1.
      const op = freshOp({ attackAmount: 1, sustainAmount: 1, mix: 1 });
      const N = SR;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      // After both envelopes converge (~300 ms), out ≈ in.
      const from = Math.round(SR * 0.5);
      let maxDev = 0;
      for (let i = from; i < N; i++) {
        const d = Math.abs(out[i] - inp[i]);
        if (d > maxDev) maxDev = d;
      }
      if (maxDev > 0.05) return { pass: false, why: `steady-state dev=${maxDev}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ attackAmount: 1, sustainAmount: 1, mix: 1 });
      const out = drive(op, new Float32Array(3000));
      for (let i = 0; i < 3000; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 1e-8)  return { pass: false, why: `out[${i}]=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const N = 4000;
      const sig = new Float32Array(N);
      for (let i = 0; i < N; i++) sig[i] = Math.sin(i * 0.03) + 0.3 * Math.sin(i * 0.13);
      const a = drive(freshOp({ attackAmount: 0.5, sustainAmount: -0.3, mix: 1 }), sig);
      const b = drive(freshOp({ attackAmount: 0.5, sustainAmount: -0.3, mix: 1 }), sig);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears envelope state',
    run() {
      const op = freshOp({ attackAmount: 0.5, mix: 1 });
      const N = 2000;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      drive(op, inp);
      op.reset();
      if (op._envFast !== 0 || op._envSlow !== 0) {
        return { pass: false, why: `envFast=${op._envFast} envSlow=${op._envSlow}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: amounts ∈ [-1,+1], fastMs ∈ [0.1,20], slowMs ∈ [1,200], mix ∈ [0,1]',
    run() {
      const op = freshOp();
      op.setParam('attackAmount',  5);  if (op._kA !== 1)   return { pass: false, why: `kA hi` };
      op.setParam('attackAmount', -5);  if (op._kA !== -1)  return { pass: false, why: `kA lo` };
      op.setParam('sustainAmount', 5);  if (op._kS !== 1)   return { pass: false, why: `kS hi` };
      op.setParam('fastMs',       100); if (op._fastMs !== 20)  return { pass: false, why: `fast hi` };
      op.setParam('fastMs',         0); if (op._fastMs !== 0.1) return { pass: false, why: `fast lo` };
      op.setParam('slowMs',      5000); if (op._slowMs !== 200) return { pass: false, why: `slow hi` };
      op.setParam('slowMs',         0); if (op._slowMs !== 1)   return { pass: false, why: `slow lo` };
      op.setParam('mix', 5);            if (op._mix !== 1)  return { pass: false, why: `mix hi` };
      op.setParam('mix', -5);           if (op._mix !== 0)  return { pass: false, why: `mix lo` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud wideband input stays finite',
    run() {
      const op = freshOp({ attackAmount: 1, sustainAmount: 1, mix: 1 });
      const N = SR;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.random() * 2 - 1;
      const out = drive(op, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 10)    return { pass: false, why: `out=${out[i]} at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input → silent output',
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
      if (op.getLatencySamples() !== 0) return { pass: false, why: `lat=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
];

export default { opId: 'transient', tests };
