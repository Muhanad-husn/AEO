#!/usr/bin/env node
// Watch a runlog directory and report progress, rate, failures, and whether the job is
// stalled.
//
// WHY THIS EXISTS. A long job writes a runlog (plugin/scripts/runlog.mjs). The founder
// wants one question answered from a plain terminal: is this thing still working, and when
// will it be done? V-10 found that pattern already built and unusable — a monitor with
// seven pipeline passes and a stall threshold hard-coded from one measured run of one
// pipeline. The pattern is good, the specifics are not portable. This is the pattern with
// the specifics removed: every number that was tuned to a job is a flag, and the shape of
// the job is read off the runlog rather than compiled in.
//
//   node run-monitor.mjs <runlog-dir> [--stall-seconds <n>] [--interval <s>] [--total <n>]
//                                     [--pid <n>]... [--once] [--polls <n>]
//
// THE STATUS VOCABULARY, AND WHICH STATE MEANS WHICH. This is the part L-08 was paid for.
// A healthy production run once reported `0 live workers / IDLE` for its entire duration,
// because the monitor was built for a different shape of run and had no way to say so. A
// monitor's negative signal must be distinguishable from "not instrumented for this shape
// of run". Exactly one of these words appears on every report:
//
//   UNKNOWN   There is no runlog to read: the directory is absent, or it holds no
//             run.jsonl. The monitor is saying nothing about the job, because it can see
//             nothing. This is NOT "idle" and NOT "finished".
//   DONE      A terminal `unit: "run"` record is present. The run closed itself, and the
//             status it closed with is quoted.
//   EXITED    Every process being watched is gone and no close record was written. The job
//             crashed or was killed. Distinct from STALLED: there is nothing left to
//             attach a debugger to. A pid the probe cannot RESOLVE looks the same as one
//             that has exited, so the reason line also names the case where the recorded
//             pid was never OS-visible in the first place (see the pid note below).
//   MOVING    At least one signal moved since the previous look.
//   QUIET     Nothing moved since the previous look. NOT A VERDICT. On a job that
//             checkpoints less often than --interval this is the ordinary reading; the
//             signals line carries the actual ages.
//   STALLED   All three signals — checkpoints, logs, CPU — flat for at least
//             --stall-seconds. The only word that accuses the job.
//   SUSPECT   The conditions for STALLED are otherwise met but one signal could not be
//             read, or the runlog itself could not be read. The reason is always stated.
//             Two flat signals are not three, so this is never STALLED.
//
// There is deliberately no IDLE. It was the word that lied. "Opened, nothing recorded yet"
// is a fact about progress, reported on the progress line, and it does not exempt the run
// from the stall check — a run that has recorded nothing for three hours with no CPU is
// stalled, not idle.
//
// THREE SIGNALS, AND WHERE EACH COMES FROM (V-10, EN-15).
//
//   checkpoints  The last record's `ts` in run.jsonl, falling back to run.jsonl's mtime.
//                Read off disk, so its age is known on the very first look.
//   logs         console.log's mtime and size. Same: known on the first look. An absent
//                console.log makes this signal UNAVAILABLE, which can produce SUSPECT but
//                can never produce STALLED.
//   cpu          Cumulative CPU time of the watched pids. This one has no on-disk history,
//                so it needs two samples: "liveness needs movement across two checks, not
//                a snapshot" (L-08). One sample is `unmeasured`, not flat.
//
// WHY CPU IS SHELLED OUT. Node has no psutil and no built-in way to read another process's
// CPU time. `ps -p <pid> -o time=` on POSIX, `Get-CimInstance Win32_Process` on Windows.
// When that read fails the status is SUSPECT with the reason stated, never STALLED — a
// missing third signal must not be scored as a flat third signal. The Windows probe emits
// only ASCII digits, so none of L-09's five console-codepage incidents can reach it, and
// the read is cumulative 100ns ticks rather than an instantaneous percent, because a
// snapshot percent reads zero for a busy process depending on when it is sampled. POSIX
// `ps` reports CPU time at one-second resolution, so a process using under a second of CPU
// per interval reads flat there; that is why CPU is one of three signals and not the
// verdict. Every watched pid is read in ONE spawn, because a cold `powershell` costs about
// a second and one spawn per pid would make a look at an eight-worker job cost eight.
//
// WHY --stall-seconds HAS NO DEFAULT. V-10's `DEFAULT_STALL_SECONDS = 2400` was tuned to
// one measured run of one pipeline, and shipping it here would re-import the specific this
// script exists to shed. Unset, the monitor reports liveness only. It cannot then report
// STALLED, and every single report says so on its `stall` line, including the reports that
// look healthy — an unset threshold that produced a quiet pass would be L-08's first
// finding word for word.
//
// WHY THE PID IS DISCOVERED FROM THE SENTINEL. `run-sentinel.mjs start <id> --pid <n>`
// already records the owning process of a long job under `.aeo/runs/`, and a lane that
// runs a long job raises one. So when --pid is absent the sentinel named by the runlog's
// own `job` field is consulted, through the existing sentinelPath/projectAnchor helpers
// rather than any new resolution. No sentinel and no --pid is not an error: the CPU signal
// is unavailable, which is reported, and STALLED becomes unreachable.
//
// WHATEVER RAISED THE SENTINEL MUST HAVE RECORDED AN OS-VISIBLE PID. The probe below
// resolves Windows process ids on Windows and POSIX process ids elsewhere, and nothing
// upstream validates the number. A pid the probe cannot resolve is indistinguishable from
// a pid that has exited, so a job whose sentinel carries an MSYS `$$` under Git Bash on
// Windows reports EXITED while running: MSYS ids are not Windows ids, and Win32_Process
// only knows Windows ids. That is a documentation defect at the raising end, not a defect
// here, and it is why EXITED's reason line names the false-alarm case out loud. The
// per-shell forms are in the monitor-design skill.
//
// WATCH BY DEFAULT, AND WHY THE OUTPUT APPENDS RATHER THAN REDRAWS. The founder runs this
// in their own terminal, so watching is the natural mode; --once takes a single look. A
// single look cannot see CPU movement, so under --once a would-be STALLED is reported
// SUSPECT, which is the honest answer rather than a weaker verdict. Output is a fresh
// block per look, appended, with no cursor control and no ANSI: a redraw is unreadable the
// moment anyone redirects this to a file, and an appended block is also a record. Blocks
// are ~8 lines, because a CLI that floods stdout floods whatever is reading it (L-09).
//
// WHY THE VERDICT IS NOT IN THE EXIT CODE. Exit 0 unless the invocation itself was bad. A
// monitor that exited non-zero for a stalled job would be indistinguishable from a monitor
// that crashed, and the crash is the case where you most need to notice.
//
// This file is both a CLI and a library: the loop is driven through injectable clock,
// sleep, CPU probe and writer so the stall logic is testable without real sleeping and
// without a real wedged job. The CLI body runs only when this file is the entry point.
//
// Node built-ins only, no dependencies.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectAnchor, sentinelPath } from '../hooks/sentinel.mjs';

