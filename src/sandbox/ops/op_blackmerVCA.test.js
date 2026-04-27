// op_blackmerVCA.test.js — math + stress tests for op_blackmerVCA.
// Run via: node scripts/check_op_math.mjs
//
// Log-add-antilog VCA per Blackmer US Patent 3,714,462. Memoryless.
// Tier-S character op (named-gear class) — 15-20 tests target per
// sandbox_op_ship_protocol.md §5.1.
//
// Tests cover:
//  - Identity at cv=0, bias=0, trim=0 (perfect multiplier)
//  - Gain control: cv=+6 dB → ×2.0, cv=−6 dB → ×0.5, cv=+20 → ×10
//  - Patent-claimed ±50 dB range stays bounded
//  - bias=0 produces zero 2nd harmonic (clean multiplier)
//  - bias>0 produces measurable signed 2nd harmonic
//  - bias sign: positive vs negative produce sign-flipped 2H
//  - trim adds gain consistently in dB
//  - cv as audio-rate signal (time-varying gain)
//  - missing audio → silence; missing cv → unity gain
//  - NaN/inf params clamped; cv NaN falls through to unity
//  - STRESS: block-invariance, long-run, SR-invariance,
//    multi-instance, large-signal, named-gear claim verification

import { BlackmerVCAOp } from './op_blackmerVCA.worklet.js';

const SR = 48000;
const N  = 256;
const approx = (a, b, eps) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new BlackmerVCAOp(SR);
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

// Goertzel-style single-bin DFT magnitude at frequency f (Hz) over [start..end].
// Returns the peak-amplitude estimate of the f-Hz component.
// NOTE: caller should pick window length so f·N/sr is integer (avoids leakage).
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

// Pick window length giving integer cycles for both 1H and 2H of `f`.
// At SR=48000, f=1000: period = 48 samples. Use multiple of 48.
function intCycleWindow(sr, fundamental, approxLen) {
  const period = sr / fundamental;
  const cycles = Math.round(approxLen / period);
  return Math.round(cycles * period);
}

