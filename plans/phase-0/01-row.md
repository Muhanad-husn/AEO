# 01: The row: days, dollars, pull requests, replayed from a snapshot

Issue: [#156](https://github.com/Muhanad-husn/AEO/issues/156)

## Goal

`node scripts/score.mjs D:/RLM --phases 0-5` prints `days: 4`, `dollars: 3.50` and
`prs: 48 merged`, and the same command with `--from tests/fixtures/score/rlm-phases-0-5.json`
prints the identical text with no network.

## Acceptance criterion

Given the snapshot `tests/fixtures/score/rlm-phases-0-5.json`, recorded by
`node scripts/score.mjs D:/RLM --phases 0-5 --snapshot <path>` and committed,
when `node --test tests/scripts/score.test.mjs` runs,
then replaying the snapshot prints exactly

```
consumer: Muhanad-husn/RLM
phases: 0 to 5, 2026-09-05 to 2026-09-08
days: 4
dollars: 3.50
prs: 48 merged
interventions: not measured
executed: not measured
harness: not measured
```

two replays are byte-identical, a snapshot with no `LEDGER.md` rows prints
`dollars: no ledger`, and a snapshot whose status table has no `done` row for the last
phase prints `phases: 0 to 5, open` with `days` and `prs` counted to the snapshot's own
recorded time.

## Mechanism

- No skill or plugin fits. The first build's `status` renderer reads git state only and
  has no notion of a window or a ledger.
- Library and CLI: `git log -S` over the consumer's `PLAN.md`, searching for the phase's
  status row with `done` in its state cell, finds the gate commit and its committer date
  with offset; `gh api` lists issues with milestones and merged pull requests with merge
  times; `node:fs` reads the status table and `LEDGER.md`. The GitHub repository is
  `git remote get-url origin`.
- No model call.

## Shape

- `scripts/score.mjs`: argv, then `sources.read()` or `sources.load(file)`, then
  `consumer.row(snapshot)`, `interventions.line(snapshot)`, `harness.line(snapshot)`,
  printed in the fixed order above. The two stubs return `not measured`.
- `scripts/score/sources.mjs`: every live read, into one plain object with the time it
  was taken. Nothing else in `scripts/score/` touches git, GitHub or the filesystem.
- `scripts/score/consumer.mjs`: the window, days, dollars and pull requests from the
  snapshot alone. Days are inclusive calendar days in the gate commit's UTC offset.
- The status table is found as the first markdown table under a heading containing
  `Status` whose header row starts with `Phase`; a row is `done` when its `State` cell
  is `done`. Milestones are matched by the `Phase N` name in the table's `Milestone`
  column where one exists, else by the row's leading number.

## Files

```aeo-independence
slice: 01-row
creates: scripts/score.mjs
creates: scripts/score/sources.mjs
creates: scripts/score/consumer.mjs
creates: scripts/score/interventions.mjs
creates: scripts/score/harness.mjs
creates: tests/scripts/score.test.mjs
creates: tests/scripts/score-interventions.test.mjs
creates: tests/scripts/score-harness.test.mjs
creates: tests/fixtures/score/rlm-phases-0-5.json
edits: package.json
```

The two stub test files assert the stub text, so slices 02 and 03 each replace one file
they own and touch nothing another slice edits.

## Out of scope

Interventions, the executed rate, the harness cost line, the record file for a deleted
consumer, and the live twice-run in CI. The first build's `status` renderer is not
changed.
