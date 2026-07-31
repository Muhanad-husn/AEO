---
name: triage
description: Dispatch the read-only triage role to turn a raw idea into scoped GitHub issue proposals, size a request against the existing code, or groom the backlog — proposing only, never filing. Use when asked to scope an idea, size a request, or groom the backlog.
disable-model-invocation: true
---

# Triage — entry point

Hands the founder's request and its relevant context — idea text, issue
numbers, spec sections — to the triage role, which reads the code and the
backlog through the GitHub issue tools and comes back with a
scoping/decomposition/priority proposal. It writes no code and files
nothing; the founder acts on the proposal through `sprint-plan`'s
draft-then-approve flow, or by approving a single issue directly.

**Ports from** `source/axial/dot-claude/skills/triage/SKILL.md`.

**Changes on port:** near-verbatim — this skill is already stack-agnostic.
Full port lands in Phase 2, alongside the triage agent role built in P0.3.
