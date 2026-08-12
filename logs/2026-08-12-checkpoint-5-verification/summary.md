# Checkpoint 5 — Verification

2026-08-12. Branch `checkpoint-5-verification`, cut from `main` at `e4cfac0`.

**Status: both verify clauses pass, and one real defect was found in the process.**
The four-actor run is live against the testbed at `D:\aeo-testbed`; the independence
refusal is live; the measurement line is closed by #17 and cited rather than re-run.

## The verify line

> four issues run to four PRs concurrently with every gate firing correctly; the
> independence check catches a deliberately conflicting pair, including one that
> collides only on files neither had created yet.

| Clause | Result |
| --- | --- |
| Four issues → four PRs, concurrently | ✅ live, four PRs open, each holding exactly its declared paths |
| Gates apply per actor | ✅ live, reached per actor; **blocking proven by two direct probes**, because no actor's suite was ever red |
| Independence catches a conflicting pair | ✅ live, refused, exit 1 |
| …including a create-create on a file neither had created | ✅ live, `src/stats.mjs` was absent from disk |
| Measure rather than assume ([D11](../../docs/DECISIONS.md)) | ✅ closed by #17, PR #37 — cited, not re-run |

## Clause 1 — four actors, four PRs, concurrently

### Setup

Four fixture issues were created in the testbed, each a small pure function in its own
module with its own test file, and each declaring its two new paths in an
`aeo-independence` block. They are deliberately of the same shape as the testbed's
existing issue #1, so the actors had a house style to read rather than invent.

`plan-actors.mjs` was run over the group **before any worktree was cut**, which is the
order `sprint-start` step 3 requires:

```
dispatchable: 4 actors, cap 4, no held branch or worktree path and no collision between the slices.
parallel-safe: 4 slices, 8 declared paths, no collisions and no dependency between them.
```

Exit 0. The cap was read from `references/actor-cap.md`, not typed.

Four worktrees were then cut from testbed `main`, one per actor.

**One thing a fresh worktree does not inherit, and `sprint-start` step 4 is right to ask
about it.** The testbed's `.claude/settings.local.json` is untracked — `git ls-files
.claude/` returns nothing — so nothing tracked by git follows a `worktree add`, and a
headless `-p` actor in a fresh worktree would have stalled on its first `Bash` call. It
was copied into each worktree before dispatch. This is exactly the case step 4 names,
met in practice for the first time.

### The run

Four headless sessions, started together, plugin loaded and not installed:

```
cd D:/aeo-testbed/wt-<n> && claude --plugin-dir D:/AEO/plugin -p "<per-actor brief>"
```

### Result

| Actor | Issue | Branch | PR | Files in the PR |
| --- | --- | --- | --- | --- |
| 1 | #3 `mean()` | `feat/sprint/3` | [#10](https://github.com/Muhanad-husn/aeo-testbed/pull/10) | `src/mean.mjs`, `tests/mean.test.mjs` |
| 2 | #4 `median()` | `feat/sprint/4` | [#11](https://github.com/Muhanad-husn/aeo-testbed/pull/11) | `src/median.mjs`, `tests/median.test.mjs` |
| 3 | #5 `spread()` | `feat/sprint/5` | [#9](https://github.com/Muhanad-husn/aeo-testbed/pull/9) | `src/spread.mjs`, `tests/spread.test.mjs` |
| 4 | #6 `roundTo()` | `feat/sprint/6` | [#12](https://github.com/Muhanad-husn/aeo-testbed/pull/12) | `src/round-to.mjs`, `tests/round-to.test.mjs` |

Four issues, four worktrees, four branches, four PRs, all open against `main`, none
merged. **Every PR holds exactly the two paths its issue declared and nothing else**, so
the disjointness the check asserted in advance is the disjointness that actually
shipped. No actor touched `package.json`, which was the one shared file in reach.

All four worked test-first and each recorded the same shape of failure before writing any
implementation — `ERR_MODULE_NOT_FOUND` on a module that did not exist yet, 6 tests, 5
pass, 1 fail, the 5 being the pre-existing suite. Final counts per actor: 12, 13, 13 and
15 tests, all green.

### Merge order, checked rather than assumed

All six pairs, three-way merged read-only against the base they were all cut from:

```
3 x 4 clean    3 x 5 clean    3 x 6 clean
4 x 5 clean    4 x 6 clean    5 x 6 clean
```

**Clean in any merge order.** This is the live counterpart to #17's measurement, and it
lands where that measurement predicted: collisions cluster on shared prose and shared
manifests, and a group whose slices each own two new files of their own has nothing to
collide on.

### Gates, per actor

`sprint-start` step 7 requires per-actor reporting, and a gate an actor never reached is
reported as not exercised rather than as passing.

| Gate | Result |
| --- | --- |
| SessionStart `session-status` | **fired for all four**, emitted output |
| SessionStart runtime check | **fired for all four**, silent — node resolved |
| `commit-gate` | **reached on every actor's commit, allowed every time** — all four suites were green. Its blocking path is proven by probe, below |
| `path-guard` | **reached** on every Write; no actor wrote outside its declared paths |
| `block-merge` | **not exercised** — no actor attempted a merge or a force-push |
| `review-jail` | **reached** (unmatched hook, runs on every tool call); never blocked |
| `sandbox-guard` | **not exercised.** `AEO_LIVE_DATA_ROOT` is unset in the testbed, so it was inert for every session. `session-status` said so out loud, which is how the actors knew |
| Run-in-progress sentinel | **not exercised** — no actor raised one, so none waited |
| Testbed CI (node 20 / 22) + GitGuardian | **fired and passed** on the PRs |

`sandbox-guard` being inert is a gap in cover, not a clean result, and the SessionStart
line naming it is the reason that gap was visible rather than assumed away.

### The blocking path, proven by probe

No actor's suite was ever red, so no actor's commit gate ever had cause to refuse. A gate
that only ever allowed has not been shown to block. Two probes were run in a throwaway
repository, under the **identical** `--plugin-dir` loading mode, with a deliberately red
suite:

```
BLOCKED: no direct commits on main. Work on a branch and merge via PR after founder approval.

