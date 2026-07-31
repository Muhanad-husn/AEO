# Build method

How the work gets dispatched.

> **Provenance note.** This was written against a parallel line of work that is not
> on `main` — it is preserved on the `salvage/import-line` branch (commit
> `3bd9da9`). References below to `PLAN.md`, `ENHANCEMENT-BACKLOG.md`,
> `IMPORT-MANIFEST.md` and `reference/…` resolve on that branch, not here. The
> dispatch discipline itself is layout-independent and stands on its own; the file
> paths need repointing once the fork is resolved. GitHub issues #1–#15 are live
> and carry the same stale paths.

## The rule

**Every artifact is authored by a dispatched subagent, with a model matched to the
job. Nothing with content is emitted by a generator.**

A script that templates fifteen files produces fifteen files that read like a
template. The uniformity looks like consistency and is actually absence of
thought — and in this project the artifacts *are* the product. An agent charter, a
command, a skill description, a gate and its tests are all prose or code where the
judgment is the value. Generating them destroys the thing being built.

What this does **not** mean: creating an empty directory is not generating a file.
`mkdir -p agents commands skills hooks scripts` is fine. The line is content —
prose, prompts, code, tests. If a human would read it and form an opinion about
it, a subagent writes it.

## The bootstrap problem, stated plainly

This repo has no harness. We are building the gates that will later govern us, so
Phases 0 and 1 cannot be governed by them. That is a real gap, not a technicality,
and it is worth naming rather than pretending otherwise.

Until Phase 1 lands, the substitutes are:

- **Subagents are dispatched without merge capability** — via session-wide
  `permissions.deny` rules, which do apply inside subagents. *(Corrected: there is
  no dispatch-time tool override. Tool resolution comes only from the agent
  definition; `model` is the sole per-invocation parameter. See
  [`DOCS-CURRENCY.md`](DOCS-CURRENCY.md) finding 8.)*
- **The orchestrator merges, on founder approval only.** Same rule as the finished
  harness; enforced by discipline instead of exit code 2.
- **`main` stays clean.** One branch per issue, no exceptions, because the
  no-commits-on-`main` gate does not exist yet to catch a slip.
- **No test run touches anything outside this repo.** There is no production data
  here — but the habit is the point, and issue #8 exists precisely because habit
  was not enough last time.

**We start dogfooding the moment Phase 1 closes.** From Phase 2 onward the gates
we built govern the rest of the build. That transition is the first real proof
they work.

## Model assignment

Match the tier to the dominant work in the issue, not to the issue's size.

| Tier | For | Why |
|---|---|---|
| **Haiku** | mechanical work with an unambiguous target — file moves, provenance records, sweeping stale references | No judgment required; paying more buys nothing |
| **Sonnet** | ports and builds against a reference implementation and a written spec | The shape is known; the work is careful execution |
| **Opus** | design under uncertainty, safety-critical logic, and all review | Where a wrong decision compounds across every later phase |

Three things are always Opus regardless of size:

1. **Anything fail-closed.** A guard that fails open is worse than no guard,
   because it advertises safety it does not provide.
2. **Anything every future session inherits.** Agent charters, the handbook, skill
   descriptions. A weak charter is re-read thousands of times.
3. **Review.** The reviewer must sit a tier above the builder or they share failure
   modes, and two instances of one model is a rerun, not an independent check.

## Dispatch plan — Phases 0 and 1

Each row is one issue, one dispatch, one branch, one PR. The subagent authors; the
orchestrator selects, briefs, cuts the branch, dispatches, and merges on approval.

### Phase 0

