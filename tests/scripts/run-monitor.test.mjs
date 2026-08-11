// Tests for plugin/scripts/run-monitor.mjs — the run monitor (P3.2).
//
//   node --test tests/scripts/run-monitor.test.mjs
//
// The monitor is a CLI the founder runs, but its whole job is a decision made over TIME:
// three signals, each flat or not, judged against a threshold. Testing that by spawning a
// CLI and waiting would mean sleeping for the threshold, so almost everything here drives
// the exported assessor directly with a synthetic timeline — clock, CPU probe and sleep
// are all injected. P3.1's tests spawned the CLI about thirty times and cost the fast tier
// several seconds; this file spawns it four times, for the cases where being a real
// process is the thing under test.
//
// Nothing here needs git, so it belongs in the fast `npm test` tier.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyStatus,
  createMonitor,
  fmtDuration,
  formatReport,
  probeCpu,
  readRunlog,
  sentinelPids,
  watch,
} from '../../plugin/scripts/run-monitor.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const MONITOR = path.join(repoRoot, 'plugin', 'scripts', 'run-monitor.mjs');
const RUNLOG = path.join(repoRoot, 'plugin', 'scripts', 'runlog.mjs');

const scratch = [];
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

function tempDir(prefix = 'aeo-monitor-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** A project anchor `projectAnchor` resolves without git, the same trick runlog's tests use. */
function makeAnchor() {
  const dir = tempDir('aeo-monitor-anchor-');
  mkdirSync(path.join(dir, '.aeo', 'runs'), { recursive: true });
  return dir;
}

/** A runlog directory in the shape `runlog open` leaves behind, built without spawning it. */
function openRun(root, name = 'run', { records = [], log = '' } = {}) {
  const dir = path.join(root, 'logs', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'run.jsonl'), records.map((r) => `${JSON.stringify(r)}\n`).join(''));
  writeFileSync(path.join(dir, 'console.log'), log);
  writeFileSync(path.join(dir, 'summary.md'), `# ${name}\n`);
  return dir;
}

function ageFile(file, secondsAgo) {
  const when = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(file, when, when);
}

function record(overrides = {}) {
  return { ts: new Date().toISOString(), job: 'job', unit: 'u', status: 'ok', duration: 0, detail: '', ...overrides };
}

// A complete observation, so each test states only the field it is about.
const T0 = 1_760_000_000_000;
function obs(overrides = {}) {
  return {
    dir: 'X:/fake/logs/run',
    present: true,
    opened: true,
    error: null,
    job: 'job',
    records: 4,
    units: 4,
    ok: 4,
    failed: 0,
    other: 0,
    malformed: 0,
    closed: null,
    firstTs: null,
    lastTs: null,
    openedAtMs: null,
    jsonlMtimeMs: null,
    logPresent: true,
    logBytes: 100,
    logMtimeMs: null,
    cpu: { ok: true, seconds: 10, gone: false, reason: null },
    cpuSource: null,
    pids: [4242],
    at: T0,
    ...overrides,
  };
}

const cpuAt = (seconds) => ({ ok: true, seconds, gone: false, reason: null });

/** Two looks at a job whose checkpoints and logs have not moved for ten minutes. */
function wedgedTimeline({ stallSeconds = 60, intervalMs = 10_000, cpu = [cpuAt(10), cpuAt(10)] } = {}) {
  const flatSince = T0 - 600_000;
  const step = createMonitor({ stallSeconds, intervalMs });
  return cpu.map((c, i) => step(obs({ at: T0 + i * intervalMs, lastTs: flatSince, logMtimeMs: flatSince, cpu: c })));
}

// ---------------------------------------------------------------------------
// The four cases the verify line names
// ---------------------------------------------------------------------------

