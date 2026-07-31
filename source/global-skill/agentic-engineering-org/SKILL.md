---
name: agentic-engineering-org
description: >-
  Scaffold a solo-operator AI software enterprise inside Claude Code: a builder
  subagent that takes work test-first from issue to PR, on-demand reviewer and
  triage roles, deterministic merge and test gates enforced by hooks, a vendored
  behavior-first TDD harness, and a GitHub-native issue/PR/sprint workflow that
  keeps a human in the merge seat. Use this whenever the user wants to set up an
  agentic engineering workflow, an AI "team" or "roles" in Claude Code,
  PR/review/merge gates, a TDD or behavior-first agent loop, subagent-based
  development, a red-green-refactor harness wired to roles, or a reusable project
  template where agents build but never merge — even if they don't call it a
  "skill" or name the template. Trigger on requests like "set up an AI dev team in
  Claude Code", "make agents that can't merge to main", "wire up build/review
  roles", or "build me a reusable agentic repo template".
---

# Agentic Engineering Org (v2)

Build a reusable **template repository** that encodes a one-person AI software
enterprise: a **builder** subagent takes each issue or fix test-first from
description to a prepared PR, on-demand **reviewer** and **triage** roles check and
scope, and a single human ("the founder") holds architecture and approval
authority. Deterministic hook gates make the boundary real — **subagents never
merge**, and **no one commits a red suite**. Privileged actions (merge, branch
cleanup, branch protection) are not reserved to the founder's own hands: they
**require founder approval, nothing more** — on an explicit "approved", the
orchestrator (main session) runs them itself. A vendored behavior-first TDD harness
and a GitHub-native sprint workflow tie it together.

You are building the *template* (working name `ai-enterprise-template`), not a
specific product. The founder reuses it to start future products.

## Why v2 (the ceremony lesson — production, 2026-07)

v1 of this org split building across five pipeline roles (spec-author →
test-author → implementer → reviewer, plus a fixer lane), froze `specs/` behind a
hook during implementation, and landed each acceptance test red under a
founder-approved flag before any code. All of it was designed to constrain
unreliable agents. In production the *ceremony* cost more than it caught: one-line
fixes needed multi-agent relays, every spec-wording mismatch stopped the world for
adjudication, red-commit choreography added flag dances, and every stop landed on
the founder's wall-clock. Meanwhile every real save came from the deterministic
*gates* — the fast commit gate, the merge block, CI, and validating heuristics
against real data. The founder's verdict: the docs are not divine; we own the
product and the rules, and process whose only output is compliance goes.

**v2's principle: keep every gate that is deterministic, cheap, and catches real
damage; delete every step whose only output is compliance.** Ownership lives in the
merge gate; correctness lives in the suite, CI, and reality checks — none of the
deleted ceremony.

## Operating rules (read before doing anything)

1. **Work phase by phase, in order.** Finish a phase, run its verification, then
   stop at its checkpoint. Do not skip, reorder, or batch phases.
2. **This is a supervised build.** At every **⛔ CHECKPOINT**, stop and wait for an
   explicit "approved" from the founder. Do not infer approval.
3. **These actions require founder approval — approval is the only requirement, not
   founder execution:** merging to `main`, pushing to `main`, enabling or changing
   branch protection, and deleting branches or data (including `/safe-cleanup`).
   When work on a branch is complete, all you need is the founder's explicit
   "approved" for the merge and the cleanup — then the *orchestrator* (main session)
   runs them itself. Never a build subagent, and never without approval; ask in
   plain terms and wait for "approved" (do not infer it), but never make the founder
   copy-paste commands into their own terminal. Build work is still dispatched to
   the role subagents; these privileged one-shot ops are the orchestrator's to run.
   The deterministic *subagents-never-merge* gate is unchanged and makes merging
   impossible for every subagent and for the plugin merge tool, so "the orchestrator
   merges on approval" and "subagents never merge" hold at the same time. Nothing
   may block the orchestrator's own approved merge or cleanup path.
4. **Do all work on a branch** named `setup/<phase-slug>` (e.g. `setup/00-foundation`).
   The founder reviews and approves; on approval the orchestrator merges (rule 3). You
   are dogfooding the workflow you build.
5. **Report after each phase** with exactly one status —
   `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT` — then say what you
   produced and what the founder should check.
