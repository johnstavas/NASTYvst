// op_waveguide.test.js — real-math tests for op_waveguide.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Bidirectional lossy digital waveguide. JOS §4.3–§4.5.
//   Two delay lines of length L = round(sr/(2·freq)) with reflect + damp
//   terminations. Latency = 0 (resonator, not analyzer).

import { WaveguideOp } from './op_waveguide.worklet.js';

const SR = 48000;

function freshOp({ freq = 220, reflL = 0.98, reflR = 0.98, damp = 0.1 } = {}) {
  const op = new WaveguideOp(SR);
  op.reset();
  op.setParam('freq',  freq);
  op.setParam('reflL', reflL);
  op.setParam('reflR', reflR);
  op.setParam('damp',  damp);
  return op;
}

function sineBuf(freq, amp, n) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  return buf;
}

function impulseBuf(n, amp = 1, at = 0) {
  const buf = new Float32Array(n);
  buf[at] = amp;
  return buf;
}

function runBuf(op, inBuf) {
  const out = new Float32Array(inBuf.length);
  op.process({ in: inBuf }, { out }, inBuf.length);
  return out;
}

function rms(buf, start = 0, end = buf.length) {
  let s = 0;
  for (let i = start; i < end; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

const tests = [
  {
    name: 'silence in → silence out (no excitation)',
    run() {
      const op = freshOp();
      const out = runBuf(op, new Float32Array(1024));
      for (let i = 0; i < 1024; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse excitation: decaying tail visible',
    run() {
      const op = freshOp({ freq: 220, reflL: 0.98, reflR: 0.98, damp: 0.1 });
      const out = runBuf(op, impulseBuf(8192, 1.0));
      // Tail in samples 500..2000 should have detectable energy.
      const eEarly = rms(out, 100,   2000);
      const eLate  = rms(out, 6000,  8000);
      if (eEarly < 1e-4) return { pass: false, why: `early tail too weak: ${eEarly}` };
      if (eLate >= eEarly) return { pass: false, why: `no decay: early=${eEarly} late=${eLate}` };
      return { pass: true };
    },
  },
  {
    name: 'lossless-ish (refl=1, damp=0) holds energy longer than lossy',
    run() {
      const a = freshOp({ freq: 220, reflL: 1.0, reflR: 1.0, damp: 0 });
      const b = freshOp({ freq: 220, reflL: 0.5, reflR: 0.5, damp: 0.5 });
      const oA = runBuf(a, impulseBuf(4096, 1));
      const oB = runBuf(b, impulseBuf(4096, 1));
      const eA = rms(oA, 2000, 4000);
      const eB = rms(oB, 2000, 4000);
      if (eA <= eB) return { pass: false, why: `lossless eA=${eA} vs lossy eB=${eB}` };
      return { pass: true };
    },
  },
  {
    name: 'refl=0 + damp=1: no sustained resonance',
    run() {
      const op = freshOp({ freq: 220, reflL: 0, reflR: 0, damp: 1 });
      const out = runBuf(op, impulseBuf(4096, 1));
      // Without reflection, impulse exits on first pass. Late tail = 0.
      const eLate = rms(out, 2000, 4000);
      if (eLate > 1e-6) return { pass: false, why: `late energy=${eLate} (expected ≈0)` };
      return { pass: true };
    },
  },
  {
    name: 'resonant drive at fundamental produces gain',
    run() {
      // For a symmetric closed-closed waveguide with small losses, there's
      // strong standing-wave build-up at f0 = sr/(2L). With L = round(sr/(2·220))
      // at sr=48000 → L = 109 → f0 ≈ 220.18 Hz.
      const op = freshOp({ freq: 220, reflL: 0.99, reflR: 0.99, damp: 0.05 });
      const L = Math.round(SR / (2 * 220));
      const f0 = SR / (2 * L);
      const N = 12000;  // let resonance build
      const out = runBuf(op, sineBuf(f0, 0.1, N));
      // Output RMS after build-up >> input RMS 0.1/√2 ≈ 0.0707
      const eOut = rms(out, 8000, 12000);
      if (eOut < 0.15) return { pass: false, why: `resonant gain insufficient: rms=${eOut}` };
      return { pass: true };
    },
  },
  {
    name: 'off-resonance drive yields much smaller response than on-resonance',
    run() {
      const L = Math.round(SR / (2 * 220));
      const f0 = SR / (2 * L);
      const opOn  = freshOp({ freq: 220, reflL: 0.99, reflR: 0.99, damp: 0.05 });
      const opOff = freshOp({ freq: 220, reflL: 0.99, reflR: 0.99, damp: 0.05 });
      const N = 12000;
      const onOut  = runBuf(opOn,  sineBuf(f0,      0.1, N));
      const offOut = runBuf(opOff, sineBuf(f0 * 1.37, 0.1, N));  // off-resonance
      const eOn  = rms(onOut,  8000, 12000);
      const eOff = rms(offOut, 8000, 12000);
      if (eOff >= eOn * 0.5) return { pass: false, why: `off=${eOff} on=${eOn}` };
      return { pass: true };
    },
  },
  {
    name: 'freq param change retunes fundamental',
    run() {
      const L1 = Math.round(SR / (2 * 220));
      const L2 = Math.round(SR / (2 * 440));
      if (L1 === L2) return { pass: false, why: 'L unchanged — test is a no-op' };
      const op = freshOp({ freq: 220 });
      op.setParam('freq', 440);
      // Drive at new f0; should resonate, not dampen.
      const f0 = SR / (2 * L2);
      const N = 8000;
      const out = runBuf(op, sineBuf(f0, 0.1, N));
      const e = rms(out, 5000, 8000);
      if (e < 0.1) return { pass: false, why: `retune failed: rms=${e}` };
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() = 0',
    run() {
      const op = freshOp();
      if (op.getLatencySamples() !== 0) return { pass: false, why: `got ${op.getLatencySamples()}` };
      return { pass: true };
    },
  },
  {
    name: 'freq clamp: below 20 Hz and above sr/8',
    run() {
      const op = freshOp();
      op.setParam('freq', 1);       // clamps to 20
      op.setParam('freq', 1e9);     // clamps to sr/8 = 6000
      // Just verify no NaN / no crash.
      const out = runBuf(op, sineBuf(1000, 0.1, 1024));
      for (let i = 0; i < 1024; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'refl / damp clamp: out-of-range values bounded',
    run() {
      const op = freshOp();
      op.setParam('reflL', 5);       // → 1
      op.setParam('reflR', -5);      // → −1
      op.setParam('damp',  5);       // → 1
      const out = runBuf(op, impulseBuf(2048, 1));
      for (let i = 0; i < 2048; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp();
      op.setParam('freq',  Number.NaN);
      op.setParam('reflL', Number.POSITIVE_INFINITY);
      op.setParam('damp',  Number.NEGATIVE_INFINITY);
      // State unchanged — still resonates at 220.
      const L  = Math.round(SR / (2 * 220));
      const f0 = SR / (2 * L);
      const out = runBuf(op, sineBuf(f0, 0.1, 8000));
      const e = rms(out, 5000, 8000);
      if (e < 0.15) return { pass: false, why: `freq drift? rms=${e}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears loaded state',
    run() {
      const op = freshOp({ damp: 0.01, reflL: 0.99, reflR: 0.99 });
      runBuf(op, impulseBuf(2048, 1));
      op.reset();
      // Post-reset with silent input → zero output.
      const out = runBuf(op, new Float32Array(512));
      for (let i = 0; i < 512; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: loaded state still rings out',
    run() {
      const op = freshOp({ damp: 0.05, reflL: 0.98, reflR: 0.98 });
      runBuf(op, impulseBuf(512, 1));  // load state
      const out = new Float32Array(1024);
      op.process({}, { out }, 1024);
      // Missing input → zero excitation, but existing state should still ring.
      const e = rms(out, 0, 512);
      if (e < 1e-5) return { pass: false, why: `no ring-out: rms=${e}` };
      for (let i = 0; i < 1024; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing output buffer is a no-op',
    run() {
      const op = freshOp();
      op.process({ in: impulseBuf(128, 1) }, {}, 128);
      return { pass: true };
    },
  },
  {
    name: 'stability: loud wideband input stays finite',
    run() {
      const op = freshOp({ reflL: 0.99, reflR: 0.99, damp: 0.02 });
      const n = 4096;
      const inBuf = new Float32Array(n);
      let seed = 7;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        inBuf[i] = ((seed / 0xffffffff) * 2 - 1) * 2.0;  // ±2.0 loud
      }
      const out = runBuf(op, inBuf);
      for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp({ freq: 330, damp: 0.08 });
      const b = freshOp({ freq: 330, damp: 0.08 });
      const inBuf = impulseBuf(2048, 1);
      const oA = runBuf(a, inBuf);
      const oB = runBuf(b, inBuf);
      for (let i = 0; i < oA.length; i++) {
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} a=${oA[i]} b=${oB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'sign flip on reflL changes resonant spectrum',
    run() {
      // Open-closed tube (one flipped reflection) has odd-only harmonics,
      // so drive at f0 excites; drive at 2·f0 does NOT.
      // Closed-closed (both positive) excites at all multiples of f0.
      // We just verify the two configs give different output energies
      // for the same drive, proving reflection sign matters.
      const L  = Math.round(SR / (2 * 220));
      const f0 = SR / (2 * L);
      const opCC = freshOp({ freq: 220, reflL: +0.98, reflR: +0.98, damp: 0.05 });
      const opOC = freshOp({ freq: 220, reflL: -0.98, reflR: +0.98, damp: 0.05 });
      const N = 8000;
      const drive = sineBuf(2 * f0, 0.1, N);
      const eCC = rms(runBuf(opCC, drive), 5000, 8000);
      const eOC = rms(runBuf(opOC, drive), 5000, 8000);
      if (Math.abs(eCC - eOC) < 0.005) return { pass: false, why: `sign flip had no effect: CC=${eCC} OC=${eOC}` };
      return { pass: true };
    },
  },
];

export default { opId: 'waveguide', tests };
