# Approval Log

The founder is the only human. Per the operating agreement, at each decision
gate the assistant records what it would present, self-approves on the founder's
behalf, and continues. This file is that audit trail.

| # | Gate | Decision presented | Verdict | Date |
|---|------|--------------------|---------|------|
| 1 | Repo topology & guardrail strategy | Two-layer enforcement: Claude Code `PreToolUse` hook (`git_guard.py`) for in-session blocking, plus native git hooks (`.githooks/pre-commit`, `pre-push`) as a backstop. Protected branches: main, master, release, production. | APPROVED | 2026-07-05 |
| 2 | Default stack | Python ≥3.11, `uv` for env/deps, `pytest` for tests, `ruff` for lint. `src/` layout with a placeholder `app` package + smoke test so guardrails have a live signal from commit #1. | APPROVED | 2026-07-05 |
| 3 | Subagent roster & models | triage (haiku), spec-writer (opus), test-writer (sonnet), implementer (sonnet), reviewer (opus). Read-only roles (triage, reviewer) get no write tools; spec/test/implement get scoped write access to their own directory. | APPROVED | 2026-07-05 |
| 4 | Bootstrap commit | The initial template commit is a founder action that establishes the baseline the guardrails then govern. It is made on `main` with `--no-verify` deliberately (the only sanctioned bypass, and only for this first commit). All subsequent work happens on feature branches. | APPROVED | 2026-07-05 |

## Standing decisions
- Agents may **never** merge to a protected branch and **never** push. Merging a
  PR is the founder's sole action.
- Agents may **never** commit while the test suite is red.
- When a spec is ambiguous, agents assume the smallest reasonable interpretation,
  record it, and continue rather than blocking the pipeline.
