---
name: worker-dispatch
description: Fan a bounded mechanical task out across operation workers — many subagents writing into one checkout, in numbers the task sets, reaching exactly one commit. Use when a task divides into independent mechanical units and the question is how many workers, what each may write, and where the gates apply. Do not use for implementation work that needs its own branch and pull request; that is a development actor, one worktree each, capped at four.
---

# Worker dispatch — operation workers

Two lanes write to a repository, and they are not the same thing.

| Lane | How many | Isolation | Gates |
| --- | --- | --- | --- |
| Development actor — implementation | four at once | one worktree, branch and pull request each | per actor |
| Operation worker — a bounded mechanical task | sized by the task | none | once, at the commit |

This skill is the second row. A development actor takes an issue from a failing
test to an open pull request and needs the whole machinery. An operation worker
renames a symbol across eleven files, or reads forty logs and extracts one
number from each. Giving each of those a worktree is the machinery this lane
exists to avoid, and letting each commit is how four workers become four commit
gates running the test suite four times over.

## Which lane a task is in

An operation worker's task is **bounded** — you can state what done looks like
before it starts — and **mechanical** — no design decision is left inside it. If
the task needs a test written first, or produces a change someone should review
as a change, it is a development actor's issue and belongs in that lane.

## Count and model tier come from the task

There is no cap and no default count. The number of workers is the number of
independent units the task divides into: eleven files, eleven workers; forty
logs, forty. If you cannot say what each worker gets before dispatching, you do
not have a worker task yet — go back and divide it.

Tier the same way, per worker, by whether the unit needs judgement. A textual
substitution with a stated pattern is the cheapest tier. A unit where the worker
has to decide which of two forms applies is a middle tier. A unit needing real
judgement is not mechanical and belongs in the other lane. Workers in one run
need not share a tier.

## The fan-out

1. **Open a run.** One run for the whole fan-out, not one per worker.

       dir=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs" open --job <name>)

2. **Claim a scope per worker, before dispatching any of them.** This is the run
   log's run directory with `workers/<id>/` beneath it, so it is derived from the
   run rather than invented:

       node "${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs" worker --dir "$dir" --worker w1

   It prints the directory and refuses an id already claimed in this run. Claim
   all of them here, in the orchestrator, and hand each worker the path it got.
   A worker being retried gets a new id, not the dead one's directory.

   **If a claim is refused, do not dispatch that worker.** A refusal means the id
   already belongs to someone else in this run, so dispatching anyway is how two
   workers end up on one directory — the thing the claim exists to stop. Fix the
   id and claim again, or drop the worker. Never carry on past a refusal.

   Keep ids plain: letters, digits, dashes. An id with a leading or trailing
   space is refused, because the path it prints stops surviving a shell round
   trip and reads back as another worker's. Avoid `NUL`, `CON`, `AUX` and `COM1`
   as well — those claim successfully on Windows and leave directories ordinary
   tools then refuse to delete.

3. **Dispatch, each worker carrying: its unit, its scope path, and the rule that
   it writes nowhere else.** A worker resolves any path it wants to write:

       node "${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs" worker --dir "$dir" --worker w1 --path notes/found.md

   That prints a path inside the scope and creates its parent. A path resolving
   anywhere else — a sibling worker's directory, an absolute path, a climb out
   of the run — is refused rather than quietly moved back inside.

4. **Have each worker record its unit as it finishes.**

       node "${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs" record --dir "$dir" --job <name> --unit w1 --status ok

   All workers append to one `run.jsonl`, one whole line per record, so the run
   reads as one run. Order between workers is not guaranteed and nothing should
   depend on it.

5. **Collect, check, then commit once.** Read every worker's scope and its
   records before committing anything. A worker that recorded a failure, or
   produced nothing, is a result to act on and not a line to skip. Then make
   **one** commit for the whole run, and close the log:

       node "${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs" close --dir "$dir" --job <name> --status ok

## What a worker may not do

- **No worktree and no branch.** Workers share the checkout they were dispatched
  from. That sharing is the reason for the rest of this list.
- **No commit of its own, and no pull request.** The run reaches exactly one
  commit, made after the collection step, by whoever dispatched the workers.
- **No write outside its run-scoped path**, with one exception, below.
- **No plan change.** A worker that finds its unit is not what it was described
  as reports that and stops. It does not widen its own scope.

The exception is the edit the worker was assigned. If the plan names the files
each worker **edits or creates**, and no two workers name the same file, a worker
writes those files in place and everything else it produces — notes, extracted
values, proposed text, anything it wants to hand back — goes in its scope.

Creates, not just edits, and the distinction is the whole point. Two issues once
ran concurrently after being checked as touching no common file; both then
created the same new module, with incompatible content, and it was reconciled by
hand. A plan that names every edit while leaving workers free to create an
incidental helper or test file reproduces that exactly. Files that do not exist
yet are still files two workers can collide on.

If the plan **cannot** name them in advance, because the file set is discovered
rather than known, then no worker edits the checkout at all: each writes its
proposed output into its own scope, and the collection step applies it. When two
workers propose a change to the same file, **stop and do not merge them** — that
is a planning failure surfacing at the safest possible moment, and merging two
proposals by hand in the middle of a fan-out produces a change nobody specified
and nobody reviewed. Re-divide the work and run it again.

## Gates apply once, at the commit

The workers write; the single commit at the end passes the same commit gate
every other change does, and the test suite runs once for the whole run.

That commit is subject to the run-in-progress sentinel like any other. Because
the commit gate runs the test suite, committing executes code, and a commit
fired alongside a live long-running job is what killed a four-hour pipeline four
times over. **A batch of mechanical work is not an exception to that rule.**

So a worker run started while a sentinel is live behaves this way: the workers
are dispatched and write into their scopes normally, because writing files
executes nothing, and then the commit at the end is blocked until the long job
finishes and its sentinel clears. The work completes and waits. Check the
sentinel before you start a fan-out you need committed promptly:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/run-sentinel.mjs" list

A worker run raises no sentinel of its own. It is not a long job, and if it
raised one it would block every other session's commits for the duration of a
batch of mechanical edits.

## Invariants

- One run, one commit. Two commits mean the fan-out was two runs, or a worker
  committed and should not have.
- Every worker has a path no other worker in that run has, and got it from the
  run rather than by convention.
- The scope resolver refuses an out-of-scope path; it does not stop a worker
  that never asks. The rule above is what covers that, and it is stated to every
  worker at dispatch, not assumed.
- The resolver compares paths as text, so a symlink or junction planted inside a
  scope points out of it and resolves as in-scope. Planting one is already a
  write the rules forbid, and this is the shape that limit takes on disk.
- Count and tier are properties of the task, recorded with the run. A number
  carried over from the last fan-out because it worked then is not a decision.
