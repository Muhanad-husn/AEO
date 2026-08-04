#!/usr/bin/env node
// The fail-closed session fixture: point a test run away from live data, and refuse to
// start if it is not pointed away.
//
// WHY (L-03). Three incidents, months apart, none of them visible in CI, because CI has
// no data directory. A module-global logs root wrote 79 real run directories into the
// operator's live logs over five days. A lookup that fell through to a DEFAULT directory
// when its argument was omitted read a live 49,674-entry index from six test call-sites.
// A conftest fixture snapshotted and restored a shared state directory, which addresses
// collision but not reach. The charter line that came out of it: "it passed in a
// worktree" is not verification for anything data-facing.
//
// TWO REQUIREMENTS COME STRAIGHT FROM THE FIX SHAPE, and both are here.
//
// 1. REPOINT EVERY DEFAULT-DIRECTORY RESOLVER, not just the obvious data root. The
//    portable form of that is not a longer list of variables. It is ONE root with the
//    others derived from it: logs at <root>/logs, the index at <root>/index, state at
//    <root>/state. The incidents happened because several roots resolved independently,
//    so repointing one left the others live. A project has to route its resolvers
//    through AEO_DATA_ROOT for this fixture to reach them; nothing outside the project
//    can do that for it, and a module-global computed at import time is not reachable by
//    any fixture in any language.
//
// 2. AN ENVIRONMENT-VARIABLE SEAM, because in-process monkeypatching never reaches a
//    subprocess CLI child and integration tests shell out. That is why this file has a
//    wrapper mode as well as an import mode. The wrapper is also what makes it usable
//    from a stack that cannot import a .mjs at all.
//
// USE
//
//   Any stack, as a wrapper. The child and every one of its children see the seam:
//     node sandbox-session.mjs -- pytest tests/
//     node sandbox-session.mjs -- go test ./...
//
//   A Node test runner, as an import:
//     import { enterSandbox } from '.../sandbox-session.mjs';
//     const sandbox = enterSandbox();          // throws if it cannot point away
//     after(() => sandbox.leave());
//
//   A shell that wants the value only:
//     export AEO_DATA_ROOT="$(node sandbox-session.mjs --print)"
//
// WHAT IS AND IS NOT STACK-AGNOSTIC. The contract is: two variable names, the
// containment rule between them, and an assertion that runs before any test does. That
// part is portable to anything. The wrapper mode is portable to anything that can be
// spawned. The import mode is Node-only, and the equivalent for other runners is a
// conftest.py autouse fixture, a Vitest globalSetup, a Go TestMain: a few lines each,
// written in the project's own language against the same two variables. What no plugin
// can supply is the project-side change that makes its resolvers read the seam.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const LIVE_DATA_ROOT_ENV = 'AEO_LIVE_DATA_ROOT';
export const DATA_ROOT_ENV = 'AEO_DATA_ROOT';

/** Whole-segment containment, matching the guard's rule so the two cannot disagree. */
function inside(parent, child) {
  const norm = (p) => {
    let s = path.resolve(p).replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  const a = norm(parent);
  const b = norm(child);
  return a === b || b.startsWith(a.endsWith('/') ? a : `${a}/`);
}

/**
 * Create a sandbox data root, point the seam at it, and refuse if that is not safe.
 *
 * Every failure below throws before a single test runs, which is the whole point: the
 * mitigation that existed in production restored state AFTER the damage rather than
 * refusing before it.
 *
 * @param {{env?: object, prefix?: string}} options
 * @returns {{root: string, live: string|null, leave: () => void}}
 */
export function enterSandbox({ env = process.env, prefix = 'aeo-sandbox-' } = {}) {
  const declared = typeof env[LIVE_DATA_ROOT_ENV] === 'string' ? env[LIVE_DATA_ROOT_ENV].trim() : '';
  if (declared !== '' && !path.isAbsolute(declared)) {
    throw new Error(
      `${LIVE_DATA_ROOT_ENV} is ${JSON.stringify(declared)}, which is not an absolute path, so the sandbox ` +
        'cannot check that it is pointed away from production data.',
    );
  }
  const live = declared === '' ? null : declared;

  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  if (live !== null && (inside(live, root) || inside(root, live))) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(
      `the sandbox root ${root} and the production data root ${live} contain one another, so this run would ` +
        'reach live data. Point TMPDIR somewhere outside the production data root.',
    );
  }

  const previous = env[DATA_ROOT_ENV];
  env[DATA_ROOT_ENV] = root;

  if (live === null) {
    // A loud skip, never a quiet pass (L-08). Without a declaration the fixture still
    // redirects, but it cannot verify that the redirect points away from anything, and a
    // reader of the log should know which of those two things happened.
    process.stderr.write(
      `sandbox-session: ${DATA_ROOT_ENV}=${root}. No ${LIVE_DATA_ROOT_ENV} is declared, so this run is ` +
        'redirected but unverified. Declare the production data root to make the check real.\n',
    );
  }

  return {
    root,
    live,
    leave() {
      if (previous === undefined) delete env[DATA_ROOT_ENV];
      else env[DATA_ROOT_ENV] = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Spawn the wrapped command, falling back to a shell only where Windows needs one.
 *
 * Spawning through a shell unconditionally is the obvious form and it is wrong here: the
 * command comes from the caller, and Node joins arguments with spaces when `shell` is
 * set, so `C:\Program Files\nodejs\node.exe` arrives as two words. The shell is only
 * needed for a `.cmd` or `.bat` shim (npm, poetry, gradlew), which is exactly the case
 * that reports ENOENT first.
 */
function spawnChild(command, env) {
  const direct = spawnSync(command[0], command.slice(1), { stdio: 'inherit', env });
  if (direct.error?.code !== 'ENOENT' || process.platform !== 'win32') return direct;
  const quoted = command.map((t) => (/\s/.test(t) ? `"${t}"` : t));
  return spawnSync(quoted[0], quoted.slice(1), { stdio: 'inherit', env, shell: true });
}

function main(argv) {
  if (argv[0] === '--print') {
    const sandbox = enterSandbox();
    process.stdout.write(`${sandbox.root}\n`);
    return 0; // Deliberately not removed: the caller is about to use it.
  }

  const sep = argv.indexOf('--');
  const command = sep === -1 ? argv : argv.slice(sep + 1);
  if (command.length === 0) {
    process.stderr.write('usage: node sandbox-session.mjs -- <command> [args...]\n       node sandbox-session.mjs --print\n');
    return 1;
  }

  const sandbox = enterSandbox();
  try {
    const r = spawnChild(command, { ...process.env, [DATA_ROOT_ENV]: sandbox.root });
    if (r.error) {
      process.stderr.write(`sandbox-session: ${command[0]} could not be started (${r.error.message})\n`);
      return 1;
    }
    return r.status === null ? 1 : r.status;
  } finally {
    sandbox.leave();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
