# Divergences: what the skill claims vs what production runs

The skill under `source/global-skill/` describes the pattern. `source/axial/` is
that pattern after weeks of real use and repair. Where the two disagree,
**production is evidence and the skill is a claim.**

Fifteen divergences, found by reading both. Each is an enhancement candidate, not
a bug to fix in the source — `source/` is frozen.

---

## The three that cost something

### D-1 — the v1 red-commit escape hatch is still live

`source/global-skill/references/hooks.md` (design rule 5) says flag files are gone
in v2 and "do not reintroduce them". The live `commit-gate.ps1` still carries both
the v1 header comment and the working check:

```powershell
if (Test-Path (Join-Path $projectDir '.claude/allow-red-commit')) { exit 0 }
```

The v1→v2 migration missed it. The flag file does not currently exist, so the path
is dormant — but it is one `New-Item` from silently disabling the tests-green gate,
and the hook's own header still advertises it.

### D-13 — the gates lost both their shared library and their tests

`source/v1-archive/claude/hooks/` has `lib.ps1` plus a `tests/` directory. The v2
harness has neither: four standalone scripts that each re-implement stdin parsing
and worktree resolution, verified only by hand at a checkpoint.

Not cosmetic. **D-2 and D-3 below are exactly the drift a shared library
prevents** — the same worktree-resolution fix landed in `commit-gate`, later in
`block-merge`, and never in `format`. And a harness whose entire thesis is *no
behavioural change without a test first* ships its enforcement code untested.

### D-5 — one implementation, presented as portable

The skill says the stack is "profile-driven" and to "port to bash for POSIX
hosts". It ships exactly one implementation of every script and hard-codes
`uv run pytest` and `ruff` in the commit gate and formatter. There is no bash port
anywhere and no detection logic. The single largest generalization gap.

---

## Where production is ahead of the skill

### D-2 — `block-merge.ps1` carries two fixes the skill never absorbed

- **The git-merge matcher.** Skill: `'git\s+(\S+\s+)*merge'`. Production:
  `'\bgit\s+((-C|-c)\s+\S+\s+|-\S+\s+)*merge(?![-\w])'`. The skill's version matches
  `git merge-base` — a read-only command — and misses `git -C <dir> merge`.
- **Push branch resolution.** The skill falls back to `CLAUDE_PROJECT_DIR` and
  `$PSScriptRoot`, which the skill's *own* design rule 4 forbids. Production honours
  a leading `cd <dir> &&`, then `cwd`, then the env var, and normalises MSYS paths —
  the same resolution the commit gate uses.

### D-3 — `format.ps1` still uses `CLAUDE_PROJECT_DIR`

The same design-rule-4 violation, in the one script the fix was never applied to.
Low blast radius — a formatter that no-ops — but it teaches the wrong pattern.

### D-4 — an undocumented operator-tools layer

`source/axial/.../tools/` holds `snapshot-harness.py` (mirror the gitignored
harness to a private repo — the only rollback that exists), plus `run-monitor.py`
and `axial-watch.py`. The skill mentions the mirror pattern only in a parenthetical
migration note. Production treats it as infrastructure.

### D-11 — the snapshot tool encodes two hook-interaction landmines

Both exist only because of the gates it lives under, and both are non-obvious:

- It **must not** nest a git repo inside `.claude/`, because
  `rev-parse --show-toplevel` would then resolve to the harness directory and
  defeat the path-guard fence — the exact failure the fence's root-*named*-`.claude`
  check was later added to catch.
- It **must not** inline a literal `git commit` string into an agent-run shell
  command, because the commit gate matches on that string and would run the
  project's suite inside the harness mirror repo and block.

A gate that constrains the tooling built around it is a design consequence, not a
bug — but it is undocumented.

---

## Where the roster and the docs have drifted

### D-7 — the fourth role is orphaned

The skill's roster is four roles. Production ships four agent files but its
handbook names three: builder, reviewer, triage. `spec-author` appears in no lane,
no skill and no handbook line, has not been touched since the v2 rewrite, and its
own charter concedes small spec work belongs to the builder. Production voted by
not using it.

### D-6 — `.claude/` is gitignored, so harness edits bypass all ceremony

Production: *"`.claude/` and this file are gitignored; harness edits are live on
write, with no PR ceremony."* The skill's Phase 0 tree commits `.claude/` into the
repo. Two different postures — and the gitignored one is why the snapshot tool
(D-4) had to exist. A plugin inverts this again: the harness ships as an installed
unit rather than repo content.

### D-14 — MIT attribution is incomplete

v1 committed `VENDORED.md` and `UPSTREAM-LICENSE`
(`source/v1-archive/claude/skills/`). v2 keeps the vendored SHA in a decision-log
line and ships **no upstream LICENSE**. Acceptable in a private repo; a real
compliance question for a distributed plugin built on MIT-licensed work.
`source/upstream-red-green-refactor/LICENSE` is vendored and ready to reinstate.

### D-15 — v1's lanes were slash commands

v1 shipped `commands/{build-resume,fix,review,sprint-plan,sprint-start,triage}.md`;
v2 converted them to skills. Recorded as history rather than as an open question —
see `docs/DOCS-CURRENCY.md`, which settles it: commands have since been merged into
skills, and new plugins should ship `skills/`.

---

## Smaller, but worth carrying

### D-8 — the Node/Playwright assets are the generalization, not dead weight

`tdd-ci` ships `node-ci.yml` and `playwright-e2e.yml`, and `test-strategy.md` is
heavily Node/Playwright-flavoured with Python as one row in a detection table. In
the source product these are dormant. **For this project the reading inverts:**
they are the only multi-stack machinery in the harness, and that detection table is
the closest existing thing to the stack detection D-5 says is missing. Mine them,
do not prune them.

### D-9 — dangling tool references

`tdd-ci/SKILL.md`, `github-actions-guide.md`, `test-strategy.md` and both
non-Python workflow templates reference `find-docs` / `ctx7`, which exist in no
current environment. Inherited from upstream; they will silently no-op.

### D-10 — the operator tools duplicate product state

`axial-watch.py` pins a price table for three models that must mirror the product's
own, and hard-codes a total item count. `run-monitor.py` hard-codes seven pipeline
passes and a stall threshold tuned to one measured run. The *patterns* are good — a
live read-only dashboard, and a stall detector requiring checkpoints, logs and CPU
all flat — wrapped around un-generalizable specifics. Extract the pattern, discard
the table.

### D-12 — a name-prefix bug of a class the skill only half-warns about

`run-monitor.py` matches the *token* `axial` followed by the subcommand `run`,
because a substring match was wrong precisely since the repo lives at `D:\axial` —
every argv contains it. Same class as the skill's own "guard path-prefix checks
with a trailing separator" correction, which is stated for paths only. One rule,
stated once, would cover both.
