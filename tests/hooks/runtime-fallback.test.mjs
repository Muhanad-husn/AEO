// The one mitigation that survives a missing Node runtime (D8).
//
// A Node script cannot report that Node is missing. If `node` does not resolve, the
// hook command never starts, exits non-zero-but-not-2, and Claude Code treats that as
// a non-blocking error — the tool call proceeds and the gate has failed open (C-06).
// preflight() cannot cover this, because preflight() is Node.
//
// The only thing that can is a non-Node fallback in the hooks.json command string:
//
//   {
//     "type": "command",
//     "shell": "bash",
//     "command": "node --version > /dev/null 2>&1 || echo \"<banner>\""
//   }
//
// SessionStart stdout is injected into the session's context, so the banner arrives
// where it cannot be missed. These tests prove the form behaves as claimed: it fires
// when the interpreter does not resolve, and it stays quiet when it does.
//
// The banner is its own SessionStart entry, separate from the exec-form entry carrying
// the report. `shell` wraps the whole command, so a single shell-form entry put the
// report behind the same shell, and a Windows session outside Git Bash then got no
// report at all. Double quotes, not single: the banner is authored with no `$` or
// backtick precisely so one quoting style serves every shell, and cmd.exe does not
// treat `'` as quoting.
//
// The absent-runtime arm substitutes a command name that certainly does not exist for
// `node`, rather than stripping PATH — a stripped PATH would also hide the shell
// itself, and the mechanism under test is "interpreter not found", which is identical
// either way.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { RUNTIME_MISSING_BANNER } from '../../plugin/hooks/lib.mjs';

function probe(shellPath) {
  const r = spawnSync(shellPath, ['-c', 'echo probe'], { encoding: 'utf8', windowsHide: true });
  return !r.error && r.status === 0 && (r.stdout ?? '').trim() === 'probe';
}

// Discover a POSIX shell rather than assume one. `sh` on PATH covers Linux CI and
// Git Bash's own environment (PATH there already includes Git's usr/bin). Neither
// holds in a PowerShell session on Windows, which is where P7.6 found Claude Code's
// hooks.json actually running its "shell": "bash" entries: Git Bash at
// /usr/bin/bash, installed but not on PATH (see
// logs/2026-08-13-p7.6-inline-hook-probe/summary.md). `git` itself is on PATH
// wherever Git Bash is installed, and `git --exec-path` reports a path three
// directories below the Git install root (<root>/mingw64/libexec/git-core), which
// is enough to derive <root>/usr/bin/bash.exe without hard-coding an install
// location.
function resolveShell() {
  if (probe('sh')) return 'sh';

  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true });
  if (execPath.error || execPath.status !== 0) return null;
  const gitRoot = path.resolve(execPath.stdout.trim(), '..', '..', '..');
  const candidate = path.join(gitRoot, 'usr', 'bin', 'bash.exe');
  if (existsSync(candidate) && probe(candidate)) return candidate;

  return null;
}

const resolvedShell = resolveShell();

function sh(script) {
  if (!resolvedShell) {
    // No skip here (L-08): a skip's reason line sits inside a green summary and
    // goes unread — P7.6 found exactly that on this machine. A thrown error fails
    // the test outright, which turns `npm test`'s decisive line red and cannot be
    // missed. This only fires when neither `sh` nor a derivable Git Bash exists:
    // never on ubuntu-latest CI (sh is always on PATH there), and never inside Git
    // Bash itself (same reason). It fires on a Windows machine with no shell this
    // routine can find, which is precisely the case where D19 needs a human to look.
    throw new Error(
      'no POSIX shell found (checked PATH and Git Bash via `git --exec-path`); D19 ' +
        '(the SessionStart runtime banner) is UNVERIFIED in this run'
    );
  }
  return spawnSync(resolvedShell, ['-c', script], { encoding: 'utf8', windowsHide: true });
}

describe('missing-runtime shell fallback (D8, D19)', () => {
  test('fires when the interpreter does not resolve', () => {
    const r = sh(`aeo-runtime-that-does-not-exist hook.mjs || echo "${RUNTIME_MISSING_BANNER}"`);
    assert.equal(r.status, 0, 'the fallback must leave the hook exiting 0, not with a hook error');
    assert.match(r.stdout, /GATES NOT ENFORCING/);
    assert.equal(r.stdout.trim(), RUNTIME_MISSING_BANNER);
  });

  test('stays quiet when the interpreter does resolve', () => {
    const node = process.execPath.replace(/\\/g, '/');
    const r = sh(`"${node}" -e "process.stdout.write('report')" || echo "${RUNTIME_MISSING_BANNER}"`);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'report');
    assert.doesNotMatch(r.stdout, /GATES NOT ENFORCING/);
  });

  test('a gate that blocks still blocks through the fallback form', () => {
    // The fallback must not swallow exit 2. `||` fires on any non-zero status, so a
    // blocking gate would print the banner and exit 0 — turning every block into a
    // pass. This is the trap in the form, and it is why the fallback belongs only on
    // the SessionStart banner, which decides nothing, and never on a gate.
    const node = process.execPath.replace(/\\/g, '/');
    const r = sh(`"${node}" -e "process.exit(2)" || echo "${RUNTIME_MISSING_BANNER}"`);
    assert.equal(r.status, 0, 'demonstrates the trap: the block was converted to a pass');
    assert.match(r.stdout, /GATES NOT ENFORCING/);
  });
});
