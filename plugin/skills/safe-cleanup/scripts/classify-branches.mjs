#!/usr/bin/env node
/**
 * classify-branches.mjs — classify LOCAL git branches by merge status and propose safe cleanup.
 *
 * Scope: LOCAL branches only. This script NEVER touches the remote (no push --delete).
 * Default: DRY-RUN — it reports and deletes nothing. Deletion happens only with --apply --yes
 * plus the category flag(s) you approve.
 *
 * Safety guarantees:
 *   - Refuses to run on a detached HEAD (the "current branch" must be well-defined to protect it).
 *   - An OPEN PR always wins — such a branch is never deletable, even if it is an ancestor of the base.
 *   - A branch is only "merged" (safe) if its commits are genuinely in the base: an ancestor, or
 *     `git cherry` shows every commit is patch-present in the base, or the forge recorded that this
 *     exact branch head was the head it merged. A branch whose PR merged but which carries extra
 *     commits not in the base is KEPT ("ahead-of-merged-pr"), never force-deleted — this defeats
 *     branch-name reuse and post-merge commits.
 *   - Force-delete (`-D`) is re-verified at delete time; recovery SHAs are logged to a file BEFORE
 *     any deletion, and deletion aborts if that log cannot be written.
 *   - A failed PR query is missing data, not "no PRs": apply mode refuses rather than delete
 *     under a guarantee it can no longer honour.
 *   - Apply mode refuses when every evaluated branch came out deletable — nothing kept on
 *     evidence is what a wrong repository or an all-containing base looks like. No override flag.
 *
 * Cross-platform (Windows/macOS/Linux). Requires Node 18+ and git. Uses `gh` if available to detect
 * squash/rebase-merged and abandoned (closed-unmerged) PRs; degrades safely without it.
 *
 * Usage:
 *   node ${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs
 *   node ${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs --apply --yes --delete-merged
 *   node ${CLAUDE_PLUGIN_ROOT}/skills/safe-cleanup/scripts/classify-branches.mjs --apply --yes --delete-merged --delete-abandoned
 *
 * Flags:
 *   --base <branch>     base branch to compare against (auto-detected if omitted)
 *   --protected a,b,c   extra branch names to never delete (base/main/master/develop/release always protected)
 *   --apply             actually delete (otherwise dry-run)
 *   --yes               required with --apply as an explicit go-ahead
 *   --delete-merged     in apply mode, delete branches classified "merged"
 *   --delete-abandoned  in apply mode, also delete "abandoned" (closed-unmerged-PR) branches — these carry
 *                       commits NOT in the base; you opt into losing them (recoverable via reflog / the log)
 *   --log <path>        recovery-log path (default: .tdd-branch-cleanup.log at repo root)
 *   --json              also print machine-readable JSON of the classification
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALUE_FLAGS = new Set(['base', 'protected', 'log']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function git(gitArgs) {
  try { return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}
function gitOk(gitArgs) {
  try { execFileSync('git', gitArgs, { stdio: 'ignore' }); return true; } catch { return false; }
}
function gh(ghArgs) {
  try { return execFileSync('gh', ghArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

// Like gitOk, but for the one call whose failure reason the operator needs to see:
// deleting a branch. Captures stderr instead of discarding it.
function gitBranchDelete(delFlag, name) {
  try {
    execFileSync('git', ['branch', delFlag, name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, stderr: '' };
  } catch (e) {
    return { ok: false, stderr: typeof e.stderr === 'string' ? e.stderr : '' };
  }
}

// The first non-blank line of git's stderr. `git branch -D` failures are one line; the
// ref-lock case appends a multi-line advisory nobody asked to see in a one-line report.
function firstLine(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
}

// Maps a branch name to the absolute path of the worktree that has it checked out, or
// null if no worktree does — including when `git worktree list` itself fails or returns
// nothing parseable, so a diagnostic failure here never masks the underlying git error.
function worktreeHoldingBranch(name) {
  const out = git(['worktree', 'list', '--porcelain']);
  if (!out) return null;
  const target = `branch refs/heads/${name}`;
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length).trim();
    else if (line.trim() === target) return current;
  }
  return null;
}

// Count commits on `branch` that are NOT patch-present in `base` (git cherry '+' lines).
// 0 => everything on the branch is already in the base (safe). null => couldn't determine.
function cherryAhead(branch, base) {
  const out = git(['cherry', base, branch]);
  if (out === null) return null;
  if (out === '') return 0;
  return out.split('\n').filter(l => l.startsWith('+')).length;
}

// The squash case, which `git cherry` cannot see.
//
// A squash merge replaces every commit on the branch with one new commit in the base. None
// of the branch's commits become ancestors, and their patch-ids do not survive being
// combined, so `git cherry` reports every one of them as absent. It covers a rebase merge,
// where each commit keeps its patch under a new SHA, and misses squash completely. Squash
// is GitHub's most common merge setting, so without this the tool deletes nothing on the
// repositories that most need it — it degrades into a report, quietly.
//
// The forge already recorded the answer. The PR carries the head SHA it merged, so if the
// branch still points at exactly that commit, its tip is what went in, whatever strategy
// was used.
//
// This is strictly tighter than "a PR on this branch merged", and it preserves both cases
// the ahead-of-merged-pr rule exists to defeat. Post-merge commits move the head, so the
// SHAs differ and the branch is kept. A reused branch name is a different commit, so the
// SHAs differ and it is kept. Every merged PR on the branch is checked rather than the
// first: a match on any of them means this exact tip was merged.
//
// Exported for the tests. `gh` cannot be shimmed on Windows, so the only way to assert
// this rule against PR records is to hand them to it directly.
export function mergedAtRecordedHead(branchSha, mergedPrs) {
  if (typeof branchSha !== 'string' || branchSha === '') return null;
  if (!Array.isArray(mergedPrs)) return null;
  return mergedPrs.find(p => typeof p?.headRefOid === 'string' && p.headRefOid === branchSha) ?? null;
}

function detectBase(args) {
  if (typeof args.base === 'string') {
    if (gitOk(['rev-parse', '--verify', 'refs/heads/' + args.base])) return args.base;
    console.error(`ERROR: --base "${args.base}" is not a local branch.`); process.exit(1);
  }
  const sym = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (sym) { const b = sym.replace('refs/remotes/origin/', ''); if (gitOk(['rev-parse', '--verify', 'refs/heads/' + b])) return b; }
  const cfg = git(['config', '--get', 'init.defaultBranch']);
  if (cfg && gitOk(['rev-parse', '--verify', 'refs/heads/' + cfg])) return cfg;
  const candidates = ['main', 'master', 'develop', 'release'].filter(c => gitOk(['rev-parse', '--verify', 'refs/heads/' + c]));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) { console.error(`ERROR: multiple candidate base branches (${candidates.join(', ')}) and no origin/HEAD — pass --base <branch>.`); process.exit(1); }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const f of VALUE_FLAGS) {
    if (args[f] === true) { console.error(`ERROR: --${f} requires a value.`); process.exit(2); }
  }
  const apply = !!args.apply;
  const yes = !!args.yes;
  const deleteMerged = !!args['delete-merged'];
  const deleteAbandoned = !!args['delete-abandoned'];

  if (!gitOk(['rev-parse', '--is-inside-work-tree'])) { console.error('ERROR: not inside a git repository.'); process.exit(1); }
  const repoRoot = git(['rev-parse', '--show-toplevel']) || process.cwd();

  const base = detectBase(args);
  if (!base) { console.error('ERROR: could not determine a base branch to compare against. Pass --base <branch>.'); process.exit(1); }

  // Detached HEAD breaks "never delete the current branch" — refuse rather than protect the literal "HEAD".
  const current = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!current) { console.error('ERROR: detached HEAD — check out a branch before running cleanup.'); process.exit(1); }

  const protectedSet = new Set(['main', 'master', 'develop', 'release', base, current]
    .concat(typeof args.protected === 'string' ? args.protected.split(',').map(s => s.trim()).filter(Boolean) : []));

  const hasRemote = !!git(['remote']);
  let ghAuthed = false;
  try { execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' }); ghAuthed = true; } catch { ghAuthed = false; }
  const prCapable = hasRemote && ghAuthed;

  // A failed PR query is missing data, never an all-clear (L-08: a zero over data you
  // did not manage to read means "not measured", not "none found").
  //
  // gh() returns null on any failure and the old loop swallowed it, so a network blip, an
  // expired token or a rate limit left prByBranch empty while the report still announced
  // "gh + remote available". Every branch then classified with no PR data at all, and the
  // script's first stated guarantee — an open PR always wins, even over an ancestor —
  // silently stopped holding. A branch with an open PR fell through to the ancestor rule,
  // came out "merged", and --delete-merged deleted it.
  const prByBranch = {};
  let prTruncated = false;
  let prQueryFailed = false;
  if (prCapable) {
    const out = gh(['pr', 'list', '--state', 'all', '--json', 'number,state,headRefName,url,mergedAt,headRefOid', '--limit', '500']);
    if (out === null) prQueryFailed = true;
    else {
      try {
        const list = JSON.parse(out);
        if (list.length >= 500) prTruncated = true;
        for (const pr of list) (prByBranch[pr.headRefName] ||= []).push(pr);
      } catch { prQueryFailed = true; } // includes the empty-output case
    }
  }
  // What the rest of the run may assume it knows. Distinct from prCapable, which only
  // says the tools were there.
  const prKnown = prCapable && !prQueryFailed;

  const raw = git(['for-each-ref', '--format=%(refname:short)\t%(objectname)\t%(committerdate:unix)', 'refs/heads']) || '';
  const branches = raw.split('\n').filter(Boolean).map(l => {
    const [name, sha, ts] = l.split('\t');
    return { name, sha, ts: parseInt(ts, 10) };
  }).filter(b => b.name && b.sha);

  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  for (const b of branches) {
    if (protectedSet.has(b.name)) { rows.push({ ...b, status: 'protected', reason: 'protected / current / base' }); continue; }

    const prs = prByBranch[b.name] || [];
    const openPr = prs.find(p => p.state === 'OPEN');
    const mergedPrs = prs.filter(p => p.state === 'MERGED');
    const mergedPr = mergedPrs[0];
    const closedPr = prs.find(p => p.state === 'CLOSED'); // gh: CLOSED excludes MERGED
    const ancestor = gitOk(['merge-base', '--is-ancestor', b.name, base]);
    const unique = parseInt(git(['rev-list', '--count', `${base}..${b.name}`]) || '0', 10);
    const ageDays = Number.isFinite(b.ts) ? Math.floor((now - b.ts) / 86400) : null;

    // Set only when the branch was classified on head identity rather than on content, so
    // the delete-time re-verification below knows which question to re-ask.
    let status, delFlag = null, reason = '', mergedHeadOid = null;
    if (openPr) {
      status = 'open-pr'; reason = `PR #${openPr.number} open — never delete`;
    } else if (ancestor) {
      status = 'merged'; delFlag = '-d'; reason = `commits already in ${base}`;
    } else if (mergedPr) {
      const ahead = cherryAhead(b.name, base);
      const squashed = ahead === 0 ? null : mergedAtRecordedHead(b.sha, mergedPrs);
      if (ahead === 0) {
        status = 'merged'; delFlag = '-D'; reason = `PR #${mergedPr.number} merged; all commits present in ${base}`;
      } else if (squashed) {
        status = 'merged'; delFlag = '-D'; mergedHeadOid = squashed.headRefOid;
        reason = `PR #${squashed.number} merged this exact head (${b.sha.slice(0, 7)}) — squashed into ${base}`;
      } else {
        status = 'ahead-of-merged-pr'; reason = `PR #${mergedPr.number} merged but ${ahead == null ? 'some' : ahead} commit(s) NOT in ${base} — kept`;
      }
    } else if (closedPr) {
      status = 'abandoned'; delFlag = '-D'; reason = `PR #${closedPr.number} closed unmerged; ${unique} commit(s) not in ${base}`;
    } else {
      status = 'local-only'; reason = `${unique} commit(s) not in ${base}${prKnown ? ', no PR' : ', PR state unknown (PR data not retrieved)'}`;
    }
    rows.push({ ...b, status, delFlag, unique, ageDays, pr: prs[0]?.number ?? null, reason, mergedHeadOid });
  }

  // Report
  const self = process.argv[1];
  const fullCmd = `node "${self}"`;
  console.log(`Branch cleanup report — base "${base}", current "${current}"`);
  console.log(`PR detection: ${
    prKnown
      ? 'gh + remote available'
      : prQueryFailed
        ? 'FAILED (gh and a remote are present, but the PR query returned nothing usable — PR state is UNKNOWN for every branch, not empty)'
        : 'UNAVAILABLE (squash-merged / abandoned cannot be detected; only ancestor-merged branches are eligible)'
  }`);
  if (prTruncated) console.log('NOTE: PR list hit the 500 query limit — older PRs may be missing; affected branches fall back to "local-only" (kept).');
  console.log('');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('BRANCH', 40), pad('STATUS', 19), pad('PR', 6), pad('AGE', 6), pad('UNIQ', 5), 'NOTE');
  for (const r of rows) {
    console.log(pad(r.name, 40), pad(r.status, 19), pad(r.pr ?? '-', 6), pad(r.ageDays == null ? '-' : r.ageDays + 'd', 6), pad(r.unique ?? '-', 5), r.reason);
  }
  console.log('');

  const merged = rows.filter(r => r.status === 'merged');
  const abandoned = rows.filter(r => r.status === 'abandoned');
  const aheadPr = rows.filter(r => r.status === 'ahead-of-merged-pr');
  const openPr = rows.filter(r => r.status === 'open-pr');
  const localOnly = rows.filter(r => r.status === 'local-only');
  console.log(`Summary: ${merged.length} merged · ${abandoned.length} abandoned · ${aheadPr.length} ahead-of-merged-pr (kept) · ${openPr.length} open-PR (kept) · ${localOnly.length} local-only/unknown (kept)`);

  if (args.json) console.log('\nJSON ' + JSON.stringify(rows));

  const toDelete = [];
  if (deleteMerged) toDelete.push(...merged);
  if (deleteAbandoned) toDelete.push(...abandoned);

  if (!apply) {
    console.log('\n(DRY-RUN — nothing deleted.)');
    if (merged.length) console.log(`  To delete the ${merged.length} merged branch(es):     ${fullCmd} --apply --yes --delete-merged`);
    if (abandoned.length) console.log(`  To ALSO delete the ${abandoned.length} abandoned branch(es): add --delete-abandoned (these drop commits not in ${base} — recoverable via reflog only)`);
    const kept = aheadPr.length + openPr.length + localOnly.length;
    if (kept) console.log(`  ${kept} branch(es) are never auto-deleted (open PR, unmerged local work, or commits beyond a merged PR).`);
    return;
  }

  // Apply mode.
  if (!yes) { console.error('\nREFUSING: --apply requires --yes as an explicit go-ahead. Nothing deleted.'); process.exit(2); }

  // The PR query failed, so "no open PR on this branch" is a thing we did not learn
  // rather than a thing we checked. The open-PR-always-wins guarantee cannot be honoured
  // on data we do not have, and the branches it protects are exactly the ones still being
  // worked on. Refuse the whole run rather than delete under a guarantee that is not
  // holding. Dry-run still reports, because that is how the operator sees this.
  if (prQueryFailed) {
    console.error(
      '\nREFUSING: the PR query failed, so PR state is unknown for every branch — not empty.\n' +
      '  Deleting now would apply the ancestor-merged rule to branches whose open PR would\n' +
      '  otherwise protect them. Fix gh (check `gh auth status` and connectivity) and re-run.\n' +
      '  Nothing deleted.',
    );
    process.exit(4);
  }

  if (!prCapable && deleteAbandoned) console.warn('WARNING: gh/remote unavailable — "abandoned" branches could not be evaluated, so none will be deleted under --delete-abandoned.');
  if (!toDelete.length) { console.log('\nNothing selected for deletion (pass --delete-merged and/or --delete-abandoned). Nothing deleted.'); return; }

  // L-05: fail closed on a hollow keep-set, before the recovery log and before any
  // deletion, with no override flag.
  //
  // The delete-set-empty case above is already guarded and is not the risk. The risk runs
  // the other way: a classifier that put every branch it actually evaluated into the
  // delete pile has not demonstrated it can tell the two apart. That is what a wrong
  // working directory or a base branch containing all work produces, and it is L-05's
  // shape exactly — an empty keep-set makes every artifact look orphaned, and `--apply
  // --yes` would then have deleted the lot.
  //
  // Kept-on-evidence means the classifier positively decided to keep a branch for a
  // substantive reason. Protected-by-name branches are excluded deliberately: base and
  // current are protected in every repository, so counting them would make this check
  // pass everywhere and assert nothing. That is L-08's "a count-based preflight is not a
  // coverage check" — the count has to be over the thing being tested.
  //
  // There is no threshold and no tunable here, only a categorical zero, because a tuned
  // fraction is the over-engineering tripwire and would be a number nobody could defend.
  // And there is no override flag: an override is what gets reached for at 2am. The
  // recourse is to delete the branches by name with `git branch -d`, which is the same
  // work without the blast radius.
  const keptOnEvidence = rows.filter(r => ['open-pr', 'ahead-of-merged-pr', 'local-only'].includes(r.status));
  if (!keptOnEvidence.length) {
    console.error(
      `\nREFUSING: every branch this run evaluated came out deletable (${toDelete.length} selected, 0 kept on evidence).\n` +
      '  Nothing was kept for a substantive reason — no open PR, no unmerged local work, no\n' +
      '  commits beyond a merged PR. That is what running from the wrong repository, or against\n' +
      `  a base branch that already contains everything, looks like. Base was "${base}".\n` +
      '  Check those two things. If the classification is genuinely right, delete the branches\n' +
      '  by name with `git branch -d <name>`. There is no override flag, and that is deliberate.\n' +
      '  Nothing deleted.',
    );
    process.exit(5);
  }

  // Recovery log is mandatory when deleting — write it (and abort if we cannot).
  const logPath = typeof args.log === 'string' ? args.log : path.join(repoRoot, '.tdd-branch-cleanup.log');
  const stamp = new Date().toISOString();
  try {
    fs.appendFileSync(logPath, toDelete.map(r => `${stamp} ${r.sha} ${r.name} (${r.status})`).join('\n') + '\n');
  } catch (e) {
    console.error(`ERROR: cannot write recovery log at ${logPath} (${e.code || e.message}) — aborting before any deletion.`); process.exit(3);
  }

  console.log('\n----- RECOVERY (restore any of these with:  git branch <name> <sha>) -----');
  for (const r of toDelete) console.log(`  ${r.sha}  ${r.name}`);
  console.log(`(recovery log written to ${logPath})`);

  console.log('\n----- DELETING (local only) -----');
  let deleted = 0, skipped = 0;
  for (const r of toDelete) {
    if (protectedSet.has(r.name)) { console.log(`  skip   ${r.name} (protected)`); skipped++; continue; }
    if (!['merged', 'abandoned'].includes(r.status)) { console.log(`  skip   ${r.name} (${r.status} — not eligible)`); skipped++; continue; }
    // Re-verify force-deletes at the moment of deletion to catch any drift since
    // classification. Re-ask the question the branch was classified on: a squash-merged
    // branch would fail a cherry check by construction, so re-running that one would refuse
    // every branch this fix exists to release. Head identity is the drift check there — if
    // the branch has moved off the commit the forge merged, it is no longer that branch.
    if (r.delFlag === '-D' && r.status === 'merged') {
      if (r.mergedHeadOid) {
        const nowSha = git(['rev-parse', r.name]);
        if (nowSha !== r.mergedHeadOid) {
          console.log(`  SKIP   ${r.name} (head moved to ${nowSha ? nowSha.slice(0, 7) : 'unknown'} since classification — refusing force-delete)`);
          skipped++; continue;
        }
      } else {
        const ahead = cherryAhead(r.name, base);
        if (ahead !== 0) { console.log(`  SKIP   ${r.name} (now has ${ahead == null ? 'undetermined' : ahead} commit(s) not in ${base} — refusing force-delete)`); skipped++; continue; }
      }
    }
    const del = gitBranchDelete(r.delFlag, r.name);
    if (del.ok) { console.log(`  delete ${r.name}  (git branch ${r.delFlag})`); deleted++; }
    else {
      const cause = firstLine(del.stderr) || '(git gave no reason on stderr)';
      const heldBy = worktreeHoldingBranch(r.name);
      const where = heldBy ? ` — checked out in worktree ${heldBy}` : '';
      console.log(`  FAILED ${r.name} (git branch ${r.delFlag} refused: ${cause}${where} — left intact)`);
      skipped++;
    }
  }
  console.log(`\nDone. Deleted ${deleted} local branch(es), ${skipped} skipped/failed. Remote was NOT touched. Recovery log: ${logPath}`);
}

// Run only when invoked as a script. The tests import `mergedAtRecordedHead`, and without
// this guard that import would run a branch classification against whatever repository the
// test runner happens to be sitting in.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
