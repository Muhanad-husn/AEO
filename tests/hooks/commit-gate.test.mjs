// Tests for plugin/hooks/commit-gate.mjs.
//
//   node --test                              # everything, from the repo root
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// The gate is spawned as a real process against real git repositories in temp
// directories, the pattern P1.1 established. Nothing about git is mocked, because the
// bugs this gate has historically had (worktree resolution, branch identity, the file
// set a commit will record) all live in what git actually reports.
//
// Test suites are stood up as shim executables on PATH so a red suite, a green suite
// and a suite that overruns are all deterministic and fast. Two cases use the real
// `npm` instead, because "a Node repo detects and runs its own test command" is a
// named verify item in PLAN's Phase 1 and a shimmed npm would not prove it.

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { HOOK_TIMEOUT_SECONDS, SUITE_BUDGET_MS } from '../../plugin/hooks/commit-gate.mjs';

const GATE = path.join(import.meta.dirname, '..', '..', 'plugin', 'hooks', 'commit-gate.mjs');
const HOOKS_DIR = path.join(import.meta.dirname, '..', '..', 'plugin', 'hooks');
const onWindows = process.platform === 'win32';

const scratch = [];
after(() => {
  for (const dir of scratch) {
    // git leaves read-only object files, and Windows refuses to unlink those while a
    // just-exited git process still holds a handle. Retry, then give up: failing to
    // tidy the OS temp directory is not a test result.
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

function tempDir(prefix = 'aeo-p13-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function run(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

function writeInto(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

/**
 * A real repository with a real history.
 *
 * `base` is committed on the default branch. `origin/HEAD` is set to that branch so
 * defaultBranch() resolves through its primary path (D14) rather than through a global
 * `init.defaultBranch` this machine happens to carry. `change` is then written and
 * staged on `branch`.
 */
function makeRepo({ base = {}, defaultBranch = 'main', branch = 'feat/slice', change = {}, modify = {} } = {}) {
  const dir = tempDir();
  run(dir, 'init', '-q', '-b', defaultBranch);
  run(dir, 'config', 'user.name', 'aeo-test');
  run(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  run(dir, 'config', 'commit.gpgsign', 'false');
  writeInto(dir, { '.gitkeep': '', ...base });
  run(dir, 'add', '-A');
  run(dir, 'commit', '-q', '-m', 'init');
  run(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git');
  run(dir, 'symbolic-ref', `refs/remotes/origin/HEAD`, `refs/remotes/origin/${defaultBranch}`);
  if (branch !== defaultBranch) run(dir, 'switch', '-q', '-c', branch);
  if (Object.keys(change).length > 0) {
    writeInto(dir, change);
    run(dir, 'add', '-A');
  }
  // Written after staging, so these show up only in the unstaged diff.
  if (Object.keys(modify).length > 0) writeInto(dir, modify);
  return dir;
}

/** A fake executable on PATH, so a suite's outcome is a decision rather than a hope. */
function shimDir(shims) {
  const bin = tempDir('aeo-p13-bin-');
  for (const [name, { exit = 0, sleepSeconds = 0 }] of Object.entries(shims)) {
    if (onWindows) {
      const lines = ['@echo off'];
      if (sleepSeconds) lines.push(`ping -n ${sleepSeconds + 1} 127.0.0.1 >nul`);
      lines.push(`echo ${name} shim ran with args: %*`, `exit /b ${exit}`);
      writeFileSync(path.join(bin, `${name}.cmd`), `${lines.join('\r\n')}\r\n`);
    } else {
      const file = path.join(bin, name);
      const lines = ['#!/bin/sh'];
      if (sleepSeconds) lines.push(`sleep ${sleepSeconds}`);
      lines.push(`echo "${name} shim ran with args: $@"`, `exit ${exit}`);
      writeFileSync(file, `${lines.join('\n')}\n`);
      chmodSync(file, 0o755);
    }
  }
  return bin;
}

function commitPayload(dir, command = 'git commit -m "wip"') {
  return { cwd: dir, tool_name: 'Bash', tool_input: { command } };
}

function runGate(payload, { bin = null, env = {} } = {}) {
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '', ...env };
  if (bin) childEnv.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  const r = spawnSync(process.execPath, [GATE], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: childEnv,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const npmPackage = (script) => JSON.stringify({ name: 'x', private: true, scripts: { test: script } });

// ---------------------------------------------------------------------------
// The gate acts only on a commit
// ---------------------------------------------------------------------------

describe('what the gate acts on', () => {
  test('a command that is not a git commit is allowed', () => {
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main' });
    assert.equal(runGate(commitPayload(dir, 'npm run build')).status, 0);
  });

  test('git commit-tree is not git commit', () => {
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main' });
    assert.equal(runGate(commitPayload(dir, 'git commit-tree abc123')).status, 0);
  });

  test('git -C <dir> commit is a commit', () => {
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const result = runGate(commitPayload(dir, `git -C ${dir} commit -m x`));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no direct commits on main/);
  });
});

// ---------------------------------------------------------------------------
// The protected branch (D14)
// ---------------------------------------------------------------------------

describe('the protected branch is resolved, never assumed', () => {
  test('a commit on main blocks', () => {
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /BLOCKED: no direct commits on main/);
  });

  test('a repo on master blocks on master', () => {
    const dir = makeRepo({ branch: 'master', defaultBranch: 'master' });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /BLOCKED: no direct commits on master/);
    assert.doesNotMatch(result.stderr, /commits on main\b/);
  });

  test('a repo on trunk blocks on trunk', () => {
    const dir = makeRepo({ branch: 'trunk', defaultBranch: 'trunk' });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /BLOCKED: no direct commits on trunk/);
  });

  test('a feature branch in a repo whose default is master is not blocked as a branch', () => {
    const dir = makeRepo({
      defaultBranch: 'master',
      branch: 'feat/x',
      base: { 'README.md': '# x' },
      change: { 'NOTES.md': 'notes' },
    });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 0);
  });

  test('the docs-only hatch on the protected branch is gone', () => {
    // The vendored gate let a documentation commit land on main with no branch. That
    // was one repo's founder policy and it does not ship in a general plugin.
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main', change: { 'README.md': '# x' } });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no direct commits on main/);
  });

  test('a commit outside any git repository blocks rather than passing', () => {
    const dir = tempDir();
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /did not resolve to a git repository/);
  });
});

// ---------------------------------------------------------------------------
// Detection, and running the project's own command (V-05, D10)
// ---------------------------------------------------------------------------

describe('a Node repo detects and runs its own test command', () => {
  test('a green npm test allows the commit', () => {
    const dir = makeRepo({
      base: { 'package.json': npmPackage('node -e "process.exit(0)"') },
      change: { 'index.js': 'export const a = 1;\n' },
    });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 0, result.stderr);
  });

  test('a red npm test blocks the commit', () => {
    const dir = makeRepo({
      base: { 'package.json': npmPackage('node -e "process.exit(1)"') },
      change: { 'index.js': 'export const a = 1;\n' },
    });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
    assert.match(result.stderr, /npm test/);
  });
});

describe('a Python repo detects and runs its own test command', () => {
  test('a green pytest allows the commit', () => {
    const dir = makeRepo({
      base: { 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' },
      change: { 'app.py': 'x = 1\n' },
    });
    const result = runGate(commitPayload(dir), { bin: shimDir({ pytest: { exit: 0 } }) });
    assert.equal(result.status, 0, result.stderr);
  });

  test('a red pytest blocks the commit', () => {
    const dir = makeRepo({
      base: { 'pyproject.toml': '[tool.pytest.ini_options]\n' },
      change: { 'app.py': 'x = 1\n' },
    });
    const result = runGate(commitPayload(dir), { bin: shimDir({ pytest: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
    assert.match(result.stderr, /pytest/);
    assert.match(result.stderr, /shim ran/); // the tail of the real output is reported
  });

  test('uv is used when the project declares it, and the suite is still run', () => {
    const dir = makeRepo({
      base: { 'pyproject.toml': '[tool.pytest.ini_options]\n', 'uv.lock': 'version = 1\n' },
      change: { 'app.py': 'x = 1\n' },
    });
    const result = runGate(commitPayload(dir), { bin: shimDir({ uv: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /uv run pytest/);
  });
});

describe('detection that cannot resolve blocks and says what it looked for', () => {
  test('a repo with no manifest at all', () => {
    const dir = makeRepo({ change: { 'src/a.js': 'const a = 1;\n' } });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no test command could be resolved/);
    assert.match(result.stderr, /looked for:.*package\.json/);
    assert.match(result.stderr, /pyproject\.toml/);
    assert.match(result.stderr, /go\.mod/);
    assert.match(result.stderr, /searched:/);
    assert.doesNotMatch(result.stderr, /test suite is red/);
  });

  test('a manifest that declares no test command names the manifest and the field', () => {
    const dir = makeRepo({
      base: { 'package.json': JSON.stringify({ name: 'x' }) },
      change: { 'index.js': 'const a = 1;\n' },
    });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /scripts\.test/);
  });

  test('an unresolvable second project blocks even when the first resolves', () => {
    const dir = makeRepo({
      base: {
        'services/api/package.json': npmPackage('node -e "process.exit(0)"'),
        'libs/calc/package.json': JSON.stringify({ name: 'calc' }),
      },
      change: { 'services/api/a.js': '1\n', 'libs/calc/b.js': '2\n' },
    });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no test command could be resolved/);
  });
});

describe('resolution is per change, not per repo', () => {
  const polyglot = () =>
    makeRepo({
      base: {
        'services/api/package.json': npmPackage('node -e "process.exit(0)"'),
        'libs/calc/pyproject.toml': '[tool.pytest.ini_options]\n',
      },
      change: {},
    });

  test('a change in the Node package does not run the Python package', () => {
    const dir = polyglot();
    writeInto(dir, { 'services/api/a.js': '1\n' });
    run(dir, 'add', '-A');
    // pytest is deliberately absent from PATH: if the gate ran it, this would block.
    const result = runGate(commitPayload(dir), { bin: shimDir({ npm: { exit: 0 } }) });
    assert.equal(result.status, 0, result.stderr);
  });

  test('a change spanning both packages runs both, and a red one blocks', () => {
    const dir = polyglot();
    writeInto(dir, { 'services/api/a.js': '1\n', 'libs/calc/b.py': 'x = 1\n' });
    run(dir, 'add', '-A');
    const result = runGate(commitPayload(dir), { bin: shimDir({ npm: { exit: 0 }, pytest: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /pytest/);
  });
});

// ---------------------------------------------------------------------------
// V-01: the escape hatch is deleted and stays deleted
// ---------------------------------------------------------------------------

describe('the red-commit escape hatch (V-01)', () => {
  test('.claude/allow-red-commit does not bypass a red suite', () => {
    const dir = makeRepo({
      base: { 'pyproject.toml': '[tool.pytest.ini_options]\n' },
      change: { 'app.py': 'x = 1\n' },
    });
    writeInto(dir, { '.claude/allow-red-commit': '' });
    const result = runGate(commitPayload(dir), { bin: shimDir({ pytest: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
  });

  test('.claude/allow-red-commit does not bypass the protected branch either', () => {
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main' });
    writeInto(dir, { '.claude/allow-red-commit': '' });
    assert.equal(runGate(commitPayload(dir)).status, 2);
  });

  test('no hook file mentions the flag, so it cannot be reintroduced by copy', () => {
    for (const name of readdirSync(HOOKS_DIR).filter((f) => f.endsWith('.mjs'))) {
      const text = readFileSync(path.join(HOOKS_DIR, name), 'utf8');
      const live = text
        .split(/\r?\n/)
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');
      assert.doesNotMatch(live, /allow-red-commit/, `${name} references the deleted hatch outside a comment`);
    }
  });
});

// ---------------------------------------------------------------------------
// The documentation fast path, and every way it fails safe
// ---------------------------------------------------------------------------

describe('the documentation fast path', () => {
  test('a documentation-only commit skips detection entirely', () => {
    // No manifest anywhere. Without the fast path this would block on detection, so
    // this also pins that the skip happens before detection rather than after.
    const dir = makeRepo({ change: { 'README.md': '# x', 'notes/design.txt': 'x' } });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /documentation only \(2 file\(s\)\)/);
  });

  test('one non-documentation file takes the strict path', () => {
    const dir = makeRepo({ change: { 'README.md': '# x', 'src/a.js': '1\n' } });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no test command could be resolved/);
  });

  test('markdown under .claude is configuration, not documentation', () => {
    // The incident this encodes: agent and skill definitions are all .md, so the
    // extension test alone classified the harness's own rules as documentation.
    const dir = makeRepo({ change: { '.claude/agents/builder.md': '# builder' } });
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no test command could be resolved/);
  });

  test('markdown under any dot-directory is configuration', () => {
    const dir = makeRepo({ change: { '.github/CONTRIBUTING.md': '# c' } });
    assert.equal(runGate(commitPayload(dir)).status, 2);
  });

  test('an empty file set is not documentation-only', () => {
    // `git commit --amend` and `--allow-empty` present no staged files. The fast path
    // must not treat "nothing to classify" as "nothing to test".
    const dir = makeRepo({ base: { 'package.json': npmPackage('node -e "process.exit(1)"') } });
    const result = runGate(commitPayload(dir, 'git commit --amend --no-edit'), {
      bin: shimDir({ npm: { exit: 1 } }),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
  });

  test('git commit -a folds unstaged tracked edits into the file set', () => {
    const dir = makeRepo({
      base: { 'README.md': '# x', 'src/a.js': 'const a = 1;\n' },
      change: { 'CHANGELOG.md': 'log' },
      modify: { 'src/a.js': 'const a = 2;\n' },
    });
    // Staged is documentation only; the unstaged code edit is what -a will sweep in.
    const withoutAll = runGate(commitPayload(dir, 'git commit -m x'));
    assert.equal(withoutAll.status, 0, withoutAll.stderr);
    const withAll = runGate(commitPayload(dir, 'git commit -am x'));
    assert.equal(withAll.status, 2);
    assert.match(withAll.stderr, /no test command could be resolved/);
  });

  test('--all folds unstaged tracked edits too', () => {
    const dir = makeRepo({
      base: { 'README.md': '# x', 'src/a.js': 'const a = 1;\n' },
      change: { 'CHANGELOG.md': 'log' },
      modify: { 'src/a.js': 'const a = 2;\n' },
    });
    assert.equal(runGate(commitPayload(dir, 'git commit --all -m x')).status, 2);
  });
});

// ---------------------------------------------------------------------------
// Worktree resolution is the library's, and the gate uses it
// ---------------------------------------------------------------------------

test('a leading cd wins over the payload cwd', () => {
  const elsewhere = makeRepo({ branch: 'feat/other', base: { 'README.md': '# other' } });
  const target = makeRepo({ branch: 'main', defaultBranch: 'main' });
  const command = `cd ${target.replace(/\\/g, '/')} && git commit -m x`;
  const result = runGate({ cwd: elsewhere, tool_name: 'Bash', tool_input: { command } });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no direct commits on main/);
});

// ---------------------------------------------------------------------------
// The timeout, which is the whole reason the hook needs an explicit one
// ---------------------------------------------------------------------------

describe('a suite that overruns fails closed', () => {
  test('an overrunning suite blocks instead of being killed into a silent pass', () => {
    const dir = makeRepo({
      base: { 'pyproject.toml': '[tool.pytest.ini_options]\n' },
      change: { 'app.py': 'x = 1\n' },
    });
    const result = runGate(commitPayload(dir), {
      bin: shimDir({ pytest: { exit: 0, sleepSeconds: 5 } }),
      env: { AEO_TEST_SUITE_BUDGET_MS: '600' },
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /did not finish within/);
  });

  test('the declared hook timeout is the documented default, and the suite budget sits inside it', () => {
    assert.equal(HOOK_TIMEOUT_SECONDS, 600);
    assert.ok(SUITE_BUDGET_MS < HOOK_TIMEOUT_SECONDS * 1000, 'the gate must report before Claude Code kills it');
    assert.equal(SUITE_BUDGET_MS, 570_000);
  });
});

test('the budget seam can only shorten the budget, never extend it past the ceiling', () => {
  const probe = spawnSync(
    process.execPath,
    ['-e', 'import("./plugin/hooks/commit-gate.mjs").then((m) => console.log(m.SUITE_BUDGET_MS))'],
    {
      cwd: path.join(import.meta.dirname, '..', '..'),
      encoding: 'utf8',
      env: { ...process.env, AEO_TEST_SUITE_BUDGET_MS: '99999999' },
      windowsHide: true,
    },
  );
  assert.equal(Number(probe.stdout.trim()), 570_000);
});
