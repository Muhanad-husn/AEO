// Tests for plugin/hooks/stack.mjs.
//
//   node --test                              # everything, from the repo root
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// These are filesystem tests against real directory trees, not mocks. Resolution reads
// files, so a mock would only pin the mock.
//
// The record's name is written out literally in every fixture below rather than taken from
// the module's own export. A founder creates that file by hand, so the name is part of the
// contract; a test that took it from the module would agree with a rename and prove
// nothing.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { projectAt, resolveTestPlan } from '../../plugin/hooks/stack.mjs';

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A directory tree from a flat map of repo-relative path to file contents.
 * Returns the tree root, which the tests also use as the git toplevel.
 */
function tree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aeo-record-'));
  scratch.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/** What a project writes to say how it is tested. */
const record = (command) => JSON.stringify({ test: command });

// ---------------------------------------------------------------------------
// One record, one command
// ---------------------------------------------------------------------------

describe('the recorded command', () => {
  test('a record resolves the command line it names', () => {
    const root = tree({ 'aeo-tests.json': record('npm test') });
    assert.equal(projectAt(root).command, 'npm test');
    assert.equal(projectAt(root).root, root);
  });

  test('the command is a command line, not a program and an argument list', () => {
    // A root that needs two suites says so in one line. This is the whole reason the
    // record holds a string and the gate spawns through a shell.
    const root = tree({ 'aeo-tests.json': record('npm test && uv run pytest -q') });
    assert.equal(projectAt(root).command, 'npm test && uv run pytest -q');
  });

  test('a record is one project, never a list of them', () => {
    const root = tree({ 'aeo-tests.json': record('go test ./...') });
    const unit = projectAt(root);
    assert.equal(Array.isArray(unit), false);
    assert.equal(unit.command, 'go test ./...');
  });

  test('surrounding whitespace is trimmed off the command', () => {
    const root = tree({ 'aeo-tests.json': record('  pytest -q\n') });
    assert.equal(projectAt(root).command, 'pytest -q');
  });

  test('a directory with no record is not a project', () => {
    assert.equal(projectAt(tree({ 'README.md': '# x' })), null);
  });
});

// ---------------------------------------------------------------------------
// The guessing is gone, and does not come back through a side door
// ---------------------------------------------------------------------------

describe('no command is inferred from a manifest (D29)', () => {
  test('a package.json declaring scripts.test is not a project on its own', () => {
    const root = tree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    assert.equal(projectAt(root), null);
  });

  test('a toolchain manifest is not a project on its own', () => {
    for (const manifest of ['go.mod', 'Cargo.toml', 'pom.xml', 'pyproject.toml', 'Gemfile']) {
      assert.equal(projectAt(tree({ [manifest]: 'x\n' })), null, `${manifest} resolved a project`);
    }
  });

  test('a record wins over every manifest beside it, and its command is used verbatim', () => {
    const root = tree({
      'aeo-tests.json': record('make check'),
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
      'go.mod': 'module x\n',
    });
    assert.equal(projectAt(root).command, 'make check');
  });
});

// ---------------------------------------------------------------------------
// A record that cannot be used says why, and never falls through to a guess
// ---------------------------------------------------------------------------

