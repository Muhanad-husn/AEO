# Checkpoint 7 — Verification

2026-08-13. Branch `checkpoint-7-verification`, cut from `main` at `a054c03`.

**Status: both verify clauses hold.** One of them held only after a later slice
upgraded it, one half of the other came back dirty and is recorded as dirty, and the
primary log for clause 2 states a merge method that the commit contradicts.

This slice reads and judges. Nothing was re-run, nothing under `plugin/` was touched,
and nothing was merged.

## The verify line

> clean install from GitHub into an empty repo; the dry run reaches a merged PR with
> every gate exercised.

| Clause | Result |
| --- | --- |
| Clean install from GitHub | ✅ install and inventory hold; inventory re-checked against the tree |
| …into an empty repo | ✅ fresh `git init` at `D:\aeo-install-proof`, since deleted |
| …uninstall clean | ⚠️ **not clean**, and named rather than smoothed. Orphaned cache, and a clobbered marketplace name |
| Dry run reaches a merged PR | ✅ confirmed against GitHub, not against the log: PR #2, `MERGED`, `a0912e9` |
| …with every gate exercised | ✅ six wired gate scripts, six `fired` lines, one each, all on real actions |

## Clause 1 — clean install from GitHub into an empty repo

The evidence is [P7.3](../2026-08-13-p7.3-clean-install/summary.md), run against `main`
at `f8b6c18`.

### What was checked outside the log

| Claim in the log | Checked against | Result |
| --- | --- | --- |
| `Muhanad-husn/AEO` is private | `gh repo view` today | Private. Confirmed |
| `aeo@aeo` is the right install id | `.claude-plugin/marketplace.json` | Marketplace `aeo`, plugin `aeo`. Confirmed |
| Inventory: 14 skills, 5 agents | `plugin/skills/`, `plugin/agents/` today | 14 and 5. Confirmed |
| "Hooks (2)" is events, not gates | `plugin/hooks/hooks.json` | Two events, six scripts. Confirmed |
| The proof repo was deleted | `D:\aeo-install-proof` | Gone. Confirmed |

### What rests on the log's own narration

The install itself. `claude plugin marketplace add`, `claude plugin install`, `claude
plugin details` and `claude plugin validate --strict` were run once, against a directory
that no longer exists, and their transcripts are quoted in the log and nowhere else. The
installed copy under `~/.claude/plugins/cache/aeo/aeo/0.1.0/` still exists and still
carries the plugin content, which is consistent with an install having happened, but it
does not re-establish the CLI outputs. **This half of clause 1 is reported as narrated,
not re-verified.**

### The one lane, and why it reads differently now than it did then

P7.3 could not fire `commit-gate` from a live session. The outer harness's own auto-mode
classifier refused the command that would have *started* the nested session, so it fell
back to invoking the installed hook directly, and recorded that as the lane.

