// Every SKILL.md under plugin/skills/ ships frontmatter a real YAML parser can read.
//
// Issue #48: monitor-design's description held a colon-space (": ") inside an unquoted
// plain scalar — text that reads fine to a person but is not legal YAML, because an
// unquoted ": " opens a nested mapping. `claude plugin validate --strict` rejected the
// whole frontmatter block and the skill loaded with no name and no description: nothing
// could trigger it by description, and nothing could name it. It shipped in Phase 3 and
// nothing checked the other thirteen SKILL.md files either. This test is that sweep.
//
// The repo carries no YAML library, and CLAUDE.md requires founder approval before adding
// one. evals/grade-plugin.mjs already reads frontmatter with a free-text `key: rest of
// line` split — deliberately not a YAML parser — and that is exactly why it missed this:
// a line-split reader is happy to take "everything after the first colon" as the value,
// colons and all, so it never notices the same line is illegal to a real YAML parser.
//
// This test does not reimplement YAML either. It asserts the narrow rule that broke
// loading here: a plain (unquoted) scalar cannot contain ": ", cannot contain " #" (which
// opens a comment mid-value and silently truncates it), and cannot end in a bare ":". A
// value quoted with a single matching pair of " or ' is exempt — quoting is the fix.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const SKILLS_DIR = path.join(repoRoot, 'plugin', 'skills');

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]?(.*)$/;

/** Every plugin/skills/<name>/SKILL.md that exists on disk, in directory order. */
function listSkillFiles() {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(SKILLS_DIR, e.name, 'SKILL.md'))
    .filter((f) => {
      try {
        return statSync(f).isFile();
      } catch {
        return false;
      }
    });
}

/**
 * Would a real YAML parser reject `raw` as a plain (unquoted) scalar? Returns a
 * human-readable reason, or null when the value is fine. Deliberately narrow: this checks
 * only the malformations a single `key: value` frontmatter line can actually hit, not
 * general YAML grammar (an over-engineering tripwire per CLAUDE.md — a hand-rolled YAML
 * parser is not the job here, a check for the specific failure that shipped is).
 */
function plainScalarError(raw) {
  const isDoubleQuoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2;
  const isSingleQuoted = raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2;
  if (isDoubleQuoted || isSingleQuoted) return null;

  if (raw.startsWith('"') || raw.startsWith("'")) {
    return 'starts with a quote character it never closes';
  }
  if (raw.includes(': ')) {
    return 'contains ": " in an unquoted value — YAML reads this as opening a nested mapping key (issue #48)';
  }
  if (raw.endsWith(':')) {
    return 'ends with a bare ":" in an unquoted value — YAML reads this as a dangling mapping key';
  }
  if (raw.includes(' #')) {
    return 'contains " #" in an unquoted value — YAML reads this as a comment, truncating the value';
  }
  return null;
}

/** A flat { fields, errors } reading of one SKILL.md's frontmatter block. */
function parseFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return { present: false, fields: {}, errors: [] };
  const fields = {};
  const errors = [];
  for (const line of m[1].split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const km = KEY_LINE_RE.exec(line);
    if (!km) {
      errors.push(`unparseable frontmatter line: ${JSON.stringify(line)}`);
      continue;
    }
    const [, key, rawValue] = km;
    const trimmed = rawValue.trim();
    const err = plainScalarError(trimmed);
    if (err) errors.push(`"${key}" ${err}`);
    fields[key] = trimmed;
  }
  return { present: true, fields, errors };
}

describe('every plugin skill ships frontmatter a real YAML parser can read (issue #48)', () => {
  const files = listSkillFiles();

  test('the sweep found at least one SKILL.md to check', () => {
    // A hardcoded count would go stale the moment a skill is added or removed. What
    // matters here is that the sweep isn't silently scanning zero files.
    assert.ok(files.length > 0, `no SKILL.md files found under ${SKILLS_DIR}`);
  });

  for (const file of listSkillFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');

    test(`${rel} frontmatter parses and declares name + description`, () => {
      const text = readFileSync(file, 'utf8');
      const { present, fields, errors } = parseFrontmatter(text);

      assert.ok(present, `${rel}: no --- frontmatter block found`);
      assert.deepEqual(errors, [], `${rel}: ${errors.join('; ')}`);

      assert.equal(typeof fields.name, 'string', `${rel}: no "name" field in frontmatter`);
      assert.notEqual(fields.name, '', `${rel}: "name" is empty`);

      assert.equal(
        typeof fields.description,
        'string',
        `${rel}: no "description" field in frontmatter`,
      );
      assert.notEqual(fields.description, '', `${rel}: "description" is empty`);
    });
  }
});
