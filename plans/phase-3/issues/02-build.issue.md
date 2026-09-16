# feat(phase-3): one `build` skill from `fix`, `red-green-refactor` and `tdd-plan` [slice 02]

**Spec:** PLAN.md#5-phases, row "3 Knowledge"; PLAN.md#3-what-is-kept, rows `fix` and `red-green-refactor` · **Plan:** plans/phase-3/02-build.md
**Depends on:** #195 · **Issue:** #196
**Labels:** phase-3

## Deliverable

`plugin/skills/build/SKILL.md` is one advisory skill the model may invoke, saying what this shop wants from a change to existing code and why: a test red first when behaviour moves, the existing suite as the oracle when it does not, a small fix taken straight to a pull request, two attempts per shape. `fix`, `red-green-refactor` and `tdd-plan` are deleted. `plugin/references/test-strategy.md` keeps the sections of the 7,000-word doctrine that carry a measurement; `plugin/references/slicing.md` keeps the INVEST check, the walking-skeleton rule and L-04 on planned paths.

## Mechanism

Prose, code-grade: Opus writes `build/SKILL.md`, under 90 lines, description saying when it applies and never what to do first, body citing V-01, L-06 and RLM's four days and $3.50. Sonnet cuts `test-strategy.md` from the existing file by deletion, keeping only sections that state a number or cite L-06, L-10, D17, D31 or D32. `slicing.md` from `slicing-guide.md` the same way. `plan-template.md` is deleted; `sprint-plan/SKILL.md` gains one line pointing at `references/slicing.md`. No script, no model call at runtime.

## Acceptance criterion

Given slice 01 merged, when `node evals/grade-plugin.mjs plugin` runs after this slice, then no expectation names a file under `skills/build/`, `references/test-strategy.md` or `references/slicing.md`; and `plugin/skills/fix`, `plugin/skills/red-green-refactor` and `plugin/skills/tdd-plan` do not exist; and `build/SKILL.md` has no `disable-model-invocation` line, no ordered list of three or more items, and no `refuse`; and `test-strategy.md` is under 250 lines and `slicing.md` under 80, each citing its measurement in its first five lines; and `npm test` is green.

## Files

```aeo-independence
slice: 02-build
creates: plugin/skills/build/SKILL.md
creates: plugin/references/test-strategy.md
creates: plugin/references/slicing.md
edits: plugin/skills/sprint-plan/SKILL.md
edits: plugin/skills/fix/SKILL.md
edits: plugin/skills/red-green-refactor/SKILL.md
edits: plugin/skills/red-green-refactor/references/red-green-refactor-philosophy.md
edits: plugin/skills/red-green-refactor/references/test-strategy.md
edits: plugin/skills/tdd-plan/SKILL.md
edits: plugin/skills/tdd-plan/references/slicing-guide.md
edits: plugin/skills/tdd-plan/assets/plan-template.md
depends-on: 01-grader
```

Paths listed as `edits` and removed by the slice are deletions.

## Out of scope

`tdd-ci` (slice 03); the `pr` skill (slice 04); trigger cases naming `fix` (slice 06); the dispatch reference's tiering line (slice 03).
