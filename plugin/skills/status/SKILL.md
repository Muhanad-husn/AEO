---
name: status
description: Render the project's current state — phase, open issues, PR status, and the Decision Log — as a generated view, never a hand-maintained one. Use when asked for project status, "where are we", or at the start of a session that needs ground truth instead of a memory file's word for it.
disable-model-invocation: true
---

# Status — the North Star, generated

No port source — this skill is new to this project (EN-7, D5 in
`docs/DECISIONS.md`). It closes a gap the vendored skill has: a
hand-maintained tracker that drifts from the issues and PRs it's supposed
to summarize. This skill instead reads GitHub issues, PR state, and the
repo's Decision Log directly, every time it runs, and renders them —
never edited by hand, never trusted from a stale memory file (see L-08's
"front-load ground truth" lesson in `docs/EVIDENCE.md`).

**Status:** not yet implemented. This stub declares the contract only. It
lands in Phase 6, once the plugin's own issue and PR conventions are
settled enough to render against.
