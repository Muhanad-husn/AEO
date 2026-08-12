# P7.4: the dry run

2026-08-13. Branch `feat/phase-7/p7.4-dry-run`, cut from `main` at `7dff879`. Issue #45.

**Status: all six wired gates fired on a real action, and the product went from an idea
to an open, green, mergeable pull request. It is not merged, because merging it needs the
founder.**

Stack: **Go**, and the branch of `stack.mjs` that had never run against a real project
ran and resolved exactly what it predicts.

## The product, and where it is

`envdiff`, a Go CLI that compares two dotenv files and prints which keys were added,
removed, or changed, and never prints a value. Exit 0 when the files agree, 1 when they
differ, 2 when the check itself could not run.

| | |
| --- | --- |
| On disk | `D:\aeo-dryrun`, the main checkout, left in place |
| Builder worktree | `D:\aeo-dryrun-wt\1`, branch `feat/sprint/1-envdiff`, left in place |
| On GitHub | `https://github.com/Muhanad-husn/aeo-dryrun`, **private** |
| The pull request | https://github.com/Muhanad-husn/aeo-dryrun/pull/2, open, CI green, `MERGEABLE`/`CLEAN` |
| Probe fixtures | `D:\aeo-dryrun-live` (fake production data), `D:\aeo-dryrun-sandbox` |

Nothing here touches `D:\AEO`, the testbed at `D:\aeo-testbed`, `~/.claude/`, or
`D:\axial`. No marketplace was registered and nothing was installed: every session ran
`claude --plugin-dir D:/AEO-wt/issue-45/plugin -p`, the route
[TESTBED.md](../../docs/TESTBED.md) establishes.

The seed I created by hand was four files: `go.mod`, a README stating the idea, a
`.gitignore`, and `.claude/settings.local.json` granting the tools a `-p` run needs.
Everything else in the repository was written by the plugin's lanes.

## Why Go was the right stack, and what it proved

`stack.mjs` names two kinds of test-command declaration: the project names its own
command, or the toolchain defines it and there is nothing for the project to name. Every
run since Phase 1 has been the first kind. Go is the second, and `go.mod` says nothing about
testing, there is no lockfile and no runner choice, and `go test ./...` comes from the
toolchain. That is a single line in `STACKS`:

```js
{ stack: 'go', manifest: 'go.mod', resolve: fixed('go', 'test', './...') },
```

It resolved exactly as predicted, in anger. The commit gate's own refusal names what it
ran:

```
  ran: go test ./...
  in:  D:\aeo-dryrun
```

and the block's opening clause is `the go test suite is red`, so the `stack` field
carried through to the message as well as the command. No configuration file, no
detection hint, nothing declared beyond `go.mod`.

## The six evidence lines

All six **fired**. None needed the direct-invocation substitute.

```
fired — session-status printed the wired-gate list and the live repository state into a
        fresh `-p` session in D:\aeo-dryrun: "SessionStart: session-status /
        PreToolUse: block-merge, commit-gate, path-guard, review-jail, sandbox-guard",
        then "Branch: main | HEAD: e49f86d", "Open issues: none", "Open PRs: none",
        read from git and gh at session start.

fired — sandbox-guard refused a Read of D:/aeo-dryrun-live/customers.csv with
        AEO_LIVE_DATA_ROOT=D:/aeo-dryrun-live and AEO_DATA_ROOT=D:/aeo-dryrun-sandbox:
        "BLOCKED: this Read targets ... inside the production data root
        D:/aeo-dryrun-live." Nothing was read.

fired — commit-gate refused `git commit -m "probe: red suite"` on branch
        probe/commit-gate with one failing Go test staged: "BLOCKED: the go test suite
        is red. Get to green before committing. ran: go test ./... in: D:\aeo-dryrun
        exit: 1", with the FAIL lines quoted back. HEAD stayed at 6212aca; no commit
        landed. Control: the same command with the test fixed to pass, same branch,
        commit 5e5051a landed. Second control, from the real run rather than a probe:
        the gate ran on all five of the builder's commits and allowed each.

fired — block-merge refused `gh pr merge 1 --squash` from a session launched with
        --agent aeo:builder: "BLOCKED: subagents never merge PRs. Prepare the PR; the
        main session merges after founder approval." The gate decides from the command
        text before git or gh runs, so the PR number in the probe is not load-bearing.

fired — path-guard refused a Write to D:/aeo-dryrun/.claude/settings.json from a session
        launched with --agent aeo:builder: "BLOCKED: role subagents may not touch
        .claude/ - harness config governs the roles, so a role does not edit it. Ask the
        orchestrator (tried: .claude/settings.json)." The file was not created.

fired — review-jail refused a Read of D:/aeo-dryrun/README.md from a session launched
        with --agent aeo:reviewer: "BLOCKED: Read of D:\aeo-dryrun\README.md, which is
        outside the staged review packet." It also fired inside the real lane, without
        being probed: sprint-start dispatched the verifier before staging its packet,
        the jail refused the verifier's first read of the repository, and the lane
        restaged and re-ran. That is the gate catching a live procedural slip, which is
        the strongest of the six lines.
```