describe('verify case 1 — a long job read live, records arriving over time', () => {
  test('watch reports rising progress and ends itself when the run closes', async () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, '2026-08-11-live', { records: [record({ unit: 'u0' })] });

    let clock = Date.now();
    const jsonl = path.join(dir, 'run.jsonl');
    let written = 1;
    const io = {
      now: () => clock,
      // No real sleeping: the "wait" is where the job makes its next record.
      sleep: async (ms) => {
        clock += ms;
        written += 1;
        if (written <= 4) {
          writeFileSync(jsonl, `${readFileSync(jsonl, 'utf8')}${JSON.stringify(record({ unit: `u${written}` }))}\n`);
        } else {
          writeFileSync(
            jsonl,
            `${readFileSync(jsonl, 'utf8')}${JSON.stringify(record({ unit: 'run', status: 'ok' }))}\n`,
          );
        }
      },
      cpuProbe: (() => {
        let s = 5;
        return () => cpuAt((s += 2));
      })(),
      write: (text) => reports.push(text),
      discoverPids: () => ({ pids: [4242], source: 'pid 4242, from a fake sentinel' }),
    };
    const reports = [];

    const last = await watch(dir, { stallSeconds: 600, intervalMs: 1000, polls: 10, total: 4 }, io);

    assert.equal(last.status, 'DONE', 'the loop must end on the close record, not run to --polls');
    assert.ok(reports.length < 10, 'watch kept polling after the run closed');
    assert.equal(last.progress.units, 4);
    assert.equal(last.progress.total, 4);

    const seen = reports.map((r) => /status\s+(\S+)/.exec(r)[1]);
    assert.equal(seen[0], 'MOVING');
    assert.equal(seen.at(-1), 'DONE');
    assert.ok(
      reports.some((r) => /rate\s+\d/.test(r)),
      'no report carried a rate',
    );
  });
});

describe('verify case 2 — a wedged job is reported STALLED', () => {
  test('all three flat past the threshold is STALLED', () => {
    const [first, second] = wedgedTimeline();
    assert.equal(first.status, 'SUSPECT', 'one CPU sample cannot show movement, so the first look must not accuse');
    assert.equal(second.status, 'STALLED');
    assert.match(second.reasons.join(' '), /checkpoints flat/);
    assert.match(second.reasons.join(' '), /CPU flat/);
  });

  test('the STALLED report says not to blind-restart it (L-08)', () => {
    const [, second] = wedgedTimeline();
    assert.match(formatReport(second), /blind-restart/);
  });

  test('a CPU reading unchanged for less than one interval is not yet flat', () => {
    const flatSince = T0 - 600_000;
    const step = createMonitor({ stallSeconds: 60, intervalMs: 10_000 });
    step(obs({ at: T0, lastTs: flatSince, logMtimeMs: flatSince, cpu: cpuAt(10) }));
    const second = step(obs({ at: T0 + 3000, lastTs: flatSince, logMtimeMs: flatSince, cpu: cpuAt(10) }));
    assert.equal(second.status, 'SUSPECT', 'a 3s window under a 10s interval was scored as a flat CPU signal');
    assert.match(second.reasons.join(' '), /full interval/);
  });
});

describe('verify case 3 — a slow but working job is NOT reported stalled', () => {
  test('checkpoints and logs flat past the threshold, CPU climbing, is MOVING', () => {
    const [, second] = wedgedTimeline({ cpu: [cpuAt(10), cpuAt(10.5)] });
    assert.equal(second.status, 'MOVING');
    assert.match(second.reasons.join(' '), /Slow is not stalled/);
  });

  test('two flat signals are never three: no threshold crossing produces STALLED on its own', () => {
    // Checkpoints flat for an hour, logs still being written every look.
    const step = createMonitor({ stallSeconds: 60, intervalMs: 10_000 });
    const cpFlat = T0 - 3_600_000;
    const a = [0, 1, 2].map((i) =>
      step(obs({ at: T0 + i * 10_000, lastTs: cpFlat, logMtimeMs: T0 + i * 10_000, cpu: cpuAt(10) })),
    );
    assert.deepEqual(
      a.map((x) => x.status),
      ['MOVING', 'MOVING', 'MOVING'],
    );
  });
});