Under the convention issue #58 set, that is an `invoked` line, not a `fired` one, and #58
is explicit that a checkpoint reporting `invoked` is recording a weaker result than the
run could have got. P7.3 predates #58 by eighteen minutes of commit time, so it is not at
fault. **The gap is closed rather than open**: #58 fired `commit-gate` on a real `git
commit` in a throwaway repository, with a green-suite control, and P7.4 then fired all
six. The clause holds; it holds on later evidence than the slice that first claimed it.

What the direct invocation did establish is worth keeping. The same payload gave two
*different* refusals on `main` and on a feature branch, which shows the installed hook
reading real state rather than refusing unconditionally.

### Uninstall — not clean, re-checked today

The log's residue table is the honest part of that slice. Two entries did not come back
clean, and both were re-checked against the live machine for this record:

| Residue | State today |
| --- | --- |
| `~/.claude/plugins/cache/aeo/aeo/0.1.0/` orphaned after uninstall | **Still present**, still carrying `.orphaned_at`. The log holds |
| `aeo` marketplace registration pointing at `D:\AEO`, clobbered by the GitHub add | **Restored.** `known_marketplaces.json` has it again, source `directory`, path `D:\AEO`, `lastUpdated` 2026-08-12T22:53:54Z |

So the log's closing line, that the founder still needs to run `claude plugin marketplace
add D:/AEO` once, is **stale**. It was done. The registration is back, and the collision
that caused it is now written into [TESTBED.md](../../docs/TESTBED.md) by #58.

The orphan is documented rather than fixed. The README's Uninstall section now names it
and points at `claude plugin prune`, which is the right disposition: the cache belongs to
Claude Code, not to this plugin.

### P7.3's five findings all have a disposition

None are left dangling, and none need re-filing.

| Finding | Disposition |
| --- | --- |
| 1. README does not say the repo is private | Fixed in #57. The Install section now states it and what a non-owner needs |
| 2. "Hooks (2)" reads as four missing gates | Fixed in #57. The gate table carries the note |
| 3. A live session cannot reach `commit-gate` | **Overturned** by #58. A live route exists for all six |
| 4. Uninstall leaves an orphaned cache | Documented in #57, with `claude plugin prune` |
| 5. Marketplace names collide silently | Documented in TESTBED.md by #58, with the restore command |

## Clause 2 — the dry run reaches a merged PR with every gate exercised

The evidence is [P7.4](../2026-08-13-p7.4-dry-run/summary.md), run against `main` at
`7dff879`, on `Muhanad-husn/aeo-dryrun`.

### The merged PR, checked against GitHub

Every load-bearing fact in the log's PR line was re-read from the API rather than taken
from the log:

```
number 2 | state MERGED | base main | head feat/sprint/1-envdiff
mergeCommit a0912e994c72ec6484f65ff034cf436d307142d6
mergedBy Muhanad-husn | mergedAt 2026-08-13T00:09:17Z
```

CI: workflow runs `31652221301` and `31652225031` on `6212aca`, both `success`, plus a
third on the merge commit, also `success`. The log's cited run ids and SHA are correct.
The merge landed ten files including `cmd/envdiff/main.go`, `internal/envdiff/`, tests,
a `SPEC.md`, a CI workflow and the TDD evidence directory. **A real product reached a
real merged pull request.** The clause's first half holds.

The division of labour the log describes also holds, and is the point rather than a
caveat. The lane took the change to open, green and mergeable, and stopped. The founder
merged. `block-merge` refuses a merge from any `aeo:<role>` subagent, which is one of the
six evidence lines, and the main session is exempt by decision (F5).

### Two things the log states that the commit contradicts

Both are narration errors in the record, not failures of the clause.

1. **The merge was not a squash.** The log says "squash-merged … as `a0912e9`" and quotes
   `gh pr merge 2 --squash`. Commit `a0912e9` has **two parents** (`e49f86d`, `6212aca`)
   and the subject `Merge pull request #2 from Muhanad-husn/feat/sprint/1-envdiff`. That
   is a merge commit. A GitHub squash produces a single-parent commit carrying the PR
   title. The repository allows all three methods, so this is not a fallback: the command
   that ran was not the command the log quotes. The SHA, the time and the author are
   right; the method is not.
2. **Five commits, or six.** The log says "Five commits". The PR carries six: `89512d8`,
   `614d2af`, `c36c434`, `ed9dfd0`, `2aaebb2`, `6212aca`. The sixth is `chore: keep the
   generated PR body out of git`, and is the CI head the log itself cites.

Neither changes the verdict. Both are recorded because a log that gets a checkable detail
wrong is the thing a checkpoint exists to catch.

### Every gate exercised — the six, against `hooks.json`

`plugin/hooks/hooks.json` is the authority. It wires **eight entries** across two events,
which resolve to **six distinct gate scripts** plus one inline shell check:

| Wired entry | Matcher | Script |
| --- | --- | --- |
| SessionStart 1 | none | `session-status.mjs` |
| SessionStart 2 | none | inline `node --version` fail-open warning, no script |
| PreToolUse 1 | Bash, PowerShell, Edit, Write, MultiEdit, NotebookEdit, Read, NotebookRead | `sandbox-guard.mjs` |
| PreToolUse 2a | Bash, PowerShell | `block-merge.mjs` |
| PreToolUse 2b | Bash, PowerShell | `commit-gate.mjs` |
| PreToolUse 3 | Edit, Write, MultiEdit, NotebookEdit | `path-guard.mjs` |
| PreToolUse 4 | `mcp__.*github.*__.*` | `block-merge.mjs` again |
| PreToolUse 5 | unmatched, every tool | `review-jail.mjs` |

**Six scripts, six evidence lines, one each, and every line opens with `fired`.** The
count matches and no script is missing a line. Each line names the real action, the
refusal text, and the state that proves nothing happened.

| Gate | Real action | What the line shows |
| --- | --- | --- |
| `session-status` | session start in `D:\aeo-dryrun` | printed the wired-gate list and the live branch, HEAD, issues and PRs |
| `sandbox-guard` | `Read` inside `AEO_LIVE_DATA_ROOT` | refused; nothing was read |
| `commit-gate` | `git commit` with a red Go suite | refused, `ran: go test ./...`, HEAD unchanged at `6212aca`. **Two controls**: the same commit with the test fixed landed, and the gate allowed all five of the builder's real commits |
| `block-merge` | `gh pr merge 1 --squash` as `aeo:builder` | refused before `gh` ran |
| `path-guard` | `Write` to `.claude/settings.json` as `aeo:builder` | refused; the file was not created |
| `review-jail` | `Read` of `README.md` as `aeo:reviewer` | refused. **Also fired unprompted inside the real lane** on the verifier's first read |

