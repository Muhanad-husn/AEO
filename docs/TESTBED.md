# The testbed

A permanent repository the plugin is exercised against, kept for the life of the
project. It replaces the throwaway fixtures earlier verification runs created and
deleted.

| | |
| --- | --- |
| On disk | `D:\aeo-testbed\repo` — the main checkout |
| Worktrees | `D:\aeo-testbed\wt-issue-1` — one per issue, cut by `sprint-start` |
| On GitHub | `https://github.com/Muhanad-husn/aeo-testbed`, private |
| Default branch | `main` |

## Why it exists separately

[D21](DECISIONS.md) keeps the plugin out of the repository that builds it. The
gates cannot be trusted on evidence gathered from the tree that authors them, and
a stub skill that reads as a work order is not a skill under test.

Verification also needs things this repository cannot supply without polluting it:
a remote whose default branch is behind a feature branch, real issues to select
from, CI that actually runs, and a pull request a merge gate can be pointed at.

A throwaway satisfies all of that once. It does not let a later run compare
against an earlier one, and re-creating it costs a founder approval every time
because creating a GitHub repository is outward-facing. Hence: one testbed, kept.

## How the plugin is loaded

```
claude --plugin-dir D:/AEO/plugin -p "/aeo:<lane>"
```

Nothing is installed. Nothing is written to `~/.claude/`, no marketplace is
registered, no cache is populated, and there is no uninstall step because there
was no install. This supersedes D21's install-then-uninstall procedure, which
assumed installation was the only route.

## Permissions

The testbed carries `.claude/settings.local.json` granting the tools a headless
`-p` run needs. In `-p` mode nothing can be approved interactively, so without it
a run stalls on the first `Bash` call.

Permissions and hooks are independent layers. Granting `Bash` does not weaken the
gate under test — the commit gate still blocked a red suite with `Bash` fully
allowed.

## What is in it now

`main` carries the naive `runningTotal`, which sums without filtering. `feat/e2e`
is two commits ahead with the non-numeric skip. `fix/1-running-total-input-guard`
adds the input guard, the CI workflow, and the committed test evidence, and is
open as PR #2 against `main`.

That shape is deliberate and worth keeping: a default branch that is *behind* a
feature branch is what exposes a lane that resolves the default branch correctly
and then branches from `HEAD` anyway. A repository whose `main` is current cannot
tell those two apart.

## Rules

- **It is a fixture, not a mirror.** Nothing from `D:\AEO` is ever pushed there.
- **Do not reset it to make a run look clean.** The accumulated shape is the
  point; a run that needs a pristine base gets a new branch off `main`.
- **Deleting it is a founder decision**, the same as creating it was.

## Two things the permission classifier blocks

Creating a GitHub repository and attempting a real merge are both refused by the
auto-mode permission classifier, through `gh` and through the GitHub MCP tools
alike. Neither is a plugin defect.

The first is why the testbed is permanent. The second means the `gh pr merge` arm
of `block-merge` is verified by invoking the hook directly against the testbed's
real working tree, rather than by a live in-session dispatch — real hook, real
repository, real default-branch resolution, but not a real session. Any record of
that result says so.
