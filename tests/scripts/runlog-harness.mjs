// The one way the tests invoke plugin/scripts/runlog.mjs, and the guard that catches it
// reaching this repository (issue #21, L-03).
//
// WHAT WENT WRONG. runlog.mjs is a CLI: `open` finds the project root by walking up from
// `process.cwd()`. The previous harness ran it in a worker thread and pointed it at a
// fixture by calling `process.chdir()` around each call. A worker shares the process's
// working directory — there is no per-worker cwd — so the fixture was selected by mutating
// state belonging to the whole test process, and the file said out loud that its
// correctness rested on node:test running the cases in a file one at a time. It leaked 34
// run directories into the operator's real `logs/` during the pull request that introduced
// it, silently, including one from the test that asserts `open` REFUSES to run where there
// is no project root.
//
// THE SEAM. L-03 says an environment-variable seam is required, because in-process
// monkeypatching never reaches a subprocess CLI child. runlog.mjs honours AEO_RUNLOG_CWD
// as the starting point of its root-walk, and every worker thread here carries its own
// copy of the environment — so the fixture directory arrives per worker, through state
// that belongs to that worker alone, and nothing anywhere calls process.chdir().
//
// A first version of this file used `spawnSync(..., { cwd })` as the seam instead — a
// child process takes the working directory as a per-child argument, which costs
// runlog.mjs no env var. It was measured and rejected: a bare `node -e "1"` costs
// 300-1200ms on this machine depending on antivirus load, every root-resolving call paid
// it, and this file is in the fast tier, run on every commit to this repo. A worker
// thread costs ~90ms.
// The env var is the price of keeping the fast tier fast, and it moves only where the
// walk starts; `spawnRunlog` below keeps real-child coverage where a test exercises the
// CLI the way a lane invokes it.
//
// WHY BOTH RUNLOG TEST FILES IMPORT THIS. tests/scripts/runlog-worker.test.mjs copied the
// old runner rather than sharing it, and declared the duplication a tripwire justified by
// "test scaffolding, not resolution logic". The scaffolding is what reached live data, so
// there is one copy now.
//
// THE GUARD. Every invocation, and the end of the file, checks that no new directory has
// appeared under the `logs/` this repository actually writes to. It watches TWO paths,
// because they are not always the same one: from a linked worktree `runlog open` now
// writes to the worktree's own logs (#36) while projectAnchor() still resolves through
// `.git` to the MAIN checkout, and both are places a leak can land. Watching only one is
// how this leak stayed invisible.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { after } from 'node:test';

import { projectAnchor } from '../../plugin/hooks/sentinel.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

/** The script under test. */
export const RUNLOG = path.join(repoRoot, 'plugin', 'scripts', 'runlog.mjs');

/**
 * The `logs/` directories a leak from these tests could land in.
 *
 * Two, not one, and deduplicated when they coincide. In the main checkout they are the
 * same directory. In a linked worktree they are not: projectAnchor() reads the worktree's
 * `.git` file and returns the main checkout, so `runlog open` run from a worktree writes
 * into the main checkout's logs. A guard scoped to "this checkout" is blind exactly where
 * the work happens.
 */
export const WATCHED_LOG_DIRS = [
  ...new Set([path.join(repoRoot, 'logs'), path.join(projectAnchor(repoRoot) ?? repoRoot, 'logs')]),
];

/** The entries present in each of `dirs` right now. A missing directory reads as empty. */
export function snapshotLogDirs(dirs) {
  const snapshot = new Map();
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      entries = [];
    }
    snapshot.set(dir, new Set(entries));
  }
  return snapshot;
}

/** Absolute paths of everything that has appeared in the snapshotted directories since. */
export function leaksSince(snapshot) {
  const found = [];
  for (const [dir, before] of snapshot) {
    for (const name of snapshotLogDirs([dir]).get(dir)) {
      if (!before.has(name)) found.push(path.join(dir, name));
    }
  }
  return found;
}

const BASELINE = snapshotLogDirs(WATCHED_LOG_DIRS);

/**
 * Fail loudly if anything has appeared in this repository's logs.
 *
 * Called after every invocation rather than only at the end of the file, so the failure
 * names the call that leaked instead of the file that contained it. A readdir of a
 * few dozen entries is far below the cost of the invocation it follows.
 */
export function assertNoLogLeak(context) {
  const leaked = leaksSince(BASELINE);
  if (leaked.length === 0) return;
  throw new Error(
    `runlog wrote into this repository's logs (${context}):\n` +
      leaked.map((p) => `  ${p}`).join('\n') +
      '\nA test must never resolve to the operator\'s project root (L-03). ' +
      'Delete those directories, then find the call that ran without a fixture working directory.',
  );
}

const scratch = [];

after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
  assertNoLogLeak('end of file');
});

/** A throwaway directory, removed when the file finishes. */
export function tempDir(prefix = 'aeo-runlog-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * A directory `projectAnchor` resolves to without touching git: it looks for `.aeo/runs`
 * before it looks for `.git`. Using that instead of `git init` keeps both runlog test
 * files in the fast lane — no subprocess git, no repository fixture.
 */
export function makeAnchor(prefix = 'aeo-runlog-anchor-') {
  const dir = tempDir(prefix);
  mkdirSync(path.join(dir, '.aeo', 'runs'), { recursive: true });
  return dir;
}

/** Whether the argv names a `--dir`, scanned exactly the way runlog.mjs's `flag()` does. */
function namesDir(args) {
  return args.indexOf('--dir') !== -1;
}

/** Run runlog.mjs as a real child process, the way a lane invokes it. */
export function spawnRunlog(args, { cwd } = {}) {
  const r = spawnSync(process.execPath, [RUNLOG, ...args], { encoding: 'utf8', cwd, windowsHide: true });
  const result = { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  assertNoLogLeak(`node runlog.mjs ${args.join(' ')}`);
  return result;
}

/**
 * Run runlog.mjs in a worker thread. When `cwd` is given it travels as AEO_RUNLOG_CWD in
 * the worker's own copy of the environment — per-worker state, never the process's.
 */
async function workerRunlog(args, cwd) {
  const env = cwd === undefined ? process.env : { ...process.env, AEO_RUNLOG_CWD: cwd };
  const result = await new Promise((resolve) => {
    const worker = new Worker(RUNLOG, { argv: args, stdout: true, stderr: true, env });
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
  assertNoLogLeak(`runlog ${args.join(' ')}`);
  return result;
}

/**
 * Run runlog.mjs in a worker thread, with `cwd` carried per worker through the seam.
 *
 * `cwd` is REQUIRED on a call with no `--dir`, and there is deliberately no default:
 * defaulting to the process's working directory is the mistake this file exists to
 * prevent, because that default is this repository. On a call that does name a `--dir`,
 * `cwd` is accepted and unused — such a call reaches nothing the working directory could
 * point at — and every call site passes one anyway so that reading the tests never
 * requires knowing which branch a given call takes.
 */
export async function runlog(args, { cwd } = {}) {
  if (namesDir(args)) return workerRunlog(args, cwd);
  if (cwd === undefined) {
    throw new Error(
      `runlog(${JSON.stringify(args)}) names no --dir, so it resolves a project root from its working ` +
        'directory. Pass { cwd: makeAnchor() }; there is no default, because the default is this repository.',
    );
  }
  return workerRunlog(args, cwd);
}
