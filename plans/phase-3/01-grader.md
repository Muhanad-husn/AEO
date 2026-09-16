# 01: The grader reads the second build's shape; agents and lane tests go

Issue: [#195](https://github.com/Muhanad-husn/AEO/issues/195)

## Goal

`node evals/grade-plugin.mjs plugin` prints one expectation per phase 3 check and passes
or fails each on what is under the plugin root, with no expected count of skills or
agents. `plugin/agents/` no longer exists. The tests that read the first build's lanes are
deleted with the lanes they read.

## Acceptance criterion

Given a temporary plugin root holding `sprint-plan/SKILL.md` with
`disable-model-invocation: true`, one other skill whose body has no ordered list and no
`refuse`, and `references/x.md` whose second line cites `L-04`,
when `gradePlugin(root)` runs,
then every expectation passes and the report names, each as one expectation: no `agents/`
directory; no file under `skills/` or `references/` matching `\brefus(e|es|ed|ing)\b`;
no `disable-model-invocation: true` outside `sprint-plan`; no SKILL.md body outside
`sprint-plan` holding an ordered list of three or more items; every file under
`references/` citing an `EVIDENCE.md` id (`C-`, `V-`, `L-`), a `D` decision id or a
number with a unit within its first five lines; and the session-start read budget from
`measureCost` under 150 lines;
and given the same root with `agents/x.md` added, or `refuses` in a skill body, or a
second skill carrying `disable-model-invocation: true`, or a skill body with a `1.`, `2.`,
`3.` list, or a reference with no citation, when it runs, then exactly that expectation
fails and names the file;
and the report prints `then: <count>` as evidence on the lane check, not as a pass or
fail.

## Mechanism

- No skill, MCP or model call. Node, `evals/grade-plugin.mjs` rewritten in place; the
  envelope `{ expectations: [{ text, passed, evidence }] }` stays.
- Removed: `EXPECTED_SKILL_COUNT`, `EXPECTED_AGENT_COUNT`, `OPERATOR_LANES`,
  `MODEL_ALIASES`, `checkAgents`, `checkRoleStructure`, the charter frontmatter checks.
  Kept: manifest, `hooks.json` reference and frontmatter parse checks.
- The read budget calls `measureCost` from `plugin/hooks/harness-cost.mjs` with the
  plugin root alone and an empty home, so the number is the plugin's share.
- `plugin/agents/` is deleted in this slice because the read budget and the no-agents
  check both turn on it, and no other slice needs a charter.
- Deleted tests: `tests/skills/gate-map`, `reviewer-every-pr`, `sprint-start-ordering`,
  `worktree-before-merge`, `push-needs-no-approval`, `packaging-surface`, `risk-rubric`,
  `tests/verify/positive-control`, `tests/skills/plan-actors` (integration); their
  `package.json` entries go with them. `tests/evals/grade-plugin.test.mjs` is rewritten
  to the checks above on temp-directory fixtures.
- Tests first, committed red; Opus builds. The grader decides what the phase gate reads,
  so it takes the hard-slice tier.

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

Any SKILL.md or reference (slices 02 to 05). `evals/trigger-eval.mjs` and its cases
(slice 06). The manifest description (slice 06). `plugin/DECISIONS.md` stays.
