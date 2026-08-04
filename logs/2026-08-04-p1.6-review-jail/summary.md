# P1.6: review-jail

2026-08-04. Branch `feat/phase-1/p1.6-review-jail`.

## What was built

`plugin/hooks/review-jail.mjs`, a `PreToolUse` gate. For the `aeo:reviewer`
role it blocks every tool except a `Read` of a file under the staged packet
directory, which sits in the OS temp scratchpad, outside the repository. Every
other identity passes through untouched.

`tests/hooks/review-jail.test.mjs`, 50 tests, all out of process against real
exit codes.

There was no PowerShell original. This gate is new, and L-01's description of
production's implementation was the specification.

## The three decisions this slice owned

### Where the packet lives, and how the gate learns the path

`<os temp>/aeo-review-packets`, by convention, with `AEO_REVIEW_PACKET_DIR` as
an absolute-path override.

Outside the repository is the load-bearing part. A packet staged inside the
repo is reachable by an ordinary repo read and the jail buys nothing. D12
forbids the plugin root separately, and it would be wrong here anyway since it
is ephemeral.

The convention comes first and the environment variable second, which is the
reverse of P1.5's shape, for a mechanical reason. A hook inherits Claude Code's
environment, and that environment is fixed at launch. The orchestrator cannot
set a variable per dispatch, so an env-var-only design would have had no working
default and would have depended on the founder's `settings.json`. A directory
both sides compute from `os.tmpdir()` needs no coordination at all. The variable
stays as a seam for an operator whose temp directory is unusual, and for the
test battery.

**Unset is the normal case and resolves to the convention.** There is no state
in which this gate has no directory to compare against and reasons its way to
allowing. Blank and whitespace read as unset. A value that is set but relative
is a misconfiguration rather than a location, so it denies every tool including
`Read`: loud, costs one review, and fails in the only direction a jail may.
Three tests cover unset, three cover blank, three cover relative.

### One directory, not one file

A directory, and the wider hole is accepted deliberately.

The packet is not one artifact. A Phase 1 gate review needs the diff, the slice
brief, the verbatim evidence entries, the full test output and the git log, and
they are separate documents of very different sizes. Forcing them into one file
means either a concatenation the reviewer must read whole, which burns exactly
the context that staging was meant to save, or one environment variable per
document, which cannot be varied per dispatch anyway.

The hole is bounded by what someone put in the directory. Nothing a reviewer
would want in order to cheat, meaning the branch, the commit messages and the
PR body, is reachable through it unless the orchestrator stages it there.

Two consequences worth stating.

- **The reviewer cannot list the directory**, because `Glob` is denied. The
  dispatch prompt must name the staged files by absolute path.
- **Concurrent reviews share one directory.** Four worktrees are building right
  now, and a reviewer for one slice could read another slice's packet. That is
  cross-talk, not a break in independence, and it is not fixable from inside the
  gate: per-review scoping would need a per-dispatch signal, and the only
  per-dispatch identifier in the payload is `agent_id`, which the orchestrator
  does not know before it dispatches. Give each review its own subdirectory and
  name only that one in the prompt if the cross-talk ever matters.

### What a jailed reviewer cannot do, and what the packet must therefore carry

This is the constraint that outlives the slice.

A jailed reviewer has exactly one capability: reading staged text. It cannot run
the test suite, so it cannot confirm that a suite is green or that a count is
real. It cannot grep, so it cannot check whether a pattern occurs a second time
somewhere the diff does not show. It cannot open the file around a hunk, so
three lines of diff context is all the context it gets. It cannot read the
branch, the commit messages, the PR body, `CLAUDE.md`, `PLAN`, `EVIDENCE` or
`DECISIONS`. It cannot fetch anything, list anything, or spawn a helper that
would be under no jail at all.

So **every claim in the packet is unverifiable by the reviewer unless the packet
also contains the artifact the claim was derived from.** A packet of pointers is
unreadable to a jailed reviewer, and a packet of assertions is unjudgeable.
Concretely, a review packet carries:

