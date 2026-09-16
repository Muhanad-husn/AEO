// Tests for plugin/hooks/sensorium.mjs and its first section,
// plugin/hooks/sensorium/10-score.mjs (#181).
//
// Run from the repo root: node --test tests/hooks/sensorium*.test.mjs (see this
// slice's own package.json glob).
//
// Three layers, cheapest first: renderSensorium itself, against a scratch sensorium/
// directory the test controls (so the throwing-module case never touches this plugin's
// real sections); then the composed score section against the RLM fixtures; then the
// two real callers -- node plugin/hooks/session-status.mjs as a spawned process, and
// renderStatusView(root) in process -- against the same fixtures, matching this
// slice's acceptance criterion (plans/phase-2/01-composer-score.md).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';
import { renderStatusView } from '../../plugin/hooks/status-render.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const sessionStatusScript = path.join(repoRoot, 'plugin', 'hooks', 'session-status.mjs');
const fixturesDir = path.join(repoRoot, 'tests', 'fixtures', 'sensorium');

const EXPECTED_SCORE = 'score: 7 Compare done, sample 4 recall 86.4 (8 of 8 phases done)';
const EXPECTED_BAR = 'bar: Phase 5 under 70 on sample 1 after $25 spent means the method is wrong.';
// Slice 05 (#185) added plugin/hooks/sensorium/50-harness.mjs, a third real section
// that reads AEO_HOME_DIR when set. This file points it at an empty, controlled
// directory (below) so every render here reports this fixed, machine-independent
// line instead of whichever developer's or CI runner's real ~/.claude.
const EXPECTED_HARNESS = 'harness: bash 0 node, grep 0, read 0, task 0; session start 0 lines';

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-sensorium-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// An empty home directory for 50-harness.mjs: no settings.json, no CLAUDE.md, no
// plugins/, so measureCost reports all zeroes regardless of machine. Set for this
// whole file's process (node --test gives each test file its own process) so the
// spawned session-status.mjs subprocess (which inherits process.env) sees it too.
const controlledHomeDir = tempDir('aeo-sensorium-harness-home-');
process.env.AEO_HOME_DIR = controlledHomeDir;

