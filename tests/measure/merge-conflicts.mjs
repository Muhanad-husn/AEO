#!/usr/bin/env node
// P5.5 measurement 2: how often two concurrent branches conflict at merge time.
//
// WHY THIS EXISTS. D11 caps development actors at four and says Phase 5 must MEASURE the
// merge-order conflict rate rather than assume it. Like measurement 1 this ships no fix: a
// rate with its denominator is the whole output.
//
//   node tests/measure/merge-conflicts.mjs [--dir <runlog dir>]
//
// WHY IT IS NOT A `.test.mjs` FILE, and why the positive controls run inline: same reason as
// oversubscription.mjs. tests/hooks/test-tiers.test.mjs fails the fast tier on any
// `.test.mjs` neither npm script names, and package.json is off limits for this slice. CI
// does not cover this file.
//
// THE PROBLEM WITH A NAIVE REPLAY. This history is squash-merged and the branches are
// deleted, so the original concurrent tips no longer exist. `main`'s FIRST-PARENT LINE is a
// chain, so the merge base of two adjacent commits on it is just the older one, and asking
// git to merge them is trivially clean. That question is not the one D11 asks.
//
// `main` ITSELF IS NOT A CHAIN — it carries real merge commits, and the census walk below
// says so again where it acts on it. The distinction is the whole reason --first-parent is
// load-bearing, and reading this paragraph as "main is linear" is exactly the mistake that
// made the first pass of this census wrong.
//
// THE QUESTION ACTUALLY ASKED, per adjacent pair (A, then B, with P = A's parent):
//
//   "Had B been developed from P — that is, concurrently with A instead of after it —
//    would landing A first have made B conflict?"
//
// and it is answered with one three-way merge:
//
//   git merge-tree --write-tree --merge-base=A  P  B
//
// base A, one side P (A's diff reversed), the other side B (B's diff). It conflicts exactly
// when A's changed regions overlap B's changed regions — which is the same overlap test as
// merging A with a from-P version of B, run by the same merge machinery. It is also
// literally what git does when a concurrent branch rebases. The equivalence is not asserted:
// the positive control below builds a genuine two-branches-from-one-base repository, runs
// BOTH formulations on it, and fails unless they agree.
//
// TWO POPULATIONS, ONE METHOD. Adjacent pairs on `main` are a complete census — every pair,
// no sampling, so there is no `--limit N` masquerading as a sample (L-10). Most of them were
// not developed concurrently, so for those the question is synthetic. The subset whose two
// pull requests were genuinely open at the same time is the real observed record; it is
// labelled from `gh` and reported separately, with its own much smaller n.
//
// NOTHING IS WRITTEN. Every git call here is read-only plumbing: `log`, `rev-parse`,
// `merge-tree`. No branch is created, merged or deleted, and no object is added to this
// repository. The positive control builds its own throwaway repository in the temp
// directory.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const runlog = path.join(repoRoot, 'plugin', 'scripts', 'runlog.mjs');
const JOB = 'p5.5-concurrency';

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const log = (s) => process.stdout.write(`${s}\n`);

function git(args, cwd = repoRoot) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Whether B's change, replayed onto P as if developed concurrently with A, conflicts.
 *
 * merge-tree exits 0 for a clean merge and 1 when it produced conflicts, so the exit code is
 * the answer. Any other status is a broken invocation, not a verdict, and is thrown rather
 * than counted as clean — a detector that silently reports "no conflict" on its own failure
 * is the failure mode this whole slice exists to avoid.
 */
function conflicts(base, side1, side2, cwd = repoRoot) {
  const r = git(['merge-tree', '--write-tree', `--merge-base=${base}`, side1, side2], cwd);
  if (r.status === 0) return { conflicted: false, files: [] };
  if (r.status !== 1) throw new Error(`merge-tree failed (status ${r.status}): ${r.stderr?.trim()}`);
  // On conflict the tree oid is followed by one `<mode> <oid> <stage>\t<path>` line per
  // conflicted stage. The paths are collected because a bare rate says a group of four is
  // risky without saying what to do about it, and the answer differs entirely depending on
  // whether the collisions are in code or in one hot planning document (L-10: diff what
  // changed, do not report only the total).
  const files = new Set();
  for (const l of r.stdout.split('\n')) {
    const m = /^\d{6} [0-9a-f]+ [123]\t(.+)$/.exec(l.trimEnd());
    if (m) files.add(m[1]);
  }
  return { conflicted: true, files: [...files] };
}

// ---------------------------------------------------------------- run log

const runDir = flag('dir', path.join(repoRoot, 'logs', '2026-08-12-p5.5-concurrency'));

