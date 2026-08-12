// Tests for plugin/scripts/independence.mjs — the parallel-safety check (P5.1).
//
//   node --test tests/scripts/independence.test.mjs
//
// independence.mjs is a CLI, so it is exercised as a script that reads argv and files and
// exits with a status, never by importing a function it does not export. Most cases run it
// in a worker thread (`independence()`), which is the same file with the same argv, the same
// filesystem and the same exit code, and costs a fraction of a child process. The last block
// spawns it for real over a whole conflicting pair, so the claim that the worker is a
// faithful stand-in is paid for rather than assumed — the same split as runlog.test.mjs.
//
// The script never reads the working directory, so unlike runlog.test.mjs nothing here has to
// chdir or build a project anchor. Every fixture is a markdown file in a scratch directory.
//
// THE CASE THIS FILE EXISTS FOR is "a create-create collision on a file neither slice has
// created yet". It asserts the colliding path is absent from the repository first, because a
// check that only catches collisions on files already on disk is precisely the check that
// passed the pair in L-04.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const INDEPENDENCE = path.join(repoRoot, 'plugin', 'scripts', 'independence.mjs');

const scratch = [];
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* the OS reclaims it */
    }
  }
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aeo-independence-'));
  scratch.push(dir);
  return dir;
}

let counter = 0;

/** A slice source: a markdown file carrying one declaration block built from `lines`. */
function slice(...lines) {
  return raw(`# a slice plan\n\n\`\`\`aeo-independence\n${lines.join('\n')}\n\`\`\`\n\nProse after the block.\n`);
}

/** A slice source with hand-written content, for the malformed and no-block cases. */
function raw(text) {
  counter += 1;
  const file = path.join(tempDir(), `source-${counter}.md`);
  writeFileSync(file, text);
  return file;
}

/** Run independence.mjs in a worker thread. Same argv, same exit code and streams. */
async function independence(args) {
  return await new Promise((resolve) => {
    const worker = new Worker(INDEPENDENCE, { argv: args, stdout: true, stderr: true });
    let stdout = '';
    let stderr = '';
    worker.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    worker.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    worker.on('error', (err) => resolve({ status: 1, stdout, stderr: `${stderr}${err}` }));
    worker.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

// ---------------------------------------------------------------------------
// The five cases the slice is answerable for
// ---------------------------------------------------------------------------

describe('the verdict', () => {
  test('a genuinely disjoint pair is parallel-safe', async () => {
    const a = slice('slice: 13', 'edits: plugin/hooks/hooks.json', 'creates: plugin/scripts/independence.mjs');
    const b = slice('slice: 14', 'edits: docs/PLAN.md', 'creates: plugin/skills/status/SKILL.md');
    const r = await independence([a, b]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^parallel-safe/);
    assert.equal(r.stderr, '');
  });

  test('an edit-edit collision is caught and named', async () => {
    const a = slice('slice: 13', 'edits: package.json', 'creates: plugin/scripts/independence.mjs');
    const b = slice('slice: 14', 'edits: package.json', 'creates: plugin/scripts/other.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^NOT parallel-safe/);
    assert.match(r.stdout, /edit-edit\s+slices 13 and 14 both edit package\.json/);
  });

  test('a create-create collision on a file NEITHER slice has created yet is caught (L-04)', async () => {
    const planned = 'plugin/scripts/not-created-by-anyone-yet.mjs';
    assert.equal(
      existsSync(path.join(repoRoot, planned)),
      false,
      'this case is only meaningful while the colliding path is absent from the repository',
    );

    // No shared edited file, no dependency: the check L-04 describes clears this pair.
    const a = slice('slice: 13', 'edits: docs/PLAN.md', `creates: ${planned}`);
    const b = slice('slice: 14', 'edits: docs/DECISIONS.md', `creates: ${planned}`);
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a collision on a path neither slice has created yet was reported as safe');
    assert.match(r.stdout, new RegExp(`create-create\\s+slices 13 and 14 both create ${planned.replace(/[.]/g, '\\.')}`));
  });

  test('a declared dependency between two slices fails them as a pair', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs', 'depends-on: 13');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a dependent pair with no shared path was reported as safe');
    assert.match(r.stdout, /dependency\s+slice 14 depends on slice 13/);
  });

  test('an undeclared slice fails closed, with a message naming the slice', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a slice declaring nothing was treated as trivially disjoint');
    assert.match(r.stdout, /undeclared\s+slice 14 declares no paths/);
    assert.match(r.stdout, /undeclared, not disjoint/);
  });
});

// ---------------------------------------------------------------------------
// The taxonomy: which kind of collision, and between which slices
// ---------------------------------------------------------------------------

describe('collision taxonomy', () => {
  test('one slice editing what another creates is edit-create, edit side first', async () => {
    const a = slice('slice: 13', 'edits: plugin/scripts/shared.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/shared.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /edit-create\s+slice 13 edits plugin\/scripts\/shared\.mjs, which slice 14 creates/);
  });

  test('the edit side is named first regardless of argument order', async () => {
    const creator = slice('slice: 14', 'creates: plugin/scripts/shared.mjs');
    const editor = slice('slice: 13', 'edits: plugin/scripts/shared.mjs');
    const r = await independence([creator, editor]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /edit-create\s+slice 13 edits plugin\/scripts\/shared\.mjs, which slice 14 creates/);
  });

  test('three slices report only the pair that actually collides', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const c = slice('slice: 15', 'creates: plugin/scripts/a.mjs');
    const r = await independence([a, b, c]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /create-create\s+slices 13 and 15 both create plugin\/scripts\/a\.mjs/);
    assert.equal((r.stdout.match(/create-create/g) ?? []).length, 1, 'an uninvolved slice was dragged into the finding');
    assert.doesNotMatch(r.stdout, /slice 14 (?:and|depends)/);
  });

  test('a dependency naming a slice outside the set does not fail the set', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs', 'depends-on: 9');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 0, r.stdout);
  });

  test('`#13` and `13` are the same slice', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs', 'depends-on: #13');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a dependency written as #13 was not matched to slice 13');
    assert.match(r.stdout, /dependency\s+slice 14 depends on slice 13/);
  });
});

