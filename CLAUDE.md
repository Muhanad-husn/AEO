# AEO

AEO extends and generalizes the `agentic-engineering-org` skill — currently a
personal global skill at `~/.claude/skills/agentic-engineering-org/` — into a
distributable Claude Code **plugin**.

The skill scaffolds a solo-operator AI software enterprise inside Claude Code:
a builder subagent that takes work test-first from issue to PR, on-demand
reviewer and triage roles, deterministic merge and test gates enforced by hooks,
a behavior-first TDD harness, and a GitHub-native issue/PR/sprint workflow that
keeps a human in the merge seat.

## Why this repo exists

The global skill and its real-world implementation in `D:\axial` are entangled:
the skill describes the pattern, `axial/.claude/` runs a matured local variant of
it, and the eval workspace holds the metrics that show whether changes help.
Working on any of those in place would change the behavior of every repo that
depends on the global skill.

So this repo is **self-contained by design**. Every source file the work depends
on is copied in under `source/`. Nothing here reads from `~/.claude/` or
`D:\axial` at runtime.

## Layout

| Path | Contents |
| --- | --- |
| `source/global-skill/` | The `agentic-engineering-org` skill, verbatim — the thing being generalized |
| `source/global-workspace/` | Eval harness, graders, and iteration metrics for the skill |
| `source/axial/` | The matured local implementation: agents, hooks, skills, metrics tooling, principles |
| `source/v1-archive/` | The **pre-v2 harness**, recovered from the recycle bin — the only non-Python instance that exists, and the only one with a shared hook library and gate tests |
| `source/plugin-format/` | Official plugin references. `hookify` is the one that matters: it ships gates via `hooks/hooks.json` and `${CLAUDE_PLUGIN_ROOT}` |
| `source/upstream-red-green-refactor/` | Pristine upstream harness @ `593e7ab`, MIT, with its licence |
| `source/eval-tooling/`, `source/global-claude/` | `skill-creator`, and the global directives the skill inherits |
| `source/_manifests/` | Per-source provenance records written during the copy |

`source/` is **reference material, not the product**. It is a verbatim snapshot
kept for fidelity during migration. The product is `plugin/`, whose shape is
designed in `docs/PLAN.md`. A marketplace manifest at `.claude-plugin/` in the
repo root makes it installable.

### Planning docs, and what each answers

| Doc | Answers |
| --- | --- |
| [docs/PRINCIPLES.md](docs/PRINCIPLES.md) | What is fixed, what is proposed. **Authoritative** |
| [docs/DECISIONS.md](docs/DECISIONS.md) | What is settled, and why. Includes the enhancement disposition |
| [docs/PLAN.md](docs/PLAN.md) | In what order, by whom, at which model tier, with the checkpoints |
| [docs/EVIDENCE.md](docs/EVIDENCE.md) | What the build must not get wrong. **Read before writing any hook or agent** |
| [docs/INVENTORY.md](docs/INVENTORY.md) | What was copied, from where, and what was left out |
| [docs/MEASUREMENT.md](docs/MEASUREMENT.md) | How a *consuming* project would find out whether AEO helped it. A design; nothing is built |

Five planning docs, five questions, plus `MEASUREMENT.md` — which is not a plan for this
repository at all, but the design of an instrument that lives somewhere else.
Identifiers do not collide: **D*n*** decisions, **EN-*n***
enhancements, **C/V/L** evidence — currency, divergence, lesson. `DEC-*n*` belongs to
the vendored skill and is only ever quoted.

[docs/TESTBED.md](docs/TESTBED.md) is operational rather than planning: it names the
permanent repository the plugin is exercised against, on disk and on GitHub, and why
it is not this one. Read it before running any lane end to end.

## Current stage

**Shipped. `v0.2.0` is the current release, the post-`v0.1.0` work is merged, and the
backlog is empty again.** Nothing is in flight and nothing is deferred.