function gitRun(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A throwaway repo with one real commit, so branch and HEAD resolve. */
function makeRepo() {
  const dir = tempDir();
  gitRun(dir, 'init', '-q', '-b', 'main');
  gitRun(dir, 'config', 'user.name', 'aeo-test');
  gitRun(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  gitRun(dir, 'commit', '-q', '--allow-empty', '-m', 'init commit');
  return dir;
}

/** A repo holding RLM's own status table and Kill line gate, copied from fixture. */
function makeRlmRepo() {
  const dir = makeRepo();
  copyFileSync(path.join(fixturesDir, 'rlm-plan.md'), path.join(dir, 'PLAN.md'));
  copyFileSync(path.join(fixturesDir, 'rlm-rules.md'), path.join(dir, 'RULES.md'));
  return dir;
}

/** A scratch plugin root with hooks.json and a stub for every script it names. */
function makePassingPluginRoot() {
  const realPluginRoot = path.join(repoRoot, 'plugin');
  const raw = readFileSync(path.join(realPluginRoot, 'hooks', 'hooks.json'), 'utf8');
  const root = tempDir('aeo-sensorium-plugin-');
  const hooksDir = path.join(root, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  writeFileSync(path.join(hooksDir, 'hooks.json'), raw);
  for (const m of raw.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}([^\s"']*\.mjs)/g)) {
    const abs = path.join(root, m[1].replace(/^[/\\]/, ''));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '// stub\n');
  }
  return root;
}

/** Env with the gh seams and data-root vars cleared, so the hook's answer is ours alone. */
function buildEnv(overrides = {}) {
  const env = { ...process.env };
  env.CLAUDE_PROJECT_DIR = ''; // outranks cwd in resolveOperationDir; see session-status.test.mjs
  for (const key of [
    'CLAUDE_PLUGIN_ROOT',
    'AEO_GH_COMMAND',
    'AEO_GH_PREFIX_ARGS',
    'AEO_GH_TIMEOUT_MS',
    'AEO_LIVE_DATA_ROOT',
    'AEO_DATA_ROOT',
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

function runSessionStatus(cwd, envOverrides = {}) {
  const r = spawnSync(process.execPath, [sessionStatusScript], {
    input: '',
    encoding: 'utf8',
    cwd,
    env: buildEnv({ AEO_GH_COMMAND: 'aeo-gh-that-does-not-exist', CLAUDE_PLUGIN_ROOT: makePassingPluginRoot(), ...envOverrides }),
  });
  if (r.stdout === '') {
    throw new Error(`session-status.mjs produced no stdout (exited ${r.status}). stderr: ${r.stderr ?? ''}`);
  }
  return r.stdout;
}

// ---------------------------------------------------------------------------
// renderSensorium: directory discovery, and a throwing section never sinks the rest
// ---------------------------------------------------------------------------

describe('renderSensorium', () => {
  test('renders sections in filename order', async () => {
    const dir = tempDir('aeo-sensorium-modules-');
    writeFileSync(path.join(dir, '20-second.mjs'), "export const name='20-second'; export function render(){return ['second: two'];}\n");
    writeFileSync(path.join(dir, '10-first.mjs'), "export const name='10-first'; export function render(){return ['first: one'];}\n");
    const lines = await renderSensorium('/does-not-matter', { dir });
    assert.deepEqual(lines, ['first: one', 'second: two']);
  });

  test('a module whose render throws renders as unknown, by name, and every other section still prints', async () => {
    const dir = tempDir('aeo-sensorium-throws-');
    writeFileSync(path.join(dir, '05-ok.mjs'), "export const name='05-ok'; export function render(){return ['ok: before'];}\n");
    writeFileSync(path.join(dir, '10-throws.mjs'), "export const name='10-throws'; export function render(){throw new Error('boom');}\n");
    writeFileSync(path.join(dir, '20-ok.mjs'), "export const name='20-ok'; export function render(){return ['ok: after'];}\n");
    const lines = await renderSensorium('/does-not-matter', { dir });
    assert.deepEqual(lines, ['ok: before', '10-throws: unknown (boom)', 'ok: after']);
  });

  test('an async render is awaited', async () => {
    const dir = tempDir('aeo-sensorium-async-');
    writeFileSync(
      path.join(dir, '10-async.mjs'),
      "export const name='10-async'; export async function render(){ return ['async: line']; }\n",
    );
    const lines = await renderSensorium('/does-not-matter', { dir });
    assert.deepEqual(lines, ['async: line']);
  });

  test('a rejected async render renders as unknown too', async () => {
    const dir = tempDir('aeo-sensorium-reject-');
    writeFileSync(
      path.join(dir, '10-rejects.mjs'),
      "export const name='10-rejects'; export async function render(){ throw new Error('async boom'); }\n",
    );
    const lines = await renderSensorium('/does-not-matter', { dir });
    assert.deepEqual(lines, ['10-rejects: unknown (async boom)']);
  });

  test('an empty directory renders nothing', async () => {
    const dir = tempDir('aeo-sensorium-empty-');
    const lines = await renderSensorium('/does-not-matter', { dir });
    assert.deepEqual(lines, []);
  });
});

// ---------------------------------------------------------------------------
// 10-score.mjs, against the real RLM fixtures (plans/phase-2/01-composer-score.md's
// acceptance criterion)
// ---------------------------------------------------------------------------

describe('the score section, against RLM\'s own status table and Kill line', () => {
  // Both repos here carry no COMMITMENTS.md, so the commitment section (#184, added
  // after this slice) always declares none; its two lines are asserted against
  // directly in tests/hooks/sensorium-commitment.test.mjs. This checks the score
  // section's own two lines still come first, not that they are the whole block --
  // directory discovery means later slices append sections here without this file
  // needing to enumerate them.
  test('renderSensorium prints the score and its bar first', async () => {
    const dir = makeRlmRepo();
    const lines = await renderSensorium(dir);
    assert.deepEqual(lines.slice(0, 2), [EXPECTED_SCORE, EXPECTED_BAR]);
  });

  test('a repository with no PLAN.md prints "none declared" for both, first', async () => {
    const dir = makeRepo(); // no PLAN.md, no RULES.md
    const lines = await renderSensorium(dir);
    assert.deepEqual(lines.slice(0, 2), ['score: none declared', 'bar: none declared']);
  });
});

// ---------------------------------------------------------------------------
// The two real callers
// ---------------------------------------------------------------------------

describe('session-status.mjs prints the sensorium after gate health and before the data root', () => {
  test('the score and bar lines follow the gate section, RLM fixture repo', () => {
    const dir = makeRlmRepo();
    const stdout = runSessionStatus(dir);
    // D8 still reads first (a broken runtime outranks the consumer's own number): the
    // gate-health text this hook already printed before this slice comes first.
    const gateIndex = stdout.indexOf('not one where none was wired.');
    assert.notEqual(gateIndex, -1, 'the pre-existing gate section is still printed');
    const scoreIndex = stdout.indexOf(EXPECTED_SCORE);
    const barIndex = stdout.indexOf(EXPECTED_BAR);
    const harnessIndex = stdout.indexOf(EXPECTED_HARNESS);
    const dataRootIndex = stdout.indexOf('Production data root:');
    assert.ok(scoreIndex > gateIndex, 'the score line follows the gate section');
    assert.ok(barIndex > scoreIndex, 'the bar line follows the score line');
    assert.ok(harnessIndex > barIndex, 'the harness line follows the bar line');
    assert.ok(dataRootIndex > harnessIndex, 'the data root section follows the sensorium block');
    // The sensorium block is its own three lines, score then bar then harness,
    // immediately after the gate section's last line -- no caller-added header in
    // between.
    const between = stdout.slice(gateIndex, dataRootIndex);
    assert.ok(
      between.includes(`\n\n${EXPECTED_SCORE}\n${EXPECTED_BAR}\ndollars: none declared\nruns: none live\nlast run: none\ncommitment: none declared\nexecuted: none declared\n${EXPECTED_HARNESS}\n`),
      'score then bar then harness, as their own three lines, right after the gate section',
    );
  });

  test('a repository with no PLAN.md prints "none declared" for both, still after gate health', () => {
    const dir = makeRepo();
    const stdout = runSessionStatus(dir);
    assert.match(
      stdout,
      new RegExp(
        `not one where none was wired\\.\\n\\nscore: none declared\\nbar: none declared\\ndollars: none declared\\nruns: none live\\nlast run: none\\ncommitment: none declared\\nexecuted: none declared\\n${EXPECTED_HARNESS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`,
      ),
    );
  });

  test('the rest of the output is unchanged: branch and HEAD still print', () => {
    const dir = makeRlmRepo();
    const stdout = runSessionStatus(dir);
    assert.match(stdout, /\*\*Branch:\*\* main {2}\| {2}\*\*HEAD:\*\* \w+ init commit/);
  });
});

describe('renderStatusView(root) prints the sensorium first', () => {
  test('the output begins with the score and its bar, RLM fixture repo', async () => {
    const dir = makeRlmRepo();
    const out = await renderStatusView(dir);
    assert.equal(out.startsWith(`${EXPECTED_SCORE}\n${EXPECTED_BAR}\n`), true);
  });

  test('a repository with no PLAN.md begins with "none declared" for both', async () => {
    const dir = makeRepo();
    const out = await renderStatusView(dir);
    assert.equal(out.startsWith('score: none declared\nbar: none declared\n'), true);
  });

  test('the rest of the view is unchanged: the project status header still follows', async () => {
    const dir = makeRlmRepo();
    const out = await renderStatusView(dir);
    assert.match(out, /## Project status \(generated just now/);
  });
});
