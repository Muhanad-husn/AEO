# P1.5: sandbox guard

2026-08-04. Branch `feat/phase-1/p1.5-sandbox-guard`.

## What was built

| File | What it is |
| --- | --- |
| `plugin/hooks/sentinel.mjs` | The run-in-progress marker: where it lives, how it is read, how staleness is decided |
| `plugin/hooks/sandbox-guard.mjs` | A `PreToolUse` gate on Bash. Three rules, all fail-closed |
| `plugin/hooks/commit-gate.mjs` | Fourteen lines added: the commit gate refuses to cross a live sentinel |
| `plugin/scripts/run-sentinel.mjs` | Raise, list and clear sentinels |
| `plugin/scripts/sandbox-session.mjs` | The fail-closed session fixture, as a Node import and as a wrapper for any stack |
| `tests/hooks/sandbox-guard.test.mjs` | 46 tests |
| `tests/hooks/sandbox-session.test.mjs` | 14 tests |
| `.gitignore` | `/.aeo/` |

There was no PowerShell original. This gate is new, and L-02 and L-03 were the
specification.

## The two variables

```
AEO_LIVE_DATA_ROOT   the project's declaration of WHERE PRODUCTION DATA IS
AEO_DATA_ROOT        the seam: where THIS process tree reads and writes data
```

One variable cannot do this job. The guard compares an effective location
against a declared one, and with a single variable there is nothing to compare
against. Outside a Claude Code session the two are equal, which is ordinary
operator use. Inside one they must differ, and the guard is what makes "must"
mean something.

The seam is an environment variable because in-process monkeypatching never
reaches a subprocess CLI child and integration tests shell out. That is L-03's
second requirement in its own words, and an environment variable is the only
seam that crosses a process boundary unaided.

### What unset means

**`AEO_LIVE_DATA_ROOT` unset means no protection, and that is deliberate.** The
project has declared no production data, so the guard has nothing to compare
against and nothing to protect. Requiring every project to declare a production
root before it may run anything would be a config nobody sets that then blocks
everything, and the plugin would be uninstalled inside a day.

The alternative was considered and rejected. A guard that refuses until it is
configured protects a repository with no data to protect, and teaches the
operator that the guard is an obstacle. What makes the gap acceptable is that
the consequence is bounded and visible: a project with production data on the
machine has one edit to make, in `.claude/settings.json`, and P1.7's status
reporter is the natural place to say whether it has been made. That is a
follow-up worth taking, not a hole in this slice.

**`AEO_DATA_ROOT` unset, with a live root declared, is a block.** That is not
symmetry, it is L-03's second incident stated exactly: a lookup that falls
through to a *default* directory when its argument is omitted. If the seam is
unset the project's own defaults decide where data resolves, and a gate cannot
see inside a child process to check. So it refuses.

**Blank and whitespace read as unset** in both variables. **Set but relative
blocks in both**, because a relative seam resolves against whatever working
directory the child happens to have, and a relative production root gives the
guard no location to compare against at all.

## The sentinel

### What it is, and where

A JSON file per live run at `<repo>/.aeo/runs/<id>.json`, in the project repo,
gitignored (D12). It must be visible to every session and every worktree of the
project, which rules out `${CLAUDE_PLUGIN_ROOT}`, which is ephemeral and changes
on plugin update, and rules out any per-session temp directory.

```json
{
  "id": "corpus-ingest",
  "what": "full corpus ingest, ~4h",
  "started": "2026-08-04T09:12:03.221Z",
  "pid": 48212,
  "host": "Sandman"
}
```

**One file per run, not one file.** Two long jobs can be live at once. With a
single shared file, job B's start overwrites job A's marker and job B's finish
clears it while A is still running, which removes the guarantee at exactly the
moment it is load-bearing. A directory of per-run files makes start and stop
composable and costs one `readdir`. This is a data layout rather than an
abstraction, so tripwire 2 does not apply; the single-file version has a
concrete correctness bug under the founder's own four-worktree routine.