const tests = [
  // ---- correctness: identity / gain ---------------------------------------
  {
    name: 'identity at cv=0, bias=0, trim=0 → out = audio exactly',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR);
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: out=${out[i]} vs audio=${audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv = +6 dB → output = audio × 2 (within float precision)',
    run() {
      const op = freshOp({});
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.3;
      cv.fill(6.0206);  // 20*log10(2) = 6.0206
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], 2 * audio[i], 1e-5)) return { pass: false, why: `i=${i}: out=${out[i]} expected ${2*audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv = −6 dB → output = audio × 0.5',
    run() {
      const op = freshOp({});
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.3;
      cv.fill(-6.0206);
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], 0.5 * audio[i], 1e-5)) return { pass: false, why: `i=${i}: out=${out[i]} expected ${0.5*audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv = +20 dB → output = audio × 10',
    run() {
      const op = freshOp({});
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.05;
      cv.fill(20.0);
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], 10 * audio[i], 1e-4)) return { pass: false, why: `i=${i}: out=${out[i]} expected ${10*audio[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: patent-claimed ±50 dB range ---------------------------
  {
    name: 'patent-claimed ±50 dB range — extreme cv stays finite & monotonic',
    run() {
      const total = 256;
      const audio = new Float32Array(total);
      audio.fill(1e-3);  // small input to avoid float overflow at +50 dB
      // Scan cv from −50 to +50 dB.
      const opMin  = freshOp({}); const cvMin  = new Float32Array(total); cvMin.fill(-50);
      const opZero = freshOp({}); const cvZero = new Float32Array(total); cvZero.fill(0);
      const opMax  = freshOp({}); const cvMax  = new Float32Array(total); cvMax.fill(50);
      const oMin  = runBlocks(opMin,  total, audio, cvMin);
      const oZero = runBlocks(opZero, total, audio, cvZero);
      const oMax  = runBlocks(opMax,  total, audio, cvMax);
      // Monotonic: oMin < oZero < oMax (in absolute value, one-sided).
      const aMin  = Math.abs(oMin[100]);
      const aZero = Math.abs(oZero[100]);
      const aMax  = Math.abs(oMax[100]);
      if (!(aMin < aZero && aZero < aMax)) return { pass: false, why: `non-monotonic: min=${aMin}, zero=${aZero}, max=${aMax}` };
      // Finiteness across the range.
      for (const o of [oMin, oZero, oMax]) {
        for (let i = 0; i < total; i++) if (!Number.isFinite(o[i])) return { pass: false, why: 'non-finite output' };
      }
      // Approximate gain ratios: oMax/oZero ≈ 10^2.5 ≈ 316, oZero/oMin ≈ 316.
      if (!approx(aMax / aZero, 316.23, 5)) return { pass: false, why: `+50 dB ratio = ${aMax/aZero} expected ~316` };
      if (!approx(aZero / aMin, 316.23, 5)) return { pass: false, why: `-50 dB ratio = ${aZero/aMin} expected ~316` };
      return { pass: true };
    },
  },

  // ---- correctness: bias / 2nd-harmonic ------------------------------------
  {
    name: 'bias=0 produces clean output — no 2nd harmonic on pure sine',
    run() {
      const op = freshOp({ bias: 0 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);  // integer cycles, no leakage
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, null);  // cv=0 default
      // Measure 2nd-harmonic bin (2 kHz). With integer cycles in window
      // and bias=0, 2H magnitude should be effectively zero.
      const mag2 = bin(out, 0, total, 2 * f, SR);
      if (mag2 > 1e-5) return { pass: false, why: `2H magnitude = ${mag2.toExponential(3)} (expected ~0 at bias=0)` };
      return { pass: true };
    },
  },
  {
    name: 'bias > 0 produces measurable 2nd harmonic on sine (true 2H, not 3H)',
    run() {
      const op = freshOp({ bias: 0.1 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, null);
      const mag1 = bin(out, 0, total, f,     SR);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const mag3 = bin(out, 0, total, 3 * f, SR);
      // For y = x + bias · |x|, with x = A·sin:
      // |x| Fourier: (2/π) − (4/3π)·cos(2ωt) − (4/15π)·cos(4ωt) − ...
      // → 2H peak amplitude = bias · A · 4/(3π) = 0.1 · 0.5 · 0.4244 ≈ 0.02122
      const expected2H = 0.1 * 0.5 * 4 / (3 * Math.PI);
      if (Math.abs(mag2 - expected2H) > 0.003) {
        return { pass: false, why: `2H = ${mag2.toFixed(5)} expected ${expected2H.toFixed(5)}` };
      }
      // 2H should be well below 1H.
      if (mag2 > mag1 * 0.1) return { pass: false, why: `2H/1H ratio = ${(mag2/mag1).toFixed(3)} (expected <0.1)` };
      // 3H should be near-zero (model produces only even harmonics).
      if (mag3 > 1e-4) return { pass: false, why: `3H = ${mag3.toExponential(3)} (expected ~0; model is even-symmetric)` };
      return { pass: true };
    },
  },
  {
    name: 'bias sign: +bias and −bias produce 2H of equal magnitude',
    run() {
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      const opP = freshOp({ bias:  0.1 });
      const opN = freshOp({ bias: -0.1 });
      const outP = runBlocks(opP, total, audio, null);
      const outN = runBlocks(opN, total, audio, null);
      const mag2P = bin(outP, 0, total, 2 * f, SR);
      const mag2N = bin(outN, 0, total, 2 * f, SR);
      // Magnitudes equal (bin returns |amplitude|), phases flipped 180°.
      if (!approx(mag2P, mag2N, 1e-5)) return { pass: false, why: `+bias 2H=${mag2P}, −bias 2H=${mag2N}` };
      return { pass: true };
    },
  },
  {
    name: 'bias produces DC offset (control feedthrough) — bias·A·2/π',
    run() {
      // Model: y = x + bias · |x|. |x| has DC = (2/π)·A for x=A·sin.
      // So output DC = bias · A · 2/π.
      const op = freshOp({ bias: 0.1 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, null);
      let dc = 0;
      for (let i = 0; i < total; i++) dc += out[i];
      dc /= total;
      const expectedDc = 0.1 * 0.5 * 2 / Math.PI;
      if (Math.abs(dc - expectedDc) > 0.001) {
        return { pass: false, why: `DC = ${dc.toFixed(5)} expected ${expectedDc.toFixed(5)}` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: trim --------------------------------------------------
  {
    name: 'trim = +6 dB doubles output',
    run() {
      const op = freshOp({ trim: 6.0206 });
      const total = 1024;
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.3;
      const out = runBlocks(op, total, audio, null);  // cv=0
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], 2 * audio[i], 1e-5)) return { pass: false, why: `i=${i}: out=${out[i]} expected ${2*audio[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'cv + trim compose: cv=+6 dB and trim=+6 dB → ×4',
    run() {
      const op = freshOp({ trim: 6.0206 });
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.1;
      cv.fill(6.0206);
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], 4 * audio[i], 1e-4)) return { pass: false, why: `i=${i}: out=${out[i]} expected ${4*audio[i]}` };
      }
      return { pass: true };
    },
  },

  // ---- correctness: time-varying cv ---------------------------------------
  {
    name: 'time-varying cv: ramp from −12 to +12 dB tracks instantaneously',
    run() {
      const op = freshOp({});
      const total = 4800;  // 0.1 sec
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      for (let i = 0; i < total; i++) cv[i] = -12 + 24 * (i / total);
      const out = runBlocks(op, total, audio, cv);
      // Sample at start, middle, end.
      const expStart = 0.5 * Math.pow(10, -12 / 20);
      const expMid   = 0.5 * Math.pow(10,   0 / 20);
      const expEnd   = 0.5 * Math.pow(10,  12 / 20);
      if (!approx(out[0],          expStart, 0.005)) return { pass: false, why: `start: out[0]=${out[0]} expected ${expStart}` };
      if (!approx(out[total/2|0],  expMid,   0.005)) return { pass: false, why: `mid: out=${out[total/2|0]} expected ${expMid}` };
      if (!approx(out[total - 1],  expEnd,   0.005)) return { pass: false, why: `end: out=${out[total-1]} expected ${expEnd}` };
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
      for (let i = 0; i < N; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: out=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing cv input → unity gain (cv=0 implicit)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.4;
      const out = runBlocks(op, total, audio, null);  // no cv
      for (let i = 0; i < total; i++) {
        if (!approx(out[i], audio[i], 1e-7)) return { pass: false, why: `i=${i}: out=${out[i]} vs audio=${audio[i]}` };
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
      for (const p of ['bias', 'trim']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const audio = new Float32Array(N); audio.fill(0.5);
      const out = runBlocks(op, N, audio, null);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN cv falls through to unity gain (no NaN propagation)',
    run() {
      const op = freshOp({});
      const total = N;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      audio.fill(0.5);
      for (let i = 0; i < total; i++) cv[i] = NaN;
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}: out=${out[i]}` };
        if (!approx(out[i], 0.5, 1e-7)) return { pass: false, why: `i=${i}: NaN cv didn't fall to unity (out=${out[i]})` };
      }
      return { pass: true };
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // STRESS TESTS — Tier-S character op (named-gear class).
  // Per sandbox_op_ship_protocol.md §5.1: 15-20 tests target.
  // Mandatory categories: NaN/inf, param boundary, named-gear claim verify.
  // Op is memoryless so block-invariance / determinism / reset are trivial
  // but tested for safety regression.
  // ════════════════════════════════════════════════════════════════════════

  {
    name: 'STRESS: block-boundary invariance — N=64/256/1024 produce identical output',
    run() {
      const total = 4096;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      for (let i = 0; i < total; i++) {
        audio[i] = Math.sin(2 * Math.PI * 440 * i / SR) * 0.5;
        cv[i]    = 6 * Math.sin(2 * Math.PI * 5 * i / SR);  // ±6 dB LFO
      }
      function runWithBlock(blockN) {
        const op = freshOp({ bias: 0.05 });
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
    name: 'STRESS: long-run — 6 sec sine + LFO cv → memoryless (period-aligned RMS match)',
    run() {
      // Op is memoryless, so identical input intervals must produce identical
      // RMS regardless of when in the stream they fall. Use 1 Hz LFO so a
      // 1-sec window captures a full LFO period; intervals [1s,2s] and
      // [4s,5s] both contain identical LFO content → RMS must match exactly.
      const total = SR * 6;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);
      const lfoFreq = 1.0;  // 1 Hz LFO → period exactly 1 sec → 1 sec window aligned
      for (let i = 0; i < total; i++) {
        audio[i] = Math.sin(2 * Math.PI * 1000 * i / SR) * 0.5;
        cv[i]    = -6 + 6 * Math.sin(2 * Math.PI * lfoFreq * i / SR);
      }
      const op = freshOp({ bias: 0.02 });
      const out = runBlocks(op, total, audio, cv);
      for (let i = 0; i < total; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `non-finite at i=${i}` };
      }
      const rmsA = rms(out, SR * 1, SR * 2);
      const rmsB = rms(out, SR * 4, SR * 5);
      // Memoryless op + period-aligned windows → bit-for-bit identical RMS
      if (!approx(rmsA, rmsB, 1e-6)) return { pass: false, why: `memoryless violation: rmsA=${rmsA} rmsB=${rmsB}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: SR-invariance — same logical operation across 44.1/48/96k',
    run() {
      const rates = [44100, 48000, 96000];
      const gains = [];
      for (const sr of rates) {
        const op = new BlackmerVCAOp(sr);
        op.reset();
        op.setParam('bias', 0.02);
        const total = Math.round(sr * 0.05);
        const audio = new Float32Array(total);
        const cv    = new Float32Array(total);
        for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 1000 * i / sr) * 0.4;
        cv.fill(3);  // +3 dB
        const out = new Float32Array(total);
        let pos = 0;
        while (pos < total) {
          const n = Math.min(N, total - pos);
          op.process({ audio: audio.subarray(pos, pos + n), cv: cv.subarray(pos, pos + n) },
                     { out: out.subarray(pos, pos + n) }, n);
          pos += n;
        }
        const rmsIn  = rms(audio, 100, total - 100);
        const rmsOut = rms(out,   100, total - 100);
        gains.push(rmsOut / rmsIn);
      }
      // With bias=0.02, RMS includes 1H + small DC + 2H contributions.
      // For x = A·sin, gain·A = G:
      //   RMS² = G²/2 (1H) + (bias·G·2/π)² (DC) + (bias·G·4/(3π))²/2 (2H) + ...
      //        = G²/2 · [1 + bias²·8/π² + bias²·16/(9π²) + ...]
      // For bias=0.02: factor in brackets ≈ 1 + 0.000324 ≈ 1.000324
      // RMS_out / RMS_in = G · √1.000324 ≈ G · 1.000162
      const G = Math.pow(10, 3 / 20);
      const expected = G * Math.sqrt(1 + 0.02 * 0.02 * (8 / (Math.PI * Math.PI) + 16 / (9 * Math.PI * Math.PI)));
      for (const g of gains) {
        if (!approx(g, expected, 0.005)) return { pass: false, why: `SR-variant gain ${g} expected ${expected.toFixed(6)}` };
      }
      // All three SR rates should produce the same gain within float precision.
      const maxDiff = Math.max(...gains) - Math.min(...gains);
      if (maxDiff > 0.001) return { pass: false, why: `SR variance: ${gains.map(g=>g.toFixed(6))}` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: state isolation — 3 parallel ops with different params produce independent output',
    run() {
      const total = 1024;
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 500 * i / SR) * 0.3;

      const opA = freshOp({ bias:  0.1 });
      const opB = freshOp({ bias: -0.1 });
      const opC = freshOp({ bias:  0,   trim: 6.0206 });
      const outA = runBlocks(opA, total, audio, null);
      const outB = runBlocks(opB, total, audio, null);
      const outC = runBlocks(opC, total, audio, null);
      // Each pair should differ.
      let dAB = 0, dAC = 0, dBC = 0;
      for (let i = 0; i < total; i++) {
        dAB += Math.abs(outA[i] - outB[i]);
        dAC += Math.abs(outA[i] - outC[i]);
        dBC += Math.abs(outB[i] - outC[i]);
      }
      if (dAB < 1) return { pass: false, why: `A≈B (diff=${dAB})` };
      if (dAC < 100) return { pass: false, why: `A≈C (diff=${dAC})` };
      if (dBC < 100) return { pass: false, why: `B≈C (diff=${dBC})` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: large-signal — ±2.0 amplitude at unity gain stays bounded',
    run() {
      const op = freshOp({ bias: 0.05 });  // moderate character
      const total = 1024;
      const audio = new Float32Array(total);
      const cv    = new Float32Array(total);  // cv=0
      for (let i = 0; i < total; i++) audio[i] = 2.0 * Math.sin(2 * Math.PI * 100 * i / SR);
      const out = runBlocks(op, total, audio, cv);
      // out = audio * (1 + bias * |audio|) ≤ 2.0 * (1 + 0.05 * 2.0) = 2.2
      let peak = 0;
      for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
      if (peak > 2.3 || peak < 1.9) return { pass: false, why: `peak=${peak} (expected 2.0..2.2)` };
      return { pass: true };
    },
  },
  {
    name: 'STRESS: dbx ±50 dB range — full sweep with sine produces expected gains',
    run() {
      // Patent claim: "±50 dB range with very low distortion."
      // Verify gain accuracy across this full range.
      const rates = [-50, -25, 0, 25, 50];
      const total = 1024;
      const audio = new Float32Array(total);
      // Use small input to avoid float overflow at +50 dB (input × 316 = ~316 per unit input).
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * 200 * i / SR) * 1e-3;
      for (const cvDb of rates) {
        const op = freshOp({});
        const cv = new Float32Array(total);
        cv.fill(cvDb);
        const out = runBlocks(op, total, audio, cv);
        const expected = Math.pow(10, cvDb / 20);
        const rmsOut = rms(out,  100, total - 100);
        const rmsIn  = rms(audio,100, total - 100);
        const gainMeasured = rmsOut / rmsIn;
        const errDb = 20 * Math.log10(gainMeasured / expected);
        if (Math.abs(errDb) > 0.05) {
          return { pass: false, why: `cv=${cvDb} dB: measured ${20*Math.log10(gainMeasured)} dB, error ${errDb.toFixed(4)} dB` };
        }
      }
      return { pass: true };
    },
  },
  {
    name: 'STRESS: patent matching spec — bias=0.025 (1mV/40µA equivalent) produces ~−42 dB 2H',
    run() {
      // Patent: Q3/Q4 matched to 1 mV at 40 µA (= 2.5% current asymmetry).
      // → bias=0.025. Expected 2H/1H ratio for y = x + bias·|x|, x = A·sin:
      //   1H amp = A
      //   2H amp = bias · A · 4/(3π)
      //   ratio = bias · 4/(3π) = 0.025 · 0.4244 = 0.01061 → −39.5 dB
      const op = freshOp({ bias: 0.025 });
      const f = 1000;
      const total = intCycleWindow(SR, f, 4096);
      const audio = new Float32Array(total);
      for (let i = 0; i < total; i++) audio[i] = Math.sin(2 * Math.PI * f * i / SR) * 0.5;
      const out = runBlocks(op, total, audio, null);
      const mag1 = bin(out, 0, total, f,     SR);
      const mag2 = bin(out, 0, total, 2 * f, SR);
      const ratioDb = 20 * Math.log10(mag2 / mag1);
      // Expected ratio ≈ −39.5 dB. Tolerance: ±2 dB.
      if (ratioDb > -37 || ratioDb < -42) return { pass: false, why: `2H/1H = ${ratioDb.toFixed(2)} dB (expected ~-39.5 dB)` };
      return { pass: true };
    },
  },
];

export default { opId: 'blackmerVCA', tests };
