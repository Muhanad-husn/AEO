# The five rewrites, before and after

Companion to [`summary.md`](summary.md). This file holds the full text of every
`description:` line P6.5 changed, so the write-up can discuss a rewrite without quoting
three hundred characters inline. Nothing outside the `description:` frontmatter line was
touched in any skill, and three of the eight description-triggered skills —
`new-project`, `safe-cleanup` and `safe-pr` — were not edited at all.

The guidance applied is `skill-creator`'s own, taken from
`scripts/improve_description.py`, the script that drives its description-optimisation
loop. Four instructions from that script's prompt shaped every rewrite below:

- **Generalise from the failures to broader categories of user intent.** Explicitly not
  an expanding list of specific queries — that overfits, and the list is injected into
  every prompt. No rewrite below names a case from the eval set.
- **Imperative, and phrased around the user's intent** rather than around what the skill
  does internally. Every rewrite now opens "Use this skill…" and leads with the outcome
  someone wants.
- **Under 1024 characters**, comfortably. The longest below is 814.
- **Distinctive against the other skills competing for attention.** Each boundary clause
  names the neighbour by name, so the judge is told where the prompt goes instead.

`skill-creator` also records that Claude systematically *under*-triggers skills and that
descriptions should be a little pushy to compensate. Three of P6.4's four defects are
under-triggering, which is why three of the five rewrites widen rather than narrow.

---

## `red-green-refactor`

Defect 4: never won `rgr-n2` in fifteen repeats. All three of its trigger clauses
required the founder to supply TDD vocabulary or an existing plan file, so a plain
request to change some code reached it through none of them.

**Before**

> Implement one slice with double-loop TDD — a failing outer acceptance test sets the
> goal, and inner unit-test red, green, refactor cycles build the code that makes it
> pass, worked outside-in until the acceptance test is green. Trigger on a request to TDD
> a slice, write a failing test first, or work through an existing slice plan. Refuses to
> write production code without a failing test written first.

**After**

> Use this skill to build one bounded change in an existing codebase test-first, driving
> it outside-in — a failing acceptance test sets the goal, and inner red, green, refactor
> unit cycles build the code that satisfies it. Use it for any request to implement, add,
> or change behaviour in code that already exists, whether or not the request mentions
> testing, and however many files the change happens to touch; a slice plan on disk is
> welcome but not required. Do not use it when the work has not been broken into pieces
> yet and the user is asking what to build first, when the user wants an existing failure
> diagnosed rather than new behaviour built, or when the job is bulk mechanical editing
> with no behaviour change. Refuses to write production code without a failing test
> written first.

The widening is "whether or not the request mentions testing, and however many files the
change happens to touch". The category is stated rather than the case: `rgr-n2` spans
three files, but the clause says *however many*, so a two-file or nine-file version of
the same request lands the same way. Three boundaries go in alongside it, because
widening a description with no matching boundary is how a fix becomes a regression
somewhere else — the unsliced work goes to `tdd-plan`, diagnosis goes to the `fix` lane
which is operator-invoked and therefore off the roster, and bulk mechanical editing goes
to `worker-dispatch`.

## `worker-dispatch`

Defect 4's other half: it took `rgr-n2` in eight of fifteen repeats. Its exclusion was
keyed on the wrong discriminator. "Implementation work that needs its own branch and
pull request" does not obviously describe adding a column to three classes, so the
exclusion never engaged — while its own body carries the discriminator that does work:
*"If the task needs a test written first, or produces a change someone should review as a
change, it is a development actor's issue."* That sentence was in the skill and not in
the description.

**Before**

> Fan a bounded mechanical task out across operation workers — many subagents writing
> into one checkout, in numbers the task sets, reaching exactly one commit. Use when a
> task divides into independent mechanical units and the question is how many workers,
> what each may write, and where the gates apply. Do not use for implementation work that
> needs its own branch and pull request; that is a development actor, one worktree each,
> and capped.

**After**

> Use this skill for a bulk mechanical chore one agent would otherwise grind through
> serially — fan it out across operation workers, many subagents writing into one
> checkout, in numbers the task sets, reaching exactly one commit. Use it when the work
> divides into many independent, near-identical units with no design decision left inside
> any of them, and the real question is how many workers, what each may write, and where
> the gates apply. Do not use it when the units add or change behaviour, need a test
> written first, or produce something a reviewer should read as a change; that is
> implementation work and it belongs to red-green-refactor however many files it spans.
> Do not use it for feature work that needs its own branch and pull request either; that
> is a development actor, one worktree each, and capped.

Both exclusions are kept — the branch-and-pull-request one still has `wd-n1` to refuse —
and the behaviour-change one is added in front of it. "However many files it spans" is
deliberate on this side too: the skill's own body offers "eleven files, eleven workers"
as a legitimate worker task, so a file count cannot be the discriminator here and stating
one would have been a magic number in a heuristic, which
[PRINCIPLES.md](../../docs/PRINCIPLES.md) names as a tripwire.

## `tdd-plan`

Defect 1, and the largest single wrong-firing in the set: it took `wd-n2` in fourteen of
fifteen repeats. Two causes, both fixed.

"Trigger at the start of new work" is a blanket claim on anything that has not been
started, which is what absorbed a request to *do* a big job. And the pointer at
`/aeo:sprint-plan` was conditioned on "work that needs filed GitHub issues" — a
condition `wd-n2` does not mention, so the pointer never applied to the prompt it most
needed to catch.

**Before**

