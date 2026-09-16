---
name: safe-cleanup
description: Retire local feature branches whose pull requests are done, by classifying every branch first and deleting only what the founder approves from that table, with a recovery SHA logged for each. Use when asked to clean up branches, prune stale local work, or tidy a repository after merges.
---

# `safe-cleanup`: classify, then delete

Deletion follows classification. Never the other way round, and never on a
branch nobody has looked at in a table first. The classifier is
`${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs`. It
is dry-run by default and prints the buckets; `--apply --yes` plus the approved
category is what deletes anything.

```
node "${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs"
```

## The buckets

| Bucket | Meaning | Default |
|---|---|---|
| merged | Commits already in the base, or PR merged and `git cherry` confirms every commit is present | Eligible once approved |
| ahead-of-merged-pr | PR merged, branch carries extra commits not in the base | Report only |
| abandoned | PR closed unmerged, commits not in the base | Separate approval, recoverable only via reflog |
| open-pr | Has an open PR, so it is active work | Kept |
| local-only | Unmerged commits, no PR | Kept, reported |
| protected | Base, the current branch, `main`/`master`/`develop`/`release` | Kept |

Show the founder the table and the counts before asking for anything. Explain
the buckets in plain terms: merged work is already in the base, abandoned work
is not and deleting it drops it.

## Why the guards are there

- **An empty keep-set is a hard stop in apply mode, with no override flag
  (L-05).** A garbage collector was built correctly and an empty keep-set, which
  is what running from the wrong directory produces, made every artifact an
  orphan; `--apply --yes` would have taken the whole derived corpus. The
  keep-set here is branches kept for a substantive reason: an open PR, unmerged
  local work, commits beyond a merged PR. Branches protected by name do not
  count, because the base and the current branch exist in every repository and
  counting them would make the check assert nothing. The absence of an override
  is the point; an override is what gets reached for at 2am. The recourse is
  `git branch -d <name>` one branch at a time. Dry-run still prints the table,
  because that is how the problem becomes visible.
- **A failed `gh pr list` is missing data, not an all-clear.** PR state for
  every branch is then unknown rather than "no open PRs", and apply mode stops,
  because the open-PR-always-wins guarantee cannot be honoured on data that was
  never retrieved. The report keeps three states apart: available, failed, and
  gh-not-installed.
- **Local branches only, and the remote is read from `git ls-remote`.**
  Remote-tracking refs are a local cache that goes stale in the direction that
  invents work. The script never deletes on the remote, but it does list remote
  branches whose PR merged, because nothing else does: `gh pr merge
  --delete-branch` deletes the local branch first and stops on that failure, so
  a branch held by a worktree stays on `origin` indefinitely (#125). Retiring
  one is `git push origin --delete <branch>`, and it stays the founder's call.
- **The classifier matches the live script, not a copy of it (V-02).** Two
  fixes once lived in a production hook and never reached the skill that
  described it. Read the script for behaviour; this page says why, not what.

Safe delete (`git branch -d`) for git-merged branches, `-D` only for
PR-confirmed-merged or explicitly approved abandoned ones, SHA logged before
deletion and re-verified at the moment of it. The recovery log is written first
and the run stops if it cannot be written; restoring a branch is
`git branch <name> <sha>`.
