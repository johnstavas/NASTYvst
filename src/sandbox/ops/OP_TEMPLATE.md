# Op sidecar template

Every op in this directory ships three files. The QC rack enforces that the
three agree with each other and with `../opRegistry.js`. Any new op MUST
follow this skeleton exactly — it's what the master-worklet codegen, the
native C++ emitter, the golden harness, and the math harness all assume.

## File contract (tri-file)

```
op_<id>.worklet.js    — authoritative JS math. Imported by master-worklet.
op_<id>.cpp.jinja     — native C++ mirror. Emitter stitches into JUCE build.
op_<id>.test.js       — real-math assertions. Run by scripts/check_op_math.mjs.
```

Plus one registry entry in `../opRegistry.js` under `OPS.<id>`. Shape must
match exactly (port ids, param ids) — gate `qc:goldens` (A) fails the
commit if they drift.

## JS sidecar — `op_<id>.worklet.js`

Ten members in this exact order. No exceptions.

```js
// op_<id>.worklet.js — one-sentence role.
//
// Research citations (memory/*.md). Link to sandbox_modulation_roadmap.md
// section or Canon:<topic> §N entry that motivates the math. If it isn't
// backed by research, it isn't ready to ship.

export class <Name>Op {
  static opId    = '<id>';
  static inputs  = Object.freeze([{ id: 'in',  kind: 'audio' /* | 'control' */ }]);
  static outputs = Object.freeze([{ id: 'out', kind: 'audio' /* | 'control' */ }]);
  static params  = Object.freeze([
    { id: '<param>', default: <value> },
    // ...
  ]);

  constructor(sampleRate) {
    this.sr = sampleRate;
    // Initialize param shadow state (this._<param>) to match registry defaults.
    // Initialize DSP state (this._<state>) to a neutral value (usually 0).
  }

  reset() {
    // Zero all DSP state. Do NOT touch params. Called on plugin init /
    // transport reset. Stateless ops may leave this as a no-op comment.
  }

  setParam(id, v) {
    switch (id) {
      case '<param>': this._<param> = /* normalize */ v; break;
    }
  }

  getLatencySamples() { return 0; /* or ceil(N) for lookahead / convolution */ }

  // inputs:  { <id>?: Float32Array }
  // outputs: { <id>:  Float32Array }
  process(inputs, outputs, N) {
    const inCh  = inputs.<id>;
    const outCh = outputs.<id>;
    if (!inCh) { for (let i = 0; i < N; i++) outCh[i] = 0; return; }

    // Per-sample inner loop. If the op is IIR, flush denormals:
    //   if (y < 1e-30 && y > -1e-30) y = 0;
    // Per Canon:utilities §1 (Jon Watte) — SHIP-CRITICAL.
  }
}
```

### Rules

1. **No imports** from elsewhere in the tree. Sidecars are copied into a tmp
   ESM dir by the QC harness; relative imports will break it.
2. **Float32 I/O.** `inputs` and `outputs` hold `Float32Array`s of length N.
3. **Defensive on null input.** `inputs.<id>` may be undefined if the port
   is unwired. Fill output with zero and return.
4. **No allocation in `process`.** Pre-allocate state in constructor.
5. **IIR ops must denormal-flush** per sample. Skip it and long decays stall.
6. **Param ids** must match `opRegistry.js` exactly. Gate 5A fails otherwise.

## C++ template — `op_<id>.cpp.jinja`

Mirror the JS math bit-for-bit. Same seven structural anchors:

```cpp
#pragma once
#include <cmath>
#include <cstring>

namespace shags::ops {

class <Name>Op_{{ node_id }} {
public:
    static constexpr const char* opId = "<id>";

    explicit <Name>Op_{{ node_id }}(double sampleRate) : sr_(sampleRate) { /* init */ }

    void reset() { /* zero state */ }

    void setParam(const char* id, double v) {
        if (std::strcmp(id, "<param>") == 0) <param>_ = v;
    }

    int getLatencySamples() const { return 0; }

    void process(const float* in, float* out, int N) {
        if (!in) { for (int i = 0; i < N; ++i) out[i] = 0.0f; return; }
        // Per-sample math — identical to JS, use double precision internally.
    }

private:
    double sr_;
    // state fields with trailing underscore
};

}  // namespace shags::ops
```

### Rules

1. **Double-precision state.** Even when I/O is float, compute in double
   internally — matches JS numeric semantics and avoids divergence.
2. **`{{ node_id }}` suffix on the class name** — emitter uniqifies it per
   graph node. Never hardcode.
3. **Enum params use `setParamEnum(const char*)`** not `setParam(id, double)`.
   See `op_curve.cpp.jinja` for the pattern.
4. **No JUCE includes.** Template must compile standalone. JUCE glue
   happens in the emitter's outer scaffolding.

## Test sidecar — `op_<id>.test.js`

```js
// op_<id>.test.js — real-math tests. Run via scripts/check_op_math.mjs.

import { <Name>Op } from './op_<id>.worklet.js';

const SR  = 48000;
const N   = 128;
const EPS = 1e-5;
const approx = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

function freshOp(params = {}) {
  const op = new <Name>Op(SR);
  op.reset();
  for (const [k, v] of Object.entries(params)) op.setParam(k, v);
  return op;
}

const tests = [
  {
    name: '<human-readable assertion>',
    run() {
      const op = freshOp({ /* params */ });
      // drive, assert, return { pass: true } or { pass: false, why: '...' }
    },
  },
  // ...
];

export default { opId: '<id>', tests };
```

### Minimum test coverage per op

Every op MUST include at least:

1. **Null input** → all-zero output.
2. **Reset** → state cleared (if stateful).
3. **Expected-value check** at a known input (endpoints, defaults, knowns).
4. **Edge behavior** specific to the op (clamp, passthrough, convergence, etc.).

More for complex ops (curve ships 10, smooth ships 9).

## Registry entry — `../opRegistry.js`

```js
<id>: {
  id: '<id>',
  label: '<short label>',
  description: '<one-liner + research citation>',
  ports: { inputs: [...], outputs: [...] },
  params: [
    { id: '<param>', label: '<UI label>', type: 'number' | 'enum' | 'bool' | 'points',
      min, max, step, default, unit, format: (v) => '...' },
  ],
},
```

`id` / port ids / param ids MUST match the sidecar static fields exactly.

## Gate checklist — don't ship without

- [ ] `npm run qc:goldens:bless` → hash recorded in `scripts/goldens/<id>.golden.json`
- [ ] `npm run qc:math` → all tests pass
- [ ] `npm run qc:all` → 8 gates green
- [ ] Research citation in sidecar header comment
- [ ] Entry in `qc_backlog.md` ledger marked ✅

## Reference implementations

| Op | Notable pattern |
|---|---|
| `op_gain.worklet.js`    | Simplest possible op — stateless, single param. |
| `op_smooth.worklet.js`  | Stateful IIR + denormal flush + passthrough fast path. |
| `op_curve.worklet.js`   | Complex param schema (`type: 'points'`) + multi-mode evaluator. |
| `op_envelope.worklet.js`| Asymmetric AR + per-sample state. |
| `op_filter.worklet.js`  | Multi-mode biquad — precompute coefs on param change, not per sample. |