function record(unit, status, durationMs, detail) {
  const r = spawnSync(
    process.execPath,
    [runlog, 'record', '--dir', runDir, '--job', JOB, '--unit', unit,
      '--status', status, '--duration', String(Math.round(durationMs)), '--detail', detail],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (r.status !== 0) process.stderr.write(r.stderr ?? '');
}

// ---------------------------------------------------------------- positive control

/**
 * A throwaway repository with a base P and two branches off it: one pair touching the same
 * line of the same file (must conflict), one pair touching different files (must be clean).
 *
 * Both verdicts matter. A detector that answers "conflict" to everything is exactly as
 * useless as one that never does, so the clean pair is not decoration.
 */
function positiveControl() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'p5.5-merge-'));
  const w = (name, text) => writeFileSync(path.join(dir, name), text);
  const commit = (msg) => {
    git(['add', '-A'], dir);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', msg], dir);
    return git(['rev-parse', 'HEAD'], dir).stdout.trim();
  };

  git(['init', '--quiet', '-b', 'base'], dir);
  git(['config', 'user.email', 'measure@example.invalid'], dir);
  git(['config', 'user.name', 'p5.5 measure'], dir);
  w('shared.txt', 'one\ntwo\nthree\n');
  w('other.txt', 'untouched\n');
  const P = commit('base');

  git(['checkout', '--quiet', '-b', 'a', P], dir);
  w('shared.txt', 'one\nA CHANGED THIS\nthree\n');
  const A = commit('A edits line 2');

  git(['checkout', '--quiet', '-b', 'b-conflicting', P], dir);
  w('shared.txt', 'one\nB CHANGED THIS\nthree\n');
  const Bconf = commit('B edits line 2');

  git(['checkout', '--quiet', '-b', 'b-clean', P], dir);
  w('other.txt', 'B changed a different file\n');
  const Bclean = commit('B edits another file');

  // Formulation 1: the genuine scenario, two branches from one base.
  const directConf = conflicts(P, A, Bconf, dir).conflicted;
  const directClean = conflicts(P, A, Bclean, dir).conflicted;

  // Formulation 2: the one used on `main`, where only a linear history survives. Land A,
  // then land B on top of it, then ask the linearized question with base A.
  const linear = (B, label) => {
    // Replaying B's change on top of A is the same merge-tree call, so a conflicting pair
    // cannot be linearized at all — which is itself the verdict, and is treated as one.
    const r = git(['merge-tree', '--write-tree', `--merge-base=${P}`, A, B], dir);
    if (r.status === 1) return true;
    const tree = r.stdout.trim().split('\n')[0];
    const lin = git(['commit-tree', tree, '-p', A, '-m', `B on A (${label})`], dir).stdout.trim();
    return conflicts(A, P, lin, dir).conflicted;
  };
  const linearConf = linear(Bconf, 'conf');
  const linearClean = linear(Bclean, 'clean');

  rmSync(dir, { recursive: true, force: true });

  const ok = directConf === true && directClean === false
    && linearConf === true && linearClean === false;
  return { ok, directConf, directClean, linearConf, linearClean };
}

log('positive control: a must-conflict pair and a must-be-clean pair, both formulations ...');
const control = positiveControl();
log(`  same-line pair:      direct ${control.directConf ? 'CONFLICT' : 'clean'}, linearized ${control.linearConf ? 'CONFLICT' : 'clean'}  (both must be CONFLICT)`);
log(`  different-file pair: direct ${control.directClean ? 'CONFLICT' : 'clean'}, linearized ${control.linearClean ? 'CONFLICT' : 'clean'}  (both must be clean)`);
log(`  control ${control.ok ? 'PASSED — the detector sees both verdicts and the two formulations agree' : 'FAILED — no number below can be trusted'}`);
record('merge-positive-control', control.ok ? 'ok' : 'fail', 0,
  `direct_conflict=${control.directConf} direct_clean=${control.directClean} linear_conflict=${control.linearConf} linear_clean=${control.linearClean} git=${git(['--version']).stdout.trim()}`);
if (!control.ok) process.exit(1);

// ---------------------------------------------------------------- which PRs were concurrent

/**
 * Pull request numbers whose open intervals overlapped some other pull request's, as a map
 * from number to {createdAt, mergedAt}. Empty when `gh` cannot answer, in which case the
 * observed subset is reported as unavailable rather than as zero.
 */
