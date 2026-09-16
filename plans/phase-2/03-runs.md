# 03: Live runs and their last progress line

Issue: [#183](https://github.com/Muhanad-husn/AEO/issues/183)

## Goal

`plugin/hooks/sensorium/30-runs.mjs` prints the live sentinels under `.aeo/runs/` and,
for the newest `logs/<dir>/run.jsonl`, that run's last record as one line. `runs: none
live` when there is no sentinel; `runs: <n> live` then one indented line per sentinel as
`inspectRuns` describes it, and one line per stale sentinel marked `(stale, owner gone)`;
then `last run: logs/<dir>, <unit> <n> of <total>, <status>, <timestamp>` from the last
record of the newest run.jsonl, or `last run: logs/<dir>, closed <status> <timestamp>`
when that record is the close record, or `last run: none` when no run.jsonl exists.
session-status stops printing the eight-line summary.md excerpt.

## Acceptance criterion

Given a temporary repository with two sentinels under `.aeo/runs/`, one live and one whose
recorded pid is gone, and two run log directories under `logs/` where the newer one's
`run.jsonl` ends with a progress record,
when `renderSensorium(root)` runs,
then its output holds `runs: 1 live`, one line naming the live sentinel, one line naming
the stale one with `(stale, owner gone)`, and one `last run:` line naming the newer
directory and its last record's unit, count and status;
and given the newer run.jsonl ends with the close record, then the `last run:` line reads
`closed <status>`;
and given no `.aeo/runs/` and no `logs/`, then it holds `runs: none live` and
`last run: none`;
and when `node plugin/hooks/session-status.mjs` runs on a repository with a
`logs/<dir>/summary.md`, then its output holds no line beginning with `> `.

## Mechanism

- No existing skill or plugin fits. No MCP. No model call. Node only.
- `inspectRuns` from `plugin/hooks/sentinel.mjs` for the sentinels, with its `live`,
  `stale`, `unreadable` and `dirError` all printed, never dropped: an unreadable sentinel
  blocks the test command and the session should know.
- The newest run log is chosen the way `findNewestRunLog` in session-status.mjs chooses
  it today (date prefix, then mtime, then name); that function and `compareRunLogs` move
  to `30-runs.mjs` and session-status.mjs loses the excerpt block.
- The last record is the last non-empty line of run.jsonl parsed as JSON; the record shape
  is `plugin/scripts/runlog.mjs`'s, and the close record is `unit: 'run'`.
- Behavioural tests first, committed red; Sonnet builds.

## Files

```aeo-independence
slice: 03-runs
creates: plugin/hooks/sensorium/30-runs.mjs
creates: tests/hooks/sensorium-runs.test.mjs
edits: plugin/hooks/session-status.mjs
edits: tests/hooks/session-status.test.mjs
depends-on: 01-composer-score
```

## Out of scope

Rate and projection, which `run-monitor.mjs` prints on demand. Clearing a stale sentinel.
The sandbox guard's sentinel rule, which is phase 1's and unchanged.
