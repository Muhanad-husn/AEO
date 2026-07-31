---
name: review
description: Thin entry point that dispatches the reviewer role subagent for the two-stage review - spec compliance first (does the change satisfy the spec, does the test encode its intent, is any contract movement justified in the PR body), then code quality. Use on demand - when the founder says 'review this', or for high-blast-radius changes.
---

# Review — Entry Point

Dispatch the **reviewer** role subagent (read-only by construction) against the
current branch's diff versus `main`, naming the issue, the slice plan, and the
spec section under review. Review is on-demand in v2 — use it when the founder
asks, or when the change touches shared modules (`llm.py`, `cli.py`, config
loading) or corpus-facing heuristics.

The reviewer runs its two stages strictly in order:

1. **Spec compliance** — change vs. spec; the acceptance test encodes the spec's
   intent (would it fail if the behaviour were wrong?); spec or test edits in the
   branch are legitimate when justified in the PR body — what gets flagged is
   unjustified contract movement, or an edit whose purpose is making failing code
   pass.
2. **Code quality** — correctness, edge cases, silent failures, clarity, test
   quality, CLAUDE.md conventions, and over-engineering (speculative abstraction,
   unneeded config, magic-number heuristics, a fix bigger than its bug — a
   simplicity finding ranks equal to a defect). Findings ≥ 80 confidence only.

Relay the report to the founder and post findings to the issue thread. Fixes
route back to the builder; the reviewer never edits anything. A passing review
earns `safe-pr` — never a merge.
