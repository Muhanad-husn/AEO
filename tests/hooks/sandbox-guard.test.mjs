// Tests for plugin/hooks/sandbox-guard.mjs, plugin/hooks/sentinel.mjs and the
// run-in-progress check added to plugin/hooks/commit-gate.mjs.
//
//   node --test                              # everything, from the repo root
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// Every case spawns the real gate and asserts an exit code, because the exit code is the
// behaviour. 2 blocks; anything else lets the tool call through (C-06).
//
// This gate's product is a guarantee about data that cannot be un-deleted, so a suite
// that passes for the wrong reason is worth more here than a bug. Every block therefore
// asserts WHICH rule fired, not just that something did. P1.6 shipped a first battery
// that stayed green under an inverted gate because its payloads blocked one branch later
// for an unrelated reason; the fix is the same one applied throughout below.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pathCandidates, shellTokens, invokesDeclaredSuite, resolveRoots } from '../../plugin/hooks/sandbox-guard.mjs';
import { projectAnchor, sentinelPath } from '../../plugin/hooks/sentinel.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GUARD = path.join(repoRoot, 'plugin', 'hooks', 'sandbox-guard.mjs');
const COMMIT_GATE = path.join(repoRoot, 'plugin', 'hooks', 'commit-gate.mjs');
const SENTINEL_CLI = path.join(repoRoot, 'plugin', 'scripts', 'run-sentinel.mjs');

const LIVE = 'AEO_LIVE_DATA_ROOT';
const DATA = 'AEO_DATA_ROOT';

// ---------------------------------------------------------------------------
// scratch space and the runners
// ---------------------------------------------------------------------------

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