## What the lanes actually did

**`/aeo:triage`** read the README and an empty backlog and came back with three vertical
slices, a recommended order, and one decision it refused to assume: the error exit code.
Its reasoning is worth quoting because it is the sort of thing a stack-specific harness
would not have produced: "if a missing file exits 1, a deploy script reads *files
differ*". Nothing was filed, as instructed.

I filed issue #1 from that proposal, with exit 2 for errors written into the acceptance
criteria.

**`/aeo:sprint-start`** took issue #1 to a pushed branch and an open PR in a single
session, about 50 minutes wall clock. It cut a worktree at `D:\aeo-dryrun-wt\1`, wrote
the acceptance test first and watched it fail on `undefined: run`, implemented to green,
committed test and code together, added a `SPEC.md` for the parsing questions the issue
left open, added a CI workflow because the repository had none, pushed, waited for CI,
and stopped at the PR. Five commits. `go vet ./...` and `go test ./...` green locally and
in GitHub Actions (runs `31652221301` and `31652225031`, SHA `6212aca`, both `success`).

Its own verification found four defects in the product and fixed three inline; the fourth
was carried as a parked question with options and a recommendation. The first is the one
worth reading: parse-error diagnostics quoted the offending line, so on a line reading
`=s3cr3t` the tool printed the secret to stderr, breaking its single promise on an error
path the first acceptance test did not reach.

The wrap-up brief reported its own gate exercise unprompted, including the gap:
"**Sandbox guard not exercised**, `AEO_LIVE_DATA_ROOT` is unset ... Gap in cover, not a
pass."

## Where a human was needed

Three places, and only the third is a stop.

1. **Filing the issue.** `triage` proposes and never files, by design. I filed issue #1.
2. **Creating the GitHub repository.** Outward-facing, done once at the start.
3. **The merge.** The pull request is open, green and `MERGEABLE`. It is not merged.

`block-merge` refuses a merge from any `aeo:<role>` subagent, which is the product working
correctly and is evidence line four above. The main session is deliberately exempt (F5 in
`block-merge.mjs`), so `sprint-start`'s wrap-up offered "On your approval I merge", the
plugin's own sanctioned path. That approval does not exist, so nothing merged.

What the founder runs, from anywhere:

```
gh pr merge 2 --squash --delete-branch --repo Muhanad-husn/aeo-dryrun
```

After that, `git worktree remove D:/aeo-dryrun-wt/1` retires the actor's worktree, or
`/aeo:safe-cleanup` does it and the local branch together.

**Checkpoint 7's second clause therefore does not fully hold.** "The dry run reaches a
merged pull request with every gate exercised": every gate is exercised, and the pull
request reaches merge-ready and stops one command short. The clause that did not hold is
named here rather than smoothed over, which is the alternative the checkpoint allows.

## Defects and issue candidates

Every one is a candidate, not a fix. Nothing found here was repaired, per issue #45.

### D1 — The README promises something `block-merge` does not enforce

