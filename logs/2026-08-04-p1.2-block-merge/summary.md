# P1.2: block-merge

2026-08-04. Branch `feat/phase-1/p1.2-block-merge`.

## What was built

`plugin/hooks/block-merge.mjs`, the merge gate, ported from the live
`source/axial/dot-claude/hooks/block-merge.ps1`, not the vendored skill's copy,
carrying both fixes V-02 records (the `git -C <dir> merge` match, and worktree
resolution through `cd <dir> &&` rather than `CLAUDE_PROJECT_DIR`/`$PSScriptRoot`).
It imports `runGate`, `block`, `isAnyAeoRole`, `matchesGitSubcommand`,
`resolveWorktree`, `currentBranch` and `defaultBranch` from `lib.mjs` and re-derives
nothing the library already does.

Blocked, for an AEO subagent's Bash calls only:

| Case | Mechanism |
| --- | --- |
| `git merge`, including `git -C <dir> merge` | `matchesGitSubcommand(cmd, 'merge')` |
| `gh pr merge`, `gh api .../merge` | local regexes |
| `git branch -d`/`-D`/`--delete` | `matchesGitSubcommand(cmd, 'branch')` plus a flag check |
| `git push --delete`, and `git push origin :<branch>` | refspec analysis, see below |
| a push whose refspec resolves to the default branch | refspec analysis, see below |

Blocked unconditionally, orchestrator included, because these are the forge's own
merge and direct-write surface rather than a subagent-identity question:

| Case | Mechanism |
| --- | --- |
| any `mcp__*github*__*` tool whose action is `merge` as the leading verb | `FORGE_TOOL_RE` plus `FORGE_MERGE_ACTION_RE` |
| `create_or_update_file`/`push_files`/`delete_file` targeting the default branch | exact action match, `tool_input.branch` vs `defaultBranch(dir)` |

`tests/hooks/block-merge.test.mjs`, 47 tests, spawning the real gate script as a
subprocess and reading its exit code and stderr, the same pattern
`tests/hooks/lib.test.mjs` uses for `runGate`. No fixture stands in for the gate;
`runGate` owns `process.exit`, so the only way to observe a decision is a real
process.

## F5: the identity policy decision

**Decision: `isAnyAeoRole(payload)`.** This gate enforces only against this
plugin's own three roles (`aeo:builder`, `aeo:reviewer`, `aeo:triage`), by their
anchored identity. A `general-purpose` subagent, `Explore`, or a foreign plugin's
`other:builder` passes this gate even if it runs `git merge`.

**Reasoning.** Production blocked on `agent_type` non-empty. C-02 already ruled
that out: a main session launched with `--agent` also carries `agent_type`, so a
presence check blocks the orchestrator's own founder-approved merge path whenever
it runs in that mode. There is no way to separately identify "the orchestrator
wearing an agent hat" from "a genuine subagent" using `agent_type` alone; both look
identical. The only coherent middle ground is role identity, not session mechanism:
enforce when the caller is wearing one of this plugin's three role hats, regardless
of whether that happens inside a true subagent or a main session run with
`--agent aeo:builder`. P1.1's own log already reasoned this through for the general
case and called it correct; this slice is where it first has a consumer.

This was decided rather than escalated, because the reasoning is not really a
judgment call between two comparably-reasonable policies. The alternative
(broader: block on any non-null `agent_type`) reintroduces the exact bug C-02
documents, with no way to carve out an exception for the orchestrator's own
`--agent` path, since that path is indistinguishable from a hostile one by this
signal alone.

