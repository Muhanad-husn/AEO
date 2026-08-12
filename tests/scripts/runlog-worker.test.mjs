// Tests for `runlog worker` — the run-scoped write path operation workers get (P5.4).
//
//   node --test tests/scripts/runlog-worker.test.mjs
//
// WHAT IS BEING PINNED. Operation workers run in numbers the task sets, with no worktree
// and no branch, all writing into one checkout. The one thing that keeps that safe is
// that each worker has a write path belonging to it alone, derived from the run. So the
// property under test is not "the path looks right" but "two workers of one run cannot
// end up writing to the same place, and a worker cannot reach outside the place it was
// given".
//
// THREE CASES THE ISSUE NAMES, in order below: two workers in one run get non-colliding
// paths; a worker writing outside its scope is caught; a worker run started while a
// run-in-progress sentinel is live behaves as specified. The third is the interesting
// one — the specified behaviour is that workers are unaffected and the run's single
// commit is not, which is why both halves are asserted in the same test rather than the
// sentinel case being written as "it blocks".
//
// HOW IT RUNS. Same shape as tests/scripts/runlog.test.mjs: runlog.mjs is a CLI, so it is
// exercised as a script that reads argv and the working directory, in a worker thread
// rather than a child process (about 42ms against about 277ms on this machine). The
// runner and the anchor helper are copied rather than shared: they are twenty lines of
// test scaffolding, and the thing that actually must not drift — the path resolution
// itself — lives in one function in runlog.mjs and is imported by nobody twice.
//
// The last block spawns a real child process once, because "nothing here is sensitive to
// the process boundary" is a claim and an end-to-end call is what pays for it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runInProgress, sentinelDir } from '../../plugin/hooks/sentinel.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const RUNLOG = path.join(repoRoot, 'plugin', 'scripts', 'runlog.mjs');

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

function tempDir(prefix = 'aeo-worker-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A directory `projectAnchor` resolves to without touching git — `.aeo/runs` is enough. */
function makeAnchor() {
  const dir = tempDir('aeo-worker-anchor-');
  mkdirSync(path.join(dir, '.aeo', 'runs'), { recursive: true });
  return dir;
}

/** Run runlog.mjs in a worker thread. Same argv, same cwd, same exit code and streams. */
async function runlog(args, { cwd } = {}) {
  const previous = process.cwd();
  if (cwd) process.chdir(cwd);
  try {
    // Awaited inside the try: the worker reads process.cwd() while it runs, so the
    // directory has to stay changed until it has exited.
    return await new Promise((resolve) => {
      const worker = new Worker(RUNLOG, { argv: args, stdout: true, stderr: true });
      let stdout = '';
      let stderr = '';
      worker.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      worker.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      worker.on('error', (err) => resolve({ status: 1, stdout, stderr: `${stderr}${err}` }));
      worker.on('exit', (status) => resolve({ status, stdout, stderr }));
    });
  } finally {
    process.chdir(previous);
  }
}

/** An opened run, and the anchor it lives under. */
async function openedRun(job = 'workers') {
  const anchor = makeAnchor();
  const r = await runlog(['open', '--job', job, '--date', '2026-08-12'], { cwd: anchor });
  assert.equal(r.status, 0, r.stderr);
  return { anchor, dir: r.stdout.trim() };
}

/**
 * Claim a worker's scope and return the printed path.
 *
 * The trailing newline is stripped, not trimmed. A path is whitespace-significant, and
 * trimming one read off stdout is how a scope belonging to one worker turns into another
 * worker's — the failure this whole file is about, one layer out.
 */
async function claim(anchor, dir, worker) {
  const r = await runlog(['worker', '--dir', dir, '--worker', worker], { cwd: anchor });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\r?\n$/, '');
}

// ---------------------------------------------------------------------------
// Two workers in one run get non-colliding paths
// ---------------------------------------------------------------------------

