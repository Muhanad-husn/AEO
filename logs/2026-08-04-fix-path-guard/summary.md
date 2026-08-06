# Fix: path-guard defects from the Checkpoint 1 review

2026-08-04. Branch `fix/phase-1/path-guard`. Scope: `plugin/hooks/path-guard.mjs`
and `tests/hooks/path-guard.test.mjs` only. `plugin/hooks/hooks.json` was not
touched; a sibling agent owns it this round.

Four defects were raised against P1.4. Two are confirmed code defects and are
fixed, one is a gap in the battery and is closed, one is a false claim in a
comment and the comment is corrected. Two further findings are recorded as known
limits rather than fixed.

The founder's mid-slice scope constraint (fix the defect, change nothing else) is
applied throughout. Net non-comment growth in the gate is one three-line helper,
one hoisted message constant, the fence becoming a loop, and the three-line tool
widening described below. Nine tests were added and one was replaced: 35 to 43.

## Defect 1: V-11 reopens one level deeper

**Confirmed, fixed.**

`isHarnessNamed` asked only whether the resolved toplevel's own basename is
`.claude`. V-11's text is broader: a git repo must not be nested inside
`.claude/`, because `rev-parse --show-toplevel` then resolves below the project
root and defeats the fence. A repo nested *under* `.claude/` produces exactly
that, and it is what vendoring a skill or an upstream harness as its own clone
looks like. This project does it under `source/`.

Probe against the pre-fix gate, real temp git repos:

```
write to <proj>/.claude/skills/rgr/SKILL.md   -> exit 0    (toplevel: .../skills/rgr)
control: <proj>/.claude/settings.json         -> exit 2
```

The target's own toplevel is named `rgr`, so the root-named test is false, and
`<toplevel>/.claude` does not contain the target, so containment is false. Both
tests pass the write.

### How it is closed, and what it costs per call

The fence became a loop. Both tests run against the resolved toplevel; if that
root is itself enclosed by an outer worktree, both re-run against the outer root,
and again above it. The block message reports the path relative to the root that
actually fenced it, so the vendored case reads
`tried: .claude/skills/rgr/SKILL.md`.

The founder's constraint asked whether a git call on every Edit and Write was
worth it. It is not, and the loop does not make one. It turns only while
`.claude` is a whole segment of the current root's own path, a precondition that
is exactly necessary rather than a heuristic:

- An outer root named `.claude` is by definition an ancestor segment of the
  current root.
- An outer `<root>/.claude` that contains the target must also contain the
  current root. The target is inside both, two ancestors of one path are ordered
  by containment, and `<root>/.claude` is a direct child of `<root>`, so the
  current root cannot sit strictly between them.

| Case | Extra `git rev-parse` per call | Extra work |
| --- | --- | --- |
| Any repo not under a `.claude/` directory | **0** | one `split` plus `some` over the root path |
| A repo under a `.claude/` directory | 1 per level of nesting | the same scan per level |

Measured on this machine: the segment scan is about 0.35 microseconds. A
`git rev-parse --show-toplevel` under this machine's current load was 2.3
seconds, which is why paying zero of them on the ordinary path matters. Every
ordinary project write pays only the scan.

A pure string test over the toplevel path would have been cheaper still, and it
is wrong: it fences `~/.claude/plugins/aeo/`, which V-11's own text and the
founder's Defect 4 ruling both require to resolve normally. The git call is what
separates a plugin checkout (nothing encloses it) from a vendored clone (a
project does).

Termination is structural, not capped by a constant: each accepted outer root
must contain `path.dirname(root)`, so it is strictly shorter than `root`. A git
answer that is not an ancestor of the directory it was asked about, which a
resolved symlink could produce, stops the loop.

## Defect 2: blocking on inability to resolve

**Confirmed, fixed. Posture: allow, with the fence applied to the absolute
path.**

Two paths blocked on failure to resolve, contradicting the posture the gate's own
comments and the P1.4 slice record both state:

```
write to <scratchpad>/notes.md   -> exit 2   "target is not inside a git worktree"
```

That is the directory this environment instructs every agent to put temporary
files in, so a builder's first scratch write hit a wall from a gate that has
nothing to say about it.

