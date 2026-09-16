// The sensorium's fourth section (#184): the commitment ledger's newest row, and the
// ledger's rate over the same terms as scripts/score/interventions.mjs's executed
// line.
//
// This reads whichever repository the session is in, not this plugin's own ledger --
// `root` is the resolved worktree passed in by sensorium.mjs, same contract as
// 10-score.mjs.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { FILE_NAME, countCommitments, parseCommitments } from '../commitments.mjs';

export const name = '40-commitment';

function readLedger(root) {
  const file = path.join(root, FILE_NAME);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The newest row, unjudged printed by name rather than a blank word. */
function commitmentLine(rows) {
  if (rows.length === 0) return 'commitment: none declared';
  const newest = rows[rows.length - 1];
  const word = newest.word === '' ? 'unjudged' : newest.word;
  return `commitment: ${newest.date} "${newest.text}" ${word}`;
}

function executedLine(markdown) {
  if (markdown === null) return 'executed: none declared';
  const { marked, total } = countCommitments(markdown);
  return `executed: ${marked} of ${total} marked`;
}

export function render({ root }) {
  // No worktree (session-status.mjs's own not-a-repo case) has no COMMITMENTS.md to
  // read either; same report as a worktree with none.
  if (!root) return ['commitment: none declared', 'executed: none declared'];
  const markdown = readLedger(root);
  const rows = markdown === null ? [] : parseCommitments(markdown);
  return [commitmentLine(rows), executedLine(markdown)];
}
