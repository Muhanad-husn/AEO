#!/usr/bin/env node
// P5.5 measurement 1: what four concurrent commit gates cost against one.
//
// WHY THIS EXISTS. D11 caps development actors at four and says Phase 5 must MEASURE core
// oversubscription rather than assume it. The unit under test is the commit gate's tier
// (D17: `npm test`), so this runs that exact command and nothing else. It ships no fix: a
// number is the whole output.
//
//   node tests/measure/oversubscription.mjs [--dir <runlog dir>] [--rounds 5] [--actors 4]
//
// WHY IT IS NOT A `.test.mjs` FILE. tests/hooks/test-tiers.test.mjs fails the fast tier the
// moment a `.test.mjs` file exists that neither npm script names, and adding a
// twelve-minute measurement to the commit gate would be absurd. So this is a script run on
// demand, CI does not cover it, and its positive control runs inside it on every invocation
// instead of in a suite.
//
// INTERLEAVED, NOT BATCHED (L-10). One round is a serial baseline and then a concurrent
// group, back to back. Taking all the baselines first and all the groups after would let
// slow drift in machine load masquerade as the effect. This is what fix-8 did, for the same
// reason.
//
// THE RATIO IS THE QUANTITY, NOT THE WALL CLOCK. Group wall clock over the serial single
// run from the SAME round. Near 1 means the machine absorbed four actors; 4 means they were
// fully serialised. A wall clock alone is a property of this machine on this afternoon.
//
// THE MACHINE IS NOT QUIET AND CANNOT BE MADE QUIET. Another Claude Code session runs on
// this box. So every trial samples the load it ran under — system CPU busy fraction across
// the span, and the node process count at the start — and stores it in the record. A number
// without its load is not a measurement.
//
// ISOLATION. Each actor gets its own copy of the checkout, which is what four worktrees
// would give it: separate node_modules resolution, separate temp fixtures, separate file
// locks. The copies are plain directory copies with a fresh `git init`, not git worktrees —
// worktree machinery is not what is being measured and building it here would be a second
// implementation of something Phase 1 already ships.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const runlog = path.join(repoRoot, 'plugin', 'scripts', 'runlog.mjs');
const JOB = 'p5.5-concurrency';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const rounds = Number(flag('rounds', '5'));
const actors = Number(flag('actors', '4'));
const noiseRuns = Number(flag('noise', '4'));
const workRoot = path.resolve(flag('workdir', path.join(os.tmpdir(), 'p5.5-actors')));

// ---------------------------------------------------------------- load sampling

/** Cumulative busy and total CPU ticks across all logical cores. */
function cpuTicks() {
  let busy = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const [mode, ticks] of Object.entries(c.times)) {
      total += ticks;
      if (mode !== 'idle') busy += ticks;
    }
  }
  return { busy, total };
}

/** Busy fraction of the whole machine between two tick samples, 0..1. */
function busyBetween(a, b) {
  const total = b.total - a.total;
  return total <= 0 ? 0 : (b.busy - a.busy) / total;
}

/**
 * How many node processes exist right now, or -1 where that cannot be asked.
 *
 * Windows-only because this is the only machine the measurement claims to describe. The
 * count is the honest proxy available for "what else is running": the competing session is
 * node, and so is everything this harness spawns.
 */
function nodeProcesses() {
  if (process.platform !== 'win32') return -1;
  const out = spawnSync('tasklist', ['/FI', 'IMAGENAME eq node.exe', '/NH'], { encoding: 'utf8' });
  if (out.status !== 0) return -1;
  return out.stdout.split('\n').filter((l) => l.toLowerCase().includes('node.exe')).length;
}

// ---------------------------------------------------------------- run log

