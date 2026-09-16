// Tests for the commitment ledger (#184): plugin/scripts/commitment.mjs (record/mark),
// plugin/hooks/commitments.mjs (parseCommitments, readCommitments, countCommitments) and
// plugin/hooks/sensorium/40-commitment.mjs, against plans/phase-2/04-commitment.md's
// acceptance criterion.
//
// Run from the repo root: node --test tests/hooks/sensorium-commitment.test.mjs (see
// this slice's own package.json entry, added by literal filename per test-tiers.test.mjs).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { renderSensorium } from '../../plugin/hooks/sensorium.mjs';
import { render as renderCommitment } from '../../plugin/hooks/sensorium/40-commitment.mjs';
import {
  countCommitments as countCommitmentsFromCommitments,
  escapeCell,
  parseCommitments,
  readCommitments,
  todayLocalDate,
  unescapeCell,
} from '../../plugin/hooks/commitments.mjs';
import { countCommitments as countCommitmentsFromInterventions } from '../../scripts/score/interventions.mjs';
import { readCommitments as readCommitmentsFromSources } from '../../scripts/score/sources.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const commitmentScript = path.join(repoRoot, 'plugin', 'scripts', 'commitment.mjs');

const scratch = [];
function tempDir(prefix = 'aeo-commitment-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function runCommitment(root, args) {
  return spawnSync(process.execPath, [commitmentScript, ...args, '--root', root], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function record(root, text) {
  return runCommitment(root, ['record', text]);
}

function mark(root, word) {
  return runCommitment(root, ['mark', word]);
}

function ledgerText(root) {
  return readFileSync(path.join(root, 'COMMITMENTS.md'), 'utf8');
}

const TODAY = todayLocalDate();

// ---------------------------------------------------------------------------
// record: creates the file with its header
// ---------------------------------------------------------------------------

describe('commitment.mjs record', () => {
  test('creates COMMITMENTS.md with a header row and one data row when absent', () => {
    const dir = tempDir();
    const r = record(dir, 'Ship phase 2, 4 issues, $0');
    assert.equal(r.status, 0, r.stderr);
    const text = ledgerText(dir);
    assert.match(text, /\|\s*Date\s*\|\s*Recommendation\s*\|\s*Executed\s*\|/);
    const rows = parseCommitments(text);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { date: TODAY, text: 'Ship phase 2, 4 issues, $0', word: '', line: rows[0].line });
  });

  test('appends a second row to an existing ledger rather than overwriting it', () => {
    const dir = tempDir();
    record(dir, 'First recommendation');
    const r = record(dir, 'Second recommendation');
    assert.equal(r.status, 0, r.stderr);
    const rows = parseCommitments(ledgerText(dir));
    assert.equal(rows.length, 2);
    assert.equal(rows[0].text, 'First recommendation');
    assert.equal(rows[1].text, 'Second recommendation');
    assert.equal(rows[1].word, '');
  });
});

// ---------------------------------------------------------------------------
// sensorium: unjudged, then executed, over the newest row
// ---------------------------------------------------------------------------

describe('the commitment sensorium section', () => {
  test('reports the newest row as unjudged and executed: 0 of 0 marked', async () => {
    const dir = tempDir();
    record(dir, 'Ship phase 2, 4 issues, $0');
    const lines = await renderSensorium(dir);
    assert.ok(lines.includes(`commitment: ${TODAY} "Ship phase 2, 4 issues, $0" unjudged`));
    assert.ok(lines.includes('executed: 0 of 0 marked'));
  });

  test('a repository with no COMMITMENTS.md declares none', async () => {
    const dir = tempDir();
    const lines = await renderCommitment({ root: dir });
    assert.deepEqual(lines, ['commitment: none declared', 'executed: none declared']);
  });

  test('a null root declares none, same as 10-score.mjs\'s own guard', async () => {
    const lines = await renderCommitment({ root: null });
    assert.deepEqual(lines, ['commitment: none declared', 'executed: none declared']);
  });

  test('only the newest row of several is reported', async () => {
    const dir = tempDir();
    record(dir, 'First recommendation');
    record(dir, 'Second recommendation');
    const lines = await renderCommitment({ root: dir });
    assert.equal(lines[0], `commitment: ${TODAY} "Second recommendation" unjudged`);
  });
});

// ---------------------------------------------------------------------------
// mark: fills the newest blank cell, then refuses a second time
// ---------------------------------------------------------------------------

describe('commitment.mjs mark', () => {
  test('marks the row executed, and the sensorium reflects it', async () => {
    const dir = tempDir();
    record(dir, 'Ship phase 2, 4 issues, $0');
    const r = mark(dir, 'executed');
    assert.equal(r.status, 0, r.stderr);
    const rows = parseCommitments(ledgerText(dir));
    assert.equal(rows[0].word, 'executed');
    const lines = await renderSensorium(dir);
    assert.ok(lines.includes(`commitment: ${TODAY} "Ship phase 2, 4 issues, $0" executed`));
    assert.ok(lines.includes('executed: 1 of 1 marked'));
  });

  test('a second mark exits 2 and leaves the file unchanged', () => {
    const dir = tempDir();
    record(dir, 'Ship phase 2, 4 issues, $0');
    mark(dir, 'executed');
    const before = ledgerText(dir);
    const r = mark(dir, 'partial');
    assert.equal(r.status, 2);
    const after = ledgerText(dir);
    assert.equal(after, before);
  });

  test('mark with no ledger at all exits 2', () => {
    const dir = tempDir();
    const r = mark(dir, 'executed');
    assert.equal(r.status, 2);
  });

  test('mark fills the newest of two rows, and leaves the older one blank', () => {
    const dir = tempDir();
    record(dir, 'First recommendation');
    record(dir, 'Second recommendation');
    mark(dir, 'partial');
    const rows = parseCommitments(ledgerText(dir));
    assert.equal(rows[0].word, '');
    assert.equal(rows[1].word, 'partial');
  });
});

// ---------------------------------------------------------------------------
// countCommitments, moved to plugin/hooks/commitments.mjs and re-exported
// ---------------------------------------------------------------------------

describe('countCommitments over the ledger', () => {
  test('returns { marked: 1, total: 1 } after one row is marked executed, via scripts/score/interventions.mjs', () => {
    const dir = tempDir();
    record(dir, 'Ship phase 2, 4 issues, $0');
    mark(dir, 'executed');
    const counts = countCommitmentsFromInterventions(ledgerText(dir));
    assert.deepEqual(counts, { marked: 1, total: 1 });
  });

  test('plugin/hooks/commitments.mjs\'s own countCommitments agrees', () => {
    const dir = tempDir();
    record(dir, 'Ship phase 2, 4 issues, $0');
    mark(dir, 'executed');
    assert.deepEqual(countCommitmentsFromCommitments(ledgerText(dir)), { marked: 1, total: 1 });
  });

  test('readCommitments agrees, from plugin/hooks/commitments.mjs and from scripts/score/sources.mjs', () => {
    const dir = tempDir();
    record(dir, 'Ship phase 2, 4 issues, $0');
    mark(dir, 'executed');
    assert.deepEqual(readCommitments(dir), { marked: 1, total: 1 });
    assert.deepEqual(readCommitmentsFromSources(dir), { marked: 1, total: 1 });
  });

  test('a directory with no COMMITMENTS.md reads to null', () => {
    const dir = tempDir();
    assert.equal(readCommitments(dir), null);
  });
});

// ---------------------------------------------------------------------------
// Pipe escaping round trip
// ---------------------------------------------------------------------------

describe('pipe escaping', () => {
  test('escapeCell and unescapeCell round-trip a pipe', () => {
    const text = 'Ship phase 2 | 4 issues | $0';
    assert.equal(unescapeCell(escapeCell(text)), text);
  });

  test('a recommendation holding a pipe survives record, mark and both readers intact', () => {
    const dir = tempDir();
    const text = 'Ship phase 2 | 4 issues | $0';
    const r = record(dir, text);
    assert.equal(r.status, 0, r.stderr);
    // The written row still holds exactly three cells -- the pipe did not open a
    // fourth column -- and the text round-trips unescaped on read.
    const rows = parseCommitments(ledgerText(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, text);
    mark(dir, 'executed');
    const counts = countCommitmentsFromInterventions(ledgerText(dir));
    assert.deepEqual(counts, { marked: 1, total: 1 });
    const lines = renderCommitment({ root: dir });
    return lines.then((out) => {
      assert.ok(out.includes(`commitment: ${TODAY} "${text}" executed`));
    });
  });
});
