# 05: Phase 0 gate: the live run twice, and the status row

Issue: [#160](https://github.com/Muhanad-husn/AEO/issues/160)

## Goal

CI runs `scripts/score.mjs` live against a fresh clone of `Muhanad-husn/RLM` twice and the
two outputs are byte-identical and carry the phases 0 to 5 row; `PLAN.md` section 5a
reads `0 Score | done` with the RLM row, the RLM-Challenge row and the harness cost row
printed by the script.

## Acceptance criterion

Given a clone of `Muhanad-husn/RLM` at any commit at or after `b032896` and a `gh` token
that can read it,
when `node --test tests/scripts/score-live.test.mjs` runs,
then two consecutive live runs of `node scripts/score.mjs <clone> --phases 0-5` write
identical bytes, those bytes contain `days: 4`, `dollars: 3.50` and `prs: 48 merged`,
the `interventions` line reads `no transcripts` where no transcript directory exists,
and the `harness` line prints a number for tests over source.

## Mechanism

- CI: `.github/workflows/tests.yml` clones RLM into the runner's temp directory before
  `npm run test:all`; the test skips with a stated reason when the clone is absent, so
  the fast tier never needs the network.
- The status row and the dated decision lines are prose written by hand from the
  script's output, which the pull request body quotes verbatim.
- No model call.

## What the closing pull request writes

- `PLAN.md` section 5a, row `0 Score`: state `done`, the score cell holding the RLM
  phases 0 to 5 row and the RLM-Challenge record row, the harness cost cell holding the
  script's own `harness` line for this repository, and the date.
- `PLAN.md` section 11, dated 2026-09-08 or the day it lands, one line each: the window
  and day rule; dollars from the ledger and not the status table; the founder message
  and merge decision rules; `COMMITMENTS.md` as the commitment ledger's file and shape;
  RLM-Challenge scored from a record because its repository is gone.
- `package.json`: `score-live.test.mjs` in `test:integration`.

## Files

```aeo-independence
slice: 05-gate
edits: PLAN.md
edits: package.json
edits: .github/workflows/tests.yml
creates: tests/scripts/score-live.test.mjs
depends-on: 02-interventions
depends-on: 03-harness-cost
depends-on: 04-record
```

## Out of scope

Phase 1. Any change to `scripts/score/` beyond what the live run exposes; a defect found
there is fixed in its own slice's file with a note in the gate's pull request.
