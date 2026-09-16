// Tests for plugin/hooks/sensorium/30-runs.mjs (#183): the sensorium's runs section,
// printing the live sentinels under .aeo/runs/ and the newest logs/<dir>/run.jsonl's
// last record as one line.
//
// Two layers, cheapest first: render({ root }) directly, against a scratch root this
// test builds by hand (sentinel files, logs/<dir>/run.jsonl); then renderSensorium(root)
// itself, matching this slice's acceptance criterion (plans/phase-2/03-runs.md), which
// states its scenarios in terms of renderSensorium.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { render, name } from '../../plugin/hooks/sensorium/30-runs.mjs';
import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';
import { sentinelPath } from '../../plugin/hooks/sentinel.mjs';

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-runs-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Raise a sentinel by writing the file directly, same shape run-sentinel.mjs writes. */
function raise(root, id, record) {
  const file = sentinelPath(root, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ id, what: 'a long job', started: '2026-08-04T09:00:00Z', ...record }));
  return file;
}

/** A `logs/<name>/run.jsonl` holding one JSON record per line. */
function writeRunLog(root, dirName, records) {
  const dir = path.join(root, 'logs', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

// A pid this machine will never have live, matching the convention already used by
// tests/hooks/sandbox-guard.test.mjs for exactly this case.
const DEAD_PID = 999_999_999;

// ---------------------------------------------------------------------------
// render({ root }) directly
// ---------------------------------------------------------------------------

describe('30-runs.mjs, render({ root }) directly', () => {
  test('exports its section name', () => {
    assert.equal(name, '30-runs');
  });

  test('no root: reports the empty state without touching the filesystem', () => {
    assert.deepEqual(render({ root: null }), ['runs: none live', 'last run: none']);
  });

  test('no .aeo/runs and no logs/: "runs: none live" and "last run: none"', () => {
    const root = tempDir();
    assert.deepEqual(render({ root }), ['runs: none live', 'last run: none']);
  });

  test('one live sentinel and one stale sentinel: counted, named, and marked', () => {
    const root = tempDir();
    raise(root, 'live-job', { pid: process.pid, host: os.hostname() });
    raise(root, 'crashed-job', { pid: DEAD_PID, host: os.hostname() });
    const lines = render({ root });
    assert.equal(lines[0], 'runs: 1 live');
    assert.equal(lines.length, 4); // header, live line, stale line, last run
    assert.match(lines[1], /live-job\.json/);
    assert.doesNotMatch(lines[1], /stale/);
    assert.match(lines[2], /crashed-job\.json/);
    assert.match(lines[2], /\(stale, owner gone\)$/);
    assert.doesNotMatch(lines[2], /owner process is gone/, 'the longer inspectRuns phrase is replaced, not appended to');
    assert.equal(lines[3], 'last run: none');
  });

  test('an unreadable sentinel is never dropped', () => {
    const root = tempDir();
    const file = sentinelPath(root, 'broken');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{not json');
    const lines = render({ root });
    assert.equal(lines[0], 'runs: 0 live');
    assert.match(lines[1], /does not parse/);
    assert.match(lines[1], /\(unreadable\)$/);
  });

  test('a sentinel directory that is really a file is a dirError, and is never dropped', () => {
    const root = tempDir();
    mkdirSync(path.join(root, '.aeo'), { recursive: true });
    writeFileSync(path.join(root, '.aeo', 'runs'), 'not a directory');
    const lines = render({ root });
    assert.equal(lines[0], 'runs: 0 live');
    assert.match(lines[1], /could not be read/);
  });

  test('newest run.jsonl ending on a progress record: unit and status, no counter', () => {
    const root = tempDir();
    writeRunLog(root, '2026-08-01-older-job', [
      { ts: '2026-08-01T09:00:00.000Z', job: 'older', unit: 'fetch', status: 'ok', duration: 10, detail: '' },
    ]);
    writeRunLog(root, '2026-08-05-newer-job', [
      { ts: '2026-08-05T10:00:00.000Z', job: 'corpus', unit: 'fetch', status: 'ok', duration: 100, detail: '' },
      { ts: '2026-08-05T10:05:00.000Z', job: 'corpus', unit: 'ingest', status: 'ok', duration: 200, detail: '' },
      { ts: '2026-08-05T10:10:00.000Z', job: 'corpus', unit: 'ingest', status: 'running', duration: 0, detail: '' },
    ]);
    const lines = render({ root });
    assert.deepEqual(lines, [
      'runs: none live',
      'last run: logs/2026-08-05-newer-job, ingest, running, 2026-08-05T10:10:00.000Z',
    ]);
  });

  test('newest run.jsonl ending on the close record: "closed <status> <timestamp>"', () => {
    const root = tempDir();
    writeRunLog(root, '2026-08-05-newer-job', [
      { ts: '2026-08-05T10:00:00.000Z', job: 'corpus', unit: 'fetch', status: 'ok', duration: 100, detail: '' },
      { ts: '2026-08-05T10:15:00.000Z', job: 'corpus', unit: 'run', status: 'ok', duration: 900000, detail: '' },
    ]);
    const lines = render({ root });
    assert.deepEqual(lines, ['runs: none live', 'last run: logs/2026-08-05-newer-job, closed ok 2026-08-05T10:15:00.000Z']);
  });

  test('the date in the directory name decides over mtime, same rule as before (#181/#183)', () => {
    const root = tempDir();
    // Written in reverse order, so a pure mtime read would pick the wrong one.
    writeRunLog(root, '2026-08-05-newer-job', [
      { ts: '2026-08-05T10:00:00.000Z', job: 'corpus', unit: 'run', status: 'ok', duration: 0, detail: '' },
    ]);
    writeRunLog(root, '2026-08-01-older-job', [
      { ts: '2026-08-01T09:00:00.000Z', job: 'older', unit: 'run', status: 'should-not-appear', duration: 0, detail: '' },
    ]);
    const lines = render({ root });
    assert.equal(lines[lines.length - 1], 'last run: logs/2026-08-05-newer-job, closed ok 2026-08-05T10:00:00.000Z');
  });

  test('a logs/<dir> with no run.jsonl is not a run log', () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'logs', '2026-08-01-summary-only'), { recursive: true });
    writeFileSync(path.join(root, 'logs', '2026-08-01-summary-only', 'summary.md'), '# nothing structured\n');
    assert.deepEqual(render({ root }), ['runs: none live', 'last run: none']);
  });
});

