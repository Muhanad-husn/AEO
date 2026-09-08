# feat(phase-0): the harness cost line [slice 03]

**Spec:** PLAN.md#5-phases, row "0 Score"; PLAN.md#7 · **Plan:** plans/phase-0/03-harness-cost.md
**Depends on:** #156
**Labels:** phase-0

## Deliverable

The `harness` line prints node processes per Bash, Grep, Read and Task call, lines read at session start, and lines of tests over lines of source, for the consumer as configured on this machine, replacing the `not measured` stub. The home directory and plugin root are parameters so a fixture can stand in for them.

## Mechanism

`node:fs` over `~/.claude/settings.json`, the consumer's `.claude/settings.json` and `settings.local.json`, `~/.claude/plugins/installed_plugins.json` for every plugin the consumer enables, and each such plugin's `hooks/hooks.json`, `agents/*.md` and `skills/*/SKILL.md`. A process is counted when a PreToolUse or PostToolUse command starts with `node` and its matcher, read as a regular expression, matches the tool name or is absent. Session-start lines are both `CLAUDE.md` files in full, every enabled agent file in full, and one description line per enabled skill. Tests over source is `.py` for a `pyproject.toml` consumer and `.mjs`, `.js`, `.cjs`, `.ts` for a `package.json` one, tests being the top-level `tests` or `test` directory, source the rest less `node_modules`, `.venv`, `source/` and git-ignored paths. No model call. Tests first, committed red; Sonnet builds.

## Acceptance criterion

Given the fixture tree `tests/fixtures/score/harness/`, holding a home directory whose `settings.json` runs one node hook on `^(Bash|PowerShell)$`, a plugin cache with one enabled plugin whose `hooks/hooks.json` runs one node hook on Bash and one matcher-less node hook, a 40-line global `CLAUDE.md`, two agent files of 30 lines each and three skills with one-line descriptions, and a consumer with a 71-line `CLAUDE.md`, a `pyproject.toml`, 200 lines of `.py` under `src/` and 150 under `tests/`,
when `node --test tests/scripts/score-harness.test.mjs` runs,
then the line reads `harness: bash 3 node, grep 1, read 1, task 1; session start 174 lines; tests 0.75 of source (150 / 200)`, and a consumer with no manifest reads `tests: no manifest` in that position.

## Files

```aeo-independence
slice: 03-harness-cost
edits: scripts/score/harness.mjs
edits: tests/scripts/score-harness.test.mjs
creates: tests/fixtures/score/harness/README.md
creates: tests/fixtures/score/harness/home/settings.json
creates: tests/fixtures/score/harness/home/CLAUDE.md
creates: tests/fixtures/score/harness/home/plugins/installed_plugins.json
creates: tests/fixtures/score/harness/home/plugins/cache/demo/hooks/hooks.json
creates: tests/fixtures/score/harness/home/plugins/cache/demo/agents/builder.md
creates: tests/fixtures/score/harness/home/plugins/cache/demo/agents/reviewer.md
creates: tests/fixtures/score/harness/home/plugins/cache/demo/skills/one/SKILL.md
creates: tests/fixtures/score/harness/home/plugins/cache/demo/skills/two/SKILL.md
creates: tests/fixtures/score/harness/home/plugins/cache/demo/skills/three/SKILL.md
creates: tests/fixtures/score/harness/consumer/CLAUDE.md
creates: tests/fixtures/score/harness/consumer/.claude/settings.json
creates: tests/fixtures/score/harness/consumer/pyproject.toml
creates: tests/fixtures/score/harness/consumer/src/pipeline.py
creates: tests/fixtures/score/harness/consumer/tests/test_pipeline.py
depends-on: 01-row
```

## Out of scope

Armed against unarmed counts for `sandbox-guard`, which the second build has not built yet; running any hook; this repository's own harness line, which the gate prints from the same script.
