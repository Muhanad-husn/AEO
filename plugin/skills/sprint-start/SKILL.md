---
name: sprint-start
description: Select the next unblocked sprint issue by its declared dependencies, dispatch the builder to take it test-first from a failing test to green in its own worktree, then prepare the PR and stop for founder approval. Runs one issue, or a group of up to the actor cap with one worktree, branch and PR each. Use when asked to start the sprint, take the next issue, take several issues at once, or continue the sprint.
disable-model-invocation: true
---

# Sprint Start

Takes one issue from selection to a prepared PR. The founder's only
actions are the kickoff brief and the merge approval.

Several issues can run at once, one actor each. The procedure below is
what each actor runs; selection and the briefs for a group are in
[Concurrent selection and dispatch](#concurrent-selection-and-dispatch).

Each session is bookended by two short briefs: a kickoff before any code,
a wrap-up at the pause. Plain language plus the technical detail; keep
both short.

## Procedure

1. **Select the issue.** List open sprint issues. Pick the first whose
   `Depends on:` issues are all closed and which carries no `blocked` or
   `needs-context` label. If two are equally next, put the choice to the
   founder with your recommendation.

2. **Load the context.** Read the issue, its slice plan, and the spec
   section it cites. A missing or stale spec section isn't a stop: the
   builder drafts or corrects it in the branch and the PR shows both.

3. **Kickoff brief** (plain + technical + one-line "done when").

4. **Cut the worktree** from the repository's default branch, unless the
   issue's premise doesn't hold there — e.g. it depends on behaviour that
   only exists on another branch — in which case cut from that branch
   instead and name it and the reason in the PR body:

   ```
   git worktree add -b <branch> <path> <default-branch>
   ```

   First, name anything the project's build needs that a fresh worktree
   won't inherit: a gitignored data directory, local env files, a
   downloaded model or cache. Nothing tracked by git follows a worktree
   add. Most projects have nothing like this and skip straight past it.
   Where something does exist, whatever depends on it runs in the main
   checkout instead.

5. **Dispatch the builder** for the whole slice: a failing acceptance
   test from the spec first, watched red, then the implementation to
   green, test and code committed together. The builder runs its own
   tests locally, the files this slice writes or changes. If the change
   touches a module with outer acceptance contracts, it either runs those
   locally too or the PR waits for CI green before approval is requested.
   The full suite is CI's job either way, and where a step has to establish
   that some commit was green it cites CI's run id, SHA and conclusion
   rather than re-running that tier locally
   ([D24](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). An edit to a pre-existing
   test or spec gets one explanatory line in the PR body. A contested spec
   or design question does not stop the session: park it, carry on with
   everything it does not block, and carry it into the wrap-up brief with
   the options, a recommendation, and what each costs
   ([D6](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). BLOCKED is for a question
   that leaves nothing else to build.

6. **Review when it's warranted.** The founder asks, or the change
   touches a shared, widely-depended-on module, core config, or
   dependency wiring: surface where a defect carries outsized blast
   radius. Otherwise CI plus the founder's PR read is the check.

7. **Prepare the PR** with `safe-pr` and wait for CI green. Where the risk
   rubric calls for verification, stage the review packet — per `verify`'s
   own step 2 — before the verifier is dispatched, never the other way
   round: a verifier dispatched onto an unstaged repository is exactly what
   `review-jail` exists to refuse. The pipeline stops here.

8. **Wrap-up brief, then report and pause.** Post the PR link, report
   `DONE`. The orchestrator merges only on the founder's explicit
   approval, never before and never on its own judgment, then runs
   `safe-cleanup` on the merged branch and removes the worktree.

## Concurrent selection and dispatch

The founder's routine is several issues at once, one actor each. The
procedure above does not change — it is what each actor runs. What
changes is selection, which happens once for the group, and the two
briefs, which cover the group instead of one issue.

The number of actors is capped, and the cap is stated in exactly one
place:
`${CLAUDE_PLUGIN_ROOT}/skills/sprint-start/references/actor-cap.md`. It
is a founder-set operating parameter, not a constant anybody tuned. Read
it there; never type the number, and never raise it because the backlog
looks parallel.

1. **Build the candidate list.** Every open sprint issue whose
   `Depends on:` issues are all closed and which carries no `blocked` or
   `needs-context` label, in the order step 1 would take them one at a
   time. Take the first N, where N is the cap.

2. **Assign each candidate a branch and a worktree path.** One issue =
   one worktree = one branch = one PR still holds, per actor. N actors is
   N branches and N PRs, never one branch carrying N issues.

3. **Run the check before anything is created.**

   ```
   gh issue view <n> --json body -q .body > <dir>/<n>.md    # for each candidate

   node ${CLAUDE_PLUGIN_ROOT}/skills/sprint-start/scripts/plan-actors.mjs \
     --actor <dir>/13.md feat/sprint/13 ../wt/13 \
     --actor <dir>/14.md feat/sprint/14 ../wt/14
   ```

   It reads the cap from the one file that states it, runs
   `${CLAUDE_PLUGIN_ROOT}/scripts/independence.mjs` over the group, and
   asks git which branches and worktree paths are already held. **Read
   the verdict from the exit code — 0 dispatchable, 1 refused.** `NOT
   dispatchable` contains `dispatchable`, so matching on the text sees
   both verdicts as one. Anything on stderr means it could not run at
   all, which is not a pass.

4. **A refusal goes to the founder with the collision, verbatim.** Never
   trim the group down to a subset that passes and dispatch that. The
   report names which two slices collide on which path, and that is the
   thing the founder needs to decide with; a quietly smaller group hides
   it. A candidate whose issue carries no `aeo-independence` block is
   undeclared, not disjoint — get the block written rather than proceed.

5. **One kickoff brief, covering the group.** Every issue, a one-line
   "done when" each, and what the group has in common. Not N briefs.

6. **Cut each worktree and dispatch each actor.** Steps 4 through 7 of
   the procedure, once per actor, each in its own worktree. Where an
   actor's step 7 calls for verification, that actor stages its own
   packet before its own verifier is dispatched — the ordering in step 7
   holds per actor, not once for the group. An actor reporting BLOCKED
   goes to the founder the way a single-issue session does; the rest keep
   going. No actor runs the full battery: each runs the fast tier over
   its own files and leaves the rest to CI. N actors running the whole
   suite at once is N times the machine, for a signal CI is already
   producing once per push.

7. **The gates apply per actor.** A gate that fired once for the session
   has not cleared the others. Each actor's commits meet the commit
   gate in its own worktree, each actor's PR goes through `safe-pr`, and
   evidence is collected per actor. Report gate exercise per actor too: a
   gate an actor never reached is reported as not exercised for that
   actor, never as passing. The reverse reading is just as wrong — a gate
   that printed nothing passed, because a `PreToolUse` gate is silent
   when it allows. Report from the gates named in the session-start
   report and from what an actor's commits did, never from having seen no
   gate output.

8. **The run-in-progress sentinel is shared across worktrees.** A sentinel
   is anchored through the main checkout, so one raised anywhere is
   visible from every linked worktree, and while it stands every actor's
   commit is refused. That sharing is deliberate: the commit gate runs
   the test suite, so `git commit` executes code, and a concurrent
   session's commit gate firing the suite is what killed a four-hour
   pipeline four times. An actor that hits the block waits for the job.
   It does not clear another actor's sentinel and it does not route
   around the gate.

9. **Wrap-up naming every PR.** One line per actor: issue, PR link,
   state. Any actor that stopped BLOCKED is named with what it waits on.
   Every actor's parked questions arrive here together, as one batch the
   founder answers once — not N interruptions. The group is not done
   because most of it is.

## Invariants

- One issue = one worktree = one branch = one PR. Never batch. This is a
  statement about each actor, and it is unchanged when several run at
  once.
- Both briefs happen. No session runs dark.
- Labels (`blocked`, `needs-context`, `done-with-concerns`) reflect
  reality on the issue at all times.
