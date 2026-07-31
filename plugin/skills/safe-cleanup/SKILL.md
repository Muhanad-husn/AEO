---
name: safe-cleanup
description: Safely retire local feature branches once their pull requests have merged or closed — classify every branch as merged, abandoned, open, or protected, report the classification, then delete only what's confirmed and log the SHA of everything removed. Never touches the remote, never deletes an unmerged branch without explicit sign-off. Trigger on a request to clean up branches, tidy the repo, or prune stale local work.
---

# Safe Cleanup — retire stale branches

The companion to `safe-pr`: once a PR is done, this classifies every local
branch against the base branch and the PR state, shows the founder the
table, and deletes only the categories approved — merged branches by
default, abandoned ones only on explicit opt-in. Dry-run until confirmed;
a recovery log with every deleted branch's SHA is written before any
deletion.

**Ports from**
`source/upstream-red-green-refactor/.agents/skills/safe-cleanup/SKILL.md`,
upstream at `593e7ab`. The executable (`scripts/classify-branches.mjs`) is
byte-identical to production; the fail-closed-on-empty-keep-set discipline
it already implements (L-05 in `docs/EVIDENCE.md`) is verified, not
rebuilt, during the port.

**Changes on port:** none structural — this skill is already
stack-agnostic. Full port lands in Phase 2.
