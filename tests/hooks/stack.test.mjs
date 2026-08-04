// Tests for plugin/hooks/stack.mjs.
//
//   node --test                              # everything, from the repo root
//   node --test "tests/hooks/*.test.mjs"     # this directory only
//
// These are filesystem tests against real directory trees, not mocks. Detection reads
// files, so a mock would only pin the mock.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LOOKED_FOR, projectAt, resolveTestPlan } from '../../plugin/hooks/stack.mjs';

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * A directory tree from a flat map of repo-relative path to file contents.
 * Returns the tree root, which the tests also use as the git toplevel.
 */
function tree(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aeo-p13-stack-'));
  scratch.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

const onWindows = process.platform === 'win32';

// ---------------------------------------------------------------------------
// One row per row of the vendored detection table (V-08)
// ---------------------------------------------------------------------------

describe('the detection table', () => {
  test('node resolves the declared scripts.test through npm', () => {
    const root = tree({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
    assert.deepEqual(projectAt(root).command, ['npm', 'test']);
    assert.equal(projectAt(root).stack, 'node');
  });

  test('python resolves pytest from a pyproject section', () => {
    const root = tree({ 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n' });
    assert.deepEqual(projectAt(root).command, ['pytest']);
    assert.equal(projectAt(root).stack, 'python');
  });

  test('go resolves the toolchain command', () => {
    const root = tree({ 'go.mod': 'module example.com/x\n' });
    assert.deepEqual(projectAt(root).command, ['go', 'test', './...']);
  });

  test('rust resolves the toolchain command', () => {
    const root = tree({ 'Cargo.toml': '[package]\nname = "x"\n' });
    assert.deepEqual(projectAt(root).command, ['cargo', 'test']);
  });

  test('maven resolves the toolchain command', () => {
    const root = tree({ 'pom.xml': '<project/>' });
    assert.deepEqual(projectAt(root).command, ['mvn', '-q', 'test']);
  });

  test('gradle without a wrapper falls to the installed gradle', () => {
    const root = tree({ 'build.gradle': 'plugins { id "java" }\n' });
    assert.deepEqual(projectAt(root).command, ['gradle', 'test']);
  });

  test('gradle prefers the checked-in wrapper', () => {
    const root = tree({ 'build.gradle.kts': '', [onWindows ? 'gradlew.bat' : 'gradlew']: '' });
    assert.deepEqual(projectAt(root).command, [onWindows ? 'gradlew.bat' : './gradlew', 'test']);
  });

  test('ruby resolves rspec when the Gemfile names it', () => {
    const root = tree({ Gemfile: "source 'https://rubygems.org'\ngem 'rspec'\n" });
    assert.deepEqual(projectAt(root).command, ['bundle', 'exec', 'rspec']);
  });

  test('dotnet is matched by project extension, not a fixed filename', () => {
    const root = tree({ 'App.csproj': '<Project/>' });
    assert.deepEqual(projectAt(root).command, ['dotnet', 'test']);
    assert.equal(projectAt(root).stack, 'dotnet');
  });

  test('php resolves composer scripts.test', () => {
    const root = tree({ 'composer.json': JSON.stringify({ scripts: { test: 'phpunit' } }) });
    assert.deepEqual(projectAt(root).command, ['composer', 'test']);
  });

  test('php falls back to a vendored phpunit', () => {
    const root = tree({
      'composer.json': JSON.stringify({ require: {} }),
      [path.join('vendor', 'bin', onWindows ? 'phpunit.bat' : 'phpunit')]: '',
    });
    assert.deepEqual(projectAt(root).command, [path.join('vendor', 'bin', onWindows ? 'phpunit.bat' : 'phpunit')]);
  });

  test('a directory with no manifest is not a project', () => {
    assert.equal(projectAt(tree({ 'README.md': '# x' })), null);
  });
});

// ---------------------------------------------------------------------------
// The lockfile states how the project invokes its tools
// ---------------------------------------------------------------------------

describe('runner resolution from lockfiles', () => {
  const pkg = JSON.stringify({ scripts: { test: 'jest' } });

  test('pnpm', () => {
    const root = tree({ 'package.json': pkg, 'pnpm-lock.yaml': '' });
    assert.deepEqual(projectAt(root).command, ['pnpm', 'test']);
  });

  test('yarn', () => {
    const root = tree({ 'package.json': pkg, 'yarn.lock': '' });
    assert.deepEqual(projectAt(root).command, ['yarn', 'test']);
  });

  test('bun', () => {
    const root = tree({ 'package.json': pkg, 'bun.lock': '' });
    assert.deepEqual(projectAt(root).command, ['bun', 'run', 'test']);
  });

  test('uv', () => {
    const root = tree({ 'pyproject.toml': '[tool.pytest.ini_options]\n', 'uv.lock': '' });
    assert.deepEqual(projectAt(root).command, ['uv', 'run', 'pytest']);
  });

  test('poetry', () => {
    const root = tree({ 'pyproject.toml': 'dependencies = ["pytest"]\n', 'poetry.lock': '' });
    assert.deepEqual(projectAt(root).command, ['poetry', 'run', 'pytest']);
  });
});

// ---------------------------------------------------------------------------
// Detection that cannot resolve says why (D10)
// ---------------------------------------------------------------------------

describe('unresolved projects carry a reason', () => {
  test('package.json with no scripts.test', () => {
    const unit = projectAt(tree({ 'package.json': JSON.stringify({ name: 'x' }) }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /scripts\.test/);
  });

  test('package.json with an empty scripts.test', () => {
    const unit = projectAt(tree({ 'package.json': JSON.stringify({ scripts: { test: '  ' } }) }));
    assert.equal(unit.command, null);
  });

  test('package.json that does not parse', () => {
    const unit = projectAt(tree({ 'package.json': '{ not json' }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /does not parse/);
  });

  test('a python project that names no runner', () => {
    const unit = projectAt(tree({ 'pyproject.toml': '[project]\nname = "x"\n' }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /pytest/);
  });

  test('a Gemfile that names no runner', () => {
    const unit = projectAt(tree({ Gemfile: "gem 'rails'\n" }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /rspec/);
  });

  test('composer.json with neither a script nor a vendored phpunit', () => {
    const unit = projectAt(tree({ 'composer.json': '{}' }));
    assert.equal(unit.command, null);
  });

  test('one resolvable manifest wins over an unresolvable sibling', () => {
    const root = tree({ 'package.json': JSON.stringify({ name: 'x' }), 'go.mod': 'module x\n' });
    assert.deepEqual(projectAt(root).command, ['go', 'test', './...']);
  });

  test('when nothing at the level resolves, every reason is reported', () => {
    const unit = projectAt(tree({ 'package.json': JSON.stringify({ name: 'x' }), Gemfile: "gem 'rails'\n" }));
    assert.equal(unit.command, null);
    assert.match(unit.reason, /scripts\.test/);
    assert.match(unit.reason, /rspec/);
  });
});

// ---------------------------------------------------------------------------
// Resolution is per change, which is what makes polyglot and mono-repos work (D10)
// ---------------------------------------------------------------------------

describe('resolveTestPlan', () => {
  const polyglot = () =>
    tree({
      'package.json': JSON.stringify({ scripts: { test: 'root' } }),
      [path.join('services', 'api', 'package.json')]: JSON.stringify({ scripts: { test: 'vitest run' } }),
      [path.join('libs', 'calc', 'pyproject.toml')]: '[tool.pytest.ini_options]\n',
      [path.join('svc', 'go.mod')]: 'module x\n',
    });

  test('a change resolves the nearest manifest, not the repo root', () => {
    const root = polyglot();
    const plan = resolveTestPlan({ toplevel: root, files: ['services/api/src/a.ts'] });
    assert.equal(plan.units.length, 1);
    assert.equal(plan.units[0].root, path.join(root, 'services', 'api'));
    assert.equal(plan.units[0].stack, 'node');
  });

  test('a change spanning two stacks resolves both', () => {
    const root = polyglot();
    const plan = resolveTestPlan({ toplevel: root, files: ['services/api/src/a.ts', 'libs/calc/calc.py'] });
    assert.deepEqual(plan.units.map((u) => u.stack).sort(), ['node', 'python']);
  });

  test('many files in one project resolve that project once', () => {
    const root = polyglot();
    const plan = resolveTestPlan({ toplevel: root, files: ['svc/a.go', 'svc/b.go', 'svc/internal/c.go'] });
    assert.equal(plan.units.length, 1);
    assert.deepEqual(plan.units[0].command, ['go', 'test', './...']);
  });

  test('a file with no manifest above it lands in missing, not in a guess', () => {
    const root = tree({ 'README.md': '# x' });
    const plan = resolveTestPlan({ toplevel: root, files: ['src/a.js'] });
    assert.equal(plan.units.length, 0);
    assert.equal(plan.missing.length, 1);
  });

  test('an empty file set resolves from the toplevel rather than resolving nothing', () => {
    const root = polyglot();
    const plan = resolveTestPlan({ toplevel: root, files: [] });
    assert.equal(plan.units.length, 1);
    assert.equal(plan.units[0].root, path.resolve(root));
  });

  test('the walk stops at the toplevel and never escapes the repo', () => {
    // The parent of the tree holds a manifest. A change inside the tree must not adopt
    // it, because a directory above the git toplevel is not part of this repository.
    const outer = mkdtempSync(path.join(os.tmpdir(), 'aeo-p13-outer-'));
    scratch.push(outer);
    writeFileSync(path.join(outer, 'go.mod'), 'module outer\n');
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

test('LOOKED_FOR names every manifest the table can match', () => {
  for (const name of ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'Gemfile', 'composer.json']) {
    assert.ok(LOOKED_FOR.includes(name), `${name} is missing from LOOKED_FOR`);
  }
  assert.ok(LOOKED_FOR.some((n) => n.includes('csproj')));
});
