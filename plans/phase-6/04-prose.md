# 04: The skills and references no consumer loaded are gone

Issue: [#260](https://github.com/Muhanad-husn/AEO/issues/260)

## Goal

Every skill and reference audit.md marks delete is removed. Every pointer to it from kept prose is removed. The trigger cases stop naming it. plugin.json reads 0.5.0, the release diligence-reader installs for the rerun.

## Acceptance criterion

Given audit.md approved, when the marked skills and references are deleted, then grep finds no pointer to them under plugin/, `node evals/grade-plugin.mjs plugin` and `node evals/trigger-eval.mjs` run and their numbers are printed in the pull request (read, not protected), and the pull request prints prose lines under plugin/skills and plugin/references before and after, and plugin.json reads 0.5.0.

## Mechanism

Deletion and pointer edits by hand.

## Files

```aeo-independence
slice: 04-prose
depends-on: 02-audit
depends-on: 03-guards
depends-on: 05-ledger
edits: plugin/skills/build/SKILL.md
edits: plugin/skills/pr/SKILL.md
edits: plugin/skills/safe-cleanup/SKILL.md
edits: plugin/skills/sprint-plan/SKILL.md
edits: plugin/references/dispatch.md
edits: plugin/references/ci.md
edits: plugin/references/run-monitor.md
edits: plugin/references/second-reader.md
edits: plugin/references/slicing.md
edits: plugin/references/test-strategy.md
edits: evals/trigger-cases.json
edits: plugin/.claude-plugin/plugin.json
```

## Out of scope

Rewriting kept prose. new-project and status, whose commitment lines 05 removes.
