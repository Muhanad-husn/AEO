# Phase 1 integration fixes

2026-08-04. Branch `fix/phase-1/integration-fixes`.

Four defects found when the four parallel Phase 1 slices were merged into one tree for
the first time. Two were fail-opens in shipped gate code. Neither was visible to the
slice that wrote it, because each needed a second slice's file to be present.

## Fix 1 (defect): `defaultBranch()` failed open in a repo with no origin

`plugin/hooks/lib.mjs`.

D14 specifies origin's HEAD, then the local default, then the literal `main`. The
implementation's middle step ran `git config --get init.defaultBranch`, unqualified,
which reads **system and global** scope. That setting is a creation-time preference
about the repos a machine makes next, not a statement about the repository in hand.

Measured on this machine, whose system gitconfig sets `init.defaultBranch=master`, in a
repo with no `origin` remote whose real branch is `main`:

```
before:  branch: main | defaultBranch() -> master | commit of CODE on main -> exit=0
after:   branch: main | defaultBranch() -> main   | commit of CODE on main -> exit=2
```

A direct commit of source code on the default branch was not blocked. That is D14's own
failure inverted: D14 exists because a repo on `master` would silently no-op, and this
was a repo on `main` silently no-opping. The `main` last resort was also unreachable on
any machine that sets the key in any scope.

**Resolution.** Two of D14's three steps changed. The config read is now `--local`, so
it answers only when this repository itself was configured. The `main` last resort is
gone, replaced by evidence the repository actually carries: its own branches. One
branch is the default branch. Otherwise exactly one conventional name among them
(`main`, `master`, `trunk`) is it. Two conventional names, or none with several
branches, is genuinely ambiguous, and `defaultBranch` returns `null`.

`null` is never a pass. `commit-gate` and `block-merge` both block on it and name the
one command that fixes it. That is D10's escape hatch applied to D14, and L-08's rule
that an unset threshold must never make a gate silently skip.

One case is deliberately exempt. An unborn HEAD (`git init`, no commit yet) has no
branch to compare and no branches for a default to be read from. Demanding one there
would make the first commit in a new repository impossible, which is over-blocking
rather than fail-closed, so the branch arm stays silent and the suite still runs.

**This amends D14 rather than implementing it.** The `main` fallback D14 states is
deleted. Amending a logged decision is the founder's call, so it is flagged, not merged
as a correction.

## Fix 2 (defect): the newest run log was chosen by a tie-prone comparison

`plugin/hooks/session-status.mjs`, and its suite.

`findNewestRunLog` ranked candidates by filesystem mtime with a strict `>` against a
running best. Two summary files written in the same millisecond tie, and the tie then
fell to `readdir` order, which returns the older directory first.

The hook was wrong, not only the test. A status reporter that names a stale log as the
current one reproduces the exact bug L-08 built it to stop.

Selection is now a total order over four keys: dated directories outrank undated ones,
then date descending, then mtime descending, then name descending. The date in the name
is what a reader means by "newest run log", so re-touching an old summary no longer
promotes it. mtime still decides inside one date and between undated directories, and
the unique name always breaks the last tie.

The suite no longer depends on when a file happened to be written. Every timestamp is
pinned with `utimesSync`, and two of the five cases point mtime at the wrong answer on
purpose, so none can pass by luck.

Two further latent flakes in the same battery were found and closed. The gh-backed
tests asserted that a real answer did not read as `unknown` while allowing the hook its
3s default budget, so a slow machine could turn a correct answer into a failure that
said nothing about the hook; the test seam now allows 60s, and only the two tests that
are about the timeout keep a small value. And `stack.mjs`'s .NET project lookup took
the first `readdir` hit, which is a different test command per platform when one
directory holds two project files. It sorts first now.

## Fix 3: `hooks.json` reconciled against the three slice reports

P1.7 owned the file and could not see the other slices' reports, so three of its five
entries were marked inferred. Where a slice specified something different, the slice
won.

| Entry | Final | Source |
| --- | --- | --- |
| `^Bash$` | commit-gate `timeout: 600`, block-merge no timeout | P1.7 matcher, P1.3 timeout |
| `mcp__.*github.*__.*` | block-merge, no timeout | P1.2 |
| `*` | review-jail `timeout: 10` | P1.6 |

The forge matcher loosened to P1.2's, dropping P1.7's action-name list. C-04: the
matcher is a best-effort pre-filter and never the security boundary, so a looser one
that invokes the gate more often is safe while a tighter one that misses is not. The
list was also the same list in two files, and the copy in `hooks.json` would go stale
silently the first time the gate learned a new action.

Two of P1.7's choices were kept over P1.2's stated request. `^Bash$` rather than a bare
`Bash`, because a bare literal also matches `BashOutput` under `RegExp.test`, which is
the V-12 substring class. And two groups rather than one, so `commit-gate` is not
spawned on every forge tool call it has nothing to say about.

What happens on a hook timeout is undocumented, so `commit-gate` does not rely on it.
It holds its own 570s budget, observes an overrun itself and blocks. That makes the 600
value non-safety-critical: it is the documented default, stated so the gate's internal
budget can be checked against it in one place.

P1.7's regression test that no gate entry carries a `|| echo` fallback is untouched and
still has its teeth.

## Fix 4: AEO can now dogfood its own commit gate

A root `package.json` with a `test` script of `node --test`, no dependencies, no
install step. Its only job is to let D10 detection resolve a command in this repo,
which the commit gate needs before it can gate anything here.

**Flagged, not solved.** The full battery is 344 tests. It was measured twice, both
times while sibling Phase 1 slices were running their own suites on the same machine:
333 seconds and 774 seconds. No idle measurement was taken, so treat the briefed figure
of roughly 100 seconds as the floor and these as what contention does to it. The commit
gate is specified to run a project's *fast tier*, and none of those numbers is a fast
signal.

Almost all of the cost is process spawn: the gate suites each create a real git
repository and spawn the real hook per case, which is the right way to assert an exit
code and the wrong thing to pay on every commit. A plausible fast tier here is the
in-process library layer, `lib.test.mjs` and `stack.test.mjs`, with the process-level
gate suites behind a separate script that CI runs. That is a decision, not a fix, and
it is the founder's.

## Verification

- `node --test` from the repo root: 344 tests, 344 pass, 0 fail. Baseline was 325; the
  19 added are the regression tests for Fixes 1 to 3.
- Fix 1 reproduced out of process against the real gate, before and after, real exit
  codes, in a repo with no origin on a machine whose system config says `master`.
- Fix 2 proved by ten consecutive runs of `tests/hooks/session-status.test.mjs`, all
  27 pass and 0 fail. A single green run is not evidence about a one-in-three flake.

One caution for whoever runs this next. Several apparent failures during verification
were not the suite. Two run loops had been left alive writing to the same output files,
and the machine was down to 0.35 GB free with a sibling slice building, which produced
whole-file crashes carrying no assertion at all. A failure with `tests 1 / pass 0` is
that shape and is not a defect in the code under test. Check what else is running
before believing a red run here.
