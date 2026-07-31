# Build method

How the work gets dispatched.

> **Provenance note.** This was written against a parallel line of work that is not
> on `main`; it is preserved on the **`salvage/import-line`** branch (commit
> `3bd9da9`). References to `PLAN.md`, `ENHANCEMENT-BACKLOG.md`,
> `IMPORT-MANIFEST.md` and `reference/…` resolve on that branch, not here. A
> GitHub issue backlog (#1–#15) existed and **has been deleted**; the slice
> identifiers below (`P0.1`, `P1.1`, …) are kept as stable names so the plan
> survives the fork. The dispatch discipline itself is layout-independent and
> stands on its own.

## The rule

**Every artifact is authored by a dispatched subagent, with a model matched to the
job. Nothing with content is emitted by a generator.**

A script that templates fifteen files produces fifteen files that read like a
template. The uniformity looks like consistency and is actually absence of
thought — and in this project the artifacts *are* the product. An agent charter, a
skill description, a gate and its tests are all prose or code where the judgment is
the value. Generating them destroys the thing being built.

What this does **not** mean: creating an empty directory is not generating a file.
`mkdir -p agents skills hooks scripts` is fine. The line is content — prose,
prompts, code, tests. If a human would read it and form an opinion about it, a
subagent writes it.

## The bootstrap problem, stated plainly

This repo has no harness. We are building the gates that will later govern us, so
Phases 0 and 1 cannot be governed by them. That is a real gap, not a technicality,
and it is worth naming rather than pretending otherwise.

Until Phase 1 lands, the substitutes are:

- **Subagents run without merge capability** — via session-wide `permissions.deny`
  rules, which do apply inside subagents. There is no dispatch-time tool override;
  tool resolution comes only from the agent definition, and `model` is the sole
  per-invocation parameter ([`DOCS-CURRENCY.md`](DOCS-CURRENCY.md) finding 8).
- **The orchestrator merges, on founder approval only.** Same rule as the finished
  harness; enforced by discipline instead of exit code 2.
- **`main` stays clean.** One branch per slice, no exceptions, because the
  no-commits-on-`main` gate does not exist yet to catch a slip.
- **No test run touches anything outside this repo.** There is no production data
  here — but the habit is the point, and `P1.5` exists precisely because habit was
  not enough last time.

**We start dogfooding the moment Phase 1 closes.** From Phase 2 onward the gates we
built govern the rest of the build. That transition is the first real proof they
work.

## Model assignment

Match the tier to the dominant work in the slice, not to its size.

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

Each row is one slice, one dispatch, one branch, one PR. The subagent authors; the
orchestrator selects, briefs, cuts the branch, dispatches, and merges on approval.

### Phase 0

| Slice | Model | Authors | Must not |
|---|---|---|---|
| **P0.1** plugin skeleton | **Sonnet** | `plugin.json`, the directory tree, and the eleven skill stubs — each with a real, distinct `description`, written individually. `logs/` with its `<YYYY-MM-DD>-<job>` convention | Template the stubs. A description is what makes a skill trigger; eleven copies of one sentence is eleven skills that compete |
| **P0.2** vendoring + licence | **Haiku** | Upstream LICENSE in place, `VENDORED.md` recording source, SHA and what was adapted | Paraphrase the licence |
| **P0.3** retire spec-author | **Haiku** | Roster reduced to three; every dangling reference swept | Touch vendored sources — they are frozen |

**Skills only, no `commands/`.** Custom commands have been merged into skills and
the plugin reference says to use `skills/` for new plugins. The six operator lanes
get `disable-model-invocation: true`, which is the determinism they wanted; plugin
skills are namespaced (`/aeo:sprint-start`), which removes the trigger-competition
risk. See [`DOCS-CURRENCY.md`](DOCS-CURRENCY.md) finding 3.

**Review at phase close:** one Opus pass over the whole of Phase 0. The phase is
small and its parts are independent, so per-slice review would be ceremony.

### Phase 1

| Slice | Model | Authors | Must not |
|---|---|---|---|
| **P1.1** hook runtime | **Opus** | The shared library — stdin parsing, `agent_type` semantics, worktree resolution, trailing-separator path checks, one block path — and its tests | Ship a single untested function. This library is why the other three gates stop drifting |
| **P1.2** block-merge | **Sonnet** | The port, carrying both fixes the skill never absorbed, plus tests | Copy the skill's version. Port from the *live* one on the salvage branch |
| **P1.3** commit-gate + detection | **Opus** | The port, deletion of the red-commit hatch, and **manifest walk-up stack detection**, plus tests | Introduce a config file. Detection or nothing — this is the piece the whole generalisation rests on |
| **P1.4** path-guard + format | **Sonnet** | Both ports with the `format` resolution fix, plus tests | Drop the root-*named*-`.claude` check; it looks redundant and is not |
| **P1.5** data-sandbox guard | **Opus** | Injected data path, fail-closed test fixture, gate refusal, plus tests | Warn instead of refuse. Advice is what cost 19,000 documents |

**Two constraints on P1.1 that the vendored skill gets wrong**
([`DOCS-CURRENCY.md`](DOCS-CURRENCY.md) findings 1 and 2):

- **There is no second wiring.** Plugin subagents cannot carry `hooks:` frontmatter
  — the field is silently ignored. `hooks/hooks.json` is the entire gate, so the
  library and its tests carry more weight, not less.
- **`agent_type` is not a subagent flag.** It is also set when a main session runs
  with `--agent`, and plugin subagents report a plugin-scoped name (`aeo:builder`).
  Matching on presence alone blocks the orchestrator's own approved merge path;
  matching on the bare name never fires. Anchor the pattern.

**Review per slice:** Opus, every one. Phase 1 is entirely gates — every slice is
high-blast-radius by definition, which is exactly the standing trigger for review.

Each reviewer dispatch receives the issue, the spec, the diff and the evidence.
**It does not receive the builder's report.**

## Concurrency schedule

Four development actors is the cap; these phases do not need all four.

```
Phase 0    P0.1 ──────────► P0.3
           P0.2 ──────────►              (2 parallel)

Phase 1    P1.1 ─┬─► P1.2 ─────►
                 ├─► P1.3 ─┬─► P1.4 ─►
                           └─► P1.5 ─►   (3 parallel at peak)
```

`P1.1` gates everything in Phase 1 — no parallelism before it lands. `P1.4` and
`P1.5` need `P1.3`'s stack detection. Each parallel actor gets its own worktree,
branch and PR; none share files.

## Division of labour

**The orchestrator** selects the slice, briefs the founder, cuts the branch,
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
| Central run logging, in the scaffold before any code | Phase 0 establishes `logs/<YYYY-MM-DD>-<job>/` in this repo, so AEO runs under its own convention rather than only shipping it. Phase 3 builds the record format (`ts`, `job`, `unit`, `status`, `duration`, `detail`) and the monitor |
| Live monitoring | Phase 3. One generic monitor from the fixed envelope, run from a plain terminal; the three-signal stall heuristic ported verbatim — stalled only when checkpoints, logs and CPU are all flat; a designer agent only for job-specific overlays |
| Production data unreachable from tests | `P1.5` — the only Phase 1 slice that is new work rather than a port. Injected data path, fail-closed fixture, gate refusal |
| Private and copyrighted corpora | Fixtures synthetic or redacted and committed, real corpus never in repo or CI, result tables in the PR instead of data, evidence collector refuses production-data paths, self-hosted runner where CI genuinely needs the corpus |