function tempDir(prefix = 'aeo-p15-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A real repository on a feature branch, with a declared Node test command by default. */
function makeRepo({ base = { 'package.json': JSON.stringify({ name: 'x', private: true, scripts: { test: 'echo ok' } }) }, branch = 'feat/slice', change = {} } = {}) {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'aeo-test');
  git(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  for (const [rel, body] of Object.entries({ '.gitkeep': '', ...base })) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', 'https://example.invalid/x.git');
  git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  if (branch !== 'main') git(dir, 'switch', '-q', '-c', branch);
  for (const [rel, body] of Object.entries(change)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  if (Object.keys(change).length > 0) git(dir, 'add', '-A');
  return dir;
}

/** Raise a sentinel by writing the file directly, which is what the CLI does. */
function raise(repo, id = 'ingest', record = {}) {
  const file = sentinelPath(repo, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    typeof record === 'string'
      ? record
      : JSON.stringify({ id, what: 'a long job', started: '2026-08-04T09:00:00Z', pid: null, host: os.hostname(), ...record }),
  );
  return file;
}

/**
 * Run a gate as a hook.
 *
 * Both seam variables are stripped from the inherited environment first, so a machine
 * that happens to carry them cannot silently change a result. Every case that needs one
 * states it.
 */
function runHook(script, { payload, raw, env = {} } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const childEnv = { ...process.env, CLAUDE_PROJECT_DIR: '' };
  delete childEnv[LIVE];
  delete childEnv[DATA];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: childEnv, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const guard = (options) => runHook(GUARD, options);
const commitGate = (options) => runHook(COMMIT_GATE, options);

const bash = (command, cwd, extra = {}) => ({
  session_id: 'test-session',
  hook_event_name: 'PreToolUse',
  cwd,
  tool_name: 'Bash',
  tool_input: { command },
  ...extra,
});

function assertBlockedBecause(result, pattern, message) {
  assert.equal(result.status, 2, `${message}: expected exit 2, got ${result.status}\n${result.stderr}`);
  assert.match(result.stderr, /^BLOCKED: /m, `${message}: no BLOCKED line on stderr`);
  assert.match(result.stderr, pattern, `${message}: blocked, but not by the rule under test\n${result.stderr}`);
}

function assertAllowed(result, message) {
  assert.equal(result.status, 0, `${message}: expected exit 0, got ${result.status}\n${result.stderr}`);
  assert.doesNotMatch(result.stderr, /^BLOCKED: /m, `${message}: blocked when it should have allowed`);
}

// The rule each block message names. Asserting on these is what stops a mutation from
// leaving the battery green because something else happened to block.
const NO_SEAM = /sets no AEO_DATA_ROOT/;
const SEAM_OVERLAPS = /One contains the other, so this run is pointed at production data/;
const SEAM_RELATIVE = /is not an absolute\s+path\./;
const LIVE_RELATIVE = /AEO_LIVE_DATA_ROOT is set to .*which is not an absolute path/;
const NAMES_LIVE_DATA = /which resolves to .*inside the\s+production data root/;
const LIVE_RUN = /a long job is running and this would execute code alongside it/;
const SENTINEL_UNREADABLE = /sentinel is present but unreadable/;
const DETECTION_FAILED = /no test command could be resolved/;

// A sandbox and a production root that are real directories and are not related.
function roots() {
  const base = tempDir();
  const live = path.join(base, 'production');
  const sandbox = path.join(base, 'sandbox');
  mkdirSync(live, { recursive: true });
  mkdirSync(sandbox, { recursive: true });
  return { base, live, sandbox };
}

// ---------------------------------------------------------------------------
// The two cases PLAN's verify line names by name
// ---------------------------------------------------------------------------

describe('the verify line', () => {
  test('the sandbox guard blocks a run pointed at production data', () => {
    const { live } = roots();
    const repo = makeRepo();

    // Pointed at production because the seam resolves inside it.
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: path.join(live, 'scratch') } }),
      SEAM_OVERLAPS,
      'suite run with the seam inside production data',
    );

    // Pointed at production because the seam is absent, so the project's own defaults
    // decide. That is L-03's second incident and it is a block, not a warning.
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live } }),
      NO_SEAM,
      'suite run with no seam at all',
    );

    // Pointed at production because the command says so outright.
    assertBlockedBecause(
      guard({
        payload: bash(`npm test -- --data-dir=${live}/index`, repo),
        env: { [LIVE]: live, [DATA]: tempDir() },
      }),
      NAMES_LIVE_DATA,
      'suite run naming production data on the command line',
    );
  });

  test('the commit gate blocks a commit attempted while the sentinel is set', () => {
    const repo = makeRepo({ change: { 'a.js': 'export const a = 1;\n' } });
    raise(repo, 'corpus-ingest', { what: 'full corpus ingest, ~4h' });

    const r = commitGate({ payload: bash('git commit -m "wip"', repo) });
    assertBlockedBecause(r, LIVE_RUN, 'commit during a live run');
    assert.match(r.stderr, /full corpus ingest, ~4h/, 'the block does not name the run it is protecting');
    assert.match(r.stderr, /run-sentinel\.mjs stop/, 'the block does not say how to clear the sentinel');
  });

  // The control for the case above. Without the sentinel the same commit blocks for a
  // different reason entirely, which is what proves the sentinel check fired first and
  // on its own merits rather than inheriting somebody else's block.
  test('the same commit without a sentinel blocks for a different reason', () => {
    const repo = makeRepo({ base: {}, change: { 'a.js': 'export const a = 1;\n' } });
    assertBlockedBecause(commitGate({ payload: bash('git commit -m "wip"', repo) }), DETECTION_FAILED, 'no sentinel');
  });
});

// ---------------------------------------------------------------------------
// The seam (L-03)
// ---------------------------------------------------------------------------

