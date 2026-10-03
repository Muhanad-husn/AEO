# feat(phase-6): the scorer prints what each rule did in a consumer's window [slice 01]

**Spec:** PLAN.md#5-phases, row "6 Removal"; PLAN.md#5a-status, row 6; PLAN.md section 11, line "Made 2026-10-03" · **Plan:** plans/phase-6/01-counter.md · **Issue:** #256
**Depends on:** none · **Labels:** phase-6

## Deliverable

`node scripts/score.mjs <consumer>` prints one `rules:` block: each guard rule id with its refusal count and each skill and reference with its load count, read from top-level and subagent transcripts inside the window.

## Mechanism

A new reader scripts/score/rules.mjs beside the other score readers. A table maps refusal message text (current and past wordings, from git history of the hooks) to rule ids. Skill loads are Skill tool calls. Reference loads are Read calls on a path ending plugin/references/<name>.md or under the installed plugin cache. Tests first, committed red.

## Acceptance criterion

Given fixture transcripts under tests/fixtures/score/rules/ holding a top-level session and a subagent session, with refusals from block-merge, sandbox-guard (including the pre-#214 seam message wording) and a skill load and a reference read, when score.mjs runs on the fixture consumer, then it prints each rule id with the right count, counts the subagent refusals, counts a refusal outside the window as zero, and two runs are byte-identical.

## Files

```aeo-independence
slice: 01-counter
creates: scripts/score/rules.mjs
creates: tests/scripts/score-rules.test.mjs
creates: tests/fixtures/score/rules/README.md
edits: scripts/score/consumer.mjs
```

## Out of scope

Counting process friction (founder messages about the harness), which needs judgment. Changing hook messages. The slug prefix match in sources.mjs.