The reviewer's suggestion is adopted. With no worktree there is no root for the
target to be relative to, so the fence runs against the absolute path instead:
block when `.claude` is a whole path segment, allow otherwise. The one thing the
old behaviour was incidentally buying is kept: on a machine where `$HOME` is not
a repository, `~/.claude/settings.json` has no toplevel and is still fenced.

The `cannot resolve a directory for the target path` block goes the same way and
for the same reason. It was the other half of the same contradiction.

The divergence from the PowerShell original is now stated in the gate at the
branch itself, rather than left undocumented. The line departed from is the
original's `if (-not $projectDir) { Block ... }`.

Three tests cover the branch: a scratch-directory allow, a `~/.claude` block
carrying the `outside any git worktree` reason, and a whole-segment table
proving `.claude-evil/`, `.claudex/` and `.claude-notes.md` are allowed on this
path too.

## Defect 3: the substring mutation was guarded in one direction only

**Confirmed, closed.**

The P1.4 battery killed `isPathInside` -> `full.includes(harnessDir)` with one
test, and that test was a fail-*closed* case: `.claude-evil/` wrongly blocked.
Nothing asserted the fail-*open* direction, which is the one that matters.

Two tests added, both named in the review:

- **Windows case variance.** `<repo>\.CLAUDE\settings.json`. `isPathInside`
  lowercases on win32 and fences it; the substring form does not, because
  `'...\.CLAUDE\...'.includes('...\.claude')` is false, so the same file on NTFS
  would be allowed. lib.mjs has a case test for the primitive, but the mutation
  *replaces* the primitive, so that test never fires.
- **A sibling table**, all fail-closed: `.claude-notes.md` as a root-level file,
  `.claudex/`, `.claude.bak/`.

One honest limit: on a case-sensitive host `.CLAUDE/` is a genuinely different
directory and must be *allowed*, so that assertion follows the platform, which is
the contract the gate states. Its mutation-killing power is therefore win32-only.
The sibling table kills the mutation on every platform, but only fail-closed.
The numbers below are from this machine, win32.

## Defect 4: a comment stated a security property the code does not have

**Confirmed. The comment is corrected; the code is not changed.** The founder
confirmed this ruling mid-slice: do not fence the plugin root.

The file asserted that `${CLAUDE_PLUGIN_ROOT}` "isn't reachable through this gate
at all." It is. A marketplace install is its own git checkout, so
`<home>/.claude/plugins/<market>/aeo/hooks/block-merge.mjs` resolves its own
toplevel, named `aeo`, and a role editing the gate that governs it is allowed
unless something above that checkout is a repository too.

Fencing it is the wrong fix. Editing `plugin/hooks/` in this repository is the
legitimate work of every slice that touches a gate, and a fence there would block
the plugin's own development to close a path nobody reaches by accident. That is
the "fix larger than its bug" tripwire.

The comment now states what is true: the plugin root is not fenced because it is
ephemeral (D12), and it is reachable, deliberately.

Noted, not acted on: the Defect 2 change narrows the exposure slightly and for
free. An installed plugin that is *not* a git checkout has no toplevel, so its
path under `~/.claude/plugins/` now hits the whole-segment fallback and is
fenced. Only a plugin that is its own checkout stays reachable. That is a
consequence of the no-worktree posture, not a fence added here.

## Late addition: the matcher had been widened past the gate

The wiring slice widened `hooks.json`'s path-guard matcher to
`^(Edit|Write|MultiEdit|NotebookEdit)$`. That widening was inert, because the gate
returned early on anything but `Edit` and `Write`, and read only
`tool_input.file_path`. The manifest was firing the gate for two tools the gate
then ignored: it reads as covered and is not, which is the C-01 shape this
project is most alert to.

Closed in three lines. `FENCED_TOOLS` is the set of four, and the target is read
as `file_path ?? notebook_path`. The shapes were checked rather than assumed:
`MultiEdit` carries `file_path` alongside an `edits` array, and `NotebookEdit`
carries `notebook_path`, which `tests/hooks/review-jail.test.mjs` already models
the same way. `NotebookEdit` is the one that would have slipped through a
matcher-only fix.

