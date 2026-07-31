# Workflow & gates

## Roles, tools, and model tiers

| Role          | Model tier | `tools` allowlist                         | Write scope        |
|---------------|-----------|--------------------------------------------|--------------------|
| `architect`   | opus      | Read, Grep, Glob, Write, Edit              | `specs/`           |
| `test-author` | opus      | Read, Grep, Glob, Write, Edit, Bash        | `tests/`           |
| `implementer` | sonnet    | Read, Grep, Glob, Write, Edit, Bash        | `src/` (only)      |
| `reviewer`    | opus      | Read, Grep, Glob                           | — (read-only)      |
| `integrator`  | haiku     | Read, Grep, Glob, Write, Bash              | `.orchestration/`  |

**Why these tiers:** deep-reasoning roles (spec design, test design, code
review) get `opus`; the high-volume code-writing role gets the cost-effective
`sonnet`; the mechanical orchestration role (run suite, assemble a brief) gets
`haiku`.

## Enforcement layers

1. **`tools:` allowlist (per role).** Hard-enforced by Claude Code — a role can
   only call the tools it lists. `reviewer` has no `Write`/`Edit`/`Bash`, so it
   cannot mutate anything or shell out.
2. **`role_guard` PreToolUse hook.** Intercepts every `Write`/`Edit`/`MultiEdit`/
   `NotebookEdit` and every `Bash` call and denies it when the target path is
   outside the acting role's write scope (e.g. implementer → `tests/` or
   `specs/`). Fails closed.
3. **`permissions.deny` in settings.json.** Blocks remote/merge-landing commands
   (`git push`, `gh repo create`, `gh api`, branch protection) for everyone.

## The gate sequence

```
GATE 1  architect writes spec ........... HUMAN accepts the spec
GATE 2  test-author writes red tests ..... HUMAN accepts the contract
        implementer makes tests green (no gate; loop until pytest passes)
GATE 3  reviewer reports findings ........ HUMAN reads the review
        integrator assembles merge brief in .orchestration/
GATE 4  HUMAN MERGES  ← the only step that lands code
```

## GitHub setup — PRINT ONLY (do not run in this template)

The template deliberately does not create a remote. When you graduate it to a
real repo, a human runs these. They are reproduced here for convenience:

```bash
# 1. Create the remote repo (human runs this)
gh repo create <owner>/agentic-org --private --source=. --remote=origin

# 2. Push the initial history
git push -u origin main

# 3. Require review + green checks before anything merges (human in merge seat)
gh api -X PUT repos/<owner>/agentic-org/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=pytest" \
  -f "enforce_admins=true" \
  -f "required_pull_request_reviews[required_approving_review_count]=1" \
  -f "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -f "restrictions=" -f "allow_force_pushes=false" -f "allow_deletions=false"

# 4. (optional) Turn off auto-merge so a human clicks Merge
gh api -X PATCH repos/<owner>/agentic-org -f "allow_auto_merge=false"
```

These four commands are the human's job. Agents in this repo are blocked from
running them by `.claude/settings.json`.
