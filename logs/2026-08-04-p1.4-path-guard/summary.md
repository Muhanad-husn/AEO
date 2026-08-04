# P1.4: path-guard

2026-08-04. Branch `feat/phase-1/p1.4-path-guard`.

## What was built

`plugin/hooks/path-guard.mjs`, a `PreToolUse` gate on `Edit` and `Write`. For an
AEO role subagent (`isAnyAeoRole`), it blocks a write whose target resolves
inside the project's own `.claude/`: the config that governs the roles is not
theirs to edit. The main session and every non-AEO agent pass through (C-02).

`tests/hooks/path-guard.test.mjs`, 35 tests, all out of process against real
exit codes.

Ported from `source/axial/dot-claude/hooks/path-guard.ps1`. That script's
`-Role` parameter and its frontmatter wiring are not carried across: there is
only one wiring now (C-01), so identity is decided from the payload alone,
the same call block-merge (P1.2) already made.

## What the gate fences, and the plugin root

The fence is a project's own `.claude/`, resolved from the **target file's**
git worktree, not `${CLAUDE_PLUGIN_ROOT}` and not the tool call's reported
cwd. Two separate reasons, not one:

- **The plugin root doesn't need fencing because it isn't reachable through
  this gate at all.** A role subagent's `Edit`/`Write` target is a project
  file. Its git toplevel is a project repository; the installed plugin's own
  files live in `${CLAUDE_PLUGIN_ROOT}`, a path outside every project
  worktree. Nothing a subagent edits ever resolves there. D12 separately
  forbids writing plugin *state* there because the path is ephemeral (moves
  on update); a stronger reason not to fence it, since there would be
  nothing stable to fence.
- **The resolution root is deliberately not `resolveWorktree(payload)`.**
  Every other Phase 1 gate resolves the directory a *command* runs in: an
  explicit `cd <dir> &&`, then the payload's own `cwd`. That answers "what
  worktree is this shell command in." A file write is different: the file
  names its own worktree, which can be a sibling of the one the subagent was
  launched in. Resolving from the reported cwd here would fence the wrong
  repository whenever those two disagree, the exact failure
  `resolveOperationDir`'s own doc comment records for Bash calls. So this
  gate walks from the target path instead: normalize it, find the nearest
  *existing* ancestor directory (the file, and its parent, may not exist
  yet), and take that directory's git toplevel. Ported faithfully from the
  PS original's own resolution order, which already got this right.

## The root-named-.claude check

`isPathInside(path.join(root, '.claude'), full)` stops matching the moment
`.claude/` is made its own git repository: `rev-parse --show-toplevel` for
anything under it then resolves to `<root>/.claude`, so the target's own
toplevel *becomes* the harness directory, and nothing under it is ever
reported as inside `<toplevel>/.claude` again: because `.claude` is no
longer a subdirectory of that toplevel, it *is* that toplevel. That is V-11:
the same failure issue #271 fenced originally, reopened with no signal at
all if the containment check is the only test.

So the gate also asks a second, independent question: is the resolved
toplevel's own basename `.claude`? (`isHarnessNamed`, case-insensitive on
Windows only, matching `isPathInside`'s own platform rule.) This is a whole
path-*segment* identity test, `path.basename(root) === '.claude'`, not
"does `.claude` appear anywhere in the root path." A checkout at
`~/.claude/plugins/aeo-checkout/` has `.claude` as an *ancestor* of its
toplevel, not as the toplevel's own name (its toplevel is named
`aeo-checkout`), so `isHarnessNamed` is false for it and the gate falls
through to the ordinary containment check, which fences only that checkout's
own `.claude/` subdirectory as normal.

**The test that proves it** is `V-11: the resolved toplevel is itself named
.claude`, in `tests/hooks/path-guard.test.mjs`. It builds a real temporary
git repository whose root directory is literally named `.claude`
(`mkdirSync(path.join(container, '.claude')); git init` inside it, no
mocking of `rev-parse`), then asserts a `Write` both directly under that
root and nested two levels down are both blocked. A second test documents in
prose (not as an assertion: there is nothing to assert against) that
`isPathInside(root/.claude, full)` alone would not have caught the direct
case, since `full` is a child of `root`, not of `root/.claude`. The
mutation battery below turns that prose into a measured claim: removing
`isHarnessNamed` from the `||` fails exactly that test and only that test's
suite.

