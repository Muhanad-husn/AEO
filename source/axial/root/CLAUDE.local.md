# Axial Engineering Handbook (v2, 2026-07-20)

## What this is

A one-operator AI software enterprise. The founder (the human running the main
session) decides; the orchestrator (the main session) and a builder subagent do the
work; a small set of deterministic gates hold the line. v2 deliberately tore out the
v1 role ceremony (test-author/implementer/fixer split, spec-freeze, spec-drift
adjudication, red-commit flags) — history in the `axial-harness` snapshot repo.
The product is Axial (`specs/PRODUCT.md`); nothing here is specific to it.

Two rules answer most questions:

1. **Nothing merges without the founder's word.** Work lands as a PR; the founder
   says "approved"; the orchestrator merges and cleans up. Subagents are
   hook-blocked from merging entirely.
2. **Specs are living documentation, not law.** Whoever changes behavior updates
   the spec *in the same PR*, so the founder reviews code and contract together.
   Only a genuinely contested design question becomes an issue for the founder to
   decide. Nobody stops the world over a wording mismatch.

## Lanes

- **`/sprint-start`** — one issue to one PR. Orchestrator selects the next
  unblocked issue, briefs the founder, cuts the worktree, dispatches the
  **builder** (acceptance test first, then code to green, spec updated if
  behavior moved), prepares the PR with `safe-pr`, pauses for approval.
- **`/fix`** — the fast lane for bug-sized work. One builder dispatch in its own
  worktree; the builder writes its own regression test with the fix.
  Feature-scale work bounces to `/sprint-start`. Same PR + approval ending.

Roles: **builder** (writes `src/`, `tests/`, `specs/`; never `.claude/`; never
merges), **reviewer** (read-only, on-demand — use for high-blast-radius changes or
when the founder asks), **triage** (scoping/PM, read-only). Tests are contracts
owned by the product, not locked artifacts: editing one takes a one-line
justification in the PR body.

## Worktrees

**Every issue starts in its own worktree.** `.claude/worktrees/<branch-slug>`,
cut from freshly pulled `main`: one issue = one worktree = one branch = one PR.
This holds even when a single issue is in flight — no judgement call about
whether the work is "big enough", and a second session's checkout can never
clobber a running builder's edits. `/fix` works the same way.

Two caveats:

- **Worktrees are for code, not operations.** `data/` is gitignored, so it does
  not exist in a worktree; a corpus pass, regen or eval launched there silently
  operates on nothing. Those run in the main checkout `D:/axial`.
- **The worktree dies with the branch.** After the merge, `/safe-cleanup` retires
  the branch and the orchestrator runs `git worktree remove` + `git worktree
  prune`. An orphaned worktree is a full second checkout on disk.

## Build philosophy

Practicality over perfectionism: build the smallest thing that meets the
acceptance bar, ship it, and let real use tell you what deserves more. Keep the
bar strict, not the mechanism. Don't reinvent the wheel: check for a library, or
one model call, before building. Measure, don't speculate: prototype beats
analysis.

Over-engineering tripwires — hitting one means stop and simplify, or keep it and
justify it in one line in the PR body:

- a tunable constant or magic number in a heuristic (two is a smell; a table of
  them means the mechanism is wrong — #268 spent 3 review rounds hand-tuning 6
  constants that read 4/30 real cases; one model call replaced them)
- an abstraction with one implementation, a config option nobody sets, generality
  no current caller needs
- a fix larger than its bug; test scaffolding larger than the behavior it pins
- hand-rolling what a library or a single LLM call already does

Surplus quality nobody asked for is not free: it costs review now and maintenance
forever. Polishing past the acceptance bar is a process bug, not diligence.

## Gates

1. **Commit gate** (hook): runs `uv run pytest src -q -m "not slow" -n auto` (~6s)
   plus ruff; blocks red commits and any code commit directly on `main`.
   *Docs-only exception:* a commit that is entirely `.md`/`.txt`/`.rst` or under
   `plans/`/`docs/` (and touches nothing in `.claude/`) may land on `main`
   directly, no branch or PR.
2. **Merge gate**: subagents are hook-blocked from `git merge`, `gh pr merge`,
   and pushes to `main`; server-side branch protection requires PRs. The
   orchestrator merges only on founder approval.
3. **CI** runs the full `tests/` tree on every push as the required PR check.
   Nobody runs the full tree locally (~8 min; CI's job).
4. **Real-corpus validation** (norm, not hook): a corpus-facing heuristic is
   validated against `data/sources/` before promotion. A green suite is not that
   evidence — #222 and #268 proved it.

If a gate fires, fix the cause, never the hook.

## Test scope

An acceptance suite belongs to its phase: each subproject owns a directory under
`tests/` (Phase B work lands in `tests/analysis/`).

**The Phase A suite starts at chunking and ends with the Phase A pipeline** —
`tests/chunk` plus `tests/ingestion`, which is where the v1 interrogate,
reconcile, materialize and gather acceptance tests land, including the
end-to-end chain test. Extraction and the envelope sit above it and are not
re-tested by it.

**That full suite is a CI-time suite. Nobody runs it locally.** While building,
a task runs **only its own tests** — the test files that task writes or changes
— on top of the commit gate's src tier, which is automatic and takes ~6s. The
phase suite greens in CI, the required PR check, and the phase suite command is
declared once as a `Sprint suite:` comment on the sprint's first issue.
Cross-phase blast radius (shared modules like `llm.py`, `cli.py`, config
loading) gets called out in the PR body; wait for CI green before asking for
approval.

## The harness itself

`.claude/` and this file are gitignored; harness edits are live on write, with no
PR ceremony — founder approval is still the gate. Role subagents may not edit
`.claude/` (path-guard fence). After any harness change run
`uv run python .claude/tools/snapshot-harness.py` — it mirrors the harness to the
private `axial-harness` repo, the only rollback there is.

## Run logging

Every run that matters (corpus-wide passes, regens, rollouts, evals) writes
`data/logs/<YYYY-MM-DD>-<run-name>/` with `run.jsonl` (one record per unit of
work), `console.log` (raw output), and `summary.md` (command, counts, outliers,
next steps). Decisions still go in the GitHub issue — GitHub issues and PRs are
the system of record.

## Conventions

- **Model tiering:** Haiku for mechanical work, Sonnet for building, Opus for
  design and the hardest slices; note escalations in the issue.
- **Statuses:** every dispatched task reports exactly one of `DONE`,
  `DONE_WITH_CONCERNS`, `BLOCKED`, `NEEDS_CONTEXT`; concerns go to the issue
  thread.
- **Writing:** plain, direct prose; no filler. Short sentences. At most two em
  dashes per 500 words. Comments only where the code cannot say it.
