// The sensorium's runs section (#183): the live sentinels under .aeo/runs/, and the
// newest logs/<dir>/run.jsonl's last record as one line.
//
// findNewestRunLog and compareRunLogs moved here from session-status.mjs, which used
// them to excerpt logs/<dir>/summary.md. That excerpt is gone (#183): a session no
// longer reads a run's own prose, only its structured record. The selection order is
// unchanged -- date prefix, then mtime, then name -- but what it selects among is now
// run.jsonl's presence, not summary.md's, since this section reads the structured
// record and never the prose file.
//
// inspectRuns (sentinel.mjs) does the sentinel reading; every one of its four buckets
// -- live, stale, unreadable, dirError -- is printed here. Dropping any of them would
// be the same silent-pass L-08 already names for the sandbox guard's own read of this
// same directory: an unreadable sentinel blocks the test command, and a session that
// cannot see why should not be left guessing.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { inspectRuns } from '../sentinel.mjs';

export const name = '30-runs';

// Same convention as session-status.mjs's own run logs: `<YYYY-MM-DD>-<job>`.
const RUN_LOG_DATE = /^(\d{4}-\d{2}-\d{2})\b/;

/**
 * Newest first. Four keys, each doing work the one before it could not (carried
 * unchanged from session-status.mjs, #181/#183):
 *
 * 1. Dated directories outrank undated ones.
 * 2. Date descending -- the run's own date, not when a file was last touched.
 * 3. mtime descending -- real signal within one date, and the only signal at all for
 *    undated directories.
 * 4. Name descending -- directory names are unique, so this always decides.
 */
function compareRunLogs(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1; // '' sorts last, so undated ranks below dated
  if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
  return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
}

/** The newest `logs/<job>/run.jsonl` under `root`, or null when none exists. */
function findNewestRunLog(root) {
  const logsDir = path.join(root, 'logs');
  if (!existsSync(logsDir)) return null;

  let entries;
  try {
    entries = readdirSync(logsDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runPath = path.join(logsDir, entry.name, 'run.jsonl');
    if (!existsSync(runPath)) continue;
    let mtimeMs;
    try {
      mtimeMs = statSync(runPath).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({ name: entry.name, date: RUN_LOG_DATE.exec(entry.name)?.[1] ?? '', mtimeMs, runPath });
  }
  if (candidates.length === 0) return null;
  return candidates.sort(compareRunLogs)[0];
}

/**
 * The `last run:` line: the newest run.jsonl's last non-empty line, parsed as JSON
 * (runlog.mjs's fixed envelope -- ts, job, unit, status, duration, detail). `unit:
 * 'run'` is the close record (runlog.mjs's `close` subcommand), reported as `closed
 * <status> <timestamp>` rather than counted among the job's own units.
 */
function lastRunLine(root) {
  const newest = findNewestRunLog(root);
  if (!newest) return 'last run: none';

  let text;
  try {
    text = readFileSync(newest.runPath, 'utf8');
  } catch (err) {
    return `last run: logs/${newest.name}, unreadable (${err.message})`;
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return `last run: logs/${newest.name}, no records yet`;

  let record;
  try {
    record = JSON.parse(lines[lines.length - 1]);
  } catch (err) {
    return `last run: logs/${newest.name}, unreadable (${err.message})`;
  }
  if (record?.unit === 'run') {
    return `last run: logs/${newest.name}, closed ${record.status} ${record.ts}`;
  }
  return `last run: logs/${newest.name}, ${record?.unit}, ${record?.status}, ${record?.ts}`;
}

/**
 * `runs:` -- the sentinel count and every sentinel inspectRuns names, live and stale
 * alike, plus anything it could not read. `stale`'s own trailing "(owner process is
 * gone)" is replaced with the shorter marker this section's acceptance criterion asks
 * for, `(stale, owner gone)`, on the same description text inspectRuns already built.
 */
function runsLines(root) {
  const { live, stale, unreadable, dirError } = inspectRuns(root);
  if (live.length === 0 && stale.length === 0 && unreadable.length === 0 && dirError === null) {
    return ['runs: none live'];
  }
  const lines = [`runs: ${live.length} live`];
  for (const entry of live) lines.push(`  ${entry}`);
  for (const entry of stale) {
    lines.push(`  ${entry.replace(/ \(owner process is gone\)$/, '')} (stale, owner gone)`);
  }
  for (const entry of unreadable) lines.push(`  ${entry} (unreadable)`);
  if (dirError !== null) lines.push(`  ${dirError}`);
  return lines;
}

export function render({ root }) {
  if (!root) return ['runs: none live', 'last run: none'];
  return [...runsLines(root), lastRunLine(root)];
}