| Instead of | Stage |
| --- | --- |
| "the suite is green, 154 tests" | the exact command and its full raw output, summary line included |
| a diffstat, or a summary of the change | the complete unified diff, with generous context on any file where the change is a control-flow or fail-open path |
| "per L-01", or "see PLAN's P1.6 row" | the verbatim text of every doc passage the review needs |
| "the gate handles the macOS symlink case" | the code that does it, and the test that proves it |
| "on branch X, based on Y" | the branch, the merge-base, and `git log --oneline` |
| a claim about code outside the diff | the quoted excerpt, with its path and line numbers |

And the constraint on **who assembles it**: not the party under review. If the
builder chooses which evidence the reviewer sees, the seal is on the wrong door
and independence is theatre with a hook attached. PLAN already says the packet
is staged rather than taken from the builder's report; the jail is what makes
that enforceable rather than aspirational. In practice the orchestrator runs the
suite itself and stages the raw output, rather than staging a test result the
builder handed it.

The reviewer's escape hatch is not a tool, it is a verdict. The block message
tells it so directly: an insufficient packet is a finding, not something to work
around. Phase 4's stage-0 question, "does the evidence demonstrate the claim?",
is answerable under this jail only because the evidence is required to be in the
packet. That is the same requirement, arrived at from the other end.

## Deny by default, and why not a blocklist

For the reviewer role every tool is blocked except the one allowance. A tool
Claude Code ships next month, an MCP server the founder installs next week, a
`Task` call that would spawn an unjailed helper: each is denied without anyone
editing this gate. A blocklist of known-dangerous tools fails open on exactly
those, and it fails open silently. For this gate that is the worst outcome
available, because its entire product is a guarantee about what an agent could
not see. A jail that quietly stops matching still advertises independence it is
no longer providing. That is the C-01 shape this project is most alert to.

The tool name is compared exactly. It is not trimmed and not lowercased: every
normalisation applied at that comparison is a widening of the only hole the gate
has. Lowercase, uppercase and whitespace-padded spellings of the allowed tool
are all denied.

## The `hooks.json` entry P1.7 must write