**The accepted gap, stated plainly.** If the orchestrator dispatches a bare
`general-purpose` subagent to do something that ends up running `git merge`, or a
foreign plugin's subagent does the same, this gate does not stop it. Production
would have. The mitigation is structural rather than in this gate: this plugin's
own dispatch conventions route all delegated build/review/triage work through the
three named roles, so there is no ordinary path that reaches `git merge` through an
unnamed identity. A determined misuse (dispatching `general-purpose` specifically
to merge) is not stopped by this gate, the same way `if:` filters are not the
security boundary (C-04) and permission rules are what actually enforces a hard
deny. If the founder wants the wider net anyway, the library already exports
`agentIdentity(payload)` and the change is a few lines: block whenever it is
non-null and does not equal a specific allow-listed orchestrator identity, at the
cost of reopening the exact `--agent`-mode block C-02 describes for every identity
that is not on that list.

## Push-refspec matching

Refspecs are parsed, not pattern-matched. `analyzePush(command)` locates the `git
push` invocation (mirroring `matchesGitSubcommand`'s own git-level option prefix,
since the library has no whole-token equivalent for refspec destinations), takes
everything up to the next `&&`/`||`/`;`, and tokenizes on whitespace (git ref names
cannot contain spaces, so no quote handling is needed). The first non-flag token is
treated as the remote; the rest are refspecs. Each refspec has its optional leading
`+` stripped, and is split on the first `:`: no colon means same-name push (the
whole spec is the destination); an empty source before the colon
(`git push origin :main`) is a remote-branch deletion, the same bucket as
`--delete`; otherwise the text after the colon is the destination.

Cases covered, all tested:

- `git push origin HEAD:main` and `git push origin +main`: destination resolves to
  `main`, blocked.
- `git push origin feat/main-thing`: destination is the whole token
  `feat/main-thing`, not equal to `main`, allowed. This is the case the vendored
  `\bmain\b` regex gets wrong in the other direction; word-boundary matching treats
  `/` and `-` as boundaries too, so it fires inside the branch name.
- A bare `git push` or `git push origin` (no refspec): falls back to
  `currentBranch(dir) === protectedBranch`, mirroring the PowerShell original's
  second, separate check.
- `git push origin :main` and `git push origin --delete <branch>`: both routed to
  "subagents never delete remote branches," regardless of branch name, closing a
  gap the vendored `--delete`-only check leaves open.
- The protected branch is always `defaultBranch(dir)`, never a literal `main`.
  Tested against a `master`-default repo (blocks `master`, does not block a
  literally-named `main` push) and a slashed default (`release/stable`, matched
  whole and not split on its slash).

**Detached HEAD.** Not specially handled. `currentBranch(dir)` returns the literal
string `HEAD` on a detached worktree, which cannot equal a real default branch
name, so the "current branch is protected" fallback simply never fires there. This
is an accepted default rather than a considered one: a bare `git push` with no
refspec from a detached HEAD is normally rejected by git itself before this gate
would ever see a meaningful target, so the case is low-stakes. If a future gate
needs `HEAD` normalised (equal-to-default, or refused outright), that belongs in
`lib.mjs`'s `currentBranch`, not duplicated here; noted per the library's own
comment on the function.

## D14's forge pattern, sanity-checked

`FORGE_TOOL_RE = /^mcp__.*github.*__([a-z0-9_]+)$/i` matches the namespace; the
capture is everything after the last `__`, so a server name that itself contains
`__` (this environment's is `plugin_github_github`) still resolves correctly.

**The merge-action match was tightened past D14's literal text.** D14 states the
pattern as `mcp__.*github.*__.*(merge|create_or_update_file|push_files|delete_file)`,
a bare substring test. Checked against this environment's actual
`mcp__plugin_github_github__*` tool list (37 tools, read from the live tool
registry, not assumed): none contain the word "merge" anywhere. So there is no
live false-positive to catch today, but a substring test still has one waiting: it
would fire on a hypothetical `unmerge_branch`, and even a whole-word version
(`(^|_)merge(_|$)`) would fire on a hypothetical read-only `get_merge_status`. This
gate anchors to the leading verb instead (`/^merge(_|$)/i`), which still catches
the real shape of an action tool (`merge_pull_request`, `merge_branch`) and does
not catch a status check that merely mentions merging. This is V-12's rule (whole
token, not substring) applied to a third context beyond argv and paths; the tests
name both directions (`unmerge_branch` and `get_merge_status` both pass;
`merge_pull_request` and `merge_branch` both block).

