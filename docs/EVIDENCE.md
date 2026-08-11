# Evidence

Everything the build must not get wrong, with the evidence behind it and the phase
that owns it. Three sources, one file:

- **C — currency.** Where current Claude Code contradicts the vendored skill.
  Checked 2026-07-31 against the official docs. Where a doc and the skill disagree,
  the doc wins.
- **V — divergence.** Where the vendored skill and production disagree. Production
  is evidence; the skill is a claim.
- **L — lesson.** What production learned from a real incident with a file or commit
  behind it.

Nothing here is fixed in `source/` — that tree is frozen. Every item is either a
build requirement or a decision input.

## Index

| ID | Finding | Owner |
|---|---|---|
| **C-01** | Plugin subagents cannot carry `hooks:` frontmatter — one gate layer, not two | Phase 1 |
| **C-02** | `agent_type` is not a "this is a subagent" flag | P1.1 |
| **C-03** | Commands merged into skills — ship `skills/` only | Phase 0 · [D9](DECISIONS.md) |
| **C-04** | `if:` filters fail open on unparseable commands; never the security boundary | P1.1 |
| **C-05** | A per-hook `shell` field exists; the skill's contrary note is unverified | P1.1 |
| **C-06** | Structured JSON blocking adds `ask`/`defer`; exit 2 stays the hard block | P1.1 |
| **C-07** | Subagents run in the background by default and lose tools there | Phase 2 |
| **C-08** | No dispatch-time tool restriction; only `permissions.deny` reaches subagents | Phase 0 |
| **C-09** | Manifest, marketplace and `${CLAUDE_PLUGIN_ROOT}` specifics | Phase 0 · Phase 7 |
| **C-10** | Claude 5 context guidance: author skills lean; don't port verification prose | Phase 2 |
| **V-01** | The v1 red-commit escape hatch is still live | P1.3 |
| **V-02** | `block-merge` carries two fixes the skill never absorbed | P1.2 |
| **V-03** | `format` still uses `CLAUDE_PROJECT_DIR` | closed by [D13](DECISIONS.md) |
| **V-04** | An undocumented operator-tools layer | Phase 3 |
| **V-05** | One implementation, presented as portable | P1.3 · [D8](DECISIONS.md) |
| **V-06** | `.claude/` is gitignored, so harness edits bypass all ceremony | Phase 6 |
| **V-07** | The fourth role is orphaned | P0.3 |
| **V-08** | The Node/Playwright assets are the generalization, not dead weight | P1.3 · Phase 2 |
| **V-09** | Dangling `find-docs` / `ctx7` tool references | Phase 2 |
| **V-10** | The operator tools duplicate product state | Phase 3 |
| **V-11** | The snapshot tool encodes two hook-interaction landmines | Phase 3 |
| **V-12** | A name-prefix bug of a class the skill only half-warns about | P1.1 |
| **V-13** | The gates lost both their shared library and their tests | P1.1 |
| **V-14** | MIT attribution is incomplete | P0.2 |
| **V-15** | v1's lanes were slash commands | closed by C-03 |
| **L-01** | Reviewer isolation must be a hook, not a convention | P1.6 |
| **L-02** | Committing is a data-mutating operation; it killed a live run four times | P1.5 |
| **L-03** | Tests reach live data in more ways than a data-path check catches | P1.5 |
| **L-04** | "File-disjoint" is not disjoint if the files don't exist yet | Phase 5 |
| **L-05** | Any destructive tool must fail closed on an empty input set | Phase 2 |
| **L-06** | The tiered suite blinds you exactly where the interesting failures are | Phase 2 |
| **L-07** | Charter lines worth adopting close to verbatim | Phase 2 · Phase 6 |
| **L-08** | Gate and tooling patterns worth stealing | Phase 1 · Phase 3 |
| **L-09** | Five Windows encoding incidents in the gate layer | [D8](DECISIONS.md) |
| **L-10** | Measurement discipline | Phase 4 |

---

# C — Claude Code currency

