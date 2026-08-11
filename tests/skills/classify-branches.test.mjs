// Tests for plugin/skills/safe-cleanup/scripts/classify-branches.mjs.
//
// D20 says skills are prose and prose gets no tests. This is not prose: it is the one
// executable in the skill tree that deletes things, so it keeps coverage, and the two
// rules below are why this file exists.
//
//   L-05 — a destructive tool must fail closed on a hollow keep-set. A garbage collector
//   was built correctly and review found that an empty keep-set, which is what running in
//   the wrong working directory produces, makes every artifact an orphan. `--apply --yes`
//   would have deleted the entire derived corpus.
//
//   L-08 — a zero over data you did not manage to read means "not measured", not "none
//   found". `gh()` returns null on failure and the PR loop swallowed it, so a failed
//   `gh pr list` silently cleared PR state for every branch while the report still said
//   the data was there.
//
// HOW gh IS CONTROLLED, AND WHY NOT A SHIM. The first version of this file shimmed `gh`
// onto PATH and every assertion it made was a lie: Node cannot spawn a `.cmd` without a
// shell and does not append PATHEXT, so on Windows the shim never resolved and every call
// went to the operator's real GitHub CLI. The failure-path tests passed anyway, because
// the real gh also failed. A test that passes for the wrong reason is worse than no test.
//
// So gh is controlled by presence, not by substitution:
//   - The L-05 group runs with gh REMOVED from PATH, which is deterministic everywhere.
//   - The query-failure group needs gh present and authenticated, and points the repo at
//     an unreachable remote so `gh pr list` genuinely fails. Where gh is unavailable that
//     group skips LOUDLY (L-08: a loud skip, never a quiet pass).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/safe-cleanup/scripts/classify-branches.mjs',
);

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix = 'aeo-p24-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

