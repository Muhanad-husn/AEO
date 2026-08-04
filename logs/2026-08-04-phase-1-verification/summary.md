# Phase 1 verification — Checkpoint 1

2026-08-04. Branch `phase-1/integration`.

The last two Phase 1 slices merged, the last two gates wired, and PLAN's Phase 1 verify
line executed clause by clause on an idle machine.

## What landed here

| Change | File |
| --- | --- |
| `feat/phase-1/p1.5-sandbox-guard` merged, one conflict resolved | `plugin/hooks/commit-gate.mjs` |
| `path-guard` wired: a new `^(Edit\|Write)$` PreToolUse group | `plugin/hooks/hooks.json` |
| `sandbox-guard` wired: one more hook in the existing `^Bash$` group | `plugin/hooks/hooks.json` |

No gate code was written in this slice, and no test was changed. Both were out of scope
by design: a resolution that needs a test edited is a wrong resolution.

## The conflict, and why both sides survive untouched

Two branches edited `commitGate`. The fix batch made an unresolvable default branch a
block. P1.5 inserted the run-in-progress sentinel check immediately before
`resolveTestPlan` and deliberately after the documentation-only return.

**The conflict was entirely in the import block.** Both branches rewrote the
`./lib.mjs` import line: the fix batch expanded it to a multi-line form to add
`DEFAULT_BRANCH_UNRESOLVED`, and P1.5 added a `./sentinel.mjs` import next to it. Git
saw one region and two rewrites. The function body merged with no conflict at all,
because the two edits are twelve lines apart and touch different statements.

Resolution: the fix batch's multi-line `./lib.mjs` import, then P1.5's
`./sentinel.mjs` import, then `./stack.mjs`. Nothing else changed.

**The ordering each slice reasoned about is intact.** In `commitGate` the sequence is
now: worktree resolution, then the branch arm (unresolvable-branch block, then the
protected-branch block), then the changed-file set, then the documentation-only return,
then the sentinel check, then detection, then the suite.

### The one real interaction between them

The two blocks are on the same path and the branch arm is first, so a repository that
is both ambiguous about its default branch **and** holding a live sentinel reports the
branch problem and never mentions the run. Both are exit 2, so no call is let through
and nothing fails open. What it costs is one round trip: fix the branch, retry, then
learn about the sentinel. The alternative ordering costs the same round trip in the
other direction, so this is a reporting-order note rather than a defect.

The second interaction is the one P1.5 designed for and it survives: a documentation-only
commit returns before the sentinel check, so notes written during a four-hour run still
commit. Verified live, not only in the unit battery.

## `hooks.json`

Five gates, seven script references, all exec form, no `||` on any gate.

```
SessionStart                  session-status.mjs        shell:bash, || banner, timeout 20
PreToolUse  ^Bash$            sandbox-guard.mjs         timeout 10
                              block-merge.mjs           no timeout
                              commit-gate.mjs           timeout 600
PreToolUse  ^(Edit|Write)$    path-guard.mjs            timeout 10
PreToolUse  mcp__.*github.*__.*   block-merge.mjs       no timeout
PreToolUse  *                 review-jail.mjs           timeout 10
```

Both registration tests that were skipping now arm and pass, and nothing in the battery
skips for want of a manifest entry any more.

### Ordering inside `^Bash$`, and what it is worth

The group is written cheapest first: `sandbox-guard`, `block-merge`, `commit-gate`.

**Order is not a safety property.** Claude Code runs the hooks matching an event
concurrently, so array position does not decide which gate reaches a verdict first, and
nothing here may be built on the assumption that it does. Concretely: `sandbox-guard`
blocking a live-sentinel session does **not** stop `commit-gate` from starting the
suite in the same tool call. The thing that stops it is `commit-gate`'s own sentinel
check, the fourteen lines P1.5 added. That is the whole justification for those lines
existing in a second gate, and it is only visible once both are wired.

What the order does buy is the founder's reading order if a group is ever walked in
sequence, and it keeps the guard whose failure mode is data loss ahead of a gate that
may spend 570 seconds running tests.

