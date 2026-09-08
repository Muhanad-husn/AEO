// Slice 03: the harness cost line. `measure` reads the fixture tree so the
// test touches no real machine state; `line` formats from a snapshot alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, line } from '../../scripts/score/harness.mjs';

const fixture = fileURLToPath(new URL('../fixtures/score/harness', import.meta.url));
const homeDir = join(fixture, 'home');
const pluginRoot = join(homeDir, 'plugins');
const consumerDir = join(fixture, 'consumer');

test('measure reads the fixture home and plugin roots', () => {
  const snapshot = measure(consumerDir, { homeDir, pluginRoot });
  assert.deepEqual(snapshot.processes, { bash: 3, grep: 1, read: 1, task: 1 });
  assert.equal(snapshot.sessionStartLines, 174);
  assert.deepEqual(snapshot.tests, { testLines: 150, sourceLines: 200 });
});

test('the harness line formats the fixture measurement', () => {
  const harness = measure(consumerDir, { homeDir, pluginRoot });
  assert.equal(
    line({ harness }),
    'harness: bash 3 node, grep 1, read 1, task 1; session start 174 lines; tests 0.75 of source (150 / 200)',
  );
});

test('a consumer with no manifest reports no manifest', () => {
  const harness = measure(homeDir, { homeDir, pluginRoot });
  assert.equal(harness.tests, null);
  assert.equal(
    line({ harness }).split('; ')[2],
    'tests: no manifest',
  );
});

test('a missing harness key falls back to not measured', () => {
  assert.equal(line({}), 'harness: not measured');
});
