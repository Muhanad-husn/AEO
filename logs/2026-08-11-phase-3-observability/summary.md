# Phase 3 — Observability

2026-08-11. Branch `feat/phase-3/observability`, cut from `main` after Phase 2
fast-forwarded into it.

**Status: closed.** All four slices landed and Checkpoint 3's verify line has run
live against real processes. The plan below is the one that was approved; what
actually happened is recorded at the end of this file.

## What changed at the phase boundary

`main` was thirteen commits behind the Phase 2 branch. It fast-forwarded, so
`main` now carries everything Checkpoint 2 verified and this branch is cut from a
current default branch. The merge was refused by the permission classifier and run
by the founder, the same refusal
[Checkpoint 2](../2026-08-11-phase-2-verification/summary.md) recorded for
`gh pr merge`.

**Dogfooding starts here.** D21 forbade loading the plugin into this repository
while its skills were stubs. Phase 2 filled them, so the constraint expired and the
founder approved running Phase 3 under the plugin's own gates. The route is
`claude --plugin-dir plugin`, not an install — Checkpoint 2 established that it
loads the real plugin, writes nothing to `~/.claude/`, and needs no uninstall step.

From this point the commit gate runs `npm test` on every commit in this repository
and refuses a commit on `main`. Phases 0 through 2 were built ungoverned; this one
is not.

## The approved plan

| Slice | Model | Authors |
| --- | --- | --- |
| **P3.1** run log | Sonnet | `plugin/scripts/runlog.mjs` — `open` / `record` / `close`, the fixed envelope (`ts`, `job`, `unit`, `status`, `duration`, `detail`), writing `run.jsonl`, `console.log` and a `summary.md` stub into `logs/<YYYY-MM-DD>-<job>/` in the **project** repo (D12), reusing `lib.mjs` root resolution; plus tests |
| **P3.2** monitor | Opus | `plugin/scripts/run-monitor.mjs` — one generic monitor the founder runs in their own terminal: progress, rate, elapsed and projected, failures, and three-signal stall detection; plus tests |
| **P3.3** monitor-designer | Opus | The fourth agent charter and its skill, for job-specific overlays only, carrying the V-11 landmine documentation as its reference |
| **P3.4** carried fix | Sonnet | `sprint-start` step 4 gains the exception clause Checkpoint 2 asked for |

Order: P3.1 and P3.4 in parallel, then P3.2 against P3.1's format, then P3.3.
Two actors at peak.

## Three design calls made at approval

**The third stall signal is CPU per PID, and Node has no `psutil`.** The monitor
shells out — `ps` on POSIX, `Get-CimInstance` on Windows. When that read fails the
status is `SUSPECT` with the reason stated, never `STALLED`. Two flat signals are
not three, and V-10's whole point is that a merely slow job must not trip the
detector.

**The stall threshold is not hardcoded.** V-10's `DEFAULT_STALL_SECONDS = 2400` was
tuned to one measured run of one pipeline and is exactly the specific the pattern
has to shed. `--stall-seconds` is supplied per job; unset, the monitor reports
liveness only and says that it is doing so. An unset threshold never produces a
quiet pass (L-08).

**`runlog.mjs` is a CLI, not a library.** Lanes and agents shell out to it. A
subagent cannot `import` a module, so a library-only seam would be unreachable by
every caller that matters.

## What the verify line asks for

A long job monitored live from a plain terminal; a deliberately wedged job reported
stalled; a slow-but-working job not; and an uninstrumented job reporting `unknown`
rather than `idle`. That last one is L-08's lesson — a healthy run under a shape the
monitor was not built for showed `0 live workers / IDLE` for its entire duration.

---

## What was built

| Slice | Commit | What landed |
| --- | --- | --- |
| **P3.1** run log | `9f57c7b` | `plugin/scripts/runlog.mjs` — `open` / `record` / `close`, the fixed six-field envelope, writing `run.jsonl`, `console.log` and a `summary.md` stub into `logs/<date>-<job>/` in the project repo; 25 tests |
| **P3.4** carried fix | `8c7476d` | `sprint-start` step 4 gains its exception clause: cut from the default branch unless the issue's premise does not hold there, and name the base and the reason in the PR body |
| **P3.2** monitor | `c80f0e3` | `plugin/scripts/run-monitor.mjs` — progress, rate, elapsed and projected, failures, three-signal stall detection; 59 tests |
| **P3.3** monitor-designer | `00eb1cc` | The fourth charter, the `monitor-design` skill, and the V-11 landmine reference; grader inventory moved to 12 skills and 4 agents |

