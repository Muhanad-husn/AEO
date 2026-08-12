# Fix #10: two Checkpoint 4 residues

2026-08-12. Branch `fix/10-checkpoint-4-residues`. Scope:
`plugin/skills/safe-pr/scripts/collect-evidence.mjs`,
`plugin/skills/safe-cleanup/scripts/classify-branches.mjs`,
`tests/skills/collect-evidence.test.mjs`,
`tests/skills/classify-branches.test.mjs`.

Both defects were found live against the testbed during Checkpoint 4
verification and deliberately not fixed there
([logs/2026-08-12-checkpoint-4-verification/summary.md](../2026-08-12-checkpoint-4-verification/summary.md)).
Issue [#10](https://github.com/Muhanad-husn/AEO/issues/10) carries both.

## Defect 1 — the empty evidence folder on a refusal

`collect-evidence.mjs` created `docs/tdd-evidence/<feature>/<slice>/`
with `mkdirSync` before checking whether any evidence *source*
resolved inside `AEO_LIVE_DATA_ROOT`. A refused run therefore left the
empty folder behind; git does not track empty directories, so nothing
reached a commit, but the tree was not as the refusal claimed.

Fix: the source refusal check (`refuseProductionPaths(sources, ...,
'evidence source')`) moved to run before `fs.mkdirSync(destAbs, ...)`,
not after it with a cleanup step. The evidence-folder-path refusal
(`refuseProductionPaths([destAbs], ..., 'evidence folder')`) already
ran before the `mkdir` and still does — it was never the problem, and
the issue asked that it keep holding that position, which it does
unchanged. The modality-detection block that reads `destAbs` via
`existsSync` moved earlier too, since it is read-only and returns the
same answer whether or not the folder has been created yet.

## Defect 2 — the worktree path printed twice

`classify-branches.mjs` appended `— checked out in worktree <path>` to
a `FAILED` line unconditionally whenever a worktree held the branch,
even when git's own stderr already named that same path (which, for a
"used by worktree" failure, it always does on the git version in the
testbed).

Fix: a new exported `worktreeSuffix(cause, heldBy)` decides the
suffix. It compares git's stderr against the RESOLVED worktree path —
`path.resolve(heldBy)`, then normalized for separator (`\` -> `/`) and,
on Windows, case — and returns the suffix only when that normalized
path is not already a substring of `cause`. The comparison is on the
resolved, normalized form rather than the raw strings, because
`worktreeHoldingBranch`'s answer and the path git prints can spell the
same location two ways (a trailing separator, or — cross-platform —
different case) and a naive `includes` on the raw strings would still
print the duplicate under either difference.

## Tests added

`tests/skills/collect-evidence.test.mjs`, new `describe('the evidence
folder itself', ...)`, two tests:

- a refused run (transcript inside the production data root) leaves no
  `docs/` directory at all — not just the specific file uncopied, which
  the pre-existing test already covered, but the folder itself absent;
- a successful run (transcript outside the root) still creates
  `docs/tdd-evidence/<feature>/<slice>/`.

Both cases matter together: a fix that stopped creating the folder
unconditionally would pass a test that only checked the refused case.

`tests/skills/classify-branches.test.mjs`, two new `describe` blocks:

- `worktreeSuffix — the appended text does not duplicate what git
  already said`: five unit tests against the exported function
  directly — same spelling, different separator, different case
  (Windows-only), git genuinely not naming the path (suffix appended,
  counted once in the assembled line), and no worktree at all (no
  suffix). Real `git branch -d` never fails on a worktree-held branch
  without naming the path in its stderr, so the "git does not name it"
  case cannot be driven from a live git process; it is pinned directly
  against the exported function instead, for the same reason
  `mergedAtRecordedHead` above it is pinned directly rather than
  through a shimmed `gh`.
- `a refused delete names the resolved worktree path exactly once`: an
  integration test against a real second worktree (`git worktree add`)
  and a real `git branch -d` refusal, asserting the resolved path
  appears exactly once in the `FAILED` line — not just present, which
  the pre-existing "a branch held by a second worktree..." test already
  asserted and was left untouched.

No existing test was edited.

## Verification

`node --test tests/skills/collect-evidence.test.mjs
tests/skills/classify-branches.test.mjs`: **49 tests, 49 pass, 0 fail,
0 skipped** (41 before this slice — 11 + 30 — 8 added: 2 + 6).

`npm test` (the commit gate's fast tier; these two files are not in
it, they are `test:integration`-only): **275 tests, 275 pass, 0 fail.**

## Found beyond the issue's own description

Nothing beyond what the issue anticipated. The modality-detection
block's `destHasPw` check reads `existsSync` on paths under `destAbs`
before the folder necessarily exists; this was already true on the
`--body-only` path before this change (a second-phase run against a
folder a prior `--copy-only` run created) and remains correct moved
earlier, since `existsSync` on a not-yet-created path simply answers
`false`, the same answer a fresh single-shot run always got before
today's `mkdir` ran.

## Over-engineering tripwires

None hit. No new dependency, no new flag, no hand-tuned constant.
`worktreeSuffix` and `normalizeForPathCompare` are each a single,
non-configurable comparison with one call site; `collect-evidence.mjs`
gained no new logic, only a reordering of checks that already existed.
