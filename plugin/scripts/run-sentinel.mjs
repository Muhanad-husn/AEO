#!/usr/bin/env node
// Raise, clear and list run-in-progress sentinels.
//
// A sentinel says "a long job is live in this project". While one is up, the commit gate
// refuses to commit and the sandbox guard refuses to run the project's test command,
// from any session and any worktree. That is L-02: because the commit gate runs the
// suite, `git commit` executes code, and four simultaneous external kills of a live
// four-hour pipeline were traced to a concurrent session's commit gate firing tests.
//
//   node run-sentinel.mjs start <id> [--what "text"] [--pid <n>]
//   node run-sentinel.mjs stop  <id>
//   node run-sentinel.mjs list
//
// The usual shape, from the shell that will run the job:
//
//   node run-sentinel.mjs start corpus-ingest --what "full ingest, ~4h" --pid $$   # POSIX
//   ./run-the-long-job
//   node run-sentinel.mjs stop corpus-ingest
//
// WHY --pid IS OPTIONAL AND ABSENT BY DEFAULT. A recorded owner process is what lets a
// crashed job's sentinel expire on its own: the guard treats a sentinel as stale when its
// host is this machine and its pid is provably gone. Defaulting it to this script's
// parent would be wrong more often than right, because `start` is usually run as its own
// command and that parent shell exits immediately. A sentinel that expires while the job
// is still running is the failure this whole mechanism exists to prevent, so the default
// is no pid, which means the sentinel stands until someone clears it.
//
// AND THE RECORDED PID MUST BE ONE THE OPERATING SYSTEM CAN SEE, so `start` checks it
// against the OS process table before writing anything. This is the only place a bad pid
// can enter the system, and it is the only place cheap enough to refuse it outright: every
// downstream reader (this script's own stale check, the commit gate, the monitor's CPU
// probe) instead has to treat "cannot resolve" and "resolved and gone" as the same fact,
// because by the time they look the process may legitimately have exited. Raise time has
// no such ambiguity — the process is supposed to be running right now. Under Git Bash /
// MSYS on Windows `$$` is the MSYS process id, not the Windows one, so a sentinel raised
// that way used to record a number no Windows lookup resolves, and a live job read as
// crashed; now `start` refuses it instead. `$$` is correct on Linux and macOS, `$PID` in
// PowerShell, and under MSYS the Windows pid is `ps`'s WINPID column. Best of all, a Node
// or Python job raises its own sentinel with process.pid / os.getpid() and translates
// nothing. The per-shell forms live in the monitor-design skill, which is where the
// procedure belongs. There is no override: a pid is only knowable once the process it
// names exists, so there is no legitimate case for recording one that does not resolve.
//
// Clearing has to stay trivial, and every block message names the file and this command.
// A sentinel nobody can clear becomes a thing people delete reflexively, and that is how
// a guard dies.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectRuns, processAlive, projectAnchor, sentinelDir, sentinelId, sentinelPath } from '../hooks/sentinel.mjs';

const USAGE = `usage:
  run-sentinel start <id> [--what "text"] [--pid <n>]
  run-sentinel stop  <id>
  run-sentinel list`;

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

const [action, ...rest] = process.argv.slice(2);
const anchor = projectAnchor(process.cwd());
if (anchor === null) fail('run-sentinel must be run inside a repository; no project root was found above the working directory.');

const id = rest.find((a) => !a.startsWith('--')) ?? null;

if (action === 'start') {
  if (id === null) fail(`start needs an id\n${USAGE}`);
  const pidRaw = flag(rest, 'pid');
  const pid = pidRaw === null ? null : Number.parseInt(pidRaw, 10);
  if (pidRaw !== null && !(Number.isInteger(pid) && pid > 0)) fail(`--pid must be a positive integer, got ${pidRaw}`);
  if (pid !== null && !processAlive(pid)) {
    fail(
      `--pid ${pid} does not name a process this machine can see right now, so no sentinel was written.\n` +
        `A pid is only meaningful once the process it names exists; recording one nothing resolves would make this ` +
        `job's own sentinel read as stale while the job is still running.\n` +
        `If this came from $$ under Git Bash or MSYS on Windows, that is the MSYS pid, not the Windows one: read ` +
        `\`ps\`'s WINPID column instead, or skip the shell entirely and have the job raise its own sentinel with ` +
        `process.pid / os.getpid() (see the monitor-design skill).`,
    );
  }

  const file = sentinelPath(anchor, id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        id: sentinelId(id),
        what: flag(rest, 'what') ?? 'a long job',
        started: new Date().toISOString(),
        pid,
        host: os.hostname(),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`raised ${file}\nCommits and test runs in this project are refused until it is cleared.\n`);
} else if (action === 'stop') {
  if (id === null) fail(`stop needs an id\n${USAGE}`);
  const file = sentinelPath(anchor, id);
  try {
    rmSync(file);
    process.stdout.write(`cleared ${file}\n`);
  } catch (err) {
    fail(`could not clear ${file} (${err?.message ?? err})`);
  }
} else if (action === 'list') {
  const dir = sentinelDir(anchor);
  const { live, stale, unreadable, dirError } = inspectRuns(anchor);
  process.stdout.write(`${dir}\n`);
  if (dirError !== null) process.stdout.write(`  ! ${dirError}\n`);
  for (const l of live) process.stdout.write(`  LIVE     ${l}\n`);
  for (const s of stale) process.stdout.write(`  stale    ${s}\n`);
  for (const u of unreadable) process.stdout.write(`  UNREADABLE ${u}\n`);
  if (live.length + stale.length + unreadable.length === 0 && dirError === null) {
    process.stdout.write('  (no sentinels; nothing is running)\n');
  }
} else {
  fail(USAGE);
}