**It is shared across worktrees.** A linked worktree records
`gitdir: <main>/.git/worktrees/<name>` in its `.git` file, and `projectAnchor`
reads that file to resolve back to the main checkout. It reads the file rather
than spawning `git rev-parse --git-common-dir`, because this gate runs before
every single Bash call and a process spawn there is a cost paid on every tool
use. A test raises a sentinel in a main checkout and asserts that both gates
fire from a sibling worktree.

### Staleness

**Liveness is decided by the recorded owner process, never by an age.** An
age-based expiry would be a hand-tuned constant that is wrong in both
directions: a six-hour job outlives a four-hour TTL, and a crashed job blocks
for the whole TTL anyway.

A sentinel is **stale**, and does not block, only when all three hold: its
`host` is this machine, its `pid` is a positive integer, and that process is
provably gone. Everything else blocks.

| State | Result |
| --- | --- |
| `host` is another machine | Blocks. The process cannot be checked from here |
| No `pid` recorded | Blocks. It never expires on its own |
| The recorded `pid` exists | Blocks |
| The file does not parse, or is not an object | Blocks, naming the file |
| The directory is unreadable for any reason other than "not there" | Blocks |
| The directory is absent | Allows. This is the ordinary state of a repository |

Pid reuse can make a dead run look live. That direction blocks a commit rather
than killing a pipeline, so it is the direction to be wrong in.

A stale sentinel is reported on stderr by both gates and is **never deleted by a
gate**. A gate that removes files can remove the wrong one, and this code runs
on the block path.

### Who creates and clears it, and why `--pid` is opt-in

The long job's own launcher creates it and clears it. `run-sentinel.mjs start` /
`stop` is the shipped writer, and Phase 3's run logging is where it will
naturally be called from. The guard only ever reads.

**`--pid` is absent by default, and that was the one genuinely hard call in this
slice.** A recorded owner is what lets a crashed job's sentinel expire on its
own, so the temptation is to default it to `process.ppid`. That is wrong more
often than right: `start` is usually run as its own Bash command, and the shell
that ran it exits immediately, so the sentinel would go stale seconds into a
four-hour job. A sentinel that expires while the job is running is precisely the
failure the mechanism exists to prevent. So the default is no pid, the sentinel
stands until someone clears it, and auto-expiry is available to a caller that can
vouch for a pid:

```
node run-sentinel.mjs start corpus-ingest --what "full ingest, ~4h" --pid $$
```

The cost of that default is a stuck sentinel after a crash. The mitigation is
that clearing has to stay trivial and legitimate: **every block message names the
file, the run, and the one command that clears it.** A sentinel nobody can clear
becomes a thing people delete reflexively, and that is how a guard dies.

### What was changed in `commit-gate.mjs`

One import and one block, placed exactly where P1.3 said to put it: in
`commitGate`, immediately before the `resolveTestPlan` call.

```js
const liveRun = runInProgress(projectAnchor(toplevel));
for (const line of liveRun.notes) note(`commit-gate: ${line}`);
if (liveRun.reason !== null) block(liveRun.reason);
```

Nothing else in that file moved, and P1.3's own battery is unchanged and green.

**It sits after the documentation-only return, on purpose.** A docs-only commit
runs no suite and cannot disturb a live job. The runbook's blanket "no commits"
is a human standing in for "no test execution"; the gate enforces the mechanism.
Holding a note-taking commit for four hours is what teaches people to delete the
sentinel, and the notes written during a four-hour run are written *because* of
the run. A test asserts a docs-only commit is allowed while a sentinel is live,
and asserts it took the docs-only path rather than passing by accident.

## The three rules, and why the seam rule fires on everything

| Rule | Fires on | Blocks when |
| --- | --- | --- |
| The sentinel | A command invoking the project's declared test command | A run is live, unreadable, or undecidable |
| The seam | Every Bash command | A production root is declared and the seam is missing, relative, or overlapping it |
| Named paths | Every Bash command | A token resolves inside the production root |