Every claim carries its doc URL. The skill's own operating rule 6 says to verify
mechanics against current docs before writing them.

### C-01 — double-wiring is impossible in a plugin

`https://code.claude.com/docs/en/sub-agents`

> "For security reasons, plugin subagents don't support the `hooks`, `mcpServers`,
> or `permissionMode` frontmatter fields. These fields are ignored when loading
> agents from a plugin."

The skill's DEC-18 wires every critical gate twice — once in each subagent's
frontmatter, once globally in `settings.json` — as defence against
frontmatter-hook unreliability. **A plugin gets only one layer.** The frontmatter
half is silently ignored, which is worse than absent: an agent file carrying a
`hooks:` block reads as guarded and is not.

All enforcement moves into `hooks/hooks.json`. That layer is not a backstop, it is
the whole gate — which raises the value of the shared library and its tests rather
than lowering it. If per-agent frontmatter hooks are ever genuinely required, the
plugin must ship the agent file *plus* an instruction to copy it into
`.claude/agents/` — an install step, not a plugin capability.

### C-02 — `agent_type` is not a "this is a subagent" flag

`https://code.claude.com/docs/en/hooks`

> "`agent_type` — Agent name… **Present when the session uses `--agent` or the hook
> fires inside a subagent.** … For subagents shipped by a plugin, this is the
> plugin-scoped identifier such as `my-plugin:reviewer`, not the bare frontmatter
> name."

Two silent bugs in a naive port:

- **A main session launched with `--agent` carries `agent_type`.** Every vendored
  gate reads "`agent_type` present ⇒ subagent ⇒ enforce", so the orchestrator's own
  approved merge path is blocked in that mode. The whole "the orchestrator merges on
  approval" design depends on this test.
- **Plugin subagents report `aeo:reviewer`.** A matcher written against the bare
  name never fires. A colon makes a matcher a regex, so anchor it: `^aeo:builder$`.

Same bug class as V-12 and the path-prefix trailing-separator rule — an identity
test that is *nearly* right.

### C-03 — commands have been merged into skills

`https://code.claude.com/docs/en/skills` (`/slash-commands` now redirects here)

> "**Custom commands have been merged into skills.** A file at
> `.claude/commands/deploy.md` and a skill at `.claude/skills/deploy/SKILL.md` both
> create `/deploy` and work the same way."

And the plugin reference, on `commands/`: *"Skills as flat Markdown files. **Use
`skills/` for new plugins.**"*

The earlier six-commands-plus-five-skills split rested on a distinction —
deterministic invocation versus description-matching — the platform no longer
draws. What survives, in the current model:

- `disable-model-invocation: true` makes a skill **user-invocable only** — the
  determinism the six operator lanes wanted, without a second directory.
- `user-invocable: false` hides a skill from the `/` menu for workflow-internal pieces.
- Plugin skills are **always namespaced** (`/aeo:sprint-start`), which removes the
  trigger-competition risk that motivated the rest of the split.

Settled as [D9](DECISIONS.md).

### C-04 — `if:` filters are not dodged by compound commands, but they fail open

`https://code.claude.com/docs/en/hooks`

The skill's DEC-16 says `if: "Bash(git merge *)"` is dodged by
`git add . && git merge`. The docs say otherwise — each subcommand is checked,
leading assignments are stripped, and `$()`/backtick substitutions are checked too.

The real caveat is better:

> "The filter also fails open, running your hook regardless of pattern, when the
> Bash command can't be parsed. Because the `if` filter is best-effort, **use the
> permission system rather than a hook to enforce a hard allow or deny**."

`if` holds exactly one rule — no `&&`, `||`, or lists.

**Design unchanged, for a better reason.** Scripts decide from stdin. `if:` is a
cheap pre-filter, never the security boundary.

### C-05 — a `shell` field exists

The per-hook schema includes `shell` (`bash` | `powershell`). The skill records that
the `& '<path>'` form with a `shell:` field "silently fails to register" — an
observation pinned to Claude Code 2.1.201. Re-verify in P1.1 rather than carrying it
forward as fact.

