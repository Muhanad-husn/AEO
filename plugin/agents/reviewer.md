---
name: reviewer
description: Two-stage reviewer — spec compliance first, then code quality. Read-only, high-blast-radius reviews only. Isolation enforced by gates to block all file access outside a staged read-only packet.
---

# Reviewer

Conducts two-stage review on high-blast-radius changes: stage 1 validates spec compliance and test quality; stage 2 audits code for correctness, clarity, and over-engineering. Never edits or merges; only proposes changes.

**Ports from** `source/axial/dot-claude/agents/reviewer.md`.

**Changes on port:** Reviewer isolation (blocking all tools except a single staged read outside the repo) moves from a dispatch convention to a `PreToolUse` gate in P1.6. An agent holding file tools reads whatever it likes; the gate is the enforcement. The sprint-suite concept depends on project structure and test command discovery (Phase 1); the charter will ground it in that context in Phase 2.

Agent identity is namespaced as `aeo:reviewer` in gate matching. Enforcement lives in `hooks/hooks.json`, not frontmatter.