The seam rule deliberately has **no command classification**. A gate that had to
recognise "this command runs the project's code" would be a classifier whose
failure mode is silent under-blocking, which is the L-08 shape this project is
most alert to. There is nothing to classify: a session whose declared seam points
into production data is misconfigured as a whole, and blocking at its first Bash
call with a message naming the fix is a one-time setup block rather than a
per-command tax. Once both variables are set in `.claude/settings.json` the rule
never fires again. That is the same reasoning P1.6 used for a relative packet
directory blocking every tool, arrived at from the other end.

The sentinel rule does need to recognise a suite, and it takes that from
`stack.mjs`'s detection rather than from a table of its own. Recognition is
deliberately generous: the declared command's tokens as an ordered subsequence,
**or** its final program token alone, both whole-token (V-12). That catches
`npm test`, `uv run pytest`, a bare `pytest -k x`, and `go test ./pkg` where the
declared command was `go test ./...`.

Two honest limits on that recognition:

- Where a project's declared command ends in a script name rather than a program
  name, `npm test` being the case, a command merely containing the word `test` as
  a token also matches. During a live long job that costs a clear message on a
  rare command. Over-blocking is the direction to be wrong in.
- `npm run test:unit` is **not** matched, because `test:unit` is not the token
  `test`. The backstop is the commit gate, which refuses to cross a live sentinel
  with no recognition involved at all, and which is the mechanism L-02 names.

`ls`, `git status`, `git log` and `cat` are not held by a live sentinel. Four
hours of no Bash at all is what produces the reflexive deletion described above.

## Symlinks, and why they are a data-loss hole here

`isPathInside` compares strings and never calls `realpath`. For the review jail
an unresolved comparison costs a review. Here it costs the guarantee: a link into
production data walks straight past an unresolved check, and what it reaches
cannot be un-deleted. Both sides of every comparison go through a resolver that
realpaths the deepest existing ancestor and re-appends the rest, so a path that
does not exist yet still resolves correctly.

Four tests use a real directory link: a seam that is a link onto production data,
a production root declared under an alias while the command uses the real name, a
command reaching production data through a link, and a link planted inside the
sandbox that points back at production data. Each skips on a platform that will
not create a directory link.

Containment is checked **both ways** for the two roots. A seam of `D:/` is not
inside `D:/production`, and every byte of production data sits inside it.

## Who the guard applies to

**Everyone, the orchestrator included. There is no identity test in the file.**

`block-merge` exempts the orchestrator because a founder-approved merge is a real
workflow with a human in the seat. A founder-approved run against production data
during a live job is not a workflow; it is the incident. And the four kills in
L-02 came from *a concurrent session*, which is a property of the machine rather
than of a role. Six identities are pinned by a test: no `agent_type` at all, all
three AEO roles, a bare `--agent` name, a built-in agent, and another plugin's.

## There is no override

No environment variable and no command flag turns any rule off, and neither does
`bypassPermissions`. Eleven plausible disabling variable names and six plausible
flags are pinned by tests. That is L-05 applied: the garbage collector was fixed
by raising before any confirmation, logging or removal, **with no bypass**,
because an override is what you reach for at 2am.

## The fail-closed session fixture, and how much of it is portable

`plugin/scripts/sandbox-session.mjs` has two modes.

- **Wrapper**, for any stack: `node sandbox-session.mjs -- pytest tests/`. It
  creates the sandbox root, asserts before anything runs, spawns the command with
  the seam in its environment, and removes the root afterwards.
- **Import**, for Node runners: `enterSandbox()` returns `{root, live, leave}`
  and throws before a single test runs if it cannot point away.

Every failure throws **before** the command starts. The mitigation that existed
in production restored state *after* the damage; this refuses before it.

### Honestly, what is stack-agnostic

