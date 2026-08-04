// Tests for plugin/hooks/session-status.mjs (P1.7).
//
// Run from the repo root: node --test  (or node --test "tests/hooks/*.test.mjs";
// see lib.test.mjs's header for why not `node --test tests/hooks/`).
//
// The hook's one stated must-not is "block anything" (PLAN.md), so every scenario
// below asserts the real exit code out of a spawned process -- "never blocks" is an
// exit-code claim, and runReporter's in-library guarantee is not a substitute for
// testing this hook's own script, which has its own top-level await and its own gh
// subprocess calls outside anything runReporter wraps.
//
// gh is faked through session-status.mjs's AEO_GH_COMMAND / AEO_GH_PREFIX_ARGS seam
// (see that file's comment on it) rather than by relying on a real `gh` install --
// tests must not depend on this machine's GitHub auth state, and must not be slow or
// flaky because the real CLI hung or rate-limited.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const scriptPath = path.join(repoRoot, 'plugin', 'hooks', 'session-status.mjs');
const realPluginRoot = path.join(repoRoot, 'plugin');
const fakeGhScript = path.join(import.meta.dirname, 'fixtures', 'fake-gh.mjs');

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-p17-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function gitRun(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A throwaway repo with one real commit, so branch and HEAD resolve. */
function makeRepo() {
  const dir = tempDir();
  gitRun(dir, 'init', '-q', '-b', 'feat/example');
  gitRun(dir, 'config', 'user.name', 'aeo-test');
  gitRun(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  gitRun(dir, 'commit', '-q', '--allow-empty', '-m', 'init commit');
  return dir;
}

/**
 * A scratch plugin root with hooks.json plus a stub for every script it references, so
 * preflight() reports ok regardless of whether sibling Phase 1 slices (P1.2/P1.3/P1.6)
 * have merged into this worktree yet -- their gate scripts do not exist here, and
 * simulating a fully-wired install is how the banner-absent path is tested without
 * waiting on that merge.
 */
function makePassingPluginRoot() {
  const root = tempDir('aeo-p17-plugin-');
  const hooksDir = path.join(root, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const raw = readFileSync(path.join(realPluginRoot, 'hooks', 'hooks.json'), 'utf8');
  writeFileSync(path.join(hooksDir, 'hooks.json'), raw);
  for (const m of raw.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g)) {
    const abs = path.join(root, m[1].replace(/^[/\\]/, ''));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '// stub\n');
  }
  return root;
}

/** Env with CLAUDE_PLUGIN_ROOT and every gh-related seam removed, then overrides applied. */
function buildEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ['CLAUDE_PLUGIN_ROOT', 'AEO_GH_COMMAND', 'AEO_GH_PREFIX_ARGS', 'AEO_FAKE_GH_MODE', 'AEO_GH_TIMEOUT_MS']) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

// The second latent flake in this battery, and the same class as the run-log one: an
// assertion that can be decided by how busy the machine is rather than by the code.
//
// Every case below except the two that test the timeout wants gh to ANSWER, and then
// asserts the answer did not read as `unknown`. The hook's own default budget is 3s,
// which is generous for a fake gh and is not generous for a fake gh that has to start
// a second node process on a machine already running the rest of the suite in
// parallel. A slow start would render `unknown`, the assertion would fail, and the
// failure would say nothing about the hook. So the default here is far above anything
// a spawn can plausibly take. The tests that are ABOUT the timeout pass their own
// small value and are unaffected.
const GH_ANSWER_TIMEOUT_MS = 60_000;

/** Env wired to the fake gh (fixtures/fake-gh.mjs), plus the given overrides. */
function fakeGhEnv({ mode = 'empty', timeoutMs = GH_ANSWER_TIMEOUT_MS, pluginRoot, ...rest } = {}) {
  return buildEnv({
    AEO_GH_COMMAND: process.execPath,
    AEO_GH_PREFIX_ARGS: JSON.stringify([fakeGhScript]),
    AEO_FAKE_GH_MODE: mode,
    AEO_GH_TIMEOUT_MS: timeoutMs !== undefined ? String(timeoutMs) : undefined,
    CLAUDE_PLUGIN_ROOT: pluginRoot,
    ...rest,
  });
}

