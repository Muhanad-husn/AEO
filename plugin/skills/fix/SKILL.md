---
name: fix
description: Take a small, scoped fix — a bug, a rename, a config or dependency tweak, a copy change — straight from description to a reviewed PR in one builder dispatch, skipping sprint-planning ceremony but not the commit and merge gates. Bounces anything feature-scale back to sprint-start. Use when asked for a quick fix, or handed a small, well-defined change.
disable-model-invocation: true
---

# Fix — the fast lane

The scope check is the whole skill: if it fits in one sentence and doesn't
need a planned issue, cut a worktree straight from the default branch,
dispatch the builder with the scoped description, and prepare the PR with
`safe-pr`. No slice plan, no test-author relay, no reviewer stage unless
the founder asks for one. Still gated — the commit hook and the merge
block bind exactly as they do on the sprint lane.

**Ports from** `source/axial/dot-claude/skills/fix/SKILL.md`.

**Changes on port:** the same worktree-vs-main-checkout split noted in
`sprint-start` generalizes the same way here. Full port lands in Phase 2.
