// Tests for plugin/scripts/worktree-links.mjs (issue #252).
//
//   node --test tests/scripts/worktree-links.test.mjs
//
// A run slice reads and writes git-ignored directories (data/, runs/) that exist only in
// the main checkout. The script links them into a worktree and unlinks them before the
// worktree is removed, because `git worktree remove` follows a junction and deletes the
// target's contents. Every case builds a temp git repo and a temp worktree in the OS temp
// directory. No consumer project is touched.

import { spawnSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const SCRIPT = path.resolve(import.meta.dirname, '../../plugin/scripts/worktree-links.mjs');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'worktree-links-'));
let counter = 0;

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

/** A main checkout with one commit and the given .gitignore, plus a worktree `w`. */
function fixture({ ignore = 'data/\nruns/\n', name = 'w' } = {}) {
  const dir = path.join(scratch, `case-${counter++}`);
  const main = path.join(dir, 'main');
  mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.email', 't@example.com');
  git(main, 'config', 'user.name', 't');
  writeFileSync(path.join(main, '.gitignore'), ignore);
  writeFileSync(path.join(main, 'README.md'), 'x\n');
  git(main, 'add', '-A');
  git(main, 'commit', '-q', '-m', 'init');
  const wt = addWorktree(main, dir, name);
  return { dir, main, wt };
}

function addWorktree(main, dir, name) {
  const wt = path.join(dir, name);
  git(main, 'worktree', 'add', '-q', '-b', `b-${name}`, wt);
  return wt;
}

function script(cmd, wt, links) {
  const env = { ...process.env };
  delete env.AEO_WORKTREE_LINKS;
  if (links !== undefined) env.AEO_WORKTREE_LINKS = links;
  return spawnSync(process.execPath, [SCRIPT, cmd, wt], { encoding: 'utf8', env, windowsHide: true });
}

const isLink = (p) => lstatSync(p).isSymbolicLink();

test('1. link shares data/ and runs/ with the main checkout', () => {
  const { main, wt } = fixture();
  mkdirSync(path.join(main, 'data'));
  mkdirSync(path.join(main, 'runs'));
  writeFileSync(path.join(main, 'data', 'in.txt'), 'input');
  const r = script('link', wt, 'data,runs');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(wt, 'data', 'in.txt'), 'utf8'), 'input');
  mkdirSync(path.join(wt, 'runs', 'x'), { recursive: true });
  writeFileSync(path.join(wt, 'runs', 'x', 'a.txt'), 'out');
  assert.equal(readFileSync(path.join(main, 'runs', 'x', 'a.txt'), 'utf8'), 'out');
});

test('2. the link is a junction on Windows and a symlink elsewhere, with no elevation', (t) => {
  const { main, wt } = fixture();
  mkdirSync(path.join(main, 'data'));
  const r = script('link', wt, 'data');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(isLink(path.join(wt, 'data')));
  if (process.platform === 'win32') {
    const dir = spawnSync('cmd', ['/c', 'dir', '/AL', wt], { encoding: 'utf8', windowsHide: true });
    assert.match(dir.stdout, /<JUNCTION>\s+data\b/);
  } else {
    t.diagnostic('symlink case; the junction assertion runs on Windows only');
  }
});

test('3. git status in the worktree is empty after link, and git add stages nothing under it', () => {
  const { main, wt } = fixture();
  mkdirSync(path.join(main, 'data'));
  mkdirSync(path.join(main, 'runs'));
  writeFileSync(path.join(main, 'data', 'in.txt'), 'input');
  assert.equal(script('link', wt, 'data,runs').status, 0);
  assert.equal(git(wt, 'status', '--short').trim(), '');
  git(wt, 'add', '-A');
  assert.equal(git(wt, 'diff', '--cached', '--name-only').trim(), '');
});

test('4. a trailing-slash ignore pattern still leaves status empty, via the local exclude', () => {
  const { main, wt } = fixture({ ignore: 'data/\n' });
  mkdirSync(path.join(main, 'data'));
  writeFileSync(path.join(main, 'data', 'in.txt'), 'input');
  assert.equal(script('link', wt, 'data').status, 0);
  assert.equal(git(wt, 'status', '--short').trim(), '');
  git(wt, 'add', '-A');
  assert.equal(git(wt, 'diff', '--cached', '--name-only').trim(), '');
});

