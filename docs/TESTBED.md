# The testbed

A permanent repository the plugin is exercised against, kept for the life of the
project. It replaces the throwaway fixtures earlier verification runs created and
deleted.

| | |
| --- | --- |
| On disk | `D:\aeo-testbed\repo` — the main checkout |
| Worktrees | `D:\aeo-testbed\wt-issue-1` — one per issue, cut by `sprint-start` |
| On GitHub | `https://github.com/Muhanad-husn/aeo-testbed`, private |
| Default branch | `main` |

## Why it exists separately

[D21](DECISIONS.md) keeps the plugin out of the repository that builds it. The
gates cannot be trusted on evidence gathered from the tree that authors them, and
a stub skill that reads as a work order is not a skill under test.

Verification also needs things this repository cannot supply without polluting it:
a remote whose default branch is behind a feature branch, real issues to select
from, CI that actually runs, and a pull request a merge gate can be pointed at.

A throwaway satisfies all of that once. It does not let a later run compare
against an earlier one, and re-creating it costs a founder approval every time
because creating a GitHub repository is outward-facing. Hence: one testbed, kept.

## How the plugin is loaded

```
claude --plugin-dir D:/AEO/plugin -p "/aeo:<lane>"
```

Nothing is installed. Nothing is written to `~/.claude/`, no marketplace is
registered, no cache is populated, and there is no uninstall step because there
was no install. This supersedes D21's install-then-uninstall procedure, which
assumed installation was the only route.

## Permissions

The testbed carries `.claude/settings.local.json` granting the tools a headless
`-p` run needs. In `-p` mode nothing can be approved interactively, so without it
a run stalls on the first `Bash` call.

Permissions and hooks are independent layers. Granting `Bash` does not weaken the
gate under test — the commit gate still blocked a red suite with `Bash` fully
allowed.

## What is in it now

`main` carries the naive `runningTotal`, which sums without filtering. `feat/e2e`
is two commits ahead with the non-numeric skip. `fix/1-running-total-input-guard`
adds the input guard, the CI workflow, and the committed test evidence, and is
open as PR #2 against `main`.

That shape is deliberate and worth keeping: a default branch that is *behind* a
feature branch is what exposes a lane that resolves the default branch correctly
and then branches from `HEAD` anyway. A repository whose `main` is current cannot
tell those two apart.

`cp4/stage-0-mismatch` is a second kept fixture, from Checkpoint 4. It carries a
real change (`runningTotal` gains an `options.max` cap), a plainly stated claim in
`PR_BODY.md`, and green test evidence that never exercises the cap. Green, real,
and about a different thing than the claim — the shape the reviewer's stage 0
exists to catch. Reproducing it costs more than keeping it.

## Rules

- **It is a fixture, not a mirror.** Nothing from `D:\AEO` is ever pushed there.
- **Do not reset it to make a run look clean.** The accumulated shape is the
  point; a run that needs a pristine base gets a new branch off `main`.
- **Deleting it is a founder decision**, the same as creating it was.

## What blocks repository creation and merges — and what does not

This section used to say the auto-mode permission classifier refused both creating a
GitHub repository and a real merge, in this repository's own sessions. A probe during
the P7.4 dry run showed the first half was wrong, and re-checking the second found it
rests on a different mechanism than the one named. Issue #63 has the full account.

### Repository creation: not blocked

**cited** — the P7.4 dry run ran `gh repo create aeo-dryrun --private --source=.
--remote=origin --push` from a plugin session, with no prompt and no refusal; the
repository was created
(`logs/2026-08-13-p7.4-dry-run/summary.md`, finding D5). This repository's own
`D:\AEO\.claude\settings.local.json` agrees: its `deny` list covers `git merge` and
four GitHub MCP write tools, and matches nothing that would catch `gh repo create`.
Nothing observed or configured stops it. The claim was wrong, not narrower than
stated.

The testbed's permanence does not rest on this. It rests on the argument already
made above: a throwaway cannot be compared against a later run, and re-creating one
is an outward-facing action a founder chooses to approve each time as a matter of
practice — not because a rule forces the choice.

### Merge: blocked, by a settings rule, not by the classifier or `block-merge`

Not probed directly here — attempting a real merge is the founder's call, and this
slice did not attempt one. What static inspection establishes:

- `D:\AEO\.claude\settings.local.json` (this repository's own permission config,
  gitignored, not checked in) denies `Bash(git merge:*)` and the GitHub MCP tool
  `merge_pull_request` outright. That is a **settings deny rule**, evaluated
  independently of any gate, and it is a property of this repository's own settings —
  the thing the original claim said the classifier was.
- `block-merge` is not that rule and does not stand in for it here. Its Bash arm
  returns immediately when the caller is not an AEO role
  (`plugin/hooks/block-merge.mjs:285`, the `isAnyAeoRole` check, comment:
  "orchestrator's own approved path (C-02, F5)"). The founder's own main session is
  exactly that orchestrator, so `block-merge` would not be what stops a merge
  attempted from it — the settings deny rule above would.
- Neither rule covers `gh pr merge` run via `Bash`; nothing in the deny list matches
  it. Whether that surface is refused by the auto-mode classifier, some other
  mechanism, or nothing, is not established by anything probed so far.

The surviving claim is narrower than the original: a real merge via `git merge` or the
GitHub MCP merge tool is refused by a settings rule specific to this repository, not by
the classifier and not by `block-merge`. That rule stays, on purpose — the founder
merges. Whether `gh pr merge` is refused by anything at all is untested.

## Proving a gate: fired, or invoked

A gate can be shown two ways, and they are not the same claim.

- **Fired.** A real action in a live session triggered the gate, and the action did
  not happen.
- **Invoked.** The hook script was run directly against a payload, and it exited 2.

