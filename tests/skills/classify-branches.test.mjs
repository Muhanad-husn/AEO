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
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const SCRIPT = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/safe-cleanup/scripts/classify-branches.mjs',
);

// Importing the script is only safe because it guards `main()` behind an
// invoked-as-a-script check. Without that guard this import would classify branches in
// whatever repository the runner is sitting in — which is this one.
const { mergedAtRecordedHead } = await import(pathToFileURL(SCRIPT).href);

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

const GH_NAMES = ['gh', 'gh.exe', 'gh.cmd'];
const GIT_NAMES = ['git', 'git.exe', 'git.cmd'];

/** The first of `names` present in `dir`, or undefined. */
const executableIn = (dir, names) => names.find(n => existsSync(path.join(dir, n)));

/**
 * Every PATH entry that does not contain a gh executable — with git put back if that
 * removal cost us git.
 *
 * Removing whole directories is blunt, and on Linux it is wrong: gh and git both sit in
 * /usr/bin, so the filter took git with it and every script under test exited 1 with
 * "not inside a git repository". Nine tests failed for a reason none of them was
 * testing, and only on the platform this suite had never run on. Where the filter costs
 * us git, a scratch directory carrying a link to the real one goes back on the front.
 *
 * Windows never reaches the repair: gh and git install to different directories there.
 */
let repairedPath = null;
function pathWithoutGh() {
  if (repairedPath !== null) return repairedPath;
  const entries = (process.env[PATH_KEY] ?? '').split(path.delimiter).filter(Boolean);
  const kept = entries.filter(dir => !executableIn(dir, GH_NAMES));
  if (kept.some(dir => executableIn(dir, GIT_NAMES))) return (repairedPath = kept.join(path.delimiter));

  const gitDir = entries.find(dir => executableIn(dir, GIT_NAMES));
  assert.ok(gitDir, 'no git found on PATH; these tests drive a real repository');
  const name = executableIn(gitDir, GIT_NAMES);
  const shim = tempDir('aeo-p24-git-');
  // A link, never a copy. A copied git is a git that may not find its own libexec, and
  // the failure of that is a confusing git rather than an absent one. If the link cannot
  // be made, say so and stop: a suite that silently proceeds without git is the thing
  // this repair exists to prevent.
  symlinkSync(path.join(gitDir, name), path.join(shim, name));
  return (repairedPath = [shim, ...kept].join(path.delimiter));
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

// ---------------------------------------------------------------------------
// The squash merge, which `git cherry` cannot see
// ---------------------------------------------------------------------------
//
// Found by the first live run rather than by any test here, and no fixture in this file
// could have found it: they all merge by fast-forward. On a repository that squash-merges,
// which is GitHub's most common setting, the tool kept every branch and deleted nothing.
//
// The rule is asserted against PR records handed to it directly. `gh` cannot be shimmed on
// Windows (see the preamble), so the CLI path cannot be driven into this state from a test
// — the premise test below covers the git half, the unit tests cover the decision, and the
// join of the two ran live against the testbed.

describe('git cherry does not see a squash merge — the premise of the whole rule', () => {
  test('a squash-merged branch still reports every commit as absent from the base', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/squashed', ahead: true }] });
    git(dir, ['checkout', '-q', 'feat/squashed']);
    writeFileSync(path.join(dir, 'second.txt'), 'y\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-q', '-m', 'second commit on the branch']);
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '--squash', 'feat/squashed']);
    git(dir, ['commit', '-q', '-m', 'squashed feat/squashed into main']);

    // The content is in main...
    assert.ok(existsSync(path.join(dir, 'second.txt')), 'the squash must have brought the content over');
    // ...and git still says none of the branch's commits are there, because a squash does
    // not preserve their patch-ids. This is exactly what made the tool keep the branch.
    const cherry = git(dir, ['cherry', 'main', 'feat/squashed']).trim();
    assert.ok(
      cherry.split('\n').filter(l => l.startsWith('+')).length > 0,
      'if this ever stops holding, the head-identity rule is no longer needed',
    );
    let isAncestor = true;
    try { git(dir, ['merge-base', '--is-ancestor', 'feat/squashed', 'main']); }
    catch { isAncestor = false; }
    assert.equal(isAncestor, false, 'a squashed branch is not an ancestor of the base either');
  });
});

