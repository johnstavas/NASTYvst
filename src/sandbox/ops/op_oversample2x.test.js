// op_oversample2x.test.js — math tests for #12.
// Primary: hiir polyphase IIR halfband (de Soras, WTFPL).

import { Oversample2xOp } from './op_oversample2x.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new Oversample2xOp(SR);
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

function rms(buf, start = 0) {
  let s = 0, n = 0;
  for (let i = start; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

const tests = [
  {
    name: 'static shape (opId, inputs, outputs, params)',
    run() {
      if (Oversample2xOp.opId !== 'oversample2x') return { pass: false, why: 'opId' };
      if (Oversample2xOp.inputs.length !== 1) return { pass: false, why: 'inputs' };
      if (Oversample2xOp.outputs.length !== 1) return { pass: false, why: 'outputs' };
      const pids = Oversample2xOp.params.map(p => p.id).sort();
      if (JSON.stringify(pids) !== JSON.stringify(['attenuationDb','transitionBw'])) return { pass: false, why: `params=${pids}` };
      return { pass: true };
    },
  },
  {
    name: 'designer: coef count > 0 and all values in (0,1)',
    run() {
      const op = freshOp();
      if (op._N < 1) return { pass: false, why: `N=${op._N}` };
      for (let i = 0; i < op._N; i++) {
        const c = op._coef[i];
        if (!(c > 0 && c < 1)) return { pass: false, why: `c[${i}]=${c}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'designer: higher atten → more coefs',
    run() {
      const lo = freshOp({ attenuationDb: 60 });
      const hi = freshOp({ attenuationDb: 120 });
      if (!(hi._N >= lo._N)) return { pass: false, why: `lo=${lo._N} hi=${hi._N}` };
      return { pass: true };
    },
  },
  {
    name: 'passband: 1 kHz sine passes at approximately unity',
    run() {
      const op = freshOp();
      const N = SR;  // 1 s
      const inp = sine(N, 1000, 0.5);
      const out = drive(op, inp);
      // Skip startup transient (cascade + 1-sample delay)
      const settle = 2048;
      const rIn  = rms(inp, settle);
      const rOut = rms(out, settle);
      const ratio = rOut / rIn;
      if (!(ratio > 0.95 && ratio < 1.05)) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },
  {
    name: 'DC passes unchanged at steady state',
    run() {
      const op = freshOp();
      const N = 4096;
      const inp = new Float32Array(N);
      inp.fill(0.3);
      const out = drive(op, inp);
      const tail = out[N - 1];
      if (Math.abs(tail - 0.3) > 0.01) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud noise stays finite',
    run() {
      const op = freshOp();
      const N = 4096;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = (Math.random() * 2 - 1) * 10;
      const out = drive(op, inp);
      for (const v of out) if (!Number.isFinite(v)) return { pass: false, why: 'non-finite' };
      return { pass: true };
    },
  },
  {
    name: 'silence in → silence out',
    run() {
      const op = freshOp();
      const N = 1024;
      const inp = new Float32Array(N);
      const out = drive(op, inp);
      for (const v of out) if (v !== 0) return { pass: false, why: `v=${v}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp();
      drive(op, sine(1024, 1000, 0.5));
      op.reset();
      for (let i = 0; i < op._N; i++) {
        if (op._xU[i] !== 0 || op._yU[i] !== 0) return { pass: false, why: 'xU/yU' };
        if (op._xD[i] !== 0 || op._yD[i] !== 0) return { pass: false, why: 'xD/yD' };
      }
      if (op._pendingOdd !== 0) return { pass: false, why: 'pendingOdd' };
      return { pass: true };
    },
  },
  {
    name: 'denormal flush: tiny state collapses to 0',
    run() {
      const op = freshOp();
      for (let i = 0; i < op._N; i++) {
        op._xU[i] = 1e-40; op._yU[i] = 1e-40;
        op._xD[i] = 1e-40; op._yD[i] = 1e-40;
      }
      drive(op, new Float32Array(128));
      for (let i = 0; i < op._N; i++) {
        if (op._xU[i] !== 0) return { pass: false, why: `xU[${i}]=${op._xU[i]}` };
        if (op._yU[i] !== 0) return { pass: false, why: `yU[${i}]=${op._yU[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'param redesign: changing atten rebuilds coefs and zeros state',
    run() {
      const op = freshOp();
      drive(op, sine(1024, 1000, 0.5));
      const oldN = op._N;
      op.setParam('attenuationDb', 140);
      if (op._N === oldN && op._atten === 100) return { pass: false, why: 'no redesign' };
      for (let i = 0; i < op._N; i++) {
        if (op._xU[i] !== 0) return { pass: false, why: 'state not cleared' };
      }
      return { pass: true };
    },
  },
  {
    name: 'latency: 1 sample (odd-buffer hold)',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 1) return { pass: false, why: `lat=${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → silence out',
    run() {
      const op = freshOp();
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (const v of out) if (v !== 0) return { pass: false, why: `v=${v}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op',
    run() {
      const op = freshOp();
      op.process({ in: sine(64, 1000) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'clamps: atten < 20 bounded; tbw > 0.45 bounded',
    run() {
      const op = freshOp();
      op.setParam('attenuationDb', -10);
      if (op._atten !== 20) return { pass: false, why: `atten=${op._atten}` };
      op.setParam('transitionBw', 0.9);
      if (op._tbw !== 0.45) return { pass: false, why: `tbw=${op._tbw}` };
      return { pass: true };
    },
  },
];

export default { opId: 'oversample2x', tests };
