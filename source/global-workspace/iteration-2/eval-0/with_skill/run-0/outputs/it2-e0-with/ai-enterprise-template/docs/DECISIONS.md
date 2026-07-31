# Decision Log

Append a row whenever we diverge from a skeleton or resolve an ambiguity.

| # | Decision |
|---|----------|
| DEC-1 | Test authorship is split. The outer acceptance test is the behavioral contract — authored by the spec/test-author role, committed red, then locked. The implementer drives inner unit cycles only and may not edit the outer test or the specs. |
| DEC-2 | Roles are addressable subagent files in `.claude/agents/`, each with a locked `tools` set and a pinned `model`. |
| DEC-3 | Two gates are deterministic hooks, not advice: *agents-never-merge* and *tests-green-before-commit*. Branch protection backstops them server-side. |
| DEC-4 | GitHub issues and PRs are the system of record. Sprints, not sessions. |
| DEC-5 | One repository. Spec and build are separated by role and a spec-freeze hook, not by folder. |
| DEC-6 | The behavior-first loop is the vendored `brainqub3/red-green-refactor` harness (MIT), adapted to the roles and gates. |
| DEC-7 | DEC-4 runs through the installed GitHub plugin (issue/PR tools), not raw `gh` in Bash. Consequence: the *agents-never-merge* gate must also match the plugin's merge-capable tool. |
| DEC-8 (stack profile) | Default profile confirmed: **Python 3.13.14 + uv 0.11.6 + pytest + ruff**. Toolchain verified present in Phase 0: git 2.49.0, gh 2.87.3, Node 24.16.0. Wherever a concrete test/lint command appears, read it as the profile's command. |
| DEC-9 (plugin tool names) | GitHub plugin MCP tool namespace confirmed as `mcp__plugin_github_github__*`. The merge-capable tool is `mcp__plugin_github_github__merge_pull_request` (also relevant: `create_pull_request`, `merge_pull_request`, `update_pull_request_branch`, `push_files`). The Phase 3 merge gate must add an MCP matcher for `mcp__plugin_github_github__merge_pull_request`, since a Bash `git merge` rule cannot see a plugin-driven merge (DEC-7). |
| DEC-10 (run scope) | This build run is authorized to go only through Phase 2 (role subagents). Phases 3-6 (hooks, harness, sprint, dry run) are deferred. No GitHub remote created; `gh repo create`, `gh api` branch-protection, and `git push` are prepared-only (printed), not executed. |
