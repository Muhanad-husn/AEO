---
name: red-green-refactor
description: Implement one slice with double-loop TDD — a failing outer acceptance test sets the goal, and inner unit-test red, green, refactor cycles build the code that makes it pass, worked outside-in until the acceptance test is green. Trigger on a request to TDD a slice, write a failing test first, or work through an existing slice plan. Refuses to write production code without a failing test written first.
---

# Red-Green-Refactor — the double loop

The core discipline the whole harness is built around: one slice, driven
from a plan file, outside-in. The outer loop is a single failing
acceptance test that stays red until the slice is done; the inner loop is
small red/green/refactor cycles that build toward it. Refactoring only
ever happens on green, and a refactor that reddens the bar gets reverted,
not fixed forward.

**Ports from**
`source/upstream-red-green-refactor/.agents/skills/red-green-refactor/SKILL.md`,
upstream at `593e7ab`. Its `references/test-strategy.md` carries the
multi-stack detection table (V-08 in `docs/EVIDENCE.md`) that Phase 1's
commit gate mines for stack detection (D10) — read there, not duplicated
here.

**Changes on port:** the double loop and refactor-on-green discipline are
unchanged; only stack-specific examples in the prose are generalized. Full
port lands in Phase 2.
