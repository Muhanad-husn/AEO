// The commitment ledger, read and written (#184): COMMITMENTS.md at a consuming
// project's root, one row per founder recommendation.
//
// plugin/scripts/commitment.mjs is the only writer -- record appends a row, mark
// judges the newest unjudged one. plugin/hooks/sensorium/40-commitment.mjs is a
// reader, and so is scripts/score/interventions.mjs's countCommitments, moved here
// from that file. scripts/score/interventions.mjs and scripts/score/sources.mjs
// import their piece back and re-export it unchanged, so
// tests/scripts/score-interventions.test.mjs and tests/fixtures/score/
// commitments-sample.md see no difference.
//
// PIPE ESCAPING. A recommendation can itself contain "|", which would otherwise read
// as a new table column and shift every plain column-index reader after it --
// including countCommitments's own. Writing replaces "|" with a token that contains
// no pipe character at all, so no reader downstream needs to know escaping happened;
// reading reverses it only where the text is surfaced back to a person.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { splitRow } from './status-table.mjs';

export const FILE_NAME = 'COMMITMENTS.md';
export const HEADER_LINE = '| Date | Recommendation | Executed |';
export const SEPARATOR_LINE = '| --- | --- | --- |';
export const WORDS = ['executed', 'partial', 'not'];

const PIPE_TOKEN = '&#124;';

export function escapeCell(text) {
  return text.split('|').join(PIPE_TOKEN);
}

export function unescapeCell(text) {
  return text.split(PIPE_TOKEN).join('|');
}

// Local calendar date, YYYY-MM-DD -- the machine's own clock, not a commit's offset
// the way scripts/score/consumer.mjs's calendarDate reads one: a session's date is
// what the founder reads. The same rule plugin/scripts/runlog.mjs's own
// todayLocalDate follows, kept here rather than shared because runlog.mjs anchors to
// a different concern (a job's log directory name) and the two would drift apart for
// no benefit.
export function todayLocalDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isSeparatorLine(line) {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line ?? '');
}

/**
 * Every data row of the ledger's own three-column table -- { date, text, word, line }
 * in file order. `line` is the row's 0-based index into `markdown.split(/\r?\n/)`, so
 * a writer (mark) can rewrite it in place without re-serialising the whole file.
 * `word` is lower-cased and blank ('') for an unjudged row; `text` is unescaped. A
 * file with no Date/Recommendation/Executed header, in that order, parses to no rows.
 */
export function parseCommitments(markdown) {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trimStart().startsWith('|')) continue;
    const headers = splitRow(line).map((cell) => cell.toLowerCase());
    if (headers[0] !== 'date' || headers[1] !== 'recommendation' || headers[2] !== 'executed') continue;
    if (!isSeparatorLine(lines[i + 1])) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      if (!lines[j].trimStart().startsWith('|')) break;
      const cells = splitRow(lines[j]);
      rows.push({
        date: cells[0] ?? '',
        text: unescapeCell(cells[1] ?? ''),
        word: (cells[2] ?? '').trim().toLowerCase(),
        line: j,
      });
    }
    return rows;
  }
  return [];
}

/**
 * The Executed column of any table that has one: marked rows over rows carrying a
 * word (executed, partial or not). A blank cell is unjudged and stays out of the
 * denominator. Moved here from scripts/score/interventions.mjs (#184), unchanged in
 * contract -- that module and scripts/score/sources.mjs re-export it, and this reads
 * any table with an Executed column, not only this ledger's Date/Recommendation/
 * Executed shape: tests/fixtures/score/commitments-sample.md has no Date column at
 * all and still counts correctly.
 */
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

// The ledger's rate at `dir`, or null when it declares none (no COMMITMENTS.md).
// Moved here from scripts/score/sources.mjs (#184); that module re-exports it.
export function readCommitments(dir) {
  const file = path.join(dir, FILE_NAME);
  if (!existsSync(file)) return null;
  return countCommitments(readFileSync(file, 'utf8'));
}
