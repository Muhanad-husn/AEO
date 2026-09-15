# feat(phase-1): a command the guard cannot read is judged on what it can read [slice 03]

**Spec:** PLAN.md#5-phases, row "1 Invariants"; PLAN.md#3 · **Plan:** plans/phase-1/03-unreadable-command-warns.md
**Depends on:** #167 · **Issue:** #169
**Labels:** phase-1

## Deliverable

With production data declared, `echo "unterminated` runs and the session sees a warning naming what could not be read; `cat "unterminated D:/live/index.json` is still refused because the path it names resolves inside the live root. This slice folds rule 4 into rule 3: both are a command the guard cannot fully read, and both refused harmless commands when armed; under this slice both allow after judging what can be read. This is a proposal beyond PLAN.md's literal line, which names rule 3 only; the founder decides it at review.

## Mechanism

No skill, plugin or MCP fits. `lib.mjs` gains `warn(text)`, latched like `block`, and `runGate` on a clean run with a latched warning writes one JSON object to stdout carrying the allow decision, the reason, `additionalContext` with the warning text, and `systemMessage` with the same text, then exits 0; a warning never changes an exit code. In `sandbox-guard.mjs`, rules 3 and 4 no longer call `block`: when the parser fails, rules 1 and 2 run as today, rule 5 runs over every path-shaped token `shellTokens` and `pathCandidates` yield (absolute ones resolved as they are, relative ones against the payload's own directory), and rule 6 runs over the payload's directory, then `warn` records that the command could not be read as shell and which rules were judged on tokens; when a `cd` cannot be named, rules 1, 2, 5 and 6 run over every directory the walk did resolve and every absolute path named, then `warn` records the unnamed directory. The builder confirms with one live call which of `additionalContext` and `systemMessage` the running Claude Code version surfaces to the model, and records the answer in the pull request body. No model call. Behavioural tests first, committed red; Opus builds (this loosens a fail-closed gate, so the adversarial read applies).

## Acceptance criterion

Given `AEO_LIVE_DATA_ROOT` declared as `<tmp>/live` in the repository's `.claude/settings.json` and `AEO_DATA_ROOT` set to `<tmp>/sandbox`, when `node --test tests/hooks/sandbox-guard.test.mjs` runs, then a Bash payload `echo "unterminated` exits 0 with a stdout JSON allow decision whose `additionalContext` names the unread command; `cat "unterminated <tmp>/live/index.json` exits 2 naming the live root; `cd $DIR && ls` exits 0 with a warning naming the unnamed directory; `cd $DIR && cat <tmp>/live/x` exits 2; with a live sentinel and `aeo-tests.json` declaring `npm test`, `npm test "unterminated` exits 2 for the sentinel; with no declaration at all `echo "unterminated` exits 0 with no stdout; and every existing test in the file outside the two rules passes unchanged.

## Files

```aeo-independence
slice: 03-unreadable-command-warns
edits: plugin/hooks/sandbox-guard.mjs
edits: plugin/hooks/lib.mjs
edits: tests/hooks/sandbox-guard.test.mjs
edits: tests/hooks/lib.test.mjs
depends-on: 01-one-process
```

## Out of scope

Rules 1, 2, 5 and 6 themselves; the matcher that stops Read reaching the guard (slice 01); the session-start line that reports the armed state (phase 2); the `run-sentinel` script; the founder's global hooks.
