// AEO stack detection: which test command a change must run, resolved per change.
//
// Why this exists (V-05, D10). The vendored harness calls itself "profile-driven" and
// "stack-agnostic" and then hard-codes `uv run pytest` and `ruff` in the commit gate.
// There is no second implementation and no detection anywhere. This module is that
// detection, and the rule it follows comes from the vendored table it was mined from
// (`red-green-refactor/references/test-strategy.md`, V-08):
//
//   "prefer the script the project already defines over inventing a command -- it
//   encodes the project's intended invocation."
//
// Two kinds of declaration count, and nothing else does.
//
//   1. The project names its own command. `scripts.test` in package.json,
//      `scripts.test` in composer.json, a pytest section or a pytest dependency.
//   2. The toolchain defines the command and there is nothing for the project to
//      name. `go test ./...`, `cargo test`, `dotnet test`, `mvn test`. Reading the
//      manifest that pins the toolchain IS reading the declaration.
//
// When neither holds, this module resolves nothing and says what it looked for. It
// never falls back to a guess. D10 is explicit about that, and L-08 is why: a gate
// that runs nothing and reports OK is worse than no gate.
//
// There is no config file, by decision (D10). Resolution is per change rather than per
// repo, which is what makes a polyglot repo and a mono-repo work with no configuration:
// a change under `services/api` resolves `services/api`'s manifest, not the repo root's.
//
// Why a separate module rather than lib.mjs: P1.4 and P1.5 both consume this, so it is
// shared code rather than gate-local code, and widening lib.mjs would edit a file two
// other in-flight slices import.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { isPathInside } from './lib.mjs';

/**
 * Every manifest name this module knows, in the order a directory is examined.
 * Exported so a gate's "here is what I looked for" message and this table cannot
 * drift apart.
 */
export const LOOKED_FOR = [
  'package.json',
  'pyproject.toml',
  'pytest.ini',
  'setup.cfg',
  'tox.ini',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  '*.sln / *.csproj / *.fsproj / *.vbproj',
];

const PYTHON_CONFIGS = ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini'];
const DOTNET_PROJECT = /\.(sln|csproj|fsproj|vbproj)$/i;

const isWindows = () => process.platform === 'win32';

