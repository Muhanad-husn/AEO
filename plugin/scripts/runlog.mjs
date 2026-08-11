#!/usr/bin/env node
// Open, append to, and close a structured run log for a long-running job.
//
// WHY THIS EXISTS. A lane or a subagent runs a job that takes minutes to hours and wants
// a durable record of what happened — not for this session's context window, but for the
// founder tailing it live and for P3.2's monitor reading it after the fact. A subagent
// cannot `import` a module, only shell out to one, so this is a CLI with three
// subcommands, not a library (the design call recorded in
// logs/2026-08-11-phase-3-observability/summary.md).
//
//   node runlog.mjs open   --job <name> [--date <YYYY-MM-DD>]
//   node runlog.mjs record --dir <path> --job <name> --unit <name> --status <text>
//                           [--duration <ms>] [--detail <text>]
//   node runlog.mjs close  --dir <path> --job <name> --status <text>
//                           [--duration <ms>] [--detail <text>]
//
// The usual shape, from the shell running the job:
//
//   dir=$(node runlog.mjs open --job corpus-ingest)
//   node runlog.mjs record --dir "$dir" --job corpus-ingest --unit fetch --status ok --duration 4200
//   some-long-command >> "$dir/console.log" 2>&1
//   node runlog.mjs record --dir "$dir" --job corpus-ingest --unit ingest --status ok --duration 812000
//   node runlog.mjs close  --dir "$dir" --job corpus-ingest --status ok
//
// TWO STREAMS, ONE SPLIT. `run.jsonl` is structured — one JSON object per line, read by
// machines (P3.2's monitor). `console.log` is free text, written by shell redirection
// (`>> console.log 2>&1`), not by a subcommand here: a job's own stdout/stderr is
// arbitrary bytes, and giving it a subcommand would just re-implement `>>`. Read the
// split off the file, not off this script: if it is one JSON object per line, it came
// from `record` or `close`; anything else is console.log's business.
//
// THE FIXED ENVELOPE (EN-14). Every record in run.jsonl carries exactly six keys — ts,
// job, unit, status, duration, detail — never more, never fewer. `ts` is
// `Date().toISOString()`, real UTC (L-09: PowerShell's `-Format 'u'` prints local time
// with a misleading trailing Z; this does not). `duration` is milliseconds, an integer
// >= 0. `--duration` and `--detail` default to 0 and '' when omitted, so a minimal call
// still writes a complete record — no ad-hoc keys, and no record missing a key either.
//
// WHY --dir IS REQUIRED ON record AND close, RATHER THAN RECOMPUTED FROM --job/--date.
// `open` can suffix the directory name on a collision (below), so the directory that
// actually got created is not always `<date>-<job>`. Re-deriving it would guess wrong
// exactly when a second run of the same job on the same day is the interesting case. The
// caller already has the path — `open` printed it — so it is passed forward, the same
// way a shell variable would be.
//
// WHY --job IS PASSED AGAIN TO record AND close, RATHER THAN PARSED BACK OUT OF --dir.
// The directory name is `<date>-<job>`, possibly with a `-<n>` collision suffix, and a
// job name can itself contain digits and dashes indistinguishable from either. Passing
// the job explicitly is one extra flag against a parser that would silently mis-split a
// real job name.
//
// COLLISIONS (two jobs sharing a date and name). `open` never reuses an existing
// directory: it appends `-2`, `-3`, ... to find a free one. Reusing would let a second
// run's records interleave with the first run's in the same run.jsonl, and the first
// run's evidence would no longer be attributable to itself — the exact failure L-08
// names ("closure requires named evidence"). A human who deliberately wants one shared
// directory can bypass `open` a second time and pass an existing `--dir` straight to
// `record`/`close`.
//
// AN OPENED-BUT-EMPTY RUN VS. NO RUN AT ALL (L-08). `open` creates run.jsonl and
// console.log as empty files immediately, before any record exists. So a directory can
// be in one of three states, distinguishable on disk with no extra bookkeeping file: it
// does not exist (no run was ever started); it exists with an empty run.jsonl (opened,
// nothing recorded yet — instrumented and idle); it exists with records (a run in
// progress or finished). A monitor reading "0 records" must not read that as "not
// instrumented" — L-08's own example is a healthy run that looked exactly like that
// under a monitor built for a different shape.
//
// WHAT close DOES, AND WHY BOTH. It appends one more record to run.jsonl with
// `unit: 'run'` — a reserved unit name a monitor can look for as the run's own terminal
// record, distinct from whatever names the lane gave its steps. It also appends a
// closing line to summary.md. Neither replaces the other: run.jsonl's close record is
// for the monitor (machine-read, and it exists even if summary.md is never opened by a
// human); summary.md's line is for a human opening the file directly and asking "did
// this finish?" without knowing to look at run.jsonl.
//
// APPEND-ONLY, AND WHY A PARTIAL WRITE CANNOT CORRUPT EARLIER LINES. Every record is
// written with one appendFileSync call carrying the whole line, opened in append mode.
// An append only adds bytes after whatever is already there; it never seeks back into
// existing content, so even a failed or partial write can only damage the line being
// written, never a line already on disk. This is not a multi-writer lock — two processes
// racing to append at the same instant are not ordered against each other — but ordering
// within one job's own sequence of `record`/`close` calls, which is what a single lane
// actually does, is safe.
//
// PROJECT ROOT, NEVER THE PLUGIN ROOT (D12). `${CLAUDE_PLUGIN_ROOT}` is ephemeral; it
// changes on plugin update, so nothing is ever written there. `open` anchors to the
// project repository the same way run-sentinel.mjs does — projectAnchor(), shared from
// hooks/sentinel.mjs rather than re-derived here (V-13 is what happens when two files
// each grow their own copy of the same resolution).

