// check_native_parity.mjs — Phase 2 orchestrator.
// Per memory/codegen_pipeline_buildout.md § 5.
//
// Usage:
//   node scripts/check_native_parity.mjs --op gain
//   node scripts/check_native_parity.mjs --all
//
// Loads test/fixtures/parity/per_op_specs.json, generates each test signal,
// renders through (a) the canon JS reference and (b) the .vst3 via parity_host,
// compares under tolerance, prints PASS/FAIL.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { CANON_SIGNALS, writeWav, readWav } from './parity_signals.mjs';
import { snapParamValue, rawToNorm } from './param_snap.mjs';

// JUCE's String::hashCode() — Java-style (31*h + c), int32, then cast to uint32
// for VST3 ParamID. Matches juce_audio_plugin_client_VST3.cpp.
function juceParamHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  // JUCE_USE_STUDIO_ONE_COMPATIBLE_PARAMETERS clears the top bit.
  return ((h >>> 0) & 0x7FFFFFFF).toString();
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = resolve(__dirname, '..');

// ─── arg parse ────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opArg  = (() => {
  const i = argv.indexOf('--op');
  return i >= 0 ? argv[i + 1] : null;
})();
const allFlag = argv.includes('--all');
if (!opArg && !allFlag) {
  console.error('usage: node scripts/check_native_parity.mjs --op <name> | --all');
  process.exit(2);
}

// ─── load specs ───────────────────────────────────────────────────────
const specsPath = resolve(repoRoot, 'test/fixtures/parity/per_op_specs.json');
const specs = JSON.parse(readFileSync(specsPath, 'utf8'));

// ─── parity_host binary ───────────────────────────────────────────────
const PARITY_HOST = resolve(repoRoot,
  '.shagsplug/parity_host/build/parity_host_artefacts/Release/parity_host.exe');
if (!existsSync(PARITY_HOST)) {
  console.error(`[parity] parity_host.exe not found at ${PARITY_HOST}`);
  console.error('         build it first: cmake configure+build src/sandbox/codegen/parity_host');
  process.exit(1);
}

