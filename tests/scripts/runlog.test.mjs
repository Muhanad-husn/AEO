// Tests for plugin/scripts/runlog.mjs — the run-log CLI (P3.1).
//
//   node --test tests/scripts/runlog.test.mjs
//
// runlog.mjs is a CLI, not a library (a subagent can only shell out to it), so this file
// spawns it exactly the way a lane would: as a child process, reading stdout, stderr, the
// exit code, and the files it wrote. That matches tests/hooks/sandbox-session.test.mjs,
// the other script in this tree tested only by spawning. Every fixture anchors the
// project root through `.aeo/runs` (see makeAnchor below) rather than `git init`, so this
// stays in the fast `npm test` lane alongside sandbox-session.test.mjs — no subprocess
// git, no repository fixture.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

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

function tempDir(prefix = 'aeo-runlog-') {
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
  const dir = tempDir('aeo-runlog-anchor-');
  mkdirSync(path.join(dir, '.aeo', 'runs'), { recursive: true });
  return dir;
}

function run(args, { cwd } = {}) {
  const r = spawnSync(process.execPath, [RUNLOG, ...args], { encoding: 'utf8', cwd, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function readLines(file) {
  const text = readFileSync(file, 'utf8');
  return text === '' ? [] : text.split('\n').filter((l) => l !== '');
}

// ---------------------------------------------------------------------------
// open: placement, collisions, opened-but-empty
// ---------------------------------------------------------------------------

describe('open', () => {
  test('creates run.jsonl, console.log and a non-empty summary.md stub', () => {
    const anchor = makeAnchor();
    const r = run(['open', '--job', 'ingest', '--date', '2026-01-01'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    const dir = r.stdout.trim();
    assert.equal(existsSync(path.join(dir, 'run.jsonl')), true);
    assert.equal(existsSync(path.join(dir, 'console.log')), true);
    assert.equal(existsSync(path.join(dir, 'summary.md')), true);
    assert.ok(readFileSync(path.join(dir, 'summary.md'), 'utf8').length > 0);
  });

  test('lands under the project anchor, not under the working directory (D12)', () => {
    const anchor = makeAnchor();
    const nested = path.join(anchor, 'nested', 'deep');
    mkdirSync(nested, { recursive: true });
    const r = run(['open', '--job', 'ingest', '--date', '2026-01-01'], { cwd: nested });
    assert.equal(r.status, 0, r.stderr);
    const dir = r.stdout.trim();
    const expectedRoot = path.join(anchor, 'logs');
    assert.ok(dir.startsWith(expectedRoot), `${dir} is not under ${expectedRoot}`);
    assert.ok(
      !dir.startsWith(path.join(nested, 'logs')),
      'logs landed under the working directory instead of the resolved project root',
    );
  });

  test('the directory name is <date>-<job>', () => {
    const anchor = makeAnchor();
    const r = run(['open', '--job', 'my-job', '--date', '2026-03-04'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(path.basename(r.stdout.trim()), '2026-03-04-my-job');
  });

  test('an opened-but-empty run is distinguishable from no run at all (L-08)', () => {
    const anchor = makeAnchor();
    const neverOpened = path.join(anchor, 'logs', '2026-01-01-never-opened');
    assert.equal(existsSync(neverOpened), false);

    const r = run(['open', '--job', 'idle', '--date', '2026-01-01'], { cwd: anchor });
    const dir = r.stdout.trim();
    assert.equal(existsSync(dir), true, 'an opened run must exist on disk');
    assert.equal(readFileSync(path.join(dir, 'run.jsonl'), 'utf8'), '', 'a fresh run.jsonl must be empty, not absent');
    assert.equal(existsSync(neverOpened), false, 'a directory nobody opened must still not exist');
  });

  test('a second open of the same job and date does not reuse the first directory', () => {
    const anchor = makeAnchor();
    const first = run(['open', '--job', 'twice', '--date', '2026-02-02'], { cwd: anchor }).stdout.trim();
    run(['record', '--dir', first, '--job', 'twice', '--unit', 'a', '--status', 'ok', '--duration', '10'], { cwd: anchor });

    const second = run(['open', '--job', 'twice', '--date', '2026-02-02'], { cwd: anchor }).stdout.trim();
    assert.notEqual(second, first, "the second open reused the first run's directory");
    assert.equal(path.basename(second), '2026-02-02-twice-2');

    // The first run's own record survives the second open untouched.
    const lines = readLines(path.join(first, 'run.jsonl'));
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).unit, 'a');
  });

  test('a third collision gets -3', () => {
    const anchor = makeAnchor();
    const dirs = [0, 1, 2].map(() => run(['open', '--job', 'thrice', '--date', '2026-02-02'], { cwd: anchor }).stdout.trim());
    assert.deepEqual(
      dirs.map((d) => path.basename(d)),
      ['2026-02-02-thrice', '2026-02-02-thrice-2', '2026-02-02-thrice-3'],
    );
  });

  test('refuses to run outside a project repository', () => {
    const outside = tempDir('aeo-runlog-no-anchor-');
    // No .aeo/runs, and (in a fresh OS temp directory) no .git above it either.
    const r = run(['open', '--job', 'x'], { cwd: outside });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no project root/);
  });
});

// ---------------------------------------------------------------------------
// record: the fixed envelope, append-only
// ---------------------------------------------------------------------------

describe('record', () => {
  function opened(job = 'envelope') {
    const anchor = makeAnchor();
    const dir = run(['open', '--job', job, '--date', '2026-04-05'], { cwd: anchor }).stdout.trim();
    return { anchor, dir };
  }

  test('every record carries exactly ts, job, unit, status, duration, detail (EN-14)', () => {
    const { anchor, dir } = opened();
    const r = run(
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

  test('omitted --duration and --detail still produce a complete record', () => {
    const { anchor, dir } = opened();
    const r = run(['record', '--dir', dir, '--job', 'envelope', '--unit', 'noop', '--status', 'ok'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    const rec = JSON.parse(readLines(path.join(dir, 'run.jsonl'))[0]);
    assert.deepEqual(Object.keys(rec).sort(), ['detail', 'duration', 'job', 'status', 'ts', 'unit']);
    assert.equal(rec.duration, 0);
    assert.equal(rec.detail, '');
  });

  test('records append; an earlier line is untouched by a later append', () => {
    const { anchor, dir } = opened();
    for (let i = 1; i <= 5; i += 1) {
      const r = run(
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

  test('one JSON object per line, even with newlines and tabs in the fields', () => {
    const { anchor, dir } = opened();
    run(
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
  test('appends a unit:"run" record and a closing line in summary.md', () => {
    const anchor = makeAnchor();
    const dir = run(['open', '--job', 'closer', '--date', '2026-05-06'], { cwd: anchor }).stdout.trim();
    run(['record', '--dir', dir, '--job', 'closer', '--unit', 'work', '--status', 'ok', '--duration', '10'], { cwd: anchor });
    const r = run(['close', '--dir', dir, '--job', 'closer', '--status', 'ok', '--duration', '999'], { cwd: anchor });
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

  test('close also refuses a directory runlog never opened', () => {
    const anchor = makeAnchor();
    const notOpened = path.join(anchor, 'logs', 'hand-made');
    mkdirSync(notOpened, { recursive: true });
    const r = run(['close', '--dir', notOpened, '--job', 'x', '--status', 'ok'], { cwd: anchor });
    assert.notEqual(r.status, 0);
  });
});

// ---------------------------------------------------------------------------
// bad input rejection
// ---------------------------------------------------------------------------

describe('bad input is rejected, not silently accepted', () => {
  test('open with no --job fails', () => {
    const r = run(['open'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
  });

  test('open with a malformed --date fails', () => {
    const r = run(['open', '--job', 'x', '--date', 'not-a-date'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
  });

  test('record with no --dir fails', () => {
    const r = run(['record', '--job', 'x', '--unit', 'y', '--status', 'ok'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
  });

  test('record against a directory runlog never opened fails', () => {
    const anchor = makeAnchor();
    const notOpened = path.join(anchor, 'logs', 'someone-made-this-by-hand');
    mkdirSync(notOpened, { recursive: true });
    const r = run(['record', '--dir', notOpened, '--job', 'x', '--unit', 'y', '--status', 'ok'], { cwd: anchor });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /run\.jsonl/);
  });

  test('record against a directory that does not exist at all fails', () => {
    const anchor = makeAnchor();
    const r = run(
      ['record', '--dir', path.join(anchor, 'logs', 'nope'), '--job', 'x', '--unit', 'y', '--status', 'ok'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
  });

  test('a non-numeric --duration fails, and nothing is appended', () => {
    const anchor = makeAnchor();
    const dir = run(['open', '--job', 'bad-duration', '--date', '2026-01-01'], { cwd: anchor }).stdout.trim();
    const r = run(
      ['record', '--dir', dir, '--job', 'bad-duration', '--unit', 'x', '--status', 'ok', '--duration', 'soon'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
    assert.equal(readLines(path.join(dir, 'run.jsonl')).length, 0, 'a rejected call must not have appended anything');
  });

  test('a negative --duration fails', () => {
    const anchor = makeAnchor();
    const dir = run(['open', '--job', 'neg-duration', '--date', '2026-01-01'], { cwd: anchor }).stdout.trim();
    const r = run(
      ['record', '--dir', dir, '--job', 'neg-duration', '--unit', 'x', '--status', 'ok', '--duration', '-5'],
      { cwd: anchor },
    );
    assert.notEqual(r.status, 0);
  });

  test('a blank --status is rejected, not written as an empty string', () => {
    const anchor = makeAnchor();
    const dir = run(['open', '--job', 'empty-status', '--date', '2026-01-01'], { cwd: anchor }).stdout.trim();
    const r = run(['record', '--dir', dir, '--job', 'empty-status', '--unit', 'x', '--status', '  '], { cwd: anchor });
    assert.notEqual(r.status, 0);
  });

  test('an unknown subcommand fails with usage', () => {
    const r = run(['bogus'], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /usage/);
  });

  test('no subcommand at all fails with usage', () => {
    const r = run([], { cwd: makeAnchor() });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /usage/);
  });
});
