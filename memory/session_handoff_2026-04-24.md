# Session handoff — 2026-04-24

Stopping point after a long sandbox op ship-rack session. Everything below is on disk; nothing in flight.

## Where we are

- **79 / ~130 ops shipped** (~61%). Catalog source of truth: `memory/sandbox_ops_catalog.md`.
- **`npm run qc:all` → PASS** (1072 checks, 0 golden regressions) as of the last run this session.
- Last git commit: `88a2dd8 sandbox: ship 6 ops — lufsIntegrator/clamp/correlation/loudnessGate/truePeak/sign`.
- Everything since that commit is **uncommitted** (see "Uncommitted state" below).

## Shipped this session (4 ops)

| # | Op | Primary source | Golden |
|---|---|---|---|
| 41 | gate | math-by-definition (survey trail in header) | — |
| 42 | expander | Faust `compressors.lib` `peak_expansion_gain_mono_db` (GRAME, LGPL) | fd157b51d1c3b367… |
| 43 | transient | Airwindows Point (MIT), PointProc.cpp L41–L64 | 1dd8f45d00ac1708 |
| 45 | lookahead | Lemire 2006 (arXiv:cs/0610046) — PDF downloaded, **unread** | ef7d6d621eee8a37 |

## Post-ship audit work completed

- **#42 expander** — Faust `peak_expansion_gain_mono_db` located as the clean citable primary; header updated with verbatim passage + algebraic-equivalence block (Faust knee `(level−thresh−knee/2)²/(−2·knee)` ≡ ours with strength=−(R−1) sign fold).
- **#41 gate** — surveyed Airwindows Gatelope (spectral, divergent), Faust `compressors.lib` (no gate fn), musicdsp Effects index (none), `amplessEngine.js` (2-state, simpler). No open primary matches 5-state Schmitt. Math-by-definition declaration preserved with survey trail now in header.
- **#43 transient** — Airwindows Point verbatim passage + 5 deviations (A–E) documented in header during session.
- Catalog rows #41, #42 updated; debt P1 "Zölzer audit" items struck for both.

## Open items (next session)

1. **Read Lemire 2006 PDF** at `C:/Users/HEAT2/Downloads/lemire2006.pdf` (133 427 bytes). Update `op_lookahead.worklet.js` header with verbatim pseudocode; verify our monotonic-deque is the ≤3-comparison variant (not folklore). Logged P1 in `sandbox_ops_research_debt.md` row #45.
2. **Git hygiene before push** (user deferred):
   - ~60 ops + core edits uncommitted since `88a2dd8`.
   - Repo-root scratch to clean or delete: `build_ingestion_audit.cjs`, `build_qc_audit_docx.js`, `build_qc_rack_audit.cjs`, `build_qc_rack_audit_20260422.cjs`, `build_qc_rack_audit_session.cjs`, `build_qc_rack_audit_session_20260423b.cjs`, `kwprobe.mjs`, `image.png`.
   - The **current** audit builder lives correctly at `scripts/build_qc_rack_audit.cjs` — keep this one.
   - `.gitignore` candidates: `.claude/scheduled_tasks.lock`, `image.png`, `kwprobe.mjs`.
   - Decide commit split: one fat "ship N ops" vs cluster-split (dynamics / spectral / pitch / synthesis / utilities).
3. **Debt section re-org** — user deferred to separate session.

## Uncommitted state (summary)

- **Modified (16):** registry + harness + catalog + 6 op files touched during previous work + today's headers.
- **Untracked (~200):** full op file quartets (worklet + cpp.jinja + test + golden) for ops shipped this session and prior, plus scratch builders at repo root, plus `memory/sandbox_op_ship_protocol.md` and `memory/sandbox_ops_research_debt.md` (both governance files that should ship), plus today's `QC_Rack_Audit.docx` and session memo `memory/sandbox_op_audit_2026-04-23.md`.

Everything is deterministic and reproducible — resuming is: read this file + `sandbox_ops_catalog.md` + `sandbox_ops_research_debt.md`, run `npm run qc:all` to confirm green baseline, then pick from "Open items".

## Governance reminder

Next op ship MUST follow `memory/sandbox_op_ship_protocol.md` six steps: primary-source open (paste path+lines), verbatim passage, tri-file (worklet+cpp.jinja+test), deviation diff, `qc:all` green, catalog + debt update. If a primary doesn't exist, declare "math-by-definition primitive — declared" **after** doing a real survey (don't lazy-declare — see #43 lesson).