| Issue | Model | Authors | Must not |
|---|---|---|---|
| [#1](https://github.com/Muhanad-husn/AEO/issues/1) skeleton + split | **Sonnet** | `plugin.json`, the directory tree, and all eleven command/skill stubs — each with a real, distinct `description`, written individually | Template the stubs. A description is what makes a skill trigger; eleven copies of one sentence is eleven skills that compete |
| [#2](https://github.com/Muhanad-husn/AEO/issues/2) vendoring + licence | **Haiku** | Upstream LICENSE in place, `VENDORED.md` recording source, SHA and what was adapted | Paraphrase the licence |
| [#3](https://github.com/Muhanad-husn/AEO/issues/3) retire spec-author | **Haiku** | Roster reduced to three across `skill/`; every dangling reference swept | Touch `reference/` — it is frozen |

**Review at phase close:** one Opus pass over the whole of Phase 0. The phase is
small and its parts are independent, so per-issue review would be ceremony.

### Phase 1

| Issue | Model | Authors | Must not |
|---|---|---|---|
| [#4](https://github.com/Muhanad-husn/AEO/issues/4) hook runtime | **Opus** | The shared library — stdin parsing, `agent_type` semantics, worktree resolution, trailing-separator path checks, one block path — and its tests | Ship a single untested function. This library is why the other three gates stop drifting |
| [#5](https://github.com/Muhanad-husn/AEO/issues/5) block-merge | **Sonnet** | The port, carrying both fixes the skill never absorbed, plus tests | Copy the skill's version. Port from the *live* one in `reference/axial/` |
| [#6](https://github.com/Muhanad-husn/AEO/issues/6) commit-gate + detection | **Opus** | The port, the deletion of the red-commit hatch, and **manifest walk-up stack detection**, plus tests | Introduce a config file. Detection or nothing — this is the piece the whole generalisation rests on |
| [#7](https://github.com/Muhanad-husn/AEO/issues/7) path-guard + format | **Sonnet** | Both ports with the `format` resolution fix, plus tests | Drop the root-*named*-`.claude` check; it looks redundant and is not |
| [#8](https://github.com/Muhanad-husn/AEO/issues/8) data-sandbox guard | **Opus** | Injected data path, fail-closed test fixture, gate refusal, plus tests | Warn instead of refuse. Advice is what cost 19,000 documents |

**Review per issue:** Opus, every one. Phase 1 is entirely gates — every issue is
high-blast-radius by definition, which is exactly the standing trigger for review.

Each reviewer dispatch receives the issue, the spec, the diff and the evidence.
**It does not receive the builder's report.**

## Concurrency schedule

Four development actors is the cap; these phases do not need all four.

```
Phase 0    #1 ────────────► #3
           #2 ────────────►            (2 parallel)

Phase 1    #4 ─┬─► #5 ─────►
                ├─► #6 ─┬─► #7 ─►
                        └─► #8 ─►      (3 parallel at peak)
```

`#4` gates everything in Phase 1 — no parallelism before it lands. `#7` and `#8`
need `#6`'s stack detection. Each parallel actor gets its own worktree, branch and
PR; none share files.

## Division of labour

**The orchestrator** selects the issue, briefs the founder, cuts the branch,
dispatches, relays the result, and merges on approval. It does not author
deliverables — if it is writing the artifact, the dispatch was pointless.

The one standing exception is the escalation valve: when a subagent loop burns
tokens without converging, the orchestrator verifies the claim independently and
applies the diagnosed fix directly. Each such escalation gets recorded, so it stays
precedent rather than drift.

**The founder** acts at three moments only: plan approval, design-question
adjudication, and merge approval. Every question arrives with options, a
recommendation and its cost.

## Where the late additions landed

| Add | Captured as |
|---|---|
| Central run logging, in the scaffold before any code | **E11** — issue [#10](https://github.com/Muhanad-husn/AEO/issues/10) builds the format and monitor; issue [#13](https://github.com/Muhanad-husn/AEO/issues/13) puts `logs/` in the scaffold. **AEO creates its own `logs/` in Phase 0**, so we run under it rather than only shipping it |
| Live monitoring | **E12** — issue [#10](https://github.com/Muhanad-husn/AEO/issues/10). One generic monitor from the fixed record envelope, run from a plain terminal; the three-signal stall heuristic ported verbatim; a designer agent only for job-specific overlays |
| Production data unreachable from tests | **E13** — issue [#8](https://github.com/Muhanad-husn/AEO/issues/8), the only Phase 1 issue that is new work rather than a port |
| Private and copyrighted corpora | **E13** — fixtures synthetic or redacted and committed, real corpus never in repo or CI, result tables in the PR instead of data, evidence collector refuses production-data paths, self-hosted runner where CI genuinely needs the corpus |
