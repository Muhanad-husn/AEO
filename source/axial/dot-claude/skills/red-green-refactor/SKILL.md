---
name: red-green-refactor
description: Use to implement one slice test-first with disciplined double-loop TDD — a failing acceptance test wrapping inner unit-test red, green, refactor cycles, worked outside-in until the acceptance test is green. The builder authors both layers. Trigger on 'red green refactor', 'TDD this', 'implement slice NN', or working through a plan in plans/. Enforces the discipline literally — never write production code without a failing test, watch every test fail first, minimum code to green, refactor only on green.
---

# Red-Green-Refactor — Double-Loop TDD

Develop **one slice** by driving it outside-in: a failing acceptance test sets the
goal, and inner unit-test red→green→refactor cycles build the code that makes it
pass. Both test layers grow together, and in v2 one agent — the **builder** —
authors both.

**Read `references/red-green-refactor-philosophy.md` now** if you have not this
session — it is the authoritative rulebook. For test tooling, this repo's profile:
Python 3.13 + `uv` + `pytest`; run tests with `uv run pytest <scope>` — always
scoped, never a bare `uv run pytest`, which walks every phase's contracts.

## Test layers

| Layer | Where | Role |
|---|---|---|
| Outer acceptance test | `tests/<subproject>/` | The slice's behavioral goal, written first from the spec, watched failing for the right reason. |
| Inner unit tests | co-located under `src/` (`src/**/test_*.py`) | The builder's working tool during inner cycles. |

`tests/` holds behavioral contracts; inner unit tests live next to the code they
drive. pytest collects both (`testpaths = ["tests", "src"]`). There is no
red-commit ceremony: the acceptance test and the code that greens it land in the
same commit, so the commit gate (green src tier) is never fought.

## Procedure

1. **Read the plan** (`plans/<feature-slug>/<NN>-<slice-slug>.md`) and the spec
   section. No plan → run `tdd-plan` first. Work exactly one slice.
2. **Write the acceptance test first** from the spec's acceptance criterion, and
   **watch it fail** because the feature is absent, with a readable diagnostic. It
   is your progress meter. If the spec's *intent* seems wrong — not just its
   wording — stop and report BLOCKED with the question; if only the wording is
   stale, update the spec in this branch and note it for the PR body.
3. **Inner loop**, repeat per behaviour: THINK (smallest next behaviour) → RED
   (one small failing unit test under `src/`, watch it fail) → GREEN (minimum
   code to pass; Fake It if unsure) → REFACTOR (only on green; revert any
   refactor that reddens the bar). Implement nothing no test demands. On any
   unexpected red, shrink the step.
4. **Close the outer loop.** Acceptance test green → run the **sprint suite**
   (the command declared on the sprint's first issue: `uv run pytest src -q -m
   "not slow"` plus `uv run pytest tests/<subproject> -q -m "not slow"`), then
   commit in green-only Conventional commits: `feat(<slug>): <goal> [slice NN]`.
   The **full** `tests/` tree is never run locally — CI runs it on every push as
   the required check.
5. **Capture evidence for `safe-pr`** (passing acceptance-test run and a real
   invocation, redirected to transcript files) and update the plan's status boxes.

## Invariants

- No production code without a failing test you watched fail first.
- The bar is green before and after every refactoring; never refactor on red.
- No new behaviour during a refactor.
- Refactor toward less: if the slice closes with an abstraction serving one
  caller, a config option nobody sets, or a constant that needed hand-tuning,
  simplify before hand-off or justify it in one line for the PR body.
- Editing a pre-existing test or spec takes a one-line justification in the PR
  body; an edit whose purpose is making failing code pass is never legitimate.
- **Done** = acceptance test green, sprint suite green at slice close, CI green
  on the PR.

## Hand-off

Report `DONE` to the orchestrator and recommend `safe-pr` (plus a reviewer pass
if the change is high-blast-radius). The merge waits for founder approval;
neither this skill nor any subagent merges.