describe('verify case 4 — an uninstrumented run is UNKNOWN, never idle (L-08)', () => {
  test('a directory that does not exist is UNKNOWN', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const a = step(obs({ present: false, opened: false, records: 0, units: 0, ok: 0, logPresent: false }));
    assert.equal(a.status, 'UNKNOWN');
    assert.match(a.reasons.join(' '), /does not exist/);
  });

  test('a directory with no run.jsonl is UNKNOWN', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const a = step(obs({ opened: false, records: 0, units: 0, ok: 0, logPresent: false }));
    assert.equal(a.status, 'UNKNOWN');
    assert.match(a.reasons.join(' '), /no run\.jsonl/);
  });

  test('the word IDLE appears in no report the monitor can produce', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const reports = [
      step(obs({ present: false, opened: false, logPresent: false })),
      ...wedgedTimeline(),
      ...wedgedTimeline({ cpu: [cpuAt(1), cpuAt(9)] }),
      ...wedgedTimeline({ stallSeconds: null }),
      wedgedTimeline({ cpu: [{ ok: false, seconds: null, gone: true, reason: 'pid 1 is gone' }] })[0],
      step(obs({ closed: { status: 'ok' } })),
    ].map(formatReport);
    for (const r of reports) assert.ok(!/\bIDLE\b/i.test(r), `a report used the word IDLE:\n${r}`);
  });

  test('the status vocabulary is exactly seven words, and idle is not one of them', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const statuses = new Set(
      [
        step(obs({ present: false, opened: false, logPresent: false })),
        ...wedgedTimeline(),
        ...wedgedTimeline({ cpu: [cpuAt(1), cpuAt(9)] }),
        ...wedgedTimeline({ stallSeconds: null }),
        wedgedTimeline({ cpu: [{ ok: false, seconds: null, gone: true, reason: 'pid 1 is gone' }] })[0],
        step(obs({ closed: { status: 'ok' } })),
      ].map((a) => a.status),
    );
    const allowed = new Set(['UNKNOWN', 'DONE', 'EXITED', 'MOVING', 'QUIET', 'STALLED', 'SUSPECT']);
    for (const s of statuses) assert.ok(allowed.has(s), `${s} is outside the documented vocabulary`);
    assert.equal(allowed.has('IDLE'), false);
  });

  test('an opened-but-empty run is NOT unknown, and says it is instrumented', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const a = step(obs({ records: 0, units: 0, ok: 0, jsonlMtimeMs: T0 - 5000, logMtimeMs: T0 - 5000 }));
    assert.notEqual(a.status, 'UNKNOWN');
    assert.match(formatReport(a), /no units recorded yet .*instrumented/);
  });

  test('an opened-but-empty run that has been silent past the threshold still stalls', () => {
    // The other half of the same lesson: "nothing recorded yet" must not be an exemption.
    const step = createMonitor({ stallSeconds: 60, intervalMs: 10_000 });
    const silent = T0 - 600_000;
    step(obs({ at: T0, records: 0, units: 0, ok: 0, jsonlMtimeMs: silent, logMtimeMs: silent, cpu: cpuAt(3) }));
    const second = step(
      obs({ at: T0 + 10_000, records: 0, units: 0, ok: 0, jsonlMtimeMs: silent, logMtimeMs: silent, cpu: cpuAt(3) }),
    );
    assert.equal(second.status, 'STALLED');
  });
});

// ---------------------------------------------------------------------------
// The unset threshold (L-08: never a quiet pass)
// ---------------------------------------------------------------------------

describe('an unset --stall-seconds reports liveness only, and says so', () => {
  test('a wedged job is never STALLED without a threshold', () => {
    const a = wedgedTimeline({ stallSeconds: null });
    assert.deepEqual(
      a.map((x) => x.status),
      ['QUIET', 'QUIET'],
    );
  });

  test('every report says detection is off, in capitals, on its own line', () => {
    for (const a of wedgedTimeline({ stallSeconds: null })) {
      const text = formatReport(a);
      assert.match(text, /stall\s+detection OFF/);
      assert.match(text, /CANNOT report a stall/);
      assert.match(text, /Pass --stall-seconds <n> for a verdict/);
    }
  });

  test('an armed report states the threshold instead', () => {
    const [, second] = wedgedTimeline({ stallSeconds: 60 });
    assert.match(formatReport(second), /stall\s+detection ON, threshold 1m00s/);
  });

  test('a healthy job with no threshold still carries the OFF line', () => {
    const step = createMonitor({ stallSeconds: null, intervalMs: 10_000 });
    const a = step(obs({ at: T0, lastTs: T0 - 100, logMtimeMs: T0 - 100 }));
    assert.equal(a.status, 'MOVING');
    assert.match(formatReport(a), /detection OFF/, 'a healthy-looking report is exactly where a quiet pass hides');
  });
});

