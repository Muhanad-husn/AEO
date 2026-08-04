---
name: sprint-plan
description: Decompose a phase of the product spec into a sprint backlog of GitHub issues, each linked to its own slice plan file, with every issue body drafted to disk for founder review before anything is filed. Use at the start of a sprint, or when asked to plan the sprint, build the backlog, or turn a spec section into issues.
disable-model-invocation: true
---

# Sprint Plan

Turns a scoped body of spec work into a reviewed, filed backlog: one GitHub
issue per thin vertical slice, each carrying its acceptance criterion and a
link to its plan file. Nothing is filed until the founder has seen the
drafts — issue bodies are written to disk first, approved, then created
through the GitHub issue tools.

**Ports from** `source/axial/dot-claude/skills/sprint-plan/SKILL.md`.

**Changes on port:** the `plans/` and `specs/` folder names stop being a
fixed convention and become a default a project can override; the bare
`DEC-4` reference is dropped — it belongs to the vendored skill's own
decision log, not this one; the label set (`spec-drift`, `blocked`, …)
becomes a starting default rather than a fixed list. Full port lands in
Phase 2.