function readIfPresent(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readJson(file) {
  const text = readIfPresent(file);
  if (text === null) return { error: 'is unreadable' };
  try {
    return { value: JSON.parse(text) };
  } catch (err) {
    return { error: `does not parse (${err.message})` };
  }
}

// ---------------------------------------------------------------------------
// Per-stack resolution
// ---------------------------------------------------------------------------

// The lockfile is the project's own statement of which package manager runs its
// scripts. `npm test` in a bun or pnpm workspace is a different command with a
// different result, so this is reading a declaration rather than choosing a default.
function nodeRunner(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return ['pnpm'];
  if (existsSync(path.join(dir, 'yarn.lock'))) return ['yarn'];
  if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return ['bun', 'run'];
  return ['npm'];
}

function nodeCommand(dir, file) {
  const { value, error } = readJson(file);
  if (error) return { reason: `package.json ${error}` };
  const script = value?.scripts?.test;
  if (typeof script !== 'string' || script.trim() === '') {
    return { reason: 'package.json declares no "scripts.test"' };
  }
  return { command: [...nodeRunner(dir), 'test'] };
}

// Python has no manifest field that names a test command, so the declaration is the
// presence of pytest in the project's own configuration. One token, checked across all
// four config files, covers both a `[tool.pytest.ini_options]` section and a pytest
// dependency without this module carrying a TOML parser.
function pythonCommand(dir) {
  const present = PYTHON_CONFIGS.filter((name) => existsSync(path.join(dir, name)));
  const declares = present.some((name) => (readIfPresent(path.join(dir, name)) ?? '').includes('pytest'));
  if (!declares) {
    return { reason: `${present.join(', ')} names no test runner (looked for pytest)` };
  }
  // Same reading as nodeRunner: the lockfile states how the project invokes its tools.
  if (existsSync(path.join(dir, 'uv.lock'))) return { command: ['uv', 'run', 'pytest'] };
  if (existsSync(path.join(dir, 'poetry.lock'))) return { command: ['poetry', 'run', 'pytest'] };
  return { command: ['pytest'] };
}

// Relative, never absolute: the child runs with cwd set to the project root, and on
// Windows the suite is spawned through cmd.exe, which mishandles an absolute program
// path containing spaces.
function gradleCommand(dir) {
  const wrapper = isWindows() ? 'gradlew.bat' : 'gradlew';
  if (existsSync(path.join(dir, wrapper))) return { command: [isWindows() ? wrapper : './gradlew', 'test'] };
  return { command: ['gradle', 'test'] };
}

function rubyCommand(dir, file) {
  if ((readIfPresent(file) ?? '').includes('rspec')) return { command: ['bundle', 'exec', 'rspec'] };
  return { reason: 'Gemfile names no test runner (looked for rspec)' };
}

function phpCommand(dir, file) {
  const { value, error } = readJson(file);
  if (error) return { reason: `composer.json ${error}` };
  const script = value?.scripts?.test;
  if (script !== undefined && script !== null) return { command: ['composer', 'test'] };
  const phpunit = path.join('vendor', 'bin', isWindows() ? 'phpunit.bat' : 'phpunit');
  if (existsSync(path.join(dir, phpunit))) return { command: [phpunit] };
  return { reason: 'composer.json declares no "scripts.test" and vendor/bin/phpunit is absent' };
}

const fixed = (...command) => () => ({ command });

// Mined from test-strategy.md's detection table (V-08), one row per row. Nothing is
// here that the table does not justify.
const STACKS = [
  { stack: 'node', manifest: 'package.json', resolve: nodeCommand },
  { stack: 'python', manifest: 'pyproject.toml', resolve: pythonCommand },
  { stack: 'python', manifest: 'pytest.ini', resolve: pythonCommand },
  { stack: 'python', manifest: 'setup.cfg', resolve: pythonCommand },
  { stack: 'python', manifest: 'tox.ini', resolve: pythonCommand },
  { stack: 'go', manifest: 'go.mod', resolve: fixed('go', 'test', './...') },
  { stack: 'rust', manifest: 'Cargo.toml', resolve: fixed('cargo', 'test') },
  { stack: 'java', manifest: 'pom.xml', resolve: fixed('mvn', '-q', 'test') },
  { stack: 'java', manifest: 'build.gradle', resolve: gradleCommand },
  { stack: 'java', manifest: 'build.gradle.kts', resolve: gradleCommand },
  { stack: 'ruby', manifest: 'Gemfile', resolve: rubyCommand },
  { stack: 'php', manifest: 'composer.json', resolve: phpCommand },
];

function dotnetProject(dir) {
  try {
    // Sorted, because readdir order is the filesystem's business: with two project
    // files in one directory an unsorted pick is a different test command per platform.
    return readdirSync(dir).sort().find((name) => DOTNET_PROJECT.test(name)) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

/**
 * A resolved project.
 * @typedef {{root: string, stack: string|null, manifest: string|null,
 *            command: string[]|null, reason: string|null}} Unit
 */

/**
 * The project rooted at exactly `dir`, or null when `dir` holds no manifest.
 *
 * The nearest manifest defines the project. A manifest that is present but declares no
 * command returns a Unit with `command: null` and a reason; the walk does not continue
 * past it, because a project that cannot say how it is tested is a block, not a reason
 * to adopt its parent's suite.
 *
 * @returns {Unit|null}
 */
export function projectAt(dir) {
  const candidates = [];
  for (const entry of STACKS) {
    const file = path.join(dir, entry.manifest);
    if (existsSync(file)) candidates.push({ ...entry, file });
  }
  const dotnet = dotnetProject(dir);
  if (dotnet) {
    candidates.push({ stack: 'dotnet', manifest: dotnet, file: path.join(dir, dotnet), resolve: fixed('dotnet', 'test') });
  }
  if (candidates.length === 0) return null;

  const attempts = candidates.map((entry) => {
    const outcome = entry.resolve(dir, entry.file) ?? {};
    return {
      root: dir,
      stack: entry.stack,
      manifest: entry.manifest,
      command: outcome.command ?? null,
      reason: outcome.reason ?? null,
    };
  });

  const resolved = attempts.find((a) => a.command !== null);
  if (resolved) return resolved;

  return {
    root: dir,
    stack: null,
    manifest: attempts.map((a) => a.manifest).join(', '),
    command: null,
    reason: attempts.map((a) => a.reason).filter(Boolean).join('; '),
  };
}

function* walkUp(startDir, toplevel) {
  let dir = path.resolve(startDir);
  for (;;) {
    // isPathInside is whole-segment (V-12), so a sibling directory whose name merely
    // starts with the toplevel's name never enters the walk.
    if (!isPathInside(toplevel, dir)) return;
    yield dir;
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * The suites this change must run.
 *
 * `files` are repo-relative paths, as git reports them. Each one resolves against the
 * nearest manifest at or above its own directory, stopping at `toplevel`. Distinct
 * project roots are returned once each, so a change touching twenty files in one
 * package runs that package's suite once.
 *
 * An empty `files` set resolves from `toplevel` instead of resolving nothing. That is
 * the fail-safe direction: `git commit --amend`, `--allow-empty`, and a commit issued
 * with nothing staged all present an empty set, and the widest suite the repo can
 * resolve is the right answer when the change cannot be scoped.
 *
 * @param {{toplevel: string, files: string[]}} input
 * @returns {{units: Unit[], missing: string[], searched: string[]}}
 */
export function resolveTestPlan({ toplevel, files }) {
  const starts = files.length > 0
    ? [...new Set(files.map((f) => path.dirname(path.resolve(toplevel, f))))]
    : [path.resolve(toplevel)];

  const cache = new Map();
  const at = (dir) => {
    if (!cache.has(dir)) cache.set(dir, projectAt(dir));
    return cache.get(dir);
  };

  const units = new Map();
  const missing = [];
  const searched = new Set();

  for (const start of starts) {
    let found = null;
    for (const dir of walkUp(start, toplevel)) {
      searched.add(dir);
      const unit = at(dir);
      if (unit) {
        found = unit;
        break;
      }
    }
    if (found) {
      if (!units.has(found.root)) units.set(found.root, found);
    } else {
      missing.push(start);
    }
  }

  return { units: [...units.values()], missing, searched: [...searched] };
}
