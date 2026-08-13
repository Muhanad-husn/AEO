---
name: tdd-plan
description: Use this skill when someone wants work broken down before any code is written — split a feature, product, rewrite, or fix into thin, independently valuable vertical slices and write one execution plan per slice to disk. Use it whenever the ask is for the breakdown itself — slice this up, what is the smallest first step, what order should these go in, plan it test-first. The resulting plan is the contract red-green-refactor executes next. Do not use it when the user is asking for the work to be carried out rather than planned, however large that work is and even when they want it parallelised; that is implementation. At sprint or epic scale, where several actors work in parallel or GitHub issues need filing, use `/aeo:sprint-plan` instead.
---

# TDD Plan — slice and plan

Split a request into thin vertical slices before any code is written, each
captured as a plan file in `plans/`. A good slice is the smallest
independently valuable, end-to-end testable change in behaviour. The plan is
the contract `red-green-refactor` executes next, and `tdd-ci`/`safe-pr` read
afterward — make it precise.

Slicing is the hardest, most valuable judgement call here; take the time.
For the full toolkit — vertical vs. horizontal, INVEST, the walking
skeleton, nine splitting patterns with a worked example — read
`${CLAUDE_PLUGIN_ROOT}/skills/tdd-plan/references/slicing-guide.md`.

## Procedure

1. Understand the request. Restate the outcome in one or two sentences. Ask
   only what changes the slicing: who the user is, the externally
   observable behaviour, the boundary (web UI, HTTP API, CLI), hard
   constraints.
2. Detect the context. A new system, or a change to an existing one? With
   no working build/test/deploy path yet, the first slice is a walking
   skeleton — the thinnest end-to-end thread through real infrastructure,
   before any real feature content. Note the *project directory* — `.` at
   the repo root, or a subfolder for a monorepo package or a smoke-test
   app; later phases run install/test/build there. The branch is always
   cut at the repo root regardless.
3. Slice vertically. Each slice cuts through every layer it needs to
   deliver one observable behaviour — never a horizontal "build the DB
   layer" slice with no independent value. Order so the earliest slices
   de-risk the most.
4. Name each slice's mechanism, and check for an existing solution before
   designing a new one — in order, an installed skill or plugin, a
   first-party MCP server, a library, then a single well-designed model
   call. One line in the plan states which; this is a check, not a new
   document.
5. Validate every slice against INVEST — Independent, Negotiable, Valuable,
   Estimable, Small, Testable. Split anything that isn't Small and
   Testable; drop anything with no discernible value.
6. Write the plans. Create `plans/<feature-slug>/`:
   - A `README.md` index from the Feature index template in
     `${CLAUDE_PLUGIN_ROOT}/skills/tdd-plan/assets/plan-template.md`,
     listing every slice in order with status.
   - One `<NN>-<slice-slug>.md` per slice, from the Slice plan template in
     the same file.
   - The fields that matter most: the acceptance criterion as a
     Given/When/Then that becomes the slice's failing outer test, the
     seeded unit test list, and the paths the slice **edits** and
     **creates** — not only the ones that already exist. Two
     independently planned slices that touch no common file can still
     collide if both silently create the same new module; declaring
     intended new files is what makes "disjoint" mean something before
     either exists. Record these paths as the Files section's
     `aeo-independence` block — the exact format
     `${CLAUDE_PLUGIN_ROOT}/scripts/independence.mjs` parses; that
     file's header comment is the format's only definition, so read it
     rather than guessing at the shape.
7. Confirm and hand off. Show the founder the slice list — titles,
   one-line goals, the proposed first slice. Get sign-off before any code
   is written, then recommend `red-green-refactor` on slice `01`.

## What makes a plan good

- One behaviour per slice — if its value doesn't fit in a sentence, it's
  too big.
- The acceptance criterion is concrete and observable from outside the
  system — a real endpoint, not an internal function.
- Out-of-scope is explicit — listing what a slice defers is how it stays
  thin.
- Executable by someone else, from the plan file alone.

## Output

Plans only — no production or test code in this phase. `plans/<feature-slug>/`
with a README index and one plan per slice, plus a short summary of the
slices and the recommended first one.
