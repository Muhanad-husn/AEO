# feat(phase-0): a consumer that no longer exists is scored from its record [slice 04]

**Spec:** PLAN.md#5-phases, row "0 Score"; PLAN.md#4, consumer 1 baseline · **Plan:** plans/phase-0/04-record.md
**Depends on:** #156
**Labels:** phase-0

## Deliverable

`node scripts/score.mjs --record scripts/records/rlm-challenge.json` prints RLM-Challenge's row in the same eight lines: 16 days, $20.58, 117 merged of 122 pull requests, with the first line marked `(from record)` and the three lines that need transcripts, a ledger or a checkout saying they have none. `Muhanad-husn/RLM-Challenge` does not resolve on GitHub and has no checkout or transcripts on this machine; its only record is the first build's design mistake register in `D:\RLM\reference`, and the record file names the lines it was copied from.

## Mechanism

`node:fs` reads the record, which is a snapshot in the shape slice 01 defined plus a `record` field naming its source, so `consumer.row()` runs over it unchanged. The one hand-counted input the score has is marked as such in its output. No model call. Tests first, committed red; Sonnet builds.

## Acceptance criterion

Given `scripts/records/rlm-challenge.json` carrying first commit 2026-08-21, last commit 2026-09-05, 122 pull requests of which 117 merged, 20.58 dollars, and the path and rows of the register it came from,
when `node --test tests/scripts/score-record.test.mjs` runs,
then the output is exactly `consumer: Muhanad-husn/RLM-Challenge (from record)`, `phases: all, 2026-08-21 to 2026-09-05`, `days: 16`, `dollars: 20.58`, `prs: 117 merged of 122`, `interventions: no transcripts`, `executed: none declared`, `harness: no checkout`, one per line in that order, and the day function that gives 16 here gives 4 for 2026-09-05 to 2026-09-08.

## Files

```aeo-independence
slice: 04-record
edits: scripts/score.mjs
edits: package.json
creates: scripts/score/record.mjs
creates: scripts/records/rlm-challenge.json
creates: tests/scripts/score-record.test.mjs
depends-on: 01-row
```

## Out of scope

Recovering RLM-Challenge from GitHub; a record for any other consumer; the `envdiff` dry run of 2026-08-13, which D35 lists and this plan does not score.