// ─── builtin reference renderers ──────────────────────────────────────
const REFERENCES = {
  'builtin:gain': (input, args) => {
    const gainDb = args.gainDb ?? 0;
    const base = Math.pow(10, gainDb / 20);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * base;
    return out;
  },
  'builtin:abs': (input) => {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = Math.abs(input[i]);
    return out;
  },
  'builtin:sign': (input) => {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      out[i] = x > 0 ? 1 : (x < 0 ? -1 : 0);
    }
    return out;
  },
  'builtin:scaleBy': (input, args) => {
    const k = args.k ?? 1;
    const out = new Float32Array(input.length);
    if (k === 1) { out.set(input); return out; }
    if (k === 0) return out;
    // Worklet: out[i] = k * inCh[i] in float64, stored to Float32.
    for (let i = 0; i < input.length; i++) out[i] = k * input[i];
    return out;
  },
  'builtin:clamp': (input, args) => {
    const lo = args.lo ?? -1, hi = args.hi ?? 1;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      out[i] = x < lo ? lo : (x > hi ? hi : x);
    }
    return out;
  },
  'builtin:polarity': (input, args) => {
    const invert = !!args.invert;
    const out = new Float32Array(input.length);
    if (invert) for (let i = 0; i < input.length; i++) out[i] = -input[i];
    else        out.set(input);
    return out;
  },
  'builtin:uniBi': (input, args) => {
    const mode = args.mode ?? 'uniToBi';
    const out = new Float32Array(input.length);
    if (mode === 'uniToBi') for (let i = 0; i < input.length; i++) out[i] = 2 * input[i] - 1;
    else                    for (let i = 0; i < input.length; i++) out[i] = (input[i] + 1) * 0.5;
    return out;
  },
  // ── Tier B: stateful filters ────────────────────────────────────────
  // Mirror op_dcBlock.cpp.jinja exactly (1-pole DC trap, double-precision
  // state). Default cutoff 10 Hz @ 48k. Denormal flush matches.
  'builtin:dcBlock': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const fc = Number(args.cutoff ?? 10);
    const R  = Math.exp(-2 * Math.PI * fc / sr);
    const out = new Float32Array(input.length);
    let x1 = 0, y1 = 0;
    const DENORM = 1e-30;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      let y = x - x1 + R * y1;
      if (y < DENORM && y > -DENORM) y = 0;
      out[i] = Math.fround(y);
      x1 = x;
      y1 = y;
    }
    return out;
  },
  // Mirror op_onePole.cpp.jinja: complementary LP/HP, exp(-2π·fc/sr) coef.
  'builtin:onePole': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const mode = String(args.mode ?? 'lp');
    const isHP = mode === 'hp';
    const nyq = 0.5 * sr - 100;
    let fc = Number(args.cutoff ?? 1000);
    if (fc < 1) fc = 1; else if (fc > nyq) fc = nyq;
    const a = Math.exp(-2 * Math.PI * fc / sr);
    const oma = 1 - a;
    const DENORM = 1e-30;
    const out = new Float32Array(input.length);
    let y1 = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      let lp = oma * x + a * y1;
      if (lp < DENORM && lp > -DENORM) lp = 0;
      y1 = lp;
      out[i] = Math.fround(isHP ? (x - lp) : lp);
    }
    return out;
  },
  // Mirror op_svf.cpp.jinja — Simper ZDF SVF, double-prec state.
  // mode: 0=lp 1=hp 2=bp 3=notch (numeric per codegen canonicalization).
  'builtin:svf': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const modeMap = { lp: 0, hp: 1, bp: 2, notch: 3 };
    const mode = typeof args.mode === 'number' ? args.mode : (modeMap[String(args.mode ?? 'lp')] ?? 0);
    const cutoff = Number(args.cutoff ?? 1000);
    const q = Number(args.q ?? 0.707);
    const nyq = 0.5 * sr - 100;
    const fc  = Math.min(Math.max(cutoff, 20), nyq);
    const qc  = Math.min(Math.max(q, 0.05), 50);
    const g   = Math.tan(Math.PI * fc / sr);
    const k   = 1 / qc;
    const a1  = 1 / (1 + g * (g + k));
    const a2  = g * a1;
    const a3  = g * a2;
    const DENORM = 1e-30;
    let ic1 = 0, ic2 = 0;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const v0 = input[i];
      const v3 = v0 - ic2;
      const v1 = a1 * ic1 + a2 * v3;
      const v2 = ic2 + a2 * ic1 + a3 * v3;
      ic1 = 2 * v1 - ic1;
      ic2 = 2 * v2 - ic2;
      if (ic1 < DENORM && ic1 > -DENORM) ic1 = 0;
      if (ic2 < DENORM && ic2 > -DENORM) ic2 = 0;
      let y = 0;
      switch (mode) {
        case 0: y = v2; break;
        case 1: y = v0 - k * v1 - v2; break;
        case 2: y = v1; break;
        case 3: y = v0 - k * v1; break;
      }
      out[i] = Math.fround(y);
    }
    return out;
  },
  // Mirror op_ladder.cpp.jinja v2 — Stinchcombe-faithful Moog: per-stage
  // tanh on feedback paths + tanh on global FB tap. Linear coef block
  // unchanged from v1 (musicdsp #24). Tolerance band absorbs Math.tanh
  // vs std::tanh LSB differences (sub-LSB on Float32 round-trip).
  // ladder v3 — Stinchcombe-direct rewrite. Mirrors op_ladder.worklet.js /
  // op_ladder.cpp.jinja. Primary: docs/primary_sources/stinchcombe/Moog_ladder_tf.pdf
  // §2.1.1 eq.(5) (per-stage tanh), §2.3 eq.(21) (FB at driver), §2.5
  // (k=4 self-osc). 2× polyphase OS, 63-tap Kaiser β=10 halfband.
  'builtin:ladder': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const cutoff = Number(args.cutoff ?? 1000);
    const resonance = Number(args.resonance ?? 0);
    const drive = Number(args.drive ?? 1.0);
    const trim  = Number(args.trim ?? 0.0);

    // Pre-warp at 2·Fs.
    const sr2  = 2 * sr;
    const nyq2 = 0.5 * sr2 - 100;
    const fc   = Math.min(Math.max(cutoff, 20), nyq2);
    const T2   = 1 / sr2;
    const wd   = 2 * Math.PI * fc;
    const preArg = Math.min(wd * T2 / 2, Math.PI / 2 - 1e-4);
    const tt   = Math.tan(preArg);
    const G    = tt / (1 + tt);
    const res  = Math.min(Math.max(resonance, 0), 1.2);
    const k    = (4 / 1.2) * res;
    const trimLin = Math.pow(10, trim / 20);

    // 63-tap Kaiser β=10 halfband (verbatim from op_drive).
    const besselI0 = (x) => {
      let sum = 1.0, term = 1.0;
      const q = x * x * 0.25;
      for (let n = 1; n < 50; n++) {
        term *= q / (n * n);
        sum  += term;
        if (term < 1.0e-20 * sum) break;
      }
      return sum;
    };
    const kTaps = 63;
    const beta  = 10.0;
    const i0Beta = besselI0(beta);
    const N    = kTaps - 1;
    const half = (kTaps / 2) | 0;
    const hb = new Float64Array(kTaps);
    for (let n = 0; n < kTaps; n++) {
      const m = n - half;
      let sinc;
      if (m === 0)              sinc = 0.5;
      else if ((m & 1) === 0)   sinc = 0.0;
      else                      sinc = Math.sin(0.5 * Math.PI * m) / (Math.PI * m);
      const r = (2 * n - N) / N;
      const a = beta * Math.sqrt(1 - r * r);
      const w = besselI0(a) / i0Beta;
      hb[n] = sinc * w;
    }
    const upBuf = new Float64Array(kTaps);
    const dnBuf = new Float64Array(kTaps);
    const upRef = { i: 0 }, dnRef = { i: 0 };
    const push = (buf, idxRef, x) => {
      buf[idxRef.i] = x;
      idxRef.i = (idxRef.i + 1) % kTaps;
      let y = 0, j = idxRef.i;
      for (let t = 0; t < kTaps; t++) {
        y += hb[t] * buf[j];
        j = (j + 1) % kTaps;
      }
      return y;
    };

    // Ladder state.
    let y1 = 0, y2 = 0, y3 = 0, y4 = 0;
    let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let y4_prev = 0;

    const ladderStep = (x) => {
      const in_drv = drive * x - k * y4_prev;
      const th_drv = Math.tanh(in_drv);
      const v1 = (th_drv - s1) * G;
      y1 = v1 + s1; s1 += 2 * v1;
      const th_y1 = Math.tanh(y1);
      const v2 = (th_y1 - s2) * G;
      y2 = v2 + s2; s2 += 2 * v2;
      const th_y2 = Math.tanh(y2);
      const v3 = (th_y2 - s3) * G;
      y3 = v3 + s3; s3 += 2 * v3;
      const th_y3 = Math.tanh(y3);
      const v4 = (th_y3 - s4) * G;
      y4 = v4 + s4; s4 += 2 * v4;
      y4_prev = y4;
      return y4;
    };

    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x   = 2.0 * input[i];
      const up0 = push(upBuf, upRef, x);
      const up1 = push(upBuf, upRef, 0.0);
      const yA  = ladderStep(up0);
      const yB  = ladderStep(up1);
      push(dnBuf, dnRef, yA);
      const dn  = push(dnBuf, dnRef, yB);
      out[i] = Math.fround(trimLin * dn);
    }
    return out;
  },
  // Mirror op_biquad.cpp.jinja — RBJ Audio EQ Cookbook, Direct Form II
  // Transposed. mode: 0=lp 1=hp 2=bp 3=notch 4=peak 5=lowShelf 6=highShelf.
  // Accepts mode as numeric (preferred, codegen path) or string (legacy).
  'builtin:biquad': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const modeMap = { lp: 0, hp: 1, bp: 2, notch: 3, peak: 4, lowShelf: 5, highShelf: 6 };
    const mode = typeof args.mode === 'number'
      ? args.mode
      : (modeMap[String(args.mode ?? 'lp')] ?? 0);
    const cutoff = Number(args.cutoff ?? 1000);
    const q      = Number(args.q ?? 0.707);
    const gainDb = Number(args.gainDb ?? 0);
    const nyq = 0.5 * sr - 100;
    const fc  = Math.min(Math.max(cutoff, 20), nyq);
    const qc  = Math.min(Math.max(q, 0.05), 50);
    const w0  = 2 * Math.PI * fc / sr;
    const cw  = Math.cos(w0);
    const sw  = Math.sin(w0);
    const alpha = sw / (2 * qc);
    const A   = Math.pow(10, gainDb / 40);
    const sqA = Math.sqrt(A);

    let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    switch (mode) {
      case 0:
        b0 = (1 - cw) * 0.5;  b1 = 1 - cw;  b2 = (1 - cw) * 0.5;
        a0 = 1 + alpha;       a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 1:
        b0 =  (1 + cw) * 0.5; b1 = -(1 + cw); b2 = (1 + cw) * 0.5;
        a0 =   1 + alpha;     a1 =  -2 * cw;  a2 =  1 - alpha;
        break;
      case 2:
        b0 =  alpha; b1 = 0; b2 = -alpha;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 3:
        b0 =  1; b1 = -2 * cw; b2 = 1;
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
        break;
      case 4:
        b0 = 1 + alpha * A;  b1 = -2 * cw; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;  a1 = -2 * cw; a2 = 1 - alpha / A;
        break;
      case 5: {
        const t = 2 * sqA * alpha;
        b0 =      A * ((A + 1) - (A - 1) * cw + t);
        b1 =  2 * A * ((A - 1) - (A + 1) * cw);
        b2 =      A * ((A + 1) - (A - 1) * cw - t);
        a0 =          (A + 1) + (A - 1) * cw + t;
        a1 = -2 *    ((A - 1) + (A + 1) * cw);
        a2 =          (A + 1) + (A - 1) * cw - t;
        break;
      }
      case 6: {
        const t = 2 * sqA * alpha;
        b0 =      A * ((A + 1) + (A - 1) * cw + t);
        b1 = -2 * A * ((A - 1) + (A + 1) * cw);
        b2 =      A * ((A + 1) + (A - 1) * cw - t);
        a0 =          (A + 1) - (A - 1) * cw + t;
        a1 =  2 *    ((A - 1) - (A + 1) * cw);
        a2 =          (A + 1) - (A - 1) * cw - t;
        break;
      }
    }
    const inv = 1 / a0;
    b0 *= inv; b1 *= inv; b2 *= inv; a1 *= inv; a2 *= inv;

    const DENORM = 1e-30;
    let z1 = 0, z2 = 0;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = b0 * x + z1;
      z1 = b1 * x - a1 * y + z2;
      z2 = b2 * x - a2 * y;
      if (z1 < DENORM && z1 > -DENORM) z1 = 0;
      if (z2 < DENORM && z2 > -DENORM) z2 = 0;
      out[i] = Math.fround(y);
    }
    return out;
  },
  // Mirror op_mix.cpp.jinja — equal-power dry/wet crossfade.
  // Test fixture convention: dry = primary input, wet = constant value
  // (so the spec only needs to declare dry; wet is synthesized internally).
  // Reference args: amount (0..1), wetValue (the constant flowing into wet).
  'builtin:mix': (input, args) => {
    const amount   = Math.min(Math.max(Number(args.amount ?? 0.5), 0), 1);
    const wetValue = Number(args.wetValue ?? 0);
    const dG = Math.cos(amount * Math.PI * 0.5);
    const wG = Math.sin(amount * Math.PI * 0.5);
    const wetTerm = wG * wetValue;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      out[i] = Math.fround(dG * input[i] + wetTerm);
    }
    return out;
  },
  // Mirror op_drive.cpp.jinja — soft saturator with 2× internal OS.
  // Pipeline: zero-stuff ×2 → halfband FIR → tanh @ 2·Fs → halfband FIR → ÷2.
  // 63-tap Kaiser-windowed halfband (β=10, ~100 dB stopband, passband flat
  // to ~0.40·Fs). Coefficients designed identically to the C++ side; FIR +
  // tanh chain in float64 → cast to float32 on store.
  'builtin:drive': (input, args) => {
    let k = Number(args.drive ?? 1);
    if (k < 0.1) k = 0.1; else if (k > 20) k = 20;
    const inv = 1 / Math.tanh(k);

    // ── Modified Bessel I₀ (must match C++ besselI0 byte-for-byte) ──
    const besselI0 = (x) => {
      let sum = 1.0, term = 1.0;
      const q = x * x * 0.25;
      for (let n = 1; n < 50; n++) {
        term *= q / (n * n);
        sum  += term;
        if (term < 1.0e-20 * sum) break;
      }
      return sum;
    };

    // ── Halfband FIR design (must match C++) ────────────────────────
    const kTaps = 63;
    const beta  = 10.0;
    const i0Beta = besselI0(beta);
    const N    = kTaps - 1;            // 62
    const half = (kTaps / 2) | 0;      // 31
    const hb = new Float64Array(kTaps);
    for (let n = 0; n < kTaps; n++) {
      const m = n - half;              // -31..+31
      let sinc;
      if (m === 0)              sinc = 0.5;
      else if ((m & 1) === 0)   sinc = 0.0;
      else                      sinc = Math.sin(0.5 * Math.PI * m) / (Math.PI * m);
      const r = (2 * n - N) / N;       // -1..+1
      const a = beta * Math.sqrt(1 - r * r);
      const w = besselI0(a) / i0Beta;
      hb[n] = sinc * w;
    }

    // ── Circular buffers + push/convolve helper ─────────────────────
    const upBuf = new Float64Array(kTaps);
    const dnBuf = new Float64Array(kTaps);
    let upIdx = 0, dnIdx = 0;
    const push = (buf, idxRef, x) => {
      buf[idxRef.i] = x;
      idxRef.i = (idxRef.i + 1) % kTaps;
      let y = 0;
      let j = idxRef.i;
      for (let t = 0; t < kTaps; t++) {
        y += hb[t] * buf[j];
        j = (j + 1) % kTaps;
      }
      return y;
    };
    const upRef = { i: 0 }, dnRef = { i: 0 };

    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x   = 2.0 * input[i];                       // gain comp for zero-stuff
      const up0 = push(upBuf, upRef, x);
      const up1 = push(upBuf, upRef, 0.0);
      const s0  = Math.tanh(k * up0) * inv;
      const s1  = Math.tanh(k * up1) * inv;
      push(dnBuf, dnRef, s0);                            // discarded
      const dn  = push(dnBuf, dnRef, s1);
      out[i] = Math.fround(dn);
    }
    return out;
  },
  // Source ops — input is ignored (op has no input port).
  'builtin:constant': (input, args) => {
    const v = Number(args.value ?? 0);
    const out = new Float32Array(input.length);
    out.fill(v);
    return out;
  },
  // saturate — drive-scaled Padé rational tanh, post-trim in dB. Stateless.
  // Mirror op_saturate.cpp.jinja exactly.
  'builtin:saturate': (input, args) => {
    const drive = Math.max(0.01, Number(args.drive ?? 1));
    const trimLin = Math.pow(10, Number(args.trim ?? 0) / 20);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let u = input[i] * drive;
      if (u >  3) u =  3;
      else if (u < -3) u = -3;
      const u2 = u * u;
      out[i] = Math.fround(trimLin * u * (27 + u2) / (27 + 9 * u2));
    }
    return out;
  },
  // bitcrush — bit-depth quantization. bits=0 = bypass. Stateless.
  'builtin:bitcrush': (input, args) => {
    const raw = Math.round(Number(args.bits ?? 0));
    const bits = (!Number.isFinite(raw) || raw < 0 || raw > 16) ? 0 : raw;
    const out = new Float32Array(input.length);
    if (bits === 0) { out.set(input); return out; }
    const invStep = (1 << bits) * 0.5;
    const step    = 1 / invStep;
    for (let i = 0; i < input.length; i++) {
      out[i] = Math.fround(Math.round(input[i] * invStep) * step);
    }
    return out;
  },
  // hardClip — sign-preserving symmetric clip at ±threshold, opt ADAA.
  // Canon §5 (de Soras 2004) + Parker-Esqueda-Bilbao DAFx 2016 ADAA.
  'builtin:hardClip': (input, args) => {
    const drive = Number.isFinite(+args.drive) ? Math.max(0.01, +args.drive) : 1;
    const tRaw = +args.threshold;
    const T = Number.isFinite(tRaw) ? Math.max(1e-6, Math.min(1, tRaw)) : 1;
    const trimLin = Number.isFinite(+args.trim) ? Math.pow(10, +args.trim / 20) : 1;
    const useAdaa = !!args.adaa;
    const out = new Float32Array(input.length);
    if (!useAdaa) {
      for (let i = 0; i < input.length; i++) {
        const u = input[i] * drive;
        const y = 0.5 * (Math.abs(u + T) - Math.abs(u - T));
        out[i] = Math.fround(trimLin * y);
      }
      return out;
    }
    const F_anti = (u, T) => (u >  T) ? T*u - 0.5*T*T
                          : (u < -T) ? -T*u - 0.5*T*T
                          : 0.5*u*u;
    const f_clip = (u, T) => 0.5 * (Math.abs(u + T) - Math.abs(u - T));
    const EPS_DIV = 1e-6;
    let x1 = 0, F1 = 0;
    for (let i = 0; i < input.length; i++) {
      const u = input[i] * drive;
      const Fu = F_anti(u, T);
      let y;
      const dx = u - x1;
      if (Math.abs(dx) < EPS_DIV) {
        y = 0.5 * (f_clip(u, T) + f_clip(x1, T));
      } else {
        y = (Fu - F1) / dx;
      }
      out[i] = Math.fround(trimLin * y);
      x1 = u;
      F1 = Fu;
    }
    return out;
  },
  // chebyshevWS — Chebyshev T_1..T_5 weighted polynomial sum. Stateless.
  'builtin:chebyshevWS': (input, args) => {
    const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, +x));
    const g1 = Number.isFinite(+args.g1) ? clip(args.g1, -2, 2) : 1;
    const g2 = Number.isFinite(+args.g2) ? clip(args.g2, -2, 2) : 0;
    const g3 = Number.isFinite(+args.g3) ? clip(args.g3, -2, 2) : 0;
    const g4 = Number.isFinite(+args.g4) ? clip(args.g4, -2, 2) : 0;
    const g5 = Number.isFinite(+args.g5) ? clip(args.g5, -2, 2) : 0;
    const lvl = Number.isFinite(+args.level) ? clip(args.level, 0, 4) : 1;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let x = input[i];
      if (x >  1) x =  1;
      else if (x < -1) x = -1;
      const x2 = x * x, x3 = x2 * x, x4 = x2 * x2, x5 = x4 * x;
      const T1 = x;
      const T2 = 2 * x2 - 1;
      const T3 = 4 * x3 - 3 * x;
      const T4 = 8 * x4 - 8 * x2 + 1;
      const T5 = 16 * x5 - 20 * x3 + 5 * x;
      out[i] = Math.fround(lvl * (g1 * T1 + g2 * T2 + g3 * T3 + g4 * T4 + g5 * T5));
    }
    return out;
  },
  // softLimit — Padé rational tanh per Canon:character §11. Stateless.
  // Mirror op_softLimit.cpp.jinja exactly — math runs in doubles, cast to f32.
  'builtin:softLimit': (input, args) => {
    const T = Math.max(0.01, Number(args.threshold ?? 0.95));
    const invT = 1 / T;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let u = input[i] * invT;
      if (u >  3) u =  3;
      else if (u < -3) u = -3;
      const u2 = u * u;
      out[i] = Math.fround(T * u * (27 + u2) / (27 + 9 * u2));
    }
    return out;
  },
  // wavefolder — Faust ef.wavefold (David Braun MIT, citing Zölzer 2022).
  'builtin:wavefolder': (input, args) => {
    const drive = Number.isFinite(+args.drive) ? Math.max(0.01, +args.drive) : 1;
    const widthRaw = Number.isFinite(+args.width) ? Math.min(1, Math.max(0, +args.width)) : 0.5;
    const trimLin = Number.isFinite(+args.trim) ? Math.pow(10, +args.trim / 20) : 1;
    const a = widthRaw * 0.4;
    const thr = 1 - 2 * a;
    const g = 1 / Math.max(1e-9, thr);
    const twoA = 2 * a;
    const triBase = 1 - 2.5 * a;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let x = input[i] * drive;
      const sign = x < 0 ? -1 : 1;
      const ax = sign * x;
      let y;
      if (ax > thr && a > 0) {
        const u = (ax - thr) / twoA;
        const f = u - Math.floor(u);
        const tri = triBase + a * Math.abs(f - 0.5);
        y = tri * g;
      } else {
        y = ax * g;
      }
      out[i] = Math.fround(trimLin * sign * y);
    }
    return out;
  },
  // diodeClipper — closed-form arcsinh (Yeh DAFx 2008) + asym extension.
  'builtin:diodeClipper': (input, args) => {
    const drive = Number.isFinite(+args.drive) ? Math.max(0.01, +args.drive) : 1;
    const asym  = Number.isFinite(+args.asym)  ? Math.min(1, Math.max(0, +args.asym)) : 0;
    const trimLin = Number.isFinite(+args.trim) ? Math.pow(10, +args.trim / 20) : 1;
    const driveP = drive;
    const driveN = drive * (1 - asym);
    const normP  = 1 / Math.asinh(driveP);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const d = x >= 0 ? driveP : driveN;
      out[i] = Math.fround(trimLin * normP * Math.asinh(d * x));
    }
    return out;
  },
  // shelf — RBJ cookbook shelf biquad (DF1, S=1).
  'builtin:shelf': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const mode = String(args.mode ?? 'low'); // 'low' | 'high'
    const gainDb = Number(args.gainDb ?? 0);
    const freq = Number(args.freq ?? 200);
    const nyq = 0.5 * sr - 100;
    const f0 = Math.min(Math.max(freq, 10), nyq);
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * f0 / sr;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 * Math.SQRT1_2;
    const twoSqrtA_alpha = 2 * Math.sqrt(A) * alpha;
    let b0, b1, b2, a0, a1, a2;
    if (mode === 'high') {
      b0 =    A * ((A + 1) + (A - 1) * cosw0 + twoSqrtA_alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
      b2 =    A * ((A + 1) + (A - 1) * cosw0 - twoSqrtA_alpha);
      a0 =        (A + 1) - (A - 1) * cosw0 + twoSqrtA_alpha;
      a1 =    2 * ((A - 1) - (A + 1) * cosw0);
      a2 =        (A + 1) - (A - 1) * cosw0 - twoSqrtA_alpha;
    } else {
      b0 =    A * ((A + 1) - (A - 1) * cosw0 + twoSqrtA_alpha);
      b1 =  2 * A * ((A - 1) - (A + 1) * cosw0);
      b2 =    A * ((A + 1) - (A - 1) * cosw0 - twoSqrtA_alpha);
      a0 =        (A + 1) + (A - 1) * cosw0 + twoSqrtA_alpha;
      a1 =   -2 * ((A - 1) + (A + 1) * cosw0);
      a2 =        (A + 1) + (A - 1) * cosw0 - twoSqrtA_alpha;
    }
    const inv_a0 = 1 / a0;
    const B0 = b0 * inv_a0, B1 = b1 * inv_a0, B2 = b2 * inv_a0;
    const A1 = a1 * inv_a0, A2 = a2 * inv_a0;
    const out = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const DENORMAL = 1e-30;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      let y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      x2 = x1; x1 = x;
      y2 = y1; y1 = y;
      out[i] = Math.fround(y);
    }
    return out;
  },
  // allpass — 1st-order, |H|=1 ∀ ω. y[n] = a·(x[n]−y[n−1]) + x[n−1].
  'builtin:allpass': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const freq = Number(args.freq ?? 1000);
    const nyq = 0.5 * sr - 100;
    const fc = Math.min(Math.max(freq, 1), nyq);
    const t = Math.tan(Math.PI * fc / sr);
    const a = (t - 1) / (t + 1);
    const out = new Float32Array(input.length);
    let x1 = 0, y1 = 0;
    const DENORMAL = 1e-30;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      let y = a * (x - y1) + x1;
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      x1 = x; y1 = y;
      out[i] = Math.fround(y);
    }
    return out;
  },
  // tilt — musicdsp #267 (Lubomir Ivanov 2009), Math.PI deviation.
  'builtin:tilt': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const f0 = Math.min(Math.max(Number(args.f0 ?? 630), 1), sr * 0.49);
    const gain = Math.min(Math.max(Number(args.gain ?? 0), -24), 24);
    const gfactor = Math.min(Math.max(Number(args.gfactor ?? 5), 0.01), 100);
    const amp = 6 / Math.log(2);
    const sr3 = 3 * sr;
    let g1, g2;
    if (gain > 0) { g1 = -gfactor * gain; g2 =  gain;            }
    else          { g1 = -gain;            g2 =  gfactor * gain; }
    const lgain = Math.exp(g1 / amp) - 1;
    const hgain = Math.exp(g2 / amp) - 1;
    const omega = 2 * Math.PI * f0;
    const n = 1 / (sr3 + omega);
    const a0 = 2 * omega * n;
    const b1 = (sr3 - omega) * n;
    const out = new Float32Array(input.length);
    let lp = 0;
    const DENORMAL = 1e-30;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      lp = a0 * x + b1 * lp;
      if (lp > -DENORMAL && lp < DENORMAL) lp = 0;
      out[i] = Math.fround(x + lgain * lp + hgain * (x - lp));
    }
    return out;
  },
  // smooth — one-pole LP param smoother (τ in seconds).
  'builtin:smooth': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const time = Math.max(0, Number(args.time ?? 0.01));
    const alpha = (time > 0) ? (1 - Math.exp(-1 / (time * sr))) : 1;
    const out = new Float32Array(input.length);
    const DENORMAL = 1e-30;
    if (alpha >= 1) { for (let i = 0; i < input.length; i++) out[i] = Math.fround(input[i]); return out; }
    let y = 0;
    for (let i = 0; i < input.length; i++) {
      y += alpha * (input[i] - y);
      if (y < DENORMAL && y > -DENORMAL) y = 0;
      out[i] = Math.fround(y);
    }
    return out;
  },
  // slew — linear rate slew limiter (asymmetric rise/fall).
  'builtin:slew': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clamp = (n) => n < 0.001 ? 0.001 : (n > 10000 ? 10000 : n);
    const riseMs = clamp(Number(args.riseMs ?? 10));
    const fallMs = clamp(Number(args.fallMs ?? 50));
    const up   = 1.0 / (riseMs * sr * 0.001);
    const down = 1.0 / (fallMs * sr * 0.001);
    const out = new Float32Array(input.length);
    let y = 0;
    for (let i = 0; i < input.length; i++) {
      const target = input[i];
      const delta = target - y;
      if (delta > up) y += up;
      else if (delta < -down) y -= down;
      else y = target;
      out[i] = Math.fround(y);
    }
    return out;
  },
  // korg35 — Stinchcombe-derived v2-full. Mirrors op_korg35.worklet.js /
  // op_korg35.cpp.jinja. Primary: docs/primary_sources/stinchcombe/MS20_study.pdf
  // §2.2 eq.(8) p.12 (a=7/3 SK loading), §3.2 p.29 (f_c=87·exp(V_f/1.3)),
  // §5 pp.30–31 (forward-path diode shaper, gain=58, V_d=0.5).
  'builtin:korg35': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const normFreq = clip(Number(args.normFreq ?? 0.5), 0, 1);
    const Q = clip(Number(args.Q ?? 3.5), 0.7, 10);
    const trim = clip(Number(args.trim ?? 0), -24, 12);
    const A_LOADING = 7 / 3, M_FB = 1 / 3;
    const DIODE_GAIN = 58.0, DIODE_VD = 0.5;
    const FC_BASE = 87.0, FC_TAU = 1.3;
    const T = 1 / sr;
    const V_f = 10 * normFreq - 5;
    const f_c = FC_BASE * Math.exp(V_f / FC_TAU);
    const wd = 2 * Math.PI * f_c;
    const preArg = Math.min(wd * T / 2, Math.PI / 2 - 1e-4);
    const g = Math.tan(preArg);
    const G = g / (1 + g);
    const invOnePlusG = 1 / (1 + G);
    const invSqrt2 = 1 / Math.sqrt(2);
    const Kraw = A_LOADING * (Q - invSqrt2) / (10 - invSqrt2);
    const K = clip(Kraw, 0, A_LOADING - 1e-3);
    const trimLin = Math.pow(10, trim / 20);
    const dGm1 = DIODE_GAIN - 1, invVd = 1 / DIODE_VD;
    let s1 = 0, s2 = 0, y2_prev = 0;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const arg_p = dGm1 * y2_prev * invVd;
      const th_p = Math.tanh(arg_p);
      const gprime = 1 + dGm1 * (1 - th_p * th_p);
      const K_dyn = K * gprime;
      const alpha0 = (1 + G) / (1 + (A_LOADING - K_dyn) * G + G * G);
      const s2_eff = s2 * invOnePlusG;
      const y1 = alpha0 * (G * x + s1 + G * (M_FB - K_dyn) * s2_eff);
      const y2 = (G * y1 + s2) * invOnePlusG;
      const arg = dGm1 * y2 * invVd;
      const y_out = y2 + DIODE_VD * Math.tanh(arg);
      s1 = 2 * y1 - s1;
      s2 = 2 * y2 - s2;
      y2_prev = y2;
      out[i] = Math.fround(trimLin * y_out);
    }
    return out;
  },
  // diodeLadder — v3 Layer 2: TB-303 character. Stinchcombe-direct
  // (Moog_ladder_tf.pdf §3.2 p.34, d=1 C_1=C/2 config) core matrix +
  // five fixed coupling-cap sections (diode2.html, 1.06 numerator) +
  // tanh on driver pair + 2× polyphase OS (63-tap Kaiser β=10 halfband).
  // FB tap = post-network output (y_post_prev). Mirrors
  // op_diodeLadder.worklet.js / op_diodeLadder.cpp.jinja bit-for-bit.
  'builtin:diodeLadder': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const normFreq = clip(Number(args.normFreq ?? 0.4), 0,    1);
    const Q        = clip(Number(args.Q        ?? 4.0), 0.7,  20);
    const drive    = clip(Number(args.drive    ?? 1.0), 0,    1);
    const trim     = clip(Number(args.trim     ?? 0  ), -24,  12);

    const TB_ROW0 = Math.pow(2, 0.75);    // 2^(3/4)
    const TB_ROWN = Math.pow(2, -0.25);   // 2^(-1/4)
    const POST_GAIN = 1.06;

    // Halfband design (63 taps, Kaiser β=10).
    const kTaps = 63;
    const beta = 10.0;
    const besselI0 = (x) => {
      let s = 1.0, t = 1.0;
      const q = x * x * 0.25;
      for (let m = 1; m < 50; m++) {
        t *= q / (m * m);
        s += t;
        if (t < 1.0e-20 * s) break;
      }
      return s;
    };
    const i0Beta = besselI0(beta);
    const hb = new Float64Array(kTaps);
    {
      const N = kTaps - 1;
      const half = kTaps >> 1;
      for (let n = 0; n < kTaps; n++) {
        const m = n - half;
        let sinc;
        if (m === 0)             sinc = 0.5;
        else if ((m & 1) === 0)  sinc = 0.0;
        else                     sinc = Math.sin(0.5 * Math.PI * m) / (Math.PI * m);
        const r = (2 * n - N) / N;
        const a = beta * Math.sqrt(1 - r * r);
        hb[n] = sinc * (besselI0(a) / i0Beta);
      }
    }

    const sr2  = 2 * sr;
    const nyq2 = 0.5 * sr2 - 100;

    // Coupling-cap section design (fixed coefficients, sr-only dependent).
    const COUP_ZA = [   0.0, 109.9,   0.0,  0.0,  34.0 ];
    const COUP_PA = [  97.5, 578.1,  38.5,  4.45, 20.0 ];
    const cb0 = new Float64Array(5);
    const cb1 = new Float64Array(5);
    const ca1 = new Float64Array(5);
    {
      const T = 1 / sr2;
      for (let i = 0; i < 5; i++) {
        const az = COUP_ZA[i] * T * 0.5;
        const ap = COUP_PA[i] * T * 0.5;
        const inv = 1 / (1 + ap);
        cb0[i] =  (1 + az) * inv;
        cb1[i] = -(1 - az) * inv;
        ca1[i] = -(1 - ap) * inv;
      }
    }

    // Coefficient build (TB-303 row-scaled state-space, bilinear pre-warp).
    const fc   = clip(2 * Math.pow(10, 3 * normFreq + 1), 20, nyq2);
    const aWarp = clip(Math.tan(Math.PI * fc / sr2), 1e-9, 1e9);
    const k = clip((Q - 0.7) * 10 / (20 - 0.7), 0, 10);

    const r0 = TB_ROW0, rN = TB_ROWN;

    // (I − α·A_tb) and (I + α·A_tb).
    const L00 = 1 + aWarp*r0,   L01 = -aWarp*r0,        L02 = 0,                L03 = 0;
    const L10 = -aWarp*rN,      L11 = 1 + 2*aWarp*rN,   L12 = -aWarp*rN,        L13 = 0;
    const L20 = 0,              L21 = -aWarp*rN,        L22 = 1 + 2*aWarp*rN,   L23 = -aWarp*rN;
    const L30 = 0,              L31 = 0,                L32 = -aWarp*rN,        L33 = 1 + 2*aWarp*rN;

    const R00 = 1 - aWarp*r0,   R01 =  aWarp*r0,        R02 = 0,                R03 = 0;
    const R10 =  aWarp*rN,      R11 = 1 - 2*aWarp*rN,   R12 =  aWarp*rN,        R13 = 0;
    const R20 = 0,              R21 =  aWarp*rN,        R22 = 1 - 2*aWarp*rN,   R23 =  aWarp*rN;
    const R30 = 0,              R31 = 0,                R32 =  aWarp*rN,        R33 = 1 - 2*aWarp*rN;

    // 4×4 Gauss with partial pivoting.
    const solve = (r0v, r1v, r2v, r3v) => {
      const A = [
        [L00, L01, L02, L03, r0v],
        [L10, L11, L12, L13, r1v],
        [L20, L21, L22, L23, r2v],
        [L30, L31, L32, L33, r3v],
      ];
      for (let p = 0; p < 4; p++) {
        let piv = p;
        let pivAbs = Math.abs(A[p][p]);
        for (let r = p + 1; r < 4; r++) {
          const v = Math.abs(A[r][p]);
          if (v > pivAbs) { piv = r; pivAbs = v; }
        }
        if (piv !== p) { const tmp = A[p]; A[p] = A[piv]; A[piv] = tmp; }
        const inv = 1 / A[p][p];
        for (let r = p + 1; r < 4; r++) {
          const f = A[r][p] * inv;
          for (let c = p; c < 5; c++) A[r][c] -= f * A[p][c];
        }
      }
      const x = [0, 0, 0, 0];
      for (let r = 3; r >= 0; r--) {
        let s = A[r][4];
        for (let c = r + 1; c < 4; c++) s -= A[r][c] * x[c];
        x[r] = s / A[r][r];
      }
      return x;
    };

    const c0v = solve(R00, R10, R20, R30);
    const c1v = solve(R01, R11, R21, R31);
    const c2v = solve(R02, R12, R22, R32);
    const c3v = solve(R03, R13, R23, R33);

    // A_d row-major.
    const Ad = new Float64Array(16);
    Ad[0]  = c0v[0]; Ad[1]  = c1v[0]; Ad[2]  = c2v[0]; Ad[3]  = c3v[0];
    Ad[4]  = c0v[1]; Ad[5]  = c1v[1]; Ad[6]  = c2v[1]; Ad[7]  = c3v[1];
    Ad[8]  = c0v[2]; Ad[9]  = c1v[2]; Ad[10] = c2v[2]; Ad[11] = c3v[2];
    Ad[12] = c0v[3]; Ad[13] = c1v[3]; Ad[14] = c2v[3]; Ad[15] = c3v[3];

    const bdv = solve(-2 * aWarp * r0, 0, 0, 0);
    const bd  = new Float64Array(4);
    bd[0] = bdv[0]; bd[1] = bdv[1]; bd[2] = bdv[2]; bd[3] = bdv[3];

    const trimLin = Math.pow(10, trim / 20);

    // State.
    let x0 = 0, x1 = 0, x2 = 0, x3 = 0;
    const cxp = new Float64Array(5);
    const cyp = new Float64Array(5);
    let yPostPrev = 0, uPrev = 0;
    const upBuf = new Float64Array(kTaps);
    const dnBuf = new Float64Array(kTaps);
    let upIdx = 0, dnIdx = 0;

    const pushAndConvolve = (buf, idxArr, x) => {
      let idx = idxArr[0];
      buf[idx] = x;
      idx = (idx + 1) % kTaps;
      let y = 0;
      let j = idx;
      for (let t = 0; t < kTaps; t++) {
        y += hb[t] * buf[j];
        j = (j + 1) % kTaps;
      }
      idxArr[0] = idx;
      return y;
    };

    const sect = (i, x) => {
      const y = cb0[i] * x + cb1[i] * cxp[i] - ca1[i] * cyp[i];
      cxp[i] = x;
      cyp[i] = y;
      return y;
    };

    const ladderStep = (xin) => {
      // Pre-network.
      const p0 = sect(0, xin);
      const p1 = sect(1, p0);
      // Driver tanh on (drive·p1 − k·y_post_prev).
      const u = Math.tanh(drive * p1 - k * yPostPrev);
      const u_avg = 0.5 * (u + uPrev);
      // Core.
      const n0 = Ad[0]*x0 + Ad[1]*x1 + Ad[2]*x2 + Ad[3]*x3 + bd[0]*u_avg;
      const n1 = Ad[4]*x0 + Ad[5]*x1 + Ad[6]*x2 + Ad[7]*x3 + bd[1]*u_avg;
      const n2 = Ad[8]*x0 + Ad[9]*x1 + Ad[10]*x2 + Ad[11]*x3 + bd[2]*u_avg;
      const n3 = Ad[12]*x0 + Ad[13]*x1 + Ad[14]*x2 + Ad[15]*x3 + bd[3]*u_avg;
      x0 = n0; x1 = n1; x2 = n2; x3 = n3;
      uPrev = u;
      // Post-network.
      const q0 = sect(2, n3);
      const q1 = sect(3, q0);
      const q2 = sect(4, q1);
      const yp = POST_GAIN * q2;
      yPostPrev = yp;
      return yp;
    };

    const out = new Float32Array(input.length);
    const upRef = [upIdx];
    const dnRef = [dnIdx];
    for (let i = 0; i < input.length; i++) {
      const xv = 2 * input[i];
      const up0 = pushAndConvolve(upBuf, upRef, xv);
      const up1 = pushAndConvolve(upBuf, upRef, 0);
      const y0 = ladderStep(up0);
      const y1 = ladderStep(up1);
      pushAndConvolve(dnBuf, dnRef, y0);                  // discarded
      const dn = pushAndConvolve(dnBuf, dnRef, y1);
      out[i] = Math.fround(trimLin * dn);
    }
    return out;
  },
  // xformerSat — De Paiva 2011 WDF transformer (Stage 2). Flux-tracker LP
  // → Eq 34 NL-cap modulating HP through-path corner; Rc hysteresis (Eq 17,
  // m=3, §3.3 unit-delay) on HP output; HF leakage 1-pole LP. Mirrors
  // op_xformerSat.worklet.js bit-for-bit (same op order, same constants).
  'builtin:xformerSat': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const driveDb = clip(Number(args.drive    ?? 0),   -24, 36);
    const a       = clip(Number(args.coreSize ?? 1),    0.05, 10);
    const rs      = clip(Number(args.sourceZ  ?? 600),  1, 10000);
    const b       = clip(Number(args.loss     ?? 0.3),  0, 1);
    const air     = clip(Number(args.air      ?? 1),    0.1, 8);

    const DENORMAL = 1e-30;
    const LOSS_SCALE = 0.25;
    const FC_LF_BASE = 25;
    const FC_HF_BASE = 12000;
    const G_HP_MAX = 0.999;
    const G_HP_MIN = 1e-8;
    const TWO_PI = 2 * Math.PI;

    const driveLin = Math.pow(10, driveDb / 20);
    const fcLf = FC_LF_BASE * (rs / 600);
    let gLfBase = (TWO_PI * fcLf) / sr;
    if (gLfBase < G_HP_MIN) gLfBase = G_HP_MIN;
    if (gLfBase > 0.5)      gLfBase = 0.5;
    const fcHf = FC_HF_BASE * air;
    let aHf = 1 - Math.exp(-TWO_PI * fcHf / sr);
    if (aHf < 1e-6)   aHf = 1e-6;
    if (aHf > 0.99999) aHf = 0.99999;

    let phi = 0, yHp = 0, xPrev = 0, yHf = 0, vrPrev = 0;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const xd = driveLin * input[i];
      phi = phi + gLfBase * (xd - phi);
      if (phi < DENORMAL && phi > -DENORMAL) phi = 0;
      const sat = a * phi * phi;
      let gEff = gLfBase * (1 + sat);
      if (gEff > G_HP_MAX) gEff = G_HP_MAX;
      const Rhp = 1 - gEff;
      yHp = Rhp * yHp + (xd - xPrev);
      xPrev = xd;
      if (yHp < DENORMAL && yHp > -DENORMAL) yHp = 0;
      const ir = b * vrPrev * (vrPrev < 0 ? -vrPrev : vrPrev);
      const yLoss = yHp - LOSS_SCALE * ir;
      vrPrev = yHp;
      yHf = yHf + aHf * (yLoss - yHf);
      if (yHf < DENORMAL && yHf > -DENORMAL) yHf = 0;
      out[i] = Math.fround(yHf);
    }
    return out;
  },
  // diodeBridgeGR — phenomenological diode-bridge GR cell (Neve 33609/2254).
  // Mirror op_diodeBridgeGR.worklet.js bit-for-bit.
  'builtin:diodeBridgeGR': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const cutoffScale   = clip(Number(args.cutoffScale   ?? 8),   0.5,  30);
    const curveExponent = clip(Number(args.curveExponent ?? 1.8), 1.0,  3.0);
    const distortion    = clip(Number(args.distortion    ?? 0.10),0,    0.5);
    const asymmetry     = clip(Number(args.asymmetry     ?? 0.0), -0.3, 0.3);
    const trim          = clip(Number(args.trim          ?? 0),   -24,  24);
    const LN10_OVER_20 = 0.11512925464970228;
    const trimLin = Math.exp(trim * LN10_OVER_20);
    const out = new Float32Array(input.length);
    // Smoke: cv=0 → unity gain → pass-through (no distortion since comprDepth=0).
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const yClean = x * 1.0;
      const comprDepth = 0;
      const xCubed = x * x * x;
      const yOdd  = distortion * comprDepth * xCubed * 1.0;  // = 0
      const absY  = yClean < 0 ? -yClean : yClean;
      const yEven = asymmetry * comprDepth * absY;            // = 0
      out[i] = Math.fround((yClean + yOdd + yEven) * trimLin);
    }
    return out;
  },
  // fetVVR — phenomenological JFET-VVR GR cell (UREI 1176 family).
  // Mirror op_fetVVR.worklet.js bit-for-bit.
  'builtin:fetVVR': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const cutoffScale   = clip(Number(args.cutoffScale   ?? 5),   0.5, 30);
    const curveExponent = clip(Number(args.curveExponent ?? 2.0), 1.0, 4.0);
    const distortion2H  = clip(Number(args.distortion2H  ?? 0.1), 0,   0.5);
    const distortion3H  = clip(Number(args.distortion3H  ?? 0.05),0,   0.5);
    const trim          = clip(Number(args.trim          ?? 0),   -24, 24);
    const LN10_OVER_20 = 0.11512925464970228;
    const trimLin = Math.exp(trim * LN10_OVER_20);
    const out = new Float32Array(input.length);
    // Smoke graph routes only `audio` (no cv) → cv=0 → unity gain, no distortion.
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const yClean = x * 1.0;  // gain=1 at cv=0
      const comprDepth = 0;
      const absY = yClean < 0 ? -yClean : yClean;
      const yEven = distortion2H * comprDepth * absY;        // = 0
      const yOdd  = distortion3H * comprDepth * yClean * absY; // = 0
      out[i] = Math.fround((yClean + yEven + yOdd) * trimLin);
    }
    return out;
  },
  // varMuTube — phenomenological variable-mu tube GR cell.
  // Mirror op_varMuTube.worklet.js bit-for-bit.
  'builtin:varMuTube': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const cutoffScale   = clip(Number(args.cutoffScale   ?? 10),  1,    50);
    const curveExponent = clip(Number(args.curveExponent ?? 1.5), 0.5,  3.0);
    const distortion    = clip(Number(args.distortion    ?? 0.1), 0,    0.5);
    const trim          = clip(Number(args.trim          ?? 0),   -24,  24);
    const LN10_OVER_20 = 0.11512925464970228;
    const trimLin = Math.exp(trim * LN10_OVER_20);
    const invCutoff = 1 / cutoffScale;
    const out = new Float32Array(input.length);
    // Smoke graph routes only `audio` (no cv) → cv=0 → unity gain → pass-through.
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      // cv = 0 → cvPos = 0 → norm = 0 → normPowBeta = 0 → gain = 1.
      const yClean = x * 1.0;
      const comprDepth = 0;  // 1 - gain
      const distScale  = distortion * comprDepth;  // = 0
      const absY = yClean < 0 ? -yClean : yClean;
      const yChar = distScale * absY;  // = 0
      out[i] = Math.fround((yClean + yChar) * trimLin);
    }
    return out;
  },
  // blackmerVCA — log-add-antilog VCA per Blackmer US Patent 3,714,462.
  // Memoryless. Mirror op_blackmerVCA.worklet.js bit-for-bit.
  'builtin:blackmerVCA': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const bias = clip(Number(args.bias ?? 0.0), -0.5, 0.5);
    const trim = clip(Number(args.trim ?? 0.0), -24, 24);
    const LN10_OVER_20 = 0.11512925464970228;
    const trimLin = Math.exp(trim * LN10_OVER_20);
    const out = new Float32Array(input.length);
    // Smoke graph routes only `audio` (no cv) → cv defaults to 0 → unity gain.
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const yClean = x * 1.0;  // gain = exp(0) = 1
      const absY = yClean < 0 ? -yClean : yClean;
      const yChar = bias * absY;
      out[i] = Math.fround((yClean + yChar) * trimLin);
    }
    return out;
  },
  // optoCell — phenomenological LA-2A T4-style optical GR cell.
  // Mirror op_optoCell.worklet.js bit-for-bit (double-precision math,
  // identical state evolution). See worklet header for primary citations.
  'builtin:optoCell': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const clip = (x, lo, hi) => x < lo ? lo : (x > hi ? hi : x);
    const attackMs       = clip(Number(args.attackMs       ?? 10),  0.1,  100);
    const releaseMsFast  = clip(Number(args.releaseMsFast  ?? 60),  5,    500);
    const releaseSecSlow = clip(Number(args.releaseSecSlow ?? 5),   0.5,  15);
    const responsivity   = clip(Number(args.responsivity   ?? 1.0), 0.05, 4.0);

    const tauToAlpha = (tauSec) => {
      if (tauSec <= 0) return 1;
      return 1 - Math.exp(-1 / (tauSec * sr));
    };
    const aAttack      = tauToAlpha(attackMs      * 1e-3);
    const aReleaseFast = tauToAlpha(releaseMsFast * 1e-3);
    const aSlow        = tauToAlpha(releaseSecSlow);

    const DENORMAL = 1e-30;
    let envFast = 0, envSlow = 0;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const v = input[i];
      const cvPos = v > 0 ? v : 0;
      const aFast = (cvPos > envFast) ? aAttack : aReleaseFast;
      envFast = envFast + aFast * (cvPos - envFast);
      if (envFast < DENORMAL) envFast = 0;
      envSlow = envSlow + aSlow * (envFast - envSlow);
      if (envSlow < DENORMAL) envSlow = 0;
      const env = envFast > envSlow ? envFast : envSlow;
      const env2 = env * env;
      out[i] = Math.fround(1 / (1 + responsivity * env2));
    }
    return out;
  },
  // srcResampler — polyphase Kaiser-windowed-sinc varispeed reader.
  // Mirror op_srcResampler.worklet.js bit-for-bit (double-precision math,
  // identical kernel construction). See worklet header for primary citation.
  'builtin:srcResampler': (input, args) => {
    const sr = Number(args.sr ?? 48000);
    const speed = Math.max(0.25, Math.min(4.0, Number(args.speed ?? 1.0)));

    const NZ = 8, L = 32, KAISER_BETA = 7.0, KBUF = 4096;
    const TABLE_LEN = NZ * L + 1;

    const besselI0 = (x) => {
      const ax = Math.abs(x);
      if (ax < 3.75) {
        const y = (x / 3.75) ** 2;
        return 1 + y*(3.5156229 + y*(3.0899424 + y*(1.2067492 +
               y*(0.2659732 + y*(0.0360768 + y*0.0045813)))));
      }
      const y = 3.75 / ax;
      return (Math.exp(ax) / Math.sqrt(ax)) * (
        0.39894228 + y*(0.01328592 + y*(0.00225319 + y*(-0.00157565 +
        y*(0.00916281 + y*(-0.02057706 + y*(0.02635537 +
        y*(-0.01647633 + y*0.00392377))))))));
    };
    const h  = new Float64Array(TABLE_LEN);
    const hd = new Float64Array(TABLE_LEN - 1);
    const inv_I0_beta = 1 / besselI0(KAISER_BETA);
    for (let l = 0; l < TABLE_LEN; l++) {
      const t = l / L;
      let sinc_t;
      if (l === 0) sinc_t = 1.0;
      else { const pt = Math.PI * t; sinc_t = Math.sin(pt) / pt; }
      const r = t / NZ;
      const winArg = (r >= 1) ? 0 : Math.sqrt(1 - r * r);
      h[l] = sinc_t * besselI0(KAISER_BETA * winArg) * inv_I0_beta;
    }
    for (let l = 0; l < TABLE_LEN - 1; l++) hd[l] = h[l + 1] - h[l];

    const xbuf = new Float64Array(KBUF);
    let wpos = 0, phase = NZ;
    const phaseInc = 1.0 - speed;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      xbuf[wpos] = input[i];
      wpos = (wpos + 1) % KBUF;
      let pClamped = phase;
      if (pClamped < NZ) pClamped = NZ;
      else if (pClamped > KBUF - NZ - 1) pClamped = KBUF - NZ - 1;
      const phaseFloor = Math.floor(pClamped);
      const phaseFrac  = pClamped - phaseFloor;
      const anchorLag  = (phaseFrac === 0) ? phaseFloor : (phaseFloor + 1);
      const P          = anchorLag - pClamped;
      const Pleft  = P;
      const Pright = 1 - P;
      const lLeftF  = Pleft  * L;
      const lRightF = Pright * L;
      let lLeft  = Math.floor(lLeftF);
      let lRight = Math.floor(lRightF);
      let etaL = lLeftF - lLeft;
      let etaR = lRightF - lRight;
      if (lLeft  >= L) { lLeft  = L - 1; etaL = 1 - 1e-15; }
      if (lRight >= L) { lRight = L - 1; etaR = 1 - 1e-15; }
      const base = wpos - 1 - anchorLag + KBUF;
      let v = 0, vr = 0;
      for (let k = 0; k < NZ; k++) {
        const x_k = xbuf[(base - k) % KBUF];
        const ti = lLeft + k * L;
        v += x_k * (h[ti] + etaL * hd[ti]);
      }
      for (let k = 0; k < NZ; k++) {
        const x_kp1 = xbuf[(base + 1 + k) % KBUF];
        const ti = lRight + k * L;
        vr += x_kp1 * (h[ti] + etaR * hd[ti]);
      }
      out[i] = Math.fround(v + vr);
      phase += phaseInc;
    }
    return out;
  },
  // gain → gain (used by smoke chain)
  'builtin:gain_chain2': (input, args) => {
    const a = args.a ?? 0;
    const b = args.b ?? 0;
    const base = Math.pow(10, (a + b) / 20);
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * base;
    return out;
  },
};