// ---------------------------------------------------------------------------
// renderSensorium(root) -- this slice's acceptance criterion
// (plans/phase-2/03-runs.md)
// ---------------------------------------------------------------------------

describe('renderSensorium(root): the acceptance criterion scenario', () => {
  test('one live sentinel, one stale sentinel, and the newer run log ending on a progress record', async () => {
    const root = tempDir();
    raise(root, 'live-job', { pid: process.pid, host: os.hostname() });
    raise(root, 'crashed-job', { pid: DEAD_PID, host: os.hostname() });
    writeRunLog(root, '2026-08-01-older-job', [
      { ts: '2026-08-01T09:00:00.000Z', job: 'older', unit: 'fetch', status: 'ok', duration: 10, detail: '' },
    ]);
    writeRunLog(root, '2026-08-05-newer-job', [
      { ts: '2026-08-05T10:00:00.000Z', job: 'corpus', unit: 'fetch', status: 'ok', duration: 100, detail: '' },
      { ts: '2026-08-05T10:10:00.000Z', job: 'corpus', unit: 'ingest', status: 'running', duration: 0, detail: '' },
    ]);

    const lines = await renderSensorium(root);
    assert.ok(lines.includes('runs: 1 live'), 'the sentinel count is the live count, one');
    assert.ok(lines.some((l) => /live-job\.json/.test(l)), 'the live sentinel is named');
    assert.ok(lines.some((l) => /crashed-job\.json/.test(l) && l.endsWith('(stale, owner gone)')), 'the stale sentinel is named and marked');
    assert.ok(
      lines.includes('last run: logs/2026-08-05-newer-job, ingest, running, 2026-08-05T10:10:00.000Z'),
      'the last run line names the newer directory and its last record',
    );
  });

  test('the same repository, newer run log now closed: "closed <status>"', async () => {
    const root = tempDir();
    writeRunLog(root, '2026-08-05-newer-job', [
      { ts: '2026-08-05T10:00:00.000Z', job: 'corpus', unit: 'fetch', status: 'ok', duration: 100, detail: '' },
      { ts: '2026-08-05T10:15:00.000Z', job: 'corpus', unit: 'run', status: 'ok', duration: 900000, detail: '' },
    ]);
    const lines = await renderSensorium(root);
    assert.ok(lines.includes('last run: logs/2026-08-05-newer-job, closed ok 2026-08-05T10:15:00.000Z'));
  });

  test('no .aeo/runs and no logs/: "runs: none live" and "last run: none"', async () => {
    const root = tempDir();
    const lines = await renderSensorium(root);
    assert.ok(lines.includes('runs: none live'));
    assert.ok(lines.includes('last run: none'));
  });
});
