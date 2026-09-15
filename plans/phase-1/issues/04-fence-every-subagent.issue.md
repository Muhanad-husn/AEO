# feat(phase-1): the config fence holds for every subagent [slice 04]

**Spec:** PLAN.md#5-phases, row "1 Invariants"; PLAN.md#11 · **Plan:** plans/phase-1/04-fence-every-subagent.md
**Depends on:** #167 · **Issue:** #170
**Labels:** phase-1

## Deliverable

A subagent of any `agent_type`, `general-purpose` included, cannot write into a project's own `.claude/` through a file tool or through a shell; the main session, which carries no `agent_type`, still can. `path-guard.mjs` and `redirect-guard.mjs` both currently gate on `isAnyAeoRole(payload)`, which matches only an `agent_type` of the form `aeo:<role>`, so a `general-purpose` subagent passes both fences today; this closes that gap.

## Mechanism

No skill or plugin fits. No MCP. Library: lib.mjs's `agentIdentity(payload)`, already exported, the trimmed `agent_type` or null. No model call. Both gates replace `isAnyAeoRole(payload)` with `agentIdentity(payload) !== null` and state the C-02 cost, that a main session launched with `--agent` also carries `agent_type` and is treated as a subagent, in one sentence of the header. The reason is PLAN.md section 3 and section 11 decision 2: the charters go, so no `aeo:` identity will exist, and a fence scoped to a name that no longer occurs fences nothing. Tests first, committed red; Sonnet builds.

## Acceptance criterion

Given a git repository with a `.claude/settings.json` at its root, when `node --test tests/hooks/path-guard.test.mjs tests/hooks/redirect-guard.test.mjs` runs, then a Write targeting `<repo>/.claude/settings.json` with `agent_type` `general-purpose` exits 2 with the fence reason; a Bash payload `printf '{}' > .claude/settings.json` with `agent_type` `general-purpose` exits 2 with the fence reason; the same two calls with no `agent_type` exit 0; a Write targeting `<repo>/src/x.mjs` with `agent_type` `general-purpose` exits 0; and `aeo:builder` is still fenced on both surfaces.

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

lib.mjs (slice 03 owns it this phase; `isAnyAeoRole` is removed in phase 3 with its last reader); block-merge's identity (slice 02); what counts as inside the harness (`isPathIntoHarness`, unchanged); README's role names (phase 3).
