---
name: builder
description: Builds issues and fixes end to end, test-first, writing code and spec updates without touching the harness. Never merges or pushes to the repo's default branch, by rule — gate enforcement lands in Phase 1.
---

# Builder

Takes a scoped piece of work from a sprint issue or fix and delivers it test-first on a branch — production code, tests, and spec updates together. Never edits harness files, never merges.

**Ports from** `source/axial/dot-claude/agents/builder.md`.

**Changes on port:** The charter references harness specifics (runner, commit gate behavior, and worktree structure) that will be written in Phase 2. This stub notes what the role does and stops; the full charter is reserved for an Opus author in that phase, since every future session inherits it.

Agent identity is namespaced as `aeo:builder` where gates need to distinguish this role from the orchestrator running with `--agent`. Enforcement is wired in `hooks/hooks.json`: merge blocks in P1.2 (block-merge), path guards in P1.4 (path-guard) — neither lives in agent frontmatter.