`safe-pr` was deliberately left alone by P3.4. Its "base is always the repo's
default branch" governs the PR's merge target, which is a different axis from
which branch the worktree is cut from, and its PR template already asks for
non-obvious design decisions.

## Checkpoint 3 — the verify line, run live

Four cases, against real processes on Windows, with the real scripts. Not
fixtures.

| Case | Asked for | Reported |
| --- | --- | --- |
| A long job watched from a plain terminal | it is monitored live | six units over 24s: progress, rate, remaining, then `DONE (closed with status: ok)` |
| A deliberately wedged job | `STALLED` | `STALLED` — "checkpoints flat 38s, logs flat 38s, CPU flat 4s; the threshold is 5s" |
| A slow-but-working job | not stalled | `MOVING` — "CPU is still climbing (+3.77s). Slow is not stalled." |
| An uninstrumented job | `unknown`, not `idle` | `UNKNOWN` — "no run was ever opened here ... It is not a report that the job is quiet, or finished" |

The wedged and the slow job were identical from the log's point of view: one
record each, then nothing, both flat past the threshold on checkpoints and logs.
Only the third signal separated them. Each also passed through `SUSPECT` first,
on the look where only one CPU sample existed — movement needs two — which is the
designed refusal to guess rather than a defect.

## One defect, found by running it

The skill told an author to raise a job's sentinel with `--pid $$`. On Windows
under Git Bash that is the MSYS process id, not the Windows one, and the CPU
probe resolves Windows process ids only. Measured in one shell: `$$` was 12341
while the same process's Windows pid was 29564.

The consequence is worse than the degradation already documented. A missing pid
degrades to `SUSPECT`, which admits it is guessing. A pid nothing can look up
reads as a pid that is gone, so a live job is reported `EXITED` — a confident,
wrong claim that it crashed. The first live case reproduced exactly that while
the job went on to record two more units and close cleanly.

The monitor behaved as designed and its own reason line names the possibility
("If that pid named a launcher rather than the job itself, this is a false
alarm"). The fix is documentation: the skill now says to have a Node or Python
job raise its own sentinel with `process.pid` or `os.getpid()`, and gives the
per-shell table for when a shell must do it, with `WINPID` for Git Bash. The
`EXITED` verdict was not weakened to paper over it.

## The second consequence, and its fix (P3.5, `b760272`)

The same wrong pid has a second consequence, found while writing up the first and
worse than it. `hooks/sentinel.mjs` decides a sentinel is stale by asking
`process.kill(pid, 0)`, which resolves Windows process ids only. A sentinel
raised with an MSYS `$$` therefore reads stale while its job is running:

```
stale    msys-demo.json, live job, msys pid, started ..., pid 13760, on Sandman (owner process is gone)
```

A stale sentinel does not block. So a long job raised that way silently loses the
protection the sentinel exists to give it, and a concurrent session's commit gate
can run the suite and kill it — L-02's incident, exactly.

Documentation warns about it in three places, but a gate that fails open on a
wrong pid is still a gate that fails open. The founder approved the fix and it
landed: `run-sentinel start` checks the pid against the OS process table before
writing anything, and refuses with a non-zero exit and no file. Raise time is the
only moment without ambiguity, because the process is supposed to be running right
then; every downstream reader has to treat "cannot resolve" and "resolved and gone"
as one fact. `processAlive` is exported from the guard rather than copied, so both
checks read the same table through the same code, and `inspectRuns`'s stale rule is
untouched. No override flag.

The check is not total, and the residue fails in the safe direction.
`process.kill(pid, 0)` counts access-denied as alive, deliberately, because a job
running as another user is still a job. A wrong pid landing on that path is
accepted, the sentinel stands, and a commit is blocked rather than a guard
dropped. Both directions were measured here: MSYS pid 13760 is refused, while
15517 reads alive through that path. The monitor can still report `EXITED` for
that second case, since its CPU probe resolves the pid differently; that is the
documented false alarm its reason line already names.

## Carried forward

- On Linux and macOS, `ps` reports CPU time at one-second resolution, so the
  third signal is blunter there than on Windows. Documented in the script header
  and in the skill's step 5.
- Phase 6's `skill-creator` pass and the trigger eval now cover six
  description-triggered skills, not five. `docs/PLAN.md` and D23 say so.
