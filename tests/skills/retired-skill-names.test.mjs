// No file under plugin/skills/ names a retired skill as if it still ran.
//
// Issue #250: sprint-plan told the founder that `sprint-start` begins the first issue.
// That skill was removed in 0.3.0, so the founder typed a command that does not exist.
// A skill is read as an instruction, so a retired name in its text is a wrong instruction.
//
// Only two forms count: the slash form (/aeo:<name>) and a backticked exact name. Plain
// words such as "review" or "fix" in ordinary prose are fine. plugin/DECISIONS.md sits
// outside plugin/skills/ and is history, so it is not scanned.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SKILLS_DIR = path.join(repoRoot, 'plugin', 'skills');

const RETIRED = [
  'sprint-start',
  'safe-pr',
  'tdd-ci',
  'tdd-plan',
  'triage',
  'verify',
  'review',
  'fix',
  'monitor-design',
  'worker-dispatch',
  'red-green-refactor',
];

const alt = RETIRED.join('|');
const SLASH_RE = new RegExp(String.raw`/aeo:(?:${alt})(?![\w-])`);
const BACKTICK_RE = new RegExp('`(?:' + alt + ')`');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
    return /\.(md|mjs|js|json|ya?ml)$/.test(e.name) ? [p] : [];
  });
}

test('no file under plugin/skills/ names a retired skill', () => {
  const hits = [];
  for (const file of walk(SKILLS_DIR)) {
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (SLASH_RE.test(line) || BACKTICK_RE.test(line)) {
          hits.push(`${path.relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
        }
      });
  }
  assert.deepEqual(hits, [], `retired skill names found:\n${hits.join('\n')}`);
});
