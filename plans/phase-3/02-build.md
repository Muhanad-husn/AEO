# 02: One `build` skill from `fix`, `red-green-refactor` and `tdd-plan`

Issue: [#196](https://github.com/Muhanad-husn/AEO/issues/196)

## Goal

`plugin/skills/build/SKILL.md` is one advisory skill the model may invoke, saying what this
shop wants from a change to existing code and why: a test red first when behaviour moves,
the existing suite as the oracle when it does not, a small fix taken straight to a pull
request, two attempts per shape. `fix`, `red-green-refactor` and `tdd-plan` are gone.
`plugin/references/test-strategy.md` keeps the sections of the 7,000-word doctrine that
carry a measurement; `plugin/references/slicing.md` keeps the parts of `slicing-guide.md`
that do.

## Acceptance criterion

Given slice 01 merged, when `node evals/grade-plugin.mjs plugin` runs after this slice,
then no expectation names a file under `skills/build/`, `references/test-strategy.md` or
`references/slicing.md`; and `plugin/skills/fix`, `plugin/skills/red-green-refactor` and
`plugin/skills/tdd-plan` do not exist; and `build/SKILL.md` has no
`disable-model-invocation` line, no ordered list of three or more items, and no
`refuse`; and `test-strategy.md` is under 250 lines and `slicing.md` under 80, each
citing its measurement in its first five lines; and `npm test` is green.

## Mechanism

- Prose, code-grade: a skill is a rule (CLAUDE.md rule 3), so Opus writes it. No script,
  no model call at runtime.
- `build/SKILL.md` under 90 lines. Its description says when it applies (a change to
  code that exists, a small fix, a bug) and not what to do first. Its body is what this
  shop wants and the incident behind each want: V-01 for the red-commit escape hatch,
  L-06 for the tiered suite, `D:\RLM`'s four days and $3.50 for the number.
- `test-strategy.md`: keep only sections that state a number or cite an incident
  (`docs/EVIDENCE.md` L-06, L-10; D17, D31, D32). Delete the rest. The reference is
  written by Sonnet from the existing file by deletion, not by paraphrase.
- `slicing.md`: the INVEST check, the walking-skeleton rule and L-04 on planned paths.
  `tdd-plan/assets/plan-template.md` is deleted; `sprint-plan` carries the plan shape.
- `sprint-plan/SKILL.md` gains one line pointing at `references/slicing.md`; nothing else
  in it changes.

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

`tdd-ci` (slice 03). The `pr` skill (slice 04). Trigger cases naming `fix` (slice 06).
The dispatch reference's tiering line (slice 03).
