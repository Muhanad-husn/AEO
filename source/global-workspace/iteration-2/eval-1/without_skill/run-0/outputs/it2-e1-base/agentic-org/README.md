# agentic-org

A template for an **agentic engineering workflow** in Claude Code where AI
subagents do the building but a **human stays in the merge seat**.

The workflow is enforced by three mechanisms, not by good intentions:

1. **Tool-locked roles** — each subagent's `tools:` allowlist is hard-enforced
   by Claude Code. The `reviewer` literally has no write/execute tools.
2. **Path hard-gates** — a `PreToolUse` hook (`.claude/hooks/role_guard.py`)
   blocks writes to protected trees. The `implementer` physically cannot touch
   `tests/` or `specs/`.
3. **Model tiers** — every role is pinned to a sensible model tier so reasoning
   work goes to a stronger model and mechanical work goes to a cheaper one.

## Roles

| Role          | Model  | Can write        | Can run cmds | Purpose                                       |
|---------------|--------|------------------|--------------|-----------------------------------------------|
| `architect`   | opus   | `specs/`         | no           | Author specs & acceptance criteria            |
| `test-author` | opus   | `tests/`         | yes (pytest) | Turn specs into failing tests (the contract)  |
| `implementer` | sonnet | `src/` only      | yes          | Make tests pass; locked out of tests & specs  |
| `reviewer`    | opus   | nothing          | no           | Read-only review; posts findings, never edits |
| `integrator`  | haiku  | `.orchestration/`| yes (git/pytest) | Assemble the merge brief for the human      |

See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for the gate sequence and the exact
GitHub/branch-protection commands (printed, not run, in this template).

## The gates (human-in-the-loop)

```
architect → [GATE 1: you accept the spec]
   → test-author → [GATE 2: you accept the red tests]
      → implementer → tests go green
         → reviewer → [GATE 3: you read the review]
            → integrator assembles merge brief
               → [GATE 4: YOU merge]   ← the only step that lands code
```

## Getting started

```bash
uv sync                 # create the isolated env + install pytest
uv run pytest           # RED: the seed test fails until the implementer works
```

Then, inside Claude Code, drive the roles with the `/agents` picker or by
asking for a role by name (e.g. "have the implementer make the tests pass").