// ---------------------------------------------------------------------------
// The failed CPU read (SUSPECT, never STALLED)
// ---------------------------------------------------------------------------

describe('a failed CPU read is SUSPECT with the reason, never STALLED', () => {
  const broken = { ok: false, seconds: null, gone: false, reason: '`ps` could not be run (spawn ps ENOENT)' };

  test('the status is SUSPECT and the probe failure is quoted', () => {
    const a = wedgedTimeline({ cpu: [broken, broken] });
    assert.deepEqual(
      a.map((x) => x.status),
      ['SUSPECT', 'SUSPECT'],
    );
    assert.match(a[1].reasons.join(' '), /spawn ps ENOENT/);
    assert.match(a[1].reasons.join(' '), /Two flat signals are not three/);
  });

  test('no pid at all is the same case, not a stall', () => {
    const nopid = { ok: false, seconds: null, gone: false, reason: 'no pid was supplied or discovered, so CPU cannot be read' };
    const [, second] = wedgedTimeline({ cpu: [nopid, nopid] });
    assert.equal(second.status, 'SUSPECT');
    assert.match(second.reasons.join(' '), /no pid was supplied/);
  });

  test('a probe that fails and then recovers restarts the flat streak', () => {
    const a = wedgedTimeline({ cpu: [cpuAt(10), broken, cpuAt(10), cpuAt(10)] });
    assert.deepEqual(
      a.map((x) => x.status),
      ['SUSPECT', 'SUSPECT', 'SUSPECT', 'STALLED'],
      'a gap in the samples was treated as a window somebody watched',
    );
  });

  test('an absent console.log makes the log signal unavailable, not flat', () => {
    const flatSince = T0 - 600_000;
    const step = createMonitor({ stallSeconds: 60, intervalMs: 10_000 });
    step(obs({ at: T0, lastTs: flatSince, logPresent: false, logMtimeMs: null, cpu: cpuAt(10) }));
    const second = step(
      obs({ at: T0 + 10_000, lastTs: flatSince, logPresent: false, logMtimeMs: null, cpu: cpuAt(10) }),
    );
    assert.equal(second.status, 'SUSPECT');
    assert.match(second.reasons.join(' '), /no console\.log/);
  });

  test('a run log the monitor cannot read is SUSPECT, not a clean bill of health', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const a = step(obs({ error: 'run.jsonl could not be read (EACCES)' }));
    assert.equal(a.status, 'SUSPECT');
    assert.match(a.reasons.join(' '), /EACCES/);
  });
});

// ---------------------------------------------------------------------------
// The rest of the vocabulary
// ---------------------------------------------------------------------------

describe('DONE and EXITED', () => {
  test('a terminal unit:"run" record is DONE, and the close status is quoted', () => {
    const step = createMonitor({ stallSeconds: 60 });
    const a = step(obs({ closed: { status: 'failed', tsMs: T0 } }));
    assert.equal(a.status, 'DONE');
    assert.equal(a.closeStatus, 'failed');
    assert.match(formatReport(a), /closed with status: failed/);
  });

  test('a closed run is DONE even when every signal is flat', () => {
    const flatSince = T0 - 600_000;
    const step = createMonitor({ stallSeconds: 60, intervalMs: 10_000 });
    step(obs({ at: T0, lastTs: flatSince, logMtimeMs: flatSince, cpu: cpuAt(10) }));
    const second = step(
      obs({ at: T0 + 10_000, lastTs: flatSince, logMtimeMs: flatSince, cpu: cpuAt(10), closed: { status: 'ok' } }),
    );
    assert.equal(second.status, 'DONE');
  });

  test('a gone process with no close record is EXITED, not STALLED', () => {
    const gone = { ok: false, seconds: null, gone: true, reason: 'pid 4242 is gone' };
    const [, second] = wedgedTimeline({ cpu: [gone, gone] });
    assert.equal(second.status, 'EXITED');
    assert.match(second.reasons.join(' '), /crashed or was killed/);
    assert.match(second.reasons.join(' '), /launcher/, 'EXITED must admit the launcher-pid false alarm');
  });
});