BLOCKED: the node test suite is red. Get to green before committing.
  ran: npm test
  exit: 1
  --- last 15 lines ---
  1 !== 2
```

The first fired on `main`; the second on a branch, with the failing assertion quoted back.
Both refused the commit outright — the command never ran.

## The defect this run found

**Two of the four actors reported that no gate fired at all.** One wrote *"Fired for me:
none. No hook intercepted or blocked any tool call in this session."* The other grepped
`.claude/settings.local.json` and the global settings for a `hooks` key, found none, and
concluded the commit gate was not wired — with a method that cannot see plugin hooks,
which come from `hooks/hooks.json`.

Both were wrong, and the probes above are why we know. The gate was reached on both their
commits and allowed them, because a `PreToolUse` hook that allows prints nothing.

This is **L-08** in the gate-reporting path: an absent gate and a satisfied gate produce
byte-identical evidence at the actor. The actor that got it right did so because it had
*positive* output to reason from — `session-status` printed the production-data-root line,
so it knew the SessionStart hooks were live and correctly reported the rest as *reached,
did not block*.

`session-status.mjs` exists to inject ground truth at session start, and it already
computes gate health — but prints it **only when health is bad**. The healthy case, which
is every ordinary session, says nothing, and silence is the reading that misleads.

Filed as **#39**, and fixed on `fix/39-gates-stated-positively` rather than carried.

## Clause 2 — the independence refusal

Two further fixture issues were created, #7 and #8, each declaring that it creates
`src/stats.mjs` and `tests/stats.test.mjs`. **Neither file exists in the testbed** —
`ls src/` returns `total.mjs` alone. That absence is the whole point: it is the state in
which the old "no shared files, no dependency" check returned a confident, false *safe*
(L-04).

They were put inside a group of four alongside two slices that are genuinely disjoint:

```
NOT dispatchable: 4 actors, cap 4.

NOT parallel-safe: 2 findings.

  create-create slices 7 and 8 both create src/stats.mjs
  create-create slices 7 and 8 both create tests/stats.test.mjs
```

Exit 1. Three things in that output are worth naming separately:

- It caught a **create-create** collision, on paths that exist only as declarations.
- It named **which two slices** and **which paths**, so the report is something a founder
  can decide with.
- It refused **the whole group**. Slices 3 and 4 in that run were perfectly safe and were
  not dispatched, which is `sprint-start` step 4's rule holding: never trim the group down
  to a subset that passes.

## Clause 3 — measure, do not pre-solve

[D11](../../docs/DECISIONS.md) requires two numbers rather than two assumptions. Both are
in #17 / PR #37, with their noise floors, their conditions and their positive controls,
and are cited here rather than re-run:

- **Core oversubscription: 3.02x** for four concurrent commit gates against one, median
  over five interleaved rounds — against a fully-serialised bound of 4.0, with the CPU
  never above 40% busy.
- **Merge-order conflict rate: 1 in 6** real concurrent pairs; 16 in 60 on a complete
  synthetic census, of which twelve are prose-only.

The recommendation from that slice is that nothing needs changing, and this run is
consistent with it: four actors, six pairs, zero conflicts.

## Two frictions, neither blocking

- **Two actors wrote PowerShell here-string syntax (`@'...'@`) into the Bash tool** for
  their commit messages, and got literal `@` lines in the subject. Both caught it and
  amended before pushing, so nothing left the machine and no force-push happened. It is
  the second time this shape of mistake has appeared in this project; the environment note
  is already in the harness, and the actors recovered without help.
- **One fixture issue contradicted itself, and the actor said so rather than obeying it.**
  Issue #6's boilerplate paragraph was carried over from issue #1 and demanded that a
  non-array input be rejected — but `roundTo` takes a number, as that issue's own previous
  paragraph states. Implementing it literally would have rejected every valid input. The
  actor applied the house rule to the numeric signature instead and **wrote the deviation
  into its PR body so a reviewer meets it rather than discovers it.** The defect was in the
  issue text, which was written by the orchestrator; the actor's handling of it is the
  behaviour the charter asks for.

## What is not covered by this run

- `block-merge` was never exercised here. Its `gh pr merge` arm is verified by direct hook
  invocation against a real repository, for the permission-classifier reason recorded in
  [TESTBED.md](../../docs/TESTBED.md), not by a live in-session dispatch.
- `sandbox-guard` was inert throughout, because the testbed declares no production data
  root. Its refusal path is covered by its own suite and by Checkpoint 4, not by this run.
- The run-in-progress sentinel's cross-worktree behaviour is not exercised here either. It
  is on record from P5.3 (PR #28), live, with controls on both sides.
- No actor's commit was ever refused, so the per-actor blocking claim rests on the probes
  rather than on the run itself. That is stated rather than smoothed over.
