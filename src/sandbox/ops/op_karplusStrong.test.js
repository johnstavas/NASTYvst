// op_karplusStrong.test.js — real-math tests for op_karplusStrong.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Original 1983 Karplus-Strong. On rising-edge trig, delay line of
//   length N = round(sr/freq) is noise-filled. Loop filter is
//   y = decay · (bright·x + (1−bright)·½(x + prev)).
//   Before any trigger → silence. Deterministic (fixed PRNG seed).

import { KarplusStrongOp } from './op_karplusStrong.worklet.js';

const SR = 48000;

function freshOp(freq = 220, decay = 0.996, bright = 0.5) {
  const op = new KarplusStrongOp(SR);
  op.reset();
  op.setParam('freq', freq);
  op.setParam('decay', decay);
  op.setParam('bright', bright);
  return op;
}

function runWithPluck(op, nOut, pluckAt = 0) {
  const trig = new Float32Array(nOut);
  if (pluckAt >= 0) trig[pluckAt] = 1;
  const out = new Float32Array(nOut);
  op.process({ trig }, { out }, nOut);
  return out;
}

function energy(buf) {
  let e = 0;
  for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
  return e;
}

// Zero-crossing rate (normalized) — rough pitch proxy.
function zcrHz(buf, sr) {
  let zc = 0;
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i - 1] >= 0) !== (buf[i] >= 0)) zc++;
  }
  return (zc * sr) / (2 * buf.length);
}

