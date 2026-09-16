# feat(phase-2): the sensorium composer, printing the score and its bar [slice 01]

**Spec:** PLAN.md#5-phases, row "2 Sensorium"; PLAN.md#2-the-method, Sensorium · **Plan:** plans/phase-2/01-composer-score.md
**Depends on:** none · **Issue:** #181
**Labels:** phase-2

## Deliverable

`plugin/hooks/sensorium.mjs` exports `renderSensorium(root)`, which loads every `plugin/hooks/sensorium/*.mjs` in filename order, calls each module's `render({ root })`, and returns their lines joined, with a section that throws rendered as `<name>: unknown (<reason>)`. session-status and `renderStatusView` both print its block before anything they print today. The first section, `plugin/hooks/sensorium/10-score.mjs`, prints `score:` from the consumer's status table and `bar:` from its kill line. A repository with no status table prints `score: none declared`.

## Mechanism

Node only, no skill or plugin fits, no MCP, no model call. `parseStatusTable`, `splitRow`, `phaseNumber`, `phaseRow` and `isDone` move from `scripts/score/consumer.mjs` to `plugin/hooks/status-table.mjs`, and `consumer.mjs` re-exports them so `tests/scripts/score.test.mjs` is untouched. `10-score.mjs` reads `PLAN.md`, then `docs/PLAN.md`, takes the last row whose State is `done` and prints `score: <Phase cell> done, <Score cell> (<done> of <rows> phases done)`; a table with no done row prints `score: 0 of <rows> phases done` and the first row's Phase cell as `next:`. It reads `RULES.md` for an item starting `**Kill line.**` and prints the sentence after the label as `bar:`. `renderSensorium` uses `readdirSync` on `plugin/hooks/sensorium/`, sorted, dynamic `import()` per file, each `render` in try/catch; directory discovery is what lets slices 02 to 05 each add one file and touch no shared list. `package.json` adds the glob `tests/hooks/sensorium*.test.mjs` to `test`, so slices 02 to 05 register their tests by name alone and never edit `package.json`. Behavioural tests first, committed red; Sonnet builds.

## Acceptance criterion

Given a temporary git repository holding a `PLAN.md` whose status table reads RLM's "4a. Status" rows verbatim and a `RULES.md` with RLM's `Kill line` gate, when `node plugin/hooks/session-status.mjs` runs with its cwd in that repository, and when `renderStatusView(root)` runs on it, then both outputs begin with `score: 7 Compare done, sample 4 recall 86.4 (8 of 8 phases done)` followed by `bar: Phase 5 under 70 on sample 1 after $25 spent means the method is wrong.`, and the rest of each output is what it was before this slice; and given a temporary git repository with no `PLAN.md`, when the same two run, then both begin with `score: none declared` and `bar: none declared`; and given a `sensorium/` module whose `render` throws, when `renderSensorium` runs, then its output holds `<name>: unknown (<message>)` and every other section's lines.

## Files

```aeo-independence
slice: 01-composer-score
creates: plugin/hooks/sensorium.mjs
creates: plugin/hooks/sensorium/10-score.mjs
creates: plugin/hooks/status-table.mjs
creates: tests/hooks/sensorium.test.mjs
creates: tests/fixtures/sensorium/rlm-plan.md
creates: tests/fixtures/sensorium/rlm-rules.md
edits: plugin/hooks/session-status.mjs
edits: plugin/hooks/status-render.mjs
edits: scripts/score/consumer.mjs
edits: tests/hooks/session-status.test.mjs
edits: tests/skills/status-render-smoke.test.mjs
edits: package.json
```

## Out of scope

Dollars, runs, the commitment ledger and the harness cost (slices 02 to 05, each one file under `sensorium/`); removing or reshaping the sections session-status prints today (slice 03 replaces the run log excerpt); the `status` skill's SKILL.md (phase 3); the founder's global copies under `~/.claude`.
