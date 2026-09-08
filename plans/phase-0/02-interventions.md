# 02: Interventions per merged pull request, and the executed rate

Issue: [#157](https://github.com/Muhanad-husn/AEO/issues/157)

## Goal

The `interventions` line prints founder messages per merged pull request for the window,
counted from the transcripts under `~/.claude/projects`, and the `executed` line prints
the commitment ledger's rate or `none declared`.

## Acceptance criterion

Given the synthetic transcripts under `tests/fixtures/score/transcripts/`, four sessions
holding between them 7 typed founder messages, 2 merge decisions, 5 task notifications,
3 system reminders, 1 slash command and 2 hook outputs, two of the sessions starting
inside a two-day window and two outside it, and a snapshot with 3 merged pull requests,
when `node --test tests/scripts/score-interventions.test.mjs` runs,
then the line reads `interventions: 1.67 per merged PR (5 messages, 1 merge decision
excluded, 2 sessions)`, a snapshot with no transcript directory reads
`interventions: no transcripts`, a consumer with no `COMMITMENTS.md` reads
`executed: none declared`, and one whose ledger has rows marked `executed`, `executed`,
`partial`, `not` and one unmarked reads `executed: 2 of 4 marked`.

## Mechanism

- No skill or plugin fits.
- Library: `node:fs` over `~/.claude/projects/<slug>*/*.jsonl`, where the slug is the
  consumer path with every character outside `[A-Za-z0-9]` replaced by `-`, so
  worktree directories such as `D--RLM-wt-02-grade-atlas` are included by prefix.
  The read lands in the snapshot as `{sessionId, startedAt, founderMessages,
  mergeDecisions, prLinks}` per session; the transcripts themselves are never copied.
- No model call.

## The two words

- A **founder message** is a `user` record whose `message.content` is a string that
  does not begin with `<`. Task notifications, system reminders, hook output and
  local command output all arrive wrapped in an angle-bracket tag. A slash command
  arrives as `<command-name>` and is not counted, because the count is founder
  messages that correct, re-ask or unblock, and a slash command is the founder running
  the harness. Records with `isMeta` set are not counted.
- A **merge decision** is a founder message of at most twelve words containing
  `approve`, `approved`, `merge` or `lgtm`, case-insensitive. It is excluded from the
  numerator and its count is printed.
- A session **starts inside the window** when its first founder message's timestamp,
  in the gate commit's offset, falls on or between the window's dates.
- The rate is messages over merged pull requests, two decimals.

## The commitment ledger

`COMMITMENTS.md` in the consumer root, a markdown table `| date | recommendation |
executed |`, one row per session, `executed` one of `executed`, `partial`, `not` or
blank. The rate is rows marked `executed` over rows carrying any word. Phase 2 writes
the file; this slice reads it and the format is recorded as a dated line in `PLAN.md`
by the gate. The money ledger `LEDGER.md` is a different file and is not read here.

## Files

```aeo-independence
slice: 02-interventions
edits: scripts/score/interventions.mjs
edits: tests/scripts/score-interventions.test.mjs
creates: tests/fixtures/score/transcripts/README.md
creates: tests/fixtures/score/transcripts/in-window-a.jsonl
creates: tests/fixtures/score/transcripts/in-window-b.jsonl
creates: tests/fixtures/score/transcripts/before-window.jsonl
creates: tests/fixtures/score/transcripts/after-window.jsonl
creates: tests/fixtures/score/commitments-sample.md
depends-on: 01-row
```

## Out of scope

Attributing a message to one pull request rather than to the window; per-session cost
from `cost-state` records; reading the real RLM transcripts in a test. The real count
for RLM phases 0 to 5 is printed in the pull request body, not asserted.