// ---------------------------------------------------------------------------
// Path comparison: exact, plus the two equivalences that are stated rather than guessed
// ---------------------------------------------------------------------------

describe('path comparison', () => {
  test('a path that contains another is a collision, because one cannot be both file and directory', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/newthing');
    const b = slice('slice: 14', 'creates: plugin/scripts/newthing/index.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a file declared inside a path another slice creates was reported as safe');
    assert.match(
      r.stdout,
      /create-create\s+slice 13 creates plugin\/scripts\/newthing, which contains plugin\/scripts\/newthing\/index\.mjs created by slice 14/,
    );
  });

  test('a trailing slash is not a distinction', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/newthing/');
    const b = slice('slice: 14', 'creates: plugin/scripts/newthing');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /create-create\s+slices 13 and 14 both create plugin\/scripts\/newthing/);
  });

  test('paths differing only in case collide, because on this filesystem they are one file', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/Widget.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/widget.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a case-only difference was treated as two different files');
    assert.match(r.stdout, /create-create/);
  });

  test('backslashes and a leading ./ are the same path as the plain form', async () => {
    const a = slice('slice: 13', 'creates: plugin\\scripts\\widget.mjs');
    const b = slice('slice: 14', 'creates: ./plugin/scripts/widget.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'two spellings of one path were treated as two files');
    // Only the finding line: the echo carries the source file's own OS-shaped path.
    const [finding] = r.stdout.split('\n').filter((l) => l.includes('create-create'));
    assert.match(finding, /slices 13 and 14 both create plugin\/scripts\/widget\.mjs$/);
  });

  test('a shared path prefix that is not a whole segment is not a collision', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/widget.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/widget-extra.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 0, r.stdout);
  });

  test('a slice that both edits and creates one path is refused', async () => {
    const a = slice('slice: 13', 'edits: plugin/scripts/a.mjs', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+slice 13 both edits and creates plugin\/scripts\/a\.mjs/);
  });
});

// ---------------------------------------------------------------------------
// Fail closed: every way a real path could go unseen is loud
// ---------------------------------------------------------------------------

