# AI Enterprise Handbook

## What this is

A one-operator AI software enterprise that runs inside Claude Code. The **founder**
(the human, the main session) specifies and decides. Tool-locked **role subagents**
build and check. Two deterministic **hook gates** hold the line. This handbook is the
constitution: every session and every subagent inherits it. It is project-agnostic —
reuse this template to start any new product.

## Hierarchy

Work flows top-down through five levels:

**product → subproject (a lifecycle stage) → sprint → issue → behavioral slice.**

A *slice* is the smallest unit of behavior an implementer greens in one loop. Issues
live in GitHub; sprints group issues; a subproject is a lifecycle stage of the product.

## Roles & authority

The founder is the main session, not a subagent. The five roles are addressable
subagents in `.claude/agents/`, each with a locked tool set and a pinned model.

| Role | Does | Never |
|------|------|-------|
| Triage / PM | Grooms the backlog, scopes and decomposes issues, sets priorities | Writes any code or files |
| Spec author | Writes behavioral specs under `specs/` | Writes code or tests; patches a frozen spec mid-build |
| Test author | Writes the outer acceptance test (the locked contract) and tests under `tests/` | Writes code or specs |
| Implementer | Drives inner unit red→green→refactor on one slice; writes code under `src/` | Edits the outer test, anything in `tests/`, or specs |
| Reviewer | Two-stage read-only review (spec-compliance, then code-quality) | Edits anything — proposes, never changes |

**Who may merge: the founder only.** Agents build and check. They never merge, never
push to `main`, and never touch branch protection. That boundary is the whole point of
this enterprise, and it is enforced mechanically (see The gates).

## The behavior-first loop (DEC-1)

Each slice runs behavior-first:

1. The spec author writes the behavioral spec under `specs/`.
2. The test author writes the **outer acceptance test** that encodes that behavior and
   commits it **red**. This test is the **locked contract**. Once committed, it is not
   edited during implementation.
3. The implementer drives **inner** unit red→green→refactor cycles, writing the minimum
   code to pass each inner test, refactoring only on green. The implementer may **not**
   edit the outer test or the specs.
4. The reviewer checks the result in two stages, then the founder merges.

No implementation commit may precede its slice's red outer test.

## Spec discipline

Specs are **frozen during implementation**. A spec is never patched in place mid-build.
If implementation reveals the spec is wrong, stop and raise a **`spec-drift`** issue;
the founder adjudicates. The spec author then fixes it in a separate, deliberate
spec-authoring pass — never as a silent edit inside a build. This keeps the contract
honest: intent changes are visible and owned.

## The gates (DEC-3)

Two hard gates, enforced by hooks (exit code 2), not by honor system. Branch protection
backstops them server-side.

1. **Agents never merge.** Any `git merge`, any push to `main`, and the GitHub plugin's
   merge tool are all blocked from agents. Only the founder merges.
2. **No commit on a red suite.** A `git commit` runs the profile's test command first;
   if the suite is red, the commit is blocked. Get to green first.

A companion **spec-freeze** hook blocks edits under `specs/` during implementation; the
spec author works in an explicit spec-authoring mode where it is relaxed.

## Model tiering

Match the model to the work; do not ask which model — pick by task.

- **Haiku** — mechanical and triage work (backlog grooming, scoping).
- **Sonnet** — integration, test authoring, and implementation.
- **Opus** — review and design. Escalate an *implementation* slice to Opus only when its
  complexity genuinely warrants it.

## Writing conventions

Anything generated for humans (specs, issues, PRs, docs) is plain and direct: no filler,
no ceremony, short sentences over long ones. Cap of **two em dashes per 500 words**.
State the decision, then the reason. Skip preamble.

## The operator's three moments

If the machine is working, the founder acts at exactly three points: **plan approval**,
**drift adjudication**, and **merge**. Everything else the roles do and the gates check.
