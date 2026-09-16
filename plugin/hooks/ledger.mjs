// The ledger reader for the sensorium's dollars section (#182): the ceiling from
// the prose above the table, and the balance from the table's last row.
//
// scripts/score/sources.mjs keeps its own ledger read for the phase-range dollars
// sum; that reader wants every row's phase and dollars cell, this one wants only
// the ceiling and the last balance, so the two are not merged here.

import { splitRow } from './status-table.mjs';

function isSeparator(line) {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

/**
 * The first markdown table whose header row has a "balance" column, wherever it
 * sits in the document -- a ledger carries no heading requirement the way the
 * status table does. Returns null when no such table is found, or when it has a
 * header row and no data rows.
 */
function findBalanceTable(lines) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trimStart().startsWith('|')) continue;
    if (!isSeparator(lines[i + 1] ?? '')) continue;
    const headers = splitRow(line);
    const balanceIndex = headers.findIndex((h) => h.toLowerCase() === 'balance');
    if (balanceIndex === -1) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      if (!lines[j].trimStart().startsWith('|')) break;
      rows.push(splitRow(lines[j]));
    }
    if (rows.length === 0) return null;
    return { start: i, balanceIndex, rows };
  }
  return null;
}

/**
 * `{ ceiling, balance, rows }` read from a LEDGER.md's markdown, or `{ error }`
 * naming why it could not be read. The ceiling is the first `$<n>` after the word
 * "Ceiling" in the prose above the table; the balance is the last row's balance
 * cell, read as a number.
 */
export function parseLedger(markdown) {
  const lines = markdown.split(/\r?\n/);
  const table = findBalanceTable(lines);
  if (!table) {
    return { error: 'no table with a balance column' };
  }
  const prose = lines.slice(0, table.start).join('\n');
  const ceilingMatch = /Ceiling[\s\S]*?\$(\d+(?:\.\d+)?)/.exec(prose);
  if (!ceilingMatch) {
    return { error: 'no Ceiling found above the table' };
  }
  const lastRow = table.rows[table.rows.length - 1];
  const balance = Number(lastRow[table.balanceIndex]);
  if (!Number.isFinite(balance)) {
    return { error: 'balance cell is not a number' };
  }
  return { ceiling: Number(ceilingMatch[1]), balance, rows: table.rows };
}