function runHook({ cwd, payload, raw, env } = {}) {
  const input = raw !== undefined ? raw : payload === undefined ? '' : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [scriptPath], {
    input,
    encoding: 'utf8',
    cwd,
    env: env ?? buildEnv(),
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// Never blocks (the hook's one stated must-not)
// ---------------------------------------------------------------------------

describe('never blocks', () => {
  test('exits 0 in a real repo with gh answering normally', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 on malformed JSON stdin', () => {
    const repo = makeRepo();
    const r = runHook({ cwd: repo, raw: '{not valid json', env: fakeGhEnv({ pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 on empty stdin', () => {
    const repo = makeRepo();
    const r = runHook({ cwd: repo, raw: '', env: fakeGhEnv({ pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 when the cwd is not a git worktree at all', () => {
    const notARepo = tempDir('aeo-p17-not-a-repo-');
    const r = runHook({ payload: { cwd: notARepo }, env: fakeGhEnv({ pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', 'nothing to report outside a git worktree');
  });

  test('exits 0 when gh is not installed', () => {
    const repo = makeRepo();
    const env = buildEnv({ AEO_GH_COMMAND: 'aeo-gh-that-does-not-exist', CLAUDE_PLUGIN_ROOT: makePassingPluginRoot() });
    const r = runHook({ payload: { cwd: repo }, env });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh exits non-zero (e.g. not authenticated)', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'error', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh hangs past its timeout', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'hang', timeoutMs: 200, pluginRoot: makePassingPluginRoot() }),
    });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh emits unparseable output', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'garbage', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });

  test('exits 0 when gh floods stdout past the output cap', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'huge', pluginRoot: makePassingPluginRoot() }) });
    assert.equal(r.status, 0);
  });
});

// ---------------------------------------------------------------------------
// Unknown is never reported as a confident zero
// ---------------------------------------------------------------------------

describe('unknown versus zero', () => {
  test('an empty gh answer reads as none, not unknown', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* none\./);
    assert.match(r.stdout, /\*\*Open PRs -- awaiting founder approval:\*\* none\./);
    assert.doesNotMatch(r.stdout, /unknown/);
  });

  test('a populated gh answer lists items, not unknown', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'items', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues \(1\):\*\*/);
    assert.match(r.stdout, /#1 fixture issue {2}\[bug\]/);
    assert.match(r.stdout, /\*\*Open PRs -- awaiting founder approval \(1\):\*\*/);
    assert.match(r.stdout, /#2 fixture open pr \(draft\)/);
    assert.match(r.stdout, /\*\*Last 1 merged PRs \(already shipped\):\*\*/);
    assert.match(r.stdout, /#3 fixture merged pr {2}_\(2026-08-01\)_/);
    assert.doesNotMatch(r.stdout, /unknown/);
  });

  test('a missing gh reads as unknown, never as none', () => {
    const repo = makeRepo();
    const env = buildEnv({ AEO_GH_COMMAND: 'aeo-gh-that-does-not-exist', CLAUDE_PLUGIN_ROOT: makePassingPluginRoot() });
    const r = runHook({ payload: { cwd: repo }, env });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(gh is not installed/);
    assert.doesNotMatch(r.stdout, /Open issues:\*\* none/);
  });

  test('a gh error reads as unknown, never as none', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'error', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(/);
    assert.doesNotMatch(r.stdout, /Open issues:\*\* none/);
  });

  test('a gh timeout reads as unknown, never as none', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'hang', timeoutMs: 200, pluginRoot: makePassingPluginRoot() }),
    });
    assert.match(r.stdout, /unknown \(gh did not answer within 200ms\)/);
    assert.doesNotMatch(r.stdout, /Open issues:\*\* none/);
  });

  test('unparseable gh output reads as unknown, never as none', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'garbage', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(gh returned unparseable output/);
  });

  test('oversized gh output is capped, not parsed, and still reads as unknown', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'huge', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Open issues:\*\* unknown \(/);
    assert.ok(r.stdout.length < 10_000, `stdout should stay small even when gh floods; was ${r.stdout.length} bytes`);
  });
});

// ---------------------------------------------------------------------------
// Ground-truth labelling (L-08)
// ---------------------------------------------------------------------------

describe('ground-truth framing', () => {
  test('states memory files and plan checkboxes are not ground truth', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /Ground truth, read from git and GitHub just now/);
    assert.match(r.stdout, /Memory files and plan/);
    assert.match(r.stdout, /checkboxes are neither/);
  });

  test('reports the branch and HEAD', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Branch:\*\* feat\/example {2}\| {2}\*\*HEAD:\*\* \w+ init commit/);
  });
});

// ---------------------------------------------------------------------------
// The runtime banner (D8) -- rendered by this hook when preflight() fails
// ---------------------------------------------------------------------------

describe('gate-health banner', () => {
  test('renders when preflight fails (CLAUDE_PLUGIN_ROOT unset)', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: undefined }) });
    assert.match(r.stdout, /AEO GATES ARE NOT ENFORCING/);
  });

  test('renders when preflight fails (CLAUDE_PLUGIN_ROOT points nowhere)', () => {
    const repo = makeRepo();
    const r = runHook({
      payload: { cwd: repo },
      env: fakeGhEnv({ mode: 'empty', pluginRoot: path.join(repo, 'does-not-exist') }),
    });
    assert.match(r.stdout, /AEO GATES ARE NOT ENFORCING/);
  });

  test('stays absent when preflight passes', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.doesNotMatch(r.stdout, /AEO GATES ARE NOT ENFORCING/);
  });
});

