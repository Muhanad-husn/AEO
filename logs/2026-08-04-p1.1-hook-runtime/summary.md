# P1.1 — hook runtime

2026-08-04. Branch `feat/phase-1/p1.1-hook-runtime`.

## What was built

`plugin/hooks/lib.mjs` — the shared library every Phase 1 gate imports. Node
ESM, built-ins only, no dependency and no install step. Public surface:

| Export | Does |
| --- | --- |
| `runGate({name, run})` | Entry point for a blocking gate. Reads and parses the payload, runs the gate, owns every exit |
| `runReporter({name, run})` | Entry point for a hook that reports and never blocks. Always exits 0; the return value is stdout |
| `block(reason)` | The only way to block. Throws and latches; safe without `return` |
| `agentIdentity(payload)` | The trimmed `agent_type`, or null. For messages, never for a policy test |
| `isAeoRole(payload, role)` | Exactly `^aeo:<role>$`, role regex-escaped |
| `isAnyAeoRole(payload)` | Any subagent this plugin ships |
| `matchesGitSubcommand(cmd, sub)` | Whole-token argv match through git's own pre-subcommand options |
| `isPathInside(parent, child)` | Whole-segment path containment |
| `normalizeHookPath(p, {platform})` | `/d/proj` to `D:/proj`, Windows only |
| `resolveOperationDir(payload, opts)` | The directory a call operates in, and which of the four sources it came from |
| `resolveWorktree(payload, opts)` | The same, normalised to the git toplevel |
| `git(dir, ...args)` | Run git in `dir`; trimmed stdout or null. Never throws |
| `gitToplevel(dir)` / `currentBranch(dir)` | Named readings of the two facts every gate needs |
| `defaultBranch(dir)` | D14 resolution, cached per invocation |
| `preflight({pluginRoot})` | Gate health, with a rendered banner |
| `PLUGIN_NAMESPACE` | `aeo` |
| `RUNTIME_MISSING_BANNER` | The one line a non-Node shell fallback prints |

`tests/hooks/lib.test.mjs` and `tests/hooks/runtime-fallback.test.mjs`, with
two fixture hooks under `tests/hooks/fixtures/`. At the repo root, not inside
`plugin/` — D1 says `plugin/hooks/` holds gates and the library and nothing
else, and the shipped plugin carries no test files and no `package.json`.

## Decisions made in this slice

**A malformed or empty payload allows; an internal error blocks.** The
PowerShell originals allowed on any parse failure. That is kept, but for a
stated reason rather than by inheritance: the model cannot cause a malformed
payload. Claude Code serializes it, and every model-controlled string sits
inside valid JSON, so a parse failure is a platform fault and not a bypass
vector. Blocking on it would brick the session for no security gain. What
changed is that it is no longer silent — the originals' silent `exit 0` on a
parse failure meant a payload-shape change would have disabled every gate with
no signal at all (L-08). Once the payload is readable the gate had a decision
to make, so an internal error blocks: a gate that cannot decide does not pass
the call.

**`block()` throws and latches.** A gate that wraps its own body in
`try`/`catch` would otherwise swallow the throw and fall through to allow. The
latch closes that, and it is tested. `runGate` holds the only `process.exit(2)`
in the plugin, and never exits with anything but 0 or 2 — any other non-zero
exit is a non-blocking error, meaning the tool call proceeds and the gate has
failed open (C-06).

**Two entry points, no flags.** `runGate` blocks on internal error; P1.7 gets
`runReporter`, which cannot block at all. A boolean would have been a config
nobody sets. This also makes P1.7's stated must-not — "block anything" —
structural instead of a promise.

**The last resort in worktree resolution is `process.cwd()`, not the hook
script's grandparent.** The PowerShell walked up two levels from the script
directory. In a plugin that is the ephemeral plugin cache (C-09, D12), so the
ported form would have resolved gates against the wrong repository entirely.
Deliberately not carried across.

**MSYS normalisation is Windows-only.** On POSIX, `/d/proj` is a real path and
rewriting it to `D:/proj` would be a new bug. The PowerShell original could not
have this bug; the port can, so `normalizeHookPath` takes a platform seam and
both directions are tested.

**No generic token matcher was shipped.** V-12's rule is stated once in the
library header and enforced by the two shapes Phase 1 actually needs:
`matchesGitSubcommand` for argv, `isPathInside` for paths. A third,
general-purpose `containsToken` had no Phase 1 consumer that it served
correctly — see the flag below — and an unused helper is a tripwire-2
abstraction with zero implementations.

**`isAnyAeoRole` matches `^aeo:[a-z][a-z0-9._-]*$` rather than a hard-coded
roster.** The library does not need to know that the roles are builder,
reviewer and triage, and would rot if it did.

## The runtime preflight, and what it does not cover

D8 asks for a preflight that makes a missing `node` loud instead of silent.
There is a bootstrap problem inside that sentence, and it does not fully close.

**A Node script cannot report that Node is missing.** If `node` does not
resolve, the hook command never starts, exits non-zero-but-not-2, and Claude
Code treats that as a non-blocking error — the tool call proceeds and the gate
has failed open. Nothing written in Node can observe this, `preflight()`
included.

So the problem was split.

**What `preflight()` covers**, because Node is running when it runs: a Node
older than 18; `git` not on PATH; `CLAUDE_PLUGIN_ROOT` unset; a missing or
unparseable `hooks/hooks.json`; a `hooks.json` that registers no gate scripts;
and a `hooks.json` entry pointing at a script that is not on disk. Each of
those makes a gate fail open silently today, each is reachable from inside
Node, and each has a test. It returns `{ok, checks, banner}` so P1.7 renders
the banner and `/aeo:status` can render the checks.

