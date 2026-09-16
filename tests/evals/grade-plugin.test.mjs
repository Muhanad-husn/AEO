// Tests for evals/grade-plugin.mjs — the phase 3 shape grader.
//
// The grader is not prose. It is executable code that decides pass/fail against real
// files, so it keeps coverage the way plugin/hooks/ does.
//
// Every group below has both directions: a synthetic root built to satisfy every rule,
// proven to pass whole, and a mutation of exactly one fact, proven to fail exactly the
// expectation that names it and nothing else. A grader shown only a passing tree has
// never been shown to fail. Fixtures are built fresh per test so a mutation in one test
// cannot leak into another.
//
// All in-process: gradePlugin() is called directly against a temp-directory fixture, no
// subprocess spawned. That is why this file sits in the fast tier.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { gradePlugin } from '../../evals/grade-plugin.mjs';

// ---------------------------------------------------------------------------
// Scratch space
// ---------------------------------------------------------------------------

const scratch = [];
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-grader-'));
  scratch.push(dir);
  return dir;
}

function write(root, relPath, content) {
  const full = path.join(root, ...relPath.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

// ---------------------------------------------------------------------------
// The passing fixture: the smallest plugin root that satisfies every rule.
// ---------------------------------------------------------------------------

const SPRINT_PLAN = [
  '---',
  'name: sprint-plan',
  'description: Slice a phase into issues when the founder types it.',
  'disable-model-invocation: true',
  '---',
  '',
  '# sprint-plan',
  '',
  'What this shop wants from a slice, and why.',
  '',
].join('\n');

const OTHER_SKILL = [
  '---',
  'name: red-green-refactor',
  'description: Use this skill when a behaviour change needs a test that fails first.',
  '---',
  '',
  '# red-green-refactor',
  '',
  'A test that has never failed has not been shown to test anything.',
  '',
].join('\n');

const REFERENCE = ['# a reference', 'RLM lost a day to this, L-04.', '', 'The rest of the page.', ''].join('\n');

/** Build a fresh plugin root that every expectation passes on, and return its path. */
function makeRoot() {
  const root = tempDir();

  write(root, '.claude-plugin/plugin.json', JSON.stringify({
    $schema: 'https://json.schemastore.org/claude-code-plugin-manifest.json',
    name: 'fixture',
    version: '0.0.1',
  }, null, 2));

  write(root, 'skills/sprint-plan/SKILL.md', SPRINT_PLAN);
  write(root, 'skills/red-green-refactor/SKILL.md', OTHER_SKILL);
  write(root, 'references/x.md', REFERENCE);

  write(root, 'hooks/fake-gate.mjs', '// stub gate\n');
  write(root, 'hooks/hooks.json', JSON.stringify({
    description: 'fixture',
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/fake-gate.mjs"' }],
        },
      ],
    },
  }, null, 2));

  return root;
}

// ---------------------------------------------------------------------------
// Locating one expectation
// ---------------------------------------------------------------------------

const KEY = {
  agents: 'no agents/ directory',
  refuse: 'refuse family',
  disable: 'disable-model-invocation',
  ordered: 'ordered list of three or more items',
  references: 'references/ cites',
  budget: 'session-start read budget',
};

function find(report, key) {
  const hits = report.expectations.filter((e) => e.text.includes(key));
  assert.equal(hits.length, 1, `expected exactly one expectation naming ${JSON.stringify(key)}, found ${hits.length}`);
  return hits[0];
}

/** Assert that `key` is the only failing expectation, and that its evidence names `file`. */
function onlyFailure(report, key, file) {
  const failed = report.expectations.filter((e) => !e.passed);
  assert.deepEqual(
    failed.map((e) => e.text),
    [find(report, key).text],
    `expected only the ${key} expectation to fail, got: ${failed.map((e) => `${e.text} :: ${e.evidence}`).join(' | ')}`,
  );
  assert.ok(failed[0].evidence.includes(file), `evidence should name ${file}, got: ${failed[0].evidence}`);
}

// ---------------------------------------------------------------------------

describe('the envelope', () => {
  test('gradePlugin returns { expectations: [{ text, passed, evidence }] }', () => {
    const report = gradePlugin(makeRoot());
    assert.ok(Array.isArray(report.expectations));
    assert.ok(report.expectations.length > 0);
    for (const e of report.expectations) {
      assert.equal(typeof e.text, 'string');
      assert.equal(typeof e.passed, 'boolean');
      assert.equal(typeof e.evidence, 'string');
      assert.notEqual(e.text.trim(), '');
      assert.notEqual(e.evidence.trim(), '');
    }
  });

  test('the report carries no expected count of skills or agents', () => {
    const report = gradePlugin(makeRoot());
    for (const e of report.expectations) {
      assert.doesNotMatch(e.text, /ships exactly \d+/);
    }
  });

  test('the summary counts what the expectations say', () => {
    const report = gradePlugin(makeRoot());
    const passed = report.expectations.filter((e) => e.passed).length;
    assert.equal(report.summary.passed, passed);
    assert.equal(report.summary.total, report.expectations.length);
    assert.equal(report.summary.failed, report.expectations.length - passed);
  });
});

describe('the passing fixture', () => {
  test('every expectation passes', () => {
    const report = gradePlugin(makeRoot());
    const failed = report.expectations.filter((e) => !e.passed);
    assert.deepEqual(failed.map((e) => `${e.text} :: ${e.evidence}`), []);
  });

  test('each phase 3 check is present exactly once', () => {
    const report = gradePlugin(makeRoot());
    for (const key of Object.values(KEY)) find(report, key);
  });
});