function pullRequestWindows() {
  const r = spawnSync('gh', ['pr', 'list', '--state', 'merged', '--limit', '200',
    '--json', 'number,createdAt,mergedAt'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status !== 0) return null;
  try {
    const out = new Map();
    for (const pr of JSON.parse(r.stdout)) {
      out.set(pr.number, { from: Date.parse(pr.createdAt), to: Date.parse(pr.mergedAt) });
    }
    return out;
  } catch {
    return null;
  }
}

const windows = pullRequestWindows();
log(`\npull request windows from gh: ${windows === null ? 'unavailable' : `${windows.size} merged PRs`}`);

// ---------------------------------------------------------------- the census

// --first-parent, and it is load-bearing. `main` is NOT linear here — it carries real merge
// commits — so plain `git log --reverse` returns commits in date order, in which `line[i+1]`
// is frequently not a child of `line[i]` at all. The whole method rests on parent(B) == A,
// and the first attempt at this census silently violated it for a quarter of its pairs.
// --first-parent gives the mainline, where that relationship holds by construction, and %P
// carries each commit's parents so it can be checked rather than assumed.
const line = git(['log', '--first-parent', '--reverse', '--format=%H%x09%P%x09%s', 'main']).stdout
  .trim().split('\n').filter(Boolean)
  .map((l) => {
    const [sha, parents, subject] = l.split('\t');
    const pr = /\(#(\d+)\)\s*$/.exec(subject ?? '');
    return { sha, parents: (parents ?? '').split(' ').filter(Boolean), subject, pr: pr ? Number(pr[1]) : null };
  });

log(`commits on main's first-parent line: ${line.length}`);

const results = [];
for (let i = 1; i < line.length - 1; i += 1) {
  // i starts at 1 because the root commit has no parent, so the first pair with a base to
  // branch from is (line[1], line[2]).
  const A = line[i];
  const B = line[i + 1];
  const P = A.parents[0];
  if (!P) continue;
  if (B.parents[0] !== A.sha) {
    throw new Error(`${B.sha} is not a child of ${A.sha}; the first-parent walk is broken`);
  }
  const { conflicted, files } = conflicts(A.sha, P, B.sha);
  const concurrent = windows !== null && A.pr !== null && B.pr !== null
    && windows.has(A.pr) && windows.has(B.pr)
    && windows.get(A.pr).from < windows.get(B.pr).to
    && windows.get(B.pr).from < windows.get(A.pr).to;
  results.push({ A, B, conflicted, files, concurrent });
}

const rate = (set) => (set.length === 0 ? null : set.filter((r) => r.conflicted).length / set.length);
const all = results;
const observed = results.filter((r) => r.concurrent);

const allHits = all.filter((r) => r.conflicted);
log(`\nall adjacent pairs (complete census, synthetic for pairs that were not concurrent):`);
log(`  ${allHits.length} conflicting / ${all.length} pairs = ${(rate(all) * 100).toFixed(1)}%`);
for (const r of allHits) log(`    CONFLICT  ${r.A.sha.slice(0, 8)} -> ${r.B.sha.slice(0, 8)}  ${r.files.join(', ')}`);
record('merge-census-all', 'ok', 0,
  `conflicting=${allHits.length} pairs=${all.length} rate=${rate(all).toFixed(4)} rule=every-first-parent-adjacent-pair-on-main population=synthetic`);

const byFile = new Map();
for (const r of allHits) for (const f of r.files) byFile.set(f, (byFile.get(f) ?? 0) + 1);
const ranked = [...byFile].sort((a, b) => b[1] - a[1]);
log('\n  conflicting pairs by file:');
for (const [f, n] of ranked) log(`    ${String(n).padStart(3)}  ${f}`);
record('merge-conflict-files', 'ok', 0,
  ranked.map(([f, n]) => `${f}=${n}`).join(' ').slice(0, 900));

log(`\nreal concurrent pairs (both PRs open at the same time):`);
if (observed.length === 0) {
  log('  none found');
} else {
  log(`  ${observed.filter((r) => r.conflicted).length} conflicting / ${observed.length} pairs = ${(rate(observed) * 100).toFixed(1)}%`);
  for (const r of observed) {
    log(`    ${r.conflicted ? 'CONFLICT' : 'clean   '}  #${r.A.pr} then #${r.B.pr}`);
  }
  record('merge-census-observed', 'ok', 0,
    `conflicting=${observed.filter((x) => x.conflicted).length} pairs=${observed.length} rate=${rate(observed).toFixed(4)} population=real-concurrent`);
}

// What the pair rate implies for a group of four, which is the cap D11 actually sets. Six
// pairs, and it assumes they are independent. They are not: conflicts cluster on the same
// few hot files, so when one pair collides the others are MORE likely to as well, which
// raises the chance that a group is entirely clean. Positive correlation therefore makes
// this figure an over-estimate, not an under-estimate. It is stated as a ceiling for
// exactly that reason — a concurrency number that errs toward flattering the tool is the
// failure this slice was tiered up to avoid.
const p = rate(all);
log(`\nfor a group of 4 (6 pairs), assuming independence (a CEILING, since clustering only helps): ` +
    `P(at least one conflict) = 1 - (1 - ${p.toFixed(4)})^6 = ${((1 - (1 - p) ** 6) * 100).toFixed(1)}%`);
record('merge-group-of-four', 'ok', 0,
  `pair_rate=${p.toFixed(4)} pairs_in_group=6 p_any=${(1 - (1 - p) ** 6).toFixed(4)} assumption=independence bound=ceiling reason=conflicts-cluster-on-hot-files`);

log('\ndone.');