Two tests, one per newly accepted tool, each asserting a `.claude/` write blocked
and a product-code write allowed. The test helper grew a `toolInput` function
because a notebook payload cannot be built from the old inline ternary.

Note for the integrator: this worktree's own `hooks.json` still carries the
narrow `^(Edit|Write)$`, since the widening landed on a sibling branch. The gate
change is correct under either matcher, and the registration test in this file
still asserts only that the matcher names `Edit` and `Write`, so it passes
against both. Tightening that assertion belongs to whoever owns `hooks.json`.

## Recorded as known limits, not fixed

Both are now stated in the gate's own header, so neither is left implied by the
matcher or by the fence's shape.

- **Nested `.claude/` in a monorepo is not fenced.** The scope is a worktree
  *root's* `.claude/`, so `<repo>/apps/web/.claude/` passes. Directory-scoped
  skills are a live platform feature, so such a directory genuinely governs
  roles. The PowerShell original had the same root-only scope, so this is
  inherited, not introduced by the port. Widening it is a decision about the
  fence's scope, not a defect in this implementation.
- **Bash bypasses the gate entirely.** The matcher is `^(Edit|Write)$` and role
  subagents hold `Bash`, so `printf '{}' > .claude/settings.json` never reaches
  this gate. Closing it means a Bash-side redirect check, a different gate's
  surface.

## Mutation testing

Both mutations from the P1.4 record, re-run against the fixed gate and the
widened battery, each reverted after its run. The mutated line is now the fence
inside the loop.

**Mutation 1: invert the fence.**
`if (isHarnessNamed(root) || isPathInside(...))` to `if (!(...))`.

- P1.4 baseline: 21 of 35 failing.
- Now: **27 of 43 failing, 16 passing, 0 skipped.**

The 16 that still pass are inert to this mutation by construction, not by accident:
every one returns or blocks before the mutated line is reached. One empty
documentation test, three no-worktree cases (which block through the separate
segment test, not the fence), seven identity pass-throughs, the unfenced-tool
case, three malformed-payload cases, and the `hooks.json` registration test.
That accounting is exact: 1 + 3 + 7 + 1 + 3 + 1 = 16.

**Mutation 2: substring containment.** `isPathInside(path.join(root,
HARNESS_DIRNAME), full)` to `full.includes(path.join(root, HARNESS_DIRNAME))`.

- P1.4 baseline: **1** of 35 failing, and that one a fail-closed case.
- Now: **3 of 43 failing, 40 passing, 0 skipped.**

The three, and which direction each guards:

| Failing test | Direction |
| --- | --- |
| a sibling directory sharing .claude as a name prefix is not fenced | fail-closed (pre-existing) |
| siblings that extend .claude as a name prefix are not fenced | fail-closed (added) |
| a case variant of .claude follows the filesystem | **fail-open (added)** |

The last row is the point of this defect. Under the mutation, `<repo>\.CLAUDE\`
is *allowed*, which on NTFS is the harness directory itself. Nothing caught that
before. It does now.

Both mutations were reverted by the harness after each run; the committed file is
the original. Counts are leaf tests only: node's TAP output emits a `not ok` line
for each failing suite as well, and those rollups are excluded here.

## Verification

- `tests/hooks/path-guard.test.mjs` alone: **43 tests, 43 pass, 0 fail, 0
  skipped.** Was 35 tests, 34 pass, 1 skip at P1.4. The skip is gone because the
  integrator has since landed the `hooks.json` entry, so the registration test
  now arms and passes.
- `npm run test:all`: **470 tests, 470 pass, 0 fail, 0 skipped** (103 fast tier,
  367 integration tier). Baseline on this branch was 462. The delta of 8 is
  exactly this file's 35 to 43. Nothing outside `tests/hooks/path-guard.test.mjs`
  changed status.

One note on measurement, because it cost real time: node's TAP reporter emits a
`not ok` line for each failing *suite* as well as each failing test, so counting
those lines overstates failures. The counts above come from the reporter's own
`# tests` / `# pass` / `# fail` summary.
