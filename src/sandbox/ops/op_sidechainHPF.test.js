// op_sidechainHPF.test.js — math tests for #44 sidechainHPF.
// Primary: RBJ Audio EQ Cookbook HPF (C:/Users/HEAT2/Downloads/rbj_cookbook.txt L116-L123).

import { SidechainHPFOp } from './op_sidechainHPF.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new SidechainHPFOp(SR);
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

function sine(N, freq, amp = 1, sr = SR) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  return buf;
}

function rms(x, start = 0) {
  let s = 0; let n = 0;
  for (let i = start; i < x.length; i++) { s += x[i] * x[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

const tests = [
  {
    name: 'static shape (opId, inputs, outputs, params)',
    run() {
      if (SidechainHPFOp.opId !== 'sidechainHPF') return { pass: false, why: 'opId' };
      if (SidechainHPFOp.inputs.length !== 1) return { pass: false, why: 'inputs' };
      if (SidechainHPFOp.outputs.length !== 1) return { pass: false, why: 'outputs' };
      const pids = SidechainHPFOp.params.map(p => p.id).sort();
      if (JSON.stringify(pids) !== JSON.stringify(['cutoff','order','q'])) return { pass: false, why: `params=${pids}` };
      return { pass: true };
    },
  },
  {
    name: 'DC (0 Hz) — fully rejected',
    run() {
      const op = freshOp({ cutoff: 100, q: 0.707 });
      const N = 4096;
      const inp = new Float32Array(N); for (let i = 0; i < N; i++) inp[i] = 1.0;
      const out = drive(op, inp);
      const tailRms = rms(out, 3000);
      if (tailRms > 0.01) return { pass: false, why: `DC leakage ${tailRms}` };
      return { pass: true };
    },
  },
  {
    name: 'well above cutoff — near unity pass (2 kHz, f0=100)',
    run() {
      const op = freshOp({ cutoff: 100, q: 0.707 });
      const out = drive(op, sine(8192, 2000));
      const r = rms(out, 4000);
      if (Math.abs(r - Math.SQRT1_2) > 0.05) return { pass: false, why: `r=${r}` };
      return { pass: true };
    },
  },
  {
    name: 'at cutoff (f0=1000, Q=0.707) — ≈ −3 dB magnitude',
    run() {
      const op = freshOp({ cutoff: 1000, q: Math.SQRT1_2 });
      const out = drive(op, sine(16384, 1000));
      const r = rms(out, 8000);
      // -3 dB linear = 0.7079; sine RMS 0.707 → expected 0.5005
      if (Math.abs(r - 0.5005) > 0.03) return { pass: false, why: `r=${r}` };
      return { pass: true };
    },
  },
  {
    name: 'well below cutoff — strongly attenuated (50 Hz, f0=1 kHz)',
    run() {
      const op = freshOp({ cutoff: 1000, q: 0.707 });
      const out = drive(op, sine(8192, 50));
      const r = rms(out, 4000);
      if (r > 0.02) return { pass: false, why: `stopband leakage ${r}` };
      return { pass: true };
    },
  },
  {
    name: 'order=2 cascade steeper than order=1',
    run() {
      const N = 8192;
      const inp = sine(N, 50);
      const r1 = rms(drive(freshOp({ cutoff: 1000, q: 0.707, order: 1 }), inp), 4000);
      const r2 = rms(drive(freshOp({ cutoff: 1000, q: 0.707, order: 2 }), inp), 4000);
      if (r2 >= r1) return { pass: false, why: `r1=${r1} r2=${r2}` };
      return { pass: true };
    },
  },
  {
    name: 'order=2 passes highs near unity',
    run() {
      const op = freshOp({ cutoff: 100, q: 0.707, order: 2 });
      const r = rms(drive(op, sine(8192, 2000)), 4000);
      if (Math.abs(r - Math.SQRT1_2) > 0.05) return { pass: false, why: `r=${r}` };
      return { pass: true };
    },
  },
  {
    name: 'coefficients match RBJ formulas exactly',
    run() {
      const op = freshOp({ cutoff: 1000, q: 0.707 });
      const w0 = 2 * Math.PI * 1000 / SR;
      const c = Math.cos(w0), s = Math.sin(w0);
      const alpha = s / (2 * 0.707);
      const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = (1 + c) / 2;
      const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
      const want = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
      const got  = [op._b0, op._b1, op._b2, op._a1, op._a2];
      for (let i = 0; i < 5; i++) if (Math.abs(want[i] - got[i]) > 1e-12) return { pass: false, why: `coef[${i}] ${got[i]} != ${want[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'cutoff 0 Hz clamped safely (no NaN)',
    run() {
      const op = freshOp({ cutoff: 0 });
      const out = drive(op, sine(128, 2000));
      for (const v of out) if (!Number.isFinite(v)) return { pass: false, why: 'non-finite' };
      return { pass: true };
    },
  },
  {
    name: 'cutoff above Nyquist clamped safely',
    run() {
      const op = freshOp({ cutoff: SR * 0.6 });
      const out = drive(op, sine(128, 500));
      for (const v of out) if (!Number.isFinite(v)) return { pass: false, why: 'non-finite' };
      return { pass: true };
    },
  },
  {
    name: 'order invalid falls back to 1',
    run() {
      const op = freshOp({ order: 7 });
      if (op._order !== 1) return { pass: false, why: `order=${op._order}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input emits silence',
    run() {
      const op = freshOp();
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (const v of out) if (v !== 0) return { pass: false, why: `v=${v}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: sine(64, 1000) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp({ cutoff: 500 });
      drive(op, sine(512, 2000));
      op.reset();
      if (op._x1a !== 0 || op._y1a !== 0 || op._x1b !== 0 || op._y1b !== 0) return { pass: false, why: 'state leaked' };
      return { pass: true };
    },
  },
  {
    name: 'denormal flush collapses tiny state to 0',
    run() {
      const op = freshOp();
      op._y1a = 1e-40; op._y2a = 1e-40;
      const out = drive(op, new Float32Array(128));
      for (const v of out) if (v !== 0) return { pass: false, why: 'denormal leaked' };
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

export default { opId: 'sidechainHPF', tests };
