// op_xformerSat.test.js — real-math tests for op_xformerSat.
// Run via: node scripts/check_op_math.mjs
//
// PRIMARY: De Paiva, Pakarinen, Välimäki, "Real-Time Audio Transformer
// Emulation for Virtual Analog Models," DAFx-11, 2011.
// Memo: memory/depaiva_transformer_emulation.md
// PDF:  docs/primary_sources/transformers/DePaiva_2011_Real_Time_Audio_Transformer_Emulation.pdf
//
// Topology (Stage 2): flux-tracker LP → Eq 34 NL-cap modulating an HP
// through-path corner, hysteresis (Eq 17, m=3, §3.3 unit-delay) on the
// HP output, HF leakage 1-pole LP. Linear bandpass ≈ 25 Hz HP / 12 kHz
// LP at default sourceZ=600 Ω, air=1.
//
// Test coverage:
//   - Linear bandpass: mid passband, LF rolloff at HP corner, HF rolloff
//   - Volt-second saturation: LF compresses under drive (Whitlock §5)
//   - HF passband: NOT compressed under drive (LF-only saturation)
//   - coreSize monotonicity: bigger `a` → more LF compression
//   - sourceZ shifts LF corner up
//   - Hysteresis: loss>0 produces 3rd-order distortion (m=3)
//   - State retention, reset clears state, denormal flush
//   - NaN/Inf clamps, missing input → silence, determinism

import { XformerSatOp } from './op_xformerSat.worklet.js';

const SR = 48000;
const N  = 8192;

function freshOp(params = {}) {
  const op = new XformerSatOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}
function render(op, freq, amp, n = N) {
  const inB = new Float32Array(n), outB = new Float32Array(n);
  for (let i = 0; i < n; i++) inB[i] = amp * Math.sin(2 * Math.PI * freq * i / SR);
  op.process({ in: inB }, { out: outB }, n);
  return outB;
}
function rmsTail(b, skip) {
  let s = 0, n = 0;
  for (let i = skip; i < b.length; i++) { s += b[i] * b[i]; n++; }
  return Math.sqrt(s / n);
}
function gainDb(op, freq, amp = 0.1) {
  const o = render(op, freq, amp);
  return 20 * Math.log10(rmsTail(o, N / 2) / (amp / Math.SQRT2));
}
// Goertzel for harmonic-amplitude probing.
function goertzel(buf, fhz) {
  const k = 2 * Math.PI * fhz / SR;
  let s1 = 0, s2 = 0; const c = 2 * Math.cos(k);
  for (let i = 0; i < buf.length; i++) { const s = buf[i] + c * s1 - s2; s2 = s1; s1 = s; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2);
}