P1.7 owns the file. It was not created or edited here. The required entry, under
`hooks.PreToolUse`:

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/review-jail.mjs"],
      "timeout": 10
    }
  ]
}
```

- **The matcher must match all tools.** Verified against the current hooks doc
  on 2026-08-04: `"*"`, `""` and an omitted `matcher` all match everything, and
  the doc states it in exactly those three forms. `"*"` is chosen over the other
  two because it says so out loud; an omitted field reads like an oversight. Any
  matcher naming a tool set leaves every tool outside that set available to the
  reviewer, which is the failure this gate exists to prevent.
- **Exec form**, `command` plus `args`, no shell, per P1.1's C-05 findings. It
  removes every quoting question, and this gate needs no shell.
- **`timeout` in seconds**, default 600. Ten is generous: the gate does no
  network and no git, only a path resolution. A long default on a gate that runs
  before every single tool call is a hang waiting to happen.
- **No shell fallback.** The `||` idiom fires on any non-zero status and would
  convert every exit 2 into a pass. It belongs on P1.7's reporter alone, and a
  test asserts this entry contains no `||` or `&&`.

A skipped test in `tests/hooks/review-jail.test.mjs` arms the moment
`plugin/hooks/hooks.json` exists. It then asserts exactly one PreToolUse entry
runs `review-jail.mjs`, that its matcher is `"*"`, `""` or absent, and that it
carries no shell fallback. Until then it skips with a message naming P1.7, which
`node --test` reports as a skip rather than a silent pass.

## How this gate could silently stop firing

Each row is a way the jail could stop enforcing with no other symptom.

| Failure | Covered |
| --- | --- |
| The identity string changes, or the plugin is renamed | Yes. The tests derive `aeo:reviewer` from `plugin/.claude-plugin/plugin.json` rather than typing the literal, so a rename that would unjail every reviewer turns the battery red |
| A near-miss identity is treated as ours, or ours is not matched | Yes. Ten identity variants, including a bare `reviewer`, another plugin's, a prefix, a suffix, a namespace ending in ours, and a case variant. A mutation to a substring test fails six tests |
| The packet path is unset, blank, or relative | Yes, nine tests. A mutation making unset mean "no root, so allow" fails two |
| The path comparison does not normalise | Yes, and this was the closest call. `isPathInside` compares strings and does not call `realpath`, so on macOS a packet under `/var/folders/...` never matches a realpath'd `/private/var/folders/...`. Both sides go through a resolver first. Three tests use a real directory link to reproduce the condition on any platform, and removing the resolver fails three tests |
| A link inside the packet root points back into the repo | Yes. Resolving the child before comparing means the link resolves to the repo and is denied |
| A tool arrives with a payload shape not anticipated | Yes. Deny by default means the gate never has to recognise a tool. A `tool_name` that is missing, null, a number, an object or an array is denied, as is a `tool_input` that is missing, null, a string, a number or an array |
| A future tool is added to Claude Code | Yes, by construction, and pinned by a test using a tool name that does not exist. A mutation replacing the allowance with a blocklist fails eleven tests |
| A relative `file_path` resolves against the hook's own working directory | Yes. It resolves against `payload.cwd`, and if that is absent or itself relative the call is denied rather than guessed at |
| The polarity inverts but the tests stay green anyway | Yes, after a fix. See below |
| The gate is not registered, or is registered against a narrow matcher | Partly. The test exists and skips until P1.7 lands `hooks.json` |
| The payload is malformed | **No, and by inheritance.** See below |

### The one the tests initially missed

The first version of the deny-by-default battery asserted only the exit code. A
mutation replacing the allowance with a three-tool blocklist left almost all of
it green, because those payloads carried no absolute `file_path` and so blocked
one branch later on the path check instead. The tests would have reported a
working jail while the polarity was inverted.

That is the L-08 shape exactly, an assertion made over the wrong thing. Every
block now asserts which rule fired, and the deny-by-default payloads carry the
staged packet path in every field a tool might read a path from, so a tool that
slipped past the allowance could not then be caught by accident. The same
mutation now fails eleven tests.

Four mutations were run against the finished battery and each turned it red: the
blocklist, a substring identity test, a string comparison without `realpath`,
and an unset packet path reasoning its way to allow.

### The one that is not closed

**A malformed payload allows.** `runGate` treats an unparseable payload as a
platform fault and exits 0 with a line on stderr. That is P1.1's decision and it
is correctly reasoned there: the model cannot cause it, since Claude Code
serialises the payload and every model-controlled string sits inside valid JSON.
It is not overridden here, but it is the one shape in which this gate does not
fire and nobody is jailed, so it is pinned by a test over six malformed inputs
rather than left as an assumption. If the payload shape ever changes, that test
fails and the stderr line makes it visible in a live session.

Two further residuals inherited from P1.1, neither fixable from inside a gate: a
crash at module scope exits 1, which is non-blocking; and a gate calling
`process.exit` owns its code. This gate never calls `process.exit`.

## Flagged, not decided here

- **A capitalised `Reviewer` in the identity is not jailed**, because
  `isAeoRole` is case-sensitive. Claude Code derives the identity from the
  agent's name, so it will be `aeo:reviewer` as long as the agent file is
  `reviewer.md`. Pinned by a test so the assumption is visible; P2 owns the
  agent file that makes it true.
- **A main session launched as a bare `--agent reviewer` is not jailed.** That
  is C-02 read correctly, the same accepted cost P1.1 recorded, and it is right:
  in that mode the founder is at the keyboard.
- **The block message is long.** It is the reviewer's only channel for learning
  what it may do, and what to do when the packet is short, since it cannot read
  any charter that is not staged. Length here is cheaper than a reviewer
  flailing against a wall of denials.
- **Nothing in the gate file is exported.** The gate runs on load, so an import
  would read stdin and exit. If a later slice needs the packet root, it belongs
  in `lib.mjs`, not here. The packet-staging side is markdown and cannot import
  a `.mjs` anyway, so the convention is documented in the gate header and above.

## Verification

`node --test` from the repo root: **154 tests, 153 pass, 0 fail, 1 skipped**, on
Node 24.16.0. 104 before this slice, so 50 added. The single skip is the
`hooks.json` registration test waiting on P1.7.

The two cases PLAN's verify line names, both present and passing:

- `the verify line > a reviewer Grep is blocked`, exit 2, with
  `BLOCKED: "Grep" is not available to the reviewer role` on stderr.
- `the verify line > a reviewer Read of the staged packet is allowed`, exit 0,
  no `BLOCKED` line.
