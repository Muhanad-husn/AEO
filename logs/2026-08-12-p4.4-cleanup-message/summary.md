# P4.4: safe-cleanup names the cause and the worktree

2026-08-12. Branch `feat/phase-4/p4.4-cleanup-message`. Scope:
`plugin/skills/safe-cleanup/scripts/classify-branches.mjs` and
`tests/skills/classify-branches.test.mjs`. `SKILL.md` was read but not
touched — it never documented the literal failure-message text, so
there was nothing there for this change to update.

Carried from Checkpoint 3 into Phase 4 (`docs/PLAN.md`, issue #7). A
live cleanup left six branches intact because stale worktrees held
them checked out, and the report gave no reason and no next command:

```
FAILED <branch> (git branch -D refused — left intact)
```

## What was built

Two additions to `classify-branches.mjs`, both scoped to the one delete
call at the bottom of apply mode:

- **`gitBranchDelete(delFlag, name)`** replaces the `gitOk(['branch',
  ...])` call at the failure site. Same command, same `-d`/`-D` flag,
  same re-verification logic above it — the only change is that stdio
  is piped instead of ignored, so a failure returns `{ ok: false,
  stderr }` instead of just `false`.
- **`worktreeHoldingBranch(name)`** runs `git worktree list
  --porcelain` and maps a branch name to the worktree path checking it
  out, or `null` if none does or the porcelain output can't be read.
  Parsed directly off the `worktree ` / `branch refs/heads/<name>`
  lines, which is a stable machine format independent of git's
  (locale-dependent) human-readable stderr text.
- **`firstLine(text)`** trims git's failure output to its first
  non-blank line, so the report stays one line per branch. A ref-lock
  failure appends a multi-line "another git process is running" essay;
  the worktree failure is one line. Only the essay gets trimmed.

The failure branch now reads:

```js
const del = gitBranchDelete(r.delFlag, r.name);
if (del.ok) { console.log(`  delete ${r.name}  (git branch ${r.delFlag})`); deleted++; }
else {
  const cause = firstLine(del.stderr) || '(git gave no reason on stderr)';
  const heldBy = worktreeHoldingBranch(r.name);
  const where = heldBy ? ` — checked out in worktree ${heldBy}` : '';
  console.log(`  FAILED ${r.name} (git branch ${r.delFlag} refused: ${cause}${where} — left intact)`);
  skipped++;
}
```

Two concrete message shapes, confirmed against a real second worktree
and a real ref-lock failure (below):

```
FAILED feat/held (git branch -d refused: error: cannot delete branch 'feat/held' used by worktree at 'C:/.../wt-held' — checked out in worktree C:/.../wt-held — left intact)

FAILED locked (git branch -d refused: error: could not delete reference refs/heads/locked: cannot lock ref 'refs/heads/locked': Unable to create '.../refs/heads/locked.lock': File exists. — left intact)
```

Outcome is unchanged: the branch stays intact either way, `skipped`
still increments, the run still continues to the next branch, and the
final summary line is untouched. No new dependency, no new flag —
`git worktree list --porcelain` is a plain subprocess call using the
same `git()`/`execFileSync` machinery already in the file.

## Why two independent signals instead of parsing git's message

Modern git's own stderr for the worktree case already names the path
(`used by worktree at '<path>'`), which made it tempting to just
surface stderr and call it done. That was rejected: git's message text
is locale-dependent and undocumented as a stable contract, so parsing
it to *decide* "this was a worktree failure" would be brittle in a way
that degrades silently — a non-English git, or a future git version
that rewords the message, would fall back to reporting a cause with no
worktree named, which is exactly today's bug in a new shape.

`worktreeHoldingBranch` instead asks git directly, through the
machine-readable `--porcelain` format, whether *some* worktree
presently holds the branch — independent of whatever git's error text
says. The issue's constraint — "if `git worktree list` fails or
returns nothing useful, still report git's stderr" — falls out of this
for free: `worktreeHoldingBranch` returns `null` on any read failure,
`heldBy` is falsy, `where` is the empty string, and the message still
carries git's own `cause`. Nothing here can produce a silent failure;
the worst case is a message that says the delete refused and why,
without a worktree line.

The other cause tested is a ref-lock failure (a stray `.lock` file
next to the branch's ref, the same mechanism that produces "another
git process seems to be running"), chosen because it reproduces a real
`git branch -D` failure that has nothing to do with worktrees, without
mocking git.

## Verification

`node --test tests/skills/classify-branches.test.mjs`: **30 tests, 30
pass, 0 fail, 0 skipped** (27 before this slice, 3 added).

The three new tests, in `describe('a refused delete reports why, and
where, instead of a generic message', ...)`:

- a branch held by a second real worktree (via `git worktree add`)
  fails with git's own stderr and that worktree's path, resolved the
  same way the script resolves it (`worktreePathFor`, a test-local
  reader of the same porcelain output);
- a ref-lock failure reports git's stderr, asserts `cannot lock ref`,
  and asserts the message does **not** claim a worktree;
- the success-path message (`delete <branch>  (git branch <flag>)`) is
  byte-for-byte unchanged.

Full suite, this branch:

- `npm test`: **234 tests, 234 pass, 0 fail, 0 skipped.**
- `npm run test:integration`: **500 tests, 499 pass, 0 fail, 1
  skipped.** The one skip is the pre-existing `hooks.json` gh-query
  group in `classify-branches.test.mjs`'s own file (unrelated to this
  change — it arms only with an authenticated `gh`).

## Manual smoke tests (ahead of writing the automated ones)

Both run against real temporary repositories, matching this file's
existing "real repo, not a shim" convention:

- `git worktree add` a second worktree on a scratch branch, then
  `--apply --yes --delete-merged`: `FAILED feat/held (git branch -d
  refused: error: cannot delete branch 'feat/held' used by worktree at
  '<path>' — checked out in worktree <path> — left intact)`, exit 0,
  branch count unchanged.
- A `.lock` file dropped next to a branch's ref, same apply run:
  `FAILED locked (git branch -d refused: error: could not delete
  reference ... cannot lock ref ... — left intact)`, no worktree
  clause, exit 0, branch count unchanged.

## Over-engineering tripwires

None hit. No new dependency, no new flag, no hand-tuned constant. The
two new functions are each a single, non-configurable git call with no
branching parameter; nothing here is an abstraction with more than the
one call site it serves. `firstLine` was the one candidate for
"unjustified addition" — added only because the ref-lock failure's raw
stderr is otherwise a five-line advisory block in a one-line-per-branch
report; it is a straight `split`/`filter`, not a heuristic.