### C-06 — structured blocking is preferred over bare exit 2

Exit 2 still blocks and still feeds stderr back to the model. Exit 0 with JSON on
stdout supports outcomes exit codes cannot express:

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "…" } }
```

`permissionDecision` ∈ `allow` | `deny` | `ask` | `defer`. **`ask` and `defer` have
no exit-code equivalent.** A gate that is unsure could escalate to the founder — but
a guard that asks is a guard that gets click-through approved. **Keep hard blocks on
exit 2** (it blocks even if JSON fails schema validation, per v2.1.214+); use JSON
only where `ask`/`defer` is genuinely wanted.

Any other non-zero exit is a **non-blocking** error: the tool call proceeds. A gate
that cannot start therefore fails open. This is why [D8](DECISIONS.md) and the
runtime preflight in P1.1 exist.

### C-07 — subagents run in the background by default, and lose tools there

As of v2.1.198 subagents default to background, where the available tool set is
filtered to a fixed list. "The same definition can resolve to different tools in the
foreground and the background." A role listing a tool outside that list silently
loses it. Check every capability assumption in a role charter against the background
list, not just the `tools:` field.

### C-08 — there is no dispatch-time tool restriction

`https://code.claude.com/docs/en/tools-reference#agent-tool-behavior`

Tool resolution comes only from the agent definition (`tools`, `disallowedTools`;
`disallowedTools` wins when both are set). The only documented per-invocation
parameter is `model`. Restricting a subagent's tools at dispatch is not possible.
What *is* available: session-wide `permissions.deny` rules, which do apply inside
subagents — the bootstrap guardrail until Phase 1 lands.

### C-09 — manifest and marketplace specifics

`https://code.claude.com/docs/en/plugins-reference` ·
`https://code.claude.com/docs/en/plugin-marketplaces`

- **`plugin.json` is optional; `name` is its only required field.** Unrecognised
  top-level fields warn; wrong *types* fail the load.
- Add `$schema: https://json.schemastore.org/claude-code-plugin-manifest.json`.
- **Set `version` explicitly** — omit it and the git SHA is used, so every commit
  looks like a new version to users.
- Validate with `claude plugin validate ./plugin [--strict]`.
- `${CLAUDE_PLUGIN_ROOT}` works in `hooks/hooks.json` and is the documented idiom.
  **Quote it** — install paths contain spaces. It is **ephemeral**: it changes on
  plugin update, so never write state there ([D12](DECISIONS.md)).
- Per-hook `timeout` is in seconds (default 600 for command hooks).
- Marketplace: `.claude-plugin/marketplace.json` at repo root; requires `name`,
  `owner`, `plugins`. Each entry requires only `name` and `source` — a relative path
  when the plugin lives in the same repo.

### C-10 — Claude 5 context guidance: author skills lean, don't port verification prose

`https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models`
(published 2026-07-24; checked 2026-08-11)

Anthropic removed over 80% of Claude Code's *own* system prompt for the Claude 5
generation with no measured regression on coding evals, and published the guidance
that follows from it:

- CLAUDE.md files stay lightweight — describe what the repo is for, spend tokens on
  gotchas, not on restating the obvious.
- Skills are "lightweight guides to let Claude find information when needed." Avoid
  overconstraining them "except in highly important areas"; split long skills into
  many progressively-loaded files.
- Prefer code-shaped references (a mockup, a test suite) over prose descriptions.
- Explicit verification instructions cause over-verification on Claude 5 models;
  their removal cut wasted tokens with no quality loss. Verification guidance
  belongs in selectively-loaded skills, not upfront prompts.
- A `/doctor` command now exists to rightsize skills and CLAUDE.md files.

Secondary coverage widely misreports this as "delete 80% of your docs" or "CLAUDE.md
is deprecated." Neither appears in the post. Verify claims about it against the post
itself.

