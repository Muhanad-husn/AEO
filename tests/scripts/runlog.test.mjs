// Tests for plugin/scripts/runlog.mjs — the run-log CLI (P3.1).
//
//   node --test tests/scripts/runlog.test.mjs
//
// runlog.mjs is a CLI, not a library (a subagent can only shell out to it), so it is
// exercised as a script that reads argv and the working directory, writes files, and
// exits with a status — never by importing a function it does not export.
//
// HOW IT IS INVOKED lives in one place, runlog-harness.mjs, shared with
// tests/scripts/runlog-worker.test.mjs. Read its header for why a call that resolves a
// project root runs as a child process with its own working directory, why nothing here
// calls process.chdir(), and what the leak guard watches. The short version: the previous
// harness selected a fixture by mutating the whole process's working directory, and 34 run
// directories landed in the operator's real logs (issue #21, L-03).
//
// Every fixture anchors the project root through `.aeo/runs` (makeAnchor) rather than
// `git init`, so this stays in the fast `npm test` lane — no subprocess git, no repository
// fixture. The linked-worktree block below is the one exception, and it fabricates the
// `.git` file by hand for the same reason.
//
// THE TWO ANCHORS ARE ASSERTED TOGETHER, in that block, against one fixture. `open` must
// land in the worktree that called it (#36) and the sentinel must still resolve to the
// main checkout (D12), and a change that quietly narrowed the second while fixing the
// first would be the worse defect: sharing sentinels across worktrees is what stops one
// actor's sandbox guard from running the suite alongside another actor's live job (L-02).
//
// The last describe block forces a child process for every call in a full open -> record
// -> close cycle. Most calls above it run in a worker thread, which is what makes the file
// fast, and "the worker is a faithful stand-in for a real process" is a claim rather than
// an observation — the end-to-end block is what pays for it. See
// tests/hooks/sandbox-session.test.mjs for the opposite case: there the boundary *is* the
// behaviour, and every case there spawns.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { projectAnchor } from '../../plugin/hooks/sentinel.mjs';
import { leaksSince, makeAnchor, runlog, snapshotLogDirs, spawnRunlog, tempDir } from './runlog-harness.mjs';

function readLines(file) {
  const text = readFileSync(file, 'utf8');
  return text === '' ? [] : text.split('\n').filter((l) => l !== '');
}

// ---------------------------------------------------------------------------
// open: placement, collisions, opened-but-empty
// ---------------------------------------------------------------------------

