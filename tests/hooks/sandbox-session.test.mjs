// Tests for plugin/scripts/sandbox-session.mjs, the fail-closed session fixture.
//
//   node --test                              # everything, from the repo root
//
// The centre of this file is one assertion: the seam survives a process boundary. L-03's
// second requirement exists because in-process monkeypatching never reaches a subprocess
// CLI child, and integration tests shell out. So the crossing is tested with a real
// spawned child and a real grandchild, never with a mock. A mock of the thing under test
// would assert only that this file believes its own design.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { enterSandbox } from '../../plugin/scripts/sandbox-session.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const SESSION = path.join(repoRoot, 'plugin', 'scripts', 'sandbox-session.mjs');
const GUARD = path.join(repoRoot, 'plugin', 'hooks', 'sandbox-guard.mjs');

const LIVE = 'AEO_LIVE_DATA_ROOT';
const DATA = 'AEO_DATA_ROOT';

const scratch = [];
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

function tempDir(prefix = 'aeo-p15s-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A production root that really exists, plus a place to put helper scripts. */
function production() {
  const base = tempDir();
  const live = path.join(base, 'production');
  mkdirSync(live, { recursive: true });
  return { base, live };
}

/** A script file, so a child's argv never has to survive Windows shell quoting. */
function script(body) {
  const file = path.join(tempDir(), 'child.mjs');
  writeFileSync(file, body);
  return file;
}

/** Run the wrapper. The environment is stated in full; nothing is inherited by accident. */
function wrap(argv, env = {}) {
  const childEnv = { ...process.env };
  delete childEnv[LIVE];
  delete childEnv[DATA];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync(process.execPath, [SESSION, ...argv], { encoding: 'utf8', env: childEnv, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function inside(parent, child) {
  const norm = (p) => {
    const s = path.resolve(p).replace(/\\/g, '/').replace(/(.)\/+$/, '$1');
    return process.platform === 'win32' ? s.toLowerCase() : s;
  };
  const a = norm(parent);
  const b = norm(child);
  return a === b || b.startsWith(`${a}/`);
}

// ---------------------------------------------------------------------------
// The crossing L-03 names
// ---------------------------------------------------------------------------

describe('the environment-variable seam across a process boundary', () => {
  test('a real child process sees the sandbox root, not production data', () => {
    const { live } = production();
    const child = script(`process.stdout.write(process.env.${DATA} ?? 'UNSET');\n`);

    const r = wrap(['--', process.execPath, child], { [LIVE]: live });
    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(r.stdout, 'UNSET', 'the child inherited no seam at all');
    assert.ok(path.isAbsolute(r.stdout), `the child saw ${JSON.stringify(r.stdout)}, which is not a path`);
    assert.ok(!inside(live, r.stdout), `the child was pointed inside production data: ${r.stdout}`);
  });

  // One boundary is what L-03 named. Two is what a project's integration tests actually
  // do: the test process shells out to a CLI, which shells out to a worker.
  test('a grandchild two process boundaries away sees the same sandbox root', () => {
    const { live } = production();
    const grandchild = script(`process.stdout.write(process.env.${DATA} ?? 'UNSET');\n`);
    const child = script(
      `import { spawnSync } from 'node:child_process';\n` +
        `const r = spawnSync(process.execPath, [${JSON.stringify(grandchild)}], { encoding: 'utf8' });\n` +
        `process.stdout.write(\`\${process.env.${DATA} ?? 'UNSET'}|\${r.stdout}\`);\n`,
    );

    const r = wrap(['--', process.execPath, child], { [LIVE]: live });
    assert.equal(r.status, 0, r.stderr);
    const [fromChild, fromGrandchild] = r.stdout.split('|');
    assert.notEqual(fromGrandchild, 'UNSET', 'the grandchild inherited no seam');
    assert.equal(fromChild, fromGrandchild, 'the seam changed between the child and the grandchild');
    assert.ok(!inside(live, fromGrandchild), `the grandchild was pointed inside production data: ${fromGrandchild}`);
  });

  test('a seam already set in the session does not survive into the child', () => {
    const { live } = production();
    const planted = path.join(live, 'scratch');
    const child = script(`process.stdout.write(process.env.${DATA} ?? 'UNSET');\n`);

    const r = wrap(['--', process.execPath, child], { [LIVE]: live, [DATA]: planted });
    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(r.stdout, planted, 'the wrapper passed a production-facing seam straight through');
    assert.ok(!inside(live, r.stdout), `the child was pointed inside production data: ${r.stdout}`);
  });

  test('the child exit code is the wrapper exit code', () => {
    const { live } = production();
    for (const code of [0, 1, 3, 42]) {
      const child = script(`process.exit(${code});\n`);
      assert.equal(wrap(['--', process.execPath, child], { [LIVE]: live }).status, code, `exit ${code}`);
    }
  });

  test('a command that cannot start is a failure, not a silent pass', () => {
    const { live } = production();
    const r = wrap(['--', path.join(tempDir(), 'no-such-program')], { [LIVE]: live });
    assert.notEqual(r.status, 0, 'a missing command reported success');
  });

  test('the sandbox directory is removed when the wrapper finishes', () => {
    const { live } = production();
    const child = script(`process.stdout.write(process.env.${DATA} ?? 'UNSET');\n`);
    const r = wrap(['--', process.execPath, child], { [LIVE]: live });
    assert.equal(existsSync(r.stdout), false, `the sandbox root ${r.stdout} outlived the run`);
  });

  test('--print emits a usable absolute path outside production data', () => {
    const { live } = production();
    const r = wrap(['--print'], { [LIVE]: live });
    assert.equal(r.status, 0, r.stderr);
    const root = r.stdout.trim();
    scratch.push(root);
    assert.ok(path.isAbsolute(root), root);
    assert.ok(!inside(live, root), root);
    assert.equal(existsSync(root), true, 'the printed root was not created');
  });

  test('no arguments is a usage error rather than an unguarded pass', () => {
    assert.notEqual(wrap([], {}).status, 0);
  });
});

// ---------------------------------------------------------------------------
// Fail closed, before anything runs
// ---------------------------------------------------------------------------

describe('the fixture refuses before a test runs', () => {
  test('a production root that is not absolute is refused', () => {
    assert.throws(() => enterSandbox({ env: { [LIVE]: 'production' } }), /not an absolute path/);
    assert.throws(() => enterSandbox({ env: { [LIVE]: './production' } }), /not an absolute path/);
  });

  test('a temp directory inside production data is refused, and nothing is left behind', () => {
    const { live } = production();
    const tmp = path.join(live, 'tmp');
    mkdirSync(tmp, { recursive: true });
    const env = { [LIVE]: live, TMPDIR: tmp, TMP: tmp, TEMP: tmp };
    // os.tmpdir() reads the process environment rather than the object handed in, so the
    // condition is reproduced by pointing the process at it for the length of the call.
    const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    Object.assign(process.env, { TMPDIR: tmp, TMP: tmp, TEMP: tmp });
    try {
      assert.throws(() => enterSandbox({ env }), /contain one another/);
      assert.deepEqual(
        readdirSync(tmp).filter((n) => n.startsWith('aeo-sandbox-')),
        [],
        'a refused sandbox left its directory behind',
      );
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('the wrapper refuses the same conditions rather than running the command', () => {
    const child = script('process.stdout.write("THE COMMAND RAN");\n');
    const r = wrap(['--', process.execPath, child], { [LIVE]: 'production' });
    assert.notEqual(r.status, 0, 'a relative production root did not stop the run');
    assert.doesNotMatch(r.stdout, /THE COMMAND RAN/, 'the command ran despite the refusal');
  });

  test('with no production root declared the fixture still redirects, and says it cannot verify', () => {
    const sandbox = enterSandbox({ env: {} });
    try {
      assert.ok(path.isAbsolute(sandbox.root));
      assert.equal(sandbox.live, null);
    } finally {
      sandbox.leave();
    }
  });

  test('leave restores the previous seam and removes the directory', () => {
    const { live } = production();
    const env = { [LIVE]: live, [DATA]: 'D:/previous' };
    const sandbox = enterSandbox({ env });
    assert.equal(env[DATA], sandbox.root);
    assert.equal(existsSync(sandbox.root), true);
    sandbox.leave();
    assert.equal(env[DATA], 'D:/previous');
    assert.equal(existsSync(sandbox.root), false);

    const bare = { [LIVE]: live };
    const second = enterSandbox({ env: bare });
    second.leave();
    assert.equal(DATA in bare, false, 'leave left a seam behind where there had been none');
  });
});

// ---------------------------------------------------------------------------
// The fixture and the guard agree
// ---------------------------------------------------------------------------

describe('the fixture satisfies the guard', () => {
  test('what the fixture produces is exactly what the guard requires', () => {
    const { live } = production();
    const env = { [LIVE]: live };
    const sandbox = enterSandbox({ env });
    try {
      const payload = { tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: repoRoot };
      const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '', [LIVE]: live, [DATA]: sandbox.root };
      const r = spawnSync(process.execPath, [GUARD], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: childEnv,
        windowsHide: true,
      });
      assert.equal(r.status, 0, `the guard rejected the fixture's own sandbox:\n${r.stderr}`);

      // And the same call without the fixture is refused, so the pass above is the
      // fixture's doing rather than the guard being asleep.
      const without = { ...childEnv };
      delete without[DATA];
      const r2 = spawnSync(process.execPath, [GUARD], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
        env: without,
        windowsHide: true,
      });
      assert.equal(r2.status, 2, 'the guard allowed a run with no seam at all');
    } finally {
      sandbox.leave();
    }
  });
});
