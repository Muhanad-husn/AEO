# 03: The harness cost line

Issue: [#158](https://github.com/Muhanad-husn/AEO/issues/158)

## Goal

The `harness` line prints node processes per Bash, Grep, Read and Task call, lines read at
session start, and lines of tests over lines of source, for the consumer as it is
configured on this machine.

## Acceptance criterion

Given the fixture tree `tests/fixtures/score/harness/`, holding a home directory with a
`settings.json` that runs one node hook on `^(Bash|PowerShell)$`, a plugin cache with one
enabled plugin whose `hooks/hooks.json` runs one node hook on Bash and one matcher-less
node hook, a 40-line global `CLAUDE.md`, two agent files of 30 lines each and three
skills with one-line descriptions, and a consumer with a 71-line `CLAUDE.md`, a
`pyproject.toml`, 200 lines of `.py` under `src/` and 150 under `tests/`,
when `node --test tests/scripts/score-harness.test.mjs` runs,
then the line reads `harness: bash 3 node, grep 1, read 1, task 1; session start 174
lines; tests 0.75 of source (150 / 200)`, and a consumer with no manifest reads
`tests: no manifest` in that position.

## Mechanism

- No skill or plugin fits. `tests/measure/` in this repository measures wall clock, not
  process counts.
- Library: `node:fs` over `~/.claude/settings.json`, the consumer's `.claude/settings.json`
  and `.claude/settings.local.json`, `~/.claude/plugins/installed_plugins.json` for the
  install path of every plugin the consumer's `enabledPlugins` turns on, and each such
  plugin's `hooks/hooks.json`, `agents/*.md` and `skills/*/SKILL.md`. The home directory
  and plugin root are parameters so the fixture can stand in for them.
- No model call.

## The three numbers

- **Node processes per call.** For each of Bash, Grep, Read and Task: the count of hook
  commands, across every PreToolUse and PostToolUse entry in the files above, whose
  matcher matches the tool name as a regular expression or is absent, and whose command
  starts with `node`. Disabled plugins contribute nothing. Read tools count separately
  because the target for them is zero.
- **Lines read at session start.** The global and consumer `CLAUDE.md` in full, every
  agent file of an enabled plugin in full, and the `description` line of every skill of an
  enabled plugin. This is the first build's own definition of its "about 500 lines".
- **Tests over source.** `pyproject.toml` means `.py`; `package.json` means `.mjs`, `.js`,
  `.cjs` and `.ts`. Tests are lines under a top-level `tests` or `test` directory;
  source is lines of the same extensions elsewhere, excluding `node_modules`, `.venv`,
  `source/` and anything git ignores. Printed as a two-decimal ratio with both counts.

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

Armed against unarmed counts for `sandbox-guard`, which does not exist in the second
build yet; running any hook; the harness's own cost in this repository, which the gate
prints from the same script.