describe('scopes do not collide', () => {
  test('two workers of one run get different directories, neither inside the other', async () => {
    const { anchor, dir } = await openedRun();
    const a = await claim(anchor, dir, 'w1');
    const b = await claim(anchor, dir, 'w2');

    assert.notEqual(a, b);
    assert.equal(existsSync(a), true);
    assert.equal(existsSync(b), true);
    // Not a string-prefix test: `w1` is a prefix of `w10` as text and neither contains
    // the other as a directory.
    assert.ok(path.relative(a, b).startsWith('..'), `${b} resolves inside ${a}`);
    assert.ok(path.relative(b, a).startsWith('..'), `${a} resolves inside ${b}`);

    // And the paths are usable: two workers writing the same filename do not meet.
    writeFileSync(path.join(a, 'out.txt'), 'from w1', 'utf8');
    writeFileSync(path.join(b, 'out.txt'), 'from w2', 'utf8');
    assert.equal(existsSync(path.join(a, 'out.txt')), true);
    assert.equal(existsSync(path.join(b, 'out.txt')), true);
  });

  test('ids that differ only in punctuation still get their own directory', async () => {
    // A resolver that sanitized ids into a filename-safe stem would fold `w1` and `w.1`
    // together and hand two workers one scope, silently. The mapping from id to
    // directory name is identity, so distinct ids are distinct directories.
    const { anchor, dir } = await openedRun('punctuation');
    const a = await claim(anchor, dir, 'w1');
    const b = await claim(anchor, dir, 'w.1');
    const c = await claim(anchor, dir, 'w_1');
    assert.equal(new Set([a, b, c]).size, 3, `${[a, b, c].join(' ')} are not three distinct paths`);
  });

  test('a scope already claimed in this run is refused rather than shared', async () => {
    // The claim is a non-recursive mkdir, so the filesystem itself decides the race. A
    // second worker handed the same id is told, not quietly pointed at the first one's
    // directory.
    const { anchor, dir } = await openedRun('twice');
    await claim(anchor, dir, 'w1');
    const again = await runlog(['worker', '--dir', dir, '--worker', 'w1'], { cwd: anchor });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already claimed/i);
  });

  // The regression test for the review finding. `workerScope` accepts all of these as
  // single directory names, and it is right to: they differ as strings. What folds them
  // is the FILESYSTEM — Windows compares case-insensitively and drops trailing spaces and
  // dots — and `--path` used to ask `existsSync`, which answers yes for every one of them
  // and handed each a path inside whichever spelling claimed first. Two honest workers,
  // ordinary ids, one directory, no warning.
  //
  // Both tests below hold on every platform, which is why neither asserts "W1 is
  // refused": on a case-sensitive filesystem `W1` is a different name and claiming it is
  // correct. What must never happen anywhere is reaching a directory claimed under a
  // different id, and that is what is asserted. Measured on Windows/NTFS, for the record,
  // because the behaviour is not what either the case-folding story or the
  // trailing-space-stripping story predicts: `W1` and `W1 ` are refused EEXIST by case
  // folding, while `w1 `, ` w1` and `w1.` are created as genuinely distinct directories —
  // Node reaches the filesystem through extended-length paths, which bypass the Win32
  // trailing-space rule — and `w1\t` is refused EINVAL as an illegal name.
  const NEAR_MISSES = ['W1', 'w1 ', ' w1', 'W1 ', 'w1.', 'w1\t'];

  test('--path never resolves into a directory claimed under a different spelling', async () => {
    const { anchor, dir } = await openedRun('near-miss-path');
    const held = await claim(anchor, dir, 'w1');
    writeFileSync(path.join(held, 'result.md'), 'w1 wrote this', 'utf8');

    for (const other of NEAR_MISSES) {
      const r = await runlog(['worker', '--dir', dir, '--worker', other, '--path', 'result.md'], { cwd: anchor });
      // None of these claimed anything, so a resolved path is always wrong — whether the
      // filesystem folds the name or not.
      assert.notEqual(r.status, 0, `--path accepted unclaimed id ${JSON.stringify(other)} -> ${r.stdout}`);
    }

    assert.equal(readFileSync(path.join(held, 'result.md'), 'utf8'), 'w1 wrote this', "w1's output was overwritten");
  });

  test('a near-miss spelling either fails to claim or gets a directory of its own', async () => {
    const { anchor, dir } = await openedRun('near-miss-claim');
    const held = await claim(anchor, dir, 'w1');
    writeFileSync(path.join(held, 'result.md'), 'w1 wrote this', 'utf8');

    for (const other of NEAR_MISSES) {
      const r = await runlog(['worker', '--dir', dir, '--worker', other], { cwd: anchor });
      if (r.status === 0) {
        // Legitimate where the filesystem keeps the names apart. What it must not be is
        // w1's directory under another name. Read WITHOUT trim: trimming the printed path
        // is itself the bug one layer out, and it is what made the first version of this
        // test lie.
        const scope = r.stdout.replace(/\r?\n$/, '');
        assert.equal(
          existsSync(path.join(scope, 'result.md')),
          false,
          `${JSON.stringify(other)} claimed successfully and landed in w1's directory at ${JSON.stringify(scope)}`,
        );
      } else {
        assert.match(
          r.stderr,
          /already claimed|must not begin or end with whitespace|could not create/i,
          `${JSON.stringify(other)} failed for the wrong reason: ${r.stderr}`,
        );
      }
    }
  });

  test('an id with outer whitespace is refused rather than trimmed into another id', async () => {
    // The rule exists because the printed path has to survive being read back. `w1 ` is a
    // usable directory name on this filesystem, but `scope=$(...)` and `.trim()` both hand
    // it back as `w1`'s path — so accepting it would put the collision one layer out,
    // where nothing checks. A refusal never merges two ids; a trim would.
    const { anchor, dir } = await openedRun('outer-space');
    const held = await claim(anchor, dir, 'w1');
    writeFileSync(path.join(held, 'result.md'), 'w1 wrote this', 'utf8');

    for (const id of ['w1 ', ' w1', 'w1\t', '\tw1', 'w2 ']) {
      const r = await runlog(['worker', '--dir', dir, '--worker', id], { cwd: anchor });
      assert.notEqual(r.status, 0, `${JSON.stringify(id)} was accepted`);
      assert.match(r.stderr, /whitespace/i, `${JSON.stringify(id)} failed for the wrong reason: ${r.stderr}`);
    }
    assert.equal(readFileSync(path.join(held, 'result.md'), 'utf8'), 'w1 wrote this');
  });

  test('a case-folded id is refused where the filesystem folds case, and names the holder as spelled on disk', async () => {
    // Skipped where `W1` is genuinely a different directory, because there the correct
    // behaviour is to claim it.
    const { anchor, dir } = await openedRun('case-fold');
    await claim(anchor, dir, 'w1');
    const r = await runlog(['worker', '--dir', dir, '--worker', 'W1'], { cwd: anchor });
    if (r.status === 0) return; // case-sensitive filesystem: a distinct id, correctly claimed
    assert.match(r.stderr, /already claimed/i);
    // The refusal prints the on-disk spelling, not the caller's. Printing `...\W1` would
    // send whoever diagnoses this looking for a directory that does not exist under that
    // name.
    assert.match(r.stderr, /[\\/]w1\b/, `the refusal did not name the on-disk holder: ${r.stderr}`);
    assert.ok(!/[\\/]W1\b/.test(r.stderr), `the refusal echoed the caller's spelling: ${r.stderr}`);
  });

  test('the same worker id in a different run is a different path', async () => {
    const first = await openedRun('same-id');
    const second = await openedRun('same-id');
    const a = await claim(first.anchor, first.dir, 'w1');
    const b = await claim(second.anchor, second.dir, 'w1');
    assert.notEqual(a, b);
  });

  test('the scope lands under the run directory the run log opened', async () => {
    const { anchor, dir } = await openedRun('placement');
    const scope = await claim(anchor, dir, 'w1');
    assert.ok(scope.startsWith(dir + path.sep), `${scope} is not under ${dir}`);
  });

  test('a directory the run log never opened is refused', async () => {
    // "Derived from the run" is the safety property. A path someone invented is not a
    // run, and a scope under it would belong to nothing.
    const anchor = makeAnchor();
    const invented = path.join(anchor, 'logs', '2026-08-12-not-a-run');
    mkdirSync(invented, { recursive: true });
    const r = await runlog(['worker', '--dir', invented, '--worker', 'w1'], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /run\.jsonl/);
  });
});