test('5. a declared path that is not git-ignored fails, creates nothing, and is named', () => {
  const { main, wt } = fixture({ ignore: 'data/\n' });
  mkdirSync(path.join(main, 'data'));
  const r = script('link', wt, 'data,notes');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /notes/);
  assert.equal(existsSync(path.join(wt, 'data')), false, 'the ignored path must not be linked either');
  assert.equal(existsSync(path.join(wt, 'notes')), false);
  assert.equal(existsSync(path.join(main, 'notes')), false);
});

test('6. unlink then git worktree remove leaves every file in the main data/ and runs/', () => {
  const { main, wt } = fixture();
  mkdirSync(path.join(main, 'data'));
  mkdirSync(path.join(main, 'runs'));
  writeFileSync(path.join(main, 'data', 'k.txt'), 'keep');
  assert.equal(script('link', wt, 'data,runs').status, 0);
  mkdirSync(path.join(wt, 'runs', 'r1'));
  writeFileSync(path.join(wt, 'runs', 'r1', 'responses.jsonl'), '{}');
  const u = script('unlink', wt, 'data,runs');
  assert.equal(u.status, 0, u.stderr);
  assert.equal(existsSync(path.join(wt, 'data')), false);
  git(main, 'worktree', 'remove', wt);
  assert.equal(existsSync(wt), false);
  assert.equal(readFileSync(path.join(main, 'data', 'k.txt'), 'utf8'), 'keep');
  assert.equal(readFileSync(path.join(main, 'runs', 'r1', 'responses.jsonl'), 'utf8'), '{}');
});

test('7. unlink leaves a real directory and its files alone and says so', () => {
  const { wt } = fixture();
  mkdirSync(path.join(wt, 'data'));
  writeFileSync(path.join(wt, 'data', 'own.txt'), 'mine');
  const r = script('unlink', wt, 'data');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(wt, 'data', 'own.txt'), 'utf8'), 'mine');
  assert.match(r.stdout + r.stderr, /data.*(real directory|not a link)/i);
});

test('8. link run twice does nothing the second time and does not fail', () => {
  const { main, wt } = fixture();
  mkdirSync(path.join(main, 'data'));
  writeFileSync(path.join(main, 'data', 'in.txt'), 'input');
  assert.equal(script('link', wt, 'data').status, 0);
  const again = script('link', wt, 'data');
  assert.equal(again.status, 0, again.stderr);
  assert.ok(isLink(path.join(wt, 'data')));
  assert.equal(readFileSync(path.join(wt, 'data', 'in.txt'), 'utf8'), 'input');
});

test('9. with AEO_WORKTREE_LINKS unset or empty, link changes nothing and exits zero', () => {
  const { main, wt } = fixture();
  mkdirSync(path.join(main, 'data'));
  for (const v of [undefined, '', ' , ']) {
    const r = script('link', wt, v);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(path.join(wt, 'data')), false);
  }
  assert.equal(git(wt, 'status', '--short').trim(), '');
});

test('10. a declared directory missing in the main checkout is created there', () => {
  const { main, wt } = fixture();
  assert.equal(existsSync(path.join(main, 'runs')), false);
  const r = script('link', wt, 'runs');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lstatSync(path.join(main, 'runs')).isDirectory());
  assert.equal(isLink(path.join(main, 'runs')), false);
  writeFileSync(path.join(wt, 'runs', 'first.txt'), 'hello');
  assert.equal(readFileSync(path.join(main, 'runs', 'first.txt'), 'utf8'), 'hello');
});

test('11. two worktrees share runs/, and link output names the issue-number run-id rule', () => {
  const { dir, main, wt } = fixture();
  const wt2 = addWorktree(main, dir, 'w2');
  const a = script('link', wt, 'runs');
  const b = script('link', wt2, 'runs');
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  writeFileSync(path.join(wt, 'runs', 'from-a.txt'), 'a');
  writeFileSync(path.join(wt2, 'runs', 'from-b.txt'), 'b');
  assert.equal(readFileSync(path.join(wt2, 'runs', 'from-a.txt'), 'utf8'), 'a');
  assert.equal(readFileSync(path.join(wt, 'runs', 'from-b.txt'), 'utf8'), 'b');
  assert.match(a.stdout, /issue number/i);
  assert.match(a.stdout, /-i\d+-/);
});
