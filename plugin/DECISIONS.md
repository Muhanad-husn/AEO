# Decisions the plugin's instructions depend on

The skills and charters shipped here cite these by id. Each entry carries the rule
and the reason it exists, so a session that has the plugin installed can resolve a
citation without the repository the plugin was built in.

This is not the whole decision log. It carries only the decisions some shipped
instruction cites, and a grader check fails on an entry nothing cites. Decisions
about how the plugin is built, rather than how it behaves once installed, stay in
that repository.

The ids are its ids, unchanged, so the same D24 means the same thing in both places.

## D4 — The verifier is risk-triggered, not per-slice

**Rule.** An independent verification runs when the change's risk calls for it, read
off one rubric. Not on every slice.

**Why.** A verifier on every slice roughly doubles agent cost and applies full
ceremony to typo fixes. That is the process defect the practicality principle
rejects: ceremony bought past the point where it buys anything.

**One rubric, two consumers, one copy.** The `verify` lane and `safe-pr` both read
`${CLAUDE_PLUGIN_ROOT}/skills/verify/references/risk-rubric.md`. Two consumers
holding their own copies agree on the day they are written and drift silently after,
with nothing in either file to say which reading is current. Read the verdict there.
Do not restate the table.

## D5 — GitHub issues are the single source of truth

**Rule.** Issues are the record. A tracker is a generated view of them, never a
parallel document kept by hand.

**Why.** Two records disagree, and the hand-maintained one rots first. A generated
view is wrong only until it is regenerated. A tracker somebody edits is wrong until
somebody notices.

## D6 — Spec questions are batched, not blocking

**Rule.** An agent that hits a spec question parks it, carries on with everything the
question does not block, and the parked questions are surfaced together in one
briefing. Stopping is for a question that leaves nothing else to build.

**Why.** Spec changes need founder approval, and sessions run in parallel. An agent
that halts on the question turns every question into an interruption, and several
agents halting serialize the whole fleet on one person. Batching keeps the approval
requirement and drops the serialization: the founder answers a batch once.

## D8 — The gates are Node, and a gate that cannot start fails open

**Rule.** Every gate runs as `node "${CLAUDE_PLUGIN_ROOT}/hooks/<gate>.mjs"`. Node 18
or newer on `PATH` is a prerequisite, not a nicety, and a session that cannot resolve
it is told so at the start.

**Why.** A hook whose runtime does not resolve exits non-zero but not 2, and Claude
Code treats that as a non-blocking error: the tool call proceeds. The gate does not
fail closed and it does not fail loudly. It fails open, and the install looks
complete while enforcing nothing. Node was chosen over an interpreter that has to be
found by three different names on a Windows machine, one of which is a zero-byte
alias stub. Anything that scaffolds a project checks for node before it writes a
line, for this reason and no other.

## D10 — The project records its test command, and the gate runs it

**Rule.** A project states how it is tested in `aeo-tests.json` at its own directory,
tracked in git: one key, `test`, holding a command line. There is no fallback, no
per-language table, and nothing else in the file: no directory field, because a record
belongs where it sits.

