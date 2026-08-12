# P4.3: the evidence collector refuses the production data path

2026-08-12. Branch `feat/phase-4/p4.3-evidence-guard`. Issue #6, EN-16.

## What was built

| File | What changed |
| --- | --- |
| `plugin/skills/safe-pr/scripts/collect-evidence.mjs` | The refusal: three call sites, one check, no override |
| `plugin/hooks/lib.mjs` | `realpathDeep` exported — the deep path resolution both ends of the pipeline need |
| `plugin/skills/safe-pr/SKILL.md` | Step 3 and one safety rule state the refusal and what an unset root means |
| `tests/skills/collect-evidence.test.mjs` | 11 tests, all spawning the real script |
| `tests/hooks/lib.test.mjs` | 4 tests for the new export, keeping that file's "every export is tested" true |
| `package.json` | The new file joins `test:integration` |

The collector already secret-scanned what it copies. It had no opinion about where
that evidence came from. It has one now.

## The shape of the check

P1.5's sandbox guard stops a session reaching production data. This stops
production data leaving by the other end of the same pipeline. Both read **one**
declaration of where that data is — `AEO_LIVE_DATA_ROOT`, L-03's
environment-variable seam, imported from `sandbox-guard.mjs` rather than spelled
again — so the two cannot disagree about what they are protecting.

Three call sites, all the same function:

| Where | What it judges | Why it is not redundant |
| --- | --- | --- |
| Before `mkdir` | The evidence folder | A repository sitting inside production data would write evidence into it |
| Before the copy | Every source, and every entry under a source tree | Copying out of production data is already the read L-03 exists to stop |
| Before the body | Every file in the evidence folder | `cpSync` copies a link **as a link**; `walk` reports it as an ordinary file; the body phase then reads through it |

The third is the one that is easy to leave out, and it is why a source check alone
is not enough. A junction planted in the evidence folder puts production content
into a pull request body without a byte of it being copied. `--body-only` skips
the copy entirely and still embeds, so that path is judged too.

Both sides of every comparison go through `realpathDeep` before `isPathInside`
sees them: links, junctions, `..`, and a path that does not exist yet, which
resolves to the place it would be created in. Case and trailing separators are
handled by `isPathInside`, which lowercases on win32 and compares by whole
segment.

## What an unset variable does, and why

**Unset is a loud skip. It is not a refusal and it is not silence.**

A project with no production data directory declares nothing, and that is the
normal, correct state for most repositories. Refusing every run there would make
the collector unusable and get it deleted, and a guard that is deleted protects
nothing. Skipping quietly is the fail-open case the slice exists to prevent. So
the skip is announced twice: a `WARN ... DID NOT RUN` line on stderr, and
`production data : NOT CHECKED` in the summary block, which is where the operator
and the `safe-pr` skill both read. A test asserts both strings, so a future change
that makes the skip silent turns the battery red.

This is the same answer P1.5's guard and `sandbox-session.mjs` already give for
the same variable. Two different answers to "the seam is unset" across one seam
would be its own defect.

**Set but not absolute is a refusal.** That is a misconfiguration rather than an
absence: a relative root resolves against whatever directory the process happens
to run in, so the check would be comparing against a place nobody named.

The residual gap is real and is stated rather than hidden: a machine that holds
production data and never sets the variable gets no protection here, exactly as it
gets none from P1.5. One edit in `.claude/settings.json` closes it for both.

## No override

No flag turns the refusal off. A test runs the refusal with `--force` and
`--include-traces` set — the two existing flags that could plausibly read as a
bypass — and with `AEO_DATA_ROOT` pointed at a sandbox, and asserts it still
refuses. L-05: an override is what you reach for at 2am.

Refusal is `exit 1` with a banner naming the candidate as given, the path it
resolved to, the production root, and why a pull request is the wrong place for
it. Advice printed beside data that has already been copied is not a guard.

## `lib.mjs`, and the duplication that is left

`realpathDeep` is the resolution loop `sandbox-guard.mjs` carries privately as
`realise`. The slice may not edit that file, so the copy there stays and the two
are now the same function in two places. That is V-13 in miniature and it is
recorded rather than papered over.

Putting the export in `lib.mjs` is still the better of the two available moves.
The alternative was a third copy inside a skill script, and `lib.mjs` is where
`isPathInside` — the function it is always called with — already lives. When
P1.5's gate is next open for edit, switching `realise` to a call is one line.

## Verification

Node 24, Windows 11.

| Command | Result |
| --- | --- |
| `npm test`, the fast tier | **234 tests, 234 pass, 0 fail, 0 skipped** |
| `node --test tests/skills/collect-evidence.test.mjs` | **11 tests, 11 pass, 0 fail, 0 skipped** |
| `node --test tests/hooks/lib.test.mjs` | **127 tests, 127 pass, 0 fail, 0 skipped** |
| `npm run grade:plugin` | **102 expectations, 102 pass, 0 fail** |

`npm run test:integration` was **not** run at the end, deliberately. It is the
nine-minute Windows battery and CI's tier by policy, and concurrent builders
re-running it costs wall clock for no new information: the two files this slice
touches both live in it and both were run directly, green. An earlier complete
pass of the whole battery on this branch reported 512 tests, 511 pass, 0 fail, 1
skipped, the skip being a pre-existing conditional registration test. CI owns the
rest.

The 15 tests this slice adds all ran; none skipped.

### Mutation

The refusal was disabled — `refuseProductionPaths` made an unconditional
`return` — and the new battery re-run. **8 of 11 fail.** The three that survive
are the three that should: the positive control that collects a transcript from
outside production data, the unset loud skip, and the not-absolute refusal, which
is decided in `productionDataRoot` and not in the mutated function.

### What was not done here

Checkpoint 4's verify line asks for a live exercise against the testbed at
`D:\aeo-testbed\repo`. This slice was scoped to write only inside its own
worktree, so the testbed was not touched. What the battery does instead is spawn
the real script — not a mock, not an import — against real git repositories and
real directory junctions in scratch space, which is the same mechanism the testbed
run would exercise. The testbed pass remains open for whoever closes Checkpoint 4.
