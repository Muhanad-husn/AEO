# feat(phase-1): block-merge judges the command's structure, for every subagent [slice 02]

**Spec:** PLAN.md#5-phases, row "1 Invariants"; PLAN.md#3 · **Plan:** plans/phase-1/02-block-merge-structural.md
**Depends on:** #167 · **Issue:** #168
**Labels:** phase-1

## Deliverable

block-merge's shell arm judges a subagent's command by structure instead of by scanning the whole string as text, using lib.mjs's `commandSegments` to read each segment's program and arguments. A subagent's `grep -rn "git merge" plugin/`, `git commit -m "docs: git merge stays with the founder"`, and other quoted-argument mentions of the words all pass; its `git merge feat`, `gh pr merge 12 --squash`, `git branch -d feat` and `git push origin :feat` are refused, including inside `bash -c` and `pwsh -Command` strings; the main session's identical commands still pass. When the parser cannot read a command, the current text match decides, so the gate does not fail open on a quoting trick.

## Mechanism

No skill, plugin or MCP fits, and no model call. lib.mjs's `commandSegments`, already exported and already used by the redirect-guard and sandbox-guard, parses each segment into program, args, tokens and redirects; the shell arm walks the segments and judges each by program and subcommand: `git merge` (not `merge-base`, not `merge-tree`) with `-C` and `-c` skipped, `gh pr merge`, `gh api` with a path ending in `/merge`, `git branch -d/-D/--delete`, and `git push` with a delete flag or an empty-left-side refspec. A quoted argument to any other program, grep, echo, printf, `git commit -m`, `git log --grep`, `node -e`, `Select-String`, is never read. An interpreter's inline string (`bash -c`, `sh -c`, `pwsh -Command`, `powershell -c`) is parsed as its own command list and judged the same way. When `commandSegments` reports a parse error the old regex text match decides, kept as one function named for what it is, so a quoting trick does not fail the gate open. Identity is `agentIdentity(payload) !== null`, any non-empty `agent_type`, the rule the global copy already applies; the forge arm is unchanged. Behavioural tests first, committed red; Opus builds.

## Acceptance criterion

Given `tests/hooks/fixtures/block-merge-cases.mjs` with its `passes` and `blocks` lists, each entry naming the first build record it came from, when `node --test tests/hooks/block-merge.test.mjs` runs, then every `passes` command exits 0 for a payload with `agent_type` `general-purpose` on both `Bash` and `PowerShell`; every `blocks` command exits 2 for that payload and exits 0 for a payload with no `agent_type`; `git merge feat "unterminated` exits 2 with a reason that names the text fallback; and every forge-arm test of the first build passes unchanged.

## Files

```aeo-independence
slice: 02-block-merge-structural
edits: plugin/hooks/block-merge.mjs
edits: tests/hooks/block-merge.test.mjs
creates: tests/hooks/fixtures/block-merge-cases.mjs
depends-on: 01-one-process
```

## Out of scope

Any change to lib.mjs (a gap found in `commandSegments` is reported in the pull request, not patched here; slice 03 owns lib.mjs in this phase); the founder's global copy at `~/.claude/hooks`, which is copied over by hand after the phase closes; README's "Who merges" section and every skill that names roles (phase 3); gate.mjs and hooks.json (slice 01).
