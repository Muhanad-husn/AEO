# Fix #8: the fast tier's cost, and what it actually was

2026-08-12. Branch `fix/8-fast-tier`. Scope: `tests/scripts/runlog.test.mjs`.
`tests/evals/grade-plugin.test.mjs`, `tests/hooks/sandbox-session.test.mjs` and
`package.json` were read and deliberately left alone; the reasons are below. No
production code under `plugin/` was touched.

## The headline: the issue's premise does not survive re-measurement

Issue #8 records a 3m39s fast tier and diagnoses it as process-creation cost in
three suites. Re-measured on a quiet machine, from this worktree:

| | issue #8 | measured here, before any change |
| --- | --- | --- |
| `npm test` wall clock | 219s | **28.9s** |
| `tests/scripts/runlog.test.mjs` | 122.1s | 11.3s |
| `tests/evals/grade-plugin.test.mjs` | 107.8s | 4.0s |
| `tests/hooks/sandbox-session.test.mjs` | 71.4s | 5.8s |

Same command, same files, same machine, ten to twenty-seven times cheaper. The
tier was **already under the 60s acceptance bar before this branch existed**.

Two things say the difference is machine load, not the suites:

- `grade-plugin.test.mjs` **spawns nothing at all** — its own header says so, and
  reading it confirms it: `gradePlugin()` is called in-process against a temp
  directory. It was the second-slowest file in the issue's table. A
  process-creation diagnosis cannot explain a suite that creates no processes.
- The inflation factor is not uniform and does not track spawn count.
  `grade-plugin` inflated 27x with zero spawns; `runlog`, with forty-one spawns,
  inflated 10.8x. What both share is contention for CPU and disk.

The issue's numbers were taken while four test batteries ran concurrently. They
are real — that is genuinely what the tier costs under that load — but they are a
measurement of the machine, not of the tests.

Variance is high enough that no single sample here should be trusted. The same
unchanged suite, run three times back to back, took 10.7s, 6.1s and 3.8s. Every
number below is stated with its sample count.

## What was changed, and why it was still worth changing

Contention is the normal operating condition in this shop — four worktrees for
four issues is the routine. So the tier's *total work* still matters: halving it
halves what it contributes to the next pile-up. The change was scoped to the one
place where work could be removed at no cost to coverage.

Measured cost of the primitives on this machine, ten iterations each:

| operation | per call |
| --- | --- |
| `spawnSync(node, script)` | 277ms |
| `new Worker(script)` | 42ms |
| build the 28-file grader fixture | 63ms |
| `gradePlugin()` over the real `plugin/` tree | 102ms |

`runlog.test.mjs` made 41 child processes. 41 x 277ms is 11.4s, against 11.3s
measured — the file *is* its spawns, and nothing else.

### runlog.test.mjs: worker threads for the cases, real processes for the claim

Every case now runs `runlog.mjs` in a worker thread (`runlog()`), which loads the
same file with the same argv, the same working directory and the same filesystem,
and reports the same stdout, stderr and exit code. `process.exit(1)` inside a
worker ends the thread with that status and the streams still flush, so the
rejection cases assert exactly what they asserted before.

Nothing in `runlog.mjs` is sensitive to the process boundary: it reads `argv` and
`cwd`, writes files, and exits. But "nothing is sensitive to it" is a claim, so a
new describe block pays for it with real `spawnSync` calls — a full open, record,
close cycle end to end, and a usage failure. That is **two tests added**, not
moved: nothing left the fast tier, and nothing left the file.

One wrinkle worth recording. A worker shares the process's working directory, so
the helper chdirs around each call. The first version returned the promise from
inside a `try` whose `finally` restored the directory — which runs when the
promise is *created*, not when it settles, so the worker read the restored
directory and five cases failed. The fix is `return await` inside the `try`. The
helper carries a comment saying so, and a second comment warns that the file must
not be given `concurrency: true` without dealing with the shared cwd first.

### grade-plugin.test.mjs: left alone, on purpose

4.0s, and it spawns nothing. Its cost is 32 tests x (63ms fixture build + ~40ms
grade). The only way to cut it is to stop building a fresh fixture per test — and
that file's header states fresh-per-test construction as a deliberate isolation
property, so a mutation in one case cannot leak into another. Trading a stated
correctness property for ~2s on a target already met is polishing past the bar.

### sandbox-session.test.mjs: left alone, on purpose

5.8s across about fifteen spawns. Its subject *is* the process boundary — L-03's
environment-variable seam surviving into a child and a grandchild. Converting any
of it to an in-process fixture would be testing the seam against a mock of the
seam. The one reducible case (four exit codes, four spawns) is the cheapest real
coverage in the file.

## Numbers

Fast tier, `npm test` wall clock:

| | samples | result |
| --- | --- | --- |
| before | 1 | 28.9s |
| after | 2 | 22.0s, 18.1s |

`tests/scripts/runlog.test.mjs`, measured as four interleaved before/after pairs
to cancel drift (the before copy was restored from `HEAD` into the same directory
so its relative paths resolved identically):

| pair | before | after |
| --- | --- | --- |
| 1 | 10.9s | 3.5s |
| 2 | 10.6s | 5.4s |
| 3 | 11.9s | 3.8s |
| 4 | 10.3s | 5.6s |

Median 10.8s to 4.6s, about 2.4x.

Per-file after, single samples, quiet machine:

| file | before | after |
| --- | --- | --- |
| `tests/scripts/runlog.test.mjs` | 11.3s | 3.9s |
| `tests/evals/grade-plugin.test.mjs` | 4.0s | 4.0s (unchanged) |
| `tests/hooks/sandbox-session.test.mjs` | 5.8s | 5.8s (unchanged) |

Test count: **275 to 277**, all passing. Nothing moved tier; two real-process
cases were added to `runlog.test.mjs`. `package.json` is untouched, so
`test:integration` holds exactly what it held.

## Independently confirmed

The orchestrator re-ran `npm test` on `main`, quiet, after both builders had
finished: **29.5s wall clock, 275 pass**. That is a third measurement, on a
different branch, agreeing with this one. The 3m39s figure in #8 does not
reproduce.

## What was found and not fixed

- **The acceptance bar was met before the work started.** If the founder wants
  the tier cheap *under contention* rather than cheap on a quiet machine, that is
  a different target and needs to be measured under a stated, reproducible load.
  This branch does not define one.
- **The dominant constant is 277ms to start a node process on this machine**,
  against roughly 40ms for a worker. That is high enough to suspect on-access
  virus scanning over the checkout and the temp directory. Excluding both would
  cut every suite in the repository, not just these three, and would cost no
  coverage at all. It is a machine setting, so it is out of scope here — but it
  is probably the largest single lever left.
- **`grade-plugin.test.mjs` grades the real `plugin/` tree twice**, in two
  adjacent tests, at 102ms each. Merging them would save 100ms and one full
  scan, but would drop the test count by one. Not worth it on its own; worth
  folding in if that file is ever revisited.

## The lesson this is an instance of

L-10 says state the noise floor before comparing. #8 did the opposite: it
compared a loaded-machine number against a quiet-machine baseline from #3 and
called the difference a regression. Nothing in the report said which machine
state either number came from, so the comparison read as sound.

A timing taken on a shared machine is not a property of the code. Either state
the load, or take the measurement when nothing else is running.
