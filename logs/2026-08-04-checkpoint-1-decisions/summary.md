# Checkpoint 1 decisions — D17 (two test tiers) and D18 (data-root reporting)

2026-08-04. Branch `phase-1/integration`.

## D17 — the split

### The measurement that placed the boundary

Every test file, timed individually, `node --test <file>` from the repo root,
**Git Bash on Windows, Node 24.16.0**, with six read-only reviewer sessions
running concurrently on the same machine.

| File | Tests | Wall clock |
| --- | ---: | ---: |
| `stack.test.mjs` | 33 | 0.84 s |
| `hooks-json.test.mjs` | 47 | 1.27 s |
| `runtime-fallback.test.mjs` | 3 | 1.90 s |
| `sandbox-session.test.mjs` | 14 | 8.13 s |
| **the boundary** | | |
| `review-jail.test.mjs` | 50 | 27.5 s |
| `lib.test.mjs` | 106 | 32.3 s |
| `path-guard.test.mjs` | 35 | 42.2 s |
| `block-merge.test.mjs` | 50 | 50.5 s |
| `session-status.test.mjs` | 27 | 77.5 s |
| `commit-gate.test.mjs` | 38 | 121.9 s |
| `sandbox-guard.test.mjs` | 46 | 143.5 s |

Sequential total 507 s; the parallel whole-battery figure is much lower because
`node --test` runs files concurrently.

The boundary sits at the 3.4x step from 8.13 s to 27.5 s, which is also the
largest absolute gap in the list. Two candidate splits were measured as tiers
rather than as sums:

| Fast tier | Tests | Wall clock |
| --- | ---: | ---: |
| Above the boundary | 97 | **6.8 s** |
| Above the boundary + `lib.test.mjs` | 203 | 37.7 s |

5.5x, on the one number D17 exists to move. The boundary stays where the gap is.

### `lib.test.mjs` is a process-level suite wearing a library name

D17 says "the in-process library layer is the fast tier". Measured, `lib.test.mjs`
is not that. Per-describe timings:

| Describe | Wall clock |
| --- | ---: |
| `defaultBranch` | 16.6 s |
| `runGate (C-06)` | 6.0 s |
| `git helpers` | 4.0 s |
| `resolveWorktree` | 3.7 s |
| `preflight (D8)` | 1.4 s |
| `runReporter` | 0.7 s |
| everything else, six describes | 0.046 s |

99.99% of the file's cost is building real git repositories and spawning real
hooks, the same thing that makes the gate suites slow. It is a process-level
suite by behaviour, so it went to the process-level tier. D17's phrase describes
the intent correctly and names the wrong file; the numbers were followed.

### The scripts

```json
"test":             "node --test <5 fast files>",
"test:integration": "node --test <7 process-level files>",
"test:all":         "npm test && npm run test:integration"
```

`test` is the fast tier because detection resolves `npm test` (D10), and the
commit gate has to land on the fast one. `test:all` is the CI entry point.

Counts, measured, Git Bash:

| Tier | Tests | Pass | Fail | Skipped | Wall clock |
| --- | ---: | ---: | ---: | ---: | ---: |
| `npm test` | 103 | 103 | 0 | 0 | 7.8 s |
| `npm run test:integration` | 359 | 359 | 0 | 0 | 306.8 s |
| **sum** | **462** | | | | |
| `node --test` from the root | 462 | 462 | 0 | 0 | 360.6 s |

103 + 359 = 462, and the root discovery run finds exactly 462. Nothing is in
neither tier and nothing is in both.

The battery grew from 449 to 462: seven new tests for D18, six for the tier guard.

### The tier-membership guard

Explicit file lists have one failure mode and it is silent: a new test file that
nobody adds to either script runs nowhere, and the board stays green.
`tests/hooks/test-tiers.test.mjs` reads both scripts out of `package.json`,
lists `tests/hooks/*.test.mjs` off disk, and fails if the union is not exactly
the directory or if any file is in both. It also asserts, against the real
detection code, that `resolveTestPlan` on this repo resolves `npm test`, which is
what makes the fast tier the gate's tier rather than a script beside it.

It lives in the fast tier, so it runs on every commit.

`node --test` has include-by-glob and no exclude, so lists are the mechanism. The
alternative, renaming seven files to a `*.gate.test.mjs` convention, is churn for
the same result.

### The commit gate, after

`node plugin/hooks/commit-gate.mjs` against `D:\AEO` with a `git commit` payload,
**Git Bash on Windows, Node 24.16.0, six reviewer sessions running concurrently**:

| Run | Exit | Wall clock |
| ---: | ---: | ---: |
| 1 | 0 | 9.3 s |
| 2 | 0 | 8.9 s |
| 3 | 0 | 10.4 s |
| 4 | 0 | 9.2 s |

**322 s to roughly 9 s**, a 35x reduction, against a 570 s budget. That is the
figure D17 was written to produce.

### CI

`.github/workflows/tests.yml`, 15 lines: checkout, `setup-node@v4` at 24,
`npm run test:all`. No install step, because there are no dependencies. It has
never been observed green on Linux; every run of this battery so far has been
Windows under Git Bash. First run of the workflow is also its first evidence.

Making it a required check on `main` is what pays for L-06's accepted cost.

## D18 — the undeclared production data root

`plugin/hooks/session-status.mjs` gains `renderDataRoot()`, placed immediately
after the gate-health banner and above the not-a-worktree early return, because
an undeclared root is a fact about whether enforcement is running and not a fact
about any repository.

Three states, none collapsing into another, none reading as an all-clear:

- **Not declared.** `Production data root: NOT DECLARED.` The text states the
  guard does nothing for the whole session, that a command pointed at production
  data would not be refused, that this is a gap in cover and not a clean bill of
  health, and what it cost the first time.
- **Declared, absolute.** `Production data root: declared` at the path. It reports
  that a declaration exists, and says outright that whether it names the right
  directory is not something the hook can check.
- **Declared, relative.** `Production data root: DECLARED BUT UNUSABLE.` The guard
  is refusing every command in this state, so the line says so.

The hook still never blocks. It is unchanged on `runReporter`, there is no
`process.exit` anywhere in it, and a test drives six malformed values of the
variable through the real script and asserts exit 0 for each.

Seven tests added to `tests/hooks/session-status.test.mjs`, all out of process
against the spawned script, in the file's existing style. Each state asserts both
what the report says and what it must not say, since the L-08 claim is about
distinguishability rather than about a string being present.

One existing test changed. `exits 0 when the cwd is not a git worktree at all`
asserted `stdout === ''`. D18 deliberately breaks that: it now asserts no repo
state and no branch line, which is what the test was actually about.

`buildEnv` now clears `AEO_LIVE_DATA_ROOT` and `AEO_DATA_ROOT` alongside the gh
seams. A test whose expected output depends on whether the founder's shell exports
one is not a test.

## Standing note on measurement

Every duration above carries its environment, per D17's own rule. All of them were
taken with six read-only reviewer sessions running concurrently on the same
machine, which inflates them; they are upper bounds, not best cases.
