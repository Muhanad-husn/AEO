# Operating rules for Claude in this repo

This repo runs an AI dev team. One human (the founder) is the only person who
merges to `main`. Follow these rules; they override convenience.

## Non-negotiable guardrails
- **Never merge to a protected branch (`main`, `master`, `release`, `production`)
  and never `git push`.** Merging a PR is the founder's action alone.
- **Never `git commit` while the test suite is red.** Fix the tests or stop and
  report — never delete, skip, or weaken tests to force a green commit.
- **Never** run `gh repo create`, `gh api`, `gh pr merge`, or branch-protection
  commands. Print them for the founder instead (`docs/SETUP_COMMANDS.md`).

## Workflow
- Delegate down the pipeline: `triage → spec-writer → test-writer → implementer
  → reviewer`. Each role's boundaries are in its `.claude/agents/*.md` file.
- All code work happens on a `feat/<slug>` branch, never on `main`.
- Test-first: tests are written (and confirmed failing) before implementation.

## Stack
- Python ≥3.11, managed with `uv`. Tests: `uv run pytest -q`. Lint:
  `uv run ruff check src tests`.

## Decisions
- The founder is the only human, so approval gates are self-approved and logged
  in `docs/APPROVALS.md`. Record the decision there before continuing.
