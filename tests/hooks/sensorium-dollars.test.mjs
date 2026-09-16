// Tests for plugin/hooks/ledger.mjs and the sensorium's dollars section,
// plugin/hooks/sensorium/20-dollars.mjs (#182).
//
// Run from the repo root: node --test tests/hooks/sensorium-dollars.test.mjs (see
// this slice's own package.json entry).
//
// Three layers, cheapest first: parseLedger itself, against synthetic markdown that
// matches the acceptance criterion's own shapes (plans/phase-2/02-dollars.md); then
// the section module's render({ root }); then renderSensorium(root) against a
// temporary repository, and against a faithful excerpt of RLM's own real LEDGER.md
// (tests/fixtures/sensorium/rlm-ledger.md) so the reader is proved against a real
// ledger's shape -- extra prose paragraphs, a blank first-row sample, a parenthetical
// note inside a cell -- and not only a toy string.

import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseLedger } from '../../plugin/hooks/ledger.mjs';
import { render as renderDollars } from '../../plugin/hooks/sensorium/20-dollars.mjs';
import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const fixturesDir = path.join(repoRoot, 'tests', 'fixtures', 'sensorium');

// ---------------------------------------------------------------------------
// scratch space
// ---------------------------------------------------------------------------

const scratch = [];
function tempDir(prefix = 'aeo-dollars-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// The acceptance criterion's own fixture markdown (plans/phase-2/02-dollars.md):
// a Ceiling $50 line, a table whose last row's balance cell is 31.8800.
const LEDGER_WITH_TABLE = `Ceiling $50. Written by the code that makes gateway calls; a line added by hand says so.

| date | sample | phase | model | tokens in | tokens out | dollars | balance |
|---|---|---|---|---|---|---|---|
| 2026-09-05 | | | | 0 | 0 | 0.0000 | 50.0000 |
| 2026-09-06 | atlas | 2 | z-ai/glm-5.3 | 23182 | 30272 | 18.1200 | 31.8800 |
`;

const LEDGER_NO_TABLE = `Ceiling $50. Written by the code that makes gateway calls; a line added by hand says so.

No table follows this line, only prose about the ceiling and nothing else.
`;

function writeLedger(dir, markdown) {
  writeFileSync(path.join(dir, 'LEDGER.md'), markdown);
}

// ---------------------------------------------------------------------------
// parseLedger
// ---------------------------------------------------------------------------

describe('parseLedger', () => {
  test('reads the ceiling and the last row\'s balance', () => {
    const result = parseLedger(LEDGER_WITH_TABLE);
    assert.equal(result.ceiling, 50);
    assert.equal(result.balance, 31.88);
  });

  test('the ceiling is the first $<n> after the word Ceiling, not any other dollar figure', () => {
    const markdown = `Some prose mentions $999 before the word Ceiling ever appears.
Ceiling $50, and later $9 is a different number entirely.

| date | balance |
|---|---|
| 2026-09-05 | 40.0000 |
`;
    const result = parseLedger(markdown);
    assert.equal(result.ceiling, 50);
  });

  test('a document with no table with a balance column is unreadable', () => {
    const result = parseLedger(LEDGER_NO_TABLE);
    assert.equal(result.error, 'no table with a balance column');
  });

  test('a table with no balance column at all is unreadable', () => {
    const markdown = `Ceiling $50.

| date | sample | dollars |
|---|---|---|
| 2026-09-05 | atlas | 0.0010 |
`;
    const result = parseLedger(markdown);
    assert.equal(result.error, 'no table with a balance column');
  });

  test('a balance table with a header row and no data rows is unreadable', () => {
    const markdown = `Ceiling $50.

| date | balance |
|---|---|
`;
    const result = parseLedger(markdown);
    assert.equal(result.error, 'no table with a balance column');
  });
});

// ---------------------------------------------------------------------------
// 20-dollars.mjs render({ root })
// ---------------------------------------------------------------------------

describe('the dollars section', () => {
  test('prints spent, ceiling and balance to two decimals, from a real-shaped ledger', () => {
    const dir = tempDir();
    writeLedger(dir, LEDGER_WITH_TABLE);
    const lines = renderDollars({ root: dir });
    assert.deepEqual(lines, ['dollars: 18.12 of 50, balance 31.88 (LEDGER.md)']);
  });

  test('a repository with no LEDGER.md prints "none declared"', () => {
    const dir = tempDir();
    const lines = renderDollars({ root: dir });
    assert.deepEqual(lines, ['dollars: none declared']);
  });

  test('no root at all (session-status.mjs\'s own not-a-repo case) prints "none declared"', () => {
    const lines = renderDollars({ root: undefined });
    assert.deepEqual(lines, ['dollars: none declared']);
  });

  test('a LEDGER.md the reader cannot parse prints why', () => {
    const dir = tempDir();
    writeLedger(dir, LEDGER_NO_TABLE);
    const lines = renderDollars({ root: dir });
    assert.deepEqual(lines, ['dollars: LEDGER.md present, unreadable (no table with a balance column)']);
  });

  test('exports its section name', async () => {
    const mod = await import('../../plugin/hooks/sensorium/20-dollars.mjs');
    assert.equal(mod.name, '20-dollars');
  });
});

// ---------------------------------------------------------------------------
// renderSensorium(root): the dollars line takes its place in the composed block
// ---------------------------------------------------------------------------

describe('renderSensorium composes the dollars line with the rest of the block', () => {
  test('a repository with a LEDGER.md and no PLAN.md still prints its dollars line', async () => {
    const dir = tempDir();
    writeLedger(dir, LEDGER_WITH_TABLE);
    const lines = await renderSensorium(dir);
    assert.equal(lines.at(-1), 'dollars: 18.12 of 50, balance 31.88 (LEDGER.md)');
    assert.deepEqual(lines.slice(0, 2), ['score: none declared', 'bar: none declared']);
  });

  test('a repository with no LEDGER.md prints "none declared" for dollars', async () => {
    const dir = tempDir();
    const lines = await renderSensorium(dir);
    assert.equal(lines.at(-1), 'dollars: none declared');
  });

  test('against a faithful excerpt of RLM\'s own real LEDGER.md', async () => {
    const dir = tempDir();
    copyFileSync(path.join(fixturesDir, 'rlm-ledger.md'), path.join(dir, 'LEDGER.md'));
    // The fixture's own numbers, read straight off disk so this assertion tracks
    // the fixture rather than a value pasted once and left to drift.
    const parsed = parseLedger(readFileSync(path.join(fixturesDir, 'rlm-ledger.md'), 'utf8'));
    assert.equal(parsed.ceiling, 50);
    assert.equal(parsed.balance, 49.4578); // the excerpt's last row, RLM's real number
    const lines = await renderSensorium(dir);
    assert.equal(lines.at(-1), 'dollars: 0.54 of 50, balance 49.46 (LEDGER.md)');
  });
});
