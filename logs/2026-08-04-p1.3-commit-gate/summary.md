# P1.3: commit gate and stack detection

2026-08-04. Branch `feat/phase-1/p1.3-commit-gate`.

## What was built

Two files under `plugin/hooks/`, plus their tests at the repo root.

| File | Does |
| --- | --- |
| `plugin/hooks/commit-gate.mjs` | The gate. Blocks a commit on the protected branch, and blocks a commit when the project's own test suite is red |
| `plugin/hooks/stack.mjs` | Per-change manifest walk-up detection. Resolves a test command, or resolves nothing and says what it looked for |
| `tests/hooks/commit-gate.test.mjs` | 35 tests. Real git repositories in temp directories, the gate spawned as a real process |
| `tests/hooks/stack.test.mjs` | 33 tests. Real directory trees, no mocks |

Public surface of `stack.mjs`:

| Export | Does |
| --- | --- |
| `resolveTestPlan({toplevel, files})` | `{units, missing, searched}` for a set of changed files |
| `projectAt(dir)` | The project rooted at exactly `dir`, or null |
| `LOOKED_FOR` | Every manifest name the table can match, so a gate's failure message cannot drift from the table |

`commit-gate.mjs` also exports `commitGate`, `HOOK_TIMEOUT_SECONDS` and
`SUITE_BUDGET_MS`. Importing it does not run it; the gate body runs only when
the file is the process entry point, so a test can read the timeout it requires
without spawning it.

### Why stack detection is its own module

PLAN's concurrency graph has P1.4 and P1.5 both queued behind this slice for
its stack detection, so it is shared code rather than gate-local code. It is
not folded into `lib.mjs` because two other Phase 1 slices import that file
while this one is in flight, and a second slice editing it is the collision
L-04 describes.

## The three deliberate changes from the vendored gate

### 1. The red-commit escape hatch is deleted (V-01)

`commit-gate.ps1:85` carried
`if (Test-Path (Join-Path $projectDir '.claude/allow-red-commit')) { exit 0 }`,
plus a header comment advertising it. Neither is ported and nothing replaces
either. The v1 to v2 migration missed it; the skill's own design rule says flag
files are gone and must not be reintroduced.

Two tests pin the deletion. One creates `.claude/allow-red-commit` in a repo
with a red suite and asserts the gate still exits 2. The other reads every
`.mjs` under `plugin/hooks/`, strips comment lines, and asserts the string
`allow-red-commit` appears in none of them, so the hatch cannot come back by
copy from the PowerShell.

If a red commit is ever genuinely wanted, the answer is a test marked
expected-to-fail. That is green to the gate and visible in the repo, which a
flag file is not. This is the same substitution the v1 archive's
`tests-green.ps1` had already made and documented.

### 2. The test command is detected, not hard-coded (V-05, D10)

`uv run pytest` and `ruff` are gone. Detection walks up from each changed
file's directory to the git toplevel, stops at the nearest manifest, and reads
that manifest's declared test command.

Two kinds of declaration count, and nothing else does.

**The project names its command.** `scripts.test` in `package.json`,
`scripts.test` in `composer.json`, a pytest section or a pytest dependency in
the Python config files, `rspec` in a `Gemfile`.

**The toolchain defines the command and there is nothing for the project to
name.** `go test ./...`, `cargo test`, `mvn -q test`, `dotnet test`. Reading
the manifest that pins the toolchain is reading the declaration. This is the
line that keeps the table from being a guess.

The full table, mined from `red-green-refactor/references/test-strategy.md`
(V-08), one row per row:

| Stack | Manifest | Command | Resolves when |
| --- | --- | --- | --- |
| Node | `package.json` | `npm test` | `scripts.test` is a non-empty string |
| Python | `pyproject.toml`, `pytest.ini`, `setup.cfg`, `tox.ini` | `pytest` | any of them names pytest |
| Go | `go.mod` | `go test ./...` | always |
| Rust | `Cargo.toml` | `cargo test` | always |
| Java | `pom.xml` | `mvn -q test` | always |
| Java | `build.gradle`, `build.gradle.kts` | `./gradlew test` | always; falls to `gradle test` with no wrapper |
| Ruby | `Gemfile` | `bundle exec rspec` | the Gemfile names rspec |
| .NET | `*.sln`, `*.csproj`, `*.fsproj`, `*.vbproj` | `dotnet test` | always |
| PHP | `composer.json` | `composer test` | `scripts.test` exists; else a vendored `phpunit` |