6. **Verify mechanics against current docs before writing them.** Subagent
   frontmatter, hook schema, and slash-command behavior drift. The skeletons in the
   `references/` files are a starting point *already corrected against the docs as of
   this skill's authoring*, but re-check the URLs in "Reference material" and note any
   divergence in the Decision Log.
7. **If the founder's brief is ambiguous or contradictory, stop and raise it**
   (`NEEDS_CONTEXT`). Do not guess and do not silently "fix" it.
8. **Keep the test baseline green.** Once the tests-green hook exists (Phase 3), a red
   suite blocks your own commits. That is intended — you live under your own gates.

## Locked decisions (hard constraints — do not relitigate)

| # | Constraint |
|---|------------|
| DEC-1 (v2) | **Behavior-first by one builder.** Every behavioral change starts with a test the builder writes first and watches fail for the right reason; test and code land together in the same commits and PR (no red-commit ceremony exists). Tests and specs are contracts owned by the *product*, not locked artifacts: editing a pre-existing test or spec is legitimate with a one-line justification in the PR body. What is never legitimate is *undisclosed* contract movement, or an edit whose purpose is making failing code pass. Supersedes v1's test-author/implementer authorship split. |
| DEC-2 | Roles are **addressable subagent files** in `.claude/agents/`, each with a locked `tools` set and a pinned `model`. |
| DEC-3 | Two gates are **deterministic hooks**, not advice: *subagents-never-merge* and *tests-green-before-commit*. Branch protection backstops them server-side. "Subagents" means the **role subagents** and the **plugin merge tool** — both hard-blocked. The *orchestrator* (main session) merges and cleans up on explicit founder approval (rule 3); no hook may block its `git merge` / `gh pr merge` / branch-deletion path. The merge gate is **double-wired** (DEC-18): subagent-scoped frontmatter hooks *plus* global stdin-deciding hooks that enforce only when the tool call carries `agent_type` (i.e. a subagent is running) — so the global layer never blocks the orchestrator. The plugin merge tool is blocked globally for everyone. |
| DEC-4 | **GitHub issues and PRs** are the system of record. Sprints, not sessions. |
| DEC-5 (v2) | **Specs are living documentation, not law.** There is no spec-freeze hook and no spec-mode flag. Whoever changes behavior updates the spec *in the same PR*, so the founder reviews code and contract side by side. Deliberate spec passes (a new phase spec, a charter) go to the spec-author role. Only a genuinely contested design *intent* becomes an issue for the founder to decide (`design-question` label) — nobody stops the world over wording. Supersedes v1's spec-freeze + drift-adjudication ceremony. |
| DEC-6 | The behavior-first loop is the **vendored `brainqub3/red-green-refactor` harness** (MIT), adapted to the roles and gates — not hand-built. |
| DEC-7 | DEC-4 runs through the **installed GitHub plugin** (issue/PR tools), not raw `gh` in Bash. Consequence: the *agents-never-merge* gate must also match the plugin's merge-capable tool, not only `Bash(git merge …)`. |
| DEC-19 (v2) | **The harness fence.** Role subagents never write under `.claude/` — the config that governs the roles is not theirs to edit. This is the *only* path rule left (v1's per-role `tests/`/`specs/` boxes died with the role split); it is hook-enforced and double-wired like the merge gate. |

## Role roster (the contract for Phases 2–3)

The founder is the main session and is **not** a subagent. Four roles:

| Role | `tools` (capability) | `model` | Scope |
|------|----------------------|---------|-------|
| Builder      | Read, Grep, Glob, Edit, Write, Bash | sonnet (escalate to opus on hard slices) | Writes `src/`, `tests/`, and `specs/` together; never `.claude/` (hook, DEC-19); never merges |
| Reviewer     | Read, Grep, Glob, Bash              | sonnet | Read-only (withheld Edit/Write). **On-demand**, not a pipeline stage: founder-requested or high-blast-radius changes |
| Triage / PM  | Read, Grep, Glob, Bash              | haiku  | Scoping and backlog grooming; writes no code |
| Spec author  | Read, Grep, Glob, Edit, Write       | opus   | Deliberate spec passes only (new phase spec, charter); `specs/` scope is charter-stated — the hook layer enforces only the `.claude/` fence |

> **Why hooks, not `tools`, for the path rule.** The `tools` field grants or
> withholds whole tool *types*; it cannot scope a tool to a path. The one path rule
> (DEC-19's `.claude/` fence) is enforced by a **stdin-deciding path-guard script**,
> wired twice (DEC-18): in each subagent's frontmatter (role passed as an arg) *and*
> globally in `settings.json` (role read from stdin `agent_type`, so the main
> session passes through). The reviewer's read-only comes purely from withholding
> Edit and Write.

## Corrections already applied (verified against current docs)

The source brief predates some schema changes. The `references/` skeletons already
reflect these; keep them in mind if you regenerate anything:

- **`/agents` is no longer an interactive wizard.** Write/edit `.claude/agents/*.md`
  files directly (or ask the main session to). Claude Code hot-reloads them within a
  few seconds — no restart — *except* the first file created in a brand-new `agents/`
  directory, which needs one restart.
- **Hooks read tool input from stdin as JSON, not from env vars.** There is no
  `$CLAUDE_TOOL_INPUT_FILE_PATH`. Extract with
  `jq -r '.tool_input.file_path // empty'` or `jq -r '.tool_input.command // empty'`.
- **Do not enforce gates with `if:` permission-rule filters (DEC-16).** The field
  exists, but `if: "Bash(git merge *)"` is dodged by compound commands
  (`git add . && git merge`) and `Edit(specs/**)` globs are fragile against absolute
  Windows paths. Fire hooks on the whole tool matcher and let each **script decide
  from stdin JSON** (which carries `tool_name`, `tool_input`, `cwd`, and — in
  subagent calls only — `agent_type`).
- **Frontmatter hooks alone are not reliable enough for a security gate.** They have
  a documented reliability history (GH issue #18392) and live dispatches have run on
  stale agent snapshots with dead guards. **Double-wire both critical gates**
  (DEC-18): frontmatter layer with explicit args, plus a global `settings.json`
  layer whose scripts detect `agent_type` on stdin so the orchestrator passes.
- **Hook command form matters.** On Windows, write scripts in PowerShell and invoke
  as `powershell -NoProfile -ExecutionPolicy Bypass -File "<path>" [args]`; the
  `& '<path>'` form with a `shell:` field **silently fails to register** — the hook
  never spawns and nothing warns you (verified live on 2.1.201).
- **Resolve the repo root from the tool payload, not `CLAUDE_PROJECT_DIR`.**
  The env var stays bound to the launching checkout, so git-worktree sessions misfire
  (feature-branch commits blocked as "on main", path rules mis-scoped). For commits,
  normalize via `git -C <cwd> rev-parse --show-toplevel`; for file writes, resolve
  from the **target file's own ancestors** (a subagent's reported `cwd` can point at
  the launch checkout while the file lives in a sibling worktree). Guard path-prefix
  checks with a trailing separator so a sibling worktree (`proj-xref` vs `proj`)
  isn't "inside" the project.
- **The installed GitHub plugin's tool namespace is `mcp__plugin_github_github__…`**
  (e.g. `mcp__plugin_github_github__merge_pull_request`). Confirm the exact names in
  Phase 0 with `/plugin`; the merge gate must match whatever they actually are — and
  must also cover the plugin's **direct-write tools** (`create_or_update_file`,
  `push_files`, `delete_file`), which can target `main` without any git command.
- **A `.claude/` fence must not key on the relative path alone.** If `.claude/` is
  ever made its own repo, `rev-parse --show-toplevel` resolves *to* the harness dir
  and a bare `^\.claude/` test silently stops matching. Detect the case where the
  resolved root itself is named `.claude` (narrow — a root *named* `.claude`, not
  any path containing one, so a plugin checkout under `~/.claude/plugins/<name>`
  still resolves normally).

## Iteration-loop economics (production lessons, 2026-07)

The gates and roles above answer *who may do what*. They do not, by themselves,
answer *how fast each actor learns whether it's right* — and that is where early
production runs burned their tokens (one frontend slice: ~90 min and ~275k tokens
of an agent iterating blind). Bake these rules into any instantiation; they are
operational law, not suggestions:

1. **The fast signal must exist before implementation iterates.** The builder
   sequences fast mechanical oracles (unit tests, typecheck, build) *before or
   alongside* implementation, and never iterates against the slowest loop in the
   system (e2e with real wall-clock waits, browser startup, environmental
   teardown). The outer/acceptance test runs once, time-bounded, at milestones —
   never inside the inner loop. (v1's strict-xfail "red marker" mechanism is gone
   with the red-commit ceremony; if any expected-fail marker ever exists, nobody
   iterates against it — a marked test is diagnostically blind in both directions.)
2. **A red test's unreached tail is unverified at authoring time.** A
   red-by-construction test executes only to its first failing line; every
   assertion past it is dead code until green-time. Defects hide there (observed:
   an API call that unconditionally throws; a fixture whose clauses were mutually
   unsatisfiable by *any* correct implementation). Scrutinize the unreached tail
   at authoring — check API usage against already-merged sibling tests, hand-verify
   fixture timing/math. In v2 the builder owns both layers, so a test defect found
   at green-time is fixed directly — with the fix disclosed in the PR body and the
   non-loosening judgment falling to the reviewer/founder on the diff.
3. **A green suite is not evidence a data-facing heuristic works.** Any change to
   how the product reads real-world inputs (parsers, extractors, classifiers,
   thresholds over messy data) gets validated against the real corpus/dataset
   before promotion, with the result table in the PR. Production proof: two
   fully-green-suite changes were no-ops or false-positives on real data. Related:
   where the task is genuinely a language task, prefer a model call over
   hand-tuned deterministic heuristics — keep the *acceptance bar* strict, not the
   mechanism.
4. **Over-engineering is a cost center, not diligence — and stating "80/20" is
   not enough to prevent it.** The production failure mode: an agent hand-tuned 6
   magic constants through 3 review rounds, past a fully green suite, for a
   mechanism that read 4/30 real cases — with the 80/20 principle sitting right
   there in its context. A principle without concrete tripwires does not bind.
   So the principles are *promoted*: named tripwires in the handbook (a
   hand-tuned constant in a heuristic; an abstraction with one implementation; a
   config option nobody sets; a fix larger than its bug; hand-rolling what a
   library or one model call already does), a builder self-check before DONE
   (reread the diff against the tripwires; delete what the bar doesn't pay for),
   a reviewer lens (a simplicity finding ranks equal to a defect), and one
   disclosure mechanism shared with contract movement: complexity that survives
   a tripwire gets a one-line justification in the PR body. No new gate, no new
   checklist — judgment pressure inside existing artifacts.
5. **The orchestrator is the escalation valve for non-converging loops.**
   Subagent ceremony exists for building features, not for debugging harness
   pathologies. When a role loop burns tokens without converging, the
   orchestrator (full conversation context, no path guard, no `agent_type`)
   verifies the subagent's claims independently and applies diagnosed mechanical
   fixes directly — with the founder still holding merge approval. Record each
   such escalation in the Decision Log so it stays precedent, not drift.
6. **Measure environmental facts once, record them, route around them.** Some
   costs are the sandbox, not the code (observed: a ~5-minute browser-worker
   teardown hang after the result line prints — proven environmental by an
   `about:blank` probe, unfixable by any in-repo change). The correct response is
   operational: bound every such run with a timeout sized to the *real* work,
   read the result line, treat the kill as noise — and write the fact into
   memory/docs so no future session re-diagnoses it. Corollary, measurement
   hygiene: a piped `$?` reports the last pipe stage, not your command; a wall
   time that lands exactly on your own timeout means the timeout fired, not that
   the workload took that long.

## Reference material (load before Phase 2)

Prefer these live docs over any syntax in this skill:

- Subagents & `/agents`: `https://code.claude.com/docs/en/sub-agents`
- Hooks (events, `if` matcher, exit-code 2, MCP tool matching): `https://code.claude.com/docs/en/hooks`
- Plugins (what the GitHub plugin bundles; `pr-review-toolkit`): `https://code.claude.com/docs/en/discover-plugins`
- Harness to vendor: `https://github.com/brainqub3/red-green-refactor` (read its
  `references/red-green-refactor-philosophy.md` and `test-strategy.md`).

## Toolchain & stack profile (verify in Phase 0)

Assumed present, stop (`BLOCKED`) if missing: `git`, `gh` (authenticated), a recent
Claude Code with the **official GitHub plugin/connector** installed, and **Node 18+**
(the harness needs it). The stack is **profile-driven**: the **default profile is
Python 3.13+ with `uv`, `pytest`, `ruff`**. Wherever a concrete command appears (e.g.
`uv run pytest` in a hook), read it as "the profile's test/lint command" and swap in
the project's real toolchain. Detect the stack in Phase 0 and record the profile in
the Decision Log.

---

## The build — phase by phase

Each phase is **Goal → do the work (see reference) → Verify → Checkpoint.** Full
skeletons live in `references/`; load the named file when you reach the phase.

### Phase 0 — Repository foundation
**Goal:** an empty but valid template repo with a green baseline and a remote.
- Verify the toolchain above. Run `/plugin` and **record exactly what the GitHub
  plugin bundles — its commands, agents, and especially its MCP tool names, including
  the merge-PR tool.** Phases 3 and 5 depend on these names.
- Create the directory tree in `references/directory-tree.md`. Add a trivial passing
  test so the suite is green from commit one. Init `git`, commit on `main`.
- **Prepare** the `gh repo create` command and the branch-protection command (require
  PR before merge, block direct push to `main` even for admins). Solo-founder shape:
  `required_approving_review_count = 0` — requiring 1 review deadlocks a solo founder
  who cannot approve their own PR; defer required status checks to Phase 4 when the CI
  workflow exists to name. Note that branch protection on a **private** repo requires
  GitHub Pro — surface the public/paid/no-backstop choice at the checkpoint. Present
  the commands, get approval, then the orchestrator runs them (rule 3) — do not make
  the founder run them.

**Verify:** dependency install succeeds; the suite runs green (default: `uv sync`
then `uv run pytest`); `git log` shows one commit.
**⛔ CHECKPOINT 0:** founder approves; the orchestrator then runs `gh repo create` (or
skips it if the remote already exists) and enables branch protection. Do not proceed
until confirmed.

### Phase 1 — `CLAUDE.md` handbook (the constitution)
**Goal:** a short, project-agnostic handbook every session and subagent inherits.
Write it per `references/claude-md-handbook.md` (the hierarchy, the two rules —
merge authority and living specs — the lanes, the **build philosophy with its
over-engineering tripwires** (a top-level section, never a closing bullet:
economics item 4), the gates, model-tiering guidance, prose conventions). Keep it
under ~100 lines: few enough rules that the founder can actually hold them all.

**Verify:** a fresh reader of `CLAUDE.md` *alone* can answer "who may merge?" and
"what happens when code and spec disagree?".
**⛔ CHECKPOINT 1:** founder approves the handbook wording.

### Phase 2 — Role subagents
**Goal:** the four roles as addressable, tool-locked, model-pinned subagents.
Write `.claude/agents/{builder,reviewer,triage,spec-author}.md` directly (the
`/agents` command no longer authors them; files hot-reload). Use the frontmatter +
hook + system-prompt skeletons in `references/agents.md`. Apply the roster exactly:
reviewer gets **no** Edit/Write; every writing role carries the frontmatter
`.claude/` fence and every Bash-carrying role carries the frontmatter merge guard.
Give the reviewer a **two-stage review** (spec-compliance first, then code-quality)
whose stage 1 checks *justified* contract movement per DEC-1, not test immutability,
and whose stage 2 ranks simplicity findings equal to defects. The builder's charter
carries the pre-DONE over-engineering self-check (economics item 4).

**Verify:** all four load live (check them listed / delegable); reviewer has no write
capability. (The fence and merge guard are proven in Phase 3, once the hook scripts
exist.)
**⛔ CHECKPOINT 2:** founder reviews each role's tools, model, and prompt.

### Phase 3 — Hard gates (hooks) — the most important phase
**Goal:** the two deterministic gates plus the harness fence, all enforced by exit
code 2. Build every script and the `settings.json` wiring from
`references/hooks.md` — four **stdin-deciding scripts** (no `if:` filters; each
parses the tool input itself), the critical ones **double-wired** per DEC-18
(frontmatter with explicit args + global layer detecting `agent_type`). In summary:
- `block-merge` — blocks, for subagents: `git merge`, `gh pr merge`,
  `gh api …merge…`, branch deletion, pushes naming `main`, pushes while on `main`;
  blocks for **everyone**: the GitHub plugin's merge tool and plugin direct-write
  tools targeting `main` (DEC-7). The orchestrator's own `gh pr merge` path
  stays open because the global Bash layer passes through when stdin has no
  `agent_type`.
- `commit-gate` — on any `git commit`: block code commits on `main`; skip the suite
  for provably docs-only commits (fails safe; docs-only commits may land on `main`
  directly — founder-approved policy); otherwise run the profile's **fast hermetic
  unit suite** (plus lint) and block if red. The full suite gates PRs via CI, not
  every inner commit. There is no red-commit escape hatch — test and code land
  together, so no intended red commit exists.
- `path-guard` — the harness fence (DEC-19): any role subagent writing under
  `.claude/` is blocked; everything else passes. Resolve the root from the target
  file's own worktree, and detect a root *named* `.claude` (see Corrections).
- `format` — PostToolUse formatter on edited files; never blocks.

**Verify (live, show transcripts):** a `git merge`/`gh pr merge` from a **subagent** is
blocked with a reason; a merge through the **GitHub plugin's merge tool** is blocked;
the **orchestrator's** approved `gh pr merge` still succeeds; a `git commit` with a
deliberately failing test is blocked, then reverting to green allows it; the builder
attempting to edit under `.claude/` is blocked while its writes to `src/`, `tests/`,
and `specs/` pass; `/hooks` lists all configured hooks.
**⛔ CHECKPOINT 3:** founder confirms **each** gate fires — including the plugin merge
path and that a build subagent cannot merge — while the orchestrator's approved merge
path stays open. Do not proceed on an unverified gate.

### Phase 4 — Vendor & adapt the TDD harness (DEC-6)
**Goal:** the `brainqub3/red-green-refactor` suite living in `.claude/skills/`,
adapted to the single-builder loop, the gates, and the stack profile. Follow
`references/harness-and-sprint.md` (§ Harness). Key points: vendor by copy (record
the source commit SHA); **audit the scripts before trusting them**; adapt
`red-green-refactor` so one builder writes the acceptance test first, watches it
fail, then drives inner unit cycles to green — test and code committed together —
with **inner unit tests co-located under `src/`** (DEC-20; `tests/` holds the
behavioral contracts, grouped by subproject); adapt `tdd-plan` to write per-slice
plans under `plans/<feature>/` linked to a GitHub issue; adapt `tdd-ci` to run the
profile's test command and commit an Actions workflow (never commit secrets); adapt
`safe-pr` to the **non-web evidence path** (real-endpoint integration + transcript
evidence, secret-scanned), verifying the sprint suite green and **contract movement
disclosed** (any edit to a pre-existing test or spec has its one-line justification
in the PR body), with a bare `Closes #NN` in the body. Do **not** vendor or keep a
`tdd-harness` coordinator skill — `/sprint-start` (Phase 5) is the coordinator.
This phase also delivers the repo's **tiered test-suite design** (reference § Test-suite
architecture): fast hermetic units at the commit gate; the current subproject's
contracts at slice close; the full suite **once per PR, in CI as the required
check** — cost proportional to blast radius, designed around the repo's own
expensive dependencies, never by weakening what gates the merge.

**Verify:** `/tdd-plan` writes slice plans; `/red-green-refactor` drives one slice
test-first to green; `/tdd-ci` yields a passing Actions run; `/safe-pr` prepares a PR
into `main` with embedded evidence and **does not merge**.
**⛔ CHECKPOINT 4:** founder confirms the audit findings and the DEC-1 adaptation.

### Phase 5 — Sprint & lane wiring over the harness
**Goal:** thin management skills that replace the session model and drive the
builder through the harness. Follow `references/harness-and-sprint.md` (§ Sprint).
Write `/sprint-plan` (decompose a subproject into a GitHub-issue backlog **through
the plugin's issue tools**, each issue linking its `plans/<feature>/` slice files;
draft issue bodies to local files for operator review before filing; sanction a
`gh issue create` fallback — plugin `issue_write` tokens have 403'd on issue-write);
`/sprint-start` (clear context, pick the next issue by dependency, dispatch the
**builder** to take it test-first to green — spec updated in the same branch if
behavior moves — then `safe-pr` prepares the PR, never merges — and **bookend the
session with two mandatory dual-register founder briefs**, a kickoff before the
branch is cut and a wrap-up at the pause, each with a plain-language part and a
technical part so no session runs dark); `/fix` (the fast lane — one scope check,
then one builder dispatch that makes the surgical fix *with its own regression test*
when behavior is involved; feature-scale work bounces to `/sprint-start`); thin
`/triage` and `/review` entry points (review is **on-demand**: founder-requested or
high-blast-radius); and define GitHub labels `design-question`, `blocked`,
`needs-context`, `done-with-concerns` plus the per-subproject namespace
`sub:<subproject-slug>` (one coarse label per subproject, not per feature).

**Verify:** `/sprint-plan` on a sample PRD produces real issues with linked slice
plans; `/sprint-start` drives one issue from selection to a prepared PR with no manual
git; `/fix` lands a fix + regression test in one dispatch.
**⛔ CHECKPOINT 5:** founder approves the sprint flow on the sample.

### Phase 6 — Dry run & validation
**Goal:** prove the whole machine on one throwaway feature, in a **fresh session** so
all subagents and hooks are active. Take one trivial feature end to end: idea →
`/triage` issue → builder writes the failing acceptance test, greens it, touches the
spec if behavior moved → `/safe-pr` PR into `main`. **Pause at the merge for
approval.** Present the green PR to the founder.

**Verify:** every item in the Definition of Done below holds on the dry run.
**⛔ CHECKPOINT 6:** the founder approves the merge; the orchestrator then runs it
(rule 3). After the merge, run `/safe-cleanup`: report first, then delete the merged
branch on the founder's approval — approval is all that's needed.

> *Migration note (only if adopting this into a project that already had a different
> workflow — including a v1 instance of this very org): snapshot the old harness
> first (a mirror-to-private-repo script is the proven pattern for a gitignored
> `.claude/`), then delete the v1 machinery in place — spec-freeze hook and its
> wiring, the test-author/implementer/fixer agents (collapse to builder), the
> tdd-harness coordinator, all flag-file choreography — and rewrite the handbook,
> `/fix`, `/sprint-start`, reviewer, and spec-author to v2. Sweep every remaining
> skill for stale role references (`grep -ri 'test-author|implementer|fixer|
> spec-freeze|spec-mode|allow-red-commit'`), smoke-test the new path-guard on block
> and pass cases, and snapshot again. A v1→v2 migration was done live in one
> session; the handbook shrank to ~45% of its length.*

---

## Decision Log & Progress Tracker

Maintain both as you work. Append a **Decision Log** row whenever you diverge from a
skeleton (e.g. a hook field renamed per current docs) or resolve an ambiguity — seed
it with DEC-1..7 + DEC-19 and the chosen stack profile. Keep a **Progress Tracker**
with one row per phase (Status / Date / Notes). Store them in `docs/` or the repo
README so the founder can audit the build.

## Definition of done

- [ ] A new product starts from the template: PRD in `specs/`, `/sprint-plan` yields a
      real issue backlog with linked slice plans.
- [ ] Four roles exist as tool-locked, model-pinned subagents; reviewer is read-only;
      every role is hook-blocked from `.claude/` (the harness fence, double-wired so
      the global `agent_type` backstop guards it too).
- [ ] `git merge`, pushes to `main`, branch deletion, **and the GitHub plugin's
      merge and direct-write tools** are all blocked from every **subagent** by
      double-wired hooks (frontmatter + global `agent_type` backstop); branch
      protection backstops it server-side. The orchestrator's own merge and cleanup
      path stays open and runs on founder approval only.
- [ ] A failing suite blocks a commit, under a tiered design: fast unit gate per
      commit, current-subproject contracts at slice close, full suite once per PR in
      CI — no full-suite run ever sits inside the inner loop; docs-only commits skip
      the suite and may land on `main`.
- [ ] Harness vendored and adapted to the single-builder loop: the acceptance test
      is written first and watched failing; test and code land together; `tdd-ci`
      runs the profile's test command in Actions; `safe-pr` uses the non-web
      evidence path and checks contract-movement disclosure.
- [ ] Specs are living: a behavior change and its spec update land in the same PR;
      a contested design intent gets a `design-question` issue, never a silent edit
      and never a stop-the-world freeze.
- [ ] The developer principles have teeth: the handbook carries the build
      philosophy with named over-engineering tripwires as a top-level section, the
      builder's charter has the pre-DONE simplify-or-justify self-check, and the
      reviewer ranks simplicity findings equal to defects.
- [ ] The operator acts at exactly three moments: plan approval, design-question
      adjudication, merge/cleanup approval — and every checkpoint was approved
      before proceeding. The operator only ever *approves*; the orchestrator
      executes.

When all hold: the operator specifies and decides, the builder builds test-first,
the gates hold the line.
