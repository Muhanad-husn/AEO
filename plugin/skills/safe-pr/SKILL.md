---
name: safe-pr
description: Open a reviewable pull request once a slice is green — collect the test evidence (a unit summary, plus e2e screenshots and a recording for a UI slice, or terminal transcripts for a CLI, API, or service slice), secret-scan it, generate the PR body from a template, then push and open the PR. Never merges, never force-pushes, never targets a branch other than the repo's default. Trigger on a request to open a PR, raise a pull request, or ship a slice with evidence attached.
---

# Safe PR — evidence-rich pull requests

Phase 4 of the TDD harness: build (`red-green-refactor`) then CI (`tdd-ci`)
then **this**. Runs the collector script in two passes — copy the
evidence and secret-scan it, commit it, then generate a PR body pinned to
that commit so every link resolves — confirms with the founder before the
outward-facing push, and stops. Retiring the branch afterward is
`safe-cleanup`'s job, not this skill's.

**Ports from**
`source/upstream-red-green-refactor/.agents/skills/safe-pr/SKILL.md`,
upstream at `593e7ab` — not the Axial production copy. Per the vendoring
finding in `docs/DECISIONS.md`, the executable
(`scripts/collect-evidence.mjs`) is byte-identical between the two; only
the prose diverged, so upstream is the better migration base.

**Changes on port:** `gh pr create --base main` becomes the detected
default branch (D14 in `docs/DECISIONS.md`, built in Phase 1); everything
else ports with light editing. Full port lands in Phase 2.