// ─── metrics ──────────────────────────────────────────────────────────
function maxAbsDiff(a, b) {
  const N = Math.min(a.length, b.length);
  let worst = 0, idx = 0;
  for (let i = 0; i < N; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) { worst = d; idx = i; }
  }
  return { worst, idx, refVal: a[idx], natVal: b[idx] };
}
function rmsDiff(a, b) {
  const N = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < N; i++) { const d = a[i] - b[i]; s += d * d; }
  return { worst: Math.sqrt(s / N), idx: -1, refVal: 0, natVal: 0 };
}
function dbFromLinear(x) {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

// ─── run one (op, signal) pair ────────────────────────────────────────
function runPair(op, spec, signalName) {
  const gen = CANON_SIGNALS[signalName];
  if (!gen) throw new Error(`unknown signal '${signalName}'`);
  const samples = gen();

  const workDir = resolve(repoRoot, '.shagsplug/parity_workspace', op, signalName);
  mkdirSync(workDir, { recursive: true });
  const inWav     = resolve(workDir, 'in.wav');
  const outNative = resolve(workDir, 'out_native.wav');
  const outRef    = resolve(workDir, 'out_ref.wav');
  const paramsJson = resolve(workDir, 'params.json');

  writeWav(inWav, samples, spec.sr || 48000);

  // ── load param_ranges.json sidecar (preferred) and snap values ─────
  // Falls back to spec.paramRanges only if the sidecar is missing — keeps
  // the orchestrator running on plugins built before the sidecar landed.
  const vst3AbsForSidecar = resolve(repoRoot, spec.vst3);
  const sidecarPath = resolve(dirname(dirname(dirname(dirname(dirname(vst3AbsForSidecar))))),
                              'param_ranges.json');
  let sidecar = null;
  if (existsSync(sidecarPath)) {
    try { sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')); } catch {}
  }

  // Build effective ranges, snapped values, and reference_args overrides.
  const effRanges = {};
  const snappedParams = {};
  for (const [k, v] of Object.entries(spec.params || {})) {
    const rng = (sidecar && sidecar.params && sidecar.params[k])
              || (spec.paramRanges || {})[k];
    if (rng) {
      effRanges[k] = rng;
      snappedParams[k] = snapParamValue(v, rng);
    } else {
      snappedParams[k] = v;
    }
  }

  // Translate paramID → JUCE-hashed VST3 ID + raw→norm via sidecar ranges.
  const hashedParams = {};
  for (const [k, v] of Object.entries(snappedParams)) {
    const rng = effRanges[k];
    const norm = rng ? rawToNorm(v, rng) : v;
    hashedParams[juceParamHash(k)] = norm;
  }
  writeFileSync(paramsJson, JSON.stringify(hashedParams, null, 2));

  // Build reference_args with snapped values overriding matching keys.
  // Convention: paramId is "<nodeId>__<opParamId>"; the JS reference uses
  // the bare opParamId (e.g. "cutoff", "q", "k"). When that key exists in
  // the spec's reference_args, replace its value with the snapped one so
  // both sides evaluate at the same number.
  //
  // Only override for numeric params: bool/enum round-trips through
  // float32 are bit-exact for 0/1/2/3, AND some references key off the
  // STRING form of an enum (e.g. onePole expects mode="hp", uniBi expects
  // mode="biToUni"). Overwriting those with the numeric snapped value
  // would silently flip the reference to its default branch.
  const refArgs = { ...(spec.reference_args || {}) };
  for (const [k, v] of Object.entries(snappedParams)) {
    const rng = effRanges[k];
    if (rng && rng.type && rng.type !== 'number') continue;
    const tail = k.split('__').pop();
    if (tail && Object.prototype.hasOwnProperty.call(refArgs, tail)) {
      refArgs[tail] = v;
    }
  }

  // (a) reference
  const refFn = REFERENCES[spec.reference];
  if (!refFn) throw new Error(`no reference '${spec.reference}'`);
  const refOut = refFn(samples, refArgs);
  writeWav(outRef, refOut, spec.sr || 48000);

  // (b) native via parity_host
  const vst3Abs = resolve(repoRoot, spec.vst3);
  if (!existsSync(vst3Abs)) {
    return { signal: signalName, ok: false, reason: `vst3 missing: ${spec.vst3}` };
  }
  const res = spawnSync(PARITY_HOST, [
    '--vst3', vst3Abs,
    '--in',   inWav,
    '--out',  outNative,
    '--sr',   String(spec.sr || 48000),
    '--block',String(spec.block || 512),
    '--params', paramsJson,
  ], { stdio: 'pipe', encoding: 'utf8' });
  if (res.status !== 0) {
    return { signal: signalName, ok: false,
             reason: `parity_host status=${res.status}\nstderr=${res.stderr}` };
  }

  // (c) compare
  const native = readWav(outNative).samples;
  const metric = spec.metric || 'max_abs_diff';
  const fn = metric === 'rms_diff' ? rmsDiff : maxAbsDiff;
  const r = fn(refOut, native);
  const dbDiff = dbFromLinear(r.worst);
  const tol = spec.tolerance_db ?? -120;
  const ok = dbDiff <= tol;
  return {
    signal: signalName, ok, dbDiff, tol, metric,
    worst: r.worst, idx: r.idx, refVal: r.refVal, natVal: r.natVal,
    refSamples: refOut.length, natSamples: native.length,
  };
}

// ─── main loop ────────────────────────────────────────────────────────
const opsToRun = allFlag ? Object.keys(specs.ops) : [opArg];
let totalFail = 0;

for (const op of opsToRun) {
  const spec = specs.ops[op];
  if (!spec) { console.error(`[parity] no spec for op '${op}'`); totalFail++; continue; }
  console.log(`\n[parity] op=${op}  vst3=${spec.vst3}`);
  console.log(`         ref=${spec.reference}  tol=${spec.tolerance_db} dB  metric=${spec.metric}`);

  for (const sig of spec.signals) {
    const r = runPair(op, spec, sig);
    if (r.reason) {
      console.log(`  [FAIL] ${sig}: ${r.reason}`);
      totalFail++;
      continue;
    }
    const status = r.ok ? 'PASS' : 'FAIL';
    const dbStr = r.dbDiff === -Infinity ? '-Inf' : r.dbDiff.toFixed(2);
    if (r.metric === 'max_abs_diff') {
      console.log(`  [${status}] ${sig.padEnd(12)} maxAbsDiff=${r.worst.toExponential(3)}  ` +
                  `(${dbStr} dB, tol ${r.tol})  worstIdx=${r.idx}  ref=${r.refVal.toFixed(6)} nat=${r.natVal.toFixed(6)}`);
    } else {
      console.log(`  [${status}] ${sig.padEnd(12)} rmsDiff=${r.worst.toExponential(3)}  ` +
                  `(${dbStr} dB, tol ${r.tol})`);
    }
    if (!r.ok) totalFail++;
  }
}

console.log(`\n[parity] DONE — ${totalFail === 0 ? 'ALL PASS' : `${totalFail} FAIL(s)`}`);
process.exit(totalFail === 0 ? 0 : 1);