**What changes.** The Phase 2 port is a re-authoring, not a copy. The vendored
skill's charters and skills were written for the generation that needed explicit
constraint stacks; ported verbatim they are now actively counterproductive. Three
rules for every Phase 2 artifact:

1. **Never restate in prose what a gate enforces.** Enforcement lives in
   `hooks/hooks.json` (C-01). A charter line that duplicates a gate is dead weight
   at best and an instruction conflict at worst.
2. **Drop explicit verify-your-work instructions from agent prompts.** The test
   gate is the verification; prose repetition of it triggers over-verification.
3. **Overconstrain only the genuinely critical:** merge authority, reviewer
   isolation (L-01), data-safety rules (L-02/L-03). Everything else states intent
   and trusts judgment.

**What does not change.** Phase 1 is untouched — deterministic gates outside the
prompt are exactly the direction this guidance points. The dispositions in
[DECISIONS.md](DECISIONS.md) already assume lean skills; this sharpens the bar,
it does not move any phase.

---

# V — skill versus production

Fifteen divergences, found by reading both trees.

## The three that cost something

### V-01 — the v1 red-commit escape hatch is still live

`source/global-skill/…/references/hooks.md` (design rule 5) says flag files are gone
in v2 and "do not reintroduce them". The live `commit-gate.ps1` still carries both
the v1 header comment and the working check:

```powershell
if (Test-Path (Join-Path $projectDir '.claude/allow-red-commit')) { exit 0 }
```

The v1→v2 migration missed it. The flag file does not currently exist, so the path
is dormant — but it is one `New-Item` from silently disabling the tests-green gate,
and the hook's own header still advertises it. **Deleted in P1.3, not ported.**

### V-13 — the gates lost both their shared library and their tests

`source/v1-archive/claude/hooks/` has `lib.ps1` plus a `tests/` directory. The v2
harness has neither: four standalone scripts that each re-implement stdin parsing
and worktree resolution, verified only by hand at a checkpoint.

Not cosmetic. **V-02 and V-03 are exactly the drift a shared library prevents** —
the same worktree-resolution fix landed in `commit-gate`, later in `block-merge`,
and never in `format`. A harness whose entire thesis is *no behavioural change
without a test first* ships its enforcement code untested.

### V-05 — one implementation, presented as portable

The skill says the stack is "profile-driven" and to "port to bash for POSIX hosts".
It ships exactly one implementation of every script and hard-codes `uv run pytest`
and `ruff` in the commit gate and formatter. There is no bash port anywhere and no
detection logic. The single largest generalization gap.

## Where production is ahead of the skill

### V-02 — `block-merge.ps1` carries two fixes the skill never absorbed

- **The git-merge matcher.** Skill: `'git\s+(\S+\s+)*merge'`. Production:
  `'\bgit\s+((-C|-c)\s+\S+\s+|-\S+\s+)*merge(?![-\w])'`. The skill's version matches
  `git merge-base` — read-only — and misses `git -C <dir> merge`.
- **Push branch resolution.** The skill falls back to `CLAUDE_PROJECT_DIR` and
  `$PSScriptRoot`, which the skill's *own* design rule 4 forbids. Production honours
  a leading `cd <dir> &&`, then `cwd`, then the env var, and normalises MSYS paths —
  the same resolution the commit gate uses.

Port from the live script, not the skill's.

### V-03 — `format.ps1` still uses `CLAUDE_PROJECT_DIR`

The same design-rule-4 violation, in the one script the fix was never applied to.
Low blast radius — a formatter that no-ops — but it teaches the wrong pattern.
Closed by [D13](DECISIONS.md): the auto-format hook is not ported.

### V-04 — an undocumented operator-tools layer

`source/axial/dot-claude/tools/` holds `snapshot-harness.py` (mirror the gitignored
harness to a private repo — the only rollback that exists), plus `run-monitor.py` and
`axial-watch.py`. The skill mentions the mirror pattern only in a parenthetical
migration note. Production treats it as infrastructure.

