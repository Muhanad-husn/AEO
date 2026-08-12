// Tests for the production data refusal in
// plugin/skills/safe-pr/scripts/collect-evidence.mjs (P4.3, EN-16).
//
//   node --test tests/skills/collect-evidence.test.mjs
//
// D20 says skills are prose and prose gets no tests. This is not prose: it is the
// executable that decides what goes into a pull request, and a pull request publishes.
//
// Every case spawns the real script and asserts the exit status, because the status is
// the behaviour: the collector refuses by stopping, and a refusal that still exits 0 is a
// warning wearing a costume (L-05). Every refusal also asserts WHICH path was named, so a
// case cannot pass because something unrelated failed first.
//
// The secret scan is not retested here. It is unchanged, and this check sits beside it.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = path.resolve(import.meta.dirname, '../../plugin/skills/safe-pr/scripts/collect-evidence.mjs');

const LIVE = 'AEO_LIVE_DATA_ROOT';
const DATA = 'AEO_DATA_ROOT';

const FEATURE = 'guarded';
const SLICE = '01-evidence';

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

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

function tempDir(prefix = 'aeo-p43-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * A repository and a production data root that are siblings, so one cannot contain the
 * other by accident and a `..` between them is a real traversal.
 */
function world() {
  const base = tempDir();
  const repo = path.join(base, 'project');
  const live = path.join(base, 'production');
  mkdirSync(repo, { recursive: true });
  mkdirSync(live, { recursive: true });
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'pipe', 'pipe'] });
  writeFileSync(path.join(live, 'customers.txt'), 'name,email\nreal person,real@example.invalid\n');
  return { base, repo, live };
}

/** Where the collector puts the evidence it accepts. */
function evidenceDir(repo) {
  return path.join(repo, 'docs', 'tdd-evidence', FEATURE, SLICE);
}