// ---------------------------------------------------------------------------
// A write outside the scope is caught
// ---------------------------------------------------------------------------

describe('a path outside the scope is refused', () => {
  test('a relative path resolving into a sibling worker is refused', async () => {
    const { anchor, dir } = await openedRun('escape');
    await claim(anchor, dir, 'w1');
    await claim(anchor, dir, 'w2');
    const r = await runlog(
      ['worker', '--dir', dir, '--worker', 'w1', '--path', path.join('..', 'w2', 'steal.txt')],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /outside/i);
    assert.equal(existsSync(path.join(dir, 'workers', 'w2', 'steal.txt')), false);
  });

  test('a relative path climbing out of the run entirely is refused', async () => {
    const { anchor, dir } = await openedRun('climb');
    await claim(anchor, dir, 'w1');
    const r = await runlog(
      ['worker', '--dir', dir, '--worker', 'w1', '--path', '../../../../src/index.js'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /outside/i);
  });

  test('an absolute path is refused even though it names a real place', async () => {
    const { anchor, dir } = await openedRun('absolute');
    await claim(anchor, dir, 'w1');
    const r = await runlog(['worker', '--dir', dir, '--worker', 'w1', '--path', anchor], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /outside/i);
  });

  test('a worker id that is not a single directory name is refused', async () => {
    const { anchor, dir } = await openedRun('bad-id');
    // `w1<sep>` is built with path.sep rather than a literal backslash: on POSIX a
    // backslash is an ordinary filename character and `w1\` is a perfectly good id, so
    // hard-coding one would assert a Windows fact on every platform.
    const bad = ['..', '.', path.join('a', 'b'), path.join('..', 'elsewhere'), `w1${path.sep}`];
    for (const id of bad) {
      const r = await runlog(['worker', '--dir', dir, '--worker', id], { cwd: anchor });
      assert.notEqual(r.status, 0, `${JSON.stringify(id)} was accepted as a worker id`);
      assert.match(r.stderr, /worker id/i);
    }
  });

  test('a path inside the scope is resolved, and its parent directory is created', async () => {
    // The positive control. A refusal-only test pins that the guard says no, not that the
    // mechanism is usable.
    const { anchor, dir } = await openedRun('inside');
    const scope = await claim(anchor, dir, 'w1');
    const r = await runlog(
      ['worker', '--dir', dir, '--worker', 'w1', '--path', path.join('notes', 'found.md')],
      { cwd: anchor },
    );
    assert.equal(r.status, 0, r.stderr);
    const resolved = r.stdout.trim();
    assert.equal(resolved, path.join(scope, 'notes', 'found.md'));
    assert.equal(existsSync(path.dirname(resolved)), true, 'the parent directory was not created');
    assert.equal(existsSync(resolved), false, 'resolving a path must not create the file itself');
    writeFileSync(resolved, 'ok', 'utf8');
    assert.equal(existsSync(resolved), true);
  });

  test('--path against a scope nobody claimed is refused', async () => {
    const { anchor, dir } = await openedRun('unclaimed');
    const r = await runlog(['worker', '--dir', dir, '--worker', 'ghost', '--path', 'out.txt'], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /claim/i);
  });
});

// ---------------------------------------------------------------------------
// A live run-in-progress sentinel
// ---------------------------------------------------------------------------

describe('a worker run started while a sentinel is live', () => {
  /** Raise a sentinel this machine will read as live: our own pid, our own hostname. */
  function raiseLiveSentinel(anchor, id = 'corpus-ingest') {
    const file = path.join(sentinelDir(anchor), `${id}.json`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({ what: 'a long job', started: new Date().toISOString(), pid: process.pid, host: os.hostname() }),
      'utf8',
    );
    return file;
  }

  // THE SPECIFIED BEHAVIOUR, in one sentence: a live sentinel does not stop operation
  // workers from being dispatched or from writing into their run-scoped paths, because
  // those write files and execute nothing; it stops the single commit at the end of the
  // run, which is subject to the commit gate exactly as any other commit is, so a batch
  // of mechanical work started during a long job completes and then waits, uncommitted,
  // until that job's sentinel clears.
  test('workers still get scopes and can write into them', async () => {
    const { anchor, dir } = await openedRun('during-a-long-job');
    raiseLiveSentinel(anchor);

    const scope = await claim(anchor, dir, 'w1');
    writeFileSync(path.join(scope, 'out.txt'), 'work done during a live run', 'utf8');
    assert.equal(existsSync(path.join(scope, 'out.txt')), true);

    const inside = await runlog(['worker', '--dir', dir, '--worker', 'w1', '--path', 'notes.md'], { cwd: anchor });
    assert.equal(inside.status, 0, inside.stderr);
  });

  test('a whole worker run leaves the sentinel its commit must wait on standing', async () => {
    // Asserted through runInProgress(), the exact predicate the commit gate calls
    // (plugin/hooks/commit-gate.mjs); spawning the gate itself belongs to the integration
    // tier. The run is driven end to end first, because the claim worth pinning is not
    // "a live sentinel blocks" — that is sentinel.mjs's own behaviour and it has its own
    // tests — but that nothing THIS lane does clears the sentinel or exempts its commit
    // from it. An earlier version asserted only the former and passed with the whole
    // slice deleted.
    const job = 'blocked-commit';
    const { anchor, dir } = await openedRun(job);
    assert.equal(runInProgress(anchor).reason, null, 'the anchor was not clear before the sentinel went up');
    raiseLiveSentinel(anchor);

    for (const id of ['w1', 'w2']) {
      const scope = await claim(anchor, dir, id);
      writeFileSync(path.join(scope, 'out.txt'), id, 'utf8');
      const resolved = await runlog(['worker', '--dir', dir, '--worker', id, '--path', 'notes/n.md'], { cwd: anchor });
      assert.equal(resolved.status, 0, resolved.stderr);
      const rec = await runlog(
        ['record', '--dir', dir, '--job', job, '--unit', id, '--status', 'ok'],
        { cwd: anchor },
      );
      assert.equal(rec.status, 0, rec.stderr);
    }
    const closed = await runlog(['close', '--dir', dir, '--job', job, '--status', 'ok'], { cwd: anchor });
    assert.equal(closed.status, 0, closed.stderr);

    const blocked = runInProgress(anchor);
    assert.notEqual(blocked.reason, null, 'the worker run cleared or exempted the live sentinel');
    assert.match(blocked.reason, /long job is running/);
  });

  test('a worker run raises no sentinel of its own', async () => {
    // Workers execute no test suite, so a worker run is not a long job and must not
    // become one. If it raised a sentinel, every other session's commits would block for
    // the duration of a batch of mechanical edits.
    const { anchor, dir } = await openedRun('no-sentinel');
    await claim(anchor, dir, 'w1');
    await claim(anchor, dir, 'w2');
    assert.equal(runInProgress(anchor).reason, null, 'a worker run raised something that blocks commits');
  });
});

// ---------------------------------------------------------------------------
// End to end, as a real child process
// ---------------------------------------------------------------------------

describe('as a child process, the way a dispatched worker invokes it', () => {
  test('open, claim two scopes, resolve a path in one, refuse a path out of it', async () => {
    const anchor = makeAnchor();
    const spawnRunlog = (args) =>
      spawnSync(process.execPath, [RUNLOG, ...args], { encoding: 'utf8', cwd: anchor, windowsHide: true });

    const opened = spawnRunlog(['open', '--job', 'child', '--date', '2026-08-12']);
    assert.equal(opened.status, 0, opened.stderr);
    const dir = opened.stdout.trim();

    const one = spawnRunlog(['worker', '--dir', dir, '--worker', 'w1']);
    const two = spawnRunlog(['worker', '--dir', dir, '--worker', 'w2']);
    assert.equal(one.status, 0, one.stderr);
    assert.equal(two.status, 0, two.stderr);
    assert.notEqual(one.stdout.trim(), two.stdout.trim());

    const good = spawnRunlog(['worker', '--dir', dir, '--worker', 'w1', '--path', 'report.md']);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stdout.trim(), path.join(one.stdout.trim(), 'report.md'));

    const bad = spawnRunlog(['worker', '--dir', dir, '--worker', 'w1', '--path', path.join('..', 'w2', 'report.md')]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /outside/i);
  });

  test('the usage line names the worker subcommand', () => {
    const r = spawnSync(process.execPath, [RUNLOG, 'nonsense'], { encoding: 'utf8', windowsHide: true });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /worker/);
  });
});
