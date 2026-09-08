# Phase 0: Score

Milestone `Phase 0`. Spec: `PLAN.md` section 5, row "0 Score". Consumer 1, `D:\RLM`.

The outcome: `node scripts/score.mjs <consumer>` prints one score row for a consuming
project, read from git, GitHub, the consumer's own files and the founder's session
transcripts, with nothing hand-counted. Run against `D:\RLM` for phases 0 to 5 it prints
4 days, $3.50 and 48 merged pull requests, which is the row `PLAN.md` section 4 already
carries. Run twice, the output is byte-identical. `RLM-Challenge`, whose repository,
checkout and transcripts no longer exist, is scored from a record file that says so.

## What the survey found

- `D:\RLM` phases 0 to 5: first issue 2026-09-05T15:14Z, gate commit `b032896`
  2026-09-08 01:43 +0200, 48 pull requests merged at or before it, ledger rows for phases
  0 to 5 sum to 3.4988. The status table's dollars column sums to 3.29; the ledger is the
  source and the table is not.
- `Muhanad-husn/RLM-Challenge` does not resolve on GitHub, has no checkout under `D:\`
  and no transcript directory under `~/.claude/projects`. Its only record is
  `D:\RLM\reference\design-mistake-register-first-build.md`: first commit 2026-08-21, last
  2026-09-05, 122 pull requests of which 117 merged, $20.58, no report.
- Founder messages are the `user` records with string content in
  `~/.claude/projects/D--RLM*/*.jsonl`. Task notifications, system reminders and hook
  output arrive as `user` records too, wrapped in an angle-bracket tag, and are not
  founder messages. `pr-link` records tie a session to its pull requests.
- No commitment ledger exists yet in any consumer. Phase 2 writes it; this phase fixes
  the file the score reads and prints `none declared` until it exists.

## The shape decisions this phase fixes

- **The window.** A phase range runs from the creation of the earliest issue in its first
  milestone to the commit that set the last phase's status row to `done`, found with
  `git log -S` over the consumer's `PLAN.md`. Days are inclusive calendar days in the
  gate commit's own UTC offset, so the row does not change with the machine that runs it.
- **Dollars** are the sum of `LEDGER.md` rows whose phase column falls in the range,
  printed to two decimals.
- **Pull requests** are merged pull requests with a merge time at or before the gate
  commit and at or after the window's start.
- **Interventions** are founder messages in sessions that start inside the window, less
  merge decisions, divided by merged pull requests. The rule for both words is in slice 02.
- **Snapshots.** Every live read lands in one JSON document first; the row is computed
  from that document alone. `--snapshot` writes it, `--from` replays it. The fast tier
  replays a snapshot recorded by the script; the live run is the integration tier.
- **Nothing refuses.** A missing ledger, transcript directory or plugin prints as missing
  on its own line and the rest of the row still prints.

## Slices

| NN | Slice | Plan | Issue | Depends on |
|---|---|---|---|---|
| 01 | The row: days, dollars, pull requests, replayed from a snapshot | [01-row.md](01-row.md) | #156 | none |
| 02 | Interventions per merged pull request, and the executed rate | [02-interventions.md](02-interventions.md) | #157 | 01 |
| 03 | The harness cost line | [03-harness-cost.md](03-harness-cost.md) | #158 | 01 |
| 04 | A consumer that no longer exists is scored from its record | [04-record.md](04-record.md) | #159 | 01 |
| 05 | Phase 0 gate: the live run twice, and the status row | [05-gate.md](05-gate.md) | #160 | 02, 03, 04 |

Order of work: 01, then 02, 03 and 04 together, then 05.