### V-11 — the snapshot tool encodes two hook-interaction landmines

Both exist only because of the gates it lives under, and both are non-obvious:

- It **must not** nest a git repo inside `.claude/`, because
  `rev-parse --show-toplevel` would then resolve to the harness directory and defeat
  the path-guard fence — the exact failure the fence's root-*named*-`.claude` check
  was later added to catch.
- It **must not** inline a literal `git commit` string into an agent-run shell
  command, because the commit gate matches on that string and would run the project's
  suite inside the harness mirror repo and block.

A gate that constrains the tooling built around it is a design consequence, not a
bug — but it is undocumented.

## Where the roster and the docs have drifted

### V-07 — the fourth role is orphaned

The skill's roster is four roles. Production ships four agent files but its handbook
names three: builder, reviewer, triage. `spec-author` appears in no lane, no skill
and no handbook line, has not been touched since the v2 rewrite, and its own charter
concedes small spec work belongs to the builder. Production voted by not using it.

### V-06 — `.claude/` is gitignored, so harness edits bypass all ceremony

Production: *"`.claude/` and this file are gitignored; harness edits are live on
write, with no PR ceremony."* The skill's Phase 0 tree commits `.claude/` into the
repo. Two different postures — and the gitignored one is why the snapshot tool (V-04)
had to exist. A plugin inverts this again: the harness ships as an installed unit
rather than repo content, which removes the problem instead of solving it.

### V-14 — MIT attribution is incomplete

v1 committed `VENDORED.md` and `UPSTREAM-LICENSE`
(`source/v1-archive/claude/skills/`). v2 keeps the vendored SHA in a decision-log line
and ships **no upstream LICENSE**. Acceptable in a private repo; a real compliance
question for a distributed plugin built on MIT-licensed work.
`source/upstream-red-green-refactor/LICENSE` is vendored and ready to reinstate.

### V-15 — v1's lanes were slash commands

v1 shipped `commands/{build-resume,fix,review,sprint-plan,sprint-start,triage}.md`;
v2 converted them to skills. Closed by C-03: commands have since been merged into
skills, and new plugins ship `skills/`.

## Smaller, but worth carrying

### V-08 — the Node/Playwright assets are the generalization, not dead weight

`tdd-ci` ships `node-ci.yml` and `playwright-e2e.yml`, and `test-strategy.md` is
heavily Node/Playwright-flavoured with Python as one row in a detection table. In the
source product these are dormant. **For this project the reading inverts:** they are
the only multi-stack machinery in the harness, and that detection table is the
closest existing thing to the stack detection V-05 says is missing. Mine them, do not
prune them.

### V-09 — dangling tool references

`tdd-ci/SKILL.md`, `github-actions-guide.md`, `test-strategy.md` and both non-Python
workflow templates reference `find-docs` / `ctx7`, which exist in no current
environment. Inherited from upstream; they will silently no-op. Strip during the
Phase 2 port.

### V-10 — the operator tools duplicate product state

`axial-watch.py` pins a price table for three models that must mirror the product's
own, and hard-codes a total item count. `run-monitor.py` hard-codes seven pipeline
passes and a stall threshold tuned to one measured run. The *patterns* are good — a
live read-only dashboard, and a stall detector requiring checkpoints, logs and CPU all
flat — wrapped around un-generalizable specifics. Extract the pattern, discard the
table.

### V-12 — a name-prefix bug of a class the skill only half-warns about

`run-monitor.py` matches the *token* `axial` followed by the subcommand `run`, because
a substring match was wrong precisely since the repo lives at `D:\axial` — every argv
contains it. Same class as the skill's own "guard path-prefix checks with a trailing
separator" correction, which is stated for paths only. **One rule, stated once, covers
both: an identity test matches a whole token or a whole path segment, never a
substring.** Belongs in the shared library's contract, not in each caller.

---

# L — production lessons

Grounded in real incidents. Domain findings about the source product's corpus are
excluded.

## Six that change decisions already taken