describe('open', () => {
  test('creates run.jsonl, console.log and a non-empty summary.md stub', async () => {
    const anchor = makeAnchor();
    const r = await runlog(['open', '--job', 'ingest', '--date', '2026-01-01'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    const dir = r.stdout.trim();
    assert.equal(existsSync(path.join(dir, 'run.jsonl')), true);
    assert.equal(existsSync(path.join(dir, 'console.log')), true);
    assert.equal(existsSync(path.join(dir, 'summary.md')), true);
    assert.ok(readFileSync(path.join(dir, 'summary.md'), 'utf8').length > 0);
  });

  test('lands under the project anchor, not under the working directory (D12)', async () => {
    const anchor = makeAnchor();
    const nested = path.join(anchor, 'nested', 'deep');
    mkdirSync(nested, { recursive: true });
    const r = await runlog(['open', '--job', 'ingest', '--date', '2026-01-01'], { cwd: nested });
    assert.equal(r.status, 0, r.stderr);
    const dir = r.stdout.trim();
    const expectedRoot = path.join(anchor, 'logs');
    assert.ok(dir.startsWith(expectedRoot), `${dir} is not under ${expectedRoot}`);
    assert.ok(
      !dir.startsWith(path.join(nested, 'logs')),
      'logs landed under the working directory instead of the resolved project root',
    );
  });

  test('the directory name is <date>-<job>', async () => {
    const anchor = makeAnchor();
    const r = await runlog(['open', '--job', 'my-job', '--date', '2026-03-04'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(path.basename(r.stdout.trim()), '2026-03-04-my-job');
  });

  test('an opened-but-empty run is distinguishable from no run at all (L-08)', async () => {
    const anchor = makeAnchor();
    const neverOpened = path.join(anchor, 'logs', '2026-01-01-never-opened');
    assert.equal(existsSync(neverOpened), false);

    const r = await runlog(['open', '--job', 'idle', '--date', '2026-01-01'], { cwd: anchor });
    const dir = r.stdout.trim();
    assert.equal(existsSync(dir), true, 'an opened run must exist on disk');
    assert.equal(readFileSync(path.join(dir, 'run.jsonl'), 'utf8'), '', 'a fresh run.jsonl must be empty, not absent');
    assert.equal(existsSync(neverOpened), false, 'a directory nobody opened must still not exist');
  });

  test('a second open of the same job and date does not reuse the first directory', async () => {
    const anchor = makeAnchor();
    const first = (await runlog(['open', '--job', 'twice', '--date', '2026-02-02'], { cwd: anchor })).stdout.trim();
    await runlog(['record', '--dir', first, '--job', 'twice', '--unit', 'a', '--status', 'ok', '--duration', '10'], { cwd: anchor });

    const second = (await runlog(['open', '--job', 'twice', '--date', '2026-02-02'], { cwd: anchor })).stdout.trim();
    assert.notEqual(second, first, "the second open reused the first run's directory");
    assert.equal(path.basename(second), '2026-02-02-twice-2');

    // The first run's own record survives the second open untouched.
    const lines = readLines(path.join(first, 'run.jsonl'));
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).unit, 'a');
  });

  test('a third collision gets -3', async () => {
    const anchor = makeAnchor();
    const dirs = [];
    for (let i = 0; i < 3; i += 1) {
      dirs.push((await runlog(['open', '--job', 'thrice', '--date', '2026-02-02'], { cwd: anchor })).stdout.trim());
    }
    assert.deepEqual(
      dirs.map((d) => path.basename(d)),
      ['2026-02-02-thrice', '2026-02-02-thrice-2', '2026-02-02-thrice-3'],
    );
  });

  test('refuses to run outside a project repository', async () => {
    const outside = tempDir('aeo-runlog-no-anchor-');
    // No .aeo/runs, and (in a fresh OS temp directory) no .git above it either.
    const r = await runlog(['open', '--job', 'x'], { cwd: outside });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no project root/);
  });
});

// ---------------------------------------------------------------------------
// open from a linked worktree: the run log is a work product, the sentinel is shared
// ---------------------------------------------------------------------------

/**
 * A linked worktree and the main checkout it points at, built without running git.
 *
 * A linked worktree IS its `.git` file — the one line naming
 * `<main>/.git/worktrees/<name>` is all either resolver reads — so writing that file is
 * the whole fixture, and it keeps this file in the fast lane with no subprocess git.
 */
function makeLinkedWorktree() {
  const root = tempDir('aeo-runlog-worktree-');
  const main = path.join(root, 'main');
  const worktree = path.join(root, 'wt');
  const gitdir = path.join(main, '.git', 'worktrees', 'wt');
  mkdirSync(gitdir, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitdir}\n`);
  return { main, worktree };
}

describe('open from a linked worktree', () => {
  test('the run log lands in the worktree that opened it, not the main checkout (#36)', async () => {
    const { main, worktree } = makeLinkedWorktree();
    const r = await runlog(['open', '--job', 'slice', '--date', '2026-05-06'], { cwd: worktree });
    assert.equal(r.status, 0, r.stderr);
    const dir = r.stdout.trim();
    assert.ok(
      dir.startsWith(path.join(worktree, 'logs')),
      `${dir} is not under the worktree's own logs at ${path.join(worktree, 'logs')}`,
    );
    assert.equal(
      existsSync(path.join(main, 'logs')),
      false,
      "the run log landed in the main checkout, on whatever branch that checkout has out, outside the worktree's own branch",
    );
  });

  test('the sentinel still anchors to the main checkout from that same worktree (D12, L-02)', () => {
    const { main, worktree } = makeLinkedWorktree();
    assert.equal(
      projectAnchor(worktree),
      main,
      'a linked worktree no longer shares the main checkout\'s sentinels, so one actor\'s sandbox guard can no longer see another actor\'s live run',
    );
  });

  test('a plain checkout still anchors to itself for both', async () => {
    const plain = tempDir('aeo-runlog-plain-');
    mkdirSync(path.join(plain, '.git'), { recursive: true });
    assert.equal(projectAnchor(plain), plain);
    const r = await runlog(['open', '--job', 'plain', '--date', '2026-05-06'], { cwd: plain });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.trim().startsWith(path.join(plain, 'logs')));
  });
});

