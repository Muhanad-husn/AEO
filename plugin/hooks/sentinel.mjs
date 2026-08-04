// AEO run-in-progress sentinel: the marker that says a long job is live.
//
// WHY THIS EXISTS (L-02). Every other gate blocks an action. The commit gate PERFORMS
// one: it runs the project's test suite, so `git commit` executes code. Four
// simultaneous external kills of a running four-hour pipeline were traced to a
// concurrent session's commit gate firing the suite. The runbook states it bluntly:
// while a corpus run is live, no test runs and no commits, from any session.
//
// A sentinel is how one session tells every other session that this machine is busy.
// It is read by the commit gate and by the sandbox guard, and written by whoever starts
// the long job (plugin/scripts/run-sentinel.mjs is the shipped writer).
//
// WHERE IT LIVES (D12). `<repo toplevel>/.aeo/runs/`, in the project repo, gitignored.
// It must be visible to every session and every worktree of that project, which rules
// out `${CLAUDE_PLUGIN_ROOT}` (ephemeral, changes on plugin update) and rules out any
// per-session temp directory. A worktree resolves its own `.git` but shares nothing
// else, so the toplevel each gate already computes is the right anchor.
//
// ONE FILE PER RUN, NOT ONE FILE. Two long jobs can be live at once. A single shared
// file means the second job's start overwrites the first job's marker and the second
// job's finish clears it while the first is still running, which silently removes the
// guarantee at exactly the moment it is load-bearing. A directory of per-run files
// makes start and stop composable and costs one readdir.
//
// STALENESS, AND WHY IT IS NOT A TIMEOUT. A crashed job leaves a sentinel behind, and a
// sentinel nobody can clear becomes a thing people delete reflexively, which is how a
// guard dies. An age-based expiry would be a hand-tuned constant that is wrong in both
// directions: a six-hour job outlives a four-hour TTL, and a crashed job blocks for the
// whole TTL anyway. So liveness is decided by the recorded owner process instead. A
// sentinel whose host is this machine and whose recorded pid is provably gone is stale
// and does not block. Everything else blocks: no pid recorded, another host, a pid that
// still exists, an unparseable file. Fail closed on every ambiguity.
//
// A stale sentinel is never deleted here. A gate that removes files is a gate that can
// remove the wrong one, and the reader is on the block path.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Where sentinels live, relative to the repository toplevel. */
export const SENTINEL_DIRNAME = path.join('.aeo', 'runs');

const HOW_TO_CLEAR_INLINE =
  'clear its sentinel with `node <plugin>/scripts/run-sentinel.mjs stop <id>`, or delete the file under .aeo/runs/.';
const HOW_TO_CLEAR =
  'Fix or remove the file under .aeo/runs/, or clear it with `node <plugin>/scripts/run-sentinel.mjs stop <id>`.';

/** The id characters a sentinel filename may carry. Anything else is rewritten. */
const SAFE_ID = /[^A-Za-z0-9._-]+/g;

/** The absolute sentinel directory for a repository. */
export function sentinelDir(toplevel) {
  return path.join(toplevel, SENTINEL_DIRNAME);
}

