# feat(phase-2): the commitment ledger, read and written [slice 04]

**Spec:** PLAN.md#5-phases, row "2 Sensorium"; PLAN.md#2-the-method, the commitment ledger · **Plan:** plans/phase-2/04-commitment.md
**Depends on:** #181 · **Issue:** #184
**Labels:** phase-2

## Deliverable

`plugin/scripts/commitment.mjs record "<recommendation>"` appends a row `| <date> | <recommendation> | |` to `COMMITMENTS.md` at the repository root, creating the file with its header when absent. `commitment.mjs mark executed|partial|not` fills the Executed cell of the newest row whose cell is blank, and refuses with exit 2 when no such row exists. `plugin/hooks/sensorium/40-commitment.mjs` prints `commitment: <date> "<recommendation>" <executed|partial|not|unjudged>` for the newest row, `commitment: none declared` when the file is absent, and the ledger's rate as `executed: <marked> of <total> marked` on the same terms as the score script.

## Mechanism

Node only, no skill or plugin fits, no MCP, no model call. `countCommitments` moves from `scripts/score/interventions.mjs` to `plugin/hooks/commitments.mjs`, which also exports `parseCommitments(markdown)` and `readCommitments(dir)`; `interventions.mjs` and `scripts/score/sources.mjs` re-export, so `tests/scripts/score-interventions.test.mjs` and `tests/fixtures/score/commitments-sample.md` are untouched. The date is the local calendar date, `YYYY-MM-DD`. The recommendation cell escapes a pipe on write and unescapes on read. No hook writes the ledger: a Stop hook cannot read the recommendation out of prose, and PLAN.md section 2 says the harness only shows the thread. Behavioural tests first, committed red; Sonnet builds.

## Acceptance criterion

Given a temporary repository with no `COMMITMENTS.md`, when `node plugin/scripts/commitment.mjs record "Ship phase 2, 4 issues, $0"` runs there, then `COMMITMENTS.md` exists with a header row holding `Date`, `Recommendation` and `Executed` and one data row with today's date, that text and a blank Executed cell; when `renderSensorium(root)` runs, then its output holds `commitment: <today> "Ship phase 2, 4 issues, $0" unjudged` and `executed: 0 of 0 marked`; when `commitment.mjs mark executed` runs, then that row's Executed cell reads `executed` and the sensorium prints `... executed` and `executed: 1 of 1 marked`; when `commitment.mjs mark partial` runs again, then it exits 2 and the file is unchanged; and `scripts/score/interventions.mjs`'s `countCommitments` over the same file returns `{ marked: 1, total: 1 }`.

## Files

```aeo-independence
slice: 04-commitment
creates: plugin/scripts/commitment.mjs
creates: plugin/hooks/commitments.mjs
creates: plugin/hooks/sensorium/40-commitment.mjs
creates: tests/hooks/sensorium-commitment.test.mjs
edits: scripts/score/interventions.mjs
edits: scripts/score/sources.mjs
depends-on: 01-composer-score
```

## Out of scope

Any hook that writes the ledger at session end; a skill telling the model when to record (phase 3 knowledge); judging executed or not, which the model writes.