describe('the seam', () => {
  test('with no production data root declared the guard does not fire', () => {
    const repo = makeRepo();
    for (const env of [{}, { [LIVE]: '' }, { [LIVE]: '   ' }, { [DATA]: tempDir() }]) {
      assertAllowed(guard({ payload: bash('npm test', repo), env }), `no declaration, env ${JSON.stringify(env)}`);
    }
  });

  test('a declared production root that is not absolute blocks every command', () => {
    const repo = makeRepo();
    for (const value of ['corpus', './corpus', '../corpus']) {
      for (const command of ['npm test', 'ls']) {
        assertBlockedBecause(
          guard({ payload: bash(command, repo), env: { [LIVE]: value, [DATA]: tempDir() } }),
          LIVE_RELATIVE,
          `live root ${value} with ${command}`,
        );
      }
    }
  });

  test('a declared production root with no seam blocks every command', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const command of ['npm test', 'ls', 'git status', 'cat README.md']) {
      assertBlockedBecause(guard({ payload: bash(command, repo), env: { [LIVE]: live } }), NO_SEAM, command);
    }
    for (const value of ['', '   ', '\t']) {
      assertBlockedBecause(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: value } }),
        NO_SEAM,
        `blank seam ${JSON.stringify(value)} reads as unset`,
      );
    }
  });

  test('a seam that is not absolute blocks', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const value of ['sandbox', './sandbox', '../sandbox']) {
      assertBlockedBecause(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: value } }),
        SEAM_RELATIVE,
        `relative seam ${value}`,
      );
    }
  });

  test('a seam disjoint from production data allows', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    for (const command of ['npm test', 'ls', 'git status']) {
      assertAllowed(guard({ payload: bash(command, repo), env: { [LIVE]: live, [DATA]: sandbox } }), command);
    }
  });

  test('a seam inside production data blocks, at every depth', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const seam of [live, `${live}${path.sep}`, path.join(live, 'tmp'), path.join(live, 'a', 'b', 'c')]) {
      assertBlockedBecause(
        guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: seam } }),
        SEAM_OVERLAPS,
        `seam ${seam}`,
      );
    }
  });

  // The reverse containment is the one that is easy to forget. A seam of `D:/` is not
  // inside the production root, and every byte of production data sits inside it.
  test('a seam that contains production data blocks', () => {
    const { base, live } = roots();
    const repo = makeRepo();
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: base } }),
      SEAM_OVERLAPS,
      'seam is the parent of production data',
    );
  });

  // V-12: whole segment, never substring. `production-test` shares every character of
  // `production` and is a different directory.
  test('a sibling whose name merely starts with the production root is not inside it', () => {
    const { base, live } = roots();
    const repo = makeRepo();
    const sibling = `${live}-test`;
    mkdirSync(sibling, { recursive: true });
    assertAllowed(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: sibling } }),
      'name-prefix sibling as the seam',
    );
    assertAllowed(
      guard({ payload: bash(`npm test -- --data-dir=${sibling}/x`, repo), env: { [LIVE]: live, [DATA]: path.join(base, 'sandbox') } }),
      'name-prefix sibling named on the command line',
    );
  });

  test('an inline assignment in the command is the seam the child will see', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();

    assertAllowed(
      guard({ payload: bash(`${DATA}=${sandbox} npm test`, repo), env: { [LIVE]: live } }),
      'inline seam with none in the session',
    );
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=${path.join(live, 'x')} npm test`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      SEAM_OVERLAPS,
      'a good session seam does not rescue a bad inline one',
    );
    // The shell's own rule: the last assignment wins.
    assertBlockedBecause(
      guard({ payload: bash(`${DATA}=${sandbox} cd x && ${DATA}=${live} npm test`, repo), env: { [LIVE]: live } }),
      SEAM_OVERLAPS,
      'the last inline assignment wins',
    );
  });
});

// ---------------------------------------------------------------------------
// A command that names production data outright
// ---------------------------------------------------------------------------

describe('paths named in the command', () => {
  test('an absolute path inside production data blocks whatever the seam says', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const inside = path.join(live, 'index');
    mkdirSync(inside, { recursive: true });
    for (const command of [
      `ls ${inside}`,
      `rm -rf ${inside}`,
      `pytest --data-dir=${inside}`,
      `python -m tool --out "${inside}"`,
      `cat ${path.join(inside, 'entries.jsonl')}`,
    ]) {
      assertBlockedBecause(
        guard({ payload: bash(command, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
        NAMES_LIVE_DATA,
        command,
      );
    }
  });

  test('a relative path resolving into production data blocks', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash('ls ./index', path.join(live)), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'relative token resolved against the operation directory',
    );
  });

  test('ordinary paths, urls and bare words do not block', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    for (const command of [
      'npm test',
      'git status',
      'ls plugin/hooks',
      'curl https://example.invalid/production/index',
      'grep -r production .',
      'echo production',
    ]) {
      assertAllowed(guard({ payload: bash(command, repo), env: { [LIVE]: live, [DATA]: sandbox } }), command);
    }
  });
});

// ---------------------------------------------------------------------------
// Aliased paths: the failure that would be invisible
// ---------------------------------------------------------------------------
//
// isPathInside compares strings and never calls realpath, so two names for one directory
// do not compare equal. For the review jail that costs a review. Here it costs the
// guarantee: a link into production data walks straight past an unresolved check, and the
// data it reaches cannot be un-deleted.

describe('aliased paths', () => {
  function link(target, at) {
    try {
      symlinkSync(target, at, 'junction');
      return true;
    } catch {
      return false;
    }
  }

  test('a seam that is a link into production data is caught', (t) => {
    const { base, live } = roots();
    const repo = makeRepo();
    const alias = path.join(base, 'looks-like-a-sandbox');
    if (!link(path.join(live), alias)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [DATA]: alias } }),
      SEAM_OVERLAPS,
      'seam aliased onto production data',
    );
  });

  test('a production root named through a link still recognises its own contents', (t) => {
    const { base, live, sandbox } = roots();
    const repo = makeRepo();
    const alias = path.join(base, 'prod-alias');
    if (!link(live, alias)) return t.skip('this platform would not create a directory link');
    mkdirSync(path.join(live, 'index'), { recursive: true });
    assertBlockedBecause(
      guard({ payload: bash(`ls ${path.join(live, 'index')}`, repo), env: { [LIVE]: alias, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'production root declared under its alias, command uses the real name',
    );
  });

  test('a command reaching production data through a link is caught', (t) => {
    const { base, live, sandbox } = roots();
    const repo = makeRepo();
    mkdirSync(path.join(live, 'index'), { recursive: true });
    const alias = path.join(base, 'shortcut');
    if (!link(live, alias)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash(`cat ${path.join(alias, 'index', 'entries.jsonl')}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'command names production data through a link',
    );
  });

  test('a link planted inside the sandbox that points at production data is caught', (t) => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const trap = path.join(sandbox, 'data');
    if (!link(live, trap)) return t.skip('this platform would not create a directory link');
    assertBlockedBecause(
      guard({ payload: bash(`ls ${path.join(trap, 'index')}`, repo), env: { [LIVE]: live, [DATA]: sandbox } }),
      NAMES_LIVE_DATA,
      'a sandbox path that is really production data',
    );
  });
});