describe('no agents/ directory', () => {
  test('an agents/ file fails exactly that expectation and names the file', () => {
    const root = makeRoot();
    write(root, 'agents/x.md', '---\nname: x\n---\n\n# x\n');
    onlyFailure(gradePlugin(root), KEY.agents, 'agents/x.md');
  });
});

describe('nothing refuses', () => {
  test('a refuse word in a skill body fails exactly that expectation and names the file', () => {
    const root = makeRoot();
    write(root, 'skills/red-green-refactor/SKILL.md', OTHER_SKILL.replace('A test that has never failed', 'This skill refuses a change that'));
    onlyFailure(gradePlugin(root), KEY.refuse, 'skills/red-green-refactor/SKILL.md');
  });

  test('a refuse word in a reference fails the same expectation and names that file', () => {
    const root = makeRoot();
    write(root, 'references/x.md', REFERENCE.replace('The rest of the page.', 'The hook refused the write.'));
    onlyFailure(gradePlugin(root), KEY.refuse, 'references/x.md');
  });
});

describe('disable-model-invocation outside sprint-plan', () => {
  test('a second skill carrying it fails exactly that expectation and names the file', () => {
    const root = makeRoot();
    write(root, 'skills/red-green-refactor/SKILL.md', OTHER_SKILL.replace('---\n\n# red', 'disable-model-invocation: true\n---\n\n# red'));
    onlyFailure(gradePlugin(root), KEY.disable, 'skills/red-green-refactor/SKILL.md');
  });

  test('sprint-plan carrying it is not a failure', () => {
    const report = gradePlugin(makeRoot());
    assert.equal(find(report, KEY.disable).passed, true);
  });
});

describe('no lane that orders steps', () => {
  test('an ordered list of three fails exactly that expectation and names the file', () => {
    const root = makeRoot();
    write(root, 'skills/red-green-refactor/SKILL.md', OTHER_SKILL.replace(
      'A test that has never failed has not been shown to test anything.',
      '1. Write the test.\n2. Make it pass.\n3. Refactor.',
    ));
    onlyFailure(gradePlugin(root), KEY.ordered, 'skills/red-green-refactor/SKILL.md');
  });

  test('an ordered list of two is not a failure', () => {
    const root = makeRoot();
    write(root, 'skills/red-green-refactor/SKILL.md', OTHER_SKILL.replace(
      'A test that has never failed has not been shown to test anything.',
      '1. Write the test.\n2. Make it pass.',
    ));
    assert.equal(find(gradePlugin(root), KEY.ordered).passed, true);
  });

  test('sprint-plan may hold an ordered list', () => {
    const root = makeRoot();
    write(root, 'skills/sprint-plan/SKILL.md', SPRINT_PLAN.replace(
      'What this shop wants from a slice, and why.',
      '1. One worktree.\n2. One issue.\n3. One pull request.',
    ));
    assert.equal(find(gradePlugin(root), KEY.ordered).passed, true);
  });

  test('the count of "then" is printed as evidence, not as a pass or fail', () => {
    const root = makeRoot();
    write(root, 'skills/red-green-refactor/SKILL.md', OTHER_SKILL.replace(
      'A test that has never failed has not been shown to test anything.',
      'Write the test, then make it pass, then stop.',
    ));
    const check = find(gradePlugin(root), KEY.ordered);
    assert.match(check.evidence, /then: 2\b/);
    assert.equal(check.passed, true);
  });

  test('a body with no "then" still prints the count', () => {
    assert.match(find(gradePlugin(makeRoot()), KEY.ordered).evidence, /then: 0\b/);
  });
});

describe('every reference cites something', () => {
  test('a reference with no citation fails exactly that expectation and names the file', () => {
    const root = makeRoot();
    write(root, 'references/y.md', '# a page\n\nProse with no citation and no measurement in it at all.\n');
    onlyFailure(gradePlugin(root), KEY.references, 'references/y.md');
  });

  test('a number with a unit in the first five lines is a citation', () => {
    const root = makeRoot();
    write(root, 'references/y.md', '# a page\n\nThe rebuild took 4 days.\n\nThe rest.\n');
    assert.equal(find(gradePlugin(root), KEY.references).passed, true);
  });

  test('a citation after the fifth line does not count', () => {
    const root = makeRoot();
    write(root, 'references/y.md', '# a page\n\n\n\n\n\nOnly here, L-04.\n');
    onlyFailure(gradePlugin(root), KEY.references, 'references/y.md');
  });
});

describe('the session-start read budget', () => {
  test('the fixture is under 150 lines and the number is printed', () => {
    const check = find(gradePlugin(makeRoot()), KEY.budget);
    assert.equal(check.passed, true);
    assert.match(check.evidence, /\d+ lines/);
  });
});

describe('the checks that stay', () => {
  test('a manifest that does not parse fails the manifest expectation', () => {
    const root = makeRoot();
    write(root, '.claude-plugin/plugin.json', '{ not json');
    const failed = gradePlugin(root).expectations.filter((e) => !e.passed);
    assert.ok(failed.some((e) => e.text.includes('plugin.json')));
  });

  test('a hooks.json reference to a missing script fails', () => {
    const root = makeRoot();
    rmSync(path.join(root, 'hooks', 'fake-gate.mjs'));
    const failed = gradePlugin(root).expectations.filter((e) => !e.passed);
    assert.ok(failed.some((e) => e.text.includes('hooks/fake-gate.mjs')));
  });

  test('a SKILL.md whose frontmatter does not parse fails the parse expectation', () => {
    const root = makeRoot();
    write(root, 'skills/red-green-refactor/SKILL.md', '---\nname: red-green-refactor\ndescription: a: b: c\n---\n\n# x\n');
    const failed = gradePlugin(root).expectations.filter((e) => !e.passed);
    assert.ok(failed.some((e) => e.text.includes('frontmatter parses')));
  });
});
