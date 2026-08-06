# Fix: resolveOperationDir returned an unresolved cd target

2026-08-04. Branch `fix/phase-1/lib-resolve`. Found in the Checkpoint 1 review round.

## The defect

`resolveOperationDir` in `plugin/hooks/lib.mjs` returned the `cd` target exactly as the
command wrote it:

```
resolveOperationDir({cwd:'D:/AEO', tool_input:{command:'cd ../elsewhere && git commit -m x'}})
  -> { dir: "../elsewhere", source: "cd" }
```

Every consumer hands `dir` to `git -C <dir>`, which resolves a relative path against the
**hook process's** working directory. The hook is not running where the command will run.
So `cd ../wt-2 && git commit` inspected whichever repository happened to sit beside the
hook, which is a real repository and therefore does not look like a failure: a real
toplevel, a real branch, and the wrong project. The commit gate then read a different
tree's run-in-progress sentinel, so L-02's protection evaluated a tree nobody was
committing to. When nothing resolved, `toplevel` came back null and the gate blocked,
which is safe. Two gates enforcing the same lesson disagreed about which repository they
were looking at.

This is V-13 reproducing itself inside the library built to prevent it. P1.5 hit the bug
during its build and fixed it **locally in `sandbox-guard.mjs`**, which left `block-merge`,
`commit-gate` and `session-status` with it. One fix, discovered once, landed in one of
four places.

## The change

`plugin/hooks/lib.mjs`, the `cd` branch of `resolveOperationDir`. Nothing else in the
function moved: `payload.cwd`, `CLAUDE_PROJECT_DIR` and `process.cwd()` are byte-identical
to before. No gate was touched.

1. A relative `cd` target is resolved against `payload.cwd`.
2. Absoluteness is decided with the **target platform's** path rules (`path.win32` /
   `path.posix`), not the host's, so a target is judged the way `git -C` would judge it
   and the tests are not host-dependent.
3. MSYS normalisation happens **before** the absoluteness test. `/d/proj` is not a drive
   to `path.win32` until it is `D:/proj`, so testing first would discard a usable base.
4. Absolute targets pass through byte-identical: POSIX-absolute, Windows drive-absolute
   (`D:\x`), UNC (`\\srv\share\x`), and MSYS after normalisation.
5. Separators unify to `/` only on win32, where both characters are separators. On POSIX
   a backslash is an ordinary character in a directory name and rewriting it would invent
   a different path.

### The unresolvable case, and why it is a failure rather than a fall-through

A relative `cd` target with no absolute `payload.cwd` returns `{dir: null, source: 'cd'}`.

It does **not** fall through to `CLAUDE_PROJECT_DIR` or `process.cwd()`. Both are
session-fixed. Handing one back would give a gate a real repository that is not the one
the command names, and the gate would then enforce confidently against the wrong tree.
That is V-02 with the sign flipped, and it is the same failure this fix removes. A null
makes every consumer stop and say so; a plausible wrong directory makes them all agree on
the wrong answer.

`source` stays `'cd'` rather than becoming `'none'`, which keeps the documented enum and
keeps the two cases distinguishable: `'cd'` with a null dir means the command named a
directory nothing could resolve, `'none'` means nothing was found anywhere. Every consumer
already treats a null dir as a stop, so no gate needs a change. `commit-gate` already
prints the source, so the failure is attributable without an edit there.

### What was deliberately not changed

A relative `payload.cwd` or `CLAUDE_PROJECT_DIR` is still returned as given. It is the
same class of unresolved value, but Claude Code sends an absolute `cwd` and that path has
never been exercised, whereas the `cd` target is written by the model and is frequently
relative, which is why this one bit. Widening the fix to cover it is a change beyond the
defect and is left for whoever can show it happening.

## After

```
{cwd:'D:/AEO',  cd ../elsewhere}                     -> D:/elsewhere        (cd)
{cwd:'/d/AEO',  cd ../elsewhere}                     -> D:/elsewhere        (cd)
{no cwd, CLAUDE_PROJECT_DIR set, cd ../elsewhere}    -> null                (cd)
{cwd:'D:/AEO',  cd D:\other\wt}                      -> D:\other\wt         (cd)
```

## Tests

`tests/hooks/lib.test.mjs`, 16 new tests. The old battery had 462 passing tests while this
sat in the most-used function in the library, because every existing case fed it an
absolute path.

- **`resolveOperationDir resolves a relative cd target`** (12). `..`, a bare name,
  `./sub`, `.`, quoted targets with spaces, the relative-target-with-MSYS-cwd combination,
  a relative target against a backslash cwd, and the four absolute forms proving they are
  untouched.
- **`... when a relative cd target cannot be resolved`** (3). No cwd, a relative cwd, and
  that the failure stays distinguishable from `'none'`. The first pins that it does not
  reach for `CLAUDE_PROJECT_DIR`.
- **`resolveWorktree`** (1). The defect itself: a child node process runs the library with
  its cwd set to a decoy directory whose sibling `wt-2` is also a real repository.
  Unresolved, `git -C ../wt-2` finds the decoy and reports a real toplevel and a real
  branch for the wrong project. The test asserts the branch is the real target's.

`initRepoAt` was extracted from the existing `makeRepo`, which now delegates to it, so the
decoy test can build repositories at exact sibling paths. A temp repo costs about ten
seconds on this machine, which is why there is one integration test rather than two.

## Mutation test

The `cd` branch was reverted to `return { dir: normalizeHookPath(raw), source: 'cd' }` and
the new tests re-run.

```
tests 16   pass 5   fail 11
```

The five that stay green are the ones that must: the four absolute-target cases, which the
mutation cannot affect, and the one that asserts only the `source` of an unresolvable
target. The decoy test fails under it, so the end-to-end path is covered and not merely
restated.

An earlier full-file run under the same mutation reported `127 tests, 114 pass, 13 fail`
with **every pre-existing test passing**, which is the point: the battery could not have
caught this, and did not, for as long as it existed.

## Counts

| | Before | After |
| --- | --- | --- |
| `npm test` (fast tier) | 103 | 103 |
| `npm run test:integration` | 359 | 375 |
| `npm run test:all` | 462 | **478** |

Nothing red. The fast tier is untouched: `lib.test.mjs` is in the integration tier, so
`npm test` alone does not exercise this change.

## For the orchestrator

`plugin/hooks/sandbox-guard.mjs` carries a now-redundant local version of this fix in
`operationDirs`. It still behaves correctly — the library now hands it an absolute path,
which its `path.isAbsolute` branch accepts unchanged — so nothing is broken and nothing is
urgent. Removing it is P1.5's slice, not this one.

No consumer gate needs a change. The one behaviour a consumer sees that it did not before
is `{dir: null, source: 'cd'}`, and all four already treat a null as a stop.
