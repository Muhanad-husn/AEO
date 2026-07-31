---
name: tdd-ci
description: Once a slice is green locally, detect the stack and write the matching GitHub Actions workflow — a unit job plus an e2e or integration job, with artifacts uploaded on failure — so the same tests gate every pull request instead of only running on one machine. Trigger on a request to add CI, wire up GitHub Actions, or make tests a required check. Runs after red-green-refactor and before safe-pr.
---

# TDD CI — promote tests to CI

Turns "green on my machine" into a required check: detects the unit
runner and whether the outer loop is a browser e2e suite or a
CLI/API/service integration test, picks and customizes a workflow
template, handles a subdirectory project's working-directory correctly,
validates the YAML, and commits the workflow — confirming before any push,
since that's outward-facing.

**Ports from**
`source/upstream-red-green-refactor/.agents/skills/tdd-ci/SKILL.md`,
upstream at `593e7ab`. The Node/Playwright workflow templates (V-08 in
`docs/EVIDENCE.md`) are the harness's only existing multi-stack machinery
— mined for stack detection, not dead weight.

**Changes on port:** drop the dangling `find-docs`/`ctx7` doc-lookup
reference used for confirming action versions (V-09) — no environment
ships those tools. Full port lands in Phase 2.
