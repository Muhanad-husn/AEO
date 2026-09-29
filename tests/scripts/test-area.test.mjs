// Behavioural tests for the area selection that backs `npm run test:area` and
// `npm run test:changed`: changed paths in, areas and test files out.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { AREAS, selectAreas, testFilesFor, globToRegExp } from '../../scripts/test-area.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts;
const listed = [scripts.test, scripts['test:integration']]
  .flatMap((s) => s.split(/\s+/))
  .filter((t) => t.endsWith('.test.mjs'));

describe('the mapping', () => {
  test('every test file in package.json belongs to at least one area', () => {
    const owned = new Set(Object.values(AREAS).flatMap((a) => a.tests));
    const orphans = listed.filter((f) => !owned.has(f));
    assert.deepEqual(orphans, [], `test files in no area: ${orphans.join(', ')}`);
  });

  test('every test file an area names is listed in package.json', () => {
    const known = new Set(listed);
    const stray = Object.entries(AREAS).flatMap(([name, a]) =>
      a.tests.filter((f) => !known.has(f)).map((f) => `${name}: ${f}`));
    assert.deepEqual(stray, []);
  });
});

describe('globs', () => {
  test('* stays inside a directory and ** crosses them', () => {
    assert.ok(globToRegExp('plugin/hooks/*.mjs').test('plugin/hooks/lib.mjs'));
    assert.ok(!globToRegExp('plugin/hooks/*.mjs').test('plugin/hooks/sensorium/10-score.mjs'));
    assert.ok(globToRegExp('plugin/hooks/sensorium/**').test('plugin/hooks/sensorium/10-score.mjs'));
  });
});

describe('selecting areas for changed paths', () => {
  test('a hook change picks its own area and its own test file only', () => {
    const { areas, unmapped } = selectAreas(['plugin/hooks/path-guard.mjs'], { root: repoRoot });
    assert.ok(areas.includes('path-guard'));
    assert.ok(!areas.includes('sandbox-guard'));
    assert.deepEqual(unmapped, []);
    assert.deepEqual(testFilesFor(['path-guard']), ['tests/hooks/path-guard.test.mjs']);
  });

  test('a change to lib.mjs pulls in every area whose source imports it', () => {
    const { areas } = selectAreas(['plugin/hooks/lib.mjs'], { root: repoRoot });
    for (const a of ['lib', 'block-merge', 'path-guard', 'redirect-guard', 'sandbox-guard',
      'session-status', 'gate', 'stack', 'collect-evidence', 'status']) {
      assert.ok(areas.includes(a), `${a} should be picked`);
    }
    assert.ok(!areas.includes('score'));
    assert.ok(!areas.includes('classify-branches'));
  });

  test('a changed test file picks the area that owns it', () => {
    const { areas } = selectAreas(['tests/skills/classify-branches.test.mjs'], { root: repoRoot });
    assert.deepEqual(areas, ['classify-branches']);
  });

  test('a file that matches no area is reported unmapped and picks nothing', () => {
    const { areas, unmapped } = selectAreas(['docs/DECISIONS.md', 'README.md'], { root: repoRoot });
    assert.deepEqual(areas, []);
    assert.deepEqual(unmapped, ['docs/DECISIONS.md', 'README.md']);
  });

  test('a mapped file beside an unmapped one still reports the unmapped one', () => {
    const { areas, unmapped } = selectAreas(['plugin/hooks/block-merge.mjs', 'README.md'], { root: repoRoot });
    assert.ok(areas.includes('block-merge'));
    assert.deepEqual(unmapped, ['README.md']);
  });

  test('imports are followed transitively, not just one hop', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'area-'));
    try {
      mkdirSync(path.join(root, 'src'));
      writeFileSync(path.join(root, 'src/a.mjs'), "import './b.mjs';\n");
      writeFileSync(path.join(root, 'src/b.mjs'), "import('./c.mjs');\n");
      writeFileSync(path.join(root, 'src/c.mjs'), 'export {};\n');
      writeFileSync(path.join(root, 'src/other.mjs'), 'export {};\n');
      const areas = {
        top: { src: ['src/a.mjs'], tests: [] },
        alone: { src: ['src/other.mjs'], tests: [] },
      };
      const picked = selectAreas(['src/c.mjs'], { root, areas });
      assert.deepEqual(picked.areas, ['top']);
      assert.deepEqual(picked.unmapped, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('test files for areas', () => {
  test('several areas give one de-duplicated list', () => {
    const files = testFilesFor(['lib', 'lib', 'path-guard']);
    assert.equal(new Set(files).size, files.length);
    assert.ok(files.includes('tests/hooks/lib.test.mjs'));
    assert.ok(files.includes('tests/hooks/path-guard.test.mjs'));
  });

  test('an unknown area throws and names the valid ones', () => {
    assert.throws(() => testFilesFor(['nope']), /sandbox-guard/);
  });
});
