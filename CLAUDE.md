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
| `source/_manifests/` | Per-source provenance records written during the copy |
| `docs/INVENTORY.md` | Assembled manifest: what was copied, from where, and what was deliberately left out |

`source/` is **reference material, not the product**. It is a verbatim snapshot
kept for fidelity during migration. The plugin layout (`.claude-plugin/`,
`skills/`, `agents/`, `hooks/`) does not exist yet and will be designed in the
migration plan.

## Current stage

Copy-in complete or in progress. **No enhancements yet** — the migration from
`source/` into plugin shape is to be planned before any is made.

## Working principles

Inherited from `D:\axial\CLAUDE.md`. They govern work in this repo, pending
review during generalization — some are Axial-specific and should be examined
before they are baked into a plugin meant for other people's projects.

- **Practicality over perfectionism.** 80/20: build the smallest thing that
  meets the acceptance bar, and keep the bar strict, not the mechanism.
  Polishing past the bar is a process bug, not diligence.
- **Over-engineering tripwires** — stop and simplify, or justify in one line in
  the PR body: a hand-tuned constant or magic number in a heuristic; an
  abstraction with one implementation; a config option nobody sets; a fix larger
  than its bug.
- **Don't reinvent the wheel.** Check existing tools and libraries — or a single
  LLM call — before building.
- **Measure, don't speculate.** Prototype and measure rather than analyze
  indefinitely. This repo has an eval harness; use it.

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