const USAGE = `usage:
  run-monitor <runlog-dir> [--stall-seconds <n>] [--interval <s>] [--total <n>]
                           [--pid <n>]... [--once] [--polls <n>]

  <runlog-dir>     a directory written by \`runlog.mjs open\` (holds run.jsonl, console.log)
  --stall-seconds  how long all three signals must be flat before this reports STALLED.
                   UNSET MEANS NO STALL VERDICT: liveness only, and every report says so.
  --interval       seconds between looks (default ${'15'}). Also the shortest CPU-flat window.
  --total          units expected in total, so remaining time can be projected. Unset,
                   remaining is reported as unknown and never guessed.
  --pid            a process to read CPU from; repeatable. Unset, the run's sentinel under
                   .aeo/runs/ is consulted.
  --once           take one look and exit. One look cannot see CPU movement, so a would-be
                   STALLED is reported SUSPECT.
  --polls          stop after n looks. 0, the default, watches until the run closes.`;

/** The unit name `runlog close` reserves for a run's own terminal record. */
const TERMINAL_UNIT = 'run';

/**
 * Seconds between looks when the founder does not say. A display refresh rate, and the
 * shortest window a CPU reading may be called flat over. It cannot make a job read stalled
 * on its own: STALLED still needs the checkpoint and log signals flat for --stall-seconds,
 * and those are measured from disk timestamps rather than from this.
 */
const DEFAULT_INTERVAL_SECONDS = 15;