A companion test (`a plugin checkout under a .claude ancestor`) is the
negative case named in the brief: a repo checked out under
`.claude/plugins/<name>/` writes to its own `src/` normally, and still
fences its own `.claude/` normally, proving the root-named check does not
over-fire on `.claude`-as-ancestor.

## Identity policy

Follows P1.2's precedent exactly: `isAnyAeoRole(payload)`, this plugin's
three current roles plus any future `aeo:<role>`-shaped identity, not a
hard-coded roster (P1.1: "would rot if it did"). A plain `general-purpose`
subagent is not fenced: the same accepted narrowing P1.2 recorded, for the
same reason: matching on bare `agent_type` presence would block the
orchestrator's own approved path whenever it runs under `--agent` (C-02).

One test (`a longer aeo-namespaced identity is still fenced`) exists
specifically because the first draft of the identity battery got this
backwards, copying review-jail's "unaffected" list wholesale. review-jail
uses `isAeoRole(payload, 'reviewer')`, an *exact* role match, so
`aeo:reviewer-assistant` correctly passes it: it is a different,
unrecognized role. path-guard uses `isAnyAeoRole`, which matches *any*
well-formed `aeo:<role>`, so `aeo:builder-assistant` is correctly fenced,
not foreign. The wrong expectation surfaced immediately as a real test
failure, not a latent gap: recorded here because it is exactly the kind of
near-miss the two functions' different anchoring makes easy to transpose by
accident.

## Where this gate's default posture differs from review-jail's, on purpose

review-jail denies every tool except one allowance; an unresolvable input
(a relative path with no usable `cwd`, a missing `file_path`) is denied,
because its whole product is a guarantee about what could not be read.
path-guard allows every write except one specific directory; an unresolvable
input has nothing to prove a `.claude/` write against, so it allows,
matching the PS original's own `if (-not $filePath) { exit 0 }`. Two gates,
two opposite defaults, both correct for what each is guaranteeing. Stated
explicitly in the gate's own comments so a future reader does not "fix" one
to match the other.

One deliberate widening from the original: the original's regex
(`^\.claude/`, PowerShell `-match`) does not fence a write to a path *exactly
equal to* `.claude` (no trailing segment): only to something *under* it.
`isPathInside`'s equal-paths case means this port blocks that exact case
too. Tested explicitly (`a write to the harness directory path itself, with
no further segment, is fenced`). This is strictly more conservative than
the original, has no real-world cost (`.claude` is a directory; `Write`ing a
file to that exact path fails at the OS level regardless of what any hook
decides), and using the library's containment primitive as instructed was
preferred over re-deriving the original's slash-anchored regex.

## The `hooks.json` entry, not written here

`plugin/hooks/hooks.json` is reconciled by whoever integrates the Phase 1
gates (L-04: a second writer to that file is the hazard already paid for).
This slice creates and edits nothing there. The required entry, under
`hooks.PreToolUse`:

```json
{
  "matcher": "^(Edit|Write)$",
  "hooks": [
    {
      "type": "command",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/path-guard.mjs"],
      "timeout": 10
    }
  ]
}
```

- **Exec form** (`command` plus `args`, no shell), the default for gates
  since P1.1's C-05 findings.
- **Matcher anchored to exactly `Edit` or `Write`.** A bare `"*"` would
  refire this gate on every tool call, including ones that carry no
  `file_path` at all: wasted work on every `Bash`, every `Read`, every MCP
  call. `"^Bash$"` and `"^(Edit|Write)$"` are the same idea applied to a
  different tool set.
