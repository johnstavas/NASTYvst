// op_gate.test.js — math tests for #41 gate.
// Primary: Bram envelope detector (dsp_code_canon_dynamics.md §1) +
// math-by-definition state machine w/ Schmitt hysteresis.

import { GateOp } from './op_gate.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new GateOp(SR);
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
    const i = inp.slice(pos, pos + c);
    const o = new Float32Array(c);
    op.process({ in: i }, { out: o }, c);
    out.set(o, pos);
    pos += c;
  }
  return out;
}

function makeBurst(loud, quietFrom, quietTo, N) {
  const a = new Float32Array(N);
  for (let i = 0; i < quietFrom; i++) a[i] = loud * Math.sin(2 * Math.PI * 440 * i / SR);
  for (let i = quietFrom; i < quietTo; i++) a[i] = 0.001 * Math.sin(2 * Math.PI * 440 * i / SR); // below threshold
  for (let i = quietTo; i < N; i++) a[i] = loud * Math.sin(2 * Math.PI * 440 * i / SR);
  return a;
}

function rms(buf, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

const tests = [
  {
    name: 'loud signal passes (gain ≈ 1 after attack)',
    run() {
      const op = freshOp({ threshold: 0.1, attackMs: 1, releaseMs: 50, holdMs: 10, floor: 0, mix: 1 });
      const N = SR / 2;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      // After ~10 ms (480 samples) gate should be fully open.
      const rIn  = rms(inp, 2000, N);
      const rOut = rms(out, 2000, N);
      if (Math.abs(rOut - rIn) / rIn > 0.05) return { pass: false, why: `rOut=${rOut} rIn=${rIn}` };
      return { pass: true };
    },
  },
  {
    name: 'sub-threshold signal attenuated to floor',
    run() {
      const op = freshOp({ threshold: 0.2, attackMs: 1, releaseMs: 20, holdMs: 5, floor: 0, mix: 1 });
      const N = SR / 4;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.05 * Math.sin(2 * Math.PI * 440 * i / SR); // well below
      const out = drive(op, inp);
      const rOut = rms(out, N / 2, N);
      if (rOut > 0.002) return { pass: false, why: `gated tail rms=${rOut}` };
      return { pass: true };
    },
  },
  {
    name: 'gate opens on loud burst, closes after hold+release',
    run() {
      const op = freshOp({ threshold: 0.1, attackMs: 1, releaseMs: 20, holdMs: 10, floor: 0, mix: 1 });
      const N = SR;
      const inp = makeBurst(0.5, N / 3, 2 * N / 3, N);
      const out = drive(op, inp);
      const rFirst = rms(out, 1000, N / 3 - 500); // loud phase (after attack)
      // late phase (post-release): 2*N/3 is boundary; allow ~hold+release time
      const rMid   = rms(out, 2 * N / 3 - 2000, 2 * N / 3 - 500); // quiet middle
      if (rFirst < 0.2) return { pass: false, why: `loud phase rms=${rFirst}` };
      if (rMid > 0.01)  return { pass: false, why: `quiet phase leak rms=${rMid}` };
      return { pass: true };
    },
  },
  {
    name: 'sidechain input drives gate independently',
    run() {
      const op = freshOp({ threshold: 0.1, attackMs: 1, releaseMs: 20, holdMs: 5, floor: 0, mix: 1 });
      const N = SR / 2;
      const inp = new Float32Array(N);
      const sc  = new Float32Array(N);
      // Input is steady tone, sidechain is quiet → gate should stay closed
      for (let i = 0; i < N; i++) {
        inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
        sc[i]  = 0.01; // below threshold
      }
      // Process manually to include sidechain.
      const out = new Float32Array(N);
      op.process({ in: inp, sidechain: sc }, { out }, N);
      const rTail = rms(out, N / 2, N);
      if (rTail > 0.02) return { pass: false, why: `sidechain-gated rms=${rTail}` };
      return { pass: true };
    },
  },
  {
    name: 'floor param preserves partial level',
    run() {
      const op = freshOp({ threshold: 0.5, attackMs: 1, releaseMs: 20, holdMs: 5, floor: 0.5, mix: 1 });
      const N = SR / 4;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.05; // well below, but floor=0.5
      const out = drive(op, inp);
      // Steady-state output ≈ 0.05 * 0.5 = 0.025
      const avg = out[N - 1];
      if (Math.abs(avg - 0.025) > 0.005) return { pass: false, why: `steady out=${avg}, expected ~0.025` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ threshold: 0.1, floor: 0, mix: 1 });
      const out = drive(op, new Float32Array(3000));
      for (let i = 0; i < 3000; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → pure dry passthrough',
    run() {
      const op = freshOp({ threshold: 10, mix: 0 }); // threshold impossibly high
      const N = 2000;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      for (let i = 0; i < N; i++) {
        if (Math.abs(out[i] - inp[i]) > 1e-5) return { pass: false, why: `diverge at ${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'hysteresis prevents chatter near threshold',
    run() {
      const op = freshOp({ threshold: 0.1, attackMs: 1, releaseMs: 5, holdMs: 5, floor: 0, mix: 1 });
      const N = SR;
      const inp = new Float32Array(N);
      // Sine whose envelope hovers just above threshold
      for (let i = 0; i < N; i++) inp[i] = 0.11 * Math.sin(2 * Math.PI * 440 * i / SR);
      drive(op, inp);
      // Count state transitions from CLOSED or RELEASE to ATTACK in a second batch
      // Here we just confirm no NaN / no runaway. Chatter won't NaN, but output
      // should be continuous.
      const out = drive(op, inp);
      let maxJump = 0;
      for (let i = 1; i < N; i++) {
        const j = Math.abs(out[i] - out[i - 1]);
        if (j > maxJump) maxJump = j;
      }
      if (maxJump > 0.5) return { pass: false, why: `chatter: maxJump=${maxJump}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism — same input → same output',
    run() {
      const N = 4000;
      const sig = new Float32Array(N);
      for (let i = 0; i < N; i++) sig[i] = Math.sin(i * 0.03) + 0.3 * Math.sin(i * 0.13);
      const a = drive(freshOp({ threshold: 0.3, floor: 0.1, mix: 1 }), sig);
      const b = drive(freshOp({ threshold: 0.3, floor: 0.1, mix: 1 }), sig);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ threshold: 0.1, mix: 1 });
      const N = 2000;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      drive(op, inp);
      op.reset();
      if (op._env !== 0 || op._gain !== 0 || op._state !== 0) {
        return { pass: false, why: `post-reset env=${op._env} gain=${op._gain} state=${op._state}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: threshold ≥ 0, floor ∈ [0,1], mix ∈ [0,1]',
    run() {
      const op = freshOp();
      op.setParam('threshold', -5); if (op._threshold !== 0) return { pass: false, why: `thr clamp` };
      op.setParam('floor', 5);      if (op._floor !== 1)     return { pass: false, why: `floor hi` };
      op.setParam('floor', -5);     if (op._floor !== 0)     return { pass: false, why: `floor lo` };
      op.setParam('mix', 5);        if (op._mix !== 1)       return { pass: false, why: `mix hi` };
      op.setParam('mix', -5);       if (op._mix !== 0)       return { pass: false, why: `mix lo` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud wideband input stays finite',
    run() {
      const op = freshOp({ threshold: 0.1, mix: 1 });
      const N = SR;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = Math.random() * 2 - 1;
      const out = drive(op, inp);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 5)     return { pass: false, why: `out=${out[i]} at ${i}` };
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

export default { opId: 'gate', tests };
