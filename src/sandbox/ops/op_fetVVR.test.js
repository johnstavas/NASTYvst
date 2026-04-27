// op_fetVVR.test.js — math + stress tests for op_fetVVR.
// Run via: node scripts/check_op_math.mjs
//
// Phenomenological JFET-VVR GR cell (UREI 1176). Memoryless. Tier-S
// character op — 15-20 tests target.

import { FetVVROp } from './op_fetVVR.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new FetVVROp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function runBlocks(op, totalN, audioBuf, cvBuf) {
  const out = new Float32Array(totalN);
  let pos = 0;
  while (pos < totalN) {
    const n = Math.min(N, totalN - pos);
    const inputs = {};
    if (audioBuf) inputs.audio = audioBuf.subarray(pos, pos + n);
    if (cvBuf)    inputs.cv    = cvBuf.subarray(pos, pos + n);
    op.process(inputs, { out: out.subarray(pos, pos + n) }, n);
    pos += n;
  }
  return out;
}

function rms(x, start, end) {
  let s = 0; const n = end - start;
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

function bin(x, start, end, f, sr) {
  const N = end - start;
  let re = 0, im = 0;
  const w = 2 * Math.PI * f / sr;
  for (let i = 0; i < N; i++) {
    re += x[start + i] * Math.cos(w * i);
    im -= x[start + i] * Math.sin(w * i);
  }
  return 2 * Math.sqrt(re * re + im * im) / N;
}

function intCycleWindow(sr, fundamental, approxLen) {
  const period = sr / fundamental;
  const cycles = Math.round(approxLen / period);
  return Math.round(cycles * period);
}

const tests = [
  // ---- correctness: identity ----------------------------------------------
  {
    name: 'cv=0 → output = audio (unity gain, no compression)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: out=${out[i]} vs audio=${audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv < 0 → unity gain (FET only attenuates on positive control commands)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
      cv.fill(-10);
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: negative cv should be ignored` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: gain curve (sharper than vari-mu) ---------------------
  {
    name: 'cv = cutoffScale → gain = 0.5 (-6 dB) at default β=2',
    run() {
      const op = freshOp({ distortion2H: 0, distortion3H: 0 });  // clean for measurement
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      cv.fill(5);  // = cutoffScale
      const out = runBlocks(op, total, audio, cv);
      // gain = 1/(1 + 1^2) = 0.5; expected out = 0.5 * 0.5 = 0.25
      if (!approx(out[100], 0.25, 1e-4)) return { pass: false, why: `out[100]=${out[100]} expected 0.25` };
      return { pass: true };
    },
  },
  {
    name: 'gain curve monotonic: cv=0..40 produces decreasing gain',
    run() {
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      const cvValues = [0, 2, 5, 10, 20, 40];
      const gains = [];
      for (const cvVal of cvValues) {
        const op = freshOp({ distortion2H: 0, distortion3H: 0 });
        const cv = new Float32Array(total);
        cv.fill(cvVal);
        const out = runBlocks(op, total, audio, cv);
        gains.push(out[100] / 0.5);
      }
      for (let i = 1; i < gains.length; i++) {
        if (gains[i] >= gains[i - 1]) return { pass: false, why: `not monotonic: ${gains}` };
      }
      // cv=0 → 1.0; cv=cutoff → 0.5; cv=2*cutoff → 1/(1+4)=0.2
      if (!approx(gains[0], 1.0, 1e-6)) return { pass: false, why: `cv=0: gain=${gains[0]}` };
      if (!approx(gains[2], 0.5, 1e-3)) return { pass: false, why: `cv=cutoff: gain=${gains[2]}` };
      if (!approx(gains[3], 0.2, 0.02)) return { pass: false, why: `cv=2*cutoff: gain=${gains[3]} expected 0.2` };
      return { pass: true };
    },
  },
  {
    name: 'fetVVR knee SHARPER than varMuTube at same comprDepth',
    run() {
      // FET default β=2 vs varMuTube β=1.5 → fetVVR should compress more
      // aggressively below cutoff (sharper knee).
      // At cv=cutoffScale: both have gain=0.5 (knee point — same).
      // At cv=2·cutoffScale: fetVVR gain = 1/(1+4)=0.2; varMuTube gain = 1/(1+2.83)=0.261
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(0.5);
      // Both ops share the same cutoffScale=10, but use different β.
      const opFet  = freshOp({ cutoffScale: 10, curveExponent: 2.0, distortion2H: 0, distortion3H: 0 });
      const opSoft = freshOp({ cutoffScale: 10, curveExponent: 1.5, distortion2H: 0, distortion3H: 0 });
      const cv = new Float32Array(total);
      cv.fill(20);  // 2× cutoff
      const outFet  = runBlocks(opFet,  total, audio, cv);
      const outSoft = runBlocks(opSoft, total, audio, cv);
      const gFet  = outFet[100]  / 0.5;
      const gSoft = outSoft[100] / 0.5;
      // fetVVR (β=2) should produce LESS gain at 2× cutoff than β=1.5.
      if (gFet >= gSoft) return { pass: false, why: `β=2 gain ${gFet} should be < β=1.5 gain ${gSoft} at 2× cutoff` };
      return { pass: true };
    },
  },

  // ---- correctness: distortion (mixed 2H + 3H) ----------------------------
  {
    name: 'distortion2H + distortion3H = 0 → clean output (no harmonics)',
    run() {
      const op = freshOp({ distortion2H: 0, distortion3H: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(20);  // heavy compression
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      if (mag2 > 1e-5) return { pass: false, why: `2H = ${mag2} (expected ~0)` };
      if (mag3 > 1e-5) return { pass: false, why: `3H = ${mag3} (expected ~0)` };
      return { pass: true };
    },
  },
  {
    name: 'distortion2H>0 produces 2H + 4H (even-only when distortion3H=0)',
    run() {
      const op = freshOp({ distortion2H: 0.3, distortion3H: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(10);  // moderate compression
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      const mag4 = bin(out, 0, total, 4 * f, SR);
      if (mag2 < 1e-3) return { pass: false, why: `2H = ${mag2} (expected nonzero)` };
      if (mag3 > 1e-4) return { pass: false, why: `3H = ${mag3} (expected ~0 with distortion3H=0)` };
      if (mag4 < 1e-5) return { pass: false, why: `4H = ${mag4} (expected nonzero)` };
      return { pass: true };
    },
  },
  {
    name: 'distortion3H>0 produces 3H + 5H (odd-only when distortion2H=0)',
    run() {
      const op = freshOp({ distortion2H: 0, distortion3H: 0.3 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      cv.fill(10);
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      const mag5 = bin(out, 0, total, 5 * f, SR);
      if (mag2 > 1e-4) return { pass: false, why: `2H = ${mag2} (expected ~0 with distortion2H=0)` };
      if (mag3 < 1e-4) return { pass: false, why: `3H = ${mag3} (expected nonzero)` };
      if (mag5 < 1e-6) return { pass: false, why: `5H = ${mag5} (expected nonzero)` };
      return { pass: true };
    },
  },
  {
    name: 'mixed: distortion2H + distortion3H both > 0 → both 2H AND 3H present',
    run() {
      // Use moderate compression + moderate amplitude to get both 2H and 3H
      // measurable. y_odd = d3 · comprDepth · y · |y| has y² scaling, so 3H
      // amplitude shrinks fast at heavy compression. Use cv=3 (gain ≈ 0.74)
      // and amplitude 0.8 to give the cubic-like odd term enough headroom.
      const op = freshOp({ cutoffScale: 5, distortion2H: 0.3, distortion3H: 0.4 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.8;
      cv.fill(3);
      const out = runBlocks(op, total, audio, cv);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      // Both should be measurable above absolute threshold.
      if (mag2 < 5e-3) return { pass: false, why: `2H = ${mag2.toFixed(5)} (expected >5e-3)` };
      if (mag3 < 5e-4) return { pass: false, why: `3H = ${mag3.toFixed(5)} (expected >5e-4)` };
      return { pass: true };
    },
  },

  // ---- defensive ----------------------------------------------------------
  {
    name: 'missing audio input → silent output',
    run() {
      const op = freshOp({});
      const out = new Float32Array(N);
      try { op.process({}, { out }, N); } catch (e) { return { pass: false, why: `${e}` }; }
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'missing cv input → unity gain',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.4;
      const out = runBlocks(op, total, audio, null);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'missing output → no-op (no throw)',
    run() {
      const op = freshOp({});
      try { op.process({}, {}, N); } catch (e) { return { pass: false, why: `${e}` }; }
      return { pass: true };
    },
  },
  {
    name: 'NaN/inf params clamped: output stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['cutoffScale', 'curveExponent', 'distortion2H', 'distortion3H', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const audio = new Float32Array(N); audio.fill(0.5);
      const cv    = new Float32Array(N); cv.fill(10);
      const out = runBlocks(op, N, audio, cv);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN cv falls through to unity gain',
    run() {
      const op = freshOp({});
      const audio = new Float32Array(N); audio.fill(0.5);
      const cv    = new Float32Array(N); for (let i = 0; i < N; i++) cv[i] = NaN;
      const out = runBlocks(op, N, audio, cv);
      for (let i = 0; i < N; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: out=${out[i]}` };
        if (!approx(out[i], 0.5, 1e-7)) return { pass: false, why: `i=${i}: NaN cv didn't fall to unity` };
      }
      return { pass: true };
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // STRESS TESTS — Tier-S character op.
  // ════════════════════════════════════════════════════════════════════════

  {
    name: 'STRESS: block-boundary invariance — N=64/256/1024 produce identical output',
    run() {
      const total = 4096;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
        cv[i]    = 5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * i / SR));
      }
      function runWithBlock(blockN) {
        const op = freshOp({});
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(blockN, total - pos);
          op.process({ audio: audio.subarray(pos, pos + n), cv: cv.subarray(pos, pos + n) },
                     { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        return out;
      }
      const out64   = runWithBlock(64);
      const out256  = runWithBlock(256);
      const out1024 = runWithBlock(1024);
      for (let i = 0; i < total; i++) {
        if (!approx(out64[i], out256[i], 1e-7))   return { pass: false, why: `64 vs 256: i=${i}` };
        if (!approx(out256[i], out1024[i], 1e-7)) return { pass: false, why: `256 vs 1024: i=${i}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: long-run — 5 sec memoryless, period-aligned RMS match',
    run() {
      const total = SR * 5;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
        cv[i]    = 5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 1.0 * i / SR));
      }
      const op = freshOp({});
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
      const rmsA = rms(out, SR * 1, SR * 2);
      const rmsB = rms(out, SR * 4, SR * 5);
      if (!approx(rmsA, rmsB, 1e-6)) return { pass: false, why: `memoryless violation: rmsA=${rmsA} rmsB=${rmsB}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: SR-invariance — gain curve identical across 44.1/48/96k',
    run() {
      const rates = [44100, 48000, 96000];
      const gains = [];
      for (const sr of rates) {
        const op = new FetVVROp(sr);
        op.reset();
        op.setParam('distortion2H', 0); op.setParam('distortion3H', 0);
        const total = Math.round(sr * 0.05);
        const audio = new Float32Array(total);
        const cv    = new Float32Array(total);
        for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / sr) * 0.4;
        cv.fill(3);
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(N, total - pos);
          op.process({ audio: audio.subarray(pos, pos + n), cv: cv.subarray(pos, pos + n) },
                     { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        gains.push(rms(out, 100, total - 100) / rms(audio, 100, total - 100));
      }
      // gain at cv=3, β=2, V0=5: norm=0.6, norm^2=0.36, gain=1/(1+0.36)=0.735
      const expected = 1 / (1 + 0.6 * 0.6);
      for (const g of gains) {
        if (!approx(g, expected, 0.005)) return { pass: false, why: `g=${g} expected ${expected}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: state isolation — 3 parallel ops with different params',
    run() {
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 500 * i / SR) * 0.3;
      cv.fill(5);
      const opA = freshOp({ cutoffScale: 2,  distortion2H: 0.1 });
      const opB = freshOp({ cutoffScale: 10, distortion2H: 0.1 });
      const opC = freshOp({ cutoffScale: 5,  distortion2H: 0.4, distortion3H: 0.3 });  // "all buttons in"
      const outA = runBlocks(opA, total, audio, cv);
      const outB = runBlocks(opB, total, audio, cv);
      const outC = runBlocks(opC, total, audio, cv);
      let dAB = 0, dAC = 0;
      for (let i = 0; i < total; i++) {
        dAB += Math.abs(outA[i] - outB[i]);
        dAC += Math.abs(outA[i] - outC[i]);
      }
      if (dAB < 5) return { pass: false, why: `A≈B (diff=${dAB})` };
      if (dAC < 5) return { pass: false, why: `A≈C (diff=${dAC})` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: time-varying cv — gain tracks instantaneously (memoryless)',
    run() {
      const op = freshOp({ distortion2H: 0, distortion3H: 0 });
      const total = 1000;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      for (let i = 0; i < 500; i++) cv[i] = 0;
      for (let i = 500; i < total; i++) cv[i] = 10;
      const out = runBlocks(op, total, audio, cv);
      // pre-step: gain = 1 → out = 0.5
      if (!approx(out[100], 0.5, 1e-6)) return { pass: false, why: `pre-step out=${out[100]}` };
      // post-step: cv=10, V0=5, β=2: norm=2, norm^2=4, gain=1/5=0.2 → out=0.1
      const expected = 0.5 / (1 + 4);
      if (!approx(out[600], expected, 1e-4)) return { pass: false, why: `post-step out=${out[600]} expected ${expected}` };
      // Transition is instantaneous (memoryless).
      if (!approx(out[500], expected, 1e-4)) return { pass: false, why: `transition out[500]=${out[500]} expected ${expected}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: "all buttons in" character — 2H prominent, 3H measurable',
    run() {
      // Named-gear claim: 1176 "all buttons in" produces "substantial increase
      // of harmonic distortion" with both even and odd content. The y·|y|
      // odd-harmonic term scales as A² so 3H is intrinsically lower than 2H
      // at all but the very lowest compression. Verify both present, with
      // 2H > 5% and 3H > 0.3% of fundamental at moderate-heavy compression.
      const op = freshOp({ cutoffScale: 5, distortion2H: 0.4, distortion3H: 0.4 });
      const f = 500;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.8;
      cv.fill(5);  // moderate compression (gain = 0.5, comprDepth = 0.5)
      const out = runBlocks(op, total, audio, cv);
      const mag1 = bin(out, 0, total, f,     SR);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      const ratio2 = mag2 / mag1;
      const ratio3 = mag3 / mag1;
      if (ratio2 < 0.05) return { pass: false, why: `2H/1H=${ratio2.toFixed(4)} (expected >0.05)` };
      if (ratio3 < 0.003) return { pass: false, why: `3H/1H=${ratio3.toFixed(5)} (expected >0.003)` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: distortion couples with comprDepth (harmonics rise with GR)',
    run() {
      // Vari-mu-style signature: more compression → more 2H/3H/1H ratio.
      const f = 500;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      // Light cv=2, gain ≈ 1/(1+0.16)=0.862, comprDepth=0.138
      const opLight = freshOp({ distortion2H: 0.3 });
      const cvLight = new Float32Array(total); cvLight.fill(2);
      const outLight = runBlocks(opLight, total, audio, cvLight);
      const mag1L = bin(outLight, 0, total, f,     SR);
      const mag2L = bin(outLight, 0, total, 2 * f, SR);
      const ratioL = mag2L / mag1L;
      // Heavy cv=15, gain ≈ 1/(1+9)=0.1, comprDepth=0.9
      const opHeavy = freshOp({ distortion2H: 0.3 });
      const cvHeavy = new Float32Array(total); cvHeavy.fill(15);
      const outHeavy = runBlocks(opHeavy, total, audio, cvHeavy);
      const mag1H = bin(outHeavy, 0, total, f,     SR);
      const mag2H = bin(outHeavy, 0, total, 2 * f, SR);
      const ratioH = mag2H / mag1H;
      if (ratioH <= ratioL) {
        return { pass: false, why: `light=${ratioL.toFixed(4)} heavy=${ratioH.toFixed(4)} — should rise with GR` };
      }
      return { pass: true };
    },
  },
];

export default { opId: 'fetVVR', tests };
