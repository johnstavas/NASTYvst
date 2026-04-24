// op_combine.worklet.js — Stage-3 op sidecar for the `combine` op.
//
// Control-signal coupling primitive. Takes two control streams `a` and `b`
// and combines them per `mode`. Research:
//   - sandbox_modulation_roadmap.md § 2 axis 3 (six coupling types)
//   - sandbox_modulation_roadmap.md § 4 item 9 (macro/coupling primitive)
//   - sandbox_modulation_roadmap.md § 7 (IR uses `op: 'mul'|'add'` in
//     param.sources lists — this op implements that math)
//   - STEP23 Panther Buss § 51 (additive fan-out doctrine; compiler emits
//     trees of `combine` nodes for N-way fan-in)
//
// Scope: this op is the per-pair arithmetic ONLY. The schema layer
// (param.sources lists, additive recomputation, coupling DAG validator)
// ships as a separate PCOF-level change (#9b). See OP_TEMPLATE.md.
//
// Stateless. Null-input defensive: missing `a` treated as 0, missing `b`
// treated as the mode's identity element (0 for add/max, 1 for mul/min).

// Mode → integer for inner-loop branch-free dispatch.
const MODE = { mul: 0, add: 1, max: 2, min: 3, weighted: 4, lastWins: 5 };

export class CombineOp {
  static opId = 'combine';
  static inputs  = Object.freeze([
    { id: 'a', kind: 'control' },
    { id: 'b', kind: 'control' },
  ]);
  static outputs = Object.freeze([{ id: 'out', kind: 'control' }]);
  static params  = Object.freeze([
    { id: 'weight', default: 0.5 },
    { id: 'mode',   default: 'mul' },
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    this._mode   = MODE.mul;
    this._weight = 0.5;
  }

  reset() { /* stateless */ }

  setParam(id, v) {
    switch (id) {
      case 'mode':
        if (v in MODE) this._mode = MODE[v];
        break;
      case 'weight':
        // Clamp to [0,1] — weights outside the range aren't a crossfade.
        this._weight = v < 0 ? 0 : (v > 1 ? 1 : +v);
        break;
    }
  }

  getLatencySamples() { return 0; }

  // Return the identity element of the current mode, used to substitute a
  // missing input so the op degrades gracefully when only one side is wired.
  _identityA() {
    // If `a` is missing, what value pretends to be there?
    switch (this._mode) {
      case MODE.mul:      return 1;
      case MODE.add:      return 0;
      case MODE.max:      return -Infinity;
      case MODE.min:      return  Infinity;
      case MODE.weighted: return 0;   // lerp from 0
      case MODE.lastWins: return 0;   // will be overwritten by b anyway
      default:            return 0;
    }
  }
  _identityB() {
    // If `b` is missing, what value pretends to be there?
    switch (this._mode) {
      case MODE.mul:      return 1;
      case MODE.add:      return 0;
      case MODE.max:      return -Infinity;
      case MODE.min:      return  Infinity;
      case MODE.weighted: return 0;   // weight=0 → out = a
      case MODE.lastWins: return NaN; // sentinel — pass-through a
      default:            return 0;
    }
  }

  // inputs:  { a?: Float32Array, b?: Float32Array }
  // outputs: { out: Float32Array }
  process(inputs, outputs, N) {
    const aCh  = inputs.a;
    const bCh  = inputs.b;
    const outCh = outputs.out;

    // Both unwired → zero.
    if (!aCh && !bCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }

    const mode = this._mode;

    // Weighted mode: missing side = passthrough of the other (not a
    // dim-by-weight artifact).
    if (mode === MODE.weighted) {
      const w = this._weight;
      if (!aCh) { for (let i = 0; i < N; i++) outCh[i] = bCh[i]; return; }
      if (!bCh) { for (let i = 0; i < N; i++) outCh[i] = aCh[i]; return; }
      for (let i = 0; i < N; i++) outCh[i] = (1 - w) * aCh[i] + w * bCh[i];
      return;
    }

    const idA = this._identityA();
    const idB = this._identityB();

    for (let i = 0; i < N; i++) {
      const a = aCh ? aCh[i] : idA;
      const b = bCh ? bCh[i] : idB;
      let y;
      switch (mode) {
        case MODE.mul:      y = a * b; break;
        case MODE.add:      y = a + b; break;
        case MODE.max:      y = a > b ? a : b; break;
        case MODE.min:      y = a < b ? a : b; break;
        // MODE.weighted handled in fast path above; unreachable here.
        case MODE.lastWins:
          // b overrides a when b is wired. Sentinel NaN means b was unwired
          // → pass a through.
          y = Number.isNaN(b) ? a : b; break;
        default:            y = 0;
      }
      outCh[i] = y;
    }
  }
}
