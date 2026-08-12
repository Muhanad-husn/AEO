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
//   node runlog.mjs worker --dir <path> --worker <id> [--path <relative>]
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
//
// `worker` — THE RUN-SCOPED WRITE PATH (P5.4). Operation workers are bounded mechanical
// tasks run in numbers the task sets, with no worktree and no branch: many of them write
// into one checkout at once. What keeps that safe is that each has a write path belonging
// to it alone, and `worker` is where that path comes from. It is a leaf on the resolution
// that already exists rather than a third resolver: `open` found the project root through
// projectAnchor() and named the run directory, and `worker` only adds
// `workers/<id>/` beneath it. Nothing here re-derives a root.
//
//   scope=$(node runlog.mjs worker --dir "$dir" --worker w1)     # claims it, prints it
//   out=$(node runlog.mjs worker --dir "$dir" --worker w1 --path notes/found.md)
//
// TWO PROPERTIES, AND HOW EACH IS ENFORCED RATHER THAN ASSERTED.
//
//   1. Two workers of one run never share a directory. The id is used as the directory
//      name unchanged — no sanitising pass — because a sanitiser folds `w1` and `w.1`
//      into one stem and hands two workers one scope without saying so. Ids that are not
//      a single directory name (`..`, `a/b`, an absolute path) are refused outright
//      rather than rewritten into something that resolves somewhere else.
//
//      Not sanitising is not the same as the ids being distinct, and the difference is
//      the whole of property 2. THE FILESYSTEM FOLDS NAMES THIS CODE CANNOT: Windows
//      compares case-insensitively and drops trailing spaces and dots, so `W1`, `w1 `,
//      `w1.` and ` w1` all name the same directory as `w1`. Every one of those is an
//      ordinary id — a symbol name, a filename, a field with a stray space from a split
//      — and two honest workers colliding on one is the failure this lane exists to
//      prevent. So the guarantee is not "distinct ids are distinct directories"; it is
//      that a fold is always a refusal and never a silent share.
//
//   2. The claim is a NON-RECURSIVE mkdir and the lookup is an EXACT-NAME directory read.
//      mkdir is atomic, so it decides a real race between two workers claiming at once,
//      and it also reports EEXIST for every folded spelling — the loser is told, not
//      quietly pointed at the winner's directory. `--path` then matches the id against
//      `readdirSync`, which returns names byte-exact, rather than asking whether the path
//      exists: an existence test answers yes for all six folded spellings and hands them
//      a path inside whichever one claimed first. A retried worker needs its own id; that
//      is the intended shape, because a retry reusing a dead worker's directory inherits
//      its half-written output.
//
// AND A PATH OUT OF SCOPE IS REFUSED, NOT SILENTLY CLAMPED. `--path` resolves a relative
// path inside the scope and prints it; anything resolving elsewhere — `../sibling`, an
// absolute path, a climb out of the run — exits non-zero naming the scope. Clamping such
// a path back inside would be worse than refusing: the worker would write to a place it
// did not mean, and nothing would say so. This is a resolver that refuses, not a kernel
// jail; a worker that never asks can still write anywhere it has tools for, which is why
// "no write outside the run-scoped path" is also stated plainly in the dispatch pattern.
// The parent directory is created, the file itself is not: creating it would make an
// opened-but-unwritten path indistinguishable from a finished one.

import { appendFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { projectAnchor, sentinelId } from '../hooks/sentinel.mjs';

const USAGE = `usage:
  runlog open   --job <name> [--date <YYYY-MM-DD>]
  runlog record --dir <path> --job <name> --unit <name> --status <text> [--duration <ms>] [--detail <text>]
  runlog close  --dir <path> --job <name> --status <text> [--duration <ms>] [--detail <text>]
  runlog worker --dir <path> --worker <id> [--path <relative>]`;

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

/**
 * A required flag read EXACTLY as given, with no trim.
 *
 * `requiredFlag` trims, which is right for a label like `--job` or `--status` and wrong
 * for an id used as a directory name. Trimming folds `w1 `, ` w1` and `w1\t` into `w1`,
 * so two workers dispatched under ids differing only in whitespace become one worker as
 * far as this script is concerned — and the second is handed the first's directory with
 * nothing said. An id is a key, not a label. All-whitespace is still empty.
 */
function requiredExactFlag(argv, name) {
  const value = flag(argv, name);
  if (value === null) fail(`--${name} is required\n${USAGE}`);
  if (value.trim() === '') fail(`--${name} must not be empty`);
  return value;
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

/** Where one run keeps its workers' directories, relative to the run directory. */
const WORKERS_DIRNAME = 'workers';

/**
 * One worker's directory and the workers root holding it, or null if `worker` is not a
 * single directory name.
 *
 * The basename comparison is the whole validation, and it is stronger than it looks: for
 * `path.basename(scope)` to equal `worker`, the id has to survive `path.resolve` as one
 * intact trailing segment, which nothing carrying a separator, a drive letter, `.` or
 * `..` does. This started as two comparisons, the other being
 * `path.dirname(scope) !== root` for ids resolving out of the root. Review showed that
 * one never fires: a brute force over path-significant characters up to length four found
 * zero ids that pass basename and fail dirname, against 2504 the other way. A check with
 * no independent job is a check nobody can test, so it is gone rather than kept for
 * comfort.
 *
 * The id is NOT sanitised. A sanitiser folding `w1` and `w.1` into one stem would hand two
 * workers one scope and say nothing. What this cannot promise by itself is that the
 * FILESYSTEM keeps two accepted ids apart: Windows compares names case-insensitively and
 * drops trailing spaces and dots, so `W1`, `w1 ` and `w1.` all land on `w1`. That is why
 * the claim below is a non-recursive mkdir and the lookup is an exact-name directory read
 * rather than an existence test — under folding, the second id is refused, never quietly
 * pointed at the first one's directory.
 */
function workerScope(runDir, worker) {
  const root = path.resolve(runDir, WORKERS_DIRNAME);
  const scope = path.resolve(root, worker);
  if (path.basename(scope) !== worker) return null;
  return { root, scope };
}

/**
 * `relPath` resolved inside `scope`, or null if it lands anywhere else.
 *
 * `path.relative` rather than a string prefix: `<scope>-2` starts with `<scope>` as text
 * and is a different directory. The empty result is the scope itself, which is inside it.
 *
 * Lexical, not resolved: a symlink or junction planted INSIDE a scope points out of it and
 * this returns a path through it as in-scope. That sits inside the stated limit — this is
 * a resolver that refuses, not a jail — because planting one is already a write the
 * dispatch rules forbid. Resolving here instead would cost a syscall per path and still
 * not stop a worker that never asks.
 */
function withinScope(scope, relPath) {
  const target = path.resolve(scope, relPath);
  const rel = path.relative(scope, target);
  if (path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) return null;
  return target;
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
} else if (action === 'worker') {
  const dir = requiredFlag(rest, 'dir');
  const worker = requiredExactFlag(rest, 'worker');
  const relPath = flag(rest, 'path');
  requireOpenedDir(dir);

  const resolved = workerScope(dir, worker);
  if (resolved === null) {
    fail(
      `--worker must be a single directory name, and ${JSON.stringify(worker)} is not one. ` +
        'It is used as the directory name unchanged, so that two different worker ids can never share one scope.',
    );
  }
  // Refused, never trimmed. On this platform `w1 `, ` w1` and `w1.` do become genuinely
  // separate directories, so accepting them would be safe on disk and unusable above it:
  // the printed path is read back by `scope=$(...)` or a trim, both of which drop the
  // outer whitespace and hand back a DIFFERENT worker's path. Every consumer would have
  // to be careful in the same way, and the first one that is not reintroduces exactly the
  // collision this lane exists to prevent. This is a refusal, not a fold — two ids are
  // never merged, one is rejected.
  if (worker !== worker.trim()) {
    fail(
      `--worker must not begin or end with whitespace, and ${JSON.stringify(worker)} does. ` +
        'The id becomes a directory name, and a path with outer whitespace does not survive ' +
        "being read back: a shell substitution or a trim turns it into another worker's path.",
    );
  }
  const { root, scope } = resolved;

  if (relPath === null) {
    mkdirSync(root, { recursive: true });
    try {
      // Non-recursive on purpose: EEXIST is the answer, not a thing to smooth over. mkdir
      // is atomic, so this decides a genuine race between two workers claiming at once,
      // and it is also what catches the ids the filesystem folds together.
      mkdirSync(scope);
    } catch (err) {
      if (err?.code === 'EEXIST') {
        // Name the holder as it is spelled ON DISK, not as this caller spelled it. When
        // the collision came from case folding, `scope` is a path that does not exist
        // under that spelling, and handing it to whoever diagnoses this sends them
        // looking for a directory they will not find.
        let holder = scope;
        try {
          holder = realpathSync.native(scope);
        } catch {
          /* the true name is a nicety; the refusal is not */
        }
        fail(
          `worker ${JSON.stringify(worker)} is already claimed in this run at ${holder}. ` +
            'Two workers of one run must not share a write path; give this one an id of its own.',
        );
      }
      fail(`could not create ${scope} (${err?.message ?? err})`);
    }
    process.stdout.write(`${scope}\n`);
  } else {
    // An exact-name match against the directory listing, NOT existsSync. Windows resolves
    // `W1`, `w1 ` and `w1.` to an existing `w1`, so an existence test hands six spellings
    // of one id a path inside whichever of them claimed first — two honest workers
    // silently writing to one directory, which is the whole failure this lane prevents.
    // readdirSync returns names byte-exact, so only the id that actually claimed matches.
    let claimed;
    try {
      claimed = readdirSync(root);
    } catch {
      claimed = [];
    }
    if (!claimed.includes(worker)) {
      fail(
        `worker ${JSON.stringify(worker)} has no scope in this run yet. ` +
          `Claim it first with \`runlog worker --dir ${dir} --worker ${worker}\`. ` +
          'The id must match the claimed directory name exactly, including case and spacing.',
      );
    }
    const target = withinScope(scope, relPath);
    if (target === null) {
      fail(`${JSON.stringify(relPath)} resolves outside worker ${JSON.stringify(worker)}'s scope at ${scope}.`);
    }
    mkdirSync(path.dirname(target), { recursive: true });
    process.stdout.write(`${target}\n`);
  }
} else {
  fail(USAGE);
}