**What covers the missing runtime itself** is the only thing that can: a
non-Node fallback in the `hooks.json` command string. `RUNTIME_MISSING_BANNER`
is exported so that string has one source of truth, and it is deliberately one
line with no quotes, dollar signs or backticks so it survives sh, cmd and pwsh
quoting unchanged. The form P1.7 should use is a `"shell": "bash"` command
entry that runs the session-status script and falls back to `echo` of the
banner on any failure:

    node "<plugin root>/hooks/session-status.mjs" || echo '<banner>'

SessionStart stdout is injected into context, so the banner lands where it
cannot be missed, and the fallback makes the hook exit 0 rather than producing
a bare hook-error notice.

**What is still not covered, stated plainly rather than dressed as coverage.**

1. **The `||` fallback belongs only on the reporter, never on a gate.** It
   fires on any non-zero status, so on a gate it would convert every exit 2
   into a pass — turning the mitigation into a hole. There is a test that
   demonstrates exactly this, so the trap is recorded rather than remembered.
2. **The fallback needs a shell that understands `||`.** Windows PowerShell
   5.1 does not; it is a parse error, and the hook would then produce nothing
   at all. Hence the explicit `"shell": "bash"`, which is documented (C-05) —
   but on a Windows box with no Git Bash that entry does not run either. On
   such a machine the missing runtime is unreported.
3. **Between a missing runtime and the next SessionStart, the gates are open
   and nothing says so.** The banner is a session-start signal, not a per-call
   one. D8 accepted this consciously: the alternative is blocking all tool use
   when the runtime is absent, which bricks a session for a condition the
   founder fixes in a minute.
4. **A gate that crashes before reaching `runGate`** — a syntax error in the
   gate file, a bad import — fails open the same way. The `preflight`
   script-exists check catches the missing-file case, not the broken-file case.

## C-05, verified

Checked against the current official docs (`code.claude.com/docs/en/hooks` and
`/plugins-reference`) on 2026-08-04.

- **A per-hook `shell` field exists and is documented**, values `bash` and
  `powershell`. It defaults to `bash` on macOS and Linux, and to `powershell`
  on Windows when Git Bash is not installed. It is ignored when `args` is
  present, because the exec form uses no shell.
- **The vendored claim is neither supported nor contradicted.** The docs say
  nothing about the call-operator hook form failing to register alongside a
  `shell:` field. The observation was pinned to 2.1.201; the current docs do
  not address it. Treat it as unverified, not as fact — and it is moot for us,
  because the documented idiom is `node "<plugin root>/..."` and no AEO hook
  uses the call-operator form.

Two further findings from the same check that later slices need:

- **There is an exec form.** `command` plus `args` runs with no shell at all,
  which removes every quoting question. The plugin-root variable interpolates
  in both forms and is also exported as an environment variable. The exec form
  is the better default for gates; the shell form is required only where the
  `||` fallback is wanted, which is P1.7 alone.
- **Per-hook `timeout` is in seconds**, default 600 for command hooks, with
  lower defaults on some events. P1.3 owes an explicit one.

## Flagged, not decided here

- **Push-refspec matching is P1.2's problem and the library does not solve
  it.** `git push origin HEAD:main` and `git push origin +main` both target
  the default branch without containing it as a bare argv token, and the
  production regex `\bmain\b` false-positives on `feat/main-thing`. Neither
  `matchesGitSubcommand` nor a generic token matcher answers this correctly,
  which is why no generic token matcher was shipped. P1.2 needs a
  refspec-aware test, and if a second consumer appears it belongs here.
- **`node --test tests/hooks/` does not work on Node 24.** Since Node 22.6 a
  positional argument to `--test` is a glob pattern, and that one resolves to
  the directory itself, which Node then fails to load as a module. The working
  commands are `node --test` from the repo root, or
  `node --test "tests/hooks/*.test.mjs"`. Recorded because the slice brief
  named the directory form.
- **`agent_type` also arrives on a main session run with `--agent`.** If the
  founder deliberately launches the main session as `aeo:builder`,
  `isAnyAeoRole` is true and the merge gate will block them. That is the
  correct reading of C-02 — they are the builder in that mode — but it is a
  behaviour worth knowing before it surprises someone.
- **The `aeo` namespace is hard-coded.** It is the plugin's `name` from
  `plugin.json`, so it is an identity rather than a tuned constant, but a
  rename would need to change it in one place here.
- **No `hooks.json` was written.** P1.1 ships no gate and registers nothing;
  `plugin/hooks/` still holds only `lib.mjs` and its `.gitkeep`. The plugin
  therefore still reports zero hooks, which `preflight` correctly reports as a
  failure today.

## Verification

`node --test` from the repo root: **95 tests, 95 pass, 0 fail, 0 skipped**,
about 7 seconds, on Node 24.16.0.

Named cases the brief called for, all present and passing: MSYS paths
including the `/tmp` and `/usr` non-matches and the POSIX-platform
non-rewrite; `agent_type` absent, bare (`builder`), a foreign plugin's
(`some-plugin:reviewer`), and ours (`aeo:builder`), plus anchoring and
newline-smuggling; `cd <dir> &&` resolution quoted, single-quoted, unquoted
and in MSYS form, with the semicolon and `||` variants correctly not honoured;
substring-versus-whole-token (`git merge-base` is not `git merge`,
`git -C d merge` is); path prefix with and without a trailing separator, and
`D:/project` not inside `D:/proj`. Plus the exit-code invariant — across every
fixture mode, including an unknown one, a gate exits only 0 or 2.
