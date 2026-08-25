// AEO test-command resolution: the command a project runs its suite with, read from the
// project's own record rather than guessed from its manifests.
//
// WHY THIS EXISTS (V-05, D10, D29). The vendored harness hard-coded `uv run pytest` and
// `ruff` in the commit gate. The first replacement was an eleven-row table that inferred a
// command from whichever manifest sat nearest the change. That table was a second
// detection, performed in the one place that cannot ask a question, and it failed the way
// a guess fails. On a real Python project it inferred `uv run pytest`: 3,528 tests and
// roughly 55 minutes against a 570-second budget, where that project's own pre-commit
// command runs 2,464 tests in 40 seconds (issue #110). Every stack the table had no row
// for blocked on every commit, however correctly the project had been built and tested.
//
// So the command is recorded, not inferred. `aeo-tests.json` at a project directory holds
// two keys, one of them optional:
//
//   { "test": "npm test", "test_full": "npm run test:all" }
//
// By the time a commit fires, an actor has already inspected the repository, chosen the
// runner, and run the suite. The record is where that answer is written down.
//
// WHY TWO (D31, issues #127 and #128). One command was asked to be two things: the gate a
// loop runs on every green step, and the exhaustive run that must pass before merge. A
// suite grows two populations that do not belong in one run — thousands of CPU-bound unit
// tests, and a handful of tests that launch real processes and are timed. Held in one
// command, the second population is starved by the first and the gate goes both slow and
// non-deterministically red; a project measured 16 m 24 s and 20 m 33 s on the same commit,
// failing on a different pair each time. The other direction hurts too: a Python CLI at its
// eleventh slice ran 292 tests in 764 s, of which 449 s was 70 acceptance tests each paying
// a 4.25 s interpreter start that the work under test did not need.
//
// So `test` is the cheap tier a loop may run constantly, and `test_full` is what CI runs
// and what `safe-pr` cites. `test_full` ABSENT FALLS BACK TO `test`, so every record
// written before this key existed keeps meaning exactly what it meant. `test_full` PRESENT
// AND MALFORMED is a block, in the same direction as every other bad field here: a project
// that has stated how it is tested and stated it wrongly is corrected, not reinterpreted.
//
// WHO READS THIS NOW, AND WHAT FOR (D30). The commit gate that used to run this command
// on every commit is deleted — the branch it protected is enforced server-side by GitHub
// instead, and re-running the project's suite locally was that gate's own job, not this
// module's. The remaining consumer is sandbox-guard.mjs, which reads the record to
// RECOGNISE the declared suite as text (`invokesDeclaredSuite`), never to run it, so it
// can refuse a Bash invocation of that suite while a long job's sentinel is up (L-02).
// This module still never trusts a recorded verdict; it just no longer executes anything.
//
// THE COMMAND IS A STRING, not a program and an argv array. That is the same shape as
// `scripts.test` in package.json and the same shape a founder types, so `npm test &&
// pytest` is how a project with two suites says so.
//
// THERE IS NO `dir` FIELD. A record's own directory is where its command belongs, so a
// mono-repo says "two projects" by holding two records. A directory field would be a
// config option almost nobody sets, which is the tripwire D10 rejected a config file over
// in the first place.
//
// A MISSING RECORD RESOLVES NOTHING, never a fallback to a guess (L-08). There is no
// per-language table anywhere, and a record that does not parse is a failure with a
// message rather than a reason to look somewhere else.
//
// THE FILE NAME `stack.mjs` IS NOW A MISNOMER, and it is kept anyway. docs/MIGRATION.md
// and five files under logs/ name it; renaming would leave those pointing at nothing for
// no behavioural gain.
//
// Why a separate module rather than lib.mjs: sandbox-guard is the shared-code boundary
// this module exists to serve, kept apart from gate-local code on the same grounds D10
// originally gave.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { isPathInside } from './lib.mjs';

/**
 * The record a project writes to say how it is tested. Tracked in git, at the project
 * directory, never under `.claude/` — a builder that changes the test setup has to be able
 * to update it, and path-guard refuses a role every write inside `.claude/`.
 */
export const RECORD_FILE = 'aeo-tests.json';

/** The key every record carries: the cheap tier, run on every green step. */
export const RECORD_KEY = 'test';

/** The optional key: the exhaustive tier CI runs. Absent means "the same as `test`". */
export const FULL_KEY = 'test_full';

/**
 * A resolved project.
 *
 * `command` is the fast tier, `full` the exhaustive one. On a record naming only `test`
 * they are the same string, which is what makes a one-key record keep working.
 *
 * @typedef {{root: string, record: string, command: string|null, full: string|null, reason: string|null}} Unit
 */

/**
 * The project rooted at exactly `dir`, or null when `dir` holds no record.
 *
 * One record, one command, one Unit. A root that needs two suites says so in one command
 * line — `npm test && pytest` — rather than by holding two records, which is why this
 * returns a Unit and not an array.
 *
 * A record that is present but unusable yields a Unit with `command: null` and a reason.
 * The walk does not continue past it: a project that has stated how it is tested and
 * stated it wrongly is a block, not a reason to adopt its parent's suite.
 *
 * @returns {Unit|null}
 */
export function projectAt(dir) {
  const file = path.join(dir, RECORD_FILE);
  if (!existsSync(file)) return null;

  const unit = (command, full, reason) => ({ root: dir, record: file, command, full, reason });
  const unusable = (reason) => unit(null, null, reason);

  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return unusable(`${RECORD_FILE} cannot be read (${err.message})`);
  }

  let value;
  try {
    // JSON rather than a bare line of text, so a truncated or half-edited record is a
    // named failure with a parser message instead of a command nobody meant to run.
    value = JSON.parse(text);
  } catch (err) {
    return unusable(`${RECORD_FILE} does not parse as JSON (${err.message})`);
  }

  const command = value?.[RECORD_KEY];
  if (typeof command !== 'string' || command.trim() === '') {
    return unusable(`${RECORD_FILE} declares no "${RECORD_KEY}" command`);
  }

  // Absent is the fallback; anything else present has to be a command line. A key someone
  // meant to fill and left as `""` or `[]` reads as "no full tier" if it falls back, which
  // is the silent reinterpretation this record has refused since D10.
  const raw = value?.[FULL_KEY];
  if (raw !== undefined && (typeof raw !== 'string' || raw.trim() === '')) {
    return unusable(
      `${RECORD_FILE} declares a "${FULL_KEY}" that is not a command line — omit the key to run "${RECORD_KEY}" for both tiers`,
    );
  }

  const full = raw === undefined ? command : raw;
  return unit(command.trim(), full.trim(), null);
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
 * nearest record at or above its own directory, stopping at `toplevel`. Distinct projects
 * are returned once each, so a change touching twenty files in one package runs that
 * package's suite once.
 *
 * An empty `files` set resolves from `toplevel` instead of resolving nothing. That is the
 * fail-safe direction: `git commit --amend`, `--allow-empty`, and a commit issued with
 * nothing staged all present an empty set, and the widest suite the repo can resolve is
 * the right answer when the change cannot be scoped.
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
      const here = at(dir);
      if (here) {
        found = here;
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