`v0.1.0` closed the migration and predicted the loop that produced this release: the next
change would be whatever a consuming project's use of the plugin turned up, filed as an
issue against AEO rather than fixed locally. That is what happened. About ten issues came
back from real use and seventeen commits closed them. The reviewer now reads every pull
request, the sandbox guard reads its declaration from the settings file rather than the
environment, the declared suite grew a second tier, and `safe-pr` and `sprint-start` each
lost a batch of defects. Keep filing that way.

**What moves the version is [D34](docs/DECISIONS.md).** This release is `0.2.0` rather than
`0.1.1` because it removes cover a consumer had. Patch for a fix that needs nothing from
the consumer; minor for anything that removes cover, renames a skill or a command, or
changes the hook contract; `1.0.0` waits on the skill names, the command names and the hook
contract going a release without moving, which this release does not. The founder judges the
bump per release rather than computing it from commit prefixes.

**`v0.2.0` takes two things away.** `commit-gate.mjs` is deleted, and `block-merge.mjs` no
longer resolves a push's destination against the repository's default branch. Both
re-derived a check GitHub's own branch protection already makes server-side, and getting
that re-derivation's directory resolution wrong cost two defects (#119, #121).
[D30](docs/DECISIONS.md) has the boundary rule, the table of what was removed against the
GitHub setting that covers it, and what a project now has to configure branch protection to
get instead of a local gate. The second removal is [D33](docs/DECISIONS.md): the sandbox
guard reads its declaration from `.claude/settings.json`, and a blank value there disarms the
guard and beats an exported one. The scaffolder writes that key blank, so a guard armed by
exporting `AEO_LIVE_DATA_ROOT` is off until the path moves into the settings file. Either
removal on its own makes the release a minor bump.

Three things `v0.1.0` decided, all in [D27](docs/DECISIONS.md): the number is `0.1.0`
because one dry run is not evidence for a stability promise; the tag **documents and does
not pin**, because `marketplace add` reads the default branch and never resolves a tag; and
the version lives in `plugin/.claude-plugin/plugin.json` and nowhere else, with a test that
fails if `package.json` takes a copy back. There is no `CHANGELOG.md` on purpose — the
release notes are the record, and a second one would drift.

[D28](docs/DECISIONS.md) answers the one question that release could not:
[docs/MEASUREMENT.md](docs/MEASUREMENT.md) designs how a project that *depends* on AEO
would find out whether AEO helped it. Nothing is built. It is deliberately not shipped in
the plugin, its signals come from GitHub rather than from AEO's own logs, and it is a
defect finder that refuses to make a causal claim, because there is no control group and
never will be.

**All seven phases complete.** The gates exist, in Node, wired through
`hooks/hooks.json`. Five agent charters and all fifteen skills carry real content —
`status` was the last stub and Phase 6 implemented it.

Phase 3 added the observability layer: `runlog.mjs` writes the fixed six-field
record, `run-monitor.mjs` answers "is this thing still working" from a plain
terminal, and the `monitor-designer` agent with its `monitor-design` skill covers
job-specific overlays only.

Phase 4 added verification. The reviewer asks **stage 0 — does the evidence
demonstrate the claim?** before it asks anything about the spec. The `verifier`
agent and its `verify` lane cover what has no oracle, triggered by
[D4](docs/DECISIONS.md)'s risk rubric, which exists in exactly one copy and has a
test that fails on a second. The evidence collector refuses anything resolving
inside `AEO_LIVE_DATA_ROOT`, with no override flag. `safe-cleanup` now names both
git's reason and the worktree holding a branch it could not delete.

