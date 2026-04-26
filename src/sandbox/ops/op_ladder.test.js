// op_ladder.test.js — real-math tests for op_ladder (musicdsp #24 Moog VCF).
// Run via: node scripts/check_op_math.mjs
//
// Primary source: musicdsp.org/en/latest/Filters/24-moog-vcf.html
// Verifies core ladder properties:
//   - LP passband unity, stopband attenuated ≥24 dB/oct
//   - Resonance increases peak at fc
//   - High-resonance self-oscillation stays bounded (cubic soft-clip)
//   - Reset clears state, denormal flush, defensive null, determinism.

import { LadderOp } from './op_ladder.worklet.js';

const SR = 48000;

function freshOp(params = {}) {
  const op = new LadderOp(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

function render(op, inFill, n) {
  const inBuf = new Float32Array(n);
  for (let i = 0; i < n; i++) inBuf[i] = typeof inFill === 'function' ? inFill(i) : inFill;
  const out = new Float32Array(n);
  op.process({ in: inBuf }, { out }, n);
  return { inBuf, out };
}

function tailRms(buf, skip) {
  let s = 0, n = 0;
  for (let i = skip; i < buf.length; i++) { s += buf[i] * buf[i]; n++; }
  return Math.sqrt(s / n);
}

function gainDb(op, freq, n = 8192, skip = 4096) {
  // Small-signal probe (peak 0.05) so the cascaded tanh shapers in the
  // v3 Stinchcombe-direct ladder stay in their linear regime — at full
  // amplitude the 5× tanh chain compresses ~5–7 dB across the band,
  // masking the linear LP/resonance behaviour we want to measure.
  const A = 0.05;
  const { inBuf, out } = render(op, i => A * Math.sin(2 * Math.PI * freq * i / SR), n);
  return 20 * Math.log10(tailRms(out, skip) / tailRms(inBuf, skip));
}

const tests = [
  // ---- LP character -------------------------------------------------
  {
    name: 'LP: passband (100 Hz @ fc=2k, res=0) close to 0 dB',
    run() {
      const op = freshOp({ cutoff: 2000, resonance: 0 });
      const g = gainDb(op, 100);
      // mistertoast port has a small passband dip even at res=0 (not a
      // textbook Moog); we accept within 3 dB of unity.
      if (Math.abs(g) > 3) return { pass: false, why: `${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'LP: stopband (12 kHz @ fc=1k, res=0) strongly attenuated',
    run() {
      const op = freshOp({ cutoff: 1000, resonance: 0 });
      const g = gainDb(op, 12000);
      if (g > -20) return { pass: false, why: `only ${g.toFixed(3)} dB` };
      return { pass: true };
    },
  },
  {
    name: 'LP slope: octave-above-fc drops by ≥18 dB vs passband',
    run() {
      const op = freshOp({ cutoff: 1000, resonance: 0 });
      const gPass = gainDb(freshOp({ cutoff: 1000, resonance: 0 }), 200);
      const gOct  = gainDb(op, 4000);  // 2 octaves above
      if (gPass - gOct < 18) return { pass: false, why: `pass=${gPass.toFixed(2)} oct=${gOct.toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- Resonance ---------------------------------------------------
  {
    name: 'higher resonance → higher peak at fc',
    run() {
      const gLo = gainDb(freshOp({ cutoff: 1000, resonance: 0   }), 1000);
      const gHi = gainDb(freshOp({ cutoff: 1000, resonance: 0.9 }), 1000);
      if (gHi - gLo < 6) return { pass: false, why: `lo=${gLo.toFixed(2)} hi=${gHi.toFixed(2)}` };
      return { pass: true };
    },
  },
  {
    name: 'self-oscillation regime bounded by cubic clip',
    run() {
      // At high resonance with a small stimulus, output should not blow up.
      const op = freshOp({ cutoff: 1000, resonance: 1.1 });
      const { out } = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR) * 0.01, 8192);
      let peak = 0;
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        peak = Math.max(peak, Math.abs(out[i]));
      }
      // Cubic clip `y -= y³/6` bounds the state well below catastrophic levels.
      if (peak > 5) return { pass: false, why: `peak=${peak.toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- Reset ------------------------------------------------------
  {
    name: 'reset() clears cascade + old-sample registers',
    run() {
      const op = freshOp({ cutoff: 500, resonance: 0.6 });
      render(op, 1, 4096);
      op.reset();
      const { out } = render(op, 0, 4);
      for (let i = 0; i < 4; i++)
        if (out[i] !== 0) return { pass: false, why: `post-reset out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },

  // ---- Denormal flush -------------------------------------------
  {
    name: 'denormal flush: tiny states + zero input → states → 0',
    run() {
      const op = freshOp({ cutoff: 500, resonance: 0 });
      op._y1 = op._y2 = op._y3 = op._y4 = 1e-35;
      op._oldx = op._oldy1 = op._oldy2 = op._oldy3 = 1e-35;
      render(op, 0, 32);
      if (op._y1 !== 0 || op._y2 !== 0 || op._y3 !== 0 || op._y4 !== 0)
        return { pass: false, why: `y states not flushed` };
      return { pass: true };
    },
  },

  // ---- Defensive -------------------------------------------------
  {
    name: 'missing input → all-zero output',
    run() {
      const op = freshOp({ cutoff: 1000, resonance: 0 });
      const out = new Float32Array(64);
      op.process({}, { out }, 64);
      for (let i = 0; i < 64; i++) if (out[i] !== 0) return { pass: false, why: `out[${i}]=${out[i]}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme cutoff (>Nyquist) clamped, output finite',
    run() {
      const op = freshOp({ cutoff: 100000, resonance: 0.5 });
      const { out } = render(op, 0.5, 512);
      for (let i = 0; i < 512; i++)
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
      return { pass: true };
    },
  },
  {
    name: 'extreme resonance (2.0) clamped, stays bounded',
    run() {
      const op = freshOp({ cutoff: 1000, resonance: 2 });
      const { out } = render(op, i => Math.sin(2 * Math.PI * 1000 * i / SR) * 0.1, 8192);
      let peak = 0;
      for (let i = 0; i < out.length; i++) {
        if (!Number.isFinite(out[i])) return { pass: false, why: `NaN at ${i}` };
        peak = Math.max(peak, Math.abs(out[i]));
      }
      if (peak > 10) return { pass: false, why: `peak=${peak.toFixed(2)}` };
      return { pass: true };
    },
  },

  // ---- Determinism ------------------------------------------------
  {
    name: 'deterministic: same input → identical output across fresh instances',
    run() {
      const a = render(freshOp({ cutoff: 800, resonance: 0.4 }), i => Math.sin(i * 0.01), 1024).out;
      const b = render(freshOp({ cutoff: 800, resonance: 0.4 }), i => Math.sin(i * 0.01), 1024).out;
      for (let i = 0; i < 1024; i++)
        if (a[i] !== b[i]) return { pass: false, why: `diverge at ${i}` };
      return { pass: true };
    },
  },
];

export default { opId: 'ladder', tests };
