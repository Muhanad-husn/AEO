---
name: safe-cleanup
description: Safely retire local feature branches once their pull requests have merged or closed — classify every branch as merged, abandoned, open, or protected, report the classification, then delete only what's confirmed and log the SHA of everything removed. Never touches the remote, never deletes an unmerged branch without explicit sign-off. Trigger on a request to clean up branches, tidy the repo, or prune stale local work.
---

# Safe Cleanup — retire stale branches

The companion to `safe-pr`: once a PR is done, this classifies every local
branch against the base branch and the PR state, shows the founder the
table, and deletes only the categories approved. Same posture as `safe-pr` —
report first, confirm before deleting, keep everything recoverable.
**Local branches only** — this skill never deletes on the remote. It does
**report** any remote branch whose PR merged, because nothing else in the
plugin ever would: `gh pr merge --delete-branch` deletes the local branch
first and stops on that failure, so a branch held by a worktree gets merged,
loses nothing locally, and stays on `origin` indefinitely (#125). Retiring
one is `git push origin --delete <branch>`, and it stays the founder's call.

Classification lives in
`${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs`,
cross-referencing git merge status and `gh` PR state. Dry-run by default;
deletes nothing without `--apply --yes` plus the category approved.

## What counts as what

| Bucket | Meaning | Default action |
|---|---|---|
| **merged** | Commits already in the base (ancestor), or PR merged and `git cherry` confirms every commit is present in the base | Eligible to delete (after confirmation) |
| **ahead-of-merged-pr** | PR merged, but the branch carries extra commits not in the base (reused name, or commits pushed after merge) | Never delete — report only |
| **abandoned** | PR closed without merging — carries commits not in the base | Delete only on explicit opt-in; recoverable via reflog or the log only |
| **open-pr** | Has an open PR — active work, wins even if the branch is an ancestor of the base | Never delete |
| **local-only** | Unmerged local commits, no PR (possible WIP) | Never auto-delete — report only |
| **protected** | base / `main`/`master`/`develop`/`release`, the current branch | Never delete |

If `gh` or the remote is unavailable, or a lookup fails, PR-based buckets
can't be determined — only git-merged branches are eligible, and the report
says so.

## Procedure

1. Freshen the base branch first (`git fetch origin` plus fast-forward, if
   there's a remote), then run from the repo root, ideally with the base
   branch checked out — the current branch is always protected, so a
   feature branch can only become eligible once it's no longer current. The
   script refuses to run on a detached HEAD, since the current branch must
   be well-defined to protect it.
2. Dry-run report — deletes nothing:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs"
   ```

   Show the founder the table and the summary (merged / abandoned / kept
   counts), and the `REMOTE` block under it if there is one — remote
   branches whose PR merged, listed and never deleted. That block needs
   both a remote and usable PR data; without them it says so rather than
   printing an empty list, which would read as "none stranded".
3. Confirm. Explain the buckets in plain terms: merged branches are safe
   (their work is in the base, or their PR merged); abandoned branches
   carry commits not in the base, so deleting them drops that work,
   recoverable only via `git reflog` for a limited window; open-pr and
   local-only branches stay untouched regardless. Get an explicit go-ahead
   for the merged set, and a **separate** one for the abandoned set if the
   founder wants those gone too.
4. Apply — delete only the approved categories, writing a recovery log
   first:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs" --apply --yes --delete-merged
   ```

   The recovery log (`.tdd-branch-cleanup.log` by default, or `--log
   <path>`) is written before any deletion, and the run aborts if it can't
   be written. Add `--delete-abandoned` only if the founder approved that
   set. `--protected name1,name2` shields extra branches; `--base <branch>`
   overrides base-branch detection.
5. Report which branches were deleted, and surface the recovery block
   (`branch → SHA`) — restoring one is `git branch <name> <sha>`.
6. If a deleted branch's slice plan still reads in-progress, update it and
   the feature README to reflect the merge.

## Safety rules (non-negotiable)

- **Fails closed on a hollow keep-set.** The delete-set-empty case is
  already guarded; the risk runs the other way. The keep-set is the
  branches kept for a substantive reason — an open PR, unmerged local
  work, commits beyond a merged PR. Branches protected by name don't
  count: the base and the current branch are protected in every
  repository, so counting them would make the check pass everywhere and
  assert nothing. When that set is empty and branches are nonetheless
  queued for deletion, the classifier has not shown it can tell the two
  apart, which is what running from the wrong repository or against a
  base containing all work looks like. Apply mode refuses, before the
  recovery log and before any deletion, with no override flag: an
  override is exactly what gets reached for at 2am. The recourse is
  `git branch -d <name>` per branch — the same work without the blast
  radius. Dry-run still prints the table, because that is how you see
  the problem.
- **A failed `gh pr list` is missing data, not an all-clear.** If the
  call errors, or returns nothing usable, PR state for every branch is
  unknown rather than "no open PRs" — and a branch an open PR would
  otherwise protect must never fall through the merged-ancestor rule as
  a result. Apply mode refuses outright, since the open-PR-always-wins
  guarantee cannot be honoured on data that was never retrieved. The
  report distinguishes three states and never collapses them: available,
  failed, and gh-not-installed.
- Local only — never delete a remote branch from this skill; that's a
  deliberate, separate action the founder drives themselves. Reporting one
  is not deleting it, and the report is read from `git ls-remote`, never
  from `git branch -r`: remote-tracking refs are a local cache that goes
  stale in the direction that invents work, listing branches the remote
  deleted long ago.
- Never delete the default branch, the current branch, another protected
  branch, or any branch with an open PR.
- Never force-delete unmerged local work (`local-only` with unique commits)
  — report it and let the founder decide per branch.
- Safe delete (`git branch -d`) for git-merged branches; `-D` only for
  PR-confirmed-merged or explicitly approved abandoned branches, SHA logged
  first, re-verified at the moment of deletion.
- Dry-run is the default. Nothing applies until the founder has seen the
  report and confirmed.

## When to run

After PRs merge — straight after `safe-pr` reports one, or periodically.
`safe-pr` opens the PR; this retires the branch once that PR is done.
