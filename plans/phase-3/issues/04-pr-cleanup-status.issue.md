# feat(phase-3): `pr`, `safe-cleanup` and `status`, advisory [slice 04]

**Spec:** PLAN.md#5-phases, row "3 Knowledge"; PLAN.md#3-what-is-kept, rows `safe-pr`, `safe-cleanup`, `status` · **Plan:** plans/phase-3/04-pr-cleanup-status.md
**Depends on:** #195 · **Issue:** #198
**Labels:** phase-3

## Deliverable

Three advisory skills the model may invoke. `plugin/skills/pr/SKILL.md` replaces `safe-pr`: a pull request body says what changed, what it cost and which consumer number it expects to move; the secret scan runs; evidence is attached when it demonstrates something and a sentence when it does not; no template. `safe-cleanup/SKILL.md` is rewritten advisory with `classify-branches.mjs` unchanged: every guard cites its incident, classification before deletion. `status/SKILL.md` names the sensorium's seven lines and drops `disable-model-invocation`.

## Mechanism

Prose, code-grade: Opus writes the three SKILL.md files, each under 70 lines. `pr` cites the untrimmable packet incident and D31 for the cost line; `safe-cleanup` keeps L-05 and V-02; `status` cites the phase 2 decisions. `pr-body-template.md` is deleted. `collect-evidence.mjs` moves to `skills/pr/scripts/` unchanged, and only its import path in `tests/skills/collect-evidence.test.mjs` changes. `render-status.mjs` does not change. No script change, no model call at runtime.

## Acceptance criterion

Given slice 01 merged, when `node evals/grade-plugin.mjs plugin` runs after this slice, then no expectation names a file under `skills/pr/`, `skills/safe-cleanup/` or `skills/status/`; and `plugin/skills/safe-pr` does not exist; and none of the three SKILL.md files has a `disable-model-invocation` line, an ordered list of three or more items, or `refuse`; and `plugin/skills/pr/scripts/collect-evidence.mjs` is byte-identical to the file before the move, with `collect-evidence.test.mjs` green in the integration tier on the CI run; and `classify-branches.mjs` and its test are unchanged; and `npm test` is green.

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

`sprint-plan/SKILL.md` (slice 02); the sensorium code; trigger cases naming `safe-pr` (slice 06); the founder's global `~/.claude/skills/status`.