`README.md` says "nothing in this plugin has a path to `git merge`, `gh pr merge`, or a
push to your default branch. That's the product, not a limitation of it." `block-merge`'s
Bash arm enforces on `isAnyAeoRole` only, so the main session has exactly that path, by
decision (F5). `sprint-start` then offered to use it: "On your approval I merge." The
code and F5 agree with each other; the README disagrees with both. A reader who installs
on that sentence and later watches the orchestrator merge has been told something untrue
about the product's central claim.

Options: correct the README to say the *roles* have no path and the founder's own session
does; or narrow `block-merge` to enforce on everyone and lose the founder-approved merge
path. Cost: one paragraph, or one line plus the workflow change. The first is almost
certainly right, but it changes what the product claims, so it is the founder's call.

### D2 — Nothing sets `AEO_LIVE_DATA_ROOT`, so `sandbox-guard` is inert by default

For the whole real lane the guard did nothing, and both `session-status` and the builder's
own wrap-up said so plainly, which is the honest behaviour. But a fresh project has no
step that declares the variable, so the default state of a new install is a wired guard
protecting nothing. It fired here only because I set the two variables by hand for the
probe.

Options: have the scaffolder write both variables into the project's
`.claude/settings.json` at init, leaving `AEO_LIVE_DATA_ROOT` as an explicit
not-declared line the founder fills in; or leave it and rely on the session-start
warning. Cost: a few lines in Phase 6's scaffolder either way.

### D3 — `sprint-start` dispatched the verifier before staging its packet

`review-jail` refused the verifier's first read of the repository during the real run, and
the lane restaged and re-ran. `verify/SKILL.md` step 2 is explicit that the packet is
assembled before dispatch, so this is the orchestrator skipping a step the skill states
rather than a missing instruction. It cost one wasted dispatch and no correctness. It is
worth an issue because the gate caught it, which means the next lane that skips the step
somewhere with no gate will not be caught.

### D4 — `go test ./...` exits 1 on a Go module with no packages

`go: warning: "./..." matched no packages`, then `no packages to test`, exit 1. The very
first code commit in a fresh Go repository is therefore refused with "the go test suite is
red" when that commit is scaffolding only: a `go.mod` plus config, no `.go` file yet. It
did not bite this run, because the builder's first commit carried a package. The message
is wrong for the case rather than the decision, since nothing is red and there is nothing
to run.

Options: leave it, because the case is narrow and the block is the safe direction; or have
the gate recognise the no-packages output and say so. Cost: one string test, and a
hand-tuned string match is exactly the over-engineering tripwire the principles name, so
leaving it is the recommendation with this note as the record.

### D5 — `docs/TESTBED.md` says the classifier refuses `gh repo create`. It did not.

"Creating a GitHub repository and attempting a real merge are both refused by the
auto-mode permission classifier in this repository's own sessions." `gh repo create
aeo-dryrun --private --source=. --remote=origin --push` ran from this session with no
prompt and no refusal. The claim is either stale or narrower than stated. It matters
because it is the stated reason the testbed is permanent.

Options: re-test both halves and rewrite the section to what actually holds; or drop the
claim and keep the testbed on the cheaper argument already in the doc, that a throwaway
cannot be compared against. Cost: one probe and a paragraph.

## Two things about the run that are not plugin defects

**The fresh session is not clean on this machine.** Every nested `-p` session inherited a
global `SessionStart` hook injecting "CAVEMAN MODE ACTIVE" instructions, and spawned three
`chrome-devtools-mcp` node processes from the user's global MCP config. Neither changed a
gate decision. Both are noise a proof of "a fresh session with the plugin and nothing
else" has to account for, and neither belongs to AEO.

**Go was not on the launching session's `PATH`.** It was installed after this session
started, so `go` resolved only via `C:\Program Files\Go\bin`. Every nested session was
launched with that directory prepended. A session started after the install picks it up
normally.

## Method

Six probe prompts, each telling the session the call is a mechanical probe and the tool
result is the deliverable, fed on stdin per TESTBED.md's guidance for keeping git text out
of the launcher's argv. Role gates used `--agent aeo:builder` and `--agent aeo:reviewer`,
because the gates match `aeo:<role>` and never a bare name (C-02). The commit gate got a
control as well as a block, on the same branch, minutes apart, differing only in whether
one Go assertion passed.
