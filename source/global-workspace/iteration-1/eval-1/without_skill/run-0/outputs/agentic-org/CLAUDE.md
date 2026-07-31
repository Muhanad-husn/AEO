# AI Enterprise Handbook

## What this is

A one-operator AI software enterprise. The founder specifies and decides; tool-locked
role subagents build and check; two deterministic hooks hold the line. Agents do the
work of a team, but authority over architecture and merges stays with one human. This
file is the constitution every session and subagent inherits — read it first.

## Hierarchy

Work flows top-down through four levels:

`product → subproject (a lifecycle stage) → sprint → issue → behavioral slice`

A **slice** is the smallest unit of behavior an implementer greens in one red→green→
refactor pass. Issues decompose into slices; sprints group issues; subprojects are
lifecycle stages of the product.

## Roles and authority

Five roles are addressable subagents in `.claude/agents/`. Each has a locked tool set
and a pinned model. The founder is the main session, not a subagent.

| Role | Does | Never |
|------|------|-------|
| Triage / PM | Reads issues, PRs, and code; scopes, decomposes, prioritizes | Writes code or files |
| Spec author | Writes behavioral specs under `specs/` | Writes code or tests; patches a frozen spec |
| Test author | Writes the outer acceptance test (the locked contract) and tests under `tests/`; commits the outer test red | Writes code or specs |
| Implementer | Drives inner unit cycles; writes production code under `src/` | Edits `tests/` or `specs/`; edits the outer test |
| Reviewer | Two-stage read-only review (spec-compliance, then code-quality) | Edits anything |

**Only the founder merges.** Agents build, test, and review; they never merge to
`main` and never touch branch protection. Merging is the founder's decision alone.

## The behavior-first loop

The outer acceptance test is the **locked behavioral contract** (DEC-1). The spec/test
author writes it from the spec and commits it **red before any implementation exists**.
It encodes the intended behavior, and asks: does this test actually prove the behavior,
or is it a tautology? Once committed, it is locked.

The implementer then drives inner unit red→green→refactor cycles only: write the
minimum code to pass each inner test, refactor on green, repeat until the outer test
passes. The implementer never edits the outer test or the specs.

No implementation commit may precede its slice's red outer test.

## Spec discipline

Specs are **frozen during implementation**. A spec is never patched in place mid-build.
If implementation reveals the spec is wrong, the implementer stops and raises a
`spec-drift` issue rather than editing the spec. The founder adjudicates. If the spec
must change, the spec-author fixes it in a separate, deliberate spec-authoring pass
(with the spec-freeze hook toggled off for that pass). Drift routes to an issue, never
an in-place patch.

## The two hard gates

Enforced by hooks (exit code 2), not by honor system, with branch protection as the
server-side backstop:

1. **Agents never merge.** `git merge`, pushes to `main`, and the GitHub plugin's
   merge tool (`mcp__plugin_github_github__merge_pull_request`) are all blocked from
   any agent. Only the founder merges.
2. **No commit on a red suite.** A `git commit` runs the profile's test command first;
   a red suite blocks the commit.

Everyone, including the setup agent, lives under these gates.

## Model tiering

Match the model to the work:

- **Haiku** — mechanical and triage work.
- **Sonnet** — integration, test authoring, and implementation.
- **Opus** — spec authoring, review, and design.

Escalate a single slice to Opus only when its complexity genuinely warrants it, not by
default.

## Writing conventions

Anything generated is plain and direct: no filler, no ceremony, short sentences over
long ones. Cap of two em dashes per 500 words. Explain the why so a smart agent can
generalize, rather than piling up rules.