## The verify line, clause by clause

> the unit battery passes; live block-and-pass cases for every gate; a Python repo and a
> Node repo each detect and run their own test command; a repo on `master` blocks
> correctly; the sandbox guard blocks a run pointed at production data and a commit
> attempted while the sentinel is set; the review-jail blocks a reviewer `Grep` and
> allows the staged `Read`; a deliberately broken runtime produces a loud banner, not a
> quiet pass.

Twenty-nine live checks were run out of process against the real hook files, each
spawned as a process with a payload on stdin, because the thing being asserted is an
exit code. All twenty-nine pass. Every temp repository is a real `git init` and every
suite named below really executed.

| Clause | Covered by | Exercised live |
| --- | --- | --- |
| the unit battery passes | 449 tests across 12 files | three runs, below |
| block-and-pass: commit-gate | `tests/hooks/commit-gate.test.mjs` | green Node suite → exit 0; red suite → exit 2 |
| block-and-pass: block-merge | `tests/hooks/block-merge.test.mjs` | `aeo:builder` `git merge` → 2; orchestrator same merge → 0; `git merge-base` → 0 |
| block-and-pass: path-guard | `tests/hooks/path-guard.test.mjs` → `the verify line` | role writing `.claude/settings.json` → 2; same role writing `src/app.js` → 0; main session writing `.claude/` → 0 |
| block-and-pass: review-jail | `tests/hooks/review-jail.test.mjs` → `the verify line` | below |
| block-and-pass: sandbox-guard | `tests/hooks/sandbox-guard.test.mjs` → `the verify line` | below |
| a Node repo detects and runs its own command | `tests/hooks/stack.test.mjs` | `package.json` `scripts.test` → `npm test` ran, proved by a marker the test script wrote in the repo root |
| a Python repo detects and runs its own command | `tests/hooks/stack.test.mjs` | `pyproject.toml` naming pytest → `pytest` ran real pytest 8.4.2, proved by a marker the test function wrote; a failing test → exit 2, "the python test suite is red" |
| a repo on `master` blocks correctly | `tests/hooks/commit-gate.test.mjs` | exit 2, "no direct commits on master", and the suite never ran |
| sandbox guard blocks a run pointed at production data | `sandbox-guard.test.mjs` | three shapes, each exit 2: seam inside production data, no seam with production declared, command naming production data. Control with a seam outside → 0 |
| a commit attempted while the sentinel is set | `sandbox-guard.test.mjs` | exit 2 naming the run and the clearing command, and the suite never ran. Cleared, the identical commit passes and the suite runs |
| review-jail blocks a reviewer `Grep` | `review-jail.test.mjs` | exit 2 with the charter |
| review-jail allows the staged `Read` | `review-jail.test.mjs` | exit 0 for a file under the packet directory; a `Read` outside it → 2; a non-reviewer `Grep` → 0 |
| a deliberately broken runtime produces a loud banner | `tests/hooks/runtime-fallback.test.mjs`, **which skips on this machine** | performed, four ways, below |

Two extras were exercised because integration made them reachable:

- **The unresolvable default branch blocks.** Two conventional branch names, no origin,
  no local `init.defaultBranch`: exit 2, naming `git remote set-head origin -a`. This is
  the fix batch's amendment to D14 observed end to end rather than in a unit.
- **A docs-only commit is not held by a live sentinel.** Exit 0, and stderr confirms it
  took the documentation-only path rather than passing for some other reason.

### The broken runtime, actually performed

This is the clause most likely to be asserted and never carried out, so it was done four
ways, all against the real manifest entry with `${CLAUDE_PLUGIN_ROOT}` expanded.

1. **`node` genuinely absent.** PATH stripped to a POSIX shell plus the Windows system
   directories, and `command -v node` confirmed to find nothing first. The real
   SessionStart command then prints exactly `RUNTIME_MISSING_BANNER` on stdout and exits
   0. Byte-compared against the constant in `lib.mjs`.
2. **Control.** The same command with `node` present emits the real status report,
   starting `## Live repo state (fetched at session start)`, and contains no banner.