/** A bound on one CPU probe, so a wedged `ps` cannot wedge the monitor watching for it. */
const PROBE_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Reading the runlog
// ---------------------------------------------------------------------------

// A record's `status` is free text by design (EN-14's envelope fixes the keys, not the
// vocabulary), so these two lists are a reading of the convention rather than a contract.
// Anything they do not recognise lands in `other` and is reported as `other` — never
// folded into `ok`. A vocabulary list rots; a silent default hides the rot, and a visible
// third bucket does not.
const OK_STATUS = /^(ok|okay|pass(ed)?|success(ful)?|succeeded|done|complete[d]?|skip(ped)?)\b/i;
const FAIL_STATUS = /^(fail(ed|ure)?|err(or)?|fatal|timeout|timed[-_ ]?out|crash(ed)?|abort(ed)?|kill(ed)?|cancel(l?ed)?)\b/i;

/** `ok` | `failed` | `other`, for one record's status field. */
export function classifyStatus(status) {
  const text = typeof status === 'string' ? status.trim() : '';
  if (OK_STATUS.test(text)) return 'ok';
  if (FAIL_STATUS.test(text)) return 'failed';
  return 'other';
}

function tsMs(ts) {
  if (typeof ts !== 'string') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Everything one look at a runlog directory can learn from disk.
 *
 * `present` and `opened` are the two facts UNKNOWN turns on, and they are exactly P3.1's
 * three-state distinction: no directory, a directory with an empty run.jsonl, a directory
 * with records. An opened-but-empty run is instrumented and must not be read as absent.
 */
export function readRunlog(dir) {
  const out = {
    dir,
    present: false,
    opened: false,
    error: null,
    job: null,
    records: 0,
    units: 0,
    ok: 0,
    failed: 0,
    other: 0,
    malformed: 0,
    closed: null,
    firstTs: null,
    lastTs: null,
    openedAtMs: null,
    jsonlMtimeMs: null,
    logPresent: false,
    logBytes: null,
    logMtimeMs: null,
  };

  try {
    if (!statSync(dir).isDirectory()) {
      out.error = `${dir} is not a directory`;
      return out;
    }
  } catch {
    return out; // absent: UNKNOWN, and the report says which
  }
  out.present = true;

  const jsonl = path.join(dir, 'run.jsonl');
  let raw;
  try {
    const st = statSync(jsonl);
    if (!st.isFile()) return out;
    out.opened = true;
    out.jsonlMtimeMs = st.mtimeMs;
    // birthtime is 0 on filesystems that do not carry it; mtime on a file only ever
    // appended to is at worst the last append, which is a later and still safe anchor.
    out.openedAtMs = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    raw = readFileSync(jsonl, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return out;
    out.opened = true;
    out.error = `${jsonl} could not be read (${err?.message ?? err})`;
    return out;
  }

  for (const line of raw.split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      out.malformed += 1;
      continue;
    }
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      out.malformed += 1;
      continue;
    }

    out.records += 1;
    if (out.job === null && typeof rec.job === 'string' && rec.job.trim() !== '') out.job = rec.job.trim();
    const ms = tsMs(rec.ts);
    if (ms !== null) {
      if (out.firstTs === null) out.firstTs = ms;
      out.lastTs = ms;
    }

    if (rec.unit === TERMINAL_UNIT) {
      out.closed = { status: typeof rec.status === 'string' ? rec.status.trim() : '', tsMs: ms };
      continue;
    }
    out.units += 1;
    out[classifyStatus(rec.status)] += 1;
  }

  try {
    const st = statSync(path.join(dir, 'console.log'));
    if (st.isFile()) {
      out.logPresent = true;
      out.logBytes = st.size;
      out.logMtimeMs = st.mtimeMs;
    }
  } catch {
    // absent: the log signal is unavailable, which the assessment reports and which can
    // never be scored as a flat signal.
  }

  return out;
}

// ---------------------------------------------------------------------------
// The third signal: CPU per pid
// ---------------------------------------------------------------------------

/** `[[DD-]HH:]MM:SS[.frac]`, which is what every `ps -o time=` prints. */
function parseCpuTime(text) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:[.,]\d+)?)$/.exec(text.trim());
  if (!m) return null;
  const [, d, h, mi, s] = m;
  return Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi) * 60 + Number(String(s).replace(',', '.'));
}