describe('a merged PR that recorded this exact head releases the branch', () => {
  const HEAD = 'a'.repeat(40);
  const OTHER = 'b'.repeat(40);

  test('the branch tip is the head the forge merged', () => {
    const pr = { number: 2, state: 'MERGED', headRefOid: HEAD };
    assert.equal(mergedAtRecordedHead(HEAD, [pr]), pr);
  });

  test('a branch that moved past the merged head is not released', () => {
    // Post-merge commits: the case the ahead-of-merged-pr rule exists for. Still kept.
    assert.equal(mergedAtRecordedHead(OTHER, [{ number: 2, state: 'MERGED', headRefOid: HEAD }]), null);
  });

  test('a reused branch name is not released, because it is a different commit', () => {
    // Same branch name, new work, old merged PR still on record. The name matches and the
    // SHA does not, which is the whole point of deciding on the SHA.
    assert.equal(mergedAtRecordedHead(OTHER, [{ number: 7, state: 'MERGED', headRefOid: HEAD }]), null);
  });

  test('every merged PR on the branch is checked, not just the first', () => {
    const older = { number: 1, state: 'MERGED', headRefOid: HEAD };
    const newer = { number: 9, state: 'MERGED', headRefOid: OTHER };
    assert.equal(mergedAtRecordedHead(HEAD, [newer, older]), older);
  });

  test('a merged PR with no recorded head releases nothing', () => {
    // An older gh, or a forge whose record omits the field. Missing data is not a match:
    // the branch stays kept, which is the same answer as before this rule existed.
    assert.equal(mergedAtRecordedHead(HEAD, [{ number: 2, state: 'MERGED' }]), null);
    assert.equal(mergedAtRecordedHead(HEAD, [{ number: 2, state: 'MERGED', headRefOid: null }]), null);
    assert.equal(mergedAtRecordedHead(HEAD, [{ number: 2, state: 'MERGED', headRefOid: '' }]), null);
  });

  test('a prefix of the merged head is not the merged head', () => {
    // Abbreviated SHAs are everywhere in git output. A prefix match here would release a
    // branch on a substring, so the comparison is whole-value (V-12's shape).
    assert.equal(mergedAtRecordedHead(HEAD.slice(0, 7), [{ number: 2, state: 'MERGED', headRefOid: HEAD }]), null);
    assert.equal(mergedAtRecordedHead(HEAD, [{ number: 2, state: 'MERGED', headRefOid: HEAD.slice(0, 7) }]), null);
  });

  test('an unusable branch SHA or PR list releases nothing', () => {
    assert.equal(mergedAtRecordedHead('', [{ number: 2, state: 'MERGED', headRefOid: HEAD }]), null);
    assert.equal(mergedAtRecordedHead(null, [{ number: 2, state: 'MERGED', headRefOid: HEAD }]), null);
    assert.equal(mergedAtRecordedHead(HEAD, []), null);
    assert.equal(mergedAtRecordedHead(HEAD, null), null);
    assert.equal(mergedAtRecordedHead(HEAD, undefined), null);
  });

  test('the script asks the forge for the head SHA it merged', () => {
    // The rule cannot fire on data that was never requested. This pins the gh query, which
    // is the one part of the join a unit test cannot reach.
    const source = readFileSync(SCRIPT, 'utf8');
    assert.match(source, /'pr', 'list'[\s\S]*?headRefOid/);
  });

  test('a squash-classified branch is re-verified on head identity, not on cherry', () => {
    // Re-running the cherry check at delete time would refuse every branch this rule
    // releases, by construction — the classification would say merged and the delete step
    // would skip it, and the tool would still delete nothing.
    const source = readFileSync(SCRIPT, 'utf8');
    assert.match(source, /if \(r\.mergedHeadOid\)/);
    assert.match(source, /head moved to/);
  });

  test('importing the script does not classify anything', () => {
    // The export only exists because the tests need it. If the import ran main(), it would
    // run against this repository, and every test in this file would be sitting downstream
    // of a real branch classification.
    const source = readFileSync(SCRIPT, 'utf8');
    assert.doesNotMatch(source, /^main\(\);$/m);
    assert.match(source, /fileURLToPath\(import\.meta\.url\)\) main\(\);/);
  });
});

// ---------------------------------------------------------------------------
// P4.4 — a refused delete names the cause git gave, and the worktree holding
// the branch when one does
// ---------------------------------------------------------------------------

/** What the script itself would resolve `git worktree list --porcelain` to for `branch`. */
function worktreePathFor(dir, branch) {
  const out = git(dir, ['worktree', 'list', '--porcelain']);
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim();
    else if (line.trim() === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

describe('a refused delete reports why, and where, instead of a generic message', () => {
  test('a branch held by a second worktree fails with that worktree named', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/held' }, { name: 'feat/wip', ahead: true }] });
    const wtDir = path.join(tempDir(), 'wt-held');
    git(dir, ['worktree', 'add', '-q', wtDir, 'feat/held']);
    const expectedPath = worktreePathFor(dir, 'feat/held');
    assert.ok(expectedPath, 'test setup: the new worktree must map back to feat/held');

    const r = run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FAILED feat\/held \(git branch -d refused: /);
    // git's own reason is present, not a paraphrase of it.
    assert.match(r.stdout, /cannot delete branch 'feat\/held'/);
    // and the worktree is named, resolved the same way the script resolves it.
    assert.ok(r.stdout.includes(expectedPath), `expected worktree path in:\n${r.stdout}`);
    assert.match(r.stdout, /left intact/);
    assert.ok(branchesIn(dir).includes('feat/held'), 'the branch must survive the refused delete');
  });

  test('a failure from another cause reports git\'s stderr and does not claim a worktree', () => {
    // A ref-lock file reproduces a real, deterministic `git branch -d` failure that has
    // nothing to do with worktrees: git refuses because the ref is (apparently) locked by
    // another process.
    const dir = makeRepo({ branches: [{ name: 'locked' }, { name: 'feat/wip', ahead: true }] });
    writeFileSync(path.join(dir, '.git', 'refs', 'heads', 'locked.lock'), '');

    const r = run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /FAILED locked \(git branch -d refused: /);
    assert.match(r.stdout, /cannot lock ref 'refs\/heads\/locked'/);
    assert.doesNotMatch(r.stdout, /checked out in worktree/);
    assert.match(r.stdout, /left intact/);
    assert.ok(branchesIn(dir).includes('locked'), 'the branch must survive the refused delete');
  });

  test('the success path message is unchanged', () => {
    const dir = makeRepo({ branches: [{ name: 'feat/merged' }, { name: 'feat/wip', ahead: true }] });
    const r = run(dir, ['--apply', '--yes', '--delete-merged']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /delete feat\/merged {2}\(git branch -d\)/);
    assert.doesNotMatch(r.stdout, /FAILED/);
  });
});

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