// ---------------------------------------------------------------------------
// Newest run log
// ---------------------------------------------------------------------------

// Selection is asserted with mtime pinned by hand in every case below, never left to
// whatever the clock did during the test.
//
// The original of the first test wrote two summaries back to back and let their write
// order decide. Two files created in the same millisecond tie on mtime, the hook's
// comparison was `>` against a running best, and the tie then resolved by readdir
// order, which returns `2026-08-01-older-job` first. That is a one-in-three test flake
// and the same bug in the shipped hook: the status reporter would name a stale log as
// the newest, which is precisely what L-08 built it to stop. Nothing here can now pass
// by luck: the timestamps are set, and two of the five cases make mtime point the
// wrong way on purpose.

/** A `logs/<name>/summary.md` whose mtime is pinned to `mtime`. */
function writeRunLog(repo, name, body, mtime) {
  const dir = path.join(repo, 'logs', name);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'summary.md');
  writeFileSync(file, body);
  utimesSync(file, mtime, mtime);
  return file;
}

const EIGHT_PLUS_LINES = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');

describe('newest run log', () => {
  test('picks the newest date when mtimes are identical, capped at 8 lines', () => {
    const repo = makeRepo();
    const sameInstant = new Date('2026-08-03T12:00:00Z');
    writeRunLog(repo, '2026-08-01-older-job', '# stale entry\n\nshould not appear\n', sameInstant);
    writeRunLog(repo, '2026-08-02-newer-job', `# newer job\n\n${EIGHT_PLUS_LINES}\n`, sameInstant);

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-02-newer-job\/summary\.md`/);
    assert.doesNotMatch(r.stdout, /stale entry/);
    const quotedLines = r.stdout.split('\n').filter((l) => l.startsWith('> '));
    assert.equal(quotedLines.length, 8);
  });

  test('the date in the name beats mtime, so a re-touched old log is not the current one', () => {
    // mtime says the older job is newest. The name says otherwise, and the name is
    // what a reader means by "newest run log". This case is deterministic and the old
    // mtime-only selection fails it every time.
    const repo = makeRepo();
    writeRunLog(repo, '2026-08-01-older-job', '# stale entry\n\nshould not appear\n', new Date('2026-08-04T12:00:00Z'));
    writeRunLog(repo, '2026-08-02-newer-job', '# newer job\n', new Date('2026-08-02T12:00:00Z'));

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-02-newer-job\/summary\.md`/);
    assert.doesNotMatch(r.stdout, /stale entry/);
  });

  test('a dated log outranks an undated directory whatever its mtime', () => {
    const repo = makeRepo();
    writeRunLog(repo, 'scratch', '# undated\n\nshould not appear\n', new Date('2026-08-09T12:00:00Z'));
    writeRunLog(repo, '2026-08-02-newer-job', '# newer job\n', new Date('2026-08-02T12:00:00Z'));

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-02-newer-job\/summary\.md`/);
    assert.doesNotMatch(r.stdout, /undated/);
  });

  test('mtime still decides between two undated directories', () => {
    const repo = makeRepo();
    writeRunLog(repo, 'alpha-job', '# alpha\n', new Date('2026-08-01T12:00:00Z'));
    writeRunLog(repo, 'beta-job', '# beta wrote last\n', new Date('2026-08-05T12:00:00Z'));

    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.match(r.stdout, /\*\*Newest run log:\*\* `logs\/beta-job\/summary\.md`/);
  });

  test('two logs on the same date with identical mtimes still resolve to one answer', () => {
    // The last tiebreak. Directory names are unique, so this always decides, and the
    // point is only that it decides the same way every run rather than by readdir
    // order. Run twice in one test because a single run cannot show stability.
    const repo = makeRepo();
    const sameInstant = new Date('2026-08-03T12:00:00Z');
    writeRunLog(repo, '2026-08-03-aaa-job', '# aaa\n', sameInstant);
    writeRunLog(repo, '2026-08-03-zzz-job', '# zzz\n', sameInstant);

    const env = fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() });
    const first = runHook({ payload: { cwd: repo }, env });
    const second = runHook({ payload: { cwd: repo }, env });
    assert.match(first.stdout, /\*\*Newest run log:\*\* `logs\/2026-08-03-zzz-job\/summary\.md`/);
    assert.equal(
      /\*\*Newest run log:\*\* `([^`]+)`/.exec(first.stdout)?.[1],
      /\*\*Newest run log:\*\* `([^`]+)`/.exec(second.stdout)?.[1],
    );
  });

  test('says nothing about run logs when logs/ does not exist', () => {
    const repo = makeRepo();
    const r = runHook({ payload: { cwd: repo }, env: fakeGhEnv({ mode: 'empty', pluginRoot: makePassingPluginRoot() }) });
    assert.doesNotMatch(r.stdout, /Newest run log/);
  });
});
