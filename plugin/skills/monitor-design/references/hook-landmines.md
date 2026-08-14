# One landmine any harness-adjacent tool inherits

Read this before writing a tool that sits next to this harness: a monitor overlay, a
snapshot or mirror step, an archiver, anything that touches `.claude/` or shells out to
git on a project's behalf.

This landmine exists only because of the gate the tool runs under. It is not visible in
the tool's own code, and it does not announce itself when it fires.

A second landmine used to live here — inlining a literal `git commit` into an
agent-run shell command, which the commit gate matched by text and acted on. That gate
is deleted ([D30](${CLAUDE_PLUGIN_ROOT}/DECISIONS.md)): GitHub's branch protection
covers the check it made about the protected branch, and nothing inspects a
`git commit` string before it runs any more. A snapshot or mirror tool that commits
into its own auxiliary repository trips nothing here today.

## Do not nest a git repository inside `.claude/`

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

## The shape of the rule

A gate that constrains the tooling built around it is a design consequence, not a bug. The
fence has to resolve a repository root to know what `.claude/` means, because it runs
before the command does. That property is load-bearing, and it makes certain tools awkward
to build. The cost is real and it is the right trade.

What was missing was writing it down. This file is that record. A tool author who reads it
first pays a small design constraint; one who does not pays with a silently dead fence.
