// One rubric, two consumers, one copy.
//
// The rule the verify lane is built on is that the risk rubric exists exactly once and
// that both the things which act on it read that one file. Two consumers that each carry
// their own copy of the table agree on the day they are written and drift silently after,
// with nothing in either file to say which reading is current.
//
// "The two consumers agree on a change on each of the three rows" is not something a test
// can settle by classifying sample changes -- that would need a classifier, and a
// classifier here would be a hand-tuned heuristic standing in for the judgment the rubric
// asks a reader to make. What a test can settle is the property that makes agreement
// structural rather than lucky: there is one table, it has those three rows, both
// consumers point at it, and neither restates it.
//
// Prose gets no unit tests in this project. This is not a test of prose quality. It is a
// test of an invariant over files, and it fails the moment somebody pastes the table into
// a second place.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugin');
const RUBRIC = path.join(pluginRoot, 'skills', 'verify', 'references', 'risk-rubric.md');

/** The consumers, by the path each is expected to name. */
const CONSUMERS = [
  path.join(pluginRoot, 'skills', 'verify', 'SKILL.md'),
  path.join(pluginRoot, 'skills', 'safe-pr', 'SKILL.md'),
];

const RUBRIC_REF = 'skills/verify/references/risk-rubric.md';
const VERDICTS = ['Full verification', 'Verification', 'Tests only'];

/** A table row whose right-hand cell is one of the rubric's verdicts. */
const RUBRIC_ROW_RE = new RegExp(`^\\s*\\|(.+)\\|\\s*(${VERDICTS.join('|')})\\s*\\|\\s*$`, 'i');

function read(file) {
  return readFileSync(file, 'utf8');
}

/** Every file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function rubricRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => RUBRIC_ROW_RE.exec(line))
    .filter(Boolean)
    .map((m) => ({ trigger: m[1].trim(), verdict: m[2].trim() }))
    // The header's right-hand cell is the word "Verification" too. It is the column
    // name, not a row, and counting it would make a three-row table look like four.
    .filter((row) => !/^change touches$/i.test(row.trigger));
}

describe('the risk rubric', () => {
  test('has exactly the three rows, in strictness order', () => {
    const rows = rubricRows(read(RUBRIC));
    assert.equal(rows.length, 3, `expected three rows, found ${rows.length}`);
    assert.deepEqual(
      rows.map((r) => r.verdict),
      ['Full verification', 'Verification', 'Tests only'],
    );
    assert.match(rows[0].trigger, /contract or spec/i);
    assert.match(rows[1].trigger, /acceptance test/i);
    assert.match(rows[2].trigger, /docs, comments, formatting/i);
  });

  test('names both of its consumers', () => {
    const text = read(RUBRIC);
    assert.match(text, /`verify`/);
    assert.match(text, /safe-pr/);
  });

  test('says that nothing it triggers blocks a merge', () => {
    // The rubric decides whether an agent looks, never whether a merge proceeds. A copy
    // of this table that lost that sentence would read as a gate.
    assert.match(read(RUBRIC), /advisory/i);
  });
});

describe('one copy', () => {
  test('no other file in the plugin carries the table', () => {
    const offenders = [];
    for (const file of walk(pluginRoot)) {
      if (path.resolve(file) === path.resolve(RUBRIC)) continue;
      const rows = rubricRows(read(file));
      if (rows.length > 0) offenders.push(`${path.relative(repoRoot, file)}: ${rows.map((r) => r.verdict).join(', ')}`);
    }
    assert.deepEqual(offenders, [], `a second copy of the rubric exists: ${offenders.join(' | ')}`);
  });
});

describe('both consumers', () => {
  test('point at the one copy by path', () => {
    for (const file of CONSUMERS) {
      assert.ok(read(file).includes(RUBRIC_REF), `${path.relative(repoRoot, file)} does not reference ${RUBRIC_REF}`);
    }
  });

  test('reach it through ${CLAUDE_PLUGIN_ROOT}, so an installed session resolves it', () => {
    for (const file of CONSUMERS) {
      assert.ok(
        read(file).includes(`\${CLAUDE_PLUGIN_ROOT}/${RUBRIC_REF}`),
        `${path.relative(repoRoot, file)} references the rubric by a path an installed session cannot resolve`,
      );
    }
  });

  test('describe the rubric as shared, not as their own', () => {
    for (const file of CONSUMERS) {
      assert.match(read(file), /only copy/i, `${path.relative(repoRoot, file)} does not say the rubric is single-sourced`);
    }
  });
});
