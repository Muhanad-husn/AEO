# 06: Phase 6 gate: the trimmed plugin's score on diligence-reader and v1.0.0

Issue: [#261](https://github.com/Muhanad-husn/AEO/issues/261)

## Goal

PLAN.md 5a row 6 holds diligence-reader's first UI milestone (`Phase 8`) scored under the trimmed plugin, written in the shape of rows 4 and 5, with its state `done` only when harness friction is at or under 0.19 and there is no false refusal, otherwise `done, bar missed`. plugin.json reads 1.0.0. The lines the removals left stale are corrected. The orchestrator then tags main v1.0.0 with the row and RLM's reference row in the annotation, and the marketplace entry moves to v1.0.0 in its own pull request (#273).

## Acceptance criterion

Given #257, #259, #260, #268 and #270 merged, when score.mjs runs on D:/RLM for milestone "Phase 8", then the pull request quotes its output, the hand-read harness friction with one reason line per harness message, and the row 6 written in PLAN.md 5a; grep finds none of the five stale claims in task 5 under PLAN.md, plugin/ or README.md; plugin.json reads 1.0.0; `npm test` passes and the CI run on the closing commit is green and cited by URL. If the row shows a false refusal or the bar is missed, the pull request says so and recommends, and the founder decides the tag.

## Mechanism

The score script's output quoted verbatim; message classification and prose by hand; one string fix in session-status.mjs with its test. Sonnet builds.

## Deliverable

1. The score. diligence-reader is `Muhanad-husn/diligence-reader`, checked out at `D:\RLM`. Its milestone is `Phase 8`, closed on 2026-10-04 (8 issues, 6 merged slice pull requests). Run `node scripts/score.mjs D:/RLM --milestone "Phase 8"` and quote its output verbatim. A first run on 2026-10-05 printed: days 1; dollars 21.46; 6 merged; interventions 4.00 per merged pull request (24 messages, 9 merge decisions excluded, 9 sessions) against RLM's 1.40; harness bash 2 node, session start 692 lines, tests 1.17 of source; rules 0 refused, 0 warned, 0 unmatched, 6 skill loads (build 5, sprint-plan 1), 0 reference loads, over 24 sessions of which 15 were subagents.

2. The plugin version in the window. The plugin was enabled in diligence-reader at its commit 5204249 (2026-10-04 01:02 UTC), before the first slice. Slice 01 ran on 0.5.0; 0.6.0 was installed at 04:11 UTC and ran from slice 02 on. 0.5.0 and 0.6.0 carry the same guard rules (0.6.0 added the services readout and the tag pin), so the whole milestone window counts. The row says so in one line.

3. Harness friction, read by hand. Read the 24 founder messages from the transcripts and sort each into "about the harness" (the plugin, its hooks, skills, readout, install or update) or "about the work" (the product, its scope, its direction). The founder extended the milestone during the run (a stop button and a new-room prompt, diligence-reader #152 and #153), so many messages are expected to be about the work. Report harness friction per merged pull request against RLM's 0.19, labelled as read by hand, with a one-line reason per harness message. Any refusal in the `rules:` block is classified with the harm test of plans/phase-6/audit.md (the first run shows none).

4. PLAN.md 5a, row 6: write the row in the shape of rows 4 and 5. State is `done` when harness friction is at or under 0.19 and there is no false refusal, otherwise `done, bar missed`.

5. Stale lines the removals left. Each now describes a rule that #266, #267 or the earlier removals deleted:
   - PLAN.md section 2, Invariants row: it still says production data is unreachable, a declared test command does not run while a long job's sentinel is live, and a role does not rewrite the config that governs it. What holds now: merge and branch deletion stay with the founder, and a write, move or delete under AEO_LIVE_DATA_ROOT that git cannot restore is refused.
   - PLAN.md section 3, the `runlog`, `run-monitor`, `run-sentinel` row says "kept as scripts and one reference"; the run-monitor reference was deleted in #267, so it is scripts only.
   - plugin/skills/new-project/SKILL.md, around line 73: the sentence saying sandbox-guard reads aeo-tests.json so it can hold a suite back while a long job runs. Nothing reads it in code now; cut that sentence only.
   - plugin/hooks/session-status.mjs, around line 86: the declared-root lines still say the guard refuses "a run pointed at it or run from inside it, and one that sets AEO_DATA_ROOT into it". Only the write rule remains. Fix the string and any test that asserts it.
   - README.md: the current release becomes v1.0.0, and the paragraph explaining 0.x is replaced by one or two plain sentences.
   - plans/phase-6/06-gate.md and plans/phase-6/issues/06-gate.issue.md are brought in line with this issue.

6. plugin.json reads 1.0.0.

7. What this repository becomes after v1.0.0. PLAN.md has no phase 7. The pull request recommends one line for PLAN.md section 11 (the orchestrator's default: freeze, and fix only what a consuming project reports), and the founder decides it before merge.

## Files

```aeo-independence
slice: 06-gate
depends-on: 03-guards
depends-on: 04-prose
depends-on: 05-ledger
depends-on: 07-release-pin
depends-on: 08-services
edits: PLAN.md
edits: README.md
edits: plugin/.claude-plugin/plugin.json
edits: plugin/skills/new-project/SKILL.md
edits: plugin/hooks/session-status.mjs
edits: tests/hooks/session-status.test.mjs
edits: plans/phase-6/06-gate.md
edits: plans/phase-6/issues/06-gate.issue.md
```

## Out of scope

The v1.0.0 tag, which the orchestrator cuts after the founder merges, with the row and RLM's reference row in the annotation; moving the marketplace entry to v1.0.0, which is issue #273 and happens only after the tag exists; diligence-reader's own work, including its open #154 and Dependabot pull request; any rule change the score exposes, which goes to a new issue.
