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

  // Asserted, not assumed. A system or global gitconfig setting init.defaultBranch is
  // common, and this machine's sets `master`. A fixture that inherited it would make
  // the main, master and trunk cases the same case while all three stayed green, which
  // is the L-08 shape: the assertion was never the weak part, the input set was.
  assert.equal(run(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), branch, 'fixture is not on the branch it claims');
  assert.equal(
    run(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'),
    `origin/${defaultBranch}`,
    'fixture default branch is not the one it claims',
  );
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

/**
 * Where every gate child runs. L-03, and this gate is the one it costs the most.
 *
 * CLAUDE_PROJECT_DIR is already blanked below, which leaves the hook process's own cwd
 * as resolveOperationDir's last resort. A child inheriting the runner's cwd resolves a
 * payload that names no directory to THIS repository, and this gate does not merely
 * read: it detects the project's test command and runs it. That is the suite running
 * itself inside its own checkout, with whatever that suite writes landing in the
 * founder's tree. Pinned to a directory the test created and owns.
 */
const NEUTRAL_CWD = tempDir('aeo-p13-nowhere-');

function runGate(payload, { bin = null, env = {} } = {}) {
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '', ...env };
  if (bin) childEnv.PATH = `${bin}${path.delimiter}${process.env.PATH ?? ''}`;
  const r = spawnSync(process.execPath, [GATE], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: NEUTRAL_CWD,
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

  // C-07. This gate never read tool_name — it decides from tool_input.command alone — so
  // the only thing standing between it and a PowerShell commit was hooks.json's matcher,
  // which said `^Bash$`. The matcher is asserted in hooks-json.test.mjs; this proves the
  // gate itself does the right thing once the call reaches it.
  test('a commit on main blocks when the call arrives as PowerShell', () => {
    const dir = makeRepo({ branch: 'main', defaultBranch: 'main' });
    const result = runGate({ ...commitPayload(dir), tool_name: 'PowerShell' });
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

  test('the three branch fixtures are genuinely three different fixtures', () => {
    // Guards the cross-slice finding P1.2 reported: an ambient init.defaultBranch
    // would otherwise collapse main, master and trunk into one condition asserted
    // three times.
    const seen = ['main', 'master', 'trunk'].map((name) => {
      const dir = makeRepo({ branch: name, defaultBranch: name });
      return run(dir, 'rev-parse', '--abbrev-ref', 'HEAD');
    });
    assert.deepEqual(seen, ['main', 'master', 'trunk']);
  });

  test('with no origin, the protected branch still resolves from config', () => {
    // defaultBranch falls back to init.defaultBranch when origin/HEAD is absent. Pinned
    // in the repo's own config so the result does not depend on this machine's.
    const dir = tempDir();
    run(dir, 'init', '-q', '-b', 'trunk');
    run(dir, 'config', 'user.name', 'aeo-test');
    run(dir, 'config', 'user.email', 'aeo-test@example.invalid');
    run(dir, 'config', 'init.defaultBranch', 'trunk');
    run(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no direct commits on trunk/);
  });

  test('a commit outside any git repository blocks rather than passing', () => {
    const dir = tempDir();
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /did not resolve to a git repository/);
  });

  test('a commit payload naming no directory reaches no repository at all', () => {
    // THE DATA-LOSS DEFECT, in the suite. A payload with no `cwd` falls through
    // resolveOperationDir to CLAUDE_PROJECT_DIR and then to the gate process's own
    // working directory. Both are session-fixed, and a gate child that pins neither
    // inherits the test runner's cwd -- which is THIS repository. The gate then
    // resolved a real toplevel, detected this project's own `npm test`, and ran the
    // suite inside the founder's checkout while it was being edited.
    //
    // This is not a restatement of the pinning. It asserts the only outcome that is
    // correct here on its own terms: a commit that names no directory is a commit the
    // gate cannot place, so it must block and say so rather than pick a repository for
    // itself. Unpin the cwd and this goes red on the exit code, because the gate finds
    // a repository, finds a branch that is not the protected one, and runs the suite.
    const result = runGate({ tool_name: 'Bash', tool_input: { command: 'git commit -m "wip"' } });
    assert.equal(result.status, 2, `the gate resolved a repository from nothing:\n${result.stderr}`);
    assert.match(result.stderr, /did not resolve to a git repository/);
    assert.doesNotMatch(result.stderr, /test suite is red|no direct commits on/);
  });

  test('a code commit on main in a repo with NO origin is blocked', () => {
    // THE INTEGRATION DEFECT, in the suite. This machine's SYSTEM gitconfig sets
    // init.defaultBranch=master. defaultBranch used to read that key in every scope,
    // so this repo, whose real branch is main, resolved to master; main !== master, no
    // block fired, and a commit of source code landed directly on the default branch.
    // Nothing here sets any git config: the fixture is the bare failing case.
    const dir = tempDir();
    run(dir, 'init', '-q', '-b', 'main');
    run(dir, 'config', 'user.name', 'aeo-test');
    run(dir, 'config', 'user.email', 'aeo-test@example.invalid');
    run(dir, 'config', 'commit.gpgsign', 'false');
    writeInto(dir, { 'package.json': npmPackage('node -e ""'), 'src/a.js': 'const a = 1;\n' });
    run(dir, 'add', '-A');
    run(dir, 'commit', '-q', '-m', 'init');
    writeInto(dir, { 'src/a.js': 'const a = 2;\n' });
    run(dir, 'add', '-A');

    assert.equal(run(dir, 'remote'), '', 'fixture must have no remote at all');
    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /BLOCKED: no direct commits on main/);
  });

  test('an unresolvable default branch blocks and names the remedy, never passes quietly', () => {
    // No origin, no local init.defaultBranch, and both main and master present, so the
    // repository genuinely does not say which branch it protects. D10's escape-hatch
    // rule: the gate stops and says what it needs rather than guessing (L-08).
    const dir = tempDir();
    run(dir, 'init', '-q', '-b', 'main');
    run(dir, 'config', 'user.name', 'aeo-test');
    run(dir, 'config', 'user.email', 'aeo-test@example.invalid');
    run(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
    run(dir, 'branch', 'master');

    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /does not say what its default branch is/);
    assert.match(result.stderr, /git config init\.defaultBranch/);
  });

  test('the first commit in a repo with no commits yet is not blocked as a branch', () => {
    // An unborn HEAD has no branch to compare and no branches for the default to be
    // read from. Demanding one here would make `git init` followed by a first commit
    // impossible, which is over-blocking, not fail-closed. Documentation only, so this
    // asserts the branch arm alone and not detection.
    const dir = tempDir();
    run(dir, 'init', '-q', '-b', 'main');
    run(dir, 'config', 'user.name', 'aeo-test');
    run(dir, 'config', 'user.email', 'aeo-test@example.invalid');
    writeInto(dir, { 'README.md': '# new project' });
    run(dir, 'add', '-A');

    const result = runGate(commitPayload(dir));
    assert.equal(result.status, 0, result.stderr);
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
    const dir = makeRepo({ change: { 'README.md': '# x', 'notes/design.rst': 'x' } });
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
// What the documentation fast path must never classify as prose
// ---------------------------------------------------------------------------

describe('executable configuration that happens to be documentation', () => {
  // Every case below commits into a repo whose declared suite always fails, so anything
  // that reaches the suite blocks and anything classified as prose exits 0. That is the
  // probe the review ran, and it is the only way these two outcomes are told apart.
  const red = () => shimDir({ npm: { exit: 1 } });
  const redRepo = (change) => makeRepo({ base: { 'package.json': npmPackage('always red') }, change });

  test('an agent definition is configuration, not documentation', () => {
    // The dogfooding case: a commit rewriting the builder's charter ran nothing, because
    // a plugin keeps its roles under no dot-directory.
    const dir = redRepo({ 'plugin/agents/builder.md': '---\nname: builder\n---\n\n# Builder\n' });
    const result = runGate(commitPayload(dir), { bin: red() });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /test suite is red/);
  });

  test('a SKILL.md is configuration, not documentation', () => {
    const dir = redRepo({ 'plugin/skills/triage/SKILL.md': '---\nname: triage\ndescription: x\n---\n\n# Triage\n' });
    const result = runGate(commitPayload(dir), { bin: red() });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /test suite is red/);
  });

  test('requirements.txt is configuration, not documentation', () => {
    // A dependency bump is the change most likely to turn a suite red without touching
    // a line of source, and `.txt` used to be a documentation extension.
    const dir = redRepo({ 'requirements.txt': 'requests==2.32.0\n' });
    const result = runGate(commitPayload(dir), { bin: red() });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /test suite is red/);
  });

  test('a README is still prose, and still does not pay for a suite run', () => {
    // The point of the path, in the same always-red repo. Without this the classifier
    // could be closed by deleting it.
    const dir = redRepo({ 'README.md': '# x\n\nprose.\n' });
    const result = runGate(commitPayload(dir), { bin: red() });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /documentation only/);
  });

  test('reStructuredText is still prose', () => {
    const dir = redRepo({ 'docs/guide.rst': 'Guide\n=====\n' });
    assert.equal(runGate(commitPayload(dir), { bin: red() }).status, 0);
  });

  test('a repo with no manifest can still commit its README rather than hitting detection', () => {
    // The second thing the fast path buys, and the reason it is not simply deleted.
    const dir = makeRepo({ change: { 'README.md': '# new project\n' } });
    assert.equal(runGate(commitPayload(dir)).status, 0);
  });
});

