// Acceptance tests for the score row. They replay the committed snapshot and
// in-memory variants of it, so nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const script = join(root, 'scripts', 'score.mjs');
const fixture = join(root, 'tests', 'fixtures', 'score', 'rlm-phases-0-5.json');

function run(from) {
  return execFileSync(process.execPath, [script, 'D:/RLM', '--phases', '0-5', '--from', from], {
    encoding: 'utf8',
  });
}

function variant(mutate) {
  const snapshot = JSON.parse(readFileSync(fixture, 'utf8'));
  mutate(snapshot);
  const file = join(mkdtempSync(join(tmpdir(), 'score-')), 'snapshot.json');
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
  return file;
}

const expected = [
  'consumer: Muhanad-husn/RLM',
  'phases: 0 to 5, 2026-09-05 to 2026-09-08',
  'days: 4',
  'dollars: 3.50',
  'prs: 48 merged',
  'interventions: not measured',
  'executed: not measured',
  'harness: not measured',
  '',
].join('\n');

test('replaying the snapshot prints the eight-line row', () => {
  assert.equal(run(fixture), expected);
});

test('two replays are byte-identical', () => {
  assert.equal(run(fixture), run(fixture));
});

test('a snapshot with no ledger rows prints no ledger', () => {
  const file = variant((s) => {
    s.ledger.rows = [];
  });
  const lines = run(file).split('\n');
  assert.equal(lines[3], 'dollars: no ledger');
  // The rest of the row still prints.
  assert.equal(lines[0], 'consumer: Muhanad-husn/RLM');
  assert.equal(lines[1], 'phases: 0 to 5, 2026-09-05 to 2026-09-08');
  assert.equal(lines[2], 'days: 4');
  assert.equal(lines[4], 'prs: 48 merged');
  assert.equal(lines[7], 'harness: not measured');
});

test('an open last phase prints open and counts to the recorded time', () => {
  const file = variant((s) => {
    s.gateCommit = null;
    const rows = s.statusTable.rows;
    const last = rows.find((r) => r[0].startsWith('5'));
    last[2] = 'in progress';
  });
  const out = run(file);
  const lines = out.split('\n');
  assert.equal(lines[1], 'phases: 0 to 5, open');

  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  const recorded = snapshot.recordedAt;
  const offset = recorded.slice(-6);
  const dayOf = (iso) => new Date(Date.parse(iso) + offsetMs(offset)).toISOString().slice(0, 10);
  const start = dayOf(snapshot.firstCommit.date);
  const end = dayOf(recorded);
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
  assert.equal(lines[2], `days: ${days}`);

  const merged = snapshot.pullRequests.filter((p) => Date.parse(p.mergedAt) <= Date.parse(recorded));
  assert.equal(lines[4], `prs: ${merged.length} merged`);

  // A gate that is open does not take the rest of the row down with it.
  assert.equal(lines[0], 'consumer: Muhanad-husn/RLM');
  assert.equal(lines[3], 'dollars: 3.50');
  assert.equal(lines[5], 'interventions: not measured');
});

function offsetMs(offset) {
  const sign = offset[0] === '-' ? -1 : 1;
  return sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6))) * 60000;
}

test('the snapshot on disk is stable JSON', () => {
  const text = readFileSync(fixture, 'utf8');
  assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + '\n');
});
