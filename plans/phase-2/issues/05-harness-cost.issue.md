# feat(phase-2): the harness's own cost this session [slice 05]

**Spec:** PLAN.md#5-phases, row "2 Sensorium"; PLAN.md#7-cost · **Plan:** plans/phase-2/05-harness-cost.md
**Depends on:** #181 · **Issue:** #185
**Labels:** phase-2

## Deliverable

`plugin/hooks/sensorium/50-harness.mjs` prints `harness: bash <n> node, grep <n>, read <n>, task <n>; session start <n> lines` for the repository the session is in, measured from the same files the score script measures: the founder's `~/.claude/settings.json`, the project's `.claude/settings.json` and `.claude/settings.local.json`, every enabled plugin's `hooks.json`, agents and skill descriptions, and both `CLAUDE.md` files. The tests-over-source ratio is not printed at session start.

## Mechanism

Node only, no skill or plugin fits, no MCP, no model call. `measure` and its helpers move from `scripts/score/harness.mjs` to `plugin/hooks/harness-cost.mjs`, split so that `processes` and `sessionStartLines` can be read without `testsOverSource`; `harness.mjs` re-exports `measure` and keeps `line`, so `tests/scripts/score-harness.test.mjs` is untouched. The section reads the home directory from `AEO_HOME_DIR` when set, else `<os.homedir()>/.claude`. Behavioural tests first, committed red; Sonnet builds.

## Acceptance criterion

Given the stand-in home directory `tests/fixtures/score/harness` that `tests/scripts/score-harness.test.mjs` already builds against, and a temporary repository with a `CLAUDE.md` of 12 lines, when `renderSensorium(root)` runs with the home directory pointed at that stand-in, then its output holds one line `harness: bash <b> node, grep <g>, read <r>, task <t>; session start <s> lines` whose five numbers equal `measure(root, { homeDir })` from `scripts/score/harness.mjs` on the same inputs, and the line holds no `tests` part; and `node scripts/score.mjs --from tests/fixtures/score/rlm-phases-0-5.json` prints the same `harness:` line it printed before this slice.

## Files

```aeo-independence
slice: 05-harness-cost
creates: plugin/hooks/sensorium/50-harness.mjs
creates: plugin/hooks/harness-cost.mjs
creates: tests/hooks/sensorium-harness.test.mjs
edits: scripts/score/harness.mjs
depends-on: 01-composer-score
```

## Out of scope

Tests over source at session start; counting the sensorium's own output lines toward the 150-line budget (phase 3 measures it); dollars for this repository.
