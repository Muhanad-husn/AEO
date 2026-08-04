# P1.1: hook runtime

2026-08-04. Branch `feat/phase-1/p1.1-hook-runtime`.

## What was built

`plugin/hooks/lib.mjs` is the shared library every Phase 1 gate imports. Node
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
`plugin/`. D1 says `plugin/hooks/` holds gates and the library and nothing
else, and the shipped plugin carries no test files and no `package.json`.

## Decisions made in this slice

**A malformed or empty payload allows; an internal error blocks.** The
PowerShell originals allowed on any parse failure. That is kept, but for a
stated reason rather than by inheritance: the model cannot cause a malformed
payload. Claude Code serializes it, and every model-controlled string sits
inside valid JSON, so a parse failure is a platform fault and not a bypass
vector. Blocking on it would brick the session for no security gain. What
changed is that it is no longer silent. The originals' silent `exit 0` on a
parse failure meant a payload-shape change would have disabled every gate with
no signal at all (L-08). Once the payload is readable the gate had a decision
to make, so an internal error blocks: a gate that cannot decide does not pass
the call.

**`block()` throws and latches.** A gate that wraps its own body in
`try`/`catch` would otherwise swallow the throw and fall through to allow. The
latch closes that, and it is tested. `runGate` holds the only `process.exit(2)`
in the plugin, and never exits with anything but 0 or 2. Any other non-zero
exit is a non-blocking error, meaning the tool call proceeds and the gate has
failed open (C-06).

**Two entry points, no flags.** `runGate` blocks on internal error; P1.7 gets
`runReporter`, which cannot block at all. A boolean would have been a config
nobody sets. This also makes P1.7's stated must-not, "block anything",
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
correctly (see the flag below), and an unused helper is a tripwire-2
abstraction with zero implementations.

**`isAnyAeoRole` matches `^aeo:[a-z][a-z0-9._-]*$` rather than a hard-coded
roster.** The library does not need to know that the roles are builder,
reviewer and triage, and would rot if it did.

## The runtime preflight, and what it does not cover

D8 asks for a preflight that makes a missing `node` loud instead of silent.
There is a bootstrap problem inside that sentence, and it does not fully close.

**A Node script cannot report that Node is missing.** If `node` does not
resolve, the hook command never starts, exits non-zero-but-not-2, and Claude
Code treats that as a non-blocking error: the tool call proceeds and the gate
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
   into a pass, turning the mitigation into a hole. There is a test that
   demonstrates exactly this, so the trap is recorded rather than remembered.
2. **The fallback needs a shell that understands `||`.** Windows PowerShell
   5.1 does not; it is a parse error, and the hook would then produce nothing
   at all. Hence the explicit `"shell": "bash"`, which is documented (C-05).
   But on a Windows box with no Git Bash that entry does not run either. On
   such a machine the missing runtime is unreported.
3. **Between a missing runtime and the next SessionStart, the gates are open
   and nothing says so.** The banner is a session-start signal, not a per-call
   one. D8 accepted this consciously: the alternative is blocking all tool use
   when the runtime is absent, which bricks a session for a condition the
   founder fixes in a minute.
4. **A gate that crashes before reaching `runGate`**, from a syntax error in
   the gate file or a bad import, fails open the same way. The `preflight`
   script-exists check catches the missing-file case, not the broken-file case.
   Post-review this is pinned by a test rather than left as prose; see below.

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
  not address it. Treat it as unverified, not as fact. It is also moot for us,
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
  correct reading of C-02, since they are the builder in that mode, but it is a
  behaviour worth knowing before it surprises someone.
- **The `aeo` namespace is hard-coded. Closed by a test in review.** It is the
  plugin's `name` from `plugin.json`, so it is an identity rather than a tuned
  constant, but a rename would need to change it in one place here. The review
  found the test pinning it asserted the literal `'aeo'` and never opened the
  manifest, so a rename would have left every identity gate matching nothing
  and firing on no call, with the test still green. The test now reads
  `plugin/.claude-plugin/plugin.json` and compares. The constant stays
  hard-coded: reading the manifest at runtime would add a file read and a new
  failure mode to every hook invocation, and in the installed layout the
  manifest is not adjacent to `lib.mjs`, so resolving it would depend on
  `CLAUDE_PLUGIN_ROOT`, which `preflight` already reports as sometimes unset.
  A rename happens once and a test catches it for free.
- **No `hooks.json` was written.** P1.1 ships no gate and registers nothing;
  `plugin/hooks/` still holds only `lib.mjs` and its `.gitkeep`. The plugin
  therefore still reports zero hooks, which `preflight` correctly reports as a
  failure today.