import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { projectAnchor, sentinelId } from '../hooks/sentinel.mjs';

const USAGE = `usage:
  runlog open   --job <name> [--date <YYYY-MM-DD>]
  runlog record --dir <path> --job <name> --unit <name> --status <text> [--duration <ms>] [--detail <text>]
  runlog close  --dir <path> --job <name> --status <text> [--duration <ms>] [--detail <text>]`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value\n${USAGE}`);
  return value;
}

function requiredFlag(argv, name) {
  const value = flag(argv, name);
  if (value === null) fail(`--${name} is required\n${USAGE}`);
  const trimmed = value.trim();
  if (trimmed === '') fail(`--${name} must not be empty`);
  return trimmed;
}

function durationFlag(argv) {
  const raw = flag(argv, 'duration');
  if (raw === null) return 0;
  if (!/^\d+$/.test(raw)) {
    fail(`--duration must be a non-negative integer number of milliseconds, got ${JSON.stringify(raw)}`);
  }
  return Number.parseInt(raw, 10);
}

function detailFlag(argv) {
  return flag(argv, 'detail') ?? '';
}

/** Local calendar date as YYYY-MM-DD, not locale-formatted (L-09: never trust a locale). */
function todayLocalDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function dateFlag(argv) {
  const raw = flag(argv, 'date');
  if (raw === null) return todayLocalDate();
  if (!DATE_RE.test(raw)) fail(`--date must be YYYY-MM-DD, got ${JSON.stringify(raw)}`);
  return raw;
}

/** The directory `open` will use: `<date>-<job>`, suffixed `-2`, `-3`, ... on collision. */
function uniqueLogDir(logsRoot, date, job) {
  const stem = `${date}-${sentinelId(job)}`;
  let candidate = path.join(logsRoot, stem);
  if (!existsSync(candidate)) return candidate;
  for (let n = 2; ; n += 1) {
    candidate = path.join(logsRoot, `${stem}-${n}`);
    if (!existsSync(candidate)) return candidate;
  }
}

function summaryStub(job, date, dir) {
  return (
    `# ${job} — ${date}\n\n` +
    `Opened ${new Date().toISOString()}. No records yet.\n\n` +
    `\`${path.basename(dir)}/run.jsonl\` carries the structured record; \`console.log\` carries raw output.\n`
  );
}

/** Append one envelope-shaped record. The only place the six keys are ever written. */
function appendRecord(dir, { job, unit, status, duration, detail }) {
  const line = `${JSON.stringify({ ts: new Date().toISOString(), job, unit, status, duration, detail })}\n`;
  appendFileSync(path.join(dir, 'run.jsonl'), line, 'utf8');
}

/** Fail unless `dir` is a directory `open` created (a run.jsonl file is the proof). */
function requireOpenedDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    fail(`${dir} does not exist. Run \`runlog open\` first and pass the directory it prints.`);
  }
  if (!existsSync(path.join(dir, 'run.jsonl'))) {
    fail(`${dir} has no run.jsonl, so it was not created by \`runlog open\`.`);
  }
}

const [action, ...rest] = process.argv.slice(2);

if (action === 'open') {
  const job = requiredFlag(rest, 'job');
  const date = dateFlag(rest);
  const anchor = projectAnchor(process.cwd());
  if (anchor === null) {
    fail('runlog must be run inside a repository; no project root was found above the working directory.');
  }

  const dir = uniqueLogDir(path.join(anchor, 'logs'), date, job);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.jsonl'), '');
  writeFileSync(path.join(dir, 'console.log'), '');
  writeFileSync(path.join(dir, 'summary.md'), summaryStub(job, date, dir));
  process.stdout.write(`${dir}\n`);
} else if (action === 'record') {
  const dir = requiredFlag(rest, 'dir');
  const job = requiredFlag(rest, 'job');
  const unit = requiredFlag(rest, 'unit');
  const status = requiredFlag(rest, 'status');
  const duration = durationFlag(rest);
  const detail = detailFlag(rest);
  requireOpenedDir(dir);
  appendRecord(dir, { job, unit, status, duration, detail });
  process.stdout.write(`recorded ${unit} (${status}) to ${path.join(dir, 'run.jsonl')}\n`);
} else if (action === 'close') {
  const dir = requiredFlag(rest, 'dir');
  const job = requiredFlag(rest, 'job');
  const status = requiredFlag(rest, 'status');
  const duration = durationFlag(rest);
  const detail = detailFlag(rest);
  requireOpenedDir(dir);
  appendRecord(dir, { job, unit: 'run', status, duration, detail });
  appendFileSync(path.join(dir, 'summary.md'), `\n_Closed ${new Date().toISOString()}, status: ${status}._\n`, 'utf8');
  process.stdout.write(`closed ${dir}\n`);
} else {
  fail(USAGE);
}