const git = (cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** The PATH key this platform actually uses. Windows spells it `Path`, and writing the
 *  other spelling adds a second variable the child ignores. */
const PATH_KEY = Object.keys(process.env).find(k => k.toLowerCase() === 'path') ?? 'PATH';

/** Every PATH entry that does not contain a gh executable. */
function pathWithoutGh() {
  const entries = (process.env[PATH_KEY] ?? '').split(path.delimiter);
  return entries
    .filter(dir => dir && !['gh', 'gh.exe', 'gh.cmd'].some(n => existsSync(path.join(dir, n))))
    .join(path.delimiter);
}

/** Whether a usable, authenticated gh exists. The query-failure group needs both. */
const ghUsable = (() => {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/**
 * A repository with `main` carrying one commit, plus the branches asked for. A branch with
 * `ahead: true` gets a commit main does not have, so it classifies as unmerged local work.
 *
 * `remote` is an unreachable URL on purpose: it makes `gh pr list` fail for real rather
 * than being faked into failing.
 */
function makeRepo({ branches = [], remote = false } = {}) {
  const dir = tempDir();
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'base']);

  for (const b of branches) {
    git(dir, ['branch', b.name]);
    if (b.ahead) {
      git(dir, ['checkout', '-q', b.name]);
      writeFileSync(path.join(dir, `${b.name.replace(/\W/g, '_')}.txt`), 'x\n');
      git(dir, ['add', '.']);
      git(dir, ['commit', '-q', '-m', `work on ${b.name}`]);
      git(dir, ['checkout', '-q', 'main']);
    }
  }
  if (remote) git(dir, ['remote', 'add', 'origin', 'https://example.invalid/nope/nope.git']);
  return dir;
}

/** Run the real script as a process. `gh: false` removes gh from PATH entirely. */
function run(cwd, args = [], { gh = false } = {}) {
  const env = { ...process.env };
  if (!gh) env[PATH_KEY] = pathWithoutGh();
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const branchesIn = (dir) =>
  git(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    .split('\n').map(s => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// L-05 — fail closed on a hollow keep-set
// ---------------------------------------------------------------------------

describe('a run that kept nothing on evidence refuses to delete', () => {
  // Two ancestor-merged branches and nothing else: no open PR, no unmerged local work, no
  // commits beyond a merged PR. This is the shape a wrong working directory, or a base
  // branch that already contains everything, produces.
  const hollow = () => makeRepo({ branches: [{ name: 'feat/a' }, { name: 'feat/b' }] });

  test('every branch deletable and none kept on evidence is a hard failure', () => {
    const dir = hollow();
    const before = branchesIn(dir);
    const r = run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.equal(r.status, 5, `expected the hollow-keep-set refusal\n${r.stderr}${r.stdout}`);
    assert.match(r.stderr, /every branch this run evaluated came out deletable/);
    assert.deepEqual(branchesIn(dir), before, 'nothing may be deleted by a refusing run');
  });

  test('the refusal happens before the recovery log is written', () => {
    const dir = hollow();
    const logPath = path.join(tempDir(), 'recovery.log');
    run(dir, ['--apply', '--yes', '--delete-merged', '--log', logPath]);
    assert.equal(existsSync(logPath), false, 'the guard must raise before any logging, per L-05');
    assert.equal(existsSync(path.join(dir, '.tdd-branch-cleanup.log')), false);
  });

  test('the refusal prints no RECOVERY or DELETING block, so nothing reads as half-done', () => {
    const r = run(hollow(), ['--apply', '--yes', '--delete-merged']);
    assert.doesNotMatch(r.stdout, /RECOVERY/);
    assert.doesNotMatch(r.stdout, /DELETING/);
  });

  test('there is no override flag, and plausible spellings do not become one', () => {
    for (const flag of ['--force', '--no-verify', '--allow-empty-keep-set', '--i-know-what-im-doing']) {
      const dir = hollow();
      const r = run(dir, ['--apply', '--yes', '--delete-merged', flag]);
      assert.equal(r.status, 5, `${flag} must not bypass the guard`);
      assert.equal(branchesIn(dir).length, 3, `${flag} deleted something`);
    }
  });

  test('protected-by-name branches do not satisfy the guard on their own', () => {
    // base and current are protected in every repository, so counting them would make the
    // check pass everywhere and assert nothing (L-08: a count-based preflight is not a
    // coverage check). Here `main` is both, and the run must still refuse.
    const dir = makeRepo({ branches: [{ name: 'feat/a' }] });
    const r = run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.equal(r.status, 5, `protected rows must not count as kept-on-evidence\n${r.stdout}`);
    assert.match(r.stderr, /0 kept on evidence/);
  });

  test('one branch kept on evidence is enough to proceed, and only the merged one goes', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/merged' }, { name: 'feat/wip', ahead: true }] });
    const r = run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.equal(r.status, 0, `expected the run to proceed\n${r.stderr}`);
    const after = branchesIn(dir);
    assert.ok(!after.includes('feat/merged'), 'the merged branch should have been deleted');
    assert.ok(after.includes('feat/wip'), 'unmerged local work is never deleted');
    assert.ok(after.includes('main'));
  });

  test('dry-run still reports, because that is how the operator sees the problem', () => {
    const dir = hollow();
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /DRY-RUN/);
    assert.match(r.stdout, /feat\/a/);
    assert.equal(branchesIn(dir).length, 3, 'dry-run deletes nothing');
  });
});

// ---------------------------------------------------------------------------
// L-08 — a failed PR query is missing data, not an all-clear
// ---------------------------------------------------------------------------

describe('a failed gh pr list is missing data, never "no PRs"', () => {
  // The repo points at an unreachable remote, so the query fails for real.
  const unreachable = () =>
    makeRepo({ branches: [{ name: 'feat/merged' }, { name: 'feat/wip', ahead: true }], remote: true });

  // `false`, not `null`: Node's runner skips on ANY truthy-or-null skip value, so a `null`
  // here silently skipped all three of these while the file reported them as coverage.
  // That is L-08's own trap — a skip-guard turning a run into a quiet no-op that reports
  // OK — reproduced in the tests written to enforce it.
  const skipReason = ghUsable
    ? false
    : 'gh is not installed or not authenticated here, so prCapable can never be true and this rule cannot be reached';

  test('the report says the query FAILED, not that gh was available', { skip: skipReason }, () => {
    const r = run(unreachable(), [], { gh: true });
    assert.match(r.stdout, /PR detection: FAILED/);
    assert.doesNotMatch(r.stdout, /gh \+ remote available/);
  });

  test('apply mode refuses rather than delete under a guarantee it cannot honour', { skip: skipReason }, () => {
    const dir = unreachable();
    const before = branchesIn(dir);
    const r = run(dir, ['--apply', '--yes', '--delete-merged'], { gh: true });
    assert.equal(r.status, 4, `expected the PR-failure refusal\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /REFUSING: the PR query failed/);
    assert.deepEqual(branchesIn(dir), before, 'a refusing run must delete nothing');
  });

  test('the PR-failure refusal outranks the keep-set guard, and names the right cause', { skip: skipReason }, () => {
    // Both conditions hold here: the query failed AND nothing was kept on evidence.
    // Reporting the keep-set as the cause would send the operator to look at the wrong
    // thing, so the degraded input is named first.
    const dir = makeRepo({ branches: [{ name: 'feat/a' }, { name: 'feat/b' }], remote: true });
    const r = run(dir, ['--apply', '--yes', '--delete-merged'], { gh: true });
    assert.equal(r.status, 4);
    assert.doesNotMatch(r.stderr, /came out deletable/);
  });

  test('with no gh at all the report says UNAVAILABLE, which is a different claim', () => {
    // This one needs no gh and so runs everywhere. "Not installed" and "installed but the
    // query failed" are distinct states and the report must not collapse them.
    const r = run(makeRepo({ branches: [{ name: 'feat/wip', ahead: true }] }));
    assert.match(r.stdout, /PR detection: UNAVAILABLE/);
    assert.doesNotMatch(r.stdout, /FAILED/);
  });
});

// ---------------------------------------------------------------------------
// The guarantees the port must not have broken
// ---------------------------------------------------------------------------

describe('the pre-existing safety guarantees still hold', () => {
  test('--apply without --yes refuses, before either new guard is consulted', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/merged' }, { name: 'feat/wip', ahead: true }] });
    const r = run(dir, ['--apply', '--delete-merged']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /REFUSING: --apply requires --yes/);
    assert.equal(branchesIn(dir).length, 3);
  });

  test('a detached HEAD refuses', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/wip', ahead: true }] });
    const sha = git(dir, ['rev-parse', 'HEAD']).trim();
    git(dir, ['checkout', '-q', sha]);
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /detached HEAD/);
  });

  test('the recovery log is written before deletion on a run that proceeds', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/merged' }, { name: 'feat/wip', ahead: true }] });
    const logPath = path.join(tempDir(), 'recovery.log');
    const r = run(dir, ['--apply', '--yes', '--delete-merged', '--log', logPath]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(logPath), 'a deleting run must leave a recovery log');
    assert.match(readFileSync(logPath, 'utf8'), /feat\/merged/);
  });

  test('unmerged local work survives --delete-merged', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/wip', ahead: true }, { name: 'feat/merged' }] });
    run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.ok(branchesIn(dir).includes('feat/wip'));
  });

  test('the usage block points at the plugin root, not a variable nothing sets', () => {
    // The script ships from an installed plugin now. ${CLAUDE_SKILL_DIR} is not a
    // documented Claude Code variable, so a reader following the old header got an unset
    // path, and the skill's own prose already gives the plugin-root form.
    const source = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(source, /CLAUDE_SKILL_DIR/);
    assert.match(source, /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/safe-cleanup\/scripts\/classify-branches\.mjs/);
  });
});
