# P7.6: the inline SessionStart hook, observed live

2026-08-13. Branch `fix/69-70-log-evidence`, cut from `main` at `57fc945`. Issue #70.

**Status: the inline entry fired in a real session, on Git Bash, and the banner reached
the session context verbatim. The eighth wired entry now has an evidence line.**

The probe was expected to be redundant. It was not. The test that covers this entry
skips on this machine, so before this run D19 had no evidence here at all.

## Why the probe was not redundant

Issue #70's own correction comment says the entry is "proven by test, unobserved live",
citing `tests/hooks/runtime-fallback.test.mjs`. That test gates every assertion on a
POSIX shell it finds by spawning `sh`. Run on this machine:

```
node --test tests/hooks/runtime-fallback.test.mjs

- fires when the interpreter does not resolve # no POSIX shell on PATH; D19 (the
  SessionStart runtime banner) is UNVERIFIED in this run
- stays quiet when the interpreter does resolve # (same skip)
- a gate that blocks still blocks through the fallback form # (same skip)

tests 3 | pass 0 | fail 0 | skipped 3
```

`sh` is not on this machine's `PATH`. The skip is loud and its reason is exact, which is
the test behaving as written. But the consequence is that the entry was proven nowhere
here, not merely unobserved live. Every green run of the suite on this machine has
carried three skips where D19's evidence was assumed to be.

That is the reversal worth recording. **The live probe is not a second copy of the test.
On this machine it is the only evidence that exists.**

## The evidence line

```
fired - the inline SessionStart entry printed the fail-open banner into a real `-p`
        session launched with --plugin-dir and no `node` on PATH: "[AEO] GATES NOT
        ENFORCING: node did not resolve, so every AEO hook fails open. Install Node 18+
        on PATH and restart Claude Code." The session read it back verbatim from its own
        context. Shell: Git Bash, `/usr/bin/bash`, `uname -s` = MINGW64_NT-10.0-26200.
        In the same session `session-status` produced nothing, so D8's fail-open is
        observed rather than argued: the Node hooks were dead and the banner was the
        only thing that spoke. Control: the same command in the same directory with
        `node` on PATH printed no banner and did produce the session-status report.
```

## Method

Scratch directory outside every tracked tree, created for this run and deleted after it.
Nothing in `D:\AEO`, the testbed, the dry-run repository, `~/.claude/` or `D:\axial` was
written to. `plugin/hooks/hooks.json` was not modified.

### The condition is reachable, which is the premise

`claude` on this machine is `C:\Users\mou97\.local\bin\claude.exe`, version 2.1.229.0, a
native binary rather than a shim that runs under Node. So Claude Code starts with no
`node` on `PATH`, the harness lives, and every exec-form hook in `hooks.json` dies. That
is exactly D8's scenario, and it is not hypothetical on this install.

`PATH` was stripped inside the probe process only, by dropping entries matching
`nodejs|node_modules|nvm|fnm|\.volta`. Two entries went, both `C:\Program Files\nodejs`.
After the strip `node` did not resolve and `claude` still did. The founder's environment
was never changed; the shell state does not outlive the call.

### Control, then treatment

Both runs used the same prompt, fed on stdin, telling the session it is a mechanical
probe, to use no tools, and to report back any line in its context containing `GATES NOT
ENFORCING` and whether a session-start gate report was present.

```
claude --plugin-dir D:/AEO-wt/69/plugin -p   (prompt on stdin)
```

| Run | `node` on PATH | Banner | session-status report |
| --- | --- | --- | --- |
| Control | yes | `BANNER ABSENT` | `PRESENT` |
| Treatment | no | `BANNER PRESENT`, quoted verbatim | `ABSENT` |

Same directory, same plugin directory, same prompt, minutes apart. `PATH` is the only
difference, so the flip in both columns is attributable to it. The control is what makes
this a measurement rather than an assertion: the entry is silent when it should be.

### Which shell, established rather than assumed

Issue #70 asks the platform question, and it is a real one here. On `PATH`, `bash`
resolves to `C:\WINDOWS\system32\bash.exe`, the WSL launcher, and on this machine it is
broken:

```
<3>WSL (10 - Relay) ERROR: CreateProcessCommon:798: execvpe(/bin/bash) failed
exit 1
```

Feeding the literal wired command to that `bash` with `node` stripped produces exit 1 and
an empty stdout. No banner. So if Claude Code resolved `"shell": "bash"` by `PATH` order
here, the entry would be silently dead in precisely the situation it exists to report.

It does not. A separate SessionStart hook carrying `"shell": "bash"`, declared in the
scratch project's own `.claude/settings.local.json` and nowhere near the plugin, reported
its interpreter:

```
BASH=/usr/bin/bash  SHELL_ID=/usr/bin/bash  UNAME=MINGW64_NT-10.0-26200
```

That is Git Bash, which is installed but is not on `PATH`. Claude Code finds it
independently of `PATH` order. The POSIX-shell worry in the issue body is answered: the
shell is POSIX, it is not WSL, and it is located without help.

### Direct invocation of the literal wired command

Supporting rather than primary, and `invoked` rather than `fired`. The command string was
read out of `plugin/hooks/hooks.json` by the probe rather than retyped, so it cannot drift
from what is wired, and run through Git Bash directly:

| `node` | exit | stdout |
| --- | --- | --- |
| on PATH | 0 | empty |
| PATH stripped | 0 | the banner, exactly one line |

Exit 0 in both arms matters. A SessionStart entry that exited non-zero would be a hook
error rather than a report.

## What this establishes that the test does not

- The entry is wired to the event, dispatched, and reaches a real session's context. The
  test proves the command form; it cannot prove the wiring. Both of this plugin's shipped
  hook defects were wiring defects that direct invocation passes on.
- The shell Claude Code selects for `"shell": "bash"` on Windows, by name and by `uname`.
- The fail-open itself. `SESSION-STATUS: ABSENT` alongside `BANNER PRESENT` is D8 and L-08
  in one observation: the gates ran nothing, and the only reason the session was not told
  everything was fine is this entry.
- That the banner survives the real condition, not a substituted one. The test swaps in a
  command name that does not exist, deliberately, because stripping `PATH` inside a test
  would also hide the shell. The live probe strips the real thing.

## What it does not establish

- The blocking arm. The test's third case, that `||` would convert a gate's exit 2 into a
  pass, is the trap that keeps this form off the gates. Nothing here re-tests it, and on
  this machine nothing tests it at all while `sh` is absent.
- Any shell other than Git Bash, and any machine other than this one.
- `cmd.exe` quoting. The banner is authored with no `$` or backtick so one quoting style
  serves every shell, and that reasoning is unchanged and untested here.

## Findings, as issue candidates

Neither is fixed here. This slice's declared paths are two log files.

1. **`runtime-fallback.test.mjs` skips on the platform it was written for.** Its
   availability probe spawns `sh`, which is absent on this Windows machine, while the
   shell the harness actually uses is Git Bash at `/usr/bin/bash`: present, working, and
   not on `PATH`. The test therefore reports D19 as UNVERIFIED on exactly the platform
   whose quoting and shell-resolution questions it was written to settle, and a green
   suite here has never covered it. Candidate: have the probe try Git Bash as well as
   `sh`, and prefer whatever the harness itself resolves. This is the sharper form of the
   same defect the test's own skip reason warns about, which is that a green run
   containing this skip has already been misread as a green run containing this evidence.

2. **The inline entry now has better live evidence than unit coverage on this install.**
   Not a defect in the plugin, but worth stating plainly: after this run the entry's
   behaviour in a real session is established here and its test is not. Fixing finding 1
   is what makes both hold.
