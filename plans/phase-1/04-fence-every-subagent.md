# 04: The config fence holds for every subagent

Issue: [#170](https://github.com/Muhanad-husn/AEO/issues/170)

## Goal

A subagent of any `agent_type`, `general-purpose` included, cannot write into a project's
own `.claude/` through a file tool or through a shell. The main session, which carries no
`agent_type`, still can.

## Acceptance criterion

Given a git repository with a `.claude/settings.json` at its root, when `node --test
tests/hooks/path-guard.test.mjs tests/hooks/redirect-guard.test.mjs` runs, then a Write
targeting `<repo>/.claude/settings.json` with `agent_type` `general-purpose` exits 2 with
the fence reason; a Bash payload `printf '{}' > .claude/settings.json` with `agent_type`
`general-purpose` exits 2 with the fence reason; the same two calls with no `agent_type`
exit 0; a Write targeting `<repo>/src/x.mjs` with `agent_type` `general-purpose` exits 0;
and `aeo:builder` is still fenced on both surfaces.

## Mechanism

- No skill or plugin fits. No MCP.
- Library: lib.mjs's `agentIdentity(payload)`, already exported, the trimmed `agent_type`
  or null.
- No model call.
- Both gates replace `isAnyAeoRole(payload)` with `agentIdentity(payload) !== null` and
  state the C-02 cost in one sentence of the header.
- The reason is PLAN.md section 3 and section 11 decision 2: the charters go, so no
  `aeo:` identity will exist, and a fence scoped to a name that no longer occurs fences
  nothing.
- Behavioural tests first, committed red; Sonnet builds: a one-line change in each gate
  with an unambiguous target, plus the test rewrite.

## Shape

`path-guard.mjs` and `redirect-guard.mjs` each change one import and one condition and one
header sentence. The identity `describe` blocks in both test files are rewritten: the
fenced list becomes any non-empty `agent_type` (`general-purpose`, `builder`,
`other:builder`, `aeo:builder`), the passing case is no `agent_type` only, and the
whitespace-only `agent_type` case passes because `agentIdentity` trims to null.
`isAnyAeoRole` stays exported from lib.mjs; its remaining tests in lib.test.mjs are not
this slice's.

## Files

```aeo-independence
slice: 04-fence-every-subagent
edits: plugin/hooks/path-guard.mjs
edits: plugin/hooks/redirect-guard.mjs
edits: tests/hooks/path-guard.test.mjs
edits: tests/hooks/redirect-guard.test.mjs
depends-on: 01-one-process
```

## Out of scope

lib.mjs (slice 03 owns it this phase; `isAnyAeoRole` is removed in phase 3 with its last
reader); block-merge's identity (slice 02); what counts as inside the harness
(`isPathIntoHarness`, unchanged); README's role names (phase 3).
