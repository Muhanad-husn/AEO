// The status table reader, shared by scripts/score/consumer.mjs and the sensorium's
// score section (#181).
//
// Moved out of scripts/score/consumer.mjs (which read no filesystem and no git of its
// own) because plugin/hooks/sensorium/10-score.mjs needs the same table parse and
// consumer.mjs is a scripts/ module, not a plugin/hooks/ one -- the hook side has no
// business importing from scripts/, and duplicating the parse was the alternative.
// consumer.mjs imports these back and re-exports them, so its own callers and
// tests/scripts/score.test.mjs see no change.

// A markdown table split into its header cells and its data rows.
export function splitRow(line) {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isSeparator(line) {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

// The first markdown table under a heading containing "Status" whose header row
// starts with "Phase". Returns null when the document has no such table.
export function parseStatusTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  let underStatus = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) {
      underStatus = /status/i.test(line);
      continue;
    }
    if (!underStatus) continue;
    if (!line.trimStart().startsWith('|')) continue;
    const headers = splitRow(line);
    if (!/^Phase\b/i.test(headers[0]) || !isSeparator(lines[i + 1] ?? '')) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      if (!lines[j].trimStart().startsWith('|')) break;
      rows.push(splitRow(lines[j]));
    }
    return { headers, rows, raw: lines.slice(i, i + 2 + rows.length) };
  }
  return null;
}

// The column index for a header name, case-insensitive, or -1 when the table has none.
export function columnIndex(headers, name) {
  return headers.findIndex((h) => h.toLowerCase() === name);
}

// The leading number of a Phase cell, e.g. "5 Report" is phase 5.
export function phaseNumber(cell) {
  const match = /^\s*(\d+)/.exec(cell ?? '');
  return match ? Number(match[1]) : null;
}

// The status row for a phase number, or null.
export function phaseRow(table, phase) {
  if (!table) return null;
  return table.rows.find((row) => phaseNumber(row[0]) === phase) ?? null;
}

export function isDone(table, row) {
  if (!table || !row) return false;
  const state = columnIndex(table.headers, 'state');
  return state >= 0 && (row[state] ?? '').toLowerCase() === 'done';
}