The runner prefix is read from the lockfile, which is the project's own
statement of how it invokes its tools: `pnpm-lock.yaml`, `yarn.lock` and
`bun.lock*` change `npm test` to `pnpm test`, `yarn test` or `bun run test`;
`uv.lock` and `poetry.lock` change `pytest` to `uv run pytest` or
`poetry run pytest`. `npm test` inside a bun workspace is a different command
with a different result, so this is reading a declaration rather than picking a
default.

**Resolution is per change, not per repo.** A change under `services/api`
resolves `services/api/package.json`, not the repo root's. A change spanning a
Node package and a Python package resolves and runs both, and either one being
red blocks. Twenty files in one package resolve that package once. This is what
makes a polyglot repo and a mono-repo work with no configuration, and it is
also the only portable meaning "fast tier" has, see below.

**When nothing resolves, the gate blocks and names what it looked for.** The
message carries the repository, every directory the walk examined, every
manifest name in the table, and the specific reason for any manifest that was
present but declared nothing, for example
`package.json declares no "scripts.test"`. It never guesses and never passes
quietly. That is D10's escape hatch, deliberately not a file, and L-08's rule
that an unset threshold must not make a gate silently skip.

**No config file**, per D10. If real use turns up a repo detection cannot
serve, that is evidence for a config file and it gets its own decision then,
with the failing case attached.

### 3. The documentation path no longer opens the protected branch

The original used its docs-only classification twice: to let a documentation
commit land on `main` with no branch, and to skip the suite. The first was one
repo's founder policy. A general plugin has no business punching an
extension-shaped hole in the one rule the gate exists to hold, so the protected
branch now blocks unconditionally. A test pins that.

The suite skip survives, because a commit that changes no code cannot change a
test result, and because it also lets a repository with no manifest commit its
README without hitting a detection block.

It is narrowed. Axial's classification was `.md`/`.txt`/`.rst` **or** under
`plans/` **or** under `docs/`, with a `.claude/` deny evaluated first. The
directory names are project choices and do not generalize, so they are dropped;
`docs/` in particular can hold executable examples. What ships is: every path
ends `.md`, `.txt` or `.rst`, **and** no path lies under a dot-directory at any
depth.

The dot-directory rule is the generalization of the `.claude/` deny, and the
incident behind it is worth restating because it is not obvious. Agent role
definitions and skill definitions are all `.md`, so the extension test on its
own classified the harness's own configuration as documentation, and let a
change to the rules governing every session land with no branch, no PR and no
suite run. `.agents/` is the same hazard in the upstream layout. A list of
directory names is a list that rots, so the rule is any dot-directory. The cost
is that a `.github/CONTRIBUTING.md` commit runs the suite, which is the safe
direction.

Every fail-safe case is tested: an empty file set, one non-documentation file
among documentation, markdown under `.claude/`, markdown under `.github/`, and
a git failure that empties the set. All take the strict path.

## Fast tier, and its cost stated plainly

**What the gate runs:** the project's own declared test command, at the
manifest nearest the change, with the child's working directory set to that
manifest's directory.

**What the gate does not run:** the repo-wide tree in a mono-repo, and any
acceptance or e2e layer the project keeps behind a separate script. Playwright
suites, integration directories and anything else not reachable from the
declared default command are never invoked here.

**What "fast tier" means here, and what it does not.** The scoping is the fast
tier. In a single-package repo whose declared test command runs everything, the
gate runs everything, and the way to narrow it is for the project to declare a
narrower default. The gate does not inject a filter of its own.
`pytest -m "not slow"`, `go test -short` and the original's `pytest src` were
all considered and rejected: `slow` is a convention rather than a defined
marker, `src` is one repo's layout, and a per-stack special case for the one
language that does define a short mode is an abstraction with a single
implementation. Each would be a hand-tuned constant sitting in the middle of a
stack-agnostic gate.

**The cost, which is L-06's and is not closed here.** An acceptance regression
is then only ever discovered in CI. L-06's countermeasure is owned by Phase 2,
not by this slice, and nothing here widens the default to compensate. Phase 2
inherits the description above rather than a hopeful one.

## The timeout, and why the gate keeps its own

The hooks.json entry P1.7 must write is below. The number is 600 seconds, which
is the documented default for a command hook. It is chosen rather than tuned: a
lower value would be a constant fitted to no measurement and would convert a
slow-but-passing suite into a block. Stating it explicitly puts it in one place
the gate and the manifest can both be checked against.

**What actually happens on timeout, checked against the docs on 2026-08-04.**
The field is confirmed as seconds, default 600 for `command` hooks, described
only as "Seconds before canceling". **The documentation does not say what a
cancelled hook does.** It does not state the exit code, and it does not say
whether cancellation blocks the tool call.

