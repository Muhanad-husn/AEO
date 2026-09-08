// Every live read the score makes. Nothing else in scripts/score/ touches git,
// GitHub or the filesystem.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseStatusTable, phaseNumber, isDone, phaseRow, milestoneOf } from './consumer.mjs';

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

// The current time as an ISO string carrying the machine's own UTC offset, the
// same shape git's %cI uses.
function nowWithOffset(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(date.getTime() + minutes * 60000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(minutes / 60)}:${pad(minutes % 60)}`;
}

function consumerName(remote) {
  const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote.trim());
  return match ? match[1] : remote.trim();
}

// The commit that put "done" in the last phase's State cell. The search text is
// the row's own markdown through that cell, so a later edit elsewhere in the row
// does not move the gate.
function gateCommit(dir, table, phase) {
  const row = phaseRow(table, phase);
  if (!row || !isDone(table, row)) return null;
  const index = table.rows.indexOf(row);
  const raw = table.raw[index + 2];
  const state = table.headers.findIndex((h) => h.toLowerCase() === 'state');
  const needle = raw.split('|').slice(0, state + 2).join('|') + '|';
  const out = run('git', ['log', '-S', needle, '--format=%H %cI', '--', 'PLAN.md'], dir);
  if (!out) return null;
  // The oldest match introduced the cell; later matches would be reformattings.
  const [sha, date] = out.split('\n').at(-1).split(' ');
  return { sha, date };
}

function firstCommit(dir) {
  const out = run('git', ['log', '--reverse', '--format=%H %cI'], dir).split('\n')[0];
  const [sha, date] = out.split(' ');
  return { sha, date };
}

function splitRow(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
}

// The ledger's phase and dollars columns. A row with no phase is not spend
// inside any phase range and is dropped.
function readLedger(dir) {
  const path = join(dir, 'LEDGER.md');
  if (!existsSync(path)) return { present: false, rows: [] };
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const rows = [];
  let headers = null;
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) { headers = null; continue; }
    const cells = splitRow(line);
    if (/^[\s:-]+$/.test(cells.join(''))) continue;
    if (!headers) {
      if (cells.some((c) => /^phase$/i.test(c)) && cells.some((c) => /^dollars$/i.test(c))) {
        headers = cells.map((c) => c.toLowerCase());
      }
      continue;
    }
    const phase = phaseNumber(cells[headers.indexOf('phase')]);
    const dollars = Number(cells[headers.indexOf('dollars')]);
    if (phase === null || !Number.isFinite(dollars)) continue;
    rows.push({ phase, dollars });
  }
  return { present: true, rows };
}

function ghJson(args, dir) {
  return JSON.parse(run('gh', args, dir));
}

// One plain object holding every live read, keys in a stable order.
export function read(dir, phases) {
  const markdown = readFileSync(join(dir, 'PLAN.md'), 'utf8');
  const table = parseStatusTable(markdown);
  const prs = ghJson(['pr', 'list', '--state', 'merged', '--limit', '500', '--json', 'number,mergedAt'], dir);
  const issues = ghJson(['issue', 'list', '--state', 'all', '--limit', '500', '--json', 'number,milestone,state'], dir);
  return {
    recordedAt: nowWithOffset(),
    consumer: consumerName(run('git', ['remote', 'get-url', 'origin'], dir)),
    phases,
    firstCommit: firstCommit(dir),
    statusTable: table
      ? {
        headers: table.headers,
        rows: table.rows,
        milestones: table.rows.map((r) => ({ phase: phaseNumber(r[0]), milestone: milestoneOf(table, r) })),
      }
      : null,
    gateCommit: gateCommit(dir, table, phases.to),
    ledger: readLedger(dir),
    pullRequests: prs
      .filter((pr) => pr.mergedAt)
      .map((pr) => ({ number: pr.number, mergedAt: pr.mergedAt }))
      .sort((a, b) => a.number - b.number),
    issues: issues
      .map((i) => ({ number: i.number, state: i.state, milestone: i.milestone?.title ?? null }))
      .sort((a, b) => a.number - b.number),
  };
}

export function load(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function serialise(snapshot) {
  return JSON.stringify(snapshot, null, 2) + '\n';
}
