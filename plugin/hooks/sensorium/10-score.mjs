// The sensorium's first section (#181): the consumer's score, from its own PLAN.md
// status table, and the bar it is read against, from its own RULES.md kill line.
//
// This reads whichever repository the session is in, not this plugin's own PLAN.md --
// `root` is the resolved worktree passed in by sensorium.mjs.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { columnIndex, isDone, parseStatusTable } from '../status-table.mjs';

export const name = '10-score';

// PLAN.md first, docs/PLAN.md as the fallback location some projects use.
const PLAN_CANDIDATES = ['PLAN.md', path.join('docs', 'PLAN.md')];

/** The first status table found under `root`, or null when neither file has one. */
function readPlanTable(root) {
  for (const rel of PLAN_CANDIDATES) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) continue;
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const table = parseStatusTable(text);
    if (table) return table;
  }
  return null;
}

/**
 * `score:` from the last row whose State is done: its Phase cell, its Score cell, and
 * the done count out of every row. A table with no done row prints the count alone,
 * plus `next:` naming the first row -- there is no "latest done phase" to report yet.
 */
function scoreLines(table) {
  const doneRows = table.rows.filter((row) => isDone(table, row));
  if (doneRows.length === 0) {
    return [`score: 0 of ${table.rows.length} phases done`, `next: ${table.rows[0]?.[0] ?? ''}`];
  }
  const last = doneRows[doneRows.length - 1];
  const scoreIndex = columnIndex(table.headers, 'score');
  const scoreCell = scoreIndex >= 0 ? last[scoreIndex] : '';
  return [`score: ${last[0]} done, ${scoreCell} (${doneRows.length} of ${table.rows.length} phases done)`];
}

/**
 * `bar:` from RULES.md's Kill line gate: the sentence after the `**Kill line.**` bold
 * label, first sentence only. Wrapped continuation lines are joined into one line
 * before the sentence is cut, since a kill line's own text runs past one physical line
 * (RLM's does).
 */
function killLineBar(root) {
  const abs = path.join(root, 'RULES.md');
  if (!existsSync(abs)) return 'bar: none declared';
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return 'bar: none declared';
  }
  const label = '**Kill line.**';
  const at = text.indexOf(label);
  if (at === -1) return 'bar: none declared';
  const after = text.slice(at + label.length);
  const paragraph = after.split(/\r?\n[ \t]*\r?\n/)[0]; // up to the next blank line
  const joined = paragraph.replace(/\s+/g, ' ').trim();
  if (!joined) return 'bar: none declared';
  const sentence = /^(.*?[.!?])(\s|$)/.exec(joined);
  return `bar: ${sentence ? sentence[1] : joined}`;
}

export function render({ root }) {
  // No worktree (session-status.mjs's own not-a-repo case) has no PLAN.md to read
  // either; same report as a worktree with none.
  if (!root) return ['score: none declared', 'bar: none declared'];
  const table = readPlanTable(root);
  const lines = table ? scoreLines(table) : ['score: none declared'];
  lines.push(killLineBar(root));
  return lines;
}
