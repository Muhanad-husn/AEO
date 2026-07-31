# Build plan

Turn the `agentic-engineering-org` skill into an installable, stack-agnostic
Claude Code plugin distributed from GitHub and a marketplace.

This file is the **execution sequence** — the order, the verifications, the
checkpoints. It is deliberately separate from the other planning docs:

| Doc | Answers |
|---|---|
| [`PRINCIPLES.md`](PRINCIPLES.md) | What is fixed and what is proposed. Authoritative |
| [`ENHANCEMENT-ASSESSMENT.md`](ENHANCEMENT-ASSESSMENT.md) | Which proposals are worth building, and why. Sets priority |
| **`PLAN.md`** (this file) | In what order, and where the checkpoints are |
| [`BUILD-METHOD.md`](BUILD-METHOD.md) | Who authors each slice, at which model tier |
| [`DIVERGENCES.md`](DIVERGENCES.md) | Where the vendored skill and production disagree |
| [`DOCS-CURRENCY.md`](DOCS-CURRENCY.md) | Where current Claude Code contradicts the vendored skill |
| [`LESSONS.md`](LESSONS.md) | What production learned the hard way |

Where this file and `ENHANCEMENT-ASSESSMENT.md` differ on ordering, the assessment
sets *priority* and this file sets *dependency* — Phase 1 comes first here because
everything else needs correct, tested gates, not because it scores highest.

## What we are building

**One plugin** that ships the harness directly — agents, commands, skills, hooks,
scripts — plus **one slim scaffolder skill** that does only the two things a
plugin cannot do for a specific project: decide the stack and write the project's
handbook.

The plugin *is* the harness. Phases 2–5 of the current skill stop being
instructions for generating files and become the files themselves. That is the
single largest simplification available and it comes from the format, not from
design work.

## Working method

We dogfood the thing we are building. Work on a branch per phase, one phase at a
time, stop at each checkpoint for approval, report one status
(`DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`). Every founder-facing
question arrives with options, a recommendation, and what it costs.

Two standing constraints, checked at every checkpoint:

- **Does this phase remove more than it adds?** Several phases should shrink the
  artifact. If one only grows it, that is a signal to re-scope.
- **Did anything hit a tripwire?** A hand-tuned constant, a one-implementation
  abstraction, a config nobody sets, a fix larger than its bug. Simplify, or
  justify in one line.

---

## Phase 0 — Plugin skeleton and locked decisions

Cheap, and it makes every later phase's target concrete.

- `.claude-plugin/plugin.json`; the directory shape (`agents/`, `commands/`,
  `skills/`, `hooks/`, `scripts/`).
- The commands/skills split made real as stubs: six commands
  (`/sprint-plan`, `/sprint-start`, `/fix`, `/review`, `/triage`, `/status`),
  five skills (`safe-pr`, `safe-cleanup`, `red-green-refactor`, `tdd-plan`,
  `tdd-ci`).
- Vendoring provenance reinstated: upstream LICENSE, `VENDORED.md` with the
  `593e7ab` SHA (**A4** — MIT compliance, currently missing).
- Retire `spec-author`; roster goes to three (**A3**).

**Verify:** the plugin installs locally and its commands and skills are listed.
**⛔ CHECKPOINT 0.**

## Phase 1 — The gates, in Python, with tests · *the foundation*

Everything else rests on this. It should end up **smaller** than what it replaces.

- One shared library; four gates ported from PowerShell to Python
  (`block-merge`, `commit-gate`, `path-guard`, `format`), wired through
  `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` (**A1**, `hookify` precedent).
- **Gate unit tests** — reinstated from v1's `hooks/tests/`, which v2 lost.
- Fold in the production fixes the skill never absorbed: the tighter `git merge`
  matcher and the worktree resolution for pushes (**D-2**), and the same
  resolution in `format` (**D-3**).
- Delete the dormant `allow-red-commit` escape hatch (**D-1**).
- **Stack detection** replaces the stack profile: resolve the test command from
  the nearest project manifest, walking up from the changed files (**A2/E1**).
  Polyglot repos work with no configuration.
- **The data-sandbox guard (E13):** the commit gate refuses to run when the
  resolved data path is production. A session-scoped test fixture fails closed on
  the same condition.

**Verify:** the unit battery passes; live block-and-pass cases for every gate; a
Python repo and a Node repo each detect and run their own test command; the
sandbox guard blocks a run pointed at production data.
**⛔ CHECKPOINT 1** — no unverified gate proceeds.

## Phase 2 — Roles and lanes

The plugin becomes usable at the end of this phase.

- Three agents (builder, reviewer, triage), tool-locked, model-pinned **by alias**
  (**E9**).
- Six commands and five skills, ported and de-axialised — no `llm.py`/`cli.py`,
  no `uv run`, no corpus vocabulary.
- **The reviewer receives the issue, spec, diff and evidence — never the builder's
  report** (**E3**), and sits a tier above the builder so they do not share
  failure modes.
- **Every founder-facing question carries options, a recommendation, and its cost**
  (**E10**).
