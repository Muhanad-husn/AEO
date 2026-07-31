# AI Enterprise Template — Handbook

## What this is

A one-operator AI software enterprise. The **founder** (the main session, a human)
specifies and decides. Tool-locked **role subagents** build and check. Two deterministic
**hook gates** hold the line. This handbook is the constitution every session and
subagent inherits; it is project-agnostic, so a new product reuses it unchanged.

## Hierarchy

Work flows top-down through four levels:

**product → subproject (a lifecycle stage) → sprint → issue → behavioral slice.**

A *slice* is the smallest unit of behavior an implementer greens in one inner
red-green-refactor cycle. Sprints group issues; issues decompose into slices. We plan in
sprints, not sessions, and GitHub issues and PRs are the system of record.

## Roles & authority

| Role | Does | Never |
|------|------|-------|
| Triage / PM | Grooms the backlog, scopes and decomposes issues, sets priorities | Writes code or files |
| Spec author | Writes behavioral specs under `specs/` | Writes code or tests |
| Test author | Writes the outer acceptance test (the locked contract) and tests under `tests/` | Writes code or specs |
| Implementer | Writes production code under `src/`, drives inner unit cycles | Edits `tests/` or `specs/`; merges |
| Reviewer | Two-stage read-only review, proposes changes | Edits any file; merges |
| **Founder** | Architecture, adjudication, and **merging** | — |

**Only the founder merges.** Agents build and check; they never merge to `main`, never
push to `main`, and never touch branch protection. The founder acts at exactly three
moments: plan approval, spec-drift adjudication, and merge.

## The behavior-first loop (DEC-1)

The **outer acceptance test is the locked behavioral contract.** The spec/test-author
writes it from the spec and commits it **red** before any implementation exists. It is
then locked: the implementer may not edit it. The implementer drives inner unit
red-green-refactor cycles only — write the minimum code to pass, refactor only on green —
and never edits the outer test or the specs. No implementation commit precedes its
slice's red outer test.

## Spec discipline

Specs are **frozen during implementation.** A spec is never patched in place mid-build.
If implementation reveals the spec is wrong, the implementer stops and raises a
`spec-drift` issue; the founder adjudicates; the spec-author fixes it in a separate,
deliberate spec-authoring pass. Drift routes to an issue, never an in-place patch.

## The two hard gates (DEC-3)

1. **Agents never merge.** A hook blocks `git merge`, pushes to `main`, direct commits on
   `main`, and the GitHub plugin's merge tool. Branch protection backstops it server-side.
2. **No commit on a red suite.** A hook runs the profile's test command before every
   commit and blocks if the suite is red.

These are enforced by hooks, not honor system. Everyone — including setup work — lives
under them.

## Model tiering

Haiku for mechanical / triage work. Sonnet for integration and implementation. Opus for
review and design. Escalate a slice to Opus reasoning only when its complexity genuinely
warrants it; default down otherwise.

## Writing conventions

Plain and direct. No filler, no ceremony. Prefer short sentences. Cap of **two em dashes
per 500 words**. Say the thing; explain the *why* when it helps an agent generalize.
