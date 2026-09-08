# chore(phase-0): Phase 0 gate, the live run twice and the status row [slice 05]

**Spec:** PLAN.md#5-phases, row "0 Score"; PLAN.md#5a · **Plan:** plans/phase-0/05-gate.md
**Depends on:** #157, #158, #159
**Labels:** phase-0

## Deliverable

CI runs `scripts/score.mjs` live against a fresh clone of `Muhanad-husn/RLM` twice, and the two outputs are byte-identical and carry the phases 0 to 5 row. `PLAN.md` section 5a reads `0 Score | done` with the RLM row, the RLM-Challenge record row and this repository's own harness line, all quoted from the script's output. Section 11 gains one dated line per shape decision this phase made.

## Mechanism

`.github/workflows/tests.yml` clones RLM into the runner's temp directory before `npm run test:all`; the live test skips with a stated reason when the clone is absent, so the fast tier never touches the network. The status row and the decision lines are prose copied from the script's output, which the pull request body quotes verbatim. No model call. Sonnet builds.

## Acceptance criterion

Given a clone of `Muhanad-husn/RLM` at any commit at or after `b032896` and a `gh` token that can read it,
when `node --test tests/scripts/score-live.test.mjs` runs,
then two consecutive live runs of `node scripts/score.mjs <clone> --phases 0-5` write identical bytes, those bytes contain `days: 4`, `dollars: 3.50` and `prs: 48 merged`, the `interventions` line reads `no transcripts` where no transcript directory exists, and the `harness` line prints a number for tests over source.

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

Phase 1. Any change to `scripts/score/` beyond what the live run exposes; a defect found there is fixed in its owning file with a note in this pull request.