// ---------------------------------------------------------------------------
// Progress, rate, projection, failures
// ---------------------------------------------------------------------------

describe('progress, rate and projection', () => {
  test('rate is units per minute over the elapsed time, and remaining follows from --total', () => {
    const step = createMonitor({ stallSeconds: null, total: 120 });
    const a = step(obs({ at: T0, units: 30, records: 30, ok: 30, firstTs: T0 - 600_000 }));
    assert.equal(a.elapsedMs, 600_000);
    assert.equal(a.rate, 3);
    assert.equal(a.remainingUnits, 90);
    assert.equal(a.remainingMs, 1_800_000);
    assert.match(formatReport(a), /remaining\s+~30m00s \(90 unit\(s\) left/);
  });

  test('without --total, remaining is reported unknown and never guessed', () => {
    const step = createMonitor({ stallSeconds: null });
    const a = step(obs({ at: T0, units: 30, records: 30, ok: 30, firstTs: T0 - 600_000 }));
    assert.equal(a.remainingMs, null);
    assert.equal(a.remainingUnits, null);
    assert.match(formatReport(a), /remaining\s+unknown -- no --total supplied, so this monitor will not guess/);
  });

  test('elapsed falls back to run.jsonl creation when nothing has been recorded', () => {
    const step = createMonitor({ stallSeconds: null });
    const a = step(obs({ at: T0, units: 0, records: 0, ok: 0, firstTs: null, openedAtMs: T0 - 120_000 }));
    assert.equal(a.elapsedMs, 120_000);
    assert.match(formatReport(a), /elapsed\s+2m00s \(since the run\.jsonl created\)/);
  });

  test('failures are counted, and an unrecognised status lands in `other` rather than in `ok`', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, '2026-08-11-counts', {
      records: [
        record({ unit: 'a', status: 'ok' }),
        record({ unit: 'b', status: 'FAILED' }),
        record({ unit: 'c', status: 'error: connection reset' }),
        record({ unit: 'd', status: 'timeout' }),
        record({ unit: 'e', status: 'partial' }),
        record({ unit: 'f', status: 'skipped' }),
      ],
    });
    const log = readRunlog(dir);
    assert.equal(log.units, 6);
    assert.equal(log.ok, 2, 'ok and skipped');
    assert.equal(log.failed, 3, 'FAILED, error, timeout');
    assert.equal(log.other, 1, '`partial` must be visible as unclassified, not folded into ok');

    const a = createMonitor({ stallSeconds: null })(obs({ ...log, at: T0 }));
    assert.match(formatReport(a), /6 unit\(s\) recorded \(2 ok, 3 failed, 1 other status\)/);
  });

  test('classifyStatus buckets the ordinary vocabulary', () => {
    assert.equal(classifyStatus('ok'), 'ok');
    assert.equal(classifyStatus('PASSED'), 'ok');
    assert.equal(classifyStatus('failure'), 'failed');
    assert.equal(classifyStatus('crashed on input 12'), 'failed');
    assert.equal(classifyStatus('weird'), 'other');
    assert.equal(classifyStatus(''), 'other');
    assert.equal(classifyStatus(undefined), 'other');
  });
});

// ---------------------------------------------------------------------------
// Reading what runlog writes
// ---------------------------------------------------------------------------

