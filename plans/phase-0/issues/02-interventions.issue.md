# feat(phase-0): interventions per merged pull request, and the executed rate [slice 02]

**Spec:** PLAN.md#5-phases, row "0 Score"; PLAN.md#11, decision 3 · **Plan:** plans/phase-0/02-interventions.md
**Depends on:** #156
**Labels:** phase-0

## Deliverable

The `interventions` line prints founder messages per merged pull request for the window, counted from the session transcripts under `~/.claude/projects`, with the merge decisions excluded and their count shown. The `executed` line prints the commitment ledger's rate from `COMMITMENTS.md` or `none declared` when the file does not exist. Both replace the `not measured` stubs slice 01 shipped, and both land in the snapshot so a replay needs no transcripts.

## Mechanism

`node:fs` over `~/.claude/projects/<slug>*/*.jsonl`, slug being the consumer path with every character outside `[A-Za-z0-9]` replaced by `-`, worktree directories included by prefix. A founder message is a `user` record whose string content does not begin with `<`; task notifications, system reminders, hook output and slash commands all arrive tagged and are not counted. A merge decision is a founder message of at most twelve words containing `approve`, `approved`, `merge` or `lgtm`. A session is inside the window when its first founder message falls on or between the window's dates in the gate commit's offset. No model call. Tests first, committed red; Opus builds.

## Acceptance criterion

Given the synthetic transcripts under `tests/fixtures/score/transcripts/`, four sessions holding between them 7 typed founder messages, 2 merge decisions, 5 task notifications, 3 system reminders, 1 slash command and 2 hook outputs, two sessions starting inside a two-day window and two outside it, and a snapshot with 3 merged pull requests,
when `node --test tests/scripts/score-interventions.test.mjs` runs,
then the line reads `interventions: 1.67 per merged PR (5 messages, 1 merge decision excluded, 2 sessions)`; a snapshot with no transcript directory reads `interventions: no transcripts`; a consumer with no `COMMITMENTS.md` reads `executed: none declared`; and one whose ledger rows are marked `executed`, `executed`, `partial`, `not` and blank reads `executed: 2 of 4 marked`.

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

Attributing a message to one pull request rather than to the window; per-session cost from `cost-state` records; reading the real RLM transcripts in a test. The real count for RLM phases 0 to 5 is printed in the pull request body, not asserted.
