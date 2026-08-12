# P4.1 — Reviewer stage 0

2026-08-12. Issue 4, branch `feat/phase-4/p4.1-reviewer-stage-0`, worktree
`D:/AEO-wt/issue-4`. Model tier: Opus, per the slice's dispatch table entry.

**Status: DONE.** Stage 0 lands ahead of the reviewer's existing two stages. No
new plugin file, no new test, no fourth stage.

## What changed

| File | Change |
| --- | --- |
| `plugin/agents/reviewer.md` | Stage 0 and its status disposition; frontmatter description, ordering sentence, stage 2's precondition, and the closing report line follow |
| `plugin/skills/review/SKILL.md` | The claim becomes a staged artifact; frontmatter description, intro, and the dispatch paragraph follow |

## Design calls

**Stage 0 carries its own status rule; the other two stages do not.** Stage 1 and
stage 2 emit findings and let the closing four-status line decide. Stage 0 decides
the status itself, because the two failure shapes route to different people.
NEEDS_CONTEXT is a thin packet: the claim unstated, or the evidence that would
settle it never staged. The fix is restaging, so the defect belongs to the
dispatch. BLOCKED is a complete packet whose evidence demonstrates something other
than the claim. Nothing more can be staged, so the defect belongs to the change
and goes back to the builder. Collapsing both into one status would send half the
cases to the wrong desk.

**The claim is staged, not inferred.** `SKILL.md` says to take the claim from the
PR body or the issue rather than from a reading of the diff. A claim derived from
the diff is one the evidence cannot fail to match, which makes stage 0 a formality
that always passes. That is the same failure the phase exists to catch, one level
up.

**Three examples, no rubric.** The failure shapes named are a green log from a
suite that never runs the changed path, a screenshot of an untouched screen, and a
zero that means "not measured" rather than "none found". The third is the
gate-and-tooling lesson the run monitor already cites. These are illustrations,
not an enumeration to check off. The issue forbade a rubric and a scoring scheme,
and a fixed list of shapes is a rubric that only looks like prose.

**The charter's packet list gained "the claim the change makes".** Stage 0 is
unanswerable if the charter's own description of what a packet holds omits the
thing the evidence is weighed against.

## Tripwires

One, declared rather than fixed. The charter grew from 354 words to 535, a 51%
increase, against an issue constraint to keep it "in the same range" because it is
read on every dispatch. Three rounds of trimming took roughly 50 words back out.
What remains is the cost of a third stage on a two-stage charter, plus the status
disposition the issue asked for by name. Cutting further would have removed either
that disposition or the failure-shape examples, and the disposition is the
deliverable.

Nothing else tripped: no new file, no abstraction, no config option, no constant.

## Test results

Run in the worktree, before and after the change.

| Check | Before | After |
| --- | --- | --- |
| `npm test` (fast tier) | 234 pass, 0 fail, 54 suites | 234 pass, 0 fail, 54 suites |
| `npm run grade:plugin` | 102 passed, 0 failed, pass_rate 1 | 102 passed, 0 failed, pass_rate 1 |

No test asserts on the reviewer charter's prose. `tests/evals/grade-plugin.test.mjs`
touches `agents/reviewer.md` only through synthetic fixtures for the frontmatter
checks — tools exactly `Read`, model an alias, a tier above the builder — and
`tests/hooks/review-jail.test.mjs` asserts on the namespaced identity, not on the
file. None of the four frontmatter fields the grader reads changed, so no test
needed updating. Grepping the rest of `plugin/` for the old two-stage language
found no other reference.

## Not verified here

Checkpoint 4's verify line, staging a packet whose green test log exercises a path
the diff does not touch and confirming the reviewer stops at stage 0, is a live
dispatch against the testbed and belongs to the checkpoint. This slice ships the
charter text that line tests.
