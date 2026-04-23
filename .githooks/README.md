# `.githooks/` — Shags VST repo hooks

**Scope: T6 only.** These hooks gate the IR / pre-compile tier (graph schema +
structural validator). They do **NOT** run the T1–T4 signal-processing sweep,
which is browser-bound (WebAudio runtime required).

A green pre-commit does **not** mean "shippable." It means "the IR is
structurally valid." Before publish, also run the in-app QC rack against each
affected plugin (T1–T4) per `memory/ship_blockers.md`.

## Install

```sh
npm run install-hooks
```

Sets `git config core.hooksPath .githooks` for this clone.

## What runs on commit

Fail-fast order (cheapest first):

1. `node scripts/check_schema_v1.mjs`       — static v1.0 conformance    (~50 ms)
2. `node scripts/check_t6_rules.mjs`        — T6 rule negative-tests     (~200 ms)
3. `node scripts/check_all_graphs_deep.mjs` — deep T6 on all graphs      (~200 ms)
4. `node scripts/check_pcof.mjs`            — PCOF build + T6.5 pre-codegen (~250 ms)
5. `node scripts/check_op_goldens.mjs`      — op sidecar shape + goldens (~300 ms)
6. `node scripts/check_master_worklet.mjs`  — master-worklet TOY_COMP golden (~150 ms)
7. `node scripts/check_master_emit_parity.mjs` — emitter ⇄ factory parity  (~200 ms)

Equivalent to `npm run qc:all`.

To re-bless golden vectors after an intentional op-math change:

```sh
npm run qc:goldens:bless
```

Read the diff in `scripts/goldens/<opId>.golden.json` before committing —
a golden update is a deliberate act, not a reflex.

## Bypass

```sh
git commit --no-verify
```

Only use with explicit intent. See `memory/ship_blockers.md` waiver policy.

## What's NOT enforced here

See `memory/qc_backlog.md` for the open rule bodies. Current known gaps vs
`ship_blockers.md`:

- Dry/wet mix in worklet (structural-checkable, not yet a T6 rule)
- Bypass contract (structural-checkable, not yet a T6 rule)
- Denormal tail (worklet source-level check, not yet a T6 rule)
- DC rejection under FB — present as path check, not wiring verification
- FB runaway guard — present as path check, not amplitude verification

Browser-bound gates (T1–T4 — always run in rack before publish):

- T1 sweep zero FAILs
- T3 schema-conditional gates (sidechain / freeze / feedback runaway amplitudes)
- T4 pressure tests

## Related

- `scripts/check_*.mjs` — the three harness scripts invoked here
- `src/sandbox/validateGraph.js` — T6 rule bodies
- `src/sandbox/graph.schema.json` — IR v1.0 formal schema
- `memory/qc_family_map.md` — full T1–T7 tier model
