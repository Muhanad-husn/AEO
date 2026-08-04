# Decisions

Settled decisions governing the migration, with rationale and expected impact —
required by fixed principle 3. A decision here is binding until explicitly revisited.
Newest first.

Identifier schemes, kept distinct on purpose: **D*n*** here, **C/V/L** in
[`EVIDENCE.md`](EVIDENCE.md), **EN-*n*** for the founder's proposed enhancements
(below), **DEC-*n*** for the vendored skill's own decisions, quoted only.

---

## 2026-08-04 — One decision from Checkpoint 0

### D15 — The marketplace manifest ships in Phase 0, and `validate` is not the gate

**Problem.** Two things surfaced when Phase 0 was actually verified rather than
planned.

Phase 0's verify line requires that the plugin installs locally. Nothing installs
without a `marketplace.json`, and the plan assigned that file to Phase 7. The phase
could not meet its own acceptance bar with its own deliverables. Verification was
completed with a throwaway manifest built outside the repo and deleted afterwards.

Separately, `claude plugin validate ./plugin --strict` reads
`plugin/.claude-plugin/plugin.json` and nothing else. It never opens a `SKILL.md` or
an agent file. The plan treated it as the phase gate, so a phase whose entire content
is eleven skill stubs and three agent stubs would have been gated by a check that
cannot see any of them.

**Decision.** A minimal `.claude-plugin/marketplace.json` ships in Phase 0, at the
repo root. Phase 7 extends it for distribution rather than creating it.

`validate --strict` is a manifest check, not the gate. Wherever a verify step names
it, the requirement is validate **plus** a local install **plus** a
`claude plugin details` inventory. The inventory is what reads the stubs.

**Impact.** The plugin becomes installable from Phase 0 forward, which matters
because it will be installed many times before Phase 7. The strengthened check is
what caught that a manifest-only pass proves nothing about eleven skills, and it is
the same failure shape as C-01: a check that reads as coverage and is not.

**Residual gap, recorded rather than closed.** No runtime check proves the six lanes
are absent from the model-invocable set. `disable-model-invocation` is confirmed as
the correct key — it is the only spelling present anywhere in the local plugin cache,
and a shipped first-party plugin uses it — and it is present on exactly those six.
That is the strongest evidence available without a live negative test.

**Cost of reversal.** One file and one paragraph. Nothing depends on it.

---

## 2026-07-31 — Seven decisions from the plan review

Taken after a full read of the planning set against the vendored source. Four resolve
contradictions between documents; three close gaps no phase owned.

### D8 — The hook runtime is Node, superseding D1's Python