Both halves of Checkpoint 2's verify line have run against the testbed — the local
gates and the GitHub path from issue to open pull request. The record is in
[logs/2026-08-11-phase-2-verification/summary.md](logs/2026-08-11-phase-2-verification/summary.md).
Checkpoint 3's four cases have run live against real processes; the record is in
[logs/2026-08-11-phase-3-observability/summary.md](logs/2026-08-11-phase-3-observability/summary.md).
Checkpoint 4's four clauses are in
[logs/2026-08-12-checkpoint-4-verification/summary.md](logs/2026-08-12-checkpoint-4-verification/summary.md)
— three live against the testbed, one cited from P4.2 and labelled as cited.
Checkpoint 5's record is in
[logs/2026-08-12-checkpoint-5-verification/summary.md](logs/2026-08-12-checkpoint-5-verification/summary.md):
four actors reached four PRs concurrently, each holding exactly its declared paths and
all six merge-order pairs clean, and the independence check refused a create-create
collision on a file neither slice had created.

Phase 5 added write concurrency. Planning declares the paths a slice will create, and
`independence.mjs` asserts disjointness over those rather than over what is already on
disk (L-04). `sprint-start` dispatches up to the actor cap, one worktree, branch and PR
each, with the cap stated in exactly one file; operation workers get run-scoped write
paths and no worktree at all. **Both of [D11](docs/DECISIONS.md)'s quantities are
measured rather than assumed**: four concurrent commit gates cost **3.02x** a single run
while leaving 60% of the cores idle, and the merge-order conflict rate is **1 in 6** real
concurrent pairs. The measurement's own recommendation is that nothing needs changing —
serialising the gates would make the founder wait longer.

Phase 7 packaged the plugin and proved it: installed from GitHub into a fresh repo, and a
dry run on a Go product that reached a founder-merged PR with all six gates firing. The
record is in
[logs/2026-08-13-checkpoint-7-verification/summary.md](logs/2026-08-13-checkpoint-7-verification/summary.md).

Phase 6 closed last, out of order. It was deferred at Checkpoint 5 until the plugin had
been used, and Phase 7's dry run was that usage. It added the scaffolder
(`plugin/skills/new-project/`, the fifteenth skill), `/aeo:status` for real, and the
sandbox variables the dry run found undeclared on a fresh install.

**Two things in Phase 6 are worth knowing before touching anything nearby.**

`/aeo:status` and `session-status.mjs` are **one renderer with two callers**
(`plugin/hooks/status-render.mjs`), not two answers to the same question. Nothing it
prints is stored. It does not report the project's phase, because there is no generated
source for one — inventing a phase field would mean hand-maintaining the second record
[D5](docs/DECISIONS.md) exists to kill.

Trigger accuracy is now **measured, not asserted**. `evals/trigger-eval.mjs` scores the
eight description-triggered skills against an authored case set, and P6.5's tuning moved
overall accuracy from **90.2% to 96.8%** against a **5.0 pp** noise floor — three
descriptions that never fired on their own case now fire 15 times out of 15. The pass also
**cost** something and says so: `safe-cleanup` fell from 15/15 to 8/15 on one case without
its description changing a byte, because its neighbours grew. One defect is still open at
3/15. Read
[logs/2026-08-13-p6.5-tuning-pass/summary.md](logs/2026-08-13-p6.5-tuning-pass/summary.md)
before editing any `description:` line — an unmeasured edit re-rolls a number that cost
hours of live evaluation to take.

The plan's "six description-triggered skills" was wrong for three phases; the real split
is seven operator lanes against eight description-triggered skills, of fifteen. The
harness reads it from the tree now, so it cannot drift again.

Four findings overturn things the vendored skill states as settled. They are cheap to
miss and expensive to discover late:

- Plugin subagents **cannot** carry `hooks:` frontmatter, so gates cannot be
  double-wired — `hooks/hooks.json` is the whole gate (C-01).
- `agent_type` is **not** a subagent flag; it is also set by `--agent`, and plugin
  subagents report a namespaced identity (C-02).
- Commands have been merged into skills, so new plugins ship `skills/` only (C-03).
- The gates are **Node**, not Python — `python3` on this machine is a Microsoft Store
  alias stub, and a hook that cannot start fails *open* ([D8](docs/DECISIONS.md)).