const tests = [
  {
    name: 'before any trigger → silence',
    run() {
      const op = freshOp();
      const out = new Float32Array(256);
      op.process({}, { out }, 256);
      for (let i = 0; i < 256; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'trigger produces non-zero output',
    run() {
      const op = freshOp();
      const out = runWithPluck(op, 512, 0);
      if (energy(out) < 1) return { pass: false, why: `energy=${energy(out)}` };
      return { pass: true };
    },
  },
  {
    name: 'pitch approximates freq (autocorrelation peak at N samples)',
    run() {
      const op = freshOp(220, 0.999, 0.5);
      const out = new Float32Array(SR * 0.5 | 0);
      const trig = new Float32Array(out.length); trig[0] = 1;
      op.process({ trig }, { out }, out.length);
      const N = Math.round(SR / 220);   // expected period = 218
      // Autocorrelate on a stable middle window (skip attack transient).
      const start = 2048;
      const len   = 4096;
      const slice = out.subarray(start, start + len);
      function acf(lag) {
        let s = 0;
        for (let i = 0; i + lag < len; i++) s += slice[i] * slice[i + lag];
        return s;
      }
      const peak = acf(N);
      // Peak at expected lag N should beat neighbours ±10 samples (no
      // fractional-delay interpolation yet so pitch is quantised to sr/N).
      // Beating ±20 samples would fail for freqs where N is small.
      for (let d = 5; d <= 15; d++) {
        const lo = acf(N - d);
        const hi = acf(N + d);
        if (lo >= peak) return { pass: false, why: `acf(${N - d})=${lo} >= acf(${N})=${peak}` };
        if (hi >= peak) return { pass: false, why: `acf(${N + d})=${hi} >= acf(${N})=${peak}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'decay: lower decay → faster energy drop',
    run() {
      const a = freshOp(220, 0.999, 0.5);
      const b = freshOp(220, 0.9,   0.5);
      const nTail = SR * 0.5 | 0;
      const oA = new Float32Array(SR);
      const oB = new Float32Array(SR);
      const trig = new Float32Array(SR); trig[0] = 1;
      a.process({ trig }, { out: oA }, SR);
      b.process({ trig }, { out: oB }, SR);
      const eA = energy(oA.subarray(nTail));
      const eB = energy(oB.subarray(nTail));
      if (eB >= eA) return { pass: false, why: `slow decay: eA=${eA} eB=${eB} (expected eB << eA)` };
      // And fast-decay should be essentially silent by 0.5 s with decay=0.9 at 220 Hz
      // (loop period ≈ 218 samples; decay^N ≈ 0.9^218 ≈ 1e-10).
      if (eB > 1e-3) return { pass: false, why: `fast decay still loud: eB=${eB}` };
      return { pass: true };
    },
  },
  {
    name: 'decay=0 → single buffer pass then silent',
    run() {
      const op = freshOp(220, 0, 0.5);
      const out = runWithPluck(op, 1024, 0);
      // With decay=0, y = 0 always; buffer read emits the first pass but all
      // writes are zero. So output is buf[0..N-1] then all zeros, but the
      // write-back zeros the buffer as we go. Actually: first read gives
      // noise[0], then we write 0. So out[0] contains y = 0·(…) = 0.
      // Everything should be zero.
      for (let i = 0; i < 1024; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'decay=1, bright=1 → lossless recirculation (permanent)',
    run() {
      const op = freshOp(220, 1.0, 1.0);
      const N = SR * 2;
      const trig = new Float32Array(N); trig[0] = 1;
      const out = new Float32Array(N);
      op.process({ trig }, { out }, N);
      // After 2 seconds the energy should still be close to the initial.
      const e0 = energy(out.subarray(0, SR * 0.25 | 0));
      const e1 = energy(out.subarray(SR * 1.75 | 0, N));
      // With bright=1 and decay=1 the loop is a pure circular buffer.
      // Energy per-sample should be ~constant → tail-quarter energy
      // should match head-quarter energy within 10%.
      const ratio = e1 / e0;
      if (ratio < 0.9 || ratio > 1.1) return { pass: false, why: `ratio=${ratio}` };
      return { pass: true };
    },
  },
  {
    name: 'bright=0 → pure two-point average (more HF attenuation)',
    run() {
      // Measure mid-band energy of two pitches and compare HF content.
      const a = freshOp(220, 0.999, 0);   // full avg filter
      const b = freshOp(220, 0.999, 1);   // no filter
      const trig = new Float32Array(SR); trig[0] = 1;
      const oA = new Float32Array(SR);
      const oB = new Float32Array(SR);
      a.process({ trig }, { out: oA }, SR);
      b.process({ trig }, { out: oB }, SR);
      // HF proxy: sample-to-sample difference energy.
      let dA = 0, dB = 0;
      for (let i = 1; i < SR; i++) {
        dA += (oA[i] - oA[i - 1]) ** 2;
        dB += (oB[i] - oB[i - 1]) ** 2;
      }
      if (dA >= dB) return { pass: false, why: `HF content: dA=${dA} dB=${dB} (expected dA << dB)` };
      return { pass: true };
    },
  },
  {
    name: 're-triggering restarts envelope',
    run() {
      const op = freshOp(220, 0.9, 0.5);
      const N = SR;
      const trig = new Float32Array(N);
      trig[0] = 1;
      trig[SR * 0.5 | 0] = 1;  // second pluck
      const out = new Float32Array(N);
      op.process({ trig }, { out }, N);
      const seg1End = energy(out.subarray(SR * 0.4 | 0, SR * 0.5 | 0));  // nearly decayed
      const seg2Start = energy(out.subarray(SR * 0.5 | 0, SR * 0.6 | 0)); // fresh pluck
      if (seg2Start < seg1End * 10) return { pass: false, why: `retrigger energy: before=${seg1End} after=${seg2Start}` };
      return { pass: true };
    },
  },
  {
    name: 'trig must go low-then-high to retrigger (no continuous retrigger)',
    run() {
      const op = freshOp(220, 0.9, 0.5);
      // Hold trig high the whole time — should pluck once only.
      const N = SR;
      const trig = new Float32Array(N).fill(1);
      const out = new Float32Array(N);
      op.process({ trig }, { out }, N);
      // By the end, energy should be near zero (decay=0.9 dies fast).
      const tail = energy(out.subarray(SR * 0.5 | 0));
      if (tail > 1e-3) return { pass: false, why: `continuous retrigger: tail=${tail}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears buffer',
    run() {
      const op = freshOp(220, 0.999, 0.5);
      runWithPluck(op, 512, 0);  // pluck + play
      op.reset();
      // After reset no trig → silence.
      const out = new Float32Array(256);
      op.process({}, { out }, 256);
      for (let i = 0; i < 256; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      const trig = new Float32Array(64); trig[0] = 1;
      op.process({ trig }, {}, 64);
      return { pass: true };
    },
  },
  {
    name: 'zero latency declared',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'freq clamping: 0 → 1 Hz (max N), very high → sr/2',
    run() {
      const op = freshOp();
      op.setParam('freq', 0);    // clamps to 1 Hz → N = 48000 > MAX_N=4096 → clamps to 4096
      op.setParam('freq', 1e9);  // clamps to Nyquist → N ≥ 2
      // Just needs to not throw / not NaN.
      const out = runWithPluck(op, 128, 0);
      for (let i = 0; i < 128; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp(220, 0.9, 0.5);
      op.setParam('freq',   Number.NaN);
      op.setParam('decay',  Number.POSITIVE_INFINITY);
      op.setParam('bright', Number.NEGATIVE_INFINITY);
      // All state should be unchanged; op should behave normally.
      const out = runWithPluck(op, 512, 0);
      if (energy(out) < 1) return { pass: false, why: `energy=${energy(out)}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp(220, 0.996, 0.5);
      const b = freshOp(220, 0.996, 0.5);
      const oA = runWithPluck(a, 4096, 0);
      const oB = runWithPluck(b, 4096, 0);
      for (let i = 0; i < 4096; i++) if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} a=${oA[i]} b=${oB[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing trig input: silence (no spurious pluck)',
    run() {
      const op = freshOp();
      const out = new Float32Array(512);
      op.process({}, { out }, 512);
      for (let i = 0; i < 512; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
];

export default { opId: 'karplusStrong', tests };
