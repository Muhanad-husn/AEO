// Slice 05 (#185): the harness's own cost this session, as the sensorium's fifth
// section, plugin/hooks/sensorium/50-harness.mjs.
//
// The fixture home directory is the one tests/scripts/score-harness.test.mjs already
// builds against (tests/fixtures/score/harness/home), so this file measures against
// the same stand-in rather than inventing a second one. `measure` and `line` still
// come from scripts/score/harness.mjs -- this slice moves their implementation to
// plugin/hooks/harness-cost.mjs but keeps that module's exports the same, so a test
// written against the old location keeps working.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';
import { measure } from '../../scripts/score/harness.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fixtureHome = path.join(repoRoot, 'tests', 'fixtures', 'score', 'harness', 'home');

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempRepoWithClaudeMd(lineCount) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-sensorium-harness-'));
  scratch.push(dir);
  const text = Array.from({ length: lineCount }, (_, i) => `claude line ${i + 1}`).join('\n') + '\n';
  writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

let savedHomeDir;
before(() => {
  savedHomeDir = process.env.AEO_HOME_DIR;
});
after(() => {
  if (savedHomeDir === undefined) delete process.env.AEO_HOME_DIR;
  else process.env.AEO_HOME_DIR = savedHomeDir;
});

function harnessLineOf(lines) {
  return lines.find((l) => l.startsWith('harness:'));
}

// ---------------------------------------------------------------------------
// the section itself, via the composer (plans/phase-2/05-harness-cost.md)
// ---------------------------------------------------------------------------

describe('50-harness.mjs, the harness cost section', () => {
  test('its five numbers equal measure(root, { homeDir }) from scripts/score/harness.mjs, and the line holds no tests part', async () => {
    const root = tempRepoWithClaudeMd(12);
    process.env.AEO_HOME_DIR = fixtureHome;
    const expected = measure(root, { homeDir: fixtureHome });
    const lines = await renderSensorium(root);
    const harnessLine = harnessLineOf(lines);
    assert.ok(harnessLine, 'renderSensorium printed a harness: line');
    assert.equal(
      harnessLine,
      `harness: bash ${expected.processes.bash} node, grep ${expected.processes.grep}, ` +
        `read ${expected.processes.read}, task ${expected.processes.task}; ` +
        `session start ${expected.sessionStartLines} lines`,
    );
    assert.doesNotMatch(harnessLine, /tests/, 'the harness line prints no tests-over-source part');
  });

  test('AEO_HOME_DIR overrides the default home directory', async () => {
    const root = tempRepoWithClaudeMd(12);

    process.env.AEO_HOME_DIR = fixtureHome;
    const withFixtureHome = harnessLineOf(await renderSensorium(root));

    const emptyHome = mkdtempSync(path.join(os.tmpdir(), 'aeo-sensorium-emptyhome-'));
    scratch.push(emptyHome);
    process.env.AEO_HOME_DIR = emptyHome;
    const withEmptyHome = harnessLineOf(await renderSensorium(root));

    assert.notEqual(withFixtureHome, withEmptyHome, 'a different AEO_HOME_DIR changes the measured line');
    assert.equal(withEmptyHome, 'harness: bash 0 node, grep 0, read 0, task 0; session start 12 lines');
  });
});

// ---------------------------------------------------------------------------
// the move leaves scripts/score.mjs's own harness line unchanged
// ---------------------------------------------------------------------------

describe('scripts/score.mjs harness line, unchanged by the move', () => {
  // Baseline recorded before this slice moved measure/its helpers to
  // plugin/hooks/harness-cost.mjs:
  //   node scripts/score.mjs --phases 0-5 --from tests/fixtures/score/rlm-phases-0-5.json
  const BASELINE_HARNESS_LINE =
    'harness: bash 1 node, grep 0, read 0, task 0; session start 839 lines; tests 0.77 of source (9534 / 12348)';

  test('the replayed RLM snapshot prints the same harness line it printed before this slice', () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'scripts', 'score.mjs'),
        '--phases',
        '0-5',
        '--from',
        path.join(repoRoot, 'tests', 'fixtures', 'score', 'rlm-phases-0-5.json'),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const lastLine = result.stdout.trim().split('\n').pop();
    assert.equal(lastLine, BASELINE_HARNESS_LINE);
  });
});