Invoking proves the gate refuses when it is called. Firing proves it is reached. Only
the second is what the plugin promises, because the gate's job is to stand in front of
an action nobody asked it to check.

### All six can be fired

Measured 2026-08-13 against `plugin/` at `13a4fa1`, in a throwaway `git init`
repository outside every tracked tree. **`commit-gate` is deleted as of
[D30](DECISIONS.md#d30--the-commit-gate-is-deleted-and-block-merge-stops-re-deriving-branch-protection):**
GitHub's branch protection already refuses what it refused, server-side. A
verification run against the plugin as it stands today fires five gates, not
six; the table below is left as the record of what was true at the commit it
measured.

| Gate | Real action that fires it | Fired |
| --- | --- | --- |
| `session-status` | starting a session | yes |
| `sandbox-guard` | `Read` of a file inside `AEO_LIVE_DATA_ROOT` | yes |
| `commit-gate` | `git commit` on the default branch, or on a red suite | yes |
| `block-merge` | `git merge`, `gh pr merge`, or the forge's `merge_pull_request` tool, from an AEO role | yes |
| `path-guard` | `Write` into the project's `.claude/` from an AEO role | yes |
| `review-jail` | `Read` outside the packet directory as the reviewer | yes |

All three of `block-merge`'s surfaces were fired, the forge tool included. None of the
six needs a substitute. A checkpoint that reports one of them as invoked is recording
a weaker result than the run was able to get.

### How to fire one

```
cd <a repository the run may dirty>
claude --plugin-dir D:/AEO/plugin -p "Run exactly: git commit -m ..."
```

Four things the probe needs.

- **A repository the run may dirty.** A scratch `git init` outside `D:\AEO`, or a
  fresh branch off the testbed's `main`. `commit-gate` runs the suite it finds, so the
  repository needs a manifest with a test command or the gate blocks on detection
  instead of on the thing under test.
- **Permissions in that repository.** `.claude/settings.local.json` granting the tools,
  because a `-p` run cannot approve anything interactively.
- **A role, for the role gates.** `block-merge`, `path-guard` and `review-jail` match
  `aeo:<role>`, never a bare name (C-02). `--agent aeo:builder` and
  `--agent aeo:reviewer` set that identity.
- **A control.** A gate that allows prints nothing, so a refusal on its own does not
  show the gate read any state. Run the allowing case too. A red suite blocked and a
  green suite committed is the pair; one without the other is half the evidence.

The probe agent will sometimes decline the action on its own rather than call the tool,
and a refusal by the agent is not a refusal by the gate. Tell it the call is a
mechanical probe and the tool result is the deliverable.

### Permission rules do not come first

A `PreToolUse` hook runs before the permission decision. With `Bash(git commit:*)` in
`permissions.deny` and a red suite, the gate's refusal is what came back. With the same
deny rule and a green suite, the permission denial came back instead, because the gate
allowed and the rule then applied.

Two consequences. The merge-seat guard and `block-merge` are independent layers, and
both hold. And no gate can be called untestable on the grounds that something blocks
the action first, because nothing does.

### What did block, and where

Issue #44 reported that a live `git commit` never reached `commit-gate`. It did not,
and the interception sat one layer above the gate. What was refused was the outer
session's own `Bash` call, `claude -p "...git commit..."`, the command that would have
started the nested session. #44's log isolates it: `claude -p "echo hello"` in the same
directory ran fine. The nested session never started, so no plugin hook was ever in
play. The gate was not bypassed; the session holding it did not exist.

If an outer session's classifier objects to the launcher's text, keep the git text out
of its argv. Put the prompt in a file and feed it on stdin:

```
claude --plugin-dir D:/AEO/plugin -p < probe.txt
```

Verified: the gate fires identically.

### The substitute, and what it does not establish

No gate on the list above needs it. If a future gate or a new arm turns out to be
genuinely unreachable, the fallback is to run the hook script directly against a real
payload in a real repository:

```
echo <payload json> | node <plugin>/hooks/<gate>.mjs
```

It establishes the script's decision logic against real repository state. It does not
establish that the hook is wired to the event, that the matcher selects the tool, that
the payload shape matches what Claude Code sends, or that the timeout covers what the
gate does. Those are not hypothetical gaps. `review-jail` once carried
`matcher: "*"`, which raises on `new RegExp` and would have unregistered the jail
silently, and `sandbox-guard` shipped with `^Bash$`, so a `Write` that created a file
inside the production data root was not gated at all. Direct invocation passes in both
cases.

### How an evidence line says which

Every per-gate evidence line opens with the method, so a reader of any checkpoint log
can tell the two apart without knowing this rule exists.

```
fired — commit-gate refused `git commit` on a red suite in <repo>; no commit landed.
        Control: same command, green suite, commit <sha> landed.
invoked — commit-gate exited 2 on a Bash payload for `git commit`, cwd <repo>.
        Does not establish that the hook is wired to PreToolUse or that the
        matcher selects Bash.
```

An `invoked` line carries its own limitation in the same breath. A line with neither
word is incomplete evidence and a reviewer should treat it as such.

## Adding a marketplace overwrites a name that already exists

`claude plugin marketplace add` silently replaces any existing entry of the same name.
No warning, no prompt, and no way back: registrations are not versioned, so the
overwritten entry can only be restored by adding it again by hand.

This repository's marketplace is named `aeo`, and local development registers `aeo`
pointing at `D:\AEO`. Any install proof run on this machine destroys that
registration. #44's did, and could not restore it. Putting it back takes one command,
run interactively:

```
claude plugin marketplace add D:/AEO
```

This is Claude Code's behaviour, not an AEO defect. It is recorded here because this
is where the rules about which trees a proof may touch already live.
