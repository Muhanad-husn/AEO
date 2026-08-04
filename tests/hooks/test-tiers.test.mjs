// Tests for the two-tier split of this repo's own battery (D17).
//
//   npm test                # the fast tier, which is what the commit gate runs
//   npm run test:integration
//   npm run test:all        # both, in that order; the CI entry point
//
// D17 puts the process-level gate suites behind their own script so the commit gate
// stays a fast signal. Both tiers name their files explicitly, because `node --test`
// can include by glob but cannot exclude, and because a rename-everything scheme
// (`*.gate.test.mjs`) would be churn for the same result.
//
// Explicit lists have one failure mode, and it is the expensive one: a new test file
// that nobody adds to either script runs nowhere and is deleted in effect, silently
// and with a green board. This file is the guard against that. It reads the two
// scripts out of package.json and compares them against what is actually on disk, so
// a forgotten file fails the fast tier immediately rather than being discovered by
// its absence months later.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { resolveTestPlan } from '../../plugin/hooks/stack.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const TESTS_DIR = path.join(repoRoot, 'tests', 'hooks');

const scripts = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).scripts ?? {};

/** The `.test.mjs` files a script names, as bare basenames. */
function filesNamedBy(script) {
  return (script ?? '')
    .split(/\s+/)
    .filter((token) => token.endsWith('.test.mjs'))
    .map((token) => path.basename(token));
}

const fast = filesNamedBy(scripts.test);
const integration = filesNamedBy(scripts['test:integration']);
const onDisk = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

describe('every test file is in exactly one tier', () => {
  test('the two tiers together account for every file on disk', () => {
    const union = [...fast, ...integration].sort();
    assert.deepEqual(
      union,
      onDisk,
      `tests/hooks holds ${onDisk.length} test file(s) and the two npm scripts name ${union.length}. ` +
        `A file in neither tier never runs. Add it to "test" (fast) or "test:integration".`,
    );
  });

  test('no file is in both tiers', () => {
    const both = fast.filter((name) => integration.includes(name));
    assert.deepEqual(both, [], 'a file in both tiers is paid for twice on every CI run');
  });

  test('both tiers are non-empty', () => {
    assert.ok(fast.length > 0, '"test" names no test files');
    assert.ok(integration.length > 0, '"test:integration" names no test files');
  });

  test('this file is in the fast tier, so the guard runs on every commit', () => {
    assert.ok(fast.includes('test-tiers.test.mjs'));
  });
});

describe('the commit gate resolves the fast tier', () => {
  // The whole point of D17 turns on which command detection picks. `scripts.test` is
  // what stack.mjs resolves for a package.json project (D10, no config file), so the
  // fast tier has to BE `test` rather than sit beside it under another name. This
  // asserts that against the real repo root and the real detection code.
  test('detection on this repo resolves npm test', () => {
    const plan = resolveTestPlan({ toplevel: repoRoot, files: ['plugin/hooks/lib.mjs'] });
    assert.deepEqual(plan.missing, []);
    assert.deepEqual(
      plan.units.map((u) => u.command),
      [['npm', 'test']],
    );
  });
});

describe('test:all runs both tiers', () => {
  test('it chains the fast tier and the integration tier', () => {
    const all = scripts['test:all'] ?? '';
    assert.match(all, /\bnpm test\b/);
    assert.match(all, /\bnpm run test:integration\b/);
  });
});