describe('fail closed', () => {
  test('a source with no declaration block at all is undeclared, and is named', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = raw('# slice 14\n\nA plan that never says what it touches.\n');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a source with no block was treated as trivially disjoint');
    assert.match(r.stdout, /undeclared\s+.*source-\d+\.md carries no `aeo-independence` block/);
  });

  test('a typo in a key is refused rather than silently dropping the path', async () => {
    const a = slice('slice: 13', 'create: plugin/scripts/shared.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/shared.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a mistyped key silently discarded a declared path');
    assert.match(r.stdout, /malformed\s+.*unknown key "create"/);
  });

  test('a placeholder where a path belongs is refused', async () => {
    const a = slice('slice: 13', 'creates: none');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a placeholder counted as a declared path');
    assert.match(r.stdout, /malformed\s+.*is a placeholder, not a value/);
  });

  test('a comma-separated list is refused rather than read as one odd path', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs, plugin/scripts/b.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1, 'a comma list hid a real path from the comparison');
    assert.match(r.stdout, /malformed\s+.*one value per line/);
  });

  test('an absolute path is refused', async () => {
    const a = slice('slice: 13', 'creates: D:/AEO/plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/a.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+.*is absolute/);
  });

  test('a path escaping the repository root is refused', async () => {
    const a = slice('slice: 13', 'creates: ../elsewhere/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/a.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+.*escapes the repository root/);
  });

  test('a block with no slice id is refused, so its paths are never silently unattributed', async () => {
    const a = slice('creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+.*no `slice:` line/);
  });

  test('two declaration blocks in one source is a hard failure', async () => {
    const a = raw(
      '```aeo-independence\nslice: 13\ncreates: plugin/scripts/a.mjs\n```\n\n' +
        '```aeo-independence\nslice: 13\ncreates: plugin/scripts/b.mjs\n```\n',
    );
    const b = slice('slice: 14', 'creates: plugin/scripts/c.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+.*carries 2 `aeo-independence` blocks/);
  });

  test('an unterminated block is refused, because truncation is how a path goes missing', async () => {
    const a = raw('```aeo-independence\nslice: 13\ncreates: plugin/scripts/a.mjs\n');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+.*is never closed/);
  });

  test('a line that is not `key: value` is refused', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs', 'and also the widget module');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+.*is not `key: value`/);
  });

  test('a slice depending on itself is refused', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs', 'depends-on: 13');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /malformed\s+slice 13 depends on itself/);
  });

  test('two sources declaring the same slice id stop the run on stderr', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 13', 'creates: plugin/scripts/b.mjs');
    const r = await independence([a, b]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /both declare slice 13/);
  });

  test('fewer than two sources fails with usage on stderr', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const r = await independence([a]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /two or more slices/);
    assert.match(r.stderr, /usage/);
    assert.equal(r.stdout, '');
  });

  test('a source that does not exist fails on stderr rather than being counted as disjoint', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const r = await independence([a, path.join(os.tmpdir(), 'aeo-independence-no-such-file.md')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read/);
  });
});

// ---------------------------------------------------------------------------
// The report is evidence, not just a verdict
// ---------------------------------------------------------------------------

describe('the report', () => {
  test('both verdicts read back every path the check parsed (L-08)', async () => {
    const a = slice('slice: 13', 'edits: docs/PLAN.md', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const safe = await independence([a, b]);
    assert.equal(safe.status, 0, safe.stdout);
    for (const p of ['docs/PLAN.md', 'plugin/scripts/a.mjs', 'plugin/scripts/b.mjs']) {
      assert.ok(safe.stdout.includes(p), `${p} was parsed but never echoed`);
    }

    const c = slice('slice: 15', 'creates: plugin/scripts/a.mjs');
    const unsafe = await independence([a, c]);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stdout, /declared:/);
    assert.ok(unsafe.stdout.includes('docs/PLAN.md'), 'the failing report dropped the evidence echo');
  });

  test('the same input produces byte-identical output every run', async () => {
    const a = slice('slice: 13', 'edits: package.json', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'edits: package.json', 'creates: plugin/scripts/a.mjs');
    const first = await independence([a, b]);
    const second = await independence([a, b]);
    assert.equal(first.stdout, second.stdout, 'a deterministic check produced two different reports');
    assert.equal(first.status, second.status);
  });

  test('argument order does not change the verdict', async () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/a.mjs');
    const forward = await independence([a, b]);
    const reverse = await independence([b, a]);
    assert.equal(forward.status, 1);
    assert.equal(reverse.status, 1);
    assert.match(reverse.stdout, /create-create\s+slices 14 and 13 both create plugin\/scripts\/a\.mjs/);
  });
});

// ---------------------------------------------------------------------------
// The same script, as a real child process
//
// Everything above runs independence.mjs in a worker thread. This block runs it the way a
// planner does — `node independence.mjs a.md b.md` — over the safe case and over L-04's own
// case, so the claim that the worker is a faithful stand-in is paid for. If a case above ever
// passes while the matching case here fails, the worker is the thing that is wrong.
// ---------------------------------------------------------------------------

describe('as a real child process', () => {
  function spawnIndependence(args) {
    const r = spawnSync(process.execPath, [INDEPENDENCE, ...args], { encoding: 'utf8', windowsHide: true });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  }

  test('a disjoint pair exits 0 with the verdict on stdout', () => {
    const a = slice('slice: 13', 'creates: plugin/scripts/a.mjs');
    const b = slice('slice: 14', 'creates: plugin/scripts/b.mjs');
    const r = spawnIndependence([a, b]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^parallel-safe/);
    assert.equal(r.stderr, '');
  });

  test("L-04's own pair exits 1 and names the path neither slice had created yet", () => {
    const a = slice('slice: 13', 'edits: docs/PLAN.md', 'creates: plugin/scripts/still-not-created.mjs', 'creates: tests/scripts/still-not-created.test.mjs');
    const b = slice('slice: 14', 'edits: docs/DECISIONS.md', 'creates: plugin/scripts/still-not-created.mjs');
    assert.equal(existsSync(path.join(repoRoot, 'plugin', 'scripts', 'still-not-created.mjs')), false);

    const r = spawnIndependence([a, b]);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /create-create\s+slices 13 and 14 both create plugin\/scripts\/still-not-created\.mjs/);
    assert.equal(r.stderr, '');
  });
});
