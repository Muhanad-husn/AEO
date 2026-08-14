# Decisions

Settled decisions governing the migration, with rationale and expected impact —
required by fixed principle 3. A decision here is binding until explicitly revisited.
Newest first.

Decisions the plugin's own shipped prose depends on are carried a second time, in
`plugin/DECISIONS.md`, so an installed session can resolve a citation without this
tree. The two move together: revise a decision here and revise its shipped entry in
the same change.

Identifier schemes, kept distinct on purpose: **D*n*** here, **C/V/L** in
[`EVIDENCE.md`](EVIDENCE.md), **EN-*n*** for the founder's proposed enhancements
(below), **DEC-*n*** for the vendored skill's own decisions, quoted only.

---

## 2026-08-14 — One decision from the first real use (#110, #111)

### D29 — The project records its test command; the gate runs it and infers nothing

**Problem.** [D10](#d10--stack-detection-with-no-project-config-file) promised that if a
real project turned up that detection could not serve, that would be evidence for a
config file and would get its own decision, with the failing case attached. #110 is that
case, and it arrived on the first project the gates were installed in.

The commit gate resolved its test command from an eleven-row table in
`plugin/hooks/stack.mjs`. Python has no manifest field naming a test command, so the
table guessed `uv run pytest`. On that project that is 3,528 tests and roughly 55 minutes
against a 570-second budget, where the project's own pre-commit command runs 2,464 tests
in 40 seconds. The gate was installed and unusable in the same session.

Two costs sat behind the one incident. **Language coverage was a promise, not a
property**: a C++, Zig or Elixir project blocked on every commit because the table had no
row for it, and a minitest Ruby project blocked because `rubyCommand` only recognised
rspec. And the table **shipped a compatibility matrix** that had to grow forever.

The deeper problem is that the table was a second detection. By the time a commit fires,
an actor has already inspected the repository, chosen the runner, run the suite, and
could have installed a runner that was missing. The gate discarded all of that and
re-derived a command in the one place that cannot ask a question.

**Decision.** A tracked, project-local record states the command, and the gate runs it.

| | |
|---|---|
| **Where** | `aeo-tests.json`, at each project directory, tracked in git |
| **What** | JSON, one key: `{ "test": "npm test" }` |
| **Who writes it** | the scaffolder at project creation; a builder that changes the test setup, in the same slice |
| **What the gate does** | resolves the nearest record at or above each changed file and runs that command line through a shell |
| **With no usable record** | blocks, naming the exact path to create |

Four properties are load-bearing, and each rules out an easier design.

1. **A command, never a verdict.** The gate still executes the suite, which keeps the
   only protection the table was providing — catching an actor that skipped the tests —
   while dropping the part that cost us.
2. **A string, not an argv array.** Same shape as `scripts.test` and the same shape a
   founder types, so `npm test && pytest` is how a project with two suites says so. That
   replaces the old two-suites-at-one-root case, which is gone: `projectAt` now returns
   one project or nothing.
3. **No `dir` field.** A record runs where it sits, so a mono-repo says "two projects"
   by holding two records. A directory field is the config option nobody sets.
4. **Not under `.claude/`.** `path-guard` refuses a role every write inside that
   directory, and a builder that changes the test setup has to be able to update the
   record.

**Impact.** `LOOKED_FOR`, the `STACKS` table and the per-stack resolvers are deleted.
Every language works, including the ones nobody thought of, because the project answers
for itself. AEO's own repository carries `aeo-tests.json` naming `npm test`, which is
where [D17](#d17--two-test-tiers-in-process-is-the-commit-gates-process-level-is-cis)'s
"the fast tier is `test`" binding now lives.

The honest cost: **the gate now executes a shell string that comes from the repository.**
The substantive trust level is unchanged — the table ran `npm test`, whose body is
`scripts.test` in the repository's own `package.json`, so a repository could already
decide what the gate executed — but the mechanism is stated at the spawn rather than
implied. A stale record is the new failure mode, and it fails loudly: the recorded
command blocks the commit the moment it stops working.

**One thing measured rather than assumed.** With `shell: true` a missing program is not
an `ENOENT` from `spawnSync`; the shell starts and reports the miss as an exit code. On
POSIX `sh` that is 127. On Windows, `cmd.exe` sets `errorlevel` to 9009 but exits **1**
to its parent, so a bare missing program there arrives as a red suite. Both directions
block, and both put `cmd.exe`'s own "is not recognized" line in front of the reader,
which is why the output tail now accompanies every one of these blocks — including the
budget overrun, which previously printed none.

`stack.mjs` keeps its name. It contains nothing about stacks now, but `docs/MIGRATION.md`
and five files under `logs/` name it, and a rename would leave them pointing at nothing
for no behavioural gain.

---

## 2026-08-13 — Two decisions closing the backlog (#106)

### D27 — `v0.1.0` ships, the tag documents rather than pins, and the version has one copy

**Problem.** Three questions arrived together and only make sense answered together: what
number to cut, what a tag on this repository actually promises, and where that number
lives.

**The number is `0.1.0`, not `1.0.0`.** All seven phases are closed and the install path
is proven, but the plugin has been used in anger once — Phase 7's dry run on a Go product.
`1.0.0` is a claim that the skill names, the command names and the hook contract are
stable, and the evidence for that claim is one project. `0.1.0` costs nothing, says the
true thing, and does not foreclose `1.0.0` the moment a second project supplies the
evidence. This is the release number both manifests already carried; cutting it changes no
file, it just makes the number mean something.

**The tag is documentation. `main` is what ships.** `/plugin marketplace add
Muhanad-husn/AEO` clones the repository and reads `.claude-plugin/marketplace.json` from
the **default branch**. It does not resolve tags, and `marketplace.json` has no version
field to resolve one with. So a GitHub release here is a marker for humans and an anchor
for release notes — it pins nothing, and an installer who runs the command the day after a
merge gets that merge.

This is accepted rather than fixed. A solo-operator plugin with one consumer does not need
pinnable installs, and the mechanism that would provide them — publishing built artifacts,
or a release branch the marketplace points at — is a second distribution path to maintain
for a problem nobody has. The failure mode this decision protects against is not an
unpinned install; it is **release notes that imply a guarantee the mechanism does not
give**. The notes and the README both say plainly that installs track `main`. Revisit when
a second project depends on this and wants a fixed version, not before.

**The version has one copy: `plugin/.claude-plugin/plugin.json`.** `package.json` gave up
its copy in the same change. It must not be inferred from git — C-09 records that omitting
`version` from `plugin.json` makes the installed commit SHA the version, so every commit
reads as a new release to whoever installed it — and `package.json` has no such
requirement, because that manifest exists only so the commit gate can detect this
repository's test command (D10) and is `private`, never published. npm asks for a version
when publishing, and this never publishes. `tests/skills/packaging-surface.test.mjs` fails
if a version returns to `package.json` or if `private` is dropped, which is what would make
the omission a real defect rather than a deliberate one.

**No `CHANGELOG.md`.** GitHub release notes serve instead. The issue's own framing was
"one or the other, not both", and a changelog file here would be the second record
[D5](#d5--github-issues-are-the-single-source-of-truth) exists to kill: hand-maintained,
derived from merged PRs that GitHub already lists, and stale the first time somebody
forgets it. The release notes are written for a stranger — what this is, what it installs,
what it needs, what it deliberately does not do — not as a list of PR numbers.

**Impact.** One release exists. One file carries the version. Nothing claims installs are
pinned. The cost is real and stated: a user cannot install a known-good older AEO, and if
`main` breaks, every fresh install gets the break until it is fixed forward.

### D28 — Whether AEO helps a project is measured from outside AEO, and only ever as a defect finder

**Problem.** AEO is now something a project depends on, and nothing answers whether it is
helping that project. The instruments AEO ships are the wrong ones for the question: the
run record, `run-monitor.mjs` and the trigger eval are all AEO measuring AEO. They answer
"is this job alive" and "does this description fire" well, and they are structurally unable
to answer "is this project better off". A harness that scores itself reports that it ran.

**Decision.** The mechanism is designed in [`MEASUREMENT.md`](MEASUREMENT.md) and is bound
by three properties, each of which rules out an easier design:

1. **It lives in the consuming project, not in the plugin.** Shipping it inside AEO makes
   it AEO's self-report again, and makes it a thing every installer inherits whether or not
   they want to be measured.
2. **Its primary signals come from systems AEO does not write.** Git history, the GitHub
   API and CI results are produced by other machinery and are hard for the harness to
   flatter. AEO's run record is admissible as a secondary source and never as the only one.
3. **It is a defect finder, not a scorecard.** It exists to surface where AEO wasted time.
   Only negative findings are actionable, and it makes no causal claim at all.

The third property is forced by a fact that no amount of care removes: **there is no
control group.** One project, one operator, no baseline of the same work done without AEO.
A trend instrument could honestly report cycle time drifting and could not honestly say
AEO caused it, and a number that cannot support a causal claim but is presented next to a
decision becomes a machine for confirming the decision already made. A defect finder is
cheaper, is honest about the same limitation, and produces output somebody acts on.

**Impact.** Nothing is built in this repository. The design names its signals, their
sources, and what it refuses to claim, and it is deliberately buildable in the consuming
project in an afternoon. The sequencing constraint is the part that binds: the signals it
needs — first commits, first pull requests, first refusals — cannot be reconstructed after
the fact, so the design exists now and the collection starts when a project starts.

---

## 2026-08-13 — One decision from Checkpoint 6's follow-up

### D26 — The scaffolder and the status renderer keep an expensive test in CI and a cheap one in the gate

**Problem.** Checkpoint 6's verification recorded that
`tests/skills/new-project-scaffold.test.mjs` and `tests/skills/status.test.mjs` are both
in the integration tier, and that the commit gate runs the fast tier only. Phase 6's two
headline artifacts — the scaffolder and the shared status renderer — were therefore
invisible to the gate. A commit that broke either one passed locally and was caught only
by CI's `battery` job.

The tier placement itself is right, and moving the files is the option to reject. Both
spawn processes: the scaffolder's test writes a tree, runs `git init`, commits, and then
runs the emitted suite; the renderer's test spawns the skill's script against a fake `gh`
in a throwaway repository. That is exactly the cost [D17](#d17--two-test-tiers-in-process-is-the-commit-gates-process-level-is-cis)
moved out of the gate, for the reason D17 gives: a gate that costs minutes per commit is
a gate people work around. Buying coverage by making the gate slow trades a gate the
founder trusts for one the founder bypasses.

**Decision.** Each of the two artifacts carries a test in both tiers, and the two answer
different questions.

| Tier | Scaffolder | Status renderer | Question |
|---|---|---|---|
| Fast (`npm test`, the commit gate) | `new-project-plan-smoke.test.mjs` | `status-render-smoke.test.mjs` | Is this artifact grossly broken right now? |
| Integration (`npm run test:integration`, CI) | `new-project-scaffold.test.mjs` | `status.test.mjs` | Does it behave correctly end to end? |

The fast-tier files read a data file and call pure functions. Neither shells out to `git`,
spawns a process, or touches the network.

**What they cost, with the environment attached**, per D17's standing rule. The two files
run alone take **0.42 s to 1.08 s** wall over five samples, on Windows under Git Bash on a
16-core machine, node 24 — most of it the two `node --test` child processes rather than the
seven assertions, which self-report 0.15 s to 0.48 s. The whole-tier delta could not be
resolved at all: three concurrent write actors were live on the same machine, and the
*unchanged* tier ranged from 8.9 s to 22.0 s across that session, so an 11 s swing sat on
top of a sub-second signal. This is D17's 13x spread happening again, and the honest report
is the isolated cost plus the reason the aggregate one is not quotable today.

**What each smoke test is allowed to assert** is deliberately narrow, because a smoke test
that grows into a copy of its integration counterpart inherits that counterpart's cost and
ends up in the wrong tier. The scaffolder's smoke test asserts that `scaffold-plan.json`
parses and that its declared step order still puts `logs/` ahead of every product-code
step, which is EN-14's requirement and the one ordering property the manifest exists to
hold. It asserts nothing about the emitted tree; that is the integration test's subject.
The renderer's smoke test asserts that `plugin/hooks/status-render.mjs` imports, that the
entry points its two callers use are still exported, and that each produces output against
a literal fixture. It asserts nothing about either caller's process wiring, and it leaves
the unknown-versus-zero distinction to the integration tier, where getting it wrong is a
subtler failure than the module not working at all.

**Impact.** A commit that breaks either artifact outright now fails the gate instead of
reaching CI. The window narrows rather than closes: a correctness regression that leaves
both artifacts loading and parsing still surfaces only in CI, which is
[D24](#d24--a-tier-ci-already-ran-on-a-commit-is-cited-never-re-run-locally)'s shape and
[L-06](EVIDENCE.md)'s accepted cost, unchanged.

`tests/hooks/test-tiers.test.mjs` enforces the pairing. Its existing union check is
satisfied by any placement, so it would accept a smoke file being quietly moved into the
integration tier — which would restore the hole in silence. The added test names each
pair and fails if the smoke file leaves the fast tier or the full test leaves the
integration tier.

**What this does not license.** Adding a fast-tier smoke test for every artifact by
reflex. These two were chosen because Checkpoint 6 found them uncovered and named them
Phase 6's headline artifacts, not because coverage in both tiers is the standard. Nor
does it license the reverse reading: if either integration test ever becomes cheap enough
for the fast tier, this decision needs revising and its smoke test becomes redundant.

---

## 2026-08-13 — One decision from Phase 7

### D25 — The shell merge arm stays role-scoped, and the assumption is written down

**Problem.** Three surfaces merge a pull request from a session, and two are guarded for
every caller. `git merge` is denied by a rule in the founder's own
`.claude/settings.local.json`. The forge's `merge_pull_request` is caught by
`block-merge`'s forge arm, which runs before any identity test. The third is `gh pr merge`
through `Bash`, and it reaches the shell arm, which returns unless `agent_type` matches
`aeo:<role>`. No deny rule names that command. A caller with no AEO identity merges
unopposed.

**What the alternatives cost.** A deny rule on `Bash(gh pr merge:*)` looks cheap if the
founder merges in the web UI. He does not.
`gh api repos/Muhanad-husn/AEO/pulls/{n}` shows the recent PRs merged by the founder's
account, which does not say which client did it; grepping this project's session
transcripts for `"command":"[^"]*gh pr merge` does. Six main-session transcripts dated
2026-08-04 to 2026-08-12 merge this repository's PRs from `Bash`, mostly as
`gh pr merge <n> --repo Muhanad-husn/AEO --squash --delete-branch`, and PR 12's recorded
merge time falls inside its transcript's window. A deny rule takes the merge seat away
from the seat it exists for.
Widening the shell arm to any subagent is what C-02 refuses: `agent_type` is also set on a
main session started with `--agent`, and it carries a bare name there exactly as a plain
subagent does. Nothing in the payload separates the two, so widening buys the gap back by
blocking the merge seat of anyone who starts a session that way.

**Decision.** The shell arm stays scoped to `aeo:<role>`. No deny rule, no widening, and
no new discriminator invented to tell a main session from a subagent.

**The assumption this rests on.** Every caller that should be blocked declares an AEO
role. Writing it down matters because it is already false in one place. `worker-dispatch`
sends operation workers into a shared checkout with `Bash` and no worktree, and the plugin
ships no worker agent, so those workers carry no `aeo:` identity. The same skill forbids
them a commit and a pull request. The one actor the product ships that most clearly must
not merge is the one the gate cannot see, and that is in the product's intended use rather
than in this repository's bootstrapping.

**Impact.** No change to the gate or its tests. The exemption becomes a decision carrying
a named assumption instead of an unexamined consequence of C-02, so a future reader can
notice when the assumption stops holding.

**What this does not license.** Treating the worker exemption as settled. If an operation
worker ever needs gating, the fix is to dispatch it under an `aeo:` identity, which is a
`worker-dispatch` change and leaves C-02 intact. It is not a second identity test in the
gate.

---

## 2026-08-12 — One decision from Phase 5

### D24 — A tier CI already ran on a commit is cited, never re-run locally

**Problem.** P5.3's issue told its builder to run the full battery before starting, to
satisfy the plan's rule against building on a red or untested gate suite. CI had already
run both tiers on `465bff16`, concluded success, and that commit is exactly what the
builder's worktree was cut from. The local run could not learn anything the CI run had
not already established, and it was charged to the founder's machine and wall-clock while
two actors were live on it.

The rule against this already existed. `sprint-start` step 5 says the full suite is CI's
job either way, and `builder.md` says to wait for CI green rather than run acceptance
suites locally. Both were written and then not followed, because a rule stated once
inside one step of one skill is a line an agent reads past. It was also stated nowhere as
a decision, so nothing carried its reason.

**What separates the two runs** is which question they answer. A local run answers *is my
uncommitted work green*, about a tree no CI has seen. A CI run answers *was this commit
green*, and once that answer exists it does not improve by being computed a second time on
slower hardware.

**Decision.** No role re-runs a tier CI has already run on a commit in order to establish
that commit's state. The evidence is the CI run, cited by run id, SHA and conclusion. This
binds builders, reviewers, verifiers and the orchestrator alike. The fast tier stays local
and unchanged: it is the commit gate's tier under [D17](#d17--two-test-tiers-in-process-is-the-commit-gates-process-level-is-cis),
it is cheap, and it covers working-tree changes that exist nowhere else yet.

**Impact.** PR bodies carry a CI citation where they carried a pasted local battery
result. A branch-point claim becomes checkable by a reader in one command instead of
trusted from a transcript. The founder's machine stops running a suite twice while
concurrent actors compete for its cores, which is the measurement P5.5 was scheduled to
take.

**What this does not license.** Skipping the fast tier before a commit. Citing a run on a
different SHA than the branch point, or one that is queued, in progress, or not green.
Nor does a green branch point say anything about the branch's own changes, which is what
the PR's own CI check is for.

---

## 2026-08-11 — One decision from Phase 2

### D23 — The trigger eval moves to Phase 6, where the tuning tool already is

**Problem.** [`PLAN.md`](PLAN.md) puts the trigger eval inside P2.M — "re-run the
trigger eval over the five description-triggered skills" — and then separately gives
Phase 6 a `skill-creator` pass over **the same five skills** for trigger accuracy. Two
phases, one measurement, one set of files. (Five was the count when this was decided.
Phase 3 added `monitor-design`, so the set was six; the decision is unaffected.)

> **Count corrected, 2026-08-13.** Both figures were already wrong when Phase 6 ran, and
> P6.4 caught it by reading the tree rather than the plan. Phase 4 added `verify` as a
> seventh operator lane and nobody subtracted it from the description-triggered side;
> Phase 6 then added the scaffolder to that side. The set P6.4 measured and P6.5 tuned is
> **eight**: `monitor-design`, `new-project`, `red-green-refactor`, `safe-cleanup`,
> `safe-pr`, `tdd-ci`, `tdd-plan`, `worker-dispatch`. The harness derives the split from
> `disable-model-invocation` at run time and refuses to run when a roster skill has no
> cases, so the number cannot silently drift again.

Running it in Phase 2 also measures the wrong moment. A trigger eval scores whether a
description fires when it should. Phase 6 is where descriptions get tuned, so a Phase 2
number is a reading of text that is scheduled to change, and the Phase 6 pass would
re-roll it. L-10 records what that costs: a one-word cosmetic relabel once re-rolled 93
of 176 results.

**Decision.** The trigger eval belongs to Phase 6, run once, against the descriptions
`skill-creator` produces. P2.M keeps only the acceptance grader, which is what the
plugin-shaped rewrite of `grade_repo.py` actually replaces. Approved by the founder at
Checkpoint 2.

**Impact.** Checkpoint 2 closes with no trigger-accuracy number, and that gap is stated
in the checkpoint record rather than left to be noticed. Phase 6 gains the measurement
its tuning pass needs to be judged by, which it did not previously have — the pass was
specified with no before-and-after.

**What this does not license.** Phase 6 may not tune a description and declare it
improved without the eval. A tuning pass with no measurement is the thing principle 6
exists to prevent.

## 2026-08-07 — Two decisions closing Phase 1

Both taken by the founder at the Phase 1 close, in response to costs the phase
actually incurred rather than to costs it might have.

### D20 — Skills are prose, and prose does not get unit tests

**Problem.** Phase 1 ended at 551 tests covering six gates. Phase 2 adds eleven
skills and three agents. At Phase 1's rate that is roughly three times the suite,
and the founder's stated fear at the start of this work was shipping a vast test
estate around a small product. Growth of that shape would realise it.

**Decision.** Only code that executes gets tests. A skill is instructions written
for an agent to read; asserting on its text pins the wording, not the behaviour,
and the wording is the part expected to change. Skills are verified by use.

**Impact.** Phase 2 should leave the test count near where Phase 1 left it. If it
does not, the reason is a real one and worth surfacing rather than absorbing.

**What this does not license.** The gates stay tested. Anything under
`plugin/hooks/` or `plugin/scripts/` is executable and keeps its coverage. A skill
that grows a script grows tests with it.

### D21 — The plugin is never installed into the repository that builds it

**Problem.** An earlier install caused exactly one failure, and it was not a
technical one. Every skill and agent under `plugin/` is a stub whose text states
what still needs building. Loaded into a session, that text reads as a work order.
An agent then continues building the plugin from instructions authored by a
half-built copy of the plugin, and the founder's account of what followed is
"a disaster".

The hazard is inherent to stubs and disappears when Phase 2 fills them. Until
then it is live.

**Decision.** Install only into a throwaway repository, exercise the gates from a
session opened in that folder, then uninstall and delete it. No session working on
`D:\AEO` has the plugin loaded, and no session with the plugin loaded can see
`D:\AEO`.

**Impact.** The wiring gets its first real-world test, which nothing so far has
given it, at no risk to the work. Cost is about ten minutes.

**Open.** Whether installation writes to `~/.claude/`. This repo's rules put that
path off-limits, so if installation is machine-wide rather than per-folder, the
uninstall step stops being cleanup and becomes part of the procedure.

**Closed by the run.** Installation is machine-wide. The marketplace registration
and the plugin cache both live under `~/.claude/`, and `--scope local` scopes only
the enablement flag. Registering and removing a marketplace is therefore part of
the procedure, not cleanup after it. D21 held otherwise: the smoke test left
`D:\AEO` byte-identical.

### D22 — What the first live run of the gates found

The D21 run exercised ten cases against the installed plugin. Recorded here
because the findings outlived the fixture, which is deleted.

**Confirmed working.** All three `cd`-and-delete forms blocked, which is the
command segmenter holding up outside its own tests. `block-merge` and `path-guard`
blocked a role subagent and
stayed clear of the main session, so C-02's identity test is right in both
directions. The commit gate refused a commit on the default branch, and running
the suite red proved it genuinely executes the tests rather than timing out into a
pass.

**Fixed the same day.** The declared production data root was defended against
Bash and open to every file tool: a `Write` created a file inside it unblocked,
and a `Read` of a file inside it succeeded while `cat` of the same file was
refused. The guard's own charter covers reads, so the resolution extended it to
the file tools rather than relaxing the shell side.

**Carried to Phase 2**, in the order they matter:

| Finding | Why it waits |
| --- | --- |
| A shell redirect writes to `.claude/` unchallenged — `path-guard` matches the edit tools, and a role holds Bash | Needs `path-guard` to read Bash redirect targets, which is the segmenter's job and a design question, not a patch |
| `git reset --hard` is ungated, so a role can discard work silently | A new rule, not a gap in an existing one |
| The session-start report names one guard of five | Cosmetic until the roster stops changing |
| `Glob` and `Grep` reach production data | Pinned by a test as a decision. They carry a pattern plus a path, a wider surface than the fix took on |
| `review-jail` and the GitHub merge path were never exercised | The run had no reviewer role and no remote |

**Method note.** The first attempt at this run produced nothing usable: four of
five guards exempt the main session by design, so the checks could never fire, and
the two environment variables the data guard needs sat in a second file the session
was never given. Splitting the instructions is what lost them. One file, and every
check routed through the context where the guard actually applies.

---

## 2026-08-04 — Four decisions from Checkpoint 1

Taken after the seven Phase 1 gates were built, merged and verified together. All
four were approved by the founder at the checkpoint. Three close gaps the build
found; one amends a decision that turned out to carry the assumption it was
written to remove.

### D16 — The default branch is resolved from repository evidence, amending D14

**Problem.** [D14](#d14--the-forge-and-the-default-branch-are-detected-not-assumed)
specified `git symbolic-ref refs/remotes/origin/HEAD`, then the local default, then
`main`. Two of those three steps were wrong, and the build proved it rather than
argued it.

The middle step was implemented as `git config --get init.defaultBranch`.
Unqualified, that reads system and global scope. `init.defaultBranch` is a
creation-time preference about the repositories a machine makes *next*; it says
nothing about the repository in hand.

The consequence was a confirmed fail-open, reproduced end to end on the founder's
machine, whose **system** config sets `init.defaultBranch=master`:

```
actual branch : main   (no origin remote)
defaultBranch() resolves to: master
commit of CODE on main -> exit=0
```

A direct commit of code on `main` was not blocked. That is D14's own failure
inverted. D14 exists because a repo on `master` would silently no-op; this was a
repo on `main` silently no-opping.

The third step was worse in a quieter way. A literal `main` last resort is exactly
the assumption D14 was written to remove, and it survived into D14's own text.

**Decision.** Resolution is `origin/HEAD`, then `git config --local`, then evidence
the repository actually carries: its own branches. One branch means that is the
default. Otherwise exactly one conventional name among `main`, `master`, `trunk`
is the default. Two conventional names, or none alongside several branches,
resolves to **unresolved**.

**Unresolved is never a pass.** Both the commit gate and the merge gate block on it
and name the command that fixes it. That is
[D10](#d10--stack-detection-with-no-project-config-file)'s escape hatch applied to
branch resolution, and L-08's rule that an unset threshold must never make a gate
skip quietly.

One exemption, pinned by a test: a repository with no commit yet has no branch to
compare and no branches to read a default from. Demanding one there would make the
first commit in any new repository impossible, which is over-blocking rather than
fail-closed.

**Impact.** D14's forge-namespace half stands unchanged. Its default-branch half is
replaced by this. The fail-open is closed, verified on the original reproduction:
the same commit now exits 2 on `main` and 0 on a branch.

**Also amended: D14's forge pattern text.** D14 states
`mcp__.*github.*__.*(merge|…)`, which matches `merge` as a bare substring and would
false-positive on a read-only tool such as `get_merge_status`. The shipped gate
anchors the action to the leading verb instead. The matcher stays deliberately
loose, because C-04 makes it a best-effort pre-filter and never the security
boundary; the *gate* is where the narrowing happens.

**Reversal path.** One function in `plugin/hooks/lib.mjs` and its tests. Nothing
else reads branch resolution directly.

### D17 — Two test tiers: in-process is the commit gate's, process-level is CI's

**Problem.** The Phase 1 battery is 449 tests, and almost all of its cost is process
spawn: the gate suites build real git repositories and spawn the real hook per case,
which is what makes them trustworthy.

**The first measurement of this was wrong, and the way it was wrong is worth
recording.** A verification pass reported 17 to 20 minutes across three runs and
concluded the battery exceeded the commit gate's 570-second budget, so AEO could not
pass its own gate. Re-measurement did not reproduce it. The same tree, same tests,
on an idle machine:

| Shell | Runs | Wall clock | Result |
|---|---|---|---|
| Git Bash | 3 | 91 s, 127 s, 173 s | 449 pass, **0 skipped** |
| PowerShell | 2 | 305 s, 353 s | 446 pass, **3 skipped** |
| Original pass | 3 | 1067 s, 1127 s, 1206 s | 446 pass, 3 skipped |

A 13x spread on identical work, tracking the environment rather than the code. The
skip count moves with it: `sh` is on PATH under Git Bash, so the runtime-fallback
tests execute there and skip elsewhere. A suite duration quoted without its
environment is not a measurement, which is L-10's discipline applied to our own
numbers.

**The figure that actually decides this is neither of those.** The only consumer of
the budget is the commit gate itself, and the gate running against AEO takes
**322 seconds**. It fits inside 570 comfortably. So the original conclusion —
dogfooding blocked — was false.

The real problem is the one the spread obscured. Five and a half minutes per commit
fails the plan's first efficiency rule, **fast signal before iteration**. A gate that
passes its budget and still costs five minutes of founder wall-clock per commit is a
gate people work around.

**Decision.** Split the suite. The fast tier is what the commit gate runs, via
`npm test`, because detection resolves that script for a `package.json` project. The
process-level suites move behind `npm run test:integration`, which CI runs as a
required check alongside it.

**The boundary was placed by measurement, not by name.** Per-file timings showed a
3.4x step from 8.1 s to 27.5 s, and the split follows it. The original wording of this
decision said "the in-process library layer is the fast tier" — that names a file which
does not exist. `lib.test.mjs` measured 99.99% process spawn (`defaultBranch` alone is
16.6 s of it), so it sits in the slow tier despite its name. The principle held; the
example was wrong.

A test enforces the split: it reads both npm scripts, lists the test directory off
disk, and fails if the union is not exactly the directory or if any file appears in
both. A test that lands in neither tier is deleted in effect, and nothing else would
notice.

**Impact.** The commit gate becomes a fast signal rather than a five-minute pause,
which is what dogfooding from Phase 2 onward depends on. The cost is L-06's exactly,
and it is accepted with its name on it: a gate regression is then only ever
discovered in CI. The countermeasure is L-06's own, already owned by Phase 2 — a
change touching a module with outer contracts either runs those contracts locally or
waits for CI green before approval.

**A standing measurement rule this produced.** Any duration this project quotes
carries the environment it was measured in. The 13x spread above was invisible for
as long as one environment reported it, and it was caught only because the number
was re-run rather than re-read.

**What this is not.** Not a claim that the process-level tests are less important.
They are the ones that catch fail-open, and three of them did during Phase 1. They
move to where a ten-minute suite belongs.

### D18 — An undeclared production data root is reported, not made mandatory

**Problem.** The sandbox guard (P1.5) compares an effective data location against a
declared one. With `AEO_LIVE_DATA_ROOT` unset there is nothing to compare, so the
guard is inert. The guard that exists because of 19,000 lost documents is one unset
variable from doing nothing.

**Decision.** Unset stays permitted and becomes **visible**. The SessionStart
reporter states whether a production data root has been declared, alongside the
gate health it already reports. The variable is not made mandatory.

**Impact.** A project that has declared nothing has nothing to protect, and
requiring a declaration before anything may run is a config option nobody sets that
then blocks everything — tripwire 2, and the failure D10 rejected a config file to
avoid. Making the absence loud is L-08's answer to the same shape: an unconfigured
threshold is a loud skip, never a quiet pass.

Note the asymmetry that stays: `AEO_DATA_ROOT` unset **while a live root is
declared** blocks. That is L-03's second incident exactly, a lookup falling through
to a default directory.

### D19 — The runtime banner's shell dependency is a known Windows risk, tested live

**Problem.** D8 accepted that a missing `node` cannot be reported by a Node script,
and made the SessionStart banner the mitigation. The banner needs `||`, which needs
a shell, so the entry declares `"shell": "bash"`.

On the founder's machine, outside Git Bash, `bash` resolves to
`C:\WINDOWS\system32\bash.exe` — a WSL stub with no distribution installed, which
fails with `execvpe(/bin/bash) failed`. `sh` is not on PATH at all. Inside Git Bash
both resolve correctly and the mechanism works; its three tests pass there and skip
elsewhere.

So the risk is not that the mitigation is untested. It is that on Windows it may
have no working shell to run in, in which case D8's only mitigation silently does
nothing — a guard advertising safety it does not provide, which is the C-01 shape.

**Decision.** SessionStart is **two entries**, and the remaining question is settled
by **live test against an installed plugin**, not by argument. Until that test runs,
this is a recorded open risk rather than a closed one.

**Impact.** Bounded now; it was not when this decision was first written. `shell`
wraps the whole command, and SessionStart was a single shell-form entry, so the shell
gated the ground-truth report as well as the banner. On a Windows session started
outside Git Bash that entry produced no branch, no HEAD, no issues, no PRs, no run log
and no gate-health banner, while `preflight()` still reported ok because `hooks.json`
parsed and every script was present. The session then opened with memory files and
plan checkboxes as its only status source, which is the L-08 failure the hook exists
to prevent. This paragraph originally claimed the dependency touched only the missing
interpreter case. That was wrong, and the review round caught it.

The report now runs in exec form (`"command": "node"` with `args`, no `shell`), which
no shell can defeat. The documentation confirms `shell` is **ignored when `args` is
set**, so the two cannot be combined in one entry — the split is forced, not
stylistic. The banner keeps `"shell": "bash"` and carries only
`node --version > /dev/null 2>&1 || echo "<banner>"`, so a broken shell now costs the
banner alone, which is the bounded risk this decision always described.

Everything `preflight()` covers still works, since it runs inside Node and needs no
shell: old Node, absent `git`, unset plugin root, missing or unparseable `hooks.json`,
no gate scripts registered, a wired-but-missing script. Only the *totally missing
interpreter* case depends on the shell, and that case also implies Claude Code's own
npm installation is broken.

**Also corrected: `matcher: "*"` was not the fail-open it was reported as.** The
current docs list `"*"`, `""` and an omitted `matcher` as three documented ways to
match every tool, and `"*"` is an explicit special case that never reaches a regex
compiler. `new RegExp("*")` does throw, but the platform never calls it on that value.
The field was removed anyway, on the stronger ground that omission is correct under
every reading including one where the special case is dropped, and because every
shipped first-party plugin matching all tools omits it. The registration test no longer
pins a string; it asserts the entry **fires** for a spread of real tool names, and a
second test asserts every matcher in the manifest is either an all-tools form or
compiles as a regex.

Still open, unchanged: whether `"shell": "bash"` registers and runs at all on a Windows
machine outside Git Bash. The three shell-fallback tests still skip where there is no
POSIX shell, but the skip reason now names D19, so a green run containing that skip
cannot be misread as a green run containing the evidence.

**Reversal path.** If `bash` proves unreliable on Windows, the fallback moves to the
exec form and the missing-interpreter case becomes unreported by design, documented
in the README as a prerequisite rather than mitigated by a banner.

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

**Residual gap, recorded rather than closed.** No runtime check proves the lanes
are absent from the model-invocable set. `disable-model-invocation` is confirmed as
the correct key — it is the only spelling present anywhere in the local plugin cache,
and a shipped first-party plugin uses it — and it is present on exactly those lanes.
That is the strongest evidence available without a live negative test.

> **Partly closed, 2026-08-13.** There were six lanes when this was written; there are
> seven. P6.4's trigger eval is the live negative test this paragraph said did not exist:
> it derives the description-triggered roster from `disable-model-invocation` at run time
> and scores whether each description fires, so a lane that leaked into the model-invocable
> set would show up as a skill firing on prompts it should never see. It is a measurement
> rather than a gate, so the gap is narrowed, not shut.

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

> **Counts amended; the decision is unchanged.** `skills/` only, and the operator
> lanes still carry `disable-model-invocation: true`. The inventory below is Phase 0's.
> The plugin now ships **fifteen skills** and **seven operator lanes**: Phase 3 added
> `monitor-design`, which triggers on description and is deliberately not a lane; Phase
> 4 added the `verify` lane, the seventh, deterministic like the other six because the
> risk rubric decides whether a verification runs, not a phrase in a message; Phase 5
> added `worker-dispatch` and Phase 6 added `new-project`, the scaffolder, both of which
> trigger on description. That leaves eight on the description side against the seven
> lanes. `evals/grade-plugin.mjs`
> grades both numbers — `EXPECTED_SKILL_COUNT` and `OPERATOR_LANES` — and records where
> each part of the count comes from. That is the copy to read when they move again.

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

> **Superseded in part by [D29](#d29--the-project-records-its-test-command-the-gate-runs-it-and-infers-nothing)
> (2026-08-14).** The escape hatch below promised that a real project detection could not
> serve would be evidence for a config file and would get its own decision with the failing
> case attached. #110 was that case. Detection is gone; the project records its test command
> and the gate runs it. What survives here is the block-never-guess direction and per-change
> resolution.

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