// ---------------------------------------------------------------------------
// record: the fixed envelope, append-only
// ---------------------------------------------------------------------------

describe('record', () => {
  async function opened(job = 'envelope') {
    const anchor = makeAnchor();
    const dir = (await runlog(['open', '--job', job, '--date', '2026-04-05'], { cwd: anchor })).stdout.trim();
    return { anchor, dir };
  }

  test('every record carries exactly ts, job, unit, status, duration, detail (EN-14)', async () => {
    const { anchor, dir } = await opened();
    const r = await runlog(
      [
        'record',
        '--dir', dir,
        '--job', 'envelope',
        '--unit', 'fetch',
        '--status', 'ok',
        '--duration', '4200',
        '--detail', 'fetched 10 items',
      ],
      { cwd: anchor },
    );
    assert.equal(r.status, 0, r.stderr);

    const [line] = readLines(path.join(dir, 'run.jsonl'));
    const rec = JSON.parse(line);
    assert.deepEqual(Object.keys(rec).sort(), ['detail', 'duration', 'job', 'status', 'ts', 'unit']);
    assert.equal(rec.job, 'envelope');
    assert.equal(rec.unit, 'fetch');
    assert.equal(rec.status, 'ok');
    assert.equal(rec.duration, 4200);
    assert.equal(rec.detail, 'fetched 10 items');
    assert.equal(typeof rec.ts, 'string');
    assert.equal(new Date(rec.ts).toISOString(), rec.ts, 'ts is not a real ISO-8601 UTC timestamp');
  });

  test('omitted --duration and --detail still produce a complete record', async () => {
    const { anchor, dir } = await opened();
    const r = await runlog(['record', '--dir', dir, '--job', 'envelope', '--unit', 'noop', '--status', 'ok'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(readLines(path.join(dir, 'run.jsonl'))[0]);
    assert.deepEqual(Object.keys(rec).sort(), ['detail', 'duration', 'job', 'status', 'ts', 'unit']);
    assert.equal(rec.duration, 0);
    assert.equal(rec.detail, '');
  });

  test('records append; an earlier line is untouched by a later append', async () => {
    const { anchor, dir } = await opened();
    for (let i = 1; i <= 5; i += 1) {
      const r = await runlog(
        ['record', '--dir', dir, '--job', 'envelope', '--unit', `step-${i}`, '--status', 'ok', '--duration', String(i)],
        { cwd: anchor },
      );
      assert.equal(r.status, 0, r.stderr);
    }
    const lines = readLines(path.join(dir, 'run.jsonl'));
    assert.equal(lines.length, 5);
    lines.forEach((line, i) => {
      const rec = JSON.parse(line);
      assert.equal(rec.unit, `step-${i + 1}`, `line ${i} was rewritten by a later append`);
      assert.equal(rec.duration, i + 1);
    });
  });

  test('one JSON object per line, even with newlines and tabs in the fields', async () => {
    const { anchor, dir } = await opened();
    await runlog(
      ['record', '--dir', dir, '--job', 'envelope', '--unit', 'multi\nline', '--status', 'ok', '--detail', 'a\nb\tc'],
      { cwd: anchor },
    );
    const raw = readFileSync(path.join(dir, 'run.jsonl'), 'utf8');
    const lines = raw.split('\n').filter((l) => l !== '');
    assert.equal(lines.length, 1, 'an embedded newline in a field split the record across lines');
    assert.doesNotThrow(() => JSON.parse(lines[0]));
  });
});

// ---------------------------------------------------------------------------
// close: the terminal record and the summary line
// ---------------------------------------------------------------------------

describe('close', () => {
  test('appends a unit:"run" record and a closing line in summary.md', async () => {
    const anchor = makeAnchor();
    const dir = (await runlog(['open', '--job', 'closer', '--date', '2026-05-06'], { cwd: anchor })).stdout.trim();
    await runlog(['record', '--dir', dir, '--job', 'closer', '--unit', 'work', '--status', 'ok', '--duration', '10'], { cwd: anchor });
    const r = await runlog(['close', '--dir', dir, '--job', 'closer', '--status', 'ok', '--duration', '999'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);

    const lines = readLines(path.join(dir, 'run.jsonl'));
    assert.equal(lines.length, 2, 'close must not remove or rewrite the records already there');
    const finalRecord = JSON.parse(lines[1]);
    assert.deepEqual(Object.keys(finalRecord).sort(), ['detail', 'duration', 'job', 'status', 'ts', 'unit']);
    assert.equal(finalRecord.unit, 'run');
    assert.equal(finalRecord.status, 'ok');
    assert.equal(finalRecord.duration, 999);

    const summary = readFileSync(path.join(dir, 'summary.md'), 'utf8');
    assert.match(summary, /Closed .* status: ok/);
  });

  test('close also refuses a directory runlog never opened', async () => {
    const anchor = makeAnchor();
    const notOpened = path.join(anchor, 'logs', 'hand-made');
    mkdirSync(notOpened, { recursive: true });
    const r = await runlog(['close', '--dir', notOpened, '--job', 'x', '--status', 'ok'], { cwd: anchor });
    assert.notEqual(r.status, 0);
  });
});

// ---------------------------------------------------------------------------
// bad input rejection
// ---------------------------------------------------------------------------

describe('bad input is rejected, not silently accepted', () => {
  test('open with no --job fails', async () => {
    const r = await runlog(['open'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
  });

  test('open with a malformed --date fails', async () => {
    const r = await runlog(['open', '--job', 'x', '--date', 'not-a-date'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
  });

  test('record with no --dir fails', async () => {
    const r = await runlog(['record', '--job', 'x', '--unit', 'y', '--status', 'ok'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
  });

  test('record against a directory runlog never opened fails', async () => {
    const anchor = makeAnchor();
    const notOpened = path.join(anchor, 'logs', 'someone-made-this-by-hand');
    mkdirSync(notOpened, { recursive: true });
    const r = await runlog(['record', '--dir', notOpened, '--job', 'x', '--unit', 'y', '--status', 'ok'], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /run\.jsonl/);
  });

  test('record against a directory that does not exist at all fails', async () => {
    const anchor = makeAnchor();
    const r = await runlog(
      ['record', '--dir', path.join(anchor, 'logs', 'nope'), '--job', 'x', '--unit', 'y', '--status', 'ok'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
  });

  test('a non-numeric --duration fails, and nothing is appended', async () => {
    const anchor = makeAnchor();
    const dir = (await runlog(['open', '--job', 'bad-duration', '--date', '2026-01-01'], { cwd: anchor })).stdout.trim();
    const r = await runlog(
      ['record', '--dir', dir, '--job', 'bad-duration', '--unit', 'x', '--status', 'ok', '--duration', 'soon'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
    assert.equal(readLines(path.join(dir, 'run.jsonl')).length, 0, 'a rejected call must not have appended anything');
  });

  test('a negative --duration fails', async () => {
    const anchor = makeAnchor();
    const dir = (await runlog(['open', '--job', 'neg-duration', '--date', '2026-01-01'], { cwd: anchor })).stdout.trim();
    const r = await runlog(
      ['record', '--dir', dir, '--job', 'neg-duration', '--unit', 'x', '--status', 'ok', '--duration', '-5'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
  });

  test('a blank --status is rejected, not written as an empty string', async () => {
    const anchor = makeAnchor();
    const dir = (await runlog(['open', '--job', 'empty-status', '--date', '2026-01-01'], { cwd: anchor })).stdout.trim();
    const r = await runlog(['record', '--dir', dir, '--job', 'empty-status', '--unit', 'x', '--status', '  '], { cwd: anchor });
    assert.notEqual(r.status, 0);
  });

  test('an unknown subcommand fails with usage', async () => {
    const r = await runlog(['bogus'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /usage/);
  });

  test('no subcommand at all fails with usage', async () => {
    const r = await runlog([], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /usage/);
  });
});

// ---------------------------------------------------------------------------
// The same script, as a real child process
//
// Everything above runs runlog.mjs in a worker thread. This block runs it the way a lane
// does — `node runlog.mjs ...`, one process per call — over a whole run, so the claim
// that the worker is a faithful stand-in is paid for rather than assumed. If a case above
// ever passes while the matching case here fails, the worker is the thing that is wrong.
// ---------------------------------------------------------------------------

describe('as a real child process', () => {
  test('a full open, record, close cycle works end to end', () => {
    const anchor = makeAnchor();

    const opened = spawnRunlog(['open', '--job', 'e2e', '--date', '2026-06-07'], { cwd: anchor });
    assert.equal(opened.status, 0, opened.stderr);
    const dir = opened.stdout.trim();
    assert.equal(path.basename(dir), '2026-06-07-e2e');
    assert.equal(readFileSync(path.join(dir, 'run.jsonl'), 'utf8'), '');

    const recorded = spawnRunlog(
      ['record', '--dir', dir, '--job', 'e2e', '--unit', 'fetch', '--status', 'ok', '--duration', '4200', '--detail', 'ten items'],
      { cwd: anchor },
    );
    assert.equal(recorded.status, 0, recorded.stderr);

    const closed = spawnRunlog(['close', '--dir', dir, '--job', 'e2e', '--status', 'ok', '--duration', '9000'], { cwd: anchor });
    assert.equal(closed.status, 0, closed.stderr);

    const lines = readLines(path.join(dir, 'run.jsonl')).map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(Object.keys(lines[0]).sort(), ['detail', 'duration', 'job', 'status', 'ts', 'unit']);
    assert.equal(lines[0].unit, 'fetch');
    assert.equal(lines[0].duration, 4200);
    assert.equal(lines[1].unit, 'run');
    assert.equal(lines[1].duration, 9000);
    assert.match(readFileSync(path.join(dir, 'summary.md'), 'utf8'), /Closed .* status: ok/);
  });

  test('a rejected call exits non-zero with usage on stderr', () => {
    const r = spawnRunlog(['bogus'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /usage/);
    assert.equal(r.stdout, '');
  });
});

// ---------------------------------------------------------------------------
// The leak guard itself
//
// The guard runs after every invocation in both runlog test files and once more when the
// file finishes, and its whole job is to be loud about something that was silent for
// hours. A guard nobody has seen fire is a guard nobody knows works, so its comparison is
// exercised here against a directory standing in for `logs/` — a snapshot, a directory
// created behind its back, and the name coming back out.
// ---------------------------------------------------------------------------

describe('the guard that catches a run directory landing in this repository', () => {
  test('a directory created after the snapshot is reported by name', () => {
    const logs = tempDir('aeo-runlog-watched-');
    mkdirSync(path.join(logs, '2026-01-01-already-here'));
    const before = snapshotLogDirs([logs]);
    assert.deepEqual(leaksSince(before), [], 'a directory present at snapshot time is not a leak');

    const leaked = path.join(logs, '2026-08-12-x');
    mkdirSync(leaked);
    assert.deepEqual(leaksSince(before), [leaked]);
  });

  test('it watches every directory it was given, not just the first', () => {
    // In a linked worktree the checkout's logs and the resolved project root's logs are
    // two different directories, and the leak lands in the second one.
    const own = tempDir('aeo-runlog-watched-own-');
    const anchor = tempDir('aeo-runlog-watched-anchor-');
    const before = snapshotLogDirs([own, anchor]);
    const leaked = path.join(anchor, '2026-08-12-x');
    mkdirSync(leaked);
    assert.deepEqual(leaksSince(before), [leaked]);
  });

  test('a directory that does not exist yet reads as empty rather than throwing', () => {
    // `logs/` need not exist in a fresh checkout, and a guard that crashes on that is a
    // guard someone removes.
    const missing = path.join(tempDir('aeo-runlog-watched-missing-'), 'logs');
    const before = snapshotLogDirs([missing]);
    assert.deepEqual(leaksSince(before), []);
    mkdirSync(missing, { recursive: true });
    mkdirSync(path.join(missing, '2026-08-12-x'));
    assert.deepEqual(leaksSince(before), [path.join(missing, '2026-08-12-x')]);
  });
});
