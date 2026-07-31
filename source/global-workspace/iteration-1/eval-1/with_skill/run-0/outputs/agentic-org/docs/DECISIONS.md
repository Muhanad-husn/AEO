# Decision Log

Append a row whenever you diverge from a skeleton or resolve an ambiguity.

| # | Decision | Rationale |
|---|----------|-----------|
| DEC-1 | Test authorship is split: the outer acceptance test is the behavioral contract (authored by the spec/test-author, committed red, then locked); the implementer drives inner unit cycles only and may not edit the outer test or specs. | Keeps intent authorship separate from implementation. |
| DEC-2 | Roles are addressable subagent files in `.claude/agents/`, each with a locked `tools` set and a pinned `model`. | Roles must be delegable and capability-scoped. |
| DEC-3 | Two gates are deterministic hooks, not advice: agents-never-merge and tests-green-before-commit. Branch protection backstops them server-side. | Gates must be mechanical, not honor-system. |
| DEC-4 | GitHub issues and PRs are the system of record. Sprints, not sessions. | Durable, auditable workflow. |
| DEC-5 | One repository. Spec and build are separated by role and a spec-freeze hook, not by folder. | Simplicity; the separation is enforced, not physical. |
| DEC-6 | The behavior-first loop is the vendored `brainqub3/red-green-refactor` harness (MIT), adapted to the roles and gates. | Do not reinvent the harness. |
| DEC-7 | DEC-4 runs through the installed GitHub plugin (issue/PR tools), not raw `gh`. Consequence: the agents-never-merge gate must also match the plugin's merge-capable tool, not only `Bash(git merge …)`. | A plugin-driven merge is invisible to Bash matchers. |
| STACK | Stack profile = Python 3.13+ with `uv`, `pytest`, `ruff`. Detected in Phase 0: git 2.49.0, uv 0.11.6, Python 3.13.14, Node v24.16, gh present. | Default profile; toolchain verified present. |
| ENV-1 | Build performed under `D:\eval-scratch\e1-with\agentic-org\` per operator instruction; no real GitHub repo created; `gh repo create` / branch-protection commands prepared but printed only, not run. | Sandboxed eval run. |
| ENV-2 | GitHub plugin merge tool namespace recorded from the installed plugin: `mcp__plugin_github_github__merge_pull_request`. Feeds the DEC-7 merge matcher in Phase 3 (out of scope this run). | Confirmed from the loaded plugin tool list rather than an interactive `/plugin`. |
| CP-SELF | Checkpoints 0, 1, 2 self-approved by the agent acting as founder for this run (per operator instruction). Build stopped after the five role subagent files exist; Phase 3+ not started. | Supervised-build checkpoints delegated to this run. |
