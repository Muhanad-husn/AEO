# Decision Log

Append a row whenever you diverge from a skeleton or resolve an ambiguity.

## Locked decisions (from the brief — do not relitigate)

| # | Decision |
|---|----------|
| DEC-1 | Test authorship is split. The outer acceptance test is the behavioral contract, authored by the spec/test-author, committed red, then locked. The implementer drives inner unit cycles only and may not edit the outer test or the specs. |
| DEC-2 | Roles are addressable subagent files in `.claude/agents/`, each with a locked `tools` set and a pinned `model`. |
| DEC-3 | Two gates are deterministic hooks, not advice: agents-never-merge and tests-green-before-commit. Branch protection backstops them server-side. |
| DEC-4 | GitHub issues and PRs are the system of record. Sprints, not sessions. |
| DEC-5 | One repository. Spec and build are separated by role and a spec-freeze hook, not by folder. |
| DEC-6 | The behavior-first loop is the vendored `brainqub3/red-green-refactor` harness (MIT), adapted to the roles and gates. |
| DEC-7 | DEC-4 runs through the installed GitHub plugin (issue/PR tools), not raw `gh` in Bash. The agents-never-merge gate must also match the plugin's merge-capable tool, not only `Bash(git merge …)`. |

## Build decisions

| Date | Topic | Decision |
|------|-------|----------|
| 2026-07-05 | Stack profile | Default profile confirmed: Python 3.13.14 + `uv` 0.11.6 + `pytest` + `ruff`. Toolchain present: git 2.49, Node 24.16. `uv` uses a `[dependency-groups] dev` group for `pytest`/`ruff`; sync with `uv sync`, test with `uv run pytest`. |
| 2026-07-05 | GitHub plugin merge tool (Phase 0 discovery) | Installed GitHub plugin exposes the `mcp__plugin_github_github__*` namespace. The merge-capable tool is `mcp__plugin_github_github__merge_pull_request`. The Phase 3 agents-never-merge hook must add an MCP matcher for this tool name in addition to the `Bash(git merge *)` / `Bash(git push * main*)` rules (DEC-7). |
| 2026-07-05 | Scope of this run | Supervised build executed through Phase 2 only, per operator instruction. Phases 3-6 (hooks, harness, sprint wiring, dry run) are deferred. No real GitHub repo created; the `gh repo create` and branch-protection commands are prepared for the operator only (see `docs/checkpoint-0-commands.md`). |
| 2026-07-05 | Reviewer: pr-review-toolkit reuse (Phase 2) | Authored the reviewer from the skeleton as a self-contained subagent rather than depending on the `pr-review-toolkit` plugin. Reason: the template must be portable and not assume that plugin is installed in every product cloned from it. The skeleton preserves the two required properties — two-stage ordering (spec-compliance before code-quality) and the explicit "does the outer test genuinely encode intent, not a tautology?" check. If a project has `pr-review-toolkit` installed, the reviewer prompt can later delegate to it without changing this contract. |
| 2026-07-05 | Path guards reference `deny.sh` (Phase 3) | The writing subagents' frontmatter `PreToolUse` hooks point at `.claude/hooks/deny.sh`, which is authored in Phase 3. Until then the guards are declared but inert; they are proven live in Phase 3. Reviewer read-only needs no hook (Edit/Write withheld). |