/** A directory link, or false where the platform will not make one unprivileged. */
function link(target, at) {
  try {
    symlinkSync(target, at, 'junction');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// the runner
// ---------------------------------------------------------------------------

const BASE_ARGS = ['--feature', FEATURE, '--slice', SLICE, '--type', 'cli', '--public'];

/**
 * Run the collector.
 *
 * Both seam variables are stripped from the inherited environment first, so a machine
 * that happens to carry them cannot decide a case. Every case that needs one states it.
 * `--public` is always passed so no case reaches for `gh` and the network.
 */
function collect(argv, { cwd, env = {} } = {}) {
  const childEnv = { ...process.env };
  delete childEnv[LIVE];
  delete childEnv[DATA];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const r = spawnSync(process.execPath, [SCRIPT, ...BASE_ARGS, ...argv], {
    encoding: 'utf8',
    cwd,
    env: childEnv,
    windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const REFUSAL = 'PRODUCTION DATA IN EVIDENCE — REFUSED';

function assertRefused(result, mustName, why) {
  const shown = `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
  assert.equal(result.status, 1, `${why}: expected a refusal (exit 1), got ${result.status}.${shown}`);
  assert.ok(result.stderr.includes(REFUSAL), `${why}: the refusal banner is missing.${shown}`);
  for (const fragment of mustName) {
    assert.ok(result.stderr.includes(fragment), `${why}: the refusal never named ${fragment}.${shown}`);
  }
}

function assertCollected(result, why) {
  const shown = `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
  assert.equal(result.status, 0, `${why}: expected the run to succeed, got ${result.status}.${shown}`);
  assert.ok(!result.stderr.includes(REFUSAL), `${why}: the run refused something.${shown}`);
}

// ---------------------------------------------------------------------------
// inside is refused, outside is collected
// ---------------------------------------------------------------------------

describe('the production data root', () => {
  test('a transcript inside it is refused, and nothing is copied', () => {
    const { repo, live } = world();
    const source = path.join(live, 'customers.txt');
    const result = collect(['--transcript', source, '--copy-only'], { cwd: repo, env: { [LIVE]: live } });
    assertRefused(result, [source, live], 'a transcript read straight out of production data');
    assert.ok(
      !existsSync(path.join(evidenceDir(repo), 'customers.txt')),
      'the refusal came after the copy, so the data is already in the repository',
    );
  });

  test('a transcript outside it is collected', () => {
    const { repo, live } = world();
    const source = path.join(tempDir(), 'test-run.txt');
    writeFileSync(source, 'ok 1 - the suite passed\n');
    const result = collect(['--transcript', source, '--copy-only'], { cwd: repo, env: { [LIVE]: live } });
    assertCollected(result, 'a transcript from outside production data');
    assert.ok(existsSync(path.join(evidenceDir(repo), 'test-run.txt')), 'the transcript was not collected');
  });

  test('an evidence folder inside it is refused', () => {
    const { live } = world();
    const repo = path.join(live, 'project');
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const source = path.join(tempDir(), 'test-run.txt');
    writeFileSync(source, 'ok 1 - the suite passed\n');
    const result = collect(['--transcript', source, '--copy-only'], { cwd: repo, env: { [LIVE]: live } });
    assertRefused(result, ['evidence folder', live], 'a repository sitting inside production data');
  });
});

// ---------------------------------------------------------------------------
// resolution: a name is not a location
// ---------------------------------------------------------------------------
//
// The guarantee is about where a path LANDS. A check that compared the strings it was
// given would be defeated by a link, by `..`, and on Windows by shift-lock.

describe('paths that resolve inside it', () => {
  test('a relative path traversing into it is refused', () => {
    const { repo, live } = world();
    const relative = path.join('..', 'production', 'customers.txt');
    const result = collect(['--transcript', relative, '--copy-only'], { cwd: repo, env: { [LIVE]: live } });
    assertRefused(result, [live], 'a `..` traversal out of the repository and into production data');
  });

  test('a link in a source directory is refused', (t) => {
    const { repo, live } = world();
    const sources = tempDir();
    if (!link(live, path.join(sources, 'transcripts'))) {
      return t.skip('this platform would not create a directory link');
    }
    const result = collect(['--transcript-dir', sources, '--copy-only'], { cwd: repo, env: { [LIVE]: live } });
    assertRefused(result, [live], 'a source directory holding a link into production data');
  });

  test('a link inside the evidence folder is refused', (t) => {
    const { repo, live } = world();
    const dest = evidenceDir(repo);
    mkdirSync(dest, { recursive: true });
    // cpSync copies a link AS a link and walk() reports it as an ordinary file, so this is
    // how production content reaches a pull request body without a byte being copied.
    if (!link(live, path.join(dest, 'attachments'))) {
      return t.skip('this platform would not create a directory link');
    }
    const result = collect(['--body-only'], { cwd: repo, env: { [LIVE]: live } });
    assertRefused(result, [live], 'a link planted in the evidence folder');
  });

  test('a trailing separator on the declared root does not defeat it', () => {
    const { repo, live } = world();
    const source = path.join(live, 'customers.txt');
    const result = collect(['--transcript', source, '--copy-only'], {
      cwd: repo,
      env: { [LIVE]: live + path.sep },
    });
    assertRefused(result, [source], 'a declared root written with a trailing separator');
  });

  test('a case difference in the declared root does not defeat it', (t) => {
    if (process.platform !== 'win32') {
      return t.skip('case-insensitive containment is a Windows rule; elsewhere the paths differ for real');
    }
    const { repo, live } = world();
    const source = path.join(live, 'customers.txt');
    const result = collect(['--transcript', source, '--copy-only'], {
      cwd: repo,
      env: { [LIVE]: live.toUpperCase() },
    });
    assertRefused(result, [source], 'a declared root written in the wrong case');
  });
});

// ---------------------------------------------------------------------------
// the seam itself
// ---------------------------------------------------------------------------

describe('the declaration', () => {
  test('unset is a loud skip: the run proceeds and says the check did not run', () => {
    const { repo } = world();
    const source = path.join(tempDir(), 'test-run.txt');
    writeFileSync(source, 'ok 1 - the suite passed\n');
    const result = collect(['--transcript', source, '--copy-only'], { cwd: repo, env: { [LIVE]: undefined } });

    assertCollected(result, 'a project that declares no production data root');
    assert.ok(
      result.stderr.includes('DID NOT RUN'),
      `the skip was silent, which is the fail-open case this check exists to prevent.\n${result.stderr}`,
    );
    assert.ok(
      result.stdout.includes('production data : NOT CHECKED'),
      `the summary did not report the skip.\n${result.stdout}`,
    );
  });

  test('set but not absolute is refused', () => {
    const { repo } = world();
    const source = path.join(tempDir(), 'test-run.txt');
    writeFileSync(source, 'ok 1 - the suite passed\n');
    const result = collect(['--transcript', source, '--copy-only'], { cwd: repo, env: { [LIVE]: 'production' } });
    assertRefused(result, [LIVE, 'not an absolute path'], 'a declared root that names no location');
  });

  test('there is no override flag', () => {
    const { repo, live } = world();
    const source = path.join(live, 'customers.txt');
    // Every flag the collector accepts that could plausibly read as a bypass, at once.
    const result = collect(['--transcript', source, '--copy-only', '--force', '--include-traces'], {
      cwd: repo,
      env: { [LIVE]: live, [DATA]: tempDir() },
    });
    assertRefused(result, [live], 'production data with every existing flag set');
  });
});
