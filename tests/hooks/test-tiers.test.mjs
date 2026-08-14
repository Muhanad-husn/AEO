// Tests for the two-tier split of this repo's own battery (D17, amended by D30).
//
//   npm test                # the fast tier
//   npm run test:integration
//   npm run test:all        # both, in that order; the CI entry point
//
// D17 put the process-level gate suites behind their own script so the fast tier stayed
// a fast signal for whoever ran it locally before every commit — the commit gate, while
// it existed. That local trigger is deleted (D30); the split and its reasoning stand.
// Both tiers name their files explicitly, because `node --test`
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
// The whole tree, not just tests/hooks. The first test file written outside that one
// directory — tests/skills/, for the skill tree's one executable — was accounted for by
// nothing, which is the exact failure this file exists to catch. A guard scoped to one
// directory stops guarding the moment a second one appears.
const TESTS_ROOT = path.join(repoRoot, 'tests');

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
/** Every `.test.mjs` basename anywhere under tests/. */
function testFilesUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...testFilesUnder(path.join(dir, entry.name)));
    else if (entry.name.endsWith('.test.mjs')) out.push(entry.name);
  }
  return out;
}

const onDisk = testFilesUnder(TESTS_ROOT).sort();

describe('every test file is in exactly one tier', () => {
  test('the two tiers together account for every file on disk', () => {
    const union = [...fast, ...integration].sort();
    assert.deepEqual(
      union,
      onDisk,
      `tests/ holds ${onDisk.length} test file(s) and the two npm scripts name ${union.length}. ` +
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

describe('the two Phase 6 artifacts keep a smoke check in the fast tier (D26)', () => {
  // The union check above is satisfied by any placement, so it would accept a smoke file
  // being moved into the integration tier beside the test it exists to compensate for.
  // That move would restore issue #96's hole in silence. Each pair below is one artifact
  // seen from both tiers: the expensive test that spawns processes, and the cheap check
  // that runs on every commit.
  const PAIRS = [
    { artifact: 'the new-project scaffolder', smoke: 'new-project-plan-smoke.test.mjs', full: 'new-project-scaffold.test.mjs' },
    { artifact: 'the shared status renderer', smoke: 'status-render-smoke.test.mjs', full: 'status.test.mjs' },
  ];

  for (const { artifact, smoke, full } of PAIRS) {
    test(`${artifact}: ${smoke} is fast, ${full} is integration`, () => {
      assert.ok(
        fast.includes(smoke),
        `${smoke} is not in the fast tier. It exists because ${full} is too expensive to run ` +
          'on every commit, so moving it out leaves the fast tier blind to this artifact again.',
      );
      assert.ok(
        integration.includes(full),
        `${full} is not in the integration tier. If it became cheap enough for the fast tier, ` +
          `D26 needs revising and ${smoke} is then redundant.`,
      );
    });
  }
});

describe('this repository\'s own record resolves to the fast tier', () => {
  // aeo-tests.json is what sandbox-guard reads to recognise this repository's own suite
  // during a live sentinel (D29, amended by D30) — it names no gate any more, but the
  // fast tier still has to BE `npm test` rather than sit beside it under another name, and
  // the record has to say so. This asserts that against the real repo root and the real
  // resolver, not against the record's text.
  test('this repository records npm test, and that is what stack.mjs resolves', () => {
    const plan = resolveTestPlan({ toplevel: repoRoot, files: ['plugin/hooks/lib.mjs'] });
    assert.deepEqual(
      plan.missing,
      [],
      'no aeo-tests.json resolves at this repository root, so sandbox-guard cannot recognise this repo\'s own suite',
    );
    assert.deepEqual(plan.units.map((u) => u.command), ['npm test']);
    assert.equal(plan.units[0].root, repoRoot);
  });
});

describe('test:all runs both tiers', () => {
  test('it chains the fast tier and the integration tier', () => {
    const all = scripts['test:all'] ?? '';
    assert.match(all, /\bnpm test\b/);
    assert.match(all, /\bnpm run test:integration\b/);
  });
});
