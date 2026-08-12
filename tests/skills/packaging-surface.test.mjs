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
// the README's content is asserted here.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');

const PLUGIN_MANIFEST_PATH = path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json');
const MARKETPLACE_MANIFEST_PATH = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
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