// ---------------------------------------------------------------------------
// Two suites in one commit, and the budget they share
// ---------------------------------------------------------------------------

describe('the budget is the whole commit\'s, never one per suite', () => {
  // THE MARGIN IS THE POINT, NOT THE NUMBERS. The budget has to sit above one shim suite
  // and below two, and what fills the gap is process-spawn overhead the test does not
  // control: node starting, the package manager resolving, the shim launching.
  //
  // At 2s sleeps against a 3.4s budget that gap was 1.4s, and on Windows spawn overhead
  // crosses 1.4s often enough to fail this control roughly one run in three — idle, with
  // nothing else on the machine. CI never saw it because a Linux runner spawns processes
  // about ten times faster, which is exactly the shape of bug a green CI hides.
  //
  // 5s sleeps against an 8s budget give the pass case 3s of overhead before it breaks,
  // and the block case is arithmetic rather than timing: two suites sleep 10s, which
  // exceeds 8s whatever the overhead does, because a sleep is a floor.
  const slow = () => shimDir({ npm: { exit: 0, sleepSeconds: 5 }, pytest: { exit: 0, sleepSeconds: 5 } });
  const budget = { AEO_TEST_SUITE_BUDGET_MS: '8000' };

  test('two suites cannot each spend the full budget', () => {
    const dir = makeRepo({
      base: {
        'services/api/package.json': npmPackage('slow'),
        'libs/calc/pyproject.toml': '[tool.pytest.ini_options]\n',
      },
      change: { 'services/api/a.js': '1\n', 'libs/calc/b.py': 'x = 1\n' },
    });
    const result = runGate(commitPayload(dir), { bin: slow(), env: budget });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /did not finish within/);
  });

  test('one suite of the same length inside the same budget still passes', () => {
    // The control. Without it the case above is also green for a budget that is simply
    // too short for one suite, which is what it looks like with the deadline reverted.
    const dir = makeRepo({
      base: { 'services/api/package.json': npmPackage('slow') },
      change: { 'services/api/a.js': '1\n' },
    });
    const result = runGate(commitPayload(dir), { bin: slow(), env: budget });
    assert.equal(result.status, 0, result.stderr);
  });
});

