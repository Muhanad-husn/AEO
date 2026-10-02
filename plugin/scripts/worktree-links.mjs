#!/usr/bin/env node
// Link a project's git-ignored working directories into a worktree, and unlink them
// before the worktree is removed.
//
//   node worktree-links.mjs link <worktree>
//   node worktree-links.mjs unlink <worktree>
//
// WHY. A run slice reads and writes directories such as data/ and runs/ that git ignores,
// so they exist only in the main checkout. A fresh worktree has none. The consumer
// declares them in the AEO_WORKTREE_LINKS env key (comma-separated paths relative to the
// repo root, set in .claude/settings.json). Unset or empty means link nothing.
//
// WHY UNLINK FIRST. `git worktree remove` follows a junction and deletes the contents of
// its target. Removing the link itself first is the only safe order. unlink removes links
// and nothing else: never a recursive delete, and a real directory is left alone.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, symlinkSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';

const RUN_ID_RULE = 'Name run ids with the issue number, for example smoke-axial-i9-YYYYMMDD, '
  + 'because every worktree shares one runs/ directory.';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function mainCheckout(worktree) {
  const r = git(worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!r.ok) throw new Error(`not a git worktree: ${worktree}\n${r.err}`);
  return path.dirname(r.out);
}

function declared(main) {
  let raw = process.env.AEO_WORKTREE_LINKS;
  if (raw === undefined) {
    try {
      raw = JSON.parse(readFileSync(path.join(main, '.claude', 'settings.json'), 'utf8')).env?.AEO_WORKTREE_LINKS;
    } catch { /* no settings file: nothing declared */ }
  }
  return String(raw ?? '').split(',').map((s) => s.trim().replace(/\\/g, '/').replace(/\/+$/, '')).filter(Boolean);
}

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

function removeLink(p) {
  // A junction is removed with rmdir and a symlink with unlink; both touch the link only.
  try { unlinkSync(p); } catch { rmdirSync(p); }
}

function link(worktree) {
  const main = mainCheckout(worktree);
  const rels = declared(main);
  if (!rels.length) return 0;

  // Check every path before creating anything, so a refusal leaves no trace.
  const plan = [];
  for (const rel of rels) {
    const plain = git(worktree, ['check-ignore', '-q', rel]).ok;
    const slash = plain || git(worktree, ['check-ignore', '-q', `${rel}/`]).ok;
    if (!slash) {
      console.error(`worktree-links: ${rel} is not git-ignored, so it is not linked. Add it to .gitignore.`);
      return 1;
    }
    plan.push({ rel, needsExclude: !plain });
  }

  for (const { rel, needsExclude } of plan) {
    const target = path.join(main, rel);
    const at = path.join(worktree, rel);
    mkdirSync(target, { recursive: true });
    if (isLink(at)) { console.log(`already linked: ${rel}`); continue; }
    if (existsSync(at)) { console.error(`worktree-links: ${rel} exists in the worktree and is not a link; left alone.`); return 1; }
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir');
    if (needsExclude) {
      // A trailing-slash pattern does not match a link, which git sees as a file.
      const ex = git(worktree, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']).out;
      const line = `/${rel}`;
      const have = existsSync(ex) ? readFileSync(ex, 'utf8').split(/\r?\n/) : [];
      if (!have.includes(line)) {
        mkdirSync(path.dirname(ex), { recursive: true });
        appendFileSync(ex, `${have.length && have.at(-1) !== '' ? '\n' : ''}${line}\n`);
      }
    }
    console.log(`linked: ${rel} -> ${target}`);
  }
  console.log(RUN_ID_RULE);
  return 0;
}

function unlink(worktree) {
  const rels = declared(mainCheckout(worktree));
  for (const rel of rels) {
    const at = path.join(worktree, rel);
    if (isLink(at)) { removeLink(at); console.log(`unlinked: ${rel}`); }
    else if (existsSync(at)) console.log(`${rel} is a real directory, not a link; left alone.`);
  }
  return 0;
}

try {
  const [cmd, worktree] = process.argv.slice(2);
  if (!['link', 'unlink'].includes(cmd) || !worktree) {
    console.error('usage: worktree-links.mjs link|unlink <worktree>');
    process.exitCode = 2;
  } else {
    process.exitCode = (cmd === 'link' ? link : unlink)(path.resolve(worktree));
  }
} catch (e) {
  console.error(`worktree-links: ${e.message}`);
  process.exitCode = 1;
}
