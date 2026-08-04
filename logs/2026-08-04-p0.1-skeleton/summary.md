# P0.1 — plugin skeleton

2026-08-04. Branch `feat/phase-0/p0.1-skeleton`.

## What was built

- `plugin/.claude-plugin/plugin.json` — name `aeo`, version `0.1.0` set
  explicitly, `$schema` pinned, author and a one-sentence description.
- The directory shape: `plugin/agents/`, `plugin/skills/`, `plugin/hooks/`,
  `plugin/scripts/`. The three not yet in use (`agents/`, `hooks/`,
  `scripts/`) hold a `.gitkeep` so the shape is real in the commit; no
  `commands/` directory (C-03, D9).
- Eleven skill stubs under `plugin/skills/<name>/SKILL.md`, each written
  individually with its own description and body — six operator lanes
  (`sprint-plan`, `sprint-start`, `fix`, `review`, `triage`, `status`)
  carrying `disable-model-invocation: true`, five harness skills
  (`safe-pr`, `safe-cleanup`, `red-green-refactor`, `tdd-plan`, `tdd-ci`)
  triggering on description.
- This `logs/` convention: the README documents the naming, this
  directory is the first real instance.

## Decisions made in this slice

- The five harness skills port from
  `source/upstream-red-green-refactor/.agents/skills/`, not the Axial
  production copy, per the plan's explicit instruction and the D2 finding
  that the executables are byte-identical and only the prose diverged.
- `status` has no port source (new in this project, EN-7/D5) — its stub
  states the contract and that it is not implemented until Phase 6, rather
  than porting placeholder prose from nothing.
- Every stub names its exact port path under `source/` and what has to
  change during the real Phase 2 port, so the stub is a real contract, not
  filler.

## Flagged, not decided here

- `docs/PLAN.md` names `logs/<YYYY-MM-DD>-<job>/` for this repo's job
  runs; this directory is the first one and follows that naming with no
  deviation.
- No hook script, `hooks.json`, agent file, or packaging script was
  written — all out of scope for this slice by the brief.

## Verification

`claude plugin validate ./plugin --strict` passes with exit 0. All eleven
skill directories exist with valid frontmatter; the six lanes carry
`disable-model-invocation: true`, the five harness skills do not.
