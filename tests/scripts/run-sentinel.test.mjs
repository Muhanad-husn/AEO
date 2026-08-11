// Tests for plugin/scripts/run-sentinel.mjs — the run-in-progress sentinel CLI (P3.5).
//
//   node --test tests/scripts/run-sentinel.test.mjs
//
// Like runlog.test.mjs, this spawns the real CLI as a child process rather than importing
// it: run-sentinel.mjs is a script, not a library, so a subagent can only ever shell out to
// it. Every fixture anchors the project root through `.aeo/runs` (see makeAnchor below)
// rather than `git init`, which is what keeps this in the fast `npm test` lane.
//
// The bug this file guards against: `start --pid <n>` used to record whatever number it was
// given, unchecked. A pid the OS cannot resolve is indistinguishable, downstream, from a pid
// that has exited — so an unresolvable pid made a live job's own sentinel read as stale, and
// the run-in-progress guard failed open exactly when it mattered. `start` now refuses a pid
// that is not alive at the moment the sentinel is raised; everything else (the no-pid
// default, the stale rule in inspectRuns, stop, list) is unchanged and is covered here too.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const RUN_SENTINEL = path.join(repoRoot, 'plugin', 'scripts', 'run-sentinel.mjs');

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

function tempDir(prefix = 'aeo-run-sentinel-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * A directory `projectAnchor` (hooks/sentinel.mjs) resolves to without touching git: it
 * looks for `.aeo/runs` before it looks for `.git`. Using that instead of `git init` is
 * what keeps this file out of the git-touching integration lane.
 */
function makeAnchor() {
  const dir = tempDir('aeo-run-sentinel-anchor-');
  mkdirSync(path.join(dir, '.aeo', 'runs'), { recursive: true });
  return dir;
}

function run(args, { cwd } = {}) {
  const r = spawnSync(process.execPath, [RUN_SENTINEL, ...args], { encoding: 'utf8', cwd, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function sentinelFile(anchor, id) {
  return path.join(anchor, '.aeo', 'runs', `${id}.json`);
}

/**
 * A pid nothing on this machine resolves, found rather than guessed: spawn a real child
 * process and let it exit. `spawnSync` blocks until the child is gone, so its pid is dead by
 * the time this returns, and the check below confirms that directly instead of trusting a
 * hardcoded "surely nobody has this pid" number.
 */
function findDeadPid() {
  const child = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { windowsHide: true });
  const pid = child.pid;
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, `pid ${pid} unexpectedly still resolves on this machine`);
  return pid;
}

// ---------------------------------------------------------------------------
// start --pid: the guard this slice adds
// ---------------------------------------------------------------------------

describe('start --pid', () => {
  test('a live pid is accepted and recorded', () => {
    const anchor = makeAnchor();
    const r = run(['start', 'live-job', '--pid', String(process.pid)], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);

    const file = sentinelFile(anchor, 'live-job');
    assert.equal(existsSync(file), true);
    const record = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(record.pid, process.pid);
  });

  test('a pid nothing resolves is refused: non-zero exit, no file written', () => {
    const anchor = makeAnchor();
    const deadPid = findDeadPid();
    const r = run(['start', 'dead-job', '--pid', String(deadPid)], { cwd: anchor });

    assert.notEqual(r.status, 0);
    assert.equal(existsSync(sentinelFile(anchor, 'dead-job')), false, 'a refused start must not leave a sentinel behind');
    assert.equal(readdirSync(path.join(anchor, '.aeo', 'runs')).length, 0);
  });

  test('the refusal message names the pid', () => {
    const anchor = makeAnchor();
    const deadPid = findDeadPid();
    const r = run(['start', 'dead-job', '--pid', String(deadPid)], { cwd: anchor });
    assert.match(r.stderr, new RegExp(String(deadPid)));
  });

  test('start with no --pid still works and writes pid: null', () => {
    const anchor = makeAnchor();
    const r = run(['start', 'no-pid-job'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);

    const record = JSON.parse(readFileSync(sentinelFile(anchor, 'no-pid-job'), 'utf8'));
    assert.equal(record.pid, null);
  });

  test('a non-numeric --pid still fails the way it does today', () => {
    const anchor = makeAnchor();
    const r = run(['start', 'bad-pid-job', '--pid', 'soon'], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /positive integer/);
    assert.equal(existsSync(sentinelFile(anchor, 'bad-pid-job')), false);
  });

  test('a non-positive --pid still fails the way it does today', () => {
    const anchor = makeAnchor();
    const r = run(['start', 'neg-pid-job', '--pid', '-5'], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /positive integer/);
    assert.equal(existsSync(sentinelFile(anchor, 'neg-pid-job')), false);

    const zero = run(['start', 'zero-pid-job', '--pid', '0'], { cwd: anchor });
    assert.notEqual(zero.status, 0);
    assert.equal(existsSync(sentinelFile(anchor, 'zero-pid-job')), false);
  });
});

// ---------------------------------------------------------------------------
// stop and list: unaffected by this slice
// ---------------------------------------------------------------------------

describe('stop', () => {
  test('clears a sentinel written by start', () => {
    const anchor = makeAnchor();
    run(['start', 'to-clear'], { cwd: anchor });
    assert.equal(existsSync(sentinelFile(anchor, 'to-clear')), true);

    const r = run(['stop', 'to-clear'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(sentinelFile(anchor, 'to-clear')), false);
  });

  test('stopping an id with no sentinel fails', () => {
    const anchor = makeAnchor();
    const r = run(['stop', 'never-started'], { cwd: anchor });
    assert.notEqual(r.status, 0);
  });
});

describe('list', () => {
  test('reports a live pid as LIVE', () => {
    const anchor = makeAnchor();
    run(['start', 'live-job', '--pid', String(process.pid)], { cwd: anchor });

    const r = run(['list'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /LIVE\s+live-job\.json/);
  });

  test('reports a no-pid sentinel as LIVE (no pid means it never expires on its own)', () => {
    const anchor = makeAnchor();
    run(['start', 'no-pid-job'], { cwd: anchor });

    const r = run(['list'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /LIVE\s+no-pid-job\.json/);
  });

  test('reports a hand-written sentinel with a dead pid as stale (inspectRuns is unchanged)', () => {
    const anchor = makeAnchor();
    const deadPid = findDeadPid();
    // start refuses a dead pid; this simulates a sentinel written by something other than
    // this script, which is exactly the case the guard's stale rule still has to cover.
    writeFileSync(
      sentinelFile(anchor, 'hand-written'),
      JSON.stringify({ id: 'hand-written', what: 'x', started: new Date().toISOString(), pid: deadPid, host: os.hostname() }),
    );

    const r = run(['list'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /stale\s+hand-written\.json/);
  });

  test('an empty sentinel directory reports nothing running', () => {
    const anchor = makeAnchor();
    const r = run(['list'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nothing is running/);
  });
});
