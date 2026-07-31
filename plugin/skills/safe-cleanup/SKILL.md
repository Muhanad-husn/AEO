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
byte-identical between upstream and the prior production copy, and audited
clean: dry-run by default, `--apply --yes` plus an explicit category flag,
a static protected set, a recovery log of every deleted SHA written before
deletion, and refusal on a detached HEAD or an ambiguous base. None of
that is L-05's guard — its only length check (`if (!toDelete.length)`)
guards the *delete* set being empty. L-05 (`docs/EVIDENCE.md`) is the
opposite direction: an empty or suspiciously small *keep* set, which is
what running in the wrong working directory produces, and which makes
every artifact look orphaned.

**Changes on port:** L-05's fail-closed abort on an empty or suspiciously
small keep-set is added during the Phase 2 port, not merely verified —
with no override flag, raised before any confirmation prompt, logging, or
deletion. The port also closes a related hazard: `gh()` returns `null` on
failure and the PR-list loop swallows the error, so a failed `gh pr list`
silently clears PR data for every branch rather than reporting "no open
PRs" — which can let a branch an open PR would otherwise protect fall
through to the ancestor-merged rule and be deleted. The port must treat
that failure as missing data, not as an all-clear. Full port lands in
Phase 2.
