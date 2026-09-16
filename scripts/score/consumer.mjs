// The window, days, dollars and pull requests, computed from a snapshot alone.
// Nothing here reads git, GitHub or the filesystem.

// parseStatusTable, splitRow, phaseNumber, phaseRow and isDone moved to
// plugin/hooks/status-table.mjs (#181), which the sensorium's score section also
// reads. Re-exported here, unchanged in contract, so this module's own callers and
// tests/scripts/score.test.mjs see no difference.
import { columnIndex, isDone, parseStatusTable, phaseNumber, phaseRow, splitRow } from '../../plugin/hooks/status-table.mjs';

export { isDone, parseStatusTable, phaseNumber, phaseRow, splitRow };

// The milestone title for a row: the Milestone cell where the table has one,
// else "Phase N" from the row's leading number.
export function milestoneOf(table, row) {
  const index = columnIndex(table.headers, 'milestone');
  const cell = index >= 0 ? row[index] : '';
  return cell || `Phase ${phaseNumber(row[0])}`;
}

// A UTC offset like "+02:00" as milliseconds.
export function offsetMs(offset) {
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(offset);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3])) * 60000;
}

// The calendar date of an instant, read in the given offset.
export function calendarDate(iso, offset) {
  return new Date(Date.parse(iso) + offsetMs(offset)).toISOString().slice(0, 10);
}

export function inclusiveDays(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
}

function sumDollars(rows, from, to) {
  let total = 0;
  for (const row of rows) {
    if (row.phase === null || row.phase === undefined) continue;
    if (row.phase < from || row.phase > to) continue;
    total += row.dollars;
  }
  return total;
}

// The window a snapshot covers: the phase range, the offset its dates are read
// in, and the first and last calendar dates. An open last phase closes the
// window at the time the snapshot was taken.
export function windowOf(snapshot) {
  const gate = snapshot.gateCommit;
  const closingTime = gate ? gate.date : snapshot.recordedAt;
  const offset = closingTime.slice(-6);
  return {
    from: snapshot.phases.from,
    to: snapshot.phases.to,
    open: !gate,
    closingTime,
    offset,
    start: calendarDate(snapshot.firstCommit.date, offset),
    end: calendarDate(closingTime, offset),
  };
}

// The pull requests merged on or before the window closes.
export function mergedPullRequests(snapshot, window = windowOf(snapshot)) {
  const cutoff = Date.parse(window.closingTime);
  return snapshot.pullRequests.filter((pr) => Date.parse(pr.mergedAt) <= cutoff);
}

// A record has no phase range, no ledger and no live pull request list: it is
// a hand-copied total, named by its `record` field.
function isRecord(snapshot) {
  return Boolean(snapshot.record);
}

// The first five lines of the row, for a record snapshot: a single window
// bounded by first and last commit dates, a plain dollars total, and a
// pull request total with its merged count.
function recordRow(snapshot) {
  const start = snapshot.firstCommit.date.slice(0, 10);
  const end = snapshot.lastCommit.date.slice(0, 10);
  const lines = [`consumer: ${snapshot.consumer} (from record)`];
  lines.push(`phases: all, ${start} to ${end}`);
  lines.push(`days: ${inclusiveDays(start, end)}`);
  lines.push(`dollars: ${snapshot.dollars.toFixed(2)}`);
  lines.push(`prs: ${snapshot.pullRequests.merged} merged of ${snapshot.pullRequests.total}`);
  return lines.join('\n');
}

// The first five lines of the row.
export function row(snapshot) {
  if (isRecord(snapshot)) return recordRow(snapshot);

  const window = windowOf(snapshot);
  const { from, to, start, end } = window;

  const lines = [`consumer: ${snapshot.consumer}`];
  lines.push(window.open ? `phases: ${from} to ${to}, open` : `phases: ${from} to ${to}, ${start} to ${end}`);
  lines.push(`days: ${inclusiveDays(start, end)}`);

  const ledgerRows = snapshot.ledger?.rows ?? [];
  lines.push(ledgerRows.length === 0
    ? 'dollars: no ledger'
    : `dollars: ${sumDollars(ledgerRows, from, to).toFixed(2)}`);

  lines.push(`prs: ${mergedPullRequests(snapshot, window).length} merged`);
  return lines.join('\n');
}