// ---------------------------------------------------------------------------
// Two declared suites at one root
// ---------------------------------------------------------------------------

test('a root declaring two suites runs both, and a red second one blocks', () => {
  // Django plus React. Node is examined first, so before the fix jest ran, reported
  // green, and pytest never ran at all.
  const dir = makeRepo({
    base: { 'package.json': npmPackage('jest'), 'pyproject.toml': '[tool.pytest.ini_options]\n' },
    change: { 'app/views.py': 'x = 1\n' },
  });
  const result = runGate(commitPayload(dir), { bin: shimDir({ npm: { exit: 0 }, pytest: { exit: 1 } }) });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /pytest/);
  assert.match(result.stderr, /test suite is red/);
});

// ---------------------------------------------------------------------------
// L-02: the reviewer runs nothing, because hooks in a group run concurrently
// ---------------------------------------------------------------------------

describe('the reviewer exemption', () => {
  const asRole = (dir, role) => ({ ...commitPayload(dir), agent_type: role });
  const repo = () => makeRepo({ base: { 'package.json': npmPackage('always red') }, change: { 'index.js': '1\n' } });

  test('a jailed reviewer\'s commit starts no suite', () => {
    // review-jail seals the commit in the same concurrent group. The seal holds either
    // way; what must not happen is this gate running tests beside it.
    const result = runGate(asRole(repo(), 'aeo:reviewer'), { bin: shimDir({ npm: { exit: 1 } }) });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /reviewer role does not commit/);
  });

  test('every other role still pays for its suite', () => {
    const result = runGate(asRole(repo(), 'aeo:builder'), { bin: shimDir({ npm: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
  });

  test('a bare reviewer from --agent is not this plugin\'s reviewer (C-02)', () => {
    const result = runGate(asRole(repo(), 'reviewer'), { bin: shimDir({ npm: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
  });

  test('no agent_type at all is not the reviewer', () => {
    const result = runGate(commitPayload(repo()), { bin: shimDir({ npm: { exit: 1 } }) });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /test suite is red/);
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
