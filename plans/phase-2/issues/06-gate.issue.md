# chore(phase-2): Phase 2 gate, RLM's row and the status row [slice 06]

**Spec:** PLAN.md#5-phases, row "2 Sensorium"; PLAN.md#5a-status · **Plan:** plans/phase-2/06-gate.md
**Depends on:** #182, #183, #184, #185 · **Issue:** #186
**Labels:** phase-2

## Deliverable

`PLAN.md` section 5a reads `2 Sensorium | done` with the score cell quoting, verbatim, the sensorium lines `node plugin/hooks/session-status.mjs` printed with its cwd in `D:\RLM` on the closing commit (`score:`, `bar:`, `dollars:`, `runs:`, `last run:`, `commitment:`, `executed:`), and the line `score: none declared` it printed in an empty git repository; the harness cell carries the `harness:` line the sensorium printed in this repository and the `harness:` line from `node scripts/score.mjs D:/AEO`. The CI run on the closing commit is green and cited by its run URL, never re-run locally.

## Mechanism

Prose written by hand from the script's output and the CI log, quoted verbatim in the pull request body. No model call. Sonnet builds. The pull request also writes PLAN.md section 11's "Made <date>, in phase 2" block (six decisions, listed in the plan) and carries one recommendation, not a file change: copy the sensorium files over the founder's `~/.claude/hooks/` so the global `/status` and session start print the same fields in RLM, and record RLM's first commitment there with `commitment.mjs record` at RLM's next session. RLM shipped 2026-09-12 with no further phases; this did not happen.

## Acceptance criterion

Given slices 02, 03, 04 and 05 merged to `main`, when `node plugin/hooks/session-status.mjs` runs with `CLAUDE_PLUGIN_ROOT` at `plugin/` and its cwd in `D:\RLM`, then its output begins with `score: 7 Compare done, sample 4 recall 86.4 (8 of 8 phases done)`, holds a `dollars:` line whose balance equals the last balance cell of `D:\RLM\LEDGER.md`, and holds `commitment: none declared` or the row the founder has recorded there; and when it runs in an empty git repository, then its output holds `score: none declared`, `bar: none declared`, `dollars: none declared`, `runs: none live`, `last run: none` and `commitment: none declared`; and the CI battery on the closing commit is green, and `PLAN.md` section 5a's row `2 Sensorium` reads `done` with the quoted lines and the date.

## Files

```aeo-independence
slice: 06-gate
edits: PLAN.md
depends-on: 02-dollars
depends-on: 03-runs
depends-on: 04-commitment
depends-on: 05-harness-cost
```

## Out of scope

Phase 3; any change under `plugin/hooks/` beyond what the RLM run or CI on the closing commit exposes (a defect found there is fixed in its owning slice's files with a note in this pull request); the founder's global copies; `plugin/skills/status/SKILL.md` (phase 3); the plugin version, which stays `0.2.0` until `v1.0.0`.
