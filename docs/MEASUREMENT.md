# Measuring whether AEO helped

A design, not an implementation. Nothing described here is built, and none of it belongs
in this repository — see [D28](DECISIONS.md). This document names the signals, where each
one comes from, what the mechanism is allowed to say, and what it must refuse to say.

Read [PRINCIPLES.md](PRINCIPLES.md) first if you have not. The over-engineering tripwires
apply here with unusual force: a dashboard nobody opens, a metric nobody acts on, and a
hand-tuned productivity score are all failure modes this design should be read as
forbidding.

## The question, stated honestly

The founder wants to know whether depending on AEO is making a project better off. That
question has no clean answer available, and the design is shaped by why.

**There is no control group.** One project, one operator, no baseline of the same work
done without AEO. Whatever gets built can report *what happened* and cannot report *what
would have happened otherwise*. Every honest use of these numbers is therefore of the form
"here is where time went and where it was wasted", never "AEO saved N hours".

**AEO cannot be the witness.** The run record, `run-monitor.mjs` and the trigger eval are
AEO measuring AEO. They are good instruments for their own questions — is this job alive,
does this description fire — and structurally unable to answer this one.

So the mechanism is a **defect finder**. It exists to surface where AEO wasted time. Only
negative findings are actionable. It has no score, no target, and no green state.

## Where it lives

**In the consuming project's repository**, as a script under that project's own tooling
directory — not in `plugin/`, not shipped, not installed.

Two reasons, and the second is the one people forget. If it ships inside AEO it is AEO's
self-report again, however carefully it is written. And it becomes a thing every installer
inherits: a plugin that measures its users is a different product from a plugin that gates
their commits, and nobody asked for the first one.

The consequence is accepted: each consuming project that wants this copies it. With one
consumer that is not a problem. With three it might be, and at that point the right move is
a separate small tool, not a feature of the harness it is auditing.

## The signals

Five, each with the system that produces it. The rule is that the primary source is
never AEO. AEO's run record appears once, as corroboration, and never alone.

| Signal | What it exposes | Primary source | AEO's role |
| --- | --- | --- | --- |
| **Cycle time** | Issue opened to pull request merged, per issue | GitHub API | None |
| **Rework** | Commits pushed to a branch *after* its pull request opened | GitHub API / git | None |
| **First-push CI** | Did the branch arrive green, or did CI do the finding | GitHub Actions API | None |
| **Gate refusals** | What a gate refused, and whether the refusal was right | Founder's one-line note | Run record corroborates the count |
| **Correction rate** | Work a lane called done that the founder redid by hand | Commits on `main`, or on the branch after approval, authored by the founder | None |

### Cycle time

`issue.created_at` to the merge commit of the pull request that closed it. One number per
issue, no aggregate, no median-of-medians. The useful reading is the tail: which three
issues took ten times the rest, and what did they have in common.

Not a productivity measure. An issue can sit open for a week because the founder was
asleep, and that is not AEO's doing. This is a *sorting* signal — it tells you which issues
to look at, and looking is the actual measurement.

### Rework

Commits on the branch with a timestamp after `pull_request.created_at`. High rework means
the lanes are producing work that does not survive contact with review.

The confound is honest and must be printed with the number: **review comments produce
rework, and that is review working, not the lane failing.** Splitting the two needs the
review thread, so the finding is "these branches carried the most post-PR churn", and a
human decides which kind it was. Do not automate that judgement.

### First-push CI pass rate

Of the first CI run on each branch, what fraction were green. AEO's central claim is that
the test-first lane arrives green because it wrote the test first. This is the cheapest
direct check on that claim, and it comes entirely from GitHub Actions.

A falling rate is the finding. A high rate is not proof the lane works — a project whose
CI runs one trivial job is green by default — so the number is only readable next to what
CI actually runs.

### Gate refusals, and whether they were right

The count of refusals is easy and nearly worthless on its own. A gate that refuses
constantly is either catching a lot or is a nuisance, and the count cannot tell you which.
The half that matters is the judgement, and the judgement is exactly why AEO cannot score
itself.

The cheapest honest collection: **when a gate refuses something, the founder writes one
line** — what it refused, and whether that refusal was correct or in the way. One line, at
the moment it happens, into a plain append-only file. Under a minute a week at the observed
refusal rate.

This is the one signal with a manual component, and it is the one most likely to be
abandoned. If it is abandoned, the mechanism must say so rather than report a stale file as
current — see "Failure modes" below.

### Correction rate

The number that most directly answers the question, and the hardest to collect honestly:
how often the founder had to fix by hand work a lane claimed was done.

The proxy available for free is founder-authored commits landing on `main`, or on a branch
after its approval, that touch files a lane just wrote. It is a proxy and it is wrong in
both directions: the founder also commits ordinary work, and a correction made *before*
approval is invisible to it. Report it as a candidate list to confirm, never as a rate.

## What it must refuse to claim

Written into the tool's own output, not just into this document. A finding that travels
without its caveat becomes a fact.

- **No causation.** No sentence of the form "AEO reduced X". There is no control group and
  there never will be one for this project.
- **No score.** No composite number, no weighting, no index. A single number invites
  optimisation of the number.
- **No green state.** The tool reports findings or reports nothing. "All good" is a claim
  it has not earned; the absence of a detected defect is not evidence of the absence of a
  defect.
- **No trend without a stated window.** Two months is not a trend. Say the window and the
  sample size next to any comparison, or omit the comparison.
- **No AEO-only finding.** Anything sourced solely from AEO's run record is corroboration,
  labelled as such, and is never the basis of a finding on its own.

## What it costs, and the thing that kills it

Near zero per week, or it will be abandoned — and **an abandoned scheme is worse than
none**, because it leaves a stale record that still looks authoritative.

Three defences, all cheap:

1. **The founder's weekly cost is one line per gate refusal.** Everything else is API reads.
2. **The tool prints the age of its own inputs.** If the refusal log has not been appended
   to in three weeks, that is the first line of the output, above any finding.
3. **It runs on demand, not on a schedule.** A scheduled job producing a report nobody
   opens is the dashboard failure mode with extra steps.

## Don't reinvent the wheel

Check before writing anything. The GitHub API plus one script is very likely the entire
mechanism, and everything above is one `gh api` call or one `git log` away. A new
dependency needs founder approval.

Specifically worth checking first: whether GitHub's own repository Insights, or an existing
DORA-metrics action, already produces cycle time and CI pass rate for free. If it does,
this design shrinks to the two signals those tools cannot see — the gate-refusal judgement
and the correction rate — which is the better outcome.

## When to build it

**Not now.** It is only meaningful once a project is actually using AEO, and it is meant to
be built alongside that project rather than before it.

The sequencing constraint is the one part that binds, and it is why this design exists in
advance of any code: the signals it needs — first commits, first pull requests, first
refusals — **cannot be reconstructed after the fact**. The gate-refusal log especially. If
collection has not started by the time the first refusal happens, that refusal is gone.

So the first thing to create in the consuming project is the append-only refusal file. It
costs one `touch`. Everything else reads history that GitHub is keeping anyway.

## The bar this design is subject to

*Measure, don't speculate* cuts both ways. This mechanism is itself subject to the 80/20
bar: **if it cannot be shown to change a decision, it should not exist.** After a quarter
of use, if no finding has changed how a lane is used, how a gate is configured, or what the
founder does by hand, the correct response is to delete it and say so — not to add signals
until it feels worth keeping.
