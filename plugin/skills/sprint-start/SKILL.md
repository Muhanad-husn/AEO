---
name: sprint-start
description: Select the next unblocked sprint issue by its declared dependencies, dispatch the builder to take it test-first from a failing test to green in its own worktree, then prepare the PR and stop for founder approval. Use when asked to start the sprint, take the next issue, or continue the sprint.
disable-model-invocation: true
---

# Sprint Start

Takes exactly one issue from selection to a prepared PR. The founder's
only actions are the kickoff brief and the merge approval.

Each session is bookended by two short briefs: a kickoff before any code,
a wrap-up at the pause. Plain language plus the technical detail; keep
both short.

## Procedure

1. **Select the issue.** List open sprint issues. Pick the first whose
   `Depends on:` issues are all closed and which carries no `blocked` or
   `needs-context` label. If two are equally next, put the choice to the
   founder with your recommendation.

2. **Load the context.** Read the issue, its slice plan, and the spec
   section it cites. A missing or stale spec section isn't a stop: the
   builder drafts or corrects it in the branch and the PR shows both.

3. **Kickoff brief** (plain + technical + one-line "done when").

4. **Cut the worktree** from the repository's default branch, unless the
   issue's premise doesn't hold there — e.g. it depends on behaviour that
   only exists on another branch — in which case cut from that branch
   instead and name it and the reason in the PR body:

   ```
   git worktree add -b <branch> <path> <default-branch>
   ```

   First, name anything the project's build needs that a fresh worktree
   won't inherit: a gitignored data directory, local env files, a
   downloaded model or cache. Nothing tracked by git follows a worktree
   add. Most projects have nothing like this and skip straight past it.
   Where something does exist, whatever depends on it runs in the main
   checkout instead.

5. **Dispatch the builder** for the whole slice: a failing acceptance
   test from the spec first, watched red, then the implementation to
   green, test and code committed together. The builder runs its own
   tests locally, the files this slice writes or changes. If the change
   touches a module with outer acceptance contracts, it either runs those
   locally too or the PR waits for CI green before approval is requested.
   The full suite is CI's job either way. An edit to a pre-existing test
   or spec gets one explanatory line in the PR body. A BLOCKED report on
   a contested design question goes to the founder with the options, a
   recommendation, and what each costs; the session stops there.

6. **Review when it's warranted.** The founder asks, or the change
   touches a shared, widely-depended-on module, core config, or
   dependency wiring: surface where a defect carries outsized blast
   radius. Otherwise CI plus the founder's PR read is the check.

7. **Prepare the PR** with `safe-pr` and wait for CI green. The pipeline
   stops here.

8. **Wrap-up brief, then report and pause.** Post the PR link, report
   `DONE`. The orchestrator merges only on the founder's explicit
   approval, never before and never on its own judgment, then runs
   `safe-cleanup` on the merged branch and removes the worktree.

## Invariants

- One issue = one worktree = one branch = one PR. Never batch.
- Both briefs happen. No session runs dark.
- Labels (`blocked`, `needs-context`, `done-with-concerns`) reflect
  reality on the issue at all times.
