// Founder messages per merged pull request, and the commitment ledger's rate.
// Nothing here reads a home directory or a project path; the caller passes the
// file paths in, and line() formats from the snapshot alone.
import { readFileSync } from 'node:fs';
import { calendarDate, mergedPullRequests, splitRow } from './consumer.mjs';

const DECISION = /\b(approve|approved|merge|lgtm)\b/i;
const DECISION_WORDS = 12;

// A record the founder typed. Tool results arrive with an array for content;
// task notifications, system reminders, slash commands and hook output all
// arrive wrapped in a tag; meta records are the harness talking to itself.
export function isFounderMessage(record) {
  if (!record || record.type !== 'user' || record.isMeta === true) return false;
  const content = record.message?.content;
  if (typeof content !== 'string') return false;
  const text = content.trim();
  return text !== '' && !text.startsWith('<');
}

// A short founder message carrying one of the approval words. The length gate
// is what keeps a long message that happens to name a pull request out.
export function isMergeDecision(content) {
  const words = content.trim().split(/\s+/);
  return words.length <= DECISION_WORDS && DECISION.test(content);
}

// One session file: its founder messages, how many of those were merge
// decisions, and the timestamp of the first founder message.
export function scanSession(path) {
  const counts = { messages: 0, mergeDecisions: 0, firstTimestamp: null };
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
    if (isMergeDecision(record.message.content)) counts.mergeDecisions += 1;
    else counts.messages += 1;
  }
  return counts;
}

// A session is inside the window when its first founder message falls on or
// between the window's dates, read in the window's own offset.
export function inWindow(firstTimestamp, window) {
  if (!firstTimestamp) return false;
  const day = calendarDate(firstTimestamp, window.offset);
  return day >= window.start && day <= window.end;
}

// The derived counts for a set of session files. This is what goes in the
// snapshot, so a replay needs no transcripts.
export function scanTranscripts(paths, window) {
  const totals = { messages: 0, mergeDecisions: 0, sessions: 0 };
  for (const path of paths) {
    const session = scanSession(path);
    if (!inWindow(session.firstTimestamp, window)) continue;
    totals.messages += session.messages;
    totals.mergeDecisions += session.mergeDecisions;
    totals.sessions += 1;
  }
  return totals;
}

// The commitment ledger's Executed column. A row holds executed, partial or
// not; executed counts as done. A blank cell is unmarked and stays out of the
// denominator. Returns { marked: done rows, total: rows carrying a word }.
export function countCommitments(markdown) {
  let column = null;
  let marked = 0;
  let total = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trimStart().startsWith('|')) {
      column = null;
      continue;
    }
    const cells = splitRow(line);
    if (/^[\s:-]+$/.test(cells.join(''))) continue;
    if (column === null) {
      const index = cells.findIndex((cell) => /^executed$/i.test(cell));
      if (index >= 0) column = index;
      continue;
    }
    const word = (cells[column] ?? '').toLowerCase();
    if (!/^(executed|partial|not)$/.test(word)) continue;
    total += 1;
    if (word === 'executed') marked += 1;
  }
  return { marked, total };
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