The strongest of the six is `review-jail`, and not because of its probe. It caught a live
procedural slip: `sprint-start` dispatched the verifier before staging its packet, the
jail refused the read, and the lane restaged. A gate that catches a mistake nobody was
looking for is the only kind of evidence showing it is reached rather than merely
callable. That slip is filed as **#65**.

`commit-gate` is second, because it is the only one with a control on both sides, on the
same branch minutes apart, differing in one Go assertion.

### What "every gate" does not reach

Two limits. Neither sinks the clause, and both are stated so a later run does not assume
more cover than exists.

- **The inline SessionStart check has no evidence line.** It is a wired hook entry, not a
  gate script, and it prints only when `node` fails to resolve. Checkpoint 5's table
  listed it separately as fired-and-silent. The dry run claims "all six wired **gates**",
  which is accurate to the scripts, and the eighth entry is outside its scope.
- **`block-merge`'s forge arm did not fire in the dry run.** The `mcp__.*github.*__.*`
  matcher is a second, independently wired surface, and P7.4 exercised only the Bash arm
  through `gh pr merge`. That the forge arm fires is **cited** from #58, which fired
  `mcp__plugin_github_github__merge_pull_request` from `aeo:builder` and recorded it in
  TESTBED.md. Cited, not re-run here.

### The stack, which is the other half of what P7.4 was for

`stack.mjs` names two kinds of test-command declaration, and only one had ever run. Go is
the other: `go.mod` declares nothing about testing, and `go test ./...` comes from the
toolchain. Re-checked in the tree today, the whole of it is one line:

```js
{ stack: 'go', manifest: 'go.mod', resolve: fixed('go', 'test', './...') },
```

`go version` on this machine returns `go1.26.5 windows/amd64`, so the toolchain the log
says was installed is installed. The commit gate's refusal quoted back `ran: go test
./...` and opened with `the go test suite is red`, so both the command and the stack name
carried through with nothing declared beyond `go.mod`.

## Open defects at this checkpoint

Filed, none fixed, all from the dry run. Referenced rather than re-filed.

| Issue | What it is | State |
| --- | --- | --- |
| [#62](https://github.com/Muhanad-husn/AEO/issues/62) | README promises no merge path; `block-merge.mjs` F5 exempts the main session | Open. The README's central claim is the one that is wrong |
| [#63](https://github.com/Muhanad-husn/AEO/issues/63) | TESTBED.md says the classifier refuses `gh repo create`; it did not | Open. It is the stated reason the testbed is permanent |
| [#64](https://github.com/Muhanad-husn/AEO/issues/64) | `AEO_LIVE_DATA_ROOT` unset by default, so `sandbox-guard` is inert on a fresh install | Open, deferred to Phase 6 |
| [#65](https://github.com/Muhanad-husn/AEO/issues/65) | `sprint-start` dispatched the verifier before staging its packet | Open |
| [#66](https://github.com/Muhanad-husn/AEO/issues/66) | `go test ./...` exits 1 on a package-less module | Closed, won't fix. A string match is the tripwire the principles name |

**#62 matters most for a stranger.** The README is what a new user reads before
installing, and it currently says something the product does not do.

## One new issue candidate

Not filed here. This slice proposes; the orchestrator files.

> **Title:** P7.4's log records a squash merge; `a0912e9` is a merge commit
>
> `logs/2026-08-13-p7.4-dry-run/summary.md` states the pull request was "squash-merged by
> the founder 2026-08-13T00:09:17Z as `a0912e9`" and quotes `gh pr merge 2 --squash`. The
> commit has two parents, `e49f86d` and `6212aca`, and the subject `Merge pull request #2
> from Muhanad-husn/feat/sprint/1-envdiff`. That is a merge commit, and
> `Muhanad-husn/aeo-dryrun` allows squash merges, so it is not a fallback. The same
> paragraph says "Five commits"; the PR carries six. Correct both lines in the log. The
> merge itself, its SHA, its author and its time are confirmed correct, so this is a
> record fix and changes no verdict.

The remote branch `feat/sprint/1-envdiff` on the dry-run repository still exists after
the merge, confirmed today. Retiring it is `/aeo:safe-cleanup`'s job on the founder's
say-so, and is not a defect.

## What this checkpoint does not cover

- **Checkpoint 6 is open, and that is expected.** Phase 6 is deferred by founder decision
  of 2026-08-12 until the plugin has been used. P7.4 is that usage. Nothing here treats
  the open checkpoint as a finding.
- **The install transcripts are not reproducible.** `D:\aeo-install-proof` was deleted at
  the end of P7.3, per its own instructions. Anyone re-checking clause 1 end to end has to
  run it again.
- **P7.5's migration plan is out of scope.** The verify line says nothing about it. It
  landed in #49 and is unexecuted by design.
- **No lane in the dry run exercised the run-in-progress sentinel or a second actor.**
  Single-actor run. Concurrency is Checkpoint 5's ground and is not re-tested here.
