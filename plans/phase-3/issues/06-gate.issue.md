# chore(phase-3): Phase 3 gate: the grade, the read budget and the status row [slice 06]

**Spec:** PLAN.md#5-phases, row "3 Knowledge"; PLAN.md#5a-status; PLAN.md#7-cost · **Plan:** plans/phase-3/06-gate.md
**Depends on:** #196, #197, #198, #199; #194 (PLAN.md renumbering lands first) · **Issue:** #200
**Labels:** phase-3

## Deliverable

`PLAN.md` section 5a reads `3 Knowledge | done` with the score cell quoting the `grade-plugin` report's failing expectations (none expected) and the `then:` count, the harness cell quoting the plugin's own read budget line and the prose line count, and the trigger eval's number for the new roster printed in the pull request. The manifest description says what the plugin is now; the version stays `0.2.0`.

## Mechanism

Prose by hand from the scripts' output, quoted verbatim in the pull request body; Sonnet builds. `evals/trigger-cases.json` is rewritten for the roster `build`, `pr`, `safe-cleanup`, `status`, `new-project`, `sprint-plan`: cases naming a deleted lane expect nothing, `fix` cases expect `build`, `safe-pr` cases expect `pr`; `trigger-eval.test.mjs` is edited where it pins the old roster. The number is printed, never protected. The pull request writes `PLAN.md` section 11's "Made <date>, in phase 3" block from the plan README's shape decisions and carries one recommendation for phase 4, which #194 moves to CIP.

## Acceptance criterion

Given slices 02 to 05 merged to `main`, when `node evals/grade-plugin.mjs plugin` runs, then every expectation passes; and when `node scripts/score.mjs D:/AEO` runs, then its harness line's session-start figure for the plugin alone is under 150; and the line count of every `.md` under `plugin/skills` and `plugin/references` totals under 800; and `node evals/trigger-eval.mjs` runs on the rewritten cases and prints a number; and the CI run on the closing commit is green and cited by URL; and `PLAN.md` 5a's row `3 Knowledge` reads `done` with those figures and the date.

## Files

```aeo-independence
slice: 06-gate
edits: PLAN.md
edits: evals/trigger-cases.json
edits: tests/evals/trigger-eval.test.mjs
edits: plugin/.claude-plugin/plugin.json
depends-on: 02-build
depends-on: 03-references
depends-on: 04-pr-cleanup-status
depends-on: 05-new-project
depends-on: 194
```

## Out of scope

Phase 4; the PLAN.md renumbering, which #194 owns and lands first (this slice edits only the `3 Knowledge` row and section 11); any skill or reference change beyond what the grade on the closing commit exposes (a defect there is fixed in the owning slice's files with a note in this pull request); tuning descriptions to raise the trigger number.
