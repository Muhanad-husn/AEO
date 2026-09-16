# 06: Phase 2 gate: RLM's row and the status row

Issue: [#186](https://github.com/Muhanad-husn/AEO/issues/186)

## Goal

`PLAN.md` section 5a reads `2 Sensorium | done` with the score cell quoting, verbatim,
the sensorium lines `node plugin/hooks/session-status.mjs` printed with its cwd in
`D:\RLM` on the closing commit (`score:`, `bar:`, `dollars:`, `runs:`, `last run:`,
`commitment:`, `executed:`), and the line `score: none declared` it printed in an empty
git repository; the harness cell carries the `harness:` line the sensorium printed in
this repository and the `harness:` line from `node scripts/score.mjs D:/AEO`. The CI run
on the closing commit is green and cited by its run URL, never re-run locally.

## Acceptance criterion

Given slices 02, 03, 04 and 05 merged to `main`,
when `node plugin/hooks/session-status.mjs` runs with `CLAUDE_PLUGIN_ROOT` at `plugin/`
and its cwd in `D:\RLM`,
then its output begins with `score: 7 Compare done, sample 4 recall 86.4 (8 of 8 phases
done)`, holds a `dollars:` line whose balance equals the last balance cell of
`D:\RLM\LEDGER.md`, and holds `commitment: none declared` or the row the founder has
recorded there;
and when it runs in an empty git repository, then its output holds `score: none declared`,
`bar: none declared`, `dollars: none declared`, `runs: none live`, `last run: none` and
`commitment: none declared`;
and the CI battery on the closing commit is green, and `PLAN.md` section 5a's row
`2 Sensorium` reads `done` with the quoted lines and the date.

## Mechanism

- Prose written by hand from the script's output and the CI log, quoted verbatim in the
  pull request body. No model call. Sonnet builds.
- `node scripts/score.mjs D:/AEO` prints this repository's `harness:` line on the closing
  commit.

## What the closing pull request writes

- `PLAN.md` section 5a, row `2 Sensorium`: state `done`, the score cell with the RLM
  lines and the empty-repository line, the harness cell, the date it lands.
- `PLAN.md` section 11, a new dated block "Made <date>, in phase 2", one line each:
  1. one composer, `sensorium.mjs`, loads every module under `hooks/sensorium/` in
     filename order and both callers print its block first;
  2. the status table, ledger, commitments and harness readers live under `plugin/hooks/`
     and `scripts/score/` imports them;
  3. the oracle is a status table under a Status heading with a `State` and a `Score`
     column, and its absence prints `score: none declared`;
  4. the bar is `RULES.md`'s `Kill line` gate until `new-project` writes a separate
     declaration;
  5. the commitment ledger is written by `plugin/scripts/commitment.mjs`, called by the
     model, never by a hook;
  6. the session-start cost line prints processes and lines, not tests over source.
- The pull request's recommendation, not a file change: copy `plugin/hooks/sensorium.mjs`,
  `plugin/hooks/sensorium/`, `status-table.mjs`, `ledger.mjs`, `commitments.mjs`,
  `harness-cost.mjs`, `session-status.mjs` and `status-render.mjs` over the founder's
  `~/.claude/hooks/` so the global `/status` and session start print the same fields in
  RLM, and record RLM's first commitment there with `commitment.mjs record` at the next
  RLM session so phase 4 starts with a ledger row.

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

Phase 3. Any change under `plugin/hooks/` beyond what the RLM run or CI on the closing
commit exposes; a defect found there is fixed in its owning slice's files with a note in
this pull request. The founder's global copies. `plugin/skills/status/SKILL.md`, rewritten
in phase 3. The plugin version, which stays `0.2.0` until `v1.0.0`.
