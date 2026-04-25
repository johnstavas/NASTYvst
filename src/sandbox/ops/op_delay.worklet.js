// op_delay.worklet.js — Stage-3 op sidecar for the `delay` op.
//
// Variable-time delay line with EXTERNAL feedback (port `fb`) and a
// control-rate `timeMod` that adds to the `time` param before clamping.
// Closes out the MVP six (gain·filter·envelope·delay·mix·saturate).
//
// Why external FB:
//   - Internal feedback would bake a filter/limiter/sat choice into the
//     op. Keeping FB external lets authors wire the return through any
//     subgraph (shelf → softLimit → dcBlock triad is the ship-safe
//     default; see ship_blockers.md § feedback-loop safety).
//   - dry_wet_mix_rule.md: FB tap is pre-mix in the outer graph — this
//     op's job is only to read/write the line, not to couple it.
//
// Why Hermite-4 interpolation:
//   - Canon:time_interp §2 (Niemitalo direct-algebraic; same cubic as §1
//     de Soras, just a different arithmetic arrangement).
//   - 4-tap cubic Hermite on the ring buffer — smooth under `timeMod`
//     modulation without zipper (linear interp buzzes on fast sweeps).
//   - Coefficients (Niemitalo form):
//       c0 = y1
//       c1 = 0.5 · (y2 − y0)
//       c2 =       y0 − 2.5·y1 + 2·y2 − 0.5·y3
//       c3 = 0.5 · (y3 − y0) + 1.5·(y1 − y2)
//       result = ((c3·t + c2)·t + c1)·t + c0    ← Horner form
//     where y0..y3 are the four samples around the fractional read
//     position and t ∈ [0,1) is the fractional offset.
//
// Time math:
//   - Effective delay ms = clamp(time + timeMod · 1000, 1, 2000).
//     timeMod is in seconds (control-rate convention across the ops set).
//   - Line is sized to max delay + 4-sample interp margin.
//
// Feedback math:
//   - `fb` port is an external audio signal. Written into the line as
//     `line[w] = in[i] + feedback · fb[i]`. When fb is unwired, the
//     feedback param has no audible effect — intended: no self-loop is
//     baked in.
//
// Stability / state:
//   - Denormal flush on the output (Canon:utilities §1) — long silent
//     tails with microscopic residuals kill CPU on Intel without FTZ.
//   - reset() zeroes the line + zeros read/write pointers.

const MAX_TIME_MS = 2000;
const DENORMAL    = 1e-30;

export class DelayOp {
  static opId = 'delay';
  static inputs  = Object.freeze([
    { id: 'in',      kind: 'audio'   },
    { id: 'fb',      kind: 'audio',   optional: true },
    { id: 'timeMod', kind: 'control', optional: true },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' }]);
  static params  = Object.freeze([
    { id: 'time',     default: 250 },
    { id: 'feedback', default: 0.4 },
  ]);

  constructor(sampleRate) {
    this.sr        = sampleRate;
    this._time     = 250;
    this._feedback = 0.4;
    // Ring buffer: max delay + 4-sample Hermite margin.
    this._lineLen  = Math.ceil(MAX_TIME_MS * 0.001 * sampleRate) + 4;
    this._line     = new Float32Array(this._lineLen);
    this._write    = 0;
  }

  reset() {
    this._line.fill(0);
    this._write = 0;
  }

  setParam(id, v) {
    if (id === 'time')     this._time     = Math.min(MAX_TIME_MS, Math.max(1, +v));
    if (id === 'feedback') this._feedback = Math.min(0.98, Math.max(0, +v));
  }

  getLatencySamples() {
    // Read tap at a fractional delay ≥ 1 sample; the line itself adds no
    // constant latency beyond what `time` requests.
    return 0;
  }

  process(inputs, outputs, N) {
    const inCh  = inputs.in;
    const outCh = outputs.out;
    if (!outCh) return;
    if (!inCh) {
      // No audio in — still tick the line so external FB chains settle.
      for (let i = 0; i < N; i++) outCh[i] = 0;
      return;
    }
    const fbCh     = inputs.fb      || null;
    const modCh    = inputs.timeMod || null;
    const line     = this._line;
    const lineLen  = this._lineLen;
    const baseMs   = this._time;
    const feedback = this._feedback;
    const sr       = this.sr;

    let w = this._write;

    for (let i = 0; i < N; i++) {
      // ---- compute fractional read offset ----
      const modSec = modCh ? modCh[i] : 0;
      let delayMs  = baseMs + modSec * 1000;
      if (delayMs < 1)           delayMs = 1;
      else if (delayMs > MAX_TIME_MS) delayMs = MAX_TIME_MS;
      // Minimum one sample of delay so read never overlaps write tap.
      const delaySamples = Math.max(1, delayMs * 0.001 * sr);

      // ---- 4-tap Hermite read ----
      // Read points around position `r`: y0 at (r-1), y1 at r, y2 at (r+1), y3 at (r+2).
      // We want the sample at fractional position `delaySamples` behind w.
      const readPos = w - delaySamples;
      const iFloor  = Math.floor(readPos);
      const t       = readPos - iFloor;  // ∈ [0,1)
      // Ring-index helper (modulo lineLen, handles negatives).
      const idx = (n) => {
        let k = n % lineLen;
        if (k < 0) k += lineLen;
        return k;
      };
      const y0 = line[idx(iFloor - 1)];
      const y1 = line[idx(iFloor    )];
      const y2 = line[idx(iFloor + 1)];
      const y3 = line[idx(iFloor + 2)];

      // Canon:time_interp §2 Niemitalo (Horner form).
      const c0 = y1;
      const c1 = 0.5 * (y2 - y0);
      const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
      const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      let out  = ((c3 * t + c2) * t + c1) * t + c0;

      // Canon:utilities §1 denormal flush.
      if (out < DENORMAL && out > -DENORMAL) out = 0;

      outCh[i] = out;

      // ---- write input (+ external FB scaled) into the line ----
      const fbIn = fbCh ? fbCh[i] : 0;
      let wVal   = inCh[i] + feedback * fbIn;
      if (wVal < DENORMAL && wVal > -DENORMAL) wVal = 0;
      line[w]    = wVal;

      w = w + 1;
      if (w >= lineLen) w = 0;
    }

    this._write = w;
  }
}
