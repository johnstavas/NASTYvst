// op_meters.test.js — math tests for #46 meters.
// Primary: composition of op_peak.worklet.js (L14-L23) + op_rms.worklet.js (L17-L20).

import { MetersOp } from './op_meters.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new MetersOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function drive(op, inp) {
  const N = inp.length;
  const peak = new Float32Array(N);
  const rms  = new Float32Array(N);
  const CHUNK = 256;
  let pos = 0;
  while (pos < N) {
    const c = Math.min(CHUNK, N - pos);
    const i = inp.slice(pos, pos + c);
    const p = new Float32Array(c);
    const r = new Float32Array(c);
    op.process({ in: i }, { peak: p, rms: r }, c);
    peak.set(p, pos);
    rms.set(r,  pos);
    pos += c;
  }
  return { peak, rms };
}

function sine(N, freq, amp = 1, sr = SR) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sr);
  return buf;
}

const tests = [
  {
    name: 'static shape (opId, inputs, outputs, params)',
    run() {
      if (MetersOp.opId !== 'meters') return { pass: false, why: 'opId' };
      if (MetersOp.inputs.length !== 1) return { pass: false, why: 'inputs' };
      const outs = MetersOp.outputs.map(p => p.id).sort();
      if (JSON.stringify(outs) !== JSON.stringify(['peak','rms'])) return { pass: false, why: `outs=${outs}` };
      const pids = MetersOp.params.map(p => p.id).sort();
      if (JSON.stringify(pids) !== JSON.stringify(['peakReleaseMs','rmsWindowMs','standard'])) return { pass: false, why: `params=${pids}` };
      return { pass: true };
    },
  },
  {
    name: 'peak: instant attack — impulse sets peak to 0.9',
    run() {
      const op = freshOp({ standard: 'vu' });
      const inp = new Float32Array(32);
      inp[5] = 0.9;
      const { peak } = drive(op, inp);
      if (Math.abs(peak[5] - 0.9) > 1e-6) return { pass: false, why: `peak[5]=${peak[5]}` };
      return { pass: true };
    },
  },
  {
    name: 'peak: exponential release — monotonic decay after impulse',
    run() {
      const op = freshOp({ standard: 'digital' });  // 3 s release
      const inp = new Float32Array(4096);
      inp[0] = 1.0;
      const { peak } = drive(op, inp);
      // After impulse, peak should monotonically decrease
      for (let i = 1; i < 4095; i++) {
        if (peak[i + 1] > peak[i] + 1e-9) return { pass: false, why: `not monotonic at ${i}: ${peak[i]}→${peak[i+1]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'rms: sine amp=1 → RMS ≈ 0.707 at steady state',
    run() {
      const op = freshOp({ standard: 'vu' });  // 300 ms window
      const inp = sine(SR * 2, 1000);  // 2 s of sine
      const { rms } = drive(op, inp);
      const tail = rms[rms.length - 1];
      if (Math.abs(tail - Math.SQRT1_2) > 0.02) return { pass: false, why: `tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'rms: silence settles to 0',
    run() {
      const op = freshOp({ standard: 'ppm' });  // 10 ms window — fast
      const inp = new Float32Array(SR);  // 1 s silence
      const { rms } = drive(op, inp);
      if (rms[rms.length - 1] > 1e-6) return { pass: false, why: `tail=${rms[rms.length-1]}` };
      return { pass: true };
    },
  },
  {
    name: 'peak + rms emitted simultaneously from single drive',
    run() {
      const op = freshOp({ standard: 'ppm' });  // 10 ms RMS window — settles fast
      const N = SR;  // 1 s of sine
      const inp = sine(N, 1000, 0.8);
      const { peak, rms } = drive(op, inp);
      // Peak should approach 0.8; RMS should approach 0.8·√½ ≈ 0.566
      const pLast = peak[peak.length - 1];
      const rLast = rms[rms.length - 1];
      if (pLast < 0.75 || pLast > 0.82) return { pass: false, why: `peak=${pLast}` };
      if (rLast < 0.50 || rLast > 0.60) return { pass: false, why: `rms=${rLast}` };
      return { pass: true };
    },
  },
  {
    name: 'preset vu: rms window 300 ms, peak release 1700 ms',
    run() {
      const op = freshOp({ standard: 'vu' });
      if (op._rmsWinMs !== 300)   return { pass: false, why: `rmsWin=${op._rmsWinMs}` };
      if (op._peakRelMs !== 1700) return { pass: false, why: `peakRel=${op._peakRelMs}` };
      return { pass: true };
    },
  },
  {
    name: 'preset ppm: rms window 10 ms, peak release 1700 ms',
    run() {
      const op = freshOp({ standard: 'ppm' });
      if (op._rmsWinMs !== 10)    return { pass: false, why: `rmsWin=${op._rmsWinMs}` };
      if (op._peakRelMs !== 1700) return { pass: false, why: `peakRel=${op._peakRelMs}` };
      return { pass: true };
    },
  },
  {
    name: 'preset digital: rms window 300 ms, peak release 3000 ms',
    run() {
      const op = freshOp({ standard: 'digital' });
      if (op._rmsWinMs !== 300)   return { pass: false, why: `rmsWin=${op._rmsWinMs}` };
      if (op._peakRelMs !== 3000) return { pass: false, why: `peakRel=${op._peakRelMs}` };
      return { pass: true };
    },
  },
  {
    name: 'custom params override preset → standard becomes "custom"',
    run() {
      const op = freshOp({ standard: 'vu' });
      op.setParam('peakReleaseMs', 500);
      if (op._standard !== 'custom') return { pass: false, why: `std=${op._standard}` };
      if (op._peakRelMs !== 500) return { pass: false, why: `peakRel=${op._peakRelMs}` };
      return { pass: true };
    },
  },
  {
    name: 'invalid preset falls back to vu',
    run() {
      const op = freshOp({ standard: 'bogus' });
      if (op._standard !== 'vu') return { pass: false, why: `std=${op._standard}` };
      return { pass: true };
    },
  },
  {
    name: 'release clamp: out-of-range values bounded',
    run() {
      const op = freshOp();
      op.setParam('peakReleaseMs', -50);
      // clamp=1ms; no throw, coefs finite
      if (!Number.isFinite(op._rCoef)) return { pass: false, why: 'rCoef' };
      op.setParam('peakReleaseMs', 1e9);
      if (!Number.isFinite(op._rCoef)) return { pass: false, why: 'rCoef2' };
      return { pass: true };
    },
  },
  {
    name: 'missing input emits silence on both outputs',
    run() {
      const op = freshOp();
      const peak = new Float32Array(64);
      const rms  = new Float32Array(64);
      op.process({}, { peak, rms }, 64);
      for (const v of peak) if (v !== 0) return { pass: false, why: `peak=${v}` };
      for (const v of rms)  if (v !== 0) return { pass: false, why: `rms=${v}` };
      return { pass: true };
    },
  },
  {
    name: 'missing outputs is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: sine(64, 1000) }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'reset clears state',
    run() {
      const op = freshOp();
      drive(op, sine(512, 1000));
      op.reset();
      if (op._peakY !== 0 || op._p !== 0) return { pass: false, why: 'state leak' };
      return { pass: true };
    },
  },
  {
    name: 'denormal flush: tiny state collapses to 0',
    run() {
      const op = freshOp();
      op._peakY = 1e-40;
      op._p     = 1e-40;
      drive(op, new Float32Array(128));
      if (op._peakY !== 0 || op._p !== 0) return { pass: false, why: `peakY=${op._peakY} p=${op._p}` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud noise stays finite on both outputs',
    run() {
      const op = freshOp();
      const N = 2048;
      const inp = new Float32Array(N);
      for (let i = 0; i < N; i++) inp[i] = (Math.random() * 2 - 1) * 10;
      const { peak, rms } = drive(op, inp);
      for (const v of peak) if (!Number.isFinite(v)) return { pass: false, why: 'peak non-finite' };
      for (const v of rms)  if (!Number.isFinite(v)) return { pass: false, why: 'rms non-finite' };
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

export default { opId: 'meters', tests };