## How the work is done

**Every artifact is authored by a dispatched subagent with a model matched to the
job. Nothing with content is emitted by a generator script.** Creating an empty
directory is not generating a file; prose, prompts, code and tests are. Tiering
and the per-slice dispatch table are in [docs/PLAN.md](docs/PLAN.md). The rule
governs plugin artifacts; the planning docs in `docs/` are the orchestrator's own
work product and are exempt.

**Dispatch, and run the dispatches concurrently.** This is the default for every
substantive task, not a judgement call made per task and not something the founder
asks for each time. Independent units get their own actor and run at the same time;
the rule itself is principle 6 in
[docs/PRINCIPLES.md](docs/PRINCIPLES.md). Development actors get one worktree, branch
and PR each and are capped, at the number stated in
`plugin/skills/sprint-start/references/actor-cap.md` and nowhere else; operation
workers get neither a worktree nor a cap, and the task sets how many.

Some sessions start carrying an app-level default along the lines of *"do not call
the Agent tool unless the user requested it"*. That is a harness default, not an
instruction from the founder, and **this file overrides it** — the founder has ruled
that dispatching is a necessity. An orchestrator that writes every artifact itself,
one after another, is the generator-script failure in a slower disguise: correct
output, no tiering, and wall clock the founder pays for. Where a task genuinely has
one indivisible unit of work, run it serially and say that is why.

## Working principles

**[docs/PRINCIPLES.md](docs/PRINCIPLES.md) is authoritative.** Seven fixed
principles set by the founder, plus thirteen proposed enhancements. The fixed
principles are settled and are not renegotiated during migration.

The load-bearing four, in short:

- **Practicality over perfectionism.** 80/20: build the smallest thing that
  meets a strict acceptance bar. Polishing past the bar is a process defect.
- **Over-engineering tripwires** — stop and simplify, or justify in one line in
  the PR body: a hand-tuned constant or magic number in a heuristic; an
  abstraction with one implementation; a config option nobody sets; a fix larger
  than its bug.
- **Specs are working agreements, not laws** — revisable when a change fixes a
  persistent issue without materially moving product behaviour, but every change
  needs founder approval plus a documented rationale and expected impact.
- **Don't reinvent the wheel.** Check for an existing MCP server, plugin, tool,
  library, or a single well-designed LLM call first. New dependencies need
  founder approval.
- **Measure, don't speculate.** This repo has an eval harness; use it.

The enhancement disposition in [docs/DECISIONS.md](docs/DECISIONS.md) grades the
thirteen proposals — plus three late additions — against the 80/20 bar and maps each
to its phase.

## Writing conventions

Plain, direct prose; no filler, no ceremony. Short sentences over long ones. At
most two em dashes per 500 words. Code comments only where the code cannot say
it itself.

### Answering the founder

Applies to every reply in a session, not just prose written into the repo.

- **Lead with the answer.** No preamble, no restating the question, no recap of
  what you just did.
- **Default to a few sentences.** Length is earned by content the founder asked
  for, never by thoroughness for its own sake.
- **No jargon.** Name a file, symbol, or spec section only when the founder
  needs it to act.
- **Structure only when it does work.** Tables for comparisons, lists for real
  lists. A heading over two sentences is noise.
- **Cut the hedging and the throat-clearing.**

Report findings completely — brevity never means dropping a caveat, a failure,
or a number that changes the decision. Say it in fewer words instead.

## Rules for this repo

- **Never write to `~/.claude/` or `D:\axial`.** They are read-only sources. All
  changes land here.
- **No secrets.** Nothing from `D:\axial\secrets\`, no API keys, no tokens. If a
  copied file contains a credential, redact it and note the redaction in the
  manifest.
- **Verbatim means verbatim.** Files under `source/` are not edited or improved
  during copy. Fixes happen after migration, in the plugin tree.