That silence is the whole problem. The documented rule is that exit 2 blocks
and every other non-zero exit is a non-blocking error, meaning the tool call
proceeds (C-06). A cancelled hook is killed, and a killed process does not exit
2. So the only safe reading is that a suite which overruns the hook timeout
becomes a silent pass, and the commit lands untested.

**The gate therefore does not rely on the hook timeout at all.** It runs the
suite with its own budget of 570 seconds, 95% of the hook timeout, observes the
overrun itself, and blocks with exit 2. The margin is time for the gate to
write its reason and exit, not a tuned threshold. This makes the exact hook
timeout value non-safety-critical, which is the point: the number is
documentation, the budget is the enforcement.

There is one test seam, `AEO_TEST_SUITE_BUDGET_MS`, so the fail-closed path can
be exercised in under a second instead of ten minutes. It is clamped to the
ceiling, so it can only ever shorten the budget. Lengthening it past the hook
timeout is the thing that would reintroduce the fail-open, and the clamp
forbids exactly that. Both the clamp and the overrun block are tested.

Every other way the suite can fail to produce a clean exit 0 also fails closed:
a runner that is not installed, a spawn error, and a non-zero exit all block.
The block message carries the command, the directory, the exit code and the
last 15 lines of output. The cap exists because an unbounded test log floods
the agent's context, the one L-09 lesson that does not evaporate with the
PowerShell.

## The hooks.json entry P1.7 must write

P1.7 owns `plugin/hooks/hooks.json` and writes every entry, including this one.
This slice creates no such file.

```json
{
  "matcher": "Bash",
  "hooks": [
    {
      "type": "command",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/commit-gate.mjs"],
      "timeout": 600
    }
  ]
}
```

Under `"PreToolUse"`.

- **Exec form**, `command` plus `args`, which runs with no shell and so has no
  quoting question at all. Confirmed on 2026-08-04: "A command hook runs as
  exec form when `args` is set, and shell form when `args` is omitted", and
  `shell` is "Ignored when `args` is set". The plugin-root variable
  interpolates in both forms.
- **Matcher `Bash`, with no `if:` filter.** An `if:` filter would cut the
  invocation count, and its failure mode here is safe, since failing open means
  running the gate. It is still not worth it: node starts in tens of
  milliseconds, the gate returns immediately on any command that is not a
  commit, and C-04's conclusion stands unchanged, that scripts decide from
  stdin and `if:` is never the boundary.
- **No `|| echo` fallback, ever.** P1.1 recorded this and it applies directly:
  the fallback fires on any non-zero status, so on a gate it turns every exit 2
  into a pass. It belongs on the SessionStart reporter alone.

## Decisions made in this slice

**A commit whose working directory does not resolve to a git repository
blocks.** The PowerShell fell back to the unresolved directory and carried on.
A gate that cannot find the repository can check neither the branch nor the
suite, and a gate that cannot decide does not pass the call. The commit would
have failed anyway, so this costs nothing and closes a path.

**A detached HEAD is not on the protected branch.** `currentBranch` returns the
literal `HEAD`, which never equals the resolved default, so the branch arm does
not fire and the suite arm still does. That is correct: such a commit lands on
no branch. **No normalisation was added**, locally or in `lib.mjs`. There is
still only one consumer with an opinion, and P1.1 already documents where the
normalisation would go if a second appears.

**An empty file set resolves from the toplevel rather than resolving nothing.**
`git commit --amend`, `--allow-empty` and a commit issued with nothing staged
all present an empty set. Running the widest suite the repo can resolve is the
fail-safe answer when the change cannot be scoped, and it is what stops
`--amend` becoming a way to skip the gate.

**`-a` and `--all` detection stays generous.** The regex also matches an `-a`
inside a quoted commit message. A false positive only widens the file set,
which runs more of the suite and can only turn a documentation commit into a
tested one. The safe direction.

**Paths are read with `git diff --name-only -z`.** Without `-z` git quotes and
escapes any non-ASCII path, and the quoted form does not resolve against the
filesystem, so detection would walk up from a directory that does not exist.

**The suite is spawned through a shell on Windows only.** Node cannot spawn
`npm`, `gradlew` or any other `.cmd` shim without one. Every argument comes
from `stack.mjs`'s own table and never from the model or the repo, so there is
nothing to quote-escape. One consequence: on Windows a missing runner surfaces
as a red suite with a "not recognized" line in the tail, rather than as a spawn
error. Both block.

**Commands are relative, never absolute.** `gradlew.bat`, `./gradlew` and
`vendor/bin/phpunit` are resolved against the child's working directory. An
absolute program path containing spaces is mishandled by `cmd.exe`.

## Verification

