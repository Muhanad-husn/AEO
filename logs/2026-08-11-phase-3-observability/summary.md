# Phase 3 — Observability

2026-08-11. Branch `feat/phase-3/observability`, cut from `main` after Phase 2
fast-forwarded into it.

**Status: opened.** This file records the approved plan before the session that
approved it ends. Nothing has been built yet.

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
