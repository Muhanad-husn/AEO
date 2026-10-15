# AEO

A Claude Code plugin that runs a solo-operator AI software shop: a builder
takes work test-first from a GitHub issue to a pull request, on-demand
reviewer and triage roles check it, and hooks enforce the merge and test
rules deterministically instead of by prompt. You stay in the merge seat.
Nothing in this plugin merges a pull request or pushes to your default
branch.

## Before you install: Node is required

Every gate this plugin ships is a Node script, invoked directly by
`hooks/hooks.json`. If Node is not on `PATH`, Claude Code cannot start the
gate process, and a hook that fails to start exits non-zero without exiting
2, which Claude Code treats as non-blocking. The tool call proceeds. Nothing
is refused, nothing is logged as refused, and nothing tells you that.

So this is not a soft recommendation: **install Node 18 or later and put it
on `PATH` before you install this plugin.** A `SessionStart` hook checks for
you and prints one line if it can't find Node:

```
[AEO] GATES NOT ENFORCING: node did not resolve, so every AEO hook fails open.
Install Node 18+ on PATH and restart Claude Code.
```

If you ever see that line, treat the session as ungated until it's fixed.

## Install

A Claude Code marketplace is a repository that publishes plugins, and this
repository is one. The whole mechanism is a single file,
`.claude-plugin/marketplace.json` at the root: it names a marketplace called
`aeo` and one plugin, also called `aeo`, whose source is the `plugin/`
directory of this repository at a release tag. There is no build step, no
release artifact, and nothing to download by hand.

The repository is public. Anyone can install it, and no account, token, or
collaborator access is involved.

### Versions: you install a release tag

The current release is **v1.0.1**, which fixes the session-start harness line outside a git repository. Phase 6 removed the rules that two live runs showed
never stopped real harm, and the trimmed plugin was scored on a consuming project.

**The tag pins your install.** The marketplace entry fetches `plugin/` from
the release tag it names, so a merge to `main` changes nothing you install.
A new release reaches you only after a later pull request moves the entry to
the new tag and the plugin updates, for example with
`claude plugin update aeo@aeo`.

From inside a Claude Code session:

```
/plugin marketplace add Muhanad-husn/AEO
/plugin install aeo@aeo
```

Or from a shell, with the CLI:

```
claude plugin marketplace add Muhanad-husn/AEO
claude plugin install aeo@aeo
```

The first command clones this repository and registers it as a marketplace
named `aeo`. The second installs the `aeo` plugin that marketplace publishes.
`aeo@aeo` is `plugin@marketplace`, and both happen to be called `aeo`, so the
doubled name reads like a typo and is not one.

The install lands in Claude Code's own plugin directory. It does not write
into whichever repository you happen to be working in.

### What that installs

Five skills and one gate script, with a session-start reporter, wired to two
hook events: `SessionStart` and `PreToolUse`. There are no agent charters.

**One skill is operator-invoked only:** `/aeo:sprint-plan`. It runs when you
type the command and never on its own, no matter what you say to Claude. The
other four trigger on their descriptions, so Claude reaches for them
mid-session without being asked. There is no `/aeo:status` command; the
status readout prints by itself at the start of every session.

## Uninstall

```
claude plugin uninstall aeo@aeo
claude plugin marketplace remove aeo
```

This removes the plugin and the marketplace registration, but not the
installed copy Claude Code keeps at `~/.claude/plugins/cache/`. That cache
is Claude Code's, not this plugin's, and uninstall doesn't reach it. Run
`claude plugin prune` afterward to clear it — that also clears any other
orphaned plugin caches Claude Code is holding, not just this one.

## The skills

| Skill | How it runs | What it does |
| --- | --- | --- |
| `sprint-plan` | `/aeo:sprint-plan` only | Decomposes a phase of the spec into a sprint backlog of GitHub issues, each body drafted to disk for your review before anything is filed. |
| `new-project` | on description | Stands up a new repository with its goal written down, to one green commit on `main`, and prepares branch protection. |
| `build` | on description | How a change to existing code is made here: a bug, a small fix, a rename, a config tweak, a behaviour a slice plan names. |
| `pr` | on description | Opens a pull request on a green branch, with a body that says what changed, what it cost and which number it expects to move. |
| `safe-cleanup` | on description | Retires local branches whose pull requests are done, deleting only what you approve, with a recovery SHA logged for each. |

## The gates

Two gate scripts are wired through `hooks/hooks.json`. One refuses; the other
never blocks anything — it reports. A local commit gate used to sit here too;
it duplicated a check GitHub's own branch protection already makes
server-side, and it is deleted (see "Who merges" below).

| Hook | What it refuses |
| --- | --- |
| `gate` | Everything below, in one node process per matched call: a shell call on `Bash` or `PowerShell`, a write on `Edit`, `Write`, `MultiEdit` or `NotebookEdit`, and a GitHub forge merge. Nothing starts on a `Read`, a `Grep`, a `Glob`, a `Task` or a forge call that is not a merge. |
| `session-status` | Nothing — it never blocks. It reports which of the rules below are actually wired and the project's live state, at the start of every session. |

The rules `gate` runs, each still its own module under `plugin/hooks/`:

- **sandbox-guard**: a write, move or delete under the declared production
  data root that git cannot restore.
- **block-merge**: a subagent, or the GitHub forge tool, merging, or deleting
  a branch.

`claude plugin details` reports **2 hooks** — that counts the event types
these scripts are wired to (`SessionStart`, `PreToolUse`), not the scripts
themselves. Both numbers are correct; they're counting different things.

## Who merges

You do. Always. Every lane stops at a pull request and waits for your
approval; a subagent has no path to `git merge` or `gh pr merge`, no
matter how it is invoked. Your
own session merges, but only once you've approved it, never on a role's
judgment and never before that approval. That's the product, not a
limitation of it.

A direct push to your default branch is refused by GitHub's branch
protection, not by this plugin — `new-project` sets that up for a repository
it scaffolds, and `enforce_admins: true` is what makes it hold for your own
session too. In a repository with no branch protection configured, nothing
here refuses that push locally any more; branch protection is the control,
same as it is for a red suite reaching `main`.

## Licence

AEO's own work is MIT. The exception is `source/`, a verbatim reference
snapshot of other trees kept for provenance: it is governed by the terms
those trees carry, not by AEO's MIT grant. [LICENSE](LICENSE) states the
exact scope, tree by tree. Read it before you redistribute anything from
this repository.
