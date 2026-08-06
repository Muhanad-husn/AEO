# Fix: four defects in the commit gate, and two cut rows in stack detection

2026-08-05. Branch `fix/phase-1/commit-gate`. Found in the Checkpoint 1 review round.
Scope: `plugin/hooks/commit-gate.mjs`, `plugin/hooks/stack.mjs`, and their tests.

## Defect 1: the docs-only classifier called executable configuration documentation

`isDocumentation` was: not under a dot-directory, and ends `.md`/`.txt`/`.rst`. The
original's `.claude/` deny was generalised along the directory axis; the extension axis
was never examined, and that is the axis the original incident turned on.

Probed in a repo whose declared test script always fails, so any real suite run blocks:

```
plugin/agents/builder.md only -> exit 0   "documentation only ... suite is not run"
requirements.txt only         -> exit 0   "documentation only ... suite is not run"
code.js (identical red suite) -> exit 2   "the node test suite is red"
```

Two holes. Agent and skill definitions are executable configuration that happens to be
Markdown, and a plugin keeps them under no dot-directory at all, so a commit rewriting
the builder's charter ran nothing during our own dogfooding. And `.txt` is a
documentation extension in prose only: `requirements.txt`, `constraints.txt`,
`CMakeLists.txt` and golden-output fixtures are all configuration, and a dependency bump
is the change most likely to turn a suite red without touching a line of source.

### The new classifier

Three tests, in order. A path under a dot-directory is configuration, unchanged. The
extension set drops `.txt` and is now `.md`/`.rst`. And a file that opens with a `---`
front-matter line is a definition, not prose.

Front matter is the property that separates the two without a name list. A role, a
`SKILL.md` and a static-site page all open with a block that something reads and acts on;
a README does not. A list of directory names (`agents/`, `skills/`) would have closed the
same hole and then rotted the first time an upstream layout renamed one.

What now runs the suite that did not before: `plugin/agents/*.md`,
`plugin/skills/**/SKILL.md`, any front-matter Markdown anywhere, `requirements.txt`,
`constraints.txt`, `CMakeLists.txt`, and every other `.txt`. What still skips it: a
README, a CHANGELOG, docs prose, `.rst`. Both halves of the point of the path survive. A
README commit does not pay for a suite run, and a repo with no manifest can still commit
its README instead of hitting a detection block.

Failing safe means running the suite when unsure, so an unreadable or deleted file reads
as code, not as prose.

## Defect 2: the suite budget was per unit, not per invocation

`commitGate` ended `for (const unit of plan.units) runSuite(unit)`, and each `runSuite`
passed `timeout: SUITE_BUDGET_MS` to its own `spawnSync`. No deadline was shared.

The whole argument for an internal budget is that the gate must observe its own overrun,
because a hook killed by Claude Code exits non-2 and a non-2 exit is non-blocking. That
holds for one unit and fails for two: N units could consume N x 570s against a 600s hook
timeout. A mono-repo commit touching a Node package and a Python package at five minutes
each triggered neither block, passed 600s, was cancelled, and the commit landed untested,
in exactly the polyglot case D10 advertises as detection's reason for existing.

One deadline is now taken at gate entry, before the file set is read, and each spawn gets
`Math.max(deadline - Date.now(), 1)`. A spent deadline still spawns, with a timeout that
expires at once, so the overrun is reported through the one existing path rather than
through a second copy of it.

## Defect 3: two resolvable stacks in one directory, first won, silently

`projectAt` did `attempts.find(a => a.command !== null)` in `STACKS` order and said
nothing about the manifest it skipped. A Django-plus-React repo with `package.json` and
`pyproject.toml` at the root ran jest and reported green; pytest never ran. That is a
quiet pass in a gate whose governing rule is loud skip, never quiet pass (L-08).

`projectAt` now returns `Unit[]`, and every manifest at the level that declares a command
is in it. Both suites run. Blocking instead would have been loud but wrong: it would be a
permanent block on a repository that has already declared everything it can, with no
escape hatch, since D10 removed the config file.

Identical commands collapse, so a project holding both a `pyproject.toml` and a `tox.ini`
that name pytest runs pytest once rather than twice. `resolveTestPlan` keys its unit map
by root and manifest instead of by root alone. `sandbox-guard.mjs` already mapped over
`plan.units`, so it needed no change and now recognises the second suite too.

## Defect 4: no reviewer exemption, so a jailed reviewer's call still ran the suite

Hooks in a `hooks.json` group run concurrently, so a jailed reviewer's `git commit`
started a full suite run alongside review-jail's block. The seal held; the side effect did
not, and under L-02 that is the class of event that killed four live runs.

`commit-gate` now returns early on `isAeoRole(payload, 'reviewer')`. The guard sits after
the protected-branch check, which costs nothing and executes nothing, and before
`changedFiles`, which is where the gate starts doing rather than deciding. The fix belongs
here rather than in the jail: the jail's block is already correct.

## PHP and .NET are cut

Both were the rows that stopped being transcription of the vendored detection table and
became design.

.NET was confirmed broken. Nearest-manifest resolution points `dotnet test` at a library
`.csproj` with no test SDK, which exits non-zero, so every commit under `src/` blocked
permanently with a message that misdescribed the cause. PHP synthesised a
`vendor/bin/phpunit` path with a `.bat` variant no other row needs.

Deleted, not fixed, under the standing over-engineering directive, and reversible in one
commit. Gone: `phpCommand`, `dotnetProject`, `DOTNET_PROJECT`, the `composer.json` and
`.csproj` rows, their two `LOOKED_FOR` entries, and their four tests. Three tests replaced
them, pinning that neither resolves and that neither is advertised in the block message.
Seven stacks remain: Node, Python, Go, Rust, Maven, Gradle, Ruby.

## One message fix, taken because the message was wrong

`MAX_SUITE_OUTPUT` overflow sets `ENOBUFS` and kills the child, so it arrived as a
signalled exit and was reported as "did not finish within the budget", which is not what
happened. Three lines, read before the overrun test, naming the overflow. The decision was
already correct in both cases: block.

## One finding recorded, not fixed

On Windows, `spawnSync`'s timeout kills `cmd.exe` and orphans the node or pytest
grandchild, which keeps running. So "the gate stopped the suite" is not true on this
platform: the gate stops **waiting** and blocks, which is the decision that matters, but
the tests are still running when it exits. Process-tree killing was not built. It is a
real cost on a long overrunning suite and it belongs in a later slice with evidence behind
it.

## Tests

`npm run test:all`, on this branch.

| tier | before | after |
| --- | --- | --- |
| fast | 103 | 106 |
| integration | 375 | 388 |
| total | 478 | 494 |

Zero failures before, zero after.

### Mutation results

Each fix was reverted in place and the suite re-run.

| mutation | failures |
| --- | --- |
| defect 1: classifier back to the old extension test | 3 of 51 |
| defect 4: reviewer guard deleted | 1 of 51 |
| defect 4: reviewer guard polarity inverted | 26 of 51 |
| defect 2: a fresh `SUITE_BUDGET_MS` per spawn | 1 of 4 matched |
| defect 3: `projectAt` returns only the first resolvable | 2 of 36 stack, 1 of 1 gate |

Deleting the reviewer guard is caught by one test, because only one case reaches it.
Inverting it, which is the failure mode sibling slices actually found twice, is caught by
twenty-six.

## Size

Gate code +43 lines net: `commit-gate.mjs` +50, `stack.mjs` -7. Tests +173 lines net. The
ratio the founder set is held; tests grew four times faster than the code they cover.
