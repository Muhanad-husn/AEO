// Acceptance tests for the interventions and executed lines. They read the
// synthetic transcripts under tests/fixtures/score/transcripts/ and a temporary
// home directory built from them, so nothing here touches a real transcript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { windowOf } from '../../scripts/score/consumer.mjs';
import { countCommitments, line, scanTranscripts } from '../../scripts/score/interventions.mjs';
import { readCommitments, readInterventions } from '../../scripts/score/sources.mjs';

const fixtures = fileURLToPath(new URL('../fixtures/score/', import.meta.url));
const transcripts = join(fixtures, 'transcripts');
const sessions = ['in-window-a', 'in-window-b', 'before-window', 'after-window']
  .map((name) => join(transcripts, `${name}.jsonl`));

// A window of 2026-09-06 to 2026-09-07 read at +02:00, and three merged pull
// requests inside it.
function snapshot(extra = {}) {
  return {
    recordedAt: '2026-09-07T23:00:00+02:00',
    consumer: 'example/consumer',
    phases: { from: 0, to: 5 },
    firstCommit: { sha: 'aaa', date: '2026-09-06T09:00:00+02:00' },
    gateCommit: { sha: 'bbb', date: '2026-09-07T20:00:00+02:00' },
    pullRequests: [
      { number: 1, mergedAt: '2026-09-06T10:00:00Z' },
      { number: 2, mergedAt: '2026-09-06T14:00:00Z' },
      { number: 3, mergedAt: '2026-09-07T09:00:00Z' },
    ],
    interventions: null,
    commitments: null,
    ...extra,
  };
}

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'score-home-'));
  const projects = join(home, '.claude', 'projects');
  // The consumer's own directory and a worktree sibling, which shares its slug
  // as a prefix.
  const own = join(projects, 'D--Consumer');
  const worktree = join(projects, 'D--Consumer-wt-9');
  mkdirSync(own, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  cpSync(join(transcripts, 'in-window-a.jsonl'), join(own, 'a.jsonl'));
  cpSync(join(transcripts, 'before-window.jsonl'), join(own, 'b.jsonl'));
  cpSync(join(transcripts, 'in-window-b.jsonl'), join(worktree, 'c.jsonl'));
  cpSync(join(transcripts, 'after-window.jsonl'), join(worktree, 'd.jsonl'));
  return home;
}

test('the four sessions yield 5 messages, 1 merge decision and 2 sessions', () => {
  const counts = scanTranscripts(sessions, windowOf(snapshot()));
  assert.deepEqual(counts, { messages: 5, mergeDecisions: 1, sessions: 2 });
});

test('the interventions line reports the rate per merged pull request', () => {
  const counts = scanTranscripts(sessions, windowOf(snapshot()));
  const out = line(snapshot({ interventions: counts })).split('\n');
  assert.equal(
    out[0],
    'interventions: 1.67 per merged PR (5 messages, 1 merge decision excluded, 2 sessions)',
  );
});

test('a snapshot with no transcripts says so', () => {
  const out = line(snapshot()).split('\n');
  assert.equal(out[0], 'interventions: no transcripts');
});

test('the directory scan matches the consumer slug and its worktree siblings', () => {
  const home = tempHome();
  const counts = readInterventions('D:/Consumer', windowOf(snapshot()), home);
  assert.deepEqual(counts, { messages: 5, mergeDecisions: 1, sessions: 2 });
});

test('a consumer with no transcript directory scans to null', () => {
  const home = tempHome();
  assert.equal(readInterventions('D:/Absent', windowOf(snapshot()), home), null);
});

test('a consumer with no COMMITMENTS.md declares nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'score-consumer-'));
  assert.equal(readCommitments(dir), null);
  const out = line(snapshot()).split('\n');
  assert.equal(out[1], 'executed: none declared');
});

test('the ledger counts executed rows over marked rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'score-consumer-'));
  cpSync(join(fixtures, 'commitments-sample.md'), join(dir, 'COMMITMENTS.md'));
  const counts = readCommitments(dir);
  assert.deepEqual(counts, { marked: 2, total: 4 });
  assert.deepEqual(countCommitments('no table here'), { marked: 0, total: 0 });
  const out = line(snapshot({ commitments: counts })).split('\n');
  assert.equal(out[1], 'executed: 2 of 4 marked');
});
