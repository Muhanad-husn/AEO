#!/usr/bin/env node
// Decide whether a group of issues can go to development actors right now, and refuse
// the group as a whole when it cannot.
//
// WHY THIS EXISTS. `sprint-start`'s concurrency step has to answer three questions before
// it dispatches anybody, and all three have oracles, so none of them is agent judgment:
//
//   1. Is the group within the cap? The cap is a founder-set operating parameter and lives
//      in exactly one place, references/actor-cap.md. This reads it there rather than
//      carrying a number.
//   2. Are the slices mutually disjoint? Delegated whole to scripts/independence.mjs, which
//      is the only implementation of that check and the only normative definition of the
//      declaration block. Its report is printed verbatim, because a group that fails is
//      reported with the collision, never silently trimmed down to a subset that passes.
//   3. Is any branch or worktree path already held? Two actors on one branch, or one
//      worktree path, is not concurrency; it is two sessions writing over each other. Git
//      already knows which paths and branches are checked out, so this asks it.
//
//   node plan-actors.mjs --actor <slice-source> <branch> <worktree-path> [--actor ...]
//
// The usual shape, from the sprint lane about to dispatch four actors:
//
//   gh issue view 13 --json body -q .body > /tmp/13.md   # and 14, 15, 16
//   node plan-actors.mjs \
//     --actor /tmp/13.md feat/sprint/13 ../wt/13 \
//     --actor /tmp/14.md feat/sprint/14 ../wt/14
//
// STREAMS AND EXIT, the same contract as independence.mjs and for the same reason: the
// verdict is a result, not an error, so it goes to stdout and the exit code carries it —
// 0 dispatchable, 1 refused. stderr is reserved for "I could not run at all". Read the
// verdict from the exit code; `NOT dispatchable` contains `dispatchable`, so a substring
// match sees both verdicts as one.
//
// FAIL CLOSED ON THE EMPTY SET (L-05). No actors is not a trivially safe group of zero. It
// is a caller that computed nothing, and dispatching on it would be dispatching on silence.
//
// ONE ACTOR SKIPS THE INDEPENDENCE CHECK, LOUDLY. The check compares two or more slices
// against each other; a single slice has nothing to collide with. The skip is printed, not
// assumed, because a check that quietly did not run reads exactly like a check that passed.
//
// COMPARISON FOLDS CASE, on paths and on branch names, on every platform. `D:/wt/A` and
// `D:/wt/a` are one directory on Windows and on macOS, which is where this runs, and git's
// loose refs on those filesystems collide the same way. The cost is a false refusal in a
// repository that deliberately keeps two branches differing only by case, and a false
// refusal is the reversible direction (L-07): it costs one rename, where the other
// direction costs two actors writing into one tree.
//
// CONTAINMENT COUNTS FOR PATHS, matching independence.mjs's ancestor rule and for the
// ownership reason rather than a filesystem one: an actor given `../wt` has claimed that
// name and everything under it, so a second actor given `../wt/14` is being placed inside
// territory the first already owns.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The one place the cap is written down. See its own first paragraph. */
export const CAP_FILE = path.join(import.meta.dirname, '..', 'references', 'actor-cap.md');

const INDEPENDENCE = path.join(import.meta.dirname, '..', '..', '..', 'scripts', 'independence.mjs');

/** The declared cap line. Deliberately anchored: a mention in prose must not match. */
const CAP_LINE = /^\*\*Development actors:\s*(\d+)\*\*\s*$/m;

const USAGE = `usage:
  plan-actors --actor <slice-source> <branch> <worktree-path> [--actor ...]

Each --actor names one issue or slice plan on disk, the branch that actor will hold, and
the worktree path it will hold. Exit 0 when the group can be dispatched, 1 when it cannot.`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * The development-actor cap, read from the one file that states it.
 *
 * A missing or unparseable line is a hard failure rather than a default. A default here
 * would be a second copy of the number, which is the thing this file exists to prevent.
 */
export function readCap(file = CAP_FILE) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { error: `cannot read the actor cap from ${file} (${err?.message ?? err})` };
  }
  const m = CAP_LINE.exec(text);
  if (m === null) {
    return { error: `${file} carries no \`**Development actors: <n>**\` line, so the cap is unknown. It is not defaulted.` };
  }
  const cap = Number.parseInt(m[1], 10);
  if (!Number.isInteger(cap) || cap < 1) return { error: `${file} declares a cap of ${m[1]}, which is not a number of actors` };
  return { cap };
}

/** A path in one comparable spelling: absolute, forward slashes, no trailing slash, folded. */
function key(p) {
  return path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** True when `outer` is a proper ancestor of `inner`. */
function contains(outer, inner) {
  return inner.startsWith(`${outer}/`);
}

/**
 * The worktrees git already has, from `git worktree list --porcelain`.
 *
 * The porcelain form is one record per worktree, blank-line separated: a `worktree <path>`
 * line, then `HEAD`, then either `branch refs/heads/<name>` or `detached`. A detached
 * worktree holds a path and no branch, which is still a held path.
 */
export function parseWorktreeList(text) {
  const held = [];
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length).trim(), branch: null };
      held.push(current);
    } else if (line.startsWith('branch refs/heads/') && current !== null) {
      current.branch = line.slice('branch refs/heads/'.length).trim();
    }
  }
  return held;
}

