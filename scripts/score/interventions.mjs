// Founder messages per merged pull request, and the commitment ledger's rate.
// Nothing here reads a home directory or a project path; the caller passes the
// file paths in, and line() formats from the snapshot alone.
//
// countCommitments moved to plugin/hooks/commitments.mjs (#184), which the
// sensorium's commitment section also reads. Re-exported here, unchanged in
// contract, so this module's own callers and tests/scripts/score-interventions.test.mjs
// see no difference.
import { readFileSync } from 'node:fs';
import { calendarDate, mergedPullRequests } from './consumer.mjs';
import { countCommitments } from '../../plugin/hooks/commitments.mjs';

export { countCommitments };

const DECISION = /\b(approve|approved|merge|lgtm)\b/i;
const DECISION_WORDS = 12;

// A slash command typed as a bare string: a slash, a command word, then a space
// or the end. A path such as /tmp/log.txt has a second slash and does not match.
const SLASH_COMMAND = /^\/[A-Za-z][\w:.-]*(\s|$)/;
const CONTINUATION = 'This session is being continued from a previous conversation';

// A record the founder typed. Tool results arrive with an array for content;
// task notifications, system reminders and hook output arrive wrapped in a tag;
// meta records are the harness talking to itself. Two plain-string records are
// not the founder either: a slash command (or any record the transcript marks
// as a compact summary) and a session-continuation summary.
export function isFounderMessage(record) {
  if (!record || record.type !== 'user' || record.isMeta === true) return false;
  const content = record.message?.content;
  if (typeof content !== 'string') return false;
  const text = content.trim();
  if (record.isCompactSummary === true) return false;
  if (SLASH_COMMAND.test(text) || text.startsWith(CONTINUATION)) return false;
  return text !== '' && !text.startsWith('<');
}

// A short founder message carrying one of the approval words. The length gate
// is what keeps a long message that happens to name a pull request out.
export function isMergeDecision(content) {
  const words = content.trim().split(/\s+/);
  return words.length <= DECISION_WORDS && DECISION.test(content);
}

// One session file: its founder messages, each with its own timestamp and
// whether it was a merge decision, and the timestamp of the first one.
export function scanSession(path) {
  const counts = { messages: [], firstTimestamp: null };
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const text = raw.trim();
    if (text === '') continue;
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      continue;
    }
    if (!isFounderMessage(record)) continue;
    if (counts.firstTimestamp === null) counts.firstTimestamp = record.timestamp ?? null;
    counts.messages.push({
      timestamp: record.timestamp ?? null,
      mergeDecision: isMergeDecision(record.message.content),
    });
  }
  return counts;
}

// A message is inside the window when its own timestamp is on or after the
// window's first date and no later than the closing time. A session is inside
// the window when its first founder message is.
export function messageInWindow(timestamp, window) {
  if (!timestamp) return false;
  if (Date.parse(timestamp) > Date.parse(window.closingTime)) return false;
  return calendarDate(timestamp, window.offset) >= window.start;
}

// The derived counts for a set of session files. This is what goes in the
// snapshot, so a replay needs no transcripts.
export function scanTranscripts(paths, window) {
  const totals = { messages: 0, mergeDecisions: 0, sessions: 0 };
  for (const path of paths) {
    const session = scanSession(path);
    if (!messageInWindow(session.firstTimestamp, window)) continue;
    for (const message of session.messages) {
      if (!messageInWindow(message.timestamp, window)) continue;
      if (message.mergeDecision) totals.mergeDecisions += 1;
      else totals.messages += 1;
    }
    totals.sessions += 1;
  }
  return totals;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function interventionsLine(snapshot) {
  const counts = snapshot?.interventions;
  if (!counts) return 'interventions: no transcripts';
  const detail = [
    plural(counts.messages, 'message'),
    `${plural(counts.mergeDecisions, 'merge decision')} excluded`,
    plural(counts.sessions, 'session'),
  ].join(', ');
  const merged = mergedPullRequests(snapshot).length;
  if (merged === 0) return `interventions: no merged PRs (${detail})`;
  return `interventions: ${(counts.messages / merged).toFixed(2)} per merged PR (${detail})`;
}

function executedLine(snapshot) {
  const counts = snapshot?.commitments;
  if (!counts) return 'executed: none declared';
  return `executed: ${counts.marked} of ${counts.total} marked`;
}

export function line(snapshot) {
  return `${interventionsLine(snapshot)}\n${executedLine(snapshot)}`;
}
