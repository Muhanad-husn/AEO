// Tests for plugin/skills/sprint-start/scripts/plan-actors.mjs, and for the one property
// the actor cap has to hold: it is written down once.
//
//   node --test tests/skills/plan-actors.test.mjs
//
// Three questions the concurrency step has to answer before it dispatches anybody, and all
// three have oracles, which is why they are here rather than left to agent judgment: is the
// group within the cap, are the slices mutually disjoint, and is a branch or worktree path
// already held. The middle one is delegated whole to independence.mjs, so what is tested
// here is that plan-actors actually runs it and actually refuses on its verdict — a
// delegated check that is never reached is the same as no check.
//
// The CLI is spawned against a real temp git repository rather than a mocked git, matching
// the pattern the hook tests set. `git worktree list` is the thing being trusted, so
// nothing about it is faked.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CAP_FILE, parseWorktreeList, planActors, readCap } from '../../plugin/skills/sprint-start/scripts/plan-actors.mjs';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugin');
const SCRIPT = path.join(pluginRoot, 'skills', 'sprint-start', 'scripts', 'plan-actors.mjs');
const SKILL = path.join(pluginRoot, 'skills', 'sprint-start', 'SKILL.md');
const CAP_REF = 'skills/sprint-start/references/actor-cap.md';

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

function tempDir(prefix = 'aeo-p53-') {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr ?? r.error}`);
  return (r.stdout ?? '').trim();
}

/** A repository with one commit, so `git worktree list` has something to report. */
function makeRepo() {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'aeo-test');
  git(dir, 'config', 'user.email', 'aeo-test@example.invalid');
  git(dir, 'config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, '.gitkeep'), '');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

/** An issue body carrying one declaration block, written to disk the way the lane writes it. */
function sliceSource(dir, slice, creates) {
  const file = path.join(dir, `${slice}.md`);
  const fence = '`'.repeat(3);
  writeFileSync(
    file,
    [`Slice ${slice}.`, '', `${fence}aeo-independence`, `slice: ${slice}`, ...creates.map((c) => `creates: ${c}`), fence, ''].join('\n'),
  );
  return file;
}

