# AI Enterprise Handbook

## What this is

A one-operator AI software enterprise. The **founder** — the only human — specifies
and decides. Tool-locked role subagents build and check. Two deterministic hooks hold
the line so the boundary is real, not a promise: **agents never merge, and no one
commits a red suite.** This handbook is the constitution every session and subagent
inherits. Default stack: Python 3.13+ with `uv`, `pytest`, `ruff`.

## Hierarchy

Work flows top-down:

**product → subproject (a lifecycle stage) → sprint → issue → behavioral slice.**

A *slice* is the smallest unit of behavior an implementer greens in one inner cycle.
An *issue* is the unit of record on GitHub. A *sprint* is a batch of issues, not a
timed session.

## Roles & authority

| Role | Does | Never |
|------|------|-------|
| **Founder** (human, main session) | Specifies, decides architecture, adjudicates spec drift, **merges**. | Writes production code by hand (delegates it). |
| **Triage / PM** | Grooms the backlog; scopes and decomposes issues; sets priorities. | Writes code or edits files. |
| **Spec author** | Writes behavioral specs under `specs/`. | Writes code or tests; patches a frozen spec mid-build. |
| **Test author** | Writes the outer acceptance test (the locked contract) and tests under `tests/`. | Writes code or specs. |
| **Implementer** | Drives inner unit red→green→refactor cycles; writes code under `src/`. | Edits `tests/` or `specs/`; merges. |
| **Reviewer** | Two-stage review, read-only. | Edits anything; merges. |

**Only the founder merges.** Agents build and check; they never merge to `main` and
never touch branch protection. This is not etiquette — a hook blocks any agent-driven
merge, push to `main`, or direct commit on `main`, and branch protection backstops it
server-side.

## The behavior-first loop (DEC-1)

Every slice starts from behavior, not code:

1. The spec author writes the spec under `specs/`.
2. The test author writes the **outer acceptance test** that encodes that behavior and
   commits it **red**. This is the *locked contract*.
3. The implementer drives **inner** unit red→green→refactor cycles until the outer test
   passes. The implementer **may not edit the outer test or the specs** — a hook
   enforces it.
4. The reviewer checks the result in two stages (below).
5. The founder merges.

No implementation commit ever precedes its slice's red outer test.

## Spec discipline

Specs are **frozen during implementation**. A spec is never patched in place mid-build.
If implementation reveals the spec is wrong, the implementer stops and raises a
**`spec-drift` issue**; the founder adjudicates. Only then does the spec author fix it
in a separate, deliberate spec-authoring pass (with the spec-freeze hook toggled off
for that pass). Drift routes to an issue, never to an in-place edit.

## The two hard gates (DEC-3)

1. **Agents never merge.** A hook blocks `git merge`, pushes to `main`, direct commits
   on `main`, and the GitHub plugin's merge tool. Branch protection is the server-side
   backstop.
2. **No commit on a red suite.** A hook runs the profile's test command before any
   `git commit` and blocks it if the suite is red.

Because these are hooks, they bind the agents *and* the founder's own agent sessions.
We live under our own gates.

## Model tiering

- **Haiku** — mechanical and triage work (backlog grooming, scoping).
- **Sonnet** — integration, test authorship, and implementation.
- **Opus** — spec authoring, review, and design.

Escalate a single slice to Opus only when its complexity genuinely warrants it; default
to the role's pinned tier.

## Writing conventions

Plain and direct. No filler, no ceremony. Prefer short sentences. Cap of **two em
dashes per 500 words**. Say what is true and what to do; skip the throat-clearing.
