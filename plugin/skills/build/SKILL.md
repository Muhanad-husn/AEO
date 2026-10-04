---
name: build
description: What this shop wants from a change to code that already exists - a bug, a small fix, a rename, a config or dependency tweak, a behaviour a slice plan names. Use it whenever the work is changing an existing codebase, whether or not the request mentions tests, and however many files it turns out to touch. Not for deciding what to build first, and not for a codebase that does not exist yet.
---

# Build

Changing code that exists. What follows is what this shop wants and the incident
behind each want. It is not a sequence, and nothing here is a step.

## A test goes red first when behaviour moves

When the change moves behaviour a user or a caller can see, there is a test that
fails for that behaviour before the code that makes it pass. The test is watched
failing, and the reason it fails is said out loud. A test nobody watched fail is
a test nobody knows the shape of.

Red is committed. That is deliberate and it has a history: the first build shipped
a `.claude/allow-red-commit` flag file that disabled the tests-green gate, dormant
but one `New-Item` from live (V-01 in docs/EVIDENCE.md).
The escape hatch was deleted. Committing the red test openly is what replaced it,
because an escape hatch exists only where the honest path is blocked.

## When behaviour does not move, the existing suite is the oracle

A rename, a config tweak, a dependency bump, a refactor: no new test. The suite
that is already there is what says the change was neutral. A refactor that reddens
the bar gets reverted rather than fixed forward.

## The fast tier locally, CI for the rest, and the gap is known

`aeo-tests.json` names two tiers ([D31](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). The
cheap one runs on every green step and before every commit. The exhaustive one is
CI's, and a CI run already green on a commit is cited, never repeated locally
([D24](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)).

The gap this leaves is measured, not assumed. L-06 in docs/EVIDENCE.md: an
acceptance-level regression was invisible locally because the fast tier does not
run the acceptance directory, so acceptance breakage is only ever found in CI. The
countermeasure that came out of it holds here. A change touching a module with
outer acceptance contracts either runs those contracts locally or waits for CI
green before approval is asked for.

If the fast tier has stopped being fast, roughly thirty seconds and judgement
applies, that is a finding for the pull request body, not a delay to absorb.

## Two attempts per shape

A fix that fails twice is not tried a third time the same way. The third attempt
changes the shape, or stops and says the method is wrong. That report is the
deliverable, not an apology.

The same rule sorts reds by what they cost. A logic red, where the behaviour is
absent or wrong, gets whatever time it needs; that is the work. A harness red -
an import, a fixture, a path, an encoding, a timeout, a mock's shape - gets a
couple of minutes, after which the fixture is inlined, the assertion simplified,
or a smaller test written ([D32](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). The same
harness red twice is one defect in the suite, not two in the tests.

Deleting a test without a smaller replacement that fails for a logic reason is
not one of the available moves.

## Git state is settled by the builder, before and after

Before starting an issue and before finishing it, the building agent looks at
branches, worktrees and unstaged files and settles them itself. The founder was
writing "check the git i suspect a stale branch or work tree" and "decide over the
changed unstaged files" mid-session (#239). A worktree whose branch is merged is
removed. A merged branch is named in one line for the orchestrator to delete,
because `block-merge` keeps branch deletion with the orchestrator. An unmerged stale
branch or worktree is reported in one line and left alone. Unstaged files are
sorted: its own work is committed, generated output is ignored or cleaned, and a
file it did not touch is left alone and named in one line. The founder is asked
only when git history cannot tell whose a file is.

A project that declares `AEO_WORKTREE_LINKS` in `.claude/settings.json` has git-ignored working data (such as `data/` and `runs/`) that exists only in the main checkout, so after `git worktree add` the builder runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-links.mjs" link <worktree>`, and a run slice names its run ids with the issue number. Before `git worktree remove` it runs the same script with `unlink`, because removal follows a link and deletes the data behind it: never remove a worktree that still holds a link, and never `rmdir /s` or `Remove-Item -Recurse` one before unlinking.

## A small fix goes straight to a pull request

No planning ceremony for a fix-sized change. One worktree, one branch, one pull
request, and the founder merges. A change that turns out to touch a shared module
or core dependency wiring has stopped being fix-sized and is planned instead.

Commits are small, green, and Conventional. A spec the change contradicts is
updated in the same branch.

## The number this is aimed at

`D:\RLM` ran phases 0 to 5 in four days for $3.50 across 48 merged pull requests,
under one hook and two skills. The same product under the first build's lanes took
sixteen days and $20.58 over 122 pull requests and produced no graded report
(PLAN.md section 4a). Everything above is what survived that comparison. A want on
this page that costs a consumer days or dollars is wrong and gets deleted.
