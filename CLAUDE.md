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
kept for fidelity during migration. The plugin layout (`.claude-plugin/`,
`skills/`, `agents/`, `hooks/`) does not exist yet and is designed in `docs/PLAN.md`.

### Planning docs, and what each answers

| Doc | Answers |
| --- | --- |
| [docs/PRINCIPLES.md](docs/PRINCIPLES.md) | What is fixed, what is proposed. **Authoritative** |
| [docs/DECISIONS.md](docs/DECISIONS.md) | What is settled, and why. Includes the enhancement disposition |
| [docs/PLAN.md](docs/PLAN.md) | In what order, by whom, at which model tier, with the checkpoints |
| [docs/EVIDENCE.md](docs/EVIDENCE.md) | What the build must not get wrong. **Read before writing any hook or agent** |
| [docs/INVENTORY.md](docs/INVENTORY.md) | What was copied, from where, and what was left out |

Five docs, five questions. Identifiers do not collide: **D*n*** decisions, **EN-*n***
enhancements, **C/V/L** evidence — currency, divergence, lesson. `DEC-*n*` belongs to
the vendored skill and is only ever quoted.

## Current stage

Copy-in and planning complete. **No plugin code written yet.** Next is Phase 0 of
[docs/PLAN.md](docs/PLAN.md) — the plugin skeleton.

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