describe('readRunlog', () => {
  test('the three states P3.1 makes distinguishable stay distinguishable', () => {
    const anchor = makeAnchor();
    const absent = readRunlog(path.join(anchor, 'logs', 'never-opened'));
    assert.equal(absent.present, false);
    assert.equal(absent.opened, false);

    const empty = readRunlog(openRun(anchor, 'opened-empty'));
    assert.equal(empty.present, true);
    assert.equal(empty.opened, true);
    assert.equal(empty.records, 0);

    const busy = readRunlog(openRun(anchor, 'busy', { records: [record()] }));
    assert.equal(busy.opened, true);
    assert.equal(busy.records, 1);
  });

  test('a terminal unit:"run" record is the close, not a unit', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, 'closed', {
      records: [record({ unit: 'a' }), record({ unit: 'run', status: 'ok' })],
    });
    const log = readRunlog(dir);
    assert.equal(log.records, 2);
    assert.equal(log.units, 1, 'the close record was counted as a unit of work');
    assert.deepEqual(log.closed, { status: 'ok', tsMs: log.lastTs });
  });

  test('a torn or non-JSON line is counted as malformed rather than swallowed', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, 'torn', { records: [record({ unit: 'a' })] });
    const jsonl = path.join(dir, 'run.jsonl');
    writeFileSync(jsonl, `${readFileSync(jsonl, 'utf8')}{"ts":"2026-01-0\n[1,2,3]\n`);
    const log = readRunlog(dir);
    assert.equal(log.records, 1);
    assert.equal(log.malformed, 2);
    assert.match(formatReport(createMonitor({ stallSeconds: null })(obs({ ...log, at: T0 }))), /unparseable line/);
  });

  test('the job name comes off the records, so the sentinel can be found', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, '2026-08-11-x-2', { records: [record({ job: 'corpus-ingest' })] });
    assert.equal(readRunlog(dir).job, 'corpus-ingest');
  });

  test('what `runlog` actually writes is what this reads (the P3.1 format contract)', () => {
    const anchor = makeAnchor();
    const run = (args) => spawnSync(process.execPath, [RUNLOG, ...args], { encoding: 'utf8', cwd: anchor, windowsHide: true });
    const dir = run(['open', '--job', 'contract', '--date', '2026-08-11']).stdout.trim();
    run(['record', '--dir', dir, '--job', 'contract', '--unit', 'a', '--status', 'ok', '--duration', '10']);
    run(['record', '--dir', dir, '--job', 'contract', '--unit', 'b', '--status', 'failed']);
    run(['close', '--dir', dir, '--job', 'contract', '--status', 'ok']);

    const log = readRunlog(dir);
    assert.equal(log.opened, true);
    assert.equal(log.job, 'contract');
    assert.equal(log.units, 2);
    assert.equal(log.ok, 1);
    assert.equal(log.failed, 1);
    assert.equal(log.closed?.status, 'ok');
    assert.equal(log.logPresent, true, 'runlog open creates console.log, which is the second signal');
    assert.ok(log.lastTs !== null, 'no record timestamp parsed; the checkpoint signal would have no age');
  });
});

// ---------------------------------------------------------------------------
// The CPU probe
// ---------------------------------------------------------------------------