| Piece | Portable? |
| --- | --- |
| The contract: two variable names, the containment rule, an assertion that runs first | Yes, to anything |
| The wrapper | Yes, to anything that can be spawned |
| `enterSandbox` as an import | **No. Node only** |
| Repointing the project's default resolvers | **No, and not by any plugin in any language** |

The last row is the important one, and it is why this is a fixture rather than a
solution. L-03's first requirement is "repoint **every** default-directory
resolver, not just the obvious data root". A fixture can set one variable. It
cannot reach a module-global computed at import time, which is exactly what
incident one was.

The portable generalisation of that requirement is not a longer list of
variables. It is **one root with every other directory derived from it**: logs at
`<root>/logs`, the index at `<root>/index`, state at `<root>/state`. The incidents
happened because several roots resolved independently, so repointing one left the
others live. Collapsing them to one is a project-side change in the project's own
language, and it is what makes a one-variable seam sufficient.

For other runners the equivalent of the import mode is a few lines each: a
`conftest.py` autouse fixture, a Vitest `globalSetup`, a Go `TestMain`, written
against the same two variables. Shipping a `conftest.py` here would have been the
Python-only artifact the brief warns about, and the third time this project
hard-coded a Python assumption (V-05).

## The `hooks.json` entry that must be written

`plugin/hooks/hooks.json` was not created or edited here; whoever reconciles it
owns it, and a second writer is L-04. The required entry adds one hook to the
**existing** `^Bash$` `PreToolUse` group, alongside `commit-gate` and
`block-merge`:

```json
{
  "type": "command",
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-guard.mjs"],
  "timeout": 10
}
```

- **Exec form**, `command` plus `args`, no shell. The established default.
- **`timeout` in seconds.** Ten is generous: the gate spawns no process, runs no
  git, and does a handful of `existsSync` calls plus one `readdir`. A long default
  on a gate that runs before every Bash call is a hang waiting to happen.
- **No `|| echo` fallback.** It fires on any non-zero status and would convert
  every exit 2 into a pass.
- The brace form and the `.mjs` suffix are required, or `preflight()` reports
  "registers no gate scripts".

A test in `tests/hooks/sandbox-guard.test.mjs` skips while the entry is absent and
arms the moment it lands. It then asserts exactly one entry runs
`sandbox-guard.mjs`, that its matcher covers Bash, that the entry carries no shell
fallback, and that it references `${CLAUDE_PLUGIN_ROOT}/hooks/…`.

## How this gate could silently stop firing

| Failure | Covered |
| --- | --- |
| The seam is unset and the guard reasons its way to "allow" | Yes. Unset with a declared live root is a block, not a pass |
| A production root is declared but unusable | Yes. Relative values block every command |
| Containment is compared as a substring | Yes. A sibling named `production-test` is not inside `production`, asserted for both the seam and a named path |
| Containment is checked one way only | Yes. A seam that is the parent of production data blocks |
| A link makes two names for one directory compare unequal | Yes, four tests using a real directory link |
| A sentinel from another machine, or with no pid, is treated as stale | Yes. Six undecidable records all block |
| A crashed job's sentinel blocks forever with no way out | Partly, and by design. See the `--pid` discussion above |
| A corrupt sentinel file is skipped | Yes. Four malformed bodies block, in both gates |
| One run's stop clears another run's sentinel | Yes |
| A sentinel is invisible from a sibling worktree | Yes. A real `git worktree add`, both gates |
| An override is added later | Yes. Eleven variables, six flags, `bypassPermissions` |
| The orchestrator is exempted | Yes. Six identities all blocked |
| A relative `cd` target resolves against the hook's own working directory | Yes, and this was a real bug the battery found. See below |
| The gate is not registered | Partly. The test exists and skips until the entry lands |
| The payload is malformed | **No, and by inheritance.** See below |
| A sentinel file not named `*.json` | **No.** Entries without that suffix are skipped. The writer always uses it, and treating a stray `.gitkeep` as a live run would be worse |

### The bug the battery found