**Amended by [D30](#d30--the-commit-gate-is-deleted-and-block-merge-stops-re-deriving-branch-protection).**
The gate that used to resolve the nearest record and run it on every commit is deleted;
GitHub's required status check enforces a green suite instead. The record is not dead:
`sandbox-guard` still reads it to recognise the project's declared suite as text, so it
can refuse running that suite over a live long job (L-02). Write the record for that
reason now, not because a commit gate demands it.

**Why.** The command is settled by an actor that inspected the repository, chose the
runner and ran the suite. Re-deriving it at commit time is a second guess made in the
one place that cannot ask a question, and it was wrong in both directions: it invented
a 55-minute command for a project whose real one takes 40 seconds, and it blocked every
commit in any language its table had no row for.

Resolution stays per change, which is what makes a mono-repo work with no central
configuration: a change under one package resolves that package's record, not the
root's. A record that is present and unusable is a block, not a reason to adopt the
parent's suite, because a gate that runs nothing and reports OK is worse than no gate.

This is not a config file by the back door. It carries one value that only the project
can know, it has no defaults to rot, and a project with a wrong record finds out on its
next commit.

## D11 — Three concurrency lanes, and the write-actor number lives in one file

**Rule.** Read-only fan-out (review, research, verification, evidence checks) is
unbounded, because nothing writes. Development actors that implement changes are
limited, with one worktree, branch and PR each, and the limit is stated once, in
`${CLAUDE_PLUGIN_ROOT}/skills/sprint-start/references/actor-cap.md`. Operation
workers are bounded mechanical units inside one checkout, sized by the task.

**Why.** The lanes carry different risk. Concurrent readers cannot collide.
Concurrent writers can, which is what the worktree isolation and the limit are for.

The limit is a founder-set operating parameter, not a constant tuned against a
benchmark, so it is written where a founder can change it and nowhere else. A second
copy is a number that can drift out of step with the one that governs, and a test
fails if one appears. Read the value from that file.

## D12 — Plugin state lives in the project repo, never the plugin root

**Rule.** Run logs, evidence, plans and the run-in-progress sentinel are written into
the project repository. Nothing is written under `${CLAUDE_PLUGIN_ROOT}`, ever.

**Why.** The plugin root is replaced on every plugin update. State written there is
state you have chosen to lose. The project repository is also where this output
belongs on its own merits: it is the founder's work product, under their version
control, and visible to every session and worktree of that project.

## D16 — The default branch is resolved from repository evidence, never hardcoded

**Rule.** Resolve the default branch from `origin/HEAD`, then `git config --local`,
then the evidence the repository itself carries: one branch means that is the
default, otherwise exactly one conventional name among `main`, `master` and `trunk`
is. Anything else is unresolved, and unresolved is never a pass. The gate blocks and
names the command that fixes it.

**Amended by [D30](#d30--the-commit-gate-is-deleted-and-block-merge-stops-re-deriving-branch-protection).**
The gate-side implementation of this rule (`lib.mjs`'s `defaultBranch()`) is deleted —
its only two callers, the commit gate and part of `block-merge`, are gone, and GitHub's
branch protection now makes the check this fed. The **principle** stands wherever a
skill resolves the default branch on its own terms — `git symbolic-ref --short
refs/remotes/origin/HEAD`, or `gh repo view --json defaultBranchRef` — never a hardcoded
`main`. `safe-pr`, `sprint-start` and `tdd-ci` all still need this and do it themselves.

**Why.** A literal `main` last resort is the assumption this rule exists to remove.
So is `git config --get init.defaultBranch`, which unqualified reads system and
global scope and is a creation-time preference about the repositories a machine makes
next. It says nothing about the repository in hand.

Both were tried. On a machine whose system config set `init.defaultBranch=master`, a
repository actually on `main` resolved to `master`, and a direct commit of code on
`main` was not blocked. A gate that resolves the wrong branch does not fail loudly.
It stops guarding.

One exemption: a repository with no commit yet has no branch to compare and no
branches to read a default from. Demanding one there would make the first commit in
any new repository impossible, which is over-blocking rather than fail-closed.

## D17 — Two test tiers: the fast tier is the commit gate's, the full tier is CI's

**Rule.** The commit gate runs the project's fast tier on every commit. The
process-level suites run in CI as a required check alongside it. Green locally means
the fast tier. The rest is CI's answer, not a step to repeat.

**Amended by [D30](#d30--the-commit-gate-is-deleted-and-block-merge-stops-re-deriving-branch-protection).**
The commit gate is deleted; nothing runs the fast tier as a local, blocking step any
more. A builder still runs it before committing — that is ordinary practice, stated in
`builder.md`, not a hook — and CI's required status check is what now enforces that the
fast tier reached green, the same way it already enforced the full tier.

**Why.** Almost all of a gate suite's cost is process spawn. Those suites build real
git repositories and spawn the real hook per case, which is exactly what makes them
trustworthy, and it also made the gate cost five and a half minutes of founder
wall-clock per commit. A gate that slow is a gate people work around, and it breaks
the first efficiency rule: fast signal before iteration.

The boundary was placed by measurement. Per-file timings showed a 3.4x step, and the
split follows it rather than following what a file is named.

**What it costs, accepted with its name on it.** A gate regression is then only ever
discovered in CI. The countermeasure is that a change touching a module with outer
contracts either runs those contracts locally or waits for CI green before approval.

**What it is not.** Not a claim that the process-level tests matter less. They are the
ones that catch a gate failing open. They move to where a ten-minute suite belongs.

## D24 — A tier CI has already run on a commit is cited, never re-run locally

**Rule.** No role re-runs a tier CI has already run on a commit in order to establish
that commit's state. The evidence is the CI run, cited by run id, SHA and conclusion.
This binds builders, reviewers, verifiers and whoever dispatches them.

**Why.** The two runs answer different questions. A local run answers *is my
uncommitted work green*, about a tree no CI has seen. A CI run answers *was this
commit green*, and once that answer exists it does not improve by being computed a
second time on slower hardware. The second run is charged to the founder's machine
and wall-clock while other actors compete for it.

The rule existed before it was written down as a decision, in one step of one skill,
and was read past. A rule stated once inside one step carries no reason with it.

**What this does not license.** Skipping the fast tier before a commit. Citing a run
on a different SHA than the branch point, or one that is queued, in progress, or not
green. Nor does a green branch point say anything about the branch's own changes,
which is what the pull request's own check is for.

## D30 — The commit gate is deleted, and block-merge stops re-deriving branch protection

**Rule.** `commit-gate.mjs` is deleted entirely: no local gate blocks a commit on the
protected branch or runs a project's suite before letting one through. `block-merge.mjs`
keeps refusing `git merge`, `gh pr merge`, the forge's own merge action, and local and
remote branch deletion, all judged from a command string alone. It no longer refuses a
push whose refspec resolves to the protected branch, `git push --all`/`--mirror`, or a
forge write (`create_or_update_file`/`push_files`/`delete_file`) targeting the protected
branch.

**Why.** A repository with branch protection configured already refuses every one of
those things server-side: a required status check refuses a merge on a red suite, and
branch protection with `enforce_admins: true` refuses a direct push to the protected
branch, admins included. The deleted checks re-derived that server-side refusal locally,
by resolving a working directory from shell command text, and getting that resolution
wrong cost two defects (#119, #121) — a gate that named the wrong branch as the reason
for a block, and a merge gate that inherited the same class of bug.

**What is unaffected.** `aeo-tests.json` and its resolution in `stack.mjs` — `sandbox-guard`
still reads a project's recorded command to recognise a live sentinel's own suite (L-02),
a concern with no server-side equivalent at all.

**What a project loses.** A repository with **no** branch protection configured has no
local substitute left for the checks this deletes. Configure branch protection; the
scaffolder (`new-project`) already does, at project creation.

## D31 — The record names two tiers, and the doctrine says what a suite may cost

**Rule.** `aeo-tests.json` carries two keys. `test` is the cheap tier — what the inner
loop runs on every green step and a builder runs before every commit. `test_full` is the
exhaustive tier — what CI runs and what `safe-pr` cites. **`test_full` absent falls back
to `test`**, so every record written before the key existed keeps meaning what it meant.
`test_full` present and malformed is a block, in the same direction as every other bad
field in that record.

Alongside the key, `test-strategy.md` §9 gives the harness its first rule about cost:
time one launch of the system under test during detection, install the stack's parallel
runner where that reading is above roughly a second, keep tests that shell out under a
timeout out of a full fan-out, allow several acceptance assertions to read one
session-scoped run through the real boundary, and report a fast tier that has stopped
being fast rather than absorbing it.

**Why.** [D17](#d17--two-test-tiers-the-fast-tier-is-the-commit-gates-the-full-tier-is-cis)
split this repository's own battery into two tiers and every skill has said "the fast
tier" ever since. The shipped record had one key, so the phrase pointed at nothing: a
project reading the doctrine correctly ran its whole suite on every commit, forever.

Two consuming projects measured what that costs, from opposite directions. In one
(issue #128), a Python CLI at its eleventh slice ran 292 tests in 764 s, of which 449 s
was 70 acceptance tests — and a single acceptance test parsing an eight-document fixture
room took 4.24 s against a bare `python -c "import pipeline.cli"` at 4.25 s. The work
under test was free; the interpreter start was the whole bill, multiplied by a test count
that only goes up. Adding `pytest-xdist` and `-n auto` took the suite to 266 s with no
test changed — one dependency and one flag that nothing in the harness suggested.

In the other (issue #127), 7,000 tests of which under 100 launch real subprocesses under
a 180-second cap ran, on the same commit with no code change, at 16 m 24 s failing one
test and 20 m 33 s failing a different pair — every failure a `TimeoutExpired` caused by
the fan-out starving the very processes being timed. With one declared command the only
remedies were raising the cap, which moves the flake, or not running the suite, which
defeats the gates.

**Why the doctrine and not just the schema.** Three correct rules produced this with no
fourth rule about cost: the outer loop must drive the real external endpoint, every
vertical slice adds an acceptance scenario, and the tests should be run constantly. None
of the three is wrong. A project cannot notice at slice 01, when the suite takes twenty
seconds; it notices at slice eleven, when the loop is twelve minutes and the habit is set.
The handbook already says to measure rather than speculate. This applies that rule to the
harness itself.

**What it does not license.** Mocking the boundary, reaching into internal code, or
skipping the fast tier before a commit. Sharing one setup across assertions that are about
the invocation itself rather than about what it produced. Nor a new project splitting the
tiers on day one — a scaffold's suite has nothing to split, and the second key is added
when the measurement says the tiers have diverged.

**What it costs.** A second key someone can get wrong, and a reading someone can skip. The
first is why a malformed `test_full` blocks with a message naming the key rather than
falling back silently; the second is why the measurement sits in `red-green-refactor`'s
step 3 rather than only in a reference nobody opens twice.

## D32 — A harness red gets a couple of minutes; a logic red gets whatever it needs

**Rule.** Classify a red before fixing it. A **logic red** — the behaviour under test is
absent or wrong — is the signal the test exists to produce and carries no time budget. A
**harness red** — a fixture, an import, a path, an encoding, a timeout, a mock's shape, a
runner flag — proves nothing about the product and gets **a couple of minutes**. Past that,
stop debugging the plumbing: inline what the fixture provided, drop to a simpler assertion
through the same boundary, or delete the test and write a smaller one that fails for a logic
reason. Deleting without replacing is coverage laundering and is not available.

**The same harness red twice is one defect in the suite, not two in the tests.** Fix the
shared cause — a fixture layer doing too much, a setup coupling tests, a path assembled
instead of resolved — rather than the symptom N times.

**Why.** `test-strategy.md` §6 already split good red from bad red, then told the agent to
"fix the test/harness until it fails for the intended reason". *Until* was the whole
instruction. Nothing bounded it, nothing said when to stop, and step 11's "on any unexpected
red, shrink the step" applied the same remedy to both kinds — which for a harness red means
the plumbing arrives more often, not less.

The cost was measured the expensive way (issue #130): a redesigned suite produced dozens of
small harness failures, each individually cheap to chase, together a day. None of them said
anything about the product.

Three fixed principles already decided this and were not being applied to test code. 80/20:
more than a couple of minutes on one harness failure is past the acceptance bar, so it is a
process defect. The tripwire "a fix larger than its bug": test plumbing that costs more to
debug than the behaviour it covers is exactly that. Measure, don't speculate: ten occurrences
of one shape is a measurement, and it names a single cause.

**What it does not license.** Deleting a test that is red for a logic reason, however
inconvenient — that budget is deliberately unbounded. Mocking the boundary. Skipping the red
step, which is where the whole discipline lives. Nor is the budget per session; it is per
red, and a second one of the same shape spends its predecessor's finding, not a fresh
allowance.

**Relation to [D31](#d31--the-record-names-two-tiers-and-the-doctrine-says-what-a-suite-may-cost).**
D31 bounds wall clock per run. This bounds debug minutes per red. Same principle — the
harness had no rule about its own cost — different axis, and neither implies the other.

## D33 — A blank declaration in `settings.json` disarms the guard, and beats an exported one

**Rule.** `sandbox-guard` reads `AEO_LIVE_DATA_ROOT` — the declaration — from
`<dir>/.claude/settings.json`'s `env` object, re-resolved on every invocation, not from
`process.env`. Four states: a path in the file arms the guard against it; a **blank** value
in the file is an explicit disarm and does not fall through to the environment; the key
absent, or the file missing, unreadable, or malformed, falls back to `process.env` — the old
behaviour, unchanged. `AEO_DATA_ROOT` — the seam — stays environment-only in every case,
because it must survive a process boundary into a subprocess CLI child. `session-status.mjs`
resolves the declaration through the same path, so the session-start report and the gate
cannot disagree about what is armed.

**Why.** `.claude/settings.json` is a tracked file: a checkout, bisect, or stash cycle changes
what it says without touching a shell that still holds a stale exported value. If a blank
value fell through to the environment, a branch that reverted the file would leave the guard
armed against a value the checked-out commit no longer declares, and nothing could turn it
off — the guard would refuse even the `git checkout` needed to undo the switch. Making the
file the statement of record, where a blank value beats an exported one rather than
deferring to it, means a reverted checkout disarms the guard on its very next call instead of
stranding the session.
