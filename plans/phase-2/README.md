# Phase 2: Sensorium

Milestone `Phase 2`. Spec: `PLAN.md` section 5, row "2 Sensorium", and section 2, the
Sensorium layer and the commitment ledger. Consumer: 1, `D:\RLM`.

The outcome: `session-status` and `/status` print what the model cannot passively see,
read fresh each time and written nowhere: the product number and its bar, dollars spent
of the cap, live runs and their last progress line, the last recommendation and whether
it was executed, and the harness's own cost this session. Against RLM the session start
prints its status row, its ledger balance and its last recommendation with the executed
word beside it. Against a repository with no oracle it prints `score: none declared`. A
script writes the commitment ledger: one row per session's recommendation, one word per
row at the next session.

## What the survey found

- `plugin/hooks/session-status.mjs` (324 lines) prints gate health, the data root, the
  branch, open issues, open and merged pull requests and the head of the newest
  `logs/<dir>/summary.md`. `plugin/hooks/status-render.mjs` (486 lines) prints issue
  triage, pull requests with checks, the Decision Log and slice chains for `/status`.
  Both are wired: `hooks.json` SessionStart runs session-status, and
  `plugin/skills/status/scripts/render-status.mjs` calls `renderStatusView`. The
  founder's standalone copies under `~/.claude/hooks` and `~/.claude/skills/status` run
  in this repository and in RLM.
- Neither prints a score, a bar, dollars, a live sentinel, a recommendation or a cost.
- The readers the sensorium needs already exist, but under `scripts/score/`, which a
  consumer does not have: `parseStatusTable`, `phaseRow` and `isDone` in
  `consumer.mjs`; `countCommitments` in `interventions.mjs` and `readCommitments` in
  `sources.mjs`; `measure` in `harness.mjs`. `plugin/hooks/sentinel.mjs` exports
  `inspectRuns`, which lists live and stale sentinels; `plugin/scripts/runlog.mjs`
  appends one JSON record per step to `logs/<dir>/run.jsonl` and a close record with
  `unit: 'run'`.
- RLM has `PLAN.md` with a status table under "4a. Status" (Phase, Milestone, State,
  Score, Dollars, Spread, Closed), `LEDGER.md` with "Ceiling $50" on its first line and
  a balance column, `RULES.md` with a "Kill line" gate, and no `COMMITMENTS.md`.
  `PLAN.md` section 11, phase 0 decision 4, already fixes `COMMITMENTS.md` as the
  ledger's name and shape.
- This repository has the same shapes: a status table under "5a. Status", a "Kill line"
  gate, no `LEDGER.md`, no `COMMITMENTS.md`.
- Tests pinned to the current renderers: `tests/hooks/session-status.test.mjs`
  (integration tier), `tests/skills/status-render-smoke.test.mjs` (fast tier),
  `tests/skills/status.test.mjs` (integration tier). `tests/scripts/score*.test.mjs`
  import the readers from `scripts/score/`.

## The shape decisions this phase fixes

- **One composer, two callers.** `plugin/hooks/sensorium.mjs` loads every module under
  `plugin/hooks/sensorium/` in filename order and prints each one's lines. session-status
  and `renderStatusView` both call it and put its block first. A section that throws
  prints `<name>: unknown (<reason>)` and the rest still print; the composer never exits
  non-zero. Sections are files so that four slices add four fields without editing one
  list in one file.
- **The plugin owns the readers; the score script imports them.** The status table,
  ledger, commitments and harness readers move from `scripts/score/` to `plugin/hooks/`,
  and `scripts/score/` re-exports them. One parser per record, read by the sensorium in
  a consumer and by the score script here.
- **The oracle is the status table.** A `PLAN.md` (or `docs/PLAN.md`) with a table under
  a Status heading whose header starts with `Phase` and has a `State` and a `Score`
  column is a declared oracle. Anything else prints `score: none declared`. Phase 3's
  `new-project` writes that table.
- **The bar is the kill line.** `RULES.md`'s `Kill line` gate is the one bar both
  consumers have written down, so `bar:` quotes it; a `RULES.md` without one prints
  `bar: none declared`. The founder may want a separate declaration; that is a phase 3
  question for `new-project`.
- **The ledger's write is a script, not a hook.** `plugin/scripts/commitment.mjs record`
  and `mark` edit `COMMITMENTS.md`; the model calls them. Nothing fires at session end
  because a Stop hook cannot read the recommendation out of prose, and section 2 says
  the harness only shows the thread.
- **Cost at session start is processes and lines, not tests over source.** The
  session-start line prints node processes per tool and lines read at start; the
  tests-over-source ratio walks the source tree and stays in the score script.

## Slices

| NN | Slice | Plan | Issue | Depends on |
|---|---|---|---|---|
| 01 | The sensorium composer, printing the score and its bar | [01-composer-score.md](01-composer-score.md) | #181 | none |
| 02 | Dollars spent of the cap | [02-dollars.md](02-dollars.md) | #182 | 01 |
| 03 | Live runs and their last progress line | [03-runs.md](03-runs.md) | #183 | 01 |
| 04 | The commitment ledger, read and written | [04-commitment.md](04-commitment.md) | #184 | 01 |
| 05 | The harness's own cost this session | [05-harness-cost.md](05-harness-cost.md) | #185 | 01 |
| 06 | Phase 2 gate: RLM's row and the status row | [06-gate.md](06-gate.md) | #186 | 02, 03, 04, 05 |

Order of work: 01, then 02, 03, 04 and 05 together, then 06.