describe('probeCpu', () => {
  const ok = (stdout) => () => ({ status: 0, stdout, stderr: '' });

  test('no pid is a stated reason, not a zero', () => {
    const r = probeCpu([]);
    assert.equal(r.ok, false);
    assert.equal(r.gone, false);
    assert.match(r.reason, /no pid was supplied/);
  });

  test('posix: HH:MM:SS from `ps -o pid=,time=` becomes seconds', () => {
    const r = probeCpu([10], { platform: 'linux', spawn: ok('   10 00:01:23\n') });
    assert.equal(r.ok, true);
    assert.equal(r.seconds, 83);
  });

  test('posix: MM:SS and DD-HH:MM:SS both parse', () => {
    assert.equal(probeCpu([10], { platform: 'linux', spawn: ok('10 01:23') }).seconds, 83);
    assert.equal(
      probeCpu([10], { platform: 'darwin', spawn: ok('10 2-03:04:05') }).seconds,
      2 * 86400 + 3 * 3600 + 245,
    );
  });

  test('posix: a pid ps does not know is gone, not a failed probe', () => {
    const r = probeCpu([10], { platform: 'linux', spawn: () => ({ status: 1, stdout: '', stderr: '' }) });
    assert.equal(r.gone, true);
    assert.equal(r.ok, false);
  });

  test('posix: ps missing from PATH is a failed probe, not a gone process', () => {
    const r = probeCpu([10], { platform: 'linux', spawn: () => ({ error: new Error('spawn ps ENOENT') }) });
    assert.equal(r.ok, false);
    assert.equal(r.gone, false);
    assert.match(r.reason, /could not be run/);
  });

  test('posix: output that is not a pid and a CPU time is a failed probe, not a zero', () => {
    const r = probeCpu([10], { platform: 'linux', spawn: ok('nonsense') });
    assert.equal(r.ok, false);
    assert.equal(r.gone, false);
    assert.match(r.reason, /not a pid and a CPU time/);
  });

  test('windows: 100ns ticks become seconds', () => {
    const r = probeCpu([10], { platform: 'win32', spawn: ok('10 123456789\n') });
    assert.equal(r.ok, true);
    assert.equal(r.seconds, 12.3456789);
  });

  test('windows: a pid absent from the output is gone', () => {
    const r = probeCpu([10], { platform: 'win32', spawn: () => ({ status: 0, stdout: '', stderr: '' }) });
    assert.equal(r.gone, true);
  });

  test('windows: a non-zero exit is a failed probe, not a gone process', () => {
    const r = probeCpu([10], { platform: 'win32', spawn: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
    assert.equal(r.ok, false);
    assert.equal(r.gone, false);
    assert.match(r.reason, /boom/);
  });

  test('windows: the probe carries no double quotes, so argv quoting cannot maul it', () => {
    let seen = null;
    probeCpu([4242, 77], {
      platform: 'win32',
      spawn: (cmd, args) => {
        seen = { cmd, args };
        return { status: 0, stdout: '4242 10\n77 20\n', stderr: '' };
      },
    });
    assert.equal(seen.cmd, 'powershell');
    const script = seen.args.at(-1);
    assert.ok(!script.includes('"'), `the probe script carries a double quote: ${script}`);
    assert.match(script, /ProcessId=4242 OR ProcessId=77/);
    assert.match(script, /KernelModeTime \+ \$_\.UserModeTime/);
  });

  test('every watched pid is read in one spawn, not one spawn per pid', () => {
    for (const platform of ['linux', 'win32']) {
      let calls = 0;
      probeCpu([1, 2, 3, 4], {
        platform,
        spawn: () => {
          calls += 1;
          return { status: 0, stdout: '1 00:00:01\n2 00:00:01\n3 00:00:01\n4 00:00:01\n', stderr: '' };
        },
      });
      assert.equal(calls, 1, `${platform} spawned ${calls} probes for four pids`);
    }
  });

  test('several pids are summed, and one dead worker beside a live one is not "gone"', () => {
    const r = probeCpu([1, 2, 3], { platform: 'linux', spawn: ok('1 00:00:10\n2 00:00:05\n') });
    assert.equal(r.ok, true);
    assert.equal(r.seconds, 15);
    assert.equal(r.gone, false);
    assert.match(r.reason, /pid 3 gone/);
  });

  test('every pid gone is gone', () => {
    const r = probeCpu([1, 2], { platform: 'linux', spawn: () => ({ status: 1, stdout: '', stderr: '' }) });
    assert.equal(r.gone, true);
    assert.match(r.reason, /pid 1, 2 is gone/);
  });

  test('a probe that could not run fails the whole signal rather than reporting a partial sum', () => {
    const r = probeCpu([1, 2], { platform: 'linux', spawn: () => ({ error: new Error('boom') }) });
    assert.equal(r.ok, false);
    assert.equal(r.gone, false);
    assert.equal(r.seconds, null);
  });
});

// ---------------------------------------------------------------------------
// Discovering the pid from the run's own sentinel
// ---------------------------------------------------------------------------

describe('sentinelPids', () => {
  function raise(anchor, id, body) {
    mkdirSync(path.join(anchor, '.aeo', 'runs'), { recursive: true });
    writeFileSync(path.join(anchor, '.aeo', 'runs', `${id}.json`), JSON.stringify(body));
  }

  test('a sentinel raised with --pid on this machine supplies the pid', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, 'x');
    raise(anchor, 'corpus-ingest', { id: 'corpus-ingest', pid: 4242, host: os.hostname() });
    const r = sentinelPids(dir, 'corpus-ingest');
    assert.deepEqual(r.pids, [4242]);
    assert.match(r.source, /4242/);
  });

  test('a sentinel from another machine is refused, with the reason', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, 'x');
    raise(anchor, 'j', { id: 'j', pid: 1, host: 'some-other-box' });
    const r = sentinelPids(dir, 'j');
    assert.deepEqual(r.pids, []);
    assert.match(r.source, /some-other-box/);
  });

  test('a sentinel with no pid says how to record one', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, 'x');
    raise(anchor, 'j', { id: 'j', pid: null, host: os.hostname() });
    const r = sentinelPids(dir, 'j');
    assert.deepEqual(r.pids, []);
    assert.match(r.source, /run-sentinel start --pid/);
  });

  test('no sentinel and no job name are both stated, not silent', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, 'x');
    assert.match(sentinelPids(dir, 'nobody').source, /no readable run sentinel/);
    assert.match(sentinelPids(dir, '').source, /no job name/);
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