`node --test` from the repo root: **172 tests, 172 pass, 0 fail, 0 skipped**,
about 104 seconds, on Node 24.16.0. P1.1 left 104; this slice adds 68.

The cases PLAN's Phase 1 verify line names, by name:

- **A Node repo detects and runs its own test command.** Two tests, using the
  real `npm` rather than a shim, precisely because a shimmed npm would not
  prove it. A green `scripts.test` allows the commit; a red one blocks with the
  resolved command in the message.
- **A Python repo detects and runs its own test command.** Three tests. A green
  `pytest` allows; a red one blocks and the tail of the runner's real output is
  in the message; a project declaring `uv.lock` runs `uv run pytest`.
- **A repo on `master` blocks correctly.** Plus a repo on `trunk`, and a
  feature branch in a `master` repo that is correctly not blocked. Each fixture
  sets `refs/remotes/origin/HEAD` so `defaultBranch` resolves through its
  primary path rather than through whatever `init.defaultBranch` this machine
  carries.

**The fixtures assert their own branch, because of a cross-slice finding from
P1.2.** This machine's system gitconfig sets `init.defaultBranch=master`, so a
`git init` that does not pin `-b` comes up on `master`. Had the Node and Python
fixtures inherited that, the `master` case would have stopped being a distinct
condition and three tests would have asserted the same thing while all three
stayed green. Every fixture pins `-b` and sets `origin/HEAD`, and `makeRepo`
now asserts both before returning, so the collapse cannot happen silently. One
further test builds a `main`, a `master` and a `trunk` repo and asserts they
report three different branches.

A related note for whoever owns `lib.mjs` next. D14 describes the fallback
order as origin's HEAD, then the *local* `init.defaultBranch`, then `main`. The
implementation runs `git config --get init.defaultBranch`, which reads system
and global scope too. On this machine that means a repository with no `origin`
resolves its protected branch to `master` from the system config regardless of
what the repository actually uses, and the literal `main` fallback is
unreachable. That is arguably the better behaviour, since it matches what
`git init` would have produced there, but it is not what D14 says. The
fallback is tested here through a repo-local pin so the test does not depend on
the machine.

Everything else asked for: detection failing to resolve blocks and names the
manifests and the directories searched; a manifest present but declaring
nothing names the field; a red suite blocks; a green suite passes; a commit on
the protected branch blocks; `.claude/allow-red-commit` does not bypass either
arm; the documentation path and all five of its fail-safe cases; `-a` and
`--all` folding; `git commit-tree` correctly not matched; `git -C <dir> commit`
correctly matched; a leading `cd` winning over the payload cwd; a commit
outside any repository; the overrun block; and the budget clamp.

Detection has 33 tests of its own covering all nine stacks, all five lockfile
variants, six unresolvable-manifest reasons, nearest-manifest-wins, the walk
stopping at the toplevel, and one resolvable manifest winning over an
unresolvable sibling in the same directory.

## Flagged, not decided here

- **This repository will block its own commits the moment the gate is wired.**
  AEO has no `package.json`; its tests run `node --test` from the root.
  Detection therefore resolves nothing and the gate blocks every
  non-documentation commit, correctly and by design. Dogfooding starts when
  Phase 1 closes, so before that a root `package.json` declaring a `test` script
  of `node --test` is needed. It is not created here: it is a new file at the
  repo root, and two slices creating the same new file is L-04.
- **A `Makefile` target is not detected.** The vendored table's rule text names
  it alongside `package.json` `scripts.test` as a project-defined script, but
  it is not a row in the table, and `make test` existing is not something a
  Makefile declares in a way that is cheap to read. Left out deliberately. If a
  real repo needs it, it is one row.
- **The `npm init` placeholder test script resolves and always fails.** The
  generated script echoes an error and exits 1. It is a declared script, so
  detection accepts it and the gate then blocks every commit. Matching that
  literal string would be a hand-tuned constant; the correct fix is for the
  project to declare a real test script, which is also what the block message
  asks for. Worth knowing before it surprises someone.
- **P1.4 and P1.5 consume `resolveTestPlan` and `projectAt` from
  `plugin/hooks/stack.mjs`.** Neither needs anything added. If P1.5's sandbox
  guard wants the run-in-progress sentinel checked before the suite runs, the
  place is `commitGate`, immediately before the `resolveTestPlan` call, and it
  is a block rather than a skip.
- **Nothing was added to `lib.mjs`.** Two things were considered and both were
  declined for the same reason, that a second consumer does not exist yet:
  detached-HEAD normalisation for `currentBranch`, and a generic
  "run a command in a directory and classify the outcome" wrapper. The latter
  would be an abstraction with one implementation today.

