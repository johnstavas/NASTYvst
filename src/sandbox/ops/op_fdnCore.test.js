// op_fdnCore.test.js — real-math tests for op_fdnCore.
// Run via: node scripts/check_op_math.mjs
//
// Contract:
//   8-channel Geraint Luff FDN — Householder feedback + per-channel
//   1.5kHz HF shelf, exponential delays 100…200ms.
//   Latency = 0 (resonator).

import { FdnCoreOp } from './op_fdnCore.worklet.js';

const SR = 48000;

function freshOp({ decay = 0.5, hf = 0.7 } = {}) {
  const op = new FdnCoreOp(SR);
  op.reset();
  op.setParam('decay', decay);
  op.setParam('hf',    hf);
  return op;
}

function impulseBuf(n, amp = 1) {
  const buf = new Float32Array(n);
  buf[0] = amp;
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

// One-pole HP magnitude proxy: energy above ~1kHz (very rough band-split test).
// Signal passed through x - prevX filter (crude HP) then RMS'd.
function hpRms(buf, start, end) {
  let prev = 0, s = 0;
  for (let i = start; i < end; i++) {
    const d = buf[i] - prev;
    prev = buf[i];
    s += d * d;
  }
  return Math.sqrt(s / Math.max(1, end - start));
}

const tests = [
  {
    name: 'silence in → silence out',
    run() {
      const op = freshOp();
      const out = runBuf(op, new Float32Array(4096));
      for (let i = 0; i < 4096; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'impulse: tail builds and decays',
    run() {
      const op = freshOp({ decay: 0.5, hf: 0.7 });
      const n = 48000 * 4;  // 4 s
      const out = runBuf(op, impulseBuf(n, 1.0));
      // First 50ms = build-up (sparse echoes), mid = main body, late = tail.
      const eMid  = rms(out, SR * 0.1,  SR * 0.5);
      const eLate = rms(out, SR * 2,    SR * 3);
      if (eMid < 1e-5) return { pass: false, why: `mid energy=${eMid} too weak` };
      if (eLate >= eMid) return { pass: false, why: `no decay: mid=${eMid} late=${eLate}` };
      return { pass: true };
    },
  },
  {
    name: 'higher decay → longer tail',
    run() {
      const opLow  = freshOp({ decay: 0.2, hf: 0.7 });
      const opHigh = freshOp({ decay: 0.8, hf: 0.7 });
      const n = SR * 4;
      const oLow  = runBuf(opLow,  impulseBuf(n, 1));
      const oHigh = runBuf(opHigh, impulseBuf(n, 1));
      const eLow  = rms(oLow,  SR * 2, SR * 3);
      const eHigh = rms(oHigh, SR * 2, SR * 3);
      if (eHigh <= eLow * 2)
        return { pass: false, why: `decay knob didn't extend tail enough: low=${eLow} high=${eHigh}` };
      return { pass: true };
    },
  },
  {
    name: 'hf=0 damps HF faster than hf=1',
    run() {
      const opDark   = freshOp({ decay: 0.6, hf: 0.05 });
      const opBright = freshOp({ decay: 0.6, hf: 0.99 });
      const n = SR * 2;
      const oDark   = runBuf(opDark,   impulseBuf(n, 1));
      const oBright = runBuf(opBright, impulseBuf(n, 1));
      // Compare HF residual energy in the late portion.
      const hfDark   = hpRms(oDark,   SR * 1, SR * 2);
      const hfBright = hpRms(oBright, SR * 1, SR * 2);
      if (hfBright <= hfDark * 1.5)
        return { pass: false, why: `hf knob didn't separate spectra: dark=${hfDark} bright=${hfBright}` };
      return { pass: true };
    },
  },
  {
    name: 'freeze (decay≥0.99) sustains far longer than non-freeze',
    run() {
      // Compare freeze vs. a mid-decay setting over the same long window.
      // Freeze has g_dc≈0.9998 (~0.13dB/loop LF loss); a mid-decay setting
      // dies to noise in a few seconds. RMS ratio should be large.
      const n = SR * 3;
      const opFreeze = freshOp({ decay: 1.0, hf: 1.0 });
      const opMid    = freshOp({ decay: 0.5, hf: 1.0 });
      const oF = runBuf(opFreeze, impulseBuf(n, 1));
      const oM = runBuf(opMid,    impulseBuf(n, 1));
      const eF = rms(oF, SR * 2.5, SR * 3.0);
      const eM = rms(oM, SR * 2.5, SR * 3.0);
      if (eF < 1e-5) return { pass: false, why: `freeze tail died: eF=${eF}` };
      if (eF <= eM * 3)
        return { pass: false, why: `freeze didn't outlast mid-decay enough: freeze=${eF} mid=${eM}` };
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
    name: 'reset clears tail',
    run() {
      const op = freshOp({ decay: 0.8, hf: 0.8 });
      runBuf(op, impulseBuf(SR, 1));   // load state
      op.reset();
      const out = runBuf(op, new Float32Array(1024));
      for (let i = 0; i < 1024; i++) {
        if (out[i] !== 0) return { pass: false, why: `i=${i} out=${out[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing input: loaded state still rings',
    run() {
      const op = freshOp({ decay: 0.7, hf: 0.8 });
      // Load long enough that delay line contents have wrapped at least
      // once (shortest delay ≈ 100ms = 4800 samples @ 48k).
      runBuf(op, impulseBuf(SR / 2, 1));  // 0.5s load — well past first wrap
      const out = new Float32Array(SR);
      op.process({}, { out }, SR);
      const e = rms(out, 0, SR / 2);
      if (e < 1e-5) return { pass: false, why: `no ring-out: rms=${e}` };
      for (let i = 0; i < 4096; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} NaN` };
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
    name: 'param clamp: decay<0 / decay>1 / hf<0 / hf>1 bounded',
    run() {
      const op = freshOp();
      op.setParam('decay', -5);  // → 0
      op.setParam('hf',    -5);  // → 0
      let out = runBuf(op, impulseBuf(2048, 1));
      for (let i = 0; i < 2048; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} NaN` };
      op.setParam('decay', 5);   // → 1 (freeze)
      op.setParam('hf',    5);   // → 1
      out = runBuf(op, impulseBuf(2048, 1));
      for (let i = 0; i < 2048; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} NaN (hi)` };
      return { pass: true };
    },
  },
  {
    name: 'non-finite params ignored',
    run() {
      const op = freshOp({ decay: 0.5, hf: 0.7 });
      op.setParam('decay', Number.NaN);
      op.setParam('hf',    Number.POSITIVE_INFINITY);
      // Decay/hf should still be the pre-NaN values → tail should behave normally.
      const out = runBuf(op, impulseBuf(SR, 1));
      const e = rms(out, SR * 0.1, SR * 0.5);
      if (e < 1e-5) return { pass: false, why: `nan param corrupted: e=${e}` };
      return { pass: true };
    },
  },
  {
    name: 'stability: loud noise stays finite',
    run() {
      const op = freshOp({ decay: 0.95, hf: 0.9 });
      const n = SR * 2;
      const inBuf = new Float32Array(n);
      let seed = 11;
      for (let i = 0; i < n; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        inBuf[i] = ((seed / 0xffffffff) * 2 - 1);
      }
      const out = runBuf(op, inBuf);
      for (let i = 0; i < n; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i} NaN/inf` };
      // Energy should remain bounded (< ~10× input RMS).
      const eIn  = rms(inBuf);
      const eOut = rms(out, n - SR, n);
      if (eOut > eIn * 20) return { pass: false, why: `energy runaway: in=${eIn} out=${eOut}` };
      return { pass: true };
    },
  },
  {
    name: 'deterministic: identical output across fresh instances',
    run() {
      const a = freshOp({ decay: 0.6, hf: 0.5 });
      const b = freshOp({ decay: 0.6, hf: 0.5 });
      const inBuf = impulseBuf(4096, 1);
      const oA = runBuf(a, inBuf);
      const oB = runBuf(b, inBuf);
      for (let i = 0; i < oA.length; i++) {
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i} a=${oA[i]} b=${oB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'energy grows during first ~200ms (FDN build-up)',
    run() {
      const op = freshOp({ decay: 0.7, hf: 0.8 });
      const n = SR;
      const out = runBuf(op, impulseBuf(n, 1));
      // Very early (first delay = 100ms) vs mid build (200ms).
      const eVeryEarly = rms(out, 0,             Math.round(SR * 0.05));
      const eBuild     = rms(out, Math.round(SR * 0.15), Math.round(SR * 0.25));
      if (eBuild <= eVeryEarly)
        return { pass: false, why: `no FDN build-up: very-early=${eVeryEarly} build=${eBuild}` };
      return { pass: true };
    },
  },
];

export default { opId: 'fdnCore', tests };