describe('the report is plain text', () => {
  test('no ANSI escapes anywhere, in any status', () => {
    const step = createMonitor({ stallSeconds: 60, intervalMs: 10_000, total: 10 });
    const all = [
      step(obs({ present: false, opened: false })),
      ...wedgedTimeline(),
      wedgedTimeline({ stallSeconds: null })[0],
    ].map(formatReport);
    // eslint-disable-next-line no-control-regex
    for (const text of all) assert.ok(!/\u001b/.test(text), 'the report carried an escape sequence');
  });

  test('an UNKNOWN block stays short, and still carries the stall line', () => {
    const a = createMonitor({ stallSeconds: null })(obs({ present: false, opened: false }));
    const lines = formatReport(a).split('\n');
    assert.ok(lines.length <= 6, `UNKNOWN printed ${lines.length} lines`);
    assert.match(formatReport(a), /stall\s+detection OFF/);
  });

  test('fmtDuration reads as a duration at every scale', () => {
    assert.equal(fmtDuration(0), '0s');
    assert.equal(fmtDuration(41_000), '41s');
    assert.equal(fmtDuration(881_000), '14m41s');
    assert.equal(fmtDuration(8_040_000), '2h14m');
    assert.equal(fmtDuration(null), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// The CLI itself
// ---------------------------------------------------------------------------

describe('the CLI', () => {
  function cli(args, { cwd } = {}) {
    const r = spawnSync(process.execPath, [MONITOR, ...args], { encoding: 'utf8', cwd, windowsHide: true });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  test('a directory nobody opened reports UNKNOWN and exits 0', () => {
    const anchor = makeAnchor();
    const r = cli([path.join(anchor, 'logs', 'nothing-here'), '--once'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /status\s+UNKNOWN/);
    assert.ok(!/\bIDLE\b/i.test(r.stdout), 'the CLI used the word IDLE for an uninstrumented run');
    assert.match(r.stdout, /not a report that the job is quiet, or finished/);
  });

  test('a real run watched live from a plain terminal prints one block per look', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, '2026-08-11-cli', {
      records: [record({ unit: 'a' }), record({ unit: 'b', status: 'failed' })],
      log: 'some output\n',
    });
    ageFile(path.join(dir, 'console.log'), 5);
    const r = cli([dir, '--polls', '2', '--interval', '1', '--stall-seconds', '600', '--total', '10'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    const blocks = r.stdout.trim().split('\n\n');
    assert.equal(blocks.length, 2, `expected two blocks, got:\n${r.stdout}`);
    for (const b of blocks) {
      assert.match(b, /status\s+(MOVING|QUIET)/);
      assert.match(b, /2 unit\(s\) recorded \(1 ok, 1 failed\) of 10 expected/);
      assert.match(b, /stall\s+detection ON/);
    }
    assert.ok(!/\u001b/.test(r.stdout), 'the CLI emitted ANSI, which breaks when redirected');
  });

  test('without --stall-seconds the CLI says it cannot report a stall', () => {
    const anchor = makeAnchor();
    const dir = openRun(anchor, '2026-08-11-liveness', { records: [record()] });
    const r = cli([dir, '--once'], { cwd: anchor });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /detection OFF/);
    assert.match(r.stdout, /CANNOT report a stall/);
  });

  test('bad input is refused with usage, not run with a guess', () => {
    assert.equal(cli([]).status, 1);
    assert.match(cli([]).stderr, /usage/);
    assert.equal(cli(['--once']).status, 1);
    assert.match(cli(['somewhere', '--stall-seconds', 'soon']).stderr, /--stall-seconds must be/);
    assert.match(cli(['somewhere', '--nope']).stderr, /unknown flag --nope/);
    assert.match(cli(['somewhere', '--pid', '0']).stderr, /--pid must be a positive integer/);
  });
});
