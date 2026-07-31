# Project instructions — agentic-org

This repo runs a **tool-locked, hard-gated agentic workflow**. Read this before
acting.

## Non-negotiable rules

- **The human is the merge seat.** No agent merges, pushes, or creates remote
  repos. `git push`, `gh repo create`, `gh api`, and branch-protection commands
  are denied by `.claude/settings.json` — they may be *printed* for the human to
  run, never executed.
- **Ownership is enforced, not advisory:**
  - `specs/` is written only by `architect`.
  - `tests/` is written only by `test-author`.
  - `src/` is written by `implementer`.
  - `.orchestration/` is written by `integrator`.
  - `reviewer` writes nothing.
- The `implementer` **physically cannot** modify `tests/` or `specs/` — attempts
  are blocked by the `role_guard` PreToolUse hook. If the implementer thinks a
  test or spec is wrong, it must STOP and report to the human, who routes the
  change back to the `test-author` or `architect`.

## Flow

1. `architect` writes/updates a spec in `specs/`.  → human accepts (GATE 1)
2. `test-author` writes failing tests in `tests/`. → human accepts (GATE 2)
3. `implementer` edits only `src/` until `uv run pytest` is green.
4. `reviewer` reads the diff and reports findings (read-only). → human reads (GATE 3)
5. `integrator` runs the suite and writes a merge brief to `.orchestration/`.
6. **Human merges** (GATE 4). Only this step lands code.

## Commands

- Install/lock env: `uv sync`
- Run tests: `uv run pytest`
- The implementer must run `uv run pytest` and iterate until green before handing off.