// `--dir` is not optional decoration. Run from a linked worktree, `runlog open` anchors to
// the MAIN repository (sentinel.mjs walks `.git` through linkedWorktreeMain by design, D12),
// so it creates the run directory in the wrong checkout. Both entry points of this slice
// also have to write into ONE directory. So the directory is passed in, and `open` is used
// only when this runs from an ordinary checkout.
let runDir = flag('dir', null);
if (runDir === null) {
  const opened = spawnSync(process.execPath, [runlog, 'open', '--job', JOB, '--date', '2026-08-12'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (opened.status !== 0) {
    process.stderr.write(opened.stderr ?? 'runlog open failed\n');
    process.exit(1);
  }
  runDir = opened.stdout.trim();
}

/**
 * One record through runlog's fixed six-field envelope (EN-14).
 *
 * Everything this measurement needs beyond ts/job/unit/status/duration goes into `detail`
 * as `k=v` pairs. The envelope has no room for a ratio or a load sample and the rule is that
 * it never grows a key, so detail carries them and the write-up says it does.
 */
function record(unit, status, durationMs, detail) {
  const r = spawnSync(
    process.execPath,
    [
      runlog, 'record',
      '--dir', runDir,
      '--job', JOB,
      '--unit', unit,
      '--status', status,
      '--duration', String(Math.round(durationMs)),
      '--detail', detail,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (r.status !== 0) process.stderr.write(r.stderr ?? '');
}

// ---------------------------------------------------------------- checkouts

/** N copies of this checkout, one per actor. Returns their paths. */
function prepareCheckouts(n) {
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  const dirs = [];
  for (let i = 0; i < n; i += 1) {
    const dest = path.join(workRoot, `actor-${i + 1}`);
    // `source/` is a multi-gigabyte verbatim snapshot that no test reads, and `.git` would
    // point back into the real repository. Both are excluded; a fresh `git init` then gives
    // each copy the project anchor that sentinel.mjs walks up to find.
    cpSync(repoRoot, dest, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(repoRoot, src);
        return !(rel === '.git' || rel === 'source' || rel === 'node_modules');
      },
    });
    spawnSync('git', ['init', '--quiet'], { cwd: dest });
    dirs.push(dest);
  }
  return dirs;
}

// ---------------------------------------------------------------- trials

/** Run `npm test` in `cwd` to completion. Resolves with wall-clock ms and exit code. */
function fastTier(cwd) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    // shell: true because `npm` on Windows is `npm.cmd`, and since Node 20 spawning a .cmd
    // without a shell is EINVAL. The argument is a literal with no shell metacharacters.
    const child = spawn(NPM, ['test'], { cwd, stdio: 'ignore', shell: true });
    child.on('close', (code) => {
      resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, code });
    });
    child.on('error', () => resolve({ ms: 0, code: -1 }));
  });
}

/** One serial run with its load sample. */
async function serialTrial(cwd) {
  const procs = nodeProcesses();
  const t0 = cpuTicks();
  const r = await fastTier(cwd);
  const busy = busyBetween(t0, cpuTicks());
  return { ...r, busy, procs };
}

/** `dirs.length` runs started together. Group wall clock spans first start to last exit. */
async function groupTrial(dirs) {
  const procs = nodeProcesses();
  const t0 = cpuTicks();
  const started = process.hrtime.bigint();
  const each = await Promise.all(dirs.map((d) => fastTier(d)));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  return { ms, each, busy: busyBetween(t0, cpuTicks()), procs };
}

const fmt = (n, d = 2) => Number(n).toFixed(d);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------------------------------------------------------------- main

const log = (s) => process.stdout.write(`${s}\n`);

log(`run dir: ${runDir}`);
log(`machine: ${os.cpus()[0]?.model ?? 'unknown'}, ${os.cpus().length} logical cores, ` +
    `${fmt(os.totalmem() / 1024 ** 3, 1)} GB, node ${process.version}, ${os.platform()} ${os.release()}`);

log(`\npreparing ${actors} checkouts under ${workRoot} ...`);
const dirs = prepareCheckouts(actors);

// Idle baseline, before anything of ours runs: how loaded is the machine on its own.
const idleT0 = cpuTicks();
await new Promise((r) => setTimeout(r, 3000));
const idleBusy = busyBetween(idleT0, cpuTicks());
const idleProcs = nodeProcesses();
log(`background before any trial: CPU busy ${fmt(idleBusy * 100, 1)}%, ${idleProcs} node processes`);
record('background-idle', 'ok', 3000, `busy=${fmt(idleBusy, 4)} node_procs=${idleProcs} cores=${os.cpus().length}`);

// Warm-up, discarded. The first run pays for cold file cache in a directory that was
// created seconds ago, and that cost belongs to no comparison here.
log('\nwarm-up run (discarded) ...');
const warm = await serialTrial(dirs[0]);
log(`  ${fmt(warm.ms / 1000)}s (exit ${warm.code})`);
record('warmup', warm.code === 0 ? 'ok' : 'fail', warm.ms, `busy=${fmt(warm.busy, 4)} node_procs=${warm.procs} discarded=true`);

// Noise floor, stated before any comparison (L-10).
log(`\nnoise floor: ${noiseRuns} serial runs ...`);
const noise = [];
for (let i = 0; i < noiseRuns; i += 1) {
  const t = await serialTrial(dirs[0]);
  noise.push(t);
  log(`  serial ${i + 1}: ${fmt(t.ms / 1000)}s (exit ${t.code}, machine ${fmt(t.busy * 100, 1)}% busy, ${t.procs} node procs)`);
  record('noise-serial', t.code === 0 ? 'ok' : 'fail', t.ms, `i=${i + 1} busy=${fmt(t.busy, 4)} node_procs=${t.procs} exit=${t.code}`);
}
const noiseMs = noise.map((t) => t.ms);
const noiseMed = median(noiseMs);
const noiseSpread = (Math.max(...noiseMs) - Math.min(...noiseMs)) / noiseMed;
log(`  median ${fmt(noiseMed / 1000)}s, min ${fmt(Math.min(...noiseMs) / 1000)}s, max ${fmt(Math.max(...noiseMs) / 1000)}s, ` +
    `spread ${fmt(noiseSpread * 100, 1)}% of median`);
