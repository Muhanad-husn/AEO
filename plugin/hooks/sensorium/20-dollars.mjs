// The sensorium's second section (#182): dollars spent against the consumer's own
// ceiling, read from its LEDGER.md.
//
// This reads whichever repository the session is in, not this plugin's own files --
// `root` is the resolved worktree passed in by sensorium.mjs, same as 10-score.mjs.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseLedger } from '../ledger.mjs';

export const name = '20-dollars';

/** Two decimals, because the score script prints dollars to two decimals and the
 *  founder reads both. */
function twoDecimals(n) {
  return n.toFixed(2);
}

export function render({ root }) {
  // No worktree (session-status.mjs's own not-a-repo case) has no LEDGER.md to
  // read either; same report as a worktree with none.
  if (!root) return ['dollars: none declared'];
  const abs = path.join(root, 'LEDGER.md');
  if (!existsSync(abs)) return ['dollars: none declared'];
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    return [`dollars: LEDGER.md present, unreadable (${err.message})`];
  }
  const parsed = parseLedger(text);
  if (parsed.error) {
    return [`dollars: LEDGER.md present, unreadable (${parsed.error})`];
  }
  const spent = parsed.ceiling - parsed.balance;
  return [`dollars: ${twoDecimals(spent)} of ${parsed.ceiling}, balance ${twoDecimals(parsed.balance)} (LEDGER.md)`];
}