3. **The hazard the banner exists for, demonstrated.** With the interpreter gone,
   `commit-gate.mjs` exits **127**. Not 0 and not 2, which is a non-blocking error: the
   tool call proceeds and the gate has failed open. The banner is the only mitigation,
   and this is why.
4. **The other broken runtime.** A manifest naming a gate script that is not on disk
   makes `session-status.mjs` print the full `AEO GATES ARE NOT ENFORCING` banner with
   `missing gate script(s)` named. Exit 0, as a reporter must.

## The battery, three times, idle machine

Nothing else was running. No sibling agents, no other suites, no background loops.

| Run | Wall clock | tests | pass | fail | skipped |
| --- | --- | --- | --- | --- | --- |
| 1 | **1205.7 s** (20 m 06 s) | 449 | 446 | 0 | 3 |
| 2 | **1126.7 s** (18 m 47 s) | 449 | 446 | 0 | 3 |
| 3 | **1067.0 s** (17 m 47 s) | 449 | 446 | 0 | 3 |

Identical counts three times. No flake reappeared; the session-status flake the fix
batch closed stayed closed across all three.

**The fast-tier question now has a number measured without contention, and it is bad.**
The briefed figure was roughly 100 seconds and the previous measurements, 333 s and
774 s, were taken while sibling slices ran. Idle and complete, this battery is **17 to
20 minutes**. The spread across three runs is 139 s, about 12%, which is warm-cache
drift rather than instability.

Two things about that number matter for the decision the founder owns.

- It is not contention and it is not a defect. It is process spawn. The gate suites
  create real git repositories and spawn the real hook once per case, which is the only
  honest way to assert an exit code and the wrong thing to pay on every commit.
- The commit gate's own budget is 570 seconds. **AEO's battery now exceeds its own
  gate's budget.** The gate would block a commit here for overrunning, correctly, and
  say so. AEO cannot currently dogfood its own commit gate at the repo root, and no
  split of the suite happened in this slice because that is a decision, not a fix.

The shape of the answer is unchanged from the fix batch's note: an in-process fast tier
(`lib.test.mjs`, `stack.test.mjs`, and the pure-function parts of the rest) with the
process-level gate suites behind a separate script CI runs.

## What only the full integration could see

1. **`tests/hooks/runtime-fallback.test.mjs` has been skipping in every run of this
   battery, on this machine, since it was written.** All three of its tests skip with
   "no POSIX shell on PATH". `sh` is not on PATH here; Git for Windows ships it at
   `usr/bin/sh.exe`, which PATH does not include. The skip is loud and correct by L-08,
   and no one had read it, because the file was green-with-skips inside a 449-test run.
   The mechanism itself is fine: performed live with the real `sh.exe`, all three
   behaviours hold. But the suite covering D8's only mitigation has never actually
   executed on the machine this plugin is being built on.

2. **`bash` on this machine is a WSL stub with no distribution installed**, and it fails
   immediately with `execvpe(/bin/bash) failed`. The SessionStart entry declares
   `"shell": "bash"`. How Claude Code resolves that name is not something this slice
   could determine, since the plugin is not installed here and the hook never ran under
   it. If it resolves through PATH on Windows it finds the broken stub. Flagged as
   unverified rather than claimed either way; it wants ten minutes against an installed
   plugin, and it is exactly the D8 shape.

3. **`commit-gate`'s sentinel check is not redundant with `sandbox-guard`'s.** Stated
   above under ordering. Neither slice could see it, because each shipped one of the two
   gates and neither had the manifest.

4. `preflight()` against the finished plugin root reports `7 gate script(s) present`,
   node 24.16.0, git 2.49.0, overall ok.

## Verification

- 449 tests, 446 pass, 0 fail, 3 skipped, three consecutive runs from the repo root.
- 29 live checks against the real hooks, out of process, 29 pass.
- Both previously-skipped `hooks.json` registration tests arm and pass.
- Nothing red. No test was edited, weakened, or skipped to reach any of the above.