const tests = [
  // ── Linear bandpass ───────────────────────────────────────────────
  {
    name: 'linear midband (1 kHz, drive=0, loss=0) within 0.5 dB of unity',
    run() {
      const op = freshOp({ drive: 0, loss: 0 });
      const g = gainDb(op, 1000);
      if (Math.abs(g) > 0.5) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'LF rolloff: 10 Hz attenuated >5 dB vs 1 kHz',
    run() {
      const opLf = freshOp({ drive: 0, loss: 0 });
      const opMid = freshOp({ drive: 0, loss: 0 });
      const gLf = gainDb(opLf, 10);
      const gMid = gainDb(opMid, 1000);
      if (gMid - gLf < 5) return { pass: false, why: `mid=${gMid.toFixed(2)} lf=${gLf.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'HF rolloff: 18 kHz attenuated >2 dB vs 1 kHz',
    run() {
      const opMid = freshOp({ drive: 0, loss: 0 });
      const opHf = freshOp({ drive: 0, loss: 0 });
      const gMid = gainDb(opMid, 1000);
      const gHf = gainDb(opHf, 18000);
      if (gMid - gHf < 2) return { pass: false, why: `mid=${gMid.toFixed(2)} hf=${gHf.toFixed(2)}` };
      return { pass: true };
    },
  },
  // ── Volt-second saturation (Whitlock §5) ──────────────────────────
  {
    name: 'LF compression under drive: 50 Hz net gain drops ≥8 dB from 0 to +24 dB drive',
    run() {
      // Net gain = output_dB − drive_dB. Linear: ≈0. Saturated: <0.
      const op0  = freshOp({ drive: 0, loss: 0 });
      const op24 = freshOp({ drive: 24, loss: 0 });
      const o0  = render(op0,  50, 1, 16384);
      const o24 = render(op24, 50, 1, 16384);
      const r0  = rmsTail(o0,  8192);
      const r24 = rmsTail(o24, 8192);
      const net0  = 20 * Math.log10(r0  / Math.SQRT1_2) - 0;
      const net24 = 20 * Math.log10(r24 / Math.SQRT1_2) - 24;
      const drop = net0 - net24;
      if (drop < 8) return { pass: false, why: `net0=${net0.toFixed(2)} net24=${net24.toFixed(2)} drop=${drop.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'HF unaffected by drive: 5 kHz net gain unchanged within 1 dB',
    run() {
      const op0  = freshOp({ drive: 0, loss: 0 });
      const op24 = freshOp({ drive: 24, loss: 0 });
      const o0  = render(op0,  5000, 1, 16384);
      const o24 = render(op24, 5000, 1, 16384);
      const net0  = 20 * Math.log10(rmsTail(o0,  8192) / Math.SQRT1_2) - 0;
      const net24 = 20 * Math.log10(rmsTail(o24, 8192) / Math.SQRT1_2) - 24;
      const delta = Math.abs(net0 - net24);
      if (delta > 1) return { pass: false, why: `net0=${net0.toFixed(2)} net24=${net24.toFixed(2)} Δ=${delta.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'coreSize monotonicity: bigger `a` → more LF compression',
    run() {
      // Render 50 Hz at +12 dB drive; rms should DECREASE as a grows.
      const rmsAt = (a) => {
        const op = freshOp({ drive: 12, coreSize: a, loss: 0 });
        return rmsTail(render(op, 50, 1, 16384), 8192);
      };
      const r_small = rmsAt(0.3);
      const r_large = rmsAt(3.0);
      if (!(r_large < r_small * 0.85)) {
        return { pass: false, why: `r_a=0.3=${r_small.toFixed(3)} r_a=3=${r_large.toFixed(3)}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'sourceZ shifts LF corner: high Z attenuates 50 Hz more than low Z',
    run() {
      // fc_lf ∝ Rs. Doubling Rs from 600 → 2400 Ω moves corner up 2 oct.
      const gLow  = gainDb(freshOp({ drive: 0, sourceZ: 150,  loss: 0 }), 50);
      const gHigh = gainDb(freshOp({ drive: 0, sourceZ: 2400, loss: 0 }), 50);
      if (!(gLow - gHigh > 4)) return { pass: false, why: `low=${gLow.toFixed(2)} high=${gHigh.toFixed(2)}` };
      return { pass: true };
    },
  },
  // ── Hysteresis (Eq 17, m=3) ───────────────────────────────────────
  {
    name: 'loss=0 → near-zero 3rd harmonic at 200 Hz',
    run() {
      const op = freshOp({ drive: 6, loss: 0 });
      const o = render(op, 200, 0.7, 16384).slice(8192);
      const f1 = goertzel(o, 200);
      const f3 = goertzel(o, 600);
      const ratio = f3 / Math.max(f1, 1e-12);
      // Some 3rd harmonic from saturation tracker exists even at loss=0;
      // it should still be small relative to the fundamental.
      if (ratio > 0.05) return { pass: false, why: `f3/f1=${ratio.toFixed(4)}` };
      return { pass: true };
    },
  },
  {
    name: 'loss>0 produces measurably more 3rd harmonic than loss=0',
    run() {
      const op0 = freshOp({ drive: 6, loss: 0 });
      const op1 = freshOp({ drive: 6, loss: 1 });
      const f3_0 = goertzel(render(op0, 200, 0.7, 16384).slice(8192), 600);
      const f3_1 = goertzel(render(op1, 200, 0.7, 16384).slice(8192), 600);
      if (!(f3_1 > f3_0 * 3)) return { pass: false, why: `loss=0:${f3_0.toFixed(2)} loss=1:${f3_1.toFixed(2)}` };
      return { pass: true };
    },
  },
  // ── State / reset / denormal ──────────────────────────────────────
  {
    name: 'stateful: 2nd block depends on 1st block',
    run() {
      const a = freshOp({ drive: 6, loss: 0.3 });
      const b = freshOp({ drive: 6, loss: 0.3 });
      const inA = new Float32Array(N);
      for (let i = 0; i < N; i++) inA[i] = 0.3 * Math.sin(2 * Math.PI * 200 * i / SR);
      const oA1 = new Float32Array(N);
      a.process({ in: inA }, { out: oA1 }, N);
      // Now both ops process a second buffer with same content.
      const inB = new Float32Array(N);
      for (let i = 0; i < N; i++) inB[i] = 0.3 * Math.sin(2 * Math.PI * 200 * (i + N) / SR);
      const oA2 = new Float32Array(N);
      const oB  = new Float32Array(N);
      a.process({ in: inB }, { out: oA2 }, N);
      b.process({ in: inB }, { out: oB }, N);
      let differs = false;
      for (let i = 0; i < N; i++) if (Math.abs(oA2[i] - oB[i]) > 1e-6) { differs = true; break; }
      if (!differs) return { pass: false, why: 'no state retention' };
      return { pass: true };
    },
  },
  {
    name: 'reset() clears state',
    run() {
      const op = freshOp({ drive: 12, loss: 0.5 });
      const ref = freshOp({ drive: 12, loss: 0.5 });
      // Warm op with a strong burst.
      const warm = new Float32Array(N);
      for (let i = 0; i < N; i++) warm[i] = 0.8 * Math.sin(2 * Math.PI * 100 * i / SR);
      const o1 = new Float32Array(N);
      op.process({ in: warm }, { out: o1 }, N);
      op.reset();
      // Now both should produce identical output on identical input.
      const probe = new Float32Array(N);
      for (let i = 0; i < N; i++) probe[i] = 0.1 * Math.sin(2 * Math.PI * 200 * i / SR);
      const oA = new Float32Array(N);
      const oB = new Float32Array(N);
      op.process({ in: probe }, { out: oA }, N);
      ref.process({ in: probe }, { out: oB }, N);
      for (let i = 0; i < N; i++) {
        if (Math.abs(oA[i] - oB[i]) > 1e-9) return { pass: false, why: `i=${i}: ${oA[i]} vs ${oB[i]}` };
      }
      return { pass: true };
    },
  },
  {
    name: 'denormal flush: tiny states + zero input → states clear',
    run() {
      const op = freshOp({ drive: 0, loss: 0 });
      op._phi = op._yHp = op._yHf = op._vrPrev = op._xPrev = 1e-35;
      const inB = new Float32Array(64);
      const out = new Float32Array(64);
      op.process({ in: inB }, { out }, 64);
      if (op._phi !== 0 || op._yHp !== 0 || op._yHf !== 0)
        return { pass: false, why: `phi=${op._phi} yHp=${op._yHp} yHf=${op._yHf}` };
      return { pass: true };
    },
  },
  // ── Defensive ─────────────────────────────────────────────────────
  {
    name: 'silence in → silence out',
    run() {
      const op = freshOp({ drive: 12, loss: 0.5 });
      const inB = new Float32Array(256);
      const out = new Float32Array(256);
      op.process({ in: inB }, { out }, 256);
      for (let i = 0; i < 256; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ drive: 6 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `i=${i}: ${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'NaN/Inf params clamped: output stays finite',
    run() {
      const op = freshOp({});
      for (const p of ['drive', 'coreSize', 'sourceZ', 'loss', 'air']) {
        op.setParam(p, NaN); op.setParam(p, Infinity); op.setParam(p, -Infinity);
      }
      const inB = new Float32Array(N);
      const out = new Float32Array(N);
      for (let i = 0; i < N; i++) inB[i] = 0.5 * Math.sin(2 * Math.PI * 200 * i / SR);
      op.process({ in: inB }, { out }, N);
      for (let i = 0; i < N; i++) if (!Number.isFinite(out[i])) return { pass: false, why: `i=${i}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme drive (+36 dB clamp), loss=1 stays bounded',
    run() {
      const op = freshOp({ drive: 100, loss: 100, coreSize: 100 });
      const o = render(op, 100, 1, 16384);
      let peak = 0;
      for (let i = 0; i < o.length; i++) {
        if (!Number.isFinite(o[i])) return { pass: false, why: `NaN at ${i}` };
        const a = Math.abs(o[i]);
        if (a > peak) peak = a;
      }
      // Hard upper bound on settled peak: input is ≤1, drive clamp +36 dB
      // = ×63, HP corner shifts up but pass-band ≤63. Allow ×100 headroom.
      if (peak > 100) return { pass: false, why: `peak=${peak.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'determinism: two fresh ops produce identical output',
    run() {
      const a = freshOp({ drive: 6, coreSize: 1.5, loss: 0.4, sourceZ: 1200, air: 1.5 });
      const b = freshOp({ drive: 6, coreSize: 1.5, loss: 0.4, sourceZ: 1200, air: 1.5 });
      const oA = render(a, 80, 0.5, 1024);
      const oB = render(b, 80, 0.5, 1024);
      for (let i = 0; i < 1024; i++)
        if (oA[i] !== oB[i]) return { pass: false, why: `i=${i}: ${oA[i]} vs ${oB[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'getLatencySamples() === 0',
    run() {
      if (freshOp({}).getLatencySamples() !== 0) return { pass: false, why: 'non-zero' };
      return { pass: true };
    },
  },
];

export default { opId: 'xformerSat', tests };
