# 04: `pr`, `safe-cleanup` and `status`, advisory

Issue: [#198](https://github.com/Muhanad-husn/AEO/issues/198)

## Goal

Three advisory skills the model may invoke. `plugin/skills/pr/SKILL.md` replaces
`safe-pr`: a pull request body says what changed, what it cost and which consumer number
it expects to move; the secret scan runs; evidence is attached when it demonstrates
something and a sentence when it does not; no template. `safe-cleanup/SKILL.md` is
rewritten advisory with its classifier script unchanged: every guard cites its incident,
classification before deletion. `status/SKILL.md` describes the sensorium's fields and
drops `disable-model-invocation`.

## Acceptance criterion

Given slice 01 merged, when `node evals/grade-plugin.mjs plugin` runs after this slice,
then no expectation names a file under `skills/pr/`, `skills/safe-cleanup/` or
`skills/status/`; and `plugin/skills/safe-pr` does not exist; and none of the three
SKILL.md files has a `disable-model-invocation` line, an ordered list of three or more
items, or `refuse`; and `plugin/skills/pr/scripts/collect-evidence.mjs` is byte-identical
to `safe-pr/scripts/collect-evidence.mjs` before the move, and
`tests/skills/collect-evidence.test.mjs` imports it from the new path and is green in
the integration tier on the CI run; and `classify-branches.mjs` and its test are
unchanged; and `npm test` is green.

## Mechanism

- Prose, code-grade: Opus writes the three SKILL.md files. Each under 70 lines. The `pr`
  body cites the untrimmable packet incident (section 3, `safe-pr` row) and D31 for the
  cost line; `safe-cleanup` keeps its incident citations (L-05, V-02); `status` names the
  seven sensorium lines and the phase 2 decisions that fixed them.
- `pr-body-template.md` is deleted. `collect-evidence.mjs` moves unchanged; only its
  import path in the integration test changes. `render-status.mjs` does not change.
- No script change, no model call at runtime.

## Files

```aeo-independence
slice: 04-pr-cleanup-status
creates: plugin/skills/pr/SKILL.md
creates: plugin/skills/pr/scripts/collect-evidence.mjs
edits: plugin/skills/safe-pr/SKILL.md
edits: plugin/skills/safe-pr/scripts/collect-evidence.mjs
edits: plugin/skills/safe-pr/assets/pr-body-template.md
edits: plugin/skills/safe-cleanup/SKILL.md
edits: plugin/skills/status/SKILL.md
edits: tests/skills/collect-evidence.test.mjs
depends-on: 01-grader
```

Paths listed as `edits` and removed by the slice are deletions.

## Out of scope

`sprint-plan/SKILL.md` (slice 02 touches its one line). The sensorium code. Trigger
cases naming `safe-pr` (slice 06). The founder's global `~/.claude/skills/status`.
