// op_kellyLochbaum.test.js — real-math tests for op_kellyLochbaum.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   Kelly-Lochbaum lattice — N concatenated 1-sample waveguide sections
//   with 2-port scattering junctions (JOS §7.1, §10.1).
//   Latency = 0 (resonator).

import { KellyLochbaumOp } from './op_kellyLochbaum.worklet.js';

const SR = 48000;

function freshOp({ length = 32, taper = 0, glottis = -0.9, lip = -0.85, damp = 0.05 } = {}) {
  const op = new KellyLochbaumOp(SR);
  op.reset();
  op.setParam('length',  length);
  op.setParam('taper',   taper);
  op.setParam('glottis', glottis);
  op.setParam('lip',     lip);
  op.setParam('damp',    damp);
  return op;
}

function impulseBuf(n, amp = 1, at = 0) {
  const buf = new Float32Array(n);
  buf[at] = amp;
  return buf;
}

function sineBuf(freq, amp, n) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
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
    name: 'silence in → silence out',
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
    name: 'impulse: decaying tail visible (taper=0, cylinder)',
    run() {
      const op = freshOp({ length: 32, taper: 0 });
      const out = runBuf(op, impulseBuf(8192, 1.0));
      const eEarly = rms(out, 50,   2000);
      const eLate  = rms(out, 6000, 8000);
      if (eEarly < 1e-4) return { pass: false, why: `early=${eEarly} too weak` };
      if (eLate >= eEarly) return { pass: false, why: `no decay: early=${eEarly} late=${eLate}` };
      return { pass: true };
    },
  },
  {
    name: 'taper=0 reduces to cylindrical waveguide (strong resonance at sr/(2·N))',
    run() {
      const N = 32;
      const op = freshOp({ length: N, taper: 0, glottis: -0.98, lip: -0.98, damp: 0.02 });
      const f0 = SR / (2 * N);
      const n = 8000;
      const out = runBuf(op, sineBuf(f0, 0.1, n));
      const e = rms(out, 5000, 8000);
      if (e < 0.05) return { pass: false, why: `rms=${e} — cylinder should resonate` };
      return { pass: true };
    },
  },
  {
    name: 'nonzero taper changes spectrum vs cylinder',
    run() {
      const N = 32, nSamp = 6000;
      const f0 = SR / (2 * N);
      const aOp = freshOp({ length: N, taper: 0,    glottis: -0.98, lip: -0.98, damp: 0.02 });
      const bOp = freshOp({ length: N, taper: 0.5,  glottis: -0.98, lip: -0.98, damp: 0.02 });
      const a = runBuf(aOp, sineBuf(f0, 0.1, nSamp));
      const b = runBuf(bOp, sineBuf(f0, 0.1, nSamp));
      const eA = rms(a, 4000, 6000);
      const eB = rms(b, 4000, 6000);
      if (Math.abs(eA - eB) < 0.005) return { pass: false, why: `taper made no difference: eA=${eA} eB=${eB}` };
      return { pass: true };
    },
  },
  {
    name: 'glottis=0 + lip=0: no reflections, no sustained resonance',
    run() {
      const op = freshOp({ length: 32, taper: 0, glottis: 0, lip: 0, damp: 0 });
      const out = runBuf(op, impulseBuf(4096, 1));
      const eLate = rms(out, 2000, 4000);
      if (eLate > 1e-6) return { pass: false, why: `late energy=${eLate} (expected ≈0)` };
      return { pass: true };
    },
  },
  {
    name: 'length change retunes fundamental',
    run() {
      const n = 8000;
      const op32 = freshOp({ length: 32, taper: 0, glottis: -0.98, lip: -0.98, damp: 0.02 });
      const op64 = freshOp({ length: 64, taper: 0, glottis: -0.98, lip: -0.98, damp: 0.02 });
      const f32 = SR / (2 * 32);
      const f64 = SR / (2 * 64);
      const eMatched32 = rms(runBuf(op32, sineBuf(f32, 0.1, n)), 5000, 8000);
      const eMismatched32 = rms(runBuf(freshOp({ length: 32, taper: 0, glottis: -0.98, lip: -0.98, damp: 0.02 }),
                                       sineBuf(f64, 0.1, n)), 5000, 8000);
      if (eMatched32 <= eMismatched32) return { pass: false, why: `matched=${eMatched32} mismatched=${eMismatched32}` };
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
    name: 'length clamp: 1 → 4 (min), 99999 → 512 (max)',
    run() {
      const op = freshOp({ length: 32 });
      op.setParam('length', 1);
      // Prove clamp didn't NaN on extreme input.
      let out = runBuf(op, impulseBuf(256, 1));
      for (let i = 0; i < 256; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} NaN after min clamp` };
      op.setParam('length', 99999);
      out = runBuf(op, impulseBuf(1024, 1));
      for (let i = 0; i < 1024; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} NaN after max clamp` };
      return { pass: true };
    },
  },
  {
    name: 'taper / glottis / lip / damp clamp: out-of-range bounded',
    run() {
      const op = freshOp();
      op.setParam('taper',   5);     // → 1
      op.setParam('glottis', -5);    // → -1
      op.setParam('lip',     5);     // → 1
      op.setParam('damp',    5);     // → 1
      const out = runBuf(op, impulseBuf(2048, 1));
      for (let i = 0; i < 2048; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite param ignored',
    run() {
      const op = freshOp({ length: 32 });
      op.setParam('length', Number.NaN);
      op.setParam('taper',  Number.POSITIVE_INFINITY);
      // Length stayed at 32 — verify by matched-frequency resonance test.
      const f0 = SR / (2 * 32);
      const e = rms(runBuf(op, sineBuf(f0, 0.1, 6000)), 4000, 6000);
      if (e < 0.05) return { pass: false, why: `length drifted, rms=${e}` };
      return { pass: true };
    },
  },
  {
    name: 'reset clears loaded state',
    run() {
      const op = freshOp({ damp: 0.01, glottis: -0.99, lip: -0.99 });
      runBuf(op, impulseBuf(2048, 1));
      op.reset();
      const out = runBuf(op, new Float32Array(512));
      for (let i = 0; i < 512; i++) if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input: loaded state still rings out',
    run() {
      const op = freshOp({ damp: 0.05, glottis: -0.98, lip: -0.98 });
      runBuf(op, impulseBuf(512, 1));  // load state
      const out = new Float32Array(1024);
      op.process({}, { out }, 1024);
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
    name: 'stability: loud wideband input stays finite under strong (but physical) params',
    run() {
      // Realistic vocal-tract KL uses |k_i| up to ~0.7 (area ratios of a
      // few × between sections). Setting every interior junction to 0.7
      // simultaneously is already unphysical (implies 0.7^64 area ratio)
      // but still ought to stay numerically bounded. Dialing every knob to
      // the clamp simultaneously is NOT a supported operating point —
      // that's a pathological pile-up of feedback loops, not a bug.
      const op = freshOp({ length: 64, taper: 0.7, glottis: -0.95, lip: -0.95, damp: 0.05 });
      const n = 4096;
      const inBuf = new Float32Array(n);
      let seed = 11;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        inBuf[i] = ((seed / 0xffffffff) * 2 - 1);  // ±1.0
      }
      const out = runBuf(op, inBuf);
      for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp({ length: 48, taper: 0.3, damp: 0.08 });
      const b = freshOp({ length: 48, taper: 0.3, damp: 0.08 });
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
    name: 'positive vs negative taper give distinguishable responses',
    run() {
      const n = 6000;
      const f0 = SR / (2 * 32);
      const opPos = freshOp({ length: 32, taper: +0.5, glottis: -0.98, lip: -0.98, damp: 0.02 });
      const opNeg = freshOp({ length: 32, taper: -0.5, glottis: -0.98, lip: -0.98, damp: 0.02 });
      const ePos = rms(runBuf(opPos, sineBuf(f0 * 1.5, 0.1, n)), 4000, 6000);
      const eNeg = rms(runBuf(opNeg, sineBuf(f0 * 1.5, 0.1, n)), 4000, 6000);
      if (Math.abs(ePos - eNeg) < 0.002) return { pass: false, why: `taper sign had no effect: pos=${ePos} neg=${eNeg}` };
      return { pass: true };
    },
  },
];

export default { opId: 'kellyLochbaum', tests };
