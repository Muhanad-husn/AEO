// The byte-identical claim in plugin/VENDORED.md, checked against the files it names.
//
// VENDORED.md drifted because nothing read it. It was written before the Phase 2 port and
// named four files as byte-identical with upstream; three of them had been rewritten,
// including both .mjs scripts. A maintainer following its re-sync procedure would have
// re-copied upstream over adapted code and lost the adaptations without a symptom.
//
// This is not a test of prose. It is a test of one factual claim the prose makes, over
// files that exist on disk, and it fails the moment a listed file stops matching upstream.
//
// One direction only. A file that becomes identical without being listed is a stale table
// row nobody was harmed by; a file listed as identical that is not is the failure mode
// that already happened.
//
// It reads source/, which is repository reference material and does not ship with the
// plugin. That is intended: the claim under test is one this repository makes about its
// own vendoring, not something an installed plugin can check for itself.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const MANIFEST = path.join(repoRoot, 'plugin', 'VENDORED.md');
const PLUGIN_SKILLS = path.join(repoRoot, 'plugin', 'skills');
const UPSTREAM_SKILLS = path.join(repoRoot, 'source', 'upstream-red-green-refactor', 'dot-claude', 'skills');

// The heading VENDORED.md puts above the table, and the row shape under it: a first cell
// holding nothing but a backticked path. The header row and the `---` separator do not
// match, so no row filter beyond this one is needed. Scoping to the section is what keeps
// the diverged table's rows, which look the same, out of the result.
const SECTION_HEADING = '## Byte-identical with upstream';
const ROW_RE = /^\|\s*`([^`]+)`\s*\|/;

/** The paths listed in the byte-identical table, relative to a skill directory. */
function identicalPaths(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === SECTION_HEADING);
  assert.notEqual(start, -1, `plugin/VENDORED.md has no "${SECTION_HEADING}" section`);

  const paths = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const m = ROW_RE.exec(line);
    if (m) paths.push(m[1].trim());
  }
  return paths;
}

describe('the byte-identical table in plugin/VENDORED.md', () => {
  test('parses to at least one row', () => {
    // A table the parser silently reads as zero rows passes every assertion below
    // vacuously, which is how this file came to be wrong in the first place.
    const paths = identicalPaths(readFileSync(MANIFEST, 'utf8'));
    assert.ok(paths.length > 0, 'no rows parsed out of the byte-identical table');
  });

  test('every listed file is byte-identical with its upstream copy', () => {
    for (const rel of identicalPaths(readFileSync(MANIFEST, 'utf8'))) {
      const parts = rel.split('/');
      const shipped = readFileSync(path.join(PLUGIN_SKILLS, ...parts));
      const upstream = readFileSync(path.join(UPSTREAM_SKILLS, ...parts));
      assert.ok(
        shipped.equals(upstream),
        `${rel} is listed as byte-identical with upstream but differs from it`,
      );
    }
  });
});
