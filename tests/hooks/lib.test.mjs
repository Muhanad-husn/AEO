// Tests for plugin/hooks/lib.mjs.
//
// Run from the repo root, with no install step and no dependencies:
//   node --test                              # everything
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// Not `node --test tests/hooks/`. Since Node 22.6 a positional argument to --test is a
// glob pattern, and that one resolves to the directory itself, which Node then fails to
// load as a module. Verified on Node 24.16.0.
//
// The slice this covers exists because the v2 harness shipped its enforcement code
// untested (V-13). Every export is tested, including its failure and malformed-input
// paths, and every case that has cost production something has a named test.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLUGIN_NAMESPACE,
  RUNTIME_MISSING_BANNER,
  agentIdentity,
  currentBranch,
  defaultBranch,
  git,
  gitToplevel,
  isAeoRole,
  isAnyAeoRole,
  isPathInside,
  matchesGitSubcommand,
  normalizeHookPath,
  preflight,
  resolveOperationDir,
  resolveWorktree,
} from '../../plugin/hooks/lib.mjs';

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p11-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function run(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A throwaway repo with one real commit, so rev-parse --abbrev-ref names the branch. */
function makeRepo({ branch = 'main' } = {}) {
  const dir = tempDir();
  run(dir, 'init', '-q', '-b', branch);
  run(dir, 'config', 'user.name', 'aeo-test');
  run(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  run(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  return dir;
}

/** `D:\a\b` -> `/d/a/b`, the MSYS form a subagent Bash call can deliver. */
function toMsys(winPath) {
  const p = winPath.replace(/\\/g, '/');
  const m = /^([A-Za-z]):(\/.*)$/.exec(p);
  return m ? `/${m[1].toLowerCase()}${m[2]}` : p;
}

const fixture = (name) => path.join(import.meta.dirname, 'fixtures', name);

/** Run a fixture hook in its own process and report exactly what a hook reports. */
function runHook(script, { payload, mode, raw } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [fixture(script)], {
    input,
    encoding: 'utf8',
    env: { ...process.env, AEO_FIXTURE_MODE: mode ?? '' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// normalizeHookPath — MSYS normalisation (L-09)
// ---------------------------------------------------------------------------

describe('normalizeHookPath', () => {
  const win = { platform: 'win32' };

  test('posix drive path becomes a windows path', () => {
    assert.equal(normalizeHookPath('/d/proj', win), 'D:/proj');
  });

  test('drive letter is uppercased', () => {
    assert.equal(normalizeHookPath('/c/Users/x', win), 'C:/Users/x');
  });

  test('bare drive root gets a trailing slash', () => {
    assert.equal(normalizeHookPath('/d', win), 'D:/');
  });

  test('/tmp is not a drive', () => {
    assert.equal(normalizeHookPath('/tmp/x', win), '/tmp/x');
  });

  test('/usr is not a drive', () => {
    assert.equal(normalizeHookPath('/usr/local/bin', win), '/usr/local/bin');
  });

  test('a bare multi-letter root is not a drive', () => {
    assert.equal(normalizeHookPath('/tmp', win), '/tmp');
  });

  test('windows backslash path passes through', () => {
    assert.equal(normalizeHookPath('D:\\proj', win), 'D:\\proj');
  });

  test('windows forward-slash path passes through', () => {
    assert.equal(normalizeHookPath('D:/proj', win), 'D:/proj');
  });

  test('on posix, /d/proj is a real path and is left alone', () => {
    assert.equal(normalizeHookPath('/d/proj', { platform: 'linux' }), '/d/proj');
  });

  test('empty and non-string inputs pass through unchanged', () => {
    assert.equal(normalizeHookPath('', win), '');
    assert.equal(normalizeHookPath(null, win), null);
    assert.equal(normalizeHookPath(undefined, win), undefined);
    assert.equal(normalizeHookPath(42, win), 42);
  });
});

// ---------------------------------------------------------------------------
// resolveOperationDir — the fallback order, each step paid for by an incident
// ---------------------------------------------------------------------------

describe('resolveOperationDir', () => {
  const opts = { env: {}, cwd: () => '/from/process', platform: 'linux' };
  const cmd = (command) => ({ tool_input: { command } });

  test('unquoted cd target wins', () => {
    const r = resolveOperationDir({ ...cmd('cd /repo/wt-1 && git commit -m x'), cwd: '/launch' }, opts);
    assert.deepEqual(r, { dir: '/repo/wt-1', source: 'cd' });
  });

  test('double-quoted cd target with a space', () => {
    const r = resolveOperationDir(cmd('cd "/repo/my wt" && git commit -m x'), opts);
    assert.equal(r.dir, '/repo/my wt');
    assert.equal(r.source, 'cd');
  });

  test('single-quoted cd target with a space', () => {
    const r = resolveOperationDir(cmd("cd '/repo/my wt' && git commit -m x"), opts);
    assert.equal(r.dir, '/repo/my wt');
    assert.equal(r.source, 'cd');
  });

  test('an MSYS cd target is normalised on windows', () => {
    const r = resolveOperationDir(cmd('cd /d/proj-wt && git commit -m x'), { ...opts, platform: 'win32' });
    assert.equal(r.dir, 'D:/proj-wt');
    assert.equal(r.source, 'cd');
  });

  test('cd without && is not honoured', () => {
    const r = resolveOperationDir({ ...cmd('cd /elsewhere; git commit -m x'), cwd: '/launch' }, opts);
    assert.deepEqual(r, { dir: '/launch', source: 'payload.cwd' });
  });

  test('cd behind || is not honoured', () => {
    const r = resolveOperationDir({ ...cmd('cd /elsewhere || git commit -m x'), cwd: '/launch' }, opts);
    assert.equal(r.source, 'payload.cwd');
  });

  test('a command merely starting with the letters cd is not a cd', () => {
    const r = resolveOperationDir({ ...cmd('cdk deploy && git commit -m x'), cwd: '/launch' }, opts);
    assert.equal(r.source, 'payload.cwd');
  });

  test('falls back to payload.cwd', () => {
    assert.deepEqual(resolveOperationDir({ cwd: '/launch' }, opts), { dir: '/launch', source: 'payload.cwd' });
  });

  test('an MSYS payload.cwd is normalised on windows', () => {
    const r = resolveOperationDir({ cwd: '/d/proj' }, { ...opts, platform: 'win32' });
    assert.deepEqual(r, { dir: 'D:/proj', source: 'payload.cwd' });
  });

  test('an MSYS CLAUDE_PROJECT_DIR is normalised on windows', () => {
    const env = { CLAUDE_PROJECT_DIR: '/d/proj' };
    const r = resolveOperationDir({}, { ...opts, env, platform: 'win32' });
    assert.deepEqual(r, { dir: 'D:/proj', source: 'CLAUDE_PROJECT_DIR' });
  });

  test('CLAUDE_PROJECT_DIR is third, not second — it is session-fixed', () => {
    const withEnv = { ...opts, env: { CLAUDE_PROJECT_DIR: '/launch-checkout' } };
    assert.equal(resolveOperationDir({ cwd: '/worktree' }, withEnv).source, 'payload.cwd');
    assert.deepEqual(resolveOperationDir({}, withEnv), { dir: '/launch-checkout', source: 'CLAUDE_PROJECT_DIR' });
  });

  test('process.cwd is the last resort, never the plugin root', () => {
    assert.deepEqual(resolveOperationDir({}, opts), { dir: '/from/process', source: 'process.cwd' });
  });

  test('whitespace-only cwd and env values are ignored', () => {
    const r = resolveOperationDir({ cwd: '   ' }, { ...opts, env: { CLAUDE_PROJECT_DIR: '  ' } });
    assert.equal(r.source, 'process.cwd');
  });

  test('a non-string command does not throw', () => {
    assert.equal(resolveOperationDir({ tool_input: { command: 42 }, cwd: '/launch' }, opts).source, 'payload.cwd');
  });

  test('a null payload resolves to the last resort', () => {
    assert.deepEqual(resolveOperationDir(null, opts), { dir: '/from/process', source: 'process.cwd' });
  });

  test('nothing resolvable yields a null dir rather than a throw', () => {
    assert.deepEqual(resolveOperationDir(null, { env: {}, cwd: () => '', platform: 'linux' }), {
      dir: null,
      source: 'none',
    });
  });
});

// ---------------------------------------------------------------------------
// resolveWorktree — resolution normalised to the git toplevel
// ---------------------------------------------------------------------------

describe('resolveWorktree', () => {
  test('resolves the toplevel from an MSYS payload.cwd (the #119 regression)', () => {
    const repo = makeRepo({ branch: 'feat/p11' });
    const expected = gitToplevel(repo);
    assert.ok(expected, 'the fixture repo must have a toplevel');

    const cwd = process.platform === 'win32' ? toMsys(repo) : repo;
    if (process.platform === 'win32') assert.match(cwd, /^\/[a-z]\//, 'the test must feed a genuinely MSYS cwd');

    const r = resolveWorktree({ cwd });
    assert.equal(r.source, 'payload.cwd');
    assert.equal(r.toplevel, expected);
  });

  test('an explicit cd wins over a cwd pinned to another worktree', () => {
    const launch = makeRepo({ branch: 'main' });
    const worktree = makeRepo({ branch: 'feat/other' });
    const target = process.platform === 'win32' ? toMsys(worktree) : worktree;

    const r = resolveWorktree({ cwd: launch, tool_input: { command: `cd ${target} && git commit -m x` } });
    assert.equal(r.source, 'cd');
    assert.equal(r.toplevel, gitToplevel(worktree));
    assert.equal(currentBranch(r.toplevel), 'feat/other');
  });

  test('a directory outside any repo yields a null toplevel, not a throw', () => {
    const plain = tempDir('aeo-p11-norepo-');
    const r = resolveWorktree({ cwd: plain });
    assert.equal(r.toplevel, null);
    assert.ok(r.dir);
  });
});

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

describe('git helpers', () => {
  test('git returns trimmed stdout', () => {
    const repo = makeRepo({ branch: 'feat/x' });
    assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/x');
  });

  test('git returns null on a failing command instead of throwing', () => {
    const repo = makeRepo();
    assert.equal(git(repo, 'rev-parse', '--verify', 'refs/heads/no-such-branch'), null);
  });

  test('git returns null outside a repository', () => {
    assert.equal(git(tempDir('aeo-p11-plain-'), 'rev-parse', '--show-toplevel'), null);
  });

  test('git returns null for a missing directory', () => {
    assert.equal(git(path.join(os.tmpdir(), 'aeo-p11-does-not-exist'), 'status'), null);
  });

  test('git returns null for an empty directory argument', () => {
    assert.equal(git('', 'status'), null);
    assert.equal(git(null, 'status'), null);
  });

  test('gitToplevel and currentBranch read the fixture repo', () => {
    const repo = makeRepo({ branch: 'release/1' });
    assert.ok(gitToplevel(repo));
    assert.equal(currentBranch(repo), 'release/1');
    assert.equal(currentBranch(tempDir('aeo-p11-plain2-')), null);
  });
});

// ---------------------------------------------------------------------------
// defaultBranch — D14
// ---------------------------------------------------------------------------

describe('defaultBranch', () => {
  test("origin's HEAD wins, and the remote name is stripped", () => {
    const repo = makeRepo({ branch: 'trunk' });
    run(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    assert.equal(defaultBranch(repo), 'trunk');
  });

  test("a slashed default branch keeps its slashes", () => {
    const repo = makeRepo({ branch: 'release/stable' });
    run(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release/stable');
    assert.equal(defaultBranch(repo), 'release/stable');
  });

  test("this repository's own init.defaultBranch is honoured", () => {
    const repo = makeRepo({ branch: 'whatever' });
    run(repo, 'config', 'init.defaultBranch', 'mainline'); // --local scope, which is the only scope read
    assert.equal(defaultBranch(repo), 'mainline');
  });

  test('a repo with no origin resolves from its own branches, not the machine gitconfig', () => {
    // THE REGRESSION. This machine's SYSTEM gitconfig sets init.defaultBranch=master.
    // Reading that key in any scope but --local made this repo, whose real branch is
    // `main`, resolve to `master`, so the commit gate compared main against master,
    // never fired, and let a code commit land directly on main.
    const repo = makeRepo({ branch: 'main' });
    assert.equal(run(repo, 'remote'), '', 'fixture must have no remote at all');
    assert.equal(defaultBranch(repo), 'main');
  });

  test('a no-origin repo on an unconventional single branch resolves to that branch', () => {
    // One branch is the default branch, whatever it is called. Also proves nothing is
    // reading the machine's `master` any more: no name here matches it.
    const repo = makeRepo({ branch: 'develop' });
    assert.equal(defaultBranch(repo), 'develop');
  });

  test('a no-origin repo picks the one conventional name among several branches', () => {
    const repo = makeRepo({ branch: 'main' });
    run(repo, 'branch', 'feat/a');
    run(repo, 'branch', 'feat/b');
    assert.equal(defaultBranch(repo), 'main');
  });

  test('a no-origin repo carrying BOTH main and master is unresolved, not guessed', () => {
    const repo = makeRepo({ branch: 'main' });
    run(repo, 'branch', 'master');
    assert.equal(defaultBranch(repo), null);
  });

  test('a no-origin repo of only unconventional branches is unresolved, not guessed', () => {
    const repo = makeRepo({ branch: 'develop' });
    run(repo, 'branch', 'staging');
    assert.equal(defaultBranch(repo), null);
  });

  test('returns null when nothing resolves, never the literal main', () => {
    // A path that is not a directory at all, so every git call fails regardless of
    // the machine's git config. D14's `main` last resort is deliberately gone: a guess
    // makes a gate that cannot tell what it protects behave like one that can.
    assert.equal(defaultBranch(path.join(os.tmpdir(), 'aeo-p11-absent-repo')), null);
  });

  test('a master repo resolves to master, not the literal main', () => {
    const repo = makeRepo({ branch: 'master' });
    run(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/master');
    assert.equal(defaultBranch(repo), 'master');
  });

  test('the cache is keyed by directory, so two worktrees get two answers', () => {
    const a = makeRepo({ branch: 'main' });
    const b = makeRepo({ branch: 'trunk' });
    run(a, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    run(b, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    assert.equal(defaultBranch(a), 'main');
    assert.equal(defaultBranch(b), 'trunk');
    assert.equal(defaultBranch(a), 'main'); // second read comes from the cache
  });
});

// ---------------------------------------------------------------------------
// agent_type semantics — C-02
// ---------------------------------------------------------------------------

describe('agent identity (C-02)', () => {
  test('the namespace tracks the plugin manifest name, not a copy of it', () => {
    // PLUGIN_NAMESPACE is hard-coded in the library, so a rename in plugin.json would
    // otherwise leave every identity gate matching nothing and firing on no call: the
    // silent no-op class D14 exists to close. Pinning it against the manifest here is
    // what makes the rename fail loudly, and it costs no runtime file read in a hook.
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', '..', 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    assert.equal(
      PLUGIN_NAMESPACE,
      manifest.name,
      'plugin.json name changed; update PLUGIN_NAMESPACE in plugin/hooks/lib.mjs to match',
    );
  });

  test('agentIdentity is null when the field is absent', () => {
    assert.equal(agentIdentity({}), null);
    assert.equal(agentIdentity(null), null);
    assert.equal(agentIdentity({ agent_type: '' }), null);
    assert.equal(agentIdentity({ agent_type: '   ' }), null);
    assert.equal(agentIdentity({ agent_type: 42 }), null);
  });

  test('agentIdentity trims', () => {
    assert.equal(agentIdentity({ agent_type: ' aeo:builder\n' }), 'aeo:builder');
  });

  test('a plugin subagent reports the namespaced name and matches its own role', () => {
    const payload = { agent_type: 'aeo:builder' };
    assert.equal(isAeoRole(payload, 'builder'), true);
    assert.equal(isAnyAeoRole(payload), true);
  });

  test('a plugin subagent does not match another role', () => {
    assert.equal(isAeoRole({ agent_type: 'aeo:builder' }, 'reviewer'), false);
  });

  test('the bare frontmatter name never fires — the port bug C-02 names', () => {
    // A matcher written against `builder` would have matched here and only here,
    // which is why the vendored gates never fired inside a plugin subagent.
    assert.equal(isAeoRole({ agent_type: 'builder' }, 'builder'), false);
    assert.equal(isAnyAeoRole({ agent_type: 'builder' }), false);
  });

  test('a main session run with --agent is not one of our subagents', () => {
    // agent_type is present here. A presence test would block the orchestrator's own
    // founder-approved merge path — the other half of C-02.
    for (const id of ['general-purpose', 'Explore', 'some-plugin:reviewer']) {
      assert.equal(isAnyAeoRole({ agent_type: id }), false, id);
      assert.equal(isAeoRole({ agent_type: id }, 'reviewer'), false, id);
    }
  });

  test('the pattern is anchored at both ends', () => {
    assert.equal(isAeoRole({ agent_type: 'xaeo:builder' }, 'builder'), false);
    assert.equal(isAeoRole({ agent_type: 'aeo:builder-x' }, 'builder'), false);
    assert.equal(isAeoRole({ agent_type: 'aeo:builderx' }, 'builder'), false);
    assert.equal(isAeoRole({ agent_type: 'not-aeo:builder' }, 'builder'), false);
  });

  test('an embedded newline cannot smuggle a matching identity past the anchors', () => {
    assert.equal(isAeoRole({ agent_type: 'rogue\naeo:builder' }, 'builder'), false);
    assert.equal(isAeoRole({ agent_type: 'aeo:builder\nrogue' }, 'builder'), false);
    // A trailing newline alone is trimmed, so a well-formed identity still matches.
    assert.equal(isAeoRole({ agent_type: 'aeo:builder\n' }, 'builder'), true);
  });

  test('a role name containing regex metacharacters is escaped, not interpreted', () => {
    assert.equal(isAeoRole({ agent_type: 'aeo:buildXr' }, 'build.r'), false);
    assert.equal(isAeoRole({ agent_type: 'aeo:build.r' }, 'build.r'), true);
  });

  test('isAnyAeoRole accepts every role this plugin ships', () => {
    for (const role of ['builder', 'reviewer', 'triage']) {
      assert.equal(isAnyAeoRole({ agent_type: `aeo:${role}` }), true, role);
    }
  });
});

// ---------------------------------------------------------------------------
// whole-token identity matching — V-12, argv case
// ---------------------------------------------------------------------------

describe('matchesGitSubcommand (V-12, argv case)', () => {
  test('matches a plain subcommand', () => {
    assert.equal(matchesGitSubcommand('git commit -m "x"', 'commit'), true);
    assert.equal(matchesGitSubcommand('git merge feat/x', 'merge'), true);
  });

  test('matches through git -C, which the skill version missed (V-02)', () => {
    assert.equal(matchesGitSubcommand('git -C /repo/wt merge feat/x', 'merge'), true);
    assert.equal(matchesGitSubcommand('git -c user.name=x commit -m y', 'commit'), true);
    assert.equal(matchesGitSubcommand('git --no-pager merge feat/x', 'merge'), true);
  });

  test('does not match git merge-base, which is read-only', () => {
    assert.equal(matchesGitSubcommand('git merge-base main HEAD', 'merge'), false);
  });

  test('does not match git commit-tree or commit_x', () => {
    assert.equal(matchesGitSubcommand('git commit-tree abc', 'commit'), false);
    assert.equal(matchesGitSubcommand('git commit_x', 'commit'), false);
  });

  test('does not match a substring of a longer word', () => {
    assert.equal(matchesGitSubcommand('git remerge', 'merge'), false);
  });

  test('does not match a different subcommand', () => {
    assert.equal(matchesGitSubcommand('git push origin HEAD', 'merge'), false);
  });

  test('matches later in a compound command', () => {
    assert.equal(matchesGitSubcommand('cd /repo && git commit -m x', 'commit'), true);
    assert.equal(matchesGitSubcommand('git add . && git merge feat/x', 'merge'), true);
  });

  test('empty and non-string commands are false, not a throw', () => {
    assert.equal(matchesGitSubcommand('', 'merge'), false);
    assert.equal(matchesGitSubcommand(null, 'merge'), false);
    assert.equal(matchesGitSubcommand(undefined, 'merge'), false);
    assert.equal(matchesGitSubcommand(42, 'merge'), false);
  });
});

// ---------------------------------------------------------------------------
// whole-segment identity matching — V-12, path case
// ---------------------------------------------------------------------------

describe('isPathInside (V-12, path case)', () => {
  const base = path.resolve(os.tmpdir(), 'aeo-p11-paths');
  const parent = path.join(base, 'proj');

  test('a child is inside its parent', () => {
    assert.equal(isPathInside(parent, path.join(parent, 'src', 'a.js')), true);
  });

  test('a path is inside itself', () => {
    assert.equal(isPathInside(parent, parent), true);
  });

  test('a name-prefix sibling is NOT inside — the trailing-separator rule', () => {
    assert.equal(isPathInside(parent, path.join(base, 'project')), false);
    assert.equal(isPathInside(parent, path.join(base, 'proj-old', 'src')), false);
  });

  test('a trailing separator on the parent changes nothing', () => {
    assert.equal(isPathInside(`${parent}${path.sep}`, path.join(parent, 'src')), true);
    assert.equal(isPathInside(`${parent}${path.sep}`, path.join(base, 'project')), false);
  });

  test('a trailing separator on the child changes nothing', () => {
    assert.equal(isPathInside(parent, `${path.join(parent, 'src')}${path.sep}`), true);
  });

  test('mixed separators compare equal', () => {
    assert.equal(isPathInside(parent.replace(/\\/g, '/'), path.join(parent, 'src')), true);
  });

  test('a parent is not inside its child', () => {
    assert.equal(isPathInside(path.join(parent, 'src'), parent), false);
  });

  test('case is ignored on windows and honoured elsewhere', () => {
    const shouted = path.join(base, 'PROJ', 'src');
    assert.equal(isPathInside(parent, shouted), process.platform === 'win32');
  });

  test('empty and non-string inputs are false, not a throw', () => {
    assert.equal(isPathInside('', parent), false);
    assert.equal(isPathInside(parent, ''), false);
    assert.equal(isPathInside(null, parent), false);
    assert.equal(isPathInside(parent, undefined), false);
    assert.equal(isPathInside('   ', '   '), false);
  });
});

// ---------------------------------------------------------------------------
// runGate — the one block path (C-06)
// ---------------------------------------------------------------------------

// Every behaviour fixtures/gate.mjs can be put into, including an unhandled one. The
// exit-code invariant is asserted across all of them; see the note on that test for
// why the set, not the assertion, is the load-bearing part.
const GATE_MODES = [
  'allow',
  'block',
  'throw',
  'swallow',
  'echo',
  'throw-null',
  'reject-bare',
  'throw-string',
  'throw-symbol',
  'throw-hostile',
  'floating-rejection',
  'timer-throw',
  'unknown-mode',
];

describe('runGate (C-06)', () => {
  const payload = { tool_name: 'Bash', tool_input: { command: 'git merge feat/x' } };

  test('a gate that decides nothing exits 0', () => {
    const r = runHook('gate.mjs', { payload, mode: 'allow' });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  test('block() exits 2 and states the reason on stderr', () => {
    const r = runHook('gate.mjs', { payload, mode: 'block' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^BLOCKED: fixture blocked Bash/);
  });

  test('the parsed payload reaches the gate intact', () => {
    const r = runHook('gate.mjs', { payload, mode: 'echo' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /saw command: git merge feat\/x/);
  });

  test('an internal error blocks — a gate that cannot decide does not pass the call', () => {
    const r = runHook('gate.mjs', { payload, mode: 'throw' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED: the fixture-gate gate could not evaluate this call/);
    assert.match(r.stderr, /fixture exploded/);
  });

  test('throw null blocks rather than failing open', () => {
    // `err.message` on null raises a TypeError inside the catch handler. Nothing
    // catches that, Node exits 1, and exit 1 is a NON-blocking error: the tool call
    // proceeds. This is the case the invariant test used not to cover.
    const r = runHook('gate.mjs', { payload, mode: 'throw-null' });
    assert.equal(r.status, 2, 'a null throw must block, not fail open with exit 1');
    assert.match(r.stderr, /BLOCKED: the fixture-gate gate could not evaluate this call/);
    assert.match(r.stderr, /null was thrown/);
  });

  test('a bare Promise.reject() blocks rather than failing open', () => {
    // The shape a spawn wrapper rejection takes. A commit gate awaiting one on a red
    // suite would have exited 1 and let the commit land.
    const r = runHook('gate.mjs', { payload, mode: 'reject-bare' });
    assert.equal(r.status, 2, 'a bare rejection must block, not fail open with exit 1');
    assert.match(r.stderr, /BLOCKED: the fixture-gate gate could not evaluate this call/);
  });

  test('a non-Error throw states what was thrown instead of "undefined"', () => {
    const r = runHook('gate.mjs', { payload, mode: 'throw-string' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fixture threw a bare string/);
    assert.doesNotMatch(r.stderr, /call \(undefined\)/);

    const sym = runHook('gate.mjs', { payload, mode: 'throw-symbol' });
    assert.equal(sym.status, 2);
    assert.match(sym.stderr, /Symbol\(fixture symbol\)/);
  });

  test('a throw from inside the error description still blocks', () => {
    // The catch handler itself is on the block path, so reading `.message` off a
    // hostile value must not be able to throw out of it.
    const r = runHook('gate.mjs', { payload, mode: 'throw-hostile' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED: the fixture-gate gate/);
  });

  test('a floating promise rejection blocks; try/catch cannot see it', () => {
    const r = runHook('gate.mjs', { payload, mode: 'floating-rejection' });
    assert.equal(r.status, 2, 'an unhandled rejection must block, not exit 1');
    assert.match(r.stderr, /BLOCKED: the fixture-gate gate crashed/);
    assert.match(r.stderr, /fixture floating rejection/);
  });

  test('a throw from a timer callback blocks; try/catch cannot see it either', () => {
    const r = runHook('gate.mjs', { payload, mode: 'timer-throw' });
    assert.equal(r.status, 2, 'an uncaught exception must block, not exit 1');
    assert.match(r.stderr, /BLOCKED: the fixture-gate gate crashed/);
    assert.match(r.stderr, /fixture timer exploded/);
  });

  test('a gate that swallows its own block still blocks', () => {
    // Without the latch in block(), this would exit 0 and the gate would be open.
    const r = runHook('gate.mjs', { payload, mode: 'swallow' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /BLOCKED: fixture blocked, then swallowed/);
  });

  test('an empty payload allows, and says so rather than skipping silently', () => {
    const r = runHook('gate.mjs', { raw: '', mode: 'block' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /empty hook payload/);
  });

  test('a whitespace-only payload allows loudly', () => {
    const r = runHook('gate.mjs', { raw: '   \n  ', mode: 'block' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /empty hook payload/);
  });

  test('malformed JSON allows loudly rather than blocking', () => {
    const r = runHook('gate.mjs', { raw: '{ not json', mode: 'block' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /unreadable hook payload/);
  });

  test('valid JSON that is not an object is treated as unreadable', () => {
    for (const raw of ['"a string"', '42', 'null', '[1,2]']) {
      const r = runHook('gate.mjs', { raw, mode: 'block' });
      assert.equal(r.status, 0, raw);
      assert.match(r.stderr, /unreadable hook payload/, raw);
    }
  });

  test('a gate never exits with a code other than 0 or 2', () => {
    // Any other non-zero exit is a NON-blocking error: the tool call proceeds and the
    // gate has failed open. This is the invariant the whole slice protects.
    //
    // The first version of this test iterated only the modes that threw a real Error,
    // so it asserted the invariant over an input set that excluded every value which
    // broke it, and it passed while `throw null` and a bare reject both exited 1. An
    // invariant test is only as good as its input set, the same way a count-based
    // preflight is not a coverage check (L-08). Any new failure shape belongs in
    // GATE_MODES. Every mode listed there other than the unknown-mode probe also has
    // a named test above asserting its stderr, so a typo in a mode name here would
    // weaken this loop but could not remove the coverage. `self-exit` is deliberately
    // absent: it violates contract 1 on purpose and is pinned by its own test below.
    for (const mode of GATE_MODES) {
      const r = runHook('gate.mjs', { payload, mode });
      assert.ok(r.status === 0 || r.status === 2, `${mode} exited ${r.status}`);
    }
  });

  test('the two paths the library cannot close are known, not assumed away', () => {
    // Stated as tests so the boundary is a fact on record rather than something a
    // later slice has to rediscover. Both exit 1 or 7, which Claude Code treats as a
    // non-blocking error: the tool call proceeds and the gate is open (C-06).
    //
    // 1. A gate file that crashes at module scope. runGate installs its crash
    //    handlers when it is called, and a syntax error or bad import happens first.
    //    preflight() catches a missing gate script, not a broken one.
    const early = runHook('crash-before-gate.mjs', { payload });
    assert.equal(early.status, 1, 'if this ever becomes 2, the library gained coverage it does not claim');
    assert.match(early.stderr, /exploded at module scope/);

    // 2. A gate that calls process.exit itself, against contract 1. Nothing in the
    //    library can intercept it.
    const selfExit = runHook('gate.mjs', { payload, mode: 'self-exit' });
    assert.equal(selfExit.status, 7, 'a gate calling process.exit owns its own exit code');
  });

  test('every payload shape also exits only 0 or 2', () => {
    // The other half of the invariant: the failure modes reachable before the gate
    // body ever runs.
    for (const raw of ['', '   \n ', '{ not json', '"a string"', '42', 'null', '[1,2]', '{}']) {
      const r = runHook('gate.mjs', { raw, mode: 'block' });
      assert.ok(r.status === 0 || r.status === 2, `${JSON.stringify(raw)} exited ${r.status}`);
    }
  });
});

// ---------------------------------------------------------------------------
// runReporter — never blocks
// ---------------------------------------------------------------------------

describe('runReporter', () => {
  test('writes its report to stdout and exits 0', () => {
    const r = runHook('reporter.mjs', { payload: { cwd: '/repo' }, mode: 'report' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /branch=\/repo/);
  });

  test('a throwing reporter still exits 0 and never blocks', () => {
    const r = runHook('reporter.mjs', { payload: { cwd: '/repo' }, mode: 'throw' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /report failed/);
  });

  test('an unreadable payload is reported around, not fatal', () => {
    const r = runHook('reporter.mjs', { raw: '{ not json', mode: 'report' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /branch=unknown/);
  });

  test('returning nothing writes nothing and exits 0', () => {
    const r = runHook('reporter.mjs', { payload: { cwd: '/repo' }, mode: 'silent' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });

  test('a floating rejection still exits 0 and says so', () => {
    const r = runHook('reporter.mjs', { payload: { cwd: '/repo' }, mode: 'floating-rejection' });
    assert.equal(r.status, 0, '"always exits 0" has to hold for the async crash paths too');
    assert.match(r.stderr, /report crashed/);
    assert.match(r.stderr, /reporter floating rejection/);
  });
});

// ---------------------------------------------------------------------------
// preflight — D8
// ---------------------------------------------------------------------------

describe('preflight (D8)', () => {
  function fakePluginRoot(hooksJson, scripts = []) {
    const root = tempDir('aeo-p11-plugin-');
    mkdirSync(path.join(root, 'hooks'), { recursive: true });
    if (hooksJson !== null) writeFileSync(path.join(root, 'hooks', 'hooks.json'), hooksJson, 'utf8');
    for (const s of scripts) writeFileSync(path.join(root, 'hooks', s), '// stub\n', 'utf8');
    return root;
  }

  const wiring = (...names) =>
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            hooks: names.map((n) => ({
              type: 'command',
              command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${n}"`,
            })),
          },
        ],
      },
    });

  test('reports ok when the runtime, git and every wired gate script are present', () => {
    const root = fakePluginRoot(wiring('block-merge.mjs', 'commit-gate.mjs'), ['block-merge.mjs', 'commit-gate.mjs']);
    const report = preflight({ pluginRoot: root });
    assert.equal(report.ok, true, JSON.stringify(report.checks));
    assert.equal(report.banner, null);
    assert.deepEqual(
      report.checks.map((c) => c.name),
      ['node runtime', 'git', 'hook wiring'],
    );
  });

  test('the node runtime check reads the running version', () => {
    const report = preflight({ pluginRoot: fakePluginRoot(wiring('a.mjs'), ['a.mjs']) });
    const node = report.checks.find((c) => c.name === 'node runtime');
    assert.equal(node.ok, true);
    assert.match(node.detail, new RegExp(`node ${process.versions.node.replace(/\./g, '\\.')}`));
  });

  test('a missing hooks.json is a failure — no gates are registered', () => {
    const report = preflight({ pluginRoot: fakePluginRoot(null) });
    assert.equal(report.ok, false);
    assert.match(report.banner, /no gates are registered/);
    assert.match(report.banner, /AEO GATES ARE NOT ENFORCING/);
  });

  test('an unparseable hooks.json is a failure', () => {
    const report = preflight({ pluginRoot: fakePluginRoot('{ not json') });
    assert.equal(report.ok, false);
    assert.match(report.banner, /does not parse/);
  });

  test('a hooks.json wiring no gate scripts is a failure', () => {
    const report = preflight({ pluginRoot: fakePluginRoot(JSON.stringify({ hooks: {} })) });
    assert.equal(report.ok, false);
    assert.match(report.banner, /registers no gate scripts/);
  });

  test('a wired gate whose script is absent is a failure — that gate fails open silently', () => {
    const root = fakePluginRoot(wiring('block-merge.mjs', 'gone.mjs'), ['block-merge.mjs']);
    const report = preflight({ pluginRoot: root });
    assert.equal(report.ok, false);
    assert.match(report.banner, /missing gate script\(s\).*gone\.mjs/);
  });

  test('an unset CLAUDE_PLUGIN_ROOT is a failure, not a silent pass', () => {
    const report = preflight({ pluginRoot: undefined });
    assert.equal(report.ok, false);
    assert.match(report.banner, /CLAUDE_PLUGIN_ROOT is unset/);
  });

  test('the banner explains that the gates are failing open', () => {
    const report = preflight({ pluginRoot: fakePluginRoot(null) });
    assert.match(report.banner, /failing OPEN/);
    assert.match(report.banner, /non-blocking error/);
  });
});

// ---------------------------------------------------------------------------
// the shell fallback — the one thing that survives a missing node
// ---------------------------------------------------------------------------

describe('RUNTIME_MISSING_BANNER', () => {
  test('is a single line, safe to embed unescaped in a shell command', () => {
    assert.ok(!RUNTIME_MISSING_BANNER.includes('\n'));
    assert.ok(!/["'`$\\]/.test(RUNTIME_MISSING_BANNER), 'must contain no shell metacharacters');
    assert.match(RUNTIME_MISSING_BANNER, /GATES NOT ENFORCING/);
  });
});
