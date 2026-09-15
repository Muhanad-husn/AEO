# 01: One node process per shell call, and none on a read tool

Issue: [#167](https://github.com/Muhanad-husn/AEO/issues/167)

## Goal

`plugin/hooks/hooks.json` wires one script, `plugin/hooks/gate.mjs`, on exactly three
PreToolUse matchers: `^(Bash|PowerShell)$`, `^(Edit|Write|MultiEdit|NotebookEdit)$`, and
`^mcp__.*github.*__merge`. No matcher matches Read, NotebookRead, Grep, Glob, Task,
WebFetch, BashOutput, or a GitHub MCP tool whose action does not start with `merge`.
`plugin/hooks/review-jail.mjs` and its test are deleted. The SessionStart entries are
untouched.

## Acceptance criterion

Given `plugin/hooks/hooks.json` and a stand-in home directory whose
`installed_plugins.json` enables this repository's `plugin/` directory,
when `node --test tests/hooks/gate.test.mjs` runs,
then `measure` from `scripts/score/harness.mjs` reports `bash 1, grep 0, read 0, task 0`;
every PreToolUse matcher in hooks.json fails to match `Read`, `NotebookRead`, `Grep`,
`Glob`, `Task`, `WebFetch`, `BashOutput` and `mcp__plugin_github_github__get_pull_request`;
a Bash payload `git merge feat` with `agent_type` `aeo:builder` sent to `gate.mjs` exits 2
and `git status` exits 0; a Write payload targeting `<repo>/.claude/settings.json` with
`agent_type` `aeo:builder` exits 2; a Read payload targeting the same file exits 0;
`plugin/hooks/review-jail.mjs` does not exist; and neither script in `package.json` names
a review-jail test.

## Mechanism

- No existing skill or plugin fits. No MCP.
- Library: Node only, `lib.mjs`'s `runGate` (fails closed on any throw, exit 2) and
  `block`. No model call.
- `gate.mjs` reads the payload once and dispatches on `tool_name`: a shell tool runs
  block-merge's shell check, then redirect-guard's, then sandbox-guard's (sentinel rule
  and data rules) in that order in one process; a write tool runs path-guard's check then
  sandbox-guard's file rule; a forge tool runs block-merge's forge arm. The first block
  wins, exactly as the first refusing hook won before.
- Behavioural tests first, committed red; Opus builds (fail-closed wiring).

Decisions this slice fixes:

(a) Read and NotebookRead leave the sandbox guard's matcher because PLAN.md section 2
says nothing fires on Read; the L-03 read incident was six test call-sites reading a live
index through code, which arrives as a Bash call and is still judged; a Read tool call
reads one named file into context.

(b) The forge matcher narrows from `mcp__.*github.*__.*` to `^mcp__.*github.*__merge` so
an MCP call that is not a merge starts no process; the gate still checks the action name,
the matcher only stops the spawn.

## Shape

`gate.mjs` is about 60 lines, one `runGate` call, importing `checkShell`/`checkForge`
from block-merge.mjs, `checkCommand` from redirect-guard.mjs, `pathGuard` from
path-guard.mjs, and `sandboxGuard` from sandbox-guard.mjs (names are the builder's; this
plan names the shape, not the identifiers). Each gate module exports its check and keeps
its entry behind the same `import.meta.url === pathToFileURL(process.argv[1]).href`
guard sandbox-guard.mjs already uses, so each existing test file still spawns its script
alone: block-merge.mjs, path-guard.mjs and redirect-guard.mjs move their top-level
`await runGate(...)` behind that guard.

`hooks.json`: SessionStart entries unchanged; PreToolUse has exactly three entries, each
`{"type":"command","command":"node","args":["${CLAUDE_PLUGIN_ROOT}/hooks/gate.mjs"],
"timeout":10}`.

`tests/hooks/hooks-json.test.mjs` is rewritten around the three matchers and the one
script; the V-12 anchoring tests and the exec-form tests survive with new subjects.
`tests/hooks/sandbox-guard.test.mjs`'s final describe, "hooks.json registration", is
rewritten to assert gate.mjs's matchers instead of sandbox-guard.mjs's name.
`tests/skills/gate-map.test.mjs` derives the count of distinct wired scripts from
hooks.json and compares it to README.md's "## The gates" section; that section is
rewritten to describe one gate script running the kept rule modules, plus
session-status, so the count the test derives is two distinct scripts. `package.json`
drops `tests/hooks/review-jail.test.mjs` from `test:integration`.

## Files

```aeo-independence
slice: 01-one-process
creates: plugin/hooks/gate.mjs
creates: tests/hooks/gate.test.mjs
edits: plugin/hooks/hooks.json
edits: plugin/hooks/block-merge.mjs
edits: plugin/hooks/path-guard.mjs
edits: plugin/hooks/redirect-guard.mjs
edits: plugin/hooks/review-jail.mjs
edits: tests/hooks/review-jail.test.mjs
edits: tests/hooks/hooks-json.test.mjs
edits: tests/hooks/sandbox-guard.test.mjs
edits: package.json
edits: README.md
```

## Out of scope

What each rule judges: slices 02, 03 and 04 change block-merge, sandbox-guard and the
config fence after this lands. The SessionStart entries and session-status, held for
phase 2. The skills and agents that mention review-jail, held for phase 3. The founder's
global copy at `~/.claude/hooks`. The plugin version.
