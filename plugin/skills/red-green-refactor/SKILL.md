---
name: red-green-refactor
description: Implement one slice with double-loop TDD — a failing outer acceptance test sets the goal, and inner unit-test red, green, refactor cycles build the code that makes it pass, worked outside-in until the acceptance test is green. Trigger on a request to TDD a slice, write a failing test first, or work through an existing slice plan. Refuses to write production code without a failing test written first.
---

# Red-Green-Refactor — the double loop

Develop one slice by driving it outside-in: a failing acceptance test sets the
goal, and inner unit-test red/green/refactor cycles build the code that makes
it pass. Both test layers grow together — this is the core discipline the
whole harness is built around.

Read `${CLAUDE_PLUGIN_ROOT}/skills/red-green-refactor/references/red-green-refactor-philosophy.md`
first if you haven't this session — it's the authoritative rulebook; what
follows is a summary. For detecting and running the project's test tooling
across stacks, read
`${CLAUDE_PLUGIN_ROOT}/skills/red-green-refactor/references/test-strategy.md`
— the commit gate mines the same detection table, so it isn't duplicated here.

## Input

A slice plan: `plans/<feature-slug>/<NN>-<slice-slug>.md`, written by
`tdd-plan`. No plan, no code — run `tdd-plan` first if none exists. Work
exactly one slice; never batch slices.

## Setup (once per slice)

1. Read the plan: the goal, the acceptance criterion (Given/When/Then), the
   seeded unit test list, what's out of scope.
2. Cut `feat/<feature-slug>/<NN>-<slice-slug>` from an up-to-date default
   branch. Never develop a slice on the default branch itself.
3. Detect the unit runner and whether the outer loop is a browser e2e suite
   or a CLI/API/service integration test (`test-strategy.md`). If either is
   missing, set it up now — a walking-skeleton slice exists precisely for
   this. Note the plan's *project directory*: a subfolder app runs
   install/test/build from there.

## The OUTER loop — are we done

4. Write ONE failing acceptance test for the slice's criterion, exercising
   the system only through its real external endpoint — a browser page, an
   HTTP route, a CLI invocation — never internal code. For a browser slice,
   configure the run to record video and capture a screenshot at the
   decisive assertion; `safe-pr` attaches both as evidence.
5. Run it. It must fail because the feature is absent, with a readable
   diagnostic — not a typo or a misconfigured harness. If you can't
   articulate why it fails, the requirement isn't understood yet. This test
   is now the slice's progress meter; it stays red until the slice is done.

## The INNER loop — how, and quality

Repeat per behaviour, working inward from the boundary the acceptance test
named. Mock collaborators that don't exist yet to design their interfaces
cheaply.

6. THINK. Pick the smallest next behaviour that moves the acceptance test
   toward green. Add it to the plan's unit test list if it's new.
7. RED. One small failing unit test. Watch it fail for the right reason.
8. GREEN. Minimum code to pass — Fake It or hard-code if unsure. Run the
   behaviour's test plus the unit suite. Implement nothing no test demands.
9. REFACTOR, only on green. Remove duplication (especially any hard-coding
   from step 8), clarify names, extract collaborators — no behaviour change.
   Re-run after each small change. A refactor that reddens the bar gets
   reverted, not fixed forward.
10. Log a one-line entry in the plan's status log; tick the unit-list box.
11. Obvious Implementation when confident, Fake It when unsure, Triangulate
    before generalising. On any unexpected red, shrink the step.

Repeat 6–11 until the acceptance test can pass.

## Close the OUTER loop

12. Re-run the acceptance test until it's green — the slice's own done
    signal. For a browser slice, confirm the passing run produced its
    recording and screenshot.
13. With the whole slice green, refactor across module and boundary scope —
    duplication between new and existing code, leaky abstractions, names.
    Re-run after each change.
14. Commit in small, green-only Conventional commits:
    `feat(<slug>): <goal> [slice NN]`. The commit gate runs the project's
    fast tier on every commit; the full acceptance tree is CI's job, not a
    step to repeat here. One test may stay red in the *uncommitted* working
    tree as a cross-session resume marker.
15. Update the plan's Definition-of-Done boxes.

## Invariants

- No production code without a failing test watched fail first — for a
  walking skeleton, the acceptance test may be the only driver.
- Green before and after every refactor; never refactor on red.
- No new behaviour during a refactor — that needs a fresh RED.
- Done means the acceptance test is green and the unit suite passes, not
  unit coverage alone.
- Eliminate duplication before closing each cycle.
- Stuck, or surprised by red: shrink the step, run tests more often.

## Hand-off

Slice green and committed: recommend `tdd-ci` to wire the tests into CI,
then `safe-pr` to open the PR. Report done and stop — merging always waits
for founder approval, from this skill or any subagent.