- Narrow-by-default test scoping; widening gets justified in the PR body (**E4**).
- Slice plans state their mechanism and name an existing solution if one exists —
  installed skill or plugin, then first-party MCP, then a library, then one model
  call (**E2**).
- `pr-review-toolkit` specialists available as optional reviewer lenses, not a
  second wholesale review (**E8**).

**Verify:** a throwaway issue goes idea → `/sprint-start` → prepared PR on a
scratch repo, with no manual git.
**⛔ CHECKPOINT 2.**

## Phase 3 — Observability

- `logs/<YYYY-MM-DD>-<job>/` with `run.jsonl`, `console.log`, `summary.md`;
  the fixed record envelope (`ts`, `job`, `unit`, `status`, `duration`, `detail`)
  (**E11**).
- One **generic monitor script** the founder runs in their own terminal — progress,
  rate, elapsed and projected, failures, and stall detection using the ported
  three-signal heuristic: stalled only when checkpoints, logs, and CPU are all
  flat (**E12**).
- The **monitor-designer agent** and its command, for job-specific overlays only.

**Verify:** a long job is monitored live from a plain terminal; a deliberately
wedged job is reported stalled; a slow-but-working job is not.
**⛔ CHECKPOINT 3.**

## Phase 4 — Verification

- Reviewer gains **stage 0: does the evidence demonstrate the claim?** — asked
  before spec compliance.
- **CI verifies anything with an oracle; the fresh agent verifies what has none**
  (UI, prose, usability). No probabilistic check becomes a hard required gate;
  agent findings post to the PR and the founder weighs them.
- The evidence collector refuses anything resolving from the production data path
  (**E13** leak vector), alongside its existing secret scan.

**Verify:** a PR whose evidence does not support its claim is caught at stage 0;
an attempt to embed production data in evidence is blocked.
**⛔ CHECKPOINT 4.**

## Phase 5 — Concurrency

Deliberately after Phase 1: four actors against untested worktree resolution is
how a gate gets silently bypassed.

- **Development actors: cap 4.** One worktree, branch and PR each; gates apply per
  actor.
- **Operation workers: no fixed cap.** The task sets count and model tier. No
  worktree, no branch, no PR; gates apply once at the commit. Run-scoped write
  paths so concurrent workers cannot collide (**E13** point 4).
- Planning marks which issues are parallel-safe — no shared files, no dependency.
- Measure, do not pre-solve: core oversubscription at four concurrent gates, and
  merge-order conflict rate.

**Verify:** four issues run to four PRs concurrently with every gate firing
correctly; the independence check catches a deliberately conflicting pair.
**⛔ CHECKPOINT 5.**

## Phase 6 — Scaffolder and tracker

- The skill shrinks to **Phase 0 (detect stack, tree, git/`gh`, branch protection)
  and Phase 1 (write the project handbook)**, plus the one project config file for
  what detection cannot infer (**A5**).
- The scaffold creates `logs/` **before any product code** (**E11**).
- `/status` renders the North Star from issues, PRs and the Decision Log —
  generated, never authored — and session start reads it first (**E7**).
- `skill-creator` pass on the five skills' descriptions and the scaffolder's, for
  trigger accuracy. Commands are excluded; they do not trigger on description.

**Verify:** scaffolding a fresh repo on a non-Python stack produces a working org;
`/status` reflects reality with no hand-maintained file.
**⛔ CHECKPOINT 6.**

## Phase 7 — Package and prove

- Marketplace entry, README, install instructions, evals refreshed against the new
  shape.
- **A full dry run in a fresh session on a throwaway product**, on a stack that is
  not Python — the generalization is not proven until that passes.
- Migration plan for `C:\Users\mou97\.claude\skills\` and `D:\axial\.claude\`,
  presented for approval. Nothing upstream is touched before this point.

**Verify:** clean install from GitHub into an empty repo; the dry run reaches a
merged PR with every gate exercised.
**⛔ CHECKPOINT 7.**

---

## Sequencing rationale

| Phase | Why here |
|---|---|
| 0 | Cheap; fixes the target for everything else |
| 1 | Foundation — concurrency, polyglot support and packaging all depend on correct, tested gates |
| 2 | The plugin becomes usable; nothing later depends on it |
| 3 | Evidence substrate; feeds Phase 4 |
| 4 | Needs Phase 3's structured logs |
| 5 | Needs Phase 1's tested worktree handling |
| 6 | Needs the plugin content settled to know what is left to scaffold |
| 7 | Proves the whole thing |

## Risks

- **Phase 1 is the whole bet.** If the Python port is not genuinely smaller and
  better tested than the PowerShell it replaces, stop and reconsider — the case
  for it was that three problems collapse into one fix.
- **Phase 5 multiplies Phase 1's failure modes.** Worktree resolution is already
  the most-repaired code in the harness. Do not start it on a red or untested gate
  suite.
- **Scope creep in Phase 2.** Porting ten skills and six commands is the phase most
  likely to grow features nobody asked for. The de-axialisation is the job; new
  behaviour is not.
- **The dry run in Phase 7 is the only real proof.** Everything before it is
  argument.