- **`timeout: 10`.** The gate does no test run and no network: one or two
  `fs.existsSync` calls and one `git rev-parse --show-toplevel`. Matches
  review-jail's reasoning, not commit-gate's (which legitimately needs the
  600-second default because it runs the project's suite).
- **No `|| echo` fallback.** That idiom belongs on the SessionStart reporter
  alone; on a gate it converts every exit 2 into a pass.

`tests/hooks/path-guard.test.mjs` carries a registration test mirroring
review-jail's: it skips with a named reason while `hooks.json` carries no
`path-guard.mjs` entry (true today), and arms the moment one is added,
checking the matcher names both tools and the entry carries no shell
fallback.

## Mutation testing

Two deliberate mutations against the finished gate, each reverted after
confirming the result, per the sibling slice's (P1.6) finding that an
inverted gate can still leave most of a battery green.

**Mutation 1: invert the fence.** `if (inHarness)` to `if (!inHarness)` in
`path-guard.mjs`. Measured result: **21 of 35 fail, 13 pass, 1 skip.** The
13 that still pass all share one property: their code path returns or
blocks *before* `inHarness` is ever computed, so the mutation is inert for
them by construction, not by accident. Three groups:

- Identity short-circuits (tool not `Edit`/`Write`, or `isAnyAeoRole` false):
  the orchestrator, a bare `--agent builder`, a foreign plugin's role, and
  similar cases correctly stay allowed, because the gate returns at the
  identity check, above the mutated line.
- Input short-circuits (no `file_path`, unreadable payload, missing
  `tool_input`): correctly stay allowed for the same reason, one line
  earlier.
- The one case that blocks through a *different* `block()` call entirely
  ("outside any git worktree": no git toplevel resolves, so the gate
  never reaches the `inHarness` line at all).

Every test whose outcome actually depends on `inHarness`: every
`.claude/`-path and product-code-path case, both root-named-`.claude`
tests, all four containment-edge tests, all three role-name tests, the
V-11 regression, both plugin-checkout cases, both relative-path cases,
all fail. That is the polarity check working as intended: the battery is
silent exactly where the mutation is a no-op, and loud everywhere the fence
actually decides something.

**Mutation 2: replace the whole-segment containment check with a substring
match.** `isPathInside(harnessDir, full)` to `full.includes(harnessDir)`.
Measured result: **1 of 35 fails, 33 pass, 1 skip**: exactly the
sibling-prefix test (`a sibling directory sharing .claude as a name prefix
is not fenced`: now wrongly blocked, since
`<root>/.claude-evil` contains the string `<root>/.claude` as a substring).
That is the test written specifically to catch this exact substitution, and
it does, every time. The redundant-separator test does not regress under
this mutation: `String.includes` still finds the substring across a
doubled separator, so it is proving normalization survives, not that the
check is whole-segment; the sibling-prefix test is what proves the latter,
and it is the one that moves.

Both mutations were reverted with `git checkout -- plugin/hooks/path-guard.mjs`
after their run; the committed file is the original.

## Flagged, not decided here

- **Relative `file_path` resolution prefers `payload.cwd` over the PS
  original's blind `GetFullPath`.** The original resolved a relative path
  against the *hook process's own* cwd, which in a plugin can be the
  ephemeral plugin cache (D12): the same wrong-directory failure P1.1's log
  records for the worktree resolver's own last-resort fallback. This port
  prefers `payload.cwd` when it is itself absolute, and only falls back to
  `path.resolve`'s own default (the hook process's cwd) when no usable
  `cwd` is available: never blocking on this, matching the gate's
  allow-by-default posture. Two tests cover both directions of this path.
- **No hooks.json entry exists yet for this gate**, so the registration
  test skips rather than passes or fails. It is not a hole in the battery;
  it is the correct state until the integrator lands the entry above.

## Verification

`tests/hooks/path-guard.test.mjs` alone: **35 tests, 34 pass, 0 fail, 1
skip** (the `hooks.json` registration test, correctly skipped: see above).

`node --test` from the repo root, full battery: baseline going into this
slice was 325 tests, 325 pass. Confirmed post-slice: **360 tests, 359 pass,
0 fail, 1 skip** (the same registration skip counted above). No test
authored in this slice went red, and nothing outside
`tests/hooks/path-guard.test.mjs` changed status.

Named cases from the brief, all present and passing: a role subagent
blocked under `.claude/`, the same role free in product code; the
root-named-`.claude` case against a real temporary git repository, both
directly under the root and nested; a plugin-checkout path with `.claude` as
an ancestor (not the toplevel) resolving normally, including its own nested
`.claude/`; the orchestrator and a bare `--agent builder` unaffected; a
target file, and its parent directory, that do not exist yet, both outside
and inside `.claude/`; a target outside any git worktree; malformed and
empty payloads at both the `runGate` level and this gate's own
`tool_input`/`file_path` handling; trailing-separator and sibling-prefix
cases on the containment check.
