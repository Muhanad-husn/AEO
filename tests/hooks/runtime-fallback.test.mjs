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
//     "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-status.mjs\" || echo '<banner>'"
//   }
//
// SessionStart stdout is injected into the session's context, so the banner arrives
// where it cannot be missed. These tests prove the form behaves as claimed: it fires
// when the interpreter does not resolve, and it stays quiet when it does.
//
// The absent-runtime arm substitutes a command name that certainly does not exist for
// `node`, rather than stripping PATH — a stripped PATH would also hide the shell
// itself, and the mechanism under test is "interpreter not found", which is identical
// either way.

import { spawnSync } from 'node:child_process';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { RUNTIME_MISSING_BANNER } from '../../plugin/hooks/lib.mjs';

function sh(script) {
  return spawnSync('sh', ['-c', script], { encoding: 'utf8', windowsHide: true });
}

const shellAvailable = (() => {
  const probe = sh('echo probe');
  return !probe.error && probe.status === 0 && (probe.stdout ?? '').trim() === 'probe';
})();

// A loud skip, not a quiet pass (L-08). If this suite ever skips on a machine that has
// a POSIX shell, that is a real signal and not noise to ignore.
const skip = shellAvailable ? false : 'no POSIX shell on PATH; cannot exercise the hooks.json fallback form';

describe('missing-runtime shell fallback (D8)', () => {
  test('fires when the interpreter does not resolve', { skip }, () => {
    const r = sh(`aeo-runtime-that-does-not-exist hook.mjs || echo '${RUNTIME_MISSING_BANNER}'`);
    assert.equal(r.status, 0, 'the fallback must leave the hook exiting 0, not with a hook error');
    assert.match(r.stdout, /GATES NOT ENFORCING/);
    assert.equal(r.stdout.trim(), RUNTIME_MISSING_BANNER);
  });

  test('stays quiet when the interpreter does resolve', { skip }, () => {
    const node = process.execPath.replace(/\\/g, '/');
    const r = sh(`"${node}" -e "process.stdout.write('report')" || echo '${RUNTIME_MISSING_BANNER}'`);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'report');
    assert.doesNotMatch(r.stdout, /GATES NOT ENFORCING/);
  });

  test('a gate that blocks still blocks through the fallback form', { skip }, () => {
    // The fallback must not swallow exit 2. `||` fires on any non-zero status, so a
    // blocking gate would print the banner and exit 0 — turning every block into a
    // pass. This is the trap in the form, and it is why the fallback belongs only on
    // the SessionStart reporter, which never blocks, and never on a gate.
    const node = process.execPath.replace(/\\/g, '/');
    const r = sh(`"${node}" -e "process.exit(2)" || echo '${RUNTIME_MISSING_BANNER}'`);
    assert.equal(r.status, 0, 'demonstrates the trap: the block was converted to a pass');
    assert.match(r.stdout, /GATES NOT ENFORCING/);
  });
});
