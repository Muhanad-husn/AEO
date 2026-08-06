# fix/phase-1/wiring — Checkpoint 1 wiring and reporter defects

Six defects from the Checkpoint 1 review round, closed in `plugin/hooks/hooks.json`
and `plugin/hooks/session-status.mjs`. Two were fail-opens no test could have caught,
because both tests asserted the spelling of a value rather than what the platform does
with it.

Scope was narrowed mid-slice by a founder constraint: fix the defect, change nothing
else. Three items were built and then removed under it, and they are listed at the end.

## What changed

### 1. `matcher: "*"` on the review-jail entry — removed the field

The hooks documentation lists `"*"`, `""` and an omitted matcher as three supported
ways to match every tool, so `"*"` was not broken. It was, however, correct only as a
special case: `new RegExp("*")` raises `Nothing to repeat`, and the matcher is handed
to `RegExp.prototype.test` for any pattern outside the exact-match character set. If
that special case is ever dropped, the jail stops registering and the reviewer gets
every tool, silently.

Every shipped official plugin that fires on all tools omits the field. `hookify`, the
reference PreToolUse plugin, is the clearest case. None uses `"*"`. The matcher is now
omitted, which is correct under every reading of the rule.

The registration test no longer compares the string to itself. It models the documented
matching rule and asserts the entry *fires* for a spread of real tool names, and a
second test asserts every matcher in the manifest either is an all-tools form or
compiles as a regex. That second test is the one that would have caught this.

`tests/hooks/review-jail.test.mjs` already accepted `"*"`, `""` or omitted, so the two
files stay consistent with no edit to the jail's own suite.

### 2. `"shell": "bash"` gated the whole reporter — SessionStart is now two entries

`shell` wraps the entire command, and SessionStart was one shell-form entry, so bash
gated the ground-truth report as well as the banner. Outside Git Bash on this machine
`bash` resolves to the WSL launcher and fails, and `sh` is not on PATH at all. The
session then opened with no branch, no HEAD, no issues, no PRs, no run log and no
gate-health banner, while `preflight()` reported ok because `hooks.json` parsed and
every script was present. That is the L-08 failure the hook exists to prevent.

Now:

- the report is exec form (`"command": "node"` with `args`, no `shell`), which no
  shell can defeat;
- the banner is a separate shell-form entry carrying only
  `node --version > /dev/null 2>&1 || echo "<banner>"`.

A broken shell now costs the banner alone. The docs also state `shell` is ignored when
`args` is set, so the two forms cannot be combined in one entry.

The banner moved from single to double quotes. `RUNTIME_MISSING_BANNER` was authored
with no `$` or backtick precisely so one quoting style could serve every shell, and that
only pays off with double quotes: cmd.exe does not treat `'` as quoting and would print
the marks as literal text.

The existing regression test that no gate entry carries a `|| echo` fallback is
untouched and still passing.

### 3. Unexpected JSON rendered as a confident zero

`ghJson` coerced any non-array JSON to `[]`, so a `gh` that exits 0 printing
`{"message":"Not Found"}` produced `**Open issues:** none.` Empty stdout on a zero exit
did the same. Both are now `ok: false` with a reason, which renders as unknown.
`gh --json` always prints at least `[]`, so silence is no answer rather than an empty
one.

### 4. Caps printed a truncated count as a total

Issues and open PRs now request `limit + 1` and render `limit`. The extra item is never
displayed; it exists only to prove the list was cut. An over-cap section reads
`**Open issues (showing 40 of more than 40):**`. Under the cap the header is unchanged.

The merged-PR cap stays a plain 10: that section is labelled "Last N merged", which
claims recency and never a total.

The run-log excerpt gained the same marker: `> _(excerpt: N more line(s) in the
summary)_` when `RUN_LOG_HEAD_LINES` drops anything.

### 5. `NotebookEdit` was unfenced

The path-guard matcher is now `^(Edit|Write|MultiEdit|NotebookEdit)$`. Per C-04 the
matcher is a best-effort pre-filter, so widening costs an extra process and narrowing
costs the gate.

**This is inert until `path-guard.mjs` changes too.** The gate's own body returns early
for any tool that is not `Edit` or `Write`, and it reads `tool_input.file_path`, while
`NotebookEdit` names its target `notebook_path`. That file is owned by another slice.

### 6. Unborn HEAD reported no branch at all

`if (branch)` skipped the whole line when `currentBranch` returned null, so a fresh
`git init` repo listed issues and PRs but never named the branch. The line is now
unconditional and reads `**Branch:** unknown (unborn HEAD, or git did not answer)`.

## Known gap, documented rather than fixed

`AEO_GH_PREFIX_ARGS` is `JSON.parse`d at module scope, so an invalid value throws
before `runReporter` is entered and Node exits 1, narrowing the file header's claim
that the reporter always exits 0. Exit 1 is a non-blocking hook error: it costs a
report, never a session. `lib.mjs` already names module-scope crashes as a class its
guarantees do not reach. A comment now says so at the line.

## Removed under the scope constraint

Built, then removed before commit:

- `AEO_REQUIRE_SHELL_TESTS=1`, which would have turned the three runtime-fallback skips
  into failures, plus the CI workflow line that set it. Judged a config nobody sets.
  Naming D19 in the skip reason was kept; it is free.
- A `symbolic-ref` fallback that would have distinguished an unborn branch by name from
  a git that did not answer. Defect 6 is one line instead.
- A guarded parse for `AEO_GH_PREFIX_ARGS`, replaced by the comment above.
- Two hooks.json tests that generalised existing rules rather than covering the defects,
  and four session-status tests covering adjacent behaviour that already worked.
