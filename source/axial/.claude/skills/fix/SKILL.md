---
name: fix
description: The fast lane for a bug or small change. One builder dispatch makes the surgical fix — with its own regression test when behavior is involved — and it lands as a PR the founder approves. Feature-scale work bounces to /sprint-start. Use when the founder says 'fix this', 'quick fix', or hands over a bug or small change.
---

# Fix — The Fast Lane

Run from the **main session (orchestrator)**. One judgement call, one dispatch, one
PR. The lane skips ceremony, not gates: the commit gate and the merge block still
bind, and the change still lands as a PR the founder approves.

## Procedure

1. **Scope check.** Is this fix-sized — a bug fix, refactor, rename, config or
   dependency tweak, copy change, small behavioral correction? If it is
   feature-scale (a new behavior surface, a new module, work that deserves a
   planned issue), bounce it to `/sprint-start` and stop. When in doubt, it is a
   slice, not a fix.

2. **Cut the worktree** from fresh `main` — the fast lane skips ceremony, not
   isolation:

   ```
   git worktree add -b fix/<slug> .claude/worktrees/fix-<slug> main
   ```

   Give the builder that absolute path as its working directory. `data/` is
   gitignored and absent there, so any corpus check runs in `D:/axial`.

3. **Dispatch the builder** with the scoped description. The builder makes the
   change and owns its own testing: for a behavioral bug, a regression test that
   fails before the fix and passes after, committed together with the fix; for a
   non-behavioral change, the existing suite is the oracle. It runs only its own
   tests locally — the src tier is the commit gate's job, the phase suite is
   CI's. If the fix moves
   behavior that `specs/` describes, the builder updates the spec in the same
   branch. No test-author relay, no red-commit flag, no reviewer stage.

4. **Stay in the lane.** If the builder reports BLOCKED on scope creep, stop and
   route to `/sprint-start`.

5. **Prepare the PR** with `safe-pr`: suite green, evidence collected and
   secret-scanned, branch pushed, PR opened into `main`. Note any spec edit or
   test change in one line of the PR body. **The lane stops here.**

6. **Report and pause.** Post the PR link, report `DONE`. On the founder's
   **"approved"** the orchestrator merges, runs `/safe-cleanup` on the merged
   branch (cleanup is pre-approved), then `git worktree remove <path>` and
   `git worktree prune`.

## Invariants

- One fix = one worktree = one branch = one PR. Never batch, never merge without
  founder approval.
- The builder never touches `.claude/`; harness changes go through the orchestrator.
- A corpus-facing heuristic change needs a real-corpus check before promotion — a
  green suite is not that evidence.
- Statuses: DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT; concerns go to the
  PR or issue thread.
