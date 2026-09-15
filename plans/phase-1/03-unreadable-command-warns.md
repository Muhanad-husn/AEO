# 03: A command the guard cannot read is judged on what it can read

Issue: [#169](https://github.com/Muhanad-husn/AEO/issues/169)

## Goal

With production data declared, `echo "unterminated` runs and the session sees a warning
naming what could not be read; `cat "unterminated D:/live/index.json` is still refused
because the path it names resolves inside the live root.

This slice folds rule 4 into rule 3: both are a command the guard cannot fully read, and
both refused harmless commands when armed. Under this slice both allow after judging what
can be read. This is a proposal beyond PLAN.md's literal line, which names rule 3 only;
the founder decides it at review.

## Acceptance criterion

Given `AEO_LIVE_DATA_ROOT` declared as `<tmp>/live` in the repository's
`.claude/settings.json` and `AEO_DATA_ROOT` set to `<tmp>/sandbox`,
when `node --test tests/hooks/sandbox-guard.test.mjs` runs,
then a Bash payload `echo "unterminated` exits 0 with a stdout JSON allow decision whose
`additionalContext` names the unread command; `cat "unterminated <tmp>/live/index.json`
exits 2 naming the live root; `cd $DIR && ls` exits 0 with a warning naming the unnamed
directory; `cd $DIR && cat <tmp>/live/x` exits 2; with a live sentinel and
`aeo-tests.json` declaring `npm test`, `npm test "unterminated` exits 2 for the sentinel;
with no declaration at all `echo "unterminated` exits 0 with no stdout; and every
existing test in the file outside the two rules passes unchanged.

## Mechanism

- No skill or plugin fits. No MCP.
- Library: `lib.mjs` gains `warn(text)`, latched like `block`, and `runGate` on a clean
  run with a latched warning writes one JSON object to stdout carrying the allow
  decision, the reason, `additionalContext` with the warning text, and `systemMessage`
  with the same text, then exits 0; a warning never changes an exit code.
- In `sandbox-guard.mjs`, rules 3 and 4 no longer call `block`. When the parser fails,
  rule 1 and rule 2 run as they do today (they do not need the parse), rule 5 runs over
  every path-shaped token `shellTokens` and `pathCandidates` yield, absolute ones
  resolved as they are and relative ones against the payload's own directory, and rule 6
  runs over the payload's directory; then `warn` records that the command could not be
  read as shell and which rules were judged on tokens. When a `cd` cannot be named,
  rules 1, 2, 5 and 6 run over every directory the walk did resolve and every absolute
  path named; then `warn` records the unnamed directory.
- The builder confirms with one live call which of `additionalContext` and
  `systemMessage` the running Claude Code version surfaces to the model, and records the
  answer in the pull request body.
- No model call. Behavioural tests first, committed red; Opus builds (this loosens a
  fail-closed gate, so the adversarial read applies).

## Shape

- `lib.mjs`: `warn`, a latched `warnText`, and the JSON write in `runGate`'s clean exit,
  about twenty lines.
- `lib.test.mjs`: one describe for the warning shape and that a warning never changes an
  exit code.
- `sandbox-guard.mjs`: the two `block` calls for rules 3 and 4 become a token-judged pass
  followed by `warn`; the header's "REFUSE, NEVER WARN" paragraph is rewritten to say
  which rules refuse and which warn, and why (PLAN.md section 3's line).
- `sandbox-guard.test.mjs`: the describes that assert a refusal on a parse error or an
  unnamed `cd` are rewritten to assert the warning and the token judgement.

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

Rules 1, 2, 5 and 6 themselves; the matcher that stops Read reaching the guard
(slice 01); the session-start line that reports the armed state (phase 2); the
`run-sentinel` script; the founder's global hooks.