## Independent review, and what it changed

An independent Opus reviewer read the diff without this record and returned
`APPROVE_WITH_FINDINGS`: the slice is sound, four findings. All four are closed
on this branch.

**F1, the one that mattered: `runGate` failed open on a non-Error throw.** The
catch handler read `err.message` directly. On `throw null` or a bare
`Promise.reject()` that raises a `TypeError` inside the catch handler itself,
where nothing catches it. Node then exits 1, exit 1 is a non-blocking error
(C-06), and the tool call proceeds. The gate failed open in the one function
that owns every exit. The concrete failure it would have caused: P1.3's commit
gate awaits a spawn wrapper that rejects bare on a red suite, the gate exits 1
instead of 2, and the commit lands. Confirmed out of process before the fix and
again after.

Three things changed.

1. A `describeError` helper replaces every direct `.message` read on a thrown
   value, in both entry points. It is defended against a hostile `message`
   getter too, because it runs on the block path and nothing on the block path
   is allowed to throw. A side effect: `throw 'a string'` used to exit 2 while
   reporting the reason as `undefined`, and now says what was thrown.
2. `runGate` installs `uncaughtException` and `unhandledRejection` handlers
   that block. `try`/`catch` around `run` covers the synchronous and awaited
   paths; it cannot see a floating rejection or a throw from a timer, and both
   exited 1. Verified as real by probe, not assumed.
3. `runReporter` gets the same two handlers resolved the other way, to exit 0.
   Its doc comment claimed "whatever happens, the exit code is 0" and that was
   not true for the same paths.

**The test that should have caught F1 is fixed as well, and that is the more
useful half.** The exit-code invariant test iterated fixture modes that only
ever threw a real `Error`, so it asserted the invariant across an input set
that excluded every value which broke it, and it passed while the gate failed
open. That is the L-08 shape: the assertion was never the weak part, the input
set was. The fixture now carries modes for `throw null`, a bare reject, a
string, a symbol, a hostile getter, a floating rejection and a timer throw; the
invariant iterates a named `GATE_MODES` list; and each mode also has its own
test asserting its stderr, so a typo in the list cannot silently remove
coverage.

**The two exit paths the library cannot close are now tests, not prose.** A
gate file that crashes at module scope exits 1, because `runGate` installs its
handlers when it is called and a bad import happens first. A gate that calls
`process.exit` itself owns its exit code. Both are pinned by assertions that
fail if the behaviour ever changes, so a later slice reads a fact instead of
rediscovering one.

**F2, the reporter swallowed a failed stdout write.** `catch { /* ignore */ }`
meant that if the SessionStart banner could not be written, it vanished with no
signal at all: gates open, preflight correctly detecting it, report silently
dropped. That contradicts the library's own stated rule, loud skip and never a
quiet pass. There is now a stderr fallback, and both remaining bare catches
carry a comment saying why there is nothing further to try.

**F3 is covered above under the namespace flag.** **F4 was style**: em-dash
density ran roughly double the `CLAUDE.md` cap in both `lib.mjs` and this file.
Rewritten rather than comma-swapped, since the comments in `lib.mjs` carry the
incident knowledge behind each fallback and that had to survive the edit.

Two review notes were deliberately left alone. `isAnyAeoRole` being false for
`general-purpose` and `Explore` narrows what production blocked, which is the
accepted cost of C-02 and P1.2's call to make; the library exports
`agentIdentity` and supports either policy. And `currentBranch` returning the
literal `HEAD` on a detached HEAD is now documented where the function is
defined, with no normalisation added, because the deciding consumer is P1.2 or
P1.3.

## Verification

`node --test` from the repo root: **104 tests, 104 pass, 0 fail, 0 skipped**,
about 16 seconds, on Node 24.16.0. Before the review fixes it was 95.

Named cases the brief called for, all present and passing: MSYS paths
including the `/tmp` and `/usr` non-matches and the POSIX-platform
non-rewrite; `agent_type` absent, bare (`builder`), a foreign plugin's
(`some-plugin:reviewer`), and ours (`aeo:builder`), plus anchoring and
newline-smuggling; `cd <dir> &&` resolution quoted, single-quoted, unquoted
and in MSYS form, with the semicolon and `||` variants correctly not honoured;
substring-versus-whole-token (`git merge-base` is not `git merge`,
`git -C d merge` is); path prefix with and without a trailing separator, and
`D:/project` not inside `D:/proj`.

The exit-code invariant now runs across thirteen fixture modes including an
unknown one, plus eight payload shapes, and each fail-open shape found in
review has a named test of its own.
