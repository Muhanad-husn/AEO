# Build Log — ai-enterprise-template

This template was scaffolded with the `agentic-engineering-org` skill. It records the
locked decisions, any divergences from the skeletons, and phase-by-phase progress so
the founder can audit the build.

## Decision Log

| # | Decision |
|---|----------|
| DEC-1 | Test authorship is split. The **outer acceptance test is the behavioral contract** — authored by the spec/test-author, committed red, then locked. The implementer drives inner unit cycles only and may not edit the outer test or specs. |
| DEC-2 | Roles are **addressable subagent files** in `.claude/agents/`, each with a locked `tools` set and a pinned `model`. |
| DEC-3 | Two gates are **deterministic hooks**: *agents-never-merge* and *tests-green-before-commit*. Branch protection backstops them server-side. |
| DEC-4 | **GitHub issues and PRs** are the system of record. Sprints, not sessions. |
| DEC-5 | One repository. Spec and build are separated by role and a spec-freeze hook, not by folder. |
| DEC-6 | The behavior-first loop is the **vendored `brainqub3/red-green-refactor` harness** (MIT), adapted to the roles and gates. |
| DEC-7 | DEC-4 runs through the **installed GitHub plugin** (issue/PR tools), not raw `gh` in Bash. The *agents-never-merge* gate must also match the plugin's merge-capable tool. |
| STACK | Profile = **Python 3.13 + uv + pytest + ruff** (default). Detected on this machine: git 2.49.0, uv 0.11.6, python 3.13.14, node 24.16.0, gh 2.87.3. All present. |
| PLUGIN | GitHub plugin MCP tool namespace confirmed as `mcp__plugin_github_github__*`. Merge-capable tool for the Phase 3 gate: **`mcp__plugin_github_github__merge_pull_request`** (also note `update_pull_request_branch`, `create_pull_request`, `pull_request_review_write`). |
| SCOPE | This run stops after **Phase 2** (role subagents exist under `.claude/agents/`), per founder instruction. No GitHub remote created; `gh repo create` and branch-protection commands are prepared but not run. Phases 3-6 remain. |

## Progress Tracker

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 0 — Repository foundation | DONE | 2026-07-05 | Tree created; green baseline (`uv run pytest` passing); one commit on `main`. Remote + branch-protection commands prepared, not run. |
| 1 — CLAUDE.md handbook | DONE | 2026-07-05 | Constitution written; a fresh reader can answer "who may merge?" (founder only) and "who may edit specs, and when?" (spec-author, in a deliberate pass, never mid-implementation). |
| 2 — Role subagents | DONE | 2026-07-05 | Five tool-locked, model-pinned subagents under `.claude/agents/`. Reviewer is read-only. Path guards in frontmatter reference `deny.sh` (built in Phase 3). |
| 3 — Hard gates (hooks) | NOT STARTED | — | Out of scope for this run. |
| 4 — Vendor TDD harness | NOT STARTED | — | Out of scope for this run. |
| 5 — Sprint & role wiring | NOT STARTED | — | Out of scope for this run. |
| 6 — Dry run & validation | NOT STARTED | — | Out of scope for this run. |

## Checkpoints (self-approved by the founder for this run)

Per instruction, the sole human/founder recorded what would be presented at each
checkpoint, approved it, and continued — stopping after Phase 2.

- **Checkpoint 0** — Presented: the directory tree, green `pytest` baseline, single
  `main` commit, and the two commands below for the founder to run. **Approved.**
  The remote and branch protection are intentionally deferred (no `gh` run this session).
- **Checkpoint 1** — Presented: `CLAUDE.md` wording. Confirmed it answers the two
  required questions from the file alone. **Approved.**
- **Checkpoint 2** — Presented: each role's `tools`, `model`, system prompt, and
  frontmatter path guards; reviewer confirmed to have no Edit/Write. `pr-review-toolkit`
  reuse decision: **not reused** — wrote the reviewer directly to guarantee the
  two-stage ordering (spec-compliance first, then code-quality) and the "does the test
  encode intent?" check, exactly as DEC-1 requires. **Approved.**

## Commands prepared for the founder (NOT run this session)

```bash
# 1. Create the remote (adjust owner/visibility to taste)
gh repo create <owner>/ai-enterprise-template --private --source=. --remote=origin --push

# 2. Branch protection on main: require a PR, require status checks, block direct pushes.
gh api -X PUT repos/<owner>/ai-enterprise-template/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_pull_request_reviews[required_approving_review_count]=1' \
  -F 'enforce_admins=true' \
  -F 'restrictions=null'
```