> Split a new feature, product, or fix into thin, independently valuable vertical slices
> before any code is written, and write one execution plan per slice to disk. Trigger at
> the start of new work, or on a request to slice something up, find the smallest first
> step, or plan test-first. The output plan is the contract red-green-refactor executes
> next. For sprint- or epic-scale work that needs filed GitHub issues, use
> `/aeo:sprint-plan` instead.

**After**

> Use this skill when someone wants work broken down before any code is written — split a
> feature, product, rewrite, or fix into thin, independently valuable vertical slices and
> write one execution plan per slice to disk. Use it whenever the ask is for the breakdown
> itself — slice this up, what is the smallest first step, what order should these go in,
> plan it test-first. The resulting plan is the contract red-green-refactor executes next.
> Do not use it when the user is asking for the work to be carried out rather than
> planned, however large that work is and even when they want it parallelised; that is
> implementation. At sprint or epic scale, where several actors work in parallel or GitHub
> issues need filing, use `/aeo:sprint-plan` instead.

The replacement for "at the start of new work" is "whenever the ask is for the breakdown
itself", which is the intent rather than the timing. The word *rewrite* is added to the
positive list on purpose: `tp-p2` asks to cut a rewrite into steps and must keep firing,
so the boundary against `wd-n2` cannot be drawn on the word rewrite. It is drawn on
planned-versus-carried-out, which is the real difference between the two prompts.

## `tdd-ci`

Defect 2, and the most instructive of the four. `tdd-ci`'s description already contained
the literal phrase "make tests a required check", and it still declined `ci-n1` fifteen
times out of fifteen. A trigger phrase does not survive a body that contradicts it: every
other clause described writing a workflow file, and "make the test job a required check on
main" is shaped like a settings change, not like a file.

The fix is not another trigger phrase. It is to make the required-check outcome part of
what the skill *is for*, which it honestly is — step 7 of the skill proposes the `gh api`
command that promotes the workflow to a required status check — and then to say in as many
words that the file-shaped and settings-shaped asks are the same job.

**Before**

> Once a slice is green locally, detect the stack and write the matching GitHub Actions
> workflow — a unit job plus an e2e or integration job, with artifacts uploaded on failure
> — so the same tests gate every pull request instead of only running on one machine.
> Trigger on a request to add CI, wire up GitHub Actions, or make tests a required check.
> Runs after red-green-refactor and before safe-pr.

**After**

> Use this skill when someone wants their tests to gate pull requests instead of only
> running on one machine — detect the stack, write the matching GitHub Actions workflow
> with a unit job and an e2e or integration job, then propose promoting those jobs to
> required status checks on the default branch. Use it whether the request is shaped like
> a file to write (add CI, wire up GitHub Actions) or like a repository setting to change
> (make the test job a required check, block merges on the suite); both are the same job
> and this skill covers it end to end. Do not use it to diagnose a test that is already
> failing or flaky, or to change repository settings that have nothing to do with the test
> suite. Runs after red-green-refactor, once a slice is green locally, and before safe-pr.

Two things are protected while widening. `ci-n2` — a flaky end-to-end suite that needs
debugging — belongs to the operator-invoked `fix` lane and is now excluded by name.
`np-n3` — "turn on branch protection for this repo" — is a settings change with no test
suite in it, and the second exclusion clause exists entirely for that case: widening
`tdd-ci` toward settings without it would have handed the scaffolder's near miss to the
CI skill. "Once a slice is green locally" moves from the opening to the ordering
sentence; it is a precondition, and leading with it made the whole description read as
something that only applies after a local green run.

## `monitor-design`

Defect 3. The anti-trigger worked — the two questions it names by hand were declined all
fifteen times — but it was calibrated one case too wide and swallowed `md-n3`, a request
to hand over a readout for a named job, on the strength of the word *progress*.

**Before**

> Design a job-specific monitoring overlay for one long-running job — a custom progress
> view, dashboard, or derived reading such as spend so far, pipeline stage, or shards
> left, computed from that job's run log on top of the generic monitor. Use when asked to
> build, design, or add monitoring for a particular job, or when units, rate and the stall
> verdict do not answer what someone needs to know about it. Do not use to check on a run
> in progress: "is it still working", "how far along is it" and "did it stall" are
> answered by running the generic run monitor directly.

**After**

> Use this skill when someone wants a monitoring view built for one particular
> long-running job — a progress readout, dashboard, or derived reading such as spend so
> far, pipeline stage, or shards left, computed from that job's run log on top of the
> generic monitor. Use it on any request to build, design, add, or hand over a readout or
> view for a named job, including while that job is already running, and whenever units,
> rate and the stall verdict do not answer what someone needs to know about it. Do not use
> it for a bare status question about a run — "is it still working", "how far along is
> it", "did it stall" — which want a number read back by running the generic run monitor,
> with no overlay built to answer them.

The distinction the rewrite draws is between a question *about* a run's state and a
request *for* a view of a job. The old anti-trigger was scoped by subject matter — "a run
in progress" — which covers both. The new one is scoped by what is being asked for, and
"including while that job is already running" says outright that a running job does not
by itself disqualify the request. The three disclaimed questions are kept verbatim,
because they were working and L-10's warning about re-rolling applies to the parts that
already pass.

## The three left alone

`new-project`, `safe-cleanup` and `safe-pr` scored 100% recall and 100% precision over
fifteen repeats. There is no defect to aim at, and the whole of L-10's re-roll warning
applies: a one-word change to a description re-rolls every case in the set, including the
ones it currently gets right. Editing them would have been risk with no available upside.
They are unchanged, byte for byte.