/** A run id reduced to a safe filename stem. Empty input becomes `run`. */
export function sentinelId(id) {
  const cleaned = String(id ?? '').trim().replace(SAFE_ID, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'run' : cleaned;
}

/** The absolute path of one run's sentinel file. */
export function sentinelPath(toplevel, id) {
  return path.join(sentinelDir(toplevel), `${sentinelId(id)}.json`);
}

/**
 * The main checkout of a linked worktree, read from its `.git` file, or null.
 *
 * A linked worktree records `gitdir: <main>/.git/worktrees/<name>`. Every worktree of a
 * project shares one sentinel set, so a worktree has to resolve to the main checkout
 * rather than to itself. This reads the file rather than spawning git, because the
 * sandbox guard runs before every single Bash call and a process spawn there is a cost
 * paid on every tool use.
 */
function linkedWorktreeMain(dotgit) {
  let text;
  try {
    if (!statSync(dotgit).isFile()) return null;
    text = readFileSync(dotgit, 'utf8');
  } catch {
    return null;
  }
  const m = /^gitdir:\s*(.+)$/m.exec(text);
  if (!m) return null;
  const gitdir = path.resolve(path.dirname(dotgit), m[1].trim());
  const marker = `${path.sep}worktrees${path.sep}`;
  const cut = gitdir.lastIndexOf(marker);
  if (cut === -1) return null;
  return path.dirname(gitdir.slice(0, cut));
}

/**
 * The directory a repository's sentinels are anchored to, or null.
 *
 * The nearest ancestor that already holds `.aeo/runs` wins, so a project that put its
 * sentinels somewhere deliberate keeps them there. Otherwise the enclosing repository
 * root, resolved through the main checkout when this is a linked worktree.
 */
export function projectAnchor(startDir) {
  if (typeof startDir !== 'string' || startDir.trim() === '') return null;
  let dir;
  try {
    dir = path.resolve(startDir);
  } catch {
    return null;
  }
  for (;;) {
    if (existsSync(path.join(dir, SENTINEL_DIRNAME))) return dir;
    const dotgit = path.join(dir, '.git');
    if (existsSync(dotgit)) return linkedWorktreeMain(dotgit) ?? dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Whether a process exists.
 *
 * Signal 0 is the existence check on every platform Node supports, Windows included.
 * EPERM means the process exists and belongs to someone else, which is still alive.
 * Pid reuse can make a dead run look live; that direction blocks a commit rather than
 * killing a pipeline, so it is the direction to be wrong in.
 */
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function describe(record, file) {
  const bits = [path.basename(file)];
  if (typeof record?.what === 'string' && record.what.trim() !== '') bits.push(record.what.trim());
  if (typeof record?.started === 'string' && record.started.trim() !== '') bits.push(`started ${record.started.trim()}`);
  if (Number.isInteger(record?.pid)) bits.push(`pid ${record.pid}`);
  if (typeof record?.host === 'string' && record.host.trim() !== '') bits.push(`on ${record.host.trim()}`);
  return bits.join(', ');
}

/**
 * Every sentinel in a repository, sorted into the ones that block and the ones that do
 * not.
 *
 * A missing directory is the normal case and is not an error: most repositories never
 * raise a sentinel. Any other directory-read failure is a block, because a guard that
 * cannot read its own marker cannot say the machine is free.
 *
 * @param {string|null} toplevel
 * @returns {{live: string[], stale: string[], unreadable: string[], dirError: string|null}}
 */
export function inspectRuns(toplevel, { hostname = os.hostname, alive = processAlive } = {}) {
  const result = { live: [], stale: [], unreadable: [], dirError: null };
  if (typeof toplevel !== 'string' || toplevel.trim() === '') return result;

  const dir = sentinelDir(toplevel);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    // ENOENT and ENOTDIR both mean "no sentinel directory here", which is the ordinary
    // state of a repository with no long jobs. Everything else is a real failure.
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return result;
    result.dirError = `${dir} could not be read (${err?.message ?? err})`;
    return result;
  }

  const host = hostname();
  for (const name of entries.filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, name);
    let record;
    try {
      record = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      result.unreadable.push(`${file} does not parse (${err?.message ?? err})`);
      continue;
    }
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      result.unreadable.push(`${file} is not a JSON object`);
      continue;
    }

    const sameHost = typeof record.host === 'string' && record.host.trim() === host;
    const pid = Number.isInteger(record.pid) && record.pid > 0 ? record.pid : null;
    if (sameHost && pid !== null && !alive(pid)) {
      result.stale.push(`${describe(record, file)} (owner process is gone)`);
    } else {
      result.live.push(describe(record, file));
    }
  }
  return result;
}

/**
 * The reason a repository is closed for business, or null.
 *
 * `notes` carries what the caller should say on stderr even when nothing blocks. A stale
 * sentinel is reported rather than swallowed: a quiet pass is how a gate stops being
 * noticed at all (L-08).
 *
 * @returns {{reason: string|null, notes: string[]}}
 */
export function runInProgress(toplevel, options) {
  const { live, stale, unreadable, dirError } = inspectRuns(toplevel, options);
  const notes = stale.map((s) => `sentinel: ${s}; not blocking. Clear it with \`node <plugin>/scripts/run-sentinel.mjs stop <id>\` or by deleting the file.`);

  if (dirError !== null) {
    return { reason: `${dirError}, so the gate cannot tell whether a long job is running. ${HOW_TO_CLEAR}`, notes };
  }
  if (unreadable.length > 0) {
    return {
      reason:
        `a run-in-progress sentinel is present but unreadable, so the gate cannot tell whether a long job is running:\n` +
        unreadable.map((u) => `  ${u}`).join('\n') +
        `\n${HOW_TO_CLEAR}`,
      notes,
    };
  }
  if (live.length > 0) {
    return {
      reason:
        `a long job is running and this would execute code alongside it (L-02):\n` +
        live.map((l) => `  ${l}`).join('\n') +
        `\nRunning the suite during a live job is what killed a four-hour pipeline four times. ` +
        `Wait for the job, or if it is already over, ${HOW_TO_CLEAR_INLINE}`,
      notes,
    };
  }
  return { reason: null, notes };
}
