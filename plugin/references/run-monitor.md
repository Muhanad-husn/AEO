# Run monitor: sentinel, pid table, hook landmines (L-02, V-11)

This reference carries what the retired `monitor-design` skill and its `monitor-designer`
agent knew: the sentinel convention, the pid table, and the hook landmines a
harness-adjacent tool inherits. The skill and the agent are gone; this is what stays. It
answers one question from a terminal: is that long job still working.

## The pieces, by path

The generic monitor is `${CLAUDE_PLUGIN_ROOT}/scripts/run-monitor.mjs`. It reads the
structured log that `${CLAUDE_PLUGIN_ROOT}/scripts/runlog.mjs` opens under the project's
own `logs/<date>-<job>/`, and it looks for a sentinel raised by
`${CLAUDE_PLUGIN_ROOT}/scripts/run-sentinel.mjs`. None of the three is edited by a job
author; a job calls them.

## The sentinel convention

A sentinel says a long job is live in this project. While one is up, the sandbox guard
keeps a Bash invocation of the project's declared test command from running, from any
session and any worktree. L-02 is the incident behind this: because an old commit gate
ran the test suite as a side effect of every commit, four simultaneous external kills of
a live four-hour pipeline were traced to a concurrent session's routine commit. That gate
is deleted, so a commit executes nothing any more, but the underlying hazard, a second
actor's test run landing on a first actor's live job, is not about commits specifically.
The sentinel is the general guard for it, and it stays.

The usual shape, from the shell that starts the job:

    node "${CLAUDE_PLUGIN_ROOT}/scripts/run-sentinel.mjs" start <id> --what "text" --pid <n>
    ./run-the-long-job
    node "${CLAUDE_PLUGIN_ROOT}/scripts/run-sentinel.mjs" stop <id>

`--pid` is optional. Recording one is what lets a crashed job's sentinel expire on its
own once its process is provably gone; without it, the sentinel stands until someone
clears it by hand. `start` checks the pid against the operating system's own process
table before writing anything, because this is the only point in the whole chain cheap
enough to catch a bad number outright.

Raising the sentinel also feeds the monitor's third stall signal: passing `--pid` to
`run-sentinel.mjs start` is what lets `run-monitor.mjs` read CPU for the job. Skip it and
the monitor has nothing to read CPU from, the stall verdict becomes unreachable, and every
report reads `SUSPECT` with that reason stated instead.

## The pid table

Getting the pid right depends on where the job starts, and getting it wrong is worse than
leaving it out: a wrong pid does not fail loudly, it reads as a dead job. Best is not to
ask a shell at all. A Node or Python job can raise its own sentinel with `process.pid` or
`os.getpid()`, and nothing needs translating. Failing that:

| Where the job starts | The pid to record |
| --- | --- |
| POSIX shell on Linux or macOS | `--pid $$` |
| PowerShell | `--pid $PID` |
| Git Bash or MSYS on Windows | `--pid $(ps -p $$ \| awk 'NR==2 {print $4}')` |

Under Git Bash, `$$` is the MSYS process id, not the Windows one, and the CPU probe only
resolves Windows process ids. A sentinel raised with a bare MSYS `$$` records a number
nothing on the machine can look up, and an unresolvable pid reads the same as a pid that
has exited. The symptom is a live job reported `EXITED`, with a reason naming a pid that
is gone, when the job is still running. That is a wrongly recorded pid, not a dead job,
and it is worse than skipping `--pid` altogether: a missing pid degrades to `SUSPECT` and
says so, while an unresolvable one produces a confident, wrong claim that the job crashed.
`ps`'s fourth column, `WINPID`, is the number Windows knows the process by, which is what
the row above pulls out.

## Hook landmines (V-11)

Two ways a harness-adjacent tool, a monitor overlay, a snapshot or mirror step, an
archiver, anything that touches `.claude/` or shells out to git on a project's behalf,
trips a gate it runs under, both silent in the tool's own code.

- **Do not nest a git repository inside `.claude/`.** The path-guard hook fences a
  project's own `.claude/` against writes by role subagents by resolving the target file
  to its nearest git toplevel and checking whether that toplevel's `.claude/` contains it.
  Nest a repository at or under `.claude/` and `rev-parse --show-toplevel` stops answering
  with the project root and starts answering with the inner repository; the string
  `.claude/` no longer appears in the target's path relative to that root, and the fence
  matches nothing while still running and still returning. Keep any repository a tool
  creates or clones out of `.claude/` entirely, beside the project or under its `logs/`
  tree. If something must be vendored into `.claude/`, vendor the files and leave the
  `.git` directory behind.
- **Do not inline a literal `git commit` string into an agent-run shell command.** This
  one is historical: a commit gate used to match that string by text and run the suite on
  it, which is the mechanism L-02 names. That gate is deleted, and nothing inspects a
  `git commit` string before it runs any more, so a snapshot or mirror tool that commits
  into its own auxiliary repository trips nothing here today. It is left in this list
  because a tool built to work around a deleted gate is still a tool that assumed a gate
  it should have named, and the next gate added near `.claude/` may match the same way.