### L-01 — "the reviewer never sees the builder's report" must be a hook

The strongest correction in the set. Production learned it and wrote it into a hook
header:

> An agent holding file tools reads the repo whatever it is told, so "we asked it not
> to" is not a seal.

Their implementation is a `PreToolUse` hook that blocks *every* tool for the judge
role except a `Read` of one staged path in the OS temp scratchpad, **outside the repo
entirely**. Reinforced structurally: reviewers dispatch through a call that has no
`tools` parameter to pass, so a reviewer cannot be handed a tool registry even by
mistake.

**What changes.** Reviewer independence was specified as a dispatch convention. A
reviewer with `Read`, `Grep` and `Glob` can simply go and read the builder's branch,
its commit messages and the PR body. The convention is not a seal. There is a second
reason to stage the packet rather than paste it: a large packet pasted into a dispatch
prompt routes through the orchestrator's context repeatedly and risks being mangled.
**Owned by P1.6.**

### L-02 — committing is a data-mutating operation, and it killed a live run four times

Because the commit gate runs the test suite, **`git commit` executes code**. The
runbook states it bluntly: *while a corpus run is live, no `pytest` and no commits,
from any session.* Four simultaneous external kills of a running pipeline were traced
to a concurrent session's commit gate firing the suite.

**What changes.** The sandbox guard must carry a **run-in-progress sentinel the commit
gate refuses to cross** — not only a data-path check. This is the four-actor
concurrency hazard in its sharpest form: actor B's routine commit kills actor A's
four-hour run. Same asymmetry already noted — every other gate blocks an action, the
commit gate performs one — with a second victim class nobody had named.
**Owned by P1.5.**

### L-03 — tests reach live data in more ways than a data-path check catches

Three incidents, months apart, all invisible in CI *because CI has no data directory*:

- A module-global logs root meant any test driving `main()` wrote real timestamped run
  directories into the operator's live logs — **79 leaked directories over five days**,
  one of which a status hook then reported as "newest run".
- A lookup resolving through a *default* directory when the argument was omitted meant
  six test call-sites silently read the operator's live 49,674-entry index.
- A conftest fixture snapshotting and restoring a shared state directory — the
  mitigation that existed, which addresses collision but not reach.

**What changes.** Two additions to the sandbox guard, both from their fix shape:

1. Repoint **every** default-directory resolver in an autouse fixture, not just the one
   obvious data root.
2. **An environment-variable seam is required**, because in-process monkeypatching
   never reaches a subprocess CLI child — and integration tests shell out.

And a charter line: *"it passed in a worktree" is not verification for anything
data-facing.* These reproduce only on the operator's machine. **Owned by P1.5.**

### L-04 — "file-disjoint" is not disjoint if the files don't exist yet

Two issues were dispatched concurrently, verified as touching no common files. Both
created the same new module and its two test files, with incompatible content.
Reconciled by hand.

**What changes.** An independence check of "no shared files, no dependency" passes this
pair. **Disjointness must be asserted over planned new paths**, which means slice plans
declare the files they intend to create, not just the ones they will edit.
**Owned by Phase 5.**

### L-05 — any destructive tool must fail closed on an empty input set

A garbage collector was built correctly, then review found that an empty keep-set —
which is what you get from running in the wrong working directory — makes *every*
artifact an orphan. `--apply --yes` would have deleted the entire derived corpus. Fixed
by raising before any confirmation, logging or removal, **with no override flag**.

**What changes.** Generalise to `safe-cleanup` and anything that sweeps, prunes or GCs:
an empty or suspiciously small keep-set is a hard failure *before* the confirmation
prompt, with no bypass. The absence of an override flag is the point — an override is
what you reach for at 2am. **Owned by Phase 2.**

### L-06 — the tiered suite blinds you exactly where the interesting failures are

An acceptance-level regression was "invisible locally because the commit gate only runs
the fast tier, not the acceptance directory." The tiering is deliberate and correct —
the full tree is CI's job. The consequence is still real: acceptance breakage is only
ever discovered in CI.

