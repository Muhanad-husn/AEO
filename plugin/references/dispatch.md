# Dispatching work

Writers are capped at four and read-only fan-out has no cap (D11); subagents run in
the background by default and lose tools there (C-07). Everything below follows from
those three facts, and each one has an incident behind it.

## Three shapes of dispatch, and the cap is only on one

**Writers, capped at four.** A writer takes an issue from a failing test to an open pull
request. It gets one worktree, one branch and one pull request, and no more than four run
at once (D11). The four is a founder-set operating parameter, not a tuned constant: the
routine is four worktrees for four issues, which is what one person can read in a day. It
was never measured off a machine or derived from core count, and there is no experiment
that would move it, only the founder deciding to run a sprint differently. A dispatch does
not raise it because the backlog looks parallel, and does not lower it on its own
initiative either. An actor that has reached its pull request and stopped is finished, and
its slot is free. The cap counts writers live at one moment, not writers per day.

**Read-only fan-out, no cap.** Review, research, verification, evidence checks: nothing
writes, so nothing collides, and the number is whatever the question divides into (D11).
This lane needs no worktree, no branch and no coordination. It is where most of the
wall-clock win lives, and it is cheap enough that hesitating over the count costs more than
the calls do.

**Operation workers, sized by the task.** A bounded mechanical chore, a symbol renamed
across eleven files, a number pulled out of forty logs. There is no cap and no default
count: the number of workers is the number of independent units the task divides into. An
operation worker gets **no worktree and no branch**. It shares the checkout it was
dispatched from, which is exactly why it also makes no commit of its own and opens no pull
request. The whole fan-out reaches one commit, made by whoever dispatched the workers after
reading every worker's output. Giving each worker a worktree is the machinery this shape
exists to avoid, and letting each one commit is how four workers become four commit gates
running the suite four times over.

A task belongs to a worker only when it is bounded (what done looks like can be stated
before it starts) and mechanical (no design decision is left inside it). A unit that needs a
test written first, or that produces something a reader should read as a change, is a
writer's issue.

## Collisions, and the file that does not exist yet

Name the files each worker edits or creates before dispatching any of them, and let no two
workers name the same file. Creates, not only edits, and the distinction is the whole point:
two issues once ran concurrently after being checked as touching no common file, both
created the same new module with incompatible content, and it was reconciled by hand. Files
that do not exist yet are still files two workers can collide on.

Where the file set is discovered rather than known, no worker edits the checkout at all.
Each writes its proposed output somewhere of its own and the collecting step applies it. If
two workers propose a change to the same file, stop and do not merge the two proposals by
hand. That is a planning failure surfacing at the safest possible moment, and merging them
produces a change nobody specified and nobody read. Divide the work again and run it again.

A worker that finds its unit is not what it was described as reports that and stops. It does
not widen its own scope.

## Tier, and the second reader

The tier is chosen per slice by the orchestrator and stated in one line: which tier, and
why this slice needs it. No charter pins it and no default carries over from the last
dispatch. A hard slice takes the expensive tier, an easy one the cheap tier, and prose that
is code-grade (a rule, a reference) takes its slice's tier rather than the cheap one.

If a second reader is dispatched, it sits at or above the builder's tier. Two instances of
one model reading one change is a rerun, not a review, and it reads back the same blind
spots that produced the change.

## Writing the prompt, given C-07

Subagents default to background as of v2.1.198, and in the background the available tool set
is filtered to a fixed list. The same agent definition can resolve to different tools in the
foreground and the background, so a tool outside that list is lost silently: no error, no
warning, just an instance that cannot do the thing it was sent to do. There is also no
dispatch-time tool restriction (C-08); tool resolution comes from the definition, and the
only documented per-invocation parameter is `model`.

What that means for a prompt:

- **Check every capability the prompt assumes against the background list**, not against
  what the tool would do in this session. A prompt that says "run the suite and paste the
  output" is a prompt that may come back empty.
- **Carry the context in the prompt rather than expecting the instance to fetch it.** Absolute
  paths, the exact files, the issue text, the constraint. An instance that cannot reach a
  thing cannot ask for it either.
- **State the boundary explicitly**, because the boundary is advice and not a gate: where it
  may write, that it opens no pull request, that merging stays with the founder. A guard
  that stops an out-of-scope write does not stop an instance that never asks.
- **Ask for the result in the reply**, not in a file the dispatcher has to go and find. The
  reply is the one channel that survives the filtering.

## Turning an idea into issues before any of this

Scoping is read-only work, so it costs a fan-out and nothing else. A raw idea becomes issue
proposals by reading the code and the backlog first and sizing against what is there, not
against the idea's own description of itself. A proposal carries its options, one
recommendation and its cost, and the founder decides. Scoping proposes and files nothing;
filing is the founder's checkpoint, and it happens through `sprint-plan`.
