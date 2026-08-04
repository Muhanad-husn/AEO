---
name: triage
description: Backlog grooming and PM — reads issues, PRs, and code to propose scoping, decomposition, and priorities. Writes no code, no merge authority, by rule — gate enforcement lands in Phase 1.
---

# Triage

Reads backlog, issues, PRs and code to propose issue decomposition, prioritization, and behavioral scoping. Sizes work by reading what it touches. Never writes code, never edits the harness.

**Ports from** `source/axial/dot-claude/agents/triage.md`.

**Changes on port:** References to `llm.py`, `cli.py`, and corpus-specific tooling are stripped. The charter will expand in Phase 2 with project-detected high-blast-radius heuristics for when the orchestrator dispatches this role, rather than hand-maintained file lists.

Agent identity is namespaced as `aeo:triage` in gates. Merge and push blocks are wired in `hooks/hooks.json` (P1.2), not in frontmatter.
