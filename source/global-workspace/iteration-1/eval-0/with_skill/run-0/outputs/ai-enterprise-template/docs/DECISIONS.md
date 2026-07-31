# Decision Log

Append a row whenever you diverge from a reference skeleton or resolve an ambiguity.

## Locked decisions (from the skill — do not relitigate)

| # | Constraint |
|---|------------|
| DEC-1 | Test authorship is split. The outer acceptance test is the behavioral contract — authored by the spec/test-author, committed red, then locked. The implementer drives inner unit cycles only and may not edit the outer test or the specs. |
| DEC-2 | Roles are addressable subagent files in `.claude/agents/`, each with a locked `tools` set and a pinned `model`. |
| DEC-3 | Two gates are deterministic hooks, not advice: agents-never-merge and tests-green-before-commit. Branch protection backstops them server-side. |
| DEC-4 | GitHub issues and PRs are the system of record. Sprints, not sessions. |
| DEC-5 | One repository. Spec and build are separated by role and a spec-freeze hook, not by folder. |
| DEC-6 | The behavior-first loop is the vendored `brainqub3/red-green-refactor` harness (MIT), adapted to the roles and gates — not hand-built. |
| DEC-7 | DEC-4 runs through the installed GitHub plugin (issue/PR tools), not raw `gh` in Bash. Consequence: the agents-never-merge gate must also match the plugin's merge-capable tool, not only `Bash(git merge …)`. |

## Build decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-05 | Stack profile = Python 3.13 + `uv` + `pytest` + `ruff` (default). | Detected `uv 0.11.6`, `python 3.13.14`, `node v24.16.0`, `gh 2.87.3` present. `pytest` is not on the global PATH but is provided via the `dev` dependency group and run with `uv run pytest`. |
| 2026-07-05 | GitHub plugin MCP tool namespace = `mcp__plugin_github_github__*`; merge-capable tool = `mcp__plugin_github_github__merge_pull_request`. | Recorded now so Phase 3's merge gate and Phase 5's issue/PR wiring can match the real names. (`/plugin` in an interactive session confirms; also visible in the session tool manifest.) |
| 2026-07-05 | Reviewer written bespoke, not reused from the `pr-review-toolkit` plugin. | The skill permits reuse only if the two-stage ordering (spec-compliance first) and the "does the outer test encode intent, not a tautology?" check are preserved. The stock toolkit is a general code-quality reviewer and does not enforce spec-first ordering nor the intent check as stage 1, so it fails the reuse condition. The two-stage contract is encoded directly in `reviewer.md`. |
| 2026-07-05 | Each writing role's path guard lists both `Edit(...)` and `Write(...)` match rules per forbidden path. | The `if:` permission-rule matcher distinguishes the `Edit` and `Write` tool verbs; the reference skeleton showed only `Edit(...)`. Adding the parallel `Write(...)` rule closes the gap so a `Write` to a forbidden path is also denied. `deny.sh` (Phase 3) still backstops via stdin-JSON inspection if a matcher form drifts. |
| 2026-07-05 | This run: build executed to end of Phase 2 only, in supervised/self-approved mode. Phase 0 remote creation and branch protection were prepared but NOT run (printed for the founder). Phase 3+ (hooks, settings.json) deliberately not started. | Scoped scaffolding run. Agent frontmatter references `.claude/hooks/deny.sh`, which Phase 3 will create. |
