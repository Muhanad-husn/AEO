// Acceptance tests for the `--milestone` score row. They replay committed
// snapshots, so nothing here touches git or GitHub. The `--phases` path is
// untouched by this file; its own tests (score.test.mjs) are the proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'score.mjs');
const openFixture = join(root, 'tests', 'fixtures', 'score', 'milestone-open.json');
const closedFixture = join(root, 'tests', 'fixtures', 'score', 'milestone-closed.json');

function run(fixture) {
  return execFileSync(process.execPath, [script, 'D:/axial', '--milestone', 'DEC-75', '--from', fixture], {
    encoding: 'utf8',
  });
}

const openExpected = [
  'consumer: Muhanad-husn/axial',
  'milestone: DEC-75, open',
  'days: 1',
  'dollars: none declared',
  'prs: 0 merged',
  'interventions: no transcripts',
  'executed: none declared',
  'harness: bash 1 node, grep 0, read 0, task 0; session start 120 lines; tests 0.44 of source (400 / 900)',
  '',
].join('\n');

test('an open milestone prints an open row with no merged PRs', () => {
  assert.equal(run(openFixture), openExpected);
});

test('two replays of an open milestone are byte-identical', () => {
  assert.equal(run(openFixture), run(openFixture));
});

const closedExpected = [
  'consumer: Muhanad-husn/axial',
  'milestone: Phase D, 2026-08-17 to 2026-08-19',
  'days: 3',
  'dollars: 2.05',
  'prs: 3 merged',
  'interventions: 2.00 per merged PR (6 messages, 3 merge decisions excluded, 3 sessions)',
  'executed: none declared',
  'harness: bash 1 node, grep 0, read 0, task 0; session start 60 lines; tests 0.00 of source (0 / 0)',
  '',
].join('\n');

test('a closed milestone with merged PRs prints a non-zero interventions figure', () => {
  const out = run(closedFixture);
  assert.equal(out, closedExpected);
  assert.match(out, /interventions: [1-9][\d.]* per merged PR/);
});

test('two replays of a closed milestone are byte-identical', () => {
  assert.equal(run(closedFixture), run(closedFixture));
});

test('both milestone fixtures on disk are stable JSON', () => {
  for (const fixture of [openFixture, closedFixture]) {
    const text = readFileSync(fixture, 'utf8');
    assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + '\n');
  }
});
