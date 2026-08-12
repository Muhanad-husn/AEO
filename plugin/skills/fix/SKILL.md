---
name: fix
description: Take a small, scoped fix — a bug, a rename, a config or dependency tweak, a copy change — straight from description to a founder-approved PR in one builder dispatch, skipping sprint-planning ceremony and the reviewer stage, but not the commit and merge gates. Bounces anything feature-scale back to sprint-start. Use when asked for a quick fix, or handed a small, well-defined change.
disable-model-invocation: true
---

# Fix — the fast lane

One judgement call, one dispatch, one PR. The lane skips ceremony, not
gates.

## Procedure

1. **Scope check.** Fix-sized: a bug, a rename, a config or dependency
   tweak, a copy change, a small behavioural correction. Feature-scale
   work (a new behaviour surface, a new module, anything that deserves a
   planned issue) bounces to `sprint-start`. When in doubt, it's a slice,
   not a fix. The same check decides review: if the change turns out to
   touch a shared, widely-depended-on module or core config or dependency
   wiring, it has stopped being fix-sized. Bounce it rather than pushing
   it through unreviewed.

2. **Cut the worktree** from the default branch. As in `sprint-start`,
   name anything the project's build needs that a fresh worktree won't
   inherit, and run whatever depends on it in the main checkout instead.
   Most fixes have nothing like that.

3. **Dispatch the builder** with the scoped description. For a
   behavioural bug: a regression test that fails before the fix and
   passes after, committed with it. For a non-behavioural change: the
   existing suite is the oracle. It runs the fast tier locally, and if
   the fix touches a module with outer acceptance contracts, the PR waits
   for CI green on those before approval is requested — that run is
   cited, not repeated locally ([D24](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). If the fix
   moves behaviour the spec describes, the builder updates the spec in
   the same branch. No test-author relay and no reviewer stage.

4. **Stay in the lane.** A BLOCKED report on scope creep stops the
   session and routes to `sprint-start`.

5. **Prepare the PR** with `safe-pr`. Note any spec edit in one line of
   the PR body. The lane stops here.

6. **Report and pause.** Post the PR link, report `DONE`. The
   orchestrator merges only on the founder's explicit "approved", then
   runs `safe-cleanup` and removes the worktree.

## Invariants

- One fix = one worktree = one branch = one PR. Never batch, never merge
  without founder approval.
- Statuses: DONE, DONE_WITH_CONCERNS, BLOCKED, NEEDS_CONTEXT. Concerns go
  to the PR or issue thread.
