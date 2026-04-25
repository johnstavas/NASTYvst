// op_expander.test.js — math tests for #42 downward expander.
// Primary: Bram env detector (Canon:dynamics §1) + math-by-definition
// expander curve mirroring the compressor law in #5 gainComputer
// (Zölzer §4.2.2 form).

import { ExpanderOp } from './op_expander.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new ExpanderOp(SR);
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

function rms(buf, from, to) {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

const tests = [
  {
    name: 'above threshold: signal passes unchanged (gain→1)',
    run() {
      // thr -40 dB ≈ 0.01 lin; input 0.5 ≫ thr.
      const op = freshOp({ thresholdDb: -40, ratio: 4, kneeDb: 0, attackMs: 1, releaseMs: 20, floor: 0, mix: 1 });
      const N = SR / 2;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      const rIn  = rms(inp, 2000, N);
      const rOut = rms(out, 2000, N);
      if (Math.abs(rOut - rIn) / rIn > 0.05) return { pass: false, why: `rOut=${rOut} rIn=${rIn}` };
      return { pass: true };
    },
  },
  {
    name: 'below threshold: signal is expanded down (attenuated)',
    run() {
      // thr -20 dB = 0.1 lin; signal 0.01 lin = -40 dB → 20 dB below thr.
      // ratio=4 → gr = (ratio-1)·(T−x) = 3·20 = 60 dB attenuation.
      const op = freshOp({ thresholdDb: -20, ratio: 4, kneeDb: 0, attackMs: 1, releaseMs: 10, floor: 0, mix: 1 });
      const N = SR / 2;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.01 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      const rOut = rms(out, N - 2000, N);
      if (rOut > 0.0005) return { pass: false, why: `expanded tail rms=${rOut} (expected ≪ input 0.007)` };
      return { pass: true };
    },
  },
  {
    name: 'ratio=1: bypass (no expansion)',
    run() {
      const op = freshOp({ thresholdDb: 0, ratio: 1, kneeDb: 0, attackMs: 1, releaseMs: 10, floor: 0, mix: 1 });
      const N = 4000;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.01 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      const rIn  = rms(inp, 2000, N);
      const rOut = rms(out, 2000, N);
      if (Math.abs(rOut - rIn) / rIn > 0.05) return { pass: false, why: `rOut=${rOut} rIn=${rIn}` };
      return { pass: true };
    },
  },
  {
    name: 'high ratio behaves like a gate',
    run() {
      const op = freshOp({ thresholdDb: -20, ratio: 100, kneeDb: 0, attackMs: 1, releaseMs: 5, floor: 0, mix: 1 });
      const N = SR / 4;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.02 * Math.sin(2 * Math.PI * 440 * i / SR); // below thr
      const out = drive(op, inp);
      const rOut = rms(out, N - 1000, N);
      if (rOut > 0.0005) return { pass: false, why: `gate-tail rms=${rOut}` };
      return { pass: true };
    },
  },
  {
    name: 'floor param clamps minimum gain',
    run() {
      // Below thr, ratio=∞ish but floor=0.5 → steady-state gain ≥ 0.5.
      const op = freshOp({ thresholdDb: -20, ratio: 100, kneeDb: 0, attackMs: 1, releaseMs: 5, floor: 0.5, mix: 1 });
      const N = SR / 4;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.01 * Math.sin(2 * Math.PI * 440 * i / SR);
      const out = drive(op, inp);
      const rIn  = rms(inp, N - 2000, N);
      const rOut = rms(out, N - 2000, N);
      const ratioObs = rOut / rIn;
      if (ratioObs < 0.45 || ratioObs > 0.55) return { pass: false, why: `floor-ratio=${ratioObs}` };
      return { pass: true };
    },
  },
  {
    name: 'sidechain drives expander independently of main input',
    run() {
      const op = freshOp({ thresholdDb: -20, ratio: 10, kneeDb: 0, attackMs: 1, releaseMs: 5, floor: 0, mix: 1 });
      const N = SR / 2;
      const inp = new Float32Array(N);
      const sc  = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR); // loud audio
        sc[i]  = 0.001;                                       // quiet SC ≪ thr
      }
      const out = new Float32Array(N);
      op.process({ in: inp, sidechain: sc }, { out }, N);
      const rTail = rms(out, N - 2000, N);
      if (rTail > 0.02) return { pass: false, why: `sc-gated rms=${rTail}` };
      return { pass: true };
    },
  },
  {
    name: 'mix=0 → pure dry passthrough',
    run() {
      const op = freshOp({ thresholdDb: 0, ratio: 10, mix: 0 });
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
    name: 'soft-knee transition is monotonic (no bump)',
    run() {
      // Sweep env from -50 dB to 0 dB; gain should be monotonically
      // non-decreasing across the knee.
      const op = freshOp({ thresholdDb: -20, ratio: 4, kneeDb: 10, attackMs: 0.01, releaseMs: 0.01, floor: 0, mix: 1 });
      const N = 4000;
      const inp = new Float32Array(N);
      // ramp amplitude exponentially from 1e-3 to 1.0
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const amp = Math.exp((1 - t) * Math.log(1e-3) + t * Math.log(1.0));
        inp[i] = amp; // DC ramp → env ≈ amp
      }
      const out = drive(op, inp);
      // Gain = out/in; must be non-decreasing (allow tiny slack).
      let lastG = 0;
      let violations = 0;
      for (let i = 500; i < N; i++) {
        if (inp[i] < 1e-6) continue;
        const g = out[i] / inp[i];
        if (g < lastG - 0.02) violations++;
        lastG = g;
      }
      if (violations > 5) return { pass: false, why: `monotonicity violations=${violations}` };
      return { pass: true };
    },
  },
  {
    name: 'silent input → silent output',
    run() {
      const op = freshOp({ thresholdDb: -40, floor: 0, mix: 1 });
      const out = drive(op, new Float32Array(3000));
      for (let i = 0; i < 3000; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        if (Math.abs(out[i]) > 1e-10)  return { pass: false, why: `out[${i}]=${out[i]}` };
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
      const a = drive(freshOp({ thresholdDb: -20, ratio: 3, kneeDb: 4, floor: 0.1, mix: 1 }), sig);
      const b = drive(freshOp({ thresholdDb: -20, ratio: 3, kneeDb: 4, floor: 0.1, mix: 1 }), sig);
      for (let i = 0; i < N; i++) if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ thresholdDb: -40, mix: 1 });
      const N = 2000;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / SR);
      drive(op, inp);
      op.reset();
      if (op._env !== 0 || op._gain !== 1) {
        return { pass: false, why: `post-reset env=${op._env} gain=${op._gain}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param clamps: ratio ≥ 1, ratio ≤ 100, knee ≥ 0, floor ∈ [0,1], mix ∈ [0,1]',
    run() {
      const op = freshOp();
      op.setParam('ratio', 0.5);    if (op._ratio !== 1)   return { pass: false, why: `ratio lo` };
      op.setParam('ratio', 1000);   if (op._ratio !== 100) return { pass: false, why: `ratio hi` };
      op.setParam('kneeDb', -3);    if (op._kneeDb !== 0)  return { pass: false, why: `knee lo` };
      op.setParam('floor', 5);      if (op._floor !== 1)   return { pass: false, why: `floor hi` };
      op.setParam('floor', -5);     if (op._floor !== 0)   return { pass: false, why: `floor lo` };
      op.setParam('mix', 5);        if (op._mix !== 1)     return { pass: false, why: `mix hi` };
      op.setParam('mix', -5);       if (op._mix !== 0)     return { pass: false, why: `mix lo` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud wideband input stays finite',
    run() {
      const op = freshOp({ thresholdDb: -20, ratio: 4, mix: 1 });
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

export default { opId: 'expander', tests };
