# Two landmines any harness-adjacent tool inherits

Read this before writing a tool that sits next to this harness: a monitor overlay, a
snapshot or mirror step, an archiver, anything that touches `.claude/` or shells out to
git on a project's behalf.

Both landmines exist only because of the gates the tool runs under. Neither is visible in
the tool's own code, and neither announces itself when it fires.

## 1. Do not nest a git repository inside `.claude/`

**The mechanism.** `${CLAUDE_PLUGIN_ROOT}/hooks/path-guard.mjs` fences a project's own
`.claude/` directory against writes by role subagents. It runs before `Edit`, `Write`,
`MultiEdit` and `NotebookEdit`. It resolves the target file to an absolute path, walks up
to the nearest ancestor directory that exists, asks git for that directory's toplevel with
`rev-parse --show-toplevel`, and blocks when the target sits inside `<toplevel>/.claude/`.

The containment test is stated relative to a git toplevel, so it is only as stable as that
toplevel. Nest a repository at or under `.claude/` and `rev-parse --show-toplevel` stops
answering with the project root and starts answering with the inner repository. A target
inside `<project>/.claude/skills/vendored/` then resolves against the toplevel
`<project>/.claude/skills/vendored`, and the string `.claude/` no longer appears anywhere
in the target's path relative to *that* root. The containment test matches nothing. The
fence is still running, still returning, and no longer fencing.

Two shapes produce it: `.claude/` is itself the repository, or something under `.claude/`
is, which is what vendoring a skill or an upstream harness as its own clone gives you.

**What the author sees.** In the shape the fence does not cover, nothing at all. A role
edits harness config and no block message appears. The tool looks like it works; the
guarantee is gone, and there is no signal to say so.

This gate carries two extra tests bought by exactly that failure, so the shapes above are
caught here: it also asks whether the resolved root's own basename is `.claude`, and it
re-runs both tests against each enclosing worktree root for as long as `.claude` is a whole
segment of the current root's path. That turns the silent version into a loud one, and the
loud one is confusing in its own right: writes to ordinary content inside a vendored clone
are refused with a message about harness config, because from the fence's point of view
that content is inside `<project>/.claude/`. The gate also pays a `rev-parse` per level to
get there, which is a cost no ordinary project pays.

**How to write the tool so it does not trip.** Keep any repository your tool creates or
clones out of `.claude/` entirely. A mirror, a snapshot repo, or a working copy belongs
beside the project or under the project's `logs/` tree, not under the harness directory.
If you must vendor something into `.claude/`, vendor the files and leave the `.git`
directory behind: the content is what the harness reads, and the history is what moves the
toplevel.

## 2. Do not inline a literal `git commit` into an agent-run shell command

**The mechanism.** `${CLAUDE_PLUGIN_ROOT}/hooks/commit-gate.mjs` runs before every `Bash`
and `PowerShell` call, and decides whether the call is a commit by matching the command
*string*: the token `git`, any run of `-C <path>`, `-c <key=value>` or other flags, then
`commit` not followed by a word character or a dash. That is a text match. It says nothing
about which repository the command targets, and `-C` does not evade it.

Once matched, the gate acts. It resolves the directory the command will run in, taking an
explicit `cd <dir> &&` first and the tool call's own working directory second, takes that
directory's git toplevel, refuses the commit if the branch is that repository's default
branch, and then resolves and runs the project's fast test suite there before letting the
command through.

So a snapshot step that runs `cd <mirror> && git commit -m "snapshot"` hands the gate a
repository nobody meant it to govern. A mirror of a project carries the project's manifest,
so detection succeeds and the whole fast suite runs inside the mirror. A mirror freshly
created by `git init` is usually sitting on its own default branch, so the gate refuses the
commit outright. And a mirror with no manifest fails detection, which is also a refusal.

**What the author sees.** A snapshot or archive step that hangs for as long as the project's
test suite takes, against the gate's own timeout. Or a block whose message is about direct
commits on a default branch, or about declaring the project's test command, naming a
directory that is not the project. Nothing in the message mentions the snapshot tool, so it
reads as a broken gate rather than as a tool that walked into one.

**How to write the tool so it does not trip.** First choice: do not use git for the tool's
own bookkeeping. A snapshot is a file copy, and a copy trips nothing. Second choice: if the
tool genuinely needs a repository of its own, put the commit inside a script the agent
invokes by name, so the command the agent runs is `node scripts/snapshot.mjs` and carries no
`git commit` text for the gate to match.

That second route has a boundary, and it is not negotiable: it is for a tool's own auxiliary
repository only. A commit that lands in the project's history goes through the gate, every
time. Moving a project commit out of the gate's sight is not a workaround, it is the defeat
of the thing the gate exists to do.

## The shape of the rule

A gate that constrains the tooling built around it is a design consequence, not a bug. The
fence has to resolve a repository root to know what `.claude/` means, and the commit gate
has to read a command string to know a commit is coming, because it runs before the command
does. Both properties are load-bearing, and both make certain tools awkward to build. The
cost is real and it is the right trade.

What was missing was writing it down. This file is that record. A tool author who reads it
first pays a small design constraint; one who does not pays with a silently dead fence or a
snapshot step that runs a test suite in the wrong repository.
