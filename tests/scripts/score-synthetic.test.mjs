// Slash commands and session-continuation summaries are not founder messages,
// messages count only inside the window, and a milestone window reads its
// dates in the closing commit's UTC offset. All transcripts here are synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { windowOf } from '../../scripts/score/consumer.mjs';
import { isFounderMessage, scanSession, scanTranscripts } from '../../scripts/score/interventions.mjs';

function user(content, timestamp, extra = {}) {
  return { type: 'user', message: { role: 'user', content }, timestamp, ...extra };
}

function writeSession(records) {
  const dir = mkdtempSync(join(tmpdir(), 'score-synthetic-'));
  const path = join(dir, 'session.jsonl');
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}

const CONTINUATION = 'This session is being continued from a previous conversation that ran out of context. Summary follows.';

test('a slash command record is not a founder message', () => {
  assert.equal(isFounderMessage(user('/compact', '2026-09-06T10:00:00Z')), false);
  assert.equal(isFounderMessage(user('/model opus', '2026-09-06T10:00:00Z')), false);
  assert.equal(isFounderMessage(user('/aeo:status', '2026-09-06T10:00:00Z')), false);
});

test('a path that starts with a slash is still a founder message', () => {
  assert.equal(isFounderMessage(user('/tmp/out/log.txt has the failure', '2026-09-06T10:00:00Z')), true);
});

test('a record the transcript marks as a compact summary is not a founder message', () => {
  assert.equal(isFounderMessage(user('Plain summary text.', '2026-09-06T10:00:00Z', { isCompactSummary: true })), false);
});

test('a session-continuation summary is not a founder message', () => {
  assert.equal(isFounderMessage(user(CONTINUATION, '2026-09-06T10:00:00Z')), false);
  assert.equal(isFounderMessage(user(`  ${CONTINUATION}`, '2026-09-06T10:00:00Z')), false);
});

test('a session counts only the real founder messages', () => {
  const path = writeSession([
    user('/compact', '2026-09-06T10:00:00Z'),
    user(CONTINUATION, '2026-09-06T10:01:00Z', { isCompactSummary: true }),
    user('Write the red tests first.', '2026-09-06T10:02:00Z'),
  ]);
  const counts = scanSession(path);
  assert.equal(counts.messages.length, 1);
  assert.equal(counts.firstTimestamp, '2026-09-06T10:02:00Z');
});

const window = windowOf({
  recordedAt: '2026-09-07T23:00:00+02:00',
  phases: { from: 0, to: 5 },
  firstCommit: { sha: 'a', date: '2026-09-06T09:00:00+02:00' },
  gateCommit: { sha: 'b', date: '2026-09-07T17:02:00+02:00' },
  pullRequests: [],
});

test('messages sent after the window closes are not counted, though the session began inside it', () => {
  const path = writeSession([
    user('Start the slice.', '2026-09-07T10:00:00Z'),
    user('Approve and merge it.', '2026-09-07T14:00:00Z'),
    user('One more thing before the gate.', '2026-09-07T15:01:00Z'),
    user('A message after the gate.', '2026-09-07T15:03:00Z'),
    user('Approved.', '2026-09-07T18:00:00Z'),
  ]);
  const counts = scanTranscripts([path], window);
  assert.deepEqual(counts, { messages: 2, mergeDecisions: 1, sessions: 1 });
});

test('a session whose first real message falls outside the window is skipped', () => {
  const path = writeSession([
    user('/compact', '2026-09-07T10:00:00Z'),
    user('Late message.', '2026-09-08T10:00:00Z'),
  ]);
  assert.deepEqual(scanTranscripts([path], window), { messages: 0, mergeDecisions: 0, sessions: 0 });
});

const milestone = (extra) => ({
  recordedAt: '2026-10-01T12:00:00+02:00',
  milestone: { title: 'M', createdAt: '2026-09-28T03:00:00Z', closedAt: '2026-09-30T17:07:00Z', ...extra },
});

test('a milestone window reads its dates in the closing commit offset', () => {
  const w = windowOf(milestone({ closingCommit: { sha: 'c', date: '2026-09-30T19:05:00+02:00' } }));
  assert.equal(w.offset, '+02:00');
  assert.equal(w.end, '2026-09-30');
});

test('a milestone closed in UTC with no closing commit reads in +00:00, never a slice of the time', () => {
  assert.equal(windowOf(milestone({})).offset, '+00:00');
});
