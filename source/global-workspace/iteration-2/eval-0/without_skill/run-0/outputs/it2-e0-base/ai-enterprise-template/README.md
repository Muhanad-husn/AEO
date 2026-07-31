# AI Dev-Team Template

A reusable template repo for running an AI software team inside **Claude Code**.
Five role subagents — triage, spec-writer, test-writer, implementer, reviewer —
run a test-first pipeline. A single human founder is the only one who can merge
to `main`. Two guardrails are non-negotiable and enforced in code:

1. **Agents never merge to `main` and never push.**
2. **Agents never commit while tests are failing.**

## Quick start
```bash
# 1. Use this repo as a template (or copy it), then:
git config core.hooksPath .githooks   # enable native guardrails (not auto-cloned)
uv sync --extra dev                    # create the env, install pytest + ruff
uv run pytest -q                       # should be green

# 2. In Claude Code, drive the pipeline by delegating to the subagents:
#    triage -> spec-writer -> test-writer -> implementer -> reviewer
# 3. You (the founder) review the reviewer's summary and merge the PR.
```

See `docs/SETUP_COMMANDS.md` for the GitHub remote + branch-protection commands
(you run those; the AI team is blocked from them by design).

## Layout
```
.claude/
  agents/        five role subagents (the team)
  hooks/         git_guard.py — PreToolUse guardrail
  settings.json  deny-list + hook wiring
.githooks/       native pre-commit / pre-push backstops
docs/            WORKFLOW, APPROVALS (self-approval log), SETUP_COMMANDS, specs/
src/app/         placeholder package (replace with your code)
tests/           pytest suite (starts green with a smoke test)
```

## How the guardrails work
- `.claude/settings.json` denies `git push`, `gh repo create`, `gh pr merge`,
  `gh api`, and asks before `git merge`/`git rebase`.
- `.claude/hooks/git_guard.py` runs on every Bash call: it blocks pushes, PR
  merges, merges on protected branches, repo admin, and refuses `git commit`
  when `pytest` is not green or when you're on a protected branch.
- `.githooks/pre-commit` and `pre-push` repeat those checks natively, so the
  rules hold even if a commit is attempted outside Claude Code.

The founder can intentionally bypass the native hooks with `--no-verify`; agents
run non-interactively and must not.

See `docs/WORKFLOW.md` for the full pipeline diagram and role boundaries.
