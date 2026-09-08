# feat(phase-0): the score row, days, dollars and pull requests, replayed from a snapshot [slice 01]

**Spec:** PLAN.md#5-phases, row "0 Score" · **Plan:** plans/phase-0/01-row.md
**Depends on:** none · **Issue:** #156
**Labels:** phase-0

## Deliverable

`node scripts/score.mjs D:/RLM --phases 0-5` prints an eight-line row whose first five lines are the consumer, the phase window, `days: 4`, `dollars: 3.50` and `prs: 48 merged`, with the remaining three lines reading `not measured`. Every live read lands in one JSON snapshot first; `--snapshot` writes it and `--from` replays it, so the same row prints with no network and two runs are byte-identical. A missing ledger or an open last phase prints as such on its own line and the rest still prints.

## Mechanism

Node script, no skill or plugin fits. `git log -S` over the consumer's `PLAN.md` finds the commit that set the last phase's status row to `done`, and its committer date with offset closes the window. `gh api` lists issues with milestones and merged pull requests with merge times. `node:fs` reads the status table and `LEDGER.md`. Days are inclusive calendar days in the gate commit's own UTC offset. Dollars are the ledger rows whose phase column falls in the range. No model call. Behavioural tests first, committed red; Opus builds.

## Acceptance criterion

Given the snapshot `tests/fixtures/score/rlm-phases-0-5.json`, recorded by `node scripts/score.mjs D:/RLM --phases 0-5 --snapshot <path>` and committed,
when `node --test tests/scripts/score.test.mjs` runs,
then replaying the snapshot prints exactly `consumer: Muhanad-husn/RLM`, `phases: 0 to 5, 2026-09-05 to 2026-09-08`, `days: 4`, `dollars: 3.50`, `prs: 48 merged`, `interventions: not measured`, `executed: not measured`, `harness: not measured`, one per line in that order; two replays are byte-identical; a snapshot with no `LEDGER.md` rows prints `dollars: no ledger`; and a snapshot whose status table has no `done` row for the last phase prints `phases: 0 to 5, open` with `days` and `prs` counted to the snapshot's own recorded time.

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

## Out of scope

Interventions, the executed rate, the harness cost line, the record file for a deleted consumer, and the live twice-run in CI. The first build's `status` renderer is not changed.
