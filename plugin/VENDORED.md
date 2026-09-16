# Vendored skills — provenance

Five skills derive by copy from:

- **Source:** https://github.com/brainqub3/red-green-refactor
- **Commit:** `593e7abae2dc74f9a21eba3323e78a8fa9520dba` (2026-06-08)
- **Licence:** MIT (© john-adeojo). See [`UPSTREAM-LICENSE`](UPSTREAM-LICENSE).
- **Vendored:** 2026-07-31 into `source/upstream-red-green-refactor/`.

`red-green-refactor`, `safe-pr`, `safe-cleanup`, `tdd-plan` and `tdd-ci` were
ported in Phase 2. `safe-pr` is gone (issue #198): its SKILL.md and its PR body
template were deleted and its collector now lives at `pr/scripts/collect-evidence.mjs`,
byte-identical with the file that moved. Upstream also ships `tdd-harness`, which this plugin does not
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

**New behaviour in the two scripts.** `pr/scripts/collect-evidence.mjs`
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

None. The last two files that matched upstream byte for byte went in Phase 3:
`tdd-plan/references/slicing-guide.md` with `tdd-plan` (#196) and
`safe-pr/assets/pr-body-template.md` with `safe-pr` (#198).
`tests/skills/vendored-manifest.test.mjs` reads this section and fails if a listed
file has stopped being identical, or if the section neither lists a file nor says
"None".

## Diverged from upstream

Changed lines are `diff | grep -c '^[<>]'` against the pinned commit, measured
2026-08-12. Nothing on this list can be taken from upstream wholesale.

| Path within the skill | Changed lines |
| --- | --- |
| `safe-cleanup/scripts/classify-branches.mjs` | 244 |
| `pr/scripts/collect-evidence.mjs` | 132 |
| `safe-cleanup/SKILL.md` | 128 |
| `references/workflows/node-ci.yml` | 2 |
| `references/workflows/playwright-e2e.yml` | 2 |
| `references/workflows/python-ci.yml` | 2 |

Paths in this table are relative to a skill directory, except the three workflow
templates, which Phase 3 moved to `references/workflows/` and which are given
relative to the plugin root. `red-green-refactor`, `tdd-plan`, `tdd-ci` and `safe-pr` were
deleted in Phase 3; their rows went with them, and what they carried that held a
measurement is now in `plugin/references/`.

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