// ---------------------------------------------------------------------------
// The run-in-progress sentinel (L-02)
// ---------------------------------------------------------------------------

describe('the sentinel', () => {
  test('a live sentinel blocks the project test command from any session', () => {
    const repo = makeRepo();
    raise(repo);
    for (const command of ['npm test', 'npm run test', 'cd sub && npm test']) {
      assertBlockedBecause(guard({ payload: bash(command, repo) }), LIVE_RUN, command);
    }
  });

  test('a live sentinel blocks a python project\'s own declared command', () => {
    const repo = makeRepo({ base: { 'pyproject.toml': '[tool.pytest.ini_options]\ntestpaths = ["tests"]\n' } });
    raise(repo);
    for (const command of ['pytest', 'pytest -k thing', 'python -m pytest tests/']) {
      assertBlockedBecause(guard({ payload: bash(command, repo) }), LIVE_RUN, command);
    }
  });

  test('a live sentinel does not block reading, browsing or version control', () => {
    const repo = makeRepo();
    raise(repo);
    for (const command of ['ls -la', 'git status', 'git log --oneline', 'cat package.json']) {
      assertAllowed(guard({ payload: bash(command, repo) }), command);
    }
  });

  test('no sentinel means no block', () => {
    const repo = makeRepo();
    assertAllowed(guard({ payload: bash('npm test', repo) }), 'no sentinel directory at all');
    mkdirSync(path.join(repo, '.aeo', 'runs'), { recursive: true });
    assertAllowed(guard({ payload: bash('npm test', repo) }), 'an empty sentinel directory');
  });

  test('a sentinel whose owner process is gone is stale: it allows, loudly', () => {
    const repo = makeRepo();
    raise(repo, 'crashed', { pid: 999_999_999, host: os.hostname() });
    const r = guard({ payload: bash('npm test', repo) });
    assertAllowed(r, 'stale sentinel');
    assert.match(r.stderr, /owner process is gone/, 'a stale sentinel passed silently');
    assert.match(r.stderr, /run-sentinel\.mjs stop/, 'the note does not say how to clear it');

    // And the commit gate agrees, which is what stops one gate from being stricter than
    // the other about the same file.
    const c = commitGate({ payload: bash('git commit -m x', repo) });
    assert.match(c.stderr, /owner process is gone/, 'the commit gate did not report the stale sentinel');
    assert.doesNotMatch(c.stderr, LIVE_RUN, 'the commit gate treated a stale sentinel as live');
  });

  test('a sentinel owned by a process that is alive blocks', () => {
    const repo = makeRepo();
    raise(repo, 'running', { pid: process.pid, host: os.hostname() });
    assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, 'live owner process');
  });

  // Everything the guard cannot verify blocks. A sentinel from another machine cannot
  // have its process checked, and one with no pid recorded never expires on its own.
  test('a sentinel the guard cannot decide about blocks', () => {
    const repo = makeRepo();
    for (const record of [
      { pid: 999_999_999, host: 'some-other-machine' },
      { pid: null, host: os.hostname() },
      { pid: 'not a number', host: os.hostname() },
      { pid: -1, host: os.hostname() },
      { pid: 999_999_999, host: undefined },
      {},
    ]) {
      rmSync(path.join(repo, '.aeo', 'runs'), { recursive: true, force: true });
      raise(repo, 'undecidable', record);
      assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, `record ${JSON.stringify(record)}`);
    }
  });

  test('an unreadable sentinel blocks rather than being ignored', () => {
    const repo = makeRepo();
    for (const body of ['not json', '[1,2,3]', 'null', '{"id":']) {
      rmSync(path.join(repo, '.aeo', 'runs'), { recursive: true, force: true });
      raise(repo, 'broken', body);
      assertBlockedBecause(guard({ payload: bash('npm test', repo) }), SENTINEL_UNREADABLE, `body ${JSON.stringify(body)}`);
      assertBlockedBecause(commitGate({ payload: bash('git commit -m x', repo) }), SENTINEL_UNREADABLE, `commit, body ${JSON.stringify(body)}`);
    }
  });

  test('one run finishing does not clear another run\'s sentinel', () => {
    const repo = makeRepo();
    raise(repo, 'ingest-a', { what: 'corpus A' });
    raise(repo, 'ingest-b', { what: 'corpus B' });
    const both = guard({ payload: bash('npm test', repo) });
    assertBlockedBecause(both, LIVE_RUN, 'two live runs');
    assert.match(both.stderr, /corpus A/);
    assert.match(both.stderr, /corpus B/);

    rmSync(sentinelPath(repo, 'ingest-a'));
    const one = guard({ payload: bash('npm test', repo) });
    assertBlockedBecause(one, LIVE_RUN, 'one run still live');
    assert.match(one.stderr, /corpus B/);
    assert.doesNotMatch(one.stderr, /corpus A/);
  });

  test('a documentation-only commit is not held by a live run', () => {
    const repo = makeRepo({ change: { 'NOTES.md': '# what went wrong\n' } });
    raise(repo);
    const r = commitGate({ payload: bash('git commit -m "notes"', repo) });
    assertAllowed(r, 'docs-only commit during a live run');
    assert.match(r.stderr, /documentation only/, 'the docs-only path did not fire');
  });

  test('the sentinel is shared with every worktree of the project', () => {
    const main = makeRepo();
    const worktree = path.join(tempDir(), 'wt');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/other', worktree);
    raise(main, 'ingest', { what: 'corpus ingest' });

    assert.equal(projectAnchor(worktree), main, 'a linked worktree did not resolve to its main checkout');
    assertBlockedBecause(guard({ payload: bash('npm test', worktree) }), LIVE_RUN, 'suite run from a sibling worktree');
    assertBlockedBecause(commitGate({ payload: bash('git commit -m x', worktree) }), LIVE_RUN, 'commit from a sibling worktree');
  });

  test('the CLI raises, lists and clears a sentinel', () => {
    const repo = makeRepo();
    const run = (...args) =>
      spawnSync(process.execPath, [SENTINEL_CLI, ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });

    const started = run('start', 'corpus ingest!', '--what', 'four hours');
    assert.equal(started.status, 0, started.stderr);
    assert.ok(existsSync(sentinelPath(repo, 'corpus ingest!')), 'start wrote no sentinel file');
    assertBlockedBecause(guard({ payload: bash('npm test', repo) }), LIVE_RUN, 'after start');

    const listed = run('list');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /LIVE .*four hours/);

    assert.equal(run('stop', 'corpus ingest!').status, 0);
    assertAllowed(guard({ payload: bash('npm test', repo) }), 'after stop');
  });
});