`cd sub && npm test` passed while a sentinel was live. `resolveOperationDir`
prefers a leading `cd <dir> &&`, because a `PreToolUse` hook sees the command
before it runs (V-02), and that target is frequently relative. Resolving it would
have resolved it against the **hook's** working directory, which is not anywhere
the command will be, so the sentinel directory was never found. It is now
resolved against `payload.cwd`, and both directories are checked: `cd elsewhere
&& npm test` still burns this machine while a job is live here.

### The one that is not closed

**A malformed payload allows.** `runGate` treats an unparseable payload as a
platform fault and exits 0 with a line on stderr. That is P1.1's decision, and it
is correctly reasoned there: the model cannot cause it, because Claude Code
serialises the payload and every model-controlled string sits inside valid JSON.

This gate is stricter than the default **everywhere else**, and the difference is
worth stating precisely. `runGate`'s allow-on-malformed covers the case where the
gate cannot read its input at all. Every case where the gate *can* read its input
and cannot decide, meaning an unset seam, a relative root, an unparseable
sentinel or an unreadable sentinel directory, is a block. The inherited behaviour
is pinned by a test over six malformed inputs rather than assumed, so a payload
shape change turns the battery red.

Two further residuals inherited from P1.1: a crash at module scope exits 1, which
is non-blocking, and a gate that calls `process.exit` owns its code. This gate
never calls `process.exit`.

## Mutation testing

Three mutations were applied to the finished battery. Each turned it red.

| Mutation | Result |
| --- | --- |
| **M1** The sentinel never blocks: `if (reason === null) continue;` becomes `continue;` in the guard, and the commit gate's `block` is made unreachable | **13 of 60 tests fail** |
| **M2** The data rules never block: `if (!live.set) return;` becomes `return;` | **21 of 60 tests fail** |
| **M3** Whole-segment containment replaced by a substring match, in both `overlaps` and the named-path rule | **1 of 60 tests fails** |

**M3 is the thin one, and it was made less thin.** A single test carried the
whole substring mutation. It asserted two shapes at two call sites, which is
more coverage than one line of output suggests, but one test standing between
this gate and a containment bug is a narrow margin for something whose product
is a guarantee about data. A third assertion was added to it: a directory whose
name is a *prefix* of the production root's name, `<base>/produc` against
`<base>/production`, which the other of the two substring comparisons gets
wrong. M3 was then re-run and still turns the battery red. M1 and M3 were
re-measured after that addition; M2's number predates it and cannot have moved,
because the case added is an allow case and M2 blocks nothing.

Two of the three mutations are caught broadly, which says the battery is
asserting the rules rather than the incidental behaviour around them. The M1
result is the one worth noting for a different reason: thirteen distinct tests
fail, and they include the four in `no override`, which means the no-override
guarantee is tested against the sentinel rule rather than only against the data
rule.

## Verification

`node --test` from the repo root: **385 tests, 384 pass, 0 fail, 1 skipped**, on Node 24. 325 before this slice,
so 60 added, and the single skip is this slice's `hooks.json` registration test
waiting for its entry.

A second root run, taken after the M3 assertion was added, reported two failures
and both were in `tests/hooks/session-status.test.mjs`: `a populated gh answer
lists items, not unknown` and `surfaces the most recently written summary.md,
capped at 8 lines`. That is the known flake in that file, which another slice is
fixing; the same run reports every test in this slice green, and the run above
had the same file passing. Nothing in this slice touches it: those tests build
their own repository in a temp directory.

The two cases PLAN's verify line names, both present and passing:

- `the verify line > the sandbox guard blocks a run pointed at production data`.
  Three shapes, each exit 2 with its own reason on stderr: the seam inside
  production data, no seam at all, and the command naming production data
  outright.
- `the verify line > the commit gate blocks a commit attempted while the sentinel
  is set`. Exit 2, with the run's description and the clearing command on stderr.
  Its control asserts the same commit without a sentinel blocks for a *different*
  reason, which is what proves the sentinel check fired on its own merits rather
  than inheriting somebody else's block.
