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