describe('an unusable record carries a reason', () => {
  test('a record that does not parse', () => {
    const unit = projectAt(tree({ 'aeo-tests.json': '{ "test": "npm test"' }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /does not parse/);
  });

  test('a record with no test key', () => {
    const unit = projectAt(tree({ 'aeo-tests.json': JSON.stringify({ dir: 'services/api' }) }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /"test"/);
  });

  test('an empty command', () => {
    const unit = projectAt(tree({ 'aeo-tests.json': record('   ') }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /"test"/);
  });

  test('a command that is not a string', () => {
    const unit = projectAt(tree({ 'aeo-tests.json': JSON.stringify({ test: ['npm', 'test'] }) }));
    assert.equal(unit.command, null);
  });

  test('an unusable record names its own file, so the message can point at it', () => {
    const root = tree({ 'aeo-tests.json': '{ not json' });
    assert.equal(projectAt(root).record, path.join(root, 'aeo-tests.json'));
  });

  test('an unusable record does not fall through to a manifest beside it', () => {
    const root = tree({
      'aeo-tests.json': '{ not json',
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
    });
    assert.equal(projectAt(root).command, null);
  });

  test('an unusable record stops the walk rather than adopting the parent\'s suite', () => {
    const root = tree({
      'aeo-tests.json': record('npm test'),
      [path.join('services', 'api', 'aeo-tests.json')]: '{ not json',
    });
    const plan = resolveTestPlan({ toplevel: root, files: ['services/api/src/a.ts'] });
    assert.equal(plan.units.length, 1);
    assert.equal(plan.units[0].command, null);
    assert.equal(plan.units[0].root, path.join(root, 'services', 'api'));
  });
});

// ---------------------------------------------------------------------------
// Resolution is per project directory, which is what makes a mono-repo work
// ---------------------------------------------------------------------------

describe('resolveTestPlan', () => {
  const monorepo = () =>
    tree({
      'aeo-tests.json': record('npm run test:root'),
      [path.join('services', 'api', 'aeo-tests.json')]: record('npm test'),
      [path.join('libs', 'calc', 'aeo-tests.json')]: record('uv run pytest'),
      [path.join('svc', 'aeo-tests.json')]: record('go test ./...'),
    });

  test('a change resolves the nearest record, not the repo root', () => {
    const root = monorepo();
    const plan = resolveTestPlan({ toplevel: root, files: ['services/api/src/a.ts'] });
    assert.equal(plan.units.length, 1);
    assert.equal(plan.units[0].root, path.join(root, 'services', 'api'));
    assert.equal(plan.units[0].command, 'npm test');
  });

  test('a change spanning two projects resolves both', () => {
    const root = monorepo();
    const plan = resolveTestPlan({ toplevel: root, files: ['services/api/src/a.ts', 'libs/calc/calc.py'] });
    assert.deepEqual(plan.units.map((u) => u.command).sort(), ['npm test', 'uv run pytest']);
  });

  test('many files in one project resolve that project once', () => {
    const root = monorepo();
    const files = Array.from({ length: 20 }, (_, i) => `svc/internal/f${i}.go`);
    const plan = resolveTestPlan({ toplevel: root, files: [...files, 'svc/main.go'] });
    assert.equal(plan.units.length, 1);
    assert.equal(plan.units[0].command, 'go test ./...');
  });

  test('a file with no record above it lands in missing, not in a guess', () => {
    const root = tree({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) });
    const plan = resolveTestPlan({ toplevel: root, files: ['src/a.js'] });
    assert.equal(plan.units.length, 0);
    assert.equal(plan.missing.length, 1);
  });

  test('an empty file set resolves from the toplevel rather than resolving nothing', () => {
    const root = monorepo();
    const plan = resolveTestPlan({ toplevel: root, files: [] });
    assert.equal(plan.units.length, 1);
    assert.equal(plan.units[0].root, path.resolve(root));
    assert.equal(plan.units[0].command, 'npm run test:root');
  });

  test('the walk stops at the toplevel and never escapes the repo', () => {
    // The parent of the tree holds a record. A change inside the tree must not adopt it,
    // because a directory above the git toplevel is not part of this repository.
    const outer = mkdtempSync(path.join(os.tmpdir(), 'aeo-record-outer-'));
    scratch.push(outer);
    writeFileSync(path.join(outer, 'aeo-tests.json'), record('go test ./...'));
    const inner = path.join(outer, 'repo');
    mkdirSync(path.join(inner, 'src'), { recursive: true });
    const plan = resolveTestPlan({ toplevel: inner, files: ['src/a.go'] });
    assert.equal(plan.units.length, 0);
    assert.equal(plan.missing.length, 1);
  });

  test('searched names every directory the walk examined', () => {
    const root = tree({ 'README.md': '# x' });
    const plan = resolveTestPlan({ toplevel: root, files: ['a/b/c.js'] });
    const searched = plan.searched.map((d) => path.resolve(d));
    assert.ok(searched.includes(path.resolve(root, 'a', 'b')));
    assert.ok(searched.includes(path.resolve(root)));
  });
});
