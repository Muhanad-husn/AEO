---
name: sprint-start
description: Select the next unblocked sprint issue by its declared dependencies, dispatch the builder to take it test-first from a failing test to green in its own worktree, then prepare the PR and stop for founder approval. Use when asked to start the sprint, take the next issue, or continue the sprint.
disable-model-invocation: true
---

# Sprint Start

Drives exactly one issue from selection to a prepared PR, unattended in
between: pick the next issue whose dependencies are closed, brief the
founder, cut a worktree, dispatch the builder for a single test-first
slice, gate on the commit hooks, then hand off to `safe-pr`. The founder's
only actions are the kickoff brief and the merge approval.

**Ports from** `source/axial/dot-claude/skills/sprint-start/SKILL.md`.

**Changes on port:** the worktree path and the "run any data-facing check
in the main checkout" step are specific to Axial's gitignored `data/`
directory — generalize to whatever a project's build state can't follow
into a worktree, or drop where a project has none. The reviewer-dispatch
trigger ("shared modules like `llm.py` / `cli.py`") becomes a
project-detected high-blast-radius path, not a named file. Full port lands
in Phase 2.
