# CLAUDE.md handbook (Phase 1)

Write a short, **project-agnostic** constitution every session and subagent inherits.
Keep it under ~100 lines, in brief prose (not a wall of MUSTs — explain the *why* so a
smart agent can generalize). Few enough rules that the founder can hold them all — a
rulebook nobody can hold gets resented and routed around (that is how v1 died). It
must let a fresh reader answer, from this file alone, **"who may merge?"** and
**"what happens when code and spec disagree?"**. A good structure is to answer those
two questions explicitly near the top — "two rules answer most questions" — then
elaborate.

Cover these, briefly:

- **The two rules.** 1) Nothing merges without the founder's word; subagents are
  hook-blocked from merging entirely; on "approved" the orchestrator (main session)
  runs the merge and cleanup itself — approval is the gate, not founder execution.
  2) Specs are living documentation, not law: whoever changes behavior updates the
  spec *in the same PR* so the founder reviews code and contract together; only a
  genuinely contested design intent becomes an issue; nobody stops the world over
  wording.
- **The lanes.** `/sprint-start` — one issue to one PR (builder: acceptance test
  first, code to green, spec updated if behavior moved; PR prepared; pause for
  approval). `/fix` — the fast lane for bug-sized work (one builder dispatch, its
  own regression test, feature-scale bounces to the sprint lane).
- **The roles**, in one short paragraph: builder (writes `src/`, `tests/`,
  `specs/`; never `.claude/`; never merges), reviewer (read-only, on-demand for
  high-blast-radius or founder-requested reviews), triage (scoping, read-only),
  spec-author (deliberate spec passes). Tests are contracts owned by the product,
  not locked artifacts: editing one takes a one-line justification in the PR body.
- **The build philosophy — a top-level section, never a closing bullet** (a
  principle without tripwires does not bind; see the skill's economics item 4).
  Practicality over perfectionism: build the smallest thing that meets the
  acceptance bar; keep the bar strict, not the mechanism; don't reinvent the
  wheel (check for a library, or one model call, before building); measure,
  don't speculate. Then the named **over-engineering tripwires** — hitting one
  means stop and simplify, or keep it and justify it in one line in the PR body:
  a tunable constant or magic number in a heuristic (two is a smell; a table of
  them means the mechanism is wrong); an abstraction with one implementation, a
  config option nobody sets, generality no current caller needs; a fix larger
  than its bug, or test scaffolding larger than the behavior it pins;
  hand-rolling what a library or a single LLM call already does. Close with:
  surplus quality nobody asked for costs review now and maintenance forever —
  polishing past the acceptance bar is a process bug, not diligence.
- **The gates**, as hooks with exit-code enforcement, not advice: the fast commit
  gate (hermetic unit tier + lint; blocks red commits and code commits on `main`;
  docs-only commits may land on `main` directly), the merge gate (hooks + branch
  protection; orchestrator merges on founder approval only), CI running the full
  suite as the required PR check (never run locally), and — if the product reads
  real-world data — the real-data validation norm: a green suite is not evidence a
  data-facing heuristic works. Close with: if a gate fires, fix the cause, never
  bypass the hook.
- **Test scope:** contracts grouped by subproject; the sprint suite declared once
  (`Sprint suite:` comment on the sprint's first issue) and used verbatim; shared-
  module blast radius called out in the PR body.
- **Model-tiering guidance:** Haiku for mechanical/triage work, Sonnet for
  building, Opus for design and the hardest slices; note escalations in the issue.
- **Statuses:** every dispatched task reports exactly one of `DONE`,
  `DONE_WITH_CONCERNS`, `BLOCKED`, `NEEDS_CONTEXT`; concerns and blockers go in the
  issue thread, not private notes.
- **Prose conventions** for anything generated: plain, direct, no filler; cap of
  **two em dashes per 500 words**; short sentences over ceremony; code comments only
  where the code cannot say it itself.
- **Developer principles** (founder amendment in the reference build — offer it):
  practicality over perfectionism (80/20; a working solution beats a theoretically
  optimal one); don't reinvent the wheel (check existing tools/libraries first,
  suggest useful additions); measure, don't speculate (prototype and measure rather
  than analyze indefinitely).

## Suggested shape (mirrors the proven live v2 handbook)

```markdown
# <Product> Engineering Handbook

## What this is
One paragraph: a one-operator AI software enterprise. The founder decides; the
orchestrator and a builder subagent do the work; a small set of deterministic
gates hold the line. Then: "Two rules answer most questions:" 1. nothing merges
without the founder's word (subagents hook-blocked entirely; orchestrator executes
on approval), 2. specs are living documentation — behavior change and spec update
land in the same PR; only contested design intent becomes an issue.

## Lanes
/sprint-start — one issue to one PR via the builder; pause for approval.
/fix — the fast lane; builder writes its own regression test; feature-scale
bounces to /sprint-start.
Roles: builder (src/tests/specs; never .claude/; never merges), reviewer
(read-only, on-demand), triage (read-only). Tests are contracts owned by the
product; editing one takes a one-line PR-body justification.

## Build philosophy
Smallest thing that meets the acceptance bar; bar strict, mechanism free.
Don't reinvent the wheel (library or one model call first); measure, don't
speculate. Tripwires (stop and simplify, or justify in one PR-body line):
hand-tuned constants in heuristics; abstraction with one implementation;
config nobody sets; fix larger than its bug; hand-rolling what a library or
one LLM call does. Polishing past the bar is a process bug, not diligence.

## Gates
1. Commit gate (hook): fast hermetic unit tier + lint; blocks red commits and
   code commits on main. Docs-only commits may land on main directly.
2. Merge gate: subagents hook-blocked; branch protection requires PRs; the
   orchestrator merges only on founder approval.
3. CI runs the full suite on every push as the required PR check; nobody runs
   the full tree locally.
4. Real-data validation (norm, not hook): a data-facing heuristic is validated
   against real inputs before promotion.
If a gate fires, fix the cause, never the hook.

## Test scope
Contracts by subproject; sprint suite declared once and used verbatim;
cross-subproject blast radius called out in the PR body.

## Conventions
Model tiering (Haiku mechanical · Sonnet building · Opus design/hardest) ·
statuses (DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT, concerns to the
issue thread) · prose (plain, ≤2 em dashes/500 words).
```

**Verify:** hand `CLAUDE.md` to a fresh reader (or a subagent with no other context)
and confirm they can answer the two questions above.