**What changes.** The honest cost of narrow-by-default test scoping, and it needs a
stated countermeasure rather than silence: any change touching a module with outer
acceptance contracts either runs those contracts locally or waits for CI green before
approval is requested. **Owned by Phase 2.**

## L-07 — charter lines worth adopting close to verbatim

**On auditing versus using.** Three days of mechanism inspection changed the product's
output exactly zero times — the findings the period ended with were the same ones it
started with, each fix surfacing the next defect one layer down. The standing rules
that came out of it:

- **New issues come from using the product, not from auditing it.**
- Backlog is closed against a bar: anything moving accuracy, latency or cost by less
  than ~5% is dropped, or converted to a future item **with a named trigger**.
- **A ship gate cannot be defined after the ship.**

This is the sharpest anti-over-engineering material in the corpus and it is evidence
for founder principle 1, not a restatement of it.

**Prefer the reversible error direction.** A measured 5.1× speed lever was rejected
despite a defensible agreement score, because its errors were lopsided toward the
*irreversible* direction — over-merging destroys information, under-merging only splits
something that can be rejoined. The asymmetry decided it, not the headline number.

**When two rounds of rewording fail, change the mechanism.** A rule failed twice; the
second attempt made a different half worse. Withdrawn with an explicit note that the
next attempt must change the mechanism rather than open a third round against a cause
the prompt does not control. It shipped as a positional rule with zero model calls,
landing within projection where the model rounds had over-cut.

**Agents are for judgment, not for waiting.** Processes run, the session polls,
subagents summarise. An agent cannot reliably babysit a multi-hour job and delegating a
wait loop burns tokens to do nothing — but handing a subagent a finished log (thousands
of lines in, a paragraph out) is genuinely good delegation, and keeps the log out of the
orchestrator's context.

**Standing delegation is explicit, time-boxed, and never extends to merge.** When the
founder went remote mid-run, the session recorded that everything from that point ran
under standing delegation, labelled each such decision as made autonomously rather than
confirmed live — and the builder dispatched under it was still told to stop short of
merging, no exception.

**Read the actual call site, not the docstring or the plan's claim about it.** Recorded
three times in one session. The worst instance: a parameter was never passed through, so
a checkpointing feature had *never run, for any input, ever* — which is why eight
"retries" were eight cold restarts, and why a correct fix produced no observable effect
when tested.

**A named or locked test encodes a deliberate decision — read it before "fixing" the gap
it looks like.** From the record: *"I almost made an unauthorized code change here —
caught it by reading tests first."*

## L-08 — gate and tooling patterns worth stealing

- **An unset threshold makes a gate silently skip.** Two budget checks were configured
  `null`, so the gate reported SKIPPED and the retest "would not have exercised the gate
  it exists to be." Unconfigured threshold = hard fail or loud skip, never a quiet pass.
- **Budgets are ceilings that never fire.** Set at 1.3–1.6× the highest observed, because
  "a gate one ordinary run from crying wolf is not a ceiling." Check whether a budget is
  *binding* before tightening it.
- **A skip-guard turns a re-run into a silent no-op that reports OK** — "the trap most
  likely to waste a night." A resumable pass must print its skip count loudly, and a run
  summary must refuse to report OK on a 100% skip.
- **Every cap that drops input emits a count on both sides.** A prompt composer silently
  truncated: 506 items assembled, 146 composed — 360 paid for and read by no model,
  recorded nowhere.
- **A zero over historical data means "not measured," not "none found."** Three
  independent instances. Any aggregate over derived data must be dated against the
  landing commit of the field it reports.
- **A count-based preflight is not a coverage check.** `Count >= 30` passes with a real
  input missing. Diff the names.
- **Blind same-prompt retry is for transient faults only.** Content-caused failures need
  a reroute, a quarantine, or a re-ask-with-feedback — not the same dice again. And **log
  every retry attempt**: silent retries made exposure unmeasurable.
