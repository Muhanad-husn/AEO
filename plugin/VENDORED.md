# Vendored skills — provenance

Five skills derive by copy from:

- **Source:** https://github.com/brainqub3/red-green-refactor
- **Commit:** `593e7abae2dc74f9a21eba3323e78a8fa9520dba` (2026-06-08)
- **Licence:** MIT (© john-adeojo). See [`UPSTREAM-LICENSE`](UPSTREAM-LICENSE).
- **Vendored:** 2026-07-31 into `source/upstream-red-green-refactor/`.

`red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-plan` and `tdd-ci` were
ported in Phase 2. Upstream also ships `tdd-harness`, which this plugin does not
carry.

## What the port changed

Adaptation reached the executable code and the assets, not only SKILL.md prose.
Sixteen files came across. Two arrived unchanged. The other fourteen diverged,
and the two scripts diverged the most.

The changes are of four kinds.

**SKILL.md prose, rewritten (94 to 179 changed lines, all five skills).** Every
`description:` was rewritten to this plugin's trigger idiom, the "Phase N"
headings were dropped, and every pointer at a sibling file moved from a bare
relative path to `${CLAUDE_PLUGIN_ROOT}/skills/<skill>/...`, which is the only
form an installed session resolves.

**New behaviour in the two scripts.** `safe-pr/scripts/collect-evidence.mjs`
gained the production-data refusal: it imports `hooks/lib.mjs` and
`hooks/sandbox-guard.mjs`, and refuses any evidence path resolving inside
`AEO_LIVE_DATA_ROOT`, with no override flag.
`safe-cleanup/scripts/classify-branches.mjs` gained a third proof that a branch
is merged (the forge's recorded merge head), a refusal when the PR query fails
or when every evaluated branch comes out deletable, and a failure line naming
the worktree holding a branch git would not delete. Its usage lines also moved
from `${CLAUDE_SKILL_DIR}` to `${CLAUDE_PLUGIN_ROOT}/skills/...`.

**Tools this plugin does not ship.** Upstream tells the reader to confirm
current syntax with `find-docs`/`ctx7`. Neither ships here, so every mention was
replaced with a pointer at official documentation. That is the entire change in
the three workflow templates, one line each, and most of the change in
`test-strategy.md` and `github-actions-guide.md`.

**Repo-agnostic defaults, and accuracy about the tiers.** Hardcoded `main` was
replaced with the resolved default branch
([D16](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)). Claims that the full suite runs
locally were narrowed to the fast tier locally plus CI for the rest
([D17](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)).
`tdd-plan/assets/plan-template.md` also gained the parallel-safety Files block
that `scripts/independence.mjs` parses, which is most of its 18 lines.
`red-green-refactor/references/red-green-refactor-philosophy.md` is two lines:
an editorial note saying the doctrine below is unedited, and where this repo's
test-tier practice differs from it.

## Byte-identical with upstream

Two files match upstream byte for byte. `tests/skills/vendored-manifest.test.mjs`
reads the table below and fails if any listed file has stopped being identical,
or if the table is empty.

| Path within the skill | Kind |
| --- | --- |
| `safe-pr/assets/pr-body-template.md` | Asset |
| `tdd-plan/references/slicing-guide.md` | Reference |

## Diverged from upstream

Changed lines are `diff | grep -c '^[<>]'` against the pinned commit, measured
2026-08-12. Nothing on this list can be taken from upstream wholesale.

| Path within the skill | Changed lines |
| --- | --- |
| `safe-cleanup/scripts/classify-branches.mjs` | 244 |
| `safe-pr/SKILL.md` | 179 |
| `safe-pr/scripts/collect-evidence.mjs` | 132 |
| `safe-cleanup/SKILL.md` | 128 |
| `red-green-refactor/SKILL.md` | 125 |
| `tdd-ci/SKILL.md` | 107 |
| `tdd-plan/SKILL.md` | 94 |
| `tdd-plan/assets/plan-template.md` | 18 |
| `tdd-ci/references/github-actions-guide.md` | 11 |
| `red-green-refactor/references/test-strategy.md` | 8 |
| `tdd-ci/assets/workflows/node-ci.yml` | 2 |
| `tdd-ci/assets/workflows/playwright-e2e.yml` | 2 |
| `tdd-ci/assets/workflows/python-ci.yml` | 2 |
| `red-green-refactor/references/red-green-refactor-philosophy.md` | 2 |

The plugin ships no file in these five skills that upstream lacks, and drops
none.

## How to re-sync with upstream

The adapted copies are the base. Upstream is not. Re-copying an upstream file
over an adapted one destroys the adaptation silently — the refusals, the
resolved default branch, the plugin-root paths — and the result still runs, so
nothing announces the loss.

So port upstream's changes forward instead of re-copying:

1. Clone upstream and diff the pin against its current head:
   `git diff 593e7ab..origin/HEAD -- .claude/skills/`. That is what moved
   upstream, and it is the only change set worth applying.
2. For each hunk, decide whether it touches something this port adapted. The
   sections above say what was adapted and where.
3. Apply the hunk into the file under `plugin/skills/`, by hand, keeping the
   adaptation. Do not overwrite the file.
4. The two files in the byte-identical table are the exception: they carry no
   adaptation, so they can be copied wholesale. Every other file cannot.
5. Refresh `source/upstream-red-green-refactor/` to the new commit, update the
   pin and both tables here, then run `npm test`. The manifest test is what
   proves the byte-identical claim is still true.
