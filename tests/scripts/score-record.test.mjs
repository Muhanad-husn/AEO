// Acceptance tests for a consumer scored from a hand-copied record, not a
// live checkout. Nothing here touches git, GitHub or a filesystem outside
// the repository.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inclusiveDays } from '../../scripts/score/consumer.mjs';
import { load } from '../../scripts/score/record.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'score.mjs');
const recordFile = join(root, 'scripts', 'records', 'rlm-challenge.json');

function run(path) {
  return execFileSync(process.execPath, [script, '--record', path], { encoding: 'utf8' });
}

const expected = [
  'consumer: Muhanad-husn/RLM-Challenge (from record)',
  'phases: all, 2026-08-21 to 2026-09-05',
  'days: 16',
  'dollars: 20.58',
  'prs: 117 merged of 122',
  'interventions: no transcripts',
  'executed: none declared',
  'harness: no checkout',
  '',
].join('\n');

test('scoring the committed record prints the eight-line row', () => {
  assert.equal(run(recordFile), expected);
});

test('two runs are byte-identical', () => {
  assert.equal(run(recordFile), run(recordFile));
});

test('inclusiveDays counts both ends', () => {
  assert.equal(inclusiveDays('2026-08-21', '2026-09-05'), 16);
  assert.equal(inclusiveDays('2026-09-05', '2026-09-08'), 4);
});

test('a record missing its "record" field is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'score-record-'));
  const file = join(dir, 'no-record.json');
  writeFileSync(file, JSON.stringify({
    consumer: 'Muhanad-husn/RLM-Challenge',
    phases: 'all',
    firstCommit: { date: '2026-08-21T00:00:00+00:00' },
    lastCommit: { date: '2026-09-05T00:00:00+00:00' },
    dollars: 20.58,
    pullRequests: { total: 122, merged: 117 },
    interventions: null,
    commitments: null,
    harness: null,
  }));
  assert.throws(() => load(file), /record/);
});