function runCli(cwd, actors) {
  const args = actors.flatMap((a) => ['--actor', a.source, a.branch, a.worktree]);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Every file under `dir`, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const kinds = (findings) => findings.map((f) => f.kind).sort();

// ---------------------------------------------------------------------------
// The cap, in one place, labelled
// ---------------------------------------------------------------------------

describe('the actor cap', () => {
  test('is readable from the one file that states it', () => {
    const { cap, error } = readCap();
    assert.equal(error, undefined);
    assert.ok(Number.isInteger(cap) && cap >= 1, `cap is not a number of actors: ${cap}`);
  });

  test('is labelled a founder-set operating parameter, not a tuned constant', () => {
    const text = readFileSync(CAP_FILE, 'utf8');
    assert.match(text, /founder-set operating parameter/i);
    assert.match(text, /not a tuned constant|tuned/i);
  });

  test('is not defaulted when the statement is missing', () => {
    // A default here would be a second copy of the number, which is the whole defect.
    const dir = tempDir();
    const file = path.join(dir, 'no-cap.md');
    writeFileSync(file, '# nothing here\n\nDevelopment actors are capped.\n');
    const { cap, error } = readCap(file);
    assert.equal(cap, undefined);
    assert.match(error, /no .*Development actors.* line|not defaulted/i);
  });

  test('no other file in the plugin states the number', () => {
    // Normative statements of the value only. Illustrative prose ("four actors in four
    // worktrees", in independence.mjs's header) is not a second definition, and the point
    // of the rule is that nothing else can drift out of step with the cap file.
    const NORMATIVE = /capped at (?:four|4)\b|cap of (?:four|4)\b|(?:at most|maximum of|up to) (?:four|4) (?:development )?actors|^\*\*Development actors:\s*\d+\*\*/im;
    const offenders = [];
    for (const file of walk(pluginRoot)) {
      if (path.resolve(file) === path.resolve(CAP_FILE)) continue;
      const m = NORMATIVE.exec(readFileSync(file, 'utf8'));
      if (m) offenders.push(`${path.relative(repoRoot, file)}: ${m[0]}`);
    }
    assert.deepEqual(offenders, [], `a second statement of the cap exists: ${offenders.join(' | ')}`);
  });

  test('is reached by the lane through ${CLAUDE_PLUGIN_ROOT}, so an installed session resolves it', () => {
    assert.ok(readFileSync(SKILL, 'utf8').includes(`\${CLAUDE_PLUGIN_ROOT}/${CAP_REF}`), `sprint-start does not point at ${CAP_REF}`);
  });
});

// ---------------------------------------------------------------------------
// Selection honours the cap
// ---------------------------------------------------------------------------

describe('group selection', () => {
  const actor = (n) => ({ source: `/tmp/${n}.md`, branch: `feat/sprint/${n}`, worktree: `/tmp/wt/${n}` });

  test('a group at the cap is clean', () => {
    const { cap } = readCap();
    const actors = Array.from({ length: cap }, (_, i) => actor(i + 1));
    assert.deepEqual(planActors({ actors, cap, held: [] }).findings, []);
  });

  test('one over the cap is refused, and the refusal names the cap as a founder parameter', () => {
    const { cap } = readCap();
    const actors = Array.from({ length: cap + 1 }, (_, i) => actor(i + 1));
    const { findings } = planActors({ actors, cap, held: [] });
    assert.deepEqual(kinds(findings), ['over-cap']);
    assert.match(findings[0].text, /founder-set operating parameter/i);
    assert.match(findings[0].text, /actor-cap\.md/);
  });

  test('an empty group is refused rather than treated as trivially safe (L-05)', () => {
    assert.deepEqual(kinds(planActors({ actors: [], cap: 4, held: [] }).findings), ['empty']);
  });
});

// ---------------------------------------------------------------------------
// A second actor never lands on a held branch or worktree path
// ---------------------------------------------------------------------------

describe('branch and worktree assignment', () => {
  const cap = 4;

  test('two actors on one branch are refused', () => {
    const actors = [
      { source: 'a.md', branch: 'feat/x', worktree: '/tmp/wt/a' },
      { source: 'b.md', branch: 'feat/x', worktree: '/tmp/wt/b' },
    ];
    const { findings } = planActors({ actors, cap, held: [] });
    assert.deepEqual(kinds(findings), ['duplicate-branch']);
    assert.match(findings[0].text, /b\.md and a\.md/);
  });

  test('two actors on one worktree path are refused', () => {
    const actors = [
      { source: 'a.md', branch: 'feat/a', worktree: '/tmp/wt/shared' },
      { source: 'b.md', branch: 'feat/b', worktree: '/tmp/wt/shared' },
    ];
    assert.deepEqual(kinds(planActors({ actors, cap, held: [] }).findings), ['duplicate-worktree']);
  });

  test('a worktree path inside another actor\'s is refused', () => {
    const actors = [
      { source: 'a.md', branch: 'feat/a', worktree: '/tmp/wt' },
      { source: 'b.md', branch: 'feat/b', worktree: '/tmp/wt/b' },
    ];
    assert.deepEqual(kinds(planActors({ actors, cap, held: [] }).findings), ['duplicate-worktree']);
  });

  test('case alone does not make two assignments distinct', () => {
    // One directory on Windows and on macOS, and git's loose refs collide the same way.
    const actors = [
      { source: 'a.md', branch: 'feat/X', worktree: '/tmp/wt/A' },
      { source: 'b.md', branch: 'feat/x', worktree: '/tmp/wt/a' },
    ];
    assert.deepEqual(kinds(planActors({ actors, cap, held: [] }).findings), ['duplicate-branch', 'duplicate-worktree']);
  });

  test('a branch already checked out elsewhere is refused', () => {
    const actors = [{ source: 'a.md', branch: 'feat/x', worktree: '/tmp/wt/a' }];
    const held = [{ path: '/tmp/wt/other', branch: 'feat/x' }];
    const { findings } = planActors({ actors, cap, held });
    assert.deepEqual(kinds(findings), ['branch-held']);
    assert.match(findings[0].text, /already checked out at/);
  });

  test('a worktree path that is already a worktree is refused', () => {
    const actors = [{ source: 'a.md', branch: 'feat/x', worktree: '/tmp/wt/a' }];
    const held = [{ path: '/tmp/wt/a', branch: 'feat/other' }];
    assert.deepEqual(kinds(planActors({ actors, cap, held }).findings), ['worktree-held']);
  });

  test('a worktree path inside an existing checkout is refused', () => {
    const actors = [{ source: 'a.md', branch: 'feat/x', worktree: '/tmp/main/sub/a' }];
    const held = [{ path: '/tmp/main', branch: 'main' }];
    assert.deepEqual(kinds(planActors({ actors, cap, held }).findings), ['worktree-held']);
  });
});

describe('what git reports', () => {
  test('a detached worktree still holds its path', () => {
    const held = parseWorktreeList('worktree /tmp/a\nHEAD abc\nbranch refs/heads/main\n\nworktree /tmp/b\nHEAD def\ndetached\n');
    assert.deepEqual(held, [
      { path: '/tmp/a', branch: 'main' },
      { path: '/tmp/b', branch: null },
    ]);
  });
});

// ---------------------------------------------------------------------------
// The independence check is actually reached, and its verdict is actually honoured
// ---------------------------------------------------------------------------

describe('the independence check', () => {
  test('a disjoint pair is dispatchable', () => {
    const repo = makeRepo();
    const sources = tempDir();
    const actors = [
      { source: sliceSource(sources, '13', ['plugin/scripts/a.mjs']), branch: 'feat/13', worktree: path.join(sources, 'wt13') },
      { source: sliceSource(sources, '14', ['plugin/scripts/b.mjs']), branch: 'feat/14', worktree: path.join(sources, 'wt14') },
    ];
    const r = runCli(repo, actors);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^dispatchable:/);
    assert.match(r.stdout, /parallel-safe/);
  });

  test('a colliding pair is refused, and the collision is reported rather than trimmed away', () => {
    const repo = makeRepo();
    const sources = tempDir();
    const actors = [
      { source: sliceSource(sources, '13', ['plugin/scripts/widget.mjs']), branch: 'feat/13', worktree: path.join(sources, 'wt13') },
      { source: sliceSource(sources, '14', ['plugin/scripts/widget.mjs']), branch: 'feat/14', worktree: path.join(sources, 'wt14') },
    ];
    const r = runCli(repo, actors);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^NOT dispatchable:/);
    // The whole report, so the founder sees which two slices collide on which path.
    assert.match(r.stdout, /create-create/);
    assert.match(r.stdout, /slices 13 and 14 both create plugin\/scripts\/widget\.mjs/);
    // Both actors are still listed. A group that fails is reported, never silently reduced
    // to the subset that would have passed.
    assert.match(r.stdout, /feat\/13/);
    assert.match(r.stdout, /feat\/14/);
  });

  test('an undeclared slice is refused, not read as disjoint', () => {
    const repo = makeRepo();
    const sources = tempDir();
    const bare = path.join(sources, 'nodecl.md');
    writeFileSync(bare, 'An issue body with no declaration block.\n');
    const actors = [
      { source: sliceSource(sources, '13', ['plugin/scripts/a.mjs']), branch: 'feat/13', worktree: path.join(sources, 'wt13') },
      { source: bare, branch: 'feat/14', worktree: path.join(sources, 'wt14') },
    ];
    const r = runCli(repo, actors);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /undeclared/);
  });

  test('one actor says the check was skipped rather than passed', () => {
    const repo = makeRepo();
    const sources = tempDir();
    const actors = [{ source: sliceSource(sources, '13', ['plugin/scripts/a.mjs']), branch: 'feat/13', worktree: path.join(sources, 'wt13') }];
    const r = runCli(repo, actors);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /independence: not run/);
    assert.match(r.stdout, /skip, not a pass/);
  });

  test('a real held branch stops the dispatch, read from git rather than assumed', () => {
    const repo = makeRepo();
    const sources = tempDir();
    const wt = path.join(sources, 'held');
    mkdirSync(path.dirname(wt), { recursive: true });
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/13', wt);

    const actors = [
      { source: sliceSource(sources, '13', ['plugin/scripts/a.mjs']), branch: 'feat/13', worktree: path.join(sources, 'wt13') },
      { source: sliceSource(sources, '14', ['plugin/scripts/b.mjs']), branch: 'feat/14', worktree: path.join(sources, 'wt14') },
    ];
    const r = runCli(repo, actors);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /branch-held/);
    // The slices themselves were fine; the refusal is operational, and both are reported.
    assert.match(r.stdout, /parallel-safe/);
  });
});
