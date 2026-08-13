// The commands `new-project` hardcodes are commands, not prose, so their flags get a test.
//
//   node --test tests/skills/new-project-commands.test.mjs
//
// D20 says skills are prose and prose does not get unit tests, on the grounds that
// asserting on text pins wording that is expected to change. A `gh api` flag letter is not
// wording. Stage 0 step 7 hands the agent a filled-in command and tells it to run that
// command rather than compose one, so those flags are shipped behaviour, and whether each
// is right is decided by GitHub's schema rather than by an author's taste. Nothing here
// asserts a sentence.
//
// Checkpoint 6's live run is why this file exists. The branch-protection call shipped
// `-f 'required_pull_request_reviews[required_approving_review_count]=0'`. `gh api -f`
// sends every value as a string, the API types that field as an integer, and the call came
// back HTTP 422 having set nothing — for every project, not only that one. The suite could
// not see the defect because it could not see the command: the slice's other test,
// tests/skills/new-project-scaffold.test.mjs, walks scaffold-plan.json and asserts the
// emitted tree, and the plan holds no commands.
//
// Scope is exactly the fields the skill actually sends. Modelling GitHub's type schema in
// general would be an abstraction with one implementation, which CLAUDE.md names as a
// tripwire. The list below is a fixture rather than a model, and it fails loudly rather
// than vacuously: each field has to be present in the shipped command as well as correctly
// flagged, so renaming or dropping one turns the test red instead of green.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

const SKILL_PATH = path.resolve(
  import.meta.dirname,
  '../../plugin/skills/new-project/SKILL.md',
);

/**
 * The non-string fields the skill's `gh api` calls send today, with the GitHub type that
 * makes `-f` wrong for each. `gh api -f` sends a string; `-F` sends the typed value, and
 * parses `true`, `false`, `null` and integer literals as themselves.
 */
const TYPED_FIELDS = [
  {
    field: 'required_pull_request_reviews[required_approving_review_count]',
    type: 'integer',
  },
  { field: 'enforce_admins', type: 'boolean' },
  { field: 'required_status_checks', type: 'null' },
  { field: 'restrictions', type: 'null' },
];

const source = readFileSync(SKILL_PATH, 'utf8');

/** Every fenced code block in the file, as raw text. */
function fencedBlocks(text) {
  const blocks = [];
  const re = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm;
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  return blocks;
}

/**
 * The `-f`/`-F` field assignments inside every fenced block that invokes `gh api`, as
 * `{ field, flag }`. Quoting around the assignment is optional and does not change the
 * meaning of the flag, so it is stripped rather than asserted on.
 */
function apiFieldFlags(text) {
  const found = [];
  for (const block of fencedBlocks(text)) {
    if (!/\bgh\s+api\b/.test(block)) continue;
    const re = /(?:^|\s)-([fF])\s+['"]?([^\s'"=]+)=/g;
    let m;
    while ((m = re.exec(block)) !== null) found.push({ flag: m[1], field: m[2] });
  }
  return found;
}

const flags = apiFieldFlags(source);

describe('new-project ships a gh api call for this test to be about', () => {
  test('at least one fenced block invokes gh api', () => {
    // Without this the per-field checks below could pass by finding nothing at all, which
    // is the zero-that-means-not-measured failure L-08 keeps naming.
    const blocks = fencedBlocks(source).filter((b) => /\bgh\s+api\b/.test(b));
    assert.ok(
      blocks.length > 0,
      'no fenced code block in new-project/SKILL.md invokes `gh api`. If the command moved, ' +
        'move this test with it; if it was removed, remove this file.',
    );
  });

  test('it sends field assignments this test can read', () => {
    assert.ok(
      flags.length > 0,
      'a `gh api` block exists but no -f/-F field assignment was parsed out of it. The ' +
        'command changed shape and this test stopped checking anything.',
    );
  });
});

describe('every non-string field in a gh api call uses -F, not -f', () => {
  for (const { field, type } of TYPED_FIELDS) {
    test(`${field} (${type})`, () => {
      const matches = flags.filter((f) => f.field === field);
      assert.ok(
        matches.length > 0,
        `new-project/SKILL.md sends no \`${field}\` in any gh api call. Either the command ` +
          'changed and this fixture is stale, or a protection property was dropped.',
      );
      for (const match of matches) {
        assert.equal(
          match.flag,
          'F',
          `\`${field}\` is sent with -f. gh api -f sends the value as a string, and the ` +
            `GitHub API types this field as ${type}, so the request is rejected with HTTP ` +
            '422 and nothing is set. Use -F.',
        );
      }
    });
  }
});