The three file-write actions are matched exactly (a `Set` membership check), not
fuzzily; D14 names them precisely and there is no ambiguity to guard against there.

`tool_input.branch` is compared against
`defaultBranch(resolveWorktree(payload).toplevel)`, never the literal `main`, with
a `refs/heads/` prefix stripped before comparing. Tested against a `trunk`-default
repo.

**Observation for the record, not a defect.** This environment's installed GitHub
MCP server exposes no `merge_pull_request`, `create_or_update_file`, `push_files`
or `delete_file` tool at all, only read and PR-metadata tools
(`pull_request_read`, `pull_request_review_write`, `update_pull_request`, etc.).
The forge arm of this gate is currently unexercised in live use here; it is
written and tested for the server that does ship those actions, per D14's stated
intent of not assuming one observed install.

## Required hooks.json entry, for P1.7

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|mcp__.*github.*__.*",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/block-merge.mjs"]
          }
        ]
      }
    ]
  }
}
```

Exec form (`command` plus `args`), not the shell form: no quoting question, and
this gate never needs the `||` shell fallback P1.7's reporter does (C-05's
finding). No `timeout` override needed; the gate does one stdin read, at most a
handful of synchronous `git` calls, and no network access, so the 600-second
default is generous, not tight. The matcher is a regex alternation broad enough to
catch both arms; if P1.7 prefers one broader matcher (`.*`) shared across every
gate to keep hooks.json simple, that also works, since this gate is a no-op on
every tool name that reaches neither branch.

## Verification

`node --test` from the repo root: **151 tests, 151 pass, 0 fail, 0 skipped**, about
20 to 60 seconds depending on machine load (git subprocess spawns dominate).
Started this slice at 104 (P1.1's count); this slice adds 47.

Two real bugs were caught by running the tests, not by inspection:

1. `GH_API_MERGE_RE` required `merge` to be immediately followed by `/`, `?`, or
   end-of-string. A realistic command (`gh api repos/o/r/pulls/42/merge -X PUT`)
   has trailing flags after the path, so the match failed. Fixed with a lookahead
   (`(?=[/?\s]|$)`) instead of a consuming alternation.
2. Several test repos did not set an explicit default branch, so `defaultBranch()`
   fell through to this machine's global git config
   (`init.defaultbranch=master`, set in `C:\Program Files\Git\etc\gitconfig`)
   instead of the `main` the tests assumed. Not a library bug: `defaultBranch()`'s
   documented fallback order is doing exactly what it says. Fixed by having every
   test repo whose assertion depends on a specific protected-branch name set it
   explicitly via `origin/HEAD`, the same discipline `lib.test.mjs` already uses.
   Worth flagging for P1.3 and any other slice that spins up throwaway repos: do
   not rely on the ambient default-branch fallback in a test; this machine's
   system-level git config is not `main`.

Named cases from the brief, all present and passing: `git merge-base` allowed,
`git merge` blocked, `git -C <dir> merge` blocked (V-02); `HEAD:main` and `+main`
blocked, `feat/main-thing` allowed; a `master`-default repo blocks correctly and a
`main`-default repo still does (D14); orchestrator (no `agent_type`) passes; a main
session with `--agent general-purpose` passes; `aeo:builder`/`aeo:reviewer`/
`aeo:triage` block; a foreign `other-plugin:builder` passes, with the test naming
that this pins the narrow policy; the forge merge tool blocks for everyone
including the orchestrator (no `agent_type` at all); malformed and empty payloads
allow per the library's own contract.

## Em-dash count

Both new files were written, checked (11 and 14 over budget for their word
counts), and rewritten to 0. Counted with a literal em-dash grep before reporting,
not estimated.
