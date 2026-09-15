# chore(phase-1): Phase 1 gate, the counts and the status row [slice 05]

**Spec:** PLAN.md#5-phases, row "1 Invariants"; PLAN.md#5a; PLAN.md#7 · **Plan:** plans/phase-1/05-gate.md
**Depends on:** #168, #169, #170 · **Issue:** #171
**Labels:** phase-1

## Deliverable

`PLAN.md` section 5a reads `1 Invariants | done` with the harness cell carrying two lines quoted verbatim: the plugin's own count from slice 01's test, `plugin: bash 1 node, grep 0, read 0, task 0`, and this repository's `harness:` line printed by `node scripts/score.mjs D:/AEO` on the closing commit. The score cell reads `consumer: none (phase 1 has no consumer)`. The CI run on the closing commit is green with no review-jail test in either tier and is cited by its run URL, never re-run locally.

## Mechanism

Prose written by hand from the script's output and the CI log, quoted verbatim in the pull request body. `node scripts/score.mjs D:/AEO` prints this repository's line; the plugin's own line comes from slice 01's test, not from the score script. No model call. Sonnet builds.

## Acceptance criterion

Given slices 02, 03 and 04 merged to `main`, when the CI battery runs on the closing commit, then it is green, `npm test` and `npm run test:integration` in `package.json` name no review-jail test, `tests/hooks/gate.test.mjs` passes with `bash 1, grep 0, read 0, task 0`, every entry of `tests/hooks/fixtures/block-merge-cases.mjs` passes or blocks as listed, and `PLAN.md` section 5a's row `1 Invariants` reads `done` with the two harness lines and the date.

## Files

```aeo-independence
slice: 05-gate
edits: PLAN.md
depends-on: 02-block-merge-structural
depends-on: 03-unreadable-command-warns
depends-on: 04-fence-every-subagent
```

## Out of scope

Phase 2. Any change under `plugin/hooks/` beyond what CI on the closing commit exposes; a defect found there is fixed in its owning slice's files with a note in this pull request. The founder's global hooks and `CLAUDE.md`'s known-limit sentence, which wait on the founder's copy. The plugin version, which stays `0.2.0` until `v1.0.0`.
