// op_wavetable.worklet.js — Stage-3 op sidecar for the `wavetable` op.
//
// PRIMARIES (synth-family rule = 2 minimum):
//
//   A. SuperCollider server/plugins/OscUGens.cpp — Osc UGen inner loop
//      (interpolated 2-table lookup, ~L1137):
//        LOOP1(inNumSamples,
//            ZXP(out) = lookupi1(table0, table1, phase, lomask);
//            phase += phaseinc;
//        );
//      `lookupi1` performs linear interp BETWEEN adjacent table samples
//      AND linear interp BETWEEN `table0` / `table1` — the canonical
//      wavetable morph pattern (Serum / Massive / Vital all follow it).
//
//   B. Same file, OscN UGen un-interpolated form (~L1450) — sanity
//      cross-check for the phase-accumulator pattern:
//        LOOP1(inNumSamples,
//            ZXP(out) = *(float*)((char*)table + ((phase >> xlobits) & lomask));
//            phase += phaseinc;
//        );
//
// Shipped discrete-time form:
//   idx    = phase · TABLE_LEN            phase ∈ [0, 1)
//   i      = floor(idx)
//   f      = idx − i
//   a0     = T[k]  [i]    + f · (T[k]  [i+1] − T[k]  [i])
//   a1     = T[k+1][i]    + f · (T[k+1][i+1] − T[k+1][i])
//   y[n]   = amp · ( a0 + pos · (a1 − a0) )
//   phase += f_carrier / sr ;  wrap into [0, 1)
//
// Built-in table bank (v1 = 4 tables, selectable via `position`):
//   T[0] = sin
//   T[1] = triangle
//   T[2] = sawtooth (naive, no bandlimit)
//   T[3] = square   (naive, no bandlimit)
// `position` ∈ [0, 3] morphs linearly between adjacent tables. Integer
// positions give pure tables; 0.5 morphs sin↔triangle; 2.5 morphs
// saw↔square. Outside [0, 3] is clamped.
//
// NOT bandlimited — this is the baseline wavetable primitive. For
// alias-free saws/squares use #81 blit / #82 minBLEP. Mipmapped
// bandlimited tables (Niemitalo / Wavetable-II style) filed as debt.
//
// Contract:
//   - Optional CONTROL input `freqMod` adds Hz to base freq per sample.
//   - Optional CONTROL input `posMod` adds to position per sample.
//   - AUDIO output `out`.
//   - getLatencySamples() = 0.
//   - reset() returns phase to 0.

const DENORMAL = 1e-30;
const TABLE_LEN = 2048;      // per-table sample count
const NUM_TABLES = 4;        // sin / tri / saw / square

// ---- build bank once ------------------------------------------------------
const TABLES = (() => {
  const bank = [];
  for (let t = 0; t < NUM_TABLES; t++) {
    // +1 guard sample to make i+1 lookup branch-free.
    const buf = new Float32Array(TABLE_LEN + 1);
    for (let i = 0; i < TABLE_LEN; i++) {
      const phase = i / TABLE_LEN;      // [0, 1)
      let y;
      if (t === 0) {
        y = Math.sin(2 * Math.PI * phase);
      } else if (t === 1) {
        // triangle: peak ±1, zero-cross at phase 0 and 0.5
        y = phase < 0.25 ?  4 * phase
          : phase < 0.75 ?  2 - 4 * phase
          :                -4 + 4 * phase;
      } else if (t === 2) {
        // sawtooth: ramp −1 → +1 across the period
        y = 2 * phase - 1;
      } else {
        // square
        y = phase < 0.5 ? 1 : -1;
      }
      buf[i] = y;
    }
    buf[TABLE_LEN] = buf[0];  // wrap guard
    bank.push(buf);
  }
  return bank;
})();

export class WavetableOp {
  static opId = 'wavetable';
  static inputs  = Object.freeze([
    { id: 'freqMod', kind: 'control' },
    { id: 'posMod',  kind: 'control' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'freq',     default: 440 },
    { id: 'position', default: 0   },
    { id: 'amp',      default: 1   },
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._freq     = 440;
    this._position = 0;
    this._amp      = 1;
    this._phase    = 0;
  }

  reset() { this._phase = 0; }

  setParam(id, v) {
    if (id === 'freq') {
      let f = +v;
      if (!(f > 0.01))         f = 0.01;
      const nyq = this.sr * 0.5;
      if (f > nyq - 1)         f = nyq - 1;
      this._freq = f;
    } else if (id === 'position') {
      let p = +v;
      if (!Number.isFinite(p)) p = 0;
      if (p < 0)               p = 0;
      if (p > NUM_TABLES - 1)  p = NUM_TABLES - 1;
      this._position = p;
    } else if (id === 'amp') {
      this._amp = +v;
    }
  }

  getLatencySamples() { return 0; }

  process(inputs, outputs, N) {
    const out = outputs && outputs.out;
    if (!out) return;
    const fm   = inputs && inputs.freqMod;
    const pm   = inputs && inputs.posMod;
    const sr   = this.sr;
    const nyq  = sr * 0.5;
    const amp  = this._amp;
    const base = this._freq;
    const pos0 = this._position;

    let phase = this._phase;

    for (let n = 0; n < N; n++) {
      let f = base;
      if (fm) {
        f += fm[n];
        if (!(f > 0.01))      f = 0.01;
        else if (f > nyq - 1) f = nyq - 1;
      }

      let pos = pos0;
      if (pm) pos += pm[n];
      if (pos < 0)                pos = 0;
      if (pos > NUM_TABLES - 1)   pos = NUM_TABLES - 1;

      const k   = pos | 0;                     // lower table index
      const kf  = pos - k;                     // inter-table fraction
      const kUp = (k + 1 >= NUM_TABLES) ? k : k + 1;

      const idx = phase * TABLE_LEN;
      const i   = idx | 0;
      const f2  = idx - i;

      const Tk  = TABLES[k];
      const Tu  = TABLES[kUp];
      const a0  = Tk[i] + f2 * (Tk[i + 1] - Tk[i]);
      const a1  = Tu[i] + f2 * (Tu[i + 1] - Tu[i]);
      out[n] = amp * (a0 + kf * (a1 - a0));

      phase += f / sr;
      if (phase >= 1) phase -= 1;
      if (phase <  0) phase += 1;
    }

    if (Math.abs(phase) < DENORMAL) phase = 0;
    this._phase = phase;
  }
}