// BOTH PROBES READ EVERY PID IN ONE PROCESS. A `powershell` start costs about a second
// cold, so one spawn per pid would make a look at an eight-worker job cost eight seconds,
// and the monitor would spend more time probing than watching. Both platforms can be asked
// about a set, and both answer `<pid> <value>` per live pid, so a pid missing from the
// output is the "gone" signal and no second call is needed to find that out.

function posixCpu(pids, spawn) {
  let r;
  try {
    r = spawn('ps', ['-p', pids.join(','), '-o', 'pid=,time='], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    return { ok: false, reason: `\`ps\` could not be run (${err?.message ?? err})` };
  }
  if (r?.error) return { ok: false, reason: `\`ps\` could not be run (${r.error.message})` };

  const seen = new Map();
  for (const line of (r?.stdout ?? '').split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    const m = /^(\d+)\s+(\S+)$/.exec(text);
    const seconds = m === null ? null : parseCpuTime(m[2]);
    if (seconds === null) {
      return { ok: false, reason: `\`ps\` printed ${JSON.stringify(text)}, which is not a pid and a CPU time` };
    }
    seen.set(Number(m[1]), seconds);
  }
  // `ps` exits non-zero when it matched nothing, which is every pid gone, not a fault.
  return { ok: true, seen };
}

// No double quotes anywhere in this, so it survives argv quoting on the way to
// powershell.exe unchanged. `-Filter` takes WQL, where single quotes are the string form.
// The output is decimal digits and spaces only, so no console codepage can corrupt it
// (L-09). The times are cumulative 100ns ticks, not an instantaneous percent.
function winCpuScript(pids) {
  const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
  return (
    `Get-CimInstance Win32_Process -Filter '${filter}' -ErrorAction SilentlyContinue | ` +
    'ForEach-Object { $_.ProcessId.ToString() + [char]32 + ($_.KernelModeTime + $_.UserModeTime).ToString() }'
  );
}

function winCpu(pids, spawn) {
  let r;
  try {
    r = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', winCpuScript(pids)], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    return { ok: false, reason: `powershell could not be run (${err?.message ?? err})` };
  }
  if (r?.error) return { ok: false, reason: `powershell could not be run (${r.error.message})` };
  if (r?.status !== 0) {
    const why = (r?.stderr ?? '').trim().split('\n')[0] ?? '';
    return { ok: false, reason: `powershell exited ${r?.status} reading CPU${why ? ` (${why})` : ''}` };
  }

  const seen = new Map();
  for (const line of (r?.stdout ?? '').split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    const m = /^(\d+) (\d+)$/.exec(text);
    if (m === null) {
      return { ok: false, reason: `powershell printed ${JSON.stringify(text)}, which is not a pid and a tick count` };
    }
    seen.set(Number(m[1]), Number(m[2]) / 1e7);
  }
  return { ok: true, seen };
}

/**
 * Cumulative CPU seconds across every watched pid.
 *
 * `gone` only when EVERY pid is gone: one dead worker beside a live one is not an exited
 * job. A probe that could not run at all fails the whole signal rather than reporting the
 * pids it did see, because a partial sum looks flat for the wrong reason and flatness is
 * exactly what the caller is about to act on.
 *
 * @returns {{ok: boolean, seconds: number|null, gone: boolean, reason: string|null}}
 */
export function probeCpu(pids, { platform = process.platform, spawn = spawnSync } = {}) {
  const list = Array.isArray(pids) ? pids.filter((p) => Number.isInteger(p) && p > 0) : [];
  if (list.length === 0) {
    return { ok: false, seconds: null, gone: false, reason: 'no pid was supplied or discovered, so CPU cannot be read' };
  }

  const r = platform === 'win32' ? winCpu(list, spawn) : posixCpu(list, spawn);
  if (!r.ok) return { ok: false, seconds: null, gone: false, reason: r.reason };

  const missing = list.filter((pid) => !r.seen.has(pid));
  if (missing.length === list.length) {
    return { ok: false, seconds: null, gone: true, reason: `pid ${missing.join(', ')} is gone` };
  }
  let total = 0;
  for (const pid of list) total += r.seen.get(pid) ?? 0;
  return {
    ok: true,
    seconds: total,
    gone: false,
    reason: missing.length > 0 ? `pid ${missing.join(', ')} gone; summing the rest` : null,
  };
}

/**
 * The pid a run's own sentinel recorded, or none with the reason why.
 *
 * `run-sentinel start <id> --pid $$` is where that pid comes from, and the id it uses is
 * the job name. Resolution goes through the exported sentinelPath/projectAnchor rather
 * than a second copy of either (V-13).
 */
export function sentinelPids(dir, job, { anchorOf = projectAnchor, hostname = os.hostname } = {}) {
  if (typeof job !== 'string' || job.trim() === '') {
    return { pids: [], source: 'no job name in the run log yet, so no sentinel could be looked up' };
  }
  const anchor = anchorOf(dir);
  if (anchor === null) {
    return { pids: [], source: `no project root above ${dir}, so no sentinel could be looked up` };
  }
  const file = sentinelPath(anchor, job);
  let rec;
  try {
    rec = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { pids: [], source: `no readable run sentinel at ${file}` };
  }
  const host = typeof rec?.host === 'string' ? rec.host.trim() : '';
  if (host !== '' && host !== hostname()) {
    return { pids: [], source: `${file} was raised on ${host}, not this machine` };
  }
  if (!Number.isInteger(rec?.pid) || rec.pid <= 0) {
    return { pids: [], source: `${file} records no pid (\`run-sentinel start --pid <n>\` records one)` };
  }
  return { pids: [rec.pid], source: `pid ${rec.pid}, from ${file}` };
}

/**
 * One look: the runlog off disk, the CPU probe, and the time both were taken.
 *
 * `log` is a parameter so the watch loop, which has to read the runlog before the probe in
 * order to discover a pid from it, does not read the same file twice per look.
 */
export function observe(dir, { now = Date.now, pids = [], cpuProbe = probeCpu, cpuSource = null, log = null } = {}) {
  const read = log ?? readRunlog(dir);
  const cpu = cpuProbe(pids);
  return { ...read, cpu, cpuSource, pids: [...pids], at: now() };
}

// ---------------------------------------------------------------------------
// The assessment
// ---------------------------------------------------------------------------

/**
 * A stateful assessor. Call the returned function once per look, in order.
 *
 * It is stateful because two of the three signals are not: checkpoints and logs carry
 * their own last-movement time on disk, but cumulative CPU is a number with no history, so
 * "did it move" needs the previous sample. Keeping that here rather than in the loop is
 * what makes the whole stall decision testable by feeding it observations.
 *
 * @param {{stallSeconds?: number|null, total?: number|null, intervalMs?: number}} options
 * @returns {(observation: object) => object}
 */
export function createMonitor({ stallSeconds = null, total = null, intervalMs = DEFAULT_INTERVAL_SECONDS * 1000 } = {}) {
  const armed = Number.isFinite(stallSeconds) && stallSeconds > 0;
  const stallMs = armed ? stallSeconds * 1000 : null;

  let startedAt = null;
  let prev = null;
  let cpuSeconds = null;
  let cpuSince = null;

  return function step(obs) {
    const at = obs.at;
    if (startedAt === null) startedAt = at;

    // --- the CPU signal, the only one whose history lives here -------------------------
    let cpu;
    if (obs.cpu?.gone) {
      cpu = { state: 'gone', reason: obs.cpu.reason };
      cpuSeconds = null;
      cpuSince = null;
    } else if (!obs.cpu?.ok) {
      cpu = { state: 'unmeasured', reason: obs.cpu?.reason ?? 'the CPU probe returned nothing' };
      // A gap in the samples breaks the streak. Resuming a streak across a failed probe
      // would call a signal flat over a window nobody watched.
      cpuSeconds = null;
      cpuSince = null;
    } else if (cpuSeconds === null) {
      cpuSeconds = obs.cpu.seconds;
      cpuSince = at;
      cpu = { state: 'unmeasured', reason: 'one CPU sample so far; movement needs two', seconds: obs.cpu.seconds };
    } else if (obs.cpu.seconds > cpuSeconds) {
      const delta = obs.cpu.seconds - cpuSeconds;
      cpuSeconds = obs.cpu.seconds;
      cpuSince = at;
      cpu = { state: 'moving', delta, seconds: obs.cpu.seconds };
    } else {
      const spanMs = at - cpuSince;
      cpu =
        spanMs >= intervalMs
          ? { state: 'flat', spanMs, seconds: obs.cpu.seconds }
          : {
              state: 'unmeasured',
              reason: `CPU unchanged, but only across ${fmtDuration(spanMs)}; a flat reading needs a full interval (${fmtDuration(intervalMs)})`,
              seconds: obs.cpu.seconds,
            };
    }

    // --- the two signals that carry their own history on disk ---------------------------
    const checkpointAt = obs.lastTs ?? obs.jsonlMtimeMs ?? startedAt;
    const checkpointFlatMs = Math.max(0, at - Math.min(checkpointAt, at));
    const logAvailable = obs.logPresent === true;
    const logAt = logAvailable ? obs.logMtimeMs : null;
    const logFlatMs = logAvailable ? Math.max(0, at - Math.min(logAt, at)) : null;

    const since = prev === null ? at - intervalMs : prev.at;
    const checkpointMoved = checkpointAt > since || (prev !== null && obs.records !== prev.records);
    const logMoved = logAvailable && (logAt > since || (prev !== null && obs.logBytes !== prev.logBytes));
    const moved = checkpointMoved || logMoved || cpu.state === 'moving';

    // --- progress, rate, projection -----------------------------------------------------
    const elapsedFrom = obs.firstTs ?? obs.openedAtMs ?? null;
    const elapsedMs = elapsedFrom === null ? null : Math.max(0, at - elapsedFrom);
    const elapsedBasis = obs.firstTs !== null ? 'first record' : 'run.jsonl created';
    const rate = elapsedMs !== null && elapsedMs > 0 ? obs.units / (elapsedMs / 60000) : null;
    const knownTotal = Number.isFinite(total) && total > 0 ? total : null;
    const remainingUnits = knownTotal === null ? null : Math.max(0, knownTotal - obs.units);
    const remainingMs = remainingUnits !== null && rate !== null && rate > 0 ? (remainingUnits / rate) * 60000 : null;

    // --- the verdict ---------------------------------------------------------------------
    const reasons = [];
    let status;

    if (obs.error !== null && obs.error !== undefined) {
      status = 'SUSPECT';
      reasons.push(obs.error);
      reasons.push('The monitor could not read the run log, so nothing here is a clean bill of health.');
    } else if (!obs.present) {
      status = 'UNKNOWN';
      reasons.push(`${obs.dir} does not exist, so no run was ever opened here.`);
      reasons.push('UNKNOWN means nothing was found to read. It is not a report that the job is quiet, or finished (L-08).');
    } else if (!obs.opened) {
      status = 'UNKNOWN';
      reasons.push(`${obs.dir} holds no run.jsonl, so nothing here was instrumented by runlog.`);
      reasons.push('UNKNOWN means nothing was found to read. It is not a report that the job is quiet, or finished (L-08).');
    } else if (obs.closed !== null) {
      status = 'DONE';
    } else if (cpu.state === 'gone') {
      status = 'EXITED';
      reasons.push(`${cpu.reason}, and the run was never closed, so it crashed or was killed.`);
      reasons.push('If that pid named a launcher rather than the job itself, this is a false alarm.');
    } else if (!armed) {
      status = moved ? 'MOVING' : 'QUIET';
    } else if (checkpointFlatMs >= stallMs && !logAvailable) {
      status = 'SUSPECT';
      reasons.push(
        `checkpoints have been flat for ${fmtDuration(checkpointFlatMs)}, but ${obs.dir} holds no console.log, ` +
          'so the log signal cannot be read. Two flat signals are not three.',
      );
    } else if (checkpointFlatMs >= stallMs && logFlatMs >= stallMs) {
      if (cpu.state === 'flat') {
        status = 'STALLED';
        reasons.push(
          `checkpoints flat ${fmtDuration(checkpointFlatMs)}, logs flat ${fmtDuration(logFlatMs)}, ` +
            `CPU flat ${fmtDuration(cpu.spanMs)}; the threshold is ${fmtDuration(stallMs)}.`,
        );
        reasons.push('Do not blind-restart it: it will re-hang on the same input (L-08).');
      } else if (cpu.state === 'moving') {
        status = 'MOVING';
        reasons.push(
          `checkpoints and logs have both been flat past the ${fmtDuration(stallMs)} threshold, but CPU is still ` +
            `climbing (+${cpu.delta.toFixed(2)}s). Slow is not stalled.`,
        );
      } else {
        status = 'SUSPECT';
        reasons.push(
          `checkpoints and logs have both been flat past the ${fmtDuration(stallMs)} threshold, but the CPU signal ` +
            `is unreadable: ${cpu.reason}. Two flat signals are not three, so this is not a stall.`,
        );
      }
    } else {
      status = moved ? 'MOVING' : 'QUIET';
    }

    const assessment = {
      at,
      dir: obs.dir,
      status,
      reasons,
      job: obs.job,
      closeStatus: obs.closed === null ? null : obs.closed.status,
      progress: {
        units: obs.units,
        records: obs.records,
        ok: obs.ok,
        failed: obs.failed,
        other: obs.other,
        malformed: obs.malformed,
        total: knownTotal,
      },
      elapsedMs,
      elapsedBasis,
      rate,
      remainingUnits,
      remainingMs,
      signals: {
        checkpointFlatMs,
        logFlatMs,
        logAvailable,
        cpu,
        moved,
      },
      stall: { armed, stallSeconds: armed ? stallSeconds : null },
      cpuSource: obs.cpuSource ?? null,
      pids: obs.pids ?? [],
    };

    prev = obs;
    return assessment;
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function fmtDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'unknown';
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

const LABEL_WIDTH = 11;
const row = (label, text) => `  ${label.padEnd(LABEL_WIDTH)}${text}`;
const cont = (text) => `  ${' '.repeat(LABEL_WIDTH)}${text}`;

function progressLine(a) {
  const p = a.progress;
  if (p.records === 0) {
    return 'no units recorded yet (run.jsonl is open and empty, so the run IS instrumented)';
  }
  const buckets = [`${p.ok} ok`];
  if (p.failed > 0) buckets.push(`${p.failed} failed`);
  if (p.other > 0) buckets.push(`${p.other} other status`);
  if (p.malformed > 0) buckets.push(`${p.malformed} unparseable line(s)`);
  const of = p.total === null ? '' : ` of ${p.total} expected`;
  return `${p.units} unit(s) recorded (${buckets.join(', ')})${of}`;
}

function cpuPhrase(cpu) {
  if (cpu.state === 'moving') return `cpu moving (+${cpu.delta.toFixed(2)}s)`;
  if (cpu.state === 'flat') return `cpu flat ${fmtDuration(cpu.spanMs)}`;
  if (cpu.state === 'gone') return 'cpu gone';
  return 'cpu unmeasured';
}

/** One appended block. Plain text: no ANSI, no cursor control, readable when redirected. */
export function formatReport(a) {
  const lines = [];
  lines.push(`${new Date(a.at).toISOString()}  ${a.dir}${a.job ? `  [${a.job}]` : ''}`);
  lines.push(row('status', a.status + (a.closeStatus !== null ? ` (closed with status: ${a.closeStatus || '(none)'})` : '')));
  for (const [i, reason] of a.reasons.entries()) lines.push(i === 0 ? row('reason', reason) : cont(reason));

  if (a.status !== 'UNKNOWN') {
    lines.push(row('progress', progressLine(a)));
    lines.push(
      row(
        'elapsed',
        a.elapsedMs === null ? 'unknown' : `${fmtDuration(a.elapsedMs)} (since the ${a.elapsedBasis})`,
      ),
    );
    lines.push(row('rate', a.rate === null ? 'unknown' : `${a.rate.toFixed(2)} units/min`));
    lines.push(
      row(
        'remaining',
        a.remainingMs !== null
          ? `~${fmtDuration(a.remainingMs)} (${a.remainingUnits} unit(s) left at the observed rate)`
          : a.progress.total === null
            ? 'unknown -- no --total supplied, so this monitor will not guess'
            : 'unknown -- no rate observed yet',
      ),
    );

    const s = a.signals;
    lines.push(
      row(
        'signals',
        `checkpoints flat ${fmtDuration(s.checkpointFlatMs)} | ` +
          `${s.logAvailable ? `logs flat ${fmtDuration(s.logFlatMs)}` : 'logs unavailable (no console.log)'} | ` +
          cpuPhrase(s.cpu),
      ),
    );
    if (s.cpu.reason) lines.push(cont(`cpu: ${s.cpu.reason}`));
    if (a.cpuSource) lines.push(cont(`cpu source: ${a.cpuSource}`));
  }

  lines.push(
    row(
      'stall',
      a.stall.armed
        ? `detection ON, threshold ${fmtDuration(a.stall.stallSeconds * 1000)} across all three signals`
        : 'detection OFF -- no --stall-seconds supplied, so this monitor CANNOT report a stall.',
    ),
  );
  if (!a.stall.armed) lines.push(cont('Liveness only. Pass --stall-seconds <n> for a verdict.'));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The watch loop
// ---------------------------------------------------------------------------

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Look at `dir` until the run closes or `polls` looks have been taken.
 *
 * Every moving part is injectable, so the tests drive months of wall clock through this in
 * milliseconds. EXITED does not end the loop, because a pid that names a launcher rather
 * than the job produces it spuriously; only a real close record does.
 *
 * @returns {Promise<object|null>} the last assessment
 */
export async function watch(dir, options = {}, io = {}) {
  const {
    stallSeconds = null,
    total = null,
    intervalMs = DEFAULT_INTERVAL_SECONDS * 1000,
    polls = 0,
    pids = [],
  } = options;
  const {
    now = Date.now,
    sleep = realSleep,
    cpuProbe = probeCpu,
    write = (text) => process.stdout.write(text),
    discoverPids = sentinelPids,
  } = io;

  const step = createMonitor({ stallSeconds, total, intervalMs });
  let watched = [...pids];
  let cpuSource = watched.length > 0 ? `pid ${watched.join(', ')}, from --pid` : null;
  let last = null;

  for (let n = 0; polls === 0 || n < polls; n += 1) {
    if (n > 0) await sleep(intervalMs);

    const log = readRunlog(dir);
    if (watched.length === 0) {
      // Retried each look while empty: a sentinel raised after the monitor started is the
      // ordinary case when the founder attaches to a job that was still queueing.
      const found = discoverPids(dir, log.job);
      watched = found.pids;
      cpuSource = found.source;
    }

    last = step(observe(dir, { now, pids: watched, cpuProbe, cpuSource, log }));
    write(`${formatReport(last)}\n\n`);
    if (last.status === 'DONE') return last;
  }
  return last;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function flagValues(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== `--${name}`) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value\n${USAGE}`);
    out.push(value);
  }
  return out;
}

function numberFlag(argv, name, { integer = false, min = 0 } = {}) {
  const values = flagValues(argv, name);
  if (values.length === 0) return null;
  if (values.length > 1) fail(`--${name} was given more than once`);
  const raw = values[0];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
    fail(`--${name} must be ${integer ? 'an integer' : 'a number'} >= ${min}, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export async function main(argv, io = {}) {
  const dir = argv[0];
  if (dir === undefined || dir.startsWith('--')) fail(`a runlog directory is required\n${USAGE}`);

  const rest = argv.slice(1);
  const known = new Set(['--stall-seconds', '--interval', '--total', '--pid', '--once', '--polls']);
  for (const token of rest) {
    if (token.startsWith('--') && !known.has(token)) fail(`unknown flag ${token}\n${USAGE}`);
  }

  const stallSeconds = numberFlag(rest, 'stall-seconds', { min: 1 });
  const intervalSeconds = numberFlag(rest, 'interval', { min: 1 }) ?? DEFAULT_INTERVAL_SECONDS;
  const total = numberFlag(rest, 'total', { integer: true, min: 1 });
  const pollsFlag = numberFlag(rest, 'polls', { integer: true, min: 0 });
  const once = rest.includes('--once');
  if (once && pollsFlag !== null && pollsFlag !== 1) fail('--once and --polls disagree; --once is --polls 1');

  const pids = flagValues(rest, 'pid').map((raw) => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) fail(`--pid must be a positive integer, got ${JSON.stringify(raw)}`);
    return n;
  });

  return watch(
    path.resolve(dir),
    {
      stallSeconds,
      total,
      intervalMs: intervalSeconds * 1000,
      polls: once ? 1 : (pollsFlag ?? 0),
      pids,
    },
    io,
  );
}

function isEntryPoint() {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) await main(process.argv.slice(2));
