# 05: The commitment ledger is removed

Issue: [#257](https://github.com/Muhanad-husn/AEO/issues/257)

## Goal

Session start and /status no longer print a commitment or executed line. new-project no longer writes COMMITMENTS.md. score.mjs no longer prints `executed:`.

## Acceptance criterion

Given main, when the ledger's code, sensorium module, script, scaffold entry and score reader are removed, then a session-status run on a fixture project prints no `commitment:` or `executed:` line, a new-project scaffold run writes no COMMITMENTS.md, score.mjs on the RLM fixture prints its row without `executed:`, `npm test` is green, and the integration tier is green in CI (cited by URL). PLAN.md section 2's commitment-ledger paragraph is replaced by one dated line in section 11 saying it was removed because neither consumer wrote one.

## Mechanism

Deletion. The existing tests for the remaining sensorium modules are the oracle.

## Files

```aeo-independence
slice: 05-ledger
edits: plugin/hooks/commitments.mjs
edits: plugin/hooks/sensorium/40-commitment.mjs
edits: plugin/hooks/sensorium.mjs
edits: plugin/hooks/session-status.mjs
edits: plugin/hooks/status-render.mjs
edits: plugin/scripts/commitment.mjs
edits: plugin/skills/new-project/SKILL.md
edits: plugin/skills/new-project/assets/scaffold-plan.json
edits: plugin/skills/status/SKILL.md
edits: scripts/score/interventions.mjs
edits: scripts/score/sources.mjs
edits: scripts/test-area.mjs
edits: tests/hooks/sensorium-commitment.test.mjs
edits: tests/hooks/sensorium.test.mjs
edits: tests/scripts/score-interventions.test.mjs
edits: tests/skills/new-project-scaffold.test.mjs
edits: PLAN.md
```

## Out of scope

The other sensorium modules. The consumers' own COMMITMENTS.md files.
