# feat(phase-1): one node process per shell call, and none on a read tool [slice 01]

**Spec:** PLAN.md#5-phases, row "1 Invariants"; PLAN.md#2-the-method · **Plan:** plans/phase-1/01-one-process.md
**Depends on:** none · **Issue:** #167
**Labels:** phase-1

## Deliverable

`plugin/hooks/hooks.json` wires one script, `plugin/hooks/gate.mjs`, on exactly three PreToolUse matchers: `^(Bash|PowerShell)$`, `^(Edit|Write|MultiEdit|NotebookEdit)$`, and `^mcp__.*github.*__merge`. No matcher matches Read, NotebookRead, Grep, Glob, Task, WebFetch, BashOutput, or a GitHub MCP tool whose action does not start with `merge`. `plugin/hooks/review-jail.mjs` and its test are deleted. The SessionStart entries are untouched.

## Mechanism

Node only, no skill or plugin fits, no MCP, no model call. `gate.mjs` reads the payload once and dispatches on `tool_name`: a shell tool runs block-merge's shell check, then redirect-guard's, then sandbox-guard's (sentinel rule and data rules) in one process; a write tool runs path-guard's check then sandbox-guard's file rule; a forge tool runs block-merge's forge arm; the first block wins. Read and NotebookRead keep no matcher because PLAN.md section 2 fires nothing on Read, and the L-03 read incident was a Bash call, not a Read tool call. The forge matcher narrows to `^mcp__.*github.*__merge` so a non-merge MCP call starts no process, while the gate still checks the action name. Behavioural tests first, committed red; Opus builds.

## Acceptance criterion

Given `plugin/hooks/hooks.json` and a stand-in home directory whose `installed_plugins.json` enables this repository's `plugin/` directory, when `node --test tests/hooks/gate.test.mjs` runs, then `measure` from `scripts/score/harness.mjs` reports `bash 1, grep 0, read 0, task 0`; every PreToolUse matcher in hooks.json fails to match `Read`, `NotebookRead`, `Grep`, `Glob`, `Task`, `WebFetch`, `BashOutput` and `mcp__plugin_github_github__get_pull_request`; a Bash payload `git merge feat` with `agent_type` `aeo:builder` sent to `gate.mjs` exits 2 and `git status` exits 0; a Write payload targeting `<repo>/.claude/settings.json` with `agent_type` `aeo:builder` exits 2; a Read payload targeting the same file exits 0; `plugin/hooks/review-jail.mjs` does not exist; and neither script in `package.json` names a review-jail test.

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

What each rule judges (slices 02, 03 and 04 change block-merge, sandbox-guard and the config fence after this lands); the SessionStart entries and session-status (phase 2); the skills and agents that mention review-jail (phase 3); the founder's global copy at ~/.claude/hooks; the plugin version.
