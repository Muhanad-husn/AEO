// A drift alarm for the README's gate map, in the shape packaging-surface.test.mjs
// established: `plugin/hooks/hooks.json` is the source of truth, the README is the claim,
// and nothing here pins prose.
//
// The map drifted from PR #118 until v0.2.0 and PR #123's redraw walked past it. The cause
// was that the count was written by hand against a file nobody re-read. Two readings of
// hooks.json are both defensible — eight wired entries, six distinct scripts — and prose
// that says "hooks" while meaning "scripts" is wrong under one of them. So this derives the
// number instead of stating it, the way the skill-lane split is derived from the tree.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const HOOKS_JSON_PATH = path.join(repoRoot, 'plugin', 'hooks', 'hooks.json');
const README_PATH = path.join(repoRoot, 'README.md');

// Counting entries would give eight, because `block-merge` is wired twice on two matchers
// and one SessionStart entry is an inline shell command with no `args` at all — the
// `node --version` probe that prints the gates-not-enforcing warning. That entry ships no
// script, so it has no basename, cannot have a table row, and is excluded on purpose. The
// README counts distinct scripts, and so does this.
function wiredGateScripts() {
  const config = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
  const names = new Set();
  for (const eventGroups of Object.values(config.hooks ?? {})) {
    for (const group of eventGroups) {
      for (const entry of group.hooks ?? []) {
        for (const arg of entry.args ?? []) {
          if (arg.endsWith('.mjs')) names.add(path.basename(arg, '.mjs'));
        }
      }
    }
  }
  return names;
}

// The gate table lives under "## The gates" and ends at the next level-2 heading. Reading
// the whole README would also pick up the two skill tables above it.
function readmeGatesSection() {
  const readme = readFileSync(README_PATH, 'utf8');
  const start = readme.indexOf('## The gates');
  assert.notEqual(start, -1, 'README has no "## The gates" section');
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

// First cell of each table row, when it is a single backticked name: `| \`block-merge\` | … |`.
function gateTableRowNames(section) {
  return new Set([...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]));
}

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

// Matches only "<word> scripts" and "<word> gate scripts", the two shapes the README uses
// to state this count. Matches whose word is not a number word — "these scripts" — are
// prose, not counts, and are dropped below.
const COUNT_IN_PROSE = /\b([a-z]+)\s+(?:gate\s+)?scripts\b/gi;

describe('the README gate map matches what hooks.json wires', () => {
  test('every wired gate script has a row in the gate table', () => {
    const wired = wiredGateScripts();
    assert.ok(wired.size > 0, 'parsed no gate scripts out of hooks.json; the parser is broken');

    const rows = gateTableRowNames(readmeGatesSection());
    const missing = [...wired].filter((name) => !rows.has(name)).sort();
    assert.deepEqual(
      missing,
      [],
      `hooks.json wires ${missing.join(', ')} but the README gate table has no row for it. `
        + 'Add a row under "## The gates" saying what it refuses.',
    );
  });

  test('the gate table has no row for a script hooks.json does not wire', () => {
    const wired = wiredGateScripts();
    const rows = gateTableRowNames(readmeGatesSection());
    const stale = [...rows].filter((name) => !wired.has(name)).sort();
    assert.deepEqual(
      stale,
      [],
      `the README gate table has a row for ${stale.join(', ')}, which hooks.json does not `
        + 'wire. Delete the row, or wire the script.',
    );
  });

  test('every gate-script count in the README prose matches the number wired', () => {
    const expected = wiredGateScripts().size;
    const expectedWord = NUMBER_WORDS[expected];
    assert.ok(expectedWord, `hooks.json wires ${expected} scripts, past this test's word list`);

    const readme = readFileSync(README_PATH, 'utf8');
    const stated = [...readme.matchAll(COUNT_IN_PROSE)]
      .map((m) => m[1].toLowerCase())
      .filter((word) => NUMBER_WORDS.includes(word));

    assert.ok(
      stated.length > 0,
      'the README states no gate-script count; one of the sentences that used to carry it '
        + 'has been reworded past this test',
    );
    for (const word of stated) {
      assert.equal(
        word,
        expectedWord,
        `the README says "${word} ... scripts" but hooks.json wires ${expected} distinct `
          + `gate scripts (${[...wiredGateScripts()].sort().join(', ')}). Fix the prose.`,
      );
    }
  });
});