**Problem.** [D1](#d1--port-the-hooks-to-python-in-a-dedicated-directory) justified
Python with "Python is already present wherever Claude Code runs." That is not true,
and the counter-example is the founder's own machine: `python3` there resolves to
`C:\Users\…\AppData\Local\Microsoft\WindowsApps\python3.exe`, a 0-byte Microsoft
Store alias stub, not an interpreter. `python` resolves to miniconda and `py` to the
launcher — neither is what the `hookify` precedent invokes.

This matters more than a wrong path. A hook that cannot start exits non-zero but not
2, which Claude Code treats as a **non-blocking** error: the tool call proceeds
(C-06). The gate fails open. That is the exact "installed but enforcing nothing"
failure D1 was written to prevent, relocated from macOS to Windows.

**Decision.** The gates are **Node**, invoked as
`node "${CLAUDE_PLUGIN_ROOT}/hooks/<gate>.mjs"`.

Why Node rather than fixing the Python invocation:

1. **It is already a hard prerequisite.** The vendored skill lists Node 18+ under
   required toolchain, and two shipped scripts we are keeping — `collect-evidence.mjs`
   and `classify-branches.mjs` — are Node. Choosing Python means a stack-agnostic
   plugin that needs two interpreters.
2. **Claude Code's npm distribution puts `node` on PATH.** One name, no launcher
   shims, no Store aliases.
3. Every incident in L-09 is a PowerShell encoding or quoting accident. Node fixes
   those as completely as Python would.

**Residual risk and its mitigation.** A native-binary Claude Code install may not
expose `node`. Mitigation is fail-loud, not fail-open: the SessionStart hook (P1.7)
prints an unmissable banner when the runtime does not resolve, `/aeo:status` reports
gate health, and the README states the prerequisite. We do not attempt to block all
tool use when the runtime is missing — that bricks the session for a condition the
founder can fix in a minute.

**Impact.** D1's directory decision stands: `hooks/` at the plugin root holds the
gates, their shared library and nothing else. Python remains this repo's *development*
language for the eval tooling (`grade_repo.py`, `run_eval.py`); it is not a runtime
dependency of the shipped plugin.

**Reversal path.** If `node` proves less reliable than `python3` in the field, the port
target changes and nothing else does — the gates are ~400 lines behind one library
interface, and the tests are runtime-agnostic in intent.

### D9 — Skills only; no `commands/` directory

**Problem.** The plan specified six commands plus five skills, split by who invokes
them. Current Claude Code has merged commands into skills (C-03), so the split rests
on a distinction the platform no longer draws. The reversal was written into the
currency check but never logged, and the plan still described a `commands/` tree.

**Decision.** The plugin ships `skills/` only — **eleven skills**. The six operator
lanes (`sprint-plan`, `sprint-start`, `fix`, `review`, `triage`, `status`) carry
`disable-model-invocation: true`, which is the deterministic invocation they wanted.
The five harness skills (`safe-pr`, `safe-cleanup`, `red-green-refactor`, `tdd-plan`,
`tdd-ci`) trigger on description as normal.

**Impact.** One directory instead of two. Plugin skills are namespaced
(`/aeo:sprint-start`), which removes the trigger-competition risk that motivated half
the original split. Skill descriptions become load-bearing for the five that trigger on
description — hence the `skill-creator` pass in Phase 6.

### D10 — Stack detection, with no project config file

**Problem.** Three documents disagreed. The assessment said write a stack profile the
scaffold emits once; the plan said detection *replaces* the profile; a later phase
reintroduced "one project config file for what detection cannot infer"; the dispatch
brief said "detection or nothing."

**Decision.** **Detection, no config file.** The commit gate resolves the test command
by walking up from the changed files to the nearest project manifest
(`pyproject.toml`, `package.json`, `go.mod`, `Cargo.toml`, `pom.xml`, …) and reading
its declared test script. Polyglot repos work with no configuration because resolution
is per-change, not per-repo.

**Impact.** A config file is the tripwire-2 case exactly: an option almost nobody sets,
which rots and then lies. Detection also makes the mono-repo and polyglot cases work
for free, which a single repo-level profile cannot. `test-strategy.md`'s existing
detection table (V-08) is the starting point — this is mining the vendored assets, not
new design.

**The escape hatch, deliberately not a file.** When detection cannot resolve a command,
the gate **blocks and says so**, naming what it looked for. It never guesses and never
passes quietly (L-08, "an unset threshold makes a gate silently skip"). If real use
shows a repo detection cannot serve, that is evidence for a config file — and it gets
its own decision then, with the failing case attached.

### D11 — Concurrency: read-only fan-out is unbounded, write actors are capped at four

**Problem.** The assessment recommended shipping read-only fan-out first and treating
parallel implementation as a separate, later decision — "~80% of the benefit at ~20% of
the risk." The plan shipped write concurrency with a cap of four and no read-only lane.
The founder's operating routine is four worktrees for four issues. Nothing was logged,
and a bare "4" in a plan reads as a hand-tuned constant — tripwire 2 against the very
document that defines the tripwire.

**Decision.** Both, in order, and the cap is recorded as what it is.

| Lane | Cap | Isolation | Gates |
|---|---|---|---|
| **Read-only fan-out** (review, research, verification, evidence checks) | none | none needed | n/a — no writes |
| **Development actors** (implementation) | **4** | one worktree, branch and PR each | per actor |
| **Operation workers** (bounded mechanical tasks) | sized by the task | none | once, at the commit |

**On the four.** It is a founder-set operating parameter — the routine is four
worktrees for four issues — not a tuned constant, and it is stated here rather than
buried in a plan so it can be changed in one place. What Phase 5 must *measure* rather
than assume: core oversubscription when four commit gates run a suite at once, and the
merge-order conflict rate.

**Impact.** Read-only fan-out lands with Phase 2 and needs no worktree machinery, so
most of the wall-clock win arrives two phases earlier than planned. Write concurrency
still waits for Phase 1's tested worktree resolution.

### D12 — Plugin state lives in the project repo, never in the plugin root

**Problem.** `${CLAUDE_PLUGIN_ROOT}` is ephemeral — it changes on plugin update
(C-09). Run logs, sentinels and evidence had no assigned home, and the first phase that
writes any of them is Phase 3.

**Decision.**

| State | Location | Why |
|---|---|---|
| Run logs, evidence, plans | the **project repo** (`logs/`, `docs/evidence/`, `plans/`) | it is the founder's work product and belongs under their version control |
| The run-in-progress sentinel (L-02) | the **project repo**, gitignored | must be visible to every session and worktree of that project |
| Cross-project plugin preferences, if any ever exist | `${CLAUDE_PLUGIN_DATA}` | survives update; none are planned |

**Impact.** Nothing is written under `${CLAUDE_PLUGIN_ROOT}`, ever. Settled before
Phase 3 builds the log format rather than after.

### D13 — The auto-format hook is retired, not ported

**Problem.** Four gates were queued for the port. `format` is the only one that never
blocks, the most stack-coupled (hard-codes `ruff`), the one carrying the unfixed
`CLAUDE_PROJECT_DIR` bug (V-03) — and it silently rewrites files in the user's repo
after every Write.

**Decision.** Not ported. Formatting belongs to the project's own pre-commit hook or
CI, where the user chose it.

**Impact.** Phase 1 loses a quarter of its port surface and the plugin stops modifying
files it was not asked to modify. If a formatter is later wanted, it returns as an
opt-in skill, not a silent PostToolUse hook.

**Reversal path.** One gate file plus one `hooks.json` entry; the shared library already
carries the path resolution it would need.

### D14 — The forge and the default branch are detected, not assumed

**Problem.** `block-merge` matches the literal string `main` twice; `settings.json`
matches the MCP namespace `mcp__plugin_github_github__.*`, hardcoded from one observed
install. In a repo whose default branch is `master` or `trunk`, or an install where the
GitHub server is registered under a different name, the merge gate silently no-ops.
Both were listed as portability blockers and owned by no phase.

**Decision.** The gate resolves the protected branch from
`git symbolic-ref refs/remotes/origin/HEAD`, falling back to the local default and then
to `main`, and matches forge tools on a namespace-agnostic pattern
(`mcp__.*github.*__.*(merge|create_or_update_file|push_files|delete_file)`) rather than
one literal server name.

**Impact.** Closes the most likely silent failure for the first external user. Resolution
is cached per invocation, not per session — it is one `git` call in a hook that is
already running `git`.

---

## 2026-07-31 — Seven migration decisions

All seven recommendations in the original assessment were approved by the founder, with
one addition to D1.

### D1 — Port the hooks to Python, in a dedicated directory

> **Superseded in part by [D8](#d8--the-hook-runtime-is-node-superseding-d1s-python).**
> The port stands; the target language is Node. The dedicated-directory addition stands
> unchanged.

**Problem.** All five gate scripts are Windows PowerShell, invoked through a hardcoded
`powershell -NoProfile -ExecutionPolicy Bypass -File` line. On macOS or Linux the
merge-blocking and test-gating silently do nothing — the plugin would appear installed
while enforcing nothing.

**Decision.** Port away from PowerShell. One implementation, not two to keep in sync.
**Founder addition:** the hook scripts get their own dedicated directory rather than
being scattered — `hooks/` at the plugin root, holding all gate scripts and nothing else.

**Impact.** Unblocks D4 and D7; without it, verification gates are meaningless off
Windows. The PowerShell originals stay untouched under `source/` as the reference
implementation.

### D2 — Vendor the upstream `red-green-refactor` repo

**Problem.** The skill instructed the builder agent to clone `brainqub3/red-green-refactor`
from GitHub at runtime. Neither this repo nor the plugin was self-contained.

**Decision.** Vendored at `source/upstream-red-green-refactor/`, commit `593e7ab`
(2026-06-08). MIT licensed, © john-adeojo.

**Impact.** Larger than expected — see "What vendoring upstream revealed" below. The
runtime clone step can be removed.

### D3 — Write our own packaging script

**Problem.** `skill-creator`'s `package_skill.py` emits a bare `.skill` zip and has no
`.claude-plugin/plugin.json` awareness. There was no tooling path to a distributable
plugin.

**Decision.** Write a small packaging script in this repo rather than extending
`skill-creator`.

**Impact.** Forking someone else's tool to add a concept it does not have costs more than
writing ours. It is a manifest plus a zip.

### D4 — The verifier is risk-triggered, not per-slice

**Problem.** An independent verifier on every slice roughly doubles agent cost and applies
full ceremony to typo fixes — the process defect principle 1 rejects.

**Decision.** One risk rubric, shared by EN-12 and EN-13:

| Change touches | Verification |
| --- | --- |
| A contract or spec | Full verification |
| Behaviour covered by an acceptance test | Verification |
| Docs, comments, formatting | Tests only |

**Impact.** One rubric with two consumers, so the verifier and the merge gate cannot
disagree. Must be built before EN-12 and EN-6 have a trigger.

### D5 — GitHub issues are the single source of truth

**Problem.** Issues are already the system of record, but a hand-maintained `TRACKER.md`
also exists. Two records that will disagree, and the hand-maintained one rots first.

**Decision.** Issues remain the record. The tracker becomes a generated view, not a
parallel document.

**Impact.** Mostly already built in production — the SessionStart hook injects branch,
issue and PR state today. Note that in the plugin it does not exist until P1.7 ships it.

### D6 — Spec questions are batched, not blocking

**Problem.** Principle 3 requires founder approval for spec changes while EN-6 makes
concurrency default. Parallel agents each hitting a spec question all stall on the founder.

**Decision.** Agents park the question, continue with everything not blocked by it, and
surface all spec questions together in one briefing.

**Impact.** The founder answers a batch once instead of being interrupted per agent.
Preserves principle 3's approval requirement without serializing the fleet.

### D7 — Principle 5's hierarchy is a default, not a requirement

**Problem.** Subprojects → contracts → phases → stages suits a large product. Imposed on
every project by a general-purpose plugin it is heavy; a small CLI does not need it.

**Decision.** Default for multi-component products; skipped for single-component work.
The plugin suggests the structure rather than enforcing it.

**Impact.** Keeps principle 5 intact where it earns its keep without violating principle 1
everywhere else.

---

## Enhancement disposition

The founder's thirteen proposed enhancements in [`PRINCIPLES.md`](PRINCIPLES.md), graded
against principle 1 (practicality, 80/20) and principle 2 (over-engineering tripwires),
plus three late additions. **EN-*n*** is the stable identifier; use it instead of a bare
number, which used to collide between documents.

**The headline: thirteen proposals are not thirteen units of work.** Six already exist and
need generalizing; three are policy costing near-zero; four are genuinely new engineering.

| ID | Proposal | Already in `source/`? | Verdict | Cost | Phase |
|---|---|---|---|---|---|
| EN-1 | Requirements before stack | ❌ Opposite — Python/`uv`/`pytest`/`ruff` hardcoded | **Build** as detection ([D10](#d10--stack-detection-with-no-project-config-file)) | M | P1.3 |
| EN-2 | Survey existing tooling first | ❌ | **Adopt** — one step in slice planning | XS | 2 |
| EN-3 | Independent review | ✅ dispatches a read-only reviewer in fresh context | **Keep**, and make it a hook (L-01) | XS→S | P1.6 |
| EN-4 | Risk-based test scoping | ✅ `safe-pr` already refuses the full tree | **Keep** — generalize the wording, add L-06's countermeasure | S | 2 |
| EN-5 | Fast lane for surgical changes | ✅ `fix` skill; bounces feature-scale work | **Keep** — generalize | S | 2 |
| EN-6 | Concurrency by default | ⚠️ worktrees exist, no orchestration pattern | **Build**, split by lane ([D11](#d11--concurrency-read-only-fan-out-is-unbounded-write-actors-are-capped-at-four)) | M | 2, 5 |
| EN-7 | Project tracker as source of truth | ⚠️ conflicted with a hand-maintained tracker | **Adopt** — generated view ([D5](#d5--github-issues-are-the-single-source-of-truth)) | S | 6 |
| EN-8 | Preset command per routine task | ✅ six lanes plus five harness skills | **Keep** — see the duplication answer below | S | 2 |
| EN-9 | Orchestrator capabilities | ✅ per-role model pinning already graded | **Document, don't build** | XS | 2 |
| EN-10 | Briefings, not code review | ✅ "Answering the founder" conventions | **Keep** — enforce at the PR boundary | XS | 2 |
| EN-11 | Deterministic evidence | ✅ **strongest asset in the set** — `collect-evidence.mjs` runs tests, copies transcripts, secret-scans, pins links to the evidence commit | **Keep** — generalize beyond CLI transcripts | S | 4 |
| EN-12 | Independent verifier | ❌ | **Build** — highest-value new idea, gated by D4 | L | 4 |
| EN-13 | Verification gates deployment | ⚠️ gates exist, verification does not | **Build on existing gates** | M | 4 |
| EN-14 | Central run logging | ⚠️ `runlog.py` exists, product-specific | **Build** — fixed record envelope | S | 0, 3 |
| EN-15 | Live monitoring | ⚠️ patterns exist wrapped in specifics (V-10) | **Build** — extract the pattern | M | 3 |
| EN-16 | Production data unreachable from tests | ❌ | **Build** — fail-closed (L-02, L-03) | M | P1.5 |

### The `safe-pr` / `review-pr` question, answered

The founder asked whether `safe-pr` and `pr-review-toolkit:review-pr` overlap. **They
don't.** `safe-pr` *produces* the PR — runs the suite, captures transcripts, secret-scans,
generates the body, pushes, opens, stops, never merges. `review-pr` *critiques a diff* —
fans out six specialist agents and aggregates findings. One authors, the other criticizes.
Sequential, not competing: standardize on both.

**The real duplication is elsewhere.** The harness's own `review` skill overlaps
`review-pr`. They differ where it matters:

| | Harness `review` | `pr-review-toolkit:review-pr` |
|---|---|---|
| Spec compliance | ✅ two-stage: spec first, then quality | ❌ no spec awareness |
| Contract-movement justification | ✅ checks the PR body | ❌ |
| Specialist lenses | ❌ one reviewer role | ✅ six specialists |

Keep `review` as the gate — spec compliance and contract-movement checking are
load-bearing for principle 3 and `review-pr` cannot do them. Borrow the specialist lenses
as optional depth for high-risk changes. Standardizing on `review-pr` alone would silently
drop the spec gate.

### Where the 80/20 line falls

**EN-13 needs teeth.** "Proportional to risk" is the clause preventing verification from
becoming ceremony, but undefined it means every change is "medium" and full verification
runs every time. [D4](#d4--the-verifier-is-risk-triggered-not-per-slice) is that rubric,
built from signals the system already has rather than a tuned score.

**EN-6 splits by lane.** Parallel read-only work is safe, needs no coordination, and is
where most of the wall-clock win is. Parallel implementation needs worktree isolation and
is where conflicting edits bite. [D11](#d11--concurrency-read-only-fan-out-is-unbounded-write-actors-are-capped-at-four)
ships them in that order.

---

## What vendoring upstream revealed

D2 was expected to be routine. It changed the shape of the migration.

**The upstream repo is the origin of five of the harness's ten skills** —
`red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-ci`, `tdd-plan` — plus a sixth,
`tdd-harness`, that production dropped.

**All executable code is byte-identical between production and upstream:**

| File | Status |
| --- | --- |
| `safe-pr/scripts/collect-evidence.mjs` | Identical |
| `safe-cleanup/scripts/classify-branches.mjs` | Identical |
| `red-green-refactor/references/test-strategy.md` | Identical |
| `tdd-plan/references/slicing-guide.md` | Identical |
| `red-green-refactor/SKILL.md` | Diverged |
| `safe-pr/SKILL.md` | Diverged |

**Consequence.** Local adaptation lives entirely in SKILL.md prose. The scripts need no
de-Axialing at all. For these five skills, **upstream is already the generalized form and
is the better migration base** — the work is reconciling prose, not rewriting tooling.
This materially shrinks the port in Phase 2. It also reinforces
[D8](#d8--the-hook-runtime-is-node-superseding-d1s-python): the code we are keeping
verbatim is Node.

**Licensing.** MIT, © john-adeojo. Redistribution in the plugin is permitted and requires
preserving the copyright notice and license text. A distribution obligation, not an
optional courtesy (V-14).

**Layout note.** Upstream ships `.agents/skills/` and `.claude/skills/` as a verified
byte-for-byte mirror — one source, two runtime locations. Worth considering if non-Claude
runtimes are ever a target.
