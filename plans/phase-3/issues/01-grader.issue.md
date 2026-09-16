# feat(phase-3): the grader reads the second build's shape; agents and lane tests go [slice 01]

**Spec:** PLAN.md#5-phases, row "3 Knowledge"; PLAN.md#9-what-is-deliberately-not-built · **Plan:** plans/phase-3/01-grader.md
**Depends on:** none · **Issue:** #195
**Labels:** phase-3

## Deliverable

`node evals/grade-plugin.mjs plugin` prints one expectation per phase 3 check and passes or fails each on what is under the plugin root, with no expected count of skills or agents: no `agents/` directory, no `refuse` in a skill or reference, no `disable-model-invocation: true` outside `sprint-plan`, no ordered list of three or more items in a SKILL.md body outside `sprint-plan`, every reference citing an incident id or a number in its first five lines, and the plugin's session-start read budget under 150 lines. `plugin/agents/` is deleted. The nine tests that read the first build's lanes are deleted with the lanes.

## Mechanism

Node, `evals/grade-plugin.mjs` rewritten in place; the `{ expectations: [{ text, passed, evidence }] }` envelope stays. Removed: `EXPECTED_SKILL_COUNT`, `EXPECTED_AGENT_COUNT`, `OPERATOR_LANES`, `MODEL_ALIASES`, `checkAgents`, `checkRoleStructure`, the charter frontmatter checks. Kept: manifest, `hooks.json` reference and frontmatter parse checks. The read budget calls `measureCost` from `plugin/hooks/harness-cost.mjs` with the plugin root alone and an empty home. The lane check prints `then: <count>` as evidence, never as a pass or fail. Deleted tests: `gate-map`, `reviewer-every-pr`, `sprint-start-ordering`, `worktree-before-merge`, `push-needs-no-approval`, `packaging-surface`, `risk-rubric`, `verify/positive-control`, `plan-actors`, with their `package.json` entries. `tests/evals/grade-plugin.test.mjs` is rewritten on temp-directory fixtures. Tests first, committed red; Opus builds.

## Acceptance criterion

Given a temporary plugin root holding `sprint-plan/SKILL.md` with `disable-model-invocation: true`, one other skill whose body has no ordered list and no `refuse`, and `references/x.md` whose second line cites `L-04`, when `gradePlugin(root)` runs, then every expectation passes and the report names each of the six checks above as one expectation; and given the same root with `agents/x.md` added, or `refuses` in a skill body, or a second skill carrying `disable-model-invocation: true`, or a skill body with a `1.`, `2.`, `3.` list, or a reference with no citation, when it runs, then exactly that expectation fails and names the file; and the report prints `then: <count>` as evidence on the lane check.

## Files

```aeo-independence
slice: 01-grader
edits: evals/grade-plugin.mjs
edits: tests/evals/grade-plugin.test.mjs
edits: package.json
edits: plugin/agents/builder.md
edits: plugin/agents/monitor-designer.md
edits: plugin/agents/reviewer.md
edits: plugin/agents/triage.md
edits: plugin/agents/verifier.md
edits: tests/skills/gate-map.test.mjs
edits: tests/skills/reviewer-every-pr.test.mjs
edits: tests/skills/sprint-start-ordering.test.mjs
edits: tests/skills/worktree-before-merge.test.mjs
edits: tests/skills/push-needs-no-approval.test.mjs
edits: tests/skills/packaging-surface.test.mjs
edits: tests/skills/risk-rubric.test.mjs
edits: tests/skills/plan-actors.test.mjs
edits: tests/verify/positive-control.test.mjs
```

Paths listed as `edits` and removed by the slice are deletions.

## Out of scope

Any SKILL.md or reference (slices 02 to 05); `evals/trigger-eval.mjs` and its cases (slice 06); the manifest description (slice 06); `plugin/DECISIONS.md` stays.