record('noise-floor', 'ok', noiseMed, `n=${noiseRuns} median_ms=${Math.round(noiseMed)} spread_frac=${fmt(noiseSpread, 4)}`);

// What one run actually uses. `node --test` fans out across cores inside a single run, so
// one fast tier is not one core's worth of work, and the group number cannot be read without
// this. Subtracting the idle baseline is an approximation: the competing session's own load
// varies, and this attributes all of the difference to our run.
const oneRunCores = (median(noise.map((t) => t.busy)) - idleBusy) * os.cpus().length;
log(`  one fast tier adds about ${fmt(oneRunCores, 1)} cores of load over the background baseline`);
record('one-run-cores', 'ok', 0, `cores=${fmt(oneRunCores, 2)} idle_busy=${fmt(idleBusy, 4)} run_busy=${fmt(median(noise.map((t) => t.busy)), 4)}`);

// Interleaved rounds.
log(`\n${rounds} interleaved rounds, serial then a group of ${actors} ...`);
const ratios = [];
for (let r = 1; r <= rounds; r += 1) {
  const s = await serialTrial(dirs[0]);
  record('round-serial', s.code === 0 ? 'ok' : 'fail', s.ms, `round=${r} busy=${fmt(s.busy, 4)} node_procs=${s.procs} exit=${s.code}`);
  const g = await groupTrial(dirs);
  const ratio = g.ms / s.ms;
  ratios.push(ratio);
  g.each.forEach((a, i) => {
    record('round-actor', a.code === 0 ? 'ok' : 'fail', a.ms, `round=${r} actor=${i + 1} exit=${a.code}`);
  });
  record('round-group', g.each.every((a) => a.code === 0) ? 'ok' : 'fail', g.ms,
    `round=${r} actors=${actors} serial_ms=${Math.round(s.ms)} ratio=${fmt(ratio, 3)} busy=${fmt(g.busy, 4)} node_procs=${g.procs}`);
  log(`  round ${r}: serial ${fmt(s.ms / 1000)}s, group ${fmt(g.ms / 1000)}s, ratio ${fmt(ratio, 2)}x ` +
      `[actors ${g.each.map((a) => fmt(a.ms / 1000, 1)).join(', ')}s] ` +
      `(machine ${fmt(s.busy * 100, 0)}% -> ${fmt(g.busy * 100, 0)}% busy, ${g.procs} node procs at start)`);
}
log(`  ratio median ${fmt(median(ratios))}x, min ${fmt(Math.min(...ratios))}x, max ${fmt(Math.max(...ratios))}x`);
record('ratio-summary', 'ok', 0, `n=${rounds} median=${fmt(median(ratios), 3)} min=${fmt(Math.min(...ratios), 3)} max=${fmt(Math.max(...ratios), 3)}`);

// ---------------------------------------------------------------- positive control
//
// A method that has never seen the effect cannot report its absence. So: pin every logical
// core with a busy loop, run the same serial trial through the same timing path, and confirm
// it reports a large slowdown against the noise-floor median. If this control comes back
// near 1.0, no null result above means anything.

log(`\npositive control: ${os.cpus().length} CPU-bound spinners, then one serial run ...`);
const spinners = Array.from({ length: os.cpus().length }, () =>
  spawn(process.execPath, ['-e', 'for(;;){Math.sqrt(Math.random());}'], { stdio: 'ignore' }));
await new Promise((r) => setTimeout(r, 1500));
const pinned = await serialTrial(dirs[0]);
for (const s of spinners) s.kill();
const controlRatio = pinned.ms / noiseMed;
log(`  serial under full CPU load: ${fmt(pinned.ms / 1000)}s vs ${fmt(noiseMed / 1000)}s unloaded = ${fmt(controlRatio)}x ` +
    `(machine ${fmt(pinned.busy * 100, 1)}% busy)`);
log(`  control ${controlRatio > 1.5 ? 'DETECTED the effect' : 'FAILED to detect the effect'}`);
record('positive-control', controlRatio > 1.5 ? 'ok' : 'fail', pinned.ms,
  `spinners=${os.cpus().length} unloaded_median_ms=${Math.round(noiseMed)} ratio=${fmt(controlRatio, 3)} busy=${fmt(pinned.busy, 4)}`);

rmSync(workRoot, { recursive: true, force: true });
log('\ndone.');
