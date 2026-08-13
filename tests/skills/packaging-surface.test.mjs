// A drift alarm for the packaging surface: both manifests and the README's stated
// prerequisite. Not a documentation linter — it does not pin wording, only the load-
// bearing facts a stranger deciding whether to install this plugin depends on.
//
// Issue #34's VENDORED.md is the precedent this follows: a claim nobody checked drifted
// silently for weeks. Nothing here previously checked that `plugin.json` still declares
// its own `version` (C-09: omit it and the git SHA becomes the version, so every commit
// looks new to a user), that either manifest still carries `$schema`, or that the README
// still says a hook that can't start Node fails open (D8) rather than just going quiet.
//
// Scope is deliberately narrow (P7.1): version and $schema on the manifests, and the
// node prerequisite in the README. Nothing about prose, section order, or the rest of
// the README's content is asserted here — except the merge-rule check added for
// issue #62 below, which is the same kind of drift alarm applied to a second claim.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const PLUGIN_MANIFEST_PATH = path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json');
const MARKETPLACE_MANIFEST_PATH = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
const PACKAGE_JSON_PATH = path.join(repoRoot, 'package.json');
const README_PATH = path.join(repoRoot, 'README.md');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

describe('the plugin manifest declares what C-09 requires', () => {
  test('plugin.json sets version explicitly', () => {
    const manifest = readJson(PLUGIN_MANIFEST_PATH);
    // C-09: omit version and the installed git SHA is used instead, so every commit
    // reads as a new version to whoever installed it. A present-but-empty string is the
    // same failure with a passing typeof check, so this asserts non-empty too.
    assert.equal(typeof manifest.version, 'string');
    assert.notEqual(manifest.version.trim(), '');
  });

  test('plugin.json carries $schema', () => {
    const manifest = readJson(PLUGIN_MANIFEST_PATH);
    assert.equal(typeof manifest.$schema, 'string');
    assert.notEqual(manifest.$schema.trim(), '');
  });
});

describe('the version has exactly one copy (D27)', () => {
  // Two manifests both carried `0.1.0` until the v0.1.0 release. Neither read the
  // other, nothing checked they agreed, and a second copy that drifts is the defect
  // class the actor-cap file and the risk rubric each exist to prevent. `plugin.json`
  // must keep its copy (C-09, above). So `package.json` gives its up: the package is
  // private and never published, and npm asks for a version only when publishing.

  test('package.json declares no version', () => {
    const pkg = readJson(PACKAGE_JSON_PATH);
    assert.equal(
      pkg.version,
      undefined,
      'package.json declares a version again; plugin.json is the only place it belongs',
    );
  });

  test('package.json is private, which is what makes the omission legal', () => {
    // Without `private: true` npm treats a missing version as an error on install of
    // this tree as a dependency. Dropping the flag would make the omission a bug.
    assert.equal(readJson(PACKAGE_JSON_PATH).private, true);
  });

  test('package.json says why it has no version, so the next reader does not re-add one', () => {
    assert.match(readJson(PACKAGE_JSON_PATH).description ?? '', /version/i);
  });
});

describe('the marketplace manifest declares what C-09 requires', () => {
  test('marketplace.json carries $schema', () => {
    const manifest = readJson(MARKETPLACE_MANIFEST_PATH);
    assert.equal(typeof manifest.$schema, 'string');
    assert.notEqual(manifest.$schema.trim(), '');
  });

  test('marketplace.json still resolves the aeo plugin to the local ./plugin source', () => {
    // C-09: an entry needs only name and source, a relative path when the plugin lives
    // in the same repo. This is the fact a clean clone depends on to install at all.
    const manifest = readJson(MARKETPLACE_MANIFEST_PATH);
    const entry = (manifest.plugins ?? []).find((p) => p.name === 'aeo');
    assert.ok(entry, 'marketplace.json lists no "aeo" plugin entry');
    assert.equal(entry.source, './plugin');
  });
});

describe('the README states the node prerequisite (D8)', () => {
  test('names Node 18 as the requirement', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.match(readme, /node\s*18/i);
  });

  test('says what happens when a gate can\'t start it: fails open', () => {
    // The load-bearing sentence, not an incidental mention of the word "node" — a
    // reader who misses this installs a plugin that silently guards nothing (D8).
    const readme = readFileSync(README_PATH, 'utf8');
    assert.match(readme, /fails open/i);
  });
});

describe('the README states the merge rule block-merge.mjs actually enforces (issue #62)', () => {
  // block-merge.mjs's own F5 comment: the gate enforces on `isAnyAeoRole` — this
  // plugin's three roles (builder, reviewer, triage) — and nothing else, because C-02
  // forbids matching on bare `agent_type` presence. That exempts the founder's own
  // session, which is exactly the path sprint-start's wrap-up brief describes: "The
  // orchestrator merges only on the founder's explicit approval, never before and
  // never on its own judgment." A README claiming no path exists anywhere in the
  // plugin contradicts both; this pins the narrower claim the code and the skill agree on.

  test('does not repeat the old absolute claim that no path exists anywhere in the plugin', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    assert.doesNotMatch(readme, /nothing in this plugin has a path to/i);
  });

  test("names the roles that have no merge path, and that the founder's own approved session does merge", () => {
    const readme = readFileSync(README_PATH, 'utf8');
    const section = readme.slice(readme.indexOf('## Who merges'));
    assert.notEqual(readme.indexOf('## Who merges'), -1, 'README has no "Who merges" section');
    assert.match(section, /builder/i);
    assert.match(section, /review/i);
    assert.match(section, /triage/i);
    assert.match(section, /approv/i);
  });
});
