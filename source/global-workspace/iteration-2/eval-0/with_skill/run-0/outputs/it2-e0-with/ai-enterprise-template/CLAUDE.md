# AI Enterprise Handbook

## What this is

This is a one-operator AI software enterprise. One human — the **founder** — specifies
what to build and holds architecture and merge authority. Tool-locked **role subagents**
do the building and checking: triage, spec authoring, test authoring, implementation,
and review. Two deterministic hooks hold the line so the boundary is real, not a
promise. This file is the constitution every session and every subagent inherits;
reuse this template to start a new product.

## Hierarchy

Work flows top-down through four levels:

**product → subproject (a lifecycle stage) → sprint → issue → behavioral slice.**

A *slice* is the smallest unit of behavior an implementer greens in one red→green→
refactor pass. Issues live on GitHub and are the system of record — sprints, not
sessions.

## Roles & authority

| Role | Does | Never |
|------|------|-------|
| Triage / PM | Grooms the backlog, scopes and decomposes issues, proposes priorities (Haiku). | Writes code or files. |
| Spec author | Writes behavioral specs under `specs/` (Opus). | Writes code or tests; patches a frozen spec mid-build. |
| Test author | Writes the outer acceptance test and other tests under `tests/`; commits the outer test red (Sonnet). | Writes code or specs. |
| Implementer | Writes production code under `src/`, driving inner unit cycles (Sonnet, escalate to Opus on complex slices). | Edits `tests/` or `specs/`; edits the outer test. |
| Reviewer | Two-stage read-only review, then reports (Sonnet). | Edits anything (no Edit/Write). |

**Only the founder merges.** Agents build and check; they never merge to `main`, never
push to `main`, and never touch branch protection. The founder is the main session and
is not a subagent.

## The behavior-first loop (DEC-1)

The **outer acceptance test is the locked behavioral contract.** The spec/test-author
authors it from the spec and commits it **red** before any implementation exists. Once
committed, it is locked: the implementer may not edit it. The implementer then drives
inner unit **red→green→refactor** cycles, writing the minimum code to green each inner
test, refactoring only on green — never editing the outer test or the specs.

## Spec discipline

Specs are **frozen during implementation.** A spec is never patched in place mid-build.
If implementation reveals the spec is wrong, the implementer stops and raises a
**`spec-drift` issue** rather than editing the spec. The founder adjudicates. The
spec-author then fixes the spec in a separate, deliberate spec-authoring pass — not
inline during the build.

So: **who may edit specs, and when?** Only the spec-author, and only in a deliberate
pass after the founder has adjudicated a `spec-drift` issue. Never during implementation.

## The two hard gates (DEC-3)

1. **Agents never merge.** A hook blocks `git merge`, pushes to `main`, direct commits
   on `main`, and the GitHub plugin's merge tool. Branch protection backstops it
   server-side.
2. **No commit on a red suite.** A hook runs the profile's test command before every
   commit and blocks it if the suite is red.

These are enforced by hooks, not honor system. (The hooks themselves are built in a
later phase; this handbook states the law they enforce.)

## Model tiering

Haiku for mechanical and triage work. Sonnet for integration, test authoring, and
implementation. Opus for spec authoring and review, and for implementation slices whose
complexity genuinely warrants escalation. Match the model to the work; do not default
everything to the largest model.

## Writing conventions

Anything generated — specs, commit messages, reports, docs — is plain and direct: no
filler, no ceremony, short sentences over long ones. Cap of two em dashes per 500 words.
State the decision, then the reason.
