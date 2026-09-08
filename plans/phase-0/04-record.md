# 04: A consumer that no longer exists is scored from its record

Issue: [#159](https://github.com/Muhanad-husn/AEO/issues/159)

## Goal

`node scripts/score.mjs --record scripts/records/rlm-challenge.json` prints
`RLM-Challenge`'s row, 16 days, $20.58 and 122 pull requests, in the same eight lines,
each line that cannot be read saying so.

## Acceptance criterion

Given `scripts/records/rlm-challenge.json` carrying the first commit date 2026-08-21, the
last commit date 2026-09-05, 122 pull requests of which 117 merged, 20.58 dollars, and
the path and row numbers of the register it was copied from,
when `node --test tests/scripts/score-record.test.mjs` runs,
then the output is exactly

```
consumer: Muhanad-husn/RLM-Challenge (from record)
phases: all, 2026-08-21 to 2026-09-05
days: 16
dollars: 20.58
prs: 117 merged of 122
interventions: no transcripts
executed: none declared
harness: no checkout
```

and the same day function that gives 16 here gives 4 for 2026-09-05 to 2026-09-08.

## Mechanism

- No skill or plugin fits. The repository is deleted; there is nothing to read.
- Library: `node:fs` reads the record file. The record is a snapshot in the shape slice 01
  defined, with a `record` field naming its source, so `consumer.row()` runs unchanged
  over it and the header says `(from record)`.
- No model call.

## The record

`scripts/records/rlm-challenge.json` is copied once from
`D:\RLM\reference\design-mistake-register-first-build.md`, header and rows 1.2 and 6.1,
and names those lines. It is the one hand-counted input the score has, and the output
says so on its first line. A record has no transcripts, no ledger and no checkout, and
the three lines print that rather than a number.

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

Recovering `RLM-Challenge` from GitHub; a record for any other consumer; the
`envdiff` dry run of 2026-08-13, which D35 lists and this plan does not score.