/**
 * Every reason this group cannot be dispatched, as `{ kind, text }`.
 *
 * `actors` are `{ source, branch, worktree }`, in the order the lane picked them. `held` is
 * what git already has, as `{ path, branch }`. The independence verdict is not decided here;
 * it belongs to independence.mjs and the CLI below folds its report in.
 */
export function planActors({ actors = [], cap, held = [] } = {}) {
  const findings = [];
  const add = (kind, text) => findings.push({ kind, text });

  if (actors.length === 0) {
    add('empty', 'no actors were named, so there is no group to dispatch. An empty set is a caller that computed nothing, not a safe group of zero.');
    return { findings };
  }
  if (actors.length > cap) {
    add(
      'over-cap',
      `${actors.length} actors were named and the cap is ${cap}. The cap is a founder-set operating parameter ` +
        `(skills/sprint-start/references/actor-cap.md); dispatch ${cap} and leave the rest for the next round, or ask the founder to change it.`,
    );
  }

  const heldPaths = held.map((h) => ({ ...h, key: key(h.path) }));
  const heldBranches = held.filter((h) => typeof h.branch === 'string' && h.branch !== '');

  const seenBranch = new Map();
  const seenPath = new Map();

  for (const actor of actors) {
    const branchKey = String(actor.branch ?? '').toLowerCase();
    const pathKey = key(actor.worktree);

    const twin = seenBranch.get(branchKey);
    if (twin !== undefined) {
      add('duplicate-branch', `${actor.source} and ${twin.source} are both assigned branch ${actor.branch}. One issue = one branch, per actor.`);
    } else {
      seenBranch.set(branchKey, actor);
    }

    for (const [otherKey, other] of seenPath) {
      if (otherKey === pathKey) {
        add('duplicate-worktree', `${actor.source} and ${other.source} are both assigned worktree ${actor.worktree}. One issue = one worktree, per actor.`);
      } else if (contains(otherKey, pathKey) || contains(pathKey, otherKey)) {
        add(
          'duplicate-worktree',
          `${actor.source}'s worktree ${actor.worktree} and ${other.source}'s ${other.worktree} contain one another, so one actor would be working inside the other's tree.`,
        );
      }
    }
    if (!seenPath.has(pathKey)) seenPath.set(pathKey, actor);

    for (const h of heldBranches) {
      if (h.branch.toLowerCase() === branchKey) {
        add('branch-held', `branch ${actor.branch} is already checked out at ${h.path}, so ${actor.source} cannot be dispatched onto it.`);
      }
    }
    for (const h of heldPaths) {
      if (h.key === pathKey) {
        add('worktree-held', `worktree path ${actor.worktree} is already a worktree of this repository, so ${actor.source} cannot be dispatched onto it.`);
      } else if (contains(h.key, pathKey)) {
        add('worktree-held', `worktree path ${actor.worktree} is inside the existing worktree at ${h.path}, so ${actor.source} would be writing into another checkout.`);
      }
    }
  }

  return { findings };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const actors = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--actor') fail(`unexpected argument ${JSON.stringify(argv[i])}\n${USAGE}`);
    const [source, branch, worktree] = argv.slice(i + 1, i + 4);
    if (worktree === undefined || [source, branch, worktree].some((a) => a.startsWith('--'))) {
      fail(`--actor takes three values: a slice source, a branch and a worktree path\n${USAGE}`);
    }
    actors.push({ source, branch, worktree });
    i += 3;
  }
  return actors;
}

function main() {
  const actors = parseArgs(process.argv.slice(2));

  const { cap, error } = readCap();
  if (error !== undefined) fail(error);

  const gitList = spawnSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8', windowsHide: true });
  if (gitList.error || gitList.status !== 0) {
    fail(`git worktree list failed, so which branches and paths are already held is unknown (${gitList.stderr?.trim() || gitList.error}).`);
  }
  const held = parseWorktreeList(gitList.stdout).map((w) => ({ path: w.path, branch: w.branch }));

  const { findings } = planActors({ actors, cap, held });

  // The independence check, run whole and reported whole. Its exit code is the verdict.
  let independence = null;
  if (actors.length >= 2) {
    const r = spawnSync(process.execPath, [INDEPENDENCE, ...actors.map((a) => a.source)], { encoding: 'utf8', windowsHide: true });
    if (r.error || r.status === null) fail(`could not run the independence check (${r.stderr?.trim() || r.error}).`);
    if (r.status !== 0 && (r.stdout ?? '').trim() === '') fail(`the independence check could not run: ${r.stderr?.trim()}`);
    independence = { safe: r.status === 0, report: (r.stdout ?? '').trim() };
  }

  const assignment = actors.map((a) => `  ${a.source}\n    branch   ${a.branch}\n    worktree ${a.worktree}`).join('\n');
  const refused = findings.length > 0 || (independence !== null && !independence.safe);

  const out = [];
  if (refused) {
    out.push(`NOT dispatchable: ${actors.length} actor${actors.length === 1 ? '' : 's'}, cap ${cap}.`, '');
    for (const f of findings) out.push(`  ${f.kind}  ${f.text}`);
    if (findings.length > 0) out.push('');
  } else {
    out.push(`dispatchable: ${actors.length} actor${actors.length === 1 ? '' : 's'}, cap ${cap}, no held branch or worktree path and no collision between the slices.`, '');
  }
  out.push('assignment:', assignment, '');
  if (independence === null) {
    out.push('independence: not run — one actor has nothing to collide with. This is a skip, not a pass.');
  } else {
    out.push(independence.report);
  }
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(refused ? 1 : 0);
}

// Importable for tests without running the CLI.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