// ---------------------------------------------------------------------------
// There is no override (L-05)
// ---------------------------------------------------------------------------

describe('no override', () => {
  const disablers = [
    'AEO_SANDBOX_GUARD',
    'AEO_DISABLE_SANDBOX_GUARD',
    'AEO_SKIP_SANDBOX',
    'AEO_ALLOW_LIVE_DATA',
    'AEO_ALLOW_PRODUCTION_DATA',
    'AEO_SANDBOX',
    'AEO_FORCE',
    'AEO_UNSAFE',
    'CLAUDE_DISABLE_HOOKS',
    'DISABLE_HOOKS',
    'SKIP_GATES',
  ];

  test('no environment variable turns the data rule off', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const name of disablers) {
      for (const value of ['1', 'true']) {
        assertBlockedBecause(
          guard({ payload: bash('npm test', repo), env: { [LIVE]: live, [name]: value } }),
          NO_SEAM,
          `${name}=${value}`,
        );
      }
    }
  });

  test('no environment variable turns the sentinel off', () => {
    const repo = makeRepo();
    raise(repo);
    for (const name of disablers) {
      assertBlockedBecause(guard({ payload: bash('npm test', repo), env: { [name]: '1' } }), LIVE_RUN, name);
      assertBlockedBecause(commitGate({ payload: bash('git commit -m x', repo), env: { [name]: '1' } }), LIVE_RUN, name);
    }
  });

  test('no flag in the command turns anything off', () => {
    const { live } = roots();
    const repo = makeRepo();
    raise(repo);
    for (const flag of ['--no-sandbox', '--allow-live-data', '--force', '--aeo-skip', '--no-verify', '-f']) {
      assertBlockedBecause(guard({ payload: bash(`npm test ${flag}`, repo) }), LIVE_RUN, `sentinel with ${flag}`);
      assertBlockedBecause(
        guard({ payload: bash(`ls ${flag}`, repo), env: { [LIVE]: live } }),
        NO_SEAM,
        `data rule with ${flag}`,
      );
    }
  });

  test('an elevated permission mode does not turn anything off', () => {
    const { live } = roots();
    const repo = makeRepo();
    raise(repo);
    const extra = { permission_mode: 'bypassPermissions' };
    assertBlockedBecause(guard({ payload: bash('npm test', repo, extra) }), LIVE_RUN, 'bypassPermissions, sentinel');
    assertBlockedBecause(
      guard({ payload: bash('ls', repo, extra), env: { [LIVE]: live } }),
      NO_SEAM,
      'bypassPermissions, data rule',
    );
  });

  // The orchestrator carries no agent_type, and every AEO role carries a namespaced one
  // (C-02). Unlike block-merge, none of them is exempt here: a founder-approved merge is
  // a real workflow, a founder-approved run against production data is not.
  test('every identity is subject to the guard, the orchestrator included', () => {
    const { live } = roots();
    const repo = makeRepo();
    raise(repo);
    for (const agent_type of [undefined, 'aeo:builder', 'aeo:reviewer', 'aeo:triage', 'builder', 'Explore', 'other:agent']) {
      const extra = agent_type === undefined ? {} : { agent_type };
      assertBlockedBecause(guard({ payload: bash('npm test', repo, extra) }), LIVE_RUN, `sentinel, ${agent_type}`);
      assertBlockedBecause(
        guard({ payload: bash('ls', repo, extra), env: { [LIVE]: live } }),
        NO_SEAM,
        `data rule, ${agent_type}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Malformed payloads
// ---------------------------------------------------------------------------

describe('malformed payloads', () => {
  test('a payload with no usable command still applies the environment rule', () => {
    const { live } = roots();
    const repo = makeRepo();
    for (const tool_input of [undefined, null, {}, { command: 42 }, 'a string']) {
      const payload = bash('placeholder', repo);
      if (tool_input === undefined) delete payload.tool_input;
      else payload.tool_input = tool_input;
      assertBlockedBecause(guard({ payload, env: { [LIVE]: live } }), NO_SEAM, `tool_input ${JSON.stringify(tool_input)}`);
    }
  });

  test('a payload with no usable cwd still applies the environment rule', () => {
    const { live, sandbox } = roots();
    for (const cwd of [undefined, '', 42]) {
      const payload = bash('npm test', cwd);
      if (cwd === undefined) delete payload.cwd;
      assertBlockedBecause(guard({ payload, env: { [LIVE]: live } }), NO_SEAM, `cwd ${JSON.stringify(cwd)}`);
      assertAllowed(guard({ payload, env: { [LIVE]: live, [DATA]: sandbox } }), `cwd ${JSON.stringify(cwd)}, good seam`);
    }
  });

  test('extra and unknown payload fields do not disturb the decision', () => {
    const { live, sandbox } = roots();
    const repo = makeRepo();
    const extra = { unknown_future_field: { nested: [1, 2, 3] }, effort: { level: 'max' } };
    assertAllowed(guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live, [DATA]: sandbox } }), 'extra fields');
    assertBlockedBecause(guard({ payload: bash('npm test', repo, extra), env: { [LIVE]: live } }), NO_SEAM, 'extra fields, no seam');
  });

  // Inherited from runGate and deliberately not overridden. An unreadable payload allows,
  // with a line on stderr. The model cannot cause it: Claude Code serialises the payload
  // and every model-controlled string sits inside valid JSON, so a parse failure is a
  // platform fault rather than a bypass. Pinned rather than claimed as covered, because
  // it is the one shape in which this gate does not fire.
  test('an unreadable payload allows and says so, which is the gate not firing', () => {
    for (const raw of ['', '   ', 'not json at all', '[1,2,3]', 'null', '"a string"']) {
      const r = guard({ raw, env: { [LIVE]: 'D:/production' } });
      assert.equal(r.status, 0, `raw ${JSON.stringify(raw)}: expected exit 0`);
      assert.match(r.stderr, /sandbox-guard: (empty|unreadable) hook payload/, `raw ${JSON.stringify(raw)}: silent skip`);
    }
  });
});

// ---------------------------------------------------------------------------
// The pieces, unit level
// ---------------------------------------------------------------------------

describe('tokenising and matching', () => {
  test('quoted spans stay in one token', () => {
    assert.deepEqual(shellTokens('cp "a b/c" d'), ['cp', 'a b/c', 'd']);
    assert.deepEqual(shellTokens('x --out="a b" y'), ['x', '--out=a b', 'y']);
    assert.deepEqual(shellTokens(''), []);
    assert.deepEqual(shellTokens(null), []);
  });

  test('path candidates take the right-hand side of an assignment', () => {
    assert.deepEqual(pathCandidates(shellTokens('pytest --data-dir=D:/corpus')), ['D:/corpus']);
    assert.deepEqual(pathCandidates(shellTokens('AEO_DATA_ROOT=/tmp/x npm test')), ['/tmp/x']);
    assert.deepEqual(pathCandidates(shellTokens('echo hello world')), []);
    assert.deepEqual(pathCandidates(shellTokens('curl https://example.invalid/a/b')), []);
  });

  test('a declared command is recognised as a whole token, never a substring', () => {
    const declared = [['uv', 'run', 'pytest']];
    assert.equal(invokesDeclaredSuite(shellTokens('uv run pytest'), declared), 'uv run pytest');
    assert.equal(invokesDeclaredSuite(shellTokens('pytest -k x'), declared), 'uv run pytest');
    assert.equal(invokesDeclaredSuite(shellTokens('echo pytestsuite'), declared), null);
    assert.equal(invokesDeclaredSuite(shellTokens('ls'), declared), null);
    assert.equal(invokesDeclaredSuite(shellTokens('go test ./pkg'), [['go', 'test', './...']]), 'go test ./...');
    assert.equal(invokesDeclaredSuite(shellTokens('cargo build'), [['cargo', 'test']]), null);
  });

  test('the seam is read from the command before the environment', () => {
    const env = { [LIVE]: 'D:/production', [DATA]: 'D:/sandbox' };
    assert.equal(resolveRoots({ command: 'npm test', env, platform: 'win32' }).data.root, 'D:/sandbox');
    assert.equal(resolveRoots({ command: `${DATA}=D:/other npm test`, env, platform: 'win32' }).data.root, 'D:/other');
    assert.equal(resolveRoots({ command: 'npm test', env, platform: 'win32' }).dataSource, 'session environment');
    assert.equal(resolveRoots({ command: `${DATA}=D:/other x`, env, platform: 'win32' }).dataSource, 'the command');
  });

  test('an MSYS path is normalised on Windows before it is compared', () => {
    const roots = resolveRoots({ command: '', env: { [LIVE]: '/d/production', [DATA]: '/d/sandbox' }, platform: 'win32' });
    assert.equal(roots.live.root, 'D:/production');
    assert.equal(roots.data.root, 'D:/sandbox');
  });
});

// ---------------------------------------------------------------------------
// Registration (C-01): the gate is only a gate if hooks.json wires it
// ---------------------------------------------------------------------------

describe('hooks.json registration', () => {
  const manifest = path.join(repoRoot, 'plugin', 'hooks', 'hooks.json');

  test('sandbox-guard is registered on PreToolUse for Bash, with no shell fallback', (t) => {
    if (!existsSync(manifest)) return t.skip('plugin/hooks/hooks.json does not exist yet');
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    const entries = parsed?.hooks?.PreToolUse;
    assert.ok(Array.isArray(entries), 'hooks.json has no PreToolUse array');

    const strings = (node) =>
      typeof node === 'string'
        ? [node]
        : Array.isArray(node)
          ? node.flatMap(strings)
          : node && typeof node === 'object'
            ? Object.values(node).flatMap(strings)
            : [];

    const ours = entries.filter((e) => strings(e).some((s) => s.includes('sandbox-guard.mjs')));
    if (ours.length === 0) {
      return t.skip('sandbox-guard.mjs is not wired yet; whoever reconciles hooks.json owns that entry');
    }
    assert.equal(ours.length, 1, 'exactly one PreToolUse entry must run sandbox-guard.mjs');
    assert.ok(
      ours[0].matcher === undefined || ours[0].matcher === '*' || ours[0].matcher === '' || /Bash/.test(ours[0].matcher),
      `sandbox-guard must be matched on Bash; found ${JSON.stringify(ours[0].matcher)}`,
    );
    for (const s of strings(ours[0])) {
      assert.doesNotMatch(s, /\|\||&&/, `a shell fallback converts every block into a pass: ${s}`);
    }
    assert.ok(
      strings(ours[0]).some((s) => s.includes('${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-guard.mjs')),
      'the entry must reference ${CLAUDE_PLUGIN_ROOT}/hooks/sandbox-guard.mjs or preflight reports no gate scripts',
    );
  });
});
