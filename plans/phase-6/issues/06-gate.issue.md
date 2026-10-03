# chore(phase-6): phase 6 gate: the trimmed plugin's score on diligence-reader and v1.0.0 [slice 06]

**Spec:** PLAN.md#5-phases, row "6 Removal"; PLAN.md#5a-status, row 6; PLAN.md section 11, line "Made 2026-10-03" · **Plan:** plans/phase-6/06-gate.md · **Issue:** #261
**Depends on:** #259, #260, #257 · **Labels:** phase-6

## Deliverable

PLAN.md 5a reads `6 Removal | done` with diligence-reader's first UI milestone scored under the trimmed plugin. plugin.json reads 1.0.0. main is tagged v1.0.0 with that row and RLM's reference row in the tag message.

## Mechanism

The scripts' output quoted verbatim. Prose by hand.

## Acceptance criterion

Given 03, 04 and 05 merged and diligence-reader's first UI milestone closed under the plugin (run by the founder in that project's own sessions; this repository's session only reads it), when score.mjs runs on diligence-reader over the milestone window, then the row prints days, dollars, merged pull requests, interventions per merged pull request against RLM's 1.40, the 01 `rules:` block, and harness friction against RLM's 0.19 (guard refusals from the script, process friction read the same way phase 5 read it and labelled as read by hand). Any refusal in the block is classified as in 02. The CI run on the closing commit is green and cited by URL. After the founder merges, main is tagged v1.0.0 with the row in the annotation. If the row shows a false refusal, the pull request says so and recommends, and the founder decides the tag.

## Files

```aeo-independence
slice: 06-gate
depends-on: 03-guards
depends-on: 04-prose
depends-on: 05-ledger
edits: PLAN.md
edits: plugin/.claude-plugin/plugin.json
```

## Out of scope

Building diligence-reader's UI (its own sessions). Any rule change the score exposes (it goes to a new issue).