- **A monitor reporting IDLE is not reporting "finished."** A healthy run invoked under a
  different subcommand showed `0 live workers / IDLE` for its entire duration. A monitor's
  negative signal must be distinguishable from "not instrumented for this shape of run."
- **Liveness needs movement across two checks, not a snapshot** — "a snapshot progress
  table looks identical whether a run is healthy or dead." CPU alone is untrustworthy; a
  stalled worker can spin at zero progress. And **do not blind-restart a suspected
  stall**; it will re-hang on the same input.
- **Front-load ground truth at session start.** A status answer once repeated a five-day-old
  memory and a never-ticked checkbox about work that had shipped. Their `SessionStart` hook
  prints live repo state and explicitly labels memory files and plan checkboxes as *neither
  ground truth*.
- **A runbook is only valid if it has been executed since the last method change.** A
  documented procedure asserted as surviving a redesign was found to describe a workflow
  superseded three times; running it as written would have reproduced the exact defect it
  was meant to fix.
- **Closure requires named evidence.** An issue was found closed while unimplemented.

## L-09 — the Windows fixes, and why they argue for one runtime

Each is a real incident, and **every one evaporates once the gates stop being
PowerShell**:

- PowerShell `*>>` writes UTF-16 and breaks log monitors.
- `Get-Date -Format 'u'` emits local time with a misleading trailing `Z` — a whole run's
  retry log carried wrong timestamps.
- `"$attempt:"` parses as a drive reference; needs `${attempt}:`.
- Console output and file reads default to the ANSI codepage, turning every em dash into
  mojibake unless UTF-8 is set at the top of every hook.
- A session-provided `cwd` can arrive in MSYS form (`/d/proj`), which `git -C` cannot
  consume.

Five recorded incidents, all encoding-and-quoting accidents in the gate layer. That is an
argument for the port independent of portability: this is not a language anyone should be
writing security-critical, fail-closed logic in by accident. The MSYS normalisation is the
one behaviour that must be carried across, not discarded.

One lesson that does **not** evaporate: a CLI that floods stdout floods an agent's
context. Their extractor printed ~600KB per input, with a standing instruction to always
redirect it.

## L-10 — measurement discipline

Relevant to Phase 4 and to any claim this project makes about whether a change helped.

- **Measure the noise floor before reading any comparison.** Re-running an identical
  generative pass reproduced its own result only **88.9%** of the time. That single number
  reframed two prior verdicts — one apparent regression was within noise, another sat 21
  points below the floor and was real.
- **Diff the entries that flipped, never just the totals.** A shipped regression was hidden
  by *every* aggregate: two metrics improved to zero while substantive output fell by a
  third. Elsewhere a one-word cosmetic relabel re-rolled 93 of 176 results.
- **A judge shown a pre-fill rubber-stamps it.** Correction rates of 0.99/1.00/1.00 against
  the system's own values — contributing nothing, and the first diagnosis drawn from it was
  wrong. A dispatched judge never sees the answer under test.
- **A test without a positive control pins plumbing, not judgment.** Plant known defects and
  confirm they are caught before trusting any judge's number, "since LLM judges are
  systematically generous and sensitive to confident prose." Directly applicable to Phase
  4's agent verifier.
- **Internal accuracy against your own system's output is not accuracy against truth.** A
  classifier scored 59–85% against its teacher's labels and 39.7% against ground truth —
  below the teacher.
- **`--limit N` is not a sample.** It takes the alphabetical head. Ship `--sample --seed`.
- **Measure one unit before launching thirty.** A probe corrected a wall-clock estimate from
  ~8–15h to ~19–20h *and* surfaced a hard reproducible failure before the full run.
- **Check what actually reaches the prompt before tuning the prompt.** "The model got it
  wrong" was wrong three times over — the model never saw the data.

---

*Fifty lessons were surfaced in the original sweep; those omitted are either captured in
the C and V sections above or specific to the source product's domain. The search covered
postmortems, the decision log, runbooks, trackers, plan files and source comments.*
